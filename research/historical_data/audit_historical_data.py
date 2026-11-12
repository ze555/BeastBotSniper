#!/usr/bin/env python3
"""Audit downloaded Binance Futures Parquet data; fail closed on broken L2 chains."""
from __future__ import annotations
import argparse, json
from pathlib import Path
import pandas as pd

def audit_orderbook(path: Path):
    df = pd.read_parquet(path)
    required = {"received_time","event_time","event_type","side","price","quantity"}
    missing = sorted(required - set(df.columns))
    if missing:
        return {"status":"INVALID_SCHEMA","missing_columns":missing,"rows":len(df)}
    df = df.sort_values("received_time", kind="stable")
    df["price"] = pd.to_numeric(df["price"], errors="coerce")
    df["quantity"] = pd.to_numeric(df["quantity"], errors="coerce")
    bad = int((df[["price","quantity"]].isna().any(axis=1) | (df.price <= 0) | (df.quantity < 0)).sum())
    # One exchange event can update many price levels. Collapse rows into message events
    # without changing their first-seen order.
    keys = [c for c in ["event_type","first_update_id","final_update_id","prev_final_update_id","last_update_id","event_time"] if c in df]
    events = df.drop_duplicates(keys, keep="first") if keys else df.iloc[0:0]
    bids, asks, last_u, have_snapshot = {}, {}, None, False
    gaps, crossed, updates = [], 0, 0
    for _, ev in events.iterrows():
        kind = str(ev.event_type).lower()
        if kind == "snapshot":
            bids.clear(); asks.clear(); last_u = ev.get("last_update_id")
            if pd.isna(last_u): last_u = ev.get("final_update_id")
            have_snapshot = True
        elif kind == "update":
            if not have_snapshot:
                gaps.append("update_before_snapshot")
                continue
            pu, final_u = ev.get("prev_final_update_id"), ev.get("final_update_id")
            if pd.notna(pu) and last_u is not None and int(pu) != int(last_u):
                gaps.append({"expected_prev":int(last_u),"actual_prev":int(pu),"event_time":int(ev.event_time)})
                have_snapshot = False
                continue
            last_u = final_u if pd.notna(final_u) else last_u
            updates += 1
        else:
            continue
        event_time = ev.event_time
        rows = df[df.event_time == event_time]
        # Apply every level belonging to this event in original received order.
        for row in rows.itertuples(index=False):
            side = str(getattr(row,"side")).lower()
            price, qty = float(getattr(row,"price")), float(getattr(row,"quantity"))
            book = bids if side == "bid" else asks if side == "ask" else None
            if book is None: continue
            if qty == 0: book.pop(price, None)
            else: book[price] = qty
        if bids and asks and max(bids) >= min(asks):
            crossed += 1
            have_snapshot = False
    return {"status":"OK" if not missing and bad == 0 and not gaps and crossed == 0 else "REJECT",
            "rows":len(df),"events":len(events),"updates":updates,"invalid_rows":bad,
            "sequence_gaps":len(gaps),"crossed_book_events":crossed,"gap_examples":gaps[:5]}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--root",default="research-data/binance-usdm")
    args=p.parse_args()
    root=Path(args.root)
    report={"root":str(root),"files":0,"datasets":{},"orderbook_files":[]}
    for path in root.rglob("*.parquet"):
        report["files"]+=1
        try:
            df=pd.read_parquet(path)
            key=str(path.relative_to(root).parts[0])+"/"+path.parent.name
            item={"rows":len(df),"columns":list(df.columns),
                  "null_pct":{c:round(float(df[c].isna().mean()*100),3) for c in df.columns}}
            report["datasets"].setdefault(key,[]).append(item)
            if path.parent.name=="orderbook":
                result=audit_orderbook(path); result["file"]=str(path)
                report["orderbook_files"].append(result)
        except Exception as exc:
            report["datasets"].setdefault("read_errors",[]).append({"file":str(path),"error":str(exc)})
    report["overall"]="NO_DATA" if report["files"]==0 else (
        "REJECT" if any(x["status"]!="OK" for x in report["orderbook_files"]) or "read_errors" in report["datasets"] else "AUDIT_REQUIRED")
    output=root/"data_audit.json"
    root.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps(report,indent=2))
    print(f"\nAudit written: {output}")

if __name__=="__main__":
    main()
