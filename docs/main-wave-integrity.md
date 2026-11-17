# Main wave integrity release

Baseline: `5334d4c74366b0978b02f5af75404f3eddf555d0`.
Revision: `main-wave-integrity-v1`. Execution remains PAPER.

## Behavior

- Candle indicators and confirmations use completed candles only. The existing
  failed-sweep gate now uses the newest completed candle rather than lagging one.
- Entry candidates use a fresh exchange-timestamped bid/ask quote. Buy fills use
  ask plus configured slippage; sells use bid minus configured slippage. Exit
  fills use the executable opposite side and configured slippage.
- Wave execution requires the newest closed 5m candle's taker delta to agree
  with its price response. Missing/stale candles, reversed impulses, chasing
  farther than one ATR, and costs exceeding the first target are rejected.
  These are proposed rules, not profitability-calibrated constants.
- RANGE / RANGE_MEAN_REVERSION candidates reaching execution are recorded only.
  This is an observation log, not a parallel PnL backtest. Earlier strategy
  gates still apply; this release does not replace the existing score engine.
- Missing/stale OI is explicit; it cannot earn stable-OI points. The existing
  long-horizon CVD value is now actually supplied to reasoning.
- A separate 2-second REST protection loop marks positions, checks stops and
  processes existing staged targets even when entry scanning is paused, BTC
  context fails, or another symbol times out. It is not an exchange-native stop:
  network outages, gaps and process downtime can still delay a simulated fill.
- Stops can only tighten. Late responses cannot overwrite newer protection
  prices. Duplicate closes are ignored. A failed quote never falls back to a
  stale candle price for execution.
- New-position sizing includes estimated transaction costs and shares the
  existing 4% loss budget with open stop risk; this is not a guarantee of a
  maximum loss under gaps or correlated moves.

## Observability and comparison

`/api/predator/stats`: revision, PAPER mode, quote failures, protection cycles,
wave gate counts, opened count, range observation count and reason counts.
`/api/research/candidate-audit`: bounded last 200 gate decisions (in memory).
Research trade records carry `strategy_revision` and `execution_mode`.
`BEAST_RESEARCH_DIR` optionally places research files on persistent storage.

Keep the baseline commit and export each revision's results separately. Compare
new, forward data across directions/regimes, net expectancy, fees, drawdown,
MAE/MFE and execution latency. Do not repeatedly tune the same holdout sample.
Only promote a candidate on independent evidence; this release does not
increase capital, leverage or enable real exchange orders.

## Validation and limits

`npm run test:integrity`, existing tests, `npx tsc --noEmit`, `npm run build`.
Tests cover freshness, closed candles, mirrored flow checks, chase/cost rejection,
monotonic stops, partial exits, duplicate closes and protection during data
failures with entry scanning disabled. They are regression tests, not a
historical market profitability test.

No full-depth order book or tick OFI is implemented here. Candle taker delta is
one flow proxy; it is not independent institutional identity evidence. Funding
settlements and live exchange fills are not modeled. Active positions and
candidate audit are still memory-resident and do not survive process restart.
Do not describe this release as a proven income system or production execution
engine without closing these gaps and collecting forward results.

The user-designated Railway URL belongs to Smartflow; its Nov 17 snapshot has
17 paper trades, net -10.12 USD and 1.83 USD fees. Eight losers never reached
0.2R MFE and no loser reached 0.5R. It motivates entry investigation but is not
an evaluation of this main-branch release or proof of causal improvement.
