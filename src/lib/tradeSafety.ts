export type Direction = 'LONG' | 'SHORT';

// New positions use a runner-heavy allocation; restored positions retain their saved weights.
export const TARGET_R = [0.75, 1.8, 3.5] as const;
export const TARGET_WEIGHTS = [0.15, 0.25, 0.60] as const;
export const MIN_PLANNED_RR = 2.5;

export function closedCandles<T extends { closeTime: number }>(candles: T[], now = Date.now()): T[] {
  return candles.filter(c => Number.isFinite(c.closeTime) && c.closeTime < now);
}

export function planTargets(direction: Direction, p: any, entry: number, stop: number,
  fee: number, slippage: number) {
  const sign = direction === 'LONG' ? 1 : -1;
  const risk = sign * (entry - stop);
  if (![entry, stop, risk, fee, slippage, p.atr14].every(Number.isFinite) ||
      entry <= 0 || risk <= 0 || p.atr14 <= 0 || fee < 0 || slippage < 0) return null;
  const candles = p.klines || [];
  // Confirmed two-sided swing levels only; never invent a liquidity target beyond observed structure.
  const levels: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const key = direction === 'LONG' ? 'high' : 'low';
    const level = candles[i][key];
    if (Number.isFinite(level) && [i - 2, i - 1, i + 1, i + 2].every(j =>
      sign * (level - candles[j][key]) > 0) && sign * (level - entry) > 0) levels.push(level);
  }
  if (!levels.length) return null; // Unknown structural headroom is not proof of reward.
  const obstacle = direction === 'LONG' ? Math.min(...levels) : Math.max(...levels);
  const structuralR = sign * (obstacle - entry) / risk;
  if (structuralR < MIN_PLANNED_RR) return null;
  const runnerR = Math.min(TARGET_R[2], (sign * (obstacle - entry) - p.atr14 * 0.1) / risk);
  if (runnerR <= TARGET_R[1]) return null;
  const targets = [TARGET_R[0], TARGET_R[1], runnerR].map(r => entry + sign * risk * r);
  if (targets.some(target => target <= 0)) return null;
  const netRR = targets.reduce((total, target, i) => {
    const fill = target * (1 - sign * slippage);
    return total + TARGET_WEIGHTS[i] * (sign * (fill - entry) - (entry + fill) * fee) / risk;
  }, 0);
  if (netRR < MIN_PLANNED_RR) return null;
  return { targets, structuralR, netRR, obstacle };
}

export function adverseFlow(direction: Direction, p: any, w: any): boolean {
  return direction === 'LONG'
    ? !!(w.hidden_sell || w.scenario === 'INST_SHORT' || (p.adx > 25 && p.di_minus > p.di_plus))
    : !!(w.hidden_buy || w.scenario === 'INST_LONG' || (p.adx > 25 && p.di_plus > p.di_minus));
}

// Each direction has the same attainable 0..5 score.
export function exhaustionScore(direction: Direction, p: any, w: any): number {
  const c = p.klines || [];
  const hist = p.hist || [];
  const sign = direction === 'LONG' ? 1 : -1;
  const prior = c.slice(-10, -3);
  let score = 0;
  const extreme = direction === 'LONG'
    ? Math.max(...prior.map((k: any) => k.high)) : Math.min(...prior.map((k: any) => k.low));
  if (prior.length && hist.length >= 4 && sign * (p.price - extreme) > 0 &&
      sign * (hist[hist.length - 1] - hist[hist.length - 4]) < 0) score += 2;
  const wick = direction === 'LONG' ? p.u_wick : p.l_wick;
  if (wick > Math.max(p.body * 2.5, p.atr14 * 0.4)) score += 2;
  if (sign * w.fund > 0.06 / 100) score += 1;
  return score;
}
