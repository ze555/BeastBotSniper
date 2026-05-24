
import { TradePosition } from '../../types/trading.js';

export class RiskEngine {
  private config = {
    maxRiskPerTradePerc: 1, // 1%
    maxTotalExposurePerc: 5, // 5% total
    maxConsecutiveLosses: 3,
    minWinRateThreshold: 30 // Stop if performance drops too low
  };

  /**
   * هل يُسمح بفتح صفقة جديدة؟
   */
  public canTrade(activeTrades: any[], history: any[], isBeastMode?: boolean): { allowed: boolean; reason?: string } {
    // 1. Exposure Control
    if (activeTrades.length >= (isBeastMode ? 20 : 10)) {
      return { allowed: false, reason: 'MAX_CONCURRENT_TRADES_REACHED' };
    }

    // 2. Consecutive Loss Protection
    const limit = isBeastMode ? 15 : this.config.maxConsecutiveLosses;
    if (history.length >= limit) {
      const recent = history.slice(0, limit);
      const allLoss = recent.every(t => (t.pnl || 0) < 0);
      if (allLoss) {
        return { allowed: false, reason: 'CONSECUTIVE_LOSS_PROTECTION_ACTIVE' };
      }
    }

    return { allowed: true };
  }

  /**
   * حساب حجم الصفقة بناءً على الـ Stop Loss مع احترام الرافعة المالية وتقسيم رأس المال، مع إدخال مقاييس ذكية ديناميكية
   */
  public calculatePositionSize(
    portfolioSize: number, 
    entry: number, 
    sl: number, 
    leverage: number = 10, 
    maxConcurrentTrades: number = 10, 
    minAllocationPerc: number = 0,
    confidence?: number,
    volatility?: number, // RVOL / ATR
    regimeStability?: number, // Regime Win Rate / Stability coefficient (0 to 1)
    liquidityQuality?: number // Quality of Order book bid / ask depth index
  ): number {
    let sizeMultiplier = 1.0;

    // A. Confidence Scaling
    if (confidence !== undefined) {
      if (confidence >= 85) {
        sizeMultiplier *= 1.45; // زيادة الحجم عند تأكيد النمط القوي بـ 1.45x
      } else if (confidence < 68) {
        sizeMultiplier *= 0.72; // خفض حجم المخاطرة عند ضعف معينات الثقة بـ 0.72x
      }
    }

    // B. Volatility Penalization
    if (volatility !== undefined) {
      if (volatility > 2.2) {
        sizeMultiplier *= 0.82; // خفض التعرض مع التذبذب العالي لمنع الانزلاق السعري المفاجئ
      } else if (volatility < 1.0 && confidence && confidence > 78) {
        sizeMultiplier *= 1.15; // زيادة نسبية عند ضيق النطاق السعري لتسهيل قنص الحركة
      }
    }

    // C. Regime Stability Scaling
    if (regimeStability !== undefined) {
      sizeMultiplier *= (0.4 + regimeStability * 0.8); // محاذاة حجم المخاطرة مع مستوى نجاح التحليلات في البيئة الحالية
    }

    // D. Liquidity Quality Scaling
    if (liquidityQuality !== undefined) {
      if (liquidityQuality > 1.2) {
        sizeMultiplier *= 1.10; // تماسك دفتر الطلبات يسمح بأحجام أكبر
      } else if (liquidityQuality < 0.8) {
        sizeMultiplier *= 0.80; // ضعف دفتر الطلبات (Thin) يستوجب تقليص المراكز لمنع الخسائر غير المتوقعة
      }
    }

    // تطبيق معامل الخطر المعدل
    const adjustedRiskPerc = this.config.maxRiskPerTradePerc * sizeMultiplier;
    const riskAmount = portfolioSize * (adjustedRiskPerc / 100);
    const riskDistance = Math.abs(entry - sl);
    
    if (riskDistance === 0) return 0;

    // الحساب النظري بناءً على المخاطرة
    let positionSize = (riskAmount / riskDistance) * entry;
    
    // سقف القوة الشرائية المخصصة لكل صفقة (لتجنب استهلاك كامل الرصيد في صفقة واحدة)
    const allocatedPortfolio = portfolioSize / maxConcurrentTrades;
    const maxBuyingPowerPerTrade = allocatedPortfolio * leverage;
    
    // الحد الأدنى لحجم الصفقة المطلوب من العميل (مثلاً 20% من رأس المال)
    const minPositionSize = portfolioSize * (minAllocationPerc / 100);

    // نأخذ القيمة الأكبر بين حجم المخاطرة والحد الأدنى المطلوب
    if (positionSize < minPositionSize) {
      positionSize = minPositionSize;
    }

    // سقف القوة الشرائية المخصصة لكل صفقة (لتجنب استهلاك كامل الرصيد في صفقة واحدة)
    // نسمح للحد الأدنى المطلوب بتجاوز التقسيم التلقائي طالما أنه ضمن الحدود القصوى للرافعة
    let currentMaxCap = maxBuyingPowerPerTrade;
    if (minPositionSize > maxBuyingPowerPerTrade) {
      currentMaxCap = Math.max(maxBuyingPowerPerTrade, minPositionSize);
    }

    // الأمان النهائي: لا نتجاوز الرصيد الكلي * الرافعة المالية
    const absoluteLimit = portfolioSize * leverage;
    if (currentMaxCap > absoluteLimit) currentMaxCap = absoluteLimit;

    if (positionSize > currentMaxCap) {
      positionSize = currentMaxCap;
    }

    if (positionSize > 0) {
       console.log(`[RISK] Smart Size: Portfolio $${portfolioSize} | Risk-Based: $${((riskAmount / riskDistance) * entry).toFixed(2)} | Multiplier: ${sizeMultiplier.toFixed(2)}x | Final: $${positionSize.toFixed(2)}`);
    }

    return positionSize;
  }
}
