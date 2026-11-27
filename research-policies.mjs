import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const HOUR=3600000,DAY=24*HOUR,FEE=.0007,MEAN=a=>a.reduce((s,x)=>s+x,0)/a.length,SD=a=>Math.sqrt(a.reduce((s,x)=>s+(x-MEAN(a))**2,0)/Math.max(1,a.length-1)),f=Number.isFinite;
const NAMES=['momentum','absorption','depth_flow','carry_reversal','ridge'];
export function retryUntil(raw,now,status=418,body=''){
 const base=status===418?15*60000:2*60000;
 const msg=String(body).match(/banned until\s+(\d{10,16})/i);
 const n=raw==null||raw===''?NaN:Number(raw),d=Number.isFinite(n)?(n>=1e12?n:n>=1e9?n*1000:now+n*1000):Date.parse(raw||'');
 let end=Number.isFinite(d)?d:now+base;
 if(msg){let x=Number(msg[1]);if(x<1e12)x*=1000;if(Number.isFinite(x))end=Math.max(end,x);}
 return Math.max(now+base,end);
}
export function restoreCooldown(x,now){
 const n=Number(x);if(!Number.isFinite(n)||n<=now)return 0;
 // v0.4 multiplied an absolute timestamp by 1000. Unknown original expiry: conservative quarantine.
 if(n>now+365*DAY)return now+3*DAY;return n;
}
export function safeDelay(ms){return Math.max(1000,Math.min(60000,Number.isFinite(ms)?ms:60000));}
export function signals(c,pred){
 const out={};
 const direction=Math.sign(c.ret);
 if(Math.abs(c.ret)>Math.max(.0015,c.sigma*1.5)&&Math.abs(c.cvd)>.08&&Math.sign(c.cvd)===direction)out.momentum=direction;
 if(Math.abs(c.cvd)>.12&&Math.abs(c.ret)>.001&&Math.sign(c.cvd)!==direction)out.absorption=direction;
 if(f(c.depthImbalance)&&Math.abs(c.ofi)>.025&&Math.abs(c.depthImbalance)>.12&&Math.sign(c.ofi)===Math.sign(c.depthImbalance)&&Math.sign(c.cvd)===Math.sign(c.ofi))out.depth_flow=Math.sign(c.ofi);
 if(Math.abs(c.funding)>.0005&&Math.abs(c.basis)>.0002&&Math.sign(c.funding)===Math.sign(c.basis)&&direction!==Math.sign(c.funding))out.carry_reversal=-Math.sign(c.funding);
 if(Array.isArray(pred)&&pred.every(f)&&Math.max(...pred)>.001)out.ridge=pred[0]>=pred[1]?1:-1;
 return out;
}
// Approximation to standard normal CDF/inverse. Block-based diagnostics, not a portfolio Sharpe.
function cdf(x){const z=Math.abs(x),t=1/(1+.2316419*z),p=1-Math.exp(-z*z/2)/Math.sqrt(2*Math.PI)*t*(.31938153+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?p:1-p;}
function inv(p){let lo=-8,hi=8;for(let j=0;j<55;j++){const x=(lo+hi)/2;if(cdf(x)<p)lo=x;else hi=x;}return (lo+hi)/2;}
export function bootstrapLower(values){
 if(values.length<24)return null;
 let seed=24681357;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},samples=[];
 for(let j=0;j<300;j++){let sum=0,n=0;while(n<values.length){const k=Math.floor(rand()*values.length);for(let d=0;d<4&&n<values.length;d++,n++)sum+=values[(k+d)%values.length];}samples.push(sum/values.length);}
 samples.sort((a,b)=>a-b);return samples[Math.floor(samples.length*.025)];
}
export function deflated(values,trialSharpe,nTrials){
 if(values.length<24||trialSharpe.length<2)return null;
 const avg=MEAN(values),sd=SD(values);if(!(sd>1e-12))return null;
 const sr=avg/sd,sk=MEAN(values.map(x=>((x-avg)/sd)**3)),ku=MEAN(values.map(x=>((x-avg)/sd)**4));
 const k=Math.max(2,nTrials),gamma=.5772156649,benchmark=SD(trialSharpe)*((1-gamma)*inv(1-1/k)+gamma*inv(1-1/(k*Math.E)));
 const den=1-sk*sr+(ku-1)*sr*sr/4;if(!(den>0))return null;
 return cdf((sr-benchmark)*Math.sqrt(values.length-1)/Math.sqrt(den));
}
export class ResearchLab{
 constructor(saved){this.data=saved?.version===1?saved.data:{};this.cache=null;this.cacheAt=0;}
 observe(h,p,y,t){
 const hour=Math.floor(p.t/HOUR);for(const name of NAMES){
 const key=h+':'+name,a=this.data[key]??={};const b=a[hour]??={opportunities:0,n:0,net:0,stress:0,gp:0,gl:0,wins:0};
 b.opportunities++;const side=p.candidates?.[name];if(side===1||side===-1){const r=y[side===1?0:1];if(f(r)){b.n++;b.net+=r;b.stress+=r-2*FEE;if(r>0){b.gp+=r;b.wins++;}else b.gl-=r;}}
 const keys=Object.keys(a).map(Number).sort((a,b)=>a-b);while(keys.length>336)delete a[keys.shift()];
 } }
 report(now=Date.now()){
 if(this.cache&&now-this.cacheAt<60000)return this.cache;
 const end=Math.floor((now-61*60000)/HOUR),keys=Object.keys(this.data),raw={};
 for(const key of keys){const bs=Object.entries(this.data[key]).filter(([k])=>Number(k)<end).sort((a,b)=>Number(a[0])-Number(b[0]));if(!bs.length)continue;const v=bs.map(([,b])=>b.net/Math.max(1,b.opportunities));const n=bs.reduce((s,[,b])=>s+b.n,0),sum=k=>bs.reduce((s,[,b])=>s+b[k],0);
 raw[key]={v,n,blocks:v.length,net:sum('net'),stress:sum('stress'),gp:sum('gp'),gl:sum('gl'),wins:sum('wins'),sharpe:SD(v)>1e-12?MEAN(v)/SD(v):0};}
 const trialSharpe=Object.values(raw).filter(r=>r.blocks>=24).map(r=>r.sharpe),trials=Math.max(20,keys.length);
 const policies={};for(const [key,r] of Object.entries(raw)){const lower=bootstrapLower(r.v),dsr=deflated(r.v,trialSharpe,trials),pf=r.gl?r.gp/r.gl:null;
 policies[key]={trades:r.n,hourBlocks:r.blocks,netUSD100:r.net*100,stressUSD100:r.stress*100,profitFactor:pf,winRate:r.n?r.wins/r.n:null,blockMeanLowerBps:lower===null?null:lower*10000,blockSharpe:r.sharpe,deflatedSharpeApprox:dsr,expectedNet:r.n?r.net/r.n:null,eligible:r.n>=100&&r.blocks>=24&&r.net>0&&r.stress>0&&pf!==null&&pf>=1.2&&lower>0&&dsr!==null&&dsr>=.95};}
 return this.cache=(this.cacheAt=now,{policies,trials,validation:'causal hourly clusters, 4-hour moving-block bootstrap, approximate DSR across policy variants; not account-level returns',minimum:{trades:100,hours:24,profitFactor:1.2,dsr:.95}});
 }
 choose(candidates,h,now){const r=this.report(now).policies;return Object.entries(candidates).map(([name,side])=>({name,side,stat:r[h+':'+name]})).filter(x=>x.stat?.eligible&&x.stat.expectedNet>0).sort((a,b)=>b.stat.expectedNet-a.stat.expectedNet)[0]||null;}
 snapshot(){return {version:1,data:this.data};}
}
export function selfTest(){
 const now=1800000000000;assert.equal(retryUntil('120',now,429),now+120000);assert.equal(retryUntil(String(now+180000),now,429),now+180000);assert.equal(retryUntil(String((now+180000)/1000),now,429),now+180000);assert.equal(safeDelay(4e15),60000);assert.equal(restoreCooldown(4e15,now),now+3*DAY);
 assert.equal(signals({ret:.004,sigma:.001,cvd:.4,ofi:.2,depthImbalance:.3,funding:0,basis:0},null).momentum,1);
 assert.equal(signals({ret:-.004,sigma:.001,cvd:.4,ofi:.2,depthImbalance:null,funding:0,basis:0},null).absorption,-1);
 const l=new ResearchLab();l.observe(5,{t:now,candidates:{momentum:1}},[.02,-.02],now+300000);assert.equal(l.choose({momentum:1},5,now),null);assert.equal(new ResearchLab(l.snapshot()).data['5:momentum'][Math.floor(now/HOUR)].net,.02);assert(bootstrapLower(Array(30).fill(.001))>0);
 console.log('Research policy tests PASS: ban timer, real-feature rules, causal attribution, bootstrap and gates');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)selfTest();
