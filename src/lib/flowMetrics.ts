// ============================================================================
// BEASTBOT FLOW METRICS ENGINE (v3.1.0)
// Normalized, unit-free orderflow metrics.
//
// WHY THIS EXISTS (critical bug fix):
//   Legacy code compared RAW CVD slopes against absolute constants
//   (e.g. slope15 < -100 && slope5 < -80). CVD is denominated in BASE ASSET
//   units, so "-100" is meaningless noise for 1000PEPE (volumes in billions)
//   and an extreme event for BTCUSDT. Every symbol needs its own scale.
//
// SOLUTION:
//   Every metric here is NORMALIZED:
//   - CVD slope => fraction of the average bar volume (unit-free)
//   - CVD delta => z-score against the rolling history of the same symbol
//   - Taker ratio => EMA persistence + percentile rank vs rolling window
//   - Funding    => multi-period mean + percentile rank vs rolling history
//   - Liquidations => rolling window intensity vs rolling baseline
// ============================================================================

export interface NormalizedCvdResult {
   /** Raw slope (base-asset units) — kept for logging/compat only */
   raw: number;
   /** slope normalized by average bar volume of the same window (unit-free). Typical range: -1.5 .. 1.5 */
   norm: number;
   /** z-score of the net window delta vs the symbol's own rolling delta history */
   z: number;
   /** avg bar volume used for normalization (base-asset units) */
   avgVolume: number;
   sampleCount: number;
}

export interface TakerPersistence {
   /** EMA of taker buy ratio (0..1). 0.5 = neutral */
   ema: number;
   /** percentile rank (0..100) of the CURRENT bar taker ratio vs rolling history */
   percentile: number;
   /** slope of the EMA over the last few updates: rising => aggression growing */
   emaSlope: number;
   samples: number;
}

export interface FundingProfile {
   /** mean funding over the rolling history */
   mean: number;
   /** std dev of funding over the rolling history */
   std: number;
   /** percentile rank (0..100) of current funding vs history (100 = most positive ever seen) */
   percentile: number;
   /** current funding (raw) */
   current: number;
   samples: number;
}

export interface LiquidationEvent {
   /** Binance forceOrder convention: "SELL" = LONG liquidated (downside fuel), "BUY" = SHORT liquidated (squeeze fuel) */
   side: "BUY" | "SELL";
   notionalUsd: number;
   ts: number;
}

export interface LiquidationSnapshot {
   /** USD notional of long liquidations in the window */
   longsUsd: number;
   /** USD notional of short liquidations in the window */
   shortsUsd: number;
   /** total notional in window */
   totalUsd: number;
   /** ratio of window total vs rolling baseline (>= liqCascadeRatio => cascade) */
   intensity: number;
   /** true if a cascade is active in the dominant side */
   cascadeActive: boolean;
   /** dominant side of the cascade: "LONGS" (longs wrecked => downside fuel) | "SHORTS" (shorts wrecked => squeeze fuel) | null */
   dominantSide: "LONGS" | "SHORTS" | null;
}  // NOTE: longsUsd counts SELL force orders (long liquidations)

// ---------------------------------------------------------------------------
// Symbol-scoped rolling stores (bounded memory)
// ---------------------------------------------------------------------------
const TAKER_EMA_ALPHA = 0.25;
const TAKER_HISTORY_MAX = 240;
const FUNDING_HISTORY_MAX = 180;
const DELTA_HISTORY_MAX = 240;
const LIQ_WINDOW_MS = 5 * 60 * 1000;
const LIQ_BASELINE_MAX = 720; // rolling baseline samples (1 per 30s loop => ~6h)

const takerState = new Map<string, { ema: number; history: number[]; emaTrail: number[] }>();
const fundingState = new Map<string, { history: number[] }>();
const deltaHistory = new Map<string, number[]>();
const liqEvents = new Map<string, LiquidationEvent[]>();
const liqBaseline = new Map<string, number[]>();

function pushBounded(arr: number[], value: number, max: number) {
   arr.push(value);
   if (arr.length > max) arr.shift();
}

// ---------------------------------------------------------------------------
// 1. NORMALIZED CVD SLOPE
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw CVD slope by the average bar volume of the SAME symbol and
 * window. Result is unit-free and comparable across all symbols.
 *
 * Interpretation guide (norm units):
 *   |norm| >= 1.0  => extreme one-sided aggression
 *   |norm| >= 0.35 => meaningful directional flow
 *   |norm| <  0.15 => noise / balanced flow
 */
export function normalizeCvdSlope(rawSlope: number, avgBarVolume: number, symbol?: string, currentDelta?: number): NormalizedCvdResult {
   const avg = avgBarVolume > 0 ? avgBarVolume : 0;
   const norm = avg > 0 ? rawSlope / avg : 0;

   // Z-score of the net delta vs this symbol's own delta history
   let z = 0;
   let sampleCount = 0;
   if (symbol && currentDelta !== undefined && Number.isFinite(currentDelta)) {
      let hist = deltaHistory.get(symbol);
      if (!hist) { hist = []; deltaHistory.set(symbol, hist); }
      pushBounded(hist, currentDelta, DELTA_HISTORY_MAX);
      sampleCount = hist.length;
      if (hist.length >= 20) {
         const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
         const variance = hist.reduce((a, b) => a + (b - mean) * (b - mean), 0) / hist.length;
         const std = Math.sqrt(variance);
         if (std > 0) z = (currentDelta - mean) / std;
      }
   }

   return { raw: rawSlope, norm, z, avgVolume: avg, sampleCount };
}

/**
 * Convenience: classify normalized slope strength.
 */
export function cvdStrength(norm: number): "EXTREME" | "STRONG" | "MODERATE" | "NOISE" {
   const a = Math.abs(norm);
   if (a >= 1.0) return "EXTREME";
   if (a >= 0.35) return "STRONG";
   if (a >= 0.15) return "MODERATE";
   return "NOISE";
}

// ---------------------------------------------------------------------------
// 2. TAKER RATIO PERSISTENCE (fixes single-candle 0.58/0.42 snapshot flaw)
// ---------------------------------------------------------------------------

/**
 * Feed the current bar's taker buy ratio (0..1) every scan cycle.
 * Maintains an EMA + rolling history for percentile ranking.
 */
export function updateTakerRatio(symbol: string, takerRatio: number): TakerPersistence {
   let st = takerState.get(symbol);
   if (!st) {
      st = { ema: takerRatio, history: [], emaTrail: [] };
      takerState.set(symbol, st);
   }
   if (!Number.isFinite(takerRatio)) takerRatio = 0.5;

   st.ema = st.ema * (1 - TAKER_EMA_ALPHA) + takerRatio * TAKER_EMA_ALPHA;
   pushBounded(st.emaTrail, st.ema, 8);
   pushBounded(st.history, takerRatio, TAKER_HISTORY_MAX);

   // Percentile rank of the current raw reading vs rolling history
   let percentile = 50;
   if (st.history.length >= 30) {
      const below = st.history.filter(v => v <= takerRatio).length;
      percentile = (below / st.history.length) * 100;
   }

   // EMA slope over the trail (positive => buy aggression growing)
   let emaSlope = 0;
   if (st.emaTrail.length >= 4) {
      const first = st.emaTrail[0];
      const last = st.emaTrail[st.emaTrail.length - 1];
      emaSlope = last - first;
   }

   return { ema: st.ema, percentile, emaSlope, samples: st.history.length };
}

export function getTakerPersistence(symbol: string): TakerPersistence | null {
   const st = takerState.get(symbol);
   if (!st || st.history.length < 10) return null;
   let percentile = 50;
   const cur = st.history[st.history.length - 1];
   if (st.history.length >= 30) {
      percentile = (st.history.filter(v => v <= cur).length / st.history.length) * 100;
   }
   let emaSlope = 0;
   if (st.emaTrail.length >= 4) emaSlope = st.emaTrail[st.emaTrail.length - 1] - st.emaTrail[0];
   return { ema: st.ema, percentile, emaSlope, samples: st.history.length };
}

// ---------------------------------------------------------------------------
// 3. FUNDING PROFILE (fixes instantaneous-rate flaw)
// ---------------------------------------------------------------------------

/**
 * Feed the funding rate every scan cycle (cheap: cached 60s upstream).
 * Builds a rolling distribution so "elevated funding" becomes statistically
 * defined per symbol instead of a fixed 0.07% guess.
 */
export function updateFunding(symbol: string, rate: number): FundingProfile {
   let st = fundingState.get(symbol);
   if (!st) { st = { history: [] }; fundingState.set(symbol, st); }
   if (Number.isFinite(rate)) pushBounded(st.history, rate, FUNDING_HISTORY_MAX);

   const h = st.history;
   if (h.length === 0) {
      return { mean: rate || 0, std: 0, percentile: 50, current: rate || 0, samples: 0 };
   }
   const mean = h.reduce((a, b) => a + b, 0) / h.length;
   const variance = h.reduce((a, b) => a + (b - mean) * (b - mean), 0) / h.length;
   const std = Math.sqrt(variance);
   const cur = h[h.length - 1];
   let percentile = 50;
   if (h.length >= 20) {
      percentile = (h.filter(v => v <= cur).length / h.length) * 100;
   }
   return { mean, std, percentile, current: cur, samples: h.length };
}

export function getFundingProfile(symbol: string): FundingProfile | null {
   const st = fundingState.get(symbol);
   if (!st || st.history.length < 10) return null;
   return updateFunding(symbol, st.history[st.history.length - 1]);
}

// ---------------------------------------------------------------------------
// 4. LIQUIDATION TRACKER (replaces fetchLiq() mock with REAL data)
// ---------------------------------------------------------------------------

/**
 * Ingest a real liquidation event (from !forceOrder@arr websocket stream).
 * Called by liveDataFeed.
 */
export function ingestLiquidation(symbol: string, event: LiquidationEvent) {
   let arr = liqEvents.get(symbol);
   if (!arr) { arr = []; liqEvents.set(symbol, arr); }
   arr.push(event);
   pruneLiquidations(symbol);
}

function pruneLiquidations(symbol: string) {
   const arr = liqEvents.get(symbol);
   if (!arr) return;
   const cutoff = Date.now() - LIQ_WINDOW_MS * 2;
   while (arr.length > 0 && arr[0].ts < cutoff) arr.shift();
}

function sumWindow(arr: LiquidationEvent[], now: number): { longsUsd: number; shortsUsd: number; totalUsd: number } {
   let longsUsd = 0, shortsUsd = 0;
   for (const e of arr) {
      if (e.ts < now - LIQ_WINDOW_MS) continue;
      // Binance forceOrder: SELL order => LONG liquidated; BUY order => SHORT liquidated
      if (e.side === "SELL") longsUsd += e.notionalUsd;
      else shortsUsd += e.notionalUsd;
   }
   return { longsUsd, shortsUsd, totalUsd: longsUsd + shortsUsd };
}

/**
 * Snapshot of liquidation pressure for a symbol.
 * `intensity` compares the 5m window total vs the rolling baseline median.
 * Cascade default threshold: intensity >= 4 AND totalUsd >= 150k.
 */
export function getLiquidationSnapshot(symbol: string, opts?: { minTotalUsd?: number; ratioThreshold?: number }): LiquidationSnapshot {
   const now = Date.now();
   pruneLiquidations(symbol);
   const arr = liqEvents.get(symbol) || [];
   const { longsUsd, shortsUsd, totalUsd } = sumWindow(arr, now);

   // Rolling baseline of window totals (sampled externally each loop via recordLiqBaseline)
   const baseArr = liqBaseline.get(symbol) || [];
   let baseline = 0;
   if (baseArr.length >= 12) {
      const sorted = [...baseArr].sort((a, b) => a - b);
      baseline = sorted[Math.floor(sorted.length / 2)];
   }
   const intensity = baseline > 0 ? totalUsd / baseline : (totalUsd > 0 ? 99 : 0);

   const minTotal = opts?.minTotalUsd ?? 150_000;
   const ratioTh = opts?.ratioThreshold ?? 4;

   let cascadeActive = false;
   let dominantSide: "LONGS" | "SHORTS" | null = null;
   if (totalUsd >= minTotal && intensity >= ratioTh) {
      cascadeActive = true;
      dominantSide = longsUsd >= shortsUsd ? "LONGS" : "SHORTS";
   }

   return { longsUsd, shortsUsd, totalUsd, intensity, cascadeActive, dominantSide };
}

/**
 * Record the current window total into the rolling baseline (call once per scan loop).
 */
export function recordLiqBaseline(symbol: string) {
   const arr = liqEvents.get(symbol) || [];
   const { totalUsd } = sumWindow(arr, Date.now());
   let base = liqBaseline.get(symbol);
   if (!base) { base = []; liqBaseline.set(symbol, base); }
   pushBounded(base, totalUsd, LIQ_BASELINE_MAX);
}

// ---------------------------------------------------------------------------
// 5. SESSION RISK WEIGHTING (activates the unused BEST_HOURS/AVOID_HOURS idea
//    and encodes the measured session PnL edge from research exports)
// ---------------------------------------------------------------------------

export type SessionName = "ASIA" | "LONDON" | "LONDON_NY_OVERLAP" | "NEW_YORK" | "LATE_US" | "OFF_HOURS";

/**
 * Session risk multipliers derived from the bot's own research exports:
 *   LONDON: +$84 over 11 trades (best)          => 1.00
 *   ASIA:   +$12 over 21 trades (thin edge)     => 0.85
 *   OVERLAP: -$17 (chop / reversals)            => 0.70 + toxic-hour hard blocks
 *   NEW_YORK: 17-20 UTC power hour              => 0.90
 *   LATE_US: ~flat negative (21-23 UTC)         => 0.75
 * Session names match researchLogger.extractEntryTiming exactly.
 */
export const SESSION_RISK_MULT: Record<SessionName, number> = {
   ASIA: 0.85,
   LONDON: 1.00,
   LONDON_NY_OVERLAP: 0.70,
   NEW_YORK: 0.90,
   LATE_US: 0.75,
   OFF_HOURS: 0.60
};

/**
 * Toxic hours (UTC) — v3.1.1 FORENSIC UPDATE.
 * The old list [5,6,13,18] was a research-export guess that turned out WRONG:
 * the deployed bot bled exactly OUTSIDE those hours. Re-measured from the
 * 96 real deployed trades (hostless.app): ten distinct loss hours dominate:
 * 00/01/03/04 (Asia thin-tape churn), 07/09/10/11 (pre-London drift),
 * 19/23 (late-US liq churn + rollover). Gold hours on the same data:
 * 02/08/12/17 (kept tradeable).
 * Matches the live hourly-PnL forensic chart (report: التقرير الجنائي للخسائر).
 */
export const TOXIC_HOURS_UTC = [0, 1, 3, 4, 7, 9, 10, 11, 19, 23];

export function getSessionName(utcHour: number, utcMinute: number = 0): SessionName {
   const h = utcHour + utcMinute / 60;
   if (h >= 0 && h < 8) return "ASIA";                 // 00-07
   if (h >= 8 && h < 13) return "LONDON";              // 08-12
   if (h >= 13 && h < 17) return "LONDON_NY_OVERLAP";  // 13-16
   if (h >= 17 && h < 21) return "NEW_YORK";           // 17-20
   if (h >= 21 && h < 23.99) return "LATE_US";         // 21-23
   return "OFF_HOURS";
}

// ---------------------------------------------------------------------------
// 6. CLEANUP (avoid unbounded growth with rotating watchlists)
// ---------------------------------------------------------------------------

export function pruneFlowStores(activeSymbols: Set<string>) {
   const prune = <T>(map: Map<string, T>) => {
      for (const key of map.keys()) {
         if (!activeSymbols.has(key)) map.delete(key);
      }
   };
   prune(takerState);
   prune(fundingState);
   prune(deltaHistory);
   prune(liqEvents);
   prune(liqBaseline);
}
