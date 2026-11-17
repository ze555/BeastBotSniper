import axios from 'axios';
import { Quote, validQuote } from './tradingIntegrity.js';
/** No cached fallback: a failed request must never become an executable quote. */
export async function fetchExecutionQuote(symbol: string): Promise<Quote> {
  const res = await axios.get('https://fapi.binance.com/fapi/v1/ticker/bookTicker', {
    params: {symbol}, timeout: 3000
  });
  const q = {bid: Number(res.data.bidPrice), ask: Number(res.data.askPrice), time: Number(res.data.time)};
  if (res.data.symbol !== symbol || !validQuote(q)) throw new Error(`Invalid/stale executable quote: ${symbol}`);
  return q;
}
