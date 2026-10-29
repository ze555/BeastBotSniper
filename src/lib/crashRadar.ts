// ============================================================================
// CRASH RADAR (v3.1.2) — ride the collapse instead of hiding from it
// ============================================================================
// Live forensics from the 2026-10-29 BTC crash (01:00-02:35 UTC) proved the
// exact kill-chain that starved the bot during the most profitable event in
// the market:
//   1. `btc_violent` (|45min chg| > 0.8% && RVOL > 2.5) — which is literally
//      the SIGNATURE of a crash — set ctx.tradeable=false → every symbol
//      returned BLOCKED. The bot hid precisely when the wave was biggest.
//   2. geniusMode zeroed ALL shorts because the 4h EMA regime still said
//      BULL_* — a label that lags the crash by hours. Regime is rear-view
//      mirror; the cascade is the windshield.
//   3. RSI corridor penalized shorts for being oversold (squeeze thinking
//      applied to a waterfall — oversold gets MORE oversold in cascades).
//   4. RANGE reversion opened LONGs on "RSI oversold" — catching knives,
//      emergency-exited within 30 seconds (live logs 02:23 & 02:26 UTC).
//
// The radar detects a LIVE directional cascade from the 15m tape (velocity +
// candle anatomy + volume expansion + optional liquidation dominance) and
// exposes it so the engine can:
//   - override the stale regime label in the cascade direction,
//   - override toxic-hour stats (measured on chop — a cascade is the opposite),
//   - BLOCK counter-tape reversion/pullback entries (no knife catching),
//   - size cascade entries at reduced risk (slippage + whipsaw).
// It is symmetric: violent PUMPs unlock longs the same way.

export type ViolenceDirection = "DOWN" | "UP" | "NONE";

export interface ViolenceState {
   active: boolean;
   direction: ViolenceDirection;
   /** 0..1 — severity of the move relative to the thresholds. */
   intensity: number;
   /** minutes since the last qualifying cascade candle (0 while triggering) */
   sinceTriggerMin: number;
   drop45Pct: number;   // 3-candle (45min) velocity, negative = falling
   drop90Pct: number;   // 6-candle (90min) velocity
}

export interface CrashRadarConfig {
   /** 45-min (3x15m) velocity threshold that can trigger a cascade. */
   drop45Pct: number;      // 0.9 => -0.9% in 45min for DOWN
   /** 90-min (6x15m) velocity threshold (slower confirmation). */
   drop90Pct: number;      // 1.5
   /** how many minutes the radar stays active after the last trigger candle */
   holdMinutes: number;    // 20 — hysteresis, prevents flapping
   /** min RVOL of the last candle (volume must EXPAND into the move) */
   rvolFloor: number;      // 1.4
}

const DEFAULTS: CrashRadarConfig = {
   drop45Pct: 0.9,
   drop90Pct: 1.5,
   holdMinutes: 20,
   rvolFloor: 1.4
};

let cfg: CrashRadarConfig = { ...DEFAULTS };

let state: ViolenceState = {
   active: false, direction: "NONE", intensity: 0,
   sinceTriggerMin: 0, drop45Pct: 0, drop90Pct: 0
};

let lastTriggerMs = 0;
let lastDirection: ViolenceDirection = "NONE";

export function configureCrashRadar(opts: Partial<CrashRadarConfig>) {
   if (opts.drop45Pct !== undefined) cfg.drop45Pct = Math.max(0.3, Number(opts.drop45Pct));
   if (opts.drop90Pct !== undefined) cfg.drop90Pct = Math.max(cfg.drop45Pct, Number(opts.drop90Pct));
   if (opts.holdMinutes !== undefined) cfg.holdMinutes = Math.max(5, Number(opts.holdMinutes));
   if (opts.rvolFloor !== undefined) cfg.rvolFloor = Math.max(1.0, Number(opts.rvolFloor));
}

export function getCrashRadarConfig(): CrashRadarConfig {
   return { ...cfg };
}

/**
 * Feed BTC 15m klines (last ~8+ candles) each context refresh.
 * `liq` is the optional live liquidation snapshot for BTC — a dominant-side
 * cascade aligned with the tape adds conviction via a threshold relax factor.
 */
export function updateCrashRadar(
   klines15: any[],
   liq?: { intensity: number; dominantSide: string } | null,
   nowMs: number = Date.now()
): ViolenceState {
   const ks = klines15 || [];
   if (ks.length < 8) {
      state = { ...state, active: state.active && (nowMs - lastTriggerMs) < cfg.holdMinutes * 60_000 };
      return getViolenceState(nowMs);
   }

   const n = ks.length;
   const px = (k: any) => (typeof k.close === "number" ? k.close : parseFloat(k.close));
   const now = px(ks[n - 1]);
   const ref45 = px(ks[n - 4]);   // 3 closed candles back
   const ref90 = px(ks[Math.max(0, n - 7)]); // 6 closed candles back
   const drop45 = (now - ref45) / ref45 * 100;
   const drop90 = (now - ref90) / ref90 * 100;

   // Candle anatomy over the last 4 candles: red/green dominance + where the
   // LAST candle closed inside its own range (real follow-through, not a wick).
   const last4 = ks.slice(-4);
   const reds = last4.filter((k: any) => px(k) < (typeof k.open === "number" ? k.open : parseFloat(k.open))).length;
   const greens = last4.filter((k: any) => px(k) > (typeof k.open === "number" ? k.open : parseFloat(k.open))).length;
   const lc = ks[n - 1];
   const rng = (lc.high - lc.low);
   const closePos = rng > 0 ? (px(lc) - lc.low) / rng : 0.5;

   // Volume expansion
   const vols = ks.slice(-20).map((k: any) => (typeof k.volume === "number" ? k.volume : parseFloat(k.volume)));
   const avgVol = vols.reduce((a: number, b: number) => a + b, 0) / Math.max(1, vols.length);
   const rvol = avgVol > 0 ? (typeof lc.volume === "number" ? lc.volume : parseFloat(lc.volume)) / avgVol : 0;

   // Liquidation cascade aligned with the tape relaxes the velocity bar ~20%
   let relax = 1.0;
   if (liq && liq.intensity >= 2 && liq.dominantSide === "LONGS") relax = 0.8;  // longs being liquidated into a fall
   if (liq && liq.intensity >= 2 && liq.dominantSide === "SHORTS") relax = 0.8; // shorts being liquidated into a pump

   const downVelocity = (drop45 <= -cfg.drop45Pct * relax) || (drop90 <= -cfg.drop90Pct * relax);
   const upVelocity = (drop45 >= cfg.drop45Pct * relax) || (drop90 >= cfg.drop90Pct * relax);

   const downAnatomy = reds >= 3 && closePos <= 0.45;
   const upAnatomy = greens >= 3 && closePos >= 0.55;

   const volOk = rvol >= cfg.rvolFloor;

   let direction: ViolenceDirection = "NONE";
   if (downVelocity && downAnatomy && volOk) direction = "DOWN";
   else if (upVelocity && upAnatomy && volOk) direction = "UP";

   if (direction !== "NONE") {
      lastTriggerMs = nowMs;
      lastDirection = direction;
      const severity = Math.max(
         Math.abs(drop45) / (cfg.drop45Pct * 2),
         Math.abs(drop90) / (cfg.drop90Pct * 2)
      );
      state = {
         active: true,
         direction,
         intensity: Math.min(1, severity),
         sinceTriggerMin: 0,
         drop45Pct: drop45,
         drop90Pct: drop90
      };
   } else {
      const sinceMin = lastTriggerMs ? (nowMs - lastTriggerMs) / 60_000 : Infinity;
      const stillActive = lastTriggerMs > 0 && sinceMin < cfg.holdMinutes;
      state = {
         active: stillActive,
         direction: stillActive ? lastDirection : "NONE",
         intensity: stillActive ? Math.max(0, state.intensity * (1 - sinceMin / (cfg.holdMinutes * 3))) : 0,
         sinceTriggerMin: stillActive ? sinceMin : 0,
         drop45Pct: drop45,
         drop90Pct: drop90
      };
   }

   return getViolenceState(nowMs);
}

export function getViolenceState(nowMs: number = Date.now()): ViolenceState {
   if (state.active && lastTriggerMs) {
      const since = (nowMs - lastTriggerMs) / 60_000;
      if (since >= cfg.holdMinutes) {
         return { ...state, active: false, direction: "NONE", intensity: 0, sinceTriggerMin: since };
      }
   }
   return { ...state };
}

/** True when a cascade is live in the OPPOSITE direction of this trade. */
export function isCounterTape(direction: "LONG" | "SHORT", nowMs: number = Date.now()): boolean {
   const vs = getViolenceState(nowMs);
   if (!vs.active) return false;
   return (vs.direction === "DOWN" && direction === "LONG") ||
          (vs.direction === "UP" && direction === "SHORT");
}

/** True when a cascade is live ALIGNED with this trade direction. */
export function isWithTape(direction: "LONG" | "SHORT", nowMs: number = Date.now()): boolean {
   const vs = getViolenceState(nowMs);
   if (!vs.active) return false;
   return (vs.direction === "DOWN" && direction === "SHORT") ||
          (vs.direction === "UP" && direction === "LONG");
}

export function resetCrashRadar() {
   state = { active: false, direction: "NONE", intensity: 0, sinceTriggerMin: 0, drop45Pct: 0, drop90Pct: 0 };
   lastTriggerMs = 0;
   lastDirection = "NONE";
   cfg = { ...DEFAULTS };
}
