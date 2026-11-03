import assert from "node:assert/strict";
import { getFuturesTapeFlow, getFuturesWaveCandidates, recordFuturesTrade, getFuturesLiquidationFlow, recordFuturesLiquidation } from "./futuresWaveFeed.js";

const now = 1_800_000_000_000;
for (let i = 0; i < 12; i++) {
  recordFuturesTrade("AKEUSDT", {
    price: 1 - i * 0.001, quantity: 5_000, quote: (1 - i * 0.001) * 5_000,
    buyerIsMaker: true, timestamp: now - 10_000 + i * 500
  });
}
const flow = getFuturesTapeFlow("AKEUSDT", now);
assert.ok(flow, "fresh Futures tape should return a rolling flow snapshot");
assert.ok(flow!.sellQuote > flow!.buyQuote, "seller aggressors must be classified from buyer-is-maker");
assert.equal(flow!.trades5s, 2);
assert.ok(getFuturesWaveCandidates(now).includes("AKEUSDT"), "violent downward Futures impulse should enter the candidate queue");

recordFuturesLiquidation("AKEUSDT", "LONG_LIQUIDATION", 12_500, now);
recordFuturesLiquidation("AKEUSDT", "SHORT_LIQUIDATION", 2_000, now);
const liquidations = getFuturesLiquidationFlow("AKEUSDT", now);
assert.ok(liquidations, "recent force-order events should be exposed as real liquidation evidence");
assert.equal(liquidations!.longLiquidationQuote, 12_500);
assert.equal(liquidations!.shortLiquidationQuote, 2_000);
assert.equal(liquidations!.source, "BINANCE_FORCE_ORDER");

const stale = getFuturesTapeFlow("AKEUSDT", now + 60_000);
assert.equal(stale, null, "stale tape must not produce a signal");
console.log("futuresWaveFeed: all tests passed");
