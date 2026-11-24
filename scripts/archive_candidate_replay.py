"""Read-only archive replay; no trading requests, no synthetic candles.
All observed candidate events through frozen cutoff; use contiguous closed 1m paths.
Results are OHLC simulations, NOT historical bid/ask execution or account returns.
"""
import json, urllib.request, urllib.parse, gzip, time, math, collections, sys
BASE="https://beastbotsniper-production-0fa1ec8b.up.railway.app/api/research/replay"
CUTOFF=1795559981028
M=60000
FEE=.0004
SLIP=.0007 # .0002 model slippage + assumed .0005 half spread per side
candles=collections.defaultdict(dict)
conflicts=set()
signals={}
counts={}
def get(params):
    url=BASE+"?"+urllib.parse.urlencode(params)
    for i in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={"Accept-Encoding":"gzip","User-Agent":"BeastBotSniper-archive-research"}),timeout=45) as r:
                raw=r.read()
                return json.loads(gzip.decompress(raw) if r.headers.get("Content-Encoding")=="gzip" else raw)
        except Exception as e:
            if i==4: raise
            time.sleep(1.5*(i+1))
def ingest(kind):
    cursor=0;n=0
    while True:
        page=get(dict(kind=kind,afterId=cursor,limit=200,beforeMs=CUTOFF))
        events=page["events"]
        for e in events:
            d=e.get("data") or {}; sym=e["symbol"]; observed=e["observedMs"]
            for b in d.get("bars") or []:
                try:
                    o=int(b["openTime"]); c=int(b["closeTime"])
                    op,hi,lo,cl,q,tb=(float(b[k]) for k in ("open","high","low","close","quoteVolume","takerBuyQuote"))
                    if c-o!=59999 or o%M or c>=observed or not all(math.isfinite(v) for v in (op,hi,lo,cl,q,tb)) or not (op>0 and lo>0 and hi>=max(op,cl) and lo<=min(op,cl) and q>=0 and 0<=tb<=q):continue
                    value=(op,hi,lo,cl,q,tb)
                    old=candles[sym].get(o)
                    if old is not None and old!=value:conflicts.add((sym,o))
                    else:candles[sym][o]=value
                except (KeyError,ValueError,TypeError):continue
            s=d.get("signal")
            if kind=="signal_candidate" and s and s.get("side") in ("LONG","SHORT"):
                key=(sym,s["signalCloseTime"],s["side"])
                if key not in signals or observed<signals[key][0]:
                    signals[key]=(observed,s,sym,e.get("revision","UNKNOWN"))
        n+=len(events)
        if n%2000==0:print("progress",kind,n,flush=True)
        if not page["hasMore"]:break
        nxt=page["nextCursor"]
        if nxt is None or nxt<=cursor:raise RuntimeError("cursor failed to advance")
        cursor=nxt
        time.sleep(.2)
    counts[kind]=n;print("downloaded",kind,n,flush=True)
for kind in ("signal_candidate","signal_followthrough","closed_bars","entry_decision_inputs"):
    ingest(kind)
ordered=sorted(signals.values(),key=lambda x:x[0])
if not ordered:raise RuntimeError("no signals")
split=ordered[int(len(ordered)*.7)][0]
def bar(sym,at):
    if (sym,at) in conflicts:return None
    return candles[sym].get(at)
def simulate(record,mode,tp,costgate=False):
    observed,s,sym,revision=record
    sign=1 if s["side"]=="LONG" else -1
    try: atr=float(s["atr14"]); close=float(s["signalClose"]); dist=atr*float(s["stopAtr"]); expiry=int(s["signalCloseTime"])+300001
    except (TypeError,ValueError,KeyError):return "invalid",None
    if not all(math.isfinite(x) and x>0 for x in (atr,close,dist)):return "invalid",None
    start=((observed+M-1)//M)*M
    if start>expiry:return "expired",None
    direction=sign; adverse=False; entry_at=None
    for i in range(5 if mode!="direct" else 1):
        at=start+i*M
        if at>expiry:break
        b=bar(sym,at)
        if b is None:return "missing_before_entry",None
        if mode=="direct":entry_at=at;break
        drift=sign*(b[3]-close)/atr
        if drift<=0:adverse=True
        flow=(2*b[5]-b[4])/b[4] if b[4]>0 else 0
        if mode=="confirm" and 0<drift<=.68:entry_at=at+M;break
        if mode=="retest" and adverse and 0<drift<=.68:entry_at=at+M;break
        if mode=="reverse" and drift<-.4 and sign*flow<-.10:entry_at=at+M;direction=-sign;break
    if entry_at is None or entry_at>expiry:return "no_confirmation",None
    b=bar(sym,entry_at)
    if b is None:return "missing_before_entry",None
    raw=b[0]; drift=direction*(raw-close)/atr
    if mode in ("confirm","retest") and not (0<drift<=.68):return "entry_changed",None
    if costgate and (2*(FEE+SLIP)*raw/dist>.28 or dist/raw>.04):return "cost_or_risk",None
    entry=raw*(1+direction*SLIP)
    stop=entry-direction*dist;target=entry+direction*tp*dist
    if min(stop,target)<=0:return "invalid",None
    # Common horizon for fair policy comparisons; no use of subsequent candles after exit.
    hold=min(60,max(1,int(s.get("maxHoldMs",3600000))//M))
    for j in range(hold):
        at=entry_at+j*M;q=bar(sym,at)
        if q is None:return "missing_after_entry",None
        op,hi,lo,cl,vol,buy=q
        sl=lo<=stop if direction==1 else hi>=stop
        hit=hi>=target if direction==1 else lo<=target
        if sl:exit_px=min(stop,op) if direction==1 else max(stop,op);reason="stop"
        elif hit:exit_px=target;reason="target"
        elif j==hold-1:exit_px=cl;reason="time"
        else:continue
        executed=exit_px*(1-direction*SLIP)
        gross=direction*(exit_px-raw)/dist
        net=(direction*(executed-entry)-(entry+executed)*FEE)/dist
        return "closed",(sym,entry_at,at+M,net,gross,reason,observed,revision)
    return "missing_after_entry",None
def stats(rows):
    n=len(rows);wins=sum(x[3]>0 for x in rows);total=sum(x[3] for x in rows)
    gp=sum(max(x[3],0) for x in rows);gl=-sum(min(x[3],0) for x in rows)
    return dict(n=n,wins=wins,netR=round(total,4),grossR=round(sum(x[4] for x in rows),4),meanR=round(total/n,5) if n else None,pf=round(gp/gl,4) if gl else None)
def nonoverlap(rows):
    # Diagnostic only: one position per symbol, using entry chronology. No leverage,
    # account sizing, correlation cap or daily loss budget is simulated.
    ends={};selected=[]
    for x in sorted(rows,key=lambda x:(x[1],x[0],x[6])):
        if x[1]<ends.get(x[0],0):continue
        ends[x[0]]=x[2];selected.append(x)
    return selected
scenarios=[("direct",1.2,False),("direct",1.2,True),("confirm",1.2,True),("confirm",.75,True),("confirm",2,True),("retest",1.2,True),("reverse",1.2,True)]
report=[]
for mode,tp,gate in scenarios:
    counts_result=collections.Counter(); rows=[]
    for rec in ordered:
        status,result=simulate(rec,mode,tp,gate)
        counts_result[status]+=1
        if result:rows.append(result)
    report.append(dict(mode=mode,tp=tp,costGate=gate,status=dict(counts_result),all=stats(rows),calibration=stats([r for r in rows if r[6]<split]),heldOut=stats([r for r in rows if r[6]>=split]),nonOverlap=stats(nonoverlap(rows)),heldOutNonOverlap=stats(nonoverlap([r for r in rows if r[6]>=split])),byRevision={rev:stats([r for r in rows if r[7]==rev]) for rev in sorted(set(r[7] for r in rows))}))
out=dict(cutoff=CUTOFF,downloaded=counts,uniqueSignals=len(ordered),symbols=len(set(x[2] for x in ordered)),minuteCandles=sum(len(x) for x in candles.values()),conflictingCandles=len(conflicts),split=split,first=ordered[0][0],last=ordered[-1][0],scenarios=report)
from exit_path_replay import run_paired
out["pairedExitStudy"]=run_paired(ordered,bar,split,FEE,SLIP)
print("FINAL_ARCHIVE_REPLAY "+json.dumps(out,separators=(",",":")),flush=True)
with open("archive-replay-report.json","w") as f:json.dump(out,f,indent=2)
