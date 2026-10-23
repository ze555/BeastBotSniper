// ============================================================================
// BEASTBOT RANGE REVERSION ENGINE (v3.1.0)
// Smart mean-reversion at RANGE edges.
//
// WHY THIS EXISTS:
//   The legacy system's only RANGE pathway demanded RVOL >= 2.0 AND
//   ADX >= 22 (breakout-style criteria) — effectively banning most RANGE
//   trades and leaving the most common market state unexploited.
//
//   The bot's own research data shows the correct asymmetric edge:
//     - SHORT at RANGE highs during BTC bull regimes = the "goldmine"
//       (92.9% win rate in their forensic study)
//     - LONG at RANGE lows during BTC bull regimes = the "#1 loss maker"
//       (altcoin liquidity drains into BTC; range lows keep breaking)
//
//   This engine fades RANGE EXTREMES only, with exhaustion evidence:
//   normalized CVD divergence, taker-aggression exhaustion, absorption,
//   rejection candle anatomy, and (optionally) real liquidation cascades.
// ============================================================================

import { getLiquidationSnapshot, getTakerPersistence } from "./flowMetrics.js";

export interface RangeReversionInput {
   symbol: string;
   // Price reader output (apexPredator.readPrice)
   p: any;
   // Whale reader output (apexPredator.readWhale) — must include normalized slopes
   w: any;
   // Location analysis from reasoningEngine.evaluateLocation
   loc: any;
   // BTC context regime string (BULL_STRONG, BULL_WEAK, BEAR_STRONG, BEAR_WEAK, RANGING)
   btcRegime: string;
}

export interface RangeReversionSignal {
   signal: "LONG" | "SHORT";
   score: number;              // 0..10 internal conviction score
   entry: number;
   stop: number;               // structural invalidation (beyond range edge)
   target: number;             // opposite range side / mid
   rr: number;
   evidence: string[];
   setupType: "RANGE_REVERSION";
}

const EDGE_PROXIMITY_PCT = 0.006;   // within 0.6% of the range edge
const MIN_RR = 1.5;

function hasBullishRejection(p: any): boolean {
   const last = p.klines?.[p.klines.length - 1];
   return p.l_wick >= p.body * 0.6 || (last ? last.close > last.open : false);
}

function hasBearishRejection(p: any): boolean {
   return p.u_wick >= p.body * 0.6;
}

/**
 * Evaluate a mean-reversion fade of the RANGE edge.
 * Returns null when conditions are not met (caller falls through to WAIT).
 */
export function evaluateRangeReversion(input: RangeReversionInput): RangeReversionSignal | null {
   const { symbol, p, w, loc, btcRegime } = input;
   if (!p || !loc || !w) return null;
   const price = p.price;
   const atr = p.atr14 || (price * 0.01);

   const distToSupport = loc.distanceToSupportPct ?? 1;
   const distToResistance = loc.distanceToResistancePct ?? 1;
   const rangeSizePct = loc.rangeHigh > 0 ? (loc.rangeHigh - loc.rangeLow) / loc.rangeHigh : 0;
   // Range must be tradeable: >= 1.2% tall (else edges are noise)
   if (rangeSizePct < 0.012) return null;

   // --- LIVE/normalized flow exhaustion evidence ---
   const evidence: string[] = [];
   let exhaustionScore = 0;

   const takerPersist = getTakerPersistence(symbol);
   const liq = getLiquidationSnapshot(symbol);

   // --- LONG at range low ---
   // Asymmetry rule: RANGE longs during BTC bull regimes = liquidity drain trap. BLOCK.
   const btcBull = btcRegime.includes("BULL");
   const btcBear = btcRegime.includes("BEAR");

   if (distToSupport >= 0 && distToSupport <= EDGE_PROXIMITY_PCT && !btcBull) {
      if (p.rsi < 38 && p.rsi > 20) {
         exhaustionScore += 1.0;
         evidence.push(`RSI oversold-in-range (${p.rsi.toFixed(1)})`);
      }
      // Normalized CVD selling exhaustion: strongly negative 15m flow fading on 5m
      if (w.slope15N !== undefined && w.slope15N < -0.5 && w.slope5N > w.slope15N * 0.5) {
         exhaustionScore += 1.2;
         evidence.push(`Normalized CVD divergence: 15m flow ${w.slope15N.toFixed(2)} vs 5m ${w.slope5N.toFixed(2)} (selling fading)`);
      }
      // Taker sell aggression exhausted (EMA deep in sell territory but turning up)
      if (takerPersist && takerPersist.ema < 0.45 && takerPersist.emaSlope > 0) {
         exhaustionScore += 1.0;
         evidence.push(`Taker sell exhaustion (EMA ${(takerPersist.ema * 100).toFixed(1)}%, turning up)`);
      }
      // Absorption: hidden buy (price falling while weighted taker pressure positive)
      if (w.hidden_buy) {
         exhaustionScore += 1.0;
         evidence.push("Hidden buy absorption (passive bids eating market sells)");
      }
      // Capitulation cascade: longs wrecked at range low + price stabilizing = fuel spent
      if (liq.cascadeActive && liq.dominantSide === "LONGS" && p.cpos > 0.45) {
         exhaustionScore += 0.8;
         evidence.push(`Long capitulation cascade (intensity ${liq.intensity.toFixed(1)}x) with price stabilizing`);
      }
      // Rejection candle at the edge
      if (hasBullishRejection(p) && p.cpos >= 0.45) {
         exhaustionScore += 0.8;
         evidence.push(`Rejection wick at range low (cpos ${(p.cpos * 100).toFixed(0)}%)`);
      }
      // Crowded shorts funding bonus
      if (w.fundingPercentile !== undefined && w.fundingPercentile <= 20) {
         exhaustionScore += 0.5;
         evidence.push(`Funding at ${w.fundingPercentile.toFixed(0)}th percentile (crowded shorts)`);
      }

      if (exhaustionScore >= 3.2 && !btcBearHardBlock(btcRegime)) {
         const stop = Math.min(loc.nearestSupport, loc.rangeLow) - atr * 0.5;
         const target = loc.rangeLow + (loc.rangeHigh - loc.rangeLow) * 0.5; // range mid
         const rr = (target - price) / Math.max(price - stop, atr * 0.1);
         if (rr >= MIN_RR) {
            return {
               signal: "LONG",
               score: Math.min(10, exhaustionScore * 1.6),
               entry: price,
               stop,
               target,
               rr,
               evidence,
               setupType: "RANGE_REVERSION"
            };
         }
      }
   }

   // --- SHORT at range high ---
   // Allowed in ALL BTC regimes (the measured goldmine), extra conviction in BTC bull.
   if (distToResistance >= 0 && distToResistance <= EDGE_PROXIMITY_PCT) {
      if (p.rsi > 62 && p.rsi < 80) {
         exhaustionScore += 1.0;
         evidence.push(`RSI overbought-in-range (${p.rsi.toFixed(1)})`);
      }
      // Normalized CVD buying exhaustion: strongly positive 15m flow fading on 5m
      if (w.slope15N !== undefined && w.slope15N > 0.5 && w.slope5N < w.slope15N * 0.5) {
         exhaustionScore += 1.2;
         evidence.push(`Normalized CVD divergence: 15m flow ${w.slope15N.toFixed(2)} vs 5m ${w.slope5N.toFixed(2)} (buying fading)`);
      }
      // Taker buy aggression exhausted
      if (takerPersist && takerPersist.ema > 0.55 && takerPersist.emaSlope < 0) {
         exhaustionScore += 1.0;
         evidence.push(`Taker buy exhaustion (EMA ${(takerPersist.ema * 100).toFixed(1)}%, rolling over)`);
      }
      // Hidden sell distribution
      if (w.hidden_sell) {
         exhaustionScore += 1.0;
         evidence.push("Hidden sell distribution (passive asks eating market buys)");
      }
      // Short squeeze cascade at range high = squeeze fuel spent
      if (liq.cascadeActive && liq.dominantSide === "SHORTS" && p.cpos < 0.55) {
         exhaustionScore += 0.8;
         evidence.push(`Short squeeze cascade (intensity ${liq.intensity.toFixed(1)}x) losing momentum`);
      }
      // Rejection candle at the edge
      if (hasBearishRejection(p) && p.cpos <= 0.55) {
         exhaustionScore += 0.8;
         evidence.push(`Rejection wick at range high (cpos ${(p.cpos * 100).toFixed(0)}%)`);
      }
      // Crowded longs funding bonus
      if (w.fundingPercentile !== undefined && w.fundingPercentile >= 80) {
         exhaustionScore += 0.5;
         evidence.push(`Funding at ${w.fundingPercentile.toFixed(0)}th percentile (crowded longs)`);
      }
      // BTC bull regime = altcoin liquidity drain favors shorts at range highs (forensic edge)
      if (btcBull) {
         exhaustionScore += 0.4;
         evidence.push("BTC bull regime: alt liquidity drain edge for range-high shorts");
      }

      if (exhaustionScore >= 3.2) {
         const stop = Math.max(loc.nearestResistance, loc.rangeHigh) + atr * 0.5;
         const target = loc.rangeHigh - (loc.rangeHigh - loc.rangeLow) * 0.5; // range mid
         const rr = (price - target) / Math.max(stop - price, atr * 0.1);
         if (rr >= MIN_RR) {
            return {
               signal: "SHORT",
               score: Math.min(10, exhaustionScore * 1.6),
               entry: price,
               stop,
               target,
               rr,
               evidence,
               setupType: "RANGE_REVERSION"
            };
         }
      }
   }

   return null;
}

/**
 * Hard block: never catch falling knives when BTC is in STRONG breakdown.
 * Range-long caps are thinner and fail catastrophically in BEAR_STRONG.
 */
function btcBearHardBlock(btcRegime: string): boolean {
   return btcRegime === "BEAR_STRONG";
}
