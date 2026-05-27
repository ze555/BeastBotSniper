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
      isChop: creativeDecision.mode === 'CHAOTIC_DEATH_CHOP',
      volCoefVar: creativeDecision.volCoefVar
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
      isChop: creativeDecision.mode === 'CHAOTIC_DEATH_CHOP',
      volCoefVar: creativeDecision.volCoefVar
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

    // --- SMART INSTITUTIONAL AND MARKET REAL VALUES EXIT ENGINE ---
    let decision: 'CONTINUE' | 'HOLD_FOR_MOON' | 'TRAIL_TIGHT' | 'EXIT_NOW' | 'PARTIAL_PROFIT' = 'CONTINUE';
    let reason = '';
    let exitIndicator = '';
    let currentState = '';

    // Calculate real fee-related values to prevent fee ruin
    const feeRate = settings.tradingFeeRate || 0.001;
    const roundTripFeePerc = 2 * feeRate * 100; // e.g., 0.20% for 0.001 fee rate
    const safeNetProfitThreshold = Math.max(0.35, roundTripFeePerc * 2.8); // Must cover fee multi-fold for non-emergency exits

    // Calculate candle geometry for detecting wicks (Stop Hunt / Liquidity Sweep)
    const lastKline = klines[klines.length - 1];
    const openPrice = parseFloat(lastKline[1]);
    const highPrice = parseFloat(lastKline[2]);
    const lowPrice = parseFloat(lastKline[3]);
    const closePrice = parseFloat(lastKline[4]);

    const bodyMax = Math.max(openPrice, closePrice);
    const bodyMin = Math.min(openPrice, closePrice);
    const upperWickPerc = ((highPrice - bodyMax) / closePrice) * 100;
    const lowerWickPerc = ((bodyMin - lowPrice) / closePrice) * 100;

    // Detect if market makers are trying to hunt stops (large wicks)
    const isLowerWickSweep = lowerWickPerc > Math.max(0.18, atrPerc * 0.45);
    const isUpperWickSweep = upperWickPerc > Math.max(0.18, atrPerc * 0.45);

    // Track peak profit to implement maximum efficiency trailing
    const t = trade as any;
    if (!t.peakProfitRecorded || priceChangePerc > (t.peakProfitRecorded || 0)) {
      t.peakProfitRecorded = Math.max(0, priceChangePerc);
    }
    const currentPeakProfit = t.peakProfitRecorded || 0;

    // A. EXTREME ORDER FLOW IMBALANCE (REAL INSTITUTIONAL VALUE - NO POINTS)
    const isOppositeOrderFlowSurge = isLong
      ? (takerRatio < 0.91 && rvol > 1.8) // High volume institutional selling
      : (takerRatio > 1.09 && rvol > 1.8); // High volume institutional buying

    const isHtfTrendOpposing = isLong
      ? (htfBias === 'BEARISH')
      : (htfBias === 'BULLISH');

    // === SPECIALIZED MAX LOSS / MIN PROFIT OVERRIDE GATE ===
    if (settings.steelMaxLossMode) {
      const sensitivity = settings.steelReboundSensitivity ?? 0.15;
      const minProfit = settings.steelMinProfitTake ?? 0.05;

      // 1. MINIMUM PROFIT TAKE -> Close as soon as we make a tiny positive profit
      if (priceChangePerc >= minProfit) {
        return {
          decision: 'EXIT_NOW',
          reason: 'STEEL_MAX_LOSS_MIN_PROFIT_HIT',
          exitIndicator: `[تعظيم الخسارة الفولاذي] تم تأمين جني أرباح منخفض جداً (+${priceChangePerc.toFixed(3)}%) لمنع الصعود وتحقيق الربحية وحظر تراكم الإيجابية بحسب إعداد النظام المعكوس للمستخدم.`,
          currentState: '💸 جني أرباح فوري مصغّر (تحت تصغير الربح)',
          longProb,
          shortProb,
          confidence: isLong ? longProb : shortProb,
          marketNarrative: `[نظام عكسي] إغلاق مبكر لمنع الربح: +${priceChangePerc.toFixed(3)}%. الحساسية: ${minProfit}%`
        };
      }

      // 2. REBOUND FROM PEAK DRAWDOWN DETECTION
      if (isLong) {
        if (currentPrice < entryPrice) {
          if (!t.lowestLossPrice || currentPrice < t.lowestLossPrice) {
            t.lowestLossPrice = currentPrice;
          }
          
          const reboundAmt = ((currentPrice - t.lowestLossPrice) / t.lowestLossPrice) * 100;
          if (reboundAmt >= sensitivity) {
            return {
              decision: 'EXIT_NOW',
              reason: 'STEEL_MAX_LOSS_REBOUND_EXIT',
              exitIndicator: `[تعظيم الخسارة الفولاذي] تم كشف ارتداد صاعد بنسبة +${reboundAmt.toFixed(2)}% من أدنى قاع تراجع للخسارة (${t.lowestLossPrice.toFixed(4)}). إغلاق التداول لتأمين وتجميد الخسارة الحالية بنسبة -${Math.abs(priceChangePerc).toFixed(2)}%.`,
              currentState: '🚨 تصفية فورا عند ارتداد قاع الخسارة',
              longProb,
              shortProb,
              confidence: isLong ? longProb : shortProb,
              marketNarrative: `[نظام عكسي] ارتداد من أدنى نقطة: +${reboundAmt.toFixed(2)}% >= ${sensitivity}%. تجميد التراجع السلبي عند ${priceChangePerc.toFixed(2)}%`
            };
          }
        }
      } else {
        if (currentPrice > entryPrice) {
          if (!t.highestLossPrice || currentPrice > t.highestLossPrice) {
            t.highestLossPrice = currentPrice;
          }

          const reboundAmt = ((t.highestLossPrice - currentPrice) / t.highestLossPrice) * 100;
          if (reboundAmt >= sensitivity) {
            return {
              decision: 'EXIT_NOW',
              reason: 'STEEL_MAX_LOSS_REBOUND_EXIT',
              exitIndicator: `[تعظيم الخسارة الفولاذي] تم كشف ارتداد هابط بنسبة +${reboundAmt.toFixed(2)}% من أعلى قمة تراجع للخسارة (${t.highestLossPrice.toFixed(4)}). إغلاق التداول لتأمين وتجميد الخسارة الحالية بنسبة -${Math.abs(priceChangePerc).toFixed(2)}%.`,
              currentState: '🚨 تصفية فورا عند ارتداد قاع الخسارة',
              longProb,
              shortProb,
              confidence: isLong ? longProb : shortProb,
              marketNarrative: `[نظام عكسي] ارتداد من أقصى تراجع: +${reboundAmt.toFixed(2)}% >= ${sensitivity}%. تجميد التراجع السلبي عند ${priceChangePerc.toFixed(2)}%`
            };
          }
        }
      }

      return {
        decision: 'CONTINUE',
        reason: 'STEEL_MAX_LOSS_ACCUMULATING',
        exitIndicator: `[تعظيم الخسارة الفولاذي] الصفقة في مركز الخسارة الفعالة حالياً (-${Math.abs(priceChangePerc).toFixed(2)}%). جاري ترك صفقة التداول لتعظيم الخسارة والوصول للحدود القصوى للتراجع قبل حدوث أي ارتداد للتصفية.`,
        currentState: '📉 تعظيم الخسائر الفولاذية ودفع التراجع',
        longProb,
        shortProb,
        confidence: isLong ? longProb : shortProb,
        marketNarrative: `[نظام عكسي] تتبع أقصى تراجع. القاع المسجل: ${isLong ? (t.lowestLossPrice ? t.lowestLossPrice.toFixed(4) : 'لم يسجل') : (t.highestLossPrice ? t.highestLossPrice.toFixed(4) : 'لم يسجل')}`
      };
    }

    // === CORE REAL-VALUE INSTITUTIONAL DECISION GATES ===

    // Gate 1: Anti Stop-Hunting Shield (Detecting wick sweep manipulation by Market Makers)
    const isBeingMarketMakerSwept = isLong ? isLowerWickSweep : isUpperWickSweep;

    if (isBeingMarketMakerSwept && priceChangePerc < 0) {
      decision = 'CONTINUE';
      reason = 'STEEL_INSTITUTIONAL_WICK_SHIELD';
      currentState = '🛡️ درع الرفض المؤسساتي (مكافحة تلاعب صناع السوق)';
      exitIndicator = `تم رصد عملية سحب سيولة (Stop-loss Hunt) بواسطة ذيل شمعة حاد بنسبة ${isLong ? lowerWickPerc.toFixed(2) : upperWickPerc.toFixed(2)}%. نرفض الخروج الذعر؛ الحيتان يجمعون السيولة والإنقاذ قادم.`;
    }
    // Gate 2: Severe Real-Value Divergence or Opposite Order Flow Surge (Emergency Rescue)
    else if (isOppositeOrderFlowSurge || (priceChangePerc < -(settings.fastExitPerc ?? 0.5) && isHtfTrendOpposing)) {
      decision = 'EXIT_NOW';
      reason = 'STEEL_ORDERFLOW_FORCE_EXIT';
      currentState = '🚨 إنقاذ فوري: تدفق السيولة المؤسساتي معاكس بالكامل';
      exitIndicator = `خروج حتمي فوري: تم رصد هبوط حاد في تدفق السيولة (Taker Ratio: ${takerRatio.toFixed(2)}) وتصاعد في معدل الفائدة المفتوحة العكسي مع حجم تداول مؤسساتي ضخم (RVOL: ${rvol.toFixed(1)}).`;
    }
    // Gate 3: Volatility-Adjusted Smart Trailing Stop (Real Value Profit-Lock)
    else if (priceChangePerc > safeNetProfitThreshold) {
      const dynamicTrailSensitivity = Math.max(0.15, Math.min(0.65, atrPerc * 0.45)); // adjust based on ATR
      const pullbackFromPeak = currentPeakProfit - priceChangePerc;

      if (pullbackFromPeak >= dynamicTrailSensitivity) {
        decision = 'EXIT_NOW';
        reason = 'STEEL_REAL_VALUE_TRAIL_HIT';
        currentState = '🏆 جني أرباح كامل: تراجع الوقف المتتالي الذكي للسيولة';
        exitIndicator = `جني أرباح كامل: السعر تراجع من القمة المحققة (+${currentPeakProfit.toFixed(2)}%) بقيمة ${pullbackFromPeak.toFixed(2)}% وهي أكبر من حساسية التقلب ATR الناتجة عن صناع السوق (${dynamicTrailSensitivity.toFixed(2)}%). تم تأمين صافي أرباح ممتاز بعد احتساب الرسوم.`;
      } else if (priceChangePerc >= safeNetProfitThreshold * 2.5 && !trade.isPartialProfitTaken) {
        // High-profit partial profit take
        decision = 'PARTIAL_PROFIT';
        reason = 'STEEL_REAL_VALUE_PARTIAL_HIT';
        currentState = '💸 جني أرباح جزئي وتأمين نقطة الدخول';
        exitIndicator = `جني أرباح جزئي بعد تأمين صافي ربح ممتاز قدره +${priceChangePerc.toFixed(2)}% (يتجاوز رسوم التداول ذهاباً وإياباً ${roundTripFeePerc.toFixed(2)}% بأكثر من 5 أضعاف). تم إغلاق النصف وتأمين المتبقي.`;
      } else if (directionProb >= 72 && oiChangePct > 0.4 && !isOppositeOrderFlowSurge) {
        // High confidence, high trend, backed by open interest and buy volumes
        decision = 'HOLD_FOR_MOON';
        reason = 'STEEL_INSTITUTIONAL_MOON_RIDE';
        currentState = '🚀 ركوب موجة السيولة (Hold For Moon)';
        exitIndicator = `تدفق السيولة المؤسساتي قوي كلياً: التماسك ${directionProb.toFixed(0)}%، الـ OI يصعد بقوة +${oiChangePct.toFixed(2)}%، والـ Taker يدعم بالكامل.`;
      } else {
        decision = 'CONTINUE';
        reason = 'STEEL_REAL_VALUE_PROFITABLE_HOLD';
        currentState = '📈 حيازة رابحة منتظمة';
        exitIndicator = `الصفقة مسجلة +${priceChangePerc.toFixed(2)}% أرباح صافية تتجاوز الرسوم. نواصل حصد الاتجاه مع حماية حركية ضد التقلبات الفورية.`;
      }
    }
    // Gate 4: Underperforming under low-liquidity chop / noise (Fee Avoidance)
    else if (Math.abs(priceChangePerc) < safeNetProfitThreshold && rvol < 0.75 && creativeDecision.mode === 'CHAOTIC_DEATH_CHOP') {
      // Market has zero momentum and standard deviation is dying
      decision = 'TRAIL_TIGHT';
      reason = 'STEEL_FEE_AVOIDANCE_TIGHT';
      currentState = '⚠️ تجميد الوقف للحد من رسوم العبث المالي';
      exitIndicator = `السوق في حالة ركود مطلق (RVOL: ${rvol.toFixed(2)}). لمنع الموت العرضي وضياع الرصيد في رسوم المعاملات المتكررة، تم تشديد الوقف لحماية رأس المال الحقيقي.`;
    }
    // Gate 5: General Stable holding
    else {
      decision = 'CONTINUE';
      reason = 'STEEL_STABLE_MARKET_HOLD';
      currentState = '✓ حيازة طبيعية وتوازن الاتجاه';
      exitIndicator = `الاتجاه متزن حركياً. لا مؤشرات تلاعب أو ضغط بيع مؤسساتي يهدد تماسك الصفقة. تداول آمن.`;
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
