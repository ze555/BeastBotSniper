import assert from "node:assert/strict";
import { evaluateInstitutionalMarket, evaluateInstitutionalExit, InstitutionalSnapshot } from "./institutionalMarketEngine.js";

const now = 1_800_000_000_000;
function snapshot(overrides: Partial<InstitutionalSnapshot> = {}): InstitutionalSnapshot {
  const candles = Array.from({ length: 23 }, (_, i) => ({
    openTime: now - (23 - i) * 60_000,
    open: 100, high: 101, low: 99, close: 100, volume: 100,
    quoteVolume: 10_000
  }));
  candles[21] = { ...candles[21], high: 101, low: 99, close: 100, quoteVolume: 10_000 };
  candles[22] = { ...candles[22], open: 101, high: 104, low: 101, close: 103.5, volume: 250, quoteVolume: 25_000 };
  return {
    symbol: "TESTUSDT", timestamp: now, price: 103.5, candles,
    spotFlow: { buyQuote: 80_000, sellQuote: 20_000, tradeCount: 100, observedAt: now, source: "BINANCE_AGG_TRADES" },
    futuresFlow: { buyQuote: 75_000, sellQuote: 25_000, tradeCount: 100, observedAt: now, source: "BINANCE_AGG_TRADES" },
    orderBook: { bidNotional: 500_000, askNotional: 200_000, spreadBps: 2, observedAt: now, source: "BINANCE_DEPTH" },
    oiChange: 0.01, fundingRate: 0.0001, btcChange: -0.01, oiAvailable: true,
    ...overrides
  };
}

const confirmed = evaluateInstitutionalMarket(snapshot());
assert.equal(confirmed.state, "BREAKOUT_CONFIRMED");
assert.equal(confirmed.direction, "LONG");
assert.equal(confirmed.canEnter, true);
assert.equal(confirmed.metrics.btcChange, -0.01, "BTC adverse context must not block independent long evidence");

const squeeze = evaluateInstitutionalMarket(snapshot({
  oiChange: -0.01,
  spotFlow: { buyQuote: 20_000, sellQuote: 80_000, tradeCount: 100, observedAt: now, source: "BINANCE_AGG_TRADES" }
}));
assert.equal(squeeze.state, "SQUEEZE_ONLY");
assert.equal(squeeze.canEnter, false, "Squeeze-only rally must not authorize a long");

const missingSpot = evaluateInstitutionalMarket(snapshot({ spotFlow: null }));
assert.equal(missingSpot.state, "DATA_INSUFFICIENT");
assert.equal(missingSpot.canEnter, false, "Missing source data must fail closed");

const staleFlow = evaluateInstitutionalMarket(snapshot({
  spotFlow: { buyQuote: 80_000, sellQuote: 20_000, tradeCount: 100, observedAt: now - 60_000, source: "BINANCE_AGG_TRADES" }
}));
assert.equal(staleFlow.canEnter, false, "Stale trade flow must fail closed");

const conflicting = evaluateInstitutionalMarket(snapshot({
  spotFlow: { buyQuote: 80_000, sellQuote: 20_000, tradeCount: 100, observedAt: now, source: "BINANCE_AGG_TRADES" },
  futuresFlow: { buyQuote: 20_000, sellQuote: 80_000, tradeCount: 100, observedAt: now, source: "BINANCE_AGG_TRADES" }
}));
assert.equal(conflicting.canEnter, false, "Spot/futures conflict must not enter");

const exit = evaluateInstitutionalExit({
  direction: "LONG", price: 98, entry: 100, stop: 95, structureInvalidated: true, timestamp: now, fundingRate: 0,
  spotFlow: { buyQuote: 10, sellQuote: 90, tradeCount: 10, observedAt: now, source: "BINANCE_AGG_TRADES" },
  futuresFlow: { buyQuote: 20, sellQuote: 80, tradeCount: 10, observedAt: now, source: "BINANCE_AGG_TRADES" }
});
assert.equal(exit.action, "EXIT");

const noExitWithoutStructure = evaluateInstitutionalExit({
  direction: "LONG", price: 99, entry: 100, stop: 95, structureInvalidated: false, timestamp: now, fundingRate: 0,
  spotFlow: { buyQuote: 10, sellQuote: 90, tradeCount: 10, observedAt: now, source: "BINANCE_AGG_TRADES" },
  futuresFlow: { buyQuote: 20, sellQuote: 80, tradeCount: 10, observedAt: now, source: "BINANCE_AGG_TRADES" }
});
assert.equal(noExitWithoutStructure.action, "PROTECT");

console.log("institutionalMarketEngine: all tests passed");
