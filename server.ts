import express from "express";
import cors from "cors";
import path from "path";
import axios from "axios";
import { startEngine, getCandidateAudit, getStats, getTrades, getLogs, setActive, isActive, getClosedTrades, updateConfig, resetAccountState,restoreEngineState,persistEngineSnapshot,initializePaperRun,requestNewPaperRun,paperRolloverBusy } from "./src/lib/apexPredator.js";
import {initializePersistence,restoreSnapshot,flushPersistence,historicalEvents,persistenceStatus,
  replayEvents,replayCoverage,listPaperRuns,getPaperRun,type ReplayKind} from "./src/lib/durableStore.js";
import { isValidStrongFlowTradingSchedule } from "./src/lib/strongFlowStrategy.js";
import { 
  getTradingDecisionsData, 
  getRejectedSignalsData, 
  getTradeJourneysData, getInstitutionalEvidenceData,
  getPerformanceSummaryData, 
  getFullExportBundle,restoreResearchCaches,researchStorageInfo
} from "./src/lib/researchLogger.js";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());

  // Restore durable state BEFORE any scanning, position protection, or market decisions.
  // Fail startup instead of silently trading with $1000 if a configured volume is corrupt.
  const durable=await initializePersistence();
  if(durable){
    const saved=await restoreSnapshot();
    if(saved)restoreEngineState(saved);
    await initializePaperRun(saved);
    const restoredLogs=restoreResearchCaches();
    console.log("[PERSISTENCE] Research caches restored "+JSON.stringify(restoredLogs));
  }else{
    console.warn("[PERSISTENCE] BEAST_PERSIST_DIR not set: restart will discard PAPER state. Attach a Railway Volume.");
  }
  // Pure storage lifecycle: no change to signal, entry, exit, fees, or risk rules.
  startEngine();
  process.once("SIGTERM",()=>{
    persistEngineSnapshot();
    void flushPersistence().then(()=>process.exit(0)).catch(err=>{
      console.error("[PERSISTENCE] Shutdown flush failed",err);
      process.exit(1);
    });
  });

  // API Routes
  app.get("/api/health", (req, res) => res.json({ status: "ok", strategy: getStats().strategyRevision, mode: "PAPER", legacyEnginesEnabled: false, bidirectional: true, engineStatus: isActive() ? "RUNNING" : "PAUSED" }));
  
  app.get("/api/bot/status", (req, res) => res.json({ active: isActive() }));
  app.post("/api/bot/toggle", (req, res) => {
    if(paperRolloverBusy())return res.status(409).json({message:"Archive in progress"});
    setActive(!isActive());
    res.json({ active: isActive() });
  });

  app.get("/api/research/candidate-audit", (req, res) => res.json(getCandidateAudit()));
  app.get("/api/predator/stats", (req, res) => res.json(getStats()));
  app.post("/api/predator/config", (req, res) => {
    if(paperRolloverBusy())return res.status(409).json({message:"Archive in progress"});
    if(req.body?.archiveOnUpdate!==undefined&&typeof req.body.archiveOnUpdate!=="boolean")return res.status(400).json({message:"archiveOnUpdate must be boolean"});
    if (req.body?.tradingSchedule !== undefined && !isValidStrongFlowTradingSchedule(req.body.tradingSchedule)) {
      res.status(400).json({success:false,message:"Invalid trading schedule: use ALWAYS or SCHEDULED with HH:mm Libya times and different start/end."});
      return;
    }
    if(req.body?.liveWebsocketEnabled!==undefined && typeof req.body.liveWebsocketEnabled!=="boolean"){
      res.status(400).json({success:false,message:"liveWebsocketEnabled must be boolean"});
      return;
    }
    updateConfig(req.body.balance, req.body.maxTrades, {
      haltProfitEnabled: req.body.haltProfitEnabled,
      haltProfitTarget: req.body.haltProfitTarget,
      haltLossEnabled: req.body.haltLossEnabled,
      haltLossTarget: req.body.haltLossTarget,
      scanBatchSize: req.body.scanBatchSize,
      feeRate: req.body.feeRate,
      slippageRate: req.body.slippageRate,
      tradingSchedule: req.body.tradingSchedule,
      liveWebsocketEnabled: req.body.liveWebsocketEnabled,
      archiveOnUpdate:req.body.archiveOnUpdate,
    });
    res.json({success:true,strategy:"ADAPTIVE_REGIME_ORDERFLOW_V2_ENTRY_VERIFIED",liveWebsocketEnabled:getStats().liveWebsocketEnabled});
  });
  app.post("/api/predator/reset",async(req,res)=>{
    if(req.body?.confirm!=="ARCHIVE_AND_RESET"||!("expectedRunId" in (req.body||{})))return res.status(400).json({message:"Explicit archive confirmation and current run ID required"});
    try{const result=await requestNewPaperRun(req.body.expectedRunId);res.status(result.pending?202:200).json({success:true,...result});}
    catch(e:any){res.status(409).json({success:false,message:String(e?.message||e)});}
  });
  app.get("/api/paper/runs",async(req,res)=>{
    try{res.json({runs:await listPaperRuns(Number(req.query.limit)||50,Number(req.query.offset)||0)});}catch(e:any){res.status(500).json({error:String(e?.message||e)});}
  });
  app.get("/api/paper/runs/:id/trades",async(req,res)=>{
    try{const run=await getPaperRun(req.params.id);if(!run)return res.status(404).json({error:"Run not found"});
      res.json(await replayEvents({kind:"paper_trade_close",afterId:Math.max(Number(run.replayStartId)||0,Number(req.query.afterId)||0),throughId:Number(run.replayEndId)||0,limit:Number(req.query.limit)||100}));
    }catch(e:any){res.status(500).json({error:String(e?.message||e)});}
  });
  app.get("/api/paper/runs/:id",async(req,res)=>{
    try{const run=await getPaperRun(req.params.id);if(!run)return res.status(404).json({error:"Run not found"});res.json(run);}catch(e:any){res.status(500).json({error:String(e?.message||e)});}
  });
  app.get("/api/trades/active", (req, res) => res.json(getTrades()));
  app.get("/api/trades/closed", (req, res) => res.json(getClosedTrades()));
  app.get("/api/system/logs", (req, res) => res.json(getLogs()));

  // ═══ ONLINE RESEARCH DATASET API (ChatGPT Analysis Endpoints) ═══
  app.get("/api/research/trades", (req, res) => {
    const limit = Number(req.query.limit) || 100;
    res.json(getTradingDecisionsData(limit));
  });

  app.get("/api/research/rejected", (req, res) => {
    const limit = Number(req.query.limit) || 100;
    res.json(getRejectedSignalsData(limit));
  });

  app.get("/api/research/journeys", (req, res) => {
    const limit = Number(req.query.limit) || 100;
    res.json(getTradeJourneysData(limit));
  });
  app.get("/api/research/institutional", (req, res) => {
    const limit = Number(req.query.limit) || 100;
    res.json(getInstitutionalEvidenceData(limit));
  });

  app.get("/api/research/performance", (req, res) => {
    res.json(getPerformanceSummaryData());
  });

  app.get("/api/research/export-all", (req, res) => {
    res.json(getFullExportBundle());
  });
  app.get("/api/persistence/status", (_req,res)=>res.json({
    ...persistenceStatus(),research:researchStorageInfo(),
    note:"SQLite append-only archive plus on-volume JSONL. Export is memory-limited; use paged archive for complete history."
  }));
  // Replay archive is strictly read-only. Cursor order is DB ingestion order,
  // while sourceMs and observedMs remain distinct to prevent lookahead bias.
  app.get("/api/research/replay/coverage",async(_req,res)=>{
    try{res.json({...await replayCoverage(),
      description:"Observed live inputs only. No synthetic missing ticks, book history, or funding; historical exactness depends on recorded fields."});}
    catch(e:any){res.status(500).json({error:String(e?.message||e)});}
  });
  app.get("/api/research/replay",async(req,res)=>{
    try{
      const kind=req.query.kind?String(req.query.kind) as ReplayKind:undefined;
      const symbol=req.query.symbol?String(req.query.symbol):undefined;
      const tradeId=req.query.tradeId?String(req.query.tradeId):undefined;
      if(symbol&&(!/^[\p{L}\p{N}_]{3,40}$/u.test(symbol)))return res.status(400).json({error:"Invalid symbol"});
      if(tradeId&&(tradeId.length>150||!/^\S+$/.test(tradeId)))return res.status(400).json({error:"Invalid tradeId"});
      const limit=Math.max(1,Math.min(200,Number(req.query.limit)||100));
      const afterId=Math.max(0,Number(req.query.afterId)||0);
      const afterMs=req.query.afterMs?Number(req.query.afterMs):undefined;
      const beforeMs=req.query.beforeMs?Number(req.query.beforeMs):undefined;
      res.json(await replayEvents({kind,symbol,tradeId,limit,afterId,afterMs,beforeMs}));
    }catch(e:any){res.status(400).json({error:String(e?.message||e)});}
  });
  // Paged, read-only durable archive: no scan/trading mutations.
  app.get("/api/research/archive", async (req,res)=>{
    try{
      const type=String(req.query.type||"trading_decisions");
      const allowed=new Set(["trading_decisions","trade_journeys","institutional_evidence",
        "rejected_signals","daily_summary"]);
      if(!allowed.has(type))return res.status(400).json({error:"Invalid archive category"});
      const limit=Math.max(1,Math.min(500,Number(req.query.limit)||100));
      const offset=Math.max(0,Math.min(1e7,Number(req.query.offset)||0));
      const result=await historicalEvents(type,limit,offset);
      res.json({type,offset,limit,...result});
    }catch(e:any){res.status(500).json({error:String(e?.message||e)});}
  });
  
  app.post("/api/gemini/analyze", async (req, res) => {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(400).json({ success: false, message: "GEMINI_API_KEY missing" });
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: req.body.prompt });
      res.json({ success: true, text: response.text });
    } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(Number(PORT), "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
}

startServer();
