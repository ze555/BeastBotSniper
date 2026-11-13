import assert from 'node:assert/strict';
import { buildEntryQuality, RetestWatch } from './entryQuality.js';
import { evaluateFlowEntryGate } from './flowEntryGate.js';
import { evaluateSymbolReasoning } from './reasoningEngine.js';
import { evaluateExecutionFilter } from './executionFilter.js';

for (const side of ['LONG', 'SHORT'] as const) {
 const long = side === 'LONG';
 const mirror = (x: number) => long ? x : 200 - x;
 const candles = Array.from({length:30}, (_,i) => ({open: mirror(99.5), close: mirror(99.8), high: long ? 100 : 100.6, low: long ? 99.4 : 100, volume:100}));
 candles.push({open:mirror(100.1),close:mirror(100.3),high:long?100.4:99.95,low:long?100.05:99.6,volume:160});
 const p = { price:mirror(100.3), atr14:0.5, atr20:0.5, rvol:1.6, rvolPace:1.6, taker:long?0.58:0.42, rsi:long?56:44, adx:30,
 ema50:mirror(99),ema200:mirror(98),ema21:mirror(99.5),HH_HL:long,LH_LL:!long,st_bull:long,st_bear:!long,
 bull_align:long,bear_align:!long,di_plus:long?30:10,di_minus:long?10:30,klines:candles };
 const w = {p_chg:long?0.004:-0.004,oi_chg:0, slope15:long?180:-180,slope5:long?60:-60,slope4h:long?400:-400,cvd_mixed:false};
 const regime = long?'BULL_STRONG':'BEAR_STRONG';
 const reasoning = evaluateSymbolReasoning('TESTUSDT',{regime,tradeable:true,violence:{active:false}},p,w,{sl:long?10:0,ss:long?0:10});
 assert.equal(reasoning.confirmation.isConfirmed,true,JSON.stringify(reasoning.confirmation));
 assert.equal(reasoning.flow.state,long?'BUYING_PRESSURE':'SELLING_PRESSURE');
 const quality = buildEntryQuality(side,p,w,reasoning,'BREAKOUT_MOMENTUM',1.3,0.0004,0.0002);
 const expectedStop = long ? 99.4 - 0.5 * 1.3 : 100.6 + 0.5 * 1.3;
 assert.ok(Math.abs(quality.stopPct - Math.abs(p.price - expectedStop) / p.price) < 1e-12, 'runway uses execution stop');
 const pullbackQuality = buildEntryQuality(side,p,w,reasoning,'PULLBACK_SNIPER',1.3,0.0004,0.0002);
 assert.ok(Math.abs(pullbackQuality.stopPct - Math.abs(p.price - (long ? 98.9 : 101.1)) / p.price) < 1e-12, 'pullback stop matches execution');
 const opts = {side,flowState:reasoning.flow.state,btcRegime:regime,quality,distanceToResistancePct:reasoning.location.distanceToResistancePct,distanceToSupportPct:reasoning.location.distanceToSupportPct};
 assert.equal(evaluateFlowEntryGate(opts).blocked,false,JSON.stringify(evaluateFlowEntryGate(opts)));
 assert.equal(evaluateFlowEntryGate({...opts,quality:undefined}).blocked,true,'old gate rejects same pressure');
 for (const patch of [{confirmed:false},{timingPassed:false},{persistent:false},{aligned:false},{stopPct:NaN},{costPct:0.1}])
   assert.equal(evaluateFlowEntryGate({...opts,quality:{...quality,...patch}}).blocked,true);
 assert.equal(evaluateFlowEntryGate({...opts,flowState:'MIXED'}).blocked,true);
 const key=long?'distanceToResistancePct':'distanceToSupportPct';
 assert.equal(evaluateFlowEntryGate({...opts,[key]:0.003,quality:{...quality,atrPct:0.002,stopPct:0.002,costPct:0.0012}}).blocked,false,'sub-1% sufficient room');
 assert.equal(evaluateFlowEntryGate({...opts,[key]:0.01,quality:{...quality,stopPct:0.02}}).blocked,true,'1% insufficient for wide stop');
 assert.equal(evaluateFlowEntryGate({...opts,[key]:-0.02}).blocked,true,'late breakout rejected');
 assert.equal(evaluateFlowEntryGate({...opts,[key]:NaN}).blocked,true,'missing level rejected');
 const counter = evaluateSymbolReasoning('TESTUSDT',{regime:long?'BEAR_STRONG':'BULL_STRONG',tradeable:true},p,w,{sl:long?10:0,ss:long?0:10});
 assert.equal(counter.confirmation.isConfirmed,false,'counter-regime protection retained');
}
assert.equal(evaluateExecutionFilter('SHORT','BEAR_STRONG','TREND_DOWN',{setupType:'PULLBACK_SNIPER',confirmedTrend:true}).blocked,false);
assert.equal(evaluateExecutionFilter('LONG','BEAR_STRONG','TREND_DOWN',{setupType:'PULLBACK_SNIPER',confirmedTrend:true}).blocked,true);
const watch=new RetestWatch(1000,2);
watch.remember('A',0);watch.remember('A',500);watch.remember('B',0);
assert.deepEqual(watch.take(1000),[],'repeat observations cannot extend expiry');
watch.remember('A',1000);watch.remember('B',1000);watch.remember('C',1000);
assert.equal(watch.size,2);watch.remove('B');assert.equal(watch.size,1);
const fair = new RetestWatch();for (let i=0;i<8;i++) fair.remember(String(i),100000);
assert.equal(fair.take(100000,5).length,5);assert.equal(fair.take(100001,5).length,3);
console.log('PASS: symmetric confirmation-to-flow integration, cost/stop/late-data safeguards, pullback direction, bounded retest lifecycle');
