import assert from "node:assert/strict";
import {evaluateBidirectionalSignal,assessDirectionalStructure,
  bidirectionalProfitStop,BIDIRECTIONAL_REVISION} from "./bidirectionalRegimeEngine.js";
import {confirmNextClosedMinute,confirmEntryContext} from "./entryValidation.js";
import type {StrongFlowBar} from "./strongFlowStrategy.js";

/** Reproducible closed-candle counterexamples, not a profitability backtest. */
const EPOCH=Date.parse("2026-11-23T13:00:00Z");
function history(previous:"UP"|"DOWN",mode:"FAILED"|"CORRECTION"):StrongFlowBar[]{
  const sg=previous==="UP"?1:-1,slope=mode==="CORRECTION"?.3:.1;
  const lastPlateau=mode==="CORRECTION"?77:84;
  const out=Array.from({length:85},(_,i)=>{
    const close=(previous==="UP"?100:140)+sg*slope*Math.min(i,lastPlateau);
    return {openTime:EPOCH+i*60000,closeTime:EPOCH+(i+1)*60000-1,
      open:close-sg*.03,high:close+.17,low:close-.17,close,
      quoteVolume:1000,takerBuyQuote:sg>0?575:425};
  });
  const last=out[84],prev=out[83],close=prev.close-sg*.8;
  const open=prev.close+sg*.04;
  out[84]={...last,open,close,high:Math.max(close,open)+.09,
    low:Math.min(close,open)-.09,quoteVolume:mode==="FAILED"?3600:2200,
    takerBuyQuote:mode==="FAILED"?(sg>0?360:3240):(sg>0?220:1980)};
  return out;
}
function now(b:StrongFlowBar[]){return b.at(-1)!.closeTime+1000;}
for(const previous of ["UP","DOWN"] as const){
  for(const mode of ["FAILED","CORRECTION"] as const){
    const b=history(previous,mode);
    const sig=evaluateBidirectionalSignal(b,now(b));
    const opposite=previous==="UP"?"SHORT":"LONG";
    assert(sig,previous+" "+mode+" needs a candidate");
    assert.equal(sig!.side,opposite);
    assert.equal(sig!.setupType,mode==="FAILED"?"FAILED_BREAKOUT_REVERSAL":"COUNTERTREND_CORRECTION");
    assert(sig!.phase.includes(opposite));
    assert(sig!.evidence.rvol>1.2);
    assert.equal(sig!.signalCloseTime,b.at(-1)!.closeTime);
    assert(assessDirectionalStructure(b,now(b)));
    assert.equal(evaluateBidirectionalSignal(b,now(b)+120000),null,"stale candle must never produce signal");
    const broken=b.map(x=>({...x}));broken[74].openTime+=1000;
    assert.equal(evaluateBidirectionalSignal(broken,now(b)),null,"gapped history must fail closed");
    // Check that the new setup is not rejected for simply opposing the PREVIOUS
    // 60m trend. Still require actual subsequent confirmation (no lookahead).
    const multi=confirmEntryContext(sig!,b,now(b));
    assert.equal(multi.allowed,true,JSON.stringify({previous,mode,multi}));
    const followOpen=b.at(-1)!.close;
    const followClose=followOpen+(opposite==="LONG"?.07:-.07);
    const next:StrongFlowBar={openTime:EPOCH+85*60000,closeTime:EPOCH+86*60000-1,
      open:followOpen,close:followClose,high:Math.max(followOpen,followClose)+.02,
      low:Math.min(followOpen,followClose)-.02,
      quoteVolume:2500,takerBuyQuote:opposite==="LONG"?1850:650};
    const after=[...b,next];
    const confirm=confirmNextClosedMinute(sig!,after,now(after));
    assert.equal(confirm.allowed,true,JSON.stringify({previous,mode,confirm}));
  }
}
for(const side of ["LONG","SHORT"] as const){
  const sg=side==="LONG"?1:-1,entry=100,dist=2;
  const a=bidirectionalProfitStop(side,"COUNTERTREND_CORRECTION",entry,dist,1.2);
  assert.equal(a,entry+sg*.34*dist);
  const b=bidirectionalProfitStop(side,"FAILED_BREAKOUT_REVERSAL",entry,dist,1.8);
  assert.equal(b,entry+sg*.7*dist);
  const c=bidirectionalProfitStop(side,"VOLATILITY_BREAKOUT",entry,dist,3.1);
  assert.equal(c,entry+sg*1.95*dist);
  assert.equal(bidirectionalProfitStop(side,"VOLATILITY_BREAKOUT",entry,dist,.4),null);
  for(const setup of ["TREND_CONTINUATION","TREND_PULLBACK","FAILED_BREAKOUT_REVERSAL"] as const){
    assert.equal(bidirectionalProfitStop(side,setup,entry,dist,.599),null,
      "early stop must not engage before +0.60R");
    assert.equal(bidirectionalProfitStop(side,setup,entry,dist,.60),entry+sg*.10*dist,
      "V4 should protect partial progress without dropping the entry");
  }
  assert.equal(bidirectionalProfitStop(side,"FAILED_BREAKOUT_REVERSAL",entry,dist,1.1),
    entry+sg*.2*dist,"later confirmed-reversal tier stays stronger");
  assert.equal(bidirectionalProfitStop(side,"VOLATILITY_BREAKOUT",entry,dist,.9),null,
    "do not prematurely close the genuine breakout runners");
  assert.equal(bidirectionalProfitStop(side,"RANGE_REVERSION",entry,dist,.9),null,
    "range strategy remains unchanged");
  assert.equal(bidirectionalProfitStop(side,"COUNTERTREND_CORRECTION",entry,dist,.60),null,
    "unvalidated correction strategy remains unchanged");
}
// No future knowledge; the same historical bars + clock must return the same candidate.
const fixture=history("UP","FAILED");
assert.deepEqual(evaluateBidirectionalSignal(fixture,now(fixture)),
  evaluateBidirectionalSignal(fixture,now(fixture)));
assert(BIDIRECTIONAL_REVISION.includes("BIDIRECTIONAL"));
console.log("PASS: V4 symmetric UP/DOWN corrections, failed breakouts, clock/gap safety, independent follow-through, regime trailing stops");
