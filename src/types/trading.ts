export type TradeType = 'LONG' | 'SHORT';
export type TradeMode = 'PAPER' | 'LIVE';
export type TradeStatus = 'OPEN' | 'TP1_HIT' | 'CLOSED';

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
  
  // Logic tracking
  isBreakeven: boolean; // Has SL been moved to entry?
  highestPrice?: number;
  highestPriceTime?: number;
  isPartialProfitTaken?: boolean;
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
}

export interface BotSettings {
  portfolioSize: number;
  riskPerTradePerc: number; // 1 = 1%
  maxConcurrentTrades: number;
  leverage?: number;
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
}
