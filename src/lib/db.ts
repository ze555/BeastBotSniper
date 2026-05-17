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
          isBreakeven INTEGER DEFAULT 0,
          source TEXT DEFAULT 'CORE'
        )
      `);
      
      db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          id TEXT PRIMARY KEY,
          portfolioSize REAL NOT NULL,
          riskPerTradePerc REAL NOT NULL,
          maxConcurrentTrades INTEGER NOT NULL,
          leverage REAL DEFAULT 10,
          tradingFeeRate REAL DEFAULT 0.001,
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
          kineticUseOpenInterest INTEGER DEFAULT 1,
          kineticUseVolume INTEGER DEFAULT 1,
          kineticSensitivty REAL DEFAULT 1.0,
          beastMode INTEGER DEFAULT 0,
          strategyAdxThreshold REAL DEFAULT 25,
          strategyAtrMultiplier REAL DEFAULT 1.5,
          strategyMinConfidence REAL DEFAULT 0.6,
          strategyRvolThreshold REAL DEFAULT 1.5,
          useStrategyTrendFilter INTEGER DEFAULT 1,
          useStrategyVolatilityRule INTEGER DEFAULT 1,
          useStrategyConfidenceGate INTEGER DEFAULT 1,
          useStrategyMomentumRule INTEGER DEFAULT 1,
          dynamicSafetyExit INTEGER DEFAULT 1,
          layerGlobalContextEnabled INTEGER DEFAULT 1,
          layerRegimeEnabled INTEGER DEFAULT 1,
          layerBiasEnabled INTEGER DEFAULT 1,
          layerLiquidityEnabled INTEGER DEFAULT 1,
          layerMomentumEnabled INTEGER DEFAULT 1,
          layerConfidenceEnabled INTEGER DEFAULT 1,
          layerRiskEnabled INTEGER DEFAULT 1,
          binanceApiKey TEXT,
          binanceSecretKey TEXT,
          tradingMode TEXT DEFAULT 'PAPER',
          quantumBbPeriod REAL DEFAULT 20,
          quantumBbMultiplier REAL DEFAULT 1.8,
          quantumVolThreshold REAL DEFAULT 1.02,
          quantumMomentumVol REAL DEFAULT 1.5,
          inverseTrailingEnabled INTEGER DEFAULT 0,
          inverseTrailingSensitivity REAL DEFAULT 0.05
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
        "kineticUseOpenInterest INTEGER DEFAULT 1",
        "kineticUseVolume INTEGER DEFAULT 1",
        "kineticSensitivty REAL DEFAULT 1.0",
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
        "strictBreakoutDistancePerc REAL DEFAULT 0.5",
        "strategyAdxThreshold REAL DEFAULT 25",
        "strategyAtrMultiplier REAL DEFAULT 1.5",
        "strategyMinConfidence REAL DEFAULT 0.6",
        "strategyRvolThreshold REAL DEFAULT 1.5",
        "useStrategyTrendFilter INTEGER DEFAULT 1",
        "useStrategyVolatilityRule INTEGER DEFAULT 1",
        "useStrategyConfidenceGate INTEGER DEFAULT 1",
        "useStrategyMomentumRule INTEGER DEFAULT 1",
        "dynamicSafetyExit INTEGER DEFAULT 1",
        "layerGlobalContextEnabled INTEGER DEFAULT 1",
        "layerRegimeEnabled INTEGER DEFAULT 1",
        "layerBiasEnabled INTEGER DEFAULT 1",
        "layerLiquidityEnabled INTEGER DEFAULT 1",
        "layerMomentumEnabled INTEGER DEFAULT 1",
        "layerConfidenceEnabled INTEGER DEFAULT 1",
        "layerRiskEnabled INTEGER DEFAULT 1",
        "quantumBbPeriod REAL DEFAULT 20",
        "quantumBbMultiplier REAL DEFAULT 1.8",
        "quantumVolThreshold REAL DEFAULT 1.02",
        "quantumMomentumVol REAL DEFAULT 1.5",
        "tradingFeeRate REAL DEFAULT 0.001",
        "binanceApiKey TEXT",
        "binanceSecretKey TEXT",
        "tradingMode TEXT DEFAULT 'PAPER'",
        "inverseTrailingEnabled INTEGER DEFAULT 0",
        "inverseTrailingSensitivity REAL DEFAULT 0.05"
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
      db.run(`ALTER TABLE trades ADD COLUMN source TEXT DEFAULT 'CORE'`, () => {});
    });
  });
};

export function saveTrade(t: Trade) {
  const query = `
    INSERT INTO trades (id, symbol, type, mode, entryPrice, entryTime, amount, leverage, sl, initialSl, tp1, tp2, status, exitPrice, exitTime, pnl, pnlPerc, score, isBreakeven, source) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET 
      sl=excluded.sl, 
      status=excluded.status, 
      exitPrice=excluded.exitPrice, 
      exitTime=excluded.exitTime, 
      pnl=excluded.pnl, 
      pnlPerc=excluded.pnlPerc, 
      isBreakeven=excluded.isBreakeven,
      source=excluded.source
  `;
  
  db.serialize(() => {
    db.run(query, [
      t.id, t.symbol, t.type, t.mode, t.entryPrice, t.entryTime, t.amount, t.leverage || 10, t.sl, t.initialSl, t.tp1, t.tp2, t.status, 
      t.exitPrice || null, t.exitTime || null, t.pnl || 0, t.pnlPerc || 0, t.score, t.isBreakeven ? 1 : 0, t.source || 'CORE'
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
      id, portfolioSize, riskPerTradePerc, maxConcurrentTrades, leverage, tradingFeeRate, strictMode,
      strictMinVolume, strictMinRvol, strictMaxRisk, strictMinScore,
      strictBtcAlignment, strictRsiFilter, strictRetest, strictFastBreakevenPerc,
      strictRsiHigh, strictRsiLow, strictRetestPullbackPerc, strictBreakoutDistancePerc,
      useSmartExit, useSmartControl, smartTpUsd, smartTrailingStartUsd, smartTimeDecayMinutes, 
      smartTrailingThresholdPerc, smartMomentumStallMinutes,
      useKineticEngine, kineticUseOpenInterest, kineticUseVolume, kineticSensitivty, 
      beastMode,
      strategyAdxThreshold, strategyAtrMultiplier, strategyMinConfidence, strategyRvolThreshold,
      useStrategyTrendFilter, useStrategyVolatilityRule, useStrategyConfidenceGate, useStrategyMomentumRule,
      dynamicSafetyExit,
      layerGlobalContextEnabled, layerRegimeEnabled, layerBiasEnabled, layerLiquidityEnabled, layerMomentumEnabled, layerConfidenceEnabled, layerRiskEnabled,
      binanceApiKey, binanceSecretKey, tradingMode,
      quantumBbPeriod, quantumBbMultiplier, quantumVolThreshold, quantumMomentumVol,
      inverseTrailingEnabled, inverseTrailingSensitivity
    )
    VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      portfolioSize=excluded.portfolioSize,
      riskPerTradePerc=excluded.riskPerTradePerc,
      maxConcurrentTrades=excluded.maxConcurrentTrades,
      leverage=excluded.leverage,
      tradingFeeRate=excluded.tradingFeeRate,
      strictMode=excluded.strictMode,
      strictMinVolume=excluded.strictMinVolume,
      strictMinRvol=excluded.strictMinRvol,
      strictMaxRisk=excluded.strictMaxRisk,
      strictMinScore=excluded.strictMinScore,
      strictBtcAlignment=excluded.strictBtcAlignment,
      strictRsiFilter=excluded.strictRsiFilter,
      strictRetest=excluded.strictRetest,
      strictFastBreakevenPerc=excluded.strictFastBreakevenPerc,
      strictRsiHigh=excluded.strictRsiHigh,
      strictRsiLow=excluded.strictRsiLow,
      strictRetestPullbackPerc=excluded.strictRetestPullbackPerc,
      strictBreakoutDistancePerc=excluded.strictBreakoutDistancePerc,
      useSmartExit=excluded.useSmartExit,
      useSmartControl=excluded.useSmartControl,
      smartTpUsd=excluded.smartTpUsd,
      smartTrailingStartUsd=excluded.smartTrailingStartUsd,
      smartTimeDecayMinutes=excluded.smartTimeDecayMinutes,
      smartTrailingThresholdPerc=excluded.smartTrailingThresholdPerc,
      smartMomentumStallMinutes=excluded.smartMomentumStallMinutes,
      useKineticEngine=excluded.useKineticEngine,
      kineticUseOpenInterest=excluded.kineticUseOpenInterest,
      kineticUseVolume=excluded.kineticUseVolume,
      kineticSensitivty=excluded.kineticSensitivty,
      beastMode=excluded.beastMode,
      strategyAdxThreshold=excluded.strategyAdxThreshold,
      strategyAtrMultiplier=excluded.strategyAtrMultiplier,
      strategyMinConfidence=excluded.strategyMinConfidence,
      strategyRvolThreshold=excluded.strategyRvolThreshold,
      useStrategyTrendFilter=excluded.useStrategyTrendFilter,
      useStrategyVolatilityRule=excluded.useStrategyVolatilityRule,
      useStrategyConfidenceGate=excluded.useStrategyConfidenceGate,
      useStrategyMomentumRule=excluded.useStrategyMomentumRule,
      dynamicSafetyExit=excluded.dynamicSafetyExit,
      layerGlobalContextEnabled=excluded.layerGlobalContextEnabled,
      layerRegimeEnabled=excluded.layerRegimeEnabled,
      layerBiasEnabled=excluded.layerBiasEnabled,
      layerLiquidityEnabled=excluded.layerLiquidityEnabled,
      layerMomentumEnabled=excluded.layerMomentumEnabled,
      layerConfidenceEnabled=excluded.layerConfidenceEnabled,
      layerRiskEnabled=excluded.layerRiskEnabled,
      binanceApiKey=excluded.binanceApiKey,
      binanceSecretKey=excluded.binanceSecretKey,
      tradingMode=excluded.tradingMode,
      quantumBbPeriod=excluded.quantumBbPeriod,
      quantumBbMultiplier=excluded.quantumBbMultiplier,
      quantumVolThreshold=excluded.quantumVolThreshold,
      quantumMomentumVol=excluded.quantumMomentumVol,
      inverseTrailingEnabled=excluded.inverseTrailingEnabled,
      inverseTrailingSensitivity=excluded.inverseTrailingSensitivity
  `, [
    settings.portfolioSize, settings.riskPerTradePerc, settings.maxConcurrentTrades, settings.leverage ?? 10, settings.tradingFeeRate ?? 0.001, settings.strictMode ? 1 : 0,
    settings.strictMinVolume ?? 5000000, settings.strictMinRvol ?? 3.0, settings.strictMaxRisk ?? 1.0, settings.strictMinScore ?? 6,
    settings.strictBtcAlignment ? 1 : 0, settings.strictRsiFilter ? 1 : 0, settings.strictRetest ? 1 : 0, settings.strictFastBreakevenPerc ?? 0.75,
    settings.strictRsiHigh ?? 75, settings.strictRsiLow ?? 25, settings.strictRetestPullbackPerc ?? 3.0, settings.strictBreakoutDistancePerc ?? 0.5,
    settings.useSmartExit ? 1 : 0, settings.useSmartControl ? 1 : 0, settings.smartTpUsd ?? 1.0, settings.smartTrailingStartUsd ?? 0.4, settings.smartTimeDecayMinutes ?? 5,
    settings.smartTrailingThresholdPerc ?? 0.3, settings.smartMomentumStallMinutes ?? 2.5,
    settings.useKineticEngine ? 1 : 0, settings.kineticUseOpenInterest ? 1 : 0, settings.kineticUseVolume ? 1 : 0, settings.kineticSensitivty ?? 1.0,
    settings.beastMode ? 1 : 0,
    settings.strategyAdxThreshold ?? 25, settings.strategyAtrMultiplier ?? 1.5, settings.strategyMinConfidence ?? 0.6, settings.strategyRvolThreshold ?? 1.5,
    settings.useStrategyTrendFilter ? 1 : 0, settings.useStrategyVolatilityRule ? 1 : 0, settings.useStrategyConfidenceGate ? 1 : 0, settings.useStrategyMomentumRule ? 1 : 0,
    settings.dynamicSafetyExit ? 1 : 0,
    settings.layerGlobalContextEnabled ? 1 : 0, settings.layerRegimeEnabled ? 1 : 0, settings.layerBiasEnabled ? 1 : 0,
    settings.layerLiquidityEnabled ? 1 : 0, settings.layerMomentumEnabled ? 1 : 0, settings.layerConfidenceEnabled ? 1 : 0, settings.layerRiskEnabled ? 1 : 0,
    settings.binanceApiKey ?? null, settings.binanceSecretKey ?? null, settings.tradingMode ?? 'PAPER',
    settings.quantumBbPeriod ?? 20, settings.quantumBbMultiplier ?? 1.8, settings.quantumVolThreshold ?? 1.02, settings.quantumMomentumVol ?? 1.5,
    settings.inverseTrailingEnabled ? 1 : 0, settings.inverseTrailingSensitivity ?? 0.05
  ], (err) => {
    if (err) console.error('[DB ERROR] Failed to save settings:', err.message);
  });
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
        row.kineticUseOpenInterest = row.kineticUseOpenInterest === 1;
        row.kineticUseVolume = row.kineticUseVolume === 1;
        row.useStrategyTrendFilter = row.useStrategyTrendFilter !== 0; // Default to true if not 0
        row.useStrategyVolatilityRule = row.useStrategyVolatilityRule !== 0;
        row.useStrategyConfidenceGate = row.useStrategyConfidenceGate !== 0;
        row.useStrategyMomentumRule = row.useStrategyMomentumRule !== 0;
        row.dynamicSafetyExit = row.dynamicSafetyExit !== 0;
        row.layerGlobalContextEnabled = row.layerGlobalContextEnabled !== 0;
        row.layerRegimeEnabled = row.layerRegimeEnabled !== 0;
        row.layerBiasEnabled = row.layerBiasEnabled !== 0;
        row.layerLiquidityEnabled = row.layerLiquidityEnabled !== 0;
        row.layerMomentumEnabled = row.layerMomentumEnabled !== 0;
        row.layerConfidenceEnabled = row.layerConfidenceEnabled !== 0;
        row.layerRiskEnabled = row.layerRiskEnabled !== 0;
        row.binanceApiKey = row.binanceApiKey || null;
        row.binanceSecretKey = row.binanceSecretKey || null;
        row.tradingMode = row.tradingMode || 'PAPER';
        row.inverseTrailingEnabled = row.inverseTrailingEnabled === 1;
        resolve(row);
      }
    });
  });
}

export function clearTrades(): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM trades`, (err) => {
      if (err) {
        console.error('[DB ERROR] Failed to clear trades:', err.message);
        reject(err);
      } else {
        console.log('[DB] All trades cleared successfully.');
        resolve();
      }
    });
  });
}

export function clearAllData(): Promise<void> {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`DELETE FROM trades`);
      db.run(`DELETE FROM settings`, (err) => {
        if (err) {
          console.error('[DB ERROR] Failed to clear all data:', err.message);
          reject(err);
        } else {
          console.log('[DB] All database data cleared successfully.');
          resolve();
        }
      });
    });
  });
}

