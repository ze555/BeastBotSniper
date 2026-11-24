import type {Quote} from "./tradingIntegrity.js";
export const DIRECTION_REVISION="FLEX_DIRECTION_CONFIRMATION_V2_PAPER";
export const DIRECTION_TARGET_R=1.2;
export function directionExitPlan(entry:number,dist:number,side:"LONG"|"SHORT"){
  const sign=side==="LONG"?1:-1;
  return {stop:entry-sign*dist,target:entry+sign*DIRECTION_TARGET_R*dist,targetR:DIRECTION_TARGET_R};
}
export function directionConfirmation(side:"LONG"|"SHORT",close:number,atr:number,quote:Quote){
  const sign=side==="LONG"?1:-1,execution=side==="LONG"?quote.ask:quote.bid;
  const drift=sign*(execution-close)/atr;
  if(!Number.isFinite(drift)||!(close>0&&atr>0&&execution>0))return {allowed:false,reason:"DIRECTION_INVALID",drift};
  if(drift<=0)return {allowed:false,reason:"DIRECTION_WAIT_PRICE_CONFIRMATION",drift};
  if(drift>.68)return {allowed:false,reason:"DIRECTION_TOO_EXTENDED",drift};
  return {allowed:true,reason:"DIRECTION_PRICE_CONFIRMED",drift};
}
export function retryDirection(attempts:number,now:number,signalClose:number){
  return attempts<3&&now-signalClose<300000;
}
