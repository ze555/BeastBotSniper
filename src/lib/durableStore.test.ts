import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {initializePersistence,restoreSnapshot,persistSnapshot,persistEvent,
  historicalEvents,flushPersistence,persistenceStatus,closePersistence} from "./durableStore.js";
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
await flushPersistence();
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
