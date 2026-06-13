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
import { CreativePositionManager } from "./engine/CreativePositionManager.js";
import { WiseExitEngine } from "./engine/WiseExitEngine.js";
import { FusionEngine } from "./engine/FusionEngine.js";
import { RegimeEngine } from "./engine/RegimeEngine.js";
import { AdaptiveCascadeEngine, ExitDecision } from "./engine/AdaptiveCascadeEngine.js";
import { SteelEngine } from "./engine/SteelEngine.js";
import {
  MarketMetrics,
  MarketRegime,
  TrapType,
  GlobalContext,
} from "../types/trading.js";
import { addLog, getGlobalMarketContext } from "./botRunner.js";

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
  private steelEngine = new SteelEngine();

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
    enableFastBreakeven: false,
    useSmartExit: true,
    useWiseExit: true,
    useWiseEntry: true,
    useSlyFox: true,
    useCreativeEngine: true,
    creativeUseAdaptiveExit: false,
    disableConsecutiveLoss: true,
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
        // Enforce the user's explicit setup constraint: $2000 total portfolio size & Creative Engine enabled
        dbSettings.portfolioSize = 2000;
        dbSettings.useCreativeEngine = 1;
        dbSettings.disableConsecutiveLoss = 1;

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
            enableFastBreakeven: dbSettings.enableFastBreakeven === 1,
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
            useCreativeEngine: dbSettings.useCreativeEngine === 1,
            creativeUseAdaptiveExit: dbSettings.creativeUseAdaptiveExit === 1,
            disableConsecutiveLoss: dbSettings.disableConsecutiveLoss === 1,
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

  private getLiveEntrySide(tradeType: 'LONG' | 'SHORT') {
    return this.settings.enableInverseExecution 
      ? (tradeType === 'LONG' ? 'sell' : 'buy') 
      : (tradeType === 'LONG' ? 'buy' : 'sell');
  }

  private getLiveExitSide(tradeType: 'LONG' | 'SHORT') {
    return this.settings.enableInverseExecution 
      ? (tradeType === 'LONG' ? 'buy' : 'sell') 
      : (tradeType === 'LONG' ? 'sell' : 'buy');
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
   * Savage & Fierce Exit Engine: Ultra-proactive hazard reduction and cascading momentum locks.
   * "محرك خروج شرس ومفترس يلتهم الأرباح مجهرياً ويؤمن الدخول الصارم لمنع أي خسارة"
   */
  private async executeFierceExitEngine(
    trade: Trade,
    currentPrice: number,
    targetConfig: any,
    indicators?: any,
    currentTakerRatio?: number
  ): Promise<boolean> {
    const symbol = trade.symbol;
    let updated = false;

    // 1. Calculate Core Price Changes
    const entryPrice = trade.entryPrice;
    const isLong = trade.type === 'LONG';
    const priceChangePerc = isLong
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;

    // Real-time live PnL and ROE updates so that front-end/UI displays latest metrics under Fierce Exit
    const totalFeeRate = this.settings.tradingFeeRate ?? 0.001;
    const leverage = trade.leverage || this.settings.leverage || 10;
    
    let currentPnl = ((trade.amount * priceChangePerc) / 100) - (trade.amount * totalFeeRate);
    if (trade.realizedPnl) {
        currentPnl += trade.realizedPnl;
    }
    
    const effectiveAmount = trade.originalAmount || trade.amount;
    const margin = effectiveAmount / leverage;
    const roePerc = (currentPnl / margin) * 100;

    trade.pnl = currentPnl;
    trade.pnlPerc = roePerc;

    // Track historical highwater marks
    if (!trade.highestPrice || (isLong ? currentPrice > trade.highestPrice : currentPrice < trade.highestPrice)) {
      trade.highestPrice = currentPrice;
      updated = true;
    }

    const highestPrice = trade.highestPrice || entryPrice;

    // 2. ULTRA-FAST BREAKEVEN GUARD (التأمين الفولاذي اللحظي المستميت)
    const lockThreshold = 0.20; 
    if (this.settings.enableFastBreakeven && !trade.isBreakeven && priceChangePerc >= lockThreshold) {
      const buffer = 1.0006; // Secure 0.06% above entry price to safeguard trading commissions
      trade.sl = isLong ? entryPrice * buffer : entryPrice * (2 - buffer);
      trade.isBreakeven = true;
      updated = true;
      console.log(`[SAVAGE ENG] 🛡️ Ultra-Fast Breakeven Lock activated for ${symbol}. New SL: ${trade.sl.toFixed(4)}`);
      addLog(`🛡️ تأمين الاقتناص الشرس: نقل الوقف تلقائياً وسحب الصفقات لمنطقة الأمان المضمونة لـ ${symbol} عند ${trade.sl.toFixed(4)} | عتبة الحركة: +${priceChangePerc.toFixed(2)}%`, 'success');
    }

    // 3. CASCADING PARTIAL TAKE PROFIT (جني الأرباح المتدرج الصارم)
    const rawTpGoal = targetConfig.takeProfitValue ?? 1.5;
    const tp1Goal = rawTpGoal * 0.45; // Secure fast returns
    if (trade.status === 'OPEN' && priceChangePerc >= tp1Goal) {
      if (!trade.isPartialProfitTaken) {
        if (!trade.originalAmount) trade.originalAmount = trade.amount;
        if (!trade.partialHistory) trade.partialHistory = [];

        trade.isPartialProfitTaken = true;
        trade.status = 'TP1_HIT';
        
        // Liquidate 50% of active value
        const partialPnl = (trade.pnl || 0) * 0.5;
        const prevAmount = trade.amount;
        const closedAmount = prevAmount * 0.5;
        trade.realizedPnl = (trade.realizedPnl || 0) + partialPnl;
        trade.amount = prevAmount * 0.5;

        trade.partialHistory.push({
          closePercent: 50,
          amountClosed: closedAmount,
          realizedPnl: partialPnl,
          exitPrice: currentPrice,
          time: Date.now(),
          targetR: -1 // Savage fast
        });

        // Secure Entry tightly plus lock a fragment of profits (0.15% profit cushion)
        const profitCushion = 1.0015;
        trade.sl = isLong ? entryPrice * profitCushion : entryPrice * (2 - profitCushion);
        
        updated = true;
        console.log(`[SAVAGE ENG] 💸 Quick Cascading Partial TP1 Hit for ${symbol}. Remaining Amount: ${trade.amount}$`);
        addLog(`💸 جني جزئي شرس وجبار: ${symbol} تم تسييل 50% من الرصيد والحد من خطر التسييل كلياً عند ربح +${priceChangePerc.toFixed(2)}%! نقل الوقف إلى المنطقة الآمنة والربحية الاستثنائية!`, 'success');
        
        if (this.mode === 'LIVE' && this.exchange && this.binanceInitialized) {
          try {
            const side = this.getLiveExitSide(trade.type);
            const roundedAmount = this.exchange.amountToPrecision(symbol, (closedAmount / currentPrice));
            console.log(`[BINANCE] 🔄 Savage Partial Order: sending ${side.toUpperCase()} for 50% of size | Qty: ${roundedAmount}`);
            await this.exchange.createOrder(symbol, 'market', side, roundedAmount, undefined, { reduceOnly: true });
          } catch (e: any) {
            console.error(`[BINANCE] Partial Order placement failed: ${e.message}`);
          }
        }
      }
    }

    // 4. PRE-EMPTIVE SLY FOX ESCAPE HATCH (التصفية الاستباقية الفورية قبل الارتداد الزخمي)
    if (priceChangePerc >= 0.1) {
      let triggerEscape = false;
      let escapeReason = "";

      const ratio = currentTakerRatio !== undefined ? currentTakerRatio : 1.0;
      if (isLong && ratio < 0.94) {
        triggerEscape = true;
        escapeReason = `Taker Orderflow Sell shock (Ratio: ${ratio.toFixed(2)})`;
      } else if (!isLong && ratio > 1.06) {
        triggerEscape = true;
        escapeReason = `Taker Orderflow Buy shock (Ratio: ${ratio.toFixed(2)})`;
      }

      if (indicators && indicators.rsi) {
        const rsi = indicators.rsi;
        if (isLong && rsi > 70 && rsi < 67) {
          triggerEscape = true;
          escapeReason = `RSI Extreme exhaustion of long momentum (RSI: ${rsi})`;
        } else if (!isLong && rsi < 30 && rsi > 33) {
          triggerEscape = true;
          escapeReason = `RSI Extreme exhaustion of short momentum (RSI: ${rsi})`;
        }
      }

      if (triggerEscape) {
        console.log(`[SAVAGE ENG] 🦊 Sly Fox Escape Hatch triggered for ${symbol}. Reason: ${escapeReason}`);
        addLog(`🦊 مخرج ثعلب الذهب الاستباقي: إغلاق ${symbol} وتأمين الربح العائم بمعدل +${priceChangePerc.toFixed(2)}% فوراً بسبب تلاشي السيولة الداعمة! [${escapeReason}]`, 'warn');
        await this.closeTrade(trade, currentPrice, `🦊 SLY_FOX_ESCAPE: ${escapeReason}`);
        return true; 
      }
    }

    // 5. SAVAGE TRAILING SQUEEZE (ملاحقة السقف المجهري المطاطي للمكاسب الكبيرة)
    const targetTpVal = targetConfig.takeProfitValue ?? 2.0;
    const isSubstantiallyInProfit = priceChangePerc >= targetTpVal * 0.6;
    if (isSubstantiallyInProfit && highestPrice > 0) {
      const dropFromPeak = isLong
        ? ((highestPrice - currentPrice) / highestPrice) * 100
        : ((currentPrice - highestPrice) / highestPrice) * 100;
      
      const squeezeLimit = targetConfig.takeProfitMode === 'FUSION_CASCADE' ? 0.15 : 0.22;
      if (dropFromPeak >= squeezeLimit) {
        console.log(`[SAVAGE ENG] 🦅 Trailing Squeeze triggered for ${symbol}. Drop: ${dropFromPeak.toFixed(3)}% >= Squeeze limit: ${squeezeLimit}%`);
        addLog(`🦅 اقتناص الحافة الشرسة (Trailing Squeeze): إغلاق ${symbol} على قمة الزخم وحصد الأقرب لقمتها عند ربح حاسم +${priceChangePerc.toFixed(2)}% | الارتداد من ذروة الصعود: ${dropFromPeak.toFixed(2)}%`, 'success');
        await this.closeTrade(trade, currentPrice, `🦅 FIERCE_TRAIL_SQUEEZE_HIT`);
        return true; 
      }
    }

    // 6. Hard safety check against final target limits (TP2/SL)
    const hitHardSL = isLong ? currentPrice <= trade.sl : currentPrice >= trade.sl;
    if (hitHardSL) {
      const isProfitHit = trade.isBreakeven || trade.isPartialProfitTaken;
      console.log(`[SAVAGE ENG] 🛑 Hard SL/Breakeven Triggered for ${symbol} at ${currentPrice}`);
      const isTawleefa = trade.source && trade.source.includes("TAWLEEFA");
      const engineName = isTawleefa ? "التوليفة" : "محرك الخروج الشرس";
      addLog(isProfitHit 
        ? `🔐 إغلاق آمن لـ ${symbol} عند قفل الدخول المأمون بقيمة ${trade.sl.toFixed(4)}. حمي المحرك المكاسب المحققة من الاندثار!` 
        : `🛑 ضرب وقف الخسارة لـ ${symbol} عند سعر ${trade.sl.toFixed(4)} بواسطة ${engineName}. تفادى المحرك انزلاقات أعمق!`, 
        isProfitHit ? 'info' : 'warn'
      );
      await this.closeTrade(trade, currentPrice, isProfitHit ? `🔐 SAVAGE_BREAKEVEN_HIT` : `🛑 SAVAGE_STOP_LOSS_HIT`);
      return true; 
    }

    const hardTp2Price = isLong ? entryPrice * (1 + (rawTpGoal / 100)) : entryPrice * (1 - (rawTpGoal / 100));
    const hitTpPrice = isLong ? currentPrice >= hardTp2Price : currentPrice <= hardTp2Price;
    if (hitTpPrice) {
      console.log(`[SAVAGE ENG] 🏆 Golden Target TP2 Hit for ${symbol} at ${currentPrice}`);
      const isTawleefa = trade.source && trade.source.includes("TAWLEEFA");
      const engineName = isTawleefa ? "التوليفة" : "محرك الخروج الشرس";
      addLog(`🏆 النصر الذهبي لـ ${symbol} عبر ${engineName}: تسييل كامل الصفقة عند الهدف ${currentPrice.toFixed(4)} بربح إجمالي مذهل +${priceChangePerc.toFixed(2)}% !!! ⭐`, 'success');
      await this.closeTrade(trade, currentPrice, `🏆 SAVAGE_TP2_CLIMAX_HIT`);
      return true; 
    }

    if (updated) {
      saveTrade(trade);
      this.activeTrades.set(symbol, trade);
    }
    return false; 
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
    // Calculate ATR if missing
    let atrVal = condition.atr || 0;
    if (!atrVal && klines && klines.length > 1) {
      const trVals: number[] = [];
      const period = Math.min(14, klines.length - 1);
      for (let i = klines.length - period; i < klines.length; i++) {
        if (i <= 0) continue;
        const h = parseFloat(klines[i][2]);
        const l = parseFloat(klines[i][3]);
        const pc = parseFloat(klines[i - 1][4]);
        const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(pc - l));
        trVals.push(tr);
      }
      if (trVals.length > 0) {
        atrVal = trVals.reduce((sum, val) => sum + val, 0) / trVals.length;
      }
    }
    condition.atr = atrVal;

    // 1. Map MarketCondition to MarketMetrics
    const metrics: MarketMetrics = {
      symbol: condition.symbol,
      price: condition.price,
      adx: condition.adx !== undefined ? condition.adx : 25,
      atr: atrVal,
      atrPerc: atrVal ? (atrVal / condition.price) * 100 : 0,
      rsi: condition.rsi !== undefined ? condition.rsi : 50,
      ema50: condition.ema50,
      volume: condition.vol24h || 0,
      rvol: (condition.rvol && condition.rvol > 0) ? condition.rvol : (condition.isMomentumHigh ? 2 : 1),
      spread: condition.spread || 0,
      fundingRate: condition.fundingRate,
      openInterest: condition.oi,
      oiChange: condition.oiChange24h || 0,
      takerRatio: condition.takerBuySellRatio,
      isChop: condition.isRanging,
      isAdxRising: condition.isAdxRising,
      slopes: condition.slopes
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

    // Apply decision bias to type first if valid
    if (decision.bias && decision.bias !== "NEUTRAL") {
      condition.type = decision.bias;
    }

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
    const maxTrades = this.settings.maxConcurrentTrades || 10;
    
    let leverage = this.settings.leverage || 10;
    let sl = 0;
    let tp1 = 0;
    let tp2 = 0;

    let tawleefa: any = null;
    if (this.settings.useTawleefaEngine && this.settings.activeTawleefaJson) {
      try {
        tawleefa = JSON.parse(this.settings.activeTawleefaJson);
      } catch (err) {}
    }

    if (tawleefa) {
      leverage = tawleefa.leverage || leverage;
      
      const currentRegimeName = cond.decision?.regime;
      let targetConfig = tawleefa;
      let usingProfile = false;
      
      if (currentRegimeName && Array.isArray(tawleefa.dynamicRegimeProfiles) && tawleefa.dynamicRegimeProfiles.length > 0) {
        const matchedProfile = tawleefa.dynamicRegimeProfiles.find((p: any) => p.regime === currentRegimeName);
        if (matchedProfile) {
          targetConfig = matchedProfile;
          usingProfile = true;
          console.log(`[⭐ TAWLEEFA EXECUTION] Setting up SL/TP using specific regime profile: ${currentRegimeName}`);
        }
      }

      const slVal = targetConfig.stopLossValue ?? 1.5;
      if (targetConfig.stopLossMode === 'NONE' || targetConfig.stopLossMode === 'DISABLED') {
        sl = cond.type === "LONG" ? 0.000001 : 9999999999;
      } else if (targetConfig.stopLossMode === 'ATR_DYNAMIC' && cond.atr) {
        sl = cond.type === "LONG" ? entryPrice - cond.atr * slVal : entryPrice + cond.atr * slVal;
      } else if (targetConfig.stopLossMode === 'FIXED') {
        sl = cond.type === "LONG" ? entryPrice * (1 - (slVal / 100)) : entryPrice * (1 + (slVal / 100));
      } else {
        sl = cond.type === "LONG" ? entryPrice * 0.98 : entryPrice * 1.02; // 2% fallback
      }

      const tpVal = targetConfig.takeProfitValue ?? 2.0;
      let slDistance = Math.abs(entryPrice - sl);
      if (targetConfig.stopLossMode === 'NONE' || targetConfig.stopLossMode === 'DISABLED') {
        slDistance = entryPrice * 0.015; // 1.5% nominal distance for TP calculation if SL is disabled
      }
      if (targetConfig.takeProfitMode === 'FIXED_R') {
        tp1 = cond.type === "LONG" ? entryPrice + slDistance * tpVal * 0.5 : entryPrice - slDistance * tpVal * 0.5;
        tp2 = cond.type === "LONG" ? entryPrice + slDistance * tpVal : entryPrice - slDistance * tpVal;
      } else {
        tp1 = cond.type === "LONG" ? entryPrice * (1 + (tpVal / 200)) : entryPrice * (1 - (tpVal / 200));
        tp2 = cond.type === "LONG" ? entryPrice * (1 + (tpVal / 100)) : entryPrice * (1 - (tpVal / 100));
      }
    } else {
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

      const riskDist = Math.abs(entryPrice - sl);
      tp1 =
        cond.type === "LONG" ? entryPrice + riskDist * 0.8 : entryPrice - riskDist * 0.8;
      tp2 =
        cond.type === "LONG" ? entryPrice + riskDist * 2.5 : entryPrice - riskDist * 2.5;
    }

    // 2. Risk Engine Validation
    const riskVerdict = this.risk.canTrade(
      this.getActiveTrades(),
      this.tradeHistory,
      this.settings.portfolioSize,
      leverage,
      this.settings.beastMode,
      this.settings.disableConsecutiveLoss || this.settings.useCreativeEngine
    );
    if (!riskVerdict.allowed) {
      console.log(`[RISK] 🛡️ Entry Blocked: ${riskVerdict.reason}`);
      addLog(`Entry Blocked: ${riskVerdict.reason}`, "error");
      return;
    }

    // 3. Position Sizing
    const testConfidence = cond.score ? cond.score * 10 : 70;
    const testVolatility = cond.atr !== undefined ? cond.atr : 1.0;
    const testStability = RegimeEngine.getRecentTrendRespect();
    const testLiquidity = cond.isLiquidityGood ? 1.3 : 0.7;

    const riskPerc = tawleefa ? (tawleefa.riskPerTrade ?? 1.0) : (this.settings.riskPerTradePerc || 1);

    const positionSizeUsd = this.risk.calculatePositionSize(
      this.settings.portfolioSize,
      entryPrice,
      sl,
      leverage,
      maxTrades,
      riskPerc,
      testConfidence,
      testVolatility,
      testStability,
      testLiquidity
    );

    if (positionSizeUsd <= 0) {
      console.warn(
        `[SNIPER] ⚠️ Aborting trade on ${cond.symbol}: Calculated size is zero. Check portfolio settings.`,
      );
      return;
    }

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
      score: cond.score,
      source: source || (tawleefa ? `TAWLEEFA:${tawleefa.name}` : "CORE"),
      isBreakeven: false,
      pnl: 0,
      pnlPerc: 0,
      entryRegime: cond.decision?.regime,
      stopMoved: false,
      partial1Taken: false,
      partial2Taken: false,
    };

    if (this.mode === "LIVE" && this.exchange && this.binanceInitialized) {
      try {
        // [INVERSE LOGIC] عكس الصفقة عند الإرسال لبايننس إذا كان مفعل
        const side = this.getLiveEntrySide(trade.type);
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

  public forceUpdateTrade(trade: Trade) {
    saveTrade(trade);
    this.activeTrades.set(trade.symbol, trade);
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

    // 1. Risk Engine Validation: check global trade limits and portfolio margin
    const riskVerdict = this.risk.canTrade(
      this.getActiveTrades(),
      this.tradeHistory,
      this.settings.portfolioSize,
      leverage,
      this.settings.beastMode,
      this.settings.disableConsecutiveLoss || this.settings.useCreativeEngine
    );
    if (!riskVerdict.allowed) {
      console.log(`[RISK] 🛡️ Quantum Entry Blocked: ${riskVerdict.reason}`);
      addLog(`Quantum Entry Blocked: ${riskVerdict.reason}`, "error");
      return;
    }

    let positionSizeUsd = this.risk.calculatePositionSize(
      this.settings.portfolioSize,
      entryPrice,
      sl,
      leverage,
      maxTrades,
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
      entryRegime: cond.decision?.regime,
      stopMoved: false,
      partial1Taken: false,
      partial2Taken: false,
    };

    if (this.mode === "LIVE" && this.exchange && this.binanceInitialized) {
      try {
        // [INVERSE LOGIC] عكس الصفقة عند الإرسال لبايننس (Quantum)
        const side = this.getLiveEntrySide(trade.type);
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
      isAdxRising?: boolean;
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

    let currentEma50 = currentPrice;
    if (klines && klines.length >= 50) {
        const period = 50;
        const k = 2 / (period + 1);
        let sum = 0;
        for (let i = 0; i < period; i++) {
            sum += parseFloat(klines[i][4]);
        }
        currentEma50 = sum / period;
        for (let i = period; i < klines.length; i++) {
            currentEma50 = (parseFloat(klines[i][4]) - currentEma50) * k + currentEma50;
        }
    }

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

    // --- 00000. SMART SCORE DASHBOARD EXIT EVALUATION (GLOBAL OVERRIDE) ---
    if (this.settings.smartScoreExit?.enabled) {
      const scExit = this.settings.smartScoreExit;
      const metricsObj = {
        takerRatio: currentTakerRatio !== undefined ? currentTakerRatio : 1.0,
      };

      let applies = false;
      if (scExit.applyToAll) {
        applies = true;
      } else if (scExit.selectedTawleefas && scExit.selectedTawleefas.length > 0) {
        const sourceId = trade.source || ""; 
        const isTawleefaStrat = sourceId.startsWith("TAWLEEFA:");
        const namePart = isTawleefaStrat ? sourceId.split("TAWLEEFA:")[1] : "";
        applies = scExit.selectedTawleefas.includes(namePart) || ((trade as any).tawleefaId && scExit.selectedTawleefas.includes((trade as any).tawleefaId));
      }

      if (applies) {
        const enriched = (trade as any).latestEnrichedData || {};
        const ms = enriched.marketStructure || {};
        let score = 0;
        let logs: string[] = [];
        const oiSlope = enriched.oiSlope || 0;
        const spotCvdSlope = enriched.spotCvdSlope || ((metricsObj.takerRatio || 1) - 1.0); // Fallback

        // 1. Market Structure Break
        let msBroken = false;
        if (trade.type === 'LONG' && ms.lowerHigh && ms.lowerLow) {
          msBroken = true;
        } else if (trade.type === 'SHORT' && ms.higherHigh && ms.higherLow) {
          msBroken = true;
        }
        if (msBroken) {
          score += scExit.msBreakPoints || 0;
          logs.push(`كسر البنية (+${scExit.msBreakPoints})`);
        }

        // 2. OI Retreat / Weakening
        if (oiSlope < 0) {
          score += scExit.oiWeakPoints || 0;
          logs.push(`تراجع العقود المفتوحة (+${scExit.oiWeakPoints})`);
        }

        // 3. Spot CVD Against Trade
        let cvdAgainst = false;
        if (trade.type === 'LONG' && spotCvdSlope < 0) {
          cvdAgainst = true;
        } else if (trade.type === 'SHORT' && spotCvdSlope > 0) {
          cvdAgainst = true;
        }
        if (cvdAgainst) {
          score += scExit.cvdPoints || 0;
          logs.push(`عكس مسار السبوت CVD (+${scExit.cvdPoints})`);
        }

        if (score >= (scExit.threshold || 75)) {
          const reasonLog = logs.join(" | ");
          const exitReasonDetail = `تجاوز نظام نقاط الخروج الذكي الحد [${scExit.threshold}] (إجمالي النقاط: ${score}):\n${reasonLog}`;
          console.log(`[⭐ SMART SCORE EXIT] Global absolute override triggered for ${symbol} with score ${score}/${scExit.threshold}`);
          addLog(`🚨 مخرج الطوارئ الذكي (نقاط الخروج): تصفية صفقة ${symbol} فوراً [${exitReasonDetail}]`, 'warn');
          
          await this.forceCloseTrade(trade, currentPrice, `SMART_SCORE_EXIT: ${exitReasonDetail}`);
          return;
        }
      }
    }

    // --- 0000. GROQ AI ABSOLUTE AUTHORITY ---
    if (this.settings.useGroqAI) {
      const managerVerdict = this.manager.manage(trade as any, currentPrice, {
        strictFastBreakevenPerc: this.settings.strictFastBreakevenPerc,
        tradingFeeRate: this.settings.tradingFeeRate,
        leverage: this.settings.leverage
      });

      if (managerVerdict.updatedTrade) {
        Object.assign(trade, managerVerdict.updatedTrade);
        saveTrade(trade);
        this.activeTrades.set(symbol, trade);
      }
      
      const isLong = trade.type === 'LONG';
      const slHit = isLong ? currentPrice <= trade.sl : currentPrice >= trade.sl;
      const tp1Hit = trade.tp1 && (isLong ? currentPrice >= trade.tp1 : currentPrice <= trade.tp1);
      
      if (slHit) {
         addLog(`🚨 تصفية طارئة للحد من الخسارة لـ ${symbol} رغم تفعيل جروك! السعر ضرب الوقف ${trade.sl}`, 'warn');
         await this.forceCloseTrade(trade, currentPrice, 'GROQ_HARD_SL_HIT');
         return;
      }

      if (tp1Hit) {
         addLog(`🎯 تصفية طارئة لجني الربح لـ ${symbol} رغم تفعيل جروك! السعر ضرب الهدف ${trade.tp1}`, 'success');
         await this.forceCloseTrade(trade, currentPrice, 'GROQ_HARD_TP_HIT');
         return;
      }

      return; // Absolute authority complete handoff - Bypass all other logics
    }

    // --- 000. EVALUATE CUSTOM TAWLEEFA EXIT ONLY ---
    // If Tawleefa engine is active, we bypass ALL standard stop losses, take profits, trail lock, and other exit engines.
    // The trade will only exit when the custom Tawleefa rules evaluate to an EXIT_ALL trigger.
    if (this.settings.useTawleefaEngine && this.settings.activeTawleefaJson) {
      try {
        const tawleefa = JSON.parse(this.settings.activeTawleefaJson);
        if (tawleefa) {
          // Calculate Risk R variables
          const initialRiskPriceDist = Math.abs(trade.entryPrice - trade.initialSl);
          const profitR = initialRiskPriceDist > 0.000001
            ? (trade.type === "LONG"
                ? (currentPrice - trade.entryPrice) / initialRiskPriceDist
                : (trade.entryPrice - currentPrice) / initialRiskPriceDist)
            : 0;

          // Map metrics for Tawleefa condition evaluation
          const metricsObj = {
            price: currentPrice,
            openInterest: currentOI !== undefined ? currentOI : (trade.oiHistory && trade.oiHistory.length > 0 ? trade.oiHistory[trade.oiHistory.length - 1] : 0),
            oiChange: (trade.oiHistory && trade.oiHistory.length > 1) ? (((currentOI !== undefined ? currentOI : trade.oiHistory[trade.oiHistory.length - 1]) - trade.oiHistory[trade.oiHistory.length - 2]) / trade.oiHistory[trade.oiHistory.length - 2]) * 100 : 0,
            takerRatio: currentTakerRatio !== undefined ? currentTakerRatio : 1.0,
            rvol: klines && klines.length >= 20 ? (() => {
              const last20Vols = klines.slice(-20).map(k => parseFloat(k[5]));
              const avgVol20 = last20Vols.reduce((a, b) => a + b, 0) / 20;
              const lastVol = currentVol !== undefined ? currentVol : parseFloat(klines[klines.length - 1][5]);
              return avgVol20 > 0 ? lastVol / avgVol20 : 1.0;
            })() : 1.0,
            fundingRate: fundingRate !== undefined ? fundingRate : (trade.fundingRate || 0),
          };

          // Update basic metrics (current PnL, highest/lowest price, etc.)
          const managerVerdict = this.manager.manage(trade as any, currentPrice, {
            strictFastBreakevenPerc: this.settings.strictFastBreakevenPerc,
            tradingFeeRate: this.settings.tradingFeeRate,
            leverage: this.settings.leverage
          });

          if (managerVerdict.updatedTrade) {
            Object.assign(trade, managerVerdict.updatedTrade);
            saveTrade(trade);
            this.activeTrades.set(symbol, trade);
          }

          //--------------------------------
          // 1. DYNAMIC EXIT REGIME PROFILE SELECTION
          //--------------------------------
          const evaluationRegime = trade.entryRegime || adaptiveEval.decision || 'TRENDING';
          const exitProfiles = tawleefa.dynamicExitProfiles || [];
          let profile = exitProfiles.find((p: any) => p.regime === evaluationRegime);

          // Build a synthetic global profile if no specific regime profile exists, using the Tawleefa level settings
          if (!profile) {
            profile = {
              regime: 'GLOBAL_FALLBACK',
              longExitConditions: tawleefa.longExitConditions || [],
              longExitGate: tawleefa.longExitGate || 'AND',
              shortExitConditions: tawleefa.shortExitConditions || [],
              shortExitGate: tawleefa.shortExitGate || 'AND',
              // Add a generic fallback partials mechanism if the user desires
              partials: [],
            } as any;
          } else {
             // If profile exists, but lacks specific long/short exits, fallback to Tawleefa's globals
             if ((!profile.longExitConditions || profile.longExitConditions.length === 0) && tawleefa.longExitConditions && tawleefa.longExitConditions.length > 0) {
               profile.longExitConditions = tawleefa.longExitConditions;
               profile.longExitGate = tawleefa.longExitGate || 'AND';
             }
             if ((!profile.shortExitConditions || profile.shortExitConditions.length === 0) && tawleefa.shortExitConditions && tawleefa.shortExitConditions.length > 0) {
               profile.shortExitConditions = tawleefa.shortExitConditions;
               profile.shortExitGate = tawleefa.shortExitGate || 'AND';
             }
          }

          let decision: 'HOLD' | 'EXIT_NOW' = 'HOLD';
          let exitNowBecauseOfHardExit = false;
          let exitNowBecauseOfConditions = false;
          let exitReasonDetail = "";

          // Helper function to evaluate dynamic exit conditions
          const evaluateExitConditionDetail = (cond: any) => {
            let actualVal = 0;
            const rsiVal = rsi !== undefined ? rsi : 50;
            const adxVal = adx !== undefined ? adx : 25;
            const enriched = (trade as any).latestEnrichedData || {};
            switch (cond.metric) {
              case 'PRICE': actualVal = currentPrice; break;
              case 'OPEN_INTEREST': actualVal = metricsObj.oiChange; break;
              case 'CVD': actualVal = metricsObj.takerRatio; break;
              case 'RVOL': actualVal = metricsObj.rvol; break;
              case 'TAKER_RATIO': actualVal = metricsObj.takerRatio; break;
              case 'FUNDING_RATE': actualVal = metricsObj.fundingRate; break;
              case 'RSI': actualVal = rsiVal; break;
              case 'ADX': actualVal = adxVal; break;
              case 'EMA50_TREND': actualVal = currentEma50 ? (currentPrice > currentEma50 ? 1 : -1) : 0; break;
              case 'OI_SLOPE': actualVal = enriched.oiSlope || 0; break;
              case 'CVD_SLOPE': actualVal = enriched.cvdSlope || 0; break;
              case 'SPOT_CVD': actualVal = enriched.spotCvd_5m || 0; break;
              case 'SPOT_CVD_SLOPE': actualVal = enriched.spotCvdSlope || 0; break;
              case 'PRICE_SLOPE': actualVal = enriched.priceSlope || 0; break;
              case 'VOLUME_SLOPE': actualVal = enriched.volumeSlope || 0; break;
              case 'DELTA_VOLUME': actualVal = enriched.deltaVolume || 0; break;
              case 'BID_ABSORPTION': actualVal = enriched.bidAbsorption || 0; break;
              case 'ASK_ABSORPTION': actualVal = enriched.askAbsorption || 0; break;
              case 'HH_HL': actualVal = enriched.marketStructure?.higherHigh && enriched.marketStructure?.higherLow ? 1 : 0; break;
              case 'LH_LL': actualVal = enriched.marketStructure?.lowerHigh && enriched.marketStructure?.lowerLow ? 1 : 0; break;
              default: actualVal = currentPrice;
            }

            let isTrue = false;
            if (cond.operator === 'GREATER_THAN') {
              isTrue = actualVal > cond.valueNumber;
            } else if (cond.operator === 'LESS_THAN') {
              isTrue = actualVal < cond.valueNumber;
            } else if (cond.operator === 'CROSSES_ABOVE') {
              isTrue = actualVal >= cond.valueNumber;
            } else if (cond.operator === 'CROSSES_BELOW') {
              isTrue = actualVal <= cond.valueNumber;
            } else if (cond.operator === 'SPIKE') {
              isTrue = Math.abs(actualVal) >= cond.valueNumber;
            } else if (cond.operator === 'EXPECT_LONG') {
              isTrue = actualVal > 0;
            } else if (cond.operator === 'EXPECT_SHORT') {
              isTrue = actualVal < 0;
            } else if (cond.operator === 'IS_RISING') {
              if (cond.metric === 'ADX') isTrue = indicators?.isAdxRising === true;
              else if (cond.metric === 'OPEN_INTEREST') isTrue = actualVal > 0.05;
              else if (cond.metric === 'RVOL') isTrue = actualVal > 1.05;
              else isTrue = false;
            } else if (cond.operator === 'IS_FALLING') {
              if (cond.metric === 'ADX') isTrue = indicators?.isAdxRising === false;
              else if (cond.metric === 'OPEN_INTEREST') isTrue = actualVal < -0.05;
              else if (cond.metric === 'RVOL') isTrue = actualVal < 0.95;
              else isTrue = false;
            } else {
              isTrue = actualVal > cond.valueNumber;
            }
            return isTrue;
          };

          if (profile) {
            // A. Dynamic Breakeven R (Capital Protection)
            if (this.settings.enableFastBreakeven && profile.breakevenR !== undefined && profitR >= profile.breakevenR && !trade.stopMoved) {
              trade.sl = trade.entryPrice;
              trade.stopMoved = true;
              trade.isBreakeven = true;
              console.log(`[⭐ TAWLEEFA DYNAMIC CAP-PROTECT] Moved stop loss to Break Even (${trade.entryPrice}) for ${symbol} at profitR = ${profitR.toFixed(2)}`);
              addLog(`🔒 حماية رأس المال الديناميكية: تم نقل وقف الخسارة إلى سعر الدخول لصفقة ${symbol} عند تحقيق +${profile.breakevenR}R`, 'info');
              saveTrade(trade);
              this.activeTrades.set(symbol, trade);
            }

            // B. Dynamic Partials taking
            if (profile.partials && profile.partials.length > 0) {
              if (!trade.takenPartials) {
                trade.takenPartials = [];
              }
              for (const p of profile.partials) {
                if (profitR >= p.profitR && !trade.takenPartials.includes(p.profitR)) {
                  if (!trade.originalAmount) {
                    trade.originalAmount = trade.amount;
                  }
                  if (!trade.partialHistory) {
                    trade.partialHistory = [];
                  }

                  const reduceFraction = p.closePercent / 100;
                  const currentPnl = trade.pnl || 0;
                  const chunkPnl = currentPnl * reduceFraction;
                  trade.realizedPnl = (trade.realizedPnl || 0) + chunkPnl;
                  
                  const prevAmount = trade.amount;
                  const closedAmount = prevAmount * reduceFraction;
                  trade.amount = trade.amount * (1 - reduceFraction);
                  
                  trade.partialHistory.push({
                    closePercent: p.closePercent,
                    amountClosed: closedAmount,
                    realizedPnl: chunkPnl,
                    exitPrice: currentPrice,
                    time: Date.now(),
                    targetR: p.profitR
                  });

                  trade.takenPartials.push(p.profitR);
                  trade.isPartialProfitTaken = true;
                  trade.status = 'TP1_HIT'; // Align with UI expectations
                  
                  console.log(`[⭐ TAWLEEFA DYNAMIC PARTIAL] 💸 Taken ${p.closePercent}% partial profit at +${p.profitR}R for ${symbol}. Remaining Amount: ${trade.amount}$`);
                  addLog(`💸 جني أرباح جزئي ديناميكي (${p.closePercent}%): تصفية جزء من صفقة ${symbol} عند تحقيق +${p.profitR}R. المتبقي: ${trade.amount.toFixed(2)}$`, 'success');
                  
                  if (this.mode === 'LIVE' && this.exchange && this.binanceInitialized) {
                    try {
                      const side = this.getLiveExitSide(trade.type);
                      const quantityToClose = (prevAmount * reduceFraction) / currentPrice;
                      const roundedAmount = this.exchange.amountToPrecision(symbol, quantityToClose);
                      await this.exchange.createOrder(symbol, 'market', side, roundedAmount, undefined, { reduceOnly: true });
                    } catch (e: any) {
                      console.error(`[BINANCE] Dynamic Tawleefa Partial Order failed: ${e.message}`);
                    }
                  }
                  saveTrade(trade);
                  this.activeTrades.set(symbol, trade);
                }
              }
            }

            // C. Dynamic Hard Exit R
            exitNowBecauseOfHardExit = false;
            exitNowBecauseOfConditions = false;
            exitReasonDetail = "";

            if (profile.hardExitR !== undefined && profitR >= profile.hardExitR) {
              decision = 'EXIT_NOW';
              exitNowBecauseOfHardExit = true;
              exitReasonDetail = `تحقيق هدف الربح الصلب الديناميكي (Hard Exit R) والمستهدف (+${profile.hardExitR}R)، بينما المحقق حالياً هو (+${profitR.toFixed(2)}R)`;
              console.log(`[⭐ TAWLEEFA DYNAMIC HARD EXIT] profitR ${profitR.toFixed(2)} >= hardExitR ${profile.hardExitR} for ${symbol}`);
            }

            // D. Dynamic Exit Conditions Evaluation
            if (decision !== 'EXIT_NOW') {
              let conditionsToEvaluate = profile.exitConditions || [];
              let gateRaw = profile.exitGate || 'AND';

              if (trade.type === 'LONG' && profile.longExitConditions && profile.longExitConditions.length > 0) {
                conditionsToEvaluate = profile.longExitConditions;
                gateRaw = profile.longExitGate || 'AND';
              } else if (trade.type === 'SHORT' && profile.shortExitConditions && profile.shortExitConditions.length > 0) {
                conditionsToEvaluate = profile.shortExitConditions;
                gateRaw = profile.shortExitGate || 'AND';
              }

              if (conditionsToEvaluate && conditionsToEvaluate.length > 0) {
                const condDetails = conditionsToEvaluate.map((cond: any) => {
                  let actualVal = 0;
                  const rsiVal = rsi !== undefined ? rsi : 50;
                  const adxVal = adx !== undefined ? adx : 25;
                  const enriched = (trade as any).latestEnrichedData || {};
                  
                  // Compute fallbacks for slopes if enriched is empty
                  if (!enriched.oiSlope && trade.oiHistory && trade.oiHistory.length >= 2) {
                     enriched.oiSlope = (trade.oiHistory[trade.oiHistory.length - 1] - trade.oiHistory[0]) / trade.oiHistory.length;
                  }
                  if (!enriched.priceSlope && trade.tickHistory && trade.tickHistory.length >= 2) {
                     enriched.priceSlope = (trade.tickHistory[trade.tickHistory.length - 1] - trade.tickHistory[0]) / trade.tickHistory.length;
                  }
                  if (!enriched.volumeSlope && trade.volHistory && trade.volHistory.length >= 2) {
                     enriched.volumeSlope = (trade.volHistory[trade.volHistory.length - 1] - trade.volHistory[0]) / trade.volHistory.length;
                  }
                  
                  switch (cond.metric) {
                    case 'PRICE': actualVal = currentPrice; break;
                    case 'OPEN_INTEREST': actualVal = metricsObj.oiChange; break;
                    case 'CVD': actualVal = metricsObj.takerRatio; break;
                    case 'RVOL': actualVal = metricsObj.rvol; break;
                    case 'TAKER_RATIO': actualVal = metricsObj.takerRatio; break;
                    case 'FUNDING_RATE': actualVal = metricsObj.fundingRate; break;
                    case 'RSI': actualVal = rsiVal; break;
                    case 'ADX': actualVal = adxVal; break;
                    case 'EMA50_TREND': actualVal = currentEma50 ? (currentPrice > currentEma50 ? 1 : -1) : 0; break;
                    case 'OI_SLOPE': actualVal = enriched.oiSlope || 0; break;
                    case 'CVD_SLOPE': actualVal = enriched.cvdSlope || 0; break;
                    case 'SPOT_CVD': actualVal = enriched.spotCvd_5m || 0; break;
                    case 'SPOT_CVD_SLOPE': actualVal = enriched.spotCvdSlope || 0; break;
                    case 'PRICE_SLOPE': actualVal = enriched.priceSlope || 0; break;
                    case 'VOLUME_SLOPE': actualVal = enriched.volumeSlope || 0; break;
                    case 'DELTA_VOLUME': actualVal = enriched.deltaVolume || 0; break;
                    case 'BID_ABSORPTION': actualVal = enriched.bidAbsorption || 0; break;
                    case 'ASK_ABSORPTION': actualVal = enriched.askAbsorption || 0; break;
                    case 'HH_HL': actualVal = enriched.marketStructure?.higherHigh && enriched.marketStructure?.higherLow ? 1 : 0; break;
                    case 'LH_LL': actualVal = enriched.marketStructure?.lowerHigh && enriched.marketStructure?.lowerLow ? 1 : 0; break;
                    default: actualVal = currentPrice;
                  }
                  const isTrue = evaluateExitConditionDetail(cond);
                  const opArabic = cond.operator === 'GREATER_THAN' ? 'أكبر من 🡵' :
                                   cond.operator === 'LESS_THAN' ? 'أصغر من 🡶' :
                                   cond.operator === 'CROSSES_ABOVE' ? 'تجاوز لأعلى 🡵' :
                                   cond.operator === 'CROSSES_BELOW' ? 'تجاوز لأسفل 🡶' :
                                   cond.operator === 'SPIKE' ? 'انفجار قفزة ⚡' : 'يساوي';
                  return {
                    isTrue,
                    text: `شرط [${cond.metric}]: القيمة الفعلية (${actualVal.toFixed(3)}) مقارنة بـ ${opArabic} (${cond.valueNumber}) 🡪 [${isTrue ? '✅ محقق' : '❌ غير محقق'}]`
                  };
                });

                const condResults = condDetails.map((d: any) => d.isTrue);
                let conditionsMet = false;
                
                // USER IMPERATIVE: We force AND logic for Tawleefa exits regardless of the saved 'gate' to guarantee all conditions are met
                conditionsMet = condResults.every((r: boolean) => r);

                if (conditionsMet) {
                  decision = 'EXIT_NOW';
                  exitNowBecauseOfConditions = true;
                  const matchedCondsText = condDetails.map((d: any) => d.text).join(" \n ");
                  exitReasonDetail = `تطابق جميع شروط الخروج الديناميكية [إلزامي: AND]: \n ${matchedCondsText}`;
                  console.log(`[⭐ TAWLEEFA DYNAMIC CONDITIONS MET] Exit Conditions met under ${evaluationRegime} for ${symbol} using strict AND`);
                }
              }
            }
          }

          // Execute physical exit if dynamic results require it
          if (decision === 'EXIT_NOW') {
            console.log(`[⭐ TAWLEEFA DYNAMIC EXIT_NOW] Triggered dynamic exit for ${symbol}`);
            const detailedReason = exitNowBecauseOfHardExit 
              ? `خروج الربح الصلب الديناميكي لكبار القوم: ${exitReasonDetail}`
              : `شروط الخروج الديناميكية للتوليفة: ${exitReasonDetail}`;
            addLog(`🚨 خروج التوليفة الديناميكي: تصفية صفقة ${symbol} فوراً بموجب [${detailedReason}] لـ "${tawleefa.name}" (${evaluationRegime})`, 'warn');
            await this.closeTrade(trade, currentPrice, `TAWLEEFA_EXIT_NOW: ${detailedReason}`);
            return;
          }

          // Dynamic Hard Stop Loss protection (If price passes trade.sl which could be initial Sl or entry/breakeven)
          const isLong = trade.type === 'LONG';
          const slHit = isLong ? currentPrice <= trade.sl : currentPrice >= trade.sl;
          if (slHit) {
            if (tawleefa.ignoreInitialStopLoss && !trade.isBreakeven) {
              if (!(trade as any).ignoreSlLogged) {
                console.log(`[⭐ TAWLEEFA SL HIT IGNORED] Price crossed stop loss ${trade.sl} for ${symbol} but ignoreInitialStopLoss is true`);
                (trade as any).ignoreSlLogged = true;
              }
            } else {
              console.log(`[⭐ TAWLEEFA SL HIT] Price crossed stop loss ${trade.sl} for ${symbol} at ${currentPrice}`);
              const isBE = trade.isBreakeven ? "تأمين حماية رأس المال (Break-even)" : "وقف الخسارة المبدئي المحدد";
              const slDetail = `ضرب خط الدفاع المالي (${isBE}) عند السعر [${trade.sl.toFixed(4)}] ومستوى الوقف [${trade.sl.toFixed(4)}]`;
              addLog(`🚨 تصفية التوليفة للحماية: تصفية صفقة ${symbol} فوراً لضرب وقف الخسارة عند ${trade.sl.toFixed(4)} (${isBE})`, 'warn');
              await this.closeTrade(trade, currentPrice, `TAWLEEFA_SL_HIT: ${slDetail}`);
              return;
            }
          }

          // Bypass standard exit rules since Tawleefa Engine has absolute authority!
          return;
        }
      } catch (err) {
        console.error("Error executing custom tawleefa exit evaluation:", err);
      }
    } else if (this.settings.useFierceExitEngine) {
      // Create independent target config from global fierce setting parameters
      const independentConfig = {
        takeProfitValue: this.settings.fierceTakeProfitValue ?? 1.5,
        takeProfitMode: this.settings.fierceTakeProfitMode ?? 'FUSION_CASCADE'
      };
      await this.executeFierceExitEngine(trade, currentPrice, independentConfig, indicators, currentTakerRatio);
      return; // Absolute authority complete handoff
    }

    // --- SPECIAL HANDLING: CREATIVE POSITION STATE MACHINE (Gap 6 / Point 6) ---
    if (trade.source && trade.source.startsWith("CREATIVE_") && !this.settings.creativeUseAdaptiveExit) {
      // 1. Calculate inline parameters for the Creative State Machine
      let inlineRvol = 1.0;
      if (klines && klines.length >= 20) {
        const last20Vols = klines.slice(-20).map(k => parseFloat(k[5]));
        const avgVol20 = last20Vols.reduce((a, b) => a + b, 0) / 20;
        const lastVol = currentVol !== undefined ? currentVol : parseFloat(klines[klines.length - 1][5]);
        inlineRvol = avgVol20 > 0 ? lastVol / avgVol20 : 1.0;
      }

      let inlineOiUp = false;
      let inlineOiVelocity = 1.0;
      if (trade.oiHistory && trade.oiHistory.length >= 2) {
        const prevOI = trade.oiHistory[trade.oiHistory.length - 2];
        const lastOI = currentOI !== undefined ? currentOI : trade.oiHistory[trade.oiHistory.length - 1];
        inlineOiVelocity = prevOI > 0 ? lastOI / prevOI : 1.0;
        inlineOiUp = inlineOiVelocity > 1.0005;
      }

      let inlineAtr = 1.0;
      if (klines && klines.length >= 15) {
        let trSum = 0;
        for (let i = klines.length - 14; i < klines.length; i++) {
          const h = parseFloat(klines[i][2]);
          const l = parseFloat(klines[i][3]);
          const pc = parseFloat(klines[i - 1][4]);
          const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
          trSum += tr;
        }
        const avgTr = trSum / 14;
        inlineAtr = currentPrice > 0 ? (avgTr / currentPrice) * 100 : 1.0;
      }

      const creativeTakerRatio = currentTakerRatio !== undefined ? currentTakerRatio : 1.0;

      // Execute Creative Position State Machine!
      const creativeVerdict = CreativePositionManager.manage(
        trade,
        currentPrice,
        inlineRvol,
        creativeTakerRatio,
        inlineOiUp,
        inlineOiVelocity,
        inlineAtr
      );

      if (creativeVerdict.action === "CLOSE") {
        console.log(`[CREATIVE SM] 🚨 EXIT TRIGGERED for ${symbol}: ${creativeVerdict.reason}`);
        addLog(`🎨 اغلاق ابداعي: ${symbol} | السبب: ${creativeVerdict.reason}`, 'warn');
        await this.closeTrade(trade, currentPrice, creativeVerdict.reason || "CREATIVE_SM_EXIT");
        return;
      } else if (creativeVerdict.action === "PARTIAL" && creativeVerdict.updatedTrade) {
        Object.assign(trade, creativeVerdict.updatedTrade);
        console.log(`[CREATIVE SM] 💸 PARTIAL EXIT for ${symbol}: ${creativeVerdict.reason}`);
        addLog(`💸 جني ربح جزئي ابداعي: ${symbol} تم بيع 50% وتأمين الدخول بقفل مأمون.`, 'success');
        updated = true;
      } else if (creativeVerdict.action === "UPDATE" && creativeVerdict.updatedTrade) {
        Object.assign(trade, creativeVerdict.updatedTrade);
        console.log(`[CREATIVE SM] 🔄 STATE UPDATE for ${symbol}: ${creativeVerdict.reason}`);
        updated = true;
      }

      if (updated) {
        saveTrade(trade);
        this.activeTrades.set(symbol, trade);
      }
      return; // Complete bypass other managers so creative exit mechanisms do NOT get touched by normal/hegemony models
    }

    // --- 00. STEEL ENGINE MAXIMUM EXIT SYSTEM OVERRIDE ---
    // If the Steel Engine is enabled, it takes total control over position exit behavior.
    if (this.settings.useSteelEngine) {
      const steelDecision = this.steelEngine.analyzeExit(
        trade,
        currentPrice,
        takerRatioVal,
        this.settings,
        fundingRate !== undefined ? fundingRate : (trade.fundingRate || 0),
        klines,
        trade.oiHistory || [],
        trade.volHistory || []
      );

      trade.latestSteelResult = {
        time: Date.now(),
        decision: steelDecision.decision,
        reason: steelDecision.reason,
        longProb: steelDecision.longProb,
        shortProb: steelDecision.shortProb,
        confidence: steelDecision.confidence,
        exitIndicator: steelDecision.exitIndicator,
        currentState: steelDecision.currentState,
        marketNarrative: steelDecision.marketNarrative,
        takerRatio: takerRatioVal,
        oiChange: trade.oiHistory && trade.oiHistory.length >= 2 
          ? ((trade.oiHistory[trade.oiHistory.length - 1] - trade.oiHistory[trade.oiHistory.length - 2]) / trade.oiHistory[trade.oiHistory.length - 2]) * 100 
          : 0,
        fundingRate: fundingRate !== undefined ? fundingRate : (trade.fundingRate || 0)
      };

      // Set latestAdaptiveResult fallback so existing card-level fallback fields are gracefully populated too
      trade.latestAdaptiveResult = {
        time: Date.now(),
        decision: steelDecision.decision,
        reason: steelDecision.exitIndicator,
        score: steelDecision.confidence,
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

      // 1. Direct EXIT decision: close instantly!
      if (steelDecision.decision === 'EXIT_NOW') {
        console.log(`[STEEL EXIT] 🚨 DECISION: EXIT_NOW for ${symbol}. Reason: ${steelDecision.reason}`);
        addLog(`🛡️ مخرج الفولاذي المطلق: تصفية صفقة ${symbol} | السبب: ${steelDecision.exitIndicator}`, 'warn');
        await this.closeTrade(trade, currentPrice, `⚡ STEEL_EXIT_NOW: ${steelDecision.reason}`);
        return;
      }

      // 2. PARTIAL PROFIT: close 50% and secure entry
      if (steelDecision.decision === 'PARTIAL_PROFIT' && !trade.isPartialProfitTaken) {
        if (!trade.originalAmount) trade.originalAmount = trade.amount;
        if (!trade.partialHistory) trade.partialHistory = [];

        trade.isPartialProfitTaken = true;
        const entryPrice = trade.entryPrice;
        trade.sl = entryPrice; // secure break even
        const partialPnl = (trade.pnl || 0) * 0.5;
        const prevAmount = trade.amount;
        const closedAmount = prevAmount * 0.5;
        trade.realizedPnl = (trade.realizedPnl || 0) + partialPnl;
        trade.amount = prevAmount * 0.5;
        
        trade.partialHistory.push({
          closePercent: 50,
          amountClosed: closedAmount,
          realizedPnl: partialPnl,
          exitPrice: currentPrice,
          time: Date.now(),
          targetR: -1 // Steel Exit
        });

        console.log(`[STEEL EXIT] 💸 DECISION: PARTIAL_PROFIT for ${symbol}. Reason: ${steelDecision.reason}`);
        addLog(`💸 جني جزئي فولاذي: ${symbol} | تم إغلاق 50% وتأمين دخول الوقف عند ${entryPrice.toFixed(4)} | السبب: ${steelDecision.reason}`, 'success');
        
        if (this.mode === 'LIVE' && this.exchange && this.binanceInitialized) {
          try {
            const side = this.getLiveExitSide(trade.type);
            const roundedAmount = this.exchange.amountToPrecision(symbol, closedAmount / currentPrice);
            console.log(`[BINANCE] 🔄 Steel Partial Order: sending ${side.toUpperCase()} for 50% of size | Qty: ${roundedAmount}`);
            await this.exchange.createOrder(symbol, 'market', side, roundedAmount, undefined, { reduceOnly: true });
          } catch (e: any) {
            console.error(`[BINANCE] Steel Partial Order placement failed: ${e.message}`);
          }
        }
        
        updated = true;
      }

      // 3. TRAIL TIGHT: tighten SL dynamically and check if breached
      if (steelDecision.decision === 'TRAIL_TIGHT') {
        const smartSl = this.calculateSmartTightStop(trade, currentPrice);
        const oldSl = trade.sl;
        if (trade.type === 'LONG' && smartSl > oldSl) {
          trade.sl = smartSl;
          updated = true;
        } else if (trade.type === 'SHORT' && smartSl < oldSl) {
          trade.sl = smartSl;
          updated = true;
        }

        // Verify if Stop Loss has been triggered
        const hitSl = trade.type === 'LONG' ? currentPrice <= trade.sl : currentPrice >= trade.sl;
        if (hitSl) {
          console.log(`[STEEL EXIT] 🛑 TRAIL_TIGHT Stop Loss Hit for ${symbol} at ${currentPrice}`);
          addLog(`🛡️ الوقف المشدد الفولاذي: ضرب الوقف لصفقة ${symbol} عند ${trade.sl.toFixed(4)} | السعر الحركي: ${currentPrice}`, 'warn');
          await this.closeTrade(trade, currentPrice, `🛡️ STEEL_TRAIL_TIGHT_HIT`);
          return;
        }
      }

      // 4. Standard hard boundaries (Stop Loss & Take Profit) if NOT in HOLD_FOR_MOON status and NOT in steelMaxLossMode
      if (steelDecision.decision !== 'HOLD_FOR_MOON' && !this.settings.steelMaxLossMode) {
        // Stop Loss
        const hitSl = trade.type === 'LONG' ? currentPrice <= trade.sl : currentPrice >= trade.sl;
        if (hitSl) {
          console.log(`[STEEL EXIT] 🛑 Stop Loss Hit for ${symbol} at ${currentPrice}`);
          addLog(`🛑 مخرج الفولاذي (ضرب الوقف): إغلاق ${symbol} عند وقف الخسارة ${trade.sl.toFixed(4)}`, 'warn');
          await this.closeTrade(trade, currentPrice, `🛑 STEEL_STOP_LOSS_HIT`);
          return;
        }

        // Take Profit
        const hitTp = trade.type === 'LONG' ? currentPrice >= trade.tp1 : currentPrice <= trade.tp1;
        if (hitTp) {
          console.log(`[STEEL EXIT] 🏆 Take Profit Hit for ${symbol} at ${currentPrice}`);
          addLog(`🏆 مخرج الفولاذي (الربح المستهدف): إغلاق ${symbol} بنجاح عند الهدف ${trade.tp1.toFixed(4)}`, 'success');
          await this.closeTrade(trade, currentPrice, `🏆 STEEL_TAKE_PROFIT_HIT`);
          return;
        }
      } else {
        // HOLD_FOR_MOON downside safety trailing stop
        const hitSl = trade.type === 'LONG' ? currentPrice <= trade.sl : currentPrice >= trade.sl;
        if (hitSl) {
          console.log(`[STEEL EXIT] 🛑 Hold For Moon SL hit for ${symbol}`);
          addLog(`🌑 حماية الارباح الفولاذية: إغلاق ${symbol} على ضرب وقف تتبع القمر في المنطقة الآمنة`, 'warn');
          await this.closeTrade(trade, currentPrice, `🚀 STEEL_MOON_TRAIL_HIT`);
          return;
        }
      }

      // Update regular statistics for card calculations (PnL / metrics)
      const managerVerdict = this.manager.manage(trade as any, currentPrice, {
        strictFastBreakevenPerc: this.settings.strictFastBreakevenPerc,
        tradingFeeRate: this.settings.tradingFeeRate,
        leverage: this.settings.leverage
      });
      if (managerVerdict.updatedTrade) {
        Object.assign(trade, managerVerdict.updatedTrade);
        updated = true;
      }

      if (updated) {
        saveTrade(trade);
        this.activeTrades.set(symbol, trade);
      }
      return; // Absolute authority complete handoff
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
        if (!trade.originalAmount) trade.originalAmount = trade.amount;
        if (!trade.partialHistory) trade.partialHistory = [];

        trade.isPartialProfitTaken = true;
        const partialPnl = trade.pnl / 2;
        const prevAmount = trade.amount;
        const closedAmount = prevAmount / 2;
        trade.realizedPnl = (trade.realizedPnl || 0) + partialPnl;
        trade.amount = prevAmount / 2;
        trade.isBreakeven = true;
        // Move SL to entry + security
        trade.sl = trade.type === "LONG" ? trade.entryPrice * 1.002 : trade.entryPrice * 0.998;
        
        trade.partialHistory.push({
          closePercent: 50,
          amountClosed: closedAmount,
          realizedPnl: partialPnl,
          exitPrice: currentPrice,
          time: Date.now(),
          targetR: -1 // Tactical Kinetic Split
        });

        if (this.mode === 'LIVE' && this.exchange && this.binanceInitialized) {
          try {
            const side = this.getLiveExitSide(trade.type);
            const quantityToClose = closedAmount / currentPrice;
            const roundedAmount = this.exchange.amountToPrecision(trade.symbol, quantityToClose);
            console.log(`[BINANCE] 🔄 Tactical Split Order: sending ${side.toUpperCase()} for 50% of size | Qty: ${roundedAmount}`);
            await this.exchange.createOrder(trade.symbol, 'market', side, roundedAmount, undefined, { reduceOnly: true });
          } catch (e: any) {
            console.error(`[BINANCE] Tactical Split Order placement failed: ${e.message}`);
          }
        }

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
          if (!trade.originalAmount) trade.originalAmount = trade.amount;
          if (!trade.partialHistory) trade.partialHistory = [];

          trade.isPartialProfitTaken = true;
          const partialPnl = trade.pnl / 2;
          const prevAmount = trade.amount;
          const closedAmount = prevAmount / 2;

          trade.realizedPnl = (trade.realizedPnl || 0) + partialPnl;
          trade.amount = prevAmount / 2;
          trade.isBreakeven = true;
          trade.sl =
            trade.type === "LONG"
              ? trade.entryPrice * 1.002
              : trade.entryPrice * 0.998;
          
          trade.partialHistory.push({
            closePercent: 50,
            amountClosed: closedAmount,
            realizedPnl: partialPnl,
            exitPrice: currentPrice,
            time: Date.now(),
            targetR: -1 // Tactical Kinetic Split 2
          });

          if (this.mode === 'LIVE' && this.exchange && this.binanceInitialized) {
            try {
              const side = this.getLiveExitSide(trade.type);
              const quantityToClose = closedAmount / currentPrice;
              const roundedAmount = this.exchange.amountToPrecision(trade.symbol, quantityToClose);
              console.log(`[BINANCE] 🔄 Tactical Split Order: sending ${side.toUpperCase()} for 50% of size | Qty: ${roundedAmount}`);
              await this.exchange.createOrder(trade.symbol, 'market', side, roundedAmount, undefined, { reduceOnly: true });
            } catch (e: any) {
              console.error(`[BINANCE] Tactical Split Order placement failed: ${e.message}`);
            }
          }

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
    if (this.settings.useTawleefaEngine) {
      console.log(`[SMART EXIT] Bypassed for ${symbol} because Tawleefa Engine is active.`);
      return;
    }
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
    if (this.settings.useTawleefaEngine) {
      console.log(`[WISE EXIT] Bypassed for ${symbol} because Tawleefa Engine is active.`);
      return;
    }
    const isFierceExitActive = !!this.settings.useFierceExitEngine;

    if (isFierceExitActive) {
      console.log(`[WISE EXIT] Bypassed for ${symbol} because Fierce Exit is active.`);
      return;
    }

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

  public async forceCloseTrade(trade: Trade, exitPrice: number, reason: string) {
    if (this.mode === "LIVE" && this.exchange && this.binanceInitialized) {
      try {
        const side = this.getLiveExitSide(trade.type);
        const symbol = trade.symbol;
        const quantity = trade.amount / trade.entryPrice;
        const roundedAmount = this.exchange.amountToPrecision(symbol, quantity);

        console.log(
          `[BINANCE] 🏁 Closing INVERSE LIVE ${trade.type} on ${symbol} | Order: ${side.toUpperCase()} | Reason: ${reason} (FORCE CLOSE)`,
        );
        const order = await this.exchange.createOrder(
          symbol,
          "market",
          side,
          roundedAmount,
          undefined,
          { reduceOnly: true },
        );
        console.log(`[BINANCE] 🏁 Close Order Success: ${order.id}`);
        const finalPnl =
          trade.type === "LONG"
            ? (exitPrice - trade.entryPrice) * quantity
            : (trade.entryPrice - exitPrice) * quantity;
        trade.pnl = finalPnl;
      } catch (e: any) {
        console.error(
          `[BINANCE] Failed to close live trade ${trade.symbol}: ${e.message}`,
        );
      }
    }

    const finalPnl = trade.type === "LONG" 
        ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * trade.amount 
        : ((trade.entryPrice - exitPrice) / trade.entryPrice) * trade.amount;
    
    trade.pnl = finalPnl;
    trade.status = "CLOSED";
    trade.exitDate = Date.now();

    console.log(
      `[SNIPER] ${reason}: Trade FORCE Closed on ${trade.symbol}. Final PnL: $${trade.pnl.toFixed(2)}`
    );
    this.activeTrades.delete(trade.symbol);
    this.tradeHistory.unshift({ ...trade });
    saveTrade(trade);
  }

  private async closeTrade(trade: Trade, exitPrice: number, reason: string) {
    // Absolute override: if Fierce Exit is active, cancel and abort ANY non-fierce exit decision!
    const isFierceExitActive = !!this.settings.useFierceExitEngine;

    if (isFierceExitActive) {
      const isFierceReason = reason.includes("SLY_FOX_ESCAPE") || 
                             reason.includes("FIERCE_") || 
                             reason.includes("SAVAGE_");
      if (!isFierceReason && !reason.startsWith("TAWLEEFA_")) {
        console.log(`[FIERCE OVERRIDE] ⚠️ BLOCKED non-fierce exit decision: "${reason}" for ${trade.symbol}. Fierce Exit has exclusive authority.`);
        return;
      }
    }

    if (this.mode === "LIVE" && this.exchange && this.binanceInitialized) {
      try {
        // نغلق الصفقة بمعاكسة لاتجاه العقد المفتوح فعلياً
        const side = this.getLiveExitSide(trade.type);
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
    try {
      trade.exitRegime = RegimeEngine.evaluateRegime(getGlobalMarketContext());
    } catch (e) {
      trade.exitRegime = 'UNKNOWN';
    }

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
    // This gives the exact ROE. Use originalAmount for accurate total ROE if partials were taken.
    const effectiveAmount = trade.originalAmount || trade.amount;
    const margin = effectiveAmount / leverage;
    trade.pnlPerc = (finalPnl / margin) * 100;

    // --- ENHANCED COMPARATIVE ARABIC INSTITUTIONAL EXIT LOG SYSTEM ---
    const formatDurationArabic = (ms: number): string => {
      const totalSecs = Math.floor(ms / 1000);
      const days = Math.floor(totalSecs / 86400);
      const hours = Math.floor((totalSecs % 86400) / 3600);
      const mins = Math.floor((totalSecs % 3600) / 60);
      const secs = totalSecs % 60;
      
      const parts: string[] = [];
      if (days > 0) parts.push(`${days} يوم`);
      if (hours > 0) parts.push(`${hours} ساعة`);
      if (mins > 0) parts.push(`${mins} دقيقة`);
      if (secs > 0 || parts.length === 0) parts.push(`${secs} ثانية`);
      return parts.join(" و ");
    };

    const durationMs = Date.now() - trade.entryTime;
    const durationStr = formatDurationArabic(durationMs);

    // MFE (Maximum Favorable Excursion) Calculations
    let mfePerc = 0;
    if (trade.highestPrice && trade.highestPrice > 0) {
      if (trade.type === 'LONG') {
        mfePerc = ((trade.highestPrice - trade.entryPrice) / trade.entryPrice) * 100;
      } else {
        mfePerc = ((trade.entryPrice - trade.highestPrice) / trade.entryPrice) * 100;
      }
    }
    mfePerc = Math.max(0, mfePerc);

    // Candlestick & Excursion Metrics
    const totalTicksAnalyzed = trade.tickHistory?.length || 0;
    const totalCandlesAnalyzed = trade.volHistory?.length || 0;
    const candleClosingTrend = exitPrice > trade.entryPrice 
      ? "إيجابية صعودية 🟢 (السعر أغلق أعلى من مستوى الدخول)"
      : "سلبية هبوطية 🔴 (السعر أغلق أدنى من مستوى الدخول)";

    // Institutional Volume & CVD metrics
    const steel = trade.latestSteelResult;
    const isSteel = !!steel;
    const takerRatioVal = steel?.takerRatio || trade.latestAdaptiveResult?.metrics?.takerRatio || 1.0;
    const currentVolVal = trade.latestAdaptiveResult?.metrics?.volume || (trade.volHistory && trade.volHistory.length > 0 ? trade.volHistory[trade.volHistory.length - 1] : 0);
    
    // CVD Status & Interpretation
    let cvdClassification = "توازن نسبي في تدفقات العرض والطلب (CVD متذبذب ومستقر) ⚖️";
    if (takerRatioVal > 1.10) {
      cvdClassification = "ضغط شراء حاد ونشط من صناع السوق والحيتان (CVD إيجابي متصاعد) 🔥🟢";
    } else if (takerRatioVal > 1.02) {
      cvdClassification = "تراكم شرائي خفيف من الحيتان (CVD إيجابي خفيف) 🟢";
    } else if (takerRatioVal < 0.90) {
      cvdClassification = "ضغط بيع حاد وتصريف مباشر (CVD سلبي متراجع) 📉🔴";
    } else if (takerRatioVal < 0.98) {
      cvdClassification = "بدء نفاد قوى الشراء ومبيعات ماركت خفيفة (CVD سلبي خفيف) 🔴";
    }

    const approxTakerBuyPct = (takerRatioVal / (1 + takerRatioVal)) * 100;
    const approxTakerSellPct = 100 - approxTakerBuyPct;

    // Cumulative changes during the life of the trade
    const initialOI = trade.oiHistory && trade.oiHistory.length > 0 ? trade.oiHistory[0] : 0;
    const lastOI = trade.oiHistory && trade.oiHistory.length > 0 ? trade.oiHistory[trade.oiHistory.length - 1] : 0;
    const totalOIChangePerc = initialOI > 0 ? ((lastOI - initialOI) / initialOI) * 100 : 0;

    const initialVol = trade.volHistory && trade.volHistory.length > 0 ? trade.volHistory[0] : 0;
    const lastVol = currentVolVal || 0;
    const totalVolChangePerc = initialVol > 0 ? ((lastVol - initialVol) / initialVol) * 100 : 0;

    // Build complete Glossary / Handbook to be attached dynamically
    const arabicGlossaryGuide = `
📕 [دليل كبار المتداولين للمصطلحات والمؤشرات المؤسساتية المتطورة]:
--------------------------------------------------
1️⃣ معامل CVD التراكمي (Cumulative Volume Delta Proxy):
   • يقيس الفرق الصافي بين حجم الشراء وحجم البيع المنفذ عبر صفقات الماركت الفورية (Taker Orders).
   • عندما يكون إيجابياً بشكل متزايد (Taker Ratio > 1.0)، فإنه يظهر اندفاع الحيتان للشراء ماركت دون خطة ليميت.
2️⃣ مؤشر MFE لتقييم الكفاءة (Maximum Favorable Excursion):
   • يعكس أقصى نسبة مئوية حققتها الصفقة في الاتجاه الصحيح قبل إغلاقها.
   • يفيد المتداول في رصد نسبة جباية الأرباح الضائعة وقياس مدى كفاءة أهداف الخروج المفعلة.
3️⃣ الفائدة المفتوحة العميقة (Open Interest Dynamics):
   • تمثل إجمالي عقود المشتقات والفيوتشرز المغطاة بأموال حقيقية والمعلقة في المنصة.
   • تزايدها الملحوظ مع حركة السعر يعني تدفق أموال مؤسسية جديدة لتعزيز الاتجاه (شراء أو بيع).
4️⃣ نسبة التيكر الصافي (Taker Buyer/Seller Ratio):
   • تعبر عن توازن قوى السوق الفورية. القيمة 1.0 تمثل حياد تام، ما فوق ذلك تكتل للمشترين وما دون تكتل للبائعين.
`.trim();

    let finalReport = "";
    if (isSteel) {
      const takerStr = steel.takerRatio?.toFixed(3) || "N/A";
      const oiChangeStr = (steel.oiChange > 0 ? "+" : "") + steel.oiChange?.toFixed(2) + "%";
      const fundingRateStr = (steel.fundingRate * 100).toFixed(4) + "%";
      const confidenceStr = steel.confidence?.toFixed(0) + "%";

      finalReport = `
🚨 [تقرير مقارنة البيانات والتحليل المؤسساتي الكامل لخروج الصفقة] 🚨
==================================================
📐 معطيات الدخول والخروج والربحية:
• اتجاه المركز الاستثماري: ${trade.type === 'LONG' ? "LONG 🟢" : "SHORT 🔴"} (المصدر الأصلي: ${trade.source || 'CORE'})
• سعر الدخول المرجعي: $${trade.entryPrice.toFixed(4)} 🡪 سعر التصفية والإغلاق: $${exitPrice.toFixed(4)}
• نسبة التغير السعري الصافي: ${priceChangePerc > 0 ? "+" : ""}${priceChangePerc.toFixed(3)}%
• العائد المالي الإجمالي المحقق: $${finalPnl.toFixed(2)} (${trade.pnlPerc?.toFixed(2)}% ROE)
• عمولات صفقة التداول بالكامل (ذهاب وإياب): $${totalFees.toFixed(3)} (${(totalFeeRate * 100).toFixed(2)}%)
--------------------------------------------------
⏱️ الفترة الزمنية وتحليل عمر الصفقة:
• إجمالي وقت الحيازة الفعلي: ${durationStr}
• عدد التحديات والشموع التي تم رصدها: ${totalCandlesAnalyzed} شمعة / ${totalTicksAnalyzed} حركة سعرية دقيقة
• متوسط اتجاه إغلاق الشموع النهائي: ${candleClosingTrend}
• أقصى انحراف ربحي نظرى محقق (MFE): ${mfePerc.toFixed(3)}%
--------------------------------------------------
📊 مؤشرات تدفق السيولة والاهتمام المؤسساتي لحظة الإغلاق:
• نسبة ضغط التيكر الصافي (Taker Ratio): ${takerStr}
• اتجاه دلتا السيولة التراكمي (CVD State): ${cvdClassification}
• تفصيل قوة توازن السوق الفوري: مبيعات ماركت صانعي السوق (${approxTakerSellPct.toFixed(1)}%) vs مشتريات ماركت (${approxTakerBuyPct.toFixed(1)}%)
• التراكم الكلي للفائدة المفتوحة منذ الدخول (OI Growth): ${totalOIChangePerc > 0 ? "+" : ""}${totalOIChangePerc.toFixed(2)}% (تحديث أخير: ${oiChangeStr})
• التراكم الكلي لحجم التداول منذ الدخول (Volume Growth): ${totalVolChangePerc > 0 ? "+" : ""}${totalVolChangePerc.toFixed(2)}%
• الرسوم التمويلية المباشرة لعقود التداول (Funding Rate): ${fundingRateStr}
• القوة التماسكية الإجمالية لاتخاذ القرار الفولاذي: ${confidenceStr}
--------------------------------------------------
🛡️ بوابة القرار الفعال ومبررات الإغلاق المفسرة:
• بوابة ومحفز الخروج الأساسي: ${reason}
• الحالة التشغيلية الفعالة: ${steel.currentState}
• مبررات التفعيل والقرار: ${steel.exitIndicator}
--------------------------------------------------
💡 استنتاج تقييمي لعين المتداول:
${finalPnl > 0 
  ? "🏆 حصد أرباح ذكي متقدم بموجب التدفقات المالية الذكية لحماية عوائد المحفظة وتجنب تبديد الأرباح أمام تذبذب السوق العشوائي."
  : "🛡️ تم تفعيل حماية السيولة الأساسية لتفادي انزلاقات سعرية حادة أو إجهاض مصائد تسييل الحسابات التي يفتعلها صناع السوق (Stop-loss Hunt)."}
==================================================
${arabicGlossaryGuide}
      `.trim();
    } else {
      finalReport = `
🚨 [تقرير تصفية المركز ومخرجات الأمان للتداول] 🚨
==================================================
📐 معطيات الدخول والخروج والتقييم الحركي للتصفية:
• اتجاه التداول: ${trade.type}
• سعر الدخول الأساسي: $${trade.entryPrice.toFixed(4)} 🡪 سعر الإغلاق الحقيقي: $${exitPrice.toFixed(4)}
• نسبة الانحراف السعري المحسوب: ${priceChangePerc > 0 ? "+" : ""}${priceChangePerc.toFixed(3)}%
• صافي العائد النهائي المحقق: $${finalPnl.toFixed(2)} (${trade.pnlPerc?.toFixed(2)}% ROE)
• إجمالي رسوم وعمولات المعاملات: $${totalFees.toFixed(3)}
--------------------------------------------------
⏱️ الفترة الزمنية وتحليل عمر الصفقة:
• إجمالي وقت الحيازة الفعلي: ${durationStr}
• إحصاء حركة الفاصل الزمني: ${totalCandlesAnalyzed} شمعة مرصودة / ${totalTicksAnalyzed} حركة سعرية
• اتجاه الشمعة الختامية: ${candleClosingTrend}
• أقصى انحراف ربحي نظرى محقق (MFE): ${mfePerc.toFixed(3)}%
--------------------------------------------------
📊 تدفق السيولة الفورية وحصيلة الحجم:
• متوسط معامل دلتا (CVD Proxy): ${takerRatioVal.toFixed(3)} [${cvdClassification}]
• تقسيم قوى ماركت صناع السوق الحية: مشتريات (${approxTakerBuyPct.toFixed(1)}%) مقابل مبيعات (${approxTakerSellPct.toFixed(1)}%)
• نمو الفائدة المفتوحة الكلي (OI Change): ${totalOIChangePerc > 0 ? "+" : ""}${totalOIChangePerc.toFixed(2)}%
• نمو حجم التداول الكلي (Volume Change): ${totalVolChangePerc > 0 ? "+" : ""}${totalVolChangePerc.toFixed(2)}%
--------------------------------------------------
⚙️ رمز وآلية تصفية المركز:
• حالة الخروج الفعال ومحرك الدوافع: ${reason}
==================================================
${arabicGlossaryGuide}
      `.trim();
    }

    trade.exitReason = finalReport;

    // Log the comprehensive report to both local active log with detailed line break formatting
    addLog(
      `📊 تصفية ${trade.symbol} (${trade.type}):\n${finalReport}`,
      trade.pnl > 0 ? "success" : "warn"
    );

    // Also push a final diagnostic report node to the cascade logs timeline inside trade history
    if (!trade.adaptiveHistoryLogs) {
      trade.adaptiveHistoryLogs = [];
    }
    trade.adaptiveHistoryLogs.push({
      id: "EXIT_LOG_" + Date.now(),
      type: trade.type,
      entryPrice: trade.entryPrice,
      currentPrice: exitPrice,
      decision: "EXIT_NOW",
      reason: finalReport,
      score: isSteel ? Math.min(5, Math.max(0, Math.round(steel.confidence / 20))) : 5,
      time: Date.now(),
      metrics: {
        rsi: isSteel ? (trade as any).latestAdaptiveResult?.metrics?.rsi || 50 : 50,
        openInterest: isSteel ? (trade as any).latestAdaptiveResult?.metrics?.openInterest || 0 : 0,
        volume: isSteel ? (trade as any).latestAdaptiveResult?.metrics?.volume || 0 : 0,
        takerRatio: isSteel ? steel.takerRatio : 1.0,
        fundingRate: isSteel ? steel.fundingRate : 0.0,
        oiTrend: isSteel ? (trade as any).latestAdaptiveResult?.metrics?.oiTrend || "FLAT" : "FLAT",
        volTrend: isSteel ? (trade as any).latestAdaptiveResult?.metrics?.volTrend || "FLAT" : "FLAT",
        takerTrend: isSteel ? (steel.takerRatio > 1.05 ? "BULLISH" : steel.takerRatio < 0.95 ? "BEARISH" : "NEUTRAL") : "NEUTRAL"
      }
    });

    if (trade.adaptiveHistoryLogs.length > 50) {
      trade.adaptiveHistoryLogs.shift();
    }

    // Console tracking log
    console.log(
      `[SNIPER] ${reason}: Trade Closed on ${trade.symbol}. Final PnL: $${trade.pnl.toFixed(2)}`
    );
    this.activeTrades.delete(trade.symbol);
    this.tradeHistory.unshift({ ...trade }); // Add to beginning of history
    saveTrade(trade);

    // --- REGIME MEMORY: RECORD RESULTS (Requirement 2) ---
    const isWin = finalPnl > 0;
    RegimeEngine.recordTradeResult(isWin);
    
    const isFakeoutExit = reason.includes("STOP_LOSS_HIT") || reason.includes("BREAKEVEN_HIT") || reason.includes("WEAKNESS");
    if (isFakeoutExit && trade.source && (trade.source.includes("BREAKOUT") || trade.source.includes("CORE"))) {
      RegimeEngine.recordBreakout(true); // it was a fakeout breakout!
    } else if (isWin && trade.source && (trade.source.includes("BREAKOUT") || trade.source.includes("CORE"))) {
      RegimeEngine.recordBreakout(false); // successful breakout respect!
    }

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
