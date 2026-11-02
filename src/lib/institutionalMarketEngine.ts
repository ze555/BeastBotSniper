/**
 * Institutional Market Engine
 *
 * Decision engine based on explicit evidence gates. There is deliberately no score,
 * weighted sum, ranking number, or inferred institutional identity.
 *
 * Exchange aggressor flow is derived from executed aggregate trades. Order-book
 * imbalance is contextual only because displayed liquidity can be cancelled.
 * Liquidation data is marked unavailable unless a genuine feed is supplied.
 */

export type Side = "LONG" | "SHORT";
export type MarketState =
  | "DORMANT"
  | "PRE_IGNITION"
  | "IGNITION"
  | "BREAKOUT_CONFIRMED"
  | "CONTINUATION"
  | "SQUEEZE_ONLY"
  | "EXHAUSTION_WARNING"
  | "REVERSAL_CONFIRMED"
  | "DATA_INSUFFICIENT"
  | "CONFLICTED";

export interface AggressorFlow {
  buyQuote: number;
  sellQuote: number;
  tradeCount: number;
  observedAt: number;
  source: "BINANCE_AGG_TRADES";
}

export interface OrderBookEvidence {
  bidNotional: number;
  askNotional: number;
  spreadBps: number;
  observedAt: number;
  source: "BINANCE_DEPTH";
}

export interface InstitutionalSnapshot {
  symbol: string;
  timestamp: number;
  price: number;
  candles: Array<{ openTime: number; open: number; high: number; low: number; close: number; volume: number; quoteVolume?: number }>;
  spotFlow: AggressorFlow | null;
  futuresFlow: AggressorFlow | null;
  orderBook: OrderBookEvidence | null;
  oiChange: number | null;
  fundingRate: number | null;
  btcChange: number | null;
  /** True only when the OI observation is recent and valid. */
  oiAvailable: boolean;
  previousState?: MarketState;
  previousDirection?: Side | "NONE";
}

export interface EvidenceDecision {
  symbol: string;
  state: MarketState;
  direction: Side | "NONE";
  canEnter: boolean;
  entryType: "EARLY_IGNITION" | "CONFIRMED_BREAKOUT" | "NONE";
  management: "HOLD" | "PROTECT" | "EXIT" | "NONE";
  evidenceFor: string[];
  evidenceAgainst: string[];
  missingEvidence: string[];
  dataQuality: {
    spotTrades: boolean;
    futuresTrades: boolean;
    orderBook: boolean;
    openInterest: boolean;
    funding: boolean;
    liquidationFeed: "UNAVAILABLE";
  };
  metrics: {
    spotDeltaQuote: number | null;
    futuresDeltaQuote: number | null;
    spotBuyShare: number | null;
    futuresBuyShare: number | null;
    relativeVolume: number | null;
    oiChange: number | null;
    fundingRate: number | null;
    bookImbalance: number | null;
    btcChange: number | null;
    breakoutLevel: number | null;
    invalidationLevel: number | null;
  };
  reason: string;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fresh = (at: number, now: number, maxAgeMs: number) => finite(at) && at <= now + 2_000 && now - at <= maxAgeMs;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function tradeFlowValid(flow: AggressorFlow | null, now: number): flow is AggressorFlow {
  return !!flow && flow.source === "BINANCE_AGG_TRADES" &&
    finite(flow.buyQuote) && finite(flow.sellQuote) &&
    flow.buyQuote >= 0 && flow.sellQuote >= 0 &&
    Number.isInteger(flow.tradeCount) && flow.tradeCount > 0 &&
    fresh(flow.observedAt, now, 15_000);
}

function bookValid(book: OrderBookEvidence | null, now: number): book is OrderBookEvidence {
  return !!book && book.source === "BINANCE_DEPTH" &&
    finite(book.bidNotional) && finite(book.askNotional) &&
    book.bidNotional >= 0 && book.askNotional >= 0 &&
    finite(book.spreadBps) && book.spreadBps >= 0 &&
    fresh(book.observedAt, now, 8_000);
}

export function evaluateInstitutionalMarket(input: InstitutionalSnapshot): EvidenceDecision {
  const now = input.timestamp;
  const candles = input.candles || [];
  const spotOk = tradeFlowValid(input.spotFlow, now);
  const futuresOk = tradeFlowValid(input.futuresFlow, now);
  const bookOk = bookValid(input.orderBook, now);
  const oiOk = input.oiAvailable && finite(input.oiChange);
  const fundingOk = finite(input.fundingRate);
  const validCandles = candles.length >= 22 && candles.slice(-22).every(c =>
    finite(c.high) && finite(c.low) && finite(c.close) && finite(c.volume) &&
    c.high >= c.low && c.volume >= 0
  );
  const empty = (state: MarketState, reason: string, missingEvidence: string[]): EvidenceDecision => ({
    symbol: input.symbol, state, direction: "NONE", canEnter: false, entryType: "NONE",
    management: "NONE", evidenceFor: [], evidenceAgainst: [], missingEvidence,
    dataQuality: { spotTrades: spotOk, futuresTrades: futuresOk, orderBook: bookOk, openInterest: oiOk, funding: fundingOk, liquidationFeed: "UNAVAILABLE" },
    metrics: {
      spotDeltaQuote: spotOk ? input.spotFlow!.buyQuote - input.spotFlow!.sellQuote : null,
      futuresDeltaQuote: futuresOk ? input.futuresFlow!.buyQuote - input.futuresFlow!.sellQuote : null,
      spotBuyShare: spotOk ? input.spotFlow!.buyQuote / Math.max(input.spotFlow!.buyQuote + input.spotFlow!.sellQuote, 1e-12) : null,
      futuresBuyShare: futuresOk ? input.futuresFlow!.buyQuote / Math.max(input.futuresFlow!.buyQuote + input.futuresFlow!.sellQuote, 1e-12) : null,
      relativeVolume: null, oiChange: oiOk ? input.oiChange : null, fundingRate: fundingOk ? input.fundingRate! : null,
      bookImbalance: bookOk ? (input.orderBook!.bidNotional - input.orderBook!.askNotional) / Math.max(input.orderBook!.bidNotional + input.orderBook!.askNotional, 1e-12) : null,
      btcChange: finite(input.btcChange) ? input.btcChange : null, breakoutLevel: null, invalidationLevel: null
    },
    reason
  });

  if (!validCandles || !finite(input.price) || input.price <= 0) {
    return empty("DATA_INSUFFICIENT", "Need 22 valid, closed market candles and a valid price.", ["valid 1m/5m candle history"]);
  }
  const missing: string[] = [];
  if (!spotOk) missing.push("fresh spot aggregate trades");
  if (!futuresOk) missing.push("fresh futures aggregate trades");
  if (!oiOk) missing.push("fresh open-interest change");
  if (!bookOk) missing.push("fresh order-book snapshot");
  if (!fundingOk) missing.push("valid funding rate");
  if (missing.includes("fresh spot aggregate trades") || missing.includes("fresh futures aggregate trades") || missing.includes("fresh open-interest change")) {
    return empty("DATA_INSUFFICIENT", "Critical independent flow/OI evidence is missing or stale; fail closed.", missing);
  }

  const closed = candles.slice(0, -1);
  const recent = candles[candles.length - 1];
  const baseline = closed.slice(-20);
  const avgQuoteVolume = sum(baseline.map(c => finite(c.quoteVolume) ? c.quoteVolume! : c.close * c.volume)) / baseline.length;
  const currentQuoteVolume = finite(recent.quoteVolume) ? recent.quoteVolume! : recent.close * recent.volume;
  const relativeVolume = avgQuoteVolume > 0 ? currentQuoteVolume / avgQuoteVolume : null;
  const priorHigh = Math.max(...closed.slice(-20).map(c => c.high));
  const priorLow = Math.min(...closed.slice(-20).map(c => c.low));
  const spotDelta = input.spotFlow!.buyQuote - input.spotFlow!.sellQuote;
  const futuresDelta = input.futuresFlow!.buyQuote - input.futuresFlow!.sellQuote;
  const spotTotal = input.spotFlow!.buyQuote + input.spotFlow!.sellQuote;
  const futuresTotal = input.futuresFlow!.buyQuote + input.futuresFlow!.sellQuote;
  const spotShare = spotTotal > 0 ? input.spotFlow!.buyQuote / spotTotal : 0.5;
  const futuresShare = futuresTotal > 0 ? input.futuresFlow!.buyQuote / futuresTotal : 0.5;
  const bookImbalance = bookOk
    ? (input.orderBook!.bidNotional - input.orderBook!.askNotional) / Math.max(input.orderBook!.bidNotional + input.orderBook!.askNotional, 1e-12)
    : null;
  const priceReturn = (recent.close - recent.open) / Math.max(recent.open, 1e-12);
  const oi = input.oiChange!;
  const evidenceFor: string[] = [];
  const evidenceAgainst: string[] = [];
  const btcAdverse = finite(input.btcChange) && Math.abs(input.btcChange) >= 0.004;
  const relativeStrengthLong = btcAdverse && input.btcChange! < 0 && priceReturn > 0;
  const relativeStrengthShort = btcAdverse && input.btcChange! > 0 && priceReturn < 0;

  const longSpot = spotShare >= 0.57 && spotDelta > 0;
  const shortSpot = spotShare <= 0.43 && spotDelta < 0;
  const longFutures = futuresShare >= 0.55 && futuresDelta > 0;
  const shortFutures = futuresShare <= 0.45 && futuresDelta < 0;
  const longOi = oi > 0.001;
  const shortOi = oi > 0.001;
  const oiFlatOrFalling = oi <= 0.001;
  const liquidityQualified = bookOk && input.orderBook!.spreadBps <= 15 &&
    input.orderBook!.bidNotional + input.orderBook!.askNotional >= 10_000;
  const longBook = liquidityQualified && bookImbalance !== null && bookImbalance >= 0.08;
  const shortBook = liquidityQualified && bookImbalance !== null && bookImbalance <= -0.08;
  const highParticipation = relativeVolume !== null && relativeVolume >= 1.35;
  const longBreakout = recent.close > priorHigh && recent.close > recent.open;
  const shortBreakdown = recent.close < priorLow && recent.close < recent.open;
  const longAcceptance = recent.close > priorHigh && recent.low >= priorHigh * 0.997;
  const shortAcceptance = recent.close < priorLow && recent.high <= priorLow * 1.003;
  const longSqueeze = priceReturn > 0.003 && oi < -0.002 && futuresDelta > 0;
  const shortSqueeze = priceReturn < -0.003 && oi < -0.002 && futuresDelta < 0;
  const longExhaustion = input.fundingRate !== null && input.fundingRate! > 0.0008 && futuresShare < 0.52 && spotShare < 0.52;
  const shortExhaustion = input.fundingRate !== null && input.fundingRate! < -0.0008 && futuresShare > 0.48 && spotShare > 0.48;

  const longFlow = longSpot && longFutures && longOi;
  const shortFlow = shortSpot && shortFutures && shortOi;
  const longIgnition = longFlow && highParticipation && (longBook || relativeStrengthLong);
  const shortIgnition = shortFlow && highParticipation && (shortBook || relativeStrengthShort);
  const longConfirmed = longIgnition && longAcceptance;
  const shortConfirmed = shortIgnition && shortAcceptance;

  if (longSpot) evidenceFor.push("Executed spot aggressor flow is buyer-dominant.");
  if (shortSpot) evidenceFor.push("Executed spot aggressor flow is seller-dominant.");
  if (longFutures) evidenceFor.push("Executed futures aggressor flow is buyer-dominant.");
  if (shortFutures) evidenceFor.push("Executed futures aggressor flow is seller-dominant.");
  if (longOi) evidenceFor.push("Open interest is expanding with the upward move.");
  if (shortOi) evidenceFor.push("Open interest is expanding with the downward move.");
  if (highParticipation) evidenceFor.push(`Closed-candle quote volume is ${relativeVolume!.toFixed(2)}x its 20-candle baseline.`);
  if (longBook) evidenceFor.push("Displayed bid depth exceeds ask depth; contextual only, not proof of executed demand.");
  if (shortBook) evidenceFor.push("Displayed ask depth exceeds bid depth; contextual only, not proof of executed supply.");
  if (relativeStrengthLong) evidenceFor.push("Asset is positive while BTC is materially negative (relative-strength decoupling).");
  if (relativeStrengthShort) evidenceFor.push("Asset is negative while BTC is materially positive (relative-weakness decoupling).");
  if (longSqueeze) evidenceAgainst.push("Upward move includes falling OI: short covering may be a major driver.");
  if (shortSqueeze) evidenceAgainst.push("Downward move includes falling OI: long liquidation may be a major driver.");
  if (longExhaustion) evidenceAgainst.push("Positive funding is crowded while spot/futures buy aggression is fading.");
  if (shortExhaustion) evidenceAgainst.push("Negative funding is crowded while sell aggression is fading.");
  if (spotShare > 0.55 && futuresShare < 0.48) evidenceAgainst.push("Spot and futures aggressor flows conflict.");
  if (spotShare < 0.45 && futuresShare > 0.52) evidenceAgainst.push("Spot and futures aggressor flows conflict.");

  let state: MarketState = "DORMANT";
  let direction: Side | "NONE" = "NONE";
  let canEnter = false;
  let entryType: EvidenceDecision["entryType"] = "NONE";
  let reason = "No complete institutional ignition chain is present.";
  if ((longSqueeze && !longSpot) || (shortSqueeze && !shortSpot)) {
    state = "SQUEEZE_ONLY";
    reason = "Price expansion is accompanied by declining OI and lacks confirming spot participation.";
  } else if (longConfirmed) {
    state = "BREAKOUT_CONFIRMED"; direction = "LONG"; canEnter = true; entryType = "CONFIRMED_BREAKOUT";
    reason = "Spot and futures aggression, expanding OI, participation and post-breakout acceptance align.";
  } else if (shortConfirmed) {
    state = input.previousDirection === "LONG" ? "REVERSAL_CONFIRMED" : "BREAKOUT_CONFIRMED";
    direction = "SHORT"; canEnter = true; entryType = "CONFIRMED_BREAKOUT";
    reason = "Spot and futures selling, expanding OI, participation and post-breakdown acceptance align.";
  } else if (longIgnition && longBreakout) {
    state = "IGNITION"; direction = "LONG"; canEnter = true; entryType = "EARLY_IGNITION";
    reason = "Fresh breakout with spot/futures buying and OI expansion; acceptance is not yet established.";
  } else if (shortIgnition && shortBreakdown) {
    state = "IGNITION"; direction = "SHORT"; canEnter = true; entryType = "EARLY_IGNITION";
    reason = "Fresh breakdown with spot/futures selling and OI expansion; acceptance is not yet established.";
  } else if ((input.previousState === "BREAKOUT_CONFIRMED" || input.previousState === "CONTINUATION") &&
      input.previousDirection === "LONG" && longFlow && recent.close >= priorHigh * 0.995 && !longExhaustion) {
    state = "CONTINUATION"; direction = "LONG";
    reason = "Previously confirmed bullish structure remains accepted with spot/futures flow still aligned.";
  } else if ((input.previousState === "BREAKOUT_CONFIRMED" || input.previousState === "CONTINUATION") &&
      input.previousDirection === "SHORT" && shortFlow && recent.close <= priorLow * 1.005 && !shortExhaustion) {
    state = "CONTINUATION"; direction = "SHORT";
    reason = "Previously confirmed bearish structure remains accepted with spot/futures flow still aligned.";
  } else if (longSpot && longFutures && (highParticipation || longBook)) {
    state = "PRE_IGNITION"; direction = "LONG";
    reason = "Buy-side flow is developing before a confirmed structural break.";
  } else if (shortSpot && shortFutures && (highParticipation || shortBook)) {
    state = "PRE_IGNITION"; direction = "SHORT";
    reason = "Sell-side flow is developing before a confirmed structural break.";
  } else if (longExhaustion || shortExhaustion) {
    state = "EXHAUSTION_WARNING"; reason = "Crowded funding and weakening aggressor participation indicate elevated exhaustion risk.";
  } else if ((spotShare >= 0.57 && futuresShare <= 0.45) || (spotShare <= 0.43 && futuresShare >= 0.55)) {
    state = "CONFLICTED"; reason = "Spot and futures aggressor flows materially disagree; no entry.";
  }

  if (longBreakout && !longFlow) evidenceAgainst.push("Upward structural break lacks the full spot/futures/OI confirmation chain.");
  if (shortBreakdown && !shortFlow) evidenceAgainst.push("Downward structural break lacks the full spot/futures/OI confirmation chain.");
  if (direction === "LONG" && longSqueeze) { canEnter = false; entryType = "NONE"; state = "SQUEEZE_ONLY"; direction = "NONE"; reason = "Squeeze-only move is not eligible for a new long entry."; }
  if (direction === "SHORT" && shortSqueeze) { canEnter = false; entryType = "NONE"; state = "SQUEEZE_ONLY"; direction = "NONE"; reason = "Liquidation-led move is not eligible for a new short entry."; }

  return {
    symbol: input.symbol, state, direction, canEnter, entryType, management: "NONE",
    evidenceFor, evidenceAgainst, missingEvidence: !bookOk ? ["fresh order-book snapshot (context only)"] :
      !liquidityQualified ? ["minimum executable depth of 10,000 USDT and spread <= 15 bps"] : [],
    dataQuality: { spotTrades: spotOk, futuresTrades: futuresOk, orderBook: bookOk, openInterest: oiOk, funding: fundingOk, liquidationFeed: "UNAVAILABLE" },
    metrics: {
      spotDeltaQuote: spotDelta, futuresDeltaQuote: futuresDelta, spotBuyShare: spotShare,
      futuresBuyShare: futuresShare, relativeVolume, oiChange: oi, fundingRate: fundingOk ? input.fundingRate! : null,
      bookImbalance, btcChange: finite(input.btcChange) ? input.btcChange : null,
      breakoutLevel: direction === "LONG" ? priorHigh : direction === "SHORT" ? priorLow : null,
      invalidationLevel: direction === "LONG" ? recent.low : direction === "SHORT" ? recent.high : null
    },
    reason
  };
}

export interface ExitSnapshot {
  direction: Side;
  price: number;
  entry: number;
  stop: number;
  spotFlow: AggressorFlow | null;
  futuresFlow: AggressorFlow | null;
  structureInvalidated: boolean;
  fundingRate: number | null;
  timestamp: number;
}

/** Exit only on a structural break plus aligned executed flow; warnings merely protect. */
export function evaluateInstitutionalExit(input: ExitSnapshot): { action: "HOLD" | "PROTECT" | "EXIT"; reasons: string[] } {
  const spotOk = tradeFlowValid(input.spotFlow, input.timestamp);
  const futuresOk = tradeFlowValid(input.futuresFlow, input.timestamp);
  if (!spotOk || !futuresOk) return { action: "HOLD", reasons: ["Fresh executed spot and futures trade flow unavailable; retain hard stop and do not fabricate an exit signal."] };
  const spotDelta = input.spotFlow.buyQuote - input.spotFlow.sellQuote;
  const futuresDelta = input.futuresFlow.buyQuote - input.futuresFlow.sellQuote;
  const adverseSpot = input.direction === "LONG" ? spotDelta < 0 : spotDelta > 0;
  const adverseFutures = input.direction === "LONG" ? futuresDelta < 0 : futuresDelta > 0;
  const adversePrice = input.direction === "LONG" ? input.price < input.entry : input.price > input.entry;
  const reasons: string[] = [];
  if (adverseSpot) reasons.push("Executed spot aggressor flow is against the position.");
  if (adverseFutures) reasons.push("Executed futures aggressor flow is against the position.");
  if (input.structureInvalidated) reasons.push("Post-entry market structure invalidated.");
  if (adversePrice) reasons.push("Position is in adverse territory.");
  if (input.structureInvalidated && adverseSpot && adverseFutures && adversePrice) return { action: "EXIT", reasons };
  if ((adverseSpot && adverseFutures) || (input.structureInvalidated && (adverseSpot || adverseFutures))) return { action: "PROTECT", reasons };
  return { action: "HOLD", reasons };
}
