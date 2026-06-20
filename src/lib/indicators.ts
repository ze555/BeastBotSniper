export function calcEMA(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const ema = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  ema.push(sum / period);
  for (let i = period; i < data.length; i++) {
    ema.push(data[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema;
}

export function calcATR(high: number[], low: number[], close: number[], period: number): number[] {
  if (high.length < period) return [];
  const tr = [];
  for (let i = 1; i < high.length; i++) {
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr.push(Math.max(hl, hc, lc));
  }
  
  // First ATR is an average of TR
  const atr = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  atr.push(sum / period);
  
  for (let i = period; i < tr.length; i++) {
    atr.push((atr[atr.length - 1] * (period - 1) + tr[i]) / period);
  }
  return atr;
}

export function calcRMA(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const rma = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  rma.push(sum / period);
  for (let i = period; i < data.length; i++) {
    rma.push((rma[rma.length - 1] * (period - 1) + data[i]) / period);
  }
  return rma;
}

export function calcADX(high: number[], low: number[], close: number[], period: number): { adx: number[], diPlus: number[], diMinus: number[] } {
  if (high.length < period) return { adx: [], diPlus: [], diMinus: [] };
  
  const tr = [];
  const upMove = [];
  const downMove = [];
  
  for (let i = 1; i < high.length; i++) {
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr.push(Math.max(hl, hc, lc));
    
    const up = high[i] - high[i - 1];
    const down = low[i - 1] - low[i];
    
    upMove.push(up > down && up > 0 ? up : 0);
    downMove.push(down > up && down > 0 ? down : 0);
  }

  const atr = calcRMA(tr, period);
  const plusDm = calcRMA(upMove, period);
  const minusDm = calcRMA(downMove, period);
  
  const diPlus = [];
  const diMinus = [];
  const dx = [];
  
  for (let i = 0; i < atr.length; i++) {
    const minLen = Math.min(plusDm.length, minusDm.length, atr.length);
    const offset = Math.abs(plusDm.length - atr.length); // synchronize arrays roughly
    
    const dp = (plusDm[i] / atr[i]) * 100;
    const dm = (minusDm[i] / atr[i]) * 100;
    diPlus.push(dp);
    diMinus.push(dm);
    
    dx.push((Math.abs(dp - dm) / (dp + dm)) * 100);
  }
  
  const adx = calcRMA(dx, period);
  
  return { adx, diPlus, diMinus };
}

export function calcMACD(close: number[], fast: number = 12, slow: number = 26, signalPeriod: number = 9) {
  const fastEma = calcEMA(close, fast);
  const slowEma = calcEMA(close, slow);
  
  const diff = fastEma.length - slowEma.length;
  const macd = [];
  for (let i = 0; i < slowEma.length; i++) {
    macd.push(fastEma[i + diff] - slowEma[i]);
  }
  
  const signal = calcEMA(macd, signalPeriod);
  
  const d2 = macd.length - signal.length;
  const hist = [];
  for (let i = 0; i < signal.length; i++) {
    hist.push(macd[i + d2] - signal[i]);
  }
  
  return { macdLine: macd, signalLine: signal, hist };
}

export function calcRSI(close: number[], period: number): number[] {
  if (close.length <= period) return [];
  const gains = [];
  const losses = [];
  for (let i = 1; i < close.length; i++) {
    const change = close[i] - close[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  const rsi = [];
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b) / period;

  rsi.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));

  for (let i = period; i < close.length - 1; i++) { // -1 because gains are 1 shorter than close
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    rsi.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
  }
  return rsi;
}

export function calcSupertrend(high: number[], low: number[], close: number[], period: number = 10, multiplier: number = 3) {
   const atr = calcATR(high, low, close, period);
   // Match indices: ATR is shorter than original arrays by `period` elements
   const offset = high.length - atr.length;
   
   const supertrend = [];
   const directions = [];
   
   let finalUpperband = 0;
   let finalLowerband = 0;
   let dir = 1; // 1 = UP, -1 = DOWN
   
   for (let i = 0; i < atr.length; i++) {
      const idx = i + offset;
      const hl2 = (high[idx] + low[idx]) / 2;
      const basicUpperband = hl2 + multiplier * atr[i];
      const basicLowerband = hl2 - multiplier * atr[i];
      
      const prevClose = close[idx - 1];
      
      if (i === 0) {
         finalUpperband = basicUpperband;
         finalLowerband = basicLowerband;
      } else {
         finalUpperband = (basicUpperband < finalUpperband || prevClose > finalUpperband) ? basicUpperband : finalUpperband;
         finalLowerband = (basicLowerband > finalLowerband || prevClose < finalLowerband) ? basicLowerband : finalLowerband;
      }
      
      if (dir === 1 && close[idx] < finalLowerband) {
         dir = -1;
      } else if (dir === -1 && close[idx] > finalUpperband) {
         dir = 1;
      }
      
      supertrend.push(dir === 1 ? finalLowerband : finalUpperband);
      directions.push(dir);
   }
   return { supertrend, directions };
}
