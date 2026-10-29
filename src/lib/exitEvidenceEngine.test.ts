import assert from "node:assert/strict";
import { evaluateExitEvidence } from "./exitEvidenceEngine.js";

const base = {
  direction: "LONG" as const,
  priceChangePct: -0.002,
  oiChangePct: 0.004,
  oiAvailable: true,
  cvd5: -120,
  cvd15: -220,
  cvd4h: -500,
  takerRatio: 0.42,
  structureBroken: true,
  hiddenFlowAgainst: false,
  opposingRegime: true
};

// Strong multi-signal reversal should authorize an early discretionary exit.
const confirmed = evaluateExitEvidence(base);
assert.equal(confirmed.action, "EXIT");
assert.ok(confirmed.score >= 6);

// A single broken EMA/structure without aligned flow is not enough to exit.
const structureOnly = evaluateExitEvidence({
  ...base,
  cvd5: 100,
  cvd15: 120,
  cvd4h: 300,
  takerRatio: 0.55,
  oiChangePct: 0,
  hiddenFlowAgainst: false,
  opposingRegime: false
});
assert.notEqual(structureOnly.action, "EXIT");

// Missing OI must not add an OI confirmation point or be reported as available.
const missingOi = evaluateExitEvidence({ ...base, oiAvailable: false, oiChangePct: 0.01 });
assert.equal(missingOi.dataQuality.oiAvailable, false);
assert.ok(!missingOi.reasons.some(reason => reason.includes("OI")));

// Symmetric SHORT: upward price pressure + positive CVD + aggressive buyers confirms exit.
const shortConfirmed = evaluateExitEvidence({
  ...base,
  direction: "SHORT",
  priceChangePct: 0.003,
  cvd5: 130,
  cvd15: 240,
  cvd4h: 400,
  takerRatio: 0.61,
  structureBroken: true
});
assert.equal(shortConfirmed.action, "EXIT");

// Conflicting short-term flow with no structural break should not trigger exit.
const mixedFlow = evaluateExitEvidence({
  ...base,
  cvd5: -100,
  cvd15: 120,
  cvd4h: 200,
  takerRatio: 0.50,
  structureBroken: false,
  hiddenFlowAgainst: false,
  opposingRegime: false
});
assert.notEqual(mixedFlow.action, "EXIT");

console.log("exitEvidenceEngine: 5/5 tests passed");
