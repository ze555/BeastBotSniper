import { DirectionStateEngine, CandleData } from "./directionStateEngine";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ [PASS] ${message}`);
  }
}

console.log("=======================================================");
console.log("🧪 RUNNING DIRECTION STATE MACHINE TEST SUITE");
console.log("=======================================================");

const engine = new DirectionStateEngine("BTCUSDT");

// 1. Initial State
assert(engine.state === "UNKNOWN", "Initial state is UNKNOWN");

// 2. Generate 20 consolidation candles (Warmup)
const baseTime = 1790848560000;
const candles: CandleData[] = [];
let price = 100.0;

for (let i = 0; i < 20; i++) {
  candles.push({
    time: baseTime + i * 60000,
    open: price,
    high: price + 0.5,
    low: price - 0.5,
    close: price,
    volume: 1000,
    takerBuyBase: 500
  });
}

// Feed 15 candles (warmup)
for (let i = 0; i < 15; i++) {
  engine.processCandle(candles[i]);
}
assert(engine.state === "UNKNOWN", "State remains UNKNOWN during warmup");

// 3. Form Higher Low with bullish flow -> Trigger FORMING_LONG
// Price forms higher low at 99.8 (above swing low 99.5), closes at 100.3 (below swing high 100.5)
const hlCandle: CandleData = {
  time: baseTime + 16 * 60000,
  open: 100.1,
  high: 100.4,
  low: 99.8, // Higher than swing low (99.5)
  close: 100.3, // Approaching resistance (100.5)
  volume: 1500,
  takerBuyBase: 1000 // 66.7% buyer dominance
};
let dec = engine.processCandle(hlCandle);
assert(engine.state === "FORMING_LONG", "Higher Low + Bullish Flow triggers FORMING_LONG");
assert(dec.canEnter === true, "canEnter is true during FORMING_LONG");
assert(dec.entryType === "FORMING_EARLY", "entryType is FORMING_EARLY");
assert(engine.breakoutLevel !== null && engine.breakoutLevel === 100.5, "Breakout level is correctly set to swing high (100.5)");

// 4. Breakout above resistance
const boCandle: CandleData = {
  time: baseTime + 17 * 60000,
  open: 100.3,
  high: 101.5,
  low: 100.2,
  close: 101.4, // Clean breakout above swing high (100.5)
  volume: 2500,
  takerBuyBase: 1800
};
dec = engine.processCandle(boCandle);
assert(engine.breakoutHappened === true, "Breakout is recognized");

// 5. Successful Retest holding former resistance -> Triggers CONFIRMED_LONG
const retestCandle: CandleData = {
  time: baseTime + 18 * 60000,
  open: 101.4,
  high: 101.4,
  low: 100.6, // Pullback near broken resistance (100.5)
  close: 101.1, // Held above former resistance
  volume: 2000,
  takerBuyBase: 1200
};
dec = engine.processCandle(retestCandle);
assert(engine.state === "CONFIRMED_LONG", "Successful Retest + Volume triggers CONFIRMED_LONG");
assert(dec.canEnter === true, "canEnter is true during CONFIRMED_LONG");
assert(dec.entryType === "CONFIRMED_STANDARD", "entryType is CONFIRMED_STANDARD");

// 6. Trend Extension -> Higher Highs
const extCandle: CandleData = {
  time: baseTime + 19 * 60000,
  open: 101.1,
  high: 102.5, // New Higher High
  low: 101.0,
  close: 102.4,
  volume: 3000,
  takerBuyBase: 1900
};
dec = engine.processCandle(extCandle);
assert(engine.state === "EXTENDING_LONG", "New Higher High triggers EXTENDING_LONG");
assert(dec.managementAction === "HOLD", "Management action is HOLD during EXTENDING_LONG");

// 7. Weakening -> Sellers step in, dip under EMA9
const weakCandle: CandleData = {
  time: baseTime + 20 * 60000,
  open: 102.4,
  high: 102.4,
  low: 100.7,
  close: 100.8, // Dips below EMA9 (100.95)
  volume: 2800,
  takerBuyBase: 1100 // Taker buy drops to 39%
};
dec = engine.processCandle(weakCandle);
assert(engine.state === "WEAKENING_LONG", "Loss of momentum + aggressive selling triggers WEAKENING_LONG");
assert(dec.managementAction === "TIGHTEN_PROTECT", "Management action is TIGHTEN_PROTECT during WEAKENING_LONG");

// 8. Invalidation -> Support lost, drops under EMA21
const invCandle: CandleData = {
  time: baseTime + 21 * 60000,
  open: 101.3,
  high: 101.3,
  low: 99.8,
  close: 99.9, // Breaches structure
  volume: 3500,
  takerBuyBase: 1000
};
dec = engine.processCandle(invCandle);
assert(engine.state === "INVALIDATED_LONG", "Structural breakdown triggers INVALIDATED_LONG");
assert(dec.managementAction === "EXIT_INVALIDATED", "Management action is EXIT_INVALIDATED");

// 9. Anti Flip-Flop Rule: Next candle resets to UNKNOWN, NOT directly to SHORT!
const nextCandle: CandleData = {
  time: baseTime + 22 * 60000,
  open: 99.9,
  high: 100.0,
  low: 99.6,
  close: 99.8,
  volume: 1200,
  takerBuyBase: 600
};
dec = engine.processCandle(nextCandle);
assert(engine.state === "UNKNOWN", "Anti Flip-Flop: State resets to UNKNOWN rather than jumping straight to SHORT");

// 10. Symmetric Test for SHORT side
engine.reset();
for (let i = 0; i < 15; i++) {
  engine.processCandle(candles[i]);
}

// Lower High with bearish flow -> FORMING_SHORT
const lhCandle: CandleData = {
  time: baseTime + 16 * 60000,
  open: 99.9,
  high: 100.1, // Lower than swing high (100.5)
  low: 99.6, // Above swing low (99.5)
  close: 99.7, // Below EMA21, approaching support
  volume: 1500,
  takerBuyBase: 500 // Only 33% taker buyers
};
dec = engine.processCandle(lhCandle);
assert(engine.state === "FORMING_SHORT", "Lower High + Bearish Flow triggers FORMING_SHORT");
assert(dec.canEnter === true && dec.entryType === "FORMING_EARLY", "Short entry allowed at FORMING_SHORT");

// Breakdown below support
const bdCandle: CandleData = {
  time: baseTime + 17 * 60000,
  open: 99.7,
  high: 99.8,
  low: 98.5,
  close: 98.6, // Breakdown below 99.5
  volume: 2600,
  takerBuyBase: 800
};
engine.processCandle(bdCandle);
assert(engine.breakoutHappened === true, "Breakdown is recognized");

// Retest from below
const retestShortCandle: CandleData = {
  time: baseTime + 18 * 60000,
  open: 98.6,
  high: 99.4, // Pullback near broken support (99.5)
  low: 98.5,
  close: 98.9, // Rejected below level
  volume: 2000,
  takerBuyBase: 900
};
dec = engine.processCandle(retestShortCandle);
assert(engine.state === "CONFIRMED_SHORT", "Successful Breakdown Retest triggers CONFIRMED_SHORT");
assert(dec.entryType === "CONFIRMED_STANDARD", "entryType is CONFIRMED_STANDARD for short");

// Extension short
const extShortCandle: CandleData = {
  time: baseTime + 19 * 60000,
  open: 98.9,
  high: 98.9,
  low: 97.5,
  close: 97.6,
  volume: 3200,
  takerBuyBase: 1000
};
dec = engine.processCandle(extShortCandle);
assert(engine.state === "EXTENDING_SHORT", "New Lower Low triggers EXTENDING_SHORT");

// Weakening short
const weakShortCandle: CandleData = {
  time: baseTime + 20 * 60000,
  open: 97.6,
  high: 99.3,
  low: 97.5,
  close: 99.2, // Crosses above EMA9 (99.04) with buyer absorption
  volume: 2500,
  takerBuyBase: 1600 // Strong buyers step in (64% taker buy)
};
dec = engine.processCandle(weakShortCandle);
assert(engine.state === "WEAKENING_SHORT", "Aggressive buyer absorption triggers WEAKENING_SHORT");
assert(dec.managementAction === "TIGHTEN_PROTECT", "Management action is TIGHTEN_PROTECT for short");

// Invalidation short
const invShortCandle: CandleData = {
  time: baseTime + 21 * 60000,
  open: 98.7,
  high: 100.4,
  low: 98.7,
  close: 100.2, // Breaks above resistance
  volume: 3500,
  takerBuyBase: 2400
};
dec = engine.processCandle(invShortCandle);
assert(engine.state === "INVALIDATED_SHORT", "Break of resistance triggers INVALIDATED_SHORT");
assert(dec.managementAction === "EXIT_INVALIDATED", "Management action is EXIT_INVALIDATED for short");

console.log("=======================================================");
console.log("📊 DIRECTION STATE MACHINE TEST SUITE: ALL PASSED (0 FAILED)");
console.log("=======================================================");
