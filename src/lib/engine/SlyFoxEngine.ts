import { MarketMetrics, EngineDecision, MarketRegime, TrapType } from '../../types/trading.js';

export class SlyFoxEngine {
  /**
   * Market Mode Detector
   * Evaluates if the market is trending or choppy/ranging
   */
  public detectMode(klines: any[], metrics: MarketMetrics): 'TREND' | 'RANGE' {
    const adx = metrics.adx;
    
    // Quick Fake Breakout Detection
    // Check last 10 candles for wicks larger than bodies at the top/bottom
    let fakeBreakouts = 0;
    const recent = klines.slice(-10);
    for (const k of recent) {
        const o = parseFloat(k[1]);
        const h = parseFloat(k[2]);
        const l = parseFloat(k[3]);
        const c = parseFloat(k[4]);
        const body = Math.abs(c - o);
        const upperWick = h - Math.max(o, c);
        const lowerWick = Math.min(o, c) - l;
        
        // If wick is twice the body, it's a potential fakeout
        if (upperWick > body * 2 || lowerWick > body * 2) {
            fakeBreakouts++;
        }
    }

    // IF ADX < 20 AND fake breakouts frequent -> RANGE
    // Sometimes ADX is up to 25 but it's still choppy if fake breakouts are high
    if (adx < 25 && fakeBreakouts >= 2) {
        return 'RANGE';
    } else if (adx < 20) {
        return 'RANGE';
    }

    return 'TREND';
  }

  /**
   * Sly Fox Mean Reversion & Trap Hunting Logic
   */
  public analyze(klines: any[], metrics: MarketMetrics): { shouldEnter: boolean; type: 'LONG' | 'SHORT'; reason: string; confidence: number } {
    if (klines.length < 20) return { shouldEnter: false, type: 'LONG', reason: '', confidence: 0 };

    const mode = this.detectMode(klines, metrics);
    if (mode === 'TREND') {
        // Sly Fox sleeps during pure momentum trends
        return { shouldEnter: false, type: 'LONG', reason: '', confidence: 0 };
    }

    const last = klines[klines.length - 1];
    const prev = klines[klines.length - 2];
    
    const c0 = parseFloat(last[4]);
    const o0 = parseFloat(last[1]);
    const h0 = parseFloat(last[2]);
    const l0 = parseFloat(last[3]);
    const v0 = parseFloat(last[5]);

    const c1 = parseFloat(prev[4]);

    // Calculate Support and Resistance (Recent Range)
    const recentHighs = klines.slice(-20, -1).map(k => parseFloat(k[2]));
    const recentLows = klines.slice(-20, -1).map(k => parseFloat(k[3]));
    const res = Math.max(...recentHighs);
    const sup = Math.min(...recentLows);
    const range = res - sup;

    if (range <= 0) return { shouldEnter: false, type: 'LONG', reason: '', confidence: 0 };

    const distToSup = c0 - sup;
    const distToRes = res - c0;
    
    const nearSup = distToSup < range * 0.2; // in bottom 20% of range
    const nearRes = distToRes < range * 0.2; // in top 20% of range

    // Volume Exhaustion check: V0 is less than average volume
    const recentVols = klines.slice(-10, -1).map(k => parseFloat(k[5]));
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
    const volumeExhaustion = v0 < avgVol * 0.8; 

    // CVD approximation from Taker Buy/Sell Ratio
    // > 1.0 means more taker buy volume (positive CVD)
    // < 1.0 means more taker sell volume (negative CVD)
    const cvdPositive = (metrics.takerRatio !== undefined) ? (metrics.takerRatio > 1.0) : (c0 > o0); 
    const cvdNegative = (metrics.takerRatio !== undefined) ? (metrics.takerRatio < 1.0) : (c0 < o0);
    const cvdWeak = (metrics.takerRatio !== undefined) ? (metrics.takerRatio > 0.8 && metrics.takerRatio < 1.2) : (Math.abs(c0 - o0) < range * 0.1);
    
    // Selling weakens (long wicks down)
    const sellingWeakens = (Math.min(o0, c0) - l0) > Math.abs(c0 - o0) || (Math.abs(c1 - parseFloat(prev[1])) > Math.abs(c0 - o0));
    // Buying weakens (long wicks up)
    const buyingWeakens = (h0 - Math.max(o0, c0)) > Math.abs(c0 - o0) || (Math.abs(c1 - parseFloat(prev[1])) > Math.abs(c0 - o0));

    // OI Flat/Weak indicator (used here via Volume proxy + CVD weakness)
    const oiFlat = volumeExhaustion || cvdWeak;

    // 1. MEAN REVERSION: LONG at Support
    if (nearSup && cvdPositive && sellingWeakens && oiFlat) {
        return {
            shouldEnter: true,
            type: 'LONG',
            reason: '🦊 SLY_FOX: Range Support (CVD+ | Sell Weak | OI Flat)',
            confidence: 0.85
        };
    }

    // 2. MEAN REVERSION: SHORT at Resistance
    if (nearRes && cvdNegative && buyingWeakens && oiFlat) {
        return {
            shouldEnter: true,
            type: 'SHORT',
            reason: '🦊 SLY_FOX: Range Resistance (CVD- | Buy Weak | OI Flat)',
            confidence: 0.85
        };
    }

    // 3. TRAP HUNTER: Fake Breakdown / Bear Trap (Liquidity Hunt)
    // Market breaks support on prev/current candle but closes back inside range (c0 > sup) and Volume/CVD was weak for the breakdown
    const h1 = parseFloat(prev[2]);
    const l1 = parseFloat(prev[3]);
    const fakeBreakdown = (l1 < sup || l0 < sup) && c0 > sup && c0 > o0;
    if (fakeBreakdown && (cvdWeak || oiFlat)) {
        return {
            shouldEnter: true,
            type: 'LONG',
            reason: '🦊 SLY_FOX: Liquidity Hunter (Bear Trap Swept | Fake Breakdown)',
            confidence: 0.95 // High confidence in traps
        };
    }

    // 4. TRAP HUNTER: Fake Breakout / Bull Trap (Liquidity Hunt)
    // Market breaks resistance on prev/current candle but closes back inside (c0 < res) and Volume/CVD was weak for the breakout
    const fakeBreakup = (h1 > res || h0 > res) && c0 < res && c0 < o0;
    if (fakeBreakup && (cvdWeak || oiFlat)) {
        return {
            shouldEnter: true,
            type: 'SHORT',
            reason: '🦊 SLY_FOX: Liquidity Hunter (Bull Trap Swept | Fake Breakout)',
            confidence: 0.95
        };
    }

    return { shouldEnter: false, type: 'LONG', reason: '', confidence: 0 };
  }
}
