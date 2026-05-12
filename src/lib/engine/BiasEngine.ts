
import { MarketMetrics } from '../../types/trading.js';

export class BiasEngine {
  /**
   * تحديد الانحياز الاتجاهي بناءً على البنية الكبرى (HTF Structure)
   */
  public getBias(htfKlines: any[]): 'LONG' | 'SHORT' | 'NEUTRAL' {
    if (htfKlines.length < 50) return 'NEUTRAL';

    const closes = htfKlines.map(k => parseFloat(k[4]));
    
    // حساب EMA 50 كمؤشر للبنية الكبرى
    const k = 2 / (50 + 1);
    let ema50 = closes[0];
    for (let i = 1; i < closes.length; i++) {
        ema50 = (closes[i] * k) + (ema50 * (1 - k));
    }

    const currentPrice = closes[closes.length - 1];
    
    // التحقق من HH/LL (Higher Highs / Lower Lows)
    const recentCloses = closes.slice(-5);
    const isHH = recentCloses[4] > Math.max(...recentCloses.slice(0, 4));
    const isLL = recentCloses[4] < Math.min(...recentCloses.slice(0, 4));

    if (currentPrice > ema50 && isHH) return 'LONG';
    if (currentPrice < ema50 && isLL) return 'SHORT';

    return 'NEUTRAL';
  }
}
