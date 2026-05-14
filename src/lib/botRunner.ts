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
            throw apiError; // bubble to outer catch or simply return
          }
          const prices = pricesRes.data as any[];
          const pxMap = new Map<string, number>();
          prices.forEach(p => pxMap.set(p.symbol, parseFloat(p.price)));

          for (const t of activeTrades) {
            const currentPx = pxMap.get(t.symbol);
            if (currentPx) {
              let currentOI: number | undefined = undefined;
              let currentVol: number | undefined = undefined;

              // If Kinetic Engine is enabled, we need live Open Interest and Volume data
              if (sniper.getSettings().useKineticEngine) {
                 try {
                   const [oiRes, tkrRes, takerVRes] = await Promise.all([
                     axios.get(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${t.symbol}`, { timeout: 2000 }),
                     axios.get(`${BINANCE_FAPI}/fapi/v1/klines?symbol=${t.symbol}&interval=1m&limit=1`, { timeout: 2000 }),
                     axios.get(`${BINANCE_FAPI}/fapi/v1/futures/data/takerbuySellVol?symbol=${t.symbol}&period=5m&limit=1`, { timeout: 2000 })
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

              // 🧠 SMART EXIT LOGIC: Check multiple indicators dynamically (Refined against false pullbacks)
              // We only run this if trade is still open after manageTrades, and if smart exit is enabled
              if (sniper.getSettings().useSmartExit && (t.status === 'OPEN' || t.status === 'TP1_HIT')) {
                 try {
                   // Fetch minimal recent klines to evaluate momentum (5m is good for short/medium trades)
                   const klinesRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/klines?symbol=${t.symbol}&interval=5m&limit=35`, { timeout: 3000 });
                   const klines = klinesRes.data;
                   
                   let recentClose = parseFloat(klines[klines.length - 1][4]);
                   let previousClose = parseFloat(klines[klines.length - 2][4]);
                   let recentOpen = parseFloat(klines[klines.length - 1][1]);
                   let currentVol = parseFloat(klines[klines.length - 1][5]);
                   
                   // Helper to calculate RSI
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

                   // Calculate Current & Previous RSI to find the "Delta" (Momentum Shift)
                   const currentRsi = calcRSI(klines.length - 1, 14);
                   const previousRsi = calcRSI(klines.length - 2, 14);
                   const rsiDelta = currentRsi - previousRsi;

                   // Calculate EMA20 (More stable than EMA9)
                   const k20 = 2 / (20 + 1);
                   let ema20 = parseFloat(klines[0][4]); // Initial EMA
                   for (let i = 1; i < klines.length; i++) {
                       ema20 = (parseFloat(klines[i][4]) * k20) + (ema20 * (1 - k20));
                   }

                   // Calculate RVOL (Relative Volume) over last 15 periods
                   let sumVol = 0;
                   for (let i = klines.length - 16; i < klines.length - 1; i++) {
                       sumVol += parseFloat(klines[i][5]);
                   }
                   let avgVol = sumVol / 15;
                   let rvol = currentVol / avgVol;

                   // Determine severe reversal conditions
                   if (t.type === 'LONG') {
                      const isDumping = recentClose < recentOpen; // Red candle
                      const heavyDump = isDumping && rvol > 1.5; // Strong volume dump
                      const lostEma = recentClose < ema20;
                      const rsiPlunge = rsiDelta <= -15; // RSI collapsed 15+ points in 15 mins
                      const engulfing = recentClose < parseFloat(klines[klines.length - 3][3]); // Wiped out 3 candles info

                      // We only exit if there is strong CONFLUENCE of reversal, not just a pullback
                      if ((heavyDump && lostEma && engulfing) || (rsiPlunge && lostEma) || (heavyDump && rsiPlunge)) {
                          let reason = '🧠 SMART_EXIT: Critical Trend Reversal (Dumping)';
                          if (heavyDump && engulfing) reason = '🧠 SMART_EXIT: Bearish Engulfing with RVOL Spiked';
                          else if (rsiPlunge) reason = `🧠 SMART_EXIT: Sudden RSI Plunge (${rsiDelta.toFixed(1)})`;
                          
                          sniper.smartExit(t.symbol, currentPx, reason);
                      }
                   }
                   
                   if (t.type === 'SHORT') {
                      const isPumping = recentClose > recentOpen; // Green candle
                      const heavyPump = isPumping && rvol > 1.5; // Strong volume pump
                      const brokeEma = recentClose > ema20;
                      const rsiSurge = rsiDelta >= 15; // RSI surged 15+ points in 15 mins
                      const engulfing = recentClose > parseFloat(klines[klines.length - 3][2]); // Wiped out 3 candles highs

                      if ((heavyPump && brokeEma && engulfing) || (rsiSurge && brokeEma) || (heavyPump && rsiSurge)) {
                          let reason = '🧠 SMART_EXIT: Critical Trend Reversal (Pumping)';
                          if (heavyPump && engulfing) reason = '🧠 SMART_EXIT: Bullish Engulfing with RVOL Spiked';
                          else if (rsiSurge) reason = `🧠 SMART_EXIT: Sudden RSI Surge (+${rsiDelta.toFixed(1)})`;
                          
                          sniper.smartExit(t.symbol, currentPx, reason);
                      }
                   }
                 } catch(e) {
                   // Ignore rate limits here, silently back off
                 }
              }
            }
          }
        } catch (e: any) {
           if (e.response && (e.response.status === 429 || e.response.status === 418)) {
              console.log(`[BOT RUNNER] ⚠️ Rate limit hit checking prices. Pausing Loop...`);
              await sleep(10000); // Back off to save IP
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
      if (botActive && activeTrades.length < maxTrades && watchlist.length > 0) {
         // Throttle scanning to every 15 seconds (5 * 3000ms) to prevent Binance WAF 403 bans
         if ((globalContext as any).loopCount % 5 !== 0) {
             // Skip scanning on this loop iteration
         } else {
             // Increase search intensity in Beast Mode
             const scanCount = sniper.getSettings().beastMode ? 15 : 8;
             const targetsToCheck = [...watchlist].sort(() => 0.5 - Math.random()).slice(0, scanCount);

        let rejectedCount = 0;
        let rejectionReasons: Record<string, number> = {};

        for (const coin of targetsToCheck) {
          // Check if already in trade
          if (activeTrades.find(t => t.symbol === coin.symbol)) continue;

          // Instead of fetching all prices again, just fetch the specific klines
          try {
            const [klinesRes, htfRes] = await Promise.all([
               axios.get(`${BINANCE_FAPI}/fapi/v1/klines?symbol=${coin.symbol}&interval=5m&limit=100`, { timeout: 10000 }),
               axios.get(`${BINANCE_FAPI}/fapi/v1/klines?symbol=${coin.symbol}&interval=1h&limit=51`, { timeout: 10000 })
            ]);
            
            const klines = klinesRes.data;
            const htfKlines = htfRes.data;
            
            // 1. Calculate ATR (14 period) on 5m
            let trSum = 0;
            for (let i = klines.length - 15; i < klines.length - 1; i++) {
                const high = parseFloat(klines[i][2]);
                const low = parseFloat(klines[i][3]);
                const prevClose = parseFloat(klines[i-1][4]);
                const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
                trSum += tr;
            }
            const atr = trSum / 14;

            // 2. Higher Timeframe Trend (EMA 50 on 1H)
            const htfCloses = htfKlines.map((k: any) => parseFloat(k[4]));
            const k50 = 2 / (50 + 1);
            let htfEma50 = htfCloses[0];
            for (let i = 1; i < htfCloses.length; i++) {
                htfEma50 = (htfCloses[i] * k50) + (htfEma50 * (1 - k50));
            }
            const currentPx = parseFloat(klines[klines.length - 1][4]);
            const htfTrend = currentPx > htfEma50 ? 'LONG' : (currentPx < htfEma50 ? 'SHORT' : 'FLAT');

            // 3. Institutional Data: Open Interest, Order Book, Funding, and Market Pressure
            let oi = 0;
            let spreadPerc = 0;
            let fundingRate = 0;
            let takerRatio = 1.0;
            let currentRsi = 50;

            try {
               const [oiRes, bookRes, fundingRes, takerRes] = await Promise.all([
                 axios.get(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${coin.symbol}`, { timeout: 3000 }),
                 axios.get(`${BINANCE_FAPI}/fapi/v1/ticker/bookTicker?symbol=${coin.symbol}`, { timeout: 3000 }),
                 axios.get(`${BINANCE_FAPI}/fapi/v1/premiumIndex?symbol=${coin.symbol}`, { timeout: 3000 }),
                 axios.get(`${BINANCE_FAPI}/fapi/v1/futures/data/takerbuySellVol?symbol=${coin.symbol}&period=5m&limit=1`, { timeout: 3000 })
               ]);
               
               oi = parseFloat(oiRes.data.openInterest);
               const bid = parseFloat(bookRes.data.bidPrice);
               const ask = parseFloat(bookRes.data.askPrice);
               spreadPerc = ((ask - bid) / bid) * 100;
               fundingRate = parseFloat(fundingRes.data.lastFundingRate);
               
               if (takerRes.data && takerRes.data.length > 0) {
                 const buyVol = parseFloat(takerRes.data[0].buyVol);
                 const sellVol = parseFloat(takerRes.data[0].sellVol);
                 takerRatio = buyVol / sellVol;
               }

               // Quick RSI Calculation for filtering
               let gains = 0, losses = 0;
               for (let i = klines.length - 15; i < klines.length - 1; i++) {
                  if (i <= 0) continue;
                  const change = parseFloat(klines[i][4]) - parseFloat(klines[i-1][4]);
                  if (change > 0) gains += change;
                  else losses -= change;
               }
               const avgGain = gains / 14;
               const avgLoss = losses / 14;
               currentRsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

            } catch (e) {}

            // 4. V2V Analysis (Volume to Value)
            const lastK = klines[klines.length - 2];
            const kHigh = parseFloat(lastK[2]);
            const kLow = parseFloat(lastK[3]);
            const kVolUsd = parseFloat(lastK[7]); // Quote volume (USDT)
            const kRvol = coin.rvol;
            
            // If spread is too high (> 0.2%), whale manipulation is easier. Beast avoids it.
            const spreadPass = spreadPerc < 0.2;
            
            // If price moved > 1.2% but RVOL is low (< 0.8), it's a void (Ghost Move)
            const bodyPerc = Math.abs(kHigh - kLow) / kLow * 100;
            const isLiquidityVoid = bodyPerc > 1.2 && kRvol < 0.8;
            
            // --- BEAST TRAP LOGIC (Advanced) ---
            // A move is a TRAP if: Price moves aggressively but OI falls (unwinding)
            let isTrapTrade = false;
            let trapType: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';

            // Placeholder for OI change detection (would need historical OI in a real app, 
            // but we can simulate with current volume/price correlation)
            if (isLiquidityVoid && sniper.getSettings().beastMode) {
                const moveUp = parseFloat(klines[klines.length - 1][4]) > parseFloat(klines[klines.length - 1][1]);
                trapType = moveUp ? 'SHORT' : 'LONG'; 
                isTrapTrade = true;
            }

            // --- INSTITUTIONAL ENTRY LOGIC (EMA + MACD + Volume Displacement) ---
            const computeEMA = (data: number[], period: number) => {
               let k = 2 / (period + 1);
               let ema = data[0];
               for (let i = 1; i < data.length; i++) {
                 ema = data[i] * k + ema * (1 - k);
               }
               return ema;
            };

            const closes = klines.map((k: any) => parseFloat(k[4]));
            const ema9 = computeEMA(closes, 9);
            const ema21 = computeEMA(closes, 21);

            // Check displacement on the last fully closed 5m candle
            const lastClosed = klines[klines.length - 2];
            const lcOpen = parseFloat(lastClosed[1]);
            const lcClose = parseFloat(lastClosed[4]);
            const lcVol = parseFloat(lastClosed[5]);
            
            let sumVol = 0;
            let count = 0;
            for (let i = klines.length - 22; i < klines.length - 2; i++) {
               if(i >= 0) { sumVol += parseFloat(klines[i][5]); count++; }
            }
            const avgVol = count > 0 ? (sumVol / count) : 1;
            const rvolLocal = lcVol / avgVol;

            // Institutional candle: High volume + Strong close direction
            const isBullishDisplacement = lcClose > lcOpen && (isBeastMode ? rvolLocal >= 0.8 : rvolLocal >= 1.5);
            const isBearishDisplacement = lcClose < lcOpen && (isBeastMode ? rvolLocal >= 0.8 : rvolLocal >= 1.5);

            let type: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
            let isValidEntry = false;

            // 🧠 ADAPTIVE LOGIC: Decide whether to use TREND-FOLLOWING or RANGE-TRADING
            const isRangeBound = coin.trend === 'FLAT' || (currentRsi > 40 && currentRsi < 60 && rvolLocal < 1.0);
            
            if (isRangeBound && isBeastMode) {
               // 🏹 RANGE-TRADING (Chop Strategy): Buy low, Sell high
               if (currentRsi < 28 && lcClose > lcOpen) {
                   type = 'LONG';
                   isValidEntry = true;
                   addLog(`🏹 RANGE_SNIPE ${coin.symbol}: Oversold (RSI:${currentRsi.toFixed(1)}) - Trading back to mean`, 'info');
               } else if (currentRsi > 72 && lcClose < lcOpen) {
                   type = 'SHORT';
                   isValidEntry = true;
                   addLog(`🏹 RANGE_SNIPE ${coin.symbol}: Overbought (RSI:${currentRsi.toFixed(1)}) - Trading back to mean`, 'info');
               }
            }

            // To enter LONG: 9 EMA > 21 EMA, Price pulled back safely near EMA9 instead of chasing blindly, AND Institutional volume supports it
            if (!isValidEntry && isBeastMode) {
              // BEAST MODE: Extreme fast response, less care about EMA cross alignment
              if (lcClose > lcOpen) {
                  type = 'LONG';
                  isValidEntry = true;
              } else if (lcClose < lcOpen) {
                  type = 'SHORT';
                  isValidEntry = true;
              }
            } else if (!isValidEntry && ema9 > ema21 && isBullishDisplacement && coin.trend === 'LONG') {
                // Ensure we are not buying the absolute top by restricting distance from EMA9
                const distanceFromEma = ((currentPx - ema9) / ema9) * 100;
                if (distanceFromEma <= 1.5 && distanceFromEma >= -0.5) {
                   type = 'LONG';
                   isValidEntry = true;
                }
            } else if (ema9 < ema21 && isBearishDisplacement && coin.trend === 'SHORT') {
                const distanceFromEma = ((ema9 - currentPx) / ema9) * 100;
                if (distanceFromEma <= 1.5 && distanceFromEma >= -0.5) {
                   type = 'SHORT';
                   isValidEntry = true;
                }
            }

            const RequiredRvol = isBeastMode ? 0.8 : (sniper.getSettings().strictMinRvol ?? 1.5);
            // 🚀 BEAST UPGRADE: Relax score if HTF Trend is aligned, but be stricter if against it.
            let RequiredScore = isStrict ? (sniper.getSettings().strictMinScore ?? 6) : (isBeastMode ? 2 : 4);
            if (htfTrend === type && type !== 'NEUTRAL') {
                RequiredScore = Math.max(isBeastMode ? 1 : 4, RequiredScore - 1); // Confluence bonus!
            }

            const UseBTC = isStrict ? (sniper.getSettings().strictBtcAlignment !== false) : false;
            const UseRsi = isStrict ? (sniper.getSettings().strictRsiFilter !== false) : false;

            let strictPass = true;
            
            // Block Liquidity Voids or High Spread (Ghost moves are dangerous)
            if (!isBeastMode && (isLiquidityVoid || !spreadPass)) strictPass = false;

            // NEW: Anti-Whale Funding Filter
            if (isStrict) {
                if (type === 'LONG' && fundingRate > 0.05) strictPass = false;
                if (type === 'SHORT' && fundingRate < -0.05) strictPass = false;
            }

            if (isStrict && isValidEntry) {
                if (coin.rvol < RequiredRvol) strictPass = false;
                if (UseBTC) {
                    if (type === 'LONG' && btcTrend !== 'LONG') strictPass = false;
                    if (type === 'SHORT' && btcTrend !== 'SHORT') strictPass = false;
                }
                if (UseRsi) {
                    const rsiHi = sniper.getSettings().strictRsiHigh ?? 75;
                    const rsiLo = sniper.getSettings().strictRsiLow ?? 25;
                    if (type === 'LONG' && currentRsi > rsiHi) strictPass = false;
                    if (type === 'SHORT' && currentRsi < rsiLo) strictPass = false;
                }
            }

            if (isValidEntry && coin.score >= RequiredScore && strictPass) {
              const finalType = isTrapTrade ? trapType : type;
              if (finalType === 'NEUTRAL') continue;

              let finalScore = isTrapTrade ? 6 : coin.score;
              if (finalType === 'LONG' && takerRatio > 1.5) finalScore += 0.5;
              if (finalType === 'SHORT' && takerRatio < 0.6) finalScore += 0.5;

              const condition: MarketCondition = {
                symbol: coin.symbol,
                price: currentPx,
                isRanging: false,
                isBreakout: true, 
                isRetestOrHold: false, 
                isLiquidityGood: true,
                isMomentumHigh: true,
                isOrderBookClear: true,
                score: finalScore, 
                type: finalType,
                support: finalType === 'LONG' ? ema21 : currentPx * 0.95,
                resistance: finalType === 'SHORT' ? ema21 : currentPx * 1.05,
                atr: atr,
                htfTrend: htfTrend,
                oi: oi,
                spread: spreadPerc,
                fundingRate: fundingRate,
                takerBuySellRatio: takerRatio
              };
              
              addLog(`🎯 SIGNAL ${coin.symbol}: Score ${finalScore.toFixed(1)} - Evaluating...`, 'success');
              sniper.evaluateSignal(condition, klines, htfKlines, globalContext);
              coin.decision = condition.decision;
              
              if (condition.decision && condition.decision.action !== 'ATTACK') {
                  rejectedCount++;
                  rejectionReasons[condition.decision.reason || 'UNKNOWN'] = (rejectionReasons[condition.decision.reason || 'UNKNOWN'] || 0) + 1;
              }
            } else {
                rejectedCount++;
                let r = 'Criteria Not Met';
                if (!isValidEntry) r = 'Invalid Entry Pattern';
                else if (coin.score < RequiredScore) r = 'Low Initial Score';
                else if (!strictPass) r = 'Strict Filter Block';
                rejectionReasons[r] = (rejectionReasons[r] || 0) + 1;
            }

          } catch (e: any) {
             if (e.response && (e.response.status === 429 || e.response.status === 418)) {
               console.log(`[BOT RUNNER] ⚠️ Rate limit hit checking 15m. Pausing Loop...`);
               await sleep(10000);
             }
          }
        }

        // Summary log every 10 loops
        if ((globalContext as any).loopCount % 10 === 0 && rejectedCount > 0) {
            const top = Object.entries(rejectionReasons).sort((a,b) => b[1]-a[1])[0];
            addLog(`DIAGNOSTIC: Scanned ${targetsToCheck.length} coins. Top Reject: ${top?.[0]}`, 'info');
        }
        
         } // End of throttled else block
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
