
import { Trade, MarketMetrics, BotSettings, TradeType } from '../../types/trading.js';
import { FusionEngine } from './FusionEngine.js';

export enum ExitDecision {
  EXIT_NOW = 'EXIT_NOW',
  CONTINUE = 'CONTINUE',
  TRAIL_TIGHT = 'TRAIL_TIGHT',
  HOLD_FOR_MOON = 'HOLD_FOR_MOON'
}

export class AdaptiveCascadeEngine {
  
  /**
   * The Central Decision Engine for adaptive exits.
   * Instead of a binary "Exit/Stay", it runs a tree-based evaluation.
   */
  public static evaluate(
    trade: Trade, 
    metrics: MarketMetrics, 
    klines: any[], 
    settings: BotSettings
  ): { decision: ExitDecision; reason: string; score: number } {
    
    // Default weights and aggression
    const aggression = settings.exitAdaptiveAggression ?? 0.8;
    const mode = settings.exitValidationMode ?? 'ADAPTIVE_CASCADE';

    // 1. Quantum Reversion Check (صلاحية الانعكاس)
    const quantum = this.checkQuantumReversion(trade, metrics, klines);
    
    // 2. Fusion Check (تدفق السيولة الحقيقي)
    const fusion = this.checkFusion(trade, metrics, settings);
    
    // 3. Momentum Check (التحول الزخمي)
    const momentum = this.checkMomentum(trade, metrics, klines);

    // Decision Logic based on Mode
    switch (mode) {
      case 'QUANTUM_ONLY':
        return quantum.isValid ? { decision: ExitDecision.CONTINUE, reason: 'Quantum Reversion Still Valid', score: quantum.score } 
                               : { decision: ExitDecision.EXIT_NOW, reason: 'Quantum Reversion Exhausted', score: 0 };
      
      case 'FUSION_PRIORITY':
        if (fusion.score > 60) return { decision: ExitDecision.CONTINUE, reason: 'Strong Fusion Flow', score: fusion.score };
        return { decision: ExitDecision.EXIT_NOW, reason: 'Weak Fusion Flow', score: 0 };

      case 'MOMENTUM_ASSISTED':
        if (momentum.isStrong) return { decision: ExitDecision.HOLD_FOR_MOON, reason: 'Momentum Expansion Active', score: 100 };
        return { decision: ExitDecision.EXIT_NOW, reason: 'No Momentum Support', score: 0 };

      case 'FULL_CONSENSUS':
        if (quantum.isValid && fusion.score > 50 && momentum.isStrong) return { decision: ExitDecision.CONTINUE, reason: 'Full Consensus Reached', score: 100 };
        return { decision: ExitDecision.EXIT_NOW, reason: 'Consensus Missing', score: 0 };

      case 'ADAPTIVE_CASCADE':
      default:
        return this.runAdaptiveCascade(quantum, fusion, momentum, aggression, trade);
    }
  }

  /**
   * Stage 1: Quantum Reversion Check
   * هل سبب الدخول الأصلي ما زال قائمًا؟
   */
  private static checkQuantumReversion(trade: Trade, metrics: MarketMetrics, klines: any[]) {
    // Check if price returned to mean (SMA 20) or Bollinger Mid
    // For simplicity, we check if Taker Ratio returned to 1.0 (Neutral)
    const taker = metrics.takerRatio ?? 1.0;
    const isReverted = trade.type === 'LONG' ? taker < 1.01 : taker > 0.99;
    
    // Check RSI extreme
    const rsi = metrics.rsi;
    const isRsiNeutral = trade.type === 'LONG' ? rsi > 45 : rsi < 55;

    const score = (isReverted ? 0 : 50) + (isRsiNeutral ? 0 : 50);
    return {
      isValid: score > 30,
      score
    };
  }

  /**
   * Stage 2: Fusion Check
   * هل السوق ما زال يدعم استمرار الحركة؟ (OI, Volume, Funding)
   */
  private static checkFusion(trade: Trade, metrics: MarketMetrics, settings: BotSettings) {
    const fusion = FusionEngine.calculateFusionScore(metrics, settings);
    return {
      score: fusion.score,
      reason: fusion.reason
    };
  }

  /**
   * Stage 3: Momentum Check
   * هل السوق دخل حالة Expansion وانفجار سعري؟
   */
  private static checkMomentum(trade: Trade, metrics: MarketMetrics, klines: any[]) {
    if (klines.length < 5) return { isStrong: false, score: 0 };
    
    // Check for volume spike (Current V > 1.5x Avg)
    const recentVols = klines.slice(-10).map(k => parseFloat(k[5]));
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
    const currentVol = metrics.volume;
    const volSpike = currentVol > avgVol * 1.5;

    // Check for expansion (Current candle Body > 2x Avg body)
    const bodies = klines.slice(-10).map(k => Math.abs(parseFloat(k[4]) - parseFloat(k[1])));
    const avgBody = bodies.reduce((a, b) => a + b, 0) / bodies.length;
    const currentBody = Math.abs(parseFloat(klines[klines.length-1][4]) - parseFloat(klines[klines.length-1][1]));
    const expansion = currentBody > avgBody * 1.8;

    const isStrong = volSpike && expansion;
    return {
      isStrong,
      score: isStrong ? 100 : (volSpike || expansion ? 50 : 0)
    };
  }

  /**
   * The Advanced Cascade Logic (Tree-based)
   */
  private static runAdaptiveCascade(
    quantum: any, 
    fusion: any, 
    momentum: any, 
    aggression: number,
    trade: Trade
  ): { decision: ExitDecision; reason: string; score: number } {
    
    // Case 1: Quantum edge GONE, but Fusion & Momentum are STRONG
    // التحول من ارتداد إلى تريند حقيقي
    if (!quantum.isValid && fusion.score > 70 && momentum.isStrong) {
      return { 
        decision: ExitDecision.HOLD_FOR_MOON, 
        reason: '🔄 TRANSITION: Reversion ended but Trend Expansion confirmed by Fusion & Momentum.', 
        score: 95 
      };
    }

    // Case 2: Everything against you
    if (!quantum.isValid && fusion.score < 40 && !momentum.isStrong) {
      return { 
        decision: ExitDecision.EXIT_NOW, 
        reason: '❌ TOTAL EXHAUSTION: All engines signaling weakness.', 
        score: 0 
      };
    }

    // Case 3: Mixed signals - Quantum gone, Fusion OK, but Momentum weak
    if (!quantum.isValid && fusion.score > 50 && !momentum.isStrong) {
      return { 
        decision: ExitDecision.TRAIL_TIGHT, 
        reason: '⚠️ UNCERTAINTY: Fusion exists but Momentum stalling. Tightening Trailing Stop.', 
        score: 50 
      };
    }

    // Case 4: Strong Growth - Everything is favorable
    if (fusion.score > 80 && momentum.isStrong) {
      return { 
        decision: ExitDecision.HOLD_FOR_MOON, 
        reason: '🔥 EXPLOSION: Absolute momentum/liquidity alignment. Letting profits run.', 
        score: 100 
      };
    }

    // Case 5: Default behavior based on Aggression
    const totalScore = (quantum.score * 0.2) + (fusion.score * 0.5) + (momentum.score * 0.3);
    const threshold = (1 - aggression) * 100; // If aggression is 0.8, threshold is 20.

    if (totalScore > threshold) {
      return { 
        decision: ExitDecision.CONTINUE, 
        reason: `✅ ADAPTIVE HOLD: Score (${totalScore.toFixed(0)}) above threshold (${threshold.toFixed(0)}).`, 
        score: totalScore 
      };
    }

    return { 
      decision: ExitDecision.EXIT_NOW, 
      reason: `📉 CASCADE EXIT: Cumulative score (${totalScore.toFixed(0)}) too low.`, 
      score: totalScore 
    };
  }
}
