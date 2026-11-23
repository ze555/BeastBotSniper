import express from "express";
import cors from "cors";
import path from "path";
import axios from "axios";
import { startEngine, getCandidateAudit, getStats, getTrades, getLogs, setActive, isActive, getClosedTrades, updateConfig, resetAccountState,restoreEngineState,persistEngineSnapshot } from "./src/lib/apexPredator.js";
import {initializePersistence,restoreSnapshot,flushPersistence,historicalEvents,persistenceStatus} from "./src/lib/durableStore.js";
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
  app.get("/api/health", (req, res) => res.json({ status: "ok", strategy: "ADAPTIVE_REGIME_ORDERFLOW_V3_ANTI_EXHAUSTION_R1_LOCK", mode: "PAPER", legacyEnginesEnabled: false }));
  
  app.get("/api/bot/status", (req, res) => res.json({ active: isActive() }));
  app.post("/api/bot/toggle", (req, res) => {
    setActive(!isActive());
    res.json({ active: isActive() });
  });

  app.get("/api/research/candidate-audit", (req, res) => res.json(getCandidateAudit()));
  app.get("/api/predator/stats", (req, res) => res.json(getStats()));
  app.post("/api/predator/config", (req, res) => {
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
    });
    res.json({success:true,strategy:"ADAPTIVE_REGIME_ORDERFLOW_V2_ENTRY_VERIFIED",liveWebsocketEnabled:getStats().liveWebsocketEnabled});
  });
  app.post("/api/predator/reset", (req, res) => {
    const ok = resetAccountState();
    if(!ok) return res.status(409).json({success:false,message:"Open paper positions must close before account reset"});
    res.json({success:true,balance:1000});
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
