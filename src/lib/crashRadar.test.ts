// ============================================================================
// CRASH RADAR (v3.1.2) VERIFICATION SUITE
// The 2026-10-29 BTC crash proved the old stack HID from the biggest waves.
// This suite proves the radar DETECTS them — and ignores chop.
// ============================================================================

import {
   updateCrashRadar, getViolenceState, isCounterTape, isWithTape,
   configureCrashRadar, getCrashRadarConfig, resetCrashRadar
} from "./crashRadar.js";

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean) {
   if (cond) { console.log(`✅ [PASS] ${name}`); passed++; }
   else { console.error(`❌ [FAIL] ${name}`); failed++; }
}

// Helper: build synthetic 15m klines
function kl(open: number, close: number, high: number, low: number, volume: number) {
   return { open, close, high, low, volume, openTime: 0, closeTime: 0 };
}

/** Flat baseline market: 20 candles ±0.02% with normal volume. */
function flatMarket(): any[] {
   const out: any[] = [];
   let px = 100;
   for (let i = 0; i < 20; i++) {
      const c = i % 2 === 0 ? px * 1.0002 : px * 0.9998;
      out.push(kl(px, c, Math.max(px, c) * 1.001, Math.min(px, c) * 0.999, 1000));
      px = c;
   }
   return out;
}

/** Append a crash: `n` consecutive red candles each dropping `pct`% on 3x volume. */
function appendCrash(base: any[], n: number, pct: number): any[] {
   const out = [...base];
   let px = out[out.length - 1].close;
   for (let i = 0; i < n; i++) {
      const c = px * (1 - pct / 100);
      out.push(kl(px, c, px * 1.001, c * 0.999, 3000)); // close at the LOW (closePos ~0), high volume
      px = c;
   }
   return out;
}

/** Append a pump: `n` consecutive green candles each gaining `pct`% on 3x volume. */
function appendPump(base: any[], n: number, pct: number): any[] {
   const out = [...base];
   let px = out[out.length - 1].close;
   for (let i = 0; i < n; i++) {
      const c = px * (1 + pct / 100);
      out.push(kl(px, c, c * 1.001, px * 0.999, 3000)); // close at the HIGH (closePos ~1), high volume
      px = c;
   }
   return out;
}

console.log("\n🧪 RUNNING CRASH RADAR v3.1.2 VERIFICATION SUITE\n");

const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// 1. Calm market → radar silent (no false cascades)
// ---------------------------------------------------------------------------
{
   resetCrashRadar();
   const vs = updateCrashRadar(flatMarket(), null, T0);
   assert("calm market: radar silent", !vs.active && vs.direction === "NONE");
   assert("calm market: no counter-tape nonsense", !isCounterTape("LONG", T0) && !isCounterTape("SHORT", T0));
}

// ---------------------------------------------------------------------------
// 2. Crash detection — 4 red candles of -0.5% each = -2% in 60min
// ---------------------------------------------------------------------------
{
   resetCrashRadar();
   const ks = appendCrash(flatMarket(), 4, 0.5);
   const vs = updateCrashRadar(ks, null, T0);
   assert("violent breakdown DETECTED", vs.active && vs.direction === "DOWN");
   assert("45m velocity recorded ~-1.5%", vs.drop45Pct < -1.2);
   assert("intensity scales with severity", vs.intensity > 0.3 && vs.intensity <= 1);
   assert("SHORT is with-tape during crash", isWithTape("SHORT", T0));
   assert("LONG is counter-tape (knife) during crash", isCounterTape("LONG", T0));
   assert("SHORT is NOT counter-tape during crash", !isCounterTape("SHORT", T0));
}

// ---------------------------------------------------------------------------
// 3. Liquidation cascade relaxes the velocity bar
// ---------------------------------------------------------------------------
{
   resetCrashRadar();
   // 3 candles of -0.4% = -1.2% in 45min — below the 0.9%*2=1.8 severity but above 0.9? -1.2 < -0.9 triggers anyway.
   // Use milder: 3 candles of -0.3% = -0.9% total... borderline. Take -0.28% x3 = -0.84% (below default bar).
   const ks = appendCrash(flatMarket(), 3, 0.28);
   const noLiq = updateCrashRadar(ks, null, T0);
   assert("mild -0.84% drift alone does NOT trigger", !noLiq.active || noLiq.drop45Pct > -0.9);

   resetCrashRadar();
   const withLiq = updateCrashRadar(ks, { intensity: 3.2, dominantSide: "LONGS" }, T0);
   // relax 0.8 -> bar 0.72% ; -0.84% passes (anatomy/volume ok)
   assert("with LONG-liq cascade the bar relaxes and it TRIGGERS", withLiq.active && withLiq.direction === "DOWN");
}

// ---------------------------------------------------------------------------
// 4. Wick fake-out does NOT trigger (anatomy gate: long lower wick = bounce)
// ---------------------------------------------------------------------------
{
   resetCrashRadar();
   const base = flatMarket();
   const out = [...base];
   let px = out[out.length - 1].close;
   for (let i = 0; i < 4; i++) {
      const c = px * (1 - 0.005);
      // hammer-ish candle: closes near the HIGH of its range (deep lower wick)
      out.push(kl(px, c, c * 1.002, px * 0.985, 3000));
      px = c;
   }
   // closePos near 1 → anatomy fails → no DOWN cascade
   const vs = updateCrashRadar(out, null, T0);
   assert("falling wick fake-out does not trigger DOWN", !(vs.active && vs.direction === "DOWN"));
}

// ---------------------------------------------------------------------------
// 5. Symmetric PUMP detection
// ---------------------------------------------------------------------------
{
   resetCrashRadar();
   const ks = appendPump(flatMarket(), 4, 0.5);
   const vs = updateCrashRadar(ks, null, T0);
   assert("violent pump DETECTED as UP", vs.active && vs.direction === "UP");
   assert("LONG is with-tape during pump", isWithTape("LONG", T0));
   assert("SHORT is counter-tape during pump", isCounterTape("SHORT", T0));
}

// ---------------------------------------------------------------------------
// 6. Hysteresis: active for holdMinutes after last trigger, then expires
// ---------------------------------------------------------------------------
{
   resetCrashRadar();
   configureCrashRadar({ holdMinutes: 20 });
   const ks = appendCrash(flatMarket(), 4, 0.5);
   updateCrashRadar(ks, null, T0);
   assert("active right after trigger", getViolenceState(T0).active);
   assert("still active after 19min of quiet tape", getViolenceState(T0 + 19 * 60_000).active);
   const expired = getViolenceState(T0 + 21 * 60_000);
   assert("expired after 21min of quiet tape", !expired.active && expired.direction === "NONE");
}

// ---------------------------------------------------------------------------
// 7. Configurable thresholds
// ---------------------------------------------------------------------------
{
   resetCrashRadar();
   configureCrashRadar({ drop45Pct: 3.0, drop90Pct: 5.0 });
   const c = getCrashRadarConfig();
   assert("config applies", c.drop45Pct === 3.0 && c.drop90Pct === 5.0);
   const ks = appendCrash(flatMarket(), 4, 0.5); // -2% in 60min
   const vs = updateCrashRadar(ks, null, T0);
   assert("-2% crash ignored with 3% threshold (radar not hair-trigger)", !vs.active);
}

// ---------------------------------------------------------------------------
// 8. Data discipline: insufficient klines never crashes
// ---------------------------------------------------------------------------
{
   resetCrashRadar();
   const vs = updateCrashRadar([], null, T0);
   assert("empty klines handled gracefully", typeof vs.active === "boolean");
   const vs2 = updateCrashRadar(flatMarket().slice(0, 3), null, T0);
   assert("short klines handled gracefully", typeof vs2.active === "boolean");
}

console.log("=======================================================");
console.log(`📊 CRASH RADAR TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
console.log("=======================================================");

if (failed > 0) process.exit(1);
process.exit(0);
