// ============================================================================
// BEASTBOT LIVE DATA FEED (v3.1.0)
// Real-time market microstructure via Binance Futures WebSocket:
//   - aggTrade          => tick-level CVD (true taker buy/sell delta)
//   - bookTicker        => live spread + order-book top imbalance
//   - !markPrice@arr    => all-market mark price (1s) for live trade management
//   - !forceOrder@arr   => REAL liquidation events (replaces fetchLiq() mock)
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

interface AggBucket { ts: number; buy: number; sell: number; notional: number }

interface SymbolLiveState {
   buckets: AggBucket[];              // 1s taker-delta buckets
   bid: number; bidQty: number;
   ask: number; askQty: number;
   markPrice: number;
   lastTradeTs: number;
   lastBookTs: number;
}

interface LiquidationRaw { s: string; S: string; q: string; p: string; T: number }

class LiveDataFeed {
   private ws: WebSocket | null = null;
   private subscribed = new Set<string>();
   private desired = new Set<string>();
   private state = new Map<string, SymbolLiveState>();
   private connected = false;
   private reconnectAttempt = 0;
   private reconnectTimer: NodeJS.Timeout | null = null;
   private resyncTimer: NodeJS.Timeout | null = null;
   private lastMessageTs = 0;
   private started = false;

   public stats = {
      messages: 0,
      liquidations: 0,
      reconnects: 0,
      startedAt: 0,
      lastError: ""
   };

   // -----------------------------------------------------------------------
   // Lifecycle
   // -----------------------------------------------------------------------
   start() {
      if (this.started) return;
      this.started = true;
      this.stats.startedAt = Date.now();
      this.connect();
      // Resync subscriptions periodically (watchlist rotates, trades open/close)
      this.resyncTimer = setInterval(() => this.resyncSubscriptions(), RESYNC_INTERVAL_MS);
   }

   stop() {
      this.started = false;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      if (this.resyncTimer) clearInterval(this.resyncTimer);
      try { this.ws?.close(); } catch { /* ignore */ }
      this.ws = null;
      this.connected = false;
   }

   isConnected() { return this.connected; }

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
         // Base connection carries the two market-wide streams; per-symbol
         // streams are appended at resync time.
         const url = `${FUTURES_WS}?streams=!forceOrder@arr/!markPrice@arr`;
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

         ws.on("close", () => {
            this.connected = false;
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
         if (data?.s && typeof data.p === "string") {
            const st = this.getOrCreate(data.s);
            st.markPrice = parseFloat(data.p);
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
      ingestLiquidation(o.s.toUpperCase(), {
         side: o.S as "BUY" | "SELL",
         notionalUsd: notional,
         ts: Number(o.T) || Date.now()
      });
   }

   private getOrCreate(symbol: string): SymbolLiveState {
      let st = this.state.get(symbol);
      if (!st) {
         st = {
            buckets: [], bid: 0, bidQty: 0, ask: 0, askQty: 0,
            markPrice: 0, lastTradeTs: 0, lastBookTs: 0
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

   getHealth() {
      return {
         connected: this.connected,
         subscribedSymbols: this.subscribed.size,
         trackedSymbols: this.state.size,
         messages: this.stats.messages,
         liquidations: this.stats.liquidations,
         reconnects: this.stats.reconnects,
         lastError: this.stats.lastError,
         stalenessMs: this.lastMessageTs > 0 ? Date.now() - this.lastMessageTs : null,
         uptimeMs: this.stats.startedAt > 0 ? Date.now() - this.stats.startedAt : 0
      };
   }
}

// Singleton export
export const liveFeed = new LiveDataFeed();
