
import { Trade, MarketMetrics } from '../../types/trading.js';

export class WiseExitEngine {
  /**
   * Wise Exit Logic: Institutional Reversal & Structural Break detection
   * This is more proactive than standard trailing stops.
   */
  public analyze(trade: Trade, klines: any[], currentOI?: number, currentVol?: number): { shouldExit: boolean; reason: string } {
    if (klines.length < 5) return { shouldExit: false, reason: '' };

    const last = klines[klines.length - 1];
    const prev = klines[klines.length - 2];
    const pprev = klines[klines.length - 3];

    const c0 = parseFloat(last[4]);
    const o0 = parseFloat(last[1]);
    const h0 = parseFloat(last[2]);
    const l0 = parseFloat(last[3]);
    const v0 = parseFloat(last[5]);

    const c1 = parseFloat(prev[4]);
    const h1 = parseFloat(prev[2]);
    const l1 = parseFloat(prev[3]);
    const v1 = parseFloat(prev[5]);

    const l2 = parseFloat(pprev[3]);
    const h2 = parseFloat(pprev[2]);

    // 1. Structural Break (Break of Structure - CHO)
    // For LONG: If price breaks the LOW of the previous 2 candles
    if (trade.type === 'LONG') {
        const structuralLow = Math.min(l1, l2);
        if (c0 < structuralLow) {
            return { shouldExit: true, reason: 'WISE_EXIT: Structural Low Break (ChoCh)' };
        }
    } 
    // For SHORT: If price breaks the HIGH of the previous 2 candles
    else if (trade.type === 'SHORT') {
        const structuralHigh = Math.max(h1, h2);
        if (c0 > structuralHigh) {
            return { shouldExit: true, reason: 'WISE_EXIT: Structural High Break (ChoCh)' };
        }
    }

    // 2. Institutional Absorption / Exhaustion (Climax)
    // If Volume is massive (> 3x average) but candle body is small or wicking against direction
    const avgVol = klines.slice(-10).reduce((acc, k) => acc + parseFloat(k[5]), 0) / 10;
    const isClimax = v0 > avgVol * 3;
    
    if (isClimax) {
        if (trade.type === 'LONG') {
           const bodySize = Math.abs(c0 - o0);
           const upperWick = h0 - Math.max(o0, c0);
           if (upperWick > bodySize * 1.5) {
               return { shouldExit: true, reason: 'WISE_EXIT: Institutional Absorption (Supply)' };
           }
        } else {
           const bodySize = Math.abs(c0 - o0);
           const lowerWick = Math.min(o0, c0) - l0;
           if (lowerWick > bodySize * 1.5) {
               return { shouldExit: true, reason: 'WISE_EXIT: Institutional Absorption (Demand)' };
           }
        }
    }

    // 3. Open Interest (OI) Divergence (Advanced)
    if (currentOI && trade.oiHistory && trade.oiHistory.length > 5) {
        const prevOI = trade.oiHistory[trade.oiHistory.length - 5];
        const oiChange = ((currentOI - prevOI) / prevOI) * 100;
        
        if (trade.type === 'LONG') {
            // Price staying high or making new highs but OI is dropping
            // Means longs are taking profit and no new longs are entering to sustain move
            if (c0 >= c1 && oiChange < -0.05) {
                return { shouldExit: true, reason: 'WISE_EXIT: Smart Money Distribution (OI Drop)' };
            }
        } else {
            // Price staying low or making new lows but OI is dropping
            if (c0 <= c1 && oiChange < -0.05) {
                return { shouldExit: true, reason: 'WISE_EXIT: Smart Money Distribution (OI Drop)' };
            }
        }
    }

    // 4. Volume Divergence
    // Price moves up on decreasing volume (Weak follow-through)
    if (trade.type === 'LONG' && c0 > c1 && v0 < v1 * 0.7 && trade.pnlPerc! > 0.5) {
        return { shouldExit: true, reason: 'WISE_EXIT: Volume Exhaustion' };
    }
    if (trade.type === 'SHORT' && c0 < c1 && v0 < v1 * 0.7 && trade.pnlPerc! > 0.5) {
        return { shouldExit: true, reason: 'WISE_EXIT: Volume Exhaustion' };
    }

    return { shouldExit: false, reason: '' };
  }
}
