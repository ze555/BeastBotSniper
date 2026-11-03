import assert from "node:assert/strict";
import { getFuturesTapeFlow, getFuturesWaveCandidates, recordFuturesTrade } from "./futuresWaveFeed.js";

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

const stale = getFuturesTapeFlow("AKEUSDT", now + 60_000);
assert.equal(stale, null, "stale tape must not produce a signal");
console.log("futuresWaveFeed: all tests passed");
