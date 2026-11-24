import type {StrongFlowBar} from "./strongFlowStrategy.js";
import type {BidirectionalSignal} from "./bidirectionalRegimeEngine.js";
export const FLEX_REVISION="FLEX_INSTITUTIONAL_15M_RECONSTRUCTED_V1_PAPER";
const M=60000,Q=15*M;
function valid(rows:readonly StrongFlowBar[],period:number,now:number){
  return rows.every((b,i)=>[b.openTime,b.closeTime,b.open,b.high,b.low,b.close,b.quoteVolume,b.takerBuyQuote].every(Number.isFinite)&&
    b.open>0&&b.close>0&&b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&
    b.quoteVolume>0&&b.takerBuyQuote>=0&&b.takerBuyQuote<=b.quoteVolume&&
    b.openTime%period===0&&b.closeTime===b.openTime+period-1&&b.closeTime<now&&
    (i===0||b.openTime===rows[i-1].openTime+period));
}
function flow(rows:readonly StrongFlowBar[]){
  const q=rows.reduce((s,b)=>s+b.quoteVolume,0);
  return q>0?rows.reduce((s,b)=>s+2*b.takerBuyQuote-b.quoteVolume,0)/q:NaN;
}
/** Reconstruction of the documented 14-day study rules, NOT the original simulator.
 * Undocumented choices: 20-bar volume baseline, three-bar local structure,
 * 14-bar Wilder-style initial arithmetic ATR, 5-minute signal validity.
 * Entry evidence and safety costs are separately verified from live Binance data. */
export function evaluateFlex15m(rows:StrongFlowBar[],now=Date.now()):BidirectionalSignal|null{
  const r=rows.slice(-21),b=r.at(-1);
  if(r.length!==21||!b||!valid(r,Q,now)||now-b.closeTime>5*M)return null;
  const prior=r.slice(0,-1),prev=prior.at(-1)!;
  const rvol=b.quoteVolume/(prior.reduce((s,x)=>s+x.quoteVolume,0)/20);
  const delta=flow([b]);
  if(rvol<1.25||Math.abs(delta)<.025)return null;
  const atr14=r.slice(-14).reduce((s,x,i)=>{const pc=r[r.length-15+i].close;return s+Math.max(x.high-x.low,Math.abs(x.high-pc),Math.abs(x.low-pc));},0)/14;
  if(!(atr14>0))return null;
  const high8=Math.max(...prior.slice(-8).map(x=>x.high)),low8=Math.min(...prior.slice(-8).map(x=>x.low));
  const high3=Math.max(...prior.slice(-3).map(x=>x.high)),low3=Math.min(...prior.slice(-3).map(x=>x.low));
  const oldTrend=prev.close/prior[prior.length-13].close-1;
  const side=delta>0?"LONG":"SHORT",sg=side==="LONG"?1:-1;
  const width=b.high-b.low;
  if(!(width>0)||sg*(b.close-b.open)<=0)return null;
  const breakout=sg>0?b.close>high8:b.close<low8;
  const correction=sg>0?oldTrend<-.025&&b.close>high3:oldTrend>.025&&b.close<low3;
  if(!breakout&&!correction)return null;
  // A reversal through the entire two-hour range is treated as a breakout.
  const trend15=b.close/prev.close-1,trend60=b.close/r[r.length-5].close-1;
  return {side,signalOpenTime:b.openTime,signalCloseTime:b.closeTime,signalClose:b.close,
    atr14,rvol,delta,flow5:delta,flow15:delta,trend15,trend60,
    setupType:breakout?"VOLATILITY_BREAKOUT":"COUNTERTREND_CORRECTION",
    regime:breakout?"EXPANSION":sg>0?"TREND_DOWN":"TREND_UP",
    phase:breakout?(sg>0?"EXPLOSION_UP":"COLLAPSE_DOWN"):(sg>0?"DOWNTREND_CORRECTION_LONG":"UPTREND_CORRECTION_SHORT"),
    stopAtr:breakout?1.7:1.35,targetR:breakout?3:1.6,maxHoldMs:(breakout?180:90)*M,
    evidence:{closeQuality:sg>0?(b.close-b.low)/width:(b.high-b.close)/width,flow3:delta,flow5:delta,flow15:delta,trend15,trend60,rvol,priorImpulsePct:oldTrend,
      reason:breakout?"CLOSED_15M_TWO_HOUR_BREAK":"CLOSED_15M_THREE_HOUR_CORRECTION"}};
}
/** Most recent fully closed, aligned five-minute block. Only strong simultaneous
 * adverse price and flow is a veto; a small pullback does not block entry. */
export function flexTiming(signal:BidirectionalSignal,rows:StrongFlowBar[],now=Date.now()){
  const end=Math.floor(now/(5*M))*5*M;
  const five=rows.filter(b=>b.openTime>=end-5*M&&b.openTime<end);
  if(five.length!==5||!valid(five,M,now)||five[0].openTime!==end-5*M||five[4].closeTime!==end-1||five[4].closeTime<signal.signalCloseTime)return {allowed:false,reason:"FLEX_5M_MISSING"};
  const sg=signal.side==="LONG"?1:-1,d=flow(five),ret=five[4].close/five[0].open-1;
  if(sg*d<-.15&&sg*ret<-.002)return {allowed:false,reason:"FLEX_5M_STRONG_CONFLICT"};
  return {allowed:true,reason:"FLEX_5M_TIMING"};
}
