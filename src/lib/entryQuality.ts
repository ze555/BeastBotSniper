import type { EntryQuality } from "./flowEntryGate.js";

/** Mirror executeTrade's existing structural stop, without changing it. */
export function buildEntryQuality(side: "LONG" | "SHORT", p: any, w: any, reasoning: any,
   setup: string, slAtrMultiplier: number, feeRate: number, slippageRate: number,
   reversion?: { stop: number }): EntryQuality {
   const candles = (p.klines || []).slice(-3);
   const long = side === "LONG";
   const pullback = setup === "PULLBACK_SNIPER";
   const mult = pullback ? Math.min(slAtrMultiplier, 1) : slAtrMultiplier;
   let stop = NaN;
   if (reversion) stop = reversion.stop;
   else if (candles.length === 3) {
      const edge = long ? Math.min(...candles.map((c: any) => c.low)) : Math.max(...candles.map((c: any) => c.high));
      const anchor = pullback ? (long ? Math.min(edge, p.ema21) : Math.max(edge, p.ema21)) : edge;
      stop = anchor + (long ? -1 : 1) * p.atr14 * mult;
   }
   const c5 = w.slope5N ?? w.slope5;
   const c15 = w.slope15N ?? w.slope15;
   const aligned = long
      ? c5 > 0 && c15 > 0 && p.taker >= 0.51 && p.price > p.ema50 && (p.st_bull || p.bull_align || p.HH_HL)
      : c5 < 0 && c15 < 0 && p.taker <= 0.49 && p.price < p.ema50 && (p.st_bear || p.bear_align || p.LH_LL);
   return {
      confirmed: reasoning.confirmation?.isConfirmed === true && reasoning.confirmation.confirmedSignal === side,
      timingPassed: reasoning.timingGate?.passed === true,
      persistent: reasoning.flow?.persistenceState === "STRONG",
      aligned: !!aligned,
      atrPct: p.price > 0 ? p.atr14 / p.price : NaN,
      stopPct: p.price > 0 ? (long ? p.price - stop : stop - p.price) / p.price : NaN,
      costPct: 2 * (feeRate + slippageRate)
   };
}

/** Bounded priority watch; never stores a tradable signal or extends its TTL. */
export class RetestWatch {
   private entries = new Map<string, { expires: number; checked: number }>();
   constructor(private ttl = 30 * 60_000, private capacity = 100) {}
   remember(symbol: string, now = Date.now()) {
      if (this.entries.has(symbol)) return;
      if (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(symbol, { expires: now + this.ttl, checked: 0 });
   }
   remove(symbol: string) { this.entries.delete(symbol); }
   take(now = Date.now(), limit = 5): string[] {
      for (const [s, e] of this.entries) if (e.expires <= now) this.entries.delete(s);
      return [...this.entries].filter(([, e]) => now - e.checked >= 60_000)
         .sort((a, b) => a[1].checked - b[1].checked).slice(0, limit)
         .map(([s, e]) => { e.checked = now; return s; });
   }
   get size() { return this.entries.size; }
}
