import assert from "node:assert/strict";
import {confirmNextClosedMinute,confirmEntryContext,parseOpenInterestHistory,verifyExecutableEntry,completeTimeframeBars} from "./entryValidation.js";
import type {AdaptiveSignal} from "./adaptiveRegimeStrategy.js";
import type {StrongFlowBar} from "./strongFlowStrategy.js";
const epoch=Date.parse("2026-11-22T09:00:00Z"),n=90;
function makeBars(side:"LONG"|"SHORT"):StrongFlowBar[]{
  const d=side==="LONG"?1:-1;
  return Array.from({length:n},(_,i)=>{
    const close=100+d*i*.01;
    return {openTime:epoch+i*60000,closeTime:epoch+(i+1)*60000-1,
      open:close-d*.005,close,high:close+.03,low:close-.03,
      quoteVolume:2000,takerBuyQuote:side==="LONG"?1350:650};
  });
}
const now=epoch+n*60000+1500;
function signal(side:"LONG"|"SHORT"):AdaptiveSignal{
  const rows=makeBars(side),base=rows[n-2],d=side==="LONG"?1:-1;
  return {side,signalOpenTime:base.openTime,signalCloseTime:base.closeTime,signalClose:base.close,
    atr14:.35,rvol:1.9,delta:side==="LONG"?.35:-.35,flow5:side==="LONG"?.2:-.2,
    flow15:side==="LONG"?.2:-.2,trend15:d*.008,trend60:d*.013,
    regime:side==="LONG"?"TREND_UP":"TREND_DOWN",
    setupType:"TREND_CONTINUATION",stopAtr:2,targetR:4,maxHoldMs:180*60000};
}
for(const side of ["LONG","SHORT"] as const){
  const rows=makeBars(side),s=signal(side),d=side==="LONG"?1:-1;
  assert.equal(completeTimeframeBars(rows,5).length,18);
  assert.equal(completeTimeframeBars(rows,15).length,6);
  assert.equal(confirmNextClosedMinute(s,rows,now).allowed,true);
  assert.equal(confirmEntryContext(s,rows,now).allowed,true);
  const center=rows.at(-1)!.close;
  const quote={bid:center-.005,ask:center+.005,time:now-250};
  const depth={allowed:true,reason:"REAL_DEPTH_CONFIRMED",imbalance:d*.21,spread:.0001,
    depthNotional:50000,bestBid:quote.bid,bestAsk:quote.ask,time:now-500};
  const oi={delta:.004,timestamp:now-6*60000,previousTimestamp:now-11*60000};
  assert.equal(verifyExecutableEntry(s,rows,quote,depth,oi,.0004,.0002,now).allowed,true,"valid "+side+" evidence");
  assert.equal(verifyExecutableEntry(s,rows,quote,depth,null,.0004,.0002,now).reason,"OPEN_INTEREST_HISTORY_UNAVAILABLE");
  assert.equal(verifyExecutableEntry(s,rows,quote,depth,{...oi,delta:-.016},.0004,.0002,now).reason,"OPEN_INTEREST_SHOCK");
  assert.equal(verifyExecutableEntry(s,rows,{...quote,time:now-6000},depth,oi,.0004,.0002,now).reason,"EXECUTION_QUOTE_STALE");
  assert.equal(verifyExecutableEntry(s,rows,quote,{...depth,depthNotional:500},oi,.0004,.0002,now).reason,"ENTRY_DEPTH_TOO_THIN");
  assert.equal(verifyExecutableEntry(s,rows,quote,{...depth,imbalance:-d*.4},oi,.0004,.0002,now).reason,"ENTRY_OPPOSING_LIQUIDITY");
  assert.equal(verifyExecutableEntry(s,rows,quote,{...depth,time:now-8000},oi,.0004,.0002,now).reason,"ORDERBOOK_STALE");
  assert.equal(verifyExecutableEntry(s,rows,{...quote,ask:quote.ask+.5},depth,oi,.0004,.0002,now).allowed,false);
  const bad=rows.map(x=>({...x}));
  bad[n-1].takerBuyQuote=side==="LONG"?200:1800;
  assert.equal(confirmNextClosedMinute(s,bad,now).reason,"FOLLOW_THROUGH_FLOW_REVERSED");
  const stale=confirmNextClosedMinute(s,rows,now+100000);
  assert.equal(stale.allowed,false);
  const same=rows.slice(0,-1);
  assert.equal(confirmNextClosedMinute(s,same,now).reason,"FOLLOW_THROUGH_NOT_CONSECUTIVE");
  const overextended={...s,trend60:d*.053};
  assert.equal(confirmEntryContext(overextended,rows,now).reason,"LATE_TREND_EXHAUSTION");
}
const range={...signal("LONG"),setupType:"RANGE_REVERSION" as const,regime:"RANGE" as const};
const rowRange=makeBars("LONG");
assert.equal(confirmEntryContext(range,rowRange,now).allowed,true);
const q={bid:100.885,ask:100.895,time:now-200},oi={delta:.005,timestamp:now-6*60000,previousTimestamp:now-11*60000};
const depth={allowed:true,reason:"REAL_DEPTH_CONFIRMED",imbalance:0.02,spread:.0001,depthNotional:60000,
bestBid:q.bid,bestAsk:q.ask,time:now-100};
assert.equal(verifyExecutableEntry(range,rowRange,q,depth,oi,.0004,.0002,now).reason,"ENTRY_OPPOSING_LIQUIDITY");
assert.equal(parseOpenInterestHistory([{timestamp:now-11*60000,sumOpenInterest:"1000"},
{timestamp:now-6*60000,sumOpenInterest:"1012"}],now)?.delta,.012);
assert.equal(parseOpenInterestHistory([{timestamp:now-11*60000,sumOpenInterest:"1000"}],now),null);
assert.equal(parseOpenInterestHistory([{timestamp:now+60000,sumOpenInterest:"1000"},{timestamp:now-6*60000,sumOpenInterest:"990"}],now),null);
// AIOUSDT-like counter-trend breakdown (observed signal trend60 was positive ~3.8%).
const counter={...signal("SHORT"),setupType:"VOLATILITY_BREAKOUT" as const,regime:"EXPANSION" as const,trend60:.038};
assert.equal(confirmEntryContext(counter,makeBars("SHORT"),now).reason,"BREAKOUT_COUNTERTREND_TRAP");
console.log("ENTRY-V2: MTF completed bars, delayed follow-through, OI history, book agreement, cost/latency, anti-chase gates passed");
