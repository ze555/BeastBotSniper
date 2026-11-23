/**
 * Adaptive paper-trading signal engine.
 * Signals use ONLY fully closed Binance USD-M 1m OHLCV + executed taker quote volume.
 * Book depth and open interest are checked separately at execution time; no synthetic data.
 * This is an experimental trading model, NOT a validated profitable strategy.
 */
import type { StrongFlowBar } from "./strongFlowStrategy.js";

export const ADAPTIVE_STRATEGY_ID = "ADAPTIVE_REGIME_ORDERFLOW_V1";
export type MarketRegime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "EXPANSION";
export type AdaptiveSetup = "TREND_CONTINUATION" | "TREND_PULLBACK" | "RANGE_REVERSION" | "VOLATILITY_BREAKOUT" |
  "FAILED_BREAKOUT_REVERSAL" | "COUNTERTREND_CORRECTION";
export interface AdaptiveSignal {
  side: "LONG" | "SHORT";
  signalOpenTime: number;
  signalCloseTime: number;
  signalClose: number;
  atr14: number;
  rvol: number;
  delta: number;
  flow5: number;
  flow15: number;
  trend15: number;
  trend60: number;
  regime: MarketRegime;
  setupType: AdaptiveSetup;
  stopAtr: number;
  targetR: number;
  maxHoldMs: number;
}

function signedFlow(rows: StrongFlowBar[], count: number): number {
  const tail=rows.slice(-count);
  const q=tail.reduce((s,b)=>s+b.quoteVolume,0);
  return q>0 ? tail.reduce((s,b)=>s+2*b.takerBuyQuote-b.quoteVolume,0)/q : NaN;
}

/** Never use an unfinished, stale, malformed or non-consecutive candle. */
export function evaluateAdaptiveSignal(rows: StrongFlowBar[], now=Date.now()): AdaptiveSignal | null {
  if (!Array.isArray(rows) || rows.length<65) return null;
  const n=rows.length, last=rows[n-1];
  if (!Number.isFinite(last?.closeTime) || last.closeTime>=now || now-last.closeTime>90_000) return null;
  for(let i=n-62;i<n;i++){
    const b=rows[i];
    if (!b || ![b.openTime,b.closeTime,b.open,b.high,b.low,b.close,b.quoteVolume,b.takerBuyQuote].every(Number.isFinite)
      || b.close<=0 || b.high<b.low || b.quoteVolume<=0 || b.takerBuyQuote<0 || b.takerBuyQuote>b.quoteVolume
      || (i>n-62 && b.openTime-rows[i-1].openTime!==60_000)) return null;
  }
  const previous=rows.slice(n-21,n-1);
  const avgVolume=previous.reduce((s,b)=>s+b.quoteVolume,0)/previous.length;
  if (!(avgVolume>0)) return null;
  const rvol=last.quoteVolume/avgVolume;
  let tr=0;
  for(let i=n-14;i<n;i++){
    const b=rows[i], p=rows[i-1];
    tr+=Math.max(b.high-b.low,Math.abs(b.high-p.close),Math.abs(b.low-p.close));
  }
  const atr14=tr/14, width=last.high-last.low;
  if (!(atr14>0 && width>0 && width<=4.5*atr14)) return null;
  const delta=2*last.takerBuyQuote/last.quoteVolume-1;
  const flow5=signedFlow(rows,5),flow15=signedFlow(rows,15);
  const trend15=last.close/rows[n-16].close-1,trend60=last.close/rows[n-61].close-1;
  const ret5=last.close/rows[n-6].close-1;
  const loc=(last.close-last.low)/width;
  const last5=rows.slice(n-6,n-1),last12=rows.slice(n-13,n-1),last35=rows.slice(n-36,n-1);
  const high5=Math.max(...last5.map(b=>b.high)),low5=Math.min(...last5.map(b=>b.low));
  const high12=Math.max(...last12.map(b=>b.high)),low12=Math.min(...last12.map(b=>b.low));
  const high35=Math.max(...last35.map(b=>b.high)),low35=Math.min(...last35.map(b=>b.low));
  const rangeWidth=high35-low35;
  const trendUp=trend60>0.004 && trend15>0.001;
  const trendDown=trend60< -0.004 && trend15< -0.001;
  const range=Math.abs(trend60)<0.012 && Math.abs(trend15)<0.007 && rangeWidth>3*atr14;
  if (![delta,flow5,flow15,trend15,trend60,ret5,loc,rvol,rangeWidth].every(Number.isFinite)) return null;
  let side:AdaptiveSignal["side"]|null=null,regime:MarketRegime="RANGE",setupType:AdaptiveSetup="RANGE_REVERSION";
  let stopAtr=1.55,targetR=1.3,maxHoldMs=75*60_000;
  const longCandle=last.close>last.open && loc>0.67;
  const shortCandle=last.close<last.open && loc<0.33;
  const buyFlow=delta>0.12 && flow5>0.025 && flow15> -0.025;
  const sellFlow=delta< -0.12 && flow5< -0.025 && flow15<0.025;
  // Expansion after a quiet local base, not a perpetual breakout filter.
  const priorQuiet=(high12-low12)<5.2*atr14;
  if(priorQuiet && rvol>=1.8 && width>=1.35*atr14 && longCandle && buyFlow && last.close>high12 && ret5<0.028){
    side="LONG";regime="EXPANSION";setupType="VOLATILITY_BREAKOUT";stopAtr=2.2;targetR=4.5;maxHoldMs=150*60_000;
  }else if(priorQuiet && rvol>=1.8 && width>=1.35*atr14 && shortCandle && sellFlow && last.close<low12 && ret5> -0.028){
    side="SHORT";regime="EXPANSION";setupType="VOLATILITY_BREAKOUT";stopAtr=2.2;targetR=4.5;maxHoldMs=150*60_000;
  }else if(trendUp && rvol>=1.2 && longCandle && buyFlow && last.close>high5 && ret5<0.02){
    side="LONG";regime="TREND_UP";setupType="TREND_CONTINUATION";stopAtr=2;targetR=4;maxHoldMs=180*60_000;
  }else if(trendDown && rvol>=1.2 && shortCandle && sellFlow && last.close<low5 && ret5> -0.02){
    side="SHORT";regime="TREND_DOWN";setupType="TREND_CONTINUATION";stopAtr=2;targetR=4;maxHoldMs=180*60_000;
  }else if(trendUp && rvol>=1.08 && longCandle && delta>0.11 && flow5>0.01
    && rows[n-2].close<rows[n-4].close && last.close>rows[n-2].high && ret5<0.012){
    side="LONG";regime="TREND_UP";setupType="TREND_PULLBACK";stopAtr=1.9;targetR=3.5;maxHoldMs=180*60_000;
  }else if(trendDown && rvol>=1.08 && shortCandle && delta< -0.11 && flow5< -0.01
    && rows[n-2].close>rows[n-4].close && last.close<rows[n-2].low && ret5> -0.012){
    side="SHORT";regime="TREND_DOWN";setupType="TREND_PULLBACK";stopAtr=1.9;targetR=3.5;maxHoldMs=180*60_000;
  }else if(range && rvol>=1.03 && longCandle && delta>0.08 && flow5> -0.025
    && last.low<=low35+0.23*rangeWidth && last.close<=low35+0.42*rangeWidth){
    side="LONG";regime="RANGE";setupType="RANGE_REVERSION";
  }else if(range && rvol>=1.03 && shortCandle && delta< -0.08 && flow5<0.025
    && last.high>=high35-0.23*rangeWidth && last.close>=high35-0.42*rangeWidth){
    side="SHORT";regime="RANGE";setupType="RANGE_REVERSION";
  }
  if(!side)return null;
  return {side,signalOpenTime:last.openTime,signalCloseTime:last.closeTime,signalClose:last.close,
    atr14,rvol,delta,flow5,flow15,trend15,trend60,regime,setupType,stopAtr,targetR,maxHoldMs};
}

export interface DepthAssessment {
  allowed:boolean;reason:string;imbalance:number;spread:number;depthNotional:number;
}
/** Best 20 levels: real resting liquidity is a snapshot, never proof of executed buying. */
export function assessOrderBook(side:"LONG"|"SHORT",bids:unknown,asks:unknown):DepthAssessment {
  const reject=(reason:string):DepthAssessment=>({allowed:false,reason,imbalance:0,spread:NaN,depthNotional:0});
  if(!Array.isArray(bids)||!Array.isArray(asks)||!bids.length||!asks.length)return reject("DEPTH_MISSING");
  const parse=(levels:unknown[])=>levels.slice(0,20).map(x=>Array.isArray(x)?[Number(x[0]),Number(x[1])]:[NaN,NaN]);
  const bb=parse(bids),aa=parse(asks);
  if([...bb,...aa].some(([p,q])=>!Number.isFinite(p)||!Number.isFinite(q)||p<=0||q<0))return reject("DEPTH_INVALID");
  const bestBid=bb[0][0],bestAsk=aa[0][0];
  if(bestAsk<=bestBid)return reject("DEPTH_CROSSED");
  const spread=(bestAsk-bestBid)/((bestAsk+bestBid)/2);
  const bidValue=bb.reduce((s,[p,q])=>s+p*q,0),askValue=aa.reduce((s,[p,q])=>s+p*q,0);
  const depthNotional=bidValue+askValue;
  const imbalance=depthNotional>0?(bidValue-askValue)/depthNotional:0;
  if(spread>0.003)return {allowed:false,reason:"SPREAD_TOO_WIDE",spread,depthNotional,imbalance};
  if(depthNotional<1000)return {allowed:false,reason:"THIN_BOOK",spread,depthNotional,imbalance};
  if(side==="LONG"&&imbalance< -0.55 || side==="SHORT"&&imbalance>0.55)
    return {allowed:false,reason:"OPPOSING_BOOK_IMBALANCE",spread,depthNotional,imbalance};
  return {allowed:true,reason:"REAL_DEPTH_CONFIRMED",spread,depthNotional,imbalance};
}

/** Monotonic protective stops; never loosen risk after entry. */
export function adaptiveStopCandidate(
  side:"LONG"|"SHORT",entry:number,initialDist:number,peakR:number,setup:AdaptiveSetup
):number|null{
  if(![entry,initialDist,peakR].every(Number.isFinite)||entry<=0||initialDist<=0)return null;
  let protectR:number|null=null;
  if(setup==="RANGE_REVERSION"){
    if(peakR>=0.85)protectR=-0.15;
    if(peakR>=1.15)protectR=0.35;
  }else{
    if(peakR>=1.2)protectR=0.1;
    if(peakR>=1.75)protectR=0.7;
    if(peakR>=2.35)protectR=Math.max(1.1,peakR-1.1);
  }
  if(protectR===null)return null;
  return entry+(side==="LONG"?1:-1)*protectR*initialDist;
}
