import assert from "node:assert/strict";
import { evaluateEntryQuality } from "./entryQualityEngine.js";
const now = 1_800_000_000_000;
const candles = [
  { open: 100, high: 101, low: 99, close: 100.5 },
  { open: 100.5, high: 102, low: 100, close: 101.5 },
  { open: 101.5, high: 103, low: 101, close: 102.5 }
];
const base = {
  side: "LONG" as const, price: 102.5, atr: 2, now, candles,
  oiChange: 0.002, oiPriceChange: 0.002, cvd5mSlope: 10, cvd15mSlope: 20, cvd4hSlope: 30,
  flow: {
    buyQuote: 70_000, sellQuote: 30_000, tradeCount: 30, observedAt: now,
    source: "BINANCE_AGG_TRADES" as const,
    buyQuote30s: 70_000, sellQuote30s: 30_000, trades30s: 30,
    buyQuote1m: 140_000, sellQuote1m: 60_000, trades1m: 60,
    buyQuote5m: 500_000, sellQuote5m: 250_000, trades5m: 180,
    priceChange30sPct: 0.002, priceChange1mPct: 0.004, priceChange5mPct: 0.006
  }
};
const aligned = evaluateEntryQuality(base);
assert.equal(aligned.allowed, true);
assert.equal(aligned.quality, "FLOW_ALIGNED");
assert.equal(aligned.positioning, "NEW_POSITIONS_WITH_MOVE");
assert.equal(aligned.cvdState, "ALIGNED");
assert.equal(aligned.flow.impulse5s, null, "5s data is not required for entry quality");
const cvdConflict = evaluateEntryQuality({ ...base, cvd5mSlope: -10, cvd15mSlope: -20, cvd4hSlope: 5 });
assert.equal(cvdConflict.allowed, true, "opposing slower CVD is contextual, not an automatic ban on price-confirmed entry");
assert.equal(cvdConflict.cvdState, "OPPOSING");
const oiConflict = evaluateEntryQuality({ ...base, oiChange: 0.01, oiPriceChange: -0.01 });
assert.equal(oiConflict.positioning, "OI_NOT_DIRECTIONAL", "OI expansion without same-period price alignment is not directional evidence");
const conflict = evaluateEntryQuality({ ...base, flow: {
  ...base.flow, buyQuote: 20_000, sellQuote: 80_000, buyQuote30s: 20_000, sellQuote30s: 80_000,
  buyQuote1m: 30_000, sellQuote1m: 170_000, priceChange1mPct: -0.002
} });
assert.equal(conflict.allowed, false);
assert.equal(conflict.quality, "CONFLICTED_FLOW");
const earlyReversal = evaluateEntryQuality({ ...base, flow: {
  ...base.flow, buyQuote30s: 90_000, sellQuote30s: 10_000,
  buyQuote1m: 180_000, sellQuote1m: 20_000,
  buyQuote5m: 250_000, sellQuote5m: 500_000,
  priceChange30sPct: 0.002, priceChange1mPct: 0.002, priceChange5mPct: -0.006
} });
assert.equal(earlyReversal.allowed, true);
assert.equal(earlyReversal.quality, "EARLY_FLOW_REVERSAL");
const late = evaluateEntryQuality({ ...base, price: 112, atr: 2, flow: {
  ...base.flow, buyQuote1m: 51_000, sellQuote1m: 49_000, buyQuote30s: 52_000, sellQuote30s: 48_000,
  priceChange1mPct: 0.0001
} });
assert.equal(late.allowed, false);
assert.equal(late.quality, "LATE_ENTRY");
const absorbed = evaluateEntryQuality({ ...base, flow: { ...base.flow, priceChange1mPct: 0.00001 } });
assert.equal(absorbed.allowed, false, "aggressive flow without a price response is treated as possible absorption");
assert.equal(absorbed.timingGate.state, "NO_PRICE_RESPONSE_ABSORPTION");\nassert.equal(absorbed.quality, "ABSORPTION");\nconst failedAuction = evaluateEntryQuality({ ...base, flow: { ...base.flow, priceChange1mPct: -0.002 } });\nassert.equal(failedAuction.allowed, false);\nassert.equal(failedAuction.quality, "FAILED_AUCTION");\nassert.equal(aligned.flow.priceImpactEfficiency !== null, true, "entry logs expose ATR-normalized price impact efficiency");
const missingOI = evaluateEntryQuality({ ...base, oiChange: null, oiPriceChange: null });
assert.equal(missingOI.allowed, true);
assert.equal(missingOI.positioning, "OI_UNAVAILABLE");
const missingFlow = evaluateEntryQuality({ ...base, flow: null });
assert.equal(missingFlow.allowed, false);
assert.equal(missingFlow.quality, "INSUFFICIENT_DATA");
console.log("entryQualityEngine: all tests passed");
