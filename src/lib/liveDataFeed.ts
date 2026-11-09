// ============================================================================
// BEASTBOT LIVE DATA FEED (v3.3.1) — now with ALL-MARKET IGNITION RADAR
// Real-time market microstructure via Binance Futures WebSocket:
//   - aggTrade          => tick-level CVD (true taker buy/sell delta)
//   - bookTicker        => live spread + order-book top imbalance
//   - !markPrice@arr    => all-market mark price (1s): live trade management
//                          + v3.3.1 IGNITION RADAR fuel (every futures symbol,
//                          incl. weak/low-liquidity coins — sampled every 3s)
//   - !forceOrder@arr   => REAL liquidation events + v3.3.1 burst detector
//
// v3.3.1 IGNITION RADAR: the scan rotation only visits top-250-by-volume
// symbols every ~5 minutes. A weak coin that suddenly explodes/collapses
// must be scanned AT THE START OF THE MOVE, not when the rotation reaches it
// (or never, if ranked >250). The radar watches ALL mark prices + liquidations
// and exposes getIgnitionCandidates() — apexPredator queues them for priority
// scanning through the SAME entry gates (no quality dilution: the radar only
// nominates, the gates decide).
//
// DESIGN PRINCIPLES:
//   1. NEVER a hard dependency: if the socket is down, getLiveFlow() returns
//      available:false and the bot falls back to the legacy REST/kline path.
//   2. Bounded memory: 1-second aggregation buckets, pruned automatically.
//   3. Dynamic subscription: only actively-traded + currently-scanned symbols.
//   4. Auto-reconnect with exponential backoff, ping/pong keep-alive.
// ============================================================================

import WebSocket from "ws";
import { ingestLiquidation } from "./flowMetrics.js";

const FUTURES_WS = "wss://fstream.binance.com/stream";
const AGG_BUCKET_MS = 1000;
const AGG_WINDOW_MS = 15 * 60 * 1000; // keep 15 minutes of tick flow
const MAX_SYMBOL_STREAMS = 40;        // Binance allows ~200/connection; stay conservative
const RESYNC_INTERVAL_MS = 60 * 1000;
// v3.3.1 ignition radar tuning
const RADAR_SAMPLE_MS = 3 * 1000;     // one mark-price sample per symbol per 3s
const RADAR_MAX_SAMPLES = 40;         // 40 × 3s = 2 minutes of coverage
const RADAR_MIN_SAMPLES = 8;          // need ≥24s of coverage before trusting a move
const LIQ_RING_MS = 120 * 1000;       // liquidation burst memory (2 min)

interface AggBucket { ts: number; buy: number; sell: number; notional: number }

interface SymbolLiveState {
   buckets: AggBucket[];              // 1s taker-delta buckets
   bid: number; bidQty: number;
   ask: number; askQty: number;
   markPrice: number;
   lastTradeTs: number;
   lastBookTs: number;
   radar: RadarSample[];              // v3.3.1: 3s-cadence mark-price ring (2 min)
   lastRadarTs: number;
}

export interface RadarSample { ts: number; p: number }

export interface IgnitionCandidate {
   symbol: string;
   direction: "UP" | "DOWN";
   movePct60: number;                 // abs % move over trailing 60s (0 if n/a)
   movePct180: number;                // abs % move over trailing 180s (0 if n/a)
   liqUsd60s: number;                 // liquidation notional in trailing 60s
   score: number;                     // composite priority (higher = hotter)
}

interface LiquidationRaw { s: string; S: string; q: string; p: string; T: number }

// ---------------------------------------------------------------------------
// v3.3.1 IGNITION RADAR — pure math (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Signed % move between the OLDEST sample inside the trailing window and the
 * newest sample. Returns null when there is not enough coverage inside the
 * window (radar just started / symbol stopped ticking).
 */
export function computeIgnitionMove(
   samples: RadarSample[],
   nowMs: number,
   windowMs: number
): number | null {
   if (samples.length < 2) return null;
   const cutoff = nowMs - windowMs;
   let base: RadarSample | null = null;
   for (const s of samples) {
      if (s.ts >= cutoff) { base = s; break; }
   }
   if (!base) return null;
   const last = samples[samples.length - 1];
   if (last.p <= 0 || base.p <= 0 || last.ts <= base.ts) return null;
   return ((last.p - base.p) / base.p) * 100;
}

/** Composite ignition priority: 60s move dominates, 180s half-weight, liq adds fuel. */
export function ignitionScore(movePct60: number, movePct180: number, liqUsd60s: number): number {
   return Math.abs(movePct60) + Math.abs(movePct180) * 0.5 + liqUsd60s / 50_000;
}

class LiveDataFeed {
   private ws: WebSocket | null = null;              // per-symbol firehose (aggTrade/bookTicker)
   private marketWs: WebSocket | null = null;        // v3.3.2: LOW-BANDWIDTH market socket (markPrice@arr + forceOrder@arr)
   private subscribed = new Set<string>();
   private desired = new Set<string>();
   private state = new Map<string, SymbolLiveState>();
   private connected = false;
   private marketConnected = false;
   private reconnectAttempt = 0;
   private marketReconnectAttempt = 0;
   private reconnectTimer: NodeJS.Timeout | null = null;
   private marketReconnectTimer: NodeJS.Timeout | null = null;
   private resyncTimer: NodeJS.Timeout | null = null;
   private lastMessageTs = 0;
   private started = false;
   private liqRing = new Map<string, { ts: number; notional: number; side: "BUY" | "SELL" }[]>();  // v3.3.1 burst detector

   public stats = {
      messages: 0,
      liquidations: 0,
      reconnects: 0,
      marketReconnects: 0,        // v3.3.2: radar-socket reconnect count (health probe)
      lastCloseCode: 0,           // v3.3.2: why did the firehose last die?
      marketLastCloseCode: 0,     // v3.3.2: why did the radar socket last die?
      startedAt: 0,
      lastError: "",
      ignitionFlagged: 0          // v3.3.1: candidates that met a threshold at least once
   };

   // -----------------------------------------------------------------------
   // Lifecycle
   // -----------------------------------------------------------------------
   start() {
      if (this.started) return;
      this.started = true;
      this.stats.startedAt = Date.now();
      this.connect();
      this.connectMarket();
      // Resync subscriptions periodically (watchlist rotates, trades open/close)
      this.resyncTimer = setInterval(() => this.resyncSubscriptions(), RESYNC_INTERVAL_MS);
   }

   stop() {
      this.started = false;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      if (this.marketReconnectTimer) clearTimeout(this.marketReconnectTimer);
      if (this.resyncTimer) clearInterval(this.resyncTimer);
      try { this.ws?.close(); } catch { /* ignore */ }
      try { this.marketWs?.close(); } catch { /* ignore */ }
      this.ws = null;
      this.marketWs = null;
      this.connected = false;
      this.marketConnected = false;
   }

   isConnected() { return this.connected; }
   /** v3.3.2: is the low-bandwidth radar socket alive? */
   isMarketConnected() { return this.marketConnected; }

   /**
    * Provide the CURRENT priority symbols (active trades first, scan batch next).
    * Called before each (re)subscription sync.
    */
   setPrioritySymbols(symbols: string[]) {
      this.desired = new Set(symbols.map(s => s.toUpperCase()).slice(0, MAX_SYMBOL_STREAMS));
   }

   // -----------------------------------------------------------------------
   // Connection management
   // -----------------------------------------------------------------------
   private connect() {
      if (!this.started) return;
      try {
         // v3.3.2 SPLIT-SOCKET ARCHITECTURE: the per-symbol firehose (aggTrade
         // ≈ 1000+ msg/s) lived on the SAME connection as the market-wide
         // streams. Production evidence: 1228 reconnects in 31h + ZERO
         // liquidation events delivered + radar starved (0 flags). The proxy/
         // host kills busy sockets — so the radar now gets its own quiet
         // socket (~20 frames/min) that survives the firehose dying.
         const url = `${FUTURES_WS}?streams=btcusdt@aggTrade`;
         const ws = new WebSocket(url);
         this.ws = ws;

         ws.on("open", () => {
            this.connected = true;
            this.reconnectAttempt = 0;
            this.stats.lastError = "";
            this.resyncSubscriptions(true);
         });

         ws.on("message", (raw: WebSocket.RawData) => {
            try {
               this.lastMessageTs = Date.now();
               this.stats.messages++;
               const msg = JSON.parse(raw.toString());
               if (msg.stream && msg.data) this.handleStream(msg.stream, msg.data);
            } catch { /* malformed frame — ignore */ }
         });

         ws.on("ping", () => { try { ws.pong(); } catch { /* ignore */ } });

         ws.on("error", (err: Error) => {
            this.stats.lastError = err.message;
         });

         ws.on("close", (code: number, reason: Buffer) => {
            this.connected = false;
            this.stats.lastCloseCode = code;
            if (!this.started) return;
            this.stats.reconnects++;
            const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempt++));
            this.reconnectTimer = setTimeout(() => this.connect(), delay);
         });
      } catch (e: any) {
         this.stats.lastError = e?.message || String(e);
         const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempt++));
         this.reconnectTimer = setTimeout(() => this.connect(), delay);
      }
   }

   /**
    * v3.3.2: dedicated LOW-BANDWIDTH socket for the ignition radar.
    * Carries only !markPrice@arr (every 3s) + !forceOrder@arr (sparse) —
    * ~20 frames/min, invisible to proxies that strangle busy sockets.
    * Liquidations + mark-price rings now survive firehose reconnect storms.
    */
   private connectMarket() {
      if (!this.started) return;
      try {
         const url = `${FUTURES_WS}?streams=!forceOrder@arr/!markPrice@arr`;
         const ws = new WebSocket(url);
         this.marketWs = ws;

         ws.on("open", () => {
            this.marketConnected = true;
            this.marketReconnectAttempt = 0;
         });

         ws.on("message", (raw: WebSocket.RawData) => {
            try {
               const msg = JSON.parse(raw.toString());
               if (msg.stream && msg.data) this.handleStream(msg.stream, msg.data);
            } catch { /* malformed frame — ignore */ }
         });

         ws.on("ping", () => { try { ws.pong(); } catch { /* ignore */ } });

         ws.on("error", () => { /* surfaced via marketConnected=false */ });

         ws.on("close", (code: number) => {
            this.marketConnected = false;
            this.stats.marketLastCloseCode = code;
            if (!this.started) return;
            this.stats.marketReconnects++;
            const delay = Math.min(30000, 1000 * Math.pow(2, this.marketReconnectAttempt++));
            this.marketReconnectTimer = setTimeout(() => this.connectMarket(), delay);
         });
      } catch {
         const delay = Math.min(30000, 1000 * Math.pow(2, this.marketReconnectAttempt++));
         this.marketReconnectTimer = setTimeout(() => this.connectMarket(), delay);
      }
   }

   private resyncSubscriptions(force: boolean = false) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (!force && this.subscribed.size === this.desired.size &&
          [...this.desired].every(s => this.subscribed.has(s))) return;

      const lower = (s: string) => s.toLowerCase();
      const oldSet = new Set(this.subscribed);
      const newSet = new Set<string>([...this.desired].flatMap(s => [`${lower(s)}@aggTrade`, `${lower(s)}@bookTicker`]));

      const toAdd = [...newSet].filter(s => !oldSet.has(s));
      const toRemove = [...oldSet].filter(s => !newSet.has(s));

      // Binance: SUBSCRIBE/UNSUBSCRIBE accept combined params
      if (toRemove.length > 0) {
         try { this.ws.send(JSON.stringify({ method: "UNSUBSCRIBE", params: toRemove, id: Date.now() })); } catch { /* ignore */ }
      }
      if (toAdd.length > 0) {
         try { this.ws.send(JSON.stringify({ method: "SUBSCRIBE", params: toAdd, id: Date.now() + 1 })); } catch { /* ignore */ }
      }

      // Track per-symbol subscription (both streams count as one logical symbol sub)
      this.subscribed = new Set([...this.desired]);
      // Drop state for symbols no longer tracked (keep data for active trades safety)
      for (const sym of this.state.keys()) {
         if (!this.desired.has(sym) && !this.desired.has(sym)) {
            // retain the state object (cheap) but stop pruning cost — skip deletion for simplicity
         }
      }
   }

   // -----------------------------------------------------------------------
   // Stream dispatch
   // -----------------------------------------------------------------------
   private handleStream(streamName: string, data: any) {
      if (streamName === "!forceOrder@arr") {
         this.handleLiquidation(data as LiquidationRaw);
         return;
      }
      if (streamName === "!markPrice@arr") {
         // Binance @arr streams deliver an ARRAY of objects — the old singular
         // check (data?.s) never matched, silently disabling mark price for
         // every symbol. v3.3.1: handle both shapes + feed the radar ring.
         const items: any[] = Array.isArray(data) ? data : (data?.s ? [data] : []);
         const now = Date.now();
         for (const it of items) {
            if (!it?.s || typeof it.p !== "string") continue;
            const st = this.getOrCreate(it.s);
            const price = parseFloat(it.p);
            if (!(price > 0)) continue;
            st.markPrice = price;
            // Radar: sample on a 3s cadence, not every 1s tick (bounded memory)
            if (now - st.lastRadarTs >= RADAR_SAMPLE_MS) {
               st.lastRadarTs = now;
               st.radar.push({ ts: now, p: price });
               if (st.radar.length > RADAR_MAX_SAMPLES) st.radar.shift();
            }
         }
         return;
      }
      if (streamName.endsWith("@aggTrade")) {
         const sym = streamName.replace("@aggTrade", "").toUpperCase();
         // data: { p: price, q: qty, m: buyerIsMaker, T: trade time }
         const price = parseFloat(data.p);
         const qty = parseFloat(data.q);
         const ts = Number(data.T) || Date.now();
         const delta = data.m === true ? -qty : qty; // m=true => buyer is maker => taker SELL
         const st = this.getOrCreate(sym);
         const notional = price * qty;

         const bucketTs = Math.floor(ts / AGG_BUCKET_MS) * AGG_BUCKET_MS;
         const last = st.buckets[st.buckets.length - 1];
         if (last && last.ts === bucketTs) {
            if (delta >= 0) last.buy += delta; else last.sell += -delta;
            last.notional += notional;
         } else {
            st.buckets.push({
               ts: bucketTs,
               buy: delta >= 0 ? delta : 0,
               sell: delta < 0 ? -delta : 0,
               notional
            });
            // Prune buckets older than the window
            const cutoff = ts - AGG_WINDOW_MS;
            while (st.buckets.length > 0 && st.buckets[0].ts < cutoff) st.buckets.shift();
            if (st.buckets.length > 1200) st.buckets.splice(0, st.buckets.length - 1200);
         }
         st.lastTradeTs = ts;
         return;
      }
      if (streamName.endsWith("@bookTicker")) {
         const sym = streamName.replace("@bookTicker", "").toUpperCase();
         const st = this.getOrCreate(sym);
         if (data.b) st.bid = parseFloat(data.b);
         if (data.B) st.bidQty = parseFloat(data.B);
         if (data.a) st.ask = parseFloat(data.a);
         if (data.A) st.askQty = parseFloat(data.A);
         st.lastBookTs = Date.now();
         return;
      }
   }

   private handleLiquidation(o: LiquidationRaw) {
      if (!o?.s || !o?.S) return;
      this.stats.liquidations++;
      // Binance forceOrder: order side SELL => a LONG was liquidated (downward fuel)
      //                    order side BUY  => a SHORT was liquidated (upward squeeze fuel)
      // flowMetrics convention: side "SELL" = long liquidation, "BUY" = short liquidation.
      const notional = (parseFloat(o.p) || 0) * (parseFloat(o.q) || 0);
      const sym = o.s.toUpperCase();
      const ts = Number(o.T) || Date.now();
      ingestLiquidation(sym, {
         side: o.S as "BUY" | "SELL",
         notionalUsd: notional,
         ts
      });
      // v3.3.1: burst ring for the ignition radar (liquidations LEAD price —
      // a cascade is the earliest fingerprint of an explosion/collapse start)
      let ring = this.liqRing.get(sym);
      if (!ring) { ring = []; this.liqRing.set(sym, ring); }
      ring.push({ ts, notional, side: o.S as "BUY" | "SELL" });
      const cutoff = ts - LIQ_RING_MS;
      while (ring.length > 0 && ring[0].ts < cutoff) ring.shift();
   }

   private liqNotionalInWindow(symbol: string, windowMs: number): number {
      const ring = this.liqRing.get(symbol.toUpperCase());
      if (!ring || ring.length === 0) return 0;
      const cutoff = Date.now() - windowMs;
      let sum = 0;
      for (let i = ring.length - 1; i >= 0; i--) {
         if (ring[i].ts < cutoff) break;
         sum += ring[i].notional;
      }
      return sum;
   }

   private getOrCreate(symbol: string): SymbolLiveState {
      let st = this.state.get(symbol);
      if (!st) {
         st = {
            buckets: [], bid: 0, bidQty: 0, ask: 0, askQty: 0,
            markPrice: 0, lastTradeTs: 0, lastBookTs: 0,
            radar: [], lastRadarTs: 0
         };
         this.state.set(symbol, st);
      }
      return st;
   }

   // -----------------------------------------------------------------------
   // Public getters (ALL fall back gracefully when unavailable)
   // -----------------------------------------------------------------------

   /** Net taker delta (buy - sell, base units) over the trailing window seconds. */
   netDelta(symbol: string, windowSec: number): number | null {
      const st = this.state.get(symbol.toUpperCase());
      if (!st || st.buckets.length === 0) return null;
      const cutoff = Date.now() - windowSec * 1000;
      let net = 0, found = false;
      for (let i = st.buckets.length - 1; i >= 0; i--) {
         const b = st.buckets[i];
         if (b.ts < cutoff) break;
         net += b.buy - b.sell;
         found = true;
      }
      return found ? net : null;
   }

   /** Notional USD traded over the trailing window (for live RVOL sanity). */
   notional(symbol: string, windowSec: number): number | null {
      const st = this.state.get(symbol.toUpperCase());
      if (!st || st.buckets.length === 0) return null;
      const cutoff = Date.now() - windowSec * 1000;
      let sum = 0, found = false;
      for (let i = st.buckets.length - 1; i >= 0; i--) {
         const b = st.buckets[i];
         if (b.ts < cutoff) break;
         sum += b.notional;
         found = true;
      }
      return found ? sum : null;
   }

   getLiveFlow(symbol: string): {
      available: boolean;
      spreadPct: number | null;
      bookImbalance: number | null;
      tickCvd1m: number | null;
      tickCvd5m: number | null;
      tickCvd15m: number | null;
      livePrice: number | null;
      stalenessMs: number | null;
   } {
      const st = this.state.get(symbol.toUpperCase());
      if (!this.connected || !st) {
         return { available: false, spreadPct: null, bookImbalance: null, tickCvd1m: null, tickCvd5m: null, tickCvd15m: null, livePrice: null, stalenessMs: null };
      }

      let spreadPct: number | null = null;
      let bookImbalance: number | null = null;
      if (st.bid > 0 && st.ask > 0) {
         const mid = (st.bid + st.ask) / 2;
         if (mid > 0) spreadPct = ((st.ask - st.bid) / mid) * 100;
         const totalQty = st.bidQty + st.askQty;
         if (totalQty > 0) bookImbalance = st.bidQty / totalQty;
      }

      return {
         available: st.lastTradeTs > 0,
         spreadPct,
         bookImbalance,
         tickCvd1m: this.netDelta(symbol, 60),
         tickCvd5m: this.netDelta(symbol, 300),
         tickCvd15m: this.netDelta(symbol, 900),
         livePrice: st.markPrice > 0 ? st.markPrice : null,
         stalenessMs: st.lastTradeTs > 0 ? Date.now() - st.lastTradeTs : null
      };
   }

   /** Live price for active trade management (mark price preferred). */
   getLivePrice(symbol: string): number | null {
      const st = this.state.get(symbol.toUpperCase());
      if (st?.markPrice && st.markPrice > 0) return st.markPrice;
      return null;
   }

   isSymbolLive(symbol: string): boolean {
      return this.connected && this.state.has(symbol.toUpperCase());
   }

   /**
    * v3.3.1 IGNITION RADAR — scan the WHOLE futures market (every symbol seen
    * on !markPrice@arr, including weak/low-liquidity coins outside the scan
    * rotation) for the earliest fingerprint of an explosion/collapse:
    *   1. fast mark-price move (60s / 180s windows)
    *   2. liquidation burst (liquidations LEAD price at cascade start)
    * Returns at most maxResults candidates, hottest first. The radar only
    * NOMINATES — apexPredator routes candidates through the normal entry
    * gates, so trade quality is untouched.
    */
   getIgnitionCandidates(opts: {
      minMovePct60: number;
      minMovePct180: number;
      minLiqUsd60s: number;
      maxResults?: number;
   }): IgnitionCandidate[] {
      const now = Date.now();
      const out: IgnitionCandidate[] = [];
      for (const [sym, st] of this.state) {
         if (st.radar.length < RADAR_MIN_SAMPLES) continue;
         const m60 = computeIgnitionMove(st.radar, now, 60_000);
         const m180 = computeIgnitionMove(st.radar, now, 180_000);
         const hitMove = (m60 !== null && Math.abs(m60) >= opts.minMovePct60) ||
                         (m180 !== null && Math.abs(m180) >= opts.minMovePct180);
         const liqUsd60s = this.liqNotionalInWindow(sym, 60_000);
         const hitLiq = liqUsd60s >= opts.minLiqUsd60s;
         if (!hitMove && !hitLiq) continue;
         const signed = m60 !== null ? m60 : (m180 ?? 0);
         out.push({
            symbol: sym,
            direction: signed >= 0 ? "UP" : "DOWN",
            movePct60: m60 ?? 0,
            movePct180: m180 ?? 0,
            liqUsd60s,
            score: ignitionScore(m60 ?? 0, m180 ?? 0, liqUsd60s)
         });
      }
      out.sort((a, b) => b.score - a.score);
      return out.slice(0, opts.maxResults ?? 12);
   }

   getHealth() {
      return {
         connected: this.connected,
         marketConnected: this.marketConnected,
         subscribedSymbols: this.subscribed.size,
         trackedSymbols: this.state.size,
         messages: this.stats.messages,
         liquidations: this.stats.liquidations,
         reconnects: this.stats.reconnects,
         marketReconnects: this.stats.marketReconnects,
         lastCloseCode: this.stats.lastCloseCode,
         marketLastCloseCode: this.stats.marketLastCloseCode,
         lastError: this.stats.lastError,
         ignitionFlagged: this.stats.ignitionFlagged,
         stalenessMs: this.lastMessageTs > 0 ? Date.now() - this.lastMessageTs : null,
         uptimeMs: this.stats.startedAt > 0 ? Date.now() - this.stats.startedAt : 0
      };
   }
}

// Singleton export
export const liveFeed = new LiveDataFeed();
