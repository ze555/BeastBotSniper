import assert from "node:assert/strict";
import {liveBreakoutEntryDecision} from "./websocketDecision.js";
import {USD_M_MARKET_WS,decodeAggTrade,recordMarketFrame,institutionalHealth,syncInstitutionalSymbols} from "./institutionalMarketFeed.js";
import {getStats,updateConfig} from "./apexPredator.js";

const now=Date.parse("2026-11-22T20:00:00Z");
assert.equal(USD_M_MARKET_WS,"wss://fstream.binance.com/market/stream");
const buy={e:"aggTrade",s:"BTCUSDT",T:now-1000,p:"90000.0",q:"0.1",m:false};
const sell={...buy,m:true};
assert.deepEqual(decodeAggTrade(buy,now),{symbol:"BTCUSDT",at:now-1000,notional:9000,signed:9000});
assert.deepEqual(decodeAggTrade(sell,now),{symbol:"BTCUSDT",at:now-1000,notional:9000,signed:-9000});
assert.equal(decodeAggTrade({...buy,T:now-20000},now),null);
assert.equal(decodeAggTrade({...buy,m:"false"},now),null);
assert.equal(decodeAggTrade({...buy,p:"0"},now),null);
assert.equal(decodeAggTrade({...buy,s:""},now),null);
const sample={delta:.25,notional:9000,count:44,asOf:now-1000,complete:true};
for(const side of ["LONG","SHORT"] as const){
  // Turning the option OFF must restore original entry acceptance.
  assert.equal(liveBreakoutEntryDecision(false,"VOLATILITY_BREAKOUT",side,null,now).allowed,true);
  // Existing TREND_CONTINUATION/PULLBACK/RANGE entries remain fully unchanged.
  for(const setup of ["TREND_CONTINUATION","TREND_PULLBACK","RANGE_REVERSION"] as const){
    assert.equal(liveBreakoutEntryDecision(true,setup,side,null,now).allowed,true);
  }
  assert.equal(liveBreakoutEntryDecision(true,"VOLATILITY_BREAKOUT",side,null,now).reason,
    "WS_BREAKOUT_FLOW_UNAVAILABLE");
  assert.equal(liveBreakoutEntryDecision(true,"VOLATILITY_BREAKOUT",side,{...sample,asOf:now-30000},now).allowed,false);
  assert.equal(liveBreakoutEntryDecision(true,"VOLATILITY_BREAKOUT",side,{...sample,complete:false},now).allowed,false);
  const sameSide={...sample,delta:side==="LONG"?.25:-.25};
  const opposed={...sample,delta:side==="LONG"?-.25:.25};
  assert.equal(liveBreakoutEntryDecision(true,"VOLATILITY_BREAKOUT",side,sameSide,now).allowed,true);
  assert.equal(liveBreakoutEntryDecision(true,"VOLATILITY_BREAKOUT",side,opposed,now).reason,
    "WS_BREAKOUT_OPPOSING_EXECUTION");
}
assert.equal(getStats().liveWebsocketEnabled,true,"WS ON by default");
updateConfig(1000,10,{liveWebsocketEnabled:false});
assert.equal(getStats().liveWebsocketEnabled,false);
updateConfig(1000,10,{liveWebsocketEnabled:true});
assert.equal(getStats().liveWebsocketEnabled,true);
// Standalone acknowledgement counter proves control frames are recognized.
const before=institutionalHealth().subscriptionAcks;
recordMarketFrame({id:123,result:null},now);
assert.equal(institutionalHealth().subscriptionAcks,before+1);
syncInstitutionalSymbols([],false);
console.log("PASS: routed Binance market stream, signed aggTrades, stale validation, breakout-only ON/OFF, unchanged trend/pullback/range, and settings default.");
