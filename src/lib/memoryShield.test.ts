// ============================================================================
// v3.4.1 MEMORY SHIELD TEST SUITE
// Verifies the hostless OOM fixes — the process used to grow until the
// platform killed it:
//   A. researchLogger: pendingRejectedMap hard ceiling (600) — orphan events
//      with 40-candle payloads can no longer accumulate without bound
//   B. researchLogger: pendingRejectedMap TTL eviction (3h horizon)
//   C. researchLogger: direction-map TTL eviction (stale tradeRef release)
//   D. researchLogger: emergencyTrimResearchStores drops every bounded store
//   E. apexPredator: addClosedTradeBounded caps the book (400) + slims deep
//      entries (candles/reasoning nulled past depth 60, newest kept full)
//   F. apexPredator: computeTradeCadence rolling window math (1h / 24h)
// ============================================================================
import {
   logRejectedSignal,
   registerTradeForDirectionTracking,
   pruneResearchTrackingStores,
   getResearchMemoryStats,
   emergencyTrimResearchStores
} from "./researchLogger.js";
import { addClosedTradeBounded, computeTradeCadence } from "./apexPredator.js";

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

console.log("\n🧪 RUNNING v3.4.1 MEMORY SHIELD VERIFICATION SUITE\n");

const MINIMAL_PRICE = { price: 100, rsi: 50, adx: 20, atr14: 1, atr20: 1, ema21: 100, ema50: 100, ema200: 100, rvol: 1.0, taker: 0.5, klines: [] };
const MINIMAL_WHALE = { slope15: 0, slope5: 0, slope4h: 0, oi_chg: 0, fund: 0 };
const MINIMAL_CTX = { regime: "RANGE", tradeable: true };

// ═══ A. pendingRejectedMap hard ceiling ═══
{
   for (let i = 0; i < 650; i++) {
      logRejectedSignal({
         symbol: `CAP${i}USDT`,
         timeframe: "15m",
         direction: "LONG",
         signal_score: 9.0,
         rejection_reason: "Memory Shield cap test",
         p: MINIMAL_PRICE,
         w: MINIMAL_WHALE,
         ctx: MINIMAL_CTX
      });
   }
   const stats = getResearchMemoryStats();
   assert("A1: 650 logged rejections → pending map respects the 600 ceiling", stats.pendingRejected <= 600);
   assert("A2: memoryRejected array still bounded at 1000", stats.memoryRejected <= 1000);
   assert("A3: pending map actually tracked the batch (>500 live)", stats.pendingRejected > 500);

   // ═══ B. pendingRejectedMap TTL eviction ═══
   // signalTimeMs is "now" at log time — a prune pass 4h in the future must
   // consider every entry expired.
   const evicted = pruneResearchTrackingStores(Date.now() + 4 * 60 * 60 * 1000);
   const statsAfter = getResearchMemoryStats();
   assert("B1: TTL prune (future now = +4h) evicted the entire pending map", statsAfter.pendingRejected === 0);
   assert("B2: TTL prune reported a non-zero eviction count", evicted.evictedPending > 0);

   // ═══ C. direction-map TTL eviction ═══
   const freshTrade = {
      symbol: "FRESHUSDT",
      direction: "LONG",
      entry: 100,
      entryTime: new Date().toISOString()
   };
   const staleTrade = {
      symbol: "STALEUSDT",
      direction: "SHORT",
      entry: 100,
      entryTime: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
   };
   registerTradeForDirectionTracking(freshTrade);
   registerTradeForDirectionTracking(staleTrade);
   const midStats = getResearchMemoryStats();
   assert("C1: direction map holds both registered trackers", midStats.directionTracked >= 2);
   const dirEvicted = pruneResearchTrackingStores(Date.now());
   const endStats = getResearchMemoryStats();
   assert("C2: TTL prune evicted the 4h-old tracker (tradeRef released)", endStats.directionTracked === midStats.directionTracked - 1);
   assert("C3: fresh tracker survived the TTL prune", endStats.directionTracked >= 1);
   assert("C4: direction eviction reported", dirEvicted.evictedDirection === 1);

   // ═══ D. emergencyTrimResearchStores ═══
   for (let i = 0; i < 5; i++) {
      logRejectedSignal({
         symbol: `TRIM${i}USDT`,
         timeframe: "15m",
         direction: "SHORT",
         signal_score: 8.0,
         rejection_reason: "Emergency trim test",
         p: MINIMAL_PRICE,
         w: MINIMAL_WHALE,
         ctx: MINIMAL_CTX
      });
   }
   const trimResult = emergencyTrimResearchStores();
   const trimStats = getResearchMemoryStats();
   assert("D1: emergency trim cleared pending rejections", trimStats.pendingRejected === 0 && trimResult.clearedPending >= 5);
   assert("D2: emergency trim cleared direction trackers", trimStats.directionTracked === 0 && trimResult.clearedDirection >= 1);
   assert("D3: emergency trim bounded memoryRejected ≤ 200", trimStats.memoryRejected <= 200);
   assert("D4: emergency trim bounded memoryDecisions ≤ 80", trimStats.memoryDecisions <= 80);
   assert("D5: emergency trim bounded memoryJourneys ≤ 100", trimStats.memoryJourneys <= 100);
}

// ═══ E. addClosedTradeBounded — bounded closed-trade book ═══
{
   const book: any[] = [];
   const mkTrade = (i: number) => ({
      symbol: `T${i}USDT`,
      direction: "LONG",
      finalPnl: 1,
      candlesBeforeEntry: new Array(40).fill({ o: 1, h: 2, l: 0.5, c: 1.5, v: 100 }),
      reasoning: { confirmation: { evidence: ["x"] }, timingGate: { state: "CONFIRMED" } }
   });
   for (let i = 0; i < 450; i++) addClosedTradeBounded(book, mkTrade(i));

   assert("E1: 450 closed trades → book capped at 400", book.length === 400);
   assert("E2: newest trade keeps its full candle payload", Array.isArray(book[0].candlesBeforeEntry) && book[0].candlesBeforeEntry.length === 40);
   assert("E3: newest trade keeps its reasoning tree", book[0].reasoning?.timingGate?.state === "CONFIRMED");
   assert("E4: deep entries (index ≥ 60) are slimmed — candles nulled", book[70].candlesBeforeEntry === null);
   assert("E5: deep entries (index ≥ 60) are slimmed — reasoning nulled", book[70].reasoning === null);
   assert("E6: entries inside the full-depth window (index < 60) keep candles", Array.isArray(book[30].candlesBeforeEntry) && book[30].candlesBeforeEntry.length === 40);
   assert("E7: evicted count reported correctly on overflow", addClosedTradeBounded(book, mkTrade(999)).evicted === 1);

   // FIFO sanity: newest first
   assert("E8: book is newest-first (unshift semantics preserved)", book[0].symbol === "T999USDT");
}

// ═══ F. computeTradeCadence — rolling window math ═══
{
   const NOW = Date.now();
   const H = 60 * 60 * 1000;
   const stamps = [NOW - 5 * 60 * 1000, NOW - 55 * 60 * 1000, NOW - 2 * H, NOW - 10 * H, NOW - 30 * H];
   const cad = computeTradeCadence(stamps, NOW);
   assert("F1: tradesLast1h counts exactly the ≤1h stamps", cad.tradesLast1h === 2);
   assert("F2: tradesLast24h counts exactly the ≤24h stamps", cad.tradesLast24h === 4);
   const empty = computeTradeCadence([], NOW);
   assert("F3: empty ring → zero cadence", empty.tradesLast1h === 0 && empty.tradesLast24h === 0);
   assert("F4: 24h of 5-minute stamps → 288/day cadence detected", computeTradeCadence(
      Array.from({ length: 288 }, (_, i) => NOW - i * 5 * 60 * 1000), NOW
   ).tradesLast24h === 288);
}

console.log(`\n📊 MEMORY SHIELD v3.4.1 TEST SUMMARY: ${passed} PASSED | ${failed} FAILED\n`);

if (failed > 0) {
   process.exit(1);
} else {
   console.log("✨ All MEMORY SHIELD v3.4.1 Tests PASSED flawlessly!\n");
}
