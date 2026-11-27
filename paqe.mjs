import fs from 'node:fs';
import {InstitutionalShadow} from './institutional-shadow.mjs';
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
  this.onLog?.('INFO','TRADE',symbol+' '+(q.side===1?'LONG':'SHORT')+' CLOSED | '+reason+' | net USD '+pnl.toFixed(4));
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
  this.onDecision?.(symbol,x,decision);
  if(!decision.side){this.counters[decision.reason==='WARMUP'?'warmup':'wait']++;return;}
  if(this.storageHealthy===false||this.open.has(symbol)||this.open.size>=6||this.equity()<=this.dayStart*.98||this.balance<=0)return;
  const riskCash=this.balance*.0025;
  const qty=Math.min(riskCash/(x.price*(x.risk+COST)),this.balance*.15/x.price);
  if(!valid(qty)||qty<=0)return;
  this.open.set(symbol,{side:decision.side,entry:x.price,entryAt:t,mature:t+H,risk:x.risk,qty,riskCash:qty*x.price*(x.risk+COST),last:x.price,lastAt:t,peak:-Infinity,expectedR:decision.ev});
  this.counters.opened++;
  this.onLog?.('INFO','TRADE',symbol+' '+(decision.side===1?'LONG':'SHORT')+' OPEN | entry '+x.price+' | EV '+decision.ev.toFixed(4)+'R | lower '+decision.lower.toFixed(4)+'R');
 }
 stats(){
  const profits=this.grossProfit,losses=this.grossLoss;
  return {engine:'PAQE-v0.3-paper',mode:'PAPER_ONLY',balance:this.balance,equity:this.equity(),realizedPnl:this.balance-1000,open:this.open.size,closed:this.counters.closed,winRate:this.counters.closed?this.totalWins/this.counters.closed:null,profitFactor:losses?profits/losses:null,costRoundTrip:COST,model:this.model.stats(),counters:this.counters,positions:[...this.open.entries()].map(([symbol,q])=>({symbol,side:q.side===1?'LONG':'SHORT',entry:q.entry,price:q.last,pnl:this.pnl(q,q.last),entryAt:q.entryAt,lastAt:q.lastAt,peak:q.peak,expectedR:q.expectedR})),recent:this.closed.slice(-50)};
 }
}


export function snapshotPaper(p){
 return {version:1,balance:p.balance,totalWins:p.totalWins,grossProfit:p.grossProfit,grossLoss:p.grossLoss,day:p.day,dayStart:p.dayStart,counters:p.counters,open:[...p.open],closed:p.closed,pending:[...p.pending],history:[...p.history],groups:[...p.model.groups]};
}
export function restorePaper(p,s){
 if(s?.version!==1||!Number.isFinite(s.balance)||!Array.isArray(s.groups)||!Array.isArray(s.open)||!Array.isArray(s.pending)||!Array.isArray(s.history)||!Array.isArray(s.closed))throw Error('Invalid PAQE database snapshot');
 for(const k of ['balance','totalWins','grossProfit','grossLoss','day','dayStart'])p[k]=s[k];
 p.counters={...p.counters,...s.counters};
 p.open=new Map(s.open.map(([symbol,q])=>[symbol,{...q,peak:q.peak??-Infinity}]));
 p.closed=s.closed.slice(-2000);p.pending=new Map(s.pending);p.history=new Map(s.history);p.model.groups=new Map(s.groups);
 return p;
}
export class PaperStore {
 constructor(db){
  this.db=db;this.savedAt=null;this.restoredAt=null;this.error=null;this.writes=0;this.archived=0;
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS engine_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, saved_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS paper_trades (trade_id TEXT PRIMARY KEY, symbol TEXT NOT NULL, entry_at INTEGER NOT NULL, exit_at INTEGER NOT NULL, pnl REAL NOT NULL, payload TEXT NOT NULL);');
  this.loadStmt=db.prepare('SELECT payload,saved_at FROM engine_state WHERE id=1');
  this.saveStmt=db.prepare('INSERT INTO engine_state(id,payload,saved_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,saved_at=excluded.saved_at');
  this.tradeStmt=db.prepare('INSERT OR IGNORE INTO paper_trades(trade_id,symbol,entry_at,exit_at,pnl,payload) VALUES(?,?,?,?,?,?)');
  this.countStmt=db.prepare('SELECT COUNT(*) AS n FROM paper_trades');
  this.recentStmt=db.prepare('SELECT payload FROM paper_trades ORDER BY exit_at DESC LIMIT ? OFFSET ?');
  db.exec("CREATE TABLE IF NOT EXISTS engine_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, level TEXT NOT NULL, category TEXT NOT NULL, message TEXT NOT NULL);");
  this.logStmt=db.prepare('INSERT INTO engine_logs(time,level,category,message) VALUES(?,?,?,?)');
  this.pruneLogs=db.prepare('DELETE FROM engine_logs WHERE id <= (SELECT COALESCE(MAX(id),0)-5000 FROM engine_logs)');
  this.archived=Number(this.countStmt.get().n);
  this.lastClosedCount=0;
 }
 load(p){
  const row=this.loadStmt.get();if(!row)return false;
  restorePaper(p,JSON.parse(row.payload));this.savedAt=row.saved_at;this.restoredAt=new Date().toISOString();this.lastClosedCount=p.counters.closed;return true;
 }
 save(p){
  const now=new Date().toISOString();
  try{
   this.db.exec('BEGIN IMMEDIATE');
   const count=p.counters.closed;
   const delta=Math.max(0,count-this.lastClosedCount);
   for(const t of p.closed.slice(Math.max(0,p.closed.length-delta)))this.tradeStmt.run(t.symbol+':'+t.entryAt+':'+t.exitAt,t.symbol,t.entryAt,t.exitAt,t.pnl,JSON.stringify(t));
   this.saveStmt.run(JSON.stringify(snapshotPaper(p)),now);
   this.db.exec('COMMIT');
   this.savedAt=now;this.writes++;this.lastClosedCount=count;this.error=null;this.archived=Number(this.countStmt.get().n);return true;
  }catch(e){try{this.db.exec('ROLLBACK');}catch{}this.error=String(e?.message||e);console.error('PAQE DB save failed',this.error);return false;}
 }
 log(level,category,message){
  try{this.logStmt.run(new Date().toISOString(),level,category,String(message).slice(0,2000));this.pruneLogs.run();}
  catch(e){console.error('PAQE log storage error',String(e?.message||e));}
 }
 logs(limit=150,level='',category=''){
  const n=Math.min(500,Math.max(1,Math.floor(limit)||150));
  return this.db.prepare("SELECT id,time,level,category,message FROM engine_logs WHERE (?='' OR level=?) AND (?='' OR category=?) ORDER BY id DESC LIMIT ?").all(level,level,category,category,n);
 }
 list(limit=100,offset=0){return this.recentStmt.all(Math.min(1000,Math.max(1,Math.floor(limit)||100)),Math.max(0,Math.floor(offset)||0)).map(r=>JSON.parse(r.payload));}
 status(){return {engine:'SQLite',persistent:true,healthy:!this.error&&!!this.savedAt,lastSavedAt:this.savedAt,restoredAt:this.restoredAt,writes:this.writes,archivedTrades:this.archived,error:this.error};}
}
async function databaseSelfTest(){
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(':memory:'),p=new Paper(),store=new PaperStore(db);
 p.model.groups.set('momentum',[{y:1,block:2}]);p.pending.set('BTCUSDT',{mature:123});p.history.set('BTCUSDT',[{time:1}]);
 p.open.set('BTCUSDT',{side:1,entry:100,qty:1,risk:.01,riskCash:1,last:100,peak:-Infinity,mature:60000});
 assert(store.save(p));
 const q=new Paper(),second=new PaperStore(db);assert(second.load(q));assert.equal(q.open.get('BTCUSDT').peak,-Infinity);assert.equal(q.model.groups.get('momentum')[0].y,1);assert.equal(q.pending.get('BTCUSDT').mature,123);
 q.open.get('BTCUSDT').entryAt=1;q.close('BTCUSDT',101,1000,'DB_TEST');assert(second.save(q));assert(second.save(q));
 second.log('WARN','MARKET','test <unsafe>');assert.equal(second.logs(10,'WARN','MARKET')[0].message,'test <unsafe>');assert.equal(second.logs(10,'INFO').length,0);
 assert.equal(second.list().length,1);assert.equal(second.status().archivedTrades,1);
 const r=new Paper(),third=new PaperStore(db);assert(third.load(r));assert.equal(r.counters.closed,1);assert.equal(r.open.size,0);assert.equal(r.balance,q.balance);db.close();
 console.log('PAQE SQLite self-test PASS: state restoration, model, trade archive, idempotence');
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
 const {DatabaseSync}=await import('node:sqlite');
 const mount=process.env.RAILWAY_VOLUME_MOUNT_PATH||'/paqe-data';
 if(!fs.existsSync(mount)||!fs.statSync(mount).isDirectory())throw Error('Persistent Railway volume is required: '+mount);
 const store=new PaperStore(new DatabaseSync(mount+'/paqe.sqlite'));
 store.db.exec("CREATE TABLE IF NOT EXISTS institutional_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS institutional_labels (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS market_metadata (key TEXT PRIMARY KEY, payload TEXT NOT NULL);");
 const row=store.db.prepare('SELECT payload FROM institutional_state WHERE id=1').get(),shadow=new InstitutionalShadow(row?JSON.parse(row.payload):null);
 const saveShadow=()=>{try{store.db.exec('BEGIN IMMEDIATE');store.db.prepare('INSERT INTO institutional_state(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(shadow.snapshot()));const add=store.db.prepare('INSERT INTO institutional_labels(payload) VALUES(?)');for(const x of shadow.dirty)add.run(JSON.stringify(x));store.db.exec('DELETE FROM institutional_labels WHERE id <= (SELECT COALESCE(MAX(id),0)-100000 FROM institutional_labels); COMMIT');shadow.dirty.length=0;}catch(e){try{store.db.exec('ROLLBACK');}catch{}console.error('Institutional DB error',e.message);}};
 const restored=store.load(paper);
 paper.storageHealthy=store.save(paper);
 if(!paper.storageHealthy)throw Error('Initial database save failed');
 const log=(level,category,message)=>store.log(level,category,message);
 paper.onLog=log;
 const sampled=new Map();
 paper.onDecision=(symbol,x,d)=>{
  const key=x.kind+':'+d.reason,now=Date.now();
  if(now-(sampled.get(key)||0)<60000)return;sampled.set(key,now);
  log('INFO','DECISION',symbol+' | '+x.kind+' | '+d.reason+' | samples '+d.n+' | blocks '+d.blocks+(Number.isFinite(d.ev)?' | EV '+d.ev.toFixed(4)+'R | lower '+d.lower.toFixed(4)+'R':'')+' | side '+(d.side===1?'LONG':d.side===-1?'SHORT':'WAIT'));
 };
 log('INFO','SYSTEM','PAQE started | PAPER ONLY');
 log('INFO','DATABASE',restored?'State restored from SQLite':'SQLite initialized');
 console.log('PAQE_DB_READY '+JSON.stringify({...store.status(),restored}));
 const persist=()=>{const previous=paper.storageHealthy;paper.storageHealthy=store.save(paper);if(previous!==paper.storageHealthy)log(paper.storageHealthy?'INFO':'ERROR','DATABASE',paper.storageHealthy?'Saving recovered':'Saving failed: '+store.error);};
 setInterval(persist,15000);
 setInterval(saveShadow,30000);
 for(const sig of ['SIGTERM','SIGINT'])process.once(sig,()=>{persist();saveShadow();store.db.close();process.exit(0);});
 let symbols=[],lastMessage=0,errors=0,started=false,messages=0,closedBars=0,invalidMessages=0,reconnects=0,lastError=null;
 const template=fs.readFileSync(new URL('./paqe-dashboard.html',import.meta.url),'utf8');
 const status=()=>({...paper.stats(),database:store.status(),institutional:shadow.status(),market:{symbols:symbols.length,receivingSymbols:[...seen.values()].filter(t=>Date.now()-t<90000).length,sockets:[...sockets].filter(s=>s.readyState===WebSocket.OPEN).length,lastMessageAt:lastMessage?new Date(lastMessage).toISOString():null,feedFresh:lastMessage>0&&Date.now()-lastMessage<90000,errors,started,messages,closedBars,invalidMessages,reconnects,lastError}});
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const pathname=new URL(req.url||'/','http://localhost').pathname;
  if(pathname==='/'||pathname==='/index.html'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(renderDashboard(template,status()));return;}
  if(pathname==='/logs'||pathname==='/api/system/logs'){
   const q=new URL(req.url,'http://localhost').searchParams;
   const level=['INFO','WARN','ERROR'].includes(q.get('level'))?q.get('level'):'';
   const category=['SYSTEM','MARKET','DATABASE','DECISION','TRADE'].includes(q.get('category'))?q.get('category'):'';
   const entries=store.logs(Number(q.get('limit'))||150,level,category);
   if(pathname==='/logs'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(renderLogs(entries,level,category));return;}
   res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(entries));return;
  }
  if(pathname==='/api/legacy/archive'){res.setHeader('Content-Type','application/json');res.end(fs.readFileSync(new URL('./data/paqe-legacy-snapshot-20261127.json',import.meta.url),'utf8'));return;}
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(['/api/paqe','/api/predator/stats','/api/health','/api/bot/status'].includes(pathname)){res.end(JSON.stringify(status()));return;}
  if(pathname==='/api/trades/active'){res.end(JSON.stringify(status().positions));return;}
  if(pathname==='/api/trades/closed'){const q=new URL(req.url,'http://localhost').searchParams;res.end(JSON.stringify(store.list(Number(q.get('limit'))||100,Number(q.get('offset'))||0)));return;}
  if(pathname==='/api/institutional/status'){res.end(JSON.stringify(shadow.status()));return;}
  if(pathname==='/api/institutional/labels'){const n=Math.min(500,Math.max(1,Number(new URL(req.url,'http://localhost').searchParams.get('limit'))||100));res.end(JSON.stringify(store.db.prepare('SELECT payload FROM institutional_labels ORDER BY id DESC LIMIT ?').all(Math.floor(n)).map(r=>JSON.parse(r.payload))));return;}
  if(pathname==='/api/database/status'){res.end(JSON.stringify(store.status()));return;}
  res.statusCode=404;res.end(JSON.stringify({error:'Not found'}));
 });
 server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('PAQE v0.3 PAPER ONLY listening'));
 function connect(group,attempt=0){
  const url='wss://fstream.binance.com/market/stream?streams='+group.map(s=>s.toLowerCase()+'@kline_1m').join('/');
  const ws=new WebSocket(url,{perMessageDeflate:false,maxPayload:1024*1024,handshakeTimeout:15000});sockets.add(ws);
  let alive=Date.now(),gotData=false;
  const watchdog=setInterval(()=>{if(Date.now()-alive>90000)ws.terminate();},15000);
  ws.on('open',()=>{console.log('PAQE market WS connected',group.length);log('INFO','MARKET','WebSocket connected | '+group.length+' symbols');});
  ws.on('message',buf=>{
   try{
    const event=parseKline(JSON.parse(buf.toString()),Date.now());if(!event){invalidMessages++;return;}
    alive=Date.now();lastMessage=alive;seen.set(event.symbol,alive);messages++;
    if(!gotData){gotData=true;console.log('PAQE first valid kline',event.symbol,group.length);log('INFO','MARKET','First valid kline | '+event.symbol+' | group '+group.length);}
    const tradeVersion=paper.counters.opened+paper.counters.closed;
    paper.mark(event.symbol,event.price,event.time);
    if(event.closed&&finiteBar(event.bar)){const prev=paper.history.get(event.symbol)?.at(-1);if(!prev||event.bar.time>prev.time){closedBars++;paper.onBar(event.symbol,event.bar);shadow.bar(event.symbol,event.bar,paper.history.get(event.symbol),Date.now());}}
    if(tradeVersion!==paper.counters.opened+paper.counters.closed)persist();
   }catch(e){errors++;lastError=String(e?.message||e);}
  });
  ws.on('error',e=>{errors++;lastError=e.message;console.error('PAQE WS error',e.message);log('ERROR','MARKET','WebSocket error | '+e.message);});
  ws.on('close',(code)=>{clearInterval(watchdog);sockets.delete(ws);reconnects++;console.log('PAQE market WS closed',code,group.length);log('WARN','MARKET','WebSocket closed | code '+code+' | group '+group.length);const next=gotData?0:attempt+1;setTimeout(()=>connect(group,next),Math.min(120000,3000*2**Math.min(next,5))+Math.random()*2000);});
 }
 function aux(url,handler){const ws=new WebSocket(url,{perMessageDeflate:false,maxPayload:4*1024*1024,handshakeTimeout:15000});let alive=Date.now(),ok=false;const watch=setInterval(()=>{if(Date.now()-alive>90000)ws.terminate();},15000);ws.on('message',buf=>{try{const raw=JSON.parse(buf.toString()),events=raw.data??raw;for(const e of Array.isArray(events)?events:[events])if(handler(e,Date.now())){alive=Date.now();ok=true;}}catch(e){console.error('Auxiliary decode',e.message);}});ws.on('error',e=>log('WARN','MARKET','Institutional feed '+e.message));ws.on('close',()=>{clearInterval(watch);setTimeout(()=>aux(url,handler),ok?10000:60000);});}
 aux('wss://fstream.binance.com/public/ws/!bookTicker',(e,t)=>shadow.quote(e,t));
 aux('wss://fstream.binance.com/market/stream?streams=!markPrice@arr@1s/!forceOrder@arr',(e,t)=>shadow.mark(e,t)||shadow.liquidation(e,t));
 const metaGet=store.db.prepare("SELECT payload FROM market_metadata WHERE key='symbols'"),metaSet=store.db.prepare("INSERT INTO market_metadata(key,payload) VALUES('symbols',?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload");
 function subscribe(list){symbols=list;for(let i=0;i<symbols.length;i+=80){const group=symbols.slice(i,i+80);setTimeout(()=>connect(group),i/80*350);}started=true;log('INFO','MARKET','Subscribed '+symbols.length+' real futures symbols');}
 async function start(){
  try{
   const r=await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo',{signal:AbortSignal.timeout(15000)});
   if(!r.ok){const e=Error('exchangeInfo HTTP '+r.status),v=r.headers.get('retry-after'),sec=Number(v);e.delay=r.status===418?Math.max(900000,sec*1000||0):r.status===429?Math.max(120000,sec*1000||0):60000;throw e;}
   const d=await r.json();symbols=d.symbols.filter(s=>s.status==='TRADING'&&s.contractType==='PERPETUAL'&&s.quoteAsset==='USDT').map(s=>s.symbol);
   if(!symbols.length)throw Error('no futures symbols');
   metaSet.run(JSON.stringify({symbols,at:Date.now()}));subscribe(symbols);lastError=null;
  }catch(e){errors++;lastError=e.message;console.error('PAQE feed discovery:',e.message);log('ERROR','MARKET','Exchange discovery | '+e.message);setTimeout(start,e.delay||60000);}
 }
 const cached=metaGet.get();if(cached){const v=JSON.parse(cached.payload);if(Date.now()-v.at<86400000&&Array.isArray(v.symbols)&&v.symbols.length)subscribe(v.symbols);else start();}else start();
 setInterval(()=>{const st=status();log(st.market.feedFresh?'INFO':'WARN','MARKET','Feed '+(st.market.feedFresh?'ACTIVE':'STALE')+' | symbols '+st.market.receivingSymbols+'/'+st.market.symbols+' | messages '+st.market.messages+' | candles '+st.market.closedBars);log('INFO','DECISION','Signals '+st.counters.signals+' | warmup '+st.counters.warmup+' | wait '+st.counters.wait+' | opened '+st.counters.opened+' | closed '+st.counters.closed);log(st.database.healthy?'INFO':'ERROR','DATABASE','Checkpoints '+st.database.writes+' | archive '+st.database.archivedTrades+' | last save '+st.database.lastSavedAt);console.log('PAQE_STATUS '+JSON.stringify({engine:st.engine,balance:st.balance,open:st.open,closed:st.closed,model:st.model,counters:st.counters,market:st.market}));},60000);
}
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(x,d=2)=>Number.isFinite(x)?x.toFixed(d):'—';

function renderLogs(entries,level,category){
 const options=(arr,selected)=>arr.map(v=>'<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(v||'الكل')+'</option>').join('');
 const rows=entries.map(e=>'<article><div class="meta"><time>'+esc(e.time)+'</time><b class="'+esc(e.level)+'">'+esc(e.level)+'</b><span>'+esc(e.category)+'</span></div><div class="msg">'+esc(e.message)+'</div></article>').join('')||'<p>لا توجد سجلات مطابقة</p>';
 return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10"><title>PAQE | Logs</title><style>body{background:#0c1220;color:#e6eef7;font:14px system-ui;margin:0}main{max-width:1100px;margin:auto;padding:16px}h1{font-size:24px}a{color:#93c5fd}form{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:20px 0}select,button{font:inherit;background:#19263a;color:#e6eef7;border:1px solid #42536c;border-radius:7px;padding:9px}article{background:#152033;border:1px solid #29384e;border-radius:8px;padding:12px;margin:8px 0;overflow-wrap:anywhere}.meta{display:flex;gap:12px;flex-wrap:wrap;align-items:center;direction:ltr;color:#9eafc6;font-size:12px}.msg{direction:ltr;text-align:left;margin-top:8px;font-family:monospace;white-space:pre-wrap}.INFO{color:#6ee7b7}.WARN{color:#fbbf24}.ERROR{color:#fca5a5}</style></head><body><main><a href="/">العودة للوحة التحكم</a><h1>سجل النظام — PAQE Logs</h1><p>أحدث السجلات أولاً · UTC · تحديث كل 10 ثوانٍ · حفظ آخر 5,000 سجل</p><form method="get" action="/logs"><label>المستوى <select name="level">'+options(["","INFO","WARN","ERROR"],level)+'</select></label><label>الفئة <select name="category">'+options(["","SYSTEM","MARKET","DATABASE","DECISION","TRADE"],category)+'</select></label><button>تصفية</button><a href="/logs">عرض الكل</a><a href="/api/system/logs">JSON</a></form>'+rows+'</main></body></html>';
}

function renderDashboard(template,s){
 const m=s.market;
 const metrics=[['الرصيد','$'+num(s.balance)],['حقوق الحساب','$'+num(s.equity)],['صافي الربح المحقق','$'+num(s.realizedPnl)],['مفتوحة',s.open],['مغلقة',s.closed],['نسبة النجاح',s.winRate==null?'—':num(s.winRate*100)+'%'],['معامل الربح',num(s.profitFactor)],['العملات المستقبلة',m.receivingSymbols+' / '+m.symbols],['شموع مغلقة',m.closedBars],['الإشارات',s.counters.signals],['اتصالات السوق',m.sockets],['رسائل السوق',m.messages],['قاعدة البيانات',s.database?.healthy?'متصلة':'خطأ'],['أرشيف الصفقات',s.database?.archivedTrades??0],['Institutional book',s.institutional?.coverage.book??0],['Institutional funding',s.institutional?.coverage.funding??0]];
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
 else if(process.argv.includes('--db-test'))databaseSelfTest().catch(e=>{console.error(e);process.exitCode=1;});
 else live().catch(e=>{console.error(e);process.exitCode=1;});
}
