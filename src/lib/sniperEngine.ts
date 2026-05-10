import { Trade, MarketCondition, BotSettings } from '../types/trading.js';
import { saveTrade, loadClosedTrades, loadActiveTrades, saveSettingsToDB, loadSettingsFromDB, initDB } from './db.js';

export class SniperEngine {
  private mode: 'PAPER' | 'LIVE' = 'PAPER';
  private activeTrades: Map<string, Trade> = new Map();
  private tradeHistory: Trade[] = [];
  
  private settings: BotSettings = {
    portfolioSize: 2000,
    riskPerTradePerc: 1, // 1%
    maxConcurrentTrades: 10,
    leverage: 10,
    strictMode: true,
    strictMinRvol: 1.5,
    strictFastBreakevenPerc: 0.3,
    useSmartExit: true,
    useKineticEngine: true,
    beastMode: false
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
             this.settings.useKineticEngine = true;
             this.settings.beastMode = false;
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
             useKineticEngine: dbSettings.useKineticEngine ?? false,
             useSmartControl: dbSettings.useSmartControl ?? false,
             beastMode: dbSettings.beastMode ?? false
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
   * Evaluate a symbol against the strict 5/5 criteria
   */
  public evaluateSignal(condition: MarketCondition): void {
    // 1. Mandatory Filter: Range Market avoids ALL trades.
    if (condition.isRanging) return;

    // 2. Score threshold: Must be 4/5 or 5/5
    if (condition.score <= 3) return;

    // 3. Prevent duplicate trades on same symbol
    if (this.activeTrades.has(condition.symbol)) return;

    console.log(`[SNIPER] 🔥 Signal Detected: ${condition.symbol} | Score: ${condition.score}/5 | Type: ${condition.type}`);
    this.executeTrade(condition);
  }

  /**
   * Execute trade and calculate strict Risk/Reward (1R and 2R)
   */
  private executeTrade(cond: MarketCondition) {
    const entryPrice = cond.price;
    let sl = 0;

    // Stop Loss Placement 
    if (cond.type === 'LONG') {
      sl = cond.support * 0.999; // Slightly below support
    } else {
      sl = cond.resistance * 1.001; // Slightly above resistance
    }

    // Risk calculation (1R)
    const risk = Math.abs(entryPrice - sl);
    const riskPerc = risk / entryPrice;

    // Max Risk filter
    const maxRiskAllowed = this.settings.strictMode ? (this.settings.strictMaxRisk ? this.settings.strictMaxRisk / 100 : 0.01) : 0.015;
    if (riskPerc > maxRiskAllowed) {
       console.log(`[SNIPER] ⚠️ Trade Ignored. Stop Loss too wide (${(riskPerc*100).toFixed(2)}%). Max allowed is ${(maxRiskAllowed*100).toFixed(2)}%.`);
       return; // Ignore trade
    }

    // Take Profits
    const tp1 = cond.type === 'LONG' ? entryPrice + risk : entryPrice - risk; // +1R
    const tp2 = cond.type === 'LONG' ? entryPrice + (risk * 2) : entryPrice - (risk * 2); // +2R

    // Calculate USD value using user settings
    const riskAmountUsd = this.settings.portfolioSize * (this.settings.riskPerTradePerc / 100); 
    const positionSizeUsd = riskAmountUsd / riskPerc;

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
      isBreakeven: false,
      pnl: 0,
      pnlPerc: 0
    };

    this.activeTrades.set(trade.symbol, trade);
    console.log(`[SNIPER] 🟢 Entered ${trade.type} on ${trade.symbol} @ ${entryPrice.toFixed(4)}. SL: ${sl.toFixed(4)}, TP1(1R): ${tp1.toFixed(4)}`);
    saveTrade(trade);
  }

  /**
   * Manage active trades (Trailing stops, Take Profits)
   */
  public manageTrades(symbol: string, currentPrice: number, currentOI?: number, currentVol?: number) {
    const trade = this.activeTrades.get(symbol);
    if (!trade) return;

    // Update floating PnL
    const floatingPnlPerc = trade.type === 'LONG' 
        ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 
        : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
    
    trade.currentPrice = currentPrice;
    trade.pnlPerc = floatingPnlPerc;
    trade.pnl = (trade.amount * floatingPnlPerc) / 100;

    let updated = false;

    // --- HARD TIME LIMIT EXIT (Max 3 hours to avoid dead money) ---
    const minutesOpenTrade = (Date.now() - trade.entryTime) / 60000;
    if (minutesOpenTrade >= 180) { // 3 Hours maximum
        console.log(`[SNIPER] ⏱️ TRADE EXPIRED: ${trade.symbol} holding for over 3 hours without hitting TP/SL. Exiting now to free up capital.`);
        this.closeTrade(trade, currentPrice, '⏱️ TIME_LIMIT_EXIT');
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
    if (!trade.highestPrice || (trade.type === 'LONG' ? currentPrice > trade.highestPrice : currentPrice < trade.highestPrice)) {
       trade.highestPrice = currentPrice;
       trade.highestPriceTime = Date.now();
       updated = true;
    }

    // 🌟 KINETIC ENGINE (نظام الزخم الحركي الشامل)
    if (this.settings.useKineticEngine) {
       // --- BASE SETTINGS (المتغيرات الأساسية للمستخدم) ---
       const rawTpInput = this.settings.smartTpUsd ?? 1.5;
       const isTpDisabled = rawTpInput <= 0;
       // benchmarkTp: يُستخدم كمرجع داخلي لنظام الوحش (Kinetic) لتنسيق سرعة الملاحقة، حتى لو كان الإغلاق التلقائي معطلاً
       const benchmarkTp = isTpDisabled ? 1.5 : rawTpInput; 
       const baseTrailStart = this.settings.smartTrailingStartUsd ?? 0.4;
       let smartTimeDelayLimit = this.settings.smartTimeDecayMinutes ?? 5;
       let dynamicTrailThreshold = this.settings.smartTrailingThresholdPerc ?? 0.3;
       let momentumStallLimit = this.settings.smartMomentumStallMinutes ?? 2.5;

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

       if (this.settings.kineticUseOpenInterest && trade.oiHistory && trade.oiHistory.length >= 10 && trade.tickHistory && trade.tickHistory.length >= 10) {
           const lookback = Math.min(20, trade.oiHistory.length - 1);
           const currentOI = trade.oiHistory[trade.oiHistory.length - 1];
           const prevOI = trade.oiHistory[trade.oiHistory.length - 1 - lookback]; // Trend over last ~30-60s
           oiTrend = ((currentOI - prevOI) / prevOI) * 100;

           const currentPx = trade.tickHistory[trade.tickHistory.length - 1];
           const prevPx = trade.tickHistory[trade.tickHistory.length - 1 - lookback];
           priceTrend = ((currentPx - prevPx) / prevPx) * 100;
       }

       // 🧠 True Flow: Calculate live volume flow (from 1m candle)
       let volTrend = 0;
       if (this.settings.kineticUseVolume && trade.volHistory && trade.volHistory.length >= 10) {
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

       if (oiTrend > (0.02 * kineticSensitivity) || volTrend > (0.05 * kineticSensitivity)) {
           isMomentumActive = true;
       }

       // --- KINETIC ENGINE: DYNAMIC MODIFIERS (التكيف المطاطي) ---
       
       // 1. Elastic Shadow (الملاحقة المطاطية): Expand buffer if new/volatile, tighten if old
       if (minutesOpen < 3 || liveVolatilityPerc > 0.5) dynamicTrailThreshold *= 1.5; 
       else if (minutesOpen > 10) dynamicTrailThreshold *= 0.6; 

       // 2. Open Interest & Volume Modifiers (المحركات الحية)
       if (this.settings.kineticUseOpenInterest) {
           if (oiTrend > (0.04 * kineticSensitivity)) {
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
       if (liveVolatilityPerc > 0 && liveVolatilityPerc < 0.03 && minutesOpen > 2) {
           // Micro-structure is dead flat. Kill it much faster.
           smartTimeDelayLimit = Math.min(smartTimeDelayLimit, 2); 
       } else if (liveVolatilityPerc > 0.4) {
           // Market is wild, give it extra time to bounce
           smartTimeDelayLimit *= 1.5; 
       }

       // --- 0. KINETIC EXITS: High-Level Distribution & Reversal Guards ---
       if (this.settings.kineticUseOpenInterest && oiTrend !== 0 && priceTrend !== 0 && minutesOpen > 0.5) {
           if (trade.type === 'LONG') {
               // 🔴 1. تصريف أو Divergence (Distribution)
               // السعر يرتفع أو ثابت، لكن OI ينخفض = الكبار يخرجون خفية
               if (oiTrend < -(0.05 * kineticSensitivity) && priceTrend >= -0.05 && trade.pnl > 0) {
                   console.log(`[SNIPER] 🔴 KINETIC DIVERGENCE: Price holding but OI dropping actively! HIDDEN DISTRIBUTION in ${trade.symbol}. Securing PnL: +$${trade.pnl.toFixed(2)}`);
                   this.closeTrade(trade, currentPrice, '🔴 KINETIC_DISTRIBUTION_EXIT');
                   return;
               }

               // ⚠️ 2. سيناريو الانعكاس وضرب الماركت (Shorts Splashing)
               // السعر يسقط بحدة والـ OI يرتفع بحدة = ناس تدخل شورت وتضغط بقوة
               if (priceTrend < -0.08 && oiTrend > (0.05 * kineticSensitivity)) {
                   console.log(`[SNIPER] ⚠️ KINETIC REVERSAL: Price dropping while OI rising fast! SHORTS ENTERING ${trade.symbol}. Exiting NOW.`);
                   this.closeTrade(trade, currentPrice, '⚠️ KINETIC_SHORTS_ATTACK');
                   return;
               }
           } else if (trade.type === 'SHORT') {
               if (oiTrend < -(0.05 * kineticSensitivity) && priceTrend <= 0.05 && trade.pnl > 0) {
                   console.log(`[SNIPER] 🔴 KINETIC DIVERGENCE: Price holding but OI dropping! SHORTS COVERING in ${trade.symbol}. Securing PnL: +$${trade.pnl.toFixed(2)}`);
                   this.closeTrade(trade, currentPrice, '🔴 KINETIC_COVER_EXIT');
                   return;
               }
               
               if (priceTrend > 0.08 && oiTrend > (0.05 * kineticSensitivity)) {
                   console.log(`[SNIPER] ⚠️ KINETIC REVERSAL: Price rising while OI rising fast! LONGS ENTERING ${trade.symbol}. Exiting NOW.`);
                   this.closeTrade(trade, currentPrice, '⚠️ KINETIC_LONGS_ATTACK');
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
             trade.amount = trade.amount / 2;   // Halve position
             trade.isBreakeven = true;
             trade.sl = trade.type === 'LONG' ? trade.entryPrice * 1.002 : trade.entryPrice * 0.998;
             console.log(`[SNIPER] ⚡ KINETIC SPLIT: High Velocity! Secured 50% profit (+$${trade.realizedPnl.toFixed(2)}) for ${trade.symbol}.`);
             updated = true;
          } else if (trade.isPartialProfitTaken && trade.pnl >= benchmarkTp * 1.5) {
             // Second target hit (Riding the runners)
             console.log(`[SNIPER] 🚀 KINETIC ENGINE: Final Target Hit for ${trade.symbol} at +$${trade.pnl.toFixed(2)}`);
             this.closeTrade(trade, currentPrice, '🚀 KINETIC_PROFIT_MAX');
             return;
          } else if (!trade.isPartialProfitTaken) {
             // Standard Target Hit
             console.log(`[SNIPER] 🚀 KINETIC ENGINE: Target Hit for ${trade.symbol} at +$${trade.pnl.toFixed(2)}`);
             this.closeTrade(trade, currentPrice, '🚀 KINETIC_PROFIT');
             return;
          }
       }
       
       // --- 2. Trailing Breakeven (تأمين نقطة الدخول والملاحقة) ---
       if (!trade.isBreakeven && trade.pnl >= baseTrailStart) {
          trade.sl = trade.type === 'LONG' ? trade.entryPrice * 1.0015 : trade.entryPrice * 0.9985;
          trade.isBreakeven = true;
          updated = true;
          console.log(`[SNIPER] 🛡️ KINETIC ENGINE: SL moved to Entry+Fees for ${trade.symbol} at +$${trade.pnl.toFixed(2)} PnL!`);
       }

       // --- 3. Dynamic Elastic Trailing (الملاحقة المطاطية من أعلى قمة) ---
       if (trade.pnl > Math.max(0.1, baseTrailStart * 0.5) && trade.highestPrice) {
          const dropFromHighPerc = trade.type === 'LONG' 
             ? ((trade.highestPrice - currentPrice) / trade.highestPrice) * 100
             : ((currentPrice - trade.highestPrice) / trade.highestPrice) * 100;

          if (dropFromHighPerc >= dynamicTrailThreshold) {
              console.log(`[SNIPER] 📉 KINETIC SHADOW: Elastic Trailing triggered for ${trade.symbol}. Dropped ${dropFromHighPerc.toFixed(2)}% from highest. Exiting with +$${trade.pnl.toFixed(2)}`);
              this.closeTrade(trade, currentPrice, '📉 KINETIC_TRAILING_EXIT');
              return;
          }
       }

       // --- 4. Momentum Stagnation (فلتر تجمد الزخم) ---
       // User Request: Only close if momentum is actually DEAD, not if it's still healthy but taking a breather
       // A trade is "healthy" if OI is not dropping significantly and volume flow hasn't collapsed.
       const isHealthyContinuation = oiTrend > -0.01; 
       
       if (trade.highestPriceTime && trade.pnl > 0.1) {
           const minsSinceNewHigh = (Date.now() - trade.highestPriceTime) / 60000;
           if (minsSinceNewHigh >= momentumStallLimit && !isMomentumActive && !isHealthyContinuation) {
               console.log(`[SNIPER] 🧊 KINETIC SENSE: Momentum Stalled and Dropping for ${trade.symbol}. No new high in ${minsSinceNewHigh.toFixed(1)}m. Securing profit: +$${trade.pnl.toFixed(2)}`);
               this.closeTrade(trade, currentPrice, '🧊 KINETIC_STALL_EXIT');
               return;
           }
       }

       // --- 5. Kinetic Time & Volatility Decay (القتل الزمني الديناميكي) ---
       // a) Dead micro-structure exit (Only if not a healthy continuation)
       if (liveVolatilityPerc > 0 && liveVolatilityPerc < 0.03 && trade.pnl < benchmarkTp && minutesOpen > 2 && !isMomentumActive && !isHealthyContinuation) {
           console.log(`[SNIPER] 💤 KINETIC SENSE: Volatility collapsed to ${liveVolatilityPerc.toFixed(3)}%. Micro-structure is dead. Securing PnL: +$${trade.pnl.toFixed(2)}`);
           this.closeTrade(trade, currentPrice, '💤 KINETIC_VOLATILITY_DEATH');
           return;
       }

       // b) OI Collapse Guard (خروج عند انهيار الاوبن انترست)
       if (this.settings.kineticUseOpenInterest && oiTrend < -(0.08 * kineticSensitivity) && trade.pnl >= 0.1) {
           console.log(`[SNIPER] 📉 KINETIC SENSE: Open Interest Collapsing (${oiTrend.toFixed(3)}%). Operators leaving. Securing PnL: +$${trade.pnl.toFixed(2)}`);
           this.closeTrade(trade, currentPrice, '📉 KINETIC_OI_DEATH');
           return;
       }

       // c) Standard adaptive time decay (Only if it's struggling/bleeding, don't exit if it's holding healthy structure)
       if (minutesOpen >= smartTimeDelayLimit && !isMomentumActive && !isHealthyContinuation) {
          // If time is up and we haven't hit the benchmark TP, and momentum is dead, get out to preserve capital
          if (trade.pnl < benchmarkTp && trade.pnl > -benchmarkTp * 1.5) { 
             console.log(`[SNIPER] ⏳ KINETIC DECAY: Time limit reached with weak momentum for ${trade.symbol} (Open ${minutesOpen.toFixed(1)}m). Exiting at PnL: $${trade.pnl.toFixed(2)}`);
             this.closeTrade(trade, currentPrice, '⏳ KINETIC_DECAY_EXIT');
             return;
          }
       }
    }

    // Filter 4: Aggressive Trade Management (Fast Breakeven)
    if (this.settings.strictMode && !trade.isBreakeven) {
       const triggerPerc = this.settings.strictFastBreakevenPerc ?? 0.4; // Lowered to 0.4% from 0.75%
       if (triggerPerc > 0 && ((trade.type === 'LONG' && floatingPnlPerc >= triggerPerc) || (trade.type === 'SHORT' && floatingPnlPerc >= triggerPerc))) {
          trade.sl = trade.type === 'LONG' ? trade.entryPrice * 1.001 : trade.entryPrice * 0.999; 
          trade.isBreakeven = true;
          updated = true;
          console.log(`[SNIPER] 🛡️ STRICT MODE: Fast Breakeven triggered for ${trade.symbol} at +${triggerPerc}% PnL!`);
       }
    }

    if (trade.type === 'LONG') {
      // Hit TP1 (+1R)
      if (trade.status === 'OPEN' && currentPrice >= trade.tp1) {
        trade.status = 'TP1_HIT';
        trade.sl = trade.entryPrice; // Move SL to breakeven
        trade.isBreakeven = true;
        updated = true;
        console.log(`[SNIPER] 🎯 TP1 Hit for ${trade.symbol}! SL moved to Breakeven (${trade.sl}).`);
      }

      // Hit TP2 (+2R)
      if (currentPrice >= trade.tp2) {
         this.closeTrade(trade, currentPrice, '🎯 TP2_HIT');
         return;
      }

      // Hit SL
      if (currentPrice <= trade.sl) {
         this.closeTrade(trade, currentPrice, trade.isBreakeven ? '🛡️ BREAKEVEN' : '🛑 STOP_LOSS');
         return;
      }

    } else { // SHORT
      // Hit TP1 (+1R)
      if (trade.status === 'OPEN' && currentPrice <= trade.tp1) {
        trade.status = 'TP1_HIT';
        trade.sl = trade.entryPrice; // Move SL to breakeven
        trade.isBreakeven = true;
        updated = true;
        console.log(`[SNIPER] 🎯 TP1 Hit for ${trade.symbol}! SL moved to Breakeven (${trade.sl}).`);
      }

      // Hit TP2 (+2R)
      if (currentPrice <= trade.tp2) {
         this.closeTrade(trade, currentPrice, '🎯 TP2_HIT');
         return;
      }

      // Hit SL
      if (currentPrice >= trade.sl) {
         this.closeTrade(trade, currentPrice, trade.isBreakeven ? '🛡️ BREAKEVEN' : '🛑 STOP_LOSS');
         return;
      }
    }

    // Sync live PNL periodically, but let's just do it directly on update for SL moves
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

  private closeTrade(trade: Trade, exitPrice: number, reason: string) {
      trade.exitPrice = exitPrice;
      trade.status = 'CLOSED';
      trade.exitTime = Date.now();
      
      const pnlPerc = trade.type === 'LONG' 
        ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 
        : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
        
      trade.pnlPerc = pnlPerc;
      // Calculate PnL on remaining amount
      let finalPnl = (trade.amount * pnlPerc) / 100;
      
      if (trade.realizedPnl) {
          finalPnl += trade.realizedPnl;
      }
      
      trade.pnl = finalPnl;
      
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
      
      // 1. Slippage / Stop-Hunt Reversal Exploit (تحويل الانزلاق لربح)
      if (this.settings.beastSlippageExploit && isLoss && reason === '🛑 STOP_LOSS' && timeOpenMinutes < 3) {
          // If stopped out in < 3 minutes, it's highly likely a stop-hunt liquidity sweep.
          // Beast Mode immediately reverses the position and doubles the risk to ride the sweep!
          console.log(`[BEAST 🐺] LIQUIDITY SWEEP DETECTED ON ${trade.symbol}! Stopped out in ${timeOpenMinutes.toFixed(1)}m. Reversing position...`);
          
          const newType = trade.type === 'LONG' ? 'SHORT' : 'LONG';
          // Use previous SL as entry point (approximated)
          const newCond: MarketCondition = {
              symbol: trade.symbol,
              price: exitPrice,
              type: newType,
              score: 5, // Artificial high score for immediate entry
              support: newType === 'LONG' ? exitPrice * 0.99 : exitPrice, // tight 1% support/res
              resistance: newType === 'SHORT' ? exitPrice * 1.01 : exitPrice,
              isRanging: false,
              isBreakout: true,
              isRetestOrHold: true,
              isLiquidityGood: true,
              isMomentumHigh: true,
              isOrderBookClear: true
          };
          
          // Temporary boost risk for revenge trade
          const originalRisk = this.settings.riskPerTradePerc;
          this.settings.riskPerTradePerc = originalRisk * 2; // Double Risk
          this.executeTrade(newCond);
          this.settings.riskPerTradePerc = originalRisk; // Restore immediately
      }

      // 2. Auto-Adapt Settings (التعلم الذاتي)
      if (this.settings.beastAutoAdapt) {
           let updated = false;
           // If we've had consecutive losses, tighten conditions. If winning, loosen them to catch more.
           const recentTrades = this.tradeHistory.slice(0, 3);
           if (recentTrades.length === 3) {
               const allLosses = recentTrades.every(t => (t.pnl ?? 0) < 0);
               const allWins = recentTrades.every(t => (t.pnl ?? 0) > 0);

               if (allLosses) {
                   // Market is tough. Increase strictness.
                   if ((this.settings.strictMinRvol ?? 1) < 4.0) {
                      this.settings.strictMinRvol = (this.settings.strictMinRvol ?? 1.5) + (0.5 * learningRate); 
                      updated = true;
                   }
                   if ((this.settings.strictMinScore ?? 4) < 6) {
                      this.settings.strictMinScore = 6;
                      updated = true;
                   }
                   console.log(`[BEAST 🐺] Consecutive Losses. ADAPTING: Tightening filters (Min RVOL: ${this.settings.strictMinRvol?.toFixed(2)}).`);
               } else if (allWins) {
                   // Market is easy. Loosen conditions to print more money.
                   if ((this.settings.strictMinRvol ?? 3) > 1.2) {
                      this.settings.strictMinRvol = (this.settings.strictMinRvol ?? 3) - (0.5 * learningRate); 
                      updated = true;
                   }
                   if ((this.settings.strictMinScore ?? 6) > 4) {
                      this.settings.strictMinScore = 4;
                      updated = true;
                   }
                   console.log(`[BEAST 🐺] Hot Streak! ADAPTING: Loosening filters (Min RVOL: ${this.settings.strictMinRvol?.toFixed(2)}) to maximize opportunities.`);
               }
           }

           if (updated) {
               saveSettingsToDB(this.settings);
           }
      }
  }
}

export const sniper = new SniperEngine();
