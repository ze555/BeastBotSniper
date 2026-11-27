import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const MIN=60000,WINDOW=61000,LIMIT=24;
export function buildCatalog(exchanges,markets){
 const names=new Map(exchanges.map(x=>[x.code,String(x.name||'')]));
 const isBin=x=>/^binance(?:\s+(?:futures|usds?-m))?$/i.test(names.get(x.exchange)||'');
 const candidates=markets.filter(x=>x.is_perpetual===true&&x.margined==='STABLE'&&x.quote_asset==='USDT'&&typeof x.symbol==='string'&&typeof x.symbol_on_exchange==='string'&&typeof x.base_asset==='string');
 const local=new Map(),peers=new Map();for(const x of candidates){if(isBin(x)&&/^[A-Z0-9]+USDT$/.test(x.symbol_on_exchange))local.set(x.symbol_on_exchange,x);else{const label=names.get(x.exchange)||'';if(!/^(bybit|okx|bitget|gate(?:\.io)?)\b/i.test(label))continue;const list=peers.get(x.base_asset)||[];if(!list.some(v=>v.exchange===x.exchange))list.push(x);peers.set(x.base_asset,list);}}
 return {local,peers,names};
}
export function validOI(row,now){const t=Number(row?.update)*1000,v=Number(row?.value);return Number.isFinite(t)&&Number.isFinite(v)&&v>0&&t<=now+5000&&now-t<=5*MIN?{t,value:v}:null;}
export class Coinalyze{
 constructor(key,{fetcher=fetch,log=()=>{},saved={}}={}){this.key=key;this.fetcher=fetcher;this.log=log;this.calls=[];this.units=0;this.requests=0;this.lastHTTP=null;this.error=null;this.pauseUntil=Number(saved.pauseUntil)||0;this.updated=0;this.catalogAt=0;this.catalog={local:new Map(),peers:new Map(),names:new Map()};this.oi=new Map();this.cursor=0;this.peerCursor=0;this.busy=false;this.success=0;this.cross=new Map();this.lastSuccess=null;}
 budget(now){this.calls=this.calls.filter(x=>now-x.t<WINDOW);return this.calls.reduce((s,x)=>s+x.n,0);}
 async request(path,params={},units=1){
  const now=Date.now();if(!this.key||now<this.pauseUntil||this.budget(now)+units>LIMIT)return null;
  this.calls.push({t:now,n:units});this.units+=units;this.requests++;
  try{const q=new URLSearchParams(params),r=await this.fetcher('https://api.coinalyze.net/v1/'+path+(q.size?'?'+q.toString():''),{headers:{api_key:this.key},signal:AbortSignal.timeout(15000)});this.lastHTTP=r.status;
   if(!r.ok){this.error='HTTP '+r.status;if(r.status===429){const h=Number(r.headers.get('retry-after'));this.pauseUntil=Date.now()+Math.max(120000,Number.isFinite(h)?h*1000:0);}else if([401,403].includes(r.status))this.pauseUntil=Date.now()+DAY;else this.pauseUntil=Date.now()+MIN;this.log('WARN','MARKET','Coinalyze '+this.error+'; requests paused');return null;}
   const x=await r.json();if(!Array.isArray(x))throw Error('unexpected schema');this.error=null;this.success++;this.lastSuccess=Date.now();return x;
  }catch{this.error='network or schema error';this.pauseUntil=Date.now()+MIN;return null;}
 }
 async refresh(){const e=await this.request('exchanges');if(!e)return false;const m=await this.request('future-markets');if(!m)return false;const c=buildCatalog(e,m);if(!c.local.size){this.error='no Binance USDT perpetual mapping';this.pauseUntil=Date.now()+10*MIN;return false;}this.catalog=c;this.catalogAt=Date.now();this.log('INFO','MARKET','Coinalyze mapped '+c.local.size+' Binance USDT perpetual markets');return true;}
 async tick(ranked,onCatalog,onLocal,onCross){
  if(!this.key||this.busy||Date.now()<this.pauseUntil)return;this.busy=true;
  try{
   if(!this.catalogAt||Date.now()-this.catalogAt>6*60*MIN){if(!await this.refresh())return;onCatalog([...this.catalog.local.keys()]);}
   const now=Date.now(),names=[...new Set(ranked)].filter(x=>this.catalog.local.has(x));if(!names.length)return;
   const local=names.slice(0,120),batch=[],used=new Set();
   const take=(x,localName)=>{if(x&&!used.has(x.symbol)){used.add(x.symbol);batch.push({x,localName});}};
   for(let i=0;i<6&&i<local.length;i++) {const n=local[this.cursor++%local.length];take(this.catalog.local.get(n),n);}
   const focus=local.slice(0,30);for(let i=0;i<2&&i<focus.length;i++){const n=focus[this.peerCursor++%focus.length],v=this.catalog.local.get(n),list=this.catalog.peers.get(v.base_asset)||[];const j=Math.floor((this.peerCursor-1)/Math.max(1,focus.length));if(list.length)take(list[j%list.length],null);}
   if(!batch.length)return;const rows=await this.request('open-interest',{symbols:batch.map(v=>v.x.symbol).join(','),convert_to_usd:'false'},batch.length);if(!rows)return;
   const map=new Map(batch.map(v=>[v.x.symbol,v]));
   for(const row of rows){const item=map.get(row.symbol),v=validOI(row,Date.now());if(!item||!v)continue;const old=this.oi.get(row.symbol);if(old&&old.t>=v.t)continue;const delta=old&&v.t-old.t<=45*MIN?Math.log(v.value/old.value):null;this.oi.set(row.symbol,{...v,delta,base:item.x.base_asset,exchange:item.x.exchange});this.updated++;
    if(item.localName)onLocal(item.localName,{symbol:item.localName,time:v.t,openInterest:v.value},Date.now());
   }
   for(const n of local.slice(0,30)){const item=this.catalog.local.get(n),ls=this.catalog.peers.get(item.base_asset)||[],vals=ls.map(x=>this.oi.get(x.symbol)).filter(x=>x&&x.delta!==null&&now-x.t<35*MIN);if(vals.length){const summary={venues:vals.length,meanLogChange:vals.reduce((a,b)=>a+b.delta,0)/vals.length,oldestAt:Math.min(...vals.map(v=>v.t)),source:'Coinalyze peer native OI changes'};this.cross.set(n,summary);onCross(n,summary);}}
  }finally{this.busy=false;}
 }
 snapshot(){return {pauseUntil:this.pauseUntil};}
 status(now=Date.now()){return {enabled:!!this.key,provider:'Coinalyze',catalogMarkets:this.catalog.local.size,catalogAt:this.catalogAt?new Date(this.catalogAt).toISOString():null,requests:this.requests,units:this.units,unitsLast61s:this.budget(now),maxUnitsPer61s:LIMIT,lastHTTP:this.lastHTTP,lastSuccess:this.lastSuccess?new Date(this.lastSuccess).toISOString():null,error:this.error,pausedUntil:this.pauseUntil>now?new Date(this.pauseUntil).toISOString():null,oiUpdates:this.updated,freshMarkets:[...this.oi.values()].filter(x=>now-x.t<35*MIN).length,crossMarkets:[...this.cross.values()].filter(x=>now-x.oldestAt<35*MIN).length};}
}
const DAY=24*60*MIN;
export function selfTest(){const x={symbol:'BTCUSDT_PERP.A',symbol_on_exchange:'BTCUSDT',base_asset:'BTC',quote_asset:'USDT',is_perpetual:true,margined:'STABLE',exchange:'A'},c=buildCatalog([{code:'A',name:'Binance'},{code:'B',name:'Bybit'}],[x,{...x,symbol:'BTCUSDT_PERP.B',exchange:'B'},{...x,symbol:'DATED',is_perpetual:false}]);assert.equal(c.local.size,1);assert.equal(c.peers.get('BTC').length,1);assert.equal(validOI({value:100,update:1800000000},1800000000000).value,100);assert.equal(validOI({value:0,update:1800000000},1800000000000),null);assert.equal(validOI({value:1,update:1800000000},1800000400000),null);const p=new Coinalyze('test',{fetcher:()=>{throw Error('not invoked')}});p.calls=[{t:Date.now(),n:24}];assert.equal(p.budget(Date.now()),24);console.log('Coinalyze mapping, freshness and budget tests PASS');}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)selfTest();
