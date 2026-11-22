/**
 * Conservative, observable early-reversal detector for PAPER trades.
 * Requires closed price structure + executed 3m taker-flow reversal, supported
 * by at least TWO of: websocket aggTrade, observed resting book pressure,
 * and published Binance 5m taker buy/sell ratio. OI and top traders are
 * context only (not directional evidence). No hindsight or implied guarantees.
 */
import type { StrongFlowBar } from "./strongFlowStrategy.js";
export type PaperSide="LONG"|"SHORT";
export type LiveAggWindow={delta:number;notional:number;count:number;asOf:number;complete:boolean}|null;
export type MarketContext={
  at:number;
  agg:LiveAggWindow;
  book:{imbalance:number;depth:number;spread:number;at:number}|null;
  oi:{delta:number;time:number}|null;
  taker:{ratio:number;at:number}|null;
  topTraders:{longShare:number;at:number}|null;
  liquidations:{longNotional:number;shortNotional:number;asOf:number}|null;
};
export type ReversalWarning={
  decision:"INSUFFICIENT_DATA"|"HOLD"|"WATCH"|"EXIT";
  reason:string;
  evidenceCount:number;
  adverseFlow3m:number|null;
  structureBroken:boolean;
  confirmations:string[];
  timestamp:number;
  oiDelta:number|null;
  liveAggDelta:number|null;
  bookImbalance:number|null;
  takerRatio:number|null;
};
export function evaluateReversal(
  side:PaperSide,rows:StrongFlowBar[],live:MarketContext,position:{
    entry:number;initialSlDist:number;price:number;peakR:number;entryMs:number;
  },now=Date.now()
):ReversalWarning{
  const sign=side==="LONG"?1:-1;
  const make=(decision:ReversalWarning["decision"],reason:string,flow:number|null,broken:boolean,confirmations:string[]):ReversalWarning=>({
    decision,reason,evidenceCount:confirmations.length,adverseFlow3m:flow,structureBroken:broken,
    confirmations,timestamp:now,oiDelta:live.oi?.delta??null,
    liveAggDelta:live.agg?.delta??null,bookImbalance:live.book?.imbalance??null,
    takerRatio:live.taker?.ratio??null
  });
  if(!Number.isFinite(position.price)||!Number.isFinite(position.entry)||position.initialSlDist<=0||
     now-position.entryMs<120000)return make("INSUFFICIENT_DATA","POSITION_TOO_YOUNG",null,false,[]);
  if(rows.length<5)return make("INSUFFICIENT_DATA","INSUFFICIENT_BARS",null,false,[]);
  const c=rows.slice(-5);
  for(let i=0;i<c.length;i++){
    const b=c[i];
    if(!b||![b.openTime,b.closeTime,b.close,b.high,b.low,b.quoteVolume,b.takerBuyQuote].every(Number.isFinite)||
      b.quoteVolume<=0||b.takerBuyQuote<0||b.takerBuyQuote>b.quoteVolume||
      b.closeTime>=now || (i>0 && b.openTime-c[i-1].openTime!==60000))
      return make("INSUFFICIENT_DATA","GAPPED_OR_INVALID_CANDLES",null,false,[]);
  }
  if(now-c[4].closeTime>90000)return make("INSUFFICIENT_DATA","CANDLES_STALE",null,false,[]);
  const flowBars=c.slice(-3),quote=flowBars.reduce((s,b)=>s+b.quoteVolume,0);
  if(quote<=0)return make("INSUFFICIENT_DATA","FLOW_MISSING",null,false,[]);
  const flow3=flowBars.reduce((s,b)=>s+2*b.takerBuyQuote-b.quoteVolume,0)/quote;
  const closes=c.slice(0,-1).map(b=>b.close);
  const broken=side==="LONG"?c[4].close<Math.min(...closes):c[4].close>Math.max(...closes);
  const opposing=sign*flow3< -0.13;
  const confirms:string[]=[];
  const agg=live.agg;
  if(agg?.complete && now-agg.asOf<=12000&&agg.notional>=350&&agg.count>=5 && sign*agg.delta< -0.17)
    confirms.push("LIVE_AGG_TAKER_REVERSAL");
  const book=live.book;
  if(book && now-book.at<=45000 && book.depth>=10000 && book.spread<=.0025 &&
      sign*book.imbalance< -.23) confirms.push("RESTING_BOOK_OPPOSITION");
  const taker=live.taker;
  if(taker && now-taker.at<=13*60000&&taker.ratio>0 &&
    (side==="LONG"?taker.ratio<.86:taker.ratio>1.17))
    confirms.push("PUBLISHED_5M_TAKER_REVERSAL");
  if(!(broken && opposing))return make("HOLD","PRICE_AND_EXECUTED_FLOW_NOT_ALIGNED",flow3,broken,confirms);
  const profitR=sign*(position.price-position.entry)/position.initialSlDist;
  const givingBack=position.peakR>=.65 && position.peakR-profitR>=.55;
  const failingTrade=profitR<=-.42;
  if(confirms.length>=2 && (givingBack||failingTrade))
    return make("EXIT",givingBack?"CONFIRMED_PROFIT_GIVEBACK":"CONFIRMED_EARLY_FAILURE",flow3,broken,confirms);
  return make("WATCH",confirms.length<2?"AWAITING_INDEPENDENT_CONFIRMATIONS":"WAIT_FOR_MATERIAL_RISK",flow3,broken,confirms);
}
