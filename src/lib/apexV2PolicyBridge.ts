/** ApexV2-derived structural entry and reversal policies.
 * Source: ze555/Apexv2/src/quant/engine.ts (read-only).
 * Uses actual closed candles and measured CVD; never fabricates missing evidence.
 */
export interface ApexCandle {open:number;high:number;low:number;close:number}
export function apexEntryTrapGate(input:{side:"LONG"|"SHORT";price:number;candles:ApexCandle[];cvd15m:number|null}):{allowed:boolean;reason:string}{
 const {side,price,candles,cvd15m}=input;
 if(candles.length<3 || cvd15m===null || !Number.isFinite(cvd15m))return {allowed:true,reason:"APEX_TRAP_EVIDENCE_UNAVAILABLE"};
 const [a,b,c]=candles.slice(-3);
 const swingHigh=Math.max(a.high,b.high),swingLow=Math.min(a.low,b.low);
 if(side==="LONG" && c.high>swingHigh && price<swingHigh && cvd15m< -15)
   return {allowed:false,reason:"APEX_UPTHRUST_BULL_TRAP"};
 if(side==="SHORT" && c.low<swingLow && price>swingLow && cvd15m>15)
   return {allowed:false,reason:"APEX_SPRING_BEAR_TRAP"};
 return {allowed:true,reason:"APEX_TRAP_CLEAR"};
}
export function apexReversalExit(input:{side:"LONG"|"SHORT";profitR:number;peakR:number;price:number;ema21:number|null;lastTwoCloses:number[];cvd5m:number|null;cvd15m:number|null}):{exit:boolean;reason:string}{
 const x=input;
 if(x.peakR<0.45||x.profitR<0.12||x.lastTwoCloses.length<2||
    x.ema21===null||!Number.isFinite(x.ema21)||x.cvd5m===null||x.cvd15m===null||
    !Number.isFinite(x.cvd5m)||!Number.isFinite(x.cvd15m))return {exit:false,reason:"APEX_REVERSAL_UNCONFIRMED"};
 const crossed=x.side==="LONG"
  ? x.lastTwoCloses.every(c=>c<x.ema21!)&&x.price<x.ema21
  : x.lastTwoCloses.every(c=>c>x.ema21!)&&x.price>x.ema21;
 const oppositeFlow=x.side==="LONG"
  ? x.cvd5m< -40&&x.cvd15m< -50
  : x.cvd5m>40&&x.cvd15m>50;
 return {exit:crossed&&oppositeFlow,reason:crossed&&oppositeFlow?"APEX_CONFIRMED_FLOW_REVERSAL":"APEX_REVERSAL_UNCONFIRMED"};
}
