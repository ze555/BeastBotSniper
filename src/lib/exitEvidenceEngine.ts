export type ManagedSide = "LONG" | "SHORT";
export type ExitManagementAction = "HOLD" | "PROTECT" | "EXIT";

export interface ExitEvidenceInput {
  direction: ManagedSide;
  /** Percentage change over the current 15m observation window, e.g. -0.002 = -0.2%. */
  priceChangePct: number;
  oiChangePct: number;
  /** Explicitly false when the OI endpoint is missing, stale, or malformed. */
  oiAvailable: boolean;
  cvd5: number;
  cvd15: number;
  cvd4h: number;
  /** Taker buy share from 0 to 1. */
  takerRatio: number;
  structureBroken: boolean;
  hiddenFlowAgainst: boolean;
  opposingRegime: boolean;
}

export interface ExitEvidenceDecision {
  action: ExitManagementAction;
  score: number;
  maxScore: 9;
  reasons: string[];
  dataQuality: {
    oiAvailable: boolean;
    multiTimeframeCvdAvailable: boolean;
    takerAvailable: boolean;
  };
}

/**
 * Conservative exit confirmation for open trades.
 * It never replaces a hard stop or a take-profit rule; it only governs discretionary early exits.
 * CVD inputs are candle taker-flow proxies, not exchange-wide institutional flow.
 */
export function evaluateExitEvidence(input: ExitEvidenceInput): ExitEvidenceDecision {
  const finite = (value: number) => Number.isFinite(value);
  const oiAvailable = input.oiAvailable && finite(input.oiChangePct);
  const cvdAvailable = finite(input.cvd5) && finite(input.cvd15) && finite(input.cvd4h);
  const takerAvailable = finite(input.takerRatio) && input.takerRatio >= 0 && input.takerRatio <= 1;

  const adversePrice = input.direction === "LONG"
    ? input.priceChangePct <= -0.001
    : input.priceChangePct >= 0.001;
  const adverseCvd5m15m = input.direction === "LONG"
    ? input.cvd5 < 0 && input.cvd15 < 0
    : input.cvd5 > 0 && input.cvd15 > 0;
  const adverseCvd4h = input.direction === "LONG"
    ? input.cvd4h < 0
    : input.cvd4h > 0;
  const adverseTaker = takerAvailable && (input.direction === "LONG"
    ? input.takerRatio < 0.47
    : input.takerRatio > 0.53);
  // Falling OI can indicate liquidation/covering; rising OI with adverse price can indicate new
  // opposing positioning. Either is counted only when the OI observation itself is valid.
  const adverseOi = oiAvailable && adversePrice && Math.abs(input.oiChangePct) >= 0.002;
  const adverseHiddenFlow = input.hiddenFlowAgainst === true;
  const adverseRegime = input.opposingRegime === true;
  const reasons: string[] = [];
  let score = 0;

  if (input.structureBroken) { score += 2; reasons.push("price structure/EMA21 broken"); }
  if (adverseCvd5m15m && cvdAvailable) { score += 2; reasons.push("5m and 15m CVD proxies aligned against trade"); }
  if (adverseCvd4h && cvdAvailable) { score += 1; reasons.push("4h CVD proxy confirms adverse direction"); }
  if (adverseTaker) { score += 1; reasons.push("taker aggression against trade"); }
  if (adverseOi) { score += 1; reasons.push("valid OI change confirms adverse price expansion"); }
  if (adverseHiddenFlow) { score += 1; reasons.push("flow/price divergence against trade"); }
  if (adverseRegime) { score += 1; reasons.push("broader market regime conflicts with position"); }

  // EXIT needs a real multi-signal chain; structure or a single indicator alone cannot trigger it.
  const exitConfirmed = (input.structureBroken && adverseCvd5m15m && adverseTaker &&
    (adverseOi || adverseCvd4h || adverseHiddenFlow)) ||
    (score >= 6 && adverseCvd5m15m && adverseTaker);

  return {
    action: exitConfirmed ? "EXIT" : score >= 3 ? "PROTECT" : "HOLD",
    score,
    maxScore: 8,
    reasons,
    dataQuality: {
      oiAvailable,
      multiTimeframeCvdAvailable: cvdAvailable,
      takerAvailable
    }
  };
}
