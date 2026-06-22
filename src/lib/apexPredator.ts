import axios from "axios";
import { calcEMA, calcATR, calcADX, calcMACD, calcRSI, calcSupertrend } from "./indicators.js";

const BINANCE_FAPI = "https://fapi.binance.com";
let watcherInterval: NodeJS.Timeout | null = null;
let activeTrades: any[] = [];
let todaysStats = { count: 0, wins: 0, losses: 0, pnl: 0, sumR: 0 };
let botActive = false;
let isLoopRunning = false;

// ═══ CONFIGURATION ═══
let WATCHLIST: string[] = [
   "BTCUSDT", "ETHUSDT", "SOLUSDT", "AVAXUSDT",
   "LINKUSDT", "INJUSDT", "ARBUSDT", "CRVUSDT",
   "AAVEUSDT", "OPUSDT"
];
let currentBatchIndex = 0;
let lastWatchlistUpdate = 0;

const MIN_ENTRY_SCORE = 6.0;
const MIN_RR_REQUIRED = 2.5;
const MAX_OPEN_TRADES = 3;
const MAX_DAILY_LOSS = 0.040;
const BEST_HOURS_UTC = [12, 13, 14, 15, 16, 17, 18, 19, 20];
const AVOID_HOURS = [22, 23, 0, 1, 2, 3, 4, 5, 6, 7];

let virtualBalance = 10000;
let initialVirtualBalance = 10000;
let maxOpenTradesConfig = 3;

// New Config
let haltProfitEnabled = false;
let haltProfitTarget = 500;
let haltLossEnabled = false;
let haltLossTarget = 200;
let smartBtcHoldEnabled = true;
let btcVolThresholdStr = "0.80";

const logs: any[] = [];
let closedTrades: any[] = [];

let apexPredatorStats: any = {
  totalEvaluations: 0,
  totalLongScanned: 0,
  totalShortScanned: 0,
  acceptedLongs: 0,
  acceptedShorts: 0,
  rules: {
    market_context: { passed: 0, failed: 0 },
    whale_reader: { passed: 0, failed: 0 },
    price_structure: { passed: 0, failed: 0 },
    momentum_ignition: { passed: 0, failed: 0 },
  }
};

export function updateConfig(balance: number, maxTrades: number, opts?: any) {
  initialVirtualBalance = balance;
  if (virtualBalance === 10000 && balance !== 10000 && closedTrades.length === 0) {
     virtualBalance = balance;
  }
  maxOpenTradesConfig = maxTrades;
  if (opts) {
      if (opts.haltProfitEnabled !== undefined) haltProfitEnabled = opts.haltProfitEnabled;
      if (opts.haltProfitTarget !== undefined) haltProfitTarget = opts.haltProfitTarget;
      if (opts.haltLossEnabled !== undefined) haltLossEnabled = opts.haltLossEnabled;
      if (opts.haltLossTarget !== undefined) haltLossTarget = opts.haltLossTarget;
      if (opts.smartBtcHoldEnabled !== undefined) smartBtcHoldEnabled = opts.smartBtcHoldEnabled;
      if (opts.btcVolThresholdStr !== undefined) btcVolThresholdStr = opts.btcVolThresholdStr;
  }
}

export function addLog(msg: string, type: 'info'|'warn'|'success'|'error' = 'info') {
   console.log(`[APEX] ${msg}`);
   logs.unshift({ time: new Date().toISOString(), msg, type });
   if (logs.length > 200) logs.pop();
}

export function getLogs() { return logs; }
export function getTrades() { return activeTrades; }
export function getClosedTrades() { return closedTrades; }
export function getStats() { 
  return { 
    ...apexPredatorStats,
    balance: virtualBalance,
    initialBalance: initialVirtualBalance,
    maxOpenTrades: maxOpenTradesConfig,
    haltProfitEnabled,
    haltProfitTarget,
    haltLossEnabled,
    haltLossTarget,
    smartBtcHoldEnabled,
    btcVolThresholdStr,
    isSleeping: [22, 23, 0, 1, 2, 3, 4, 5, 6, 7].includes(new Date().getUTCHours()),
    today: todaysStats 
  }; 
}
export function getConfig() {
  return { virtualBalance, initialVirtualBalance, maxOpenTradesConfig, haltProfitEnabled, haltProfitTarget, haltLossEnabled, haltLossTarget, smartBtcHoldEnabled };
}
export function setConfig(config: any) {
  if (config.virtualBalance) virtualBalance = config.virtualBalance;
  if (config.initialVirtualBalance) initialVirtualBalance = config.initialVirtualBalance;
  if (config.maxOpenTradesConfig) maxOpenTradesConfig = config.maxOpenTradesConfig;
  if (config.haltProfitEnabled !== undefined) haltProfitEnabled = config.haltProfitEnabled;
  if (config.haltProfitTarget !== undefined) haltProfitTarget = config.haltProfitTarget;
  if (config.haltLossEnabled !== undefined) haltLossEnabled = config.haltLossEnabled;
  if (config.haltLossTarget !== undefined) haltLossTarget = config.haltLossTarget;
  if (config.smartBtcHoldEnabled !== undefined) smartBtcHoldEnabled = config.smartBtcHoldEnabled;
  if (config.btcVolThresholdStr !== undefined) btcVolThresholdStr = config.btcVolThresholdStr;
}
export function setActive(val: boolean) { botActive = val; addLog(`BOT ACTIVE: ${val}`); }
export function isActive() { return botActive; }

// --- DATA FETCHING ---
async function updateDynamicWatchlist() {
   try {
      const now = Date.now();
      // Update watchlist every 6 hours
      if (now - lastWatchlistUpdate < 6 * 60 * 60 * 1000 && WATCHLIST.length > 20) {
         return;
      }

      addLog(`🔄 جلب قائمة العملات من بينانس وتصفية الأقوى سيولة...`, "info");
      const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/ticker/24hr`, { timeout: 10000 });
      
      const excludedBases = ['USDC', 'BUSD', 'TUSD', 'FDUSD', 'USDD', 'PYUSD', 'DAI', 'USDP', 'TRUE', 'EUR', 'GBP', 'AEUR', 'PAXG', 'XAUT'];
      
      let symbols = res.data
         .filter((s: any) => s.symbol.endsWith('USDT'))
         .filter((s: any) => !excludedBases.some(base => s.symbol.replace('USDT', '') === base))
         .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)); // Sort by USDT volume

      // Take top 150 symbols to avoid low liquidity garbage
      symbols = symbols.slice(0, 150).map((s: any) => s.symbol);

      if (symbols.length > 0) {
         // Keep BTC out of the rotation if we want, or just let it rotate. Let's make sure BTC is there? Actually it's fine.
         WATCHLIST = symbols;
         lastWatchlistUpdate = now;
         currentBatchIndex = 0;
         addLog(`✅ تم تحديث قائمة العملات بنجاح. العدد الكلي: ${WATCHLIST.length} عملة ذهبية سيتم فحصها على دفعات.`, "success");
      }
   } catch (e: any) {
      addLog(`⚠️ فشل تحديث قائمة العملات: ${e.message}`, "error");
   }
}

async function fetchKl(symbol: string, interval: string, limit: number) {
   const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/klines`, {
      params: { symbol, interval, limit },
      timeout: 5000
   });
   return res.data.map((k: any) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
      takerBuy: parseFloat(k[9]),
      takerSell: parseFloat(k[5]) - parseFloat(k[9]) // volume - taker buy = taker sell
   }));
}

async function fetchFunding(symbol: string) {
   const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/premiumIndex`, { params: { symbol }, timeout: 5000 });
   return parseFloat(res.data.lastFundingRate);
}

async function fetchOI(symbol: string, period: string, limit: number = 5) {
   try {
       const res = await axios.get(`${BINANCE_FAPI}/futures/data/openInterestHist`, {
         params: { symbol, period, limit }, timeout: 5000
       });
       return res.data;
   } catch { return []; }
}

async function fetchLiq(symbol: string) {
   // Proxying liquidation calculation (mocked for this specific requirement due to Binance lacking a free direct liq map)
   return { _up: 3000000, _down: 3000000 };
}

// --- SEC 1: MARKET CONTEXT (BTC) ---
async function getContext() {
   const btc4h = await fetchKl("BTCUSDT", "4h", 210);
   const btc15m = await fetchKl("BTCUSDT", "15m", 30);
   
   const closes4h = btc4h.map((c: any) => c.close);
   const ema50 = calcEMA(closes4h, 50).pop() || 0;
   const ema200 = calcEMA(closes4h, 200).pop() || 0;
   
   const price = closes4h[closes4h.length - 1];
   const c0 = btc4h[btc4h.length - 1];
   const c3 = btc4h[btc4h.length - 4];
   const hh_hl = c0.high > c3.high && c0.low > c3.low;
   const lh_ll = c0.high < c3.high && c0.low < c3.low;

   const c15_0 = btc15m[btc15m.length - 1];
   const c15_3 = btc15m[btc15m.length - 4];
   const btc_15m_chg = (c15_0.close - c15_3.close) / c15_3.close;
   
   const vols15m = btc15m.slice(-20).map((k: any) => k.volume);
   const avgVol15m = vols15m.reduce((a: number, b: number) => a + b, 0) / 20;
   const rvol = c15_0.volume / avgVol15m;
   
   const btc_violent = Math.abs(btc_15m_chg) > (Number(btcVolThresholdStr) / 100) && rvol > 2.5;

   let regime = "RANGING";
   if (price > ema50 && ema50 > ema200 && hh_hl) regime = "BULL_STRONG";
   else if (price > ema50 && ema50 > ema200) regime = "BULL_WEAK";
   else if (price > ema200 && price < ema50) regime = "BULL_WEAK"; // Bouncing off 200 or in chop above 200
   else if (price < ema50 && ema50 < ema200 && lh_ll) regime = "BEAR_STRONG";
   else if (price < ema50 && ema50 < ema200) regime = "BEAR_WEAK";
   else if (price < ema200 && price > ema50) regime = "BEAR_WEAK"; // Chop below 200
   
   // If it's still ranging but high timeframe is definitely bullish
   if (regime === "RANGING") {
      if (price > ema200) regime = "BULL_WEAK";
      else if (price < ema200) regime = "BEAR_WEAK";
   }

   const fundBtc = await fetchFunding("BTCUSDT");
   const avg_fund = fundBtc;

   return {
      regime,
      tradeable: !btc_violent, // allow finding trades even if ranging, handled by layer scoring
      btc_chg: btc_15m_chg,
      avg_fund
   };
}

// --- SEC 2: WHALE READER ---
async function readWhale(symbol: string, btc_chg: number) {
   const c15 = await fetchKl(symbol, "15m", 210);
   const c5 = await fetchKl(symbol, "5m", 30);
   const c4h = await fetchKl(symbol, "4h", 20);

   const cvd15 = []; let c15s = 0; for(let i=c15.length-20; i<c15.length; i++) { c15s += (c15[i].takerBuy - c15[i].takerSell); cvd15.push(c15s); }
   const cvd5 = []; let c5s = 0; for(let i=c5.length-15; i<c5.length; i++) { c5s += (c5[i].takerBuy - c5[i].takerSell); cvd5.push(c5s); }
   const cvd4h = []; let c4hs = 0; for(let i=c4h.length-10; i<c4h.length; i++) { c4hs += (c4h[i].takerBuy - c4h[i].takerSell); cvd4h.push(c4hs); }

   const slope15 = cvd15[cvd15.length-1] - cvd15[cvd15.length-6];
   const slope5 = cvd5[cvd5.length-1] - cvd5[cvd5.length-6];
   const slope4h = cvd4h[cvd4h.length-1] - cvd4h[cvd4h.length-4];

   const triple_bull = slope5 > 0 && slope15 > 0 && slope4h > 0;
   const triple_bear = slope5 < 0 && slope15 < 0 && slope4h < 0;
   const cvd_mixed = !triple_bull && !triple_bear;

   const oiData = await fetchOI(symbol, "15m", 4);
   let oi_chg = 0;
   if (oiData && oiData.length >= 4) {
      const oi0 = parseFloat(oiData[oiData.length-1].sumOpenInterest);
      const oi3 = parseFloat(oiData[0].sumOpenInterest);
      oi_chg = (oi0 - oi3) / oi3;
   }

   const p0 = c15[c15.length-1].close;
   const p3 = c15[c15.length-4].close;
   const p_chg = (p0 - p3)/p3;

   let scenario = "UNCLEAR";
   if (p_chg > 0 && oi_chg > 0 && slope15 > 0) scenario = "INST_LONG";
   else if (p_chg < 0 && oi_chg > 0 && slope15 < 0) scenario = "INST_SHORT";
   else if (p_chg > 0 && oi_chg < 0 && slope15 > 0) scenario = "SHORT_COVER";
   else if (p_chg < 0 && oi_chg < 0 && slope15 < 0) scenario = "LONG_LIQ";
   else if (p_chg > 0 && oi_chg > 0 && slope15 < 0) scenario = "BULL_TRAP";
   else if (p_chg < 0 && oi_chg > 0 && slope15 > 0) scenario = "BEAR_TRAP";

   const fund = await fetchFunding(symbol);
   
   let pressure = 0;
   for(let i=0; i<12; i++) {
      const w = (12-i)/12;
      const k = c15[c15.length-1 - i];
      pressure += (k.takerBuy - k.takerSell) * w;
   }
   const avgVol = c15.slice(-20).map((x: any) => x.volume).reduce((a: number, b: number) => a + b, 0)/20;
   
   const corr = Math.abs(btc_chg) > 0.001 ? p_chg / btc_chg : 0;
   const asset_strong = btc_chg < -0.003 && corr > -0.3;

   return {
      triple_bull, triple_bear, cvd_mixed,
      hidden_buy: slope15 < 0 && pressure > 0,
      hidden_sell: slope15 > 0 && pressure < 0,
      scenario, oi_chg, p_chg, fund,
      f_danger: Math.abs(fund) > 0.07/100,
      f_gold_long: fund < -0.03/100,
      f_gold_short: fund > 0.04/100,
      strong_acc: pressure > avgVol * 2.0,
      strong_dis: pressure < -avgVol * 2.0,
      asset_strong, c15
   };
}

// --- SEC 3: PRICE READER ---
async function readPrice(symbol: string, kl: any[]) {
   const hi = kl.map((k: any) => k.high);
   const lo = kl.map((k: any) => k.low);
   const cl = kl.map((k: any) => k.close);
   const vo = kl.map((k: any) => k.volume);

   const price = cl[cl.length-1];
   const ema21 = calcEMA(cl, 21).pop() || 0;
   const ema50 = calcEMA(cl, 50).pop() || 0;
   const ema200 = calcEMA(cl, 200).pop() || 0;
   
   const atr14 = calcATR(hi, lo, cl, 14).pop() || 0;
   const atr5 = calcATR(hi, lo, cl, 5).pop() || 0;
   const atr20 = calcATR(hi, lo, cl, 20).pop() || 0;

   const HH_HL = hi[hi.length-1] > hi[hi.length-4] && lo[lo.length-1] > lo[lo.length-4];
   const LH_LL = hi[hi.length-1] < hi[hi.length-4] && lo[lo.length-1] < lo[lo.length-4];

   const res10 = Math.max(...hi.slice(-11, -1));
   const sup10 = Math.min(...lo.slice(-11, -1));
   
   const rvol5 = (vo.slice(-6, -1).reduce((a: number, b: number) => a+b, 0)/5) / (vo.slice(-21, -1).reduce((a: number, b: number) => a+b, 0)/20);
   const compressed = (atr5/atr20) < 0.55 && rvol5 < 0.70;

   const c0 = kl[kl.length-1];
   const body = Math.abs(c0.close - c0.open);
   const rng = c0.high - c0.low;
   const bpct = rng > 0 ? body / rng : 0;
   const u_wick = c0.high - Math.max(c0.open, c0.close);
   const l_wick = Math.min(c0.open, c0.close) - c0.low;
   const cpos = rng > 0 ? (c0.close - c0.low) / rng : 0.5;

   const strong_bull_c = c0.close > c0.open && bpct > 0.60 && u_wick < body*0.30 && cpos > 0.75;
   const strong_bear_c = c0.close < c0.open && bpct > 0.60 && l_wick < body*0.30 && cpos < 0.25;

   const avg_vol = vo.slice(-21,-1).reduce((a: number, b: number) => a+b, 0)/20;
   const rvol = vo[vo.length-1] / (avg_vol || 1);

   const stop_hunt_bull = lo[lo.length-1] < sup10 && cl[cl.length-1] > sup10 && l_wick > body*2 && rvol > 1.8;
   const stop_hunt_bear = hi[hi.length-1] > res10 && cl[cl.length-1] < res10 && u_wick > body*2 && rvol > 1.8;

   const adxData = calcADX(hi, lo, cl, 14);
   const adx = adxData.adx.pop() || 0;
   const di_plus = adxData.diPlus.pop() || 0;
   const di_minus = adxData.diMinus.pop() || 0;

   const macdData = calcMACD(cl);
   const hist = macdData.hist;
   const hist_bull = hist[hist.length-1] > hist[hist.length-2] && hist[hist.length-1] > 0;
   const hist_bear = hist[hist.length-1] < hist[hist.length-2] && hist[hist.length-1] < 0;

   const rsi = calcRSI(cl, 14).pop() || 50;
   const stData = calcSupertrend(hi, lo, cl, 10, 3);
   const st_dir = stData.directions.pop();

   return {
      price, ema21, ema50, ema200, atr14,
      bull_align: price > ema21 && ema21 > ema50 && ema50 > ema200,
      bear_align: price < ema21 && ema21 < ema50 && ema50 < ema200,
      HH_HL, LH_LL, compressed, rvol, avg_vol,
      strong_bull_c, strong_bear_c, cpos, bpct,
      stop_hunt_bull, stop_hunt_bear,
      adx, di_plus, di_minus, hist_bull, hist_bear, hist,
      rsi, rsi_bull: rsi > 52 && rsi < 73, rsi_bear: rsi > 27 && rsi < 48,
      st_bull: st_dir === 1, st_bear: st_dir === -1,
      taker: rng > 0 ? c0.takerBuy / (c0.takerBuy + c0.takerSell) : 0.5,
      klines: kl, res10, sup10, volFade: false,
      u_wick, l_wick, body, rng
   };
}

// --- SEC 4: SCORE ENTRY ---
async function scoreEntry(symbol: string, ctx: any) {
   apexPredatorStats.totalEvaluations++;

   const w = await readWhale(symbol, ctx.btc_chg);
   const p = await readPrice(symbol, w.c15);

   let earlyReason = null;
   if (!ctx.tradeable) earlyReason = "BLOCKED";
   else if (w.cvd_mixed) earlyReason = "CVD Mixed";
   else if (w.f_danger) earlyReason = "Funding Danger";
   else if (p.rvol > 5.0) earlyReason = "RVOL Crazy";
   else if (p.rsi > 78 || p.rsi < 22) earlyReason = "RSI Exhst";
   else if (p.adx > 60) earlyReason = "ADX Exhst";
   else if (w.scenario === "SHORT_COVER" || w.scenario === "LONG_LIQ") earlyReason = `TEMP: ${w.scenario}`;

   let sl = 0.0, ss = 0.0;

   // Layer 1
   let layer1_sl = 0, layer1_ss = 0;
   if (ctx.regime === "BULL_STRONG") { layer1_sl += 3.0; }
   else if (ctx.regime === "BULL_WEAK") { layer1_sl += 2.0; layer1_ss += 0.5; }
   else if (ctx.regime === "BEAR_WEAK") { layer1_sl += 0.5; layer1_ss += 2.0; }
   else if (ctx.regime === "BEAR_STRONG") { layer1_ss += 3.0; }
   sl += layer1_sl; ss += layer1_ss;
   if (layer1_sl > 0 || layer1_ss > 0) apexPredatorStats.rules.market_context.passed++; else apexPredatorStats.rules.market_context.failed++;

   // Layer 2
   let layer2_sl = 0, layer2_ss = 0;
   if (w.scenario === "INST_LONG") layer2_sl += 3.0;
   else if (w.scenario === "INST_SHORT") layer2_ss += 3.0;
   else if (w.scenario === "BULL_TRAP") { layer2_ss += 2.5; layer2_sl -= 1.0; }
   else if (w.scenario === "BEAR_TRAP") { layer2_sl += 2.5; layer2_ss -= 1.0; }

   if (w.hidden_buy) layer2_sl += 1.5;
   if (w.hidden_sell) layer2_ss += 1.5;
   if (w.strong_acc) layer2_sl += 0.5;
   if (w.strong_dis) layer2_ss += 0.5;
   if (w.asset_strong) layer2_sl += 0.5;
   if (w.f_gold_long) layer2_sl += 0.5;
   if (w.f_gold_short) layer2_ss += 0.5;
   sl += layer2_sl; ss += layer2_ss;
   if (layer2_sl > 0 || layer2_ss > 0) apexPredatorStats.rules.whale_reader.passed++; else apexPredatorStats.rules.whale_reader.failed++;

   // Layer 3
   let layer3_sl = 0, layer3_ss = 0;
   if (p.bull_align && p.HH_HL) layer3_sl += 2.0;
   else if (p.bull_align) layer3_sl += 1.2;
   if (p.bear_align && p.LH_LL) layer3_ss += 2.0;
   else if (p.bear_align) layer3_ss += 1.2;

   if (p.compressed) { layer3_sl += 0.3; layer3_ss += 0.3; }
   if (p.stop_hunt_bull) layer3_sl += 1.0;
   if (p.stop_hunt_bear) layer3_ss += 1.0;
   sl += layer3_sl; ss += layer3_ss;
   if (layer3_sl > 0 || layer3_ss > 0) apexPredatorStats.rules.price_structure.passed++; else apexPredatorStats.rules.price_structure.failed++;

   // Layer 4
   let layer4_sl = 0, layer4_ss = 0;
   if (p.strong_bull_c && p.rvol > 1.5) layer4_sl += 1.2;
   else if (p.strong_bull_c) layer4_sl += 0.7;
   if (p.strong_bear_c && p.rvol > 1.5) layer4_ss += 1.2;
   else if (p.strong_bear_c) layer4_ss += 0.7;

   if (p.cpos > 0.8) layer4_sl += 0.3;
   if (p.cpos < 0.2) layer4_ss += 0.3;

   if (p.di_plus > p.di_minus && p.adx > 22 && p.hist_bull && p.rsi_bull && p.st_bull) layer4_sl += 1.0;
   else if (p.di_plus > p.di_minus && p.adx > 22) layer4_sl += 0.5;

   if (p.di_minus > p.di_plus && p.adx > 22 && p.hist_bear && p.rsi_bear && p.st_bear) layer4_ss += 1.0;
   else if (p.di_minus > p.di_plus && p.adx > 22) layer4_ss += 0.5;

   if (p.taker > 0.58) layer4_sl += 0.2;
   if (p.taker < 0.42) layer4_ss += 0.2;
   sl += layer4_sl; ss += layer4_ss;
   if (layer4_sl > 0 || layer4_ss > 0) apexPredatorStats.rules.momentum_ignition.passed++; else apexPredatorStats.rules.momentum_ignition.failed++;

   sl = Math.min(Math.max(sl, 0), 10);
   ss = Math.min(Math.max(ss, 0), 10);

   if (sl > 0) apexPredatorStats.totalLongScanned++;
   if (ss > 0) apexPredatorStats.totalShortScanned++;

   if (earlyReason) {
      if (earlyReason === "BLOCKED") return { signal: "BLOCKED" };
      return { signal: "WAIT", reason: earlyReason };
   }

   function getGrade(score: number) {
      if (score >= 8.5) return { label: "💎 GOLD", risk: 0.018, mult: 1.0 };
      if (score >= 7.0) return { label: "🥈 SILVER", risk: 0.012, mult: 0.85 };
      if (score >= 6.0) return { label: "🥉 BRONZE", risk: 0.012, mult: 0.70 };
      return { label: "⏳ WAIT", risk: 0, mult: 0 };
   }

   if (sl >= MIN_ENTRY_SCORE && sl > ss) { apexPredatorStats.acceptedLongs++; return { signal: "LONG", score: sl, grade: getGrade(sl), p, w, ctx }; }
   if (ss >= MIN_ENTRY_SCORE && ss > sl) { apexPredatorStats.acceptedShorts++; return { signal: "SHORT", score: ss, grade: getGrade(ss), p, w, ctx }; }
   return { signal: "WAIT", sl, ss };
}

// --- SEC 5: EXECUTION ---
function executeTrade(symbol: string, decision: any) {
   const { p, w, score, grade } = decision;
   const riskAmt = virtualBalance * grade.risk * grade.mult;

   if (decision.signal === "LONG") {
      const entry = p.price;
      const c = p.klines;
      const realLow = Math.min(c[c.length-1].low, c[c.length-2].low, c[c.length-3].low);
      const sl = realLow - (p.atr14 * 0.25);
      const slDist = entry - sl;

      const tp1 = entry + (slDist * 1.0);
      const tp2 = entry + (slDist * 2.0);
      const tp3 = entry + (slDist * 3.5);

      if ((tp3 - entry) / slDist < MIN_RR_REQUIRED) {
         addLog(`❌ رُفض ${symbol}: RR دون الحد`, "error");
         return;
      }

      let pos = riskAmt / slDist;
      activeTrades.push({
         symbol, direction: "LONG", entry, sl, tp1, tp2, tp3,
         pos, initialPos: pos, entryTime: new Date().toISOString(),
         part_a: 0.35, part_b: 0.40, part_c: 0.25,
         a_closed: false, b_closed: false, c_closed: false,
         be_done: false, score, grade: grade.label, pnl: 0,
         atr: p.atr14, peak_r: 0,
         whaleData: {
            scenario: w.scenario,
            hiddenBuy: w.hidden_buy ? "مخفي (شراء)" : "لا يوجد",
            strongAcc: w.strong_acc ? "حركة مستويات السيولة العالية" : "طبيعي",
            fund: String((w.fund * 100).toFixed(4)) + "%",
            institutionalBias: w.oi_chg > 0 ? "تراكم عقود (مفتوحة)" : "تصريف عقود",
         },
         priceData: {
            rsi: p.rsi.toFixed(2),
            adx: p.adx.toFixed(2),
            marketAlignment: p.bull_align ? "متوافق مع الصعود" : "فوضوي"
         }
      });
      addLog(`✅ LONG ${symbol} | دخول: ${entry.toFixed(4)} | SL: ${sl.toFixed(4)} | النقاط: ${score.toFixed(1)}/10`, "success");
   } else {
      const entry = p.price;
      const c = p.klines;
      const realHigh = Math.max(c[c.length-1].high, c[c.length-2].high, c[c.length-3].high);
      const sl = realHigh + (p.atr14 * 0.25);
      const slDist = sl - entry;

      const tp1 = entry - (slDist * 1.0);
      const tp2 = entry - (slDist * 2.0);
      const tp3 = entry - (slDist * 3.5);

      if ((entry - tp3) / slDist < MIN_RR_REQUIRED) return;

      let pos = riskAmt / slDist;
      activeTrades.push({
         symbol, direction: "SHORT", entry, sl, tp1, tp2, tp3,
         pos, initialPos: pos, entryTime: new Date().toISOString(),
         part_a: 0.35, part_b: 0.40, part_c: 0.25,
         a_closed: false, b_closed: false, c_closed: false,
         be_done: false, score, grade: grade.label, pnl: 0,
         atr: p.atr14, peak_r: 0,
         whaleData: {
            scenario: w.scenario,
            hiddenBuy: w.hidden_sell ? "مخفي (بيع)" : "لا يوجد",
            strongAcc: w.strong_dis ? "تفريغ السيولة المؤسساتي" : "طبيعي",
            fund: String((w.fund * 100).toFixed(4)) + "%",
            institutionalBias: w.oi_chg > 0 ? "تراكم عقود (شورت)" : "إغلاق صفقات",
         },
         priceData: {
            rsi: p.rsi.toFixed(2),
            adx: p.adx.toFixed(2),
            marketAlignment: p.bear_align ? "متوافق مع الهبوط" : "فوضوي"
         }
      });
      addLog(`✅ SHORT ${symbol} | دخول: ${entry.toFixed(4)} | SL: ${sl.toFixed(4)} | النقاط: ${score.toFixed(1)}/10`, "success");
   }
}

// --- SEC 6: EXIT BRAIN ---
async function exitBrain(trade: any, ctx: any) {
   const t = trade;
   const w = await readWhale(t.symbol, 0); // Fast check
   const p = await readPrice(t.symbol, w.c15);
   
   const price = p.price;
   t.currentPrice = price;

   const slDist = Math.abs(t.entry - t.sl);
   const profitR = t.direction === "LONG" ? (price - t.entry)/slDist : (t.entry - price)/slDist;
   t.profitR = profitR;
   if (profitR > t.peak_r) t.peak_r = profitR;

   t.pnl = t.direction === "LONG" ? (price - t.entry)*t.pos : (t.entry - price)*t.pos;

   let emergency = false;
   let emReason = "";

   if (ctx.regime === "RANGING" || !ctx.tradeable) {
      if (smartBtcHoldEnabled && t.direction === "LONG" && ctx.btc_chg > 0.0) {
         addLog(`🔄 ${t.symbol}: تجاهل الخروج بالرغم من توقف صعود بيتكوين لأن الاتجاه منسجم مع وضعية الصعود (${ctx.btc_chg.toFixed(4)})`, "info");
      } else if (smartBtcHoldEnabled && t.direction === "SHORT" && ctx.btc_chg < -0.0) {
         addLog(`🔄 ${t.symbol}: تجاهل الخروج بالرغم من هبوط بيتكوين لأن الاتجاه منسجم مع وضعية الشورت (${ctx.btc_chg.toFixed(4)})`, "info");
      } else {
         emergency = true; emReason = "BTC Chaos";
      }
   }

   if (t.direction === "LONG" && w.scenario === "INST_SHORT" && w.triple_bear) { emergency = true; emReason = "Inst Short"; }
   if (t.direction === "SHORT" && w.scenario === "INST_LONG" && w.triple_bull) { emergency = true; emReason = "Inst Long"; }
   
   if (t.direction === "LONG" && w.hidden_sell && profitR < 0.5) { emergency = true; emReason = "Hidden Sell"; }
   const threeBelow = p.klines.slice(-3).every((c: any) => c.close < p.ema21);
   if (t.direction === "LONG" && threeBelow && profitR < 1.0) { emergency = true; emReason = "Structural Break"; }

   if (emergency) {
      addLog(`🚨 EMERGENCY EXIT ${t.symbol} | ${emReason} | PnL: ${profitR.toFixed(2)}R`, 'error');
      closeTradeFull(t);
      return;
   }

   let exhaust = 0;
   let peak = 0;
   
   if (t.direction === "LONG") {
      const c = p.klines;
      if (price > Math.max(...c.slice(-10,-3).map((k: any) => k.high)) && p.hist[p.hist.length-1] < p.hist[p.hist.length-4]) exhaust += 3;
      if (w.fund > 0.06/100) exhaust += 1;
      
      const bodySize = (klines: any[]) => { const last = klines[klines.length-1]; return Math.abs(last.open - last.close); };
      const ss_cand = p.u_wick > bodySize(c)*2.5 && p.price > p.res10 * 0.998;
      if (ss_cand) peak += 3;
   } else {
      if (w.fund < -0.07/100) peak += 2;
   }

   let trailDist = p.atr14 * (p.rvol > 1.5 ? 1.0 : 0.7) * (p.adx > 30 ? 1.0 : 0.7);

   if (!t.a_closed) {
      if (profitR >= 1.0) {
         closePart(t, "A", t.part_a);
         t.sl = t.entry; // BE
         t.a_closed = true; t.be_done = true;
         addLog(`🎯 EXIT A (35%) ${t.symbol} | RR 1.0`, 'success');
      } else if ((exhaust >= 5 || peak >= 5) && profitR > 0.3) {
         closePart(t, "A", t.part_a);
         t.sl = t.direction === "LONG" ? price - p.atr14*0.5 : price + p.atr14*0.5;
         t.a_closed = true;
      }
   }

   if (t.a_closed && !t.b_closed) {
      if (profitR >= 2.0) {
         closePart(t, "B", t.part_b);
         t.b_closed = true;
         addLog(`🎯 EXIT B (40%) ${t.symbol} | RR 2.0`, 'success');
      } else if ((exhaust >= 7 || peak >= 7) && profitR > 1.2) {
         closePart(t, "B", t.part_b);
         t.b_closed = true;
      }
   }

   if (t.b_closed && !t.c_closed) {
      if (t.direction === "LONG") { t.sl = Math.max(t.sl, price - trailDist); }
      else { t.sl = Math.min(t.sl, price + trailDist); }

      if (profitR >= 3.5 || exhaust >= 8 || peak >= 8) {
         closePart(t, "C", t.part_c);
         t.c_closed = true;
         addLog(`🏁 EXIT C (25%) ${t.symbol} | RR 3.5+`, 'success');
         closeTradeFull(t);
      }
   }

   // Hard SL Hit
   if (t.direction === "LONG" && price <= t.sl) closeTradeFull(t, "SL Hit");
   if (t.direction === "SHORT" && price >= t.sl) closeTradeFull(t, "SL Hit");
}

function bodySize(klines: any[]) { return Math.abs(klines[klines.length-1].close - klines[klines.length-1].open); }

function closePart(t: any, part: string, pct: number) {
   const size = t.initialPos * pct;
   t.pos -= size;
      const realizedPnl = (t.direction === "LONG" ? (t.currentPrice - t.entry) : (t.entry - t.currentPrice)) * size;
      t.realizedPnl = (t.realizedPnl || 0) + realizedPnl;
      virtualBalance += realizedPnl;
}

function closeTradeFull(t: any, reason: string = "") {
   const finalPnl = (t.direction === "LONG" ? (t.currentPrice - t.entry) : (t.entry - t.currentPrice)) * t.pos;
   t.realizedPnl = (t.realizedPnl || 0) + finalPnl;
   virtualBalance += finalPnl;
   t.exitTime = new Date().toISOString();
   t.exitReason = reason;
   t.finalPnl = t.realizedPnl;
   closedTrades.unshift(t);
   t.pos = 0;
   todaysStats.count++;
   if (t.profitR > 0) todaysStats.wins++; else todaysStats.losses++;
   todaysStats.pnl += (t.direction === "LONG" ? (t.currentPrice - t.entry) : (t.entry - t.currentPrice)) * t.initialPos;
   activeTrades = activeTrades.filter(tr => tr !== t);
   if (reason) addLog(`🛑 Full Exit ${t.symbol}: ${reason} | Final PnL: ${t.profitR.toFixed(2)}R`, 'warn');
}

// --- SEC 9: MAIN LOOP ---
export async function runApexLoop() {
   if (!botActive || isLoopRunning) return;

   const hour = new Date().getUTCHours();
   if (AVOID_HOURS.includes(hour)) return;

   isLoopRunning = true;
   try {
      await updateDynamicWatchlist();
      const ctx = await getContext();
      
      // Calculate overall Net PnL
      let totalFloatingPnl = 0;
      let totalRealizedPnl = closedTrades.reduce((acc, t) => acc + (t.finalPnl || t.realizedPnl || 0), 0);
      for (const t of activeTrades) {
         if (t.pnl) totalFloatingPnl += t.pnl; 
      }
      let currentNetPnl = totalRealizedPnl + totalFloatingPnl;
      
      if (haltProfitEnabled && currentNetPnl >= haltProfitTarget) {
         botActive = false;
         isLoopRunning = false;
         addLog(`🛑 تحقيق هدف الربح ($${haltProfitTarget})، تم إيقاف الروبوت.`, "success");
         return;
      }
      
      if (haltLossEnabled && currentNetPnl <= -haltLossTarget) {
         botActive = false;
         isLoopRunning = false;
         addLog(`🛑 الوصول لحد الخسارة المحدد ($${haltLossTarget})، تم إيقاف الروبوت.`, "error");
         return;
      }
      
      // Manage open trades
      for (const t of activeTrades) {
         await exitBrain(t, ctx);
      }

      if (activeTrades.length >= maxOpenTradesConfig) {
         isLoopRunning = false;
         return;
      }

      // Ensure index is valid
      if (currentBatchIndex >= WATCHLIST.length) {
         currentBatchIndex = 0;
      }

      const batchSize = 10;
      const endBatchIndex = Math.min(currentBatchIndex + batchSize, WATCHLIST.length);
      const batchSymbols = WATCHLIST.slice(currentBatchIndex, endBatchIndex);
      
      addLog(`🦅 SCANNING BATCH [${currentBatchIndex + 1} TO ${endBatchIndex}] من ${WATCHLIST.length} عملة...`, "info");
      
      // Advance index for next run
      currentBatchIndex = endBatchIndex;
      if (currentBatchIndex >= WATCHLIST.length) {
         currentBatchIndex = 0; // Reset
      }

      for (const sym of batchSymbols) {
         if (activeTrades.length >= maxOpenTradesConfig) break;
         if (activeTrades.find(t => t.symbol === sym)) continue;
         
         const dec = await scoreEntry(sym, ctx);
         if (dec.signal === "LONG" || dec.signal === "SHORT") {
            executeTrade(sym, dec);
         }
      }
   } catch (e: any) {
      addLog(`Loop Error: ${e.message}`, "error");
   } finally {
      isLoopRunning = false;
   }
}

export function startEngine() {
   if (watcherInterval) clearInterval(watcherInterval);
   watcherInterval = setInterval(runApexLoop, 60 * 1000); // Check every 1 minute
   runApexLoop();
   addLog("Apex Predator Engine Started", "success");
}
