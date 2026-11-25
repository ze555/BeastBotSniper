/** Flow-price divergence B: exact research predicates, paper only.
 * Closed 1h candles; 3-hour executed taker quote imbalance (not order-book OFI).
 * No FLEX timing, direction retry, OI veto or discretionary exit.
 */
import type {StrongFlowBar} from "./strongFlowStrategy.js";
import type {BidirectionalSignal} from "./bidirectionalRegimeEngine.js";
export const FLOW_REVISION="BEAST_FLOW_DIVERGENCE_B_1H_V1_PAPER";
export const HOUR=3600000, FLOW_TARGET_R=1.2, FLOW_STOP_ATR=2.5, FLOW_MAX_HOLD_MS=240*60000;
export const FLOW_VALID_MS=300000;
export const FLOW_REFERENCE_SYMBOLS="1000BONKUSDT 1000PEPEUSDT 1000SHIBUSDT AAVEUSDT ADAUSDT AKEUSDT ARUSDT BNBUSDT BTCUSDT DASHUSDT ENAUSDT ETHUSDT FILUSDT GALAUSDT GRASSUSDT HBARUSDT HYPEUSDT JUPUSDT KORUUSDT LDOUSDT LINKUSDT LITUSDT LTCUSDT LYNUSDT MONUSDT MVLLUSDT NEARUSDT NIGHTUSDT PENDLEUSDT PUMPUSDT STRKUSDT STXUSDT SUIUSDT SUPERUSDT SYNUSDT TRUMPUSDT TRXUSDT VELVETUSDT WIFUSDT XRPUSDT ZECUSDT ZROUSDT".split(" ");
export const FLOW_EXCLUDED_BASES=new Set("AAOI AAPL AXTI BZ CBRS COIN DRAM INTC LITE MRVL MSTR MU MUU NATGAS NBIS NVDA SAMSUNG SOXS TQQQ".split(" "));
export const flowEligible=(symbol:string)=>!FLOW_EXCLUDED_BASES.has(symbol.replace(/(?:USDT|USDC)$/,""));
export function closedHour(now:number){return Math.floor(now/HOUR)*HOUR-1;}
export function validHourRows(rows:readonly StrongFlowBar[],end:number){
  if(rows.length<26||rows.at(-1)?.closeTime!==end)return false;
  return rows.slice(-26).every((b,i,a)=>[b.openTime,b.closeTime,b.open,b.high,b.low,b.close,b.quoteVolume,b.takerBuyQuote].every(Number.isFinite)&&b.openTime%HOUR===0&&b.closeTime===b.openTime+HOUR-1&&b.open>0&&b.low>0&&b.close>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.quoteVolume>=0&&b.takerBuyQuote>=0&&b.takerBuyQuote<=b.quoteVolume&&(i===0||b.openTime-a[i-1].openTime===HOUR));
}
export function return3h(rows:readonly StrongFlowBar[],end:number):number|null{
  return validHourRows(rows,end)?rows.at(-1)!.close/rows.at(-4)!.close-1:null;
}
/** pandas rank(pct=True), average ties. For untested symbols add candidate to fixed reference cohort. */
export function relativeRank(symbol:string,value:number,reference:ReadonlyMap<string,number>):number|null{
  const a=[...reference].filter(([_,v])=>Number.isFinite(v));
  if(a.length<30||!Number.isFinite(value))return null;
  const values=a.filter(([s])=>s!==symbol).map(([_,v])=>v);values.push(value);
  const below=values.filter(v=>v<value).length,equal=values.filter(v=>v===value).length;
  return (below+(equal+1)/2)/values.length;
}
export type FlowSignal=BidirectionalSignal&{flowRank:number;flow3h:number;ema12:number;relativeVolume:number};
export function evaluateFlowDivergence(rows:StrongFlowBar[],rank:number,now=Date.now()):FlowSignal|null{
  const end=closedHour(now);
  if(now-end>FLOW_VALID_MS||!validHourRows(rows,end)||!Number.isFinite(rank)||rank<0||rank>1)return null;
  const b=rows.at(-1)!,pc=rows.at(-2)!,tail=rows.slice(-3);
  const q=tail.reduce((a,x)=>a+x.quoteVolume,0),buy=tail.reduce((a,x)=>a+x.takerBuyQuote,0);
  const baseline=rows.slice(-25,-1).reduce((a,x)=>a+x.quoteVolume,0)/24;
  if(!(b.quoteVolume>0&&q>0&&baseline>0&&b.high>b.low))return null;
  const rvol=b.quoteVolume/baseline,delta=2*b.takerBuyQuote/b.quoteVolume-1,f3=2*buy/q-1;
  const ret=b.close/pc.close-1,ret3=b.close/rows.at(-4)!.close-1;
  let atr=0;for(let i=rows.length-14;i<rows.length;i++){const x=rows[i],p=rows[i-1].close;atr+=Math.max(x.high-x.low,Math.abs(x.high-p),Math.abs(x.low-p));}atr/=14;
  if(!(atr>0))return null;
  // Long warm-up from exchange history; 200 bars makes initialization negligible.
  let ema=rows[0].close;for(const x of rows.slice(1)){if(!Number.isFinite(x.close)||x.close<=0)return null;ema+=(2/13)*(x.close-ema);}
  const loc=(b.close-b.low)/(b.high-b.low);
  const pass=(s:number)=>s*f3>.12&&s*delta>.06&&rvol>1.3&&s*ret3<.005&&(s===1?loc:1-loc)>.55&&s*ret>0&&(s===1?rank:1-rank)>.35&&s*(b.close-ema)<atr&&s*(b.close-ema)>-2*atr;
  const long=pass(1),short=pass(-1);if(long===short)return null;
  const side=long?"LONG":"SHORT",sg=long?1:-1;
  return {side,signalOpenTime:b.openTime,signalCloseTime:b.closeTime,signalClose:b.close,atr14:atr,rvol,delta,flow5:NaN,flow15:NaN,trend15:NaN,trend60:ret,setupType:"TREND_PULLBACK",regime:long?"TREND_UP":"TREND_DOWN",phase:long?"TREND_UP_CONTINUATION":"TREND_DOWN_CONTINUATION",stopAtr:FLOW_STOP_ATR,targetR:FLOW_TARGET_R,maxHoldMs:FLOW_MAX_HOLD_MS,flowRank:rank,flow3h:f3,ema12:ema,relativeVolume:rvol,evidence:{closeQuality:sg===1?loc:1-loc,flow3:NaN,flow5:NaN,flow15:NaN,trend15:NaN,trend60:ret,rvol,priorImpulsePct:ret3,reason:"FLOW_PRICE_DIVERGENCE_1H"}};
}
export function flowCostGate(entry:number,dist:number,spread:number,fee:number,slip:number){
  return [entry,dist,spread,fee,slip].every(Number.isFinite)&&entry>0&&dist>0&&spread>=0&&fee>=0&&slip>=0&&dist/entry<=.08&&(spread+2*(fee+slip))*entry/dist<=.28;
}
export function flowExitPlan(entry:number,dist:number,side:"LONG"|"SHORT"){
  const sign=side==="LONG"?1:-1;return {stop:entry-sign*dist,target:entry+sign*FLOW_TARGET_R*dist,targetR:FLOW_TARGET_R};
}
