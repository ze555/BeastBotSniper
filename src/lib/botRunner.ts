import axios from "axios";
import { sniper } from "./sniperEngine.js";
import { getWatchlist } from "./binanceScanner.js";
import { MarketCondition, GlobalContext } from "../types/trading.js";
import { getTimeframes, calculateTakerRatio } from "./timeframeUtils.js";

const BINANCE_FAPI = "https://fapi.binance.com";
let isRunning = false;
let botActive = false; // State to control if hunting is active
let globalContext: GlobalContext = {
  avgAdx: 25,
  avgAtrPerc: 2,
  bullishRatio: 0.5,
  totalVolume24h: 0,
  marketSentiment: "NEUTRAL",
};

// Map to track previous Open Interest per symbol to calculate real-time percentage change
const lastOpenInterestMap = new Map<string, number>();
const baseOpenInterestMap = new Map<
  string,
  { value: number; timestamp: number }
>();

export function getGlobalMarketContext() {
  return globalContext;
}

const systemLogs: { time: number; msg: string; level: string }[] = [];

export function addLog(msg: string, level: string = "info") {
  systemLogs.push({ time: Date.now(), msg, level });
  if (systemLogs.length > 50) systemLogs.shift();
}

export function getSystemLogs() {
  return systemLogs;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function calculateNormalizedRegressionSlope(data: number[]): number {
  if (!data || data.length < 2) return 0;
  const n = data.length;
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += data[i];
    sumXY += i * data[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avgY = sumY / n;
  if (avgY === 0) return 0;
  return (slope / Math.abs(avgY)) * 100; // Returns percentage change per candle
}

export function setBotActive(state: boolean) {
  botActive = state;
  addLog(`Bot ${state ? "STARTED 🔥" : "STOPPED 🛑"}`, state ? "info" : "warn");
  console.log(
    `[BOT RUNNER] Hunting Mode is now: ${botActive ? "ACTIVE 🟢" : "PAUSED 🔴"}`,
  );
}

export function isBotActive(): boolean {
  return botActive;
}

export async function runTradeLoop() {
  setInterval(async () => {
    if (isRunning) return;
    isRunning = true;

    // Heartbeat log every 10 iterations (~30 seconds)
    if ((globalContext as any).loopCount === undefined)
      (globalContext as any).loopCount = 0;
    (globalContext as any).loopCount++;
    if ((globalContext as any).loopCount % 10 === 0) {
      addLog(
        `Bot Heartbeat: Scanning ${getWatchlist().length} symbols...`,
        "info",
      );
    }

    try {
      const activeTrades = sniper.getActiveTrades();
      const settings = sniper.getSettings();

      // 1. GLOBAL PANIC DETECTION & CONTEXT (Every ~60 seconds to save weight)
      let isGlobalPanic = false;
      const lastContextUpdate = (globalContext as any).lastUpdate || 0;
      if (Date.now() - lastContextUpdate > 60000) {
        try {
          const tickersRes = await axios.get(
            `${BINANCE_FAPI}/fapi/v1/ticker/24hr`,
            { timeout: 5000 },
          );
          const tickers = tickersRes.data as any[];
          const sorted = tickers.sort(
            (a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume),
          );
          const top20 = sorted.slice(0, 20);

          const avgChange =
            top20.reduce(
              (acc, t) => acc + parseFloat(t.priceChangePercent),
              0,
            ) / 20;
          const totalVol = tickers.reduce(
            (acc, t) => acc + parseFloat(t.quoteVolume),
            0,
          );
          const bullishCount = top20.filter(
            (t) => parseFloat(t.priceChangePercent) > 0,
          ).length;

          globalContext = {
            avgAdx: 25,
            avgAtrPerc: 1.5,
            bullishRatio: bullishCount / 20,
            totalVolume24h: totalVol,
            marketSentiment:
              avgChange > 2.5
                ? "EXTREME_GREED"
                : avgChange > 0.5
                  ? "GREED"
                  : avgChange > -0.5
                    ? "NEUTRAL"
                    : avgChange > -3
                      ? "FEAR"
                      : "EXTREME_FEAR",
          };
          (globalContext as any).lastUpdate = Date.now();
        } catch (e) {
          addLog(`Global Context Refresh Error: ${e.message}`, "error");
        }
      }

      // Nightmare mode check (Fast path)
      if (
        settings.isNightmareMode &&
        globalContext.marketSentiment === "EXTREME_FEAR"
      ) {
        isGlobalPanic = true;
        addLog(`GENERAL MARKET CAUTION: Extreme Fear detected.`, "warn");
      }

      // ALWAYS manage open trades (TP/SL/Trailing), even if hunting is paused!
      if (activeTrades.length > 0) {
        try {
          let pricesRes;
          try {
            pricesRes = await axios.get(
              `${BINANCE_FAPI}/fapi/v2/ticker/price`,
              { timeout: 10000 },
            );
          } catch (apiError: any) {
            if (apiError.response && apiError.response.status === 418) {
              console.error(
                "[BOT RUNNER] ⚠️ IP BLOCKED BY BINANCE (Error 418). Render proxy or VPN needed.",
              );
              await sleep(60000); // Sleep for 1 minute
            } else {
              console.error(
                "[BOT RUNNER] API Error fetching ticker prices:",
                apiError.message,
              );
            }
            throw apiError;
          }
          const prices = pricesRes.data as any[];
          const pxMap = new Map<string, number>();
          prices.forEach((p) => pxMap.set(p.symbol, parseFloat(p.price)));

          // 🔥 FIXED: Run trade updates in PARALLEL to prevent one trade from blocking the whole loop
          await Promise.all(
            activeTrades.map(async (t) => {
              const currentPx = pxMap.get(t.symbol);
              if (!currentPx) return;

              try {
                let currentOI: number | undefined = undefined;
                let currentVol: number | undefined = undefined;

                // 1. DATA FETCHING (KINETIC & ADAPTIVE) - SELF-HEALING & SEGREGATED
                const tfs = getTimeframes(!!settings.isLongTerm);
                let klines: any[] = [];
                let currentRsi = 50;
                let currentAdx = 25;
                let currentTakerRatio = 1.0;
                let currentFundingRate = 0.0;

                try {
                  // Fetch each endpoint in parallel with individual safe catch handlers to prevent cascading failures
                  const [klinesRes, oiRes, premiumRes] = await Promise.all([
                    axios
                      .get(
                        `${BINANCE_FAPI}/fapi/v1/klines?symbol=${t.symbol}&interval=${tfs.m5}&limit=35`,
                        { timeout: 4000 },
                      )
                      .catch((err) => {
                        console.warn(
                          `[BOT RUNNER] Klines fetch backup needed for ${t.symbol}:`,
                          err.message,
                        );
                        return { data: [] };
                      }),
                    axios
                      .get(
                        `${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${t.symbol}`,
                        { timeout: 3000 },
                      )
                      .catch(() => {
                        return { data: null };
                      }),
                    axios
                      .get(
                        `${BINANCE_FAPI}/fapi/v1/premiumIndex?symbol=${t.symbol}`,
                        { timeout: 3000 },
                      )
                      .catch(() => {
                        return { data: null };
                      }),
                  ]);

                  klines = klinesRes.data;
                  if (klines && klines.length > 1) {
                    const completedK = klines[klines.length - 2];
                    currentTakerRatio = calculateTakerRatio(completedK);
                    currentVol = parseFloat(klines[klines.length - 1][5]); // Still use latest vol for current volume
                  } else if (klines && klines.length > 0) {
                    const lastK = klines[klines.length - 1];
                    currentTakerRatio = calculateTakerRatio(lastK);
                    currentVol = parseFloat(lastK[5]);
                  }

                  if (oiRes && oiRes.data && oiRes.data.openInterest) {
                    currentOI = parseFloat(oiRes.data.openInterest);
                  }

                  if (
                    premiumRes &&
                    premiumRes.data &&
                    premiumRes.data.lastFundingRate
                  ) {
                    currentFundingRate = parseFloat(
                      premiumRes.data.lastFundingRate,
                    );
                  }

                  // Calculate RSI/ADX if klines available
                  let currentAdxRising = false;
                  if (klines && klines.length >= 15) {
                    const calcRSI = (endIdx: number, period: number) => {
                      let gains = 0,
                        losses = 0;
                      for (let i = endIdx - period + 1; i <= endIdx; i++) {
                        const change =
                          parseFloat(klines[i][4]) -
                          parseFloat(klines[i - 1][4]);
                        if (change > 0) gains += change;
                        else losses -= change;
                      }
                      let avgGain = gains / period;
                      let avgLoss = losses / period;
                      return avgLoss === 0
                        ? 100
                        : 100 - 100 / (1 + avgGain / avgLoss);
                    };
                    currentRsi = calcRSI(klines.length - 1, 14);

                    const { RegimeEngine } =
                      await import("./engine/RegimeEngine.js");
                    const completedKlines =
                      klines.length > 2 ? klines.slice(0, -1) : klines;
                    currentAdx = RegimeEngine.calculateADX(completedKlines);
                    const prevAdx = RegimeEngine.calculateADX(
                      completedKlines.slice(0, -1),
                    );
                    currentAdxRising = currentAdx > prevAdx;
                  }

                  // Unified Manage Trades call
                  await sniper.manageTrades(
                    t.symbol,
                    currentPx,
                    currentOI,
                    currentVol,
                    currentTakerRatio,
                    {
                      emaTrend:
                        klines &&
                        klines.length > 0 &&
                        currentPx > parseFloat(klines[klines.length - 1][4])
                          ? "LONG"
                          : "SHORT",
                      rsi: currentRsi,
                      adx: currentAdx,
                      isAdxRising: currentAdxRising,
                      klines: klines,
                      fundingRate: currentFundingRate,
                    },
                  );

                  // 2. SMART & WISE EXIT LOGIC (Reusing fetched data)
                  if (
                    !settings.useGroqAI &&
                    settings.useWiseExit &&
                    klines &&
                    klines.length > 0
                  ) {
                    await sniper.wiseExit(t.symbol, currentPx, klines);
                    if (
                      !sniper
                        .getActiveTrades()
                        .find((at) => at.symbol === t.symbol)
                    )
                      return;
                  }

                  // 🤖 3. GROQ AI EVALUATION (Snapshots every 15s, Groq Evaluation every 60s)
                  if (t.source && t.source.includes("SOVEREIGN")) {
                    // Sovereign manages its own exits entirely
                  } else if (
                    settings.useGroqAI ||
                    (t.source && t.source.includes("TAWLEEFA"))
                  ) {
                    const lastSnapshot = (t as any).lastSnapshot || 0;
                    if (Date.now() - lastSnapshot > 15000) {
                      // 15 seconds
                      const pnlPerc =
                        t.type === "LONG"
                          ? ((currentPx - t.entryPrice) / t.entryPrice) * 100
                          : ((t.entryPrice - currentPx) / t.entryPrice) * 100;
                      // Calculate MFE (Maximum Favorable Excursion)
                      const highestPx = t.highestPrice || currentPx;
                      const mfePerc =
                        t.type === "LONG"
                          ? ((highestPx - t.entryPrice) / t.entryPrice) * 100
                          : ((t.entryPrice - highestPx) / t.entryPrice) * 100;

                      const last20Vols = klines
                        .slice(-20)
                        .map((k: any) => parseFloat(k[5]));
                      const avgVol20 =
                        last20Vols.reduce((a: number, b: number) => a + b, 0) /
                        20;
                      const rvol =
                        avgVol20 > 0
                          ? parseFloat(klines[klines.length - 1][5]) / avgVol20
                          : 1.0;

                      const report = {
                        time: new Date().toISOString(),
                        symbol: t.symbol,
                        type: t.type,
                        entryPrice: t.entryPrice,
                        currentPrice: currentPx,
                        highestPrice: highestPx,
                        pnlPerc: pnlPerc,
                        mfePerc: mfePerc,
                        klinesSummary: klines
                          .slice(-5)
                          .map((k: any) => ({
                            open: k[1],
                            high: k[2],
                            low: k[3],
                            close: k[4],
                            vol: k[5],
                          })),
                        rsi: currentRsi,
                        adx: currentAdx,
                        isAdxRising: currentAdxRising,
                        takerRatio: currentTakerRatio,
                        rvol: rvol,
                        fundingRate: currentFundingRate,
                        openInterest: currentOI,
                      };

                      if (!t.reportHistory) t.reportHistory = [];
                      t.reportHistory.push({
                        ...report,
                        klinesSummary: undefined,
                      }); // store lightweight version for history
                      // Keep history for up to 24 hours of 15s snapshots (~5760 items) max in memory
                      if (t.reportHistory.length > 5760)
                        t.reportHistory.shift();
                      (t as any).lastSnapshot = Date.now();

                      const lastGroqCheck = (t as any).lastGroqCheck || 0;
                      // Ensure this specific trade hasn't been checked in 30 seconds
                      if (Date.now() - lastGroqCheck > 30000) {
                        // Check global rate limit: only ONE trade evaluation every 10 seconds across all trades
                        const nowTime = Date.now();
                        const globalRateLimit =
                          (globalThis as any).__lastGlobalGroqCall || 0;

                        if (nowTime - globalRateLimit > 10000) {
                          // Immediately claim the lock to prevent other async map iterations from entering
                          (globalThis as any).__lastGlobalGroqCall = nowTime;

                          try {
                            const { askGroqDecision } =
                              await import("./groq.js");

                            // Compress history to at most 50 evenly distributed points to represent the full timeline without exceeding token limits
                            let compressedHistory = t.reportHistory;
                            if (compressedHistory.length > 50) {
                              compressedHistory = Array.from(
                                { length: 50 },
                                (_, i) => {
                                  const index = Math.floor(
                                    (i * (t.reportHistory.length - 1)) /
                                      (50 - 1),
                                  );
                                  return t.reportHistory[index];
                                },
                              );
                            }

                            const highs = klines.map((k: any) =>
                              parseFloat(k[2]),
                            );
                            const lows = klines.map((k: any) =>
                              parseFloat(k[3]),
                            );
                            const closes = klines.map((k: any) =>
                              parseFloat(k[4]),
                            );
                            const len = klines.length;

                            const maxHigh =
                              highs.length >= 20
                                ? Math.max(...highs.slice(-20))
                                : Math.max(...highs);
                            const minLow =
                              lows.length >= 20
                                ? Math.min(...lows.slice(-20))
                                : Math.min(...lows);
                            const distanceToSupport =
                              ((currentPx - minLow) / minLow) * 100;
                            const distanceToResistance =
                              ((maxHigh - currentPx) / currentPx) * 100;

                            const isHH =
                              len > 3
                                ? currentPx > highs[len - 2] &&
                                  highs[len - 2] > highs[len - 3]
                                : false;
                            const isLL =
                              len > 3
                                ? currentPx < lows[len - 2] &&
                                  lows[len - 2] < lows[len - 3]
                                : false;
                            const isHL =
                              len > 3
                                ? currentPx > lows[len - 2] &&
                                  lows[len - 2] > lows[len - 3]
                                : false;
                            const isLH =
                              len > 3
                                ? currentPx < highs[len - 2] &&
                                  highs[len - 2] < highs[len - 3]
                                : false;

                            const marketStructure = {
                              higherHigh: isHH,
                              higherLow: isHL,
                              lowerHigh: isLH,
                              lowerLow: isLL,
                              distanceToSupport,
                              distanceToResistance,
                            };

                            const calcLogEma = (period: number) => {
                              if (closes.length < period) return null;
                              return (
                                closes
                                  .slice(-period)
                                  .reduce((a: number, b: number) => a + b, 0) /
                                period
                              );
                            };
                            const sma20 = calcLogEma(20);
                            const sma50 = calcLogEma(50);
                            const sma200 = calcLogEma(200);

                            const ema20_distance = sma20
                              ? ((currentPx - sma20) / sma20) * 100
                              : 0;
                            const ema50_distance = sma50
                              ? ((currentPx - sma50) / sma50) * 100
                              : 0;
                            const ema200_distance = sma200
                              ? ((currentPx - sma200) / sma200) * 100
                              : 0;

                            const cvd_5m = klines
                              .slice(-Math.min(5, len))
                              .reduce(
                                (acc: number, k: any) =>
                                  acc +
                                  (parseFloat(k[9]) -
                                    (parseFloat(k[5]) - parseFloat(k[9]))),
                                0,
                              );
                            const cvd_15m = klines
                              .slice(-Math.min(15, len))
                              .reduce(
                                (acc: number, k: any) =>
                                  acc +
                                  (parseFloat(k[9]) -
                                    (parseFloat(k[5]) - parseFloat(k[9]))),
                                0,
                              );
                            const deltaVolume =
                              len > 0
                                ? parseFloat(klines[len - 1][9]) -
                                  (parseFloat(klines[len - 1][5]) -
                                    parseFloat(klines[len - 1][9]))
                                : 0;

                            const oiHistory = compressedHistory
                              .map((h: any) => h.openInterest)
                              .filter(
                                (x: any) => x !== undefined && x !== null,
                              );

                            let spotCvd15m = 0;
                            let spotCvd5m = 0;
                            let askAbsorption = 0;
                            let bidAbsorption = 0;
                            let longLiquidations = 0;
                            let shortLiquidations = 0;
                            let spotVolumePercent = 50;
                            let futuresVolumePercent = 50;
                            let bidLiquidity = 0;
                            let askLiquidity = 0;
                            let orderBookImbalance = 0;

                            try {
                              const spotKlinesRes = await axios.get(
                                `https://api.binance.com/api/v3/klines?symbol=${t.symbol}&interval=1m&limit=15`,
                                { timeout: 2000 },
                              );
                              spotCvd15m = spotKlinesRes.data.reduce(
                                (acc: number, k: any) =>
                                  acc +
                                  (parseFloat(k[9]) -
                                    (parseFloat(k[5]) - parseFloat(k[9]))),
                                0,
                              );
                              spotCvd5m = spotKlinesRes.data
                                .slice(-5)
                                .reduce(
                                  (acc: number, k: any) =>
                                    acc +
                                    (parseFloat(k[9]) -
                                      (parseFloat(k[5]) - parseFloat(k[9]))),
                                  0,
                                );

                              const spotVol = spotKlinesRes.data.reduce(
                                (acc: number, k: any) => acc + parseFloat(k[5]),
                                0,
                              );
                              const futVol = klines
                                .slice(-15)
                                .reduce(
                                  (acc: number, k: any) =>
                                    acc + parseFloat(k[5]),
                                  0,
                                );
                              const totalVolForRatio = spotVol + futVol;
                              if (totalVolForRatio > 0) {
                                spotVolumePercent =
                                  (spotVol / totalVolForRatio) * 100;
                                futuresVolumePercent =
                                  (futVol / totalVolForRatio) * 100;
                              }

                              const depthRes = await axios.get(
                                `https://fapi.binance.com/fapi/v1/depth?symbol=${t.symbol}&limit=500`,
                                { timeout: 2000 },
                              );
                              const asks = depthRes.data.asks || [];
                              const bids = depthRes.data.bids || [];
                              askAbsorption = asks.reduce(
                                (acc: number, val: any) =>
                                  parseFloat(val[0]) <= currentPx * 1.01
                                    ? acc + parseFloat(val[1])
                                    : acc,
                                0,
                              );
                              bidAbsorption = bids.reduce(
                                (acc: number, val: any) =>
                                  parseFloat(val[0]) >= currentPx * 0.99
                                    ? acc + parseFloat(val[1])
                                    : acc,
                                0,
                              );

                              bidLiquidity = bids.reduce(
                                (acc: number, val: any) =>
                                  parseFloat(val[0]) >= currentPx * 0.95
                                    ? acc + parseFloat(val[1])
                                    : acc,
                                0,
                              );
                              askLiquidity = asks.reduce(
                                (acc: number, val: any) =>
                                  parseFloat(val[0]) <= currentPx * 1.05
                                    ? acc + parseFloat(val[1])
                                    : acc,
                                0,
                              );
                              if (askLiquidity + bidLiquidity > 0) {
                                orderBookImbalance =
                                  ((bidLiquidity - askLiquidity) /
                                    (bidLiquidity + askLiquidity)) *
                                  100;
                              }

                              const forceRes = await axios.get(
                                `https://fapi.binance.com/fapi/v1/allForceOrders?symbol=${t.symbol}&limit=50`,
                                { timeout: 2000 },
                              );
                              const nowTimeForLiqs = Date.now();
                              (forceRes.data || []).forEach((fo: any) => {
                                if (nowTimeForLiqs - fo.time < 15 * 60 * 1000) {
                                  if (fo.side === "BUY")
                                    shortLiquidations += parseFloat(
                                      fo.executedQty,
                                    );
                                  if (fo.side === "SELL")
                                    longLiquidations += parseFloat(
                                      fo.executedQty,
                                    );
                                }
                              });
                            } catch (extraCtxErr) {
                              console.log(
                                "Could not fetch extra true tick data for",
                                t.symbol,
                              );
                            }

                            let fundingRate = 0;
                            let fundingHistory: number[] = [];
                            let topTradersLongShortRatio = 1;
                            let topAccountsLongShortRatio = 1;
                            const higherTimeframes: any = {};

                            try {
                              const fundingRes = await axios.get(
                                `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${t.symbol}&limit=5`,
                                { timeout: 2000 },
                              );
                              fundingHistory = fundingRes.data.map((f: any) =>
                                parseFloat(f.fundingRate),
                              );
                              fundingRate =
                                fundingHistory.length > 0
                                  ? fundingHistory[fundingHistory.length - 1]
                                  : 0;

                              const topTradersRes = await axios.get(
                                `https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${t.symbol}&period=5m&limit=1`,
                                { timeout: 2000 },
                              );
                              const topAccountsRes = await axios.get(
                                `https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${t.symbol}&period=5m&limit=1`,
                                { timeout: 2000 },
                              );
                              topTradersLongShortRatio =
                                topTradersRes.data.length > 0
                                  ? parseFloat(
                                      topTradersRes.data[0].longShortRatio,
                                    )
                                  : 1;
                              topAccountsLongShortRatio =
                                topAccountsRes.data.length > 0
                                  ? parseFloat(
                                      topAccountsRes.data[0].longShortRatio,
                                    )
                                  : 1;

                              const [klines5m, klines15m, klines1h] =
                                await Promise.all([
                                  axios
                                    .get(
                                      `https://fapi.binance.com/fapi/v1/klines?symbol=${t.symbol}&interval=5m&limit=14`,
                                      { timeout: 2000 },
                                    )
                                    .then((res) => res.data),
                                  axios
                                    .get(
                                      `https://fapi.binance.com/fapi/v1/klines?symbol=${t.symbol}&interval=15m&limit=14`,
                                      { timeout: 2000 },
                                    )
                                    .then((res) => res.data),
                                  axios
                                    .get(
                                      `https://fapi.binance.com/fapi/v1/klines?symbol=${t.symbol}&interval=1h&limit=14`,
                                      { timeout: 2000 },
                                    )
                                    .then((res) => res.data),
                                ]);

                              const calcRsi = (klam: any[]) => {
                                let gains = 0,
                                  losses = 0;
                                for (let i = 1; i < klam.length; i++) {
                                  const diff =
                                    parseFloat(klam[i][4]) -
                                    parseFloat(klam[i - 1][4]);
                                  if (diff > 0) gains += diff;
                                  else losses -= diff;
                                }
                                if (losses === 0) return 100;
                                return 100 - 100 / (1 + gains / losses);
                              };
                              higherTimeframes.rsi_5m = calcRsi(klines5m);
                              higherTimeframes.rsi_15m = calcRsi(klines15m);
                              higherTimeframes.rsi_1h = calcRsi(klines1h);
                              higherTimeframes.trend_5m =
                                parseFloat(klines5m[klines5m.length - 1][4]) >
                                parseFloat(klines5m[0][4])
                                  ? "UP"
                                  : "DOWN";
                              higherTimeframes.trend_15m =
                                parseFloat(klines15m[klines15m.length - 1][4]) >
                                parseFloat(klines15m[0][4])
                                  ? "UP"
                                  : "DOWN";
                              higherTimeframes.trend_1h =
                                parseFloat(klines1h[klines1h.length - 1][4]) >
                                parseFloat(klines1h[0][4])
                                  ? "UP"
                                  : "DOWN";
                            } catch (e) {
                              console.log(
                                "Error fetching extra contextual features",
                                e.message,
                              );
                            }

                            const oiSlope =
                              oiHistory.length >= 2
                                ? (oiHistory[oiHistory.length - 1] -
                                    oiHistory[0]) /
                                  Math.max(1, oiHistory.length)
                                : 0;
                            const cvdSlope = cvd_15m / 15;
                            const volumeProfileArr = compressedHistory
                              .map((h: any) => h.klinesSummary?.[0]?.vol)
                              .filter(Boolean);
                            const vArr = volumeProfileArr
                              .map((v: any) => parseFloat(v))
                              .filter((v: number) => !isNaN(v));
                            const volumeSlope =
                              calculateNormalizedRegressionSlope(vArr);

                            let trueRanges = [];
                            for (let i = 1; i < len; i++) {
                              const high = parseFloat(klines[i][2]);
                              const low = parseFloat(klines[i][3]);
                              const prevClose = parseFloat(klines[i - 1][4]);
                              trueRanges.push(
                                Math.max(
                                  high - low,
                                  Math.abs(high - prevClose),
                                  Math.abs(low - prevClose),
                                ),
                              );
                            }
                            const atr =
                              trueRanges.length > 0
                                ? trueRanges
                                    .slice(-14)
                                    .reduce((a, b) => a + b, 0) /
                                  Math.min(14, trueRanges.length)
                                : 0;

                            const barsInTrade = t.reportHistory.length;

                            const entryPx = t.entryPrice;
                            const slPx = t.sl || entryPx * 0.99;
                            const tpPx = t.tp1 || entryPx * 1.01;
                            const riskDist = Math.abs(entryPx - slPx);
                            const rewardDist = Math.abs(tpPx - entryPx);
                            const riskReward =
                              riskDist > 0 ? rewardDist / riskDist : 0;
                            const position = {
                              stopLoss: slPx,
                              takeProfit: tpPx,
                              riskReward,
                            };

                            const numBuckets = 10;
                            const bucketSize = (maxHigh - minLow) / numBuckets;
                            const volumeProfile = new Array(numBuckets).fill(0);
                            for (let i = Math.max(0, len - 20); i < len; i++) {
                              const k = klines[i];
                              const h = parseFloat(k[2]);
                              const l = parseFloat(k[3]);
                              const v = parseFloat(k[5]);
                              const mid = (h + l) / 2;
                              const bucketIndex =
                                bucketSize === 0
                                  ? 0
                                  : Math.floor((mid - minLow) / bucketSize);
                              const index = Math.min(
                                Math.max(bucketIndex, 0),
                                numBuckets - 1,
                              );
                              volumeProfile[index] += v;
                            }
                            const maxVolBucket = volumeProfile.indexOf(
                              Math.max(...volumeProfile),
                            );
                            const vpoc =
                              bucketSize === 0
                                ? currentPx
                                : minLow + (maxVolBucket + 0.5) * bucketSize;

                            const sortedVolumes = [...volumeProfile].sort(
                              (a, b) => b - a,
                            );
                            const vpoHighBucket = volumeProfile.indexOf(
                              sortedVolumes[1] || 0,
                            );
                            const vpoLowBucket = volumeProfile.indexOf(
                              sortedVolumes[sortedVolumes.length - 1] || 0,
                            );

                            const highVolumeNode =
                              bucketSize === 0
                                ? currentPx
                                : minLow + (vpoHighBucket + 0.5) * bucketSize;
                            const lowVolumeNode =
                              bucketSize === 0
                                ? currentPx
                                : minLow + (vpoLowBucket + 0.5) * bucketSize;

                            const priceProfileArr = compressedHistory
                              .map((h: any) => h.currentPrice)
                              .filter(Boolean);
                            const pArr = priceProfileArr
                              .map((p: any) => parseFloat(p))
                              .filter((p: number) => !isNaN(p));
                            const priceSlope =
                              calculateNormalizedRegressionSlope(pArr);
                            const spotCvdSlope = spotCvd15m / 15;

                            const groqPayload = {
                              symbol: t.symbol,
                              positionSide: t.type,
                              entryPrice: t.entryPrice,
                              currentPrice: currentPx,
                              stopLoss: t.sl,
                              takeProfit: t.tp1 || t.entryPrice,
                              roiPercent:
                                ((currentPx - t.entryPrice) / t.entryPrice) *
                                100 *
                                (t.type === "LONG" ? 1 : -1) *
                                t.leverage,
                              unrealizedProfit: t.unrealizedProfit,
                              leverage: t.leverage,
                              marketStructure,
                              rsi_1m: report.rsi,
                              rsi_5m: higherTimeframes.rsi_5m || 50,
                              rsi_15m: higherTimeframes.rsi_15m || 50,
                              adx_1m: report.adx,
                              adx_5m: higherTimeframes.adx_5m || 0,
                              adx_15m: higherTimeframes.adx_15m || 0,
                              ema20_distance,
                              ema50_distance,
                              ema200_distance,
                              cvd_5m,
                              cvd_15m,
                              spotCvd_5m: spotCvd5m || 0,
                              spotCvd_15m: spotCvd15m || 0,
                              deltaVolume,
                              oiCurrent: report.openInterest,
                              oiHistory: oiHistory.slice(-10),
                              takerBuySellRatio: report.takerRatio,
                              fundingRate,
                              longLiquidations,
                              shortLiquidations,
                              bidLiquidity,
                              askLiquidity,
                              orderBookImbalance,
                              bidAbsorption,
                              askAbsorption,
                              topTradersLongShortRatio,
                              topAccountsLongShortRatio,
                              vpoc,
                              highVolumeNode,
                              lowVolumeNode,
                              atr,
                              barsInTrade,
                              btcTrend: globalContext.btcTrend || "UNKNOWN",
                              marketSentiment:
                                globalContext.marketSentiment || "NEUTRAL",
                              slopes: {
                                oiSlope,
                                cvdSlope,
                                spotCvdSlope,
                                volumeSlope,
                                priceSlope,
                              },
                              history: compressedHistory
                                .slice(-15)
                                .map((h: any) => ({
                                  time: h.time,
                                  price: h.currentPrice,
                                  rsi: h.rsi,
                                  oi: h.openInterest,
                                  takerRatio: h.takerRatio,
                                  volume:
                                    h.klinesSummary?.[
                                      h.klinesSummary.length - 1
                                    ]?.vol,
                                  pnl: h.pnlPerc,
                                })),
                            };

                            (t as any).latestEnrichedData = Object.assign(
                              {},
                              groqPayload,
                              {
                                cvdSlope,
                                spotCvdSlope,
                                oiSlope,
                                volumeSlope,
                                priceSlope,
                                spotCvd_5m: spotCvd5m,
                                spotCvd_15m: spotCvd15m,
                                bidAbsorption,
                                askAbsorption,
                                marketStructure,
                              },
                            );

                            if (settings.useGroqAI) {
                              const groqDecision =
                                await askGroqDecision(groqPayload);
                              (t as any).lastGroqCheck = Date.now();

                              addLog(
                                `🤖 تقرير Groq للعملة ${t.symbol}: ${groqDecision.decision} | الثقة: ${groqDecision.confidence}% | السبب: ${groqDecision.reason}`,
                                groqDecision.decision === "EXIT"
                                  ? "warn"
                                  : "info",
                              );

                              // If Groq says EXIT with high confidence, close the trade.
                              if (
                                groqDecision.decision === "EXIT" &&
                                groqDecision.confidence > 75
                              ) {
                                await sniper.forceCloseTrade(
                                  t,
                                  currentPx,
                                  `GROQ_AI_DECISION: ${groqDecision.reason}`,
                                );
                                addLog(
                                  `🛑 قرار حاسم ومطلق لجروك! إغلاق فوري ذكي للعملة ${t.symbol} بناءً على التاريخ والمؤشرات! الثقة: %${groqDecision.confidence}! (السبب: ${groqDecision.reason})`,
                                  "warn",
                                );
                                return; // Trade closed
                              } else if (
                                groqDecision.decision === "UPDATE_SL" &&
                                groqDecision.new_sl
                              ) {
                                t.sl = groqDecision.new_sl;
                                sniper.forceUpdateTrade(t);
                                addLog(
                                  `🛡️ قرار عبقري لجروك! تحديث وقف الخسارة للعملة ${t.symbol} القيمة الجديدة: ${groqDecision.new_sl}. (السبب: ${groqDecision.reason})`,
                                  "success",
                                );
                              } else if (
                                groqDecision.decision === "UPDATE_TP" &&
                                groqDecision.new_tp
                              ) {
                                if (!t.tp1) t.tp1 = groqDecision.new_tp;
                                else t.tp1 = groqDecision.new_tp;
                                sniper.forceUpdateTrade(t);
                                addLog(
                                  `🎯 قرار عبقري لجروك! تحديث هدف الربح للعملة ${t.symbol} القيمة الجديدة: ${groqDecision.new_tp}. (السبب: ${groqDecision.reason})`,
                                  "success",
                                );
                              }
                            }
                          } catch (err: any) {
                            console.error(
                              `[BOT RUNNER] Groq AI Check Failed for ${t.symbol}:`,
                              err.message,
                            );
                            addLog(
                              `⚠️ تحذير: فشل تنفيذ تحليل جروك الذكي للعملة ${t.symbol}: ${err.message}`,
                              "warn",
                            );
                            // Don't fail the whole loop, just skip Groq for now
                          }
                        } // End of global rate limit if
                      }
                    }
                  }

                  if (settings.useSmartExit) {
                    // The Adaptive Flow in SniperEngine now handles the core exit validation,
                    // but we keep the specific SmartExit reversal logic if enabled.
                    // (Detailed logic for SmartExit was here, can be re-added or kept simplified)
                  }
                } catch (e) {
                  // Fallback if full data fetch fails
                  await sniper.manageTrades(
                    t.symbol,
                    currentPx,
                    undefined,
                    undefined,
                    undefined,
                    {
                      emaTrend: currentPx > t.entryPrice ? "LONG" : "SHORT",
                    },
                  );
                }
              } catch (e: any) {
                console.error(
                  `[BOT RUNNER] Error updating trade for ${t.symbol}:`,
                  e.message,
                );
              }
            }),
          );
        } catch (e: any) {
          if (
            e.response &&
            (e.response.status === 429 || e.response.status === 418)
          ) {
            console.log(
              `[BOT RUNNER] ⚠️ Rate limit hit. Pausing Monitoring...`,
            );
            await sleep(10000);
          }
        }
      }

      // ONLY hunt for new targets if bot is active and no panic detected
      if (!botActive || (isGlobalPanic && !settings.beastMode)) {
        if (isGlobalPanic)
          console.log(`[BOT] 🛡️ Entry blocked due to Market Panic.`);
        isRunning = false;
        return;
      }

      const watchlist = getWatchlist();
      const maxTrades = sniper.getSettings().maxConcurrentTrades;
      const isStrict = sniper.getSettings().strictMode;
      const isBeastMode = sniper.getSettings().beastMode;

      // Check BTC trend for strict mode (Filter 3: BTC Trend Filter)
      let btcTrend = "FLAT";
      if (isStrict && botActive) {
        try {
          const btcRes = await axios.get(
            `${BINANCE_FAPI}/fapi/v1/ticker/24hr?symbol=BTCUSDT`,
            { timeout: 3000 },
          );
          btcTrend =
            parseFloat(btcRes.data.priceChangePercent) >= 0 ? "LONG" : "SHORT";
        } catch (e) {}
      }

      // 3. Scan for Entry Conditions (Only let max X trades run concurrently for safety)
      if (activeTrades.length < maxTrades && watchlist.length > 0) {
        // Optimized Scanning: Lower count and add spacing to prevent 429
        const scanCount = 15;
        const targetsToCheck = [...watchlist]
          .sort(() => 0.5 - Math.random())
          .slice(0, scanCount);

        let rejectedCount = 0;
        let signalFoundInThisLoop = false;
        let rejectionReasons: Record<string, number> = {};

        // Select and run active entry engine
        try {
          const { QuantumEngine } = await import("./engine/QuantumEngine.js");
          const { CreativeEntryEngine } =
            await import("./engine/CreativeEntryEngine.js");
          const { SteelEngine } = await import("./engine/SteelEngine.js");
          const quantum = new QuantumEngine();
          const creativeEngine = new CreativeEntryEngine();
          const steelEngine = new SteelEngine();

          for (const coin of targetsToCheck) {
            // If we found a signal and filled our slots, stop scanning
            if (sniper.getActiveTrades().length >= maxTrades) break;
            if (activeTrades.find((t) => t.symbol === coin.symbol)) continue;

            // 🛑 RATE LIMIT PROTECTION: Add a small gap between scanning new symbols
            // This doesn't affect active trade updates which run in parallel above
            await sleep(200);

            const tfs = getTimeframes(!!settings.isLongTerm);
            try {
              // Try to get klines first
              const klinesRes = await axios.get(
                `${BINANCE_FAPI}/fapi/v1/klines?symbol=${coin.symbol}&interval=${tfs.m1}&limit=210`,
                { timeout: 4000 },
              );
              const klines = klinesRes.data;

              // Calculate smoothed Taker Ratio from the last 15 completed candles
              let takerRatio = 1.0;
              if (klines && klines.length > 2) {
                const maxLookback = Math.min(15, klines.length - 1);
                const recentKlines = klines.slice(
                  klines.length - 1 - maxLookback,
                  klines.length - 1,
                );
                takerRatio = calculateTakerRatio(recentKlines);
              } else if (klines && klines.length > 0) {
                takerRatio = calculateTakerRatio(
                  klines.slice(0, klines.length - 1),
                );
              }

              // --- 🦁 BEAST AUDITOR LIVE METRICS CALCULATION ---
              const currentPx = parseFloat(klines[klines.length - 1][4]);
              // Use only completed candles for robust technical indicator calculations
              const completedKlines =
                klines && klines.length > 2 ? klines.slice(0, -1) : klines;

              let currentEma50 = currentPx;
              if (completedKlines && completedKlines.length >= 50) {
                const period = 50;
                const k = 2 / (period + 1);
                let sum = 0;
                for (let i = 0; i < period; i++) {
                  sum += parseFloat(completedKlines[i][4]);
                }
                currentEma50 = sum / period;
                for (let i = period; i < completedKlines.length; i++) {
                  currentEma50 =
                    (parseFloat(completedKlines[i][4]) - currentEma50) * k +
                    currentEma50;
                }
              }

              const { RegimeEngine } = await import("./engine/RegimeEngine.js");
              const adxCurrent = RegimeEngine.calculateADX(completedKlines);
              const adxPrev = RegimeEngine.calculateADX(
                completedKlines.slice(0, -1),
              );
              const isAdxRising = adxCurrent > adxPrev;

              let currentRsi = 50;
              if (completedKlines && completedKlines.length >= 14) {
                const calcRSI = (endIdx: number, period: number = 14) => {
                  if (completedKlines.length < period + 1) return 50;
                  let gains = 0,
                    losses = 0;
                  for (let i = endIdx - period + 1; i <= endIdx; i++) {
                    const change =
                      parseFloat(completedKlines[i][4]) -
                      parseFloat(completedKlines[i - 1][4]);
                    if (change > 0) gains += change;
                    else losses -= change;
                  }
                  let avgGain = gains / period;
                  let avgLoss = losses / period;
                  return avgLoss === 0
                    ? 100
                    : 100 - 100 / (1 + avgGain / avgLoss);
                };
                currentRsi = calcRSI(completedKlines.length - 1, 14);
              }

              let liveRvol = coin.rvol || 1.0;
              if (completedKlines && completedKlines.length >= 20) {
                let sumVol = 0;
                for (let i = 0; i < completedKlines.length - 1; i++) {
                  sumVol += parseFloat(completedKlines[i][5]);
                }
                const avgVol = sumVol / (completedKlines.length - 1);
                const lastCompletedVol = parseFloat(
                  completedKlines[completedKlines.length - 1][5],
                );
                if (avgVol > 0) {
                  liveRvol = lastCompletedVol / avgVol;
                }
              }

              const now = Date.now();
              let currentOI = 0;
              let oiChangeVal = 0;
              try {
                const { default: axios } = await import("axios");
                const oiRes = await axios.get(
                  `${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${coin.symbol}`,
                  { timeout: 3000 },
                );
                if (oiRes.data && oiRes.data.openInterest) {
                  currentOI = parseFloat(oiRes.data.openInterest);

                  let baseOI = baseOpenInterestMap.get(coin.symbol);
                  // Refetch history only if not set or extremely old (older than 4 hours)
                  if (!baseOI || now - baseOI.timestamp > 4 * 60 * 60 * 1000) {
                    try {
                      // Get OI from 1 hour ago for baseline change
                      const oiHistRes = await axios.get(
                        `${BINANCE_FAPI}/futures/data/openInterestHist?symbol=${coin.symbol}&period=15m&limit=5`,
                        { timeout: 3000 },
                      );
                      if (
                        Array.isArray(oiHistRes.data) &&
                        oiHistRes.data.length > 0
                      ) {
                        const pastOI = parseFloat(
                          oiHistRes.data[0].sumOpenInterest,
                        );
                        baseOpenInterestMap.set(coin.symbol, {
                          value: pastOI,
                          timestamp: now,
                        });
                        baseOI = { value: pastOI, timestamp: now };
                      } else {
                        baseOpenInterestMap.set(coin.symbol, {
                          value: currentOI,
                          timestamp: now,
                        });
                        baseOI = { value: currentOI, timestamp: now };
                      }
                    } catch (error) {
                      baseOpenInterestMap.set(coin.symbol, {
                        value: currentOI,
                        timestamp: now,
                      });
                      baseOI = { value: currentOI, timestamp: now };
                    }
                  }

                  oiChangeVal =
                    baseOI.value > 0
                      ? ((currentOI - baseOI.value) / baseOI.value) * 100
                      : 0;
                }
              } catch (e) {}

              // Save live beast auditor metrics for UI
              (coin as any).beastMetrics = {
                rvol: liveRvol,
                takerRatio: takerRatio,
                oi: currentOI,
                oiChange: oiChangeVal,
                adx: adxCurrent,
                adxPrev: adxPrev,
                ema50: currentEma50,
                isAdxRising: isAdxRising,
                lastUpdated: Date.now(),
              };

              if (settings.useBeastAuditorEngine) {
                const liveRvolVal =
                  (coin as any).beastMetrics?.rvol ?? coin.rvol ?? 1.0;
                let isLongMatch =
                  liveRvolVal >= 1.15 &&
                  takerRatio >= 1.05 &&
                  Math.abs(oiChangeVal) >= 0.5 &&
                  adxCurrent >= 20 &&
                  isAdxRising;
                let isShortMatch =
                  liveRvolVal >= 1.15 &&
                  takerRatio <= 0.95 &&
                  Math.abs(oiChangeVal) >= 0.5 &&
                  adxCurrent >= 20 &&
                  isAdxRising;

                if (isStrict && btcTrend !== "FLAT") {
                  if (btcTrend !== "LONG") isLongMatch = false;
                  if (btcTrend !== "SHORT") isShortMatch = false;
                }

                (coin as any).decision = {
                  regime: "ANY",
                  bias: isLongMatch
                    ? "LONG"
                    : isShortMatch
                      ? "SHORT"
                      : "NEUTRAL",
                  trap: "NONE",
                  confidence: isLongMatch || isShortMatch ? 1.0 : 0.0,
                  action: isLongMatch || isShortMatch ? "ATTACK" : "WAIT",
                  reason: isLongMatch
                    ? "LONG_BEAST_AUDITOR_MATCH"
                    : isShortMatch
                      ? "SHORT_BEAST_AUDITOR_MATCH"
                      : "BEAST_WAITING_FOR_TRIGGER",
                };

                if (isLongMatch || isShortMatch) {
                  signalFoundInThisLoop = true;
                  const biasType = isLongMatch ? "LONG" : "SHORT";

                  const slPerc =
                    (settings.quantumSlScale ?? 1.0) *
                    (settings.strictMaxRisk || 1.5);
                  const tpPerc = (settings.quantumTpScale ?? 1.5) * 2.33; // Scales default 3.5% with TpScale
                  const slDistance = (slPerc / 100) * currentPx;
                  const support = currentPx - slDistance;
                  const resistance = currentPx + slDistance;

                  const condition: MarketCondition = {
                    symbol: coin.symbol,
                    price: currentPx,
                    type: biasType,
                    score: 5,
                    isRanging: false,
                    isBreakout: true,
                    isRetestOrHold: false,
                    isLiquidityGood: true,
                    isMomentumHigh: true,
                    isOrderBookClear: true,
                    support: biasType === "LONG" ? support : 0,
                    resistance: biasType === "SHORT" ? resistance : 0,
                    takerBuySellRatio: takerRatio,
                    atr: 0,
                    slopes: {
                      oiSlope: 0,
                      cvdSlope: takerRatio - 1.0,
                      spotCvdSlope: takerRatio - 1.0,
                      volumeSlope: calculateNormalizedRegressionSlope(
                        klines
                          .map((k: any) => parseFloat(k[5]))
                          .filter((n: number) => !isNaN(n)),
                      ),
                      priceSlope: calculateNormalizedRegressionSlope(
                        klines
                          .map((k: any) => parseFloat(k[4]))
                          .filter((n: number) => !isNaN(n)),
                      ),
                      deltaVolume: 0,
                      bidAbsorption: takerRatio > 1.2 ? 1 : 0,
                      askAbsorption: takerRatio < 0.8 ? 1 : 0,
                      hhHl: 0,
                      lhLl: 0,
                    },
                  };

                  addLog(
                    `⚡ مدقق الوحش TRIGGERED: ${biasType} ${coin.symbol} (مستوفي 5 شروط بنسبة 100%)`,
                    "success",
                  );
                  await sniper.executeQuantumTrade(
                    condition,
                    `BEAST_AUDITOR_${biasType}`,
                    tpPerc,
                    slPerc,
                  );
                } else {
                  rejectedCount++;
                  const label = "Beast No Signal";
                  rejectionReasons[label] = (rejectionReasons[label] || 0) + 1;
                }

                // We do not 'continue' here so that if useTawleefaEngine is also on, it can populate the Live Diagnostics UI.
              }

              if (settings.useTawleefaEngine) {
                const currentPx = parseFloat(klines[klines.length - 1][4]);

                const condition: MarketCondition = {
                  symbol: coin.symbol,
                  price: currentPx,
                  type: "LONG", // will be evaluated and updated by evaluateSignal
                  rvol: coin.rvol,
                  oiChange24h: 0,
                  score: coin.score,
                  isRanging: coin.trend === "FLAT",
                  isBreakout: coin.trend !== "FLAT",
                  isRetestOrHold: false,
                  isLiquidityGood: true,
                  isMomentumHigh: coin.rvol >= 1.5,
                  isOrderBookClear: true,
                  support: 0,
                  resistance: 0,
                  takerBuySellRatio: takerRatio,
                  atr: 0,
                  vol24h: coin.volume,
                  spread: coin.spread,
                  oi: undefined,
                  fundingRate: parseFloat((coin as any).fundingRate || 0),
                  adx: adxCurrent,
                  rsi: currentRsi,
                  ema50: currentEma50,
                  isAdxRising: isAdxRising,
                  slopes: {
                    oiSlope: 0,
                    cvdSlope: takerRatio - 1.0,
                    spotCvdSlope: takerRatio - 1.0,
                    volumeSlope: calculateNormalizedRegressionSlope(
                      klines
                        .map((k: any) => parseFloat(k[5]))
                        .filter((n: number) => !isNaN(n)),
                    ),
                    priceSlope: calculateNormalizedRegressionSlope(
                      klines
                        .map((k: any) => parseFloat(k[4]))
                        .filter((n: number) => !isNaN(n)),
                    ),
                    deltaVolume: 0,
                    bidAbsorption: takerRatio > 1.2 ? 1 : 0,
                    askAbsorption: takerRatio < 0.8 ? 1 : 0,
                    hhHl: 0,
                    lhLl: 0,
                  },
                };

                try {
                  const oiRes = await axios.get(
                    `${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${coin.symbol}`,
                    { timeout: 3000 },
                  );
                  if (oiRes.data && oiRes.data.openInterest) {
                    const currentOI = parseFloat(oiRes.data.openInterest);
                    condition.oi = currentOI;
                    const now = Date.now();
                    let baseOI = baseOpenInterestMap.get(coin.symbol);
                    if (
                      !baseOI ||
                      now - baseOI.timestamp > 4 * 60 * 60 * 1000
                    ) {
                      try {
                        const oiHistRes = await axios.get(
                          `${BINANCE_FAPI}/futures/data/openInterestHist?symbol=${coin.symbol}&period=1d&limit=2`,
                          { timeout: 3000 },
                        );
                        if (
                          Array.isArray(oiHistRes.data) &&
                          oiHistRes.data.length > 0
                        ) {
                          const pastOI = parseFloat(
                            oiHistRes.data[0].sumOpenInterest,
                          );
                          baseOpenInterestMap.set(coin.symbol, {
                            value: pastOI,
                            timestamp: now,
                          });
                          baseOI = { value: pastOI, timestamp: now };
                        }
                      } catch (e) {}
                    }
                    if (!baseOI) {
                      baseOpenInterestMap.set(coin.symbol, {
                        value: currentOI,
                        timestamp: now,
                      });
                      baseOI = { value: currentOI, timestamp: now };
                    }
                    if (baseOI && baseOI.value > 0) {
                      condition.oiChange24h =
                        ((currentOI - baseOI.value) / baseOI.value) * 100;
                    }
                    lastOpenInterestMap.set(coin.symbol, currentOI);
                  }
                } catch (e) {
                  // Ignore
                }

                await sniper.evaluateSignal(
                  condition,
                  klines,
                  klines,
                  globalContext,
                );

                // Save the full Tawleefa engine decision & live diagnostics onto the coin
                (coin as any).decision = condition.decision;

                if (sniper.getActiveTrades().has(coin.symbol)) {
                  signalFoundInThisLoop = true;
                } else {
                  rejectedCount++;
                  const label = "Tawleefa No Signal";
                  rejectionReasons[label] = (rejectionReasons[label] || 0) + 1;
                }
                continue;
              }

              if (settings.useSovereignEngine) {
                const currentPx = parseFloat(klines[klines.length - 1][4]);
                const condition: MarketCondition = {
                  symbol: coin.symbol,
                  price: currentPx,
                  type: "LONG",
                  rvol: coin.rvol,
                  oiChange24h: 0,
                  score: coin.score,
                  isRanging: false,
                  isBreakout: false,
                  isRetestOrHold: false,
                  isLiquidityGood: true,
                  isMomentumHigh: false,
                  isOrderBookClear: true,
                  support: 0,
                  resistance: 0,
                  takerBuySellRatio: takerRatio,
                  atr: 0,
                  vol24h: coin.volume,
                  spread: coin.spread,
                  oi: undefined,
                  fundingRate: parseFloat((coin as any).fundingRate || 0),
                  adx: adxCurrent,
                  rsi: currentRsi,
                  ema50: currentEma50,
                  isAdxRising: isAdxRising,
                  slopes: {
                    oiSlope: 0,
                    cvdSlope: takerRatio - 1.0,
                    spotCvdSlope: takerRatio - 1.0,
                    volumeSlope: 0,
                    priceSlope: 0,
                    deltaVolume: 0,
                    bidAbsorption: 0,
                    askAbsorption: 0,
                    hhHl: 0,
                    lhLl: 0,
                  },
                };
                await sniper.evaluateSignal(
                  condition,
                  klines,
                  klines,
                  globalContext,
                );
                if (sniper.getActiveTrades().has(coin.symbol))
                  signalFoundInThisLoop = true;
                continue;
              }

              const decision = settings.useSteelEngine
                ? steelEngine.analyze(
                    klines,
                    takerRatio,
                    sniper.getSettings(),
                    parseFloat((coin as any).fundingRate || 0),
                  )
                : settings.useCreativeEngine
                  ? creativeEngine.analyze(
                      klines,
                      takerRatio,
                      sniper.getSettings(),
                    )
                  : quantum.analyze(klines, takerRatio, sniper.getSettings());

              // Filter against BTC trend in Strict Mode
              if (isStrict && btcTrend !== "FLAT" && decision.shouldEnter) {
                if (decision.type !== btcTrend) {
                  decision.shouldEnter = false;
                  decision.reason = "REJECTED_BY_BTC_TREND";
                }
              }

              // Saveconventional engine decision in the coin
              (coin as any).decision = {
                regime:
                  coin.trend === "FLAT" ? "COMPRESSION" : "TREND_EXPANSION",
                bias: decision.type,
                trap: "NONE",
                confidence: (decision.confidence ?? 60) / 100,
                action: decision.shouldEnter ? "ATTACK" : "WAIT",
                reason:
                  decision.reason ||
                  (settings.useSteelEngine
                    ? "STEEL_NO_EDGE"
                    : settings.useCreativeEngine
                      ? "CREATIVE_NO_EDGE"
                      : "QUANTUM_NO_EDGE"),
              };

              if (decision.shouldEnter) {
                signalFoundInThisLoop = true;
                const currentPx = parseFloat(klines[klines.length - 1][4]);

                const slDistance = (decision.stopLossPerc / 100) * currentPx;
                const tpDistance = (decision.takeProfitPerc / 100) * currentPx;

                const support = currentPx - slDistance;
                const resistance = currentPx + slDistance;

                const condition: MarketCondition = {
                  symbol: coin.symbol,
                  price: currentPx,
                  type: decision.type,
                  score: 5,
                  isRanging: false,
                  isBreakout: true,
                  isRetestOrHold: false,
                  isLiquidityGood: true,
                  isMomentumHigh: true,
                  isOrderBookClear: true,
                  support: decision.type === "LONG" ? support : 0,
                  resistance: decision.type === "SHORT" ? resistance : 0,
                  takerBuySellRatio: takerRatio,
                  atr: 0,
                  slopes: {
                    oiSlope: 0,
                    cvdSlope: takerRatio - 1.0,
                    spotCvdSlope: takerRatio - 1.0,
                    volumeSlope: calculateNormalizedRegressionSlope(
                      klines
                        .map((k: any) => parseFloat(k[5]))
                        .filter((n: number) => !isNaN(n)),
                    ),
                    priceSlope: calculateNormalizedRegressionSlope(
                      klines
                        .map((k: any) => parseFloat(k[4]))
                        .filter((n: number) => !isNaN(n)),
                    ),
                    deltaVolume: 0,
                    bidAbsorption: takerRatio > 1.2 ? 1 : 0,
                    askAbsorption: takerRatio < 0.8 ? 1 : 0,
                    hhHl: 0,
                    lhLl: 0,
                  },
                };

                let proceedWithTrade = true;

                if (settings.useGroqAI) {
                  try {
                    const { askGroqDecision } = await import("./groq.js");
                    const report = {
                      symbol: coin.symbol,
                      proposedAction: decision.type,
                      currentPrice: currentPx,
                      klinesSummary: klines
                        .slice(-5)
                        .map((k: any) => ({
                          open: k[1],
                          high: k[2],
                          low: k[3],
                          close: k[4],
                          vol: k[5],
                        })),
                      takerRatio: takerRatio,
                      engineReason: decision.reason,
                    };
                    const groqDecision = await askGroqDecision({
                      phase: "ENTRY_CHECK",
                      data: report,
                    });

                    if (groqDecision.decision === "EXIT") {
                      proceedWithTrade = false;
                      addLog(
                        `🤖 Groq رفض صفقة ${decision.type} للعملة ${coin.symbol} (الثقة: ${groqDecision.confidence}% - ${groqDecision.reason})`,
                        "warn",
                      );
                    } else {
                      addLog(
                        `🤖 Groq وافق على الدخول للعملة ${coin.symbol} بنسبة ثقة ${groqDecision.confidence}%`,
                        "info",
                      );
                    }
                  } catch (e: any) {
                    console.log(
                      "[BOT RUNNER] Groq Entry Check Failed:",
                      e.message,
                    );
                    addLog(
                      `⚠️ تحذير: فشل فحص جروك للدخول للعملة ${coin.symbol}: ${e.message}`,
                      "warn",
                    );
                  }
                }

                if (proceedWithTrade) {
                  if (settings.useSteelEngine) {
                    addLog(
                      `⚡ الفولاذي TRIGGERED: ${decision.type} ${coin.symbol} (الاحتمالية: ${decision.confidence.toFixed(0)}%)`,
                      "success",
                    );
                    if ((decision as any).marketNarrative) {
                      addLog(
                        `💬 سياق الصفقة الفولاذية: ${(decision as any).marketNarrative}`,
                        "info",
                      );
                    }
                  } else if (settings.useCreativeEngine) {
                    addLog(
                      `🎨 الابداعي TRIGGERED: ${decision.type} ${coin.symbol} (${decision.reason})`,
                      "success",
                    );
                    if ((decision as any).marketNarrative) {
                      addLog(
                        `💬 سياق الصفقة: ${(decision as any).marketNarrative}`,
                        "info",
                      );
                    }
                  } else {
                    addLog(
                      `🚀 ENTRY TRIGGERED: ${decision.type} ${coin.symbol} (${decision.reason})`,
                      "success",
                    );
                  }
                  await sniper.executeQuantumTrade(
                    condition,
                    settings.useSteelEngine
                      ? `STEEL_${decision.reason}`
                      : settings.useCreativeEngine
                        ? `CREATIVE_${decision.reason}`
                        : `QUANTUM_${decision.reason}`,
                    decision.takeProfitPerc,
                    decision.stopLossPerc,
                  );
                }
              } else {
                rejectedCount++;
                const label = settings.useSteelEngine
                  ? "Steel No Signal"
                  : settings.useCreativeEngine
                    ? "Creative No Signal"
                    : "Quantum No Signal";
                rejectionReasons[label] = (rejectionReasons[label] || 0) + 1;
              }
            } catch (e: any) {
              if (
                e.response &&
                (e.response.status === 429 || e.response.status === 418)
              ) {
                console.log(`[BOT RUNNER] ⚠️ Rate limit hit. Pausing Loop...`);
                await sleep(10000);
              }
            }
          }
        } catch (e) {
          console.error("Error loading Quantum Engine", e);
        }

        // Summary log if no signals found
        if (
          !signalFoundInThisLoop &&
          (globalContext as any).loopCount % 5 === 0
        ) {
          if (settings.useSovereignEngine) {
            addLog(
              `👑 المحرك الشامل يعمل ويراقب ${targetsToCheck.length} عملات... لم يتم رصد إشارات دخول قوية حتى الآن لصرامة شروطه.`,
              "info",
            );
          } else {
            addLog(
              `Scanning... ${targetsToCheck.length} coins evaluated. No valid scalp patterns yet.`,
              "info",
            );
          }
        }
      } else if (botActive && watchlist.length === 0) {
        if ((globalContext as any).loopCount % 5 === 0) {
          addLog(
            `DIAGNOSTIC: Golden Watchlist is currently EMPTY. Market is too quiet.`,
            "info",
          );
        }
      }
    } catch (e) {
      console.error("[BOT RUNNER] Loop Error:", e);
    } finally {
      isRunning = false;
    }
  }, 3000); // Poll every 3s for tracking active trades and scanning targets
}
