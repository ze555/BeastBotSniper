import assert from "node:assert/strict";
import { evaluateMarketAlignment, resetMarketAlignmentState } from "./marketAlignmentEngine.js";
const series = (base: number, step: number, n = 12) => Array.from({ length: n }, (_, i) => ({
  openTime: i * 60_000, open: base + i * step, close: base + (i + 1) * step,
  high: base + (i + 1) * step + Math.abs(step) * 0.2,
  low: base + i * step - Math.abs(step) * 0.2
}));
const base = { side: "LONG" as const, symbol: "TESTUSDT", candles4h: series(100, -1), candles15m: series(100, -0.2),
  candles5m: series(97, 0.2), candles1m: series(98, -0.05), price: 100, atr1m: 0.2,
  flowImbalance30s: 0.2, flowImbalance1m: 0.2, now: 1_000_000 };
resetMarketAlignmentState();
const wait = evaluateMarketAlignment(base);
assert.equal(wait.allowed, false);
assert.equal(wait.state, "COUNTERTREND_WAIT_BREAK");
const breakoutCandles = [...base.candles1m.slice(0, -1), { openTime: 12 * 60_000, open: 98.0, high: 99.8, low: 98.0, close: 99.7 }];
const breakout = evaluateMarketAlignment({ ...base, candles1m: breakoutCandles, now: 1_000_015 });
assert.equal(breakout.allowed, false);
assert.equal(breakout.state, "COUNTERTREND_WAIT_RETEST");
const sameCandle = evaluateMarketAlignment({ ...base, candles1m: breakoutCandles, now: 1_000_020 });
assert.equal(sameCandle.allowed, false, "the same 1m candle that broke structure cannot also count as a retest");
const retestCandles = [...breakoutCandles.slice(0, -1), { openTime: 13 * 60_000, open: 97.9, high: 98.0, low: 97.75, close: 97.85 }];
const retest = evaluateMarketAlignment({ ...base, candles1m: retestCandles, now: 1_000_030 });
assert.equal(retest.allowed, true);
assert.equal(retest.state, "COUNTERTREND_CONFIRMED");
const aligned = evaluateMarketAlignment({ ...base, candles4h: series(100, 1), candles15m: series(100, 0.2), candles5m: series(100, 0.2), now: 1_000_100 });
assert.equal(aligned.allowed, true);
const btcOpposed = evaluateMarketAlignment({ ...base, symbol: "BTC-OPPOSED", candles4h: series(100, 1), candles15m: series(100, 0.2),
  candles5m: series(100, 0.2), btcCandles4h: series(100, 0.01), btcCandles15m: series(100, 0.01), btcRegime: "BEAR_STRONG", now: 1_000_200 });
assert.equal(btcOpposed.allowed, false);
assert.equal(btcOpposed.state, "COUNTERTREND_WAIT_BREAK");
const isolatedSymbol = evaluateMarketAlignment({ ...base, symbol: "OTHERUSDT", candles1m: breakoutCandles, now: 1_000_025 });
assert.equal(isolatedSymbol.state, "COUNTERTREND_WAIT_RETEST");
console.log("marketAlignmentEngine tests passed");
