import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Square, 
  Plus, 
  Trash2, 
  Save, 
  Download, 
  Upload, 
  Sliders, 
  Cpu, 
  Layers, 
  Settings, 
  Activity, 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  ChevronRight, 
  Sparkles, 
  ShieldAlert, 
  Clock, 
  Info, 
  HelpCircle, 
  Zap, 
  RefreshCw, 
  TrendingUp, 
  TrendingDown, 
  Copy,
  FolderLock
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ReferenceDot,
  ComposedChart,
  Area
} from 'recharts';

// Define the type structures for our custom rules engine (Tawleefa)
export type LogicGate = 'AND' | 'OR';
export type RuleAction = 'LONG' | 'SHORT' | 'EXIT_ALL' | 'ALERT_ONLY' | 'DUAL';

export interface ConditionRow {
  id: string;
  metric: 'PRICE' | 'OPEN_INTEREST' | 'CVD' | 'RVOL' | 'TAKER_RATIO' | 'FUNDING_RATE' | 'RSI' | 'ADX' | 'LIQUIDITY_CLUSTER';
  operator: 'GREATER_THAN' | 'LESS_THAN' | 'CROSSES_ABOVE' | 'CROSSES_BELOW' | 'SPIKE' | 'DIVERGENCING' | 'SWEEP_LOW_HIGH' | 'EXHAUSTION';
  valueType: 'NUMBER' | 'METRIC';
  valueNumber: number;
  valueMetric?: 'PRICE' | 'OPEN_INTEREST' | 'CVD' | 'RVOL' | 'TAKER_RATIO' | 'FUNDING_RATE';
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h';
  sensitivity: number; // For advanced items like sweep, divergence, exhaustion
}

export interface DynamicExitCondition {
  metric: 'PRICE' | 'OPEN_INTEREST' | 'CVD' | 'RVOL' | 'TAKER_RATIO' | 'FUNDING_RATE' | 'RSI' | 'ADX' | 'LIQUIDITY_CLUSTER';
  operator: 'GREATER_THAN' | 'LESS_THAN' | 'CROSSES_ABOVE' | 'CROSSES_BELOW' | 'SPIKE' | 'DIVERGENCING' | 'SWEEP_LOW_HIGH' | 'EXHAUSTION';
  valueNumber: number;
}

export interface DynamicExitPartial {
  profitR: number;
  closePercent: number;
}

export interface DynamicExitProfile {
  regime: string;
  breakevenR?: number;
  partials?: DynamicExitPartial[];
  exitConditions?: DynamicExitCondition[];
  exitGate?: 'AND' | 'OR';
  hardExitR?: number;
}

export interface RegimeProfile {
  regime: string;
  gate: LogicGate;
  conditions: ConditionRow[];
  action: RuleAction;
  stopLossMode: 'ATR_DYNAMIC' | 'FIXED' | 'SWEEP_LOW_BOUND' | 'EXHAUSTION_CLOSE' | 'NONE';
  stopLossValue: number;
  takeProfitMode: 'TRAILING_MOMENTUM' | 'FIXED_R' | 'FUSION_CASCADE';
  takeProfitValue: number;

  // New fields for dual direction support
  longConditions?: ConditionRow[];
  longGate?: LogicGate;
  shortConditions?: ConditionRow[];
  shortGate?: LogicGate;
}

export interface TawleefaConfig {
  id: string;
  name: string;
  description: string;
  creator: string;
  gate: LogicGate;
  conditions: ConditionRow[];
  action: RuleAction;
  
  // Market filters
  allowedRegimes: string[]; // ['TREND_EXPANSION', 'LIQUIDITY_SWEEP']
  btcAlignmentRequired: boolean;
  minMarketConfidence: number; // 0 - 100
  
  // Execution params
  leverage: number;
  riskPerTrade: number; // % of portfolio
  stopLossMode: 'ATR_DYNAMIC' | 'FIXED' | 'SWEEP_LOW_BOUND' | 'EXHAUSTION_CLOSE' | 'NONE';
  stopLossValue: number; // multiplier or percentage
  takeProfitMode: 'TRAILING_MOMENTUM' | 'FIXED_R' | 'FUSION_CASCADE';
  takeProfitValue: number; // multiplier or percentage
  
  // Dynamic regime specific profiles mapping
  dynamicRegimeProfiles?: RegimeProfile[];
  dynamicExitProfiles?: DynamicExitProfile[];

  // New fields for dual direction support
  longConditions?: ConditionRow[];
  longGate?: LogicGate;
  shortConditions?: ConditionRow[];
  shortGate?: LogicGate;

  createdAt: string;
}

// Simulated data formats
interface SimulatedTick {
  step: number;
  time: number;
  price: number;
  openInterest: number;
  volume: number;
  takerRatio: number;
  fundingRate: number;
  atr: number;
  adx: number;
  cvd: number; // Cumulative Volume Delta synthetically generated
  rsi: number;
}

interface SimulatorScenario {
  id: string;
  name: string;
  description: string;
  regime: string;
  ticks: SimulatedTick[];
}

// Professional preset templates that the user can start with or modify
const PRESET_TEMPLATES: TawleefaConfig[] = [
  {
    id: 'golden_sniper_balanced_v1',
    name: 'توليفة القناص الذهبي المتوازن (Golden Sniper Balanced)',
    description: 'نسخة متقنة تجمع بين دقة الدخول في الريجيمات السوقية الخمسة وإستراتيجيات الخروج الديناميكية الصارمة لعامة الأصول الرقمية.',
    creator: 'ChatGPT',
    action: 'DUAL',
    gate: 'AND',
    conditions: [
      {
        id: 'global_rvol',
        metric: 'RVOL',
        operator: 'GREATER_THAN',
        valueType: 'NUMBER',
        valueNumber: 1.0,
        timeframe: '5m',
        sensitivity: 1.0
      }
    ],
    allowedRegimes: [
      'TREND_EXPANSION',
      'MOMENTUM_MODE',
      'TRENDING',
      'LIQUIDITY_SWEEP',
      'COMPRESSION'
    ],
    btcAlignmentRequired: false,
    minMarketConfidence: 50,
    leverage: 8,
    riskPerTrade: 1.0,
    stopLossMode: 'NONE',
    stopLossValue: 1.3,
    takeProfitMode: 'TRAILING_MOMENTUM',
    takeProfitValue: 3.0,
    longGate: 'AND',
    longConditions: [
      {
        id: 'long_taker',
        metric: 'TAKER_RATIO',
        operator: 'GREATER_THAN',
        valueType: 'NUMBER',
        valueNumber: 1.03,
        timeframe: '5m',
        sensitivity: 1.0
      }
    ],
    shortGate: 'AND',
    shortConditions: [
      {
        id: 'short_taker',
        metric: 'TAKER_RATIO',
        operator: 'LESS_THAN',
        valueType: 'NUMBER',
        valueNumber: 0.97,
        timeframe: '5m',
        sensitivity: 1.0
      }
    ],
    dynamicRegimeProfiles: [
      {
        regime: 'TREND_EXPANSION',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'te_long_1',
            metric: 'ADX',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 20,
            timeframe: '15m',
            sensitivity: 1.0
          },
          {
            id: 'te_long_2',
            metric: 'TAKER_RATIO',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.05,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        shortConditions: [
          {
            id: 'te_short_1',
            metric: 'ADX',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 20,
            timeframe: '15m',
            sensitivity: 1.0
          },
          {
            id: 'te_short_2',
            metric: 'TAKER_RATIO',
            operator: 'LESS_THAN',
            valueType: 'NUMBER',
            valueNumber: 0.95,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        stopLossMode: 'ATR_DYNAMIC',
        stopLossValue: 1.3,
        takeProfitMode: 'TRAILING_MOMENTUM',
        takeProfitValue: 4.0
      },
      {
        regime: 'MOMENTUM_MODE',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'mom_long_1',
            metric: 'TAKER_RATIO',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.08,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'mom_long_2',
            metric: 'OPEN_INTEREST',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 0.5,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        shortConditions: [
          {
            id: 'mom_short_1',
            metric: 'TAKER_RATIO',
            operator: 'LESS_THAN',
            valueType: 'NUMBER',
            valueNumber: 0.92,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'mom_short_2',
            metric: 'OPEN_INTEREST',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 0.5,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        stopLossMode: 'ATR_DYNAMIC',
        stopLossValue: 1.0,
        takeProfitMode: 'TRAILING_MOMENTUM',
        takeProfitValue: 4.5
      },
      {
        regime: 'TRENDING',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'tr_long_1',
            metric: 'RVOL',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.05,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        shortConditions: [
          {
            id: 'tr_short_1',
            metric: 'RVOL',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.05,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        stopLossMode: 'ATR_DYNAMIC',
        stopLossValue: 1.2,
        takeProfitMode: 'TRAILING_MOMENTUM',
        takeProfitValue: 3.0
      },
      {
        regime: 'LIQUIDITY_SWEEP',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'ls_long',
            metric: 'PRICE',
            operator: 'SWEEP_LOW_HIGH',
            valueType: 'NUMBER',
            valueNumber: 2,
            timeframe: '5m',
            sensitivity: 0.8
          }
        ],
        shortConditions: [
          {
            id: 'ls_short',
            metric: 'PRICE',
            operator: 'SWEEP_LOW_HIGH',
            valueType: 'NUMBER',
            valueNumber: 2,
            timeframe: '5m',
            sensitivity: 0.8
          }
        ],
        stopLossMode: 'SWEEP_LOW_BOUND',
        stopLossValue: 0.3,
        takeProfitMode: 'TRAILING_MOMENTUM',
        takeProfitValue: 2.5
      },
      {
        regime: 'COMPRESSION',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'comp_long_1',
            metric: 'OPEN_INTEREST',
            operator: 'SPIKE',
            valueType: 'NUMBER',
            valueNumber: 2,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        shortConditions: [
          {
            id: 'comp_short_1',
            metric: 'OPEN_INTEREST',
            operator: 'SPIKE',
            valueType: 'NUMBER',
            valueNumber: 2,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        stopLossMode: 'ATR_DYNAMIC',
        stopLossValue: 1.1,
        takeProfitMode: 'FUSION_CASCADE',
        takeProfitValue: 5.0
      }
    ],
    dynamicExitProfiles: [
      {
        regime: 'TREND_EXPANSION',
        breakevenR: 0.8,
        hardExitR: 6.0,
        partials: [
          { profitR: 1.5, closePercent: 25 },
          { profitR: 3.0, closePercent: 25 }
        ],
        exitGate: 'OR',
        exitConditions: [
          {
            metric: 'ADX',
            operator: 'LESS_THAN',
            valueNumber: 18
          },
          {
            metric: 'TAKER_RATIO',
            operator: 'LESS_THAN',
            valueNumber: 0.98
          }
        ]
      },
      {
        regime: 'MOMENTUM_MODE',
        breakevenR: 0.5,
        hardExitR: 4.0,
        partials: [
          { profitR: 1.0, closePercent: 30 },
          { profitR: 2.5, closePercent: 20 }
        ],
        exitGate: 'OR',
        exitConditions: [
          {
            metric: 'OPEN_INTEREST',
            operator: 'LESS_THAN',
            valueNumber: 0
          },
          {
            metric: 'TAKER_RATIO',
            operator: 'LESS_THAN',
            valueNumber: 1.0
          }
        ]
      },
      {
        regime: 'TRENDING',
        breakevenR: 0.8,
        hardExitR: 3.5,
        partials: [
          { profitR: 1.5, closePercent: 25 }
        ],
        exitGate: 'OR',
        exitConditions: [
          {
            metric: 'RVOL',
            operator: 'LESS_THAN',
            valueNumber: 0.9
          },
          {
            metric: 'TAKER_RATIO',
            operator: 'LESS_THAN',
            valueNumber: 0.99
          }
        ]
      },
      {
        regime: 'LIQUIDITY_SWEEP',
        breakevenR: 0.5,
        hardExitR: 2.0,
        partials: [
          { profitR: 1.0, closePercent: 30 }
        ],
        exitGate: 'OR',
        exitConditions: [
          {
            metric: 'TAKER_RATIO',
            operator: 'LESS_THAN',
            valueNumber: 0.98
          }
        ]
      },
      {
        regime: 'COMPRESSION',
        breakevenR: 0.8,
        hardExitR: 5.0,
        partials: [
          { profitR: 2.0, closePercent: 20 }
        ],
        exitGate: 'OR',
        exitConditions: [
          {
            metric: 'RVOL',
            operator: 'LESS_THAN',
            valueNumber: 0.95
          },
          {
            metric: 'OPEN_INTEREST',
            operator: 'LESS_THAN',
            valueNumber: 0
          }
        ]
      }
    ],
    createdAt: '2026-06-03T17:11:39Z'
  },
  {
    id: 'hybrid_twin_engine_pro_v3',
    name: 'التوليفة الذهبية الموحدة (Golden Sniper Ultimate)',
    description: 'التوليفة المطلقة المتكاملة لمحرك البوت ثنائي الاتجاه، تجمع بين خطط دخول دقيقة ومصممة لكل رييجيم سوقي من جهة، وخطط خروج آمنة وديناميكية (حماية رأس مال، جني أرباح جزئي، تتبع زخم، إغلاق مؤشرات) تؤمن الحساب وتقتنص الأرباح بكفاءة فولاذية من جهة أخرى.',
    creator: 'مجمع سنايبر الكمي المطور',
    action: 'DUAL',
    gate: 'AND',
    conditions: [
      {
        id: 'global_val_1',
        metric: 'TAKER_RATIO',
        operator: 'GREATER_THAN',
        valueType: 'NUMBER',
        valueNumber: 1.01,
        timeframe: '5m',
        sensitivity: 1.0
      }
    ],
    allowedRegimes: [
      'TRENDING',
      'TREND_EXPANSION',
      'MOMENTUM_MODE',
      'LIQUIDITY_SWEEP',
      'COMPRESSION'
    ],
    btcAlignmentRequired: false,
    minMarketConfidence: 55,
    leverage: 8,
    riskPerTrade: 1.5,
    stopLossMode: 'NONE',
    stopLossValue: 1.2,
    takeProfitMode: 'TRAILING_MOMENTUM',
    takeProfitValue: 3.0,

    longGate: 'AND',
    longConditions: [
      {
        id: 'global_long_rvol',
        metric: 'RVOL',
        operator: 'GREATER_THAN',
        valueType: 'NUMBER',
        valueNumber: 1.10,
        timeframe: '5m',
        sensitivity: 1.0
      },
      {
        id: 'global_long_taker',
        metric: 'TAKER_RATIO',
        operator: 'GREATER_THAN',
        valueType: 'NUMBER',
        valueNumber: 1.05,
        timeframe: '5m',
        sensitivity: 1.0
      }
    ],

    shortGate: 'AND',
    shortConditions: [
      {
        id: 'global_short_rvol',
        metric: 'RVOL',
        operator: 'GREATER_THAN',
        valueType: 'NUMBER',
        valueNumber: 1.10,
        timeframe: '5m',
        sensitivity: 1.0
      },
      {
        id: 'global_short_taker',
        metric: 'TAKER_RATIO',
        operator: 'LESS_THAN',
        valueType: 'NUMBER',
        valueNumber: 0.95,
        timeframe: '5m',
        sensitivity: 1.0
      }
    ],

    dynamicRegimeProfiles: [
      {
        regime: 'TREND_EXPANSION',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'gp_te_long_1',
            metric: 'ADX',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 22,
            timeframe: '15m',
            sensitivity: 1.0
          },
          {
            id: 'gp_te_long_2',
            metric: 'TAKER_RATIO',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.10,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        shortConditions: [
          {
            id: 'gp_te_short_1',
            metric: 'ADX',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 22,
            timeframe: '15m',
            sensitivity: 1.0
          },
          {
            id: 'gp_te_short_2',
            metric: 'TAKER_RATIO',
            operator: 'LESS_THAN',
            valueType: 'NUMBER',
            valueNumber: 0.90,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        stopLossMode: 'ATR_DYNAMIC',
        stopLossValue: 1.2,
        takeProfitMode: 'TRAILING_MOMENTUM',
        takeProfitValue: 4.0
      },
      {
        regime: 'MOMENTUM_MODE',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'gp_mm_long_1',
            metric: 'TAKER_RATIO',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.15,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_mm_long_2',
            metric: 'OPEN_INTEREST',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.0,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        shortConditions: [
          {
            id: 'gp_mm_short_1',
            metric: 'TAKER_RATIO',
            operator: 'LESS_THAN',
            valueType: 'NUMBER',
            valueNumber: 0.85,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_mm_short_2',
            metric: 'OPEN_INTEREST',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.0,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        stopLossMode: 'ATR_DYNAMIC',
        stopLossValue: 1.0,
        takeProfitMode: 'TRAILING_MOMENTUM',
        takeProfitValue: 4.5
      },
      {
        regime: 'LIQUIDITY_SWEEP',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'gp_lq_long_1',
            metric: 'PRICE',
            operator: 'SWEEP_LOW_HIGH',
            valueType: 'NUMBER',
            valueNumber: 2,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        shortConditions: [
          {
            id: 'gp_lq_short_1',
            metric: 'PRICE',
            operator: 'SWEEP_LOW_HIGH',
            valueType: 'NUMBER',
            valueNumber: 2,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        stopLossMode: 'SWEEP_LOW_BOUND',
        stopLossValue: 0.25,
        takeProfitMode: 'TRAILING_MOMENTUM',
        takeProfitValue: 2.5
      },
      {
        regime: 'COMPRESSION',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'gp_cp_long_1',
            metric: 'OPEN_INTEREST',
            operator: 'SPIKE',
            valueType: 'NUMBER',
            valueNumber: 5,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_cp_long_2',
            metric: 'RVOL',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.2,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        shortConditions: [
          {
            id: 'gp_cp_short_1',
            metric: 'OPEN_INTEREST',
            operator: 'SPIKE',
            valueType: 'NUMBER',
            valueNumber: 5,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_cp_short_2',
            metric: 'RVOL',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.2,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        stopLossMode: 'ATR_DYNAMIC',
        stopLossValue: 1.0,
        takeProfitMode: 'FUSION_CASCADE',
        takeProfitValue: 5.0
      },
      {
        regime: 'TRENDING',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'gp_tr_long_1',
            metric: 'RVOL',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.10,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_tr_long_2',
            metric: 'TAKER_RATIO',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.05,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        shortConditions: [
          {
            id: 'gp_tr_short_1',
            metric: 'RVOL',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.10,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_tr_short_2',
            metric: 'TAKER_RATIO',
            operator: 'LESS_THAN',
            valueType: 'NUMBER',
            valueNumber: 0.95,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        stopLossMode: 'ATR_DYNAMIC',
        stopLossValue: 1.1,
        takeProfitMode: 'TRAILING_MOMENTUM',
        takeProfitValue: 3.0
      }
    ],

    // خطط الخروج الآمنة لكل رييجيم سوقي ديناميكي (Safe Dynamic Exit Profiles)
    dynamicExitProfiles: [
      {
        regime: "TREND_EXPANSION",
        breakevenR: 1.0, // حماية رأس المال بنقل الوقف على الدخول عند +1.0R
        partials: [
          {
            profitR: 2.0, // جني أرباح جزئي أول 20% عند +2.0R
            closePercent: 20
          },
          {
            profitR: 4.0, // جني أرباح جزئي ثانٍ 20% عند +4.0R
            closePercent: 20
          }
        ],
        exitConditions: [
          {
            metric: "ADX",
            operator: "LESS_THAN",
            valueNumber: 20 // الخروج فور تباطؤ اتجاه التوسع السعري
          },
          {
            metric: "TAKER_RATIO",
            operator: "LESS_THAN",
            valueNumber: 0.95 // ضعف هيمنة صانعي السوق
          }
        ],
        exitGate: "AND"
      },
      {
        regime: "MOMENTUM_MODE",
        breakevenR: 0.5, // حماية رأس المال سريعة للغاية عند +0.5R لتجنب الارتدادات العنيفة
        partials: [
          {
            profitR: 1.5, // جني أرباح مبكر 30% عند +1.5R لتأمين الحساب
            closePercent: 30
          },
          {
            profitR: 3.0, // جني أرباح ثانٍ 20% عند +3.0R
            closePercent: 20
          }
        ],
        exitConditions: [
          {
            metric: "TAKER_RATIO",
            operator: "LESS_THAN",
            valueNumber: 1.0 // الخروج فور غياب الحسم الشرائي/البيعي
          },
          {
            metric: "OPEN_INTEREST",
            operator: "LESS_THAN",
            valueNumber: 0.0 // خروج العقود المفتوحة يعني انسحاب القوة الدافعة
          }
        ],
        exitGate: "AND"
      },
      {
        regime: "LIQUIDITY_SWEEP",
        breakevenR: 0.5, // نقل على الدخول سريع جداً عند +0.5R لأن سحب السيولة معرض جداً للمصائد
        partials: [
          {
            profitR: 1.0, // جني أرباح جزئي 30% سريعاً عند +1.0R
            closePercent: 30
          }
        ],
        hardExitR: 2.0, // خروج فوري جشع عند +2.0R لتصفية كامل المركز
        exitConditions: [
          {
            metric: "TAKER_RATIO",
            operator: "LESS_THAN",
            valueNumber: 0.95 // تراجع العزم لصالح المزايدة المضادة
          }
        ],
        exitGate: "AND"
      },
      {
        regime: "COMPRESSION",
        breakevenR: 1.0, // حماية رأس مال عند +1.0R
        partials: [
          {
            profitR: 2.5, // جني أرباح جزئي 20% عند تحقيق انفجار أولي بنسبة +2.5R
            closePercent: 20
          }
        ],
        exitConditions: [
          {
            metric: "RVOL",
            operator: "LESS_THAN",
            valueNumber: 0.9 // انخفاض السيولة عما دون المتوسط
          },
          {
            metric: "OPEN_INTEREST",
            operator: "LESS_THAN",
            valueNumber: -1 // انخفاض كبير وتفريغ في العقود المفتوحة
          }
        ],
        exitGate: "AND"
      },
      {
        regime: "TRENDING",
        breakevenR: 0.8, // نقل وقف الخسارة عند تحقيق +0.8R
        partials: [
          {
            profitR: 1.5, // جني أرباح جزئي 20% عند +1.5R
            closePercent: 20
          }
        ],
        exitConditions: [
          {
            metric: "RVOL",
            operator: "LESS_THAN",
            valueNumber: 0.9 // تأكيد تباطؤ وتراجع عزم السيولة
          },
          {
            metric: "TAKER_RATIO",
            operator: "LESS_THAN",
            valueNumber: 0.98 // فقدان التفوق لصالح الاتجاه المعاكس
          }
        ],
        exitGate: "AND"
      }
    ],
    createdAt: '2026-06-02T21:30:00Z'
  },
  {
    id: 'hybrid_twin_engine_anti_chop_v4',
    name: 'توليفة الحماية الفولاذية ضد التذبذب والأثر الارتدادي (Anti-Chop & Sideways Protection)',
    description: 'توليفة مطورة خصيصاً لوقاية المحفظة من الفرم والمصائد في الأسواق المستقرة والتذبذب العرضي؛ تدمج مرشحات اتجاه ADX صارمة، وترشيح لسيولة هائلة RVOL، مع اتساع وقف الخسارة ATR لإبطال مفعول الذيول العشوائية.',
    creator: 'مجمع سنايبر الكمي المطور (Anti-Chop)',
    action: 'DUAL',
    gate: 'AND',
    conditions: [
      {
        id: 'global_val_chop_1',
        metric: 'TAKER_RATIO',
        operator: 'GREATER_THAN',
        valueType: 'NUMBER',
        valueNumber: 1.01,
        timeframe: '5m',
        sensitivity: 1.0
      },
      {
        id: 'global_val_chop_2',
        metric: 'RVOL',
        operator: 'GREATER_THAN',
        valueType: 'NUMBER',
        valueNumber: 1.5,
        timeframe: '5m',
        sensitivity: 1.0
      }
    ],
    allowedRegimes: [
      'TRENDING',
      'TREND_EXPANSION',
      'MOMENTUM_MODE'
    ],
    btcAlignmentRequired: false,
    minMarketConfidence: 60,
    leverage: 8,
    riskPerTrade: 1.2,
    stopLossMode: 'NONE',
    stopLossValue: 2.2,
    takeProfitMode: 'TRAILING_MOMENTUM',
    takeProfitValue: 3.5,
    longGate: 'AND',
    longConditions: [
      {
        id: 'global_long_rvol_chop',
        metric: 'RVOL',
        operator: 'GREATER_THAN',
        valueType: 'NUMBER',
        valueNumber: 1.5,
        timeframe: '5m',
        sensitivity: 1.0
      },
      {
        id: 'global_long_taker_chop',
        metric: 'TAKER_RATIO',
        operator: 'GREATER_THAN',
        valueType: 'NUMBER',
        valueNumber: 1.05,
        timeframe: '5m',
        sensitivity: 1.0
      }
    ],
    shortGate: 'AND',
    shortConditions: [
      {
        id: 'global_short_rvol_chop',
        metric: 'RVOL',
        operator: 'GREATER_THAN',
        valueType: 'NUMBER',
        valueNumber: 1.5,
        timeframe: '5m',
        sensitivity: 1.0
      },
      {
        id: 'global_short_taker_chop',
        metric: 'TAKER_RATIO',
        operator: 'LESS_THAN',
        valueType: 'NUMBER',
        valueNumber: 0.95,
        timeframe: '5m',
        sensitivity: 1.0
      }
    ],
    dynamicRegimeProfiles: [
      {
        regime: 'TREND_EXPANSION',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'gp_te_long_1_chop',
            metric: 'ADX',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 23,
            timeframe: '15m',
            sensitivity: 1.0
          },
          {
            id: 'gp_te_long_2_chop',
            metric: 'TAKER_RATIO',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.10,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        shortConditions: [
          {
            id: 'gp_te_short_1_chop',
            metric: 'ADX',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 23,
            timeframe: '15m',
            sensitivity: 1.0
          },
          {
            id: 'gp_te_short_2_chop',
            metric: 'TAKER_RATIO',
            operator: 'LESS_THAN',
            valueType: 'NUMBER',
            valueNumber: 0.90,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        stopLossMode: 'ATR_DYNAMIC',
        stopLossValue: 2.2,
        takeProfitMode: 'TRAILING_MOMENTUM',
        takeProfitValue: 4.0
      },
      {
        regime: 'MOMENTUM_MODE',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'gp_mm_long_1_chop',
            metric: 'TAKER_RATIO',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.15,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_mm_long_2_chop',
            metric: 'OPEN_INTEREST',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.0,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_mm_long_3_chop',
            metric: 'ADX',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 23,
            timeframe: '15m',
            sensitivity: 1.0
          }
        ],
        shortConditions: [
          {
            id: 'gp_mm_short_1_chop',
            metric: 'TAKER_RATIO',
            operator: 'LESS_THAN',
            valueType: 'NUMBER',
            valueNumber: 0.85,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_mm_short_2_chop',
            metric: 'OPEN_INTEREST',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.0,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_mm_short_3_chop',
            metric: 'ADX',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 23,
            timeframe: '15m',
            sensitivity: 1.0
          }
        ],
        stopLossMode: 'ATR_DYNAMIC',
        stopLossValue: 2.0,
        takeProfitMode: 'TRAILING_MOMENTUM',
        takeProfitValue: 4.5
      },
      {
        regime: 'LIQUIDITY_SWEEP',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'gp_lq_long_1_chop',
            metric: 'PRICE',
            operator: 'SWEEP_LOW_HIGH',
            valueType: 'NUMBER',
            valueNumber: 2,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        shortConditions: [
          {
            id: 'gp_lq_short_1_chop',
            metric: 'PRICE',
            operator: 'SWEEP_LOW_HIGH',
            valueType: 'NUMBER',
            valueNumber: 2,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        stopLossMode: 'SWEEP_LOW_BOUND',
        stopLossValue: 0.25,
        takeProfitMode: 'TRAILING_MOMENTUM',
        takeProfitValue: 2.5
      },
      {
        regime: 'COMPRESSION',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'gp_cp_long_1_chop',
            metric: 'OPEN_INTEREST',
            operator: 'SPIKE',
            valueType: 'NUMBER',
            valueNumber: 5,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_cp_long_2_chop',
            metric: 'RVOL',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.5,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        shortConditions: [
          {
            id: 'gp_cp_short_1_chop',
            metric: 'OPEN_INTEREST',
            operator: 'SPIKE',
            valueType: 'NUMBER',
            valueNumber: 5,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_cp_short_2_chop',
            metric: 'RVOL',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.5,
            timeframe: '5m',
            sensitivity: 1.0
          }
        ],
        stopLossMode: 'ATR_DYNAMIC',
        stopLossValue: 2.0,
        takeProfitMode: 'FUSION_CASCADE',
        takeProfitValue: 5.0
      },
      {
        regime: 'TRENDING',
        action: 'DUAL',
        gate: 'AND',
        conditions: [],
        longConditions: [
          {
            id: 'gp_tr_long_1_chop',
            metric: 'RVOL',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.5,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_tr_long_2_chop',
            metric: 'TAKER_RATIO',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.05,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_tr_long_3_chop',
            metric: 'ADX',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 23,
            timeframe: '15m',
            sensitivity: 1.0
          }
        ],
        shortConditions: [
          {
            id: 'gp_tr_short_1_chop',
            metric: 'RVOL',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 1.5,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_tr_short_2_chop',
            metric: 'TAKER_RATIO',
            operator: 'LESS_THAN',
            valueType: 'NUMBER',
            valueNumber: 0.95,
            timeframe: '5m',
            sensitivity: 1.0
          },
          {
            id: 'gp_tr_short_3_chop',
            metric: 'ADX',
            operator: 'GREATER_THAN',
            valueType: 'NUMBER',
            valueNumber: 23,
            timeframe: '15m',
            sensitivity: 1.0
          }
        ],
        stopLossMode: 'ATR_DYNAMIC',
        stopLossValue: 2.2,
        takeProfitMode: 'TRAILING_MOMENTUM',
        takeProfitValue: 3.0
      }
    ],
    dynamicExitProfiles: [
      {
        regime: "TREND_EXPANSION",
        breakevenR: 1.2,
        partials: [
          {
            profitR: 2.0,
            closePercent: 20
          },
          {
            profitR: 4.0,
            closePercent: 20
          }
        ],
        exitConditions: [
          {
            metric: "ADX",
            operator: "LESS_THAN",
            valueNumber: 20
          },
          {
            metric: "TAKER_RATIO",
            operator: "LESS_THAN",
            valueNumber: 0.95
          }
        ],
        exitGate: "AND"
      },
      {
        regime: "MOMENTUM_MODE",
        breakevenR: 0.8,
        partials: [
          {
            profitR: 1.5,
            closePercent: 30
          },
          {
            profitR: 3.0,
            closePercent: 20
          }
        ],
        exitConditions: [
          {
            metric: "TAKER_RATIO",
            operator: "LESS_THAN",
            valueNumber: 1.0
          },
          {
            metric: "OPEN_INTEREST",
            operator: "LESS_THAN",
            valueNumber: 0.0
          }
        ],
        exitGate: "AND"
      },
      {
        regime: "LIQUIDITY_SWEEP",
        breakevenR: 0.5,
        partials: [
          {
            profitR: 1.0,
            closePercent: 30
          }
        ],
        hardExitR: 2.0,
        exitConditions: [
          {
            metric: "TAKER_RATIO",
            operator: "LESS_THAN",
            valueNumber: 0.95
          }
        ],
        exitGate: "AND"
      },
      {
        regime: "COMPRESSION",
        breakevenR: 1.0,
        partials: [
          {
            profitR: 2.5,
            closePercent: 20
          }
        ],
        exitConditions: [
          {
            metric: "RVOL",
            operator: "LESS_THAN",
            valueNumber: 0.9
          },
          {
            metric: "OPEN_INTEREST",
            operator: "LESS_THAN",
            valueNumber: -1
          }
        ],
        exitGate: "AND"
      },
      {
        regime: "TRENDING",
        breakevenR: 1.0,
        partials: [
          {
            profitR: 1.5,
            closePercent: 20
          }
        ],
        exitConditions: [
          {
            metric: "RVOL",
            operator: "LESS_THAN",
            valueNumber: 0.9
          },
          {
            metric: "TAKER_RATIO",
            operator: "LESS_THAN",
            valueNumber: 0.98
          }
        ],
        exitGate: "AND"
      }
    ],
    createdAt: '2026-06-04T10:46:00Z'
  }
];

// Default configuration for custom/draft adaptive exit profiles fallback
const DEFAULT_DYNAMIC_EXIT_PROFILES: DynamicExitProfile[] = [
  {
    regime: "TREND_EXPANSION",
    breakevenR: 1.0,
    partials: [
      { profitR: 2.0, closePercent: 20 },
      { profitR: 4.0, closePercent: 20 }
    ],
    exitConditions: [
      { metric: "ADX", operator: "LESS_THAN", valueNumber: 20 },
      { metric: "TAKER_RATIO", operator: "LESS_THAN", valueNumber: 0.95 }
    ],
    exitGate: "AND"
  },
  {
    regime: "MOMENTUM_MODE",
    breakevenR: 0.5,
    partials: [
      { profitR: 1.5, closePercent: 30 },
      { profitR: 3.0, closePercent: 20 }
    ],
    exitConditions: [
      { metric: "TAKER_RATIO", operator: "LESS_THAN", valueNumber: 1.0 },
      { metric: "OPEN_INTEREST", operator: "LESS_THAN", valueNumber: 0.0 }
    ],
    exitGate: "AND"
  },
  {
    regime: "LIQUIDITY_SWEEP",
    breakevenR: 0.5,
    partials: [
      { profitR: 1.0, closePercent: 30 }
    ],
    hardExitR: 2.0,
    exitConditions: [
      { metric: "TAKER_RATIO", operator: "LESS_THAN", valueNumber: 0.95 }
    ],
    exitGate: "AND"
  },
  {
    regime: "COMPRESSION",
    breakevenR: 1.0,
    partials: [
      { profitR: 2.5, closePercent: 20 }
    ],
    exitConditions: [
      { metric: "RVOL", operator: "LESS_THAN", valueNumber: 0.9 },
      { metric: "OPEN_INTEREST", operator: "LESS_THAN", valueNumber: -1 }
    ],
    exitGate: "AND"
  },
  {
    regime: "TRENDING",
    breakevenR: 0.8,
    partials: [
      { profitR: 1.5, closePercent: 20 }
    ],
    exitConditions: [
      { metric: "RVOL", operator: "LESS_THAN", valueNumber: 0.9 },
      { metric: "TAKER_RATIO", operator: "LESS_THAN", valueNumber: 0.98 }
    ],
    exitGate: "AND"
  }
];

interface TawleefaBuilderProps {
  watchlist?: any[];
  settings?: any;
}

export function TawleefaBuilder({ watchlist = [], settings = {} }: TawleefaBuilderProps) {
  const [tawleefas, setTawleefas] = useState<TawleefaConfig[]>([]);
  const [activeTawleefa, setActiveTawleefa] = useState<TawleefaConfig | null>(null);
  
  // Form input editing helper states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gate, setGate] = useState<LogicGate>('AND');
  const [conditions, setConditions] = useState<ConditionRow[]>([]);
  const [action, setAction] = useState<RuleAction>('LONG');
  const [allowedRegimes, setAllowedRegimes] = useState<string[]>([]);
  const [btcAlignmentRequired, setBtcAlignmentRequired] = useState(false);
  const [minMarketConfidence, setMinMarketConfidence] = useState(60);
  const [leverage, setLeverage] = useState(10);
  const [riskPerTrade, setRiskPerTrade] = useState(1.0);
  const [stopLossMode, setStopLossMode] = useState<'ATR_DYNAMIC' | 'FIXED' | 'SWEEP_LOW_BOUND' | 'EXHAUSTION_CLOSE' | 'NONE'>('NONE');
  const [stopLossValue, setStopLossValue] = useState(1.5);
  const [takeProfitMode, setTakeProfitMode] = useState<'TRAILING_MOMENTUM' | 'FIXED_R' | 'FUSION_CASCADE'>('TRAILING_MOMENTUM');
  const [takeProfitValue, setTakeProfitValue] = useState(2.0);

  const [activeOnLiveBotId, setActiveOnLiveBotId] = useState<string | null>(null);

  // Selector for simulation settings
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('bull_trap_reversal');
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationResult, setSimulationResult] = useState<any | null>(null);
  const [simStepIndex, setSimStepIndex] = useState(0);
  const [displayedTicks, setDisplayedTicks] = useState<any[]>([]);
  const [displayedLogs, setDisplayedLogs] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [activeProfileTab, setActiveProfileTab] = useState<string>('TRENDING');
  const [activeEngineSubTab, setActiveEngineSubTab] = useState<'ENTRY' | 'EXIT'>('ENTRY');
  const [dynamicRegimeProfiles, setDynamicRegimeProfiles] = useState<RegimeProfile[] | undefined>(undefined);
  const [dynamicExitProfiles, setDynamicExitProfiles] = useState<DynamicExitProfile[]>(DEFAULT_DYNAMIC_EXIT_PROFILES);

  // Helper state variables for dual direction (DUAL LONG & SHORT) conditions support
  const [longConditions, setLongConditions] = useState<ConditionRow[]>([]);
  const [longGate, setLongGate] = useState<LogicGate>('AND');
  const [shortConditions, setShortConditions] = useState<ConditionRow[]>([]);
  const [shortGate, setShortGate] = useState<LogicGate>('AND');
  const [activeDualTab, setActiveDualTab] = useState<'LONG' | 'SHORT'>('LONG');

  // Load Tawleefas from local storage on mount
  useEffect(() => {
    // Check which Tawleefa is active on server
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.useTawleefaEngine && data.activeTawleefaJson) {
          try {
            const parsed = JSON.parse(data.activeTawleefaJson);
            setActiveOnLiveBotId(parsed.id);
          } catch (e) {}
        }
      })
      .catch(() => {});

    // Force wipe all old configurations and load the new master Tawleefa configuration
    localStorage.setItem('cust_tawleefas_v1', JSON.stringify(PRESET_TEMPLATES));
    setTawleefas(PRESET_TEMPLATES);
    loadTawleefaToForm(PRESET_TEMPLATES[0]);
  }, []);

  const handleActivateOnLiveBot = async (t: TawleefaConfig) => {
    try {
      const res = await fetch('/api/settings');
      const settings = await res.json();
      
      settings.useTawleefaEngine = true;
      settings.activeTawleefaJson = JSON.stringify(t);
      settings.useSteelEngine = false;
      settings.useCreativeEngine = false;

      const saveRes = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      
      if (saveRes.ok) {
        setActiveOnLiveBotId(t.id);
        alert(`⚡ تم تفعيل التوليفة "${t.name}" بنجاح على محرك البوت الحي!`);
      } else {
        alert('خطأ أثناء إرسال الإعدادات إلى السيرفر');
      }
    } catch (e: any) {
      alert(`فشل التفعيل: ${e.message}`);
    }
  };

  const handleDeactivateOnLiveBot = async () => {
    try {
      const res = await fetch('/api/settings');
      const settings = await res.json();
      
      settings.useTawleefaEngine = false;

      const saveRes = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      
      if (saveRes.ok) {
        setActiveOnLiveBotId(null);
        alert('ℹ️ تم إلغاء تفعيل محرك التوليفات؛ سيعود البوت الآن إلى الاستراتيجيات الافتراضية.');
      } else {
        alert('خطأ أثناء إرسال الإعدادات إلى السيرفر');
      }
    } catch (e: any) {
      alert(`فشل إلغاء التفعيل: ${e.message}`);
    }
  };

  const loadTawleefaToForm = (t: TawleefaConfig) => {
    setActiveTawleefa(t);
    setName(t.name);
    setDescription(t.description);
    setGate(t.gate);
    setConditions(t.conditions);
    setAction(t.action);
    setAllowedRegimes(t.allowedRegimes || []);
    setBtcAlignmentRequired(t.btcAlignmentRequired || false);
    setMinMarketConfidence(t.minMarketConfidence ?? 60);
    setLeverage(t.leverage ?? 10);
    setRiskPerTrade(t.riskPerTrade ?? 1.0);
    setStopLossMode(t.stopLossMode ?? 'ATR_DYNAMIC');
    setStopLossValue(t.stopLossValue ?? 1.5);
    setTakeProfitMode(t.takeProfitMode ?? 'TRAILING_MOMENTUM');
    setTakeProfitValue(t.takeProfitValue ?? 2.0);
    setDynamicRegimeProfiles(t.dynamicRegimeProfiles || undefined);
    
    // Load dual direction fields (or fallback to general conditions)
    setLongConditions(t.longConditions || t.conditions || []);
    setLongGate(t.longGate || t.gate || 'AND');
    setShortConditions(t.shortConditions || []);
    setShortGate(t.shortGate || 'AND');
  };

  const loadPresetIntoForm = (t: TawleefaConfig) => {
    setActiveTawleefa(null); // Fresh unsaved edit from preset
    setName(`${t.name} (نسخة مخصصة)`);
    setDescription(t.description);
    setGate(t.gate);
    setConditions(t.conditions.map(c => ({ ...c, id: Math.random().toString(36).substr(2, 9) })));
    setAction(t.action);
    setAllowedRegimes(t.allowedRegimes || []);
    setBtcAlignmentRequired(t.btcAlignmentRequired || false);
    setMinMarketConfidence(t.minMarketConfidence ?? 60);
    setLeverage(t.leverage ?? 10);
    setRiskPerTrade(t.riskPerTrade ?? 1.0);
    setStopLossMode(t.stopLossMode ?? 'ATR_DYNAMIC');
    setStopLossValue(t.stopLossValue ?? 1.5);
    setTakeProfitMode(t.takeProfitMode ?? 'TRAILING_MOMENTUM');
    setTakeProfitValue(t.takeProfitValue ?? 2.0);
    setDynamicRegimeProfiles(t.dynamicRegimeProfiles || undefined);

    // Load preset dual direction fields
    setLongConditions((t.longConditions || t.conditions || []).map(c => ({ ...c, id: Math.random().toString(36).substr(2, 9) })));
    setLongGate(t.longGate || t.gate || 'AND');
    setShortConditions((t.shortConditions || []).map(c => ({ ...c, id: Math.random().toString(36).substr(2, 9) })));
    setShortGate(t.shortGate || 'AND');
  };

  const addConditionRow = () => {
    const newCond: ConditionRow = {
      id: Math.random().toString(36).substr(2, 9),
      metric: 'PRICE',
      operator: 'GREATER_THAN',
      valueType: 'NUMBER',
      valueNumber: 0,
      timeframe: '5m',
      sensitivity: 1.0
    };
    if (action === 'DUAL') {
      if (activeDualTab === 'LONG') {
        setLongConditions([...longConditions, newCond]);
      } else {
        setShortConditions([...shortConditions, newCond]);
      }
    } else {
      setConditions([...conditions, newCond]);
    }
  };

  const removeConditionRow = (id: string) => {
    if (action === 'DUAL') {
      if (activeDualTab === 'LONG') {
        setLongConditions(longConditions.filter(c => c.id !== id));
      } else {
        setShortConditions(shortConditions.filter(c => c.id !== id));
      }
    } else {
      setConditions(conditions.filter(c => c.id !== id));
    }
  };

  const updateConditionRow = (id: string, field: keyof ConditionRow, val: any) => {
    if (action === 'DUAL') {
      if (activeDualTab === 'LONG') {
        setLongConditions(longConditions.map(c => c.id === id ? { ...c, [field]: val } : c));
      } else {
        setShortConditions(shortConditions.map(c => c.id === id ? { ...c, [field]: val } : c));
      }
    } else {
      setConditions(conditions.map(c => {
        if (c.id === id) {
          return { ...c, [field]: val };
        }
        return c;
      }));
    }
  };

  // Safe Dynamic Exit Profiles Interactive Helpers
  const handleAddExitCondition = (regimeReg: string) => {
    const updated = dynamicExitProfiles.map(p => {
      if (p.regime === regimeReg) {
        const exitConditions = p.exitConditions ? [...p.exitConditions] : [];
        return {
          ...p,
          exitConditions: [
            ...exitConditions,
            { metric: 'TAKER_RATIO' as any, operator: 'LESS_THAN' as any, valueNumber: 0.95 }
          ]
        };
      }
      return p;
    });
    setDynamicExitProfiles(updated);
  };

  const handleRemoveExitCondition = (regimeReg: string, index: number) => {
    const updated = dynamicExitProfiles.map(p => {
      if (p.regime === regimeReg) {
        const exitConditions = p.exitConditions ? p.exitConditions.filter((_, idx) => idx !== index) : [];
        return {
          ...p,
          exitConditions
        };
      }
      return p;
    });
    setDynamicExitProfiles(updated);
  };

  const handleUpdateExitCondition = (regimeReg: string, index: number, field: keyof DynamicExitCondition, value: any) => {
    const updated = dynamicExitProfiles.map(p => {
      if (p.regime === regimeReg) {
        const exitConditions = p.exitConditions ? p.exitConditions.map((c, idx) => {
          if (idx === index) {
            return { ...c, [field]: value };
          }
          return c;
        }) : [];
        return {
          ...p,
          exitConditions
        };
      }
      return p;
    });
    setDynamicExitProfiles(updated);
  };

  const handleUpdateExitGate = (regimeReg: string, gateVal: 'AND' | 'OR') => {
    const updated = dynamicExitProfiles.map(p => {
      if (p.regime === regimeReg) {
        return {
          ...p,
          exitGate: gateVal
        };
      }
      return p;
    });
    setDynamicExitProfiles(updated);
  };

  const handleUpdateExitParams = (regimeReg: string, field: 'breakevenR' | 'hardExitR', value: number | undefined) => {
    const updated = dynamicExitProfiles.map(p => {
      if (p.regime === regimeReg) {
        return {
          ...p,
          [field]: value
        };
      }
      return p;
    });
    setDynamicExitProfiles(updated);
  };

  const handleSaveTawleefa = () => {
    if (!name.trim()) {
      alert('الرجاء إدخال اسم للتوليفة الجديدة!');
      return;
    }

    const compiled: TawleefaConfig = {
      id: activeTawleefa?.id || Math.random().toString(36).substr(2, 9),
      name,
      description,
      creator: 'المشغل (أنت)',
      gate,
      conditions,
      action,
      allowedRegimes,
      btcAlignmentRequired,
      minMarketConfidence,
      leverage,
      riskPerTrade,
      stopLossMode,
      stopLossValue,
      takeProfitMode,
      takeProfitValue,
      dynamicRegimeProfiles,
      dynamicExitProfiles,
      longConditions,
      longGate,
      shortConditions,
      shortGate,
      createdAt: activeTawleefa?.createdAt || new Date().toISOString()
    };

    const updated = tawleefas.filter(t => t.id !== compiled.id);
    const newTawleefas = [compiled, ...updated];
    setTawleefas(newTawleefas);
    setActiveTawleefa(compiled);
    localStorage.setItem('cust_tawleefas_v1', JSON.stringify(newTawleefas));

    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 3000);
  };

  const handleDeleteTawleefa = (id: string) => {
    if (confirm('هل أنت متأكد من رغبتك في حذف هذه التوليفة بالكامل؟')) {
      const filtered = tawleefas.filter(t => t.id !== id);
      setTawleefas(filtered);
      localStorage.setItem('cust_tawleefas_v1', JSON.stringify(filtered));
      if (filtered.length > 0) {
        loadTawleefaToForm(filtered[0]);
      } else {
        setName('');
        setDescription('');
        setConditions([]);
      }
    }
  };

  const toggleRegimeFilter = (regime: string) => {
    if (allowedRegimes.includes(regime)) {
      setAllowedRegimes(allowedRegimes.filter(r => r !== regime));
    } else {
      setAllowedRegimes([...allowedRegimes, regime]);
    }
  };

  // Export Custom System config as JSON representation
  const handleExportJSON = () => {
    const raw = {
      appId: 'sniper-tawleefa-system',
      exportVersion: '1.0',
      activeConfig: {
        name,
        description,
        gate,
        conditions,
        action,
        allowedRegimes,
        btcAlignmentRequired,
        minMarketConfidence,
        leverage,
        riskPerTrade,
        stopLossMode,
        stopLossValue,
        takeProfitMode,
        takeProfitValue,
        dynamicRegimeProfiles,
        dynamicExitProfiles,
        longConditions,
        longGate,
        shortConditions,
        shortGate
      }
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(raw, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href",     dataStr     );
    dlAnchorElem.setAttribute("download", `tawleefa_${name.toLowerCase().replace(/\s+/g, '_')}.json`);
    dlAnchorElem.click();
  };

  // Handling JSON upload configuration file
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileReader = new FileReader();
    fileReader.onload = event => {
      try {
        const obj = JSON.parse(event.target?.result as string);
        if (obj.appId === 'sniper-tawleefa-system' && obj.activeConfig) {
          const cfg = obj.activeConfig;
          setName(cfg.name + ' (مستورد)');
          setDescription(cfg.description || '');
          setGate(cfg.gate || 'AND');
          setConditions(cfg.conditions || []);
          setAction(cfg.action || 'LONG');
          setAllowedRegimes(cfg.allowedRegimes || []);
          setBtcAlignmentRequired(cfg.btcAlignmentRequired || false);
          setMinMarketConfidence(cfg.minMarketConfidence || 60);
          setLeverage(cfg.leverage || 10);
          setRiskPerTrade(cfg.riskPerTrade || 1.0);
          setStopLossMode(cfg.stopLossMode || 'ATR_DYNAMIC');
          setStopLossValue(cfg.stopLossValue || 1.5);
          setTakeProfitMode(cfg.takeProfitMode || 'TRAILING_MOMENTUM');
          setTakeProfitValue(cfg.takeProfitValue || 2.0);
          setDynamicRegimeProfiles(cfg.dynamicRegimeProfiles || undefined);
          setDynamicExitProfiles(cfg.dynamicExitProfiles || DEFAULT_DYNAMIC_EXIT_PROFILES);
          setLongConditions(cfg.longConditions || cfg.conditions || []);
          setLongGate(cfg.longGate || cfg.gate || 'AND');
          setShortConditions(cfg.shortConditions || []);
          setShortGate(cfg.shortGate || 'AND');
          setActiveTawleefa(null);
          alert('تم استيراد التوليفة ومواصفات الفلو بنجاح! يمكنك مراجعتها وحفظها.');
        } else {
          alert('ملف الاستيراد غير صالح أو غير مهيأ لنظام التوليفات!');
        }
      } catch (err) {
        alert('حدث خطأ أثناء قراءة الملف وتفسيره!');
      }
    };
    fileReader.readAsText(files[0]);
  };

  // -------------------------------------------------------------
  // HIGH FIDELITY SIMULATOR ENGINE (INTERPRETER RUNTIME)
  // -------------------------------------------------------------
  
  // Synthetic Data Generator corresponding to standard market conditions
  const generateSimScenario = (scenarioId: string): SimulatorScenario => {
    const ticks: SimulatedTick[] = [];
    if (scenarioId === 'bull_trap_reversal') {
      // High momentum false breakout
      let basePrice = 120.0;
      let baseOi = 4800000;
      let baseCvd = -50.0;
      for (let i = 1; i <= 40; i++) {
        let priceChange = 0;
        let oiChange = 0;
        let cvdChange = 0;
        let tr = 1.0;
        
        if (i < 12) {
          // Normal accumulation
          priceChange = Math.sin(i / 2) * 0.2;
          oiChange = 10000 + Math.random() * 5000;
          cvdChange = 0.5 + Math.random();
          tr = 1.02;
        } else if (i >= 12 && i < 22) {
          // False aggressive breakout
          priceChange = 0.8 + (22 - i) * 0.05 + Math.random() * 0.2;
          oiChange = 95000 + Math.random() * 20000; // HUGE OI SPIKE
          cvdChange = 6.0 + Math.random() * 2; // CVD EUPHORIC BUT STALLING AT THE END
          tr = 1.18; // Heavy taker long buying
        } else if (i >= 22 && i < 28) {
          // STALL + Exhaustion Divergence
          priceChange = 0.02 - Math.random() * 0.1; // flat-ish or small decline
          oiChange = 15000 + (25 - i) * 10000; // still high but decelerating
          cvdChange = 4.0 + Math.random() * 1; // CVD keeps climbing but price stalled! DIVERGENCING
          tr = 0.94; // taker buyer exhaustion
        } else {
          // Sharp reverse drop (Trap activated!)
          priceChange = -1.2 - Math.random() * 0.5;
          oiChange = -120000; // catastrophic OI drop (liquidation cascade)
          cvdChange = -12.0;
          tr = 0.82;
        }
        
        basePrice += priceChange;
        baseOi += oiChange;
        baseCvd += cvdChange;
        
        const adx = i < 15 ? 18 : 12 + i * 0.5;
        const rsi = i < 12 ? 50 : i < 22 ? 55 + (i - 12) * 2.5 : 78 - (i - 25) * 4;
        ticks.push({
          step: i,
          time: 1716912000 + i * 300,
          price: Number(basePrice.toFixed(3)),
          openInterest: Number(baseOi.toFixed(0)),
          volume: i < 12 ? 150000 : i < 22 ? 1200000 : 450000,
          takerRatio: Number(tr.toFixed(3)),
          fundingRate: 0.0001 + (i / 1000) * (i > 15 ? 1.5 : 1),
          atr: 0.45,
          adx: Number(adx.toFixed(1)),
          cvd: Number(baseCvd.toFixed(1)),
          rsi: Number(rsi.toFixed(1))
        });
      }
      return {
        id: 'bull_trap_reversal',
        name: 'سيناريو الاختراق الهوسي المزيف (Bullish Mania Trap)',
        description: 'يشهد انفجاراً صعودياً في السعر مع قفزة جنونية في الفائدة المفتوحة CVD، متبوعة بجمود سعري بالقمة، وانحطاط الدلتا، ثم تراجعاً وانزلاقاً عمودياً هابطاً لتصفية المتداولين الصاعدين.',
        regime: 'TRAP_MODE',
        ticks
      };
    } else {
      // Panic Selloff Accumulation Sweep
      let basePrice = 85.0;
      let baseOi = 3200000;
      let baseCvd = 10.0;
      for (let i = 1; i <= 40; i++) {
        let priceChange = 0;
        let oiChange = 0;
        let cvdChange = 0;
        let tr = 1.0;
        
        if (i < 10) {
          priceChange = -0.15 + (Math.random() - 0.5) * 0.1;
          oiChange = 2000;
          cvdChange = -0.5;
          tr = 0.98;
        } else if (i >= 10 && i < 22) {
          // Panic selloff dump
          priceChange = -0.9 - (22 - i) * 0.06 - Math.random() * 0.2;
          oiChange = 75000 + Math.random() * 15000; // Open interest building up (Shorters stacking)
          cvdChange = -8.0 - Math.random() * 3; // CVD falling off a cliff! Panic CVD
          tr = 0.85; // Heavy taker sell aggressive shorts
        } else if (i >= 22 && i < 26) {
          // Sweep of candle low & absorb
          priceChange = (i === 22 || i === 23) ? -0.4 : 0.15; // Sweep previous low, then immediately pull back inside!
          oiChange = 110000; // extreme short accumulation
          cvdChange = -1.0; // CVD stops falling! divergence!
          tr = 1.08; // Buyers absorbing aggressive shorts
        } else {
          // Bullish Rebound squeeze
          priceChange = 1.1 + Math.random() * 0.4;
          oiChange = -150000; // Shorters getting squeezed out (OI drops)
          cvdChange = 8.0;
          tr = 1.15;
        }
        
        basePrice += priceChange;
        baseOi += oiChange;
        baseCvd += cvdChange;
        
        const adx = i < 10 ? 15 : 12 + i * 0.6;
        const rsi = i < 10 ? 45 : i < 22 ? 45 - (i - 10) * 2.5 : 20 + (i - 22) * 5;
        ticks.push({
          step: i,
          time: 1716912000 + i * 300,
          price: Number(basePrice.toFixed(3)),
          openInterest: Number(baseOi.toFixed(0)),
          volume: i >= 10 && i < 22 ? 1450000 : 250000,
          takerRatio: Number(tr.toFixed(3)),
          fundingRate: 0.0001 - (i / 1500),
          atr: 0.35,
          adx: Number(adx.toFixed(1)),
          cvd: Number(baseCvd.toFixed(1)),
          rsi: Number(rsi.toFixed(1))
        });
      }
      return {
        id: 'panic_selloff_sweep',
        name: 'سيناريو المذبحة وتصفية الذعر (Panic Sweep & Squeeze)',
        description: 'هبوط عمودي كابوسي يخلق حالة ذعر شديدة (Panic Selling)، يبدأ السعر عندها بكسر القيعان السابقة ثم تكتمل وتتحول لسيولة ممتصة، ويبدأ شورت كويز ناتج عن هروب البائعين ومشتريات الحيتان الصاعدة.',
        regime: 'LIQUIDITY_SWEEP',
        ticks
      };
    }
  };

  // Run the customized simulator interpreter
  const handleRunSimulator = () => {
    setSimulationRunning(true);
    setSimStepIndex(0);
    setDisplayedTicks([]);
    setDisplayedLogs([]);
    
    const scenario = generateSimScenario(selectedScenarioId);
    
    // Evaluate entire run beforehand
    const logs: string[] = [`[بداية المحاكاة] تشغيل سيناريو: ${scenario.name}...`];
    
    // Resolve dynamic regime configuration profile if present:
    let activeConditions = conditions;
    let activeGate = gate;
    let activeAction = action;
    let activeStopLossMode = stopLossMode;
    let activeStopLossValue = stopLossValue;
    let activeTakeProfitMode = takeProfitMode;
    let activeTakeProfitValue = takeProfitValue;
    let usingProfile = false;

    // Dual direction helper lists
    let activeLongConditions = longConditions;
    let activeLongGate = longGate;
    let activeShortConditions = shortConditions;
    let activeShortGate = shortGate;

    // Use currentProfiles state if activeTawleefa doesn't contain it yet
    const currentProfiles = activeTawleefa?.dynamicRegimeProfiles || dynamicRegimeProfiles;
    if (currentProfiles && Array.isArray(currentProfiles) && currentProfiles.length > 0) {
      const matchedProfile = currentProfiles.find((p: any) => p.regime === scenario.regime);
      if (matchedProfile) {
        activeConditions = matchedProfile.conditions;
        activeGate = matchedProfile.gate;
        activeAction = matchedProfile.action;
        activeStopLossMode = matchedProfile.stopLossMode;
        activeStopLossValue = matchedProfile.stopLossValue;
        activeTakeProfitMode = matchedProfile.takeProfitMode;
        activeTakeProfitValue = matchedProfile.takeProfitValue;
        usingProfile = true;

        activeLongConditions = matchedProfile.longConditions || matchedProfile.conditions || [];
        activeLongGate = matchedProfile.longGate || matchedProfile.gate || 'AND';
        activeShortConditions = matchedProfile.shortConditions || [];
        activeShortGate = matchedProfile.shortGate || 'AND';
        logs.push(`[⭐ نظام متكيف] تم التعرف على ريجيم السوق المالي المفعّل [${scenario.regime}] تلقائياً وتحويل المحرك إلى التوليفة الفرعية المطابقة بنجاح! ⚡`);
      }
    }

    logs.push(`[تفسير التوليفة] جاري فحص الشروط وتحديد اتجاه الدخول [${activeAction}]...`);
    
    let position: 'LONG' | 'SHORT' | null = null;
    let entryPrice = 0;
    let slPrice = 0;
    let tpPrice = 0;
    let resultStatus = 'NO_TRADE';
    let peakPnL = 0;
    let maxDrawdown = 0;
    let pnl = 0;
    let tradeHistory: any[] = [];
    let isBreakeven = false;
    let isPartialProfitTaken = false;
    let peakPrice = 0;

    const evaluateConds = (condsList: any[], tick: any, rvol: number, isOISpiking: boolean, rsiCrossoverAbove30: boolean, lowPriceSweep: boolean, cvdDivergening: boolean, momentumExhaustion: boolean) => {
      return condsList.map(cond => {
        let actualVal = 0;
        let isTrue = false;
        
        switch (cond.metric) {
          case 'PRICE':
            if (cond.operator === 'SWEEP_LOW_HIGH') {
              isTrue = lowPriceSweep;
            } else {
              actualVal = tick.price;
            }
            break;
          case 'OPEN_INTEREST':
            if (cond.operator === 'SPIKE') {
              isTrue = isOISpiking;
            } else {
              actualVal = tick.openInterest;
            }
            break;
          case 'CVD':
            if (cond.operator === 'DIVERGENCING') {
              isTrue = cvdDivergening;
            } else {
              actualVal = tick.cvd;
            }
            break;
          case 'RVOL':
            actualVal = rvol;
            break;
          case 'TAKER_RATIO':
            actualVal = tick.takerRatio;
            break;
          case 'FUNDING_RATE':
            actualVal = tick.fundingRate;
            break;
          case 'RSI':
            actualVal = tick.rsi;
            break;
          case 'ADX':
            actualVal = tick.adx;
            break;
        }

        if (cond.operator === 'GREATER_THAN') {
          isTrue = actualVal > cond.valueNumber;
        } else if (cond.operator === 'LESS_THAN') {
          isTrue = actualVal < cond.valueNumber;
        } else if (cond.operator === 'CROSSES_ABOVE' && cond.metric === 'RSI') {
          isTrue = rsiCrossoverAbove30;
        } else if (cond.operator === 'EXHAUSTION' && cond.metric === 'PRICE') {
          isTrue = momentumExhaustion;
        }

        return { ...cond, isTrue, actualVal };
      });
    };
    
    const processedTicks = scenario.ticks.map((tick, index) => {
      // Calculate indicators/features based on rolling slice
      const history = scenario.ticks.slice(0, index + 1);
      const prevTick = index > 0 ? scenario.ticks[index - 1] : null;
      
      // Feature calculations:
      const rvol = tick.volume / 300000; // Simulated RVOL
      const isOISpiking = prevTick ? (tick.openInterest - prevTick.openInterest) / prevTick.openInterest > 0.05 : false;
      
      // Crossover evaluations
      const rsiCrossoverBelow30 = prevTick ? prevTick.rsi > 30 && tick.rsi <= 30 : false;
      const rsiCrossoverAbove30 = prevTick ? prevTick.rsi < 30 && tick.rsi >= 30 : false;
      const cvdDivergening = index > 4 ? evaluateDivergence(history) : false;
      const lowPriceSweep = index > 5 ? evaluateSweep(history) : false;
      const momentumExhaustion = index > 4 ? evaluateExhaustion(history) : false;

      let conditionsEvaluation: any[] = [];
      let triggerSignal = false;
      let detectedDirection: 'LONG' | 'SHORT' = 'LONG';

      if (activeAction === 'DUAL') {
        const evalLongs = evaluateConds(activeLongConditions || [], tick, rvol, isOISpiking, rsiCrossoverAbove30, lowPriceSweep, cvdDivergening, momentumExhaustion);
        const evalShorts = evaluateConds(activeShortConditions || [], tick, rvol, isOISpiking, rsiCrossoverAbove30, lowPriceSweep, cvdDivergening, momentumExhaustion);

        const longGateValRaw = activeLongGate || 'AND';
        const longGateVal = typeof longGateValRaw === 'string' ? longGateValRaw.trim().toUpperCase() : 'AND';
        const shortGateValRaw = activeShortGate || 'AND';
        const shortGateVal = typeof shortGateValRaw === 'string' ? shortGateValRaw.trim().toUpperCase() : 'AND';

        const longTriggered = evalLongs.length > 0 && (longGateVal === 'AND' ? evalLongs.every(c => c.isTrue) : evalLongs.some(c => c.isTrue));
        const shortTriggered = evalShorts.length > 0 && (shortGateVal === 'AND' ? evalShorts.every(c => c.isTrue) : evalShorts.some(c => c.isTrue));

        if (longTriggered && !shortTriggered) {
          triggerSignal = true;
          detectedDirection = 'LONG';
          conditionsEvaluation = evalLongs.map(c => ({...c, metric: `LONG: ${c.metric}`}));
        } else if (shortTriggered && !longTriggered) {
          triggerSignal = true;
          detectedDirection = 'SHORT';
          conditionsEvaluation = evalShorts.map(c => ({...c, metric: `SHORT: ${c.metric}`}));
        } else if (longTriggered && shortTriggered) {
          triggerSignal = true;
          detectedDirection = 'LONG';
          conditionsEvaluation = evalLongs.map(c => ({...c, metric: `LONG: ${c.metric}`}));
        } else {
          triggerSignal = false;
          conditionsEvaluation = [
            ...evalLongs.map(c => ({...c, metric: `LONG: ${c.metric}`})),
            ...evalShorts.map(c => ({...c, metric: `SHORT: ${c.metric}`}))
          ];
        }
      } else {
        conditionsEvaluation = evaluateConds(activeConditions, tick, rvol, isOISpiking, rsiCrossoverAbove30, lowPriceSweep, cvdDivergening, momentumExhaustion);
        if (conditionsEvaluation.length > 0) {
          const activeGateNormalized = typeof activeGate === 'string' ? activeGate.trim().toUpperCase() : 'AND';
          triggerSignal = activeGateNormalized === 'AND' ? conditionsEvaluation.every(c => c.isTrue) : conditionsEvaluation.some(c => c.isTrue);
        }
        detectedDirection = activeAction === 'LONG' || activeAction === 'SHORT' ? (activeAction as 'LONG' | 'SHORT') : 'LONG';
      }

      // Check regime whitelist mapping
      const regimeMatch = usingProfile || allowedRegimes.length === 0 || allowedRegimes.includes(scenario.regime);
      if (triggerSignal && !regimeMatch) {
         triggerSignal = false; // blocked by lifestyle/environment regime
      }

      // Position logic simulation
      let eventMsg = "";
      let tickPnL = 0;
      
      if (!position && triggerSignal) {
        // Trigger position entry!
        position = detectedDirection;
        entryPrice = tick.price;
        resultStatus = 'ACTIVE';
        isBreakeven = false;
        isPartialProfitTaken = false;
        peakPrice = entryPrice;
        
        // Calculate SL TP based on selected modes
        if (activeStopLossMode === 'ATR_DYNAMIC') {
          slPrice = position === 'LONG' ? entryPrice - (tick.atr * activeStopLossValue) : entryPrice + (tick.atr * activeStopLossValue);
        } else if (activeStopLossMode === 'FIXED') {
          slPrice = position === 'LONG' ? entryPrice * (1 - (activeStopLossValue / 100)) : entryPrice * (1 + (activeStopLossValue / 100));
        } else if (activeStopLossMode === 'SWEEP_LOW_BOUND') {
          slPrice = position === 'LONG' ? entryPrice - 0.5 : entryPrice + 0.5; // Sweep relative
        } else {
          slPrice = position === 'LONG' ? entryPrice - 1.2 : entryPrice + 1.2;
        }

        if (activeTakeProfitMode === 'FIXED_R') {
          const slDistance = Math.abs(entryPrice - slPrice);
          tpPrice = position === 'LONG' ? entryPrice + (slDistance * activeTakeProfitValue) : entryPrice - (slDistance * activeTakeProfitValue);
        } else {
          // Dynamic trail or progressive exit targets
          tpPrice = position === 'LONG' ? entryPrice * (1 + (activeTakeProfitValue / 100)) : entryPrice * (1 - (activeTakeProfitValue / 100));
        }

        eventMsg = `🎯 [إشارة تميز] تفعيل صفقة ${position} بسعر Entry: ${entryPrice} $ ! شروط البث متطابقة بالبوابة المتكاملة! 🚀`;
      } else if (position) {
        // Evaluate exits (TP or SL)
        const currentPrice = tick.price;
        const isLong = position === 'LONG';
        
        // Maintain peak price for trailing:
        if (isLong) {
          peakPrice = Math.max(peakPrice, currentPrice);
        } else {
          if (peakPrice === 0) peakPrice = currentPrice;
          peakPrice = Math.min(peakPrice, currentPrice);
        }

        // PNL calculation based on leverage
        const priceChangePerc = isLong
          ? ((currentPrice - entryPrice) / entryPrice) * 100
          : ((entryPrice - currentPrice) / entryPrice) * 100;

        tickPnL = priceChangePerc * leverage;
        peakPnL = Math.max(peakPnL, tickPnL);
        maxDrawdown = Math.min(maxDrawdown, tickPnL);
        pnl = tickPnL;

        // Check if hit SL or TP
        let hitSL = false;
        let hitTP = false;
        let closedBySavage = false;

        const isSavageExitMode = activeTakeProfitMode === 'FUSION_CASCADE' || activeTakeProfitMode === 'TRAILING_MOMENTUM';

        // 1. ULTRA-FAST BREAKEVEN GUARD (التأمين الفولاذي اللحظي المستميت)
        if (isSavageExitMode && !isBreakeven && priceChangePerc >= 0.20) {
          const buffer = 1.0006;
          slPrice = isLong ? entryPrice * buffer : entryPrice * (2 - buffer);
          isBreakeven = true;
          eventMsg = `🛡️ [تأمين الدخول الشرس] تم سحب طوارئ وقف الخسارة تلقائياً لتأمين العمولات وتجنب انعكاس الحركة!`;
        }

        // 2. CASCADING PARTIAL TAKE PROFIT (جني الأرباح المتدرج الصارم)
        const tp1Goal = activeTakeProfitValue * 0.45;
        if (isSavageExitMode && !isPartialProfitTaken && priceChangePerc >= tp1Goal) {
          isPartialProfitTaken = true;
          eventMsg = `💸 [جني جزئي شرس] تسييل 50% من العقود لتثبيت الأرباح بمعدل +${priceChangePerc.toFixed(2)}%! سحب الوقف لـ +0.15% أرباح مأمونة!`;
          const profitCushion = 1.0015;
          slPrice = isLong ? entryPrice * profitCushion : entryPrice * (2 - profitCushion);
        }

        // 3. SLY FOX PRE-EMPTIVE REVERSAL ESCAPE (مخرج الطوارئ الزخمي الاستباقي)
        if (isSavageExitMode && !closedBySavage && priceChangePerc >= 0.1) {
          let triggerEscape = false;
          let escapeReason = "";

          if (isLong && tick.takerRatio < 0.94) {
            triggerEscape = true;
            escapeReason = "تراجع الشراء المؤسساتي (Taker < 0.94)";
          } else if (!isLong && tick.takerRatio > 1.06) {
            triggerEscape = true;
            escapeReason = "عكس الزخم وتكالب البائعين (Taker > 1.06)";
          }

          if (tick.rsi && ((isLong && tick.rsi > 70) || (!isLong && tick.rsi < 30))) {
            triggerEscape = true;
            escapeReason = "إنهاك مؤشر القوة النسبية القصوى (RSI Peak)";
          }

          if (triggerEscape) {
            closedBySavage = true;
            eventMsg = `🦊 [مخرج ثعلب الذهب] تصفية استباقية وتأمين المكسب الفعلي +${priceChangePerc.toFixed(2)}% لعروض طافية! [${escapeReason}]`;
            pnl = tickPnL;
            resultStatus = 'SUCCESS';
            position = null;
          }
        }

        // 4. SAVAGE TRAILING SQUEEZE (ملاحقة السقف المجهري المطاطي للمكاسب الكبيرة)
        if (isSavageExitMode && !closedBySavage && priceChangePerc >= activeTakeProfitValue * 0.6) {
          const dropFromPeak = isLong
            ? ((peakPrice - currentPrice) / peakPrice) * 100
            : ((currentPrice - peakPrice) / peakPrice) * 100;
          
          const squeezeLimit = activeTakeProfitMode === 'FUSION_CASCADE' ? 0.15 : 0.22;
          if (dropFromPeak >= squeezeLimit) {
            closedBySavage = true;
            eventMsg = `🦅 [اقتناص الحافة الشرسة] تسييل كامل الباقي من الصفقة بعد ارتداد السعر بمقدار ${dropFromPeak.toFixed(2)}% من أعلى ذروة! ربح محقق: +${priceChangePerc.toFixed(2)}%!`;
            pnl = tickPnL;
            resultStatus = 'SUCCESS';
            position = null;
          }
        }

        // 5. Hard boundary conditions if not closed already
        if (!closedBySavage) {
          if (isLong) {
            if (currentPrice <= slPrice) hitSL = true;
            if (currentPrice >= tpPrice) hitTP = true;
          } else {
            if (currentPrice >= slPrice) hitSL = true;
            if (currentPrice <= tpPrice) hitTP = true;
          }

          if (hitSL) {
            const isProfitHedged = isBreakeven || isPartialProfitTaken;
            eventMsg = isProfitHedged
              ? `🔐 [إغلاق بأمان وتأمين أرباح] تم الخرج الآمن عند ${currentPrice} $ برأس مال آمن بالكامل!`
              : `🛑 [وقف الخسارة] تم ضرب وقف الخسارة الديناميكي عند سعر ${currentPrice} $. خسارة محققة: ${tickPnL.toFixed(2)}% !`;
            pnl = isProfitHedged ? 0.05 * leverage : -Math.abs(slPrice - entryPrice)/entryPrice * 100 * leverage;
            resultStatus = isProfitHedged ? 'SUCCESS' : 'STOPPED_OUT';
            position = null;
          } else if (hitTP) {
            eventMsg = `🏆 [النصر الذهبي للتوليفة] تسييل الصفقة بالكامل وتحقيق الهدف الأقصى عند ${currentPrice} $. ربح محقق كلي: +${priceChangePerc.toFixed(2)}% !!! ⭐`;
            pnl = tickPnL;
            resultStatus = 'SUCCESS';
            position = null;
          }
        }
      }

      return {
        ...tick,
        pnl: position ? tickPnL : (resultStatus === 'SUCCESS' ? pnl : (resultStatus === 'STOPPED_OUT' ? pnl : 0)),
        isActive: !!position,
        eventMsg,
        entryPrice: position ? entryPrice : undefined,
        slPrice: position ? slPrice : undefined,
        tpPrice: position ? tpPrice : undefined,
        regime: scenario.regime,
        // SAVE EXTRA STATS FOR RICH LOGS:
        conditionsEvaluation,
        activeGate,
        activeAction,
        triggerSignal,
        regimeMatch,
        usingProfile
      };
    });

    // Start tick streaming
    const runningTicks: any[] = [];
    const runLogs: string[] = [...logs];
    
    let intervalId = setInterval(() => {
      setSimStepIndex(prev => {
        if (prev < processedTicks.length) {
          const currentTick = processedTicks[prev];
          runningTicks.push(currentTick);
          setDisplayedTicks([...runningTicks]);
          
          // 1. Log Market Regime and Asset States
          const regimeAr = currentTick.regime === 'TRENDING' ? 'اتجاهي صاعد (TRENDING)' :
                           currentTick.regime === 'LIQUIDITY_SWEEP' ? 'صيد سيولة القيعان (LIQUIDITY_SWEEP)' :
                           currentTick.regime === 'COMPRESSION' ? 'انضغاط سعري/نطاق ضيق (COMPRESSION)' :
                           currentTick.regime === 'TRAP_MODE' ? 'مصيدة البائعين والمشترين (TRAP_MODE)' : currentTick.regime;

          const metricsStr = `السعر: ${currentTick.price.toFixed(2)}$ | RVOL: ${(currentTick.volume / 300000).toFixed(2)} | RSI: ${currentTick.rsi.toFixed(1)} | CVD: ${currentTick.cvd.toFixed(1)}`;
          runLogs.push(`[الخطوة ${currentTick.step}] 🌐 ريجيم السوق: ${regimeAr} | 📊 ${metricsStr}`);

          // 2. Format result of conditions evaluation
          if (currentTick.conditionsEvaluation && currentTick.conditionsEvaluation.length > 0) {
            const gateChar = currentTick.activeGate === 'AND' ? ' ➕ ' : ' ➖ ';
            const condsLog = currentTick.conditionsEvaluation.map((c: any) => {
              const marker = c.isTrue ? '✅' : '❌';
              const opSym = c.operator === 'GREATER_THAN' ? 'أكبر من' :
                            c.operator === 'LESS_THAN' ? 'أصغر من' :
                            c.operator === 'CROSSES_ABOVE' ? 'يخترق صعوداً' :
                            c.operator === 'SWEEP_LOW_HIGH' ? 'اختبار قاع/قمة' : c.operator;
              
              const valNumStr = c.valueNumber !== 0 ? ` ${c.valueNumber}` : '';
              return `[${c.metric} ${opSym}${valNumStr} : ${c.actualVal?.toFixed(1) || ''}] ${marker}`;
            }).join(gateChar);
            
            const decisionStr = currentTick.triggerSignal 
              ? `🔥 تطابق شروط البث بالكامل! القرار: دخول ${currentTick.activeAction}` 
              : `⏳ القرار: انتظار لعدم اكتمال الشروط`;

            runLogs.push(`   🔍 لوج فحص الشروط (${currentTick.activeGate}): ${condsLog} ⟵ القرار: ${decisionStr}`);
          }

          if (currentTick.eventMsg) {
            runLogs.push(`   ${currentTick.eventMsg}`);
          } else if (currentTick.isActive && currentTick.entryPrice) {
            runLogs.push(`   💼 صفقة نشطة: ${currentTick.activeAction} من سعر ${currentTick.entryPrice.toFixed(2)}$ | الوقف: ${currentTick.slPrice?.toFixed(2)}$ | الهدف: ${currentTick.tpPrice?.toFixed(2)}$ | العائد: ${currentTick.pnl > 0 ? '+' : ''}${currentTick.pnl.toFixed(2)}%`);
          }

          setDisplayedLogs([...runLogs]);
          return prev + 1;
        } else {
          clearInterval(intervalId);
          setSimulationRunning(false);
          const finalState = processedTicks[processedTicks.length - 1];
          setSimulationResult({
            status: finalState.pnl > 0 ? 'SUCCESS' : (finalState.pnl < 0 ? 'STOPPED_OUT' : 'NO_TRADE'),
            finalPnL: finalState.pnl,
            peakPnL,
            maxDrawdown
          });
          return prev;
        }
      });
    }, 180);
  };

  const evaluateDivergence = (history: SimulatedTick[]): boolean => {
    if (history.length < 5) return false;
    const len = history.length;
    // Divergence: last 4 ticks, price keeps making higher highs, but cumulative delta CVD keeps making lower lows
    const p1 = history[len - 4].price;
    const p2 = history[len - 1].price;
    const c1 = history[len - 4].cvd;
    const c2 = history[len - 1].cvd;
    
    // Bullish divergence: price goes down, cvd goes up
    const bullishDiv = p2 < p1 && c2 > c1 + 1.5;
    // Bearish divergence: price goes up, cvd goes down
    const bearishDiv = p2 > p1 && c2 < c1 - 1.5;
    
    return bullishDiv || bearishDiv;
  };

  const evaluateSweep = (history: SimulatedTick[]): boolean => {
    if (history.length < 6) return false;
    const len = history.length;
    // Sweep: current step price is very close to or broke the previous 5 steps low/high but pulls back
    const previousTicks = history.slice(len - 6, len - 1);
    const minLow = Math.min(...previousTicks.map(t => t.price));
    const currentTick = history[len - 1];
    
    // swept low
    return currentTick.price <= minLow + 0.15 && currentTick.price >= minLow - 0.2;
  };

  const evaluateExhaustion = (history: SimulatedTick[]): boolean => {
    if (history.length < 5) return false;
    const len = history.length;
    const current = history[len - 1];
    const prev = history[len - 2];
    
    // Exhaustion: volume is high, CVD moving, but absolute price delta is extremely small (absorbed/stalled)
    const priceDelta = Math.abs(current.price - prev.price);
    const cvdDelta = Math.abs(current.cvd - prev.cvd);
    
    return priceDelta < 0.05 && cvdDelta > 3.0; // high absorption
  };

  return (
    <div className="space-y-6" id="tawleefa-builder-container" dir="rtl">
      {/* GLAMOUR INTRO SECTION */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-md relative overflow-hidden" id="tawleefa-intro">
        <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl"></div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <h2 className="text-2xl font-bold font-sans text-slate-100 flex items-center gap-2">
              <Cpu className="text-emerald-400 w-6 h-6 animate-pulse" />
              مجمع التوليفات الذكي وصناعة المحركات التخصيصية (Tawleefa Builder)
            </h2>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              محرك مهجّن مستقل خارق ومتقدم بالكامل لبرمجة فلو الدخول والخروج حسب أفكارك كمتداول رائد! تحكّم بدمج المؤشرات، تغير الفائدة المفتوحة، ضغوطات الدلتا الكاذبة (CVD Divergences)، تصفية السيولة واقتناص القيعان والقمم، واختبرها عبر محاكي البث المباشر المدمج.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="bg-emerald-950/80 text-emerald-400 text-xs px-3 py-1.5 rounded border border-emerald-900/60 font-mono">
              ★ Unlimited Custom Flow
            </span>
            <span className="bg-slate-900 text-amber-400 text-xs px-3 py-1.5 rounded border border-slate-800 font-mono">
              ★ Micro-Structural Interpreter
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6" id="tawleefa-main-grid">
        {/* LEFT COLUMN: ACTIVE WORKSPACE & RULES PANEL */}
        <div className="xl:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg space-y-6" id="tawleefa-rules-editor">
          
          {/* Header Controls */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2">
              <Sliders className="text-emerald-400 w-5 h-5" />
              <h3 className="font-bold text-slate-100 font-sans text-base">مواصفات وتوليفة الإستراتيجية النشطة</h3>
            </div>
            
            {/* Action buttons */}
            <div className="flex gap-2">
              <label className="cursor-pointer bg-slate-800/80 hover:bg-slate-800 text-slate-300 text-xs px-3 py-2 rounded-lg border border-slate-700 font-semibold flex items-center gap-1.5 transition-all">
                <Upload className="w-3.5 h-3.5" />
                <span>استيراد</span>
                <input 
                  type="file" 
                  accept=".json" 
                  onChange={handleImportJSON} 
                  className="hidden" 
                />
              </label>
              
              <button 
                onClick={handleExportJSON}
                className="bg-slate-800/80 hover:bg-slate-800 text-slate-300 text-xs px-3 py-2 rounded-lg border border-slate-700 font-semibold flex items-center gap-1.5 transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                تصدير JSON
              </button>

              <button 
                onClick={handleSaveTawleefa}
                className={`text-xs px-4 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all ${
                  saveStatus === 'saved'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-md shadow-emerald-500/10'
                }`}
              >
                <Save className="w-3.5 h-3.5" />
                {saveStatus === 'saved' ? 'تم الحفظ!' : 'حفظ التوليفة'}
              </button>
            </div>
          </div>

          {/* Quick presets strip & Custom Saved Library */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
            <div>
              <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Sparkles className="text-amber-400 w-3.5 h-3.5" />
                نماذج جاهزة هجينة ومؤسساتية جاهزة للتحميل الفوري:
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
                {PRESET_TEMPLATES.map(p => (
                  <button
                    key={p.id}
                    onClick={() => loadPresetIntoForm(p)}
                    className="text-right p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-emerald-500/40 text-xs hover:bg-slate-850/85 transition-all text-slate-300"
                  >
                    <div className="font-bold text-slate-100 text-right text-xs truncate">{p.name}</div>
                    <div className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">{p.creator}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Saved Library Section */}
            <div className="border-t border-slate-800/80 pt-3">
              <h4 className="text-xs font-bold text-slate-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Cpu className="text-emerald-400 w-3.5 h-3.5" />
                  مكتبة توليفاتك المخصصة والربط السحابي الفوري:
                </span>
                {activeOnLiveBotId && (
                  <button 
                    onClick={handleDeactivateOnLiveBot}
                    className="bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 text-[10px] font-bold px-2 py-0.5 rounded border border-rose-500/20 transition-all"
                  >
                    إيقاف المحرك المخصص ✕
                  </button>
                )}
              </h4>
              
              <div className="grid grid-cols-1 gap-2 mt-2">
                {tawleefas.length === 0 ? (
                  <div className="text-center py-2 text-[10px] text-slate-500 bg-slate-900/40 rounded border border-slate-850">
                    لا توجد توليفات مخصصة محفوظة في الذاكرة بعد. قم بحفظ التوليفة الحالية لتظهر هنا.
                  </div>
                ) : (
                  tawleefas.map(t => {
                    const isActiveOnLive = activeOnLiveBotId === t.id;
                    const isSelected = activeTawleefa?.id === t.id;
                    return (
                      <div 
                        key={t.id}
                        className={`p-3 rounded-lg border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-all ${
                          isActiveOnLive 
                            ? 'bg-emerald-950/20 border-emerald-500/40' 
                            : isSelected
                            ? 'bg-slate-900 border-slate-700'
                            : 'bg-slate-950/40 border-slate-850 hover:border-slate-800'
                        }`}
                      >
                        <button
                          onClick={() => loadTawleefaToForm(t)}
                          className="flex-1 text-right flex flex-col gap-0.5"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-200 text-xs text-right hover:text-emerald-400 transition-all">
                              {t.name}
                            </span>
                            {isActiveOnLive && (
                              <span className="bg-emerald-500/10 text-emerald-400 text-[8px] px-1.5 py-0.5 rounded-full border border-emerald-500/20 animate-pulse font-bold font-sans">
                                ● البث النشط حيّاً
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 line-clamp-1">{t.description || 'لا يوجد وصف مضاف'}</p>
                        </button>
                        
                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          {isActiveOnLive ? (
                            <button
                              onClick={handleDeactivateOnLiveBot}
                              className="bg-emerald-500 text-slate-950 hover:bg-emerald-400 text-[10px] px-3 py-1.5 rounded-lg font-bold transition-all shadow-sm flex items-center gap-1"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              تعطيل البث الحي
                            </button>
                          ) : (
                            <button
                              onClick={() => handleActivateOnLiveBot(t)}
                              className="bg-emerald-600/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 border border-emerald-500/20 text-[10px] px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5"
                            >
                              <Zap className="w-3 h-3 fill-current" />
                              تفعيل على السيرفر
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteTawleefa(t.id)}
                            className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 p-1.5 rounded-lg border border-rose-500/10 hover:border-rose-500/20 transition-all"
                            title="حذف التوليفة من الذاكرة المحليّة"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Form Meta */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 block font-medium">اسم التوليفة المخصصة</label>
              <input 
                type="text" 
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="مثال: محرك صيد الحيتان مع تباعد الدلتا - Beast Divergence"
                className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 transition-all focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 block font-medium">وصف الاستراتيجية وتكتيكها</label>
              <input 
                type="text" 
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="صف الفلو وكيفية عمل الشروط"
                className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 transition-all focus:outline-none"
              />
            </div>
          </div>

          {activeTawleefa?.dynamicRegimeProfiles && activeTawleefa.dynamicRegimeProfiles.length > 0 && (
            <div className="bg-slate-950/80 border border-emerald-500/20 p-4 rounded-xl space-y-3">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg text-xs leading-none font-bold">⚡ قالب متكيف ديناميكياً (Adaptive Multi-Regime Profile):</span>
              </div>
              <p className="text-[11px] text-slate-400 font-sans">
                يتعرف هذا المحرك تلقائياً على بنية وريجيم السوق، ويقوم بتفعيل شروط الدخول وبلوكات التصفية والهدف المالي لكل ريجيم بشكل مستقل تماماً.
              </p>
              
              {/* Tabs for Profiles */}
              <div className="flex gap-1 overflow-x-auto p-1 bg-slate-900 rounded-lg border border-slate-800">
                {activeTawleefa.dynamicRegimeProfiles.map(profile => (
                  <button
                    key={profile.regime}
                    type="button"
                    onClick={() => setActiveProfileTab(profile.regime)}
                    className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all whitespace-nowrap ${
                      activeProfileTab === profile.regime
                        ? 'bg-emerald-500 text-slate-950 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-950/60'
                    }`}
                  >
                    📈 {profile.regime}
                  </button>
                ))}
              </div>

              {/* Active Profile Render Details */}
              {(() => {
                const targetProfile = activeTawleefa.dynamicRegimeProfiles.find(p => p.regime === activeProfileTab);
                if (!targetProfile) return null;

                const isDual = targetProfile.action === 'DUAL';
                const longConds = targetProfile.longConditions || targetProfile.conditions || [];
                const shortConds = targetProfile.shortConditions || [];

                return (
                  <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-850 space-y-2.5 text-right font-sans">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-bold">
                        بوابة الدمج المنطقي:{" "}
                        <span className="text-emerald-400 font-mono">
                          {isDual ? `LONG: [${targetProfile.longGate || 'AND'}] / SHORT: [${targetProfile.shortGate || 'AND'}]` : `[${targetProfile.gate}]`}
                        </span>
                      </span>
                      <span className="text-slate-400 font-bold">الاتجاه المعتمد: <span className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">[{targetProfile.action}]</span></span>
                    </div>

                    {isDual ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-slate-800/85 pt-2.5">
                        {/* LONG CONDITIONS */}
                        <div className="space-y-1.5">
                          <div className="text-[10px] text-emerald-400 font-bold mb-1 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                            شروط الصعود (LONG):
                          </div>
                          {longConds.length === 0 ? (
                            <div className="text-[10px] text-slate-500 bg-slate-950/40 p-2 rounded text-center">لا توجد شروط صعود</div>
                          ) : (
                            longConds.map((c, i) => (
                              <div key={c.id || i} className="text-[10px] text-slate-300 bg-slate-950/60 px-2 py-1.5 rounded border border-slate-850/80 flex items-center justify-between font-mono">
                                <span className="text-emerald-400">#{i + 1}</span>
                                <span className="text-slate-200">{c.metric} {c.operator === 'GREATER_THAN' ? 'أكبر من' : (c.operator === 'LESS_THAN' ? 'أصغر من' : (c.operator === 'CROSSES_ABOVE' ? 'يخترق صعوداً' : c.operator))} {c.valueNumber === 0 ? '' : c.valueNumber}</span>
                                <span className="text-slate-500">[{c.timeframe}]</span>
                              </div>
                            ))
                          )}
                        </div>

                        {/* SHORT CONDITIONS */}
                        <div className="space-y-1.5">
                          <div className="text-[10px] text-rose-400 font-bold mb-1 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                            شروط الهبوط (SHORT):
                          </div>
                          {shortConds.length === 0 ? (
                            <div className="text-[10px] text-slate-500 bg-slate-950/40 p-2 rounded text-center">لا توجد شروط هبوط</div>
                          ) : (
                            shortConds.map((c, i) => (
                              <div key={c.id || i} className="text-[10px] text-slate-300 bg-slate-950/60 px-2 py-1.5 rounded border border-slate-850/80 flex items-center justify-between font-mono">
                                <span className="text-rose-400">#{i + 1}</span>
                                <span className="text-slate-200">{c.metric} {c.operator === 'GREATER_THAN' ? 'أكبر من' : (c.operator === 'LESS_THAN' ? 'أصغر من' : (c.operator === 'CROSSES_ABOVE' ? 'يخترق صعوداً' : c.operator))} {c.valueNumber === 0 ? '' : c.valueNumber}</span>
                                <span className="text-slate-500">[{c.timeframe}]</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="border-t border-slate-800/85 pt-2.5 space-y-1.5">
                        <div className="text-[10px] text-slate-400 font-bold mb-1">شروط الدخول المحددة في هذا الريجيم:</div>
                        {targetProfile.conditions.map((c, i) => (
                          <div key={c.id || i} className="text-[10px] text-slate-300 bg-slate-950/60 px-2 py-1.5 rounded border border-slate-850/80 flex items-center justify-between font-mono">
                            <span className="text-emerald-400">#{i + 1}</span>
                            <span className="text-slate-200">{c.metric} {c.operator === 'GREATER_THAN' ? 'أكبر من' : (c.operator === 'LESS_THAN' ? 'أصغر من' : (c.operator === 'CROSSES_ABOVE' ? 'يخترق صعوداً' : c.operator))} {c.valueNumber === 0 ? '' : c.valueNumber}</span>
                            <span className="text-slate-500">[{c.timeframe}]</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="border-t border-slate-800/85 pt-2.5 grid grid-cols-2 gap-2 text-[10px]">
                      <div className="bg-slate-950/40 p-2 rounded border border-slate-850/40">
                        <span className="text-slate-500 block mb-0.5">وقف خسارة الريجيم (SL)</span>
                        <span className="text-slate-200 font-bold font-mono">{targetProfile.stopLossMode} ({targetProfile.stopLossValue})</span>
                      </div>
                      <div className="bg-slate-950/40 p-2 rounded border border-slate-850/40">
                        <span className="text-slate-500 block mb-0.5">جني أرباح الريجيم (TP)</span>
                        <span className="text-slate-200 font-bold font-mono">{targetProfile.takeProfitMode} ({targetProfile.takeProfitValue})</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Decision Gating & Conditions Header */}
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-950 border border-slate-800/80 p-4 rounded-xl">
              <div className="flex items-center gap-3">
                <span className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg text-xs font-bold leading-none">بوابة الدمج المنطقي:</span>
                <div className="flex p-0.5 bg-slate-900 rounded-lg border border-slate-800">
                  {action === 'DUAL' ? (
                    activeDualTab === 'LONG' ? (
                      <>
                        <button
                          onClick={() => setLongGate('AND')}
                          className={`px-3 py-1 rounded text-xs font-bold transition-all ${longGate === 'AND' ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                          تطابق الكل (AND)
                        </button>
                        <button
                          onClick={() => setLongGate('OR')}
                          className={`px-3 py-1 rounded text-xs font-bold transition-all ${longGate === 'OR' ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                          تطابق أي شرط (OR)
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setShortGate('AND')}
                          className={`px-3 py-1 rounded text-xs font-bold transition-all ${shortGate === 'AND' ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                          تطابق الكل (AND)
                        </button>
                        <button
                          onClick={() => setShortGate('OR')}
                          className={`px-3 py-1 rounded text-xs font-bold transition-all ${shortGate === 'OR' ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                          تطابق أي شرط (OR)
                        </button>
                      </>
                    )
                  ) : (
                    <>
                      <button
                        onClick={() => setGate('AND')}
                        className={`px-3 py-1 rounded text-xs font-bold transition-all ${gate === 'AND' ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        تطابق الكل (AND)
                      </button>
                      <button
                        onClick={() => setGate('OR')}
                        className={`px-3 py-1 rounded text-xs font-bold transition-all ${gate === 'OR' ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        تطابق أي شرط (OR)
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="p-1.5 bg-rose-500/10 text-rose-400 rounded-lg text-xs font-bold leading-none">القرار المتولد:</span>
                <div className="flex p-0.5 bg-slate-900 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setAction('LONG')}
                    className={`px-4 py-1 rounded text-xs font-bold transition-all ${action === 'LONG' ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    دخول صعودي (LONG)
                  </button>
                  <button
                    onClick={() => setAction('SHORT')}
                    className={`px-4 py-1 rounded text-xs font-bold transition-all ${action === 'SHORT' ? 'bg-rose-500/15 border border-rose-500/40 text-rose-400' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    دخول هبوطي (SHORT)
                  </button>
                  <button
                    onClick={() => {
                      setAction('DUAL');
                      if (longConditions.length === 0) {
                        setLongConditions(conditions.length > 0 ? [...conditions] : []);
                      }
                    }}
                    className={`px-4 py-1 rounded text-xs font-bold transition-all ${action === 'DUAL' ? 'bg-amber-500/15 border border-amber-500/40 text-amber-400' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    اتجاهين معاً (LONG & SHORT)
                  </button>
                </div>
              </div>
            </div>

            {action === 'DUAL' && (
              <div className="flex bg-slate-900/50 p-1 rounded-xl border border-slate-800/80 mb-2">
                <button
                  onClick={() => setActiveDualTab('LONG')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${activeDualTab === 'LONG' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  شروط الاتجاه الصعودي (LONG) - {longConditions.length}
                </button>
                <button
                  onClick={() => setActiveDualTab('SHORT')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${activeDualTab === 'SHORT' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/25' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                  شروط الاتجاه الهبوطي (SHORT) - {shortConditions.length}
                </button>
              </div>
            )}

            {/* Micro-indicators Conditions Engine Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1">
                  <Layers className="text-emerald-400 w-3.5 h-3.5" />
                  قائمة شروط وبلوكات الفلو الهيكلي ({action === 'DUAL' ? (activeDualTab === 'LONG' ? longConditions.length : shortConditions.length) : conditions.length})
                </h4>
                <button
                  onClick={addConditionRow}
                  className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/20 text-[10px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  إضافة شرط هيكلي جديد
                </button>
              </div>

              {(action === 'DUAL' ? (activeDualTab === 'LONG' ? longConditions.length === 0 : shortConditions.length === 0) : conditions.length === 0) ? (
                <div className="text-center py-10 bg-slate-950/20 border border-slate-800/80 rounded-xl space-y-2">
                  <Info className="mx-auto text-slate-600 w-8 h-8" />
                  <p className="text-xs text-slate-500">لا توجد أي شروط مضافة حتى الآن لهذه التوليفة!</p>
                  <button 
                    onClick={addConditionRow}
                    className="text-xs text-emerald-400 font-bold hover:underline"
                  >
                    انقر هنا لإضافة شرطك الأول والبدء بالبناء
                  </button>
                </div>
              ) : (
                <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                  {(action === 'DUAL' ? (activeDualTab === 'LONG' ? longConditions : shortConditions) : conditions).map((cond, idx) => (
                    <div 
                      key={cond.id} 
                      className="group bg-slate-950/80 border border-slate-800/80 hover:border-slate-700 p-4 rounded-xl flex flex-col md:flex-row items-stretch md:items-center gap-3 relative transition-all"
                    >
                      <div className="absolute top-1/2 -translate-y-1/2 right-[-1px] w-1 h-8 bg-emerald-500 rounded-l opacity-0 group-hover:opacity-100 transition-all"></div>
                      
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-500 flex items-center justify-center">
                          {idx + 1}
                        </span>
                      </div>

                      {/* 1. Metric Selector */}
                      <div className="flex-1 space-y-1">
                        <label className="text-[10px] text-slate-500 block">المؤشر أو المتغير</label>
                        <select
                          value={cond.metric}
                          onChange={e => updateConditionRow(cond.id, 'metric', e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-sans"
                        >
                          <option value="PRICE">السعر (Price Action)</option>
                          <option value="OPEN_INTEREST">الفائدة المفتوحة (Open Interest)</option>
                          <option value="CVD">دلتا الحجم التراكمي (CVD)</option>
                          <option value="RVOL">معدل حجم السيولة (RVOL)</option>
                          <option value="TAKER_RATIO">قوة الشراء المؤسساتي (Taker Ratio)</option>
                          <option value="FUNDING_RATE">معدل التمويل (Funding Rate)</option>
                          <option value="RSI">مؤشر القوة النسبية (RSI)</option>
                          <option value="ADX">قوة الاتجاه العام (ADX)</option>
                        </select>
                      </div>

                      {/* 2. Operator Selector */}
                      <div className="flex-1 space-y-1">
                        <label className="text-[10px] text-slate-500 block">الشرط (المُعامل الفني)</label>
                        <select
                          value={cond.operator}
                          onChange={e => updateConditionRow(cond.id, 'operator', e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-sans"
                        >
                          <option value="GREATER_THAN">أكبر من (&gt;)</option>
                          <option value="LESS_THAN">أصغر من (&lt;)</option>
                          <option value="CROSSES_ABOVE">يخترق صعوداً (Crosses Above)</option>
                          <option value="CROSSES_BELOW">ينهار هبوطاً (Crosses Below)</option>
                          <option value="SPIKE">ارتجاف حاد مفاجئ (Spike %)</option>
                          <option value="DIVERGENCING">انحراف غير متوافق (Divergence)</option>
                          <option value="SWEEP_LOW_HIGH">كسر واقتناص القيعان/القمم (Sweep Action)</option>
                          <option value="EXHAUSTION">إجهاد وامتصاص الزخم (Exhaustion)</option>
                        </select>
                      </div>

                      {/* 3. Value Type & Number */}
                      <div className="w-[120px] space-y-1">
                        <label className="text-[10px] text-slate-500 block">القيمة المستهدفة</label>
                        <input
                          type="number"
                          step="any"
                          value={cond.valueNumber}
                          onChange={e => updateConditionRow(cond.id, 'valueNumber', parseFloat(e.target.value) || 0)}
                          disabled={['DIVERGENCING', 'SWEEP_LOW_HIGH', 'EXHAUSTION'].includes(cond.operator)}
                          className="w-full bg-slate-905 border border-slate-800 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none text-left font-mono disabled:opacity-30"
                        />
                      </div>

                      {/* 4. Timeframe Selector */}
                      <div className="w-[80px] space-y-1">
                        <label className="text-[10px] text-slate-500 block">الفريم الزمني</label>
                        <select
                          value={cond.timeframe}
                          onChange={e => updateConditionRow(cond.id, 'timeframe', e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500 font-mono"
                        >
                          <option value="1m">1م (1m)</option>
                          <option value="5m">5م (5m)</option>
                          <option value="15m">15م (15m)</option>
                          <option value="1h">1س (1h)</option>
                          <option value="4h">4س (4h)</option>
                        </select>
                      </div>

                      {/* Delete index */}
                      <div className="flex items-end pb-0.5">
                        <button
                          onClick={() => removeConditionRow(cond.id)}
                          className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 rounded-lg border border-rose-500/15 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Advanced Risk Settings */}
          <div className="border-t border-slate-800/80 pt-6 space-y-4">
            <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <Settings className="text-teal-400 w-3.5 h-3.5" />
              ضوابط وأوزان التنفيذ وعتبة التحوط للتوليفة
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-950/40 p-4 rounded-xl border border-slate-800/80">
              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 block block font-medium">الرافعة المالية</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="1"
                    max="50"
                    value={leverage}
                    onChange={e => setLeverage(parseInt(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                  <span className="text-xs font-bold font-mono text-slate-300">{leverage}x</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-slate-400 block block font-medium">خطر المحفظة للصفقة %</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0.5"
                    max="5"
                    step="0.5"
                    value={riskPerTrade}
                    onChange={e => setRiskPerTrade(parseFloat(e.target.value))}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-500"
                  />
                  <span className="text-xs font-bold font-mono text-slate-300">{riskPerTrade}%</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 block font-medium">نمط وقف الخسارة (SL)</label>
                <select
                  value={stopLossMode}
                  onChange={e => setStopLossMode(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200"
                >
                  <option value="ATR_DYNAMIC">تكيّفي (ATR Multiplier)</option>
                  <option value="NONE">تعطيل وقف الخسارة البارز (Disabled - No Stop Loss)</option>
                  <option value="FIXED">ثابت مئوي (Fixed %SL)</option>
                  <option value="SWEEP_LOW_BOUND">تحت قاع التصفية (Sweep boundary)</option>
                  <option value="EXHAUSTION_CLOSE">إغلاق تلقائي عند الاستقرار</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400 block font-medium">عتبة / قيمة وقف الخسارة</label>
                <input
                  type="number"
                  step="0.1"
                  value={stopLossValue}
                  onChange={e => setStopLossValue(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-200"
                />
              </div>
            </div>

            {/* Allowed market regime checklist */}
            <div className="space-y-2">
              <label className="text-xs text-slate-400 block font-medium">تقييد تشغيل التوليفة في بيئات سوقية محددة فقط:</label>
              <div className="flex flex-wrap gap-2">
                {['TREND_EXPANSION', 'LIQUIDITY_SWEEP', 'TRAP_MODE', 'COMPRESSION', 'VIOLENT_VOLATILITY'].map(regime => {
                  const active = allowedRegimes.includes(regime);
                  return (
                    <button
                      key={regime}
                      onClick={() => toggleRegimeFilter(regime)}
                      className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition-all ${
                        active 
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400' 
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-400'
                      }`}
                    >
                      {regime === 'TREND_EXPANSION' && '📈 اتجاه توسعي صاعد'}
                      {regime === 'LIQUIDITY_SWEEP' && '⚡ موجات تصفية سيولة'}
                      {regime === 'TRAP_MODE' && '🎯 فخاخ ومكائد صانع السوق'}
                      {regime === 'COMPRESSION' && '🌀 انضغاط وجمع سيولة هادئ'}
                      {regime === 'VIOLENT_VOLATILITY' && '🔥 تقلب مفرط وعشوائي'}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: INTERACTIVE STREAMING SIMULATOR */}
        <div className="xl:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-lg flex flex-col justify-between" id="tawleefa-simulator">
          
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-4">
              <h3 className="font-bold text-slate-100 font-sans text-base flex items-center gap-2">
                <Play className="text-amber-400 w-5 h-5 fill-current" />
                محاكي الفلو المبرمج الفوري وسرعة الاستجابة
              </h3>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                اختبر فاعلية شروط التوليفة، بوابات الدمج، وأوزان التنفيذ فورياً بضخ تدفقات دقيقة لأحداث كبرى، وتحقق من دقة نقطة ضرب الهدف (TP) أو وقف الخسارة.
              </p>
            </div>

            {/* Test Simulator Selection */}
            <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800/80">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 block font-medium">اختر سيناريو مأزق السوق للبث الحي</label>
                <select
                  value={selectedScenarioId}
                  onChange={e => setSelectedScenarioId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none"
                >
                  <option value="bull_trap_reversal">اختراق كاذب + تباعد دلتا (Mania Bull Trap Scenario)</option>
                  <option value="panic_selloff_sweep">تصفية ذعر الصغار + ارتداد الحيتان (Panic Sweep & Accumulate)</option>
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleRunSimulator}
                  disabled={simulationRunning}
                  className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 text-slate-950 disabled:text-slate-500 font-bold py-2.5 px-4 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-amber-500/10"
                >
                  <Zap className="w-4 h-4 fill-current" />
                  {simulationRunning ? 'جاري محاكاة السيناريو...' : 'بدء البث الحركي ومطابقة الشروط'}
                </button>
              </div>
            </div>

            {/* Live Chart Canvas representing synthetic ticks */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <h4 className="text-[11px] font-bold text-slate-400 mb-2 flex justify-between items-center">
                <span>رسم بياني تدفقي متصاعد لحركة السعر وعتبة الدخول</span>
                <span className="font-mono text-[10px] text-amber-500">معدل البث: 180ms</span>
              </h4>
              
              <div className="h-56 w-full">
                {displayedTicks.length === 0 ? (
                  <div className="h-full flex flex-col justify-center items-center text-slate-600 gap-1.5">
                    <TrendingUp className="w-8 h-8 opacity-40 animate-pulse" />
                    <span className="text-xs">المخطط فارغ. انقر على "بدء البث" أعلاه لضخ الأحداث وسريان CVD.</span>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={displayedTicks}>
                      <defs>
                        <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="step" stroke="#64748b" fontSize={10} tickLine={false} />
                      <YAxis yAxisId="left" stroke="#10b981" fontSize={10} domain={['auto', 'auto']} tickFormatter={v => `$${v}`} tickLine={false} />
                      <YAxis yAxisId="right" stroke="#e2e8f0" fontSize={10} orientation="right" tickLine={false} />
                      
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', direction: 'rtl', textAlign: 'right' }} 
                        labelStyle={{ color: '#94a3b8', fontSize: '11px' }}
                        itemStyle={{ fontSize: '12px' }}
                      />
                      
                      <Line yAxisId="left" type="monotone" dataKey="price" stroke="#10b981" strokeWidth={2.5} dot={false} name="السعر" />
                      
                      {/* Highlight entry, exit indicators */}
                      {displayedTicks.map((t, index) => {
                        if (t.eventMsg && t.eventMsg.includes('دخول')) {
                          return (
                            <ReferenceDot
                              key={index}
                              yAxisId="left"
                              x={t.step}
                              y={t.price}
                              r={6}
                              fill="#f59e0b"
                              stroke="#ffffff"
                              strokeWidth={2}
                            />
                          );
                        }
                        if (t.eventMsg && t.eventMsg.includes('جني الأرباح')) {
                          return (
                            <ReferenceDot
                              key={index}
                              yAxisId="left"
                              x={t.step}
                              y={t.price}
                              r={6}
                              fill="#10b981"
                              stroke="#ffffff"
                              strokeWidth={2}
                            />
                          );
                        }
                        if (t.eventMsg && t.eventMsg.includes('وقف')) {
                          return (
                            <ReferenceDot
                              key={index}
                              yAxisId="left"
                              x={t.step}
                              y={t.price}
                              r={6}
                              fill="#ef4444"
                              stroke="#ffffff"
                              strokeWidth={2}
                            />
                          );
                        }
                        return null;
                      })}
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Performance simulation feedback */}
            {simulationResult && (
              <div className={`p-4 rounded-xl border flex items-center justify-between transition-all ${
                simulationResult.finalPnL > 0 
                  ? 'bg-emerald-950/40 border-emerald-500/25 text-emerald-400' 
                  : 'bg-rose-950/40 border-rose-500/25 text-rose-400'
              }`}>
                <div className="flex items-center gap-2.5">
                  <span className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    {simulationResult.finalPnL > 0 ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                  </span>
                  <div>
                    <h5 className="text-xs font-bold text-slate-200">النتيجة النهائية للمحاكمة</h5>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {simulationResult.finalPnL > 0 ? 'نجاح فني ساحق متطابق مع استهداف القمم!' : 'وقف حرج للمركز لتأمين الحساب من تداعيات الانزلاق'}
                    </p>
                  </div>
                </div>

                <div className="text-left">
                  <div className="text-sm font-bold font-mono">
                    {simulationResult.finalPnL > 0 ? '+' : ''}{simulationResult.finalPnL.toFixed(2)}% P&L
                  </div>
                  <div className="text-[9px] text-slate-500 mt-0.5 whitespace-nowrap">
                    تراجع أقصى: {simulationResult.maxDrawdown.toFixed(1)}% | القمة: +{simulationResult.peakPnL.toFixed(1)}%
                  </div>
                </div>
              </div>
            )}

            {/* Simulated log outputs */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-500 block font-medium">سجل أحداث وقرارات البث في التوليفة</label>
              <div className="h-44 bg-slate-950 rounded-xl border border-slate-800 p-3 overflow-y-auto font-mono text-[10px] text-slate-300 space-y-2">
                {displayedLogs.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-600">
                    لا توجد سجلات حالية. ابدأ المحاكاة لرؤية تسلسل المطابقة.
                  </div>
                ) : (
                  displayedLogs.map((log, index) => (
                    <div 
                      key={index} 
                      className={`py-1 border-b border-slate-900 last:border-0 leading-relaxed ${
                        log.includes('🎯') 
                          ? 'text-amber-400 font-bold' 
                          : log.includes('💚') 
                          ? 'text-emerald-400 font-bold' 
                          : log.includes('🛑') 
                          ? 'text-rose-400 font-bold' 
                          : 'text-slate-400'
                      }`}
                    >
                      {log}
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

          <div className="border-t border-slate-800 pt-4 mt-4 text-center">
            <span className="text-[9px] text-slate-600 flex items-center justify-center gap-1">
              <FolderLock className="w-3 h-3" />
              أنت تستخدم محاكي القناص المؤسساتي المطور. كافة قرارات التوليفة محاكاة سحابياً.
            </span>
          </div>

        </div>
      </div>

      {/* 🟢 TAWLEEFA REAL-TIME MONITOR & DIAGNOSTICS */}
      {settings?.useTawleefaEngine && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6 animate-fade-in mt-6" id="tawleefa-realtime-monitor" dir="rtl">
          <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-4 gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-3.5 w-3.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
              </span>
              <div>
                <h3 className="font-bold text-slate-100 font-sans text-lg flex items-center gap-2">
                  <Activity className="text-emerald-400 w-5 h-5 animate-pulse" />
                  برنامج رصد وتحليل قرارات التوليفة النشطة (Live Diagnostics Monitor)
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  البث الحي لمخرجات وفحوصات محرك التوليفات الذكي. يساعدك على معرفة تفاصيل تصفية السوق والشروط الدقيقة التي منعت صفقات الرموز من الدخول.
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5">
              <Cpu className="text-emerald-400 w-4 h-4 animate-spin" />
              <div className="text-right">
                <div className="text-[9px] text-slate-500 uppercase tracking-wider">التوليفة النشطة حالياً بالتداول المبرمج</div>
                <div className="text-xs font-black text-amber-300">
                  {settings.activeTawleefaJson ? JSON.parse(settings.activeTawleefaJson).name : 'غير محددة'}
                </div>
              </div>
            </div>
          </div>

          {watchlist && watchlist.length > 0 ? (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                <table className="w-full text-right border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-900/60 border-b border-slate-800 text-slate-400 font-bold">
                      <th className="px-4 py-3">الرمز</th>
                      <th className="px-4 py-3">السعر الحالي والسلوك</th>
                      <th className="px-4 py-3">الريجيم وحالة الفلترة</th>
                      <th className="px-4 py-3">قرار المحرك</th>
                      <th className="px-4 py-3">رصد شروط التوليفة التفصيلي (حالة المطابقة الفورية للقيم)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/60 font-medium text-slate-200">
                    {watchlist.map((coin, idx) => {
                      const decision = coin.decision;
                      const report = decision?.tawleefaReport;
                      const hasDecision = !!decision;
                      const isAttack = decision?.action === 'ATTACK';
                      const isWaiting = decision?.action === 'WAIT';
                      const regime = decision?.regime || coin.trend;
                      const regimeMatch = report ? report.regimeMatch : true;

                      // Calculate metrics match ratio
                      const completedConditions = report?.conditions?.filter((c: any) => c.isMet).length || 0;
                      const totalConditions = report?.conditions?.length || 0;

                      return (
                        <tr key={idx} className="hover:bg-slate-900/30 transition-all">
                          {/* Symbol */}
                          <td className="px-4 py-3">
                            <div className="font-extrabold text-slate-100 flex items-center gap-2">
                              <span>{coin.symbol}</span>
                              {coin.priceChange >= 0 ? (
                                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500">منظومة القناص الموزعة</span>
                          </td>

                          {/* Price & Change */}
                          <td className="px-4 py-3">
                            <div className="font-bold font-mono text-emerald-300 text-sm">
                              ${coin.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                            </div>
                            <div className={`text-[10px] font-bold ${coin.priceChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {coin.priceChange >= 0 ? '+' : ''}{coin.priceChange?.toFixed(2)}%
                            </div>
                          </td>

                          {/* Regime and allowed match */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1 items-start">
                              <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400 font-mono">
                                {regime}
                              </span>
                              {!regimeMatch ? (
                                <span className="text-[9px] text-rose-400 flex items-center gap-1 font-bold">
                                  <AlertTriangle className="w-2.5 h-2.5 text-rose-400 animate-pulse" />
                                  الريجيم غير مفعل بالتوليفة ❌
                                </span>
                              ) : (
                                <span className="text-[9px] text-emerald-400 flex items-center gap-1 font-bold">
                                  <CheckCircle className="w-2.5 h-2.5 text-emerald-400" />
                                  الريجيم مطابق للتوليفة ✅
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Core Action */}
                          <td className="px-4 py-3">
                            {isAttack ? (
                              <div className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-500/15 border border-emerald-500/30 rounded-lg text-[10px] font-black text-emerald-400 shadow-sm shadow-emerald-500/5 animate-pulse">
                                <Zap className="w-3 h-3" />
                                ATTACK 🔥 جاهز للدخول
                              </div>
                            ) : isWaiting ? (
                              <div className="inline-flex items-center gap-1 px-3 py-1 bg-slate-800/80 border border-slate-700/50 rounded-lg text-[10px] font-medium text-slate-400">
                                <Clock className="w-3 h-3 text-slate-500" />
                                WAITING 🛡️ انتظار الشرط
                              </div>
                            ) : (
                              <span className="text-slate-600 text-[11px] italic">جاري الفحص المجهري...</span>
                            )}
                          </td>

                          {/* Live Checklist */}
                          <td className="px-4 py-3">
                            {report && report.conditions && report.conditions.length > 0 ? (
                              <div className="space-y-1.5 max-w-md">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[10px] text-slate-500">
                                    المطابقة الإجمالية للشروط: 
                                  </span>
                                  <span className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded ${
                                    completedConditions === totalConditions 
                                      ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800/50' 
                                      : 'bg-rose-950/40 text-rose-400 border border-rose-900/50'
                                  }`}>
                                    {completedConditions} / {totalConditions} استوفيت
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {report.conditions.map((cond: any, cidx: number) => {
                                    const isLongC = cond.metric?.startsWith('LONG:');
                                    const isShortC = cond.metric?.startsWith('SHORT:');
                                    const displayName = isLongC 
                                      ? cond.metric.replace('LONG:', '🟢 صعود:') 
                                      : (isShortC ? cond.metric.replace('SHORT:', '🔴 هبوط:') : cond.metric);

                                    return (
                                      <div 
                                        key={cidx} 
                                        className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[9px] font-mono select-none ${
                                          cond.isMet 
                                            ? (isShortC ? 'bg-orange-950/40 text-orange-400 border-orange-900/50' : 'bg-emerald-950/40 text-emerald-400 border-emerald-900/50') 
                                            : (isShortC ? 'bg-rose-950/10 text-rose-300 border-rose-900/20' : 'bg-slate-950/20 text-slate-400 border-slate-900/30')
                                        }`}
                                        title={`الشرط: ${cond.metric} ${cond.operator} ${cond.threshold}. القيمة المقروءة: ${cond.actualValue}`}
                                      >
                                        <span className="font-extrabold">{displayName}</span>
                                        <span className="text-slate-500">
                                          {cond.operator === 'GREATER_THAN' ? '>' : cond.operator === 'LESS_THAN' ? '<' : cond.operator === 'CROSSES_ABOVE' ? '≥' : cond.operator === 'CROSSES_BELOW' ? '≤' : cond.operator}
                                        </span>
                                        <span className="text-slate-300 font-bold">{cond.threshold}</span>
                                        <span className="text-slate-500">|</span>
                                        <span className="font-bold underline decoration-dotted text-slate-100">
                                          {cond.actualValue?.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                                        </span>
                                        <span>{cond.isMet ? '✅' : '❌'}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : hasDecision ? (
                              <div className="text-[10px] text-slate-500 italic">
                                تم الفحص ولكن لم تتوافق الشروط المبرمجة مع المعايير الفنية الحالية.
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                <RefreshCw className="w-3 h-3 animate-spin text-emerald-400" />
                                جاري التحليل التلقائي وحساب المؤشرات التفصيلية...
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-[11px] text-slate-400 leading-relaxed space-y-2">
                <span className="font-bold text-amber-400 flex items-center gap-1 mb-1">
                  <Info className="w-3.5 h-3.5" />
                  دليل تفصيلي لحل مشكلات عدم جودة دخول الصفقات للتوليفة:
                </span>
                <p>
                  1. 💡 **شرط حجم التداول النسبي (RVOL)**: إنّ تحديد عتبة RVOL أكبر من <span className="font-mono text-amber-400 font-bold">1.3</span> قد يؤدي إلى استبعاد معظم الصفقات في الأوقات التي يميل فيها السوق إلى التهدئة وضغط السيولة. لزيادة وتيرة العمليات وتحسين استثمار الفرص اللحظية، جرّب تحرير القيمة إلى <span className="font-mono text-emerald-400 font-bold">1.0</span> أو <span className="font-mono text-emerald-400 font-bold">1.1</span> في نافذة التوليفة.
                </p>
                <p>
                  2. 💡 **شرط الريجيمات النشطة (Allowed Regimes)**: يرصد البوت ريجيم السوق لكل عملة على حدة بشكل فوري. في حال كانت التوليفة مبرمجة لتعمل فقط في ريجيمات التمدد (<span className="font-mono text-emerald-400 font-bold">TREND_EXPANSION</span>)، وصادف دخول العملات في ريجيم الضغط والسيولة المجهرية (<span className="font-mono text-emerald-400 font-bold">COMPRESSION</span>)، سوف يتم استبعاد الدخول فوراً لحماية رأس المال. يرجى مراجعة وتعديل <span className="text-amber-400 font-bold">"الريجيمات الفنية المسموح بها بالتوليفة"</span> بالأعلى.
                </p>
              </div>
            </div>
          ) : (
            <div className="h-44 bg-slate-950 rounded-xl border border-slate-800 flex flex-col items-center justify-center text-slate-500 gap-3">
              <RefreshCw className="w-8 h-8 animate-spin text-emerald-400/50" />
              <div className="text-center">
                <p className="text-slate-300 font-bold ml-1 text-sm">جاري جلب المؤشرات المتطورة وفحص التوليفة في الوقت الحقيقي...</p>
                <p className="text-[11px] text-slate-600 mt-1">برجاء الانتظار لتحديث البيانات وبثها فوراً من خوادم بايننس الآجلة.</p>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
