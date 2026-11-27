import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const M=60000,H=[5,15,60],D=10,FEE=.0005,SLIP=.0002,N=100;
const f=Number.isFinite,clip=(x,a=-5,b=5)=>Math.max(a,Math.min(b,x)),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const zero=()=>({w:Array(D).fill(0),n:0,blocks:[],evalN:0,err:0,selected:0,net:0,stress:0,wins:0,gp:0,gl:0,evalBlocks:{},baseline:0});
export function parseQuote(e,now){
 if(e?.e!=='bookTicker'||Number(e.st)===2||!e.s?.endsWith('USDT'))return null;
 const t=Number(e.E),bid=Number(e.b),ask=Number(e.a),bq=Number(e.B),aq=Number(e.A);
 if(![t,bid,ask,bq,aq].every(f)||bid<=0||ask<bid||bq<=0||aq<=0||Math.abs(now-t)>15000)return null;
 return {s:e.s,t,bid,ask,bq,aq,mid:(bid+ask)/2};
}
export function returns(a,b){
 if(!a||!b||Math.min(a.bid*a.bq,a.ask*a.aq,b.bid*b.bq,b.ask*b.aq)<N)return null;
 return [b.bid/a.ask-1-(FEE+SLIP)*(1+b.bid/a.ask),1-b.ask/a.bid-(FEE+SLIP)*(1+b.ask/a.bid)];
}
export class InstitutionalShadow{
 constructor(saved=null){this.models=Object.fromEntries(H.map(h=>[h,[zero(),zero()]]));this.pending=new Map();this.quotes=new Map();this.funding=new Map();this.liq=new Map();this.vol=new Map();this.ofi=new Map();this.btc=null;this.count={quotes:0,mark:0,liquidation:0,features:0,missing:0,fundingCross:0};this.dirty=[];if(saved?.version===1){this.models=saved.models;this.count={...this.count,...saved.count};}}
 quote(e,now){const q=parseQuote(e,now);if(!q)return false;const old=this.quotes.get(q.s);if(old&&q.t<=old.t)return false;
 let of=0;if(old&&q.t-old.t<15000){const z=(q.bid>=old.bid?q.bq:0)-(q.bid<=old.bid?old.bq:0)-(q.ask<=old.ask?q.aq:0)+(q.ask>=old.ask?old.aq:0);of=.8*(this.ofi.get(q.s)||0)+.2*clip(z/(q.bq+q.aq+old.bq+old.aq),-1,1);}
 this.ofi.set(q.s,of);this.quotes.set(q.s,q);this.count.quotes++;
 for(const h of H){const k=q.s+':'+h,p=this.pending.get(k);if(!p)continue;
 if(!p.entry){if(q.t<=p.t)continue;if(q.t-p.t>15000){this.pending.delete(k);this.count.missing++;continue;}p.entry=q;p.due=q.t+h*M;if(p.next<=p.due){this.pending.delete(k);this.count.fundingCross++;}continue;}
 if(q.t<p.due)continue;this.pending.delete(k);if(q.t-p.due>15000){this.count.missing++;continue;}const y=returns(p.entry,q);if(!y){this.count.missing++;continue;}this.learn(h,p,y,q.t);
 }return true;}
 mark(e,now){if(e?.e!=='markPriceUpdate'||Number(e.st)===2||!e.s?.endsWith('USDT'))return false;const t=Number(e.E),p=Number(e.p),i=Number(e.i),r=Number(e.r),next=Number(e.T);if(![t,p,i,r,next].every(f)||p<=0||i<=0||next<=t||Math.abs(now-t)>20000)return false;this.funding.set(e.s,{t,rate:r,basis:p/i-1,next});this.count.mark++;return true;}
 liquidation(e,now){const o=e?.o;if(e?.e!=='forceOrder'||Number(e.st)===2||!o?.s?.endsWith('USDT'))return false;const t=Number(e.E),v=Number(o.ap)*Number(o.z);if(!f(t)||!f(v)||v<=0||Math.abs(now-t)>20000||!['BUY','SELL'].includes(o.S))return false;const old=this.liq.get(o.s);this.liq.set(o.s,{t,v:(old&&t>=old.t?old.v*Math.exp(-(t-old.t)/M):0)+(o.S==='BUY'?v:-v)});this.count.liquidation++;return true;}
 bar(symbol,b,hist,now){
 if(!hist||hist.length<5)return;const z=hist.slice(-5);if(z.some((v,i)=>i&&v.time!==z[i-1].time+M))return;
 const t=b.time+M;if(now-t>15000||now<t-1000)return;const ret=Math.log(b.close/z[0].open),r1=Math.log(b.close/b.open),old=this.vol.get(symbol);
 const v=old&&t>old.t&&t-old.t<2*M?.94*old.v+.06*r1*r1:r1*r1;this.vol.set(symbol,{t,v});if(symbol==='BTCUSDT')this.btc={t,ret};
 const q=this.quotes.get(symbol),u=this.funding.get(symbol);if(!q||!u||!this.btc||now-q.t>15000||now-u.t>20000||now-this.btc.t>90000||q.t>now||u.t>now){this.count.missing++;return;}
 const vol=z.reduce((a,x)=>a+x.quoteVolume,0);if(!(vol>0))return;const cvd=z.reduce((a,x)=>a+2*x.takerBuyQuote-x.quoteVolume,0)/vol;
 const sigma=Math.max(.0005,Math.sqrt(v)),imb=(q.bq-q.aq)/(q.bq+q.aq),spread=(q.ask-q.bid)/q.mid,ofi=this.ofi.get(symbol),l=this.liq.get(symbol);
 const x=[1,clip(cvd),clip(ret/(sigma*Math.sqrt(5))),clip(imb),clip(ofi),clip(spread*1000),clip(u.rate*1000),clip(u.basis*1000),clip(this.btc.ret/.005),Math.sin(2*Math.PI*(Math.floor(t/M)%15)/15)];
 if(!x.every(f))return;this.count.features++;
 for(const h of H){const k=symbol+':'+h,p=this.pending.get(k);if(p){if(now>(p.due||p.t)+15000){this.pending.delete(k);this.count.missing++;}else continue;}
 const m=this.models[h],ready=m.every(z=>z.n>=200&&z.blocks.length>=8),pred=ready?m.map(z=>dot(z.w,x)/100):null,side=pred&&Math.max(...pred)>.001?(pred[0]>=pred[1]?1:-1):0;
 this.pending.set(k,{s:symbol,t:now,x,entry:null,next:u.next,side,pred,context:{sigma,spread,cvd,imb,ofi,funding:u.rate,basis:u.basis,liquidationObserved:l&&now-l.t<5*M?l.v*Math.exp(-(now-l.t)/M):null}});
 }}
 learn(h,p,y,t){const block=Math.floor(t/(h*M));
 this.models[h].forEach((z,i)=>{z.baseline+=y[i];if(p.pred){z.evalN++;z.err+=(p.pred[i]-y[i])**2;}
 if(p.side===(i===0?1:-1)){const r=y[i];z.selected++;z.net+=r;z.stress+=r-2*(FEE+SLIP);if(r>0){z.wins++;z.gp+=r;}else z.gl-=r;const a=z.evalBlocks[block]||{n:0,sum:0};a.n++;a.sum+=r;z.evalBlocks[block]=a;const k=Object.keys(z.evalBlocks);if(k.length>256)delete z.evalBlocks[k[0]];}
 const err=clip(100*y[i]-dot(z.w,p.x),-3,3),eta=.004/(1+z.n/100000);z.w=z.w.map((w,j)=>clip(w+eta*(err*p.x[j]-.02*w),-2,2));z.n++;
 if(!z.blocks.includes(block)){z.blocks.push(block);if(z.blocks.length>256)z.blocks.shift();}});
 this.dirty.push({s:p.s,h,t,entry:p.entry.t,features:p.x,context:p.context,pred:p.pred,side:p.side,long:y[0],short:y[1]});if(this.dirty.length>20000)this.dirty.shift();
 }
 snapshot(){return {version:1,models:this.models,count:this.count};}
 status(now=Date.now()){const fresh=(m,ms)=>[...m.values()].filter(q=>now-q.t<=ms&&q.t<=now).length;
 const horizons=Object.fromEntries(H.map(h=>{const [a,b]=this.models[h],n=a.selected+b.selected,gp=a.gp+b.gp,gl=a.gl+b.gl,blocks={};for(const z of [a,b])for(const [k,v] of Object.entries(z.evalBlocks)){const g=blocks[k]||{n:0,sum:0};g.n+=v.n;g.sum+=v.sum;blocks[k]=g;}
 const v=Object.values(blocks).map(z=>z.sum/z.n),avg=v.length?v.reduce((a,b)=>a+b,0)/v.length:null,se=v.length>1?Math.sqrt(v.reduce((s,x)=>s+(x-avg)**2,0)/(v.length-1)/v.length):null;
 return [h,{labels:a.n,blocks:a.blocks.length,ready:a.n>=200&&a.blocks.length>=8,selected:n,netUSD100:(a.net+b.net)*N,stressUSD100:(a.stress+b.stress)*N,winRate:n?(a.wins+b.wins)/n:null,profitFactor:gl?gp/gl:null,evalBlocks:v.length,blockMeanLowerBps:se===null?null:(avg-1.645*se)*10000,rmseBps:a.evalN?Math.sqrt((a.err+b.err)/(a.evalN+b.evalN))*10000:null,baselineLongUSD100:a.baseline*N,baselineShortUSD100:b.baseline*N}];}));
 return {mode:'SHADOW_ONLY',source:'BINANCE_REAL_PUBLIC',horizons,coverage:{book:fresh(this.quotes,15000),funding:fresh(this.funding,20000),oi:0,liquidationSymbols:this.liq.size},count:this.count,pending:this.pending.size,cost:{feePerSide:FEE,slippagePerSide:SLIP,notional:N,spread:'observed bid/ask',fundingCross:'excluded'},limitations:['L1 sampled OFI not full depth','OI not collected','liquidation snapshot context only','no orders','pending outcomes discarded on restart']};}
}
export function selfTest(){
 const now=1800000000000,q={e:'bookTicker',E:now,s:'BTCUSDT',b:'99.9',a:'100.1',B:'10',A:'10',st:1};assert.equal(parseQuote({...q,st:2},now),null);assert.equal(parseQuote(q,now+20000),null);
 const a=parseQuote(q,now),b=parseQuote({...q,E:now+M,b:'101',a:'101.2'},now+M);assert(returns(a,b)[0]>0);assert(returns(a,b)[1]<0);assert.equal(returns({...a,bq:.01},b),null);
 const m=new InstitutionalShadow();m.pending.set('BTCUSDT:5',{s:'BTCUSDT',t:now,x:[1,0,0,0,0,0,0,0,0,0],entry:null,next:now+3600000,side:0,pred:null,context:{}});
 m.quote(q,now);assert.equal(m.pending.get('BTCUSDT:5').entry,null);m.quote({...q,E:now+1000},now+1000);assert.equal(m.models[5][0].n,0);
 m.quote({...q,E:now+301000,b:'101',a:'101.2'},now+301000);assert.equal(m.models[5][0].n,1);assert.equal(m.models[5][0].selected,0);
 assert.equal(new InstitutionalShadow(JSON.parse(JSON.stringify(m.snapshot()))).models[5][0].n,1);
 console.log('Institutional shadow self-test PASS: quote freshness, executable cost, causal labels, restoration');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)selfTest();
