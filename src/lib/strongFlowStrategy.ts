/**
 * PB_STRONG_FLOW + FIXED_2R (research selection 2026-11-20).
 * Uses only closed, consecutive Binance USD-M 1m candles and executed taker quote volume.
 * Historical exploration is NOT a forward profitability guarantee.
 */
export const STRONG_FLOW_STRATEGY_ID = "PB_STRONG_FLOW_FIXED2_1M_V1";
export const STRONG_FLOW_ENTRY_HOUR_UTC = 16;
export const STRONG_FLOW_EXIT_HOUR_UTC = 24;
export const STRONG_FLOW_MAX_HOLD_MS = 180 * 60_000;
export const STRONG_FLOW_RISK_FRACTION = 0.01;
export const STRONG_FLOW_MAX_CONCURRENT = 10;

/** All schedule times are Africa/Tripoli local clock times. The default
 * 18:00–02:00 Libya matches the researched 16:00–00:00 UTC window.
 * A schedule restricts NEW entries only, never position protection/exits.
 */
export interface StrongFlowTradingSchedule {
  mode: "SCHEDULED" | "ALWAYS";
  startLocal: string;
  endLocal: string;
}
export const STRONG_FLOW_DEFAULT_TRADING_SCHEDULE: StrongFlowTradingSchedule = {
  mode: "SCHEDULED", startLocal: "18:00", endLocal: "02:00"
};
const tripoliClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Tripoli", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
function minuteOfDay(value: string): number | null {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [h,m] = value.split(":").map(Number);
  return h * 60 + m;
}
export function isValidStrongFlowTradingSchedule(value: unknown): value is StrongFlowTradingSchedule {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.mode !== "SCHEDULED" && v.mode !== "ALWAYS") return false;
  const start = minuteOfDay(v.startLocal as string), end = minuteOfDay(v.endLocal as string);
  return start !== null && end !== null && (v.mode === "ALWAYS" || start !== end);
}

export interface StrongFlowBar {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  quoteVolume: number;
  takerBuyQuote: number;
}
export interface StrongFlowSignal {
  side: "LONG" | "SHORT";
  signalOpenTime: number;
  signalCloseTime: number;
  atr14: number;
  rvol: number;
  delta: number;
  flow5: number;
  flow15: number;
  trend15: number;
  trend60: number;
  signalClose: number;
}

export function isStrongFlowTradingHour(
  d: Date = new Date(), schedule: StrongFlowTradingSchedule = STRONG_FLOW_DEFAULT_TRADING_SCHEDULE
): boolean {
  if (!isValidStrongFlowTradingSchedule(schedule)) return false; // fail closed on bad settings
  if (schedule.mode === "ALWAYS") return true;
  const parts = tripoliClock.formatToParts(d);
  const h = Number(parts.find(p => p.type === "hour")?.value);
  const m = Number(parts.find(p => p.type === "minute")?.value);
  const minute = h * 60 + m;
  if (!Number.isFinite(minute)) return false;
  const start = minuteOfDay(schedule.startLocal)!;
  const end = minuteOfDay(schedule.endLocal)!;
  // Supports overnight windows, e.g. 18:00–02:00 (end is exclusive).
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
export function isStrongFlowTrade(t: { strategyRevision?: string }): boolean {
  return t.strategyRevision === STRONG_FLOW_STRATEGY_ID;
}

/** This is the precise live counterpart to research stage2 pb_strong_flow:
 * common + pullback mask + flow5 acceleration > .055 and strong candle close.
 * No indicators from unfinished candles, no synthetic L2/OI, and no BTC-direction filter.
 */
export function evaluateStrongFlowSignal(rows: StrongFlowBar[], now = Date.now()): StrongFlowSignal | null {
  if (!Array.isArray(rows) || rows.length < 64) return null;
  const n = rows.length;
  const last = rows[n - 1];
  if (!Number.isFinite(last?.closeTime) || last.closeTime >= now || now - last.closeTime > 90_000) return null;
  // Required 60-bar history and 20 strictly consecutive 1m bars.
  for (let i = n - 20; i < n; i++) {
    const b = rows[i];
    if (!b || ![b.openTime, b.closeTime, b.open, b.high, b.low, b.close, b.quoteVolume, b.takerBuyQuote].every(Number.isFinite)
      || b.close <= 0 || b.quoteVolume <= 0 || b.takerBuyQuote < 0 || b.takerBuyQuote > b.quoteVolume
      || (i > n - 20 && b.openTime - rows[i - 1].openTime !== 60_000)) return null;
  }
  if (![rows[n - 61].close, rows[n - 16].close, rows[n - 6].close].every(v => Number.isFinite(v) && v > 0)) return null;
  const previous = rows.slice(n - 21, n - 1);
  const averageQuoteVolume = previous.reduce((s, b) => s + b.quoteVolume, 0) / 20;
  if (!(averageQuoteVolume > 0) || last.quoteVolume < 1.3 * averageQuoteVolume) return null;
  let trSum = 0;
  for (let i = n - 14; i < n; i++) {
    const b = rows[i], p = rows[i - 1];
    if (!b || !p || ![b.high, b.low, p.close].every(Number.isFinite)) return null;
    trSum += Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close));
  }
  const atr14 = trSum / 14;
  const width = last.high - last.low;
  if (!(atr14 > 0 && width > 0 && width <= 3 * atr14)) return null;
  function flow(window: number, lag = 0): number {
    let totalQuote = 0, signedQuote = 0;
    for (let i = n - window - lag; i < n - lag; i++) {
      const b = rows[i];
      if (!b || !(b.quoteVolume > 0) || !Number.isFinite(b.takerBuyQuote)) return NaN;
      totalQuote += b.quoteVolume;
      signedQuote += 2 * b.takerBuyQuote - b.quoteVolume;
    }
    return totalQuote > 0 ? signedQuote / totalQuote : NaN;
  }
  const flow5 = flow(5), flow15 = flow(15), previousFlow5 = flow(5, 1), laggedFlow5 = flow(5, 3);
  const delta = 2 * last.takerBuyQuote / last.quoteVolume - 1;
  const trend15 = last.close / rows[n - 16].close - 1;
  const trend60 = last.close / rows[n - 61].close - 1;
  const ret5 = last.close / rows[n - 6].close - 1;
  const closeLocation = (last.close - last.low) / width;
  const previousHigh5 = Math.max(...rows.slice(n - 6, n - 1).map(b => b.high));
  const previousLow5 = Math.min(...rows.slice(n - 6, n - 1).map(b => b.low));
  if (![flow5, flow15, previousFlow5, laggedFlow5, delta, closeLocation, trend15, trend60, ret5, previousHigh5, previousLow5].every(Number.isFinite)) return null;
  const long = trend60 > 0.003 && trend15 > 0 && ret5 < 0.002 &&
    last.close > previousHigh5 && last.close > last.open && closeLocation > 0.82 &&
    delta > 0.30 && flow5 >= 0.08 && flow15 >= 0.03 && flow5 >= previousFlow5 &&
    flow5 - laggedFlow5 > 0.055;
  const short = trend60 < -0.003 && trend15 < 0 && ret5 > -0.002 &&
    last.close < previousLow5 && last.close < last.open && closeLocation < 0.18 &&
    delta < -0.30 && flow5 <= -0.08 && flow15 <= -0.03 && flow5 <= previousFlow5 &&
    flow5 - laggedFlow5 < -0.055;
  if (!long && !short) return null;
  return {side: long ? "LONG" : "SHORT", signalOpenTime: last.openTime,
    signalCloseTime: last.closeTime, atr14, rvol: last.quoteVolume / averageQuoteVolume,
    delta, flow5, flow15, trend15, trend60, signalClose: last.close};
}
