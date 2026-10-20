import test from "node:test";
import assert from "node:assert/strict";
import { evaluateExecutionFilter } from "./executionFilter.js";

// This module implements only the two contextual execution restrictions below.
// RANGE, schedule, volume, and strict BTC regime locks belong to the reasoning /
// entry engines; do not invent an obsolete four-argument API to test them here.
for (const asset of ["TRANSITION", "TREND_UP"]) {
  test(`blocks SHORT in BTC BULL_STRONG with asset ${asset}`, () => {
    const result = evaluateExecutionFilter("SHORT", "BULL_STRONG", asset);
    assert.equal(result.allowed, false);
    assert.equal(result.ruleTriggered, "SHORT_IN_BTC_BULL_STRONG");
    assert.match(result.blockedReason!, /BULL_STRONG/);
    assert.ok(result.blockedReason!.includes(asset));
  });
}

for (const asset of ["TRANSITION", "TREND_DOWN"]) {
  test(`blocks LONG in BTC BULL_WEAK with asset ${asset}`, () => {
    const result = evaluateExecutionFilter("LONG", "BULL_WEAK", asset);
    assert.equal(result.allowed, false);
    assert.equal(result.ruleTriggered, "LONG_IN_BTC_BULL_WEAK");
    assert.match(result.blockedReason!, /BULL_WEAK/);
    assert.ok(result.blockedReason!.includes(asset));
  });
}

test("exhaustive matrix preserves all other contextual decisions", () => {
  for (const direction of ["LONG", "SHORT"] as const) {
    for (const btc of ["BULL_STRONG", "BULL_WEAK", "BEAR_STRONG", "BEAR_WEAK", "RANGING", "VIOLENT"]) {
      for (const asset of ["TREND_UP", "TREND_DOWN", "TRANSITION", "RANGE", "HIGH_VOLATILITY"]) {
        const blocked = (direction === "SHORT" && btc === "BULL_STRONG" && ["TRANSITION", "TREND_UP"].includes(asset)) ||
          (direction === "LONG" && btc === "BULL_WEAK" && ["TRANSITION", "TREND_DOWN"].includes(asset));
        const result = evaluateExecutionFilter(direction, btc, asset);
        assert.equal(result.allowed, !blocked, `${direction}/${btc}/${asset}`);
        if (!blocked) {
          assert.equal(result.ruleTriggered, null);
          assert.equal(result.blockedReason, undefined);
        }
      }
    }
  }
});

test("execution filter returns independent deterministic decisions", () => {
  const first = evaluateExecutionFilter("SHORT", "BULL_STRONG", "TRANSITION");
  const second = evaluateExecutionFilter("SHORT", "BULL_STRONG", "TRANSITION");
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  first.allowed = true;
  assert.equal(second.allowed, false);
  assert.equal(evaluateExecutionFilter("SHORT", "BULL_STRONG", "TRANSITION").allowed, false);
});
