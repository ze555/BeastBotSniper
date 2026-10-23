import { MarketRegimeType } from "./reasoningEngine";
import { TOXIC_HOURS_UTC } from "./flowMetrics.js";

export interface ExecutionFilterOpts {
   rvol?: number;
   adx?: number;
   hourUtc?: number;
}

export interface ExecutionFilterResult {
   blocked: boolean;
   reason: string;
   ruleTriggered?: string | null;
}

/**
 * Enhanced Execution Filter for BeastBotSniper (v3.1):
 * Execution-layer veto for NEW entries only. It never closes open positions.
 *
 * Enforces:
 * 1. SHORT blocked: BTC BULL_STRONG + Asset TRANSITION/TREND_UP (fully one-sided market).
 * 2. LONG blocked : BTC BULL_WEAK  + Asset TRANSITION/TREND_DOWN (forensic safety gate).
 * 3. LONG in RANGE blocked during BTC BULL_* regimes (the #1 loss maker:
 *    altcoin liquidity drains into BTC and range lows keep breaking).
 * 4. RANGE entries require minimum participation: RVOL >= 1.20 AND ADX >= 18
 *    (dead chop without volume/momentum is untradeable).
 * 5. Toxic hours (UTC): 05:00, 06:00, 13:00, 18:00 — measured chop/liquidation
 *    windows from the bot's own trade research.
 *
 * NOTE: SHORT in RANGE during BTC BULL_* / BEAR_* is ALLOWED (the measured
 * "goldmine" setup) as long as the volume/momentum floor passes.
 */
export function evaluateExecutionFilter(
   direction: "LONG" | "SHORT",
   btcRegime: string,
   assetRegime: MarketRegimeType | string,
   opts?: ExecutionFilterOpts
): ExecutionFilterResult {
   // ------------------------------------------------------------------
   // 1. TOXIC HOURS (hard block for new entries, open trades untouched)
   // ------------------------------------------------------------------
   if (opts?.hourUtc !== undefined && TOXIC_HOURS_UTC.includes(opts.hourUtc)) {
      return {
         blocked: true,
         reason: `toxic hour ${opts.hourUtc}:00 UTC — historically choppy/liquidation window. New entries paused.`,
         ruleTriggered: "TOXIC_HOUR"
      };
   }

   // ------------------------------------------------------------------
   // 2. Regime x Asset matrix
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
   // 3. RANGE rules: volume/momentum floor + the RANGE Long Trap
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
