// ============================================================================
// Comprehensive Research Logger v2.4.0 Test Suite
// Verifies:
// 1. Entry Timing (UTC hour, minute, hour_bucket, session)
// 2. Market Regime & Volatility States (HIGH, LOW, NORMAL)
// 3. Directional Prediction Tracking & Excursions
// 4. Loss Classification & Entry Quality
// 5. Rejected Signals with Timing Gate & Flow Persistence
// 6. Full Export Bundle and Research Endpoints compatibility
// ============================================================================

import {
   logRejectedSignal,
   updateRejectedSignalsOutcomes,
   logTradeDecision,
   logTradeJourneySnapshot,
   formatCandles,
   calculateDirectionalExcursions,
   extractEntryTiming,
   extractMarketRegimeContext,
   classifyTradeLoss,
   classifyEntryQuality,
   getTradingDecisionsData,
   getRejectedSignalsData,
   getTradeJourneysData,
   getPerformanceSummaryData,
   getFullExportBundle
} from "./researchLogger.js";

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean) {
   if (cond) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
   } else {
      console.error(`❌ [FAIL] ${name}`);
      failed++;
   }
}

console.log("\n🧪 RUNNING RESEARCH LOGGER v2.4.0 VERIFICATION SUITE\n");

// 1. Test Entry Timing Extraction (Strict UTC & Session definitions)
{
   const tAsia = extractEntryTiming("2026-09-29T04:15:00.000Z");
   assert("extractEntryTiming timezone is UTC", tAsia.timezone === "UTC");
   assert("extractEntryTiming utc_hour matches", tAsia.utc_hour === 4);
   assert("extractEntryTiming utc_minute matches", tAsia.utc_minute === 15);
   assert("extractEntryTiming hour_bucket is '04:00-04:59'", tAsia.hour_bucket === "04:00-04:59");
   assert("extractEntryTiming 04:15 UTC is ASIA session", tAsia.session === "ASIA");

   const tLondon = extractEntryTiming("2026-09-29T09:30:00.000Z");
   assert("extractEntryTiming 09:30 UTC is LONDON session", tLondon.session === "LONDON");

   const tOverlap = extractEntryTiming("2026-09-29T14:45:00.000Z");
   assert("extractEntryTiming 14:45 UTC is LONDON_NY_OVERLAP session", tOverlap.session === "LONDON_NY_OVERLAP");

   const tNy = extractEntryTiming("2026-09-29T18:20:00.000Z");
   assert("extractEntryTiming 18:20 UTC is NEW_YORK session", tNy.session === "NEW_YORK");

   const tLate = extractEntryTiming("2026-09-29T22:10:00.000Z");
   assert("extractEntryTiming 22:10 UTC is LATE_US session", tLate.session === "LATE_US");
}

// 2. Test Market Regime & Volatility State Extraction
{
   const normCtx = extractMarketRegimeContext(
      { rvol: 1.2, atr14: 2.0, atr20: 2.0 },
      { regime: "BULL_STRONG" },
      { regime: "TREND_UP" }
   );
   assert("extractMarketRegimeContext strategy_regime matches reasoning", normCtx.strategy_regime === "TREND_UP");
   assert("extractMarketRegimeContext btc_regime matches ctx", normCtx.btc_regime === "BULL_STRONG");
   assert("extractMarketRegimeContext atr_ratio is 1.0", normCtx.atr_ratio === 1.0);
   assert("extractMarketRegimeContext volatility_state is NORMAL", normCtx.volatility_state === "NORMAL");

   const highRvol = extractMarketRegimeContext(
      { rvol: 2.5, atr14: 2.0, atr20: 2.0 },
      { regime: "BULL_STRONG" },
      { regime: "TREND_UP" }
   );
   assert("volatility_state is HIGH when RVOL >= 2.0", highRvol.volatility_state === "HIGH");

   const lowRvol = extractMarketRegimeContext(
      { rvol: 0.6, atr14: 2.0, atr20: 2.0 },
      { regime: "RANGE" },
      { regime: "RANGE" }
   );
   assert("volatility_state is LOW when RVOL <= 0.7", lowRvol.volatility_state === "LOW");
}

// 3. Test Candle Formatting & REAL Timestamps
{
   const rawKlines = [
      { openTime: 1727600000000, open: 100, high: 105, low: 99, close: 103, volume: 1500, quoteVolume: 154500, trades: 400 },
      { openTime: 1727600900000, open: 103, high: 108, low: 102, close: 107, volume: 2100, quoteVolume: 224700, trades: 550 }
   ];
   const formatted = formatCandles(rawKlines, 10);
   assert("formatCandles formats openTime as valid ISO string", !isNaN(Date.parse(formatted[0].timestamp!)));
   assert("Adjacent candles DO NOT have identical timestamps", formatted[0].timestamp !== formatted[1].timestamp);
}

// 4. Test Directional Excursions
{
   const longExcursion = calculateDirectionalExcursions("LONG", 100, 105, 98);
   assert("LONG MFE is positive (+5%)", longExcursion.mfePercent === 5.0);
   assert("LONG MAE is negative (-2%)", longExcursion.maePercent === -2.0);

   const shortExcursion = calculateDirectionalExcursions("SHORT", 100, 102, 95);
   assert("SHORT MFE is positive (+5% on price drop)", shortExcursion.mfePercent === 5.0);
   assert("SHORT MAE is negative (-2% on price surge)", shortExcursion.maePercent === -2.0);
}

// 5. Test Rejected Signal Logging with Timing Gate and Persistence
{
   const mockPrice = {
      price: 150,
      rsi: 74,
      adx: 30,
      atr14: 2.5,
      atr20: 2.0,
      ema21: 145,
      ema50: 140,
      ema200: 130,
      rvol: 2.1,
      taker: 0.62,
      st_bull: true,
      klines: [
         { openTime: 1727600000000, open: 148, high: 151, low: 147, close: 150, volume: 1200 }
      ]
   };
   const mockWhale = { slope15: 140, slope5: 50, slope4h: 300, oi_chg: 0.005, fund: 0.0001 };
   const mockCtx = { regime: "BULL_STRONG", tradeable: true, btc_trend: "UP" };
   const mockReasoning = {
      regime: "TREND_UP",
      flow: { state: "LONG_BUILDUP", persistenceState: "STRONG", persistenceScore: 85 },
      timingGate: { state: "LATE_EXPANSION", isLateEntry: true, reason: "Expanded > 1.4x ATR" },
      scenario: { primary: { type: "BREAKOUT_LONG" } },
      location: { nearestResistance: 150.2, nearResistance: true },
      confirmation: {
         evidence: ["Bullish flow confirmed"],
         missingItems: ["Healthy retest of broken resistance"]
      }
   };

   logRejectedSignal({
      symbol: "SOLUSDT",
      timeframe: "15m",
      direction: "LONG",
      signal_score: 8.2,
      rejection_reason: "Timing Gate: Late entry on expansion. Awaiting retest.",
      p: mockPrice,
      w: mockWhale,
      ctx: mockCtx,
      reasoning: mockReasoning
   });

   const rejectedData = getRejectedSignalsData();
   assert("logRejectedSignal added event to memory", rejectedData.length > 0);
   const rej = rejectedData[0];
   assert("Rejected event has schema_version 2.4.0", rej.schema_version === "2.4.0");
   assert("Rejected event has timing_gate_state", rej.timing_gate_state === "LATE_EXPANSION");
   assert("Rejected event has flow_persistence_state", rej.flow_persistence_state === "STRONG");
   assert("Rejected event has entry_timing", rej.entry_timing !== undefined);
   assert("Rejected event has market_context", rej.market_context !== undefined);
}

// 6. Test Executed Trade Decision with Loss Classification & Directional Tracking
{
   const mockActiveTrade = {
      symbol: "ETHUSDT",
      direction: "LONG",
      entry: 3000,
      sl: 2950,
      initialSlDist: 50,
      initialPos: 1.0,
      entryTime: new Date(Date.now() - 3600000).toISOString(),
      grade: "GRADE_A",
      score: 8.4,
      profitR: 1.8,
      highestPrice: 3100,
      lowestPrice: 2980,
      timeOfHighestPrice: Date.now() - 1800000,
      timeOfLowestPrice: Date.now() - 3000000,
      entryTiming: extractEntryTiming(Date.now() - 3600000),
      marketRegimeContext: extractMarketRegimeContext(
         { rvol: 1.2, atr14: 20, atr20: 20 },
         { regime: "BULL_STRONG" },
         { regime: "TREND_UP" }
      ),
      reasoning: {
         timingGate: { state: "CONFIRMED", isLateEntry: false },
         flow: { state: "LONG_BUILDUP", persistenceState: "STRONG", persistenceScore: 80 }
      },
      candlesBeforeEntry: [
         { openTime: 1727600000000, open: 2980, high: 3010, low: 2975, close: 3000, volume: 500 }
      ],
      whaleData: { scenario: "INST_ACCUMULATION" }
   };

   logTradeDecision(mockActiveTrade, {
      exitPrice: 3090,
      exitReason: "TP2 Reached",
      finalPnl: 88.5,
      fees: 1.5,
      currentKlines: [
         { openTime: 1727603600000, open: 3080, high: 3095, low: 3075, close: 3090, volume: 800 }
      ]
   });

   const decisions = getTradingDecisionsData();
   assert("logTradeDecision records completed trade", decisions.length > 0);
   const lastDecision = decisions[0];
   assert("Trade decision has schema_version 2.4.0", lastDecision.schema_version === "2.4.0");
   assert("Trade decision has timing_gate_state", lastDecision.timing_gate_state === "CONFIRMED");
   assert("Trade decision has flow_persistence_state", lastDecision.flow_persistence_state === "STRONG");
   assert("Trade decision contains directional_prediction", lastDecision.directional_prediction !== undefined);
   assert("Trade decision contains entry_quality", lastDecision.entry_quality === "GOOD_ENTRY");
}

// 7. Test Performance Summary with Directional Accuracy Report
{
   const summary = getPerformanceSummaryData();
   assert("Performance summary schema is 2.4.0", summary.schema_version === "2.4.0");
   assert("Summary has by_session breakdown", summary.executed_trades_summary?.by_session !== undefined);
   assert("Summary has by_loss_classification breakdown", summary.executed_trades_summary?.by_loss_classification !== undefined);
   assert("Summary has directional_accuracy_report", summary.directional_accuracy_report !== undefined);
   assert("Rejected summary has by_timing_gate_state breakdown", summary.rejected_signals_summary?.by_timing_gate_state !== undefined);
}

// 8. Test Full Export Bundle
{
   const bundle = getFullExportBundle();
   assert("Full export bundle has schema_version 2.4.0", bundle.schema_version === "2.4.0");
   assert("Full export bundle contains trading_decisions", Array.isArray(bundle.trading_decisions));
   assert("Full export bundle contains rejected_signals", Array.isArray(bundle.rejected_signals));
}

console.log(`\n📊 RESEARCH v2.4.0 TEST SUMMARY: ${passed} PASSED | ${failed} FAILED\n`);

if (failed > 0) {
   process.exit(1);
} else {
   console.log("✨ All Research Logger v2.4.0 Tests PASSED flawlessly!\n");
}
