/**
 * BeastBotSniper PAPER runtime — adaptive verified-entry engine.
 * Signal -> next fully closed minute -> 5m/15m confirmation -> Binance
 * executable quote + real book + 5m OI history + net cost veto -> PAPER trade.
 * No guarantee of profitable trades; all observations must be live/complete.
 */
import axios from "axios";
import crypto from "node:crypto";
import { listAllUsdmPerpetuals, nextCoverageBatch } from "./futuresUniverse.js";
import { WaveRadar, scheduleRadarBatch } from "./waveRadar.js";
import { fetchExecutionQuote } from "./executionQuotes.js";
import { markTrade, closedCandles, tightenStop } from "./tradingIntegrity.js";
import { assessOrderBook, adaptiveStopCandidate } from "./adaptiveRegimeStrategy.js";
import {bidirectionalProfitStop,BIDIRECTIONAL_REVISION,type BidirectionalSignal} from "./bidirectionalRegimeEngine.js";
import { parseOpenInterestHistory, verifyExecutableEntry, type EntryDepth, type EntryOi } from "./entryValidation.js";
import { evaluateReversal } from "./institutionalReversal.js";
import {persistSnapshot,persistenceStatus,persistReplayEvent,rotatePaperRun,type ReplayKind} from "./durableStore.js";
import { costAwareProfitLock } from "./entryExitSafeguards.js";
import { syncInstitutionalSymbols, refreshInstitutionalEvidence, institutionalSnapshot, institutionalHealth } from "./institutionalMarketFeed.js";
import { FLEX_REVISION, evaluateFlex15m, flexTiming } from "./flexInstitutional15m.js";
const ADAPTIVE_STRATEGY_ID = FLEX_REVISION;
// Passive, time-stamped evidence storage. Never feeds values back into decisions.
function archive(kind:ReplayKind,symbol:string,data:unknown,tradeId?:string,sourceMs?:number){
  persistReplayEvent(kind,{symbol,tradeId,sourceMs,revision:ADAPTIVE_STRATEGY_ID,data:{...(data as object),paperRunId:runId}});
}
function tradeArchiveId(t:{symbol:string;entryTime:string}){
  return t.symbol+"_"+new Date(t.entryTime).getTime();
}
import {
  isStrongFlowTradingHour,
  isValidStrongFlowTradingSchedule, STRONG_FLOW_DEFAULT_TRADING_SCHEDULE,
  type StrongFlowTradingSchedule,
  STRONG_FLOW_MAX_CONCURRENT,
  type StrongFlowBar
} from "./strongFlowStrategy.js";
import {
  extractEntryTiming, extractMarketRegimeContext, formatCandles,
  registerTradeForDirectionTracking, updateDirectionTracking,
  logTradeJourneySnapshot, logTradeDecision, logInstitutionalEvidence, setResearchRun
} from "./researchLogger.js";

const FAPI = "https://fapi.binance.com";
const MAX_DAILY_LOSS = 0.04;
const SCAN_INTERVAL_MS = 15_000;
const SCAN_CONCURRENCY = 8; // bound parallel klines requests / Railway resource use
const PROTECT_INTERVAL_MS = 2_000;
const MAX_DASHBOARD_TRADES = 150;
const ADAPTIVE_RISK_FRACTION = 0.0035; // 0.35% paper position risk; 4% daily cap
let institutionalMonitoringEnabled=false;
// User-configurable. Default ON on boot; no persistent Railway volume currently.
let liveWebsocketEnabled=true;
function desiredMarketSymbols(){
  const activeSymbols=activeTrades.map(t=>String(t.symbol));
  const candidates=liveWebsocketEnabled?[...pendingSignals.keys()]:[];
  return [...new Set([...activeSymbols,...candidates])].slice(0,40);
}
function syncMarketSubscriptions(){
  syncInstitutionalSymbols(desiredMarketSymbols(),liveWebsocketEnabled);
}
const reversalDiagnostics={observations:0,warnings:0,earlyExits:0,incomplete:0};
let active = true; // PAPER-only auto-start after deployment
let scanning = false;
let protecting = false;
let scanTimer: ReturnType<typeof setInterval> | null = null;
let protectTimer: ReturnType<typeof setInterval> | null = null;
let virtualBalance = 1000;
let initialVirtualBalance = 1000;
let runId:string|null=null,runStartedAt:string|null=null,runRevision:string=ADAPTIVE_STRATEGY_ID;
const buildId=process.env.RAILWAY_GIT_COMMIT_SHA||ADAPTIVE_STRATEGY_ID;
let runBuildId=buildId,archiveOnUpdate=true,rolloverPending=false,rolling=false;
let rolloverError:string|null=null;
let runTotals={count:0,wins:0,losses:0,breakeven:0,fees:0,pnl:0};
let maxOpenTrades = STRONG_FLOW_MAX_CONCURRENT;
let scanBatchSize = 0; // AUTO: visit every available futures symbol per full round
let feeRate = 0.0004;
let slippageRate = 0.0002;
let tradingSchedule: StrongFlowTradingSchedule = {...STRONG_FLOW_DEFAULT_TRADING_SCHEDULE,mode:"ALWAYS"};
let haltProfitEnabled = false;
let haltProfitTarget = 150;
let haltLossEnabled = false;
let haltLossTarget = 50;
let currentBatchIndex = 0;
let lastUniverseUpdate = 0;
let scanBackoffUntil = 0;
let scanPassStartedAt = 0;
let scanPassAttempted = new Set<string>();
let scanPassSucceeded = new Set<string>();
let completedScanPasses = 0;
let lastCompletedScanPass: null | {time:string; durationMs:number; attempted:number; succeeded:number; failed:number; universeSize:number} = null;
let lastBatchAttempted = 0;
let lastBatchSucceeded = 0;
let dayKey = new Intl.DateTimeFormat("en-CA", {timeZone:"Africa/Tripoli"}).format(new Date());
let today = {count:0,wins:0,losses:0,pnl:0,sumR:0};
let watchlist: string[] = ["BTCUSDT","ETHUSDT","SOLUSDT","AVAXUSDT","LINKUSDT","SUIUSDT"];
let hotWatchlist: string[] = [];
const waveRadar=new WaveRadar();
const activeTrades: any[] = [];
const closedTrades: any[] = [];
const logs: any[] = [];
const audits: any[] = [];
const lastSignalTime = new Map<string,number>();
const pendingSignals = new Map<string,BidirectionalSignal>();
const evaluated15m=new Map<string,number>();
const cooldownUntil = new Map<string,number>();
const diagnostics = {opened:0,quoteErrors:0,scanErrors:0,depthErrors:0,openInterestErrors:0,
  rateLimitEvents:0,protectionCycles:0,lastProtectionAt:0,lastReason:"",
  reasons:{} as Record<string,number>,quoteErrorReasons:{} as Record<string,number>,
  candidatesStaged:0,candidatesConfirmed:0};

export function addLog(message: string, type: "info"|"warn"|"success"|"error"="info") {
  logs.unshift({time:new Date().toISOString(),msg:message,type});
  if (logs.length>200) logs.length=200;
  console.log("[STRONG_FLOW] "+message);
}
function audit(symbol:string,side:string,reason:string,allowed:boolean) {
  diagnostics.lastReason=reason;
  diagnostics.reasons[reason]=(diagnostics.reasons[reason]||0)+1;
  audits.unshift({time:new Date().toISOString(),revision:ADAPTIVE_STRATEGY_ID,symbol,side,reason,allowed});
  if(audits.length>200) audits.length=200;
}
export function getCandidateAudit(){return audits;}
export function getLogs(){return logs;}
export function getTrades(){return activeTrades;}
export function getClosedTrades(){return closedTrades;}
export function isActive(){return active;}
export function setActive(value:boolean){active=Boolean(value);addLog("BOT ACTIVE: "+active);persistEngineSnapshot();}
/** Prevent correlated exposure through the same asset's USDT/USDC contracts. */
function underlying(symbol:string){return symbol.replace(/(?:USDT|USDC)$/,"");}
function hasUnderlyingOpen(symbol:string){
  return activeTrades.some(t=>underlying(String(t.symbol))===underlying(symbol));
}
export function isSymbolInCooldown(symbol:string) {
  const key=underlying(symbol),now=Date.now();
  let blocked=false;
  for(const [contract,until] of cooldownUntil){
    if(now>=until)cooldownUntil.delete(contract);
    else if(underlying(contract)===key)blocked=true;
  }
  return blocked;
}
export function setSymbolCooldown(symbol:string,isWin:boolean,durationMs?:number) {
  cooldownUntil.set(symbol,Date.now()+(durationMs??(isWin?300_000:600_000)));
}
export function clearSymbolCooldowns(){cooldownUntil.clear();}
export function resetDailyStatsIfNeeded(){
  const d=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Tripoli"}).format(new Date());
  if(d!==dayKey){dayKey=d;today={count:0,wins:0,losses:0,pnl:0,sumR:0};}
}
function floatingPnl(){return activeTrades.reduce((n,t)=>n+(Number(t.pnl)||0),0);}
function netPnl(){return virtualBalance-initialVirtualBalance+floatingPnl();}
function riskedDollars(){
  return activeTrades.reduce((sum,t)=>{
    const stopExposure=Math.max(0,(t.direction==="LONG"?t.entry-t.sl:t.sl-t.entry)*t.pos);
    return sum+stopExposure+t.entry*t.pos*2*(feeRate+slippageRate);
  },0);
}
/** New V4 daily risk is isolated; legacy cash losses and open exposure remain real. */
function dailyRiskRemaining(){
  return Math.max(0,initialVirtualBalance*MAX_DAILY_LOSS+Math.min(0,today.pnl)-riskedDollars());
}
function entryReadiness(){
  const reasons:string[]=[];
  if(!active)reasons.push("BOT_PAUSED");
  if(rolloverPending||rolling)reasons.push("PAPER_ARCHIVE_PENDING");
  if(!isStrongFlowTradingHour(new Date(),tradingSchedule))reasons.push("OUTSIDE_TRADING_HOURS");
  if(!Number.isFinite(virtualBalance)||virtualBalance<=0)reasons.push("INVALID_ACCOUNT_BALANCE");
  if(activeTrades.length>=Math.min(maxOpenTrades,STRONG_FLOW_MAX_CONCURRENT))reasons.push("MAX_CONCURRENT_TRADES");
  if(today.pnl+floatingPnl()<=-initialVirtualBalance*MAX_DAILY_LOSS)reasons.push("DAILY_LOSS_LIMIT");
  const cumulativeNetPnl=netPnl();
  if(haltProfitEnabled&&cumulativeNetPnl>=haltProfitTarget)reasons.push("ACCOUNT_PROFIT_HALT");
  if(haltLossEnabled&&cumulativeNetPnl<=-haltLossTarget)reasons.push("ACCOUNT_LOSS_HALT");
  const dailyRiskBudget=dailyRiskRemaining();
  const maxNewRiskDollars=Math.min(virtualBalance*ADAPTIVE_RISK_FRACTION,dailyRiskBudget);
  const minNewRiskDollars=initialVirtualBalance*0.003;
  if(maxNewRiskDollars<minNewRiskDollars)reasons.push("INSUFFICIENT_RISK_BUDGET");
  return {canOpenTrade:reasons.length===0,blockedReasons:reasons,
    strategyRevision:ADAPTIVE_STRATEGY_ID,
    dailyPnl:today.pnl,dailyLossCapDollars:initialVirtualBalance*MAX_DAILY_LOSS,
    dailyRiskBudget,maxNewRiskDollars,minNewRiskDollars,
    accountNetPnl:cumulativeNetPnl,activeExposureDollars:riskedDollars()};
}
function entryBlocked(){return !entryReadiness().canOpenTrade;}
/** Storage-only snapshot. This does not inspect or alter trading decisions. */
export function engineStateSnapshot(){
  return {schemaVersion:1,revision:ADAPTIVE_STRATEGY_ID,savedAt:new Date().toISOString(),
    active,virtualBalance,initialVirtualBalance,balance:virtualBalance,
    runId,runStartedAt,runRevision,runBuildId,archiveOnUpdate,rolloverPending,runTotals:{...runTotals},
    maxOpenTrades,scanBatchSize,feeRate,slippageRate,liveWebsocketEnabled,
    tradingSchedule:{...tradingSchedule},haltProfitEnabled,haltProfitTarget,
    haltLossEnabled,haltLossTarget,dayKey,today:{...today},
    todayRiskStrategyRevision:ADAPTIVE_STRATEGY_ID,
    activeTrades,closedTrades,logs:logs.slice(0,200),audits:audits.slice(0,200),
    lastSignalTime:[...lastSignalTime],pendingSignals:[...pendingSignals],
    cooldownUntil:[...cooldownUntil],diagnostics:{...diagnostics},
    reversalDiagnostics:{...reversalDiagnostics}};
}
export function persistEngineSnapshot(){if(!rolling)persistSnapshot(engineStateSnapshot());}
export function restoreEngineState(s:any){
  if(!s || s.schemaVersion!==1)throw Error("Unsupported durable PAPER snapshot");
  if(!(Number.isFinite(s.virtualBalance)&&s.virtualBalance>=0&&
       Number.isFinite(s.initialVirtualBalance)&&s.initialVirtualBalance>0)||
     !Array.isArray(s.activeTrades)||!Array.isArray(s.closedTrades))
    throw Error("Invalid PAPER balance or trade collection in durable snapshot");
  virtualBalance=s.virtualBalance;initialVirtualBalance=s.initialVirtualBalance;
  runId=typeof s.runId==="string"?s.runId:null;runStartedAt=s.runStartedAt||null;
  runRevision=s.runRevision||s.revision||ADAPTIVE_STRATEGY_ID;runBuildId=s.runBuildId||runRevision;
  archiveOnUpdate=s.archiveOnUpdate!==false;rolloverPending=s.rolloverPending===true;
  runTotals=s.runTotals?{...s.runTotals}:{count:s.closedTrades.length,wins:s.closedTrades.filter((t:any)=>t.finalPnl>0).length,losses:s.closedTrades.filter((t:any)=>t.finalPnl<0).length,breakeven:s.closedTrades.filter((t:any)=>t.finalPnl===0).length,fees:s.closedTrades.reduce((n:number,t:any)=>n+(Number(t.totalFees)||0),0),pnl:s.virtualBalance-s.initialVirtualBalance};
  setResearchRun(runId);
  active=typeof s.active==="boolean"?s.active:true;
  activeTrades.splice(0,activeTrades.length,...s.activeTrades);
  closedTrades.splice(0,closedTrades.length,...s.closedTrades.slice(0,MAX_DASHBOARD_TRADES));
  if(Array.isArray(s.logs))logs.splice(0,logs.length,...s.logs.slice(0,200));
  if(Array.isArray(s.audits))audits.splice(0,audits.length,...s.audits.slice(0,200));
  lastSignalTime.clear();
  for(const pair of s.lastSignalTime||[]){if(Array.isArray(pair)&&pair.length===2&&Number.isFinite(pair[1]))lastSignalTime.set(pair[0],pair[1]);}
  pendingSignals.clear();
  for(const pair of (s.revision===FLEX_REVISION?s.pendingSignals:[])||[]){if(Array.isArray(pair)&&pair.length===2&&pair[1]?.signalCloseTime>0)
    pendingSignals.set(pair[0],pair[1]);}
  cooldownUntil.clear();
  for(const pair of s.cooldownUntil||[]){if(Array.isArray(pair)&&pair.length===2&&Number.isFinite(pair[1]))cooldownUntil.set(pair[0],pair[1]);}
  if(s.diagnostics&&typeof s.diagnostics==="object")Object.assign(diagnostics,s.diagnostics);
  if(s.reversalDiagnostics&&typeof s.reversalDiagnostics==="object")Object.assign(reversalDiagnostics,s.reversalDiagnostics);
  if(typeof s.liveWebsocketEnabled==="boolean")liveWebsocketEnabled=s.liveWebsocketEnabled;
  if(Number.isFinite(s.maxOpenTrades))maxOpenTrades=s.maxOpenTrades;
  if(Number.isFinite(s.scanBatchSize))scanBatchSize=s.scanBatchSize;
  if(Number.isFinite(s.feeRate))feeRate=s.feeRate;
  if(Number.isFinite(s.slippageRate))slippageRate=s.slippageRate;
  if(s.tradingSchedule&&isValidStrongFlowTradingSchedule(s.tradingSchedule))tradingSchedule={...s.tradingSchedule};
  if(typeof s.haltProfitEnabled==="boolean")haltProfitEnabled=s.haltProfitEnabled;
  if(Number.isFinite(s.haltProfitTarget))haltProfitTarget=s.haltProfitTarget;
  if(typeof s.haltLossEnabled==="boolean")haltLossEnabled=s.haltLossEnabled;
  if(Number.isFinite(s.haltLossTarget))haltLossTarget=s.haltLossTarget;
  if(typeof s.dayKey==="string")dayKey=s.dayKey;
  if(s.today&&typeof s.today==="object"&&Number.isFinite(s.today.pnl))today={...s.today};
  resetDailyStatsIfNeeded();
  // Keep the existing account daily loss ledger across strategy revisions.
  for(const t of activeTrades)registerTradeForDirectionTracking(t);
  addLog("Restored "+activeTrades.length+" open, "+closedTrades.length+
    " recent closed PAPER positions and balance $"+virtualBalance.toFixed(2)+" from durable volume","success");
}
export function getStats(){
  return {persistence:persistenceStatus(),
    paperRun:{id:runId,startedAt:runStartedAt,revision:runRevision,buildId:runBuildId,archiveOnUpdate,rolloverPending,rolling,error:rolloverError,totals:{...runTotals}},
    strategyRevision:ADAPTIVE_STRATEGY_ID,
    strategyMode:"FLEX_INSTITUTIONAL_15M",
    executionMode:"PAPER",
    legacyEnginesEnabled:false,
    totalEvaluations:audits.length,
    totalLongScanned:audits.filter(a=>a.side==="LONG").length,
    totalShortScanned:audits.filter(a=>a.side==="SHORT").length,
    acceptedLongs:audits.filter(a=>a.allowed&&a.side==="LONG").length,
    acceptedShorts:audits.filter(a=>a.allowed&&a.side==="SHORT").length,
    entryReadiness:entryReadiness(),
    strategyPerformance:(()=>{
      const v4=closedTrades.filter(t=>t.strategyRevision===ADAPTIVE_STRATEGY_ID);
      const legacy=closedTrades.filter(t=>t.strategyRevision!==ADAPTIVE_STRATEGY_ID);
      return {v4ClosedCount:v4.length,v4ClosedPnl:v4.reduce((s,t)=>s+(Number(t.finalPnl)||0),0),
        legacyClosedCount:legacy.length,legacyClosedPnl:legacy.reduce((s,t)=>s+(Number(t.finalPnl)||0),0),
        note:"Retained trade ledger only; cash balance includes all trade history."};
    })(),
    rules:{signalFamilies:["EXPLOSION_UP","COLLAPSE_DOWN","UPTREND_CORRECTION_SHORT","DOWNTREND_CORRECTION_LONG"],
      uniqueUnderlyingExposure:true,existingRiskLimitUnchanged:true},
    diagnostics,pendingCandidates:pendingSignals.size,
    institutionalMonitor:{...institutionalHealth(),...reversalDiagnostics,enabled:liveWebsocketEnabled},
    balance:virtualBalance,initialBalance:initialVirtualBalance,
    maxOpenTrades,feeRate,slippageRate,scanBatchSize,liveWebsocketEnabled,
    haltProfitEnabled,haltProfitTarget,haltLossEnabled,haltLossTarget,
    watchlistLength:watchlist.length,hotWatchlistLength:hotWatchlist.length,
    hotWatchlist:hotWatchlist.slice(0,8),
    currentBatchProgress:String(currentBatchIndex)+" / "+String(watchlist.length),
    scanCoverage:{
      scope:"ALL_TRADING_USDM_PERPETUALS_USDT_USDC",
      enabled:active&&isStrongFlowTradingHour(new Date(),tradingSchedule),
      eligibleSymbols:watchlist.length,
      universeLastUpdatedAt:lastUniverseUpdate?new Date(lastUniverseUpdate).toISOString():null,
      mode:scanBatchSize===0?"AUTO_ALL":"MANUAL_ALL",
      effectiveBatchSize:nextCoverageBatch(watchlist,currentBatchIndex,scanBatchSize).effectiveBatchSize,
      currentPassAttempted:scanPassAttempted.size,
      currentPassSucceeded:scanPassSucceeded.size,
      completedPasses:completedScanPasses,
      lastCompletedPass:lastCompletedScanPass,
      lastBatchAttempted,lastBatchSucceeded,
      rateLimitBackoffUntil:Date.now()<scanBackoffUntil?new Date(scanBackoffUntil).toISOString():null
    },
    freeTradesCount:0,riskedTradesCount:activeTrades.length,
    isSleeping:!isStrongFlowTradingHour(new Date(), tradingSchedule),
    executionRiskLocked:entryBlocked(),
    today:{...today,floatingPnl:floatingPnl(),netPnl:today.pnl+floatingPnl()},
    strategySettings:{tradingSchedule:{...tradingSchedule},liveWebsocketEnabled,
      timeframe:"15m closed + 5m execution timing",
      stopAtr:"breakout 1.7 / correction 1.35",targetR:"breakout 3 / correction 1.6",
      riskFraction:ADAPTIVE_RISK_FRACTION,maxHoldMinutes:180,
      maxConcurrent:STRONG_FLOW_MAX_CONCURRENT,dailyLossLimit:MAX_DAILY_LOSS}
  };
}
export function getConfig(){return {virtualBalance,initialVirtualBalance,maxOpenTradesConfig:maxOpenTrades,
  haltProfitEnabled,haltProfitTarget,haltLossEnabled,haltLossTarget,scanBatchSize,feeRate,slippageRate,
  liveWebsocketEnabled,tradingSchedule:{...tradingSchedule}};}
export function setConfig(config:any){
  if(config&&typeof config==="object"){
    if(Number.isFinite(config.virtualBalance)&&config.virtualBalance>0)virtualBalance=config.virtualBalance;
    if(Number.isFinite(config.initialVirtualBalance)&&config.initialVirtualBalance>0)initialVirtualBalance=config.initialVirtualBalance;
    updateConfig(initialVirtualBalance,maxOpenTrades,config);
  }
}
export function updateConfig(balance:number,maxTrades:number,opts:any={}){
  const newBalance=Number(balance),newMax=Number(maxTrades);
  // A settings save must never silently reset the running account or rewrite its baseline.
  if(rolling)return;
  if(typeof opts.archiveOnUpdate==="boolean")archiveOnUpdate=opts.archiveOnUpdate;
  if(activeTrades.length===0&&closedTrades.length===0&&runTotals.count===0&&Number.isFinite(newBalance)&&newBalance>0){
    initialVirtualBalance=newBalance;virtualBalance=newBalance;
  }
  if(Number.isFinite(newMax)&&newMax>=1)maxOpenTrades=Math.max(1,Math.min(STRONG_FLOW_MAX_CONCURRENT,Math.floor(newMax)));
  if(typeof opts.liveWebsocketEnabled==="boolean"&&liveWebsocketEnabled!==opts.liveWebsocketEnabled){
    liveWebsocketEnabled=opts.liveWebsocketEnabled;
    syncMarketSubscriptions();
    addLog("Live market WebSocket decisions: "+(liveWebsocketEnabled?"ENABLED":"DISABLED"),"info");
  }
  if(typeof opts.haltProfitEnabled==="boolean")haltProfitEnabled=opts.haltProfitEnabled;
  if(Number.isFinite(Number(opts.haltProfitTarget))&&Number(opts.haltProfitTarget)>0)haltProfitTarget=Number(opts.haltProfitTarget);
  if(typeof opts.haltLossEnabled==="boolean")haltLossEnabled=opts.haltLossEnabled;
  if(Number.isFinite(Number(opts.haltLossTarget))&&Number(opts.haltLossTarget)>0)haltLossTarget=Number(opts.haltLossTarget);
  if(opts.scanBatchSize !== undefined && Number.isFinite(Number(opts.scanBatchSize)) && Number(opts.scanBatchSize)>=0)
    scanBatchSize=Number(opts.scanBatchSize)<5?0:Math.max(5,Math.min(200,Math.floor(Number(opts.scanBatchSize))));
  if(Number.isFinite(Number(opts.feeRate))&&Number(opts.feeRate)>=0&&Number(opts.feeRate)<0.01)feeRate=Number(opts.feeRate);
  if(Number.isFinite(Number(opts.slippageRate))&&Number(opts.slippageRate)>=0&&Number(opts.slippageRate)<0.01)slippageRate=Number(opts.slippageRate);
  if(opts.tradingSchedule !== undefined && isValidStrongFlowTradingSchedule(opts.tradingSchedule)) {
    tradingSchedule = {...opts.tradingSchedule};
    addLog("Entry hours updated: "+(tradingSchedule.mode==="ALWAYS"?"24/7":tradingSchedule.startLocal+"–"+tradingSchedule.endLocal+" Africa/Tripoli"),"info");
  }
  persistEngineSnapshot();
}
/** Legacy reset entry point never discards a ledger. */
export function resetAccountState(){
  if(activeTrades.length||!persistenceStatus().enabled)return false;
  rolloverPending=true;persistEngineSnapshot();return true;
}
export function paperRolloverBusy(){return rolling;}
export async function requestNewPaperRun(expectedRunId?:string|null){
  if(expectedRunId!==undefined&&expectedRunId!==runId)throw Error("Paper run already changed; refresh before retry");
  if(rolling)return {pending:true,runId};
  if(!persistenceStatus().enabled)throw Error("Durable storage required for archive/reset");
  rolloverPending=true;persistEngineSnapshot();
  await completePaperRollover();
  return {pending:rolloverPending,runId};
}
export async function initializePaperRun(saved:any){
  if(!persistenceStatus().enabled)return;
  if(!saved){
    runId=crypto.randomUUID();runStartedAt=new Date().toISOString();runRevision=ADAPTIVE_STRATEGY_ID;runBuildId=buildId;
    setResearchRun(runId);persistEngineSnapshot();return;
  }
  // Explicit one-time migration of the pre-run PAPER ledger; future builds
  // rotate only when selected. Restarting the same build never rotates.
  if(!runId||(archiveOnUpdate&&runBuildId!==buildId))rolloverPending=true;
  if(!archiveOnUpdate&&!rolloverPending){runBuildId=buildId;persistEngineSnapshot();}
  if(rolloverPending){persistEngineSnapshot();await completePaperRollover();}
}
async function completePaperRollover(){
  if(!rolloverPending||rolling||scanning||protecting||activeTrades.length)return;
  rolling=true;rolloverError=null;
  try{
    const old=structuredClone(engineStateSnapshot()),id=crypto.randomUUID(),at=new Date().toISOString();
    const fresh={...old,runId:id,runStartedAt:at,runRevision:ADAPTIVE_STRATEGY_ID,runBuildId:buildId,rolloverPending:false,
      active:true,virtualBalance:initialVirtualBalance,balance:initialVirtualBalance,activeTrades:[],closedTrades:[],logs:[],audits:[],
      today:{count:0,wins:0,losses:0,pnl:0,sumR:0},runTotals:{count:0,wins:0,losses:0,breakeven:0,fees:0,pnl:0},
      lastSignalTime:[],pendingSignals:[],cooldownUntil:[],
      diagnostics:{opened:0,quoteErrors:0,scanErrors:0,depthErrors:0,openInterestErrors:0,rateLimitEvents:0,protectionCycles:0,lastProtectionAt:0,lastReason:"",reasons:{},quoteErrorReasons:{},candidatesStaged:0,candidatesConfirmed:0},
      reversalDiagnostics:{observations:0,warnings:0,earlyExits:0,incomplete:0}};
    await rotatePaperRun(old,fresh);
    restoreEngineState(fresh);evaluated15m.clear();
    addLog("Archived previous PAPER run; started "+id+" at $"+initialVirtualBalance,"success");
    if(institutionalMonitoringEnabled)syncMarketSubscriptions();
  }catch(e:any){rolloverError=String(e?.message||e);addLog("Archive/reset failed; old account preserved: "+rolloverError,"error");}
  finally{rolling=false;persistEngineSnapshot();}
}
async function updateUniverse(){
  if(lastUniverseUpdate && Date.now()-lastUniverseUpdate<300_000)return;
  try {
    // ExchangeInfo is authoritative; do not depend on ticker availability for full coverage.
    const info=await axios.get(FAPI+"/fapi/v1/exchangeInfo",{timeout:8000});
    if(!Array.isArray(info.data?.symbols))return;
    const eligible=listAllUsdmPerpetuals(info.data.symbols);
    if(!eligible.length)return;
    const universeChanged=watchlist.length!==eligible.length || watchlist.some((s,i)=>s!==eligible[i]);
    watchlist=eligible;
    if(universeChanged) {
      const allowed=new Set(eligible);for(const s of evaluated15m.keys())if(!allowed.has(s))evaluated15m.delete(s);
      // A genuinely changed universe starts a new measurable full round.
      // Identical refreshes leave the cursor untouched (no repeated head scans).
      currentBatchIndex=0;
      scanPassStartedAt=0;scanPassAttempted.clear();scanPassSucceeded.clear();
      addLog("All Binance USD-M USDT/USDC perpetual contracts eligible: "+watchlist.length,"success");
    }
    lastUniverseUpdate=Date.now();

  }catch(e:any) {
    diagnostics.scanErrors++;
    addLog("Universe refresh unavailable; retaining previous symbols: "+(e?.message||e),"warn");
  }
}
async function refreshWaveRadar(){
  const eligible=new Set(watchlist);
  try {
    const ticker=await axios.get(FAPI+"/fapi/v2/ticker/price",{timeout:3500});
    waveRadar.ingestPrices(ticker.data,eligible,Date.now());
  }catch(e:any){
    const status=Number(e?.response?.status);
    if(status===429||status===418){
      const retry=Number(e?.response?.headers?.["retry-after"]);
      scanBackoffUntil=Math.max(scanBackoffUntil,Date.now()+(Number.isFinite(retry)&&retry>0?Math.min(300,retry):60)*1000);
      diagnostics.rateLimitEvents++;
    }
  }
  hotWatchlist=waveRadar.select(eligible,Date.now());
}
async function fetchClosedOneMinuteBars(symbol:string,interval:"1m"|"15m"="1m"):Promise<StrongFlowBar[]>{
  let r;
  try {
    r=await axios.get(FAPI+"/fapi/v1/klines",{params:{symbol,interval,limit:interval==="15m"?25:85},timeout:5000});
  } catch (e:any) {
    const status=Number(e?.response?.status);
    if(status===429 || status===418) {
      const retrySeconds=Number(e?.response?.headers?.["retry-after"]);
      const pauseMs=(Number.isFinite(retrySeconds) && retrySeconds>0
        ? Math.min(300,retrySeconds) : 60)*1000;
      if(Date.now()>=scanBackoffUntil) {
        diagnostics.rateLimitEvents++;
        addLog("Binance rate limit; full-universe scanner pausing then retrying", "warn");
      }
      scanBackoffUntil=Math.max(scanBackoffUntil,Date.now()+pauseMs);
    }
    throw e;
  }
  if(!Array.isArray(r.data))return [];
  const bars:StrongFlowBar[]=r.data.map((k:any)=>({
    openTime:Number(k[0]),closeTime:Number(k[6]),open:Number(k[1]),high:Number(k[2]),
    low:Number(k[3]),close:Number(k[4]),quoteVolume:Number(k[7]),takerBuyQuote:Number(k[10])
  }));
  // Binance includes a still-forming final candle: using it suppresses valid closed-bar signals.
  return closedCandles(bars);
}
/** Two independent real Binance observations; absence of OI/history rejects new entries. */
async function confirmMarketEvidence(symbol:string,side:"LONG"|"SHORT"):
  Promise<{depth:EntryDepth;oi:EntryOi}|null>{
  const [depthResult,oiResult]=await Promise.allSettled([
    axios.get(FAPI+"/fapi/v1/depth",{params:{symbol,limit:20},timeout:3500}),
    axios.get(FAPI+"/futures/data/openInterestHist",{params:{symbol,period:"5m",limit:4},timeout:3500})
  ]);
  // Preserve the exact raw REST payloads (or explicit failure) before evaluating
  // the existing gates. This archive cannot change either gate's result.
  archive("entry_book_oi",symbol,{side,observedAt:Date.now(),
    rawDepth:depthResult.status==="fulfilled"?depthResult.value.data:null,
    rawOiHistory:oiResult.status==="fulfilled"?oiResult.value.data:null,
    errors:{
      depth:depthResult.status==="rejected"?String(depthResult.reason):null,
      oi:oiResult.status==="rejected"?String(oiResult.reason):null
    }});
  if(depthResult.status!=="fulfilled"){
    diagnostics.depthErrors++;audit(symbol,side,"DEPTH_UNAVAILABLE",false);return null;
  }
  const d=depthResult.value.data;
  const book=assessOrderBook(side,d?.bids,d?.asks);
  const depth:EntryDepth={...book,bestBid:Number(d?.bids?.[0]?.[0]),bestAsk:Number(d?.asks?.[0]?.[0]),
    time:Number(d?.T||d?.E)};
  if(!depth.allowed){audit(symbol,side,depth.reason,false);return null;}
  if(oiResult.status!=="fulfilled"){
    diagnostics.openInterestErrors++;audit(symbol,side,"OI_HISTORY_FETCH_FAILED",false);return null;
  }
  const oi=parseOpenInterestHistory(oiResult.value.data);
  if(!oi){diagnostics.openInterestErrors++;audit(symbol,side,"OI_HISTORY_INCOMPLETE",false);return null;}
  return {depth,oi};
}

async function executeSignal(symbol:string,signal:BidirectionalSignal,bars:StrongFlowBar[]){
  if(entryBlocked()||hasUnderlyingOpen(symbol)||isSymbolInCooldown(symbol)
    ||lastSignalTime.get(symbol)===signal.signalCloseTime)return;
  if(Date.now()-signal.signalCloseTime>300_000)return;
  const mtf=flexTiming(signal,bars);
  if(!mtf.allowed||!mtf.details){audit(symbol,signal.side,mtf.reason,false);return;}
  signal={...signal,flow5:mtf.details.flow5,evidence:{...signal.evidence,flow3:mtf.details.flow3,flow5:mtf.details.flow5}};
  const evidence=await confirmMarketEvidence(symbol,signal.side);
  if(!evidence||entryBlocked()||hasUnderlyingOpen(symbol)||
     Date.now()-signal.signalCloseTime>300_000)return;
  // Fetch LAST so the executable quote is younger than the depth and OI reads.
  let quote;
  try{quote=await fetchExecutionQuote(symbol);}
  catch(e:any){
    diagnostics.quoteErrors++;
    const reason=String(e?.message||"QUOTE_UNAVAILABLE").slice(0,160);
    diagnostics.quoteErrorReasons[reason]=(diagnostics.quoteErrorReasons[reason]||0)+1;
    audit(symbol,signal.side,"QUOTE_UNAVAILABLE",false);return;
  }
  const gate=verifyExecutableEntry(signal,bars,quote,evidence.depth,evidence.oi,feeRate,slippageRate,Date.now(),"FLEX15");
  if(!gate.allowed){
    archive("entry_decision_inputs",symbol,{asOf:Date.now(),signal,bars,quote,
      depth:evidence.depth,oi:evidence.oi,gate,liveWebsocketEnabled,
      feeRate,slippageRate,decision:"REJECTED"});
    audit(symbol,signal.side,gate.reason,false);return;
  }
  const liveAgg=liveWebsocketEnabled?institutionalSnapshot(symbol).agg:null;
  // Non-blocking prospective comparison: record the actual executed tape for
  // EVERY setup. Missing or stale evidence is not interpreted as neutral.
  const tapeNow=Date.now();
  const tapeValid=liveWebsocketEnabled&&!!liveAgg&&liveAgg.complete&&
    Number.isFinite(liveAgg.delta)&&Math.abs(liveAgg.delta)<=1&&
    Number.isFinite(liveAgg.asOf)&&liveAgg.asOf<=tapeNow+1000&&
    tapeNow-liveAgg.asOf<=12000&&Number.isFinite(liveAgg.notional)&&
    liveAgg.notional>=350&&Number.isFinite(liveAgg.count)&&liveAgg.count>=5;
  const alignedTape=tapeValid&&liveAgg?(signal.side==="LONG"?1:-1)*liveAgg.delta:null;
  const entryTapeShadow={
    revision:"TAPE_SHADOW_V1",state:!liveWebsocketEnabled?"DISABLED":
      alignedTape===null?"UNAVAILABLE":alignedTape<-.12?"OPPOSED":
      alignedTape>=.10?"CONFIRMED":"WEAK_OR_NEUTRAL",
    alignedDelta:alignedTape,observedDelta:tapeValid&&liveAgg?liveAgg.delta:null,
    observedAt:tapeNow,sourceAt:liveAgg?.asOf??null,
    notional:liveAgg?.notional??null,count:liveAgg?.count??null,
    wouldConfirm:alignedTape===null?null:alignedTape>=.10
  };
  const liveEntry={allowed:alignedTape===null||alignedTape>=-.25,reason:alignedTape!==null&&alignedTape<-.25?"FLEX_LIVE_TAPE_STRONG_CONFLICT":"FLEX_LIVE_TAPE_NO_STRONG_CONFLICT",delta:alignedTape};
  archive("entry_decision_inputs",symbol,{asOf:Date.now(),signal,bars,quote,
    depth:evidence.depth,oi:evidence.oi,gate,liveAgg,liveEntry,entryTapeShadow,liveWebsocketEnabled,
    feeRate,slippageRate,decision:liveEntry.allowed?"LIVE_GATE_PASS":"LIVE_GATE_REJECTED"});
  if(!liveEntry.allowed){audit(symbol,signal.side,liveEntry.reason,false);return;}
  if(entryBlocked() || hasUnderlyingOpen(symbol) || isSymbolInCooldown(symbol))return;
  const sign=signal.side==="LONG"?1:-1;
  const entry=(signal.side==="LONG"?quote.ask:quote.bid)*(1+sign*slippageRate);
  const dist=signal.atr14*signal.stopAtr;
  if(!(entry>0&&dist>0&&dist/entry>0&&dist/entry<=0.04)){
    audit(symbol,signal.side,"STOP_DISTANCE_OUT_OF_RANGE",false);return;
  }
  const stop=entry-sign*dist,target=entry+sign*signal.targetR*dist;
  if(!(stop>0&&target>0))return;
  const riskBudget=dailyRiskRemaining();
  const dollars=Math.min(virtualBalance*ADAPTIVE_RISK_FRACTION,riskBudget);
  if(dollars<initialVirtualBalance*0.003){audit(symbol,signal.side,"INSUFFICIENT_RISK_BUDGET",false);return;}
  const notionalCap=Math.min(virtualBalance*10,virtualBalance*0.15*10);
  const pos=Math.min(dollars/(dist+entry*2*(feeRate+slippageRate)),notionalCap/entry);
  if(!(pos>0&&Number.isFinite(pos))){audit(symbol,signal.side,"RISK_BUDGET",false);return;}
  if(pos*(dist+entry*2*(feeRate+slippageRate))<initialVirtualBalance*0.003){
    audit(symbol,signal.side,"POSITION_TOO_SMALL",false);return;
  }
  const t:any={
    symbol,paperRunId:runId,direction:signal.side,entry,sl:stop,initialSlDist:dist,
    tp1:target,tp2:target,tp3:target,pos,initialPos:pos,
    part_a:1,part_b:0,part_c:0,a_closed:false,b_closed:false,c_closed:false,
    be_done:false,micro_banked:false,peak_r:0,pnl:0,realizedPnl:0,totalFees:0,
    entryTime:new Date().toISOString(),entrySignalTime:signal.signalCloseTime,
    entryTiming:extractEntryTiming(),marketRegimeContext:{...extractMarketRegimeContext({rvol:signal.rvol,atr14:signal.atr14,atr20:signal.atr14}),strategy_regime:signal.regime},
    strategyRevision:ADAPTIVE_STRATEGY_ID,executionMode:"PAPER",timeframe:"15m",
    phase:signal.phase||"LEGACY_SIGNAL",signalEvidence:signal.evidence||null,
    setupType:signal.setupType,setupLabel:signal.regime+" / "+signal.setupType,grade:"EVIDENCE_CHECKED",
    marketRegime:signal.regime,maxHoldMs:signal.maxHoldMs,targetR:signal.targetR,
    atr:signal.atr14,highestPrice:entry,lowestPrice:entry,currentPrice:entry,
    candlesBeforeEntry:formatCandles(bars,40),
    priceData:{rvol:signal.rvol,atr14:signal.atr14,delta:signal.delta,flow5:signal.flow5,flow15:signal.flow15,
      trend15:signal.trend15,trend60:signal.trend60,
      bookImbalance:evidence.depth.imbalance,bookSpread:evidence.depth.spread,
      depthNotional:evidence.depth.depthNotional,openInterestDelta:evidence.oi.delta,
      entryEvidence:gate.details,followThroughExtensionAtr:gate.details?.followThroughExtensionAtr,
       entryTapeShadow,
      liveWebsocketEntry:{
        enabled:liveWebsocketEnabled,reason:liveEntry.reason,delta:liveEntry.delta
      }},
    whaleData:{scenario:"BINANCE_FLEX_15M_5M_TAKER_FLOW_BOOK_REAL_OI"},
    reasoning:{flow:{state:entryTapeShadow.state==="OPPOSED"?"MIXED":"VERIFIED_5M_15M_TAKER_FLOW",
       persistenceState:entryTapeShadow.state==="OPPOSED"?"CONFLICTED":entryTapeShadow.state==="CONFIRMED"?"STRONG":entryTapeShadow.state==="WEAK_OR_NEUTRAL"?"WEAK":"UNKNOWN"},
       timingGate:{state:"FLEX_5M_TIMING"}}
  };
  activeTrades.push(t);lastSignalTime.set(symbol,signal.signalCloseTime);
  if(institutionalMonitoringEnabled)syncMarketSubscriptions();
  diagnostics.opened++;registerTradeForDirectionTracking(t);
  audit(symbol,signal.side,signal.setupType,true);
  addLog("PAPER "+signal.side+" "+symbol+" "+signal.setupType+" opened at "+entry+"; target "+signal.targetR+"R","success");
  archive("paper_trade_open",symbol,{trade:{...t},feeRate,slippageRate,
    accountBalance:virtualBalance,initialAccountBalance:initialVirtualBalance,
    sourceSignalTime:signal.signalCloseTime},tradeArchiveId(t),Date.parse(t.entryTime));
  persistEngineSnapshot();
}
/** A resolved candidate must not swallow a DIFFERENT fresh closed-minute
 * signal. Every new candidate still waits for independent next-minute evidence.
 */
export function mayStageFollowupSignal(previousCloseMs:number|null,nextCloseMs:number|null,stillPending:boolean){
  return nextCloseMs!==null && Number.isFinite(nextCloseMs) && !stillPending &&
    (previousCloseMs===null || nextCloseMs>previousCloseMs);
}
async function scanEntries(){
  if(!active || rolloverPending || rolling || !isStrongFlowTradingHour(new Date(),tradingSchedule) || scanning || Date.now()<scanBackoffUntil)return;
  for(const [symbol,signal] of pendingSignals) {
    if(Date.now()-signal.signalCloseTime>300_000)pendingSignals.delete(symbol);
  }
  scanning=true;
  try{
    resetDailyStatsIfNeeded();
    await updateUniverse();
    if(!active || !isStrongFlowTradingHour(new Date(),tradingSchedule) || Date.now()<scanBackoffUntil)return;
    await refreshWaveRadar();
    if(!active||!isStrongFlowTradingHour(new Date(),tradingSchedule)||Date.now()<scanBackoffUntil)return;
    const batch=nextCoverageBatch(watchlist,currentBatchIndex,scanBatchSize);
    if(batch.symbols.length===0)return;
    if(!scanPassStartedAt)scanPassStartedAt=Date.now();
    const regularSet=new Set(batch.symbols);
    // Hot symbols get extra attention, but never displace a symbol in the coverage round.
    const eligible=new Set(watchlist);
    const symbols=scheduleRadarBatch(batch.symbols,[...new Set([...pendingSignals.keys(),...hotWatchlist])].filter(s=>eligible.has(s)),[...pendingSignals].filter(([symbol])=>eligible.has(symbol)).map(([symbol,signal])=>({symbol,signalCloseTime:signal.signalCloseTime})),Date.now());
    let attempted=0,succeeded=0,complete=true;
    for(let i=0;i<symbols.length;i+=SCAN_CONCURRENCY) {
      if(!active || !isStrongFlowTradingHour(new Date(),tradingSchedule) || Date.now()<scanBackoffUntil) {
        complete=false;break;
      }
      const group=symbols.slice(i,i+SCAN_CONCURRENCY);
      const rows=await Promise.allSettled(group.map(async symbol=>{
        const bars=await fetchClosedOneMinuteBars(symbol);
        const now=Date.now(),quarter=Math.floor(now/900000)*900000-1;
        let signal:BidirectionalSignal|null=null;
        if(now-quarter<=300000&&evaluated15m.get(symbol)!==quarter&&!hasUnderlyingOpen(symbol)&&!isSymbolInCooldown(symbol)){
          const fifteen=await fetchClosedOneMinuteBars(symbol,"15m");
          if(fifteen.at(-1)?.closeTime===quarter&&fifteen.length>=21){
            evaluated15m.set(symbol,quarter);
            signal=evaluateFlex15m(fifteen,Date.now());
            if(signal)archive("signal_candidate",symbol,{signal,bars:fifteen,observedAt:Date.now(),stage:"FLEX_CLOSED_15M"},undefined,signal.signalCloseTime);
          }
        }
        return {symbol,bars,signal};
      }));
      for(let j=0;j<rows.length;j++){
        const symbol=group[j],result=rows[j];
        if(regularSet.has(symbol)) {
          scanPassAttempted.add(symbol);attempted++;
          if(result.status==="fulfilled"&&result.value.bars.length>=64){scanPassSucceeded.add(symbol);succeeded++;}
        }
        if(result.status==="fulfilled") {
          const bars=result.value.bars;
          const last=bars.at(-1),now=Date.now();
          waveRadar.ingestBars(symbol,bars,now);
          if(result.value.signal&&!hasUnderlyingOpen(symbol)&&!isSymbolInCooldown(symbol)){
            pendingSignals.set(symbol,result.value.signal);
            diagnostics.candidatesStaged++;
            audit(symbol,result.value.signal.side,"FLEX_CLOSED_15M",false);
          }
          const candidate=pendingSignals.get(symbol);
          if(candidate){
            if(now-candidate.signalCloseTime>300000){pendingSignals.delete(symbol);audit(symbol,candidate.side,"FLEX_SIGNAL_EXPIRED",false);}
            else if(!entryBlocked()){
              const timing=flexTiming(candidate,bars,now);
              if(timing.allowed){
                pendingSignals.delete(symbol);
                diagnostics.candidatesConfirmed++;
                await executeSignal(symbol,candidate,bars);
              }else if(timing.reason!=="FLEX_5M_MISSING"){
                pendingSignals.delete(symbol);audit(symbol,candidate.side,timing.reason,false);
              }
            }
          }
        } else if(result.status==="rejected") diagnostics.scanErrors++;
      }
    }
    lastBatchAttempted=attempted;lastBatchSucceeded=succeeded;
    if(complete){
      currentBatchIndex=batch.nextIndex;
      if(batch.completedPass){
        lastCompletedScanPass={
          time:new Date().toISOString(),
          durationMs:Date.now()-scanPassStartedAt,
          attempted:scanPassAttempted.size,
          succeeded:scanPassSucceeded.size,
          failed:scanPassAttempted.size-scanPassSucceeded.size,
          universeSize:watchlist.length
        };
        completedScanPasses++;
        scanPassStartedAt=0;scanPassAttempted.clear();scanPassSucceeded.clear();
      }
    }
  }catch(e:any){diagnostics.scanErrors++;addLog("Strong-flow scan error: "+(e?.message||e),"warn");}
  finally{
    // Newly staged symbols get a fresh trade stream before next-minute confirmation.
    if(institutionalMonitoringEnabled)syncMarketSubscriptions();
    scanning=false;
    persistEngineSnapshot();
  }
}
function closeFull(t:any,reason:string){
  if(!activeTrades.includes(t)||t.exitTime)return;
  const sign=t.direction==="LONG"?1:-1,price=t.currentPrice;
  if(!(Number.isFinite(price)&&price>0))return;
  const executionPrice=price*(1-sign*slippageRate);
  const gross=sign*(executionPrice-t.entry)*t.pos;
  const fees=(t.entry+executionPrice)*t.pos*feeRate;
  const pnl=gross-fees;
  t.realizedPnl=(t.realizedPnl||0)+pnl;
  t.totalFees=(t.totalFees||0)+fees;
  virtualBalance+=pnl;t.finalPnl=t.realizedPnl;t.pnl=t.finalPnl;
  t.exitTime=new Date().toISOString();t.exitReason=reason;t.pos=0;
  activeTrades.splice(activeTrades.indexOf(t),1);
  if(institutionalMonitoringEnabled)syncMarketSubscriptions();
  closedTrades.unshift(t);if(closedTrades.length>MAX_DASHBOARD_TRADES)closedTrades.length=MAX_DASHBOARD_TRADES;
  today.count++;today.pnl+=t.finalPnl;
  runTotals.count++;runTotals.pnl+=t.finalPnl;runTotals.fees+=Number(t.totalFees)||0;
  if(t.finalPnl>0)runTotals.wins++;else if(t.finalPnl<0)runTotals.losses++;else runTotals.breakeven++;
  if(t.finalPnl>0.15)today.wins++;
  if(t.finalPnl< -0.15)today.losses++;
  today.sumR+=t.profitR||0;
  setSymbolCooldown(t.symbol,t.finalPnl>0);
  logTradeDecision(t,{exitPrice:price,exitReason:reason,finalPnl:t.finalPnl,fees:t.totalFees});
  addLog(t.symbol+" "+reason+" net $"+t.finalPnl.toFixed(2),t.finalPnl>=0?"success":"warn");
  archive("paper_trade_close",t.symbol,{trade:{...t},reason,exitMarketPrice:price,
    executionPrice,gross,fees,netPnl:pnl,feeRate,slippageRate,
    accountBalanceAfter:virtualBalance},tradeArchiveId(t),Date.parse(t.exitTime));
  persistEngineSnapshot();
}
/** Regime-specific target + monotonic ATR/R profit protection + bounded time exit. */
export function protectTradeAtPrice(t:any,price:number,quoteTime=Date.now()){
  const now=Date.now();
  if(!Number.isFinite(quoteTime)||quoteTime>now+1000||now-quoteTime>5000||quoteTime<(t.lastQuoteTime||0))return;
  if(!activeTrades.includes(t)||t.exitTime||!(t.pos>0)||!(t.initialSlDist>0))return;
  if(!(Number.isFinite(price)&&price>0))return;
  t.lastQuoteTime=quoteTime;
  const stopBefore=t.sl,peakBefore=t.peak_r;
  const stopped=markTrade(t,price,feeRate,slippageRate);
  archive("price_quote",t.symbol,{receivedAt:now,quoteTime,price,
    quoteSide:t.direction==="LONG"?"BID":"ASK",
    stopBefore,peakBefore,markStopped:stopped,
    postMark:{sl:t.sl,peakR:t.peak_r,profitR:t.profitR,pnl:t.pnl},
    feeRate,slippageRate},tradeArchiveId(t),quoteTime);
  updateDirectionTracking(t.symbol,price);
  logTradeJourneySnapshot(t,price,t.pnl);
  if(stopped){
    const isProtected=t.direction==="LONG"?t.sl>t.entry:t.sl<t.entry;
    closeFull(t,isProtected?"ADAPTIVE Protected Stop":"ADAPTIVE Stop Loss");
    return;
  }
  if(t.strategyRevision!==FLEX_REVISION){
  const candidate=adaptiveStopCandidate(t.direction,t.entry,t.initialSlDist,t.peak_r||0,t.setupType);
  if(candidate!==null)tightenStop(t,candidate);
  // Apply new regime-specific trailing floors ONLY to V4 paper positions.
  // Trades restored from V3 keep their historical protection unchanged.
  if(t.strategyRevision===BIDIRECTIONAL_REVISION){
    const regimeStop=bidirectionalProfitStop(t.direction,t.setupType,t.entry,
      t.initialSlDist,t.peak_r||0);
    if(regimeStop!==null)tightenStop(t,regimeStop);
  }
  // Cost-aware +1R profit lock only tightens, preserving the stronger trailing
  // floor at +1.75R and above and the entire original target mechanism.
  const costStop=costAwareProfitLock(t.direction,t.entry,t.initialSlDist,
    t.peak_r||0,feeRate,slippageRate,t.setupType);
  if(costStop!==null)tightenStop(t,costStop);
  }
  const sign=t.direction==="LONG"?1:-1;
  if(sign*(price-t.sl)<=0){closeFull(t,"ADAPTIVE Protected Stop");return;}
  if(sign*(price-t.entry)>=(t.targetR||3.5)*t.initialSlDist){
    closeFull(t,"ADAPTIVE Regime Target");return;
  }
  if(now-new Date(t.entryTime).getTime()>=(t.maxHoldMs||180*60_000)){
    closeFull(t,"ADAPTIVE Time Exit");
  }
}
export async function runProtectionCycle(){
  if(rolling||protecting||activeTrades.length===0)return;
  protecting=true;
  try{
    await Promise.allSettled([...activeTrades].map(async t=>{
      try{
        const q=await fetchExecutionQuote(t.symbol);
        protectTradeAtPrice(t,t.direction==="LONG"?q.bid:q.ask,q.time);
        if(!t.exitTime && institutionalMonitoringEnabled){
          // REST context remains available when user turns WS OFF.
          await refreshInstitutionalEvidence(t.symbol,Date.now(),liveWebsocketEnabled);
          const now=Date.now();
          const newMinute=now-(t.lastFlowCheckAt||0)>=60_000;
          if(newMinute){
            t.lastFlowCheckAt=now;
            try{
              t.reversalBars=await fetchClosedOneMinuteBars(t.symbol);
              archive("closed_bars",t.symbol,{bars:t.reversalBars,
                receivedAt:Date.now(),purpose:"POSITION_REVERSAL_EVALUATION",
                source:"BINANCE_USDM_FAPI_V1_KLINES_1M_CLOSED"},
                tradeArchiveId(t),t.reversalBars.at(-1)?.closeTime);
            }
            catch(e:any){
              diagnostics.scanErrors++;
              if(diagnostics.scanErrors%20===1)
                addLog("Institutional 1m candles unavailable: "+String(e?.message||e).slice(0,110),"warn");
            }
          }
          // With WS on, reassess fresh aggregate tape at most every 10s using
          // cached fully closed minute candles; no additional REST kline flood.
          // With WS off, preserve prior once/minute reversal semantics.
          if(t.reversalBars?.length>=5 &&
             (liveWebsocketEnabled?now-(t.lastMarketDecisionAt||0)>=10_000:newMinute)){
            t.lastMarketDecisionAt=now;
            const context=institutionalSnapshot(t.symbol,now);
            const decisionContext=liveWebsocketEnabled?context:{...context,agg:null};
            const warning=evaluateReversal(t.direction,t.reversalBars,decisionContext,{
              entry:t.entry,initialSlDist:t.initialSlDist,price:t.currentPrice,
              peakR:t.peak_r||0,entryMs:new Date(t.entryTime).getTime()
            },now);
            archive("reversal_evaluation",t.symbol,{
              observedAt:now,direction:t.direction,entry:t.entry,
              stop:t.sl,initialStopDistance:t.initialSlDist,
              price:t.currentPrice,peakR:t.peak_r,profitR:t.profitR,
              closedBars:t.reversalBars,context:decisionContext,
              warning,feeRate,slippageRate,liveWebsocketEnabled
            },tradeArchiveId(t),now);
            t.latestInstitutionalWarning=warning;
            t.institutionalContext={
              timestamp:new Date(now).toISOString(),liveAgg:context.agg,
              book:context.book,openInterest:context.oi,takerRatio:context.taker,
              topTraders:context.topTraders,liquidations:context.liquidations,
              liveWebsocketEnabled
            };
            reversalDiagnostics.observations++;
            if(warning.decision==="INSUFFICIENT_DATA")reversalDiagnostics.incomplete++;
            if(warning.decision==="WATCH")reversalDiagnostics.warnings++;
            if(now-(t.lastInstitutionalLogAt||0)>=30000 || warning.decision==="EXIT"){
              t.lastInstitutionalLogAt=now;
              logInstitutionalEvidence({timestamp:new Date(now).toISOString(),
                trade_id:t.symbol+"_"+new Date(t.entryTime).getTime(),symbol:t.symbol,
                side:t.direction,price:t.currentPrice,profitR:t.profitR,peakR:t.peak_r,
                market:t.institutionalContext,warning});
            }
            if(warning.decision==="EXIT" && !t.exitTime && t.strategyRevision!==FLEX_REVISION){
              reversalDiagnostics.earlyExits++;
              closeFull(t,"ADAPTIVE Confirmed Institutional Reversal");
            }
          }
        }
      }catch(e:any){
        diagnostics.quoteErrors++;
        const reason=String(e?.message||"QUOTE_UNAVAILABLE").slice(0,160);
        diagnostics.quoteErrorReasons[reason]=(diagnostics.quoteErrorReasons[reason]||0)+1;
        if(diagnostics.quoteErrors===1 || diagnostics.quoteErrors%50===0)
          addLog("Quote failures "+diagnostics.quoteErrors+"; sample="+reason,"warn");
      }
    }));
    diagnostics.protectionCycles++;diagnostics.lastProtectionAt=Date.now();
    persistEngineSnapshot();
  }finally{protecting=false;}
}
export async function runApexLoop(){if(rolloverPending){await completePaperRollover();return;}if(!rolling)await scanEntries();}
export function startEngine(){
  institutionalMonitoringEnabled=true;
  syncMarketSubscriptions();
  if(scanTimer)clearInterval(scanTimer);
  if(protectTimer)clearInterval(protectTimer);
  protectTimer=setInterval(()=>{void runProtectionCycle();},PROTECT_INTERVAL_MS);
  scanTimer=setInterval(()=>{void runApexLoop();},SCAN_INTERVAL_MS);
  void runApexLoop();
  persistEngineSnapshot();
  addLog(ADAPTIVE_STRATEGY_ID+" initialized PAPER; 15m two-hour breakout and three-hour trend correction; fixed SL/TP/time exits; OI/depth/fee gates; live Binance WebSocket "+
    (liveWebsocketEnabled?"ON":"OFF")+" by default, route /market/stream; decision gate and reversal engine enabled.","success");
}
