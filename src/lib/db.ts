import sqlite3 from 'sqlite3';
import path from 'path';
import { Trade } from '../types/trading.js';

// Use a simple relative file or an absolute path inside the project dir.
// In Render, the root folder is /opt/render/project/src
const dbPath = path.resolve(process.cwd(), 'sniper.db');

export const db = new sqlite3.Database(dbPath);

export const initDB = () => {
  return new Promise<void>((resolve, reject) => {
    db.serialize(() => {
      // Execute the CREATE TABLE inside the callback to ensure DB is open
      db.run(`
        CREATE TABLE IF NOT EXISTS trades (
          id TEXT PRIMARY KEY,
          symbol TEXT NOT NULL,
          type TEXT NOT NULL,
          mode TEXT NOT NULL,
          entryPrice REAL NOT NULL,
          entryTime INTEGER NOT NULL,
          amount REAL NOT NULL,
          leverage REAL DEFAULT 10,
          sl REAL NOT NULL,
          initialSl REAL NOT NULL,
          tp1 REAL NOT NULL,
          tp2 REAL NOT NULL,
          status TEXT NOT NULL,
          exitPrice REAL,
          exitTime INTEGER,
          pnl REAL,
          pnlPerc REAL,
          score INTEGER NOT NULL,
          isBreakeven INTEGER DEFAULT 0
        )
      `);
      
      db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          id TEXT PRIMARY KEY,
          portfolioSize REAL NOT NULL,
          riskPerTradePerc REAL NOT NULL,
          maxConcurrentTrades INTEGER NOT NULL,
          leverage REAL DEFAULT 10,
          strictMode INTEGER DEFAULT 0,
          strictMinVolume REAL DEFAULT 5000000,
          strictMinRvol REAL DEFAULT 3.0,
          strictMaxRisk REAL DEFAULT 1.0,
          strictMinScore INTEGER DEFAULT 6,
          strictBtcAlignment INTEGER DEFAULT 1,
          strictRsiFilter INTEGER DEFAULT 1,
          strictRetest INTEGER DEFAULT 1,
          strictFastBreakevenPerc REAL DEFAULT 0.75,
          strictRsiHigh REAL DEFAULT 75,
          strictRsiLow REAL DEFAULT 25,
          strictRetestPullbackPerc REAL DEFAULT 3.0,
          strictBreakoutDistancePerc REAL DEFAULT 0.5,
          useSmartExit INTEGER DEFAULT 0,
          useSmartControl INTEGER DEFAULT 0,
          smartTpUsd REAL DEFAULT 1.0,
          smartTrailingStartUsd REAL DEFAULT 0.4,
          smartTimeDecayMinutes INTEGER DEFAULT 5,
          smartTrailingThresholdPerc REAL DEFAULT 0.3,
          smartMomentumStallMinutes REAL DEFAULT 2.5,
          useKineticEngine INTEGER DEFAULT 0,
          beastMode INTEGER DEFAULT 0
        )
      `);
      
      // Attempt to add column to existing DB safely
      const newCols = [
        "strictMode INTEGER DEFAULT 0",
        "useSmartExit INTEGER DEFAULT 0",
        "useSmartControl INTEGER DEFAULT 0",
        "smartTpUsd REAL DEFAULT 1.0",
        "smartTrailingStartUsd REAL DEFAULT 0.4",
        "smartTimeDecayMinutes INTEGER DEFAULT 5",
        "smartTrailingThresholdPerc REAL DEFAULT 0.3",
        "smartMomentumStallMinutes REAL DEFAULT 2.5",
        "useKineticEngine INTEGER DEFAULT 0",
        "beastMode INTEGER DEFAULT 0",
        "strictMinVolume REAL DEFAULT 5000000",
        "strictMinRvol REAL DEFAULT 3.0",
        "strictMaxRisk REAL DEFAULT 1.0",
        "strictMinScore INTEGER DEFAULT 6",
        "strictBtcAlignment INTEGER DEFAULT 1",
        "strictRsiFilter INTEGER DEFAULT 1",
        "strictRetest INTEGER DEFAULT 1",
        "strictFastBreakevenPerc REAL DEFAULT 0.75",
        "leverage REAL DEFAULT 10",
        "strictRsiHigh REAL DEFAULT 75",
        "strictRsiLow REAL DEFAULT 25",
        "strictRetestPullbackPerc REAL DEFAULT 3.0",
        "strictBreakoutDistancePerc REAL DEFAULT 0.5"
      ];
      
      let pending = newCols.length;
      if (pending === 0) resolve();

      newCols.forEach(col => {
         db.run(`ALTER TABLE settings ADD COLUMN ${col}`, (err) => {
           pending--;
           if (pending === 0) resolve();
         });
      });
      db.run(`ALTER TABLE trades ADD COLUMN leverage REAL DEFAULT 10`, () => {});
    });
  });
};

export function saveTrade(t: Trade) {
  const query = `
    INSERT INTO trades (id, symbol, type, mode, entryPrice, entryTime, amount, leverage, sl, initialSl, tp1, tp2, status, exitPrice, exitTime, pnl, pnlPerc, score, isBreakeven) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET 
      sl=excluded.sl, 
      status=excluded.status, 
      exitPrice=excluded.exitPrice, 
      exitTime=excluded.exitTime, 
      pnl=excluded.pnl, 
      pnlPerc=excluded.pnlPerc, 
      isBreakeven=excluded.isBreakeven
  `;
  
  db.serialize(() => {
    db.run(query, [
      t.id, t.symbol, t.type, t.mode, t.entryPrice, t.entryTime, t.amount, t.leverage || 10, t.sl, t.initialSl, t.tp1, t.tp2, t.status, 
      t.exitPrice || null, t.exitTime || null, t.pnl || 0, t.pnlPerc || 0, t.score, t.isBreakeven ? 1 : 0
    ], (err) => {
      if (err) console.error('[DB ERROR] Failed to save trade:', err.message);
    });
  });
}

export function loadClosedTrades(): Promise<Trade[]> {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.all(`SELECT * FROM trades WHERE status = 'CLOSED' ORDER BY exitTime DESC`, [], (err, rows) => {
        if (err) {
           console.error('[DB ERROR]', err);
           resolve([]);
        } else {
           const trades: Trade[] = rows.map((r: any) => ({
             ...r,
             isBreakeven: r.isBreakeven === 1
           }));
           resolve(trades);
        }
      });
    });
  });
}

export function loadActiveTrades(): Promise<Trade[]> {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.all(`SELECT * FROM trades WHERE status = 'OPEN'`, [], (err, rows) => {
        if (err) {
           console.error('[DB ERROR]', err);
           resolve([]);
        } else {
           const trades: Trade[] = rows.map((r: any) => ({
             ...r,
             isBreakeven: r.isBreakeven === 1
           }));
           resolve(trades);
        }
      });
    });
  });
}

export function saveSettingsToDB(settings: any) {
  db.run(`
    INSERT INTO settings (
      id, portfolioSize, riskPerTradePerc, maxConcurrentTrades, strictMode, useSmartExit,
      useSmartControl, smartTpUsd, smartTrailingStartUsd, smartTimeDecayMinutes, smartTrailingThresholdPerc, smartMomentumStallMinutes,
      useKineticEngine, beastMode,
      strictMinVolume, strictMinRvol, strictMaxRisk, strictMinScore,
      strictBtcAlignment, strictRsiFilter, strictRetest, strictFastBreakevenPerc, leverage,
      strictRsiHigh, strictRsiLow, strictRetestPullbackPerc, strictBreakoutDistancePerc
    )
    VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      portfolioSize=excluded.portfolioSize,
      riskPerTradePerc=excluded.riskPerTradePerc,
      maxConcurrentTrades=excluded.maxConcurrentTrades,
      strictMode=excluded.strictMode,
      useSmartExit=excluded.useSmartExit,
      useSmartControl=excluded.useSmartControl,
      smartTpUsd=excluded.smartTpUsd,
      smartTrailingStartUsd=excluded.smartTrailingStartUsd,
      smartTimeDecayMinutes=excluded.smartTimeDecayMinutes,
      smartTrailingThresholdPerc=excluded.smartTrailingThresholdPerc,
      smartMomentumStallMinutes=excluded.smartMomentumStallMinutes,
      useKineticEngine=excluded.useKineticEngine,
      beastMode=excluded.beastMode,
      strictMinVolume=excluded.strictMinVolume,
      strictMinRvol=excluded.strictMinRvol,
      strictMaxRisk=excluded.strictMaxRisk,
      strictMinScore=excluded.strictMinScore,
      strictBtcAlignment=excluded.strictBtcAlignment,
      strictRsiFilter=excluded.strictRsiFilter,
      strictRetest=excluded.strictRetest,
      strictFastBreakevenPerc=excluded.strictFastBreakevenPerc,
      leverage=excluded.leverage,
      strictRsiHigh=excluded.strictRsiHigh,
      strictRsiLow=excluded.strictRsiLow,
      strictRetestPullbackPerc=excluded.strictRetestPullbackPerc,
      strictBreakoutDistancePerc=excluded.strictBreakoutDistancePerc
  `, [
    settings.portfolioSize, settings.riskPerTradePerc, settings.maxConcurrentTrades, settings.strictMode ? 1 : 0, settings.useSmartExit ? 1 : 0,
    settings.useSmartControl ? 1 : 0, settings.smartTpUsd ?? 1.0, settings.smartTrailingStartUsd ?? 0.4, settings.smartTimeDecayMinutes ?? 5,
    settings.smartTrailingThresholdPerc ?? 0.3, settings.smartMomentumStallMinutes ?? 2.5,
    settings.useKineticEngine ? 1 : 0,
    settings.beastMode ? 1 : 0,
    settings.strictMinVolume ?? 5000000, 
    settings.strictMinRvol ?? 3.0, 
    settings.strictMaxRisk ?? 1.0, 
    settings.strictMinScore ?? 6,
    settings.strictBtcAlignment ? 1 : 0, 
    settings.strictRsiFilter ? 1 : 0, 
    settings.strictRetest ? 1 : 0, 
    settings.strictFastBreakevenPerc ?? 0.75,
    settings.leverage ?? 10,
    settings.strictRsiHigh ?? 75,
    settings.strictRsiLow ?? 25,
    settings.strictRetestPullbackPerc ?? 3.0,
    settings.strictBreakoutDistancePerc ?? 0.5
  ]);
}

export function loadSettingsFromDB(): Promise<any> {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM settings WHERE id = 'default'`, (err, row: any) => {
      if (err || !row) resolve(null);
      else {
        row.strictMode = row.strictMode === 1;
        row.useSmartExit = row.useSmartExit === 1;
        row.useSmartControl = row.useSmartControl === 1;
        row.useKineticEngine = row.useKineticEngine === 1;
        row.beastMode = row.beastMode === 1;
        row.strictBtcAlignment = row.strictBtcAlignment === 1;
        row.strictRsiFilter = row.strictRsiFilter === 1;
        row.strictRetest = row.strictRetest === 1;
        resolve(row);
      }
    });
  });
}

