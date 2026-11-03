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
  let buyQuote = 0, sellQuote = 0, buyQuote5s = 0, sellQuote5s = 0, trades5s = 0;
  for (const t of recent) {
    if (t.buyerIsMaker) sellQuote += t.quote; else buyQuote += t.quote;
    if (t.timestamp >= now - 5_000) {
      trades5s++;
      if (t.buyerIsMaker) sellQuote5s += t.quote; else buyQuote5s += t.quote;
    }
  }
  return {
    buyQuote, sellQuote, tradeCount: recent.length, observedAt: last.timestamp,
    source: "BINANCE_AGG_TRADES", buyQuote5s, sellQuote5s, trades5s,
    buyQuote30s: buyQuote, sellQuote30s: sellQuote, trades30s: recent.length
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

export function getFuturesWaveCandidates(now = Date.now(), limit = 40): string[] {
  const ranked: Array<{ symbol: string; impulse: number }> = [];
  for (const [symbol, tape] of tapeBySymbol) {
    pruneTape(symbol, now);
    const recent = tape.filter(t => t.timestamp >= now - 30_000);
    const prior = tape.filter(t => t.timestamp >= now - 300_000 && t.timestamp < now - 30_000);
    if (recent.length < 8) continue;
    const notional = recent.reduce((n, t) => n + t.quote, 0);
    const priorPer30s = prior.length ? prior.reduce((n, t) => n + t.quote, 0) / 9 : 0;
    const adaptiveFloor = priorPer30s > 0 ? Math.max(5_000, priorPer30s * 1.15) : 8_000;
    if (notional < adaptiveFloor) continue;
    const buy = recent.reduce((n, t) => n + (t.buyerIsMaker ? 0 : t.quote), 0);
    const share = buy / Math.max(notional, 1e-9);
    const first = recent[0].price, last = recent[recent.length - 1].price;
    const move = first > 0 ? (last - first) / first : 0;
    const volumeBurst = prior.length >= 20 && priorPer30s > 0 && notional >= priorPer30s * 1.8;
    const directionalFlow = share >= 0.56 || share <= 0.44;
    const priceImpulse = Math.abs(move) >= 0.0025;
    if (!directionalFlow || (!volumeBurst && !priceImpulse)) continue;
    ranked.push({ symbol, impulse: notional * (Math.abs(move) + (volumeBurst ? 0.01 : 0)) });
  }
  return ranked.sort((a, b) => b.impulse - a.impulse).slice(0, limit).map(x => x.symbol);
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
