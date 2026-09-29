// ============================================================================
// Research Logger Test Suite
// Verifies JSONL generation, OHLCV candle formatting, excursion calculation,
// rejected signal recording, and summary aggregation
// ============================================================================

import fs from "fs";
import path from "path";
import {
   logRejectedSignal,
   logTradeDecision,
   logTradeJourneySnapshot,
   formatCandles,
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

console.log("\n🧪 RUNNING RESEARCH LOGGER VERIFICATION SUITE\n");

// 1. Test Candle Formatting
{
   const rawKlines = [
      { time: 1720000000000, open: 100, high: 105, low: 99, close: 103, volume: 1500, quoteVolume: 154500, trades: 400 },
      { time: 1720000900000, open: 103, high: 108, low: 102, close: 107, volume: 2100, quoteVolume: 224700, trades: 550 }
   ];
   const formatted = formatCandles(rawKlines, 10);
   assert("formatCandles formats timestamps as valid ISO string", !isNaN(Date.parse(formatted[0].timestamp)));
   assert("formatCandles preserves OHLCV numeric values", formatted[1].close === 107 && formatted[1].volume === 2100);
   assert("formatCandles handles empty/null gracefully", formatCandles([], 10).length === 0);
}

// 2. Test Rejected Signal Logging
{
   const mockPrice = {
      price: 150,
      rsi: 74,
      adx: 30,
      atr14: 2.5,
      ema21: 145,
      ema50: 140,
      ema200: 130,
      rvol: 1.8,
      taker: 0.62,
      st_bull: true,
      klines: [
         { time: 1720000000000, open: 148, high: 151, low: 147, close: 150, volume: 1200 }
      ]
   };
   const mockWhale = { slope15: 140, slope5: 50, oi_chg: 0.005, fund: 0.0001 };
   const mockCtx = { regime: "BULL_STRONG", tradeable: true, btc_trend: "UP" };
   const mockReasoning = {
      regime: "TREND_UP",
      flow: { state: "LONG_BUILDUP" },
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
   assert("logRejectedSignal added event to memory and file", rejectedData.length > 0);
   assert("Rejected event contains symbol and schema version", rejectedData[0].symbol === "SOLUSDT" && rejectedData[0].schema_version === "2.1.0");
   assert("Rejected event captured candles before signal", rejectedData[0].candles_before_signal.length === 1);
   assert("Rejected event captured conditions_failed", rejectedData[0].conditions_failed.some((c: string) => c.includes("resistance")));
}

// 3. Test Trade Journey Logging & In-Flight Excursion Tracking
{
   const mockActiveTrade = {
      symbol: "ETHUSDT",
      direction: "LONG",
      entry: 3000,
      sl: 2950,
      tp1: 3050,
      initialSlDist: 50,
      entryTime: new Date(Date.now() - 600000).toISOString(),
      profitR: 0.8,
      be_done: true
   };

   logTradeJourneySnapshot(mockActiveTrade, 3040, 40);
   assert("logTradeJourneySnapshot sets highestPrice correctly", mockActiveTrade.highestPrice === 3040);
   assert("logTradeJourneySnapshot sets lowestPrice correctly", mockActiveTrade.lowestPrice === 3000);

   const journeys = getTradeJourneysData();
   assert("getTradeJourneysData returns snapshots", journeys.length > 0 && journeys[0].symbol === "ETHUSDT");
}

// 4. Test Completed Trade Decision Logging & MFE / MAE Calculation
{
   const mockTradeToClose = {
      symbol: "ETHUSDT",
      direction: "LONG",
      entry: 3000,
      sl: 2950,
      initialSlDist: 50,
      initialPos: 1.0,
      entryTime: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      grade: "GRADE_A",
      score: 8.4,
      profitR: 1.8,
      highestPrice: 3100, // Maximum Favorable: (3100 - 3000) / 50 = +2.0R
      lowestPrice: 2980,  // Maximum Adverse: (3000 - 2980) / 50 = -0.4R
      candlesBeforeEntry: [
         { timestamp: new Date().toISOString(), open: 2980, high: 3010, low: 2975, close: 3000, volume: 500 }
      ],
      whaleData: { scenario: "INST_ACCUMULATION" }
   };

   logTradeDecision(mockTradeToClose, {
      exitPrice: 3090,
      exitReason: "TP2 Reached",
      finalPnl: 88.5,
      fees: 1.5,
      currentKlines: [
         { time: Date.now(), open: 3080, high: 3095, low: 3075, close: 3090, volume: 800 }
      ]
   });

   const decisions = getTradingDecisionsData();
   assert("logTradeDecision records completed trade", decisions.length > 0);
   const lastDecision = decisions[0];
   assert("Result is classified as WIN", lastDecision.result === "WIN");
   assert("MFE is calculated correctly (2.0R)", lastDecision.maximum_favorable_excursion_r === 2.0);
   assert("MAE is calculated correctly (0.4R)", lastDecision.maximum_adverse_excursion_r === 0.4);
   assert("Candles before entry and during trade are preserved", lastDecision.candles_before_entry.length === 1 && lastDecision.candles_during_trade.length === 1);
}

// 5. Test Performance Summary Calculation
{
   const summary = getPerformanceSummaryData();
   assert("Performance summary aggregates total_trades", summary.total_trades >= 1);
   assert("Performance summary aggregates win_rate", summary.win_rate_percent > 0);
   assert("Performance summary breaks down by direction", summary.by_direction?.LONG?.trades >= 1);
}

// 6. Test Full Export Bundle (Single-click ChatGPT Export)
{
   const bundle = getFullExportBundle();
   assert("Full export bundle contains schema_version", bundle.schema_version === "2.1.0");
   assert("Full export bundle contains trading_decisions array", Array.isArray(bundle.trading_decisions));
   assert("Full export bundle contains rejected_signals array", Array.isArray(bundle.rejected_signals));
   assert("Full export bundle contains performance_summary", bundle.performance_summary.total_trades >= 1);
}

console.log(`\n📊 RESEARCH TEST SUMMARY: ${passed} PASSED | ${failed} FAILED\n`);

if (failed > 0) {
   process.exit(1);
} else {
   console.log("✨ All Research Logging Tests PASSED! Dataset is ready for ChatGPT analysis.\n");
}
