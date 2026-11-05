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
const sockets: SocketState[] = [];
const liquidationTape = new Map<string, Array<{ side: "LONG_LIQUIDATION" | "SHORT_LIQUIDATION"; quote: number; timestamp: number }>>();
let liquidationSocket: WebSocket | null = null;
let configuredSymbols = "";
let started = false;

function pruneTape(symbol: string, now: number) {
  const tape = tapeBySymbol.get(symbol);
  if (!tape) return;
  const keep = tape.filter(t => t.timestamp >= now - 5 * 60_000);
  if (keep.length) tapeBySymbol.set(symbol, keep);
  else tapeBySymbol.delete(symbol);
}
export function recordFuturesTrade(symbol: string, trade: FuturesTapeTrade) {
  if (!symbol || ![trade.price, trade.quantity, trade.quote, trade.timestamp].every(Number.isFinite) ||
      trade.price <= 0 || trade.quantity <= 0 || trade.quote <= 0) return;
  const tape = tapeBySymbol.get(symbol) || [];
  tape.push(trade);
  const cutoff = Date.now() - 5 * 60_000;
  let first = 0;
  while (first < tape.length && tape[first].timestamp < cutoff) first++;
  if (first > 0) tape.splice(0, first);
  tapeBySymbol.set(symbol, tape);
}
export function getFuturesTapeFlow(symbol: string, now = Date.now()): FuturesTapeFlow | null {
  const tape = tapeBySymbol.get(symbol);
  if (!tape?.length) return null;
  pruneTape(symbol, now);
  const recent = tape.filter(t => t.timestamp >= now - 30_000 && t.timestamp <= now + 2_000);
  if (recent.length < 5) return null;
  const last = recent[recent.length - 1];
  if (now - last.timestamp > 30_000) return null;
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
  const events = liquidationTape.get(symbol) || [];
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
    const recent30 = tape.filter(t => t.timestamp >= now - 30_000 && t.timestamp <= now + 2_000);
    const recent1m = tape.filter(t => t.timestamp >= now - 60_000 && t.timestamp <= now + 2_000);
    const prior4m = tape.filter(t => t.timestamp >= now - 300_000 && t.timestamp < now - 60_000);
    // Three prints are enough to put a symbol on the discovery radar; the entry engine
    // still applies its stricter freshness/trade-count requirements before execution.
    if (recent30.length < 3 || recent1m.length < 5) continue;
    const quote = (rows: FuturesTapeTrade[]) => rows.reduce((n, t) => n + t.quote, 0);
    const buyQuote = (rows: FuturesTapeTrade[]) => rows.reduce((n, t) => n + (t.buyerIsMaker ? 0 : t.quote), 0);
    const notional30 = quote(recent30), notional1m = quote(recent1m);
    const priorPer30s = prior4m.length ? quote(prior4m) / 8 : 0;
    // Discovery is intentionally permissive: small/new contracts can produce the strongest
    // relative expansions. Absolute liquidity is checked later at execution, not here.
    const adaptiveFloor = priorPer30s > 0
      ? Math.max(25, Math.min(1_000, priorPer30s * 0.25))
      : 25;
    if (notional30 < adaptiveFloor && notional1m < adaptiveFloor * 2) continue;
    const share30 = buyQuote(recent30) / Math.max(notional30, 1e-9);
    const share1m = buyQuote(recent1m) / Math.max(notional1m, 1e-9);
    const priceMove30 = recent30[0].price > 0 ? (recent30[recent30.length - 1].price - recent30[0].price) / recent30[0].price : 0;
    const priceMove1m = recent1m[0].price > 0 ? (recent1m[recent1m.length - 1].price - recent1m[0].price) / recent1m[0].price : 0;
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
  return ranked.sort((a, b) => b.impulse - a.impulse).map(x => x.symbol);
}

function closeSockets() {
  for (const state of sockets.splice(0)) {
    if (state.reconnect) clearTimeout(state.reconnect);
    try { state.socket.removeAllListeners(); state.socket.terminate(); } catch { /* reconnect path */ }
  }
}
function connectShard(symbols: string[]) {
  const streams = symbols.map(s => `${s.toLowerCase()}@aggTrade`).join("/");
  const state: SocketState = { socket: new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`) };
  sockets.push(state);
  state.socket.on("message", raw => {
    try {
      const packet = JSON.parse(raw.toString());
      const d = packet?.data;
      if (!d || d.e !== "aggTrade" || typeof d.s !== "string") return;
      const price = Number(d.p), quantity = Number(d.q), timestamp = Number(d.T);
      recordFuturesTrade(d.s, {
        price, quantity, quote: price * quantity,
        buyerIsMaker: d.m === true, timestamp
      });
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
  const socket = new WebSocket("wss://fstream.binance.com/ws/!forceOrder@arr");
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
  // Binance combined-stream shards are deliberately kept small for URL/connection resilience.
  for (let i = 0; i < normalized.length; i += 100) connectShard(normalized.slice(i, i + 100));
  connectLiquidationStream();
}
export function stopFuturesWaveFeed() {
  started = false;
  configuredSymbols = "";
  closeSockets();
  tapeBySymbol.clear();
  liquidationTape.clear();
  liquidationSocket = null;
}
export function getFuturesWaveFeedStatus() {
  return { configured: started, symbols: configuredSymbols ? configuredSymbols.split(",").length : 0, connections: sockets.length, liquidationFeedConnected: Boolean(liquidationSocket && liquidationSocket.readyState === WebSocket.OPEN) };
}
