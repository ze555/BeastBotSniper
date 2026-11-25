import assert from "node:assert/strict";
import axios from "axios";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {initializePersistence,restoreSnapshot,persistSnapshot,persistEvent,
  historicalEvents,flushPersistence,persistenceStatus,closePersistence,
  persistReplayEvent,replayEvents,replayCoverage,REPLAY_SCHEMA_VERSION,rotatePaperRun,listPaperRuns,getPaperRun} from "./durableStore.js";
import {engineStateSnapshot,restoreEngineState,getStats,getTrades,getClosedTrades,requestNewPaperRun,runApexLoop,protectTradeAtPrice,isActive,setActive} from "./apexPredator.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"beast-persistence-test-"));
process.env.BEAST_PERSIST_DIR=root;
assert.equal(await initializePersistence(),true);
const original=engineStateSnapshot(),now=new Date().toISOString();
const active={
 symbol:"RESTORELONGUSDT",direction:"LONG",entry:100,sl:97,pos:1,
 initialPos:1,initialSlDist:3,tp1:112,tp2:112,tp3:112,
 setupType:"TREND_CONTINUATION",targetR:4,profitR:1.05,peak_r:1.05,
 entryTime:now,currentPrice:103.15,highestPrice:103.15,lowestPrice:100,
 pnl:3,realizedPnl:0,totalFees:0
};
const finished={...active,symbol:"RESTOREDONEUSDT",pos:0,finalPnl:3.25,exitTime:now};
const payload={...original,virtualBalance:937.31,balance:937.31,initialVirtualBalance:1000,
 activeTrades:[active],closedTrades:[finished],today:{count:1,wins:1,losses:0,pnl:3.25,sumR:1},
 liveWebsocketEnabled:false,feeRate:.0004,slippageRate:.0002,
 lastSignalTime:[["RESTORELONGUSDT",Date.now()-60000]],pendingSignals:[],
 cooldownUntil:[["RESTOREDONEUSDT",Date.now()+300000]]};
persistSnapshot(payload);
persistEvent("trading_decisions",{trade_id:"RESTOREDONEUSDT",timestamp:now,finalPnl:3.25},"V3");
persistEvent("institutional_evidence",{trade_id:"RESTORELONGUSDT",timestamp:now,flow:.27},"V3");
const tradeId="RESTORELONGUSDT_"+Date.parse(now);
persistReplayEvent("signal_candidate",{symbol:"RESTORELONGUSDT",revision:"V2",sourceMs:Date.parse(now)-60000,
  data:{signal:{side:"LONG"},bars:Array.from({length:85},(_,i)=>({openTime:i*60000,close:100+i/100}))}});
persistReplayEvent("entry_book_oi",{symbol:"RESTORELONGUSDT",revision:"V3",sourceMs:Date.parse(now)-10000,
  data:{rawDepth:{bids:[["99.9","100"]],asks:[["100.1","100"]]},
    rawOiHistory:[{sumOpenInterest:"1234",timestamp:Date.parse(now)-300000}]}});
persistReplayEvent("paper_trade_open",{symbol:"RESTORELONGUSDT",tradeId,revision:"V3",
  sourceMs:Date.parse(now),data:{trade:active}});
persistReplayEvent("market_flow_10s",{symbol:"RESTORELONGUSDT",revision:"BINANCE",
  sourceMs:Date.parse(now)+10000,data:{buyNotional:450,sellNotional:320,count:20}});
persistReplayEvent("price_quote",{symbol:"RESTORELONGUSDT",tradeId,revision:"V3",
  sourceMs:Date.parse(now)+15000,data:{price:102.45,stopBefore:97}});
persistReplayEvent("paper_trade_close",{symbol:"RESTOREDONEUSDT",revision:"V3",
  data:{trade:finished,finalPnl:3.25}});
await flushPersistence();
const first=await replayEvents({symbol:"RESTORELONGUSDT",limit:2});
assert.equal(first.events.length,2);
assert.equal(first.events[0].kind,"signal_candidate");
assert.equal(first.events[0].schemaVersion,REPLAY_SCHEMA_VERSION);
assert.equal(first.events[0].data.bars.length,85,"full 1m bars not truncated");
assert.equal(first.hasMore,true);
const second=await replayEvents({symbol:"RESTORELONGUSDT",afterId:first.nextCursor!,limit:10});
assert.equal(second.events.length,3);
assert.equal(second.events.at(-1)?.kind,"price_quote");
assert.equal(second.hasMore,false);
const byTrade=await replayEvents({tradeId});
assert.deepEqual(byTrade.events.map(x=>x.kind),["paper_trade_open","price_quote"]);
assert.equal((await replayCoverage()).total,6);
let state=await restoreSnapshot();
assert.equal(state?.balance,937.31);
assert.equal(state?.activeTrades.length,1);
assert.equal(state?.closedTrades[0].finalPnl,3.25);
assert.equal((await historicalEvents("trading_decisions")).total,1);
assert.equal((await historicalEvents("institutional_evidence")).events[0]?.data.flow,.27);
assert.equal(persistenceStatus().enabled,true);
await closePersistence();
// The same database MUST survive a full connection close and reopen.
assert.equal(await initializePersistence(),true);
state=await restoreSnapshot();
assert.equal(state?.balance,937.31);
assert.equal(state?.activeTrades[0]?.sl,97);
assert.equal((await historicalEvents("trading_decisions")).total,1);
const persisted=await replayEvents({kind:"entry_book_oi"});
assert.equal(persisted.events[0]?.data.rawDepth.bids[0][0],"99.9");
assert.equal(persisted.events[0]?.revision,"V3");
assert.equal((await replayCoverage()).total,6);
restoreEngineState(state);
assert.equal(getStats().balance,937.31);
assert.equal(getStats().liveWebsocketEnabled,false);
assert.equal(getTrades().length,1);
assert.equal(getTrades()[0].sl,97);
assert.equal(getClosedTrades()[0].finalPnl,3.25);
restoreEngineState(original);
const old={...payload,runId:"test-old",activeTrades:[]};
const fresh={...original,runId:"test-new",runStartedAt:now,runRevision:"NEW",balance:1000,virtualBalance:1000,activeTrades:[],closedTrades:[],today:{count:0,wins:0,losses:0,pnl:0,sumR:0}};
await rotatePaperRun(old,fresh);
assert.equal((await listPaperRuns()).length,1);
assert.equal((await getPaperRun("test-old"))?.closedTrades[0].finalPnl,3.25);
assert.equal((await restoreSnapshot())?.runId,"test-new");
assert.equal((await restoreSnapshot())?.closedTrades.length,0);
assert.equal((await restoreSnapshot())?.replayStartId,6);
assert.equal((await replayEvents({kind:"paper_trade_close",throughId:(await getPaperRun("test-old"))?.replayEndId})).events.length,1);
await assert.rejects(()=>rotatePaperRun(old,{...fresh,balance:1}));
assert.equal((await restoreSnapshot())?.balance,1000,"duplicate archive rolls back state");
await closePersistence();
await initializePersistence();
assert.equal((await restoreSnapshot())?.runId,"test-new");
assert.equal((await historicalEvents("trading_decisions")).total,1,"historical research remains intact");
// Real manual close/reset lifecycle against a temporary SQLite database.
const manual={...fresh,runId:"manual-old",runTotals:{count:0,wins:0,losses:0,breakeven:0,fees:0,pnl:0},active:true,activeTrades:[{...active,symbol:"MANUALUSDT"}],closedTrades:[]};
restoreEngineState(manual);
const originalGet=axios.get;
axios.get=(async()=>{throw Error("quote unavailable")}) as any;
try{
  const result=await requestNewPaperRun("manual-old",true);
  assert.equal(result.pending,true);assert.equal(isActive(),false);assert.equal(getTrades().length,1);
  setActive(true);assert.equal(isActive(),false,"manual reset cannot be resumed early");
  protectTradeAtPrice(getTrades()[0],104,Date.now()-10000);assert.equal(getTrades().length,1,"never close at stale quote");
  await assert.rejects(()=>requestNewPaperRun("wrong-id",true));
  protectTradeAtPrice(getTrades()[0],104,Date.now());assert.equal(getTrades().length,0);
  await runApexLoop();
  const archived=await getPaperRun("manual-old");
  assert.equal(archived.closedTrades.length,1);assert.equal(archived.closedTrades[0].exitReason,"PAPER Manual Archive Reset");
  assert(archived.closedTrades[0].finalPnl>0);assert.equal(archived.activeTrades.length,0);
  assert.equal(getStats().balance,1000);assert.equal(getClosedTrades().length,0);assert.equal(getStats().today.count,0);assert.equal(isActive(),false);
  assert.equal((await restoreSnapshot()).manualCloseReset,false);assert.equal((await restoreSnapshot()).active,false);
  setActive(true);assert.equal(isActive(),true);
}finally{axios.get=originalGet;}
await closePersistence();
fs.rmSync(root,{recursive:true,force:true});
delete process.env.BEAST_PERSIST_DIR;
console.log("PASS: durable SQLite survives restart, restores PAPER positions/account/settings and paged immutable trading evidence; no trading strategy change");
