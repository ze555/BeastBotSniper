export type MarketSide = "LONG" | "SHORT";
type Candle = { open: number; high: number; low: number; close: number; openTime?: number };
export interface AlignmentInput {
  side: MarketSide;
  symbol: string;
  btcCandles4h?: Candle[];
  btcCandles15m?: Candle[];
  btcRegime?: string;
  candles4h: Candle[];
  candles15m: Candle[];
  candles5m: Candle[];
  candles1m: Candle[];
  price: number;
  atr1m: number;
  flowImbalance30s: number;
  flowImbalance1m: number;
  now: number;
}
export interface AlignmentDecision {
  allowed: boolean;
  state: "WITH_TREND" | "COUNTERTREND_WAIT_BREAK" | "COUNTERTREND_WAIT_RETEST" | "COUNTERTREND_CONFIRMED" | "INSUFFICIENT_STRUCTURE";
  trend4h: "UP" | "DOWN" | "RANGE";
  trend15m: "UP" | "DOWN" | "RANGE";
  trend5m: "UP" | "DOWN" | "RANGE";
  btcTrend4h: "UP" | "DOWN" | "RANGE";
  btcTrend15m: "UP" | "DOWN" | "RANGE";
  breakLevel: number | null;
  reasons: string[];
}
const pending = new Map<string, { side: MarketSide; level: number; startedAt: number; breakCandleOpenTime: number }>();
function trend(candles: Candle[]): "UP" | "DOWN" | "RANGE" {
  const rows = candles.slice(-6);
  if (rows.length < 5) return "RANGE";
  const up = rows.slice(1).filter((c, i) => c.high > rows[i].high && c.low > rows[i].low).length;
  const down = rows.slice(1).filter((c, i) => c.high < rows[i].high && c.low < rows[i].low).length;
  const net = (rows[rows.length - 1].close - rows[0].open) / Math.max(rows[0].open, 1e-12);
  if (up >= 3 && net > 0.001) return "UP";
  if (down >= 3 && net < -0.001) return "DOWN";
  return "RANGE";
}
export function evaluateMarketAlignment(input: AlignmentInput): AlignmentDecision {
  const trend4h = trend(input.candles4h);
  const trend15m = trend(input.candles15m);
  const trend5m = trend(input.candles5m);
  const btcTrend4h = input.btcCandles4h ? trend(input.btcCandles4h) : "RANGE";
  const btcTrend15m = input.btcCandles15m ? trend(input.btcCandles15m) : "RANGE";
  const btcRegimeTrend = input.btcRegime?.startsWith("BEAR") ? "DOWN" : input.btcRegime?.startsWith("BULL") ? "UP" : "RANGE";
  const effectiveBtc4h = btcTrend4h === "RANGE" ? btcRegimeTrend : btcTrend4h;
  // BEAR_STRONG/BULL_STRONG is derived from the live 15m BTC impulse; let it override a lagging 15m swing label.
  const effectiveBtc15m = btcRegimeTrend !== "RANGE" ? btcRegimeTrend : btcTrend15m;
  const desired = input.side === "LONG" ? "UP" : "DOWN";
  const opposite = input.side === "LONG" ? "DOWN" : "UP";
  const key = `${input.symbol}:${input.side}`;
  const fail = (state: AlignmentDecision["state"], reason: string, level: number | null = null): AlignmentDecision => ({
    allowed: false, state, trend4h, trend15m, trend5m, btcTrend4h, btcTrend15m, breakLevel: level, reasons: [reason]
  });
  if (!input.symbol || input.candles1m.length < 8 || input.candles5m.length < 5 || input.candles15m.length < 5 || input.candles4h.length < 5 ||
      !Number.isFinite(input.price) || !Number.isFinite(input.atr1m) || input.atr1m <= 0) {
    return fail("INSUFFICIENT_STRUCTURE", "Multi-timeframe structure or 1m ATR is unavailable; do not infer trend from missing data.");
  }
  const btcOpposes = effectiveBtc4h === opposite || effectiveBtc15m === opposite;
  if (trend4h === desired && (trend15m === desired || trend15m === "RANGE") && trend5m === desired && !btcOpposes) {
    pending.delete(key);
    return { allowed: true, state: "WITH_TREND", trend4h, trend15m, trend5m, btcTrend4h, btcTrend15m, breakLevel: null,
      reasons: ["Asset 4h/15m/5m structure aligns; BTC structure does not oppose the proposed direction."] };
  }
  const strongCounter = (trend4h === opposite && trend15m === opposite) || (effectiveBtc4h === opposite && effectiveBtc15m === opposite);
  const weakCounter = trend4h === opposite || trend15m === opposite || btcOpposes;
  if (!weakCounter) {
    if (trend5m === desired) {
      return { allowed: true, state: "WITH_TREND", trend4h, trend15m, trend5m, btcTrend4h, btcTrend15m, breakLevel: null,
        reasons: ["Asset higher-timeframe structure is neutral and 5m supports the proposed direction; BTC is not opposing."] };
    }
    return fail("INSUFFICIENT_STRUCTURE", "Higher-timeframe direction is not opposed, but 5m structure does not yet confirm continuation.");
  }
  if (trend5m !== desired) {
    pending.delete(key);
    return fail("COUNTERTREND_WAIT_BREAK", "Countertrend setup: 5m structure has not turned in the proposed direction yet.");
  }
  const rows = input.candles1m.slice(-8, -1);
  const level = input.side === "LONG" ? Math.max(...rows.map(c => c.high)) : Math.min(...rows.map(c => c.low));
  const last = input.candles1m[input.candles1m.length - 1];
  const candidate = pending.get(key);
  const flowAligned = input.side === "LONG"
    ? input.flowImbalance30s >= 0.08 && input.flowImbalance1m >= 0.10
    : input.flowImbalance30s <= -0.08 && input.flowImbalance1m <= -0.10;
  if (!candidate || candidate.side !== input.side || input.now - candidate.startedAt > 10 * 60_000) {
    const broke = input.side === "LONG" ? last.close > level : last.close < level;
    if (broke && flowAligned && Number.isFinite(last.openTime)) {
      pending.set(key, { side: input.side, level, startedAt: input.now, breakCandleOpenTime: last.openTime! });
      return fail("COUNTERTREND_WAIT_RETEST", "Initial structure break detected. Wait for a successful retest; no immediate countertrend entry.", level);
    }
    return fail("COUNTERTREND_WAIT_BREAK", strongCounter
      ? "4h and 15m oppose this trade. Require 5m turn, 1m structure break and aligned executed flow."
      : "One higher timeframe opposes this trade. Require a confirmed 1m break and retest with aligned flow.", level);
  }
  const isLaterOneMinuteCandle = Number.isFinite(last.openTime) && last.openTime! > candidate.breakCandleOpenTime;
  const retested = isLaterOneMinuteCandle && (input.side === "LONG"
    ? last.low <= candidate.level + input.atr1m * 0.15 && last.close >= candidate.level + input.atr1m * 0.03
    : last.high >= candidate.level - input.atr1m * 0.15 && last.close <= candidate.level - input.atr1m * 0.03);
  if (retested && flowAligned) {
    pending.delete(key);
    return { allowed: true, state: "COUNTERTREND_CONFIRMED", trend4h, trend15m, trend5m, btcTrend4h, btcTrend15m, breakLevel: candidate.level,
      reasons: ["Countertrend break held its retest and 30s/1m executed flow reconfirmed the new direction."] };
  }
  return fail("COUNTERTREND_WAIT_RETEST", "Break recorded; price has not yet completed a valid retest with renewed directional flow.", candidate.level);
}
export function resetMarketAlignmentState() { pending.clear(); }
