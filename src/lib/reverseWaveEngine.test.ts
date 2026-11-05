import assert from "node:assert/strict";
import { evaluateReverseWave } from "./reverseWaveEngine.js";
const now = 1_800_000_000_000;
const common = {
  fromSide: "LONG" as const, candidateSide: "SHORT" as const, entryAllowed: true, structureConfirmed: true, now,
  price: 100, atr: 1,\n  flow: { buyQuote: 20, sellQuote: 80, observedAt: now, buyQuote30s: 20, sellQuote30s: 80, buyQuote1m: 30, sellQuote1m: 170, priceChange30sPct: -0.001, priceChange1mPct: -0.002 },
  cvd5mSlope: -10, cvd15mSlope: -20, cvd4hSlope: 5, oiChange: 0.002, oiPriceChange: -0.002, book: null, liquidation: null
};
const shortReverse = evaluateReverseWave(common);
assert.equal(shortReverse.confirmed, true);
assert.equal(shortReverse.direction, "SHORT");
assert.equal(shortReverse.confirmations.cvd, true);\nassert.equal(shortReverse.confirmations.priceImpact, true, "reverse flow must move price efficiently in ATR terms");
assert.equal(evaluateReverseWave({ ...common, structureConfirmed: false }).confirmed, false, "flow alone must not reverse a trade");\nassert.equal(evaluateReverseWave({ ...common, flow: { ...common.flow, priceChange1mPct: -0.0001 } }).confirmed, false, "strong flow without ATR-normalized price impact must not reverse");
assert.equal(evaluateReverseWave({ ...common, cvd5mSlope: 10, cvd15mSlope: -20, cvd4hSlope: 5 }).confirmed, false, "mixed CVD without another independent domain must not reverse");
const longReverse = evaluateReverseWave({
  ...common, fromSide: "SHORT", candidateSide: "LONG",
  flow: { buyQuote: 80, sellQuote: 20, observedAt: now, buyQuote30s: 80, sellQuote30s: 20, buyQuote1m: 170, sellQuote1m: 30, priceChange30sPct: 0.001, priceChange1mPct: 0.002 },
  cvd5mSlope: 10, cvd15mSlope: 20, cvd4hSlope: -5, oiPriceChange: 0.002
});
assert.equal(longReverse.confirmed, true);
assert.equal(longReverse.direction, "LONG", "reverse logic must be mirrored for LONG");
assert.equal(evaluateReverseWave({ ...common, flow: { ...common.flow, observedAt: now - 60_000 } }).confirmed, false);
console.log("reverseWaveEngine: all tests passed");
