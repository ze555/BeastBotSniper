import assert from "node:assert/strict";
import { calculateWaveStop, estimateNetRiskAtStop, capPositionToRiskBudget } from "./waveRiskEngine.js";

const candles = [
  { high: 101.2, low: 99.4 },
  { high: 101.0, low: 99.1 },
  { high: 101.5, low: 99.3 }
];

const long = calculateWaveStop({
  side: "LONG", entry: 100, atr1m: 1, candles, invalidationLevel: 99.2
});
assert.ok(long);
assert.ok(long!.stop < 99.2);
assert.ok(long!.distance >= 0.7);
assert.ok(long!.distance <= 4);

const short = calculateWaveStop({
  side: "SHORT", entry: 100, atr1m: 1,
  candles: candles.map(c => ({ high: 200 - c.low, low: 200 - c.high })),
  invalidationLevel: 100.8
});
assert.ok(short);
assert.ok(short!.stop > 100.8);
assert.ok(short!.distance >= 0.7);
assert.ok(short!.distance <= 4);

assert.equal(calculateWaveStop({
  side: "LONG", entry: 100, atr1m: 1, candles, invalidationLevel: 101
}), null, "LONG invalidation must be below entry");
assert.equal(calculateWaveStop({
  side: "LONG", entry: 100, atr1m: 1, candles, invalidationLevel: 95
}), null, "excessively distant structure must be rejected");
assert.equal(calculateWaveStop({
  side: "SHORT", entry: 100, atr1m: 0, candles, invalidationLevel: 101
}), null, "invalid ATR must be rejected");

const netRisk = estimateNetRiskAtStop({
  direction: "LONG", entry: 100, stop: 99, position: 10,
  realizedPnl: 0, feeRate: 0.0004, slippageRate: 0.0002
});
assert.ok(netRisk > 10 && netRisk < 11);

const capped = capPositionToRiskBudget({
  proposedPosition: 100, entry: 100, stop: 99,
  availableRisk: 5, feeRate: 0.0004, slippageRate: 0.0002
});
assert.ok(capped > 0 && capped < 5);
assert.equal(capPositionToRiskBudget({
  proposedPosition: 100, entry: 100, stop: 99,
  availableRisk: 0, feeRate: 0.0004, slippageRate: 0.0002
}), 0);

console.log("waveRiskEngine: all tests passed");
