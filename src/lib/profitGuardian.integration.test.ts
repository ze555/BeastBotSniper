import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Architecture regression test: no second live exit path may be introduced.
const source = readFileSync(new URL("./apexPredator.ts", import.meta.url), "utf8");
const exitStart = "// --- SINGLE REPLACEMENT EXIT ENGINE: PROFIT GUARDIAN ONLY ---";
const exitEnd = "function closeTradeFull(";
assert.ok(source.includes(exitStart));
assert.ok(source.includes(exitEnd));
const exitBody = source.split(exitStart)[1].split(exitEnd)[0];
assert.ok(exitBody.includes("evaluateProfitGuardian("));
for (const forbidden of [
  "closePart(", "evaluateInstitutionalExit(", "apexReversalExit(",
  "evaluateReverseWave(", "executeTrade(", "t.a_closed", "t.b_closed",
  "TSUNAMI_RUNNER", "TIME-DECAY"
]) {
  assert.equal(exitBody.includes(forbidden), false, `Legacy/secondary exit path remains: ${forbidden}`);
}
// All ordinary entries must remain behind the shared execution risk gate.
assert.ok(source.includes("if (canOpenMore()"));
assert.ok(source.includes("const dailyRiskLocked"));
assert.ok(source.includes("if (dailyRiskLocked) return false;"));
// No legacy TP execution or partial take-profit remain in the active engine.
assert.equal(source.includes("closePart("), false);
assert.equal(source.includes("TP1_R"), false);
console.log("Unified exit architecture regression checks passed");
