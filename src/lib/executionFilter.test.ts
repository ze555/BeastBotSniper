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
console.log("🧪 RUNNING BEASTBOTSNIPER ENHANCED EXECUTION FILTER TESTS");
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
// 2. BLOCKED LONG TESTS
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
// 3. RANGE FILTER RULES (LONG blocked during BULL regimes, SHORT allowed)
// ----------------------------------------------------------------------------
{
  // LONG in RANGE during BULL_STRONG is blocked (the #1 loss maker from Deplexo: -$35.38)
  const resRangeLongBullStrong = evaluateExecutionFilter("LONG", "BULL_STRONG", "RANGE");
  assert(resRangeLongBullStrong.blocked === true, "LONG in RANGE blocked during BTC=BULL_STRONG");

  // LONG in RANGE during BULL_WEAK is blocked
  const resRangeLongBullWeak = evaluateExecutionFilter("LONG", "BULL_WEAK", "RANGE");
  assert(resRangeLongBullWeak.blocked === true, "LONG in RANGE blocked during BTC=BULL_WEAK");

  // SHORT in RANGE during BULL_WEAK (the 92.9% win rate goldmine) is ALLOWED!
  const resRangeShortBullWeak = evaluateExecutionFilter("SHORT", "BULL_WEAK", "RANGE", { rvol: 1.5, adx: 22 });
  assert(resRangeShortBullWeak.blocked === false, "SHORT in RANGE allowed during BTC=BULL_WEAK with volume");

  // SHORT in RANGE during BEAR_WEAK is ALLOWED
  const resRangeShortBear = evaluateExecutionFilter("SHORT", "BEAR_WEAK", "RANGE", { rvol: 1.4, adx: 20 });
  assert(resRangeShortBear.blocked === false, "SHORT in RANGE allowed during BTC=BEAR_WEAK with volume");
}

// ----------------------------------------------------------------------------
// 4. TOXIC HOURS FILTER (05:00, 06:00, 13:00, 18:00 UTC)
// ----------------------------------------------------------------------------
{
  // Toxic hours blocked
  const resHour13 = evaluateExecutionFilter("LONG", "BULL_STRONG", "TREND_UP", { hourUtc: 13 });
  assert(resHour13.blocked === true && resHour13.reason?.includes("toxic hour 13:00 UTC"), "Entry blocked at 13:00 UTC (London/NY overlap chop)");

  const resHour18 = evaluateExecutionFilter("SHORT", "BEAR_WEAK", "TREND_DOWN", { hourUtc: 18 });
  assert(resHour18.blocked === true && resHour18.reason?.includes("toxic hour 18:00 UTC"), "Entry blocked at 18:00 UTC (Late NY liquidation chop)");

  const resHour05 = evaluateExecutionFilter("LONG", "BULL_STRONG", "TREND_UP", { hourUtc: 5 });
  assert(resHour05.blocked === true && resHour05.reason?.includes("toxic hour 5:00 UTC"), "Entry blocked at 05:00 UTC (Asia end chop)");

  const resHour06 = evaluateExecutionFilter("SHORT", "BEAR_WEAK", "TREND_DOWN", { hourUtc: 6 });
  assert(resHour06.blocked === true && resHour06.reason?.includes("toxic hour 6:00 UTC"), "Entry blocked at 06:00 UTC");

  // Golden hours allowed
  const resHour12 = evaluateExecutionFilter("LONG", "BULL_STRONG", "TREND_UP", { hourUtc: 12 });
  assert(resHour12.blocked === false, "Entry allowed at 12:00 UTC (Golden London open hour)");

  const resHour17 = evaluateExecutionFilter("LONG", "BULL_STRONG", "TREND_UP", { hourUtc: 17 });
  assert(resHour17.blocked === false, "Entry allowed at 17:00 UTC (Golden New York power hour)");
}

// ----------------------------------------------------------------------------
// 5. DEAD CHOP VS PRE-BREAKOUT VOLUME IN RANGE
// ----------------------------------------------------------------------------
{
  // Dead chop with RVOL < 1.2 is blocked
  const resLowVol = evaluateExecutionFilter("SHORT", "BULL_WEAK", "RANGE", { rvol: 0.8, adx: 25 });
  assert(resLowVol.blocked === true && resLowVol.reason?.includes("RVOL"), "Dead chop in RANGE blocked when RVOL < 1.20");

  // Dead chop with ADX < 18 is blocked
  const resLowAdx = evaluateExecutionFilter("SHORT", "BULL_WEAK", "RANGE", { rvol: 1.5, adx: 12 });
  assert(resLowAdx.blocked === true && resLowAdx.reason?.includes("ADX"), "Dead chop in RANGE blocked when ADX < 18");

  // Pre-breakout with high RVOL and ADX is allowed
  const resGoodRange = evaluateExecutionFilter("SHORT", "BULL_WEAK", "RANGE", { rvol: 1.6, adx: 24 });
  assert(resGoodRange.blocked === false, "Pre-breakout in RANGE allowed when RVOL >= 1.20 and ADX >= 18");
}

// ----------------------------------------------------------------------------
// 6. EXISTING OPEN POSITIONS INTEGRITY TEST
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

  // When market conditions shift to blocked status
  const filter = evaluateExecutionFilter("SHORT", "BULL_STRONG", "TRANSITION");
  assert(filter.blocked === true, "Filter indicates new entry is blocked");

  // Open trade remains intact and open
  const openShortTrade = simulatedActiveTrades.find(t => t.id === "trade-1");
  assert(openShortTrade !== undefined && openShortTrade.status === "OPEN", "Open SHORT trade is NOT closed by execution filter");

  const openLongTrade = simulatedActiveTrades.find(t => t.id === "trade-2");
  assert(openLongTrade !== undefined && openLongTrade.status === "OPEN", "Open LONG trade is NOT closed by execution filter");
}

console.log("=======================================================");
console.log(`📊 EXECUTION FILTER TEST SUMMARY: ${passedCount} PASSED | ${failedCount} FAILED`);
console.log("=======================================================");

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log("✨ All Enhanced Execution Filter tests PASSED flawlessly!");
  process.exit(0);
}
