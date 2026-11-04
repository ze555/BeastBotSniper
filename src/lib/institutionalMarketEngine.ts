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
  buyQuote1m?: number; sellQuote1m?: number; trades1m?: number;
  buyQuote5m?: number; sellQuote5m?: number; trades5m?: number;
  priceChange30sPct?: number | null; priceChange1mPct?: number | null; priceChange5mPct?: number | null;
}
export interface LiquidationFlowEvidence {
  longLiquidationQuote: number; shortLiquidationQuote: number; eventCount: number;
  observedAt: number; source: "BINANCE_FORCE_ORDER";
}
export interface OrderBookEvidence {
  bidNotional: number;
  askNotional: number;
  spreadBps: number;
  /** Sampled REST snapshot deltas; not exchange depth-diff events. */
  bidDepthChangePct?: number | null;
  askDepthChangePct?: number | null;
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
  liquidationFlow?: LiquidationFlowEvidence | null;
  liquidationFeedConnected?: boolean;
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
    liquidationFeed: "OBSERVED" | "NO_RECENT_EVENTS" | "UNAVAILABLE";
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
    sampledBidDepthChangePct: number | null;
    sampledAskDepthChangePct: number | null;
    longLiquidationQuote: number | null;
    shortLiquidationQuote: number | null;
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
function liquidationValid(flow: LiquidationFlowEvidence | null | undefined, now: number): flow is LiquidationFlowEvidence {
  return !!flow && flow.source === "BINANCE_FORCE_ORDER" &&
    finite(flow.longLiquidationQuote) && flow.longLiquidationQuote >= 0 &&
    finite(flow.shortLiquidationQuote) && flow.shortLiquidationQuote >= 0 &&
    Number.isInteger(flow.eventCount) && flow.eventCount > 0 &&
    fresh(flow.observedAt, now, 30_000);
}
export function evaluateInstitutionalMarket(input: InstitutionalSnapshot): EvidenceDecision {
  const now = input.timestamp;
  const candles = input.candles || [];
  const futuresOk = tradeFlowValid(input.futuresFlow, now);
  const bookOk = bookValid(input.orderBook, now);
  const liquidationOk = liquidationValid(input.liquidationFlow, now);
  const oiOk = input.oiAvailable && finite(input.oiChange);
  const fundingOk = finite(input.fundingRate);
  const validCandles = candles.length >= 9 && candles.slice(-9).every(c =>
    finite(c.high) && finite(c.low) && finite(c.close) && finite(c.open) &&
    finite(c.volume) && c.high >= c.low && c.volume >= 0 && c.close > 0
  );
  const empty = (state: MarketState, reason: string, missingEvidence: string[]): EvidenceDecision => ({
    symbol: input.symbol, state, direction: "NONE", canEnter: false, entryType: "NONE",
    management: "NONE", evidenceFor: [], evidenceAgainst: [], missingEvidence,
    dataQuality: { spotTrades: false, futuresTrades: futuresOk, orderBook: bookOk, openInterest: oiOk, funding: fundingOk, liquidationFeed: liquidationOk ? "OBSERVED" : input.liquidationFeedConnected ? "NO_RECENT_EVENTS" : "UNAVAILABLE" },
    metrics: {
      spotDeltaQuote: null,
      futuresDeltaQuote: futuresOk ? input.futuresFlow!.buyQuote - input.futuresFlow!.sellQuote : null,
      spotBuyShare: null,
      futuresBuyShare: futuresOk ? input.futuresFlow!.buyQuote / Math.max(input.futuresFlow!.buyQuote + input.futuresFlow!.sellQuote, 1e-12) : null,
      relativeVolume: null, oiChange: oiOk ? input.oiChange : null,
      fundingRate: fundingOk ? input.fundingRate! : null,
      bookImbalance: bookOk ? (input.orderBook!.bidNotional - input.orderBook!.askNotional) / Math.max(input.orderBook!.bidNotional + input.orderBook!.askNotional, 1e-12) : null,
      sampledBidDepthChangePct: bookOk && finite(input.orderBook!.bidDepthChangePct) ? input.orderBook!.bidDepthChangePct : null,
      sampledAskDepthChangePct: bookOk && finite(input.orderBook!.askDepthChangePct) ? input.orderBook!.askDepthChangePct : null,
      longLiquidationQuote: liquidationOk ? input.liquidationFlow!.longLiquidationQuote : null,
      shortLiquidationQuote: liquidationOk ? input.liquidationFlow!.shortLiquidationQuote : null,
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
  // Compare a forming 1m candle with the same elapsed fraction of completed minutes.
  const elapsedMs = finite(recent.openTime) ? Math.max(10_000, Math.min(60_000, now - recent.openTime)) : 60_000;
  const relativeVolume = avgQuoteVolume > 0 ? currentQuoteVolume / Math.max(avgQuoteVolume * elapsedMs / 60_000, avgQuoteVolume * (10_000 / 60_000)) : null;
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
  // Per-symbol flow floor adapts to its own recent Futures quote-volume baseline.
  const flowMinNotional = Math.max(1_000, Math.min(5_000, avgQuoteVolume * 0.03));
  const buy1m = finite(flow.buyQuote1m) ? flow.buyQuote1m : buy;
  const sell1m = finite(flow.sellQuote1m) ? flow.sellQuote1m : sell;
  const total1m = buy1m + sell1m;
  const share1m = total1m > 0 ? buy1m / total1m : 0.5;
  const buy5m = finite(flow.buyQuote5m) ? flow.buyQuote5m : buy1m;
  const sell5m = finite(flow.sellQuote5m) ? flow.sellQuote5m : sell1m;
  const total5m = buy5m + sell5m;
  const share5m = total5m > 0 ? buy5m / total5m : 0.5;
  const priceChange1m = finite(flow.priceChange1mPct) ? flow.priceChange1mPct : priceReturn;
  const priceChange5m = finite(flow.priceChange5mPct) ? flow.priceChange5mPct : null;
  const volumeSurge = relativeVolume !== null && relativeVolume >= 1.25;
  const long30 = buyShare >= 0.54 && total >= flowMinNotional * 0.35;
  const short30 = buyShare <= 0.46 && total >= flowMinNotional * 0.35;
  const long1m = share1m >= 0.54 && total1m >= flowMinNotional;
  const short1m = share1m <= 0.46 && total1m >= flowMinNotional;
  const long5m = share5m >= 0.54 && total5m >= flowMinNotional * 2;
  const short5m = share5m <= 0.46 && total5m >= flowMinNotional * 2;
  // Five-minute flow establishes the prevailing pressure; the 1m/30s tape plus price response times the entry.
  const fiveMinuteOpposesLong = short5m || (priceChange5m !== null && priceChange5m <= -0.005);
  const fiveMinuteOpposesShort = long5m || (priceChange5m !== null && priceChange5m >= 0.005);
  const longReversal = fiveMinuteOpposesLong && long1m && long30 && priceChange1m >= 0.0015;
  const shortReversal = fiveMinuteOpposesShort && short1m && short30 && priceChange1m <= -0.0015;
  const longFlow = (long1m && long30 && priceChange1m >= 0.0003 && (!fiveMinuteOpposesLong || longReversal)) ||
    (long5m && long1m && priceChange1m >= 0.0002);
  const shortFlow = (short1m && short30 && priceChange1m <= -0.0003 && (!fiveMinuteOpposesShort || shortReversal)) ||
    (short5m && short1m && priceChange1m <= -0.0002);
  const longAbsorption = long1m && long30 && priceChange1m <= 0.0001;
  const shortAbsorption = short1m && short30 && priceChange1m >= -0.0001;
  const fastFlow = longReversal || shortReversal;
  const longBreak = recent.close > priorHigh || (priceReturn >= 0.003 && recent.close > recent.open);
  const shortBreak = recent.close < priorLow || (priceReturn <= -0.003 && recent.close < recent.open);
  const compressedBefore = (() => {
    const ranges = closed.slice(-6).map(c => (c.high - c.low) / Math.max(c.open, 1e-12));
    if (ranges.length < 5) return false;
    const sorted = [...ranges].sort((a,b)=>a-b);
    return sorted[Math.floor(sorted.length * 0.6)] < 0.012;
  })();
  const oiExpanding = oi !== null && oi > 0.001;
  const oiContracting = oi !== null && oi < -0.002;
  const longLiquidationConfirmed = liquidationOk && input.liquidationFlow!.shortLiquidationQuote > input.liquidationFlow!.longLiquidationQuote * 1.5 && input.liquidationFlow!.shortLiquidationQuote >= 5_000;
  const shortLiquidationConfirmed = liquidationOk && input.liquidationFlow!.longLiquidationQuote > input.liquidationFlow!.shortLiquidationQuote * 1.5 && input.liquidationFlow!.longLiquidationQuote >= 5_000;
  const longSqueeze = oiContracting && longFlow && priceChange1m > 0 && longLiquidationConfirmed;
  const shortLiquidation = oiContracting && shortFlow && priceChange1m < 0 && shortLiquidationConfirmed;
  const longExhaustion = fundingOk && input.fundingRate! > 0.0015 && buyShare < 0.53;
  const shortExhaustion = fundingOk && input.fundingRate! < -0.0015 && buyShare > 0.47;

  const evidenceFor: string[] = [];
  const evidenceAgainst: string[] = [];
  if (longFlow) evidenceFor.push("Futures executed buyers dominate with material quote flow.");
  if (shortFlow) evidenceFor.push("Futures executed sellers dominate with material quote flow.");
  if (volumeSurge) evidenceFor.push(`Futures candle quote volume is ${relativeVolume!.toFixed(2)}x its recent baseline.`);
  if (fastFlow) evidenceFor.push("A 1m reversal is confirmed by aligned 30s executed flow and a directional price response against the 5m flow backdrop.");
  if (oiExpanding) evidenceFor.push("Open interest expanded; this confirms additional contracts, not whether the new positions are long or short.");
  if (oiContracting && !longSqueeze && !shortLiquidation) evidenceFor.push("Open interest is contracting; position reduction is possible, but liquidation direction is not confirmed without matching force-order events.");
  if (longSqueeze) evidenceFor.push("Upward price/flow and Binance force-order events confirm short liquidations during OI contraction.");
  if (shortLiquidation) evidenceFor.push("Downward price/flow and Binance force-order events confirm long liquidations during OI contraction.");
  if (bookOk && bookImbalance !== null && bookImbalance > 0.12) evidenceFor.push("Displayed bid depth is heavier; this supports LONG liquidity context only, not executed buying.");
  if (bookOk && bookImbalance !== null && bookImbalance < -0.12) evidenceFor.push("Displayed ask depth is heavier; this supports SHORT liquidity context only, not executed selling.");
  if (longAbsorption) evidenceAgainst.push("Buy aggressors dominate 1m/30s but price is not advancing; possible passive offer absorption, not a confirmed long entry.");
  if (shortAbsorption) evidenceAgainst.push("Sell aggressors dominate 1m/30s but price is not declining; possible passive bid absorption, not a confirmed short entry.");
  if (bookOk && finite(input.orderBook!.askDepthChangePct) && input.orderBook!.askDepthChangePct < -15 && longFlow) evidenceFor.push("Sampled ask depth fell sharply during aggressive buying; possible offer depletion, but cancellations cannot be distinguished from fills.");
  if (bookOk && finite(input.orderBook!.bidDepthChangePct) && input.orderBook!.bidDepthChangePct < -15 && shortFlow) evidenceFor.push("Sampled bid depth fell sharply during aggressive selling; possible bid depletion, but cancellations cannot be distinguished from fills.");
  if (liquidationOk && input.liquidationFlow!.longLiquidationQuote > input.liquidationFlow!.shortLiquidationQuote * 1.5 && input.liquidationFlow!.longLiquidationQuote >= 5_000) evidenceFor.push("Recent Binance force-order events show long liquidations; this is squeeze context, not standalone direction proof.");
  if (liquidationOk && input.liquidationFlow!.shortLiquidationQuote > input.liquidationFlow!.longLiquidationQuote * 1.5 && input.liquidationFlow!.shortLiquidationQuote >= 5_000) evidenceFor.push("Recent Binance force-order events show short liquidations; this is squeeze context, not standalone direction proof.");
  if (longExhaustion) evidenceAgainst.push("Crowded positive funding and fading buyer aggression warn of long exhaustion.");
  if (shortExhaustion) evidenceAgainst.push("Crowded negative funding and fading seller aggression warn of short exhaustion.");
  if (!oiOk) evidenceAgainst.push("Open-interest evidence is unavailable; direction is based on executed Futures flow and price/volume only.");
  if (bookOk && !liquidityQualified) evidenceAgainst.push("Spread/depth is not executable enough for a new position.");

  let state: MarketState = "DORMANT", direction: Side | "NONE" = "NONE";
  let canEnter = false, entryType: EvidenceDecision["entryType"] = "NONE";
  let reason = "No violent Futures impulse is developing; quiet symbols remain dormant.";
  const executable = bookOk && liquidityQualified; // A fresh executable Futures depth snapshot remains mandatory before order placement.
  const longEarly = longFlow && executable && priceChange1m > 0 && (volumeSurge || longBreak || fastFlow || compressedBefore);
  const shortEarly = shortFlow && executable && priceChange1m < 0 && (volumeSurge || shortBreak || fastFlow || compressedBefore);
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
      ? "Early upward short-liquidation ignition: 5m/1m Futures flow, price response and observed force-order events align."
      : fastFlow
        ? "Early upward reversal ignition: the 1m price response and 30s executed buying turn against the prior 5m selling pressure."
        : "Early upward ignition: 5m/1m Futures buying and positive price response align; Spot is not consulted.";
  } else if (shortEarly && !shortExhaustion) {
    state = shortConfirmed ? "BREAKOUT_CONFIRMED" : "IGNITION";
    direction = "SHORT"; canEnter = true;
    entryType = shortConfirmed ? "CONFIRMED_BREAKOUT" : "EARLY_IGNITION";
    reason = shortLiquidation
      ? "Early downside long-liquidation ignition: 5m/1m Futures flow, price response and observed force-order events align."
      : fastFlow
        ? "Early downside reversal ignition: the 1m price response and 30s executed selling turn against the prior 5m buying pressure."
        : "Early downside ignition: 5m/1m Futures selling and negative price response align; Spot is not consulted.";
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
      ...(!bookOk ? ["fresh executable Futures order-book snapshot (spread <= 20 bps and depth >= 10,000 USDT)"] : [])
    ],
    dataQuality: { spotTrades: false, futuresTrades: futuresOk, orderBook: bookOk, openInterest: oiOk, funding: fundingOk, liquidationFeed: liquidationOk ? "OBSERVED" : input.liquidationFeedConnected ? "NO_RECENT_EVENTS" : "UNAVAILABLE" },
    metrics: {
      spotDeltaQuote: null, futuresDeltaQuote: delta, spotBuyShare: null, futuresBuyShare: buyShare,
      relativeVolume, oiChange: oi, fundingRate: fundingOk ? input.fundingRate! : null,
      bookImbalance,
      sampledBidDepthChangePct: bookOk && finite(input.orderBook!.bidDepthChangePct) ? input.orderBook!.bidDepthChangePct : null,
      sampledAskDepthChangePct: bookOk && finite(input.orderBook!.askDepthChangePct) ? input.orderBook!.askDepthChangePct : null,
      longLiquidationQuote: liquidationOk ? input.liquidationFlow!.longLiquidationQuote : null,
      shortLiquidationQuote: liquidationOk ? input.liquidationFlow!.shortLiquidationQuote : null,
      btcChange: finite(input.btcChange) ? input.btcChange : null,
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
