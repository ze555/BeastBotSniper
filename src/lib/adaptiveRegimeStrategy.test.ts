import assert from "node:assert/strict";
import { evaluateAdaptiveSignal, assessOrderBook, adaptiveStopCandidate,ADAPTIVE_STRATEGY_ID } from "./adaptiveRegimeStrategy.js";
function candles(side:"LONG"|"SHORT"){
  const dir=side==="LONG"?1:-1,epoch=Date.parse("2026-11-22T12:00:00Z");
  return Array.from({length:80},(_,i)=>{
    const close=100+dir*0.04*i;
    return {openTime:epoch+i*60_000,closeTime:epoch+(i+1)*60_000-1,open:close-dir*0.02,
      high:close+0.06,low:close-0.06,close,quoteVolume:1000,takerBuyQuote:side==="LONG"?590:410};
  });
}
for(const side of ["LONG","SHORT"] as const){
  const rows=candles(side),last=rows[79],dir=side==="LONG"?1:-1;
  rows[79]={...last,open:last.open,close:last.close+dir*0.14,
    high:side==="LONG"?last.close+0.16:last.close+0.06,
    low:side==="LONG"?last.close-0.06:last.close-0.16,
    quoteVolume:2600,takerBuyQuote:side==="LONG"?2150:450};
  const sig=evaluateAdaptiveSignal(rows,rows[79].closeTime+1000);
  assert.equal(sig?.side,side);
  assert(["TREND_CONTINUATION","VOLATILITY_BREAKOUT"].includes(sig?.setupType||""));
  assert.equal(evaluateAdaptiveSignal(rows,rows[79].closeTime+100_000),null);
  const bad=rows.map(b=>({...b}));bad[76].openTime+=1000;
  assert.equal(evaluateAdaptiveSignal(bad,rows[79].closeTime+1000),null);
}
const depth=assessOrderBook("LONG",[["100","100"],["99","100"]],[["100.1","100"],["101","100"]]);
assert.equal(depth.allowed,true);
assert.equal(assessOrderBook("LONG",[["100","1"]],[["101","1"]]).allowed,false);
assert.equal(assessOrderBook("SHORT",[["100","100"]],[["100.1","1"]]).allowed,false);
assert.equal(adaptiveStopCandidate("LONG",100,2,0.5,"TREND_CONTINUATION"),null);
assert.equal(adaptiveStopCandidate("LONG",100,2,1.8,"TREND_CONTINUATION"),101.4);
assert.equal(adaptiveStopCandidate("SHORT",100,2,1.8,"TREND_CONTINUATION"),98.6);
assert(ADAPTIVE_STRATEGY_ID.includes("ADAPTIVE"));
console.log("Adaptive strategy: trend directions, closed bar integrity, real depth checks and profit protection passed");
