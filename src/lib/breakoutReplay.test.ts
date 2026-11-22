import assert from "node:assert/strict";
import { confirmBreakoutTakerFlow } from "./entryValidation.js";

/**
 * Snapshot: 33 real PAPER closes, 2026-11-22 12:46–18:33 UTC.
 * Counterfactual deletes REJECTED entries; it does not simulate reopened
 * positions, altered capital allocation, new signals or future profitability.
 */
const trades=[
  {
    "symbol": "VELVETUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": -4.00443922,
    "flow5": 0.27463884,
    "flow15": 0.08861271,
    "entered": "2026-11-22T12:46:08.053Z"
  },
  {
    "symbol": "ZROUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": 1.58601814,
    "flow5": 0.44593569,
    "flow15": 0.2282807,
    "entered": "2026-11-22T12:46:55.263Z"
  },
  {
    "symbol": "VELVETUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": -0.10977036,
    "flow5": -0.41515365,
    "flow15": -0.14228534,
    "entered": "2026-11-22T13:00:08.097Z"
  },
  {
    "symbol": "ENSOUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": -0.3131004,
    "flow5": -0.48992724,
    "flow15": -0.03121998,
    "entered": "2026-11-22T13:02:24.231Z"
  },
  {
    "symbol": "IDOLUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": 7.27110653,
    "flow5": -0.17043848,
    "flow15": -0.09545379,
    "entered": "2026-11-22T13:04:08.104Z"
  },
  {
    "symbol": "INITUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "pnl": -3.66891125,
    "flow5": 0.27111969,
    "flow15": 0.14307215,
    "entered": "2026-11-22T13:11:25.480Z"
  },
  {
    "symbol": "牛来USDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "pnl": 12.56842975,
    "flow5": 0.22024682,
    "flow15": 0.14432838,
    "entered": "2026-11-22T13:15:55.920Z"
  },
  {
    "symbol": "NIGHTUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": 6.12248522,
    "flow5": 0.49956269,
    "flow15": 0.09918024,
    "entered": "2026-11-22T13:26:08.211Z"
  },
  {
    "symbol": "MARSCOINUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "pnl": -3.86951988,
    "flow5": -0.33205157,
    "flow15": -0.03664732,
    "entered": "2026-11-22T13:31:08.352Z"
  },
  {
    "symbol": "STXUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": 0.92249476,
    "flow5": -0.46160095,
    "flow15": -0.29960235,
    "entered": "2026-11-22T14:15:54.029Z"
  },
  {
    "symbol": "ONEUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "pnl": 3.16564227,
    "flow5": -0.6220833,
    "flow15": -0.29997788,
    "entered": "2026-11-22T14:19:39.260Z"
  },
  {
    "symbol": "ELSAUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": -3.60571393,
    "flow5": 0.17841912,
    "flow15": 0.1201643,
    "entered": "2026-11-22T14:21:08.263Z"
  },
  {
    "symbol": "INJUSDT",
    "side": "SHORT",
    "setup": "TREND_PULLBACK",
    "pnl": 2.9895107,
    "flow5": -0.35632628,
    "flow15": -0.38210101,
    "entered": "2026-11-22T14:24:26.279Z"
  },
  {
    "symbol": "JCTUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "pnl": 1.56414212,
    "flow5": -0.0951099,
    "flow15": -0.01182464,
    "entered": "2026-11-22T14:30:26.463Z"
  },
  {
    "symbol": "MARSCOINUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "pnl": 1.11905352,
    "flow5": -0.24716592,
    "flow15": -0.1489185,
    "entered": "2026-11-22T14:42:38.981Z"
  },
  {
    "symbol": "BRUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "pnl": 2.62915337,
    "flow5": 0.14141818,
    "flow15": 0.06404034,
    "entered": "2026-11-22T14:46:08.412Z"
  },
  {
    "symbol": "INITUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "pnl": 4.07212559,
    "flow5": -0.14760676,
    "flow15": -0.29361711,
    "entered": "2026-11-22T14:49:25.793Z"
  },
  {
    "symbol": "MARSCOINUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": -3.57514346,
    "flow5": -0.26793544,
    "flow15": -0.04004983,
    "entered": "2026-11-22T15:11:39.204Z"
  },
  {
    "symbol": "KERNELUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "pnl": 3.53911225,
    "flow5": 0.3512724,
    "flow15": 0.24898857,
    "entered": "2026-11-22T15:17:08.564Z"
  },
  {
    "symbol": "牛来USDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": -3.61942964,
    "flow5": 0.34289796,
    "flow15": 0.25635808,
    "entered": "2026-11-22T15:22:08.574Z"
  },
  {
    "symbol": "哈基米USDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": -0.10682307,
    "flow5": 0.30223446,
    "flow15": 0.33152675,
    "entered": "2026-11-22T15:38:55.554Z"
  },
  {
    "symbol": "ELSAUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": -3.58771232,
    "flow5": 0.09726521,
    "flow15": 0.03996316,
    "entered": "2026-11-22T16:02:08.471Z"
  },
  {
    "symbol": "BLURUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "pnl": 4.11011225,
    "flow5": 0.14365087,
    "flow15": 0.05150919,
    "entered": "2026-11-22T16:05:10.619Z"
  },
  {
    "symbol": "GRVTUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": -3.84801247,
    "flow5": -0.38107327,
    "flow15": -0.41263833,
    "entered": "2026-11-22T16:08:08.702Z"
  },
  {
    "symbol": "BTWUSDT",
    "side": "LONG",
    "setup": "TREND_PULLBACK",
    "pnl": -3.72929531,
    "flow5": 0.13089497,
    "flow15": 0.11693887,
    "entered": "2026-11-22T16:19:08.643Z"
  },
  {
    "symbol": "AIGENSYNUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": -3.49629864,
    "flow5": 0.53850083,
    "flow15": 0.30030106,
    "entered": "2026-11-22T16:53:08.709Z"
  },
  {
    "symbol": "LYNUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "pnl": -3.57901319,
    "flow5": 0.29262608,
    "flow15": 0.2705033,
    "entered": "2026-11-22T17:02:39.143Z"
  },
  {
    "symbol": "GRVTUSDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": -3.94349904,
    "flow5": 0.63209903,
    "flow15": 0.09305517,
    "entered": "2026-11-22T17:46:25.568Z"
  },
  {
    "symbol": "XVGUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "pnl": -3.46155896,
    "flow5": -0.37757837,
    "flow15": -0.19366303,
    "entered": "2026-11-22T17:48:55.406Z"
  },
  {
    "symbol": "龙虾USDT",
    "side": "LONG",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": -3.57363276,
    "flow5": 0.63713945,
    "flow15": 0.55898137,
    "entered": "2026-11-22T17:49:55.966Z"
  },
  {
    "symbol": "BRUSDT",
    "side": "SHORT",
    "setup": "VOLATILITY_BREAKOUT",
    "pnl": -3.44246592,
    "flow5": -0.23384468,
    "flow15": -0.17986672,
    "entered": "2026-11-22T18:05:08.667Z"
  },
  {
    "symbol": "MMTUSDT",
    "side": "SHORT",
    "setup": "TREND_CONTINUATION",
    "pnl": -3.6004728,
    "flow5": -0.2400566,
    "flow15": -0.13780613,
    "entered": "2026-11-22T18:11:39.585Z"
  },
  {
    "symbol": "HUMAUSDT",
    "side": "LONG",
    "setup": "TREND_CONTINUATION",
    "pnl": -3.54946932,
    "flow5": 0.36883477,
    "flow15": 0.25412311,
    "entered": "2026-11-22T18:32:25.538Z"
  }
] as const;
assert.equal(trades.length,33);
let oldTotal=0,newTotal=0,affected=0,breakouts=0,breakoutWinners=0;
const excluded:string[]=[];
for(const t of trades){
  oldTotal+=t.pnl;
  const isBreakout=t.setup==="VOLATILITY_BREAKOUT";
  if(isBreakout){breakouts++;if(t.pnl>0.15)breakoutWinners++;}
  const accepted=!isBreakout||confirmBreakoutTakerFlow(t.side,t.flow5,t.flow15).allowed;
  if(!isBreakout)assert(accepted,"no effect on ANY trend or pullback trade");
  if(t.pnl>0.15)assert(accepted,"must preserve each observed winner: "+t.symbol);
  if(accepted)newTotal+=t.pnl;
  else{affected++;excluded.push(t.symbol+"/"+t.side);assert(t.pnl<0,"snapshot blocked a winner");}
}
assert.equal(breakouts,17);
assert.equal(breakoutWinners,4);
assert.equal(affected,3);
assert.deepEqual(excluded,["ENSOUSDT/SHORT","MARSCOINUSDT/SHORT","ELSAUSDT/LONG"]);
assert(Math.abs(oldTotal+11.02489547)<.001);
assert(Math.abs(newTotal+3.54893930)<.001);
assert(Math.abs(newTotal-oldTotal-7.47595617)<.001);
assert.equal(confirmBreakoutTakerFlow("LONG",0.1199,0.3).allowed,false);
assert.equal(confirmBreakoutTakerFlow("SHORT",-0.2,-0.0599).allowed,false);
assert.equal(confirmBreakoutTakerFlow("SHORT",-0.2,-0.061).allowed,true);
assert.equal(confirmBreakoutTakerFlow("LONG",NaN,0.2).allowed,false);
console.log("PASS: 33-trade counterfactual, 17 breakouts, 4 breakout winners preserved; 3 losses vetoed; no trend/pullback or exit changes");
console.log("Old fixed-ledger PnL $"+oldTotal.toFixed(2)+", new fixed-ledger PnL $"+newTotal.toFixed(2));
