"""Independent signal construction on observed five-minute bars, not old candidate labels.
Observed timestamps control feature availability; missing/conflicting data are not synthesized.
Predeclared model thresholds, validation and fresh holdout; research only.
"""
import math,collections,bisect
from exit_path_replay import evaluate
M=60000
Q=5*M
TRAIN_END=1795503888681 # previous chronological split, 2026-11-24 04:24:48 UTC
FRESH_START=1795559981028 # prior study archive cutoff, not used to tune
POLICIES=[("fixed_1_2",dict(tp=1.2)),("fixed_2",dict(tp=2)),("lock_0_15",dict(tp=1.2,arm=.6,lock=.15)),("flow_reverse",dict(tp=1.2,flow=True))]
def aggregate(rows):
    return (rows[0][0],max(x[1] for x in rows),min(x[2] for x in rows),rows[-1][3],sum(x[4] for x in rows),sum(x[5] for x in rows))
def delta(rows):
    v=sum(x[4] for x in rows)
    return sum(2*x[5]-x[4] for x in rows)/v if v else 0.
def atr(rows):
    return sum(max(b[1]-b[2],abs(b[1]-a[3]),abs(b[2]-a[3])) for a,b in zip(rows[-15:-1],rows[-14:]))/14
def classify(rows,strict):
    # Signal determined only from completed bars. Symmetric LONG/SHORT.
    b=rows[-1];prior=rows[:-1]; a=atr(rows)
    if a<=0:return []
    upper=max(x[1] for x in prior[-6:]);lower=min(x[2] for x in prior[-6:])
    width=upper-lower
    avg_width=sum(x[1]-x[2] for x in prior[-24:-6])/18
    near_width=sum(x[1]-x[2] for x in prior[-6:])/6
    base_vol=sum(x[4] for x in prior[-24:])/24
    if not base_vol or not avg_width:return []
    rvol=b[4]/base_vol
    pflow=delta(prior[-6:]);recent=delta(rows[-2:]);old=delta(prior[-12:-6])
    result=[]
    for sign in (1,-1):
        edge=upper if sign>0 else lower
        opposite=lower if sign>0 else upper
        gap=sign*(edge-b[3])/a
        quality=(b[3]-b[2])/(b[1]-b[2]) if b[1]>b[2] else .5
        if sign<0:quality=1-quality
        body=sign*(b[3]-b[0])/a
        d=sign*delta([b])
        prior_move=sign*(prior[-7][3]-prior[-24][3])/a
        pull=sign*(prior[-1][3]-prior[-7][3])/a
        # Compression before range break, not buying the extended candle.
        if near_width<=avg_width*(.78 if strict else 1.0) and width<=a*5 and -.10<=gap<=.9 and sign*pflow>=(.10 if strict else .04) and sign*recent>=.10 and sign*(pflow-old)>=.02 and body>=0 and quality>=.60 and rvol>=.8:
            result.append(("ACCUMULATION" if sign>0 else "DISTRIBUTION",sign))
        # Sweep of previous range on the opposite side, close back inside.
        extreme=b[2] if sign>0 else b[1]
        sweep=sign*(opposite-extreme)/a
        reclaim=sign*(b[3]-opposite)/a
        if sweep>=(.20 if strict else .08) and .12<=reclaim<=1.5 and quality>=.65 and d>=(.12 if strict else .05) and rvol>=1.0:
            result.append(("LIQUIDITY_TRAP",sign))
        # Established directional move, a controlled pullback, then reclaim.
        if prior_move>=2.0 and -2.5<=pull<=-.35 and sign*pflow<=0 and body>=.20 and d>=(.12 if strict else .05) and quality>=.65 and sign*(b[3]-prior[-1][3])>0 and gap>=-.25:
            result.append(("TREND_RESUME",sign))
    return result
def stats(rows):
    n=len(rows);net=sum(x[3] for x in rows);gp=sum(max(x[3],0) for x in rows);gl=-sum(min(x[3],0) for x in rows)
    return dict(n=n,wins=sum(x[3]>0 for x in rows),netR=round(net,4),meanR=round(net/n,5) if n else None,pf=round(gp/gl,4) if gl else None,avgGivebackR=round(sum(x[7] for x in rows)/n,4) if n else None)
def nonoverlap(rows):
    ends={};out=[]
    for x in sorted(rows,key=lambda x:(x[1],x[0],x[4])):
        if x[1]<ends.get(x[0],0):continue
        ends[x[0]]=x[2];out.append(x)
    return out
def study(candles,availability,conflicts,evidence,fee,slip):
    groups=collections.defaultdict(list);counts=collections.Counter();features=collections.Counter()
    for sym,series in candles.items():
        five={}
        def bar(at):
            return None if (sym,at) in conflicts else series.get(at)
        for at in sorted(series):
            if at%Q:continue
            minute=[bar(at+i*M) for i in range(5)]
            if all(x is not None for x in minute):
                five[at]=(aggregate(minute),max(availability[sym][at+i*M] for i in range(5)))
        ev=sorted(evidence.get(sym,[]),key=lambda x:x[0]);times=[x[0] for x in ev]
        for at in sorted(five):
            window=[five.get(at-i*Q) for i in range(24,-1,-1)]
            if any(x is None for x in window):continue
            observed=max(x[1] for x in window);close_at=at+Q
            # All feature bars must have actually been available within 90 sec.
            if not close_at<=observed<=close_at+90000:continue
            rows=[x[0] for x in window];counts["observed_decisions"]+=1
            for strict in (False,True):
                for model,sign in classify(rows,strict):
                    counts["signals"]+=1
                    start=((observed+M-1)//M)*M
                    if start>close_at+180000:counts["expired"]+=1;continue
                    path=[bar(start+i*M) for i in range(60)]
                    if any(x is None for x in path):counts["missing_future"]+=1;continue
                    raw=path[0][0];dist=1.5*atr(rows)
                    if not raw>0 or not dist>0 or dist/raw>.04:counts["invalid_risk"]+=1;continue
                    # Optional contemporaneous OI/book confirmation; never look forward.
                    idx=bisect.bisect_right(times,observed)-1
                    inst=False
                    if idx>=0 and observed-ev[idx][0]<=60000:
                        g=ev[idx][1];oi=g.get("oiDelta");book=g.get("bookImbalance")
                        if isinstance(oi,(int,float)) and isinstance(book,(int,float)):
                            features["oi_book_available"]+=1
                            inst=oi>=0 and sign*book>=.02
                    phase="train" if start+60*M<=TRAIN_END else "validation" if start>=TRAIN_END and start+60*M<=FRESH_START else "fresh" if start>=FRESH_START else None
                    if phase is None:counts["crossing_split"]+=1;continue
                    counts["complete"]+=1
                    p=(sym,start,start+60*M,observed,model,sign,raw,dist,path)
                    # No cherry-picking: same paths for each policy, including ungated group.
                    for variant,ok in (("all",True),("cost",2*(fee+slip)*raw/dist<=.28),("cost_oi_book",2*(fee+slip)*raw/dist<=.28 and inst)):
                        if ok:groups[(model,"strict" if strict else "base",variant)].append((phase,p))
    report=[]
    for (model,strict,variant),paths in sorted(groups.items()):
        for name,policy in POLICIES:
            result=dict(model=model,strictness=strict,entryEvidence=variant,exitPolicy=name)
            for phase in ("train","validation","fresh"):
                subset=[p for f,p in paths if f==phase]
                r=[evaluate(p,policy,fee,slip) for p in subset]
                result[phase]=stats(nonoverlap(r))
                result[phase+"All"]=stats(r)
                if phase=="fresh":result["freshStress"]=stats(nonoverlap([evaluate(p,policy,fee,slip*2) for p in subset]))
            report.append(result)
    # Selection is determined by train only, before fresh results are considered.
    eligible=[x for x in report if x["train"]["n"]>=30 and x["train"]["meanR"] is not None]
    selected=sorted(eligible,key=lambda x:x["train"]["meanR"],reverse=True)[:5]
    return dict(counts=dict(counts),institutionalCoverage=dict(features),trainEnd=TRAIN_END,freshStart=FRESH_START,variants=len(report),trainSelected=selected,all=report)
