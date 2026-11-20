import axios from "axios";
import {closedCandles,markTrade} from "./tradingIntegrity.js";
import {fetchExecutionQuote} from "./executionQuotes.js";
import {evaluateStrongFlowSignal,isStrongFlowTrade,isStrongFlowTradingHour,STRONG_FLOW_STRATEGY_ID,STRONG_FLOW_MAX_HOLD_MS,STRONG_FLOW_MAX_CONCURRENT,STRONG_FLOW_RISK_FRACTION,type StrongFlowSignal} from "./strongFlowStrategy.js";
import {formatCandles,extractEntryTiming,extractMarketRegimeContext,registerTradeForDirectionTracking,logTradeDecision} from "./researchLogger.js";
const BINANCE_FAPI = "https://fapi.binance.com";
let watcherInterval: NodeJS.Timeout | null = null;
let activeTrades: any[] = [];
let todaysStats = { count: 0, wins: 0, losses: 0, pnl: 0, sumR: 0 };
let statsDay = new Date().toISOString().slice(0, 10);
let botActive = false;
let isLoopRunning = false;
let protectionInterval: NodeJS.Timeout | null = null;
let protectionRunning = false;
const diagnostics = { quoteErrors: 0, protectionCycles: 0, lastProtectionAt: 0, opened: 0, waveAccepted: 0, waveRejected: 0, rangeShadow: 0, lastReason: "", reasons: {} as Record<string, number> };
const candidateAudit: any[] = [];
function recordCandidate(symbol: string, side: string, reason: string, allowed: boolean) {
   diagnostics.lastReason = reason;
   diagnostics.reasons[reason] = (diagnostics.reasons[reason] || 0) + 1;
   candidateAudit.unshift({time: new Date().toISOString(), revision: STRONG_FLOW_STRATEGY_ID, symbol, side, reason, allowed});
   if (candidateAudit.length > 200) candidateAudit.pop();
}
export function getCandidateAudit() { return candidateAudit; }

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


const MAX_DAILY_LOSS = 0.040;

let virtualBalance = 1000;
let initialVirtualBalance = 1000;
let maxOpenTradesConfig = 10;
const lastStrongFlowSignal = new Map<string, number>();

// New Config
let haltProfitEnabled = false;
let haltProfitTarget = 150;
let haltLossEnabled = false;
let haltLossTarget = 50;
let scanBatchSize = 25;
let feeRate = 0.0004; // 0.04% default Binance VIP0 taker fee
let slippageRate = 0.0002; // 0.02% estimated market slippage

// Libya Trading Schedule Config (GMT+2)

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
  // Full reset is explicitly requested for the PAPER account only.
  // There are no exchange API orders in this engine.
  botActive = false;
  virtualBalance = 1000;
  initialVirtualBalance = 1000;
  activeTrades = [];
  closedTrades = [];
  todaysStats = { count: 0, wins: 0, losses: 0, pnl: 0, sumR: 0 };
  statsDay = new Intl.DateTimeFormat("en-CA", {timeZone:"Africa/Tripoli"}).format(new Date());
  lastStrongFlowSignal.clear();
  candidateAudit.length = 0;
  clearSymbolCooldowns();
  addLog("StrongFlow PAPER account reset: positions cleared, balance 1000, bot paused.", "success");
}

export function updateConfig(balance: number, maxTrades: number, opts?: any) {
  initialVirtualBalance = balance;
  if (opts?.resetAccount || (closedTrades.length === 0 && activeTrades.length === 0)) {
     virtualBalance = balance;
     todaysStats = { count: 0, wins: 0, losses: 0, pnl: 0, sumR: 0 };
  }
  maxOpenTradesConfig = Math.max(1, Math.min(STRONG_FLOW_MAX_CONCURRENT, Number(maxTrades) || STRONG_FLOW_MAX_CONCURRENT));
  if (opts) {
      if (opts.haltProfitEnabled !== undefined) haltProfitEnabled = opts.haltProfitEnabled;
      if (opts.haltProfitTarget !== undefined) haltProfitTarget = opts.haltProfitTarget;
      if (opts.haltLossEnabled !== undefined) haltLossEnabled = opts.haltLossEnabled;
      if (opts.haltLossTarget !== undefined) haltLossTarget = opts.haltLossTarget;
      if (opts.scanBatchSize !== undefined) scanBatchSize = Number(opts.scanBatchSize) || 25;
      if (opts.feeRate !== undefined) feeRate = Number(opts.feeRate);
      if (opts.slippageRate !== undefined) slippageRate = Number(opts.slippageRate);
  }
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
    strategyRevision: STRONG_FLOW_STRATEGY_ID,
    executionMode: "PAPER",
    strategyMode: "PB_STRONG_FLOW_FIXED2_ONLY",
    diagnostics,
    balance: virtualBalance,
    initialBalance: initialVirtualBalance,
    maxOpenTrades: maxOpenTradesConfig,
    haltProfitEnabled,
    haltProfitTarget,
    haltLossEnabled,
    haltLossTarget,
    scanBatchSize,
    feeRate,
    slippageRate,
    freeTradesCount,
    riskedTradesCount,
    watchlistLength: WATCHLIST.length,
    hotWatchlistLength: HOT_WATCHLIST.length,
    hotWatchlist: HOT_WATCHLIST.slice(0, 8),
    currentBatchProgress: `${Math.min(currentBatchIndex, WATCHLIST.length)} / ${WATCHLIST.length}`,
    isSleeping: !isStrongFlowTradingHour(),
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
    scanBatchSize,
    feeRate,
    slippageRate,
  };
}
export function setConfig(config: any) {
  if (config.virtualBalance) virtualBalance = config.virtualBalance;
  if (config.initialVirtualBalance) initialVirtualBalance = config.initialVirtualBalance;
  if (config.maxOpenTradesConfig) maxOpenTradesConfig = Math.max(1, Math.min(STRONG_FLOW_MAX_CONCURRENT, Number(config.maxOpenTradesConfig) || STRONG_FLOW_MAX_CONCURRENT));
  if (config.haltProfitEnabled !== undefined) haltProfitEnabled = config.haltProfitEnabled;
  if (config.haltProfitTarget !== undefined) haltProfitTarget = config.haltProfitTarget;
  if (config.haltLossEnabled !== undefined) haltLossEnabled = config.haltLossEnabled;
  if (config.haltLossTarget !== undefined) haltLossTarget = config.haltLossTarget;
  if (config.scanBatchSize !== undefined) scanBatchSize = Number(config.scanBatchSize) || 25;
  if (config.feeRate !== undefined) feeRate = Number(config.feeRate);
  if (config.slippageRate !== undefined) slippageRate = Number(config.slippageRate);
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

         // Apexv2-inspired impulse staging: prioritize early 2-12% movers near
         // the directional edge of their 24h range, without narrowing the universe.
         // 24h staging is only a watchlist priority, NOT proof of a fresh breakout.
         const impulsePriority = (s: any) => {
            const change = parseFloat(s.priceChangePercent) || 0;
            const absChange = Math.abs(change);
            const high = parseFloat(s.highPrice) || 0;
            const low = parseFloat(s.lowPrice) || 0;
            const last = parseFloat(s.lastPrice) || 0;
            const location = high > low ? (last - low) / (high - low) : 0.5;
            const aligned = change > 0 ? location >= 0.65 : location <= 0.35;
            const stageBonus = aligned && absChange <= 12 ? 35 : aligned && absChange <= 25 ? 15 : 0;
            return stageBonus + absChange * Math.log10(Math.max(1, parseFloat(s.quoteVolume) || 1));
         };
         const activeMovers = [...validTickers]
            .filter((s: any) => Math.abs(parseFloat(s.priceChangePercent) || 0) >= 2.0)
            .sort((a: any, b: any) => impulsePriority(b) - impulsePriority(a))
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
      params: { symbol, interval, limit: limit + 1 },
      timeout: 5000
   });
   const parsed = closedCandles(res.data.map((k: any) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
      quoteVolume: parseFloat(k[7]),
      takerBuyQuote: parseFloat(k[10]),
      takerBuy: parseFloat(k[9]),
      takerSell: parseFloat(k[5]) - parseFloat(k[9]) // volume - taker buy = taker sell
   }))).slice(-limit);

   setCached(klineCache, cacheKey, parsed, ttl);
   return parsed;
}

// --- Main branch 1m PB_STRONG_FLOW + fixed 2R entry (PAPER only) ---
// A separate entry path avoids passing these 1m signals through the old 15m
// score/wave filters, which would change the historical research conditions.
async function executeStrongFlowTrade(symbol: string, s: StrongFlowSignal, ctx: any, candles: any[]) {
   if (!botActive || activeTrades.some(t => t.symbol === symbol) || isSymbolInCooldown(symbol) ||
       !isStrongFlowTradingHour() || lastStrongFlowSignal.get(symbol) === s.signalCloseTime) return;
   let quote;
   try { quote = await fetchExecutionQuote(symbol); }
   catch { diagnostics.quoteErrors++; recordCandidate(symbol, s.side, "STRONG_FLOW_QUOTE_UNAVAILABLE", false); return; }
   if (!botActive || !isStrongFlowTradingHour() || Date.now() - s.signalCloseTime > 90_000) return;
   const entry = s.side === "LONG" ? quote.ask * (1 + slippageRate) : quote.bid * (1 - slippageRate);
   const dist = s.atr14 * 2;
   const pct = dist / entry;
   // Same historical fee-aware stop boundaries (0.48%-4%). Avoid false
   // opportunity from fee friction on exceptionally narrow stops.
   if (!(dist > 0 && entry > 0 && pct >= 0.0048 && pct <= 0.04)) {
      recordCandidate(symbol, s.side, "STRONG_FLOW_STOP_DISTANCE", false); return;
   }
   const risked = activeTrades.reduce((sum, t) => sum + Math.max(0,
      (t.direction === "LONG" ? t.entry - t.sl : t.sl - t.entry) * t.pos +
      t.entry * t.pos * 2 * (feeRate + slippageRate)), 0);
   const budget = Math.max(0, initialVirtualBalance * MAX_DAILY_LOSS + Math.min(0, todaysStats.pnl) - risked);
   const riskDollars = Math.min(virtualBalance * STRONG_FLOW_RISK_FRACTION, budget);
   const marginCapNotional = Math.min(virtualBalance * 10, virtualBalance * 0.15 * 10);
   const pos = Math.min(riskDollars / (dist + entry * 2 * (feeRate + slippageRate)), marginCapNotional / entry);
   if (!(pos > 0 && Number.isFinite(pos))) {
      recordCandidate(symbol, s.side, "STRONG_FLOW_RISK_BUDGET", false); return;
   }
   const sign = s.side === "LONG" ? 1 : -1;
   const stop = entry - sign * dist;
   const target = entry + sign * 2 * dist;
   if (!(stop > 0 && target > 0)) return;
   const trade: any = {
      symbol, direction: s.side, entry, sl: stop, initialSlDist: dist,
      tp1: target, tp2: target, tp3: target, pos, initialPos: pos,
      entryTime: new Date().toISOString(), entryTiming: extractEntryTiming(),
      marketRegimeContext: extractMarketRegimeContext({rvol:s.rvol,atr14:s.atr14,atr20:s.atr14},ctx),
      strategyRevision: STRONG_FLOW_STRATEGY_ID, executionMode: "PAPER",
      setupType: "PB_STRONG_FLOW", setupLabel: "1m strong flow / fixed 2R",
      part_a: 1, part_b: 0, part_c: 0,
      a_closed: false, b_closed: false, c_closed: false, be_done: false,
      peak_r: 0, micro_banked: false, score: 0, grade: "GRADE_A", pnl: 0,
      atr: s.atr14, entrySignalTime: s.signalCloseTime, currentPrice: entry,
      highestPrice: entry, lowestPrice: entry,
      candlesBeforeEntry: formatCandles(candles, 40),
      priceData: {rvol:s.rvol,atr14:s.atr14,delta:s.delta,flow5:s.flow5,flow15:s.flow15,trend15:s.trend15,trend60:s.trend60},
      whaleData: {scenario:"STRONG_FLOW_1M_EXECUTED_TAKER_QUOTE"},
      reasoning: {flow: {state:"STRONG_FLOW_1M"}, timingGate:{state:"CONFIRMED"}}
   };
   activeTrades.push(trade);
   lastStrongFlowSignal.set(symbol, s.signalCloseTime);
   diagnostics.opened++;
   registerTradeForDirectionTracking(trade);
   recordCandidate(symbol, s.side, "PB_STRONG_FLOW_FIXED_2R", true);
   addLog(`✅ PAPER ${s.side} ${symbol} strong flow 1m | entry=${entry.toFixed(6)} SL=${stop.toFixed(6)} full TP=${target.toFixed(6)} 2R`, "success");
}

async function scanStrongFlowEntries(ctx: any, canOpenMore: () => boolean) {
   if (!isStrongFlowTradingHour()) return;
   // Hot queue + rotating broad universe. No 15m scoring pipeline for new trades.
   const urgent = HOT_WATCHLIST.filter(sym => !activeTrades.some(t => t.symbol === sym) && !isSymbolInCooldown(sym));
   const all = [...new Set([...urgent, ...WATCHLIST.slice(currentBatchIndex, currentBatchIndex + scanBatchSize)])];
   currentBatchIndex = currentBatchIndex + scanBatchSize >= WATCHLIST.length ? 0 : currentBatchIndex + scanBatchSize;
   for (let i = 0; i < all.length && canOpenMore(); i += 5) {
      const chunk = all.slice(i, i+5);
      const candidates = await Promise.allSettled(chunk.map(async symbol => {
         if (activeTrades.some(t => t.symbol === symbol) || isSymbolInCooldown(symbol)) return null;
         try {
            const candles = await fetchKl(symbol, "1m", 85);
            const signal = evaluateStrongFlowSignal(candles);
            return signal ? {symbol, candles, signal} : null;
         } catch { return null; }
      }));
      for (const candidate of candidates) {
         if (!canOpenMore()) break;
         if (candidate.status !== "fulfilled" || !candidate.value) continue;
         const {symbol,signal,candles} = candidate.value;
         await executeStrongFlowTrade(symbol, signal, ctx, candles);
      }
   }
}

function closeTradeFull(t: any, reason: string = "") {
   if (!activeTrades.includes(t) || t.exitTime) return;
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

// Dedicated paper engine: PB_STRONG_FLOW_FIXED2_1M_V1 only.
export async function runApexLoop() {
  if (!botActive || isLoopRunning) return;
  isLoopRunning = true;
  try {
    resetDailyStatsIfNeeded();
    await runProtectionCycle();
    const floatingPnl = activeTrades.reduce((total,t) => total + (Number(t.pnl) || 0), 0);
    const dailyPnl = todaysStats.pnl + floatingPnl;
    if (haltLossEnabled && dailyPnl <= -haltLossTarget) {
      botActive = false;
      addLog("StrongFlow paused at configured loss limit", "error");
      return;
    }
    if (haltProfitEnabled && dailyPnl >= haltProfitTarget) {
      botActive = false;
      addLog("StrongFlow paused at configured profit limit", "success");
      return;
    }
    if (dailyPnl <= -(initialVirtualBalance * MAX_DAILY_LOSS)) {
      addLog("StrongFlow daily 4% loss limit: no new entries", "warn");
      return;
    }
    if (!isStrongFlowTradingHour()) return;
    await updateDynamicWatchlist();
    const canOpenMore = () => botActive && activeTrades.length < Math.min(maxOpenTradesConfig, STRONG_FLOW_MAX_CONCURRENT);
    if (canOpenMore()) await scanStrongFlowEntries({regime:"STRONG_FLOW_ONLY"}, canOpenMore);
  } catch (e: any) {
    addLog("StrongFlow loop error: "+(e?.message || String(e)), "error");
  } finally {
    isLoopRunning = false;
  }
}
export function startEngine() {
  botActive = false;
  activeTrades = [];
  closedTrades = [];
  lastStrongFlowSignal.clear();
  clearSymbolCooldowns();
  if (protectionInterval) clearInterval(protectionInterval);
  protectionInterval = setInterval(() => {void runProtectionCycle();}, 2000);
  if (watcherInterval) clearInterval(watcherInterval);
  watcherInterval = setInterval(() => {void runApexLoop();}, 15000);
  addLog("Exclusive PB_STRONG_FLOW_FIXED2_1M_V1 PAPER startup: zero positions, bot paused", "success");
}
export function protectTradeAtPrice(t: any, price: number, quoteTime = Date.now()) {
  const now = Date.now();
  if (!activeTrades.includes(t) || !isStrongFlowTrade(t) || t.exitTime || !(t.pos > 0)) return;
  if (!Number.isFinite(quoteTime) || now - quoteTime > 5000 || quoteTime > now + 1000 || quoteTime < (t.lastQuoteTime || 0)) return;
  if (!Number.isFinite(price) || price <= 0 || !(t.initialSlDist > 0)) return;
  t.lastQuoteTime = quoteTime;
  if (markTrade(t, price, feeRate, slippageRate)) {
    closeTradeFull(t, "PB_STRONG_FLOW Stop Loss");
    return;
  }
  const sign = t.direction === "LONG" ? 1 : -1;
  if (sign * (price - t.entry) >= 2 * t.initialSlDist) {
    closeTradeFull(t, "PB_STRONG_FLOW Fixed 2R Target");
  } else if (now - Date.parse(t.entryTime) >= STRONG_FLOW_MAX_HOLD_MS) {
    closeTradeFull(t, "PB_STRONG_FLOW 180m Time Exit");
  }
}
export async function runProtectionCycle() {
  if (protectionRunning || activeTrades.length === 0) return;
  protectionRunning = true;
  try {
    await Promise.allSettled([...activeTrades].map(async t => {
      if (!isStrongFlowTrade(t)) return;
      try {
        const q = await fetchExecutionQuote(t.symbol);
        protectTradeAtPrice(t, t.direction === "LONG" ? q.bid : q.ask, q.time);
      } catch { diagnostics.quoteErrors++; }
    }));
    diagnostics.protectionCycles++;
    diagnostics.lastProtectionAt = Date.now();
  } finally { protectionRunning = false; }
}
