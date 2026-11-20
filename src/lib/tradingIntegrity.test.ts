import assert from "node:assert/strict";
import axios from "axios";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
process.env.BEAST_RESEARCH_DIR = mkdtempSync(join(tmpdir(), "beast-strongflow-integrity-"));
const api = await import("./apexPredator.js");
const {STRONG_FLOW_STRATEGY_ID} = await import("./strongFlowStrategy.js");
const {validQuote,closedCandles} = await import("./tradingIntegrity.js");
const now = Date.now();
assert(validQuote({bid:100,ask:100.01,time:now},now));
assert(!validQuote({bid:100,ask:100.01,time:now-6000},now));
assert.equal(closedCandles([{closeTime:now-1},{closeTime:now}],now).length,1);
assert.equal(api.getStats().strategyRevision,STRONG_FLOW_STRATEGY_ID);
assert.equal(api.getStats().strategyMode,"PB_STRONG_FLOW_FIXED2_ONLY");
assert.equal(api.isActive(),false);
assert.equal(api.getTrades().length,0);
function trade(symbol:string,side:"LONG"|"SHORT",entryTime=now):any {
  const sign = side==="LONG"?1:-1;
  return {symbol, direction:side, entry:100, sl:100-sign*10, initialSlDist:10,
    pos:1,initialPos:1,tp1:100+sign*20,tp2:100+sign*20,tp3:100+sign*20,
    strategyRevision:STRONG_FLOW_STRATEGY_ID,executionMode:"PAPER",setupType:"PB_STRONG_FLOW",
    entryTime:new Date(entryTime).toISOString(),peak_r:0,part_a:1,part_b:0,part_c:0,
    a_closed:false,b_closed:false,c_closed:false,grade:"GRADE_A",score:0,
    priceData:{rvol:2,flow5:.1,flow15:.04},reasoning:{flow:{state:"STRONG_FLOW_1M"},timingGate:{state:"CONFIRMED"}}};
}
for(const side of ["LONG","SHORT"] as const) {
  const sign=side==="LONG"?1:-1,t=trade("TEST"+side+"USDT",side);
  api.getTrades().push(t);
  api.protectTradeAtPrice(t,100+sign*10,Date.now());
  assert.equal(api.getTrades().includes(t),true,"No partial or trailing at +1R");
  assert.equal(t.pos,1);
  api.protectTradeAtPrice(t,100+sign*20,Date.now());
  assert.equal(api.getTrades().includes(t),false,"Full exit at +2R");
  assert.equal(t.pos,0);
}
const stop=trade("STOPUSDT","LONG");api.getTrades().push(stop);
api.protectTradeAtPrice(stop,90,Date.now());
assert.equal(api.getTrades().includes(stop),false,"Full stop at -1R");
const legacy=trade("LEGACYUSDT","LONG");legacy.strategyRevision="main-wave-integrity-v1";api.getTrades().push(legacy);
api.protectTradeAtPrice(legacy,110,Date.now());
assert.equal(legacy.pos,1,"Legacy exit engine is absent");
api.resetAccountState();
assert.equal(api.getTrades().length,0,"Reset clears all positions");
assert.equal(api.getClosedTrades().length,0,"Reset clears in-memory trade history");
assert.equal(api.isActive(),false,"Reset leaves the bot paused");
// A failed quote must not cause a fabricated fill.
const failed=trade("BADUSDT","LONG");api.getTrades().push(failed);
const original=axios.get;
axios.get=(async()=>{throw Error("timeout")}) as any;
try{await api.runProtectionCycle()}finally{axios.get=original}
assert.equal(api.getTrades().includes(failed),true);
assert(api.getStats().diagnostics.quoteErrors>0);
api.resetAccountState();
console.log("Strong Flow exclusive engine: 2R targets, fixed stops, no partial exits, empty startup/reset, isolated quote failure passed");
