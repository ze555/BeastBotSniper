import type {StrongFlowBar} from "./strongFlowStrategy.js";

/** Scheduling only: price acceleration, executed flow and fair full coverage.
 * No radar observation can create an entry or reverse an existing position. */
export type RadarHit={symbol:string;side:"LONG"|"SHORT";strength:number;time:number;source:"PRICE"|"FLOW"};
type Sample={price:number;time:number;velocity:number|null};
export class WaveRadar {
  private prices=new Map<string,Sample>();
  private priceHits=new Map<string,RadarHit>();
  private flowHits=new Map<string,RadarHit>();
  ingestPrices(rows:unknown,eligible:ReadonlySet<string>,now:number){
    for(const map of [this.prices,this.priceHits,this.flowHits])
      for(const symbol of map.keys())if(!eligible.has(symbol))map.delete(symbol);
    if(!Array.isArray(rows))return;
    for(const row of rows){
      const symbol=row?.symbol,price=Number(row?.price),time=Number(row?.time);
      if(!eligible.has(symbol)||!(price>0)||!Number.isFinite(price)||!Number.isFinite(time)||time>now+2000||now-time>90000)continue;
      const prev=this.prices.get(symbol);
      if(prev&&time<=prev.time)continue;
      const dt=prev?time-prev.time:0;
      if(prev&&dt>=5000&&dt<=90000){
        const velocity=Math.log(price/prev.price)*60000/dt;
        const acceleration=prev.velocity===null?velocity:velocity-prev.velocity;
        this.priceHits.delete(symbol);
        // Acceleration in the SAME direction as recent price displacement.
        if(Math.abs(velocity)>=.001&&velocity*acceleration>0)
          this.priceHits.set(symbol,{symbol,side:velocity>0?"LONG":"SHORT",strength:Math.min(Math.abs(velocity),Math.abs(acceleration))*100,time,source:"PRICE"});
        this.prices.set(symbol,{price,time,velocity});
      }else if(!prev||dt>90000){this.prices.set(symbol,{price,time,velocity:null});this.priceHits.delete(symbol);}
    }
  }
  ingestBars(symbol:string,bars:readonly StrongFlowBar[],now:number){
    const recent=bars.slice(-23),last=recent.at(-1);
    if(recent.length!==23||!last||last.closeTime>=now||now-last.closeTime>90000)return;
    if(recent.some((b,i)=>![b.closeTime,b.openTime,b.close,b.quoteVolume,b.takerBuyQuote].every(Number.isFinite)||b.close<=0||b.quoteVolume<=0||b.takerBuyQuote<0||b.takerBuyQuote>b.quoteVolume||(i>0&&b.openTime-recent[i-1].openTime!==60000)))return;
    const sum=(r:readonly StrongFlowBar[])=>r.reduce((s,b)=>s+b.quoteVolume,0);
    const flow=(r:readonly StrongFlowBar[])=>r.reduce((s,b)=>s+2*b.takerBuyQuote-b.quoteVolume,0)/sum(r);
    const current=recent.slice(-3),prior=recent.slice(-6,-3);
    const relative=sum(current)/3/(sum(recent.slice(0,20))/20);
    const f=flow(current),accel=f-flow(prior),ret=last.close/recent[19].close-1;
    this.flowHits.delete(symbol);
    // Flow acceleration while price is still close to the prior range:
    // prioritizes incipient moves or correction/reversal, not 24h winners.
    if(relative>=1.15&&Math.abs(f)>=.10&&f*accel>0&&Math.abs(accel)>=.06&&Math.abs(ret)<=.035)
      this.flowHits.set(symbol,{symbol,side:f>0?"LONG":"SHORT",strength:Math.abs(accel)*Math.min(relative,4),time:last.closeTime,source:"FLOW"});
  }
  select(eligible:ReadonlySet<string>,now:number,limit=20):string[]{
    const out=new Set<string>();
    const lanes=[...([this.priceHits,this.flowHits] as const)].flatMap(map=>(["LONG","SHORT"] as const).map(side=>
      [...map.values()].filter(h=>eligible.has(h.symbol)&&h.side===side&&now-h.time>=0&&now-h.time<=(h.source==="PRICE"?90000:120000))
        .sort((a,b)=>b.strength-a.strength||b.time-a.time||a.symbol.localeCompare(b.symbol))));
    // Interleave four independent lanes, no shared cross-unit score.
    for(let i=0;out.size<limit&&lanes.some(l=>i<l.length);i++)
      for(const lane of lanes)if(lane[i]&&out.size<limit)out.add(lane[i].symbol);
    return [...out];
  }
}
/** Revisit due confirmations ahead of hot symbols, then alternate extra and
 * regular requests. Regular coverage never loses eligibility or batch slots. */
export function scheduleRadarBatch(regular:readonly string[],hot:readonly string[],pending:readonly {symbol:string;signalCloseTime:number}[],now:number):string[]{
  const due=pending.filter(p=>now>p.signalCloseTime+60000&&now-p.signalCloseTime<=180000)
    .sort((a,b)=>a.signalCloseTime-b.signalCloseTime).map(p=>p.symbol);
  const extra=[...new Set([...due,...hot])].filter(s=>!regular.includes(s)||due.includes(s));
  const out=new Set<string>();
  // Give due confirmations first access, even if already in the regular batch.
  for(const s of due)out.add(s);
  for(let i=0;i<Math.max(regular.length,extra.length);i++){
    if(i<regular.length)out.add(regular[i]);
    if(i<extra.length)out.add(extra[i]);
  }
  return [...out];
}
