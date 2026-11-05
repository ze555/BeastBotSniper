/**
 * FLOW ENTRY GATE v3.3 — test suite
 * Validates the direction-symmetric institutional entry intelligence:
 *   G1 positioning (SHORT_BUILDUP / LONG_BUILDUP only)
 *   G2 runway (clean room / cascade-confirmed break; dead zone measured)
 *   G3 exhausted regime (BEAR_STRONG / BULL_STRONG) with cascade override
 *   G4 late-impulse (never buy the printed candle in mean-reverting tape)
 * Every rule is anchored to measured live evidence:
 *   - SELLING_PRESSURE shorts bled -15.66$ (WR 33%) on the Nov-1 log
 *   - dead entries (MFE<0.3R) sat median +0.44% from support; winners +2.54%
 *   - broken-support chases without a live cascade bled -6.04$ (Nov 3-4)
 *   - BEAR_STRONG entries bled -10.47$ (WR 31%)
 *   - fresh-extreme late entries in BEAR_WEAK: -37.82$ vs quiet-stall winners +16.20$
 */
import { evaluateFlowEntryGate, configureFlowEntryGate, resetFlowEntryGate, RUNWAY_ROOM_PCT, WARZONE_BREAK_PCT } from "./flowEntryGate.js";
import assert from "node:assert";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
   if (cond) { passed++; console.log(`✅ [PASS] ${name}`); }
   else { failed++; console.log(`❌ [FAIL] ${name}`); }
}

console.log("🧪 RUNNING FLOW ENTRY GATE v3.3 SUITE");
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

// ─────────────────────────── G2 RUNWAY ───────────────────────────
// distanceToSupportPct positive = price above support (room to fall).
// Measured dead zone: (-0.30%, +1.0%) — winners entered with median +2.54%
// room; dead entries +0.44%; broken-support chases without a cascade -6.04$.
const base = { side: "SHORT" as const, flowState: "SHORT_BUILDUP", btcRegime: "BEAR_WEAK" };

check("G2: SHORT on the shelf (+0.05% above support) blocked — the -12.49$ bucket",
   evaluateFlowEntryGate({ ...base, distanceToSupportPct: 0.0005 }).rule === "G2_RUNWAY");

check("G2: SHORT just under support (-0.20%, unconfirmed poke) blocked",
   evaluateFlowEntryGate({ ...base, distanceToSupportPct: -0.002 }).rule === "G2_RUNWAY");

check("G2: SHORT in the shallow no-room band (+0.5%) blocked — dead entries bled here",
   evaluateFlowEntryGate({ ...base, distanceToSupportPct: 0.005 }).rule === "G2_RUNWAY");

check("G2: SHORT with clean runway (+1.5% above support) passes",
   !evaluateFlowEntryGate({ ...base, distanceToSupportPct: 0.015 }).blocked);

check("G2: SHORT confirmed breakdown (-0.5% below support) WITHOUT cascade blocked — the -6.04$ exhausted-chase bucket",
   evaluateFlowEntryGate({ ...base, distanceToSupportPct: -0.005 }).rule === "G2_RUNWAY");

check("G2: SHORT confirmed breakdown (-0.5%) WITH live DOWN cascade passes (crash ride)",
   !evaluateFlowEntryGate({ ...base, distanceToSupportPct: -0.005, violenceActive: true, violenceDirection: "DOWN" }).blocked);

check("G2: SHORT confirmed breakdown (-0.5%) with UP cascade still blocked (wrong direction)",
   evaluateFlowEntryGate({ ...base, distanceToSupportPct: -0.005, violenceActive: true, violenceDirection: "UP" }).rule === "G2_RUNWAY");

check("G2: boundary exactly at runway edge (+1.0%) passes",
   !evaluateFlowEntryGate({ ...base, distanceToSupportPct: RUNWAY_ROOM_PCT }).blocked);

check("G2: boundary just inside runway (+0.999%) blocked",
   evaluateFlowEntryGate({ ...base, distanceToSupportPct: RUNWAY_ROOM_PCT - 0.00001 }).rule === "G2_RUNWAY");

check("G2: boundary exactly at confirmed break (-0.30%) passes with cascade",
   !evaluateFlowEntryGate({ ...base, distanceToSupportPct: -WARZONE_BREAK_PCT, violenceActive: true, violenceDirection: "DOWN" }).blocked);

check("G2: boundary just inside break side (-0.299%) blocked even with cascade",
   evaluateFlowEntryGate({ ...base, distanceToSupportPct: -WARZONE_BREAK_PCT + 0.00001, violenceActive: true, violenceDirection: "DOWN" }).rule === "G2_RUNWAY");

// LONG mirror on resistance
const baseL = { side: "LONG" as const, flowState: "LONG_BUILDUP", btcRegime: "BULL_WEAK" };

check("G2: LONG under the wall (+0.05% below resistance) blocked (mirror)",
   evaluateFlowEntryGate({ ...baseL, distanceToResistancePct: 0.0005 }).rule === "G2_RUNWAY");

check("G2: LONG just above resistance (-0.20%, fake poke) blocked without cascade (mirror)",
   evaluateFlowEntryGate({ ...baseL, distanceToResistancePct: -0.002 }).rule === "G2_RUNWAY");

check("G2: LONG in the shallow no-room band (+0.5% below resistance) blocked (mirror)",
   evaluateFlowEntryGate({ ...baseL, distanceToResistancePct: 0.005 }).rule === "G2_RUNWAY");

check("G2: LONG with clean runway (+1.5% below resistance) passes (mirror)",
   !evaluateFlowEntryGate({ ...baseL, distanceToResistancePct: 0.015 }).blocked);

check("G2: LONG confirmed breakout above resistance (-0.5%) WITHOUT cascade blocked (mirror)",
   evaluateFlowEntryGate({ ...baseL, distanceToResistancePct: -0.005 }).rule === "G2_RUNWAY");

check("G2: LONG confirmed breakout (-0.5%) WITH live UP cascade passes (squeeze ride, mirror)",
   !evaluateFlowEntryGate({ ...baseL, distanceToResistancePct: -0.005, violenceActive: true, violenceDirection: "UP" }).blocked);

check("G2: SHORT ignores resistance distance (wrong level for side)",
   !evaluateFlowEntryGate({ ...base, distanceToResistancePct: 0.0005 }).blocked);

check("G2: LONG ignores support distance (wrong level for side)",
   !evaluateFlowEntryGate({ ...baseL, distanceToSupportPct: 0.0005 }).blocked);

check("G2: missing distance data does not crash and does not block",
   !evaluateFlowEntryGate({ ...base }).blocked);

// ─────────────────────────── G3 EXHAUSTED REGIME ───────────────────────────
// BEAR_STRONG shorts bled -10.47$ (WR 31%) on the Nov-1 log.
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

// ─────────────────────────── G4 LATE-IMPULSE ───────────────────────────
// Nov 3-4 forensics: dead entries (MFE<0.3R, -37.82$) jumped on the printed
// impulse candle (fresh 4-bar extreme, median rvol 1.28); winners (+16.20$)
// entered on the quiet stall candle (median rvol 0.64). Mean-reverting
// regimes only — strong trends pay for riding the impulse.
check("G4: SHORT after a fresh 4-bar low in BEAR_WEAK blocked — the -37.82$ late bucket",
   evaluateFlowEntryGate({ ...base, tape: { freshExtreme: true } }).rule === "G4_LATE_IMPULSE");

check("G4: SHORT on the quiet stall candle (no fresh extreme) passes",
   !evaluateFlowEntryGate({ ...base, tape: { freshExtreme: false } }).blocked);

check("G4: LONG after a fresh 4-bar high in BULL_WEAK blocked (mirror)",
   evaluateFlowEntryGate({ ...baseL, tape: { freshExtreme: true } }).rule === "G4_LATE_IMPULSE");

check("G4: fresh extreme + live cascade in our direction passes (crash ride)",
   !evaluateFlowEntryGate({ ...base, tape: { freshExtreme: true }, violenceActive: true, violenceDirection: "DOWN" }).blocked);

check("G4: fresh extreme + cascade AGAINST us still blocked",
   evaluateFlowEntryGate({ ...base, tape: { freshExtreme: true }, violenceActive: true, violenceDirection: "UP" }).rule === "G4_LATE_IMPULSE");

check("G4: fresh extreme in BEAR_STRONG (trend regime) NOT late-blocked — G3 owns that regime",
   evaluateFlowEntryGate({ ...base, btcRegime: "BEAR_STRONG", tape: { freshExtreme: true } }).rule === "G3_EXHAUSTED_REGIME");

check("G4: fresh extreme in RANGE blocked (mean-reverting)",
   evaluateFlowEntryGate({ ...base, btcRegime: "RANGE", tape: { freshExtreme: true } }).rule === "G4_LATE_IMPULSE");

check("G4: fresh extreme in TRANSITION blocked (mean-reverting)",
   evaluateFlowEntryGate({ ...base, btcRegime: "TRANSITION", tape: { freshExtreme: true } }).rule === "G4_LATE_IMPULSE");

check("G4: fresh extreme in TREND_DOWN allowed (asset trend regime, not BTC weak chop)",
   !evaluateFlowEntryGate({ ...base, btcRegime: "TREND_DOWN", tape: { freshExtreme: true } }).blocked);

check("G4: missing tape data does not block",
   !evaluateFlowEntryGate({ ...base }).blocked);

// ─────────────────────────── RULE PRIORITY ───────────────────────────
check("priority: G1 fires before G2 (chase flow reported even inside dead zone)",
   evaluateFlowEntryGate({ side: "SHORT", flowState: "SELLING_PRESSURE", btcRegime: "BEAR_WEAK", distanceToSupportPct: 0.0005 }).rule === "G1_POSITIONING");

check("priority: G2 fires before G3 (runway reported even in exhausted regime)",
   evaluateFlowEntryGate({ ...base, btcRegime: "BEAR_STRONG", distanceToSupportPct: 0.0005 }).rule === "G2_RUNWAY");

check("priority: G3 fires before G4 (exhausted regime reported before late-impulse)",
   evaluateFlowEntryGate({ ...base, btcRegime: "BEAR_STRONG", tape: { freshExtreme: true } }).rule === "G3_EXHAUSTED_REGIME");

// ─────────────────────────── CONFIG SWITCH ───────────────────────────
configureFlowEntryGate({ enabled: false });
check("config OFF: even the worst chase entry passes",
   !evaluateFlowEntryGate({ side: "SHORT", flowState: "SELLING_PRESSURE", btcRegime: "BEAR_STRONG", distanceToSupportPct: 0.0005, tape: { freshExtreme: true } }).blocked);
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
   evaluateFlowEntryGate({ ...base, tape: { freshExtreme: true } }).reason,
];
check("all block reasons carry the Flow Entry Gate tag",
   reasons.every((r) => r.startsWith("Flow Entry Gate [")));

console.log(`\n📊 FLOW ENTRY GATE SUITE: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
