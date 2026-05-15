import { Trade, MarketCondition, BotSettings } from '../types/trading.js';
import { saveTrade, loadClosedTrades, loadActiveTrades, saveSettingsToDB, loadSettingsFromDB, initDB } from './db.js';
import { CoreEngine } from './engine/CoreEngine.js';
import { RiskEngine } from './engine/RiskEngine.js';
import { PositionManager } from './engine/PositionManager.js';
import { WiseExitEngine } from './engine/WiseExitEngine.js';
import { MarketMetrics, MarketRegime, TrapType, GlobalContext } from '../types/trading.js';
import { addLog } from './botRunner.js';

export class SniperEngine {
  private mode: 'PAPER' | 'LIVE' = 'PAPER';
  private activeTrades: Map<string, Trade> = new Map();
  private tradeHistory: Trade[] = [];
  private core = new CoreEngine();
  private risk = new RiskEngine();
  private manager = new PositionManager();
  private wiseEngine = new WiseExitEngine();
  
  private settings: BotSettings = {
    portfolioSize: 2000,
    riskPerTradePerc: 1, // 1%
    maxConcurrentTrades: 10,
    leverage: 10,
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
    layerRiskEnabled: true
  };

  constructor() {
    console.log('[SNIPER ENGINE] Initialized in PAPER mode.');
    this.initHistory();
  }

  public getSettings(): BotSettings {
    return this.settings;
  }

  public updateSettings(newSettings: BotSettings) {
    this.settings = newSettings;
    saveSettingsToDB(newSettings);
    console.log('[SNIPER] ⚙️ Settings updated and saved to DB:', newSettings);
  }

  private async initHistory() {
    try {
      await initDB();
      const dbSettings = await loadSettingsFromDB();
      if (dbSettings) {
         if (dbSettings.portfolioSize === 1000 && dbSettings.maxConcurrentTrades === 3) {
             console.log('[SNIPER] Auto-upgrading old default settings to new Ruthless defaults.');
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
             beastInstitutionalStrength: dbSettings.beastInstitutionalStrength ?? 0.4,
             fastExitEnabled: dbSettings.fastExitEnabled ?? false,
             fastExitPerc: dbSettings.fastExitPerc ?? 0.5,
             strategyAdxThreshold: dbSettings.strategyAdxThreshold ?? 25,
             strategyAtrMultiplier: dbSettings.strategyAtrMultiplier ?? 1.5,
             strategyMinConfidence: dbSettings.strategyMinConfidence ?? 0.6,
             strategyRvolThreshold: dbSettings.strategyRvolThreshold ?? 1.5,
             useStrategyTrendFilter: dbSettings.useStrategyTrendFilter ?? true,
             useStrategyVolatilityRule: dbSettings.useStrategyVolatilityRule ?? true,
             useStrategyConfidenceGate: dbSettings.useStrategyConfidenceGate ?? true,
             useStrategyMomentumRule: dbSettings.useStrategyMomentumRule ?? true,
             dynamicSafetyExit: dbSettings.dynamicSafetyExit ?? true,
             layerGlobalContextEnabled: dbSettings.layerGlobalContextEnabled ?? true,
             layerRegimeEnabled: dbSettings.layerRegimeEnabled ?? true,
             layerBiasEnabled: dbSettings.layerBiasEnabled ?? true,
             layerLiquidityEnabled: dbSettings.layerLiquidityEnabled ?? true,
             layerMomentumEnabled: dbSettings.layerMomentumEnabled ?? true,
             layerConfidenceEnabled: dbSettings.layerConfidenceEnabled ?? true,
             layerRiskEnabled: dbSettings.layerRiskEnabled ?? true
           };
         }
         console.log('[SNIPER] Loaded settings from database', this.settings);
      } else {
         saveSettingsToDB(this.settings);
      }

      this.tradeHistory = await loadClosedTrades();
      
      const openTrades = await loadActiveTrades();
      openTrades.forEach(t => this.activeTrades.set(t.symbol, t));
      console.log(`[SNIPER ENGINE] Loaded ${this.tradeHistory.length} closed trades and ${openTrades.length} active trades from DB.`);
    } catch(e) {
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
    const closed = this.tradeHistory.filter(t => t.status === 'CLOSED');
    const wins = closed.filter(t => (t.pnlPerc || 0) > 0).length;
    const losses = closed.length - wins;
    const totalPnl = closed.reduce((acc, t) => acc + (t.pnl || 0), 0);
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

    return {
      totalPnl,
      winRate,
      openCount: this.activeTrades.size,
      totalTrades: closed.length
    };
  }

  /**
   * Evaluate a symbol against the new 7-layer architecture
   */
  public evaluateSignal(condition: MarketCondition, klines: any[], htfKlines: any[], global?: GlobalContext): void {
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
      isChop: condition.isRanging
    };

    // 2. Clear Decision from the Core
    const decision = this.core.process(metrics, klines, htfKlines, this.settings, global);
    condition.decision = decision; // Attach to condition for UI

    if (decision.action === 'SLEEP' || decision.action === 'WAIT') {
       // console.log(`[CORE] ${condition.symbol} -> Decision: ${decision.action} (${decision.reason})`);
       return;
    }

    // 3. Prevent duplicate trades on same symbol
    if (this.activeTrades.has(condition.symbol)) return;

    // 4. Execution Logic (If Attack)
    addLog(`ATTACK DETECTED: ${condition.symbol} | Regime: ${decision.regime}`, 'info');
    console.log(`[CORE] 🔥 ATTACK TRIGGERED on ${condition.symbol} | Regime: ${decision.regime} | Trap: ${decision.trap} | Confidence: ${decision.confidence * 100}%`);
    
    // We override direction if a Trap is detected
    if (decision.trap === TrapType.LONG_TRAP) {
       condition.type = 'SHORT'; 
    } else if (decision.trap === TrapType.SHORT_TRAP) {
       condition.type = 'LONG';
    }

    // Labeling logic: 
    // If confidence is low (0.5), it's a Beast/Aggressive entry (Incomplete Evaluation).
    // If confidence is high (>= 0.6), it's a standard Sniper/Wait Engine entry.
    let sourceLabel = 'CORE';
    if (decision.reason === 'BEAST_MOMENTUM_STRIKE') {
       sourceLabel = 'AGGRESSIVE_INCOMPLETE';
    } else if (decision.confidence >= 0.6) {
       sourceLabel = 'WAIT_ENGINE_PROTECTED';
    } else {
       sourceLabel = this.settings.beastMode ? 'DIRECT_ENTRY' : 'WAIT_PROTECTED';
    }
    
    this.executeTrade(condition, sourceLabel);
  }

  /**
   * Execute trade and calculate strict Risk/Reward
   */
  private executeTrade(cond: MarketCondition, source?: string) {
    const entryPrice = cond.price;
    let sl = 0;

    // 1. Stop Loss Placement: Prioritize ATR for dynamic protection
    if (cond.atr && cond.atr > 0 && this.settings.useStrategyVolatilityRule) {
      let atrMultiplier = this.settings.strategyAtrMultiplier ?? 1.5; 
      if (this.settings.beastMode) atrMultiplier += 0.5;
      sl = cond.type === 'LONG' ? entryPrice - (cond.atr * atrMultiplier) : entryPrice + (cond.atr * atrMultiplier);
    } else {
      sl = cond.type === 'LONG' ? cond.support * 0.999 : cond.resistance * 1.001;
    }

    // 2. Risk Engine Validation
    const riskVerdict = this.risk.canTrade(this.getActiveTrades(), this.tradeHistory, this.settings.beastMode);
    if (!riskVerdict.allowed) {
       console.log(`[RISK] 🛡️ Entry Blocked: ${riskVerdict.reason}`);
       return;
    }

    // 3. Position Sizing
    const leverage = this.settings.leverage || 10;
    const maxTrades = this.settings.maxConcurrentTrades || 10;
    const positionSizeUsd = this.risk.calculatePositionSize(this.settings.portfolioSize, entryPrice, sl, leverage, maxTrades);
    
    if (positionSizeUsd <= 0) {
       console.warn(`[SNIPER] ⚠️ Aborting trade on ${cond.symbol}: Calculated size is zero. Check portfolio settings.`);
       return;
    }
    
    // 4. Take Profits
    const risk = Math.abs(entryPrice - sl);
    const tp1 = cond.type === 'LONG' ? entryPrice + (risk * 0.8) : entryPrice - (risk * 0.8);
    const tp2 = cond.type === 'LONG' ? entryPrice + (risk * 2.5) : entryPrice - (risk * 2.5);

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
      status: 'OPEN',
      score: cond.score,
      source: source || 'CORE',
      isBreakeven: false,
      pnl: 0,
      pnlPerc: 0
    };

    this.activeTrades.set(trade.symbol, trade);
    addLog(`ENTRY: ${trade.type} ${trade.symbol} @ ${entryPrice.toFixed(2)}`, 'info');
    console.log(`[CORE] 🟢 ATTACK EXECUTED: ${trade.type} on ${trade.symbol} @ ${entryPrice.toFixed(4)}. SL: ${sl.toFixed(4)}`);
    saveTrade(trade);
  }

  public executeQuantumTrade(cond: MarketCondition, source: string, tpPerc: number, slPerc: number, originalType?: 'LONG' | 'SHORT') {
    const entryPrice = cond.price;
    const executionType = cond.type;
    const isActuallyReversed = originalType && originalType !== executionType;

    // 🔄 REVERSE LOGIC LEVEL MAPPING:
    // If we are reversing a "guaranteed loser":
    // The original SL becomes our TP (Success through failure)
    // The original TP becomes our SL (Failure through original success)
    const effectiveTpPerc = isActuallyReversed ? slPerc : tpPerc;
    const effectiveSlPerc = isActuallyReversed ? tpPerc : slPerc;

    const slDistance = (effectiveSlPerc / 100) * entryPrice;
    const sl = executionType === 'LONG' ? entryPrice - slDistance : entryPrice + slDistance;

    const tp1Distance = (effectiveTpPerc / 100) * entryPrice;
    const tp1 = executionType === 'LONG' ? entryPrice + tp1Distance : entryPrice - tp1Distance;
    const tp2 = executionType === 'LONG' ? entryPrice + (tp1Distance * 2.5) : entryPrice - (tp1Distance * 2.5);

    const leverage = this.settings.leverage || 10;
    const maxTrades = this.settings.maxConcurrentTrades || 10;
    let positionSizeUsd = this.risk.calculatePositionSize(this.settings.portfolioSize, entryPrice, sl, leverage, maxTrades);
    
    // Ensure minimum position for exchange rules (Binance usually requires 5-10 USD)
    if (positionSizeUsd < 11) positionSizeUsd = 11;

    const trade: Trade = {
      id: Date.now().toString(),
      symbol: cond.symbol,
      type: executionType,
      mode: this.mode,
      entryPrice,
      entryTime: Date.now(),
      amount: positionSizeUsd, 
      leverage,
      sl,
      initialSl: sl,
      tp1,
      tp2,
      status: 'OPEN',
      score: 5,
      source: isActuallyReversed ? `${source}_REVERSED` : source,
      isBreakeven: false,
      pnl: 0,
      pnlPerc: 0
    };

    this.activeTrades.set(trade.symbol, trade);
    addLog(`${isActuallyReversed ? '🔄 REVERSED' : 'QUANTUM'} ENTRY: ${trade.type} ${trade.symbol} @ ${entryPrice.toFixed(2)}`, 'info');
    console.log(`[QUANTUM] 🟢 EXECUTED: ${trade.type} on ${trade.symbol}. SL: ${sl.toFixed(4)}, TP: ${tp1.toFixed(4)}`);
    saveTrade(trade);
  }

  /**
   * Manage active trades (Trailing stops, Take Profits, and Dynamic Safety Exits)
   */
  public manageTrades(
    symbol: string, 
    currentPrice: number, 
    currentOI?: number, 
    currentVol?: number, 
    currentTakerRatio?: number,
    indicators?: { adx?: number, rsi?: number, emaTrend?: 'LONG' | 'SHORT', btcTrend?: 'LONG' | 'SHORT' }
  ) {
    const trade = this.activeTrades.get(symbol);
    if (!trade) return;

    // --- ⚡ FAST EXIT (الخروج السريع - Global Override) ---
    if (this.settings.fastExitEnabled) {
        const exitPerc = this.settings.fastExitPerc || 0.5;
        
        // حساب التغير المباشر من نقطة الدخول (Price Change %)
        const priceChangePerc = trade.type === 'LONG' 
            ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 
            : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;

        // 1. حماية رأس المال (Stop Loss الفوري)
        if (priceChangePerc <= -exitPerc) {
            console.log(`[FAST EXIT] ⚡ Emergency Stop: Price dropped ${priceChangePerc.toFixed(2)}% below entry.`);
            this.closeTrade(trade, currentPrice, `⚡ FAST_EXIT_STOP_LOSS`);
            return;
        }

        // 2. ملاحقة الأرباح وحجزها (Trailing Guard)
        if (trade.highestPrice) {
            const dropFromHighPerc = trade.type === 'LONG' 
                ? ((trade.highestPrice - currentPrice) / trade.highestPrice) * 100
                : ((currentPrice - trade.highestPrice) / trade.highestPrice) * 100;

            const doubleThreshold = exitPerc * 2;
            
            if (priceChangePerc >= doubleThreshold && dropFromHighPerc >= exitPerc) {
                console.log(`[FAST EXIT] ⚡ Profit Locked: Price dropped ${dropFromHighPerc.toFixed(2)}% from peak.`);
                this.closeTrade(trade, currentPrice, `⚡ FAST_EXIT_PROFIT_TAKEN`);
                return;
            }
        }
    }

    // Update Floating PNL
    const priceChangePerc = trade.type === 'LONG' 
        ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 
        : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
    
    trade.currentPrice = currentPrice;
    const totalFeeRate = 0.001; 
    const leverage = trade.leverage || 10;
    
    trade.pnlPerc = (priceChangePerc - (totalFeeRate * 100)) * leverage;
    trade.pnl = ((trade.amount * priceChangePerc) / 100) - (trade.amount * totalFeeRate); 
    if (trade.realizedPnl) trade.pnl += trade.realizedPnl;

    // --- STANDARD MONITORING (LONG/SHORT) ---
    let updated = false;

    if (trade.type === 'LONG') {
      if (trade.status === 'OPEN' && currentPrice >= trade.tp1) {
        trade.status = 'TP1_HIT';
        trade.sl = trade.entryPrice; 
        trade.isBreakeven = true;
        updated = true;
        console.log(`[SNIPER] 🎯 TP1 Hit for ${trade.symbol}! SL moved to Breakeven.`);
      }
      if (currentPrice >= trade.tp2) {
         this.closeTrade(trade, currentPrice, '🎯 TP2_HIT');
         return;
      }
      if (currentPrice <= trade.sl) {
         this.closeTrade(trade, currentPrice, trade.isBreakeven ? '🛡️ BREAKEVEN' : '🛑 STOP_LOSS');
         return;
      }
    } else { // SHORT
      if (trade.status === 'OPEN' && currentPrice <= trade.tp1) {
        trade.status = 'TP1_HIT';
        trade.sl = trade.entryPrice;
        trade.isBreakeven = true;
        updated = true;
        console.log(`[SNIPER] 🎯 TP1 Hit for ${trade.symbol}! SL moved to Breakeven.`);
      }
      if (currentPrice <= trade.tp2) {
         this.closeTrade(trade, currentPrice, '🎯 TP2_HIT');
         return;
      }
      if (currentPrice >= trade.sl) {
         this.closeTrade(trade, currentPrice, trade.isBreakeven ? '🛡️ BREAKEVEN' : '🛑 STOP_LOSS');
         return;
      }
    }

    if (updated) {
       saveTrade(trade);
    }
  }

  public smartExit(symbol: string, currentPrice: number, reason: string) {
    const trade = this.activeTrades.get(symbol);
    if (!trade) return;
    
    // Check if it's already closed or processing
    if (trade.status !== 'OPEN' && trade.status !== 'TP1_HIT') return;
    
    // Close trade prematurely due to indicator reversal
    this.closeTrade(trade, currentPrice, reason);
  }

  public wiseExit(symbol: string, currentPrice: number, klines: any[]) {
    const trade = this.activeTrades.get(symbol);
    if (!trade) return;
    if (trade.status === 'CLOSED') return;

    const result = this.wiseEngine.analyze(trade, klines, trade.oiHistory?.[trade.oiHistory.length-1]);
    if (result.shouldExit) {
        this.closeTrade(trade, currentPrice, result.reason);
    }
  }

  private closeTrade(trade: Trade, exitPrice: number, reason: string) {
      trade.exitPrice = exitPrice;
      trade.status = 'CLOSED';
      trade.exitTime = Date.now();
      
      const priceChangePerc = trade.type === 'LONG' 
        ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 
        : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
        
      // Real ROE = (PriceChange% - Fees%) * Leverage
      const totalFeeRate = 0.001;
      const leverage = trade.leverage || 10;
      
      trade.pnlPerc = (priceChangePerc - (totalFeeRate * 100)) * leverage;
      
      // Calculate PnL and subtract estimated fees (0.1% total)
      let finalPnl = ((trade.amount * priceChangePerc) / 100) - (trade.amount * totalFeeRate);
      
      if (trade.realizedPnl) {
          finalPnl += trade.realizedPnl;
      }
      
      trade.pnl = finalPnl;
      
      const badge = trade.pnl > 0 ? '🟢' : '🔴';
      addLog(`EXIT ${trade.symbol}: $${trade.pnl.toFixed(2)} (${reason})`, trade.pnl > 0 ? 'info' : 'warn');
      console.log(`[SNIPER] ${reason}: Trade Closed on ${trade.symbol}. Final PnL: $${trade.pnl.toFixed(2)}`);
      this.activeTrades.delete(trade.symbol);
      this.tradeHistory.unshift({ ...trade }); // Add to beginning of history
      saveTrade(trade);

      // --- BEAST MODE: NEURAL LEARNING & TRAP REVERSAL ---
      if (this.settings.beastMode) {
          this.handleBeastLearning(trade, exitPrice, reason);
      }
  }

  private handleBeastLearning(trade: Trade, exitPrice: number, reason: string) {
      const isLoss = (trade.pnl ?? 0) < 0;
      const timeOpenMinutes = (Date.now() - trade.entryTime) / 60000;
      
      const learningRate = (this.settings.beastLearnRate ?? 50) / 100; // 0.01 to 1.0
      
      // 1. Slippage / Stop-Hunt Reversal Exploit (تحويل الانزلاق لربح بذكاء)
      if (this.settings.beastSlippageExploit && isLoss && reason === '🛑 STOP_LOSS' && timeOpenMinutes < 3) {
          // Check for "Whale Shadow": If stopped out but OI is still rising, it's a fakeout.
          const lastOI = trade.oiHistory ? trade.oiHistory[trade.oiHistory.length - 1] : 0;
          const prevOI = trade.oiHistory ? trade.oiHistory[0] : 0;
          const oiStillRising = lastOI > prevOI;
          
          // Re-entry check: Is there a "Whale Shadow"? (OI rising + Taker Ratio supports original direction)
          const takerPressureConf = trade.type === 'LONG' ? (trade.takerBuySellRatio ?? 1) > 1.2 : (trade.takerBuySellRatio ?? 1) < 0.8;

          console.log(`[BEAST 🐺] STOP-HUNT DETECTED ON ${trade.symbol}. OI Rising: ${oiStillRising}. Taker Conf: ${takerPressureConf}. Preparing Counter-Strike...`);
          
          if (oiStillRising || takerPressureConf) {
             // Keep the original direction but with ultra-tight SL if it's a re-entry
             const newCond: MarketCondition = {
                 symbol: trade.symbol,
                 price: exitPrice,
                 type: trade.type, // Re-enter original direction!
                 score: 6, 
                 support: trade.type === 'LONG' ? exitPrice * 0.998 : exitPrice, 
                 resistance: trade.type === 'SHORT' ? exitPrice * 1.002 : exitPrice,
                 isRanging: false,
                 isBreakout: true,
                 isRetestOrHold: true,
                 isLiquidityGood: true,
                 isMomentumHigh: true,
                 isOrderBookClear: true
             };
             
             const originalRisk = this.settings.riskPerTradePerc;
             this.settings.riskPerTradePerc = originalRisk * 1.5; // Aggressive Re-entry
             
             this.executeTrade(newCond);
             this.settings.riskPerTradePerc = originalRisk;
          }
      }

      // 2. Auto-Adapt Settings (التعلم الذاتي)
      if (this.settings.beastAutoAdapt) {
           let updated = false;
           // If we've had consecutive losses, tighten conditions. If winning, loosen them to catch more.
           const recent = this.tradeHistory.slice(0, 5);
           const lossCount = recent.filter(t => (t.pnl ?? 0) < 0).length;
           const winCount = recent.length - lossCount;

           if (lossCount >= 3) {
               this.settings.strictMinRvol = Math.min(5, (this.settings.strictMinRvol ?? 1.5) + (0.2 * learningRate));
               updated = true;
           } else if (winCount >= 3) {
               this.settings.strictMinRvol = Math.max(1.2, (this.settings.strictMinRvol ?? 1.5) - (0.2 * learningRate));
               updated = true;
           }

           if (updated) {
               saveSettingsToDB(this.settings);
           }
      }
  }
}

export const sniper = new SniperEngine();
