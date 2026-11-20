import assert from "node:assert/strict";
import axios from "axios";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {closedCandles,validQuote,waveEvidence} from "./tradingIntegrity.js";
import {STRONG_FLOW_STRATEGY_ID} from "./strongFlowStrategy.js";
process.env.BEAST_RESEARCH_DIR=mkdtempSync(join(tmpdir(),"beast-fixed2-test-"));
const {getTrades,getClosedTrades,getStats,protectTradeAtPrice,runProtectionCycle,isActive,resetAccountState}=await import("./apexPredator.js");
assert.equal(getStats().strategyMode,"PB_STRONG_FLOW_FIXED_2R_ONLY");
assert.equal(getStats().legacyEnginesEnabled,false);
assert.equal(getStats().executionMode,"PAPER");
const now=Date.now();
assert(validQuote({bid:100,ask:100.02,time:now},now));
assert(!validQuote({bid:100,ask:100.02,time:now-6000},now));
assert.equal(closedCandles([{closeTime:now-1},{closeTime:now},{closeTime:now+1}],now).length,1);
const bars=[{close:100,closeTime:now-300001},{open:100,close:101,volume:100,takerBuy:65,takerSell:35,closeTime:now-1}];
assert(waveEvidence("LONG",bars,{bid:101,ask:101.02,time:now},1,0.0004,0.0002,now).allowed);
const mk=(symbol:string,direction:"LONG"|"SHORT")=>{
  const sign=direction==="LONG"?1:-1;
  return {symbol,direction,strategyRevision:STRONG_FLOW_STRATEGY_ID,entry:100,sl:100-sign*10,
    initialSlDist:10,tp1:100+sign*20,tp2:100+sign*20,tp3:100+sign*20,
    pos:1,initialPos:1,peak_r:0,pnl:0,realizedPnl:0,totalFees:0,
    part_a:1,part_b:0,part_c:0,a_closed:false,b_closed:false,
    entryTime:new Date(now).toISOString(),highestPrice:100,lowestPrice:100};
};
for(const side of ["LONG","SHORT"] as const){
  const sign=side==="LONG"?1:-1;
  const t:any=mk("NEW"+side+"USDT",side);
  getTrades().push(t);
  protectTradeAtPrice(t,100+sign*8,Date.now());
  assert(getTrades().includes(t),"sub-2R winner must remain active");
  assert.equal(t.pos,1,"no legacy partial take profit");
  assert.equal(t.a_closed,false,"legacy TP1 must never fire");
  assert.equal(t.sl,100-sign*10,"no legacy trailing stop");
  protectTradeAtPrice(t,100-sign*12,Date.now()-10000);
  assert(getTrades().includes(t),"stale quote ignored");
  protectTradeAtPrice(t,100+sign*20,Date.now());
  assert(!getTrades().includes(t),"fixed 2R exits the full position");
  assert.equal(t.pos,0);
  assert.equal(t.exitReason,"PB_STRONG_FLOW Fixed 2R Target");
  const count=getClosedTrades().length,bal=getStats().balance;
  protectTradeAtPrice(t,100+sign*20,Date.now());
  assert.equal(getClosedTrades().length,count,"close idempotency");
  assert.equal(getStats().balance,bal,"no double-counted profit");
}
const loss:any=mk("NEWLOSSUSDT","LONG");
getTrades().push(loss);
protectTradeAtPrice(loss,89,Date.now());
assert(!getTrades().includes(loss),"stop exits at first observed crossed quote");
assert.equal(loss.exitReason,"PB_STRONG_FLOW Stop Loss");
assert.equal(isActive(),false);
const pending:any=mk("PENDINGUSDT","LONG");
getTrades().push(pending);
assert.equal(resetAccountState(),false,"reset must not drop active positions");
const broken:any=mk("BROKENUSDT","LONG");getTrades().push(broken);
const original=axios.get;
axios.get=(async (_url:any,opts:any)=>{
  if(opts.params.symbol==="BROKENUSDT")throw Error("timeout");
  return {data:{symbol:"PENDINGUSDT",bidPrice:"89",askPrice:"89.10",time:Date.now()}};
}) as any;
try{await runProtectionCycle();}finally{axios.get=original;}
assert(getTrades().includes(broken),"failed quote must not fabricate exit");
assert(!getTrades().includes(pending),"price protection runs even when bot inactive");
assert(getStats().diagnostics.quoteErrors>0);
getTrades().splice(getTrades().indexOf(broken),1);
console.log("PB_STRONG_FLOW ONLY: full 2R long/short, no partials/trailing, hard SL, stale quote, idempotent close, safe reset, paused-bot protection passed");
