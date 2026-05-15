
import { MarketMetrics, EngineDecision, MarketRegime, TrapType } from '../../types/trading.js';

export class WiseEntryEngine {
  /**
   * Wise Entry Logic (SMC Pulse)
   * Focuses on Structural Breaks (BoS/ChoCh) and Institutional Momentum.
   */
  public analyze(klines: any[], metrics: MarketMetrics, bias: 'LONG' | 'SHORT' | 'NEUTRAL'): { shouldEnter: boolean; type: 'LONG' | 'SHORT'; reason: string; confidence: number } {
    if (klines.length < 20) return { shouldEnter: false, type: 'LONG', reason: '', confidence: 0 };

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

    // Calculate dynamic range (structural points)
    const recentHighs = klines.slice(-15, -1).map(k => parseFloat(k[2]));
    const recentLows = klines.slice(-15, -1).map(k => parseFloat(k[3]));
    
    const rangeHigh = Math.max(...recentHighs);
    const rangeLow = Math.min(...recentLows);

    // 1. WISE LONG ENTRY (Structural Break + Volume Expansion)
    // Price breaks the recent Range High with increased volume and a strong body
    const isBullShow = c0 > o0 && (c0 - o0) > (h0 - l0) * 0.6; // Strong green body
    const breakHigh = c0 > rangeHigh;
    const volExpansion = v0 > v1 * 1.2;

    if (breakHigh && isBullShow && volExpansion && (bias === 'LONG' || bias === 'NEUTRAL')) {
        // Double check: No extreme RSI overbought
        if (metrics.rsi < 75) {
            return { 
                shouldEnter: true, 
                type: 'LONG', 
                reason: 'WISE_ENTRY: Structural Breakout (BoS) + Bullish Expansion', 
                confidence: 0.9 
            };
        }
    }

    // 2. WISE SHORT ENTRY
    const isBearShow = c0 < o0 && (o0 - c0) > (h0 - l0) * 0.6; // Strong red body
    const breakLow = c0 < rangeLow;

    if (breakLow && isBearShow && volExpansion && (bias === 'SHORT' || bias === 'NEUTRAL')) {
        if (metrics.rsi > 25) {
            return { 
                shouldEnter: true, 
                type: 'SHORT', 
                reason: 'WISE_ENTRY: Structural Breakdown (BoS) + Bearish Expansion', 
                confidence: 0.9 
            };
        }
    }

    // 3. SMART MONEY REVERSAL (Institutional Re-entry)
    // Detection of "Spring" or "Upthrust" (Liquidity Grabs) followed by rapid recovery
    const avgVol = klines.slice(-10).reduce((acc, k) => acc + parseFloat(k[5]), 0) / 10;
    
    // For LONG Reversal: Price swept rangeLow, then closed back ABOVE it with volume
    const sweptLow = l1 < rangeLow || l0 < rangeLow;
    const recoveredLow = c0 > rangeLow && c0 > o0;
    if (sweptLow && recoveredLow && v0 > avgVol * 1.5 && bias !== 'SHORT') {
        return { 
            shouldEnter: true, 
            type: 'LONG', 
            reason: 'WISE_ENTRY: Institutional Liquidity Sweep (Spring)', 
            confidence: 0.95 
        };
    }

    // For SHORT Reversal: Price swept rangeHigh, then closed back BELOW it with volume
    const sweptHigh = h1 > rangeHigh || h0 > rangeHigh;
    const recoveredHigh = c0 < rangeHigh && c0 < o0;
    if (sweptHigh && recoveredHigh && v0 > avgVol * 1.5 && bias !== 'LONG') {
        return { 
            shouldEnter: true, 
            type: 'SHORT', 
            reason: 'WISE_ENTRY: Institutional Liquidity Sweep (Upthrust)', 
            confidence: 0.95 
        };
    }

    return { shouldEnter: false, type: 'LONG', reason: '', confidence: 0 };
  }

  /**
   * Returns institutional pressure score (SMC)
   * Values near 1.0 mean strong structural breakout or liquidity grab
   */
  public getSMCPressure(klines: any[]): { longPressure: number; shortPressure: number; type: 'BOS' | 'SWEEP' | 'NONE' } {
    if (klines.length < 15) return { longPressure: 0, shortPressure: 0, type: 'NONE' };
    
    const last = klines[klines.length - 1];
    const c0 = parseFloat(last[4]);
    const o0 = parseFloat(last[1]);
    const v0 = parseFloat(last[5]);
    
    const recentHighs = klines.slice(-15, -1).map(k => parseFloat(k[2]));
    const recentLows = klines.slice(-15, -1).map(k => parseFloat(k[3]));
    const rangeHigh = Math.max(...recentHighs);
    const rangeLow = Math.min(...recentLows);
    
    let longPressure = 0;
    let shortPressure = 0;
    let type: 'BOS' | 'SWEEP' | 'NONE' = 'NONE';

    // 1. Structural Breakout Pressure
    if (c0 > rangeHigh) {
        longPressure += 0.6;
        type = 'BOS';
    }
    if (c0 < rangeLow) {
        shortPressure += 0.6;
        type = 'BOS';
    }

    // 2. Body Strength Pressure
    const bodySize = Math.abs(c0 - o0);
    const range = parseFloat(last[2]) - parseFloat(last[3]);
    if (bodySize > range * 0.7) {
        if (c0 > o0) longPressure += 0.3;
        else shortPressure += 0.3;
    }

    // 3. Liquidity Sweep Detection (Quick Check)
    const lowSweep = parseFloat(last[3]) < rangeLow && c0 > rangeLow;
    if (lowSweep) {
        longPressure += 0.8;
        type = 'SWEEP';
    }
    const highSweep = parseFloat(last[2]) > rangeHigh && c0 < rangeHigh;
    if (highSweep) {
        shortPressure += 0.8;
        type = 'SWEEP';
    }

    return { 
        longPressure: Math.min(1.0, longPressure), 
        shortPressure: Math.min(1.0, shortPressure),
        type
    };
  }
}
