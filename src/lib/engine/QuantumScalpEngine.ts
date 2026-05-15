import { TradeType } from '../../types/trading.js';

export class QuantumScalpEngine {
  /**
   * Fast highly-efficient 1-minute Scalping Engine
   * Returns whether to enter, direction, and dynamic SL/TP percentages based on volatility.
   */
  public analyze(klines: any[], takerRatio: number, settings?: any): { shouldEnter: boolean; type: TradeType; reason: string; takeProfitPerc: number; stopLossPerc: number } {
    if (klines.length < 51) return { shouldEnter: false, type: 'LONG', reason: '', takeProfitPerc: 0, stopLossPerc: 0 };

    const last = klines[klines.length - 1]; // current open candle
    const prev = klines[klines.length - 2]; // last closed candle

    const c0 = parseFloat(last[4]);
    const o0 = parseFloat(last[1]);
    
    const c1 = parseFloat(prev[4]);
    const h1 = parseFloat(prev[2]);
    const l1 = parseFloat(prev[3]);

    // 1. Calculate Bollinger Bands (Configurable Settings)
    const MAPeriod = settings?.quantumBbPeriod || 20;
    const multiplier = settings?.quantumBbMultiplier || 1.8;
    const volThresh = settings?.quantumVolThreshold || 1.02;
    const momentumVol = settings?.quantumMomentumVol || 1.5;
    
    let sum = 0;
    for (let i = klines.length - MAPeriod - 1; i < klines.length - 1; i++) {
        sum += parseFloat(klines[i][4]);
    }
    const sma = sum / MAPeriod;
    
    let sumVariance = 0;
    for (let i = klines.length - MAPeriod - 1; i < klines.length - 1; i++) {
        const dev = parseFloat(klines[i][4]) - sma;
        sumVariance += dev * dev;
    }
    const stdDev = Math.sqrt(sumVariance / MAPeriod);
    const upperBB = sma + (multiplier * stdDev);
    const lowerBB = sma - (multiplier * stdDev);

    const bbWidthPerc = ((upperBB - lowerBB) / sma) * 100;
    
    // Safety check: skip if market is extremely dead or insanely volatile
    if (bbWidthPerc < 0.1 || bbWidthPerc > 12.0) {
        return { shouldEnter: false, type: 'LONG', reason: '', takeProfitPerc: 0, stopLossPerc: 0 };
    }

    // Dynamic TP/SL mapping based on current volatility
    const volFactor = bbWidthPerc * 0.5;
    const tp = Math.max(0.25, Math.min(volFactor, 2.5)); 
    const sl = Math.max(0.15, tp * 0.8); 

    // 2. Compute Volume Average (last 10 closed candles)
    let sumVol = 0;
    for (let i = klines.length - 11; i < klines.length - 1; i++) {
         sumVol += parseFloat(klines[i][5]);
    }
    const avgVol = sumVol / 10;
    const currentVol = parseFloat(last[5]);
    const prevVol = parseFloat(prev[5]);

    // ----------------------------------------------------
    // SYSTEM 1: RAPID REVERSION (Catching the bounce)
    // ----------------------------------------------------
    const pierceLower = c1 < lowerBB || l1 < lowerBB || parseFloat(prev[3]) < lowerBB;
    const pierceUpper = c1 > upperBB || h1 > upperBB || parseFloat(prev[2]) > upperBB;

    // Use takerRatio if available (not 1.0), otherwise ignore it
    const takerLongPass = takerRatio === 1.0 || takerRatio > 1.02;
    const takerShortPass = takerRatio === 1.0 || takerRatio < 0.98;

    if (pierceLower && prevVol > avgVol * volThresh && takerLongPass && c0 > o0) {
        return {
            shouldEnter: true,
            type: 'LONG',
            reason: '⚡ QUANTUM: Reversion',
            takeProfitPerc: tp,
            stopLossPerc: sl
        };
    }

    if (pierceUpper && prevVol > avgVol * volThresh && takerShortPass && c0 < o0) {
        return {
            shouldEnter: true,
            type: 'SHORT',
            reason: '⚡ QUANTUM: Reversion',
            takeProfitPerc: tp,
            stopLossPerc: sl
        };
    }

    // ----------------------------------------------------
    // SYSTEM 2: MOMENTUM INJECTION (Riding the wave)
    // ----------------------------------------------------
    const momentumLong = c1 > parseFloat(prev[1]) && prevVol > avgVol * momentumVol && (takerRatio === 1.0 || takerRatio > 1.2);
    const momentumShort = c1 < parseFloat(prev[1]) && prevVol > avgVol * momentumVol && (takerRatio === 1.0 || takerRatio < 0.8);

    if (momentumLong && c0 > o0) {
        return {
            shouldEnter: true,
            type: 'LONG',
            reason: '🚀 QUANTUM: Momentum Ignition',
            takeProfitPerc: tp * 1.2, 
            stopLossPerc: sl
        };
    }

    if (momentumShort && c0 < o0) {
        return {
            shouldEnter: true,
            type: 'SHORT',
            reason: '🚀 QUANTUM: Momentum Ignition',
            takeProfitPerc: tp * 1.2,
            stopLossPerc: sl
        };
    }

    return { shouldEnter: false, type: 'LONG', reason: '', takeProfitPerc: 0, stopLossPerc: 0 };
  }
}
