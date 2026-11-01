# BeastBOTSniper Institutional Tri-Regime Modular Architecture Plan

Architectural blueprint strictly isolating the trading execution engine into 3 non-overlapping institutional sub-engines:
1. **Crash / Dump (شلال انهياري)**: Long closed 100%, Breakdown Short enabled with Oversold RSI Bypass and Tsunami Runner hold.
2. **Bull / Pump (انفجار صعودي)**: Short closed 100%, Breakout & Pullback Long enabled with Multi-Tier Profit Protection.
3. **Range / Chop (تذبذب عرضي)**: Breakout Momentum strictly prohibited (Breakout: ملغى), Dead Chop Capital Defense active, and Boundary Mean Reversion allowed only at extreme Range Low / Range High with verified absorption.

---

## 1. Verified Architecture Diagram

```
                  ┌──────────────────────────────┐
                  │    Market Regime Detector    │
                  └──────────────┬───────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
┌──────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│ 1. Crash/Dump    │   │ 2. Bull/Pump      │   │ 3. Range/Chop     │
│   (شلال انهياري)   │   │  (انفجار صعودي)    │   │   (تذبذب عرضي)    │
├──────────────────┤   ├───────────────────┤   ├───────────────────┤
│ • Long: مغلق 100%│   │ • Short: مغلق 100%│   │ • Breakout: ملغى  │
│ • Breakdown Short│   │ • Breakout Long   │   │ • إما دفاع وحفظ رأس│
│ • تجاوز RSI oversold││ • Pullback Long   │   │   مال أو صيد أطراف│
│ • ركوب الشلال    │   │ • حماية الأرباح   │   │   الرينج (Reversion)│
└──────────────────┘   └───────────────────┘   └───────────────────┘
```

---

## 2. Implementation Deliverables

1. **`src/lib/triRegimeEngine.ts`**:
   - `detectMacroRegime`: Classifies context deterministically into `CRASH_DUMP`, `BULL_PUMP`, or `RANGE_CHOP`.
   - `evaluateTriRegimeExecution`: Enforces zero-tolerance gates per regime:
     - In `CRASH_DUMP`: Long is blocked 100% (`allowed: false`); Breakdown Shorts bypass RSI oversold blocker down to deep momentum levels with `TSUNAMI_RUNNER` strategy.
     - In `BULL_PUMP`: Short is blocked 100% (`allowed: false`); Breakout and Pullback Longs approved with `TSUNAMI_RUNNER` strategy.
     - In `RANGE_CHOP`: Breakout attempts are cancelled 100%; Dead Chop (ADX < 18 or RVOL < 1.20) is blocked for Capital Defense; Range Boundary Mean Reversion is enabled only at Range Low (with buying absorption) or Range High (with selling absorption) for quick 0.8R-1.0R targets.

2. **Integration into Core Engines**:
   - `src/lib/reasoningEngine.ts`: Added `macroRegime` and `triRegime` evaluation to `ReasoningResult` in `evaluateSymbolReasoning`.
   - `src/lib/apexPredator.ts`: Connected `triRegime` gatekeeper to `evaluateSymbol` to enforce regime boundaries before any trade entry.

3. **Verification**:
   - `src/lib/triRegimeEngine.test.ts`: 18 PASSED / 0 FAILED.
   - `src/lib/reasoningEngine.test.ts`: 70 PASSED / 0 FAILED.
   - `src/lib/directionDecoupling.test.ts`: 20 PASSED / 0 FAILED.
   - `src/lib/directionStateEngine.test.ts`: 12 PASSED / 0 FAILED.
   - `src/lib/executionFilter.test.ts`: 24 PASSED / 0 FAILED.
   - `src/lib/researchLogger.test.ts`: 41 PASSED / 0 FAILED.
   - Total test suite: 185 PASSED / 0 FAILED (100% success rate).
