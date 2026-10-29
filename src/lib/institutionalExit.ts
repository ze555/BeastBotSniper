// ============================================================================
// ICE — INSTITUTIONAL CONFIRMATION EXIT ENGINE (v3.2)
// محرك التأكيد المؤسساتي للخروج: انعكاس أم انفجار؟ نستمر أم نخرج أم ننتظر؟
// ============================================================================
// MISSION (user mandate, verbatim intent):
//   "مجموعة مؤشرات مؤسساتية تقطع اي شك باليقين المطلق لاتجاه الحركة...
//    لا اريد ان تتوقع او تعطي احتمال فتخرج مبكر ومن ثم تنعكس الحركة فتضيع
//    ربح ولا اريدك ان تنتظر فتضيع في الخسارة... ايعمل مؤشر يؤكد مؤشر اخر
//    باندماجهما... وليس الرئيسية مثل ema and rsi... oi cvd taker...
//    قراره صائب علي فريم 5 او 10 او ساعة... اركب الموجات الانفجارية
//    والانهيارية... وفاجعل البيانات المؤسساتية لك دليل للاستفادة من
//    تلاعبهم والخروج في الوقت المناسب قبل تنفيذ الخدع"
//
// THE CORE LAW (price lies, flow testifies):
//   A price move WITHOUT institutional confirmation is a trap (خداع).
//   Institutional confirmation WITHOUT price is accumulation (تحوّط).
//   Only when PRICE + FLOW + POSITIONING move together is the move REAL.
//
// SIX INSTITUTIONAL LAYERS (NO EMA/RSI — they are excluded by mandate):
//   L1 CVD STRUCTURE        (25%) — normalized CVD slope 5m/15m/4h + price-flow
//                                   divergence (price new extreme while flow refuses)
//   L2 TAKER AGGRESSION     (20%) — EMA persistence of taker buy ratio + slope
//                                   + live tick-CVD corroboration (websocket)
//   L3 POSITIONING OI+FUND  (20%) — open-interest momentum mapped to the four
//                                   institutional scenarios (INST/COVER/LIQ/TRAP)
//                                   + funding crowding percentile
//   L4 WHALE PRESSURE       (15%) — weighted tape pressure: strong_acc/strong_dis
//                                   + hidden absorption (hidden_buy/hidden_sell)
//   L5 CASCADES & WAVE      (12%) — real liquidation cascade direction (websocket
//                                   forceOrder) + BTC violence alignment
//   L6 TAPE VELOCITY        (8%)  — 10-candle momentum + acceleration/deceleration
//                                   + stall-at-extremes detection
//
// HARD SIGNATURES — يقين مطلق (a SINGLE layer can NEVER exit; exit requires a
// CONFLUENCE PAIR where one institution testifies against another's move):
//   R1 FLOW DEPARTURE     price makes a NEW EXTREME in the trade direction while
//                         BOTH CVD and taker aggression refuse (the fake push)
//   R2 CONVICTION DRAIN   OI is DRAINING (positions closing, no new money) while
//                         CVD flips against an extended position (≥ +0.6R)
//   R3 ABSORPTION WALL    hidden distribution against the position (whales selling
//                         into our strength) + taker aggression flipping against
//   R4 CASCADE AGAINST    a REAL liquidation cascade (≥5x baseline) hits the
//                         position's side AND BTC violence confirms against
//   R5 TRAP FINGERPRINT   the OI scenario classifier itself prints BULL_TRAP /
//                         BEAR_TRAP against the position AND whale pressure agrees
//   C1 BROAD SUPPORT      ≥3 layers support the position, ZERO oppose → ride
//   C2 WAVE RIDE          BTC violence aligned + CVD supports + OI does not
//                         object → ride the collapse/pump (the crash complaint fix)
//
// THREE-STATE DECISION (نستمر / نخرج / ننتظر):
//   CONTINUE → ride mode: trail widened ×1.25 so explosions breathe
//   EXIT     → only after CONFIRMATION (debounce): the hard signature must
//              survive a second evaluation ~1 minute later (بدون عجلة), or the
//              cross-layer score is overwhelming (≤ −55 with ≥3 layers against)
//   WAIT     → hold the original plan untouched; candidate signatures only TIGHTEN
//              protection (trail ×0.6) while awaiting confirmation
//
// TRAP SHIELD — خداع المضاربين (the manipulation lens):
//   STOP-HUNT SUSPECTED: violent counter-move WITHOUT flow confirmation
//     → CVD+taker both ≥ 0 while BTC violence rages against us → this is the
//       shakeout. WE HOLD. (This is what speculators do to eat stops.)
//   FAKE-PUSH SUSPECTED: violent move ALIGNED with us WITHOUT flow confirmation
//     → the "direction" is an illusion; we refuse to relax protection, and if
//       price prints a new extreme while flow refuses (R1 forming) the trap
//       becomes the exit signal itself — we leave BEFORE the trap executes.
//
// STRATEGIC VETO (فريم الساعة):
//   When 4h institutional flow STRONGLY supports the position (slope4hN ≥ 0.35
//   in direction), soft signatures (R2/R3/R5) require a THIRD consecutive
//   confirmation — the strategic flow outranks a single tactical dissent.
//   R1 (flow departure) and R4 (cascade against) are absolute and bypass it.
// ============================================================================

export type IceDirection = "LONG" | "SHORT";

export interface IceInput {
   direction: IceDirection;
   /** current profit in R multiples (mark-to-market) */
   profitR: number;
   /** peak profit reached so far (R) */
   peakR: number;

   // ── L1 CVD structure (normalized, unit-free) ──
   slope5N: number;
   slope15N: number;
   slope4hN: number;
   /** true when price just printed a NEW 10-candle extreme in the trade direction */
   priceNewExtremeInD: boolean;

   // ── L2 taker aggression ──
   takerEma: number;          // 0..1, 0.5 = neutral
   takerEmaSlope: number;     // recent EMA drift (positive = buy aggression growing)
   takerPercentile: number;   // 0..100 vs rolling history
   /** live websocket 5m tick CVD normalized by per-minute volume (null when feed down) */
   tickCvd5mN: number | null;

   // ── L3 positioning ──
   oiAvailable: boolean;
   oiChg: number;             // fractional change (e.g. -0.008 = -0.8%) over ~45min
   scenario: string;          // INST_LONG | INST_SHORT | SHORT_COVER | LONG_LIQ | BULL_TRAP | BEAR_TRAP | UNCLEAR
   fundingPercentile: number; // 0..100 (100 = most positive funding ever seen for symbol)

   // ── L4 whale pressure ──
   strongAccumulation: boolean;
   strongDistribution: boolean;
   hiddenBuy: boolean;        // CVD falls but weighted tape buys => absorption supporting LONGs
   hiddenSell: boolean;       // CVD rises but weighted tape sells => distribution against LONGs

   // ── L5 cascades & wave ──
   liqCascadeAgainst: boolean;   // real cascade wrecking OUR side
   liqCascadeWith: boolean;      // cascade fueling OUR direction
   liqIntensity: number;         // cascade intensity vs baseline
   violenceAlignedWith: boolean; // BTC 15m cascade aligned with position
   violenceAgainst: boolean;     // BTC 15m cascade against position

   // ── L6 tape velocity ──
   chg10Pct: number;          // core-frame 10-candle % change (15m => 150min)
   chg10PrevPct: number;      // previous 10-candle window (acceleration compare)
   chg5Pct: number;           // 5m frame 10-candle % change (tactical)
   rvol: number;              // relative volume of the last candle
   /** closing position inside the candle range (0..1) — extreme against D = stall */
   cpos: number;
}

export interface IceVote {
   layer: string;
   name: string;
   vote: number;      // -2 .. +2 (from the POSITION's perspective)
   weight: number;
   available: boolean;
}

export interface IceDecision {
   state: "CONTINUE" | "EXIT" | "WAIT";
   /** -100..+100 institutional consensus from the position's perspective */
   score: number;
   votes: IceVote[];
   /** which hard reversal signature fired (null when none) */
   hardReversal: string | null;
   /** which hard continuation signature fired (null when none) */
   hardContinue: string | null;
   /** manipulation classification when detected */
   trapDetected: string | null;
   /** true when a reversal candidate was seen ONCE and awaits confirmation (ننتظر مع شد الحماية) */
   confirmationPending: boolean;
   /** trail multiplier to apply this cycle: 1.25 ride / 0.6 protect / null untouched */
   trailMult: number | null;
   /** evaluations the current pending signature has survived */
   pendingCount: number;
   reason: string;
}

export interface IceConfig {
   /** score below this with ≥3 layers against → exit even without a hard pair */
   exitScore: number;          // -55
   /** score below this with ≥2 layers against, SUSTAINED → exit (slow-bleed gate) */
   dangerScore: number;        // -40
   /** consecutive evals the danger state must persist (بدون عجلة for loss cuts) */
   dangerEvals: number;        // 4
   /** score above this with zero opposing votes → ride mode */
   continueScore: number;      // +50
   /** min ms between the two confirming evaluations (engine loop = 30s) */
   debounceMs: number;         // 20000
   /** require 3rd confirmation for soft signatures when 4h flow strongly supports */
   strategicVeto: boolean;     // true
}

const DEFAULTS: IceConfig = { exitScore: -55, dangerScore: -40, dangerEvals: 4, continueScore: 50, debounceMs: 20_000, strategicVeto: true };
let cfg: IceConfig = { ...DEFAULTS };

export function configureIce(opts: Partial<IceConfig>) {
   if (opts.exitScore !== undefined) cfg.exitScore = Math.max(-90, Math.min(-20, Number(opts.exitScore)));
   if (opts.dangerScore !== undefined) cfg.dangerScore = Math.max(-80, Math.min(-25, Number(opts.dangerScore)));
   if (opts.dangerEvals !== undefined) cfg.dangerEvals = Math.max(2, Math.min(10, Number(opts.dangerEvals)));
   if (opts.continueScore !== undefined) cfg.continueScore = Math.max(20, Math.min(90, Number(opts.continueScore)));
   if (opts.debounceMs !== undefined) cfg.debounceMs = Math.max(0, Number(opts.debounceMs));
   if (opts.strategicVeto !== undefined) cfg.strategicVeto = !!opts.strategicVeto;
}

export function getIceConfig(): IceConfig { return { ...cfg }; }

// ---------------------------------------------------------------------------
// Per-symbol debounce state (بدون عجلة — no decision on a single observation)
// ---------------------------------------------------------------------------
interface IcePendingState {
   sig: string;
   firstSeenMs: number;
   count: number;
}
const pendingMap = new Map<string, IcePendingState>();

// RIDE LATCH (نستمر حتى الانعكاس المؤكد): once institutional consensus grants
// ride mode, the position KEEPS riding until a confirmed reversal / sustained
// danger engages — a momentary C1 wobble does not decapitate the wave.
const rideLatch = new Map<string, boolean>();

/** True while the position on `symbol` holds an active ride latch. */
export function isIceRiding(symbol: string): boolean {
   return rideLatch.get(symbol.toUpperCase()) === true;
}

export function resetIceState(symbol?: string) {
   if (symbol) {
      pendingMap.delete(symbol.toUpperCase());
      rideLatch.delete(symbol.toUpperCase());
   } else {
      pendingMap.clear();
      rideLatch.clear();
   }
}

export function pruneIceStore(activeSymbols: Set<string>) {
   for (const key of pendingMap.keys()) {
      if (!activeSymbols.has(key)) pendingMap.delete(key);
   }
   for (const key of rideLatch.keys()) {
      if (!activeSymbols.has(key)) rideLatch.delete(key);
   }
}

// Layer weights (institutional priority order) — sum = 100
const W = { cvd: 25, taker: 20, oi: 20, whale: 15, cascade: 12, tape: 8 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// PURE CORE — computeIceDecision
// Deterministic, no clocks, no module state. Fully unit-testable.
// ---------------------------------------------------------------------------
export function computeIceDecision(input: IceInput): IceDecision {
   const s = input.direction === "LONG" ? 1 : -1;
   const votes: IceVote[] = [];

   // ────────────────────────────────────────────────────────────────────────
   // L1 CVD STRUCTURE (25%) — the flow backbone
   // ────────────────────────────────────────────────────────────────────────
   const a15 = input.slope15N * s;   // >0 => CVD supports the position
   const a5 = input.slope5N * s;
   const a4h = input.slope4hN * s;   // strategic frame
   let cvdVote = 0;
   if (a15 >= 0.5 && a5 >= 0.35) cvdVote = 2;          // strong on BOTH tactical frames
   else if (a15 >= 0.15) cvdVote = 1;                  // meaningful support
   else if (a15 > -0.15) cvdVote = 0;                  // noise zone
   else if (a15 > -1.0 || a5 > -0.35) cvdVote = -1;    // meaningful objection
   else cvdVote = -2;                                  // both frames against
   // Price-flow divergence: price leads INTO a new extreme while flow refuses
   if (input.priceNewExtremeInD && a15 < 0) cvdVote = Math.min(cvdVote, -1);
   if (input.priceNewExtremeInD && a15 <= -0.5 && a5 < 0) cvdVote = -2;
   votes.push({ layer: "cvd", name: "هيكل CVD المُطبّع", vote: cvdVote, weight: W.cvd, available: true });

   // ────────────────────────────────────────────────────────────────────────
   // L2 TAKER AGGRESSION (20%) — who is lifting the offer / hitting the bid
   // ────────────────────────────────────────────────────────────────────────
   const dEma = (input.takerEma - 0.5) * s;        // >0 => aggression supports D
   const dSlope = input.takerEmaSlope * s;         // >0 => aggression growing in D
   let takerVote: number;
   if (dEma >= 0.05 && dSlope >= 0) takerVote = 2;
   else if (dEma >= 0.02) takerVote = 1;
   else if (dEma > -0.02) takerVote = 0;
   else if (dEma > -0.05 || dSlope >= 0) takerVote = -1;
   else takerVote = -2;
   // Live tick-flow corroboration (websocket truth beats candle aggregates)
   if (input.tickCvd5mN !== null && Number.isFinite(input.tickCvd5mN)) {
      const aTick = input.tickCvd5mN * s;
      if (takerVote > 0 && aTick < -0.35) takerVote = 0;   // tick flow contradicts candle optimism
      if (takerVote < 0 && aTick > 0.35) takerVote = 0;    // tick flow contradicts candle pessimism
   }
   votes.push({ layer: "taker", name: "شراسة التيكر", vote: takerVote, weight: W.taker, available: true });

   // ────────────────────────────────────────────────────────────────────────
   // L3 POSITIONING — OI momentum + funding crowding (20%)
   // ────────────────────────────────────────────────────────────────────────
   const alignedScenario =
      (input.direction === "LONG" && input.scenario === "INST_LONG") ||
      (input.direction === "SHORT" && input.scenario === "INST_SHORT");
   const trapScenario =
      (input.direction === "LONG" && input.scenario === "BULL_TRAP") ||
      (input.direction === "SHORT" && input.scenario === "BEAR_TRAP");
   const coverScenario =
      (input.direction === "LONG" && input.scenario === "SHORT_COVER") ||
      (input.direction === "SHORT" && input.scenario === "LONG_LIQ");

   let oiVote = 0;
   let oiAvailable = input.oiAvailable;
   if (!oiAvailable) {
      oiVote = 0; // layer abstains; its weight is redistributed at scoring time
   } else if (trapScenario) {
      oiVote = -2;  // institutional trap fingerprint: OI rises while flow contradicts price
   } else if (alignedScenario) {
      oiVote = input.oiChg >= 0.004 ? 2 : 1;              // new money conviction
   } else if (coverScenario) {
      // OI draining WITH the price move = closing wave, not new conviction.
      // CRASH-MODE NUANCE: during an active aligned cascade the unwind IS the
      // fuel (liquidations beget more of the same) — abstain, don't object.
      oiVote = input.violenceAlignedWith ? 0 : -1;
   } else {
      oiVote = input.oiChg >= 0.002 ? 1 : (input.oiChg <= -0.004 ? -1 : 0);
   }
   // Funding crowding: extremes crowded AGAINST our survival cap the vote
   if (oiAvailable) {
      if (input.fundingPercentile >= 92 && s > 0) oiVote = Math.min(oiVote, -1); // longs overstuffed => squeeze risk
      if (input.fundingPercentile <= 8 && s < 0) oiVote = Math.min(oiVote, -1);  // shorts overstuffed => squeeze risk
   }
   votes.push({ layer: "oi", name: "زخم العقود المفتوحة", vote: oiVote, weight: W.oi, available: oiAvailable });

   // ────────────────────────────────────────────────────────────────────────
   // L4 WHALE PRESSURE & ABSORPTION (15%)
   // ────────────────────────────────────────────────────────────────────────
   const acc = s > 0 ? input.strongAccumulation : input.strongDistribution;
   const dis = s > 0 ? input.strongDistribution : input.strongAccumulation;
   const hiddenWith = s > 0 ? input.hiddenBuy : input.hiddenSell;
   const hiddenAgainst = s > 0 ? input.hiddenSell : input.hiddenBuy;
   let whaleVote = 0;
   if (dis) whaleVote = -2;                       // heavy net flow AGAINST the position
   else if (hiddenAgainst) whaleVote = -1;        // silent distribution into our strength
   else if (acc) whaleVote = 2;                   // heavy net flow WITH the position
   else if (hiddenWith) whaleVote = 1;            // silent absorption supporting us
   votes.push({ layer: "whale", name: "ضغط الحيتان والامتصاص", vote: whaleVote, weight: W.whale, available: true });

   // ────────────────────────────────────────────────────────────────────────
   // L5 LIQUIDATION CASCADES & BTC WAVE (12%)
   // ────────────────────────────────────────────────────────────────────────
   let cascadeVote = 0;
   if (input.liqCascadeAgainst) cascadeVote -= 2;   // the wrecking ball hits our side
   if (input.liqCascadeWith) cascadeVote += 2;      // the wrecking ball is our fuel
   if (input.violenceAlignedWith) cascadeVote += 1;
   if (input.violenceAgainst) cascadeVote -= 1;
   cascadeVote = clamp(cascadeVote, -2, 2);
   votes.push({ layer: "cascade", name: "التصفيات وموجة بيتكوين", vote: cascadeVote, weight: W.cascade, available: true });

   // ────────────────────────────────────────────────────────────────────────
   // L6 TAPE VELOCITY & STALL (8%)
   // ────────────────────────────────────────────────────────────────────────
   const d10 = input.chg10Pct * s;                 // >0 => tape moving in D
   const d10Prev = input.chg10PrevPct * s;
   const accel = d10 - d10Prev;                    // >0 => expansion in D
   let tapeVote: number;
   if (d10 >= 0.30 && accel >= 0 && input.rvol >= 1.4) tapeVote = 2;   // EXPLOSION expanding
   else if (d10 >= 0.15) tapeVote = 1;
   else if (d10 > -0.15) tapeVote = 0;
   else if (d10 > -0.30 || accel >= 0) tapeVote = -1;
   else tapeVote = -2;                                                 // decelerating hard against
   const stallAgainst = input.direction === "LONG" ? input.cpos <= 0.20 : input.cpos >= 0.80;
   if (input.profitR >= 0.8 && stallAgainst) tapeVote = Math.min(tapeVote, -1);  // stall at extremes after a run
   votes.push({ layer: "tape", name: "سرعة الشريط", vote: tapeVote, weight: W.tape, available: true });

   // ────────────────────────────────────────────────────────────────────────
   // CONSENSUS SCORE (weight redistributed over available layers)
   // ────────────────────────────────────────────────────────────────────────
   let weighted = 0, totalWeight = 0;
   for (const v of votes) {
      if (!v.available) continue;
      weighted += v.vote * v.weight / 2;
      totalWeight += v.weight;
   }
   const score = totalWeight > 0 ? Math.round((weighted / totalWeight) * 100) : 0;

   // ────────────────────────────────────────────────────────────────────────
   // HARD SIGNATURES — يقين مطلق (confluence PAIRS, never a single layer)
   // ────────────────────────────────────────────────────────────────────────
   let hardReversal: string | null = null;
   if (input.priceNewExtremeInD && cvdVote <= -1 && takerVote <= -1) {
      hardReversal = "R1:FlowDeparture — سعر بقمم/قيعان جديدة والـCVD والتيكر يرفضان";
   } else if (
      oiAvailable && input.oiChg <= -0.006 && cvdVote <= -1 && input.profitR >= 0.6
   ) {
      hardReversal = "R2:ConvictionDrain — تصريف العقود المفتوحة وانقلاب التدفق على ربح ممتد";
   } else if (hiddenAgainst && takerVote <= -1) {
      hardReversal = "R3:AbsorptionWall — توزيع خفي ضخم مع انقلاب شراسة التيكر";
   } else if (
      input.liqCascadeAgainst && input.liqIntensity >= 5 && input.violenceAgainst
   ) {
      hardReversal = "R4:CascadeAgainst — موجة تصفيات حقيقية تضرب اتجاه الصفقة";
   } else if (trapScenario && whaleVote <= -1) {
      hardReversal = "R5:TrapFingerprint — بصمة فخ مؤسساتية مع تأكيد ضغط الحيتان";
   }

   let hardContinue: string | null = null;
   const supportCount = votes.filter(v => v.available && v.vote >= 1).length;
   const opposeCount = votes.filter(v => v.available && v.vote <= -1).length;
   if (supportCount >= 3 && opposeCount === 0) {
      hardContinue = "C1:BroadSupport — إجماع مؤسساتي واسع بلا اعتراض";
   } else if (input.violenceAlignedWith && cvdVote >= 1 && oiVote >= 0) {
      hardContinue = "C2:WaveRide — موجة مع الاتجاه والتدفق يؤكدها والعقود لا تعترض";
   }

   // ────────────────────────────────────────────────────────────────────────
   // TRAP SHIELD — خداع المضاربين
   // ────────────────────────────────────────────────────────────────────────
   let trapDetected: string | null = null;
   const flowRefutesReversal = cvdVote >= 0 && takerVote >= 0;
   if (input.violenceAgainst && flowRefutesReversal) {
      trapDetected = "STOP_HUNT_SUSPECTED — حركة عكسية عنيفة بلا تأكيد تدفق (صيد ستوبات)";
   } else if (input.violenceAlignedWith && cvdVote <= 0 && takerVote <= 0) {
      trapDetected = "FAKE_PUSH_SUSPECTED — دفعة موهمة باتجاهنا بلا تأكيد تدفق";
   }

   // ────────────────────────────────────────────────────────────────────────
   // THREE-STATE MAPPING (pure — no clocks, no memory)
   //   EXIT: overwhelming cross-layer condemnation (trap-shield vetoed)
   //   WAIT-protect: a hard reversal candidate awaits confirmation (بدون عجلة)
   //   CONTINUE: ride mode — trail widened so explosions breathe
   //   WAIT: hold the original plan untouched
   // The stateful wrapper (evaluateIceExit) upgrades a PENDING candidate to
   // EXIT once the signature survives the confirmation debounce.
   // ────────────────────────────────────────────────────────────────────────
   const opposeCountFinal = votes.filter(v => v.available && v.vote <= -1).length;
   const condemned = score <= cfg.exitScore && opposeCountFinal >= 3;
   const danger = !condemned && score <= cfg.dangerScore && opposeCountFinal >= 2;

   if (hardReversal) {
      return {
         state: "WAIT", score, votes,
         hardReversal, hardContinue, trapDetected,
         confirmationPending: true, trailMult: 0.6, pendingCount: 0,
         reason: `اشتباه انعكاس (${hardReversal}) — ننتظر تأكيداً ثانياً ونشد التتبع | الإجماع ${score}`
      };
   }

   if (condemned && trapDetected === null) {
      return {
         state: "EXIT", score, votes,
         hardReversal: null, hardContinue, trapDetected,
         confirmationPending: false, trailMult: null, pendingCount: 0,
         reason: `إدانة مؤسساتية شاملة: ${opposeCountFinal} طبقات ضد والإجماع ${score} — ${votes.filter(v => v.vote <= -1).map(v => v.layer).join(",")}`
      };
   }

   if (danger && trapDetected === null) {
      // Danger state is upgraded to EXIT by the wrapper once SUSTAINED
      // (dangerEvals consecutive evals) — no single-minute verdicts.
      return {
         state: "WAIT", score, votes,
         hardReversal: null, hardContinue, trapDetected,
         confirmationPending: false, trailMult: 0.6, pendingCount: 0,
         reason: `خطر مؤسساتي متراكم (${opposeCountFinal} طبقات ضد، الإجماع ${score}) — قيد التأكيد المستمر`
      };
   }

   if ((hardContinue || (score >= cfg.continueScore && opposeCountFinal === 0)) ) {
      return {
         state: "CONTINUE", score, votes,
         hardReversal: null, hardContinue, trapDetected,
         confirmationPending: false, trailMult: 1.25, pendingCount: 0,
         reason: `${hardContinue ?? "إجماع قوي بلا اعتراض"} — وضع الركوب، تتبّع موسّع | الإجماع ${score}`
      };
   }

   if (trapDetected) {
      return {
         state: "WAIT", score, votes,
         hardReversal: null, hardContinue, trapDetected,
         confirmationPending: false, trailMult: 1.0, pendingCount: 0,
         reason: `${trapDetected} — نتمسك، التدفق لا يؤكد الحركة العكسية | الإجماع ${score}`
      };
   }

   return {
      state: "WAIT", score, votes,
      hardReversal: null, hardContinue, trapDetected,
      confirmationPending: false, trailMult: null, pendingCount: 0,
      reason: `لا إجماع كافٍ للخروج أو الاستمرار — ننتظر بيانات أقوى | الإجماع ${score}`
   };
}

// ---------------------------------------------------------------------------
// STATEFUL WRAPPER — evaluateIceExit
// Adds the confirmation debounce (2 consecutive evals) + strategic veto
// (3rd eval for soft signatures when 4h flow strongly supports the position).
// ---------------------------------------------------------------------------
export function evaluateIceExit(symbol: string, input: IceInput, nowMs: number = Date.now()): IceDecision {
   const d = computeIceDecision(input);
   const key = symbol.toUpperCase();
   const s = input.direction === "LONG" ? 1 : -1;
   const strategicSupport = (input.slope4hN * s) >= 0.35;

   // ── Hard-signature confirmation debounce (بدون عجلة)
   if (d.hardReversal) {
      rideLatch.delete(key);   // a reversal candidate takes over from ride mode
      const absolute = d.hardReversal.startsWith("R1") || d.hardReversal.startsWith("R4");
      const requiredCount = (cfg.strategicVeto && strategicSupport && !absolute) ? 3 : 2;

      let st = pendingMap.get(key);
      if (!st || st.sig !== d.hardReversal) {
         pendingMap.set(key, { sig: d.hardReversal, firstSeenMs: nowMs, count: 1 });
         st = pendingMap.get(key)!;
      } else if (nowMs - st.firstSeenMs >= cfg.debounceMs) {
         st.count += 1;
         st.firstSeenMs = nowMs;   // each confirming eval refreshes the clock
      }

      if (st.count >= requiredCount) {
         pendingMap.delete(key);
         d.state = "EXIT";
         d.pendingCount = st.count;
         d.confirmationPending = false;
         d.trailMult = null;
         d.reason = `خروج مؤكد بعد ${st.count} تقييمات متتالية — ${d.hardReversal} | الإجماع ${d.score}`;
         return d;
      }

      // first sighting (or still short of required confirmations) → WAIT + protect
      d.state = "WAIT";
      d.confirmationPending = true;
      d.pendingCount = st.count;
      d.trailMult = 0.6;
      d.reason = `اشتباه انعكاس (${d.hardReversal}) — ننتظر التأكيد ${st.count}/${requiredCount} ونشد التتبع | الإجماع ${d.score}`;
      return d;
   }

   // ── SUSTAINED DANGER gate (BEFORE pending cleanup — it owns the counter):
   // score deep-negative with ≥2 layers against, persisting across dangerEvals
   // consecutive evals → the slow-bleed verdict. The stop-hunt shield vetoes it
   // (an unconfirmed violent wick is not danger, it is bait) — but a GRINDING
   // institutional condemnation is real. (A full condemnation already returned
   // EXIT from the pure mapping.)
   const isDanger = d.state !== "EXIT" && d.score <= cfg.dangerScore &&
      d.votes.filter(v => v.available && v.vote <= -1).length >= 2 &&
      d.trapDetected === null;
   if (isDanger) {
      rideLatch.delete(key);   // grinding condemnation takes over from ride mode
      let st = pendingMap.get(key);
      const required = cfg.dangerEvals;
      if (!st || st.sig !== "__DANGER__") {
         pendingMap.set(key, { sig: "__DANGER__", firstSeenMs: nowMs, count: 1 });
         st = pendingMap.get(key)!;
      } else if (nowMs - st.firstSeenMs >= cfg.debounceMs) {
         st.count += 1;
         st.firstSeenMs = nowMs;
      }
      if (st.count >= required) {
         pendingMap.delete(key);
         d.state = "EXIT";
         d.trailMult = null;
         d.reason = `خطر مستمر عبر ${st.count} تقييمات (الإجماع ${d.score}) — نزيف مؤسساتي مؤكد، خروج`;
         return d;
      }
      d.state = "WAIT";
      d.trailMult = 0.6;
      d.confirmationPending = true;
      d.pendingCount = st.count;
      d.reason = `خطر مؤسساتي متراكم (${d.score}) — قيد التأكيد المستمر ${st.count}/${required}`;
      return d;
   }

   // hard signature vanished and no danger state → the earlier sighting was
   // noise; clear the pending
   pendingMap.delete(key);

   // Ride latch bookkeeping: CONTINUE engages it, plain WAIT keeps it.
   if (d.state === "CONTINUE") rideLatch.set(key, true);

   // No hard signature: the pure mapping already decided (condemnation EXIT,
   // ride CONTINUE, trap-shield WAIT, or plain WAIT).
   return d;
}
