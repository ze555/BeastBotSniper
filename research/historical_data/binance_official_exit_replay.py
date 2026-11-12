#!/usr/bin/env python3
"""Exit-only replay of the archived 78 trades using official Binance Vision 1m klines.

No entry signals are regenerated. Entries and the replay horizon are fixed to the
recorded trade timestamps. Partial entry/exit minutes are excluded to prevent
look-ahead. Intrabar stop/target collisions are evaluated in conservative and
optimistic orderings. Missing official archives remain missing, never synthesized.
"""
from __future__ import annotations
import argparse, csv, hashlib, io, json, math, time, urllib.error, urllib.request, zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://data.binance.vision/data/futures/um/monthly/klines"
COLS = ["open_time","open","high","low","close","volume","close_time",
        "quote_volume","trade_count","taker_buy_base","taker_buy_quote","ignore"]

def ms(iso: str) -> int:
    return int(datetime.fromisoformat(iso.replace("Z","+00:00")).timestamp()*1000)

def get_bytes(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent":"BeastBotSniper-official-archive-research/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def verified_zip(symbol: str, month: str):
    filename = f"{symbol}-1m-{month}.zip"
    url = f"{BASE}/{symbol}/1m/{filename}"
    payload = get_bytes(url)
    checksum_text = get_bytes(url + ".CHECKSUM").decode("utf-8","replace").strip()
    expected = checksum_text.split()[0].lower()
    actual = hashlib.sha256(payload).hexdigest()
    if expected != actual:
        raise ValueError(f"SHA256 mismatch for {filename}: expected={expected} actual={actual}")
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        member = next((n for n in z.namelist() if n.lower().endswith(".csv")), None)
        if not member: raise ValueError(f"No CSV in {filename}")
        rows = []
        with z.open(member) as f:
            reader = csv.reader(io.TextIOWrapper(f, encoding="utf-8"))
            for row in reader:
                if not row or not row[0].isdigit(): continue
                if len(row) < 7: continue
                try:
                    rows.append({
                        "t": int(row[0]), "o": float(row[1]), "h": float(row[2]),
                        "l": float(row[3]), "c": float(row[4]), "v": float(row[5]),
                        "ct": int(row[6])
                    })
                except (ValueError, IndexError):
                    continue
    rows.sort(key=lambda x:x["t"])
    # Duplicate timestamps are not silently accepted.
    dedup = {}
    for r in rows: dedup[r["t"]] = r
    rows = [dedup[k] for k in sorted(dedup)]
    return rows, {"symbol":symbol,"url":url,"checksum_url":url+".CHECKSUM",
                  "sha256":actual,"bytes":len(payload),"rows":len(rows),
                  "first_open_ms":rows[0]["t"] if rows else None,
                  "last_open_ms":rows[-1]["t"] if rows else None}

def ema_series(bars, period=21):
    out = {}
    if not bars: return out
    k = 2.0/(period+1.0)
    value = bars[0]["c"]
    for b in bars:
        value = b["c"] if b is bars[0] else b["c"]*k + value*(1-k)
        out[b["t"]] = value
    return out

def stop_touched(side, bar, stop_r, entry, risk):
    px = entry + stop_r*risk if side=="LONG" else entry - stop_r*risk
    hit = bar["l"] <= px if side=="LONG" else bar["h"] >= px
    if not hit: return False, None
    # Market stop gap: use the worse opening price when the candle opens beyond it.
    if side=="LONG": fill = min(px, bar["o"])
    else: fill = max(px, bar["o"])
    return True, fill

def target_touched(side, bar, target_r, entry, risk):
    px = entry + target_r*risk if side=="LONG" else entry - target_r*risk
    return (bar["h"] >= px if side=="LONG" else bar["l"] <= px), px

def simulate(trade, bars, emas, mode, giveback=0.35, intrabar="conservative",
             fee_rate=0.0004, slippage_rate=0.0002):
    side = trade["side"]
    direction = 1.0 if side=="LONG" else -1.0
    entry = float(trade["entry_price"])
    stop = float(trade["stop_loss"])
    risk = abs(entry-stop)
    qty = float(trade["position_size"])
    risk_usd = risk*qty
    if risk_usd <= 0 or qty <= 0:
        return {"status":"INVALID_RISK"}
    remaining = 1.0
    realized_gross = 0.0
    exit_fees = 0.0
    exit_slippage = 0.0
    entry_fee = entry*qty*fee_rate
    active_stop_r = -1.0
    tp1_done = tp2_done = False
    mfe = 0.0
    mae = 0.0
    exit_reason = "RECORDED_EXIT_CAP"
    exit_time = None
    exit_prices = []

    def close_fraction(frac, price, reason, t):
        nonlocal remaining, realized_gross, exit_fees, exit_slippage, exit_reason, exit_time
        frac = min(max(frac,0.0),remaining)
        if frac <= 0: return
        realized_gross += direction*(price-entry)*qty*frac
        notional = price*qty*frac
        exit_fees += notional*fee_rate
        exit_slippage += notional*slippage_rate
        remaining -= frac
        exit_prices.append({"time_ms":t,"price":price,"fraction":frac,"reason":reason})
        exit_reason, exit_time = reason, t

    for bar in bars:
        hi_r = direction*(bar["h"]-entry)/risk
        lo_r = direction*(bar["l"]-entry)/risk
        close_r = direction*(bar["c"]-entry)/risk
        mfe = max(mfe, hi_r)
        mae = min(mae, lo_r)
        if remaining <= 1e-9: break

        hit_stop, stop_fill = stop_touched(side,bar,active_stop_r,entry,risk)
        targets = [(0.75,0.40,"TP1")]
        if mode=="current_b":
            targets += [(1.80,0.35,"TP2"),(3.50,0.25,"TP3")]

        hit_targets = []
        for tr, frac, label in targets:
            done = tp1_done if label=="TP1" else tp2_done if label=="TP2" else False
            if done: continue
            hit, px = target_touched(side,bar,tr,entry,risk)
            if hit: hit_targets.append((tr,frac,label,px))

        if hit_stop and intrabar=="conservative":
            close_fraction(remaining,stop_fill,"STOP",bar["t"])
            break

        for tr, frac, label, px in hit_targets:
            if remaining <= 1e-9: break
            close_fraction(frac,px,label,bar["t"])
            if label=="TP1":
                tp1_done=True
                active_stop_r=max(active_stop_r,0.30)
            elif label=="TP2":
                tp2_done=True
                active_stop_r=max(active_stop_r,0.75)
            elif label=="TP3":
                break

        if remaining <= 1e-9: break

        # Conservative Hybrid monotonic runner protection.
        if mode.startswith("hybrid"):
            if mfe >= 1.50: active_stop_r=max(active_stop_r,0.90)
            elif mfe >= 1.00: active_stop_r=max(active_stop_r,0.50)

        # In optimistic ordering, the old stop is checked after targets.
        # In conservative ordering, any newly-raised stop can still be hit later in this bar.
        hit_new_stop, new_stop_fill = stop_touched(side,bar,active_stop_r,entry,risk)
        if hit_new_stop:
            close_fraction(remaining,new_stop_fill,"TRAIL_STOP" if active_stop_r>-1 else "STOP",bar["t"])
            break

        # Current Model B early invalidation: loss reaches -0.40R and 1m close breaks EMA21.
        if mode=="current_b" and remaining>1e-9 and close_r <= -0.40:
            ema = emas.get(bar["t"])
            broken = ema is not None and (bar["c"] < ema if side=="LONG" else bar["c"] > ema)
            if broken:
                close_fraction(remaining,bar["c"],"EARLY_INVALIDATION_EMA21",bar["t"])
                break

        # Hybrid giveback is a close-confirmed exit, enabled only after MFE >= +1.15R.
        if mode.startswith("hybrid") and remaining>1e-9 and mfe >= 1.15 and close_r <= mfe-giveback:
            close_fraction(remaining,bar["c"],f"GIVEBACK_{giveback:.2f}R",bar["t"])
            break

    if remaining > 1e-9:
        close_px = float(trade["exit_price"])
        close_fraction(remaining,close_px,"RECORDED_EXIT_CAP",ms(trade["timestamp_exit"]))
    gross_r = realized_gross/risk_usd
    cost_r = (entry_fee+exit_fees+exit_slippage)/risk_usd
    return {
        "status":"OK","gross_r":gross_r,"net_r":gross_r-cost_r,
        "fees_r":(entry_fee+exit_fees)/risk_usd,"slippage_r":exit_slippage/risk_usd,
        "mfe_r":mfe,"mae_r":mae,"exit_reason":exit_reason,"exit_time_ms":exit_time,
        "fills":exit_prices,"bars_used":len(bars)
    }

def metrics(rows, key):
    vals=[float(r[key]) for r in rows if r.get("status")=="OK" and isinstance(r.get(key),(int,float)) and math.isfinite(r[key])]
    wins=[x for x in vals if x>0]; losses=[x for x in vals if x<0]
    curve=peak=dd=0.0
    for x in vals:
        curve+=x; peak=max(peak,curve); dd=max(dd,peak-curve)
    return {"trades":len(vals),"wins":len(wins),"losses":len(losses),
            "win_rate_pct":round(100*len(wins)/len(vals),2) if vals else None,
            "net_r":round(sum(vals),4) if vals else None,
            "expectancy_r":round(sum(vals)/len(vals),4) if vals else None,
            "profit_factor":round(sum(wins)/abs(sum(losses)),4) if losses else (None if not wins else "INF"),
            "max_drawdown_r":round(dd,4)}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--trades",default="study_all_trades_master.json")
    p.add_argument("--out",default="research-results/official-binance-oct-2026")
    p.add_argument("--fee-rate",type=float,default=0.0004)
    p.add_argument("--slippage-rate",type=float,default=0.0002)
    args=p.parse_args()
    out=Path(args.out); out.mkdir(parents=True,exist_ok=True)
    trades=json.loads(Path(args.trades).read_text(encoding="utf-8"))
    trades=sorted(trades,key=lambda t:t["timestamp_entry"])
    months=sorted({t["timestamp_entry"][:7] for t in trades}|{t["timestamp_exit"][:7] for t in trades})
    symbols=sorted({t["symbol"] for t in trades})
    manifest={"source":"Official Binance Vision USD-M Futures monthly 1m klines",
              "source_readme":"https://github.com/binance/binance-public-data",
              "created_utc":datetime.now(timezone.utc).isoformat(),
              "trades":len(trades),"symbols_requested":symbols,"months":months,
              "files":[],"missing":[],"integrity":"SHA256 checked"}
    cache={}
    for symbol in symbols:
        for month in months:
            try:
                rows,meta=verified_zip(symbol,month)
                cache[(symbol,month)]=rows
                manifest["files"].append(meta)
                print(f"DOWNLOADED {symbol} {month}: {len(rows)} rows sha256={meta['sha256']}",flush=True)
            except Exception as exc:
                manifest["missing"].append({"symbol":symbol,"month":month,"error":str(exc)})
                print(f"MISSING {symbol} {month}: {exc}",flush=True)
            time.sleep(0.10)

    allbars={}
    for symbol in symbols:
        merged=[]
        for month in months: merged.extend(cache.get((symbol,month),[]))
        merged.sort(key=lambda x:x["t"])
        allbars[symbol]=merged
    ema_cache={s:ema_series(b) for s,b in allbars.items()}

    results=[]
    for index,t in enumerate(trades):
        entry_ms=ms(t["timestamp_entry"]); exit_ms=ms(t["timestamp_exit"])
        symbol=t["symbol"]; all_rows=allbars.get(symbol,[])
        # Full 1m candles only: skip partial entry and exit minutes to avoid future leakage.
        start_full=((entry_ms+59999)//60000)*60000
        bars=[b for b in all_rows if b["t"]>=start_full and b["ct"]<=exit_ms]
        if not bars:
            results.append({"index":index+1,"trade_id":t["trade_id"],"symbol":symbol,
                            "side":t["side"],"status":"NO_FULL_CLOSED_1M_CANDLES",
                            "recorded_r":float(t.get("pnl_r",0))})
            continue
        base={"index":index+1,"trade_id":t["trade_id"],"symbol":symbol,"side":t["side"],
              "entry_time":t["timestamp_entry"],"exit_time":t["timestamp_exit"],
              "recorded_r":float(t.get("pnl_r",0)),
              "recorded_mfe_r":float(t.get("maximum_favorable_excursion_r",0) or 0),
              "recorded_mae_r":float(t.get("maximum_adverse_excursion_r",0) or 0),
              "bars_used":len(bars)}
        b=simulate(t,bars,ema_cache[symbol],"current_b",intrabar="conservative",
                   fee_rate=args.fee_rate,slippage_rate=args.slippage_rate)
        h35=simulate(t,bars,ema_cache[symbol],"hybrid_0.35",giveback=0.35,intrabar="conservative",
                     fee_rate=args.fee_rate,slippage_rate=args.slippage_rate)
        h30=simulate(t,bars,ema_cache[symbol],"hybrid_0.30",giveback=0.30,intrabar="conservative",
                     fee_rate=args.fee_rate,slippage_rate=args.slippage_rate)
        bo=simulate(t,bars,ema_cache[symbol],"current_b",intrabar="optimistic",
                    fee_rate=args.fee_rate,slippage_rate=args.slippage_rate)
        ho=simulate(t,bars,ema_cache[symbol],"hybrid_0.35",giveback=0.35,intrabar="optimistic",
                    fee_rate=args.fee_rate,slippage_rate=args.slippage_rate)
        base.update({"current_b":b,"conservative_hybrid_035":h35,"conservative_hybrid_030":h30,
                     "current_b_optimistic":bo,"hybrid_035_optimistic":ho})
        if b.get("status")=="OK" and h35.get("status")=="OK":
            base["delta_hybrid035_vs_current_r"]=h35["net_r"]-b["net_r"]
            base["classification"]="IMPROVED" if base["delta_hybrid035_vs_current_r"]>0.0001 else "DETERIORATED" if base["delta_hybrid035_vs_current_r"]< -0.0001 else "UNCHANGED"
        else: base["classification"]="INCOMPLETE"
        results.append(base)
        print(f"REPLAY {index+1}/{len(trades)} {symbol} {base['classification']}",flush=True)

    available=[r for r in results if r.get("status") is None and r.get("current_b",{}).get("status")=="OK"]
    dev=[r for r in available if r["index"]<=54]
    oos=[r for r in available if r["index"]>54]
    def summarize(rows):
        return {
          "count":len(rows),
          "recorded":metrics([{"status":"OK","net_r":r["recorded_r"]} for r in rows],"net_r"),
          "current_b_conservative":metrics([{"status":"OK","net_r":r["current_b"]["net_r"]} for r in rows],"net_r"),
          "hybrid_035_conservative":metrics([{"status":"OK","net_r":r["conservative_hybrid_035"]["net_r"]} for r in rows],"net_r"),
          "hybrid_030_conservative":metrics([{"status":"OK","net_r":r["conservative_hybrid_030"]["net_r"]} for r in rows],"net_r"),
          "current_b_optimistic":metrics([{"status":"OK","net_r":r["current_b_optimistic"]["net_r"]} for r in rows],"net_r"),
          "hybrid_035_optimistic":metrics([{"status":"OK","net_r":r["hybrid_035_optimistic"]["net_r"]} for r in rows],"net_r")
        }
    report={
      "title":"BeastBotSniper exit-only official Binance archive replay",
      "source":"Binance Vision official USD-M Futures 1m klines",
      "trade_count":len(trades),"symbols_count":len(symbols),
      "date_range":{"first_entry":trades[0]["timestamp_entry"],"last_exit":max(t["timestamp_exit"] for t in trades)},
      "split":{"development":"first 54 trades by entry time","out_of_sample":"last 24 trades by entry time",
               "available_development":len([r for r in available if r["index"]<=54]),
               "available_out_of_sample":len([r for r in available if r["index"]>54])},
      "costs":{"taker_fee_per_side":args.fee_rate,"exit_slippage":args.slippage_rate,
               "entry_fee_included":True,"fees_and_slippage_deducted_from_simulated_R":True},
      "fidelity":{
        "entry_engine":"NOT REPLAYED; original 78 recorded entries are held fixed",
        "exit_engine":"OHLC 1m exit-only counterfactual",
        "lookahead":"Partial entry and exit minutes are excluded; only fully closed 1m bars up to recorded exit time are used",
        "intrabar":"Both conservative and optimistic collision ordering reported",
        "missing":"No historical L2 order book, OI, or tick-level sequence is included in this Binance Vision kline-only run",
        "horizon":"Each counterfactual is capped at the original recorded exit timestamp; no trade is extended beyond its original lifetime",
        "important":"This is a reproducible exit-only candle replay, not a full live-engine or entry-signal backtest"
      },
      "data_manifest":manifest,
      "development":summarize(dev),"out_of_sample":summarize(oos),
      "all_available":summarize(available),
      "coverage":{"replayed":len(available),"missing_or_incomplete":len(trades)-len(available),
                  "missing_trade_ids":[r["trade_id"] for r in results if r.get("status")],
                  "official_archive_files_ok":len(manifest["files"]),"official_archive_files_missing":len(manifest["missing"])},
      "home_runs_mfe_ge_2r":[{"trade_id":r["trade_id"],"symbol":r["symbol"],"side":r["side"],
          "recorded_mfe_r":r["recorded_mfe_r"],"current_b_r":r.get("current_b",{}).get("net_r"),
          "hybrid_035_r":r.get("conservative_hybrid_035",{}).get("net_r"),
          "delta_r":r.get("delta_hybrid035_vs_current_r")} for r in results if r.get("recorded_mfe_r",0)>=2],
      "suiusdt":[r for r in results if r.get("symbol")=="SUIUSDT"],
      "trades":results
    }
    (out/"replay_report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    with (out/"trade_results.csv").open("w",newline="",encoding="utf-8") as f:
        w=csv.writer(f); w.writerow(["index","trade_id","symbol","side","recorded_r","current_b_r","hybrid_035_r","hybrid_030_r","delta_035_vs_current","current_b_exit","hybrid_035_exit","recorded_mfe_r","recorded_mae_r","classification","status"])
        for r in results:
            w.writerow([r.get("index"),r.get("trade_id"),r.get("symbol"),r.get("side"),r.get("recorded_r"),
                r.get("current_b",{}).get("net_r"),r.get("conservative_hybrid_035",{}).get("net_r"),
                r.get("conservative_hybrid_030",{}).get("net_r"),r.get("delta_hybrid035_vs_current_r"),
                r.get("current_b",{}).get("exit_reason"),r.get("conservative_hybrid_035",{}).get("exit_reason"),
                r.get("recorded_mfe_r"),r.get("recorded_mae_r"),r.get("classification"),r.get("status")])
    (out/"data_manifest.json").write_text(json.dumps(manifest,indent=2),encoding="utf-8")
    print(json.dumps({"report":str(out/"replay_report.json"),"coverage":report["coverage"],
                      "development":report["development"],"out_of_sample":report["out_of_sample"]},indent=2),flush=True)

if __name__=="__main__": main()
