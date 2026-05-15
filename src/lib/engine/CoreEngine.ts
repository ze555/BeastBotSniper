
import { RegimeEngine } from './RegimeEngine.js';
import { LiquidityEngine } from './LiquidityEngine.js';
import { BiasEngine } from './BiasEngine.js';
import { RiskEngine } from './RiskEngine.js';
import { PositionManager } from './PositionManager.js';
import { KillSwitch } from './KillSwitch.js';
import { WiseEntryEngine } from './WiseEntryEngine.js';
import { MarketMetrics, MarketRegime, TrapType, EngineDecision, GlobalContext, BotSettings } from '../../types/trading.js';

export class CoreEngine {
  private regime = new RegimeEngine();
  private liquidity = new LiquidityEngine();
  private bias = new BiasEngine();
  private risk = new RiskEngine();
  private manager = new PositionManager();
  private wiseEntry = new WiseEntryEngine();
  public killSwitch = new KillSwitch();

  /**
   * تشغيل الدورة الكاملة لقرار التداول
   */
  public process(metrics: MarketMetrics, klinesRow: any[], htfKlines: any[], settings?: BotSettings, global?: GlobalContext): EngineDecision {
    // 1. Kill Switch Check
    const safety = this.killSwitch.shouldPanic({ spread: metrics.spread, volatility: metrics.atrPerc }, { apiLag: 0 });
    
    // Update metrics with real calculations from fresh klines
    metrics.adx = RegimeEngine.calculateADX(klinesRow);
    metrics.rsi = RegimeEngine.calculateRSI(klinesRow);
    
    if (safety.panic) {
      return { regime: MarketRegime.VIOLENT_VOLATILITY, bias: 'NEUTRAL', trap: TrapType.NONE, confidence: 0, action: 'SLEEP', reason: `SAFETY_TRIGGERED: ${safety.reason}` };
    }

    // --- DECISION LAYERS ---

    // LAYER 1: Global Market Check (The Cloud Layer)
    let layer1Passed = true;
    if (settings?.layerGlobalContextEnabled && global) {
       if (global.marketSentiment === 'EXTREME_FEAR' && metrics.rvol < 3) {
          layer1Passed = false;
       }
    }

    // LAYER 2: Market Regime Analysis
    let layer2Passed = true;
    const regimeStatus = this.regime.analyze(metrics);
    if (settings?.layerRegimeEnabled) {
       const adxThreshold = settings?.strategyAdxThreshold ?? 25;
       if (metrics.adx < adxThreshold && regimeStatus.regime !== MarketRegime.TRAP_MODE) {
          layer2Passed = false;
       }
       if (regimeStatus.decision === 'SLEEP') {
          layer2Passed = false;
       }
    }

    // LAYER 3: Directional Bias Analysis
    let layer3Passed = true;
    const directionalBias = this.bias.getBias(htfKlines);
    if (settings?.layerBiasEnabled) {
       // Layer 3 doesn't block by default but informs the action
    }

    // LAYER 4: Liquidity & Trap Detection
    let layer4Passed = true;
    const trap = this.liquidity.detectTrap(metrics, klinesRow);
    if (settings?.layerLiquidityEnabled) {
       // Layer 4 is an opportunistic layer
    }

    // LAYER 5: Momentum / RVOL 
    let layer5Passed = true;
    if (settings?.layerMomentumEnabled) {
       const rvolThreshold = settings?.strategyRvolThreshold ?? 1.5;
       if (metrics.rvol < rvolThreshold) {
          layer5Passed = false;
       }
    }

    // LAYER 6: AI Confidence Gate
    let layer6Passed = true;
    // (Confidence check is applied at the end)

    // --- AGGREGATION & ATTACK LOGIC ---

    if (!layer1Passed) return { regime: MarketRegime.VIOLENT_VOLATILITY, bias: 'NEUTRAL', trap: TrapType.NONE, confidence: 0, action: 'SLEEP', reason: 'LAYER_1_CLOUD_REJECTION' };
    if (!layer2Passed) return { regime: MarketRegime.COMPRESSION, bias: 'NEUTRAL', trap: TrapType.NONE, confidence: 0, action: 'WAIT', reason: 'LAYER_2_REGIME_REJECTION' };
    if (!layer5Passed) return { regime: regimeStatus.regime, bias: 'NEUTRAL', trap: TrapType.NONE, confidence: 0, action: 'WAIT', reason: 'LAYER_5_MOMENTUM_REJECTION' };

    // 5. Logical Decision (The Attack Logic)
    let action: 'WAIT' | 'ATTACK' | 'SLEEP' = 'WAIT';
    let reason = 'WAITING_FOR_EDGE';
    let confidence = 0;

    // ATTACK SCANNING
    // Opportunity 1: Trap Detection
    const isTrapOpp = (trap === TrapType.LONG_TRAP && directionalBias === 'SHORT') || 
                      (trap === TrapType.SHORT_TRAP && directionalBias === 'LONG');
    
    if (isTrapOpp && (settings?.layerLiquidityEnabled || settings?.beastMode)) {
       action = 'ATTACK';
       reason = trap === TrapType.LONG_TRAP ? 'BULL_TRAP_COUNTER' : 'BEAR_TRAP_COUNTER';
       confidence = 0.95;
    } 
    // Opportunity 2: Trend Continuation
    else if (metrics.rvol > 2.0 && regimeStatus.regime === MarketRegime.TRENDING) {
       const isPriceAlign = (metrics.rsi > 55 && directionalBias === 'LONG') || (metrics.rsi < 45 && directionalBias === 'SHORT');
       if (isPriceAlign && (settings?.layerBiasEnabled || !settings?.layerBiasEnabled)) {
           action = 'ATTACK';
           reason = `TREND_CONTINUATION: RVOL ${metrics.rvol.toFixed(1)} + Bias ${directionalBias}`;
           confidence = 0.75;
       }
    }
    // Opportunity 3: Beast Strike
    else if (settings?.beastMode && metrics.rvol > 1.2) {
        action = 'ATTACK';
        reason = 'BEAST_MOMENTUM_STRIKE';
        confidence = 0.5;
    }
    // Opportunity 4: Wise Institutional Strike (SMC/Structure)
    else if (settings?.useWiseEntry) {
        const wiseResult = this.wiseEntry.analyze(klinesRow, metrics, directionalBias);
        if (wiseResult.shouldEnter) {
            action = 'ATTACK';
            reason = wiseResult.reason;
            confidence = wiseResult.confidence;
        }
    }

    // LAYER 6 Override: Apply minimum confidence threshold
    if (settings?.layerConfidenceEnabled && action === 'ATTACK') {
       const minConfidence = settings?.strategyMinConfidence ?? 0.6;
       if (confidence < minConfidence) {
          action = 'WAIT';
          reason = `CONFIDENCE_TOO_LOW: ${confidence} < ${minConfidence}`;
       }
    }

    return { regime: regimeStatus.regime, bias: directionalBias, trap, confidence, action, reason };
  }
}
