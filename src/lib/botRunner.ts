import axios from 'axios';
import { sniper } from './sniperEngine.js';
import { getWatchlist } from './binanceScanner.js';
import { MarketCondition, GlobalContext } from '../types/trading.js';

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

      // 1. GLOBAL PANIC DETECTION & CONTEXT (The Cloud Layer)
      let isGlobalPanic = false;
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

        if (settings.isNightmareMode && settings.marketPanicThreshold) {
            const drops = tickers.filter(t => parseFloat(t.priceChangePercent) < -settings.marketPanicThreshold!).length;
            if (drops > 80) { // Slightly more sensitive
                isGlobalPanic = true;
                addLog(`MARKET PANIC: ${drops} coins dropping!`, 'warn');
                console.warn(`[NIGHTMARE 💀] MARKET PANIC DETECTED! ${drops} symbols in freefall.`);
            }
        }
      } catch (e) {
         addLog(`Global Context Error: ${e.message}`, 'error');
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

              // 1. KINETIC DATA FETCHING
              if (settings.useKineticEngine) {
                 try {
                   const [oiRes, tkrRes, takerVRes] = await Promise.all([
                     axios.get(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${t.symbol}`, { timeout: 3000 }),
                     axios.get(`${BINANCE_FAPI}/fapi/v1/klines?symbol=${t.symbol}&interval=1m&limit=1`, { timeout: 3000 }),
                     axios.get(`${BINANCE_FAPI}/fapi/v1/futures/data/takerbuySellVol?symbol=${t.symbol}&period=5m&limit=1`, { timeout: 3000 })
                   ]);
                   currentOI = parseFloat(oiRes.data.openInterest);
                   currentVol = parseFloat(tkrRes.data[0][5]);
                   
                   let currentTakerRatio = 1.0;
                   if (takerVRes.data && takerVRes.data.length > 0) {
                      currentTakerRatio = parseFloat(takerVRes.data[0].buyVol) / parseFloat(takerVRes.data[0].sellVol);
                   }
                   
                   sniper.manageTrades(t.symbol, currentPx, currentOI, currentVol, currentTakerRatio, { emaTrend: currentPx > parseFloat(tkrRes.data[0][4]) ? 'LONG' : 'SHORT' });
                 } catch (e) {
                   sniper.manageTrades(t.symbol, currentPx, currentOI, currentVol, undefined, { emaTrend: currentPx > t.entryPrice ? 'LONG' : 'SHORT' });
                 }
              } else {
                sniper.manageTrades(t.symbol, currentPx, undefined, undefined, undefined, { emaTrend: currentPx > t.entryPrice ? 'LONG' : 'SHORT' });
              }

              // 2. SMART & WISE EXIT LOGIC
              const useSmart = settings.useSmartExit;
              const useWise = settings.useWiseExit;
              
              if ((useSmart || useWise) && (t.status === 'OPEN' || t.status === 'TP1_HIT')) {
                 try {
                   const klinesRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/klines?symbol=${t.symbol}&interval=5m&limit=35`, { timeout: 4000 });
                   const klines = klinesRes.data;
                   
                   if (useWise) {
                      sniper.wiseExit(t.symbol, currentPx, klines);
                      // Check if still open
                      if (!sniper.getActiveTrades().find(at => at.symbol === t.symbol)) return;
                   }

                   if (useSmart) {
                      let recentClose = parseFloat(klines[klines.length - 1][4]);
                      let recentOpen = parseFloat(klines[klines.length - 1][1]);
                      let currentVol = parseFloat(klines[klines.length - 1][5]);
                      
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

                      const currentRsi = calcRSI(klines.length - 1, 14);
                      const previousRsi = calcRSI(klines.length - 2, 14);
                      const rsiDelta = currentRsi - previousRsi;

                      const k20 = 2 / (20 + 1);
                      let ema20 = parseFloat(klines[0][4]); 
                      for (let i = 1; i < klines.length; i++) {
                          ema20 = (parseFloat(klines[i][4]) * k20) + (ema20 * (1 - k20));
                      }

                      let sumVol = 0;
                      for (let i = klines.length - 16; i < klines.length - 1; i++) {
                          sumVol += parseFloat(klines[i][5]);
                      }
                      let avgVol = sumVol / 15;
                      let rvol = currentVol / avgVol;

                      if (t.type === 'LONG') {
                         const isDumping = recentClose < recentOpen; 
                         const heavyDump = isDumping && rvol > 1.5; 
                         const lostEma = recentClose < ema20;
                         const rsiPlunge = rsiDelta <= -15; 
                         const engulfing = recentClose < parseFloat(klines[klines.length - 3][3]); 

                         if ((heavyDump && lostEma && engulfing) || (rsiPlunge && lostEma) || (heavyDump && rsiPlunge)) {
                             sniper.smartExit(t.symbol, currentPx, `🧠 SMART_EXIT: Multi-Signal Reversal`);
                         }
                      }
                      
                      if (t.type === 'SHORT') {
                         const isPumping = recentClose > recentOpen; 
                         const heavyPump = isPumping && rvol > 1.5; 
                         const brokeEma = recentClose > ema20;
                         const rsiSurge = rsiDelta >= 15; 
                         const engulfing = recentClose > parseFloat(klines[klines.length - 3][2]);

                         if ((heavyPump && brokeEma && engulfing) || (rsiSurge && brokeEma) || (heavyPump && rsiSurge)) {
                             sniper.smartExit(t.symbol, currentPx, `🧠 SMART_EXIT: Multi-Signal Reversal`);
                         }
                      }
                   }
                 } catch(e) {}
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
        // High Intensity Scanning for Quick Scalping
        const scanCount = 40; 
        const targetsToCheck = [...watchlist].sort(() => 0.5 - Math.random()).slice(0, scanCount);

        let rejectedCount = 0;
        let signalFoundInThisLoop = false;
        let rejectionReasons: Record<string, number> = {};

        // Only use Quantum Scalper now
        try {
            const { QuantumScalpEngine } = await import('./engine/QuantumScalpEngine.js');
            const quantum = new QuantumScalpEngine();

            for (const coin of targetsToCheck) {
                if (activeTrades.find(t => t.symbol === coin.symbol)) continue;

                try {
                     // Try to get klines first
                     const klinesRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/klines?symbol=${coin.symbol}&interval=1m&limit=60`, { timeout: 4000 });
                     const klines = klinesRes.data;

                     // Taker ratio fallback: Try to get it but don't fail if endpoint is dead
                     let takerRatio = 1.0;
                     try {
                        const takerRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/futures/data/takerbuySellVol?symbol=${coin.symbol}&period=5m&limit=1`, { timeout: 3000 });
                        if (takerRes.data && takerRes.data.length > 0) {
                            const bv = parseFloat(takerRes.data[0].buyVol);
                            const sv = parseFloat(takerRes.data[0].sellVol);
                            if (sv > 0) takerRatio = bv / sv;
                        }
                     } catch (e) {
                         // Default to 1.0 if Binance Taker endpoint fails
                     }

                     const settings = sniper.getSettings();
                     const decision = quantum.analyze(klines, takerRatio, settings);

                     if (decision.shouldEnter) {
                          signalFoundInThisLoop = true;
                          const currentPx = parseFloat(klines[klines.length - 1][4]);

                          // 🔄 REVERSE MODE LOGIC
                          let finalType = decision.type;
                          let finalReason = decision.reason;
                          let isReversed = false;
                          
                          if (settings.reverseMode) {
                              isReversed = true;
                              finalType = decision.type === 'LONG' ? 'SHORT' : 'LONG';
                              finalReason = `${decision.reason} [REVERSED]`;
                              addLog(`🔄 REVERSE ACTIVE: Converting ${decision.type} signal to ${finalType} execution.`, 'warn');
                          }
                          
                          const condition: MarketCondition = {
                              symbol: coin.symbol,
                              price: currentPx,
                              type: finalType,
                              score: 5,
                              isRanging: false, isBreakout: true, isRetestOrHold: false, isLiquidityGood: true, isMomentumHigh: true, isOrderBookClear: true,
                              support: decision.type === 'LONG' ? (currentPx * (1 - decision.stopLossPerc/100)) : 0,
                              resistance: decision.type === 'SHORT' ? (currentPx * (1 + decision.stopLossPerc/100)) : 0,
                              takerBuySellRatio: takerRatio,
                              atr: 0 
                          };
                          
                          addLog(`🚀 ENTRY TRIGGERED: ${finalType} ${coin.symbol} (${finalReason})`, 'success');
                          // Pass original type to engine for exit logic mapping
                          sniper.executeQuantumTrade(condition, `QUANTUM_${finalReason}`, decision.takeProfitPerc, decision.stopLossPerc, decision.type);
                          
                     } else {
                         rejectedCount++;
                         rejectionReasons['Quantum No Signal'] = (rejectionReasons['Quantum No Signal'] || 0) + 1;
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
