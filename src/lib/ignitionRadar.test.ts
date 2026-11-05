/**
 * IGNITION RADAR v3.3.1 — test suite
 * Validates the all-market weak-coin ignition detection that feeds the
 * priority scan queue (user directive: weak coins MUST be scanned at the
 * START of an explosion/collapse, without touching entry/exit gates):
 *   - computeIgnitionMove: signed % move over a trailing window
 *   - ignitionScore: composite priority (60s > 180s/2, liq fuel)
 * Anchored to the radar contract:
 *   - data arrives as ARRAYS on !markPrice@arr (the old singular handler
 *     was dead code — silently disabled since v3.1)
 *   - a candidate needs ≥RADAR_MIN_SAMPLES of coverage
 *   - liquidation bursts qualify a coin even before the price move prints
 */
import assert from "node:assert";
import { computeIgnitionMove, ignitionScore, RadarSample } from "./liveDataFeed.js";

let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
   try { fn(); passed++; }
   catch (e: any) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

const NOW = 1_000_000_000_000;

// ─── computeIgnitionMove ───────────────────────────────────────────────────

check("flat prices → ~0 move", () => {
   const samples: RadarSample[] = [];
   for (let i = 0; i < 20; i++) samples.push({ ts: NOW - (20 - i) * 3000, p: 100 });
   const m = computeIgnitionMove(samples, NOW, 60_000);
   assert(m !== null);
   assert(Math.abs(m!) < 0.0001, `expected ~0, got ${m}`);
});

check("rising move returns SIGNED positive %", () => {
   const samples: RadarSample[] = [];
   for (let i = 0; i < 20; i++) samples.push({ ts: NOW - (20 - i) * 3000, p: 100 });
   samples.push({ ts: NOW, p: 101.2 }); // +1.2%
   const m = computeIgnitionMove(samples, NOW, 60_000);
   assert(m !== null && Math.abs(m! - 1.2) < 0.01, `expected +1.2, got ${m}`);
});

check("collapsing move returns SIGNED negative %", () => {
   const samples: RadarSample[] = [];
   for (let i = 0; i < 20; i++) samples.push({ ts: NOW - (20 - i) * 3000, p: 50 });
   samples.push({ ts: NOW, p: 49.2 }); // -1.6%
   const m = computeIgnitionMove(samples, NOW, 60_000);
   assert(m !== null && Math.abs(m! + 1.6) < 0.01, `expected -1.6, got ${m}`);
});

check("base sample INSIDE the window is used (not the oldest overall)", () => {
   // oldest sample 10 min ago (way outside the 60s window) must be skipped
   const samples: RadarSample[] = [{ ts: NOW - 600_000, p: 200 }];
   for (let i = 0; i < 5; i++) samples.push({ ts: NOW - (5 - i) * 3000, p: 100 });
   samples.push({ ts: NOW, p: 100 });
   const m = computeIgnitionMove(samples, NOW, 60_000);
   assert(m !== null && Math.abs(m!) < 0.0001, `expected ~0 (base=100), got ${m}`);
});

check("no coverage inside window → null", () => {
   const samples: RadarSample[] = [
      { ts: NOW - 600_000, p: 100 },
      { ts: NOW - 300_000, p: 101 }
   ];
   assert(computeIgnitionMove(samples, NOW, 60_000) === null);
});

check("fewer than 2 samples → null", () => {
   assert(computeIgnitionMove([{ ts: NOW, p: 100 }], NOW, 60_000) === null);
   assert(computeIgnitionMove([], NOW, 60_000) === null);
});

check("stale identical timestamps → null (division guard)", () => {
   const samples: RadarSample[] = [{ ts: NOW - 30_000, p: 100 }, { ts: NOW - 30_000, p: 105 }];
   assert(computeIgnitionMove(samples, NOW, 60_000) === null);
});

check("zero/invalid price guarded", () => {
   const samples: RadarSample[] = [
      { ts: NOW - 30_000, p: 0 },
      { ts: NOW, p: 100 }
   ];
   assert(computeIgnitionMove(samples, NOW, 60_000) === null);
});

check("180s window sees slower ignitions the 60s window misses", () => {
   // gradual drift: +0.06% per 5s step → 60s move ≈ 0.72% (below 0.9
   // threshold), 180s move ≈ 2.19% (above 1.6 threshold)
   const samples: RadarSample[] = [];
   for (let i = 0; i < 40; i++) samples.push({ ts: NOW - (40 - i) * 5000, p: 100 * Math.pow(1.0006, i) });
   const m60 = computeIgnitionMove(samples, NOW, 60_000);
   const m180 = computeIgnitionMove(samples, NOW, 180_000);
   assert(m60 !== null && Math.abs(m60!) < 0.9, `60s move should stay sub-threshold, got ${m60}`);
   assert(m180 !== null && Math.abs(m180!) >= 1.6, `180s move should cross threshold, got ${m180}`);
});

// ─── ignitionScore ─────────────────────────────────────────────────────────

check("score: 60s move dominates, 180s half-weight", () => {
   // +1.0% on 60s, 0 on 180s, no liq
   const a = ignitionScore(1.0, 0, 0);
   // 0 on 60s, +2.0% on 180s, no liq
   const b = ignitionScore(0, 2.0, 0);
   assert(Math.abs(a - 1.0) < 1e-9);
   assert(Math.abs(b - 1.0) < 1e-9); // 2.0 * 0.5
   assert(Math.abs(a - b) < 1e-9);
});

check("score: liquidation notional adds fuel ($50k ≈ +1.0)", () => {
   assert(Math.abs(ignitionScore(0, 0, 50_000) - 1.0) < 1e-9);
   // a $200k cascade in 60s outranks a bare 1% price move
   assert(ignitionScore(0, 0, 200_000) > ignitionScore(1.0, 0, 0));
});

check("score: sign never inflates priority (abs semantics)", () => {
   assert(Math.abs(ignitionScore(-2.0, -1.0, 0) - ignitionScore(2.0, 1.0, 0)) < 1e-9);
});

// ─── verdict ───────────────────────────────────────────────────────────────
console.log(`\nIgnition Radar v3.3.1: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
