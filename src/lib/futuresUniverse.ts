/**
 * Full coverage of all TRADING Binance USDⓈ-M perpetual contracts.
 * No volume or price-change threshold is used to exclude symbols.
 */
export interface UsdmContract {
  symbol?: string;
  contractType?: string;
  quoteAsset?: string;
  status?: string;
}
export function listAllUsdmPerpetuals(contracts: readonly UsdmContract[]): string[] {
  return [...new Set(contracts
    .filter(x => x.status === "TRADING" && x.contractType === "PERPETUAL"
      && (x.quoteAsset === "USDT" || x.quoteAsset === "USDC")
      && typeof x.symbol === "string" && x.symbol.length > 0)
    .map(x => x.symbol as string))].sort();
}
export interface CoverageBatch {
  symbols: string[];
  nextIndex: number;
  effectiveBatchSize: number;
  completedPass: boolean;
}
/**
 * Default AUTO mode (0) covers the entire universe in roughly four 15-second
 * ticks when bandwidth and Binance rate limits allow. Manual size (5–200)
 * controls the speed, not which symbols are eligible. Always visit the tail.
 */
export function nextCoverageBatch(universe: readonly string[], index: number, setting = 0): CoverageBatch {
  const len = universe.length;
  const effectiveBatchSize = setting >= 5 && Number.isFinite(setting)
    ? Math.max(5, Math.min(200, Math.floor(setting)))
    : Math.max(25, Math.min(200, Math.ceil(len / 4)));
  if (!len) return {symbols: [], nextIndex: 0, effectiveBatchSize, completedPass: false};
  const start = Number.isFinite(index) && index >= 0 && index < len ? Math.floor(index) : 0;
  const end = Math.min(len, start + effectiveBatchSize);
  return {symbols: universe.slice(start, end), nextIndex: end === len ? 0 : end,
    effectiveBatchSize, completedPass: end === len};
}
