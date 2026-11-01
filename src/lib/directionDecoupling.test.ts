import { 
  DirectionStateEngine, 
  CandleData, 
  evaluateDirectionTiming,
  TimingResult,
  DirectionDecision
} from "./directionStateEngine";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ [PASS] ${message}`);
  }
}

console.log("======================================================================");
console.log("🧪 DIRECTION DECOUPLING & TIMING SEPARATION VALIDATION SUITE");
console.log("======================================================================");

const baseTime = 1790848560000;

function createWarmupCandles(count: number = 15, basePrice: number = 100.0): CandleData[] {
  const arr: CandleData[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      time: baseTime + i * 60000,
      open: basePrice,
      high: basePrice + 0.5,
      low: basePrice - 0.5,
      close: basePrice,
      volume: 1000,
      takerBuyBase: 500
    });
  }
  return arr;
}

/**
 * Unified Decision Evaluator representing the decoupled architecture:
 * Direction is governed SOLELY by DirectionStateEngine.
 * Timing is governed SOLELY by evaluateDirectionTiming.
 * Legacy scores or confirmation engines CANNOT override or flip direction.
 */
function evaluateDecoupledDecision(
  dirDecision: DirectionDecision,
  candle: CandleData,
  ema21: number,
  atr14: number,
  rsi: number,
  btcRegime: string = "TREND_UP"
): { signal: "LONG" | "SHORT" | "WAIT"; reason: string; setupType?: string; timingResult?: TimingResult } {
  // 1. Check Direction State Machine
  if (!dirDecision.canEnter || dirDecision.direction === "UNKNOWN") {
    return { 
      signal: "WAIT", 
      reason: `Direction State [${dirDecision.state}]: Awaiting valid structural entry condition` 
    };
  }

  // 2. Safety Gate: Shorting strictly prohibited in BTC BULL_STRONG
  if (dirDecision.direction === "SHORT" && btcRegime === "BULL_STRONG") {
    return {
      signal: "WAIT",
      reason: "Safety Gate: BTC Regime is BULL_STRONG. Shorting strictly prohibited."
    };
  }

  // 3. Timing Engine: Decides ONLY GO or WAIT. CAN NEVER ALTER DIRECTION.
  const timingResult = evaluateDirectionTiming(
    dirDecision.direction,
    candle,
    ema21,
    atr14,
    rsi
  );

  if (!timingResult.canExecute || timingResult.timingAction === "WAIT") {
    return {
      signal: "WAIT",
      reason: `Direction: ${dirDecision.direction} (${dirDecision.state}) | Timing Gate: WAIT (${timingResult.timingReason})`,
      timingResult
    };
  }

  // 4. Execution confirmed in the exact direction of DirectionStateEngine
  const setupType = dirDecision.entryType === "FORMING_EARLY"
    ? (dirDecision.direction === "LONG" ? "FORMING_EARLY_LONG" : "FORMING_EARLY_SHORT")
    : (dirDecision.direction === "LONG" ? "BREAKOUT_MOMENTUM" : "BREAKDOWN_MOMENTUM");

  return {
    signal: dirDecision.direction,
    reason: `Direction [${dirDecision.state}] + Timing [GO]: Clean execution`,
    setupType,
    timingResult
  };
}

// -----------------------------------------------------------------------------
// Test 1: FORMING_LONG with valid evidence chain executes LONG without legacy score
// -----------------------------------------------------------------------------
console.log("\n--- TEST 1: FORMING_LONG Early Entry Execution ---");
const engine1 = new DirectionStateEngine("TEST_DECOUPLE_1");
createWarmupCandles(15, 100.0).forEach(c => engine1.processCandle(c));

// Candle prints higher low (99.8 > 99.5), buyer dominance (taker: 70%), positive CVD, expanding volume (1500 > 1000)
const formingCandle: CandleData = {
  time: baseTime + 16 * 60000,
  open: 100.1,
  high: 100.4,
  low: 99.8,
  close: 100.3,
  volume: 1500,
  takerBuyBase: 1050
};
const dirDec1 = engine1.processCandle(formingCandle);
assert(dirDec1.state === "FORMING_LONG", "Test 1.1: State is FORMING_LONG");
assert(dirDec1.canEnter === true, "Test 1.2: canEnter is TRUE for FORMING_LONG with valid evidence");
assert(dirDec1.entryType === "FORMING_EARLY", "Test 1.3: entryType is FORMING_EARLY");

// Evaluate decoupled execution near EMA21 (100.0), ATR 0.5, RSI 55
const execDecision1 = evaluateDecoupledDecision(dirDec1, formingCandle, 100.0, 0.5, 55.0);
assert(execDecision1.signal === "LONG", "Test 1.4: Signal is strictly LONG on FORMING_LONG");
assert(execDecision1.setupType === "FORMING_EARLY_LONG", "Test 1.5: Setup type is FORMING_EARLY_LONG");

// -----------------------------------------------------------------------------
// Test 2: Direction = LONG + Bad Timing (Overextended) strictly outputs WAIT (NEVER SHORT)
// -----------------------------------------------------------------------------
console.log("\n--- TEST 2: Anti-Flip Rule on Overextension ---");
// Extended price: price 102.5, EMA21 at 100.0, ATR 0.5 (5.0x ATR distance, RSI 76)
const extendedCandle: CandleData = {
  time: baseTime + 17 * 60000,
  open: 102.0,
  high: 102.6,
  low: 101.9,
  close: 102.5,
  volume: 2000,
  takerBuyBase: 1400
};
const execDecision2 = evaluateDecoupledDecision(dirDec1, extendedCandle, 100.0, 0.5, 76.0);
assert(execDecision2.signal === "WAIT", "Test 2.1: Signal is WAIT when overextended");
assert(execDecision2.signal !== "SHORT", "Test 2.2: ANTI-FLIP: Signal NEVER flips to SHORT when timing is bad");
assert(execDecision2.timingResult?.isLateExpansion === true, "Test 2.3: Correctly flagged as late expansion");

// -----------------------------------------------------------------------------
// Test 3: FORMING_SHORT Early Entry Execution (Symmetry Check)
// -----------------------------------------------------------------------------
console.log("\n--- TEST 3: FORMING_SHORT Early Entry Symmetry ---");
const engine3 = new DirectionStateEngine("TEST_DECOUPLE_3");
createWarmupCandles(15, 100.0).forEach(c => engine3.processCandle(c));

// Candle prints lower high (100.1 < 100.5), seller dominance (taker: 33%), negative CVD, expanding volume (1500 > 1000)
const formingShortCandle: CandleData = {
  time: baseTime + 16 * 60000,
  open: 99.9,
  high: 100.1,
  low: 99.6,
  close: 99.7,
  volume: 1500,
  takerBuyBase: 450
};
const dirDec3 = engine3.processCandle(formingShortCandle);
assert(dirDec3.state === "FORMING_SHORT", "Test 3.1: State is FORMING_SHORT");
assert(dirDec3.canEnter === true, "Test 3.2: canEnter is TRUE for FORMING_SHORT with valid evidence");
assert(dirDec3.entryType === "FORMING_EARLY", "Test 3.3: entryType is FORMING_EARLY");

// Evaluate decoupled execution near EMA21 (100.0), ATR 0.5, RSI 45
const execDecision3 = evaluateDecoupledDecision(dirDec3, formingShortCandle, 100.0, 0.5, 45.0, "TREND_DOWN");
assert(execDecision3.signal === "SHORT", "Test 3.4: Signal is strictly SHORT on FORMING_SHORT");
assert(execDecision3.setupType === "FORMING_EARLY_SHORT", "Test 3.5: Setup type is FORMING_EARLY_SHORT");

// -----------------------------------------------------------------------------
// Test 4: Direction = SHORT + Bad Timing (Oversold/Extended) strictly outputs WAIT (NEVER LONG)
// -----------------------------------------------------------------------------
console.log("\n--- TEST 4: Anti-Flip Rule for SHORT on Oversold Overextension ---");
const extendedShortCandle: CandleData = {
  time: baseTime + 17 * 60000,
  open: 97.8,
  high: 97.9,
  low: 97.0,
  close: 97.2,
  volume: 2200,
  takerBuyBase: 600
};
const execDecision4 = evaluateDecoupledDecision(dirDec3, extendedShortCandle, 100.0, 0.5, 24.0, "TREND_DOWN");
assert(execDecision4.signal === "WAIT", "Test 4.1: Signal is WAIT when short is overextended");
assert(execDecision4.signal !== "LONG", "Test 4.2: ANTI-FLIP: Signal NEVER flips to LONG when short timing is bad");
assert(execDecision4.timingResult?.isLateExpansion === true, "Test 4.3: Correctly flagged as late expansion");

// -----------------------------------------------------------------------------
// Test 5: Dry volume prohibits FORMING entry (Quality Gate)
// -----------------------------------------------------------------------------
console.log("\n--- TEST 5: Dry Volume Invalidation for FORMING Entry ---");
const engine5 = new DirectionStateEngine("TEST_DECOUPLE_5");
createWarmupCandles(15, 100.0).forEach(c => engine5.processCandle(c));

// Candle has bullish price action but volume is dry (only 300 vs avg 1000)
const dryCandle: CandleData = {
  time: baseTime + 16 * 60000,
  open: 100.1,
  high: 100.4,
  low: 99.8,
  close: 100.3,
  volume: 300,
  takerBuyBase: 220
};
const dirDec5 = engine5.processCandle(dryCandle);
assert(dirDec5.state === "FORMING_LONG", "Test 5.1: State is FORMING_LONG");
assert(dirDec5.canEnter === false, "Test 5.2: canEnter is FALSE due to dry volume");
assert(dirDec5.entryType === "NONE", "Test 5.3: entryType is NONE");

const execDecision5 = evaluateDecoupledDecision(dirDec5, dryCandle, 100.0, 0.5, 55.0);
assert(execDecision5.signal === "WAIT", "Test 5.4: Signal is strictly WAIT when canEnter is false");

// -----------------------------------------------------------------------------
// Test 6: Invalidation strictly triggers EXIT and resets to UNKNOWN (Never flips)
// -----------------------------------------------------------------------------
console.log("\n--- TEST 6: Invalidation Lifecycle and Anti-Flip Reset ---");
const engine6 = new DirectionStateEngine("TEST_DECOUPLE_6");
createWarmupCandles(15, 100.0).forEach(c => engine6.processCandle(c));

// Trigger FORMING_LONG
engine6.processCandle({
  time: baseTime + 16 * 60000,
  open: 100.1, high: 100.4, low: 99.8, close: 100.3, volume: 1500, takerBuyBase: 1050
});

// Trigger Breakout & Retest -> CONFIRMED_LONG
engine6.processCandle({
  time: baseTime + 17 * 60000,
  open: 100.3, high: 101.5, low: 100.2, close: 101.4, volume: 2500, takerBuyBase: 1800
});
engine6.processCandle({
  time: baseTime + 18 * 60000,
  open: 101.4, high: 101.4, low: 100.6, close: 101.1, volume: 2000, takerBuyBase: 1200
});

// Trigger Continuation -> EXTENDING_LONG
engine6.processCandle({
  time: baseTime + 19 * 60000,
  open: 101.1, high: 102.5, low: 101.0, close: 102.4, volume: 3000, takerBuyBase: 1900
});

// Trigger Deterioration -> WEAKENING_LONG
engine6.processCandle({
  time: baseTime + 20 * 60000,
  open: 102.4, high: 102.4, low: 100.7, close: 100.8, volume: 2800, takerBuyBase: 1100
});

// Trigger Collapse -> INVALIDATED_LONG
const decInval = engine6.processCandle({
  time: baseTime + 21 * 60000,
  open: 100.8, high: 100.8, low: 99.7, close: 99.8, volume: 3500, takerBuyBase: 1000
});
assert(decInval.state === "INVALIDATED_LONG", "Test 6.1: State transitioned to INVALIDATED_LONG");
assert(decInval.managementAction === "EXIT_INVALIDATED", "Test 6.2: Management action is EXIT_INVALIDATED");

// Next candle: Must reset strictly to UNKNOWN
const decReset = engine6.processCandle({
  time: baseTime + 22 * 60000,
  open: 99.8, high: 99.9, low: 99.5, close: 99.7, volume: 1200, takerBuyBase: 600
});
assert(decReset.state === "UNKNOWN", "Test 6.3: State strictly resets to UNKNOWN");
assert(decReset.direction === "UNKNOWN", "Test 6.4: Direction is UNKNOWN, NEVER flipped directly to SHORT");

console.log("\n======================================================================");
console.log("🎉 ALL DIRECTION DECOUPLING & TIMING TESTS PASSED FLAWLESSLY! (20/20)");
console.log("======================================================================\n");
