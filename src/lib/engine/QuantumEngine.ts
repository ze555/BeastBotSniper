import { TradeType } from '../../types/trading.js';

export class QuantumEngine {
  /**
   * Universal Quantum Engine
   * Adapts to either Rapid Scalping (1m) or Long-Term Institutional (15m/1h)
   */
  public analyze(klines: any[], takerRatio: number, settings?: any): { shouldEnter: boolean; type: TradeType; reason: string; takeProfitPerc: number; stopLossPerc: number } {
    const isLongTerm = settings?.isLongTerm || false;
    
    if (klines.length < 51) return { shouldEnter: false, type: 'LONG', reason: '', takeProfitPerc: 0, stopLossPerc: 0 };

    const last = klines[klines.length - 1]; // current open candle
    const prev = klines[klines.length - 2]; // last closed candle

    const c0 = parseFloat(last[4]);
    const o0 = parseFloat(last[1]);
    
    const c1 = parseFloat(prev[4]);
    const h1 = parseFloat(prev[2]);
    const l1 = parseFloat(prev[3]);

    // 1. Calculate Bollinger Bands 
    const defaultMAPeriod = isLongTerm ? 40 : 20; 
    const MAPeriod = settings?.quantumBbPeriod || defaultMAPeriod;
    const multiplier = settings?.quantumBbMultiplier || (isLongTerm ? 2.2 : 2.0); // Slightly wider and more period for institutional stability
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
    
    // Safety check
    if (bbWidthPerc < 0.05 || bbWidthPerc > 20.0) {
        return { shouldEnter: false, type: 'LONG', reason: '', takeProfitPerc: 0, stopLossPerc: 0 };
    }

    // --- QUANTUM TARGET MAPPING ---
    // If long term, we want 5x to 10x larger targets
    const volFactor = bbWidthPerc * 0.6;
    let tp, sl;

    if (isLongTerm) {
        // Institutional Targets (3% to 15%)
        tp = Math.max(3.0, Math.min(volFactor * 3, 15.0));
        sl = tp * 0.5; // Stronger risk/reward for long term
    } else {
        // Scalp Targets (0.25% to 2.5%)
        tp = Math.max(0.25, Math.min(volFactor, 2.5)); 
        sl = Math.max(0.15, tp * 0.82); 
    }

    // 2. Compute Volume Average (last 10 closed candles)
    let sumVol = 0;
    for (let i = klines.length - 11; i < klines.length - 1; i++) {
         sumVol += parseFloat(klines[i][5]);
    }
    const avgVol = sumVol / 10;
    const currentVol = parseFloat(last[5]);
    const prevVol = parseFloat(prev[5]);

    // Taker Pressure Thresholds
    const takerLongThresh = settings?.quantumTakerLongThresh || 1.01;
    const takerShortThresh = settings?.quantumTakerShortThresh || 0.99;
    const momLongThresh = settings?.quantumMomentumLongThresh || 1.15;
    const momShortThresh = settings?.quantumMomentumShortThresh || 0.85;

    // Taker Pressure
    const takerLongPass = takerRatio === 1.0 || takerRatio > (settings?.quantumBeastMode ? (takerLongThresh - (settings.quantumBeastAggression ? (settings.quantumBeastAggression - 1) * 0.1 : 0.05)) : takerLongThresh);
    const takerShortPass = takerRatio === 1.0 || takerRatio < (settings?.quantumBeastMode ? (takerShortThresh + (settings.quantumBeastAggression ? (settings.quantumBeastAggression - 1) * 0.1 : 0.05)) : takerShortThresh);

    // Wise Entry Logic: Requires stronger confirmation
    const wiseEntryLong = (settings?.quantumWiseEntry) ? (takerRatio > (settings.quantumWiseEntryThreshold || 1.05) && currentVol > avgVol * 1.5) : true;
    const wiseEntryShort = (settings?.quantumWiseEntry) ? (takerRatio < (2 - (settings.quantumWiseEntryThreshold || 1.05)) && currentVol > avgVol * 1.5) : true;

    // Smart Exit Targets: Dynamic mapping for intelligent management
    const beastTpIncr = settings?.quantumBeastMode ? (settings.quantumBeastAggression || 1.5) : 1.0;
    const smartTpDecr = settings?.quantumSmartExit ? (settings.quantumSmartExitAggression || 0.9) : 1.0;
    
    const tpScale = (settings?.quantumTpScale || 1.0) * smartTpDecr * beastTpIncr;
    const slScale = (settings?.quantumSlScale || 1.0) * (settings?.quantumSmartExit ? 0.7 : 1.0) * (settings?.quantumBeastMode ? 1.2 : 1.0);

    // ----------------------------------------------------
    // SYSTEM 1: QUANTUM REVERSION
    // ----------------------------------------------------
    const useReversion = settings?.quantumUseReversion ?? true;
    const pierceLower = c1 < lowerBB || l1 < lowerBB;
    const pierceUpper = c1 > upperBB || h1 > upperBB;

    if (useReversion && pierceLower && prevVol > avgVol * (settings?.quantumBeastMode ? volThresh * 0.7 : volThresh) && takerLongPass && wiseEntryLong && c0 > o0) {
        return {
            shouldEnter: true,
            type: 'LONG',
            reason: `⚡ QUANTUM_${isLongTerm ? 'INST' : 'SCALP'}: Reversion${settings?.quantumBeastMode ? ' [BEAST]' : ''}`,
            takeProfitPerc: tp * tpScale,
            stopLossPerc: sl * slScale
        };
    }

    if (useReversion && pierceUpper && prevVol > avgVol * (settings?.quantumBeastMode ? volThresh * 0.7 : volThresh) && takerShortPass && wiseEntryShort && c0 < o0) {
        return {
            shouldEnter: true,
            type: 'SHORT',
            reason: `⚡ QUANTUM_${isLongTerm ? 'INST' : 'SCALP'}: Reversion${settings?.quantumBeastMode ? ' [BEAST]' : ''}`,
            takeProfitPerc: tp * tpScale,
            stopLossPerc: sl * slScale
        };
    }

    // ----------------------------------------------------
    // SYSTEM 2: QUANTUM MOMENTUM
    // ----------------------------------------------------
    const useMomentum = settings?.quantumUseMomentum ?? true;
    const momentumLong = c1 > parseFloat(prev[1]) && prevVol > avgVol * (settings?.quantumBeastMode ? momentumVol * 0.7 : momentumVol) && (takerRatio === 1.0 || takerRatio > (settings?.quantumBeastMode ? momLongThresh - 0.1 : momLongThresh));
    const momentumShort = c1 < parseFloat(prev[1]) && prevVol > avgVol * (settings?.quantumBeastMode ? momentumVol * 0.7 : momentumVol) && (takerRatio === 1.0 || takerRatio < (settings?.quantumBeastMode ? momShortThresh + 0.1 : momShortThresh));

    if (useMomentum && momentumLong && wiseEntryLong && c0 > o0) {
        return {
            shouldEnter: true,
            type: 'LONG',
            reason: `🚀 QUANTUM_${isLongTerm ? 'INST' : 'SCALP'}: Momentum${settings?.quantumBeastMode ? ' [BEAST]' : ''}`,
            takeProfitPerc: tp * 1.1 * tpScale, 
            stopLossPerc: sl * slScale
        };
    }

    if (useMomentum && momentumShort && wiseEntryShort && c0 < o0) {
        return {
            shouldEnter: true,
            type: 'SHORT',
            reason: `🚀 QUANTUM_${isLongTerm ? 'INST' : 'SCALP'}: Momentum${settings?.quantumBeastMode ? ' [BEAST]' : ''}`,
            takeProfitPerc: tp * 1.1 * tpScale,
            stopLossPerc: sl * slScale
        };
    }

    return { shouldEnter: false, type: 'LONG', reason: '', takeProfitPerc: 0, stopLossPerc: 0 };
  }
}

