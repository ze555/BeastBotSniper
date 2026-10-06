// ============================================================================
// BeastBotSniper Architecture - Reasoning & Flow Engine (v2.4.0)
// Complete layered intelligence:
// REGIME -> FLOW (with Persistence) -> SCENARIO -> LOCATION -> TIMING GATE -> CONFIRMATION -> ENTRY
// ============================================================================

export type MarketRegimeType = 
   | "TREND_UP" 
   | "TREND_DOWN" 
   | "RANGE" 
   | "HIGH_VOLATILITY" 
   | "TRANSITION";

export type FlowStateType = 
   | "LONG_BUILDUP" 
   | "SHORT_BUILDUP" 
   | "SHORT_COVERING" 
   | "LONG_LIQUIDATION" 
   | "BUYING_PRESSURE" 
   | "SELLING_PRESSURE" 
   | "ABSORPTION_POSSIBLE" 
   | "MIXED" 
   | "UNKNOWN";

export type FlowPersistenceStateType = "STRONG" | "MODERATE" | "WEAK" | "CONFLICTED";

export type TimingGateStateType = 
   | "HEALTHY_EXPANSION" 
   | "WAITING_FOR_RETEST" 
   | "WAITING_FOR_CONFIRMATION" 
   | "LATE_EXPANSION" 
   | "FAKE_BREAKOUT_RISK" 
   | "CONFIRMED" 
   | "INVALIDATED";

export type ScenarioType = 
   | "BULLISH_CONTINUATION" 
   | "BEARISH_CONTINUATION" 
   | "BREAKOUT_LONG" 
   | "BREAKOUT_SHORT" 
   | "FAKE_BREAKOUT_LONG" 
   | "FAKE_BREAKOUT_SHORT" 
   | "REVERSAL_LONG" 
   | "REVERSAL_SHORT" 
   | "RANGE_REJECTION_LONG" 
   | "RANGE_REJECTION_SHORT"
   | "PULLBACK_LONG"
   | "PULLBACK_SHORT"
   | "NONE";

export type ScenarioStatus = "WAITING" | "CONFIRMED" | "INVALIDATED";

export type LifecycleState = 
   | "OBSERVING" 
   | "SCENARIO_DETECTED" 
   | "WAITING_CONFIRMATION" 
   | "CONFIRMED" 
   | "ENTRY" 
   | "MANAGING" 
   | "EXIT";

export interface FlowAnalysis {
   state: FlowStateType;
   persistenceState: FlowPersistenceStateType;
   persistenceScore: number; // 0 to 100 deterministic multi-period alignment score
   evidenceFor: string[];
   evidenceAgainst: string[];
   confidence: "HIGH" | "MEDIUM" | "LOW";
   details: {
      pChg: number;
      oiChg: number;
      takerRatio: number;
      rvol: number;
      slope15: number;
      slope5: number;
      slope4h: number;
   };
}

export interface LocationAnalysis {
   nearestResistance: number;
   nearestSupport: number;
   distanceToResistancePct: number;
   distanceToSupportPct: number;
   rangeHigh: number;
   rangeLow: number;
   nearResistance: boolean;
   nearSupport: boolean;
   upperLiquidityTarget: number;
   lowerLiquidityTarget: number;
   liquidityData: "unavailable"; // Strict rule: No fake liquidation data
}

export interface TimingGateResult {
   state: TimingGateStateType;
   passed: boolean;
   reason: string;
   breakoutDistancePct: number;
   distanceToNextObstaclePct: number;
   isLateEntry: boolean;
   isRetestCandidate: boolean;
   evidence: string[];
   missingItems: string[];
}

export interface ScenarioPlan {
   primary: {
      type: ScenarioType;
      state: ScenarioStatus;
      bias: "LONG" | "SHORT" | "NEUTRAL";
      thesis: string;
   };
   alternative: {
      type: ScenarioType;
      state: ScenarioStatus;
      bias: "LONG" | "SHORT" | "NEUTRAL";
      thesis: string;
   };
   missingConfirmation: string[];
   invalidationCondition: string;
}

export interface ConfirmationResult {
   isConfirmed: boolean;
   confirmedSignal: "LONG" | "SHORT" | "WAIT";
   reason: string;
   evidence: string[];
   missingItems: string[];
}

export interface ReasoningResult {
   regime: MarketRegimeType;
   flow: FlowAnalysis;
   location: LocationAnalysis;
   scenario: ScenarioPlan;
   timingGate: TimingGateResult;
   confirmation: ConfirmationResult;
   lifecycleState: LifecycleState;
   supportingScore: {
      sl: number;
      ss: number;
   };
}

// ----------------------------------------------------------------------------
// 1. MARKET REGIME ENGINE: detectMarketRegime
// Contextual environment classifier. Does NOT give buy/sell signals.
// ----------------------------------------------------------------------------
export function detectMarketRegime(ctx: any, p: any): MarketRegimeType {
   if (ctx.regime === "VIOLENT" || ctx.tradeable === false || (p.rvol > 2.8 && p.atr14 > p.atr20 * 1.6)) {
      return "HIGH_VOLATILITY";
   }

   const btcBull = ctx.regime.includes("BULL");
   const btcBear = ctx.regime.includes("BEAR");

   const assetBullAlign = p.price > p.ema50 && p.ema50 > p.ema200 && p.HH_HL;
   const assetBearAlign = p.price < p.ema50 && p.ema50 < p.ema200 && p.LH_LL;

   if (btcBull && assetBullAlign && p.adx >= 20) {
      return "TREND_UP";
   }
   if (btcBear && assetBearAlign && p.adx >= 20) {
      return "TREND_DOWN";
   }

   if (assetBullAlign && p.adx > 25 && p.price > p.ema21) {
      return "TREND_UP";
   }
   if (assetBearAlign && p.adx > 25 && p.price < p.ema21) {
      return "TREND_DOWN";
   }

   const structureDivergence = (p.bull_align && p.LH_LL) || (p.bear_align && p.HH_HL);
   const maCompression = Math.abs(p.ema50 - p.ema200) / (p.ema200 || 1) < 0.008;
   if (structureDivergence || (maCompression && p.adx < 22)) {
      return "TRANSITION";
   }

   return "RANGE";
}

// ----------------------------------------------------------------------------
// 2. FLOW INTERPRETATION & PERSISTENCE ENGINE: interpretFlow
// Evaluates multi-period persistence across 5m, 15m, 4h CVD, OI, Taker and Price.
// Strictly prevents MIXED / CONFLICTED flows from passing.
// ----------------------------------------------------------------------------
export function interpretFlow(p: any, w: any): FlowAnalysis {
   const pChg = w.p_chg || 0;
   const oiChg = w.oi_chg || 0;
   const slope15 = w.slope15 || 0;
   const slope5 = w.slope5 || 0;
   const slope4h = w.slope4h || 0;
   const cvdPositive = slope15 > 0 || (slope15 >= 0 && slope5 > 0);
   const cvdNegative = slope15 < 0 || (slope15 <= 0 && slope5 < 0);
   const takerRatio = p.taker || 0.5;
   const rvol = p.rvol || 1.0;

   const evidenceFor: string[] = [];
   const evidenceAgainst: string[] = [];

   // --- MULTI-PERIOD FLOW PERSISTENCE EVALUATION ---
   let persistencePoints = 0;

   // 1. Triple Timeframe CVD Alignment (30 pts)
   const cvdAlignedBull = slope5 > 0 && slope15 > 0;
   const cvdAlignedBear = slope5 < 0 && slope15 < 0;
   if (cvdAlignedBull || cvdAlignedBear) persistencePoints += 20;
   if ((cvdAlignedBull && slope4h > 0) || (cvdAlignedBear && slope4h < 0)) persistencePoints += 10;

   // 2. Open Interest Alignment with Price Motion (30 pts)
   if (pChg > 0.001 && oiChg > 0.002) persistencePoints += 30; // Institutional Long Accumulation
   else if (pChg < -0.001 && oiChg > 0.002) persistencePoints += 30; // Institutional Short Accumulation
   else if (pChg > 0.001 && oiChg < -0.002) persistencePoints += 10; // Short unwinding (fragile)
   else if (pChg < -0.001 && oiChg < -0.002) persistencePoints += 10; // Long liquidation (fragile)
   else if (Math.abs(oiChg) <= 0.002) persistencePoints += 15; // Stable OI

   // 3. Taker Buy/Sell Aggression Alignment (25 pts)
   if ((pChg > 0 && takerRatio >= 0.54) || (pChg < 0 && takerRatio <= 0.46)) persistencePoints += 25;
   else if ((pChg > 0 && takerRatio >= 0.51) || (pChg < 0 && takerRatio <= 0.49)) persistencePoints += 15;
   else persistencePoints += 0; // Conflicting taker pressure

   // 4. Volume Participation (15 pts)
   if (rvol >= 1.3) persistencePoints += 15;
   else if (rvol >= 0.9) persistencePoints += 10;
   else persistencePoints += 5;

   const persistenceScore = Math.min(100, Math.max(0, persistencePoints));

   let persistenceState: FlowPersistenceStateType = "MODERATE";
   if (w.cvd_mixed || (pChg > 0 && slope15 < 0 && takerRatio < 0.48) || (pChg < 0 && slope15 > 0 && takerRatio > 0.52)) {
      persistenceState = "CONFLICTED";
   } else if (persistenceScore >= 75) {
      persistenceState = "STRONG";
   } else if (persistenceScore >= 45) {
      persistenceState = "MODERATE";
   } else {
      persistenceState = "WEAK";
   }

   // Base state check
   if (Math.abs(pChg) < 0.0005 && Math.abs(oiChg) < 0.002 && Math.abs(slope15) < 0.001) {
      return {
         state: "UNKNOWN",
         persistenceState: "WEAK",
         persistenceScore,
         evidenceFor: ["Low market activity / baseline range"],
         evidenceAgainst: ["Insufficient flow momentum"],
         confidence: "LOW",
         details: { pChg, oiChg, takerRatio, rvol, slope15, slope5, slope4h }
      };
   }

   // 1. Long Buildup: Price rising + OI accumulating + CVD rising + Taker Buy dominant
   if (pChg > 0.0015 && oiChg > 0.003 && cvdPositive && takerRatio >= 0.51) {
      evidenceFor.push("Price expanding upward (+ " + (pChg * 100).toFixed(2) + "%)");
      evidenceFor.push("Open Interest accumulating (+ " + (oiChg * 100).toFixed(2) + "%)");
      evidenceFor.push("CVD positive across key timeframes");
      evidenceFor.push("Taker buy aggressive pressure (" + (takerRatio * 100).toFixed(1) + "%)");
      if (persistenceState === "STRONG") evidenceFor.push("Flow Persistence is STRONG across multiple periods");

      if (w.fund > 0.04 / 100) evidenceAgainst.push("Funding rate elevated, longs paying premium");
      if (p.rsi > 70) evidenceAgainst.push("RSI entering overbought threshold");

      return {
         state: "LONG_BUILDUP",
         persistenceState,
         persistenceScore,
         evidenceFor,
         evidenceAgainst,
         confidence: (rvol > 1.2 && takerRatio > 0.54 && persistenceState === "STRONG") ? "HIGH" : "MEDIUM",
         details: { pChg, oiChg, takerRatio, rvol, slope15, slope5, slope4h }
      };
   }

   // 2. Short Covering: Price rising + OI decreasing
   if (pChg > 0.0015 && oiChg < -0.002 && cvdPositive) {
      evidenceFor.push("Price moving upward");
      evidenceFor.push("OI declining (- " + Math.abs(oiChg * 100).toFixed(2) + "%) indicating short covering");
      evidenceAgainst.push("New long positioning is absent (OI not growing)");
      evidenceAgainst.push("Rally may lack structural fuel once shorts finish covering");

      return {
         state: "SHORT_COVERING",
         persistenceState,
         persistenceScore,
         evidenceFor,
         evidenceAgainst,
         confidence: "MEDIUM",
         details: { pChg, oiChg, takerRatio, rvol, slope15, slope5, slope4h }
      };
   }

   // 3. Short Buildup: Price dropping + OI accumulating + CVD falling + Taker Sell dominant
   if (pChg < -0.0015 && oiChg > 0.003 && cvdNegative && takerRatio <= 0.49) {
      evidenceFor.push("Price dropping (- " + Math.abs(pChg * 100).toFixed(2) + "%)");
      evidenceFor.push("Open interest expanding (+ " + (oiChg * 100).toFixed(2) + "%) on downside");
      evidenceFor.push("CVD downward slope across timeframes");
      evidenceFor.push("Taker sell aggression dominant (" + ((1 - takerRatio) * 100).toFixed(1) + "%)");
      if (persistenceState === "STRONG") evidenceFor.push("Flow Persistence is STRONG across multiple periods");

      if (w.fund < -0.04 / 100) evidenceAgainst.push("Negative funding elevated, crowded shorts");
      if (p.rsi < 30) evidenceAgainst.push("RSI entering oversold extreme");

      return {
         state: "SHORT_BUILDUP",
         persistenceState,
         persistenceScore,
         evidenceFor,
         evidenceAgainst,
         confidence: (rvol > 1.2 && takerRatio < 0.46 && persistenceState === "STRONG") ? "HIGH" : "MEDIUM",
         details: { pChg, oiChg, takerRatio, rvol, slope15, slope5, slope4h }
      };
   }

   // 4. Long Liquidation: Price falling + OI decreasing
   if (pChg < -0.0015 && oiChg < -0.002 && cvdNegative) {
      evidenceFor.push("Price dropping with sharp decline in open contracts");
      evidenceFor.push("OI flushing (- " + Math.abs(oiChg * 100).toFixed(2) + "%) reflecting long stops / unwinding");
      evidenceAgainst.push("No aggressive new short buildup confirmed");

      return {
         state: "LONG_LIQUIDATION",
         persistenceState,
         persistenceScore,
         evidenceFor,
         evidenceAgainst,
         confidence: "MEDIUM",
         details: { pChg, oiChg, takerRatio, rvol, slope15, slope5, slope4h }
      };
   }

   // 5. Absorption
   if ((pChg >= -0.0005 && cvdNegative && takerRatio < 0.45 && w.hidden_buy) ||
       (pChg <= 0.0005 && cvdPositive && takerRatio > 0.55 && w.hidden_sell)) {
      evidenceFor.push("Passive limit orders absorbing aggressive market volume");
      return {
         state: "ABSORPTION_POSSIBLE",
         persistenceState,
         persistenceScore,
         evidenceFor,
         evidenceAgainst,
         confidence: "MEDIUM",
         details: { pChg, oiChg, takerRatio, rvol, slope15, slope5, slope4h }
      };
   }

   // 6. Buying / Selling Pressure
   if (pChg > 0.001 && takerRatio > 0.53 && cvdPositive) {
      evidenceFor.push("Taker buy dominance without clear OI change");
      return {
         state: "BUYING_PRESSURE",
         persistenceState,
         persistenceScore,
         evidenceFor,
         evidenceAgainst: ["OI accumulation is stagnant"],
         confidence: "LOW",
         details: { pChg, oiChg, takerRatio, rvol, slope15, slope5, slope4h }
      };
   }
   if (pChg < -0.001 && takerRatio < 0.47 && cvdNegative) {
      evidenceFor.push("Taker sell dominance without clear OI change");
      return {
         state: "SELLING_PRESSURE",
         persistenceState,
         persistenceScore,
         evidenceFor,
         evidenceAgainst: ["OI accumulation is stagnant"],
         confidence: "LOW",
         details: { pChg, oiChg, takerRatio, rvol, slope15, slope5, slope4h }
      };
   }

   // Default conflicting / mixed flow
   evidenceAgainst.push("Price and orderflow metrics showing conflicting signals (MIXED / CONFLICTED)");
   return {
      state: "MIXED",
      persistenceState: "CONFLICTED",
      persistenceScore: Math.min(30, persistenceScore),
      evidenceFor: ["Partial orderflow activity observed"],
      evidenceAgainst,
      confidence: "LOW",
      details: { pChg, oiChg, takerRatio, rvol, slope15, slope5, slope4h }
   };
}

// ----------------------------------------------------------------------------
// 3. LOCATION & LIQUIDITY ENGINE: evaluateLocation
// Locates current price relative to structural levels.
// Strict rule: No fake liquidation data (marked strictly unavailable).
// ----------------------------------------------------------------------------
export function evaluateLocation(p: any): LocationAnalysis {
   const price = p.price;
   const c = p.klines || [];
   const lookback = Math.min(c.length, 30);
   const recentSlice = c.slice(-lookback);

   const highs = recentSlice.map((k: any) => k.high);
   const lows = recentSlice.map((k: any) => k.low);

   const priorHighs = highs.length > 1 ? highs.slice(0, -1) : highs;
   const priorLows = lows.length > 1 ? lows.slice(0, -1) : lows;

   const nearestResistance = Math.max(...priorHighs);
   const nearestSupport = Math.min(...priorLows);

   const distanceToResistancePct = (nearestResistance - price) / (price || 1);
   const distanceToSupportPct = (price - nearestSupport) / (price || 1);

   const rangeHigh = Math.max(...highs);
   const rangeLow = Math.min(...lows);

   const nearResistance = distanceToResistancePct >= -0.002 && distanceToResistancePct <= 0.0035;
   const nearSupport = distanceToSupportPct >= -0.002 && distanceToSupportPct <= 0.0035;

   return {
      nearestResistance,
      nearestSupport,
      distanceToResistancePct,
      distanceToSupportPct,
      rangeHigh,
      rangeLow,
      nearResistance,
      nearSupport,
      upperLiquidityTarget: rangeHigh * 1.002,
      lowerLiquidityTarget: rangeLow * 0.998,
      liquidityData: "unavailable"
   };
}

// ----------------------------------------------------------------------------
// 4. TIMING GATE ENGINE: evaluateTimingGate
// Strict filter between Location and Confirmation to prevent Late Entries,
// Buying the top, or getting trapped in unconfirmed / exhausted breakouts.
// Distinguishes:
// A) HEALTHY_EXPANSION / CONFIRMED
// B) LATE_EXPANSION (buying near extreme)
// C) FAKE_BREAKOUT_RISK
// D) WAITING_FOR_RETEST
// ----------------------------------------------------------------------------
export function evaluateTimingGate(
   direction: "LONG" | "SHORT",
   p: any,
   w: any,
   loc: LocationAnalysis,
   flow: FlowAnalysis
): TimingGateResult {
   const evidence: string[] = [];
   const missingItems: string[] = [];
   const price = p.price;
   const c = p.klines || [];
   const lastCandle = c.length > 0 ? c[c.length - 1] : null;
   const atr14 = p.atr14 || (price * 0.01);

   let breakoutDistancePct = 0;
   let distanceToNextObstaclePct = 0;
   let isLateEntry = false;
   let isRetestCandidate = false;

   if (direction === "LONG") {
      const level = loc.nearestResistance;
      const breakoutDistance = price - level;
      breakoutDistancePct = level > 0 ? (breakoutDistance / level) * 100 : 0;
      
      // Distance to range high or next structural ceiling
      distanceToNextObstaclePct = loc.rangeHigh > price ? ((loc.rangeHigh - price) / price) * 100 : 0;

      // Check candle exhaustion: big upper wick right after breakout
      const body = lastCandle ? Math.abs(lastCandle.close - lastCandle.open) : 0;
      const upperWick = lastCandle ? lastCandle.high - Math.max(lastCandle.open, lastCandle.close) : 0;
      const lowerWick = lastCandle ? Math.min(lastCandle.open, lastCandle.close) - lastCandle.low : 0;
      const hasUpperExhaustionWick = upperWick > body * 1.6 && upperWick > atr14 * 0.4;

      // 1. Fake Breakout Detection
      if (price > level && (hasUpperExhaustionWick || (w.slope15 < 0 && p.taker < 0.48))) {
         return {
            state: "FAKE_BREAKOUT_RISK",
            passed: false,
            reason: "Price poked above resistance but printed an exhaustion rejection wick with declining orderflow.",
            breakoutDistancePct,
            distanceToNextObstaclePct,
            isLateEntry: false,
            isRetestCandidate: false,
            evidence: ["Level breached"],
            missingItems: ["Candle body acceptance above resistance", "Positive buyer absorption"]
         };
      }

      // 2. Late Entry / Buying the Top
      // If price already ran more than 1.4 * ATR14 from breakout level or RSI > 72
      if (price > level && (breakoutDistance > atr14 * 1.4 || p.rsi > 72)) {
         isLateEntry = true;
         isRetestCandidate = true;
         return {
            state: "LATE_EXPANSION",
            passed: false,
            reason: `Late breakout entry: price expanded ${(breakoutDistance / atr14).toFixed(1)}x ATR14 from breakout level. Awaiting pullback / retest.`,
            breakoutDistancePct,
            distanceToNextObstaclePct,
            isLateEntry: true,
            isRetestCandidate: true,
            evidence: ["Strong momentum already occurred"],
            missingItems: ["Healthy retest of broken resistance", "Risk-to-reward normalization"]
         };
      }

      // 3. Waiting for Retest
      // If price previously broke out and is now pulling back within 0.35% of level with holding action
      if (Math.abs(price - level) / level <= 0.0035 && lowerWick > body * 0.5 && p.rsi <= 65) {
         evidence.push("Orderflow holding above former resistance (retest in progress)");
         return {
            state: "CONFIRMED",
            passed: true,
            reason: "Successful retest confirmed: broken resistance defended with constructive buyer absorption.",
            breakoutDistancePct,
            distanceToNextObstaclePct,
            isLateEntry: false,
            isRetestCandidate: true,
            evidence,
            missingItems: []
         };
      }

      // 4. Healthy Breakout
      // Clean close above level within acceptable range (0.1% to 0.9 * ATR14) with strong participation
      if (price >= level && lastCandle && lastCandle.close >= level) {
         if (p.rvol >= 1.2 && p.taker >= 0.51 && flow.persistenceState !== "CONFLICTED") {
            evidence.push("Healthy breakout confirmed within acceptable entry corridor (< 1.0x ATR)");
            evidence.push(`RVOL (${p.rvol.toFixed(2)}x) and Taker (${(p.taker * 100).toFixed(1)}%) confirming follow-through`);
            return {
               state: "CONFIRMED",
               passed: true,
               reason: "Healthy breakout timing: clean close above resistance with solid volume and persistent flow.",
               breakoutDistancePct,
               distanceToNextObstaclePct,
               isLateEntry: false,
               isRetestCandidate: false,
               evidence,
               missingItems: []
            };
         } else {
            return {
               state: "WAITING_FOR_CONFIRMATION",
               passed: false,
               reason: "Price is above resistance but lacks decisive breakout volume (RVOL < 1.2) or taker dominance.",
               breakoutDistancePct,
               distanceToNextObstaclePct,
               isLateEntry: false,
               isRetestCandidate: true,
               evidence: ["Price above level"],
               missingItems: ["RVOL > 1.2 confirmation", "Taker buy dominance > 51%"]
            };
         }
      }

      // Still beneath resistance
      return {
         state: "WAITING_FOR_CONFIRMATION",
         passed: false,
         reason: "Price has not yet printed a confirmed close above resistance level.",
         breakoutDistancePct,
         distanceToNextObstaclePct,
         isLateEntry: false,
         isRetestCandidate: false,
         evidence,
         missingItems: [`Clean candle close above ${level.toFixed(4)}`]
      };
   }

   // --- SHORT TIMING GATE ---
   const level = loc.nearestSupport;
   const breakdownDistance = level - price;
   breakoutDistancePct = level > 0 ? (breakdownDistance / level) * 100 : 0;
   distanceToNextObstaclePct = price > loc.rangeLow ? ((price - loc.rangeLow) / price) * 100 : 0;

   const body = lastCandle ? Math.abs(lastCandle.close - lastCandle.open) : 0;
   const lowerWick = lastCandle ? Math.min(lastCandle.open, lastCandle.close) - lastCandle.low : 0;
   const upperWick = lastCandle ? lastCandle.high - Math.max(lastCandle.open, lastCandle.close) : 0;
   const hasLowerExhaustionWick = lowerWick > body * 1.6 && lowerWick > atr14 * 0.4;

   if (price < level && (hasLowerExhaustionWick || (w.slope15 > 0 && p.taker > 0.52))) {
      return {
         state: "FAKE_BREAKOUT_RISK",
         passed: false,
         reason: "Price poked below support but formed a lower rejection wick with buying absorption.",
         breakoutDistancePct,
         distanceToNextObstaclePct,
         isLateEntry: false,
         isRetestCandidate: false,
         evidence: ["Support probed"],
         missingItems: ["Clean bearish close below support", "Aggressive taker seller persistence"]
      };
   }

   if (price < level && (breakdownDistance > atr14 * 1.4 || p.rsi < 28)) {
      return {
         state: "LATE_EXPANSION",
         passed: false,
         reason: `Late breakdown entry: price expanded ${(breakdownDistance / atr14).toFixed(1)}x ATR14 into oversold territory. Awaiting retest.`,
         breakoutDistancePct,
         distanceToNextObstaclePct,
         isLateEntry: true,
         isRetestCandidate: true,
         evidence: ["Downside momentum extended"],
         missingItems: ["Healthy retest of broken support as resistance", "Risk-to-reward normalization"]
      };
   }

   if (Math.abs(price - level) / level <= 0.0035 && upperWick > body * 0.5 && p.rsi >= 35) {
      evidence.push("Orderflow holding below former support (retest in progress)");
      return {
         state: "CONFIRMED",
         passed: true,
         reason: "Successful retest confirmed: broken support defended as ceiling with active seller absorption.",
         breakoutDistancePct,
         distanceToNextObstaclePct,
         isLateEntry: false,
         isRetestCandidate: true,
         evidence,
         missingItems: []
      };
   }

   if (price <= level && lastCandle && lastCandle.close <= level) {
      if (p.rvol >= 1.2 && p.taker <= 0.49 && flow.persistenceState !== "CONFLICTED") {
         evidence.push("Healthy breakdown confirmed within acceptable entry corridor (< 1.0x ATR)");
         evidence.push(`RVOL (${p.rvol.toFixed(2)}x) and Taker (${(p.taker * 100).toFixed(1)}%) confirming seller dominance`);
         return {
            state: "CONFIRMED",
            passed: true,
            reason: "Healthy breakdown timing: clean close below support with solid volume and persistent flow.",
            breakoutDistancePct,
            distanceToNextObstaclePct,
            isLateEntry: false,
            isRetestCandidate: false,
            evidence,
            missingItems: []
         };
      } else {
         return {
            state: "WAITING_FOR_CONFIRMATION",
            passed: false,
            reason: "Price is below support but lacks decisive breakdown volume (RVOL < 1.2) or taker sell dominance.",
            breakoutDistancePct,
            distanceToNextObstaclePct,
            isLateEntry: false,
            isRetestCandidate: true,
            evidence: ["Price below level"],
            missingItems: ["RVOL > 1.2 confirmation", "Taker sell dominance < 49%"]
         };
      }
   }

   return {
      state: "WAITING_FOR_CONFIRMATION",
      passed: false,
      reason: "Price has not yet printed a confirmed close below support level.",
      breakoutDistancePct,
      distanceToNextObstaclePct,
      isLateEntry: false,
      isRetestCandidate: false,
      evidence,
      missingItems: [`Clean candle close below ${level.toFixed(4)}`]
   };
}

// ----------------------------------------------------------------------------
// 5. SCENARIO ENGINE: generateScenarios
// ----------------------------------------------------------------------------
export function generateScenarios(
   regime: MarketRegimeType,
   flow: FlowAnalysis,
   loc: LocationAnalysis,
   p: any
): ScenarioPlan {
   const missingConfirmation: string[] = [];
   let invalidationCondition = "N/A";

   if (regime === "TREND_UP" || (flow.state === "LONG_BUILDUP" && regime !== "TREND_DOWN")) {
      if (loc.nearResistance) {
         missingConfirmation.push("Clean 15m candle close clearly above " + loc.nearestResistance.toFixed(4));
         missingConfirmation.push("RVOL > 1.2 confirming breakout volume");
         missingConfirmation.push("CVD remaining positive and non-conflicted");
         invalidationCondition = "Rejection wick closing back below " + (loc.nearestResistance * 0.998).toFixed(4);

         return {
            primary: {
               type: "BREAKOUT_LONG",
               state: "WAITING",
               bias: "LONG",
               thesis: "Bullish orderflow buildup pressing on resistance ceiling. Breakout expected on confirmed breach."
            },
            alternative: {
               type: "FAKE_BREAKOUT_LONG",
               state: "WAITING",
               bias: "SHORT",
               thesis: "Bull trap sweeping liquidity above resistance with immediate absorption."
            },
            missingConfirmation,
            invalidationCondition
         };
      }

      if (p.pullback_long || (p.price <= p.ema21 && p.price >= p.ema50)) {
         missingConfirmation.push("Bullish reversal candle formation off EMA21/EMA50");
         missingConfirmation.push("Taker buy delta turning positive (Taker > 0.52)");
         invalidationCondition = "Decisive candle close below EMA50 (" + p.ema50.toFixed(4) + ")";

         return {
            primary: {
               type: "PULLBACK_LONG",
               state: "WAITING",
               bias: "LONG",
               thesis: "Healthy trend retracement into institutional value zone with trend alignment."
            },
            alternative: {
               type: "REVERSAL_SHORT",
               state: "WAITING",
               bias: "SHORT",
               thesis: "Deep trend breakdown violating structural higher lows."
            },
            missingConfirmation,
            invalidationCondition
         };
      }

      return {
         primary: {
            type: "BULLISH_CONTINUATION",
            state: "WAITING",
            bias: "LONG",
            thesis: "Trend momentum intact, seeking continuation setup above local pivot."
         },
         alternative: {
            type: "RANGE_REJECTION_SHORT",
            state: "WAITING",
            bias: "NEUTRAL",
            thesis: "Exhaustion top if volume fades."
         },
         missingConfirmation: ["Structural continuation trigger and momentum ignition"],
         invalidationCondition: "Loss of recent swing low at " + loc.nearestSupport.toFixed(4)
      };
   }

   if (regime === "TREND_DOWN" || (flow.state === "SHORT_BUILDUP" && regime !== "TREND_UP")) {
      if (loc.nearSupport) {
         missingConfirmation.push("Clean 15m candle close clearly below " + loc.nearestSupport.toFixed(4));
         missingConfirmation.push("RVOL > 1.2 confirming breakdown volume");
         missingConfirmation.push("CVD remaining negative and non-conflicted");
         invalidationCondition = "V-shape bounce closing back above " + (loc.nearestSupport * 1.002).toFixed(4);

         return {
            primary: {
               type: "BREAKOUT_SHORT",
               state: "WAITING",
               bias: "SHORT",
               thesis: "Aggressive short buildup pressing on support floor. Breakdown expected on confirmed breach."
            },
            alternative: {
               type: "FAKE_BREAKOUT_SHORT",
               state: "WAITING",
               bias: "LONG",
               thesis: "Bear trap sweeping liquidity below support with immediate absorption."
            },
            missingConfirmation,
            invalidationCondition
         };
      }

      if (p.pullback_short || (p.price >= p.ema21 && p.price <= p.ema50)) {
         missingConfirmation.push("Bearish rejection candle off EMA21/EMA50 resistance");
         missingConfirmation.push("Taker sell dominance (Taker < 0.48)");
         invalidationCondition = "Decisive candle close above EMA50 (" + p.ema50.toFixed(4) + ")";

         return {
            primary: {
               type: "PULLBACK_SHORT",
               state: "WAITING",
               bias: "SHORT",
               thesis: "Trend relief rally into dynamic resistance with downward momentum."
            },
            alternative: {
               type: "REVERSAL_LONG",
               state: "WAITING",
               bias: "LONG",
               thesis: "V-bottom breakout re-claiming higher moving averages."
            },
            missingConfirmation,
            invalidationCondition
         };
      }

      return {
         primary: {
            type: "BEARISH_CONTINUATION",
            state: "WAITING",
            bias: "SHORT",
            thesis: "Bearish structure expanding, seeking clean continuation below value area."
         },
         alternative: {
            type: "RANGE_REJECTION_LONG",
            state: "WAITING",
            bias: "NEUTRAL",
            thesis: "Climactic sell climax creating oversold bounce."
         },
         missingConfirmation: ["Structural breakdown trigger with volume confirmation"],
         invalidationCondition: "Break above recent swing high at " + loc.nearestResistance.toFixed(4)
      };
   }

   return {
      primary: {
         type: "NONE",
         state: "WAITING",
         bias: "NEUTRAL",
         thesis: "Market oscillating without clear edge or flow clarity."
      },
      alternative: {
         type: "NONE",
         state: "WAITING",
         bias: "NEUTRAL",
         thesis: "Wait for regime or flow catalyst."
      },
      missingConfirmation: ["Establishment of clear regime and unambiguous flow direction"],
      invalidationCondition: "N/A"
   };
}

// ----------------------------------------------------------------------------
// 6. CONFIRMATION ENGINE: checkConfirmation
// Strict gatekeeper between Timing Gate and Entry.
// Enforces:
// 1. High Volatility = NO ENTRY
// 2. MIXED / CONFLICTED Flow = NO ENTRY
// 3. Short Covering != New Long Buildup
// 4. Timing Gate PASS required
// ----------------------------------------------------------------------------
export function checkConfirmation(
   regime: MarketRegimeType,
   flow: FlowAnalysis,
   loc: LocationAnalysis,
   scenario: ScenarioPlan,
   timingGate: TimingGateResult,
   p: any,
   w: any,
   supportingScore: { sl: number; ss: number }
): ConfirmationResult {
   const evidence: string[] = [];
   const missingItems: string[] = [];

   // 1. Strict Gate 1: Regime check
   if (regime === "HIGH_VOLATILITY") {
      return {
         isConfirmed: false,
         confirmedSignal: "WAIT",
         reason: "High volatility / violent market environment: New entries prohibited.",
         evidence,
         missingItems: ["Volatility stabilization"]
      };
   }

   // 2. Strict Gate 2: Strict Rule - MIXED or CONFLICTED Flow = NO ENTRY
   if (flow.state === "MIXED" || flow.state === "UNKNOWN" || flow.persistenceState === "CONFLICTED") {
      return {
         isConfirmed: false,
         confirmedSignal: "WAIT",
         reason: `Flow state is ${flow.state} (Persistence: ${flow.persistenceState}). Conflicting orderflow strictly prohibited from entry.`,
         evidence,
         missingItems: ["Clear non-conflicting flow accumulation across timeframes"]
      };
   }

   // 3. Strict Gate 3: Short covering is NOT new long buildup
   if (flow.state === "SHORT_COVERING") {
      return {
         isConfirmed: false,
         confirmedSignal: "WAIT",
         reason: "Flow is driven by short covering (declining OI), not fresh institutional long accumulation.",
         evidence: flow.evidenceFor,
         missingItems: ["Fresh long accumulation (OI growth with rising price)"]
      };
   }

   // 4. Strict Gate 4: Timing Gate verification
   if (!timingGate.passed) {
      return {
         isConfirmed: false,
         confirmedSignal: "WAIT",
         reason: `Timing Gate [${timingGate.state}]: ${timingGate.reason}`,
         evidence: timingGate.evidence,
         missingItems: timingGate.missingItems
      };
   }

   // 5. Strict Gate 5: Location Awareness & Obstacle Distance
   if (scenario.primary.bias === "LONG" && loc.distanceToResistancePct < 0.0025 && !timingGate.passed) {
      return {
         isConfirmed: false,
         confirmedSignal: "WAIT",
         reason: `Price is within ${(loc.distanceToResistancePct * 100).toFixed(2)}% of major resistance. Insufficient clearance for profitable trade.`,
         evidence,
         missingItems: ["Clearance / structural breakout above resistance"]
      };
   }
   if (scenario.primary.bias === "SHORT" && loc.distanceToSupportPct < 0.0025 && !timingGate.passed) {
      return {
         isConfirmed: false,
         confirmedSignal: "WAIT",
         reason: `Price is within ${(loc.distanceToSupportPct * 100).toFixed(2)}% of major support. Insufficient clearance for profitable trade.`,
         evidence,
         missingItems: ["Clearance / structural breakdown below support"]
      };
   }

   // --- LONG CONFIRMATION EVALUATION ---
   if (scenario.primary.bias === "LONG") {
      if (flow.state === "LONG_BUILDUP" || (flow.state === "BUYING_PRESSURE" && regime === "TREND_UP")) {
         evidence.push(`Flow confirmed: ${flow.state} (Persistence: ${flow.persistenceState})`);
      } else {
         missingItems.push("Bullish orderflow buildup");
      }

      if (p.price > p.ema50 && (p.st_bull || p.bull_align || p.HH_HL)) {
         evidence.push("Market structure and EMA trend alignment confirmed");
      } else {
         missingItems.push("Trend and EMA structure alignment");
      }

      if (p.rsi >= 42 && p.rsi <= 68 && p.adx >= 18) {
         evidence.push(`RSI momentum in healthy expansion corridor (${p.rsi.toFixed(1)})`);
      } else {
         if (p.rsi > 68) missingItems.push(`RSI overbought (${p.rsi.toFixed(1)})`);
         if (p.rsi < 42) missingItems.push(`RSI too weak (${p.rsi.toFixed(1)})`);
      }

      if (supportingScore.sl >= 6.8) {
         evidence.push(`Supporting multi-layer indicator score passed (${supportingScore.sl.toFixed(1)}/10)`);
      } else {
         missingItems.push(`Supporting multi-layer score insufficient (${supportingScore.sl.toFixed(1)}/10 < 6.8)`);
      }

      if (missingItems.length === 0) {
         scenario.primary.state = "CONFIRMED";
         return {
            isConfirmed: true,
            confirmedSignal: "LONG",
            reason: "All primary regime, persistent orderflow, timing gate, and location confirmation passed.",
            evidence,
            missingItems: []
         };
      }
   }

   // --- SHORT CONFIRMATION EVALUATION ---
   if (scenario.primary.bias === "SHORT") {
      if (flow.state === "SHORT_BUILDUP" || (flow.state === "SELLING_PRESSURE" && regime === "TREND_DOWN")) {
         evidence.push(`Flow confirmed: ${flow.state} (Persistence: ${flow.persistenceState})`);
      } else {
         missingItems.push("Bearish orderflow buildup");
      }

      if (p.price < p.ema50 && (p.st_bear || p.bear_align || p.LH_LL)) {
         evidence.push("Market structure and EMA downtrend alignment confirmed");
      } else {
         missingItems.push("Downtrend and EMA structure alignment");
      }

      if (p.rsi <= 58 && p.rsi >= 32 && p.adx >= 18) {
         evidence.push(`RSI momentum in healthy downward expansion (${p.rsi.toFixed(1)})`);
      } else {
         if (p.rsi < 32) missingItems.push(`RSI oversold (${p.rsi.toFixed(1)})`);
         if (p.rsi > 58) missingItems.push(`RSI too high for short (${p.rsi.toFixed(1)})`);
      }

      if (supportingScore.ss >= 6.8) {
         evidence.push(`Supporting multi-layer indicator score passed (${supportingScore.ss.toFixed(1)}/10)`);
      } else {
         missingItems.push(`Supporting multi-layer score insufficient (${supportingScore.ss.toFixed(1)}/10 < 6.8)`);
      }

      if (missingItems.length === 0) {
         scenario.primary.state = "CONFIRMED";
         return {
            isConfirmed: true,
            confirmedSignal: "SHORT",
            reason: "All primary regime, persistent orderflow, timing gate, and location confirmation passed.",
            evidence,
            missingItems: []
         };
      }
   }

   return {
      isConfirmed: false,
      confirmedSignal: "WAIT",
      reason: `Confirmation conditions pending: ${missingItems.join("; ")}`,
      evidence,
      missingItems
   };
}

// ----------------------------------------------------------------------------
// 7. MASTER REASONING PIPELINE: evaluateSymbolReasoning
// Integrates full layered pipeline:
// REGIME -> FLOW -> SCENARIO -> LOCATION -> TIMING GATE -> CONFIRMATION
// ----------------------------------------------------------------------------
export function evaluateSymbolReasoning(
   symbol: string,
   ctx: any,
   p: any,
   w: any,
   supportingScore: { sl: number; ss: number }
): ReasoningResult {
   // 1. Market Regime
   const regime = detectMarketRegime(ctx, p);

   // 2. Flow Interpretation & Persistence
   const flow = interpretFlow(p, w);

   // 3. Location & Liquidity
   const location = evaluateLocation(p);

   // 4. Scenarios
   const scenario = generateScenarios(regime, flow, location, p);

   // 5. Timing Gate
   const preferredBias: "LONG" | "SHORT" = supportingScore.sl >= supportingScore.ss ? "LONG" : "SHORT";
   const timingGate = evaluateTimingGate(preferredBias, p, w, location, flow);

   // 6. Confirmation
   const confirmation = checkConfirmation(regime, flow, location, scenario, timingGate, p, w, supportingScore);

   // 7. State Machine Lifecycle
   let lifecycleState: LifecycleState = "OBSERVING";
   if (confirmation.isConfirmed) {
      lifecycleState = "CONFIRMED";
   } else if (scenario.primary.type !== "NONE") {
      lifecycleState = "WAITING_CONFIRMATION";
   } else {
      lifecycleState = "SCENARIO_DETECTED";
   }

   return {
      regime,
      flow,
      location,
      scenario,
      timingGate,
      confirmation,
      lifecycleState,
      supportingScore
   };
}
