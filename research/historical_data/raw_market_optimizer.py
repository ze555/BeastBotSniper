#!/usr/bin/env python3
"""Independent raw-market strategy research on official Binance Vision archives.

The script NEVER reads recorded trade entries, exits, PnL, or historical trade logs.
The fixed universe file contains symbol names only. Signals are generated from
official 1m USD-M Futures klines; funding is charged from official fundingRate archives.
Signal at a closed candle -> market entry at the next candle open. No look-ahead.
"""
from __future__ import annotations
import argparse, bisect, concurrent.futures, csv, hashlib, io, json, math, urllib.request, zipfile
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import pandas as pd

BASE="https://data.binance.vision/data/futures/um"
START=pd.Timestamp("2026-08-15T00:00:00Z")
END=pd.Timestamp("2026-11-13T00:00:00Z")  # exclusive; includes complete UTC days through Nov 12
MONTHS=["2026-08","2026-09","2026-10","2026-11"]
KCOLS=["t","o","h","l","c","v","ct","qv","n","tbv","tbq","ignore"]
FEE=0.0004
SLIP=0.0002
MAX_HOLD=180
RISK_FRACTION=0.01
MAX_LEVERAGE=10
MAX_OPEN=10

def fetch(url, timeout=90):
    req=urllib.request.Request(url,headers={"User-Agent":"BeastBotSniper-RawMarketResearch/1.0"})
    with urllib.request.urlopen(req,timeout=timeout) as r: return r.read()

def download_zip(url):
    payload=fetch(url)
    checksum=fetch(url+".CHECKSUM").decode("utf-8","replace").strip().split()[0].lower()
    actual=hashlib.sha256(payload).hexdigest()
    if actual!=checksum: raise ValueError(f"SHA256 mismatch {url}: {actual} != {checksum}")
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        name=next((n for n in z.namelist() if n.lower().endswith(".csv")),None)
        if not name: raise ValueError("CSV missing in "+url)
        raw=z.read(name)
    return raw,actual,len(payload)

def parse_klines(raw):
    rows=[]
    for r in csv.reader(io.StringIO(raw.decode("utf-8-sig",errors="replace"))):
        if not r or not r[0].strip().isdigit(): continue
        if len(r)<11: continue
        try: rows.append((int(r[0]),float(r[1]),float(r[2]),float(r[3]),float(r[4]),float(r[5]),int(r[6]),float(r[7]),int(float(r[8])),float(r[9]),float(r[10]),0.0))
        except (ValueError,IndexError): continue
    if not rows: return pd.DataFrame(columns=KCOLS)
    d=pd.DataFrame(rows,columns=KCOLS).drop_duplicates("t").sort_values("t")
    return d[(d.t>=int(START.timestamp()*1000))&(d.t<int(END.timestamp()*1000))].reset_index(drop=True)

def parse_funding(raw):
    out=[]
    for r in csv.reader(io.StringIO(raw.decode("utf-8-sig",errors="replace"))):
        if not r or not r[0].strip().replace(".","",1).isdigit(): continue
        try:
            ts=int(float(r[0])); rate=float(r[-1])
            # Binance Vision fundingRate archive columns: calc_time, funding_interval_hours, last_funding_rate.
            if ts < 10_000_000_000: ts*=1000
            if int(START.timestamp()*1000)<=ts<int(END.timestamp()*1000):
                out.append((ts,rate))
        except (ValueError,IndexError): continue
    return sorted(set(out))

def get_symbol_data(symbol):
    kl=[]; fund=[]; meta={"symbol":symbol,"kline_files":[],"funding_files":[],"missing":[]}
    for month in MONTHS:
        ku=f"{BASE}/monthly/klines/{symbol}/1m/{symbol}-1m-{month}.zip"
        try:
            raw,sha,size=download_zip(ku); d=parse_klines(raw)
            if len(d): kl.append(d)
            meta["kline_files"].append({"month":month,"sha256":sha,"bytes":size,"rows":len(d)})
        except Exception as e: meta["missing"].append({"type":"klines","month":month,"error":str(e)})
        fu=f"{BASE}/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip"
        try:
            raw,sha,size=download_zip(fu); f=parse_funding(raw); fund.extend(f)
            meta["funding_files"].append({"month":month,"sha256":sha,"bytes":size,"rows":len(f)})
        except Exception as e: meta["missing"].append({"type":"fundingRate","month":month,"error":str(e)})
    # Monthly archives can omit early-month history for some symbols. Fill only
    # dates with no monthly bars using official daily archives; never synthesize candles.
    if kl:
        d0=pd.concat(kl,ignore_index=True).drop_duplicates("t").sort_values("t").reset_index(drop=True)
        present=set(pd.to_datetime(d0.t,unit="ms",utc=True).dt.strftime("%Y-%m-%d"))
    else:
        d0=pd.DataFrame(columns=KCOLS); present=set()
    day=pd.Timestamp(START.date(),tz="UTC")
    last_day=pd.Timestamp((END-pd.Timedelta(milliseconds=1)).date(),tz="UTC")
    while day<=last_day:
        ds=day.strftime("%Y-%m-%d")
        if ds not in present:
            du=f"{BASE}/daily/klines/{symbol}/1m/{symbol}-1m-{ds}.zip"
            try:
                raw,sha,size=download_zip(du); dd=parse_klines(raw)
                if len(dd):
                    kl.append(dd)
                    meta.setdefault("daily_fallback",[]).append({"date":ds,"sha256":sha,"bytes":size,"rows":len(dd)})
            except Exception as e:
                meta["missing"].append({"type":"daily_klines","date":ds,"error":str(e)})
        day+=pd.Timedelta(days=1)
    # Cross-check/supplement monthly archive funding with Binance's official
    # USD-M fundingRate history API (monthly archives are the archive source).
    api_url=(f"https://fapi.binance.com/fapi/v1/fundingRate?symbol={symbol}"
             f"&startTime={int(START.timestamp()*1000)}"
             f"&endTime={int(END.timestamp()*1000)-1}&limit=1000")
    try:
        api_rows=json.loads(fetch(api_url))
        api_funding=[(int(x["fundingTime"]),float(x["fundingRate"])) for x in api_rows]
        fund.extend(api_funding)
        meta["funding_api_rows"]=len(api_funding)
    except Exception as e:
        meta["funding_api_error"]=str(e)
    if not kl: return symbol,None,sorted(set(fund)),meta
    d=pd.concat(kl,ignore_index=True).drop_duplicates("t").sort_values("t").reset_index(drop=True)
    # Strict minute continuity audit; do not fabricate missing candles.
    d["gap_before"]=d.t.diff().fillna(60000).ne(60000)
    return symbol,d,sorted(set(fund)),meta

def features(d):
    c=d.c; prev=d.c.shift(1)
    tr=pd.concat([(d.h-d.l),(d.h-prev).abs(),(d.l-prev).abs()],axis=1).max(axis=1)
    d["atr"]=tr.rolling(14,min_periods=14).mean()
    d["avgqv"]=d.qv.rolling(20,min_periods=20).mean().shift(1)
    d["ret5"]=c/c.shift(5)-1
    d["prev_high_10"]=d.h.rolling(10,min_periods=10).max().shift(1)
    d["prev_low_10"]=d.l.rolling(10,min_periods=10).min().shift(1)
    d["prev_high_20"]=d.h.rolling(20,min_periods=20).max().shift(1)
    d["prev_low_20"]=d.l.rolling(20,min_periods=20).min().shift(1)
    d["delta"]=np.where(d.qv>0,(2*d.tbq/d.qv)-1,0.0)
    d["trend15"]=c/c.shift(15)-1
    d["continuous20"]=(~d.gap_before.astype(bool)).rolling(20,min_periods=20).min().fillna(0).astype(bool)
    return d

def apply_slip(price,side,entry):
    return price*(1+SLIP*(1 if (side=="LONG")==entry else -1))

def simulate(d, i, side, stop_atr, exit_mode, funding):
    # i is signal candle; enter at next minute open (never signal-close fill).
    j=i+1
    if j>=len(d): return None
    entry_raw=float(d.o.iloc[j])
    entry=apply_slip(entry_raw,side,True)
    atr=float(d.atr.iloc[i])
    if not math.isfinite(atr) or atr<=0 or entry<=0: return None
    risk_dist=atr*stop_atr
    if risk_dist/entry<0.0005 or risk_dist/entry>0.04: return None
    direction=1 if side=="LONG" else -1
    initial_stop=entry-direction*risk_dist
    active_stop=-1.0
    remaining=1.0; gross=0.0; exit_fee=0.0; funding_r=0.0
    tp1=tp2=False; mfe=0.0; mae=0.0; best=entry
    exit_reason="TIME_STOP"; exit_idx=min(len(d)-1,j+MAX_HOLD)
    f_times=[x[0] for x in funding]
    f_start=bisect.bisect_right(f_times,int(d.t.iloc[j]))
    f_end=bisect.bisect_right(f_times,int(d.t.iloc[exit_idx]))
    funding_events=funding[f_start:f_end]
    f_ptr=0
    for k in range(j,exit_idx+1):
        o=float(d.o.iloc[k]); h=float(d.h.iloc[k]); l=float(d.l.iloc[k]); c=float(d.c.iloc[k])
        favorable=(h-entry)/risk_dist if side=="LONG" else (entry-l)/risk_dist
        adverse=(l-entry)/risk_dist if side=="LONG" else (entry-h)/risk_dist
        mfe=max(mfe,favorable); mae=min(mae,adverse)
        # Funding settles against the remaining position at the official event timestamp.
        bar_close=int(d.ct.iloc[k])
        while f_ptr<len(funding_events) and funding_events[f_ptr][0]<=bar_close:
            rate=funding_events[f_ptr][1]
            funding_r += -direction*rate*(entry/risk_dist)*remaining
            f_ptr+=1
        # active_stop is measured in R along the trade direction. This sign
        # is essential: a short's initial stop must be ABOVE entry, not below.
        stop_px=entry+direction*active_stop*risk_dist
        stop_hit=(l<=stop_px) if side=="LONG" else (h>=stop_px)
        if stop_hit:
            raw=min(stop_px,o) if side=="LONG" else max(stop_px,o)
            fill=apply_slip(raw,side,False)
            gross+=direction*(fill-entry)/risk_dist*remaining
            exit_fee+=FEE*fill/risk_dist*remaining
            remaining=0; exit_reason="STOP" if active_stop<=-0.999 else "TRAIL_STOP"
            exit_idx=k; break
        targets=[]
        if exit_mode=="fixed_2R": targets=[(2.0,1.0,"TP2")]
        elif exit_mode=="staged": targets=[(0.75,0.40,"TP1"),(1.80,0.35,"TP2"),(3.50,0.25,"TP3")]
        else: targets=[(1.0,0.40,"TP1"),(3.0,0.60,"TP3")]
        target_filled_this_bar=False
        for trgt,frac,label in targets:
            if (label=="TP1" and tp1) or (label=="TP2" and tp2): continue
            px=entry+direction*trgt*risk_dist
            hit=(h>=px) if side=="LONG" else (l<=px)
            if hit and remaining>1e-9:
                frac=min(frac,remaining)
                fill=apply_slip(px,side,False)
                gross+=direction*(fill-entry)/risk_dist*frac
                exit_fee+=FEE*fill/risk_dist*frac
                remaining-=frac; exit_reason=label
                target_filled_this_bar=True
                if label=="TP1":
                    tp1=True
                    active_stop=max(active_stop,0.05)
                elif label=="TP2":
                    tp2=True; active_stop=max(active_stop,0.75)
                elif label=="TP3":
                    remaining=0
                break  # OHLC cannot establish the order of multiple intrabar targets.
        if remaining<=1e-9: exit_idx=k; break
        if exit_mode=="trail" and tp1:
            # Use only the ATR of the just-closed candle for the next candle's trailing stop.
            a=float(d.atr.iloc[k]) if math.isfinite(float(d.atr.iloc[k])) else atr
            if side=="LONG":
                best=max(best,h); trail_px=best-1.5*a
                active_stop=max(active_stop,(trail_px-entry)/risk_dist)
            else:
                best=min(best,l); trail_px=best+1.5*a
                active_stop=max(active_stop,(entry-trail_px)/risk_dist)
        # Staged stop changes apply from the next full candle, not retroactively in this candle.
    if remaining>1e-9:
        k=exit_idx; raw=float(d.c.iloc[k]); fill=apply_slip(raw,side,False)
        gross+=direction*(fill-entry)/risk_dist*remaining
        exit_fee+=FEE*fill/risk_dist*remaining
        exit_reason="TIME_STOP"
    entry_fee=FEE*entry/risk_dist
    net_r=gross-entry_fee-exit_fee+funding_r
    return {"symbol":None,"side":side,"entry_ms":int(d.t.iloc[j]),"exit_ms":int(d.t.iloc[exit_idx]),
            "net_r":net_r,"gross_r":gross,"fee_r":entry_fee+exit_fee,"funding_r":funding_r,
            "mfe_r":mfe,"mae_r":mae,"exit_reason":exit_reason,
            "stop_pct":risk_dist/entry}

def make_signal_masks(d,mode,lookback,vol_mult,delta_th):
    prev_hi=d[f"prev_high_{lookback}"].to_numpy()
    prev_lo=d[f"prev_low_{lookback}"].to_numpy()
    c=d.c.to_numpy(); o=d.o.to_numpy(); qv=d.qv.to_numpy()
    avg=d.avgqv.to_numpy(); delta=d.delta.to_numpy(); ret5=d.ret5.to_numpy()
    valid=np.isfinite(avg)&np.isfinite(d.atr.to_numpy())&(avg>0)&d.continuous20.to_numpy()
    liquid=(qv>=avg*vol_mult)
    if mode=="breakout":
        long=(c>prev_hi)&(c>o)&(delta>=delta_th)&liquid
        short=(c<prev_lo)&(c<o)&(delta<=-delta_th)&liquid
    else:
        long=(ret5>=0.0025)&(c>o)&(delta>=delta_th)&liquid
        short=(ret5<=-0.0025)&(c<o)&(delta<=-delta_th)&liquid
    return np.where(valid&long)[0],np.where(valid&short)[0]

def gen_trades(symbol,d,funding,entry_cfg,stop_atr,exit_mode):
    longs,shorts=make_signal_masks(d,entry_cfg["mode"],entry_cfg["lookback"],entry_cfg["vol_mult"],entry_cfg["delta"])
    result=[]
    for side,indices in (("LONG",longs),("SHORT",shorts)):
        busy_until=-1
        for i in indices:
            if i+1<=busy_until: continue
            t=simulate(d,int(i),side,stop_atr,exit_mode,funding)
            if not t: continue
            t["symbol"]=symbol
            result.append(t)
            # No overlapping position in the same symbol for this strategy.
            busy_until=int(np.searchsorted(d.t.to_numpy(),t["exit_ms"],side="right")-1)
    return result

def portfolio(rows):
    rows=sorted(rows,key=lambda x:(x["entry_ms"],x["symbol"],x["side"]))
    accepted=[]; active=[]
    for t in rows:
        active=[a for a in active if a["exit_ms"]>t["entry_ms"]]
        if len(active)>=MAX_OPEN: continue
        accepted.append(t); active.append(t)
    return accepted

def metrics(rows):
    # Caller applies the 10-position portfolio cap across the entire continuous
    # timeline before splitting development/validation/holdout. Realized equity
    # and drawdown must be ordered by exit time, not by entry time.
    rows=sorted(rows,key=lambda x:(x["exit_ms"],x["entry_ms"]))
    vals=[float(x["net_r"]) for x in rows]
    wins=sum(x for x in vals if x>0); losses=-sum(x for x in vals if x<0)
    curve=peak=dd=0.0
    for x in vals: curve+=x; peak=max(peak,curve); dd=max(dd,peak-curve)
    equity=1.0; max_eq=1.0; max_dd_pct=0.0
    for x in rows:
        risk_pct=min(RISK_FRACTION,x["stop_pct"]*MAX_LEVERAGE)
        equity*=1+x["net_r"]*risk_pct
        max_eq=max(max_eq,equity); max_dd_pct=max(max_dd_pct,(max_eq-equity)/max_eq)
    return {"trades":len(vals),"wins":sum(x>0 for x in vals),"win_rate_pct":round(100*sum(x>0 for x in vals)/len(vals),2) if vals else 0,
            "net_r":round(sum(vals),3),"expectancy_r":round(float(np.mean(vals)),4) if vals else 0,
            "profit_factor":round(wins/losses,3) if losses else (999 if wins else 0),
            "max_dd_r":round(dd,3),"max_dd_pct":round(max_dd_pct*100,2),
            "symbols":len(set(x["symbol"] for x in rows)),
            "longs":sum(x["side"]=="LONG" for x in rows),"shorts":sum(x["side"]=="SHORT" for x in rows),
            "funding_r":round(sum(x["funding_r"] for x in rows),3),
            "fees_r":round(sum(x["fee_r"] for x in rows),3),
            "long_net_r":round(sum(x["net_r"] for x in rows if x["side"]=="LONG"),3),
            "short_net_r":round(sum(x["net_r"] for x in rows if x["side"]=="SHORT"),3),
            "long_trades":sum(x["side"]=="LONG" for x in rows),
            "short_trades":sum(x["side"]=="SHORT" for x in rows),
            "long_pf":round((sum(x["net_r"] for x in rows if x["side"]=="LONG" and x["net_r"]>0) /
                -sum(x["net_r"] for x in rows if x["side"]=="LONG" and x["net_r"]<0)),3)
                if any(x["side"]=="LONG" and x["net_r"]<0 for x in rows) else 999,
            "short_pf":round((sum(x["net_r"] for x in rows if x["side"]=="SHORT" and x["net_r"]>0) /
                -sum(x["net_r"] for x in rows if x["side"]=="SHORT" and x["net_r"]<0)),3)
                if any(x["side"]=="SHORT" and x["net_r"]<0 for x in rows) else 999}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--universe",default="research/historical_data/universe_62_symbols.txt")
    ap.add_argument("--out",default="research-results/raw-market-optimizer-2026-08-15_to_2026-11-12")
    args=ap.parse_args()
    out=Path(args.out); out.mkdir(parents=True,exist_ok=True)
    symbols=[x.strip().upper() for x in Path(args.universe).read_text().splitlines() if x.strip()]
    symbols=sorted(set(symbols))
    manifest={"source":"Official Binance Vision USD-M Futures 1m klines + monthly fundingRate archives, supplemented by official USD-M fundingRate API",
              "source_readme":"https://github.com/binance/binance-public-data",
              "start_utc":START.isoformat(),"end_exclusive_utc":END.isoformat(),
              "universe_symbols_only":symbols,"recorded_trade_logs_read":False,
              "files":[],"symbol_coverage":[],"known_unavailable":{"historical_L2":True,"historical_OI_full_90d":True,"liquidation_tape_full":True}}
    data={}
    # Download/parse one symbol at a time to keep peak RAM bounded.
    for n,s in enumerate(symbols,1):
        try:
            sym,d,fund,meta=get_symbol_data(s)
            manifest["files"].append(meta)
            manifest["symbol_coverage"].append({"symbol":s,"bars":len(d) if d is not None else 0,
                "first_bar_utc":pd.to_datetime(d.t.iloc[0],unit="ms",utc=True).isoformat() if d is not None and len(d) else None,
                "last_bar_utc":pd.to_datetime(d.t.iloc[-1],unit="ms",utc=True).isoformat() if d is not None and len(d) else None,
                "funding_events":len(fund),"gaps":int(d.gap_before.sum()-1) if d is not None and len(d) else None})
            if d is not None and len(d)>=10000: data[s]=(features(d),fund)
            print(f"DATA {n}/{len(symbols)} {s} bars={len(d) if d is not None else 0} funding={len(fund)}",flush=True)
        except Exception as e:
            manifest["symbol_coverage"].append({"symbol":s,"bars":0,"error":str(e)})
    if len(data)<10: raise RuntimeError(f"Insufficient archive coverage: only {len(data)} symbols")
    start_ms=int(START.timestamp()*1000)
    train_end=start_ms+60*86400000
    val_end=train_end+15*86400000
    split={"development_end_ms":train_end,"validation_end_ms":val_end,"holdout_start_ms":val_end,
           "holdout_end_ms":int(END.timestamp()*1000),"development_days":60,"validation_days":15,"holdout_days":15}
    configs=[]
    for mode in ("breakout","impulse"):
      for lookback in (10,20):
       for vol in (1.5,2.0):
        for delta in (0.10,0.20):
         for stop in (1.2,1.6):
          entry={"mode":mode,"lookback":lookback,"vol_mult":vol,"delta":delta}
          for exit_mode in ("fixed_2R","staged","trail"):
            configs.append((entry,stop,exit_mode))
    all_reports=[]; trade_rows={}
    for ci,(entry,stop,exit_mode) in enumerate(configs,1):
        rows=[]
        for s,(d,fund) in data.items():
            rows.extend(gen_trades(s,d,fund,entry,stop,exit_mode))
        # Enforce concurrency across the whole continuous sample, including
        # positions that cross a split boundary.
        rows=portfolio(rows)
        train=[x for x in rows if x["entry_ms"]<train_end]
        val=[x for x in rows if train_end<=x["entry_ms"]<val_end]
        hold=[x for x in rows if x["entry_ms"]>=val_end]
        mt,mv,mh=metrics(train),metrics(val),metrics(hold)
        # Validation objective favors net R but penalizes deep drawdown and tiny samples.
        score=(mv["net_r"]-0.35*mv["max_dd_r"]) if mv["trades"]>=20 else -1e9
        report={"config_id":ci,"entry":entry,"stop_atr":stop,"exit":exit_mode,
                "development":mt,"validation":mv,"holdout":mh,"validation_score":round(score,4)}
        all_reports.append(report)
        trade_rows[str(ci)]=rows
        print(f"CFG {ci}/{len(configs)} {entry} SL{stop} {exit_mode} VAL={mv['net_r']}R PF={mv['profit_factor']} n={mv['trades']} OOS={mh['net_r']}R",flush=True)
    eligible=[x for x in all_reports if x["validation"]["trades"]>=20]
    ranked=sorted(eligible,key=lambda x:(x["validation_score"],x["validation"]["profit_factor"],x["validation"]["trades"]),reverse=True)
    # Choose on validation only; the final holdout is not used for parameter selection.
    selected=ranked[0] if ranked else None
    holdout_result=None; selected_trades=[]
    if selected:
        selected_trades=trade_rows[str(selected["config_id"])]
        hold=[x for x in selected_trades if x["entry_ms"]>=val_end]
        holdout_result=metrics(hold)
    report={"title":"Independent raw-market strategy optimization (no recorded trades)",
      "date_range_utc":{"start":START.isoformat(),"end_exclusive":END.isoformat()},
      "universe":{"requested":len(symbols),"with_sufficient_official_data":len(data),"symbols_with_data":sorted(data)},
      "split":split,"execution":{"signal":"closed 1m candle","entry":"next 1m candle open with adverse 2bp slippage",
        "exit":"1m OHLC with conservative stop-first intrabar ordering","fee_per_side":FEE,"slippage_per_side":SLIP,
        "max_holding_minutes":MAX_HOLD,"max_concurrent_positions":MAX_OPEN,"risk_per_trade":RISK_FRACTION,
        "max_leverage":MAX_LEVERAGE,"funding":"official monthly fundingRate archives cross-checked/supplemented by Binance fundingRate API; charged at settlement using entry notional approximation"},
      "fidelity":{"recorded_trade_logs_read":False,"entry_and_exit_generated_from_raw_market_data":True,
        "lookahead":"No; signal at candle close, enter next candle open, rolling features use only prior closed bars",
        "intrabar":"Ambiguous same-minute stop/target collisions resolve against the strategy",
        "historical_L2":"Unavailable in this test; no fabricated book data",
        "historical_OI":"Not used; official OI history is limited to the latest 30 days and does not cover the full 90-day window",
        "liquidations":"Not used; no complete historical force-order tape",
        "limitations":"Universe is the pinned 62-symbol research universe, not a full all-contract exchange census; report coverage exposes missing symbols."},
      "data_manifest":manifest,"configs_tested":len(configs),"selection":"highest validation netR - 0.35*validation maxDD among configs with >=20 validation trades; holdout not used to select",
      "selected_config":selected,"selected_holdout_recalculated":holdout_result,
      "top_validation_configs":ranked[:10],"all_configs":all_reports}
    (out/"optimization_report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    with (out/"all_configs.csv").open("w",newline="") as f:
      w=csv.writer(f); w.writerow(["id","entry_mode","lookback","volume_mult","delta_threshold","stop_atr","exit","train_R","train_PF","train_n","val_R","val_PF","val_n","val_DD_R","holdout_R","holdout_PF","holdout_n","score"])
      for x in all_reports:
        w.writerow([x["config_id"],x["entry"]["mode"],x["entry"]["lookback"],x["entry"]["vol_mult"],x["entry"]["delta"],x["stop_atr"],x["exit"],
          x["development"]["net_r"],x["development"]["profit_factor"],x["development"]["trades"],x["validation"]["net_r"],x["validation"]["profit_factor"],x["validation"]["trades"],x["validation"]["max_dd_r"],x["holdout"]["net_r"],x["holdout"]["profit_factor"],x["holdout"]["trades"],x["validation_score"]])
    if selected:
      with (out/"selected_holdout_trades.csv").open("w",newline="") as f:
        w=csv.DictWriter(f,fieldnames=list(selected_trades[0].keys()) if selected_trades else ["symbol","side","entry_ms","exit_ms","net_r"])
        w.writeheader(); w.writerows([x for x in selected_trades if x["entry_ms"]>=val_end])
    print(json.dumps({"coverage":{"requested":len(symbols),"usable":len(data)},"selected":selected,
      "selected_holdout":holdout_result,"report":str(out/"optimization_report.json")},indent=2),flush=True)

if __name__=="__main__": main()
