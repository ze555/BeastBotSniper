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
  return {engine:'PAQE-v0.2-paper',mode:'PAPER_ONLY',balance:this.balance,equity:this.equity(),realizedPnl:this.balance-1000,open:this.open.size,closed:this.counters.closed,winRate:this.counters.closed?this.totalWins/this.counters.closed:null,profitFactor:losses?profits/losses:null,costRoundTrip:COST,model:this.model.stats(),counters:this.counters,positions:[...this.open.entries()].map(([symbol,q])=>({symbol,side:q.side===1?'LONG':'SHORT',entry:q.entry,price:q.last,pnl:this.pnl(q,q.last),entryAt:q.entryAt,lastAt:q.lastAt,peak:q.peak,expectedR:q.expectedR})),recent:this.closed.slice(-50)};
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
 const now=Date.now(),k={e:'kline',E:now,k:{s:'BTCUSDT',i:'1m',t:now-60000,o:'100',h:'102',l:'99',c:'101',q:'1000',Q:'600',x:true}};
 assert.equal(parseKline({data:k},now).symbol,'BTCUSDT');
 assert.equal(parseKline(k,now).closed,true);
 assert.equal(parseKline({result:null,id:1},now),null);
 assert.equal(parseKline(k,now+100000),null);
 console.log('PAQE self-test PASS: model, raw/combined websocket parsing');
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


export function parseKline(payload,now){
 const event=payload?.data??payload,k=event?.k;
 if(event?.e!=='kline'||!k||k.i!=='1m'||typeof k.s!=='string')return null;
 const time=Number(event.E),price=Number(k.c);
 if(!valid(time)||!valid(price)||price<=0||Math.abs(now-time)>90000)return null;
 return {symbol:k.s,time,price,closed:k.x===true,bar:{time:Number(k.t),open:Number(k.o),high:Number(k.h),low:Number(k.l),close:price,quoteVolume:Number(k.q),takerBuyQuote:Number(k.Q)}};
}
async function live(){
 const {default:WebSocket}=await import('ws');
 const paper=new Paper(),sockets=new Set(),seen=new Map();
 let symbols=[],lastMessage=0,errors=0,started=false,messages=0,closedBars=0,invalidMessages=0,reconnects=0,lastError=null;
 const template=fs.readFileSync(new URL('./paqe-dashboard.html',import.meta.url),'utf8');
 const status=()=>({...paper.stats(),market:{symbols:symbols.length,receivingSymbols:[...seen.values()].filter(t=>Date.now()-t<90000).length,sockets:[...sockets].filter(s=>s.readyState===WebSocket.OPEN).length,lastMessageAt:lastMessage?new Date(lastMessage).toISOString():null,feedFresh:lastMessage>0&&Date.now()-lastMessage<90000,errors,started,messages,closedBars,invalidMessages,reconnects,lastError}});
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const pathname=new URL(req.url||'/','http://localhost').pathname;
  if(pathname==='/'||pathname==='/index.html'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(renderDashboard(template,status()));return;}
  if(pathname==='/api/legacy/archive'){res.setHeader('Content-Type','application/json');res.end(fs.readFileSync(new URL('./data/paqe-legacy-snapshot-20261127.json',import.meta.url),'utf8'));return;}
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(['/api/paqe','/api/predator/stats','/api/health','/api/bot/status'].includes(pathname)){res.end(JSON.stringify(status()));return;}
  if(pathname==='/api/trades/active'){res.end(JSON.stringify(status().positions));return;}
  if(pathname==='/api/trades/closed'){res.end(JSON.stringify(paper.closed));return;}
  res.statusCode=404;res.end(JSON.stringify({error:'Not found'}));
 });
 server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('PAQE v0.2 PAPER ONLY listening'));
 function connect(group,attempt=0){
  const url='wss://fstream.binance.com/market/stream?streams='+group.map(s=>s.toLowerCase()+'@kline_1m').join('/');
  const ws=new WebSocket(url,{perMessageDeflate:false,maxPayload:1024*1024,handshakeTimeout:15000});sockets.add(ws);
  let alive=Date.now(),gotData=false;
  const watchdog=setInterval(()=>{if(Date.now()-alive>90000)ws.terminate();},15000);
  ws.on('open',()=>console.log('PAQE market WS connected',group.length));
  ws.on('message',buf=>{
   try{
    const event=parseKline(JSON.parse(buf.toString()),Date.now());if(!event){invalidMessages++;return;}
    alive=Date.now();lastMessage=alive;seen.set(event.symbol,alive);messages++;
    if(!gotData){gotData=true;console.log('PAQE first valid kline',event.symbol,group.length);}
    paper.mark(event.symbol,event.price,event.time);
    if(event.closed&&finiteBar(event.bar)){const prev=paper.history.get(event.symbol)?.at(-1);if(!prev||event.bar.time>prev.time){closedBars++;paper.onBar(event.symbol,event.bar);}}
   }catch(e){errors++;lastError=String(e?.message||e);}
  });
  ws.on('error',e=>{errors++;lastError=e.message;console.error('PAQE WS error',e.message);});
  ws.on('close',(code)=>{clearInterval(watchdog);sockets.delete(ws);reconnects++;console.log('PAQE market WS closed',code,group.length);const next=gotData?0:attempt+1;setTimeout(()=>connect(group,next),Math.min(120000,3000*2**Math.min(next,5))+Math.random()*2000);});
 }
 async function start(){
  try{
   const r=await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo',{signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error('exchangeInfo HTTP '+r.status);
   const d=await r.json();symbols=d.symbols.filter(s=>s.status==='TRADING'&&s.contractType==='PERPETUAL'&&s.quoteAsset==='USDT').map(s=>s.symbol);
   if(!symbols.length)throw Error('no futures symbols');
   for(let i=0;i<symbols.length;i+=80){const group=symbols.slice(i,i+80);setTimeout(()=>connect(group),i/80*350);}
   started=true;console.log('PAQE subscribed',symbols.length);
  }catch(e){errors++;lastError=e.message;console.error('PAQE feed discovery:',e.message);setTimeout(start,60000);}
 }
 start();
 setInterval(()=>{const st=status();console.log('PAQE_STATUS '+JSON.stringify({engine:st.engine,balance:st.balance,open:st.open,closed:st.closed,model:st.model,counters:st.counters,market:st.market}));},60000);
}
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(x,d=2)=>Number.isFinite(x)?x.toFixed(d):'—';
function renderDashboard(template,s){
 const m=s.market;
 const metrics=[['الرصيد','$'+num(s.balance)],['حقوق الحساب','$'+num(s.equity)],['صافي الربح المحقق','$'+num(s.realizedPnl)],['مفتوحة',s.open],['مغلقة',s.closed],['نسبة النجاح',s.winRate==null?'—':num(s.winRate*100)+'%'],['معامل الربح',num(s.profitFactor)],['العملات المستقبلة',m.receivingSymbols+' / '+m.symbols],['شموع مغلقة',m.closedBars],['الإشارات',s.counters.signals],['اتصالات السوق',m.sockets],['رسائل السوق',m.messages]];
 const cards=metrics.map(([k,v])=>'<article><small>'+esc(k)+'</small><strong>'+esc(v)+'</strong></article>').join('');
 const groups=Object.entries(s.model).map(([k,v])=>'<tr><td>'+esc(k)+'</td><td>'+v.samples+'</td><td>'+v.blocks+' / 8</td></tr>').join('')||'<tr><td colspan="3">بانتظار اكتمال بيانات التعلم</td></tr>';
 const active=s.positions.map(t=>'<tr>'+[t.symbol,t.side,num(t.entry,7),num(t.price,7),num(t.pnl),num(t.expectedR)].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="6">لا توجد صفقات مفتوحة</td></tr>';
 const closed=s.recent.slice().reverse().map(t=>'<tr>'+[t.symbol,t.side,num(t.pnl),t.reason,new Date(t.exitAt).toISOString().slice(11,19)].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="5">لا توجد صفقات مغلقة</td></tr>';
 const status=m.feedFresh?'تغذية السوق نشطة':m.started?'بانتظار بيانات السوق':'اكتشاف العملات';
 return template.replace('<!--STATUS-->',esc(status)).replace('<!--STATUSCLASS-->',m.feedFresh?'ok':'warn').replace('<!--METRICS-->',cards).replace('<!--GROUPS-->',groups).replace('<!--ACTIVE-->',active).replace('<!--CLOSED-->',closed).replace('<!--DETAILS-->',esc('آخر بيانات: '+(m.lastMessageAt||'—')+' | أخطاء: '+m.errors+' | إعادة اتصال: '+m.reconnects+' | انتظار التعلم: '+s.counters.warmup+' | انتظار أفضلية: '+s.counters.wait));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.includes('--self-test'))selfTest();
 else if(process.argv.includes('--replay'))replay();
 else live().catch(e=>{console.error(e);process.exitCode=1;});
}
