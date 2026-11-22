/** Bounded paper-position-only Binance market evidence collector. Never places orders.
 * WebSocket executed aggTrades and liquidation hints; REST orderbook once/60s,
 * published 5m OI, taker ratio and top-trader position ratios once/5m.
 * All evidence is timestamped and stale data is ignored by the decision layer.
 */
import axios from "axios";
import WebSocket from "ws";
import {parseOpenInterestHistory} from "./entryValidation.js";
import type {MarketContext,LiveAggWindow} from "./institutionalReversal.js";
const BASE="https://fapi.binance.com";
type Agg={at:number;notional:number;signed:number};
type Forced={at:number;side:string;notional:number};
type State={aggs:Agg[];forced:Forced[];book:MarketContext["book"];
  oi:MarketContext["oi"];taker:MarketContext["taker"];top:MarketContext["topTraders"];
  bookFetch:number;ratioFetch:number;latestAgg:number};
const state=new Map<string,State>();
const tracked=new Set<string>();
let socket:WebSocket|null=null,connectAttempt=0,seq=0,wireMessages=0,invalidMessages=0,errors=0;
const make=():State=>({aggs:[],forced:[],book:null,oi:null,taker:null,top:null,bookFetch:0,ratioFetch:0,latestAgg:0});
const sym=(x:string)=>x.toLowerCase().replace(/[^a-z0-9]/g,"");
const streams=(s:string)=>[sym(s)+"@aggTrade",sym(s)+"@forceOrder"];
const push=(method:"SUBSCRIBE"|"UNSUBSCRIBE",names:string[])=>{
  if(socket?.readyState!==WebSocket.OPEN||!names.length)return;
  socket.send(JSON.stringify({method,params:names.flatMap(streams),id:++seq}));
};
function connect(){
  if(!tracked.size||socket||Date.now()-connectAttempt<15000)return;
  connectAttempt=Date.now();
  try{
    const ws=new WebSocket("wss://fstream.binance.com/ws");
    socket=ws;
    ws.on("open",()=>{push("SUBSCRIBE",[...tracked]);});
    ws.on("message",(raw)=>{
      try{
        const frame=JSON.parse(String(raw)),e=frame?.data||frame;
        const symbol=String(e?.s||e?.o?.s||"").toUpperCase(),st=state.get(symbol);
        if(!st)return;
        const eventTime=Number(e?.T||e?.E||0),now=Date.now();
        if(eventTime>now+1000||eventTime<now-120000)return;
        if(e.e==="aggTrade"){
          const p=Number(e.p),q=Number(e.q);
          if(!(p>0&&q>0))return;
          const n=p*q;
          st.aggs.push({at:eventTime,notional:n,signed:(e.m?-1:1)*n});
          st.latestAgg=eventTime;
          if(st.aggs.length>3000)st.aggs.splice(0,st.aggs.length-3000);
          wireMessages++;
        }else if(e.e==="forceOrder"){
          const o=e.o,p=Number(o?.ap||o?.p),q=Number(o?.q);
          if(!(p>0&&q>0))return;
          st.forced.push({at:eventTime,side:String(o.S),notional:p*q});
          if(st.forced.length>300)st.forced.splice(0,st.forced.length-300);
          wireMessages++;
        }
      }catch{invalidMessages++;}
    });
    ws.on("ping",()=>{try{ws.pong();}catch{}});
    ws.on("error",()=>{errors++;});
    ws.on("close",()=>{
      if(socket===ws)socket=null;
      // Stale/discontinuous aggregate flow must not trigger an exit.
      for(const st of state.values()){st.aggs=[];st.latestAgg=0;}
    });
  }catch{socket=null;errors++;}
}
export function syncInstitutionalSymbols(symbols:string[]){
  const desired=new Set(symbols.filter(x=>/^[A-Z0-9]{3,24}$/.test(x)).slice(0,10));
  const removing=[...tracked].filter(s=>!desired.has(s));
  const adding=[...desired].filter(s=>!tracked.has(s));
  push("UNSUBSCRIBE",removing);
  for(const s of removing){tracked.delete(s);state.delete(s);}
  for(const s of adding){tracked.add(s);state.set(s,make());}
  if(!tracked.size){
    if(socket){const old=socket;socket=null;old.close();}
    return;
  }
  if(socket?.readyState===WebSocket.OPEN)push("SUBSCRIBE",adding);
  connect();
}
const lastPublished=(raw:any,now:number)=>{
  if(!Array.isArray(raw))return null;
  return raw.filter(x=>Number.isFinite(Number(x.timestamp))&&Number(x.timestamp)<=now-300000 &&
    now-Number(x.timestamp)<=900000).sort((a,b)=>Number(b.timestamp)-Number(a.timestamp))[0]||null;
};
export async function refreshInstitutionalEvidence(symbol:string,now=Date.now()){
  const st=state.get(symbol);
  if(!st)return;
  // Reconnect from the existing protection loop after a Binance/WebSocket outage.
  // Without this, existing positions would stop receiving aggTrades until
  // another trade was opened or closed.
  if(!socket || socket.readyState===WebSocket.CLOSED)connect();
  if(now-st.bookFetch>=60000){
    st.bookFetch=now;
    try{
      const r=await axios.get(BASE+"/fapi/v1/depth",{params:{symbol,limit:20},timeout:2500});
      const d=r.data,t=Number(d?.T||d?.E||0),b=(d?.bids||[]).slice(0,20),a=(d?.asks||[]).slice(0,20);
      const bid=Number(b[0]?.[0]),ask=Number(a[0]?.[0]);
      if(!(t>0&&t<=Date.now()+1000&&Date.now()-t<=5000&&ask>bid&&bid>0))throw Error("STALE_BOOK");
      const B=b.reduce((v:any,x:any)=>v+Number(x[0])*Number(x[1]),0);
      const A=a.reduce((v:any,x:any)=>v+Number(x[0])*Number(x[1]),0);
      if(!Number.isFinite(B)||!Number.isFinite(A)||B+A<=0)throw Error("INVALID_DEPTH");
      st.book={imbalance:(B-A)/(B+A),depth:B+A,spread:(ask-bid)/((ask+bid)/2),at:t};
    }catch{st.book=null;errors++;}
  }
  if(now-st.ratioFetch>=300000){
    st.ratioFetch=now;
    const urls=[
      BASE+"/futures/data/openInterestHist",
      BASE+"/futures/data/takerlongshortRatio",
      BASE+"/futures/data/topLongShortPositionRatio"
    ];
    const results=await Promise.allSettled(urls.map(url=>axios.get(url,{
      params:{symbol,period:"5m",limit:5},timeout:3500
    })));
    const oi=results[0].status==="fulfilled"?parseOpenInterestHistory(results[0].value.data,Date.now()):null;
    st.oi=oi?{delta:oi.delta,time:oi.timestamp}:null;
    const taker=results[1].status==="fulfilled"?lastPublished(results[1].value.data,Date.now()):null;
    const ratio=taker?Number(taker.buySellRatio):NaN;
    st.taker=taker&&ratio>0&&Number.isFinite(ratio)?{ratio,at:Number(taker.timestamp)}:null;
    const top=results[2].status==="fulfilled"?lastPublished(results[2].value.data,Date.now()):null;
    const share=top?Number(top.longAccount):NaN;
    st.top=top&&Number.isFinite(share)&&share>=0&&share<=1?{longShare:share,at:Number(top.timestamp)}:null;
    errors+=results.filter(x=>x.status==="rejected").length;
  }
}
export function institutionalSnapshot(symbol:string,now=Date.now()):MarketContext{
  const st=state.get(symbol),all=st?.aggs||[];
  if(st){while(st.aggs.length&&st.aggs[0].at<now-90000)st.aggs.shift();
    while(st.forced.length&&st.forced[0].at<now-180000)st.forced.shift();}
  const a=all.filter(x=>x.at>=now-45000 && x.at<=now+1000);
  const nt=a.reduce((n,x)=>n+x.notional,0), signed=a.reduce((n,x)=>n+x.signed,0);
  const oldest=a[0]?.at||now,latest=a.at(-1)?.at||0;
  const agg:LiveAggWindow=a.length?{
    delta:nt>0?signed/nt:0,notional:nt,count:a.length,asOf:latest,
    complete:socket?.readyState===WebSocket.OPEN && now-latest<=12000 &&
      now-oldest>=25000 && a.length<3000
  }:null;
  const liq=st?.forced||[];
  return {at:now,agg,book:st?.book||null,oi:st?.oi||null,taker:st?.taker||null,
    topTraders:st?.top||null,
    liquidations:liq.length?{longNotional:liq.filter(x=>x.side==="SELL").reduce((n,x)=>n+x.notional,0),
      shortNotional:liq.filter(x=>x.side==="BUY").reduce((n,x)=>n+x.notional,0),asOf:liq.at(-1)!.at}:null};
}
export function institutionalHealth(){
  return {connected:socket?.readyState===WebSocket.OPEN,trackedSymbols:[...tracked],
    events:wireMessages,invalidMessages,errors,activeFeeds:state.size,
    lastAggTradeAt:Math.max(0,...[...state.values()].map(x=>x.latestAgg))||null};
}
