import { TradeType, BotSettings, MarketMetrics } from '../../types/trading.js';
import { CreativeEntryEngine } from './CreativeEntryEngine.js';
import { QuantumEngine } from './QuantumEngine.js';
import { FusionEngine } from './FusionEngine.js';

export interface SteelEngineDecision {
  shouldEnter: boolean;
  type: TradeType;
  reason: string;
  takeProfitPerc: number;
  stopLossPerc: number;
  confidence: number;
  longProb: number;
  shortProb: number;
  marketNarrative: string;
}

export class SteelEngine {
  private creativeEngine = new CreativeEntryEngine();
  private quantumEngine = new QuantumEngine();

  public analyze(
    klines: any[],
    takerRatio: number,
    settings: BotSettings,
    fundingRate: number = 0,
    oiHistory: number[] = [],
    volHistory: number[] = []
  ): SteelEngineDecision {
    if (klines.length < 30) {
      return {
        shouldEnter: false,
        type: 'LONG',
        reason: 'بيانات غير كافية',
        takeProfitPerc: 0,
        stopLossPerc: 0,
        confidence: 0,
        longProb: 0,
        shortProb: 0,
        marketNarrative: 'بيانات الفترات التاريخية (Klines) غير كافية لثبات الاستنتاج الرقمي للمحرك الفولاذي.'
      };
    }

    // 1. Analyze using sub-engines
    const creativeDecision = this.creativeEngine.analyze(klines, takerRatio, settings, fundingRate, oiHistory, volHistory);
    const quantumDecision = this.quantumEngine.analyze(klines, takerRatio, settings);
    
    const currentPrice = parseFloat(klines[klines.length - 1][4]);
    const previousPrice = parseFloat(klines[klines.length - 2][4]);
    
    // Calculate raw RVOL
    let volSum = 0;
    const volLookback = Math.min(10, klines.length - 1);
    for (let i = klines.length - volLookback - 1; i < klines.length - 1; i++) {
      volSum += parseFloat(klines[i][5]);
    }
    const avgVol = volSum / volLookback;
    const rvol = avgVol > 0 ? parseFloat(klines[klines.length - 1][5]) / avgVol : 1.0;

    // Calculate ATR percentage
    let trs: number[] = [];
    for (let i = 1; i < klines.length; i++) {
      const curH = parseFloat(klines[i][2]);
      const curL = parseFloat(klines[i][3]);
      const lastC = parseFloat(klines[i - 1][4]);
      const tr = Math.max(curH - curL, Math.abs(curH - lastC), Math.abs(curL - lastC));
      trs.push(tr);
    }
    const atrPeriod = Math.min(14, trs.length);
    const atr = trs.slice(-atrPeriod).reduce((acc, val) => acc + val, 0) / atrPeriod;
    const atrPerc = (atr / currentPrice) * 100;

    const metrics: MarketMetrics = {
      symbol: "SYMBOL",
      price: currentPrice,
      adx: creativeDecision.mode === 'TREND' ? 25 : 15,
      atr,
      atrPerc,
      rsi: 50,
      volume: parseFloat(klines[klines.length - 1][5]),
      rvol,
      spread: 0.0001,
      fundingRate,
      openInterest: oiHistory.length > 0 ? oiHistory[oiHistory.length - 1] : undefined,
      oiChange: oiHistory.length >= 2 ? ((oiHistory[oiHistory.length - 1] - oiHistory[oiHistory.length - 2]) / oiHistory[oiHistory.length - 2]) * 100 : 0,
      takerRatio,
      isChop: creativeDecision.mode === 'CHAOTIC_DEATH_CHOP'
    };

    const fusionResult = FusionEngine.calculateFusionScore(metrics, { ...settings, useFusionEngine: true });
    const fusionScore = fusionResult.score;

    // --- MATHEMATICAL AND NUMERICAL PROBABILISTIC COGNITION ENGINE ---
    // Start with 50-50 neutral state
    let longProb = 50;
    let shortProb = 50;

    // Influences of sub-engines (Weights sum to 1.0 by default)
    const wCreative = settings.steelInfluenceCreative ?? 0.35;
    const wQuantum = settings.steelInfluenceQuantum ?? 0.35;
    const wFusion = settings.steelInfluenceFusion ?? 0.30;

    // Sub-engine 1: Creative Engine (Structure & Wick Rejection)
    if (creativeDecision.shouldEnter) {
      const creativeWeight = creativeDecision.confidence * wCreative;
      if (creativeDecision.type === 'LONG') {
        longProb += creativeWeight;
        shortProb -= creativeWeight * 0.5;
      } else {
        shortProb += creativeWeight;
        longProb -= creativeWeight * 0.5;
      }
    }

    // Sub-engine 2: Quantum Engine (Bollinger Reversion & Momentum Volatility)
    if (quantumDecision.shouldEnter) {
      const quantumWeight = 75 * wQuantum;
      if (quantumDecision.type === 'LONG') {
        longProb += quantumWeight;
        shortProb -= quantumWeight * 0.5;
      } else {
        shortProb += quantumWeight;
        longProb -= quantumWeight * 0.5;
      }
    }

    // Sub-engine 3: Fusion Engine Magnitudes (OI, Taker, Funding Gravity)
    const takerWeightFactor = settings.steelTakerWeight ?? 1.5;
    const oiWeightFactor = settings.steelOiWeight ?? 1.2;
    const fundingWeightFactor = settings.steelFundingWeight ?? 1.0;
    const liquidityWeightFactor = settings.steelLiquidityWeight ?? 1.3;
    const htfWeightFactor = settings.steelHtfTrendWeight ?? 1.4;

    // A. Taker Accumulation Imbalance (Institutional volume)
    const takerDiff = takerRatio - 1.0;
    if (takerDiff > 0.02) {
      const weight = Math.min(25, takerDiff * 100 * takerWeightFactor * wFusion);
      longProb += weight;
      shortProb -= weight * 0.5;
    } else if (takerDiff < -0.02) {
      const weight = Math.min(25, Math.abs(takerDiff) * 100 * takerWeightFactor * wFusion);
      shortProb += weight;
      longProb -= weight * 0.5;
    }

    // B. Open Interest Trend Alignment
    const priceChange = (currentPrice - previousPrice) / previousPrice;
    const oiChangePct = metrics.oiChange ?? 0;
    if (oiChangePct > 0.5) {
      if (priceChange > 0.001) {
        const weight = Math.min(15, oiChangePct * 10 * oiWeightFactor * wFusion);
        longProb += weight;
        shortProb -= weight * 0.5;
      } else if (priceChange < -0.001) {
        const weight = Math.min(15, oiChangePct * 10 * oiWeightFactor * wFusion);
        shortProb += weight;
        longProb -= weight * 0.5;
      }
    } else if (oiChangePct < -1.0) {
      if (priceChange > 0.002) {
        longProb += 8 * oiWeightFactor;
      } else if (priceChange < -0.002) {
        shortProb += 8 * oiWeightFactor;
      }
    }

    // C. Funding Rate Gravity (Short squeeze filter)
    if (fundingRate < -0.015) {
      const weight = Math.min(20, Math.abs(fundingRate) * 400 * fundingWeightFactor * wFusion);
      longProb += weight;
      shortProb -= weight * 0.8;
    } else if (fundingRate > 0.015) {
      const weight = Math.min(20, fundingRate * 400 * fundingWeightFactor * wFusion);
      shortProb += weight;
      longProb -= weight * 0.8;
    }

    // D. Distance to Liquidity Magnet
    const distAbove = (creativeDecision as any).distanceToLiquidityAbove ?? 5.0;
    const distBelow = (creativeDecision as any).distanceToLiquidityBelow ?? 5.0;
    if (distAbove < 1.2) {
      const weight = (1.5 - distAbove) * 12 * liquidityWeightFactor * wFusion;
      longProb += weight;
    }
    if (distBelow < 1.2) {
      const weight = (1.5 - distBelow) * 12 * liquidityWeightFactor * wFusion;
      shortProb += weight;
    }

    // E. HTF Trend Support
    const htfBias = (creativeDecision as any).higherTimeframeBias ?? 'SIDEWAYS';
    if (htfBias === 'BULLISH') {
      longProb += 12 * htfWeightFactor;
      shortProb -= 6 * htfWeightFactor;
    } else if (htfBias === 'BEARISH') {
      shortProb += 12 * htfWeightFactor;
      longProb -= 6 * htfWeightFactor;
    }

    // Apply general fusion magnitude multiplier
    const scaleFactor = 1.0 + (fusionScore - 50) / 200;
    longProb *= scaleFactor;
    shortProb *= scaleFactor;

    // Bound output probabilities mathematically
    longProb = Math.max(0, Math.min(99, longProb));
    shortProb = Math.max(0, Math.min(99, shortProb));

    // Resolve direction
    const bestProb = Math.max(longProb, shortProb);
    const finalType: TradeType = longProb >= shortProb ? 'LONG' : 'SHORT';
    
    // Threshold gate check
    const minThreshold = settings.steelMinProbability ?? 65;
    const shouldEnter = bestProb >= minThreshold;

    // Target allocation
    let finalTp = 1.5;
    let finalSl = 1.0;

    if (creativeDecision.shouldEnter) {
      finalTp = creativeDecision.takeProfitPerc;
      finalSl = creativeDecision.stopLossPerc;
    } else if (quantumDecision.shouldEnter) {
      finalTp = quantumDecision.takeProfitPerc;
      finalSl = quantumDecision.stopLossPerc;
    } else {
      finalSl = Math.max(0.3, atr * 1.5);
      finalTp = finalSl * 2.0;
    }

    if (settings.steelAdaptiveSlTp) {
      const probScaler = bestProb / 65;
      finalTp *= Math.min(1.5, Math.max(0.9, probScaler));
      finalSl *= Math.min(1.1, Math.max(0.7, 1.0 / probScaler));
    }

    finalSl = Math.min(6.0, Math.max(0.12, finalSl));
    finalTp = Math.min(18.0, Math.max(0.25, finalTp));

    let conflictsResolved = "الانسجام التام للمحرك الثلاثي";
    let isConflict = false;

    if (creativeDecision.shouldEnter && quantumDecision.shouldEnter && creativeDecision.type !== quantumDecision.type) {
      isConflict = true;
      conflictsResolved = `تم تفكيك التعارض بنجاح: المحرك الإبداعي يفضل ${creativeDecision.type} بينما المحرك الكمي يفضل ${quantumDecision.type}. حسم المحرك الفولاذي الاتجاه لـ ${finalType} باحتمالية قدرها ${bestProb.toFixed(0)}% بناء على الضغط المؤسساتي والمؤشرات الرقمية العميقة.`;
    } else if (creativeDecision.shouldEnter && !quantumDecision.shouldEnter) {
      conflictsResolved = `المحرك الإبداعي نشط لـ ${creativeDecision.type}. المحرك الكمي محايد. عزز المحرك الفولاذي الدقة لتبلغ الاحتمالية ${bestProb.toFixed(0)}%.`;
    } else if (!creativeDecision.shouldEnter && quantumDecision.shouldEnter) {
      conflictsResolved = `المحرك الكمي نشط لـ ${quantumDecision.type}. المحرك الإبداعي محايد. عيار الدقة الفولاذية بلغت الاحتمالية ${bestProb.toFixed(0)}%.`;
    } else if (creativeDecision.shouldEnter && quantumDecision.shouldEnter && creativeDecision.type === quantumDecision.type) {
      conflictsResolved = `اتحاد تام للمحركات لصفقة ${finalType} بثقة فولاذية خارقة بلغت احتمالية نجاحها ${bestProb.toFixed(0)}%.`;
    } else {
      if (shouldEnter) {
        conflictsResolved = `اقتناص فرصة مؤسساتية خالصة لصفقة ${finalType} باحتمالية ${bestProb.toFixed(0)}% بناء على التوافق الكمي لتدفق السيولة وتحركات الحيتان برغم هدوء المحركات الأساسية.`;
      } else {
        conflictsResolved = `المؤشرات الرقمية لم تصل بعد للحد الأدنى من الدقة (${minThreshold}%). أعلى احتمال مرصود هو ${finalType} بنسبة ${bestProb.toFixed(0)}%.`;
      }
    }

    const marketNarrative = `[المحرك الفولاذي - Steel Engine] 🛡️
${conflictsResolved}
• احتمالية الشراء (LONG): ${longProb.toFixed(1)}% | احتمالية البيع (SHORT): ${shortProb.toFixed(1)}%
• مقياس السيولة الموحد (Fusion Volume Score): ${fusionScore.toFixed(0)}%
• ضغط تدفق الحيتان (Taker Impact Ratio): ${takerRatio.toFixed(2)} [${takerRatio > 1.0 ? 'دعم شرائي' : 'ضغط بيعي'}]
• معدل الفائدة المفتوحة وسرعة العقود: ${oiChangePct.toFixed(2)}% [${oiChangePct > 0 ? 'بناء مراكز مغلقة' : 'تصفية وتراجع'}]
• اتجاه الفاصل الكروي الأكبر (HTF structural Trend): ${htfBias === 'BULLISH' ? 'اتجاه صاعد جوهري' : htfBias === 'BEARISH' ? 'اتجاه هابط عنيف' : 'نطاق عرضي متوازن'}
السرد السوقي: ${creativeDecision.marketNarrative}`;

    return {
      shouldEnter,
      type: finalType,
      reason: isConflict ? "STEEL_CONFLICT_RESOLVED" : "STEEL_ABS_SUPER_CONFL",
      takeProfitPerc: finalTp,
      stopLossPerc: finalSl,
      confidence: bestProb,
      longProb,
      shortProb,
      marketNarrative
    };
  }

  public analyzeExit(
    trade: any,
    currentPrice: number,
    takerRatio: number,
    settings: BotSettings,
    fundingRate: number = 0,
    klines: any[] = [],
    oiHistory: number[] = [],
    volHistory: number[] = []
  ): {
    decision: 'CONTINUE' | 'HOLD_FOR_MOON' | 'TRAIL_TIGHT' | 'EXIT_NOW' | 'PARTIAL_PROFIT';
    reason: string;
    exitIndicator: string;
    currentState: string;
    longProb: number;
    shortProb: number;
    confidence: number;
    marketNarrative: string;
  } {
    if (!klines || klines.length < 15) {
      return {
        decision: 'CONTINUE',
        reason: 'STEEL_INSUFFICIENT_DATA',
        exitIndicator: 'المحرك بانتظار اكتمال تهيئة klines التاريخية.',
        currentState: '✓ حيازة طبيعية وتوازن الاتجاه (انتظار البيانات)',
        longProb: 50,
        shortProb: 50,
        confidence: 50,
        marketNarrative: 'المحرك الفولاذي بانتظار اكتمال تجميع البيانات التاريخية للبث المباشر.'
      };
    }

    // 1. Live Analysis using the EXACT same sub-engines merged together
    const creativeDecision = this.creativeEngine.analyze(klines, takerRatio, settings, fundingRate, oiHistory, volHistory);
    const quantumDecision = this.quantumEngine.analyze(klines, takerRatio, settings);
    
    // Calculate raw RVOL exactly as done for Entry
    let volSum = 0;
    const volLookback = Math.min(10, klines.length - 1);
    for (let i = klines.length - volLookback - 1; i < klines.length - 1; i++) {
      volSum += parseFloat(klines[i][5]);
    }
    const avgVol = volSum / volLookback;
    const rvol = avgVol > 0 ? parseFloat(klines[klines.length - 1][5]) / avgVol : 1.0;

    // Calculate ATR percentage exactly as done for Entry
    let trs: number[] = [];
    for (let i = 1; i < klines.length; i++) {
      const curH = parseFloat(klines[i][2]);
      const curL = parseFloat(klines[i][3]);
      const lastC = parseFloat(klines[i - 1][4]);
      const tr = Math.max(curH - curL, Math.abs(curH - lastC), Math.abs(curL - lastC));
      trs.push(tr);
    }
    const atrPeriod = Math.min(14, trs.length);
    const atr = trs.slice(-atrPeriod).reduce((acc, val) => acc + val, 0) / atrPeriod;
    const atrPerc = (atr / currentPrice) * 100;

    const metrics: MarketMetrics = {
      symbol: trade.symbol || "SYMBOL",
      price: currentPrice,
      adx: creativeDecision.mode === 'TREND' ? 25 : 15,
      atr,
      atrPerc,
      rsi: 50, // default if not tracked specifically inside klines
      volume: parseFloat(klines[klines.length - 1][5]),
      rvol,
      spread: 0.0001,
      fundingRate,
      openInterest: oiHistory.length > 0 ? oiHistory[oiHistory.length - 1] : undefined,
      oiChange: oiHistory.length >= 2 ? ((oiHistory[oiHistory.length - 1] - oiHistory[oiHistory.length - 2]) / oiHistory[oiHistory.length - 2]) * 100 : 0,
      takerRatio,
      isChop: creativeDecision.mode === 'CHAOTIC_DEATH_CHOP'
    };

    const fusionResult = FusionEngine.calculateFusionScore(metrics, { ...settings, useFusionEngine: true });
    const fusionScore = fusionResult.score;

    // --- MATHEMATICAL AND NUMERICAL PROBABILISTIC COGNITION ENGINE ---
    // Start with 50-50 neutral state exactly as done for Entry
    let longProb = 50;
    let shortProb = 50;

    // Influences of sub-engines (Weights sum to 1.0 by default)
    const wCreative = settings.steelInfluenceCreative ?? 0.35;
    const wQuantum = settings.steelInfluenceQuantum ?? 0.35;
    const wFusion = settings.steelInfluenceFusion ?? 0.30;

    // Sub-engine 1: Creative Engine (Structure & Wick Rejection)
    if (creativeDecision.shouldEnter) {
      const creativeWeight = creativeDecision.confidence * wCreative;
      if (creativeDecision.type === 'LONG') {
        longProb += creativeWeight;
        shortProb -= creativeWeight * 0.5;
      } else {
        shortProb += creativeWeight;
        longProb -= creativeWeight * 0.5;
      }
    }

    // Sub-engine 2: Quantum Engine (Bollinger Reversion & Momentum Volatility)
    if (quantumDecision.shouldEnter) {
      const quantumWeight = 75 * wQuantum;
      if (quantumDecision.type === 'LONG') {
        longProb += quantumWeight;
        shortProb -= quantumWeight * 0.5;
      } else {
        shortProb += quantumWeight;
        longProb -= quantumWeight * 0.5;
      }
    }

    // Sub-engine 3: Fusion Engine Magnitudes (OI, Taker, Funding Gravity)
    const takerWeightFactor = settings.steelTakerWeight ?? 1.5;
    const oiWeightFactor = settings.steelOiWeight ?? 1.2;
    const fundingWeightFactor = settings.steelFundingWeight ?? 1.0;
    const liquidityWeightFactor = settings.steelLiquidityWeight ?? 1.3;
    const htfWeightFactor = settings.steelHtfTrendWeight ?? 1.4;

    // A. Taker Accumulation Imbalance
    const takerDiff = takerRatio - 1.0;
    if (takerDiff > 0.02) {
      const weight = Math.min(25, takerDiff * 100 * takerWeightFactor * wFusion);
      longProb += weight;
      shortProb -= weight * 0.5;
    } else if (takerDiff < -0.02) {
      const weight = Math.min(25, Math.abs(takerDiff) * 100 * takerWeightFactor * wFusion);
      shortProb += weight;
      longProb -= weight * 0.5;
    }

    // B. Open Interest Trend Alignment
    const previousPrice = klines.length >= 2 ? parseFloat(klines[klines.length - 2][4]) : currentPrice;
    const priceChange = (currentPrice - previousPrice) / previousPrice;
    const oiChangePct = metrics.oiChange ?? 0;
    if (oiChangePct > 0.5) {
      if (priceChange > 0.001) {
        const weight = Math.min(15, oiChangePct * 10 * oiWeightFactor * wFusion);
        longProb += weight;
        shortProb -= weight * 0.5;
      } else if (priceChange < -0.001) {
        const weight = Math.min(15, oiChangePct * 10 * oiWeightFactor * wFusion);
        shortProb += weight;
        longProb -= weight * 0.5;
      }
    } else if (oiChangePct < -1.0) {
      if (priceChange > 0.002) {
        longProb += 8 * oiWeightFactor;
      } else if (priceChange < -0.002) {
        shortProb += 8 * oiWeightFactor;
      }
    }

    // C. Funding Rate Gravity
    if (fundingRate < -0.015) {
      const weight = Math.min(20, Math.abs(fundingRate) * 400 * fundingWeightFactor * wFusion);
      longProb += weight;
      shortProb -= weight * 0.8;
    } else if (fundingRate > 0.015) {
      const weight = Math.min(20, fundingRate * 400 * fundingWeightFactor * wFusion);
      shortProb += weight;
      longProb -= weight * 0.8;
    }

    // D. Distance to Liquidity Magnet
    const distAbove = (creativeDecision as any).distanceToLiquidityAbove ?? 5.0;
    const distBelow = (creativeDecision as any).distanceToLiquidityBelow ?? 5.0;
    if (distAbove < 1.2) {
      const weight = (1.5 - distAbove) * 12 * liquidityWeightFactor * wFusion;
      longProb += weight;
    }
    if (distBelow < 1.2) {
      const weight = (1.5 - distBelow) * 12 * liquidityWeightFactor * wFusion;
      shortProb += weight;
    }

    // E. HTF Trend Support
    const htfBias = (creativeDecision as any).higherTimeframeBias ?? 'SIDEWAYS';
    if (htfBias === 'BULLISH') {
      longProb += 12 * htfWeightFactor;
      shortProb -= 6 * htfWeightFactor;
    } else if (htfBias === 'BEARISH') {
      shortProb += 12 * htfWeightFactor;
      longProb -= 6 * htfWeightFactor;
    }

    // Apply general fusion magnitude multiplier exactly as done for Entry
    const scaleFactor = 1.0 + (fusionScore - 50) / 200;
    longProb *= scaleFactor;
    shortProb *= scaleFactor;

    // Bound output probabilities mathematically exactly as done for Entry
    longProb = Math.max(0, Math.min(99, longProb));
    shortProb = Math.max(0, Math.min(99, shortProb));

    const isLong = trade.type === 'LONG';
    const directionProb = isLong ? longProb : shortProb;
    const oppositeProb = isLong ? shortProb : longProb;
    const entryPrice = trade.entryPrice;
    const priceChangePerc = isLong
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;

    // --- CONSTRUCT DECISION BASED ON REAL-TIME MULTI-ENGINE PROBABILITY MATRIX ---
    let decision: 'CONTINUE' | 'HOLD_FOR_MOON' | 'TRAIL_TIGHT' | 'EXIT_NOW' | 'PARTIAL_PROFIT' = 'CONTINUE';
    let reason = '';
    let exitIndicator = '';
    let currentState = '';

    const dangerThreshold = -(settings.fastExitPerc ?? 0.5);

    // A. INSTANT EMERGENCY LIQUIDATION GATE -> Threat flipped / opposite trend dominate
    if (priceChangePerc < dangerThreshold || directionProb < 45 || oppositeProb > 68) {
      decision = 'EXIT_NOW';
      reason = 'STEEL_MATH_FLIP_SHIELD';
      currentState = '🚨 تسييل فوري وتصفية المراكز';
      exitIndicator = `انخفاض تماسك الاتجاه لـ ${directionProb.toFixed(0)}% وتصاعد المعارضة والضغط التناقضي لـ ${oppositeProb.toFixed(0)}% مع تغير حاد بالامتصاص المؤسساتي. تم تفعيل التسييل الفولاذي الموحد فوراً.`;
    }
    // B. PARTIAL PROFIT ZONE -> ROE is excellent, but momentum is showing exhaustion signs
    else if (priceChangePerc >= (settings.strictFastBreakevenPerc ?? 0.3) * 3 && (directionProb < 58 || oppositeProb > 52) && !trade.isPartialProfitTaken) {
      decision = 'PARTIAL_PROFIT';
      reason = 'STEEL_MATH_EXHAUSTION_WARNING';
      currentState = '💸 جني أرباح جزئي وتأمين الدخول';
      exitIndicator = `أرباح ممتازة (+${priceChangePerc.toFixed(2)}%) مصاحبة لضعف تدريجي من دمج المحرك الثلاثي لتهبط قوة التماسك لـ ${directionProb.toFixed(0)}%. إغلاق 50% وتأمين الدخول بالكامل.`;
    }
    // C. HOLD FOR THE MOON ZONE -> Momentum is backed by heavy buyDelta and rising OI
    else if (priceChangePerc >= 0.15 && directionProb >= 75 && (metrics.oiChange ?? 0) > 0.2) {
      decision = 'HOLD_FOR_MOON';
      reason = 'STEEL_MATH_PARABOLIC_MOON';
      currentState = '🚀 تمسك قمري مطلق (Hold For Moon)';
      exitIndicator = `انسجام صعودي فائق: قوة الاحتمالية مع الاتجاه الحالي تبلغ ${directionProb.toFixed(0)}%، ضغط السيولة ${takerRatio.toFixed(2)}، وتسارع تدفق عقود البناء المفتوحة بنسبة +${(metrics.oiChange ?? 0).toFixed(2)}%.`;
    }
    // D. ACTIVE TIGHT TRAILING STOP -> Mild hazard of divergence
    else if (directionProb < 54 || oppositeProb > 58 || creativeDecision.mode === 'CHAOTIC_DEATH_CHOP') {
      decision = 'TRAIL_TIGHT';
      reason = 'STEEL_MATH_DIVERGENCE_PROTECT';
      currentState = '⚠️ الحماية النشطة وتشديد الوقف';
      exitIndicator = `تباين وتباطؤ مؤشرات القوة المشتركة للمحركات لتتراوح بين القوة ${directionProb.toFixed(0)}% والمعارضة ${oppositeProb.toFixed(0)}%. تم تفعيل تشديد وقف الخسارة لتأمين الربحية.`;
    }
    // E. STABLE CONTINUE holding as usual
    else {
      decision = 'CONTINUE';
      reason = 'STEEL_MATH_STABLE_HOLD';
      currentState = '✓ حيازة طبيعية وتوازن الاتجاه';
      exitIndicator = `الاتجاه الحالي متسق كلياً بقوة تناسقية تبلغ ${directionProb.toFixed(0)}% من دمج محركات الذكاء (الهيكل الذكي، القنوات الكمية، ومستودعات السيولة والـ Delta).`;
    }

    const confidence = isLong ? longProb : shortProb;

    return {
      decision,
      reason,
      exitIndicator,
      currentState,
      longProb,
      shortProb,
      confidence,
      marketNarrative: `[القرارات الفولاذية بموجب دمج المحركات] السيولة متسقة بنسبة ${confidence.toFixed(1)}%. معدل الدلتا: ${takerRatio.toFixed(2)}. سرعة بناء العقود: ${(metrics.oiChange ?? 0).toFixed(2)}%`
    };
  }
}
