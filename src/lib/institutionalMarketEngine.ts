/**
 * Futures-only violent-wave engine.
 * Spot is deliberately excluded from every entry and exit decision.
 * The engine seeks early, executable volatility expansions rather than ordinary trends.
 */
export type Side = "LONG" | "SHORT";
export type MarketState =
  | "DORMANT" | "PRE_IGNITION" | "IGNITION" | "BREAKOUT_CONFIRMED"
  | "CONTINUATION" | "SQUEEZE_ONLY" | "EXHAUSTION_WARNING"
  | "REVERSAL_CONFIRMED" | "DATA_INSUFFICIENT" | "CONFLICTED";

export interface AggressorFlow {
  buyQuote: number;
  sellQuote: number;
  tradeCount: number;
  observedAt: number;
  source: "BINANCE_AGG_TRADES";
  /** Optional rolling-window fields supplied by live collectors. */
  buyQuote5s?: number;
  sellQuote5s?: number;
  trades5s?: number;
  buyQuote30s?: number;
  sellQuote30s?: number;
  trades30s?: number;
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
  futuresFlow: AggressorFlow | null;
  orderBook: OrderBookEvidence | null;
  oiChange: number | null;
  fundingRate: number | null;
  btcChange: number | null;
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
    spotTrades: false;
    futuresTrades: boolean;
    orderBook: boolean;
    openInterest: boolean;
    funding: boolean;
    liquidationFeed: "UNAVAILABLE";
  };
  metrics: {
    spotDeltaQuote: null;
    futuresDeltaQuote: number | null;
    spotBuyShare: null;
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
    finite(flow.buyQuote) && finite(flow.sellQuote) && flow.buyQuote >= 0 && flow.sellQuote >= 0 &&
    Number.isInteger(flow.tradeCount) && flow.tradeCount >= 5 &&
    fresh(flow.observedAt, now, 30_000);
}
function bookValid(book: OrderBookEvidence | null, now: number): book is OrderBookEvidence {
  return !!book && book.source === "BINANCE_DEPTH" && finite(book.bidNotional) && finite(book.askNotional) &&
    book.bidNotional >= 0 && book.askNotional >= 0 && finite(book.spreadBps) && book.spreadBps >= 0 &&
    fresh(book.observedAt, now, 8_000);
}
export function evaluateInstitutionalMarket(input: InstitutionalSnapshot): EvidenceDecision {
  const now = input.timestamp;
  const candles = input.candles || [];
  const futuresOk = tradeFlowValid(input.futuresFlow, now);
  const bookOk = bookValid(input.orderBook, now);
  const oiOk = input.oiAvailable && finite(input.oiChange);
  const fundingOk = finite(input.fundingRate);
  const validCandles = candles.length >= 9 && candles.slice(-9).every(c =>
    finite(c.high) && finite(c.low) && finite(c.close) && finite(c.open) &&
    finite(c.volume) && c.high >= c.low && c.volume >= 0 && c.close > 0
  );
  const empty = (state: MarketState, reason: string, missingEvidence: string[]): EvidenceDecision => ({
    symbol: input.symbol, state, direction: "NONE", canEnter: false, entryType: "NONE",
    management: "NONE", evidenceFor: [], evidenceAgainst: [], missingEvidence,
    dataQuality: { spotTrades: false, futuresTrades: futuresOk, orderBook: bookOk, openInterest: oiOk, funding: fundingOk, liquidationFeed: "UNAVAILABLE" },
    metrics: {
      spotDeltaQuote: null,
      futuresDeltaQuote: futuresOk ? input.futuresFlow!.buyQuote - input.futuresFlow!.sellQuote : null,
      spotBuyShare: null,
      futuresBuyShare: futuresOk ? input.futuresFlow!.buyQuote / Math.max(input.futuresFlow!.buyQuote + input.futuresFlow!.sellQuote, 1e-12) : null,
      relativeVolume: null, oiChange: oiOk ? input.oiChange : null,
      fundingRate: fundingOk ? input.fundingRate! : null,
      bookImbalance: bookOk ? (input.orderBook!.bidNotional - input.orderBook!.askNotional) / Math.max(input.orderBook!.bidNotional + input.orderBook!.askNotional, 1e-12) : null,
      btcChange: finite(input.btcChange) ? input.btcChange : null, breakoutLevel: null, invalidationLevel: null
    },
    reason
  });
  if (!validCandles || !finite(input.price) || input.price <= 0) {
    return empty("DATA_INSUFFICIENT", "Need at least 9 valid recent Futures candles and a valid mark/last price.", ["recent Futures candle history"]);
  }
  if (!futuresOk) return empty("DATA_INSUFFICIENT", "Fresh executed Futures aggressor flow is mandatory; Spot is not consulted.", ["fresh Binance USDT-M Futures aggregate trades"]);

  const closed = candles.slice(0, -1);
  const recent = candles[candles.length - 1];
  const baseline = closed.slice(-8);
  const avgQuoteVolume = sum(baseline.map(c => finite(c.quoteVolume) ? c.quoteVolume! : c.close * c.volume)) / Math.max(baseline.length, 1);
  const currentQuoteVolume = finite(recent.quoteVolume) ? recent.quoteVolume! : recent.close * recent.volume;
  const relativeVolume = avgQuoteVolume > 0 ? currentQuoteVolume / avgQuoteVolume : null;
  const priorHigh = Math.max(...closed.slice(-8).map(c => c.high));
  const priorLow = Math.min(...closed.slice(-8).map(c => c.low));
  const flow = input.futuresFlow!;
  const buy = flow.buyQuote, sell = flow.sellQuote, total = buy + sell;
  const buyShare = total > 0 ? buy / total : 0.5;
  const delta = buy - sell;
  const bookImbalance = bookOk ? (input.orderBook!.bidNotional - input.orderBook!.askNotional) / Math.max(input.orderBook!.bidNotional + input.orderBook!.askNotional, 1e-12) : null;
  const priceReturn = (recent.close - recent.open) / Math.max(recent.open, 1e-12);
  const oi = oiOk ? input.oiChange! : null;
  const liquidityQualified = bookOk && input.orderBook!.spreadBps <= 20 &&
    input.orderBook!.bidNotional + input.orderBook!.askNotional >= 10_000;
  const longFlow = buyShare >= 0.60 && delta > 0 && total >= 5_000;
  const shortFlow = buyShare <= 0.40 && delta < 0 && total >= 5_000;
  const volumeSurge = relativeVolume !== null && relativeVolume >= 1.40;
  const fastLongFlow = finite(flow.trades5s) && flow.trades5s! >= 3 &&
    finite(flow.buyQuote5s) && finite(flow.sellQuote5s) && flow.buyQuote5s! > flow.sellQuote5s! * 1.8;
  const fastShortFlow = finite(flow.trades5s) && flow.trades5s! >= 3 &&
    finite(flow.buyQuote5s) && finite(flow.sellQuote5s) && flow.sellQuote5s! > flow.buyQuote5s! * 1.8;
  const fastFlow = fastLongFlow || fastShortFlow;
  const longBreak = recent.close > priorHigh || (priceReturn >= 0.003 && recent.close > recent.open);
  const shortBreak = recent.close < priorLow || (priceReturn <= -0.003 && recent.close < recent.open);
  const compressedBefore = (() => {
    const ranges = closed.slice(-6).map(c => (c.high - c.low) / Math.max(c.open, 1e-12));
    if (ranges.length < 5) return false;
    const sorted = [...ranges].sort((a,b)=>a-b);
    return sorted[Math.floor(sorted.length * 0.6)] < 0.012;
  })();
  const oiExpandingWithMove = oi !== null && oi > 0.001;
  const oiContracting = oi !== null && oi < -0.002;
  const longSqueeze = oiContracting && longFlow;
  const shortLiquidation = oiContracting && shortFlow;
  const longExhaustion = fundingOk && input.fundingRate! > 0.0015 && buyShare < 0.53;
  const shortExhaustion = fundingOk && input.fundingRate! < -0.0015 && buyShare > 0.47;

  const evidenceFor: string[] = [];
  const evidenceAgainst: string[] = [];
  if (longFlow) evidenceFor.push("Futures executed buyers dominate with material quote flow.");
  if (shortFlow) evidenceFor.push("Futures executed sellers dominate with material quote flow.");
  if (volumeSurge) evidenceFor.push(`Futures candle quote volume is ${relativeVolume!.toFixed(2)}x its recent baseline.`);
  if (fastFlow) evidenceFor.push("Very short-window Futures trade flow is accelerating.");
  if (oiExpandingWithMove) evidenceFor.push("Open interest is expanding; new leveraged positions are entering.");
  if (longSqueeze) evidenceFor.push("Price/flow indicate an upward short-squeeze impulse while open interest contracts.");
  if (shortLiquidation) evidenceFor.push("Price/flow indicate a downward long-liquidation impulse while open interest contracts.");
  if (bookOk && bookImbalance !== null && bookImbalance > 0.12) evidenceFor.push("Displayed bid depth is supportive (context only).");
  if (bookOk && bookImbalance !== null && bookImbalance < -0.12) evidenceFor.push("Displayed ask depth is supportive (context only).");
  if (longExhaustion) evidenceAgainst.push("Crowded positive funding and fading buyer aggression warn of long exhaustion.");
  if (shortExhaustion) evidenceAgainst.push("Crowded negative funding and fading seller aggression warn of short exhaustion.");
  if (!oiOk) evidenceAgainst.push("Open-interest evidence is unavailable; direction is based on executed Futures flow and price/volume only.");
  if (bookOk && !liquidityQualified) evidenceAgainst.push("Spread/depth is not executable enough for a new position.");

  let state: MarketState = "DORMANT", direction: Side | "NONE" = "NONE";
  let canEnter = false, entryType: EvidenceDecision["entryType"] = "NONE";
  let reason = "No violent Futures impulse is developing; quiet symbols remain dormant.";
  const executable = bookOk && liquidityQualified;
  const longEarly = longFlow && executable && (volumeSurge || fastLongFlow || (longBreak && total >= 15_000)) && (longBreak || (compressedBefore && priceReturn > 0.001));
  const shortEarly = shortFlow && executable && (volumeSurge || fastShortFlow || (shortBreak && total >= 15_000)) && (shortBreak || (compressedBefore && priceReturn < -0.001));
  const longConfirmed = longEarly && (recent.close > priorHigh || priceReturn > 0.006);
  const shortConfirmed = shortEarly && (recent.close < priorLow || priceReturn < -0.006);

  if ((input.previousState === "BREAKOUT_CONFIRMED" || input.previousState === "CONTINUATION") &&
      input.previousDirection === "LONG" && longFlow && !longExhaustion) {
    state = "CONTINUATION"; direction = "LONG"; reason = "Bullish Futures impulse remains active; manage the existing wave, do not chase a fresh entry.";
  } else if ((input.previousState === "BREAKOUT_CONFIRMED" || input.previousState === "CONTINUATION") &&
      input.previousDirection === "SHORT" && shortFlow && !shortExhaustion) {
    state = "CONTINUATION"; direction = "SHORT"; reason = "Bearish Futures impulse remains active; manage the existing wave, do not chase a fresh entry.";
  } else if (longEarly && !longExhaustion) {
    state = longConfirmed ? "BREAKOUT_CONFIRMED" : "IGNITION";
    direction = "LONG"; canEnter = true;
    entryType = longConfirmed ? "CONFIRMED_BREAKOUT" : "EARLY_IGNITION";
    reason = longSqueeze
      ? "Early upward squeeze ignition: executed Futures buyers and volatility expansion align before the full move."
      : "Early upward ignition: Futures buyer aggression plus abnormal participation/short-window acceleration; no Spot confirmation required.";
  } else if (shortEarly && !shortExhaustion) {
    state = shortConfirmed ? "BREAKOUT_CONFIRMED" : "IGNITION";
    direction = "SHORT"; canEnter = true;
    entryType = shortConfirmed ? "CONFIRMED_BREAKOUT" : "EARLY_IGNITION";
    reason = shortLiquidation
      ? "Early downside liquidation ignition: executed Futures sellers and volatility expansion align before the full move."
      : "Early downside ignition: Futures seller aggression plus abnormal participation/short-window acceleration; no Spot confirmation required.";
  } else if ((longFlow || shortFlow) && (volumeSurge || fastFlow || compressedBefore)) {
    state = "PRE_IGNITION";
    direction = longFlow ? "LONG" : "SHORT";
    reason = "A directional Futures pressure build is forming; keep on the violent-wave watchlist, but entry trigger is not complete.";
  } else if (longExhaustion || shortExhaustion) {
    state = "EXHAUSTION_WARNING"; reason = "Funding crowding and weakening Futures aggression indicate exhaustion risk.";
  } else if (longFlow && shortFlow) {
    state = "CONFLICTED"; reason = "Contradictory Futures evidence; no entry.";
  }

  return {
    symbol: input.symbol, state, direction, canEnter, entryType, management: "NONE",
    evidenceFor, evidenceAgainst,
    missingEvidence: [
      ...(!oiOk ? ["open-interest history (context, not an entry blocker)"] : []),
      ...(!bookOk ? ["order-book snapshot (optional context; execution spread/depth should be checked before order placement)"] : [])
    ],
    dataQuality: { spotTrades: false, futuresTrades: futuresOk, orderBook: bookOk, openInterest: oiOk, funding: fundingOk, liquidationFeed: "UNAVAILABLE" },
    metrics: {
      spotDeltaQuote: null, futuresDeltaQuote: delta, spotBuyShare: null, futuresBuyShare: buyShare,
      relativeVolume, oiChange: oi, fundingRate: fundingOk ? input.fundingRate! : null,
      bookImbalance, btcChange: finite(input.btcChange) ? input.btcChange : null,
      breakoutLevel: direction === "LONG" ? priorHigh : direction === "SHORT" ? priorLow : null,
      invalidationLevel: direction === "LONG" ? Math.min(recent.low, priorHigh) : direction === "SHORT" ? Math.max(recent.high, priorLow) : null
    },
    reason
  };
}

export interface ExitSnapshot {
  direction: Side; price: number; entry: number; stop: number;
  futuresFlow: AggressorFlow | null;
  structureInvalidated: boolean; fundingRate: number | null; timestamp: number;
}
/** Futures-only exit: spot data is never required or consulted. */
export function evaluateInstitutionalExit(input: ExitSnapshot): { action: "HOLD" | "PROTECT" | "EXIT"; reasons: string[] } {
  const flow = tradeFlowValid(input.futuresFlow, input.timestamp) ? input.futuresFlow : null;
  if (!flow) return { action: "HOLD", reasons: ["Fresh executed Futures flow unavailable; retain the hard stop and do not fabricate an exit signal."] };
  const delta = flow.buyQuote - flow.sellQuote;
  const adverseFlow = input.direction === "LONG" ? delta < 0 : delta > 0;
  const adversePrice = input.direction === "LONG" ? input.price < input.entry : input.price > input.entry;
  const reasons: string[] = [];
  if (adverseFlow) reasons.push("Executed Futures aggressor flow is against the position.");
  if (input.structureInvalidated) reasons.push("Post-entry market structure invalidated.");
  if (adversePrice) reasons.push("Position is in adverse territory.");
  if (input.structureInvalidated && adverseFlow && adversePrice) return { action: "EXIT", reasons };
  if (adverseFlow || (input.structureInvalidated && adversePrice)) return { action: "PROTECT", reasons };
  return { action: "HOLD", reasons };
}
