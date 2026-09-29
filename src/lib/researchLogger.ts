// ============================================================================
// BeastBotSniper Data Logging & Research Dataset Engine
// Provides full diagnostic trace for post-trade & rejected signal analysis (ChatGPT Research Ready)
// ============================================================================

import fs from "fs";
import path from "path";

const SCHEMA_VERSION = "2.1.0";
const BOT_VERSION = "BeastBot-Apex-v2.1";
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

// Format candle array consistently into clean lightweight OHLCV
export function formatCandles(klines: any[], limit: number = 50) {
   if (!Array.isArray(klines) || klines.length === 0) return [];
   return klines.slice(-limit).map((k: any) => ({
      timestamp: k.time ? new Date(k.time).toISOString() : new Date().toISOString(),
      open: Number(k.open || 0),
      high: Number(k.high || 0),
      low: Number(k.low || 0),
      close: Number(k.close || 0),
      volume: Number(k.volume || 0),
      quote_volume: k.quoteVolume ? Number(k.quoteVolume) : null,
      number_of_trades: k.trades ? Number(k.trades) : null
   }));
}

// ----------------------------------------------------------------------------
// 1. LOG REJECTED SIGNALS
// Records every detected opportunity that failed confirmation or was filtered out
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
      
      const conditions_met: string[] = [];
      const conditions_failed: string[] = [];

      if (reasoning) {
         if (reasoning.confirmation?.evidence) conditions_met.push(...reasoning.confirmation.evidence);
         if (reasoning.confirmation?.missingItems) conditions_failed.push(...reasoning.confirmation.missingItems);
      }
      if (rejection_reason && !conditions_failed.includes(rejection_reason)) {
         conditions_failed.push(rejection_reason);
      }

      const event = {
         schema_version: SCHEMA_VERSION,
         bot_version: BOT_VERSION,
         event_type: "SIGNAL_REJECTED",
         timestamp: new Date().toISOString(),
         symbol,
         timeframe: timeframe || "15m",
         direction,
         signal_score: Number(signal_score.toFixed(2)),
         rejection_reason,
         market_regime: reasoning?.regime || ctx?.regime || "UNKNOWN",
         flow_state: reasoning?.flow?.state || "UNKNOWN",
         conditions_met,
         conditions_failed,
         indicators: {
            rsi: p?.rsi ?? null,
            macd_hist: p?.hist?.length ? p.hist[p.hist.length - 1] : null,
            adx: p?.adx ?? null,
            atr14: p?.atr14 ?? null,
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
         market_context: {
            btc_regime: ctx?.regime ?? null,
            btc_trend: ctx?.btc_trend ?? null,
            btc_tradeable: ctx?.tradeable ?? true,
            btc_chg: ctx?.btc_chg ?? null
         },
         candles_before_signal: formatCandles(p?.klines || [], 30)
      };

      // Keep recent 200 rejected signals in memory
      memoryRejected.unshift(event);
      if (memoryRejected.length > 200) memoryRejected.pop();

      appendJsonlSafe(REJECTED_SIGNALS_FILE, event);
   } catch (err: any) {
      console.error("Error in logRejectedSignal:", err?.message);
   }
}

// ----------------------------------------------------------------------------
// 2. LOG COMPLETED TRADE DECISION
// Captures full trade lifecycle from entry to exit with pre-trade and during-trade candles
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

      // Calculate Maximum Favorable Excursion (MFE) & Maximum Adverse Excursion (MAE)
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
         market_regime: trade.reasoning?.regime || "TREND",
         entry_price: entryPrice,
         exit_price: exitContext.exitPrice,
         stop_loss: trade.sl,
         take_profit_1: trade.tp1,
         take_profit_2: trade.tp2,
         take_profit_3: trade.tp3,
         position_size: trade.initialPos,
         leverage: 1, // Isolated cash equivalent
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
// 3. LOG TRADE JOURNEY (Lightweight In-flight snapshot)
// Records periodic snapshots while the trade is being managed
// ----------------------------------------------------------------------------
export function logTradeJourneySnapshot(trade: any, currentPrice: number, pnl: number) {
   try {
      const entry = trade.entry || currentPrice;
      if (trade.highestPrice === undefined) trade.highestPrice = entry;
      if (trade.lowestPrice === undefined) trade.lowestPrice = entry;

      if (currentPrice > trade.highestPrice) trade.highestPrice = currentPrice;
      if (currentPrice < trade.lowestPrice) trade.lowestPrice = currentPrice;

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
// 4. SUMMARY GENERATOR (performance_summary.json & daily_summary.jsonl)
// Aggregates statistics grouped by symbol, direction, regime, setupType, and exitReason
// ----------------------------------------------------------------------------
function updateSummaries(lastTrade: any) {
   try {
      const allTrades = memoryDecisions;
      if (allTrades.length === 0) return;

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
      const avgHoldingTime = allTrades.reduce((acc, t) => acc + t.holding_time_seconds, 0) / allTrades.length;

      // Groupings
      const bySymbol: Record<string, any> = {};
      const byDirection: Record<string, any> = { LONG: { trades: 0, pnl: 0, wins: 0 }, SHORT: { trades: 0, pnl: 0, wins: 0 } };
      const byRegime: Record<string, any> = {};
      const byExitReason: Record<string, any> = {};

      for (const t of allTrades) {
         // By Symbol
         if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { trades: 0, pnl: 0, wins: 0 };
         bySymbol[t.symbol].trades++;
         bySymbol[t.symbol].pnl += t.pnl;
         if (t.result === "WIN") bySymbol[t.symbol].wins++;

         // By Direction
         if (byDirection[t.side]) {
            byDirection[t.side].trades++;
            byDirection[t.side].pnl += t.pnl;
            if (t.result === "WIN") byDirection[t.side].wins++;
         }

         // By Regime
         const reg = t.market_regime || "UNKNOWN";
         if (!byRegime[reg]) byRegime[reg] = { trades: 0, pnl: 0, wins: 0 };
         byRegime[reg].trades++;
         byRegime[reg].pnl += t.pnl;
         if (t.result === "WIN") byRegime[reg].wins++;

         // By Exit Reason
         const rsn = t.exit_reason || "UNKNOWN";
         if (!byExitReason[rsn]) byExitReason[rsn] = { count: 0, pnl: 0 };
         byExitReason[rsn].count++;
         byExitReason[rsn].pnl += t.pnl;
      }

      const summary = {
         schema_version: SCHEMA_VERSION,
         bot_version: BOT_VERSION,
         updated_at: new Date().toISOString(),
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
         by_exit_reason: byExitReason,
         by_symbol: bySymbol
      };

      cachedSummary = summary;
      try {
         fs.writeFileSync(PERFORMANCE_SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
      } catch (err: any) {
         console.error("Error writing performance_summary.json:", err.message);
      }

      // Update Daily Summary
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
   } catch (err: any) {
      console.error("Error in updateSummaries:", err?.message);
   }
}

// ----------------------------------------------------------------------------
// 5. PUBLIC ACCESS API EXPORTS (For HTTP Endpoints)
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
   return { total_trades: 0, message: "No trades recorded yet." };
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
