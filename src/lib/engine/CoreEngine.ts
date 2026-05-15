
import { RegimeEngine } from './RegimeEngine.js';
import { LiquidityEngine } from './LiquidityEngine.js';
import { BiasEngine } from './BiasEngine.js';
import { RiskEngine } from './RiskEngine.js';
import { PositionManager } from './PositionManager.js';
import { KillSwitch } from './KillSwitch.js';
import { WiseEntryEngine } from './WiseEntryEngine.js';
import { SlyFoxEngine } from './SlyFoxEngine.js';
import { MarketMetrics, MarketRegime, TrapType, EngineDecision, GlobalContext, BotSettings } from '../../types/trading.js';

export class CoreEngine {
  private regime = new RegimeEngine();
  private liquidity = new LiquidityEngine();
  private bias = new BiasEngine();
  private risk = new RiskEngine();
  private manager = new PositionManager();
  private wiseEntry = new WiseEntryEngine();
  private slyFox = new SlyFoxEngine();
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

    // SLX FOX Regime detection override
    let currentRegimeMode = 'TREND';
    if (settings?.useSlyFox) {
        currentRegimeMode = this.slyFox.detectMode(klinesRow, metrics);
        if (currentRegimeMode === 'RANGE') {
            console.log(`[🦊 SLY FOX] Range Mode Detected for ${metrics.symbol} (ADX: ${metrics.adx.toFixed(1)})`);
        }
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
    let regimeStatus = this.regime.analyze(metrics);
    
    // Override Regime if Sly Fox detects Range strongly
    if (settings?.useSlyFox && currentRegimeMode === 'RANGE') {
       regimeStatus.regime = MarketRegime.COMPRESSION;
       regimeStatus.decision = 'WAIT'; 
       // We set decision to WAIT for trending systems, but SlyFox will trade it
    }

    if (settings?.layerRegimeEnabled && !settings?.useSlyFox) {
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

    // LAYER 4: Liquidity & Trap Detection
    let layer4Passed = true;
    const trap = this.liquidity.detectTrap(metrics, klinesRow);

    // LAYER 5: Momentum / RVOL
    let layer5Passed = true;
    if (settings?.layerMomentumEnabled && !settings?.useSlyFox) {
       // Momentum checks are disabled during Sly Fox (Mean Reversion) because we hunt low volume
       const rvolThreshold = settings?.strategyRvolThreshold ?? 1.5;
       if (metrics.rvol < rvolThreshold) {
          layer5Passed = false;
       }
    }

    // --- AGGREGATION & ATTACK LOGIC ---

    if (!layer1Passed) return { regime: MarketRegime.VIOLENT_VOLATILITY, bias: 'NEUTRAL', trap: TrapType.NONE, confidence: 0, action: 'SLEEP', reason: 'LAYER_1_CLOUD_REJECTION' };
    
    // If not using SlyFox, and regime/momentum rejected
    if (!settings?.useSlyFox) {
        if (!layer2Passed) return { regime: MarketRegime.COMPRESSION, bias: 'NEUTRAL', trap: TrapType.NONE, confidence: 0, action: 'WAIT', reason: 'LAYER_2_REGIME_REJECTION' };
        if (!layer5Passed) return { regime: regimeStatus.regime, bias: 'NEUTRAL', trap: TrapType.NONE, confidence: 0, action: 'WAIT', reason: 'LAYER_5_MOMENTUM_REJECTION' };
    }

    // 5. Logical Decision (The Attack Logic)
    let action: 'WAIT' | 'ATTACK' | 'SLEEP' = 'WAIT';
    let reason = 'WAITING_FOR_EDGE';
    let confidence = 0;

    // ATTACK SCANNING
    // Opportunity 1: Sly Fox (Mean Reversion in Range)
    if (settings?.useSlyFox && currentRegimeMode === 'RANGE') {
        const foxResult = this.slyFox.analyze(klinesRow, metrics);
        if (foxResult.shouldEnter) {
            action = 'ATTACK';
            reason = foxResult.reason;
            confidence = foxResult.confidence;
            return { regime: MarketRegime.COMPRESSION, bias: foxResult.type, trap, confidence, action, reason };
        } else {
            // Nothing found in range, just wait
            return { regime: MarketRegime.COMPRESSION, bias: 'NEUTRAL', trap, confidence: 0, action: 'WAIT', reason: 'WAITING_FOR_RANGE_EDGE' };
        }
    }

    // Opportunity 2: Trap Detection (for non-SlyFox mode)
    const isTrapOpp = (trap === TrapType.LONG_TRAP && directionalBias === 'SHORT') || 
                      (trap === TrapType.SHORT_TRAP && directionalBias === 'LONG');
    
    if (isTrapOpp && (settings?.layerLiquidityEnabled || settings?.beastMode)) {
       action = 'ATTACK';
       reason = trap === TrapType.LONG_TRAP ? 'BULL_TRAP_COUNTER' : 'BEAR_TRAP_COUNTER';
       confidence = 0.95;
    } 
    // Opportunity 3: Trend Continuation
    else if (metrics.rvol > 2.0 && regimeStatus.regime === MarketRegime.TRENDING) {
       const isPriceAlign = (metrics.rsi > 55 && directionalBias === 'LONG') || (metrics.rsi < 45 && directionalBias === 'SHORT');
       if (isPriceAlign && (settings?.layerBiasEnabled || !settings?.layerBiasEnabled)) {
           action = 'ATTACK';
           reason = `TREND_CONTINUATION: RVOL ${metrics.rvol.toFixed(1)} + Bias ${directionalBias}`;
           confidence = 0.75;
       }
    }
    // Opportunity 4: Beast Strike (Aggressive Momentum)
    else if (settings?.beastMode) {
        const minRvol = settings.beastMinRvol ?? 1.2;
        const rvolPass = settings.beastConfirmWithVolume ? metrics.rvol >= minRvol : metrics.rvol >= 1.2;
        
        let smcPass = true;
        let beastIntention: 'LONG' | 'SHORT' = metrics.rsi > 50 ? 'LONG' : 'SHORT'; // Fast fallback

        if (settings.beastConfirmWithSMC) {
            const smc = this.wiseEntry.getSMCPressure(klinesRow);
            const threshold = settings.beastInstitutionalStrength ?? 0.4;
            
            if (smc.longPressure >= threshold) {
                beastIntention = 'LONG';
                smcPass = true;
            } else if (smc.shortPressure >= threshold) {
                beastIntention = 'SHORT';
                smcPass = true;
            } else {
                smcPass = false;
            }
        }

        if (rvolPass && smcPass) {
            action = 'ATTACK';
            reason = `BEAST_STRIKE: Institutional ${beastIntention} Momentum (RVOL:${metrics.rvol.toFixed(1)})`;
            confidence = 0.6; 
            return { regime: MarketRegime.MOMENTUM_MODE, bias: beastIntention, trap, confidence, action, reason };
        }
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
