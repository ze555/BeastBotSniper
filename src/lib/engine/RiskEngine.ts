
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
   * حساب حجم الصفقة بناءً على الـ Stop Loss مع احترام الرافعة المالية وتقسيم رأس المال
   */
  public calculatePositionSize(portfolioSize: number, entry: number, sl: number, leverage: number = 10, maxConcurrentTrades: number = 10): number {
    const riskAmount = portfolioSize * (this.config.maxRiskPerTradePerc / 100);
    const riskDistance = Math.abs(entry - sl);
    
    if (riskDistance === 0) return 0;

    // الحساب النظري بناءً على المخاطرة
    let positionSize = (riskAmount / riskDistance) * entry;
    
    // سقف القوة الشرائية المخصصة لكل صفقة (لتجنب استهلاك كامل الرصيد في صفقة واحدة)
    // العميل طلب تقسيم رأس المال
    const allocatedPortfolio = portfolioSize / maxConcurrentTrades;
    const maxBuyingPowerPerTrade = allocatedPortfolio * leverage;
    
    if (positionSize > maxBuyingPowerPerTrade) {
      positionSize = maxBuyingPowerPerTrade;
    }

    return positionSize;
  }
}
