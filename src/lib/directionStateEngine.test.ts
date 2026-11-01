import { 
  DirectionStateEngine, 
  CandleData, 
  evaluateDirectionTiming 
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
console.log("🧪 MANDATORY VALIDATION TEST HARNESS (TESTS A THROUGH L)");
console.log("======================================================================");

const baseTime = 1790848560000;
let price = 100.0;

function createWarmupCandles(count: number = 15): CandleData[] {
  const arr: CandleData[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      time: baseTime + i * 60000,
      open: 100.0,
      high: 100.5,
      low: 99.5,
      close: 100.0,
      volume: 1000,
      takerBuyBase: 500
    });
  }
  return arr;
}

// -----------------------------------------------------------------------------
// Test A: UNKNOWN + bullish evidence → FORMING_LONG
// -----------------------------------------------------------------------------
const engineA = new DirectionStateEngine("TEST_A");
createWarmupCandles(15).forEach(c => engineA.processCandle(c));
assert(engineA.state === "UNKNOWN", "Pre-condition: State is UNKNOWN");

const candleA: CandleData = {
  time: baseTime + 16 * 60000,
  open: 100.1,
  high: 100.4,
  low: 99.8, // Higher low > 99.5
  close: 100.3, // Reclaimed EMA21, approaching resistance 100.5
  volume: 1500,
  takerBuyBase: 1000 // 66.7% buyer dominant, positive CVD
};
const decA = engineA.processCandle(candleA);
assert(decA.state === "FORMING_LONG", "Test A: UNKNOWN + bullish evidence -> FORMING_LONG");

// -----------------------------------------------------------------------------
// Test B: FORMING_LONG + stronger confirmation → CONFIRMED_LONG
// -----------------------------------------------------------------------------
// Breakout above 100.5
const candleBreakout: CandleData = {
  time: baseTime + 17 * 60000,
  open: 100.3,
  high: 101.5,
  low: 100.2,
  close: 101.4,
  volume: 2500,
  takerBuyBase: 1800
};
engineA.processCandle(candleBreakout);

// Retest holding above 100.5
const candleRetest: CandleData = {
  time: baseTime + 18 * 60000,
  open: 101.4,
  high: 101.4,
  low: 100.6,
  close: 101.1,
  volume: 2000,
  takerBuyBase: 1200
};
const decB = engineA.processCandle(candleRetest);
assert(decB.state === "CONFIRMED_LONG", "Test B: FORMING_LONG + breakout + retest -> CONFIRMED_LONG");

// -----------------------------------------------------------------------------
// Test C: CONFIRMED_LONG + continuation → EXTENDING_LONG
// -----------------------------------------------------------------------------
const candleC: CandleData = {
  time: baseTime + 19 * 60000,
  open: 101.1,
  high: 102.5, // Higher High
  low: 101.0,
  close: 102.4,
  volume: 3000,
  takerBuyBase: 1900
};
const decC = engineA.processCandle(candleC);
assert(decC.state === "EXTENDING_LONG", "Test C: CONFIRMED_LONG + higher high continuation -> EXTENDING_LONG");

// -----------------------------------------------------------------------------
// Test D: EXTENDING_LONG + deterioration → WEAKENING_LONG
// -----------------------------------------------------------------------------
const candleD: CandleData = {
  time: baseTime + 20 * 60000,
  open: 102.4,
  high: 102.4,
  low: 100.7,
  close: 100.8, // Dips below EMA9 (100.95) with heavy seller flow
  volume: 2800,
  takerBuyBase: 1100 // 39% taker
};
const decD = engineA.processCandle(candleD);
assert(decD.state === "WEAKENING_LONG", "Test D: EXTENDING_LONG + deterioration -> WEAKENING_LONG");
assert(decD.managementAction === "TIGHTEN_PROTECT", "Test D: Management action is TIGHTEN_PROTECT");

// -----------------------------------------------------------------------------
// Test E: WEAKENING_LONG + thesis failure → INVALIDATED_LONG
// -----------------------------------------------------------------------------
const candleE: CandleData = {
  time: baseTime + 21 * 60000,
  open: 100.8,
  high: 100.8,
  low: 99.7,
  close: 99.8, // Below EMA21 / former structure
  volume: 3500,
  takerBuyBase: 1000
};
const decE = engineA.processCandle(candleE);
assert(decE.state === "INVALIDATED_LONG", "Test E: WEAKENING_LONG + thesis failure -> INVALIDATED_LONG");
assert(decE.managementAction === "EXIT_INVALIDATED", "Test E: Management action is EXIT_INVALIDATED");

// -----------------------------------------------------------------------------
// Test F: INVALIDATED_LONG → لا يتحول مباشرة إلى SHORT. يجب أن يصبح UNKNOWN.
// -----------------------------------------------------------------------------
const candleF: CandleData = {
  time: baseTime + 22 * 60000,
  open: 99.8,
  high: 99.9,
  low: 99.5,
  close: 99.7,
  volume: 1200,
  takerBuyBase: 600
};
const decF = engineA.processCandle(candleF);
assert(decF.state === "UNKNOWN", "Test F: INVALIDATED_LONG strictly resets to UNKNOWN (Anti Flip-Flop)");
assert(decF.direction === "UNKNOWN", "Test F: Direction is UNKNOWN, not flipped to SHORT");

// -----------------------------------------------------------------------------
// Test G: UNKNOWN + bearish evidence → FORMING_SHORT
// -----------------------------------------------------------------------------
const engineG = new DirectionStateEngine("TEST_G");
createWarmupCandles(15).forEach(c => engineG.processCandle(c));

const candleG: CandleData = {
  time: baseTime + 16 * 60000,
  open: 99.9,
  high: 100.1, // Lower high < 100.5
  low: 99.6,
  close: 99.7, // Below EMA21, approaching support 99.5
  volume: 1500,
  takerBuyBase: 500 // Only 33% taker buyers, negative CVD
};
const decG = engineG.processCandle(candleG);
assert(decG.state === "FORMING_SHORT", "Test G: UNKNOWN + bearish evidence -> FORMING_SHORT");

// -----------------------------------------------------------------------------
// Test H: SHORT lifecycle symmetrical (BREAKDOWN -> CONFIRMED -> EXTENDING -> WEAKENING -> INVALIDATED)
// -----------------------------------------------------------------------------
// Breakdown
engineG.processCandle({
  time: baseTime + 17 * 60000,
  open: 99.7,
  high: 99.8,
  low: 98.5,
  close: 98.6,
  volume: 2600,
  takerBuyBase: 800
});

// Retest from below
const decH_Conf = engineG.processCandle({
  time: baseTime + 18 * 60000,
  open: 98.6,
  high: 99.4,
  low: 98.5,
  close: 98.9,
  volume: 2000,
  takerBuyBase: 900
});
assert(decH_Conf.state === "CONFIRMED_SHORT", "Test H1: Breakdown + Retest -> CONFIRMED_SHORT");

// Extension short
const decH_Ext = engineG.processCandle({
  time: baseTime + 19 * 60000,
  open: 98.9,
  high: 98.9,
  low: 97.5,
  close: 97.6, // Lower low
  volume: 3200,
  takerBuyBase: 1000
});
assert(decH_Ext.state === "EXTENDING_SHORT", "Test H2: Lower low continuation -> EXTENDING_SHORT");

// Weakening short
const decH_Weak = engineG.processCandle({
  time: baseTime + 20 * 60000,
  open: 97.6,
  high: 99.3,
  low: 97.5,
  close: 99.2, // Crosses above EMA9 with buyer volume
  volume: 2500,
  takerBuyBase: 1600
});
assert(decH_Weak.state === "WEAKENING_SHORT", "Test H3: Aggressive buyers step in -> WEAKENING_SHORT");

// Invalidation short
const decH_Inv = engineG.processCandle({
  time: baseTime + 21 * 60000,
  open: 99.2,
  high: 100.4,
  low: 99.2,
  close: 100.2, // Reclaims structure above EMA21
  volume: 3500,
  takerBuyBase: 2400
});
assert(decH_Inv.state === "INVALIDATED_SHORT", "Test H4: Reclaims resistance -> INVALIDATED_SHORT");

// Anti flip-flop for short
const decH_Reset = engineG.processCandle({
  time: baseTime + 22 * 60000,
  open: 100.2,
  high: 100.3,
  low: 100.0,
  close: 100.1,
  volume: 1200,
  takerBuyBase: 600
});
assert(decH_Reset.state === "UNKNOWN", "Test H5: Reset to UNKNOWN (Never directly to LONG)");

// -----------------------------------------------------------------------------
// Test I: LONG direction + bad timing → WAIT وليس SHORT
// -----------------------------------------------------------------------------
const badTimingLongCandle: CandleData = {
  time: baseTime + 30 * 60000,
  open: 104.0,
  high: 106.0,
  low: 103.8,
  close: 105.8, // Severely over-extended 4 ATRs above EMA21
  volume: 2000
};
const timingLongResult = evaluateDirectionTiming("LONG", badTimingLongCandle, 100.0, 1.2, 78.0);
assert(timingLongResult.canExecute === false, "Test I: canExecute is false during over-extension");
assert(timingLongResult.timingAction === "WAIT", "Test I: Timing action is WAIT, NEVER SHORT");
assert(timingLongResult.isLateExpansion === true, "Test I: Correctly flagged as late expansion");

// -----------------------------------------------------------------------------
// Test J: SHORT direction + bad timing → WAIT وليس LONG
// -----------------------------------------------------------------------------
const badTimingShortCandle: CandleData = {
  time: baseTime + 31 * 60000,
  open: 95.0,
  high: 95.2,
  low: 93.0,
  close: 93.2, // Severely over-extended downward 4 ATRs below EMA21
  volume: 2000
};
const timingShortResult = evaluateDirectionTiming("SHORT", badTimingShortCandle, 99.0, 1.2, 22.0);
assert(timingShortResult.canExecute === false, "Test J: canExecute is false during over-extension");
assert(timingShortResult.timingAction === "WAIT", "Test J: Timing action is WAIT, NEVER LONG");
assert(timingShortResult.isLateExpansion === true, "Test J: Correctly flagged as late expansion");

// -----------------------------------------------------------------------------
// Test K: FORMING_LONG مع evidence chain كافية → يسمح بالدخول المبكر
// -----------------------------------------------------------------------------
const engineK = new DirectionStateEngine("TEST_K");
createWarmupCandles(15).forEach(c => engineK.processCandle(c));

// Candle with complete evidence chain (Volume expanding RVOL > 1.2, Taker > 65%, CVD positive, Higher Low)
const goodEvidenceCandle: CandleData = {
  time: baseTime + 16 * 60000,
  open: 100.1,
  high: 100.4,
  low: 99.8,
  close: 100.3,
  volume: 1600, // RVOL 1.6x
  takerBuyBase: 1100 // 68.7% Taker buyer dominance
};
const decK = engineK.processCandle(goodEvidenceCandle);
assert(decK.state === "FORMING_LONG", "Test K: State is FORMING_LONG");
assert(decK.canEnter === true, "Test K: canEnter is TRUE for FORMING_LONG with complete evidence chain");
assert(decK.entryType === "FORMING_EARLY", "Test K: entryType is FORMING_EARLY");

// -----------------------------------------------------------------------------
// Test L: FORMING_LONG مع evidence غير كافية (Volume DRY) → WAIT
// -----------------------------------------------------------------------------
const engineL = new DirectionStateEngine("TEST_L");
createWarmupCandles(15).forEach(c => engineL.processCandle(c));

// Candle with DRY volume (Volume 300, RVOL = 0.3x < 0.75 floor)
const dryVolumeCandle: CandleData = {
  time: baseTime + 16 * 60000,
  open: 100.1,
  high: 100.4,
  low: 99.8,
  close: 100.3,
  volume: 300, // RVOL 0.3x -> DRY!
  takerBuyBase: 200
};
const decL = engineL.processCandle(dryVolumeCandle);
assert(decL.state === "FORMING_LONG", "Test L: State is FORMING_LONG");
assert(decL.canEnter === false, "Test L: canEnter is FALSE due to DRY volume");
assert(decL.entryType === "NONE", "Test L: entryType is NONE (WAIT, early entry prohibited)");

console.log("======================================================================");
console.log("🎉 ALL MANDATORY TESTS A THROUGH L PASSED WITH ZERO FAILURES! (12/12)");
console.log("======================================================================");
