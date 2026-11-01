import { MarketRegimeType } from "./reasoningEngine";

export interface ExecutionFilterResult {
   allowed: boolean;
   blocked: boolean;
   reason?: string;
   blockedReason?: string;
   ruleTriggered?: "SHORT_IN_BTC_BULL_STRONG" | "LONG_IN_BTC_BULL_WEAK" | "RANGE_LONG_IN_BULL" | "TOXIC_HOUR" | "DEAD_CHOP_RANGE" | null;
}

export interface ExecutionFilterOptions {
   rvol?: number;
   adx?: number;
   hourUtc?: number;
}

const TOXIC_HOURS = [5, 6, 13, 18];

/**
 * Execution Filter for BeastBotSniper:
 * Strictly enforces entry execution restrictions while keeping the rest of the system intact:
 * 
 * 1. Toxic Hours Filter: blocks 05:00, 06:00, 13:00, 18:00 UTC (liquidation/reversal chop).
 * 2. Prohibit SHORT: When BTC Regime is "BULL_STRONG" AND Asset Regime is "TRANSITION" or "TREND_UP".
 * 3. Prohibit LONG: When BTC Regime is "BULL_WEAK" AND Asset Regime is "TRANSITION" or "TREND_DOWN".
 * 4. RANGE Long Filter: Prohibit LONG in RANGE during BTC BULL_STRONG or BULL_WEAK.
 * 5. RANGE Dead Chop Filter: Prohibit in RANGE when RVOL < 1.20 or ADX < 18.
 */
export function evaluateExecutionFilter(
   direction: "LONG" | "SHORT",
   btcRegime: string,
   assetRegime: MarketRegimeType | string,
   options?: ExecutionFilterOptions
): ExecutionFilterResult {
   // 1. Toxic Hours check
   if (options?.hourUtc !== undefined && TOXIC_HOURS.includes(options.hourUtc)) {
      const reason = `Execution Filter: Blocked at toxic hour ${options.hourUtc}:00 UTC.`;
      return {
         allowed: false,
         blocked: true,
         reason,
         blockedReason: reason,
         ruleTriggered: "TOXIC_HOUR"
      };
   }

   // 2. Prohibit SHORT: BTC Regime = BULL_STRONG and Asset Regime = TRANSITION or TREND_UP
   if (
      direction === "SHORT" &&
      btcRegime === "BULL_STRONG" &&
      (assetRegime === "TRANSITION" || assetRegime === "TREND_UP")
   ) {
      const reason = `Execution Filter: Blocked SHORT because BTC Regime is BULL_STRONG and Asset Regime is ${assetRegime}.`;
      return {
         allowed: false,
         blocked: true,
         reason,
         blockedReason: reason,
         ruleTriggered: "SHORT_IN_BTC_BULL_STRONG"
      };
   }

   // 3. Prohibit LONG: BTC Regime = BULL_WEAK and Asset Regime = TRANSITION or TREND_DOWN
   if (
      direction === "LONG" &&
      btcRegime === "BULL_WEAK" &&
      (assetRegime === "TRANSITION" || assetRegime === "TREND_DOWN")
   ) {
      const reason = `Execution Filter: Blocked LONG because BTC Regime is BULL_WEAK and Asset Regime is ${assetRegime}.`;
      return {
         allowed: false,
         blocked: true,
         reason,
         blockedReason: reason,
         ruleTriggered: "LONG_IN_BTC_BULL_WEAK"
      };
   }

   // 4. RANGE Long Trap: Prohibit LONG in RANGE during any BTC BULL regime
   if (
      direction === "LONG" &&
      assetRegime === "RANGE" &&
      (btcRegime === "BULL_STRONG" || btcRegime === "BULL_WEAK")
   ) {
      const reason = `Execution Filter: Blocked LONG in RANGE because BTC Regime is ${btcRegime} (altcoin liquidity drain).`;
      return {
         allowed: false,
         blocked: true,
         reason,
         blockedReason: reason,
         ruleTriggered: "RANGE_LONG_IN_BULL"
      };
   }

   // 5. Dead chop in RANGE: Requires RVOL >= 1.20 and ADX >= 18
   if (assetRegime === "RANGE") {
      if (options?.rvol !== undefined && options.rvol < 1.20) {
         const reason = `Execution Filter: Blocked in RANGE due to low volume (RVOL: ${options.rvol.toFixed(2)} < 1.20).`;
         return {
            allowed: false,
            blocked: true,
            reason,
            blockedReason: reason,
            ruleTriggered: "DEAD_CHOP_RANGE"
         };
      }
      if (options?.adx !== undefined && options.adx < 18) {
         const reason = `Execution Filter: Blocked in RANGE due to low directional momentum (ADX: ${options.adx.toFixed(1)} < 18).`;
         return {
            allowed: false,
            blocked: true,
            reason,
            blockedReason: reason,
            ruleTriggered: "DEAD_CHOP_RANGE"
         };
      }
   }

   return {
      allowed: true,
      blocked: false,
      ruleTriggered: null
   };
}
