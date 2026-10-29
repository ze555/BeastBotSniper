// ============================================================================
// ICE — INSTITUTIONAL CONFIRMATION EXIT ENGINE (v3.2) VERIFICATION SUITE
// 12 institutional scenarios: explosion ride, confirmed reversal, strategic
// veto, stop-hunt shield, fake push, score condemnation, trap fingerprint,
// broad support, OI redistribution, and the no-haste debounce guarantee.
// ============================================================================

import {
   computeIceDecision, evaluateIceExit, resetIceState, configureIce, getIceConfig,
   isIceRiding, IceInput
} from "./institutionalExit.js";

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean) {
   if (cond) { console.log(`✅ [PASS] ${name}`); passed++; }
   else { console.error(`❌ [FAIL] ${name}`); failed++; }
}

console.log("\n🧪 RUNNING ICE v3.2 INSTITUTIONAL CONFIRMATION SUITE\n");

// Helper: a SHORT riding a confirmed crash explosion (the user's complaint scenario)
function crashRideShort(overrides: Partial<IceInput> = {}): IceInput {
   return {
      direction: "SHORT",
      profitR: 1.2, peakR: 1.4,
      slope5N: -0.8, slope15N: -1.2, slope4hN: -0.5,
      priceNewExtremeInD: true,
      takerEma: 0.38, takerEmaSlope: -0.02, takerPercentile: 8,
      tickCvd5mN: -0.6,
      oiAvailable: true, oiChg: 0.006, scenario: "INST_SHORT",
      fundingPercentile: 40,
      strongAccumulation: false, strongDistribution: true,
      hiddenBuy: false, hiddenSell: false,
      liqCascadeAgainst: false, liqCascadeWith: true, liqIntensity: 6,
      violenceAlignedWith: true, violenceAgainst: false,
      chg10Pct: -1.6, chg10PrevPct: -1.1, chg5Pct: -0.9, rvol: 2.2, cpos: 0.15,
      ...overrides
   };
}

function mirrorLong(overrides: Partial<IceInput> = {}): IceInput {
   const base = crashRideShort();
   const flip = (v: number) => -v;
   return {
      ...base,
      direction: "LONG",
      profitR: overrides.profitR ?? 1.2,
      slope5N: flip(base.slope5N), slope15N: flip(base.slope15N), slope4hN: flip(base.slope4hN),
      takerEma: 0.62, takerEmaSlope: 0.02, takerPercentile: 92,
      tickCvd5mN: 0.6,
      oiChg: base.oiChg, scenario: "INST_LONG",
      strongDistribution: false, strongAccumulation: true,
      liqCascadeWith: true, violenceAlignedWith: true, violenceAgainst: false,
      chg10Pct: flip(base.chg10Pct), chg10PrevPct: flip(base.chg10PrevPct),
      chg5Pct: flip(base.chg5Pct), cpos: 0.85,
      ...overrides
   };
}

// ---------------------------------------------------------------------------
// 1. THE CRASH COMPLAINT FIX: SHORT in a confirmed collapse → CONTINUE (ride)
// ---------------------------------------------------------------------------
{
   const d = computeIceDecision(crashRideShort());
   assert("crash SHORT: flow-aligned explosion is classified CONTINUE", d.state === "CONTINUE");
   assert("crash SHORT: ride via wave-ride or broad support", d.hardContinue !== null);
   assert("crash SHORT: score is strongly positive for the position", d.score >= 40);
   assert("crash SHORT: trail widened for the ride", d.trailMult === 1.25);
}

// ---------------------------------------------------------------------------
// 2. SAME SHORT when the flow flips (real reversal) → debounce → EXIT
// ---------------------------------------------------------------------------
{
   const t0 = 1_700_000_000_000;
   resetIceState("BTCUSDT");
   const reversal: IceInput = crashRideShort({
      slope5N: 0.55, slope15N: 1.1,        // CVD flipped up hard
      slope4hN: -0.1,                       // strategic frame neutral (no veto)
      takerEma: 0.58, takerEmaSlope: 0.03, // takers buying
      tickCvd5mN: 0.5,
      oiChg: -0.008,                        // positions draining
      scenario: "UNCLEAR",
      strongDistribution: false,
      priceNewExtremeInD: false,           // price stopped making lows
      liqCascadeWith: false, liqCascadeAgainst: false, liqIntensity: 0,
      violenceAlignedWith: false, violenceAgainst: false,   // wave is over
      chg10Pct: -0.3, chg10PrevPct: -1.4,  // tape decelerating hard
      cpos: 0.8                            // closing near the highs
   });
   const e1 = evaluateIceExit("BTCUSDT", reversal, t0);
   assert("reversal eval#1: NO instant exit (بدون عجلة)", e1.state === "WAIT");
   assert("reversal eval#1: pending confirmation flagged", e1.confirmationPending === true && e1.pendingCount === 1);
   assert("reversal eval#1: protection tightened (trail ×0.6)", e1.trailMult === 0.6);
   const e2 = evaluateIceExit("BTCUSDT", reversal, t0 + 30_000);
   assert("reversal eval#2: confirmed EXIT after debounce", e2.state === "EXIT" && e2.hardReversal !== null);
   assert("reversal eval#2: exit reason is Arabic and mentions confirmation", e2.reason.includes("خروج مؤكد"));
}

// ---------------------------------------------------------------------------
// 3. STRATEGIC VETO: 4h flow strongly with the position → soft signature needs 3 evals
// ---------------------------------------------------------------------------
{
   const t0 = 1_700_000_000_000;
   resetIceState("ETHUSDT");
   configureIce({ strategicVeto: true });
   // R2 signature (OI drain + CVD flip) but 4h flow STILL strongly supports the SHORT
   const soft: IceInput = crashRideShort({
      slope5N: 0.6, slope15N: 1.0, slope4hN: -0.6,   // 4h still with the position
      priceNewExtremeInD: false,            // no absolute R1 — test the soft-signature veto
      oiChg: -0.009, scenario: "UNCLEAR",
      profitR: 1.0,
      takerEma: 0.55, takerEmaSlope: 0.01,
      strongDistribution: false,
      violenceAlignedWith: false, liqCascadeWith: false,
      chg10Pct: -0.4, chg10PrevPct: -1.2, cpos: 0.75,
      tickCvd5mN: 0.2
   });
   const s1 = evaluateIceExit("ETHUSDT", soft, t0);
   const s2 = evaluateIceExit("ETHUSDT", soft, t0 + 30_000);
   assert("strategic veto: 2 evals are NOT enough when 4h flow supports", s2.state === "WAIT" && s2.pendingCount === 2);
   const s3 = evaluateIceExit("ETHUSDT", soft, t0 + 60_000);
   assert("strategic veto: 3rd eval confirms the EXIT", s3.state === "EXIT");
}

// ---------------------------------------------------------------------------
// 4. STOP-HUNT SHIELD: violent counter-move WITHOUT flow confirmation → HOLD
// ---------------------------------------------------------------------------
{
   resetIceState("SOLUSDT");
   // LONG +1.5R, BTC violence DOWN against us, but CVD+taker still support us.
   // Score sits in the WAIT band (below ride threshold) to isolate the shield.
   const shakeout: IceInput = mirrorLong({
      violenceAlignedWith: false, violenceAgainst: true,
      liqCascadeAgainst: false, liqCascadeWith: false, liqIntensity: 0,
      takerEma: 0.53, takerEmaSlope: 0.01,   // soft but positive aggression
      strongAccumulation: false,
      chg10Pct: -0.3, chg10PrevPct: 1.0,     // tape wobbled hard against
      cpos: 0.4,
      tickCvd5mN: 0.3
   });
   const d = computeIceDecision(shakeout);
   assert("stop-hunt: trap detected as STOP_HUNT_SUSPECTED", !!d.trapDetected && d.trapDetected.startsWith("STOP_HUNT"));
   assert("stop-hunt: NOT classified EXIT despite the violent wick", d.state !== "EXIT");
   assert("stop-hunt: hard reversal did NOT fire without flow", d.hardReversal === null);
   const e = evaluateIceExit("SOLUSDT", shakeout, 1_700_000_000_000);
   assert("stop-hunt: stateful wrapper also refuses to exit", e.state === "WAIT" && e.reason.includes("نتمسك"));
}

// ---------------------------------------------------------------------------
// 5. FAKE PUSH: aligned violence WITHOUT flow → the push is the trap itself
// ---------------------------------------------------------------------------
{
   const t0 = 1_700_000_000_000;
   resetIceState("WIFUSDT");
   // SHORT +1.0R: price crashes (aligned DOWN violence) but flow refuses to confirm
   const fakePush: IceInput = crashRideShort({
      slope5N: 0.4, slope15N: 0.5,          // CVD actually rising (against our SHORT)
      takerEma: 0.56, takerEmaSlope: 0.02,  // takers buying the dip
      tickCvd5mN: 0.4,
      oiChg: 0.007, scenario: "BULL_TRAP",  // OI rising while flow contradicts price
      strongDistribution: false,
      priceNewExtremeInD: true,             // price makes NEW LOWS without flow
      violenceAlignedWith: true, liqCascadeWith: false, liqIntensity: 0,
      chg10Pct: -1.2, chg10PrevPct: -0.8, cpos: 0.1,
      profitR: 1.0
   });
   const d = computeIceDecision(fakePush);
   assert("fake push: R1 flow-departure signature fires (new extreme, flow refuses)", d.hardReversal !== null && d.hardReversal.includes("R1"));
   const e1 = evaluateIceExit("WIFUSDT", fakePush, t0);
   const e2 = evaluateIceExit("WIFUSDT", fakePush, t0 + 30_000);
   assert("fake push: exits AFTER double confirmation (trap caught before execution)", e1.state === "WAIT" && e2.state === "EXIT");
}

// ---------------------------------------------------------------------------
// 6. OVERWHELMING CONDEMNATION: 3+ layers against, no single hard pair → EXIT
// ---------------------------------------------------------------------------
{
   const t0 = 1_700_000_000_000;
   resetIceState("ARBUSDT");
   const condemned: IceInput = crashRideShort({
      slope5N: 0.1, slope15N: 0.4, slope4hN: -0.05,   // CVD mildly against (a15=-0.4)
      takerEma: 0.56, takerEmaSlope: -0.02,            // aggression flipped against
      tickCvd5mN: null,
      oiAvailable: true, oiChg: 0.0, scenario: "UNCLEAR",
      strongAccumulation: true,                         // heavy flow AGAINST the SHORT
      hiddenBuy: false, hiddenSell: false,
      liqCascadeWith: false, liqCascadeAgainst: true, liqIntensity: 2,  // cascade against, below R4 bar
      violenceAlignedWith: false, violenceAgainst: false,
      chg10Pct: 0.5, chg10PrevPct: 0.2, cpos: 0.9,     // tape accelerating against, stalling
      priceNewExtremeInD: false
   });
   const e1 = evaluateIceExit("ARBUSDT", condemned, t0);
   assert("condemnation: ≥3 layers against with collapsed score exits", e1.state === "EXIT" && e1.score <= -40);
   assert("condemnation: exit cites the layers not a hard pair", e1.reason.includes("إدانة") && e1.hardReversal === null);
}

// ---------------------------------------------------------------------------
// 7. TRAP FINGERPRINT R5: BULL_TRAP scenario + whale distribution → EXIT
// ---------------------------------------------------------------------------
{
   const t0 = 1_700_000_000_000;
   resetIceState("LINKUSDT");
   const trap: IceInput = mirrorLong({
      scenario: "BULL_TRAP",        // OI rising while flow contradicts the LONG
      strongAccumulation: false, strongDistribution: true,
      takerEma: 0.45, takerEmaSlope: -0.01,
      slope5N: -0.2, slope15N: -0.4, slope4hN: 0.1,
      tickCvd5mN: -0.2,
      chg10Pct: 0.4, chg10PrevPct: 0.9, cpos: 0.5,
      priceNewExtremeInD: false,
      violenceAlignedWith: false, violenceAgainst: false,
      liqCascadeWith: false, liqCascadeAgainst: false, liqIntensity: 0
   });
   const d = computeIceDecision(trap);
   assert("trap fingerprint: R5 fires with whale confirmation", d.hardReversal !== null && d.hardReversal.includes("R5"));
   const e2 = evaluateIceExit("LINKUSDT", trap, t0 + 30_000);
   evaluateIceExit("LINKUSDT", trap, t0);
   const e3 = evaluateIceExit("LINKUSDT", trap, t0 + 60_000);
   assert("trap fingerprint: exits after full debounce", e2.state === "EXIT" || e3.state === "EXIT");
}

// ---------------------------------------------------------------------------
// 8. NEUTRAL NOISE: everything ~0 → WAIT with untouched trail
// ---------------------------------------------------------------------------
{
   resetIceState("OPUSDT");
   const noise: IceInput = crashRideShort({
      slope5N: 0.05, slope15N: 0.08, slope4hN: 0.02,
      takerEma: 0.50, takerEmaSlope: 0, takerPercentile: 50,
      tickCvd5mN: null,
      oiAvailable: true, oiChg: 0.0005, scenario: "UNCLEAR",
      fundingPercentile: 50,
      strongAccumulation: false, strongDistribution: false,
      liqCascadeWith: false, liqCascadeAgainst: false, liqIntensity: 0,
      violenceAlignedWith: false, violenceAgainst: false,
      chg10Pct: 0.05, chg10PrevPct: 0.04, rvol: 1.0, cpos: 0.5,
      priceNewExtremeInD: false, profitR: 0.3
   });
   const e = evaluateIceExit("OPUSDT", noise, 1_700_000_000_000);
   assert("noise: WAIT, no pending, no trail change", e.state === "WAIT" && !e.confirmationPending && e.trailMult === null);
   assert("noise: score near zero", Math.abs(e.score) <= 15);
}

// ---------------------------------------------------------------------------
// 9. OI FEED DOWN: weight redistributed, no crash, no false objection
// ---------------------------------------------------------------------------
{
   const d = computeIceDecision(crashRideShort({ oiAvailable: false }));
   assert("OI down: engine still rides the crash (CONTINUE)", d.state === "CONTINUE");
   const oiLayer = d.votes.find(v => v.layer === "oi");
   assert("OI down: layer abstains as unavailable", oiLayer?.available === false);
   const totalW = d.votes.filter(v => v.available).reduce((a, v) => a + v.weight, 0);
   assert("OI down: weights redistribute to exactly 80", totalW === 80);
}

// ---------------------------------------------------------------------------
// 10. C1 BROAD SUPPORT on a LONG (mirror of the crash ride)
// ---------------------------------------------------------------------------
{
   const d = computeIceDecision(mirrorLong());
   assert("mirror LONG explosion: CONTINUE", d.state === "CONTINUE");
   assert("mirror LONG: broad support signature C1 fires", d.hardContinue !== null && d.hardContinue.includes("C1"));
   assert("mirror LONG: support count ≥3 with zero opposition", d.votes.filter(v => v.available && v.vote >= 1).length >= 3 && d.votes.every(v => v.vote > -1));
}

// ---------------------------------------------------------------------------
// 11. PENDING RECOVERY: signature vanishes before confirmation → pending cleared
// ---------------------------------------------------------------------------
{
   const t0 = 1_700_000_000_000;
   resetIceState("PEPEUSDT");
   const bad: IceInput = crashRideShort({ slope5N: 0.6, slope15N: 1.0, oiChg: -0.008, scenario: "UNCLEAR", strongDistribution: false, violenceAlignedWith: false, liqCascadeWith: false, chg10Pct: -0.3, chg10PrevPct: -1.3, cpos: 0.85, takerEma: 0.56, takerEmaSlope: 0.02, tickCvd5mN: 0.4 });
   const good: IceInput = crashRideShort();
   evaluateIceExit("PEPEUSDT", bad, t0);                       // candidate seen
   const recovered = evaluateIceExit("PEPEUSDT", good, t0 + 30_000);  // flow back with us
   assert("recovery: signature vanished → no exit, ride resumes", recovered.state === "CONTINUE");
   const again = evaluateIceExit("PEPEUSDT", bad, t0 + 60_000);
   assert("recovery: a NEW candidate starts counting from scratch", again.confirmationPending === true && again.pendingCount === 1);
}

// ---------------------------------------------------------------------------
// 12. CONFIG GUARDS + score bounds sanity
// ---------------------------------------------------------------------------
{
   configureIce({ exitScore: -999, continueScore: 999 });
   const c = getIceConfig();
   assert("config guard: exitScore clamped to [-90,-20]", c.exitScore === -90);
   assert("config guard: continueScore clamped to [20,90]", c.continueScore === 90);
   configureIce({ exitScore: -55, continueScore: 50 });   // restore defaults
   const inputs = [crashRideShort(), mirrorLong(), crashRideShort({ oiAvailable: false })];
   assert("score bounds: always within [-100,+100]", inputs.every(i => Math.abs(computeIceDecision(i).score) <= 100));
}

// ---------------------------------------------------------------------------
// 13. SUSTAINED DANGER: grinding condemnation (score −46, 3 layers against)
//     exits after 4 consecutive evals — the slow-bleed verdict (CBRSUSDT case)
// ---------------------------------------------------------------------------
{
   const t0 = 1_700_000_000_000;
   resetIceState("BTCUSDT");
   const grind = crashRideShort({
      slope5N: 0.5, slope15N: 1.05, slope4hN: -0.05,     // a15 = −1.05, a5 = −0.5 → cvd −2
      takerEma: 0.56, takerEmaSlope: -0.02,              // taker −1
      oiAvailable: false,
      strongAccumulation: false, strongDistribution: false,
      hiddenBuy: false, hiddenSell: false,
      liqCascadeWith: false, liqCascadeAgainst: false, liqIntensity: 0,
      violenceAlignedWith: false, violenceAgainst: false,
      chg10Pct: 0.5, chg10PrevPct: 0.2, cpos: 0.9,       // tape −2 (stall against)
      priceNewExtremeInD: false, profitR: -1.5
   });
   const e1 = evaluateIceExit("BTCUSDT", grind, t0);
   assert("sustained danger: eval#1 is NOT an instant exit (score in the danger band, above condemnation)", e1.state === "WAIT" && e1.pendingCount === 1 && e1.score > -55 && e1.score <= -40);
   evaluateIceExit("BTCUSDT", grind, t0 + 30_000);
   evaluateIceExit("BTCUSDT", grind, t0 + 60_000);
   const e4 = evaluateIceExit("BTCUSDT", grind, t0 + 90_000);
   assert("sustained danger: 4th consecutive eval confirms the slow-bleed EXIT", e4.state === "EXIT");
   assert("sustained danger: reason cites the sustained count", e4.reason.includes("خطر مستمر"));
}

// ---------------------------------------------------------------------------
// 14. RIDE LATCH: a confirmed wave keeps riding through consensus wobbles —
//     only a reversal candidate or sustained danger releases it
// ---------------------------------------------------------------------------
{
   const t0 = 1_700_000_000_000;
   resetIceState("ETHUSDT");
   const wave = crashRideShort();
   const wobble = crashRideShort({
      slope5N: -0.2, slope15N: -0.3,                       // CVD support weakens
      chg10Pct: -0.5, chg10PrevPct: -1.4,                  // tape decel
      liqCascadeWith: false, liqIntensity: 0, violenceAlignedWith: false
   });
   evaluateIceExit("ETHUSDT", wave, t0);                    // CONTINUE → latch ON
   const duringWobble = evaluateIceExit("ETHUSDT", wobble, t0 + 30_000);
   assert("ride latch: consensus wobble does NOT exit the wave", duringWobble.state !== "EXIT");
   assert("ride latch: still latched after the wobble", isIceRiding("ETHUSDT") === true);
   const recovered = evaluateIceExit("ETHUSDT", wave, t0 + 60_000);
   assert("ride latch: wave re-confirms CONTINUE", recovered.state === "CONTINUE" && isIceRiding("ETHUSDT"));
   // a hard reversal candidate releases the latch
   const flip = crashRideShort({
      slope5N: 0.6, slope15N: 1.1, slope4hN: -0.1,
      takerEma: 0.58, takerEmaSlope: 0.03, tickCvd5mN: 0.5,
      oiChg: -0.008, scenario: "UNCLEAR", strongDistribution: false,
      priceNewExtremeInD: false, liqCascadeWith: false, liqIntensity: 0,
      violenceAlignedWith: false, violenceAgainst: false,
      chg10Pct: -0.3, chg10PrevPct: -1.4, cpos: 0.8
   });
   evaluateIceExit("ETHUSDT", flip, t0 + 90_000);
   assert("ride latch: released by a reversal candidate", isIceRiding("ETHUSDT") === false);
}

console.log(`\n📊 ICE SUITE: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
