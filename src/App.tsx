import React, { useState, useEffect } from 'react';
import { Target, Activity, Settings, BarChart2, ShieldCheck, Power, RefreshCw, TrendingUp, TrendingDown, Play, Square, Sliders, Zap, Cpu } from 'lucide-react';
import { SettingsView } from './components/SettingsView';
import { ReplaySimulatorView } from './components/ReplaySimulatorView';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [settingsTab, setSettingsTab] = useState('risk');
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [activeTrades, setActiveTrades] = useState<any[]>([]);
  const [historyTrades, setHistoryTrades] = useState<any[]>([]);
  const [selectedTradeForCascade, setSelectedTradeForCascade] = useState<any | null>(null);
  const [stats, setStats] = useState({ totalPnl: 0, winRate: 0, openCount: 0, totalTrades: 0 });
  const [marketContext, setMarketContext] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [adaptiveLogs, setAdaptiveLogs] = useState<any[]>([]);
  const [panicActive, setPanicActive] = useState(false);
  const [botActive, setBotActive] = useState(false);
  const [isInverse, setIsInverse] = useState(false);
  const [loading, setLoading] = useState(false);

  // Sorting & Pagination States
  const [wlSortField, setWlSortField] = useState<string>('symbol');
  const [wlSortDir, setWlSortDir] = useState<'asc' | 'desc'>('asc');
  const [wlPage, setWlPage] = useState<number>(1);
  const wlPageSize = 5;

  const [histSortField, setHistSortField] = useState<string>('exitTime');
  const [histSortDir, setHistSortDir] = useState<'asc' | 'desc'>('desc');
  const [histPage, setHistPage] = useState<number>(1);
  const histPageSize = 10;

  const [adeSortField, setAdeSortField] = useState<string>('time');
  const [adeSortDir, setAdeSortDir] = useState<'asc' | 'desc'>('desc');
  const [adePage, setAdePage] = useState<number>(1);
  const adePageSize = 10;
  const [settings, setSettings] = useState({ 
    portfolioSize: 2000, 
    riskPerTradePerc: 1, 
    maxConcurrentTrades: 10,
    leverage: 10,
    tradingFeeRate: 0.001,
    binanceApiKey: "",
    binanceSecretKey: "",
    tradingMode: "PAPER" as "PAPER" | "LIVE",
    dynamicSafetyExit: true,
    fastExitEnabled: true,
    fastExitPerc: 0.5,
    quantumBbPeriod: 20,
    quantumBbMultiplier: 1.8,
    quantumVolThreshold: 1.02,
    quantumMomentumVol: 1.5,
    minPositionSizePerc: 20,
    useCreativeEngine: true,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  const STRATEGY_TEMPLATES = [
    {
      id: 'conservative',
      name: 'القناص الصارم (محافظ للغاية)',
      desc: 'دقة عالية جداً، صفقات قليلة ومختارة بعناية فائقة.',
      icon: <ShieldCheck className="w-4 h-4" />,
      color: 'border-emerald-500/50 text-emerald-400 bg-emerald-500/5',
      settings: {
        strictMode: true,
        strictMinScore: 6,
        strategyAdxThreshold: 35,
        strategyMinConfidence: 0.85,
        strategyRvolThreshold: 2.5,
        useStrategyTrendFilter: true,
        useStrategyConfidenceGate: true,
        useStrategyMomentumRule: true,
        useStrategyVolatilityRule: true,
        beastMode: false,
        useKineticEngine: true
      }
    },
    {
      id: 'balanced',
      name: 'التوازن الذهبي (متوازن)',
      desc: 'الخيار الأمثل لمعظم المتداولين. يجمع بين الربحية والأمان.',
      icon: <Activity className="w-4 h-4" />,
      color: 'border-blue-500/50 text-blue-400 bg-blue-500/5',
      settings: {
        strictMode: true,
        strictMinScore: 5,
        strategyAdxThreshold: 25,
        strategyMinConfidence: 0.6,
        strategyRvolThreshold: 1.5,
        useStrategyTrendFilter: true,
        useStrategyConfidenceGate: true,
        useStrategyMomentumRule: true,
        useStrategyVolatilityRule: true,
        beastMode: false,
        useKineticEngine: true
      }
    },
    {
      id: 'aggressive',
      name: 'المضارب الهجومي (عدواني)',
      desc: 'تردد صفقات مرتفع، شروط أقل صرامة، مخاطرة أعلى.',
      icon: <Zap className="w-4 h-4" />,
      color: 'border-amber-500/50 text-amber-400 bg-amber-500/5',
      settings: {
        strictMode: false,
        strictMinScore: 4,
        strategyAdxThreshold: 15,
        strategyMinConfidence: 0.4,
        strategyRvolThreshold: 1.2,
        useStrategyTrendFilter: true,
        useStrategyConfidenceGate: false,
        useStrategyMomentumRule: true,
        useStrategyVolatilityRule: false,
        beastMode: true,
        useKineticEngine: true
      }
    },
    {
      id: 'beast_mode',
      name: 'الوحش المدمّر (أقصى صيد)',
      desc: 'نظام الوحش الكامل. لا يرحم السوق ويقتنص كل فرصة ممكنة.',
      icon: <Activity className="w-4 h-4 animate-pulse" />,
      color: 'border-rose-500/50 text-rose-400 bg-rose-500/5',
      settings: {
        strictMode: false,
        strictMinScore: 3,
        strategyAdxThreshold: 10,
        strategyMinConfidence: 0.3,
        strategyRvolThreshold: 1.0,
        useStrategyTrendFilter: false,
        useStrategyConfidenceGate: false,
        useStrategyMomentumRule: false,
        useStrategyVolatilityRule: false,
        beastMode: true,
        beastAutoAdapt: true,
        beastSlippageExploit: true,
        isNightmareMode: true,
        useKineticEngine: true
      }
    }
  ];

  const applyTemplate = (tplSettings: any) => {
    setSettings(prev => ({ ...prev, ...tplSettings }));
  };

  const calculateIntensity = () => {
    let score = 0;
    if (!(settings as any).strictMode) score += 30;
    if (!(settings as any).useStrategyTrendFilter) score += 20;
    if (!(settings as any).useStrategyConfidenceGate) score += 20;
    if ((settings as any).strategyAdxThreshold < 20) score += 15;
    if ((settings as any).strategyMinConfidence < 0.5) score += 15;
    if ((settings as any).beastMode) score += 100;
    
    if (score > 150) return { label: 'عدواني جداً (Very High)', color: 'text-rose-500' };
    if (score > 80) return { label: 'مرتفع (High)', color: 'text-amber-500' };
    if (score > 40) return { label: 'متوسط (Moderate)', color: 'text-blue-500' };
    return { label: 'منخفض/قناص (Low/Sniper)', color: 'text-emerald-500' };
  };

  const intensity = calculateIntensity();

  // Poll loop for live dashboard feel
  useEffect(() => {
    fetchData(); // initial
    fetchSettings(); // initial settings Load
    const interval = setInterval(() => {
      fetchData();
    }, 5000); // UI poll every 5s

    return () => clearInterval(interval);
  }, []);

  const fetchSettings = async () => {
    try {
       const res = await fetch('/api/settings');
       setSettings(await res.json());
    } catch(e) {}
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch('/api/settings', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(settings)
      });
      setSettings(await res.json());
    } catch(e) {}
    setSavingSettings(false);
  };

  const fetchData = async () => {
    try {
      const [wlRes, activeRes, histRes, statsRes, statusRes, contextRes, logsRes, adpRes] = await Promise.all([
        fetch('/api/scanner/watchlist'),
        fetch('/api/trades/active'),
        fetch('/api/trades/history'),
        fetch('/api/stats'),
        fetch('/api/bot/status'),
        fetch('/api/market/context'),
        fetch('/api/system/logs'),
        fetch('/api/system/adaptive-logs')
      ]);
      setWatchlist(await wlRes.json());
      setActiveTrades(await activeRes.json());
      setHistoryTrades(await histRes.json());
      setStats(await statsRes.json());
      const statusData = await statusRes.json();
      setBotActive(statusData.active);
      setMarketContext(await contextRes.json());
      setLogs(await logsRes.json());
      setAdaptiveLogs(await adpRes.json());
    } catch(e) { }
  }

  const getDisplayPnL = (pnl: number, amount: number) => {
    if (!isInverse) return pnl;
    const feeRate = settings.tradingFeeRate || 0.001;
    const totalFees = amount * feeRate;
    // Inverse PnL = - (Gross PnL) - Fees
    // Since pnl = Gross - Fees => Gross = pnl + Fees
    // Inverse PnL = - (pnl + Fees) - Fees = -pnl - 2*Fees
    return -pnl - (2 * totalFees);
  };

  const getDisplayPnLPerc = (pnlPerc: number, amount: number, leverage: number = 10) => {
    if (!isInverse) return pnlPerc;
    const feeRate = settings.tradingFeeRate || 0.001;
    const margin = amount / leverage;
    const totalFees = amount * feeRate;
    const feeImpactPerc = (totalFees / margin) * 100;
    // roe_inv = -gross_roe - fee_impact
    // roe_orig = gross_roe - fee_impact => gross_roe = roe_orig + fee_impact
    // roe_inv = -(roe_orig + fee_impact) - fee_impact = -roePerc - 2*fee_impact
    return -pnlPerc - (2 * feeImpactPerc);
  };

  const displayStats = (() => {
    if (!isInverse) return stats;
    
    const displayHistory = historyTrades.map(t => ({
      ...t,
      displayPnL: getDisplayPnL(t.pnl || 0, t.amount || 0)
    }));

    const totalPnl = displayHistory.reduce((acc, t) => acc + t.displayPnL, 0);
    const wins = displayHistory.filter(t => t.displayPnL > 0).length;
    const winRate = displayHistory.length > 0 ? (wins / displayHistory.length) * 100 : 0;

    return {
      ...stats,
      totalPnl,
      winRate
    };
  })();

  const openTradesProfit = activeTrades.reduce((acc, t) => acc + getDisplayPnL(t.pnl || 0, t.amount || 0), 0);
  const netBalance = settings.portfolioSize + displayStats.totalPnl + openTradesProfit;

  const togglePanic = async () => {
    const newState = !panicActive;
    try {
      const res = await fetch('/api/bot/panic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: newState })
      });
      const data = await res.json();
      if (data.success) {
        setPanicActive(newState);
      }
    } catch(e) {}
  };

  const manualRefreshScanner = async () => {
    setLoading(true);
    await fetchData();
    setLoading(false);
  }

  const toggleBot = async () => {
    try {
      const res = await fetch('/api/bot/toggle', { method: 'POST' });
      const data = await res.json();
      setBotActive(data.active);
    } catch (e) {
      console.error(e);
    }
  }

  // --- SORTING & PAGINATION CALCULATIONS ---
  const handleWlSort = (field: string) => {
    if (wlSortField === field) {
      setWlSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setWlSortField(field);
      setWlSortDir('asc');
    }
    setWlPage(1);
  };

  const handleHistSort = (field: string) => {
    if (histSortField === field) {
      setHistSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setHistSortField(field);
      setHistSortDir('asc');
    }
    setHistPage(1);
  };

  const handleAdeSort = (field: string) => {
    if (adeSortField === field) {
      setAdeSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setAdeSortField(field);
      setAdeSortDir('asc');
    }
    setAdePage(1);
  };

  // Watchlist sorting logic
  const sortedWatchlist = [...watchlist].sort((a, b) => {
    let valA: any = a[wlSortField];
    let valB: any = b[wlSortField];

    if (wlSortField === 'decision') {
      valA = a.decision?.action || '';
      valB = b.decision?.action || '';
    } else if (wlSortField === 'volatilityPass') {
      valA = a.checks?.volatilityPass ? 1 : 0;
      valB = b.checks?.volatilityPass ? 1 : 0;
    }

    if (valA === undefined || valA === null) return wlSortDir === 'asc' ? 1 : -1;
    if (valB === undefined || valB === null) return wlSortDir === 'asc' ? -1 : 1;

    if (typeof valA === 'string' && typeof valB === 'string') {
      return wlSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    } else {
      return wlSortDir === 'asc' ? valA - valB : valB - valA;
    }
  });

  const totalWlPages = Math.ceil(sortedWatchlist.length / wlPageSize) || 1;
  const paginatedWatchlist = sortedWatchlist.slice((wlPage - 1) * wlPageSize, wlPage * wlPageSize);

  // Closed Trades (History) sorting logic
  const sortedHistory = [...historyTrades].sort((a, b) => {
    let valA: any = a[histSortField];
    let valB: any = b[histSortField];

    if (histSortField === 'pnlPerc') {
      valA = getDisplayPnLPerc(a.pnlPerc || 0, a.amount || 0, a.leverage || 10);
      valB = getDisplayPnLPerc(b.pnlPerc || 0, b.amount || 0, b.leverage || 10);
    } else if (histSortField === 'pnl') {
      valA = getDisplayPnL(a.pnl || 0, a.amount || 0);
      valB = getDisplayPnL(b.pnl || 0, b.amount || 0);
    }

    if (valA === undefined || valA === null) return histSortDir === 'asc' ? 1 : -1;
    if (valB === undefined || valB === null) return histSortDir === 'asc' ? -1 : 1;

    if (typeof valA === 'string' && typeof valB === 'string') {
      return histSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    } else {
      return histSortDir === 'asc' ? valA - valB : valB - valA;
    }
  });

  const totalHistPages = Math.ceil(sortedHistory.length / histPageSize) || 1;
  const paginatedHistory = sortedHistory.slice((histPage - 1) * histPageSize, histPage * histPageSize);

  // Adaptive Cascade Logs sorting logic
  const sortedAdaptive = [...adaptiveLogs].sort((a, b) => {
    let valA: any = a[adeSortField];
    let valB: any = b[adeSortField];

    if (adeSortField.startsWith('metrics.')) {
      const key = adeSortField.split('.')[1];
      valA = a.metrics?.[key];
      valB = b.metrics?.[key];
    }

    if (valA === undefined || valA === null) return adeSortDir === 'asc' ? 1 : -1;
    if (valB === undefined || valB === null) return adeSortDir === 'asc' ? -1 : 1;

    if (typeof valA === 'string' && typeof valB === 'string') {
      return adeSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    } else {
      return adeSortDir === 'asc' ? valA - valB : valB - valA;
    }
  });

  const totalAdePages = Math.ceil(sortedAdaptive.length / adePageSize) || 1;
  const paginatedAdaptive = sortedAdaptive.slice((adePage - 1) * adePageSize, adePage * adePageSize);
  
  return (
    <div className="flex h-screen overflow-hidden bg-slate-900 border-t-4 border-emerald-500">
      {/* Sidebar */}
      <aside className="w-20 md:w-64 bg-slate-800/50 border-l border-slate-800 flex flex-col justify-between">
        <div>
          <div className="p-4 md:p-6 mb-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Target className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight hidden md:block text-slate-100">سنايبر <span className="text-emerald-400">3/3</span></h1>
          </div>
          <nav className="flex flex-col gap-2 px-2 md:px-4">
            <NavItem icon={<Activity />} label="لوحة التحكم ومراقبة السوق" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
            <NavItem icon={<Sliders className="text-amber-400" />} label="محاكي السيولة والباكتست" active={activeTab === 'replay'} onClick={() => setActiveTab('replay')} />
            <NavItem icon={<Zap className="text-amber-400" />} label="فحص الخروج التكيفي (Cascade Log)" active={activeTab === 'adaptiveLogs'} onClick={() => setActiveTab('adaptiveLogs')} />
            <NavItem icon={<BarChart2 />} label="سجل الصفقات الموحد" active={activeTab === 'trades'} onClick={() => setActiveTab('trades')} />
            <NavItem icon={<Settings />} label="لوحة التحكم والنظام الموحد" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
          </nav>
        </div>
        <div className="p-4 md:p-6">
          <button 
             onClick={toggleBot}
             className={`w-full flex items-center justify-center gap-3 px-3 py-4 rounded-lg border transition-all ${
               botActive 
                 ? 'bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20 text-rose-400 shadow-[0_0_15px_-3px_rgba(244,63,94,0.3)]' 
                 : 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-400'
             }`}
          >
             {botActive ? <Square className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
             <span className="hidden md:block font-bold mt-0.5">
               {botActive ? 'إيقاف الصيد' : 'بدء الصيد التلقائي'}
             </span>
          </button>

          <button 
             onClick={togglePanic}
             className={`w-full mt-3 flex items-center justify-center gap-3 px-3 py-3 rounded-lg border transition-all ${
               panicActive 
                 ? 'bg-rose-600 border-rose-500 text-white shadow-[0_0_20px_-3px_rgba(225,29,72,0.6)] animate-pulse' 
                 : 'bg-slate-950 border-slate-700 text-slate-500 hover:border-rose-500/50 hover:text-rose-400'
             }`}
          >
             <ShieldCheck className={`w-5 h-5 ${panicActive ? 'animate-bounce' : ''}`} />
             <span className="hidden md:block font-bold mt-0.5 whitespace-nowrap text-xs">
               {panicActive ? 'وضع الطوارئ نشط' : 'زر الذعر (Panic)'}
             </span>
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <main className="flex-1 overflow-y-auto w-full relative">
        <div className="max-w-6xl mx-auto p-4 md:p-8 w-full space-y-6">
          
          <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-3">
                 مرحباً بك في نظام القناص الصارم
                 {botActive && (
                   <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-full animate-pulse border border-emerald-500/30">
                     <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                     قيد الصيد التلقائي
                   </span>
                 )}
              </h2>
              <p className="text-slate-400 text-sm mt-1">يعمل النظام بشكل آلي وفق شروط الدخول 3/3 فقط للتصفية الفائقة.</p>
            </div>
            
            <div className="flex gap-2">
              <button 
                onClick={() => setIsInverse(!isInverse)}
                className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-all flex items-center gap-2 ${
                  isInverse 
                    ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 shadow-[0_0_10px_-2px_rgba(244,63,94,0.4)]' 
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${isInverse ? 'bg-rose-500 animate-pulse' : 'bg-slate-600'}`}></div>
                وضع المعكوس: {isInverse ? 'نشط' : 'معطل'}
              </button>
              <span className={`px-3 py-1.5 rounded-full border text-xs font-mono font-medium flex items-center gap-2 ${
                settings.tradingMode === 'LIVE' 
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-400' 
                  : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}>
                <span className={`w-2 h-2 rounded-full ${settings.tradingMode === 'LIVE' ? 'bg-rose-500 animate-pulse' : 'bg-yellow-500 animate-pulse'}`}></span>
                {settings.tradingMode === 'LIVE' ? '🚀 LIVE Trading Mode' : '🛡️ Paper Trading Mode'}
              </span>
            </div>
          </header>

          {activeTab === 'dashboard' && (
            <>
              {/* نظرة عامة على محفظة الحساب والأرباح المفتوحة */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                   <StatCard title="الرصيد الأساسي" value={`$${settings.portfolioSize.toFixed(2)}`} trend="رأس المال المالي" positive={true} />
                   <StatCard title="ربح الصفقات المفتوحة (عائم)" value={`${openTradesProfit >= 0 ? '+' : ''}$${openTradesProfit.toFixed(2)}`} trend={openTradesProfit >= 0 ? "أرباح جارية 🟢" : "انعكاس عائم 🔴"} positive={openTradesProfit >= 0} />
                   <StatCard title="الرصيد الصافي" value={`$${netBalance.toFixed(2)}`} trend="الرصيد الكلي الحالي" positive={netBalance >= settings.portfolioSize} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                   <StatCard title="إجمالي الأرباح" value={`$${displayStats.totalPnl.toFixed(2)}`} trend="" positive={displayStats.totalPnl >= 0} />
                   <StatCard title="نسبة الدقة (Win Rate)" value={`${displayStats.winRate.toFixed(1)}%`} trend={`${displayStats.totalTrades} صفقات`} />
                   <StatCard title="الصفقات المفتوحة" value={displayStats.openCount.toString()}  />
              </div>

              {/* Intelligence Hub */}
              <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-6 relative overflow-hidden group">
                 <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 blur-[100px] -mr-32 -mt-32"></div>
                 <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                       <h3 className="text-lg font-bold flex items-center gap-2 text-slate-100">
                          <Activity className="w-5 h-5 text-emerald-400" />
                          مركز ذكاء القناص (7-Layer Intelligence Hub)
                       </h3>
                       <div className="flex gap-2">
                          <div className="px-2 py-1 rounded bg-slate-900 border border-emerald-500/20 text-[10px] text-emerald-400 font-mono">CORE_ENGINE: ACTIVE</div>
                          <div className="px-2 py-1 rounded bg-slate-900 border border-purple-500/20 text-[10px] text-purple-400 font-mono">RISK_SHIELD: ARMED</div>
                       </div>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                       <IntelligenceLayer 
                          label="طبقة السياق العالمي (Cloud)" 
                          value={marketContext?.marketSentiment?.replace('_', ' ') || 'NEUTRAL'} 
                          color={marketContext?.marketSentiment?.includes('GREED') ? 'text-emerald-400' : marketContext?.marketSentiment?.includes('FEAR') ? 'text-rose-400' : 'text-blue-400'} 
                          sub={`تأمين الفوضى: ${settings.layerGlobalContextEnabled ? 'نشط' : 'معطل'}`}
                          enabled={settings.layerGlobalContextEnabled}
                       />
                       <IntelligenceLayer 
                          label="طبقة نظام السوق (Regime)" 
                          value={marketContext?.regime || 'Tracking...'} 
                          color="text-amber-400" 
                          sub={`عتبة ADX: ${settings.strategyAdxThreshold}`} 
                          enabled={settings.layerRegimeEnabled}
                       />
                       <IntelligenceLayer 
                          label="طبقة السيولة (Liquidity)" 
                          value={marketContext?.trapStatus || 'Scanning...'} 
                          color="text-blue-400" 
                          sub="رصد الأهداف القوية" 
                          enabled={settings.layerLiquidityEnabled}
                       />
                       <IntelligenceLayer 
                          label="طبقة الزخم (Beast)" 
                          value={botActive ? "Sniper V4" : "Standby"} 
                          color="text-emerald-400" 
                          sub={`RVOL Min: ${settings.strategyRvolThreshold}`} 
                          enabled={settings.layerMomentumEnabled}
                       />
                    </div>
                 </div>
              </div>

              {/* Active Trades */}
              {activeTrades.length > 0 && (
                <div className="rounded-xl border border-emerald-500/30 overflow-hidden shadow-[0_0_15px_-3px_rgba(16,185,129,0.2)]">
                  <div className="p-4 bg-emerald-500/10 border-b border-emerald-500/30">
                    <h3 className="font-bold text-emerald-400 flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5" />
                      صفقات نشطة قيد الإدارة (Sniper Engine Live)
                    </h3>
                  </div>
                  <div className="bg-slate-800/80 p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {activeTrades.map((t, idx) => (
                        <div key={idx} className="bg-slate-900 border border-slate-700 rounded-lg p-4 relative overflow-hidden">
                           {t.isBreakeven && <div className="absolute top-0 right-0 px-2 py-1 bg-blue-500 text-white text-[10px] font-bold rounded-bl">Breakeven Secured</div>}
                           <div className="flex justify-between items-start mt-2">
                             <div>
                                <h4 className="font-bold text-lg font-mono text-white flex items-center gap-2">
                                  {t.symbol} 
                                  {isInverse ? (
                                    t.type === 'LONG' ? <span className="text-rose-500 text-xs bg-rose-500/10 px-1 rounded">SHORT</span> : <span className="text-emerald-500 text-xs bg-emerald-500/10 px-1 rounded">LONG</span>
                                  ) : (
                                    t.type === 'LONG' ? <span className="text-emerald-500 text-xs bg-emerald-500/10 px-1 rounded">LONG</span> : <span className="text-rose-500 text-xs bg-rose-500/10 px-1 rounded">SHORT</span>
                                  )}
                                </h4>
                                <p className="text-xs text-slate-400 mt-1">السعر الحالي: <span className="font-mono text-slate-300">{t.currentPrice ? parseFloat(t.currentPrice as any).toFixed(4) : '...'}</span></p>
                                <p className="text-xs text-slate-400 mt-1">الدخول: <span className="font-mono text-slate-300">{parseFloat(t.entryPrice as any).toFixed(4)}</span></p>
                                <p className="text-xs text-slate-400 mt-1">تاريخ الدخول: <span className="font-mono text-emerald-400 font-medium">{new Date(t.entryTime || Date.now()).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}</span></p>
                                <p className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                                  <span>حجم الصفقة: <span className="font-mono text-slate-300">${parseFloat(t.amount as any).toFixed(2)}</span></span>
                                  <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px] font-mono">{(t as any).leverage || 10}x</span>
                                </p>
                                <p className="text-xs text-slate-400 mt-1">القيمة الحالية: <span className="font-mono text-slate-300">${(parseFloat(t.amount as any) + getDisplayPnL(t.pnl || 0, t.amount || 0)).toFixed(2)}</span></p>
                             </div>
                             <div className="text-left">
                                <span className={`font-mono font-bold text-lg ${getDisplayPnLPerc(t.pnlPerc || 0, t.amount || 0, t.leverage || 10) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {getDisplayPnLPerc(t.pnlPerc || 0, t.amount || 0, t.leverage || 10) >= 0 ? '+' : ''}{getDisplayPnLPerc(t.pnlPerc || 0, t.amount || 0, t.leverage || 10)?.toFixed(2)}%
                                </span>
                                <p className={`text-xs font-mono text-right ${getDisplayPnL(t.pnl || 0, t.amount || 0) >= 0 ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
                                  ${getDisplayPnL(t.pnl || 0, t.amount || 0)?.toFixed(2)}
                                </p>
                             </div>
                           </div>
                           
                           <div className="mt-4 pt-4 border-t border-slate-800 grid grid-cols-2 gap-2 text-xs text-slate-400">
                              <div>وقف الخسارة: <span className="font-mono text-slate-200 block">{parseFloat(t.sl).toFixed(4)}</span></div>
                              <div>الهدف القادم (+1R): <span className="font-mono text-slate-200 block">{parseFloat(t.tp1).toFixed(4)}</span></div>
                           </div>

                           {/* Steel or Adaptive exit real-time status */}
                           {t.latestSteelResult ? (
                             <div className="mt-3 pt-3 border-t border-indigo-500/30 bg-gradient-to-l from-slate-950 via-slate-900 to-indigo-950/20 p-2.5 rounded-lg border border-indigo-500/20 space-y-2.5">
                               <div className="flex justify-between items-center text-[11px]">
                                 <div className="flex items-center gap-1 font-bold text-indigo-300">
                                   <Cpu className="w-3.5 h-3.5 text-indigo-400 animate-spin" style={{ animationDuration: '8s' }} />
                                   <span>المحرك الفولاذي الموحد</span>
                                 </div>
                                 <span className={`px-1.5 py-0.5 rounded font-black text-[9px] uppercase border ${
                                   t.latestSteelResult.decision === 'CONTINUE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10' :
                                   t.latestSteelResult.decision === 'HOLD_FOR_MOON' ? 'bg-gradient-to-r from-purple-500/20 to-indigo-500/20 text-indigo-300 border-indigo-500/20 font-bold animate-pulse' :
                                   t.latestSteelResult.decision === 'TRAIL_TIGHT' ? 'bg-amber-500/10 text-amber-400 border-amber-500/10' :
                                   t.latestSteelResult.decision === 'PARTIAL_PROFIT' ? 'bg-blue-500/10 text-blue-400 border-blue-500/15 font-bold' :
                                   'bg-rose-500/10 text-rose-455 border-rose-500/10'
                                 }`}>
                                   {t.latestSteelResult.decision === 'CONTINUE' ? '✓ استمرار فولاذي' :
                                    t.latestSteelResult.decision === 'HOLD_FOR_MOON' ? '🚀 تمسك قمري' :
                                    t.latestSteelResult.decision === 'TRAIL_TIGHT' ? '⚠️ وقف مشدود' :
                                    t.latestSteelResult.decision === 'PARTIAL_PROFIT' ? '💸 جني جزئي' :
                                    '🛑 تسييل فوري'}
                                 </span>
                               </div>

                               {/* Live Indicators & Trends */}
                               <div className="grid grid-cols-3 gap-1 px-1.5 py-1 bg-slate-950/40 rounded-lg text-[9px] font-mono text-center">
                                 <div>
                                   <div className="text-slate-500 text-[8px] truncate">الاحتمال الاتجاهي</div>
                                   <div className="text-indigo-300 font-bold mt-0.5">
                                     {t.type === 'LONG' ? t.latestSteelResult.longProb.toFixed(0) : t.latestSteelResult.shortProb.toFixed(0)}%
                                   </div>
                                 </div>
                                 <div>
                                   <div className="text-slate-500 text-[8px] truncate">ضغط الحيتان Delta</div>
                                   <div className={`font-bold mt-0.5 ${t.latestSteelResult.takerRatio > 1.0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                     {t.latestSteelResult.takerRatio.toFixed(2)}
                                   </div>
                                 </div>
                                 <div>
                                   <div className="text-slate-500 text-[8px] truncate">سرعة العقود OI</div>
                                   <div className={`font-bold mt-0.5 ${t.latestSteelResult.oiChange > 0 ? 'text-emerald-400' : 'text-rose-450'}`}>
                                     {t.latestSteelResult.oiChange > 0 ? '+' : ''}{t.latestSteelResult.oiChange.toFixed(2)}%
                                   </div>
                                 </div>
                               </div>

                               {/* Detailed exit plan explanations */}
                               <div className="text-[10px] space-y-1 bg-slate-900/60 p-2 rounded-lg border border-slate-800/35">
                                 <div className="flex justify-between items-center text-[9px]">
                                   <span className="text-slate-500">حالة الموقف:</span>
                                   <span className="text-indigo-200 font-extrabold">{t.latestSteelResult.currentState}</span>
                                 </div>
                                 <div className="text-[9px] leading-relaxed text-slate-300 font-sans mt-1">
                                   <span className="font-extrabold text-indigo-400 block pb-0.5">🔍 آلية وتفسير الخروج:</span>
                                   {t.latestSteelResult.exitIndicator}
                                 </div>
                               </div>
                             </div>
                           ) : t.latestAdaptiveResult ? (
                             <div className="mt-3 pt-3 border-t border-slate-800/80 bg-slate-950/40 p-2.5 rounded-lg space-y-2">
                               <div className="flex justify-between items-center text-[11px]">
                                 <span className="text-slate-400 font-medium">مراقبة الخروج التكيفي Tracker:</span>
                                 <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] uppercase border ${
                                   t.latestAdaptiveResult.decision === 'CONTINUE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                   t.latestAdaptiveResult.decision === 'HOLD_FOR_MOON' ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-pink-400 border-pink-500/30 font-bold animate-pulse' :
                                   t.latestAdaptiveResult.decision === 'TRAIL_TIGHT' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                   'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                 }`}>
                                   {t.latestAdaptiveResult.decision === 'CONTINUE' ? '✓ استمرار' :
                                    t.latestAdaptiveResult.decision === 'HOLD_FOR_MOON' ? '🚀 تمسك قمري' :
                                    t.latestAdaptiveResult.decision === 'TRAIL_TIGHT' ? '⚠️ تشديد الوقف' :
                                    '🛑 خروج فوراً'}
                                 </span>
                               </div>

                               {/* Live Indicators & Trends */}
                               <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono text-center">
                                 <div className="bg-slate-900/60 p-1 rounded border border-slate-800/40">
                                   <div className="text-slate-500 text-[8px] truncate">السيولة OI</div>
                                   <div className="flex items-center justify-center gap-0.5 mt-0.5">
                                     <span className="text-slate-200">
                                       {t.latestAdaptiveResult.metrics.openInterest ? (t.latestAdaptiveResult.metrics.openInterest > 1e6 ? `${(t.latestAdaptiveResult.metrics.openInterest / 1e6).toFixed(1)}M` : t.latestAdaptiveResult.metrics.openInterest.toFixed(0)) : 'N/A'}
                                     </span>
                                     {t.latestAdaptiveResult.metrics.oiTrend === 'UP' && <span className="text-emerald-400">▲</span>}
                                     {t.latestAdaptiveResult.metrics.oiTrend === 'DOWN' && <span className="text-rose-400">▼</span>}
                                     {t.latestAdaptiveResult.metrics.oiTrend === 'FLAT' && <span className="text-slate-500">■</span>}
                                   </div>
                                 </div>
                                 <div className="bg-slate-900/60 p-1 rounded border border-slate-800/40">
                                   <div className="text-slate-500 text-[8px] truncate">حجم Vol</div>
                                   <div className="flex items-center justify-center gap-0.5 mt-0.5">
                                     <span className="text-slate-200">
                                       {t.latestAdaptiveResult.metrics.volume ? (t.latestAdaptiveResult.metrics.volume > 1e6 ? `${(t.latestAdaptiveResult.metrics.volume / 1e6).toFixed(1)}M` : t.latestAdaptiveResult.metrics.volume.toFixed(0)) : 'N/A'}
                                     </span>
                                     {t.latestAdaptiveResult.metrics.volTrend === 'UP' && <span className="text-emerald-400">▲</span>}
                                     {t.latestAdaptiveResult.metrics.volTrend === 'DOWN' && <span className="text-rose-400">▼</span>}
                                     {t.latestAdaptiveResult.metrics.volTrend === 'FLAT' && <span className="text-slate-500">■</span>}
                                   </div>
                                 </div>
                                 <div className="bg-slate-900/60 p-1 rounded border border-slate-800/40">
                                   <div className="text-slate-500 text-[8px] truncate">Taker</div>
                                   <div className="flex items-center justify-center gap-0.5 mt-0.5">
                                     <span className={`font-semibold ${
                                       t.latestAdaptiveResult.metrics.takerTrend === 'BULLISH' ? 'text-emerald-400' :
                                       t.latestAdaptiveResult.metrics.takerTrend === 'BEARISH' ? 'text-rose-400' : 'text-slate-200'
                                     }`}>
                                       {t.latestAdaptiveResult.metrics.takerRatio ? t.latestAdaptiveResult.metrics.takerRatio.toFixed(2) : '1.00'}
                                     </span>
                                   </div>
                                 </div>
                               </div>

                               {/* Decision reason */}
                               <div className="text-[10px] text-slate-300 flex flex-col gap-0.5 leading-normal">
                                 <div className="text-slate-500 text-[9px]">سبب القرار:</div>
                                 <div className="italic text-slate-300 line-clamp-2 leading-relaxed bg-slate-900/40 px-1.5 py-1 rounded border border-slate-850/30 font-sans">
                                   {t.latestAdaptiveResult.reason}
                                 </div>
                               </div>
                             </div>
                           ) : (
                             <div className="mt-3 pt-3 border-t border-slate-800/80 text-center text-slate-600 text-[10px] italic">
                               بانتظار مخرجات الفحص التكيفي...
                             </div>
                           )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Watchlist Table */}
              <div className="mt-8 rounded-xl bg-slate-800/50 border border-slate-700/50 overflow-hidden">
                <div className="p-5 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/80">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Target className="w-5 h-5 text-emerald-400" />
                    قائمة المراقبة الذهبية (يتحدث تلقائياً)
                  </h3>
                  <button onClick={manualRefreshScanner} disabled={loading} className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors flex items-center gap-2 text-sm font-medium">
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    تحديث
                  </button>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm">
                     <thead className="bg-slate-800/30 text-slate-400 border-b border-slate-750">
                      <tr>
                        <SortableHeader label="العملة" field="symbol" sortField={wlSortField} sortDir={wlSortDir} onSort={handleWlSort} />
                        <SortableHeader label="التقييم" field="score" sortField={wlSortField} sortDir={wlSortDir} onSort={handleWlSort} />
                        <SortableHeader label="الاتجاه" field="trend" sortField={wlSortField} sortDir={wlSortDir} onSort={handleWlSort} />
                        <SortableHeader label="RVOL" field="rvol" sortField={wlSortField} sortDir={wlSortDir} onSort={handleWlSort} />
                        <SortableHeader label="التذبذب" field="volatility" sortField={wlSortField} sortDir={wlSortDir} onSort={handleWlSort} />
                        <th className="px-5 py-3 font-semibold text-slate-300">حالة الفحوصات</th>
                        <SortableHeader label="محرك القرار (7-Layers)" field="decision" sortField={wlSortField} sortDir={wlSortDir} onSort={handleWlSort} />
                      </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-700/50">
                        {paginatedWatchlist.length === 0 && !loading && (
                           <tr>
                             <td colSpan={7} className="py-8 text-center text-slate-500">جاري مسح الأسواق أو لا توجد عملات استوفت الشروط...</td>
                           </tr>
                        )}
                        {paginatedWatchlist.map((coin, i) => (
                           <tr key={i} className="hover:bg-slate-700/20 transition-colors">
                              <td className="px-5 py-4 font-bold font-mono text-emerald-400">{coin.symbol}</td>
                              <td className="px-5 py-4">
                                <span className={`px-2 py-1 rounded inline-flex items-center gap-1 font-bold ${coin.score >= 5 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-yellow-500/10 text-yellow-500'}`}>
                                  {coin.score}/5
                                  {coin.score >= 5 && <span className="text-xs">🔥</span>}
                                </span>
                              </td>
                               <td className="px-5 py-4 text-slate-300 flex items-center gap-2 mt-2">
                                {isInverse ? (
                                  coin.trend === 'LONG' ? <TrendingDown className="w-4 h-4 text-rose-400" /> : coin.trend === 'SHORT' ? <TrendingUp className="w-4 h-4 text-emerald-400"/> : '-'
                                ) : (
                                  coin.trend === 'LONG' ? <TrendingUp className="w-4 h-4 text-emerald-400"/> : coin.trend === 'SHORT' ? <TrendingDown className="w-4 h-4 text-rose-400" /> : '-'
                                )}
                                {isInverse ? (coin.trend === 'LONG' ? 'SHORT' : coin.trend === 'SHORT' ? 'LONG' : coin.trend) : coin.trend}
                              </td>
                              <td className="px-5 py-4 font-mono text-slate-300">{coin.rvol.toFixed(2)}x</td>
                              <td className="px-5 py-4 font-mono text-slate-300">{coin.volatility.toFixed(1)}%</td>
                              <td className="px-5 py-4 flex gap-1 items-center h-full mt-3 flex-wrap">
                                <CheckBadge active={coin.checks.volumePass} label="VOL" />
                                <CheckBadge active={coin.checks.rvolPass} label="RVOL" />
                                <CheckBadge active={coin.checks.volatilityPass} label="VOLA" />
                                <CheckBadge active={coin.checks.spreadPass} label="SPR" />
                                <CheckBadge active={coin.checks.oiPass} label="OI" />
                              </td>
                              <td className="px-5 py-4 font-sans">
                                {coin.decision ? (
                                   <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-2">
                                         <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                           (isInverse ? (coin.decision.action === 'SLEEP') : (coin.decision.action === 'ATTACK')) ? 'bg-rose-500 text-white animate-pulse' : 
                                           coin.decision.action === 'SLEEP' ? 'bg-slate-700 text-slate-400' : 'bg-blue-500/20 text-blue-400'
                                         }`}>
                                            {isInverse ? (
                                                coin.decision.action === 'ATTACK' ? '😴 خمول (معكوس)' : coin.decision.action === 'SLEEP' ? '🔥 الهجوم (معكوس)' : '⏳ انتظار'
                                            ) : (
                                                coin.decision.action === 'ATTACK' ? (coin.decision.confidence < 0.6 ? '🔥 الهجوم' : '🎯 قناص') : coin.decision.action === 'SLEEP' ? '😴 خمول' : '⏳ انتظار'
                                            )}
                                         </span>
                                         <span className="text-[10px] text-slate-400 font-mono">{(coin.decision.confidence * 100).toFixed(0)}%</span>
                                       </div>
                                       {(isInverse ? (coin.decision.action === 'SLEEP') : (coin.decision.confidence < 0.6 && coin.decision.action === 'ATTACK')) && (
                                          <div className="text-[9px] text-rose-400 font-bold italic font-sans">
                                             {isInverse ? '⚠️ تقييم غير مكتمل (معكوس)' : '⚠️ تقييم غير مكتمل'}
                                          </div>
                                       )}
                                       <div className="text-[10px] text-emerald-400/80 font-medium font-sans animate-pulse">
                                          {coin.decision.regime}
                                       </div>
                                       <div className="text-[9px] text-slate-500 truncate max-w-[120px] font-sans" title={coin.decision.reason}>
                                          {coin.decision.reason}
                                       </div>
                                    </div>
                                 ) : (
                                    <span className="text-slate-600 font-mono text-[10px]">No Data</span>
                                 )}
                              </td>
                           </tr>
                        ))}
                     </tbody>
                  </table>
                </div>
                {totalWlPages > 1 && (
                  <TablePagination 
                    currentPage={wlPage} 
                    totalPages={totalWlPages} 
                    onPageChange={setWlPage} 
                  />
                )}
              </div>

              {/* System Execution Logs */}
              <div className="mt-8 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shadow-2xl">
                 <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
                    <h3 className="text-xs font-bold text-slate-400 flex items-center gap-2 tracking-widest uppercase">
                       <Activity className="w-4 h-4 text-emerald-500" />
                       سجل التنفيذ المباشر (Live Core Logs)
                    </h3>
                    <div className="flex gap-2">
                       <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                       <span className="text-[10px] text-emerald-500/70 font-mono italic">STREAMING_ACTIVE</span>
                    </div>
                 </div>
                 <div className="p-4 h-48 overflow-y-auto font-mono text-[11px] space-y-1 bg-black/20 text-right">
                    {logs.length === 0 ? (
                       <div className="text-slate-600 italic">بانتظار أحداث النظام...</div>
                    ) : logs.slice().reverse().map((log, i) => (
                       <div key={i} className="flex gap-3 border-b border-slate-800/30 pb-1">
                          <span className="text-slate-500">[{new Date(log.time).toLocaleTimeString()}]</span>
                          <span className={`${
                             log.level === 'error' ? 'text-rose-500' : 
                             log.level === 'warn' ? 'text-amber-500' : 'text-emerald-400/80'
                          }`}>
                             {log.level.toUpperCase()}
                          </span>
                          <span className="text-slate-300">{log.msg}</span>
                       </div>
                    ))}
                 </div>
              </div>
            </>
          )}

          {activeTab === 'trades' && (
             <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 overflow-hidden">
                <div className="p-5 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/80">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <BarChart2 className="w-5 h-5 text-emerald-400" />
                    سجل الصفقات المغلقة (القناص)
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm text-slate-300 font-sans">
                     <thead className="bg-slate-800/30 text-slate-400 border-b border-slate-750">
                      <tr>
                        <SortableHeader label="العملة" field="symbol" sortField={histSortField} sortDir={histSortDir} onSort={handleHistSort} />
                        <SortableHeader label="الآلية" field="source" sortField={histSortField} sortDir={histSortDir} onSort={handleHistSort} />
                        <SortableHeader label="النوع" field="type" sortField={histSortField} sortDir={histSortDir} onSort={handleHistSort} />
                        <SortableHeader label="الرافعة" field="leverage" sortField={histSortField} sortDir={histSortDir} onSort={handleHistSort} />
                        <SortableHeader label="الدخول" field="entryPrice" sortField={histSortField} sortDir={histSortDir} onSort={handleHistSort} />
                        <SortableHeader label="الخروج" field="exitPrice" sortField={histSortField} sortDir={histSortDir} onSort={handleHistSort} />
                        <SortableHeader label="PnL %" field="pnlPerc" sortField={histSortField} sortDir={histSortDir} onSort={handleHistSort} />
                        <SortableHeader label="الربح ($)" field="pnl" sortField={histSortField} sortDir={histSortDir} onSort={handleHistSort} />
                        <SortableHeader label="الحالة" field="exitReason" sortField={histSortField} sortDir={histSortDir} onSort={handleHistSort} />
                        <th className="px-5 py-3 font-semibold text-slate-300 text-right">تقرير كاسكيد</th>
                      </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-700/50">
                        {paginatedHistory.length === 0 ? (
                           <tr>
                             <td colSpan={10} className="py-8 text-center text-slate-500">لم يتم إغلاق أي صفقة بعد أو لا توجد صفقات مطابقة.</td>
                           </tr>
                        ) : paginatedHistory.map((t, i) => (
                           <tr key={i} className="hover:bg-slate-700/20 transition-colors">
                              <td className="px-5 py-4 font-bold font-mono text-slate-100">{t.symbol}</td>
                              <td className="px-5 py-4">
                                 {t.source === 'AGGRESSIVE_INCOMPLETE' || t.source === 'DIRECT_ENTRY' ? (
                                    <div className="flex flex-col gap-1">
                                       <span className="flex items-center gap-1 text-[10px] bg-rose-500/10 text-rose-400 px-2 py-1 rounded border border-rose-500/20 whitespace-nowrap font-bold w-fit">
                                          <Zap className="w-3 h-3 fill-current" />
                                          هجومي 🔥
                                       </span>
                                    </div>
                                 ) : (
                                    <span className="flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded border border-emerald-500/20 whitespace-nowrap font-medium w-fit">
                                       <Target className="w-3 h-3" />
                                       قناص 🎯
                                     </span>
                                 )}
                              </td>
                              <td className="px-5 py-4">
                                 {isInverse ? (
                                    t.type === 'LONG' ? <span className="text-rose-500 font-bold">SHORT</span> : <span className="text-emerald-500 font-bold">LONG</span>
                                 ) : (
                                    t.type === 'LONG' ? <span className="text-emerald-500 font-bold">LONG</span> : <span className="text-rose-500 font-bold">SHORT</span>
                                 )}
                              </td>
                              <td className="px-5 py-4 font-mono text-slate-400">{(t as any).leverage || 10}x</td>
                              <td className="px-5 py-4 font-mono text-slate-400">{parseFloat(t.entryPrice).toFixed(4)}</td>
                              <td className="px-5 py-4 font-mono text-slate-400">{parseFloat(t.exitPrice).toFixed(4)}</td>
                              <td className={`px-5 py-4 font-mono font-bold ${getDisplayPnLPerc(t.pnlPerc || 0, t.amount || 0, t.leverage || 10) > 0 ? 'text-emerald-400' : getDisplayPnLPerc(t.pnlPerc || 0, t.amount || 0, t.leverage || 10) === 0 ? 'text-slate-400' : 'text-rose-400'}`}>
                                {getDisplayPnLPerc(t.pnlPerc || 0, t.amount || 0, t.leverage || 10) > 0 ? '+' : ''}{getDisplayPnLPerc(t.pnlPerc || 0, t.amount || 0, t.leverage || 10)?.toFixed(2)}%
                              </td>
                              <td className={`px-5 py-4 font-mono ${getDisplayPnL(t.pnl || 0, t.amount || 0) > 0 ? 'text-emerald-400' : getDisplayPnL(t.pnl || 0, t.amount || 0) === 0 ? 'text-slate-400' : 'text-rose-400'}`}>
                                {getDisplayPnL(t.pnl || 0, t.amount || 0) > 0 ? '+' : ''}${getDisplayPnL(t.pnl || 0, t.amount || 0)?.toFixed(2)}
                              </td>
                              <td className="px-5 py-4">
                                <span className={`px-2 py-1 text-[10px] rounded ${getDisplayPnL(t.pnl || 0, t.amount || 0) > 0 ? 'bg-emerald-500/20 text-emerald-400' : (t.isBreakeven || getDisplayPnL(t.pnl || 0, t.amount || 0) === 0) ? 'bg-blue-500/20 text-blue-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                  {getDisplayPnL(t.pnl || 0, t.amount || 0) > 0 ? 'ربح محقق 🎯' : (t.isBreakeven || getDisplayPnL(t.pnl || 0, t.amount || 0) === 0) ? 'حماية الدخول 🛡️' : 'خسارة محددة 🛑'}
                                </span>
                              </td>
                              <td className="px-5 py-4">
                                <button
                                  onClick={() => setSelectedTradeForCascade(t)}
                                  className="text-xs bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/30 font-bold transition-all flex items-center justify-center gap-1 hover:scale-105 active:scale-95 cursor-pointer"
                                >
                                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                                  الفحوصات 📊
                                </button>
                              </td>
                           </tr>
                        ))}
                     </tbody>
                  </table>
                </div>
                {totalHistPages > 1 && (
                  <TablePagination
                    currentPage={histPage}
                    totalPages={totalHistPages}
                    onPageChange={setHistPage}
                  />
                )}
             </div>
          )}

          {activeTab === 'adaptiveLogs' && (
             <div className="space-y-6">
                {/* Visual Header */}
                <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-6 relative overflow-hidden group">
                   <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 blur-[100px] -mr-32 -mt-32"></div>
                   <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                      <div>
                         <h3 className="text-xl font-bold flex items-center gap-2 text-slate-100">
                            <Zap className="w-5 h-5 text-amber-400" />
                            سجل الفحص التكيفي والتدفقات (Adaptive Cascade Telemetry Block)
                         </h3>
                         <p className="text-xs text-slate-400 mt-1">تتبع التدفق الذكي لقرارات حماية الأرباح وتجنب الخروج العشوائي بناءً على السيولة اللحظية ومؤشرات الحوت.</p>
                      </div>
                      <div className="flex gap-2">
                         <span className="text-[10px] px-2 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded font-bold">حالة الفحص النشط: آمن 🛡️</span>
                         <span className="text-[10px] px-2 py-1 bg-slate-900 text-slate-400 rounded font-mono font-bold">OI_THRESHOLD: ACTIVE</span>
                      </div>
                   </div>
                </div>

                {/* Main Table */}
                <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 overflow-hidden">
                   <div className="p-5 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/80">
                      <h4 className="text-sm font-bold flex items-center gap-2 text-slate-300">
                         <Activity className="w-4 h-4 text-emerald-400" />
                         تدفق الفحوصات الحية للصفقات النشطة (الاستمرار / الخروج القسري)
                      </h4>
                   </div>
                   <div className="overflow-x-auto">
                      <table className="w-full text-right text-sm text-slate-300 font-sans">
                         <thead className="bg-slate-800/30 text-slate-400 border-b border-slate-750">
                            <tr>
                               <SortableHeader label="تاريخ الفحص" field="time" sortField={adeSortField} sortDir={adeSortDir} onSort={handleAdeSort} />
                               <SortableHeader label="العملة" field="symbol" sortField={adeSortField} sortDir={adeSortDir} onSort={handleAdeSort} />
                               <SortableHeader label="المخرجات / القرار" field="decision" sortField={adeSortField} sortDir={adeSortDir} onSort={handleAdeSort} />
                               <SortableHeader label="السيولة (Open Interest)" field="metrics.openInterest" sortField={adeSortField} sortDir={adeSortDir} onSort={handleAdeSort} />
                               <SortableHeader label="قوة المشترين (Taker)" field="metrics.takerRatio" sortField={adeSortField} sortDir={adeSortDir} onSort={handleAdeSort} />
                               <th className="px-5 py-3 font-semibold text-slate-300">تفاصيل معطيات القرار والمؤشرات الحية</th>
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-700/50">
                            {paginatedAdaptive.length === 0 ? (
                               <tr>
                                  <td colSpan={6} className="py-8 text-center text-slate-500 font-medium font-sans">لا توجد سجلات فحص تكيفية حالياً للصفقات المفتوحة.</td>
                               </tr>
                            ) : paginatedAdaptive.map((log, i) => (
                               <tr key={i} className="hover:bg-slate-700/10 transition-colors">
                                  <td className="px-5 py-4 font-mono text-xs text-slate-400 text-nowrap">
                                     {new Date(log.time || Date.now()).toLocaleTimeString('ar-SA')} - {new Date(log.time || Date.now()).toLocaleDateString('ar-SA')}
                                  </td>
                                  <td className="px-5 py-4 font-bold font-mono text-slate-100">{log.symbol}</td>
                                  <td className="px-5 py-4">
                                     <span className={`px-2 py-1 text-[11px] font-bold rounded ${
                                        log.decision === 'CONTINUE' || log.decision?.includes('STAY') ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' :
                                        log.decision === 'SL_TRAIL' || log.decision?.includes('TRAIL') ? 'bg-amber-500/20 text-amber-400 border border-amber-500/20 animate-pulse' :
                                        'bg-rose-500/20 text-rose-400 border border-rose-500/20'
                                     }`}>
                                        {log.decision === 'CONTINUE' && 'استمرار بالصفقة 💎'}
                                        {log.decision === 'SL_TRAIL' && 'تأمين وزحف الوقف 🛡️'}
                                        {log.decision === 'EXIT_NOW' && 'خروج فوري وتصفية 🚨'}
                                        {!['CONTINUE', 'SL_TRAIL', 'EXIT_NOW'].includes(log.decision || '') && log.decision}
                                     </span>
                                  </td>
                                  <td className="px-5 py-4 font-mono">
                                     {log.metrics?.openInterest ? (
                                        <div className="flex flex-col">
                                           <span className="font-bold text-slate-200">
                                              {log.metrics.openInterest > 1e6 ? `${(log.metrics.openInterest / 1e6).toFixed(2)}M` : log.metrics.openInterest.toFixed(0)}
                                           </span>
                                           <span className={`text-[10px] ${log.metrics.oiChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                              {log.metrics.oiChange >= 0 ? '↗ زاد الاهتمام' : '↘ نقص الاهتمام'} ({log.metrics.oiChange?.toFixed(2)}%)
                                           </span>
                                        </div>
                                     ) : (
                                        <span className="text-slate-600 font-mono text-xs">-</span>
                                     )}
                                  </td>
                                  <td className="px-5 py-4 font-mono">
                                     {log.metrics?.takerRatio ? (
                                        <div className="flex flex-col">
                                           <span className={`font-bold ${log.metrics.takerRatio >= 1.0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                              {(log.metrics.takerRatio * 100).toFixed(1)}%
                                           </span>
                                           <span className="text-[10px] text-slate-500">معدل الشراء</span>
                                        </div>
                                     ) : (
                                        <span className="text-slate-600 font-mono text-xs">-</span>
                                     )}
                                  </td>
                                  <td className="px-5 py-4 font-sans text-xs max-w-sm">
                                     <div className="text-slate-300 leading-relaxed font-semibold">
                                        {log.reason}
                                     </div>
                                  </td>
                               </tr>
                            ))}
                         </tbody>
                      </table>
                   </div>
                   {totalAdePages > 1 && (
                      <TablePagination
                         currentPage={adePage}
                         totalPages={totalAdePages}
                         onPageChange={setAdePage}
                      />
                   )}
                </div>
             </div>
          )}

          {activeTab === 'replay' && (
             <ReplaySimulatorView />
          )}

          {activeTab === 'settings' && (
             <SettingsView 
                settings={settings} 
                setSettings={setSettings} 
                savingSettings={savingSettings} 
                saveSettings={saveSettings} 
                applyTemplate={applyTemplate} 
                STRATEGY_TEMPLATES={STRATEGY_TEMPLATES} 
                intensity={intensity} 
             />
          )}

        </div>
      </main>

      {/* Floating Modal for Cascade Diagnostics */}
      {selectedTradeForCascade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md transition-all">
           <div className="w-full max-w-3xl bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden flex flex-col max-h-[85vh]">
              {/* Header */}
              <div className="p-5 border-b border-slate-700/50 bg-slate-800/85 flex justify-between items-center text-right">
                 <button 
                    onClick={() => setSelectedTradeForCascade(null)}
                    className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 text-xs px-3 py-1.5 rounded-lg border border-slate-700 cursor-pointer font-bold transition-all mr-auto"
                 >
                    إغلاق ✕
                 </button>
                 <div className="flex items-center gap-3">
                    <div className="text-right">
                       <h3 className="text-lg font-black text-white flex items-center gap-2 justify-end">
                          سجل فحص كاسكيد: <span className="font-mono text-emerald-400">{selectedTradeForCascade.symbol}</span>
                       </h3>
                       <p className="text-[11px] text-slate-400">تتبع التدفق الزمني لقرارات حماية الأرباح وتأمين الصفقة من الأحدث للأقدم</p>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                       <Activity className="w-5 h-5 text-white animate-pulse" />
                    </div>
                 </div>
              </div>

              {/* Summary row */}
              <div className="px-6 py-4 bg-slate-950/40 border-b border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-sans text-right" dir="rtl">
                 <div className="space-y-1">
                    <span className="text-slate-500 block">نوع الصفقة:</span>
                    <div className="font-bold">
                       {selectedTradeForCascade.type === 'LONG' ? (
                          <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">LONG 📈</span>
                       ) : (
                          <span className="text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">SHORT 📉</span>
                       )}
                    </div>
                 </div>
                 <div className="space-y-1">
                    <span className="text-slate-500 block">سعر الدخول / الخروج:</span>
                    <div className="font-mono text-slate-200 font-bold" dir="ltr">
                       {parseFloat(selectedTradeForCascade.entryPrice).toFixed(4)} → {parseFloat(selectedTradeForCascade.exitPrice).toFixed(4)}
                    </div>
                 </div>
                 <div className="space-y-1">
                    <span className="text-slate-500 block">الربح الصافي / النسبة:</span>
                    <div className={`font-mono font-black ${selectedTradeForCascade.pnl > 0 ? 'text-emerald-400' : selectedTradeForCascade.pnl === 0 ? 'text-slate-300' : 'text-rose-400'}`} dir="ltr">
                       {selectedTradeForCascade.pnl > 0 ? '+' : ''}${selectedTradeForCascade.pnl?.toFixed(2)} ({selectedTradeForCascade.pnlPerc?.toFixed(2)}%)
                    </div>
                 </div>
                 <div className="space-y-1">
                    <span className="text-slate-500 block">آلية الخروج النهائية:</span>
                    <div className="font-semibold text-amber-400 truncate" title={selectedTradeForCascade.exitReason}>
                       {selectedTradeForCascade.exitReason || "غير محدد"}
                    </div>
                 </div>
              </div>

              {/* Body Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-900" dir="rtl">
                 {!selectedTradeForCascade.adaptiveHistoryLogs || selectedTradeForCascade.adaptiveHistoryLogs.length === 0 ? (
                    <div className="py-12 text-center space-y-3">
                       <ShieldCheck className="w-12 h-12 text-slate-600 mx-auto" />
                       <h4 className="text-slate-400 font-bold">لا يوجد سجل تاريخي لكاسكيد لهذه الصفقة</h4>
                       <p className="text-slate-500 text-xs max-w-sm mx-auto leading-relaxed">تم إغلاق الصفقة سريعاً أو لم يتثنى للمحرك تسجيل فحوصات تشخيصية ضمن دورتها الحالية.</p>
                    </div>
                 ) : (
                    <div className="relative border-r border-slate-750 pr-4 mr-2 space-y-6 text-right">
                       {selectedTradeForCascade.adaptiveHistoryLogs.slice().reverse().map((log: any, idx: number) => {
                          const isContinue = log.decision === 'CONTINUE' || log.decision?.includes('STAY');
                          const isTrail = log.decision === 'SL_TRAIL' || log.decision?.includes('TRAIL');
                          const isExit = log.decision === 'EXIT_NOW' || log.decision?.includes('EXIT');

                          return (
                             <div key={log.id || idx} className="relative group">
                                {/* Circle node on timeline */}
                                <span className={`absolute -right-[21.5px] top-1.5 w-3 h-3 rounded-full border-2 ${
                                   isContinue ? 'bg-emerald-500 border-slate-900 ring-4 ring-emerald-500/10' :
                                   isTrail ? 'bg-amber-500 border-slate-900 ring-4 ring-amber-500/10' :
                                   'bg-rose-500 border-slate-900 ring-4 ring-rose-500/10'
                                }`}></span>

                                {/* Card */}
                                <div className="bg-slate-800/45 border border-slate-700/40 rounded-xl p-4 space-y-3 hover:border-slate-600/60 transition-all text-right">
                                   <div className="flex flex-wrap justify-between items-center gap-2 border-b border-slate-750/50 pb-2">
                                      <div className="flex items-center gap-2">
                                         <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                                            isContinue ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                            isTrail ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse' :
                                            'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                         }`}>
                                            {log.decision === 'CONTINUE' && 'استمرار بالصفقة 💎'}
                                            {log.decision === 'SL_TRAIL' && 'تأمين وزحف الوقف 🛡️'}
                                            {log.decision === 'EXIT_NOW' && 'خروج فوري وتصفية 🚨'}
                                            {!['CONTINUE', 'SL_TRAIL', 'EXIT_NOW'].includes(log.decision || '') && log.decision}
                                         </span>

                                         <span className="text-[10px] bg-slate-900 text-slate-400 px-2 py-0.5 rounded font-mono">
                                            قيمة الكاسكيد: {log.score ?? 0}/5
                                         </span>
                                      </div>
                                      
                                      <span className="text-[11px] text-slate-500 font-mono" dir="ltr">
                                         {new Date(log.time).toLocaleTimeString('ar-SA')} - {new Date(log.time).toLocaleDateString('ar-SA')}
                                      </span>
                                   </div>

                                   {/* Reason / Narrative */}
                                   <div className="text-xs text-slate-300 leading-relaxed font-sans text-right">
                                      <span className="text-slate-500 block text-[10px] mb-0.5 font-bold uppercase">السبب والتحليل المبرر للقرار:</span>
                                      <div className="bg-slate-900/40 p-2.5 rounded-lg border border-slate-800 text-slate-300 font-bold leading-normal">
                                         {log.reason || "لا يوجد توصيف متاح."}
                                      </div>
                                   </div>

                                   {/* Indicators Grid */}
                                   <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-slate-750/30 font-mono text-[10px] text-right" dir="rtl">
                                      <div className="p-2 bg-slate-950/20 rounded border border-slate-800 space-y-0.5">
                                         <span className="text-slate-500 text-[9px] block">السيولة (Open Interest)</span>
                                         <div className="flex items-center gap-1.5 justify-start text-xs font-bold text-slate-200" dir="ltr">
                                            <span>{log.metrics?.openInterest ? log.metrics.openInterest.toLocaleString() : 'N/A'}</span>
                                            {log.metrics?.oiTrend === 'UP' && <span className="text-emerald-400 font-bold">▲ UP</span>}
                                            {log.metrics?.oiTrend === 'DOWN' && <span className="text-rose-400 font-bold">▼ DOWN</span>}
                                            {log.metrics?.oiTrend === 'FLAT' && <span className="text-slate-400">■ FLAT</span>}
                                         </div>
                                      </div>

                                      <div className="p-2 bg-slate-950/20 rounded border border-slate-800 space-y-0.5">
                                         <span className="text-slate-500 text-[9px] block">قوة المشترين (Taker)</span>
                                         <div className="flex items-center gap-1.5 justify-start text-xs font-bold text-slate-200" dir="ltr">
                                            <span>{log.metrics?.takerRatio ? log.metrics.takerRatio.toFixed(3) : '1.0'}</span>
                                            {log.metrics?.takerTrend === 'BULLISH' && <span className="text-emerald-400 font-bold">📈 BUY</span>}
                                            {log.metrics?.takerTrend === 'BEARISH' && <span className="text-rose-400 font-bold">📉 SELL</span>}
                                            {log.metrics?.takerTrend === 'NEUTRAL' && <span className="text-slate-400">■ NEUT</span>}
                                         </div>
                                      </div>

                                      <div className="p-2 bg-slate-950/20 rounded border border-slate-800 space-y-0.5">
                                         <span className="text-slate-500 text-[9px] block">رسوم التمويل (Funding)</span>
                                         <div className="flex items-center gap-1.5 justify-start text-xs font-bold text-slate-200" dir="ltr">
                                            <span className={log.metrics?.fundingRate > 0 ? "text-rose-400" : log.metrics?.fundingRate < 0 ? "text-emerald-400" : "text-slate-300"}>
                                               {log.metrics?.fundingRate !== undefined ? `${(log.metrics.fundingRate * 100).toFixed(4)}%` : '0.0000%'}
                                            </span>
                                         </div>
                                      </div>

                                      <div className="p-2 bg-slate-950/20 rounded border border-slate-800 space-y-0.5">
                                         <span className="text-slate-500 text-[9px] block">مؤشر القوة (RSI) / السعر</span>
                                         <div className="flex items-center gap-1.5 justify-start text-[11px] font-bold text-slate-200" dir="ltr">
                                            <span>RSI: {log.metrics?.rsi ? log.metrics.rsi.toFixed(1) : '50.0'}</span>
                                            <span className="text-slate-500">|</span>
                                            <span>${log.currentPrice ? log.currentPrice.toFixed(4) : log.entryPrice ? log.entryPrice.toFixed(4) : 'N/A'}</span>
                                         </div>
                                      </div>
                                   </div>
                                </div>
                             </div>
                          );
                       })}
                    </div>
                 )}
              </div>
           </div>
        </div>
      )}
    </div>
  );
}

function CheckBadge({ active, label }: { active: boolean, label: string }) {
  return (
    <div title={label} className={`w-8 h-6 rounded flex items-center justify-center text-[10px] font-bold ${active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/50 text-slate-500'}`}>
      {label}
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-3 px-3 py-3 rounded-lg transition-all ${active ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'} w-full text-right`}>
      <div className={`flex-shrink-0 ${active ? 'text-emerald-400' : 'text-slate-500'}`}>{icon}</div>
      <span className="font-semibold text-sm hidden md:block">{label}</span>
    </button>
  );
}

function IntelligenceLayer({ label, value, sub, color, enabled = true }: { label: string, value: string, sub: string, color: string, enabled?: boolean }) {
  return (
    <div className={`border rounded-lg p-3 transition-all ${enabled ? 'bg-slate-950/50 border-slate-800 hover:border-slate-700' : 'bg-slate-900/20 border-slate-900 opacity-30 shadow-none'}`}>
       <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{label}</span>
          {!enabled && <div className="text-[8px] bg-slate-800 px-1 rounded text-slate-600 font-mono">DISABLED</div>}
       </div>
       <div className={`text-sm font-bold mt-1 ${color}`}>{value}</div>
       <div className="text-[9px] text-slate-600 mt-0.5 font-medium">{sub}</div>
    </div>
  );
}

function StatCard({ title, value, trend, positive }: { title: string, value: string, trend?: string, positive?: boolean }) {
  return (
    <div className="p-5 rounded-xl bg-gradient-to-b from-slate-800/80 to-slate-800 border border-slate-700/50 flex flex-col gap-2 relative overflow-hidden">
        <h3 className="text-slate-400 text-sm font-medium">{title}</h3>
        <p className="text-2xl font-bold font-mono">{value}</p>
        {trend && (
             <span className={`text-xs font-medium px-2 py-0.5 rounded-full w-fit ${positive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-500/10 text-slate-400'}`}>
                 {trend}
             </span>
        )}
    </div>
  );
}

// Helper: Sortable Header Component in Arabic
function SortableHeader({ 
  label, 
  field, 
  sortField, 
  sortDir, 
  onSort 
}: { 
  label: string, 
  field: string, 
  sortField: string, 
  sortDir: 'asc' | 'desc', 
  onSort: (field: string) => void 
}) {
  const isSorted = sortField === field;
  return (
    <th 
      onClick={() => onSort(field)} 
      className="px-5 py-3 cursor-pointer hover:bg-slate-700/30 text-right select-none transition-colors"
    >
      <div className="flex items-center gap-1.5 justify-start">
        <span className="font-semibold text-slate-300">{label}</span>
        <span className="text-[10px] text-emerald-400 font-mono">
          {isSorted ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </div>
    </th>
  );
}

// Helper: Arabic pagination controls
function TablePagination({ 
  currentPage, 
  totalPages, 
  onPageChange 
}: { 
  currentPage: number, 
  totalPages: number, 
  onPageChange: (page: number) => void 
}) {
  return (
    <div className="flex justify-between items-center px-5 py-3 bg-slate-800/25 border-t border-slate-750 text-xs">
      <span className="text-slate-400 font-medium select-none">الصفحة <span className="text-emerald-400 font-mono">{currentPage}</span> من <span className="font-mono">{totalPages}</span></span>
      <div className="flex gap-1.5">
        <button
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="px-3 py-1.5 rounded bg-slate-800 border border-slate-700 hover:border-slate-500 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 disabled:hover:border-slate-700 font-medium text-slate-300 transition-all select-none cursor-pointer disabled:cursor-not-allowed"
        >
          السابق
        </button>
        <button
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="px-3 py-1.5 rounded bg-slate-800 border border-slate-700 hover:border-slate-500 hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-slate-800 disabled:hover:border-slate-700 font-medium text-slate-300 transition-all select-none cursor-pointer disabled:cursor-not-allowed"
        >
          التالي
        </button>
      </div>
    </div>
  );
}
