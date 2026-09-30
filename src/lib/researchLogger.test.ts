// ============================================================================
// Comprehensive Research Logger v2.3.0 Test Suite
// Verifies:
// 1. Entry Timing (UTC hour, minute, hour_bucket, session)
// 2. Market Regime & Volatility States (HIGH, LOW, NORMAL)
// 3. Backward Compatibility & Candle Formatting
// 4. MFE / MAE Directional Logic
// 5. Rejected Signals with Entry Timing & Market Regime
// 6. Executed Trades with Entry Timing & Market Regime
// 7. Full Performance Summary Aggregations
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

console.log("\n🧪 RUNNING RESEARCH LOGGER v2.3.0 VERIFICATION SUITE\n");

// 1. Test Entry Timing Extraction (Strict UTC & Session definitions)
{
   // ASIA: 00:00 - 07:59
   const tAsia = extractEntryTiming("2026-09-29T04:15:00.000Z");
   assert("extractEntryTiming timezone is UTC", tAsia.timezone === "UTC");
   assert("extractEntryTiming utc_hour matches", tAsia.utc_hour === 4);
   assert("extractEntryTiming utc_minute matches", tAsia.utc_minute === 15);
   assert("extractEntryTiming hour_bucket is '04:00-04:59'", tAsia.hour_bucket === "04:00-04:59");
   assert("extractEntryTiming 04:15 UTC is ASIA session", tAsia.session === "ASIA");

   // LONDON: 08:00 - 12:59
   const tLondon = extractEntryTiming("2026-09-29T09:30:00.000Z");
   assert("extractEntryTiming 09:30 UTC is LONDON session", tLondon.session === "LONDON");
   assert("extractEntryTiming hour_bucket is '09:00-09:59'", tLondon.hour_bucket === "09:00-09:59");

   // LONDON_NY_OVERLAP: 13:00 - 16:59
   const tOverlap = extractEntryTiming("2026-09-29T14:45:00.000Z");
   assert("extractEntryTiming 14:45 UTC is LONDON_NY_OVERLAP session", tOverlap.session === "LONDON_NY_OVERLAP");

   // NEW_YORK: 17:00 - 20:59
   const tNy = extractEntryTiming("2026-09-29T18:20:00.000Z");
   assert("extractEntryTiming 18:20 UTC is NEW_YORK session", tNy.session === "NEW_YORK");

   // LATE_US: 21:00 - 23:59
   const tLate = extractEntryTiming("2026-09-29T22:10:00.000Z");
   assert("extractEntryTiming 22:10 UTC is LATE_US session", tLate.session === "LATE_US");

   // Edge cases
   assert("extractEntryTiming 00:00 UTC is ASIA", extractEntryTiming("2026-09-29T00:00:00.000Z").session === "ASIA");
   assert("extractEntryTiming 07:59 UTC is ASIA", extractEntryTiming("2026-09-29T07:59:00.000Z").session === "ASIA");
   assert("extractEntryTiming 08:00 UTC is LONDON", extractEntryTiming("2026-09-29T08:00:00.000Z").session === "LONDON");
   assert("extractEntryTiming 12:59 UTC is LONDON", extractEntryTiming("2026-09-29T12:59:00.000Z").session === "LONDON");
   assert("extractEntryTiming 13:00 UTC is LONDON_NY_OVERLAP", extractEntryTiming("2026-09-29T13:00:00.000Z").session === "LONDON_NY_OVERLAP");
   assert("extractEntryTiming 16:59 UTC is LONDON_NY_OVERLAP", extractEntryTiming("2026-09-29T16:59:00.000Z").session === "LONDON_NY_OVERLAP");
   assert("extractEntryTiming 17:00 UTC is NEW_YORK", extractEntryTiming("2026-09-29T17:00:00.000Z").session === "NEW_YORK");
   assert("extractEntryTiming 20:59 UTC is NEW_YORK", extractEntryTiming("2026-09-29T20:59:00.000Z").session === "NEW_YORK");
   assert("extractEntryTiming 21:00 UTC is LATE_US", extractEntryTiming("2026-09-29T21:00:00.000Z").session === "LATE_US");
   assert("extractEntryTiming 23:59 UTC is LATE_US", extractEntryTiming("2026-09-29T23:59:00.000Z").session === "LATE_US");
}

// 2. Test Market Regime & Volatility State Extraction
{
   // Normal volatility
   const normCtx = extractMarketRegimeContext(
      { rvol: 1.2, atr14: 2.0, atr20: 2.0 },
      { regime: "BULL_STRONG" },
      { regime: "TREND_UP" }
   );
   assert("extractMarketRegimeContext strategy_regime matches reasoning", normCtx.strategy_regime === "TREND_UP");
   assert("extractMarketRegimeContext btc_regime matches ctx", normCtx.btc_regime === "BULL_STRONG");
   assert("extractMarketRegimeContext atr_ratio is 1.0", normCtx.atr_ratio === 1.0);
   assert("extractMarketRegimeContext volatility_state is NORMAL", normCtx.volatility_state === "NORMAL");

   // High volatility by RVOL >= 2.0
   const highRvol = extractMarketRegimeContext(
      { rvol: 2.5, atr14: 2.0, atr20: 2.0 },
      { regime: "BULL_STRONG" },
      { regime: "TREND_UP" }
   );
   assert("volatility_state is HIGH when RVOL >= 2.0", highRvol.volatility_state === "HIGH");

   // High volatility by ATR14 / ATR20 >= 1.4
   const highAtr = extractMarketRegimeContext(
      { rvol: 1.1, atr14: 3.0, atr20: 2.0 },
      { regime: "BULL_STRONG" },
      { regime: "TREND_UP" }
   );
   assert("volatility_state is HIGH when ATR ratio >= 1.4", highAtr.volatility_state === "HIGH");

   // Low volatility by RVOL <= 0.7
   const lowRvol = extractMarketRegimeContext(
      { rvol: 0.6, atr14: 2.0, atr20: 2.0 },
      { regime: "RANGE" },
      { regime: "RANGE" }
   );
   assert("volatility_state is LOW when RVOL <= 0.7", lowRvol.volatility_state === "LOW");

   // Low volatility by ATR14 / ATR20 <= 0.8
   const lowAtr = extractMarketRegimeContext(
      { rvol: 1.0, atr14: 1.5, atr20: 2.0 },
      { regime: "RANGE" },
      { regime: "RANGE" }
   );
   assert("volatility_state is LOW when ATR ratio <= 0.8", lowAtr.volatility_state === "LOW");
}

// 3. Test Candle Formatting & REAL Timestamps
{
   const rawKlines = [
      { openTime: 1727600000000, open: 100, high: 105, low: 99, close: 103, volume: 1500, quoteVolume: 154500, trades: 400 },
      { openTime: 1727600900000, open: 103, high: 108, low: 102, close: 107, volume: 2100, quoteVolume: 224700, trades: 550 },
      { time: 1727601800000, open: 107, high: 110, low: 106, close: 109, volume: 1800 }
   ];
   const formatted = formatCandles(rawKlines, 10);
   
   assert("formatCandles formats openTime as valid ISO string", !isNaN(Date.parse(formatted[0].timestamp!)));
   assert("Candle 0 timestamp matches real exchange time", formatted[0].timestamp === new Date(1727600000000).toISOString());
   assert("Candle 1 timestamp matches real exchange time", formatted[1].timestamp === new Date(1727600900000).toISOString());
   assert("Adjacent candles DO NOT have identical timestamps", formatted[0].timestamp !== formatted[1].timestamp);
}

// 4. Test Directional Excursions (LONG vs SHORT)
{
   const longExcursion = calculateDirectionalExcursions("LONG", 100, 105, 98);
   assert("LONG MFE is positive (+5%)", longExcursion.mfePercent === 5.0);
   assert("LONG MAE is negative (-2%)", longExcursion.maePercent === -2.0);

   const shortExcursion = calculateDirectionalExcursions("SHORT", 100, 102, 95);
   assert("SHORT MFE is positive (+5% on price drop)", shortExcursion.mfePercent === 5.0);
   assert("SHORT MAE is negative (-2% on price surge)", shortExcursion.maePercent === -2.0);
}

// 5. Test Rejected Signal Logging with Entry Timing & Market Context
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
   const mockWhale = { slope15: 140, slope5: 50, oi_chg: 0.005, fund: 0.0001 };
   const mockCtx = { regime: "BULL_STRONG", tradeable: true, btc_trend: "UP" };
   const mockReasoning = {
      regime: "TREND_UP",
      flow: { state: "LONG_BUILDUP" },
      scenario: { primary: { type: "BREAKOUT_LONG" } },
      location: { nearestResistance: 150.2, nearResistance: true },
      confirmation: {
         evidence: ["Bullish flow confirmed"],
         missingItems: ["Candle close above resistance 150.2000"]
      }
   };

   logRejectedSignal({
      symbol: "SOLUSDT",
      timeframe: "15m",
      direction: "LONG",
      signal_score: 8.2,
      rejection_reason: "Price is within 0.25% of major resistance. Awaiting confirmed breakout candle.",
      p: mockPrice,
      w: mockWhale,
      ctx: mockCtx,
      reasoning: mockReasoning
   });

   const rejectedData = getRejectedSignalsData();
   assert("logRejectedSignal added event to memory", rejectedData.length > 0);
   const rej = rejectedData[0];
   assert("Rejected event has schema_version 2.3.0", rej.schema_version === "2.3.0");
   assert("Rejected event has entry_timing", rej.entry_timing !== undefined);
   assert("Rejected event entry_timing has utc_hour", typeof rej.entry_timing.utc_hour === "number");
   assert("Rejected event entry_timing has session", typeof rej.entry_timing.session === "string");
   assert("Rejected event has market_context", rej.market_context !== undefined);
   assert("Rejected event market_context has volatility_state", rej.market_context.volatility_state === "HIGH");
}

// 6. Test Executed Trade Decision with Entry Timing & Market Context
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
   assert("Trade decision has schema_version 2.3.0", lastDecision.schema_version === "2.3.0");
   assert("Trade decision contains entry_timing", lastDecision.entry_timing !== undefined);
   assert("Trade decision entry_timing has session", typeof lastDecision.entry_timing.session === "string");
   assert("Trade decision contains market_context", lastDecision.market_context !== undefined);
   assert("Trade decision market_context has volatility_state", lastDecision.market_context.volatility_state === "NORMAL");
   assert("Trade decision has time_to_MFE and time_to_MAE", typeof lastDecision.time_to_MFE === "number" && typeof lastDecision.time_to_MAE === "number");
}

// 7. Test Performance Summary with Session and Hour Bucket Aggregation
{
   const summary = getPerformanceSummaryData();
   assert("Performance summary schema is 2.3.0", summary.schema_version === "2.3.0");
   assert("Summary has by_session breakdown", summary.executed_trades_summary?.by_session !== undefined);
   assert("Summary has by_hour_bucket breakdown", summary.executed_trades_summary?.by_hour_bucket !== undefined);
   assert("Summary has by_volatility_state breakdown", summary.executed_trades_summary?.by_volatility_state !== undefined);
   assert("Rejected summary has by_session breakdown", summary.rejected_signals_summary?.by_session !== undefined);
}

// 8. Test Full Export Bundle
{
   const bundle = getFullExportBundle();
   assert("Full export bundle has schema_version 2.3.0", bundle.schema_version === "2.3.0");
   assert("Full export bundle contains trading_decisions", Array.isArray(bundle.trading_decisions));
   assert("Full export bundle contains rejected_signals", Array.isArray(bundle.rejected_signals));
}

console.log(`\n📊 RESEARCH v2.3.0 TEST SUMMARY: ${passed} PASSED | ${failed} FAILED\n`);

if (failed > 0) {
   process.exit(1);
} else {
   console.log("✨ All Research Logger v2.3.0 Tests PASSED flawlessly!\n");
}
