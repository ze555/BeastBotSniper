
import { MarketMetrics, TrapType } from '../../types/trading.js';

export class LiquidityEngine {
  /**
   * اكتشاف الفخاخ (Traps) واصطياد السيولة
   */
  public detectTrap(metrics: MarketMetrics, klines: any[]): TrapType {
    const lastCandle = klines[klines.length - 1];
    const prevCandle = klines[klines.length - 2];
    
    const close = parseFloat(lastCandle[4]);
    const open = parseFloat(lastCandle[1]);
    const high = parseFloat(lastCandle[2]);
    const low = parseFloat(lastCandle[3]);
    const volume = parseFloat(lastCandle[5]);
    
    const bodySize = Math.abs(close - open);
    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;

    // 1. Long Trap (Pseudo: IF resistance_break && volume_spike && price_fails_to_continue)
    // اكتشاف "فخ الشراء": كسر قمة مع فوليوم عالي ثم رفض سريع
    if (upperWick > bodySize * 2 && metrics.rvol > 2 && close < open) {
      // ذيل علوي طويل جداً + فوليوم انفجاري + إغلاق هابط = فخ شراء
      if (metrics.takerRatio && metrics.takerRatio < 0.8) {
         return TrapType.LONG_TRAP;
      }
    }

    // 2. Short Trap
    // اكتشاف "فخ البيع": كسر قاع مع فوليوم عالي ثم ارتداد سريع
    if (lowerWick > bodySize * 2 && metrics.rvol > 2 && close > open) {
      if (metrics.takerRatio && metrics.takerRatio > 1.2) {
         return TrapType.SHORT_TRAP;
      }
    }

    // 3. OI Divergence Trap (دخول متأخرين)
    if (metrics.oiChange && metrics.oiChange > 5 && metrics.rvol > 1.5) {
        // السعر لم يتحرك كثيراً لكن OI ارتفع بقوة = حشد يتم حصره
        if (upperWick > lowerWick && close < open) return TrapType.LONG_TRAP;
        if (lowerWick > upperWick && close > open) return TrapType.SHORT_TRAP;
    }

    return TrapType.NONE;
  }
}
