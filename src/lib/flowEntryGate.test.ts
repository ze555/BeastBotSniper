/**
 * FLOW ENTRY GATE v3.2.1 — test suite
 * Validates the direction-symmetric institutional entry intelligence:
 *   G1 positioning (SHORT_BUILDUP / LONG_BUILDUP only)
 *   G2 liquidity war-zone bands (support mirror / resistance mirror)
 *   G3 exhausted regime (BEAR_STRONG / BULL_STRONG) with cascade override
 * Every rule is anchored to the measured live evidence:
 *   - SELLING_PRESSURE shorts bled -15.66$ (WR 33%) on the fresh log
 *   - support-shelf entries bled -12.49$ (WR 42%)
 *   - BEAR_STRONG entries bled -10.47$ (WR 31%)
 */
import { evaluateFlowEntryGate, configureFlowEntryGate, resetFlowEntryGate, WARZONE_SHELF_PCT, WARZONE_BREAK_PCT } from "./flowEntryGate.js";
import assert from "node:assert";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
   if (cond) { passed++; console.log(`✅ [PASS] ${name}`); }
   else { failed++; console.log(`❌ [FAIL] ${name}`); }
}

console.log("🧪 RUNNING FLOW ENTRY GATE v3.2.1 SUITE");
resetFlowEntryGate();

// ─────────────────────────── G1 POSITIONING ───────────────────────────
// SHORT side — measured: SHORT_BUILDUP +13.77$ vs SELLING_PRESSURE -15.66$
check("G1: SHORT + SHORT_BUILDUP passes",
   !evaluateFlowEntryGate({ side: "SHORT", flowState: "SHORT_BUILDUP", btcRegime: "BEAR_WEAK" }).blocked);

check("G1: SHORT + SELLING_PRESSURE blocked (the -15.66$ chase bucket)",
   evaluateFlowEntryGate({ side: "SHORT", flowState: "SELLING_PRESSURE", btcRegime: "BEAR_WEAK" }).rule === "G1_POSITIONING");

check("G1: SHORT + MIXED blocked",
   evaluateFlowEntryGate({ side: "SHORT", flowState: "MIXED", btcRegime: "BEAR_WEAK" }).blocked);

check("G1: SHORT + BUYING_PRESSURE blocked (fighting opposite accumulation)",
   evaluateFlowEntryGate({ side: "SHORT", flowState: "BUYING_PRESSURE", btcRegime: "BEAR_WEAK" }).blocked);

check("G1: SHORT + UNKNOWN blocked",
   evaluateFlowEntryGate({ side: "SHORT", flowState: "UNKNOWN", btcRegime: "BEAR_WEAK" }).blocked);

// LONG mirror
check("G1: LONG + LONG_BUILDUP passes",
   !evaluateFlowEntryGate({ side: "LONG", flowState: "LONG_BUILDUP", btcRegime: "BULL_WEAK" }).blocked);

check("G1: LONG + BUYING_PRESSURE blocked (mirror chase)",
   evaluateFlowEntryGate({ side: "LONG", flowState: "BUYING_PRESSURE", btcRegime: "BULL_WEAK" }).rule === "G1_POSITIONING");

check("G1: LONG + SELLING_PRESSURE blocked",
   evaluateFlowEntryGate({ side: "LONG", flowState: "SELLING_PRESSURE", btcRegime: "BULL_WEAK" }).blocked);

check("G1: LONG + SHORT_BUILDUP blocked (wrong-side buildup)",
   evaluateFlowEntryGate({ side: "LONG", flowState: "SHORT_BUILDUP", btcRegime: "BULL_WEAK" }).blocked);

check("G1: chase reason names the exhausted flow state",
   evaluateFlowEntryGate({ side: "SHORT", flowState: "SELLING_PRESSURE", btcRegime: "BEAR_WEAK" }).reason.includes("SELLING_PRESSURE"));

// ─────────────────────────── G2 WAR-ZONE ───────────────────────────
// distanceToSupportPct positive = price above support (room to fall).
// Forbidden shelf: (-0.30%, +0.12%) — the stop-hunt war zone.
const base = { side: "SHORT" as const, flowState: "SHORT_BUILDUP", btcRegime: "BEAR_WEAK" };

check("G2: SHORT on the shelf (+0.05% above support) blocked — the -12.49$ bucket",
   evaluateFlowEntryGate({ ...base, distanceToSupportPct: 0.0005 }).rule === "G2_WAR_ZONE");

check("G2: SHORT just under support (-0.20%, unconfirmed poke) blocked",
   evaluateFlowEntryGate({ ...base, distanceToSupportPct: -0.002 }).rule === "G2_WAR_ZONE");

check("G2: SHORT with clean room (+0.5% above support) passes",
   !evaluateFlowEntryGate({ ...base, distanceToSupportPct: 0.005 }).blocked);

check("G2: SHORT confirmed breakdown (-0.5% below support) passes",
   !evaluateFlowEntryGate({ ...base, distanceToSupportPct: -0.005 }).blocked);

check("G2: boundary exactly at shelf edge (+0.12%) passes",
   !evaluateFlowEntryGate({ ...base, distanceToSupportPct: WARZONE_SHELF_PCT }).blocked);

check("G2: boundary just inside shelf (+0.119%) blocked",
   evaluateFlowEntryGate({ ...base, distanceToSupportPct: WARZONE_SHELF_PCT - 0.00001 }).rule === "G2_WAR_ZONE");

check("G2: boundary just inside break side (-0.299%) blocked",
   evaluateFlowEntryGate({ ...base, distanceToSupportPct: -WARZONE_BREAK_PCT + 0.00001 }).rule === "G2_WAR_ZONE");

check("G2: boundary exactly at confirmed break (-0.30%) passes",
   !evaluateFlowEntryGate({ ...base, distanceToSupportPct: -WARZONE_BREAK_PCT }).blocked);

// LONG mirror on resistance
const baseL = { side: "LONG" as const, flowState: "LONG_BUILDUP", btcRegime: "BULL_WEAK" };

check("G2: LONG under the wall (+0.05% below resistance) blocked (mirror)",
   evaluateFlowEntryGate({ ...baseL, distanceToResistancePct: 0.0005 }).rule === "G2_WAR_ZONE");

check("G2: LONG just above resistance (-0.20%, fake poke) blocked (mirror)",
   evaluateFlowEntryGate({ ...baseL, distanceToResistancePct: -0.002 }).rule === "G2_WAR_ZONE");

check("G2: LONG with clean room below resistance (+0.5%) passes (mirror)",
   !evaluateFlowEntryGate({ ...baseL, distanceToResistancePct: 0.005 }).blocked);

check("G2: LONG confirmed breakout above resistance (-0.5%) passes (mirror)",
   !evaluateFlowEntryGate({ ...baseL, distanceToResistancePct: -0.005 }).blocked);

check("G2: SHORT ignores resistance distance (wrong level for side)",
   !evaluateFlowEntryGate({ ...base, distanceToResistancePct: 0.0005 }).blocked);

check("G2: LONG ignores support distance (wrong level for side)",
   !evaluateFlowEntryGate({ ...baseL, distanceToSupportPct: 0.0005 }).blocked);

check("G2: missing distance data does not crash and does not block",
   !evaluateFlowEntryGate({ ...base }).blocked);

// ─────────────────────────── G3 EXHAUSTED REGIME ───────────────────────────
// BEAR_STRONG shorts bled -10.47$ (WR 31%) on the fresh log.
check("G3: SHORT in BEAR_STRONG blocked — the -10.47$ mature-move bucket",
   evaluateFlowEntryGate({ ...base, btcRegime: "BEAR_STRONG" }).rule === "G3_EXHAUSTED_REGIME");

check("G3: SHORT in BEAR_STRONG + live DOWN cascade passes (crash ride)",
   !evaluateFlowEntryGate({ ...base, btcRegime: "BEAR_STRONG", violenceActive: true, violenceDirection: "DOWN" }).blocked);

check("G3: SHORT in BEAR_STRONG + UP cascade still blocked (wrong direction)",
   evaluateFlowEntryGate({ ...base, btcRegime: "BEAR_STRONG", violenceActive: true, violenceDirection: "UP" }).blocked);

check("G3: SHORT in BEAR_STRONG + violence inactive still blocked",
   evaluateFlowEntryGate({ ...base, btcRegime: "BEAR_STRONG", violenceActive: false, violenceDirection: "DOWN" }).blocked);

check("G3: SHORT in BEAR_WEAK not regime-blocked",
   !evaluateFlowEntryGate({ ...base, btcRegime: "BEAR_WEAK" }).blocked);

check("G3: SHORT in TREND_DOWN not regime-blocked (graduated regime handles it)",
   !evaluateFlowEntryGate({ ...base, btcRegime: "TREND_DOWN" }).blocked);

// LONG mirror
check("G3: LONG in BULL_STRONG blocked (mirror mature move)",
   evaluateFlowEntryGate({ ...baseL, btcRegime: "BULL_STRONG" }).rule === "G3_EXHAUSTED_REGIME");

check("G3: LONG in BULL_STRONG + live UP cascade passes (squeeze ride, mirror)",
   !evaluateFlowEntryGate({ ...baseL, btcRegime: "BULL_STRONG", violenceActive: true, violenceDirection: "UP" }).blocked);

check("G3: LONG in BULL_STRONG + DOWN cascade still blocked (mirror)",
   evaluateFlowEntryGate({ ...baseL, btcRegime: "BULL_STRONG", violenceActive: true, violenceDirection: "DOWN" }).blocked);

check("G3: LONG in BULL_WEAK not regime-blocked",
   !evaluateFlowEntryGate({ ...baseL, btcRegime: "BULL_WEAK" }).blocked);

// ─────────────────────────── RULE PRIORITY ───────────────────────────
check("priority: G1 fires before G2 (chase flow reported even inside war-zone)",
   evaluateFlowEntryGate({ side: "SHORT", flowState: "SELLING_PRESSURE", btcRegime: "BEAR_WEAK", distanceToSupportPct: 0.0005 }).rule === "G1_POSITIONING");

check("priority: G2 fires before G3 (war-zone reported even in exhausted regime)",
   evaluateFlowEntryGate({ ...base, btcRegime: "BEAR_STRONG", distanceToSupportPct: 0.0005 }).rule === "G2_WAR_ZONE");

// ─────────────────────────── CONFIG SWITCH ───────────────────────────
configureFlowEntryGate({ enabled: false });
check("config OFF: even the worst chase entry passes",
   !evaluateFlowEntryGate({ side: "SHORT", flowState: "SELLING_PRESSURE", btcRegime: "BEAR_STRONG", distanceToSupportPct: 0.0005 }).blocked);
configureFlowEntryGate({ enabled: true });
check("config back ON: chase entry blocked again",
   evaluateFlowEntryGate({ side: "SHORT", flowState: "SELLING_PRESSURE", btcRegime: "BEAR_WEAK" }).blocked);
resetFlowEntryGate();
check("reset restores enabled default",
   evaluateFlowEntryGate({ side: "SHORT", flowState: "SELLING_PRESSURE", btcRegime: "BEAR_WEAK" }).blocked);

// ─────────────────────────── REASON STRINGS ───────────────────────────
const reasons = [
   evaluateFlowEntryGate({ side: "SHORT", flowState: "SELLING_PRESSURE", btcRegime: "BEAR_WEAK" }).reason,
   evaluateFlowEntryGate({ ...base, distanceToSupportPct: 0.0005 }).reason,
   evaluateFlowEntryGate({ ...base, btcRegime: "BEAR_STRONG" }).reason,
];
check("all block reasons carry the Flow Entry Gate tag",
   reasons.every((r) => r.startsWith("Flow Entry Gate [")));

console.log(`\n📊 FLOW ENTRY GATE SUITE: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
