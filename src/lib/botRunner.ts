import axios from 'axios';
import { sniper } from './sniperEngine.js';
import { getWatchlist } from './binanceScanner.js';
import { MarketCondition, GlobalContext } from '../types/trading.js';
import { getTimeframes, calculateTakerRatio } from './timeframeUtils.js';

const BINANCE_FAPI = 'https://fapi.binance.com';
let isRunning = false;
let botActive = false; // State to control if hunting is active
let globalContext: GlobalContext = {
  avgAdx: 25,
  avgAtrPerc: 2,
  bullishRatio: 0.5,
  totalVolume24h: 0,
  marketSentiment: 'NEUTRAL'
};

// Map to track previous Open Interest per symbol to calculate real-time percentage change
const lastOpenInterestMap = new Map<string, number>();

export function getGlobalMarketContext() {
  return globalContext;
}

const systemLogs: { time: number; msg: string; level: string }[] = [];

export function addLog(msg: string, level: string = 'info') {
  systemLogs.push({ time: Date.now(), msg, level });
  if (systemLogs.length > 50) systemLogs.shift();
}

export function getSystemLogs() {
  return systemLogs;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function setBotActive(state: boolean) {
  botActive = state;
  addLog(`Bot ${state ? 'STARTED 🔥' : 'STOPPED 🛑'}`, state ? 'info' : 'warn');
  console.log(`[BOT RUNNER] Hunting Mode is now: ${botActive ? 'ACTIVE 🟢' : 'PAUSED 🔴'}`);
}

export function isBotActive(): boolean {
  return botActive;
}

export async function runTradeLoop() {
  setInterval(async () => {
    if (isRunning) return;
    isRunning = true;
    
    // Heartbeat log every 10 iterations (~30 seconds)
    if ((globalContext as any).loopCount === undefined) (globalContext as any).loopCount = 0;
    (globalContext as any).loopCount++;
    if ((globalContext as any).loopCount % 10 === 0) {
        addLog(`Bot Heartbeat: Scanning ${getWatchlist().length} symbols...`, 'info');
    }

    try {
      const activeTrades = sniper.getActiveTrades();
      const settings = sniper.getSettings();

      // 1. GLOBAL PANIC DETECTION & CONTEXT (Every ~60 seconds to save weight)
      let isGlobalPanic = false;
      const lastContextUpdate = (globalContext as any).lastUpdate || 0;
      if (Date.now() - lastContextUpdate > 60000) {
        try {
          const tickersRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/ticker/24hr`, { timeout: 5000 });
          const tickers = tickersRes.data as any[];
          const sorted = tickers.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
          const top20 = sorted.slice(0, 20);
          
          const avgChange = top20.reduce((acc, t) => acc + parseFloat(t.priceChangePercent), 0) / 20;
          const totalVol = tickers.reduce((acc, t) => acc + parseFloat(t.quoteVolume), 0);
          const bullishCount = top20.filter(t => parseFloat(t.priceChangePercent) > 0).length;

          globalContext = {
              avgAdx: 25,
              avgAtrPerc: 1.5,
              bullishRatio: bullishCount / 20,
              totalVolume24h: totalVol,
              marketSentiment: avgChange > 2.5 ? 'EXTREME_GREED' : 
                              avgChange > 0.5 ? 'GREED' : 
                              avgChange > -0.5 ? 'NEUTRAL' : 
                              avgChange > -3 ? 'FEAR' : 'EXTREME_FEAR'
          };
          (globalContext as any).lastUpdate = Date.now();
        } catch (e) {
           addLog(`Global Context Refresh Error: ${e.message}`, 'error');
        }
      }

      // Nightmare mode check (Fast path)
      if (settings.isNightmareMode && globalContext.marketSentiment === 'EXTREME_FEAR') {
          isGlobalPanic = true;
          addLog(`GENERAL MARKET CAUTION: Extreme Fear detected.`, 'warn');
      }

      // ALWAYS manage open trades (TP/SL/Trailing), even if hunting is paused!
      if (activeTrades.length > 0) {
        try {
          let pricesRes;
          try {
            pricesRes = await axios.get(`${BINANCE_FAPI}/fapi/v2/ticker/price`, { timeout: 10000 });
          } catch(apiError: any) {
            if (apiError.response && apiError.response.status === 418) {
               console.error('[BOT RUNNER] ⚠️ IP BLOCKED BY BINANCE (Error 418). Render proxy or VPN needed.');
               await sleep(60000); // Sleep for 1 minute
            } else {
               console.error('[BOT RUNNER] API Error fetching ticker prices:', apiError.message);
            }
            throw apiError; 
          }
          const prices = pricesRes.data as any[];
          const pxMap = new Map<string, number>();
          prices.forEach(p => pxMap.set(p.symbol, parseFloat(p.price)));

          // 🔥 FIXED: Run trade updates in PARALLEL to prevent one trade from blocking the whole loop
          await Promise.all(activeTrades.map(async (t) => {
            const currentPx = pxMap.get(t.symbol);
            if (!currentPx) return;

            try {
              let currentOI: number | undefined = undefined;
              let currentVol: number | undefined = undefined;

              // 1. DATA FETCHING (KINETIC & ADAPTIVE) - SELF-HEALING & SEGREGATED
              const tfs = getTimeframes(!!settings.isLongTerm);
              let klines: any[] = [];
              let currentRsi = 50;
              let currentAdx = 25;
              let currentTakerRatio = 1.0;
              let currentFundingRate = 0.0;

              try {
                // Fetch each endpoint in parallel with individual safe catch handlers to prevent cascading failures
                const [klinesRes, oiRes, premiumRes] = await Promise.all([
                  axios.get(`${BINANCE_FAPI}/fapi/v1/klines?symbol=${t.symbol}&interval=${tfs.m5}&limit=35`, { timeout: 4000 })
                    .catch(err => {
                       console.warn(`[BOT RUNNER] Klines fetch backup needed for ${t.symbol}:`, err.message);
                       return { data: [] };
                    }),
                  axios.get(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${t.symbol}`, { timeout: 3000 })
                    .catch(() => {
                       return { data: null };
                     }),
                  axios.get(`${BINANCE_FAPI}/fapi/v1/premiumIndex?symbol=${t.symbol}`, { timeout: 3000 })
                    .catch(() => {
                       return { data: null };
                    })
                ]);
                
                klines = klinesRes.data;
                if (klines && klines.length > 0) {
                  const lastK = klines[klines.length - 1];
                  currentTakerRatio = calculateTakerRatio(lastK);
                  currentVol = parseFloat(lastK[5]);
                }

                if (oiRes && oiRes.data && oiRes.data.openInterest) {
                  currentOI = parseFloat(oiRes.data.openInterest);
                }

                if (premiumRes && premiumRes.data && premiumRes.data.lastFundingRate) {
                  currentFundingRate = parseFloat(premiumRes.data.lastFundingRate);
                }

                // Calculate RSI/ADX if klines available
                if (klines && klines.length >= 15) {
                  const calcRSI = (endIdx: number, period: number) => {
                    let gains = 0, losses = 0;
                    for (let i = endIdx - period + 1; i <= endIdx; i++) {
                      const change = parseFloat(klines[i][4]) - parseFloat(klines[i-1][4]);
                      if (change > 0) gains += change;
                      else losses -= change;
                    }
                    let avgGain = gains / period;
                    let avgLoss = losses / period;
                    return avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
                  };
                  currentRsi = calcRSI(klines.length - 1, 14);
                }

                // Unified Manage Trades call
                await sniper.manageTrades(t.symbol, currentPx, currentOI, currentVol, currentTakerRatio, { 
                  emaTrend: klines && klines.length > 0 && currentPx > parseFloat(klines[klines.length - 1][4]) ? 'LONG' : 'SHORT',
                  rsi: currentRsi,
                  adx: currentAdx,
                  klines: klines,
                  fundingRate: currentFundingRate
                });

                // 2. SMART & WISE EXIT LOGIC (Reusing fetched data)
                if (settings.useWiseExit && klines && klines.length > 0) {
                  await sniper.wiseExit(t.symbol, currentPx, klines);
                  if (!sniper.getActiveTrades().find(at => at.symbol === t.symbol)) return;
                }

                if (settings.useSmartExit) {
                  // The Adaptive Flow in SniperEngine now handles the core exit validation,
                  // but we keep the specific SmartExit reversal logic if enabled.
                  // (Detailed logic for SmartExit was here, can be re-added or kept simplified)
                }

              } catch (e) {
                // Fallback if full data fetch fails
                await sniper.manageTrades(t.symbol, currentPx, undefined, undefined, undefined, { 
                  emaTrend: currentPx > t.entryPrice ? 'LONG' : 'SHORT' 
                });
              }
            } catch (e: any) {
               console.error(`[BOT RUNNER] Error updating trade for ${t.symbol}:`, e.message);
            }
          }));
        } catch (e: any) {
           if (e.response && (e.response.status === 429 || e.response.status === 418)) {
              console.log(`[BOT RUNNER] ⚠️ Rate limit hit. Pausing Monitoring...`);
              await sleep(10000); 
           }
        }
      }

      // ONLY hunt for new targets if bot is active and no panic detected
      if (!botActive || (isGlobalPanic && !settings.beastMode)) {
         if (isGlobalPanic) console.log(`[BOT] 🛡️ Entry blocked due to Market Panic.`);
         isRunning = false;
         return;
      }

      const watchlist = getWatchlist();
      const maxTrades = sniper.getSettings().maxConcurrentTrades;
      const isStrict = sniper.getSettings().strictMode;
      const isBeastMode = sniper.getSettings().beastMode;

      // Check BTC trend for strict mode (Filter 3: BTC Trend Filter)
      let btcTrend = 'FLAT';
      if (isStrict && botActive) {
         try {
            const btcRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/ticker/24hr?symbol=BTCUSDT`, { timeout: 3000 });
            btcTrend = parseFloat(btcRes.data.priceChangePercent) >= 0 ? 'LONG' : 'SHORT';
         } catch(e) {}
      }
      
      // 3. Scan for Entry Conditions (Only let max X trades run concurrently for safety)
      if (activeTrades.length < maxTrades && watchlist.length > 0) {
        // Optimized Scanning: Lower count and add spacing to prevent 429
        const scanCount = 15; 
        const targetsToCheck = [...watchlist].sort(() => 0.5 - Math.random()).slice(0, scanCount);

        let rejectedCount = 0;
        let signalFoundInThisLoop = false;
        let rejectionReasons: Record<string, number> = {};

        // Select and run active entry engine
        try {
            const { QuantumEngine } = await import('./engine/QuantumEngine.js');
            const { CreativeEntryEngine } = await import('./engine/CreativeEntryEngine.js');
            const { SteelEngine } = await import('./engine/SteelEngine.js');
            const quantum = new QuantumEngine();
            const creativeEngine = new CreativeEntryEngine();
            const steelEngine = new SteelEngine();

            for (const coin of targetsToCheck) {
                // If we found a signal and filled our slots, stop scanning
                if (sniper.getActiveTrades().length >= maxTrades) break;
                if (activeTrades.find(t => t.symbol === coin.symbol)) continue;

                // 🛑 RATE LIMIT PROTECTION: Add a small gap between scanning new symbols
                // This doesn't affect active trade updates which run in parallel above
                await sleep(200); 

                const tfs = getTimeframes(!!settings.isLongTerm);
                try {
                     // Try to get klines first
                     const klinesRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/klines?symbol=${coin.symbol}&interval=${tfs.m1}&limit=60`, { timeout: 4000 });
                     const klines = klinesRes.data;

                     // Calculate Taker Ratio safely from the last candle of klines
                     let takerRatio = 1.0;
                     if (klines && klines.length > 0) {
                         const lastK = klines[klines.length - 1];
                         const totalVol = 0;
                         takerRatio = calculateTakerRatio(lastK);
                         const takerBuyVol = 0;
                         const takerSellVol = totalVol - takerBuyVol;
                         if (takerSellVol > 0) {
                             /* already calculated manually */
                         }
                     }

                     if (settings.useTawleefaEngine) {
                         const currentPx = parseFloat(klines[klines.length - 1][4]);
                         
                         const condition: MarketCondition = {
                             symbol: coin.symbol,
                             price: currentPx,
                             type: 'LONG', // will be evaluated and updated by evaluateSignal
                             rvol: coin.rvol,
                             oiChange24h: 0,
                             score: coin.score,
                             isRanging: coin.trend === 'FLAT',
                             isBreakout: coin.trend !== 'FLAT',
                             isRetestOrHold: false,
                             isLiquidityGood: true,
                             isMomentumHigh: coin.rvol >= 1.5,
                             isOrderBookClear: true,
                             support: 0,
                             resistance: 0,
                             takerBuySellRatio: takerRatio,
                             atr: 0,
                             vol24h: coin.volume,
                             spread: coin.spread,
                             oi: undefined,
                             fundingRate: parseFloat((coin as any).fundingRate || 0)
                         };

                         try {
                             const oiRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${coin.symbol}`, { timeout: 3000 });
                             if (oiRes.data && oiRes.data.openInterest) {
                                 const currentOI = parseFloat(oiRes.data.openInterest);
                                 condition.oi = currentOI;
                                 const prevOI = lastOpenInterestMap.get(coin.symbol);
                                 if (prevOI && prevOI > 0) {
                                     condition.oiChange24h = ((currentOI - prevOI) / prevOI) * 100;
                                 }
                                 lastOpenInterestMap.set(coin.symbol, currentOI);
                             }
                         } catch (e) {
                             // Ignore
                         }

                         await sniper.evaluateSignal(condition, klines, klines, globalContext);
                         
                         // Save the full Tawleefa engine decision & live diagnostics onto the coin
                         (coin as any).decision = condition.decision;
                         
                         if (sniper.getActiveTrades().has(coin.symbol)) {
                             signalFoundInThisLoop = true;
                         } else {
                             rejectedCount++;
                             const label = 'Tawleefa No Signal';
                             rejectionReasons[label] = (rejectionReasons[label] || 0) + 1;
                         }
                         continue;
                     }

                     const decision = settings.useSteelEngine
                        ? steelEngine.analyze(klines, takerRatio, sniper.getSettings(), parseFloat((coin as any).fundingRate || 0))
                        : settings.useCreativeEngine
                        ? creativeEngine.analyze(klines, takerRatio, sniper.getSettings())
                        : quantum.analyze(klines, takerRatio, sniper.getSettings());

                     // Saveconventional engine decision in the coin
                     (coin as any).decision = {
                         regime: coin.trend === 'FLAT' ? 'COMPRESSION' : 'TREND_EXPANSION',
                         bias: decision.type,
                         trap: 'NONE',
                         confidence: (decision.confidence ?? 60) / 100,
                         action: decision.shouldEnter ? 'ATTACK' : 'WAIT',
                         reason: decision.reason || (settings.useSteelEngine ? 'STEEL_NO_EDGE' : settings.useCreativeEngine ? 'CREATIVE_NO_EDGE' : 'QUANTUM_NO_EDGE')
                     };

                     if (decision.shouldEnter) {
                          signalFoundInThisLoop = true;
                          const currentPx = parseFloat(klines[klines.length - 1][4]);
                          
                          const slDistance = (decision.stopLossPerc / 100) * currentPx;
                          const tpDistance = (decision.takeProfitPerc / 100) * currentPx;
                          
                          const support = currentPx - slDistance;
                          const resistance = currentPx + slDistance;

                          const condition: MarketCondition = {
                              symbol: coin.symbol,
                              price: currentPx,
                              type: decision.type,
                              score: 5,
                              isRanging: false, isBreakout: true, isRetestOrHold: false, isLiquidityGood: true, isMomentumHigh: true, isOrderBookClear: true,
                              support: decision.type === 'LONG' ? support : 0,
                              resistance: decision.type === 'SHORT' ? resistance : 0,
                              takerBuySellRatio: takerRatio,


                              atr: 0 
                          };
                          
                          if (settings.useSteelEngine) {
                              addLog(`⚡ الفولاذي TRIGGERED: ${decision.type} ${coin.symbol} (الاحتمالية: ${decision.confidence.toFixed(0)}%)`, 'success');
                              if ((decision as any).marketNarrative) {
                                  addLog(`💬 سياق الصفقة الفولاذية: ${(decision as any).marketNarrative}`, 'info');
                              }
                          } else if (settings.useCreativeEngine) {
                              addLog(`🎨 الابداعي TRIGGERED: ${decision.type} ${coin.symbol} (${decision.reason})`, 'success');
                              if ((decision as any).marketNarrative) {
                                  addLog(`💬 سياق الصفقة: ${(decision as any).marketNarrative}`, 'info');
                              }
                           } else {
                              addLog(`🚀 ENTRY TRIGGERED: ${decision.type} ${coin.symbol} (${decision.reason})`, 'success');
                           }
                          await sniper.executeQuantumTrade(condition, settings.useSteelEngine ? `STEEL_${decision.reason}` : settings.useCreativeEngine ? `CREATIVE_${decision.reason}` : `QUANTUM_${decision.reason}`, decision.takeProfitPerc, decision.stopLossPerc);
                          
                     } else {
                         rejectedCount++;
                         const label = settings.useSteelEngine ? 'Steel No Signal' : settings.useCreativeEngine ? 'Creative No Signal' : 'Quantum No Signal';
                          rejectionReasons[label] = (rejectionReasons[label] || 0) + 1;
                     }
                } catch(e: any) {
                     if (e.response && (e.response.status === 429 || e.response.status === 418)) {
                       console.log(`[BOT RUNNER] ⚠️ Rate limit hit. Pausing Loop...`);
                       await sleep(10000);
                     }
                }
            }
        } catch (e) {
            console.error("Error loading Quantum Engine", e);
        }

        // Summary log if no signals found
        if (!signalFoundInThisLoop && (globalContext as any).loopCount % 5 === 0) {
            addLog(`Scanning... ${targetsToCheck.length} coins evaluated. No valid scalp patterns yet.`, 'info');
        }
      } else if (botActive && watchlist.length === 0) {
         if ((globalContext as any).loopCount % 5 === 0) {
             addLog(`DIAGNOSTIC: Golden Watchlist is currently EMPTY. Market is too quiet.`, 'info');
         }
      }
    } catch (e) {
      console.error('[BOT RUNNER] Loop Error:', e);
    } finally {
      isRunning = false;
    }
  }, 3000); // Poll every 3s for tracking active trades and scanning targets
}
