import axios from "axios";
import { calcEMA, calcATR, calcADX, calcMACD, calcRSI, calcSupertrend } from "./indicators.js";
import { evaluateSymbolReasoning, ReasoningResult } from "./reasoningEngine.js";
import { DirectionStateEngine, DirectionDecision, evaluateDirectionTiming, TimingResult } from "./directionStateEngine.js";
import {
   logRejectedSignal,
   logTradeDecision,
   logTradeJourneySnapshot,
   formatCandles,
   updateRejectedSignalsOutcomes,
   extractEntryTiming,
   extractMarketRegimeContext,
   registerTradeForDirectionTracking,
   updateDirectionTracking
} from "./researchLogger.js";

const BINANCE_FAPI = "https://fapi.binance.com";
let watcherInterval: NodeJS.Timeout | null = null;
let activeTrades: any[] = [];
let todaysStats = { count: 0, wins: 0, losses: 0, pnl: 0, sumR: 0 };
let statsDay = new Date().toISOString().slice(0, 10);
let botActive = false;
let isLoopRunning = false;

// ═══ DIRECTION LIFECYCLE ENGINE REGISTRY ═══
const symbolDirectionEngines = new Map<string, DirectionStateEngine>();
export function getDirectionEngine(symbol: string): DirectionStateEngine {
   let engine = symbolDirectionEngines.get(symbol);
   if (!engine) {
      engine = new DirectionStateEngine(symbol);
      symbolDirectionEngines.set(symbol, engine);
   }
   return engine;
}

// ═══ CONFIGURATION ═══
let WATCHLIST: string[] = [
   "BTCUSDT", "ETHUSDT", "SOLUSDT", "AVAXUSDT",
   "LINKUSDT", "INJUSDT", "ARBUSDT", "CRVUSDT",
   "AAVEUSDT", "OPUSDT"
];
let currentBatchIndex = 0;
let lastWatchlistUpdate = 0;


const MIN_RR_REQUIRED = 2.5;
const TP1_R = 0.75;
const TP2_R = 1.80;
const TP3_R = 3.50;
const MAX_OPEN_TRADES = 3;
const MAX_DAILY_LOSS = 0.040;
const BEST_HOURS_UTC = [12, 13, 14, 15, 16, 17, 18, 19, 20];
const AVOID_HOURS = [22, 23, 0, 1, 2, 3, 4, 5, 6, 7];

let virtualBalance = 1000;
let initialVirtualBalance = 1000;
let maxOpenTradesConfig = 3;

// ============================================================================
// EXIT ENGINE FEATURE FLAGS (Controlled Experimentation Baseline)
// ============================================================================
export const ENABLE_PRE_TP1_GIVEBACK_EXIT = false;
export const ENABLE_MFE_MILESTONE_STOPS = false;
export const ENABLE_POST_TP1_GIVEBACK_EXIT = false;

// New Config
let haltProfitEnabled = false;
let haltProfitTarget = 150;
let haltLossEnabled = false;
let haltLossTarget = 50;
let smartBtcHoldEnabled = true;
let btcVolThresholdStr = "0.80";
let slAtrMultiplier = 1.3;
let geniusMode = true;
let pullbackSniperEnabled = true;
let freeTradeSlotEnabled = true;
let scanBatchSize = 25;
let feeRate = 0.0004; // 0.04% default Binance VIP0 taker fee
let slippageRate = 0.0002; // 0.02% estimated market slippage

// Libya Trading Schedule Config (GMT+2)
let scheduleEnabled = true;
let libyaOpen1 = 10;
let libyaClose1 = 14;
let libyaOpen2 = 15.5;
let libyaClose2 = 18;

const logs: any[] = [];
let closedTrades: any[] = [];

let apexPredatorStats: any = {
  totalEvaluations: 0,
  totalLongScanned: 0,
  totalShortScanned: 0,
  acceptedLongs: 0,
  acceptedShorts: 0,
  pullbackSetups: 0,
  breakoutSetups: 0,
  rules: {
    market_context: { passed: 0, failed: 0 },
    whale_reader: { passed: 0, failed: 0 },
    price_structure: { passed: 0, failed: 0 },
    momentum_ignition: { passed: 0, failed: 0 },
  }
};

export function updateConfig(balance: number, maxTrades: number, opts?: any) {
  initialVirtualBalance = balance;
  if (closedTrades.length === 0 && activeTrades.length === 0) {
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
      if (opts.slAtrMultiplier !== undefined) slAtrMultiplier = opts.slAtrMultiplier;
      if (opts.geniusMode !== undefined) geniusMode = opts.geniusMode;
      if (opts.pullbackSniperEnabled !== undefined) pullbackSniperEnabled = opts.pullbackSniperEnabled;
      if (opts.freeTradeSlotEnabled !== undefined) freeTradeSlotEnabled = opts.freeTradeSlotEnabled;
      if (opts.scanBatchSize !== undefined) scanBatchSize = Number(opts.scanBatchSize) || 25;
      if (opts.feeRate !== undefined) feeRate = Number(opts.feeRate);
      if (opts.slippageRate !== undefined) slippageRate = Number(opts.slippageRate);
      if (opts.scheduleEnabled !== undefined) scheduleEnabled = opts.scheduleEnabled;
      if (opts.libyaOpen1 !== undefined) libyaOpen1 = opts.libyaOpen1;
      if (opts.libyaClose1 !== undefined) libyaClose1 = opts.libyaClose1;
      if (opts.libyaOpen2 !== undefined) libyaOpen2 = opts.libyaOpen2;
      if (opts.libyaClose2 !== undefined) libyaClose2 = opts.libyaClose2;
  }
}

export function isLibyaTradingAllowed(): boolean {
   if (!scheduleEnabled) return true;
   const now = new Date();
   const utcHour = now.getUTCHours();
   const utcMin = now.getUTCMinutes();
   const libyaHour = (utcHour + 2) % 24 + (utcMin / 60);

   const inPeriod1 = (libyaHour >= libyaOpen1 && libyaHour < libyaClose1);
   const inPeriod2 = (libyaHour >= libyaOpen2 && libyaHour < libyaClose2);

   return inPeriod1 || inPeriod2;
}

export function addLog(msg: string, type: 'info'|'warn'|'success'|'error' = 'info') {
   console.log(`[APEX] ${msg}`);
   logs.unshift({ time: new Date().toISOString(), msg, type });
   if (logs.length > 200) logs.pop();
}

export function resetDailyStatsIfNeeded() {
   const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tripoli' }).format(new Date());
   if (today !== statsDay) {
      todaysStats = {
         count: 0,
         wins: 0,
         losses: 0,
         pnl: 0,
         sumR: 0
      };
      statsDay = today;
      addLog(`📅 Daily statistics reset (Libya 00:00: ${today})`, "info");
   }
}

export function getLogs() { return logs; }
export function getTrades() { return activeTrades; }
export function getClosedTrades() { return closedTrades; }
export function getStats() { 
  const freeTradesCount = activeTrades.filter(t => t.be_done).length;
  const riskedTradesCount = activeTrades.filter(t => !t.be_done).length;

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
    slAtrMultiplier,
    geniusMode,
    pullbackSniperEnabled,
    freeTradeSlotEnabled,
    scanBatchSize,
    feeRate,
    slippageRate,
    freeTradesCount,
    riskedTradesCount,
    watchlistLength: WATCHLIST.length,
    currentBatchProgress: `${Math.min(currentBatchIndex, WATCHLIST.length)} / ${WATCHLIST.length}`,
    scheduleEnabled,
    libyaOpen1,
    libyaClose1,
    libyaOpen2,
    libyaClose2,
    isSleeping: !isLibyaTradingAllowed(),
    today: todaysStats 
  }; 
}
export function getConfig() {
  return { 
    virtualBalance, 
    initialVirtualBalance, 
    maxOpenTradesConfig, 
    haltProfitEnabled, 
    haltProfitTarget, 
    haltLossEnabled, 
    haltLossTarget, 
    smartBtcHoldEnabled, 
    slAtrMultiplier, 
    geniusMode, 
    pullbackSniperEnabled,
    freeTradeSlotEnabled,
    scanBatchSize,
    feeRate,
    slippageRate,
    scheduleEnabled, 
    libyaOpen1, 
    libyaClose1, 
    libyaOpen2, 
    libyaClose2 
  };
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
  if (config.slAtrMultiplier !== undefined) slAtrMultiplier = config.slAtrMultiplier;
  if (config.geniusMode !== undefined) geniusMode = config.geniusMode;
  if (config.pullbackSniperEnabled !== undefined) pullbackSniperEnabled = config.pullbackSniperEnabled;
  if (config.freeTradeSlotEnabled !== undefined) freeTradeSlotEnabled = config.freeTradeSlotEnabled;
  if (config.scanBatchSize !== undefined) scanBatchSize = Number(config.scanBatchSize) || 25;
  if (config.feeRate !== undefined) feeRate = Number(config.feeRate);
  if (config.slippageRate !== undefined) slippageRate = Number(config.slippageRate);
  if (config.scheduleEnabled !== undefined) scheduleEnabled = config.scheduleEnabled;
  if (config.libyaOpen1 !== undefined) libyaOpen1 = config.libyaOpen1;
  if (config.libyaClose1 !== undefined) libyaClose1 = config.libyaClose1;
  if (config.libyaOpen2 !== undefined) libyaOpen2 = config.libyaOpen2;
  if (config.libyaClose2 !== undefined) libyaClose2 = config.libyaClose2;
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

      // Full Universe: All valid Binance USDT perpetuals enter Direction Lifecycle Engine without 150-symbol restriction
      symbols = symbols.map((s: any) => s.symbol);

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

// --- CACHING & REST OPTIMIZATIONS ---
interface CacheEntry {
   data: any;
   expiresAt: number;
}
const klineCache = new Map<string, CacheEntry>();
const fundingCache = new Map<string, CacheEntry>();
const oiCache = new Map<string, CacheEntry>();

function getCached<T>(cache: Map<string, CacheEntry>, key: string): T | null {
   const entry = cache.get(key);
   if (!entry) return null;
   if (Date.now() > entry.expiresAt) {
      cache.delete(key);
      return null;
   }
   return entry.data as T;
}

function setCached(cache: Map<string, CacheEntry>, key: string, data: any, ttlMs: number) {
   // Limit cache size to prevent memory bloat
   if (cache.size > 800) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
   }
   cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

async function fetchKl(symbol: string, interval: string, limit: number) {
   const cacheKey = `${symbol}:${interval}:${limit}`;
   const cached = getCached<any[]>(klineCache, cacheKey);
   if (cached) return cached;

   // TTL based on timeframe: 4h cached for 60s, 15m for 20s, 5m for 10s
   let ttl = 10000;
   if (interval === "4h") ttl = 60000;
   else if (interval === "15m") ttl = 20000;
   else if (interval === "5m") ttl = 10000;

   const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/klines`, {
      params: { symbol, interval, limit },
      timeout: 5000
   });
   const parsed = res.data.map((k: any) => ({
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

   setCached(klineCache, cacheKey, parsed, ttl);
   return parsed;
}

async function fetchFunding(symbol: string) {
   const cached = getCached<number>(fundingCache, symbol);
   if (cached !== null) return cached;

   const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/premiumIndex`, { params: { symbol }, timeout: 5000 });
   const rate = parseFloat(res.data.lastFundingRate);
   // Funding rates update every 8 hours, caching for 60 seconds is extremely safe
   setCached(fundingCache, symbol, rate, 60000);
   return rate;
}

async function fetchOI(symbol: string, period: string, limit: number = 5) {
   const cacheKey = `${symbol}:${period}:${limit}`;
   const cached = getCached<any[]>(oiCache, cacheKey);
   if (cached) return cached;

   try {
       const res = await axios.get(`${BINANCE_FAPI}/futures/data/openInterestHist`, {
         params: { symbol, period, limit }, timeout: 5000
       });
       // Open interest data updates periodically; caching for 30s significantly reduces load
       setCached(oiCache, cacheKey, res.data, 30000);
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
   
   if (btc4h.length < 200 || btc15m.length < 20) {
      throw new Error("Insufficient BTC context");
   }

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
      avg_fund,
      price,
      ema200
   };
}

// --- SEC 2: WHALE READER ---
async function readWhale(symbol: string, btc_chg: number) {
   const c15 = await fetchKl(symbol, "15m", 210);
   const c5 = await fetchKl(symbol, "5m", 30);
   const c4h = await fetchKl(symbol, "4h", 20);

   if (c15.length < 20 || c5.length < 15 || c4h.length < 10) {
      throw new Error("Insufficient klines for whale reader");
   }

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
      asset_strong, c15, c5, slope5, slope15
   };
}

// --- SEC 3: PRICE READER ---
async function readPrice(symbol: string, kl: any[], kl5: any[] = []) {
   if (!kl || kl.length < 50) {
      throw new Error("Insufficient klines for price reader");
   }
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

   // 5m Multi-timeframe confluence
   let conf5_bull = false;
   let conf5_bear = false;
   if (kl5 && kl5.length >= 15) {
      const cl5 = kl5.map((k: any) => k.close);
      const ema9_5 = calcEMA(cl5, 9).pop() || 0;
      const ema21_5 = calcEMA(cl5, 21).pop() || 0;
      const last5 = kl5[kl5.length - 1];
      conf5_bull = last5.close > ema9_5 && ema9_5 >= ema21_5;
      conf5_bear = last5.close < ema9_5 && ema9_5 <= ema21_5;
   }

   // Trend Pullback Sniper Calculations
   const distEma21 = Math.abs(price - ema21) / (ema21 || 1);
   const nearEma21Long = distEma21 <= 0.020 || (lo[lo.length-1] <= ema21 && price >= ema21 * 0.990);
   const nearEma21Short = distEma21 <= 0.020 || (hi[hi.length-1] >= ema21 && price <= ema21 * 1.010);

   const bull_align = price > ema21 && ema21 > ema50 && ema50 > ema200;
   const bear_align = price < ema21 && ema21 < ema50 && ema50 < ema200;

   const pullback_long = (bull_align || (price > ema50 && ema50 > ema200)) &&
                         adx >= 18 &&
                         nearEma21Long &&
                         (l_wick >= body * 0.5 || c0.close > c0.open) &&
                         cpos >= 0.40 &&
                         rsi >= 38 && rsi <= 58 &&
                         rvol < 3.2;

   const pullback_short = (bear_align || (price < ema50 && ema50 < ema200)) &&
                          adx >= 18 &&
                          nearEma21Short &&
                          (u_wick >= body * 0.5 || c0.close < c0.open) &&
                          cpos <= 0.60 &&
                          rsi >= 42 && rsi <= 62 &&
                          rvol < 3.2;

   return {
      price, ema21, ema50, ema200, atr14, atr20,
      bull_align, bear_align,
      HH_HL, LH_LL, compressed, rvol, avg_vol,
      strong_bull_c, strong_bear_c, cpos, bpct,
      stop_hunt_bull, stop_hunt_bear,
      adx, di_plus, di_minus, hist_bull, hist_bear, hist,
      rsi, rsi_bull: rsi > 52 && rsi < 73, rsi_bear: rsi > 27 && rsi < 48,
      st_bull: st_dir === 1, st_bear: st_dir === -1,
      taker: rng > 0 ? c0.takerBuy / (c0.takerBuy + c0.takerSell) : 0.5,
      klines: kl, res10, sup10, volFade: false,
      u_wick, l_wick, body, rng,
      pullback_long, pullback_short, conf5_bull, conf5_bear
   };
}

// --- SEC 4: SCORE ENTRY ---
async function scoreEntry(symbol: string, ctx: any) {
   apexPredatorStats.totalEvaluations++;

   const w = await readWhale(symbol, ctx.btc_chg);
   const p = await readPrice(symbol, w.c15, w.c5);

   // Passively update in-flight rejected signal future outcomes using candles and price already in memory
   updateRejectedSignalsOutcomes(symbol, p.price, p.klines);
   updateDirectionTracking(symbol, p.price);

   let earlyReason = null;
   if (!ctx.tradeable) earlyReason = "BLOCKED";
   else if (!isLibyaTradingAllowed()) earlyReason = "OUTSIDE_LIBYA_HOURS";
   else if (w.cvd_mixed) earlyReason = "CVD Mixed";
   else if (w.f_danger) earlyReason = "Funding Danger";
   else if (p.rvol > 5.0) earlyReason = "RVOL Crazy";
   else if (p.rsi > 78 || p.rsi < 22) earlyReason = "RSI Exhst";
   else if (p.adx > 60) earlyReason = "ADX Exhst";
   else if (w.scenario === "SHORT_COVER" || w.scenario === "LONG_LIQ") earlyReason = `TEMP: ${w.scenario}`;
   if (geniusMode && Math.abs(ctx.btc_chg) > (Number(btcVolThresholdStr) / 100) && p.rvol < 1.0) earlyReason = "Low Vol during BTC Chaos";
   if (geniusMode && p.body < p.u_wick && p.body < p.l_wick && p.rsi > 45 && p.rsi < 55) earlyReason = "Indecision Doji";

   if (earlyReason) {
      if (earlyReason === "BLOCKED") return { signal: "BLOCKED" };
      return { signal: "WAIT", reason: earlyReason };
   }

   // ═══ DIRECTION LIFECYCLE STATE MACHINE EVALUATION ═══
   // Driven by Evidence Chains (Structure -> Breakout -> Retest -> Flow -> Volume)
   // NOT democratic indicator scoring!
   const dirEngine = getDirectionEngine(symbol);
   if (dirEngine.transitionLog.length === 0 && p.klines && p.klines.length >= 15) {
      const warmupSlice = p.klines.slice(-30, -1);
      for (const k of warmupSlice) {
         dirEngine.processCandle({
            time: k.openTime || Date.now(),
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
            volume: k.volume || 1000,
            takerBuyBase: k.takerBuy || (k.volume * 0.5)
         }, { regime: ctx.regime, btc_chg: ctx.btc_chg }, { oiChg: w.oi_chg });
      }
   }
   const lastKline = (p.klines && p.klines.length > 0) ? p.klines[p.klines.length - 1] : null;
   const currentCandleData = {
      time: lastKline ? (lastKline.openTime || Date.now()) : Date.now(),
      open: lastKline ? lastKline.open : p.price,
      high: lastKline ? lastKline.high : p.price,
      low: lastKline ? lastKline.low : p.price,
      close: p.price,
      volume: (p.rvol || 1.0) * (p.avg_vol || 1000),
      takerBuyBase: (p.taker || 0.5) * (p.rvol || 1.0) * (p.avg_vol || 1000)
   };
   const dirDecision = dirEngine.processCandle(currentCandleData, { regime: ctx.regime, btc_chg: ctx.btc_chg }, { oiChg: w.oi_chg });

   // Direction State Machine governs direction strictly
   if (!dirDecision.canEnter || dirDecision.direction === "UNKNOWN") {
      return { signal: "WAIT", reason: `Direction State: ${dirDecision.state} (Awaiting confirmed structure)` };
   }

   // SAFETY GATE: Strictly prohibit SHORT trades when BTC Regime is BULL_STRONG
   if (dirDecision.direction === "SHORT" && ctx.regime === "BULL_STRONG") {
      addLog(`🛡️ [SAFETY GATE] تم منع صفقة SHORT على ${symbol} لأن اتجاه بيتكوين صاعد قوي (BTC BULL_STRONG).`, "warn");
      logRejectedSignal({
         symbol,
         timeframe: "15m",
         direction: "SHORT",
         signal_score: 7.8,
         rejection_reason: "Safety Gate: BTC Regime is BULL_STRONG. Shorting strictly prohibited.",
         p,
         w,
         ctx
      });
      return { signal: "WAIT", reason: "Safety Gate: BTC Regime is BULL_STRONG. Shorting strictly prohibited.", dirDecision };
   }

   // ═══ TIMING ENGINE EVALUATION ═══
   // Timing Engine decides ONLY: GO or WAIT
   // STRICT LAW: Timing Engine CAN NEVER alter direction (LONG -> SHORT or SHORT -> LONG)
   const timingResult = evaluateDirectionTiming(
      dirDecision.direction,
      currentCandleData,
      p.ema21,
      p.atr14,
      p.rsi
   );

   if (!timingResult.canExecute || timingResult.timingAction === "WAIT") {
      addLog(`⏳ ${symbol}: اتجاه مؤكد [${dirDecision.state}] لكن التوقيت [WAIT]: ${timingResult.timingReason}`, "info");
      return {
         signal: "WAIT",
         reason: `Direction: ${dirDecision.direction} (${dirDecision.state}) | Timing Gate: WAIT (${timingResult.timingReason})`,
         dirDecision,
         timingResult
      };
   }

   // --- BEAST ARCHITECTURE REASONING EVALUATION (Context, Telemetry & Deep Flow Logging) ---
   const sl = dirDecision.direction === "LONG" ? (dirDecision.state === "CONFIRMED_LONG" ? 8.8 : 7.8) : 0.0;
   const ss = dirDecision.direction === "SHORT" ? (dirDecision.state === "CONFIRMED_SHORT" ? 8.8 : 7.8) : 0.0;
   const reasoning: ReasoningResult = evaluateSymbolReasoning(
      symbol,
      ctx,
      p,
      w,
      { sl, ss }
   );

   function getGrade(score: number) {
      if (score >= 8.5) return { label: "💎 APEX 3:1 GOLD", risk: 0.010, mult: 1.0 };
      if (score >= 7.6) return { label: "🥈 APEX 3:1 SILVER", risk: 0.007, mult: 1.0 };
      if (score >= 6.8) return { label: "🥉 BRONZE", risk: 0.005, mult: 1.0 };
      return { label: "⏳ WAIT", risk: 0, mult: 0 };
   }

   if (dirDecision.direction === "LONG") {
      const execScore = sl;
      const setupType = dirDecision.entryType === "FORMING_EARLY" 
         ? "FORMING_EARLY_LONG" 
         : (reasoning.scenario.primary.type === "PULLBACK_LONG" ? "PULLBACK_SNIPER" : "BREAKOUT_MOMENTUM");
      apexPredatorStats.totalLongScanned++;
      apexPredatorStats.acceptedLongs++;
      if (setupType === "PULLBACK_SNIPER") apexPredatorStats.pullbackSetups++;
      else apexPredatorStats.breakoutSetups++;

      addLog(
         `🚀 [DIRECTION DECISION] LONG ${symbol} | State: ${dirDecision.state} (${dirDecision.entryType}) | ` +
         `Timing: GO | Regime: ${reasoning.regime} | Flow: ${reasoning.flow.state}`,
         "success"
      );

      return {
         signal: "LONG",
         score: execScore,
         grade: getGrade(execScore),
         setupType,
         p,
         w,
         ctx,
         reasoning,
         dirDecision,
         timingResult
      };
   }

   if (dirDecision.direction === "SHORT") {
      const execScore = ss;
      const setupType = dirDecision.entryType === "FORMING_EARLY" 
         ? "FORMING_EARLY_SHORT" 
         : (reasoning.scenario.primary.type === "PULLBACK_SHORT" ? "PULLBACK_SNIPER" : "BREAKDOWN_MOMENTUM");
      apexPredatorStats.totalShortScanned++;
      apexPredatorStats.acceptedShorts++;
      if (setupType === "PULLBACK_SNIPER") apexPredatorStats.pullbackSetups++;
      else apexPredatorStats.breakoutSetups++;

      addLog(
         `🚀 [DIRECTION DECISION] SHORT ${symbol} | State: ${dirDecision.state} (${dirDecision.entryType}) | ` +
         `Timing: GO | Regime: ${reasoning.regime} | Flow: ${reasoning.flow.state}`,
         "success"
      );

      return {
         signal: "SHORT",
         score: execScore,
         grade: getGrade(execScore),
         setupType,
         p,
         w,
         ctx,
         reasoning,
         dirDecision,
         timingResult
      };
   }

   // If indicator score was high but confirmation rejected or waiting:
   if ((sl >= minScore || ss >= minScore) && !reasoning.confirmation.isConfirmed) {
      const rejectDirection = sl >= ss ? "LONG" : "SHORT";
      const rejectScore = Math.max(sl, ss);
      const rejectReason = reasoning.confirmation.reason || "Confirmation pending or failed";

      if (reasoning.location.nearResistance && sl >= minScore) {
         addLog(`⏳ ${symbol}: سيناريو صعودي نشط (${reasoning.scenario.primary.type}) لكن السعر ملاصق للمقاومة (${reasoning.location.nearestResistance.toFixed(4)}). بانتظار التأكيد.`, "info");
      } else if (reasoning.flow.state === "SHORT_COVERING") {
         addLog(`⏳ ${symbol}: صعود السعر ناتج عن Short Covering (إغلاق عقود بيع وليس فتح عقود شراء جديدة). انتظار تراكم حقيقي.`, "info");
      }

      // Record in Research Logger for future post-analysis
      logRejectedSignal({
         symbol,
         timeframe: "15m",
         direction: rejectDirection,
         signal_score: rejectScore,
         rejection_reason: rejectReason,
         p,
         w,
         ctx,
         reasoning
      });
   }

   return { signal: "WAIT", sl, ss, reasoning, p, w, ctx };
}

// --- SEC 5: EXECUTION ---
function executeTrade(symbol: string, decision: any) {
   const { p, w, score, grade, setupType, ctx, reasoning } = decision;
   const isPullback = setupType === "PULLBACK_SNIPER";
   const riskAmt = virtualBalance * grade.risk * grade.mult;

   const entryTiming = extractEntryTiming();
   const marketRegimeContext = extractMarketRegimeContext(p, ctx, reasoning);

   if (decision.signal === "LONG") {
      const entry = p.price;
      const c = p.klines;
      const realLow = Math.min(c[c.length-1].low, c[c.length-2].low, c[c.length-3].low);
      const slMultiplier = isPullback ? Math.min(slAtrMultiplier, 1.0) : slAtrMultiplier;
      const sl = isPullback 
         ? Math.min(realLow, p.ema21) - (p.atr14 * slMultiplier)
         : realLow - (p.atr14 * slMultiplier);
      const realSlDist = entry - sl;
      if (realSlDist <= 0) return;
      const initialSlDist = Math.abs(entry - sl);

      const tp1 = entry + (initialSlDist * TP1_R); // Quick Win TP1 (Banks 40% of trade)
      const tp2 = entry + (initialSlDist * TP2_R); // Major Target TP2 (Banks 35% of trade)
      const tp3 = entry + (initialSlDist * TP3_R); // Runner TP3 (Banks 25% of trade)

      const calculatedRR = (tp3 - entry) / realSlDist;
      if (calculatedRR < MIN_RR_REQUIRED) {
         addLog(`❌ رُفض LONG ${symbol}: RR الفعلي (${calculatedRR.toFixed(2)}) أقل من الحد الأدنى (${MIN_RR_REQUIRED})`, "error");
         return;
      }

      let pos = riskAmt / realSlDist;
      const newTrade = {
         symbol, direction: "LONG", entry, sl, initialSlDist, tp1, tp2, tp3,
         pos, initialPos: pos, entryTime: new Date().toISOString(),
         entryTiming, marketRegimeContext,
         part_a: 0.40, part_b: 0.35, part_c: 0.25,
         a_closed: false, b_closed: false, c_closed: false,
         be_done: false, score, grade: grade.label, pnl: 0,
         setupType: decision.setupType || (isPullback ? "PULLBACK_SNIPER" : "BREAKOUT_MOMENTUM"),
         setupLabel: decision.setupType === "FORMING_EARLY_LONG" 
            ? "🌱 تشكّل مبكر" 
            : (isPullback ? "🎯 قناص الارتداد" : "⚡ اختراق الزخم"),
         atr: p.atr14, peak_r: 0,
         reasoning: decision.reasoning,
         highestPrice: entry,
         lowestPrice: entry,
         candlesBeforeEntry: formatCandles(p.klines || [], 40),
         directionState: decision.dirDecision?.state || "CONFIRMED_LONG",
         directionEvidence: decision.dirDecision?.evidenceChain,
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
      };
      activeTrades.push(newTrade);
      registerTradeForDirectionTracking(newTrade);
      addLog(`✅ LONG ${symbol} [${isPullback ? '🎯 قناص الارتداد' : '⚡ اختراق الزخم'}] | دخول: ${entry.toFixed(4)} | SL: ${sl.toFixed(4)} | النقاط: ${score.toFixed(1)}/10`, "success");
   } else {
      const entry = p.price;
      const c = p.klines;
      const realHigh = Math.max(c[c.length-1].high, c[c.length-2].high, c[c.length-3].high);
      const slMultiplier = isPullback ? Math.min(slAtrMultiplier, 1.0) : slAtrMultiplier;
      const sl = isPullback 
         ? Math.max(realHigh, p.ema21) + (p.atr14 * slMultiplier)
         : realHigh + (p.atr14 * slMultiplier);
      const realSlDist = sl - entry;
      if (realSlDist <= 0) return;
      const initialSlDist = Math.abs(entry - sl);

      const tp1 = entry - (initialSlDist * TP1_R);
      const tp2 = entry - (initialSlDist * TP2_R);
      const tp3 = entry - (initialSlDist * TP3_R);

      const calculatedRR = (entry - tp3) / realSlDist;
      if (calculatedRR < MIN_RR_REQUIRED) {
         addLog(`❌ رُفض SHORT ${symbol}: RR الفعلي (${calculatedRR.toFixed(2)}) أقل من الحد الأدنى (${MIN_RR_REQUIRED})`, "error");
         return;
      }

      let pos = riskAmt / realSlDist;
      const newTrade = {
         symbol, direction: "SHORT", entry, sl, initialSlDist, tp1, tp2, tp3,
         pos, initialPos: pos, entryTime: new Date().toISOString(),
         entryTiming, marketRegimeContext,
         part_a: 0.40, part_b: 0.35, part_c: 0.25,
         a_closed: false, b_closed: false, c_closed: false,
         be_done: false, score, grade: grade.label, pnl: 0,
         setupType: decision.setupType || (isPullback ? "PULLBACK_SNIPER" : "BREAKDOWN_MOMENTUM"),
         setupLabel: decision.setupType === "FORMING_EARLY_SHORT" 
            ? "🌱 تشكّل مبكر" 
            : (isPullback ? "🎯 قناص الارتداد" : "⚡ اختراق الزخم"),
         atr: p.atr14, peak_r: 0,
         reasoning: decision.reasoning,
         highestPrice: entry,
         lowestPrice: entry,
         candlesBeforeEntry: formatCandles(p.klines || [], 40),
         directionState: decision.dirDecision?.state || "CONFIRMED_SHORT",
         directionEvidence: decision.dirDecision?.evidenceChain,
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
      };
      activeTrades.push(newTrade);
      registerTradeForDirectionTracking(newTrade);
      addLog(`✅ SHORT ${symbol} [${isPullback ? '🎯 قناص الارتداد' : '⚡ اختراق الزخم'}] | دخول: ${entry.toFixed(4)} | SL: ${sl.toFixed(4)} | النقاط: ${score.toFixed(1)}/10`, "success");
   }
}

// --- SEC 6: EXIT BRAIN ---
async function exitBrain(trade: any, ctx: any) {
   const t = trade;
   const w = await readWhale(t.symbol, 0); // Fast check
   const p = await readPrice(t.symbol, w.c15);
   
   const price = p.price;
   t.currentPrice = price;

   const slDist = t.initialSlDist || Math.abs(t.entry - t.sl);
   const profitR = t.direction === "LONG" ? (price - t.entry)/slDist : (t.entry - price)/slDist;
   t.profitR = profitR;
   if (profitR > t.peak_r) t.peak_r = profitR;

   // Floating PnL Mark-to-Market calculation (Exact match with closePart and closeTradeFull formulas)
   const effectiveExitPrice = t.direction === "LONG"
      ? price * (1 - slippageRate)
      : price * (1 + slippageRate);

   const rawRemainingFloating = (t.direction === "LONG" ? (effectiveExitPrice - t.entry) : (t.entry - effectiveExitPrice)) * t.pos;
   const estimatedRemainingFees = ((t.entry * t.pos) + (effectiveExitPrice * t.pos)) * feeRate;
   const remainingNetFloating = rawRemainingFloating - estimatedRemainingFees;

   // t.pnl represents total Mark-to-Market net PnL of this trade (realized from partials + unrealized remaining)
   t.pnl = (t.realizedPnl || 0) + remainingNetFloating;

   // Record trade journey periodic snapshot (MFE/MAE tracking)
   logTradeJourneySnapshot(t, price, t.pnl);

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

   const peakMfe = t.peak_r || profitR;

   // ═══ DIRECTION LIFECYCLE MANAGEMENT (State-driven exits & protections) ═══
   const dirEngine = getDirectionEngine(t.symbol);
   if (p.klines && p.klines.length > 0) {
      const lastK = p.klines[p.klines.length - 1];
      const dirDecision = dirEngine.processCandle({
         time: lastK.openTime || Date.now(),
         open: lastK.open,
         high: lastK.high,
         low: lastK.low,
         close: price,
         volume: lastK.volume || 1000,
         takerBuyBase: lastK.takerBuyBase
      }, { regime: ctx.regime, btc_chg: ctx.btc_chg }, { oiChg: w.oi_chg });

      t.directionState = dirDecision.state;

      // 1. WEAKENING: Protect profits / tighten stop
      if ((t.direction === "LONG" && dirDecision.state === "WEAKENING_LONG") ||
          (t.direction === "SHORT" && dirDecision.state === "WEAKENING_SHORT")) {
         if (profitR > 0.20 && !t.weakening_protected) {
            t.weakening_protected = true;
            const protectSl = t.direction === "LONG" 
               ? Math.max(t.sl, t.entry + (slDist * Math.max(0.10, profitR - 0.25)))
               : Math.min(t.sl, t.entry - (slDist * Math.max(0.10, profitR - 0.25)));
            t.sl = protectSl;
            addLog(`⚠️ [DIRECTION WEAKENING] ${t.symbol}: ضعف هيكلي مؤكد (${dirDecision.state}) | تم تضييق الوقف لحماية الأرباح عند ${profitR.toFixed(2)}R`, "warn");
         }
      }

      // 2. INVALIDATION: Immediate exit upon thesis death
      if ((t.direction === "LONG" && dirDecision.state === "INVALIDATED_LONG") ||
          (t.direction === "SHORT" && dirDecision.state === "INVALIDATED_SHORT")) {
         addLog(`🛑 [DIRECTION INVALIDATED] ${t.symbol}: إبطال فرضية الاتجاه بالكامل (${dirDecision.state}) | خروج فوري عند ${profitR.toFixed(2)}R لتجنب الخسارة الكبرى`, "error");
         closeTradeFull(t, "Direction Thesis Invalidated");
         return;
      }
   }

   // --- TIER-1 GIVEBACK PROTECTION (Works before and after TP1) ---
   // FEATURE FLAG: Disabled in production to allow trades like RAYSOL to breathe. Telemetry preserved.
   if (ENABLE_PRE_TP1_GIVEBACK_EXIT && peakMfe >= 0.55 && (peakMfe - profitR) >= 0.25) {
      closeTradeFull(t, `Giveback Protected Exit (+${profitR.toFixed(2)}R)`);
      return;
   }
   // -------------------------------------------------------------

   // 1. QUICK WIN & BREAKEVEN LOCK (TP1: +0.75R)
   if (!t.a_closed) {
      if (profitR >= TP1_R) {
         closePart(t, "A", t.part_a);
         // Move SL to Entry + 0.30R (Base Profit Floor: secures +0.30R floor on remaining 60%)
         const baseFloorSl = t.direction === "LONG" ? t.entry + (slDist * 0.30) : t.entry - (slDist * 0.30);
         t.sl = baseFloorSl;
         t.a_closed = true; 
         t.be_done = true;
         addLog(`🎯 هدف أول (40%) ${t.symbol} | +${TP1_R}R | 🛡️ تم نقل الوقف لقاع حماية الأرباح +0.30R (حماية الـ 60% المتبقية)`, 'success');
      }
      // Note: Pre-TP1 profit protection / breakeven moves before +0.75R (e.g. at +0.35R) are DISABLED.
      // Pre-TP1 allows only Initial Stop + Early Structural Invalidation.
   }

   // 2. PROFIT EXPANSION (TP2: +1.80R) & CONSERVATIVE HYBRID PROTECTIONS
   if (t.a_closed && !t.b_closed) {
      const peakMfe = t.peak_r || profitR;

      // Base Profit Floor Guarantee: Ensure stop is NEVER worse than +0.30R
      const baseFloorSl = t.direction === "LONG" ? t.entry + (slDist * 0.30) : t.entry - (slDist * 0.30);
      if (t.direction === "LONG") {
         t.sl = Math.max(t.sl, baseFloorSl);
      } else {
         t.sl = Math.min(t.sl, baseFloorSl);
      }

      // Feature Flag: MFE Milestones (+1.00R -> +0.50R, +1.50R -> +0.90R)
      // Isolated behind feature flag (default false) to test separately against Base +0.30R floor
      if (ENABLE_MFE_MILESTONE_STOPS) {
         // Milestone 1: At +1.00R MFE -> Advance SL to +0.50R
         const targetSl50 = t.direction === "LONG" ? t.entry + (slDist * 0.50) : t.entry - (slDist * 0.50);
         if (peakMfe >= 1.00 && !t.milestone_1r_locked) {
            if (t.direction === "LONG" ? t.sl < targetSl50 : t.sl > targetSl50) {
               t.sl = targetSl50;
               t.milestone_1r_locked = true;
               addLog(`🛡️ [MILESTONE 1] ${t.symbol}: وصول MFE إلى +${peakMfe.toFixed(2)}R | تم رفع الوقف وتأمين +0.50R رابحة`, 'info');
            }
         }

         // Milestone 2: At +1.50R MFE -> Advance SL to +0.90R
         const targetSl90 = t.direction === "LONG" ? t.entry + (slDist * 0.90) : t.entry - (slDist * 0.90);
         if (peakMfe >= 1.50 && !t.milestone_1_5r_locked) {
            if (t.direction === "LONG" ? t.sl < targetSl90 : t.sl > targetSl90) {
               t.sl = targetSl90;
               t.milestone_1_5r_locked = true;
               addLog(`🛡️ [MILESTONE 2] ${t.symbol}: وصول MFE إلى +${peakMfe.toFixed(2)}R | تم رفع الوقف وتأمين +0.90R رابحة`, 'info');
            }
         }
      }

      // Feature Flag: Dynamic Giveback Protection (MFE >= +1.15R && giveback >= 0.35R)
      // Isolated behind feature flag (default false) to prevent choking runners like RAVE
      if (ENABLE_POST_TP1_GIVEBACK_EXIT && peakMfe >= 1.15) {
         const givebackDecay = peakMfe - profitR;
         const givebackThreshold = 0.35;
         if (givebackDecay >= givebackThreshold) {
            addLog(`🛡️ [GIVEBACK PROTECT] ${t.symbol}: تراجع ${givebackDecay.toFixed(2)}R من قمة +${peakMfe.toFixed(2)}R | إغلاق وتأمين الأرباح المتبقية عند +${profitR.toFixed(2)}R`, 'warn');
            closeTradeFull(t, `Giveback Protected Exit (+${profitR.toFixed(2)}R)`);
            return;
         }
      }

      if (profitR >= TP2_R) {
         closePart(t, "B", t.part_b);
         t.b_closed = true;
         // Lock in TP1 level as floor profit (+0.75R)
         const targetSlTp1 = t.direction === "LONG" ? t.entry + (slDist * TP1_R) : t.entry - (slDist * TP1_R);
         if (t.direction === "LONG" ? t.sl < targetSlTp1 : t.sl > targetSlTp1) {
            t.sl = targetSlTp1;
         }
         addLog(`🎯 هدف ثانٍ (35%) ${t.symbol} | +${TP2_R}R | تم حجز الأرباح ورفع الوقف لمستوى +${TP1_R}R`, 'success');
      } else if ((exhaust >= 7 || peak >= 7) && profitR > 1.2) {
         closePart(t, "B", t.part_b);
         t.b_closed = true;
      }
   }

   // --- MOMENTUM STAGNATION CUT ---
   const entryMs = typeof t.entryTime === "number" ? t.entryTime : new Date(t.entryTime).getTime();
   const nowMs = p.time ? (typeof p.time === "number" ? p.time : new Date(p.time).getTime()) : Date.now();
   const tradeAgeMinutes = (nowMs - entryMs) / 60000;
   const isUnderEma = t.direction === "LONG" ? price < p.ema21 : price > p.ema21;
   if (tradeAgeMinutes >= 35 && (t.peak_r || profitR) <= 0.15 && isUnderEma && profitR <= 0.0) {
       closeTradeFull(t, "Momentum Stagnation Cut");
       return;
   }
   // -------------------------------

   // 3. RUNNER EXIT (TP3: +3.50R+ or Trailing)
   if (t.b_closed && !t.c_closed) {
      const baseFloorSl = t.direction === "LONG" ? t.entry + (slDist * 0.30) : t.entry - (slDist * 0.30);
      if (t.direction === "LONG") { 
         t.sl = Math.max(t.sl, price - trailDist, baseFloorSl); 
      } else { 
         t.sl = Math.min(t.sl, price + trailDist, baseFloorSl); 
      }

      if (profitR >= TP3_R || exhaust >= 8 || peak >= 8) {
         closePart(t, "C", t.part_c);
         t.c_closed = true;
         addLog(`🏁 هدف ثالث نهائي (25%) ${t.symbol} | +${TP3_R}R صيد الاتجاه بالكامل 🏆`, 'success');
         closeTradeFull(t, "TP3 Full Target Hit");
         return;
      }
   }

   // 4. SMART EARLY LOSS MITIGATION
   // If trade immediately fails structurally and drops below -0.4R with bearish breakdown, cut early to save 60% of SL!
   if (!t.a_closed && profitR <= -0.40) {
      const c = p.klines;
      const recentCloses = c.slice(-2).map((k: any) => k.close);
      const isBreakingEMA = t.direction === "LONG" 
         ? recentCloses.every((cl: number) => cl < p.ema21) 
         : recentCloses.every((cl: number) => cl > p.ema21);
      
      if (isBreakingEMA) {
         addLog(`🛡️ إغلاق وقائي ذكي ${t.symbol}: كسر هيكلي مبكر عند ${profitR.toFixed(2)}R | تم توفير ${(1 + profitR).toFixed(2)}R من الخسارة`, 'warn');
         closeTradeFull(t, "Early Invalidation");
         return;
      }
   }

   // Hard SL Hit
   if (t.direction === "LONG" && price <= t.sl) closeTradeFull(t, t.be_done ? "Breakeven Protected Exit" : "SL Hit");
   if (t.direction === "SHORT" && price >= t.sl) closeTradeFull(t, t.be_done ? "Breakeven Protected Exit" : "SL Hit");
}

function bodySize(klines: any[]) { return Math.abs(klines[klines.length-1].close - klines[klines.length-1].open); }

function closePart(t: any, part: string, pct: number) {
   const size = t.initialPos * pct;
   t.pos -= size;
   
   // Effective exit price with simulated slippage
   const effectiveExitPrice = t.direction === "LONG"
      ? t.currentPrice * (1 - slippageRate)
      : t.currentPrice * (1 + slippageRate);

   const rawPnl = (t.direction === "LONG" ? (effectiveExitPrice - t.entry) : (t.entry - effectiveExitPrice)) * size;
   const tradeFees = ((t.entry * size) + (effectiveExitPrice * size)) * feeRate;
   const realizedPnl = rawPnl - tradeFees;

   t.realizedPnl = (t.realizedPnl || 0) + realizedPnl;
   t.totalFees = (t.totalFees || 0) + tradeFees;
   virtualBalance += realizedPnl;
}

function closeTradeFull(t: any, reason: string = "") {
   if (t.pos > 0) {
      const effectiveExitPrice = t.direction === "LONG"
         ? t.currentPrice * (1 - slippageRate)
         : t.currentPrice * (1 + slippageRate);

      const rawFinalPnl = (t.direction === "LONG" ? (effectiveExitPrice - t.entry) : (t.entry - effectiveExitPrice)) * t.pos;
      const finalFees = ((t.entry * t.pos) + (effectiveExitPrice * t.pos)) * feeRate;
      const finalPnl = rawFinalPnl - finalFees;

      t.realizedPnl = (t.realizedPnl || 0) + finalPnl;
      t.totalFees = (t.totalFees || 0) + finalFees;
      virtualBalance += finalPnl;
   }

   t.exitTime = new Date().toISOString();
   t.exitReason = reason;
   t.finalPnl = t.realizedPnl || 0;
   closedTrades.unshift(t);
   t.pos = 0;
   todaysStats.count++;

   // Neutral Breakeven threshold: avoid counting fee-friction scratches as distorted losses or false big wins
   const rThreshold = 0.05;
   if (t.profitR > rThreshold && t.finalPnl > 0.15) {
      todaysStats.wins++;
   } else if (t.profitR < -rThreshold && t.finalPnl < -0.15) {
      todaysStats.losses++;
   }

   todaysStats.pnl += t.finalPnl;
   activeTrades = activeTrades.filter(tr => tr !== t);
   if (reason) addLog(`🛑 Full Exit ${t.symbol}: ${reason} | Net PnL: $${t.finalPnl.toFixed(2)} (${t.profitR.toFixed(2)}R)`, t.finalPnl >= 0 ? 'success' : 'warn');

   // Record full post-trade diagnostic analysis in Research Logger
   logTradeDecision(t, {
      exitPrice: t.currentPrice || t.entry,
      exitReason: reason || "Manual/Emergency Exit",
      finalPnl: t.finalPnl,
      fees: t.totalFees || 0
   });
}

// --- SEC 9: MAIN LOOP ---
export async function runApexLoop() {
   if (!botActive || isLoopRunning) return;

   isLoopRunning = true;
   try {
      resetDailyStatsIfNeeded();
      await updateDynamicWatchlist();
      const ctx = await getContext();
      
      // Manage open trades FIRST (Always runs, updating fresh mark-to-market prices, exits, and fees)
      for (const t of activeTrades) {
         await exitBrain(t, ctx);
      }

      // Calculate overall Net PnL (Fully consistent mark-to-market across closed & active)
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

      // Daily Loss Limit Protection (4% of initial balance, including floating PnL)
      const dailyLossLimit = initialVirtualBalance * MAX_DAILY_LOSS;
      let openFloatingPnl = 0;
      for (const t of activeTrades) {
         if (t.pnl) openFloatingPnl += t.pnl;
      }
      const totalDailyPnl = todaysStats.pnl + openFloatingPnl;

      if (totalDailyPnl <= -dailyLossLimit) {
         addLog(`🛑 DAILY LOSS LIMIT REACHED: إجمالي خسارة اليوم (محققة + عائمة) $${totalDailyPnl.toFixed(2)} بلغت الحد الأقصى -$${dailyLossLimit.toFixed(2)} (4%). تم منع فتح صفقات جديدة لهذا اليوم مع استمرار إدارة الصفقات المفتوحة.`, "error");
         isLoopRunning = false;
         return; // Only skip scanning and new trade entry for this cycle, keeping bot active to manage existing trades!
      }

      // BTC Violent Regime check: if BTC is violent (ctx.tradeable === false), block new trades
      if (ctx.tradeable === false) {
         addLog("⚠️ BTC Violent Regime: تم حظر فتح صفقات جديدة نظراً لتذبذب بيتكوين العنيف.", "warn");
         isLoopRunning = false;
         return;
      }

      // Capacity check: If freeTradeSlotEnabled, trades at Breakeven (zero risk) don't block new opportunities
      const riskedTrades = activeTrades.filter(t => !t.be_done);
      const isCapacityFull = freeTradeSlotEnabled
         ? (riskedTrades.length >= maxOpenTradesConfig || activeTrades.length >= maxOpenTradesConfig + 2)
         : (activeTrades.length >= maxOpenTradesConfig);

      if (isCapacityFull) {
         isLoopRunning = false;
         return;
      }

      // Check Libya Schedule before opening new trades
      if (!isLibyaTradingAllowed()) {
         isLoopRunning = false;
         return;
      }

      // Ensure index is valid
      if (currentBatchIndex >= WATCHLIST.length) {
         currentBatchIndex = 0;
      }

      const batchSize = scanBatchSize;
      const endBatchIndex = Math.min(currentBatchIndex + batchSize, WATCHLIST.length);
      const batchSymbols = WATCHLIST.slice(currentBatchIndex, endBatchIndex);
      
      addLog(`🦅 SCANNING TURBO BATCH [${currentBatchIndex + 1} TO ${endBatchIndex}] من ${WATCHLIST.length} عملة...`, "info");
      
      // Advance index for next run
      currentBatchIndex = endBatchIndex;
      if (currentBatchIndex >= WATCHLIST.length) {
         currentBatchIndex = 0; // Reset
      }

      const canOpenMore = () => {
         const currentRisked = activeTrades.filter(t => !t.be_done).length;
         if (freeTradeSlotEnabled) {
            return currentRisked < maxOpenTradesConfig && activeTrades.length < (maxOpenTradesConfig + 2);
         }
         return activeTrades.length < maxOpenTradesConfig;
      };

      // Process batch symbols in fast concurrent chunks of 5
      const chunkSize = 5;
      for (let i = 0; i < batchSymbols.length; i += chunkSize) {
         if (!canOpenMore()) break;
         const chunk = batchSymbols.slice(i, i + chunkSize);
         const promises = chunk.map(async (sym: string) => {
            if (activeTrades.find(t => t.symbol === sym)) return null;
            try {
               const dec = await scoreEntry(sym, ctx);
               return { sym, dec };
            } catch {
               return null;
            }
         });

         const results = await Promise.allSettled(promises);
         for (const res of results) {
            if (res.status === "fulfilled" && res.value) {
               const { sym, dec } = res.value;
               if (!canOpenMore()) break;
               if (activeTrades.find(t => t.symbol === sym)) continue;
               if (dec.signal === "LONG" || dec.signal === "SHORT") {
                  executeTrade(sym, dec);
               }
            }
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
   watcherInterval = setInterval(runApexLoop, 30 * 1000); // Check every 30 seconds for turbo responsiveness
   runApexLoop();
   addLog("Apex Predator Engine Started with Turbo Scanner & Pullback Sniper", "success");
}
