// ============================================================================
// BeastBotSniper Architecture - Reasoning & Flow Engine
// Transforms indicator scoring into contextual market intelligence:
// MARKET REGIME -> FLOW INTERPRETATION -> MARKET SCENARIOS -> LOCATION -> CONFIRMATION -> RISK -> ENTRY
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
   evidenceFor: string[];
   evidenceAgainst: string[];
   confidence: "HIGH" | "MEDIUM" | "LOW";
   details: {
      pChg: number;
      oiChg: number;
      takerRatio: number;
      rvol: number;
   };
}

export interface LocationAnalysis {
   nearestResistance: number;
   nearestSupport: number;
   distanceToResistancePct: number;
   distanceToSupportPct: number;
   upperLiquidityTarget: number;
   lowerLiquidityTarget: number;
   liquidityData: "unavailable"; // Strict rule: No fake liquidation data
   nearResistance: boolean;
   nearSupport: boolean;
   rangeHigh: number;
   rangeLow: number;
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
   // 1. High Volatility Check: Violent BTC regime or asset RVOL spike with extreme expansion
   if (ctx.regime === "VIOLENT" || ctx.tradeable === false || (p.rvol > 2.8 && p.atr14 > p.atr20 * 1.6)) {
      return "HIGH_VOLATILITY";
   }

   const btcBull = ctx.regime.includes("BULL");
   const btcBear = ctx.regime.includes("BEAR");

   const assetBullAlign = p.price > p.ema50 && p.ema50 > p.ema200 && p.HH_HL;
   const assetBearAlign = p.price < p.ema50 && p.ema50 < p.ema200 && p.LH_LL;

   // 2. Clear Trend Alignments
   if (btcBull && assetBullAlign && p.adx >= 20) {
      return "TREND_UP";
   }
   if (btcBear && assetBearAlign && p.adx >= 20) {
      return "TREND_DOWN";
   }

   // 3. Asset leading own trend if strong structure and high momentum
   if (assetBullAlign && p.adx > 25 && p.price > p.ema21) {
      return "TREND_UP";
   }
   if (assetBearAlign && p.adx > 25 && p.price < p.ema21) {
      return "TREND_DOWN";
   }

   // 4. Transition State: Moving averages crossing or structure breaking
   const structureDivergence = (p.bull_align && p.LH_LL) || (p.bear_align && p.HH_HL);
   const maCompression = Math.abs(p.ema50 - p.ema200) / p.ema200 < 0.008;
   if (structureDivergence || (maCompression && p.adx < 22)) {
      return "TRANSITION";
   }

   // 5. Default Range
   return "RANGE";
}

// ----------------------------------------------------------------------------
// 2. FLOW INTERPRETATION ENGINE: interpretFlow
// Analyzes interplay of Price, OI, CVD, Taker Buy/Sell, Volume.
// Produces qualitative evidence and confidence, NOT ungrounded probabilities.
// ----------------------------------------------------------------------------
export function interpretFlow(p: any, w: any): FlowAnalysis {
   const pChg = w.p_chg || 0;
   const oiChg = w.oi_chg || 0;
   const slope15 = w.slope15 || 0;
   const slope5 = w.slope5 || 0;
   const cvdPositive = slope15 > 0 || (slope15 >= 0 && slope5 > 0);
   const cvdNegative = slope15 < 0 || (slope15 <= 0 && slope5 < 0);
   const takerRatio = p.taker || 0.5; // > 0.50 means Taker Buy dominant
   const rvol = p.rvol || 1.0;

   const evidenceFor: string[] = [];
   const evidenceAgainst: string[] = [];

   // Check for insufficient or neutral data
   if (Math.abs(pChg) < 0.0005 && Math.abs(oiChg) < 0.002 && Math.abs(slope15) < 0.001) {
      return {
         state: "UNKNOWN",
         evidenceFor: ["Low market activity / baseline range"],
         evidenceAgainst: ["Insufficient flow momentum"],
         confidence: "LOW",
         details: { pChg, oiChg, takerRatio, rvol }
      };
   }

   // Interpretations based on orderflow mechanics
   // 1. Long Buildup: Price rising + OI increasing + CVD rising + Taker Buy dominant
   if (pChg > 0.0015 && oiChg > 0.003 && cvdPositive && takerRatio >= 0.51) {
      evidenceFor.push("Price expanding upward (+ " + (pChg * 100).toFixed(2) + "%)");
      evidenceFor.push("Open Interest accumulating (+ " + (oiChg * 100).toFixed(2) + "%)");
      evidenceFor.push("CVD positive across key timeframes");
      evidenceFor.push("Taker buy aggressive pressure (" + (takerRatio * 100).toFixed(1) + "%)");
      if (rvol > 1.3) evidenceFor.push("RVOL confirming participation (" + rvol.toFixed(2) + "x)");

      if (w.fund > 0.04 / 100) evidenceAgainst.push("Funding rate elevated, longs paying premium");
      if (p.rsi > 70) evidenceAgainst.push("RSI entering overbought threshold");

      return {
         state: "LONG_BUILDUP",
         evidenceFor,
         evidenceAgainst,
         confidence: (rvol > 1.2 && takerRatio > 0.54) ? "HIGH" : "MEDIUM",
         details: { pChg, oiChg, takerRatio, rvol }
      };
   }

   // 2. Short Covering: Price rising + OI decreasing + CVD rising + Taker Buy dominant
   if (pChg > 0.0015 && oiChg < -0.002 && cvdPositive) {
      evidenceFor.push("Price moving upward");
      evidenceFor.push("OI declining (- " + Math.abs(oiChg * 100).toFixed(2) + "%) indicating short covering");
      evidenceFor.push("Taker buying driven primarily by short liquidation/closure");
      if (w.fund < 0) evidenceFor.push("Negative funding encouraging short unwinding");

      evidenceAgainst.push("New long positioning is absent (OI not growing)");
      evidenceAgainst.push("Rally may lack structural fuel once shorts finish covering");

      return {
         state: "SHORT_COVERING",
         evidenceFor,
         evidenceAgainst,
         confidence: "MEDIUM",
         details: { pChg, oiChg, takerRatio, rvol }
      };
   }

   // 3. Short Buildup: Price falling + OI increasing + CVD falling + Taker Sell dominant
   if (pChg < -0.0015 && oiChg > 0.003 && cvdNegative && takerRatio <= 0.49) {
      evidenceFor.push("Price dropping (- " + Math.abs(pChg * 100).toFixed(2) + "%)");
      evidenceFor.push("Open interest expanding (+ " + (oiChg * 100).toFixed(2) + "%) on downside");
      evidenceFor.push("CVD downward slope across timeframes");
      evidenceFor.push("Taker sell aggression dominant (" + ((1 - takerRatio) * 100).toFixed(1) + "%)");
      if (rvol > 1.3) evidenceFor.push("Volume expanding on red moves");

      if (w.fund < -0.04 / 100) evidenceAgainst.push("Negative funding elevated, crowded shorts");
      if (p.rsi < 30) evidenceAgainst.push("RSI entering oversold extreme");

      return {
         state: "SHORT_BUILDUP",
         evidenceFor,
         evidenceAgainst,
         confidence: (rvol > 1.2 && takerRatio < 0.46) ? "HIGH" : "MEDIUM",
         details: { pChg, oiChg, takerRatio, rvol }
      };
   }

   // 4. Long Liquidation: Price falling + OI decreasing + CVD falling + Taker Sell dominant
   if (pChg < -0.0015 && oiChg < -0.002 && cvdNegative) {
      evidenceFor.push("Price dropping with sharp decline in open contracts");
      evidenceFor.push("OI flushing (- " + Math.abs(oiChg * 100).toFixed(2) + "%) reflecting long stops / unwinding");
      evidenceAgainst.push("No aggressive new short buildup confirmed");
      evidenceAgainst.push("Potential for sharp mean reversion once long flush completes");

      return {
         state: "LONG_LIQUIDATION",
         evidenceFor,
         evidenceAgainst,
         confidence: "MEDIUM",
         details: { pChg, oiChg, takerRatio, rvol }
      };
   }

   // 5. Absorption: Price not dropping despite heavy CVD sell / Price not rising despite CVD buy
   if ((pChg >= -0.0005 && cvdNegative && takerRatio < 0.45 && w.hidden_buy) ||
       (pChg <= 0.0005 && cvdPositive && takerRatio > 0.55 && w.hidden_sell)) {
      evidenceFor.push("Passive limit orders absorbing aggressive market volume");
      if (w.hidden_buy) evidenceFor.push("Hidden institutional bid absorb confirmed");
      if (w.hidden_sell) evidenceFor.push("Hidden institutional offer absorb confirmed");
      evidenceAgainst.push("High volatility risk if absorption wall fails");

      return {
         state: "ABSORPTION_POSSIBLE",
         evidenceFor,
         evidenceAgainst,
         confidence: "MEDIUM",
         details: { pChg, oiChg, takerRatio, rvol }
      };
   }

   // 6. Buying / Selling Pressure (Directional without notable OI delta)
   if (pChg > 0.001 && takerRatio > 0.53 && cvdPositive) {
      evidenceFor.push("Taker buy dominance without clear OI change");
      return {
         state: "BUYING_PRESSURE",
         evidenceFor,
         evidenceAgainst: ["OI accumulation is stagnant"],
         confidence: "LOW",
         details: { pChg, oiChg, takerRatio, rvol }
      };
   }
   if (pChg < -0.001 && takerRatio < 0.47 && cvdNegative) {
      evidenceFor.push("Taker sell dominance without clear OI change");
      return {
         state: "SELLING_PRESSURE",
         evidenceFor,
         evidenceAgainst: ["OI accumulation is stagnant"],
         confidence: "LOW",
         details: { pChg, oiChg, takerRatio, rvol }
      };
   }

   // 7. Conflicting data -> MIXED
   evidenceAgainst.push("Price and orderflow metrics showing conflicting signals (e.g. Price up vs CVD down)");
   return {
      state: "MIXED",
      evidenceFor: ["Partial orderflow activity observed"],
      evidenceAgainst,
      confidence: "LOW",
      details: { pChg, oiChg, takerRatio, rvol }
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

   // Support and Resistance based on swing pivots
   const priorHighs = highs.length > 1 ? highs.slice(0, -1) : highs;
   const priorLows = lows.length > 1 ? lows.slice(0, -1) : lows;

   // If the current price is pressing past prior highs, nearest resistance is either current high or prior swing high
   const nearestResistance = Math.max(...priorHighs);
   const nearestSupport = Math.min(...priorLows);

   const distanceToResistancePct = (nearestResistance - price) / price;
   const distanceToSupportPct = (price - nearestSupport) / price;

   const rangeHigh = Math.max(...highs);
   const rangeLow = Math.min(...lows);

   // Under resistance threshold: within 0.35% beneath resistance or testing it
   const nearResistance = distanceToResistancePct >= -0.002 && distanceToResistancePct <= 0.0035;
   const nearSupport = distanceToSupportPct >= -0.002 && distanceToSupportPct <= 0.0035;

   return {
      nearestResistance,
      nearestSupport,
      distanceToResistancePct,
      distanceToSupportPct,
      upperLiquidityTarget: nearestResistance,
      lowerLiquidityTarget: nearestSupport,
      liquidityData: "unavailable", // Explicit guarantee: No mock/fake liquidation data used
      nearResistance,
      nearSupport,
      rangeHigh,
      rangeLow
   };
}

// ----------------------------------------------------------------------------
// 4. SCENARIO ENGINE: generateScenarios
// Constructs Primary vs Alternative hypotheses based on Regime + Flow + Location.
// ----------------------------------------------------------------------------
export function generateScenarios(
   regime: MarketRegimeType, 
   flow: FlowAnalysis, 
   loc: LocationAnalysis, 
   p: any
): ScenarioPlan {
   const missingConfirmation: string[] = [];
   let invalidationCondition = "";

   // --- A. TREND_UP or BULLISH BIAS ---
   if (regime === "TREND_UP" || (flow.state === "LONG_BUILDUP" && regime !== "TREND_DOWN")) {
      // If pressing right beneath resistance -> BREAKOUT scenario
      if (loc.nearResistance) {
         missingConfirmation.push("Clean 15m candle close clearly above " + loc.nearestResistance.toFixed(4));
         missingConfirmation.push("RVOL > 1.3 confirming breakout volume");
         missingConfirmation.push("CVD remaining positive without immediate absorption wick");
         invalidationCondition = "Price rejection back below " + (loc.nearestResistance * 0.998).toFixed(4) + " with elevated sell volume";

         return {
            primary: {
               type: "BREAKOUT_LONG",
               state: "WAITING",
               bias: "LONG",
               thesis: "Bullish flow building pressure into key resistance. Breakout expected upon confirmed volume breach."
            },
            alternative: {
               type: "FAKE_BREAKOUT_LONG",
               state: "WAITING",
               bias: "SHORT",
               thesis: "Liquidity grab at resistance followed by sharp absorption and mean-reversion rejection."
            },
            missingConfirmation,
            invalidationCondition
         };
      }

      // If pulling back toward dynamic support (EMA21/EMA50) -> PULLBACK scenario
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

      // Trend Continuation
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

   // --- B. TREND_DOWN or BEARISH BIAS ---
   if (regime === "TREND_DOWN" || (flow.state === "SHORT_BUILDUP" && regime !== "TREND_UP")) {
      // If pressing right above support -> BREAKDOWN scenario
      if (loc.nearSupport) {
         missingConfirmation.push("Clean 15m candle close clearly below " + loc.nearestSupport.toFixed(4));
         missingConfirmation.push("RVOL > 1.3 confirming breakdown volume");
         missingConfirmation.push("CVD remaining negative");
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

      // Pullback short
      if (p.pullback_short || (p.price >= p.ema21 && p.price <= p.ema50)) {
         missingConfirmation.push("Bearish rejection candle off EMA21/EMA50 resistance");
         missingConfirmation.push("Taker sell dominance (Taker < 0.48)");
         invalidationCondition = "Decisive candle close above EMA50 (" + p.ema50.toFixed(4) + ")";

         return {
            primary: {
               type: "PULLBACK_SHORT",
               state: "WAITING",
               bias: "SHORT",
               thesis: "Trend retracement shorting into dynamic resistance with downward flow."
            },
            alternative: {
               type: "REVERSAL_LONG",
               state: "WAITING",
               bias: "LONG",
               thesis: "Trend reversal breaking above EMA structure."
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
            thesis: "Bearish orderflow dominant in downward regime."
         },
         alternative: {
            type: "RANGE_REJECTION_LONG",
            state: "WAITING",
            bias: "NEUTRAL",
            thesis: "Short squeeze bounce."
         },
         missingConfirmation: ["Structural breakdown trigger"],
         invalidationCondition: "Break above swing high at " + loc.nearestResistance.toFixed(4)
      };
   }

   // --- C. RANGE OR TRANSITION ---
   if (loc.nearSupport && (flow.state === "BUYING_PRESSURE" || flow.state === "ABSORPTION_POSSIBLE")) {
      return {
         primary: {
            type: "RANGE_REJECTION_LONG",
            state: "WAITING",
            bias: "LONG",
            thesis: "Support defense in ranging market with signs of buy absorption."
         },
         alternative: {
            type: "BREAKOUT_SHORT",
            state: "WAITING",
            bias: "SHORT",
            thesis: "Floor failure leading to range expansion lower."
         },
         missingConfirmation: ["Rejection wick showing strong bid presence", "Taker buy > 0.52"],
         invalidationCondition: "Clean close below range floor " + loc.nearestSupport.toFixed(4)
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
// 5. CONFIRMATION ENGINE: checkConfirmation
// The strict gatekeeper between Analysis and Trade Execution.
// Enforces: Prediction != Entry, Signal != Confirmation.
// ----------------------------------------------------------------------------
export function checkConfirmation(
   regime: MarketRegimeType,
   flow: FlowAnalysis,
   loc: LocationAnalysis,
   scenario: ScenarioPlan,
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

   // 2. Strict Gate 2: Flow clarity check
   if (flow.state === "MIXED" || flow.state === "UNKNOWN") {
      return {
         isConfirmed: false,
         confirmedSignal: "WAIT",
         reason: `Flow state is ${flow.state}. Conflicting or insufficient orderflow data.`,
         evidence,
         missingItems: ["Clear non-conflicting flow accumulation"]
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

   // 4. Strict Gate 4: Location proximity to resistance (Do NOT buy into immediate ceiling)
   if (scenario.primary.bias === "LONG" && loc.nearResistance) {
      // Must have actual confirmed breakout candle, not just wishing
      const hasBroken = p.price > loc.nearestResistance && p.klines[p.klines.length - 1].close > loc.nearestResistance;
      if (!hasBroken) {
         return {
            isConfirmed: false,
            confirmedSignal: "WAIT",
            reason: `Price is within 0.25% of major resistance (${loc.nearestResistance.toFixed(4)}). Awaiting confirmed breakout candle.`,
            evidence,
            missingItems: [
               `Confirmed 15m candle close above resistance ${loc.nearestResistance.toFixed(4)}`,
               "Breakout volume RVOL > 1.3"
            ]
         };
      }
   }

   // 5. Strict Gate 5: Location proximity to support (Do NOT short into immediate floor)
   if (scenario.primary.bias === "SHORT" && loc.nearSupport) {
      const hasBroken = p.price < loc.nearestSupport && p.klines[p.klines.length - 1].close < loc.nearestSupport;
      if (!hasBroken) {
         return {
            isConfirmed: false,
            confirmedSignal: "WAIT",
            reason: `Price is within 0.25% of major support (${loc.nearestSupport.toFixed(4)}). Awaiting confirmed breakdown candle.`,
            evidence,
            missingItems: [
               `Confirmed 15m candle close below support ${loc.nearestSupport.toFixed(4)}`,
               "Breakdown volume RVOL > 1.3"
            ]
         };
      }
   }

   // --- LONG CONFIRMATION EVALUATION ---
   if (scenario.primary.bias === "LONG") {
      // Flow alignment
      if (flow.state === "LONG_BUILDUP" || (flow.state === "BUYING_PRESSURE" && regime === "TREND_UP")) {
         evidence.push(`Flow confirmed: ${flow.state}`);
      } else {
         missingItems.push("Bullish orderflow buildup");
      }

      // Structure alignment
      if (p.price > p.ema50 && (p.st_bull || p.bull_align || p.HH_HL)) {
         evidence.push("Market structure and EMA trend alignment confirmed");
      } else {
         missingItems.push("Trend and EMA structure alignment");
      }

      // Momentum trigger
      if (p.rsi >= 44 && p.rsi <= 68 && p.adx >= 18) {
         evidence.push(`RSI momentum in healthy expansion corridor (${p.rsi.toFixed(1)})`);
      } else {
         if (p.rsi > 68) missingItems.push(`RSI overbought (${p.rsi.toFixed(1)})`);
         if (p.rsi < 44) missingItems.push(`RSI too weak (${p.rsi.toFixed(1)})`);
      }

      // Supporting Legacy Score as Confirmation Evidence
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
            reason: "All primary regime, orderflow, location, and momentum confirmation gates passed.",
            evidence,
            missingItems: []
         };
      }
   }

   // --- SHORT CONFIRMATION EVALUATION ---
   if (scenario.primary.bias === "SHORT") {
      if (flow.state === "SHORT_BUILDUP" || (flow.state === "SELLING_PRESSURE" && regime === "TREND_DOWN")) {
         evidence.push(`Flow confirmed: ${flow.state}`);
      } else {
         missingItems.push("Bearish orderflow buildup");
      }

      if (p.price < p.ema50 && (p.st_bear || p.bear_align || p.LH_LL)) {
         evidence.push("Market structure and EMA bear trend alignment confirmed");
      } else {
         missingItems.push("Bear trend and EMA structure alignment");
      }

      if (p.rsi <= 56 && p.rsi >= 32 && p.adx >= 18) {
         evidence.push(`RSI downward momentum confirmed (${p.rsi.toFixed(1)})`);
      } else {
         if (p.rsi < 32) missingItems.push(`RSI oversold (${p.rsi.toFixed(1)})`);
         if (p.rsi > 56) missingItems.push(`RSI too strong for short (${p.rsi.toFixed(1)})`);
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
            reason: "All primary regime, orderflow, location, and momentum confirmation gates passed.",
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
// 6. MASTER REASONING PIPELINE: evaluateSymbolReasoning
// Integrates the full layered pipeline without adding new API calls.
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

   // 2. Flow Interpretation
   const flow = interpretFlow(p, w);

   // 3. Location & Liquidity
   const location = evaluateLocation(p);

   // 4. Scenarios
   const scenario = generateScenarios(regime, flow, location, p);

   // 5. Confirmation
   const confirmation = checkConfirmation(regime, flow, location, scenario, p, w, supportingScore);

   // 6. State Machine Determination
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
      confirmation,
      lifecycleState,
      supportingScore
   };
}
