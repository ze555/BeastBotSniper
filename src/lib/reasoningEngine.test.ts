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
   evaluateSymbolReasoning
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
   // A prior candle closed above 100.0; the current candle touched 100.0
   // and closed back above it.
   const mockPrice = {
      price: 100.2, atr14: 1.0, rvol: 1.1, taker: 0.53, rsi: 54,
      klines: [
         { open: 99.5, high: 100.0, low: 99.2, close: 99.8 },
         { open: 99.8, high: 101.5, low: 99.7, close: 101.0 },
         { open: 100.4, high: 100.8, low: 100.0, close: 100.2 }
      ]
   };
   const mockWhale = { slope15: 80, slope5: 30, slope4h: 200, p_chg: 0.003, oi_chg: 0.004, cvd_mixed: false };
   const loc = evaluateLocation(mockPrice);
   const flow = interpretFlow(mockPrice, mockWhale);
   const timing = evaluateTimingGate("LONG", mockPrice, mockWhale, loc, flow);
   assert("Test 3: Retest holding above former resistance passes", timing.passed === true);
   assert("Test 3b: isRetestCandidate is marked true", timing.isRetestCandidate === true);
}

// Mirrored short retest: historical close below support, later touch, close below.
{
   const mockPrice = { price: 99.8, atr14: 1.0, rvol: 1.1, taker: 0.47, rsi: 46, klines: [
      { open: 100.5, high: 101.0, low: 100.0, close: 100.2 },
      { open: 100.2, high: 100.3, low: 98.5, close: 99.0 },
      { open: 99.6, high: 100.0, low: 99.2, close: 99.8 }
   ] };
   const whale = { slope15: -80, slope5: -30, slope4h: -200, p_chg: -0.003, oi_chg: 0.004, cvd_mixed: false };
   const loc = evaluateLocation(mockPrice);
   const flow = interpretFlow(mockPrice, whale);
   const timing = evaluateTimingGate("SHORT", mockPrice, whale, loc, flow);
   assert("Test 3c: Mirrored short retest requires and accepts historical touch/close", timing.passed === true && timing.state === "CONFIRMED");
}

// Retest regressions: proximity alone, missing touch, wrong-side close, and
// a previously invalidated breakout must all be rejected in both directions.
for (const direction of ["LONG", "SHORT"] as const) {
   const sign = direction === "LONG" ? 1 : -1;
   const baseCandles = [
      { open: 99.5, high: 100, low: 99.2, close: 99.8 },
      { open: 99.8, high: 101.5, low: 99.7, close: 101 },
      { open: 100.4, high: 100.8, low: 100, close: 100.2 }
   ];
   const mirror = (candles: typeof baseCandles) => sign === 1 ? candles : candles.map(c => ({
      open: 200 - c.open, close: 200 - c.close, high: 200 - c.low, low: 200 - c.high
   }));
   const evaluate = (candles: typeof baseCandles) => {
      const klines = mirror(candles);
      const p = { price: klines[klines.length - 1].close, atr14: 1, rvol: 1.1,
         taker: sign === 1 ? 0.53 : 0.47, rsi: 50, klines };
      const w = { slope15: sign * 80, slope5: sign * 30, slope4h: sign * 200,
         p_chg: sign * 0.003, oi_chg: 0.004, cvd_mixed: false };
      return evaluateTimingGate(direction, p, w, evaluateLocation(p), interpretFlow(p, w));
   };
   assert(`${direction}: no historical breakout cannot confirm a wick retest`,
      !evaluate([baseCandles[0], baseCandles[0], baseCandles[2]]).passed);
   assert(`${direction}: proximity without an actual touch is rejected`,
      !evaluate([baseCandles[0], baseCandles[1], { ...baseCandles[2], low: 100.1 }]).passed);
   assert(`${direction}: retest close on wrong side is rejected`,
      !evaluate([baseCandles[0], baseCandles[1], { ...baseCandles[2], close: 99.9 }]).passed);
   assert(`${direction}: intervening invalidation cancels retest eligibility`,
      !evaluate([baseCandles[0], baseCandles[1], { open: 100.2, high: 100.3, low: 99, close: 99.5 }, baseCandles[2]]).passed);
   assert(`${direction}: historical indices remain correct beyond the 30-candle window`,
      evaluate([...Array.from({ length: 40 }, () => ({ ...baseCandles[0] })), ...baseCandles]).passed);
}

// ATR spike uses an independent prior baseline and fails safe when absent.
{
   const base = { regime: "NEUTRAL", tradeable: true };
   const p = { price: 100, ema50: 99, ema200: 95, ema21: 99, HH_HL: true, LH_LL: false, adx: 30, rvol: 3, atr14: 2, atr20: 1, atrBaseline: 1, bull_align: true, bear_align: false };
   assert("Test 3d: ATR spike uses independent baseline", detectMarketRegime(base, p) === "HIGH_VOLATILITY");
   const { atrBaseline, ...withoutBaseline } = p;
   assert("Test 3e: Missing ATR baseline fails safe", detectMarketRegime(base, withoutBaseline) !== "HIGH_VOLATILITY");
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

console.log("\n=======================================================");
console.log(`📊 TIMING GATE TEST SUITE SUMMARY: ${passedCount} PASSED | ${failedCount} FAILED`);
console.log("=======================================================\n");

if (failedCount > 0) {
   process.exit(1);
} else {
   console.log("✨ All Timing Gate & Flow Persistence tests PASSED flawlessly!\n");
}
