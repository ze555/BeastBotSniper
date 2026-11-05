# Futures-Only Violent-Wave Engine

## Objective

The scanner is designed to find unusually violent upward and downward moves in Binance USD-M USDT perpetuals. Quiet contracts should remain DORMANT. This is a wave detector, not a general-purpose trend-entry strategy and not a guarantee that every large move will be captured.

## Runtime path

New entries from both the priority queue and the rotating universe now pass through `evaluateInstitutionalEntry` and `institutionalMarketEngine.ts`. The legacy score-based entry path is not used by the scanner for new entries. There is no weighted score or numeric confluence sum in the Futures-only decision engine.

## Live Futures tape

- Binance USD-M combined WebSocket `<symbol>@aggTrade` streams are opened for active USDT perpetual contracts, in small shards.
- The feed keeps a rolling five-minute tape per symbol.
- Entry evidence retains rolling 5m, 1m, 30s and optional 5s executed aggressor windows for every subscribed symbol.
- The 5m window establishes prevailing pressure; 1m participation and 30s execution plus the actual price response determine entry timing. The 5s window is diagnostic only and is never mandatory.
- Binance aggregate-trade `m=true` means the buyer was maker and the seller was aggressor; `m=false` means the buyer was aggressor.
- Candidate discovery admits 1m reversals and 30s impulses against a 5m backdrop. It sorts candidates for evaluation order but does not truncate to a Top-N list. The broader universe is also evaluated through the same wave detector in rotating batches.
- If the WebSocket tape is unavailable for a symbol, the scanner falls back to recent Binance USD-M `/fapi/v1/aggTrades` polling. Stale or insufficient Futures flow fails closed.

This avoids waiting for a 1-minute candle close. The current forming Futures candle is included in the entry snapshot.

## Other evidence

- Binance USD-M order book: `GET /fapi/v1/depth`. A new entry requires a fresh book, top-20 combined notional depth of at least 10,000 USDT, and spread no wider than 20 bps. Displayed depth is contextual and is not treated as executed demand/supply.
- Open-interest history: `GET /futures/data/openInterestHist` at 15-minute intervals. OI is contextual and does not block an otherwise valid early Futures impulse when unavailable. It helps distinguish expanding positions from short-covering / long-liquidation impulses, but it is not tick-level OI.
- Funding: `GET /fapi/v1/premiumIndex`. Funding is a crowding/exhaustion warning, not a directional entry trigger.
- Liquidation feed is not yet integrated. No synthetic liquidation values are generated; the engine reports this source as unavailable.
- Spot is not queried, passed to, or consulted by the institutional entry/exit engine.

## Entry logic

- Long ignition: 1m Futures buyer participation and 30s executed buying align with a positive 1m price response, while 5m flow/price provide the prevailing context. A 1m/30s reversal can qualify against opposing 5m pressure only after price confirms the turn.
- Short ignition: the mirrored seller-dominant conditions.
- Strong aggressor flow without a corresponding price response is treated as possible absorption and does not qualify as a confirmed entry.
- OI expansion is not assigned a long/short direction by itself. OI contraction is not called a confirmed liquidation/squeeze unless matching Binance force-order events and price/flow direction are observed.
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
- The engine has not yet completed a historical tick-level replay for AKEUSDT or ARIAUSDT. Existing candle-only records cannot reconstruct historical 5m/1m/30s executed aggressor windows, depth replenishment, or prove early Futures detection and profitability.
- The rolling 5m tape resets on process restart; REST fallback requests up to 1,000 recent aggregate trades and only reports windows actually covered by those returned prints.

## Validation

Run:

`npm test`

The test suite includes Futures-only long/short ignition, squeeze/liquidation impulses, quiet-market suppression, stale flow rejection, executable-depth rejection, continuation, Futures-only exits, and rolling-tape candidate detection.

No merge to main or production deployment is part of this branch.


## Symmetric reverse-wave execution (added 2026-11-05)

- LONG and SHORT use mirrored directional rules.
- After a confirmed exit closes the original side, a fresh opposite-side candidate must pass the normal Futures-only institutional entry path.
- Reverse execution additionally requires fresh 30s/1m executed aggressor flow, price response in both windows, an executable structural entry, and at least one independent confirmation: two available CVD horizons (5m/15m/4h), OI expansion aligned with price plus sampled order-book depth change, or fresh matching Binance force-order events.
- Missing liquidation events do not block a reverse if CVD or OI+book confirms. OI alone never establishes direction.
- No reverse is opened for same-side, stale, structurally unconfirmed, or unconfirmed candidates; existing trade-capacity rules still apply.
- The scanner universe, candidate flow, Top-N behavior, cooldowns, session access, and TP/SL settings are unchanged.
- Rolling Futures tape and REST fallback now report actual 1m/5m time coverage. A partial 5m sample is not misrepresented as a full 5m context; 1m/30s ignition remains eligible.
- Tick-level replay with historical Futures tape/book/OI data is still required before claiming profitability improvement or deploying to production.

- Multi-timeframe CVD confirmation currently uses Binance Futures kline taker-buy minus taker-sell volume as a candle-derived proxy; it is not a full tick-by-tick exchange-wide CVD feed.
