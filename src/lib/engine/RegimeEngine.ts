
import { MarketMetrics, MarketRegime } from '../../types/trading.js';

export class RegimeEngine {
  private static recentBreakouts: { isFakeout: boolean; time: number }[] = [];
  private static recentTrades: { isWin: boolean; time: number }[] = [];
  private static recentLiquidations: { isCascade: boolean; time: number }[] = [];

  public static recordBreakout(isFakeout: boolean) {
    this.recentBreakouts.push({ isFakeout, time: Date.now() });
    if (this.recentBreakouts.length > 20) this.recentBreakouts.shift();
  }

  public static recordTradeResult(isWin: boolean) {
    this.recentTrades.push({ isWin, time: Date.now() });
    if (this.recentTrades.length > 20) this.recentTrades.shift();
  }

  public static recordLiquidation(isCascade: boolean) {
    this.recentLiquidations.push({ isCascade, time: Date.now() });
    if (this.recentLiquidations.length > 20) this.recentLiquidations.shift();
  }

  public static getRecentFakeoutRate(): number {
    if (this.recentBreakouts.length === 0) return 0.20; // default 20%
    const fakeouts = this.recentBreakouts.filter(b => b.isFakeout).length;
    return fakeouts / this.recentBreakouts.length;
  }

  public static getRecentTrendRespect(): number {
    if (this.recentTrades.length === 0) return 0.70; // default 70% Winrate
    const wins = this.recentTrades.filter(t => t.isWin).length;
    return wins / this.recentTrades.length;
  }

  public static getRecentLiquidationBehavior(): 'NORMAL' | 'CASCADING' | 'NONE' {
    if (this.recentLiquidations.length === 0) return 'NORMAL';
    const cascades = this.recentLiquidations.filter(l => l.isCascade).length;
    return cascades >= 3 ? 'CASCADING' : 'NORMAL';
  }

  /**
   * تحليل حالة السوق بناءً على المقاييس التقنية والسيولة
   */
  public analyze(metrics: MarketMetrics): { regime: MarketRegime; decision: 'TRADE' | 'WAIT' | 'SLEEP' } {
    // Check if recent fakeout rates are high to switch regime to TRAP_MODE
    const fakeRate = RegimeEngine.getRecentFakeoutRate();
    if (fakeRate > 0.40) {
      return { regime: MarketRegime.TRAP_MODE, decision: 'WAIT' };
    }
    // Calculate dynamic RVOL thresholds using volume stability (volCoefVar)
    const volCoefVar = metrics.volCoefVar ?? 0.2;
    const dynamicDeadZoneThreshold = Math.max(0.85, Math.min(1.35, 0.75 + 1.8 * volCoefVar));
    const dynamicTrendExpansionThreshold = Math.max(1.1, Math.min(1.85, 1.0 + 2.0 * volCoefVar));

    // 1. Extreme Dead Zone (Only sleep if both ADX and RVOL are dead)
    if (metrics.adx < 12 && metrics.rvol < dynamicDeadZoneThreshold) {
      return { regime: MarketRegime.DEAD_CHOP, decision: 'SLEEP' };
    }

    // 2. Volatility Insanity
    if (metrics.atrPerc > 5) {
      return { regime: MarketRegime.VIOLENT_VOLATILITY, decision: 'WAIT' };
    }

    // 3. Compression Detection (Potential Breakout)
    if (metrics.adx < 25 && metrics.atrPerc < 1) {
      return { regime: MarketRegime.COMPRESSION, decision: 'TRADE' }; // Switch to TRADE to allow range scalping
    }

    // 4. Trend Expansion
    if (metrics.adx > 25 && metrics.rvol > dynamicTrendExpansionThreshold) {
      return { regime: MarketRegime.TREND_EXPANSION, decision: 'TRADE' };
    }

    // 5. Momentum Mode
    if (metrics.takerRatio && (metrics.takerRatio > 1.8 || metrics.takerRatio < 0.5)) {
      return { regime: MarketRegime.MOMENTUM_MODE, decision: 'TRADE' };
    }

    // 6. Range Trading / Scalping Mode
    if (metrics.adx >= 12 && metrics.adx <= 25) {
       return { regime: MarketRegime.TRENDING, decision: 'TRADE' }; // Treat as trending for signal evaluation
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

  /**
   * وظيفة مساعدة لحساب RSI (مؤشر القوة النسبية)
   */
  public static calculateRSI(klines: any[]): number {
    if (klines.length < 15) return 50;

    let gains = 0;
    let losses = 0;

    // استخدام آخر 14 شمعة مغلقة
    const period = 14;
    const startIdx = klines.length - 1 - period;
    
    for (let i = startIdx + 1; i < klines.length; i++) {
        const change = parseFloat(klines[i][4]) - parseFloat(klines[i - 1][4]);
        if (change >= 0) gains += change;
        else losses -= change;
    }

    if (losses === 0) return 100;
    const rs = (gains / period) / (losses / period);
    const rsi = 100 - (100 / (1 + rs));
    
    return rsi;
  }
}
