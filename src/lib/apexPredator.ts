import axios from "axios";
import { calcEMA, calcATR, calcADX, calcMACD, calcRSI, calcSupertrend } from "./indicators.js";
import { evaluateSymbolReasoning, ReasoningResult } from "./reasoningEngine.js";
import { evaluateExitEvidence } from "./exitEvidenceEngine.js";
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

// ═══ CONFIGURATION ═══
let WATCHLIST: string[] = [
   "BTCUSDT", "ETHUSDT", "SOLUSDT", "AVAXUSDT",
   "LINKUSDT", "INJUSDT", "ARBUSDT", "CRVUSDT",
   "AAVEUSDT", "OPUSDT"
];
let HOT_WATCHLIST: string[] = [
   "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
   "SUIUSDT", "NEARUSDT", "AVAXUSDT", "DOGEUSDT"
];
let currentBatchIndex = 0;
let lastWatchlistUpdate = 0;
let lastHotWatchlistUpdate = 0;


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

export function resetAccountState() {
  virtualBalance = 1000;
  initialVirtualBalance = 1000;
  todaysStats = { count: 0, wins: 0, losses: 0, pnl: 0, sumR: 0 };
  closedTrades = closedTrades.filter(t => t.symbol !== 'AMZNUSDT' && !((t.pos || t.initialPos) > 100));
  activeTrades = activeTrades.filter(t => t.symbol !== 'AMZNUSDT');
  addLog(`✨ [ACCOUNT REFRESH] تم تطهير الصفقات الشاذة وإعادة ضبط رصيد الحساب إلى $1,000 وإلغاء قفل الخسارة اليومية.`, 'success');
}

export function updateConfig(balance: number, maxTrades: number, opts?: any) {
  initialVirtualBalance = balance;
  if (opts?.resetAccount || (closedTrades.length === 0 && activeTrades.length === 0)) {
     virtualBalance = balance;
     todaysStats = { count: 0, wins: 0, losses: 0, pnl: 0, sumR: 0 };
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
    hotWatchlistLength: HOT_WATCHLIST.length,
    hotWatchlist: HOT_WATCHLIST.slice(0, 8),
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
      const needsFullUpdate = now - lastWatchlistUpdate >= 2 * 60 * 60 * 1000 || WATCHLIST.length < 20;
      const needsHotUpdate = now - lastHotWatchlistUpdate >= 60 * 1000 || HOT_WATCHLIST.length < 5;

      if (!needsFullUpdate && !needsHotUpdate) {
         return;
      }

      const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/ticker/24hr`, { timeout: 8000 });
      if (!Array.isArray(res.data) || res.data.length === 0) return;
      
      const excludedBases = [
         'USDC', 'BUSD', 'TUSD', 'FDUSD', 'USDD', 'PYUSD', 'DAI', 'USDP', 'TRUE', 'EUR', 'GBP', 'AEUR', 'PAXG', 'XAUT',
         'AMZN', 'AAPL', 'TSLA', 'GOOGL', 'GOOG', 'MSFT', 'NVDA', 'META', 'NFLX', 'BABA', 'COIN', 'MSTR',
         'EWY', 'MINIMAX', 'SAMSUNG', 'AVGO', 'INTC', 'COPPER', 'KORU', 'XAG', 'NATGAS', 'BZ', 'DRAM'
      ];
      
      const validTickers = res.data.filter((s: any) => {
         if (!s.symbol || !s.symbol.endsWith('USDT')) return false;
         const base = s.symbol.replace('USDT', '');
         if (excludedBases.includes(base)) return false;
         const quoteVol = parseFloat(s.quoteVolume) || 0;
         return quoteVol >= 15_000_000; // Require at least 15M USDT 24h volume
      });

      // 1. Dynamic Fast Momentum Queue (HOT_WATCHLIST)
      if (needsHotUpdate) {
         const coreCryptoMajors = [
            "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
            "SUIUSDT", "NEARUSDT", "AVAXUSDT", "DOGEUSDT"
         ];

         const activeMovers = [...validTickers]
            .filter((s: any) => Math.abs(parseFloat(s.priceChangePercent) || 0) >= 2.0)
            .sort((a: any, b: any) => {
               const scoreA = Math.abs(parseFloat(a.priceChangePercent) || 0) * Math.log10(parseFloat(a.quoteVolume) || 1);
               const scoreB = Math.abs(parseFloat(b.priceChangePercent) || 0) * Math.log10(parseFloat(b.quoteVolume) || 1);
               return scoreB - scoreA;
            })
            .map((s: any) => s.symbol);

         const combinedHot = Array.from(new Set([...activeMovers.slice(0, 14), ...coreCryptoMajors])).slice(0, 20);
         if (combinedHot.length >= 5) {
            HOT_WATCHLIST = combinedHot;
            lastHotWatchlistUpdate = now;
         }
      }

      // 2. Full WATCHLIST (Broader Liquid Universe)
      if (needsFullUpdate) {
         const sortedByVol = [...validTickers]
            .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, 120)
            .map((s: any) => s.symbol);

         if (sortedByVol.length > 0) {
            WATCHLIST = sortedByVol;
            lastWatchlistUpdate = now;
            currentBatchIndex = 0;
            addLog(`✅ تم تحديث قوائم العملات: ${HOT_WATCHLIST.length} عملة بالقائمة الساخنة الفورية (HOT) و ${WATCHLIST.length} عملة بالقائمة الموسعة.`, "success");
         }
      }
   } catch (e: any) {
      console.warn(`Watchlist update notice: ${e.message}`);
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
   const rvol = c15_0.volume / (avgVol15m || 1);
   
   const volThreshold = Number(btcVolThresholdStr) / 100;
   const isExtremeVol = Math.abs(btc_15m_chg) > volThreshold && rvol > 2.5;

   // Analyze BTC 15m candle structure to distinguish directional dump/pump from erratic 2-way whipsaw
   const btc_body = Math.abs(c15_0.close - c15_0.open);
   const btc_range = c15_0.high - c15_0.low;
   const btc_body_ratio = btc_range > 0 ? btc_body / btc_range : 0.5;

   // Directional Dump: BTC is plunging with bearish body and strong volume (Prime SHORT regime!)
   const btc_dump = btc_15m_chg < -volThreshold && c15_0.close < c15_0.open && btc_body_ratio > 0.40;

   // Directional Pump: BTC is exploding upward with bullish body and strong volume (Prime LONG regime!)
   const btc_pump = btc_15m_chg > volThreshold && c15_0.close > c15_0.open && btc_body_ratio > 0.40;

   // Erratic whipsaw: high volatility but indecisive body with large 2-way wicks (liquidation chop)
   const btc_whipsaw = isExtremeVol && !btc_dump && !btc_pump;

   // Calculate 24h momentum for BTC to distinguish between true trends and sideways consolidation:
   const c4h_start = btc4h[Math.max(0, btc4h.length - 6)]; // 24h ago (6 * 4h candles)
   const btc_24h_chg = c4h_start ? (price - c4h_start.close) / c4h_start.close : 0;

   let regime = "NEUTRAL_CONSOLIDATION";

   if (btc_dump) {
      regime = "BEAR_STRONG";
   } else if (btc_pump) {
      regime = "BULL_STRONG";
   } else if (Math.abs(btc_24h_chg) <= 0.010 && Math.abs(btc_15m_chg) <= 0.008) {
      regime = "NEUTRAL_CONSOLIDATION";
   } else if (price > ema50 && ema50 > ema200 && hh_hl && btc_24h_chg > 0.012) {
      regime = "BULL_STRONG";
   } else if (price > ema50 && ema50 > ema200) {
      regime = "BULL_WEAK";
   } else if (price > ema200 && btc_24h_chg > 0.010) {
      regime = "BULL_WEAK";
   } else if (price < ema50 && ema50 < ema200 && lh_ll && btc_24h_chg < -0.012) {
      regime = "BEAR_STRONG";
   } else if (price < ema50 && ema50 < ema200 && btc_24h_chg < -0.008) {
      regime = "BEAR_WEAK";
   } else if (price < ema200 && btc_24h_chg < -0.012) {
      regime = "BEAR_WEAK";
   } else {
      regime = "NEUTRAL_CONSOLIDATION";
   }

   const fundBtc = await fetchFunding("BTCUSDT");
   const avg_fund = fundBtc;

   return {
      regime,
      tradeable: !btc_whipsaw, // Only block completely during erratic 2-way whipsaws!
      tradeableDirection: btc_dump ? "SHORT_ONLY" : (btc_pump ? "LONG_ONLY" : "BOTH"),
      btc_dump,
      btc_pump,
      btc_whipsaw,
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
   let oi_available = false;
   if (oiData && oiData.length >= 4) {
      const oi0 = parseFloat(oiData[oiData.length-1].sumOpenInterest);
      const oi3 = parseFloat(oiData[0].sumOpenInterest);
      if (Number.isFinite(oi0) && Number.isFinite(oi3) && oi3 > 0) {
         oi_chg = (oi0 - oi3) / oi3;
         oi_available = Number.isFinite(oi_chg);
      }
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
      scenario, oi_chg, oi_available, p_chg, fund,
      f_danger: Math.abs(fund) > 0.07/100,
      f_gold_long: fund < -0.03/100,
      f_gold_short: fund > 0.04/100,
      strong_acc: pressure > avgVol * 2.0,
      strong_dis: pressure < -avgVol * 2.0,
      asset_strong, c15, c5, slope5, slope15, slope4h
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
   if (geniusMode && Math.abs(ctx.btc_chg) > (Number(btcVolThresholdStr) / 100) && !ctx.btc_dump && !ctx.btc_pump && p.rvol < 1.0) earlyReason = "Low Vol during BTC Chaos";
   if (geniusMode && p.body < p.u_wick && p.body < p.l_wick && p.rsi > 45 && p.rsi < 55) earlyReason = "Indecision Doji";

   let sl = 0.0, ss = 0.0;
   let setupType = "BREAKOUT_MOMENTUM";

   // Layer 1
   let layer1_sl = 0, layer1_ss = 0;
   if (ctx.regime === "BULL_STRONG") { layer1_sl += 3.0; }
   else if (ctx.regime === "BULL_WEAK") { layer1_sl += 2.0; layer1_ss += 0.5; }
   else if (ctx.regime === "BEAR_WEAK") { layer1_sl += 0.5; layer1_ss += 2.0; }
   else if (ctx.regime === "BEAR_STRONG") { layer1_ss += 3.0; }
   else if (ctx.regime === "NEUTRAL_CONSOLIDATION" || ctx.regime === "RANGING") { layer1_sl += 1.5; layer1_ss += 1.5; }
   sl += layer1_sl; ss += layer1_ss;
   if (layer1_sl > 0 || layer1_ss > 0) apexPredatorStats.rules.market_context.passed++; 
   else {
       apexPredatorStats.rules.market_context.failed++;
       console.log(`[Market Context Failed] ctx.regime=${ctx.regime}, price=${ctx.price}, ema200=${ctx.ema200}`);
   }

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

   // Multi-Timeframe 5m Confluence bonus
   if (p.conf5_bull) sl += 0.8;
   if (p.conf5_bear) ss += 0.8;

   // Trend Pullback Sniper Model bonus
   if (pullbackSniperEnabled) {
      if (p.pullback_long && (w.slope15 >= 0 || w.slope5 >= 0)) {
         sl += 2.2;
         setupType = "PULLBACK_SNIPER";
      }
      if (p.pullback_short && (w.slope15 <= 0 || w.slope5 <= 0)) {
         ss += 2.2;
         setupType = "PULLBACK_SNIPER";
      }
   }

   sl = Math.min(Math.max(sl, 0), 10);
   ss = Math.min(Math.max(ss, 0), 10);

   if (sl > 0) apexPredatorStats.totalLongScanned++;
   if (ss > 0) apexPredatorStats.totalShortScanned++;

   if (earlyReason) {
      if (earlyReason === "BLOCKED") return { signal: "BLOCKED" };
      return { signal: "WAIT", reason: earlyReason };
   }

   // High win-rate filters for 3:1 Genius Mode
   if (geniusMode) {
      // Directional Market Enforcement during BTC Expansion
      if (ctx.btc_dump) {
         sl = 0; // Strict: No longs during BTC Dump
         ss += 2.5; // Big tailwind for breakdown shorts
      } else if (ctx.btc_pump) {
         ss = 0; // Strict: No shorts during BTC Pump
         sl += 2.5; // Big tailwind for breakout longs
      }

      // 1. Strict Market Regime filter:
      if (ctx.regime.includes("BEAR")) {
         sl = 0; // Strict: Don't buy in bear regime
      }
      if (ctx.regime.includes("BULL")) {
         ss = 0; // Strict: Don't short in bull regime
      }

      // 2. High-probability RSI Momentum Corridor:
      if (p.rsi > 68) sl -= 2.5; // Avoid buying overbought tops
      const isBearMarket = ctx.regime.includes("BEAR") || ctx.btc_dump;
      if (!isBearMarket && p.rsi < 32) ss -= 2.5; // Avoid shorting oversold bottoms in non-bear markets
      if (isBearMarket && p.rsi < 28) ss -= 2.5; // In bear markets, allow breakdown momentum down to 28
      if (p.rsi >= 50 && p.rsi <= 66) sl += 1.0;
      if (p.rsi <= 50 && p.rsi >= (isBearMarket ? 28 : 34)) ss += 1.0;

      // 3. Supertrend & Trend Confluence:
      if (p.st_bull && p.price > p.ema50) sl += 1.2;
      if (p.st_bear && p.price < p.ema50) ss += 1.2;

      // 4. Whale Orderflow Bias:
      if (w.scenario === "INST_LONG" && w.triple_bull) sl += 1.5;
      if (w.scenario === "INST_SHORT" && w.triple_bear) ss += 1.5;
   }

   function getGrade(score: number) {
      if (score >= 8.5) return { label: "💎 APEX 3:1 GOLD", risk: 0.010, mult: 1.0 };
      if (score >= 7.6) return { label: "🥈 APEX 3:1 SILVER", risk: 0.007, mult: 1.0 };
      if (score >= 6.8) return { label: "🥉 BRONZE", risk: 0.005, mult: 1.0 };
      return { label: "⏳ WAIT", risk: 0, mult: 0 };
   }

   // --- BEAST ARCHITECTURE REASONING EVALUATION ---
   // Evaluates: Market Regime -> Flow Interpretation -> Scenarios -> Location -> Confirmation
   const reasoning: ReasoningResult = evaluateSymbolReasoning(
      symbol,
      ctx,
      p,
      w,
      { sl, ss }
   );

   const minScore = geniusMode ? 7.6 : 6.8;

   // Confirmation Gatekeeper: PREDICTION != ENTRY and SIGNAL != CONFIRMATION
   // Both directional signal AND strict ConfirmationEngine must agree
   if (reasoning.confirmation.isConfirmed) {
      if (reasoning.confirmation.confirmedSignal === "LONG" && sl >= minScore && sl > ss) {
         // REGIME LOCK: مانع صفقات الـ LONG تماماً في حالة البير (BEAR Market)
         if (ctx.regime.includes("BEAR")) {
            addLog(`🛡️ [REGIME LOCK] تم منع صفقة LONG على ${symbol} لأن نظام البيتكوين هابط (${ctx.regime}).`, "warn");
            logRejectedSignal({
               symbol,
               timeframe: "15m",
               direction: "LONG",
               signal_score: sl,
               rejection_reason: `Strict Bear Regime: All LONG trades prohibited during BTC ${ctx.regime} market.`,
               p,
               w,
               ctx,
               reasoning
            });
            return { signal: "WAIT", sl, ss, reasoning, p, w, ctx };
         }

         // SAFETY GATE 2: مانع صفقات الـ LONG أثناء صعود البيتكوين الضعيف
         // الشرط: إذا كان نظام البيتكوين BTC = BULL_WEAK وحالة العملة هابطة TREND_DOWN أو مرحلة انتقالية TRANSITION.
         if (ctx.regime === "BULL_WEAK" && (reasoning.regime === "TREND_DOWN" || reasoning.regime === "TRANSITION")) {
            addLog(`🛡️ [SAFETY GATE] تم منع صفقة LONG على ${symbol} لأن البيتكوين في صعود ضعيف (BTC BULL_WEAK) وحالة الأصل (${reasoning.regime}).`, "warn");
            logRejectedSignal({
               symbol,
               timeframe: "15m",
               direction: "LONG",
               signal_score: sl,
               rejection_reason: `Safety Gate: BTC BULL_WEAK with Asset ${reasoning.regime}. Buying weak assets prohibited.`,
               p,
               w,
               ctx,
               reasoning
            });
            return { signal: "WAIT", sl, ss, reasoning, p, w, ctx };
         }

         // SAFETY GATE 3: مانع الشراء في النطاق العرضي (فخ السيولة - RANGE Long Trap)
         // الشرط: حظر صفقات الـ LONG نهائياً إذا كانت العملة في نطاق عرضي (Asset = RANGE) أثناء أي صعود للبيتكوين (BULL_STRONG أو BULL_WEAK).
         if (reasoning.regime === "RANGE" && (ctx.regime === "BULL_STRONG" || ctx.regime === "BULL_WEAK")) {
            addLog(`🛡️ [LIQUIDITY TRAP] تم منع صفقة LONG على ${symbol} لأن الأصل في نطاق عرضي (RANGE) أثناء صعود البيتكوين (${ctx.regime}).`, "warn");
            logRejectedSignal({
               symbol,
               timeframe: "15m",
               direction: "LONG",
               signal_score: sl,
               rejection_reason: `Liquidity Trap Gate: RANGE Long prohibited during BTC ${ctx.regime} (altcoin liquidity drain).`,
               p,
               w,
               ctx,
               reasoning
            });
            return { signal: "WAIT", sl, ss, reasoning, p, w, ctx };
         }

         // SAFETY GATE 4: مانع التذبذب الميت وعديم الزخم (Dead Chop Filter في الـ RANGE)
         if (reasoning.regime === "RANGE") {
            const hasExplosiveRvol = p.rvol >= 2.0;
            const hasDirectionalMomentum = p.adx >= 22 && p.di_plus > p.di_minus;
            if (!hasExplosiveRvol || !hasDirectionalMomentum) {
               addLog(`🛡️ [DEAD CHOP] تم منع صفقة LONG على ${symbol} في الـ RANGE لعدم توفر حجم انفجاري (RVOL >= 2.0) وقوة اتجاهية صاعدة (ADX >= 22 مع DI+ > DI-).`, "warn");
               logRejectedSignal({
                  symbol,
                  timeframe: "15m",
                  direction: "LONG",
                  signal_score: sl,
                  rejection_reason: `Dead Chop Filter: Prohibited in RANGE without explosive RVOL >= 2.0 (got ${p.rvol?.toFixed(2)}) and directional momentum (ADX: ${p.adx?.toFixed(1)}).`,
                  p,
                  w,
                  ctx,
                  reasoning
               });
               return { signal: "WAIT", sl, ss, reasoning, p, w, ctx };
            }
         }

         apexPredatorStats.acceptedLongs++;
         if (setupType === "PULLBACK_SNIPER") apexPredatorStats.pullbackSetups++;
         else apexPredatorStats.breakoutSetups++;

         // Log deep reasoning breakdown
         addLog(
            `🧠 [REASONING CONFIRMED] LONG ${symbol} | Regime: ${reasoning.regime} | Flow: ${reasoning.flow.state} | ` +
            `Primary: ${reasoning.scenario.primary.type} | Score: ${sl.toFixed(1)}/10`,
            "info"
         );

         return {
            signal: "LONG",
            score: sl,
            grade: getGrade(sl),
            setupType: reasoning.scenario.primary.type === "PULLBACK_LONG" ? "PULLBACK_SNIPER" : setupType,
            p,
            w,
            ctx,
            reasoning
         };
      }

      if (reasoning.confirmation.confirmedSignal === "SHORT" && ss >= minScore && ss > sl) {
         // REGIME LOCK: مانع صفقات الـ SHORT تماماً في حالة البول (BULL Market)
         if (ctx.regime.includes("BULL")) {
            addLog(`🛡️ [REGIME LOCK] تم منع صفقة SHORT على ${symbol} لأن نظام البيتكوين صاعد (${ctx.regime}).`, "warn");
            logRejectedSignal({
               symbol,
               timeframe: "15m",
               direction: "SHORT",
               signal_score: ss,
               rejection_reason: `Strict Bull Regime: All SHORT trades prohibited during BTC ${ctx.regime} market.`,
               p,
               w,
               ctx,
               reasoning
            });
            return { signal: "WAIT", sl, ss, reasoning, p, w, ctx };
         }

         // SAFETY GATE 1: مانع صفقات الـ SHORT أثناء صعود البيتكوين القوي
         // الشرط: إذا كان نظام البيتكوين BTC = BULL_STRONG وحالة الأصل في اتجاه صاعد TREND_UP أو مرحلة انتقالية TRANSITION.
         if (ctx.regime === "BULL_STRONG" && (reasoning.regime === "TREND_UP" || reasoning.regime === "TRANSITION")) {
            addLog(`🛡️ [SAFETY GATE] تم منع صفقة SHORT على ${symbol} لأن اتجاه بيتكوين صاعد قوي (BTC BULL_STRONG) والأصل في حالة (${reasoning.regime}).`, "warn");
            logRejectedSignal({
               symbol,
               timeframe: "15m",
               direction: "SHORT",
               signal_score: ss,
               rejection_reason: `Safety Gate: BTC Regime is BULL_STRONG and Asset is ${reasoning.regime}. Counter-trend shorting prohibited.`,
               p,
               w,
               ctx,
               reasoning
            });
            return { signal: "WAIT", sl, ss, reasoning, p, w, ctx };
         }

         // SAFETY GATE 4: مانع التذبذب الميت وعديم الزخم (Dead Chop Filter في الـ RANGE)
         if (reasoning.regime === "RANGE") {
            const hasExplosiveRvol = p.rvol >= 2.0;
            const hasDirectionalMomentum = p.adx >= 22 && p.di_minus > p.di_plus;
            if (!hasExplosiveRvol || !hasDirectionalMomentum) {
               addLog(`🛡️ [DEAD CHOP] تم منع صفقة SHORT على ${symbol} في الـ RANGE لعدم توفر حجم انفجاري (RVOL >= 2.0) وقوة اتجاهية هابطة (ADX >= 22 مع DI- > DI+).`, "warn");
               logRejectedSignal({
                  symbol,
                  timeframe: "15m",
                  direction: "SHORT",
                  signal_score: ss,
                  rejection_reason: `Dead Chop Filter: Prohibited in RANGE without explosive RVOL >= 2.0 (got ${p.rvol?.toFixed(2)}) and directional momentum (ADX: ${p.adx?.toFixed(1)}).`,
                  p,
                  w,
                  ctx,
                  reasoning
               });
               return { signal: "WAIT", sl, ss, reasoning, p, w, ctx };
            }
         }

         // OVERSOLD SHORT BLOCKER: مانع بيع القيعان عند التشبع البيعي
         // في الظروف العادية (تذبذب عرضي): يتم حظر الشورت إذا كان RSI < 42 لحماية الحساب من الارتداد.
         // في حالة انهيار البيتكوين (BTC DUMP) أو الاتجاه الهابط القوي (BEAR):
         // يُسمح بركوب شلال الهبوط الانفجاري (Breakdown Ignition) حتى RSI >= 28 طالما لا يوجد ذيل امتصاص شرائي سفلي.
         const rsiVal = p.rsi ?? 50;
         const isBearMarket = ctx.regime.includes("BEAR") || ctx.btc_dump;
         const minRsiAllowed = isBearMarket ? 28 : 42;
         const maxAtrDist = isBearMarket ? 2.5 : 1.8;
         const isOverstretched = p.atr14 > 0 && p.price < (p.ema21 - (maxAtrDist * p.atr14));
         const hasBuyerAbsorptionWick = p.l_wick > p.body * 1.5 && p.l_wick > (p.atr14 * 0.4);

         if (rsiVal < minRsiAllowed || isOverstretched || hasBuyerAbsorptionWick) {
            addLog(`🛡️ [OVERSOLD SHORT BLOCK] تم منع صفقة SHORT على ${symbol} بسبب ${rsiVal < minRsiAllowed ? `التشبع البيعي الحاد (RSI: ${rsiVal.toFixed(1)} < ${minRsiAllowed})` : (hasBuyerAbsorptionWick ? "ظهور ذيل امتصاص شرائي سفلي" : `تمدد سعري مفرط تحت EMA21 (> ${maxAtrDist}x ATR)`)}.`, "warn");
            logRejectedSignal({
               symbol,
               timeframe: "15m",
               direction: "SHORT",
               signal_score: ss,
               rejection_reason: `Oversold Short Blocker: SHORT prohibited (RSI: ${rsiVal.toFixed(1)} < ${minRsiAllowed} or overstretched > ${maxAtrDist}x ATR14). Prevents selling bottoms.`,
               p,
               w,
               ctx,
               reasoning
            });
            return { signal: "WAIT", sl, ss, reasoning, p, w, ctx };
         }

         apexPredatorStats.acceptedShorts++;
         if (setupType === "PULLBACK_SNIPER") apexPredatorStats.pullbackSetups++;
         else apexPredatorStats.breakoutSetups++;

         addLog(
            `🧠 [REASONING CONFIRMED] SHORT ${symbol} | Regime: ${reasoning.regime} | Flow: ${reasoning.flow.state} | ` +
            `Primary: ${reasoning.scenario.primary.type} | Score: ${ss.toFixed(1)}/10`,
            "info"
         );

         return {
            signal: "SHORT",
            score: ss,
            grade: getGrade(ss),
            setupType: reasoning.scenario.primary.type === "PULLBACK_SHORT" ? "PULLBACK_SNIPER" : setupType,
            p,
            w,
            ctx,
            reasoning
         };
      }
   }

   // Strict Rule: No trade can enter unless verified and confirmed by Confirmation Engine.
   // Unconfirmed attempts at key levels must wait for valid breakout or reversal confirmation.

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
   // Dynamic Risk Sizing based on Market Regime:
   // If market regime is RANGE or TRANSITION, reduce risk by 50% to shield capital from choppy churn!
   const isChoppyRegime = reasoning?.regime === "RANGE" || reasoning?.regime === "TRANSITION" || ctx?.regime === "RANGING";
   const regimeRiskMult = isChoppyRegime ? 0.50 : 1.0;
   const riskAmt = virtualBalance * grade.risk * grade.mult * regimeRiskMult;
   if (regimeRiskMult < 1.0) {
      addLog(`🛡️ [DYNAMIC RISK] تم تخفيض حجم المخاطرة بنسبة 50% لصفقة ${symbol} لوجود السوق في ريجيم متذبذب (${reasoning?.regime || ctx?.regime}).`, 'info');
   }

   const entryTiming = extractEntryTiming();
   const marketRegimeContext = extractMarketRegimeContext(p, ctx, reasoning);

   if (decision.signal === "LONG") {
      const entry = p.price;
      const c = p.klines;
      const realLow = Math.min(c[c.length-1].low, c[c.length-2].low, c[c.length-3].low);
      const isBounce = setupType === "BOUNCE_SNIPER";
      // Pillar 5: Tight Structural Stop Loss with compressed buffer
      const structuralSlPad = p.atr14 * (isBounce ? 0.25 : (isPullback ? 0.35 : 0.45));
      const rawSl = isBounce && reasoning?.location?.nearestSupport && reasoning.location.nearestSupport < entry
         ? Math.min(realLow, reasoning.location.nearestSupport) - structuralSlPad
         : (isPullback ? Math.min(realLow, p.ema21) - structuralSlPad : realLow - structuralSlPad);

      // MANDATORY SL FLOOR: Stop-loss must never be closer than 0.8 * ATR or 0.6% of entry
      const minSlDistance = Math.max(p.atr14 * 0.8, entry * 0.006);
      const sl = Math.min(rawSl, entry - minSlDistance);
      const realSlDist = entry - sl;
      if (realSlDist <= 0 || realSlDist < minSlDistance * 0.95) return;
      const initialSlDist = Math.abs(entry - sl);

      const tp1 = entry + (initialSlDist * TP1_R); // Quick Win TP1 (Banks 40% of trade)
      const tp2 = entry + (initialSlDist * TP2_R); // Major Target TP2 (Banks 35% of trade)
      const tp3 = entry + (initialSlDist * TP3_R); // Runner TP3 (Banks 25% of trade)

      const calculatedRR = (tp3 - entry) / realSlDist;
      if (calculatedRR < MIN_RR_REQUIRED) {
         addLog(`❌ رُفض LONG ${symbol}: RR الفعلي (${calculatedRR.toFixed(2)}) أقل من الحد الأدنى (${MIN_RR_REQUIRED})`, "error");
         return;
      }

      // IRON NOTIONAL & MARGIN CEILING:
      // Maximum contract value cannot exceed 10x virtualBalance (e.g. $10,000 max for $1,000 balance).
      // Maximum margin allocated cannot exceed 15% of virtualBalance ($150 max).
      const maxAllowedNotional = virtualBalance * 10;
      const maxMarginCap = virtualBalance * 0.15;
      const maxPosCap = Math.min(maxAllowedNotional / entry, (maxMarginCap * 10) / entry);

      let pos = riskAmt / realSlDist;
      if (pos > maxPosCap) {
         addLog(`🛡️ [NOTIONAL CAP] تم تقليص كمية العقد لـ ${symbol} من ${pos.toFixed(2)} إلى ${maxPosCap.toFixed(2)} للحفاظ على سقف الرافعة (القيمة القصوى: $${(maxPosCap * entry).toFixed(2)}).`, "info");
         pos = maxPosCap;
      }
      const setupLabel = isBounce ? "🏹 قناص فخاخ السيولة" : (isPullback ? "🎯 قناص الارتداد" : "⚡ اختراق الزخم");
      const newTrade = {
         symbol, direction: "LONG", entry, sl, initialSlDist, tp1, tp2, tp3,
         pos, initialPos: pos, entryTime: new Date().toISOString(),
         entryTiming, marketRegimeContext,
         part_a: 0.40, part_b: 0.35, part_c: 0.25,
         a_closed: false, b_closed: false, c_closed: false,
         be_done: false, micro_banked: false, score, grade: grade.label, pnl: 0,
         setupType: isBounce ? "BOUNCE_SNIPER" : (isPullback ? "PULLBACK_SNIPER" : "BREAKOUT_MOMENTUM"),
         setupLabel,
         atr: p.atr14, peak_r: 0,
         reasoning: decision.reasoning,
         highestPrice: entry,
         lowestPrice: entry,
         candlesBeforeEntry: formatCandles(p.klines || [], 40),
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
      addLog(`✅ LONG ${symbol} [${setupLabel}] | دخول: ${entry.toFixed(4)} | SL: ${sl.toFixed(4)} | النقاط: ${score.toFixed(1)}/10`, "success");
   } else {
      const entry = p.price;
      const c = p.klines;
      const realHigh = Math.max(c[c.length-1].high, c[c.length-2].high, c[c.length-3].high);
      const isBounce = setupType === "BOUNCE_SNIPER";
      // Pillar 5: Tight Structural Stop Loss with compressed buffer
      const structuralSlPad = p.atr14 * (isBounce ? 0.25 : (isPullback ? 0.35 : 0.45));
      const rawSl = isBounce && reasoning?.location?.nearestResistance && reasoning.location.nearestResistance > entry
         ? Math.max(realHigh, reasoning.location.nearestResistance) + structuralSlPad
         : (isPullback ? Math.max(realHigh, p.ema21) + structuralSlPad : realHigh + structuralSlPad);

      // MANDATORY SL FLOOR: Stop-loss must never be closer than 0.8 * ATR or 0.6% of entry
      const minSlDistance = Math.max(p.atr14 * 0.8, entry * 0.006);
      const sl = Math.max(rawSl, entry + minSlDistance);
      const realSlDist = sl - entry;
      if (realSlDist <= 0 || realSlDist < minSlDistance * 0.95) return;
      const initialSlDist = Math.abs(entry - sl);

      const tp1 = entry - (initialSlDist * TP1_R);
      const tp2 = entry - (initialSlDist * TP2_R);
      const tp3 = entry - (initialSlDist * TP3_R);

      const calculatedRR = (entry - tp3) / realSlDist;
      if (calculatedRR < MIN_RR_REQUIRED) {
         addLog(`❌ رُفض SHORT ${symbol}: RR الفعلي (${calculatedRR.toFixed(2)}) أقل من الحد الأدنى (${MIN_RR_REQUIRED})`, "error");
         return;
      }

      // IRON NOTIONAL & MARGIN CEILING:
      // Maximum contract value cannot exceed 10x virtualBalance (e.g. $10,000 max for $1,000 balance).
      // Maximum margin allocated cannot exceed 15% of virtualBalance ($150 max).
      const maxAllowedNotional = virtualBalance * 10;
      const maxMarginCap = virtualBalance * 0.15;
      const maxPosCap = Math.min(maxAllowedNotional / entry, (maxMarginCap * 10) / entry);

      let pos = riskAmt / realSlDist;
      if (pos > maxPosCap) {
         addLog(`🛡️ [NOTIONAL CAP] تم تقليص كمية العقد لـ ${symbol} من ${pos.toFixed(2)} إلى ${maxPosCap.toFixed(2)} للحفاظ على سقف الرافعة (القيمة القصوى: $${(maxPosCap * entry).toFixed(2)}).`, "info");
         pos = maxPosCap;
      }
      const setupLabel = isBounce ? "🏹 قناص فخاخ السيولة" : (isPullback ? "🎯 قناص الارتداد" : "⚡ اختراق الزخم");
      const newTrade = {
         symbol, direction: "SHORT", entry, sl, initialSlDist, tp1, tp2, tp3,
         pos, initialPos: pos, entryTime: new Date().toISOString(),
         entryTiming, marketRegimeContext,
         part_a: 0.40, part_b: 0.35, part_c: 0.25,
         a_closed: false, b_closed: false, c_closed: false,
         be_done: false, micro_banked: false, score, grade: grade.label, pnl: 0,
         setupType: isBounce ? "BOUNCE_SNIPER" : (isPullback ? "PULLBACK_SNIPER" : "BREAKOUT_MOMENTUM"),
         setupLabel,
         atr: p.atr14, peak_r: 0,
         reasoning: decision.reasoning,
         highestPrice: entry,
         lowestPrice: entry,
         candlesBeforeEntry: formatCandles(p.klines || [], 40),
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
      addLog(`✅ SHORT ${symbol} [${setupLabel}] | دخول: ${entry.toFixed(4)} | SL: ${sl.toFixed(4)} | النقاط: ${score.toFixed(1)}/10`, "success");
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

   // Cross-confirmation for open-trade exits. Missing OI is unavailable, never a positive/neutral vote.
   const recentExitCandles = p.klines || [];
   const structureBrokenForExit = recentExitCandles.length >= 3 && recentExitCandles.slice(-3).every((c: any) =>
      t.direction === "LONG" ? c.close < p.ema21 : c.close > p.ema21
   );
   const exitEvidence = evaluateExitEvidence({
      direction: t.direction,
      priceChangePct: w.p_chg,
      oiChangePct: w.oi_chg,
      oiAvailable: w.oi_available === true,
      cvd5: w.slope5,
      cvd15: w.slope15,
      cvd4h: w.slope4h,
      takerRatio: p.taker,
      structureBroken: structureBrokenForExit,
      hiddenFlowAgainst: t.direction === "LONG" ? Boolean(w.hidden_sell) : Boolean(w.hidden_buy),
      opposingRegime: t.direction === "LONG"
         ? String(ctx.regime || "").includes("BEAR")
         : String(ctx.regime || "").includes("BULL")
   });

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
      } else if (exitEvidence.action === "EXIT") {
         emergency = true; emReason = "BTC Chaos + confirmed adverse evidence";
      } else {
         addLog(`🧭 ${t.symbol}: BTC Chaos/عدم قابلية التداول لا يكفي وحده لإغلاق الصفقة؛ أدلة الانعكاس ${exitEvidence.score}/8 (${exitEvidence.action}).`, "info");
      }
   }

   if (t.direction === "LONG" && w.scenario === "INST_SHORT" && w.triple_bear && exitEvidence.action === "EXIT") { emergency = true; emReason = "Inst Short (cross-confirmed)"; }
   if (t.direction === "SHORT" && w.scenario === "INST_LONG" && w.triple_bull && exitEvidence.action === "EXIT") { emergency = true; emReason = "Inst Long (cross-confirmed)"; }

   if (t.direction === "LONG" && w.hidden_sell && profitR < 0.5 && exitEvidence.action === "EXIT") { emergency = true; emReason = "Hidden Sell + cross-confirmation"; }
   const threeBelow = p.klines.slice(-3).every((c: any) => c.close < p.ema21);
   if (t.direction === "LONG" && threeBelow && profitR < 1.0 && exitEvidence.action === "EXIT") { emergency = true; emReason = "Structural Break + cross-confirmation"; }

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

   // 0. PILLAR 1: SOFT RISK REDUCTION AT +0.45R (BREATHING ROOM)
   // بدلاً من خنق الصفقة وسحب الوقف لنقطة الدخول فوراً عند +0.35R (مما يخرج الصفقة بربح سنتات عند أي تذبذب طبيعي)،
   // نقوم بتقليص المخاطرة بنسبة 75% عند +0.45R برفع الوقف إلى -0.25R فقط وترك مسافة كافية للوصول للأهداف الكبرى TP1 و TP2!
   if (!t.micro_banked && profitR >= 0.45) {
      t.sl = t.direction === "LONG" ? t.entry - (slDist * 0.25) : t.entry + (slDist * 0.25);
      t.micro_banked = true;
      addLog(`🛡️ [تأمين تدريجي مرن] ${t.symbol} حقق +${profitR.toFixed(2)}R | تم رفع الوقف لتقليص المخاطرة إلى -0.25R مع إبقاء مساحة للتنفس حتى TP1!`, 'info');
   }

   // PILLAR 2: TIME-DECAY STAGNATION EXIT (قاعدة الساعة الرملية لركود الزخم بعد 45 دقيقة)
   const elapsedSeconds = (Date.now() - new Date(t.entryTime).getTime()) / 1000;
   if (!t.a_closed && elapsedSeconds >= 2700) {
      // 45 minutes without breaking out towards TP1
      const isStagnant = profitR < 0.30 && profitR > -0.30;
      const momentumDying = p.rvol < 1.1 || p.adx < 22 || Math.abs(w.slope15) < 80;
      if (isStagnant && momentumDying) {
         addLog(`⏳ [الركيزة 2: إغلاق الركود الزمني] إغلاق صفقة ${t.symbol} بعد ${(elapsedSeconds/60).toFixed(0)} دقيقة عند ${profitR.toFixed(2)}R لتفادي الانعكاس وتحرير السيولة.`, 'warn');
         closeTradeFull(t, "Time-Decay Stagnation Cut");
         return;
      }
   }

   // 1. QUICK WIN & BREAKEVEN LOCK (TP1: +0.75R)
   if (!t.a_closed) {
      if (profitR >= TP1_R) {
         closePart(t, "A", t.part_a);
         // Move SL to Entry + 0.30R (Model B: secures profit floor on remaining 60%)
         t.sl = t.direction === "LONG" ? t.entry + (slDist * 0.30) : t.entry - (slDist * 0.30);
         t.a_closed = true; 
         t.be_done = true;
         addLog(`🎯 هدف أول (40%) ${t.symbol} | +${TP1_R}R | 🛡️ تم نقل الوقف لمستوى +0.30R (حماية أرباح الكمية المتبقية)`, 'success');
      } else if ((exhaust >= 5 || peak >= 5) && profitR > 0.35) {
         closePart(t, "A", t.part_a);
         t.sl = t.entry;
         t.a_closed = true;
         t.be_done = true;
         addLog(`🎯 تأمين مبكر ${t.symbol} لرصد ارتداد | تم تحريك الوقف للدخول`, 'info');
      }
   }

   // 2. PROFIT EXPANSION (TP2: +1.80R)
   if (t.a_closed && !t.b_closed) {
      if (profitR >= TP2_R) {
         closePart(t, "B", t.part_b);
         t.b_closed = true;
         // Lock in TP1 level as floor profit
         t.sl = t.direction === "LONG" ? t.entry + (slDist * TP1_R) : t.entry - (slDist * TP1_R);
         addLog(`🎯 هدف ثانٍ (35%) ${t.symbol} | +${TP2_R}R | تم حجز الأرباح ورفع الوقف لمستوى +${TP1_R}R`, 'success');
      } else if ((exhaust >= 7 || peak >= 7) && profitR > 1.2) {
         closePart(t, "B", t.part_b);
         t.b_closed = true;
      }
   }

   // 3. RUNNER EXIT (TP3: +3.50R+ or Trailing)
   if (t.b_closed && !t.c_closed) {
      if (t.direction === "LONG") { t.sl = Math.max(t.sl, price - trailDist); }
      else { t.sl = Math.min(t.sl, price + trailDist); }

      if (profitR >= TP3_R || exhaust >= 8 || peak >= 8) {
         closePart(t, "C", t.part_c);
         t.c_closed = true;
         addLog(`🏁 هدف ثالث نهائي (25%) ${t.symbol} | +${TP3_R}R صيد الاتجاه بالكامل 🏆`, 'success');
         closeTradeFull(t, "TP3 Full Target Hit");
         return;
      }
   }

   // 4. SMART CVD & OI EXHAUSTION EXIT (حجز الأرباح عند القمم برصد تراجع CVD و OI)
   if (profitR >= 0.70) {
      if (t.direction === "LONG") {
         const cvdExhaustion = w.slope15 < -100 && w.slope5 < -80;
         const oiDropping = w.oi_available === true && w.oi_chg < -0.005;
         if (cvdExhaustion && oiDropping) {
            addLog(`🎯 [SMART CVD EXIT] خروج ذكي وحجز أرباح لـ ${t.symbol} عند +${profitR.toFixed(2)}R لرصد دايفرجنس بيعي وتصريف مؤسساتي في CVD/OI.`, 'success');
            closeTradeFull(t, "CVD/OI Exhaustion Peak");
            return;
         }
      } else if (t.direction === "SHORT") {
         const cvdExhaustion = w.slope15 > 100 && w.slope5 > 80;
         const oiDropping = w.oi_available === true && w.oi_chg < -0.005;
         if (cvdExhaustion && oiDropping) {
            addLog(`🎯 [SMART CVD EXIT] خروج ذكي وحجز أرباح لـ ${t.symbol} عند +${profitR.toFixed(2)}R لانتهاء تغطية الشورتات وانعكاس CVD صعوداً.`, 'success');
            closeTradeFull(t, "CVD/OI Short Squeeze Peak");
            return;
         }
      }
   }

   // 5a. FAST FLOW LOSS CUT (-0.25R)
   // خروج مبكر إذا تراجعت الصفقة إلى ما دون -0.25R وانعكس تدفق الحيتان/CVD ضدنا:
   if (!t.a_closed && profitR <= -0.25 && exitEvidence.action === "EXIT") {
      addLog(`🛡️ [قص الخسارة المبكر المؤكد] ${t.symbol} (${t.direction}) عند ${profitR.toFixed(2)}R | أدلة ${exitEvidence.score}/9: ${exitEvidence.reasons.join("; ")}`, 'warn');
      closeTradeFull(t, "Cross-confirmed Early Flow Reversal Cut");
      return;
   }

   // 5b. HARD EARLY LOSS CUT (-0.38R to -0.40R)
   // سقف حديدي صارم للخسارة: يُمنع منعاً باتاً ترك أي صفقة تنزف إلى -1.0R!
   // إذا بلغت الصفقة -0.38R مع شمعة 15m معاكسة أو لامست -0.40R، تُغلق فوراً وتوفر 60% إلى 65% من الستوب لوس:
   if (!t.a_closed && profitR <= -0.38) {
      const c = p.klines || [];
      const lastCandle = c[c.length - 1];
      const adverseCandle = t.direction === "LONG"
         ? (lastCandle && lastCandle.close < lastCandle.open)
         : (lastCandle && lastCandle.close > lastCandle.open);

      if (profitR <= -0.40 || (adverseCandle && exitEvidence.action === "EXIT")) {
         addLog(`🛡️ [قص الخسارة الحاسم] إغلاق وقائي فوري لصفقة ${t.symbol} (${t.direction}) عند ${profitR.toFixed(2)}R لمنع النزيف وتوفير ${(1 + profitR).toFixed(2)}R من الستوب لوس!`, 'warn');
         closeTradeFull(t, "Hard Early Loss Cut (-0.40R)");
         return;
      }
   }

   // 5c. STRUCTURAL BREAK CUT (-0.30R)
   if (!t.a_closed && profitR < -0.30) {
      const c = p.klines || [];
      const recentCloses = c.slice(-2).map((k: any) => k.close);
      const isBreakingEMA = t.direction === "LONG" 
         ? recentCloses.every((cl: number) => cl < p.ema21) 
         : recentCloses.every((cl: number) => cl > p.ema21);
      
      const orderflowFlipped = t.direction === "LONG"
         ? (w.hidden_sell || w.scenario === "INST_SHORT" || w.triple_bear || w.slope15 < -120 || (p.taker < 0.46 && p.rsi < 44))
         : (w.hidden_buy || w.scenario === "INST_LONG" || w.triple_bull || w.slope15 > 120 || (p.taker > 0.54 && p.rsi > 56));

      if ((isBreakingEMA || orderflowFlipped) && exitEvidence.action === "EXIT") {
         const reasonDetail = isBreakingEMA ? "Structural EMA21 Break" : "Whale Orderflow/CVD Reversal";
         addLog(`🛡️ [قص الخسارة الهيكلي] إغلاق وقائي لصفقة ${t.symbol} (${t.direction}) عند ${profitR.toFixed(2)}R بسبب (${reasonDetail}). تم توفير ${(1 + profitR).toFixed(2)}R من الستوب لوس!`, 'warn');
         closeTradeFull(t, `Early Invalidation: ${reasonDetail}`);
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

      // BTC Violent Regime check: if BTC is an erratic two-way whipsaw, block new trades
      if (ctx.tradeable === false || ctx.btc_whipsaw) {
         addLog("⚠️ BTC Violent Whipsaw: تم حظر فتح صفقات جديدة نظراً للتذبذب العشوائي العنيف في بيتكوين (Whipsaw).", "warn");
         isLoopRunning = false;
         return;
      }

      if (ctx.btc_dump) {
         addLog(`⚡ [BTC DUMP REGIME] تم رصد هبوط عنيف لبيتكوين (${(ctx.btc_chg * 100).toFixed(2)}%). تم توجيه الروبوت لصفقات الـ SHORT وحظر الـ LONG بنسبة 100%!`, "info");
      } else if (ctx.btc_pump) {
         addLog(`⚡ [BTC PUMP REGIME] تم رصد صعود عنيف لبيتكوين (+${(ctx.btc_chg * 100).toFixed(2)}%). تم توجيه الروبوت لصفقات الـ LONG وحظر الـ SHORT بنسبة 100%!`, "info");
      }

      // Capacity check: If freeTradeSlotEnabled, trades at Breakeven (zero risk) don't block new opportunities
      const canOpenMore = () => {
         const currentRisked = activeTrades.filter(t => !t.be_done).length;
         if (freeTradeSlotEnabled) {
            return currentRisked < maxOpenTradesConfig && activeTrades.length < (maxOpenTradesConfig + 2);
         }
         return activeTrades.length < maxOpenTradesConfig;
      };

      if (!canOpenMore()) {
         isLoopRunning = false;
         return;
      }

      // Check Libya Schedule before opening new trades
      if (!isLibyaTradingAllowed()) {
         isLoopRunning = false;
         return;
      }

      // ═══ STAGE 1: PRIORITY HOT MOMENTUM QUEUE (Checked Every 15 Seconds) ═══
      // Examines top active movers & crypto majors instantly to catch breakout candle inception
      const hotCandidates = HOT_WATCHLIST.filter(sym => !activeTrades.some(t => t.symbol === sym));
      const hotChunkSize = 5;
      for (let i = 0; i < hotCandidates.length; i += hotChunkSize) {
         if (!canOpenMore()) break;
         const chunk = hotCandidates.slice(i, i + hotChunkSize);
         const promises = chunk.map(async (sym: string) => {
            if (activeTrades.some(t => t.symbol === sym)) return null;
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
               if (activeTrades.some(t => t.symbol === sym)) continue;
               if (dec.signal === "LONG" || dec.signal === "SHORT") {
                  executeTrade(sym, dec);
               }
            }
         }
      }

      // If available capacity was filled by hot momentum mover, end cycle
      if (!canOpenMore()) {
         isLoopRunning = false;
         return;
      }

      // ═══ STAGE 2: BROADER UNIVERSE ROTATION (Round-Robin Batch) ═══
      if (currentBatchIndex >= WATCHLIST.length) {
         currentBatchIndex = 0;
      }

      const batchSize = scanBatchSize;
      const endBatchIndex = Math.min(currentBatchIndex + batchSize, WATCHLIST.length);
      const batchSymbols = WATCHLIST.slice(currentBatchIndex, endBatchIndex)
         .filter(sym => !hotCandidates.includes(sym));
      
      // Advance index for next run
      currentBatchIndex = endBatchIndex;
      if (currentBatchIndex >= WATCHLIST.length) {
         currentBatchIndex = 0; // Reset
      }

      // Process batch symbols in fast concurrent chunks of 5
      const chunkSize = 5;
      for (let i = 0; i < batchSymbols.length; i += chunkSize) {
         if (!canOpenMore()) break;
         const chunk = batchSymbols.slice(i, i + chunkSize);
         const promises = chunk.map(async (sym: string) => {
            if (activeTrades.some(t => t.symbol === sym)) return null;
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
               if (activeTrades.some(t => t.symbol === sym)) continue;
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
   watcherInterval = setInterval(runApexLoop, 15 * 1000); // Check every 15 seconds for ultra-responsive breakout inception
   runApexLoop();
   addLog("Apex Predator Engine Started with Fast Momentum Scanner (15s Cadence) & Pullback Sniper", "success");
}
