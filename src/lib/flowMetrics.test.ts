// ============================================================================
// BEASTBOT FLOW METRICS v3.1.0 VERIFICATION SUITE
// Verifies: CVD normalization (the critical unit-free fix), taker persistence,
// funding distribution, liquidation cascade detection, session logic.
// ============================================================================

import {
   normalizeCvdSlope, cvdStrength, updateTakerRatio, getTakerPersistence,
   updateFunding, ingestLiquidation, getLiquidationSnapshot, recordLiqBaseline,
   getSessionName, TOXIC_HOURS_UTC, SESSION_RISK_MULT
} from "./flowMetrics.js";

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean) {
   if (cond) { console.log(`✅ [PASS] ${name}`); passed++; }
   else { console.error(`❌ [FAIL] ${name}`); failed++; }
}

console.log("\n🧪 RUNNING FLOW METRICS v3.1.0 VERIFICATION SUITE\n");

// ---------------------------------------------------------------------------
// 1. NORMALIZED CVD — same raw slope must mean the same thing on any symbol
// ---------------------------------------------------------------------------
{
   // PEPE: avg bar volume 10,000,000,000 units; raw 15m slope -100,000,000
   const pepe = normalizeCvdSlope(-100_000_000, 10_000_000_000, "1000PEPEUSDT", -5_000_000);
   // BTC: avg bar volume 500 units; raw slope -50
   const btc = normalizeCvdSlope(-50, 500, "BTCUSDT", -30);

   assert("PEPE raw slope of -100M normalizes to -0.01 (noise)", Math.abs(pepe.norm + 0.01) < 1e-9);
   assert("BTC raw slope of -50 normalizes to -0.10 (noise)", Math.abs(btc.norm + 0.10) < 1e-9);
   assert("normalizeCvdSlope handles zero avg volume safely", normalizeCvdSlope(-100, 0).norm === 0);
   assert("cvdStrength classifies extremes", cvdStrength(1.5) === "EXTREME" && cvdStrength(0.5) === "STRONG" && cvdStrength(0.2) === "MODERATE" && cvdStrength(0.05) === "NOISE");

   // z-score: feed a stable history then an outlier
   for (let i = 0; i < 40; i++) normalizeCvdSlope(0, 1000, "ZTESTUSDT", 100); // stable deltas
   const outlier = normalizeCvdSlope(0, 1000, "ZTESTUSDT", 1000);
   assert("z-score flags outlier delta (z > 2)", outlier.z > 2);
}

// ---------------------------------------------------------------------------
// 2. TAKER PERSISTENCE — EMA smoothing + percentile ranking
// ---------------------------------------------------------------------------
{
   // Simulate sustained sell aggression then a turn
   for (let i = 0; i < 30; i++) updateTakerRatio("TAKERTEST", 0.35);
   const p1 = getTakerPersistence("TAKERTEST");
   assert("taker EMA converges toward sell dominance", !!p1 && p1.ema < 0.45);

   for (let i = 0; i < 10; i++) updateTakerRatio("TAKERTEST", 0.62);
   const p2 = getTakerPersistence("TAKERTEST");
   assert("taker EMA rises on buy aggression", !!p2 && p2.ema > 0.45);
   assert("taker percentile is bounded 0..100", !!p2 && p2.percentile >= 0 && p2.percentile <= 100);
   assert("taker EMA slope detects the turn", !!p2 && p2.emaSlope > 0);
}

// ---------------------------------------------------------------------------
// 3. FUNDING PROFILE — percentile vs own history
// ---------------------------------------------------------------------------
{
   for (let i = 0; i < 40; i++) updateFunding("FUNDTEST", 0.0001); // normal 0.01%
   const prof = updateFunding("FUNDTEST", 0.0009); // extreme spike 0.09%
   assert("funding percentile flags extreme spike (>90th)", prof.percentile > 90);
   assert("funding mean tracks history", Math.abs(prof.mean - 0.0001) < 0.00005);
}

// ---------------------------------------------------------------------------
// 4. LIQUIDATION CASCADE — real data path (Binance forceOrder semantics)
// ---------------------------------------------------------------------------
{
   const now = Date.now();
   // Baseline: quiet market
   for (let i = 0; i < 20; i++) {
      ingestLiquidation("LIQTEST", { side: "SELL", notionalUsd: 5_000, ts: now - 200_000 + i * 1000 });
      recordLiqBaseline("LIQTEST");
   }
   // Cascade: massive long liquidations (SELL force orders)
   for (let i = 0; i < 30; i++) {
      ingestLiquidation("LIQTEST", { side: "SELL", notionalUsd: 150_000, ts: now - 60_000 + i * 1000 });
   }
   recordLiqBaseline("LIQTEST");
   const snap = getLiquidationSnapshot("LIQTEST");
   assert("cascade detected", snap.cascadeActive);
   assert("dominant side is LONGS (SELL force orders)", snap.dominantSide === "LONGS");
   assert("intensity well above baseline", snap.intensity > 4);

   // Empty symbol → no cascade, no crash
   const empty = getLiquidationSnapshot("LIQEMPTY");
   assert("empty liquidation snapshot is safe", !empty.cascadeActive && empty.totalUsd === 0);
}

// ---------------------------------------------------------------------------
// 5. SESSION LOGIC — matches researchLogger conventions
// ---------------------------------------------------------------------------
{
   assert("00:30 UTC is ASIA", getSessionName(0, 30) === "ASIA");
   assert("07:59 UTC is ASIA", getSessionName(7, 59) === "ASIA");
   assert("09:00 UTC is LONDON", getSessionName(9) === "LONDON");
   assert("12:59 UTC is LONDON", getSessionName(12, 59) === "LONDON");
   assert("13:00 UTC is LONDON_NY_OVERLAP", getSessionName(13) === "LONDON_NY_OVERLAP");
   assert("16:59 UTC is LONDON_NY_OVERLAP", getSessionName(16, 59) === "LONDON_NY_OVERLAP");
   assert("17:00 UTC is NEW_YORK", getSessionName(17) === "NEW_YORK");
   assert("21:30 UTC is LATE_US", getSessionName(21, 30) === "LATE_US");
   assert("toxic hours are the 10 LIVE-measured loss hours", JSON.stringify(TOXIC_HOURS_UTC) === JSON.stringify([0, 1, 3, 4, 7, 9, 10, 11, 19, 23]));
   assert("gold hours 02/08/12/17 stay tradeable", !TOXIC_HOURS_UTC.includes(2) && !TOXIC_HOURS_UTC.includes(8) && !TOXIC_HOURS_UTC.includes(12) && !TOXIC_HOURS_UTC.includes(17));
   assert("session multipliers are sane", SESSION_RISK_MULT.LONDON === 1.0 && SESSION_RISK_MULT.LONDON_NY_OVERLAP < 1 && SESSION_RISK_MULT.ASIA < 1);
}

console.log("=======================================================");
console.log(`📊 FLOW METRICS TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
console.log("=======================================================");

if (failed > 0) process.exit(1);
process.exit(0);
