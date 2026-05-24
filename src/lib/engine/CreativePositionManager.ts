import { Trade } from '../../types/trading.js';

export class CreativePositionManager {
  /**
   * Executes the sophisticated Position State Machine for Creative Trades
   * States: ENTRY -> EXPANSION -> PROFIT_ZONE -> EXHAUSTION/DISTRIBUTION -> EXIT
   */
  public static manage(
    trade: Trade,
    currentPrice: number,
    rvol: number,
    takerRatio: number,
    oiUp: boolean,
    oiVelocity: number,
    atr: number
  ): { action: 'NONE' | 'CLOSE' | 'UPDATE' | 'PARTIAL'; reason?: string; updatedTrade?: Trade } {
    if (!trade.status || trade.status === 'CLOSED') {
      return { action: 'NONE' };
    }

    const isLong = trade.type === 'LONG';
    const priceChangePerc = isLong
      ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
      : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;

    // حساب الـ PnL والـ PnL% اللحظي للصفقات الإبداعية مباشرة في كائن مرجع الذاكرة لتغذي الواجهة
    const totalFeeRate = 0.001;
    const leverage = trade.leverage || 10;
    const roePerc = (priceChangePerc - (totalFeeRate * 100)) * leverage;
    
    let currentPnl = ((trade.amount * priceChangePerc) / 100) - (trade.amount * totalFeeRate);
    if (trade.realizedPnl) {
      currentPnl += trade.realizedPnl;
    }

    // كتابة القيم فوراً على المرجع لتعرض في لوحة الواجهة
    trade.pnl = currentPnl;
    trade.pnlPerc = roePerc;

    // Ensure state is initialized
    if (!(trade as any).creativeState) {
      (trade as any).creativeState = 'ENTRY';
    }

    let currentState: 'ENTRY' | 'EXPANSION' | 'PROFIT_ZONE' | 'EXHAUSTION' | 'DISTRIBUTION' | 'EXIT' = (trade as any).creativeState;
    let reason = '';
    let updated = false;

    // --- INSTITUTIONAL RATE OF CHANGE (RoC) CALCULATORS ---
    // 1. Open Interest Decay Velocity (% drop in OI recently)
    let oiDecayVelocity = 0;
    if (trade.oiHistory && trade.oiHistory.length >= 4) {
      const olderOi = trade.oiHistory[trade.oiHistory.length - 4];
      if (olderOi > 0) {
        oiDecayVelocity = ((trade.oiHistory[trade.oiHistory.length - 1] - olderOi) / olderOi) * 100;
      }
    } else {
      // Inline approximation if history is still building
      oiDecayVelocity = (oiVelocity - 1.0) * 100;
    }

    // 2. CVD Decay/Flattening Velocity (Rate of taker volume slowing down)
    const cvdDecayVelocity = isLong ? (1.0 - takerRatio) : (takerRatio - 1.0);

    // 3. Delta Failure Speed: CVD/Taker moving aggressively but price is stagnant (absorption wall)
    let deltaFailureSpeed = 0;
    const absPriceChange = Math.abs(priceChangePerc);
    if (rvol > 1.3 && Math.abs(takerRatio - 1.0) > 0.05) {
      deltaFailureSpeed = absPriceChange < 0.1 ? Math.abs(takerRatio - 1.0) / (absPriceChange || 0.01) : 0;
    }

    // --- PROBABILISTIC STATES EVALUATION (Continuous probabilities) ---
    // A. Expansion Probability
    let expansionProbability = 0;
    if (priceChangePerc > 0) {
      expansionProbability += Math.min(45, priceChangePerc * 90);
    }
    if (rvol > 1.3) expansionProbability += 20;
    if (oiUp) expansionProbability += 15;
    if (oiVelocity > 1.006) expansionProbability += 20;
    expansionProbability = Math.min(100, Math.round(expansionProbability));

    // B. Exhaustion Probability (Accelerating OI decay and flat delta flow)
    let exhaustionProbability = 0;
    if (priceChangePerc > 0.15) {
      exhaustionProbability += 15;
      
      // Accelerating OI Collapse (critical trigger)
      if (oiDecayVelocity < -1.5) {
        exhaustionProbability += Math.min(45, Math.abs(oiDecayVelocity) * 12);
      }
      
      // CVD Stagnation / Divergence
      if (cvdDecayVelocity > 0.03) {
        exhaustionProbability += Math.min(25, cvdDecayVelocity * 100);
      }
      
      // Delta Failure Speed bonus
      if (deltaFailureSpeed > 10) {
        exhaustionProbability += 15;
      }
    }
    exhaustionProbability = Math.min(100, Math.round(exhaustionProbability));

    // C. Distribution Probability (Sideways volume depletion)
    let distributionProbability = 0;
    if (Math.abs(priceChangePerc) < 0.25) {
      distributionProbability += 20;
      if (rvol < 0.8) distributionProbability += 30;
      
      const isFlatCvd = Math.abs(takerRatio - 1.0) < 0.06;
      if (isFlatCvd) {
        distributionProbability += 30;
      }
      
      // Specifying the specific rule requested: "IF OI drops 4% in 30 sec AND price barely moves THEN aggressive distribution"
      if (oiDecayVelocity <= -4.0 && Math.abs(priceChangePerc) < 0.15) {
        distributionProbability += 45;
      }
    }
    distributionProbability = Math.min(100, Math.round(distributionProbability));

    // Save running probabilities to the trade metadata for telemetry
    (trade as any).expansionProb = expansionProbability;
    (trade as any).exhaustionProb = exhaustionProbability;
    (trade as any).distributionProb = distributionProbability;
    (trade as any).oiDecayVelocity = oiDecayVelocity;
    (trade as any).cvdDecayVelocity = cvdDecayVelocity;
    (trade as any).deltaFailureSpeed = deltaFailureSpeed;

    // --- STATE MACHINE TRANSITIONS (Probability-Driven Gates) ---
    if (currentState === 'ENTRY') {
      if (expansionProbability >= 60) {
        currentState = 'EXPANSION';
        (trade as any).creativeState = 'EXPANSION';
        updated = true;
        reason = `PROBABILISTIC_EXPANSION: Prop ${expansionProbability}% - Price taking direction with delta velocity`;
      }
    }

    if (currentState === 'EXPANSION' || currentState === 'ENTRY') {
      if (priceChangePerc >= Math.max(0.75, atr * 0.95)) {
        currentState = 'PROFIT_ZONE';
        (trade as any).creativeState = 'PROFIT_ZONE';
        updated = true;
        reason = `PROFIT_ZONE_TRIGGERED: Target boundary reached, trailing stops active`;
      }
    }

    // Exhaustion transition gate (If exhaustion prob >= 65%)
    if ((currentState === 'EXPANSION' || currentState === 'PROFIT_ZONE') && priceChangePerc > 0.15) {
      if (exhaustionProbability >= 65) {
        currentState = 'EXHAUSTION';
        (trade as any).creativeState = 'EXHAUSTION';
        updated = true;
        reason = `PROBABILISTIC_EXHAUSTION: Prop ${exhaustionProbability}% - OI Decaying (${oiDecayVelocity.toFixed(2)}%) vs Price rising`;
      }
    }

    // Distribution transition gate (If distribution prob >= 60%)
    if (currentState === 'PROFIT_ZONE' && distributionProbability >= 60) {
      currentState = 'DISTRIBUTION';
      (trade as any).creativeState = 'DISTRIBUTION';
      updated = true;
      reason = `PROBABILISTIC_DISTRIBUTION: Prop ${distributionProbability}% - volume stagnation and rapid taker fatigue`;
    }

    // --- STATE ACTION RULES (MANAGEMENT & TP/SL ACTIONS) ---
    
    // A. PROFIT_ZONE: Adaptive TP Extension Rule
    if (currentState === 'PROFIT_ZONE') {
      const isMomentumExpanding = rvol > 1.6 && oiVelocity > 1.02;
      if (isMomentumExpanding) {
        const count = (trade as any).creativeTpExtendedCount || 0;
        if (count < 2) { 
          const oldTp2 = trade.tp2;
          const extensionMultiplier = 1.15; // Extend target by 15%
          trade.tp2 = isLong ? trade.tp2 * extensionMultiplier : trade.tp2 * (2 - extensionMultiplier);
          (trade as any).creativeTpExtendedCount = count + 1;
          updated = true;
          reason = `ADAPTIVE_TP_EXTENDED: Target extended from ${oldTp2.toFixed(3)} to ${trade.tp2.toFixed(3)}`;
        }
      }
    }

    // B. EXHAUSTION: Dynamic partial exit and ultra-tightening
    if (currentState === 'EXHAUSTION') {
      if (trade.status !== 'TP1_HIT' && !trade.isPartialProfitTaken) {
        trade.status = 'TP1_HIT';
        trade.isPartialProfitTaken = true;
        
        const feeBuffer = 1.0012; 
        trade.sl = isLong ? trade.entryPrice * feeBuffer : trade.entryPrice * (2 - feeBuffer);
        trade.isBreakeven = true;
        
        const entryAmnt = trade.amount;
        const partialPnl = ((entryAmnt * 0.5 * priceChangePerc) / 100) - (entryAmnt * 0.001);
        trade.realizedPnl = (trade.realizedPnl || 0) + partialPnl;

        updated = true;
        return {
          action: 'PARTIAL',
          reason: `EXHAUSTION_PARTIAL_EXIT: Secured 50% profits, Prob ${exhaustionProbability}%.`,
          updatedTrade: trade
        };
      } else {
        const tightMultiplier = 0.9975; // extremely tight exit trail
        const oldSl = trade.sl;
        const targetSl = isLong ? currentPrice * tightMultiplier : currentPrice * (2 - tightMultiplier);
        
        const isTighteningSl = isLong ? targetSl > trade.sl : targetSl < trade.sl;
        if (isTighteningSl) {
          trade.sl = targetSl;
          updated = true;
          reason = `EXHAUSTION_TRAIL_TIGHTENED: Secured rest of position at ${trade.sl.toFixed(4)}`;
        }
      }
    }

    // C. DISTRIBUTION: Tighten Trailing Stop quickly
    if (currentState === 'DISTRIBUTION') {
      const trailBuffer = 0.995; 
      const oldSl = trade.sl;
      const targetSl = isLong ? currentPrice * trailBuffer : currentPrice * (2 - trailBuffer);
      const isTighteningSl = isLong ? targetSl > trade.sl : targetSl < trade.sl;
      if (isTighteningSl) {
        trade.sl = targetSl;
        updated = true;
        reason = `DISTRIBUTION_TRAIL_SECURED: Secured trail. Old SL ${oldSl.toFixed(4)} -> Tightened SL ${trade.sl.toFixed(4)}`;
      }
    }

    // D. EXIT: Verify targets
    const hitTp2 = isLong ? currentPrice >= trade.tp2 : currentPrice <= trade.tp2;
    if (hitTp2) {
      return { action: 'CLOSE', reason: 'CREATIVE_TP2_HIT', updatedTrade: trade };
    }

    const hitSl = isLong ? currentPrice <= trade.sl : currentPrice >= trade.sl;
    if (hitSl) {
      return { action: 'CLOSE', reason: trade.isBreakeven ? 'CREATIVE_BREAKEVEN_HIT' : 'CREATIVE_STOP_LOSS_HIT', updatedTrade: trade };
    }

    if (updated) {
      return { action: 'UPDATE', reason, updatedTrade: trade };
    }

    return { action: 'NONE' };
  }
}
