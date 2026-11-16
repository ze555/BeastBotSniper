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
    d["trend60"]=c/c.shift(60)-1
    signed=2*d.tbq-d.qv
    d["flow5"]=signed.rolling(5).sum()/d.qv.rolling(5).sum().replace(0,np.nan)
    d["flow15"]=signed.rolling(15).sum()/d.qv.rolling(15).sum().replace(0,np.nan)
    d["flow5_prev"]=d.flow5.shift(1)
    d["flow5_lag3"]=d.flow5.shift(3)
    d["range_prev20"]=(d.h.rolling(20).max()-d.l.rolling(20).min()).shift(1)
    d["prior_close"]=c.shift(1)
    d["prev_high_5"]=d.h.rolling(5,min_periods=5).max().shift(1)
    d["prev_low_5"]=d.l.rolling(5,min_periods=5).min().shift(1)
    d["range_frac"]=(d.h-d.l)/d.c.replace(0,np.nan)
    d["close_location"]=(d.c-d.l)/(d.h-d.l).replace(0,np.nan)
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
    if risk_dist/entry<4*(2*(FEE+SLIP)) or risk_dist/entry>0.04: return None  # fee-aware stop distance
    direction=1 if side=="LONG" else -1
    initial_stop=entry-direction*risk_dist
    active_stop=-1.0
    remaining=1.0; gross=0.0; exit_fee=0.0; funding_r=0.0
    tp1=tp2=False; mfe=0.0; mae=0.0; best=entry
    exit_reason="TIME_STOP"; exit_idx=min(len(d)-1,j+MAX_HOLD)
    f_times=[x[0] for x in funding]
    f_start=bisect.bisect_right(f_times,int(d.t.iloc[j]))
    f_end=bisect.bisect_right(f_times,int(d.ct.iloc[exit_idx]))
    funding_events=funding[f_start:f_end]
    f_ptr=0
    for k in range(j,exit_idx+1):
        o=float(d.o.iloc[k]); h=float(d.h.iloc[k]); l=float(d.l.iloc[k]); c=float(d.c.iloc[k])
        favorable=(h-entry)/risk_dist if side=="LONG" else (entry-l)/risk_dist
        adverse=(l-entry)/risk_dist if side=="LONG" else (entry-h)/risk_dist
        mfe=max(mfe,favorable); mae=min(mae,adverse)
        # Flow reversal is known from two fully closed bars; fill next open.
        if exit_mode in ("flow_exit","flow_guard") and k>=j+2:
            fa=float(d.flow5.iloc[k-1]); fb=float(d.flow5.iloc[k-2])
            tr=float(d.trend15.iloc[k-1])
            reverse=(fa< -0.06 and fb< -0.03 and tr<0) if direction==1 else (fa>0.06 and fb>0.03 and tr>0)
            if reverse and direction*(o-entry)/risk_dist>(0.05 if exit_mode=="flow_guard" else 0.25):
                fill=apply_slip(o,side,False)
                gross+=direction*(fill-entry)/risk_dist*remaining
                exit_fee+=FEE*fill/risk_dist*remaining
                remaining=0; exit_reason="FLOW_REVERSAL"; exit_idx=k; break
        bar_close=int(d.ct.iloc[k])
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
        elif exit_mode in ("staged","flow_exit","early_guard","flow_guard","atr_guard"): targets=[(0.75,0.40,"TP1"),(1.80,0.35,"TP2"),(3.50,0.25,"TP3")]
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
        while f_ptr<len(funding_events) and funding_events[f_ptr][0]<=bar_close:
            rate=funding_events[f_ptr][1]
            funding_r += -direction*rate*(entry/risk_dist)*remaining
            f_ptr+=1
        if exit_mode=="trail" and tp1:
            # Use only the ATR of the just-closed candle for the next candle's trailing stop.
            a=float(d.atr.iloc[k]) if math.isfinite(float(d.atr.iloc[k])) else atr
            if side=="LONG":
                best=max(best,h); trail_px=best-1.5*a
                active_stop=max(active_stop,(trail_px-entry)/risk_dist)
            else:
                best=min(best,l); trail_px=best+1.5*a
                active_stop=max(active_stop,(entry-trail_px)/risk_dist)
        # Additional exit-only policies use information from the CLOSED bar k.
        # The updated stop can only execute on bar k+1, avoiding look-ahead.
        if exit_mode in ("early_guard","flow_guard","atr_guard") and remaining>1e-9:
            current_favorable=direction*(c-entry)/risk_dist
            if exit_mode=="early_guard" and current_favorable>=0.55:
                active_stop=max(active_stop,0.0)
            if exit_mode=="flow_guard" and current_favorable>=0.40:
                active_stop=max(active_stop,-0.15)
            if exit_mode=="atr_guard" and current_favorable>=0.75:
                a=float(d.atr.iloc[k])
                if math.isfinite(a) and a>0:
                    trailing=(c-1.2*a) if direction==1 else (c+1.2*a)
                    active_stop=max(active_stop,direction*(trailing-entry)/risk_dist)
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
    """Only completed candles; trend and sweep filters are observational proxies,
    not historical order-book or open-interest evidence."""
    prev_hi=d[f"prev_high_{lookback}"].to_numpy()
    prev_lo=d[f"prev_low_{lookback}"].to_numpy()
    hi5=d.prev_high_5.to_numpy(); lo5=d.prev_low_5.to_numpy()
    c=d.c.to_numpy(); o=d.o.to_numpy(); h=d.h.to_numpy(); l=d.l.to_numpy()
    qv=d.qv.to_numpy(); avg=d.avgqv.to_numpy()
    delta=d.delta.to_numpy(); ret5=d.ret5.to_numpy()
    flow5=d.flow5.to_numpy(); flow15=d.flow15.to_numpy(); flow_prev=d.flow5_prev.to_numpy()
    flow_lag3=d.flow5_lag3.to_numpy(); prior_range=d.range_prev20.to_numpy()
    trend15=d.trend15.to_numpy(); trend60=d.trend60.to_numpy()
    close_loc=d.close_location.to_numpy()
    atr=d.atr.to_numpy()
    valid=(np.isfinite(flow5)&np.isfinite(flow15)&np.isfinite(flow_prev)
           &np.isfinite(avg)&np.isfinite(atr)&np.isfinite(trend60)
           &np.isfinite(close_loc)&(avg>0)&(atr>0)
           &d.continuous20.to_numpy())
    liquid=qv>=avg*vol_mult
    # Exclude late, stretched candles and low-quality closes; avoid chasing
    # the final minute of an already exhausted pump/dump.
    stretch=(h-l)<=3.0*atr
    bullish=(close_loc>=0.70)&(c>o)&(delta>=delta_th)&(flow5>=0.08)&(flow15>=0.03)
    bearish=(close_loc<=0.30)&(c<o)&(delta<=-delta_th)&(flow5<=-0.08)&(flow15<=-0.03)
    if mode in ("reclaim_confirm_1","reclaim_confirm_2"):
        # Previous candle swept a shifted range and reclaimed it. Wait for
        # one/two COMPLETED confirming candles before entering next open.
        lag=1 if mode=="reclaim_confirm_1" else 2
        sweep_long=(l<prev_lo)&(c>prev_lo)&bullish&stretch&(flow5>=flow_prev)
        sweep_short=(h>prev_hi)&(c<prev_hi)&bearish&stretch&(flow5<=flow_prev)
        prior_long=np.roll(sweep_long,lag); prior_short=np.roll(sweep_short,lag)
        prior_long[:lag]=False; prior_short[:lag]=False
        # All comparisons use only signal candle and completed prior candles.
        sweep_close=np.roll(c,lag)
        sweep_close[:lag]=np.nan
        if lag==2:
            mid_close=np.roll(c,1); mid_close[0]=np.nan
            mid_ok_long=mid_close>=sweep_close
            mid_ok_short=mid_close<=sweep_close
        else:
            mid_ok_long=np.ones(len(c),dtype=bool)
            mid_ok_short=np.ones(len(c),dtype=bool)
        long=prior_long&mid_ok_long&(c>sweep_close)&(c>o)&(flow5>0.02)&(delta>0)&(close_loc>0.55)&stretch
        short=prior_short&mid_ok_short&(c<sweep_close)&(c<o)&(flow5< -0.02)&(delta<0)&(close_loc<0.45)&stretch
        # Liquidity threshold applies to sweep, not confirmation candle.
        sweep_liquid=np.roll(liquid,lag); sweep_liquid[:lag]=False
        liquid=sweep_liquid
    elif mode=="breakout_confirmed":
        long=(c>prev_hi)&bullish&(trend15>0)&(trend60>0)&stretch
        short=(c<prev_lo)&bearish&(trend15<0)&(trend60<0)&stretch
    elif mode=="pullback_resume":
        # A short countertrend retracement followed by renewed taker flow.
        long=(trend60>0.003)&(trend15>0)&(ret5<0.002)&(c>hi5)&bullish&stretch
        short=(trend60< -0.003)&(trend15<0)&(ret5> -0.002)&(c<lo5)&bearish&stretch
    elif mode=="flow_ignition":
        # Enter as signed taker pressure accelerates before a 10/20-bar breakout.
        # Avoid already extended moves; prior range is strictly shifted.
        acceleration=flow5-flow_lag3
        early=(np.abs(ret5)<0.012)&(prior_range>0)&(prior_range<12*atr)
        long=(flow5>0.12)&(flow15>0.02)&(acceleration>0.08)&(c>o)&(close_loc>0.60)&(trend15>0)&(c<prev_hi)&early&stretch
        short=(flow5< -0.12)&(flow15< -0.02)&(acceleration< -0.08)&(c<o)&(close_loc<0.40)&(trend15<0)&(c>prev_lo)&early&stretch
    elif mode=="sweep_reclaim":
        # A liquidity sweep and reclaim, with recovering 5-minute taker flow.
        # The 15-minute trend is not required to have flipped yet.
        long=(l<prev_lo)&(c>prev_lo)&(close_loc>0.65)&(delta>0.10)&(flow5>flow_lag3+0.05)&(flow5>0.02)&stretch
        short=(h>prev_hi)&(c<prev_hi)&(close_loc<0.35)&(delta< -0.10)&(flow5<flow_lag3-0.05)&(flow5< -0.02)&stretch
    elif mode=="failed_breakout_reversal":
        # Prior-range liquidity sweep followed by a close back inside the range.
        # Require opposite taker dominance; no synthetic L2/whale data.
        long=(l<prev_lo)&(c>prev_lo)&bullish&stretch
        short=(h>prev_hi)&(c<prev_hi)&bearish&stretch
    else:
        raise ValueError(f"Unknown entry mode: {mode}")
    # Confirmation modes require direction-consistent flow on the last candle;
    # other modes retain their original momentum-persistence condition.
    if mode not in ("reclaim_confirm_1","reclaim_confirm_2"):
        long=long&(flow5>=flow_prev)
        short=short&(flow5<=flow_prev)
    return np.where(valid&liquid&long)[0],np.where(valid&liquid&short)[0]

def gen_trades(symbol,d,funding,entry_cfg,stop_atr,exit_mode):
    longs,shorts=make_signal_masks(d,entry_cfg["mode"],entry_cfg["lookback"],entry_cfg["vol_mult"],entry_cfg["delta"])
    # Merge LONG and SHORT signals into one chronological stream. A symbol can
    # never hold both directions at once (One-way futures position semantics).
    signals=sorted([(int(i),"LONG") for i in longs]+[(int(i),"SHORT") for i in shorts],key=lambda x:(x[0],x[1]))
    result=[]; busy_until=-1; times=d.t.to_numpy()
    for i,side in signals:
        if i+1<=busy_until: continue
        t=simulate(d,i,side,stop_atr,exit_mode,funding)
        if not t: continue
        t["symbol"]=symbol
        avg=max(float(d.avgqv.iloc[i]),1e-12)
        t["signal_strength"]=float((float(d.qv.iloc[i])/avg) + abs(float(d.delta.iloc[i])) + abs(float(d.ret5.iloc[i]))*10.0)
        result.append(t)
        busy_until=int(np.searchsorted(times,t["exit_ms"],side="right")-1)
    return result

def portfolio(rows):
    # Enforce the global concurrent-position cap without alphabetical bias:
    # at identical entry times, prefer stronger relative volume/flow signals.
    rows=sorted(rows,key=lambda x:(x["entry_ms"],-x.get("signal_strength",0.0),x["symbol"],x["side"]))
    accepted=[]; active=[]
    for t in rows:
        active=[a for a in active if a["exit_ms"]>t["entry_ms"]]
        # One-way mode: no duplicate/opposite-side exposure on the same symbol.
        if any(a["symbol"]==t["symbol"] for a in active): continue
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
    ap.add_argument("--cache",default="research-cache/raw-market-data")
    args=ap.parse_args()
    out=Path(args.out); out.mkdir(parents=True,exist_ok=True)
    cache=Path(args.cache); cache.mkdir(parents=True,exist_ok=True)
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
            cached_csv=cache/f"{s}.csv.gz"
            cached_funding=cache/f"{s}.funding.json"
            cached_meta=cache/f"{s}.meta.json"
            if cached_csv.exists() and cached_funding.exists() and cached_meta.exists():
                d=pd.read_csv(cached_csv,compression="gzip")
                for col in ("t","ct","n"): d[col]=d[col].astype("int64")
                d["gap_before"]=d.t.diff().fillna(60000).ne(60000)
                fund=[(int(x[0]),float(x[1])) for x in json.loads(cached_funding.read_text())]
                meta=json.loads(cached_meta.read_text())
                print(f"CACHE HIT {s} bars={len(d)} funding={len(fund)}",flush=True)
            else:
                sym,d,fund,meta=get_symbol_data(s)
                if d is not None and len(d):
                    d.to_csv(cached_csv,index=False,compression="gzip")
                    cached_funding.write_text(json.dumps(fund),encoding="utf-8")
                    cached_meta.write_text(json.dumps(meta),encoding="utf-8")
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
    # Focused audit: 12 combinations instead of another multi-hour 48-case sweep.
    # Reuse exactly the cached 62-symbol market sample.
    configs=[]
    # Autonomous bounded multi-stage search, without touching production.
    # All candidates are compared on development/validation; the holdout is
    # disclosed only for the final validation-selected candidate.
    configs.append(({"mode":"failed_breakout_reversal","lookback":20,"vol_mult":2.0,"delta":0.2},1.6,"staged"))
    stages=[
      ("entry_family",[(m,lb,v,sl,"staged") for m in
          ("failed_breakout_reversal","reclaim_confirm_1","reclaim_confirm_2",
           "breakout_confirmed","pullback_resume","flow_ignition","sweep_reclaim")
          for lb in (10,20) for v in (1.3,2.0) for sl in (1.2,1.6)]),
      ("execution",[]),
      ("robustness",[])]
    # First pass is broad, later stages are generated from validation winners.
    stage_candidates=stages[0][1]
    for m,lb,v,sl,ex in stage_candidates:
        candidate=({"mode":m,"lookback":lb,"vol_mult":v,"delta":0.2},sl,ex)
        if candidate not in configs: configs.append(candidate)
    all_reports=[]; trade_rows={}
    progress=out/"incremental_configs.jsonl"
    progress.write_text("",encoding="utf-8")
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
        with progress.open("a",encoding="utf-8") as fp: fp.write(json.dumps(report)+"\n")
        trade_rows[str(ci)]=rows
        print(f"CFG {ci}/{len(configs)} {entry} SL{stop} {exit_mode} VAL={mv['net_r']}R PF={mv['profit_factor']} n={mv['trades']} OOS={mh['net_r']}R",flush=True)
    # Stage 2: refine exit method and delta/volume around top validation
    # families. Stage 3: local stop/volume robustness. All stages finish in
    # this one workflow run, with a bounded candidate budget.
    stage_summaries=[{"stage":"entry_family","candidates":len(all_reports)}]
    def run_candidate(entry,stop,exit_mode,stage):
        key=(entry["mode"],entry["lookback"],entry["vol_mult"],entry["delta"],stop,exit_mode)
        if key in evaluated:return
        evaluated.add(key)
        rows=[]
        for symbol,(df,fund) in data.items():
            rows.extend(gen_trades(symbol,df,fund,entry,stop,exit_mode))
        rows=portfolio(rows)
        tr=[x for x in rows if x["entry_ms"]<train_end]
        va=[x for x in rows if train_end<=x["entry_ms"]<val_end]
        ho=[x for x in rows if x["entry_ms"]>=val_end]
        mt,mv,mh=metrics(tr),metrics(va),metrics(ho)
        cid=len(all_reports)+1
        score=mv["net_r"]-0.35*mv["max_dd_r"] if mv["trades"]>=20 else -1e9
        record={"config_id":cid,"entry":entry,"stop_atr":stop,"exit":exit_mode,
                "development":mt,"validation":mv,"holdout":mh,"validation_score":round(score,4),"stage":stage}
        all_reports.append(record);trade_rows[str(cid)]=rows
        with progress.open("a",encoding="utf-8") as fp:fp.write(json.dumps(record)+"\\n")
        print(f"STAGE {stage} CFG {cid} {entry} SL{stop} {exit_mode} VAL={mv['net_r']}R PF={mv['profit_factor']} n={mv['trades']}",flush=True)
    evaluated={(x["entry"]["mode"],x["entry"]["lookback"],x["entry"]["vol_mult"],x["entry"]["delta"],x["stop_atr"],x["exit"]) for x in all_reports}
    def leaders():
        viable=[x for x in all_reports if x["validation"]["trades"]>=20 and
                x["development"]["trades"]>=40]
        return sorted(viable,key=lambda x:(x["validation"]["net_r"]-0.35*x["validation"]["max_dd_r"],
                   x["validation"]["profit_factor"]),reverse=True)
    # Stage 2: best two families plus baseline; vary exit and flow threshold.
    seeds=leaders()[:2]+all_reports[:1]
    for seed in seeds:
        for exit_mode in ("staged","flow_exit","fixed_2R"):
            for delta_th in (0.1,0.2,0.3):
                entry=dict(seed["entry"]);entry["delta"]=delta_th
                run_candidate(entry,seed["stop_atr"],exit_mode,"execution")
    stage_summaries.append({"stage":"execution","candidates":len(all_reports)-stage_summaries[0]["candidates"]})
    # Stage 3: explore a small local neighborhood, never unrestricted grid search.
    prior=len(all_reports)
    for seed in leaders()[:3]:
        for stop in (1.2,1.6,2.0):
            for vol in (1.3,1.8,2.0):
                entry=dict(seed["entry"]);entry["vol_mult"]=vol
                run_candidate(entry,stop,seed["exit"],"robustness")
    stage_summaries.append({"stage":"robustness","candidates":len(all_reports)-prior})
    print("STAGE_SUMMARY",json.dumps(stage_summaries),flush=True)
    # Rolling-origin audit. This is a diagnostic, not fresh OOS evidence:
    # candidate families have already been inspected on this historical range.
    # Select solely on each fold's prior 30-day window; evaluate next 15 days.
    wf_folds=[]
    start_ms=int(START.timestamp()*1000)
    day_ms=86400000
    for fold_index in (0,1,2):
        train_start=start_ms+fold_index*15*day_ms
        train_stop=train_start+30*day_ms
        test_stop=train_stop+15*day_ms
        scored=[]
        for cfg in all_reports:
            trades=trade_rows[str(cfg["config_id"])]
            tr=metrics([t for t in trades if train_start<=t["entry_ms"]<train_stop])
            if tr["trades"]<15 or tr["net_r"]<=0 or tr["profit_factor"]<=1.0:continue
            scored.append((tr["net_r"]-0.35*tr["max_dd_r"],cfg,tr))
        scored.sort(key=lambda v:v[0],reverse=True)
        winner=scored[0] if scored else None
        test=metrics([t for t in trade_rows[str(winner[1]["config_id"])]
                      if train_stop<=t["entry_ms"]<test_stop]) if winner else None
        result={"fold":fold_index+1,"train_start_ms":train_start,
                "train_end_ms":train_stop,"test_end_ms":test_stop,
                "eligible_candidates":len(scored),
                "selected_config_id":winner[1]["config_id"] if winner else None,
                "train_metrics":winner[2] if winner else None,"test_metrics":test}
        wf_folds.append(result)
        print("WALK_FORWARD",json.dumps(result),flush=True)
    wf_positive=sum(bool(x["test_metrics"] and x["test_metrics"]["net_r"]>0) for x in wf_folds)
    wf_report={"folds":wf_folds,"positive_folds":wf_positive,
               "passed":wf_positive==3 and all(x["test_metrics"] and
                         x["test_metrics"]["trades"]>=10 and
                         x["test_metrics"]["profit_factor"]>=1.2 for x in wf_folds),
               "caveat":"Exploratory reused historical data; not a new untouched holdout"}
    (out/"walk_forward_audit.json").write_text(json.dumps(wf_report,indent=2),encoding="utf-8")
    print("WALK_FORWARD_SUMMARY",json.dumps({"positive_folds":wf_positive,"passed":wf_report["passed"]}),flush=True)
    eligible=[x for x in all_reports if x["validation"]["trades"]>=20]
    ranked=sorted(eligible,key=lambda x:(x["validation"]["profit_factor"],x["validation"]["expectancy_r"],-x["validation"]["max_dd_pct"]),reverse=True)
    # Choose on validation only; the final holdout is not used for parameter selection.
    selected=ranked[0] if ranked and ranked[0]["validation"]["profit_factor"]>1 and ranked[0]["validation"]["expectancy_r"]>0 else None
    holdout_result=None; selected_trades=[]
    if selected:
        selected_trades=trade_rows[str(selected["config_id"])]
        hold=[x for x in selected_trades if x["entry_ms"]>=val_end]
        holdout_result=metrics(hold)
    # EXIT-ONLY EXPERIMENT: lock the original CFG34 entry timestamps, symbols and sides.
    # No entry filter or signal generation is changed. Re-simulate from archived 1m bars.
    baseline=next((r for r in all_reports if r["config_id"]==34 and
                   r["entry"]["mode"]=="pullback_resume"),None)
    if baseline:
        fixed_entries=trade_rows["34"]
        by_symbol={}
        for sym,(df,funding) in data.items():
            by_symbol[sym]=(df,funding,{int(t):i for i,t in enumerate(df.t.to_numpy())})
        exit_tests=[]
        for stop in (1.6,):  # preserve all 104 CFG34 entries; no stop-distance eligibility drift
            for exit_style in ("staged","fixed_2R","trail","flow_exit","early_guard","flow_guard","atr_guard"):
                replay=[]
                missing=0
                for original in fixed_entries:
                    df,funding,lookup=by_symbol[original["symbol"]]
                    j=lookup.get(original["entry_ms"])
                    if j is None or j<1:
                        missing+=1;continue
                    trade=simulate(df,j-1,original["side"],stop,exit_style,funding)
                    if trade is None:
                        missing+=1;continue
                    trade["symbol"]=original["symbol"]
                    replay.append(trade)
                dev=[x for x in replay if x["entry_ms"]<train_end]
                val=[x for x in replay if train_end<=x["entry_ms"]<val_end]
                hold=[x for x in replay if x["entry_ms"]>=val_end]
                result={"stop_atr":stop,"exit":exit_style,"fixed_entries":len(fixed_entries),
                        "replayed":len(replay),"missing":missing,
                        "development":metrics(dev),"validation":metrics(val),
                        "holdout":metrics(hold),
                        "note":"Fixed-entry counterfactual; overlapping exits may invalidate original portfolio occupancy"}
                exit_tests.append(result)
                print("EXIT_ONLY",json.dumps({"stop_atr":stop,"exit":exit_style,
                     "development":result["development"],"missing":missing}),flush=True)
        # Selection is STRICTLY development-only; validation/holdout are audits.
        eligible_exit=[x for x in exit_tests if x["missing"]==0 and
                       x["development"]["trades"]==baseline["development"]["trades"]]
        exit_rank=sorted(eligible_exit,key=lambda x:(
            x["development"]["net_r"]-0.4*x["development"]["max_dd_r"],
            x["development"]["profit_factor"]),reverse=True)
        winner_exit=exit_rank[0] if exit_rank else None
        exit_report={"baseline_config":34,"baseline":baseline,
            "fixed_entry_experiment":True,"exit_variants":exit_tests,
            "selected_on_development_only":winner_exit,
            "warning":"This is in-sample optimization; do not deploy without forward/out-of-sample confirmation."}
        (out/"exit_only_cfg34.json").write_text(json.dumps(exit_report,indent=2),encoding="utf-8")
        print("EXIT_ONLY_WINNER",json.dumps(winner_exit),flush=True)
    # Explain losses using generated trades only; no historical bot logs.
    # Report every configuration by symbol, direction, and UTC entry-hour,
    # plus MFE/MAE and fee burden. Holdout is diagnostic, never selection.
    diagnostics={}
    for config in all_reports:
        cid=str(config["config_id"])
        rows=trade_rows[cid]
        splits={"development":[x for x in rows if x["entry_ms"]<train_end],
                "validation":[x for x in rows if train_end<=x["entry_ms"]<val_end],
                "holdout":[x for x in rows if x["entry_ms"]>=val_end]}
        per_split={}
        for split_name, subset in splits.items():
            def grouped(keyfn):
                groups={}
                for trade in subset:
                    key=str(keyfn(trade))
                    groups.setdefault(key,[]).append(trade)
                return {key:metrics(group) for key,group in sorted(groups.items())}
            winners=[x for x in subset if x["net_r"]>0]
            losers=[x for x in subset if x["net_r"]<=0]
            def summary(group):
                if not group:return {"trades":0}
                return {"trades":len(group),
                        "avg_mfe_r":round(float(np.mean([x["mfe_r"] for x in group])),4),
                        "avg_mae_r":round(float(np.mean([x["mae_r"] for x in group])),4),
                        "avg_fee_r":round(float(np.mean([x["fee_r"] for x in group])),4),
                        "avg_funding_r":round(float(np.mean([x["funding_r"] for x in group])),4),
                        "avg_gross_r":round(float(np.mean([x["gross_r"] for x in group])),4),
                        "avg_net_r":round(float(np.mean([x["net_r"] for x in group])),4),
                        "had_1r_favorable_pct":round(100*sum(x["mfe_r"]>=1 for x in group)/len(group),2)}
            per_split[split_name]={
                "by_side":grouped(lambda x:x["side"]),
                "by_symbol":grouped(lambda x:x["symbol"]),
                "by_entry_hour_utc":grouped(lambda x:pd.to_datetime(x["entry_ms"],unit="ms",utc=True).hour),
                "by_exit_reason":grouped(lambda x:x["exit_reason"]),
                "all_trades":summary(subset),"winners":summary(winners),"losers":summary(losers)}
        diagnostics[cid]=per_split
    (out/"trade_diagnostics.json").write_text(json.dumps(diagnostics,indent=2),encoding="utf-8")
    # A compact human-readable diagnostic table, for subsequent hypothesis design.
    with (out/"loss_diagnostics.csv").open("w",newline="") as fp:
        w=csv.writer(fp)
        w.writerow(["config_id","split","side","trades","net_r","pf","avg_mfe_r","avg_mae_r","avg_fee_r","losers_reached_1R_pct"])
        for cid,by_split in diagnostics.items():
            for split_name,detail in by_split.items():
                for side,side_stats in detail["by_side"].items():
                    side_rows=[x for x in trade_rows[cid] if x["side"]==side and
                               (x["entry_ms"]<train_end if split_name=="development" else
                                train_end<=x["entry_ms"]<val_end if split_name=="validation" else x["entry_ms"]>=val_end)]
                    loss=[x for x in side_rows if x["net_r"]<=0]
                    w.writerow([cid,split_name,side,side_stats["trades"],side_stats["net_r"],side_stats["profit_factor"],
                                round(float(np.mean([x["mfe_r"] for x in side_rows])),4) if side_rows else 0,
                                round(float(np.mean([x["mae_r"] for x in side_rows])),4) if side_rows else 0,
                                round(float(np.mean([x["fee_r"] for x in side_rows])),4) if side_rows else 0,
                                round(100*sum(x["mfe_r"]>=1 for x in loss)/len(loss),2) if loss else 0])
    print("DIAGNOSTICS: trade_diagnostics.json and loss_diagnostics.csv written",flush=True)
    # Print a compact, inspectable summary in GitHub Actions logs; the full
    # ZIP artifact is too large to inspect interactively.
    for config in all_reports:
        cid=str(config["config_id"])
        if cid not in ("1","2","10","17"):continue
        print("AUDIT_CONFIG",cid,config["entry"]["mode"],flush=True)
        for split_name in ("development","validation","holdout"):
            d=diagnostics[cid][split_name]
            print("AUDIT",cid,split_name,"ALL",json.dumps(d["all_trades"]),flush=True)
            print("AUDIT",cid,split_name,"LOSERS",json.dumps(d["losers"]),flush=True)
            print("AUDIT",cid,split_name,"SIDES",json.dumps(d["by_side"]),flush=True)
            for group_name in ("by_symbol","by_entry_hour_utc","by_exit_reason"):
                items=sorted(d[group_name].items(),key=lambda item:item[1]["net_r"])
                print("AUDIT",cid,split_name,group_name,"worst",json.dumps(items[:8]),flush=True)
                print("AUDIT",cid,split_name,group_name,"best",json.dumps(items[-5:]),flush=True)

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
      "data_manifest":manifest,"configs_tested":len(all_reports),"stage_summaries":stage_summaries,"walk_forward_audit":wf_report,"selection":"highest validation profit factor, then expectancy, among configs with >=20 validation trades; holdout not used to select",
      "acceptance":{"minimum_holdout_pf":1.5,"positive_holdout_expectancy":True,"passed":bool(selected and holdout_result and holdout_result["profit_factor"]>=1.5 and holdout_result["expectancy_r"]>0)},
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
