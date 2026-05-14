
import { RegimeEngine } from './RegimeEngine.js';
import { LiquidityEngine } from './LiquidityEngine.js';
import { BiasEngine } from './BiasEngine.js';
import { RiskEngine } from './RiskEngine.js';
import { PositionManager } from './PositionManager.js';
import { KillSwitch } from './KillSwitch.js';
import { MarketMetrics, MarketRegime, TrapType, EngineDecision, GlobalContext, BotSettings } from '../../types/trading.js';

export class CoreEngine {
  private regime = new RegimeEngine();
  private liquidity = new LiquidityEngine();
  private bias = new BiasEngine();
  private risk = new RiskEngine();
  private manager = new PositionManager();
  public killSwitch = new KillSwitch();

  /**
   * تشغيل الدورة الكاملة لقرار التداول
   */
  public process(metrics: MarketMetrics, klinesRow: any[], htfKlines: any[], settings?: BotSettings, global?: GlobalContext): EngineDecision {
    // 1. Kill Switch Check
    const safety = this.killSwitch.shouldPanic({ spread: metrics.spread, volatility: metrics.atrPerc }, { apiLag: 0 });
    
    // Update metrics with real calculations
    metrics.adx = RegimeEngine.calculateADX(klinesRow);
    
    if (safety.panic) {
      return { regime: MarketRegime.VIOLENT_VOLATILITY, bias: 'NEUTRAL', trap: TrapType.NONE, confidence: 0, action: 'SLEEP', reason: `SAFETY_TRIGGERED: ${safety.reason}` };
    }

    // 2. Global Market Check (The Cloud Layer)
    if (global && global.marketSentiment === 'EXTREME_FEAR' && metrics.rvol < 3) {
       // Risk avoidance during massive market panic unless liquidity is very high
       return { regime: MarketRegime.VIOLENT_VOLATILITY, bias: 'NEUTRAL', trap: TrapType.NONE, confidence: 0, action: 'SLEEP', reason: 'MARKET_WIDE_PANIC_PROTECTION' };
    }

    // 2. Market Regime Analysis
    const regimeStatus = this.regime.analyze(metrics);
    
    // Custom ADX Override from Strategy Builder
    if (settings?.useStrategyTrendFilter) {
      const adxThreshold = settings?.strategyAdxThreshold ?? 25;
      if (metrics.adx < adxThreshold && regimeStatus.regime !== MarketRegime.TRAP_MODE) {
         return { regime: MarketRegime.COMPRESSION, bias: 'NEUTRAL', trap: TrapType.NONE, confidence: 0, action: 'WAIT', reason: `ADX_BELOW_THRESHOLD: ${metrics.adx.toFixed(1)} < ${adxThreshold}` };
      }
    }

    // RVOL (Momentum) Rule from Strategy Builder
    if (settings?.useStrategyMomentumRule) {
       const rvolThreshold = settings?.strategyRvolThreshold ?? 1.5;
       if (metrics.rvol < rvolThreshold) {
          return { regime: regimeStatus.regime, bias: 'NEUTRAL', trap: TrapType.NONE, confidence: 0, action: 'WAIT', reason: `MOMENTUM_LOW: RVOL ${metrics.rvol.toFixed(1)} < ${rvolThreshold}` };
       }
    }

    if (regimeStatus.decision === 'SLEEP') {
      return { regime: regimeStatus.regime, bias: 'NEUTRAL', trap: TrapType.NONE, confidence: 0, action: 'SLEEP', reason: 'MARKET_DEAD_OR_CHOP' };
    }

    // 3. Directional Bias Analysis
    const directionalBias = this.bias.getBias(htfKlines);

    // 4. Liquidity & Trap Detection
    const trap = this.liquidity.detectTrap(metrics, klinesRow);

    // 5. Logical Decision (The Attack Logic)
    let action: 'WAIT' | 'ATTACK' | 'SLEEP' = 'WAIT';
    let reason = 'WAITING_FOR_EDGE';
    let confidence = 0;

    // --- DECISION LAYERS ---

    // LAYER 1: Trap Detection (High Confidence Counter-Strike)
    if (trap === TrapType.LONG_TRAP && directionalBias === 'SHORT') {
       action = 'ATTACK';
       reason = 'BULL_TRAP_DETECTED_IN_BEAR_TREND';
       confidence = 0.95;
    } else if (trap === TrapType.SHORT_TRAP && directionalBias === 'LONG') {
       action = 'ATTACK';
       reason = 'BEAR_TRAP_DETECTED_IN_BULL_TREND';
       confidence = 0.95;
    } 
    // LAYER 2: Trend Continuation (Standard Sniper Move)
    else if (metrics.rvol > 2.0 && regimeStatus.regime === MarketRegime.TRENDING) {
       const isPriceAlign = (metrics.rsi > 55 && directionalBias === 'LONG') || (metrics.rsi < 45 && directionalBias === 'SHORT');
       if (isPriceAlign) {
           action = 'ATTACK';
           reason = `TREND_CONTINUATION: RVOL ${metrics.rvol.toFixed(1)} + Bias ${directionalBias}`;
           confidence = 0.75;
       }
    }
    // LAYER 3: Range Reversion (The "Chop" Slayer)
    else if (regimeStatus.regime === MarketRegime.COMPRESSION || metrics.isChop) {
        if (metrics.rsi > 70) {
            action = 'ATTACK';
            reason = 'RANGE_OVERBOUGHT_REVERSION';
            confidence = 0.65;
        } else if (metrics.rsi < 30) {
            action = 'ATTACK';
            reason = 'RANGE_OVERSOLD_REVERSION';
            confidence = 0.65;
        }
    }
    // LAYER 4: Beast Mode Pure Momentum
    else if (settings?.beastMode && metrics.rvol > 1.2) {
        action = 'ATTACK';
        reason = 'BEAST_MOMENTUM_STRIKE';
        confidence = 0.5;
    }

    // Apply minimum confidence threshold from Strategy Builder
    if (settings?.useStrategyConfidenceGate) {
       const minConfidence = settings?.strategyMinConfidence ?? 0.6;
       if (action === 'ATTACK' && confidence < minConfidence) {
          action = 'WAIT';
          reason = `CONFIDENCE_TOO_LOW: ${confidence} < ${minConfidence}`;
       }
    }

    return { regime: regimeStatus.regime, bias: directionalBias, trap, confidence, action, reason };
  }
}
