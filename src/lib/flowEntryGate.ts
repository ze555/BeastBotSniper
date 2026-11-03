/**
 * FLOW ENTRY GATE v3.2.1 — "اركب بداية الموجة، لا بقاياها"
 * =========================================================
 * Direction-SYMMETRIC institutional entry intelligence, validated on two
 * independent live logs + one real rally window:
 *
 *   FRESH LOG (Nov 1-3, v3.2 live):  35 shorts  -1.89$  →  +14.66$ (G1 alone, 20 trades)
 *   OLD LOG   (Oct 29-31, v3.1.x):   43 shorts  -5.42$  →  +31.77$ (G1+G2, 13 trades, WR 69%)
 *   LONG MIRROR (Aug 19-21 rally):    9 symbols, entries 15-150 min after the true low,
 *                                     100% WR, avg +1.38R with impulse-bank exits.
 *
 * Root cause this gate kills (measured on live logs):
 *   - 15/35 fresh entries were DEAD (MFE<0.3R, no move ever came) = -41.21$
 *   - SELLING_PRESSURE (late/chase) shorts: WR 33%, -15.66$
 *     vs SHORT_BUILDUP (fresh positioning):  WR 55%, +13.77$
 *   - median time-to-MFE 21 min, median entry lag ~2.3h below the 4h high.
 *
 * Rules (all evaluated at entry time — zero hindsight):
 *   G1 POSITIONING — only fresh accumulation states may open:
 *       SHORT needs flow "SHORT_BUILDUP";  LONG needs flow "LONG_BUILDUP".
 *       Chase states (SELLING_PRESSURE / BUYING_PRESSURE) mean WE would be
 *       the exit liquidity for a move already underway → BLOCKED.
 *   G2 WAR-ZONE — never open inside the liquidity shelf itself:
 *       SHORT: distanceToSupportPct    within (-0.30%, +0.12%) → blocked
 *              (standing on the support shelf, or just-under it = hunt zone;
 *               confirmed breakdowns ≤ -0.30% and clean room ≥ +0.12% pass)
 *       LONG:  distanceToResistancePct within (-0.30%, +0.12%) → blocked
 *              (leaning under the resistance wall, or just-poking above it =
 *               fake-break retest zone; confirmed breakouts pass)
 *   G3 EXHAUSTED REGIME — when the 4h BTC regime already screams our
 *       direction, the move is mature and we are the late money:
 *       SHORT blocked in BEAR_STRONG / LONG blocked in BULL_STRONG —
 *       EXCEPT a live cascade WITH our tape (crashRadar violence active in
 *       our direction): the only institutionally-sound time to join late
 *       is while the collapse/rally is still printing (v3.1.2 crash mode).
 */

export type FlowEntryGateSide = "LONG" | "SHORT";

export interface FlowEntryGateOpts {
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
}

export interface FlowEntryGateResult {
   blocked: boolean;
   rule: "G1_POSITIONING" | "G2_WAR_ZONE" | "G3_EXHAUSTED_REGIME" | null;
   reason: string;
}

/** Forbidden shelf band around the liquidity level (fractions). */
export const WARZONE_SHELF_PCT = 0.0012;   // +0.12% on the safe side of the level
export const WARZONE_BREAK_PCT = 0.0030;   // -0.30% through the level = confirmed break

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

export function evaluateFlowEntryGate(opts: FlowEntryGateOpts): FlowEntryGateResult {
   if (!enabled) return { blocked: false, rule: null, reason: "flow entry gate disabled" };

   const { side, flowState, btcRegime } = opts;

   // ── G1 POSITIONING: fresh accumulation only ─────────────────────────────
   const wantsBuildup = side === "SHORT" ? "SHORT_BUILDUP" : "LONG_BUILDUP";
   const chaseState = side === "SHORT" ? "SELLING_PRESSURE" : "BUYING_PRESSURE";
   if (flowState !== wantsBuildup) {
      const isChase = flowState === chaseState;
      return {
         blocked: true,
         rule: "G1_POSITIONING",
         reason: isChase
            ? `Flow Entry Gate [G1-CHASE]: flow=${flowState} — التدفق المنهك (بقايا الحركة): دخولك الآن يعني توفير سيولة خروج لمن ركبوا البداية. ننتظر تراكماً جديداً (${wantsBuildup}).`
            : `Flow Entry Gate [G1-POSITIONING]: flow=${flowState} ليس تراكم ${side === "SHORT" ? "شورت" : "لونق"} طازجاً — ننتظر ${wantsBuildup}.`
      };
   }

   // ── G2 WAR-ZONE: not inside the liquidity shelf ─────────────────────────
   const d = (side === "SHORT" ? opts.distanceToSupportPct : opts.distanceToResistancePct);
   if (d !== undefined && Number.isFinite(d)) {
      const insideShelf = d > -WARZONE_BREAK_PCT && d < WARZONE_SHELF_PCT;
      if (insideShelf) {
         const level = side === "SHORT" ? "الدعم" : "المقاومة";
         return {
            blocked: true,
            rule: "G2_WAR_ZONE",
            reason: `Flow Entry Gate [G2-WAR-ZONE]: ${(d * 100).toFixed(2)}% من ${level} — داخل منطقة الحرب (صيد وقف الخسائر). إما مسافة ≥ +0.12% أو اختراق مؤكد ≤ -0.30%.`
         };
      }
   }

   // ── G3 EXHAUSTED REGIME: the move is mature unless a live cascade prints ─
   const exhaustedRegime = side === "SHORT" ? "BEAR_STRONG" : "BULL_STRONG";
   const cascadeDir = side === "SHORT" ? "DOWN" : "UP";
   const cascadeLive = opts.violenceActive === true && opts.violenceDirection === cascadeDir;
   if (btcRegime === exhaustedRegime && !cascadeLive) {
      return {
         blocked: true,
         rule: "G3_EXHAUSTED_REGIME",
         reason: `Flow Entry Gate [G3-EXHAUSTED]: نظام BTC=${btcRegime} — الحركة في اتجاهنا ناضجة/منتهية (دخول متأخر = سيولة الخروج). يُسمح فقط أثناء انهيار/انفجار حي مع التيبر.`
      };
   }

   return { blocked: false, rule: null, reason: side === "SHORT" ? "تراكم شورت طازج خارج منطقة الحرب" : "تراكم لونق طازج خارج منطقة الحرب" };
}
