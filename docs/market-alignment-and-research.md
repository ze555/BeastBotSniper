# Market alignment and research telemetry (v2.5)

## Entry confirmation

- Direction is evaluated symmetrically for LONG and SHORT.
- Asset structure is read from 4h, 15m and 5m candles; BTC 4h/15m structure and the live BTC regime are included as market context.
- When the asset or BTC higher-timeframe context opposes a proposed entry, the candidate is retained but execution waits for 5m structure to turn, a 1m structure break, a successful retest (within 0.15 ATR and closing at least 0.03 ATR beyond the level), and aligned 30s/1m executed Futures flow.
- A break is not an entry. The retest must be observed in a later scan; state is isolated by symbol and direction and expires after 10 minutes.
- Existing ATR-normalized absorption/failed-auction checks remain active. TP/SL logic is not changed.

## Live evidence

- Binance USD-M Futures `aggTrade` remains the source for executed aggressor flow and passive outcome tracking.
- Binance USD-M Futures `depth5@100ms` partial-book streams provide repeated top-five bid/ask snapshots. At least three fresh samples spanning 200ms are required before this stream is considered a sampled book observation.
- Depth changes can reflect fills or cancellations; they are not proof of executed absorption and are never described as such without tape/price confirmation.
- REST depth remains a fallback for current spread/liquidity checks.
- Open-interest history and funding remain contextual; stale or incomplete coverage must not be represented as a live confirmation.

## Research and outcome tracking

- Every institutional, market-alignment, entry-quality and structural rejection is written to `rejected_signals.jsonl`, deduplicated per symbol/direction/reason for 30 seconds.
- Live aggTrade updates advance rejected-signal 5m/15m/30m/60m/120m outcomes and active-trade directional snapshots without extra REST requests.
- Research JSONL tails are reloaded on process start. Rejection-outcome rewrites merge by `signal_id` so updating recent outcomes does not truncate older records.
- `/api/research/export-all` returns up to the latest 10,000 records per research stream. `/api/research/diagnostics` reports storage mode, pending outcome trackers, scanner state and feed health.

## Persistent storage

Set `BEASTBOT_RESEARCH_DIR` to a writable persistent volume mount in the hosting environment. If unset or unwritable, the logger falls back to the OS temporary directory and reports `storage_mode: EPHEMERAL_FALLBACK`; files in that fallback are not guaranteed to survive a restart or redeploy.

## Scanner and risk guards

- Discovery continues while position capacity is full and while execution is locked by configured profit/loss or daily loss thresholds.
- Risk guards pause new entries only; they do not stop the market scanner, active-position management or passive research.
- No Top-N truncation, global cooldown, session blacklist or TP/SL change is introduced by this patch.
