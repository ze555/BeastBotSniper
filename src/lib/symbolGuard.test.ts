// ============================================================================
// SYMBOL GUARD (v3.1.1) VERIFICATION SUITE — Forensic Rule D
// Re-entry loop protection: 2 straight losses on one symbol → cooldown window.
// Validated live: same-symbol loops bled -44 USDT across the deployed book.
// ============================================================================

import {
   recordSymbolResult, isSymbolBlocked, configureSymbolGuard,
   getSymbolGuardConfig, pruneSymbolGuard, resetSymbolGuard
} from "./symbolGuard.js";

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean) {
   if (cond) { console.log(`✅ [PASS] ${name}`); passed++; }
   else { console.error(`❌ [FAIL] ${name}`); failed++; }
}

console.log("\n🧪 RUNNING SYMBOL GUARD v3.1.1 VERIFICATION SUITE\n");

// ---------------------------------------------------------------------------
// 1. Streak accumulation → cooldown fires at the 2nd straight loss
// ---------------------------------------------------------------------------
{
   resetSymbolGuard();
   const t0 = 1_700_000_000_000;

   recordSymbolResult("WIFUSDT", -1.20, t0);                     // loss #1
   const after1 = isSymbolBlocked("WIFUSDT", t0);
   assert("one loss does NOT block", after1.blocked === false && after1.streak === 1);

   recordSymbolResult("WIFUSDT", -0.85, t0 + 600_000);           // loss #2
   const after2 = isSymbolBlocked("WIFUSDT", t0 + 600_000);
   assert("two straight losses trigger the cooldown", after2.blocked === true);
   assert("cooldown reason mentions the streak and symbol", after2.reason.includes("WIFUSDT") && after2.reason.includes("2 consecutive losses"));
   assert("cooldown lasts 240 minutes by default", after2.minutesLeft >= 239 && after2.minutesLeft <= 240);
}

// ---------------------------------------------------------------------------
// 2. Cooldown expires after the window
// ---------------------------------------------------------------------------
{
   resetSymbolGuard();
   const t0 = 1_700_000_000_000;
   recordSymbolResult("PEPEUSDT", -2.0, t0);
   recordSymbolResult("PEPEUSDT", -1.5, t0);
   assert("blocked right after 2 losses", isSymbolBlocked("PEPEUSDT", t0).blocked === true);
   assert("still blocked at 3h59m", isSymbolBlocked("PEPEUSDT", t0 + 239 * 60_000).blocked === true);
   assert("unblocked after 4h01m", isSymbolBlocked("PEPEUSDT", t0 + 241 * 60_000).blocked === false);
}

// ---------------------------------------------------------------------------
// 3. A win resets the streak and lifts an active cooldown
// ---------------------------------------------------------------------------
{
   resetSymbolGuard();
   const t0 = 1_700_000_000_000;
   recordSymbolResult("SOLUSDT", -1.0, t0);
   recordSymbolResult("SOLUSDT", -1.0, t0 + 60_000);
   assert("blocked after 2 losses", isSymbolBlocked("SOLUSDT", t0 + 60_000).blocked === true);

   recordSymbolResult("SOLUSDT", +2.3, t0 + 120_000);            // big win during cooldown
   const afterWin = isSymbolBlocked("SOLUSDT", t0 + 120_000);
   assert("win resets streak", afterWin.streak === 0);
   assert("win lifts the cooldown immediately", afterWin.blocked === false);
}

// ---------------------------------------------------------------------------
// 4. Fee scratches are neutral (neither grow nor reset the streak)
// ---------------------------------------------------------------------------
{
   resetSymbolGuard();
   const t0 = 1_700_000_000_000;
   recordSymbolResult("ARBUSDT", -0.03, t0);                     // scratch (|pnl| <= 0.05)
   assert("scratch does not grow the streak", isSymbolBlocked("ARBUSDT", t0).streak === 0);

   recordSymbolResult("ARBUSDT", -1.0, t0 + 60_000);
   recordSymbolResult("ARBUSDT", +0.02, t0 + 120_000);           // winning scratch mid-streak
   assert("winning scratch does not reset the streak", isSymbolBlocked("ARBUSDT", t0 + 120_000).streak === 1);

   recordSymbolResult("ARBUSDT", -0.9, t0 + 180_000);
   assert("2 real losses still trigger the cooldown", isSymbolBlocked("ARBUSDT", t0 + 180_000).blocked === true);
}

// ---------------------------------------------------------------------------
// 5. Configurable limits (1-loss mode, custom window)
// ---------------------------------------------------------------------------
{
   resetSymbolGuard();
   configureSymbolGuard({ lossStreakLimit: 1, cooldownMinutes: 60 });
   const c = getSymbolGuardConfig();
   assert("config applies", c.lossStreakLimit === 1 && c.cooldownMinutes === 60);

   const t0 = 1_700_000_000_000;
   recordSymbolResult("DOGEUSDT", -0.5, t0);
   const v = isSymbolBlocked("DOGEUSDT", t0);
   assert("single loss blocks in 1-loss mode", v.blocked === true && v.minutesLeft <= 60);
}

// ---------------------------------------------------------------------------
// 6. Different symbols are fully independent
// ---------------------------------------------------------------------------
{
   resetSymbolGuard();
   const t0 = 1_700_000_000_000;
   recordSymbolResult("AAVEUSDT", -1.0, t0);
   recordSymbolResult("AAVEUSDT", -1.0, t0);
   assert("AAVE blocked after its 2 losses", isSymbolBlocked("AAVEUSDT", t0).blocked === true);
   assert("LINK untouched by AAVE's streak", isSymbolBlocked("LINKUSDT", t0).blocked === false && isSymbolBlocked("LINKUSDT", t0).streak === 0);
}

// ---------------------------------------------------------------------------
// 7. Pruning drops state for symbols off the watchlist
// ---------------------------------------------------------------------------
{
   resetSymbolGuard();
   const t0 = 1_700_000_000_000;
   recordSymbolResult("OLDUSDT", -1.0, t0);
   recordSymbolResult("OLDUSDT", -1.0, t0);
   recordSymbolResult("NEWUSDT", -1.0, t0);
   pruneSymbolGuard(new Set(["NEWUSDT"]));
   assert("pruned symbol loses its streak", isSymbolBlocked("OLDUSDT", t0).streak === 0);
   assert("active symbol keeps its streak", isSymbolBlocked("NEWUSDT", t0).streak === 1);
}

// ---------------------------------------------------------------------------
// 8. Open positions are never touched by the guard (interface contract)
// ---------------------------------------------------------------------------
{
   resetSymbolGuard();
   const t0 = 1_700_000_000_000;
   recordSymbolResult("ETHUSDT", -1.4, t0);
   recordSymbolResult("ETHUSDT", -1.2, t0);
   const openTrade = { symbol: "ETHUSDT", direction: "SHORT", status: "OPEN" };
   assert("guard blocks only NEW entries", isSymbolBlocked(openTrade.symbol, t0).blocked === true && openTrade.status === "OPEN");
}

// ---------------------------------------------------------------------------
// 9. R-AWARE CLASSIFICATION (v3.1.2) — the live ETH loop fix
// Tiny-USD emergency exits at reduced risk (-0.12R => ~-$0.10) fell under
// the USDT scratch hole and the loop re-entered forever.
// ---------------------------------------------------------------------------
{
   resetSymbolGuard();
   const t0 = 1_700_000_000_000;
   // tiny USD loss but -0.12R => REAL loss (R-based)
   recordSymbolResult("ETHUSDT", -0.10, t0, -0.12);
   assert("tiny-USD -0.12R counts as a real loss (streak 1)", isSymbolBlocked("ETHUSDT", t0).streak === 1);
   recordSymbolResult("ETHUSDT", -0.11, t0 + 60_000, -0.14);
   assert("second tiny-USD R-loss triggers the cooldown (loop closed)", isSymbolBlocked("ETHUSDT", t0 + 60_000).blocked === true);
}

{
   resetSymbolGuard();
   const t0 = 1_700_000_000_000;
   // R-based wins/scratches
   recordSymbolResult("BTCUSDT", 0.20, t0, 0.3);            // +0.3R tiny USD => WIN
   assert("tiny-USD +0.3R counts as a win (streak 0)", isSymbolBlocked("BTCUSDT", t0).streak === 0);
   recordSymbolResult("BTCUSDT", -0.05, t0 + 60_000, -0.05); // -0.05R => scratch, neutral
   assert("-0.05R scratch is neutral", isSymbolBlocked("BTCUSDT", t0 + 60_000).streak === 0);
   recordSymbolResult("BTCUSDT", -500, t0 + 120_000, -2.0);  // big R loss
   assert("big R loss grows streak to 1", isSymbolBlocked("BTCUSDT", t0 + 120_000).streak === 1);
}

console.log("=======================================================");
console.log(`📊 SYMBOL GUARD TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
console.log("=======================================================");

if (failed > 0) process.exit(1);
process.exit(0);
