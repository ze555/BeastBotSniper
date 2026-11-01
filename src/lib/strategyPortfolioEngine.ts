/**
 * Research-only strategy portfolio and fill-aware simulator.
 * No network calls, no exchange execution, and no live config mutation.
 */
export type Side = "LONG" | "SHORT";
export type StrategyId = "TREND_RIDER" | "BREAKOUT_RETEST" | "LIQUIDITY_REVERSAL" | "MOMENTUM_EXPANSION";
export interface StrategyCandle { time?: number | string; open:number; high:number; low:number; close:number; volume:number; takerBuyBase?:number }
export interface StrategyContext { btcRegime?:string; btcChangePct?:number; fundingRate?:number; oiChangePct?:number; oiAvailable?:boolean }
export interface StrategyCandidate { strategy:StrategyId; side:Side; score:number; accepted:boolean; reasons:string[]; entryReference:number; stopReference:number; targetR:number }
export interface StrategyEvaluation { side:Side; candidates:StrategyCandidate[]; selected:StrategyCandidate|null }
export interface StrategyExitPlan { tp1R:number; tp2R:number; tp3R:number; partA:number; partB:number; partC:number; minRRRequired:number }
export function resolveStrategyExitPlan(strategy:StrategyId,triRegimeExitStrategy:string):StrategyExitPlan {
 if(triRegimeExitStrategy==="RANGE_SCALP")return {tp1R:0.8,tp2R:1.0,tp3R:1.0,partA:0.5,partB:0.5,partC:0,minRRRequired:0.9};
 if(strategy==="LIQUIDITY_REVERSAL")return {tp1R:0.75,tp2R:1.5,tp3R:2.5,partA:0.4,partB:0.35,partC:0.25,minRRRequired:2.0};
 if(strategy==="MOMENTUM_EXPANSION")return {tp1R:0.75,tp2R:1.5,tp3R:3.0,partA:0.4,partB:0.35,partC:0.25,minRRRequired:2.5};
 return {tp1R:0.75,tp2R:1.8,tp3R:3.5,partA:0.4,partB:0.35,partC:0.25,minRRRequired:2.5};
}
export interface RiskGuardianConfig { riskFraction:number; maxPortfolioRiskFraction:number; dailyLossLimitFraction:number; maxPositions:number; maxCorrelatedPositions:number }
export const DEFAULT_RISK_GUARDIAN:RiskGuardianConfig={riskFraction:0.005,maxPortfolioRiskFraction:0.02,dailyLossLimitFraction:0.02,maxPositions:5,maxCorrelatedPositions:2};

const finite=(n:number)=>Number.isFinite(n);
export function isCandleClosed(closeTime:number|string|undefined,nowMs:number=Date.now()):boolean { const timestamp=Number(closeTime); return Number.isFinite(timestamp)&&timestamp<nowMs; }
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
function ema(values:number[],period:number):number { if(!values.length)return 0; const k=2/(period+1); let v=values[0]; for(let i=1;i<values.length;i++)v=values[i]*k+v*(1-k); return v; }
function atr(c:StrategyCandle[],period=14):number { if(c.length<2)return 0; const tr:number[]=[]; for(let i=1;i<c.length;i++)tr.push(Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close))); return tr.slice(-period).reduce((a,b)=>a+b,0)/Math.min(period,tr.length); }
function rsi(closes:number[],period=14):number { if(closes.length<=period)return 50; let up=0,down=0; for(let i=closes.length-period;i<closes.length;i++){const d=closes[i]-closes[i-1];if(d>0)up+=d;else down-=d;} return down===0?100:100-100/(1+(up/period)/(down/period)); }
function flowRatio(c:StrategyCandle[]):number { const valid=c.filter(x=>finite(x.takerBuyBase??NaN)); if(valid.length===c.length&&c.length){const v=c.reduce((s,x)=>s+x.volume,0);return v>0?c.reduce((s,x)=>s+(x.takerBuyBase||0),0)/v:0.5;} const v=c.reduce((s,x)=>s+x.volume,0); if(v<=0)return 0.5; return c.reduce((s,x)=>s+x.volume*(x.high>x.low?(x.close-x.low)/(x.high-x.low):0.5),0)/v; }
function scoreCandidate(strategy:StrategyId,side:Side,c:StrategyCandle[],ctx:StrategyContext):StrategyCandidate {
 const last=c[c.length-1],prev=c[c.length-2],cl=c.map(x=>x.close),highs=c.slice(0,-1).map(x=>x.high),lows=c.slice(0,-1).map(x=>x.low);
 const price=last.close,a=atr(c),e9=ema(cl.slice(-60),9),e21=ema(cl.slice(-80),21),e50=ema(cl.slice(-120),50);
 const r=rsi(cl),flow=flowRatio(c.slice(-5)),avgVol=c.slice(-21,-1).reduce((s,x)=>s+x.volume,0)/Math.max(1,Math.min(20,c.length-1)),rvol=last.volume/(avgVol||1);
 const priorHigh=Math.max(...highs.slice(-20)),priorLow=Math.min(...lows.slice(-20));
 const range=Math.max(last.high-last.low,1e-12),body=Math.abs(last.close-last.open),bodyRatio=body/range;
 const lowerWick=Math.min(last.open,last.close)-last.low,upperWick=last.high-Math.max(last.open,last.close);
 const bull=side==="LONG", trendAligned=bull?(price>e21&&e21>e50):(price<e21&&e21<e50);
 const directionalFlow=bull?flow>=0.54:flow<=0.46;
 const opposingBtc=Boolean(ctx.btcRegime?.includes(bull?"BEAR":"BULL"));
 const reasons:string[]=[];let score=0,entry=price,stop=bull?Math.min(last.low,price-a):Math.max(last.high,price+a),targetR=3.5;
 const add=(ok:boolean,points:number,reason:string)=>{if(ok){score+=points;reasons.push(reason);}};
 if(!finite(price)||!finite(a)||a<=0||c.length<25)return {strategy,side,score:0,accepted:false,reasons:["Insufficient or invalid candle history"],entryReference:price,stopReference:stop,targetR};
 switch(strategy){
  case "TREND_RIDER":{
   add(trendAligned,2,"EMA21/EMA50 trend alignment");
   add(bull?e9>e21:e9<e21,1,"EMA9 confirms trend resumption");
   add(bull?last.close>prev.close:last.close<prev.close,1,"latest closed candle resumes direction");
   add(directionalFlow,1.5,"directional taker-flow proxy");
   add(rvol>=0.8&&rvol<=3.5,0.75,"participation is not dead or climactic");
   add(bull?r>=45&&r<=68:r>=32&&r<=55,0.75,"RSI is not materially extended");
   stop=bull?Math.min(...c.slice(-4).map(x=>x.low))-a*0.25:Math.max(...c.slice(-4).map(x=>x.high))+a*0.25;
   targetR=3.5;break;
  }
  case "BREAKOUT_RETEST":{
   const clearance=bull?price>priorHigh:price<priorLow;
   const level=bull?priorHigh:priorLow;
   const retest=bull?(last.low<=level+a*0.25&&price>=level):(last.high>=level-a*0.25&&price<=level);
   const strongClose=bull?(last.close>last.open&&bodyRatio>=0.45):(last.close<last.open&&bodyRatio>=0.45);
   add(clearance,2.5,"closed candle clears prior 20-candle boundary");
   add(retest,1.5,"breakout level retest holds");
   add(strongClose,1,"directional close");
   add(rvol>=1.2,1,"relative volume confirms participation");
   add(directionalFlow,1,"taker-flow proxy agrees");
   entry=price;stop=bull?Math.min(last.low,level-a*0.2):Math.max(last.high,level+a*0.2);targetR=3.5;break;
  }
  case "LIQUIDITY_REVERSAL":{
   const sweep=bull?last.low<priorLow&&price>priorLow:last.high>priorHigh&&price<priorHigh;
   const wick=bull?lowerWick>=Math.max(body*1.5,a*0.25):upperWick>=Math.max(body*1.5,a*0.25);
   const reclaim=bull?price>last.open:price<last.open;
   add(sweep,2.5,"liquidity sweep beyond prior range then reclaim");
   add(wick,1.5,"rejection wick at swept extreme");
   add(reclaim,1,"close returns in reversal direction");
   add(rvol>=1.2,1,"volume expansion at sweep");
   add(directionalFlow,1,"taker-flow proxy confirms absorption");
   stop=bull?last.low-a*0.15:last.high+a*0.15;targetR=2.5;break;
  }
  case "MOMENTUM_EXPANSION":{
   const expansion=range>=a*1.1&&bodyRatio>=0.6;
   const momentum=bull?(last.close>last.open&&price>e9):(last.close<last.open&&price<e9);
   add(expansion,2,"range expands above ATR baseline");
   add(momentum,1.5,"directional momentum candle");
   add(rvol>=1.5&&rvol<=4,1.5,"volume expansion");
   add(directionalFlow,1,"taker-flow proxy confirms");
   add(bull?e9>e21:e9<e21,1,"short-term trend alignment");
   // Avoid chasing a candle already too far from its fast average.
   add(Math.abs(price-e9)<=a*1.8,0.75,"entry is not excessively extended");
   stop=bull?last.low-a*0.2:last.high+a*0.2;targetR=3;break;
 }
 }
 if(opposingBtc){score-=1;reasons.push("BTC regime conflicts (score penalty; not an absolute ban)");}
 const risk=Math.abs(entry-stop),riskPct=risk/(entry||1);
 const validStop=bull?stop<entry:stop>entry;
 const validRisk=riskPct>=0.001&&riskPct<=0.04;
 const threshold=strategy==="LIQUIDITY_REVERSAL"?5.5:5.75;
 const accepted=score>=threshold&&validStop&&validRisk;
 if(!validStop)reasons.push("Rejected: stop is on the wrong side of entry");
 if(!validRisk)reasons.push("Rejected: stop distance outside 0.10%-4.00% sanity band");
 return {strategy,side,score:Number(clamp(score,0,10).toFixed(2)),accepted,reasons,entryReference:entry,stopReference:stop,targetR};
}
export function evaluateStrategyPortfolio(candles:StrategyCandle[],ctx:StrategyContext={}):StrategyEvaluation[]{
 if(candles.length<25)return (["LONG","SHORT"] as Side[]).map(side=>({side,candidates:[],selected:null}));
 return (["LONG","SHORT"] as Side[]).map(side=>{
  const candidates=(["TREND_RIDER","BREAKOUT_RETEST","LIQUIDITY_REVERSAL","MOMENTUM_EXPANSION"] as StrategyId[]).map(s=>scoreCandidate(s,side,candles,ctx));
  const selected=candidates.filter(x=>x.accepted).sort((a,b)=>b.score-a.score)[0]||null;
  return {side,candidates,selected};
 });
}
export interface RiskRequest { equity:number; entryPrice:number; stopDistancePct:number; currentOpenRiskFraction:number; dailyRealizedPnl:number; openPositions:number; correlatedOpenPositions:number }
export interface RiskDecision { allowed:boolean; riskUsd:number; quantity:number; reason:string }
export function evaluateRiskGuardian(req:RiskRequest,cfg:RiskGuardianConfig=DEFAULT_RISK_GUARDIAN):RiskDecision{
 const fail=(reason:string):RiskDecision=>({allowed:false,riskUsd:0,quantity:0,reason});
 if(!finite(req.equity)||req.equity<=0||!finite(req.entryPrice)||req.entryPrice<=0||!finite(req.stopDistancePct)||req.stopDistancePct<=0)return fail("Invalid equity, entry price or stop distance");
 if(req.dailyRealizedPnl<=-req.equity*cfg.dailyLossLimitFraction)return fail("Daily loss limit reached");
 if(req.openPositions>=cfg.maxPositions)return fail("Maximum concurrent positions reached");
 if(req.correlatedOpenPositions>=cfg.maxCorrelatedPositions)return fail("Correlated exposure limit reached");
 const available=Math.max(0,cfg.maxPortfolioRiskFraction-req.currentOpenRiskFraction);
 const riskFraction=Math.min(cfg.riskFraction,available);
 if(riskFraction<=0)return fail("Portfolio open-risk budget exhausted");
 const riskUsd=req.equity*riskFraction;
 const quantity=riskUsd/(req.entryPrice*req.stopDistancePct);
 return {allowed:true,riskUsd,quantity,reason:"Risk budget available; size derived from stop distance"};
}
export interface ReplayTrade { trade_id:string;side:Side;timestamp_entry:string;timestamp_exit:string;entry_price:number;stop_loss:number;take_profit_1:number;take_profit_2:number;take_profit_3:number;position_size?:number;pnl_r?:number;tp1_r?:number;tp2_r?:number;tp3_r?:number;part_a?:number;part_b?:number;part_c?:number }
export interface ReplayCandle {time:number;open:number;high:number;low:number;close:number;volume:number;takerBuyBase?:number}
export interface ReplayConfig {equity:number;riskFraction:number;feeRate:number;slippageRate:number;tp1Fraction:number;tp2Fraction:number;tp3Fraction:number;moveStopAfterTp1R:number;moveStopAfterTp2R:number;maxHoldMinutes:number}
export const DEFAULT_REPLAY_CONFIG:ReplayConfig={equity:1000,riskFraction:0.005,feeRate:0.0004,slippageRate:0.0002,tp1Fraction:0.4,tp2Fraction:0.35,tp3Fraction:0.25,moveStopAfterTp1R:0.3,moveStopAfterTp2R:0.75,maxHoldMinutes:1440};
export interface ReplayResult {trade_id:string;status:"REPLAYED"|"NO_CANDLES"|"INVALID";exitReason:string;exitPrice:number;grossPnl:number;fees:number;netPnl:number;netR:number;partialFills:number;bars:number;ambiguousBars:number;recordedR:number|null}
export function simulatePartialExitTrade(trade:ReplayTrade,candles:ReplayCandle[],cfg:ReplayConfig=DEFAULT_REPLAY_CONFIG):ReplayResult{
 const invalid=(status:ReplayResult["status"],reason:string):ReplayResult=>({trade_id:trade.trade_id,status,exitReason:reason,exitPrice:trade.entry_price,grossPnl:0,fees:0,netPnl:0,netR:0,partialFills:0,bars:0,ambiguousBars:0,recordedR:finite(trade.pnl_r??NaN)?trade.pnl_r!:null});
 if(!Array.isArray(candles)||!candles.length)return invalid("NO_CANDLES","No 1m candles");
 const entryMs=Date.parse(trade.timestamp_entry),exitMs=Date.parse(trade.timestamp_exit);
 const tp1R=finite(trade.tp1_r??NaN)&&Number(trade.tp1_r)>0?Number(trade.tp1_r):0.75; 
 const tp2Fraction=finite(trade.part_b??NaN)?Number(trade.part_b):cfg.tp2Fraction; 
 const tp1Fraction=finite(trade.part_a??NaN)?Number(trade.part_a):cfg.tp1Fraction; 
 const tp3Fraction=finite(trade.part_c??NaN)?Number(trade.part_c):cfg.tp3Fraction; 
 const tpRiskDistance=Math.abs(trade.take_profit_1-trade.entry_price)/tp1R;
 const riskDist=finite(tpRiskDistance)&&tpRiskDistance>0?tpRiskDistance:Math.abs(trade.entry_price-trade.stop_loss);
 if(!finite(entryMs)||!finite(exitMs)||riskDist<=0||!finite(trade.entry_price)||trade.entry_price<=0)return invalid("INVALID","Invalid entry/exit/initial risk data");
 // Only use fully closed 1m bars after entry and before recorded exit; never inspect the partial exit minute.
 const timeline=candles.filter(c=>c.time>=entryMs&&c.time+60_000<=exitMs).sort((a,b)=>a.time-b.time);
 if(!timeline.length)return invalid("NO_CANDLES","No candles inside recorded trade interval");
 const isLong=trade.side==="LONG";
 // Prefer the original recorded quantity. TP1 is anchored at 0.75R in the production entry schema,
 // so it reconstructs the initial stop distance even when stop_loss was later trailed.
 const qty=finite(trade.position_size??NaN)&&Number(trade.position_size)>0?Number(trade.position_size):(cfg.equity*cfg.riskFraction)/riskDist;
 const entryFill=trade.entry_price*(isLong?1+cfg.slippageRate:1-cfg.slippageRate);
 let stop=isLong?trade.entry_price-riskDist:trade.entry_price+riskDist,remaining=1,gross=0,fees=entryFill*qty*cfg.feeRate,partialFills=0,ambiguous=0,reason="END_OF_DATA",lastExit=entryFill;
 let a=false,b=false,microProtected=false;
 const closeFraction=(fraction:number,reference:number)=>{const f=Math.min(remaining,fraction);if(f<=0)return;const fill=reference*(isLong?1-cfg.slippageRate:1+cfg.slippageRate);const units=qty*f;gross+=(isLong?fill-entryFill:entryFill-fill)*units;fees+=((entryFill+fill)*units)*cfg.feeRate;remaining-=f;lastExit=fill;partialFills++;};
 for(let i=0;i<timeline.length&&remaining>1e-9;i++){
  const c=timeline[i];const stopHit=isLong?c.low<=stop:c.high>=stop;
  const targets=[!a?trade.take_profit_1:NaN,!b?trade.take_profit_2:NaN,(a&&b)?trade.take_profit_3:NaN].filter(finite);
  const targetHit=targets.some(t=>isLong?c.high>=t:c.low<=t);
  // Conservative intrabar ordering: an already-active stop wins any same-bar target collision.
  if(stopHit){if(targetHit)ambiguous++;closeFraction(remaining,stop);reason=targetHit?"AMBIGUOUS_STOP_FIRST":"STOP_HIT";break;}

  // Production soft-protection rule: at +0.45R move the stop to -0.25R until TP1.
  if(!microProtected&&!a){
   const protectTrigger=isLong?trade.entry_price+riskDist*0.45:trade.entry_price-riskDist*0.45;
   const protectedStop=isLong?trade.entry_price-riskDist*0.25:trade.entry_price+riskDist*0.25;
   const favorableReached=isLong?c.high>=protectTrigger:c.low<=protectTrigger;
   const protectedStopTouched=isLong?c.low<=protectedStop:c.high>=protectedStop;
   const tp1AlsoTouched=isLong?c.high>=trade.take_profit_1:c.low<=trade.take_profit_1;
   if(favorableReached&&protectedStopTouched&&tp1AlsoTouched){
    // The minute OHLC cannot order +0.45R, the -0.25R stop, and TP1. Resolve worst-case.
    ambiguous++;closeFraction(remaining,protectedStop);reason="AMBIGUOUS_MICRO_PROTECTION_STOP_FIRST";break;
   }
   if(favorableReached&&!protectedStopTouched){stop=protectedStop;microProtected=true;}
   else if(favorableReached&&protectedStopTouched)ambiguous++;
  }
  if(!a&&(isLong?c.high>=trade.take_profit_1:c.low<=trade.take_profit_1)){
   closeFraction(tp1Fraction,trade.take_profit_1);a=true;stop=isLong?trade.entry_price+riskDist*cfg.moveStopAfterTp1R:trade.entry_price-riskDist*cfg.moveStopAfterTp1R;
   const movedStopHit=isLong?c.low<=stop:c.high>=stop;
   if(movedStopHit&&remaining>1e-9){ambiguous++;closeFraction(remaining,stop);reason="SAME_BAR_TP1_THEN_MOVED_STOP_CONSERVATIVE";break;}
  }
  if(a&&!b&&(isLong?c.high>=trade.take_profit_2:c.low<=trade.take_profit_2)){
   closeFraction(tp2Fraction,trade.take_profit_2);b=true;const floorR=tp1R;stop=isLong?trade.entry_price+riskDist*floorR:trade.entry_price-riskDist*floorR;
   const movedStopHit=isLong?c.low<=stop:c.high>=stop;
   if(movedStopHit&&remaining>1e-9){ambiguous++;closeFraction(remaining,stop);reason="SAME_BAR_TP2_THEN_MOVED_STOP_CONSERVATIVE";break;}
  }
  if(a&&b&&(isLong?c.high>=trade.take_profit_3:c.low<=trade.take_profit_3)){
   closeFraction(tp3Fraction,trade.take_profit_3);reason="TP3";break;
  }
  if(i===timeline.length-1){closeFraction(remaining,c.close);reason="RECORDED_WINDOW_CLOSE";}
 }
 const net=gross-fees,riskUsd=qty*riskDist;
 return {trade_id:trade.trade_id,status:"REPLAYED",exitReason:reason,exitPrice:lastExit,grossPnl:gross,fees,netPnl:net,netR:net/riskUsd,partialFills,bars:timeline.length,ambiguousBars:ambiguous,recordedR:finite(trade.pnl_r??NaN)?trade.pnl_r!:null};
}
export function summarizeReplay(results:ReplayResult[]){
 const valid=results.filter(r=>r.status==="REPLAYED"),wins=valid.filter(r=>r.netPnl>0),losses=valid.filter(r=>r.netPnl<0),grossWin=wins.reduce((s,r)=>s+r.netPnl,0),grossLoss=-losses.reduce((s,r)=>s+r.netPnl,0);
 let equity=0,peak=0,maxDrawdown=0;for(const r of valid){equity+=r.netPnl;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity);}
 return {trades:valid.length,coverage:results.length?valid.length/results.length:0,wins:wins.length,losses:losses.length,winRate:valid.length?wins.length/valid.length:0,netPnl:valid.reduce((s,r)=>s+r.netPnl,0),netR:valid.reduce((s,r)=>s+r.netR,0),profitFactor:grossLoss?grossWin/grossLoss:null,expectancy:valid.length?valid.reduce((s,r)=>s+r.netPnl,0)/valid.length:0,maxDrawdownUsd:maxDrawdown,fees:valid.reduce((s,r)=>s+r.fees,0),ambiguousBars:valid.reduce((s,r)=>s+r.ambiguousBars,0)};
}
