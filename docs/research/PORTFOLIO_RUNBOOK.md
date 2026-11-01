# Strategy Portfolio Research Runbook

## Safety state
- `strategyPortfolioEnabled` defaults to `false`.
- The portfolio path is not enabled by this branch's default config.
- No exchange order placement or production deployment is performed by the research workflow.
- Do not merge or enable the flag for live trading based on the current research export.

## Strategy families
1. `TREND_RIDER`: EMA trend alignment, directional candle continuation, volume participation and a non-extended RSI zone.
2. `BREAKOUT_RETEST`: completed-candle close through a prior 20-candle boundary, a retest/hold, strong close, volume and taker-flow proxy.
3. `LIQUIDITY_REVERSAL`: sweep of a prior boundary, reclaim, rejection wick, volume expansion and taker-flow proxy.
4. `MOMENTUM_EXPANSION`: ATR range expansion, directional body, volume expansion, trend alignment and an extension guard.

The flow feature is based on exchange kline taker-buy information when present, otherwise close-location-in-range weighted by volume. It is not order-book depth, liquidation flow, or proof of institutional positioning.

The portfolio path also logs high-scoring rejected and superseded candidates (score >= 4.5) into the rejected-signal research stream, deduplicated per symbol/strategy/side for 15 minutes. The existing passive outcome tracker records forward snapshots and MFE/MAE for up to 120 minutes. This is the collection mechanism needed to build a future non-traded opportunity dataset.

## Risk guardian defaults
- 0.5% equity risk per new position.
- 2% maximum aggregate open risk.
- 2% daily loss stop for new entries.
- Maximum five concurrent positions.
- Maximum two same-direction positions as a conservative concentration proxy (not a correlation matrix).

These values are protective starting defaults for paper evaluation, not empirically optimized settings.

## Running research
- `npm test`: existing unit tests, portfolio engine tests, integration flag test, tri-regime tests, execution filter tests, and both research replays.
- `npm run replay:portfolio`: run the portfolio candidate diagnostics and fill-aware partial-exit replay.
- `npm run build`: build the application and server bundle.

The replay reads `study_all_trades_master.json` and `master_candles_1m.json` from the repository root. Candidate outcome slices are conditional on already-executed trades; they are not an unbiased estimate of strategy expectancy.

## Optional paper-only runtime evaluation
The API route `POST /api/predator/config` accepts `strategyPortfolioEnabled: true`. It is intended only for isolated virtual/paper evaluation. The flag is false by default and should be explicitly set back to false after a test. The portfolio path:
- uses closed BTC 4h/15m and asset 15m/5m/4h candles for signal formation;
- obtains a fresh ticker price before sizing;
- applies the existing tri-regime evaluator and execution filter;
- checks the portfolio risk guardian;
- uses the existing virtual-trade executor and existing `exitBrain`.

The portfolio path uses the existing `exitBrain`, but its target R levels and partial allocations are now stored per trade and honored by that exit manager. Current plans are: trend/breakout 0.75R/1.8R/3.5R at 40/35/25; momentum 0.75R/1.5R/3.0R at 40/35/25; liquidity reversal outside range 0.75R/1.5R/2.5R at 40/35/25; tri-regime range scalp 0.8R/1.0R/1.0R at 50/50/0. The existing institutional guard, time-decay logic and ATR runner trail still apply. The historical partial-exit simulator remains a simplified research model and does not fully reproduce those dynamic exits.

## Promotion requirements
A strategy is not promoted unless it has:
1. Continuous multi-symbol historical candles including non-traded and rejected opportunities.
2. A fill-aware simulation with fees, slippage, funding, partial fills, stop/target ordering, and portfolio concurrency.
3. Chronological train/validation/out-of-sample splits and walk-forward validation.
4. Positive net expectancy and PF after costs in out-of-sample data, controlled drawdown, and stable results across sessions/regimes/directions.
5. Paper forward test and explicit human approval before any live configuration change.
