/** Historical first-observed-quote counterfactuals. No interpolation or future
 * peak look-ahead, no simulated prices after the original close. */
export const EXIT_POLICIES=[
 {id:"TP_0_5",target:.5,arm:Infinity,lock:0,trail:Infinity},
 {id:"TP_0_75",target:.75,arm:Infinity,lock:0,trail:Infinity},
 {id:"TP_1",target:1,arm:Infinity,lock:0,trail:Infinity},
 {id:"TP_1_2",target:1.2,arm:Infinity,lock:0,trail:Infinity},
 {id:"TP_1_6",target:1.6,arm:Infinity,lock:0,trail:Infinity},
 {id:"BE_0_5_TP_1_2",target:1.2,arm:.5,lock:0,trail:Infinity},
 {id:"LOCK_0_15_AFTER_0_6_TP_1_2",target:1.2,arm:.6,lock:.15,trail:Infinity},
 {id:"LOCK_0_2_AFTER_0_75_TRAIL_0_5",target:Infinity,arm:.75,lock:.2,trail:.5},
 {id:"LOCK_0_1_AFTER_0_5_TRAIL_0_6",target:Infinity,arm:.5,lock:.1,trail:.6}
] as const;
export type RecordedQuote={at:number;price:number};
export function replayRecordedExits(t:any,quotes:RecordedQuote[],fee:number,slip:number){
 const sign=t.direction==="LONG"?1:t.direction==="SHORT"?-1:0;
 const entry=Number(t.entry),dist=Number(t.initialSlDist),qty=Number(t.initialPos),baseline=Number(t.finalPnl);
 const start=Date.parse(t.entryTime),end=Date.parse(t.exitTime);
 if(!sign||![entry,dist,qty,baseline,start,end,fee,slip].every(Number.isFinite)||entry<=0||dist<=0||qty<=0||end<start||fee<0||fee>=.01||slip<0||slip>=.01)return null;
 const valid=quotes.filter(q=>Number.isFinite(q.at)&&q.at>=start&&q.at<=end&&Number.isFinite(q.price)&&q.price>0);
 if(!valid.length)return null;
 const net=(price:number)=>{const execution=price*(1-sign*slip);return (sign*(execution-entry)-(entry+execution)*fee)*qty};
 const floorAt=(r:number)=>((sign*entry+entry*fee+r*dist)/(sign-fee))/(1-sign*slip);
 let peak=0,last=start,maxGap=0;
 const states=EXIT_POLICIES.map(policy=>({policy,floor:null as number|null,result:null as null|{pnl:number;at:number;reason:string}}));
 for(const q of valid){
   if(q.at<last)continue;
   maxGap=Math.max(maxGap,q.at-last);last=q.at;
   const r=sign*(q.price-entry)/dist;
   // Stops armed on a PREVIOUS observation only. All fills at observed executable
   // side with slippage, including adverse jumps beyond a stop.
   for(const st of states){
     if(st.result)continue;
     if(st.floor!==null&&sign*(q.price-st.floor)<=0){st.result={pnl:net(q.price),at:q.at,reason:"PROFIT_FLOOR"};continue;}
     if(r>=st.policy.target){st.result={pnl:net(q.price),at:q.at,reason:"TARGET"};continue;}
     if(r>=st.policy.arm||st.floor!==null){
       const locked=Math.max(st.policy.lock,Math.max(peak,r)-st.policy.trail);
       const next=floorAt(locked);
       if(Number.isFinite(next)&&sign*(q.price-next)>0)st.floor=st.floor===null?next:sign>0?Math.max(st.floor,next):Math.min(st.floor,next);
     }
   }
   peak=Math.max(peak,r);
 }
 maxGap=Math.max(maxGap,end-last);
 return {baseline,peak,samples:valid.length,maxGapMs:maxGap,firstGapMs:valid[0].at-start,lastGapMs:end-last,policies:Object.fromEntries(states.map(st=>[st.policy.id,st.result||{pnl:baseline,at:end,reason:"ORIGINAL_CLOSE"}]))};
}
