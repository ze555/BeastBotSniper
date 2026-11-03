import assert from "node:assert/strict";
import { evaluateEntryQuality } from "./entryQualityEngine.js";
const now = 1_800_000_000_000;
const candles = [{ open: 100, high: 101, low: 99, close: 100.5 }, { open: 100.5, high: 102, low: 100, close: 101.5 }, { open: 101.5, high: 103, low: 101, close: 102.5 }];
const base = {
  side: "LONG" as const, price: 102.5, atr: 2, now, candles, oiChange: 0.002, oiPriceChange: 0.002,
  flow: { buyQuote: 70_000, sellQuote: 30_000, tradeCount: 30, observedAt: now,
    source: "BINANCE_AGG_TRADES" as const, buyQuote5s: 20_000, sellQuote5s: 2_000, trades5s: 8,
    buyQuote30s: 70_000, sellQuote30s: 30_000, trades30s: 30 }
};
const aligned = evaluateEntryQuality(base);
assert.equal(aligned.allowed, true);
assert.equal(aligned.quality, "FLOW_ALIGNED");
assert.equal(aligned.positioning, "NEW_POSITIONS_WITH_MOVE");
const oiConflict = evaluateEntryQuality({ ...base, oiChange: 0.01, oiPriceChange: -0.01 });
assert.equal(oiConflict.positioning, "OI_NOT_DIRECTIONAL", "OI expansion without same-period price alignment must not be called directional");
const conflict = evaluateEntryQuality({ ...base, flow: { ...base.flow, buyQuote: 20_000, sellQuote: 80_000, buyQuote30s: 20_000, sellQuote30s: 80_000, buyQuote5s: 1_000, sellQuote5s: 9_000 } });
assert.equal(conflict.allowed, false);
assert.equal(conflict.quality, "CONFLICTED_FLOW");
const earlyReversal = evaluateEntryQuality({ ...base, flow: { ...base.flow, buyQuote30s: 30_000, sellQuote30s: 70_000, buyQuote5s: 9_000, sellQuote5s: 1_000 } });
assert.equal(earlyReversal.allowed, true);
assert.equal(earlyReversal.quality, "EARLY_FLOW_REVERSAL");
const late = evaluateEntryQuality({ ...base, price: 112, atr: 2, flow: { ...base.flow, buyQuote5s: 1_000, sellQuote5s: 9_000 } });
assert.equal(late.allowed, false);
assert.equal(late.quality, "LATE_ENTRY");
const missingOI = evaluateEntryQuality({ ...base, oiChange: null, oiPriceChange: null });
assert.equal(missingOI.allowed, true);
assert.equal(missingOI.positioning, "OI_UNAVAILABLE");
const missingFlow = evaluateEntryQuality({ ...base, flow: null });
assert.equal(missingFlow.allowed, false);
assert.equal(missingFlow.quality, "INSUFFICIENT_DATA");
console.log("entryQualityEngine: all tests passed");
