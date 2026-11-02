# Institutional Full Trading Engine

## Runtime path

`apexPredator.ts` now routes new entries through `evaluateInstitutionalEntry` and `institutionalMarketEngine.ts`. The legacy numeric entry score path is no longer called by the live scanner. There is no weighted score, grade threshold, or numeric confluence sum in the new decision engine.

## Evidence sources

- Binance Spot aggregate trades: `GET /api/v3/aggTrades`. Buyer-maker flag `m=true` means the seller was the aggressor; `m=false` means the buyer was the aggressor.
- Binance USD-M aggregate trades: `GET /fapi/v1/aggTrades`.
- Binance USD-M order book: `GET /fapi/v1/depth`. Depth imbalance is contextual only; displayed orders may be cancelled.
- Binance USD-M open-interest history: `GET /futures/data/openInterestHist` at 15m intervals.
- Funding: `GET /fapi/v1/premiumIndex`.
- Candles: USD-M klines. Only completed candles are passed into the structural entry decision.

Aggregate-trade polling uses the latest 100 records and the latest exchange trade timestamp. This is a recent executed-flow snapshot, not a full historical multi-timeframe CVD series. Stale trade data fails closed. OI must be available and recent. A genuine liquidation feed is not currently integrated and is explicitly reported as unavailable; no synthetic liquidation values are generated.

## Entry gates

An entry requires fresh Spot and Futures executed trade flow, valid recent OI, a completed-candle structural break, participation expansion, and qualified executable order-book liquidity (top-20 notional depth at least 10,000 USDT and spread no wider than 15 bps). The market must show aligned direction in both Spot and Futures flow. BTC context is informational: independent asset strength/weakness is allowed and BTC direction is not a blanket entry lock.

Squeeze-only price movement with falling OI and no spot confirmation is not eligible for a fresh entry. Conflicting Spot/Futures flow or missing/stale critical evidence fails closed.

## Lifecycle

States include DORMANT, PRE_IGNITION, IGNITION, BREAKOUT_CONFIRMED, CONTINUATION, SQUEEZE_ONLY, EXHAUSTION_WARNING, REVERSAL_CONFIRMED, CONFLICTED and DATA_INSUFFICIENT. Per-symbol state is held in memory across scan cycles; it is not persisted across process restarts yet.

## Exit management

An early full exit requires all of: post-entry structural invalidation, adverse price location, and both Spot and Futures executed flow against the position. Partial deterioration triggers PROTECT, not an automatic full exit. Hard stop-loss and staged take-profit controls remain active. The previous score-based exit branches have been removed from this path.

## Universe and scan cadence

The scanner universe is populated from all Binance USD-M symbols with `contractType=PERPETUAL`, `quoteAsset=USDT` and `status=TRADING`. Symbols are processed in rotating batches; this is broad-universe coverage, not simultaneous tick-by-tick surveillance of every contract. Execution depth/spread gates reject thin markets.

## Validation

Run:

`npm test`

The institutional suite covers long/short ignition, BTC decoupling, squeeze-only rejection, stale/missing data, Spot/Futures conflict, continuation, reversal, liquidity rejection and evidence-based exits.

No production deployment or merge to main is part of this branch.
