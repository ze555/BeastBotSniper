/**
 * IGNITION SWEEP v3.3.2 — test suite
 * The WS radar died silently in production (1228 reconnects/31h, 0
 * liquidations delivered, 0 ignition flags) while waves printed. The REST
 * sweep diffs /fapi/v1/ticker/24hr lastPrice vs a ~2min-old snapshot —
 * one call per sweep, zero WS dependency. Contract under test:
 *   - computeSweepMove: signed % move, guarded against zero/garbage prices
 *   - queue feed semantics stay source-agnostic (move2min field accepted)
 * Quality contract: the sweep only NOMINATES — same gates decide.
 */
import assert from "node:assert";
import { computeSweepMove } from "./apexPredator.js";

let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
   try { fn(); passed++; }
   catch (e: any) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

check("rising wave → positive %", () => {
   assert(Math.abs(computeSweepMove(1.0, 1.012) - 1.2) < 0.01);
});

check("collapsing wave → negative %", () => {
   assert(Math.abs(computeSweepMove(0.255, 0.2500) + 1.96) < 0.02);
});

check("flat tape → ~0 (below threshold)", () => {
   assert(Math.abs(computeSweepMove(100, 100.05)) < 0.1);
});

check("zero/invalid previous price → 0 (no flag)", () => {
   assert(computeSweepMove(0, 100) === 0);
   assert(computeSweepMove(NaN, 100) === 0);
});

check("calibration: BTC's measured -3.5%/90min wave = 1.16%/2min ≥ 0.8 threshold", () => {
   // a 0.8%/2min threshold must flag a wave moving at BTC's measured pace
   const wave2min = computeSweepMove(100, 98.84); // -1.16%
   assert(Math.abs(wave2min) >= 0.8, `expected |move| ≥ 0.8, got ${wave2min}`);
});

check("calibration: alts at 2× BTC pace flag in the FIRST sweep window", () => {
   const alt2min = computeSweepMove(1.0, 0.977); // -2.3%
   assert(Math.abs(alt2min) >= 0.8);
});

check("sub-threshold noise does NOT flag (anti-spam)", () => {
   // typical chop: 0.3%/2min must stay silent
   assert(Math.abs(computeSweepMove(100, 100.3)) < 0.8);
});

check("huge collapse flags loudly (crash start)", () => {
   assert(Math.abs(computeSweepMove(2.5, 2.3)) >= 0.8); // -8%
});

console.log(`\nIgnition Sweep v3.3.2: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
