// ============================================================================
// Institutional Tri-Regime Engine (الهيكل المتكيف متعدد الأنظمة السعرية)
// BeastBotSniper Architecture - Version 2.5.0
//
// Strictly isolates market execution into 3 non-overlapping institutional modules:
// 1. CRASH / DUMP (شلال انهياري)
//    - Long: Closed 100% (No knife catching)
//    - Breakdown Short: Enabled with high conviction
//    - Oversold RSI Bypass: Allows short momentum down to deep oversold levels
//    - Tsunami Runner Mode: Multi-tier exits (TP1 0.75R, TP2 1.8R, Runner 3.5R+)
//
// 2. BULL / PUMP (انفجار صعودي)
//    - Short: Closed 100% (No counter-trend shorting)
//    - Breakout & Pullback Long: Enabled on confirmed institutional volume
//    - Profit Protection: Tsunami Runner Hold on multi-timeframe orderflow
//
// 3. RANGE / CHOP (تذبذب عرضي)
//    - Breakout Momentum: Strictly CANCELLED / PROHIBITED (prevents buying tops / selling bottoms)
//    - Capital Defense: Dead chop blocker active when ADX < 18 or RVOL < 1.20
//    - Range Boundary Mean Reversion: Only permits entries at extreme boundaries (Range Low / Range High) with absorption
// ============================================================================

export type MacroRegimeType = "CRASH_DUMP" | "BULL_PUMP" | "RANGE_CHOP";

export type RangeExecutionMode = "CAPITAL_DEFENSE" | "MEAN_REVERSION";

export interface TriRegimeEvaluationResult {
   macroRegime: MacroRegimeType;
   allowed: boolean;
   direction: "LONG" | "SHORT" | "NONE";
   setupClass: "BREAKDOWN_SHORT" | "BREAKOUT_LONG" | "PULLBACK_LONG" | "PULLBACK_SHORT" | "RANGE_MEAN_REVERSION" | "BLOCKED";
   reason: string;
   oversoldBypass: boolean;
   breakoutProhibited: boolean;
   exitStrategy: "TSUNAMI_RUNNER" | "RANGE_SCALP" | "STANDARD";
   ruleTriggered: string;
   details: {
      btcRegime: string;
      assetRegime?: string;
      rvol: number;
      adx: number;
      rsi: number;
      nearSupport: boolean;
      nearResistance: boolean;
   };
}

/**
 * 1. MACRO REGIME DETECTOR
 * Classifies current market state into exactly ONE of the three macro regimes.
 */
export function detectMacroRegime(ctx: any, p: any, w?: any): MacroRegimeType {
   const btcDump = Boolean(ctx?.btc_dump);
   const btcPump = Boolean(ctx?.btc_pump);
   const btcRegime = String(ctx?.regime || "").toUpperCase();
   const btcChg = Number(ctx?.btc_chg || 0);

   // 1. CRASH / DUMP DETECTION:
   // - BTC dump flag active OR
   // - BTC regime explicitly BEAR_STRONG / BEAR_WEAK OR
   // - BTC 15m change drops sharply (< -0.8%) OR
   // - Asset in confirmed structural breakdown (LH_LL + below EMA50 < EMA200) with non-bullish BTC
   if (
      btcDump ||
      btcRegime.includes("BEAR") ||
      btcChg <= -0.008 ||
      (p?.LH_LL && p?.price < p?.ema50 && p?.ema50 < p?.ema200 && p?.adx >= 20 && !btcRegime.includes("BULL") && !btcPump)
   ) {
      return "CRASH_DUMP";
   }

   // 2. BULL / PUMP DETECTION:
   // - BTC pump flag active OR
   // - BTC regime explicitly BULL_STRONG / BULL_WEAK OR
   // - BTC 15m change surges (> +0.8%) OR
   // - Asset in confirmed structural markup (HH_HL + above EMA50 > EMA200) with non-bearish BTC
   if (
      btcPump ||
      btcRegime.includes("BULL") ||
      btcChg >= 0.008 ||
      (p?.HH_HL && p?.price > p?.ema50 && p?.ema50 > p?.ema200 && p?.adx >= 20 && !btcRegime.includes("BEAR") && !btcDump)
   ) {
      return "BULL_PUMP";
   }

   // 3. RANGE / CHOP (Default consolidation environment):
   return "RANGE_CHOP";
}

/**
 * 2. TRI-REGIME EXECUTION EVALUATOR
 * Pure, deterministic evaluation of trade validity and institutional behavior.
 */
export function evaluateTriRegimeExecution(
   direction: "LONG" | "SHORT",
   ctx: any,
   p: any,
   w: any,
   loc?: any,
   rangeMode: RangeExecutionMode = "CAPITAL_DEFENSE"
): TriRegimeEvaluationResult {
   const macroRegime = detectMacroRegime(ctx, p, w);

   const rvol = Number(p?.rvol ?? 1.0);
   const adx = Number(p?.adx ?? 0);
   const rsi = Number(p?.rsi ?? 50);
   const diPlus = Number(p?.di_plus ?? 0);
   const diMinus = Number(p?.di_minus ?? 0);
   const nearSupport = Boolean(loc?.nearSupport || (loc?.distanceToSupportPct !== undefined && loc.distanceToSupportPct < 0.004));
   const nearResistance = Boolean(loc?.nearResistance || (loc?.distanceToResistancePct !== undefined && loc.distanceToResistancePct < 0.004));

   const details = {
      btcRegime: ctx?.regime || "UNKNOWN",
      assetRegime: p?.assetRegime || macroRegime,
      rvol,
      adx,
      rsi,
      nearSupport,
      nearResistance
   };

   // =========================================================================
   // SUB-ENGINE 1: CRASH / DUMP (شلال انهياري)
   // =========================================================================
   if (macroRegime === "CRASH_DUMP") {
      // Rule 1.1: Long: مغلق 100% (No knife catching)
      if (direction === "LONG") {
         return {
            macroRegime,
            allowed: false,
            direction: "NONE",
            setupClass: "BLOCKED",
            reason: `[CRASH_DUMP LOCK] تم حظر صفقات الشراء (LONG) بنسبة 100% خلال نظام الانهيار الشلالي (BTC: ${details.btcRegime}).`,
            oversoldBypass: false,
            breakoutProhibited: true,
            exitStrategy: "STANDARD",
            ruleTriggered: "CRASH_LONG_PROHIBITED",
            details
         };
      }

      // Rule 1.2: Breakdown Short enabled with Oversold RSI Bypass
      // In crash cascades, institutional momentum overrides standard oversold blockers.
      // Shorts allowed down to deep oversold (RSI 20) as long as orderflow persistence is bearish.
      const isExtremeExhaustion = rsi < 20 && p?.price < (p?.ema21 - (3.0 * (p?.atr14 || 1)));
      if (isExtremeExhaustion) {
         return {
            macroRegime,
            allowed: false,
            direction: "NONE",
            setupClass: "BLOCKED",
            reason: `[CRASH CLIMAX] تم إيقاف الشورت مؤقتاً عند ذروة البيع المناخي القصوى (RSI: ${rsi.toFixed(1)} < 20 و ابتعاد > 3.0x ATR عن EMA21).`,
            oversoldBypass: true,
            breakoutProhibited: false,
            exitStrategy: "TSUNAMI_RUNNER",
            ruleTriggered: "CLIMACTIC_EXHAUSTION_BLOCK",
            details
         };
      }

      return {
         macroRegime,
         allowed: true,
         direction: "SHORT",
         setupClass: "BREAKDOWN_SHORT",
         reason: `[CRASH_DUMP SHORT] تأكيد صفقة شورت مؤسساتية مع شلال الهبوط (BTC: ${details.btcRegime} | RVOL: ${rvol.toFixed(2)}x). تم تفعيل تجاوز التشبع البيعي وركوب الشلال.`,
         oversoldBypass: true,
         breakoutProhibited: false,
         exitStrategy: "TSUNAMI_RUNNER",
         ruleTriggered: "CRASH_BREAKDOWN_SHORT_APPROVED",
         details
      };
   }

   // =========================================================================
   // SUB-ENGINE 2: BULL / PUMP (انفجار صعودي)
   // =========================================================================
   if (macroRegime === "BULL_PUMP") {
      // Rule 2.1: Short: مغلق 100% (No swimming against explosive bull trend)
      if (direction === "SHORT") {
         return {
            macroRegime,
            allowed: false,
            direction: "NONE",
            setupClass: "BLOCKED",
            reason: `[BULL_PUMP LOCK] تم حظر صفقات البيع (SHORT) بنسبة 100% خلال نظام الانفجار الصعودي (BTC: ${details.btcRegime}).`,
            oversoldBypass: false,
            breakoutProhibited: true,
            exitStrategy: "STANDARD",
            ruleTriggered: "BULL_SHORT_PROHIBITED",
            details
         };
      }

      // Rule 2.2: Breakout & Pullback Longs enabled with Tsunami Runner profit protection
      const isExtremeOverbought = rsi > 80 && p?.price > (p?.ema21 + (3.0 * (p?.atr14 || 1)));
      if (isExtremeOverbought) {
         return {
            macroRegime,
            allowed: false,
            direction: "NONE",
            setupClass: "BLOCKED",
            reason: `[BULL CLIMAX] تم منع الشراء عند قمة الإجهاد الصعودي القصوى (RSI: ${rsi.toFixed(1)} > 80 مع ابتعاد > 3.0x ATR). انتظار إعادة اختبار.`,
            oversoldBypass: false,
            breakoutProhibited: false,
            exitStrategy: "TSUNAMI_RUNNER",
            ruleTriggered: "BULL_CLIMAX_EXPANSION_BLOCK",
            details
         };
      }

      const isPullback = Boolean(p?.pullback_long || (p?.price <= p?.ema21 && p?.price >= p?.ema50));
      return {
         macroRegime,
         allowed: true,
         direction: "LONG",
         setupClass: isPullback ? "PULLBACK_LONG" : "BREAKOUT_LONG",
         reason: `[BULL_PUMP LONG] تأكيد صفقة شراء مع الزخم الصعودي (${isPullback ? "Pullback Sniper" : "Breakout Momentum"} | RVOL: ${rvol.toFixed(2)}x). تم تفعيل حماية الأرباح التراكمية.`,
         oversoldBypass: false,
         breakoutProhibited: false,
         exitStrategy: "TSUNAMI_RUNNER",
         ruleTriggered: "BULL_LONG_APPROVED",
         details
      };
   }

   // =========================================================================
   // SUB-ENGINE 3: RANGE / CHOP (تذبذب عرضي)
   // =========================================================================
   // Rule 3.1: Breakout Momentum strictly prohibited (ملغى 100%)
   // In range regimes, chasing breakouts near boundaries is a primary cause of losses.
   const isBreakoutAttempt = 
      (direction === "LONG" && nearResistance) ||
      (direction === "SHORT" && nearSupport) ||
      (p?.setupType === "BREAKOUT_MOMENTUM" && !nearSupport && !nearResistance);

   if (isBreakoutAttempt && rangeMode === "CAPITAL_DEFENSE") {
      return {
         macroRegime,
         allowed: false,
         direction: "NONE",
         setupClass: "BLOCKED",
         reason: `[RANGE CHOP] صفقات الاختراق (Breakout) ملغاة تماماً في النطاق العرضي لتفادي فخاخ السيولة والقمم الوهمية.`,
         oversoldBypass: false,
         breakoutProhibited: true,
         exitStrategy: "STANDARD",
         ruleTriggered: "RANGE_BREAKOUT_PROHIBITED",
         details
      };
   }

   // Rule 3.2: Capital Defense - Dead Chop Filter
   // Block entries when volume is dry or directional index is flat
   const isDeadChop = rvol < 1.20 || adx < 18;
   if (isDeadChop) {
      return {
         macroRegime,
         allowed: false,
         direction: "NONE",
         setupClass: "BLOCKED",
         reason: `[CHOP DEFENSE] حماية رأس المال: تذبذب ميت وضعيف السيولة في النطاق العرضي (RVOL: ${rvol.toFixed(2)} < 1.20 أو ADX: ${adx.toFixed(1)} < 18). الانتظار حتى الانفجار.`,
         oversoldBypass: false,
         breakoutProhibited: true,
         exitStrategy: "STANDARD",
         ruleTriggered: "RANGE_DEAD_CHOP_DEFENSE",
         details
      };
   }

   // Rule 3.3: Range Boundary Mean Reversion (صيد أطراف الرينج فقط)
   // Only permitted when volume ignition occurs at the extreme boundary with absorption
   if (direction === "LONG") {
      if (!nearSupport) {
         return {
            macroRegime,
            allowed: false,
            direction: "NONE",
            setupClass: "BLOCKED",
            reason: `[RANGE CHOP] الشراء في النطاق العرضي مسموح حصراً عند أقصى قاع الرينج (Range Support) مع ظهور ارتداد وامتصاص شرائي.`,
            oversoldBypass: false,
            breakoutProhibited: true,
            exitStrategy: "RANGE_SCALP",
            ruleTriggered: "RANGE_LONG_NOT_AT_SUPPORT",
            details
         };
      }

      const hasBuyerAbsorption = diPlus >= diMinus && (w?.slope5 >= 0 || p?.taker >= 0.49);
      if (!hasBuyerAbsorption) {
         return {
            macroRegime,
            allowed: false,
            direction: "NONE",
            setupClass: "BLOCKED",
            reason: `[RANGE CHOP] كسر الدعم يفتقر للامتصاص الشرائي المؤكد (Taker: ${(p?.taker * 100 || 50).toFixed(1)}%).`,
            oversoldBypass: false,
            breakoutProhibited: true,
            exitStrategy: "RANGE_SCALP",
            ruleTriggered: "RANGE_SUPPORT_NO_ABSORPTION",
            details
         };
      }

      return {
         macroRegime,
         allowed: true,
         direction: "LONG",
         setupClass: "RANGE_MEAN_REVERSION",
         reason: `[RANGE REVERSION] صيد قاع الرينج: دخول شراء من الدعم مع امتصاص شرائي بهدف سريع لمنتصف النطاق (0.8R - 1.0R).`,
         oversoldBypass: false,
         breakoutProhibited: true,
         exitStrategy: "RANGE_SCALP",
         ruleTriggered: "RANGE_LONG_REVERSION_APPROVED",
         details
      };
   }

   if (direction === "SHORT") {
      if (!nearResistance) {
         return {
            macroRegime,
            allowed: false,
            direction: "NONE",
            setupClass: "BLOCKED",
            reason: `[RANGE CHOP] البيع في النطاق العرضي مسموح حصراً عند أقصى قمة الرينج (Range Resistance) مع ظهور رفض وامتصاص بيعي.`,
            oversoldBypass: false,
            breakoutProhibited: true,
            exitStrategy: "RANGE_SCALP",
            ruleTriggered: "RANGE_SHORT_NOT_AT_RESISTANCE",
            details
         };
      }

      const hasSellerAbsorption = diMinus >= diPlus && (w?.slope5 <= 0 || p?.taker <= 0.51);
      if (!hasSellerAbsorption) {
         return {
            macroRegime,
            allowed: false,
            direction: "NONE",
            setupClass: "BLOCKED",
            reason: `[RANGE CHOP] اختبار المقاومة يفتقر للرفض البيعي المؤكد (Taker: ${(p?.taker * 100 || 50).toFixed(1)}%).`,
            oversoldBypass: false,
            breakoutProhibited: true,
            exitStrategy: "RANGE_SCALP",
            ruleTriggered: "RANGE_RESISTANCE_NO_ABSORPTION",
            details
         };
      }

      return {
         macroRegime,
         allowed: true,
         direction: "SHORT",
         setupClass: "RANGE_MEAN_REVERSION",
         reason: `[RANGE REVERSION] صيد سقف الرينج: دخول شورت من المقاومة مع رفض بيعي بهدف سريع لمنتصف النطاق (0.8R - 1.0R).`,
         oversoldBypass: false,
         breakoutProhibited: true,
         exitStrategy: "RANGE_SCALP",
         ruleTriggered: "RANGE_SHORT_REVERSION_APPROVED",
         details
      };
   }

   return {
      macroRegime,
      allowed: false,
      direction: "NONE",
      setupClass: "BLOCKED",
      reason: `[CHOP DEFENSE] حالة السوق محايدة بدون اتجاه صريح.`,
      oversoldBypass: false,
      breakoutProhibited: true,
      exitStrategy: "STANDARD",
      ruleTriggered: "NEUTRAL_UNCLEAR",
      details
   };
}
