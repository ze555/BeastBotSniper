import { MarketRegimeType } from "./reasoningEngine";

export interface ExecutionFilterResult {
   allowed: boolean;
   blockedReason?: string;
   ruleTriggered?: "SHORT_IN_BTC_BULL_STRONG" | "LONG_IN_BTC_BULL_WEAK" | null;
}

/**
 * Execution Filter for BeastBotSniper:
 * Strictly enforces entry execution restrictions while keeping the rest of the system intact:
 * 
 * 1. Prohibit SHORT: When BTC Regime is "BULL_STRONG" AND Asset Regime is "TRANSITION" or "TREND_UP".
 * 2. Prohibit LONG: When BTC Regime is "BULL_WEAK" AND Asset Regime is "TRANSITION" or "TREND_DOWN".
 * 
 * Invariants & Guarantees:
 * - Applied across all entry and re-entry pathways.
 * - Does NOT close open positions (isolated from Exit Engine).
 * - Does NOT prohibit "RANGE" (leaves RANGE to original system behavior).
 * - Does NOT alter Direction Engine, indicator calculations, or exit rules.
 */
export function evaluateExecutionFilter(
   direction: "LONG" | "SHORT",
   btcRegime: string,
   assetRegime: MarketRegimeType | string
): ExecutionFilterResult {
   // 1. Prohibit SHORT: BTC Regime = BULL_STRONG and Asset Regime = TRANSITION or TREND_UP
   if (
      direction === "SHORT" &&
      btcRegime === "BULL_STRONG" &&
      (assetRegime === "TRANSITION" || assetRegime === "TREND_UP")
   ) {
      return {
         allowed: false,
         ruleTriggered: "SHORT_IN_BTC_BULL_STRONG",
         blockedReason: `Execution Filter: Blocked SHORT because BTC Regime is BULL_STRONG and Asset Regime is ${assetRegime}.`
      };
   }

   // 2. Prohibit LONG: BTC Regime = BULL_WEAK and Asset Regime = TRANSITION or TREND_DOWN
   if (
      direction === "LONG" &&
      btcRegime === "BULL_WEAK" &&
      (assetRegime === "TRANSITION" || assetRegime === "TREND_DOWN")
   ) {
      return {
         allowed: false,
         ruleTriggered: "LONG_IN_BTC_BULL_WEAK",
         blockedReason: `Execution Filter: Blocked LONG because BTC Regime is BULL_WEAK and Asset Regime is ${assetRegime}.`
      };
   }

   return {
      allowed: true,
      ruleTriggered: null
   };
}
