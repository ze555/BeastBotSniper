// ============================================================================
// BEASTBOT DIRECTION REGISTRY (v3.1.0)
// Live wiring for the DirectionStateEngine.
//
// WHY THIS EXISTS (critical fix):
//   directionStateEngine.ts (v3.0) — the event-driven FORMING -> CONFIRMED ->
//   EXTENDING -> WEAKENING -> INVALIDATED machine — was only used in offline
//   replayValidation. The live bot never consulted it, so detected thesis
//   invalidations never reached open trades.
//
//   This registry keeps one engine per symbol, feeds it the latest closed
//   candle on every scan cycle, and exposes decisions to:
//     - EXIT BRAIN   (WEAKENING => tighten trail, INVALIDATED => emergency exit)
//     - ENTRY LAYER  (FORMING/CONFIRMED states => entry evidence)
// ============================================================================

import { DirectionStateEngine, DirectionDecision, CandleData } from "./directionStateEngine.js";

const engines = new Map<string, DirectionStateEngine>();
const lastDecisions = new Map<string, { decision: DirectionDecision; updatedTs: number }>();
const STALE_MS = 10 * 60 * 1000; // decisions older than 10 min are stale

export function getEngine(symbol: string): DirectionStateEngine {
   let engine = engines.get(symbol);
   if (!engine) {
      engine = new DirectionStateEngine(symbol);
      engines.set(symbol, engine);
   }
   return engine;
}

/**
 * Feed the latest 15m candle for a symbol through its state machine.
 * Safe to call repeatedly with the same candle (engine de-dupes by time).
 */
export function updateSymbolDirection(
   symbol: string,
   candle: CandleData,
   btcContext: { regime?: string; btc_chg?: number } = {},
   oiContext: { oiChg?: number } = {}
): DirectionDecision {
   const engine = getEngine(symbol);
   const decision = engine.processCandle(candle, btcContext, oiContext);
   lastDecisions.set(symbol, { decision, updatedTs: Date.now() });
   return decision;
}

/**
 * Latest known decision for a symbol (may be stale — check .updatedTs or use isStale).
 */
export function getDirectionDecision(symbol: string): { decision: DirectionDecision; updatedTs: number; stale: boolean } | null {
   const entry = lastDecisions.get(symbol);
   if (!entry) return null;
   return { decision: entry.decision, updatedTs: entry.updatedTs, stale: Date.now() - entry.updatedTs > STALE_MS };
}

/**
 * Should the exit brain tighten protection for this symbol's open trade?
 * WEAKENING_* states or a fresh invalidation warning => tighten.
 */
export function shouldTighten(symbol: string): boolean {
   const entry = getDirectionDecision(symbol);
   if (!entry || entry.stale) return false;
   return entry.decision.managementAction === "TIGHTEN_PROTECT";
}

/**
 * Has the trade thesis been structurally invalidated by the state machine?
 * This is the signal the legacy bot ignored — the #1 fix for DIRECTION_ERROR losses.
 */
export function isInvalidated(symbol: string): boolean {
   const entry = getDirectionDecision(symbol);
   if (!entry || entry.stale) return false;
   const d = entry.decision;
   return d.managementAction === "EXIT_INVALIDATED" ||
      d.state === "INVALIDATED_LONG" || d.state === "INVALIDATED_SHORT";
}

/**
 * Entry evidence from the state machine: FORMING with minimum evidence chain,
 * or CONFIRMED state => additional conviction (used as a score bonus, not a gate,
 * to avoid over-constraining the reasoning engine).
 */
export function getEntryConvictionBonus(symbol: string): { bonus: number; state: string } {
   const entry = getDirectionDecision(symbol);
   if (!entry || entry.stale) return { bonus: 0, state: "UNKNOWN" };
   const d = entry.decision;
   if (d.state === "CONFIRMED_LONG" || d.state === "CONFIRMED_SHORT") return { bonus: 0.6, state: d.state };
   if (d.state === "EXTENDING_LONG" || d.state === "EXTENDING_SHORT") return { bonus: 0.3, state: d.state };
   return { bonus: 0, state: d.state };
}

export function pruneRegistry(activeSymbols: Set<string>) {
   for (const key of engines.keys()) {
      if (!activeSymbols.has(key)) engines.delete(key);
   }
   for (const key of lastDecisions.keys()) {
      if (!activeSymbols.has(key)) lastDecisions.delete(key);
   }
}

export function getRegistryStats() {
   const states: Record<string, number> = {};
   for (const [, entry] of lastDecisions) {
      states[entry.decision.state] = (states[entry.decision.state] || 0) + 1;
   }
   return { engines: engines.size, decisions: lastDecisions.size, states };
}
