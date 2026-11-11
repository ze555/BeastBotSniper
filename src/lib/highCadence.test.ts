// ============================================================================
// v3.4 ALWAYS-HUNTING — HIGH-CADENCE TIER — Deterministic Verification
//
// Live forensics (Nov 11, post-v3.3.3, 98 rejections in 24min):
//   - FlowMixed 51% (persistence ALL ≈30, score p50 9.2 — max 13.2)
//   - DeadChop 26% (pace p50 0.46 — quiet drift; ADX p50 24 passes)
//   - maxOpenTrades default was 3 (≈50 trades/day ceiling even if perfect)
//   - TOXIC_HOURS hard-blocked 10 of 24 hours = 42% of the day DEAD
//
// This suite verifies the measured conversion + capacity unlocks:
//   A) Conflicted-flow ELITE override (score ≥10 + persistence ≥30 → 0.5x)
//   B) Conflicted NON-elite (score <10) stays blocked; UNKNOWN always blocked
//   C) TRANSITION pressure-confirm (SELLING/BUYING_PRESSURE → 0.75x)
//   D) Dead Chop pace bar 1.5 → 1.3 (1.35 passes, 1.1 blocked)
//   E) Short-covering gate + Range Long Trap remain untouched
// ============================================================================

import {
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

const scenarioShort = { primary: { type: "BREAKOUT_SHORT" as const, state: "WAITING" as const, bias: "SHORT" as const, thesis: "" }, alternative: { type: "NONE" as const, state: "WAITING" as const, bias: "NEUTRAL" as const, thesis: "" }, missingConfirmation: [], invalidationCondition: "" };
const scenarioLong = { primary: { type: "BREAKOUT_LONG" as const, state: "WAITING" as const, bias: "LONG" as const, thesis: "" }, alternative: { type: "NONE" as const, state: "WAITING" as const, bias: "NEUTRAL" as const, thesis: "" }, missingConfirmation: [], invalidationCondition: "" };
const locMid = { nearestResistance: 110, nearestSupport: 96, rangeHigh: 110, rangeLow: 90, nearResistance: false, nearSupport: false, distanceToResistancePct: 0.10, distanceToSupportPct: 0.008, upperLiquidityTarget: 111, lowerLiquidityTarget: 89, liquidityData: "unavailable" as const };

console.log("\n━━━ A) Conflicted-flow ELITE override (v3.4) ━━━");

// Live-rejection reproduction: cvd_mixed + price/CVD conflict, persistence ~30-50,
// ELITE multi-layer score. Flow=SELLING_PRESSURE-in-conflict → MIXED classification.
{
   const whaleMixed = { p_chg: -0.004, oi_chg: 0.0005, slope15: 150, slope5: 50, slope4h: -300, cvd_mixed: true };
   const p = { price: 95, atr14: 1.0, rvol: 0.46, rvolPace: 1.4, taker: 0.46, rsi: 45, adx: 19, di_plus: 13, di_minus: 27, ema50: 99, st_bear: true, LH_LL: true, klines: [{ open: 96, high: 96.5, low: 94.8, close: 95 }] };
   const flow = interpretFlow(p, whaleMixed);
   check("A1: scaffolding is conflicted (gate would historically kill)", flow.persistenceState === "CONFLICTED" || flow.state === "MIXED");
   const timing = evaluateTimingGate("SHORT", p, whaleMixed, locMid, flow, "BREAKOUT_SHORT");
   const conf = checkConfirmation("RANGE", flow, locMid, scenarioShort, timing, p, whaleMixed, { sl: 2.0, ss: 10.4 }, { regime: "BEAR_WEAK" });
   check("A2: ELITE conflicted (score 10.4) CONFIRMS at 0.5x risk", conf.isConfirmed === true && conf.suggestedRiskMult === 0.5);
}

console.log("\n━━━ B) Non-elite conflicted + UNKNOWN stay blocked ━━━");

// B1: same tape but score 9.2 (the live median) — still NO ENTRY
{
   const whaleMixed = { p_chg: -0.004, oi_chg: 0.0005, slope15: 150, slope5: 50, slope4h: -300, cvd_mixed: true };
   const p = { price: 95, atr14: 1.0, rvol: 0.46, rvolPace: 1.4, taker: 0.46, rsi: 45, adx: 19, di_plus: 13, di_minus: 27, klines: [{ open: 96, high: 96.5, low: 94.8, close: 95 }] };
   const flow = interpretFlow(p, whaleMixed);
   const timing = evaluateTimingGate("SHORT", p, whaleMixed, locMid, flow, "BREAKOUT_SHORT");
   const conf = checkConfirmation("RANGE", flow, locMid, scenarioShort, timing, p, whaleMixed, { sl: 2.0, ss: 9.2 }, { regime: "BEAR_WEAK" });
   check("B1: score 9.2 (<10) conflicted still blocked", conf.isConfirmed === false && conf.reason.includes("Conflicting orderflow"));
}

// B2: UNKNOWN flow never trades even with elite score
{
   const whaleUnknown = { p_chg: 0, oi_chg: 0, slope15: 0, slope5: 0, slope4h: 0, cvd_mixed: false };
   const p = { price: 100, atr14: 1.0, rvol: 0.1, taker: 0.5, rsi: 50, adx: 10, klines: [{ open: 100, high: 100.1, low: 99.9, close: 100 }] };
   const flow = interpretFlow(p, whaleUnknown);
   check("B2a: scaffolding really is UNKNOWN", flow.state === "UNKNOWN");
   const timing = evaluateTimingGate("SHORT", p, whaleUnknown, locMid, flow, "BREAKOUT_SHORT");
   const conf = checkConfirmation("RANGE", flow, locMid, scenarioShort, timing, p, whaleUnknown, { sl: 2.0, ss: 12.0 }, { regime: "BEAR_WEAK" });
   check("B2b: UNKNOWN + elite score still NO ENTRY", conf.isConfirmed === false);
}

console.log("\n━━━ C) TRANSITION pressure-confirm (v3.4) ━━━");

// C1: SELLING_PRESSURE + TRANSITION → SHORT confirms at 0.75x
{
   const whaleSp = { p_chg: -0.004, oi_chg: 0.0005, slope15: -150, slope5: -50, slope4h: -300, cvd_mixed: false };
   const p = { price: 95, atr14: 1.0, rvol: 0.46, rvolPace: 1.4, taker: 0.46, rsi: 45, adx: 19, di_plus: 13, di_minus: 27, ema50: 99, st_bear: true, LH_LL: true, klines: [{ open: 96, high: 96.5, low: 94.8, close: 95 }] };
   const flow = interpretFlow(p, whaleSp);
   check("C1a: scaffolding really is SELLING_PRESSURE", flow.state === "SELLING_PRESSURE");
   const timing = evaluateTimingGate("SHORT", p, whaleSp, locMid, flow, "BREAKOUT_SHORT");
   const conf = checkConfirmation("TRANSITION", flow, locMid, scenarioShort, timing, p, whaleSp, { sl: 2.0, ss: 8.8 }, { regime: "BEAR_WEAK" });
   check("C1b: TRANSITION SELLING_PRESSURE short CONFIRMS at 0.75x (was impossible)", conf.isConfirmed === true && conf.suggestedRiskMult === 0.75);
}

// C2: BUYING_PRESSURE + TRANSITION → LONG confirms at 0.75x (BTC BEAR_WEAK elite path)
{
   const whaleBp = { p_chg: 0.004, oi_chg: 0.0005, slope15: 150, slope5: 50, slope4h: 300, cvd_mixed: false };
   const locD2 = { ...locMid, nearestResistance: 104, distanceToResistancePct: 0.008 };
   const p = { price: 105, atr14: 1.0, rvol: 0.46, rvolPace: 1.4, taker: 0.56, rsi: 52, adx: 19, di_plus: 27, di_minus: 13, ema50: 100, st_bull: true, HH_HL: true, klines: [{ open: 104, high: 105.5, low: 103.8, close: 105 }] };
   const flow = interpretFlow(p, whaleBp);
   check("C2a: scaffolding really is BUYING_PRESSURE (STRONG)", flow.state === "BUYING_PRESSURE" && flow.persistenceState === "STRONG");
   const timing = evaluateTimingGate("LONG", p, whaleBp, locD2, flow, "BREAKOUT_LONG");
   const conf = checkConfirmation("TRANSITION", flow, locD2, scenarioLong, timing, p, whaleBp, { sl: 8.8, ss: 2.0 }, { regime: "BEAR_WEAK", graduatedRegime: true });
   // graduated BEAR_WEAK long gate caps at 0.5x — the tighter cap wins by design
   check("C2b: TRANSITION BUYING_PRESSURE long CONFIRMS (risk capped by tighter graduated 0.5x)", conf.isConfirmed === true && (conf.suggestedRiskMult ?? 1.0) <= 0.75);
}

console.log("\n━━━ D) Dead Chop pace bar 1.5 → 1.3 ━━━");

// D1: pace 1.35 (above new bar) with ADX 19 + DI aligned → passes
{
   const whaleSp = { p_chg: -0.004, oi_chg: 0.004, slope15: -150, slope5: -50, slope4h: -300, cvd_mixed: false };
   const p = { price: 95, atr14: 1.0, rvol: 1.35, taker: 0.44, rsi: 45, adx: 19, di_plus: 13, di_minus: 27, ema50: 99, st_bear: true, LH_LL: true, klines: [{ open: 96, high: 96.5, low: 94.8, close: 95 }] };
   const flow = interpretFlow(p, whaleSp);
   const timing = evaluateTimingGate("SHORT", p, whaleSp, locMid, flow, "BREAKOUT_SHORT");
   const conf = checkConfirmation("RANGE", flow, locMid, scenarioShort, timing, p, whaleSp, { sl: 2.0, ss: 8.8 }, { regime: "BEAR_WEAK" });
   check("D1: pace 1.35 no longer Dead-Chopped (bar 1.3)", !conf.reason.includes("Dead Chop"));
}

// D2: pace 1.1 (below bar) still chopped — quiet drift stays out
{
   const whaleSp = { p_chg: -0.004, oi_chg: 0.004, slope15: -150, slope5: -50, slope4h: -300, cvd_mixed: false };
   const p = { price: 95, atr14: 1.0, rvol: 1.1, taker: 0.44, rsi: 45, adx: 19, di_plus: 13, di_minus: 27, klines: [{ open: 96, high: 96.5, low: 94.8, close: 95 }] };
   const flow = interpretFlow(p, whaleSp);
   const timing = evaluateTimingGate("SHORT", p, whaleSp, locMid, flow, "BREAKOUT_SHORT");
   const conf = checkConfirmation("RANGE", flow, locMid, scenarioShort, timing, p, whaleSp, { sl: 2.0, ss: 8.8 }, { regime: "BEAR_WEAK" });
   check("D2: pace 1.1 (<1.3) still Dead-Chopped", conf.isConfirmed === false && conf.reason.includes("Dead Chop"));
}

console.log("\n━━━ E) Safety rails untouched ━━━");

// E1: SHORT_COVERING still hard-blocked (not fresh accumulation)
{
   const whaleCover = { p_chg: 0.004, oi_chg: -0.010, slope15: 150, slope5: 50, slope4h: 300, cvd_mixed: false };
   const p = { price: 105, atr14: 1.0, rvol: 2.0, taker: 0.56, rsi: 52, adx: 25, di_plus: 27, di_minus: 13, ema50: 100, st_bull: true, HH_HL: true, klines: [{ open: 104, high: 105.5, low: 103.8, close: 105 }] };
   const flow = interpretFlow(p, whaleCover);
   check("E1a: scaffolding really is SHORT_COVERING", flow.state === "SHORT_COVERING");
   const timing = evaluateTimingGate("LONG", p, whaleCover, locMid, flow, "BREAKOUT_LONG");
   const conf = checkConfirmation("TREND_UP", flow, locMid, scenarioLong, timing, p, whaleCover, { sl: 10.5, ss: 2.0 }, { regime: "BULL_STRONG" });
   check("E1b: SHORT_COVERING still NO-ENTRY", conf.isConfirmed === false && conf.reason.includes("short covering"));
}

// E2: Range Long Trap — conflicted-elite override must NOT bypass the BTC-bull trap
{
   const whaleMixedLong = { p_chg: 0.004, oi_chg: 0.0005, slope15: 150, slope5: 50, slope4h: 300, cvd_mixed: true };
   const p = { price: 105, atr14: 1.0, rvol: 1.4, taker: 0.56, rsi: 52, adx: 19, di_plus: 27, di_minus: 13, ema50: 100, st_bull: true, HH_HL: true, klines: [{ open: 104, high: 105.5, low: 103.8, close: 105 }] };
   const flow = interpretFlow(p, whaleMixedLong);
   const timing = evaluateTimingGate("LONG", p, whaleMixedLong, locMid, flow, "BREAKOUT_LONG");
   const conf = checkConfirmation("RANGE", flow, locMid, scenarioLong, timing, p, whaleMixedLong, { sl: 10.5, ss: 2.0 }, { regime: "BULL_STRONG" });
   check("E2: elite conflicted + RANGE + BTC BULL still trapped (no long)", conf.isConfirmed === false && conf.reason.includes("RANGE Long Trap"));
}

// ─── verdict ───────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "🎉" : "⚠️"} ALWAYS-HUNTING v3.4: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
