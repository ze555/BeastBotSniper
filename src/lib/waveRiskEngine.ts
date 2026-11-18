export type WaveStopSide = "LONG" | "SHORT";

export interface WaveStopInput {
  side: WaveStopSide;
  entry: number;
  atr1m: number;
  candles: Array<{ high: number; low: number }>;
  invalidationLevel: number | null | undefined;
}

export interface WaveStopPlan {
  stop: number;
  distance: number;
  structuralLevel: number;
  buffer: number;
  minimumDistance: number;
  maximumDistance: number;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Build the initial stop from the same 1m wave structure used by the entry trigger.
 * Rejects invalid or excessively distant structural stops instead of silently sizing
 * a 1m entry from unrelated 15m swings.
 */
export function calculateWaveStop(input: WaveStopInput): WaveStopPlan | null {
  if (!finite(input.entry) || input.entry <= 0 ||
      !finite(input.atr1m) || input.atr1m <= 0 ||
      !Array.isArray(input.candles) || input.candles.length < 3) return null;

  const recent = input.candles.slice(-3);
  if (recent.some(c => !finite(c.high) || !finite(c.low) || c.high < c.low || c.low <= 0)) return null;

  const swing = input.side === "LONG"
    ? Math.min(...recent.map(c => c.low))
    : Math.max(...recent.map(c => c.high));
  const invalidation = finite(input.invalidationLevel) ? input.invalidationLevel : swing;

  if (input.side === "LONG" ? invalidation >= input.entry : invalidation <= input.entry) return null;

  const structuralLevel = input.side === "LONG"
    ? Math.min(swing, invalidation)
    : Math.max(swing, invalidation);
  const buffer = Math.max(input.atr1m * 0.25, input.entry * 0.0005);
  const minimumDistance = Math.max(input.atr1m * 0.70, input.entry * 0.0015);
  const stop = input.side === "LONG"
    ? Math.min(structuralLevel - buffer, input.entry - minimumDistance)
    : Math.max(structuralLevel + buffer, input.entry + minimumDistance);
  const distance = Math.abs(input.entry - stop);
  const maximumDistance = Math.max(input.atr1m * 4, input.entry * 0.012);

  if (!finite(stop) || stop <= 0 || !finite(distance) ||
      distance < minimumDistance * 0.99 || distance > maximumDistance) return null;

  return { stop, distance, structuralLevel, buffer, minimumDistance, maximumDistance };
}

/** Net loss if the remaining position exits at its current stop, including estimated costs. */
export function estimateNetRiskAtStop(input: {
  direction: WaveStopSide;
  entry: number;
  stop: number;
  position: number;
  realizedPnl?: number;
  feeRate: number;
  slippageRate: number;
}): number {
  const { direction, entry, stop, position, feeRate, slippageRate } = input;
  if (![entry, stop, position, feeRate, slippageRate].every(finite) ||
      entry <= 0 || stop <= 0 || position <= 0 || feeRate < 0 || slippageRate < 0) return 0;

  const grossAtStop = (direction === "LONG" ? stop - entry : entry - stop) * position;
  const fees = (entry + stop) * position * feeRate;
  const slippage = stop * position * slippageRate;
  const netAtStop = (finite(input.realizedPnl) ? input.realizedPnl : 0) + grossAtStop - fees - slippage;
  return Math.max(0, -netAtStop);
}

/** Shrink a proposed quantity to fit the remaining portfolio risk budget. */
export function capPositionToRiskBudget(input: {
  proposedPosition: number;
  entry: number;
  stop: number;
  availableRisk: number;
  feeRate: number;
  slippageRate: number;
}): number {
  const { proposedPosition, entry, stop, availableRisk, feeRate, slippageRate } = input;
  if (![proposedPosition, entry, stop, availableRisk, feeRate, slippageRate].every(finite) ||
      proposedPosition <= 0 || entry <= 0 || stop <= 0 || availableRisk <= 0 ||
      feeRate < 0 || slippageRate < 0) return 0;

  const perUnitRisk = Math.abs(entry - stop) + (entry + stop) * feeRate + stop * slippageRate;
  if (!finite(perUnitRisk) || perUnitRisk <= 0) return 0;
  return Math.max(0, Math.min(proposedPosition, availableRisk / perUnitRisk));
}
