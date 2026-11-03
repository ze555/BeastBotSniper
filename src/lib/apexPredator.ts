import axios from "axios";
import { calcEMA, calcATR, calcADX, calcMACD, calcRSI, calcSupertrend } from "./indicators.js";

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

import { evaluateExecutionFilter } from "./executionFilter.js";
import { evaluateInstitutionalMarket, evaluateInstitutionalExit } from "./institutionalMarketEngine.js";
import { startFuturesWaveFeed, stopFuturesWaveFeed, getFuturesTapeFlow, getFuturesWaveCandidates } from "./futuresWaveFeed.js";
import { evaluateTriRegimeExecution, detectMacroRegime, TriRegimeEvaluationResult } from "./triRegimeEngine.js";
export { evaluateExecutionFilter, evaluateTriRegimeExecution, detectMacroRegime };

const BINANCE_FAPI = "https://fapi.binance.com";
let watcherInterval: NodeJS.Timeout | null = null;
let activeTrades: any[] = [];
let todaysStats = { count: 0, wins: 0, losses: 0, pnl: 0, sumR: 0 };
let statsDay = new Date().toISOString().slice(0, 10);
let botActive = false;
let isLoopRunning = false;

// ═══ ANTI-CHURN COOLDOWN SYSTEM ═══
// Prevents rapid repetitive entries and micro-churn fee burn on the same symbol
const closedSymbolCooldown = new Map<string, number>();
const SYMBOL_COOLDOWN_LOSS_MS = 10 * 60 * 1000; // 10 minutes mandatory cooldown after a loss / early exit
const SYMBOL_COOLDOWN_WIN_MS = 5 * 60 * 1000;   // 5 minutes cooldown after a take profit win

export function isSymbolInCooldown(symbol: string): boolean {
   const expireAt = closedSymbolCooldown.get(symbol);
   if (!expireAt) return false;
   if (Date.now() >= expireAt) {
      closedSymbolCooldown.delete(symbol);
      return false;
   }
   return true;
}

export function setSymbolCooldown(symbol: string, isWin: boolean, durationMs?: number) {
   const duration = durationMs ?? (isWin ? SYMBOL_COOLDOWN_WIN_MS : SYMBOL_COOLDOWN_LOSS_MS);
   closedSymbolCooldown.set(symbol, Date.now() + duration);
}

export function clearSymbolCooldowns() {
   closedSymbolCooldown.clear();
}

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
const MAX_OPEN_TRADES = 6;
const MAX_DAILY_LOSS = 0.040;
const BEST_HOURS_UTC = [12, 13, 14, 15, 16, 17, 18, 19, 20];
const AVOID_HOURS = [22, 23, 0, 1, 2, 3, 4, 5, 6, 7];

let virtualBalance = 1000;
let initialVirtualBalance = 1000;
let maxOpenTradesConfig = 6;

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
let scheduleEnabled = false; // Default false to allow 24/7 continuous crypto futures scanning across all market sessions
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

const institutionalStateBySymbol = new Map<string, { state: string; direction: string }>();

export function resetAccountState() {
  virtualBalance = 1000;
  initialVirtualBalance = 1000;
  todaysStats = { count: 0, wins: 0, losses: 0, pnl: 0, sumR: 0 };
  clearSymbolCooldowns();
  closedTrades = closedTrades.filter(t => t.symbol !== 'AMZNUSDT' && !((t.pos || t.initialPos) > 100));
  activeTrades = activeTrades.filter(t => t.symbol !== 'AMZNUSDT');
  addLog(`✨ [ACCOUNT REFRESH] تم تطهير الصفقات الشاذة وإعادة ضبط رصيد الحساب إلى $1,000 وتصفير فترات التهدئة وإلغاء قفل الخسارة اليومية.`, 'success');
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
export function setActive(val: boolean) { botActive = val; if (!val) stopFuturesWaveFeed(); addLog(`BOT ACTIVE: ${val}`); }
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

      const [res, exchangeInfo] = await Promise.all([
         axios.get(`${BINANCE_FAPI}/fapi/v1/ticker/24hr`, { timeout: 8000 }),
         axios.get(`${BINANCE_FAPI}/fapi/v1/exchangeInfo`, { timeout: 8000 })
      ]);
      if (!Array.isArray(res.data) || res.data.length === 0 || !Array.isArray(exchangeInfo.data?.symbols)) return;
      const activeUsdtPerpetuals = new Set(
         exchangeInfo.data.symbols
            .filter((item: any) => item.contractType === "PERPETUAL" && item.quoteAsset === "USDT" && item.status === "TRADING")
            .map((item: any) => item.symbol)
      );
      // Continuous aggTrade streams watch the entire active USDT-M perpetual universe between REST scan cycles.
      startFuturesWaveFeed(Array.from(activeUsdtPerpetuals));
      
      const excludedBases = [
         'USDC', 'BUSD', 'TUSD', 'FDUSD', 'USDD', 'PYUSD', 'DAI', 'USDP', 'TRUE', 'EUR', 'GBP', 'AEUR', 'PAXG', 'XAUT',
         'AMZN', 'AAPL', 'TSLA', 'GOOGL', 'GOOG', 'MSFT', 'NVDA', 'META', 'NFLX', 'BABA', 'COIN', 'MSTR',
         'EWY', 'MINIMAX', 'SAMSUNG', 'AVGO', 'INTC', 'COPPER', 'KORU', 'XAG', 'NATGAS', 'BZ', 'DRAM'
      ];
      
      const validTickers = res.data.filter((s: any) => {
         if (!s.symbol || !activeUsdtPerpetuals.has(s.symbol)) return false;
         const base = s.symbol.replace('USDT', '');
         if (excludedBases.includes(base)) return false;
         const quoteVol = parseFloat(s.quoteVolume) || 0;
         return quoteVol > 0; // Keep the complete active USDT perpetual universe; execution liquidity is validated separately.
      });

      // 1. Dynamic Fast Momentum Queue (HOT_WATCHLIST)
      if (needsHotUpdate) {
         // Priority queue contains only contracts already showing abnormal movement.
         // Do not spend the fast lane repeatedly scanning quiet majors by default.
         const activeMovers = [...validTickers]
            .filter((s: any) => {
               const move = Math.abs(parseFloat(s.priceChangePercent) || 0);
               const quoteVol = parseFloat(s.quoteVolume) || 0;
               return move >= 1.0 && quoteVol >= 1_000_000;
            })
            .sort((a: any, b: any) => {
               const moveA = Math.abs(parseFloat(a.priceChangePercent) || 0);
               const moveB = Math.abs(parseFloat(b.priceChangePercent) || 0);
               return moveB - moveA;
            })
            .map((s: any) => s.symbol);

         const activeHot = Array.from(new Set(activeMovers)).slice(0, 20);
         HOT_WATCHLIST = activeHot;
         lastHotWatchlistUpdate = now;
      }

      // 2. Full WATCHLIST (Broader Liquid Universe)
      if (needsFullUpdate) {
         const sortedByVol = [...validTickers]
            .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
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
const aggTradeCache = new Map<string, CacheEntry>();
const depthCache = new Map<string, CacheEntry>();

function oi0Safe(data: any[]) { return Number(data?.[0]?.sumOpenInterest); }

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
      quoteVolume: parseFloat(k[7]),
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

async function fetchFuturesAggressorFlow(symbol: string) {
   const liveFlow = getFuturesTapeFlow(symbol);
   if (liveFlow) return liveFlow;
   const key = `futures:${symbol}`;
   const cached = getCached<any>(aggTradeCache, key);
   if (cached) return cached;
   const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/aggTrades`, {
      params: { symbol, limit: 100 }, timeout: 5000
   });
   if (!Array.isArray(res.data) || res.data.length === 0) throw new Error("No Futures aggregate trades");
   const now = Date.now();
   let buyQuote = 0, sellQuote = 0, trades30s = 0;
   let buyQuote5s = 0, sellQuote5s = 0, trades5s = 0;
   let latestTradeTime = 0;
   for (const trade of res.data) {
      const at = Number(trade.T);
      const notional = Number(trade.p) * Number(trade.q);
      if (!Number.isFinite(at) || !Number.isFinite(notional) || notional <= 0 || at > now + 2_000) continue;
      latestTradeTime = Math.max(latestTradeTime, at);
      if (at < now - 30_000) continue;
      trades30s++;
      if (trade.m === true) sellQuote += notional; else buyQuote += notional;
      if (at >= now - 5_000) {
         trades5s++;
         if (trade.m === true) sellQuote5s += notional; else buyQuote5s += notional;
      }
   }
   if (!latestTradeTime || now - latestTradeTime > 30_000 || trades30s < 5) {
      throw new Error("Insufficient fresh Futures aggressor trades in the last 30 seconds");
   }
   const flow = {
      buyQuote, sellQuote, tradeCount: trades30s, observedAt: latestTradeTime,
      buyQuote5s, sellQuote5s, trades5s, buyQuote30s: buyQuote, sellQuote30s: sellQuote,
      trades30s, source: "BINANCE_AGG_TRADES" as const
   };
   setCached(aggTradeCache, key, flow, 2_000);
   return flow;
}

async function fetchOrderBookEvidence(symbol: string) {
   const cached = getCached<any>(depthCache, symbol);
   if (cached) return cached;
   const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/depth`, { params: { symbol, limit: 20 }, timeout: 5000 });
   const bids = Array.isArray(res.data?.bids) ? res.data.bids : [];
   const asks = Array.isArray(res.data?.asks) ? res.data.asks : [];
   if (!bids.length || !asks.length) throw new Error("Order book unavailable");
   const bidNotional = bids.reduce((sum: number, level: any[]) => sum + Number(level[0]) * Number(level[1]), 0);
   const askNotional = asks.reduce((sum: number, level: any[]) => sum + Number(level[0]) * Number(level[1]), 0);
   const bestBid = Number(bids[0][0]);
   const bestAsk = Number(asks[0][0]);
   if (![bidNotional, askNotional, bestBid, bestAsk].every(Number.isFinite) || bestBid <= 0 || bestAsk < bestBid) {
      throw new Error("Malformed order book");
   }
   const mid = (bestBid + bestAsk) / 2;
   const book = {
      bidNotional, askNotional,
      spreadBps: ((bestAsk - bestBid) / mid) * 10000,
      observedAt: Date.now(),
      source: "BINANCE_DEPTH" as const
   };
   setCached(depthCache, symbol, book, 2000);
   return book;
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
   const upperWick = c15_0.high - Math.max(c15_0.open, c15_0.close);
   const lowerWick = Math.min(c15_0.open, c15_0.close) - c15_0.low;
   const upperWickRatio = btc_range > 0 ? upperWick / btc_range : 0;
   const lowerWickRatio = btc_range > 0 ? lowerWick / btc_range : 0;

   // Directional Dump: BTC is plunging with significant negative change and volume expansion (Prime SHORT regime!)
   // Does NOT block dump if there is an intraday lower wick during a violent cascade!
   const btc_dump = btc_15m_chg < -volThreshold || (btc_15m_chg < -(volThreshold * 0.75) && c15_0.close < c15_0.open);

   // Directional Pump: BTC is exploding upward with significant positive change and volume expansion (Prime LONG regime!)
   const btc_pump = btc_15m_chg > volThreshold || (btc_15m_chg > (volThreshold * 0.75) && c15_0.close > c15_0.open);

   // True erratic whipsaw: high volatility but indecisive net direction with large opposing 2-way wicks on both sides
   const btc_whipsaw = isExtremeVol && !btc_dump && !btc_pump && upperWickRatio > 0.30 && lowerWickRatio > 0.30;

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

   let pressure = 0;
   for(let i=0; i<12; i++) {
      const w = (12-i)/12;
      const k = c15[c15.length-1 - i];
      pressure += (k.takerBuy - k.takerSell) * w;
   }
   const avgVol = c15.slice(-20).map((x: any) => x.volume).reduce((a: number, b: number) => a + b, 0)/20;

   const triple_bull = slope5 > 0 && slope15 > 0 && slope4h > 0;
   const triple_bear = slope5 < 0 && slope15 < 0 && slope4h < 0;

   // High-conviction operational flow alignment across 15m and 5m with taker orderflow pressure:
   const directional_bull = (slope15 > 0 && slope5 > 0) || (slope15 > 35 && pressure > 0);
   const directional_bear = (slope15 < 0 && slope5 < 0) || (slope15 < -35 && pressure < 0);
   // Mixed ONLY when 15m and 5m directly oppose each other without clear directional pressure:
   const cvd_mixed = !directional_bull && !directional_bear;

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
   const oiLatest = oiData?.[oiData.length - 1];
   const oiTimestamp = Number(oiLatest?.timestamp);
   const oi_available = Boolean(oiData && oiData.length >= 4 &&
      Number.isFinite(oi_chg) && Number.isFinite(oi0Safe(oiData)) &&
      (Number.isFinite(oiTimestamp) && Date.now() - oiTimestamp >= 0 && Date.now() - oiTimestamp <= 20 * 60 * 1000));
   // Futures-only evidence collection. Spot is intentionally not queried.
   const [futuresFlowResult, orderBookResult] = await Promise.allSettled([
      fetchFuturesAggressorFlow(symbol),
      fetchOrderBookEvidence(symbol)
   ]);
   const futuresFlow = futuresFlowResult.status === "fulfilled" ? futuresFlowResult.value : null;
   const orderBook = orderBookResult.status === "fulfilled" ? orderBookResult.value : null;
   
   const corr = Math.abs(btc_chg) > 0.001 ? p_chg / btc_chg : 0;
   const asset_strong = btc_chg < -0.003 && corr > -0.3;

   return {
      triple_bull, triple_bear, cvd_mixed,
      hidden_buy: slope15 < 0 && pressure > 0,
      hidden_sell: slope15 > 0 && pressure < 0,
      scenario, oi_chg, oi_available, p_chg, fund, futuresFlow, orderBook,
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

// --- SEC 4: INSTITUTIONAL EVIDENCE ENTRY ENGINE (NO SCORE) ---
async function evaluateInstitutionalEntry(symbol: string, ctx: any) {
   apexPredatorStats.totalEvaluations++;
   // BTC is context only: a market-wide BTC whipsaw must not suppress an independently violent altcoin Futures wave.
   if (!isLibyaTradingAllowed()) return { signal: "WAIT", reason: "OUTSIDE_LIBYA_HOURS" };

   const w = await readWhale(symbol, ctx.btc_chg);
   const p: any = await readPrice(symbol, w.c15, w.c5);
   // readPrice uses 15m context; ignition detection requires a separate live 1m Futures feed.
   const waveCandles = await fetchKl(symbol, "1m", 30);
   const wavePrice = waveCandles.length ? waveCandles[waveCandles.length - 1].close : p.price;
   updateRejectedSignalsOutcomes(symbol, p.price, p.klines);
   updateDirectionTracking(symbol, p.price);

   // Include the still-forming 1m Futures candle to avoid waiting for candle close.
   const closedCandles = waveCandles.slice(-30);
   const previousInstitutionalState = institutionalStateBySymbol.get(symbol);
   const institutional = evaluateInstitutionalMarket({
      symbol,
      timestamp: Date.now(),
      price: wavePrice,
      candles: closedCandles,
      futuresFlow: w.futuresFlow,
      orderBook: w.orderBook,
      oiChange: w.oi_chg,
      oiAvailable: w.oi_available === true,
      previousState: previousInstitutionalState?.state as any,
      previousDirection: previousInstitutionalState?.direction as any,
      fundingRate: Number.isFinite(w.fund) ? w.fund : null,
      btcChange: Number.isFinite(ctx.btc_chg) ? ctx.btc_chg : null
   });

   if (institutional.state !== "DATA_INSUFFICIENT") {
      institutionalStateBySymbol.set(symbol, { state: institutional.state, direction: institutional.direction });
   }
   p.institutionalEvidence = institutional;
   p.institutionalInvalidation = institutional.metrics.invalidationLevel;
   if (institutional.state === "DATA_INSUFFICIENT") {
      addLog(`⛔ ${symbol}: Institutional entry blocked — ${institutional.reason} Missing: ${institutional.missingEvidence.join(", ")}`, "warn");
      return { signal: "WAIT", reason: institutional.reason, p, w, ctx, institutional };
   }
   if (!institutional.canEnter || institutional.direction === "NONE") {
      if (institutional.state !== "DORMANT") {
         addLog(`🔎 ${symbol}: ${institutional.state} — ${institutional.reason}`, "info");
      }
      return { signal: "WAIT", reason: institutional.reason, p, w, ctx, institutional };
   }

   const direction = institutional.direction;
   const invalidation = institutional.metrics.invalidationLevel;
   if (!Number.isFinite(invalidation) || (direction === "LONG" ? invalidation >= p.price : invalidation <= p.price) || !(p.atr14 > 0)) {
      addLog(`⛔ ${symbol}: Structural invalidation level is invalid; trade rejected.`, "warn");
      return { signal: "WAIT", reason: "INVALID_STRUCTURAL_INVALIDATION", p, w, ctx, institutional };
   }

   const reasoning: any = {
      regime: p.HH_HL ? "TREND_UP" : p.LH_LL ? "TREND_DOWN" : "TRANSITION",
      location: {
         nearestResistance: p.res10,
         nearestSupport: p.sup10,
         rangeHigh: p.res10,
         rangeLow: p.sup10
      },
      flow: { state: "FUTURES_EXECUTED_AGGRESSOR_FLOW", evidenceFor: institutional.evidenceFor, evidenceAgainst: institutional.evidenceAgainst },
      scenario: { primary: { type: direction === "LONG" ? "BREAKOUT_LONG" : "BREAKOUT_SHORT", state: "CONFIRMED", bias: direction } },
      confirmation: { isConfirmed: true, confirmedSignal: direction, reason: institutional.reason },
      institutional
   };
   const grade = { label: "INSTITUTIONAL_CONFIRMED", risk: 0.007, mult: 1.0 };
   if (direction === "LONG") apexPredatorStats.acceptedLongs++;
   else apexPredatorStats.acceptedShorts++;

   addLog(
      `🧠 [INSTITUTIONAL ${institutional.state}] ${direction} ${symbol} | ${institutional.reason} | ${institutional.evidenceFor.join(" | ")}`,
      "success"
   );
   return {
      signal: direction,
      grade,
      setupType: institutional.entryType === "EARLY_IGNITION" ? "INSTITUTIONAL_IGNITION" : "INSTITUTIONAL_BREAKOUT",
      p, w, ctx, reasoning, institutional
   };
}

// --- SEC 5: EXECUTION ---
function executeTrade(symbol: string, decision: any) {
   if (isSymbolInCooldown(symbol)) {
      addLog(`⏳ [تبريد رمزي] تم تخطي تنفيذ صفقة على ${symbol} لأن الرمز يخضع لفترة تهدئة بعد إغلاق سابق لمنع التكرار وحرق الرسوم.`, 'info');
      return;
   }

   const { p, w, grade, setupType, ctx, reasoning, institutional } = decision;
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
      const evidenceInvalidation = Number.isFinite(p.institutionalInvalidation) ? p.institutionalInvalidation : realLow;
      const rawSl = Math.min(realLow, evidenceInvalidation) - structuralSlPad;

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
         be_done: false, micro_banked: false, grade: grade.label, pnl: 0,
         institutionalEvidence: institutional, institutionalInvalidationLevel: p.institutionalInvalidation,
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
      addLog(`✅ LONG ${symbol} [${setupLabel}] | دخول: ${entry.toFixed(4)} | SL: ${sl.toFixed(4)} | Institutional evidence chain confirmed`, "success");
   } else {
      const entry = p.price;
      const c = p.klines;
      const realHigh = Math.max(c[c.length-1].high, c[c.length-2].high, c[c.length-3].high);
      const isBounce = setupType === "BOUNCE_SNIPER";
      // Pillar 5: Tight Structural Stop Loss with compressed buffer
      const structuralSlPad = p.atr14 * (isBounce ? 0.25 : (isPullback ? 0.35 : 0.45));
      const evidenceInvalidation = Number.isFinite(p.institutionalInvalidation) ? p.institutionalInvalidation : realHigh;
      const rawSl = Math.max(realHigh, evidenceInvalidation) + structuralSlPad;

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
         be_done: false, micro_banked: false, grade: grade.label, pnl: 0,
         institutionalEvidence: institutional, institutionalInvalidationLevel: p.institutionalInvalidation,
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
      addLog(`✅ SHORT ${symbol} [${setupLabel}] | دخول: ${entry.toFixed(4)} | SL: ${sl.toFixed(4)} | Institutional evidence chain confirmed`, "success");
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

   // --- SEC 6.1: INSTITUTIONAL EXECUTED-FLOW EXIT ENGINE (NO SCORE) ---
   const institutionalInvalidation = Number.isFinite(t.institutionalInvalidationLevel)
      ? t.institutionalInvalidationLevel
      : t.sl;
   const structureInvalidated = t.direction === "LONG"
      ? price < institutionalInvalidation
      : price > institutionalInvalidation;
   const exitEvidence = evaluateInstitutionalExit({
      direction: t.direction,
      price,
      entry: t.entry,
      stop: t.sl,
      structureInvalidated,
      futuresFlow: w.futuresFlow || null,
      fundingRate: Number.isFinite(w.fund) ? w.fund : null,
      timestamp: Date.now()
   });

   if (exitEvidence.action === "EXIT") {
      addLog(`🚨 [INSTITUTIONAL REVERSAL CONFIRMED] ${t.symbol} ${t.direction} at ${profitR.toFixed(2)}R | ${exitEvidence.reasons.join(" | ")}`, "warn");
      closeTradeFull(t, "Institutional Structure + Futures Flow Reversal");
      return;
   }
   if (exitEvidence.action === "PROTECT") {
      addLog(`🛡️ [INSTITUTIONAL EXHAUSTION WARNING] ${t.symbol} ${t.direction} | ${exitEvidence.reasons.join(" | ")}`, "info");
      if (profitR >= 0.30) {
         const protectedStop = t.direction === "LONG"
            ? t.entry + slDist * 0.10
            : t.entry - slDist * 0.10;
         if (t.direction === "LONG") t.sl = Math.max(t.sl, protectedStop);
         else t.sl = Math.min(t.sl, protectedStop);
         t.be_done = true;
      }
   }

   const futuresDelta = w.futuresFlow ? w.futuresFlow.buyQuote - w.futuresFlow.sellQuote : 0;
   const supportiveFlow = t.direction === "LONG" ? futuresDelta > 0 : futuresDelta < 0;
   const isTsunamiRunner = supportiveFlow && profitR >= 1.0 && exitEvidence.action === "HOLD";
   const isBenignPullback = supportiveFlow && profitR > 0 && exitEvidence.action === "HOLD";

   let trailDist = p.atr14 * (p.rvol > 1.5 ? 1.0 : 0.7);

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
   if (!isTsunamiRunner && !isBenignPullback && !t.a_closed && elapsedSeconds >= 2700) {
      // 45 minutes without breaking out towards TP1
      const isStagnant = profitR < 0.30 && profitR > -0.30;
      const momentumDying = p.rvol < 1.1 || !supportiveFlow;
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
      }
   }

   // 3. RUNNER EXIT (TP3: +3.50R+ or Trailing)
   if (t.b_closed && !t.c_closed) {
      if (t.direction === "LONG") { t.sl = Math.max(t.sl, price - trailDist); }
      else { t.sl = Math.min(t.sl, price + trailDist); }

      if (profitR >= TP3_R) {
         closePart(t, "C", t.part_c);
         t.c_closed = true;
         addLog(`🏁 هدف ثالث نهائي (25%) ${t.symbol} | +${TP3_R}R صيد الاتجاه بالكامل 🏆`, 'success');
         closeTradeFull(t, "TP3 Full Target Hit");
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

   // Anti-Churn Protection: enforce mandatory cooldown before symbol can be traded again
   const isProfitWin = (t.finalPnl > 0.15 && t.profitR > 0.05);
   setSymbolCooldown(t.symbol, isProfitWin);
   const cooldownMins = isProfitWin ? 5 : 10;
   addLog(`⏳ [مانع الدوران والتكرار - Anti-Churn] تم تفعيل فترة تهدئة ${cooldownMins} دقائق على ${t.symbol} لمنع التكرار السريع وحرق الرسوم.`, 'info');

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

      // BTC is a context variable only. It must not veto an independently confirmed violent Futures move in an altcoin.
      if (ctx.btc_whipsaw || ctx.btc_dump || ctx.btc_pump) {
         addLog(`🌐 BTC context noted (whipsaw=${Boolean(ctx.btc_whipsaw)}, dump=${Boolean(ctx.btc_dump)}, pump=${Boolean(ctx.btc_pump)}); independent Futures wave signals remain eligible.`, "info");
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
      const hotCandidates = Array.from(new Set([...getFuturesWaveCandidates( Date.now(), 20), ...HOT_WATCHLIST]))
         .filter(sym => !activeTrades.some(t => t.symbol === sym) && !isSymbolInCooldown(sym));
      const hotChunkSize = 5;
      for (let i = 0; i < hotCandidates.length; i += hotChunkSize) {
         if (!canOpenMore()) break;
         const chunk = hotCandidates.slice(i, i + hotChunkSize);
         const promises = chunk.map(async (sym: string) => {
            if (activeTrades.some(t => t.symbol === sym)) return null;
            try {
               const dec = await evaluateInstitutionalEntry(sym, ctx);
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
         .filter(sym => !hotCandidates.includes(sym) && !isSymbolInCooldown(sym));
      
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
               const dec = await evaluateInstitutionalEntry(sym, ctx);
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
