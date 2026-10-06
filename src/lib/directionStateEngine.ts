// ============================================================================
// BEASTBOT DIRECTION LIFECYCLE STATE ENGINE (v3.0.0)
// Pure Evidence-Based, Event-Driven Market Direction State Machine
// ============================================================================

export type DirectionState =
  | "UNKNOWN"
  | "FORMING_LONG"
  | "CONFIRMED_LONG"
  | "EXTENDING_LONG"
  | "WEAKENING_LONG"
  | "INVALIDATED_LONG"
  | "FORMING_SHORT"
  | "CONFIRMED_SHORT"
  | "EXTENDING_SHORT"
  | "WEAKENING_SHORT"
  | "INVALIDATED_SHORT";

export type MarketLifecycleEvent =
  | "FORMING_STRUCTURE_EVENT"
  | "BREAKOUT_EVENT"
  | "SUCCESSFUL_RETEST_EVENT"
  | "FAILED_RETEST_EVENT"
  | "BREAKDOWN_EVENT"
  | "BREAKOUT_CONFIRMATION_EVENT"
  | "BREAKDOWN_CONFIRMATION_EVENT"
  | "CONTINUATION_EVENT"
  | "MOMENTUM_EXHAUSTION_EVENT"
  | "EXHAUSTION_EVENT"
  | "RECOVERY_EVENT"
  | "INVALIDATION_EVENT"
  | "RESET_EVENT";

export interface StateTransitionRecord {
  symbol: string;
  timestamp: string | number;
  previousState: DirectionState;
  newState: DirectionState;
  event: MarketLifecycleEvent;
  structure: "HH_HL" | "LH_LL" | "HL_FORMING" | "LH_FORMING" | "CHOP" | "BREAKOUT" | "BREAKDOWN";
  breakout: boolean;
  retest: boolean;
  cvd: "BULLISH" | "BEARISH" | "NEUTRAL";
  takerFlow: "BUYING_DOMINANT" | "SELLING_DOMINANT" | "NEUTRAL";
  volume: "EXPANDING" | "NORMAL" | "DRY";
  oi: "SUPPORTIVE" | "UNFAVORABLE" | "NEUTRAL";
  btcContext: "CONGRUENT" | "NON_CONTRADICTORY" | "CONTRADICTORY";
  price: number;
  level: number | null;
  reason: string;
}

export interface DirectionDecision {
  direction: "LONG" | "SHORT" | "UNKNOWN";
  state: DirectionState;
  canEnter: boolean;
  entryType: "FORMING_EARLY" | "CONFIRMED_STANDARD" | "NONE";
  managementAction: "HOLD" | "TIGHTEN_PROTECT" | "EXIT_INVALIDATED" | "NONE";
  breakoutLevel: number | null;
  supportResistance: {
    resistance: number;
    support: number;
  };
  evidenceChain: {
    structure: string;
    breakout: string;
    retest: string;
    flow: string;
    volume: string;
    oi: string;
    btcContext: string;
  };
  invalidationLevel: number;
  latestTransition: StateTransitionRecord | null;
}

export interface CandleData {
  time: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuyBase?: number;
  quoteVolume?: number;
  trades?: number;
}

export class DirectionStateEngine {
  public readonly symbol: string;
  public state: DirectionState = "UNKNOWN";
  public previousState: DirectionState = "UNKNOWN";

  public breakoutLevel: number | null = null;
  public supportLevel: number | null = null;
  public breakoutHappened: boolean = false;
  public retestHappened: boolean = false;
  public invalidationPrice: number = 0;

  private candleHistory: CandleData[] = [];
  public readonly transitionLog: StateTransitionRecord[] = [];

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  /**
   * Resets internal state for fresh backtesting or clean testing
   */
  public reset(): void {
    this.state = "UNKNOWN";
    this.previousState = "UNKNOWN";
    this.breakoutLevel = null;
    this.supportLevel = null;
    this.breakoutHappened = false;
    this.retestHappened = false;
    this.invalidationPrice = 0;
    this.candleHistory = [];
    this.transitionLog.length = 0;
  }

  /**
   * Evaluates the incoming candle strictly causally at T0 (Zero Look-Ahead Bias)
   */
  public processCandle(
    candle: CandleData,
    btcContext: { regime?: string; btc_chg?: number } = {},
    oiContext: { oiChg?: number } = {}
  ): DirectionDecision {
    this.candleHistory.push(candle);
    const n = this.candleHistory.length;

    // Minimum warmup period of 15 candles required to determine swing structure
    if (n < 15) {
      return this.buildDecision(candle.close, "Warmup phase: insufficient candles for structural swings.");
    }

    const closes = this.candleHistory.map(c => c.close);
    const highs = this.candleHistory.map(c => c.high);
    const lows = this.candleHistory.map(c => c.low);
    const volumes = this.candleHistory.map(c => c.volume);
    const curClose = candle.close;
    const curHigh = candle.high;
    const curLow = candle.low;
    const prevClose = closes[n - 2];
    const prevLow = lows[n - 2];
    const prevHigh = highs[n - 2];

    // Causal EMAs
    const calcEma = (period: number) => {
      const k = 2 / (period + 1);
      let val = closes[0];
      for (let i = 1; i < n; i++) val = closes[i] * k + val * (1 - k);
      return val;
    };
    const ema9 = calcEma(9);
    const ema21 = calcEma(21);
    const ema50 = calcEma(Math.min(50, n));

    // Orderflow metrics (Taker ratio & CVD)
    const takers = this.candleHistory.map(c => {
      const tb = c.takerBuyBase !== undefined ? c.takerBuyBase : c.volume * 0.5;
      return tb / (c.volume || 1);
    });
    const cvdDeltas = this.candleHistory.map(c => {
      const tb = c.takerBuyBase !== undefined ? c.takerBuyBase : c.volume * 0.5;
      return 2 * tb - c.volume;
    });

    const recentTaker5 = takers.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const recentCvdSum5 = cvdDeltas.slice(-5).reduce((a, b) => a + b, 0);

    // Volume baseline
    const avgVol15 = volumes.slice(-15).reduce((a, b) => a + b, 0) / 15;
    const rvol = candle.volume / (avgVol15 || 1);

    // Meaningful Swing Structure: Highs and Lows of previous 20 candles (excluding current)
    const windowStart = Math.max(0, n - 21);
    const swingHigh = Math.max(...highs.slice(windowStart, n - 1));
    const swingLow = Math.min(...lows.slice(windowStart, n - 1));

    // BTC Macro Context classification
    const btcRegime = btcContext.regime || "NEUTRAL";
    const btcChg = btcContext.btc_chg || 0;
    const isBtcCongruentLong = btcRegime.includes("BULL") || btcChg >= 0;
    const isBtcCongruentShort = btcRegime.includes("BEAR") || btcChg <= 0;

    // Helper to transition state and record immutable evidence log
    const transition = (
      newState: DirectionState,
      event: MarketLifecycleEvent,
      structure: StateTransitionRecord["structure"],
      breakout: boolean,
      retest: boolean,
      reason: string,
      level: number | null = null
    ) => {
      if (this.state === newState) return;

      const record: StateTransitionRecord = {
        symbol: this.symbol,
        timestamp: candle.time,
        previousState: this.state,
        newState,
        event,
        structure,
        breakout,
        retest,
        cvd: recentCvdSum5 > 0 ? "BULLISH" : recentCvdSum5 < 0 ? "BEARISH" : "NEUTRAL",
        takerFlow: recentTaker5 >= 0.51 ? "BUYING_DOMINANT" : recentTaker5 <= 0.49 ? "SELLING_DOMINANT" : "NEUTRAL",
        volume: rvol >= 1.2 ? "EXPANDING" : rvol >= 0.75 ? "NORMAL" : "DRY",
        oi: (oiContext.oiChg || 0) >= 0 ? "SUPPORTIVE" : "UNFAVORABLE",
        btcContext: newState.includes("LONG") 
          ? (isBtcCongruentLong ? "CONGRUENT" : "NON_CONTRADICTORY")
          : (isBtcCongruentShort ? "CONGRUENT" : "NON_CONTRADICTORY"),
        price: curClose,
        level,
        reason
      };

      this.transitionLog.push(record);
      this.previousState = this.state;
      this.state = newState;
    };

    // =========================================================================
    // STATE MACHINE TRANSITION LOGIC
    // =========================================================================
    switch (this.state) {
      case "UNKNOWN": {
        // --- 1. EVALUATE FORMING_LONG ---
        // A Higher Low is forming above recent swing low + price above EMA9 & EMA21 + Buyer Flow active
        const isHigherLow = curLow > swingLow && curClose > ema21 && prevClose <= curClose;
        const isBullishFlow = recentTaker5 > 0.505 && recentCvdSum5 > 0;
        const hasClearResistance = swingHigh > curClose;

        if (isHigherLow && isBullishFlow && curClose > ema9 && hasClearResistance) {
          this.breakoutLevel = swingHigh;
          this.breakoutHappened = false;
          this.retestHappened = false;
          this.invalidationPrice = swingLow;
          transition(
            "FORMING_LONG",
            "FORMING_STRUCTURE_EVENT",
            "HL_FORMING",
            false,
            false,
            `Higher Low established (${curLow.toFixed(4)} > ${swingLow.toFixed(4)}), reclaimed EMA21 with net positive CVD & Taker (${(recentTaker5 * 100).toFixed(1)}%). Target Breakout: ${swingHigh.toFixed(4)}`,
            swingHigh
          );
          break;
        }

        // --- 2. EVALUATE FORMING_SHORT ---
        // A Lower High is forming below recent swing high + price below EMA9 & EMA21 + Seller Flow active
        const isLowerHigh = curHigh < swingHigh && curClose < ema21 && prevClose >= curClose;
        const isBearishFlow = recentTaker5 < 0.495 && recentCvdSum5 < 0;
        const hasClearSupport = swingLow < curClose;

        if (isLowerHigh && isBearishFlow && curClose < ema9 && hasClearSupport) {
          this.supportLevel = swingLow;
          this.breakoutHappened = false;
          this.retestHappened = false;
          this.invalidationPrice = swingHigh;
          transition(
            "FORMING_SHORT",
            "FORMING_STRUCTURE_EVENT",
            "LH_FORMING",
            false,
            false,
            `Lower High established (${curHigh.toFixed(4)} < ${swingHigh.toFixed(4)}), lost EMA21 with net negative CVD & Seller Taker (${((1 - recentTaker5) * 100).toFixed(1)}%). Target Breakdown: ${swingLow.toFixed(4)}`,
            swingLow
          );
          break;
        }
        break;
      }

      case "FORMING_LONG": {
        const bl = this.breakoutLevel || swingHigh;

        // Invalidation: Price falls below structural invalidation level or breaks under EMA50
        if (curClose < (this.invalidationPrice || ema50) || curClose < ema50 * 0.998) {
          transition(
            "INVALIDATED_LONG",
            "INVALIDATION_EVENT",
            "CHOP",
            false,
            false,
            `Failed to form trend: Dropped below invalidation support (${(this.invalidationPrice).toFixed(4)}) and EMA50.`,
            bl
          );
          break;
        }

        // Breakout Check: Clean close above resistance level
        if (curClose > bl && curClose > prevClose) {
          this.breakoutHappened = true;
        }

        if (this.breakoutHappened) {
          // Retest Check: Price pulls back to broken level and holds above it
          const nearLevel = Math.abs(curLow - bl) / bl < 0.0035;
          const heldLevel = curClose >= bl * 0.999 && recentTaker5 >= 0.50;
          if (nearLevel && heldLevel) {
            this.retestHappened = true;
          }

          // Full Evidence Chain for CONFIRMED_LONG:
          // Breakout + Retest (or strong momentum expansion through level) + Buyer dominance + Volume participation
          const isMomentumExpanded = curClose > bl * 1.002 && curClose > ema9;
          const flowConfirmed = recentTaker5 >= 0.51 && recentCvdSum5 >= 0;
          const volumeConfirmed = rvol >= 0.80;

          if ((this.retestHappened || isMomentumExpanded) && flowConfirmed && volumeConfirmed) {
            this.invalidationPrice = bl * 0.997; // Tighten invalidation to just below former resistance
            transition(
              "CONFIRMED_LONG",
              "BREAKOUT_CONFIRMATION_EVENT",
              "BREAKOUT",
              true,
              this.retestHappened,
              `Confirmed Breakout & Hold above ${bl.toFixed(4)}. Retest: ${this.retestHappened}, Volume RVOL: ${rvol.toFixed(2)}x, Taker: ${(recentTaker5 * 100).toFixed(1)}%`,
              bl
            );
          }
        }
        break;
      }

      case "CONFIRMED_LONG": {
        const bl = this.breakoutLevel || swingHigh;

        // Invalidation: Price sinks back below breakout level by > 0.3%
        if (curClose < bl * 0.997 || curClose < ema50) {
          transition(
            "INVALIDATED_LONG",
            "INVALIDATION_EVENT",
            "CHOP",
            true,
            false,
            `Breakout failed: Price closed back below former resistance ${bl.toFixed(4)} and breached EMA50.`,
            bl
          );
          break;
        }

        // Extension: Price continues printing Higher Highs with intact flow
        if (curHigh > swingHigh && curClose > ema9 && recentTaker5 >= 0.50) {
          transition(
            "EXTENDING_LONG",
            "CONTINUATION_EVENT",
            "HH_HL",
            true,
            true,
            `Trend extending: New Higher High (${curHigh.toFixed(4)}) above swing high with steady buyer flow.`,
            curHigh
          );
          break;
        }

        // Weakening: Loss of EMA9, Taker buyers declining, CVD divergence
        if (curClose < ema9 && recentTaker5 < 0.48 && recentCvdSum5 < 0) {
          transition(
            "WEAKENING_LONG",
            "MOMENTUM_EXHAUSTION_EVENT",
            "CHOP",
            true,
            true,
            `Momentum weakening: Lost EMA9, Taker buying dropped to ${(recentTaker5 * 100).toFixed(1)}%, CVD momentum turned negative.`,
            curClose
          );
          break;
        }
        break;
      }

      case "EXTENDING_LONG": {
        const curTaker = (candle.takerBuyBase !== undefined ? candle.takerBuyBase : candle.volume * 0.5) / (candle.volume || 1);
        // Weakening: Price dips under EMA9 with seller dominance / lower low, or dips under EMA21
        if ((curClose < ema9 && (curTaker < 0.46 || recentTaker5 < 0.48 || curLow < prevLow)) || curClose < ema21) {
          transition(
            "WEAKENING_LONG",
            "EXHAUSTION_EVENT",
            "LH_FORMING",
            true,
            true,
            `Trend extension halted: Price closed below EMA9 with selling pressure (Taker: ${(curTaker * 100).toFixed(1)}%).`,
            curClose
          );
          break;
        }

        // Invalidation from extension
        if (curClose < ema50) {
          transition(
            "INVALIDATED_LONG",
            "INVALIDATION_EVENT",
            "CHOP",
            true,
            false,
            `Trend collapsed: Breached major baseline EMA50.`,
            curClose
          );
          break;
        }
        break;
      }

      case "WEAKENING_LONG": {
        // Recovery: Price reclaims EMA9 and breaks out to new High
        if (curClose > ema9 && curHigh > swingHigh && recentTaker5 > 0.52) {
          transition(
            "EXTENDING_LONG",
            "RECOVERY_EVENT",
            "HH_HL",
            true,
            true,
            `Recovery: Absorbed selling pressure, reclaimed EMA9 and broke to new high.`,
            curHigh
          );
          break;
        }

        // Final Invalidation: Fails to recover and drops below EMA21 / invalidation floor
        if (curClose < ema21 || curClose < (this.invalidationPrice || ema50)) {
          transition(
            "INVALIDATED_LONG",
            "INVALIDATION_EVENT",
            "CHOP",
            false,
            false,
            `Structural breakdown confirmed following weakening: Closed under EMA21. Trend thesis terminated.`,
            curClose
          );
          break;
        }
        break;
      }

      case "INVALIDATED_LONG": {
        // STRICT RULE #11 & #8: Reset directly to UNKNOWN. Never flip-flop directly into SHORT!
        transition(
          "UNKNOWN",
          "RESET_EVENT",
          "CHOP",
          false,
          false,
          `State cleared to UNKNOWN. Awaiting independent forming structure before any new evaluation.`,
          curClose
        );
        break;
      }

      // =======================================================================
      // SHORT SIDE (SYMMETRIC MIRROR)
      // =======================================================================
      case "FORMING_SHORT": {
        const sl = this.supportLevel || swingLow;

        // Invalidation: Price reclaims invalidation ceiling or crosses above EMA50
        if (curClose > (this.invalidationPrice || ema50) || curClose > ema50 * 1.002) {
          transition(
            "INVALIDATED_SHORT",
            "INVALIDATION_EVENT",
            "CHOP",
            false,
            false,
            `Failed to form downtrend: Reclaimed invalidation resistance (${(this.invalidationPrice).toFixed(4)}) and EMA50.`,
            sl
          );
          break;
        }

        // Breakdown Check: Clean close below support level
        if (curClose < sl && curClose < prevClose) {
          this.breakoutHappened = true;
        }

        if (this.breakoutHappened) {
          // Retest Check: Price pulls up to broken level and gets rejected
          const nearLevel = Math.abs(curHigh - sl) / sl < 0.0035;
          const heldLevel = curClose <= sl * 1.001 && recentTaker5 <= 0.50;
          if (nearLevel && heldLevel) {
            this.retestHappened = true;
          }

          const isMomentumExpanded = curClose < sl * 0.998 && curClose < ema9;
          const flowConfirmed = recentTaker5 <= 0.49 && recentCvdSum5 <= 0;
          const volumeConfirmed = rvol >= 0.80;

          if ((this.retestHappened || isMomentumExpanded) && flowConfirmed && volumeConfirmed) {
            this.invalidationPrice = sl * 1.003;
            transition(
              "CONFIRMED_SHORT",
              "BREAKDOWN_CONFIRMATION_EVENT",
              "BREAKDOWN",
              true,
              this.retestHappened,
              `Confirmed Breakdown & Resistance Hold at ${sl.toFixed(4)}. Retest: ${this.retestHappened}, Volume RVOL: ${rvol.toFixed(2)}x, Taker: ${(recentTaker5 * 100).toFixed(1)}%`,
              sl
            );
          }
        }
        break;
      }

      case "CONFIRMED_SHORT": {
        const sl = this.supportLevel || swingLow;

        if (curClose > sl * 1.003 || curClose > ema50) {
          transition(
            "INVALIDATED_SHORT",
            "INVALIDATION_EVENT",
            "CHOP",
            true,
            false,
            `Breakdown failed: Price reclaimed former support ${sl.toFixed(4)} and EMA50.`,
            sl
          );
          break;
        }

        if (curLow < swingLow && curClose < ema9 && recentTaker5 <= 0.50) {
          transition(
            "EXTENDING_SHORT",
            "CONTINUATION_EVENT",
            "LH_LL",
            true,
            true,
            `Downtrend extending: New Lower Low (${curLow.toFixed(4)}) below swing low with steady seller flow.`,
            curLow
          );
          break;
        }

        if (curClose > ema9 && recentTaker5 > 0.52 && recentCvdSum5 > 0) {
          transition(
            "WEAKENING_SHORT",
            "MOMENTUM_EXHAUSTION_EVENT",
            "CHOP",
            true,
            true,
            `Downward momentum weakening: Reclaimed EMA9, buyers stepping in (Taker: ${(recentTaker5 * 100).toFixed(1)}%), CVD turned positive.`,
            curClose
          );
          break;
        }
        break;
      }

      case "EXTENDING_SHORT": {
        const curTaker = (candle.takerBuyBase !== undefined ? candle.takerBuyBase : candle.volume * 0.5) / (candle.volume || 1);
        if ((curClose > ema9 && (curTaker > 0.54 || recentTaker5 > 0.52 || curHigh > prevHigh)) || curClose > ema21) {
          transition(
            "WEAKENING_SHORT",
            "EXHAUSTION_EVENT",
            "HL_FORMING",
            true,
            true,
            `Downtrend extension halted: Price crossed above EMA9 with aggressive buying (Taker: ${(curTaker * 100).toFixed(1)}%).`,
            curClose
          );
          break;
        }

        if (curClose > ema50) {
          transition(
            "INVALIDATED_SHORT",
            "INVALIDATION_EVENT",
            "CHOP",
            true,
            false,
            `Downtrend collapsed: Price broke above major EMA50 baseline.`,
            curClose
          );
          break;
        }
        break;
      }

      case "WEAKENING_SHORT": {
        if (curClose < ema9 && curLow < swingLow && recentTaker5 < 0.48) {
          transition(
            "EXTENDING_SHORT",
            "RECOVERY_EVENT",
            "LH_LL",
            true,
            true,
            `Downside recovery: Reclaimed downward momentum below EMA9 and printed lower low.`,
            curLow
          );
          break;
        }

        if (curClose > ema21 || curClose > (this.invalidationPrice || ema50)) {
          transition(
            "INVALIDATED_SHORT",
            "INVALIDATION_EVENT",
            "CHOP",
            false,
            false,
            `Structural breakdown of short thesis: Price crossed above EMA21. Short thesis terminated.`,
            curClose
          );
          break;
        }
        break;
      }

      case "INVALIDATED_SHORT": {
        // Reset strictly to UNKNOWN
        transition(
          "UNKNOWN",
          "RESET_EVENT",
          "CHOP",
          false,
          false,
          `State cleared to UNKNOWN. Awaiting independent forming structure before any new evaluation.`,
          curClose
        );
        break;
      }
    }

    return this.buildDecision(curClose, this.transitionLog.slice(-1)[0]?.reason || "State evaluated");
  }

  /**
   * Translates the current State Machine state into an actionable Direction Decision
   */
  private buildDecision(currentPrice: number, latestReason: string): DirectionDecision {
    const isLong = this.state.includes("LONG");
    const isShort = this.state.includes("SHORT");
    const dir: DirectionDecision["direction"] = isLong ? "LONG" : isShort ? "SHORT" : "UNKNOWN";

    let canEnter = false;
    let entryType: DirectionDecision["entryType"] = "NONE";
    let managementAction: DirectionDecision["managementAction"] = "NONE";

    if (this.state === "FORMING_LONG" || this.state === "FORMING_SHORT") {
      canEnter = true;
      entryType = "FORMING_EARLY";
      managementAction = "HOLD";
    } else if (this.state === "CONFIRMED_LONG" || this.state === "CONFIRMED_SHORT") {
      canEnter = true;
      entryType = "CONFIRMED_STANDARD";
      managementAction = "HOLD";
    } else if (this.state === "EXTENDING_LONG" || this.state === "EXTENDING_SHORT") {
      managementAction = "HOLD";
    } else if (this.state === "WEAKENING_LONG" || this.state === "WEAKENING_SHORT") {
      managementAction = "TIGHTEN_PROTECT";
    } else if (this.state === "INVALIDATED_LONG" || this.state === "INVALIDATED_SHORT") {
      managementAction = "EXIT_INVALIDATED";
    }

    const latest = this.transitionLog.length > 0 ? this.transitionLog[this.transitionLog.length - 1] : null;

    return {
      direction: dir,
      state: this.state,
      canEnter,
      entryType,
      managementAction,
      breakoutLevel: isLong ? this.breakoutLevel : this.supportLevel,
      supportResistance: {
        resistance: this.breakoutLevel || currentPrice * 1.01,
        support: this.supportLevel || currentPrice * 0.99
      },
      evidenceChain: {
        structure: latest?.structure || "UNKNOWN",
        breakout: latest?.breakout ? "CONFIRMED" : "PENDING",
        retest: latest?.retest ? "CONFIRMED" : "PENDING",
        flow: latest?.cvd || "NEUTRAL",
        volume: latest?.volume || "NORMAL",
        oi: latest?.oi || "NEUTRAL",
        btcContext: latest?.btcContext || "NON_CONTRADICTORY"
      },
      invalidationLevel: this.invalidationPrice || (isLong ? currentPrice * 0.985 : currentPrice * 1.015),
      latestTransition: latest
    };
  }
}
