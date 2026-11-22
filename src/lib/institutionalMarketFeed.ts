/**
 * Binance USD-M routed market WebSocket, active and pending PAPER symbols only.
 * Aggressive taker flow is real-time. Open-interest and book snapshots are REST.
 * No client orders, no fake data, no full-universe WebSocket subscriptions.
 */
import axios from "axios";
import WebSocket from "ws";
import {parseOpenInterestHistory} from "./entryValidation.js";
import type {MarketContext,LiveAggWindow} from "./institutionalReversal.js";
export const USD_M_MARKET_WS="wss://fstream.binance.com/market/stream";
const REST="https://fapi.binance.com";
const MAX_TRACKED=40;
const CONNECT_RETRY_MS=15000;
type Bucket={second:number;notional:number;signed:number;count:number;at:number};
type Liquidation={at:number;side:string;notional:number};
type State={
 buckets:Bucket[];forced:Liquidation[];book:MarketContext["book"];
 oi:MarketContext["oi"];taker:MarketContext["taker"];top:MarketContext["topTraders"];
 bookFetch:number;ratioFetch:number;latestAgg:number;
};
const state=new Map<string,State>();
const tracked=new Set<string>(),subscribed=new Set<string>();
const outstanding=new Map<number,{method:"SUBSCRIBE"|"UNSUBSCRIBE";symbols:string[]}>();
let socket:WebSocket|null=null,attemptAt=0,connectedAt=0,lastReceivedAt=0,lastAggAt=0;
let seq=0,reconnects=0,frameCount=0,tradeEvents=0,liquidationEvents=0,invalidMessages=0,
  subscriptionAcks=0,subscriptionErrors=0,errors=0,lastError="";
const emptyState=():State=>({buckets:[],forced:[],book:null,oi:null,taker:null,top:null,
  bookFetch:0,ratioFetch:0,latestAgg:0});
const streamNames=(symbol:string)=>[symbol.toLowerCase()+"@aggTrade",symbol.toLowerCase()+"@forceOrder"];
/** Pure decoder for replay testing real Binance taker-side semantics. */
export function decodeAggTrade(data:any,now=Date.now()){
  if(data?.e!=="aggTrade" || typeof data?.m!=="boolean" ||
     !/^[A-Z0-9]{3,40}$/.test(String(data?.s||"")))return null;
  const at=Number(data.T??data.E),price=Number(data.p),qty=Number(data.q);
  if(!Number.isFinite(at)||at>now+1000||now-at>10000||
     !(price>0&&qty>0&&Number.isFinite(price*qty)))return null;
  const notional=price*qty;
  // Binance 'm' = buyer is market maker, so taker SELL when true.
  return {symbol:data.s as string,at,notional,signed:data.m?-notional:notional};
}
function send(method:"SUBSCRIBE"|"UNSUBSCRIBE",symbols:string[]){
  if(socket?.readyState!==WebSocket.OPEN || !symbols.length)return;
  const id=++seq;
  const names=symbols.flatMap(streamNames);
  outstanding.set(id,{method,symbols});
  try{socket.send(JSON.stringify({method,params:names,id}),e=>{
    if(e){errors++;lastError="WS_SEND: "+e.message;outstanding.delete(id);}
  });}catch(e:any){errors++;lastError="WS_SEND: "+String(e?.message||e);outstanding.delete(id);}
}
export function recordMarketFrame(raw:unknown,now=Date.now()):void{
  let frame:any;
  try{frame=typeof raw==="string"?JSON.parse(raw):raw;}
  catch{invalidMessages++;return;}
  if(!frame || typeof frame!=="object"){invalidMessages++;return;}
  frameCount++;lastReceivedAt=now;
  if(frame.id!==undefined && (Object.prototype.hasOwnProperty.call(frame,"result")||frame.error)){
    const req=outstanding.get(Number(frame.id));
    outstanding.delete(Number(frame.id));
    if(frame.error){subscriptionErrors++;lastError="BINANCE_SUBSCRIBE: "+String(frame.error.msg||frame.error.code).slice(0,150);return;}
    if(frame.result===null){
      subscriptionAcks++;
      if(req){
        for(const s of req.symbols){
          if(req.method==="SUBSCRIBE" && tracked.has(s))subscribed.add(s);
          else if(req.method==="UNSUBSCRIBE")subscribed.delete(s);
        }
      }
    }
    return;
  }
  const data=frame.data||frame;
  const symbol=String(data?.s||data?.o?.s||"").toUpperCase(),st=state.get(symbol);
  if(!st || !tracked.has(symbol) || !subscribed.has(symbol))return;
  const t=Number(data?.T??data?.E),event=String(data?.e||"");
  if(!Number.isFinite(t)||t>now+1000||now-t>10000)return;
  if(event==="aggTrade"){
    const decoded=decodeAggTrade(data,now);
    if(!decoded){invalidMessages++;return;}
    const n=decoded.notional,sec=Math.floor(t/1000);
    const last=st.buckets.at(-1);
    if(last && sec<last.second)return; // discard reordered packets rather than contaminating time series
    if(last?.second===sec){last.notional+=n;last.signed+=decoded.signed;last.count++;last.at=t;}
    else st.buckets.push({second:sec,notional:n,signed:decoded.signed,count:1,at:t});
    while(st.buckets.length>75 || (st.buckets[0]&&st.buckets[0].second*1000<now-90000))st.buckets.shift();
    st.latestAgg=t;lastAggAt=t;tradeEvents++;
  }else if(event==="forceOrder"){
    const order=data?.o,p=Number(order?.ap||order?.p),q=Number(order?.q);
    if(!(p>0&&q>0))return;
    st.forced.push({at:t,side:String(order.S),notional:p*q});
    while(st.forced.length>100 || (st.forced[0]&&st.forced[0].at<now-180000))st.forced.shift();
    liquidationEvents++;
  }
}
function connect(now=Date.now()){
  if(!tracked.size || now-attemptAt<CONNECT_RETRY_MS)return;
  if(socket?.readyState===WebSocket.OPEN)return;
  if(socket?.readyState===WebSocket.CONNECTING){
    if(now-attemptAt<15000)return;
    try{socket.terminate();}catch{}
    socket=null;
  }
  attemptAt=now;reconnects++;
  try{
    const ws=new WebSocket(USD_M_MARKET_WS,{handshakeTimeout:10000});
    socket=ws;
    ws.on("open",()=>{
      if(socket!==ws)return;
      connectedAt=Date.now();
      subscribed.clear();outstanding.clear();
      for(const st of state.values())st.buckets=[]; // new session needs a fresh 25s flow window
      send("SUBSCRIBE",[...tracked]);
    });
    ws.on("message",raw=>{if(socket===ws)recordMarketFrame(String(raw));});
    ws.on("ping",()=>{try{ws.pong();}catch{}});
    ws.on("error",(e:any)=>{errors++;lastError=String(e?.message||e).slice(0,150);});
    ws.on("close",(code:number)=>{
      if(socket!==ws)return;
      socket=null;subscribed.clear();outstanding.clear();connectedAt=0;
      for(const st of state.values()){st.buckets=[];st.latestAgg=0;}
      if(code!==1000){lastError="WS_CLOSED_"+code;errors++;}
    });
  }catch(e:any){errors++;lastError=String(e?.message||e);socket=null;}
}
export function syncInstitutionalSymbols(symbols:string[],enableWebsocket=true){
  const desired=new Set(symbols.filter(s=>/^[A-Z0-9]{3,40}$/.test(s)).slice(0,MAX_TRACKED));
  const remove=[...tracked].filter(s=>!desired.has(s));
  const add=[...desired].filter(s=>!tracked.has(s));
  for(const s of remove){tracked.delete(s);state.delete(s);subscribed.delete(s);}
  for(const s of add){tracked.add(s);state.set(s,emptyState());}
  if(!enableWebsocket){
    if(socket){const ws=socket;socket=null;try{ws.close(1000,"WebSocket setting disabled");}catch{}}
    subscribed.clear();outstanding.clear();connectedAt=0;
    for(const st of state.values()){st.buckets=[];st.latestAgg=0;}
    return; // REST snapshots for tracked PAPER positions continue normally
  }
  if(socket?.readyState===WebSocket.OPEN){
    send("UNSUBSCRIBE",remove);send("SUBSCRIBE",add);
  }
  if(!tracked.size){
    if(socket){const ws=socket;socket=null;try{ws.close(1000,"No PAPER market symbols");}catch{}}
    subscribed.clear();outstanding.clear();
    return;
  }
  if(!socket || socket.readyState===WebSocket.CLOSED)connect();
}
const lastPublished=(raw:any,now:number)=>{
  if(!Array.isArray(raw))return null;
  return raw.filter(x=>Number.isFinite(Number(x.timestamp))&&Number(x.timestamp)<=now-300000 &&
    now-Number(x.timestamp)<=900000).sort((a,b)=>Number(b.timestamp)-Number(a.timestamp))[0]||null;
};
export async function refreshInstitutionalEvidence(symbol:string,now=Date.now(),enableWebsocket=true){
  const st=state.get(symbol);
  if(!st)return;
  // Detect a falsely 'open' socket and recover from missing subscription/event traffic.
  if(enableWebsocket && socket?.readyState===WebSocket.OPEN && connectedAt && now-connectedAt>45000){
    const waiting=outstanding.size>0;
    const noAnyData=now-lastReceivedAt>45000 && !waiting;
    const noAcknowledgement=subscribed.size===0 && now-connectedAt>45000;
    if(noAnyData || noAcknowledgement){lastError="MARKET_STREAM_STALLED";socket.terminate();return;}
  }
  if(enableWebsocket && (!socket || socket.readyState===WebSocket.CLOSED || socket.readyState===WebSocket.CONNECTING))connect(now);
  if(now-st.bookFetch>=60000){
    st.bookFetch=now;
    try{
      const r=await axios.get(REST+"/fapi/v1/depth",{params:{symbol,limit:20},timeout:2500});
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
    const urls=[REST+"/futures/data/openInterestHist",REST+"/futures/data/takerlongshortRatio",
      REST+"/futures/data/topLongShortPositionRatio"];
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
  const st=state.get(symbol);
  if(st){while(st.buckets.length&&st.buckets[0].second*1000<now-45000)st.buckets.shift();
    while(st.forced.length&&st.forced[0].at<now-180000)st.forced.shift();}
  const recent=st?.buckets.filter(b=>b.at>=now-45000&&b.at<=now+1000)||[];
  const total=recent.reduce((sum,b)=>sum+b.notional,0),
    signed=recent.reduce((sum,b)=>sum+b.signed,0),
    count=recent.reduce((sum,b)=>sum+b.count,0);
  const first=recent[0]?.second*1000||now,last=recent.at(-1)?.at||0;
  const agg:LiveAggWindow=recent.length?{
    delta:total>0?signed/total:0,notional:total,count,asOf:last,
    complete:socket?.readyState===WebSocket.OPEN && subscribed.has(symbol) &&
      now-last<=12000 && now-first>=25000 && count>=5
  }:null;
  const liq=st?.forced||[];
  return {at:now,agg,book:st?.book||null,oi:st?.oi||null,taker:st?.taker||null,
    topTraders:st?.top||null,
    liquidations:liq.length?{longNotional:liq.filter(x=>x.side==="SELL").reduce((n,x)=>n+x.notional,0),
      shortNotional:liq.filter(x=>x.side==="BUY").reduce((n,x)=>n+x.notional,0),asOf:liq.at(-1)!.at}:null};
}
export function institutionalHealth(){
  return {connected:socket?.readyState===WebSocket.OPEN,endpoint:USD_M_MARKET_WS,
    trackedSymbols:[...tracked],confirmedSymbols:[...subscribed],events:tradeEvents+liquidationEvents,
    aggTradeEvents:tradeEvents,forceOrderEvents:liquidationEvents,receivedFrames:frameCount,
    subscriptionAcks,subscriptionErrors,invalidMessages,errors,reconnects,lastError:lastError||null,
    activeFeeds:state.size,lastReceivedAt:lastReceivedAt||null,lastAggTradeAt:lastAggAt||null,
    streamReady:socket?.readyState===WebSocket.OPEN && subscribed.size>0 &&
      Date.now()-lastAggAt<30000};
}
