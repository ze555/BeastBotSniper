# Strategy Portfolio Research Runbook

## Safety state
- `strategyPortfolioEnabled` defaults to `false`.
- The portfolio path is not enabled by this branch's default config.
- No exchange order placement or production deployment is performed by the research workflow.
- Do not merge or enable the flag for live trading based on the current research export.

## Strategy families and evidence chain
1. `TREND_RIDER`: closed-candle EMA21/EMA50 structure, EMA9 resumption, directional close, participation and non-extended RSI.
2. `BREAKOUT_RETEST`: completed-candle close beyond the prior 20-candle boundary, retest/hold, directional body and volume expansion.
3. `LIQUIDITY_REVERSAL`: prior boundary sweep, reclaim, rejection wick and volume expansion.
4. `MOMENTUM_EXPANSION`: ATR expansion, directional body, volume expansion, fast EMA alignment and extension guard.

There is no additive score, weighted vote or score threshold in this portfolio engine. Each candidate must pass every required gate (logical AND); one missing, stale or contradictory required source vetoes the candidate. There is no compensation for a failed confirmation from several weaker indicators. The engine reports confirmed and missing evidence explicitly.

### What the data actually represents
- 15m/5m CVD slopes are derived from Binance futures kline taker-buy/taker-sell volume. They are exchange aggressor-flow proxies, not full-market CVD or proof of a named institution.
- Open interest and funding are Binance USD-M public futures endpoints. Price/OI combinations are contextual positioning evidence, not direct identification of long/short beneficial owners.
- Order-book imbalance is calculated from the top 20 visible bid/ask levels, weighted by quoted notional. It is a short-lived displayed-liquidity snapshot and can be spoofed/cancelled; it is not institutional order flow or a liquidation map.
- Liquidation levels, hidden institutional orders, iceberg orders and off-exchange positioning are not inferred. If an authentic feed is not connected, those data are unavailable and cannot confirm a trade.
- The order-book snapshot must be received within the local 5-second request window. The REST depth response does not provide a trustworthy exchange generation timestamp in this integration, so this is request latency, not a certified source timestamp.
- Missing CVD, OI, funding or order-book data blocks entries. Missing data is never silently converted to neutral evidence.

The Binance kline taker-buy field is preferred. The candle close-location proxy is retained only for non-portfolio legacy logic; the strict portfolio path additionally requires the explicit CVD fields and a fresh depth snapshot.

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

The replay reads `study_all_trades_master.json` and `master_candles_1m.json` from the repository root. It excludes 15m snapshot candles that were still forming at entry, uses completed 1m candles only, prefers recorded initial stop/risk/quantity fields, and falls back to TP1-based initial-risk reconstruction for the legacy export. Candidate outcome slices are conditional on already-executed trades; they are not an unbiased estimate of strategy expectancy. Missing or unchanged OI is labeled neutral/unavailable, not supportive evidence.

## Optional paper-only runtime evaluation
The API route `POST /api/predator/config` accepts a minimal body such as `{"strategyPortfolioEnabled":true}`; balance and max-trade settings are preserved when omitted. It is intended only for isolated virtual/paper evaluation. The flag is false by default and should be explicitly set back to false after a test. The portfolio path:
- uses closed BTC 4h/15m and asset 15m/5m/4h candles for signal formation;
- obtains a fresh ticker price before sizing;
- tries accepted candidates in score order and falls through to the next strategy if a higher-scored candidate fails a safety gate;\n- applies the existing tri-regime evaluator and execution filter;
- checks the portfolio risk guardian;
- uses the existing virtual-trade executor and existing `exitBrain`.

The portfolio path uses the existing `exitBrain`, but its target R levels and partial allocations are now stored per trade and honored by that exit manager. Current plans are: trend/breakout 0.75R/1.8R/3.5R at 40/35/25; momentum 0.75R/1.5R/3.0R at 40/35/25; liquidity reversal outside range 0.75R/1.5R/2.5R at 40/35/25; tri-regime range scalp 0.8R/1.0R/1.0R at 50/50/0. Common stop progression remains +0.45R to -0.25R protection, then +0.30R after TP1, then to the trade-specific TP1-R level after TP2. The existing institutional guard, time-decay logic and ATR runner trail still apply. The historical partial-exit simulator models the soft-protection and fixed stop progression but does not fully reproduce the institutional guard, time-decay or ATR runner exits.

## Promotion requirements
A strategy is not promoted unless it has:
1. Continuous multi-symbol historical candles including non-traded and rejected opportunities.
2. A fill-aware simulation with fees, slippage, funding, partial fills, stop/target ordering, and portfolio concurrency.
3. Chronological train/validation/out-of-sample splits and walk-forward validation.
4. Positive net expectancy and PF after costs in out-of-sample data, controlled drawdown, and stable results across sessions/regimes/directions.
5. Paper forward test and explicit human approval before any live configuration change.
