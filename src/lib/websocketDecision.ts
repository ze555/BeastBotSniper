/**
 * Optional live Binance WebSocket gate.
 * Applies to breakout ENTRIES only; all other existing entries stay unchanged.
 * Exits continue to require independently corroborated price + taker + book/5m flow.
 */
import type {AdaptiveSetup} from "./adaptiveRegimeStrategy.js";
import type {LiveAggWindow} from "./institutionalReversal.js";
export type LiveDecision={allowed:boolean;reason:string;delta:number|null};
export function liveBreakoutEntryDecision(
  enabled:boolean,setup:AdaptiveSetup,side:"LONG"|"SHORT",agg:LiveAggWindow,
  now=Date.now()
):LiveDecision{
  if(!enabled || setup!=="VOLATILITY_BREAKOUT")
    return {allowed:true,reason:enabled?"WS_NOT_REQUIRED_FOR_TREND":"WS_DISABLED",delta:null};
  if(!agg?.complete || !Number.isFinite(agg.delta) || !Number.isFinite(agg.asOf) ||
    agg.asOf>now+1000 || now-agg.asOf>12000 || agg.notional<350 || agg.count<5)
    return {allowed:false,reason:"WS_BREAKOUT_FLOW_UNAVAILABLE",delta:agg?.delta??null};
  const aligned=(side==="LONG"?1:-1)*agg.delta;
  // A moderate opposition should not automatically invalidate a trend.
  // For breakouts, do not chase an actively opposed real-time taker tape.
  if(aligned< -0.12)
    return {allowed:false,reason:"WS_BREAKOUT_OPPOSING_EXECUTION",delta:agg.delta};
  return {allowed:true,reason:"WS_BREAKOUT_TAPE_CONFIRMED",delta:agg.delta};
}
