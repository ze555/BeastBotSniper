/** v3.4.2: confirmed directional pressure and risk-relative runway.
 * Strong BTC trends are not exhaustion evidence by themselves. The live
 * caller supplies fresh timing, persistence, structure and actual stop costs.
 * Historical claims in the legacy documentation below are not validation
 * of these new rules; profitability requires independent evaluation.
 */
/**
 * FLOW ENTRY GATE v3.3 — "ادخل على بداية الموجة، لا على بقاياها"
 * ================================================================
 * Direction-SYMMETRIC institutional entry intelligence, validated across
 * THREE independent live logs (Oct 43 shorts, Nov-1-3 35 shorts, Nov-3-4
 * 21 trades on v3.2.1-live) + one real rally window (Aug 19-21 mirror):
 *
 *   OCT  log (v3.1.x, 43 shorts):  all -5.42$  → G1+room +36.10$ (9 trades)
 *   NOV1 log (v3.2,   35 shorts):  all -1.89$  → G1      +13.77$ (20 trades)
 *   NOV3 log (v3.2.1, 20 shorts):  all -21.77$ → fresh-impulse block +10.24$
 *   LONG MIRROR (Aug 19-21 rally):  9 symbols, 100% WR, avg +1.38R.
 *
 * v3.3 changes (Nov-3-4 forensics — the "sleeping monster" postmortem):
 *   - 16/21 entries were DEAD (MFE<0.3R): the bot paid for tickets to moves
 *     that never started. Winners (MFE>=0.3) entered with median +2.54% room
 *     above support; dead entries with +0.44% (shelf-sitting or just-under a
 *     freshly broken support = the exhausted chase of a printed breakdown).
 *   - 6 trades carried entry_quality=BAD_LOCATION and executed anyway = -11.20$.
 *   - The one LONG entered and was ICE-nuked after 60 seconds ("دخول وخروج
 *     فورا" — the exact anti-pattern the user banned).
 *   - RANGE_REVERSION bypassed this gate entirely (XLM short on
 *     BUYING_PRESSURE / NVDA long on MIXED flow) — now wired.
 *
 * Rules (all evaluated at entry time — zero hindsight):
 *   G1 POSITIONING — only fresh accumulation states may open:
 *       SHORT needs flow "SHORT_BUILDUP";  LONG needs flow "LONG_BUILDUP".
 *       Chase states (SELLING_/BUYING_PRESSURE) mean WE would be the exit
 *       liquidity of a move already underway → BLOCKED.
 *   G2 RUNWAY (replaces the v3.2.1 war-zone band — subsumes it):
 *       SHORT: distanceToSupportPct    >= +1.0%  (clean room to the target)
 *              OR <= -0.30% (confirmed breakdown) — but the breakdown leg
 *                  only pays WITH a live DOWN cascade (crash mode); without
 *                  it we are buying the bottom of an already-printed leg.
 *              Everything in (-0.30%, +1.0%) = the measured dead zone.
 *       LONG:  distanceToResistancePct mirrored, cascade must be UP.
 *   G3 EXHAUSTED REGIME — when the 4h BTC regime already screams our
 *       direction, the move is mature and we are the late money:
 *       SHORT blocked in BEAR_STRONG / LONG blocked in BULL_STRONG —
 *       EXCEPT a live cascade WITH our tape (crash mode).
 *   G4 LATE-IMPULSE (new, mean-reverting regimes only):
 *       In BEAR_WEAK / BULL_WEAK / RANGE / TRANSITION the tape mean-reverts:
 *       if the last CLOSED 15m candle just printed a fresh 4-candle extreme
 *       in our trade direction, the impulse already happened and we are the
 *       exit liquidity of the bounce → BLOCK (live cascade override keeps
 *       crash riding). In *_STRONG regimes trends pay — the rule sleeps.
 */

export type FlowEntryGateSide = "LONG" | "SHORT";

export interface FlowEntryGateTape {
   /** last CLOSED 15m candle printed a fresh 4-candle extreme in trade direction */
   freshExtreme?: boolean;
}

export interface EntryQuality {
   confirmed: boolean;
   timingPassed: boolean;
   persistent: boolean;
   aligned: boolean;
   atrPct: number;
   stopPct: number;
   costPct: number;
}

export interface FlowEntryGateOpts {
   /** Required for the adaptive live path; absent callers keep conservative legacy checks. */
   quality?: EntryQuality;
   side: FlowEntryGateSide;
   /** reasoning.flow.state — SHORT_BUILDUP / SELLING_PRESSURE / LONG_BUILDUP / BUYING_PRESSURE / MIXED / UNKNOWN */
   flowState: string;
   /** (price - nearestSupport) / price      — positive = room above support. Fraction (0.003 = 0.3%) */
   distanceToSupportPct?: number;
   /** (nearestResistance - price) / price   — positive = room below resistance. Fraction */
   distanceToResistancePct?: number;
   /** 4h BTC strategic regime (BEAR_STRONG / BULL_STRONG / ...) */
   btcRegime: string;
   /** crashRadar violence state (cascade override) */
   violenceActive?: boolean;
   violenceDirection?: "UP" | "DOWN" | "NONE";
   /** symbol tape summary (v3.3 G4) */
   tape?: FlowEntryGateTape;
}

export interface FlowEntryGateResult {
   blocked: boolean;
   rule: "G1_POSITIONING" | "G2_RUNWAY" | "G3_EXHAUSTED_REGIME" | "G4_LATE_IMPULSE" | null;
   reason: string;
}

/** Minimum clean room to the liquidity target (fraction). Measured: winners
 *  entered with median +2.54% room; dead entries +0.44%. */
export const RUNWAY_ROOM_PCT = 0.010;
/** Through-the-level distance that counts as a confirmed break (fraction). */
export const WARZONE_BREAK_PCT = 0.0030;
/** Legacy shelf edge — kept exported for compatibility. */
export const WARZONE_SHELF_PCT = 0.0012;

let enabled = true;

export function configureFlowEntryGate(opts: { enabled?: boolean } = {}): void {
   if (opts.enabled !== undefined) enabled = !!opts.enabled;
}

export function getFlowEntryGateConfig(): { enabled: boolean } {
   return { enabled };
}

export function resetFlowEntryGate(): void {
   enabled = true;
}

function isMeanRevertingRegime(btcRegime: string): boolean {
   const r = (btcRegime || "").toUpperCase();
   return r.includes("BEAR_WEAK") || r.includes("BULL_WEAK") ||
          r.includes("RANGE") || r.includes("TRANSITION") || r === "" || r === "UNKNOWN";
}

export function evaluateFlowEntryGate(opts: FlowEntryGateOpts): FlowEntryGateResult {
   if (!enabled) return { blocked: false, rule: null, reason: "flow entry gate disabled" };

   const { side, flowState, btcRegime } = opts;

   // ── G1 POSITIONING: fresh accumulation only ─────────────────────────────
   const wantsBuildup = side === "SHORT" ? "SHORT_BUILDUP" : "LONG_BUILDUP";
   const chaseState = side === "SHORT" ? "SELLING_PRESSURE" : "BUYING_PRESSURE";
   const q = opts.quality;
   const qualityReady = !!q && q.confirmed && q.timingPassed && q.persistent && q.aligned &&
      [q.atrPct, q.stopPct, q.costPct].every(Number.isFinite) &&
      q.atrPct > 0 && q.stopPct > 0 && q.costPct >= 0;
   // Pressure is acceptable only after the SAME directional confirmation,
   // persistence, tape and structure checks used by the orchestrator.
   const pressureConfirmed = flowState === chaseState && qualityReady;
   if (flowState !== wantsBuildup && !pressureConfirmed) {
      const isChase = flowState === chaseState;
      return {
         blocked: true,
         rule: "G1_POSITIONING",
         reason: isChase
            ? `Flow Entry Gate [G1-CHASE]: flow=${flowState} — التدفق المنهك (بقايا الحركة): دخولك الآن يعني توفير سيولة خروج لمن ركبوا البداية. ننتظر تراكماً جديداً (${wantsBuildup}).`
            : `Flow Entry Gate [G1-POSITIONING]: flow=${flowState} ليس تراكم ${side === "SHORT" ? "شورت" : "لونق"} طازجاً — ننتظر ${wantsBuildup}.`
      };
   }

   const cascadeDir = side === "SHORT" ? "DOWN" : "UP";
   const cascadeLive = opts.violenceActive === true && opts.violenceDirection === cascadeDir;

   // ── G2 RUNWAY: clean room to the target, or a real cascade break ────────
   const d = (side === "SHORT" ? opts.distanceToSupportPct : opts.distanceToResistancePct);
   if (q) {
      if (!qualityReady || d === undefined || !Number.isFinite(d)) {
         return { blocked: true, rule: "G2_RUNWAY", reason: "Flow Entry Gate [G2-DATA]: incomplete confirmation or invalid risk/location data" };
      }
      // Reach the existing first scale-out (0.75R) NET of round-trip costs;
      // also require one ATR of room. No change to stop/targets or sizing.
      const required = Math.max(q.atrPct, 0.75 * q.stopPct + q.costPct);
      const firstTargetPaysCosts = 0.75 * q.stopPct > q.costPct;
      // A crossed level is now behind the trade, not a target ahead of it.
      // Timing must already confirm a healthy break/retest; cap extension
      // even during a cascade so the exception cannot chase late moves.
      const healthyBreak = d <= 0 && -d <= 0.9 * q.atrPct;
      if (!firstTargetPaysCosts || !(d >= required || healthyBreak)) {
         return { blocked: true, rule: "G2_RUNWAY", reason: `Flow Entry Gate [G2-RISK-ROOM]: room ${(d * 100).toFixed(3)}%, required ${(required * 100).toFixed(3)}%; wait for a fresh confirmed retest` };
      }
   } else if (d !== undefined && Number.isFinite(d)) {
      const level = side === "SHORT" ? "الدعم" : "المقاومة";
      if (d >= RUNWAY_ROOM_PCT) {
         // clean room — pass
      } else if (d <= -WARZONE_BREAK_PCT) {
         // confirmed structural break — only pays while the cascade is live
         if (!cascadeLive) {
            return {
               blocked: true,
               rule: "G2_RUNWAY",
               reason: `Flow Entry Gate [G2-RUNWAY-BREAK]: ${(d * 100).toFixed(2)}% من ${level} — اختراق انطبع بالفعل بدون انهيار/انفجار حي: الساق استُهلكت ودخولك الآن شراء قاعها. يُسمح فقط أثناء كسكيد حي مع التيبر.`
            };
         }
      } else {
         return {
            blocked: true,
            rule: "G2_RUNWAY",
            reason: `Flow Entry Gate [G2-RUNWAY]: ${(d * 100).toFixed(2)}% من ${level} — المنطقة الميتة المقاسة (فوق الرف بلا مساحة كافية): 36% من صفقات نوفمبر ماتت هنا (MFE<0.3R). المطلوب مساحة ≥ +1.0% للهدف، أو اختراق ≤ -0.30% مع كسكيد حي.`
         };
      }
   }

   // ── G3 EXHAUSTED REGIME: the move is mature unless a live cascade prints ─
   const exhaustedRegime = side === "SHORT" ? "BEAR_STRONG" : "BULL_STRONG";
   if (btcRegime === exhaustedRegime && !cascadeLive && !qualityReady) {
      return {
         blocked: true,
         rule: "G3_EXHAUSTED_REGIME",
         reason: `Flow Entry Gate [G3-EXHAUSTED]: نظام BTC=${btcRegime} — الحركة في اتجاهنا ناضجة/منتهية (دخول متأخر = سيولة الخروج). يُسمح فقط أثناء انهيار/انفجار حي مع التيبر.`
      };
   }

   // ── G4 LATE-IMPULSE: never buy the printed candle in mean-reverting tape ─
   if (opts.tape?.freshExtreme === true && !cascadeLive && isMeanRevertingRegime(btcRegime) && !qualityReady) {
      return {
         blocked: true,
         rule: "G4_LATE_IMPULSE",
         reason: `Flow Entry Gate [G4-LATE-IMPULSE]: آخر شمعة 15m طبعت قمة/قاعاً جديداً في اتجاه الصفقة والنظام (${btcRegime}) ارتادي — الاندفاع انطباع بالفعل؛ الانتظار حتى يرتد/يهدا الشريط ثم نركب البداية التالية (يسري فقط في الأنظمة الضعيفة/العرضية).`
      };
   }

   return { blocked: false, rule: null, reason: side === "SHORT" ? "تراكم شورت طازج مع مدرج هبوط نظيف" : "تراكم لونق طازج مع مدرج صعود نظيف" };
}
