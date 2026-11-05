export type EntrySide = "LONG" | "SHORT";
export interface EntryFlowSnapshot {
  buyQuote: number; sellQuote: number; tradeCount: number; observedAt: number;
  source: "BINANCE_AGG_TRADES";
  buyQuote5s?: number; sellQuote5s?: number; trades5s?: number;
  buyQuote30s?: number; sellQuote30s?: number; trades30s?: number;
  buyQuote1m?: number; sellQuote1m?: number; trades1m?: number;
  buyQuote5m?: number; sellQuote5m?: number; trades5m?: number;
  priceChange30sPct?: number | null; priceChange1mPct?: number | null; priceChange5mPct?: number | null;
  coverage1mMs?: number; coverage5mMs?: number;
}
export interface EntryQualityInput {
  side: EntrySide; price: number; atr: number; now: number;
  candles: Array<{ open: number; high: number; low: number; close: number }>;
  flow: EntryFlowSnapshot | null; oiChange: number | null; oiPriceChange: number | null;
  cvd5mSlope: number | null; cvd15mSlope: number | null; cvd4hSlope: number | null;
}
export interface EntryQualityDecision {
  allowed: boolean;
  quality: "EARLY_FLOW_REVERSAL" | "FLOW_ALIGNED" | "LATE_ENTRY" | "ABSORPTION" | "FAILED_AUCTION" | "CONFLICTED_FLOW" | "INSUFFICIENT_DATA";
  timingGate: { state: string; isLateEntry: boolean; directionalMoveAtr: number | null };
  flow: { persistenceState: string; persistenceScore: number | null; impulse5s: number | null; impulse30s: number | null; priceImpactEfficiency: number | null };
  positioning: "NEW_POSITIONS_WITH_MOVE" | "SQUEEZE_OR_LIQUIDATION" | "OI_UNAVAILABLE" | "OI_NOT_DIRECTIONAL";
  cvdState: "ALIGNED" | "MIXED" | "OPPOSING" | "UNAVAILABLE";
  reasons: string[];
}
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const impulse = (buy: number, sell: number): number => (buy - sell) / Math.max(buy + sell, 1e-9);
/** Entry-only gate: 5m establishes context; 1m/30s price response confirms timing. 5s is never mandatory. */
export function evaluateEntryQuality(input: EntryQualityInput): EntryQualityDecision {
  const insufficient = (reason: string): EntryQualityDecision => ({
    allowed: false, quality: "INSUFFICIENT_DATA",
    timingGate: { state: "DATA_INSUFFICIENT", isLateEntry: false, directionalMoveAtr: null },
    flow: { persistenceState: "NOT_RECORDED", persistenceScore: null, impulse5s: null, impulse30s: null, priceImpactEfficiency: null },
    positioning: "OI_UNAVAILABLE", cvdState: "UNAVAILABLE", reasons: [reason]
  });
  const f = input.flow;
  if (!f || f.source !== "BINANCE_AGG_TRADES" || !finite(f.observedAt) ||
      input.now - f.observedAt > 30_000 || f.observedAt > input.now + 2_000 ||
      !finite(f.buyQuote) || !finite(f.sellQuote) || f.buyQuote < 0 || f.sellQuote < 0 ||
      !Number.isInteger(f.tradeCount) || f.tradeCount < 5) {
    return insufficient("Fresh executed Binance USD-M Futures flow is unavailable.");
  }
  if (!finite(input.price) || input.price <= 0 || !finite(input.atr) || input.atr <= 0 ||
      !Array.isArray(input.candles) || input.candles.length < 3 ||
      input.candles.slice(-3).some(c => !finite(c.open) || !finite(c.close))) {
    return insufficient("Price, ATR, or three recent 1m candles are unavailable.");
  }
  const buy30 = finite(f.buyQuote30s) ? f.buyQuote30s : f.buyQuote;
  const sell30 = finite(f.sellQuote30s) ? f.sellQuote30s : f.sellQuote;
  const buy1m = finite(f.buyQuote1m) ? f.buyQuote1m : buy30;
  const sell1m = finite(f.sellQuote1m) ? f.sellQuote1m : sell30;
  const buy5m = finite(f.buyQuote5m) ? f.buyQuote5m : buy1m;
  const sell5m = finite(f.sellQuote5m) ? f.sellQuote5m : sell1m;
  if (buy30 + sell30 <= 0 || buy1m + sell1m <= 0) return insufficient("Fresh 1m/30s Futures quote flow is empty.");
  const impulse30s = impulse(buy30, sell30);
  const impulse1m = impulse(buy1m, sell1m);
  const impulse5m = impulse(buy5m, sell5m);
  const has1m = finite(f.buyQuote1m) && finite(f.sellQuote1m) && finite(f.trades1m) && f.trades1m >= 5 &&
    (!finite(f.coverage1mMs) || f.coverage1mMs >= 45_000);
  const has5m = finite(f.buyQuote5m) && finite(f.sellQuote5m) && finite(f.trades5m) && f.trades5m >= 10 &&
    (!finite(f.coverage5mMs) || f.coverage5mMs >= 180_000) && buy5m + sell5m > 0;
  if (finite(f.trades1m) && f.trades1m < 5) return insufficient("Not enough executed Futures prints in the 1m confirmation window.");
  const sign = input.side === "LONG" ? 1 : -1;
  const directed30 = impulse30s * sign;
  const directed1m = impulse1m * sign;
  const directed5m = has5m ? impulse5m * sign : 0;
  const first = input.candles[input.candles.length - 3];
  const directionalMoveAtr = ((input.price - first.open) / input.atr) * sign;
  const priceMove1m = (finite(f.priceChange1mPct)
    ? f.priceChange1mPct
    : (input.price - input.candles[input.candles.length - 1].open) / input.price) * sign;
  const priceMove5m = finite(f.priceChange5mPct) ? f.priceChange5mPct * sign : null;
  const oiPriceAligned = finite(input.oiPriceChange) && input.oiPriceChange * sign > 0;
  const positioning = !finite(input.oiChange) ? "OI_UNAVAILABLE"
    : input.oiChange > 0.001 && oiPriceAligned ? "NEW_POSITIONS_WITH_MOVE"
    : input.oiChange < -0.002 && oiPriceAligned ? "SQUEEZE_OR_LIQUIDATION" : "OI_NOT_DIRECTIONAL";
  const cvdSlopes = [input.cvd5mSlope, input.cvd15mSlope, input.cvd4hSlope].filter(finite);
  const cvdAligned = cvdSlopes.filter(value => value * sign > 0).length;
  const cvdOpposing = cvdSlopes.filter(value => value * sign < 0).length;
  const cvdState = cvdSlopes.length === 0 ? "UNAVAILABLE"
    : cvdAligned >= 2 ? "ALIGNED" : cvdOpposing >= 2 ? "OPPOSING" : "MIXED";

  if (directed1m <= -0.18 && directed30 <= -0.15) {
    return {
      allowed: false, quality: "CONFLICTED_FLOW",
      timingGate: { state: "OPPOSING_EXECUTED_FLOW", isLateEntry: false, directionalMoveAtr },
      flow: { persistenceState: "CONFLICTED", persistenceScore: 0, impulse5s: null, impulse30s, priceImpactEfficiency: null },
      positioning, cvdState, reasons: ["Both 1m and 30s executed Futures flow oppose the proposed direction."]
    };
  }
  // Measure price response in ATR units so the same rule works across symbols and volatility regimes.
  const signedMove1mAtr = (priceMove1m * input.price / input.atr);
  const priceImpactEfficiency = signedMove1mAtr !== null
    ? signedMove1mAtr / Math.max(Math.abs(directed1m), 0.05) : null;
  const strongDirectedFlow = directed1m >= 0.18 && directed30 >= 0.12;
  const failedAuction = strongDirectedFlow && signedMove1mAtr !== null && signedMove1mAtr <= -0.08;
  const absorbedFlow = strongDirectedFlow && signedMove1mAtr !== null && signedMove1mAtr >= -0.08 && signedMove1mAtr < 0.10;
  if (failedAuction || absorbedFlow) {
    const state = failedAuction ? "FAILED_AUCTION" : "NO_PRICE_RESPONSE_ABSORPTION";
    return {
      allowed: false, quality: failedAuction ? "FAILED_AUCTION" : "ABSORPTION",
      timingGate: { state, isLateEntry: false, directionalMoveAtr },
      flow: { persistenceState: failedAuction ? "FAILED_AUCTION" : "ABSORBED", persistenceScore: Math.round(directed1m * 100), impulse5s: null, impulse30s, priceImpactEfficiency },
      positioning, cvdState,
      reasons: [failedAuction
        ? "Aggressive Futures flow is strong but price moved materially against it in ATR terms: failed auction/rejection. Keep the symbol under discovery and wait for a fresh release."
        : "Aggressive Futures flow is strong but produced less than 0.10 ATR of same-direction price response. Possible passive absorption; wait for a micro-range break and renewed price release before entry."]
    };
  }
  const fading = directed1m < Math.max(0.05, directed5m * 0.45);
  if (directionalMoveAtr >= 1.75 && fading && directed5m > 0.15) {
    return {
      allowed: false, quality: "LATE_ENTRY",
      timingGate: { state: "LATE_EXPANSION", isLateEntry: true, directionalMoveAtr },
      flow: { persistenceState: "FADING", persistenceScore: Math.max(0, Math.min(100, Math.round(directed1m * 100))), impulse5s: null, impulse30s, priceImpactEfficiency: null },
      positioning, cvdState, reasons: ["The move has extended at least 1.75 ATR across recent 1m candles while 1m participation fades versus its 5m baseline."]
    };
  }
  const fiveMinuteOpposition = has5m && (directed5m <= -0.10 || (priceMove5m !== null && priceMove5m <= -0.005));
  const earlyReversal = fiveMinuteOpposition && directed1m >= 0.15 && directed30 >= 0.10 && priceMove1m >= 0.001;
  const aligned = directed1m >= 0.10 && directed30 >= 0.08 && priceMove1m >= 0.0003 && (!fiveMinuteOpposition || earlyReversal);
  const oneMinuteValid = !finite(f.trades1m) || has1m;
  if (!oneMinuteValid || (!earlyReversal && !aligned)) {
    return {
      allowed: false, quality: "CONFLICTED_FLOW",
      timingGate: { state: "NO_MULTI_WINDOW_PRICE_CONFIRMATION", isLateEntry: false, directionalMoveAtr },
      flow: { persistenceState: "UNCONFIRMED", persistenceScore: null, impulse5s: null, impulse30s, priceImpactEfficiency: null },
      positioning, cvdState, reasons: ["The 1m and 30s Futures tape plus directional price response do not yet confirm this entry. Keep scanning; do not force an entry from a single short burst."]
    };
  }
  const persistenceScore = Math.round(Math.max(0, Math.min(100,
    ((directed1m + directed30 + (has5m ? directed5m : 0)) / (has5m ? 3 : 2) + 1) * 50)));
  return {
    allowed: true, quality: earlyReversal ? "EARLY_FLOW_REVERSAL" : "FLOW_ALIGNED",
    timingGate: { state: earlyReversal ? "EARLY_FLOW_REVERSAL" : "IN_TIME", isLateEntry: false, directionalMoveAtr },
    flow: { persistenceState: earlyReversal ? "EARLY_REVERSAL_5M_TO_1M" : "ALIGNED_1M_30S", persistenceScore, impulse5s: null, impulse30s, priceImpactEfficiency },
    positioning, cvdState,
    reasons: [
      earlyReversal
        ? "5m Futures flow records the prior opposing pressure; 1m and 30s executed flow have turned and price confirms the reversal."
        : "5m context, 1m participation, 30s aggressor flow and directional price response support the proposed entry.",
      cvdState === "ALIGNED" ? "5m/15m/4h Futures taker-CVD slopes mostly support the proposed direction."
        : cvdState === "OPPOSING" ? "Multi-timeframe CVD opposes the entry; it remains contextual and does not alone veto a price-confirmed early reversal."
        : cvdState === "MIXED" ? "Multi-timeframe Futures taker-CVD is mixed." : "Multi-timeframe Futures taker-CVD is unavailable.",
      positioning === "NEW_POSITIONS_WITH_MOVE" ? "Open interest is expanding with the proposed price direction."
        : positioning === "SQUEEZE_OR_LIQUIDATION" ? "Open interest is contracting with price; liquidation direction still requires actual force-order evidence."
        : positioning === "OI_UNAVAILABLE" ? "Open-interest data is unavailable and is not fabricated or required."
        : "Open interest does not independently confirm the proposed direction."
    ]
  };
}
