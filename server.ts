import express from "express";
import cors from "cors";
import path from "path";
import AdmZip from "adm-zip";
import fs from "fs";
import { runBinanceScanner, getWatchlist } from "./src/lib/binanceScanner.js";
import { runTradeLoop, setBotActive, isBotActive, getRecentAnalyses, forceScan } from "./src/lib/botRunner.js";
import { sniper } from "./src/lib/sniperEngine.js";

// __dirname is natively available in CommonJS. Since this file is compiled to CommonJS via esbuild, we don't need fileURLToPath.

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());

  // Background Tasks
  // Run scanner immediately on boot (library handles its own loop now)
  runBinanceScanner();
  
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

  app.get("/api/bot/analyses", (req, res) => {
    res.json(getRecentAnalyses());
  });

  app.post("/api/bot/toggle", (req, res) => {
    const currentState = isBotActive();
    setBotActive(!currentState);
    res.json({ active: isBotActive() });
  });

  app.post("/api/bot/scan", async (req, res) => {
    const result = await forceScan();
    res.json(result);
  });

  app.get("/api/settings", (req, res) => {
    res.json(sniper.getSettings());
  });

  app.post("/api/settings", (req, res) => {
    sniper.updateSettings(req.body);
    res.json(sniper.getSettings());
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
