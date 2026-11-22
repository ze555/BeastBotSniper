import assert from "node:assert/strict";
import {evaluateReversal,type MarketContext} from "./institutionalReversal.js";
import type {StrongFlowBar} from "./strongFlowStrategy.js";
import {institutionalSnapshot,syncInstitutionalSymbols,institutionalHealth} from "./institutionalMarketFeed.js";
const now=Date.parse("2026-11-22T12:15:10.000Z");
function bars(side:"LONG"|"SHORT",opposing=true):StrongFlowBar[]{
  const sign=side==="LONG"?1:-1;
  return Array.from({length:5},(_,i)=>{
    const close=100+sign*(.45-.13*i);
    const q=2000,taker=opposing?(side==="LONG"?600:1400):(side==="LONG"?1400:600);
    return {openTime:now-5*60000+i*60000,closeTime:now-4*60000+i*60000-1,
      open:close+.01,close,low:close-.01,high:close+.01,quoteVolume:q,takerBuyQuote:taker};
  });
}
function data(side:"LONG"|"SHORT"):MarketContext{
  const sign=side==="LONG"?1:-1;
  return {at:now,
    agg:{delta:-sign*.35,notional:2500,count:12,asOf:now-1500,complete:true},
    book:{imbalance:-sign*.45,spread:.0005,depth:60000,at:now-4000},
    taker:{ratio:side==="LONG"?.75:1.35,at:now-7*60000},
    oi:{delta:-.004,time:now-7*60000},
    topTraders:{longShare:.56,at:now-7*60000},liquidations:null};
}
for(const side of ["LONG","SHORT"] as const){
  const sign=side==="LONG"?1:-1;
  const pos={entry:100+sign*.4,price:100-sign*.08,initialSlDist:.5,peakR:.9,entryMs:now-5*60000};
  const m=data(side),seq=bars(side);
  const r=evaluateReversal(side,seq,m,pos,now);
  assert.equal(r.decision,"EXIT",side+" strong independent bearish evidence");
  assert.equal(r.confirmations.length,3);
  assert.equal(evaluateReversal(side,seq,{...m,agg:null,book:null},pos,now).decision,"WATCH",
    "a lone 5m taker ratio must never exit a position");
  assert.equal(evaluateReversal(side,bars(side,false),m,pos,now).decision,"HOLD",
    "no exit without executed 3m flow reversal");
  assert.equal(evaluateReversal(side,seq,{...m,agg:{...m.agg!,complete:false},book:null},pos,now).decision,"WATCH",
    "untrusted partial WebSocket data cannot trigger exit");
  assert.equal(evaluateReversal(side,seq,m,{...pos,entryMs:now-10000},now).decision,"INSUFFICIENT_DATA",
    "never reverse a newly opened position on noise");
  assert.equal(evaluateReversal(side,seq,m,{...pos,peakR:0,price:pos.entry+sign*.05},now).decision,"WATCH",
    "do not cut a trade without material failure or profit giveback");
  assert.equal(evaluateReversal(side,seq,m,{...pos,price:pos.entry-sign*.28,peakR:0},now).decision,"EXIT",
    "multiple independent observations and material loss can justify exit");
  assert.equal(evaluateReversal(side,seq,m,pos,now+100000).decision,"INSUFFICIENT_DATA",
    "stale closed candles must never cause a new exit");
}
syncInstitutionalSymbols([]);
assert.equal(institutionalSnapshot("UNTRACKEDUSDT",now).agg,null);
assert.equal(institutionalHealth().trackedSymbols.length,0);
console.log("Institutional reversal: close-bar integrity, two independent corroborations, stale-data protection and winner safety passed");
