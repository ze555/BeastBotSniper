import { MarketMetrics, BotSettings } from '../../types/trading';

export class FusionEngine {
  /**
   * Calculates a unified signal score based on various fundamental and institutional metrics.
   * Returns a score from 0 to 100.
   */
  public static calculateFusionScore(metrics: MarketMetrics, settings: BotSettings): { score: number; reason: string } {
    if (!settings.useFusionEngine) return { score: 100, reason: "Fusion Engine Disabled" };

    const sensitivity = settings.fusionSensitivity ?? 1.0;
    const weights = {
      oi: settings.fusionWeightOi ?? 0.25,
      funding: settings.fusionWeightFunding ?? 0.25,
      vol: settings.fusionWeightVol ?? 0.25,
      inst: settings.fusionWeightInst ?? 0.25,
    };

    let totalScore = 0;
    let details: string[] = [];

    // 1. Open Interest (OI) Component
    // Growing OI + Growing Price = Long strength
    // Falling OI + Growing Price = Short squeeze / Weak move
    const oiScore = this.evaluateOI(metrics.oiChange ?? 0, sensitivity);
    totalScore += oiScore * weights.oi;
    details.push(`OI: ${oiScore.toFixed(0)}%`);

    // 2. Funding Rate Component
    // Negative funding = Shorts are paying longs (Potential squeeze)
    // Extreme positive = High leverage longs (Danger of flush)
    const fundingScore = this.evaluateFunding(metrics.fundingRate ?? 0, sensitivity);
    totalScore += fundingScore * weights.funding;
    details.push(`Fund: ${fundingScore.toFixed(0)}%`);

    // 3. Volume / Momentum Component
    // RVOL > 1.5 is strong. RVOL > 3.0 is institutional.
    const volScore = this.evaluateVolume(metrics.rvol, sensitivity);
    totalScore += volScore * weights.vol;
    details.push(`Vol: ${volScore.toFixed(0)}%`);

    // 4. Institutional Pressure (Taker Ratio)
    // Taker ratio > 1.05 = Aggressive buying
    const instScore = this.evaluateInstitutional(metrics.takerRatio ?? 1.0, sensitivity);
    totalScore += instScore * weights.inst;
    details.push(`Inst: ${instScore.toFixed(0)}%`);

    return {
      score: totalScore,
      reason: `Fusion Core [${details.join(' | ')}]`
    };
  }

  private static evaluateOI(oiChange: number, sensitivity: number): number {
    // oiChange is usually daily or since last scan %
    const absChange = Math.abs(oiChange);
    if (absChange > 5 * (1 / sensitivity)) return 100;
    if (absChange > 2 * (1 / sensitivity)) return 75;
    if (absChange > 0.5) return 50;
    return 20;
  }

  private static evaluateFunding(funding: number, sensitivity: number): number {
    const absFunding = Math.abs(funding);
    // Extreme funding (e.g. > 0.05%) attracts institutional "mean reversion" or "liquidation hunting"
    if (absFunding > 0.03 * sensitivity) return 100;
    if (absFunding > 0.01) return 80;
    return 50;
  }

  private static evaluateVolume(rvol: number, sensitivity: number): number {
    if (rvol > 3.0 * (1 / sensitivity)) return 100; // Institutional surge
    if (rvol > 1.5) return 75; // Strong momentum
    if (rvol > 1.0) return 50;
    return 20;
  }

  private static evaluateInstitutional(takerRatio: number, sensitivity: number): number {
    const diff = Math.abs(1 - takerRatio);
    if (diff > 0.1 * (1 / sensitivity)) return 100; // Heavy taker imbalance
    if (diff > 0.05) return 80;
    if (diff > 0.01) return 50;
    return 30;
  }
}
