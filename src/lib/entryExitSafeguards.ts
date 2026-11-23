/**
 * Conservative PAPER-only entry/exit safeguards.
 * Values are prospective hypotheses, NOT a proven trading edge.
 * Closed-bar entry gate: do not chase a second completed 1m candle already
 * >0.55 ATR beyond the original signal. This uses only data known at entry.
 * Cost-aware protection activates only AFTER an observed 1R favorable move.
 */
export type Direction="LONG"|"SHORT";
export type Setup="VOLATILITY_BREAKOUT"|"TREND_CONTINUATION"|"TREND_PULLBACK"|"RANGE_REVERSION";
export const MAX_FOLLOW_THROUGH_EXTENSION_ATR=0.55;
export function followThroughExtension(
  side:Direction,signalClose:number,followClose:number,atr14:number,setup:Setup
):{allowed:boolean;reason:string;extensionAtr:number|null}{
  if(![signalClose,followClose,atr14].every(Number.isFinite) ||
     signalClose<=0||followClose<=0||atr14<=0)
    return {allowed:false,reason:"FOLLOW_THROUGH_EXTENSION_INVALID",extensionAtr:null};
  const sign=side==="LONG"?1:-1;
  const extensionAtr=sign*(followClose-signalClose)/atr14;
  // RANGE entries keep their existing mean-reversion logic unchanged.
  if(setup!=="RANGE_REVERSION" && extensionAtr>MAX_FOLLOW_THROUGH_EXTENSION_ATR+1e-10)
    return {allowed:false,reason:"FOLLOW_THROUGH_OVEREXTENDED",extensionAtr};
  return {allowed:true,reason:"FOLLOW_THROUGH_EXTENSION_ACCEPTED",extensionAtr};
}
/** Return a monotonic stop PRICE that locks at least estimated fees/slippage.
 * A real gap, delayed quote or unexpected spread can still make exit net negative.
 * Does not affect early positions (<1R) or the existing RANGE strategy.
 */
export function costAwareProfitLock(
  side:Direction,entry:number,initialDist:number,peakR:number,feeRate:number,slippageRate:number,
  setup:Setup
):number|null{
  if(setup==="RANGE_REVERSION" || ![entry,initialDist,peakR,feeRate,slippageRate].every(Number.isFinite)
    || entry<=0||initialDist<=0||feeRate<0||slippageRate<0||feeRate>=.01||slippageRate>=.01
    ||peakR<1)return null;
  const roundTripCostR=2*(feeRate+slippageRate)*entry/initialDist;
  // At 1R MFE, prefer cash preservation to holding until original stop.
  // No change to adaptiveStopCandidate tiers at 1.75R and higher.
  const floorR=Math.max(.30,roundTripCostR+.05);
  return entry+(side==="LONG"?1:-1)*floorR*initialDist;
}
