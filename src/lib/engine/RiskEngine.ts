
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
  public canTrade(activeTrades: TradePosition[], history: any[]): { allowed: boolean; reason?: string } {
    // 1. Exposure Control
    const totalExposure = activeTrades.reduce((sum, t) => sum + (t.amount / 10), 0); // تقريبي بناءً على الرافعة
    if (activeTrades.length >= 10) {
      return { allowed: false, reason: 'MAX_CONCURRENT_TRADES_REACHED' };
    }

    // 2. Consecutive Loss Protection
    if (history.length >= this.config.maxConsecutiveLosses) {
      const recent = history.slice(0, this.config.maxConsecutiveLosses);
      const allLoss = recent.every(t => t.pnl < 0);
      if (allLoss) {
        return { allowed: false, reason: 'CONSECUTIVE_LOSS_PROTECTION_ACTIVE' };
      }
    }

    return { allowed: true };
  }

  /**
   * حساب حجم الصفقة بناءً على الـ Stop Loss
   */
  public calculatePositionSize(portfolioSize: number, entry: number, sl: number): number {
    const riskAmount = portfolioSize * (this.config.maxRiskPerTradePerc / 100);
    const riskDistance = Math.abs(entry - sl);
    const positionSize = (riskAmount / riskDistance) * entry;
    return positionSize;
  }
}
