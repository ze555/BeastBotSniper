# Historical Binance USD-M research data

This is a data acquisition stage, not a profitability claim or a substitute strategy.

## Free sources

- Binance Vision: official historical USD-M 1m klines (monthly archives, daily fallback).
- CryptoHFTData anonymous tier: real Binance Futures tick trades, L2 order-book snapshots/deltas, OI, mark/funding and liquidation events. The provider documents a 60-file/minute anonymous limit; a free account/API key removes that limit. Data starts 2025-06-28. See https://www.cryptohftdata.com/docs and its dataset/coverage pages.
- Binance public data README: https://github.com/binance/binance-public-data

No paid dataset is required for the initial study. Do not use the Hugging Face repackaged archive in commercial research without resolving its non-commercial CC BY-NC-SA license.

## Install and download

```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# Linux/macOS: source .venv/bin/activate
pip install -r research/historical_data/requirements.txt

python research/historical_data/download_binance_futures.py \\
  --symbols BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT \\
  --start-date 2025-06-28 --end-date 2025-07-02
```

For the anonymous tier, the downloader makes one symbol/dataset/day request at a time and waits 61 seconds between calls because one daily SDK request can fetch up to 24 hourly files. A one-day, one-symbol run across all five tick datasets can therefore take about five minutes. A free provider account/API key removes the rate limit; set `CRYPTOHFTDATA_API_KEY` in the environment. Do not commit keys.

Run the data audit after download:

```bash
python research/historical_data/audit_historical_data.py --root research-data/binance-usdm
```

All downloaded files are Parquet. `manifest.json` records rows, file paths, empty datasets and download failures. An unavailable field is not imputed or fabricated. Order-book files are very large; begin with a few symbols/days, then expand after checking disk capacity.

## Research integrity gates (must pass before strategy evaluation)

1. Check every input file's symbol, schema, time range, duplicate keys and null rate.
2. Rebuild Binance L2 books from snapshots and deltas in published message order; enforce update-ID continuity and reject intervals after a gap until a fresh snapshot.
3. Use exchange event time for market chronology and received time for realistic data availability/latency. Never sort only by event time.
4. Binance liquidation feed is sampled (at most one snapshot per symbol per second); it is a lower bound, not a complete liquidation tape.
5. Join OI/funding/liquidation/trades only backward-as-of the decision timestamp. Never forward-fill into the future.
6. Exclude entries whose required evidence is absent or stale; report coverage by symbol and day.
7. Apply fees, funding and conservative spread/slippage. If queue position cannot be reconstructed, do not claim exact fills.
8. Separate development, walk-forward validation and a final untouched holdout. Report LONG and SHORT separately, including net PnL, PF, expectancy in R, max drawdown, trade count, exposure, fees, funding, slippage and missed/blocked signals.

## Important limitation

The live entry engine requires fresh futures aggressor flow and a current L2 book, with OI, funding and liquidation evidence used when available. A faithful historical replay must feed the same `evaluateInstitutionalMarket`, `evaluateMarketAlignment`, and `evaluateEntryQuality` functions with timestamp-correct snapshots. This downloader alone does not establish that the live algorithm is profitable. Do not replace missing tick/order-book evidence with candle-derived guesses.


## Independent raw-market optimization (current study)

The authoritative strategy research entry point is `raw_market_optimizer.py` and the pinned symbol-name universe is `universe_62_symbols.txt`.

- The optimizer does **not** read `study_all_trades_master.json`, recorded entries/exits, recorded PnL, or old trade outcomes.
- It downloads official Binance Vision USD-M Futures 1m kline and monthly fundingRate ZIPs and verifies every ZIP against its official `.CHECKSUM`.
- Signals are generated from closed candles and filled at the next 1m open. It tests LONG and SHORT entry families (breakout and impulse), volume/taker-delta thresholds, ATR stops, and three exit families.
- It uses a 60-day development period, 15-day validation period, and a final 15-day untouched holdout. Parameters are selected on validation only; holdout is not used for selection.
- Execution assumptions: 0.04% fee per side, 0.02% adverse slippage per side, stop-first handling of ambiguous intrabar stop/target collisions, 180-minute max hold, 10 concurrent positions, 1% risk target and 10x leverage cap.
- Historical L2/order book and full 90-day OI/force-order history are not assumed or fabricated. Funding charges use official archive rates and entry notional as an approximation.
- This is a separate experimental strategy, not a production code change and not a claim that the live engine has been faithfully reproduced. No result is valid until the Actions run completes and archive coverage, logs, and holdout metrics are audited.
- The prior 78-recorded-trade exit replay has been removed from the active research workflow and must not be used to select or recommend parameters.


## Corrective audit — 2026-11-13

A code review of the first raw-market simulator found a directional-sign defect in stop-price construction: the short-side initial stop and its break-even/trailing stop were placed on the wrong side of entry. Therefore the previously printed negative LONG+SHORT aggregate metrics are **invalid and must not be used to judge the strategy or tune parameters**. The simulator now applies the stop in trade-direction coordinates and reports LONG and SHORT metrics separately.

The same audit found that monthly archives did not cover the full requested 90-day window in the first run (78 days were present). The revised downloader requests official daily Binance klines only for missing UTC dates, supplements monthly fundingRate archives with Binance's official USD-M fundingRate history API, records first/last bars and gaps, and applies the 10-position portfolio cap across the continuous timeline before splitting samples. The workflow timeout was increased so the full parameter grid can finish. All corrected results require a fresh completed run and an audit of its manifest and holdout.
