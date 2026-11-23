import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {initializePersistence,restoreSnapshot,persistSnapshot,persistEvent,
  historicalEvents,flushPersistence,persistenceStatus,closePersistence,
  persistReplayEvent,replayEvents,replayCoverage,REPLAY_SCHEMA_VERSION} from "./durableStore.js";
import {engineStateSnapshot,restoreEngineState,getStats,getTrades,getClosedTrades} from "./apexPredator.js";

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
await closePersistence();
fs.rmSync(root,{recursive:true,force:true});
delete process.env.BEAST_PERSIST_DIR;
console.log("PASS: durable SQLite survives restart, restores PAPER positions/account/settings and paged immutable trading evidence; no trading strategy change");
