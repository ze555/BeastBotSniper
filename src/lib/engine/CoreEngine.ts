
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

    // --- EVALUATE CUSTOM TAWLEEFA ENGINE IF ENABLED ---
    if (settings?.useTawleefaEngine) {
      if (settings?.activeTawleefaJson) {
        try {
          const tawleefa = JSON.parse(settings.activeTawleefaJson);
          if (tawleefa) {
            const currentRegimeName = regimeStatus.regime;
            let activeConfig = tawleefa;
            let usingProfile = false;

            if (Array.isArray(tawleefa.dynamicRegimeProfiles) && tawleefa.dynamicRegimeProfiles.length > 0) {
              const matchedProfile = tawleefa.dynamicRegimeProfiles.find((p: any) => p.regime === currentRegimeName);
              if (matchedProfile) {
                activeConfig = matchedProfile;
                usingProfile = true;
                console.log(`[⭐ TAWLEEFA ENGINE] Dynamically switched to regime profile: ${currentRegimeName} for ${metrics.symbol}`);
              }
            }

            if (activeConfig && (
              (activeConfig.action === 'DUAL' && ((activeConfig.longConditions && activeConfig.longConditions.length > 0) || (activeConfig.shortConditions && activeConfig.shortConditions.length > 0))) ||
              (Array.isArray(activeConfig.conditions) && activeConfig.conditions.length > 0)
            )) {
              const evaluateConditionsDetailed = (conditionsList: any[], metricsObj: MarketMetrics) => {
                return conditionsList.map((cond: any) => {
                  let actualVal = 0;
                  switch (cond.metric) {
                    case 'PRICE': actualVal = metricsObj.price; break;
                    case 'OPEN_INTEREST': actualVal = cond.operator === 'SPIKE' ? (metricsObj.oiChange ?? 0) : (metricsObj.openInterest ?? 0); break;
                    case 'CVD': actualVal = metricsObj.takerRatio ?? 1; break; // Live CVD helper
                    case 'RVOL': actualVal = metricsObj.rvol; break;
                    case 'TAKER_RATIO': actualVal = metricsObj.takerRatio ?? 1.0; break;
                    case 'FUNDING_RATE': actualVal = metricsObj.fundingRate ?? 0; break;
                    case 'RSI': actualVal = metricsObj.rsi; break;
                    case 'ADX': actualVal = metricsObj.adx; break;
                    case 'EMA50_TREND': actualVal = metricsObj.ema50 ? (metricsObj.price > metricsObj.ema50 ? 1 : -1) : 0; break;
                    default: actualVal = metricsObj.price;
                  }

                  let isTrue = false;
                  if (cond.operator === 'GREATER_THAN') {
                    isTrue = actualVal > cond.valueNumber;
                  } else if (cond.operator === 'LESS_THAN') {
                    isTrue = actualVal < cond.valueNumber;
                  } else if (cond.operator === 'CROSSES_ABOVE') {
                    if (cond.metric === 'ADX') {
                      isTrue = actualVal >= cond.valueNumber && (metricsObj.isAdxRising !== false);
                    } else {
                      isTrue = actualVal >= cond.valueNumber;
                    }
                  } else if (cond.operator === 'CROSSES_BELOW') {
                    isTrue = actualVal <= cond.valueNumber;
                  } else if (cond.operator === 'SPIKE') {
                    if (cond.metric === 'OPEN_INTEREST') {
                      isTrue = (metricsObj.oiChange !== undefined && Math.abs(metricsObj.oiChange) >= cond.valueNumber);
                    } else if (cond.metric === 'RVOL') {
                      isTrue = metricsObj.rvol >= cond.valueNumber;
                    } else {
                      isTrue = actualVal >= cond.valueNumber;
                    }
                  } else if (cond.operator === 'DIVERGENCING') {
                    isTrue = (metricsObj.takerRatio !== undefined && ((metricsObj.takerRatio > 1.2 && metricsObj.rsi < 45) || (metricsObj.takerRatio < 0.8 && metricsObj.rsi > 55)));
                  } else if (cond.operator === 'SWEEP_LOW_HIGH' || cond.operator === 'EXHAUSTION') {
                    isTrue = metricsObj.rsi > 70 || metricsObj.rsi < 30;
                  } else if (cond.operator === 'EXPECT_LONG') {
                    isTrue = actualVal > 0;
                  } else if (cond.operator === 'EXPECT_SHORT') {
                    isTrue = actualVal < 0;
                  } else if (cond.operator === 'IS_RISING') {
                    if (cond.metric === 'ADX') isTrue = metricsObj.isAdxRising === true;
                    else if (cond.metric === 'OPEN_INTEREST') isTrue = (metricsObj.oiChange !== undefined && metricsObj.oiChange > 0.05);
                    else if (cond.metric === 'RVOL') isTrue = metricsObj.rvol > 1.05;
                    else isTrue = false; 
                  } else if (cond.operator === 'IS_FALLING') {
                    if (cond.metric === 'ADX') isTrue = metricsObj.isAdxRising === false;
                    else if (cond.metric === 'OPEN_INTEREST') isTrue = (metricsObj.oiChange !== undefined && metricsObj.oiChange < -0.05);
                    else if (cond.metric === 'RVOL') isTrue = metricsObj.rvol < 0.95;
                    else isTrue = false;
                  } else {
                    isTrue = actualVal > cond.valueNumber;
                  }
                  
                  return {
                    metric: cond.metric,
                    operator: cond.operator,
                    threshold: cond.valueNumber,
                    actualValue: actualVal,
                    isMet: isTrue
                  };
                });
              };

              let botBias: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
              let detailedConditions: any[] = [];
              let triggerSignal = false;
              let activeGateRaw = activeConfig.gate || 'AND';
              let activeGate = typeof activeGateRaw === 'string' ? activeGateRaw.trim().toUpperCase() : 'AND';

              const isDualMode = activeConfig.action === 'DUAL';
              let completedLong = 0;
              let totalLong = 0;
              let completedShort = 0;
              let totalShort = 0;

              if (isDualMode) {
                const longConds = activeConfig.longConditions || [];
                const shortConds = activeConfig.shortConditions || [];

                const detailedLong = evaluateConditionsDetailed(longConds, metrics).map(c => ({...c, metric: `LONG: ${c.metric}`}));
                const detailedShort = evaluateConditionsDetailed(shortConds, metrics).map(c => ({...c, metric: `SHORT: ${c.metric}`}));

                completedLong = detailedLong.filter(c => c.isMet).length;
                totalLong = detailedLong.length;
                completedShort = detailedShort.filter(c => c.isMet).length;
                totalShort = detailedShort.length;

                const longGateValRaw = activeConfig.longGate || 'AND';
                const longGateVal = typeof longGateValRaw === 'string' ? longGateValRaw.trim().toUpperCase() : 'AND';
                const shortGateValRaw = activeConfig.shortGate || 'AND';
                const shortGateVal = typeof shortGateValRaw === 'string' ? shortGateValRaw.trim().toUpperCase() : 'AND';

                const longTriggered = longConds.length > 0 && (longGateVal === 'AND' 
                  ? detailedLong.every(c => c.isMet) 
                  : detailedLong.some(c => c.isMet));

                const shortTriggered = shortConds.length > 0 && (shortGateVal === 'AND' 
                  ? detailedShort.every(c => c.isMet) 
                  : detailedShort.some(c => c.isMet));

                if (longTriggered && !shortTriggered) {
                  botBias = 'LONG';
                  triggerSignal = true;
                  detailedConditions = detailedLong;
                  activeGate = longGateVal;
                } else if (shortTriggered && !longTriggered) {
                  botBias = 'SHORT';
                  triggerSignal = true;
                  detailedConditions = detailedShort;
                  activeGate = shortGateVal;
                } else if (longTriggered && shortTriggered) {
                  botBias = 'LONG';
                  triggerSignal = true;
                  detailedConditions = detailedLong;
                  activeGate = longGateVal;
                } else {
                  detailedConditions = [...detailedLong, ...detailedShort];
                  triggerSignal = false;
                  botBias = 'NEUTRAL';
                  activeGate = `${longGateVal}/${shortGateVal}`;
                }
              } else {
                detailedConditions = evaluateConditionsDetailed(activeConfig.conditions || [], metrics);
                const conditionsEvaluation = detailedConditions.map(c => c.isMet);

                if (detailedConditions.length > 0) {
                  if (activeGate === 'AND') {
                    triggerSignal = conditionsEvaluation.every((v: boolean) => v);
                  } else {
                    triggerSignal = conditionsEvaluation.some((v: boolean) => v);
                  }
                }
                if (triggerSignal) {
                  botBias = activeConfig.action === 'LONG' ? 'LONG' : (activeConfig.action === 'SHORT' ? 'SHORT' : 'NEUTRAL');
                }
              }

              // Regime filtering
              const allowedRegimes = tawleefa.allowedRegimes || [];
              let regimeMatch = false;
              if (usingProfile) {
                 regimeMatch = true;
              } else if (allowedRegimes.length === 0 || allowedRegimes.includes('ANY')) {
                 // Default to BEST states if nothing is selected or ANY is used
                 regimeMatch = currentRegimeName !== 'DEAD_CHOP' && currentRegimeName !== 'VIOLENT_VOLATILITY';
              } else {
                 regimeMatch = allowedRegimes.includes(currentRegimeName);
              }

              const tawleefaReportJson = {
                name: tawleefa.name,
                gate: activeGate,
                allowedRegimes: tawleefa.allowedRegimes || [],
                currentRegime: currentRegimeName,
                regimeMatch: regimeMatch,
                conditions: detailedConditions,
                triggerSignal: triggerSignal,
                isDualMode: isDualMode,
                completedLong,
                totalLong,
                completedShort,
                totalShort
              };

              if (triggerSignal && regimeMatch) {
                if (botBias !== 'NEUTRAL') {
                  console.log(`[⭐ TAWLEEFA ENGINE] Attack signal triggered via "${tawleefa.name}"${usingProfile ? ' (Regime profile active)' : ''} for ${metrics.symbol} Bias: ${botBias}`);
                  return {
                    regime: regimeStatus.regime,
                    bias: botBias,
                    trap: trap,
                    confidence: (tawleefa.minMarketConfidence ?? 60) / 100,
                    action: 'ATTACK',
                    reason: `TAWLEEFA:${tawleefa.name}${usingProfile ? '_PROFILE_' + currentRegimeName : ''}_${botBias}`,
                    tawleefaReport: tawleefaReportJson
                  };
                }
              }

              // If we are here, custom engine is active but conditions are not met
              return {
                regime: regimeStatus.regime,
                bias: 'NEUTRAL',
                trap: TrapType.NONE,
                confidence: 0,
                action: 'WAIT',
                reason: `TAWLEEFA:${tawleefa.name}_${usingProfile ? 'PROFILE_' + currentRegimeName + '_' : ''}WAITING_FOR_TRIGGER`,
                tawleefaReport: tawleefaReportJson
              };
            }
          }
        } catch (err) {
          console.error("[TAWLEEFA] Error executing active custom tawleefa:", err);
        }
      }

      // Fallback if useTawleefaEngine is true but activeTawleefaJson is invalid/empty/unset
      return {
        regime: regimeStatus.regime,
        bias: 'NEUTRAL',
        trap: TrapType.NONE,
        confidence: 0,
        action: 'WAIT',
        reason: 'TAWLEEFA_ACTIVE_BUT_EMPTY_OR_INVALID'
      };
    }
    
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

    // Calculate dynamic RVOL thresholds based on historical volume volatility
    const volCoefVar = metrics.volCoefVar ?? 0.2;
    const dynamicContinuationThreshold = Math.max(1.6, Math.min(2.8, 1.0 + 2.5 * volCoefVar));

    // Opportunity 2: Trap Detection (for non-SlyFox mode)
    const isTrapOpp = (trap === TrapType.LONG_TRAP && directionalBias === 'SHORT') || 
                      (trap === TrapType.SHORT_TRAP && directionalBias === 'LONG');
    
    if (isTrapOpp && (settings?.layerLiquidityEnabled || settings?.beastMode)) {
       action = 'ATTACK';
       reason = trap === TrapType.LONG_TRAP ? 'BULL_TRAP_COUNTER' : 'BEAR_TRAP_COUNTER';
       confidence = 0.95;
    } 
    // Opportunity 3: Trend Continuation
    else if (metrics.rvol > dynamicContinuationThreshold && regimeStatus.regime === MarketRegime.TRENDING) {
       const isPriceAlign = (metrics.rsi > 55 && directionalBias === 'LONG') || (metrics.rsi < 45 && directionalBias === 'SHORT');
       if (isPriceAlign && (settings?.layerBiasEnabled || !settings?.layerBiasEnabled)) {
           action = 'ATTACK';
           reason = `TREND_CONTINUATION: RVOL ${metrics.rvol.toFixed(1)} + Bias ${directionalBias}`;
           confidence = 0.75;
       }
    }
    // Opportunity 4: Beast Strike (Aggressive Momentum)
    else if (settings?.beastMode) {
        const dynamicBaseThreshold = Math.max(1.15, Math.min(1.5, 1.0 + 1.2 * volCoefVar));
        const minRvol = settings.beastMinRvol ?? dynamicBaseThreshold;
        const rvolPass = settings.beastConfirmWithVolume ? metrics.rvol >= minRvol : metrics.rvol >= dynamicBaseThreshold;
        
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
