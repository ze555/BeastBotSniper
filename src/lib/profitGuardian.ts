/**
 * Single exit decision engine for the replacement strategy.
 *
 * Prototype configuration from the Binance / Railway discussion:
 * arm at +0.50R and trail by 0.20R from the highest observed mark.
 * IMPORTANT: this parameter set lost money in the prior 90-day research replay.
 * Kept isolated from live deployment until independent validation.
 *
 * Stop execution is evaluated at the observed price, NOT at the desired stop,
 * so gap/slippage effects remain visible in execution PnL.
 */
export type GuardianSide = "LONG" | "SHORT";
export type GuardianAction = "HOLD" | "EXIT";
export type GuardianReason = "BEFORE_ACTIVATION" | "TRAIL_ARMED" | "STOP_CROSSED" | "INVALID_INPUT";

export const PROFIT_GUARDIAN_ACTIVATION_R = 0.50;
export const PROFIT_GUARDIAN_TRAIL_R = 0.20;

export interface GuardianInput {
   direction: GuardianSide;
   entry: number;
   price: number;
   initialStop: number;
   currentStop: number;
   peakR: number;
}

export interface GuardianDecision {
   action: GuardianAction;
   reason: GuardianReason;
   currentR: number;
   peakR: number;
   stop: number;
   armed: boolean;
}

export function evaluateProfitGuardian(input: GuardianInput): GuardianDecision {
   const { direction, entry, price, initialStop, currentStop, peakR } = input;
   const sign = direction === "LONG" ? 1 : -1;
   const risk = Math.abs(entry - initialStop);
   const valid = (direction === "LONG" || direction === "SHORT")
      && [entry, price, initialStop, currentStop, peakR].every(Number.isFinite)
      && entry > 0 && price > 0 && initialStop > 0 && currentStop > 0 && risk > 0
      && (direction === "LONG" ? initialStop < entry : initialStop > entry);

   if (!valid) {
      return { action: "HOLD", reason: "INVALID_INPUT", currentR: 0,
         peakR: Number.isFinite(peakR) ? peakR : 0, stop: currentStop, armed: false };
   }

   const currentR = sign * (price - entry) / risk;
   const nextPeak = Math.max(0, peakR, currentR);
   const armed = nextPeak >= PROFIT_GUARDIAN_ACTIVATION_R;
   // Never loosen the original stop or a previously raised stop.
   let stop = sign === 1 ? Math.max(initialStop, currentStop) : Math.min(initialStop, currentStop);
   if (armed) {
      const trailAt = entry + sign * (nextPeak - PROFIT_GUARDIAN_TRAIL_R) * risk;
      stop = sign === 1 ? Math.max(stop, trailAt) : Math.min(stop, trailAt);
   }

   // Quote observation is not a guaranteed stop fill; the caller prices the
   // close with the observed quote and realistic costs.
   const crossed = sign === 1 ? price <= stop : price >= stop;
   return {
      action: crossed ? "EXIT" : "HOLD",
      reason: crossed ? "STOP_CROSSED" : armed ? "TRAIL_ARMED" : "BEFORE_ACTIVATION",
      currentR,
      peakR: nextPeak,
      stop,
      armed
   };
}
