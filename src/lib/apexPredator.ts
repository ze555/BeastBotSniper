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
   updateDirectionTracking,
   loadBotState,
   saveBotState,
   getResearchStorageStatus
} from "./researchLogger.js";

import { evaluateExecutionFilter } from "./executionFilter.js";
import { evaluateInstitutionalMarket, evaluateInstitutionalExit } from "./institutionalMarketEngine.js";
import { evaluateEntryQuality } from "./entryQualityEngine.js";
import { evaluateReverseWave } from "./reverseWaveEngine.js";
import { evaluateMarketAlignment } from "./marketAlignmentEngine.js";
import { startFuturesWaveFeed, stopFuturesWaveFeed, getFuturesTapeFlow, getFuturesWaveCandidates, getFuturesLiquidationFlow, getFuturesWaveFeedStatus, getFuturesBookFlow } from "./futuresWaveFeed.js";
import { evaluateTriRegimeExecution, detectMacroRegime, TriRegimeEvaluationResult } from "./triRegimeEngine.js";
import { calculateWaveStop, estimateNetRiskAtStop, capPositionToRiskBudget } from "./waveRiskEngine.js";
export { evaluateExecutionFilter, evaluateTriRegimeExecution, detectMacroRegime };

const BINANCE_FAPI = "https://fapi.binance.com";
let watcherInterval: NodeJS.Timeout | null = null;
let activeTrades: any[] = [];
let todaysStats = { count: 0, wins: 0, losses: 0, pnl: 0, sumR: 0 };
let statsDay = new Date().toISOString().slice(0, 10);
let botActive = false;
let isLoopRunning = false;
let riskLockLoggedAt = 0;
let lastRuntimeStateSavedAt = 0;

// Symbol-level cooldowns are disabled. Re-entry is governed by fresh wave evidence,
// active-position checks, structural invalidation and execution feasibility.
export function isSymbolInCooldown(_symbol: string): boolean { return false; }
export function setSymbolCooldown(_symbol: string, _isWin: boolean, _durationMs?: number) { /* intentionally disabled */ }
export function clearSymbolCooldowns() { /* intentionally disabled */ }

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
const TP1_R = 1.00;
const TP2_R = 2.00;
const TP3_R = 3.50;
const MAX_OPEN_TRADES = 6;
const MAX_DAILY_LOSS = 0.040;
const MAX_PORTFOLIO_OPEN_RISK = 0.030;
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

// Restore the paper account after process restarts when the configured storage path is persistent.
const restoredBotState = loadBotState();
if (restoredBotState?.schema_version === 1) {
   if (Number.isFinite(restoredBotState.virtualBalance) && restoredBotState.virtualBalance > 0) virtualBalance = restoredBotState.virtualBalance;
   if (Number.isFinite(restoredBotState.initialVirtualBalance) && restoredBotState.initialVirtualBalance > 0) initialVirtualBalance = restoredBotState.initialVirtualBalance;
   if (Array.isArray(restoredBotState.activeTrades)) {
      activeTrades = restoredBotState.activeTrades.filter((trade: any) =>
         trade && typeof trade.symbol === "string" &&
         (trade.direction === "LONG" || trade.direction === "SHORT") &&
         Number.isFinite(Number(trade.entry)) && Number(trade.entry) > 0 &&
         Number.isFinite(Number(trade.pos)) && Number(trade.pos) > 0 &&
         Number.isFinite(Number(trade.sl)) && Number(trade.sl) > 0
      );
   }
   if (Array.isArray(restoredBotState.closedTrades)) closedTrades = restoredBotState.closedTrades.slice(0, 150);
   if (restoredBotState.todaysStats && typeof restoredBotState.todaysStats === "object") {
      todaysStats = {
         count: Number(restoredBotState.todaysStats.count) || 0,
         wins: Number(restoredBotState.todaysStats.wins) || 0,
         losses: Number(restoredBotState.todaysStats.losses) || 0,
         pnl: Number(restoredBotState.todaysStats.pnl) || 0,
         sumR: Number(restoredBotState.todaysStats.sumR) || 0
      };
   }
   if (typeof restoredBotState.statsDay === "string") statsDay = restoredBotState.statsDay;
   lastRuntimeStateSavedAt = Number.isFinite(Date.parse(restoredBotState.saved_at)) ? Date.parse(restoredBotState.saved_at) : 0;
   if (typeof restoredBotState.botActive === "boolean") botActive = restoredBotState.botActive;
   if (restoredBotState.config && typeof restoredBotState.config === "object") {
      const c = restoredBotState.config;
      if (Number.isFinite(c.maxOpenTradesConfig) && c.maxOpenTradesConfig >= 1) maxOpenTradesConfig = c.maxOpenTradesConfig;
      if (typeof c.haltProfitEnabled === "boolean") haltProfitEnabled = c.haltProfitEnabled;
      if (Number.isFinite(c.haltProfitTarget)) haltProfitTarget = c.haltProfitTarget;
      if (typeof c.haltLossEnabled === "boolean") haltLossEnabled = c.haltLossEnabled;
      if (Number.isFinite(c.haltLossTarget)) haltLossTarget = c.haltLossTarget;
      if (typeof c.smartBtcHoldEnabled === "boolean") smartBtcHoldEnabled = c.smartBtcHoldEnabled;
      if (typeof c.btcVolThresholdStr === "string") btcVolThresholdStr = c.btcVolThresholdStr;
      if (Number.isFinite(c.slAtrMultiplier)) slAtrMultiplier = c.slAtrMultiplier;
      if (typeof c.geniusMode === "boolean") geniusMode = c.geniusMode;
      if (typeof c.pullbackSniperEnabled === "boolean") pullbackSniperEnabled = c.pullbackSniperEnabled;
      if (typeof c.freeTradeSlotEnabled === "boolean") freeTradeSlotEnabled = c.freeTradeSlotEnabled;
      if (Number.isFinite(c.scanBatchSize) && c.scanBatchSize >= 1) scanBatchSize = c.scanBatchSize;
      if (Number.isFinite(c.feeRate) && c.feeRate >= 0) feeRate = c.feeRate;
      if (Number.isFinite(c.slippageRate) && c.slippageRate >= 0) slippageRate = c.slippageRate;
      if (typeof c.scheduleEnabled === "boolean") scheduleEnabled = c.scheduleEnabled;
      if (Number.isFinite(c.libyaOpen1)) libyaOpen1 = c.libyaOpen1;
      if (Number.isFinite(c.libyaClose1)) libyaClose1 = c.libyaClose1;
      if (Number.isFinite(c.libyaOpen2)) libyaOpen2 = c.libyaOpen2;
      if (Number.isFinite(c.libyaClose2)) libyaClose2 = c.libyaClose2;
   }
   if (restoredBotState.apexPredatorStats && typeof restoredBotState.apexPredatorStats === "object") {
      apexPredatorStats = { ...apexPredatorStats, ...restoredBotState.apexPredatorStats };
   }
}

export function persistRuntimeState(force = false) {
   const now = Date.now();
   if (!force && now - lastRuntimeStateSavedAt < 30_000) return;
   const saved = saveBotState({
      virtualBalance, initialVirtualBalance, activeTrades, botActive,
      closedTrades: closedTrades.slice(0, 30), todaysStats, statsDay, apexPredatorStats,
      config: {
         maxOpenTradesConfig, haltProfitEnabled, haltProfitTarget, haltLossEnabled, haltLossTarget,
         smartBtcHoldEnabled, btcVolThresholdStr, slAtrMultiplier, geniusMode, pullbackSniperEnabled,
         freeTradeSlotEnabled, scanBatchSize, feeRate, slippageRate, scheduleEnabled,
         libyaOpen1, libyaClose1, libyaOpen2, libyaClose2
      }
   });
   if (saved) lastRuntimeStateSavedAt = now;
}

const institutionalStateBySymbol = new Map<string, { state: string; direction: string }>();

export function resetAccountState() {
  virtualBalance = 1000;
  initialVirtualBalance = 1000;
  todaysStats = { count: 0, wins: 0, losses: 0, pnl: 0, sumR: 0 };
  clearSymbolCooldowns();
  closedTrades = closedTrades.filter(t => t.symbol !== 'AMZNUSDT' && !((t.pos || t.initialPos) > 100));
  activeTrades = activeTrades.filter(t => t.symbol !== 'AMZNUSDT');
  addLog(`✨ [ACCOUNT REFRESH] تم تطهير الصفقات الشاذة وإعادة ضبط رصيد الحساب إلى $1,000 وتصفير فترات التهدئة وإلغاء قفل الخسارة اليومية.`, 'success');
  persistRuntimeState(true);
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
  persistRuntimeState(true);
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
  const todayFloatingPnl = activeTrades.reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0);
  const todayNetPnl = todaysStats.pnl + todayFloatingPnl;
  const remainingUnrealizedPnl = activeTrades.reduce((sum, trade) =>
    sum + ((Number(trade.pnl) || 0) - (Number(trade.realizedPnl) || 0)), 0);
  const totalAccountNetPnl = (virtualBalance - initialVirtualBalance) + remainingUnrealizedPnl;

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
    isSleeping: false,
    executionRiskLocked: todayNetPnl <= -(initialVirtualBalance * MAX_DAILY_LOSS) || (haltLossEnabled && totalAccountNetPnl <= -haltLossTarget) || (haltProfitEnabled && totalAccountNetPnl >= haltProfitTarget),
    scannerMode: "CONTINUOUS_DISCOVERY_WITH_EXECUTION_GUARDS",
    today: { ...todaysStats, floatingPnl: todayFloatingPnl, netPnl: todayNetPnl } 
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
export function setActive(val: boolean) { botActive = val; if (!val) stopFuturesWaveFeed(); persistRuntimeState(true); addLog(`BOT ACTIVE: ${val}`); }
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
const priorDepthBySymbol = new Map<string, { bidNotional: number; askNotional: number; observedAt: number }>();

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
   // Prefer the in-memory tape only after it has a meaningful 5m history; otherwise REST backfills recent prints.
   if (liveFlow && liveFlow.trades5m >= 10) return liveFlow;
   const key = `futures:${symbol}`;
   const cached = getCached<any>(aggTradeCache, key);
   if (cached) return cached;
   const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/aggTrades`, {
      params: { symbol, limit: 1000 }, timeout: 5000
   });
   if (!Array.isArray(res.data) || res.data.length === 0) throw new Error("No Futures aggregate trades");
   const now = Date.now();
   const parsed = res.data.map((trade: any) => ({
      at: Number(trade.T), quote: Number(trade.p) * Number(trade.q), price: Number(trade.p), buyerIsMaker: trade.m === true
   })).filter((trade: any) => Number.isFinite(trade.at) && Number.isFinite(trade.quote) && trade.quote > 0 && Number.isFinite(trade.price) && trade.price > 0 && trade.at <= now + 2_000);
   const windowFlow = (ms: number) => {
      const rows = parsed.filter((trade: any) => trade.at >= now - ms);
      return {
         buy: rows.filter((trade: any) => !trade.buyerIsMaker).reduce((sum: number, trade: any) => sum + trade.quote, 0),
         sell: rows.filter((trade: any) => trade.buyerIsMaker).reduce((sum: number, trade: any) => sum + trade.quote, 0),
         trades: rows.length,
         coverageMs: rows.length >= 2 ? Math.max(0, Math.min(ms, rows[rows.length - 1].at - rows[0].at)) : 0,
         priceChangePct: rows.length >= 2 && rows[0].price > 0 ? (rows[rows.length - 1].price - rows[0].price) / rows[0].price : null
      };
   };
   const w30 = windowFlow(30_000), w5 = windowFlow(5_000), w1m = windowFlow(60_000), w5m = windowFlow(300_000);
   const latestTradeTime = parsed.reduce((latest: number, trade: any) => Math.max(latest, trade.at), 0);
   if (!latestTradeTime || now - latestTradeTime > 30_000 || w30.trades < 5) {
      throw new Error("Insufficient fresh Futures aggressor trades in the last 30 seconds");
   }
   const flow = {
      buyQuote: w30.buy, sellQuote: w30.sell, tradeCount: w30.trades, observedAt: latestTradeTime,
      buyQuote5s: w5.buy, sellQuote5s: w5.sell, trades5s: w5.trades,
      buyQuote30s: w30.buy, sellQuote30s: w30.sell, trades30s: w30.trades,
      buyQuote1m: w1m.buy, sellQuote1m: w1m.sell, trades1m: w1m.trades,
      buyQuote5m: w5m.buy, sellQuote5m: w5m.sell, trades5m: w5m.trades,
      priceChange30sPct: w30.priceChangePct, priceChange1mPct: w1m.priceChangePct, priceChange5mPct: w5m.priceChangePct,
      coverage1mMs: w1m.coverageMs, coverage5mMs: w5m.coverageMs,
      source: "BINANCE_AGG_TRADES" as const
   };
   setCached(aggTradeCache, key, flow, 2_000);
   return flow;
}

async function fetchOrderBookEvidence(symbol: string) {
   const liveBook = getFuturesBookFlow(symbol);
   if (liveBook && liveBook.sampleCount >= 3 && Date.now() - liveBook.observedAt <= 2_000) return liveBook;
   const cached = getCached<any>(depthCache, symbol);
   if (cached) return cached;
   const res = await axios.get(`${BINANCE_FAPI}/fapi/v1/depth`, { params: { symbol, limit: 20 }, timeout: 5000 });
   const bids = Array.isArray(res.data?.bids) ? res.data.bids : [];
   const asks = Array.isArray(res.data?.asks) ? res.data.asks : [];
   if (!bids.length || !asks.length) throw new Error("Order book unavailable");
   // Match the live depth5 WebSocket source: qualify only the executable top five levels.
   const bidNotional = bids.slice(0, 5).reduce((sum: number, level: any[]) => sum + Number(level[0]) * Number(level[1]), 0);
   const askNotional = asks.slice(0, 5).reduce((sum: number, level: any[]) => sum + Number(level[0]) * Number(level[1]), 0);
   const bestBid = Number(bids[0][0]);
   const bestAsk = Number(asks[0][0]);
   if (![bidNotional, askNotional, bestBid, bestAsk].every(Number.isFinite) || bestBid <= 0 || bestAsk < bestBid) {
      throw new Error("Malformed order book");
   }
   const mid = (bestBid + bestAsk) / 2;
   const observedAt = Date.now();
   const previous = priorDepthBySymbol.get(symbol);
   const sampleFresh = previous && observedAt - previous.observedAt <= 60_000;
   const bidDepthChangePct = sampleFresh ? ((bidNotional - previous.bidNotional) / Math.max(previous.bidNotional, 1)) * 100 : null;
   const askDepthChangePct = sampleFresh ? ((askNotional - previous.askNotional) / Math.max(previous.askNotional, 1)) * 100 : null;
   priorDepthBySymbol.set(symbol, { bidNotional, askNotional, observedAt });
   const book = {
      bidNotional, askNotional, bidDepthChangePct, askDepthChangePct,
      spreadBps: ((bestAsk - bestBid) / mid) * 10000,
      observedAt,
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
      btcCandles4h: btc4h,
      btcCandles15m: btc15m,
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

   const oiData = await fetchOI(symbol, "5m", 6);
   let oi_chg = 0;
   if (oiData && oiData.length >= 3) {
      const oi0 = parseFloat(oiData[oiData.length-1].sumOpenInterest);
      const oi3 = parseFloat(oiData[oiData.length-3].sumOpenInterest);
      if (Number.isFinite(oi0) && Number.isFinite(oi3) && oi3 > 0) oi_chg = (oi0 - oi3) / oi3;
   }

   // Align price change with the same ~10m window used by the 5m OI samples.
   const p0 = c5[c5.length-1].close;
   const p3 = c5[c5.length-3].close;
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
   const oi_available = Boolean(oiData && oiData.length >= 3 &&
      Number.isFinite(oi_chg) && Number.isFinite(oi0Safe(oiData)) &&
      (Number.isFinite(oiTimestamp) && Date.now() - oiTimestamp >= 0 && Date.now() - oiTimestamp <= 10 * 60 * 1000));
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
      asset_strong, c15, c5, c4h, slope5, slope15, slope4h
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

// Every rejected candidate is retained for passive outcome measurement. Logger deduplicates repeated scans.
function recordEntryRejection(symbol: string, direction: "LONG" | "SHORT" | "WAIT", reason: string, p: any, w: any, ctx: any, reasoning?: any) {
   if (!p || !w) return;
   logRejectedSignal({ symbol, timeframe: "1m", direction, signal_score: 0, rejection_reason: reason, p, w, ctx, reasoning });
}

// --- SEC 4: INSTITUTIONAL EVIDENCE ENTRY ENGINE (NO SCORE) ---
async function evaluateInstitutionalEntry(symbol: string, ctx: any) {
   apexPredatorStats.totalEvaluations++;
   // BTC and session are context only; scanner discovery remains continuous.

   const w = await readWhale(symbol, ctx.btc_chg);
   const p: any = await readPrice(symbol, w.c15, w.c5);
   // readPrice uses 15m context; ignition detection requires a separate live 1m Futures feed.
   const waveCandles = await fetchKl(symbol, "1m", 30);
   const wavePrice = waveCandles.length ? waveCandles[waveCandles.length - 1].close : p.price;
   updateRejectedSignalsOutcomes(symbol, p.price, p.klines);
   updateDirectionTracking(symbol, p.price);
   p.price = wavePrice;

   // Include the still-forming 1m Futures candle to avoid waiting for candle close.
   const closedCandles = waveCandles.slice(-30);
   const previousInstitutionalState = institutionalStateBySymbol.get(symbol);
   // Re-fetch a missing/stale depth snapshot before allowing an executable entry.
   let executionOrderBook = w.orderBook;
   if (!executionOrderBook || !Number.isFinite(executionOrderBook.observedAt) ||
       Date.now() - executionOrderBook.observedAt > 8_000) {
      try { executionOrderBook = await fetchOrderBookEvidence(symbol); }
      catch { executionOrderBook = null; }
   }
   w.orderBook = executionOrderBook;
   const liquidationFlowAtEntry = getFuturesLiquidationFlow(symbol);
   const liquidationFeedConnected = getFuturesWaveFeedStatus().liquidationFeedConnected;
   const institutional = evaluateInstitutionalMarket({
      symbol,
      timestamp: Date.now(),
      price: wavePrice,
      candles: closedCandles,
      futuresFlow: w.futuresFlow,
      orderBook: executionOrderBook,
      oiChange: w.oi_chg,
      oiAvailable: w.oi_available === true,
      liquidationFlow: liquidationFlowAtEntry,
      liquidationFeedConnected,
      previousState: previousInstitutionalState?.state as any,
      previousDirection: previousInstitutionalState?.direction as any,
      fundingRate: Number.isFinite(w.fund) ? w.fund : null,
      btcChange: Number.isFinite(ctx.btc_chg) ? ctx.btc_chg : null
   });

   if (institutional.state !== "DATA_INSUFFICIENT") {
      institutionalStateBySymbol.set(symbol, { state: institutional.state, direction: institutional.direction });
   }
   p.institutionalEvidence = institutional;
   p.institutionalEntryCandles = waveCandles;
   p.institutionalInvalidation = institutional.metrics.invalidationLevel;
   if (institutional.state === "DATA_INSUFFICIENT") {
      addLog(`⛔ ${symbol}: Institutional entry blocked — ${institutional.reason} Missing: ${institutional.missingEvidence.join(", ")}`, "warn");
      recordEntryRejection(symbol, institutional.direction === "LONG" || institutional.direction === "SHORT" ? institutional.direction : "WAIT", institutional.reason, p, w, ctx, { institutional });
      return { signal: "WAIT", reason: institutional.reason, p, w, ctx, institutional };
   }
   if (!institutional.canEnter || institutional.direction === "NONE") {
      if (institutional.state !== "DORMANT") {
         addLog(`🔎 ${symbol}: ${institutional.state} — ${institutional.reason}`, "info");
      }
      recordEntryRejection(symbol, institutional.direction === "LONG" || institutional.direction === "SHORT" ? institutional.direction : "WAIT", institutional.reason, p, w, ctx, { institutional });
      return { signal: "WAIT", reason: institutional.reason, p, w, ctx, institutional };
   }

   const direction = institutional.direction;
   if (direction === "LONG") apexPredatorStats.totalLongScanned++;
   else apexPredatorStats.totalShortScanned++;
   const waveAtrCandidate = calcATR(waveCandles.map((c: any) => c.high), waveCandles.map((c: any) => c.low), waveCandles.map((c: any) => c.close), 14).pop();
   if (typeof waveAtrCandidate !== "number" || !Number.isFinite(waveAtrCandidate) || waveAtrCandidate <= 0) {
      recordEntryRejection(symbol, direction, "INVALID_1M_WAVE_ATR", p, w, ctx, { institutional });
      return { signal: "WAIT", reason: "INVALID_1M_WAVE_ATR", p, w, ctx, institutional };
   }
   const waveAtr = waveAtrCandidate;
   p.waveAtr = waveAtr;
   const flow = w.futuresFlow;
   const flowImbalance = (buy: number, sell: number) => (buy - sell) / Math.max(buy + sell, 1e-9);
   const marketAlignment = evaluateMarketAlignment({
      side: direction,
      symbol,
      btcCandles4h: ctx.btcCandles4h || [], btcCandles15m: ctx.btcCandles15m || [], btcRegime: ctx.regime,
      candles4h: w.c4h || [], candles15m: w.c15 || [], candles5m: w.c5 || [], candles1m: waveCandles,
      price: wavePrice, atr1m: waveAtr,
      flowImbalance30s: flow ? flowImbalance(flow.buyQuote30s, flow.sellQuote30s) : 0,
      flowImbalance1m: flow ? flowImbalance(flow.buyQuote1m, flow.sellQuote1m) : 0,
      now: Date.now()
   });
   p.marketAlignment = marketAlignment;
   if (!marketAlignment.allowed) {
      addLog(`⏳ ${symbol} ${direction}: ${marketAlignment.state} | ${marketAlignment.reasons.join(" | ")}`, "info");
      recordEntryRejection(symbol, direction, marketAlignment.reasons.join(" | "), p, w, ctx, { institutional, marketAlignment });
      return { signal: "WAIT", reason: marketAlignment.reasons.join(" | "), p, w, ctx, institutional, marketAlignment };
   }

   const entryQuality = evaluateEntryQuality({
      side: direction,
      price: wavePrice,
      atr: waveAtr,
      now: Date.now(),
      candles: waveCandles.slice(-3),
      flow: w.futuresFlow,
      oiChange: w.oi_available ? w.oi_chg : null,
      oiPriceChange: Number.isFinite(w.p_chg) ? w.p_chg : null,
      cvd5mSlope: Number.isFinite(w.slope5) ? w.slope5 : null,
      cvd15mSlope: Number.isFinite(w.slope15) ? w.slope15 : null,
      cvd4hSlope: Number.isFinite(w.slope4h) ? w.slope4h : null
   });
   if (!entryQuality.allowed) {
      addLog(`⛔ ${symbol}: Entry quality gate — ${entryQuality.quality}: ${entryQuality.reasons.join(" | ")}`, "warn");
      recordEntryRejection(symbol, direction, entryQuality.reasons.join(" | "), p, w, ctx, { institutional, marketAlignment, entryQuality });
      return { signal: "WAIT", reason: entryQuality.reasons.join(" | "), p, w, ctx, institutional, entryQuality, marketAlignment };
   }
   const invalidation = institutional.metrics.invalidationLevel;
   if (!Number.isFinite(invalidation) || (direction === "LONG" ? invalidation >= p.price : invalidation <= p.price) || !(waveAtr > 0)) {
      addLog(`⛔ ${symbol}: Structural invalidation level is invalid; trade rejected.`, "warn");
      recordEntryRejection(symbol, direction, "INVALID_STRUCTURAL_INVALIDATION", p, w, ctx, { institutional, marketAlignment, entryQuality });
      return { signal: "WAIT", reason: "INVALID_STRUCTURAL_INVALIDATION", p, w, ctx, institutional, marketAlignment, entryQuality };
   }

   const reasoning: any = {
      regime: p.HH_HL ? "TREND_UP" : p.LH_LL ? "TREND_DOWN" : "TRANSITION",
      location: {
         nearestResistance: p.res10,
         nearestSupport: p.sup10,
         rangeHigh: p.res10,
         rangeLow: p.sup10
      },
      scenario: { primary: { type: direction === "LONG" ? (institutional.entryType === "EARLY_IGNITION" ? "IGNITION_LONG" : "BREAKOUT_LONG") : (institutional.entryType === "EARLY_IGNITION" ? "IGNITION_SHORT" : "BREAKOUT_SHORT"), state: institutional.entryType === "CONFIRMED_BREAKOUT" ? "CONFIRMED" : "EARLY", bias: direction } },
      confirmation: { isConfirmed: institutional.entryType === "CONFIRMED_BREAKOUT", isEarlyIgnition: institutional.entryType === "EARLY_IGNITION", confirmedSignal: direction, reason: institutional.reason },
      timingGate: entryQuality.timingGate,
      flow: {
         state: "FUTURES_EXECUTED_AGGRESSOR_FLOW",
         evidenceFor: institutional.evidenceFor,
         evidenceAgainst: institutional.evidenceAgainst,
         persistenceState: entryQuality.flow.persistenceState,
         persistenceScore: entryQuality.flow.persistenceScore
      },
      entryQuality,
      marketAlignment,
      entryTimeframe: "1m+30s execution / 5m context",
      futuresFlowAtEntry: w.futuresFlow,
      entryDecisionWindows: { context: "5m", confirmation: "1m", execution: "30s", optionalMicrostructure: "5s" },
      liquidationFlowAtEntry: liquidationFlowAtEntry,
      openInterestChangeAtEntry: w.oi_available ? w.oi_chg : null,
      orderBookAtEntry: institutional.dataQuality.orderBook ? w.orderBook : null,
      institutional
   };
   const grade = { label: institutional.entryType === "CONFIRMED_BREAKOUT" ? "INSTITUTIONAL_CONFIRMED" : "INSTITUTIONAL_EARLY", risk: 0.007, mult: 1.0 };
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
      p, w, ctx, reasoning, institutional, entryQuality, marketAlignment
   };
}

// --- SEC 5: EXECUTION ---
function executeTrade(symbol: string, decision: any) {
   const { p, w, grade, setupType, ctx, reasoning, institutional } = decision;
   const isPullback = setupType === "PULLBACK_SNIPER";
   // Preserve configured trade capacity while distributing a hard portfolio-risk budget across remaining risk-bearing slots.
   const isChoppyRegime = reasoning?.regime === "RANGE" || reasoning?.regime === "TRANSITION" || ctx?.regime === "RANGING";
   const regimeRiskMult = isChoppyRegime ? 0.50 : 1.0;
   const currentOpenRisk = activeTrades.reduce((sum, trade) => sum + estimateNetRiskAtStop({
      direction: trade.direction, entry: Number(trade.entry), stop: Number(trade.sl),
      position: Number(trade.pos), realizedPnl: Number(trade.realizedPnl) || 0,
      feeRate, slippageRate
   }), 0);
   const dailyRiskHeadroom = Math.max(0, initialVirtualBalance * MAX_DAILY_LOSS + Math.min(0, todaysStats.pnl));
   const portfolioRiskLimit = Math.min(initialVirtualBalance * MAX_PORTFOLIO_OPEN_RISK, dailyRiskHeadroom);
   const portfolioRiskHeadroom = Math.max(0, portfolioRiskLimit - currentOpenRisk);
   const remainingRiskSlots = Math.max(1, maxOpenTradesConfig - activeTrades.filter(trade => !trade.be_done).length);
   const targetRiskAmt = virtualBalance * grade.risk * grade.mult * regimeRiskMult;
   const riskAmt = Math.min(targetRiskAmt, portfolioRiskHeadroom / remainingRiskSlots);
   if (riskAmt <= 0) {
      addLog("[PORTFOLIO RISK CAP] " + symbol + " skipped: no remaining portfolio risk budget.", "warn");
      return;
   }
   if (riskAmt < targetRiskAmt) {
      addLog("[PORTFOLIO RISK CAP] " + symbol + ": per-trade risk reduced to $" + riskAmt.toFixed(2) +
         "; open stop risk $" + currentOpenRisk.toFixed(2) + " / $" + portfolioRiskLimit.toFixed(2) + ".", "info");
   }
   if (regimeRiskMult < 1.0) {
      addLog("[DYNAMIC RISK] " + symbol + " risk halved for choppy regime.", "info");
   }

   const entryTiming = extractEntryTiming();
   const marketRegimeContext = extractMarketRegimeContext(p, ctx, reasoning);

   if (decision.signal === "LONG") {
      const entry = p.price;
      const isBounce = setupType === "BOUNCE_SNIPER";
      const stopPlan = calculateWaveStop({
         side: "LONG", entry, atr1m: p.waveAtr,
         candles: p.institutionalEntryCandles || [],
         invalidationLevel: p.institutionalInvalidation
      });
      if (!stopPlan) {
         addLog("LONG " + symbol + " rejected: invalid or excessively distant 1m structural stop.", "warn");
         return;
      }
      const sl = stopPlan.stop;
      const realSlDist = stopPlan.distance;
      const initialSlDist = realSlDist;

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

      let pos = Math.min(riskAmt / realSlDist, maxPosCap);
      pos = capPositionToRiskBudget({ proposedPosition: pos, entry, stop: sl, availableRisk: riskAmt, feeRate, slippageRate });
      if (pos <= 0) return;
      const setupLabel = isBounce ? "🏹 قناص فخاخ السيولة" : (isPullback ? "🎯 قناص الارتداد" : "⚡ اختراق الزخم");
      const newTrade = {
         symbol, direction: "LONG", entry, sl, initialSlDist, tp1, tp2, tp3,
         pos, initialPos: pos, entryTime: new Date().toISOString(),
         entryTiming, marketRegimeContext,
         part_a: 0.25, part_b: 0.20, part_c: 0.55,
         a_closed: false, b_closed: false, c_closed: false,
         be_done: false, micro_banked: false, grade: grade.label, pnl: 0,
         institutionalEvidence: institutional, institutionalInvalidationLevel: p.institutionalInvalidation,
         setupType: isBounce ? "BOUNCE_SNIPER" : (isPullback ? "PULLBACK_SNIPER" : "BREAKOUT_MOMENTUM"),
         setupLabel,
         atr: p.waveAtr, entryAtr1m: p.waveAtr, stopBasisTimeframe: "1m", peak_r: 0,
         reasoning: decision.reasoning,
         highestPrice: entry,
         lowestPrice: entry,
         candlesBeforeEntry: formatCandles(p.institutionalEntryCandles || p.klines || [], 40),
         whaleData: {
            scenario: w.scenario,
            hiddenBuy: w.hidden_buy ? "مخفي (شراء)" : "لا يوجد",
            strongAcc: w.strong_acc ? "حركة مستويات السيولة العالية" : "طبيعي",
            fund: String((w.fund * 100).toFixed(4)) + "%",
            institutionalBias: !w.oi_available ? "غير متاح" : w.oi_chg > 0.001 ? "ارتفاع العقود المفتوحة" : w.oi_chg < -0.002 ? "انخفاض العقود المفتوحة" : "تغير محايد",
         },
         priceData: {
            rsi: p.rsi.toFixed(2),
            adx: p.adx.toFixed(2),
            marketAlignment: p.bull_align ? "متوافق مع الصعود" : p.bear_align ? "متعارض مع الصعود" : "غير واضح"
         }
      };
      activeTrades.push(newTrade);
      persistRuntimeState(true);
      registerTradeForDirectionTracking(newTrade);
      addLog(`✅ LONG ${symbol} [${setupLabel}] | دخول: ${entry.toFixed(4)} | SL: ${sl.toFixed(4)} | Institutional evidence chain confirmed`, "success");
   } else {
      const entry = p.price;
      const isBounce = setupType === "BOUNCE_SNIPER";
      const stopPlan = calculateWaveStop({
         side: "SHORT", entry, atr1m: p.waveAtr,
         candles: p.institutionalEntryCandles || [],
         invalidationLevel: p.institutionalInvalidation
      });
      if (!stopPlan) {
         addLog("SHORT " + symbol + " rejected: invalid or excessively distant 1m structural stop.", "warn");
         return;
      }
      const sl = stopPlan.stop;
      const realSlDist = stopPlan.distance;
      const initialSlDist = realSlDist;

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

      let pos = Math.min(riskAmt / realSlDist, maxPosCap);
      pos = capPositionToRiskBudget({ proposedPosition: pos, entry, stop: sl, availableRisk: riskAmt, feeRate, slippageRate });
      if (pos <= 0) return;
      const setupLabel = isBounce ? "🏹 قناص فخاخ السيولة" : (isPullback ? "🎯 قناص الارتداد" : "⚡ اختراق الزخم");
      const newTrade = {
         symbol, direction: "SHORT", entry, sl, initialSlDist, tp1, tp2, tp3,
         pos, initialPos: pos, entryTime: new Date().toISOString(),
         entryTiming, marketRegimeContext,
         part_a: 0.25, part_b: 0.20, part_c: 0.55,
         a_closed: false, b_closed: false, c_closed: false,
         be_done: false, micro_banked: false, grade: grade.label, pnl: 0,
         institutionalEvidence: institutional, institutionalInvalidationLevel: p.institutionalInvalidation,
         setupType: isBounce ? "BOUNCE_SNIPER" : (isPullback ? "PULLBACK_SNIPER" : "BREAKOUT_MOMENTUM"),
         setupLabel,
         atr: p.waveAtr, entryAtr1m: p.waveAtr, stopBasisTimeframe: "1m", peak_r: 0,
         reasoning: decision.reasoning,
         highestPrice: entry,
         lowestPrice: entry,
         candlesBeforeEntry: formatCandles(p.institutionalEntryCandles || p.klines || [], 40),
         whaleData: {
            scenario: w.scenario,
            hiddenBuy: w.hidden_sell ? "مخفي (بيع)" : "لا يوجد",
            strongAcc: w.strong_dis ? "تفريغ السيولة المؤسساتي" : "طبيعي",
            fund: String((w.fund * 100).toFixed(4)) + "%",
            institutionalBias: !w.oi_available ? "غير متاح" : w.oi_chg > 0.001 ? "ارتفاع العقود المفتوحة" : w.oi_chg < -0.002 ? "انخفاض العقود المفتوحة" : "تغير محايد",
         },
         priceData: {
            rsi: p.rsi.toFixed(2),
            adx: p.adx.toFixed(2),
            marketAlignment: p.bear_align ? "متوافق مع الهبوط" : p.bull_align ? "متعارض مع الهبوط" : "غير واضح"
         }
      };
      activeTrades.push(newTrade);
      persistRuntimeState(true);
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
   updateDirectionTracking(t.symbol, price);
   updateRejectedSignalsOutcomes(t.symbol, price, p.klines);

   const slDist = t.initialSlDist || Math.abs(t.entry - t.sl);
   const profitR = t.direction === "LONG" ? (price - t.entry)/slDist : (t.entry - price)/slDist;
   t.profitR = profitR;
   if (profitR > t.peak_r) t.peak_r = profitR;
   if (!Number.isFinite(t.peakPrice)) t.peakPrice = price;
   t.peakPrice = t.direction === "LONG" ? Math.max(t.peakPrice, price) : Math.min(t.peakPrice, price);

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
      timestamp: Date.now(),
      consecutiveAdverseObservations: (() => {
         const flow = w.futuresFlow;
         if (!flow) { t.institutionalAdverseCount = 0; return 0; }
         const observationAt = Number(flow.observedAt);
         if (!Number.isFinite(observationAt) || observationAt <= (Number(t.lastAdverseFlowObservedAt) || 0)) {
            return Number(t.institutionalAdverseCount) || 0;
         }
         t.lastAdverseFlowObservedAt = observationAt;
         const sign = t.direction === "LONG" ? 1 : -1;
         const b30 = Number.isFinite(flow.buyQuote30s) ? flow.buyQuote30s : flow.buyQuote;
         const s30 = Number.isFinite(flow.sellQuote30s) ? flow.sellQuote30s : flow.sellQuote;
         const b1 = Number.isFinite(flow.buyQuote1m) ? flow.buyQuote1m : b30;
         const s1 = Number.isFinite(flow.sellQuote1m) ? flow.sellQuote1m : s30;
         const d30 = (b30 + s30) > 0 ? ((b30 - s30) / (b30 + s30)) * sign : 0;
         const d1 = (b1 + s1) > 0 ? ((b1 - s1) / (b1 + s1)) * sign : d30;
         const p30 = Number.isFinite(flow.priceChange30sPct) ? flow.priceChange30sPct * sign : null;
         const p1 = Number.isFinite(flow.priceChange1mPct) ? flow.priceChange1mPct * sign : null;
         const d5 = Number.isFinite(flow.buyQuote5m) && Number.isFinite(flow.sellQuote5m) && (flow.buyQuote5m + flow.sellQuote5m) > 0
            ? ((flow.buyQuote5m - flow.sellQuote5m) / (flow.buyQuote5m + flow.sellQuote5m)) * sign : null;
         const p5 = Number.isFinite(flow.priceChange5mPct) ? flow.priceChange5mPct * sign : null;
         const parentWaveSupported = d5 !== null && d5 >= 0.04 && p5 !== null && p5 > -0.001;
         const adverse = !parentWaveSupported && d30 <= -0.08 && d1 <= -0.06 && ((p30 !== null && p30 <= -0.0003) || (p1 !== null && p1 <= -0.0006));
         t.institutionalAdverseCount = adverse ? Math.min(5, (t.institutionalAdverseCount || 0) + 1) : 0;
         return t.institutionalAdverseCount;
      })()
   });

   if (exitEvidence.action === "EXIT") {
      addLog(`🚨 [INSTITUTIONAL REVERSAL CONFIRMED] ${t.symbol} ${t.direction} at ${profitR.toFixed(2)}R | ${exitEvidence.reasons.join(" | ")}`, "warn");
      closeTradeFull(t, "Institutional Structure + Futures Flow Reversal");
      // Close the old side first; only a fresh opposite entry with independent confirmation may reverse.
      try {
         const reverseCandidate = await evaluateInstitutionalEntry(t.symbol, ctx);
         const reverse = evaluateReverseWave({
            fromSide: t.direction,
            candidateSide: reverseCandidate.signal === "LONG" || reverseCandidate.signal === "SHORT" ? reverseCandidate.signal : "NONE",
            entryAllowed: reverseCandidate.signal === (t.direction === "LONG" ? "SHORT" : "LONG"),
            structureConfirmed: reverseCandidate.institutional?.canEnter === true,
            flow: reverseCandidate.w?.futuresFlow || null,
            now: Date.now(),
            price: Number.isFinite(reverseCandidate.p?.price) ? reverseCandidate.p.price : NaN,
            atr: Number.isFinite(reverseCandidate.p?.waveAtr) ? reverseCandidate.p.waveAtr : NaN,
            cvd5mSlope: Number.isFinite(reverseCandidate.w?.slope5) ? reverseCandidate.w.slope5 : null,
            cvd15mSlope: Number.isFinite(reverseCandidate.w?.slope15) ? reverseCandidate.w.slope15 : null,
            cvd4hSlope: Number.isFinite(reverseCandidate.w?.slope4h) ? reverseCandidate.w.slope4h : null,
            oiChange: reverseCandidate.w?.oi_available ? reverseCandidate.w.oi_chg : null,
            oiPriceChange: Number.isFinite(reverseCandidate.w?.p_chg) ? reverseCandidate.w.p_chg : null,
            book: reverseCandidate.w?.orderBook || null,
            liquidation: getFuturesLiquidationFlow(t.symbol)
         });
         // Persist the exact reverse-wave evidence on the opened trade for post-trade audit.
         if (reverseCandidate.reasoning) reverseCandidate.reasoning.reverseWave = reverse;
         addLog(`🧪 [REVERSE WAVE AUDIT] ${t.symbol} | ${JSON.stringify(reverse.confirmations)}`, reverse.confirmed ? "success" : "info");
         const riskedOpen = activeTrades.filter(open => !open.be_done).length;
         const capacityAvailable = freeTradeSlotEnabled
            ? riskedOpen < maxOpenTradesConfig && activeTrades.length < maxOpenTradesConfig + 2
            : activeTrades.length < maxOpenTradesConfig;
         if (reverse.confirmed && capacityAvailable && !activeTrades.some(open => open.symbol === t.symbol)) {
            addLog(`🔁 [REVERSE WAVE CONFIRMED] ${t.symbol}: ${t.direction} → ${reverse.direction}`, "success");
            executeTrade(t.symbol, reverseCandidate);
         } else {
            addLog(`⏳ [REVERSE WAVE NOT ARMED] ${t.symbol} ${t.direction} closed; no opposite position opened. ${reverse.reasons.join(" | ")}`, "info");
         }
      } catch (reverseError: any) {
         addLog(`⚠️ [REVERSE WAVE CHECK FAILED] ${t.symbol}: ${reverseError?.message || "unknown error"}`, "warn");
      }
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

   const trailAtr = Array.isArray(w.c5) && w.c5.length >= 15
      ? calcATR(w.c5.map((c: any) => c.high), w.c5.map((c: any) => c.low), w.c5.map((c: any) => c.close), 14).pop()
      : null;
   const usableTrailAtr = Number.isFinite(trailAtr) && trailAtr! > 0
      ? trailAtr! : (Number.isFinite(t.atr) && t.atr > 0 ? t.atr : slDist);
   let trailDist = usableTrailAtr * (p.rvol > 1.5 ? 1.0 : 0.7);

   // Early risk reduction: reduce the original risk without choking normal pullbacks.
   if (!t.micro_banked && profitR >= 0.45) {
      const reducedRiskStop = t.direction === "LONG"
         ? t.entry - (slDist * 0.10)
         : t.entry + (slDist * 0.10);
      t.sl = t.direction === "LONG" ? Math.max(t.sl, reducedRiskStop) : Math.min(t.sl, reducedRiskStop);
      t.micro_banked = true;
      addLog(`🛡️ [RISK REDUCED] ${t.symbol} reached +${profitR.toFixed(2)}R; initial risk reduced to -0.10R.`, "info");
   }

   // Once the trade reaches +0.85R, protect a small net-positive floor while allowing room to reach +1R.
   if (profitR >= 0.85 && !t.a_closed) {
      const earlyProfitStop = t.direction === "LONG"
         ? t.entry + slDist * 0.05
         : t.entry - slDist * 0.05;
      t.sl = t.direction === "LONG" ? Math.max(t.sl, earlyProfitStop) : Math.min(t.sl, earlyProfitStop);
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

   // 1. Bank only a quarter at +1R; keep three quarters working.
   if (!t.a_closed && profitR >= 1.0) {
      closePart(t, "A", t.part_a);
      t.a_closed = true;
      t.be_done = true;
      const floorR = 0.20;
      const floorStop = t.direction === "LONG"
         ? t.entry + slDist * floorR
         : t.entry - slDist * floorR;
      t.sl = t.direction === "LONG" ? Math.max(t.sl, floorStop) : Math.min(t.sl, floorStop);
      addLog(`🎯 [PROFIT BANKED] ${t.symbol}: closed 25% at +${profitR.toFixed(2)}R; remaining 75% protected above +0.20R.`, "success");
   }

   // 2. Bank another 20% at +2R; the remaining 55% becomes an open-ended runner.
   if (t.a_closed && !t.b_closed && profitR >= 2.0) {
      closePart(t, "B", t.part_b);
      t.b_closed = true;
      const floorR = 0.80;
      const floorStop = t.direction === "LONG"
         ? t.entry + slDist * floorR
         : t.entry - slDist * floorR;
      t.sl = t.direction === "LONG" ? Math.max(t.sl, floorStop) : Math.min(t.sl, floorStop);
      addLog(`🎯 [EXPANSION BANKED] ${t.symbol}: additional 20% closed at +${profitR.toFixed(2)}R; 55% remains as runner.`, "success");
   }

   // 3. Adaptive peak-based trailing begins after the first bank, not after TP2/TP3.
   // Supportive flow gets room; weakening flow tightens the leash. The stop can only tighten.
   if (t.a_closed) {
      const atrValue = usableTrailAtr;
      const trailMultiplier = exitEvidence.action === "PROTECT"
         ? 0.90
         : (supportiveFlow && exitEvidence.action === "HOLD" ? 1.80 : 1.35);
      trailDist = Math.max(atrValue * trailMultiplier, slDist * 0.20);

      const peakPrice = Number.isFinite(t.peakPrice) ? t.peakPrice : price;
      const peakTrailStop = t.direction === "LONG"
         ? peakPrice - trailDist
         : peakPrice + trailDist;

      // Convert the best excursion into a progressively higher guaranteed R floor.
      const peakR = Number.isFinite(t.peak_r) ? t.peak_r : profitR;
      const protectedR = peakR >= 4.0 ? 2.00
         : peakR >= 3.0 ? 1.25
         : peakR >= 2.0 ? 0.80
         : peakR >= 1.5 ? 0.40
         : peakR >= 1.0 ? 0.20
         : 0;

      const peakFloorStop = t.direction === "LONG"
         ? t.entry + slDist * protectedR
         : t.entry - slDist * protectedR;

      if (t.direction === "LONG") {
         t.sl = Math.max(t.sl, peakTrailStop, peakFloorStop);
      } else {
         t.sl = Math.min(t.sl, peakTrailStop, peakFloorStop);
      }

      if (!t.runnerTrailLogged || peakR >= (t.lastRunnerTrailLogR || 0) + 1.0) {
         addLog(`🏃 [ADAPTIVE RUNNER] ${t.symbol} | peak +${peakR.toFixed(2)}R | protected floor +${protectedR.toFixed(2)}R | ATR trail x${trailMultiplier.toFixed(2)}`, "info");
         t.runnerTrailLogged = true;
         t.lastRunnerTrailLogR = peakR;
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
   persistRuntimeState(true);
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
   // Keep the in-memory dashboard history bounded; full diagnostics remain persisted by researchLogger.
   if (closedTrades.length > 150) closedTrades.length = 150;
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
   persistRuntimeState(true);
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
      for (const t of [...activeTrades]) {
         if (!activeTrades.includes(t)) continue;
         await exitBrain(t, ctx);
      }

      // Account-wide net PnL uses cumulative realized balance plus only the remaining unrealized portion.
      // This avoids truncation after the 150-trade dashboard history cap and avoids double-counting partial closes.
      const remainingUnrealizedPnl = activeTrades.reduce((sum, trade) =>
         sum + ((Number(trade.pnl) || 0) - (Number(trade.realizedPnl) || 0)), 0);
      const currentNetPnl = (virtualBalance - initialVirtualBalance) + remainingUnrealizedPnl;
      
      const profitExecutionLocked = haltProfitEnabled && currentNetPnl >= haltProfitTarget;
      const configuredLossExecutionLocked = haltLossEnabled && currentNetPnl <= -haltLossTarget;
      if ((profitExecutionLocked || configuredLossExecutionLocked) && Date.now() - riskLockLoggedAt >= 5 * 60_000) {
         riskLockLoggedAt = Date.now();
         addLog(`🛡️ EXECUTION LOCK: configured ${profitExecutionLocked ? "profit" : "loss"} threshold reached. Scanner and passive research continue; new entries are paused.`, profitExecutionLocked ? "success" : "error");
      }

      // Daily Loss Limit Protection (4% of initial balance, including floating PnL)
      const dailyLossLimit = initialVirtualBalance * MAX_DAILY_LOSS;
      let openFloatingPnl = 0;
      for (const t of activeTrades) {
         if (t.pnl) openFloatingPnl += t.pnl;
      }
      const totalDailyPnl = todaysStats.pnl + openFloatingPnl;

      const dailyRiskLocked = totalDailyPnl <= -dailyLossLimit || profitExecutionLocked || configuredLossExecutionLocked;
      if (dailyRiskLocked && Date.now() - riskLockLoggedAt >= 5 * 60_000) {
         riskLockLoggedAt = Date.now();
         addLog(`🛑 DAILY EXECUTION LOCK: PnL ${totalDailyPnl.toFixed(2)} crossed -${dailyLossLimit.toFixed(2)}. Positions remain managed; market discovery and paper signal/outcome logging continue without opening trades.`, "error");
      }

      // BTC is a context variable only. It must not veto an independently confirmed violent Futures move in an altcoin.
      if (ctx.btc_whipsaw || ctx.btc_dump || ctx.btc_pump) {
         addLog(`🌐 BTC context noted (whipsaw=${Boolean(ctx.btc_whipsaw)}, dump=${Boolean(ctx.btc_dump)}, pump=${Boolean(ctx.btc_pump)}); independent Futures wave signals remain eligible.`, "info");
      }

      // Capacity check: If freeTradeSlotEnabled, trades at Breakeven (zero risk) don't block new opportunities
      const canOpenMore = () => {
         if (dailyRiskLocked) return false;
         const currentRisked = activeTrades.filter(t => !t.be_done).length;
         if (freeTradeSlotEnabled) {
            return currentRisked < maxOpenTradesConfig && activeTrades.length < (maxOpenTradesConfig + 2);
         }
         return activeTrades.length < maxOpenTradesConfig;
      };

      // Discovery continues even when execution is risk-locked or all position slots are occupied.
      // canOpenMore() is consulted only at the moment of execution.

      // ═══ STAGE 1: PRIORITY HOT MOMENTUM QUEUE (Checked Every 15 Seconds) ═══
      // Examines top active movers & crypto majors instantly to catch breakout candle inception
      const hotCandidates = Array.from(new Set([...getFuturesWaveCandidates(Date.now()), ...HOT_WATCHLIST]))
         .filter(sym => !activeTrades.some(t => t.symbol === sym));
      const hotChunkSize = 5;
      for (let i = 0; i < hotCandidates.length; i += hotChunkSize) {
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
               if (activeTrades.some(t => t.symbol === sym)) continue;
               if (canOpenMore() && (dec.signal === "LONG" || dec.signal === "SHORT")) executeTrade(sym, dec);
            }
         }
      }

      // Continue broad-universe discovery regardless of execution capacity.

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
               if (activeTrades.some(t => t.symbol === sym)) continue;
               if (canOpenMore() && (dec.signal === "LONG" || dec.signal === "SHORT")) executeTrade(sym, dec);
            }
         }
      }
   } catch (e: any) {
      addLog(`Loop Error: ${e.message}`, "error");
   } finally {
      persistRuntimeState();
      isLoopRunning = false;
   }
}

export function startEngine() {
   const storage = getResearchStorageStatus();
   if (storage.uses_temporary_storage) {
      addLog("⚠️ State/research storage is under temporary storage (" + storage.directory + "). Set BEASTBOT_RESEARCH_DIR to a persistent Hostless volume or database-backed mount to survive restarts.", "warn");
   } else {
      addLog("💾 Bot state snapshots write to " + storage.directory + "; verify that this Hostless mount is persistent across restarts.", "info");
   }
   persistRuntimeState(true);
   if (watcherInterval) clearInterval(watcherInterval);
   watcherInterval = setInterval(runApexLoop, 15 * 1000); // Check every 15 seconds for ultra-responsive breakout inception
   runApexLoop();
   addLog("Apex Predator Engine Started with Fast Momentum Scanner (15s Cadence) & Pullback Sniper", "success");
}
