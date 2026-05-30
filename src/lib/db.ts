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
          source TEXT DEFAULT 'CORE',
          exitReason TEXT
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
          quantumTakerLongThresh REAL DEFAULT 1.01,
          quantumTakerShortThresh REAL DEFAULT 0.99,
          quantumMomentumLongThresh REAL DEFAULT 1.15,
          quantumMomentumShortThresh REAL DEFAULT 0.85,
          quantumTpScale REAL DEFAULT 1.0,
          quantumSlScale REAL DEFAULT 1.0,
          quantumUseReversion INTEGER DEFAULT 1,
          quantumUseMomentum INTEGER DEFAULT 1,
          inverseTrailingEnabled INTEGER DEFAULT 0,
          inverseTrailingSensitivity REAL DEFAULT 0.05,
          isLongTerm INTEGER DEFAULT 0,
          quantumBeastMode INTEGER DEFAULT 0,
          quantumSmartExit INTEGER DEFAULT 0,
          quantumWiseEntry INTEGER DEFAULT 0,
          quantumBeastAggression REAL DEFAULT 1.5,
          quantumSmartExitAggression REAL DEFAULT 0.8,
          quantumWiseEntryThreshold REAL DEFAULT 1.05,
          minPositionSizePerc REAL DEFAULT 20,
          isNightmareMode INTEGER DEFAULT 0,
          marketPanicThreshold REAL DEFAULT 3.0,
          useWiseExit INTEGER DEFAULT 0,
          useWiseEntry INTEGER DEFAULT 0,
          useSlyFox INTEGER DEFAULT 0,
          beastConfirmWithSMC INTEGER DEFAULT 0,
          beastConfirmWithVolume INTEGER DEFAULT 0,
          beastMinRvol REAL DEFAULT 1.2,
          beastInstitutionalStrength REAL DEFAULT 0.4,
          fastExitEnabled INTEGER DEFAULT 0,
          fastExitPerc REAL DEFAULT 0.5,
          useFusionEngine INTEGER DEFAULT 0,
           useCreativeEngine INTEGER DEFAULT 0,
          disableConsecutiveLoss INTEGER DEFAULT 0,
          fusionSensitivity REAL DEFAULT 1.0,
          fusionWeightOi REAL DEFAULT 0.25,
          fusionWeightFunding REAL DEFAULT 0.25,
          fusionWeightVol REAL DEFAULT 0.25,
          fusionWeightInst REAL DEFAULT 0.25,
          fusionMinScore REAL DEFAULT 70,
          exitUseRsiCheck INTEGER DEFAULT 1,
          overrideAllWithAdaptive INTEGER DEFAULT 0, useSteelEngine INTEGER DEFAULT 0, steelMinProbability REAL DEFAULT 65, steelInfluenceCreative REAL DEFAULT 0.35, steelInfluenceQuantum REAL DEFAULT 0.35, steelInfluenceFusion REAL DEFAULT 0.30, steelTakerWeight REAL DEFAULT 1.5, steelOiWeight REAL DEFAULT 1.2, steelFundingWeight REAL DEFAULT 1.0, steelLiquidityWeight REAL DEFAULT 1.3, steelHtfTrendWeight REAL DEFAULT 1.4, steelAdaptiveSlTp INTEGER DEFAULT 1,
          creativeUseAdaptiveExit INTEGER DEFAULT 0,
          useTawleefaEngine INTEGER DEFAULT 0,
          activeTawleefaJson TEXT DEFAULT null,
          useFierceExitEngine INTEGER DEFAULT 0,
          fierceTakeProfitValue REAL DEFAULT 1.5,
          fierceTakeProfitMode TEXT DEFAULT 'FUSION_CASCADE'
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
        "inverseTrailingSensitivity REAL DEFAULT 0.05",
        "quantumTakerLongThresh REAL DEFAULT 1.01",
        "quantumTakerShortThresh REAL DEFAULT 0.99",
        "quantumMomentumLongThresh REAL DEFAULT 1.15",
        "quantumMomentumShortThresh REAL DEFAULT 0.85",
        "quantumTpScale REAL DEFAULT 1.0",
        "quantumSlScale REAL DEFAULT 1.0",
        "quantumUseReversion INTEGER DEFAULT 1",
        "quantumUseMomentum INTEGER DEFAULT 1",
        "isLongTerm INTEGER DEFAULT 0",
        "isNightmareMode INTEGER DEFAULT 0",
        "marketPanicThreshold REAL DEFAULT 3.0",
        "quantumBeastMode INTEGER DEFAULT 0",
        "quantumSmartExit INTEGER DEFAULT 0",
        "quantumWiseEntry INTEGER DEFAULT 0",
        "quantumBeastAggression REAL DEFAULT 1.5",
        "quantumSmartExitAggression REAL DEFAULT 0.8",
        "quantumWiseEntryThreshold REAL DEFAULT 1.05",
        "minPositionSizePerc REAL DEFAULT 20",
        "useWiseExit INTEGER DEFAULT 0",
        "useWiseEntry INTEGER DEFAULT 0",
        "useSlyFox INTEGER DEFAULT 0",
        "beastConfirmWithSMC INTEGER DEFAULT 0",
        "beastConfirmWithVolume INTEGER DEFAULT 0",
        "beastMinRvol REAL DEFAULT 1.2",
        "beastInstitutionalStrength REAL DEFAULT 0.4",
        "fastExitEnabled INTEGER DEFAULT 0",
        "fastExitPerc REAL DEFAULT 0.5",
        "useFusionEngine INTEGER DEFAULT 0",
         "useCreativeEngine INTEGER DEFAULT 0",
         "disableConsecutiveLoss INTEGER DEFAULT 0",
        "fusionSensitivity REAL DEFAULT 1.0",
        "fusionWeightOi REAL DEFAULT 0.25",
        "fusionWeightFunding REAL DEFAULT 0.25",
        "fusionWeightVol REAL DEFAULT 0.25",
        "fusionWeightInst REAL DEFAULT 0.25",
        "fusionMinScore REAL DEFAULT 70",
        "exitUseRsiCheck INTEGER DEFAULT 1",
        "overrideAllWithAdaptive INTEGER DEFAULT 0",
        "creativeUseAdaptiveExit INTEGER DEFAULT 0", "useSteelEngine INTEGER DEFAULT 0", "steelMinProbability REAL DEFAULT 65", "steelInfluenceCreative REAL DEFAULT 0.35", "steelInfluenceQuantum REAL DEFAULT 0.35", "steelInfluenceFusion REAL DEFAULT 0.30", "steelTakerWeight REAL DEFAULT 1.5", "steelOiWeight REAL DEFAULT 1.2", "steelFundingWeight REAL DEFAULT 1.0", "steelLiquidityWeight REAL DEFAULT 1.3", "steelHtfTrendWeight REAL DEFAULT 1.4", "steelAdaptiveSlTp INTEGER DEFAULT 1",
        "steelMaxLossMode INTEGER DEFAULT 0",
        "steelReboundSensitivity REAL DEFAULT 0.15",
        "steelMinProfitTake REAL DEFAULT 0.05",
        "useTawleefaEngine INTEGER DEFAULT 0",
        "activeTawleefaJson TEXT DEFAULT null",
        "useFierceExitEngine INTEGER DEFAULT 0",
        "fierceTakeProfitValue REAL DEFAULT 1.5",
        "fierceTakeProfitMode TEXT DEFAULT 'FUSION_CASCADE'"
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
      db.run(`ALTER TABLE trades ADD COLUMN adaptiveHistory TEXT`, () => {});
      db.run(`ALTER TABLE trades ADD COLUMN exitReason TEXT`, () => {});
    });
  });
};

export function saveTrade(t: Trade) {
  const query = `
    INSERT INTO trades (id, symbol, type, mode, entryPrice, entryTime, amount, leverage, sl, initialSl, tp1, tp2, status, exitPrice, exitTime, pnl, pnlPerc, score, isBreakeven, source, adaptiveHistory, exitReason) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET 
      sl=excluded.sl, 
      status=excluded.status, 
      exitPrice=excluded.exitPrice, 
      exitTime=excluded.exitTime, 
      pnl=excluded.pnl, 
      pnlPerc=excluded.pnlPerc, 
      isBreakeven=excluded.isBreakeven,
      source=excluded.source,
      adaptiveHistory=excluded.adaptiveHistory,
      exitReason=excluded.exitReason
  `;
  
  const adaptiveHistoryStr = JSON.stringify(t.adaptiveHistoryLogs || []);
  
  db.serialize(() => {
    db.run(query, [
      t.id, t.symbol, t.type, t.mode, t.entryPrice, t.entryTime, t.amount, t.leverage || 10, t.sl, t.initialSl, t.tp1, t.tp2, t.status, 
      t.exitPrice || null, t.exitTime || null, t.pnl || 0, t.pnlPerc || 0, t.score, t.isBreakeven ? 1 : 0, t.source || 'CORE', adaptiveHistoryStr, t.exitReason || null
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
           const trades: Trade[] = rows.map((r: any) => {
             let adaptiveHistoryLogs: any[] = [];
             try {
               adaptiveHistoryLogs = r.adaptiveHistory ? JSON.parse(r.adaptiveHistory) : [];
             } catch (e) {
               console.error('[DB ERROR] Failed to parse adaptivehistory for closed trade:', r.id, e);
             }
             return {
               ...r,
               isBreakeven: r.isBreakeven === 1,
               adaptiveHistoryLogs
             };
           });
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
           const trades: Trade[] = rows.map((r: any) => {
             let adaptiveHistoryLogs: any[] = [];
             try {
               adaptiveHistoryLogs = r.adaptiveHistory ? JSON.parse(r.adaptiveHistory) : [];
             } catch (e) {
               console.error('[DB ERROR] Failed to parse adaptivehistory for active trade:', r.id, e);
             }
             return {
               ...r,
               isBreakeven: r.isBreakeven === 1,
               adaptiveHistoryLogs
             };
           });
           resolve(trades);
         }
      });
    });
  });
}

export function saveSettingsToDB(settings: any) {
  const query = `
    INSERT INTO settings (
      id, portfolioSize, riskPerTradePerc, maxConcurrentTrades, leverage, tradingFeeRate, strictMode,
      strictMinVolume, strictMinRvol, strictMaxRisk, strictMinScore,
      strictBtcAlignment, strictRsiFilter, strictRetest, strictFastBreakevenPerc,
      strictRsiHigh, strictRsiLow, strictRetestPullbackPerc, strictBreakoutDistancePerc,
      useSmartExit, useWiseExit, useWiseEntry, useSlyFox, useSmartControl, smartTpUsd, smartTrailingStartUsd, smartTimeDecayMinutes, 
      smartTrailingThresholdPerc, smartMomentumStallMinutes,
      useKineticEngine, kineticUseOpenInterest, kineticUseVolume, kineticSensitivty, 
      beastMode, beastConfirmWithSMC, beastConfirmWithVolume, beastMinRvol, beastInstitutionalStrength,
      fastExitEnabled, fastExitPerc,
      strategyAdxThreshold, strategyAtrMultiplier, strategyMinConfidence, strategyRvolThreshold,
      useStrategyTrendFilter, useStrategyVolatilityRule, useStrategyConfidenceGate, useStrategyMomentumRule,
      dynamicSafetyExit,
      layerGlobalContextEnabled, layerRegimeEnabled, layerBiasEnabled, 
      layerLiquidityEnabled, layerMomentumEnabled, layerConfidenceEnabled, layerRiskEnabled,
      binanceApiKey, binanceSecretKey, tradingMode,
      quantumBbPeriod, quantumBbMultiplier, quantumVolThreshold, quantumMomentumVol,
      quantumTakerLongThresh, quantumTakerShortThresh, quantumMomentumLongThresh, quantumMomentumShortThresh,
      quantumTpScale, quantumSlScale, quantumUseReversion, quantumUseMomentum,
      quantumBeastMode, quantumSmartExit, quantumWiseEntry,
      quantumBeastAggression, quantumSmartExitAggression, quantumWiseEntryThreshold,
      inverseTrailingEnabled, inverseTrailingSensitivity, isLongTerm, minPositionSizePerc,
      isNightmareMode, marketPanicThreshold,
      useFusionEngine, fusionSensitivity, fusionWeightOi, fusionWeightFunding, fusionWeightVol, fusionWeightInst, fusionMinScore, exitUseRsiCheck, overrideAllWithAdaptive, useCreativeEngine, creativeUseAdaptiveExit, disableConsecutiveLoss,
      useSteelEngine, steelMinProbability, steelInfluenceCreative, steelInfluenceQuantum, steelInfluenceFusion, steelTakerWeight, steelOiWeight, steelFundingWeight, steelLiquidityWeight, steelHtfTrendWeight, steelAdaptiveSlTp, steelMaxLossMode, steelReboundSensitivity, steelMinProfitTake,
      useTawleefaEngine, activeTawleefaJson, useFierceExitEngine, fierceTakeProfitValue, fierceTakeProfitMode
    )
    VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      useWiseExit=excluded.useWiseExit,
      useWiseEntry=excluded.useWiseEntry,
      useSlyFox=excluded.useSlyFox,
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
      beastConfirmWithSMC=excluded.beastConfirmWithSMC,
      beastConfirmWithVolume=excluded.beastConfirmWithVolume,
      beastMinRvol=excluded.beastMinRvol,
      beastInstitutionalStrength=excluded.beastInstitutionalStrength,
      fastExitEnabled=excluded.fastExitEnabled,
      fastExitPerc=excluded.fastExitPerc,
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
      quantumTakerLongThresh=excluded.quantumTakerLongThresh,
      quantumTakerShortThresh=excluded.quantumTakerShortThresh,
      quantumMomentumLongThresh=excluded.quantumMomentumLongThresh,
      quantumMomentumShortThresh=excluded.quantumMomentumShortThresh,
      quantumTpScale=excluded.quantumTpScale,
      quantumSlScale=excluded.quantumSlScale,
      quantumUseReversion=excluded.quantumUseReversion,
      quantumUseMomentum=excluded.quantumUseMomentum,
      quantumBeastMode=excluded.quantumBeastMode,
      quantumSmartExit=excluded.quantumSmartExit,
      quantumWiseEntry=excluded.quantumWiseEntry,
      quantumBeastAggression=excluded.quantumBeastAggression,
      quantumSmartExitAggression=excluded.quantumSmartExitAggression,
      quantumWiseEntryThreshold=excluded.quantumWiseEntryThreshold,
      inverseTrailingEnabled=excluded.inverseTrailingEnabled,
      inverseTrailingSensitivity=excluded.inverseTrailingSensitivity,
      isLongTerm=excluded.isLongTerm,
      minPositionSizePerc=excluded.minPositionSizePerc,
      isNightmareMode=excluded.isNightmareMode,
      marketPanicThreshold=excluded.marketPanicThreshold,
      useFusionEngine=excluded.useFusionEngine,
      fusionSensitivity=excluded.fusionSensitivity,
      fusionWeightOi=excluded.fusionWeightOi,
      fusionWeightFunding=excluded.fusionWeightFunding,
      fusionWeightVol=excluded.fusionWeightVol,
      fusionWeightInst=excluded.fusionWeightInst,
      fusionMinScore=excluded.fusionMinScore,
      exitUseRsiCheck=excluded.exitUseRsiCheck,
      overrideAllWithAdaptive=excluded.overrideAllWithAdaptive,
      useCreativeEngine=excluded.useCreativeEngine,
      creativeUseAdaptiveExit=excluded.creativeUseAdaptiveExit,
      disableConsecutiveLoss=excluded.disableConsecutiveLoss,
      useSteelEngine=excluded.useSteelEngine,
      steelMinProbability=excluded.steelMinProbability,
      steelInfluenceCreative=excluded.steelInfluenceCreative,
      steelInfluenceQuantum=excluded.steelInfluenceQuantum,
      steelInfluenceFusion=excluded.steelInfluenceFusion,
      steelTakerWeight=excluded.steelTakerWeight,
      steelOiWeight=excluded.steelOiWeight,
      steelFundingWeight=excluded.steelFundingWeight,
      steelLiquidityWeight=excluded.steelLiquidityWeight,
      steelHtfTrendWeight=excluded.steelHtfTrendWeight,
      steelAdaptiveSlTp=excluded.steelAdaptiveSlTp,
      steelMaxLossMode=excluded.steelMaxLossMode,
      steelReboundSensitivity=excluded.steelReboundSensitivity,
      steelMinProfitTake=excluded.steelMinProfitTake,
      useTawleefaEngine=excluded.useTawleefaEngine,
      activeTawleefaJson=excluded.activeTawleefaJson,
      useFierceExitEngine=excluded.useFierceExitEngine,
      fierceTakeProfitValue=excluded.fierceTakeProfitValue,
      fierceTakeProfitMode=excluded.fierceTakeProfitMode
  `;

  const values = [
    settings.portfolioSize, settings.riskPerTradePerc, settings.maxConcurrentTrades, settings.leverage ?? 10, settings.tradingFeeRate ?? 0.001, settings.strictMode ? 1 : 0,
    settings.strictMinVolume ?? 5000000, settings.strictMinRvol ?? 3.0, settings.strictMaxRisk ?? 1.0, settings.strictMinScore ?? 6,
    settings.strictBtcAlignment ? 1 : 0, settings.strictRsiFilter ? 1 : 0, settings.strictRetest ? 1 : 0, settings.strictFastBreakevenPerc ?? 0.75,
    settings.strictRsiHigh ?? 75, settings.strictRsiLow ?? 25, settings.strictRetestPullbackPerc ?? 3.0, settings.strictBreakoutDistancePerc ?? 0.5,
    settings.useSmartExit ? 1 : 0, settings.useWiseExit ? 1 : 0, settings.useWiseEntry ? 1 : 0, settings.useSlyFox ? 1 : 0, settings.useSmartControl ? 1 : 0, settings.smartTpUsd ?? 1.0, settings.smartTrailingStartUsd ?? 0.4, settings.smartTimeDecayMinutes ?? 5, 
    settings.smartTrailingThresholdPerc ?? 0.3, settings.smartMomentumStallMinutes ?? 2.5,
    settings.useKineticEngine ? 1 : 0, settings.kineticUseOpenInterest ? 1 : 0, settings.kineticUseVolume ? 1 : 0, settings.kineticSensitivty ?? 1.0, 
    settings.beastMode ? 1 : 0, settings.beastConfirmWithSMC ? 1 : 0, settings.beastConfirmWithVolume ? 1 : 0, settings.beastMinRvol ?? 1.2, settings.beastInstitutionalStrength ?? 0.4,
    settings.fastExitEnabled ? 1 : 0, settings.fastExitPerc ?? 0.5,
    settings.strategyAdxThreshold ?? 25, settings.strategyAtrMultiplier ?? 1.5, settings.strategyMinConfidence ?? 0.6, settings.strategyRvolThreshold ?? 1.5,
    settings.useStrategyTrendFilter ? 1 : 0, settings.useStrategyVolatilityRule ? 1 : 0, settings.useStrategyConfidenceGate ? 1 : 0, settings.useStrategyMomentumRule ? 1 : 0,
    settings.dynamicSafetyExit ? 1 : 0,
    settings.layerGlobalContextEnabled ? 1 : 0, settings.layerRegimeEnabled ? 1 : 0, settings.layerBiasEnabled ? 1 : 0, 
    settings.layerLiquidityEnabled ? 1 : 0, settings.layerMomentumEnabled ? 1 : 0, settings.layerConfidenceEnabled ? 1 : 0, settings.layerRiskEnabled ? 1 : 0,
    settings.binanceApiKey ?? null, settings.binanceSecretKey ?? null, settings.tradingMode ?? 'PAPER',
    settings.quantumBbPeriod ?? 20, settings.quantumBbMultiplier ?? 2.0, settings.quantumVolThreshold ?? 1.02, settings.quantumMomentumVol ?? 1.5,
    settings.quantumTakerLongThresh ?? 1.01, settings.quantumTakerShortThresh ?? 0.99, settings.quantumMomentumLongThresh ?? 1.15, settings.quantumMomentumShortThresh ?? 0.85,
    settings.quantumTpScale ?? 1.0, settings.quantumSlScale ?? 1.0,
    settings.quantumUseReversion !== false ? 1 : 0, settings.quantumUseMomentum !== false ? 1 : 0,
    settings.quantumBeastMode ? 1 : 0, settings.quantumSmartExit ? 1 : 0, settings.quantumWiseEntry ? 1 : 0,
    settings.quantumBeastAggression ?? 1.5, settings.quantumSmartExitAggression ?? 0.8, settings.quantumWiseEntryThreshold ?? 1.05,
    settings.inverseTrailingEnabled ? 1 : 0, settings.inverseTrailingSensitivity ?? 0.05,
    settings.isLongTerm ? 1 : 0, settings.minPositionSizePerc ?? 20,
    settings.isNightmareMode ? 1 : 0, settings.marketPanicThreshold ?? 3.0,
    settings.useFusionEngine ? 1 : 0, settings.fusionSensitivity ?? 1.0,
    settings.fusionWeightOi ?? 0.25, settings.fusionWeightFunding ?? 0.25,
    settings.fusionWeightVol ?? 0.25, settings.fusionWeightInst ?? 0.25,
    settings.fusionMinScore ?? 70,
    settings.exitUseRsiCheck !== false ? 1 : 0,
    settings.overrideAllWithAdaptive ? 1 : 0,
    settings.useCreativeEngine ? 1 : 0,
    settings.creativeUseAdaptiveExit ? 1 : 0,
    settings.disableConsecutiveLoss ? 1 : 0,
    settings.useSteelEngine ? 1 : 0,
    settings.steelMinProbability ?? 65,
    settings.steelInfluenceCreative ?? 0.35,
    settings.steelInfluenceQuantum ?? 0.35,
    settings.steelInfluenceFusion ?? 0.30,
    settings.steelTakerWeight ?? 1.5,
    settings.steelOiWeight ?? 1.2,
    settings.steelFundingWeight ?? 1.0,
    settings.steelLiquidityWeight ?? 1.3,
    settings.steelHtfTrendWeight ?? 1.4,
    settings.steelAdaptiveSlTp !== false ? 1 : 0,
    settings.steelMaxLossMode ? 1 : 0,
    settings.steelReboundSensitivity ?? 0.15,
    settings.steelMinProfitTake ?? 0.05,
    settings.useTawleefaEngine ? 1 : 0,
    settings.activeTawleefaJson || null,
    settings.useFierceExitEngine ? 1 : 0,
    settings.fierceTakeProfitValue ?? 1.5,
    settings.fierceTakeProfitMode || 'FUSION_CASCADE'
  ];

  db.run(query, values, (err) => {
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
        row.isLongTerm = row.isLongTerm === 1;
        row.quantumUseReversion = row.quantumUseReversion !== 0;
        row.quantumUseMomentum = row.quantumUseMomentum !== 0;
        row.quantumBeastMode = row.quantumBeastMode === 1;
        row.quantumSmartExit = row.quantumSmartExit === 1;
        row.quantumWiseEntry = row.quantumWiseEntry === 1;
        row.useWiseExit = row.useWiseExit === 1;
        row.useWiseEntry = row.useWiseEntry === 1;
        row.useSlyFox = row.useSlyFox === 1;
        row.beastConfirmWithSMC = row.beastConfirmWithSMC === 1;
        row.beastConfirmWithVolume = row.beastConfirmWithVolume === 1;
        row.fastExitEnabled = row.fastExitEnabled === 1;
        row.useFusionEngine = row.useFusionEngine === 1;
        row.useCreativeEngine = row.useCreativeEngine === 1;
        row.creativeUseAdaptiveExit = row.creativeUseAdaptiveExit === 1;
        row.disableConsecutiveLoss = row.disableConsecutiveLoss === 1;
        row.exitUseRsiCheck = row.exitUseRsiCheck !== 0;
        row.overrideAllWithAdaptive = row.overrideAllWithAdaptive === 1;
        row.useSteelEngine = row.useSteelEngine === 1;
        row.useTawleefaEngine = row.useTawleefaEngine === 1;
        row.activeTawleefaJson = row.activeTawleefaJson || null;
        row.useFierceExitEngine = row.useFierceExitEngine === 1;
        if (row.fierceTakeProfitValue === undefined) row.fierceTakeProfitValue = 1.5;
        if (row.fierceTakeProfitMode === undefined) row.fierceTakeProfitMode = 'FUSION_CASCADE';
        row.steelAdaptiveSlTp = row.steelAdaptiveSlTp === 1;
        row.steelMaxLossMode = row.steelMaxLossMode === 1;
        if (row.steelReboundSensitivity === undefined) row.steelReboundSensitivity = 0.15;
        if (row.steelMinProfitTake === undefined) row.steelMinProfitTake = 0.05;
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

