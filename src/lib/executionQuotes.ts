import axios from "axios";
import { type Quote, validQuote } from "./tradingIntegrity.js";

/**
 * Only observable Binance orderbook best bid/ask. No last-trade/mid-price fallback,
 * cached quotes or invented timestamps. If bookTicker is stale/unavailable, attempt
 * a second independent, current top-of-book observation from /fapi/v1/depth.
 */
export async function fetchExecutionQuote(symbol:string):Promise<Quote>{
  let primaryError="BOOK_TICKER_UNAVAILABLE";
  try{
    const res=await axios.get("https://fapi.binance.com/fapi/v1/ticker/bookTicker",{
      params:{symbol},timeout:3000
    });
    const q={bid:Number(res.data?.bidPrice),ask:Number(res.data?.askPrice),time:Number(res.data?.time)};
    if(res.data?.symbol===symbol && validQuote(q))return q;
    primaryError="BOOK_TICKER_STALE_OR_INVALID";
  }catch(e:any){
    primaryError=String(e?.response?.status||e?.code||"BOOK_TICKER_NETWORK_ERROR");
  }
  try{
    const res=await axios.get("https://fapi.binance.com/fapi/v1/depth",{
      params:{symbol,limit:5},timeout:3500
    });
    const d=res.data;
    const q={bid:Number(d?.bids?.[0]?.[0]),ask:Number(d?.asks?.[0]?.[0]),time:Number(d?.T||d?.E)};
    if(validQuote(q))return q;
    throw new Error("DEPTH_STALE_OR_INVALID");
  }catch(e:any){
    throw new Error("EXECUTION_QUOTE_UNAVAILABLE: "+primaryError+"; secondary="+
      String(e?.message||e?.code||e?.response?.status||"DEPTH_ERROR"));
  }
}
