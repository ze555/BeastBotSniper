import assert from "node:assert/strict";
import axios from "axios";
import {decodeExecutionFrame,decodeRestQuote,fetchExecutionQuote} from "./executionQuotes.js";
const now=Date.now(),book={e:"bookTicker",s:"BTCUSDT",b:"100",a:"100.1",T:now-100,E:now};
assert.equal(decodeExecutionFrame({data:book},now)?.quote.source,"WS_BOOK_TICKER");
assert.equal(decodeExecutionFrame({...book,T:now-6000},now),null);
assert.equal(decodeExecutionFrame({...book,T:undefined,E:undefined},now),null);
assert.equal(decodeExecutionFrame({...book,a:"99"},now),null);
assert.equal(decodeExecutionFrame({e:"depthUpdate",s:"BTCUSDT",T:now,b:[["100","2"]],a:[["100.1","3"]]},now)?.quote.source,"WS_PARTIAL_DEPTH");
assert.equal(decodeRestQuote({symbol:"ETHUSDT",bidPrice:100,askPrice:101,time:now},"BTCUSDT","REST_BOOK_TICKER",3000,now),null);
assert.equal(decodeRestQuote({bids:[[100,2]],asks:[[101,2]],T:now-4000},"BTCUSDT","REST_DEPTH",3000,now),null);
const original=axios.get;let calls=0;
axios.get=(async(url:string)=>{calls++;if(url.includes("bookTicker"))return {data:{symbol:"BTCUSDT",bidPrice:"100",askPrice:"101",time:Date.now()-9000}};return {data:{bids:[["100","1"]],asks:[["101","1"]],T:Date.now()}};}) as any;
try{const [q1,q2]=await Promise.all([fetchExecutionQuote("BTCUSDT"),fetchExecutionQuote("BTCUSDT")]);assert.equal(q1.source,"REST_DEPTH");assert.deepEqual(q1,q2);assert.equal(calls,2);}finally{axios.get=original;}
console.log("Execution quote: exchange timestamp, stale/crossed rejection, depth fallback and in-flight coalescing passed");
