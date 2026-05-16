import React, { useState, useEffect } from 'react';
import { Target, Activity, Settings, BarChart2, ShieldCheck, Power, RefreshCw, TrendingUp, TrendingDown, Play, Square, Sliders, Zap } from 'lucide-react';
import { SettingsView } from './components/SettingsView';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [settingsTab, setSettingsTab] = useState('risk');
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [activeTrades, setActiveTrades] = useState<any[]>([]);
  const [historyTrades, setHistoryTrades] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalPnl: 0, winRate: 0, openCount: 0, totalTrades: 0 });
  const [marketContext, setMarketContext] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [panicActive, setPanicActive] = useState(false);
  const [botActive, setBotActive] = useState(false);
  const [isInverse, setIsInverse] = useState(false);
  const [loading, setLoading] = useState(false);
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
      const [wlRes, activeRes, histRes, statsRes, statusRes, contextRes, logsRes] = await Promise.all([
        fetch('/api/scanner/watchlist'),
        fetch('/api/trades/active'),
        fetch('/api/trades/history'),
        fetch('/api/stats'),
        fetch('/api/bot/status'),
        fetch('/api/market/context'),
        fetch('/api/system/logs')
      ]);
      setWatchlist(await wlRes.json());
      setActiveTrades(await activeRes.json());
      setHistoryTrades(await histRes.json());
      setStats(await statsRes.json());
      const statusData = await statusRes.json();
      setBotActive(statusData.active);
      setMarketContext(await contextRes.json());
      setLogs(await logsRes.json());
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
    
    // Calculate display values for the visible history slice for table consistency
    const displayHistory = historyTrades.map(t => ({
      ...t,
      displayPnL: getDisplayPnL(t.pnl || 0, t.amount || 0)
    }));

    // For the total PnL in the header, we estimate based on the total stats from server
    // Since we don't have individual fee data for ALL historical trades in the DB,
    // we use an average fee estimation: TotalFees = TotalTrades * AvgAmount * FeeRate
    const feeRate = settings.tradingFeeRate || 0.001;
    const avgAmount = stats.totalTrades > 0 ? (historyTrades.reduce((acc, t) => acc + (t.amount || 0), 0) / (historyTrades.length || 1)) : 0;
    const estimatedTotalFees = stats.totalTrades * avgAmount * feeRate;
    
    // Inverse Total PnL = - (Gross Total PnL) - Total Fees
    // Gross Total PnL = stats.totalPnl + estimatedTotalFees
    // Inverse Total PnL = - (stats.totalPnl + estimatedTotalFees) - estimatedTotalFees = -stats.totalPnl - 2*estimatedTotalFees
    const totalPnl = -stats.totalPnl - (2 * estimatedTotalFees);
    
    // Win rate estimation for inverse
    const wins = displayHistory.filter(t => t.displayPnL > 0).length;
    const winRate = historyTrades.length > 0 ? (wins / historyTrades.length) * 100 : (100 - stats.winRate);

    return {
      ...stats,
      totalPnl,
      winRate
    };
  })();

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
                     <thead className="bg-slate-800/30 text-slate-400">
                      <tr>
                        <th className="px-5 py-3 font-medium">العملة</th>
                        <th className="px-5 py-3 font-medium">التقييم</th>
                        <th className="px-5 py-3 font-medium">الاتجاه</th>
                        <th className="px-5 py-3 font-medium">RVOL</th>
                        <th className="px-5 py-3 font-medium">التذبذب</th>
                        <th className="px-5 py-3 font-medium">حالة الفحوصات</th>
                        <th className="px-5 py-3 font-medium">محرك القرار (7-Layers)</th>
                      </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-700/50">
                        {watchlist.length === 0 && !loading && (
                           <tr>
                             <td colSpan={6} className="py-8 text-center text-slate-500">جاري مسح الأسواق أو لا توجد عملات استوفت الشروط...</td>
                           </tr>
                        )}
                        {watchlist.map((coin, i) => (
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
                              <td className="px-5 py-4">
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
                                         <div className="text-[9px] text-rose-400 font-bold italic">
                                            {isInverse ? '⚠️ تقييم غير مكتمل (معكوس)' : '⚠️ تقييم غير مكتمل'}
                                         </div>
                                      )}
                                      <div className="text-[10px] text-emerald-400/80 font-medium">
                                         {coin.decision.regime}
                                      </div>
                                      <div className="text-[9px] text-slate-500 truncate max-w-[120px]" title={coin.decision.reason}>
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
                 <div className="p-4 h-48 overflow-y-auto font-mono text-[11px] space-y-1 bg-black/20">
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
                  <table className="w-full text-right text-sm text-slate-300">
                     <thead className="bg-slate-800/30 text-slate-400">
                      <tr>
                        <th className="px-5 py-3 font-medium">العملة</th>
                        <th className="px-5 py-3 font-medium">الآلية</th>
                        <th className="px-5 py-3 font-medium">النوع</th>
                        <th className="px-5 py-3 font-medium">الرافعة</th>
                        <th className="px-5 py-3 font-medium">الدخول</th>
                        <th className="px-5 py-3 font-medium">الخروج</th>
                        <th className="px-5 py-3 font-medium">PnL %</th>
                        <th className="px-5 py-3 font-medium">الربح ($)</th>
                        <th className="px-5 py-3 font-medium">الحالة</th>
                      </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-700/50">
                        {historyTrades.length === 0 ? (
                           <tr>
                             <td colSpan={9} className="py-8 text-center text-slate-500">لم يتم إغلاق أي صفقة بعد.</td>
                           </tr>
                        ) : historyTrades.map((t, i) => (
                           <tr key={i} className="hover:bg-slate-700/20">
                              <td className="px-5 py-4 font-bold font-mono text-slate-100">{t.symbol}</td>
                              <td className="px-5 py-4">
                                 {t.source === 'AGGRESSIVE_INCOMPLETE' || t.source === 'DIRECT_ENTRY' ? (
                                    <div className="flex flex-col gap-1">
                                       <span className="flex items-center gap-1 text-[10px] bg-rose-500/10 text-rose-400 px-2 py-1 rounded border border-rose-500/20 whitespace-nowrap font-bold">
                                          <Zap className="w-3 h-3 fill-current" />
                                          هجومي 🔥
                                       </span>
                                    </div>
                                 ) : (
                                    <span className="flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded border border-emerald-500/20 whitespace-nowrap font-medium">
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
                           </tr>
                        ))}
                     </tbody>
                  </table>
                </div>
             </div>
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
