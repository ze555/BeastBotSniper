
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
export function calculateTakerRatio(lastK: any[]): number {
  if (!lastK || lastK.length < 10) return 1.0;
  const totalVol = parseFloat(lastK[5]);
  const takerBuyVol = parseFloat(lastK[9]);
  
  if (isNaN(totalVol) || isNaN(takerBuyVol) || totalVol <= 0) {
    return 1.0;
  }
  
  const takerSellVol = totalVol - takerBuyVol;
  if (takerSellVol > 0) {
    const ratio = takerBuyVol / takerSellVol;
    return isNaN(ratio) ? 1.0 : ratio;
  }
  
  return 1.0;
}
