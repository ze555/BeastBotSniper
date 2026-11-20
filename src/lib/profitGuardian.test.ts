import assert from "node:assert/strict";
import { evaluateProfitGuardian } from "./profitGuardian.js";

const long = { direction: "LONG" as const, entry: 100, initialStop: 98, currentStop: 98, peakR: 0 };
const short = { direction: "SHORT" as const, entry: 100, initialStop: 102, currentStop: 102, peakR: 0 };

// The hard stop is always active, even before the new profit guardian arms.
assert.equal(evaluateProfitGuardian({ ...long, price: 98 }).action, "EXIT");
assert.equal(evaluateProfitGuardian({ ...short, price: 102 }).action, "EXIT");

const preArm = evaluateProfitGuardian({ ...long, price: 100.8 });
assert.equal(preArm.armed, false);
assert.equal(preArm.stop, 98);
assert.equal(preArm.action, "HOLD");

const peakLong = evaluateProfitGuardian({ ...long, price: 101 });
assert.equal(peakLong.armed, true);
assert.ok(Math.abs(peakLong.stop - 100.6) < 1e-10);
assert.equal(peakLong.action, "HOLD");

// A later pullback must never move the stop back down.
const falling = evaluateProfitGuardian({ ...long, price: 100.4, peakR: peakLong.peakR, currentStop: peakLong.stop });
assert.equal(falling.action, "EXIT");
assert.ok(falling.stop >= peakLong.stop);

const peakShort = evaluateProfitGuardian({ ...short, price: 99 });
assert.equal(peakShort.armed, true);
assert.ok(Math.abs(peakShort.stop - 99.4) < 1e-10);
const shortPullback = evaluateProfitGuardian({ ...short, price: 99.6, currentStop: peakShort.stop, peakR: peakShort.peakR });
assert.equal(shortPullback.action, "EXIT");
assert.ok(shortPullback.stop <= peakShort.stop);

assert.equal(evaluateProfitGuardian({ ...long, price: NaN }).reason, "INVALID_INPUT");
assert.equal(evaluateProfitGuardian({ ...long, initialStop: 101, price: 101 }).reason, "INVALID_INPUT");
assert.equal(evaluateProfitGuardian({ ...long, price: 105, peakR: 2, currentStop: 101 }).action, "HOLD");
console.log("Unified Profit Guardian unit tests passed");
