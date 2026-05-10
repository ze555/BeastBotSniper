import axios from 'axios';
import { sniper } from './sniperEngine.js';
import { getWatchlist } from './binanceScanner.js';
import { MarketCondition } from '../types/trading.js';

const BINANCE_FAPI = 'https://fapi.binance.com';
let isRunning = false;
let botActive = false; // State to control if hunting is active

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function setBotActive(state: boolean) {
  botActive = state;
  console.log(`[BOT RUNNER] Hunting Mode is now: ${botActive ? 'ACTIVE 🟢' : 'PAUSED 🔴'}`);
}

export function isBotActive(): boolean {
  return botActive;
}

export async function runTradeLoop() {
  setInterval(async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      const activeTrades = sniper.getActiveTrades();

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
                   const [oiRes, tkrRes] = await Promise.all([
                     axios.get(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${t.symbol}`, { timeout: 2000 }),
                     axios.get(`${BINANCE_FAPI}/fapi/v1/klines?symbol=${t.symbol}&interval=1m&limit=1`, { timeout: 2000 })
                   ]);
                   currentOI = parseFloat(oiRes.data.openInterest);
                   currentVol = parseFloat(tkrRes.data[0][5]);
                 } catch (e) {
                   // Ignore minor fetch errors for OI/Vol, it will retry next tick
                 }
              }

              sniper.manageTrades(t.symbol, currentPx, currentOI, currentVol);

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

      // ONLY hunt for new targets if bot is active
      if (!botActive) {
         isRunning = false;
         return;
      }

      const watchlist = getWatchlist();
      const maxTrades = sniper.getSettings().maxConcurrentTrades;
      const isStrict = sniper.getSettings().strictMode;

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
        // To save API limits while still being realtime, check random 5 coins from the watchlist per tick
        const targetsToCheck = [...watchlist].sort(() => 0.5 - Math.random()).slice(0, 5);

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
            const isBullishDisplacement = lcClose > lcOpen && rvolLocal >= 1.5;
            const isBearishDisplacement = lcClose < lcOpen && rvolLocal >= 1.5;

            let type: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
            let isValidEntry = false;

            // To enter LONG: 9 EMA > 21 EMA, Price pulled back safely near EMA9 instead of chasing blindly, AND Institutional volume supports it
            if (ema9 > ema21 && isBullishDisplacement && coin.trend === 'LONG') {
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

            const RequiredRvol = sniper.getSettings().strictMinRvol ?? 3.0;
            const RequiredScore = isStrict ? (sniper.getSettings().strictMinScore ?? 6) : 5;
            const UseBTC = isStrict ? (sniper.getSettings().strictBtcAlignment !== false) : false;
            const UseRsi = isStrict ? (sniper.getSettings().strictRsiFilter !== false) : false;

            let strictPass = true;

            if (isStrict && isValidEntry) {
                // Filter 1: Strict Volume (RVOL >= dynamic)
                if (coin.rvol < RequiredRvol) strictPass = false;

                // Filter 3: BTC Align (if enabled)
                if (UseBTC) {
                    if (type === 'LONG' && btcTrend !== 'LONG') strictPass = false;
                    if (type === 'SHORT' && btcTrend !== 'SHORT') strictPass = false;
                }

                // Filter 5: Overbought/Oversold Rejection (RSI Filter - if enabled)
                if (UseRsi) {
                    let gains = 0, losses = 0;
                    for (let i = klines.length - 15; i < klines.length - 1; i++) {
                       if (i <= 0) continue;
                       const change = parseFloat(klines[i][4]) - parseFloat(klines[i-1][4]);
                       if (change > 0) gains += change;
                       else losses -= change;
                    }
                    const avgGain = gains / 14;
                    const avgLoss = losses / 14;
                    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

                    const rsiHi = sniper.getSettings().strictRsiHigh ?? 75;
                    const rsiLo = sniper.getSettings().strictRsiLow ?? 25;

                    if (type === 'LONG' && rsi > rsiHi) strictPass = false; // Overbought Reject
                    if (type === 'SHORT' && rsi < rsiLo) strictPass = false; // Oversold Reject
                }
            }

            if (isValidEntry && coin.score >= RequiredScore && strictPass) {
              // Construct strictly passing MarketCondition
              const condition: MarketCondition = {
                symbol: coin.symbol,
                price: currentPx,
                isRanging: false,
                isBreakout: true, 
                isRetestOrHold: false, 
                isLiquidityGood: true,
                isMomentumHigh: true,
                isOrderBookClear: true,
                score: coin.score, 
                type: type,
                support: type === 'LONG' ? ema21 : currentPx * 0.95,
                resistance: type === 'SHORT' ? ema21 : currentPx * 1.05,
                atr: atr,
                htfTrend: htfTrend
              };
              
              // Allow the Sniper Engine to fire mathematically
              sniper.evaluateSignal(condition);
            }

          } catch (e: any) {
             if (e.response && (e.response.status === 429 || e.response.status === 418)) {
               console.log(`[BOT RUNNER] ⚠️ Rate limit hit checking 15m. Pausing Loop...`);
               await sleep(10000);
             }
            // Ignore API limit errors silently otherwise
          }
        }
      }
    } catch (e) {
      console.error('[BOT RUNNER] Loop Error:', e);
    } finally {
      isRunning = false;
    }
  }, 3000); // Poll every 3s for tracking active trades and scanning targets
}
