
export function getTimeframes(isLongTerm: boolean) {
  if (isLongTerm) {
    return {
      m1: '15m',
      m5: '1h',
      m15: '4h'
    };
  }
  return {
    m1: '1m',
    m5: '5m',
    m15: '15m'
  };
}

/**
 * Calculates the Taker Buy/Sell ratio manually from raw Binance kline data.
 * @param lastK Raw kline candlestick array
 * @returns Calculated taker ratio (defaults to 1.0)
 */
export function calculateTakerRatio(klines: any[]): number {
  if (!klines || klines.length === 0) return 1.0;
  
  // If it's a single raw kline array rather than an array of klines, handle gracefully
  if (typeof klines[0] !== 'object') {
     const totalVol = parseFloat(klines[5]);
     const takerBuyVol = parseFloat(klines[9]);
     if (isNaN(totalVol) || isNaN(takerBuyVol) || totalVol <= 0) return 1.0;
     const takerSellVol = totalVol - takerBuyVol;
     if (takerSellVol > 0) return takerBuyVol / takerSellVol;
     return 1.0;
  }

  // Aggregate over the provided klines (e.g. last 15 minutes for smoothing)
  let totalVol = 0;
  let takerBuyVol = 0;

  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    if (k && k.length >= 10) {
      const vol = parseFloat(k[5]);
      const buyVol = parseFloat(k[9]);
      if (!isNaN(vol) && !isNaN(buyVol)) {
        totalVol += vol;
        takerBuyVol += buyVol;
      }
    }
  }

  if (totalVol <= 0) return 1.0;
  const takerSellVol = totalVol - takerBuyVol;
  if (takerSellVol > 0) {
    const ratio = takerBuyVol / takerSellVol;
    return isNaN(ratio) ? 1.0 : ratio;
  }
  
  return 1.0;
}
