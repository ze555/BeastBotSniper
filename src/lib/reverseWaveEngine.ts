export type ReverseSide = "LONG" | "SHORT";
export interface ReverseFlow {
  buyQuote: number; sellQuote: number; observedAt: number;
  buyQuote30s?: number; sellQuote30s?: number; buyQuote1m?: number; sellQuote1m?: number;
  priceChange30sPct?: number | null; priceChange1mPct?: number | null;
}
export interface ReverseBook { bidDepthChangePct?: number | null; askDepthChangePct?: number | null; }
export interface ReverseLiquidation { longLiquidationQuote: number; shortLiquidationQuote: number; eventCount: number; observedAt: number; }
export interface ReverseWaveInput {
  fromSide: ReverseSide; candidateSide: ReverseSide | "NONE"; entryAllowed: boolean; structureConfirmed: boolean;
  flow: ReverseFlow | null; now: number; price: number; atr: number;
  cvd5mSlope: number | null; cvd15mSlope: number | null; cvd4hSlope: number | null;
  oiChange: number | null; oiPriceChange: number | null; book: ReverseBook | null; liquidation: ReverseLiquidation | null;
}
export interface ReverseWaveDecision {
  confirmed: boolean; direction: ReverseSide | "NONE";
  confirmations: { executedFlow: boolean; priceResponse: boolean; priceImpact: boolean; structure: boolean; cvd: boolean; oiAndBook: boolean; liquidation: boolean };
  reasons: string[];
}
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const fresh = (at: number, now: number) => finite(at) && at <= now + 2_000 && now - at >= -2_000 && now - at <= 30_000;
/** A reverse needs repeated exit confirmation, fresh opposite entry, structure, price/flow and an independent institutional domain. */
export function evaluateReverseWave(input: ReverseWaveInput): ReverseWaveDecision {
  const direction = input.fromSide === "LONG" ? "SHORT" : "LONG";
  const sign = direction === "LONG" ? 1 : -1;
  const flow = input.flow;
  const validFlow = !!flow && fresh(flow.observedAt, input.now) && finite(flow.buyQuote) && finite(flow.sellQuote) && flow.buyQuote >= 0 && flow.sellQuote >= 0;
  const b30 = flow && finite(flow.buyQuote30s) ? flow.buyQuote30s : flow?.buyQuote ?? 0;
  const s30 = flow && finite(flow.sellQuote30s) ? flow.sellQuote30s : flow?.sellQuote ?? 0;
  const b1 = flow && finite(flow.buyQuote1m) ? flow.buyQuote1m : b30;
  const s1 = flow && finite(flow.sellQuote1m) ? flow.sellQuote1m : s30;
  const d30 = b30 + s30 > 0 ? ((b30 - s30) / (b30 + s30)) * sign : 0;
  const d1 = b1 + s1 > 0 ? ((b1 - s1) / (b1 + s1)) * sign : 0;
  const executedFlow = validFlow && d30 >= 0.08 && d1 >= 0.06;
  const p30 = flow && finite(flow.priceChange30sPct) ? flow.priceChange30sPct * sign : null;
  const p1 = flow && finite(flow.priceChange1mPct) ? flow.priceChange1mPct * sign : null;
  const priceResponse = p30 !== null && p30 >= 0.0003 && p1 !== null && p1 >= 0.0006;
  // Normalize price response by ATR: high aggressor imbalance without sufficient movement is absorption, not a confirmed reversal.
  const signedMove1mAtr = p1 !== null && finite(input.price) && finite(input.atr) && input.price > 0 && input.atr > 0
    ? (p1 * input.price) / input.atr : null;
  const impactEfficiency = signedMove1mAtr !== null ? signedMove1mAtr / Math.max(Math.abs(d1), 0.05) : null;
  const priceImpact = signedMove1mAtr !== null && signedMove1mAtr >= 0.08 && impactEfficiency !== null && impactEfficiency >= 0.25;
  const cvd = [input.cvd5mSlope, input.cvd15mSlope, input.cvd4hSlope].filter(finite);
  const cvdConfirmed = cvd.length >= 2 && cvd.filter(value => value * sign > 0).length >= 2;
  const oiAligned = finite(input.oiChange) && input.oiChange > 0.001 && finite(input.oiPriceChange) && input.oiPriceChange * sign >= 0.0005;
  const bookAligned = !!input.book && (direction === "LONG"
    ? (finite(input.book.bidDepthChangePct) && input.book.bidDepthChangePct >= 8) || (finite(input.book.askDepthChangePct) && input.book.askDepthChangePct <= -8)
    : (finite(input.book.askDepthChangePct) && input.book.askDepthChangePct >= 8) || (finite(input.book.bidDepthChangePct) && input.book.bidDepthChangePct <= -8));
  const oiAndBook = oiAligned && bookAligned;
  const liq = input.liquidation;
  const liquidation = !!liq && liq.eventCount > 0 && fresh(liq.observedAt, input.now) &&
    (direction === "LONG"
      ? liq.shortLiquidationQuote >= 5_000 && liq.shortLiquidationQuote > liq.longLiquidationQuote * 1.5
      : liq.longLiquidationQuote >= 5_000 && liq.longLiquidationQuote > liq.shortLiquidationQuote * 1.5);
  const structure = input.entryAllowed && input.structureConfirmed && input.candidateSide === direction;
  const confirmed = structure && executedFlow && priceResponse && priceImpact && (cvdConfirmed || oiAndBook || liquidation);
  return {
    confirmed, direction: confirmed ? direction : "NONE",
    confirmations: { executedFlow, priceResponse, priceImpact, structure, cvd: cvdConfirmed, oiAndBook, liquidation },
    reasons: [
      structure ? "Opposite-side institutional structure and executable entry are confirmed." : "Opposite-side structure/entry is not confirmed.",
      executedFlow ? "30s and 1m executed Futures flow agree with the reverse direction." : "30s/1m executed Futures flow do not yet agree.",
      priceResponse ? "Price responds in the reverse direction in both 30s and 1m." : "Reverse price response is not confirmed in both windows.",
      priceImpact ? "The reverse-side aggressor flow produces at least 0.08 ATR of price response with sufficient impact efficiency." : "Reverse flow impact is too weak relative to ATR; possible absorption/failed auction, so no reverse entry yet.",
      cvdConfirmed ? "At least two available CVD horizons confirm the reverse direction." : "Multi-timeframe CVD has not independently confirmed the reverse direction.",
      oiAndBook ? "OI expansion with aligned price and sampled order-book depth change confirm the reverse direction." : "OI plus order-book depth do not jointly confirm the reverse direction.",
      liquidation ? "Fresh Binance force-order events support the reverse squeeze direction." : "No matching fresh liquidation confirmation is available."
    ]
  };
}
