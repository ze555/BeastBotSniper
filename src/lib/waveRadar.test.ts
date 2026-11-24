import assert from "node:assert/strict";
import {WaveRadar,scheduleRadarBatch} from "./waveRadar.js";
const now=1800000000000;
const eligible=new Set(["UP","DOWN","OLD","FLAT","FLOW"]);
const radar=new WaveRadar();
const snapshot=(time:number,up:number,down:number,old:number)=>[
 {symbol:"UP",price:up,time},{symbol:"DOWN",price:down,time},
 {symbol:"OLD",price:old,time},{symbol:"FLAT",price:100,time}];
radar.ingestPrices(snapshot(now-30000,100,100,130),eligible,now-30000);
assert.deepEqual(radar.select(eligible,now-30000),[]);
radar.ingestPrices(snapshot(now-15000,100.05,99.95,131),eligible,now-15000);
radar.ingestPrices(snapshot(now,100.45,99.55,131.1),eligible,now);
assert.deepEqual(radar.select(eligible,now),["UP","DOWN"]);
assert.deepEqual(radar.select(eligible,now+90001),[]);
const bars=Array.from({length:23},(_,i)=>({openTime:now-(23-i)*60000,
 closeTime:now-(22-i)*60000-1,open:100,high:101,low:99,close:100,
 quoteVolume:i>=20?200:100,takerBuyQuote:i>=20?145:50}));
radar.ingestBars("FLOW",bars,now);
assert(radar.select(eligible,now).includes("FLOW"));
const broken=bars.map(b=>({...b}));broken[22].takerBuyQuote=999;
const clean=new WaveRadar();clean.ingestBars("FLOW",broken,now);
assert.deepEqual(clean.select(eligible,now),[]);
for(const n of [5,25,200,821]){
 const regular=Array.from({length:n},(_,i)=>"S"+i);
 const result=scheduleRadarBatch(regular,["UP","DOWN","S0"],[
  {symbol:"DUE",signalCloseTime:now-65000},{symbol:"WAIT",signalCloseTime:now-1000},
  {symbol:"EXPIRED",signalCloseTime:now-180001}],now);
 assert.equal(result[0],"DUE");assert(!result.includes("WAIT"));assert(!result.includes("EXPIRED"));
 assert(regular.every(s=>result.includes(s)));assert.equal(new Set(result).size,result.length);
}
console.log("WaveRadar acceleration, mirrored directions, freshness, real flow and full coverage passed");
