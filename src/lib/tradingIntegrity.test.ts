import assert from "node:assert/strict";
import axios from "axios";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {closedCandles,validQuote,waveEvidence} from "./tradingIntegrity.js";
import {ADAPTIVE_STRATEGY_ID} from "./adaptiveRegimeStrategy.js";
process.env.BEAST_RESEARCH_DIR=mkdtempSync(join(tmpdir(),"beast-fixed2-test-"));
const {getTrades,getClosedTrades,getStats,protectTradeAtPrice,runProtectionCycle,isActive,resetAccountState}=await import("./apexPredator.js");
assert.equal(getStats().strategyMode,"ADAPTIVE_VERIFIED_ENTRY_V2");
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
  return {symbol,direction,strategyRevision:ADAPTIVE_STRATEGY_ID,setupType:"TREND_CONTINUATION",targetR:3.5,maxHoldMs:180*60_000,entry:100,sl:100-sign*10,
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
  assert(getTrades().includes(t),"early winner must remain active");
  assert.equal(t.pos,1,"no legacy partial take profit");
  assert.equal(t.a_closed,false,"legacy TP1 must never fire");
  assert.equal(t.sl,100-sign*10,"protective trailing must not activate too early");
  protectTradeAtPrice(t,100-sign*12,Date.now()-10000);
  assert(getTrades().includes(t),"stale quote ignored");
  protectTradeAtPrice(t,100+sign*20,Date.now());
  assert(getTrades().includes(t),"trend runner should survive initial 2R move");
  assert.equal(t.sl,100+sign*7,"winning position locks 0.7R after 1.75R MFE");
  protectTradeAtPrice(t,100+sign*40,Date.now());
  assert(!getTrades().includes(t),"adaptive target exits the full position");
  assert.equal(t.pos,0);
  assert.equal(t.exitReason,"ADAPTIVE Regime Target");
  const count=getClosedTrades().length,bal=getStats().balance;
  protectTradeAtPrice(t,100+sign*20,Date.now());
  assert.equal(getClosedTrades().length,count,"close idempotency");
  assert.equal(getStats().balance,bal,"no double-counted profit");
}
for(const side of ["LONG","SHORT"] as const){
  const sign=side==="LONG"?1:-1;
  const t:any=mk("R1LOCK"+side+"USDT",side);
  getTrades().push(t);
  protectTradeAtPrice(t,100+sign*8,Date.now());
  assert.equal(t.sl,100-sign*10,"no protection below +1R");
  protectTradeAtPrice(t,100+sign*10.5,Date.now());
  assert(Math.abs(t.sl-(100+sign*3))<1e-8,"lock +0.30R after crossing +1R");
  protectTradeAtPrice(t,100+sign*2,Date.now());
  assert(!getTrades().includes(t),"protective stop closes instead of giving back to loss");
  assert(t.finalPnl>0,"profit lock pays net fees on a timely observed quote");
  assert.equal(t.exitReason,"ADAPTIVE Protected Stop");
}
const loss:any=mk("NEWLOSSUSDT","LONG");
getTrades().push(loss);
protectTradeAtPrice(loss,89,Date.now());
assert(!getTrades().includes(loss),"stop exits at first observed crossed quote");
assert.equal(loss.exitReason,"ADAPTIVE Stop Loss");
assert.equal(isActive(),true,"PAPER starts automatically");
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
console.log("ADAPTIVE PAPER: trend trailing, full targets, stops, stale quotes, idempotent close and safe reset passed");
