import { MarketRegimeType } from "./reasoningEngine";
import { TOXIC_HOURS_UTC } from "./flowMetrics.js";

export interface ExecutionFilterOpts {
   rvol?: number;
   adx?: number;
   hourUtc?: number;
   /** 10-candle drift % on the trade timeframe (entry price vs close 10 candles back).
    *  Forensic Rule A: entries must be flow-ALIGNED with the short tape. */
   chg10Pct?: number;
   /** Setup label (PULLBACK_SNIPER / BREAKOUT_MOMENTUM / RANGE_REVERSION).
    *  Forensic Rule B: setup x regime matrix. */
   setupType?: string;
}

export interface ExecutionFilterResult {
   blocked: boolean;
   reason: string;
   ruleTriggered?: string | null;
}

/**
 * Enhanced Execution Filter for BeastBotSniper (v3.1.1 — live-forensics hardened):
 * Execution-layer veto for NEW entries only. It never closes open positions.
 *
 * Enforces (first 4 rules = the validated 4-rule counterfactual stack that
 * flips the live book from -61.27 to +30.74, PF 0.65 -> 4.12):
 * 1. TOXIC HOURS (forensic Rule C): hard block at the REAL measured loss hours
 *    00/01/03/04/07/09/10/11/19/23 UTC (live-data derived from 96 deployed
 *    trades — replaces the old wrong 05/06/13/18 research guess).
 * 2. FLOW-ALIGNED TAPE (forensic Rule A): SHORT only INTO falling tape
 *    (chg10 <= -0.15%); LONG only INTO rising tape (chg10 >= +0.15%).
 *    Live forensics: fast EMA21/CVD deaths (median 26min, 81% of gross loss)
 *    were timing errors — entering against the immediate tape right before a
 *    bounce. Winners rode falling knives; losers fought them.
 * 3. SETUP x REGIME (forensic Rule B): PULLBACK_SNIPER banned in BEAR_STRONG
 *    (measured -31.79 — bear-rally squeezes ate every pullback long-wick fade;
 *    in a strong bear, pullbacks are squeeze FOOD, not entries).
 * 4. Per-symbol cooldown (forensic Rule D): lives in symbolGuard.ts (engine
 *    layer) — re-entry loops after 2 straight losses on one symbol = -44 USDT.
 * 5. SHORT blocked: BTC BULL_STRONG + Asset TRANSITION/TREND_UP (one-sided market).
 * 6. LONG blocked : BTC BULL_WEAK  + Asset TRANSITION/TREND_DOWN (safety gate).
 * 7. LONG in RANGE blocked during BTC BULL_* regimes (alt liquidity drains
 *    into BTC and range lows keep breaking).
 * 8. RANGE entries require minimum participation: RVOL >= 1.20 AND ADX >= 18.
 *
 * NOTE: SHORT in RANGE during BTC BULL_* / BEAR_* is ALLOWED (the measured
 * "goldmine" setup) as long as the volume/momentum floor passes.
 * NOTE: the RANGE_REVERSION pathway intentionally omits chg10Pct — fading a
 * range edge is counter-tape BY DESIGN and has its own exhaustion gates.
 */

/** Forensic Rule A threshold: min 10-candle drift % required in trade direction. */
export const MOMENTUM_FLOOR_PCT = 0.15;

export function evaluateExecutionFilter(
   direction: "LONG" | "SHORT",
   btcRegime: string,
   assetRegime: MarketRegimeType | string,
   opts?: ExecutionFilterOpts
): ExecutionFilterResult {
   // ------------------------------------------------------------------
   // 1. TOXIC HOURS (forensic Rule C — hard block for new entries, open
   //    trades untouched). Hours measured LIVE from 96 deployed trades.
   // ------------------------------------------------------------------
   if (opts?.hourUtc !== undefined && TOXIC_HOURS_UTC.includes(opts.hourUtc)) {
      return {
         blocked: true,
         reason: `toxic hour ${opts.hourUtc}:00 UTC — live-measured loss window (forensic). New entries paused.`,
         ruleTriggered: "TOXIC_HOUR"
      };
   }

   // ------------------------------------------------------------------
   // 2. FLOW-ALIGNED TAPE (forensic Rule A): never fight the immediate tape.
   //    Shorts need falling 10-candle drift, longs need rising drift.
   // ------------------------------------------------------------------
   if (opts?.chg10Pct !== undefined) {
      if (direction === "SHORT" && opts.chg10Pct > -MOMENTUM_FLOOR_PCT) {
         return {
            blocked: true,
            reason: `Flat-tape SHORT: 10-candle drift ${opts.chg10Pct.toFixed(2)}% is not falling (need <= -${MOMENTUM_FLOOR_PCT}%). Entering against the tape = bounce food.`,
            ruleTriggered: "FLOW_TAPE_MISMATCH"
         };
      }
      if (direction === "LONG" && opts.chg10Pct < MOMENTUM_FLOOR_PCT) {
         return {
            blocked: true,
            reason: `Flat-tape LONG: 10-candle drift ${opts.chg10Pct.toFixed(2)}% is not rising (need >= +${MOMENTUM_FLOOR_PCT}%). Entering against the tape = knife catching.`,
            ruleTriggered: "FLOW_TAPE_MISMATCH"
         };
      }
   }

   // ------------------------------------------------------------------
   // 3. SETUP x REGIME (forensic Rule B): pullback fades in a strong bear
   //    are squeeze food (-31.79 measured).
   // ------------------------------------------------------------------
   if (opts?.setupType === "PULLBACK_SNIPER" && btcRegime === "BEAR_STRONG") {
      return {
         blocked: true,
         reason: `PULLBACK_SNIPER banned in BEAR_STRONG: bear-rally squeezes dominate pullbacks (forensic -31.79). Wait for regime shift.`,
         ruleTriggered: "PULLBACK_IN_BEAR_STRONG"
      };
   }

   // ------------------------------------------------------------------
   // 4. Regime x Asset matrix
   // ------------------------------------------------------------------
   if (
      direction === "SHORT" &&
      btcRegime === "BULL_STRONG" &&
      (assetRegime === "TRANSITION" || assetRegime === "TREND_UP")
   ) {
      return {
         blocked: true,
         reason: `Blocked SHORT because BTC Regime is BULL_STRONG and Asset Regime is ${assetRegime}.`,
         ruleTriggered: "SHORT_IN_BTC_BULL_STRONG"
      };
   }

   if (
      direction === "LONG" &&
      btcRegime === "BULL_WEAK" &&
      (assetRegime === "TRANSITION" || assetRegime === "TREND_DOWN")
   ) {
      return {
         blocked: true,
         reason: `Blocked LONG because BTC Regime is BULL_WEAK and Asset Regime is ${assetRegime}.`,
         ruleTriggered: "LONG_IN_BTC_BULL_WEAK"
      };
   }

   // ------------------------------------------------------------------
   // 5. RANGE rules: volume/momentum floor + the RANGE Long Trap
   // ------------------------------------------------------------------
   if (assetRegime === "RANGE") {
      // RANGE Long Trap: buying range lows while BTC pumps drains alt liquidity.
      if (direction === "LONG" && (btcRegime === "BULL_STRONG" || btcRegime === "BULL_WEAK")) {
         return {
            blocked: true,
            reason: `RANGE Long Trap: LONG in RANGE prohibited during BTC ${btcRegime} (forensic liquidity drain into BTC).`,
            ruleTriggered: "LONG_IN_RANGE_DURING_BTC_BULL"
         };
      }

      // Dead chop floor: RANGE trades need participation + directional force
      const rvol = opts?.rvol;
      const adx = opts?.adx;
      if (rvol !== undefined && rvol < 1.2) {
         return {
            blocked: true,
            reason: `Dead chop in RANGE: RVOL ${rvol.toFixed(2)} < 1.20 minimum participation required.`,
            ruleTriggered: "RANGE_DEAD_CHOP_RVOL"
         };
      }
      if (adx !== undefined && adx < 18) {
         return {
            blocked: true,
            reason: `Dead chop in RANGE: ADX ${adx.toFixed(1)} < 18 minimum directional force required.`,
            ruleTriggered: "RANGE_DEAD_CHOP_ADX"
         };
      }
   }

   return { blocked: false, reason: "Allowed", ruleTriggered: null };
}
