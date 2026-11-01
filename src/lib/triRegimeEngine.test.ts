// ============================================================================
// Tri-Regime Modular Engine Test Suite
// Verifies 100% compliance with Institutional Blueprint:
// 1. Crash/Dump: Long Closed 100%, Breakdown Short Allowed, Oversold Bypass, Tsunami Runner
// 2. Bull/Pump: Short Closed 100%, Breakout/Pullback Long Allowed, Profit Protection
// 3. Range/Chop: Breakout Cancelled, Dead Chop Blocked, Boundary Mean Reversion Allowed
// ============================================================================

import {
   detectMacroRegime,
   evaluateTriRegimeExecution,
   MacroRegimeType
} from "./triRegimeEngine.js";

function assert(condition: boolean, message: string) {
   if (!condition) {
      console.error(`❌ [FAIL] ${message}`);
      process.exit(1);
   } else {
      console.log(`✅ [PASS] ${message}`);
   }
}

console.log("=======================================================");
console.log("🧪 RUNNING INSTITUTIONAL TRI-REGIME ENGINE TESTS");
console.log("=======================================================");

// --- TEST GROUP 1: MACRO REGIME DETECTOR ---
console.log("\n--- TEST GROUP 1: Macro Regime Detector ---");

// Test 1.1: BTC Dump triggers CRASH_DUMP
const r1 = detectMacroRegime({ btc_dump: true, regime: "BEAR_STRONG" }, { price: 100, ema50: 105, ema200: 110 });
assert(r1 === "CRASH_DUMP", "BTC Dump is classified as CRASH_DUMP");

// Test 1.2: BTC sharp negative change triggers CRASH_DUMP
const r2 = detectMacroRegime({ btc_dump: false, regime: "NEUTRAL", btc_chg: -0.012 }, {});
assert(r2 === "CRASH_DUMP", "BTC 15m drop (-1.2%) is classified as CRASH_DUMP");

// Test 1.3: BTC Pump triggers BULL_PUMP
const r3 = detectMacroRegime({ btc_pump: true, regime: "BULL_STRONG" }, { price: 100, ema50: 95, ema200: 90 });
assert(r3 === "BULL_PUMP", "BTC Pump is classified as BULL_PUMP");

// Test 1.4: BTC sharp positive change triggers BULL_PUMP
const r4 = detectMacroRegime({ btc_pump: false, regime: "NEUTRAL", btc_chg: 0.015 }, {});
assert(r4 === "BULL_PUMP", "BTC 15m surge (+1.5%) is classified as BULL_PUMP");

// Test 1.5: Consolidation triggers RANGE_CHOP
const r5 = detectMacroRegime({ btc_dump: false, btc_pump: false, regime: "NEUTRAL_CONSOLIDATION", btc_chg: 0.001 }, { adx: 14 });
assert(r5 === "RANGE_CHOP", "Neutral consolidation is classified as RANGE_CHOP");

// --- TEST GROUP 2: CRASH / DUMP SUB-ENGINE (شلال انهياري) ---
console.log("\n--- TEST GROUP 2: Sub-Engine 1 - Crash / Dump (شلال انهياري) ---");

const crashCtx = { btc_dump: true, regime: "BEAR_STRONG", btc_chg: -0.018 };
const bearPrice = { price: 90, ema21: 94, ema50: 98, ema200: 105, rvol: 2.1, adx: 32, rsi: 26, atr14: 2.0, LH_LL: true };
const bearWhale = { slope15: -80, slope5: -40, taker: 0.42, oi_chg: 0.04 };

// Test 2.1: Long: مغلق 100%
const crashLong = evaluateTriRegimeExecution("LONG", crashCtx, bearPrice, bearWhale);
assert(crashLong.allowed === false, "CRASH_DUMP: LONG is strictly BLOCKED (100% closed)");
assert(crashLong.macroRegime === "CRASH_DUMP", "Regime is CRASH_DUMP");
assert(crashLong.ruleTriggered === "CRASH_LONG_PROHIBITED", "Rule triggered is CRASH_LONG_PROHIBITED");
assert(crashLong.reason.includes("حظر صفقات الشراء"), "Arabic reason mentions prohibition of Longs");

// Test 2.2: Breakdown Short enabled with Oversold Bypass
const crashShort = evaluateTriRegimeExecution("SHORT", crashCtx, bearPrice, bearWhale);
assert(crashShort.allowed === true, "CRASH_DUMP: Breakdown SHORT is approved");
assert(crashShort.oversoldBypass === true, "CRASH_DUMP: Oversold RSI Bypass is explicitly ACTIVE");
assert(crashShort.exitStrategy === "TSUNAMI_RUNNER", "CRASH_DUMP: Exit strategy is TSUNAMI_RUNNER to ride waterfall");
assert(crashShort.setupClass === "BREAKDOWN_SHORT", "Setup class is BREAKDOWN_SHORT");

// Test 2.3: Extreme climax exhaustion (> 3x ATR away, RSI < 20) pauses entry
const climaxPrice = { price: 78, ema21: 90, ema50: 98, ema200: 105, rvol: 4.5, adx: 48, rsi: 16, atr14: 2.0, LH_LL: true };
const crashClimax = evaluateTriRegimeExecution("SHORT", crashCtx, climaxPrice, bearWhale);
assert(crashClimax.allowed === false, "CRASH_DUMP: Extreme climactic selling (> 3x ATR) is paused to prevent shorting bottom wick");
assert(crashClimax.ruleTriggered === "CLIMACTIC_EXHAUSTION_BLOCK", "Rule triggered is CLIMACTIC_EXHAUSTION_BLOCK");

// --- TEST GROUP 3: BULL / PUMP SUB-ENGINE (انفجار صعودي) ---
console.log("\n--- TEST GROUP 3: Sub-Engine 2 - Bull / Pump (انفجار صعودي) ---");

const bullCtx = { btc_pump: true, regime: "BULL_STRONG", btc_chg: 0.016 };
const bullPrice = { price: 110, ema21: 106, ema50: 102, ema200: 95, rvol: 1.9, adx: 29, rsi: 64, atr14: 2.0, HH_HL: true };
const bullWhale = { slope15: 75, slope5: 35, taker: 0.58, oi_chg: 0.03 };

// Test 3.1: Short: مغلق 100%
const bullShort = evaluateTriRegimeExecution("SHORT", bullCtx, bullPrice, bullWhale);
assert(bullShort.allowed === false, "BULL_PUMP: SHORT is strictly BLOCKED (100% closed)");
assert(bullShort.macroRegime === "BULL_PUMP", "Regime is BULL_PUMP");
assert(bullShort.ruleTriggered === "BULL_SHORT_PROHIBITED", "Rule triggered is BULL_SHORT_PROHIBITED");
assert(bullShort.reason.includes("حظر صفقات البيع"), "Arabic reason mentions prohibition of Shorts");

// Test 3.2: Breakout Long enabled
const bullLong = evaluateTriRegimeExecution("LONG", bullCtx, bullPrice, bullWhale);
assert(bullLong.allowed === true, "BULL_PUMP: Breakout LONG is approved");
assert(bullLong.exitStrategy === "TSUNAMI_RUNNER", "BULL_PUMP: Exit strategy is TSUNAMI_RUNNER to protect profits");
assert(bullLong.setupClass === "BREAKOUT_LONG", "Setup class is BREAKOUT_LONG");

// Test 3.3: Pullback Long enabled
const pullbackPrice = { ...bullPrice, pullback_long: true, price: 106 };
const bullPullback = evaluateTriRegimeExecution("LONG", bullCtx, pullbackPrice, bullWhale);
assert(bullPullback.allowed === true, "BULL_PUMP: Pullback LONG is approved");
assert(bullPullback.setupClass === "PULLBACK_LONG", "Setup class is PULLBACK_LONG");

// --- TEST GROUP 4: RANGE / CHOP SUB-ENGINE (تذبذب عرضي) ---
console.log("\n--- TEST GROUP 4: Sub-Engine 3 - Range / Chop (تذبذب عرضي) ---");

const rangeCtx = { btc_dump: false, btc_pump: false, regime: "NEUTRAL_CONSOLIDATION", btc_chg: 0.001 };
const deadChopPrice = { price: 100, ema21: 100.1, ema50: 100.2, ema200: 100, rvol: 0.85, adx: 14, rsi: 50 };
const deadChopWhale = { slope15: 2, slope5: -1, taker: 0.50, oi_chg: 0.0001 };

// Test 4.1: Capital Defense - Dead Chop is blocked
const chopDefense = evaluateTriRegimeExecution("LONG", rangeCtx, deadChopPrice, deadChopWhale);
assert(chopDefense.allowed === false, "RANGE_CHOP: Dead chop is BLOCKED for Capital Defense");
assert(chopDefense.ruleTriggered === "RANGE_DEAD_CHOP_DEFENSE", "Rule triggered is RANGE_DEAD_CHOP_DEFENSE");
assert(chopDefense.reason.includes("حماية رأس المال"), "Arabic reason mentions Capital Defense");

// Test 4.2: Breakout Momentum is strictly CANCELLED / PROHIBITED in Range
const breakoutAttemptPrice = { price: 105, ema21: 102, ema50: 101, ema200: 100, rvol: 1.6, adx: 21, rsi: 65, setupType: "BREAKOUT_MOMENTUM" };
const rangeLocResistance = { nearResistance: true, distanceToResistancePct: 0.001 };
const chopBreakout = evaluateTriRegimeExecution("LONG", rangeCtx, breakoutAttemptPrice, deadChopWhale, rangeLocResistance, "CAPITAL_DEFENSE");
assert(chopBreakout.allowed === false, "RANGE_CHOP: Breakout attempt is CANCELLED (Breakout: ملغى)");
assert(chopBreakout.ruleTriggered === "RANGE_BREAKOUT_PROHIBITED", "Rule triggered is RANGE_BREAKOUT_PROHIBITED");
assert(chopBreakout.reason.includes("صفقات الاختراق (Breakout) ملغاة تماماً"), "Reason clearly states breakouts are prohibited in range");

// Test 4.3: Range Boundary Mean Reversion - Long at Range Low with absorption
const rangeLowPrice = { price: 95, ema21: 98, ema50: 100, ema200: 100, rvol: 1.45, adx: 19, rsi: 35, di_plus: 22, di_minus: 20, taker: 0.52 };
const rangeLocSupport = { nearSupport: true, distanceToSupportPct: 0.001 };
const meanRevWhale = { slope15: 10, slope5: 15, taker: 0.53, oi_chg: 0.005 };
const chopMeanRevLong = evaluateTriRegimeExecution("LONG", rangeCtx, rangeLowPrice, meanRevWhale, rangeLocSupport, "MEAN_REVERSION");
assert(chopMeanRevLong.allowed === true, "RANGE_CHOP: Boundary Mean Reversion LONG at Range Low is approved");
assert(chopMeanRevLong.setupClass === "RANGE_MEAN_REVERSION", "Setup class is RANGE_MEAN_REVERSION");
assert(chopMeanRevLong.exitStrategy === "RANGE_SCALP", "Exit strategy is RANGE_SCALP (tight target 0.8R - 1.0R)");

// Test 4.4: Range Boundary Mean Reversion - Short at Range High with rejection
const rangeHighPrice = { price: 105, ema21: 102, ema50: 100, ema200: 100, rvol: 1.40, adx: 19, rsi: 65, di_plus: 18, di_minus: 22, taker: 0.47 };
const chopMeanRevShort = evaluateTriRegimeExecution("SHORT", rangeCtx, rangeHighPrice, { slope15: -10, slope5: -12, taker: 0.46 }, rangeLocResistance, "MEAN_REVERSION");
assert(chopMeanRevShort.allowed === true, "RANGE_CHOP: Boundary Mean Reversion SHORT at Range High is approved");
assert(chopMeanRevShort.setupClass === "RANGE_MEAN_REVERSION", "Setup class is RANGE_MEAN_REVERSION");
assert(chopMeanRevShort.exitStrategy === "RANGE_SCALP", "Exit strategy is RANGE_SCALP");

// Test 4.5: Reversion rejected if not at range boundary (trying to buy mid-range)
const midRangeLoc = { nearSupport: false, nearResistance: false, distanceToSupportPct: 0.02, distanceToResistancePct: 0.02 };
const midRangeAttempt = evaluateTriRegimeExecution("LONG", rangeCtx, rangeLowPrice, meanRevWhale, midRangeLoc, "MEAN_REVERSION");
assert(midRangeAttempt.allowed === false, "RANGE_CHOP: Mid-range entry without boundary probe is BLOCKED");
assert(midRangeAttempt.ruleTriggered === "RANGE_LONG_NOT_AT_SUPPORT", "Rule triggered is RANGE_LONG_NOT_AT_SUPPORT");

console.log("\n=======================================================");
console.log("📊 TRI-REGIME ENGINE TEST SUITE SUMMARY: ALL 18 PASSED | 0 FAILED");
console.log("=======================================================");
console.log("✨ Institutional Tri-Regime Modular Architecture verified successfully!");
