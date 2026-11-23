/**
 * Entry verification for ADAPTIVE_REGIME_ORDERFLOW_V2.
 * All inputs are observed Binance data: closed 1m candles, executable BBO,
 * orderbook snapshot, and two complete 5m open-interest observations.
 * It rejects absent/stale evidence; no retrospective candles or proxy OI.
 * It is a risk filter, NOT a profitable-trade guarantee.
 */
import type { StrongFlowBar } from "./strongFlowStrategy.js";
import type { AdaptiveSignal, AdaptiveSetup } from "./adaptiveRegimeStrategy.js";
import { validQuote, type Quote } from "./tradingIntegrity.js";
import { followThroughExtension } from "./entryExitSafeguards.js";

type Direction = "LONG" | "SHORT";
export type EntryDecision = {allowed:boolean;reason:string;details?:Record<string,number|string>};
export interface EntryDepth {
  allowed:boolean;
  reason:string;
  imbalance:number;
  spread:number;
  depthNotional:number;
  bestBid:number;
  bestAsk:number;
  time:number;
}
export interface EntryOi {
  delta:number;
  timestamp:number;
  previousTimestamp:number;
}
interface CompletedBar {
  close:number;open:number;high:number;low:number;flow:number;endTime:number;
}
function direction(side:Direction){return side==="LONG"?1:-1;}
const fail=(reason:string):EntryDecision=>({allowed:false,reason});

/** Aggregate exclusively COMPLETE UTC-aligned 5m/15m candles from closed 1m bars. */
export function completeTimeframeBars(rows:StrongFlowBar[],minutes:5|15):CompletedBar[]{
  const duration=minutes*60000,out:CompletedBar[]=[];
  if(!Array.isArray(rows))return out;
  let group:StrongFlowBar[]=[],bucket=-1;
  const flush=()=>{
    if(group.length!==minutes)return;
    const start=bucket;
    if(group[0].openTime!==start || group[minutes-1].openTime!==start+(minutes-1)*60000)return;
    for(let i=1;i<group.length;i++)if(group[i].openTime-group[i-1].openTime!==60000)return;
    const total=group.reduce((a,b)=>a+b.quoteVolume,0);
    if(!(total>0))return;
    out.push({open:group[0].open,close:group[minutes-1].close,
      high:Math.max(...group.map(b=>b.high)),low:Math.min(...group.map(b=>b.low)),
      flow:group.reduce((a,b)=>a+2*b.takerBuyQuote-b.quoteVolume,0)/total,
      endTime:group[minutes-1].closeTime});
  };
  for(const b of rows){
    if(!b || !Number.isFinite(b.openTime) || !Number.isFinite(b.closeTime) || !(b.quoteVolume>0) ||
      !Number.isFinite(b.takerBuyQuote) || b.takerBuyQuote<0 || b.takerBuyQuote>b.quoteVolume ||
      !Number.isFinite(b.close) || b.close<=0)continue;
    const current=Math.floor(b.openTime/duration)*duration;
    if(bucket!==current){flush();bucket=current;group=[];}
    group.push(b);
  }
  flush();
  return out;
}

/** Force at least one independently closed minute AFTER the first signal. */
export function confirmNextClosedMinute(signal:AdaptiveSignal,rows:StrongFlowBar[],now=Date.now()):EntryDecision{
  const last=rows.at(-1),sign=direction(signal.side);
  if(!last || !Number.isFinite(last.closeTime) || !Number.isFinite(last.openTime))return fail("FOLLOW_THROUGH_MISSING");
  if(last.openTime!==signal.signalOpenTime+60000 ||
    last.closeTime!==signal.signalCloseTime+60000)return fail("FOLLOW_THROUGH_NOT_CONSECUTIVE");
  if(last.closeTime>=now || now-last.closeTime>90000)return fail("FOLLOW_THROUGH_STALE");
  if(![last.close,last.open,last.quoteVolume,last.takerBuyQuote].every(Number.isFinite) ||
    !(last.close>0 && last.quoteVolume>0) ||
    last.takerBuyQuote<0 || last.takerBuyQuote>last.quoteVolume)return fail("FOLLOW_THROUGH_INVALID");
  const delta=2*last.takerBuyQuote/last.quoteVolume-1;
  if(sign*(last.close-signal.signalClose)< -0.18*signal.atr14)return fail("FOLLOW_THROUGH_PRICE_FAILED");
  if(sign*delta< -0.12)return fail("FOLLOW_THROUGH_FLOW_REVERSED");
  if(sign*(last.close-last.open)< -0.45*signal.atr14)return fail("FOLLOW_THROUGH_CANDLE_REVERSAL");
  // Require the FOLLOW-THROUGH candle to finish in its own trade direction
  // when the market is already moving sharply. This checks a fully closed bar,
  // not any future candle, and catches late chase/rejected-breakout entries.
  const width=last.high-last.low;
  if(Number.isFinite(width)&&width>0&&Number.isFinite(last.low)&&Number.isFinite(last.high)){
    const quality=sign*(last.close-(sign>0?last.low:last.high))/width;
    if(quality<.60 &&
       (Math.abs(signal.trend60)>=.015 || signal.setupType==="FAILED_BREAKOUT_REVERSAL" ||
        signal.setupType==="COUNTERTREND_CORRECTION"))
      return fail("FOLLOW_THROUGH_WEAK_CLOSE");
  }
  // A large second candle is often a late, exhausted entry rather than a
  // continuation opportunity: require not to chase >0.55 ATR after signal.
  const extension=followThroughExtension(signal.side,signal.signalClose,last.close,signal.atr14,signal.setupType);
  if(!extension.allowed)return fail(extension.reason);
  return {allowed:true,reason:"FOLLOW_THROUGH_CONFIRMED",details:{
    nextDelta:delta,followThroughExtensionAtr:extension.extensionAtr!
  }};
}

/** Parse Binance 5m OI. Ignore the most recent five minutes conservatively:
 * some archive labels differ from documented REST end-of-period semantics. */
export function parseOpenInterestHistory(raw:unknown,now=Date.now()):EntryOi|null{
  if(!Array.isArray(raw))return null;
  const valid=raw.map((x:any)=>({timestamp:Number(x?.timestamp),value:Number(x?.sumOpenInterest)}))
    .filter(x=>Number.isFinite(x.timestamp)&&Number.isFinite(x.value)&&x.value>0&&
      x.timestamp<=now-5*60000&&x.timestamp>=now-20*60000)
    .sort((a,b)=>a.timestamp-b.timestamp);
  if(valid.length<2)return null;
  const latest=valid.at(-1)!,prev=valid.at(-2)!;
  if(latest.timestamp-prev.timestamp<4*60000 || latest.timestamp-prev.timestamp>11*60000 ||
    now-latest.timestamp>12*60000)return null;
  const delta=latest.value/prev.value-1;
  if(!Number.isFinite(delta))return null;
  return {delta,timestamp:latest.timestamp,previousTimestamp:prev.timestamp};
}

/**
 * Genuine trend: non-opposing closed 5m and 15m price response plus
 * aligned executed taker flow. Regime-dependent filters discourage chasing.
 */
export function confirmEntryContext(signal:AdaptiveSignal,rows:StrongFlowBar[],now=Date.now()):EntryDecision{
  const last=rows.at(-1);
  if(!last || last.closeTime>=now || now-last.closeTime>90000)return fail("CLOSED_CANDLES_STALE");
  const b5=completeTimeframeBars(rows,5),b15=completeTimeframeBars(rows,15);
  if(b5.length<2 || b15.length<2)return fail("MTF_HISTORY_MISSING");
  const a5=b5.at(-1)!,p5=b5.at(-2)!,a15=b15.at(-1)!,p15=b15.at(-2)!;
  if(now-a5.endTime>6*60000 || now-a15.endTime>16*60000)return fail("MTF_HISTORY_STALE");
  const sign=direction(signal.side);
  const ret5=a5.close/p5.close-1,ret15=a15.close/p15.close-1;
  if(![ret5,ret15,a5.flow,a15.flow].every(Number.isFinite))return fail("MTF_INVALID");
  // Distinguish a genuine trend from the last, overheated candle of a large move.
  if(signal.setupType==="TREND_CONTINUATION" || signal.setupType==="TREND_PULLBACK"){
    if(sign*ret15< -0.0015 || sign*ret5< -0.002)return fail("MTF_TREND_OPPOSES");
    if(sign*a5.flow< -0.035 || sign*a15.flow< -0.035)return fail("MTF_TAKER_OPPOSES");
    if(Math.abs(signal.trend60)>0.045 || Math.abs(signal.trend15)>0.026)return fail("LATE_TREND_EXHAUSTION");
  } else if(signal.setupType==="VOLATILITY_BREAKOUT"){
    const pressure=confirmBreakoutTakerFlow(signal.side,signal.flow5,signal.flow15);
    if(!pressure.allowed)return pressure;
    if(sign*ret15< -0.003 || sign*ret5< -0.0015)return fail("BREAKOUT_AGAINST_MTF");
    if(sign*a5.flow< -0.015)return fail("BREAKOUT_FLOW_NOT_CONFIRMED");
    if(sign*signal.trend60< -0.018)return fail("BREAKOUT_COUNTERTREND_TRAP");
  } else if(signal.setupType==="COUNTERTREND_CORRECTION"||
            signal.setupType==="FAILED_BREAKOUT_REVERSAL"){
    // These are deliberately opposite to the PRIOR trend; requiring the 15m
    // trend to agree would block every recovery / short correction. Instead
    // demand that the most recent closed 5m price + taker response is not
    // decisively rejecting the new side.
    // A countertrend trade must not be vetoed just because the PREVIOUS 5m
    // or 15m candle belonged to the old trend. Only reject an unusually
    // forceful, simultaneous price + execution acceleration against the new side.
    if(sign*ret5< -.025 && sign*a5.flow< -.15)
      return fail("REVERSAL_5M_OLD_TREND_STILL_ACCELERATING");
    if(sign*signal.flow5< -.20)return fail("REVERSAL_1M_FLOW_OPPOSES");
  } else {
    // Mean reversion is valid only when the 15m structure is genuinely balanced.
    if(Math.abs(ret15)>0.0045 || Math.abs(signal.trend60)>0.009)return fail("RANGE_NOT_BALANCED");
    if(sign*ret5< -0.0025)return fail("RANGE_COUNTERMOMENTUM");
  }
  return {allowed:true,reason:"MTF_CONFIRMED",details:{ret5,ret15,flow5m:a5.flow,flow15m:a15.flow}};
}

/**
 * Additional gate only for the breakout setup, using the already-closed 1m
 * executed-taker quote flow that was available when the signal formed.
 * No threshold changes to trend, pullback, range, or any existing exit.
 */
export function confirmBreakoutTakerFlow(
  side:"LONG"|"SHORT",flow5:number,flow15:number
):EntryDecision{
  if(!Number.isFinite(flow5)||!Number.isFinite(flow15))return fail("BREAKOUT_TAKER_FLOW_INVALID");
  const sign=side==="LONG"?1:-1;
  if(sign*flow5<0.12 || sign*flow15<0.06)return fail("BREAKOUT_MULTIFRAME_TAKER_WEAK");
  return {allowed:true,reason:"BREAKOUT_MULTIFRAME_TAKER_CONFIRMED"};
}

/** The quote, depth, and historical open interest are independently observed. */
export function verifyExecutableEntry(
  signal:AdaptiveSignal,rows:StrongFlowBar[],quote:Quote,depth:EntryDepth,oi:EntryOi|null,
  feeRate:number,slippageRate:number,now=Date.now()
):EntryDecision{
  const follow=confirmNextClosedMinute(signal,rows,now);
  if(!follow.allowed)return follow;
  const multi=confirmEntryContext(signal,rows,now);
  if(!multi.allowed)return multi;
  if(!validQuote(quote,now)||now-quote.time>3000)return fail("EXECUTION_QUOTE_STALE");
  if(!depth.allowed)return fail(depth.reason);
  if(!Number.isFinite(depth.time)||depth.time>now+1000||now-depth.time>5000)return fail("ORDERBOOK_STALE");
  if(!(depth.bestBid>0&&depth.bestAsk>=depth.bestBid))return fail("ORDERBOOK_TOP_INVALID");
  const sign=direction(signal.side);
  const executable=signal.side==="LONG"?quote.ask:quote.bid;
  if(Math.abs(quote.ask-depth.bestAsk)/executable>0.0015 ||
    Math.abs(quote.bid-depth.bestBid)/executable>0.0015)return fail("EXECUTION_BOOK_MISMATCH");
  const maxSpread=signal.setupType==="RANGE_REVERSION"?0.0009:0.0015;
  if(depth.spread>maxSpread)return fail("ENTRY_SPREAD_TOO_WIDE");
  const minimumDepth=signal.setupType==="RANGE_REVERSION"?20000:12000;
  if(depth.depthNotional<minimumDepth)return fail("ENTRY_DEPTH_TOO_THIN");
  const imbalanceFloor=signal.setupType==="RANGE_REVERSION"?0.04:
    signal.setupType==="VOLATILITY_BREAKOUT"?-0.10:
    (signal.setupType==="FAILED_BREAKOUT_REVERSAL"||signal.setupType==="COUNTERTREND_CORRECTION")?-0.25:-0.20;
  if(sign*depth.imbalance<imbalanceFloor)return fail("ENTRY_OPPOSING_LIQUIDITY");
  if(!oi)return fail("OPEN_INTEREST_HISTORY_UNAVAILABLE");
  if(now-oi.timestamp>12*60000 || !Number.isFinite(oi.delta))return fail("OPEN_INTEREST_STALE");
  // OI has no LONG/SHORT direction; this vetoes unstable deleveraging, not 'predict' a direction.
  if(oi.delta< -0.008 || oi.delta>0.08)return fail("OPEN_INTEREST_SHOCK");
  if(signal.setupType==="RANGE_REVERSION" && Math.abs(oi.delta)>0.025)
    return fail("RANGE_POSITIONING_UNSTABLE");
  if(![feeRate,slippageRate].every(v=>Number.isFinite(v)&&v>=0&&v<0.01))return fail("COST_SETTINGS_INVALID");
  const initialStop=signal.atr14*signal.stopAtr;
  if(!(initialStop>0))return fail("STOP_DISTANCE_INVALID");
  const riskPct=initialStop/executable;
  const fullCostPct=depth.spread+2*(feeRate+slippageRate);
  if(fullCostPct/riskPct>0.28)return fail("COST_TOO_HIGH_FOR_RISK");
  const drift=sign*(executable-signal.signalClose);
  if(drift>signal.atr14*0.68)return fail("ENTRY_TOO_LATE");
  if(drift< -signal.atr14*0.40)return fail("ENTRY_IMPULSE_INVALIDATED");
  return {allowed:true,reason:"REAL_MARKET_ENTRY_CONFIRMED",details:{
    driftAtr:drift/signal.atr14,oiDelta:oi.delta,bookImbalance:depth.imbalance,
    costToRisk:fullCostPct/riskPct,...multi.details,...follow.details
  }};
}
