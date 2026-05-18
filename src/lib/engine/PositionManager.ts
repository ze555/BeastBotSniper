
import { TradePosition } from '../../types/trading.js';

export class PositionManager {
  /**
   * إدارة الصفقة المفتوحة وتحديث الـ SL/TP
   * يتم استدعاء هذا المحرك لاتخاذ قرار بشأن تحديث أو إغلاق الصفقة بناءً على القواعد الأساسية
   */
  public manage(
    trade: TradePosition, 
    currentPrice: number, 
    settings: { 
      strictFastBreakevenPerc?: number, 
      tradingFeeRate?: number,
      leverage?: number
    }
  ): { action: 'NONE' | 'CLOSE' | 'UPDATE'; reason?: string; updatedTrade?: TradePosition } {
    let updated = false;
    const newTrade = { ...trade };

    // 1. حساب الإحصائيات الأساسية (PnL, Price Change)
    const priceChangePerc = trade.type === 'LONG' 
        ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 
        : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
    
    const totalFeeRate = settings.tradingFeeRate ?? 0.001;
    const leverage = trade.leverage || settings.leverage || 10;
    
    // ROE % = (PriceChange% - Fee%) * Leverage (Binance Standard)
    const roePerc = (priceChangePerc - (totalFeeRate * 100)) * leverage;
    newTrade.pnlPerc = roePerc;
    
    // PnL $ = (Amount * PriceChange / 100) - Fees + Realized
    let currentPnl = ((trade.amount * priceChangePerc) / 100) - (trade.amount * totalFeeRate);
    if (trade.realizedPnl) {
        currentPnl += trade.realizedPnl;
    }
    newTrade.pnl = currentPnl;

    // 2. تحديثات تتبع السعر (Highest Price)
    if (!newTrade.highestPrice || (trade.type === 'LONG' ? currentPrice > newTrade.highestPrice : currentPrice < newTrade.highestPrice)) {
      newTrade.highestPrice = currentPrice;
      updated = true;
    }

    // 3. تأمين نقطة الدخول (Breakeven Logic)
    const beThreshold = settings.strictFastBreakevenPerc ?? 0.5;
    if (!trade.isBreakeven && priceChangePerc >= beThreshold) {
      // نقل الوقف لسعر الدخول + تغطية الرسوم (0.15% أمان إضافي)
      const feeBuffer = 1.0015;
      newTrade.sl = trade.type === 'LONG' ? trade.entryPrice * feeBuffer : trade.entryPrice * (2 - feeBuffer);
      newTrade.isBreakeven = true;
      updated = true;
    }

    // 4. فحص الأهداف (TP / SL)
    
    // Target 1: Partial Exit (Status Update)
    if (trade.status === 'OPEN') {
      const hitTp1 = trade.type === 'LONG' ? currentPrice >= trade.tp1 : currentPrice <= trade.tp1;
      if (hitTp1) {
        newTrade.status = 'TP1_HIT';
        updated = true;
      }
    }

    // Target 2: Final Exit (Hard TP)
    const hitTp2 = trade.type === 'LONG' ? currentPrice >= trade.tp2 : currentPrice <= trade.tp2;
    if (hitTp2) {
      return { action: 'CLOSE', reason: 'TP2_HIT', updatedTrade: newTrade };
    }

    // Stop Loss Hit
    const hitSl = trade.type === 'LONG' ? currentPrice <= trade.sl : currentPrice >= trade.sl;
    if (hitSl) {
      return { action: 'CLOSE', reason: trade.isBreakeven ? 'BREAKEVEN_HIT' : 'STOP_LOSS_HIT', updatedTrade: newTrade };
    }

    if (updated) {
      return { action: 'UPDATE', updatedTrade: newTrade };
    }

    return { action: 'NONE' };
  }
}
