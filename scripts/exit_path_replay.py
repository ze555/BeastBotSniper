"""Paired exit-policy study using the same entry and complete, contiguous 1m path.
All close-triggered decisions execute at the next bar open. On an ambiguous bar,
the existing stop wins over targets; stops ratcheted only after bar close.
No synthetic market flow, fills beyond observed OHLC, or live trade mutations.
"""
import math,collections
M=60000
POLICIES=[
 ("FIXED_0_5",dict(tp=.5)),("FIXED_0_75",dict(tp=.75)),("FIXED_1_2",dict(tp=1.2)),
 ("FIXED_2",dict(tp=2)),("BE_0_5_TP_1_2",dict(tp=1.2,arm=.5,lock=0)),
 ("LOCK_0_15_AFTER_0_6",dict(tp=1.2,arm=.6,lock=.15)),
 ("TRAIL_0_5_AFTER_0_75",dict(arm=.75,lock=.2,trail=.5)),
 ("PARTIAL_50_AT_0_75_RUN_2",dict(tp=2,partial=.75,arm=.75,lock=0)),
 ("EARLY_INVALIDATION",dict(tp=1.2,early=True)),
 ("FLOW_REVERSAL",dict(tp=1.2,flow=True)),
 ("TIME_15",dict(tp=1.2,time=15)),("TIME_30",dict(tp=1.2,time=30)),
 ("TIME_60",dict(time=60)),
]
def paired_path(rec,mode,bar,fee,slip):
    observed,s,sym,rev=rec
    sign=1 if s["side"]=="LONG" else -1
    try:atr=float(s["atr14"]); close=float(s["signalClose"]); dist=atr*float(s["stopAtr"]); expiry=int(s["signalCloseTime"])+300001
    except (TypeError,ValueError,KeyError):return "invalid",None
    if not all(math.isfinite(v) and v>0 for v in (atr,close,dist)):return "invalid",None
    start=((observed+M-1)//M)*M;direction=sign;adverse=False;entry_at=None
    for i in range(1 if mode=="direct" else 5):
        at=start+i*M
        if at>expiry:break
        q=bar(sym,at)
        if q is None:return "missing_before_entry",None
        if mode=="direct":entry_at=at;break
        drift=sign*(q[3]-close)/atr
        if drift<=0:adverse=True
        flow=(2*q[5]-q[4])/q[4] if q[4]>0 else 0
        if mode=="confirm" and 0<drift<=.68:entry_at=at+M;break
        if mode=="retest" and adverse and 0<drift<=.68:entry_at=at+M;break
        if mode=="reverse" and drift<-.4 and sign*flow<-.10:entry_at=at+M;direction=-sign;break
    if entry_at is None or entry_at>expiry:return "no_confirmation",None
    q=bar(sym,entry_at)
    if q is None:return "missing_before_entry",None
    raw=q[0];drift=direction*(raw-close)/atr
    if mode in ("confirm","retest") and not 0<drift<=.68:return "entry_changed",None
    if 2*(fee+slip)*raw/dist>.28 or dist/raw>.04:return "cost_or_risk",None
    hold=min(60,max(1,int(s.get("maxHoldMs",3600000))//M))
    path=[bar(sym,entry_at+j*M) for j in range(hold)]
    if any(x is None for x in path):return "incomplete_common_horizon",None
    return "paired",(sym,entry_at,entry_at+hold*M,observed,rev,direction,raw,dist,path)
def evaluate(path,policy,fee,slip):
    sym,at,end,observed,rev,sign,raw,dist,bars=path
    entry=raw*(1+sign*slip)
    stop=entry-sign*dist
    target=entry+sign*policy.get("tp",math.inf)*dist
    remain=1.;net=0.;peak=0.;pending=None;done_partial=False
    peak_close_net=0.;mae_close=0.;flow_streak=0
    def unit_net(px):
        execution=px*(1-sign*slip)
        return (sign*(execution-entry)-fee*(entry+execution))/dist
    def lock_px(r):
        return ((sign*entry+fee*entry+r*dist)/(sign-fee))/(1-sign*slip)
    def result(px,j,reason):
        total=net+remain*unit_net(px)
        return (sym,at,at+(j+1)*M,total,observed,rev,reason,max(0.,peak_close_net-total),mae_close)
    for j,(op,hi,lo,cl,volume,buy) in enumerate(bars[:min(len(bars),policy.get("time",len(bars)))]):
        if pending:return result(op,j,pending)
        hit_stop=lo<=stop if sign>0 else hi>=stop
        if hit_stop:return result(min(op,stop) if sign>0 else max(op,stop),j,"STOP_OR_LOCK")
        if "partial" in policy and not done_partial:
            pt=entry+sign*policy["partial"]*dist
            if (hi>=pt if sign>0 else lo<=pt):
                net+=.5*unit_net(pt);remain=.5;done_partial=True
        if "tp" in policy and (hi>=target if sign>0 else lo<=target):return result(target,j,"TARGET")
        rr=sign*(cl-entry)/dist
        total_mark=net+remain*unit_net(cl)
        peak_close_net=max(peak_close_net,total_mark);mae_close=min(mae_close,total_mark)
        peak=max(peak,rr)
        if peak>=policy.get("arm",math.inf):
            lock=max(policy.get("lock",0.),peak-policy.get("trail",math.inf))
            p=lock_px(lock)
            if sign*(cl-p)>0 and sign*(p-stop)>0:stop=p
        signed_flow=sign*(2*buy-volume)/volume if volume>0 else None
        flow_streak=flow_streak+1 if signed_flow is not None and signed_flow<-.10 else 0
        # Exit decisions based on COMPLETED bar evidence only.
        if policy.get("early") and j>=2 and rr<=-.35 and peak<.25 and flow_streak>=2:pending="EARLY_INVALIDATION"
        if policy.get("flow") and j>=1 and peak>=.3 and peak-rr>=.35 and flow_streak>=2:pending="FLOW_REVERSAL"
        if j+1>=min(len(bars),policy.get("time",len(bars))):return result(cl,j,"TIME")
    raise AssertionError("empty path")
def stats(rows):
    n=len(rows);net=sum(x[3] for x in rows)
    gp=sum(max(x[3],0) for x in rows);gl=-sum(min(x[3],0) for x in rows)
    return dict(n=n,wins=sum(x[3]>0 for x in rows),netR=round(net,4),meanR=round(net/n,5) if n else None,pf=round(gp/gl,4) if gl else None,avgGivebackFromObservedCloseR=round(sum(x[7] for x in rows)/n,5) if n else None,avgAdverseCloseR=round(sum(x[8] for x in rows)/n,5) if n else None,exitReasons=dict(collections.Counter(x[6] for x in rows)))
def nonoverlap(rows):
    ends={};out=[]
    for x in sorted(rows,key=lambda x:(x[1],x[0],x[4])):
        if x[1]<ends.get(x[0],0):continue
        ends[x[0]]=x[2];out.append(x)
    return out
def run_paired(ordered,bar,split,fee,slip):
    result=[]
    for mode in ("direct","confirm","retest","reverse"):
        statuses=collections.Counter();paths=[]
        for rec in ordered:
            status,path=paired_path(rec,mode,bar,fee,slip);statuses[status]+=1
            if path:paths.append(path)
        # Exclude paths crossing split to prevent calibration outcomes from using held-out prices.
        train=[x for x in paths if x[2]<=split]
        test=[x for x in paths if x[1]>=split]
        for name,policy in POLICIES:
            a=[evaluate(x,policy,fee,slip) for x in train]
            b=[evaluate(x,policy,fee,slip) for x in test]
            result.append(dict(entryMode=mode,exitPolicy=name,status=dict(statuses),crossingSplit=len(paths)-len(train)-len(test),all=stats(a+b),calibration=stats(a),heldOut=stats(b),heldOutNonOverlap=stats(nonoverlap(b)),costStressHeldOut=stats([evaluate(x,policy,fee,slip*2) for x in test])))
    return result
def selftest():
    # LONG and SHORT paths: partial fees, stop precedence, next-open exits, cost-aware lock.
    for sign in (1,-1):
        raw=100;dist=10
        def q(o,h,l,c,flow=.5):
            vals=[100+sign*(v-100) for v in (o,h,l,c)]
            return vals[0],max(vals[1:3]),min(vals[1:3]),vals[3],100,100*(flow if sign==1 else 1-flow)
        path=("TEST",0,3*M,0,"TEST",sign,raw,dist,[q(100,108,99,107),q(107,109,103,104),q(104,104,90,91)])
        assert evaluate(path,dict(tp=.5),0,0)[3]==.5
        assert evaluate(path,dict(tp=1.2,arm=.5,lock=0),0,0)[3]==0
        assert evaluate(path,dict(tp=2,partial=.75,arm=.75,lock=0),0,0)[3]<0
        both=("TEST",0,M,0,"TEST",sign,raw,dist,[q(100,120,80,100)])
        assert evaluate(both,dict(tp=1.2),0,0)[3]==-1
    print("PAIRED EXIT SELFTEST PASSED",flush=True)
if __name__=="__main__":selftest()
