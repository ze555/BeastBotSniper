import { Trade, MarketMetrics, BotSettings } from '../../types/trading.js';
import { FusionEngine } from './FusionEngine.js';
import { AdaptiveExitEngine } from './AdaptiveExitEngine.js';

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
    const quantum = this.checkQuantumReversion(trade, metrics, klines, settings);
    
    // 2. Fusion Check (تدفق السيولة الحقيقي)
    const fusion = this.checkFusion(trade, metrics, settings);
    
    // 3. Momentum Check (التحول الزخمي)
    const momentum = this.checkMomentum(trade, metrics, klines);

    // 4. Advanced Microstructure Engine Extraction
    const micro = AdaptiveExitEngine.analyzeMicrostructure(trade, metrics, klines, settings);

    // Non-linear adjustments applied to the base Fusion & overall model score
    let adjustedFusionScore = Math.min(100, Math.max(0, fusion.score + micro.matrix.scoreAdjustment));
    
    // Adjust quantum validity if microstructure matrix suggests Trapped positions
    if (micro.matrix.bias === 'TRAPPED_LONGS' && trade.type === 'LONG') {
      quantum.isValid = false;
      quantum.score = Math.max(0, quantum.score - 40);
    }

    // Dynamic Regime Weighting overrides based on analyzed multi-regime scores
    let quantumWeight = 0.2;
    let fusionWeight = 0.5;
    let momentumWeight = 0.3;

    // Direct shift if CHOP or RANGE is dominating the current hybrid regime
    if (micro.regimes.chopScore > 65) {
      quantumWeight = 0.4;
      fusionWeight = 0.5;
      momentumWeight = 0.1; // ignore momentum indicators in a dead chop
    } else if (micro.regimes.trendScore > 65) {
      quantumWeight = 0.1;
      fusionWeight = 0.4;
      momentumWeight = 0.5; // elevate momentum weighting during actual trends
    }

    // Decision Logic based on Mode
    switch (mode) {
      case 'QUANTUM_ONLY':
        return quantum.isValid ? { decision: ExitDecision.CONTINUE, reason: 'Quantum Reversion Still Valid', score: quantum.score } 
                               : { decision: ExitDecision.EXIT_NOW, reason: 'Quantum Reversion Exhausted', score: 0 };
      
      case 'FUSION_PRIORITY':
        if (adjustedFusionScore > 60) return { decision: ExitDecision.CONTINUE, reason: `Strong Fusion Flow (${adjustedFusionScore.toFixed(0)})`, score: adjustedFusionScore };
        return { decision: ExitDecision.EXIT_NOW, reason: 'Weak Fusion Flow', score: 0 };

      case 'MOMENTUM_ASSISTED':
        if (momentum.isStrong) return { decision: ExitDecision.HOLD_FOR_MOON, reason: 'Momentum Expansion Active', score: 100 };
        return { decision: ExitDecision.EXIT_NOW, reason: 'No Momentum Support', score: 0 };

      case 'FULL_CONSENSUS':
        if (quantum.isValid && adjustedFusionScore > 50 && momentum.isStrong) return { decision: ExitDecision.CONTINUE, reason: 'Full Consensus Reached', score: 100 };
        return { decision: ExitDecision.EXIT_NOW, reason: 'Consensus Missing', score: 0 };

      case 'ADAPTIVE_CASCADE':
      default:
        // Pass enriched parameters into our cascade processor
        const evaluation = this.runAdaptiveCascade(
          quantum, 
          { ...fusion, score: adjustedFusionScore }, 
          momentum, 
          aggression, 
          trade,
          micro,
          { quantumWeight, fusionWeight, momentumWeight }
        );

        // --- Low-Liquidity/Vacuum Execution Slippage Safeguard ---
        // If the decision is EXIT_NOW, but expected slippage or vacuum score is extremely high:
        // We prevent the engine from executing bad market orders. Instead, we degrade to a TRAIL_TIGHT stop.
        if (evaluation.decision === ExitDecision.EXIT_NOW && micro.slippageRisk > 70) {
          return {
            decision: ExitDecision.TRAIL_TIGHT,
            reason: `⚠️ SLIPPAGE GUARD: Early Exit suggested but prevented due to low passive liquidity (${micro.slippageRisk.toFixed(0)}% Slippage Risk). Recommending Tight Trailing Stop instead. Detail: ${evaluation.reason}`,
            score: evaluation.score
          };
        }

        // --- Passive Absorption Guard ---
        // If there's high institutional limit buying absorbing aggressive sell volumes, avoid premature exit
        if (evaluation.decision === ExitDecision.EXIT_NOW && micro.matrix.bias === 'PASSIVE_ABSORPTION') {
          return {
            decision: ExitDecision.TRAIL_TIGHT,
            reason: `🛡️ ABSORPTION GUARD: Volume delta is bearish but price is holding. Icebergs detected. Tightening stop instead of immediate market exit.`,
            score: 40
          };
        }

        return evaluation;
    }
  }

  /**
   * Stage 1: Quantum Reversion Check
   * هل سبب الدخول الأصلي ما زال قائمًا؟
   */
  private static checkQuantumReversion(trade: Trade, metrics: MarketMetrics, klines: any[], settings: BotSettings) {
    // Check if price returned to mean (SMA 20) or Bollinger Mid
    // For simplicity, we check if Taker Ratio returned to 1.0 (Neutral)
    const taker = metrics.takerRatio ?? 1.0;
    const isReverted = trade.type === 'LONG' ? taker < 1.01 : taker > 0.99;
    
    // Check RSI extreme
    const rsi = metrics.rsi;
    const isRsiNeutral = settings.exitUseRsiCheck !== false
      ? (trade.type === 'LONG' ? rsi > 45 : rsi < 55)
      : false;

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
   * The Advanced Cascade Logic (Tree-based) with multi-microstructure metrics integration
   */
  private static runAdaptiveCascade(
    quantum: any, 
    fusion: any, 
    momentum: any, 
    aggression: number,
    trade: Trade,
    micro: any,
    weights: { quantumWeight: number; fusionWeight: number; momentumWeight: number }
  ): { decision: ExitDecision; reason: string; score: number } {
    
    // Case 1: Quantum edge GONE, but Fusion & Momentum are STRONG
    // التحول من ارتداد إلى تريند حقيقي
    if (!quantum.isValid && fusion.score > 70 && momentum.isStrong) {
      return { 
        decision: ExitDecision.HOLD_FOR_MOON, 
        reason: `🔄 TRANSITION: Reversion ended but trend expansion confirmed by Fusion & Momentum. [${micro.matrix.reason}]`, 
        score: 95 
      };
    }

    // Case 2: Everything against you
    if (!quantum.isValid && fusion.score < 40 && !momentum.isStrong) {
      return { 
        decision: ExitDecision.EXIT_NOW, 
        reason: `❌ TOTAL EXHAUSTION: All engines signalling extreme weakness. [${micro.matrix.reason}]`, 
        score: 0 
      };
    }

    // Case 3: Mixed signals - Quantum gone, Fusion OK, but Momentum weak
    if (!quantum.isValid && fusion.score > 50 && !momentum.isStrong) {
      return { 
        decision: ExitDecision.TRAIL_TIGHT, 
        reason: `⚠️ UNCERTAINTY: Flows exist but momentum stalled. [${micro.matrix.reason}]`, 
        score: 50 
      };
    }

    // Case 4: Strong Growth - Everything is favorable
    if (fusion.score > 80 && momentum.isStrong) {
      return { 
        decision: ExitDecision.HOLD_FOR_MOON, 
        reason: `🔥 MOMENTUM EXPLOSION: Absolute alignment across volumetric engines. [${micro.matrix.reason}]`, 
        score: 100 
      };
    }

    // Case 5: Default behavior based on Aggression & Weighted Microstructure variables
    let rawTotalScore = (quantum.score * weights.quantumWeight) + 
                        (fusion.score * weights.fusionWeight) + 
                        (momentum.score * weights.momentumWeight);
    
    // Apply dynamic Stagnation Time Decay penalty directly to the total score of stagnant positions
    rawTotalScore = Math.max(0, rawTotalScore - micro.timeDecayPenalty);

    const threshold = (1 - aggression) * 100; // If aggression is 0.8, threshold is 20.

    if (rawTotalScore > threshold) {
      return { 
        decision: ExitDecision.CONTINUE, 
        reason: `✅ ADAPTIVE HOLD: Cumulative score (${rawTotalScore.toFixed(0)}) above threshold (${threshold.toFixed(0)}). Stagnation Penalty: -${micro.timeDecayPenalty.toFixed(0)}`, 
        score: rawTotalScore 
      };
    }

    return { 
      decision: ExitDecision.EXIT_NOW, 
      reason: `📉 CASCADE EXIT: Cumulative score (${rawTotalScore.toFixed(0)}) fell below exit filter (${threshold.toFixed(0)}). [${micro.matrix.reason}]`, 
      score: rawTotalScore 
    };
  }
}
