import assert from 'node:assert/strict';
import axios from 'axios';
import { closedCandles, validQuote, waveEvidence, tightenStop } from './tradingIntegrity.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.BEAST_RESEARCH_DIR = mkdtempSync(join(tmpdir(), 'beast-integrity-'));
const { getTrades, getClosedTrades, getStats, protectTradeAtPrice, runProtectionCycle, isActive } = await import('./apexPredator.js');
const now = Date.now();
const q = {bid: 101, ask: 101.02, time: now};
assert(validQuote(q, now));
assert(!validQuote({...q,time:now-6000},now));
assert(!validQuote({...q,bid:102},now));
assert(!validQuote({...q,time:NaN},now));
assert.equal(closedCandles([{closeTime:now-1},{closeTime:now},{closeTime:now+1}],now).length,1);
const bars = [{close:100,closeTime:now-300001}, {open:100,close:101,volume:100,takerBuy:65,takerSell:35,closeTime:now-1}];
assert(waveEvidence('LONG',bars,q,1,.0004,.0002,now).allowed);
assert.equal(waveEvidence('SHORT',bars,q,1,.0004,.0002,now).reason,'OPPOSING_EXECUTED_FLOW');
assert.equal(waveEvidence('LONG',bars,{...q,ask:103,bid:102.99},1,.0004,.0002,now).reason,'LATE_CHASE');
assert.equal(waveEvidence('LONG',bars,{...q,ask:101.9,bid:101},1,.0004,.0002,now).reason,'COST_EXCEEDS_FIRST_TARGET');
assert.equal(waveEvidence('LONG',[bars[0],{...bars[1],close:99}],q,1,.0004,.0002,now).reason,'FLOW_WITHOUT_PRICE_RESPONSE');
const shortBars = [bars[0],{...bars[1],close:99,takerBuy:35,takerSell:65}];
assert(waveEvidence('SHORT',shortBars,{bid:99,ask:99.02,time:now},1,.0004,.0002,now).allowed);
for (const direction of ['LONG','SHORT']) {
  const sign = direction === 'LONG' ? 1 : -1;
  const t:any = {symbol:`TEST${direction}USDT`,direction,entry:100,sl:100-sign*10,initialSlDist:10,pos:1,initialPos:1,part_a:.4,part_b:.35,part_c:.25,entryTime:new Date(now).toISOString(),peak_r:0};
  getTrades().push(t);
  protectTradeAtPrice(t,100+sign*8,now);
  assert.equal(t.a_closed,true); assert.equal(t.pos,.6);
  const floor = t.sl;
  tightenStop(t,100-sign*2.5);
  assert.equal(t.sl,floor,'stop must never loosen');
  protectTradeAtPrice(t,100-sign*20,now-1000);
  assert(getTrades().includes(t),'out of order price ignored');
  protectTradeAtPrice(t,NaN,now);
  assert(getTrades().includes(t),'invalid price ignored');
  protectTradeAtPrice(t,100+sign*2,now);
  assert(!getTrades().includes(t),'protected stop closes position');
  const count=getClosedTrades().length, balance=getStats().balance;
  protectTradeAtPrice(t,100-sign*20,now);
  assert.equal(getClosedTrades().length,count); assert.equal(getStats().balance,balance);
}
// Failed quote for one symbol cannot block another; protection runs while entry bot is paused.
assert.equal(isActive(),false);
const make=(symbol:string):any=>({symbol,direction:'LONG',entry:100,sl:90,initialSlDist:10,pos:1,initialPos:1,part_a:.4,part_b:.35,part_c:.25,entryTime:new Date().toISOString(),peak_r:0});
const bad=make('BADUSDT'), good=make('GOODUSDT'); getTrades().push(bad,good);
const original=axios.get;
axios.get=(async (_url:any,opts:any)=>{
  if(opts.params.symbol==='BADUSDT') throw Error('timeout');
  return {data:{symbol:'GOODUSDT',bidPrice:'89',askPrice:'89.1',time:Date.now()}};
}) as any;
try { await runProtectionCycle(); } finally { axios.get=original; }
assert(getTrades().includes(bad)); assert(!getTrades().includes(good));
assert(getStats().diagnostics.quoteErrors>0);
console.log('Trading integrity: freshness, mirrored flow, costs, closed candles, stop ratchets, idempotency, paused protection and isolated API failures passed');
