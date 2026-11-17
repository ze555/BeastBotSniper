/** Deterministic checks. Candle flow is a proxy, not tick OFI or trader identity. */
export const STRATEGY_REVISION = 'main-wave-integrity-v1';
export type Side = 'LONG' | 'SHORT';
export interface Quote { bid: number; ask: number; time: number }
export function validQuote(q: Quote, now = Date.now()): boolean {
  return [q.bid, q.ask, q.time].every(Number.isFinite) && q.bid > 0 && q.ask >= q.bid && q.time <= now + 1000 && now - q.time <= 5000;
}
export function closedCandles<T extends {closeTime: number}>(rows: T[], now = Date.now()): T[] {
  return rows.filter(k => Number.isFinite(k.closeTime) && k.closeTime < now);
}
export function tightenStop(t: {direction: string; sl: number}, candidate: number) {
  if (!Number.isFinite(candidate) || candidate <= 0) return;
  t.sl = t.direction === 'LONG' ? Math.max(t.sl, candidate) : Math.min(t.sl, candidate);
}
export function markTrade(t: any, price: number, fee: number, slip: number): boolean {
  if (!(Number.isFinite(price) && price > 0 && t.initialSlDist > 0)) return false;
  t.currentPrice = price;
  const sign = t.direction === 'LONG' ? 1 : -1;
  t.profitR = sign * (price - t.entry) / t.initialSlDist;
  t.peak_r = Math.max(t.peak_r || 0, t.profitR);
  t.highestPrice = Math.max(t.highestPrice || t.entry, price);
  t.lowestPrice = Math.min(t.lowestPrice || t.entry, price);
  const exit = price * (1 - sign * slip);
  t.pnl = (t.realizedPnl || 0) + sign * (exit - t.entry) * t.pos - (t.entry + exit) * t.pos * fee;
  return sign * (price - t.sl) <= 0;
}
export function waveEvidence(side: Side, candles: any[], quote: Quote, atr: number, fee: number, slip: number, now = Date.now()) {
  const fail = (reason: string) => ({allowed: false, reason});
  if (!validQuote(quote, now)) return fail('STALE_OR_INVALID_QUOTE');
  if (![fee,slip].every(x => Number.isFinite(x) && x >= 0 && x < 1)) return fail('INVALID_COST_CONFIG');
  const c = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!c || !prev || !Number.isFinite(c.closeTime) || c.closeTime >= now || now - c.closeTime > 6 * 60_000) return fail('STALE_CLOSED_5M');
  if (!(atr > 0 && c.volume > 0) || ![atr,c.open,c.close,prev.close,c.takerBuy,c.takerSell].every(Number.isFinite)) return fail('MISSING_FLOW');
  const sign = side === 'LONG' ? 1 : -1;
  // One execution-flow family plus a separate price-response test.
  const delta = c.takerBuy - c.takerSell;
  if (sign * delta <= 0) return fail('OPPOSING_EXECUTED_FLOW');
  if (sign * (c.close - c.open) <= 0 || sign * (c.close - prev.close) <= 0) return fail('FLOW_WITHOUT_PRICE_RESPONSE');
  const executable = side === 'LONG' ? quote.ask : quote.bid;
  if (sign * (executable - c.open) <= 0) return fail('IMPULSE_INVALIDATED');
  if (sign * (executable - c.close) > atr) return fail('LATE_CHASE');
  const cost = quote.ask - quote.bid + executable * 2 * (fee + slip);
  // Existing first target is .75R, with an existing minimum stop of max(.8 ATR, .6%).
  const firstTargetDistance = .75 * Math.max(.8 * atr, .006 * executable);
  if (cost >= firstTargetDistance) return fail('COST_EXCEEDS_FIRST_TARGET');
  return {allowed: true, reason: 'FLOW_AND_PRICE_CONFIRMED'};
}
