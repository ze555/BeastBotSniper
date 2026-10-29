import fs from "node:fs";
import { evaluateExitEvidence } from "./exitEvidenceEngine.js";

interface Trade {
  trade_id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  timestamp_entry: string;
  timestamp_exit: string;
  entry_price: number;
  exit_price: number;
  stop_loss: number;
  pnl_r: number;
}
interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuyBase: number;
}

const trades = JSON.parse(fs.readFileSync("study_all_trades_master.json", "utf8")) as Trade[];
const candleStreams = JSON.parse(fs.readFileSync("master_candles_1m.json", "utf8")) as Record<string, Candle[]>;

function sumFlow(candles: Candle[]) {
  const volume = candles.reduce((sum, c) => sum + (Number(c.volume) || 0), 0);
  const buy = candles.reduce((sum, c) => sum + (Number(c.takerBuyBase) || 0), 0);
  return { volume, buy, cvdProxy: 2 * buy - volume, takerRatio: volume > 0 ? buy / volume : 0.5 };
}
function ema(values: number[], period: number) {
  const k = 2 / (period + 1);
  return values.reduce((current, value, index) => index === 0 ? value : value * k + current * (1 - k), values[0] || 0);
}

let covered = 0;
let triggered = 0;
let triggeredWinners = 0;
let baselineCoveredR = 0;
let hypotheticalTriggerR = 0;
let deltaR = 0;
let oiUnavailableAtTrigger = 0;
const triggerSamples: Array<{trade_id:string; side:string; triggerR:number; recordedR:number; reason:string}> = [];

for (const trade of trades) {
  const candles = candleStreams[trade.trade_id];
  if (!Array.isArray(candles) || candles.length < 20) continue;
  covered++;
  baselineCoveredR += Number(trade.pnl_r) || 0;

  const entryTime = Date.parse(trade.timestamp_entry);
  const exitTime = Date.parse(trade.timestamp_exit);
  const risk = Math.abs(trade.entry_price - trade.stop_loss);
  if (!Number.isFinite(entryTime) || !Number.isFinite(exitTime) || risk <= 0) continue;
  const timeline = candles.filter(c => c.time <= exitTime).sort((a,b) => a.time-b.time);

  for (let i = 5; i < timeline.length; i++) {
    const candle = timeline[i];
    if (candle.time < entryTime) continue;
    const closes = timeline.slice(Math.max(0, i-20), i+1).map(c => c.close);
    const ema21 = ema(closes, 21);
    const last5 = timeline.slice(Math.max(0, i-4), i+1);
    const last15 = timeline.slice(Math.max(0, i-14), i+1);
    const flow5 = sumFlow(last5);
    const flow15 = sumFlow(last15);
    const last3 = timeline.slice(Math.max(0, i-2), i+1);
    const structureBroken = last3.length === 3 && last3.every(c =>
      trade.side === "LONG" ? c.close < ema21 : c.close > ema21
    );
    const priceChangePct = last15.length >= 15
      ? (candle.close - last15[0].open) / (last15[0].open || 1)
      : 0;
    const cvd5 = flow5.cvdProxy;
    const cvd15 = flow15.cvdProxy;
    const hiddenFlowAgainst = trade.side === "LONG"
      ? cvd15 > 0 && cvd5 < 0
      : cvd15 < 0 && cvd5 > 0;
    const decision = evaluateExitEvidence({
      direction: trade.side,
      priceChangePct,
      oiChangePct: Number.NaN,
      oiAvailable: false,
      cvd5,
      cvd15,
      cvd4h: Number.NaN,
      takerRatio: flow15.takerRatio,
      structureBroken,
      hiddenFlowAgainst,
      opposingRegime: false
    });
    if (decision.action === "EXIT") {
      const triggerR = trade.side === "LONG"
        ? (candle.close - trade.entry_price) / risk
        : (trade.entry_price - candle.close) / risk;
      triggered++;
      if ((Number(trade.pnl_r) || 0) > 0) triggeredWinners++;
      hypotheticalTriggerR += triggerR;
      deltaR += triggerR - (Number(trade.pnl_r) || 0);
      if (!decision.dataQuality.oiAvailable) oiUnavailableAtTrigger++;
      triggerSamples.push({
        trade_id: trade.trade_id,
        side: trade.side,
        triggerR: Number(triggerR.toFixed(3)),
        recordedR: Number((Number(trade.pnl_r) || 0).toFixed(3)),
        reason: decision.reasons.join(" | ")
      });
      break;
    }
  }
}

console.log("=== Historical exit-evidence replay (diagnostic proxy, NOT full production backtest) ===");
console.log(JSON.stringify({
  datasetTrades: trades.length,
  candleCoveredTrades: covered,
  coveragePct: Number((covered / trades.length * 100).toFixed(1)),
  recordedNetRForCoveredTrades: Number(baselineCoveredR.toFixed(3)),
  crossConfirmedExitTriggers: triggered,
  triggersOnTradesWithPositiveRecordedPnl: triggeredWinners,
  hypotheticalTriggerRTotal: Number(hypotheticalTriggerR.toFixed(3)),
  triggerMinusRecordedPnlR: Number(deltaR.toFixed(3)),
  triggersWithoutHistoricalOi: oiUnavailableAtTrigger,
  limitations: [
    "Only trades with a per-trade 1m candle stream are included.",
    "Historical files do not include OI, so OI is explicitly unavailable.",
    "4h CVD and live 15m EMA21 are not reconstructable from these short 1m streams; this replay uses 1m structure and 5m/15m taker-flow proxies.",
    "Recorded final PnL includes the original strategy's partial exits/fees; trigger R is a full-exit close-price proxy and is not directly equivalent."
  ],
  sampleTriggers: triggerSamples.slice(0, 10)
}, null, 2));
