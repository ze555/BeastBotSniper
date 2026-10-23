const fs = require('fs');

const master = JSON.parse(fs.readFileSync('study_all_trades_master.json'));
const candles = JSON.parse(fs.readFileSync('study_master_candles_1m.json'));

// Indicator calculation helpers
function calcEMA_stream(series, period) {
  const k = 2 / (period + 1);
  let ema = series[0];
  const res = [ema];
  for (let i = 1; i < series.length; i++) {
    ema = (series[i] * k) + (ema * (1 - k));
    res.push(ema);
  }
  return res;
}

function calcATR_stream(highs, lows, closes, period) {
  const trs = [highs[0] - lows[0]];
  for (let i = 1; i < highs.length; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i-1]);
    const lc = Math.abs(lows[i] - closes[i-1]);
    trs.push(Math.max(hl, hc, lc));
  }
  let atr = trs.slice(0, Math.min(period, trs.length)).reduce((a,b)=>a+b, 0) / Math.min(period, trs.length);
  const res = [];
  for (let i = 0; i < trs.length; i++) {
    if (i < period) res.push(atr);
    else {
      atr = (atr * (period - 1) + trs[i]) / period;
      res.push(atr);
    }
  }
  return res;
}

function calcADX_stream(highs, lows, closes, period) {
  const trs = [highs[0] - lows[0]];
  const plusDMs = [0];
  const minusDMs = [0];
  for (let i = 1; i < highs.length; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i-1]);
    const lc = Math.abs(lows[i] - closes[i-1]);
    trs.push(Math.max(hl, hc, lc));

    const up = highs[i] - highs[i-1];
    const down = lows[i-1] - lows[i];
    plusDMs.push(up > down && up > 0 ? up : 0);
    minusDMs.push(down > up && down > 0 ? down : 0);
  }

  let smTR = trs.slice(0, Math.min(period, trs.length)).reduce((a,b)=>a+b,0) / Math.min(period, trs.length);
  let smPDM = plusDMs.slice(0, Math.min(period, plusDMs.length)).reduce((a,b)=>a+b,0) / Math.min(period, plusDMs.length);
  let smMDM = minusDMs.slice(0, Math.min(period, minusDMs.length)).reduce((a,b)=>a+b,0) / Math.min(period, minusDMs.length);

  const adxList = [];
  const dxList = [];

  for (let i = 0; i < trs.length; i++) {
    if (i >= period) {
      smTR = (smTR * (period - 1) + trs[i]) / period;
      smPDM = (smPDM * (period - 1) + plusDMs[i]) / period;
      smMDM = (smMDM * (period - 1) + minusDMs[i]) / period;
    }
    const diPlus = smTR > 0 ? (smPDM / smTR) * 100 : 0;
    const diMinus = smTR > 0 ? (smMDM / smTR) * 100 : 0;
    const sumDI = diPlus + diMinus;
    const dx = sumDI > 0 ? (Math.abs(diPlus - diMinus) / sumDI) * 100 : 0;
    dxList.push(dx);

    if (dxList.length < period) {
      adxList.push(dx);
    } else if (dxList.length === period) {
      const avg = dxList.reduce((a,b)=>a+b,0) / period;
      adxList.push(avg);
    } else {
      const prevAdx = adxList[adxList.length - 1];
      const curAdx = (prevAdx * (period - 1) + dx) / period;
      adxList.push(curAdx);
    }
  }
  return adxList;
}

function calcRSI_stream(closes, period) {
  const gains = [0];
  const losses = [0];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }
  let avgG = gains.slice(0, Math.min(period, gains.length)).reduce((a,b)=>a+b,0)/Math.min(period, gains.length);
  let avgL = losses.slice(0, Math.min(period, losses.length)).reduce((a,b)=>a+b,0)/Math.min(period, losses.length);
  const res = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      res.push(50);
    } else {
      avgG = (avgG * (period - 1) + gains[i]) / period;
      avgL = (avgL * (period - 1) + losses[i]) / period;
      const rs = avgL === 0 ? 100 : avgG / (avgL || 1e-9);
      res.push(avgL === 0 ? 100 : 100 - (100 / (1 + rs)));
    }
  }
  return res;
}

function calcSupertrend_stream(highs, lows, closes, period = 10, multiplier = 3) {
  const atr = calcATR_stream(highs, lows, closes, period);
  const dirs = [];
  let upper = 0;
  let lower = 0;
  let dir = 1;

  for (let i = 0; i < closes.length; i++) {
    const hl2 = (highs[i] + lows[i]) / 2;
    const basicUpper = hl2 + multiplier * atr[i];
    const basicLower = hl2 - multiplier * atr[i];
    const prevClose = i > 0 ? closes[i-1] : closes[i];

    if (i === 0) {
      upper = basicUpper;
      lower = basicLower;
    } else {
      upper = (basicUpper < upper || prevClose > upper) ? basicUpper : upper;
      lower = (basicLower > lower || prevClose < lower) ? basicLower : lower;
    }

    if (dir === 1 && closes[i] < lower) dir = -1;
    else if (dir === -1 && closes[i] > upper) dir = 1;
    dirs.push(dir);
  }
  return dirs;
}

// Global stats containers
const allTimelinePoints = [];
const allTransitions = [];
const transitionMatrix = {};
const regimeObservations = { TREND_UP: 0, TREND_DOWN: 0, RANGE: 0, TRANSITION: 0, HIGH_VOLATILITY: 0 };
const regimePerformance = {
  TREND_UP: { fwd5: [], fwd10: [], fwd15: [], fwd30: [], mfes: [] },
  TREND_DOWN: { fwd5: [], fwd10: [], fwd15: [], fwd30: [], mfes: [] },
  RANGE: { fwd5: [], fwd10: [], fwd15: [], fwd30: [], mfes: [] },
  TRANSITION: { fwd5: [], fwd10: [], fwd15: [], fwd30: [], mfes: [] }
};
const regimeDirectionPerf = {};
const regimeFlowMatrix = {};
const btcVsAssetMatrix = {};

const lagStats = {
  trendStartLag: [],
  trendEndLag: []
};

const falseRegimes = {
  TREND_UP: { trueCount: 0, falseCount: 0 },
  TREND_DOWN: { trueCount: 0, falseCount: 0 },
  RANGE: { trueCount: 0, falseCount: 0 },
  TRANSITION: { trueCount: 0, falseCount: 0 }
};

const rangeTradesStats = {
  total: 0, wins: 0, losses: 0, pnlR: 0, mfes: [], maes: [], durations: [],
  stable: { count: 0, wins: 0, pnlR: 0, mfes: [] },
  preBreakout: { count: 0, wins: 0, pnlR: 0, mfes: [] }
};

const transitionTradesStats = {};
const givebackPrecedingTransitions = [];
const directionErrors = [];

// Audit each trade
master.forEach((t, tIndex) => {
  const klines = candles[t.trade_id] || [];
  const preKlines = (t.candles_before_entry || []).map(c => ({
    time: new Date(c.timestamp).getTime(),
    open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 1000,
    quoteVolume: c.quote_volume || (c.close * (c.volume || 1000)),
    trades: c.number_of_trades || 10,
    takerBuyBase: (c.volume || 1000) * 0.5,
    takerBuyQuote: (c.close * (c.volume || 1000)) * 0.5
  }));

  const fullKlines = preKlines.concat(klines);
  const entryIdx = preKlines.length;

  const highs = fullKlines.map(c => c.high);
  const lows = fullKlines.map(c => c.low);
  const closes = fullKlines.map(c => c.close);
  const volumes = fullKlines.map(c => c.volume);

  const ema21s = calcEMA_stream(closes, 21);
  const ema50s = calcEMA_stream(closes, 50);
  const ema200s = calcEMA_stream(closes, 200);
  const atr14s = calcATR_stream(highs, lows, closes, 14);
  const atr20s = calcATR_stream(highs, lows, closes, 20);
  const adxs = calcADX_stream(highs, lows, closes, 14);
  const rsis = calcRSI_stream(closes, 14);
  const supertrends = calcSupertrend_stream(highs, lows, closes, 10, 3);

  const isLong = t.side === 'LONG' || t.direction === 'LONG';
  const entryPrice = t.entry_price;
  const initialSl = t.stop_loss;
  const slDist = Math.abs(entryPrice - initialSl);
  const btcRegime = (t.market_context && t.market_context.btc_regime) || 'BULL_STRONG';
  const flowAtEntry = (t.entry_context && t.entry_context.flow_state) || t.flow_state || 'UNKNOWN';

  let runningMfe = 0;
  let runningMae = 0;
  let tp1Reached = false;
  let tp2Reached = false;
  let tp3Reached = false;
  let curSl = initialSl;
  let prevRegime = t.market_regime || 'RANGE';

  const tradeTimeline = [];
  const tradeTransitions = [];

  // Track trade-specific lag
  let firstTrendBreakoutMinute = -1;
  let firstTrendClassifiedMinute = -1;
  let trendExhaustionMinute = -1;
  let trendDeclassifiedMinute = -1;

  let tradeCvd = 0;

  for (let i = entryIdx; i < fullKlines.length; i++) {
    const minute = i - entryIdx;
    const k = fullKlines[i];

    const curHigh = k.high;
    const curLow = k.low;
    const curClose = k.close;

    const highR = isLong ? (curHigh - entryPrice) / slDist : (entryPrice - curLow) / slDist;
    const lowR = isLong ? (curLow - entryPrice) / slDist : (entryPrice - curHigh) / slDist;
    const closeR = isLong ? (curClose - entryPrice) / slDist : (entryPrice - curClose) / slDist;

    if (highR > runningMfe) runningMfe = highR;
    const curAdverse = isLong ? (entryPrice - curLow) / slDist : (curHigh - entryPrice) / slDist;
    if (curAdverse > runningMae) runningMae = curAdverse;

    if (highR >= 0.75) tp1Reached = true;
    if (highR >= 1.80) tp2Reached = true;
    if (highR >= 3.50) tp3Reached = true;

    // RVOL
    const volSlice = volumes.slice(Math.max(0, i - 20), i);
    const avgVol20 = volSlice.reduce((a,b)=>a+b,0) / (volSlice.length || 1);
    const rvol = k.volume / (avgVol20 || 1);

    // CVD & Taker ratio
    const takerRatio = k.volume > 0 ? (k.takerBuyBase / k.volume) : 0.5;
    const candleDelta = (k.takerBuyBase * 2) - k.volume;
    tradeCvd += candleDelta;

    // Structure HH_HL or LH_LL over last 10 candles
    const lookback = Math.min(10, i);
    const recentHighs = highs.slice(i - lookback, i + 1);
    const recentLows = lows.slice(i - lookback, i + 1);
    const HH_HL = curClose > Math.min(...recentHighs) && curLow > Math.min(...recentLows);
    const LH_LL = curClose < Math.max(...recentLows) && curHigh < Math.max(...recentHighs);

    const price = curClose;
    const ema21 = ema21s[i];
    const ema50 = ema50s[i];
    const ema200 = ema200s[i];
    const adx = adxs[i];
    const rsi = rsis[i];
    const atr14 = atr14s[i];
    const atr20 = atr20s[i];
    const supertrendDir = supertrends[i];

    const bull_align = price > ema21 && ema21 > ema50 && ema50 > ema200;
    const bear_align = price < ema21 && ema21 < ema50 && ema50 < ema200;

    // Detect Market Regime at minute t
    const ctxObj = { regime: btcRegime, tradeable: true };
    const pObj = {
      price, ema21, ema50, ema200, adx, rvol, atr14, atr20,
      bull_align, bear_align, HH_HL, LH_LL
    };

    let curRegime = "RANGE";
    if (ctxObj.regime === "VIOLENT" || (pObj.rvol > 2.8 && pObj.atr14 > pObj.atr20 * 1.6)) {
      curRegime = "HIGH_VOLATILITY";
    } else {
      const btcBull = ctxObj.regime.includes("BULL");
      const btcBear = ctxObj.regime.includes("BEAR");
      const assetBullAlign = pObj.price > pObj.ema50 && pObj.ema50 > pObj.ema200 && pObj.HH_HL;
      const assetBearAlign = pObj.price < pObj.ema50 && pObj.ema50 < pObj.ema200 && pObj.LH_LL;

      if (btcBull && assetBullAlign && pObj.adx >= 20) curRegime = "TREND_UP";
      else if (btcBear && assetBearAlign && pObj.adx >= 20) curRegime = "TREND_DOWN";
      else if (assetBullAlign && pObj.adx > 25 && pObj.price > pObj.ema21) curRegime = "TREND_UP";
      else if (assetBearAlign && pObj.adx > 25 && pObj.price < pObj.ema21) curRegime = "TREND_DOWN";
      else {
        const structureDivergence = (pObj.bull_align && pObj.LH_LL) || (pObj.bear_align && pObj.HH_HL);
        const maCompression = Math.abs(pObj.ema50 - pObj.ema200) / (pObj.ema200 || 1) < 0.008;
        if (structureDivergence || (maCompression && pObj.adx < 22)) {
          curRegime = "TRANSITION";
        } else {
          curRegime = "RANGE";
        }
      }
    }

    regimeObservations[curRegime] = (regimeObservations[curRegime] || 0) + 1;

    // Track transitions
    if (curRegime !== prevRegime) {
      const pair = `${prevRegime} -> ${curRegime}`;
      transitionMatrix[pair] = (transitionMatrix[pair] || 0) + 1;
      tradeTransitions.push({
        minute,
        from: prevRegime,
        to: curRegime,
        price,
        closeR,
        runningMfe
      });
      prevRegime = curRegime;
    }

    // Forward returns at minute t
    const fwd5Close = i + 5 < fullKlines.length ? fullKlines[i+5].close : null;
    const fwd10Close = i + 10 < fullKlines.length ? fullKlines[i+10].close : null;
    const fwd15Close = i + 15 < fullKlines.length ? fullKlines[i+15].close : null;
    const fwd30Close = i + 30 < fullKlines.length ? fullKlines[i+30].close : null;

    if (fwd5Close !== null && regimePerformance[curRegime]) {
      const ret5 = isLong ? (fwd5Close - price) / slDist : (price - fwd5Close) / slDist;
      regimePerformance[curRegime].fwd5.push(ret5);
    }
    if (fwd10Close !== null && regimePerformance[curRegime]) {
      const ret10 = isLong ? (fwd10Close - price) / slDist : (price - fwd10Close) / slDist;
      regimePerformance[curRegime].fwd10.push(ret10);
    }
    if (fwd15Close !== null && regimePerformance[curRegime]) {
      const ret15 = isLong ? (fwd15Close - price) / slDist : (price - fwd15Close) / slDist;
      regimePerformance[curRegime].fwd15.push(ret15);
    }
    if (fwd30Close !== null && regimePerformance[curRegime]) {
      const ret30 = isLong ? (fwd30Close - price) / slDist : (price - fwd30Close) / slDist;
      regimePerformance[curRegime].fwd30.push(ret30);
    }

    // False Regime evaluation
    if (fwd15Close !== null && falseRegimes[curRegime]) {
      const ret15 = isLong ? (fwd15Close - price) / slDist : (price - fwd15Close) / slDist;
      if (curRegime === 'TREND_UP' || curRegime === 'TREND_DOWN') {
        if (ret15 > 0.10) falseRegimes[curRegime].trueCount++;
        else falseRegimes[curRegime].falseCount++;
      } else if (curRegime === 'RANGE') {
        if (Math.abs(ret15) <= 0.15) falseRegimes[curRegime].trueCount++;
        else falseRegimes[curRegime].falseCount++;
      } else if (curRegime === 'TRANSITION') {
        if (Math.abs(ret15) > 0.15) falseRegimes[curRegime].trueCount++;
        else falseRegimes[curRegime].falseCount++;
      }
    }

    // Regime x Direction Perf
    const dirKey = `${curRegime} + ${t.side}`;
    if (!regimeDirectionPerf[dirKey]) regimeDirectionPerf[dirKey] = { obs: 0, fwd15: [] };
    regimeDirectionPerf[dirKey].obs++;
    if (fwd15Close !== null) {
      const ret15 = isLong ? (fwd15Close - price) / slDist : (price - fwd15Close) / slDist;
      regimeDirectionPerf[dirKey].fwd15.push(ret15);
    }

    // Regime x Flow state
    const flowCat = flowAtEntry.includes('BUY') || flowAtEntry.includes('LONG') ? 'BULLISH_FLOW' :
                    (flowAtEntry.includes('SELL') || flowAtEntry.includes('SHORT') ? 'BEARISH_FLOW' : 'MIXED_FLOW');
    const flowKey = `${curRegime} + ${flowCat}`;
    if (!regimeFlowMatrix[flowKey]) regimeFlowMatrix[flowKey] = { obs: 0, fwd15: [], mfes: [] };
    regimeFlowMatrix[flowKey].obs++;
    if (fwd15Close !== null) {
      const ret15 = isLong ? (fwd15Close - price) / slDist : (price - fwd15Close) / slDist;
      regimeFlowMatrix[flowKey].fwd15.push(ret15);
    }
    regimeFlowMatrix[flowKey].mfes.push(runningMfe);

    // BTC vs Asset Regime
    const btcKey = `${btcRegime} + ${curRegime}`;
    if (!btcVsAssetMatrix[btcKey]) btcVsAssetMatrix[btcKey] = { obs: 0, fwd15: [] };
    btcVsAssetMatrix[btcKey].obs++;
    if (fwd15Close !== null) {
      const ret15 = isLong ? (fwd15Close - price) / slDist : (price - fwd15Close) / slDist;
      btcVsAssetMatrix[btcKey].fwd15.push(ret15);
    }

    // Timeline checkpoints: 0m, 5m, 10m, 15m, 30m, 45m, 60m, or last candle
    if (minute === 0 || minute === 5 || minute === 10 || minute === 15 || minute === 30 || minute === 45 || minute === 60 || i === fullKlines.length - 1) {
      tradeTimeline.push({
        minute,
        timestamp: k.time,
        regime: curRegime,
        btcRegime,
        price,
        closeR: +closeR.toFixed(2),
        runningMfe: +runningMfe.toFixed(2),
        runningMae: +runningMae.toFixed(2),
        adx: +adx.toFixed(1),
        rsi: +rsi.toFixed(1),
        rvol: +rvol.toFixed(2),
        takerRatio: +takerRatio.toFixed(2),
        cvd: Math.round(tradeCvd),
        supertrend: supertrendDir === 1 ? 'BULL' : 'BEAR',
        tp1Reached,
        tp2Reached,
        tp3Reached
      });
    }

    // Lag detection tracking:
    // Trend breakout: price expands > 0.25R with ADX > 20
    if (firstTrendBreakoutMinute === -1 && Math.abs(closeR) >= 0.25 && adx >= 20) {
      firstTrendBreakoutMinute = minute;
    }
    if (firstTrendClassifiedMinute === -1 && (curRegime === 'TREND_UP' || curRegime === 'TREND_DOWN')) {
      firstTrendClassifiedMinute = minute;
    }
    // Trend exhaustion: MFE peaked > 0.5R, price drops 0.2R, ADX declines
    if (runningMfe >= 0.50 && (runningMfe - closeR) >= 0.20 && trendExhaustionMinute === -1) {
      trendExhaustionMinute = minute;
    }
    if (trendExhaustionMinute !== -1 && trendDeclassifiedMinute === -1 && (curRegime === 'RANGE' || curRegime === 'TRANSITION')) {
      trendDeclassifiedMinute = minute;
    }
  }

  // Calculate lag for this trade
  if (firstTrendBreakoutMinute !== -1 && firstTrendClassifiedMinute !== -1) {
    const lag = firstTrendClassifiedMinute - firstTrendBreakoutMinute;
    lagStats.trendStartLag.push(Math.max(0, lag));
  }
  if (trendExhaustionMinute !== -1 && trendDeclassifiedMinute !== -1) {
    const lag = trendDeclassifiedMinute - trendExhaustionMinute;
    lagStats.trendEndLag.push(Math.max(0, lag));
  }

  // RANGE Deep Dive
  const entryRegime = t.market_regime || 'RANGE';
  if (entryRegime === 'RANGE') {
    rangeTradesStats.total++;
    if (t.pnl_r > 0) rangeTradesStats.wins++; else rangeTradesStats.losses++;
    rangeTradesStats.pnlR += (t.pnl_r || 0);
    rangeTradesStats.mfes.push(t.maximum_favorable_excursion_r || 0);
    rangeTradesStats.maes.push(t.maximum_adverse_excursion_r || 0);
    rangeTradesStats.durations.push(t.holding_time_seconds || 0);

    // Pre-breakout if MFE >= 0.5R, else stable range
    if ((t.maximum_favorable_excursion_r || 0) >= 0.50) {
      rangeTradesStats.preBreakout.count++;
      if (t.pnl_r > 0) rangeTradesStats.preBreakout.wins++;
      rangeTradesStats.preBreakout.pnlR += (t.pnl_r || 0);
      rangeTradesStats.preBreakout.mfes.push(t.maximum_favorable_excursion_r);
    } else {
      rangeTradesStats.stable.count++;
      if (t.pnl_r > 0) rangeTradesStats.stable.wins++;
      rangeTradesStats.stable.pnlR += (t.pnl_r || 0);
      rangeTradesStats.stable.mfes.push(t.maximum_favorable_excursion_r);
    }
  }

  // Giveback preceding transitions
  if ((t.maximum_favorable_excursion_r || 0) >= 0.55 && (t.maximum_favorable_excursion_r - t.pnl_r) >= 0.25) {
    givebackPrecedingTransitions.push({
      symbol: t.symbol,
      mfe: t.maximum_favorable_excursion_r,
      finalR: t.pnl_r,
      givebackR: +(t.maximum_favorable_excursion_r - t.pnl_r).toFixed(2),
      transitions: tradeTransitions.map(tr => `${tr.from}->${tr.to} @ m${tr.minute}`)
    });
  }

  // Direction Errors: LONG with MAE >= 0.8R or SHORT with MAE >= 0.8R
  if ((t.maximum_adverse_excursion_r || 0) >= 0.80) {
    directionErrors.push({
      symbol: t.symbol,
      side: t.side,
      entryRegime,
      flowAtEntry,
      btcRegime,
      adxAtEntry: t.entry_context?.indicators_at_entry?.adx,
      mfe: t.maximum_favorable_excursion_r,
      mae: t.maximum_adverse_excursion_r,
      pnlR: t.pnl_r,
      transitions: tradeTransitions.map(tr => `${tr.from}->${tr.to} @ m${tr.minute}`)
    });
  }
});

// Summary calculations
const totalObs = Object.values(regimeObservations).reduce((a,b)=>a+b,0);
const regimeDist = {};
for (let r in regimeObservations) {
  regimeDist[r] = {
    count: regimeObservations[r],
    pct: +((regimeObservations[r] / totalObs) * 100).toFixed(1)
  };
}

const regimePerfSummary = {};
for (let r in regimePerformance) {
  const p = regimePerformance[r];
  const avg = arr => arr.length ? +(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(3) : 0;
  const med = arr => {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a,b)=>a-b);
    return +(s[Math.floor(s.length/2)]).toFixed(3);
  };
  const wr = arr => arr.length ? +((arr.filter(x => x > 0).length / arr.length) * 100).toFixed(1) : 0;

  regimePerfSummary[r] = {
    obs: p.fwd5.length,
    fwd5: { avg: avg(p.fwd5), med: med(p.fwd5), wr: wr(p.fwd5) },
    fwd10: { avg: avg(p.fwd10), med: med(p.fwd10), wr: wr(p.fwd10) },
    fwd15: { avg: avg(p.fwd15), med: med(p.fwd15), wr: wr(p.fwd15) },
    fwd30: { avg: avg(p.fwd30), med: med(p.fwd30), wr: wr(p.fwd30) }
  };
}

const lagSummary = {
  trendStart: {
    count: lagStats.trendStartLag.length,
    avg: lagStats.trendStartLag.length ? +(lagStats.trendStartLag.reduce((a,b)=>a+b,0)/lagStats.trendStartLag.length).toFixed(1) : 0,
    median: lagStats.trendStartLag.length ? lagStats.trendStartLag.slice().sort((a,b)=>a-b)[Math.floor(lagStats.trendStartLag.length/2)] : 0,
    worst: lagStats.trendStartLag.length ? Math.max(...lagStats.trendStartLag) : 0
  },
  trendEnd: {
    count: lagStats.trendEndLag.length,
    avg: lagStats.trendEndLag.length ? +(lagStats.trendEndLag.reduce((a,b)=>a+b,0)/lagStats.trendEndLag.length).toFixed(1) : 0,
    median: lagStats.trendEndLag.length ? lagStats.trendEndLag.slice().sort((a,b)=>a-b)[Math.floor(lagStats.trendEndLag.length/2)] : 0,
    worst: lagStats.trendEndLag.length ? Math.max(...lagStats.trendEndLag) : 0
  }
};

const falseRegimeSummary = {};
for (let r in falseRegimes) {
  const f = falseRegimes[r];
  const tot = f.trueCount + f.falseCount;
  falseRegimeSummary[r] = {
    trueCount: f.trueCount,
    falseCount: f.falseCount,
    accuracyPct: tot > 0 ? +((f.trueCount / tot) * 100).toFixed(1) : 0,
    falseRatePct: tot > 0 ? +((f.falseCount / tot) * 100).toFixed(1) : 0
  };
}

const auditOutput = {
  regimeDist,
  regimePerfSummary,
  transitionMatrix,
  lagSummary,
  falseRegimeSummary,
  regimeDirectionPerf,
  regimeFlowMatrix,
  btcVsAssetMatrix,
  rangeTradesStats,
  givebackPrecedingTransitions,
  directionErrors
};

fs.writeFileSync('regime_lifecycle_audit_results.json', JSON.stringify(auditOutput, null, 2));
console.log('Regime Lifecycle Audit completed successfully! Saved to regime_lifecycle_audit_results.json');
