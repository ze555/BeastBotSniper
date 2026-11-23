/**
 * Bidirectional regime + correction + failed-breakout engine (PAPER only).
 *
 * All signals use sequential, fully CLOSED Binance 1m bars. Independent depth,
 * OI and execution verification stays in entryValidation; these are candidacy
 * hypotheses, not confirmed profitability or a reconstruction of missing L2.
 *
 * IMPORTANT: A rejected candidate never becomes an opposite order without a
 * NEW, directionally confirmed signal. No automatic flip or look-ahead.
 */
import {evaluateAdaptiveSignal,type AdaptiveSignal,type AdaptiveSetup,type MarketRegime} from "./adaptiveRegimeStrategy.js";
import type {StrongFlowBar} from "./strongFlowStrategy.js";

export const BIDIRECTIONAL_REVISION="BIDIRECTIONAL_REGIME_REVERSAL_V4_PAPER";
export type DirectionalPhase=
  "EXPLOSION_UP"|"COLLAPSE_DOWN"|"TREND_UP_CONTINUATION"|"TREND_DOWN_CONTINUATION"|
  "UPTREND_CORRECTION_SHORT"|"DOWNTREND_CORRECTION_LONG"|
  "FAILED_UP_BREAKOUT_SHORT"|"FAILED_DOWN_BREAKOUT_LONG"|
  "RANGE_LONG"|"RANGE_SHORT";
export type BidirectionalSignal=AdaptiveSignal&{
  phase:DirectionalPhase;
  evidence:{closeQuality:number;flow3:number;flow5:number;flow15:number;trend15:number;
    trend60:number;rvol:number;priorImpulsePct:number;reason:string};
};

const signOf=(side:"LONG"|"SHORT")=>side==="LONG"?1:-1;
function weightedFlow(bars:StrongFlowBar[]):number{
  const q=bars.reduce((s,b)=>s+b.quoteVolume,0);
  return q>0?bars.reduce((s,b)=>s+2*b.takerBuyQuote-b.quoteVolume,0)/q:NaN;
}
/** Return normalized last-bar direction evidence; never read an unfinished bar. */
export function assessDirectionalStructure(rows:StrongFlowBar[],now=Date.now()){
  if(!Array.isArray(rows)||rows.length<72)return null;
  const n=rows.length,last=rows[n-1];
  if(!last||last.closeTime>=now||now-last.closeTime>90000)return null;
  for(let i=n-66;i<n;i++){
    const b=rows[i];
    if(!b||![b.openTime,b.closeTime,b.open,b.high,b.low,b.close,b.quoteVolume,b.takerBuyQuote].every(Number.isFinite)
      ||b.close<=0||b.high<b.low||b.quoteVolume<=0||b.takerBuyQuote<0||b.takerBuyQuote>b.quoteVolume
      ||(i>n-66&&b.openTime-rows[i-1].openTime!==60000))return null;
  }
  const prev=rows.slice(n-21,n-1),qavg=prev.reduce((a,b)=>a+b.quoteVolume,0)/prev.length;
  if(!(qavg>0))return null;
  let tr=0;
  for(let i=n-14;i<n;i++){
    const b=rows[i],p=rows[i-1];
    tr+=Math.max(b.high-b.low,Math.abs(b.high-p.close),Math.abs(b.low-p.close));
  }
  const atr=tr/14,width=last.high-last.low;
  if(!(atr>0&&width>0&&width<=4.5*atr))return null;
  const trend15=last.close/rows[n-16].close-1,trend60=last.close/rows[n-61].close-1;
  const flow3=weightedFlow(rows.slice(n-3)),flow5=weightedFlow(rows.slice(n-5)),
    flow15=weightedFlow(rows.slice(n-15));
  const delta=2*last.takerBuyQuote/last.quoteVolume-1,rvol=last.quoteVolume/qavg;
  const closeLong=(last.close-last.low)/width,closeShort=(last.high-last.close)/width;
  const previous3=rows.slice(n-4,n-1),prior10=rows.slice(n-15,n-4);
  const hi3=Math.max(...previous3.map(x=>x.high)),lo3=Math.min(...previous3.map(x=>x.low));
  const priorHigh=Math.max(...prior10.map(x=>x.high)),priorLow=Math.min(...prior10.map(x=>x.low));
  const sweptUp=previous3.some(x=>x.high>priorHigh+0.1*atr);
  const sweptDown=previous3.some(x=>x.low<priorLow-0.1*atr);
  const ret3=last.close/rows[n-4].close-1;
  const previousMovePct=last.close/rows[n-61].close-1;
  if(![trend15,trend60,flow3,flow5,flow15,delta,rvol,closeLong,closeShort,ret3].every(Number.isFinite))return null;
  return {last,atr,trend15,trend60,flow3,flow5,flow15,delta,rvol,
    closeLong,closeShort,priorHigh,priorLow,hi3,lo3,sweptUp,sweptDown,ret3,
    previousMovePct};
}
export function labelExistingSignal(signal:AdaptiveSignal,rows:StrongFlowBar[]):BidirectionalSignal{
  const n=rows.length,last=rows[n-1],sg=signOf(signal.side);
  const width=last.high-last.low;
  const closeQuality=width>0?(sg>0?(last.close-last.low):(last.high-last.close))/width:0;
  const f3=weightedFlow(rows.slice(-3));
  const phase:DirectionalPhase=signal.setupType==="VOLATILITY_BREAKOUT"?
    (sg>0?"EXPLOSION_UP":"COLLAPSE_DOWN"):
    signal.setupType==="RANGE_REVERSION"?(sg>0?"RANGE_LONG":"RANGE_SHORT"):
    (sg>0?"TREND_UP_CONTINUATION":"TREND_DOWN_CONTINUATION");
  return {...signal,phase,evidence:{closeQuality,flow3:f3,flow5:signal.flow5,
    flow15:signal.flow15,trend15:signal.trend15,trend60:signal.trend60,
    rvol:signal.rvol,priorImpulsePct:signal.trend60,reason:"CLOSED_BAR_ORIGINAL_REGIME"}};
}
function make(
  p:NonNullable<ReturnType<typeof assessDirectionalStructure>>,
  side:"LONG"|"SHORT",setupType:AdaptiveSetup,regime:MarketRegime,
  phase:DirectionalPhase,reason:string,stopAtr:number,targetR:number,maxHoldMinutes:number
):BidirectionalSignal{
  const sign=signOf(side);
  return {side,setupType,regime,phase,signalOpenTime:p.last.openTime,
    signalCloseTime:p.last.closeTime,signalClose:p.last.close,atr14:p.atr,
    rvol:p.rvol,delta:p.delta,flow5:p.flow5,flow15:p.flow15,trend15:p.trend15,
    trend60:p.trend60,stopAtr,targetR,maxHoldMs:maxHoldMinutes*60000,
    evidence:{closeQuality:sign>0?p.closeLong:p.closeShort,flow3:p.flow3,
      flow5:p.flow5,flow15:p.flow15,trend15:p.trend15,trend60:p.trend60,
      rvol:p.rvol,priorImpulsePct:p.previousMovePct,reason}};
}
/** Requires a complete opposite candle and a real previously swept level.
 * No automatic reversal merely because the old trade lost.
 */
export function evaluateBidirectionalSignal(rows:StrongFlowBar[],now=Date.now()):BidirectionalSignal|null{
  const p=assessDirectionalStructure(rows,now);
  if(!p)return null;
  const base=evaluateAdaptiveSignal(rows,now);
  const directionalVolume=p.rvol>=1.25;
  const strongUp=p.closeLong>=.72&&p.last.close>p.last.open&&p.delta>=.12&&p.flow3>=.06;
  const strongDown=p.closeShort>=.72&&p.last.close<p.last.open&&p.delta<=-.12&&p.flow3<=-.06;
  // Failed breakout/breakdown: swept local extreme, now closed beneath/above
  // the old level and previous three-bar range with opposite executed flow.
  if(directionalVolume&&p.sweptUp&&p.trend60>.012&&strongDown&&
      p.last.close<p.priorHigh && p.last.close<p.lo3)
    return make(p,"SHORT","FAILED_BREAKOUT_REVERSAL","TREND_DOWN",
      "FAILED_UP_BREAKOUT_SHORT","SWEPT_HIGH_THEN_CLOSED_BELOW_WITH_SELL_FLOW",1.8,2.2,45);
  if(directionalVolume&&p.sweptDown&&p.trend60<-.012&&strongUp&&
      p.last.close>p.priorLow && p.last.close>p.hi3)
    return make(p,"LONG","FAILED_BREAKOUT_REVERSAL","TREND_UP",
      "FAILED_DOWN_BREAKOUT_LONG","SWEPT_LOW_THEN_CLOSED_ABOVE_WITH_BUY_FLOW",1.8,2.2,45);
  // Brief countertrend opportunity: a real 3-bar break inside a strong 60m trend.
  // This is not a declaration that the entire higher-timeframe trend has flipped.
  if(p.trend60>=.025&&p.trend15>=.012&&p.trend60<=.16&&
      p.rvol>=1.3&&strongDown&&p.last.close<p.lo3&&p.ret3<-.003)
    return make(p,"SHORT","COUNTERTREND_CORRECTION","TREND_UP",
      "UPTREND_CORRECTION_SHORT","UPTREND_LOCAL_STRUCTURE_BROKEN",1.7,1.6,25);
  if(p.trend60<=-.025&&p.trend15<=-.012&&p.trend60>=-.16&&
      p.rvol>=1.3&&strongUp&&p.last.close>p.hi3&&p.ret3>.003)
    return make(p,"LONG","COUNTERTREND_CORRECTION","TREND_DOWN",
      "DOWNTREND_CORRECTION_LONG","DOWNTREND_LOCAL_STRUCTURE_BROKEN",1.7,1.6,25);
  // Preserve the previously proven-to-compile candidate generator for all
  // familiar cases. Every resulting order still passes live depth/OI/quote gates.
  if(base)return labelExistingSignal(base,rows);
  // Continue an emerging collapse/explosion even when its initial base is no
  // longer quiet. Never chase a move with exhausted 5-minute displacement.
  const high12=Math.max(...rows.slice(-13,-1).map(b=>b.high));
  const low12=Math.min(...rows.slice(-13,-1).map(b=>b.low));
  const width=p.last.high-p.last.low;
  const momentum=p.rvol>=2.1&&width>=1.05*p.atr&&width<=3.7*p.atr&&
    Math.abs(p.last.close/rows[rows.length-6].close-1)<=.05;
  if(momentum&&p.closeLong>=.8&&p.delta>=.22&&p.flow5>=.12&&p.flow15>=.06&&
     p.last.close>high12)
    return make(p,"LONG","VOLATILITY_BREAKOUT","EXPANSION",
      "EXPLOSION_UP","SUSTAINED_BREAKOUT_WITH_REAL_TAKER_BUYING",2.2,4.5,150);
  if(momentum&&p.closeShort>=.8&&p.delta<=-.22&&p.flow5<=-.12&&p.flow15<=-.06&&
     p.last.close<low12)
    return make(p,"SHORT","VOLATILITY_BREAKOUT","EXPANSION",
      "COLLAPSE_DOWN","SUSTAINED_BREAKDOWN_WITH_REAL_TAKER_SELLING",2.2,4.5,150);
  return null;
}
/** Strategy-specific tightening for new PAPER positions only. Existing V3
 * trades retain their existing stops, targets and historical strategy behavior.
 */
export function bidirectionalProfitStop(side:"LONG"|"SHORT",setup:AdaptiveSetup,
  entry:number,dist:number,peakR:number):number|null{
  if(!Number.isFinite(entry)||!Number.isFinite(dist)||!Number.isFinite(peakR)||
      entry<=0||dist<=0)return null;
  let lock:number|null=null;
  if(setup==="COUNTERTREND_CORRECTION"){
    if(peakR>=.75)lock=-.1;
    if(peakR>=1.1)lock=.34;
    if(peakR>=1.45)lock=.75;
  }else if(setup==="FAILED_BREAKOUT_REVERSAL"){
    if(peakR>=1.1)lock=.2;
    if(peakR>=1.7)lock=.7;
    if(peakR>=2.35)lock=Math.max(1.15,peakR-.85);
  }else if(setup==="VOLATILITY_BREAKOUT"){
    if(peakR>=2.7)lock=Math.max(1.2,peakR-1.15);
  }
  return lock===null?null:entry+signOf(side)*lock*dist;
}
