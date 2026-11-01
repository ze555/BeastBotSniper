/**
 * Research-only strategy portfolio and fill-aware simulator.
 * No network calls, no exchange execution, and no live config mutation.
 */
export type Side = "LONG" | "SHORT";
export type StrategyId = "TREND_RIDER" | "BREAKOUT_RETEST" | "LIQUIDITY_REVERSAL" | "MOMENTUM_EXPANSION";
export interface StrategyCandle { time?: number | string; open:number; high:number; low:number; close:number; volume:number; takerBuyBase?:number }
export interface StrategyContext {
 btcRegime?:string; btcChangePct?:number; fundingRate?:number;
 oiChangePct?:number; oiAvailable?:boolean; priceChangePct?:number;
 cvdSlope5?:number; cvdSlope15?:number; cvdAvailable?:boolean;
 orderBookImbalance?:number; orderBookAvailable?:boolean; orderBookAgeMs?:number;
}
export interface StrategyCandidate { strategy:StrategyId; side:Side; accepted:boolean; reasons:string[]; missingEvidence:string[]; entryReference:number; stopReference:number; targetR:number }
export interface StrategyEvaluation { side:Side; candidates:StrategyCandidate[]; selected:StrategyCandidate|null }
export interface StrategyExitPlan { tp1R:number; tp2R:number; tp3R:number; partA:number; partB:number; partC:number; minRRRequired:number }
export function applyRegimeRiskMultiplier(riskUsd:number,assetRegime:string):number { return assetRegime==="RANGE"||assetRegime==="TRANSITION"?riskUsd*0.5:riskUsd; }
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
export function filterSnapshotCandles<T extends {time?:number|string;timestamp?:string}>(candles:T[],entryTimeMs:number,intervalMs:number):T[] { return candles.filter(c=>{const raw=c.time??c.timestamp;const numeric=typeof raw==="number"?raw:Number(raw);const start=Number.isFinite(numeric)?numeric:Date.parse(String(raw||""));return Number.isFinite(start)&&start+intervalMs<=entryTimeMs;}); }
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
function ema(values:number[],period:number):number { if(!values.length)return 0; const k=2/(period+1); let v=values[0]; for(let i=1;i<values.length;i++)v=values[i]*k+v*(1-k); return v; }
function atr(c:StrategyCandle[],period=14):number { if(c.length<2)return 0; const tr:number[]=[]; for(let i=1;i<c.length;i++)tr.push(Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close))); return tr.slice(-period).reduce((a,b)=>a+b,0)/Math.min(period,tr.length); }
function rsi(closes:number[],period=14):number { if(closes.length<=period)return 50; let up=0,down=0; for(let i=closes.length-period;i<closes.length;i++){const d=closes[i]-closes[i-1];if(d>0)up+=d;else down-=d;} return down===0?100:100-100/(1+(up/period)/(down/period)); }
function flowRatio(c:StrategyCandle[]):number { const valid=c.filter(x=>finite(x.takerBuyBase??NaN)); if(valid.length===c.length&&c.length){const v=c.reduce((s,x)=>s+x.volume,0);return v>0?c.reduce((s,x)=>s+(x.takerBuyBase||0),0)/v:0.5;} const v=c.reduce((s,x)=>s+x.volume,0); if(v<=0)return 0.5; return c.reduce((s,x)=>s+x.volume*(x.high>x.low?(x.close-x.low)/(x.high-x.low):0.5),0)/v; }
function evaluateConfluenceCandidate(strategy:StrategyId,side:Side,c:StrategyCandle[],ctx:StrategyContext):StrategyCandidate {
 const last=c[c.length-1],prev=c[c.length-2],cl=c.map(x=>x.close);
 const price=last.close,a=atr(c),e9=ema(cl.slice(-60),9),e21=ema(cl.slice(-80),21),e50=ema(cl.slice(-120),50);
 const flow=flowRatio(c.slice(-5)),avgVol=c.slice(-21,-1).reduce((s,x)=>s+x.volume,0)/Math.max(1,Math.min(20,c.length-1));
 const rvol=last.volume/(avgVol||1),priorHigh=Math.max(...c.slice(0,-1).map(x=>x.high).slice(-20)),priorLow=Math.min(...c.slice(0,-1).map(x=>x.low).slice(-20));
 const range=Math.max(last.high-last.low,1e-12),body=Math.abs(last.close-last.open),bodyRatio=body/range;
 const lowerWick=Math.min(last.open,last.close)-last.low,upperWick=last.high-Math.max(last.open,last.close);
 const bull=side==="LONG",dir=bull?1:-1,reasons:string[]=[],missing:string[]=[];
 const add=(ok:boolean,reason:string,missingReason:string)=>{if(ok)reasons.push(reason);else missing.push(missingReason);};
 const invalid=(reason:string)=>({strategy,side,accepted:false,reasons,missingEvidence:[reason],entryReference:price,stopReference:bull?last.low:last.high,targetR:0});
 if(!finite(price)||!finite(a)||a<=0||c.length<25)return invalid("At least 25 valid completed candles and positive ATR are required");
 if(!c.every(x=>[x.open,x.high,x.low,x.close,x.volume].every(finite)&&x.volume>=0&&x.high>=Math.max(x.open,x.close)&&x.low<=Math.min(x.open,x.close)&&x.high>=x.low))return invalid("Malformed OHLCV input");
 // Independent market-data confirmations. Missing/stale sources are blockers, never neutral votes.
 const oiFresh=ctx.oiAvailable===true&&finite(ctx.oiChangePct??NaN)&&finite(ctx.priceChangePct??NaN);
 const cvdFresh=ctx.cvdAvailable===true&&finite(ctx.cvdSlope5??NaN)&&finite(ctx.cvdSlope15??NaN);
 const bookFresh=ctx.orderBookAvailable===true&&finite(ctx.orderBookImbalance??NaN)&&finite(ctx.orderBookAgeMs??NaN)&&Number(ctx.orderBookAgeMs)<=5000;
 const flowAligned=bull?flow>=0.54:flow<=0.46;
 const cvdAligned=cvdFresh&&(bull?Number(ctx.cvdSlope5)>0&&Number(ctx.cvdSlope15)>0:Number(ctx.cvdSlope5)<0&&Number(ctx.cvdSlope15)<0);
 const oiBuildAligned=oiFresh&&Number(ctx.oiChangePct)>=0.001&&(bull?Number(ctx.priceChangePct)>0:Number(ctx.priceChangePct)<0);
 const oiFlushCompatible=oiFresh&&Number(ctx.oiChangePct)<=-0.001&&(bull?Number(ctx.priceChangePct)>0:Number(ctx.priceChangePct)<0);
 const fundingSafe=finite(ctx.fundingRate??NaN)&&(bull?Number(ctx.fundingRate)<0.0005:Number(ctx.fundingRate)>-0.0005);
 const bookAligned=bookFresh&&(bull?Number(ctx.orderBookImbalance)>=0.10:Number(ctx.orderBookImbalance)<=-0.10);
 const trendAligned=bull?price>e21&&e21>e50:price<e21&&e21<e50;
 const directionalCandle=bull?last.close>last.open&&last.close>prev.close:last.close<last.open&&last.close<prev.close;
 const riskStop=(stop:number)=>{const pct=Math.abs(price-stop)/price;return (bull?stop<price:stop>price)&&pct>=0.001&&pct<=0.04;};
 // Every strategy must pass data integrity, exchange flow, CVD, OI/price relationship,
 // funding crowding and a fresh order-book imbalance gate. No additive score or compensating votes.
 add(cvdFresh,"5m and 15m CVD are available","CVD data missing or stale");
 add(cvdAligned,"5m and 15m CVD slopes agree with the trade direction","CVD timeframes conflict or oppose direction");
 add(oiFresh,"Open interest and price-change observations are available","Open-interest/price data unavailable");
 add(oiBuildAligned||oiFlushCompatible,"Price/OI relationship is compatible with directional positioning or covering","Price/OI relationship does not confirm direction");
 add(flowAligned,"Taker-buy/sell flow agrees with direction","Taker flow is neutral or opposing");
 add(fundingSafe,"Funding is not excessively crowded against the trade","Funding unavailable or crowding risk detected");
 add(bookAligned,"Fresh order-book depth imbalance agrees with direction","Fresh order-book imbalance unavailable, stale or opposing");
 let entry=price,stop=bull?Math.min(...c.slice(-4).map(x=>x.low))-a*0.25:Math.max(...c.slice(-4).map(x=>x.high))+a*0.25,targetR=3.5;
 switch(strategy){
  case "TREND_RIDER":
   add(trendAligned,"15m EMA21/EMA50 structure aligned","15m trend structure not aligned");
   add(bull?e9>e21:e9<e21,"EMA9 confirms resumption","EMA9 does not confirm resumption");
   add(directionalCandle,"Completed candle resumes direction","No directional close confirmation");
   add(rvol>=0.8&&rvol<=3.5,"Participation is adequate and not climactic","Relative volume outside permitted band");
   add(bull? rsi(cl)>=45&&rsi(cl)<=68:rsi(cl)>=32&&rsi(cl)<=55,"RSI is not extended","RSI is extended or inconsistent");
   targetR=3.5;break;
  case "BREAKOUT_RETEST":{
   const level=bull?priorHigh:priorLow;
   const breakout=bull?price>level:price<level;
   const retest=bull?last.low<=level+a*0.25&&price>=level:last.high>=level-a*0.25&&price<=level;
   add(breakout,"Completed candle closes beyond prior 20-candle boundary","No confirmed close beyond structure");
   add(retest,"Broken level is retested and held","No successful retest/hold");
   add(bodyRatio>=0.45,"Breakout candle body confirms acceptance","Breakout close lacks body conviction");
   add(rvol>=1.2,"Breakout participation expands","Breakout volume expansion missing");
   stop=bull?Math.min(last.low,level-a*0.2):Math.max(last.high,level+a*0.2);targetR=3.5;break;
  }
  case "LIQUIDITY_REVERSAL":{
   const sweep=bull?last.low<priorLow&&price>priorLow:last.high>priorHigh&&price<priorHigh;
   const wick=bull?lowerWick>=Math.max(body*1.5,a*0.25):upperWick>=Math.max(body*1.5,a*0.25);
   add(sweep,"Prior liquidity boundary swept and reclaimed","No confirmed sweep-and-reclaim");
   add(wick,"Rejection wick confirms failed auction","No material rejection wick");
   add(bull?price>last.open:price<last.open,"Reclaim candle closes in reversal direction","Reclaim close does not confirm reversal");
   add(rvol>=1.2,"Volume expands at swept liquidity","No volume expansion at sweep");
   // Reversal may be powered by position reduction (covering/liquidation), not new OI.
   add(oiFlushCompatible||oiBuildAligned,"OI/price behavior supports covering or fresh directional build","OI/price behavior does not support reversal");
   stop=bull?last.low-a*0.15:last.high+a*0.15;targetR=2.5;break;
  }
  case "MOMENTUM_EXPANSION":{
   add(range>=a*1.1&&bodyRatio>=0.6,"ATR expansion and directional body confirmed","No genuine range/body expansion");
   add(directionalCandle,"Momentum candle closes directionally","Momentum candle direction unconfirmed");
   add(rvol>=1.5&&rvol<=4,"Volume expansion confirms participation","Volume is insufficient or climactic");
   add(bull?e9>e21:e9<e21,"Fast EMA structure agrees","Fast EMA structure conflicts");
   add(Math.abs(price-e9)<=a*1.8,"Entry is not excessively extended","Entry is too far from EMA9");
   stop=bull?last.low-a*0.2:last.high+a*0.2;targetR=3;break;
  }
 }
 const accepted=missing.length===0&&riskStop(stop);
 if(!riskStop(stop))missing.push("Stop is on wrong side or outside 0.10%-4.00% risk band");
 return {strategy,side,accepted,reasons,missingEvidence:missing,entryReference:entry,stopReference:stop,targetR};
}
export function evaluateStrategyPortfolio(candles:StrategyCandle[],ctx:StrategyContext={}):StrategyEvaluation[]{
 if(candles.length<25)return (["LONG","SHORT"] as Side[]).map(side=>({side,candidates:[],selected:null}));
 return (["LONG","SHORT"] as Side[]).map(side=>{
  const candidates=(["TREND_RIDER","BREAKOUT_RETEST","LIQUIDITY_REVERSAL","MOMENTUM_EXPANSION"] as StrategyId[]).map(s=>evaluateConfluenceCandidate(s,side,candles,ctx));
  const selected=candidates.find(x=>x.accepted)||null;
  return {side,candidates,selected};
 });
}
export interface RiskRequest { equity:number; entryPrice:number; stopDistancePct:number; currentOpenRiskFraction:number; dailyRealizedPnl:number; openPositions:number; correlatedOpenPositions:number }
export interface RiskDecision { allowed:boolean; riskUsd:number; quantity:number; reason:string }
export function evaluateRiskGuardian(req:RiskRequest,cfg:RiskGuardianConfig=DEFAULT_RISK_GUARDIAN):RiskDecision{
 const fail=(reason:string):RiskDecision=>({allowed:false,riskUsd:0,quantity:0,reason});
 if(!finite(req.equity)||req.equity<=0||!finite(req.entryPrice)||req.entryPrice<=0||!finite(req.stopDistancePct)||req.stopDistancePct<0.001||req.stopDistancePct>0.04)return fail("Invalid equity, entry price or stop distance outside 0.10%-4.00%");
 if(!finite(req.currentOpenRiskFraction)||req.currentOpenRiskFraction<0||req.currentOpenRiskFraction>1||
    !finite(req.dailyRealizedPnl)||!Number.isInteger(req.openPositions)||req.openPositions<0||
    !Number.isInteger(req.correlatedOpenPositions)||req.correlatedOpenPositions<0||
    !finite(cfg.riskFraction)||cfg.riskFraction<=0||cfg.riskFraction>1||
    !finite(cfg.maxPortfolioRiskFraction)||cfg.maxPortfolioRiskFraction<=0||cfg.maxPortfolioRiskFraction>1||
    !finite(cfg.dailyLossLimitFraction)||cfg.dailyLossLimitFraction<=0||cfg.dailyLossLimitFraction>1||
    !Number.isInteger(cfg.maxPositions)||cfg.maxPositions<1||
    !Number.isInteger(cfg.maxCorrelatedPositions)||cfg.maxCorrelatedPositions<1)
   return fail("Invalid risk state or guardian configuration");
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
export interface ReplayTrade { trade_id:string;side:Side;timestamp_entry:string;timestamp_exit:string;entry_price:number;stop_loss:number;take_profit_1:number;take_profit_2:number;take_profit_3:number;position_size?:number;initial_stop_loss?:number;initial_sl_dist?:number;initial_risk_usd?:number;pnl_r?:number;tp1_r?:number;tp2_r?:number;tp3_r?:number;part_a?:number;part_b?:number;part_c?:number }
export interface ReplayCandle {time:number;open:number;high:number;low:number;close:number;volume:number;takerBuyBase?:number}
export interface ReplayConfig {equity:number;riskFraction:number;feeRate:number;slippageRate:number;tp1Fraction:number;tp2Fraction:number;tp3Fraction:number;moveStopAfterTp1R:number;moveStopAfterTp2R:number;maxHoldMinutes:number}
export const DEFAULT_REPLAY_CONFIG:ReplayConfig={equity:1000,riskFraction:0.005,feeRate:0.0004,slippageRate:0.0002,tp1Fraction:0.4,tp2Fraction:0.35,tp3Fraction:0.25,moveStopAfterTp1R:0.3,moveStopAfterTp2R:0.75,maxHoldMinutes:1440};
export interface ReplayResult {trade_id:string;status:"REPLAYED"|"NO_CANDLES"|"INVALID";exitReason:string;exitPrice:number;grossPnl:number;fees:number;netPnl:number;netR:number;partialFills:number;bars:number;ambiguousBars:number;recordedR:number|null}
export function simulatePartialExitTrade(trade:ReplayTrade,candles:ReplayCandle[],cfg:ReplayConfig=DEFAULT_REPLAY_CONFIG):ReplayResult{
 const invalid=(status:ReplayResult["status"],reason:string):ReplayResult=>({trade_id:trade.trade_id,status,exitReason:reason,exitPrice:trade.entry_price,grossPnl:0,fees:0,netPnl:0,netR:0,partialFills:0,bars:0,ambiguousBars:0,recordedR:finite(trade.pnl_r??NaN)?trade.pnl_r!:null});
 if(!Array.isArray(candles)||!candles.length)return invalid("NO_CANDLES","No 1m candles");
 const entryMs=Date.parse(trade.timestamp_entry),exitMs=Date.parse(trade.timestamp_exit);
 const tp1R=finite(trade.tp1_r??NaN)&&Number(trade.tp1_r)>0?Number(trade.tp1_r):0.75; 
 const tpRiskDistance=Math.abs(trade.take_profit_1-trade.entry_price)/tp1R;
 const storedRiskDistance=Number(trade.initial_sl_dist);
 const riskDist=finite(storedRiskDistance)&&storedRiskDistance>0?storedRiskDistance:(finite(tpRiskDistance)&&tpRiskDistance>0?tpRiskDistance:Math.abs(trade.entry_price-trade.stop_loss));
 const isLong=trade.side==="LONG";
 const initialStop=finite(trade.initial_stop_loss??NaN)?Number(trade.initial_stop_loss):(isLong?trade.entry_price-riskDist:trade.entry_price+riskDist);
 const tp1Fraction=finite(trade.part_a??NaN)?Number(trade.part_a):cfg.tp1Fraction;
 const tp2Fraction=finite(trade.part_b??NaN)?Number(trade.part_b):cfg.tp2Fraction;
 const tp3Fraction=finite(trade.part_c??NaN)?Number(trade.part_c):cfg.tp3Fraction;
 const fractionsValid=[tp1Fraction,tp2Fraction,tp3Fraction].every(x=>finite(x)&&x>=0&&x<=1)&&Math.abs(tp1Fraction+tp2Fraction+tp3Fraction-1)<1e-6;
 const targetsValid=isLong
   ? trade.take_profit_1>trade.entry_price&&trade.take_profit_2>=trade.take_profit_1&&trade.take_profit_3>=trade.take_profit_2
   : trade.take_profit_1<trade.entry_price&&trade.take_profit_2<=trade.take_profit_1&&trade.take_profit_3<=trade.take_profit_2;
 if(!finite(entryMs)||!finite(exitMs)||exitMs<=entryMs||!finite(riskDist)||riskDist<=0||!finite(trade.entry_price)||trade.entry_price<=0||
    !finite(initialStop)||!(isLong?initialStop<trade.entry_price:initialStop>trade.entry_price)||!targetsValid||
    !finite(cfg.equity)||cfg.equity<=0||!finite(cfg.riskFraction)||cfg.riskFraction<=0||
    !finite(cfg.feeRate)||cfg.feeRate<0||cfg.feeRate>0.05||!finite(cfg.slippageRate)||cfg.slippageRate<0||cfg.slippageRate>0.05||!fractionsValid)
   return invalid("INVALID","Invalid trade levels, fill costs, size fractions or replay configuration");
 // Only use fully closed 1m bars after entry and before recorded exit; never inspect the partial exit minute.
 const timeline=candles.filter(c=>c.time>=entryMs&&c.time+60_000<=exitMs).sort((a,b)=>a.time-b.time);
 if(!timeline.length)return invalid("NO_CANDLES","No candles inside recorded trade interval");
 const seenTimes=new Set<number>();
 for(const c of timeline){
  if(!finite(c.time)||!finite(c.open)||!finite(c.high)||!finite(c.low)||!finite(c.close)||!finite(c.volume)||c.volume<0||
     c.high<c.low||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||seenTimes.has(c.time))
   return invalid("INVALID","Malformed or duplicate OHLCV candle in replay window");
  seenTimes.add(c.time);
 }
 // Prefer the original recorded quantity. TP1 is anchored at 0.75R in the production entry schema,
 // so it reconstructs the initial stop distance even when stop_loss was later trailed.
 const qty=finite(trade.position_size??NaN)&&Number(trade.position_size)>0?Number(trade.position_size):(cfg.equity*cfg.riskFraction)/riskDist;
 const entryFill=trade.entry_price*(isLong?1+cfg.slippageRate:1-cfg.slippageRate);
 let stop=initialStop,remaining=1,gross=0,fees=entryFill*qty*cfg.feeRate,partialFills=0,ambiguous=0,reason="END_OF_DATA",lastExit=entryFill;
 let a=false,b=false,microProtected=false;
 const closeFraction=(fraction:number,reference:number)=>{const f=Math.min(remaining,fraction);if(f<=0)return;const fill=reference*(isLong?1-cfg.slippageRate:1+cfg.slippageRate);const units=qty*f;gross+=(isLong?fill-entryFill:entryFill-fill)*units;fees+=fill*units*cfg.feeRate;remaining-=f;lastExit=fill;partialFills++;};
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
 const net=gross-fees,storedRiskUsd=Number(trade.initial_risk_usd),riskUsd=finite(storedRiskUsd)&&storedRiskUsd>0?storedRiskUsd:qty*riskDist;
 return {trade_id:trade.trade_id,status:"REPLAYED",exitReason:reason,exitPrice:lastExit,grossPnl:gross,fees,netPnl:net,netR:net/riskUsd,partialFills,bars:timeline.length,ambiguousBars:ambiguous,recordedR:finite(trade.pnl_r??NaN)?trade.pnl_r!:null};
}
export function summarizeReplay(results:ReplayResult[]){
 const valid=results.filter(r=>r.status==="REPLAYED"),wins=valid.filter(r=>r.netPnl>0),losses=valid.filter(r=>r.netPnl<0),grossWin=wins.reduce((s,r)=>s+r.netPnl,0),grossLoss=-losses.reduce((s,r)=>s+r.netPnl,0);
 let equity=0,peak=0,maxDrawdown=0;for(const r of valid){equity+=r.netPnl;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity);}
 return {trades:valid.length,coverage:results.length?valid.length/results.length:0,wins:wins.length,losses:losses.length,winRate:valid.length?wins.length/valid.length:0,netPnl:valid.reduce((s,r)=>s+r.netPnl,0),netR:valid.reduce((s,r)=>s+r.netR,0),profitFactor:grossLoss?grossWin/grossLoss:null,expectancy:valid.length?valid.reduce((s,r)=>s+r.netPnl,0)/valid.length:0,maxDrawdownUsd:maxDrawdown,fees:valid.reduce((s,r)=>s+r.fees,0),ambiguousBars:valid.reduce((s,r)=>s+r.ambiguousBars,0)};
}
