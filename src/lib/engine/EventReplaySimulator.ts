import { Trade, MarketCondition, BotSettings, TradeType } from '../../types/trading.js';
import { CreativeEntryEngine } from './CreativeEntryEngine.js';
import { CreativePositionManager } from './CreativePositionManager.js';
import { RiskEngine } from './RiskEngine.js';
import { RegimeEngine } from './RegimeEngine.js';

export interface SimulatedTick {
  step: number;
  time: number;
  price: number;
  openInterest: number;
  volume: number;
  takerRatio: number; // Taker BUY / Taker SELL ratio
  fundingRate: number;
  atr: number;
  adx: number;
  high: number;
  low: number;
  open: number;
  close: number;
}

export interface SimulationScenario {
  id: string;
  name: string;
  description: string;
  regime: string;
  ticks: SimulatedTick[];
}

export interface ReplayAuditLog {
  step: number;
  time: number;
  price: number;
  openInterest: number;
  takerRatio: number;
  decision: string;
  activeState: string;
  expansionProb: number;
  exhaustionProb: number;
  distributionProb: number;
  pnl: number;
  sizeMultiplier: number;
  executionTactic: string;
  message: string;
}

export interface BacktestResult {
  scenarioId: string;
  scenarioName: string;
  totalSteps: number;
  status: 'SUCCESS' | 'STOPPED_OUT' | 'NO_TRADE' | 'ACTIVE';
  entryPrice: number;
  exitPrice: number;
  maxDrawdown: number;
  peakPnL: number;
  finalPnL: number;
  auditLogs: ReplayAuditLog[];
  chartData: any[];
}

export class EventReplaySimulator {
  private creativeEngine = new CreativeEntryEngine();
  private riskEngine = new RiskEngine();

  // Helper to generate synthetic tick-by-tick scenarios
  public getScenarios(): SimulationScenario[] {
    return [
      this.generateBullBreakoutScenario(),
      this.generateBullTrapScenario(),
      this.generateShortSqueezeScenario(),
      this.generateRangeSweepScenario()
    ];
  }

  // 1. Scenario: Bullish Breakout & Exhaustion (Succeeds but starts decaying)
  private generateBullBreakoutScenario(): SimulationScenario {
    const ticks: SimulatedTick[] = [];
    let price = 100.0;
    let oi = 5000000;
    let rvol = 1.0;
    let taker = 1.0;

    for (let step = 1; step <= 50; step++) {
      let change = 0;
      let oiChange = 0;
      let takerRatio = 1.0;

      if (step < 10) {
        // Flat range
        change = (Math.random() - 0.5) * 0.1;
        oiChange = (Math.random() - 0.5) * 2000;
        taker = 1.0 + (Math.random() - 0.5) * 0.04;
      } else if (step >= 10 && step < 20) {
        // BREAKOUT! High velocity
        change = 0.4 + Math.random() * 0.3; // high jump
        oiChange = 80000 + Math.random() * 40000; // heavy Open interest expanding
        taker = 1.15 + Math.random() * 0.1; // aggressive buyers stepping in
        rvol = 2.2;
      } else if (step >= 20 && step < 35) {
        // Moving to profit zone but slowing
        change = 0.08 + Math.random() * 0.05; 
        oiChange = 20000 + Math.random() * 10000;
        taker = 1.03 + Math.random() * 0.03;
        rvol = 1.4;
      } else {
        // EXHAUSTION / DISTRIBUTION (OI decaying, CVD flattening/collapsing, price stalls)
        change = (Math.random() - 0.5) * 0.02; // price barely moves
        oiChange = -60000 - Math.random() * 20000; // Open Interest drops rapidly (% decay)
        taker = 0.92 - Math.random() * 0.04; // Selling pressure starts/delta flattening
        rvol = 0.65; // volume dying
      }

      price += change;
      oi += oiChange;

      ticks.push(this.createTickObject(step, price, oi, rvol, taker));
    }

    return {
      id: "bull_breakout_exhaustion",
      name: "اختراق صعودي مع تلاشي السيولة (Bull Breakout & Exhaustion)",
      description: "محاكاة لاختراق حقيقي قوي يبدأ بزخم مرتفع، ينشط فيه القناص، ثم يدخل السعر في مرحلة ضعف السيولة (Exhaustion) وتناقص الفائدة المفتوحة لتأمين الربح مبكراً.",
      regime: "TREND_EXPANSION",
      ticks
    };
  }

  // 2. Scenario: Bull Trap (Fakeout & trapped liquidations)
  private generateBullTrapScenario(): SimulationScenario {
    const ticks: SimulatedTick[] = [];
    let price = 100.0;
    let oi = 5000000;
    let rvol = 1.0;
    let taker = 1.0;

    for (let step = 1; step <= 50; step++) {
      let change = 0;
      let oiChange = 0;
      let takerRatio = 1.0;

      if (step < 10) {
        change = (Math.random() - 0.5) * 0.1;
        oiChange = (Math.random() - 0.5) * 2000;
        taker = 1.0;
      } else if (step >= 10 && step < 18) {
        // Breakout trigger (Trap entry)
        change = 0.35 + Math.random() * 0.25;
        oiChange = 70000 + Math.random() * 30000;
        taker = 1.12 + Math.random() * 0.04;
        rvol = 2.0;
      } else if (step >= 18 && step < 25) {
        // Price stalling, delta negative (Ask absorption!)
        change = -0.01 + Math.random() * 0.03;
        oiChange = 10000 + Math.random() * 5000; // OI still rising but stagnant pricing
        taker = 0.88 - Math.random() * 0.05; // Massive selling absorbed/buyers weakening
        rvol = 1.8;
      } else {
        // FAKEOUT TRIGGERED -> Trapped Longs Cascade down
        change = -0.45 - Math.random() * 0.35; // Sharp correction
        oiChange = -150000 - Math.random() * 50000; // Liquidation cascade (OI collapsing)
        taker = 0.80 - Math.random() * 0.1; // Panic selling
        rvol = 3.0;
      }

      price += change;
      oi += oiChange;

      ticks.push(this.createTickObject(step, price, oi, rvol, taker));
    }

    return {
      id: "bull_trap_fakeout",
      name: "فخ ثيران واجتياح تصفية (Bull Trap & Trapped Longs Cascade)",
      description: "محاكاة لاختراق كاذب (Fakeout) حيث يعلق المشترون عند القمة مع استجابة لامتصاص البيع، ويلي ذلك انهيار عنيف ناتج عن تجميل تصفية المراكز.",
      regime: "LIQUIDITY_SWEEP",
      ticks
    };
  }

  // 3. Scenario: Short Squeeze Momentum
  private generateShortSqueezeScenario(): SimulationScenario {
    const ticks: SimulatedTick[] = [];
    let price = 100.0;
    let oi = 5100000;
    let rvol = 1.0;
    let taker = 1.0;

    for (let step = 1; step <= 50; step++) {
      let change = 0;
      let oiChange = 0;

      if (step < 10) {
        change = (Math.random() - 0.5) * 0.1;
        oiChange = (Math.random() - 0.5) * 2000;
        taker = 0.98;
      } else if (step >= 10 && step < 30) {
        // Squeezing
        change = 0.25 + Math.random() * 0.25;
        oiChange = -35000 - Math.random() * 15000; // Open Interest drops heavily (Shorts being forced out)
        taker = 1.08 + Math.random() * 0.06;
        rvol = 2.4;
      } else {
        // Retesting higher ground or continuing
        change = (Math.random() - 0.5) * 0.05;
        oiChange = (Math.random() - 0.5) * 5000;
        taker = 1.0;
        rvol = 1.0;
      }

      price += change;
      oi += oiChange;
      ticks.push(this.createTickObject(step, price, oi, rvol, taker));
    }

    return {
      id: "short_squeeze_momentum",
      name: "ضغط بائعين مؤسساتي عنيف (Short Squeeze Momentum Blast)",
      description: "محاكاة صعود حاد تغذيه تصفية عقود البائعين المكشوفة الجبرية (Short Liquidations)، الفائدة المفتوحة تتقلص بسرعة متسارعة تدعم اندفاع السعر.",
      regime: "MOMENTUM_MODE",
      ticks
    };
  }

  // 4. Scenario: Range Sweep & Support Absorption Reversal
  private generateRangeSweepScenario(): SimulationScenario {
    const ticks: SimulatedTick[] = [];
    let price = 102.0;
    let oi = 5000000;
    let rvol = 1.0;
    let taker = 1.0;

    for (let step = 1; step <= 50; step++) {
      let change = 0;
      let oiChange = 0;

      if (step < 15) {
        // Sliding to support
        change = -0.15 - Math.random() * 0.05;
        oiChange = 5000 + Math.random() * 5000;
        taker = 0.94;
        rvol = 1.1;
      } else if (step >= 15 && step < 22) {
        // Sweep support & Bid absorption trigger!
        change = -0.05 + Math.random() * 0.05; // price holds at bottom
        oiChange = 40000 + Math.random() * 20000;
        taker = 0.85 - Math.random() * 0.05; // selling heavy, taker drops
        rvol = 1.9; // heavy volume at bottom support
      } else if (step >= 22 && step < 40) {
        // Sharp bounce reversal!
        change = 0.22 + Math.random() * 0.15;
        oiChange = -15000 + Math.random() * 5000;
        taker = 1.08 + Math.random() * 0.04;
        rvol = 1.5;
      } else {
        // Reaching upper range
        change = (Math.random() - 0.5) * 0.05;
        oiChange = (Math.random() - 0.5) * 2000;
        taker = 1.0;
        rvol = 0.8;
      }

      price += change;
      oi += oiChange;
      ticks.push(this.createTickObject(step, price, oi, rvol, taker));
    }

    return {
      id: "range_sweep_absorption",
      name: "تنظيف سيولة ارتدادي وتأكيد الامتصاص (Range Sweep & Bid Absorption Reversal)",
      description: "محاكاة تذبذب عرضي، حيث يهبط السعر ليكسر الدعم، ويمتص كبار المشترون العروض بالكامل (Bid Absorption)، مما يولد ارتداداً حاداً ومربحاً.",
      regime: "COMPRESSION",
      ticks
    };
  }

  private createTickObject(step: number, price: number, oi: number, volume: number, taker: number): SimulatedTick {
    return {
      step,
      time: Date.now() + step * 5000,
      price: parseFloat(price.toFixed(4)),
      openInterest: Math.round(oi),
      volume: parseFloat(volume.toFixed(2)),
      takerRatio: parseFloat(taker.toFixed(4)),
      fundingRate: -0.005, // simulated negative funding for high-stress zones
      atr: 0.8,
      adx: 24,
      open: parseFloat((price - 0.1).toFixed(4)),
      high: parseFloat((price + 0.12).toFixed(4)),
      low: parseFloat((price - 0.15).toFixed(4)),
      close: parseFloat(price.toFixed(4))
    };
  }

  // Main runner to backtest/replay a scenario using the advanced engines
  public runSimulation(scenarioId: string, settings: BotSettings): BacktestResult {
    const scenario = this.getScenarios().find(s => s.id === scenarioId);
    if (!scenario) throw new Error("Scenario not found");

    const auditLogs: ReplayAuditLog[] = [];
    const chartData: any[] = [];
    const klinesBuffer: any[] = [];

    let activeTrade: Trade | null = null;
    let status: 'SUCCESS' | 'STOPPED_OUT' | 'NO_TRADE' | 'ACTIVE' = 'NO_TRADE';
    let entryPrice = 0;
    let exitPrice = 0;
    let maxDrawdown = 0;
    let peakPnL = 0;
    let finalPnL = 0;

    // Load regime statistics inside Regime Memory globally
    // Reset fakeout histories for realistic isolated testing
    RegimeEngine.calculateADX([]); // just reset/warm up

    // Feed step-by-step
    for (let i = 0; i < scenario.ticks.length; i++) {
      const tick = scenario.ticks[i];

      // Maintain simulated kline history window
      // [Timestamp, Open, High, Low, Close, Volume]
      klinesBuffer.push([
        tick.time,
        tick.open.toString(),
        tick.high.toString(),
        tick.low.toString(),
        tick.close.toString(),
        tick.openInterest.toString() // we reuse OI or custom indicators
      ]);
      if (klinesBuffer.length > 50) klinesBuffer.shift();

      let decisionMsg = "WAIT";
      let executionTactic = "NONE";
      let sizeMultiplier = 1.0;
      let activeStateName = "NONE";
      
      // Setup dynamic metrics
      const mc: MarketCondition = {
        symbol: "SIM_BTCUSDT",
        price: tick.price,
        isRanging: scenario.regime === "COMPRESSION",
        isBreakout: tick.step >= 10 && tick.step < 18,
        isRetestOrHold: tick.step >= 18,
        isLiquidityGood: tick.takerRatio > 1.02 || tick.takerRatio < 0.98,
        isMomentumHigh: tick.volume > 1.4,
        isOrderBookClear: true,
        score: i >= 10 ? 5 : 2,
        type: tick.takerRatio > 1.03 ? "LONG" : "SHORT",
        support: 98.5,
        resistance: 101.5,
        atr: tick.atr,
        spread: 0.0004, // 0.04% (ideal)
        oiChange24h: ((tick.openInterest - 5000000) / 5000000) * 100,
        fundingRate: tick.fundingRate,
        takerBuySellRatio: tick.takerRatio
      };

      // Ensure open trade is updated and simulated
      if (activeTrade) {
        status = 'ACTIVE';
        activeStateName = (activeTrade as any).creativeState || "ENTRY";
        
        // Push tick to history inside the trade
        if (!activeTrade.oiHistory) activeTrade.oiHistory = [];
        activeTrade.oiHistory.push(tick.openInterest);

        if (!activeTrade.tickHistory) activeTrade.tickHistory = [];
        activeTrade.tickHistory.push(tick.price);

        // Run continuous Probability computations for transition!
        const isLong = activeTrade.type === "LONG";
        const priceChangePerc = isLong
          ? ((tick.price - activeTrade.entryPrice) / activeTrade.entryPrice) * 100
          : ((activeTrade.entryPrice - tick.price) / activeTrade.entryPrice) * 100;

        // Continuous State Probabilities
        let expansionProbability = 0;
        if (priceChangePerc > 0) {
          expansionProbability += Math.min(40, priceChangePerc * 85);
        }
        if (tick.volume > 1.3) expansionProbability += 25;
        if (tick.takerRatio > 1.04) expansionProbability += 25;
        expansionProbability = Math.min(100, Math.round(expansionProbability));

        let exhaustionProbability = 0;
        if (priceChangePerc > 0.12) {
          exhaustionProbability += 15;
          // Calculate rate of change decay velocity
          let oiDecay = 0;
          if (activeTrade.oiHistory.length >= 4) {
             const prevOI = activeTrade.oiHistory[activeTrade.oiHistory.length - 4];
             oiDecay = ((tick.openInterest - prevOI) / prevOI) * 100;
          }
          if (oiDecay < -2.0) { // drops over 2% recently
             exhaustionProbability += Math.min(45, Math.abs(oiDecay) * 15);
          }
          
          const deltaFlattening = isLong ? (1.0 - tick.takerRatio) * 100 : (tick.takerRatio - 1.0) * 100;
          if (deltaFlattening > 0) {
            exhaustionProbability += Math.min(25, deltaFlattening * 2.5);
          }
          
          // Delta failure: CVD high but price doesn't move
          const priceAbsChange = Math.abs(tick.price - activeTrade.entryPrice) / activeTrade.entryPrice;
          if (tick.volume > 1.6 && priceAbsChange < 0.002) {
             exhaustionProbability += 20;
          }
        }
        exhaustionProbability = Math.min(100, Math.round(exhaustionProbability));

        let distributionProbability = 0;
        if (Math.abs(priceChangePerc) < 0.25) {
          distributionProbability += 20;
          if (tick.volume < 0.8) distributionProbability += 30;
          const flatCvd = Math.abs(tick.takerRatio - 1.0) * 100;
          if (flatCvd < 8) {
             distributionProbability += 30;
          }
        }
        distributionProbability = Math.min(100, Math.round(distributionProbability));

        // Inject calculated properties to tick level logs
        (tick as any).expansionProb = expansionProbability;
        (tick as any).exhaustionProb = exhaustionProbability;
        (tick as any).distributionProb = distributionProbability;

        // Execute step management rules
        const rvol = tick.volume;
        const oiv = 1.0;
        const pmVerdict = CreativePositionManager.manage(
          activeTrade,
          tick.price,
          rvol,
          tick.takerRatio,
          true,
          1.002,
          tick.atr
        );

        // Update trade pnl
        const feeRate = settings.tradingFeeRate || 0.001;
        const entryAmnt = activeTrade.amount;
        const slip = executionTactic === 'TWAP_SPLIT_LIMIT' ? 0 : 0.0003; // simulated slip
        
        const rawPnl = isLong
          ? ((tick.price - activeTrade.entryPrice) / activeTrade.entryPrice) * entryAmnt
          : ((activeTrade.entryPrice - tick.price) / activeTrade.entryPrice) * entryAmnt;
        
        activeTrade.pnl = rawPnl - (entryAmnt * feeRate) - (entryAmnt * slip);
        activeTrade.pnlPerc = (activeTrade.pnl / (entryAmnt / (settings.leverage || 10))) * 100;

        if (activeTrade.pnl > peakPnL) peakPnL = activeTrade.pnl;
        if (activeTrade.pnl < maxDrawdown) maxDrawdown = activeTrade.pnl;

        if (pmVerdict.action === 'CLOSE') {
          exitPrice = tick.price;
          finalPnL = activeTrade.pnl;
          status = pmVerdict.reason === 'CREATIVE_TP2_HIT' ? 'SUCCESS' : 'STOPPED_OUT';
          
          auditLogs.push({
            step: tick.step,
            time: tick.time,
            price: tick.price,
            openInterest: tick.openInterest,
            takerRatio: tick.takerRatio,
            decision: "CLOSE",
            activeState: activeStateName,
            expansionProb: (tick as any).expansionProb || 0,
            exhaustionProb: (tick as any).exhaustionProb || 0,
            distributionProb: (tick as any).distributionProb || 0,
            pnl: activeTrade.pnl,
            sizeMultiplier,
            executionTactic,
            message: `🚨 اغلاق المركز: تم تفعيل الإغلاق آلياً للسبب: ${pmVerdict.reason}. الربح النهائي المحقق: $${activeTrade.pnl.toFixed(2)}`
          });

          activeTrade = null; // Closed!
          continue;
        } else if (pmVerdict.action === 'PARTIAL') {
          Object.assign(activeTrade, pmVerdict.updatedTrade);
          auditLogs.push({
            step: tick.step,
            time: tick.time,
            price: tick.price,
            openInterest: tick.openInterest,
            takerRatio: tick.takerRatio,
            decision: "PARTIAL_EXIT",
            activeState: activeStateName,
            expansionProb: (tick as any).expansionProb || 0,
            exhaustionProb: (tick as any).exhaustionProb || 0,
            distributionProb: (tick as any).distributionProb || 0,
            pnl: activeTrade.pnl,
            sizeMultiplier,
            executionTactic,
            message: `💸 جني ربح جزئي: تصفية 50% من حجم الصفقة وتأمين الباقي بنقل الوقف للدخول.`
          });
        } else if (pmVerdict.action === 'UPDATE') {
          Object.assign(activeTrade, pmVerdict.updatedTrade);
        }

      } else if (status === 'NO_TRADE' || status === 'ACTIVE') {
        // Look for entries if we don't have active positions
        const decision = this.creativeEngine.analyze(
          klinesBuffer,
          tick.takerRatio,
          settings,
          tick.fundingRate,
          klinesBuffer.map(k => parseFloat(k[5])),
          []
        );

        if (decision.shouldEnter) {
          decisionMsg = "ENTER_" + decision.type;
          entryPrice = tick.price;
          
          // Execution microstructure selectors
          const spread = mc.spread || 0.0004;
          const isLiquidationActive = i >= 35 && scenario.id === 'bull_trap_fakeout';
          
          if (spread > 0.0012) {
            executionTactic = "TWAP_SPLIT_LIMIT";
          } else if (isLiquidationActive) {
            executionTactic = "MARKET_AGGRESSIVE";
          } else if (decision.executionScenario === 'ABSORPTION_SCALPING') {
            executionTactic = "SCALPED_LIMIT";
          } else {
            executionTactic = "MARKET_AGGRESSIVE";
          }

          // Dynamic Risk Sizing Multiplier calculations
          let mult = 1.0;
          if (decision.confidence >= 85) mult *= 1.45;
          if (decision.confidence < 68) mult *= 0.75;
          if (tick.volume > 2.0) mult *= 0.85; // drop slightly under dangerous overload
          mult = parseFloat(mult.toFixed(2));
          sizeMultiplier = mult;

          // Perform actual simulated size calculation
          const leverage = settings.leverage || 10;
          const slDistancePerc = decision.stopLossPerc || 1.5;
          const slPrice = decision.type === 'LONG' ? tick.price * (1 - slDistancePerc/100) : tick.price * (1 + slDistancePerc/100);

          const rawSelectedSize = this.riskEngine.calculatePositionSize(
            settings.portfolioSize,
            tick.price,
            slPrice,
            leverage,
            settings.maxConcurrentTrades || 10,
            settings.minPositionSizePerc || 0
          );
          const sizeUsd = rawSelectedSize * sizeMultiplier;

          activeTrade = {
            id: `SIM_TRADE_${Date.now()}`,
            symbol: "SIM_BTCUSDT",
            type: decision.type,
            mode: "PAPER",
            entryPrice: tick.price,
            entryTime: tick.time,
            amount: sizeUsd,
            sl: slPrice,
            initialSl: slPrice,
            tp1: decision.type === 'LONG' ? tick.price * (1 + (decision.takeProfitPerc * 0.4)/100) : tick.price * (1 - (decision.takeProfitPerc * 0.4)/100),
            tp2: decision.type === 'LONG' ? tick.price * (1 + decision.takeProfitPerc/100) : tick.price * (1 - decision.takeProfitPerc/100),
            status: "OPEN",
            score: 5,
            isBreakeven: false,
            pnl: 0,
            pnlPerc: 0
          };

          (activeTrade as any).creativeState = "ENTRY";
          activeStateName = "ENTRY";

          auditLogs.push({
            step: tick.step,
            time: tick.time,
            price: tick.price,
            openInterest: tick.openInterest,
            takerRatio: tick.takerRatio,
            decision: decisionMsg,
            activeState: activeStateName,
            expansionProb: 15,
            exhaustionProb: 0,
            distributionProb: 0,
            pnl: 0,
            sizeMultiplier,
            executionTactic,
            message: `🟢 نمط دخول متكامل: ${decision.reason} | الثقة: ${decision.confidence}% | التكتيك: ${executionTactic} | معامل الحجم الديناميكي: ${sizeMultiplier}x (صفقة بـ $${sizeUsd.toFixed(2)})`
          });
        }
      }

      // Record visual timeline metrics
      chartData.push({
        step: tick.step,
        price: tick.price,
        openInterest: tick.openInterest,
        volume: tick.volume,
        takerRatio: tick.takerRatio,
        expansionProb: (tick as any).expansionProb || 0,
        exhaustionProb: (tick as any).exhaustionProb || 0,
        distributionProb: (tick as any).distributionProb || 0,
        pnl: activeTrade ? activeTrade.pnl : 0
      });

      // Default audit tracking when waiting or in open state
      if (decisionMsg === "WAIT" && i > 0) {
        auditLogs.push({
          step: tick.step,
          time: tick.time,
          price: tick.price,
          openInterest: tick.openInterest,
          takerRatio: tick.takerRatio,
          decision: activeTrade ? "COMMITTED" : "SCANNING",
          activeState: activeStateName,
          expansionProb: (tick as any).expansionProb || 0,
          exhaustionProb: (tick as any).exhaustionProb || 0,
          distributionProb: (tick as any).distributionProb || 0,
          pnl: activeTrade ? activeTrade.pnl : 0,
          sizeMultiplier,
          executionTactic,
          message: activeTrade 
            ? `مراقبة المركز المفتوح [${activeTrade.type} SIM] | السعر الحالي: ${tick.price.toFixed(2)} | حالة الاحتمال: Exhaustion ${(tick as any).exhaustionProb}% | PnL الحالي: $${activeTrade.pnl.toFixed(2)}`
            : `المنسق يبحث عن سيولة للتنفيذ... النظام في حالة ترقب هادئة.`
        });
      }
    }

    // Wrap up results
    if (activeTrade) {
      status = 'ACTIVE';
      finalPnL = activeTrade.pnl;
    }

    return {
      scenarioId,
      scenarioName: scenario.name,
      totalSteps: scenario.ticks.length,
      status,
      entryPrice,
      exitPrice,
      maxDrawdown,
      peakPnL,
      finalPnL,
      auditLogs,
      chartData
    };
  }
}

export const simulator = new EventReplaySimulator();
