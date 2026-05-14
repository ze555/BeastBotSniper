import axios from 'axios';
import { sniper } from './sniperEngine.js';
import { EngineDecision } from '../types/trading.js';
import { addLog } from './botRunner.js';

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
  decision?: EngineDecision;
}

const BINANCE_FAPI = 'https://fapi.binance.com'; 

// Add a helper function to delay execution
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Local cache for Golden Watchlist
let goldenWatchlist: ScannedCoin[] = [];

export function getWatchlist() {
  return goldenWatchlist;
}

export async function runBinanceScanner() {
  console.log('[SCANNER] 🔍 Starting 15-minute market scan for best 10-20 coins...');
  
  try {
    // 1. Fetch 24hr Tickers
    let tickerRes, bookRes;
    try {
      tickerRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/ticker/24hr`, { timeout: 10000 });
      bookRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/ticker/bookTicker`, { timeout: 10000 });
    } catch (apiError: any) {
      if (apiError.response && apiError.response.status === 418) {
         console.error('[SCANNER] ⚠️ IP BLOCKED BY BINANCE (Error 418).');
      } else if (apiError.response && apiError.response.status === 403) {
         console.error(`[SCANNER] ⚠️ API ERROR 403 (Forbidden/WAF Block). Rate limit hit or IP restricted. Sleeping for 60s...`);
         await sleep(60000);
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
    const minVolume = isBeastMode ? 50000 : (isStrict ? (sniper.getSettings().strictMinVolume ?? 1000000) : 500000);

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
    ).sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
     .slice(0, 100); // Limit to top 100 by volume to avoid Binance WAF IP bans

    console.log(`[SCANNER] Found ${validTickers.length} coins matching criteria. Analyzing...`);

    // Log only every few scans to avoid spam
    if (Math.random() > 0.5) {
      addLog(`Scanner Found ${validTickers.length} potential coins...`, 'info');
    }

    const candidates: ScannedCoin[] = [];
    let processedCount = 0;

    // Analyze each valid coin
    for (const ticker of validTickers) {
      await sleep(20); // Throttle to prevent Binance WAF 403 Forbidden bans
      const symbol = ticker.symbol;
      const price = parseFloat(ticker.lastPrice);
      const high = parseFloat(ticker.highPrice);
      const low = parseFloat(ticker.lowPrice);
      const volume = parseFloat(ticker.quoteVolume);

      // --- Filter 3: Volatility (>= 1.5%) ---
      const volatility = ((high - low) / low) * 100;

      // --- Filter 5: Spread (<= 0.15%) ---
      const book = bookMap.get(symbol);
      let spread = 0;
      if (book) {
        const ask = parseFloat(book.askPrice);
        const bid = parseFloat(book.bidPrice);
        spread = ((ask - bid) / bid) * 100;
      }

      // Fetch Klines (15m) to calculate RVOL, EMA50, and Pump Exclusion
      let klines;
      try {
        const klineRes = await axios.get(`${BINANCE_FAPI}/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=51`, { timeout: 5000 });
        klines = klineRes.data;
      } catch (e: any) {
         continue; // skip on error
      }

      if (klines.length < 50) continue; 

      let sumVol = 0;
      let closePrices: number[] = [];

      for (let i = 0; i < klines.length - 1; i++) { 
        const kClose = parseFloat(klines[i][4]);
        const kVol = parseFloat(klines[i][5]); 
        
        sumVol += kVol;
        closePrices.push(kClose);
      }

      const avgVol = sumVol / (klines.length - 1);
      const currentCandleVol = parseFloat(klines[klines.length - 1][5]);
      const rvol = currentCandleVol / avgVol;

      // --- Filter 6: Trend (EMA 50) ---
      const k = 2 / (50 + 1);
      let ema50 = closePrices[0];
      for (let i = 1; i < closePrices.length; i++) {
        ema50 = (closePrices[i] * k) + (ema50 * (1 - k));
      }
      
      const isAboveEma = price > ema50;
      const isBelowEma = price < ema50;
      let trend: 'LONG' | 'SHORT' | 'FLAT' = 'FLAT';
      
      const distanceFromEma = Math.abs((price - ema50) / ema50) * 100;
      const isGlued = distanceFromEma < 0.15; 
      
      if (isAboveEma && !isGlued) trend = 'LONG';
      if (isBelowEma && !isGlued) trend = 'SHORT';

      // --- SCORING SYSTEM (Max 7) ---
      let score = 0;
      const checks = {
        volumePass: volume >= minVolume, 
        rvolPass: rvol >= 1.0, 
        volatilityPass: volatility >= 1.5,
        oiPass: true,
        spreadPass: spread <= 0.2,
        trendPass: trend !== 'FLAT'
      };

      if (checks.volumePass) score += 1;
      if (checks.rvolPass) score += (rvol > 2.0 ? 2 : 1);
      if (checks.volatilityPass) score += 1;
      if (checks.spreadPass) score += 1;
      if (checks.trendPass) score += 2; // High reward for trend
      if (trend === 'FLAT' && rvol > 1.5) score += 1.5; // Bonus for high volume chop

      // Minimum score threshold to consider valid
      const scoreThreshold = isBeastMode ? 1 : 2.5; 
      if (score >= scoreThreshold) {
        candidates.push({
            symbol,
            price,
            volume,
            volatility,
            rvol,
            spread,
            trend,
            oiTrend: 'FLAT',
            score,
            checks
          });
      }

      processedCount++;
      if (processedCount % 20 === 0) await sleep(100);
    }

    // Sort by score descending, then by volume
    candidates.sort((a, b) => b.score - a.score || b.volume - a.volume);
    
    // Take top 20
    goldenWatchlist = candidates.slice(0, 20);
    console.log(`[SCANNER] ✅ Scan Complete. Found ${goldenWatchlist.length} Golden Coins.`);
    // goldenWatchlist.forEach(c => console.log(`   🔥 ${c.symbol} (Score: ${c.score}/5) | RVOL: ${c.rvol.toFixed(2)} | Volatility: ${c.volatility.toFixed(2)}%`));

  } catch (error) {
    console.error('[SCANNER] Error during scan:', error);
  }
}
