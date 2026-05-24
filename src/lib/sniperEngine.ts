import { Trade, MarketCondition, BotSettings } from "../types/trading.js";
import {
  saveTrade,
  loadClosedTrades,
  loadActiveTrades,
  saveSettingsToDB,
  loadSettingsFromDB,
  initDB,
  clearTrades,
} from "./db.js";
import ccxt from "ccxt";
import { CoreEngine } from "./engine/CoreEngine.js";
import { RiskEngine } from "./engine/RiskEngine.js";
import { PositionManager } from "./engine/PositionManager.js";
import { WiseExitEngine } from "./engine/WiseExitEngine.js";
import { FusionEngine } from "./engine/FusionEngine.js";
import { AdaptiveCascadeEngine, ExitDecision } from "./engine/AdaptiveCascadeEngine.js";
import {
  MarketMetrics,
  MarketRegime,
  TrapType,
  GlobalContext,
} from "../types/trading.js";
import { addLog } from "./botRunner.js";

export class SniperEngine {
  private mode: "PAPER" | "LIVE" = "PAPER";
  private activeTrades: Map<string, Trade> = new Map();
  private tradeHistory: Trade[] = [];
  private adaptiveCascadeLogs: any[] = [];
  private exchange: any = null;
  private binanceInitialized = false;
  private core = new CoreEngine();
  private risk = new RiskEngine();
  private manager = new PositionManager();
  private wiseEngine = new WiseExitEngine();

  private settings: BotSettings = {
    portfolioSize: 2000,
    riskPerTradePerc: 1, // 1%
    maxConcurrentTrades: 10,
    leverage: 10,
    tradingFeeRate: 0.001, // 0.1% total (Entry + Exit)
    tradingMode: "PAPER",
    strictMode: true,
    strictMinRvol: 1.5,
    strictFastBreakevenPerc: 0.3,
    useSmartExit: true,
    useWiseExit: true,
    useWiseEntry: true,
    useSlyFox: true,
    useKineticEngine: true,
    beastMode: false,
    beastConfirmWithSMC: false,
    beastConfirmWithVolume: false,
    beastMinRvol: 1.2,
    beastInstitutionalStrength: 0.4,
    fastExitEnabled: true,
    fastExitPerc: 0.5,
    strategyAdxThreshold: 25,
    strategyAtrMultiplier: 1.5,
    strategyMinConfidence: 0.6,
    strategyRvolThreshold: 1.5,
    useStrategyTrendFilter: true,
    useStrategyVolatilityRule: true,
    useStrategyConfidenceGate: true,
    useStrategyMomentumRule: true,
    dynamicSafetyExit: true,
    layerGlobalContextEnabled: true,
    layerRegimeEnabled: true,
    layerBiasEnabled: true,
    layerLiquidityEnabled: true,
    layerMomentumEnabled: true,
    layerConfidenceEnabled: true,
    layerRiskEnabled: true,
    inverseTrailingEnabled: false,
    inverseTrailingSensitivity: 0.05,
    exitUseRsiCheck: true,
  };

  constructor() {
    console.log("[SNIPER ENGINE] Initialized in PAPER mode.");
    this.initHistory();
  }

  private async initBinance() {
    const envApiKey = process.env.BINANCE_API_KEY;
    const envSecretKey = process.env.BINANCE_SECRET_KEY;

    const apiKey = envApiKey || this.settings.binanceApiKey;
    const secretKey = envSecretKey || this.settings.binanceSecretKey;

    if (this.settings.tradingMode === "LIVE" && apiKey && secretKey) {
      try {
        this.exchange = new ccxt.binance({
          apiKey: apiKey,
          secret: secretKey,
          options: { defaultType: "future" },
        });
        await this.exchange.loadMarkets();
        this.binanceInitialized = true;
        this.mode = "LIVE";
        console.log("[SNIPER] 🚀 BINANCE LIVE MODE CONNECTED!");
        addLog("Binance Live Mode Connected 🚀", "success");
      } catch (e: any) {
        console.error("[SNIPER] ❌ Failed to connect to Binance:", e.message);
        addLog(`Binance Connection Failed: ${e.message}`, "error");
        this.binanceInitialized = false;
        this.mode = "PAPER";
      }
    } else {
      this.mode = "PAPER";
      this.binanceInitialized = false;
    }
  }

  public async testBinanceConnection(): Promise<{
    success: boolean;
    message: string;
    balance?: any;
  }> {
    const envApiKey = process.env.BINANCE_API_KEY;
    const envSecretKey = process.env.BINANCE_SECRET_KEY;
    const apiKey = envApiKey || this.settings.binanceApiKey;
    const secretKey = envSecretKey || this.settings.binanceSecretKey;

    if (!apiKey || !secretKey) {
      return {
        success: false,
        message: "API Key or Secret Key is missing. Please check your (.env) file or settings.",
      };
    }

    try {
      const testExchange = new ccxt.binance({
        apiKey: apiKey,
        secret: secretKey,
        options: { defaultType: "future" },
      });
      const balance = await testExchange.fetchBalance();
      const usdtBalance = balance.total?.USDT || 0;
      
      return {
        success: true,
        message: `Successfully connected to Binance Futures. USDT Balance: ${usdtBalance}`,
        balance: balance.total,
      };
    } catch (e: any) {
      return {
        success: false,
        message: `Connection Failed: ${e.message}`,
      };
    }
  }

  public getSettings(): BotSettings {
    return this.settings;
  }

  public updateSettings(newSettings: BotSettings) {
    const keysChanged =
      this.settings.binanceApiKey !== newSettings.binanceApiKey ||
      this.settings.binanceSecretKey !== newSettings.binanceSecretKey ||
      this.settings.tradingMode !== newSettings.tradingMode;

    this.settings = newSettings;
    saveSettingsToDB(newSettings);
    console.log("[SNIPER] ⚙️ Settings updated and saved to DB:", newSettings);

    if (keysChanged) {
      this.initBinance();
    }
  }

  private async initHistory() {
    try {
      await initDB();
      const dbSettings = await loadSettingsFromDB();
      if (dbSettings) {
        if (
          dbSettings.portfolioSize === 1000 &&
          dbSettings.maxConcurrentTrades === 3
        ) {
          console.log(
            "[SNIPER] Auto-upgrading old default settings to new Ruthless defaults.",
          );
          this.settings.portfolioSize = 2000;
          this.settings.maxConcurrentTrades = 10;
          this.settings.strictMode = true;
          this.settings.strictMinRvol = 1.5;
          this.settings.strictFastBreakevenPerc = 0.3;
          this.settings.useSmartExit = true;
          this.settings.useWiseExit = true;
          this.settings.useWiseEntry = true;
          this.settings.useSlyFox = true;
          this.settings.useKineticEngine = true;
          this.settings.beastMode = false;
          this.settings.beastConfirmWithSMC = false;
          this.settings.beastConfirmWithVolume = false;
          this.settings.beastMinRvol = 1.2;
          this.settings.beastInstitutionalStrength = 0.4;
          saveSettingsToDB(this.settings);
        } else {
          this.settings = {
            portfolioSize: dbSettings.portfolioSize,
            riskPerTradePerc: dbSettings.riskPerTradePerc,
            maxConcurrentTrades: dbSettings.maxConcurrentTrades,
            leverage: dbSettings.leverage ?? 10,
            tradingFeeRate: dbSettings.tradingFeeRate ?? 0.001,
            strictMode: dbSettings.strictMode === 1,
            strictMinVolume: dbSettings.strictMinVolume,
            strictMinRvol: dbSettings.strictMinRvol,
            strictMaxRisk: dbSettings.strictMaxRisk,
            strictMinScore: dbSettings.strictMinScore,
            strictBtcAlignment: dbSettings.strictBtcAlignment === 1,
            strictRsiFilter: dbSettings.strictRsiFilter === 1,
            strictRetest: dbSettings.strictRetest === 1,
            strictFastBreakevenPerc: dbSettings.strictFastBreakevenPerc,
            strictRsiHigh: dbSettings.strictRsiHigh,
            strictRsiLow: dbSettings.strictRsiLow,
            strictRetestPullbackPerc: dbSettings.strictRetestPullbackPerc,
            strictBreakoutDistancePerc: dbSettings.strictBreakoutDistancePerc,
            useSmartExit: dbSettings.useSmartExit === 1,
            useWiseExit: dbSettings.useWiseExit === 1,
            useWiseEntry: dbSettings.useWiseEntry === 1,
            useSlyFox: dbSettings.useSlyFox === 1,
            useKineticEngine: dbSettings.useKineticEngine === 1,
            useSmartControl: dbSettings.useSmartControl === 1,
            smartTpUsd: dbSettings.smartTpUsd,
            smartTrailingStartUsd: dbSettings.smartTrailingStartUsd,
            smartTimeDecayMinutes: dbSettings.smartTimeDecayMinutes,
            smartTrailingThresholdPerc: dbSettings.smartTrailingThresholdPerc,
            smartMomentumStallMinutes: dbSettings.smartMomentumStallMinutes,
            kineticUseOpenInterest: dbSettings.kineticUseOpenInterest === 1,
            kineticUseVolume: dbSettings.kineticUseVolume === 1,
            kineticSensitivty: dbSettings.kineticSensitivty,
            beastMode: dbSettings.beastMode === 1,
            beastConfirmWithSMC: dbSettings.beastConfirmWithSMC === 1,
            beastConfirmWithVolume: dbSettings.beastConfirmWithVolume === 1,
            beastMinRvol: dbSettings.beastMinRvol ?? 1.2,
            beastInstitutionalStrength:
              dbSettings.beastInstitutionalStrength ?? 0.4,
            fastExitEnabled: dbSettings.fastExitEnabled === 1,
            fastExitPerc: dbSettings.fastExitPerc ?? 0.5,
            strategyAdxThreshold: dbSettings.strategyAdxThreshold ?? 25,
            strategyAtrMultiplier: dbSettings.strategyAtrMultiplier ?? 1.5,
            strategyMinConfidence: dbSettings.strategyMinConfidence ?? 0.6,
            strategyRvolThreshold: dbSettings.strategyRvolThreshold ?? 1.5,
            useStrategyTrendFilter: dbSettings.useStrategyTrendFilter === 1,
            useStrategyVolatilityRule:
              dbSettings.useStrategyVolatilityRule === 1,
            useStrategyConfidenceGate:
              dbSettings.useStrategyConfidenceGate === 1,
            useStrategyMomentumRule: dbSettings.useStrategyMomentumRule === 1,
            dynamicSafetyExit: dbSettings.dynamicSafetyExit === 1,
            layerGlobalContextEnabled:
              dbSettings.layerGlobalContextEnabled === 1,
            layerRegimeEnabled: dbSettings.layerRegimeEnabled === 1,
            layerBiasEnabled: dbSettings.layerBiasEnabled === 1,
            layerLiquidityEnabled: dbSettings.layerLiquidityEnabled === 1,
            layerMomentumEnabled: dbSettings.layerMomentumEnabled === 1,
            layerConfidenceEnabled: dbSettings.layerConfidenceEnabled === 1,
            layerRiskEnabled: dbSettings.layerRiskEnabled === 1,
            binanceApiKey: dbSettings.binanceApiKey,
            binanceSecretKey: dbSettings.binanceSecretKey,
            tradingMode: dbSettings.tradingMode,
            quantumBbPeriod: dbSettings.quantumBbPeriod,
            quantumBbMultiplier: dbSettings.quantumBbMultiplier,
            quantumVolThreshold: dbSettings.quantumVolThreshold,
            quantumMomentumVol: dbSettings.quantumMomentumVol,
            quantumTakerLongThresh: dbSettings.quantumTakerLongThresh,
            quantumTakerShortThresh: dbSettings.quantumTakerShortThresh,
            quantumMomentumLongThresh: dbSettings.quantumMomentumLongThresh,
            quantumMomentumShortThresh: dbSettings.quantumMomentumShortThresh,
            quantumTpScale: dbSettings.quantumTpScale,
            quantumSlScale: dbSettings.quantumSlScale,
            quantumUseReversion: dbSettings.quantumUseReversion === 1,
            quantumUseMomentum: dbSettings.quantumUseMomentum === 1,
            quantumBeastMode: dbSettings.quantumBeastMode === 1,
            quantumSmartExit: dbSettings.quantumSmartExit === 1,
            quantumWiseEntry: dbSettings.quantumWiseEntry === 1,
            quantumBeastAggression: dbSettings.quantumBeastAggression,
            quantumSmartExitAggression: dbSettings.quantumSmartExitAggression,
            quantumWiseEntryThreshold: dbSettings.quantumWiseEntryThreshold,
            inverseTrailingEnabled: dbSettings.inverseTrailingEnabled === 1,
            inverseTrailingSensitivity: dbSettings.inverseTrailingSensitivity,
            isLongTerm: dbSettings.isLongTerm === 1,
            minPositionSizePerc: dbSettings.minPositionSizePerc ?? 20,
            isNightmareMode: dbSettings.isNightmareMode === 1,
            marketPanicThreshold: dbSettings.marketPanicThreshold ?? 3.0,
            useFusionEngine: dbSettings.useFusionEngine === 1,
            fusionSensitivity: dbSettings.fusionSensitivity ?? 1.0,
            fusionWeightOi: dbSettings.fusionWeightOi ?? 0.25,
            fusionWeightFunding: dbSettings.fusionWeightFunding ?? 0.25,
            fusionWeightVol: dbSettings.fusionWeightVol ?? 0.25,
            fusionWeightInst: dbSettings.fusionWeightInst ?? 0.25,
            fusionMinScore: dbSettings.fusionMinScore ?? 70,
            exitUseRsiCheck: dbSettings.exitUseRsiCheck !== 0,
          };
        }
        console.log("[SNIPER] Loaded settings from database", this.settings);
      } else {
        saveSettingsToDB(this.settings);
      }

      this.tradeHistory = await loadClosedTrades();

      const openTrades = await loadActiveTrades();
      openTrades.forEach((t) => this.activeTrades.set(t.symbol, t));
      console.log(
        `[SNIPER ENGINE] Loaded ${this.tradeHistory.length} closed trades and ${openTrades.length} active trades from DB.`,
      );

      await this.initBinance();
    } catch (e) {
      console.error(e);
    }
  }

  public getActiveTrades(): Trade[] {
    return Array.from(this.activeTrades.values());
  }

  public getTradeHistory(): Trade[] {
    return this.tradeHistory;
  }

  public getAdaptiveCascadeLogs(): any[] {
    return this.adaptiveCascadeLogs;
  }

  public triggerPanic(active: boolean) {
    this.core.killSwitch.setManualPanic(active);
    if (active) {
      console.warn("[SNIPER] 🔴 EMERGENCY PANIC TRIGGERED MANUALLY!");
    } else {
      console.info("[SNIPER] 🟢 Emergency recovered.");
    }
  }

  public getStats() {
    const closed = this.tradeHistory.filter((t) => t.status === "CLOSED");
    const wins = closed.filter((t) => (t.pnlPerc || 0) > 0).length;
    const losses = closed.length - wins;
    const totalPnl = closed.reduce((acc, t) => acc + (t.pnl || 0), 0);
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

    return {
      totalPnl,
      winRate,
      openCount: this.activeTrades.size,
      totalTrades: closed.length,
    };
  }

  /**
   * Evaluates the trade against the 3-stage Adaptive Cascade Exit
   */
  private evaluateAdaptiveExit(
    trade: Trade, 
    currentPrice: number, 
    oi?: number, 
    vol?: number, 
    taker?: number,
    klines: any[] = [],
    rsi: number = 50,
    adx: number = 25,
    funding?: number
  ) {
    const metrics: MarketMetrics = {
       symbol: trade.symbol,
       price: currentPrice,
       adx: adx, 
       atr: 0, 
       atrPerc: 0,
       rsi: rsi, 
       volume: vol || 0,
       rvol: 1.5,
       spread: 0,
       openInterest: oi,
       takerRatio: taker,
       fundingRate: funding !== undefined ? funding : trade.fundingRate,
       isChop: false
    };

    return AdaptiveCascadeEngine.evaluate(trade, metrics, klines, this.settings);
  }

  /**
   * Evaluate a symbol against the new 7-layer architecture
   */
  public async evaluateSignal(
    condition: MarketCondition,
    klines: any[],
    htfKlines: any[],
    global?: GlobalContext,
  ): Promise<void> {
    // 1. Map MarketCondition to MarketMetrics
    const metrics: MarketMetrics = {
      symbol: condition.symbol,
      price: condition.price,
      adx: 25, // TODO: calculate accurately
      atr: condition.atr || 0,
      atrPerc: condition.atr ? (condition.atr / condition.price) * 100 : 0,
      rsi: 50, // TODO: calculate accurately
      volume: condition.vol24h || 0,
      rvol: condition.isMomentumHigh ? 2 : 1, // mapping RVOL roughly
      spread: condition.spread || 0,
      fundingRate: condition.fundingRate,
      openInterest: condition.oi,
      takerRatio: condition.takerBuySellRatio,
      isChop: condition.isRanging,
    };

    // 2. Clear Decision from the Core
    const decision = this.core.process(
      metrics,
      klines,
      htfKlines,
      this.settings,
      global,
    );
    condition.decision = decision; // Attach to condition for UI

    if (decision.action === "SLEEP" || decision.action === "WAIT") {
      // console.log(`[CORE] ${condition.symbol} -> Decision: ${decision.action} (${decision.reason})`);
      return;
    }

    // 3. Prevent duplicate trades on same symbol
    if (this.activeTrades.has(condition.symbol)) return;

    // 4. Execution Logic (If Attack)
    addLog(
      `ATTACK DETECTED: ${condition.symbol} | Regime: ${decision.regime}`,
      "info",
    );
    console.log(
      `[CORE] 🔥 ATTACK TRIGGERED on ${condition.symbol} | Regime: ${decision.regime} | Trap: ${decision.trap} | Confidence: ${decision.confidence * 100}%`,
    );

    // We override direction if a Trap is detected
    if (decision.trap === TrapType.LONG_TRAP) {
      condition.type = "SHORT";
    } else if (decision.trap === TrapType.SHORT_TRAP) {
      condition.type = "LONG";
    }

    // Labeling logic:
    // If confidence is low (0.5), it's a Beast/Aggressive entry (Incomplete Evaluation).
    // If confidence is high (>= 0.6), it's a standard Sniper/Wait Engine entry.
    let sourceLabel = "CORE";
    if (decision.reason === "BEAST_MOMENTUM_STRIKE") {
      sourceLabel = "AGGRESSIVE_INCOMPLETE";
    } else if (decision.confidence >= 0.6) {
      sourceLabel = "WAIT_ENGINE_PROTECTED";
    } else {
      sourceLabel = this.settings.beastMode ? "DIRECT_ENTRY" : "WAIT_PROTECTED";
    }

    // 5. Quantum Fusion Check (Final Valve)
    if (this.settings.useFusionEngine) {
      const fusion = FusionEngine.calculateFusionScore(metrics, this.settings);
      if (fusion.score < (this.settings.fusionMinScore ?? 70)) {
        console.log(`[FUSION] 🛡️ Entry Blocked: ${condition.symbol} | Score: ${fusion.score.toFixed(1)} < ${this.settings.fusionMinScore ?? 70}% | ${fusion.reason}`);
        return;
      }
      console.log(`[FUSION] ✅ Core Validated: ${condition.symbol} | Score: ${fusion.score.toFixed(1)}% | ${fusion.reason}`);
      sourceLabel = `FUSION_${sourceLabel}`;
    }

    await this.executeTrade(condition, sourceLabel);
  }

  /**
   * Execute trade and calculate strict Risk/Reward
   */
  private async executeTrade(cond: MarketCondition, source?: string) {
    const entryPrice = cond.price;
    let sl = 0;

    // 1. Stop Loss Placement: Prioritize ATR for dynamic protection
    if (cond.atr && cond.atr > 0 && this.settings.useStrategyVolatilityRule) {
      let atrMultiplier = this.settings.strategyAtrMultiplier ?? 1.5;
      if (this.settings.beastMode) atrMultiplier += 0.5;
      sl =
        cond.type === "LONG"
          ? entryPrice - cond.atr * atrMultiplier
          : entryPrice + cond.atr * atrMultiplier;
    } else {
      sl =
        cond.type === "LONG" ? cond.support * 0.999 : cond.resistance * 1.001;
    }

    // 2. Risk Engine Validation
    const riskVerdict = this.risk.canTrade(
      this.getActiveTrades(),
      this.tradeHistory,
      this.settings.beastMode,
    );
    if (!riskVerdict.allowed) {
      console.log(`[RISK] 🛡️ Entry Blocked: ${riskVerdict.reason}`);
      return;
    }

    // 3. Position Sizing
    const leverage = this.settings.leverage || 10;
    const maxTrades = this.settings.maxConcurrentTrades || 10;
    const positionSizeUsd = this.risk.calculatePositionSize(
      this.settings.portfolioSize,
      entryPrice,
      sl,
      leverage,
      maxTrades,
      this.settings.minPositionSizePerc || 0,
      this.settings.riskPerTradePerc || 1
    );

    if (positionSizeUsd <= 0) {
      console.warn(
        `[SNIPER] ⚠️ Aborting trade on ${cond.symbol}: Calculated size is zero. Check portfolio settings.`,
      );
      return;
    }

    // 4. Take Profits
    const risk = Math.abs(entryPrice - sl);
    const tp1 =
      cond.type === "LONG" ? entryPrice + risk * 0.8 : entryPrice - risk * 0.8;
    const tp2 =
      cond.type === "LONG" ? entryPrice + risk * 2.5 : entryPrice - risk * 2.5;

    const trade: Trade = {
      id: Date.now().toString(),
      symbol: cond.symbol,
      type: cond.type,
      mode: this.mode,
      entryPrice,
      entryTime: Date.now(),
      amount: positionSizeUsd,
      leverage: this.settings.leverage || 10,
      sl,
      initialSl: sl,
      tp1,
      tp2,
      status: "OPEN",
      score: cond.score,
      source: source || "CORE",
      isBreakeven: false,
      pnl: 0,
      pnlPerc: 0,
    };

    if (this.mode === "LIVE" && this.exchange && this.binanceInitialized) {
      try {
        // [INVERSE LOGIC] عكس الصفقة عند الإرسال لبايننس
        const side = trade.type === "LONG" ? "sell" : "buy";
        const symbol = trade.symbol;

        try {
          await this.exchange.setLeverage(trade.leverage, symbol);
        } catch (e: any) {}

        const market = this.exchange.market(symbol);
        const quantity = trade.amount / entryPrice;
        const roundedAmount = this.exchange.amountToPrecision(symbol, quantity);

        console.log(
          `[BINANCE] 🔄 INVERSE EXECUTION: القرار الأصلي ${trade.type} -> إرسال ${side.toUpperCase()} لبايننس | الكمية: ${roundedAmount}`,
        );
        const order = await this.exchange.createOrder(
          symbol,
          "market",
          side,
          roundedAmount,
        );
        console.log(`[BINANCE] ✅ LIVE Order Placed: ${order.id}`);
        addLog(`Binance LIVE ${trade.type} ${symbol} Executed ✅`, "success");
      } catch (e: any) {
        console.error(`[BINANCE] ❌ LIVE Order Failed:`, e.message);
        addLog(`Binance LIVE Order Failed: ${e.message}`, "error");
        return;
      }
    }

    this.activeTrades.set(trade.symbol, trade);
    addLog(
      `ENTRY: ${trade.type} ${trade.symbol} @ ${entryPrice.toFixed(2)}`,
      "info",
    );
    console.log(
      `[CORE] 🟢 ATTACK EXECUTED: ${trade.type} on ${trade.symbol} @ ${entryPrice.toFixed(4)}. SL: ${sl.toFixed(4)}`,
    );
    saveTrade(trade);
  }

  public async executeQuantumTrade(
    cond: MarketCondition,
    source: string,
    tpPerc: number,
    slPerc: number,
  ) {
    const entryPrice = cond.price;
    const slDistance = (slPerc / 100) * entryPrice;
    const sl =
      cond.type === "LONG" ? entryPrice - slDistance : entryPrice + slDistance;

    const tp1Distance = (tpPerc / 100) * entryPrice;
    const tp1 =
      cond.type === "LONG"
        ? entryPrice + tp1Distance
        : entryPrice - tp1Distance;
    const tp2 =
      cond.type === "LONG"
        ? entryPrice + tp1Distance * 2.5
        : entryPrice - tp1Distance * 2.5;

    const leverage = this.settings.leverage || 10;
    const maxTrades = this.settings.maxConcurrentTrades || 10;

    // --- FUSION ENGINE VALIDATION GATE (NEW) ---
    if (this.settings.useFusionEngine && source !== "FUSION_DIRECT") {
      const metrics: MarketMetrics = {
        symbol: cond.symbol,
        price: entryPrice,
        adx: 25,
        atr: cond.atr || 0,
        atrPerc: cond.atr ? (cond.atr / entryPrice) * 100 : 0,
        rsi: 50,
        volume: cond.vol24h || 0,
        rvol: cond.isMomentumHigh ? 2.0 : 1.2,
        spread: cond.spread || 0,
        fundingRate: cond.fundingRate,
        openInterest: cond.oi,
        takerRatio: cond.takerBuySellRatio,
        isChop: false
      };
      
      const fusion = FusionEngine.calculateFusionScore(metrics, this.settings);
      const minScore = this.settings.fusionMinScore ?? 70;
      
      if (fusion.score < minScore) {
        console.log(`[FUSION] 🛡️ Entry Blocked (Quantum Path): ${cond.symbol} | Score: ${fusion.score.toFixed(1)} < ${minScore}% | ${fusion.reason}`);
        addLog(`FUSION Blocked ${cond.symbol}: Score ${fusion.score.toFixed(0)}%`, 'warn');
        return;
      }
      console.log(`[FUSION] ✅ Core Validated (Quantum Path): ${cond.symbol} | Score: ${fusion.score.toFixed(1)}%`);
      source = `FUSION_${source}`;
    }

    let positionSizeUsd = this.risk.calculatePositionSize(
      this.settings.portfolioSize,
      entryPrice,
      sl,
      leverage,
      maxTrades,
      this.settings.minPositionSizePerc || 0,
      this.settings.riskPerTradePerc || 1
    );

    // Ensure minimum position for exchange rules (Binance usually requires 5-10 USD)
    if (positionSizeUsd < 11) positionSizeUsd = 11;

    const trade: Trade = {
      id: Date.now().toString(),
      symbol: cond.symbol,
      type: cond.type,
      mode: this.mode,
      entryPrice,
      entryTime: Date.now(),
      amount: positionSizeUsd,
      leverage,
      sl,
      initialSl: sl,
      tp1,
      tp2,
      status: "OPEN",
      score: 5,
      source: source || "QUANTUM",
      isBreakeven: false,
      pnl: 0,
      pnlPerc: 0,
    };

    if (this.mode === "LIVE" && this.exchange && this.binanceInitialized) {
      try {
        // [INVERSE LOGIC] عكس الصفقة عند الإرسال لبايننس (Quantum)
        const side = trade.type === "LONG" ? "sell" : "buy";
        const symbol = trade.symbol;

        try {
          await this.exchange.setLeverage(trade.leverage, symbol);
        } catch (e: any) {}

        const market = this.exchange.market(symbol);
        const quantity = trade.amount / entryPrice;
        const roundedAmount = this.exchange.amountToPrecision(symbol, quantity);

        console.log(
          `[BINANCE] 🚀 Executing QUANTUM INVERSE ${trade.type} on ${symbol} | Sending ${side.toUpperCase()}`,
        );
        const order = await this.exchange.createOrder(
          symbol,
          "market",
          side,
          roundedAmount,
        );
        console.log(`[BINANCE] ✅ QUANTUM LIVE Order Placed: ${order.id}`);
        addLog(`Quantum LIVE ${trade.type} ${symbol} Executed ✅`, "success");
      } catch (e: any) {
        console.error(`[BINANCE] ❌ Quantum LIVE Order Failed:`, e.message);
        addLog(`Quantum LIVE Order Failed: ${e.message}`, "error");
        return;
      }
    }

    this.activeTrades.set(trade.symbol, trade);
    addLog(
      `QUANTUM ENTRY: ${trade.type} ${trade.symbol} @ ${entryPrice.toFixed(2)}`,
      "info",
    );
    console.log(`QUANTUM ENTRY EXECUTED FOR ${symbol}`);
  }

  /**
   * Manage active trades (Trailing stops, Take Profits, and Dynamic Safety Exits)
   * This is the central decision hub for active positions.
   */
  public async manageTrades(
    symbol: string,
    currentPrice: number,
    currentOI?: number,
    currentVol?: number,
    currentTakerRatio?: number,
    indicators?: {
      adx?: number;
      rsi?: number;
      emaTrend?: "LONG" | "SHORT";
      btcTrend?: "LONG" | "SHORT";
      klines?: any[];
      fundingRate?: number;
    },
  ) {
    const trade = this.activeTrades.get(symbol);
    if (!trade) return;

    trade.currentPrice = currentPrice;
    let updated = false;

    const klines = indicators?.klines || [];
    const rsi = indicators?.rsi || 50;
    const adx = indicators?.adx || 25;
    const fundingRate = indicators?.fundingRate;

    if (fundingRate !== undefined) {
      trade.fundingRate = fundingRate;
    }

    // --- 0. PRE-FLIGHT: Update Price & Metric History ---
    if (!trade.tickHistory) trade.tickHistory = [];
    trade.tickHistory.push(currentPrice);
    if (trade.tickHistory.length > 50) trade.tickHistory.shift();

    if (currentOI !== undefined) {
      if (!trade.oiHistory) trade.oiHistory = [];
      trade.oiHistory.push(currentOI);
      if (trade.oiHistory.length > 50) trade.oiHistory.shift();
    }

    if (currentVol !== undefined) {
      if (!trade.volHistory) trade.volHistory = [];
      trade.volHistory.push(currentVol);
      if (trade.volHistory.length > 50) trade.volHistory.shift();
    }

    // --- REAL-TIME ADAPTIVE CASCADE EVALUATION & TELEMETRY ---
    let oiTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    if (trade.oiHistory && trade.oiHistory.length > 1) {
      const avgOI = trade.oiHistory.reduce((a, b) => a + b, 0) / trade.oiHistory.length;
      if (currentOI !== undefined) {
        if (currentOI > avgOI * 1.001) oiTrend = 'UP';
        else if (currentOI < avgOI * 0.999) oiTrend = 'DOWN';
      }
    }

    let volTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    if (trade.volHistory && trade.volHistory.length > 1) {
      const avgVol = trade.volHistory.reduce((a, b) => a + b, 0) / trade.volHistory.length;
      if (currentVol !== undefined) {
        if (currentVol > avgVol * 1.05) volTrend = 'UP';
        else if (currentVol < avgVol * 0.95) volTrend = 'DOWN';
      }
    }

    let takerTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    const takerRatioVal = currentTakerRatio !== undefined ? currentTakerRatio : 1.0;
    if (takerRatioVal > 1.01) takerTrend = 'BULLISH';
    else if (takerRatioVal < 0.99) takerTrend = 'BEARISH';

    const adaptiveEval = this.evaluateAdaptiveExit(trade, currentPrice, currentOI, currentVol, currentTakerRatio, klines, rsi, adx, fundingRate);

    const latestResult = {
      time: Date.now(),
      decision: adaptiveEval.decision,
      reason: adaptiveEval.reason,
      score: adaptiveEval.score,
      metrics: {
        price: currentPrice,
        rsi: rsi,
        openInterest: currentOI,
        volume: currentVol,
        takerRatio: currentTakerRatio,
        fundingRate: fundingRate !== undefined ? fundingRate : trade.fundingRate,
        oiTrend,
        volTrend,
        takerTrend
      }
    };

    trade.latestAdaptiveResult = latestResult;

    // Record the telemetry logs (throttle logging slightly to prevent duplicate logs of normal continue states, or keep all evaluations but clean)
    // We can write a log entry when:
    // 1. It is a state other than CONTINUE, OR
    // 2. No logs exist for this symbol, OR
    // 3. The decision changes, OR
    // 4. Over 30 seconds have passed since the last log for this symbol.
    const lastLog = this.adaptiveCascadeLogs.slice().reverse().find(l => l.symbol === symbol);
    const shouldWriteLog = !lastLog || 
                           lastLog.decision !== adaptiveEval.decision || 
                           (Date.now() - lastLog.time > 30000) || 
                           adaptiveEval.decision !== "CONTINUE";

    const logEntry = {
      id: `${symbol}-${Date.now()}`,
      symbol,
      type: trade.type,
      entryPrice: trade.entryPrice,
      currentPrice,
      decision: adaptiveEval.decision,
      reason: adaptiveEval.reason,
      score: adaptiveEval.score,
      time: Date.now(),
      metrics: {
        rsi,
        openInterest: currentOI,
        volume: currentVol,
        takerRatio: currentTakerRatio,
        fundingRate: fundingRate !== undefined ? fundingRate : trade.fundingRate,
        oiTrend,
        volTrend,
        takerTrend
      }
    };

    if (shouldWriteLog) {
      this.adaptiveCascadeLogs.push(logEntry);
      if (this.adaptiveCascadeLogs.length > 200) {
        this.adaptiveCascadeLogs.shift();
      }

      if (!trade.adaptiveHistoryLogs) {
        trade.adaptiveHistoryLogs = [];
      }
      trade.adaptiveHistoryLogs.push(logEntry);
      if (trade.adaptiveHistoryLogs.length > 50) {
        trade.adaptiveHistoryLogs.shift();
      }
    }

    // --- 0. HEGEMONY ADAPTIVE CASCADE EXIT OVERRIDE ---
    // If the Hegemony mode is active, the Adaptive decision has complete dominance to exit or tighten stop loss immediately!
    if (this.settings.overrideAllWithAdaptive) {
      // 1. Direct EXIT decision from the Adaptive Cascade Engine
      if (adaptiveEval.decision === ExitDecision.EXIT_NOW) {
        console.log(`[ADAPTIVE CASCADE] 🚨 HEGEMONY EXIT: Exiting ${symbol} immediately. Reason: ${adaptiveEval.reason}`);
        addLog(`Hegemony Exit: ${symbol} is closed immediately | Reason: ${adaptiveEval.reason}`, 'warn');
        await this.closeTrade(trade, currentPrice, `⚡ CASCADE_HEGEMONY_EXIT: ${adaptiveEval.reason}`);
        return;
      }

      // 2. Run manager to update basic trade statistics (PnL, high price, etc. for frontend updates)
      const managerVerdict = this.manager.manage(trade as any, currentPrice, {
        strictFastBreakevenPerc: this.settings.strictFastBreakevenPerc,
        tradingFeeRate: this.settings.tradingFeeRate,
        leverage: this.settings.leverage
      });
      if (managerVerdict.updatedTrade) {
        Object.assign(trade, managerVerdict.updatedTrade);
        updated = true;
      }

      // 3. Handle TRAIL_TIGHT decision
      if (adaptiveEval.decision === ExitDecision.TRAIL_TIGHT) {
        const oldSl = trade.sl;
        const smartSl = this.calculateSmartTightStop(trade, currentPrice);
        trade.sl = smartSl;
        console.log(`[ADAPTIVE CASCADE] ⚠️ Hegemony Tightened Trailing stop for ${symbol} | Old SL: ${oldSl ? oldSl.toFixed(4) : 'None'} -> New SL: ${smartSl.toFixed(4)} | Reason: ${adaptiveEval.reason}`);
        updated = true;

        // Verify if our tightened adaptive trailing stop has been crossed by the market price
        const hitSl = trade.type === "LONG" ? currentPrice <= trade.sl : currentPrice >= trade.sl;
        if (hitSl) {
          console.log(`[ADAPTIVE CASCADE] 🛑 Hegemony Trailing Stop Hit for ${symbol} at ${currentPrice}`);
          addLog(`Hegemony Trailing Hit: ${symbol} is closed | Trailing Stop at ${trade.sl.toFixed(4)} hit @ ${currentPrice}`, 'warn');
          await this.closeTrade(trade, currentPrice, `🛡️ CASCADE_HEGEMONY_TRAIL_HIT`);
          return;
        }
      }

      // 4. Save state & bypass all other safety valves and other exits completely
      if (updated) {
        saveTrade(trade);
        this.activeTrades.set(symbol, trade);
      }
      return; 
    }

    // --- 1. CORE POSITION UPDATE (Standard PnL & Stats) ---
    const managerVerdict = this.manager.manage(trade as any, currentPrice, {
      strictFastBreakevenPerc: this.settings.strictFastBreakevenPerc,
      tradingFeeRate: this.settings.tradingFeeRate,
      leverage: this.settings.leverage
    });

    if (managerVerdict.action === "CLOSE") {
      // 🛡️ ADAPTIVE CASCADE CHECK before closing
      const shouldCheckAdaptive = this.settings.overrideAllWithAdaptive || 
                                (managerVerdict.reason && (managerVerdict.reason.includes("TP") || managerVerdict.reason.includes("TRAILING")));

      if (shouldCheckAdaptive) {
        const adaptive = adaptiveEval; // Re-use the already evaluated live state!
        
        if (adaptive.decision === ExitDecision.HOLD_FOR_MOON || adaptive.decision === ExitDecision.CONTINUE) {
           console.log(`[ADAPTIVE CASCADE] 🛡️ Exit Overridden: Staying in ${symbol} | Reason: ${managerVerdict.reason} -> ${adaptive.reason}`);
           addLog(`Adaptive Hold: Order to close (${managerVerdict.reason}) OVERRIDDEN by Market Strength`, 'success');
           return; 
        }
        
        if (adaptive.decision === ExitDecision.TRAIL_TIGHT) {
           const oldSl = trade.sl;
           const smartSl = this.calculateSmartTightStop(trade, currentPrice);
           trade.sl = smartSl;
           console.log(`[ADAPTIVE CASCADE] ⚠️ Tightening Trailing Stop for ${symbol} instead of closing | Old SL: ${oldSl ? oldSl.toFixed(4) : 'None'} -> New SL: ${smartSl.toFixed(4)}.`);
           updated = true;
           return; 
        }
      }
      
      await this.closeTrade(trade, currentPrice, managerVerdict.reason || "CORE_MANAGER_EXIT");
      return;
    } else if (managerVerdict.action === "UPDATE" && managerVerdict.updatedTrade) {
      Object.assign(trade, managerVerdict.updatedTrade);
      updated = true;
    }

    // --- 2. EMERGENCY & SAFETY (Fast Exit / Time Limit) ---
    if (this.settings.fastExitEnabled) {
      const exitPerc = this.settings.fastExitPerc || 0.5;
      const rawPriceChange = trade.type === "LONG"
        ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
        : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;

      if (rawPriceChange <= -exitPerc) {
        await this.closeTrade(trade, currentPrice, "⚡ FAST_EXIT_SAFETY");
        return;
      }
    }

    const minutesOpen = (Date.now() - trade.entryTime) / 60000;
    const timeLimitMultiplier = this.settings.isLongTerm ? 15 : 1;
    const hardTimeLimit = 180 * timeLimitMultiplier;
    if (minutesOpen >= hardTimeLimit) {
      await this.closeTrade(trade, currentPrice, "⏱️ TIME_LIMIT_EXIT");
      return;
    }

    // --- 3. SYSTEM SPECIFIC EXITS (Toggleable Engines) ---

    // A. Dynamic Safety (Indicator Weakness)
    if (this.settings.dynamicSafetyExit && indicators) {
       const isStrict = this.settings.strictMode;
       let failCount = 0;
       const adxThreshold = isStrict ? (this.settings.strategyAdxThreshold ?? 25) : 15;
       
       if (indicators.adx && indicators.adx < adxThreshold * 0.5) failCount++;
       if (indicators.emaTrend && indicators.emaTrend !== trade.type) failCount++;
       if (indicators.rsi) {
         if (trade.type === "LONG" && indicators.rsi < 35) failCount++;
         if (trade.type === "SHORT" && indicators.rsi > 65) failCount++;
       }

       if (failCount >= 2) {
         await this.closeTrade(trade, currentPrice, "🛡️ DYNAMIC_SAFETY_WEAKNESS");
         return;
       }
    }

    // B. Inverse Trailing logic
    if (this.settings.inverseTrailingEnabled) {
      if (!trade.inverseBestPrice || (trade.type === "LONG" ? currentPrice < trade.inverseBestPrice : currentPrice > trade.inverseBestPrice)) {
        trade.inverseBestPrice = currentPrice;
        updated = true;
      }

      const invSensitivity = (this.settings.inverseTrailingSensitivity || 0.05) * (this.settings.isLongTerm ? 4 : 1);
      const invReversal = trade.type === "LONG"
        ? ((currentPrice - trade.inverseBestPrice) / trade.inverseBestPrice) * 100
        : ((trade.inverseBestPrice - currentPrice) / trade.inverseBestPrice) * 100;

      const isBinanceInProfit = trade.type === "LONG" ? currentPrice < trade.entryPrice : currentPrice > trade.entryPrice;
      if (invReversal >= invSensitivity && isBinanceInProfit) {
        await this.closeTrade(trade, currentPrice, "🔄 INVERSE_TRAILING_EXIT");
        return;
      }
    }

    // C. Kinetic Engine (Complex Momentum Flow)
    if (this.settings.useKineticEngine) {
      // Kinetic logic is more about "tactical profits" and "distribution"
      const kineticSensitivity = this.settings.kineticSensitivty ?? 1.5;
      
      // Calculate micro-volatility
      let liveVol = 0;
      if (trade.tickHistory && trade.tickHistory.length >= 10) {
        const max = Math.max(...trade.tickHistory);
        const min = Math.min(...trade.tickHistory);
        liveVol = ((max - min) / min) * 100;
      }

      // Check distribution (OI vs Price)
      if (this.settings.kineticUseOpenInterest && trade.oiHistory && trade.oiHistory.length >= 10) {
        const oiNow = trade.oiHistory[trade.oiHistory.length - 1];
        const oiPrev = trade.oiHistory[trade.oiHistory.length - 10];
        const oiTrend = ((oiNow - oiPrev) / oiPrev) * 100;

        // If price is stable but OI is dropping fast -> Hidden Distribution
        if (oiTrend < -(0.05 * kineticSensitivity) && trade.pnl > 0) {
           await this.closeTrade(trade, currentPrice, "🔴 KINETIC_DISTRIBUTION_EXIT");
           return;
        }
      }

      // Elastic Elastic Shadow (Trailing from High)
      if (trade.highestPrice) {
        const dropFromHigh = trade.type === "LONG"
          ? ((trade.highestPrice - currentPrice) / trade.highestPrice) * 100
          : ((currentPrice - trade.highestPrice) / trade.highestPrice) * 100;
        
        const baseThreshold = (this.settings.smartTrailingThresholdPerc ?? 0.3) * (this.settings.isLongTerm ? 4 : 1);
        let dynamicThreshold = baseThreshold;

        // Tighten if trade is old
        if (minutesOpen > 15 * timeLimitMultiplier) dynamicThreshold *= 0.6;
        
        if (dropFromHigh >= dynamicThreshold && trade.pnl > 0) {
          await this.closeTrade(trade, currentPrice, "🚀 KINETIC_ELASTIC_EXIT");
          return;
        }
      }

      // Tactical Split (Special for fast movers)
      const benchmarkTp = (this.settings.smartTpUsd || 1.5) * timeLimitMultiplier;
      if (trade.pnl >= benchmarkTp && minutesOpen < 2 && !trade.isPartialProfitTaken) {
        trade.isPartialProfitTaken = true;
        trade.realizedPnl = (trade.realizedPnl || 0) + (trade.pnl / 2);
        trade.amount = trade.amount / 2;
        trade.isBreakeven = true;
        // Move SL to entry + security
        trade.sl = trade.type === "LONG" ? trade.entryPrice * 1.002 : trade.entryPrice * 0.998;
        updated = true;
        console.log(`[KINETIC] ⚡ Tactical Split: Secured 50% for ${trade.symbol}`);
      }
    }

      if (updated) {
        saveTrade(trade);
      }

      // 🔄 INVERSE TRAILING (نظام الحماية المعكوسة)
      if (this.settings.inverseTrailingEnabled) {
        const sensitivity = this.settings.inverseTrailingSensitivity ?? 0.05;

        // Calculate reversal percentage
      const reversalPerc = trade.type === "LONG"
        ? ((currentPrice - trade.inverseBestPrice) / trade.inverseBestPrice) * 100
        : ((trade.inverseBestPrice - currentPrice) / trade.inverseBestPrice) * 100;

      // الخروج إذا كان الارتداد أكبر من الحساسية (بشرط وجود خسارة داخلية أي ربح في بايننس)
      const isBinanceInProfit = trade.type === "LONG" 
        ? currentPrice < trade.entryPrice 
        : currentPrice > trade.entryPrice;

      if (reversalPerc >= sensitivity && isBinanceInProfit) {
        console.log(`[INVERSE TRAILING] 📉 Reversal Detected: ${reversalPerc.toFixed(3)}% from best inverse price. Securing Binance profits.`);
        await this.closeTrade(trade, currentPrice, "🔄 INVERSE_TRAILING_EXIT");
        return;
      }
    }

    // 🌟 KINETIC ENGINE (نظام الزخم الحركي الشامل)
    if (this.settings.useKineticEngine) {
      // --- BASE SETTINGS (المتغيرات الأساسية للمستخدم) ---
      const rawTpInput = this.settings.smartTpUsd ?? 1.5;
      const isTpDisabled = rawTpInput <= 0;
      // benchmarkTp: يُستخدم كمرجع داخلي لنظام الوحش (Kinetic) لتنسيق سرعة الملاحقة، حتى لو كان الإغلاق التلقائي معطلاً
      const isLongTerm = !!this.settings.isLongTerm;
      const ltMultiplier = isLongTerm ? 10 : 1; 

      const benchmarkTp = (isTpDisabled ? 1.5 : rawTpInput) * ltMultiplier;
      const minutesOpen = (Date.now() - trade.entryTime) / 60000;
      let liveVolatilityPerc = 0;

      // Calculate live volatility from tick history (Micro-structure reading)
      if (trade.tickHistory && trade.tickHistory.length >= 15) {
        const tickMax = Math.max(...trade.tickHistory);
        const tickMin = Math.min(...trade.tickHistory);
        liveVolatilityPerc = ((tickMax - tickMin) / tickMin) * 100;
      }

      const kineticSensitivity = this.settings.kineticSensitivty ?? 1.5;

      // 🧠 True Flow: Calculate Open Interest and Price Trends (المحركات الحية وتطابق السيولة)
      let oiTrend = 0;
      let priceTrend = 0;
      let isMomentumActive = false;

      if (
        this.settings.kineticUseOpenInterest &&
        trade.oiHistory &&
        trade.oiHistory.length >= 10 &&
        trade.tickHistory &&
        trade.tickHistory.length >= 10
      ) {
        const lookback = Math.min(20, trade.oiHistory.length - 1);
        const currentOI = trade.oiHistory[trade.oiHistory.length - 1];
        const prevOI = trade.oiHistory[trade.oiHistory.length - 1 - lookback]; // Trend over last ~30-60s
        oiTrend = ((currentOI - prevOI) / prevOI) * 100;

        const currentPx = trade.tickHistory[trade.tickHistory.length - 1];
        const prevPx =
          trade.tickHistory[trade.tickHistory.length - 1 - lookback];
        priceTrend = ((currentPx - prevPx) / prevPx) * 100;
      }

      // 🧠 True Flow: Calculate live volume flow (from 1m candle)
      let volTrend = 0;
      if (
        this.settings.kineticUseVolume &&
        trade.volHistory &&
        trade.volHistory.length >= 10
      ) {
        const lookback = Math.min(20, trade.volHistory.length - 1);
        const currentV = trade.volHistory[trade.volHistory.length - 1];
        const prevV = trade.volHistory[trade.volHistory.length - 1 - lookback];
        // Since Volume is a 1m candle volume, it resets every minute.
        // If currentV < prevV, a new candle started. We just check the raw growth rate if within the same candle.
        if (currentV >= prevV && prevV > 0) {
          volTrend = ((currentV - prevV) / prevV) * 100;
        } else if (currentV < prevV && currentV > 0) {
          // Candle rolled over, just gauge based on the current volume burst relative to a nominal baseline (preventing false negatives)
          volTrend = 0; // Pause volume momentum for this tick
        }
      }

      if (
        oiTrend > 0.02 * kineticSensitivity ||
        volTrend > 0.05 * kineticSensitivity
      ) {
        isMomentumActive = true;
      }

      // --- KINETIC ENGINE: DYNAMIC MODIFIERS (التكيف المطاطي) ---

      const timeLimitMultiplier = isLongTerm ? 15 : 1;
      let smartTimeDelayLimit = (this.settings.smartTimeDecayMinutes ?? 5) * timeLimitMultiplier;
      let dynamicTrailThreshold =
        (this.settings.smartTrailingThresholdPerc ?? 0.3) * (isLongTerm ? 4 : 1); // 4x room for long term
      let momentumStallLimit = (this.settings.smartMomentumStallMinutes ?? 2.5) * timeLimitMultiplier;

      // 💀 NIGHTMARE UPGRADE: Aggressive Tightening
      if (this.settings.isNightmareMode) {
        dynamicTrailThreshold *= 0.8; // Be 20% more sensitive by default
        momentumStallLimit *= 0.7; // Don't wait for stalls
      }

      // 1. Elastic Shadow (الملاحقة المطاطية): Expand buffer if new/volatile, tighten if old
      if (minutesOpen < 5 * timeLimitMultiplier || liveVolatilityPerc > 0.5)
        dynamicTrailThreshold *= 1.8; // More room at start
      else if (minutesOpen > 20 * timeLimitMultiplier) dynamicTrailThreshold *= 0.5; // Tighten after mature

      // 2. Open Interest & Volume Modifiers (المحركات الحية)
      if (this.settings.kineticUseOpenInterest) {
        if (oiTrend > 0.04 * kineticSensitivity) {
          // 🟢 تصرف صحي: سيولة داخلة بقوة! (Accumulation or healthy trend)
          // Expand limits heavily so we don't get shaken out
          dynamicTrailThreshold *= 1.8;
          momentumStallLimit *= 1.8;
          smartTimeDelayLimit *= 1.8;
        } else if (oiTrend < -(0.04 * kineticSensitivity)) {
          // 🔴 تصريف مخفي: الناس تخرج (Distribution / OI dropping)
          // Shrink all boundaries, fast exit!
          dynamicTrailThreshold *= 0.5;
          momentumStallLimit *= 0.5;
          smartTimeDelayLimit *= 0.4;
        }
      }

      // 3. Momentum Stall scaling (مقياس تجمد الزخم): Give deep profits more room to breathe
      if (trade.pnl > benchmarkTp * 1.5) momentumStallLimit *= 1.6;
      else if (trade.pnl < benchmarkTp * 0.5) momentumStallLimit *= 0.7;

      // 4. Time Decay scaling (مقياس القتل الزمني عبر قراءة السيولة)
      if (
        liveVolatilityPerc > 0 &&
        liveVolatilityPerc < 0.03 &&
        minutesOpen > 2 * timeLimitMultiplier
      ) {
        // Micro-structure is dead flat. Kill it much faster.
        smartTimeDelayLimit = Math.min(smartTimeDelayLimit, 2 * timeLimitMultiplier);
      } else if (liveVolatilityPerc > 0.4) {
        // Market is wild, give it extra time to bounce
        smartTimeDelayLimit *= 1.5;
      }

      // --- 0. KINETIC EXITS: High-Level Distribution & Reversal Guards ---
      if (
        this.settings.kineticUseOpenInterest &&
        oiTrend !== 0 &&
        priceTrend !== 0 &&
        minutesOpen > 0.5
      ) {
        if (trade.type === "LONG") {
          // 🔴 1. تصريف أو Divergence (Distribution)
          // السعر يرتفع أو ثابت، لكن OI ينخفض = الكبار يخرجون خفية
          if (
            oiTrend < -(0.05 * kineticSensitivity) &&
            priceTrend >= -0.05 &&
            trade.pnl > 0
          ) {
            console.log(
              `[SNIPER] 🔴 KINETIC DIVERGENCE: Price holding but OI dropping actively! HIDDEN DISTRIBUTION in ${trade.symbol}. Securing PnL: +$${trade.pnl.toFixed(2)}`,
            );
            await this.closeTrade(
              trade,
              currentPrice,
              "🔴 KINETIC_DISTRIBUTION_EXIT",
            );
            return;
          }

          // ⚠️ 2. سيناريو الانعكاس وضرب الماركت (Shorts Splashing)
          // السعر يسقط بحدة والـ OI يرتفع بحدة = ناس تدخل شورت وتضغط بقوة
          if (priceTrend < -0.08 && oiTrend > 0.05 * kineticSensitivity) {
            console.log(
              `[SNIPER] ⚠️ KINETIC REVERSAL: Price dropping while OI rising fast! SHORTS ENTERING ${trade.symbol}. Exiting NOW.`,
            );
            await this.closeTrade(
              trade,
              currentPrice,
              "⚠️ KINETIC_SHORTS_ATTACK",
            );
            return;
          }
        } else if (trade.type === "SHORT") {
          if (
            oiTrend < -(0.05 * kineticSensitivity) &&
            priceTrend <= 0.05 &&
            trade.pnl > 0
          ) {
            console.log(
              `[SNIPER] 🔴 KINETIC DIVERGENCE: Price holding but OI dropping! SHORTS COVERING in ${trade.symbol}. Securing PnL: +$${trade.pnl.toFixed(2)}`,
            );
            await this.closeTrade(trade, currentPrice, "🔴 KINETIC_COVER_EXIT");
            return;
          }

          if (priceTrend > 0.08 && oiTrend > 0.05 * kineticSensitivity) {
            console.log(
              `[SNIPER] ⚠️ KINETIC REVERSAL: Price rising while OI rising fast! LONGS ENTERING ${trade.symbol}. Exiting NOW.`,
            );
            await this.closeTrade(
              trade,
              currentPrice,
              "⚠️ KINETIC_LONGS_ATTACK",
            );
            return;
          }
        }
      }

      // --- 1. Tactical Profit / Split Taker (اغلاق كلي أو خطف تكتيكي) ---
      if (!isTpDisabled && trade.pnl >= benchmarkTp) {
        if (minutesOpen < 1.5 && !trade.isPartialProfitTaken) {
          // Tactical Split
          trade.isPartialProfitTaken = true;
          trade.realizedPnl = trade.pnl / 2;
          trade.amount = trade.amount / 2;
          trade.isBreakeven = true;
          trade.sl =
            trade.type === "LONG"
              ? trade.entryPrice * 1.002
              : trade.entryPrice * 0.998;
          updated = true;
        } else if (
          trade.isPartialProfitTaken &&
          trade.pnl >= benchmarkTp * 1.5
        ) {
          await this.closeTrade(trade, currentPrice, "🚀 KINETIC_PROFIT_MAX");
          return;
        } else if (!trade.isPartialProfitTaken) {
          await this.closeTrade(trade, currentPrice, "🚀 KINETIC_PROFIT");
          return;
        }
      }

      // --- 2. Dynamic Elastic Trailing (الملاحقة المطاطية من أعلى قمة) ---
      if (
        trade.pnl > 0.1 &&
        trade.highestPrice
      ) {
        const dropFromHighPerc =
          trade.type === "LONG"
            ? ((trade.highestPrice - currentPrice) / trade.highestPrice) * 100
            : ((currentPrice - trade.highestPrice) / trade.highestPrice) * 100;

        if (dropFromHighPerc >= dynamicTrailThreshold) {
          console.log(
            `[SNIPER] 📉 KINETIC SHADOW: Elastic Trailing triggered for ${trade.symbol}. Dropped ${dropFromHighPerc.toFixed(2)}% from highest. Exiting with +$${trade.pnl.toFixed(2)}`,
          );
          await this.closeTrade(
            trade,
            currentPrice,
            "📉 KINETIC_TRAILING_EXIT",
          );
          return;
        }

        // 🐋 BEAST PARABOLIC GUARD: If in high profit (> 1.0%) and Taker Ratio flips hard, get out immediately!
        if (
          this.settings.beastMode &&
          trade.pnlPerc! > 1.0 &&
          currentTakerRatio
        ) {
          if (trade.type === "LONG" && currentTakerRatio < 0.4) {
            console.log(
              `[BEAST 🐺] ⚠️ PARABOLIC REVERSAL: Taker pressure flipped hard to Sell (${currentTakerRatio.toFixed(2)}). Exiting to lock in +$${trade.pnl?.toFixed(2)}`,
            );
            await this.closeTrade(trade, currentPrice, "🐋 BEAST_PARABOLIC_REVERSAL");
            return;
          }
          if (trade.type === "SHORT" && currentTakerRatio > 2.5) {
            console.log(
              `[BEAST 🐺] ⚠️ PARABOLIC REVERSAL: Taker pressure flipped hard to Buy (${currentTakerRatio.toFixed(2)}). Exiting to lock in +$${trade.pnl?.toFixed(2)}`,
            );
            await this.closeTrade(trade, currentPrice, "🐋 BEAST_PARABOLIC_REVERSAL");
            return;
          }
        }

        // 💀 NIGHTMARE PARABOLIC SQUEEZE: Exponential tightening
        if (this.settings.isNightmareMode && trade.pnlPerc! > 2.5) {
          const squeeze = Math.max(
            0.05,
            dynamicTrailThreshold * (1 / (trade.pnlPerc! / 1.5)),
          );
          if (dropFromHighPerc >= squeeze) {
            console.log(
              `[NIGHTMARE 💀] PARABOLIC SQUEEZE TRIGGERED. Secured max profit on ${trade.symbol}: +${trade.pnlPerc?.toFixed(2)}%`,
            );
            await this.closeTrade(trade, currentPrice, "💀 NIGHTMARE_SQUEEZE");
            return;
          }
        }
      }

      // --- 4. Momentum Stagnation (فلتر تجمد الزخم) ---
      // User Request: Only close if momentum is actually DEAD, not if it's still healthy but taking a breather
      // A trade is "healthy" if OI is not dropping significantly and volume flow hasn't collapsed.
      const isHealthyContinuation = oiTrend > -0.01;

      if (trade.highestPriceTime && trade.pnl > 0.1) {
        const minsSinceNewHigh = (Date.now() - trade.highestPriceTime) / 60000;
        if (
          minsSinceNewHigh >= momentumStallLimit &&
          !isMomentumActive &&
          !isHealthyContinuation
        ) {
          console.log(
            `[SNIPER] 🧊 KINETIC SENSE: Momentum Stalled and Dropping for ${trade.symbol}. No new high in ${minsSinceNewHigh.toFixed(1)}m. Securing profit: +$${trade.pnl.toFixed(2)}`,
          );
          await this.closeTrade(trade, currentPrice, "🧊 KINETIC_STALL_EXIT");
          return;
        }
      }

      // --- 5. Kinetic Time & Volatility Decay (القتل الزمني الديناميكي) ---
      // a) Dead micro-structure exit (Only if not a healthy continuation)
      if (
        liveVolatilityPerc > 0 &&
        liveVolatilityPerc < 0.03 &&
        trade.pnl < benchmarkTp &&
        minutesOpen > 2 &&
        !isMomentumActive &&
        !isHealthyContinuation
      ) {
        console.log(
          `[SNIPER] 💤 KINETIC SENSE: Volatility collapsed to ${liveVolatilityPerc.toFixed(3)}%. Micro-structure is dead. Securing PnL: +$${trade.pnl.toFixed(2)}`,
        );
        await this.closeTrade(
          trade,
          currentPrice,
          "💤 KINETIC_VOLATILITY_DEATH",
        );
        return;
      }

      // b) OI Collapse Guard (خروج عند انهيار الاوبن انترست)
      if (
        this.settings.kineticUseOpenInterest &&
        oiTrend < -(0.08 * kineticSensitivity) &&
        trade.pnl >= 0.1
      ) {
        console.log(
          `[SNIPER] 📉 KINETIC SENSE: Open Interest Collapsing (${oiTrend.toFixed(3)}%). Operators leaving. Securing PnL: +$${trade.pnl.toFixed(2)}`,
        );
        await this.closeTrade(trade, currentPrice, "📉 KINETIC_OI_DEATH");
        return;
      }

      // c) Standard adaptive time decay (Only if it's struggling/bleeding, don't exit if it's holding healthy structure)
      if (
        minutesOpen >= smartTimeDelayLimit &&
        !isMomentumActive &&
        !isHealthyContinuation
      ) {
        // If time is up and we haven't hit the benchmark TP, and momentum is dead, get out to preserve capital
        if (trade.pnl < benchmarkTp && trade.pnl > -benchmarkTp * 1.5) {
          console.log(
            `[SNIPER] ⏳ KINETIC DECAY: Time limit reached with weak momentum for ${trade.symbol} (Open ${minutesOpen.toFixed(1)}m). Exiting at PnL: $${trade.pnl.toFixed(2)}`,
          );
          await this.closeTrade(trade, currentPrice, "⏳ KINETIC_DECAY_EXIT");
          return;
        }
      }
    }

    if (updated) {
      saveTrade(trade);
    }
  }

  public async smartExit(symbol: string, currentPrice: number, reason: string) {
    if (this.settings.overrideAllWithAdaptive) {
      console.log(`[SMART EXIT] Bypassed for ${symbol} because Hegemony is active.`);
      return;
    }
    const trade = this.activeTrades.get(symbol);
    if (!trade) return;

    // Check if it's already closed or processing
    if (trade.status !== "OPEN" && trade.status !== "TP1_HIT") return;

    // Close trade prematurely due to indicator reversal
    await this.closeTrade(trade, currentPrice, reason);
  }

  public async wiseExit(symbol: string, currentPrice: number, klines: any[]) {
    if (this.settings.overrideAllWithAdaptive) {
      console.log(`[WISE EXIT] Bypassed for ${symbol} because Hegemony is active.`);
      return;
    }
    const trade = this.activeTrades.get(symbol);
    if (!trade) return;
    if (trade.status === "CLOSED") return;

    const result = this.wiseEngine.analyze(
      trade,
      klines,
      trade.oiHistory?.[trade.oiHistory.length - 1],
    );
    if (result.shouldExit) {
      await this.closeTrade(trade, currentPrice, result.reason);
    }
  }

  private calculateSmartTightStop(trade: Trade, currentPrice: number): number {
    const isLong = trade.type === "LONG";
    const currentSl = trade.sl || 0;
    
    // Calculate the extreme high or low price achieved to detect deviations
    const highestPrice = trade.highestPrice || (isLong ? currentPrice : 0);
    const lowestPrice = trade.lowestPrice || (!isLong ? currentPrice : Infinity);
    
    // Check if the price/market is deteriorating (reversing from best potential prices)
    let isDeteriorating = false;
    let reversePerc = 0;
    if (isLong && highestPrice > currentPrice) {
      isDeteriorating = true;
      reversePerc = ((highestPrice - currentPrice) / highestPrice) * 100;
    } else if (!isLong && currentPrice > lowestPrice && lowestPrice > 0) {
      isDeteriorating = true;
      reversePerc = ((currentPrice - lowestPrice) / lowestPrice) * 100;
    }
    
    // Dynamic trail distance: standard is 0.2% (0.002)
    // "اذا اسوء اعدل واقربها للحد من الخسارة اوالحفاظ علي اقرب ربح"
    // If situation is deteriorating, we tighten the trail distance further to 0.1% (0.001) to squeeze against loss.
    let squeezeRatio = 0.002;
    if (isDeteriorating) {
      squeezeRatio = 0.001; // Squeeze extremely tight to preserve maximum remaining asset value
    } else {
      // If position has moved favorably, adapt tightening depending on current profits
      const basePnlPerc = trade.pnlPerc || 0;
      if (basePnlPerc > 1.5) {
        squeezeRatio = 0.0012; // In strong profit list -> squeeze trail to lock in high returns
      } else {
        squeezeRatio = 0.0018; 
      }
    }
    
    const candidateSl = isLong 
      ? currentPrice * (1 - squeezeRatio)
      : currentPrice * (1 + squeezeRatio);
      
    // Golden safety rule of trailing: we can only lock in better (tighter) positions, never retract!
    if (!currentSl) {
      return candidateSl;
    }
    
    if (isLong) {
      return Math.max(currentSl, candidateSl);
    } else {
      return Math.min(currentSl, candidateSl);
    }
  }

  private async closeTrade(trade: Trade, exitPrice: number, reason: string) {
    if (this.mode === "LIVE" && this.exchange && this.binanceInitialized) {
      try {
        // [INVERSE LOGIC] لإغلاق الصفقة المعكوسة، نستخدم نفس اتجاه القرار الأصلي
        // إذا كان القرار الأصلي LONG (فُتح بـ SELL)، نغلقه بـ BUY
        const side = trade.type === "LONG" ? "buy" : "sell";
        const symbol = trade.symbol;
        const market = this.exchange.market(symbol);
        const quantity = trade.amount / trade.entryPrice;
        const roundedAmount = this.exchange.amountToPrecision(symbol, quantity);

        console.log(
          `[BINANCE] 🏁 Closing INVERSE LIVE ${trade.type} on ${symbol} | Order: ${side.toUpperCase()} | Reason: ${reason}`,
        );
        const order = await this.exchange.createOrder(
          symbol,
          "market",
          side,
          roundedAmount,
          undefined,
          { reduceOnly: true },
        );
        console.log(`[BINANCE] ✅ LIVE Exit Order Placed: ${order.id}`);
        addLog(`Binance LIVE Exit ${symbol} (${reason}) ✅`, "success");
      } catch (e: any) {
        console.error(
          `[BINANCE] ❌ LIVE Exit Failed for ${trade.symbol}:`,
          e.message,
        );
        addLog(`Binance LIVE Exit Failed: ${e.message}`, "error");
        // We still proceed to clear local state even if exchange order fails (to avoid sticking)
        // But ideally we should have a recovery mechanism.
      }
    }

    const market = this.activeTrades.get(trade.symbol);
    trade.exitPrice = exitPrice;
    trade.status = "CLOSED";
    trade.exitTime = Date.now();

    // --- PnL Calculation Logic (Internal Strategy View) ---
    const priceChangePerc =
      trade.type === "LONG"
        ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
        : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;

    // Fees = (Entry Notional * fee) + (Exit Notional * fee)
    const totalFeeRate = this.settings.tradingFeeRate ?? 0.001;
    const singleSideFeeRate = totalFeeRate / 2;
    const entryFee = trade.amount * singleSideFeeRate;
    const exitNotional = trade.amount * (exitPrice / trade.entryPrice);
    const exitFee = exitNotional * singleSideFeeRate;
    const totalFees = entryFee + exitFee;

    const leverage = trade.leverage || 10;

    // Calculate Net PnL $
    const grossPnl = (trade.amount * priceChangePerc) / 100;
    const finalPnl = grossPnl - totalFees + (trade.realizedPnl || 0);

    trade.pnl = finalPnl;
    
    // ROE % = (Final PnL / Margin) * 100
    // This gives the exact ROE shown on Binance
    const margin = trade.amount / leverage;
    trade.pnlPerc = (finalPnl / margin) * 100;

    const badge = trade.pnl > 0 ? "🟢" : "🔴";
    addLog(
      `EXIT ${trade.symbol}: $${trade.pnl.toFixed(2)} (${reason})`,
      trade.pnl > 0 ? "info" : "warn",
    );
    console.log(
      `[SNIPER] ${reason}: Trade Closed on ${trade.symbol}. Final PnL: $${trade.pnl.toFixed(2)}`,
    );
    this.activeTrades.delete(trade.symbol);
    this.tradeHistory.unshift({ ...trade }); // Add to beginning of history
    saveTrade(trade);

    // --- BEAST MODE: NEURAL LEARNING & TRAP REVERSAL ---
    if (this.settings.beastMode) {
      this.handleBeastLearning(trade, exitPrice, reason);
    }
  }

  public async resetData() {
    try {
      await clearTrades();
      this.activeTrades.clear();
      this.tradeHistory = [];
      console.log("[SNIPER] 🧹 Database and memory cleared.");
      addLog("Database and history cleared successfully", "info");
    } catch (e: any) {
      console.error("[SNIPER] ❌ Failed to clear database:", e.message);
      addLog(`Failed to clear database: ${e.message}`, "error");
      throw e;
    }
  }

  private async handleBeastLearning(trade: Trade, exitPrice: number, reason: string) {
    const isLoss = (trade.pnl ?? 0) < 0;
    const timeOpenMinutes = (Date.now() - trade.entryTime) / 60000;

    const learningRate = (this.settings.beastLearnRate ?? 50) / 100; // 0.01 to 1.0

    // 1. Slippage / Stop-Hunt Reversal Exploit (تحويل الانزلاق لربح بذكاء)
    if (
      this.settings.beastSlippageExploit &&
      isLoss &&
      reason === "🛑 STOP_LOSS" &&
      timeOpenMinutes < 3
    ) {
      // Check for "Whale Shadow": If stopped out but OI is still rising, it's a fakeout.
      const lastOI = trade.oiHistory
        ? trade.oiHistory[trade.oiHistory.length - 1]
        : 0;
      const prevOI = trade.oiHistory ? trade.oiHistory[0] : 0;
      const oiStillRising = lastOI > prevOI;

      // Re-entry check: Is there a "Whale Shadow"? (OI rising + Taker Ratio supports original direction)
      const takerPressureConf =
        trade.type === "LONG"
          ? (trade.takerBuySellRatio ?? 1) > 1.2
          : (trade.takerBuySellRatio ?? 1) < 0.8;

      console.log(
        `[BEAST 🐺] STOP-HUNT DETECTED ON ${trade.symbol}. OI Rising: ${oiStillRising}. Taker Conf: ${takerPressureConf}. Preparing Counter-Strike...`,
      );

      if (oiStillRising || takerPressureConf) {
        // Keep the original direction but with ultra-tight SL if it's a re-entry
        const newCond: MarketCondition = {
          symbol: trade.symbol,
          price: exitPrice,
          type: trade.type, // Re-enter original direction!
          score: 6,
          support: trade.type === "LONG" ? exitPrice * 0.998 : exitPrice,
          resistance: trade.type === "SHORT" ? exitPrice * 1.002 : exitPrice,
          isRanging: false,
          isBreakout: true,
          isRetestOrHold: true,
          isLiquidityGood: true,
          isMomentumHigh: true,
          isOrderBookClear: true,
        };

        const originalRisk = this.settings.riskPerTradePerc;
        this.settings.riskPerTradePerc = originalRisk * 1.5; // Aggressive Re-entry

        await this.executeTrade(newCond);
        this.settings.riskPerTradePerc = originalRisk;
      }
    }

    // 2. Auto-Adapt Settings (التعلم الذاتي)
    if (this.settings.beastAutoAdapt) {
      let updated = false;
      // If we've had consecutive losses, tighten conditions. If winning, loosen them to catch more.
      const recent = this.tradeHistory.slice(0, 5);
      const lossCount = recent.filter((t) => (t.pnl ?? 0) < 0).length;
      const winCount = recent.length - lossCount;

      if (lossCount >= 3) {
        this.settings.strictMinRvol = Math.min(
          5,
          (this.settings.strictMinRvol ?? 1.5) + 0.2 * learningRate,
        );
        updated = true;
      } else if (winCount >= 3) {
        this.settings.strictMinRvol = Math.max(
          1.2,
          (this.settings.strictMinRvol ?? 1.5) - 0.2 * learningRate,
        );
        updated = true;
      }

      if (updated) {
        saveSettingsToDB(this.settings);
      }
    }
  }
}

export const sniper = new SniperEngine();
