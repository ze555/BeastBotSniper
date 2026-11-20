# Main 1m strong-flow fixed 2R (research pilot)

Entry and exit use `PB_STRONG_FLOW_FIXED2_1M_V1` for **new PAPER trades only**.
Legacy positions remain managed by the pre-existing institutional/partial-exit code.
The selected rule was explored on 61 Binance Vision symbols, 2026-08-15 through 2026-11-12: 36 trades, 16 winners, +$54.92 per simulated $1,000 before any forward validation.
It is **not** evidence of future profitability. The 90-day selection was repeatedly optimized and only 9 trades occurred in the final month.

- LONG and SHORT; only entries 16:00-23:59 UTC; 1m closed Binance USD-M candles.
- Quote-volume RVOL >=1.3 vs previous 20 completed 1m candles; TR SMA 14; candle range <=3 ATR; strictly consecutive 20 completed bars.
- LONG: return60 >0.3%, return15 >0, return5 <0.2%, close > previous five highs; strong positive price response, quote-taker delta >0.3, signed flow5 >=0.08, flow15 >=0.03, flow5 >= flow5 prior, flow5 - flow5 lag3 >0.055, close location >0.82.
- SHORT mirrors LONG with return60 <-0.3%, return15 <0, return5 >-0.2%, close < previous five lows, delta <-0.3, flow5 <=-0.08, flow15 <=-0.03, acceleration <-0.055, close location <0.18.
- Entry at current executable bid/ask quote, subject to freshness; 2*ATR stop (0.48%-4% of entry), FULL 2R target, 180 minute time exit, no partials and no trailing.
- Risk target 1% per position, **capped** by existing 4% account daily-loss budget, 10x notional and 15% margin allocation; simultaneous positions capped at 10 AND UI max-trade setting. Existing BTC whipsaw pause, pause button, cooldowns and research logs remain.
- Existing fee=0.04% and assumed slip=0.02% per side are included in paper PnL. Stop-loss can fill worse in fast markets.
- The historical simulator used next-minute open fills and was limited to a fixed 61-symbol universe, whereas this paper implementation quotes live bid/ask and scans its dynamic watchlist; outcomes WILL differ.
- No live market orders are placed by this code. To roll back new entries, revert commit/PR. Do not change or delete active trade history during rollback.
