import assert from "node:assert/strict";
import axios from "axios";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {closedCandles,validQuote,waveEvidence} from "./tradingIntegrity.js";
import {ADAPTIVE_STRATEGY_ID} from "./adaptiveRegimeStrategy.js";
import {FLEX_REVISION} from "./flexInstitutional15m.js";
import {DIRECTION_REVISION} from "./directionConfirmation.js";
import {FLOW_REVISION} from "./flowDivergence.js";
process.env.BEAST_RESEARCH_DIR=mkdtempSync(join(tmpdir(),"beast-fixed2-test-"));
const {getTrades,getClosedTrades,getStats,protectTradeAtPrice,runProtectionCycle,isActive,resetAccountState,restoreEngineState,engineStateSnapshot,mayStageFollowupSignal}=await import("./apexPredator.js");
assert.equal(getStats().strategyMode,"FLOW_PRICE_DIVERGENCE_1H");
assert.equal(getStats().strategyRevision,FLOW_REVISION);
assert.equal(getStats().legacyEnginesEnabled,false);
assert.equal(getStats().executionMode,"PAPER");
// Signal replacement never flips directly: it stages ONLY a later independent signal.
assert.equal(mayStageFollowupSignal(null,1000,false),true,"initial candidate staged");
assert.equal(mayStageFollowupSignal(1000,1060,false),true,"fresh resolved candidate not lost");
assert.equal(mayStageFollowupSignal(1000,1000,false),false,"same candle must not replay");
assert.equal(mayStageFollowupSignal(1000,900,false),false,"stale signal must not replay");
assert.equal(mayStageFollowupSignal(1000,1060,true),false,"pending signal must keep its slot");
assert.equal(mayStageFollowupSignal(null,null,false),false,"no candidate means no entry");
// New strategy revision must not erase account daily losses or historical ledger.
const originalState=structuredClone(engineStateSnapshot());
const oldTrade={symbol:"OLDUSDT",strategyRevision:"ADAPTIVE_REGIME_ORDERFLOW_V3_ANTI_EXHAUSTION_R1_LOCK",
  finalPnl:-38.17589132191527,profitR:-10,exitTime:new Date().toISOString()};
const v4Trade={symbol:"V4TESTUSDT",strategyRevision:"BIDIRECTIONAL_REGIME_REVERSAL_V4_PAPER",
  finalPnl:-0.5,profitR:-0.2,exitTime:new Date().toISOString()};
const priorState={...originalState,virtualBalance:961.3241086780848,
  closedTrades:[oldTrade,v4Trade],today:{count:2,wins:0,losses:2,pnl:-38.67589132191527,sumR:-10.2}} as any;
delete priorState.todayRiskStrategyRevision; // simulated pre-fix Railway snapshot.
restoreEngineState(priorState);
assert.equal(getStats().today.count,2,"preserve account daily count");
assert.equal(getStats().today.pnl,priorState.today.pnl,"preserve existing daily loss cap");
assert.equal(getStats().balance,priorState.virtualBalance,"account cash must not reset");
assert.equal(getClosedTrades().length,2,"legacy ledger preserved");
assert.equal(getStats().strategyPerformance.legacyClosedCount,2);
assert.equal(getStats().strategyPerformance.v4ClosedCount,0);
assert(Math.abs(getStats().entryReadiness.dailyRiskBudget-(40+priorState.today.pnl))<1e-8,"daily risk budget reflects all account losses");
assert.equal(getStats().entryReadiness.canOpenTrade,false,"strategy change must not bypass account loss cap");
const restored=engineStateSnapshot();
assert.equal(restored.todayRiskStrategyRevision,FLOW_REVISION);
restoreEngineState(restored);
assert.equal(getStats().today.pnl,priorState.today.pnl,"daily accounting idempotent after restart");
const riskLocked={...restored,today:{...restored.today,pnl:-39}} as any;
restoreEngineState(riskLocked);
assert.equal(getStats().entryReadiness.canOpenTrade,false);
assert(getStats().entryReadiness.blockedReasons.includes("INSUFFICIENT_RISK_BUDGET"),
  "V4 losses must still enforce minimum risk budget");
restoreEngineState(originalState);
assert.equal(getClosedTrades().length,0,"fixture cleanup");
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
// V4-only early giveback protection: real trade lifecycle, both directions.
for(const side of ["LONG","SHORT"] as const){
  const sign=side==="LONG"?1:-1;
  const t:any=mk("EARLYGUARD"+side+"USDT",side);
  t.strategyRevision="BIDIRECTIONAL_REGIME_REVERSAL_V4_PAPER";
  getTrades().push(t);
  protectTradeAtPrice(t,100+sign*5,Date.now());
  assert.equal(t.sl,100-sign*10,"no early lock before +0.60R");
  protectTradeAtPrice(t,100+sign*6,Date.now());
  assert(Math.abs(t.sl-(100+sign*1))<1e-8,"V4 +0.6R arms +0.1R floor");
  protectTradeAtPrice(t,100+sign*.5,Date.now());
  assert(!getTrades().includes(t),"V4 early guard must close a genuine giveback");
  assert(t.finalPnl>0,"modest net profit remains after estimated fees for timely observed quote");
  assert.equal(t.exitReason,"ADAPTIVE Protected Stop");
}
// Breakout winners retain their original wide trailing to avoid premature exits.
{
  const t:any=mk("BREAKOUTRUNNERUSDT","LONG");
  t.strategyRevision="BIDIRECTIONAL_REGIME_REVERSAL_V4_PAPER";
  t.setupType="VOLATILITY_BREAKOUT";
  getTrades().push(t);
  protectTradeAtPrice(t,106,Date.now());
  assert.equal(t.sl,90,"do not add early stop to genuine breakout");
  getTrades().splice(getTrades().indexOf(t),1);
}
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
// New direction-confirmed positions use a single 1.2R exit; legacy positions retain their original behavior.
for(const side of ["LONG","SHORT"] as const){
  const sign=side==="LONG"?1:-1,t:any=mk("DIRECTION"+side+"USDT",side);
  t.strategyRevision=DIRECTION_REVISION;t.targetR=1.2;t.setupType="VOLATILITY_BREAKOUT";
  getTrades().push(t);protectTradeAtPrice(t,100+sign*11,Date.now());
  assert(getTrades().includes(t));assert.equal(t.sl,100-sign*10);
  protectTradeAtPrice(t,100+sign*12,Date.now());
  assert(!getTrades().includes(t));assert.equal(t.exitReason,"ADAPTIVE Regime Target");assert(t.finalPnl>0);
}
// New Flow positions must never inherit old stop tightening or partial exits.
for(const side of ["LONG","SHORT"] as const){
  const sign=side==="LONG"?1:-1,t:any=mk("FLOW"+side+"USDT",side);
  t.strategyRevision=FLOW_REVISION;t.targetR=1.2;t.maxHoldMs=240*60000;
  getTrades().push(t);protectTradeAtPrice(t,100+sign*11,Date.now());
  assert(getTrades().includes(t));assert.equal(t.sl,100-sign*10);assert.equal(t.pos,1);
  protectTradeAtPrice(t,100+sign*12,Date.now());
  assert(!getTrades().includes(t));assert.equal(t.exitReason,"ADAPTIVE Regime Target");
}
{
 const t:any=mk("FLOWTIMEUSDT","LONG");t.strategyRevision=FLOW_REVISION;t.targetR=1.2;t.maxHoldMs=240*60000;t.entryTime=new Date(Date.now()-241*60000).toISOString();
 getTrades().push(t);protectTradeAtPrice(t,100,Date.now());assert(!getTrades().includes(t));assert.equal(t.exitReason,"ADAPTIVE Time Exit");
}
// Legacy FLEX positions keep their original fixed exits.
for(const side of ["LONG","SHORT"] as const){
  const sign=side==="LONG"?1:-1,t:any=mk("FLEX"+side+"USDT",side);
  t.strategyRevision=FLEX_REVISION;t.targetR=3;t.setupType="VOLATILITY_BREAKOUT";
  getTrades().push(t);
  protectTradeAtPrice(t,100+sign*20,Date.now());
  assert.equal(t.sl,100-sign*10,"FLEX 2R does not change original stop");
  assert(getTrades().includes(t));
  protectTradeAtPrice(t,100+sign*30,Date.now());
  assert(!getTrades().includes(t));assert.equal(t.exitReason,"ADAPTIVE Regime Target");
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
