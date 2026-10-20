import test from "node:test";
import assert from "node:assert/strict";
import {
  closedCandles,
  planTargets,
  adverseFlow,
  exhaustionScore,
} from "./tradeSafety.js";

const now = 1_700_000_000_000;

test("closedCandles excludes malformed and live boundary timestamps", () => {
  const candles = [
    { closeTime: now - 1, id: "closed" },
    { closeTime: now, id: "boundary" },
    { closeTime: now + 1, id: "live" },
    { closeTime: Number.NaN, id: "nan" },
    { closeTime: Number.POSITIVE_INFINITY, id: "infinite" },
    { closeTime: "bad" as unknown as number, id: "malformed" },
  ];
  assert.deepEqual(closedCandles(candles, now).map(c => c.id), ["closed"]);
});

function structure(direction: "LONG" | "SHORT") {
  const candles = Array.from({ length: 12 }, (_, i) => ({
    high: direction === "LONG" ? 103 + (i % 2) : 100 + (i % 2),
    low: direction === "LONG" ? 97 - (i % 2) : 97 - (i % 2),
  }));
  // A confirmed two-sided swing with ample headroom.
  if (direction === "LONG") {
    candles[5] = { high: 120, low: 99 };
    candles[3].high = 108; candles[4].high = 109;
    candles[6].high = 110; candles[7].high = 108;
  } else {
    candles[5] = { high: 101, low: 80 };
    candles[3].low = 91; candles[4].low = 90;
    candles[6].low = 89; candles[7].low = 91;
  }
  return candles;
}

test("planTargets rejects missing, near, and malformed structural targets", () => {
  const base = { atr14: 1, klines: [] };
  assert.equal(planTargets("LONG", base, 100, 95, 0, 0), null, "missing structure");
  const near = structure("LONG").map(c => ({ ...c }));
  near[5].high = 108;
  assert.equal(planTargets("LONG", { atr14: 1, klines: near }, 100, 95, 0, 0), null, "near obstacle");
  assert.equal(planTargets("LONG", { atr14: Number.NaN, klines: structure("LONG") }, 100, 95, 0, 0), null, "invalid ATR");
});

test("planTargets mirrors short structure and includes fees/slippage in weighted net R", () => {
  const long = planTargets("LONG", { atr14: 1, klines: structure("LONG") }, 100, 95, 0.0004, 0.0002);
  const short = planTargets("SHORT", { atr14: 1, klines: structure("SHORT") }, 100, 105, 0.0004, 0.0002);
  assert.ok(long && short);
  assert.equal(long!.targets.length, 3);
  assert.equal(short!.targets.length, 3);
  assert.ok(long!.netRR >= 2.5 && short!.netRR >= 2.5);
  assert.ok(long!.targets.every((x: number) => x > 100));
  assert.ok(short!.targets.every((x: number) => x < 100));
  assert.ok(long!.netRR < long!.structuralR, "fees/slippage reduce planned reward");
});

test("adverseFlow is directional and does not confuse bearish flow with short flow", () => {
  const p = { adx: 30, di_plus: 10, di_minus: 25 };
  assert.equal(adverseFlow("LONG", p, {}), true);
  assert.equal(adverseFlow("SHORT", p, {}), false);
  assert.equal(adverseFlow("SHORT", { adx: 30, di_plus: 25, di_minus: 10 }, {}), true);
  assert.equal(adverseFlow("LONG", { adx: 10, di_plus: 10, di_minus: 10 }, { scenario: "INST_LONG" }), false);
});

function exhaustionFixture(direction: "LONG" | "SHORT", scoreParts: boolean) {
  const klines = Array.from({ length: 14 }, (_, i) => ({
    high: direction === "LONG" ? 100 + i * 0.1 : 101,
    low: direction === "SHORT" ? 100 - i * 0.1 : 99,
    close: 100,
  }));
  return {
    klines,
    hist: scoreParts
      ? (direction === "LONG" ? [3, 2, 1, 0] : [0, 1, 2, 3])
      : [1, 2, 3, 4],
    price: scoreParts ? (direction === "LONG" ? 102 : 98) : (direction === "LONG" ? 100.5 : 99.5),
    u_wick: scoreParts && direction === "LONG" ? 2 : 0,
    l_wick: scoreParts && direction === "SHORT" ? 2 : 0,
    body: 0.5,
    atr14: 1,
  };
}

test("exhaustion score reaches both directional endpoints 0..5", () => {
  for (const direction of ["LONG", "SHORT"] as const) {
    const zero = exhaustionScore(direction, exhaustionFixture(direction, false), { fund: 0 });
    const five = exhaustionScore(direction, exhaustionFixture(direction, true), { fund: direction === "LONG" ? 0.001 : -0.001 });
    assert.equal(zero, 0);
    assert.equal(five, 5);
    assert.ok(five >= 0 && five <= 5);
  }
});
