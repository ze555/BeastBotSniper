import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
// Local conservative budgets; exchange limits and bans always take precedence.
export const REST_GAP=5000,REST_PER_MIN=12,WEIGHT_STOP=480,WS_GAP=5000,WS_PER_MIN=12;
export function reconnectDelay(attempt=0){return Math.min(1800000,60000*2**Math.min(5,Math.max(0,attempt)))+Math.floor(Math.random()*15000);}
export class Budget{
 constructor(gap,limit){this.gap=gap;this.limit=limit;this.times=[];this.last=-Infinity;}
 delay(now){this.times=this.times.filter(t=>t>now-60000);return Math.max(0,this.last+this.gap-now,this.times.length>=this.limit?this.times[0]+60000-now:0);}
 take(now){if(this.delay(now)>0)return false;this.last=now;this.times.push(now);return true;}
}
export function selfTest(){const b=new Budget(REST_GAP,REST_PER_MIN);const n=1800000000000;assert(b.take(n));assert(!b.take(n+1000));for(let i=1;i<12;i++)assert(b.take(n+i*5000));assert(!b.take(n+59999));assert(b.take(n+60000));assert(reconnectDelay(0)>=60000);assert(reconnectDelay(10)>=1800000);console.log('Binance safety budget tests PASS');}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)selfTest();
