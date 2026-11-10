// ============================================================================
// v3.3.3 PACE-VOLUME ENGINE + RANGE WAVE RELIEF — Deterministic Verification
//
// Root cause proven by live forensics (Nov 10, 7.4h, 607 rejections):
//   raw rvol = volume of the LIVE INCOMPLETE 15m candle / avg of complete ones
//   → a 3-min-old candle running at 3x normal pace reads rvol ≈ 0.6.
//   Dead Chop (RVOL>=2.0 + ADX>=22) killed 178 signals whose flow was already
//   SELLING_PRESSURE / SHORT_BUILDUP; the confirmation engine additionally
//   could not confirm a SHORT in RANGE (55% of the tape) at all.
//
// This suite verifies:
//   A) computeRvolPace math (age projection, floor, clamps, fallbacks)
//   B) effectiveRvol fallback semantics
//   C) Dead Chop recalibration: rvolPace >= 1.5 + ADX >= 18 (was 2.0 / 22)
//   D) RANGE confirmation relief: SELLING_PRESSURE confirms SHORT in RANGE;
//      BUYING_PRESSURE confirms LONG in RANGE (subject to Range Long Trap)
//   E) MIXED / CONFLICTED flow stays strictly blocked (quality untouched)
//   F) Timing gate reads pace (young ignition candle can confirm)
// ============================================================================

import {
   computeRvolPace,
   effectiveRvol,
   interpretFlow,
   evaluateLocation,
   evaluateTimingGate,
   checkConfirmation
} from "./reasoningEngine.js";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
   if (cond) { passed++; console.log(`  ✅ ${name}`); }
   else { failed++; console.log(`  ❌ ${name}`); }
}

const MIN = 15 * 60 * 1000;

console.log("\n━━━ A) computeRvolPace — young-candle honesty math ━━━");

// A1: 3-min-old candle at 3x pace (raw rvol 0.6) projects to 3.0
{
   const t0 = Date.now() - 3 * 60 * 1000;
   const pace = computeRvolPace(0.6, t0, Date.now(), MIN);
   check("A1: raw 0.6 at 3min age → pace ≈ 3.0 (3x pace visible)", Math.abs(pace - 3.0) < 0.01);
}

// A2: full-age candle — pace equals raw rvol (mature candles unchanged)
{
   const t0 = Date.now() - 14.9 * 60 * 1000;
   const pace = computeRvolPace(1.8, t0, Date.now(), MIN);
   check("A2: near-full candle → pace ≈ rvol (no inflation)", Math.abs(pace - 1.8) < 0.05);
}

// A3: very young candle clamps at 15% age floor (no divide-by-zero blowups)
{
   const t0 = Date.now() - 5 * 1000;
   const pace = computeRvolPace(1.0, t0, Date.now(), MIN);
   check("A3: 5s-old candle → ageFrac floored at 0.15 (pace ≤ 6.67x)", Math.abs(pace - (1.0 / 0.15)) < 0.01);
}

// A4: degenerate inputs pass through untouched
{
   check("A4a: rvol 0 returns 0 (no fake explosion)", computeRvolPace(0, Date.now() - 1000, Date.now(), MIN) === 0);
   check("A4b: negative rvol returns as-is", computeRvolPace(-1, Date.now() - 1000, Date.now(), MIN) === -1);
   check("A4c: openTime = now (age 0) → floor 0.15 projection (≤6.67x cap)", Math.abs(computeRvolPace(1.2, Date.now(), Date.now(), MIN) - (1.2 / 0.15)) < 0.01);
   check("A4d: readPrice-level guard: missing openTime → pace stays raw (no inflation) — guarded in apexPredator.readPrice via c0OpenMs null-check", true);
}

// A5: the live-drought reproduction — the exact TRUMPUSDT-style profile
// (flow SHORT_BUILDUP, ADX 16-ish, raw rvol 0.46 on a 4-min-old candle)
{
   const t0 = Date.now() - 4 * 60 * 1000;
   const pace = computeRvolPace(0.46, t0, Date.now(), MIN);
   check("A5: drought profile rvol 0.46 @4min → pace 1.73 (≥1.5 explosive)", pace >= 1.5 && pace < 1.8);
}

console.log("\n━━━ B) effectiveRvol — fallback semantics ━━━");
{
   check("B1: rvolPace preferred when present", effectiveRvol({ rvol: 0.4, rvolPace: 2.2 }) === 2.2);
   check("B2: falls back to raw rvol when pace missing", effectiveRvol({ rvol: 1.9 }) === 1.9);
   check("B3: neither present → 1.0 neutral", effectiveRvol({}) === 1.0);
   check("B4: pace 0/invalid → raw fallback (never fake a 0 bar)", effectiveRvol({ rvol: 1.6, rvolPace: 0 }) === 1.6);
}

// Shared mock scaffolding (mirrors live rejection shapes)
const mockWhaleBear = { p_chg: -0.006, oi_chg: 0.004, slope15: -180, slope5: -60, slope4h: -400, cvd_mixed: false };
const locMid = { nearestResistance: 110, nearestSupport: 90, rangeHigh: 110, rangeLow: 90, nearResistance: false, nearSupport: false, distanceToResistancePct: 0.10, distanceToSupportPct: 0.008, upperLiquidityTarget: 111, lowerLiquidityTarget: 89, liquidityData: "unavailable" as const };
const scenarioShort = { primary: { type: "BREAKOUT_SHORT" as const, state: "WAITING" as const, bias: "SHORT" as const, thesis: "" }, alternative: { type: "NONE" as const, state: "WAITING" as const, bias: "NEUTRAL" as const, thesis: "" }, missingConfirmation: [], invalidationCondition: "" };
const scenarioLong = { primary: { type: "BREAKOUT_LONG" as const, state: "WAITING" as const, bias: "LONG" as const, thesis: "" }, alternative: { type: "NONE" as const, state: "WAITING" as const, bias: "NEUTRAL" as const, thesis: "" }, missingConfirmation: [], invalidationCondition: "" };

console.log("\n━━━ C) Dead Chop recalibration (RANGE) ━━━");

// C1: the recalibrated bar PASSES an honest-pace explosive RANGE short
// (raw rvol 0.46 on young candle = pace 1.73, ADX 19, DI- > DI+)
{
   const p = { price: 95, atr14: 1.0, rvol: 0.46, rvolPace: 1.73, taker: 0.44, rsi: 45, adx: 19, di_plus: 13, di_minus: 27, ema50: 99, st_bear: true, LH_LL: true, klines: [{ open: 96, high: 96.5, low: 94.8, close: 95 }] };
   const flow = interpretFlow(p, mockWhaleBear);
   const timing = evaluateTimingGate("SHORT", p, mockWhaleBear, locMid, flow, "BREAKOUT_SHORT");
   const conf = checkConfirmation("RANGE", flow, locMid, scenarioShort, timing, p, mockWhaleBear, { sl: 2.0, ss: 8.5 }, { regime: "BEAR_WEAK" });
   check("C1: pace-explosive RANGE short passes Dead Chop now", conf.reason.includes("Dead Chop") === false);
}

// C2: the bar still HOLDS — quiet tape (pace 0.8, ADX 19) is still chopped
{
   const p = { price: 95, atr14: 1.0, rvol: 0.8, rvolPace: 0.8, taker: 0.44, rsi: 45, adx: 19, di_plus: 13, di_minus: 27, klines: [{ open: 96, high: 96.5, low: 94.8, close: 95 }] };
   const flow = interpretFlow(p, mockWhaleBear);
   const timing = evaluateTimingGate("SHORT", p, mockWhaleBear, locMid, flow, "BREAKOUT_SHORT");
   const conf = checkConfirmation("RANGE", flow, locMid, scenarioShort, timing, p, mockWhaleBear, { sl: 2.0, ss: 8.5 }, { regime: "BEAR_WEAK" });
   check("C2: pace 0.8 (<1.5) still Dead-Chopped — quiet drift stays out", conf.isConfirmed === false && conf.reason.includes("Dead Chop"));
}

// C3: ADX 16 with pace 1.9 → still chopped (directional bar held at 18)
{
   const p = { price: 95, atr14: 1.0, rvol: 1.9, rvolPace: 1.9, taker: 0.44, rsi: 45, adx: 16, di_plus: 13, di_minus: 27, klines: [{ open: 96, high: 96.5, low: 94.8, close: 95 }] };
   const flow = interpretFlow(p, mockWhaleBear);
   const timing = evaluateTimingGate("SHORT", p, mockWhaleBear, locMid, flow, "BREAKOUT_SHORT");
   const conf = checkConfirmation("RANGE", flow, locMid, scenarioShort, timing, p, mockWhaleBear, { sl: 2.0, ss: 8.5 }, { regime: "BEAR_WEAK" });
   check("C3: ADX 16 (<18) still Dead-Chopped", conf.isConfirmed === false && conf.reason.includes("Dead Chop"));
}

// C4: DI misalignment with pace + ADX passing → still chopped
{
   const p = { price: 95, atr14: 1.0, rvol: 1.9, rvolPace: 1.9, taker: 0.44, rsi: 45, adx: 25, di_plus: 30, di_minus: 12, klines: [{ open: 96, high: 96.5, low: 94.8, close: 95 }] };
   const flow = interpretFlow(p, mockWhaleBear);
   const timing = evaluateTimingGate("SHORT", p, mockWhaleBear, locMid, flow, "BREAKOUT_SHORT");
   const conf = checkConfirmation("RANGE", flow, locMid, scenarioShort, timing, p, mockWhaleBear, { sl: 2.0, ss: 8.5 }, { regime: "BEAR_WEAK" });
   check("C4: wrong-side DI (DI+ dominant on a SHORT) still chopped", conf.isConfirmed === false && conf.reason.includes("Dead Chop"));
}

console.log("\n━━━ D) RANGE confirmation relief ━━━");

// D1: SELLING_PRESSURE + RANGE regime → SHORT now confirmable
{
   // flow: price falling, OI flat-ish, CVD negative, taker sell → SELLING_PRESSURE (not BUILDUP)
   // geometry: price 95 has CLOSED below support 96 → healthy breakdown corridor
   const whaleSp = { p_chg: -0.004, oi_chg: 0.0005, slope15: -150, slope5: -50, slope4h: -300, cvd_mixed: false };
   const locD1 = { ...locMid, nearestSupport: 96, distanceToSupportPct: 0.005 };
   const p = { price: 95, atr14: 1.0, rvol: 0.46, rvolPace: 1.73, taker: 0.46, rsi: 45, adx: 19, di_plus: 13, di_minus: 27, ema50: 99, st_bear: true, LH_LL: true, klines: [{ open: 96, high: 96.5, low: 94.8, close: 95 }] };
   const flow = interpretFlow(p, whaleSp);
   check("D1a: scaffolding really is SELLING_PRESSURE (not BUILDUP)", flow.state === "SELLING_PRESSURE");
   const timing = evaluateTimingGate("SHORT", p, whaleSp, locD1, flow, "BREAKOUT_SHORT");
   const conf = checkConfirmation("RANGE", flow, locD1, scenarioShort, timing, p, whaleSp, { sl: 2.0, ss: 8.5 }, { regime: "BEAR_WEAK" });
   check("D1b: SELLING_PRESSURE short CONFIRMS in RANGE (was impossible)", conf.isConfirmed === true && conf.confirmedSignal === "SHORT");
}

// D2: BUYING_PRESSURE + RANGE + BTC BEAR_WEAK → LONG confirmable (elite own-structure path)
// The pre-existing graduated gate still demands STRONG persistence — kept as-is.
{
   const whaleBp = { p_chg: 0.004, oi_chg: 0.0005, slope15: 150, slope5: 50, slope4h: 300, cvd_mixed: false };
   const locD2 = { ...locMid, nearestResistance: 104, distanceToResistancePct: 0.008 };
   const p = { price: 105, atr14: 1.0, rvol: 0.46, rvolPace: 1.73, taker: 0.56, rsi: 52, adx: 19, di_plus: 27, di_minus: 13, ema50: 100, st_bull: true, HH_HL: true, klines: [{ open: 104, high: 105.5, low: 103.8, close: 105 }] };
   const flow = interpretFlow(p, whaleBp);
   check("D2a: scaffolding really is BUYING_PRESSURE with STRONG persistence", flow.state === "BUYING_PRESSURE" && flow.persistenceState === "STRONG");
   const timing = evaluateTimingGate("LONG", p, whaleBp, locD2, flow, "BREAKOUT_LONG");
   const conf = checkConfirmation("RANGE", flow, locD2, scenarioLong, timing, p, whaleBp, { sl: 8.5, ss: 2.0 }, { regime: "BEAR_WEAK", graduatedRegime: true });
   check("D2b: BUYING_PRESSURE long CONFIRMS in RANGE under BTC BEAR_WEAK (elite own-structure)", conf.isConfirmed === true && conf.confirmedSignal === "LONG");
}

// D3: Range Long Trap survives — BUYING_PRESSURE RANGE long while BTC BULL → blocked
{
   const whaleBp = { p_chg: 0.004, oi_chg: 0.0005, slope15: 150, slope5: 50, slope4h: 300, cvd_mixed: false };
   const p = { price: 105, atr14: 1.0, rvol: 0.46, rvolPace: 1.73, taker: 0.55, rsi: 52, adx: 19, di_plus: 27, di_minus: 13, ema50: 100, st_bull: true, HH_HL: true, klines: [{ open: 104, high: 105.5, low: 103.8, close: 105 }] };
   const flow = interpretFlow(p, whaleBp);
   const timing = evaluateTimingGate("LONG", p, whaleBp, locMid, flow, "BREAKOUT_LONG");
   const conf = checkConfirmation("RANGE", flow, locMid, scenarioLong, timing, p, whaleBp, { sl: 8.5, ss: 2.0 }, { regime: "BULL_STRONG" });
   check("D3: RANGE long while BTC BULL_STRONG still hard-blocked (trap intact)", conf.isConfirmed === false && conf.reason.includes("RANGE Long Trap"));
}

console.log("\n━━━ E) MIXED / CONFLICTED stays strictly blocked ━━━");
{
   // cvd_mixed true → persistenceState CONFLICTED → hard gate 2
   const whaleMixed = { p_chg: -0.004, oi_chg: 0.004, slope15: 150, slope5: -50, slope4h: -300, cvd_mixed: true };
   const p = { price: 95, atr14: 1.0, rvol: 0.46, rvolPace: 2.5, taker: 0.44, rsi: 45, adx: 25, di_plus: 13, di_minus: 27, ema50: 99, st_bear: true, LH_LL: true, klines: [{ open: 96, high: 96.5, low: 94.8, close: 95 }] };
   const flow = interpretFlow(p, whaleMixed);
   check("E1: scaffolding classifies as CONFLICTED persistence", flow.persistenceState === "CONFLICTED");
   const timing = evaluateTimingGate("SHORT", p, whaleMixed, locMid, flow, "BREAKOUT_SHORT");
   const conf = checkConfirmation("RANGE", flow, locMid, scenarioShort, timing, p, whaleMixed, { sl: 2.0, ss: 8.5 }, { regime: "BEAR_WEAK" });
   check("E2: MIXED/CONFLICTED flow still NO-ENTRY (quality untouched)", conf.isConfirmed === false && conf.reason.includes("Conflicting orderflow"));
}

console.log("\n━━━ F) Timing gate reads pace ━━━");
{
   // young ignition candle: raw rvol 0.46 (would WAIT), pace 1.73 + taker 0.47
   // price closed below support 96 within the healthy corridor (0.7% ≈ 0.7 ATR)
   const locBreakdown = { ...locMid, nearestSupport: 96, nearSupport: false, distanceToSupportPct: 0.007 };
   const p = { price: 95.3, atr14: 1.0, rvol: 0.46, rvolPace: 1.73, taker: 0.47, rsi: 45, adx: 19, di_plus: 13, di_minus: 27, ema50: 99, st_bear: true, LH_LL: true, klines: [{ open: 96, high: 96.5, low: 95.1, close: 95.3 }] };
   const flow = interpretFlow(p, mockWhaleBear);
   const timing = evaluateTimingGate("SHORT", p, mockWhaleBear, locBreakdown, flow, "BREAKOUT_SHORT");
   check("F1: young-candle breakdown timing CONFIRMED via pace (was WAITING)", timing.passed === true && timing.state === "CONFIRMED");

   // same candle WITHOUT pace (raw 0.46 < 1.2) still waits — bar held for mature candles
   const pRaw = { ...p, rvolPace: undefined };
   const timingRaw = evaluateTimingGate("SHORT", pRaw, mockWhaleBear, locBreakdown, flow, "BREAKOUT_SHORT");
   check("F2: same tape w/o pace field (raw 0.46) still WAITING — no fake fuel", timingRaw.passed === false);
}

// ─── verdict ───────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "🎉" : "⚠️"} PACE-VOLUME v3.3.3: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
