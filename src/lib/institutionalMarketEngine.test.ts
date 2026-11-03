import assert from "node:assert/strict";
import { evaluateInstitutionalMarket, evaluateInstitutionalExit, InstitutionalSnapshot } from "./institutionalMarketEngine.js";

const now = 1_800_000_000_000;
const flow = (buy: number, sell: number, extra: Partial<any> = {}) => ({
  buyQuote: buy, sellQuote: sell, tradeCount: 30, observedAt: now,
  source: "BINANCE_AGG_TRADES" as const, ...extra
});
function snapshot(overrides: Partial<InstitutionalSnapshot> = {}): InstitutionalSnapshot {
  const candles = Array.from({ length: 23 }, (_, i) => ({
    openTime: now - (23 - i) * 60_000, open: 100, high: 101, low: 99,
    close: 100, volume: 100, quoteVolume: 10_000
  }));
  candles[22] = { ...candles[22], open: 100, high: 104, low: 100, close: 103.5, volume: 250, quoteVolume: 25_000 };
  return {
    symbol: "TESTUSDT", timestamp: now, price: 103.5, candles,
    futuresFlow: flow(75_000, 25_000, { buyQuote5s: 20_000, sellQuote5s: 2_000, trades5s: 8 }),
    orderBook: { bidNotional: 500_000, askNotional: 200_000, spreadBps: 2, observedAt: now, source: "BINANCE_DEPTH" },
    oiChange: 0.01, fundingRate: 0.0001, btcChange: -0.01, oiAvailable: true,
    ...overrides
  };
}

const long = evaluateInstitutionalMarket(snapshot());
assert.equal(long.state, "BREAKOUT_CONFIRMED");
assert.equal(long.direction, "LONG");
assert.equal(long.canEnter, true);
assert.equal(long.dataQuality.spotTrades, false);
assert.equal(long.metrics.spotBuyShare, null, "Spot must not be read or used");

const shortCandles = snapshot().candles.map(c => ({ ...c }));
shortCandles[22] = { ...shortCandles[22], open: 100, high: 100, low: 96, close: 96.5, volume: 250, quoteVolume: 25_000 };
const short = evaluateInstitutionalMarket(snapshot({
  price: 96.5, candles: shortCandles,
  futuresFlow: flow(20_000, 80_000, { buyQuote5s: 1_000, sellQuote5s: 20_000, trades5s: 9 }),
  orderBook: { bidNotional: 200_000, askNotional: 500_000, spreadBps: 2, observedAt: now, source: "BINANCE_DEPTH" },
  btcChange: 0.01
}));
assert.equal(short.state, "BREAKOUT_CONFIRMED");
assert.equal(short.direction, "SHORT");
assert.equal(short.canEnter, true, "Futures-only short must be eligible");

const earlyLong = evaluateInstitutionalMarket(snapshot({
  futuresFlow: flow(72_000, 28_000, { buyQuote5s: 20_000, sellQuote5s: 1_000, trades5s: 7 }),
  oiChange: -0.01
}));
assert.equal(earlyLong.canEnter, true, "A genuine short-squeeze impulse with aggressive Futures buying can be traded");
assert.equal(earlyLong.direction, "LONG");

const earlyBeforeVolumeClose = evaluateInstitutionalMarket(snapshot({
  price: 100.4,
  candles: snapshot().candles.map((c, i, all) => i === all.length - 1
    ? { ...c, open: 100, high: 100.5, low: 100, close: 100.4, quoteVolume: 10_000, volume: 100 }
    : c),
  futuresFlow: flow(18_000, 2_000),
  oiChange: 0.001
}));
assert.equal(earlyBeforeVolumeClose.canEnter, true, "Directional 30-second Futures flow plus a 0.4% live impulse should not wait for the 1m candle-volume ratio");

const noSpotStillWorks = evaluateInstitutionalMarket(snapshot());
assert.equal(noSpotStillWorks.canEnter, true, "Missing Spot data must never block a Futures-only signal");

const quietCandles = snapshot().candles.map(c => ({ ...c }));
quietCandles[22] = { ...quietCandles[22], open: 100, high: 100.2, low: 99.8, close: 100.05, volume: 100, quoteVolume: 10_000 };
const quiet = evaluateInstitutionalMarket(snapshot({
  candles: quietCandles, price: 100.05,
  futuresFlow: flow(52_000, 48_000),
  oiChange: 0.0001
}));
assert.equal(quiet.canEnter, false, "Stable symbols must remain dormant");

const thinBook = evaluateInstitutionalMarket(snapshot({
  orderBook: { bidNotional: 2_000, askNotional: 1_000, spreadBps: 40, observedAt: now, source: "BINANCE_DEPTH" }
}));
assert.equal(thinBook.canEnter, false, "Thin depth / wide spread cannot qualify as executable liquidity");

const staleFlow = evaluateInstitutionalMarket(snapshot({
  futuresFlow: { ...flow(80_000, 20_000), observedAt: now - 60_000 }
}));
assert.equal(staleFlow.canEnter, false, "Stale Futures flow must fail closed");

const missingFutures = evaluateInstitutionalMarket(snapshot({ futuresFlow: null }));
assert.equal(missingFutures.state, "DATA_INSUFFICIENT");
assert.equal(missingFutures.canEnter, false);

const continuation = evaluateInstitutionalMarket(snapshot({
  previousState: "BREAKOUT_CONFIRMED", previousDirection: "LONG"
}));
assert.equal(continuation.state, "CONTINUATION");
assert.equal(continuation.canEnter, false, "Do not chase an already-running wave as a new entry");

const exit = evaluateInstitutionalExit({
  direction: "LONG", price: 98, entry: 100, stop: 95, structureInvalidated: true,
  timestamp: now, fundingRate: 0, futuresFlow: flow(10, 90)
});
assert.equal(exit.action, "EXIT", "Exit must work with Futures flow only");

const noExitWithoutStructure = evaluateInstitutionalExit({
  direction: "LONG", price: 99, entry: 100, stop: 95, structureInvalidated: false,
  timestamp: now, fundingRate: 0, futuresFlow: flow(10, 90)
});
assert.equal(noExitWithoutStructure.action, "PROTECT");

console.log("futuresOnlyWaveEngine: all tests passed");
