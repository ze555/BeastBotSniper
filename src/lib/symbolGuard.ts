// ============================================================================
// SYMBOL GUARD (v3.1.1) — Forensic Rule D: per-symbol loss-streak cooldown
// ============================================================================
// Live forensics on 96 deployed trades (hostless.app instance) proved that
// re-entry loops were pure bleed: symbols traded >=3x (always re-shorting the
// same falling knife) accounted for -44 USDT net. The bot kept re-entering
// the SAME symbol right after being stopped out, feeding the same losing
// scenario over and over.
//
// Rule (validated counterfactually as part of the 4-rule stack that flips the
// book from -61.27 to +30.74, PF 4.12): after N consecutive losses on the
// same symbol, that symbol is blocked from NEW entries for a cooldown window.
// Open positions are NEVER touched — this is an entry-layer guard only.
//
// A single win resets the streak. A breakeven scratch (pnl === 0) does not
// increment the streak but does not reset it either (fee-friction neutrality).

export interface SymbolGuardConfig {
   lossStreakLimit: number;   // consecutive losses before cooldown fires
   cooldownMinutes: number;   // how long the symbol stays blocked
   scratchThreshold: number;  // |pnl| below this = scratch (streak untouched)
}

const DEFAULTS: SymbolGuardConfig = {
   lossStreakLimit: 2,
   cooldownMinutes: 240,      // 4 hours — validated in the counterfactual walk
   scratchThreshold: 0.05
};

let cfg: SymbolGuardConfig = { ...DEFAULTS };

const lossStreaks = new Map<string, number>();
const blockedUntil = new Map<string, number>();

export function configureSymbolGuard(opts: Partial<SymbolGuardConfig>) {
   if (opts.lossStreakLimit !== undefined) cfg.lossStreakLimit = Math.max(1, Math.floor(opts.lossStreakLimit));
   if (opts.cooldownMinutes !== undefined) cfg.cooldownMinutes = Math.max(0, Math.floor(opts.cooldownMinutes));
   if (opts.scratchThreshold !== undefined) cfg.scratchThreshold = Math.abs(opts.scratchThreshold);
}

export function getSymbolGuardConfig(): SymbolGuardConfig {
   return { ...cfg };
}

/**
 * Feed a closed trade result. Call once per full close (closeTradeFull).
 *  - pnl > +scratch  → win: streak resets, cooldown lifts
 *  - |pnl| <= scratch → scratch: streak unchanged
 *  - pnl < -scratch  → loss: streak grows; at limit, cooldown window opens
 */
export function recordSymbolResult(symbol: string, pnl: number, nowMs: number = Date.now()) {
   if (!symbol) return;
   if (pnl > cfg.scratchThreshold) {
      lossStreaks.set(symbol, 0);
      blockedUntil.delete(symbol);
      return;
   }
   if (pnl >= -cfg.scratchThreshold) return; // fee scratch — neutral

   const streak = (lossStreaks.get(symbol) || 0) + 1;
   lossStreaks.set(symbol, streak);
   if (streak >= cfg.lossStreakLimit && cfg.cooldownMinutes > 0) {
      blockedUntil.set(symbol, nowMs + cfg.cooldownMinutes * 60_000);
   }
}

export interface SymbolGuardVerdict {
   blocked: boolean;
   reason: string;
   streak: number;
   minutesLeft: number;
}

export function isSymbolBlocked(symbol: string, nowMs: number = Date.now()): SymbolGuardVerdict {
   const streak = lossStreaks.get(symbol) || 0;
   const until = blockedUntil.get(symbol) || 0;
   if (until > nowMs) {
      const minutesLeft = Math.ceil((until - nowMs) / 60_000);
      return {
         blocked: true,
         reason: `${symbol} cooldown: ${streak} consecutive losses — re-entry loop protection (resumes in ${minutesLeft}min)`,
         streak,
         minutesLeft
      };
   }
   return { blocked: false, reason: "", streak, minutesLeft: 0 };
}

/** Drop state for symbols no longer on the rotating watchlist. */
export function pruneSymbolGuard(activeSymbols: Set<string>) {
   for (const key of lossStreaks.keys()) {
      if (!activeSymbols.has(key)) lossStreaks.delete(key);
   }
   for (const key of blockedUntil.keys()) {
      if (!activeSymbols.has(key)) blockedUntil.delete(key);
   }
}

/** Test hook — wipe all state. */
export function resetSymbolGuard() {
   lossStreaks.clear();
   blockedUntil.clear();
   cfg = { ...DEFAULTS };
}
