#!/usr/bin/env python3
"""Download real Binance USD-M Futures history for reproducible research.

Tick data (trades/L2/OI/funding/liquidations) comes from CryptoHFTData's free
public tier. 1m klines come directly from Binance Vision. No synthetic values
are generated. Missing datasets remain missing and are reported in manifest.
"""
from __future__ import annotations
import argparse, json, logging, os, time, zipfile
from datetime import date, datetime, timedelta
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen

import pandas as pd
import cryptohftdata as chd

LOG = logging.getLogger("beast-historical")
EXCHANGE = chd.exchanges.BINANCE_FUTURES
DATASETS = ("trades", "orderbook", "open_interest", "mark_price", "liquidations")


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def save_frame(frame, path: Path):
    if frame is None or frame.empty:
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(path, index=False, compression="zstd")
    return len(frame)


def download_klines(symbol: str, start: date, end: date, root: Path):
    """Download monthly Binance Vision USD-M 1m klines; fall back to daily ZIP."""
    out = root / symbol / "klines_1m"
    out.mkdir(parents=True, exist_ok=True)
    months = pd.period_range(start=start, end=end, freq="M")
    rows, missing = 0, []
    for month in months:
        tag = str(month)
        dest = out / f"{tag}.parquet"
        if dest.exists():
            rows += len(pd.read_parquet(dest))
            continue
        urls = [
            f"https://data.binance.vision/data/futures/um/monthly/klines/{symbol}/1m/{symbol}-1m-{tag}.zip"
        ]
        req = Request(urls[0], headers={"User-Agent": "BeastBotSniper-research/1.0"})
        try:
            with urlopen(req, timeout=60) as response:
                payload = response.read()
        except Exception:
            # Daily archives are useful for the newest incomplete month.
            frames = []
            first = max(start, month.start_time.date())
            last = min(end, month.end_time.date())
            for day in daterange(first, last):
                url = f"https://data.binance.vision/data/futures/um/daily/klines/{symbol}/1m/{symbol}-1m-{day}.zip"
                try:
                    with urlopen(Request(url, headers={"User-Agent": "BeastBotSniper-research/1.0"}), timeout=60) as response:
                        z = zipfile.ZipFile(BytesIO(response.read()))
                        with z.open(z.namelist()[0]) as f:
                            frames.append(pd.read_csv(f, header=None))
                except Exception as exc:
                    missing.append(f"{day}: {exc}")
            if not frames:
                missing.append(f"{tag}: monthly and daily archive unavailable")
                continue
            raw = pd.concat(frames, ignore_index=True)
        else:
            with zipfile.ZipFile(BytesIO(payload)) as z:
                with z.open(z.namelist()[0]) as f:
                    raw = pd.read_csv(f, header=None)
        cols = ["open_time","open","high","low","close","volume","close_time",
                "quote_volume","trade_count","taker_buy_base","taker_buy_quote","ignore"]
        raw.columns = cols[:len(raw.columns)]
        raw = raw[(raw.open_time >= int(pd.Timestamp(start, tz="UTC").timestamp()*1000)) &
                  (raw.open_time < int((pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1)).timestamp()*1000))]
        for c in ["open","high","low","close","volume","quote_volume","taker_buy_base","taker_buy_quote"]:
            if c in raw: raw[c] = pd.to_numeric(raw[c], errors="coerce")
        raw.to_parquet(dest, index=False, compression="zstd")
        rows += len(raw)
        LOG.info("%s klines %s: %s rows", symbol, tag, len(raw))
    return {"rows": rows, "missing": missing}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--symbols", required=True, help="Comma-separated Binance USDT-M symbols")
    p.add_argument("--start-date", required=True, help="YYYY-MM-DD")
    p.add_argument("--end-date", required=True, help="YYYY-MM-DD")
    p.add_argument("--out", default="research-data/binance-usdm")
    p.add_argument("--datasets", default=",".join(DATASETS),
                   help="Comma-separated: trades,orderbook,open_interest,mark_price,liquidations")
    p.add_argument("--api-key", default=os.getenv("CRYPTOHFTDATA_API_KEY"))
    args = p.parse_args()
    start, end = date.fromisoformat(args.start_date), date.fromisoformat(args.end_date)
    if end < start: p.error("--end-date must be >= --start-date")
    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    datasets = [s.strip() for s in args.datasets.split(",") if s.strip()]
    unknown = set(datasets) - set(DATASETS)
    if unknown: p.error(f"Unknown datasets: {sorted(unknown)}")
    root = Path(args.out)
    client = chd.CryptoHFTDataClient(api_key=args.api_key) if args.api_key else chd.CryptoHFTDataClient()
    methods = {
        "trades": "get_trades", "orderbook": "get_orderbook",
        "open_interest": "get_open_interest", "mark_price": "get_mark_price",
        "liquidations": "get_liquidations",
    }
    manifest = {"source": "CryptoHFTData free tier + Binance Vision",
                "exchange": "BINANCE_FUTURES", "start_date": str(start), "end_date": str(end),
                "symbols": {}, "created_utc": datetime.now(timezone.utc).isoformat()}
    for symbol in symbols:
        report = {"datasets": {}, "klines_1m": None}
        report["klines_1m"] = download_klines(symbol, start, end, root)
        for dataset in datasets:
            method = getattr(client, methods[dataset])
            dataset_rows, dataset_files, failures = 0, [], []
            for day in daterange(start, end):
                path = root / symbol / dataset / f"{day}.parquet"
                if path.exists():
                    dataset_rows += len(pd.read_parquet(path))
                    dataset_files.append(str(path))
                    continue
                try:
                    frame = method(symbol=symbol, exchange=EXCHANGE,
                                   start_date=str(day), end_date=str(day))
                    if frame is None: frame = pd.DataFrame()
                    count = save_frame(frame, path)
                    dataset_rows += count
                    if count: dataset_files.append(str(path))
                    LOG.info("%s %s %s: %s rows", symbol, dataset, day, count)
                except Exception as exc:
                    failures.append({"date":str(day),"error":str(exc)})
                    LOG.exception("%s %s %s download failed", symbol, dataset, day)
                # A daily SDK call can fetch up to 24 hourly Parquet files. Leave a full
                # minute between anonymous calls; a free API key removes this wait.
                if not args.api_key:
                    time.sleep(61)
            report["datasets"][dataset] = {
                "rows": dataset_rows, "files": dataset_files,
                "status": "ERRORS" if failures else ("OK" if dataset_rows else "EMPTY"),
                "failures": failures
            }
        manifest["symbols"][symbol] = report
    root.mkdir(parents=True, exist_ok=True)
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    from datetime import timezone
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    main()
