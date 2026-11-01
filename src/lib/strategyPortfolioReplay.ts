import fs from "node:fs";
import { evaluateStrategyPortfolio, simulatePartialExitTrade, summarizeReplay, DEFAULT_REPLAY_CONFIG, filterSnapshotCandles, StrategyCandle, ReplayCandle, ReplayTrade, ReplayResult, StrategyId } from "./strategyPortfolioEngine.js";

interface ResearchTrade extends ReplayTrade {
 symbol:string;market_regime:string;market_context?:{btc_regime?:string;volatility_state?:string;funding_rate?:number};
 candles_before_entry?:(StrategyCandle & {timestamp?:string})[];risk_percent?:number;pnl?:number;fees?:number;
}
const trades=JSON.parse(fs.readFileSync("study_all_trades_master.json","utf8")) as ResearchTrade[];
const streams=JSON.parse(fs.readFileSync("master_candles_1m.json","utf8")) as Record<string,ReplayCandle[]>;
const ids:StrategyId[]=["TREND_RIDER","BREAKOUT_RETEST","LIQUIDITY_REVERSAL","MOMENTUM_EXPANSION"];
const candidateStats:Record<string,{evaluated:number;accepted:number;matchedDirection:number;scoreSum:number}>={};
const candidateTradeIds:Record<string,Set<string>>={};
for(const id of ids){candidateStats[id]={evaluated:0,accepted:0,matchedDirection:0,scoreSum:0};candidateTradeIds[id]=new Set<string>();}
let featureCoverage=0;
for(const t of trades){
 const entryMs=Date.parse(t.timestamp_entry);
 const rawSnapshots=Array.isArray(t.candles_before_entry)?t.candles_before_entry:[];
 const c=filterSnapshotCandles(rawSnapshots,entryMs,15*60_000);
 if(c.length<25)continue;
 featureCoverage++;
 const context={btcRegime:t.market_context?.btc_regime, fundingRate:t.market_context?.funding_rate,oiAvailable:false};
 const evaluated=evaluateStrategyPortfolio(c,context);
 for(const side of evaluated)for(const candidate of side.candidates){
  const s=candidateStats[candidate.strategy];s.evaluated++;s.scoreSum+=candidate.score;
  if(candidate.accepted){s.accepted++;if(candidate.side===t.side){s.matchedDirection++;candidateTradeIds[candidate.strategy].add(t.trade_id);}}
 }
}
const replayResults:ReplayResult[]=[];
for(const t of trades){
 const candles=streams[t.trade_id];
 if(!candles)continue;
 const cfg={...DEFAULT_REPLAY_CONFIG,riskFraction:(Number(t.risk_percent)||0.5)/100};
 replayResults.push(simulatePartialExitTrade(t,candles,cfg));
}
const summary=summarizeReplay(replayResults);
const conditionalOutcomes=Object.fromEntries(ids.map(id=>{
 const idsForStrategy=candidateTradeIds[id];
 const subset=replayResults.filter(r=>idsForStrategy.has(r.trade_id));
 const stats=summarizeReplay(subset);
 return [id,{acceptedExecutedTrades:idsForStrategy.size,replayedTrades:stats.trades,winRatePct:Number((stats.winRate*100).toFixed(1)),netPnl:Number(stats.netPnl.toFixed(2)),netR:Number(stats.netR.toFixed(3)),profitFactor:stats.profitFactor===null?null:Number(stats.profitFactor.toFixed(3)),maxDrawdownUsd:Number(stats.maxDrawdownUsd.toFixed(2))}];
}));
const replayedIds=new Set(replayResults.map(r=>r.trade_id));
const recorded=trades.filter(t=>replayedIds.has(t.trade_id)&&Number.isFinite(t.pnl_r));
const recordedPnl=recorded.reduce((s,t)=>s+(Number(t.pnl)||0),0);
const recordedR=recorded.reduce((s,t)=>s+(Number(t.pnl_r)||0),0);
const recordedFees=recorded.reduce((s,t)=>s+(Number(t.fees)||0),0);
const result={
 dataset:{trades:trades.length,tradeCandleCoverage:Object.keys(streams).length,featureSnapshotCoverage:featureCoverage,recordedNetPnl:Number(recordedPnl.toFixed(2)),recordedNetR:Number(recordedR.toFixed(3)),recordedFeesAllTrades:Number(trades.reduce((s,t)=>s+(Number(t.fees)||0),0).toFixed(2)),recordedCoveredFees:Number(recordedFees.toFixed(2))},
 entryCandidateDiagnostics:Object.fromEntries(ids.map(id=>{const s=candidateStats[id];return [id,{evaluated:s.evaluated,accepted:s.accepted,acceptedPct:s.evaluated?Number((s.accepted/s.evaluated*100).toFixed(1)):0,acceptedOnActualSide:s.matchedDirection,averageScore:s.evaluated?Number((s.scoreSum/s.evaluated).toFixed(2)):0}]})),
 conditionalOutcomesOnExecutedTradeSnapshots:conditionalOutcomes,
 fillAwarePartialExitReplay:{...summary,netPnl:Number(summary.netPnl.toFixed(2)),netR:Number(summary.netR.toFixed(3)),profitFactor:summary.profitFactor===null?null:Number(summary.profitFactor.toFixed(3)),expectancy:Number(summary.expectancy.toFixed(3)),maxDrawdownUsd:Number(summary.maxDrawdownUsd.toFixed(2)),fees:Number(summary.fees.toFixed(2)),coveragePct:Number((replayResults.length/trades.length*100).toFixed(1)),withinAvailableStreamsPct:Number((summary.coverage*100).toFixed(1))},
 comparison:{recordedCoveredPnl:Number(recordedPnl.toFixed(2)),recordedCoveredR:Number(recordedR.toFixed(3)),replayedVsRecordedPnl:Number((summary.netPnl-recordedPnl).toFixed(2)),riskUnitComparison:"Recorded pnl_r denominator and fee convention are not fully specified; report replay netR and recorded R separately."},
 limitations:[
  "Entry candidates are evaluated only on completed 15m candles in pre-entry snapshots attached to executed trades; this cannot measure rejected opportunities or produce unbiased candidate strategy expectancy.",
  "The 1m candle streams cover only a subset of trades and stop at the recorded exit. Replay therefore compares a new partial-exit policy inside each historical trade's observed holding window.",
  "The simulator uses recorded position_size and reconstructs initial risk distance from TP1 at the recorded tp1_r (0.75R for the legacy export); otherwise it falls back to configured 0.5% risk sizing. It models 0.04% fee and 0.02% slippage on entry and each exit; historical account fee tier, spread, queue position and actual partial fill records are not present.",
  "The export does not fully document the recorded pnl_r denominator or fee convention. Replay netR uses reconstructed initial risk and modeled costs; keep replay netR and recorded R as separate metrics rather than treating their difference as a direct policy effect.",
  "If a 1m candle touches both the active stop and a target, stop-first ordering is applied conservatively. Intrabar order is unknown.",
  "The simulator models the +0.45R/-0.25R soft protection and TP1/TP2 stop progression, but not the live institutional guard exits, 45-minute time-decay exit, or ATR runner trailing after TP2 because the export lacks the complete intrabar/orderflow context.",
  "This replay does not model concurrent portfolio fills, funding payments, exchange liquidation, websocket latency, or the rejected-signal opportunity set."
 ],
 decision:"Research diagnostic only. No candidate is promoted or connected to live entry/exit execution."
};
console.log(JSON.stringify(result,null,2));
