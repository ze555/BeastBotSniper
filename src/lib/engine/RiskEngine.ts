
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
  public canTrade(
    activeTrades: any[], 
    history: any[], 
    portfolioSize: number = 2000, 
    leverage: number = 10,
    isBeastMode?: boolean,
    bypassConsecutiveLoss?: boolean
  ): { allowed: boolean; reason?: string } {
    const limit = isBeastMode ? 20 : 10;
    
    // 1. Exposure Control
    if (activeTrades.length >= limit) {
      return { allowed: false, reason: `MAX_CONCURRENT_TRADES_REACHED: Currently ${activeTrades.length}/${limit} positions are active.` };
    }

    // 2. Exact Margin and Free Capital Calculation
    let totalUsedMargin = 0;
    for (const t of activeTrades) {
      const tradeLeverage = t.leverage || leverage || 10;
      const tradeAmount = t.amount || 0;
      totalUsedMargin += tradeAmount / tradeLeverage;
    }

    const freeMargin = portfolioSize - totalUsedMargin;
    // We need at least enough margin to open a minimal trade according to Binance guidelines (~$1.1 USD at 10x leverage)
    const minimalRequiredMargin = 12 / (leverage || 10); 

    if (freeMargin < minimalRequiredMargin) {
      return {
        allowed: false,
        reason: `INSUFFICIENT_PORTFOLIO_BALANCE: Total used capital/margin is $${totalUsedMargin.toFixed(2)} out of $${portfolioSize.toFixed(2)}. Free balance is only $${freeMargin.toFixed(2)} (Minimal required margin is $${minimalRequiredMargin.toFixed(2)}).`
      };
    }

    // 3. Consecutive Loss Protection
    if (!bypassConsecutiveLoss) {
      const consecLimit = isBeastMode ? 15 : this.config.maxConsecutiveLosses;
      if (history.length >= consecLimit) {
        const recent = history.slice(0, consecLimit);
        const allLoss = recent.every(t => (t.pnl || 0) < 0);
        if (allLoss) {
          return { allowed: false, reason: 'CONSECUTIVE_LOSS_PROTECTION_ACTIVE' };
        }
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
    riskPerTradePerc: number = 1,
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

    // تطبيق معامل الخطر المعدل بناءً على حد المخاطرة المدخل من العميل
    const targetRiskPerc = riskPerTradePerc && riskPerTradePerc > 0 ? riskPerTradePerc : this.config.maxRiskPerTradePerc;
    const adjustedRiskPerc = targetRiskPerc * sizeMultiplier;
    const riskAmount = portfolioSize * (adjustedRiskPerc / 100);
    const riskDistance = Math.abs(entry - sl);
    
    if (riskDistance === 0) return 0;

    // الحساب النظري بناءً على نسبة المخاطرة والمسافة حتى وقف الخسارة
    let positionSize = (riskAmount / riskDistance) * entry;
    
    // نظام الأمان المزدوج: نضمن ألا يتجاوز الهامش المخصص لأي صفقة نسبة آمنة ومحدودة من رأس المال
    // نحدد الهامش الفعلي الأقصى المسموح به لكل صفقة بضعف نسبة المخاطرة المستهدفة (مثلاً 2% هامش كحد أقصى إذا كانت المخاطرة 1%)
    const safeMarginPercent = targetRiskPerc * 2.0;
    let maxMarginPerTrade = portfolioSize * (safeMarginPercent / 100);
    
    // نضمن أيضاً تقسيم رأس المال بالتساوي كحد أقصى إضافي بناءً على عدد الصفقات الأقصى المسموح به
    const equalAllocationMargin = portfolioSize / maxConcurrentTrades;
    if (maxMarginPerTrade > equalAllocationMargin) {
      maxMarginPerTrade = equalAllocationMargin;
    }

    // القوة الشرائية أو حجم الصفقة الأقصى المقابل لهذا الهامش بالتناسب مع الرافعة المالية
    const maxBuyingPowerPerTrade = maxMarginPerTrade * leverage;
    
    // الأمان النهائي: لا نتجاوز الرصيد الكلي * الرافعة المالية
    const absoluteLimit = portfolioSize * leverage;
    let currentMaxCap = Math.min(maxBuyingPowerPerTrade, absoluteLimit);

    // نضع حداً أقصى للمركز بحيث لا يستهلك أكثر من هامشه الآمن المخصص له
    if (positionSize > currentMaxCap) {
      positionSize = currentMaxCap;
    }

    // ضمان الحد الأدنى لقواعد التداول ببايننس (عادة 11 دولار) لتجنب أخطاء الإرسال
    if (positionSize < 11) {
      // فقط إذا كان لدينا رصيد كافٍ
      if (portfolioSize >= 11 / leverage) {
        positionSize = 11;
      } else {
        positionSize = 0;
      }
    }

    if (positionSize > 0) {
       console.log(`[RISK] Smart Splitting Size: Portfolio $${portfolioSize} | Max Margin/Trade: $${maxMarginPerTrade.toFixed(2)} | Max Size Cap: $${currentMaxCap.toFixed(2)} | Risk-Based: $${((riskAmount / riskDistance) * entry).toFixed(2)} | Multiplier: ${sizeMultiplier.toFixed(2)}x | Final: $${positionSize.toFixed(2)}`);
    }

    return positionSize;
  }
}
