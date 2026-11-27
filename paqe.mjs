import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const MINUTE=60000, H=15*MINUTE;
const COST=0.0014; // assumed round trip: 8 bps fees + 4 slippage + 2 reserve
const MAX_SAMPLES=6000, MIN_SAMPLES=40, MIN_BLOCKS=8;
const clip=(x,a,b)=>Math.max(a,Math.min(b,x));
const valid=x=>Number.isFinite(x);
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const day=t=>new Date(t).toISOString().slice(0,10);
const finiteBar=b=>[b.time,b.open,b.high,b.low,b.close,b.quoteVolume,b.takerBuyQuote].every(valid)&&b.open>0&&b.close>0&&b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.quoteVolume>0&&b.takerBuyQuote>=0&&b.takerBuyQuote<=b.quoteVolume*1.000001;

export function feature(bars){
 const z=bars.slice(-5);
 if(z.length!==5||!z.every(finiteBar)||z.some((b,i)=>i&&b.time!==z[i-1].time+MINUTE))return null;
 const v=z.reduce((s,b)=>s+b.quoteVolume,0);
 const f=z.reduce((s,b)=>s+2*b.takerBuyQuote-b.quoteVolume,0)/v;
 const p=z.at(-1).close, range=mean(z.map(b=>(b.high-b.low)/b.close));
 const risk=Math.max(.006,range*2);
 const r=(p/z[0].open-1)/risk;
 const anchor=Math.abs(f)>=.08?Math.sign(f):Math.sign(r)||1;
 const kind=Math.abs(f)<.08?'neutral':r*anchor>=.15?'momentum':r*anchor<=-.15?'absorption':'weak_response';
 return {kind,anchor,flow:f,impact:r,risk,price:p};
}

export class Model {
 constructor(){this.groups=new Map();}
 learn(x,end,price){
  if(!x||!valid(price)||price<=0||end!==x.mature||!(x.price>0))return false;
  const y=x.anchor*(price/x.price-1)/x.risk;
  if(!valid(y))return false;
  const g=this.groups.get(x.kind)||[];
  g.push({y:clip(y,-5,5),block:Math.floor(end/H)});
  if(g.length>MAX_SAMPLES)g.splice(0,g.length-MAX_SAMPLES);
  this.groups.set(x.kind,g);return true;
 }
 estimate(x){
  const samples=this.groups.get(x.kind)||[],blocks=new Map();
  for(const s of samples){let a=blocks.get(s.block)||[];a.push(s.y);blocks.set(s.block,a);}
  const z=[...blocks.values()].map(a=>mean(a));
  if(samples.length<MIN_SAMPLES||z.length<MIN_BLOCKS)return {side:0,reason:'WARMUP',n:samples.length,blocks:z.length};
  const cost=COST/x.risk;
  const evaluate=d=>{
    const groups=[...blocks.values()].map(a=>a.map(y=>d*y));
    const p=(1+groups.reduce((s,a)=>s+mean(a.map(y=>Number(y>cost))),0))/(2+groups.length);
    const blockMeans=groups.map(mean),m=mean(blockMeans);
    const shrink=m*groups.length/(groups.length+4);
    const se=Math.sqrt(blockMeans.reduce((s,y)=>s+(y-m)**2,0)/(groups.length-1)/groups.length);
    const ev=shrink-cost,lower=ev-1.645*se;
    return {side:d*x.anchor,p,ev,lower,se};
  };
  const candidates=[evaluate(1),evaluate(-1)].sort((a,b)=>b.lower-a.lower);
  const best=candidates[0];
  return {...best,side:best.lower>0.025?best.side:0,candidateSide:best.side,reason:best.lower>0.025?'POSITIVE_CONSERVATIVE_EV':'INSUFFICIENT_EDGE',n:samples.length,blocks:z.length,alternatives:candidates};
 }
 stats(){return Object.fromEntries([...this.groups].map(([k,a])=>[k,{samples:a.length,blocks:new Set(a.map(x=>x.block)).size}]));}
}

export class Paper {
 constructor(model=new Model()){this.model=model;this.balance=1000;this.open=new Map();this.closed=[];this.totalWins=0;this.grossProfit=0;this.grossLoss=0;this.pending=new Map();this.history=new Map();this.day='';this.dayStart=1000;this.counters={signals:0,warmup:0,wait:0,opened:0,closed:0,missing:0};}
 mark(symbol,price,t){
  if(!valid(price)||price<=0||!valid(t))return;
  const q=this.open.get(symbol);if(!q)return;
  const pnl=this.pnl(q,price);q.last=price;q.lastAt=t;q.peak=Math.max(q.peak,pnl);
  const r=pnl/q.riskCash;
  if(q.side*(price/q.entry-1)<=-q.risk){this.close(symbol,price,t,'HARD_STOP');return;}
  if(q.peak>=.7*q.riskCash&&pnl<=Math.max(0,q.peak-.5*q.riskCash)){this.close(symbol,price,t,'NET_PROFIT_LOCK');return;}
  if(t>=q.mature){this.close(symbol,price,t,'HORIZON');}
 }
 pnl(q,price){return q.qty*(q.side*(price-q.entry)-COST*(price+q.entry)/2);}
 close(symbol,price,t,reason){
  const q=this.open.get(symbol);if(!q)return;
  const pnl=this.pnl(q,price);this.balance+=pnl;this.open.delete(symbol);this.counters.closed++;
  if(pnl>0){this.totalWins++;this.grossProfit+=pnl;}else this.grossLoss-=pnl;
  this.closed.push({symbol,side:q.side===1?'LONG':'SHORT',entry:q.entry,exit:price,entryAt:q.entryAt,exitAt:t,pnl,reason,expectedR:q.expectedR});
  if(this.closed.length>2000)this.closed.shift();
 }
 equity(){return this.balance+[...this.open.values()].reduce((s,q)=>s+this.pnl(q,q.last),0);}
 onBar(symbol,b){
  if(!finiteBar(b))return;
  const old=this.history.get(symbol)||[];
  if(old.length&&b.time<=old.at(-1).time)return;
  const t=b.time+MINUTE;
  this.mark(symbol,b.close,t);
  if(day(t)!==this.day){this.day=day(t);this.dayStart=this.equity();}
  const hist=[...old,b].slice(-5);this.history.set(symbol,hist);
  const pending=this.pending.get(symbol);
  if(pending&&t>=pending.mature){
   if(t===pending.mature)this.model.learn(pending,t,b.close);else this.counters.missing++;
   this.pending.delete(symbol);
  }
  const x=feature(hist);if(!x)return;
  // Learn each symbol's non-overlapping 15-minute outcomes, whether or not traded.
  const pos=this.open.get(symbol);
  if(pos){
    const decision=this.model.estimate(x);
    if(decision.side===-pos.side&&decision.lower>0.1)this.close(symbol,b.close,t,'EXPECTED_VALUE_REVERSAL');
  }
  if(this.pending.has(symbol))return;
  const decision=this.model.estimate(x);
  this.pending.set(symbol,{...x,mature:t+H});
  this.counters.signals++;
  if(!decision.side){this.counters[decision.reason==='WARMUP'?'warmup':'wait']++;return;}
  if(this.open.has(symbol)||this.open.size>=6||this.equity()<=this.dayStart*.98||this.balance<=0)return;
  const riskCash=this.balance*.0025;
  const qty=Math.min(riskCash/(x.price*(x.risk+COST)),this.balance*.15/x.price);
  if(!valid(qty)||qty<=0)return;
  this.open.set(symbol,{side:decision.side,entry:x.price,entryAt:t,mature:t+H,risk:x.risk,qty,riskCash:qty*x.price*(x.risk+COST),last:x.price,lastAt:t,peak:-Infinity,expectedR:decision.ev});
  this.counters.opened++;
 }
 stats(){
  const profits=this.grossProfit,losses=this.grossLoss;
  return {engine:'PAQE-v0.1-paper',mode:'PAPER_ONLY',balance:this.balance,equity:this.equity(),realizedPnl:this.balance-1000,open:this.open.size,closed:this.counters.closed,winRate:this.counters.closed?this.totalWins/this.counters.closed:null,profitFactor:losses?profits/losses:null,costRoundTrip:COST,model:this.model.stats(),counters:this.counters,recent:this.closed.slice(-50)};
 }
}

export function selfTest(){
 const model=new Model();
 const base={kind:'momentum',anchor:1,price:100,risk:.01};
 assert.equal(model.estimate(base).side,0);
 for(let i=0;i<8;i++)for(let j=0;j<5;j++){
  const t=(i+1)*H;
  assert.equal(model.learn({...base,mature:t},t,101),true);
 }
 assert.equal(model.estimate(base).side,1);
 assert.equal(model.learn({...base,mature:H},H-1,100),false);
 assert.equal(model.estimate({...base,risk:.0001}).side,0);
 const p=new Paper(model);
 const q={side:1,entry:100,qty:1,risk:.01,riskCash:1,last:100,peak:-Infinity,mature:H};
 p.open.set('TEST',q);assert(p.pnl(q,100)<0);p.mark('TEST',98,MINUTE);assert.equal(p.open.size,0);assert(p.balance<1000);
 assert.equal(feature([{time:0}]),null);
 const candles=Array.from({length:5},(_,i)=>({time:i*MINUTE,open:100+i,high:101+i,low:99+i,close:100.5+i,quoteVolume:100,takerBuyQuote:70}));
 assert.equal(feature(candles).kind,'momentum');
 assert.equal(feature(candles.map((x,i)=>({...x,time:x.time+(i===4?MINUTE:0)}))),null);
 console.log('PAQE self-test PASS: warmup, causal label, costs, risk stop, data continuity');
}

export function replay(){
 const records=JSON.parse(fs.readFileSync('master_trades_dataset.json','utf8'));
 const candles=JSON.parse(fs.readFileSync('master_candles_1m.json','utf8'));
 const a=[];
 for(const tr of records){
  const ms=Date.parse(tr.timestamp_entry),bar=Math.ceil(ms/MINUTE)*MINUTE;
  const data=candles[tr.trade_id]||[],pre=data.filter(c=>c.time+MINUTE<=ms).slice(-5),post=data.filter(c=>c.time>=bar).slice(0,15);
  const x=feature(pre);
  if(!x||post.length!==15||post.some((c,i)=>c.time!==bar+i*MINUTE)||!post.every(finiteBar))continue;
  a.push({...x,id:tr.trade_id,ms,price:post[0].open,mature:bar+H,exit:post[14].close,original:tr.side==='LONG'?1:-1});
 }
 a.sort((x,y)=>x.ms-y.ms);
 const model=new Model(),pending=[],pnl={original:0,reverse:0,paqe:0},trades={original:0,reverse:0,paqe:0};
 let wins=0;
 for(const x of a){
  for(let i=pending.length-1;i>=0;i--)if(pending[i].mature<=x.ms){const y=pending.splice(i,1)[0];model.learn(y,y.mature,y.exit);}
  const d=model.estimate(x);
  const gross=(x.exit/x.price-1)/x.risk,cost=COST*(1+x.exit/x.price)/2/x.risk;
  for(const [name,side] of [['original',x.original],['reverse',-x.original],['paqe',d.side]])if(side){const r=5*(side*gross-cost);pnl[name]+=r;trades[name]++;if(name==='paqe'&&r>0)wins++;}
  pending.push(x);
 }
 console.log(JSON.stringify({type:'HISTORICAL_REPLAY',note:'fixed 15m labels, next-open entry, 5 USD normalized risk; not live-paper exit simulation',records:a.length,trades,pnl,wins,model:model.stats()}));
}

async function live(){
 const {default:WebSocket}=await import('ws');
 const paper=new Paper(),sockets=new Set();let symbols=[],lastMessage=0,errors=0,started=false;
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url==='/'||req.url==='/index.html'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(new URL('./paqe-dashboard.html',import.meta.url),'utf8'));return;}
  if(req.url==='/api/legacy/archive'){res.setHeader('Content-Type','application/json');res.end(fs.readFileSync(new URL('./data/paqe-legacy-snapshot-20261127.json',import.meta.url),'utf8'));return;}
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({...paper.stats(),market:{symbols:symbols.length,sockets:[...sockets].filter(s=>s.readyState===WebSocket.OPEN).length,lastMessageAt:lastMessage?new Date(lastMessage).toISOString():null,feedFresh:Date.now()-lastMessage<90000,errors,started}}));
 });
 server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('PAQE PAPER ONLY listening'));
 function connect(group){
  const url='wss://fstream.binance.com/stream?streams='+group.map(s=>s.toLowerCase()+'@kline_1m').join('/');
  const ws=new WebSocket(url);sockets.add(ws);let alive=Date.now();
  const watchdog=setInterval(()=>{if(Date.now()-alive>90000)ws.terminate();},30000);
  ws.on('open',()=>console.log('PAQE WS connected',group.length));
  ws.on('message',buf=>{
   try{
    alive=Date.now();const event=JSON.parse(buf.toString()).data;const k=event?.k;if(!k||!valid(Number(event.E)))return;
    const time=Number(event.E),price=Number(k.c);if(Math.abs(Date.now()-time)>90000)return;
    lastMessage=Date.now();paper.mark(k.s,price,time);
    if(k.x)paper.onBar(k.s,{time:Number(k.t),open:Number(k.o),high:Number(k.h),low:Number(k.l),close:price,quoteVolume:Number(k.q),takerBuyQuote:Number(k.Q)});
   }catch(e){errors++;}
  });
  ws.on('error',e=>{errors++;console.error('PAQE WS error',e.message);});
  ws.on('close',()=>{clearInterval(watchdog);sockets.delete(ws);setTimeout(()=>connect(group),15000);});
 }
 async function start(){
  try{
   const r=await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo',{signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error('exchangeInfo HTTP '+r.status);
   const d=await r.json();symbols=d.symbols.filter(s=>s.status==='TRADING'&&s.contractType==='PERPETUAL'&&s.quoteAsset==='USDT').map(s=>s.symbol);
   if(!symbols.length)throw Error('no futures symbols');
   for(let i=0;i<symbols.length;i+=80)connect(symbols.slice(i,i+80));
   started=true;console.log('PAQE subscribed',symbols.length);
  }catch(e){errors++;console.error('PAQE feed discovery:',e.message);setTimeout(start,60000);}
 }
 start();
 setInterval(()=>console.log(JSON.stringify({type:'PAQE_STATUS',...paper.stats(),market:{symbols:symbols.length,feedFresh:Date.now()-lastMessage<90000,errors},recent:undefined})),60000);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.includes('--self-test'))selfTest();
 else if(process.argv.includes('--replay'))replay();
 else live().catch(e=>{console.error(e);process.exitCode=1;});
}
