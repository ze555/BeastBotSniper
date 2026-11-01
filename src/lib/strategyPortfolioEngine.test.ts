import assert from "node:assert/strict";
import { evaluateStrategyPortfolio, evaluateRiskGuardian, simulatePartialExitTrade, summarizeReplay, StrategyCandle, ReplayCandle } from "./strategyPortfolioEngine.js";

function makeCandles():StrategyCandle[]{
 const out:StrategyCandle[]=[];let p=100;
 for(let i=0;i<40;i++){const open=p;const drift=0.08;const close=open+drift;out.push({time:i,open,high:close+0.08,low:open-0.04,close,volume:1000+(i%4)*30,takerBuyBase:650});p=close;}
 return out;
}
{
 const c=makeCandles();const result=evaluateStrategyPortfolio(c,{btcRegime:"BULL_WEAK"});
 assert.equal(result.length,2,"portfolio evaluates both directions");
 assert.equal(result[0].side,"LONG");
 assert.equal(result[0].candidates.length,4,"all four strategy families are evaluated independently");
 assert.equal(result[1].side,"SHORT");
 assert.ok(result.every(x=>x.candidates.every(y=>Number.isFinite(y.score))),"scores are finite");
}

function flatCandles():StrategyCandle[]{
 return Array.from({length:40},(_,i)=>({time:i,open:100,high:100.2,low:99.8,close:100.05,volume:1000,takerBuyBase:650}));
}
{
 const trend=makeCandles();
 const trendLong=evaluateStrategyPortfolio(trend)[0].candidates.find(x=>x.strategy==="TREND_RIDER");
 assert.equal(trendLong?.accepted,true,"trend continuation candidate should pass aligned rising structure and flow");
 const breakout=flatCandles();
 breakout.push({time:40,open:100.15,high:100.85,low:100.14,close:100.75,volume:2200,takerBuyBase:1500});
 const breakoutLong=evaluateStrategyPortfolio(breakout)[0].candidates.find(x=>x.strategy==="BREAKOUT_RETEST");
 assert.equal(breakoutLong?.accepted,true,"breakout/retest candidate should pass a closed breakout and retest");
 const reversal=flatCandles();
 reversal.push({time:40,open:99.6,high:100.1,low:99.0,close:100.0,volume:2200,takerBuyBase:1500});
 const reversalLong=evaluateStrategyPortfolio(reversal)[0].candidates.find(x=>x.strategy==="LIQUIDITY_REVERSAL");
 assert.equal(reversalLong?.accepted,true,"liquidity reversal candidate should pass a sweep and reclaim");
 const momentum=flatCandles();
 momentum.push({time:40,open:100,high:101.7,low:99.9,close:101.5,volume:2200,takerBuyBase:1500});
 const momentumLong=evaluateStrategyPortfolio(momentum)[0].candidates.find(x=>x.strategy==="MOMENTUM_EXPANSION");
 assert.equal(momentumLong?.accepted,true,"momentum expansion candidate should pass directional range and volume expansion");
}
{
 const denied=evaluateRiskGuardian({equity:1000,stopDistancePct:0.01,currentOpenRiskFraction:0.02,dailyRealizedPnl:0,openPositions:0,correlatedOpenPositions:0});
 assert.equal(denied.allowed,false,"portfolio risk cap blocks additional risk");
 const allowed=evaluateRiskGuardian({equity:1000,stopDistancePct:0.01,currentOpenRiskFraction:0.005,dailyRealizedPnl:0,openPositions:1,correlatedOpenPositions:0});
 assert.equal(allowed.allowed,true);
 assert.equal(allowed.riskUsd,5,"default single-trade risk is 0.5% of equity");
 const dailyStop=evaluateRiskGuardian({equity:1000,stopDistancePct:0.01,currentOpenRiskFraction:0,dailyRealizedPnl:-20,openPositions:0,correlatedOpenPositions:0});
 assert.equal(dailyStop.allowed,false,"daily loss cap blocks fresh entries");
 const concentration=evaluateRiskGuardian({equity:1000,stopDistancePct:0.01,currentOpenRiskFraction:0,dailyRealizedPnl:0,openPositions:2,correlatedOpenPositions:2});
 assert.equal(concentration.allowed,false,"same-direction concentration proxy blocks excess exposure");
}
{
 const trade={trade_id:"WIN",side:"LONG" as const,timestamp_entry:"2026-11-01T00:00:00.000Z",timestamp_exit:"2026-11-01T00:03:00.000Z",entry_price:100,stop_loss:99,take_profit_1:100.75,take_profit_2:101.8,take_profit_3:103.5,position_size:10,pnl_r:2};
 const t=Date.parse(trade.timestamp_entry);
 const candles:ReplayCandle[]=[
  {time:t,open:100,high:101.2,low:100.4,close:101,volume:1000},
  {time:t+60000,open:101,high:102.2,low:100.9,close:102,volume:1000},
  {time:t+120000,open:102,high:103.6,low:101.1,close:103.4,volume:1000}
 ];
 const r=simulatePartialExitTrade(trade,candles);
 assert.equal(r.status,"REPLAYED");
 assert.equal(r.partialFills,3,"three partial target fills are modelled");
 assert.equal(r.exitReason,"TP3");
 assert.ok(r.netPnl>0);
 assert.ok(r.fees>0);
}
{
 const trade={trade_id:"AMBIG",side:"LONG" as const,timestamp_entry:"2026-11-01T00:00:00.000Z",timestamp_exit:"2026-11-01T00:01:00.000Z",entry_price:100,stop_loss:99,take_profit_1:100.75,take_profit_2:101.8,take_profit_3:103.5,pnl_r:-1};
 const t=Date.parse(trade.timestamp_entry);
 const r=simulatePartialExitTrade(trade,[{time:t,open:100,high:101.2,low:98.8,close:100,volume:1000}]);
 assert.equal(r.exitReason,"STOP_OR_AMBIGUOUS_STOP_FIRST","same-candle stop/target collision resolves conservatively");
 assert.equal(r.ambiguousBars,1);
 assert.ok(r.netPnl<0);
}

{
 const trade={trade_id:"TRAILING_STOP_RECORD",side:"LONG" as const,timestamp_entry:"2026-11-01T00:00:00.000Z",timestamp_exit:"2026-11-01T00:01:00.000Z",entry_price:100,stop_loss:99.8,take_profit_1:100.75,take_profit_2:101.8,take_profit_3:103.5,position_size:10,pnl_r:0.1};
 const t=Date.parse(trade.timestamp_entry);
 const r=simulatePartialExitTrade(trade,[{time:t,open:100,high:100.9,low:99.5,close:100.8,volume:1000}]);
 assert.equal(r.partialFills,2,"initial stop is reconstructed from TP1 rather than the later trailed stop field");
 assert.equal(r.exitReason,"SAME_BAR_TP1_THEN_MOVED_STOP_CONSERVATIVE");
}
{
 const s=summarizeReplay([]);
 assert.equal(s.trades,0);
 assert.equal(s.profitFactor,null);
}
console.log("strategyPortfolioEngine: all tests passed");
