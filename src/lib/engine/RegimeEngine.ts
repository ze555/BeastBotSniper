
import { MarketMetrics, MarketRegime } from '../../types/trading.js';

export class RegimeEngine {
  /**
   * تحليل حالة السوق بناءً على المقاييس التقنية والسيولة
   */
  public analyze(metrics: MarketMetrics): { regime: MarketRegime; decision: 'TRADE' | 'WAIT' | 'SLEEP' } {
    // 1. Dead Chop Detection (Pseudo: IF chop_detected: SLEEP)
    if (metrics.isChop || metrics.adx < 20) {
      return { regime: MarketRegime.DEAD_CHOP, decision: 'SLEEP' };
    }

    // 2. Volatility Insanity (Pseudo: IF volatility_insanity: REDUCE_RISK/WAIT)
    if (metrics.atrPerc > 5) {
      return { regime: MarketRegime.VIOLENT_VOLATILITY, decision: 'WAIT' };
    }

    // 3. Compression Detection (Wait for breakout)
    if (metrics.adx < 25 && metrics.atrPerc < 1) {
      return { regime: MarketRegime.COMPRESSION, decision: 'WAIT' };
    }

    // 4. Trend Expansion (Pseudo: IF trend_expanding: ENABLE_HUNT_MODE)
    if (metrics.adx > 30 && metrics.rvol > 1.5) {
      return { regime: MarketRegime.TREND_EXPANSION, decision: 'TRADE' };
    }

    // 5. Momentum Mode
    if (metrics.adx > 25 && metrics.takerRatio && metrics.takerRatio > 1.5) {
      return { regime: MarketRegime.MOMENTUM_MODE, decision: 'TRADE' };
    }

    return { regime: MarketRegime.DEAD_CHOP, decision: 'WAIT' };
  }

  /**
   * وظيفة مساعدة لحساب ADX (مبسطة للبيانات الحية)
   */
  public static calculateADX(klines: any[]): number {
    if (klines.length < 28) return 25; // Default if not enough data
    
    // حساب الـ True Range (TR) و +DM و -DM
    let trs: number[] = [];
    let plusDMs: number[] = [];
    let minusDMs: number[] = [];
    
    for (let i = 1; i < klines.length; i++) {
        const curH = parseFloat(klines[i][2]);
        const curL = parseFloat(klines[i][3]);
        const curC = parseFloat(klines[i][4]);
        const prevH = parseFloat(klines[i-1][2]);
        const prevL = parseFloat(klines[i-1][3]);
        const prevC = parseFloat(klines[i-1][4]);
        
        const tr = Math.max(curH - curL, Math.abs(curH - prevC), Math.abs(curL - prevC));
        trs.push(tr);
        
        const upMove = curH - prevH;
        const downMove = prevL - curL;
        
        plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    
    // تنعيم القيم (Smoothing) - 14 period
    const average = (arr: number[]) => arr.slice(-14).reduce((a, b) => a + b, 0) / 14;
    const smoothTR = average(trs);
    const smoothPlusDM = average(plusDMs);
    const smoothMinusDM = average(minusDMs);
    
    const plusDI = 100 * (smoothPlusDM / smoothTR);
    const minusDI = 100 * (smoothMinusDM / smoothTR);
    const dx = 100 * (Math.abs(plusDI - minusDI) / (plusDI + minusDI));
    
    return dx || 25;
  }
}
