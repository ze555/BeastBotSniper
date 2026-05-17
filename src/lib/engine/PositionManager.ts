
import { TradePosition } from '../../types/trading.js';

export class PositionManager {
  /**
   * إدارة الصفقة المفتوحة وتحديث الـ SL/TP
   */
  public manage(trade: TradePosition, currentPrice: number): { action: 'NONE' | 'CLOSE' | 'UPDATE'; reason?: string; updatedTrade?: TradePosition } {
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

    // 1. Breakeven Logic (Pseudo: IF trade_profit > 0.5% Price Change: MOVE_SL_TO_ENTRY)
    if (!trade.isBreakeven && priceChangePerc > 0.5) {
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

    // 4. SL Hit & Trailing Logic
    const hitSl = trade.type === 'LONG' ? currentPrice <= trade.sl : currentPrice >= trade.sl;
    if (hitSl) {
      return { action: 'CLOSE', reason: 'STOP_LOSS_HIT' };
    }

    // [TRAILING SL - LOSer SYSTEM TWEAK]
    // If trade is in profit (bot merit), trail the stop loss to secure some loss-prevention
    // but keep it wide enough to allow pullbacks (expanding the range)
    const trailTriggerPerc = 0.4; // 0.4% price change to start trailing
    const trailDistancePerc = 0.8; // Distance to maintain from highest price

    if (priceChangePerc > trailTriggerPerc) {
      const highestPrice = trade.highestPrice || currentPrice;
      const newSl = trade.type === 'LONG'
        ? highestPrice * (1 - (trailDistancePerc / 100))
        : highestPrice * (1 + (trailDistancePerc / 100));

      // Only update if it moves SL in favor of the trade (closing the gap)
      const betterSl = trade.type === 'LONG' ? newSl > trade.sl : newSl < trade.sl;
      if (betterSl) {
        newTrade.sl = newSl;
        updated = true;
      }
    }

    if (updated) {
      return { action: 'UPDATE', updatedTrade: newTrade };
    }

    return { action: 'NONE' };
  }
}
