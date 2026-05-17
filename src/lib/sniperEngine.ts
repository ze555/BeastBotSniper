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
            strictMode: dbSettings.strictMode,
            strictMinVolume: dbSettings.strictMinVolume,
            strictMinRvol: dbSettings.strictMinRvol,
            strictMaxRisk: dbSettings.strictMaxRisk,
            strictMinScore: dbSettings.strictMinScore,
            strictBtcAlignment: dbSettings.strictBtcAlignment,
            strictRsiFilter: dbSettings.strictRsiFilter,
            strictRetest: dbSettings.strictRetest,
            strictFastBreakevenPerc: dbSettings.strictFastBreakevenPerc,
            strictRsiHigh: dbSettings.strictRsiHigh,
            strictRsiLow: dbSettings.strictRsiLow,
            strictRetestPullbackPerc: dbSettings.strictRetestPullbackPerc,
            strictBreakoutDistancePerc: dbSettings.strictBreakoutDistancePerc,
            useSmartExit: dbSettings.useSmartExit ?? false,
            useWiseExit: dbSettings.useWiseExit ?? false,
            useWiseEntry: dbSettings.useWiseEntry ?? false,
            useSlyFox: dbSettings.useSlyFox ?? false,
            useKineticEngine: dbSettings.useKineticEngine ?? false,
            useSmartControl: dbSettings.useSmartControl ?? false,
            beastMode: dbSettings.beastMode ?? false,
            beastConfirmWithSMC: dbSettings.beastConfirmWithSMC ?? false,
            beastConfirmWithVolume: dbSettings.beastConfirmWithVolume ?? false,
            beastMinRvol: dbSettings.beastMinRvol ?? 1.2,
            beastInstitutionalStrength:
              dbSettings.beastInstitutionalStrength ?? 0.4,
            fastExitEnabled: dbSettings.fastExitEnabled ?? false,
            fastExitPerc: dbSettings.fastExitPerc ?? 0.5,
            strategyAdxThreshold: dbSettings.strategyAdxThreshold ?? 25,
            strategyAtrMultiplier: dbSettings.strategyAtrMultiplier ?? 1.5,
            strategyMinConfidence: dbSettings.strategyMinConfidence ?? 0.6,
            strategyRvolThreshold: dbSettings.strategyRvolThreshold ?? 1.5,
            useStrategyTrendFilter: dbSettings.useStrategyTrendFilter ?? true,
            useStrategyVolatilityRule:
              dbSettings.useStrategyVolatilityRule ?? true,
            useStrategyConfidenceGate:
              dbSettings.useStrategyConfidenceGate ?? true,
            useStrategyMomentumRule: dbSettings.useStrategyMomentumRule ?? true,
            dynamicSafetyExit: dbSettings.dynamicSafetyExit ?? true,
            layerGlobalContextEnabled:
              dbSettings.layerGlobalContextEnabled ?? true,
            layerRegimeEnabled: dbSettings.layerRegimeEnabled ?? true,
            layerBiasEnabled: dbSettings.layerBiasEnabled ?? true,
            layerLiquidityEnabled: dbSettings.layerLiquidityEnabled ?? true,
            layerMomentumEnabled: dbSettings.layerMomentumEnabled ?? true,
            layerConfidenceEnabled: dbSettings.layerConfidenceEnabled ?? true,
            layerRiskEnabled: dbSettings.layerRiskEnabled ?? true,
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
    let positionSizeUsd = this.risk.calculatePositionSize(
      this.settings.portfolioSize,
      entryPrice,
      sl,
      leverage,
      maxTrades,
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
    console.log(
      `[QUANTUM] 🟢 EXECUTED: ${trade.type} on ${trade.symbol}. SL: ${sl.toFixed(4)}, TP: ${tp1.toFixed(4)}`,
    );
    saveTrade(trade);
  }

  /**
   * Manage active trades (Trailing stops, Take Profits, and Dynamic Safety Exits)
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
    },
  ) {
    const trade = this.activeTrades.get(symbol);
    if (!trade) return;

    // --- ⚡ FAST EXIT (الخروج السريع - Global Override) ---
    if (this.settings.fastExitEnabled) {
      const exitPerc = this.settings.fastExitPerc || 0.5;

      // حساب التغير المباشر من نقطة الدخول (Price Change %)
      const priceChangePerc =
        trade.type === "LONG"
          ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;

      // 1. حماية رأس المال (Stop Loss الفوري)
      // إذا نزل السعر عن النسبة المحددة من سعر الدخول، اخرج فوراً
      if (priceChangePerc <= -exitPerc) {
        console.log(
          `[FAST EXIT] ⚡ Emergency Stop: Price dropped ${priceChangePerc.toFixed(2)}% below entry. (Threshold: ${exitPerc}%).`,
        );
        await this.closeTrade(trade, currentPrice, `⚡ FAST_EXIT_STOP_LOSS`);
        return;
      }

      // 2. ملاحقة الأرباح وحجزها (Trailing Guard)
      if (trade.highestPrice) {
        const dropFromHighPerc =
          trade.type === "LONG"
            ? ((trade.highestPrice - currentPrice) / trade.highestPrice) * 100
            : ((currentPrice - trade.highestPrice) / trade.highestPrice) * 100;

        // إذا تجاوز الربح ضعف النسبة المحددة (مثلاً 1%)، ننتظر الصعود لأقصى نقطة
        // ولكن إذا بدأ السعر ينزل من القمة بمقدار النسبة المحددة (0.5%)، يتم جني الربح فوراً
        const doubleThreshold = exitPerc * 2;

        if (
          priceChangePerc >= doubleThreshold &&
          dropFromHighPerc >= exitPerc
        ) {
          console.log(
            `[FAST EXIT] ⚡ Profit Locked: Price dropped ${dropFromHighPerc.toFixed(2)}% from peak (${trade.highestPrice.toFixed(4)}) after reaching double target.`,
          );
          await this.closeTrade(
            trade,
            currentPrice,
            `⚡ FAST_EXIT_PROFIT_TAKEN`,
          );
          return;
        }
      }
    }

    // --- DYNAMIC SAFETY EXIT (مراقبة المؤشرات الصارمة بعد الدخول) ---
    if (
      this.settings.dynamicSafetyExit &&
      indicators &&
      trade.status !== "CLOSED"
    ) {
      const isStrict = this.settings.strictMode;
      let failCount = 0;
      let reasons: string[] = [];

      // 1. ADX Threshold Guard (If trend dies, evaluate context)
      const adxThreshold = isStrict
        ? (this.settings.strategyAdxThreshold ?? 25)
        : 15;
      if (indicators.adx && indicators.adx < adxThreshold * 0.6) {
        // Only count as fail if price is also trending against us
        const priceAgainstUs =
          trade.type === "LONG"
            ? currentPrice < trade.entryPrice
            : currentPrice > trade.entryPrice;
        if (priceAgainstUs) {
          failCount++;
          reasons.push(`ADX_DIED (${indicators.adx.toFixed(1)})`);
        }
      }

      // 2. Trend Alignment Guard (EMA Cross Reversal) - Needs Confluence
      if (indicators.emaTrend && indicators.emaTrend !== trade.type) {
        // Check RSI before killing trade immediately on EMA flip
        if (indicators.rsi) {
          const isRsiNeutral = indicators.rsi > 45 && indicators.rsi < 55;
          if (!isRsiNeutral) {
            // Only fail if RSI also confirms momentum reversal
            failCount++;
            reasons.push(`TREND_REVERSED (${indicators.emaTrend})`);
          }
        }
      }

      // 3. RSI Momentum Loss - With Buffer
      if (indicators.rsi) {
        if (trade.type === "LONG" && indicators.rsi < 35) {
          // Lower floor to 35 to handle chop
          failCount++;
          reasons.push(`RSI_MOMENTUM_CRASH (${indicators.rsi.toFixed(1)})`);
        }
        if (trade.type === "SHORT" && indicators.rsi > 65) {
          failCount++;
          reasons.push(`RSI_MOMENTUM_CRASH (${indicators.rsi.toFixed(1)})`);
        }
      }

      // Decision Logic: Requires 2.0 Fail points (Higher wall to prevent noise exits)
      if (failCount >= 2.0) {
        console.log(
          `[DYNAMIC EXIT] 🛡️ Heavy weakness detected in ${trade.symbol}. Reasons: ${reasons.join(", ")}`,
        );
        await this.closeTrade(
          trade,
          currentPrice,
          `🛡️ STRAT_WEAKNESS: ${reasons.shift()}`,
        );
        return;
      }
    }

    // Update floating PnL (Price Change %)
    // --- PnL Calculation Logic (Internal Strategy View) ---
    // We keep this "Natural" to the strategy. User has a UI button to flip it.
    const priceChangePerc =
      trade.type === "LONG"
        ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
        : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;

    trade.currentPrice = currentPrice;

    // Total Fees from Settings (default 0.1% of position size = 0.05% entry + 0.05% exit)
    const totalFeeRate = this.settings.tradingFeeRate ?? 0.001;
    const singleSideFeeRate = totalFeeRate / 2;
    const leverage = trade.leverage || 10;

    // Calculate Exact Fees (Entry vs Exit Notional)
    const entryFee = trade.amount * singleSideFeeRate;
    const exitNotional = trade.amount * (currentPrice / trade.entryPrice);
    const exitFee = exitNotional * singleSideFeeRate;
    const totalFees = entryFee + exitFee;

    // ROE % = (PriceChange% - TotalFees%) * Leverage
    // This matches Binance's ROE calculation for Futures.
    const feeImpactOnPerc = (totalFees / trade.amount) * 100;
    const roePerc = (priceChangePerc * leverage) - (feeImpactOnPerc * leverage);
    trade.pnlPerc = roePerc;

    // PnL $ = Gross PnL - Total Fees
    const grossPnl = (trade.amount * priceChangePerc) / 100;
    let currentPnl = grossPnl - totalFees;
    
    if (trade.realizedPnl) {
      currentPnl += trade.realizedPnl;
    }
    trade.pnl = currentPnl;

    // 1. Layered Position Management Verdict
    const verdict = this.manager.manage(trade as any, currentPrice);
    if (verdict.action === "CLOSE") {
      await this.closeTrade(
        trade,
        currentPrice,
        `CORE_MANAGER: ${verdict.reason}`,
      );
      return;
    } else if (verdict.action === "UPDATE" && verdict.updatedTrade) {
      Object.assign(trade, verdict.updatedTrade);
      saveTrade(trade);
    }

    let updated = false;

    // --- HARD TIME LIMIT EXIT (Max 3 hours to avoid dead money) ---
    const minutesOpenTrade = (Date.now() - trade.entryTime) / 60000;
    const timeLimitMultiplier = this.settings.isLongTerm ? 15 : 1;
    const hardTimeLimit = 180 * timeLimitMultiplier;

    if (minutesOpenTrade >= hardTimeLimit) {
      // 3 Hours maximum (or ~45h in Long Term)
      console.log(
        `[SNIPER] ⏱️ TRADE EXPIRED: ${trade.symbol} holding for over ${hardTimeLimit / 60} hours without hitting TP/SL. Exiting now to free up capital.`,
      );
      await this.closeTrade(trade, currentPrice, "⏱️ TIME_LIMIT_EXIT");
      return;
    }

    // Track live tick history (Micro-Structure)
    if (!trade.tickHistory) trade.tickHistory = [];
    trade.tickHistory.push(currentPrice);
    if (trade.tickHistory.length > 40) trade.tickHistory.shift(); // Keep last 40 live updates

    if (currentOI !== undefined) {
      if (!trade.oiHistory) trade.oiHistory = [];
      trade.oiHistory.push(currentOI);
      if (trade.oiHistory.length > 40) trade.oiHistory.shift();
    }

    if (currentVol !== undefined) {
      if (!trade.volHistory) trade.volHistory = [];
      trade.volHistory.push(currentVol);
      if (trade.volHistory.length > 40) trade.volHistory.shift();
    }

    // update highest price tracker
    if (
      !trade.highestPrice ||
      (trade.type === "LONG"
        ? currentPrice > trade.highestPrice
        : currentPrice < trade.highestPrice)
    ) {
      trade.highestPrice = currentPrice;
      trade.highestPriceTime = Date.now();
      updated = true;
    }

    // --- 🔄 INVERSE BEST PRICE TRACKER (تتبع أفضل سعر لبايننس) ---
    // تتبع السعر الذي يحقق أكبر "خسارة داخلية" (أي أكبر ربح في بايننس)
    if (
      !trade.inverseBestPrice ||
      (trade.type === "LONG"
        ? currentPrice < trade.inverseBestPrice // للأعلى: نريد أقل سعر (أكبر خسارة)
        : currentPrice > trade.inverseBestPrice) // للأسفل: نريد أعلى سعر (أكبر خسارة)
    ) {
      trade.inverseBestPrice = currentPrice;
      updated = true;
    }

    // --- 🔄 INVERSE DYNAMIC TRAILING (ملاحقة السعر المعكوس) ---
    // إذا كان الخيار مفعلاً، الخروج عند ارتداد السعر ضد اتجاه ربح بايننس
    if (this.settings.inverseTrailingEnabled && trade.inverseBestPrice) {
      const sensitivity = this.settings.inverseTrailingSensitivity || 0.05;
      
      // حساب نسبة الارتداد من "أفضل سعر وصل له ربح بايننس"
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
      const benchmarkTp = isTpDisabled ? 1.5 : rawTpInput;
      const baseTrailStart = this.settings.smartTrailingStartUsd ?? 0.4;
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

      const timeLimitMultiplier = this.settings.isLongTerm ? 15 : 1;
      let smartTimeDelayLimit = (this.settings.smartTimeDecayMinutes ?? 5) * timeLimitMultiplier;
      let dynamicTrailThreshold =
        this.settings.smartTrailingThresholdPerc ?? 0.3;
      let momentumStallLimit = (this.settings.smartMomentumStallMinutes ?? 2.5) * timeLimitMultiplier;

      // 💀 NIGHTMARE UPGRADE: Aggressive Tightening
      if (this.settings.isNightmareMode) {
        dynamicTrailThreshold *= 0.8; // Be 20% more sensitive by default
        momentumStallLimit *= 0.7; // Don't wait for stalls
      }

      // 1. Elastic Shadow (الملاحقة المطاطية): Expand buffer if new/volatile, tighten if old
      if (minutesOpen < 3 * timeLimitMultiplier || liveVolatilityPerc > 0.5)
        dynamicTrailThreshold *= 1.5;
      else if (minutesOpen > 10 * timeLimitMultiplier) dynamicTrailThreshold *= 0.6;

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
          // Tactical Split: Extreme velocity detected, secure 50% and leave rest risk-free
          trade.isPartialProfitTaken = true;
          trade.realizedPnl = trade.pnl / 2; // Realize half PnL
          trade.amount = trade.amount / 2; // Halve position
          trade.isBreakeven = true;
          trade.sl =
            trade.type === "LONG"
              ? trade.entryPrice * 1.002
              : trade.entryPrice * 0.998;
          console.log(
            `[SNIPER] ⚡ KINETIC SPLIT: High Velocity! Secured 50% profit (+$${trade.realizedPnl.toFixed(2)}) for ${trade.symbol}.`,
          );
          updated = true;
        } else if (
          trade.isPartialProfitTaken &&
          trade.pnl >= benchmarkTp * 1.5
        ) {
          // Second target hit (Riding the runners)
          console.log(
            `[SNIPER] 🚀 KINETIC ENGINE: Final Target Hit for ${trade.symbol} at +$${trade.pnl.toFixed(2)}`,
          );
          await this.closeTrade(trade, currentPrice, "🚀 KINETIC_PROFIT_MAX");
          return;
        } else if (!trade.isPartialProfitTaken) {
          // Standard Target Hit
          console.log(
            `[SNIPER] 🚀 KINETIC ENGINE: Target Hit for ${trade.symbol} at +$${trade.pnl.toFixed(2)}`,
          );
          await this.closeTrade(trade, currentPrice, "🚀 KINETIC_PROFIT");
          return;
        }
      }

      // --- 2. Trailing Breakeven (تأمين نقطة الدخول والملاحقة) ---
      if (!trade.isBreakeven && trade.pnl >= baseTrailStart) {
        trade.sl =
          trade.type === "LONG"
            ? trade.entryPrice * 1.0015
            : trade.entryPrice * 0.9985;
        trade.isBreakeven = true;
        updated = true;
        console.log(
          `[SNIPER] 🛡️ KINETIC ENGINE: SL moved to Entry+Fees for ${trade.symbol} at +$${trade.pnl.toFixed(2)} PnL!`,
        );
      }

      // --- 3. Dynamic Elastic Trailing (الملاحقة المطاطية من أعلى قمة) ---
      if (
        trade.pnl > Math.max(0.1, baseTrailStart * 0.5) &&
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

    // Filter 4: Aggressive Trade Management (Fast Breakeven)
    if (this.settings.strictMode && !trade.isBreakeven) {
      const triggerPerc = this.settings.strictFastBreakevenPerc ?? 0.4; // Lowered to 0.4% from 0.75%
      if (
        triggerPerc > 0 &&
        ((trade.type === "LONG" && priceChangePerc >= triggerPerc) ||
          (trade.type === "SHORT" && priceChangePerc >= triggerPerc))
      ) {
        trade.sl =
          trade.type === "LONG"
            ? trade.entryPrice * 1.001
            : trade.entryPrice * 0.999;
        trade.isBreakeven = true;
        updated = true;
        console.log(
          `[SNIPER] 🛡️ STRICT MODE: Fast Breakeven triggered for ${trade.symbol} at +${triggerPerc}% PnL!`,
        );
      }
    }

    if (trade.type === "LONG") {
      // Hit TP1 (+1R)
      if (trade.status === "OPEN" && currentPrice >= trade.tp1) {
        trade.status = "TP1_HIT";
        trade.sl = trade.entryPrice; // Move SL to breakeven
        trade.isBreakeven = true;
        updated = true;
        console.log(
          `[SNIPER] 🎯 TP1 Hit for ${trade.symbol}! SL moved to Breakeven (${trade.sl}).`,
        );
      }

      // Hit TP2 (+2R)
      if (currentPrice >= trade.tp2) {
        await this.closeTrade(trade, currentPrice, "🎯 TP2_HIT");
        return;
      }

      // Hit SL
      if (currentPrice <= trade.sl) {
        await this.closeTrade(
          trade,
          currentPrice,
          trade.isBreakeven ? "🛡️ BREAKEVEN" : "🛑 STOP_LOSS",
        );
        return;
      }
    } else {
      // SHORT
      // Hit TP1 (+1R)
      if (trade.status === "OPEN" && currentPrice <= trade.tp1) {
        trade.status = "TP1_HIT";
        trade.sl = trade.entryPrice; // Move SL to breakeven
        trade.isBreakeven = true;
        updated = true;
        console.log(
          `[SNIPER] 🎯 TP1 Hit for ${trade.symbol}! SL moved to Breakeven (${trade.sl}).`,
        );
      }

      // Hit TP2 (+2R)
      if (currentPrice <= trade.tp2) {
        await this.closeTrade(trade, currentPrice, "🎯 TP2_HIT");
        return;
      }

      // Hit SL
      if (currentPrice >= trade.sl) {
        await this.closeTrade(
          trade,
          currentPrice,
          trade.isBreakeven ? "🛡️ BREAKEVEN" : "🛑 STOP_LOSS",
        );
        return;
      }
    }

    // Sync live PNL periodically, but let's just do it directly on update for SL moves
    if (updated) {
      saveTrade(trade);
    }
  }

  public async smartExit(symbol: string, currentPrice: number, reason: string) {
    const trade = this.activeTrades.get(symbol);
    if (!trade) return;

    // Check if it's already closed or processing
    if (trade.status !== "OPEN" && trade.status !== "TP1_HIT") return;

    // Close trade prematurely due to indicator reversal
    await this.closeTrade(trade, currentPrice, reason);
  }

  public async wiseExit(symbol: string, currentPrice: number, klines: any[]) {
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
