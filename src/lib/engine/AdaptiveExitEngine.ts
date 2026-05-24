import { Trade, MarketMetrics, BotSettings } from '../../types/trading.js';

export interface HybridRegimeScores {
  trendScore: number;
  rangeScore: number;
  squeezeScore: number;
  chopScore: number;
  panicScore: number;
  vacuumScore: number;
}

export interface InteractionMatrixFeedback {
  shouldExit: boolean;
  scoreAdjustment: number;
  bias: 'BULLISH_REVERSAL' | 'BEARISH_EXHAUSTION' | 'TRAPPED_LONGS' | 'TRAPPED_SHORTS' | 'PASSIVE_ABSORPTION' | 'NEUTRAL';
  reason: string;
}

export class AdaptiveExitEngine {
  // A stateful cache for tracking spread and wall history to compute spoofing persistence.
  private static orderbookHistory = new Map<string, { lastSpread: number; timestamps: number[]; persistenceScores: number[] }>();

  /**
   * Main analytical entrypoint for Microstructure Analysis
   */
  public static analyzeMicrostructure(
    trade: Trade,
    metrics: MarketMetrics,
    klines: any[],
    settings: BotSettings
  ) {
    const symbol = metrics.symbol;
    const price = metrics.price;
    const takerRatio = metrics.takerRatio ?? 1.0;
    const volume = metrics.volume;
    const rvol = metrics.rvol;
    const spread = metrics.spread ?? 0;
    const adx = metrics.adx ?? 25;
    const rsi = metrics.rsi ?? 50;
    const atr = metrics.atr ?? 0;
    const fundingRate = metrics.fundingRate ?? 0;
    // Derive open interest change if undefined
    const oiChange = metrics.oiChange ?? 0;

    // 1. Calculate derived CVD Delta (بروكسي لحجم البيع والشراء بناء على Taker Ratio)
    // Formula: BuyVolume - SellVolume = TotalVolume * (TakerRatio - 1) / (TakerRatio + 1)
    const cvdDelta = volume * ((takerRatio - 1) / (takerRatio + 1));

    // 2. Normalization via continuous Sigmoid curves (بديل للقطع الخطي التقليدي لضمان سلاسة التنقل)
    const normalizedCvd = this.sigmoidNormal(cvdDelta / (volume || 1) * 100, 15);
    const normalizedTaker = this.sigmoidNormal((takerRatio - 1) * 50, 20);

    // 3. Multi-Regime Hybrid Scoring
    const regimes = this.calculateHybridRegimes(adx, rsi, rvol, spread, price, fundingRate, oiChange);

    // 4. Persistence Score for Orderbook Spoofing (كشف الجدران الوهمية وتلاعب صانع السوق)
    const wallPersistence = this.calculateWallPersistence(symbol, spread);

    // 5. Relative ATR / Volatility Percentile Profile
    const relativeVolatility = this.calculateRelativeVolatility(atr, price, klines);

    // 6. Time Decay Dynamic Penalty (حساب اهتلاك القيمة الزمنية للصفقات الراكدة لرفع كفاءة رأس المال)
    const timeDecayPenalty = this.calculateTimeDecayPenalty(trade, rvol, adx);

    // 7. Microstructure Interaction Matrix Checklist
    const matrix = this.evaluateInteractionMatrix(trade, metrics, cvdDelta, oiChange, fundingRate);

    // 8. Execution Layer / Volume-Slippage Simulation
    const slippageRisk = this.calculateSlippageRisk(spread, volume, rvol, regimes.vacuumScore);

    return {
      cvdDelta,
      normalizedCvd,
      normalizedTaker,
      regimes,
      wallPersistence,
      relativeVolatility,
      timeDecayPenalty,
      matrix,
      slippageRisk
    };
  }

  /**
   * Calculates continuous Sigmoid curve: returns values between 0 and 100.
   */
  public static sigmoidNormal(val: number, k: number = 10): number {
    return 100 / (1 + Math.exp(-val / k));
  }

  /**
   * Helper model to evaluate concurrent hybrid regime scores.
   */
  private static calculateHybridRegimes(
    adx: number,
    rsi: number,
    rvol: number,
    spread: number,
    price: number,
    fundingRate: number,
    oiChange: number
  ): HybridRegimeScores {
    // Trend Engine Score (ADX high + high relative volume)
    const trendScore = Math.min(100, Math.max(0, (adx - 10) * 3 + (rvol > 1.2 ? 20 : 0)));

    // Range Scoring (Low ADX + RSI extremes that tend to pull price back)
    const rsiDeviation = Math.abs(50 - rsi);
    const rangeScore = Math.min(100, Math.max(0, (25 - adx) * 2 + rsiDeviation * 1.5));

    // Squeeze Intensity Score (High OI change + heavy funding polarization)
    const squeezeScore = Math.min(100, Math.max(0, Math.abs(oiChange) * 5 + Math.abs(fundingRate) * 1000));

    // Chop Score (Dead Zone: low ADX & low volume)
    const chopScore = Math.min(100, Math.max(0, (15 - adx) * 4 + (1 - rvol) * 40));

    // Panic Score (Heavy volatility expansion and skewed indicators)
    const panicScore = Math.min(100, Math.max(0, (rvol > 2.0 ? 40 : 0) + (rsi < 30 || rsi > 70 ? 30 : 0)));

    // Vacuum Score (Liquidity expansion/withdrawal: wide spread + low volume)
    const spreadPerc = (spread / price) * 10000; // bps
    const vacuumScore = Math.min(100, Math.max(0, spreadPerc * 5 + (rvol < 0.6 ? 30 : 0)));

    return {
      trendScore,
      rangeScore,
      squeezeScore,
      chopScore,
      panicScore,
      vacuumScore
    };
  }

  /**
   * Stateful filter evaluating orderbook wall persistence to filter spoofing/baiting.
   */
  private static calculateWallPersistence(symbol: string, spread: number): number {
    const now = Date.now();
    let data = this.orderbookHistory.get(symbol);

    if (!data) {
      data = { lastSpread: spread, timestamps: [], persistenceScores: [] };
      this.orderbookHistory.set(symbol, data);
    }

    // Capture spread change speed as a tracker of orderbook stability
    const spreadDrift = Math.abs(spread - data.lastSpread);
    data.lastSpread = spread;

    // Track stability timestamps
    data.timestamps.push(now);
    data.persistenceScores.push(spreadDrift === 0 ? 100 : Math.max(0, 100 - (spreadDrift * 1000)));

    // Clean historical values (keep only the last 15 updates)
    if (data.timestamps.length > 15) {
      data.timestamps.shift();
      data.persistenceScores.shift();
    }

    const sum = data.persistenceScores.reduce((a, b) => a + b, 0);
    return data.persistenceScores.length > 0 ? sum / data.persistenceScores.length : 50;
  }

  /**
   * Standardizes ATR relative to a rolling window (relative historical volatility profile)
   */
  private static calculateRelativeVolatility(atr: number, price: number, klines: any[]): number {
    if (klines.length < 10) return 50;

    // Calculate rolling percentage ATRs
    const atrPercs = klines.slice(-15).map((k, idx) => {
      const high = parseFloat(k[2]);
      const low = parseFloat(k[3]);
      const close = parseFloat(k[4]);
      return ((high - low) / close) * 100;
    });

    const avgAtrPerc = atrPercs.reduce((a, b) => a + b, 0) / atrPercs.length;
    const currentAtrPerc = price > 0 ? (atr / price) * 100 : avgAtrPerc;

    // Direct comparison: what is current volatility profile percentile compared to historical avg
    const ratio = currentAtrPerc / (avgAtrPerc || 0.01);
    
    // Scale out to 0-100 range
    return Math.min(100, Math.max(0, ratio * 50));
  }

  /**
   * Tracks time exhaustion (stagnation penalty).
   */
  private static calculateTimeDecayPenalty(trade: Trade, rvol: number, adx: number): number {
    const elapsedMs = Date.now() - trade.entryTime;
    const elapsedMinutes = elapsedMs / 60000;

    // Stagnation kicks in after 45 minutes of complete consolidation (rvol < 1.0 & low ADX)
    if (elapsedMinutes > 45 && rvol < 1.1 && adx < 20) {
      // Dynamic penalty: -0.5 points per minute of dead momentum
      return Math.min(35, (elapsedMinutes - 45) * 0.4);
    }
    return 0;
  }

  /**
   * Interaction Matrix Analysis Core (Non-Linear Market Correlations)
   */
  private static evaluateInteractionMatrix(
    trade: Trade,
    metrics: MarketMetrics,
    cvdDelta: number,
    oiChange: number,
    fundingRate: number
  ): InteractionMatrixFeedback {
    const side = trade.type;
    const price = metrics.price;
    const takerRatio = metrics.takerRatio ?? 1.0;

    // --- Scenario A: Trapped Longs Detection (صيد عقود الشراء الكاذبة) ---
    // Price flattening or falling but open interest rising fast with extremely negative CVD/takerRatio
    if (side === 'LONG' && oiChange > 3.0 && takerRatio < 0.96) {
      return {
        shouldExit: true,
        scoreAdjustment: -35,
        bias: 'TRAPPED_LONGS',
        reason: '⚠️ TRAPPED LONGS: Open Interest spiking on passive absorption with negative Flow Delta.'
      };
    }

    // --- Scenario B: Short Squeeze Potential (عقود قصيرة محاصرة) ---
    // If we are LONG and OI is rising, funding is highly negative, price is surging -> Let it moon!
    if (side === 'LONG' && oiChange > 4.0 && fundingRate < -0.01 && takerRatio > 1.04) {
      return {
        shouldExit: false,
        scoreAdjustment: 40,
        bias: 'TRAPPED_SHORTS',
        reason: '🚀 SHORT SQUEEZE ALIGNMENT: Aggressive shorts trapped as open interest surges on positive flow.'
      };
    }

    // --- Scenario C: Passive Buyers Absorption (امتصاص البيع بالمستويات الخفية) ---
    // CVD is heavily falling (extreme selling pressure) but price is NOT falling or actually rising
    // This implies Iceberg orders / strong limit buyers are absorbing all market sells
    const isPriceHolding = side === 'LONG' ? metrics.rsi > 45 : metrics.rsi < 55;
    if (takerRatio < 0.90 && isPriceHolding) {
      return {
        shouldExit: false,
        scoreAdjustment: 25,
        bias: 'PASSIVE_ABSORPTION',
        reason: '🛡️ PASSIVE ABSORPTION: Massive market sells being absorbed by institutional limit buyers.'
      };
    }

    // --- Scenario D: Momentum Exhaustion and Crowding ---
    // Extreme high funding rate indicating massive leverage crowding + OI starting to flatten/fall
    if (side === 'LONG' && fundingRate > 0.04 && oiChange < -1.0) {
      return {
        shouldExit: true,
        scoreAdjustment: -30,
        bias: 'BEARISH_EXHAUSTION',
        reason: '⚠️ LONG CROWDING: Excessively high funding rate paired with open interest capitulation.'
      };
    }

    return {
      shouldExit: false,
      scoreAdjustment: 0,
      bias: 'NEUTRAL',
      reason: 'FLOWS_STABLE'
    };
  }

  /**
   * Calculates execution slippage hazard based on active spread & volume profile
   */
  private static calculateSlippageRisk(
    spread: number,
    volume: number,
    rvol: number,
    vacuumScore: number
  ): number {
    const rawSlippage = spread > 0 ? (spread / (volume || 1)) * 1e6 : 0;
    // Scale slippage hazard to 0 - 100
    const scaled = Math.min(100, Math.max(0, rawSlippage * 10 + vacuumScore * 0.5));
    return scaled;
  }
}
