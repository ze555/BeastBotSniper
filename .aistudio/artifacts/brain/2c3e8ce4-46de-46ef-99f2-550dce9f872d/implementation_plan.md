# BeastBOTSniper Anti-Loss & Regime Adaptive Architecture Plan

Architectural blueprint to eliminate false-breakout losses, prevent panic bottom-selling, enable altcoin mean-reversion longs during sideways Bitcoin regimes, and optimize short entries to pullback-only structures.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions reflect your answers from the interactive questionnaire:
> - **Oversold Short Blocker**: Block any SHORT entry when an asset's RSI is below 42 or stretched below $1.8 \times \text{ATR}$ under EMA21, ensuring the bot never "sells the bottom" into incoming relief bounces.
> - **Concurrent Trades & Cooldown**: Respecting your selection (**"No need"**), we will **not** impose rigid limits or cooldown pauses on positions, preserving your freedom to trade all valid setups simultaneously.
> - **BTC Sideways Long Allowance**: When Bitcoin ranges within a tight sideways corridor (-1.0% to +1.0% 24h change), enable high-conviction **Mean-Reversion LONG setups** on altcoins bouncing from support, capturing rallies (like recent ETH, NEAR, NBIS, and BNB pumps) rather than starving the bot of longs.

---

## 1. Overview & Core Concept

- **What It Does**: Upgrades the market regime classifier in `reasoningEngine.ts` and `apexPredator.ts` to differentiate between true catastrophic market crashes and harmless sideways consolidations. Enforces strict entry filters so shorts are taken exclusively on corrective bounces to resistance (pullbacks), while permitting longs when altcoins demonstrate structural buying pressure during neutral BTC conditions.
- **Target Audience / Execution Context**: Algorithmic futures trader running BeastBOTSniper on Binance USDT-M markets to generate consistent positive alpha with tight capital preservation.
- **Key Value**: Prevents the catastrophic scenario observed online where 97 consecutive shorts were opened during a sideways market, turning what would have been a -$128 loss into positive expectancy.

---

## 2. Trading Mechanics & Execution Flow

```
                      ┌─────────────────────────────────┐
                      │    BTC Context Engine (1h/4h)   │
                      └────────────────┬────────────────┘
                                       │
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
     [BTC Chg < -1.5% & Flow < 0]                 [-1.0% <= BTC Chg <= +1.0%]
     True Strong Bear Market                      Sideways Neutral Market
                │                                             │
    ┌───────────┴───────────┐                     ┌───────────┴───────────┐
    ▼                       ▼                     ▼                       ▼
Shorts Allowed        Longs Blocked         Pullback Shorts         Mean-Reversion Longs
(Pullback Only)                            (RSI > 48, EMA21)        (Confirmed Support)
```

### Key Execution Gates:
1. **Oversold Short Gate (`OversoldShortBlocker`)**:
   - Evaluates asset 15m RSI and price distance to EMA21.
   - If `RSI < 42` OR `price < EMA21 - (1.8 * ATR14)`: Immediate rejection with log:
     `❌ رُفض SHORT [Symbol]: تشبع بيعي حاد (RSI 36 < 42). ممنوع بيع القيعان لتفادي الارتداد المعاكس.`
2. **Pullback Short Quality Rule (`PullbackShortGate`)**:
   - In any bearish regime, shorts are strictly forbidden on large expanding red breakdown candles.
   - Entry requires a retest or bounce to EMA21 / resistance with a bearish rejection upper wick (`u_wick >= body * 1.2`).
3. **Neutral BTC Altcoin Long Gate (`NeutralBtcLongAllowance`)**:
   - When BTC 24h change is between `-1.0%` and `+1.0%` with stable volatility, classify BTC as `NEUTRAL_CONSOLIDATION` rather than `BEAR_STRONG`.
   - Permit `PULLBACK_SNIPER` and `BREAKOUT_MOMENTUM` Long setups if altcoin CVD is strongly bullish and RSI is healthy (45–65).

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Neutral Consolidation vs Blind Binary Bear Gate**
  - *Chosen Approach*: Replace binary `BEAR_STRONG` triggers (which triggered on mere -0.35% drift) with a dynamic 3-tier threshold (`BEAR_CRASH`, `NEUTRAL_RANGE`, `BULL_TREND`).
  - *Why*: In crypto, Bitcoin frequently consolidates for days within 1% ranges while altcoins pump 5% to 15%. Banning longs completely during neutral periods blinds the bot to the highest-performing opportunities.
  - *Alternatives Considered*: Hardcoding a fixed BTC price level; rejected because percentage drift and volatility are market-adaptive.

- **Decision 2: RSI 42 Floor for Short Orders**
  - *Chosen Approach*: Enforce `RSI >= 42` for any short entry.
  - *Why*: Our forensic study of the 65 online losing shorts showed an average entry RSI of 36.9. At RSI < 42, reward-to-risk deteriorates rapidly because short-sellers are vulnerable to aggressive short squeezes.
  - *Alternatives Considered*: RSI 35; rejected because by 35 the asset is already at peak exhaustion and relief bounces happen within 1 to 2 candles.

- **Decision 3: Zero Position / Cooldown Limits (Per User Directive)**
  - *Chosen Approach*: No artificial position count cap or cooldown delays will be applied.
  - *Why*: You explicitly instructed "No need", ensuring the bot can capitalize on multi-coin market waves without arbitrary throttling.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                         scanAndTrade Pipeline                          │
│                                                                        │
│   1. Read Market Context (BTC 24h, Flow, ATR)                          │
│      ├── True Bear: BTC < -1.5% with expanding volume                  │
│      └── Neutral Range: -1.0% <= BTC <= +1.0%                          │
│                                                                        │
│   2. Asset Scanner (Whale Data, Price, CVD, Orderflow)                 │
│      ├── Directional Thesis Check                                      │
│      ├── Timing Gate (Late expansion blocker)                          │
│      ├── Flow Persistence (Conflicted flow blocker)                    │
│      ├── Location Gate (Bad location blocker)                          │
│      └── [NEW] Oversold Short Blocker (RSI < 42 & ATR stretch)         │
│                                                                        │
│   3. Execution & Dynamic Sizing                                        │
│      └── Calculate precise pos size & SL/TP levels                     │
│                                                                        │
│   4. Active Position Management (exitBrain)                            │
│      ├── CVD/OI Peak Exhaustion Lock (+0.70R+)                         │
│      ├── Early Invalidation Protection (-0.30R)                        │
│      └── Multi-Target Trailing Profit Take                             │
└────────────────────────────────────────────────────────────────────────┘
```

### Files to Modify Upon Approval:
- `src/lib/reasoningEngine.ts`: Refine BTC market regime categorization to classify -1.0% to +1.0% as `CONSOLIDATION` / `NEUTRAL_RANGE`. Add `OversoldShortBlocker` rule.
- `src/lib/apexPredator.ts`: Wire the refined regime and oversold blocker into `scoreEntry` and `evaluateExecutionFilter`. Ensure altcoin longs are valid during neutral BTC regimes.
- `src/lib/reasoningEngine.test.ts`: Add automated unit tests covering the new oversold short blocker and neutral BTC long enablement to guarantee zero regression.
