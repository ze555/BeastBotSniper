import assert from "node:assert/strict";
import { evaluateStrongFlowSignal, isStrongFlowTradingHour, isStrongFlowTrade, isValidStrongFlowTradingSchedule, STRONG_FLOW_STRATEGY_ID } from "./strongFlowStrategy.js";
assert.equal(isStrongFlowTradingHour(new Date("2026-11-20T15:59:59Z")),false);
assert.equal(isStrongFlowTradingHour(new Date("2026-11-20T16:00:00Z")),true);
assert.equal(isStrongFlowTradingHour(new Date("2026-11-20T23:59:00Z")),true);
assert.equal(isStrongFlowTradingHour(new Date("2026-11-21T00:00:00Z")),false);
assert.equal(isStrongFlowTradingHour(new Date("2026-11-20T12:00:00Z"),{mode:"ALWAYS",startLocal:"18:00",endLocal:"02:00"}),true);
assert.equal(isStrongFlowTradingHour(new Date("2026-11-21T00:00:00Z"),{mode:"ALWAYS",startLocal:"18:00",endLocal:"02:00"}),true);
assert.equal(isStrongFlowTradingHour(new Date("2026-11-20T12:00:00Z"),{mode:"SCHEDULED",startLocal:"13:00",endLocal:"16:00"}),true); // 14:00 Libya
assert.equal(isStrongFlowTradingHour(new Date("2026-11-20T14:00:00Z"),{mode:"SCHEDULED",startLocal:"13:00",endLocal:"16:00"}),false);
assert.equal(isValidStrongFlowTradingSchedule({mode:"SCHEDULED",startLocal:"18:00",endLocal:"18:00"}),false);
assert.equal(isValidStrongFlowTradingSchedule({mode:"SCHEDULED",startLocal:"99:00",endLocal:"02:00"}),false);
assert.equal(isStrongFlowTrade({strategyRevision:STRONG_FLOW_STRATEGY_ID}),true);
assert.equal(isStrongFlowTrade({strategyRevision:"main-wave-integrity-v1"}),false);
function bars(side: "LONG"|"SHORT") {
  const out:any[]=[];
  const epoch=Date.parse("2026-11-20T17:00:00Z");
  const dir=side==="LONG"?1:-1;
  for(let i=0;i<90;i++){
    const close=100 + dir*i*0.035;
    out.push({openTime:epoch+i*60000,closeTime:epoch+(i+1)*60000-1,
      open:close-0.02*dir,high:close+0.04,low:close-0.04,close,
      quoteVolume:1000,takerBuyQuote:side==="LONG"?520:480});
  }
  // Force a limited 5-bar pullback and then a strong high-volume reversal candle.
  for(let j=84;j<=88;j++){
    const v=out[83].close-dir*(j-83)*0.013;
    out[j]={...out[j],open:v-dir*0.003,close:v,high:v+0.055,low:v-0.055};
  }
  let recent=out[89];
  const anchor=out[83].close;
  const end=anchor+dir*0.065;
  out[89]={...recent,open:anchor-dir*0.015,close:end,
    high:side==="LONG"?end+0.006:anchor+0.06,
    low:side==="LONG"?anchor-0.06:end-0.006,
    quoteVolume:3000,takerBuyQuote:side==="LONG"?2700:300};
  return out;
}
for(const side of ["LONG","SHORT"] as const){
  const b=bars(side);
  const s=evaluateStrongFlowSignal(b,b[b.length-1].closeTime+1000);
  assert.equal(s?.side,side,side+" synthetic momentum must qualify");
  assert(s!.atr14>0 && s!.rvol>=1.3);
  assert.equal(evaluateStrongFlowSignal(b,b[b.length-1].closeTime+100000),null,"stale closed-bar signal");
  const missing=b.map(x=>({...x}));missing[87].openTime+=60000;
  assert.equal(evaluateStrongFlowSignal(missing,b[b.length-1].closeTime+1000),null,"minute gaps rejected");
  const corrupted=b.map(x=>({...x}));corrupted[89].takerBuyQuote=NaN;
  assert.equal(evaluateStrongFlowSignal(corrupted,b[b.length-1].closeTime+1000),null,"invalid taker flow rejected");
}
console.log("Strong flow: exact UTC hours, BOTH directions, closed bars, freshness, continuity, cost-free feature evaluation passed");
