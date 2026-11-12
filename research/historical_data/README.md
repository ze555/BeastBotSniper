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
