import assert from "node:assert/strict";
import { followThroughExtension,costAwareProfitLock } from "./entryExitSafeguards.js";
/** Frozen PAPER ledger. In-sample deletion-only counterfactual; no replay of fills. */
const trades=[
  {
    "symbol": "KERNELUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-22T19:30:58.574Z",
    "extensionAtr": -0.098591549,
    "net": -0.761031014
  },
  {
    "symbol": "RAREUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-22T19:37:01.640Z",
    "extensionAtr": 0,
    "net": -3.577132234
  },
  {
    "symbol": "IDOLUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-22T19:38:13.417Z",
    "extensionAtr": 0.16742268,
    "net": -3.660017153
  },
  {
    "symbol": "NIGHTUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-22T19:39:59.232Z",
    "extensionAtr": 0.598290598,
    "net": -3.426073074
  },
  {
    "symbol": "BRUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-22T20:03:13.437Z",
    "extensionAtr": 0.231980116,
    "net": -3.428820591
  },
  {
    "symbol": "FLUIDUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-22T20:25:44.984Z",
    "extensionAtr": 0.2,
    "net": 0.026971369
  },
  {
    "symbol": "BTWUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-22T20:48:13.679Z",
    "extensionAtr": 0.466666667,
    "net": -3.48265818
  },
  {
    "symbol": "BLURUSDT",
    "side": "LONG",
    "setup": "TREND_PULLBACK",
    "entryTime": "2026-11-22T21:06:29.997Z",
    "extensionAtr": 0.638596491,
    "net": -0.565579903
  },
  {
    "symbol": "BLESSUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-22T21:37:13.501Z",
    "extensionAtr": 1.421319797,
    "net": -3.619767187
  },
  {
    "symbol": "SKYUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-22T21:45:13.742Z",
    "extensionAtr": -0.075268817,
    "net": -3.396617257
  },
  {
    "symbol": "BULLAUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-22T22:06:13.538Z",
    "extensionAtr": 0.443438914,
    "net": 0.044661624
  },
  {
    "symbol": "ELSAUSDT",
    "side": "SHORT",
    "setup": "TREND_PULLBACK",
    "entryTime": "2026-11-22T22:59:13.601Z",
    "extensionAtr": -0.095454545,
    "net": -3.523310536
  },
  {
    "symbol": "BRUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T00:47:13.704Z",
    "extensionAtr": 0.571428571,
    "net": -0.813884955
  },
  {
    "symbol": "AKEUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T01:09:13.726Z",
    "extensionAtr": -0.162790698,
    "net": -4.294333377
  },
  {
    "symbol": "AGTUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T01:19:13.811Z",
    "extensionAtr": -0.095238095,
    "net": -3.380314559
  },
  {
    "symbol": "AKEUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T01:32:13.769Z",
    "extensionAtr": -0.088607595,
    "net": 13.305381261
  },
  {
    "symbol": "AIOTUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T01:46:13.778Z",
    "extensionAtr": 0,
    "net": -3.735274145
  },
  {
    "symbol": "ENSOUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T02:18:44.463Z",
    "extensionAtr": 0.653696498,
    "net": -3.444384671
  },
  {
    "symbol": "PROMUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T03:02:00.490Z",
    "extensionAtr": 0.260465116,
    "net": 5.710032016
  },
  {
    "symbol": "ICNTUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T03:10:45.203Z",
    "extensionAtr": 0.104477612,
    "net": -0.023788742
  },
  {
    "symbol": "BRUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T03:15:14.104Z",
    "extensionAtr": 0.914572864,
    "net": -0.698606178
  },
  {
    "symbol": "NIGHTUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T03:15:14.569Z",
    "extensionAtr": 0.083333333,
    "net": 5.787192327
  },
  {
    "symbol": "BIRBUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T03:15:31.202Z",
    "extensionAtr": 0.05511811,
    "net": -0.69777493
  },
  {
    "symbol": "VVVUSDT",
    "side": "LONG",
    "setup": "TREND_PULLBACK",
    "entryTime": "2026-11-23T03:18:15.086Z",
    "extensionAtr": 0.507149666,
    "net": 3.605732025
  },
  {
    "symbol": "RIVERUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T03:22:02.283Z",
    "extensionAtr": -0.197183099,
    "net": -3.347917295
  },
  {
    "symbol": "PUMPUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T03:22:14.433Z",
    "extensionAtr": -0.128440367,
    "net": -3.365569139
  },
  {
    "symbol": "TURBOUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T03:35:15.223Z",
    "extensionAtr": 0.364583333,
    "net": -3.371111978
  },
  {
    "symbol": "1000PEPEUSDC",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T03:35:29.276Z",
    "extensionAtr": 0.467620995,
    "net": -3.460739701
  },
  {
    "symbol": "VELVETUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T03:40:15.712Z",
    "extensionAtr": -0.082840237,
    "net": 1.576858281
  },
  {
    "symbol": "AGTUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T04:00:29.948Z",
    "extensionAtr": 0.619469027,
    "net": -3.371145383
  },
  {
    "symbol": "AGTUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T04:26:29.700Z",
    "extensionAtr": 0,
    "net": -3.552417975
  },
  {
    "symbol": "SENTUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T04:33:14.109Z",
    "extensionAtr": 0.179487179,
    "net": -4.228963692
  },
  {
    "symbol": "NAORISUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T04:39:00.353Z",
    "extensionAtr": 0.161849711,
    "net": 3.708991316
  },
  {
    "symbol": "BLURUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T04:40:30.362Z",
    "extensionAtr": -0.175438596,
    "net": 6.265807969
  },
  {
    "symbol": "MARSCOINUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T04:43:59.582Z",
    "extensionAtr": 0.25,
    "net": -3.417351355
  },
  {
    "symbol": "ROBOUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T04:45:02.507Z",
    "extensionAtr": 0.16374269,
    "net": -3.371699493
  },
  {
    "symbol": "BEATUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T04:50:30.580Z",
    "extensionAtr": 0.107279693,
    "net": 13.10894318
  },
  {
    "symbol": "VVVUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T05:04:15.453Z",
    "extensionAtr": 0.08707671,
    "net": -1.722883115
  },
  {
    "symbol": "ENSOUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T05:09:44.605Z",
    "extensionAtr": 0.206896552,
    "net": -3.703445543
  },
  {
    "symbol": "ARCUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T06:06:29.743Z",
    "extensionAtr": 0,
    "net": -3.491184522
  },
  {
    "symbol": "PUMPUSDT",
    "side": "LONG",
    "setup": "TREND_PULLBACK",
    "entryTime": "2026-11-23T06:14:14.108Z",
    "extensionAtr": 0,
    "net": -3.37739644
  },
  {
    "symbol": "QUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T06:33:02.054Z",
    "extensionAtr": 0.630630631,
    "net": -0.219214026
  },
  {
    "symbol": "MMTUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T06:41:59.621Z",
    "extensionAtr": 0,
    "net": 7.500855025
  },
  {
    "symbol": "LISTAUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T06:50:14.441Z",
    "extensionAtr": 0.443271768,
    "net": 0.90549072
  },
  {
    "symbol": "BREVUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T07:02:30.758Z",
    "extensionAtr": 1.03030303,
    "net": -3.576710101
  },
  {
    "symbol": "AIGENSYNUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T07:03:29.850Z",
    "extensionAtr": 0,
    "net": 0.01223191
  },
  {
    "symbol": "NIGHTUSDT",
    "side": "LONG",
    "setup": "TREND_PULLBACK",
    "entryTime": "2026-11-23T07:15:14.326Z",
    "extensionAtr": 0.693693694,
    "net": -3.652716483
  },
  {
    "symbol": "BLURUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T07:21:14.197Z",
    "extensionAtr": 0.757377049,
    "net": -3.489038202
  },
  {
    "symbol": "NILUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T08:00:16.113Z",
    "extensionAtr": 0.178723404,
    "net": -5.563424832
  },
  {
    "symbol": "AIOTUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T08:07:44.651Z",
    "extensionAtr": 0.345679012,
    "net": -3.522268477
  },
  {
    "symbol": "ENSOUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T08:11:00.007Z",
    "extensionAtr": 0,
    "net": -3.401306494
  },
  {
    "symbol": "ICNTUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T08:49:31.381Z",
    "extensionAtr": -0.086956522,
    "net": 1.319356888
  },
  {
    "symbol": "AIGENSYNUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T08:50:15.288Z",
    "extensionAtr": 0,
    "net": -3.42925537
  },
  {
    "symbol": "BTWUSDT",
    "side": "SHORT",
    "setup": "TREND_PULLBACK",
    "entryTime": "2026-11-23T08:58:16.754Z",
    "extensionAtr": 0.084,
    "net": 0.442981213
  },
  {
    "symbol": "QNTUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T09:06:45.848Z",
    "extensionAtr": -0.030172414,
    "net": 4.043636496
  },
  {
    "symbol": "QUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T09:18:14.536Z",
    "extensionAtr": 0.646153846,
    "net": -3.634085991
  },
  {
    "symbol": "XAIUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T09:25:01.639Z",
    "extensionAtr": 0.513333333,
    "net": -3.252135013
  },
  {
    "symbol": "QNTUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "entryTime": "2026-11-23T09:38:46.665Z",
    "extensionAtr": 0.685459941,
    "net": -3.464372122
  },
  {
    "symbol": "LISTAUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "entryTime": "2026-11-23T09:39:14.462Z",
    "extensionAtr": 0.03410475,
    "net": -3.299374035
  }
] as const;
const round=(v:number)=>Number(v.toFixed(2));
let old=0,next=0,winnerBlocked=0,losersBlocked=0,gateReasons:Record<string,number>={};
for(const t of trades){
  const side=t.side as "LONG"|"SHORT",setup=t.setup as
    "VOLATILITY_BREAKOUT"|"TREND_CONTINUATION"|"TREND_PULLBACK"|"RANGE_REVERSION";
  // The actual gate normalizes against price and ATR; use identical normalized ratio here.
  const original=followThroughExtension(side,100,100+(side==="LONG"?1:-1)*t.extensionAtr,1,setup);
  old+=t.net;
  if(original.allowed)next+=t.net;
  else {
    gateReasons[original.reason]=(gateReasons[original.reason]||0)+1;
    if(t.net>0.15)winnerBlocked++;
    if(t.net<-.15)losersBlocked++;
  }
}
assert.equal(trades.length,59);
assert.equal(losersBlocked,13);
assert.equal(winnerBlocked,0);
assert(Math.abs(old+63.44997185)<.01);
assert(Math.abs(next+29.4738)<.02);
const v=followThroughExtension("LONG",100,100.56,1,"VOLATILITY_BREAKOUT");
assert.equal(v.reason,"FOLLOW_THROUGH_OVEREXTENDED");
assert.equal(followThroughExtension("SHORT",100,99.44,1,"TREND_CONTINUATION").allowed,false);
assert.equal(followThroughExtension("LONG",100,100.54,1,"TREND_PULLBACK").allowed,true);
assert.equal(followThroughExtension("LONG",100,100.95,1,"RANGE_REVERSION").allowed,true);
assert.equal(followThroughExtension("LONG",100,0,1,"TREND_CONTINUATION").allowed,false);
// Profit stop: no cut before 1R; at 1R lock net after typical execution costs.
for(const side of ["LONG","SHORT"] as const){
  assert.equal(costAwareProfitLock(side,100,10,.99,.0004,.0002,"TREND_CONTINUATION"),null);
  const x=costAwareProfitLock(side,100,10,1.0,.0004,.0002,"TREND_CONTINUATION");
  assert(Math.abs((x??0)-(side==="LONG"?103:97))<1e-8);
  const highCost=costAwareProfitLock(side,100,1,1.01,.0004,.0002,"VOLATILITY_BREAKOUT");
  assert(Math.abs((highCost??0)-(side==="LONG"?100.3:99.7))<1e-8);
  assert.equal(costAwareProfitLock(side,100,10,1.6,.0004,.0002,"RANGE_REVERSION"),null);
}
assert.equal(costAwareProfitLock("LONG",100,0,1,.0004,.0002,"TREND_CONTINUATION"),null);
console.log("ANTI-EXHAUSTION frozen PAPER "+trades.length+" entries: old net $"+round(old)+
  " vs unchanged-other-entries hypothetical $"+round(next)+
  "; blocked "+losersBlocked+" losing and "+winnerBlocked+" winning; NOT prospective PnL.");
console.log("PASS: closed-candle ATR exhaustion, no range changes, cost-aware 1R lock and invalid input guards");
