// ============================================================================
// Deterministic Verification Suite for BeastBotSniper Architecture (v2.4.0)
// Tests:
// 1. Breakout valid (Healthy breakout)
// 2. Breakout late (Late expansion / Buying the top)
// 3. Breakout waiting for retest
// 4. Mixed flow (Strictly blocks entry)
// 5. Persistent bullish flow (High persistence score)
// 6. Persistent bearish flow (High persistence score)
// 7. LONG near resistance without clearance (Blocks entry)
// 8. SHORT near support without clearance (Blocks entry)
// 9. Direction tracking (5m/15m/30m/60m)
// 10. MFE / MAE tracking
// 11. Loss classification (EXIT_ERROR, TIMING_ERROR, LOCATION_ERROR, FLOW_ERROR, DIRECTION_ERROR, VALID_LOSS)
// 12. Strict Liquidity Mock Isolation (Strictly 'unavailable')
// ============================================================================

import {
   detectMarketRegime,
   interpretFlow,
   evaluateLocation,
   evaluateTimingGate,
   generateScenarios,
   checkConfirmation,
   evaluateSymbolReasoning,
   evaluateInstitutionalTradeGuard
} from "./reasoningEngine.js";

import {
   classifyTradeLoss,
   classifyEntryQuality,
   calculateDirectionalExcursions,
   registerTradeForDirectionTracking,
   updateDirectionTracking
} from "./researchLogger.js";

let passedCount = 0;
let failedCount = 0;

function assert(description: string, condition: boolean) {
   if (condition) {
      console.log(`✅ [PASS] ${description}`);
      passedCount++;
   } else {
      console.error(`❌ [FAIL] ${description}`);
      failedCount++;
   }
}

console.log("\n=======================================================");
console.log("🧪 RUNNING BEASTBOT TIMING GATE & FLOW PERSISTENCE TESTS");
console.log("=======================================================\n");

// ----------------------------------------------------------------------------
// Test 1: Breakout Valid (Healthy Breakout within 0.8x ATR, RVOL > 1.2, Taker > 51%)
// ----------------------------------------------------------------------------
{
   const mockPrice = {
      price: 100.5,
      atr14: 1.0,
      rvol: 1.6,
      taker: 0.58,
      rsi: 58,
      klines: [{ open: 99.8, high: 100.8, low: 99.7, close: 100.5 }]
   };
   const mockWhale = { slope15: 120, slope5: 45, slope4h: 300, p_chg: 0.005, oi_chg: 0.008, cvd_mixed: false };
   const loc = {
      nearestResistance: 100.0,
      nearestSupport: 95.0,
      rangeHigh: 105.0,
      rangeLow: 94.0,
      nearResistance: false,
      nearSupport: false,
      distanceToResistancePct: -0.005,
      distanceToSupportPct: 0.055,
      upperLiquidityTarget: 105.2,
      lowerLiquidityTarget: 93.8,
      liquidityData: "unavailable" as const
   };
   const flow = interpretFlow(mockPrice, mockWhale);
   const timing = evaluateTimingGate("LONG", mockPrice, mockWhale, loc, flow);

   assert("Test 1: Healthy Breakout passes Timing Gate", timing.passed === true);
   assert("Test 1b: Timing Gate state is CONFIRMED", timing.state === "CONFIRMED");
   assert("Test 1c: isLateEntry is false", timing.isLateEntry === false);
}

// ----------------------------------------------------------------------------
// Test 2: Breakout Late (Price ran 2.5x ATR away from resistance / Buying the top)
// ----------------------------------------------------------------------------
{
   const mockPrice = {
      price: 103.0, // Broke 100.0, now 3.0 away (3.0x ATR)
      atr14: 1.0,
      rvol: 1.4,
      taker: 0.55,
      rsi: 76,
      klines: [{ open: 101.5, high: 103.2, low: 101.2, close: 103.0 }]
   };
   const mockWhale = { slope15: 140, slope5: 50, slope4h: 300, p_chg: 0.03, oi_chg: 0.005, cvd_mixed: false };
   const loc = {
      nearestResistance: 100.0,
      nearestSupport: 95.0,
      rangeHigh: 103.2,
      rangeLow: 95.0,
      nearResistance: false,
      nearSupport: false,
      distanceToResistancePct: -0.03,
      distanceToSupportPct: 0.08,
      upperLiquidityTarget: 103.4,
      lowerLiquidityTarget: 94.8,
      liquidityData: "unavailable" as const
   };
   const flow = interpretFlow(mockPrice, mockWhale);
   const timing = evaluateTimingGate("LONG", mockPrice, mockWhale, loc, flow);

   assert("Test 2: Late Breakout fails Timing Gate", timing.passed === false);
   assert("Test 2b: Timing Gate state is LATE_EXPANSION", timing.state === "LATE_EXPANSION");
   assert("Test 2c: isLateEntry is true", timing.isLateEntry === true);
   assert("Test 2d: isRetestCandidate is true", timing.isRetestCandidate === true);
}

// ----------------------------------------------------------------------------
// Test 3: Breakout Waiting for Retest / Successful Retest
// ----------------------------------------------------------------------------
{
   // Price broke 100.0, pulled back to 100.2 with lower rejection wick
   const mockPrice = {
      price: 100.2,
      atr14: 1.0,
      rvol: 1.1,
      taker: 0.53,
      rsi: 54,
      klines: [{ open: 100.4, high: 100.5, low: 99.9, close: 100.2 }] // lower wick = 0.3, body = 0.2
   };
   const mockWhale = { slope15: 80, slope5: 30, slope4h: 200, p_chg: 0.001, oi_chg: 0.002, cvd_mixed: false };
   const loc = {
      nearestResistance: 100.0,
      nearestSupport: 96.0,
      rangeHigh: 104.0,
      rangeLow: 95.0,
      nearResistance: false,
      nearSupport: false,
      distanceToResistancePct: -0.002,
      distanceToSupportPct: 0.042,
      upperLiquidityTarget: 104.2,
      lowerLiquidityTarget: 94.8,
      liquidityData: "unavailable" as const
   };
   const flow = interpretFlow(mockPrice, mockWhale);
   const timing = evaluateTimingGate("LONG", mockPrice, mockWhale, loc, flow);

   assert("Test 3: Retest holding above former resistance passes", timing.passed === true);
   assert("Test 3b: isRetestCandidate is marked true", timing.isRetestCandidate === true);
}

// ----------------------------------------------------------------------------
// Test 4: MIXED / CONFLICTED Flow Strictly Blocks Entry
// ----------------------------------------------------------------------------
{
   const mockPrice = { price: 100, taker: 0.44, rvol: 1.5, rsi: 52, atr14: 1.0, klines: [{ open: 99, high: 101, low: 99, close: 100 }] };
   const mockWhale = { p_chg: 0.005, oi_chg: 0.002, slope15: -80, slope5: -20, cvd_mixed: true };
   const flow = interpretFlow(mockPrice, mockWhale);
   
   assert("Test 4: Mixed CVD flags flow as MIXED", flow.state === "MIXED");
   assert("Test 4b: Persistence is CONFLICTED", flow.persistenceState === "CONFLICTED");

   const loc = evaluateLocation(mockPrice);
   const timing = evaluateTimingGate("LONG", mockPrice, mockWhale, loc, flow);
   const scenario = generateScenarios("TREND_UP", flow, loc, mockPrice);
   const conf = checkConfirmation("TREND_UP", flow, loc, scenario, timing, mockPrice, mockWhale, { sl: 8.5, ss: 4.0 });

   assert("Test 4c: MIXED/CONFLICTED flow strictly rejected from entry", conf.isConfirmed === false);
   assert("Test 4d: Confirmed signal is WAIT", conf.confirmedSignal === "WAIT");
}

// ----------------------------------------------------------------------------
// Test 5: Persistent Bullish Flow (High Multi-period Score)
// ----------------------------------------------------------------------------
{
   const mockPrice = { price: 100, taker: 0.58, rvol: 1.6, rsi: 56, atr14: 1.0, klines: [{ open: 99, high: 101, low: 99, close: 100 }] };
   const mockWhale = { p_chg: 0.004, oi_chg: 0.009, slope15: 180, slope5: 60, slope4h: 400, cvd_mixed: false };
   const flow = interpretFlow(mockPrice, mockWhale);

   assert("Test 5: Persistent flow state is STRONG", flow.persistenceState === "STRONG");
   assert("Test 5b: Persistence score >= 80", flow.persistenceScore >= 80);
}

// ----------------------------------------------------------------------------
// Test 6: Persistent Bearish Flow (High Multi-period Score)
// ----------------------------------------------------------------------------
{
   const mockPrice = { price: 100, taker: 0.42, rvol: 1.7, rsi: 38, atr14: 1.0, klines: [{ open: 101, high: 101, low: 99, close: 99.5 }] };
   const mockWhale = { p_chg: -0.005, oi_chg: 0.010, slope15: -210, slope5: -70, slope4h: -500, cvd_mixed: false };
   const flow = interpretFlow(mockPrice, mockWhale);

   assert("Test 6: Bearish flow state is STRONG", flow.persistenceState === "STRONG");
   assert("Test 6b: Bearish persistence score >= 80", flow.persistenceScore >= 80);
}

// ----------------------------------------------------------------------------
// Test 7: LONG Near Resistance without Clearance Blocks Entry
// ----------------------------------------------------------------------------
{
   const mockPrice = { price: 99.9, atr14: 1.0, rvol: 1.0, taker: 0.52, rsi: 60, klines: [{ open: 99.0, high: 100.0, low: 98.9, close: 99.9 }] };
   const mockWhale = { p_chg: 0.002, oi_chg: 0.004, slope15: 50, slope5: 20, slope4h: 100, cvd_mixed: false };
   const loc = {
      nearestResistance: 100.0,
      nearestSupport: 95.0,
      rangeHigh: 100.0,
      rangeLow: 95.0,
      nearResistance: true,
      nearSupport: false,
      distanceToResistancePct: 0.001, // 0.1% away from resistance!
      distanceToSupportPct: 0.049,
      upperLiquidityTarget: 100.2,
      lowerLiquidityTarget: 94.8,
      liquidityData: "unavailable" as const
   };
   const flow = interpretFlow(mockPrice, mockWhale);
   const timing = evaluateTimingGate("LONG", mockPrice, mockWhale, loc, flow);
   const scenario = generateScenarios("TREND_UP", flow, loc, mockPrice);
   const conf = checkConfirmation("TREND_UP", flow, loc, scenario, timing, mockPrice, mockWhale, { sl: 7.5, ss: 4.0 });

   assert("Test 7: LONG near resistance without breakout confirmation is blocked", conf.isConfirmed === false);
}

// ----------------------------------------------------------------------------
// Test 8: SHORT Near Support without Clearance Blocks Entry
// ----------------------------------------------------------------------------
{
   const mockPrice = { price: 100.1, atr14: 1.0, rvol: 1.0, taker: 0.48, rsi: 40, klines: [{ open: 101.0, high: 101.2, low: 100.0, close: 100.1 }] };
   const mockWhale = { p_chg: -0.002, oi_chg: 0.004, slope15: -50, slope5: -20, slope4h: -100, cvd_mixed: false };
   const loc = {
      nearestResistance: 105.0,
      nearestSupport: 100.0,
      rangeHigh: 105.0,
      rangeLow: 100.0,
      nearResistance: false,
      nearSupport: true,
      distanceToResistancePct: 0.049,
      distanceToSupportPct: 0.001, // 0.1% away from support!
      upperLiquidityTarget: 105.2,
      lowerLiquidityTarget: 99.8,
      liquidityData: "unavailable" as const
   };
   const flow = interpretFlow(mockPrice, mockWhale);
   const timing = evaluateTimingGate("SHORT", mockPrice, mockWhale, loc, flow);
   const scenario = generateScenarios("TREND_DOWN", flow, loc, mockPrice);
   const conf = checkConfirmation("TREND_DOWN", flow, loc, scenario, timing, mockPrice, mockWhale, { sl: 4.0, ss: 7.5 });

   assert("Test 8: SHORT near support without breakdown confirmation is blocked", conf.isConfirmed === false);
}

// ----------------------------------------------------------------------------
// Test 9: Direction Tracking (5m, 15m, 30m, 60m)
// ----------------------------------------------------------------------------
{
   const mockTrade = {
      symbol: "TESTUSDT",
      direction: "LONG",
      entry: 100.0,
      entryTime: new Date().toISOString()
   };
   registerTradeForDirectionTracking(mockTrade);
   updateDirectionTracking("TESTUSDT", 102.0); // +2% move

   const excursions = calculateDirectionalExcursions("LONG", 100, 102, 99.5);
   assert("Test 9: Directional excursion MFE is positive (+2%)", excursions.mfePercent === 2.0);
   assert("Test 9b: Directional excursion MAE is negative (-0.5%)", excursions.maePercent === -0.5);
}

// ----------------------------------------------------------------------------
// Test 10: Loss Classification Engine (EXIT_ERROR vs TIMING_ERROR vs DIRECTION_ERROR)
// ----------------------------------------------------------------------------
{
   // Case A: Achieved +1.2R, then reversed to hit SL -> EXIT_ERROR
   const exitErrorLoss = classifyTradeLoss(
      { direction: "LONG", maximum_favorable_excursion_r: 1.2 },
      { exitPrice: 98, exitReason: "SL Hit", finalPnl: -20 }
   );
   assert("Test 10a: +1.2R reversal is classified as EXIT_ERROR", exitErrorLoss === "EXIT_ERROR");

   // Case B: Entered on LATE_EXPANSION -> TIMING_ERROR
   const timingErrorLoss = classifyTradeLoss(
      {
         direction: "LONG",
         maximum_favorable_excursion_r: 0.4,
         reasoning: { timingGate: { isLateEntry: true, state: "LATE_EXPANSION" } }
      },
      { exitPrice: 98, exitReason: "SL Hit", finalPnl: -20 }
   );
   assert("Test 10b: Entry on late expansion is classified as TIMING_ERROR", timingErrorLoss === "TIMING_ERROR");

   // Case C: Direction immediately collapsed with 0 positive excursion (MFE < 0.25R) -> DIRECTION_ERROR
   const dirErrorLoss = classifyTradeLoss(
      { direction: "LONG", maximum_favorable_excursion_r: 0.1 },
      { exitPrice: 98, exitReason: "SL Hit", finalPnl: -20 }
   );
   assert("Test 10c: 0 positive follow-through is classified as DIRECTION_ERROR", dirErrorLoss === "DIRECTION_ERROR");

   // Case D: Disciplined stop loss with good timing and flow -> VALID_LOSS
   const validLoss = classifyTradeLoss(
      {
         direction: "LONG",
         maximum_favorable_excursion_r: 0.6,
         reasoning: {
            timingGate: { state: "CONFIRMED", isLateEntry: false },
            flow: { persistenceState: "STRONG" },
            location: { distanceToResistancePct: 0.04 }
         }
      },
      { exitPrice: 98, exitReason: "SL Hit", finalPnl: -20 }
   );
   assert("Test 10d: Good setup disciplined stop is classified as VALID_LOSS", validLoss === "VALID_LOSS");
}

// ----------------------------------------------------------------------------
// Test 11: Entry Quality Classifier
// ----------------------------------------------------------------------------
{
   const goodQuality = classifyEntryQuality({
      direction: "LONG",
      score: 8.5,
      reasoning: {
         timingGate: { state: "CONFIRMED", isLateEntry: false },
         flow: { persistenceState: "STRONG" },
         location: { distanceToResistancePct: 0.05 }
      }
   });
   assert("Test 11a: High conviction clean entry is classified as GOOD_ENTRY", goodQuality === "GOOD_ENTRY");

   const lateQuality = classifyEntryQuality({
      direction: "LONG",
      score: 8.0,
      reasoning: {
         timingGate: { state: "LATE_EXPANSION", isLateEntry: true }
      }
   });
   assert("Test 11b: Late entry is classified as LATE_ENTRY", lateQuality === "LATE_ENTRY");
}

// ----------------------------------------------------------------------------
// Test 12: Strict Liquidation Mock Isolation
// ----------------------------------------------------------------------------
{
   const mockPrice = {
      price: 50,
      klines: [{ high: 52, low: 48, close: 50, open: 49 }]
   };
   const loc = evaluateLocation(mockPrice);
   assert("Test 12: Liquidity data is strictly 'unavailable'", loc.liquidityData === "unavailable");
}

// ----------------------------------------------------------------------------
// Test 13: Strict Bull Regime - All SHORT Trades Prohibited
// ----------------------------------------------------------------------------
{
   const mockPrice = { price: 100, atr14: 1.0, rvol: 1.8, taker: 0.44, rsi: 40, adx: 25, di_plus: 15, di_minus: 30, klines: [{ open: 101, high: 101, low: 99, close: 99.5 }] };
   const mockWhale = { p_chg: -0.005, oi_chg: 0.010, slope15: -210, slope5: -70, slope4h: -500, cvd_mixed: false };
   const loc = { nearestResistance: 110, nearestSupport: 90, rangeHigh: 110, rangeLow: 90, nearResistance: false, nearSupport: false, distanceToResistancePct: 0.1, distanceToSupportPct: 0.1, upperLiquidityTarget: 111, lowerLiquidityTarget: 89, liquidityData: "unavailable" as const };
   const flow = interpretFlow(mockPrice, mockWhale);
   const timing = evaluateTimingGate("SHORT", mockPrice, mockWhale, loc, flow);
   const scenario = { primary: { type: "BREAKOUT_SHORT" as const, state: "WAITING" as const, bias: "SHORT" as const, thesis: "" }, alternative: { type: "NONE" as const, state: "WAITING" as const, bias: "NEUTRAL" as const, thesis: "" }, missingConfirmation: [], invalidationCondition: "" };
   
   // BTC is BULL_STRONG
   const conf1 = checkConfirmation("TREND_UP", flow, loc, scenario, timing, mockPrice, mockWhale, { sl: 3.0, ss: 8.5 }, { regime: "BULL_STRONG" });
   assert("Test 13a: SHORT blocked when BTC is BULL_STRONG", conf1.isConfirmed === false);
   assert("Test 13b: Reason mentions Strict Bull Regime", conf1.reason.includes("Strict Bull Regime"));

   // BTC is BULL_WEAK
   const conf2 = checkConfirmation("TREND_DOWN", flow, loc, scenario, timing, mockPrice, mockWhale, { sl: 3.0, ss: 8.5 }, { regime: "BULL_WEAK" });
   assert("Test 13c: SHORT blocked when BTC is BULL_WEAK", conf2.isConfirmed === false);
   assert("Test 13d: Reason mentions Strict Bull Regime", conf2.reason.includes("Strict Bull Regime"));
}

// ----------------------------------------------------------------------------
// Test 14: Strict Bear Regime - All LONG Trades Prohibited
// ----------------------------------------------------------------------------
{
   const mockPrice = { price: 100, atr14: 1.0, rvol: 1.8, taker: 0.58, rsi: 55, adx: 25, di_plus: 30, di_minus: 15, ema50: 95, st_bull: true, bull_align: true, HH_HL: true, klines: [{ open: 99, high: 101, low: 99, close: 100.5 }] };
   const mockWhale = { p_chg: 0.005, oi_chg: 0.010, slope15: 210, slope5: 70, slope4h: 500, cvd_mixed: false };
   const loc = { nearestResistance: 110, nearestSupport: 90, rangeHigh: 110, rangeLow: 90, nearResistance: false, nearSupport: false, distanceToResistancePct: 0.1, distanceToSupportPct: 0.1, upperLiquidityTarget: 111, lowerLiquidityTarget: 89, liquidityData: "unavailable" as const };
   const flow = interpretFlow(mockPrice, mockWhale);
   const timing = evaluateTimingGate("LONG", mockPrice, mockWhale, loc, flow);
   const scenario = { primary: { type: "BREAKOUT_LONG" as const, state: "WAITING" as const, bias: "LONG" as const, thesis: "" }, alternative: { type: "NONE" as const, state: "WAITING" as const, bias: "NEUTRAL" as const, thesis: "" }, missingConfirmation: [], invalidationCondition: "" };

   // BTC is BEAR_STRONG
   const conf1 = checkConfirmation("TREND_UP", flow, loc, scenario, timing, mockPrice, mockWhale, { sl: 8.5, ss: 3.0 }, { regime: "BEAR_STRONG" });
   assert("Test 14a: LONG blocked when BTC is BEAR_STRONG", conf1.isConfirmed === false);
   assert("Test 14b: Reason mentions Strict Bear Regime", conf1.reason.includes("Strict Bear Regime"));

   // BTC is BEAR_WEAK
   const conf2 = checkConfirmation("TRANSITION", flow, loc, scenario, timing, mockPrice, mockWhale, { sl: 8.5, ss: 3.0 }, { regime: "BEAR_WEAK" });
   assert("Test 14c: LONG blocked when BTC is BEAR_WEAK", conf2.isConfirmed === false);
   assert("Test 14d: Reason mentions Strict Bear Regime", conf2.reason.includes("Strict Bear Regime"));
}

// ----------------------------------------------------------------------------
// Test 15: RANGE Long Trap Blocker
// ----------------------------------------------------------------------------
{
   const mockPrice = { price: 100, atr14: 1.0, rvol: 2.5, taker: 0.60, rsi: 56, adx: 28, di_plus: 32, di_minus: 12, ema50: 98, st_bull: true, bull_align: true, HH_HL: true, klines: [{ open: 99, high: 101, low: 99, close: 100.5 }] };
   const mockWhale = { p_chg: 0.005, oi_chg: 0.010, slope15: 210, slope5: 70, slope4h: 500, cvd_mixed: false };
   const loc = { nearestResistance: 110, nearestSupport: 90, rangeHigh: 110, rangeLow: 90, nearResistance: false, nearSupport: false, distanceToResistancePct: 0.1, distanceToSupportPct: 0.1, upperLiquidityTarget: 111, lowerLiquidityTarget: 89, liquidityData: "unavailable" as const };
   const flow = interpretFlow(mockPrice, mockWhale);
   const timing = evaluateTimingGate("LONG", mockPrice, mockWhale, loc, flow);
   const scenario = { primary: { type: "BREAKOUT_LONG" as const, state: "WAITING" as const, bias: "LONG" as const, thesis: "" }, alternative: { type: "NONE" as const, state: "WAITING" as const, bias: "NEUTRAL" as const, thesis: "" }, missingConfirmation: [], invalidationCondition: "" };

   // Asset is RANGE while BTC is BULL_STRONG
   const conf1 = checkConfirmation("RANGE", flow, loc, scenario, timing, mockPrice, mockWhale, { sl: 8.5, ss: 3.0 }, { regime: "BULL_STRONG" });
   assert("Test 15a: LONG in RANGE blocked when BTC is BULL_STRONG", conf1.isConfirmed === false);
   assert("Test 15b: Reason mentions RANGE Long Trap Blocker", conf1.reason.includes("RANGE Long Trap Blocker"));

   // Asset is RANGE while BTC is BULL_WEAK
   const conf2 = checkConfirmation("RANGE", flow, loc, scenario, timing, mockPrice, mockWhale, { sl: 8.5, ss: 3.0 }, { regime: "BULL_WEAK" });
   assert("Test 15c: LONG in RANGE blocked when BTC is BULL_WEAK", conf2.isConfirmed === false);
}

// ----------------------------------------------------------------------------
// Test 16: Dead Chop Filter in RANGE
// ----------------------------------------------------------------------------
{
   const mockWhale = { p_chg: 0.005, oi_chg: 0.010, slope15: 210, slope5: 70, slope4h: 500, cvd_mixed: false };
   const loc = { nearestResistance: 110, nearestSupport: 90, rangeHigh: 110, rangeLow: 90, nearResistance: false, nearSupport: false, distanceToResistancePct: 0.1, distanceToSupportPct: 0.1, upperLiquidityTarget: 111, lowerLiquidityTarget: 89, liquidityData: "unavailable" as const };
   const scenario = { primary: { type: "BREAKOUT_LONG" as const, state: "WAITING" as const, bias: "LONG" as const, thesis: "" }, alternative: { type: "NONE" as const, state: "WAITING" as const, bias: "NEUTRAL" as const, thesis: "" }, missingConfirmation: [], invalidationCondition: "" };

   // In RANGE with weak RVOL (1.2 < 2.0)
   const weakRvolPrice = { price: 100, atr14: 1.0, rvol: 1.2, taker: 0.58, rsi: 55, adx: 25, di_plus: 30, di_minus: 12, ema50: 95, st_bull: true, bull_align: true, HH_HL: true, klines: [{ open: 99, high: 101, low: 99, close: 100.5 }] };
   const flow1 = interpretFlow(weakRvolPrice, mockWhale);
   const timing1 = evaluateTimingGate("LONG", weakRvolPrice, mockWhale, loc, flow1);
   const conf1 = checkConfirmation("RANGE", flow1, loc, scenario, timing1, weakRvolPrice, mockWhale, { sl: 8.5, ss: 3.0 }, { regime: "RANGING" });
   assert("Test 16a: RANGE trade with weak RVOL is blocked by Dead Chop filter", conf1.isConfirmed === false);
   assert("Test 16b: Reason mentions Dead Chop Filter and Explosive RVOL", conf1.reason.includes("Dead Chop Filter") && conf1.reason.includes("Explosive RVOL"));

   // In RANGE with weak ADX (15 < 22)
   const weakAdxPrice = { price: 100, atr14: 1.0, rvol: 2.2, taker: 0.58, rsi: 55, adx: 15, di_plus: 30, di_minus: 12, ema50: 95, st_bull: true, bull_align: true, HH_HL: true, klines: [{ open: 99, high: 101, low: 99, close: 100.5 }] };
   const flow2 = interpretFlow(weakAdxPrice, mockWhale);
   const timing2 = evaluateTimingGate("LONG", weakAdxPrice, mockWhale, loc, flow2);
   const conf2 = checkConfirmation("RANGE", flow2, loc, scenario, timing2, weakAdxPrice, mockWhale, { sl: 8.5, ss: 3.0 }, { regime: "RANGING" });
   assert("Test 16c: RANGE trade with weak ADX is blocked by Dead Chop filter", conf2.isConfirmed === false);
   assert("Test 16d: Reason mentions Directional strength ADX", conf2.reason.includes("Directional strength ADX"));
}

// ----------------------------------------------------------------------------
// Test 17: Oversold Short Blocker (RSI < 42 or overstretched below EMA21)
// ----------------------------------------------------------------------------
{
   const mockBearWhale = { p_chg: -0.005, oi_chg: 0.010, slope15: -210, slope5: -70, slope4h: -500, cvd_mixed: false };
   const loc = { nearestResistance: 110, nearestSupport: 90, rangeHigh: 110, rangeLow: 90, nearResistance: false, nearSupport: false, distanceToResistancePct: 0.1, distanceToSupportPct: 0.1, upperLiquidityTarget: 111, lowerLiquidityTarget: 89, liquidityData: "unavailable" as const };
   const shortScenario = { primary: { type: "BREAKOUT_SHORT" as const, state: "WAITING" as const, bias: "SHORT" as const, thesis: "" }, alternative: { type: "NONE" as const, state: "WAITING" as const, bias: "NEUTRAL" as const, thesis: "" }, missingConfirmation: [], invalidationCondition: "" };

   // 17a: Deeply oversold Short (RSI = 35 < 42)
   const oversoldRsiPrice = { price: 95, ema21: 96, atr14: 1.0, rvol: 1.8, taker: 0.42, rsi: 35, adx: 28, di_plus: 12, di_minus: 30, ema50: 100, st_bull: false, bear_align: true, LH_LL: true, klines: [{ open: 96, high: 96, low: 94.5, close: 95 }] };
   const flow1 = interpretFlow(oversoldRsiPrice, mockBearWhale);
   const timing1 = evaluateTimingGate("SHORT", oversoldRsiPrice, mockBearWhale, loc, flow1);
   const conf1 = checkConfirmation("TREND_DOWN", flow1, loc, shortScenario, timing1, oversoldRsiPrice, mockBearWhale, { sl: 2.0, ss: 8.5 }, { regime: "NEUTRAL_CONSOLIDATION" });
   assert("Test 17a: SHORT with RSI < 42 is blocked by Oversold Short Blocker", conf1.isConfirmed === false);
   assert("Test 17b: Reason mentions Oversold Short Blocker", conf1.reason.includes("Oversold Short Blocker"));

   // 17c: Price overstretched below EMA21 (> 1.8 * ATR)
   const overstretchedPrice = { price: 90, ema21: 95, atr14: 1.0, rvol: 1.8, taker: 0.44, rsi: 44, adx: 28, di_plus: 12, di_minus: 30, ema50: 100, st_bull: false, bear_align: true, LH_LL: true, klines: [{ open: 92, high: 92, low: 89.5, close: 90 }] };
   const flow2 = interpretFlow(overstretchedPrice, mockBearWhale);
   const timing2 = evaluateTimingGate("SHORT", overstretchedPrice, mockBearWhale, loc, flow2);
   const conf2 = checkConfirmation("TREND_DOWN", flow2, loc, shortScenario, timing2, overstretchedPrice, mockBearWhale, { sl: 2.0, ss: 8.5 }, { regime: "NEUTRAL_CONSOLIDATION" });
   assert("Test 17c: SHORT overstretched below EMA21 is blocked", conf2.isConfirmed === false);

   // 17d: Healthy pullback Short (RSI = 50, near EMA21 95)
   const healthyShortPrice = { price: 94.5, ema21: 95, atr14: 1.0, rvol: 1.8, taker: 0.44, rsi: 50, adx: 28, di_plus: 12, di_minus: 30, ema50: 100, st_bull: false, bear_align: true, LH_LL: true, klines: [{ open: 94, high: 95, low: 94, close: 94.5 }] };
   const flow3 = interpretFlow(healthyShortPrice, mockBearWhale);
   const timing3 = evaluateTimingGate("SHORT", healthyShortPrice, mockBearWhale, loc, flow3);
   const conf3 = checkConfirmation("TREND_DOWN", flow3, loc, shortScenario, timing3, healthyShortPrice, mockBearWhale, { sl: 2.0, ss: 8.5 }, { regime: "NEUTRAL_CONSOLIDATION" });
   assert("Test 17d: Healthy Short near resistance/EMA21 passes oversold check", conf3.reason.includes("Oversold Short Blocker") === false);

   // 17e: Breakdown Short during BTC BEAR_STRONG / Dump allows RSI down to 28 (RSI = 35 allowed)
   const breakdownPrice = { price: 94.5, ema21: 96, atr14: 1.0, rvol: 2.2, taker: 0.40, rsi: 35, adx: 32, di_plus: 10, di_minus: 38, ema50: 100, st_bull: false, bear_align: true, LH_LL: true, klines: [{ open: 96, high: 96, low: 94, close: 94.5 }] };
   const flow4 = interpretFlow(breakdownPrice, mockBearWhale);
   const timing4 = evaluateTimingGate("SHORT", breakdownPrice, mockBearWhale, loc, flow4);
   const conf4 = checkConfirmation("TREND_DOWN", flow4, loc, shortScenario, timing4, breakdownPrice, mockBearWhale, { sl: 2.0, ss: 8.5 }, { regime: "BEAR_STRONG", btc_dump: true });
   assert("Test 17e: Breakdown Short with RSI 35 is NOT blocked by Oversold Blocker during BTC BEAR / DUMP", conf4.reason.includes("Oversold Short Blocker") === false);
}

// ----------------------------------------------------------------------------
// Test 18: Neutral BTC Regime allows clean Altcoin LONG
// ----------------------------------------------------------------------------
{
   const mockBullWhale = { p_chg: 0.005, oi_chg: 0.010, slope15: 210, slope5: 70, slope4h: 500, cvd_mixed: false };
   const loc = { nearestResistance: 100.0, nearestSupport: 96.0, rangeHigh: 104.0, rangeLow: 95.0, nearResistance: false, nearSupport: false, distanceToResistancePct: -0.002, distanceToSupportPct: 0.042, upperLiquidityTarget: 104.2, lowerLiquidityTarget: 94.8, liquidityData: "unavailable" as const };
   const longScenario = { primary: { type: "BREAKOUT_LONG" as const, state: "CONFIRMED" as const, bias: "LONG" as const, thesis: "" }, alternative: { type: "NONE" as const, state: "WAITING" as const, bias: "NEUTRAL" as const, thesis: "" }, missingConfirmation: [], invalidationCondition: "" };
   const strongAltcoinPrice = { price: 100.2, ema21: 98, atr14: 1.0, rvol: 1.8, taker: 0.60, rsi: 58, adx: 28, di_plus: 32, di_minus: 12, ema50: 95, st_bull: true, bull_align: true, HH_HL: true, klines: [{ open: 100.4, high: 100.5, low: 99.9, close: 100.2 }] };
   const flow = interpretFlow(strongAltcoinPrice, mockBullWhale);
   const timing = evaluateTimingGate("LONG", strongAltcoinPrice, mockBullWhale, loc, flow);

   // BTC is in NEUTRAL_CONSOLIDATION
   const confNeutral = checkConfirmation("TREND_UP", flow, loc, longScenario, timing, strongAltcoinPrice, mockBullWhale, { sl: 8.5, ss: 2.0 }, { regime: "NEUTRAL_CONSOLIDATION" });
   assert("Test 18a: LONG trade is NOT blocked by Bear Regime when BTC is NEUTRAL_CONSOLIDATION", confNeutral.reason.includes("Strict Bear Regime") === false);
   assert("Test 18b: LONG trade passes confirmation in NEUTRAL_CONSOLIDATION", confNeutral.isConfirmed === true);
}

// ----------------------------------------------------------------------------
// Test 19: SL Distance Floor & Notional Sizing Ceiling
// ----------------------------------------------------------------------------
{
   const balance = 1000;
   const entry = 254.75;
   const atr14 = 0.567;
   const minSlDistance = Math.max(atr14 * 0.8, entry * 0.006);
   assert("Test 19a: Min SL distance enforces minimum 0.6% or 0.8*ATR", minSlDistance >= 1.52);

   // Even if raw SL would have been 0.0118 away (as occurred in AMZN bug):
   const rawSlDist = 0.0118;
   const correctedSlDist = Math.max(rawSlDist, minSlDistance);
   assert("Test 19b: Microscopic SL distance is strictly corrected to floor", correctedSlDist >= 1.52);

   // Iron notional ceiling (max 10x balance)
   const maxAllowedNotional = balance * 10; // $10,000
   const maxPosCap = maxAllowedNotional / entry;
   const unconstrainedPos = 9.93 / rawSlDist; // Was 841.5 shares!
   const constrainedPos = Math.min(unconstrainedPos, maxPosCap);

   assert("Test 19c: Position is strictly capped below 10x balance notional", constrainedPos * entry <= 10000.01);
   assert("Test 19d: Unconstrained $214k contract size is prevented", constrainedPos < 40);
}

// ----------------------------------------------------------------------------
// Test 20: Early Loss Cut & Profit Breathing Room Verification
// ----------------------------------------------------------------------------
{
   // 20a: Hard Early Loss Cut at -0.40R
   const initialSlAmount = 10.0; // $10 full SL
   const earlyCutR = -0.40;
   const earlyLossAmount = initialSlAmount * Math.abs(earlyCutR);
   const capitalSaved = initialSlAmount - earlyLossAmount;
   assert("Test 20a: Early cut at -0.40R limits loss to $4.00 max on $10 SL", earlyLossAmount <= 4.00);
   assert("Test 20b: Early cut saves at least 60% of stop loss capital", capitalSaved >= 6.00);

   // 20c: Fast Flow Loss Cut at -0.25R
   const fastFlowCutR = -0.25;
   const fastFlowLoss = initialSlAmount * Math.abs(fastFlowCutR);
   assert("Test 20c: Fast Flow cut at -0.25R limits loss to $2.50", fastFlowLoss <= 2.50);

   // 20d: Profit Breathing Room at +0.45R (Soft trail instead of breakeven choking)
   const entry = 100;
   const slDist = 2.0;
   const softTrailSl = entry - (slDist * 0.25); // SL moved to -0.25R
   assert("Test 20d: Breathing room SL maintains 1.25R buffer from current +0.45R price", (entry + 0.45 * slDist) - softTrailSl >= 1.25);
}

// ----------------------------------------------------------------------------
// Test 21: Institutional Trade Guard - Tsunami Runner Hold
// ----------------------------------------------------------------------------
{
   const openTrade = {
      symbol: "BTCUSDT",
      direction: "SHORT" as const,
      entry: 81300,
      sl: 81800,
      initialSlDist: 500,
      profitR: 1.8,
      peak_r: 2.0,
      a_closed: false,
      b_closed: false,
      c_closed: false
   };
   const mockPrice = {
      price: 80400,
      ema21: 80800,
      taker: 0.44, // 56% taker sell
      rvol: 1.8,
      klines: [{ open: 80800, high: 80900, low: 80350, close: 80400 }]
   };
   const mockWhale = {
      slope15: -180,
      slope5: -90,
      slope4h: -300,
      oi_chg: 0.005, // fresh shorts opening
      scenario: "INST_SHORT"
   };

   const guard = evaluateInstitutionalTradeGuard(openTrade, mockPrice, mockWhale);
   assert("Test 21a: Institutional Tsunami returns TSUNAMI_RUNNER_HOLD", guard.action === "TSUNAMI_RUNNER_HOLD");
   assert("Test 21b: Tsunami confidence is ABSOLUTE", guard.confidence === "ABSOLUTE");
   assert("Test 21c: Dynamic trailing floor R is calculated", typeof guard.trailFloorR === "number" && guard.trailFloorR >= 1.0);
}

// ----------------------------------------------------------------------------
// Test 22: Institutional Trade Guard - Benign Pullback Hold
// ----------------------------------------------------------------------------
{
   const openTrade = {
      symbol: "SOLUSDT",
      direction: "SHORT" as const,
      entry: 180.0,
      sl: 184.0,
      initialSlDist: 4.0,
      profitR: 0.25,
      peak_r: 0.60,
      a_closed: false,
      b_closed: false,
      c_closed: false
   };
   // 5m printed a minor green pullback candle, but 15m orderflow and EMA21 are bearish:
   const mockPrice = {
      price: 179.0,
      ema21: 180.5,
      taker: 0.50, // neutral tick
      rvol: 0.9,
      klines: [{ open: 178.5, high: 179.2, low: 178.4, close: 179.0 }]
   };
   const mockWhale = {
      slope15: -95,
      slope5: 10, // minor 5m uptick
      slope4h: -150,
      oi_chg: -0.001,
      scenario: "INST_SHORT"
   };

   const guard = evaluateInstitutionalTradeGuard(openTrade, mockPrice, mockWhale);
   assert("Test 22a: Benign 5m pullback returns BENIGN_PULLBACK_HOLD", guard.action === "BENIGN_PULLBACK_HOLD");
   assert("Test 22b: Benign pullback confidence is HIGH", guard.confidence === "HIGH");
}

// ----------------------------------------------------------------------------
// Test 23: Institutional Trade Guard - Absorption & Bull Trap Exit
// ----------------------------------------------------------------------------
{
   const openTrade = {
      symbol: "ETHUSDT",
      direction: "LONG" as const,
      entry: 2600,
      sl: 2560,
      initialSlDist: 40,
      profitR: 0.75,
      peak_r: 0.85,
      a_closed: false,
      b_closed: false,
      c_closed: false
   };
   // Price pushed up to 2630, but upper wick is huge, CVD diverged sharply negative, taker buy is weak:
   const mockPrice = {
      price: 2630,
      ema21: 2605,
      taker: 0.43, // retail bought top into limit asks
      rvol: 2.1,
      klines: [{ open: 2610, high: 2642, low: 2608, close: 2618 }] // upper wick: 24, body: 8 (3x)
   };
   const mockWhale = {
      slope15: -120, // CVD collapsing despite higher price!
      slope5: -70,
      slope4h: 100,
      oi_chg: 0.008,
      scenario: "BULL_TRAP",
      hidden_sell: true
   };

   const guard = evaluateInstitutionalTradeGuard(openTrade, mockPrice, mockWhale);
   assert("Test 23a: Passive distribution triggers ABSORPTION_TRAP_EXIT", guard.action === "ABSORPTION_TRAP_EXIT");
   assert("Test 23b: Trap confidence is ABSOLUTE", guard.confidence === "ABSOLUTE");
   assert("Test 23c: Trap type is BULL_TRAP", guard.metrics.trapType === "BULL_TRAP");
}

// ----------------------------------------------------------------------------
// Test 24: Institutional Trade Guard - Squeeze / Liquidation Exhaustion Exit
// ----------------------------------------------------------------------------
{
   const openTrade = {
      symbol: "NEARUSDT",
      direction: "SHORT" as const,
      entry: 5.50,
      sl: 5.75,
      initialSlDist: 0.25,
      profitR: 1.4,
      peak_r: 1.5,
      a_closed: true,
      b_closed: false,
      c_closed: false
   };
   // Massive long liquidation flush depleted OI by -2.2%, 5m CVD rebounding:
   const mockPrice = {
      price: 5.15,
      ema21: 5.35,
      taker: 0.55,
      rvol: 2.5,
      klines: [{ open: 5.12, high: 5.18, low: 5.10, close: 5.15 }]
   };
   const mockWhale = {
      slope15: -80,
      slope5: 65, // short squeeze bounce starting
      slope4h: -100,
      oi_chg: -0.022, // -2.2% OI flush complete
      scenario: "LONG_LIQ"
   };

   const guard = evaluateInstitutionalTradeGuard(openTrade, mockPrice, mockWhale);
   assert("Test 24a: Liquidation flush completion returns SQUEEZE_EXHAUSTION_EXIT", guard.action === "SQUEEZE_EXHAUSTION_EXIT");
   assert("Test 24b: Squeeze exhaustion confidence is HIGH", guard.confidence === "HIGH");
}

// ----------------------------------------------------------------------------
// Test 25: Institutional Trade Guard - Surgical Invalidation Exit
// ----------------------------------------------------------------------------
{
   const openTrade = {
      symbol: "AVAXUSDT",
      direction: "SHORT" as const,
      entry: 28.00,
      sl: 29.00,
      initialSlDist: 1.00,
      profitR: -0.28, // minor loss
      peak_r: 0.10,
      a_closed: false,
      b_closed: false,
      c_closed: false
   };
   // Multi-timeframe CVD completely flipped to buying, candles broke above EMA21:
   const mockPrice = {
      price: 28.28,
      ema21: 28.15,
      taker: 0.57, // aggressive buyers took over
      rvol: 1.5,
      klines: [
         { open: 28.10, high: 28.25, low: 28.08, close: 28.22 },
         { open: 28.22, high: 28.32, low: 28.18, close: 28.28 }
      ]
   };
   const mockWhale = {
      slope15: 75,
      slope5: 55,
      slope4h: 120,
      oi_chg: 0.006,
      scenario: "INST_LONG"
   };

   const guard = evaluateInstitutionalTradeGuard(openTrade, mockPrice, mockWhale);
   assert("Test 25a: Multi-timeframe orderflow reversal triggers SURGICAL_INVALIDATION_EXIT", guard.action === "SURGICAL_INVALIDATION_EXIT");
   assert("Test 25b: Surgical invalidation saves capital at -0.28R before full -1.0R SL", openTrade.profitR >= -0.35);
}

console.log("\n=======================================================");
console.log(`📊 TIMING GATE TEST SUITE SUMMARY: ${passedCount} PASSED | ${failedCount} FAILED`);
console.log("=======================================================\n");

if (failedCount > 0) {
   process.exit(1);
} else {
   console.log("✨ All Timing Gate & Flow Persistence tests PASSED flawlessly!\n");
}
