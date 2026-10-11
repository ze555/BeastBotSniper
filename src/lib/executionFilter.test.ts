// ============================================================================
// Execution Filter Verification Suite for BeastBotSniper Architecture
// ============================================================================
import { evaluateExecutionFilter } from "./apexPredator.js";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, failureDetails?: string) {
  if (condition) {
     console.log(`✅ [PASS] ${testName}`);
     passedCount++;
  } else {
     console.error(`❌ [FAIL] ${testName} - ${failureDetails || "Condition not met"}`);
     failedCount++;
  }
}

console.log("=======================================================");
console.log("🧪 RUNNING BEASTBOTSNIPER EXECUTION FILTER TEST SUITE");
console.log("=======================================================");

// ----------------------------------------------------------------------------
// 1. BLOCKED SHORT TESTS
// حظر SHORT: عندما يكون "BTC Regime = BULL_STRONG" وحالة الأصل "TRANSITION" أو "TREND_UP"
// ----------------------------------------------------------------------------
{
  const res1 = evaluateExecutionFilter("SHORT", "BULL_STRONG", "TRANSITION");
  assert(res1.blocked === true, "SHORT blocked when BTC=BULL_STRONG and Asset=TRANSITION");
  assert(
    typeof res1.reason === "string" && res1.reason.includes("BULL_STRONG") && res1.reason.includes("TRANSITION"),
    "SHORT rejection reason explicitly logs BTC=BULL_STRONG and Asset=TRANSITION"
  );

  const res2 = evaluateExecutionFilter("SHORT", "BULL_STRONG", "TREND_UP");
  assert(res2.blocked === true, "SHORT blocked when BTC=BULL_STRONG and Asset=TREND_UP");
  assert(
    typeof res2.reason === "string" && res2.reason.includes("BULL_STRONG") && res2.reason.includes("TREND_UP"),
    "SHORT rejection reason explicitly logs BTC=BULL_STRONG and Asset=TREND_UP"
  );
}

// ----------------------------------------------------------------------------
// 2. ALLOWED SHORT TESTS
// لا تحظر RANGE حاليًا؛ ولا تحظر الحالات الأخرى غير المحددة
// ----------------------------------------------------------------------------
{
  // RANGE must NOT be blocked
  const resRange = evaluateExecutionFilter("SHORT", "BULL_STRONG", "RANGE");
  assert(resRange.blocked === false, "SHORT allowed when BTC=BULL_STRONG and Asset=RANGE (RANGE not blocked)");

  // TREND_DOWN during BULL_STRONG
  const resDown = evaluateExecutionFilter("SHORT", "BULL_STRONG", "TREND_DOWN");
  assert(resDown.blocked === false, "SHORT allowed when BTC=BULL_STRONG and Asset=TREND_DOWN");

  // Other regimes: BULL_WEAK, BEAR_STRONG, BEAR_WEAK
  const resWeak = evaluateExecutionFilter("SHORT", "BULL_WEAK", "TRANSITION");
  assert(resWeak.blocked === false, "SHORT allowed when BTC=BULL_WEAK and Asset=TRANSITION");

  const resBear = evaluateExecutionFilter("SHORT", "BEAR_STRONG", "TREND_UP");
  assert(resBear.blocked === false, "SHORT allowed when BTC=BEAR_STRONG and Asset=TREND_UP");

  const resBear2 = evaluateExecutionFilter("SHORT", "BEAR_WEAK", "TRANSITION");
  assert(resBear2.blocked === false, "SHORT allowed when BTC=BEAR_WEAK and Asset=TRANSITION");
}

// ----------------------------------------------------------------------------
// 3. BLOCKED LONG TESTS
// حظر LONG: عندما يكون "BTC Regime = BULL_WEAK" وحالة الأصل "TRANSITION" أو "TREND_DOWN"
// ----------------------------------------------------------------------------
{
  const res1 = evaluateExecutionFilter("LONG", "BULL_WEAK", "TRANSITION");
  assert(res1.blocked === true, "LONG blocked when BTC=BULL_WEAK and Asset=TRANSITION");
  assert(
    typeof res1.reason === "string" && res1.reason.includes("BULL_WEAK") && res1.reason.includes("TRANSITION"),
    "LONG rejection reason explicitly logs BTC=BULL_WEAK and Asset=TRANSITION"
  );

  const res2 = evaluateExecutionFilter("LONG", "BULL_WEAK", "TREND_DOWN");
  assert(res2.blocked === true, "LONG blocked when BTC=BULL_WEAK and Asset=TREND_DOWN");
  assert(
    typeof res2.reason === "string" && res2.reason.includes("BULL_WEAK") && res2.reason.includes("TREND_DOWN"),
    "LONG rejection reason explicitly logs BTC=BULL_WEAK and Asset=TREND_DOWN"
  );
}

// ----------------------------------------------------------------------------
// 4. ALLOWED LONG TESTS
// لا تحظر RANGE حاليًا؛ ولا تحظر الحالات الأخرى غير المحددة
// ----------------------------------------------------------------------------
{
  // RANGE must NOT be blocked
  const resRange = evaluateExecutionFilter("LONG", "BULL_WEAK", "RANGE");
  assert(resRange.blocked === false, "LONG allowed when BTC=BULL_WEAK and Asset=RANGE (RANGE not blocked)");

  // TREND_UP during BULL_WEAK
  const resUp = evaluateExecutionFilter("LONG", "BULL_WEAK", "TREND_UP");
  assert(resUp.blocked === false, "LONG allowed when BTC=BULL_WEAK and Asset=TREND_UP");

  // BULL_STRONG allows LONG
  const resStrong = evaluateExecutionFilter("LONG", "BULL_STRONG", "TRANSITION");
  assert(resStrong.blocked === false, "LONG allowed when BTC=BULL_STRONG and Asset=TRANSITION");

  const resStrongUp = evaluateExecutionFilter("LONG", "BULL_STRONG", "TREND_UP");
  assert(resStrongUp.blocked === false, "LONG allowed when BTC=BULL_STRONG and Asset=TREND_UP");

  // BEAR regimes allow according to original system
  const resBear = evaluateExecutionFilter("LONG", "BEAR_WEAK", "TREND_UP");
  assert(resBear.blocked === false, "LONG allowed when BTC=BEAR_WEAK and Asset=TREND_UP");
}

// ----------------------------------------------------------------------------
// 5. EXISTING OPEN POSITIONS INTEGRITY TEST
// لا تغلق الصفقات المفتوحة بسبب هذه الفلاتر
// ----------------------------------------------------------------------------
{
  // Simulated open positions
  const simulatedActiveTrades = [
    {
      id: "trade-1",
      symbol: "ETHUSDT",
      direction: "SHORT",
      entry: 3000,
      sl: 3050,
      status: "OPEN"
    },
    {
      id: "trade-2",
      symbol: "SOLUSDT",
      direction: "LONG",
      entry: 150,
      sl: 145,
      status: "OPEN"
    }
  ];

  // When market shifts to BTC=BULL_STRONG / Asset=TRANSITION
  const shortFilter = evaluateExecutionFilter("SHORT", "BULL_STRONG", "TRANSITION");
  assert(shortFilter.blocked === true, "Filter indicates new SHORT entry is blocked");

  // Open trade remains intact and open
  const openShortTrade = simulatedActiveTrades.find(t => t.id === "trade-1");
  assert(openShortTrade !== undefined && openShortTrade.status === "OPEN", "Open SHORT trade is NOT closed by execution filter");

  // When market shifts to BTC=BULL_WEAK / Asset=TRANSITION
  const longFilter = evaluateExecutionFilter("LONG", "BULL_WEAK", "TRANSITION");
  assert(longFilter.blocked === true, "Filter indicates new LONG entry is blocked");

  // Open long trade remains intact and open
  const openLongTrade = simulatedActiveTrades.find(t => t.id === "trade-2");
  assert(openLongTrade !== undefined && openLongTrade.status === "OPEN", "Open LONG trade is NOT closed by execution filter");
}

console.log("=======================================================");
console.log(`📊 EXECUTION FILTER TEST SUMMARY: ${passedCount} PASSED | ${failedCount} FAILED`);
console.log("=======================================================");

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log("✨ All Execution Filter tests PASSED flawlessly!");
  process.exit(0);
}
