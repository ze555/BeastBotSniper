import express from "express";
import cors from "cors";
import path from "path";
import AdmZip from "adm-zip";
import fs from "fs";
import { runBinanceScanner, getWatchlist } from "./src/lib/binanceScanner.js";
import { runTradeLoop, setBotActive, isBotActive, getGlobalMarketContext, getSystemLogs, addLog } from "./src/lib/botRunner.js";
import { sniper } from "./src/lib/sniperEngine.js";
import { simulator } from "./src/lib/engine/EventReplaySimulator.js";

// __dirname is natively available in CommonJS. Since this file is compiled to CommonJS via esbuild, we don't need fileURLToPath.

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());

  // Background Tasks
  // Run scanner immediately on boot, then every 2 minutes
  runBinanceScanner();
  setInterval(runBinanceScanner, 2 * 60 * 1000); // 2 minutes
  
  // Start the tick-by-tick sniper evaluation loop
  runTradeLoop();

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", mode: "Sniper 3/3 Mode" });
  });

  app.get("/api/scanner/watchlist", (req, res) => {
    res.json(getWatchlist());
  });

  app.get("/api/trades/active", (req, res) => {
    res.json(sniper.getActiveTrades());
  });

  app.get("/api/trades/history", (req, res) => {
    res.json(sniper.getTradeHistory().slice(0, 50)); // Return last 50 for UI speed
  });

  app.get("/api/stats", (req, res) => {
    res.json(sniper.getStats());
  });

  app.get("/api/bot/status", (req, res) => {
    res.json({ active: isBotActive() });
  });

  app.post("/api/bot/toggle", (req, res) => {
    const currentState = isBotActive();
    setBotActive(!currentState);
    res.json({ active: isBotActive() });
  });

  app.get("/api/market/context", (req, res) => {
    res.json(getGlobalMarketContext());
  });

  app.get("/api/system/logs", (req, res) => {
    res.json(getSystemLogs());
  });

  app.get("/api/system/adaptive-logs", (req, res) => {
    res.json(sniper.getAdaptiveCascadeLogs());
  });

  app.post("/api/bot/panic", (req, res) => {
    const { active } = req.body;
    sniper.triggerPanic(active);
    addLog(`Manual Panic ${active ? 'ACTIVATED' : 'DEACTIVATED'}`, active ? 'warn' : 'info');
    res.json({ success: true, panicActive: active });
  });

  app.get("/api/settings", (req, res) => {
    const settings = { ...sniper.getSettings() };
    // Mask sensitive keys
    if (settings.binanceApiKey) settings.binanceApiKey = settings.binanceApiKey.substring(0, 4) + "****" + settings.binanceApiKey.substring(settings.binanceApiKey.length - 4);
    if (settings.binanceSecretKey) settings.binanceSecretKey = "****";
    res.json(settings);
  });

  app.get("/api/binance/test-connection", async (req, res) => {
    try {
      const result = await sniper.testBinanceConnection();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get("/api/utils/server-ip", async (req, res) => {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      res.json({ ip: data.ip });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch server IP" });
    }
  });

  app.post("/api/settings", (req, res) => {
    sniper.updateSettings(req.body);
    res.json(sniper.getSettings());
  });

  app.get("/api/backtest/scenarios", (req, res) => {
    res.json(simulator.getScenarios().map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      regime: s.regime
    })));
  });

  app.post("/api/backtest/run", (req, res) => {
    try {
      const { scenarioId, settings } = req.body;
      const result = simulator.runSimulation(scenarioId, settings);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/utils/reset-db", async (req, res) => {
    try {
      await sniper.resetData();
      res.json({ success: true, message: "Database cleared successfully" });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get("/api/export", (req, res) => {
    try {
      const zip = new AdmZip();
      
      const rootDir = process.cwd();
      const items = fs.readdirSync(rootDir);
      
      const excludeList = ["node_modules", "dist", ".git", "sniper.db", "sniper.db-journal"];
      
      items.forEach(item => {
        if (excludeList.includes(item)) return;
        
        const itemPath = path.join(rootDir, item);
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory()) {
          zip.addLocalFolder(itemPath, item);
        } else {
          zip.addLocalFile(itemPath);
        }
      });
      
      const zipBuffer = zip.toBuffer();
      
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", "attachment; filename=sniper-bot-export.zip");
      res.send(zipBuffer);
    } catch (err) {
      console.error("Export error:", err);
      res.status(500).json({ error: "Failed to create export zip" });
    }
  });

  // Vite Integration for dev or static serving for prod
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    console.log(`[SERVER] Serving static files from: ${distPath}`);
    app.use(express.static(distPath, {
      setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    }));
    app.get("*", (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
