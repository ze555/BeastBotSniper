export type EntrySide = "LONG" | "SHORT";
export interface EntryFlowSnapshot {
  buyQuote: number; sellQuote: number; tradeCount: number; observedAt: number;
  source: "BINANCE_AGG_TRADES";
  buyQuote5s?: number; sellQuote5s?: number; trades5s?: number;
  buyQuote30s?: number; sellQuote30s?: number; trades30s?: number;
}
export interface EntryQualityInput {
  side: EntrySide; price: number; atr: number; now: number;
  candles: Array<{ open: number; high: number; low: number; close: number }>;
  flow: EntryFlowSnapshot | null; oiChange: number | null; oiPriceChange: number | null;
  cvd5mSlope: number | null; cvd15mSlope: number | null; cvd4hSlope: number | null;
}
export interface EntryQualityDecision {
  allowed: boolean;
  quality: "EARLY_FLOW_REVERSAL" | "FLOW_ALIGNED" | "LATE_ENTRY" | "CONFLICTED_FLOW" | "INSUFFICIENT_DATA";
  timingGate: { state: string; isLateEntry: boolean; directionalMoveAtr: number | null };
  flow: { persistenceState: string; persistenceScore: number | null; impulse5s: number | null; impulse30s: number | null };
  positioning: "NEW_POSITIONS_WITH_MOVE" | "SQUEEZE_OR_LIQUIDATION" | "OI_UNAVAILABLE" | "OI_NOT_DIRECTIONAL";
  cvdState: "ALIGNED" | "MIXED" | "OPPOSING" | "UNAVAILABLE";
  reasons: string[];
}
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const impulse = (buy: number, sell: number): number => (buy - sell) / Math.max(buy + sell, 1e-9);
/** Entry-only quality gate. OI and depth are contextual, not mandatory. */
export function evaluateEntryQuality(input: EntryQualityInput): EntryQualityDecision {
  const insufficient = (reason: string): EntryQualityDecision => ({
    allowed: false, quality: "INSUFFICIENT_DATA",
    timingGate: { state: "DATA_INSUFFICIENT", isLateEntry: false, directionalMoveAtr: null },
    flow: { persistenceState: "NOT_RECORDED", persistenceScore: null, impulse5s: null, impulse30s: null },
    positioning: "OI_UNAVAILABLE", cvdState: "UNAVAILABLE", reasons: [reason]
  });
  const f = input.flow;
  if (!f || f.source !== "BINANCE_AGG_TRADES" || !finite(f.observedAt) ||
      input.now - f.observedAt > 30_000 || f.observedAt > input.now + 2_000 ||
      !finite(f.buyQuote) || !finite(f.sellQuote) || f.buyQuote < 0 || f.sellQuote < 0 ||
      !Number.isInteger(f.tradeCount) || f.tradeCount < 5) {
    return insufficient("Fresh executed Binance Futures aggressor flow is unavailable.");
  }
  if (!finite(input.price) || input.price <= 0 || !finite(input.atr) || input.atr <= 0 ||
      !Array.isArray(input.candles) || input.candles.length < 3 ||
      input.candles.slice(-3).some(c => !finite(c.open) || !finite(c.close))) {
    return insufficient("Price, ATR, or three recent candles are unavailable.");
  }
  const buy30 = finite(f.buyQuote30s) ? f.buyQuote30s : f.buyQuote;
  const sell30 = finite(f.sellQuote30s) ? f.sellQuote30s : f.sellQuote;
  if (!(buy30 + sell30 > 0)) return insufficient("Futures 30-second quote flow is empty.");
  const impulse30s = impulse(buy30, sell30);
  const has5s = finite(f.buyQuote5s) && finite(f.sellQuote5s) &&
    finite(f.trades5s) && f.trades5s >= 3 && f.buyQuote5s + f.sellQuote5s > 0;
  const impulse5s = has5s ? impulse(f.buyQuote5s!, f.sellQuote5s!) : null;
  const sign = input.side === "LONG" ? 1 : -1;
  const directed30 = impulse30s * sign;
  const directed5 = impulse5s === null ? null : impulse5s * sign;
  const first = input.candles[input.candles.length - 3];
  const directionalMoveAtr = ((input.price - first.open) / input.atr) * sign;
  const oiPriceAligned = finite(input.oiPriceChange) && input.oiPriceChange * sign > 0;
  const positioning = !finite(input.oiChange) ? "OI_UNAVAILABLE"
    : input.oiChange > 0.001 && oiPriceAligned ? "NEW_POSITIONS_WITH_MOVE"
    : input.oiChange < -0.002 && oiPriceAligned ? "SQUEEZE_OR_LIQUIDATION" : "OI_NOT_DIRECTIONAL";
  const cvdSlopes = [input.cvd5mSlope, input.cvd15mSlope, input.cvd4hSlope].filter(finite);
  const cvdAligned = cvdSlopes.filter(value => value * sign > 0).length;
  const cvdOpposing = cvdSlopes.filter(value => value * sign < 0).length;
  const cvdState = cvdSlopes.length === 0 ? "UNAVAILABLE"
    : cvdAligned >= 2 ? "ALIGNED" : cvdOpposing >= 2 ? "OPPOSING" : "MIXED";
  if (directed30 <= -0.20 && directed5 !== null && directed5 <= -0.20) {
    return {
      allowed: false, quality: "CONFLICTED_FLOW",
      timingGate: { state: "OPPOSING_EXECUTED_FLOW", isLateEntry: false, directionalMoveAtr: null },
      flow: { persistenceState: "CONFLICTED", persistenceScore: 0, impulse5s, impulse30s },
      positioning, cvdState, reasons: ["Both 30-second and 5-second executed Futures aggression oppose the proposed direction."]
    };
  }
  const fading = directed5 !== null && directed5 < Math.max(0.05, directed30 * 0.45);
  if (directionalMoveAtr >= 1.75 && fading && directed30 > 0.15) {
    return {
      allowed: false, quality: "LATE_ENTRY",
      timingGate: { state: "LATE_EXPANSION", isLateEntry: true, directionalMoveAtr },
      flow: { persistenceState: "FADING", persistenceScore: Math.max(0, Math.min(100, Math.round((directed5 ?? 0) * 100))), impulse5s, impulse30s },
      positioning, cvdState, reasons: ["The move has extended at least 1.75 ATR over three candles and the 5-second impulse is fading."]
    };
  }
  const earlyReversal = directed30 < -0.10 && directed5 !== null && directed5 >= 0.25;
  const aligned = directed30 > 0.10 && (directed5 === null || directed5 > 0.05);
  const persistenceState = earlyReversal ? "EARLY_REVERSAL" : aligned ? "ALIGNED" : "MODERATE";
  const persistenceScore = Math.round(Math.max(0, Math.min(100, ((directed5 ?? directed30) + 1) * 50)));
  return {
    allowed: true, quality: earlyReversal ? "EARLY_FLOW_REVERSAL" : "FLOW_ALIGNED",
    timingGate: { state: earlyReversal ? "EARLY_FLOW_REVERSAL" : "IN_TIME", isLateEntry: false, directionalMoveAtr },
    flow: { persistenceState, persistenceScore, impulse5s, impulse30s }, positioning, cvdState,
    reasons: [
      earlyReversal ? "The 5-second Futures impulse has turned in the proposed direction while the 30-second window still reflects the prior move."
        : aligned ? "The 5-second and 30-second Futures aggressor impulses support the proposed direction."
        : "The latest Futures flow is not strongly aligned, but it does not show a confirmed opposing impulse.",
      cvdState === "ALIGNED" ? "5m/15m/4h Futures taker-CVD slopes mostly support the proposed direction." : cvdState === "OPPOSING" ? "Multi-timeframe Futures taker-CVD still opposes the proposed direction; short-window flow is being monitored for a genuine turn." : cvdState === "MIXED" ? "Multi-timeframe Futures taker-CVD is mixed." : "Multi-timeframe Futures taker-CVD is unavailable.",
      positioning === "NEW_POSITIONS_WITH_MOVE" ? "Open interest is expanding with the proposed direction."
        : positioning === "SQUEEZE_OR_LIQUIDATION" ? "Open interest is contracting; this may be a squeeze/liquidation impulse, not new-position confirmation."
        : positioning === "OI_UNAVAILABLE" ? "Open-interest data is unavailable and was not fabricated or required."
        : "Open interest is neutral or does not independently confirm the proposed direction."
    ]
  };
}
