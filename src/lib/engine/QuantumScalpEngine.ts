import { TradeType } from '../../types/trading.js';

export class QuantumScalpEngine {
  /**
   * Fast highly-efficient 1-minute Scalping Engine
   * Returns whether to enter, direction, and dynamic SL/TP percentages based on volatility.
   */
  public analyze(klines: any[], takerRatio: number): { shouldEnter: boolean; type: TradeType; reason: string; takeProfitPerc: number; stopLossPerc: number } {
    if (klines.length < 21) return { shouldEnter: false, type: 'LONG', reason: '', takeProfitPerc: 0, stopLossPerc: 0 };

    const last = klines[klines.length - 1]; // current open candle
    const prev = klines[klines.length - 2]; // last closed candle

    const c0 = parseFloat(last[4]);
    const o0 = parseFloat(last[1]);
    
    const c1 = parseFloat(prev[4]);
    const h1 = parseFloat(prev[2]);
    const l1 = parseFloat(prev[3]);

    // 1. Calculate Bollinger Bands (Period 20, Multiplier 2.2 for safer scalps)
    const MAPeriod = 20;
    const multiplier = 2.2;
    
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
    if (bbWidthPerc < 0.2 || bbWidthPerc > 8.0) {
        return { shouldEnter: false, type: 'LONG', reason: '', takeProfitPerc: 0, stopLossPerc: 0 };
    }

    // Dynamic TP/SL mapping based on current volatility
    // Standard scalp targets: 0.5% TP and 0.3% SL
    // but if band is wide, we aim higher
    const volFactor = bbWidthPerc * 0.4;
    const tp = Math.max(0.4, Math.min(volFactor, 1.5)); // min 0.4%, max 1.5%
    const sl = Math.max(0.25, tp * 0.7); // Risk:Reward ~ 1:1.4

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
    const pierceLower = c1 < lowerBB || l1 < lowerBB;
    const pierceUpper = c1 > upperBB || h1 > upperBB;

    if (pierceLower && prevVol > avgVol * 1.5 && takerRatio > 1.2 && c0 > o0) {
        return {
            shouldEnter: true,
            type: 'LONG',
            reason: '⚡ QUANTUM: Bullish Reversion (BB Lower Pierce + High Taker Buy)',
            takeProfitPerc: tp,
            stopLossPerc: sl
        };
    }

    if (pierceUpper && prevVol > avgVol * 1.5 && takerRatio < 0.8 && c0 < o0) {
        return {
            shouldEnter: true,
            type: 'SHORT',
            reason: '⚡ QUANTUM: Bearish Reversion (BB Upper Pierce + High Taker Sell)',
            takeProfitPerc: tp,
            stopLossPerc: sl
        };
    }

    // ----------------------------------------------------
    // SYSTEM 2: MOMENTUM INJECTION (Riding the wave)
    // ----------------------------------------------------
    // If a candle explodes with massive volume from the SMA, ride it.
    const fromSMA = Math.abs(c1 - sma) / sma * 100 < 0.3; // started near SMA
    const momentumLong = c1 > parseFloat(prev[1]) && prevVol > avgVol * 3.0 && takerRatio > 1.5;
    const momentumShort = c1 < parseFloat(prev[1]) && prevVol > avgVol * 3.0 && takerRatio < 0.6;

    if (fromSMA && momentumLong) {
        return {
            shouldEnter: true,
            type: 'LONG',
            reason: '🚀 QUANTUM: Momentum Ignition (High Vol Burst)',
            takeProfitPerc: tp * 1.2, // Aim slightly higher on momentum
            stopLossPerc: sl
        };
    }

    if (fromSMA && momentumShort) {
        return {
            shouldEnter: true,
            type: 'SHORT',
            reason: '🚀 QUANTUM: Momentum Ignition (High Vol Burst)',
            takeProfitPerc: tp * 1.2,
            stopLossPerc: sl
        };
    }

    return { shouldEnter: false, type: 'LONG', reason: '', takeProfitPerc: 0, stopLossPerc: 0 };
  }
}
