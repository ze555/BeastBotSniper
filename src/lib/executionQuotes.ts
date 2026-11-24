import axios from "axios";
import WebSocket from "ws";
import { type Quote, validQuote } from "./tradingIntegrity.js";

export const EXECUTION_PUBLIC_WS="wss://fstream.binance.com/public/stream";
const REST="https://fapi.binance.com",MAX_TRACKED=40;
type Source="WS_BOOK_TICKER"|"WS_PARTIAL_DEPTH"|"REST_BOOK_TICKER"|"REST_DEPTH";
type SourcedQuote=Quote&{source:Source};
const metrics={wsFrames:0,wsAccepted:0,wsRejected:0,wsHits:0,restTickerHits:0,restDepthHits:0,failures:0,retries:0,rateLimits:0,reconnects:0};
const desired=new Set<string>(),subscribed=new Set<string>(),quotes=new Map<string,SourcedQuote>();
const inflight=new Map<string,Promise<SourcedQuote>>();
let socket:WebSocket|null=null,nextConnect=0,connectedAt=0,lastFrame=0,lastError="",backoffUntil=0,lastSync=0,seq=0;
let syncTimer:ReturnType<typeof setTimeout>|null=null;
const goodSymbol=(s:unknown):s is string=>typeof s==="string"&&/^[\p{L}\p{N}_]{3,40}$/u.test(s);
function fresh(q:Quote|null|undefined,maxAge:number,now=Date.now()):q is Quote{
  return !!q&&validQuote(q,now)&&now-q.time<=maxAge;
}
/** The exchange timestamp is mandatory; never replace it with receipt time.
 * Transaction time wins over event time when both are provided. */
export function decodeExecutionFrame(frame:any,now=Date.now()):{symbol:string;quote:SourcedQuote}|null{
  const d=frame?.data??frame;
  if(!goodSymbol(d?.s))return null;
  const book=d.e==="bookTicker",depth=d.e==="depthUpdate";
  if(!book&&!depth)return null;
  const quote:SourcedQuote={bid:Number(book?d.b:d.b?.[0]?.[0]),ask:Number(book?d.a:d.a?.[0]?.[0]),
    time:Number(d.T??d.E),source:book?"WS_BOOK_TICKER":"WS_PARTIAL_DEPTH"};
  if(!fresh(quote,5000,now)||quote.ask<=quote.bid)return null;
  return {symbol:d.s.toUpperCase(),quote};
}
function streamNames(s:string){return [s.toLowerCase()+"@bookTicker",s.toLowerCase()+"@depth5@500ms"];}
function sync(){
  if(socket?.readyState!==WebSocket.OPEN)return;
  if(Date.now()-lastSync<1000){
    if(!syncTimer){syncTimer=setTimeout(()=>{syncTimer=null;sync();},1000);syncTimer.unref?.();}
    return;
  }
  const remove=[...subscribed].filter(s=>!desired.has(s)),add=[...desired].filter(s=>!subscribed.has(s));
  if(!remove.length&&!add.length)return;
  lastSync=Date.now();
  try{
    for(const [method,ss] of [["UNSUBSCRIBE",remove],["SUBSCRIBE",add]] as const){
      if(!ss.length)continue;
      socket.send(JSON.stringify({method,params:ss.flatMap(streamNames),id:++seq}));
    }
    for(const s of remove){subscribed.delete(s);quotes.delete(s);}
    for(const s of add)subscribed.add(s);
  }catch(e:any){lastError=String(e?.message||e);socket.terminate();}
}
function connect(){
  const now=Date.now();
  if(!desired.size)return;
  if(socket?.readyState===WebSocket.OPEN){
    if(now-connectedAt>45000&&now-lastFrame>45000){lastError="PUBLIC_STREAM_STALLED";socket.terminate();}
    else sync();
    return;
  }
  if(socket?.readyState===WebSocket.CONNECTING||now<nextConnect)return;
  nextConnect=now+15000;
  const ws=new WebSocket(EXECUTION_PUBLIC_WS,{handshakeTimeout:10000});
  socket=ws;metrics.reconnects++;
  ws.on("open",()=>{if(socket!==ws)return;connectedAt=Date.now();lastFrame=connectedAt;subscribed.clear();quotes.clear();lastSync=0;sync();});
  ws.on("message",raw=>{
    if(socket!==ws)return;
    lastFrame=Date.now();metrics.wsFrames++;
    let frame:any;try{frame=JSON.parse(raw.toString());}catch{metrics.wsRejected++;return;}
    if(frame?.error||frame?.code!==undefined){lastError="PUBLIC_SUBSCRIBE: "+String(frame?.error?.msg??frame?.msg??frame?.code);ws.terminate();return;}
    if(frame?.id!==undefined)return;
    const decoded=decodeExecutionFrame(frame,lastFrame);
    if(!decoded){metrics.wsRejected++;return;}
    if(!desired.has(decoded.symbol))return;
    const prev=quotes.get(decoded.symbol);
    if(prev&&prev.time>decoded.quote.time)return;
    quotes.set(decoded.symbol,decoded.quote);metrics.wsAccepted++;
  });
  ws.on("error",e=>{lastError=String(e.message).slice(0,160);});
  ws.on("close",()=>{if(socket===ws){socket=null;subscribed.clear();quotes.clear();connectedAt=0;}});
}
export function syncExecutionQuoteSymbols(symbols:string[]){
  const next=new Set(symbols.filter(goodSymbol).map(s=>s.toUpperCase()).slice(0,MAX_TRACKED));
  for(const s of desired)if(!next.has(s))quotes.delete(s);
  desired.clear();for(const s of next)desired.add(s);
  if(!desired.size){if(socket){const ws=socket;socket=null;ws.close();}subscribed.clear();quotes.clear();return;}
  connect();
}
export function executionQuoteHealth(){
  return {...metrics,endpoint:EXECUTION_PUBLIC_WS,connected:socket?.readyState===WebSocket.OPEN,trackedSymbols:desired.size,
    cachedQuotes:quotes.size,lastFrame,lastError,restBackoffUntil:backoffUntil||null};
}
function wsQuote(symbol:string,maxAge:number){
  const q=quotes.get(symbol);
  return socket?.readyState===WebSocket.OPEN&&desired.has(symbol)&&fresh(q,maxAge)?q as SourcedQuote:null;
}
function errorReason(e:any){
  const status=Number(e?.response?.status);
  if(status===429||status===418){
    metrics.rateLimits++;
    const seconds=Number(e?.response?.headers?.["retry-after"]);
    backoffUntil=Math.max(backoffUntil,Date.now()+1000*(Number.isFinite(seconds)&&seconds>0?Math.min(300,seconds):30));
  }
  return String(e?.response?.status||e?.code||e?.message||"NETWORK_ERROR").slice(0,120);
}
export function decodeRestQuote(data:any,symbol:string,source:"REST_BOOK_TICKER"|"REST_DEPTH",maxAge=3000,now=Date.now()):SourcedQuote|null{
  if(source==="REST_BOOK_TICKER"&&data?.symbol!==symbol)return null;
  const q:SourcedQuote={bid:Number(source==="REST_BOOK_TICKER"?data?.bidPrice:data?.bids?.[0]?.[0]),
    ask:Number(source==="REST_BOOK_TICKER"?data?.askPrice:data?.asks?.[0]?.[0]),
    time:Number(source==="REST_BOOK_TICKER"?data?.time:data?.T??data?.E),source};
  return fresh(q,maxAge,now)&&q.ask>q.bid?q:null;
}
async function acquire(symbol:string,maxAge:number):Promise<SourcedQuote>{
  const cached=wsQuote(symbol,maxAge);
  if(cached){metrics.wsHits++;return cached;}
  if(desired.has(symbol))connect();
  let primary="BOOK_TICKER_UNAVAILABLE",secondary="DEPTH_UNAVAILABLE";
  for(let attempt=0;attempt<2;attempt++){
    if(attempt){metrics.retries++;await new Promise(r=>setTimeout(r,120));}
    const ws=wsQuote(symbol,maxAge);if(ws){metrics.wsHits++;return ws;}
    if(Date.now()<backoffUntil){primary="REST_RATE_LIMIT_BACKOFF";break;}
    try{
      const res=await axios.get(REST+"/fapi/v1/ticker/bookTicker",{params:{symbol},timeout:1800});
      const q=decodeRestQuote(res.data,symbol,"REST_BOOK_TICKER",maxAge);
      if(q){metrics.restTickerHits++;return q;}
      primary="BOOK_TICKER_STALE_OR_INVALID";
    }catch(e:any){primary=errorReason(e);}
    const newer=wsQuote(symbol,maxAge);if(newer){metrics.wsHits++;return newer;}
    if(Date.now()<backoffUntil)break;
    try{
      const res=await axios.get(REST+"/fapi/v1/depth",{params:{symbol,limit:5},timeout:1800});
      const q=decodeRestQuote(res.data,symbol,"REST_DEPTH",maxAge);
      if(q){metrics.restDepthHits++;return q;}
      secondary="DEPTH_STALE_OR_INVALID";
    }catch(e:any){secondary=errorReason(e);}
    // Retry only a quick invalid response; repeated network timeouts must not
    // delay position protection indefinitely.
    if(/timeout|ECONN|ETIMEDOUT/i.test(primary+" "+secondary))break;
  }
  const last=wsQuote(symbol,maxAge);if(last){metrics.wsHits++;return last;}
  metrics.failures++;
  throw Error("EXECUTION_QUOTE_UNAVAILABLE: "+primary+"; secondary="+secondary);
}
/** One in-flight quote fetch per symbol/age, fresh real bid/ask only. */
export async function fetchExecutionQuote(symbol:string,maxAge=3000):Promise<SourcedQuote>{
  const key=symbol+":"+maxAge;
  const existing=inflight.get(key);if(existing)return existing;
  const p=acquire(symbol,maxAge).finally(()=>inflight.delete(key));inflight.set(key,p);return p;
}
