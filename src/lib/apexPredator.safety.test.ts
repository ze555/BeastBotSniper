import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { fetchKl, readPrice, executeTrade, exitBrain, getTrades, getClosedTrades, getStats, isActive, setConfig, setActive, runApexLoop } from "./apexPredator.js";

const API = "https://fapi.binance.com";
const originalGet = (axios as any).get;

test.afterEach(() => {
  (axios as any).get = originalGet;
});

function rawCandle(i: number, closeTime: number, price = 100) {
  return [i * 60_000, String(price), String(price + 1), String(price - 1), String(price), "1000", closeTime, "100000", "10", "500"];
}
function rawSeries(n = 210, price = 100) {
  const now = Date.now();
  return Array.from({ length: n }, (_, i) => rawCandle(i, now - (n - i) * 60_000, price));
}
function strictGet(handler: (url: string, config?: any) => any) {
  (axios as any).get = async (url: string, config?: any) => handler(url, config);
}

test("fetchKl filters live explosive last candle and keeps exact limit", async () => {
  const symbol = "SAFETYFETCHUSDT";
  let calls = 0;
  strictGet((url, config) => {
    assert.equal(url, `${API}/fapi/v1/klines`);
    assert.deepEqual(config.params, { symbol, interval: "15m", limit: 211 });
    calls++;
    const rows = rawSeries(210, 100);
    rows.push(rawCandle(211, Date.now() + 60_000, 9999));
    return { data: rows };
  });
  const result = await fetchKl(symbol, "15m", 210);
  assert.equal(calls, 1);
  assert.equal(result.length, 210);
  assert.ok(result.every(c => c.close !== 9999));
});

test("fetchKl re-fetches across a live candle close instead of exposing a stale cache snapshot", async () => {
  const symbol = "SAFETYCACHEBOUNDARYUSDT";
  const realNow = Date.now;
  let clock = 1_800_000_000_000;
  let calls = 0;
  Date.now = () => clock;
  try {
    strictGet((url) => {
      assert.equal(url, `${API}/fapi/v1/klines`);
      calls++;
      const rows = rawSeries(210, calls === 1 ? 100 : 101);
      rows[rows.length - 1][6] = clock + 100;
      return { data: rows };
    });
    const first = await fetchKl(symbol, "5m", 210);
    clock += 200;
    const second = await fetchKl(symbol, "5m", 210);
    assert.equal(calls, 1, "confirmed-only cache remains safe across the close boundary");
    assert.equal(first[first.length - 1].close, second[second.length - 1].close);
  } finally {
    Date.now = realNow;
  }
});

test("readPrice rejects insufficient ATR/warmup input instead of fabricating indicators", async () => {
  await assert.rejects(() => readPrice("SHORTWARMUP", rawSeries(49).map((k: any[]) => ({ openTime: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closeTime: k[6] }))), /Insufficient klines/);
});

function structuralCandles(direction: "LONG" | "SHORT") {
  return Array.from({ length: 210 }, (_, i) => {
    const c = { high: direction === "LONG" ? 101 : 102, low: direction === "LONG" ? 99 : 99, close: 100, open: 100, volume: 1000, closeTime: Date.now() - 10_000, openTime: i };
    return c;
  }).map((c, i, all) => {
    if (direction === "LONG" && i === 100) c.high = 120;
    if (direction === "SHORT" && i === 100) c.low = 80;
    return c;
  });
}
const decisionBase = (direction: "LONG" | "SHORT", klines: any[]) => ({
  signal: direction, p: { price: 100, atr14: 1, atr20: 1, ema21: 100, rvol: 1, rsi: 50, adx: 20, bull_align: true, klines },
  w: { scenario: "NONE", fund: 0, oi_chg: 0, hidden_buy: false, hidden_sell: false, strong_acc: false },
  score: 8, grade: { risk: 0.01, mult: 1, label: "TEST" }, setupType: "BREAKOUT_MOMENTUM", ctx: { regime: "TREND_UP" }, reasoning: { regime: "TREND_UP" },
});

test("executeTrade rejects missing structure and stores structural targets/weights when valid", () => {
  const before = getTrades().length;
  setConfig({ virtualBalance: 1000, initialVirtualBalance: 1000, feeRate: 0, slippageRate: 0 });
  executeTrade("NOHEADROOMUSDT", decisionBase("LONG", structuralCandles("LONG").map(c => ({ ...c, high: 101 }))));
  assert.equal(getTrades().length, before);
  executeTrade("VALIDSTRUCTUSDT", decisionBase("LONG", structuralCandles("LONG")));
  const trade = getTrades().find(t => t.symbol === "VALIDSTRUCTUSDT");
  assert.ok(trade);
  assert.deepEqual([trade!.part_a, trade!.part_b, trade!.part_c], [0.15, 0.25, 0.6]);
  assert.ok(trade!.targetObstacle > trade!.entry);
  assert.ok(trade!.plannedNetRR >= 2.5);
});

test("exitBrain hard stop and mirrored short invalidation use ticker, not closed candle", async () => {
  const long = { symbol: "TICKERLONGUSDT", direction: "LONG", entry: 100, sl: 95, initialSlDist: 5, pos: 1, initialPos: 1, peak_r: 0, be_done: false };
  const short = { symbol: "TICKERSHORTUSDT", direction: "SHORT", entry: 100, sl: 105, initialSlDist: 5, pos: 1, initialPos: 1, peak_r: 0, be_done: false };
  let expected = "";
  strictGet((url, config) => {
    assert.equal(url, `${API}/fapi/v1/ticker/price`);
    assert.equal(config.params.symbol, expected);
    return { data: { price: expected === long.symbol ? "94" : "106" } };
  });
  expected = long.symbol;
  await exitBrain(long, { regime: "TREND_UP", tradeable: true, btc_chg: 0 });
  expected = short.symbol;
  await exitBrain(short, { regime: "TREND_DOWN", tradeable: true, btc_chg: 0 });
  assert.equal(long.pos, 0);
  assert.equal(short.pos, 0);
});

test("inactive bot still manages an existing position after context fetch failure", async () => {
  const trade = { symbol: "INACTIVE-MANAGED-USDT", direction: "LONG", entry: 100, sl: 95, initialSlDist: 5, pos: 1, initialPos: 1, peak_r: 0, be_done: false };
  // The loop first attempts BTC context; every unexpected request fails. The
  // position's ticker is still allowed and triggers its hard stop.
  strictGet((url) => {
    if (url === `${API}/fapi/v1/ticker/price`) return { data: { price: "94" } };
    throw new Error(`unexpected endpoint: ${url}`);
  });
  // Inject only through the public execution API so the test never touches
  // private module state; a valid structure creates the managed position.
  executeTrade(trade.symbol, decisionBase("LONG", structuralCandles("LONG")));
  const created = getTrades().find(t => t.symbol === trade.symbol)!;
  created.sl = 95;
  created.initialSlDist = 5;
  setActive(false);
  await runApexLoop();
  assert.ok(getClosedTrades().some(t => t.symbol === trade.symbol));
});

test("profit and loss entry halts remain latched while later loops still manage positions", async () => {
  for (const kind of ["PROFIT_TARGET", "LOSS_LIMIT"] as const) {
    getTrades().splice(0);
    getClosedTrades().splice(0);
    setConfig({ virtualBalance: 1000, initialVirtualBalance: 1000, feeRate: 0, slippageRate: 0,
      haltProfitEnabled: kind === "PROFIT_TARGET", haltProfitTarget: 0,
      haltLossEnabled: kind === "LOSS_LIMIT", haltLossTarget: 0 });
    setActive(true);
    const symbol = `HALT-${kind}-USDT`;
    executeTrade(symbol, decisionBase("LONG", structuralCandles("LONG")));
    const position = getTrades().find(t => t.symbol === symbol)!;
    assert.ok(position);
    let mark = 100;
    let marks = 0;
    strictGet((url, config) => {
      if (url === `${API}/fapi/v1/ticker/price`) {
        assert.equal(config.params.symbol, symbol);
        marks++;
        return { data: { price: String(mark) } };
      }
      if (url === `${API}/fapi/v1/klines`) {
        const rows = rawSeries(config.params.limit, 100);
        if (config.params.symbol === "BTCUSDT") {
          rows.forEach((row, i) => {
            const price = 100 + i * 0.01;
            row[1] = row[4] = String(price);
            row[2] = String(price + 1);
            row[3] = String(price - 1);
          });
        }
        return { data: rows };
      }
      if (url === `${API}/fapi/v1/premiumIndex`) return { data: { lastFundingRate: "0" } };
      if (url === `${API}/futures/data/openInterestHist`) return { data: [] };
      throw new Error(`unexpected endpoint (including entry scans): ${url}`);
    });
    await runApexLoop();
    assert.equal(getStats().entryHaltReason, kind);
    assert.equal(isActive(), true);
    assert.equal(position.currentPrice, 100);
    mark = 100.1;
    await runApexLoop();
    assert.equal(marks, 2, "next halted cycle still fetches the open position's mark");
    assert.equal(position.currentPrice, mark);
    assert.equal(getStats().entryHaltReason, kind);
    assert.ok(getTrades().includes(position));
  }
  getTrades().splice(0);
  setActive(false);
});

test("readPrice ignores live 15m and 5m candles for every entry indicator", async () => {
  const confirmed = structuralCandles("LONG");
  const live = { ...confirmed[0], closeTime: Date.now() + 60_000, close: 9999, high: 10000, volume: 999999 };
  const baseline = await readPrice("CLOSEDONLY", confirmed, confirmed.slice(-30));
  const withLive = await readPrice("CLOSEDONLY", [...confirmed, live], [...confirmed.slice(-30), live]);
  assert.deepEqual(withLive, baseline);
});
