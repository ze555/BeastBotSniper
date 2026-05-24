import { TradeType } from '../../types/trading.js';
import { RegimeEngine } from './RegimeEngine.js';

export interface CreativeEngineDecision {
  shouldEnter: boolean;
  type: TradeType;
  reason: string;
  takeProfitPerc: number;
  stopLossPerc: number;
  confidence: number;
  mode: 'RANGE' | 'TREND' | 'PANIC' | 'NEUTRAL' | 'CHAOTIC_DEATH_CHOP';
  waitForRetest: boolean;
  invalidationLevel: number;
  liquidityTarget: number;
  executionScenario: 'DIRECT_MOMENTUM' | 'RETEST_ENTRY_REQUIRED' | 'ABSORPTION_SCALPING' | 'NO_TRADE';
  marketNarrative: string;
}

export interface CreativeEngineData {
  ATR: number;
  ADX: number;
  rangePercent: number;
  fakeBreakoutsCount: number;
  priceExpansion: boolean;
  atrExpanding: boolean;
  atrExploding: boolean;
  liquidationSpike: boolean;
  
  // Market State indicators
  priceUp: boolean;
  priceDown: boolean;
  priceStable: boolean;
  oiUp: boolean;
  oiDown: boolean;
  oiSlowlyIncreasing: boolean;
  cvdPositive: boolean;
  cvdNegative: boolean;
  cvdWeak: boolean;
  cvdStrong: boolean;
  cvdFlippingPositive: boolean;
  cvdFlippingNegative: boolean;
  rvol: number;
  fundingExtremeNegative: boolean;
  fundingExtremePositive: boolean;
  shortLiquidations: boolean;
  longLiquidations: boolean;
  volatilityCompressed: boolean;

  // Breakout and Traps
  breakoutUp: boolean;
  breakoutDown: boolean;
  volumeWeak: boolean;
  priceHoldingAboveBreakout: boolean;
  priceHoldingBelowBreakout: boolean;
  bidPressure: boolean;
  askPressure: boolean;
  nearMajorResistance: boolean;
  nearMajorSupport: boolean;
  nearSupport: boolean;
  nearResistance: boolean;
  sellingWeakening: boolean;
  buyingWeakening: boolean;
  shortLiquidationsIncreasing: boolean;
  longLiquidationsIncreasing: boolean;

  // Confirmations
  lastCandleClosedStrong: boolean;
  lastCandleClosedWeak: boolean;
  rejectionWick: boolean;
  lowerRejection: boolean;
  priceHolding: boolean;
  priceHoldingBelow: boolean;

  // --- INSTITUTIONAL VELOCITY ADDITIONS ---
  priceVelocity: number;     // speed of price changes
  volumeVelocity: number;    // rate of volume surge
  cvdVelocity: number;       // rate of aggressive purchasing
  oiVelocity: number;        // Open Interest acceleration speed

  // --- ORDER BOOK LIQUIDITY MAP & CONTEXT ---
  higherTimeframeBias: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  liquidityAbove: number;    // cluster resistance level
  liquidityBelow: number;    // cluster support level
  distanceToLiquidityAbove: number; // in percentage
  distanceToLiquidityBelow: number; // in percentage
  isVolatilityTooChaotic: boolean; // Volatility Filter (Death Chop prevention)

  // --- DELTA & ABSORPTION CONFIRMATION ---
  bidAbsorption: boolean;    // Aggressive sellers absorbed by active limit buyers
  askAbsorption: boolean;    // Aggressive buyers absorbed by active limit sellers
  footprintImbalance: number; // simulated sell vs buy flow pressure ratio

  // --- ADVANCED INSTITUTIONAL CONTEXT & LIQUIDITY MAPS ---
  liquidityTypeAbove: 'MAGNET' | 'ABSORPTION' | 'STANDARD';
  liquidityTypeBelow: 'MAGNET' | 'ABSORPTION' | 'STANDARD';
  liquidityStrengthAbove: number;
  liquidityStrengthBelow: number;
  liquidityConsumedRateAbove: number;
  liquidityConsumedRateBelow: number;
  estimatedLongLiquidationZone: number;
  estimatedShortLiquidationZone: number;
  htfImbalance: boolean;
  htfCompression: boolean;
  htfTrappedTraders: 'SHORTS_TRAPPED' | 'LONGS_TRAPPED' | 'NONE';
}

export class CreativeEntryEngine {
  /**
   * Main entry point to analyze kline metrics and determine signals
   */
  public analyze(
    klines: any[], 
    takerRatio: number, 
    settings?: any,
    fundingRate: number = 0,
    oiHistory: number[] = [],
    volHistory: number[] = []
  ): CreativeEngineDecision {
    if (klines.length < 30) {
      return { 
        shouldEnter: false, 
        type: 'LONG', 
        reason: 'إحصائيات غير كافية', 
        takeProfitPerc: 0, 
        stopLossPerc: 0,
        confidence: 0,
        mode: 'NEUTRAL',
        waitForRetest: false,
        invalidationLevel: 0,
        liquidityTarget: 0,
        executionScenario: 'NO_TRADE',
        marketNarrative: 'بيانات غير كافية لبناء السرد السوقي.'
      };
    }

    // 1. Gather all advanced indicators and velocity vectors
    const data = this.mapToCreativeData(klines, takerRatio, fundingRate, oiHistory, volHistory);
    const mode = this.detectMarketMode(data);
    const state = this.detectMarketState(data);

    // Volatility Filter: Escape the Death Chop!
    if (data.isVolatilityTooChaotic && mode === 'RANGE') {
      return {
        shouldEnter: false,
        type: 'LONG',
        reason: 'Death Chop Volatility Bypass',
        takeProfitPerc: 0,
        stopLossPerc: 0,
        confidence: 0,
        mode: 'CHAOTIC_DEATH_CHOP',
        waitForRetest: false,
        invalidationLevel: 0,
        liquidityTarget: 0,
        executionScenario: 'NO_TRADE',
        marketNarrative: 'منطقة تقطيع شديد وغير منظمة (Death Chop). تم تفعيل فلتر التقلبات لتجنب نزيف الحسابات.'
      };
    }

    // 2. Determine trade direction and proportional confidence
    const evaluation = this.evaluateEntryProportional(data, mode, state);
    if (!evaluation.shouldEnter) {
      return {
        shouldEnter: false,
        type: 'LONG',
        reason: 'No Entry Pattern Identified',
        takeProfitPerc: 0,
        stopLossPerc: 0,
        confidence: evaluation.confidence,
        mode,
        waitForRetest: false,
        invalidationLevel: 0,
        liquidityTarget: 0,
        executionScenario: 'NO_TRADE',
        marketNarrative: evaluation.narrative
      };
    }

    // 3. Select TakeProfit, StopLoss, and Execution Scenario Staging
    const currentPx = parseFloat(klines[klines.length - 1][4]);
    const isLong = evaluation.type === 'LONG';
    
    // Proportional Multipliers and limits
    const slScale = settings?.quantumSlScale ?? 1.0;
    const tpScale = settings?.quantumTpScale ?? 1.0;

    let stopLossPerc = Math.max(0.2, data.ATR * 1.5) * slScale;
    let takeProfitPerc = stopLossPerc * 2.0 * tpScale;

    // Tailored parameters per strategy style
    if (evaluation.scenario === 'RETEST_ENTRY_REQUIRED') {
      stopLossPerc = Math.max(0.2, data.ATR * 1.2) * slScale; // tighter stop because we execute on retest
      takeProfitPerc = stopLossPerc * 3.0 * tpScale; // higher risk-reward
    } else if (evaluation.scenario === 'DIRECT_MOMENTUM') {
      stopLossPerc = Math.max(0.3, data.ATR * 1.7) * slScale; // wider breathing space for breakout high-velocity
      takeProfitPerc = stopLossPerc * 2.2 * tpScale;
    } else if (evaluation.scenario === 'ABSORPTION_SCALPING') {
      stopLossPerc = Math.max(0.15, data.ATR * 1.0) * slScale; // very tight stop underneath absorption block
      takeProfitPerc = stopLossPerc * 2.5 * tpScale;
    }

    // Sanitize levels
    stopLossPerc = Math.min(6.0, Math.max(0.15, stopLossPerc));
    takeProfitPerc = Math.min(18.0, Math.max(0.3, takeProfitPerc));

    // Dynamic Level Planning
    const invalidationLevel = isLong 
      ? currentPx * (1 - (stopLossPerc / 100)) 
      : currentPx * (1 + (stopLossPerc / 100));

    const liquidityTarget = isLong ? data.liquidityAbove : data.liquidityBelow;

    return {
      shouldEnter: true,
      type: evaluation.type,
      reason: evaluation.reason,
      takeProfitPerc,
      stopLossPerc,
      confidence: evaluation.confidence,
      mode,
      waitForRetest: evaluation.scenario === 'RETEST_ENTRY_REQUIRED',
      invalidationLevel,
      liquidityTarget,
      executionScenario: evaluation.scenario,
      marketNarrative: evaluation.narrative
    };
  }

  // ==========================================================
  // 1. GLOBAL MARKET MODE DETECTION
  // ==========================================================
  public detectMarketMode(data: CreativeEngineData): 'RANGE' | 'TREND' | 'PANIC' | 'NEUTRAL' {
    const adx = data.ADX;
    const rangePercent = data.rangePercent;
    const fakeBreakouts = data.fakeBreakoutsCount;

    if (data.atrExploding && data.liquidationSpike) {
      return 'PANIC';
    }

    if (adx < 19 && rangePercent < 3.0 && fakeBreakouts >= 2) {
      return 'RANGE';
    }

    if (adx > 21 && data.atrExpanding && data.priceExpansion) {
      return 'TREND';
    }

    return 'NEUTRAL';
  }

  // ==========================================================
  // 2. MARKET STATE ENGINE
  // ==========================================================
  public detectMarketState(data: CreativeEngineData): 
    'BULLISH_TREND' | 'BEARISH_TREND' | 'SHORT_SQUEEZE' | 'LONG_SQUEEZE' | 'ACCUMULATION' | 'UNKNOWN' {
    
    if (data.priceUp && data.oiUp && data.cvdPositive && data.rvol > 1.8) {
      return 'BULLISH_TREND';
    }

    if (data.priceDown && data.oiUp && data.cvdNegative && data.rvol > 1.8) {
      return 'BEARISH_TREND';
    }

    if (data.priceUp && data.oiDown && data.fundingExtremeNegative && data.shortLiquidations) {
      return 'SHORT_SQUEEZE';
    }

    if (data.priceDown && data.oiDown && data.fundingExtremePositive && data.longLiquidations) {
      return 'LONG_SQUEEZE';
    }

    if (data.priceStable && data.oiSlowlyIncreasing && data.volatilityCompressed) {
      return 'ACCUMULATION';
    }

    return 'UNKNOWN';
  }

  // ==========================================================
  // 3. PROPORTIONAL CONFIDENCE AND SCENARIO PLANNING EVALUATION
  // ==========================================================
  private evaluateEntryProportional(
    data: CreativeEngineData, 
    mode: 'RANGE' | 'TREND' | 'PANIC' | 'NEUTRAL',
    state: string
  ): {
    shouldEnter: boolean;
    type: TradeType;
    confidence: number;
    scenario: 'DIRECT_MOMENTUM' | 'RETEST_ENTRY_REQUIRED' | 'ABSORPTION_SCALPING' | 'NO_TRADE';
    reason: string;
    narrative: string;
  } {
    let longConfidence = 0;
    let shortConfidence = 0;

    // --- PROPORTIONAL CONFIDENCE HARVESTING ---
    // A. Price & Vol Velocity Multipliers
    const pVelocityBonus = Math.min(30, data.priceVelocity * 10); // up to 30 confidence
    const vVelocityBonus = Math.min(20, (data.volumeVelocity - 1) * 10); // up to 20 confidence
    const cvdVelocityBonus = Math.min(20, (data.cvdVelocity - 1) * 10); // up to 20 confidence
    const oiVelocityBonus = Math.min(20, (data.oiVelocity - 1) * 10); // up to 20 confidence

    // B. Liquidity Map Hunt Advantage
    const huntLongAdvantage = data.distanceToLiquidityAbove < 1.0 ? 25 : (data.distanceToLiquidityAbove < 2.5 ? 15 : 5);
    const huntShortAdvantage = data.distanceToLiquidityBelow < 1.0 ? 25 : (data.distanceToLiquidityBelow < 2.5 ? 15 : 5);

    // C. HTF (Higher Timeframe) Bias Protection
    const bullishHtfMultiplier = data.higherTimeframeBias === 'BULLISH' ? 1.25 : (data.higherTimeframeBias === 'BEARISH' ? 0.6 : 1.0);
    const bearishHtfMultiplier = data.higherTimeframeBias === 'BEARISH' ? 1.25 : (data.higherTimeframeBias === 'BULLISH' ? 0.6 : 1.0);

    // D. Absorption Mechanics (Gems)
    const bidAbsorptionSignal = data.bidAbsorption && data.nearSupport;
    const askAbsorptionSignal = data.askAbsorption && data.nearResistance;

    // --- STRATEGY FLOW PATHS ---

    // 1. Breakout Momentum Setup (Triggered on Trend Mode)
    if (mode === 'TREND') {
      if (state === 'BULLISH_TREND') {
        longConfidence = 25; // Base starting confidence
        longConfidence += pVelocityBonus;
        longConfidence += cvdVelocityBonus;
        longConfidence += oiVelocityBonus;
        longConfidence += huntLongAdvantage;
        longConfidence *= bullishHtfMultiplier;

        if (data.breakoutUp) longConfidence += 20;
        if (data.lastCandleClosedStrong) longConfidence += 10;
        if (data.askAbsorption) longConfidence -= 40; // Heavy wall absorbed, can fall back
      } 
      
      else if (state === 'BEARISH_TREND') {
        shortConfidence = 25;
        shortConfidence += pVelocityBonus;
        shortConfidence += cvdVelocityBonus;
        shortConfidence += oiVelocityBonus;
        shortConfidence += huntShortAdvantage;
        shortConfidence *= bearishHtfMultiplier;

        if (data.breakoutDown) shortConfidence += 20;
        if (data.lastCandleClosedWeak) shortConfidence += 10;
        if (data.bidAbsorption) shortConfidence -= 40; // Heavy bid absorbed, potential bounce
      }
    }

    // 2. Liquidity Sweep & Range Reversion (In Range Mode)
    else if (mode === 'RANGE') {
      if (data.nearSupport) {
        // Looking for Liquidity Sweep of early buyers, and Reversion
        longConfidence = 20;
        longConfidence += cvdVelocityBonus * 0.5;
        longConfidence += huntLongAdvantage; // target opposite end range liquidity pool
        longConfidence *= bullishHtfMultiplier;

        if (data.lowerRejection) longConfidence += 25; // sharp rejection wick
        if (bidAbsorptionSignal) longConfidence += 35; // major sellers absorbed
        if (data.cvdFlippingPositive) longConfidence += 15;
      }
      
      else if (data.nearResistance) {
        shortConfidence = 20;
        shortConfidence += cvdVelocityBonus * 0.5;
        shortConfidence += huntShortAdvantage;
        shortConfidence *= bearishHtfMultiplier;

        if (data.rejectionWick) shortConfidence += 25;
        if (askAbsorptionSignal) shortConfidence += 35;
        if (data.cvdFlippingNegative) shortConfidence += 15;
      }
    }

    // 3. Short/Long Squeeze Sprints (Panic Mode / High Liquidations)
    else if (mode === 'PANIC') {
      if (state === 'SHORT_SQUEEZE') {
        longConfidence = 40; // Huge base due to margin panic
        longConfidence += pVelocityBonus * 1.5;
        longConfidence += oiVelocityBonus;
        longConfidence += huntLongAdvantage;
        longConfidence *= bullishHtfMultiplier;
      } 
      else if (state === 'LONG_SQUEEZE') {
        shortConfidence = 40;
        shortConfidence += pVelocityBonus * 1.5;
        shortConfidence += oiVelocityBonus;
        shortConfidence += huntShortAdvantage;
        shortConfidence *= bearishHtfMultiplier;
      }
    }

    // Neutral fallback check
    if (longConfidence < 58 && shortConfidence < 58) {
      // Look for micro-absorption zone
      if (bidAbsorptionSignal && bullishHtfMultiplier >= 1.0) {
        longConfidence = 62; // standalone high-conviction scalping pattern
      } else if (askAbsorptionSignal && bearishHtfMultiplier >= 1.0) {
        shortConfidence = 62;
      }
    }

    // --- FINAL DECISION MAPPING & SCENARIO DESIGN ---
    let targetConfidence = Math.max(longConfidence, shortConfidence);
    const CONFIDENCE_THRESHOLD = 60;
    const isLong = longConfidence >= shortConfidence;

    // Apply Non-linear Confidence Squeeze & Trapped Traders Multipliers (Gap 5)
    let finalConfidence = targetConfidence;
    let multiplierReasons: string[] = [];

    // Multiplier A: Volatility Compression Explosion (Explosive speed when compressed)
    const isExplosiveSqueeze = (data.oiVelocity > 1.025 || data.oiSlowlyIncreasing) && data.volatilityCompressed;
    if (isExplosiveSqueeze) {
      finalConfidence *= 1.45;
      multiplierReasons.push("انفجار لضغط الفائدة المفتوحة مع ضيق التقلب (Squeeze)");
    }

    // Multiplier B: Trapped Traders Squeeze Injection
    if (isLong && data.htfTrappedTraders === 'SHORTS_TRAPPED') {
      finalConfidence *= 1.35;
      multiplierReasons.push("فخ للبائعين (Shorts Trapped) عند القاع الجوهري");
    } else if (!isLong && data.htfTrappedTraders === 'LONGS_TRAPPED') {
      finalConfidence *= 1.35;
      multiplierReasons.push("فخ للمشترين (Longs Trapped) عند القمة الهيكلية");
    }

    // Multiplier C: Absorption near structure with HTF trend alignment
    if (isLong && data.higherTimeframeBias === 'BULLISH' && data.bidAbsorption) {
      finalConfidence *= 1.25;
      multiplierReasons.push("امتصاص بيع حوت عند الدعم (Bid Absorption) متوافق مع الاتجاه");
    } else if (!isLong && data.higherTimeframeBias === 'BEARISH' && data.askAbsorption) {
      finalConfidence *= 1.25;
      multiplierReasons.push("امتصاص شراء حوت عند المقاومة (Ask Absorption) متوافق مع الاتجاه");
    }

    // Multiplier D: Magnetic Liquidation Zone Attraction
    const isNearLiquidationAbove = isLong && data.distanceToLiquidityAbove < 0.8;
    const isNearLiquidationBelow = !isLong && data.distanceToLiquidityBelow < 0.8;
    if (isNearLiquidationAbove || isNearLiquidationBelow) {
      finalConfidence *= 1.20;
      multiplierReasons.push("سحب مغناطيسي نحو تجمعات التصفية (Liquidation Hunt)");
    }

    // Adaptive Regime Memory Adjustment (Point 2): Scale down breakouts if fake breakouts are currently high
    const recentFakeoutRate = RegimeEngine.getRecentFakeoutRate();
    if (recentFakeoutRate > 0.35) {
      finalConfidence *= 0.72; // Squeeze breakout confidence down by 28%
      multiplierReasons.push(`تقليص ثقة الاختراقات بسبب زيادة الاختراقات الكاذبة اليومية (${(recentFakeoutRate * 100).toFixed(0)}% Fakeouts)`);
    }

    // Cap confidence at 100%
    finalConfidence = Math.min(100, Math.round(finalConfidence));
    targetConfidence = finalConfidence;

    if (targetConfidence >= CONFIDENCE_THRESHOLD) {
      const type: TradeType = isLong ? 'LONG' : 'SHORT';
      
      // Determine execution style dynamically
      let scenario: 'DIRECT_MOMENTUM' | 'RETEST_ENTRY_REQUIRED' | 'ABSORPTION_SCALPING' = 'DIRECT_MOMENTUM';
      let reason = '';
      let narrative = '';

      if (mode === 'TREND') {
        const velCheck = isLong ? data.priceVelocity : -data.priceVelocity;
        // If Velocity is too high (parabolic), we WAIT for a retest of breakouts to prevent buying local peaks
        if (velCheck > 1.8) {
          scenario = 'RETEST_ENTRY_REQUIRED';
          reason = isLong ? 'BullBreak_RetestWait' : 'BearBreak_RetestWait';
          narrative = isLong
            ? `اختراق صعودي قوي جدا بثقة ${Math.round(targetConfidence)}%. السرعة مرتفعة (${data.priceVelocity.toFixed(2)}). سننتظر إعادة اختبار أو استقرار السعر لتجنب صيد القمة.`
            : `اختراق هبوطي حاد بثقة ${Math.round(targetConfidence)}%. السرعة مرتفعة (${Math.abs(data.priceVelocity).toFixed(2)}). سينتظر محرك الدخول إعادة اختبار الدعم المكسور كإجراء احترازي.`;
        } else {
          scenario = 'DIRECT_MOMENTUM';
          reason = isLong ? 'TrendRun_Direct' : 'TrendRun_Direct';
          narrative = isLong
            ? `سياق صعودي متناسق بثقة ${Math.round(targetConfidence)}% مع محاذاة الفاصل الأعلى للزخم وهدف سيولة علوي رائع عند ${data.liquidityAbove.toFixed(1)}.`
            : `سياق هبوطي منسق بدعم زخم الفاصل الأكبر. الثقة ${Math.round(targetConfidence)}%. استهداف السيولة المتراكمة في الأسفل عند ${data.liquidityBelow.toFixed(1)}.`;
        }
      } 
      
      else if (mode === 'RANGE') {
        const absCheck = isLong ? bidAbsorptionSignal : askAbsorptionSignal;
        if (absCheck) {
          scenario = 'ABSORPTION_SCALPING';
          reason = isLong ? 'Support_Absorbed_Buy' : 'Resistance_Absorbed_Sell';
          narrative = isLong
            ? `كشف امتصاص رائع للبيع (Bid Absorption) عند الدعم. الحيتان تمتص عروض البيع بالكامل مع ثقة ${Math.round(targetConfidence)}%. تفعيل دخول فوري أسفل كتلة الامتصاص.`
            : `كشف امتصاص للشراء (Ask Absorption) عند المقاومة الهيكلية. تراجع تدريجي للمشترين برغم الحجم الضخم وثقة ${Math.round(targetConfidence)}%. دخول لصفقة بيع سريعة.`;
        } else {
          scenario = 'RETEST_ENTRY_REQUIRED';
          reason = isLong ? 'RangeSweep_Retest' : 'RangeSweep_Retest';
          narrative = isLong
            ? `تجمع صفقات مباغته لتنظيف سيولة القاع (Liquidity Sweep). ثقة الارتداد ${Math.round(targetConfidence)}%. ننتظر إغلاق الشمعة وتأكيد الارتداد لتثبيت الدخول.`
            : `اجتياح سيولة القمة (Liquidity Sweep) للقمة الفرعية. ثقة الارتداد الهبوطي ${Math.round(targetConfidence)}%. ننتظر إعادة تذوق القمة مع تناقص رغبة الشراء لتجنب تقلبات التذبذب.`;
        }
      } 
      
      else if (mode === 'PANIC') {
        scenario = 'DIRECT_MOMENTUM';
        reason = isLong ? 'Short_Squeeze_Panic' : 'Long_Squeeze_Panic';
        narrative = isLong
          ? `ارتفاع قاسي ناتج عن تصفية صفقات البيع (Short Squeeze). الثقة ${Math.round(targetConfidence)}%. سرعة مفرطة وقود تصفية يقودنا للقمم التالية.`
          : `تصفية جماعية لعقود الشراء (Long Squeeze). الفتح المفتوح يتناقص بشكل حاد والسيولة تلتهم الأسعار بثقة ${Math.round(targetConfidence)}%.`;
      }

      // Add information about active multi-confluences to narrative
      if (multiplierReasons.length > 0) {
        narrative += ` [عوامل تسريع مؤسساتية: ${multiplierReasons.join(" | ")}]`;
      }

      return {
        shouldEnter: true,
        type,
        confidence: targetConfidence,
        scenario,
        reason,
        narrative
      };
    }

    // Default No entry identified
    return {
      shouldEnter: false,
      type: 'LONG',
      confidence: targetConfidence,
      scenario: 'NO_TRADE',
      reason: 'No Signal Strong Enough',
      narrative: `المؤشرات والسياق العام غير متوازنين للدخول. أعلى ثقة مرصودة كانت: LONG ${Math.round(longConfidence)}% | SHORT ${Math.round(shortConfidence)}% (الحد الأدنى للدخول هو 60%).`
    };
  }

  /**
   * Complex mathematical mapping helper that extracts all indicators
   * directly from raw candledata and derivative parameters.
   */
  private mapToCreativeData(
    klines: any[], 
    takerRatio: number, 
    fundingRate: number,
    oiHistory: number[],
    volHistory: number[]
  ): CreativeEngineData {
    const len = klines.length;
    const lastIdx = len - 1;
    const prevIdx = len - 2;

    const last = klines[lastIdx];
    const prev = klines[prevIdx];

    const c0 = parseFloat(last[4]);
    const o0 = parseFloat(last[1]);
    const h0 = parseFloat(last[2]);
    const l0 = parseFloat(last[3]);
    const v0 = parseFloat(last[5]);

    const c1 = parseFloat(prev[4]);
    const o1 = parseFloat(prev[1]);
    const h1 = parseFloat(prev[2]);
    const l1 = parseFloat(prev[3]);

    // Calculate ATR (14 candle Wilder's smoothed ATR variant)
    let trs: number[] = [];
    for (let i = 1; i < len; i++) {
      const curH = parseFloat(klines[i][2]);
      const curL = parseFloat(klines[i][3]);
      const lastC = parseFloat(klines[i - 1][4]);
      const tr = Math.max(curH - curL, Math.abs(curH - lastC), Math.abs(curL - lastC));
      trs.push(tr);
    }
    
    // Average True Range (Wilder representation or simple moving average)
    const atrPeriod = Math.min(14, trs.length);
    let atr = trs.slice(-atrPeriod).reduce((acc, val) => acc + val, 0) / atrPeriod;
    const atrPercentage = (atr / c0) * 100;

    // Calculate ADX (Standard Wilder's DIs and DX calculation)
    let adx = 20; // Default fallback
    if (len >= 15) {
      let trSum = 0;
      let plusDMSum = 0;
      let minusDMSum = 0;

      for (let i = len - 15; i < len - 1; i++) {
        const curH = parseFloat(klines[i + 1][2]);
        const curL = parseFloat(klines[i + 1][3]);
        const prevH = parseFloat(klines[i][2]);
        const prevL = parseFloat(klines[i][3]);
        const prevC = parseFloat(klines[i][4]);

        const tr = Math.max(curH - curL, Math.abs(curH - prevC), Math.abs(curL - prevC));
        trSum += tr;

        const upMove = curH - prevH;
        const downMove = prevL - curL;

        const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
        const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;

        plusDMSum += plusDM;
        minusDMSum += minusDM;
      }

      const plusDI = trSum > 0 ? (plusDMSum / trSum) * 100 : 0;
      const minusDI = trSum > 0 ? (minusDMSum / trSum) * 100 : 0;

      const sumDI = plusDI + minusDI;
      const diffDI = Math.abs(plusDI - minusDI);
      const dx = sumDI > 0 ? (diffDI / sumDI) * 100 : 0;
      
      adx = dx; // Recent ADX
    }

    // Dynamic Support / Resistance over last 20 candles
    const lookback = Math.min(20, len - 1);
    let highestHigh = parseFloat(klines[len - 2][2]);
    let lowestLow = parseFloat(klines[len - 2][3]);
    for (let i = len - lookback - 1; i < len - 1; i++) {
      const h = parseFloat(klines[i][2]);
      const l = parseFloat(klines[i][3]);
      if (h > highestHigh) highestHigh = h;
      if (l < lowestLow) lowestLow = l;
    }

    const rangePercent = ((highestHigh - lowestLow) / lowestLow) * 100;

    // Relative Volume (RVOL)
    let volSum = 0;
    const volLookback = Math.min(10, len - 1);
    for (let i = len - volLookback - 1; i < len - 1; i++) {
      volSum += parseFloat(klines[i][5]);
    }
    const avgVol = volSum / volLookback;
    const rvol = avgVol > 0 ? v0 / avgVol : 1.0;

    // ATR expanding / exploding / volatility compressed
    let recentAtrs: number[] = [];
    for (let j = len - 5; j < len; j++) {
      if (j >= 1) {
        const curH = parseFloat(klines[j][2]);
        const curL = parseFloat(klines[j][3]);
        const lastC = parseFloat(klines[j - 1][4]);
        const tr = Math.max(curH - curL, Math.abs(curH - lastC), Math.abs(curL - lastC));
        recentAtrs.push(tr);
      }
    }
    const atrExpanding = recentAtrs.length >= 3 && recentAtrs[recentAtrs.length - 1] > recentAtrs[recentAtrs.length - 2];
    const atrExploding = atr > atrPeriod && recentAtrs[recentAtrs.length - 1] > 1.8 * (recentAtrs.reduce((a, b) => a + b, 0) / recentAtrs.length);
    const volatilityCompressed = rangePercent < 0.8;

    // Volatility Filter - chaotic chop detector
    // If the average ratio of wicks vs body sizes over the last 12 candles is excessively high (spiky candles with zero body, no direction)
    let totalWicks = 0;
    let totalBodies = 0;
    const chopLookback = Math.min(12, len);
    for (let i = len - chopLookback; i < len; i++) {
      const h = parseFloat(klines[i][2]);
      const l = parseFloat(klines[i][3]);
      const o = parseFloat(klines[i][1]);
      const c = parseFloat(klines[i][4]);
      totalWicks += (h - l);
      totalBodies += Math.abs(c - o);
    }
    const averageWickToBodyRatio = totalBodies > 0 ? totalWicks / totalBodies : 5.0;
    const isVolatilityTooChaotic = rangePercent < 1.2 && averageWickToBodyRatio > 3.0;

    // Fake Breakouts Count 
    let fakeBreakoutsCount = 0;
    for (let i = len - lookback; i < len - 1; i++) {
      const candleH = parseFloat(klines[i][2]);
      const candleL = parseFloat(klines[i][3]);
      const candleC = parseFloat(klines[i][4]);

      if (candleH > highestHigh * 0.998 && candleC < highestHigh) {
        fakeBreakoutsCount++;
      }
      if (candleL < lowestLow * 1.002 && candleC > lowestLow) {
        fakeBreakoutsCount++;
      }
    }

    // Dynamic price expansion states
    const recentCandleBodySizes = klines.slice(-5).map(k => Math.abs(parseFloat(k[4]) - parseFloat(k[1])));
    const avgBodySize = recentCandleBodySizes.reduce((a, b) => a + b, 0) / 5;
    const currentBodySize = Math.abs(c0 - o0);
    const priceExpansion = currentBodySize > avgBodySize * 1.3;

    // Price states 
    const priceUp = c0 > c1 && c1 > parseFloat(klines[len - 3][4]);
    const priceDown = c0 < c1 && c1 < parseFloat(klines[len - 3][4]);
    const priceStable = Math.abs(c0 - c1) / c1 < 0.001;

    // --- VELOCITY CALCULATORS (INSTITUTIONAL CORE) ---
    // 1. Price Momentum Velocity: rate of change over the last 3 candles (%)
    const priceVelocity = ((c0 - parseFloat(klines[Math.max(0, len - 4)][4])) / parseFloat(klines[Math.max(0, len - 4)][4])) * 100;
    
    // 2. Volume Velocity: Surge rate in recent buy pressure
    const volumeVelocity = rvol;

    // 3. CVD (Taker Buy/Sell) Velocity: Rate of aggressive buyer dominance changes
    // Relative change from average takerbuy ratio
    const cvdVelocity = takerRatio; 

    // Open Interest Trend Simulation/Verification (derivative analytics)
    let oiUp = false;
    let oiDown = false;
    let oiSlowlyIncreasing = false;
    let oiIncreasingFast = false;
    let oiFlat = true;
    let oiVelocity = 1.0;

    if (oiHistory && oiHistory.length >= 3) {
      const lastOi = oiHistory[oiHistory.length - 1];
      const prevOi = oiHistory[oiHistory.length - 2];
      const olderOi = oiHistory[oiHistory.length - 3];

      oiUp = lastOi > prevOi && prevOi > olderOi;
      oiDown = lastOi < prevOi && prevOi < olderOi;
      oiSlowlyIncreasing = lastOi > prevOi && (lastOi - prevOi) / prevOi < 0.01;
      oiIncreasingFast = lastOi > prevOi * 1.015;
      oiFlat = Math.abs(lastOi - prevOi) / prevOi < 0.002;
      oiVelocity = prevOi > 0 ? lastOi / prevOi : 1.0;
    } else {
      // Simulate/approximate Open Interest movement based on Volume/Taker activity 
      if (rvol > 1.2) {
        oiUp = true;
        oiSlowlyIncreasing = true;
        if (rvol > 2.5) {
          oiIncreasingFast = true;
        }
        oiFlat = false;
        oiVelocity = 1.0 + (rvol - 1.0) * 0.01;
      }
    }

    // CVD signals from Taker ratios
    const cvdPositive = takerRatio > 1.02;
    const cvdNegative = takerRatio < 0.98;
    const cvdWeak = takerRatio >= 0.97 && takerRatio <= 1.03;
    const cvdStrong = takerRatio > 1.12;

    // CVD shift / flips 
    const cvdFlippingPositive = takerRatio > 1.05;
    const cvdFlippingNegative = takerRatio < 0.95;

    // Liquidations estimation 
    let shortLiquidations = false;
    let longLiquidations = false;
    let shortLiquidationsIncreasing = false;
    let longLiquidationsIncreasing = false;
    let liquidationSpike = false;

    if (oiHistory && oiHistory.length >= 2) {
      const oiChange = (oiHistory[oiHistory.length - 1] - oiHistory[oiHistory.length - 2]) / oiHistory[oiHistory.length - 2];
      const priceChange = (c0 - c1) / c1;

      if (oiChange < -0.015 && priceChange > 0.005) {
        shortLiquidations = true;
        shortLiquidationsIncreasing = true;
        liquidationSpike = Math.abs(oiChange) > 0.04;
      }
      if (oiChange < -0.015 && priceChange < -0.005) {
        longLiquidations = true;
        longLiquidationsIncreasing = true;
        liquidationSpike = Math.abs(oiChange) > 0.04;
      }
    } else {
      // Approximate signals from volume spike
      if (rvol > 2.5) {
        if (c0 > o0 * 1.012) {
          shortLiquidations = true;
          shortLiquidationsIncreasing = true;
          liquidationSpike = true;
        } else if (c0 < o0 * 0.988) {
          longLiquidations = true;
          longLiquidationsIncreasing = true;
          liquidationSpike = true;
        }
      }
    }

    // Extremes in funding rates
    const fundingExtremeNegative = fundingRate < -0.03;
    const fundingExtremePositive = fundingRate > 0.03;

    // Breakouts
    const breakoutUp = c0 > highestHigh && c1 > highestHigh * 0.995;
    const breakoutDown = c0 < lowestLow && c1 < lowestLow * 1.005;

    // Volume weak 
    const volumeWeak = rvol < 1.0;

    // Holding confirmations
    const priceHoldingAboveBreakout = c0 > highestHigh;
    const priceHoldingBelowBreakout = c0 < lowestLow;

    // Bid pressure & Ask pressure
    const bidPressure = takerRatio > 1.08;
    const askPressure = takerRatio < 0.92;

    // Distance checks to limits
    const nearMajorResistance = (highestHigh - c0) / c0 < 0.003;
    const nearMajorSupport = (c0 - lowestLow) / c0 < 0.003;
    
    const nearResistance = (highestHigh - c0) / c0 < 0.008;
    const nearSupport = (c0 - lowestLow) / c0 < 0.008;

    // Buying & selling weakening
    const sellingWeakening = v0 < avgVol && c0 > o0 && takerRatio > 1.0;
    const buyingWeakening = v0 < avgVol && c0 < o0 && takerRatio < 1.0;

    // Candles layout (Candlestick Pattern Engine)
    const totalCandleRange = h0 - l0;
    const bodyRange = Math.abs(c0 - o0);
    const upperWick = h0 - Math.max(c0, o0);
    const lowerWick = Math.min(c0, o0) - l0;

    const lastCandleClosedStrong = totalCandleRange > 0 && (c0 - l0) / totalCandleRange > 0.7;
    const lastCandleClosedWeak = totalCandleRange > 0 && (h0 - c0) / totalCandleRange > 0.7;

    const rejectionWick = totalCandleRange > 0 && upperWick > bodyRange * 1.5;
    const lowerRejection = totalCandleRange > 0 && lowerWick > bodyRange * 1.5;

    const priceHolding = c0 > o0 && c0 > c1;
    const priceHoldingBelow = c0 < o0 && c0 < c1;

    // --- MULTI-TIMEFRAME CONTEXT bias ---
    // Extract macro structure over the last 30 candles (equivalent of 15m/1h trend)
    let sumClose25 = 0;
    let sumClose8 = 0;
    const countMacro = Math.min(25, len);
    const countMicro = Math.min(8, len);
    for (let j = len - countMacro; j < len; j++) {
      sumClose25 += parseFloat(klines[j][4]);
    }
    for (let j = len - countMicro; j < len; j++) {
      sumClose8 += parseFloat(klines[j][4]);
    }
    const macroAvg = sumClose25 / countMacro;
    const microAvg = sumClose8 / countMicro;
    const higherTimeframeBias = microAvg > macroAvg * 1.002 
      ? 'BULLISH' 
      : (microAvg < macroAvg * 0.998 ? 'BEARISH' : 'SIDEWAYS');


    // --- SIMULATED ORDER BOOK LIQUIDITY MAP & CONTEXT ---
    // Hunt historical pivot levels with exceptional volume clusters as Liquidity pools
    let liquidityAbove = highestHigh * 1.005;
    let liquidityBelow = lowestLow * 0.995;
    
    // Search past 30 bars for the highest volume key pivots
    let topPivotVol = 0;
    let bottomPivotVol = 0;
    const searchLen = Math.min(30, len);
    for (let i = len - searchLen; i < len - 1; i++) {
      const highVal = parseFloat(klines[i][2]);
      const lowVal = parseFloat(klines[i][3]);
      const volVal = parseFloat(klines[i][5]);
      
      // Is swing high?
      if (highVal > parseFloat(klines[Math.max(0, i - 1)][2]) && highVal > parseFloat(klines[Math.min(len - 1, i + 1)][2])) {
        if (volVal > topPivotVol) {
          topPivotVol = volVal;
          liquidityAbove = highVal;
        }
      }
      // Is swing low?
      if (lowVal < parseFloat(klines[Math.max(0, i - 1)][3]) && lowVal < parseFloat(klines[Math.min(len - 1, i + 1)][3])) {
        if (volVal > bottomPivotVol) {
          bottomPivotVol = volVal;
          liquidityBelow = lowVal;
        }
      }
    }

    const distanceToLiquidityAbove = ((liquidityAbove - c0) / c0) * 100;
    const distanceToLiquidityBelow = ((c0 - liquidityBelow) / c0) * 100;

    // --- DELTA & ORDERFLOW ABSORPTION CHANNEL SYSTEM (Gap 4) ---
    // Bid Absorption: heavy market sells BUT delta negative AND price not dropping
    const bidAbsorption = rvol > 1.4 && takerRatio < 0.94 && (c0 >= c1 || lowerRejection || (c0 - l0)/(h0 - l0) > 0.4);
    // Ask Absorption: heavy market buys BUT delta positive AND price not jumping
    const askAbsorption = rvol > 1.4 && takerRatio > 1.06 && (c0 <= c1 || rejectionWick || (h0 - c0)/(h0 - l0) > 0.4);

    const footprintImbalance = takerRatio; // simplified footprint flow representation

    // --- GAP 1: ADVANCED LIQUIDITY ANALYSIS & ADAPTIVE MAPPING ---
    // Rank structure volume clusters as Liquidity pools strength (1-5 range)
    const liquidityStrengthAbove = Math.min(5, Math.max(1, Math.round(topPivotVol / (avgVol || 1))));
    const liquidityStrengthBelow = Math.min(5, Math.max(1, Math.round(bottomPivotVol / (avgVol || 1))));

    // Track price interactions: is it a magnet or absorption?
    let liquidityTypeAbove: 'MAGNET' | 'ABSORPTION' | 'STANDARD' = 'STANDARD';
    let liquidityTypeBelow: 'MAGNET' | 'ABSORPTION' | 'STANDARD' = 'STANDARD';

    // Above
    if (distanceToLiquidityAbove < 0.35 && askAbsorption) {
      liquidityTypeAbove = 'ABSORPTION';
    } else if (distanceToLiquidityAbove < 0.45 && priceVelocity > 1.2 && takerRatio > 1.05) {
      liquidityTypeAbove = 'MAGNET';
    }

    // Below
    if (distanceToLiquidityBelow < 0.35 && bidAbsorption) {
      liquidityTypeBelow = 'ABSORPTION';
    } else if (distanceToLiquidityBelow < 0.45 && priceVelocity < -1.2 && takerRatio < 0.95) {
      liquidityTypeBelow = 'MAGNET';
    }

    // Estimate consumption rate (based on depth of penetration and delta intensity)
    let liquidityConsumedRateAbove = 0;
    if (c0 >= liquidityAbove * 0.998) {
      liquidityConsumedRateAbove = Math.min(98, Math.round(50 + (takerRatio - 1.0) * 120));
    } else if (distanceToLiquidityAbove < 0.5) {
      liquidityConsumedRateAbove = Math.min(75, Math.round(30 + (rvol > 1.5 ? 25 : 10)));
    }

    let liquidityConsumedRateBelow = 0;
    if (c0 <= liquidityBelow * 1.002) {
      liquidityConsumedRateBelow = Math.min(98, Math.round(50 + (1.0 - takerRatio) * 120));
    } else if (distanceToLiquidityBelow < 0.5) {
      liquidityConsumedRateBelow = Math.min(75, Math.round(30 + (rvol > 1.5 ? 25 : 10)));
    }

    // --- GAP 3: LIQUIDATION MAP ESTIMATIONS ---
    // High-leverage cluster liquidation pools
    const estimatedLongLiquidationZone = liquidityBelow * 0.992; // 0.8% below bottom liquidity level
    const estimatedShortLiquidationZone = liquidityAbove * 1.008; // 0.8% above top liquidity level

    // --- GAP 2: MULTI-LAYERED HIGHER TIMEFRAME CONTEXT ---
    // 1. Imbalance logic (Fair Value Gaps - FVG)
    let htfImbalance = false;
    for (let i = len - 15; i < len - 2; i++) {
      const h_prev = parseFloat(klines[i][2]);
      const l_next = parseFloat(klines[i+2][3]);
      if (l_next > h_prev) { // Bullish Imbalance FVG
        htfImbalance = true;
        break;
      }
      const l_prev = parseFloat(klines[i][3]);
      const h_next = parseFloat(klines[i+2][2]);
      if (h_next < l_prev) { // Bearish Imbalance FVG
        htfImbalance = true;
        break;
      }
    }

    // 2. High timeframe compression
    const htfCompression = rangePercent < 1.0 && adx < 18;

    // 3. Trapped Traders Detection (HTF context)
    let htfTrappedTraders: 'SHORTS_TRAPPED' | 'LONGS_TRAPPED' | 'NONE' = 'NONE';
    if (nearResistance && fundingRate > 0.015 && askAbsorption) {
      htfTrappedTraders = 'LONGS_TRAPPED';
    } else if (nearSupport && fundingRate < -0.015 && bidAbsorption) {
      htfTrappedTraders = 'SHORTS_TRAPPED';
    }

    return {
      ATR: atrPercentage,
      ADX: adx,
      rangePercent,
      fakeBreakoutsCount,
      priceExpansion,
      atrExpanding,
      atrExploding,
      liquidationSpike,

      priceUp,
      priceDown,
      priceStable,
      oiUp,
      oiDown,
      oiSlowlyIncreasing,
      cvdPositive,
      cvdNegative,
      cvdWeak,
      cvdStrong,
      cvdFlippingPositive,
      cvdFlippingNegative,
      rvol,
      fundingExtremeNegative,
      fundingExtremePositive,
      shortLiquidations,
      longLiquidations,
      volatilityCompressed,

      breakoutUp,
      breakoutDown,
      volumeWeak,
      priceHoldingAboveBreakout,
      priceHoldingBelowBreakout,
      bidPressure,
      askPressure,
      nearMajorResistance,
      nearMajorSupport,
      nearSupport,
      nearResistance,
      sellingWeakening,
      buyingWeakening,
      shortLiquidationsIncreasing,
      longLiquidationsIncreasing,

      lastCandleClosedStrong,
      lastCandleClosedWeak,
      rejectionWick,
      lowerRejection,
      priceHolding,
      priceHoldingBelow,

      // --- ELEMENTS ---
      priceVelocity,
      volumeVelocity,
      cvdVelocity,
      oiVelocity,
      higherTimeframeBias,
      liquidityAbove,
      liquidityBelow,
      distanceToLiquidityAbove,
      distanceToLiquidityBelow,
      isVolatilityTooChaotic,
      bidAbsorption,
      askAbsorption,
      footprintImbalance,

      // --- NEW ELEMENTS ---
      liquidityTypeAbove,
      liquidityTypeBelow,
      liquidityStrengthAbove,
      liquidityStrengthBelow,
      liquidityConsumedRateAbove,
      liquidityConsumedRateBelow,
      estimatedLongLiquidationZone,
      estimatedShortLiquidationZone,
      htfImbalance,
      htfCompression,
      htfTrappedTraders
    };
  }
}
