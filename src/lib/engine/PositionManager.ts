
import { TradePosition } from '../../types/trading.js';

export class PositionManager {
  /**
   * إدارة الصفقة المفتوحة وتحديث الـ SL/TP
   */
  public manage(trade: TradePosition, currentPrice: number, breakevenThreshold: number = 0.5): { action: 'NONE' | 'CLOSE' | 'UPDATE'; reason?: string; updatedTrade?: TradePosition } {
    let updated = false;
    const newTrade = { ...trade };

    // حساب الـ PnL الحالي
    const priceChangePerc = trade.type === 'LONG' 
        ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 
        : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
    
    const totalFeeRate = 0.001;
    const leverage = trade.leverage || 10;
    
    // ROE % = (PriceChange% - Fee%) * Leverage
    const roePerc = (priceChangePerc - (totalFeeRate * 100)) * leverage;
    newTrade.pnlPerc = roePerc;
    
    // PnL $ = (Amount * PriceChange / 100) - Fees + Realized
    let currentPnl = ((trade.amount * priceChangePerc) / 100) - (trade.amount * totalFeeRate);
    if (trade.realizedPnl) {
        currentPnl += trade.realizedPnl;
    }
    newTrade.pnl = currentPnl;

    // 1. Breakeven Logic (Pseudo: IF trade_profit > Threshold% Price Change: MOVE_SL_TO_ENTRY)
    if (!trade.isBreakeven && priceChangePerc > breakevenThreshold) {
      newTrade.sl = trade.entryPrice;
      newTrade.isBreakeven = true;
      updated = true;
    }

    // 2. TP1 Hit (Partial Exit Logic)
    if (trade.status === 'OPEN') {
      const hitTp1 = trade.type === 'LONG' ? currentPrice >= trade.tp1 : currentPrice <= trade.tp1;
      if (hitTp1) {
        newTrade.status = 'TP1_HIT';
        newTrade.sl = trade.entryPrice * (trade.type === 'LONG' ? 1.001 : 0.999); // تأمين بسيط
        updated = true;
      }
    }

    // 3. TP2 Hit (Final Exit)
    const hitTp2 = trade.type === 'LONG' ? currentPrice >= trade.tp2 : currentPrice <= trade.tp2;
    if (hitTp2) {
      return { action: 'CLOSE', reason: 'TAKE_PROFIT_2_HIT' };
    }

    // 4. SL Hit
    const hitSl = trade.type === 'LONG' ? currentPrice <= trade.sl : currentPrice >= trade.sl;
    if (hitSl) {
      return { action: 'CLOSE', reason: 'STOP_LOSS_HIT' };
    }

    if (updated) {
      return { action: 'UPDATE', updatedTrade: newTrade };
    }

    return { action: 'NONE' };
  }
}
