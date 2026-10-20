# Sniper Trading Bot

A trading bot application built with React, Vite, and Node.js.

## Features
- Real-time trading dashboard
- Automated sniper bot operations
- Token analysis

## Getting Started

```bash
npm install
npm run dev
```

## Safety regression checks

Run `npm run test:safety` for the targeted safety tests and compatible reasoning,
direction, and research-logger suites. The integration tests mock market requests;
the runner isolates research output in a temporary directory. It does not start
the application or connect to a trading account. `npm run build` only builds assets.

Signals now use closed candles. A retest needs an earlier closed breakout and a
later defended touch. New positions require observed swing-level headroom and at
least 2.5R planned weighted return after configured fees and exit slippage. Missing
structural headroom blocks entry rather than inventing a target, so fewer signals
may qualify.

New positions allocate 15% / 25% / 60% at 0.75R / 1.80R / up to 3.50R, respectively
(2.6625R gross if all full targets fill). The runner target is capped before the
nearest observed obstacle. Saved positions retain their own weights and targets.
This is a planning filter, not a promise of realized returns; partial exits and
stops can realize less. Profit/loss entry halts remain latched until explicit
reactivation while open positions continue to be managed.

The older `executionFilter.test.ts` is not included in `test:safety`: it imports a
missing export from `apexPredator` and expects an obsolete interface. This baseline
issue also prevents a clean full-project `tsc --noEmit`; it is not a passing check.
