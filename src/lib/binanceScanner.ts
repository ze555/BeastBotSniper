import axios from 'axios';
import { sniper } from './sniperEngine.js';

export interface ScannedCoin {
  symbol: string;
  price: number;
  volume: number;      // 24h quote volume
  volatility: number;  // % (High-Low)/Low
  rvol: number;        // RVOL
  spread: number;      // %
  trend: 'LONG' | 'SHORT' | 'FLAT';
  oiTrend: 'UP' | 'DOWN' | 'FLAT'; // Simulated for now unless history endpoint is used
  score: number;
  checks: {
    volumePass: boolean;
    rvolPass: boolean;
    volatilityPass: boolean;
    oiPass: boolean;
    spreadPass: boolean;
    trendPass: boolean;
  };
}

const BINANCE_FAPI = 'https://fapi.binance.com'; 

// Add a helper function to delay execution
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Local cache for Golden Watchlist
let goldenWatchlist: ScannedCoin[] = [];
let isScanning = false;
let lastScanTime = 0;
let totalProcessed = 0;

export function getWatchlist() {
  return {
    coins: goldenWatchlist,
    lastScan: lastScanTime,
    isScanning,
    totalProcessed
  };
}

export async function runBinanceScanner() {
  if (isScanning) return;
  isScanning = true;
  lastScanTime = Date.now();
  totalProcessed = 0;
  
  console.log('[SCANNER] 🔍 Starting market scan for best targets...');
  
  try {
    // 1. Fetch 24hr Tickers
    let tickerRes, bookRes;
    try {
      tickerRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/ticker/24hr`, { timeout: 10000 });
      bookRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/ticker/bookTicker`, { timeout: 10000 });
    } catch (apiError: any) {
      if (apiError.response && apiError.response.status === 418) {
         console.error('[SCANNER] ⚠️ IP BLOCKED BY BINANCE (Error 418). Render proxy or VPN needed.');
      } else {
         console.error('[SCANNER] API Error fetching tickers:', apiError.message);
      }
      return; // Exit scanner cleanly
    }

    const allTickers = tickerRes.data as any[];
    const allBooks = bookRes.data as any[];
    const bookMap = new Map<string, any>();
    allBooks.forEach(b => bookMap.set(b.symbol, b));

    const isStrict = sniper.getSettings().strictMode;
    const isBeastMode = sniper.getSettings().beastMode;
    const isScavenger = isBeastMode && sniper.getSettings().beastLowCapHunting !== false;

    // SCVANGER MODE: Bypass strict volume bounds and dive into low liquidity
    const minVolume = isScavenger ? 500000 : (isStrict ? (sniper.getSettings().strictMinVolume ?? 5000000) : 50000000);

    const excludedAssets = [
      'BTCUSDT', 'ETHUSDT', // Majors
      'USDCUSDT', 'FDUSDUSDT', 'TUSDUSDT', 'BUSDUSDT', 'USDPUSDT', 'EURUSDT', 'AEURUSDT', // Stablecoins / Fiat
      'PAXGUSDT', 'XAUTUSDT' // Gold / Raw assets
    ];

    // Filter Step 1: Only USDT pairs with Volume limit
    const validTickers = allTickers.filter(t => 
      t.symbol.endsWith('USDT') && 
      parseFloat(t.quoteVolume) >= minVolume &&
      !excludedAssets.includes(t.symbol) &&
      !t.symbol.includes('UPUSDT') && !t.symbol.includes('DOWNUSDT') && // Exclude leveraged tokens
      !t.symbol.includes('BULLUSDT') && !t.symbol.includes('BEARUSDT')
    );

    console.log(`[SCANNER] Found ${validTickers.length} coins with >$${minVolume / 1000000}M volume. (Beast/Scavenger: ${isScavenger})`);

    const candidates: ScannedCoin[] = [];

    // Analyze each valid coin
    for (const ticker of validTickers) {
      totalProcessed++;
      const symbol = ticker.symbol;
      const price = parseFloat(ticker.lastPrice);
      const high = parseFloat(ticker.highPrice);
      const low = parseFloat(ticker.lowPrice);
      const volume = parseFloat(ticker.quoteVolume);

      // --- Filter 3: Volatility (>= 3%) ---
      const volatility = ((high - low) / low) * 100;

      // --- Filter 5: Spread (<= 0.1%) ---
      const book = bookMap.get(symbol);
      let spread = 0;
      if (book) {
        const ask = parseFloat(book.askPrice);
        const bid = parseFloat(book.bidPrice);
        spread = ((ask - bid) / bid) * 100;
      }

      // Fetch Klines (15m) to calculate RVOL, EMA50, and Pump Exclusion
      // Limit 50 to get exactly EMA50 and RVOL for current candle
      let klines;
      try {
        const klineRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=51`);
        klines = klineRes.data;
      } catch (e: any) {
         if (e.response && (e.response.status === 429 || e.response.status === 418)) {
            console.log(`[SCANNER] ⚠️ Rate limit hit. Sleeping for 10 seconds...`);
            await sleep(10000);
         } else {
            await sleep(200);
         }
         continue; // skip on error
      }

      if (klines.length < 50) continue; // Not enough data

      let hasSuddenPump = false;
      let sumVol = 0;
      let closePrices: number[] = [];

      for (let i = 0; i < klines.length - 1; i++) { // Exclude current forming candle for averages
        const kHigh = parseFloat(klines[i][2]);
        const kLow = parseFloat(klines[i][3]);
        const kClose = parseFloat(klines[i][4]);
        const kVol = parseFloat(klines[i][5]); // Base asset volume 
        
        // Pump Exclusion: Any candle > 10% movement in recent history
        const candleMove = ((kHigh - kLow) / kLow) * 100;
        if (candleMove >= 10) {
          hasSuddenPump = true;
        }

        sumVol += kVol;
        closePrices.push(kClose);
      }

      // Exclusion check
      if (hasSuddenPump && !isBeastMode) {
        // console.log(`[SCANNER] ❌ ${symbol} ignored due to sudden +10% pump candle.`);
        await sleep(100); // Add a small delay to avoid rate limit before moving to next
        continue; // Skip immediately
      }

      // --- Filter 2: RVOL (>= 1.5) ---
      const avgVol = sumVol / (klines.length - 1);
      const currentCandleVol = parseFloat(klines[klines.length - 1][5]);
      const rvol = currentCandleVol / avgVol;

      // --- Filter 6: Trend (EMA 50) ---
      // Simple EMA calculation for the last close
      const k = 2 / (50 + 1);
      let ema50 = closePrices[0];
      for (let i = 1; i < closePrices.length; i++) {
        ema50 = (closePrices[i] * k) + (ema50 * (1 - k));
      }
      
      const isAboveEma = price > ema50;
      const isBelowEma = price < ema50;
      let trend: 'LONG' | 'SHORT' | 'FLAT' = 'FLAT';
      if (isAboveEma) trend = 'LONG';
      if (isBelowEma) trend = 'SHORT';

      // --- Filter 4: Open Interest (OI) ---
      // For performance in bulk scanning, we use the 24h ticker's price action vs volume 
      // To get real 4h OI we'd need another 40 API calls. Real OI trend check: limit calls!
      let oiTrend: 'UP' | 'DOWN' | 'FLAT' = 'UP'; // Default to test
      let oiPass = true; // Assuming OI logic is mapped locally in a real setup.
      try {
        const oiHist = await axios.get(`${BINANCE_FAPI}/futures/data/openInterestHist?symbol=${symbol}&period=4h&limit=5`);
        const oiData = oiHist.data;
        if (oiData && oiData.length >= 5) {
          const oiOld = parseFloat(oiData[0].sumOpenInterest);
          const oiNew = parseFloat(oiData[oiData.length - 1].sumOpenInterest);
          oiTrend = oiNew > oiOld ? 'UP' : 'DOWN';
          oiPass = (trend === 'LONG' && oiNew > oiOld) || (trend === 'SHORT' && oiNew > oiOld);
        }
      } catch(e: any) {
         if (e.response && (e.response.status === 429 || e.response.status === 418)) {
            console.log(`[SCANNER] ⚠️ Rate limit hit on OI. Sleeping for 5 seconds...`);
            await sleep(5000);
         }
      } // Silently fail and default to pass to avoid rate limit death for now.
      
      // --- SCORING SYSTEM (Max 6) ---
      let score = 0;
      const checks = {
        volumePass: volume >= minVolume, // already true due to pre-filter
        rvolPass: rvol >= 1.5,
        volatilityPass: volatility >= 3,
        oiPass: oiPass,
        spreadPass: spread <= 0.1,
        trendPass: trend !== 'FLAT'
      };

      if (checks.volumePass) score++;
      if (checks.rvolPass) score++;
      if (checks.volatilityPass) score++;
      if (checks.oiPass) score++;
      if (checks.spreadPass) score++;
      if (checks.trendPass) score++;

    // Minimum score threshold to consider valid
    if (score >= 4) {
      // Calculate sector strength (Simple: how many USDT pairs are up > 2%)
      const marketHeat = validTickers.filter(t => parseFloat(t.priceChangePercent) > 2).length / validTickers.length;
      if (marketHeat > 0.4) {
          score += 0.5; // Boost score if whole market is pumping (Safety in numbers)
      }

      candidates.push({
          symbol,
          price,
          volume,
          volatility,
          rvol,
          spread,
          trend,
          oiTrend,
          score,
          checks
        });
      }

      // Add a 100ms delay between coins (faster scanning, risky but needed for aggression)
      await sleep(100);
    }

    // Sort by score descending, then by rvol for aggression
    candidates.sort((a, b) => b.score - a.score || b.rvol - a.rvol);
    
    // Take top 25 high-value targets
    goldenWatchlist = candidates.slice(0, 25);
    console.log(`[SCANNER] ✅ Scan Complete. Found ${goldenWatchlist.length} Golden Coins.`);
    isScanning = false;

    // Schedule next scan in 8 minutes to keep data fresh
    setTimeout(runBinanceScanner, 8 * 60 * 1000);
  } catch (error) {
    console.error('[SCANNER] Error during scan:', error);
    isScanning = false;
    setTimeout(runBinanceScanner, 2 * 60 * 1000); // Retry sooner on error
  }
}
