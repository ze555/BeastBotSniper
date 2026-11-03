# Futures-Only Violent-Wave Engine

## Objective

The scanner is designed to find unusually violent upward and downward moves in Binance USD-M USDT perpetuals. Quiet contracts should remain DORMANT. This is a wave detector, not a general-purpose trend-entry strategy and not a guarantee that every large move will be captured.

## Runtime path

New entries from both the priority queue and the rotating universe now pass through `evaluateInstitutionalEntry` and `institutionalMarketEngine.ts`. The legacy score-based entry path is not used by the scanner for new entries. There is no weighted score or numeric confluence sum in the Futures-only decision engine.

## Live Futures tape

- Binance USD-M combined WebSocket `<symbol>@aggTrade` streams are opened for active USDT perpetual contracts, in small shards.
- The feed keeps a rolling five-minute tape per symbol.
- Entry evidence uses the latest 30 seconds of executed aggressor flow and a five-second acceleration window.
- Binance aggregate-trade `m=true` means the buyer was maker and the seller was aggressor; `m=false` means the buyer was aggressor.
- A candidate is promoted when directional executed flow is accompanied by a meaningful 30-second price impulse or a material volume burst against a sufficiently populated recent baseline.
- The priority queue checks the top Futures-tape candidates plus active 24-hour movers. The broader universe is also evaluated through the same wave detector in rotating batches.
- If the WebSocket tape is unavailable for a symbol, the scanner falls back to recent Binance USD-M `/fapi/v1/aggTrades` polling. Stale or insufficient Futures flow fails closed.

This avoids waiting for a 1-minute candle close. The current forming Futures candle is included in the entry snapshot.

## Other evidence

- Binance USD-M order book: `GET /fapi/v1/depth`. A new entry requires a fresh book, top-20 combined notional depth of at least 10,000 USDT, and spread no wider than 20 bps. Displayed depth is contextual and is not treated as executed demand/supply.
- Open-interest history: `GET /futures/data/openInterestHist` at 15-minute intervals. OI is contextual and does not block an otherwise valid early Futures impulse when unavailable. It helps distinguish expanding positions from short-covering / long-liquidation impulses, but it is not tick-level OI.
- Funding: `GET /fapi/v1/premiumIndex`. Funding is a crowding/exhaustion warning, not a directional entry trigger.
- Liquidation feed is not yet integrated. No synthetic liquidation values are generated; the engine reports this source as unavailable.
- Spot is not queried, passed to, or consulted by the institutional entry/exit engine.

## Entry logic

- Long ignition: executed Futures buyers dominate (buy share at least 60%), total 30-second executed quote flow is at least 5,000 USDT, and the live candle / recent structure shows an upward impulse or compressed-range release. A five-second buyer acceleration can qualify before a full candle close.
- Short ignition: the mirrored seller-dominant conditions.
- A price/flow impulse with falling OI can qualify as a tradable squeeze or liquidation-led wave when executed Futures aggression confirms the direction. It is not automatically rejected merely because OI contracts.
- New entries require a fresh, executable order book. Thin or wide-spread contracts remain watch-only.
- Quiet symbols with no directional executed flow and no abnormal participation remain DORMANT.
- BTC is context only. A BTC whipsaw or opposite BTC direction does not veto a separately confirmed altcoin Futures wave.
- Existing positions are managed as continuations; the engine does not repeatedly open fresh entries just because a wave is already running.

These thresholds are initial operational gates, not statistically calibrated universal constants. They require replay calibration against archived Futures trade, book and OI data before any live deployment.

## Exit management

The institutional exit path uses Futures aggressor flow only. A full exit requires structural invalidation, adverse price location and adverse executed Futures flow. Deterioration without the full reversal chain triggers PROTECT. Hard stops and staged take-profit controls remain active.

## Runtime limitations

- The market tape is continuous through WebSocket streams, but candidate evaluation and order placement still run through the bot's 15-second loop and sequential REST-heavy evaluation. A very large candidate queue or API latency can delay evaluation.
- OI is 15-minute history, not a live tick stream.
- Liquidation events and full depth-delta/cancel dynamics are not yet integrated.
- The rolling tape is in memory and resets on process restart.
- The engine has not yet completed a historical tick-level replay for AKEUSDT or ARIAUSDT. Existing candle-only records cannot prove early Futures detection or profitability.

## Validation

Run:

`npm test`

The test suite includes Futures-only long/short ignition, squeeze/liquidation impulses, quiet-market suppression, stale flow rejection, executable-depth rejection, continuation, Futures-only exits, and rolling-tape candidate detection.

No merge to main or production deployment is part of this branch.
