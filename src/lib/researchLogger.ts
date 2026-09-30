// ============================================================================
// BeastBotSniper Data Logging & Research Dataset Engine (v2.3.0)
// Full diagnostic trace for post-trade & rejected signal future outcome tracking
// Designed for rigorous ChatGPT post-hoc dataset analysis:
// - Session x Market Regime x Direction x Setup Type x Result
// - Precise Entry Timing (UTC hour, minute, hour bucket, session)
// - Volatility States (HIGH / LOW / NORMAL) and ATR ratios
// ============================================================================

import fs from "fs";
import path from "path";

const SCHEMA_VERSION = "2.3.0";
const BOT_VERSION = "BeastBot-Apex-v2.3";
const RESEARCH_DIR = path.resolve(process.cwd(), "data", "research");

// Ensure research output directory exists safely
try {
   if (!fs.existsSync(RESEARCH_DIR)) {
      fs.mkdirSync(RESEARCH_DIR, { recursive: true });
   }
} catch (e) {
   console.error("Failed to initialize research directory:", e);
}

const TRADING_DECISIONS_FILE = path.join(RESEARCH_DIR, "trading_decisions.jsonl");
const REJECTED_SIGNALS_FILE = path.join(RESEARCH_DIR, "rejected_signals.jsonl");
const TRADE_JOURNEYS_FILE = path.join(RESEARCH_DIR, "trade_journeys.jsonl");
const PERFORMANCE_SUMMARY_FILE = path.join(RESEARCH_DIR, "performance_summary.json");
const DAILY_SUMMARY_FILE = path.join(RESEARCH_DIR, "daily_summary.jsonl");

// In-memory buffer to prevent disk I/O bottlenecks and allow online API retrieval
const memoryDecisions: any[] = [];
const memoryRejected: any[] = [];
const memoryJourneys: any[] = [];

// Map to track active in-flight rejected signals for future outcome monitoring without extra API requests
const pendingRejectedMap = new Map<string, any>();

let cachedSummary: any = null;

// Helper to safely append to JSONL without blocking event loop
function appendJsonlSafe(filePath: string, obj: any) {
   try {
      const line = JSON.stringify(obj) + "\n";
      fs.appendFile(filePath, line, "utf8", (err) => {
         if (err) console.error(`Research Log error on ${path.basename(filePath)}:`, err.message);
      });
   } catch (err: any) {
      console.error(`Research Log synchronous exception:`, err?.message);
   }
}

// Rewrite entire JSONL file safely when completed outcomes are finalized
function rewriteJsonlSafe(filePath: string, items: any[]) {
   try {
      const content = items.map(item => JSON.stringify(item)).join("\n") + "\n";
      fs.writeFile(filePath, content, "utf8", (err) => {
         if (err) console.error(`Research Log rewrite error on ${path.basename(filePath)}:`, err.message);
      });
   } catch (err: any) {
      console.error(`Research Log rewrite exception:`, err?.message);
   }
}

// ----------------------------------------------------------------------------
// 1. ENTRY TIMING EXTRACTION (Strict UTC)
// Session buckets:
// 00:00–07:59 -> "ASIA"
// 08:00–12:59 -> "LONDON"
// 13:00–16:59 -> "LONDON_NY_OVERLAP"
// 17:00–20:59 -> "NEW_YORK"
// 21:00–23:59 -> "LATE_US"
// ----------------------------------------------------------------------------
export interface EntryTiming {
   timezone: string;
   timestamp_entry: string;
   utc_hour: number;
   utc_minute: number;
   hour_bucket: string;
   session: "ASIA" | "LONDON" | "LONDON_NY_OVERLAP" | "NEW_YORK" | "LATE_US" | "UNKNOWN";
}

export function extractEntryTiming(dateInput?: string | number | Date): EntryTiming {
   try {
      const d = dateInput ? new Date(dateInput) : new Date();
      if (isNaN(d.getTime())) {
         return {
            timezone: "UTC",
            timestamp_entry: new Date().toISOString(),
            utc_hour: 0,
            utc_minute: 0,
            hour_bucket: "00:00-00:59",
            session: "UNKNOWN"
         };
      }

      const utc_hour = d.getUTCHours();
      const utc_minute = d.getUTCMinutes();
      const hourStr = String(utc_hour).padStart(2, "0");
      const hour_bucket = `${hourStr}:00-${hourStr}:59`;

      let session: "ASIA" | "LONDON" | "LONDON_NY_OVERLAP" | "NEW_YORK" | "LATE_US" = "ASIA";
      if (utc_hour >= 0 && utc_hour <= 7) {
         session = "ASIA";
      } else if (utc_hour >= 8 && utc_hour <= 12) {
         session = "LONDON";
      } else if (utc_hour >= 13 && utc_hour <= 16) {
         session = "LONDON_NY_OVERLAP";
      } else if (utc_hour >= 17 && utc_hour <= 20) {
         session = "NEW_YORK";
      } else if (utc_hour >= 21 && utc_hour <= 23) {
         session = "LATE_US";
      }

      return {
         timezone: "UTC",
         timestamp_entry: d.toISOString(),
         utc_hour,
         utc_minute,
         hour_bucket,
         session
      };
   } catch {
      return {
         timezone: "UTC",
         timestamp_entry: new Date().toISOString(),
         utc_hour: 0,
         utc_minute: 0,
         hour_bucket: "00:00-00:59",
         session: "UNKNOWN"
      };
   }
}

// ----------------------------------------------------------------------------
// 2. MARKET REGIME & VOLATILITY STATE EXTRACTION
// Evaluates:
// - strategy_regime (TREND_UP, TREND_DOWN, RANGE, HIGH_VOLATILITY, TRANSITION)
// - btc_regime
// - rvol, atr14, atr20, atr_ratio
// - volatility_state: HIGH if RVOL >= 2.0 or ATR14/ATR20 >= 1.4
//                     LOW if RVOL <= 0.7 or ATR14/ATR20 <= 0.8
//                     NORMAL otherwise
// ----------------------------------------------------------------------------
export interface MarketRegimeContext {
   strategy_regime: string;
   btc_regime: string;
   volatility_state: "HIGH" | "LOW" | "NORMAL" | "UNKNOWN";
   rvol: number | null;
   atr14: number | null;
   atr20: number | null;
   atr_ratio: number | null;
}

export function extractMarketRegimeContext(p?: any, ctx?: any, reasoning?: any): MarketRegimeContext {
   const strategy_regime = reasoning?.regime || ctx?.regime || "UNKNOWN";
   const btc_regime = ctx?.regime || "UNKNOWN";

   const rvol = typeof p?.rvol === "number" && !isNaN(p.rvol) ? Number(p.rvol.toFixed(2)) : null;
   const atr14 = typeof p?.atr14 === "number" && !isNaN(p.atr14) ? Number(p.atr14.toFixed(4)) : null;
   const atr20 = typeof p?.atr20 === "number" && !isNaN(p.atr20) ? Number(p.atr20.toFixed(4)) : null;

   let atr_ratio: number | null = null;
   if (atr14 !== null && atr20 !== null && atr20 > 0) {
      atr_ratio = Number((atr14 / atr20).toFixed(3));
   }

   let volatility_state: "HIGH" | "LOW" | "NORMAL" = "NORMAL";
   const isHighRvol = rvol !== null && rvol >= 2.0;
   const isHighAtrRatio = atr_ratio !== null && atr_ratio >= 1.4;
   const isLowRvol = rvol !== null && rvol <= 0.7;
   const isLowAtrRatio = atr_ratio !== null && atr_ratio <= 0.8;

   if (isHighRvol || isHighAtrRatio) {
      volatility_state = "HIGH";
   } else if (isLowRvol || isLowAtrRatio) {
      volatility_state = "LOW";
   } else {
      volatility_state = "NORMAL";
   }

   return {
      strategy_regime,
      btc_regime,
      volatility_state,
      rvol,
      atr14,
      atr20,
      atr_ratio
   };
}

// ----------------------------------------------------------------------------
// Format candle array consistently preserving REAL exchange timestamps
// ----------------------------------------------------------------------------
export function formatCandles(klines: any[], limit: number = 50) {
   if (!Array.isArray(klines) || klines.length === 0) return [];
   return klines.slice(-limit).map((k: any) => {
      let realTimeMs: number | null = null;
      if (typeof k.openTime === 'number' && !isNaN(k.openTime)) {
         realTimeMs = k.openTime;
      } else if (typeof k.time === 'number' && !isNaN(k.time)) {
         realTimeMs = k.time;
      } else if (typeof k.timestamp === 'number' && !isNaN(k.timestamp)) {
         realTimeMs = k.timestamp;
      } else if (typeof k.t === 'number' && !isNaN(k.t)) {
         realTimeMs = k.t;
      } else if (Array.isArray(k) && typeof k[0] === 'number') {
         realTimeMs = k[0];
      } else if (typeof k.openTime === 'string') {
         realTimeMs = Date.parse(k.openTime);
      } else if (typeof k.time === 'string') {
         realTimeMs = Date.parse(k.time);
      }

      const isoTimestamp = (realTimeMs && !isNaN(realTimeMs))
         ? new Date(realTimeMs).toISOString()
         : null;

      const openVal = k.open !== undefined ? Number(k.open) : (Array.isArray(k) ? Number(k[1]) : 0);
      const highVal = k.high !== undefined ? Number(k.high) : (Array.isArray(k) ? Number(k[2]) : 0);
      const lowVal = k.low !== undefined ? Number(k.low) : (Array.isArray(k) ? Number(k[3]) : 0);
      const closeVal = k.close !== undefined ? Number(k.close) : (Array.isArray(k) ? Number(k[4]) : 0);
      const volVal = k.volume !== undefined ? Number(k.volume) : (Array.isArray(k) ? Number(k[5]) : 0);
      const quoteVol = k.quoteVolume ? Number(k.quoteVolume) : (Array.isArray(k) && k[7] ? Number(k[7]) : null);
      const tradesNum = k.trades ? Number(k.trades) : (Array.isArray(k) && k[8] ? Number(k[8]) : null);

      return {
         timestamp: isoTimestamp,
         open: isNaN(openVal) ? 0 : openVal,
         high: isNaN(highVal) ? 0 : highVal,
         low: isNaN(lowVal) ? 0 : lowVal,
         close: isNaN(closeVal) ? 0 : closeVal,
         volume: isNaN(volVal) ? 0 : volVal,
         quote_volume: quoteVol,
         number_of_trades: tradesNum
      };
   });
}

// ----------------------------------------------------------------------------
// Helper for MFE & MAE calculation strictly according to trade direction
// ----------------------------------------------------------------------------
export function calculateDirectionalExcursions(direction: "LONG" | "SHORT" | string, signalPrice: number, highestPrice: number, lowestPrice: number) {
   if (!signalPrice || signalPrice <= 0) {
      return { mfePercent: 0, maePercent: 0 };
   }

   let mfePercent = 0;
   let maePercent = 0;

   if (direction === "LONG") {
      mfePercent = ((highestPrice - signalPrice) / signalPrice) * 100;
      maePercent = ((lowestPrice - signalPrice) / signalPrice) * 100;
   } else if (direction === "SHORT") {
      mfePercent = ((signalPrice - lowestPrice) / signalPrice) * 100;
      maePercent = ((signalPrice - highestPrice) / signalPrice) * 100;
   } else {
      mfePercent = Math.max(0, ((highestPrice - signalPrice) / signalPrice) * 100);
      maePercent = Math.min(0, ((lowestPrice - signalPrice) / signalPrice) * 100);
   }

   return {
      mfePercent: Number(mfePercent.toFixed(3)),
      maePercent: Number(maePercent.toFixed(3))
   };
}

// ----------------------------------------------------------------------------
// 3. LOG REJECTED SIGNALS & INITIALIZE FUTURE OUTCOME TRACKING
// ----------------------------------------------------------------------------
export function logRejectedSignal(payload: {
   symbol: string;
   timeframe: string;
   direction: "LONG" | "SHORT" | "WAIT";
   signal_score: number;
   rejection_reason: string;
   p: any;
   w: any;
   ctx: any;
   reasoning?: any;
}) {
   try {
      const { symbol, timeframe, direction, signal_score, rejection_reason, p, w, ctx, reasoning } = payload;
      
      const signalTime = new Date();
      const signalPrice = p?.price || (p?.klines?.length ? p.klines[p.klines.length - 1].close : 0);
      const signalId = `REJ_${symbol}_${signalTime.getTime()}`;

      const entryTiming = extractEntryTiming(signalTime);
      const marketContext = extractMarketRegimeContext(p, ctx, reasoning);

      const conditions_met: string[] = [];
      const conditions_failed: string[] = [];

      if (reasoning) {
         if (reasoning.confirmation?.evidence) conditions_met.push(...reasoning.confirmation.evidence);
         if (reasoning.confirmation?.missingItems) conditions_failed.push(...reasoning.confirmation.missingItems);
      }
      if (rejection_reason && !conditions_failed.includes(rejection_reason)) {
         conditions_failed.push(rejection_reason);
      }

      const event: any = {
         schema_version: SCHEMA_VERSION,
         bot_version: BOT_VERSION,
         event_type: "SIGNAL_REJECTED",
         signal_id: signalId,
         timestamp: entryTiming.timestamp_entry,
         symbol,
         timeframe: timeframe || "15m",
         direction,
         signal_score: Number(signal_score.toFixed(2)),
         signal_price: signalPrice,
         rejection_reason,
         market_regime: marketContext.strategy_regime,
         flow_state: reasoning?.flow?.state || "UNKNOWN",
         setup_type: reasoning?.scenario?.primary?.type || "BREAKOUT_MOMENTUM",
         conditions_met,
         conditions_failed,
         
         // ═══ ENTRY TIMING & REGIME ANALYTICS ═══
         entry_timing: entryTiming,
         market_context: {
            ...marketContext,
            btc_trend: ctx?.btc_trend ?? null,
            btc_tradeable: ctx?.tradeable ?? true,
            btc_chg: ctx?.btc_chg ?? null
         },

         indicators: {
            rsi: p?.rsi ?? null,
            macd_hist: p?.hist?.length ? p.hist[p.hist.length - 1] : null,
            adx: p?.adx ?? null,
            atr14: p?.atr14 ?? null,
            atr20: p?.atr20 ?? null,
            ema21: p?.ema21 ?? null,
            ema50: p?.ema50 ?? null,
            ema200: p?.ema200 ?? null,
            rvol: p?.rvol ?? null,
            taker_ratio: p?.taker ?? null,
            cvd_slope15: w?.slope15 ?? null,
            cvd_slope5: w?.slope5 ?? null,
            oi_change: w?.oi_chg ?? null,
            funding_rate: w?.fund ?? null,
            supertrend: p?.st_bull ? "BULL" : p?.st_bear ? "BEAR" : "NEUTRAL"
         },
         location: {
            nearest_resistance: reasoning?.location?.nearestResistance ?? null,
            nearest_support: reasoning?.location?.nearestSupport ?? null,
            near_resistance: reasoning?.location?.nearResistance ?? false,
            near_support: reasoning?.location?.nearSupport ?? false,
            liquidity_data: "unavailable"
         },
         candles_before_signal: formatCandles(p?.klines || [], 40),
         
         future_outcomes: {
            snapshot_5m: null,
            snapshot_15m: null,
            snapshot_30m: null,
            snapshot_60m: null,
            snapshot_120m: null
         },
         excursions: {
            mfe_15m: null,
            mae_15m: null,
            mfe_30m: null,
            mae_30m: null,
            mfe_60m: null,
            mae_60m: null,
            mfe_120m: null,
            mae_120m: null
         },
         post_rejection_outcome: "UNKNOWN",
         candles_after_signal: []
      };

      memoryRejected.unshift(event);
      if (memoryRejected.length > 200) memoryRejected.pop();

      pendingRejectedMap.set(signalId, {
         signalId,
         symbol,
         direction,
         signalPrice,
         signalTimeMs: signalTime.getTime(),
         highestSinceSignal: signalPrice,
         lowestSinceSignal: signalPrice,
         targetEvent: event,
         completed: false
      });

      appendJsonlSafe(REJECTED_SIGNALS_FILE, event);
      updateSummaries(null);
   } catch (err: any) {
      console.error("Error in logRejectedSignal:", err?.message);
   }
}

// ----------------------------------------------------------------------------
// 4. PASSIVE FUTURE OUTCOME EVALUATOR (Zero Extra API Requests)
// ----------------------------------------------------------------------------
export function updateRejectedSignalsOutcomes(symbol: string, currentPrice: number, currentKlines?: any[]) {
   if (pendingRejectedMap.size === 0 || !symbol || !currentPrice) return;

   const now = Date.now();
   let needsRewrite = false;

   for (const [id, item] of pendingRejectedMap.entries()) {
      if (item.symbol !== symbol) continue;

      const elapsedMinutes = (now - item.signalTimeMs) / 60000;
      
      if (currentPrice > item.highestSinceSignal) item.highestSinceSignal = currentPrice;
      if (currentPrice < item.lowestSinceSignal) item.lowestSinceSignal = currentPrice;

      const priceChangePct = item.signalPrice > 0 
         ? ((currentPrice - item.signalPrice) / item.signalPrice) * 100 
         : 0;

      const currentExcursion = calculateDirectionalExcursions(
         item.direction,
         item.signalPrice,
         item.highestSinceSignal,
         item.lowestSinceSignal
      );

      const target = item.targetEvent;
      if (!target) continue;

      const makeSnapshot = () => ({
         timestamp: new Date().toISOString(),
         price: currentPrice,
         price_change_percent_from_signal: Number(priceChangePct.toFixed(3)),
         high_since_signal: item.highestSinceSignal,
         low_since_signal: item.lowestSinceSignal,
         mfe_percent: currentExcursion.mfePercent,
         mae_percent: currentExcursion.maePercent
      });

      if (elapsedMinutes >= 5 && !target.future_outcomes.snapshot_5m) {
         target.future_outcomes.snapshot_5m = makeSnapshot();
         needsRewrite = true;
      }

      if (elapsedMinutes >= 15 && !target.future_outcomes.snapshot_15m) {
         target.future_outcomes.snapshot_15m = makeSnapshot();
         target.excursions.mfe_15m = currentExcursion.mfePercent;
         target.excursions.mae_15m = currentExcursion.maePercent;
         needsRewrite = true;
      }

      if (elapsedMinutes >= 30 && !target.future_outcomes.snapshot_30m) {
         target.future_outcomes.snapshot_30m = makeSnapshot();
         target.excursions.mfe_30m = currentExcursion.mfePercent;
         target.excursions.mae_30m = currentExcursion.maePercent;
         needsRewrite = true;
      }

      if (elapsedMinutes >= 60 && !target.future_outcomes.snapshot_60m) {
         target.future_outcomes.snapshot_60m = makeSnapshot();
         target.excursions.mfe_60m = currentExcursion.mfePercent;
         target.excursions.mae_60m = currentExcursion.maePercent;
         needsRewrite = true;
      }

      if (elapsedMinutes >= 120 && !target.future_outcomes.snapshot_120m) {
         target.future_outcomes.snapshot_120m = makeSnapshot();
         target.excursions.mfe_120m = currentExcursion.mfePercent;
         target.excursions.mae_120m = currentExcursion.maePercent;

         if (currentKlines && Array.isArray(currentKlines)) {
            const afterKlines = currentKlines.filter((k: any) => {
               const kTime = k.openTime || k.time || (Array.isArray(k) ? k[0] : 0);
               return kTime >= item.signalTimeMs;
            });
            target.candles_after_signal = formatCandles(afterKlines, 12);
         }

         const finalMfe = target.excursions.mfe_120m || 0;
         const finalMae = Math.abs(target.excursions.mae_120m || 0);

         if (finalMfe >= 1.5 && finalMae <= 0.8) {
            target.post_rejection_outcome = "FAVORABLE";
         } else if (finalMae >= 1.5 && finalMfe <= 0.8) {
            target.post_rejection_outcome = "ADVERSE";
         } else if (finalMfe >= 1.2 && finalMae >= 1.2) {
            target.post_rejection_outcome = "MIXED";
         } else {
            target.post_rejection_outcome = "UNKNOWN";
         }

         item.completed = true;
         pendingRejectedMap.delete(id);
         needsRewrite = true;
      }
   }

   if (needsRewrite) {
      rewriteJsonlSafe(REJECTED_SIGNALS_FILE, memoryRejected);
      updateSummaries(null);
   }
}

// ----------------------------------------------------------------------------
// 5. LOG COMPLETED TRADE DECISION
// Full trade lifecycle from entry to exit with Entry Timing & Market Regime
// ----------------------------------------------------------------------------
export function logTradeDecision(trade: any, exitContext: {
   exitPrice: number;
   exitReason: string;
   finalPnl: number;
   fees: number;
   currentKlines?: any[];
}) {
   try {
      const entryTime = new Date(trade.entryTime || Date.now());
      const exitTime = new Date();
      const holdingSeconds = Math.max(0, Math.floor((exitTime.getTime() - entryTime.getTime()) / 1000));

      const entryPrice = trade.entry;
      const highestPrice = trade.highestPrice || Math.max(entryPrice, exitContext.exitPrice);
      const lowestPrice = trade.lowestPrice || Math.min(entryPrice, exitContext.exitPrice);

      const timeToMfe = trade.timeOfHighestPrice 
         ? Math.max(0, Math.floor((trade.timeOfHighestPrice - entryTime.getTime()) / 1000))
         : holdingSeconds;

      const timeToMae = trade.timeOfLowestPrice 
         ? Math.max(0, Math.floor((trade.timeOfLowestPrice - entryTime.getTime()) / 1000))
         : holdingSeconds;

      let mfe = 0;
      let mae = 0;
      const initialSlDist = trade.initialSlDist || Math.abs(entryPrice - trade.sl);

      if (trade.direction === "LONG") {
         mfe = (highestPrice - entryPrice) / initialSlDist;
         mae = (entryPrice - lowestPrice) / initialSlDist;
      } else {
         mfe = (entryPrice - lowestPrice) / initialSlDist;
         mae = (highestPrice - entryPrice) / initialSlDist;
      }

      const pnlPercent = trade.initialPos > 0 ? (exitContext.finalPnl / (entryPrice * trade.initialPos)) * 100 : 0;
      const result = exitContext.finalPnl > 0.15 ? "WIN" : exitContext.finalPnl < -0.15 ? "LOSS" : "BREAKEVEN";

      // Precise Entry Timing & Market Regime from trade object or parsed cleanly
      const entryTiming = trade.entryTiming || extractEntryTiming(trade.entryTime);
      const marketRegimeContext = trade.marketRegimeContext || extractMarketRegimeContext(
         trade.priceData,
         trade.ctx,
         trade.reasoning
      );

      const event = {
         schema_version: SCHEMA_VERSION,
         bot_version: BOT_VERSION,
         event_type: "TRADING_DECISION",
         trade_id: `${trade.symbol}_${entryTime.getTime()}`,
         timestamp_entry: trade.entryTime,
         timestamp_exit: exitTime.toISOString(),
         symbol: trade.symbol,
         exchange: "Binance Futures (Paper)",
         timeframe: "15m",
         side: trade.direction,
         signal_type: trade.setupType || "BREAKOUT_MOMENTUM",
         market_regime: marketRegimeContext.strategy_regime,
         
         // ═══ ENTRY TIMING & REGIME ANALYTICS ═══
         entry_timing: entryTiming,
         market_context: marketRegimeContext,

         entry_price: entryPrice,
         exit_price: exitContext.exitPrice,
         stop_loss: trade.sl,
         take_profit_1: trade.tp1,
         take_profit_2: trade.tp2,
         take_profit_3: trade.tp3,
         position_size: trade.initialPos,
         leverage: 1,
         risk_percent: trade.grade === "GRADE_A" ? 1.0 : trade.grade === "GRADE_B" ? 0.7 : 0.5,
         pnl: Number(exitContext.finalPnl.toFixed(2)),
         pnl_percent: Number(pnlPercent.toFixed(2)),
         pnl_r: Number((trade.profitR || 0).toFixed(2)),
         fees: Number((exitContext.fees || 0).toFixed(2)),
         holding_time_seconds: holdingSeconds,
         result,
         exit_reason: exitContext.exitReason,
         confidence_score: trade.score,
         maximum_favorable_excursion_r: Number(mfe.toFixed(2)),
         maximum_adverse_excursion_r: Number(mae.toFixed(2)),
         highest_price_after_entry: highestPrice,
         lowest_price_after_entry: lowestPrice,
         time_to_MFE: timeToMfe,
         time_to_MAE: timeToMae,
         
         // Context at Entry
         entry_context: {
            flow_state: trade.reasoning?.flow?.state || "UNKNOWN",
            primary_scenario: trade.reasoning?.scenario?.primary?.type || null,
            alternative_scenario: trade.reasoning?.scenario?.alternative?.type || null,
            indicators_at_entry: trade.priceData || null,
            orderflow_at_entry: trade.whaleData || null,
            location_at_entry: trade.reasoning?.location || null
         },
         
         // Candlestick Snapshots (Before entry & During trade)
         candles_before_entry: trade.candlesBeforeEntry || [],
         candles_during_trade: formatCandles(exitContext.currentKlines || [], 30)
      };

      memoryDecisions.unshift(event);
      if (memoryDecisions.length > 200) memoryDecisions.pop();

      appendJsonlSafe(TRADING_DECISIONS_FILE, event);
      updateSummaries(event);
   } catch (err: any) {
      console.error("Error in logTradeDecision:", err?.message);
   }
}

// ----------------------------------------------------------------------------
// 6. LOG TRADE JOURNEY (In-flight snapshot with time tracking)
// ----------------------------------------------------------------------------
export function logTradeJourneySnapshot(trade: any, currentPrice: number, pnl: number) {
   try {
      const now = Date.now();
      const entry = trade.entry || currentPrice;
      if (trade.highestPrice === undefined) {
         trade.highestPrice = entry;
         trade.timeOfHighestPrice = now;
      }
      if (trade.lowestPrice === undefined) {
         trade.lowestPrice = entry;
         trade.timeOfLowestPrice = now;
      }

      if (currentPrice > trade.highestPrice) {
         trade.highestPrice = currentPrice;
         trade.timeOfHighestPrice = now;
      }
      if (currentPrice < trade.lowestPrice) {
         trade.lowestPrice = currentPrice;
         trade.timeOfLowestPrice = now;
      }

      const journeyItem = {
         timestamp: new Date().toISOString(),
         trade_id: `${trade.symbol}_${new Date(trade.entryTime).getTime()}`,
         symbol: trade.symbol,
         direction: trade.direction,
         current_price: currentPrice,
         unrealized_pnl: Number(pnl.toFixed(2)),
         profit_r: Number((trade.profitR || 0).toFixed(2)),
         distance_to_sl: Math.abs(currentPrice - trade.sl),
         distance_to_tp1: Math.abs(currentPrice - trade.tp1),
         be_done: trade.be_done || false
      };

      memoryJourneys.unshift(journeyItem);
      if (memoryJourneys.length > 300) memoryJourneys.pop();

      appendJsonlSafe(TRADE_JOURNEYS_FILE, journeyItem);
   } catch (err: any) {
      console.error("Error in logTradeJourneySnapshot:", err?.message);
   }
}

// ----------------------------------------------------------------------------
// 7. SUMMARY GENERATOR (Raw statistics without any trading recommendations)
// Aggregates Session x Market Regime x Direction x Setup Type
// ----------------------------------------------------------------------------
function updateSummaries(lastTrade: any) {
   try {
      const allTrades = memoryDecisions;
      const allRejected = memoryRejected;

      const wins = allTrades.filter(t => t.result === "WIN");
      const losses = allTrades.filter(t => t.result === "LOSS");
      const breakevens = allTrades.filter(t => t.result === "BREAKEVEN");

      const totalPnl = allTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
      const totalWinPnl = wins.reduce((acc, t) => acc + t.pnl, 0);
      const totalLossPnl = Math.abs(losses.reduce((acc, t) => acc + t.pnl, 0));

      const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : totalWinPnl > 0 ? 99.9 : 1.0;
      const winRate = allTrades.length > 0 ? (wins.length / allTrades.length) * 100 : 0;
      const avgWin = wins.length > 0 ? totalWinPnl / wins.length : 0;
      const avgLoss = losses.length > 0 ? totalLossPnl / losses.length : 0;
      const avgHoldingTime = allTrades.length > 0 
         ? allTrades.reduce((acc, t) => acc + t.holding_time_seconds, 0) / allTrades.length 
         : 0;

      // Groupings for executed trades
      const bySymbol: Record<string, any> = {};
      const byDirection: Record<string, any> = { LONG: { trades: 0, pnl: 0, wins: 0 }, SHORT: { trades: 0, pnl: 0, wins: 0 } };
      const byRegime: Record<string, any> = {};
      const byExitReason: Record<string, any> = {};
      const bySession: Record<string, any> = {};
      const byHourBucket: Record<string, any> = {};
      const byVolatilityState: Record<string, any> = {};

      for (const t of allTrades) {
         if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { trades: 0, pnl: 0, wins: 0 };
         bySymbol[t.symbol].trades++;
         bySymbol[t.symbol].pnl += t.pnl;
         if (t.result === "WIN") bySymbol[t.symbol].wins++;

         if (byDirection[t.side]) {
            byDirection[t.side].trades++;
            byDirection[t.side].pnl += t.pnl;
            if (t.result === "WIN") byDirection[t.side].wins++;
         }

         const reg = t.market_context?.strategy_regime || t.market_regime || "UNKNOWN";
         if (!byRegime[reg]) byRegime[reg] = { trades: 0, pnl: 0, wins: 0 };
         byRegime[reg].trades++;
         byRegime[reg].pnl += t.pnl;
         if (t.result === "WIN") byRegime[reg].wins++;

         const sess = t.entry_timing?.session || "UNKNOWN";
         if (!bySession[sess]) bySession[sess] = { trades: 0, pnl: 0, wins: 0 };
         bySession[sess].trades++;
         bySession[sess].pnl += t.pnl;
         if (t.result === "WIN") bySession[sess].wins++;

         const hBucket = t.entry_timing?.hour_bucket || "UNKNOWN";
         if (!byHourBucket[hBucket]) byHourBucket[hBucket] = { trades: 0, pnl: 0, wins: 0 };
         byHourBucket[hBucket].trades++;
         byHourBucket[hBucket].pnl += t.pnl;
         if (t.result === "WIN") byHourBucket[hBucket].wins++;

         const volState = t.market_context?.volatility_state || "UNKNOWN";
         if (!byVolatilityState[volState]) byVolatilityState[volState] = { trades: 0, pnl: 0, wins: 0 };
         byVolatilityState[volState].trades++;
         byVolatilityState[volState].pnl += t.pnl;
         if (t.result === "WIN") byVolatilityState[volState].wins++;

         const rsn = t.exit_reason || "UNKNOWN";
         if (!byExitReason[rsn]) byExitReason[rsn] = { count: 0, pnl: 0 };
         byExitReason[rsn].count++;
         byExitReason[rsn].pnl += t.pnl;
      }

      // ═══ REJECTED SIGNALS RESEARCH BREAKDOWNS ═══
      const rejectedWithOutcome = allRejected.filter(r => r.future_outcomes?.snapshot_15m !== null || r.future_outcomes?.snapshot_120m !== null);
      const favorableRejections = allRejected.filter(r => r.post_rejection_outcome === "FAVORABLE");
      const adverseRejections = allRejected.filter(r => r.post_rejection_outcome === "ADVERSE");
      const unknownRejections = allRejected.filter(r => r.post_rejection_outcome === "UNKNOWN" || r.post_rejection_outcome === "MIXED");

      const rejectedByDirection: Record<string, any> = {
         LONG: { total: 0, favorable: 0, adverse: 0, unknown: 0 },
         SHORT: { total: 0, favorable: 0, adverse: 0, unknown: 0 }
      };
      const rejectedBySymbol: Record<string, any> = {};
      const rejectedByReason: Record<string, any> = {};
      const rejectedByRegime: Record<string, any> = {};
      const rejectedBySession: Record<string, any> = {};
      const rejectedBySignalType: Record<string, any> = {};

      for (const r of allRejected) {
         const side = r.direction === "LONG" || r.direction === "SHORT" ? r.direction : "WAIT";
         if (rejectedByDirection[side]) {
            rejectedByDirection[side].total++;
            if (r.post_rejection_outcome === "FAVORABLE") rejectedByDirection[side].favorable++;
            else if (r.post_rejection_outcome === "ADVERSE") rejectedByDirection[side].adverse++;
            else rejectedByDirection[side].unknown++;
         }

         if (!rejectedBySymbol[r.symbol]) rejectedBySymbol[r.symbol] = { total: 0, favorable: 0, adverse: 0 };
         rejectedBySymbol[r.symbol].total++;
         if (r.post_rejection_outcome === "FAVORABLE") rejectedBySymbol[r.symbol].favorable++;
         if (r.post_rejection_outcome === "ADVERSE") rejectedBySymbol[r.symbol].adverse++;

         const reasonKey = r.rejection_reason || "Unspecified";
         if (!rejectedByReason[reasonKey]) rejectedByReason[reasonKey] = 0;
         rejectedByReason[reasonKey]++;

         const regimeKey = r.market_context?.strategy_regime || r.market_regime || "UNKNOWN";
         if (!rejectedByRegime[regimeKey]) rejectedByRegime[regimeKey] = 0;
         rejectedByRegime[regimeKey]++;

         const sessKey = r.entry_timing?.session || "UNKNOWN";
         if (!rejectedBySession[sessKey]) rejectedBySession[sessKey] = 0;
         rejectedBySession[sessKey]++;

         const typeKey = r.setup_type || "BREAKOUT_MOMENTUM";
         if (!rejectedBySignalType[typeKey]) rejectedBySignalType[typeKey] = 0;
         rejectedBySignalType[typeKey]++;
      }

      const summary = {
         schema_version: SCHEMA_VERSION,
         bot_version: BOT_VERSION,
         updated_at: new Date().toISOString(),
         executed_trades_summary: {
            total_trades: allTrades.length,
            wins: wins.length,
            losses: losses.length,
            breakeven: breakevens.length,
            win_rate_percent: Number(winRate.toFixed(2)),
            total_pnl: Number(totalPnl.toFixed(2)),
            average_win: Number(avgWin.toFixed(2)),
            average_loss: Number(avgLoss.toFixed(2)),
            profit_factor: Number(profitFactor.toFixed(2)),
            average_holding_time_seconds: Math.floor(avgHoldingTime),
            by_direction: byDirection,
            by_market_regime: byRegime,
            by_session: bySession,
            by_hour_bucket: byHourBucket,
            by_volatility_state: byVolatilityState,
            by_exit_reason: byExitReason,
            by_symbol: bySymbol
         },
         rejected_signals_summary: {
            total_rejected: allRejected.length,
            rejected_with_outcome: rejectedWithOutcome.length,
            favorable_rejections: favorableRejections.length,
            adverse_rejections: adverseRejections.length,
            unknown_rejections: unknownRejections.length,
            by_direction: rejectedByDirection,
            by_symbol: rejectedBySymbol,
            by_rejection_reason: rejectedByReason,
            by_market_regime: rejectedByRegime,
            by_session: rejectedBySession,
            by_signal_type: rejectedBySignalType
         }
      };

      cachedSummary = summary;
      try {
         fs.writeFileSync(PERFORMANCE_SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
      } catch (err: any) {
         console.error("Error writing performance_summary.json:", err.message);
      }

      if (lastTrade) {
         const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tripoli' }).format(new Date());
         const dailyEntry = {
            date: todayDate,
            timestamp: new Date().toISOString(),
            trades_count: allTrades.length,
            wins_count: wins.length,
            losses_count: losses.length,
            daily_pnl: Number(totalPnl.toFixed(2)),
            win_rate: Number(winRate.toFixed(2)),
            last_trade_symbol: lastTrade.symbol,
            last_trade_result: lastTrade.result
         };
         appendJsonlSafe(DAILY_SUMMARY_FILE, dailyEntry);
      }
   } catch (err: any) {
      console.error("Error in updateSummaries:", err?.message);
   }
}

// ----------------------------------------------------------------------------
// 8. PUBLIC ACCESS API EXPORTS
// ----------------------------------------------------------------------------
export function getTradingDecisionsData(limit: number = 100) {
   return memoryDecisions.slice(0, limit);
}

export function getRejectedSignalsData(limit: number = 100) {
   return memoryRejected.slice(0, limit);
}

export function getTradeJourneysData(limit: number = 100) {
   return memoryJourneys.slice(0, limit);
}

export function getPerformanceSummaryData() {
   if (cachedSummary) return cachedSummary;
   try {
      if (fs.existsSync(PERFORMANCE_SUMMARY_FILE)) {
         return JSON.parse(fs.readFileSync(PERFORMANCE_SUMMARY_FILE, "utf8"));
      }
   } catch (e) {}
   return {
      schema_version: SCHEMA_VERSION,
      bot_version: BOT_VERSION,
      executed_trades_summary: { total_trades: 0 },
      rejected_signals_summary: { total_rejected: 0 }
   };
}

export function getFullExportBundle() {
   return {
      schema_version: SCHEMA_VERSION,
      exported_at: new Date().toISOString(),
      bot_version: BOT_VERSION,
      performance_summary: getPerformanceSummaryData(),
      trading_decisions: memoryDecisions,
      rejected_signals: memoryRejected,
      trade_journeys: memoryJourneys
   };
}
