export type TradeType = 'LONG' | 'SHORT';
export type TradeMode = 'PAPER' | 'LIVE';
export type TradeStatus = 'OPEN' | 'TP1_HIT' | 'CLOSED';

export enum MarketRegime {
  TREND_EXPANSION = 'TREND_EXPANSION',
  MOMENTUM_MODE = 'MOMENTUM_MODE',
  LIQUIDITY_SWEEP = 'LIQUIDITY_SWEEP',
  TRAP_MODE = 'TRAP_MODE',
  COMPRESSION = 'COMPRESSION',
  DEAD_CHOP = 'DEAD_CHOP',
  VIOLENT_VOLATILITY = 'VIOLENT_VOLATILITY',
  TRENDING = 'TRENDING'
}

export enum TrapType {
  LONG_TRAP = 'LONG_TRAP',
  SHORT_TRAP = 'SHORT_TRAP',
  NONE = 'NONE'
}

export interface EngineDecision {
  regime: MarketRegime;
  bias: 'LONG' | 'SHORT' | 'NEUTRAL';
  trap: TrapType;
  confidence: number; // 0 to 1
  action: 'WAIT' | 'ATTACK' | 'SLEEP';
  reason: string;
}

export interface Trade {
  id: string;
  symbol: string;
  type: TradeType;
  mode: TradeMode;
  entryPrice: number;
  entryTime: number;
  amount: number;      // Position size
  leverage?: number;   // Leverage used
  
  // Risk Management
  sl: number;          // Current Stop Loss
  initialSl: number;   // Original Stop Loss (to calculate Risk R)
  tp1: number;         // +1R
  tp2: number;         // +2R
  
  // State
  status: TradeStatus;
  exitPrice?: number;
  exitTime?: number;
  currentPrice?: number; // Added to track current price for open trades
  pnl?: number;        // Profit/Loss in dollars
  realizedPnl?: number; // PnL generated from partial exits
  pnlPerc?: number;    // Profit/Loss percentage
  score: number;       // The 5/5 score that triggered it
  source?: string;     // The engine that triggered the trade (e.g. 'WAIT_ENGINE')
  
  // Logic tracking
  isBreakeven: boolean; // Has SL been moved to entry?
  highestPrice?: number;
  highestPriceTime?: number;
  isPartialProfitTaken?: boolean;
  inverseBestPrice?: number; // Added for the new inverse trailing logic
  tickHistory?: number[]; // Live Data: Tracks every incoming price tick
  oiHistory?: number[]; // Open Interest history
  volHistory?: number[]; // Volume history
}

export interface MarketCondition {
  symbol: string;
  price: number;
  isRanging: boolean;
  
  // The 5 Checks
  isBreakout: boolean;       // Condition 1
  isRetestOrHold: boolean;   // Condition 2
  isLiquidityGood: boolean;  // Condition 3 (CVD & OI)
  isMomentumHigh: boolean;   // Condition 4 (RVOL >= 1.5)
  isOrderBookClear: boolean; // Condition 5 (No walls)
  
  score: number;             // Total out of 5
  type: 'LONG' | 'SHORT' | 'NEUTRAL';
  
  // Price levels
  support: number;
  resistance: number;
  atr?: number;              // Average True Range for dynamic SL
  htfTrend?: 'LONG' | 'SHORT' | 'FLAT'; // Higher Timeframe Trend (1H)
  oi?: number;               // Open Interest
  oiChange24h?: number;      // OI Change percentage
  vol24h?: number;           // 24h Volume
  spread?: number;           // Bid/Ask Spread
  fundingRate?: number;      // Current Funding Rate
  takerBuySellRatio?: number; // Active market pressure
  decision?: EngineDecision;  // The 7-layer decision core result
}

export interface MarketMetrics {
  symbol: string;
  price: number;
  adx: number;
  atr: number;
  atrPerc: number;
  rsi: number;
  volume: number;
  rvol: number;
  spread: number;
  fundingRate?: number;
  openInterest?: number;
  oiChange?: number;
  takerRatio?: number;
  isChop: boolean;
}

export interface GlobalContext {
  avgAdx: number;
  avgAtrPerc: number;
  bullishRatio: number; // Percentage of coins in HH
  totalVolume24h: number;
  marketSentiment: 'EXTREME_GREED' | 'GREED' | 'NEUTRAL' | 'FEAR' | 'EXTREME_FEAR';
}

export interface SystemStats {
  apiLag: number;
  uptime: number;
  scannedCount: number;
  lastDecisionAt: number;
}

export interface TradePosition {
  id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  amount: number;
  leverage: number;
  sl: number;
  tp1: number;
  tp2: number;
  status: 'OPEN' | 'TP1_HIT' | 'CLOSED';
  entryTime: number;
  pnl: number;
  pnlPerc: number;
  isBreakeven: boolean;
  highestPrice?: number;
}

export interface BotSettings {
  portfolioSize: number;
  riskPerTradePerc: number; // 1 = 1%
  maxConcurrentTrades: number;
  leverage?: number;
  tradingFeeRate?: number; // Fee rate (e.g. 0.001 for 0.1%)
  strictMode?: boolean;
  
  // Customizable Strict Mode filters
  strictMinVolume?: number;         
  strictMinRvol?: number;           
  strictMaxRisk?: number;           
  strictMinScore?: number;          
  strictBtcAlignment?: boolean;     
  strictRsiFilter?: boolean;        
  strictRetest?: boolean;           
  strictFastBreakevenPerc?: number; 

  // Advanced Strict Tuning
  strictRsiHigh?: number;           // Default 75
  strictRsiLow?: number;            // Default 25
  strictRetestPullbackPerc?: number;// Default 3.0 (meaning 3% pullback from high)
  strictBreakoutDistancePerc?: number; // Default 0.5 (meaning 0.5% from high)
  useSmartExit?: boolean;           // Default true
  useWiseExit?: boolean;            // 🔥 Wise Exit: Institutional & Structural Exit
  useWiseEntry?: boolean;           // 🛡️ Wise Entry: Institutional Breakout & SMC Reversals
  
  // Smart Control (التحكم الذكي الفائق)
  useSmartControl?: boolean;        // تفعيل التحكم الذكي
  smartTpUsd?: number;              // هدف الربح السريع بالدولار (مثال 1$)
  smartTrailingStartUsd?: number;   // نقل الوقف للدخول بعد ربح (مثال 0.4$)
  smartTimeDecayMinutes?: number;   // إغلاق زمني إذا لم يتحرك السعر (مثال 5 دقائق)
  smartTrailingThresholdPerc?: number; // تراجع من القمة للإغلاق الديناميكي (مثال 0.3%)
  smartMomentumStallMinutes?: number; // زمن تجمد الزخم للملاحقة (مثال 2.5 دقيقة)
  disableHardTpExit?: boolean;      // تعطيل الإغلاق عند الهدف (الاعتماد كلياً على الزخم)

  // محرك الزخم الحركي (Kinetic Engine)
  useKineticEngine?: boolean;
  kineticUseOpenInterest?: boolean;     // الاعتماد على Open Interest (الفائدة المفتوحة)
  kineticUseVolume?: boolean;           // الاعتماد على تدفق السيولة (Volume) 
  kineticSensitivty?: number;           // حساسية المؤشرات (مثال: 1.5)

  // 🐺 نظام الوحش المدمّر (Beast Mode AI)
  beastMode?: boolean;                  // تفعيل وضع الوحش الذكي
  beastSlippageExploit?: boolean;       // الاستفادة من الانزلاقات والفخاخ
  beastLowCapHunting?: boolean;         // صيد العملات الضعيفة والماركت كاب المنخفض
  beastAutoAdapt?: boolean;             // التعديل التلقائي الذاتي للاعدادات
  beastLearnRate?: number;              // سرعة التعلم من الخسائر وإعادة التعديل
  isNightmareMode?: boolean;            // 🔥 وضع الكابوس: استراتيجية هجومية شاملة ومنيعة
  
  // Beast Intensity & Confirmation
  beastConfirmWithSMC?: boolean;        // تأكيد الوحش عبر التحليل المؤسساتي (SMC)
  beastConfirmWithVolume?: boolean;     // تأكيد الدخول بفلتر السيولة (RVOL)
  beastMinRvol?: number;                // الحد الأدنى للسيولة في وضع الوحش
  beastInstitutionalStrength?: number;  // قوة الضغط المؤسساتي المطلوبة (0.1 - 1.0)

  useSlyFox?: boolean;                  // 🦊 الثعلب الماكر: صائد التذبذبات والفخاخ

  marketPanicThreshold?: number;        // عتبة الذعر: إيقاف التداول عند هبوط عام (مثال 3% في 5 دقائق)

  // Strategy Builder Thresholds (عتبات بناء الاستراتيجية)
  strategyAdxThreshold?: number;        // Default: 25
  strategyAtrMultiplier?: number;       // Default: 1.5
  strategyMinConfidence?: number;       // Default: 0.6
  strategyRvolThreshold?: number;       // Default: 1.5

  // Strategy Builder Toggles (مفاتيح تفعيل الاستراتيجية)
  useStrategyTrendFilter?: boolean;
  useStrategyVolatilityRule?: boolean;
  useStrategyConfidenceGate?: boolean;
  useStrategyMomentumRule?: boolean;
  // ⚡ خيار الخروج السريع (Fast Exit)
  fastExitEnabled?: boolean;            // تفعيل الخروج السريع الشامل
  fastExitPerc?: number;                // نسبة الخروج السريع (افتراضي 0.5%)
  dynamicSafetyExit?: boolean;

  // --- 7 LAYERS UNIFIED SYSTEM SETTINGS ---
  
  // Layer 1: Global Cloud Context
  layerGlobalContextEnabled: boolean;   // تأمين السياق العالمي (بيانات الكلاود)
  
  // Layer 2: Market Regime
  layerRegimeEnabled: boolean;          // تفعيل فلتر نظام السوق (الاتجاه والعرضية)
  
  // Layer 3: Bias Alignment
  layerBiasEnabled: boolean;            // تفعيل فلتر التوافق مع الفريمات الكبيرة
  
  // Layer 4: Liquidity Traps
  layerLiquidityEnabled: boolean;       // تفعيل طبقة صيد الفخاخ واختراق السيولة
  
  // Layer 5: Momentum Velocity
  layerMomentumEnabled: boolean;        // تفعيل طبقة الزخم والانفجار السعري
  
  // Layer 6: Neural Confidence
  layerConfidenceEnabled: boolean;      // تفعيل بوابة اليقين الاصطناعي
  layerRiskEnabled: boolean;            // تفعيل طبقة إدارة المخاطر المتقدمة
  
  // Binance API Settings
  binanceApiKey?: string;
  binanceSecretKey?: string;
  tradingMode?: 'PAPER' | 'LIVE';

  // Quantum Engine Settings (Advanced Controls)
  quantumBbPeriod?: number;
  quantumBbMultiplier?: number;
  quantumVolThreshold?: number;
  quantumMomentumVol?: number;
  quantumTakerLongThresh?: number;    // Default 1.01
  quantumTakerShortThresh?: number;   // Default 0.99
  quantumMomentumLongThresh?: number; // Default 1.15
  quantumMomentumShortThresh?: number;// Default 0.85
  quantumTpScale?: number;            // Multiplier for take profit
  quantumSlScale?: number;            // Multiplier for stop loss
  quantumUseReversion?: boolean;      // Default true
  quantumUseMomentum?: boolean;       // Default true
  quantumBeastMode?: boolean;         // 🐺 Beast Mode: Aggressive tuning
  quantumSmartExit?: boolean;         // 🧠 Smart Exit: Intelligent target management
  quantumWiseEntry?: boolean;         // 🛡️ Wise Entry: Strict reversal confirmation
  
  // Sensitivities for the above
  quantumBeastAggression?: number;    // Multiplier for Beast Mode intensity (1.0 - 2.0)
  quantumSmartExitAggression?: number;// How early to exit (0.5 - 1.0)
  quantumWiseEntryThreshold?: number; // Taker ratio threshold for Wise Entry (1.05 - 1.20)

  // New Inverse Trailing Logic
  inverseTrailingEnabled?: boolean;
  inverseTrailingSensitivity?: number; // % reversal to trigger exit
  isLongTerm?: boolean;                 // 📊 الخيار الطويل: تداول على فريمات زمنية أكبر (15م، 1س، 4س)
  minPositionSizePerc?: number;         // 💰 Minimum capital allocation per trade (e.g. 20%)

  // 🌀 Quantum Fusion Engine (المحرك الاندماجي الكمي)
  useFusionEngine?: boolean;            // تفعيل المحرك الاندماجي الموحد
  fusionSensitivity?: number;          // حساسية الاندماج (1.0 - 5.0)
  fusionWeightOi?: number;             // وزن الفائدة المفتوحة (Open Interest)
  fusionWeightFunding?: number;        // وزن معدل التمويل (Funding Rate)
  fusionWeightVol?: number;            // وزن تدفق السيولة (RVOL/Volume)
  fusionWeightInst?: number;           // وزن الضغط المؤسساتي (Taker Ratio)
  fusionMinScore?: number;             // الحد الأدنى لدرجة الاندماج للتنفيذ (مثال 75%)
}
