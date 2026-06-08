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
const baseOpenInterestMap = new Map<string, { value: number; timestamp: number }>();

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
                if (klines && klines.length > 1) {
                  const completedK = klines[klines.length - 2];
                  currentTakerRatio = calculateTakerRatio(completedK);
                  currentVol = parseFloat(klines[klines.length - 1][5]); // Still use latest vol for current volume
                } else if (klines && klines.length > 0) {
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
                let currentAdxRising = false;
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
                  
                  const { RegimeEngine } = await import('./engine/RegimeEngine.js');
                  const completedKlines = klines.length > 2 ? klines.slice(0, -1) : klines;
                  currentAdx = RegimeEngine.calculateADX(completedKlines);
                  const prevAdx = RegimeEngine.calculateADX(completedKlines.slice(0, -1));
                  currentAdxRising = currentAdx > prevAdx;
                }

                // Unified Manage Trades call
                await sniper.manageTrades(t.symbol, currentPx, currentOI, currentVol, currentTakerRatio, { 
                  emaTrend: klines && klines.length > 0 && currentPx > parseFloat(klines[klines.length - 1][4]) ? 'LONG' : 'SHORT',
                  rsi: currentRsi,
                  adx: currentAdx,
                  isAdxRising: currentAdxRising,
                  klines: klines,
                  fundingRate: currentFundingRate
                });

                // 2. SMART & WISE EXIT LOGIC (Reusing fetched data)
                if (settings.useWiseExit && klines && klines.length > 0) {
                  await sniper.wiseExit(t.symbol, currentPx, klines);
                  if (!sniper.getActiveTrades().find(at => at.symbol === t.symbol)) return;
                }

                // 🤖 3. GROQ AI EVALUATION (Snapshots every 15s, Groq Evaluation every 60s)
                if (settings.useGroqAI) {
                   const lastSnapshot = (t as any).lastSnapshot || 0;
                   if (Date.now() - lastSnapshot > 15000) { // 15 seconds
                      const report = {
                         time: new Date().toISOString(),
                         symbol: t.symbol,
                         type: t.type,
                         entryPrice: t.entryPrice,
                         currentPrice: currentPx,
                         pnlPerc: t.type === 'LONG' ? ((currentPx - t.entryPrice)/t.entryPrice)*100 : ((t.entryPrice - currentPx)/t.entryPrice)*100,
                         klinesSummary: klines.slice(-5).map((k: any) => ({ open: k[1], high: k[2], low: k[3], close: k[4], vol: k[5] })),
                         rsi: currentRsi,
                         adx: currentAdx,
                         isAdxRising: currentAdxRising,
                         takerRatio: currentTakerRatio,
                         fundingRate: currentFundingRate,
                         openInterest: currentOI
                      };
                      
                      if (!t.reportHistory) t.reportHistory = [];
                      t.reportHistory.push({ ...report, klinesSummary: undefined }); // store lightweight version for history
                      if (t.reportHistory.length > 120) t.reportHistory.shift(); // Keep up to 30 minutes of 15s interval history
                      (t as any).lastSnapshot = Date.now();

                      const lastGroqCheck = (t as any).lastGroqCheck || 0;
                      if (Date.now() - lastGroqCheck > 60000) { // 60 seconds
                         try {
                            const { askGroqDecision } = await import('./groq.js');
                            const groqDecision = await askGroqDecision({ 
                               message: `Evaluate trade ${t.symbol}. We have ${t.reportHistory.length * 15} seconds of historical snapshots.`,
                               currentReport: report, 
                               historicalReports: t.reportHistory,
                               context: globalContext 
                            });
                            (t as any).lastGroqCheck = Date.now();
                            
                            addLog(`🤖 تقرير Groq للعملة ${t.symbol}: ${groqDecision.decision} | الثقة: ${groqDecision.confidence}% | السبب: ${groqDecision.reason}`, groqDecision.decision === 'EXIT' ? 'warn' : 'info');

                            // If Groq says EXIT with high confidence, close the trade.
                            if (groqDecision.decision === 'EXIT' && groqDecision.confidence > 75) {
                               await sniper.closeTrade(t.symbol, currentPx, 'GROQ_AI_DECISION');
                               addLog(`🛑 اغلاق ذكي للعملة ${t.symbol} بناءً على قرار Groq!`, 'warn');
                               return; // Trade closed
                            }
                         } catch (err: any) {
                            console.error(`[BOT RUNNER] Groq AI Check Failed for ${t.symbol}:`, err.message);
                            // Don't fail the whole loop, just skip Groq for now
                         }
                      }
                   }
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

                     // Calculate Taker Ratio safely from the last completed candle of klines
                     let takerRatio = 1.0;
                     if (klines && klines.length > 1) {
                         const completedK = klines[klines.length - 2]; // Last completed candle
                         takerRatio = calculateTakerRatio(completedK);
                     } else if (klines && klines.length === 1) {
                         takerRatio = calculateTakerRatio(klines[0]);
                     }

                     // --- 🦁 BEAST AUDITOR LIVE METRICS CALCULATION ---
                     const currentPx = parseFloat(klines[klines.length - 1][4]);
                      // Use only completed candles for robust technical indicator calculations
                     const completedKlines = klines && klines.length > 2 ? klines.slice(0, -1) : klines;
                     
                      let currentEma50 = currentPx;
                      if (completedKlines && completedKlines.length >= 50) {
                          const period = 50;
                          const k = 2 / (period + 1);
                          let sum = 0;
                          for (let i = 0; i < period; i++) {
                              sum += parseFloat(completedKlines[i][4]);
                          }
                          currentEma50 = sum / period;
                          for (let i = period; i < completedKlines.length; i++) {
                              currentEma50 = (parseFloat(completedKlines[i][4]) - currentEma50) * k + currentEma50;
                          }
                      }

                     const { RegimeEngine } = await import('./engine/RegimeEngine.js');
                     const adxCurrent = RegimeEngine.calculateADX(completedKlines);
                     const adxPrev = RegimeEngine.calculateADX(completedKlines.slice(0, -1));
                     const isAdxRising = adxCurrent > adxPrev;

                     let currentRsi = 50;
                     if (completedKlines && completedKlines.length >= 14) {
                         const calcRSI = (endIdx: number, period: number = 14) => {
                             if (completedKlines.length < period + 1) return 50;
                             let gains = 0, losses = 0;
                             for (let i = endIdx - period + 1; i <= endIdx; i++) {
                                 const change = parseFloat(completedKlines[i][4]) - parseFloat(completedKlines[i-1][4]);
                                 if (change > 0) gains += change;
                                 else losses -= change;
                             }
                             let avgGain = gains / period;
                             let avgLoss = losses / period;
                             return avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
                         };
                         currentRsi = calcRSI(completedKlines.length - 1, 14);
                     }

                                           let liveRvol = coin.rvol || 1.0;
                      if (completedKlines && completedKlines.length >= 20) {
                          let sumVol = 0;
                          for (let i = 0; i < completedKlines.length - 1; i++) {
                              sumVol += parseFloat(completedKlines[i][5]);
                          }
                          const avgVol = sumVol / (completedKlines.length - 1);
                          const lastCompletedVol = parseFloat(completedKlines[completedKlines.length - 1][5]);
                          if (avgVol > 0) {
                              liveRvol = lastCompletedVol / avgVol;
                          }
                      }

                      const now = Date.now();
                      let currentOI = 0;
                      let oiChangeVal = 0;
                      try {
                          const { default: axios } = await import('axios');
                          const oiRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${coin.symbol}`, { timeout: 3000 });
                          if (oiRes.data && oiRes.data.openInterest) {
                              currentOI = parseFloat(oiRes.data.openInterest);
                              
                              let baseOI = baseOpenInterestMap.get(coin.symbol);
                              // Refetch history only if not set or extremely old (older than 4 hours)
                              if (!baseOI || (now - baseOI.timestamp > 4 * 60 * 60 * 1000)) {
                                  try {
                                      // Get OI from 1 hour ago for baseline change
                                      const oiHistRes = await axios.get(`${BINANCE_FAPI}/futures/data/openInterestHist?symbol=${coin.symbol}&period=15m&limit=5`, { timeout: 3000 });
                                      if (Array.isArray(oiHistRes.data) && oiHistRes.data.length > 0) {
                                          const pastOI = parseFloat(oiHistRes.data[0].sumOpenInterest);
                                          baseOpenInterestMap.set(coin.symbol, { value: pastOI, timestamp: now });
                                          baseOI = { value: pastOI, timestamp: now };
                                      } else {
                                          baseOpenInterestMap.set(coin.symbol, { value: currentOI, timestamp: now });
                                          baseOI = { value: currentOI, timestamp: now };
                                      }
                                  } catch (error) {
                                      baseOpenInterestMap.set(coin.symbol, { value: currentOI, timestamp: now });
                                      baseOI = { value: currentOI, timestamp: now };
                                  }
                              }
                              
                              oiChangeVal = baseOI.value > 0 ? ((currentOI - baseOI.value) / baseOI.value) * 100 : 0;
                          }
                      } catch (e) {}

                     // Save live beast auditor metrics for UI
                     (coin as any).beastMetrics = {
                         rvol: liveRvol,
                         takerRatio: takerRatio,
                         oi: currentOI,
                         oiChange: oiChangeVal,
                         adx: adxCurrent,
                         adxPrev: adxPrev,
                         ema50: currentEma50,
                         isAdxRising: isAdxRising,
                         lastUpdated: Date.now()
                     };

                     if (settings.useBeastAuditorEngine) {
                                                   const liveRvolVal = (coin as any).beastMetrics?.rvol ?? coin.rvol ?? 1.0;
                          const isLongMatch = liveRvolVal >= 1.15 && takerRatio >= 1.05 && Math.abs(oiChangeVal) >= 0.5 && adxCurrent >= 20 && isAdxRising;
                         const isShortMatch = liveRvolVal >= 1.15 && takerRatio <= 0.95 && Math.abs(oiChangeVal) >= 0.5 && adxCurrent >= 20 && isAdxRising;

                         (coin as any).decision = {
                             regime: 'ANY',
                             bias: isLongMatch ? 'LONG' : (isShortMatch ? 'SHORT' : 'NEUTRAL'),
                             trap: 'NONE',
                             confidence: (isLongMatch || isShortMatch) ? 1.0 : 0.0,
                             action: (isLongMatch || isShortMatch) ? 'ATTACK' : 'WAIT',
                             reason: isLongMatch ? 'LONG_BEAST_AUDITOR_MATCH' : (isShortMatch ? 'SHORT_BEAST_AUDITOR_MATCH' : 'BEAST_WAITING_FOR_TRIGGER')
                         };

                         if (isLongMatch || isShortMatch) {
                             signalFoundInThisLoop = true;
                             const biasType = isLongMatch ? 'LONG' : 'SHORT';
                             
                             const slPerc = settings.strictMaxRisk || 1.5;
                             const tpPerc = settings.strictFastBreakevenPerc || 3.5;
                             const slDistance = (slPerc / 100) * currentPx;
                             const support = currentPx - slDistance;
                             const resistance = currentPx + slDistance;

                             const condition: MarketCondition = {
                                 symbol: coin.symbol,
                                 price: currentPx,
                                 type: biasType,
                                 score: 5,
                                 isRanging: false, isBreakout: true, isRetestOrHold: false, isLiquidityGood: true, isMomentumHigh: true, isOrderBookClear: true,
                                 support: biasType === 'LONG' ? support : 0,
                                 resistance: biasType === 'SHORT' ? resistance : 0,
                                 takerBuySellRatio: takerRatio,
                                 atr: 0
                             };

                             addLog(`⚡ مدقق الوحش TRIGGERED: ${biasType} ${coin.symbol} (مستوفي 5 شروط بنسبة 100%)`, 'success');
                             await sniper.executeQuantumTrade(condition, `BEAST_AUDITOR_${biasType}`, tpPerc, slPerc);
                         } else {
                             rejectedCount++;
                             const label = 'Beast No Signal';
                             rejectionReasons[label] = (rejectionReasons[label] || 0) + 1;
                         }
                         
                         // We do not 'continue' here so that if useTawleefaEngine is also on, it can populate the Live Diagnostics UI.
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
                             fundingRate: parseFloat((coin as any).fundingRate || 0),
                             adx: adxCurrent,
                             rsi: currentRsi,
                             ema50: currentEma50,
                             isAdxRising: isAdxRising
                         };

                         try {
                             const oiRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${coin.symbol}`, { timeout: 3000 });
                             if (oiRes.data && oiRes.data.openInterest) {
                                 const currentOI = parseFloat(oiRes.data.openInterest);
                                 condition.oi = currentOI;
                                 const now = Date.now();
                                 let baseOI = baseOpenInterestMap.get(coin.symbol);
                                 if (!baseOI || now - baseOI.timestamp > 4 * 60 * 60 * 1000) {
                                     try {
                                         const oiHistRes = await axios.get(`${BINANCE_FAPI}/futures/data/openInterestHist?symbol=${coin.symbol}&period=1d&limit=2`, { timeout: 3000 });
                                         if (Array.isArray(oiHistRes.data) && oiHistRes.data.length > 0) {
                                             const pastOI = parseFloat(oiHistRes.data[0].sumOpenInterest);
                                             baseOpenInterestMap.set(coin.symbol, { value: pastOI, timestamp: now });
                                             baseOI = { value: pastOI, timestamp: now };
                                         }
                                     } catch (e) {}
                                 }
                                 if (!baseOI) {
                                     baseOpenInterestMap.set(coin.symbol, { value: currentOI, timestamp: now });
                                     baseOI = { value: currentOI, timestamp: now };
                                 }
                                 if (baseOI && baseOI.value > 0) {
                                     condition.oiChange24h = ((currentOI - baseOI.value) / baseOI.value) * 100;
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
                          
                          let proceedWithTrade = true;

                          if (settings.useGroqAI) {
                             try {
                                const { askGroqDecision } = await import('./groq.js');
                                const report = {
                                    symbol: coin.symbol,
                                    proposedAction: decision.type,
                                    currentPrice: currentPx,
                                    klinesSummary: klines.slice(-5).map((k: any) => ({ open: k[1], high: k[2], low: k[3], close: k[4], vol: k[5] })),
                                    takerRatio: takerRatio,
                                    engineReason: decision.reason
                                };
                                const groqDecision = await askGroqDecision({ phase: "ENTRY_CHECK", data: report });
                                
                                if (groqDecision.decision === 'EXIT') {
                                   proceedWithTrade = false;
                                   addLog(`🤖 Groq رفض صفقة ${decision.type} للعملة ${coin.symbol} (الثقة: ${groqDecision.confidence}% - ${groqDecision.reason})`, 'warn');
                                } else {
                                   addLog(`🤖 Groq وافق على الدخول للعملة ${coin.symbol} بنسبة ثقة ${groqDecision.confidence}%`, 'info');
                                }
                             } catch (e: any) {
                                console.log('[BOT RUNNER] Groq Entry Check Failed:', e.message);
                             }
                          }

                          if (proceedWithTrade) {
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
                          }
                          
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
