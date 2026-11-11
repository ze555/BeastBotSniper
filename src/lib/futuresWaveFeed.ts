import { updateDirectionTracking, updateRejectedSignalsOutcomes } from "./researchLogger.js";
import WebSocket from "ws";

export interface FuturesTapeTrade {
  price: number;
  quantity: number;
  quote: number;
  buyerIsMaker: boolean;
  timestamp: number;
}
export interface FuturesLiquidationFlow {
  longLiquidationQuote: number; shortLiquidationQuote: number; eventCount: number;
  observedAt: number; source: "BINANCE_FORCE_ORDER";
}
export interface FuturesTapeFlow {
  buyQuote: number;
  sellQuote: number;
  tradeCount: number;
  observedAt: number;
  source: "BINANCE_AGG_TRADES";
  buyQuote5s: number;
  sellQuote5s: number;
  trades5s: number;
  buyQuote30s: number;
  sellQuote30s: number;
  trades30s: number;
  buyQuote1m: number;
  sellQuote1m: number;
  trades1m: number;
  buyQuote5m: number;
  sellQuote5m: number;
  trades5m: number;
  priceChange30sPct: number | null;
  priceChange1mPct: number | null;
  priceChange5mPct: number | null;
  coverage1mMs: number;
  coverage5mMs: number;
}
type SocketState = { socket: WebSocket; reconnect?: ReturnType<typeof setTimeout> };
const tapeBySymbol = new Map<string, FuturesTapeTrade[]>();
const MAX_TAPE_SYMBOLS = 500;
const MAX_TAPE_TRADES_PER_SYMBOL = 1_200;
type DepthSample = { bidNotional: number; askNotional: number; spreadBps: number; observedAt: number };
const depthBySymbol = new Map<string, DepthSample[]>();
const sockets: SocketState[] = [];
const liquidationTape = new Map<string, Array<{ side: "LONG_LIQUIDATION" | "SHORT_LIQUIDATION"; quote: number; timestamp: number }>>();
let liquidationSocket: WebSocket | null = null;
let configuredSymbols = "";
let started = false;

function evictOldestSymbol<T>(map: Map<string, T[]>) {
  if (map.size < MAX_TAPE_SYMBOLS) return;
  let oldestKey: string | null = null;
  let oldestAt = Infinity;
  for (const [key, rows] of map) {
    const last = rows.length ? Number((rows[rows.length - 1] as any).timestamp ?? (rows[rows.length - 1] as any).observedAt) : 0;
    if (last < oldestAt) { oldestAt = last; oldestKey = key; }
  }
  if (oldestKey) map.delete(oldestKey);
}

function pruneTape(symbol: string, now: number) {
  const tape = tapeBySymbol.get(symbol);
  if (tape?.length) {
    let first = 0;
    while (first < tape.length && tape[first].timestamp < now - 5 * 60_000) first++;
    if (first > 0) tape.splice(0, first);
    if (!tape.length) tapeBySymbol.delete(symbol);
  }
  const depth = depthBySymbol.get(symbol);
  if (depth?.length && now - depth[depth.length - 1].observedAt > 120_000) depthBySymbol.delete(symbol);
  const liquidations = liquidationTape.get(symbol);
  if (liquidations?.length && now - liquidations[liquidations.length - 1].timestamp > 5 * 60_000) liquidationTape.delete(symbol);
}
export function recordFuturesDepth(symbol: string, bids: any[], asks: any[], observedAt = Date.now()) {
  if (!symbol || !Array.isArray(bids) || !Array.isArray(asks) || !bids.length || !asks.length) return;
  const bidNotional = bids.slice(0, 5).reduce((sum, level) => sum + Number(level[0]) * Number(level[1]), 0);
  const askNotional = asks.slice(0, 5).reduce((sum, level) => sum + Number(level[0]) * Number(level[1]), 0);
  const bestBid = Number(bids[0][0]), bestAsk = Number(asks[0][0]);
  if (![bidNotional, askNotional, bestBid, bestAsk].every(Number.isFinite) || bidNotional <= 0 || askNotional <= 0 || bestBid <= 0 || bestAsk < bestBid) return;
  const mid = (bestBid + bestAsk) / 2;
  let rows = depthBySymbol.get(symbol);
  if (!rows) { evictOldestSymbol(depthBySymbol); rows = []; }
  rows.push({ bidNotional, askNotional, spreadBps: (bestAsk - bestBid) / mid * 10000, observedAt });
  while (rows.length > 80 || (rows.length && observedAt - rows[0].observedAt > 90_000)) rows.shift();
  depthBySymbol.set(symbol, rows);
}
export function getFuturesBookFlow(symbol: string, now = Date.now()) {
  const rows = (depthBySymbol.get(symbol) || []).filter(row => now - row.observedAt <= 5_000);
  if (rows.length < 3) return null;
  const first = rows[0], last = rows[rows.length - 1];
  return { bidNotional: last.bidNotional, askNotional: last.askNotional,
    bidDepthChangePct: (last.bidNotional - first.bidNotional) / Math.max(first.bidNotional, 1) * 100,
    askDepthChangePct: (last.askNotional - first.askNotional) / Math.max(first.askNotional, 1) * 100,
    spreadBps: last.spreadBps, observedAt: last.observedAt, sampleCount: rows.length,
    sampleWindowMs: last.observedAt - first.observedAt, source: "BINANCE_DEPTH5_WS" as const };
}

export function recordFuturesTrade(symbol: string, trade: FuturesTapeTrade) {
  if (!symbol || ![trade.price, trade.quantity, trade.quote, trade.timestamp].every(Number.isFinite) ||
      trade.price <= 0 || trade.quantity <= 0 || trade.quote <= 0) return;
  let tape = tapeBySymbol.get(symbol);
  if (!tape) { evictOldestSymbol(tapeBySymbol); tape = []; }
  tape.push(trade);
  const cutoff = Date.now() - 5 * 60_000;
  let first = 0;
  while (first < tape.length && tape[first].timestamp < cutoff) first++;
  if (first > 0) tape.splice(0, first);
  if (tape.length > MAX_TAPE_TRADES_PER_SYMBOL) tape.splice(0, tape.length - MAX_TAPE_TRADES_PER_SYMBOL);
  tapeBySymbol.set(symbol, tape);
}
export function getFuturesTapeFlow(symbol: string, now = Date.now()): FuturesTapeFlow | null {
  const tape = tapeBySymbol.get(symbol);
  if (!tape?.length) return null;
  pruneTape(symbol, now);
  const windows = [
    { ms: 5_000, buy: 0, sell: 0, trades: 0, first: null as FuturesTapeTrade | null, last: null as FuturesTapeTrade | null },
    { ms: 30_000, buy: 0, sell: 0, trades: 0, first: null as FuturesTapeTrade | null, last: null as FuturesTapeTrade | null },
    { ms: 60_000, buy: 0, sell: 0, trades: 0, first: null as FuturesTapeTrade | null, last: null as FuturesTapeTrade | null },
    { ms: 300_000, buy: 0, sell: 0, trades: 0, first: null as FuturesTapeTrade | null, last: null as FuturesTapeTrade | null }
  ];
  for (const trade of tape) {
    if (trade.timestamp > now + 2_000) continue;
    for (const window of windows) {
      if (trade.timestamp < now - window.ms) continue;
      if (!window.first) window.first = trade;
      window.last = trade;
      window.trades++;
      if (trade.buyerIsMaker) window.sell += trade.quote; else window.buy += trade.quote;
    }
  }
  const recentWindow = windows[1];
  if (recentWindow.trades < 5 || !recentWindow.last || now - recentWindow.last.timestamp > 30_000) return null;
  const last = recentWindow.last;
  const [w5, w30, w1m, w5m] = windows;
  const pct = (window: typeof w5) => window.first && window.last && window.first.price > 0
    ? (window.last.price - window.first.price) / window.first.price : null;
  const coverage = (window: typeof w5) => window.first && window.last
    ? Math.max(0, Math.min(window.ms, window.last.timestamp - window.first.timestamp)) : 0;
  return {
    buyQuote: w30.buy, sellQuote: w30.sell, tradeCount: w30.trades,
    observedAt: last.timestamp, source: "BINANCE_AGG_TRADES",
    buyQuote5s: w5.buy, sellQuote5s: w5.sell, trades5s: w5.trades,
    buyQuote30s: w30.buy, sellQuote30s: w30.sell, trades30s: w30.trades,
    buyQuote1m: w1m.buy, sellQuote1m: w1m.sell, trades1m: w1m.trades,
    buyQuote5m: w5m.buy, sellQuote5m: w5m.sell, trades5m: w5m.trades,
    priceChange30sPct: pct(w30), priceChange1mPct: pct(w1m), priceChange5mPct: pct(w5m),
    coverage1mMs: coverage(w1m), coverage5mMs: coverage(w5m)
  };
}

/** Candidates are selected from executed Futures trades, not 24h gainers alone. */
export function recordFuturesLiquidation(symbol: string, side: "LONG_LIQUIDATION" | "SHORT_LIQUIDATION", quote: number, timestamp: number) {
  if (!symbol || !Number.isFinite(quote) || quote <= 0 || !Number.isFinite(timestamp) || timestamp <= 0) return;
  let events = liquidationTape.get(symbol);
  if (!events) { evictOldestSymbol(liquidationTape); events = []; }
  events.push({ side, quote, timestamp });
  const cutoff = Date.now() - 5 * 60_000;
  while (events.length && events[0].timestamp < cutoff) events.shift();
  liquidationTape.set(symbol, events);
}
export function getFuturesLiquidationFlow(symbol: string, now = Date.now()): FuturesLiquidationFlow | null {
  const events = (liquidationTape.get(symbol) || []).filter(e => e.timestamp >= now - 30_000 && e.timestamp <= now + 2_000);
  if (!events.length) return null;
  return {
    longLiquidationQuote: events.filter(e => e.side === "LONG_LIQUIDATION").reduce((n, e) => n + e.quote, 0),
    shortLiquidationQuote: events.filter(e => e.side === "SHORT_LIQUIDATION").reduce((n, e) => n + e.quote, 0),
    eventCount: events.length, observedAt: Math.max(...events.map(e => e.timestamp)), source: "BINANCE_FORCE_ORDER"
  };
}

export function getFuturesWaveCandidates(now = Date.now(), _legacyLimit?: number): string[] {
  const ranked: Array<{ symbol: string; impulse: number }> = [];
  for (const [symbol, tape] of tapeBySymbol) {
    pruneTape(symbol, now);
    let count30 = 0, count1m = 0, priorCount = 0;
    let notional30 = 0, notional1m = 0, priorNotional = 0, buy30 = 0, buy1m = 0;
    let first30: FuturesTapeTrade | null = null, last30: FuturesTapeTrade | null = null;
    let first1m: FuturesTapeTrade | null = null, last1m: FuturesTapeTrade | null = null;
    // Aggregate in one pass without allocating three filtered arrays for every symbol.
    for (const trade of tape) {
      const at = trade.timestamp;
      if (at > now + 2_000) continue;
      if (at >= now - 30_000) {
        if (!first30) first30 = trade;
        last30 = trade; count30++; notional30 += trade.quote;
        if (!trade.buyerIsMaker) buy30 += trade.quote;
      }
      if (at >= now - 60_000) {
        if (!first1m) first1m = trade;
        last1m = trade; count1m++; notional1m += trade.quote;
        if (!trade.buyerIsMaker) buy1m += trade.quote;
      }
      if (at >= now - 300_000 && at < now - 60_000) { priorCount++; priorNotional += trade.quote; }
    }
    // Three prints are enough to put a symbol on the discovery radar; the entry engine
    // still applies its stricter freshness/trade-count requirements before execution.
    if (count30 < 3 || count1m < 5 || !first30 || !last30 || !first1m || !last1m) continue;
    const priorPer30s = priorCount ? priorNotional / 8 : 0;
    // Discovery is intentionally permissive: small/new contracts can produce the strongest
    // relative expansions. Absolute liquidity is checked later at execution, not here.
    const adaptiveFloor = priorPer30s > 0
      ? Math.max(25, Math.min(1_000, priorPer30s * 0.25))
      : 25;
    if (notional30 < adaptiveFloor && notional1m < adaptiveFloor * 2) continue;
    const share30 = buy30 / Math.max(notional30, 1e-9);
    const share1m = buy1m / Math.max(notional1m, 1e-9);
    const priceMove30 = first30.price > 0 ? (last30.price - first30.price) / first30.price : 0;
    const priceMove1m = first1m.price > 0 ? (last1m.price - first1m.price) / first1m.price : 0;
    const directionalFlow = share30 >= 0.54 || share30 <= 0.46 || share1m >= 0.56 || share1m <= 0.44;
    const priceImpulse = Math.abs(priceMove30) >= 0.0015 || Math.abs(priceMove1m) >= 0.0020;
    const volumeBurst = priorPer30s > 0
      ? (notional30 >= priorPer30s * 1.35 || notional1m >= priorPer30s * 2.7)
      : notional30 >= 25;
    if (!directionalFlow || (!volumeBurst && !priceImpulse)) continue;
    // Five-minute tape remains available to the entry engine; candidate discovery intentionally admits early 1m reversals.
    ranked.push({ symbol, impulse: Math.max(notional30, notional1m / 2) * (Math.abs(priceMove30) + Math.abs(priceMove1m) + (volumeBurst ? 0.005 : 0)) });
  }
  // Return every qualifying symbol. Sort for evaluation order only; never truncate to Top-N.
  for (const symbol of depthBySymbol.keys()) pruneTape(symbol, now);
  for (const symbol of liquidationTape.keys()) pruneTape(symbol, now);
  return ranked.sort((a, b) => b.impulse - a.impulse).map(x => x.symbol);
}

function closeSockets() {
  for (const state of sockets.splice(0)) {
    if (state.reconnect) clearTimeout(state.reconnect);
    try { state.socket.removeAllListeners(); state.socket.terminate(); } catch { /* reconnect path */ }
  }
}
function connectShard(symbols: string[]) {
  const streams = symbols.flatMap(s => [`${s.toLowerCase()}@aggTrade`, `${s.toLowerCase()}@depth5`]).join("/");
  const state: SocketState = { socket: new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`, { perMessageDeflate: false, maxPayload: 1024 * 1024 }) };
  sockets.push(state);
  state.socket.on("message", raw => {
    try {
      const packet = JSON.parse(raw.toString());
      const d = packet?.data;
      if (!d || typeof d.s !== "string") return;
      if (d.e === "aggTrade") {
        const price = Number(d.p), quantity = Number(d.q), timestamp = Number(d.T);
        recordFuturesTrade(d.s, { price, quantity, quote: price * quantity, buyerIsMaker: d.m === true, timestamp });
        // Passive outcome tracking uses the live Futures tape; it does not depend on scanner eligibility.
        updateDirectionTracking(d.s, price);
        updateRejectedSignalsOutcomes(d.s, price);
      } else if (Array.isArray(d.b) && Array.isArray(d.a)) {
        recordFuturesDepth(d.s, d.b, d.a, Number(packet.data?.E || Date.now()));
      }
    } catch { /* malformed stream packet is ignored; REST fallback remains available */ }
  });
  const reconnect = () => {
    const staleIndex = sockets.indexOf(state);
    if (staleIndex >= 0) sockets.splice(staleIndex, 1);
    if (!started || state.reconnect) return;
    state.reconnect = setTimeout(() => {
      state.reconnect = undefined;
      if (started) connectShard(symbols);
    }, 2_000);
    (state.reconnect as any).unref?.();
  };
  state.socket.on("close", reconnect);
  state.socket.on("error", () => {
    try { state.socket.terminate(); } catch { /* reconnect on close */ }
    reconnect();
  });
}
function connectLiquidationStream() {
  const socket = new WebSocket("wss://fstream.binance.com/ws/!forceOrder@arr", { perMessageDeflate: false, maxPayload: 1024 * 1024 });
  liquidationSocket = socket;
  const state: SocketState = { socket };
  sockets.push(state);
  socket.on("message", raw => {
    try {
      const packet = JSON.parse(raw.toString());
      if (packet?.e !== "forceOrder" || !packet.o) return;
      const order = packet.o;
      const symbol = String(order.s || "");
      const side = order.S === "SELL" ? "LONG_LIQUIDATION" : order.S === "BUY" ? "SHORT_LIQUIDATION" : null;
      const avgPrice = Number(order.ap), executedQty = Number(order.z), timestamp = Number(order.T || packet.E);
      const quote = avgPrice * executedQty;
      if (side && Number.isFinite(quote) && quote > 0) recordFuturesLiquidation(symbol, side, quote, timestamp);
    } catch { /* malformed liquidation event is ignored; no synthetic events are created */ }
  });
  const reconnect = () => {
    const staleIndex = sockets.indexOf(state);
    if (staleIndex >= 0) sockets.splice(staleIndex, 1);
    if (!started || state.reconnect) return;
    state.reconnect = setTimeout(() => {
      state.reconnect = undefined;
      if (started) connectLiquidationStream();
    }, 2_000);
    (state.reconnect as any).unref?.();
  };
  socket.on("close", reconnect);
  socket.on("error", () => {
    try { socket.terminate(); } catch { /* reconnect on close */ }
    reconnect();
  });
}

export function startFuturesWaveFeed(symbols: string[]) {
  const normalized = Array.from(new Set(symbols.filter(s => /^[A-Z0-9]+USDT$/.test(s)))).sort();
  const fingerprint = normalized.join(",");
  if (fingerprint === configuredSymbols && started) return;
  started = true;
  configuredSymbols = fingerprint;
  closeSockets();
  // 200 symbols = 400 streams per shard, safely below Binance's 1,024-stream limit.
  for (let i = 0; i < normalized.length; i += 200) connectShard(normalized.slice(i, i + 200));
  connectLiquidationStream();
}
export function stopFuturesWaveFeed() {
  started = false;
  configuredSymbols = "";
  closeSockets();
  tapeBySymbol.clear();
  depthBySymbol.clear();
  liquidationTape.clear();
  liquidationSocket = null;
}
export function getFuturesWaveFeedStatus() {
  const openConnections = sockets.filter(state => state.socket.readyState === WebSocket.OPEN).length;
  const now = Date.now();
  const symbolsWithFreshTape = Array.from(tapeBySymbol.values()).filter(rows => rows.length && now - rows[rows.length - 1].timestamp <= 30_000).length;
  const symbolsWithDepth = Array.from(depthBySymbol.values()).filter(rows => rows.length >= 3 && now - rows[rows.length - 1].observedAt <= 5_000).length;
  const tapeTradePoints = Array.from(tapeBySymbol.values()).reduce((sum, rows) => sum + rows.length, 0);
  const depthSamples = Array.from(depthBySymbol.values()).reduce((sum, rows) => sum + rows.length, 0);
  const liquidationEvents = Array.from(liquidationTape.values()).reduce((sum, rows) => sum + rows.length, 0);
  return { configured: started, symbols: configuredSymbols ? configuredSymbols.split(",").length : 0,
    connections: sockets.length, openConnections, symbolsWithFreshTape, symbolsWithDepth,
    tapeSymbolsInMemory: tapeBySymbol.size, tapeTradePoints, depthSymbolsInMemory: depthBySymbol.size,
    depthSamples, liquidationSymbolsInMemory: liquidationTape.size, liquidationEvents,
    maxTapeSymbols: MAX_TAPE_SYMBOLS, maxTapeTradesPerSymbol: MAX_TAPE_TRADES_PER_SYMBOL,
    liquidationFeedConnected: Boolean(liquidationSocket && liquidationSocket.readyState === WebSocket.OPEN) };
}
