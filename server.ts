import express from "express";
import cors from "cors";
import path from "path";
import axios from "axios";
import { startEngine, getStats, getTrades, getLogs, setActive, isActive, getClosedTrades, updateConfig } from "./src/lib/apexPredator.js";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());

  // Start Apex Predator
  startEngine();

  // API Routes
  app.get("/api/health", (req, res) => res.json({ status: "ok", mode: "Apex Predator Only" }));
  
  app.get("/api/bot/status", (req, res) => res.json({ active: isActive() }));
  app.post("/api/bot/toggle", (req, res) => {
    setActive(!isActive());
    res.json({ active: isActive() });
  });

  app.get("/api/predator/stats", (req, res) => res.json(getStats()));
  app.post("/api/predator/config", (req, res) => {
     updateConfig(req.body.balance, req.body.maxTrades, {
        haltProfitEnabled: req.body.haltProfitEnabled,
        haltProfitTarget: req.body.haltProfitTarget,
        haltLossEnabled: req.body.haltLossEnabled,
        haltLossTarget: req.body.haltLossTarget,
        smartBtcHoldEnabled: req.body.smartBtcHoldEnabled,
        btcVolThresholdStr: req.body.btcVolThresholdStr,
        slAtrMultiplier: req.body.slAtrMultiplier,
        scheduleEnabled: req.body.scheduleEnabled,
        libyaOpen1: req.body.libyaOpen1,
        libyaClose1: req.body.libyaClose1,
        libyaOpen2: req.body.libyaOpen2,
        libyaClose2: req.body.libyaClose2,
     });
     res.json({ success: true });
  });
  app.get("/api/trades/active", (req, res) => res.json(getTrades()));
  app.get("/api/trades/closed", (req, res) => res.json(getClosedTrades()));
  app.get("/api/system/logs", (req, res) => res.json(getLogs()));
  
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
