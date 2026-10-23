// ============================================================================
// BEASTBOT PULLBACK TIMING GATE + RANGE REVERSION v3.1 VERIFICATION SUITE
// Verifies:
// 1. Pullback scenarios now pass through the DEDICATED retest path
//    (the legacy breakout-only gate could never confirm them)
// 2. RANGE edge reversion signals fire only with exhaustion evidence
// ============================================================================

import { evaluateTimingGate, evaluatePullbackTimingGate } from "./reasoningEngine.js";
import { evaluateRangeReversion } from "./rangeReversion.js";

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean) {
   if (cond) { console.log(`✅ [PASS] ${name}`); passed++; }
   else { console.error(`❌ [FAIL] ${name}`); failed++; }
}

console.log("\n🧪 RUNNING PULLBACK TIMING + RANGE REVERSION v3.1 SUITE\n");

// ---------------------------------------------------------------------------
// 1. PULLBACK TIMING GATE
// ---------------------------------------------------------------------------
{
   // Setup: uptrend, price pulled back to EMA21 with a hammer + flow turning up
   const p = {
      price: 100.2, atr14: 1.0, ema21: 100.0, ema50: 97, rsi: 48,
      taker: 0.53, takerEma: 0.52,
      klines: [{ open: 99.6, high: 100.8, low: 99.9, close: 100.2 }] // hammer-ish: lower wick 0.3, body 0.6
   };
   const w = { slope5: 12, tickCvd1mN: 0.4 };

   const res = evaluatePullbackTimingGate("LONG", p, w);
   assert("pullback LONG at EMA21 zone with reversal evidence => CONFIRMED", res.passed && res.state === "CONFIRMED");

   // Over-extended: price 3 ATR above EMA21
   const pExtended = { ...p, price: 103.5 };
   const resExt = evaluatePullbackTimingGate("LONG", pExtended, w);
   assert("pullback LONG 3x ATR above EMA21 => LATE_EXPANSION (wait)", !resExt.passed && resExt.state === "LATE_EXPANSION");

   // Mid-air: price 1.5 ATR above EMA21, bar low also above the zone => WAITING_FOR_RETEST
   const pMidAir = { ...p, price: 101.5, klines: [{ open: 101.2, high: 101.9, low: 101.0, close: 101.5 }] };
   const resMid = evaluatePullbackTimingGate("LONG", pMidAir, w);
   assert("pullback LONG mid-air => WAITING_FOR_RETEST", !resMid.passed && resMid.state === "WAITING_FOR_RETEST");

   // SHORT mirror: downtrend bounce into EMA21 with rejection
   const ps = {
      price: 99.8, atr14: 1.0, ema21: 100.0, ema50: 103, rsi: 52,
      taker: 0.47, takerEma: 0.48,
      klines: [{ open: 100.4, high: 100.6, low: 99.4, close: 99.8 }] // rejection: upper wick 0.2... ensure >= body*0.5 => body 0.6 -> need 0.3; raise high
   };
   const ps2 = { ...ps, klines: [{ open: 100.4, high: 100.9, low: 99.6, close: 99.8 }] }; // upper wick 0.5 >= 0.3
   const ws = { slope5: -10, tickCvd1mN: -0.4 };
   const resS = evaluatePullbackTimingGate("SHORT", ps2, ws);
   assert("pullback SHORT at EMA21 with rejection => CONFIRMED", resS.passed && resS.state === "CONFIRMED");
}

// ---------------------------------------------------------------------------
// 2. RANGE REVERSION
// ---------------------------------------------------------------------------
{
   // Synthetic range: 100 - 105 (5% tall), price near the LOW
   const loc = {
      nearestSupport: 100.2, nearestResistance: 104.8, rangeHigh: 105, rangeLow: 100,
      distanceToSupportPct: 0.002, distanceToResistancePct: 0.045,
      nearSupport: true, nearResistance: false,
      upperLiquidityTarget: 105.2, lowerLiquidityTarget: 99.8, liquidityData: "unavailable" as const
   };

   const mkP = (over: any = {}) => ({
      price: 100.3, atr14: 0.4, rsi: 30, adx: 15, body: 0.2, l_wick: 0.9, u_wick: 0.05,
      cpos: 0.6, avg_vol: 1000, klines: [{ open: 100.1, high: 100.5, low: 99.9, close: 100.3 }],
      ...over
   });
   const mkW = (over: any = {}) => ({
      slope15N: -0.8, slope5N: -0.2, hidden_buy: true, hidden_sell: false,
      fundingPercentile: 15, ...over
   });

   // BTC RANGING (not bull) + strong exhaustion evidence => LONG at range low
   const sigL = evaluateRangeReversion({ symbol: "REVTEST", p: mkP(), w: mkW(), loc, btcRegime: "RANGING" });
   assert("range reversion LONG fires at range low with exhaustion", !!sigL && sigL.signal === "LONG");
   assert("reversion LONG has structural stop below range", !!sigL && sigL.stop < 100);
   assert("reversion LONG target is range mid", !!sigL && Math.abs(sigL.target - 102.5) < 0.01);
   assert("reversion LONG meets minimum RR 1.5", !!sigL && sigL.rr >= 1.5);

   // BTC BULL regime => the forensic liquidity-drain trap: NO range longs
   const sigBlocked = evaluateRangeReversion({ symbol: "REVTEST", p: mkP(), w: mkW(), loc, btcRegime: "BULL_STRONG" });
   assert("range reversion LONG blocked during BTC bull (forensic trap)", sigBlocked === null);

   // Bear strong => hard block on catching knives
   const sigBear = evaluateRangeReversion({ symbol: "REVTEST", p: mkP(), w: mkW(), loc, btcRegime: "BEAR_STRONG" });
   assert("range reversion LONG blocked during BEAR_STRONG", sigBear === null);

   // No evidence (neutral RSI, no divergence) => no signal
   const sigWeak = evaluateRangeReversion({
      symbol: "REVTEST2", p: mkP({ rsi: 50, l_wick: 0.05, cpos: 0.3 }),
      w: mkW({ slope15N: -0.1, slope5N: -0.1, hidden_buy: false, fundingPercentile: 50 }),
      loc, btcRegime: "RANGING"
   });
   assert("range reversion requires exhaustion evidence", sigWeak === null);

   // Mid-range price => no signal (not at an edge)
   const midLoc = { ...loc, nearestSupport: 100, distanceToSupportPct: 0.03, nearSupport: false };
   const sigMid = evaluateRangeReversion({ symbol: "REVTEST3", p: mkP(), w: mkW(), loc: midLoc, btcRegime: "RANGING" });
   assert("mid-range price never fires", sigMid === null);

   // Tiny range (< 1.2%) => no signal
   const tinyLoc = { ...loc, rangeHigh: 100.5, rangeLow: 100, nearestResistance: 100.45 };
   const sigTiny = evaluateRangeReversion({ symbol: "REVTEST4", p: mkP(), w: mkW(), loc: tinyLoc, btcRegime: "RANGING" });
   assert("tiny ranges are untradeable", sigTiny === null);

   // SHORT at range high (allowed even in BTC bull — the measured goldmine)
   const highLoc = {
      ...loc,
      nearestResistance: 104.8, distanceToResistancePct: 0.002, distanceToSupportPct: 0.045,
      nearResistance: true, nearSupport: false
   };
   const pHigh = mkP({ price: 104.7, rsi: 68, u_wick: 0.9, l_wick: 0.05, cpos: 0.4 });
   const wHigh = mkW({ slope15N: 0.8, slope5N: 0.2, hidden_sell: true, hidden_buy: false, fundingPercentile: 85 });
   const sigS = evaluateRangeReversion({ symbol: "REVTEST5", p: pHigh, w: wHigh, loc: highLoc, btcRegime: "BULL_STRONG" });
   assert("range reversion SHORT fires at range high in BTC bull (goldmine)", !!sigS && sigS.signal === "SHORT");
   assert("reversion SHORT stop above range", !!sigS && sigS.stop > 105);
}

console.log("=======================================================");
console.log(`📊 PULLBACK + REVERSION TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
console.log("=======================================================");

if (failed > 0) process.exit(1);
process.exit(0);
