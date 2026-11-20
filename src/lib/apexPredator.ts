/**
 * BeastBotSniper paper runtime — PB_STRONG_FLOW_FIXED2_1M_V1 ONLY.
 * Legacy scoring, pullback sniper, tri-regime entry, layered partial exits,
 * BTC veto, adaptive trailing, and legacy reversal execution are retired.
 * Existing historical research modules remain available for offline analysis.
 */
import axios from "axios";
import { listAllUsdmPerpetuals, nextCoverageBatch } from "./futuresUniverse.js";
import { fetchExecutionQuote } from "./executionQuotes.js";
import { markTrade, closedCandles } from "./tradingIntegrity.js";
import {
  evaluateStrongFlowSignal, isStrongFlowTradingHour,
  isValidStrongFlowTradingSchedule, STRONG_FLOW_DEFAULT_TRADING_SCHEDULE,
  type StrongFlowTradingSchedule,
  STRONG_FLOW_STRATEGY_ID, STRONG_FLOW_MAX_HOLD_MS,
  STRONG_FLOW_MAX_CONCURRENT, STRONG_FLOW_RISK_FRACTION,
  type StrongFlowSignal, type StrongFlowBar
} from "./strongFlowStrategy.js";
import {
  extractEntryTiming, extractMarketRegimeContext, formatCandles,
  registerTradeForDirectionTracking, updateDirectionTracking,
  logTradeJourneySnapshot, logTradeDecision
} from "./researchLogger.js";

const FAPI = "https://fapi.binance.com";
const MAX_DAILY_LOSS = 0.04;
const SCAN_INTERVAL_MS = 15_000;
const SCAN_CONCURRENCY = 12; // bound parallel klines requests / Railway resource use
const PROTECT_INTERVAL_MS = 2_000;
const MAX_DASHBOARD_TRADES = 150;
let active = false;
let scanning = false;
let protecting = false;
let scanTimer: ReturnType<typeof setInterval> | null = null;
let protectTimer: ReturnType<typeof setInterval> | null = null;
let virtualBalance = 1000;
let initialVirtualBalance = 1000;
let maxOpenTrades = STRONG_FLOW_MAX_CONCURRENT;
let scanBatchSize = 0; // AUTO: visit every available futures symbol per full round
let feeRate = 0.0004;
let slippageRate = 0.0002;
let tradingSchedule: StrongFlowTradingSchedule = {...STRONG_FLOW_DEFAULT_TRADING_SCHEDULE};
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
let hotWatchlist: string[] = ["BTCUSDT","ETHUSDT","SOLUSDT"];
const activeTrades: any[] = [];
const closedTrades: any[] = [];
const logs: any[] = [];
const audits: any[] = [];
const lastSignalTime = new Map<string,number>();
const cooldownUntil = new Map<string,number>();
const diagnostics = {opened:0,quoteErrors:0,scanErrors:0,rateLimitEvents:0,protectionCycles:0,lastProtectionAt:0,lastReason:"",reasons:{} as Record<string,number>};

export function addLog(message: string, type: "info"|"warn"|"success"|"error"="info") {
  logs.unshift({time:new Date().toISOString(),msg:message,type});
  if (logs.length>200) logs.length=200;
  console.log("[STRONG_FLOW] "+message);
}
function audit(symbol:string,side:string,reason:string,allowed:boolean) {
  diagnostics.lastReason=reason;
  diagnostics.reasons[reason]=(diagnostics.reasons[reason]||0)+1;
  audits.unshift({time:new Date().toISOString(),revision:STRONG_FLOW_STRATEGY_ID,symbol,side,reason,allowed});
  if(audits.length>200) audits.length=200;
}
export function getCandidateAudit(){return audits;}
export function getLogs(){return logs;}
export function getTrades(){return activeTrades;}
export function getClosedTrades(){return closedTrades;}
export function isActive(){return active;}
export function setActive(value:boolean){active=Boolean(value);addLog("BOT ACTIVE: "+active);}
export function isSymbolInCooldown(symbol:string) {
  const until=cooldownUntil.get(symbol)||0;
  if(Date.now()>=until){cooldownUntil.delete(symbol);return false;}
  return true;
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
function entryBlocked(){
  if(!active || !isStrongFlowTradingHour(new Date(), tradingSchedule))return true;
  if(!Number.isFinite(virtualBalance)||virtualBalance<=0)return true;
  if(activeTrades.length>=Math.min(maxOpenTrades,STRONG_FLOW_MAX_CONCURRENT))return true;
  if(today.pnl+floatingPnl()<=-initialVirtualBalance*MAX_DAILY_LOSS)return true;
  const net=netPnl();
  if(haltProfitEnabled&&net>=haltProfitTarget)return true;
  if(haltLossEnabled&&net<=-haltLossTarget)return true;
  return false;
}
export function getStats(){
  return {
    strategyRevision:STRONG_FLOW_STRATEGY_ID,
    strategyMode:"PB_STRONG_FLOW_FIXED_2R_ONLY",
    executionMode:"PAPER",
    legacyEnginesEnabled:false,
    totalEvaluations:audits.length,
    totalLongScanned:audits.filter(a=>a.side==="LONG").length,
    totalShortScanned:audits.filter(a=>a.side==="SHORT").length,
    acceptedLongs:audits.filter(a=>a.allowed&&a.side==="LONG").length,
    acceptedShorts:audits.filter(a=>a.allowed&&a.side==="SHORT").length,
    rules:{},diagnostics,
    balance:virtualBalance,initialBalance:initialVirtualBalance,
    maxOpenTrades,feeRate,slippageRate,scanBatchSize,
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
    strategySettings:{tradingSchedule:{...tradingSchedule},timeframe:"1m closed",stopAtr:2,targetR:2,
      riskFraction:STRONG_FLOW_RISK_FRACTION,maxHoldMinutes:STRONG_FLOW_MAX_HOLD_MS/60_000,
      maxConcurrent:STRONG_FLOW_MAX_CONCURRENT,dailyLossLimit:MAX_DAILY_LOSS}
  };
}
export function getConfig(){return {virtualBalance,initialVirtualBalance,maxOpenTradesConfig:maxOpenTrades,
  haltProfitEnabled,haltProfitTarget,haltLossEnabled,haltLossTarget,scanBatchSize,feeRate,slippageRate,tradingSchedule:{...tradingSchedule}};}
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
  if(activeTrades.length===0&&closedTrades.length===0&&Number.isFinite(newBalance)&&newBalance>0){
    initialVirtualBalance=newBalance;virtualBalance=newBalance;
  }
  if(Number.isFinite(newMax)&&newMax>=1)maxOpenTrades=Math.max(1,Math.min(STRONG_FLOW_MAX_CONCURRENT,Math.floor(newMax)));
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
}
export function resetAccountState(){
  if(activeTrades.length){addLog("Reset rejected: open paper positions must be closed first.","warn");return false;}
  virtualBalance=initialVirtualBalance=1000;
  today={count:0,wins:0,losses:0,pnl:0,sumR:0};closedTrades.length=0;
  cooldownUntil.clear();lastSignalTime.clear();addLog("Paper account reset to $1000.","success");return true;
}
async function updateUniverse(){
  if(lastUniverseUpdate && Date.now()-lastUniverseUpdate<300_000)return;
  try {
    // ExchangeInfo is authoritative; do not depend on ticker availability for full coverage.
    const info=await axios.get(FAPI+"/fapi/v1/exchangeInfo",{timeout:8000});
    if(!Array.isArray(info.data?.symbols))return;
    const eligible=listAllUsdmPerpetuals(info.data.symbols);
    if(!eligible.length)return;
    const nextSymbol=watchlist[currentBatchIndex];
    const universeChanged=watchlist.length!==eligible.length || watchlist.some((s,i)=>s!==eligible[i]);
    watchlist=eligible;
    if(universeChanged) {
      // Preserve round-robin position for existing symbols; do not repeatedly restart at 0.
      const cursor=nextSymbol?watchlist.indexOf(nextSymbol):-1;
      currentBatchIndex=cursor>=0?cursor:0;
      scanPassStartedAt=0;scanPassAttempted.clear();scanPassSucceeded.clear();
      addLog("All Binance USD-M USDT/USDC perpetual contracts eligible: "+watchlist.length,"success");
    }
    lastUniverseUpdate=Date.now();
    try {
      const ticker=await axios.get(FAPI+"/fapi/v1/ticker/24hr",{timeout:8000});
      const eligibleSet=new Set(watchlist);
      hotWatchlist=Array.isArray(ticker.data)?ticker.data
        .filter((x:any)=>eligibleSet.has(x.symbol)&&Math.abs(Number(x.priceChangePercent))>=1)
        .sort((a:any,b:any)=>Math.abs(Number(b.priceChangePercent))-Math.abs(Number(a.priceChangePercent)))
        .slice(0,20).map((x:any)=>x.symbol):[];
    } catch { hotWatchlist=[]; /* Ticker is optional; main coverage still runs. */ }
  }catch(e:any) {
    diagnostics.scanErrors++;
    addLog("Universe refresh unavailable; retaining previous symbols: "+(e?.message||e),"warn");
  }
}
async function fetchClosedOneMinuteBars(symbol:string):Promise<StrongFlowBar[]>{
  let r;
  try {
    r=await axios.get(FAPI+"/fapi/v1/klines",{params:{symbol,interval:"1m",limit:85},timeout:5000});
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
async function executeSignal(symbol:string,signal:StrongFlowSignal,bars:StrongFlowBar[]){
  if(entryBlocked()||activeTrades.some(t=>t.symbol===symbol)||isSymbolInCooldown(symbol)
    ||lastSignalTime.get(symbol)===signal.signalCloseTime)return;
  let quote;
  try{quote=await fetchExecutionQuote(symbol);}
  catch{diagnostics.quoteErrors++;audit(symbol,signal.side,"QUOTE_UNAVAILABLE",false);return;}
  if(entryBlocked()||Date.now()-signal.signalCloseTime>90_000)return;
  const sign=signal.side==="LONG"?1:-1;
  const entry=(signal.side==="LONG"?quote.ask:quote.bid)*(1+sign*slippageRate);
  const dist=signal.atr14*2;
  if(!(entry>0&&dist>0&&dist/entry>=0.0048&&dist/entry<=0.04)){
    audit(symbol,signal.side,"STOP_DISTANCE_OUT_OF_RANGE",false);return;
  }
  const stop=entry-sign*dist,target=entry+sign*2*dist;
  if(!(stop>0&&target>0))return;
  const riskBudget=Math.max(0,initialVirtualBalance*MAX_DAILY_LOSS+Math.min(0,today.pnl)-riskedDollars());
  const dollars=Math.min(virtualBalance*STRONG_FLOW_RISK_FRACTION,riskBudget);
  const notionalCap=Math.min(virtualBalance*10,virtualBalance*0.15*10);
  const pos=Math.min(dollars/(dist+entry*2*(feeRate+slippageRate)),notionalCap/entry);
  if(!(pos>0&&Number.isFinite(pos))){audit(symbol,signal.side,"RISK_BUDGET",false);return;}
  const t:any={
    symbol,direction:signal.side,entry,sl:stop,initialSlDist:dist,
    tp1:target,tp2:target,tp3:target,pos,initialPos:pos,
    part_a:1,part_b:0,part_c:0,a_closed:false,b_closed:false,c_closed:false,
    be_done:false,micro_banked:false,peak_r:0,pnl:0,realizedPnl:0,totalFees:0,
    entryTime:new Date().toISOString(),entrySignalTime:signal.signalCloseTime,
    entryTiming:extractEntryTiming(),marketRegimeContext:extractMarketRegimeContext({rvol:signal.rvol,atr14:signal.atr14,atr20:signal.atr14}),
    strategyRevision:STRONG_FLOW_STRATEGY_ID,executionMode:"PAPER",
    setupType:"PB_STRONG_FLOW",setupLabel:"1m strong flow / fixed 2R",grade:"GRADE_A",
    atr:signal.atr14,highestPrice:entry,lowestPrice:entry,currentPrice:entry,
    candlesBeforeEntry:formatCandles(bars,40),
    priceData:{rvol:signal.rvol,atr14:signal.atr14,delta:signal.delta,flow5:signal.flow5,flow15:signal.flow15,trend15:signal.trend15,trend60:signal.trend60},
    whaleData:{scenario:"STRONG_FLOW_1M_EXECUTED_TAKER_QUOTE"},
    reasoning:{flow:{state:"STRONG_FLOW_1M"},timingGate:{state:"CONFIRMED"}}
  };
  activeTrades.push(t);lastSignalTime.set(symbol,signal.signalCloseTime);
  diagnostics.opened++;registerTradeForDirectionTracking(t);
  audit(symbol,signal.side,"PB_STRONG_FLOW_FIXED_2R",true);
  addLog("PAPER "+signal.side+" "+symbol+" opened at "+entry+"; full target 2R","success");
}
async function scanEntries(){
  if(!active || !isStrongFlowTradingHour(new Date(),tradingSchedule) || scanning || Date.now()<scanBackoffUntil)return;
  scanning=true;
  try{
    resetDailyStatsIfNeeded();
    await updateUniverse();
    if(!active || !isStrongFlowTradingHour(new Date(),tradingSchedule) || Date.now()<scanBackoffUntil)return;
    const batch=nextCoverageBatch(watchlist,currentBatchIndex,scanBatchSize);
    if(batch.symbols.length===0)return;
    if(!scanPassStartedAt)scanPassStartedAt=Date.now();
    const regularSet=new Set(batch.symbols);
    // Hot symbols get extra attention, but never displace a symbol in the coverage round.
    const symbols=[...new Set([...hotWatchlist,...batch.symbols])];
    let attempted=0,succeeded=0,complete=true;
    for(let i=0;i<symbols.length;i+=SCAN_CONCURRENCY) {
      if(!active || !isStrongFlowTradingHour(new Date(),tradingSchedule) || Date.now()<scanBackoffUntil) {
        complete=false;break;
      }
      const group=symbols.slice(i,i+SCAN_CONCURRENCY);
      const rows=await Promise.allSettled(group.map(async symbol=>{
        const bars=await fetchClosedOneMinuteBars(symbol);
        return {symbol,bars,signal:evaluateStrongFlowSignal(bars)};
      }));
      for(let j=0;j<rows.length;j++){
        const symbol=group[j],result=rows[j];
        if(regularSet.has(symbol)) {
          scanPassAttempted.add(symbol);attempted++;
          if(result.status==="fulfilled"){scanPassSucceeded.add(symbol);succeeded++;}
        }
        if(result.status==="fulfilled"&&result.value.signal) {
          // Risk gates apply to placing orders, not the surveillance of the full market.
          await executeSignal(result.value.symbol,result.value.signal,result.value.bars);
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
  finally{scanning=false;}
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
  closedTrades.unshift(t);if(closedTrades.length>MAX_DASHBOARD_TRADES)closedTrades.length=MAX_DASHBOARD_TRADES;
  today.count++;today.pnl+=t.finalPnl;
  if(t.finalPnl>0.15)today.wins++;
  if(t.finalPnl< -0.15)today.losses++;
  today.sumR+=t.profitR||0;
  setSymbolCooldown(t.symbol,t.finalPnl>0);
  logTradeDecision(t,{exitPrice:price,exitReason:reason,finalPnl:t.finalPnl,fees:t.totalFees});
  addLog(t.symbol+" "+reason+" net $"+t.finalPnl.toFixed(2),t.finalPnl>=0?"success":"warn");
}
/** Sole exit policy: initial SL, full 2R take-profit, 180m time stop. No partial exits/trailing. */
export function protectTradeAtPrice(t:any,price:number,quoteTime=Date.now()){
  const now=Date.now();
  if(!Number.isFinite(quoteTime)||quoteTime>now+1000||now-quoteTime>5000||quoteTime<(t.lastQuoteTime||0))return;
  if(!activeTrades.includes(t)||t.exitTime||!(t.pos>0)||!(t.initialSlDist>0))return;
  if(!(Number.isFinite(price)&&price>0))return;
  t.lastQuoteTime=quoteTime;
  const stopped=markTrade(t,price,feeRate,slippageRate);
  updateDirectionTracking(t.symbol,price);
  logTradeJourneySnapshot(t,price,t.pnl);
  if(stopped){closeFull(t,"PB_STRONG_FLOW Stop Loss");return;}
  const sign=t.direction==="LONG"?1:-1;
  if(sign*(price-t.entry)>=2*t.initialSlDist){
    closeFull(t,"PB_STRONG_FLOW Fixed 2R Target");return;
  }
  if(now-new Date(t.entryTime).getTime()>=STRONG_FLOW_MAX_HOLD_MS){
    closeFull(t,"PB_STRONG_FLOW 180m Time Exit");
  }
}
export async function runProtectionCycle(){
  if(protecting||activeTrades.length===0)return;
  protecting=true;
  try{
    await Promise.allSettled([...activeTrades].map(async t=>{
      try{
        const q=await fetchExecutionQuote(t.symbol);
        protectTradeAtPrice(t,t.direction==="LONG"?q.bid:q.ask,q.time);
      }catch{diagnostics.quoteErrors++;}
    }));
    diagnostics.protectionCycles++;diagnostics.lastProtectionAt=Date.now();
  }finally{protecting=false;}
}
export async function runApexLoop(){await scanEntries();}
export function startEngine(){
  if(scanTimer)clearInterval(scanTimer);
  if(protectTimer)clearInterval(protectTimer);
  protectTimer=setInterval(()=>{void runProtectionCycle();},PROTECT_INTERVAL_MS);
  scanTimer=setInterval(()=>{void runApexLoop();},SCAN_INTERVAL_MS);
  void runApexLoop();
  addLog(STRONG_FLOW_STRATEGY_ID+" initialized. PAPER only; legacy execution retired.","success");
}
