import React, { useState, useEffect } from 'react';
import { Target, Activity, Settings, BarChart2, ShieldCheck, Power, RefreshCw, TrendingUp, TrendingDown, Play, Square, Sliders, Zap } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [activeTrades, setActiveTrades] = useState<any[]>([]);
  const [historyTrades, setHistoryTrades] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalPnl: 0, winRate: 0, openCount: 0, totalTrades: 0 });
  const [marketContext, setMarketContext] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [panicActive, setPanicActive] = useState(false);
  const [botActive, setBotActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState({ 
    portfolioSize: 1000, 
    riskPerTradePerc: 1, 
    maxConcurrentTrades: 3,
    dynamicSafetyExit: true 
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
            <NavItem icon={<BarChart2 />} label="سجل الصفقات" active={activeTab === 'trades'} onClick={() => setActiveTab('trades')} />
            <NavItem icon={<Sliders />} label="بناء الاستراتيجية" active={activeTab === 'strategy'} onClick={() => setActiveTab('strategy')} />
            <NavItem icon={<Settings />} label="إعدادات المخاطرة" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
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
              <span className="px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-xs font-mono font-medium text-slate-300 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>
                Paper Trading Mode
              </span>
            </div>
          </header>

          {activeTab === 'dashboard' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                   <StatCard title="إجمالي الأرباح" value={`$${stats.totalPnl.toFixed(2)}`} trend="" positive={stats.totalPnl >= 0} />
                   <StatCard title="نسبة الدقة (Win Rate)" value={`${stats.winRate.toFixed(1)}%`} trend={`${stats.totalTrades} صفقات`} />
                   <StatCard title="الصفقات المفتوحة" value={stats.openCount.toString()}  />
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
                          label="حالة السوق العالمية" 
                          value={marketContext?.marketSentiment?.replace('_', ' ') || 'NEUTRAL'} 
                          color={marketContext?.marketSentiment?.includes('GREED') ? 'text-emerald-400' : marketContext?.marketSentiment?.includes('FEAR') ? 'text-rose-400' : 'text-blue-400'} 
                          sub={`Top 20 Sentiment`} 
                       />
                       <IntelligenceLayer 
                          label="ارتباط الثيران" 
                          value={`${((marketContext?.bullishRatio || 0) * 100).toFixed(0)}% Bullish`} 
                          color="text-amber-400" 
                          sub="Global Structure" 
                       />
                       <IntelligenceLayer 
                          label="إجمالي السيولة (24h)" 
                          value={`$${((marketContext?.totalVolume24h || 0) / 1e9).toFixed(1)}B`} 
                          color="text-blue-400" 
                          sub="USDT Pairs Volume" 
                       />
                       <IntelligenceLayer 
                          label="نظام الهجوم" 
                          value={botActive ? "Sniper Precision" : "Standby"} 
                          color="text-emerald-400" 
                          sub={botActive ? "Execution 3/3" : "Awaiting Strategy"} 
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
                                  {t.type === 'LONG' ? <span className="text-emerald-500 text-xs bg-emerald-500/10 px-1 rounded">LONG</span> : <span className="text-rose-500 text-xs bg-rose-500/10 px-1 rounded">SHORT</span>}
                                </h4>
                                <p className="text-xs text-slate-400 mt-1">السعر الحالي: <span className="font-mono text-slate-300">{t.currentPrice ? parseFloat(t.currentPrice as any).toFixed(4) : '...'}</span></p>
                                <p className="text-xs text-slate-400 mt-1">الدخول: <span className="font-mono text-slate-300">{parseFloat(t.entryPrice as any).toFixed(4)}</span></p>
                                <p className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                                  <span>حجم الصفقة: <span className="font-mono text-slate-300">${parseFloat(t.amount as any).toFixed(2)}</span></span>
                                  <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px] font-mono">{(t as any).leverage || 10}x</span>
                                </p>
                                <p className="text-xs text-slate-400 mt-1">القيمة الحالية: <span className="font-mono text-slate-300">${(parseFloat(t.amount as any) + (t.pnl || 0)).toFixed(2)}</span></p>
                             </div>
                             <div className="text-left">
                                <span className={`font-mono font-bold text-lg ${t.pnlPerc >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {t.pnlPerc >= 0 ? '+' : ''}{t.pnlPerc?.toFixed(2)}%
                                </span>
                                <p className={`text-xs font-mono text-right ${t.pnl >= 0 ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
                                  ${t.pnl?.toFixed(2)}
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
                                {coin.trend === 'LONG' ? <TrendingUp className="w-4 h-4 text-emerald-400"/> : coin.trend === 'SHORT' ? <TrendingDown className="w-4 h-4 text-rose-400" /> : '-'}
                                {coin.trend}
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
                                           coin.decision.action === 'ATTACK' ? 'bg-rose-500 text-white animate-pulse' : 
                                           coin.decision.action === 'SLEEP' ? 'bg-slate-700 text-slate-400' : 'bg-blue-500/20 text-blue-400'
                                         }`}>
                                           {coin.decision.action === 'ATTACK' ? '🔥 الهجوم' : coin.decision.action === 'SLEEP' ? '😴 خمول' : '⏳ انتظار'}
                                         </span>
                                         <span className="text-[10px] text-slate-400 font-mono">{(coin.decision.confidence * 100).toFixed(0)}%</span>
                                      </div>
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
                             <td colSpan={7} className="py-8 text-center text-slate-500">لم يتم إغلاق أي صفقة بعد.</td>
                           </tr>
                        ) : historyTrades.map((t, i) => (
                           <tr key={i} className="hover:bg-slate-700/20">
                              <td className="px-5 py-4 font-bold font-mono text-slate-100">{t.symbol}</td>
                              <td className={`px-5 py-4 font-bold text-xs ${t.type === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>{t.type}</td>
                              <td className="px-5 py-4 font-mono text-slate-400 text-sm">{(t as any).leverage || 10}x</td>
                              <td className="px-5 py-4 font-mono">{parseFloat(t.entryPrice).toFixed(4)}</td>
                              <td className="px-5 py-4 font-mono">{parseFloat(t.exitPrice || 0).toFixed(4)}</td>
                              <td className={`px-5 py-4 font-mono font-bold ${t.pnlPerc > 0 ? 'text-emerald-400' : t.pnlPerc === 0 ? 'text-slate-400' : 'text-rose-400'}`}>
                                {t.pnlPerc > 0 ? '+' : ''}{t.pnlPerc?.toFixed(2)}%
                              </td>
                              <td className={`px-5 py-4 font-mono ${t.pnl > 0 ? 'text-emerald-400' : t.pnl === 0 ? 'text-slate-400' : 'text-rose-400'}`}>
                                {t.pnl > 0 ? '+' : ''}${t.pnl?.toFixed(2)}
                              </td>
                              <td className="px-5 py-4">
                                <span className={`px-2 py-1 text-[10px] rounded ${t.pnl > 0 ? 'bg-emerald-500/20 text-emerald-400' : t.isBreakeven || t.pnl === 0 ? 'bg-blue-500/20 text-blue-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                  {t.pnl > 0 ? 'ربح محقق 🎯' : t.isBreakeven || t.pnl === 0 ? 'حماية الدخول 🛡️' : 'خسارة محددة 🛑'}
                                </span>
                              </td>
                           </tr>
                        ))}
                     </tbody>
                  </table>
                </div>
             </div>
          )}

          {activeTab === 'strategy' && (
             <div className="max-w-4xl mx-auto space-y-6">
                {/* Strategy Templates Header */}
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 shadow-xl">
                   <div className="flex items-center gap-3 mb-6">
                      <Zap className="w-6 h-6 text-amber-500" />
                      <h3 className="text-xl font-bold">قوالب الاستراتيجية الجاهزة (Ready-made Templates)</h3>
                   </div>
                   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {STRATEGY_TEMPLATES.map(tpl => (
                         <button 
                            key={tpl.id}
                            type="button"
                            onClick={() => applyTemplate(tpl.settings)}
                            className={`p-4 rounded-xl border transition-all text-right flex flex-col gap-2 hover:scale-[1.02] active:scale-[0.98] ${tpl.color}`}
                         >
                            <div className="flex items-center gap-2 font-bold text-sm">
                               {tpl.icon}
                               {tpl.name}
                            </div>
                            <p className="text-[10px] leading-relaxed opacity-80">{tpl.desc}</p>
                         </button>
                      ))}
                   </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                   {/* Left Col: Main Form */}
                   <div className="lg:col-span-2 rounded-xl bg-slate-800/50 border border-slate-700/50 p-6 md:p-8 shadow-2xl">
                      <div className="flex items-center gap-3 mb-6 pb-6 border-b border-slate-700/50">
                         <Sliders className="w-8 h-8 text-amber-500" />
                         <div>
                           <h3 className="text-xl font-bold">تخصيص محرك الصيد (Custom Strategy)</h3>
                           <p className="text-slate-400 text-sm mt-1">تحديد العتبات الرياضية لمحرك القرار Core Engine</p>
                         </div>
                      </div>

                      <form onSubmit={saveSettings} className="space-y-8">
                         <div className="grid grid-cols-1 gap-6">
                            {/* Trend Filter Toggle */}
                            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-700/50 space-y-4">
                               <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-3">
                                     <div className={`p-2 rounded-lg ${(settings as any).useStrategyTrendFilter ? 'bg-amber-500/20 text-amber-500' : 'bg-slate-800 text-slate-500'}`}>
                                        <TrendingUp className="w-5 h-5" />
                                     </div>
                                     <div>
                                        <h4 className="font-bold text-slate-200">فلتر الاتجاه (Trend Filter)</h4>
                                        <p className="text-[10px] text-slate-500 uppercase font-mono">ADX_VALIDATION_PROTOCOL</p>
                                     </div>
                                  </div>
                                  <button 
                                     type="button"
                                     onClick={() => setSettings({...settings, useStrategyTrendFilter: !(settings as any).useStrategyTrendFilter} as any)}
                                     className={`w-12 h-6 rounded-full transition-all relative ${
                                        (settings as any).useStrategyTrendFilter ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.4)]' : 'bg-slate-700'
                                     }`}
                                  >
                                     <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                                        (settings as any).useStrategyTrendFilter ? 'left-7' : 'left-1'
                                     }`} />
                                  </button>
                               </div>

                               {(settings as any).useStrategyTrendFilter && (
                                  <div className="space-y-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-300">
                                     <div className="flex justify-between items-center">
                                        <label className="text-xs text-slate-400 font-bold">الحد الأدنى لقوة الترند (ADX)</label>
                                        <span className="text-amber-400 font-mono text-sm font-bold">{(settings as any).strategyAdxThreshold ?? 25}</span>
                                     </div>
                                     <input type="range" min="10" max="60" step="1"
                                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                                        value={(settings as any).strategyAdxThreshold ?? 25}
                                        onChange={e => setSettings({...settings, strategyAdxThreshold: parseInt(e.target.value)} as any)}
                                     />
                                     <p className="text-[10px] text-slate-500 italic">* يتجاهل البوت أي عملة لا تمتلك ترند واضح (ADX &gt; عتبة الاختيار).</p>
                                  </div>
                               )}
                            </div>

                            {/* Volatility Rule Toggle */}
                            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-700/50 space-y-4">
                               <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-3">
                                     <div className={`p-2 rounded-lg ${(settings as any).useStrategyVolatilityRule ? 'bg-blue-500/20 text-blue-500' : 'bg-slate-800 text-slate-500'}`}>
                                        <Activity className="w-5 h-5" />
                                     </div>
                                     <div>
                                        <h4 className="font-bold text-slate-200">قاعدة التقلب (Volatility Rule)</h4>
                                        <p className="text-[10px] text-slate-500 uppercase font-mono">ATR_DYNAMIC_PROTECTION</p>
                                     </div>
                                  </div>
                                  <button 
                                     type="button"
                                     onClick={() => setSettings({...settings, useStrategyVolatilityRule: !(settings as any).useStrategyVolatilityRule} as any)}
                                     className={`w-12 h-6 rounded-full transition-all relative ${
                                        (settings as any).useStrategyVolatilityRule ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.4)]' : 'bg-slate-700'
                                     }`}
                                  >
                                     <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                                        (settings as any).useStrategyVolatilityRule ? 'left-7' : 'left-1'
                                     }`} />
                                  </button>
                               </div>

                               {(settings as any).useStrategyVolatilityRule && (
                                  <div className="space-y-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-300">
                                     <div className="flex justify-between items-center">
                                        <label className="text-xs text-slate-400 font-bold">معامل تمدد الوقف (ATR Multiplier)</label>
                                        <span className="text-blue-400 font-mono text-sm font-bold">{(settings as any).strategyAtrMultiplier ?? 1.5}x</span>
                                     </div>
                                     <input type="range" min="1.0" max="5.0" step="0.1"
                                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                        value={(settings as any).strategyAtrMultiplier ?? 1.5}
                                        onChange={e => setSettings({...settings, strategyAtrMultiplier: parseFloat(e.target.value)} as any)}
                                     />
                                     <p className="text-[10px] text-slate-500 italic">* استخدام ATR لوضع وقف خسارة ديناميكي يتنفس مع حركة السوق.</p>
                                  </div>
                               )}
                            </div>

                            {/* Confidence Gate Toggle */}
                            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-700/50 space-y-4">
                               <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-3">
                                     <div className={`p-2 rounded-lg ${(settings as any).useStrategyConfidenceGate ? 'bg-emerald-500/20 text-emerald-500' : 'bg-slate-800 text-slate-500'}`}>
                                        <ShieldCheck className="w-5 h-5" />
                                     </div>
                                     <div>
                                        <h4 className="font-bold text-slate-200">بوابة الثقة (Confidence Gate)</h4>
                                        <p className="text-[10px] text-slate-500 uppercase font-mono">AI_PROBABILITY_FILTER</p>
                                     </div>
                                  </div>
                                  <button 
                                     type="button"
                                     onClick={() => setSettings({...settings, useStrategyConfidenceGate: !(settings as any).useStrategyConfidenceGate} as any)}
                                     className={`w-12 h-6 rounded-full transition-all relative ${
                                        (settings as any).useStrategyConfidenceGate ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'bg-slate-700'
                                     }`}
                                  >
                                     <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                                        (settings as any).useStrategyConfidenceGate ? 'left-7' : 'left-1'
                                     }`} />
                                  </button>
                               </div>

                               {(settings as any).useStrategyConfidenceGate && (
                                  <div className="space-y-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-300">
                                     <div className="flex justify-between items-center">
                                        <label className="text-xs text-slate-400 font-bold">الحد الأدنى لليقين (Confidence)</label>
                                        <span className="text-emerald-400 font-mono text-sm font-bold">{Math.round(((settings as any).strategyMinConfidence ?? 0.6) * 100)}%</span>
                                     </div>
                                     <input type="range" min="0.1" max="1.0" step="0.1"
                                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                        value={(settings as any).strategyMinConfidence ?? 0.6}
                                        onChange={e => setSettings({...settings, strategyMinConfidence: parseFloat(e.target.value)} as any)}
                                     />
                                     <p className="text-[10px] text-slate-500 italic">* تصفية الإشارات بناءً على نسبة نجاحها الإحصائية المتوقعة.</p>
                                  </div>
                               )}
                            </div>

                            {/* Momentum Rule Toggle */}
                            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-700/50 space-y-4">
                               <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-3">
                                     <div className={`p-2 rounded-lg ${(settings as any).useStrategyMomentumRule ? 'bg-purple-500/20 text-purple-500' : 'bg-slate-800 text-slate-500'}`}>
                                        <Zap className="w-5 h-5" />
                                     </div>
                                     <div>
                                        <h4 className="font-bold text-slate-200">قاعدة الزخم (Momentum Rule)</h4>
                                        <p className="text-[10px] text-slate-500 uppercase font-mono">RVOL_VELOCITY_CHECK</p>
                                     </div>
                                  </div>
                                  <button 
                                     type="button"
                                     onClick={() => setSettings({...settings, useStrategyMomentumRule: !(settings as any).useStrategyMomentumRule} as any)}
                                     className={`w-12 h-6 rounded-full transition-all relative ${
                                        (settings as any).useStrategyMomentumRule ? 'bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.4)]' : 'bg-slate-700'
                                     }`}
                                  >
                                     <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                                        (settings as any).useStrategyMomentumRule ? 'left-7' : 'left-1'
                                     }`} />
                                  </button>
                               </div>

                               {(settings as any).useStrategyMomentumRule && (
                                  <div className="space-y-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-300">
                                     <div className="flex justify-between items-center">
                                        <label className="text-xs text-slate-400 font-bold">عتبة الزخم النسبي (RVOL)</label>
                                        <span className="text-purple-400 font-mono text-sm font-bold">{(settings as any).strategyRvolThreshold ?? 1.5}x</span>
                                     </div>
                                     <input type="range" min="1.0" max="10.0" step="0.5"
                                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                                        value={(settings as any).strategyRvolThreshold ?? 1.5}
                                        onChange={e => setSettings({...settings, strategyRvolThreshold: parseFloat(e.target.value)} as any)}
                                     />
                                     <p className="text-[10px] text-slate-500 italic">* لا يدخل البوت إلا إذا كان حجم التداول الحالي أقوى من المتوسط (سيولة انفجارية).</p>
                                  </div>
                               )}
                            </div>
                         </div>

                         <div className="pt-6 border-t border-slate-700/50">
                            <button 
                              type="submit" 
                              className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold rounded-lg transition-all shadow-lg shadow-amber-500/20 active:scale-[0.98] flex items-center justify-center gap-2"
                            >
                              {savingSettings ? <RefreshCw className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                              حقن وتطبيق الاستراتيجية الجديدة
                            </button>
                         </div>
                      </form>
                   </div>

                   {/* Right Col: Analysis & Info */}
                   <div className="space-y-6">
                      <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-6 shadow-xl relative overflow-hidden">
                         <div className="absolute top-0 right-0 p-2 opacity-10">
                            <BarChart2 className="w-16 h-16" />
                         </div>
                         <h4 className="text-sm font-bold text-slate-400 mb-4 flex items-center gap-2 uppercase tracking-wider">
                            تحليل الاستراتيجية المتوقع
                         </h4>
                         
                         <div className="space-y-6">
                            <div>
                               <label className="text-[10px] text-slate-500 font-bold uppercase block mb-1">كثافة التداول المتوقعة</label>
                               <div className={`text-lg font-black ${intensity.color}`}>{intensity.label}</div>
                               <div className="mt-2 h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full transition-all duration-500 ${intensity.color.replace('text', 'bg')}`} 
                                    style={{ width: intensity.label.includes('High') ? '85%' : intensity.label.includes('Very High') ? '100%' : intensity.label.includes('Moderate') ? '50%' : '20%' }}
                                  />
                               </div>
                            </div>

                            <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
                               <div className="text-[10px] text-slate-500 font-bold mb-2 uppercase">ملاحظات المحلل الذكي:</div>
                               <ul className="text-xs text-slate-300 space-y-2">
                                  {(settings as any).strictMode ? (
                                     <li className="flex gap-2">🛡️ <span className="text-emerald-400/80">الوضع الصارم مفعل:</span> سيقوم البوت برفض 90% من الفرص لضمان الجودة.</li>
                                  ) : (
                                     <li className="flex gap-2">🔥 <span className="text-rose-400/80">الوضع الحر مفعل:</span> سيقوم البوت بالهجوم على فرط أكثر جرأة.</li>
                                  )}
                                  {(settings as any).beastMode && (
                                     <li className="flex gap-2">🐺 <span className="text-purple-400/80">وضع الوحش نشط:</span> النظام سيتكيف تلقائياً مع قيعان السيولة.</li>
                                  )}
                                  {!(settings as any).useStrategyTrendFilter && (
                                     <li className="flex gap-2">⚠️ <span className="text-amber-400/80">فلتر الاتجاه معطل:</span> قد تدخل صفقات في أسواق عرضية (Chop).</li>
                                  )}
                               </ul>
                            </div>

                            <div className="text-[10px] text-slate-600 italic text-center">
                               * هذا التحليل تقديري بناءً على البيانات التاريخية لآخر 30 يوم من التقلبات.
                            </div>
                         </div>
                      </div>

                      <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 rounded-xl p-5">
                         <h4 className="text-xs font-bold text-indigo-400 mb-2 flex items-center gap-2">
                            <Activity className="w-4 h-4" />
                            نصائح لزيادة عدد الصفقات
                         </h4>
                         <p className="text-[11px] text-slate-400 leading-relaxed">
                            إذا كنت تجد أن البوت لا يفتح صفقات، جرب الآتي:
                            <br/><br/>
                            1. قلل قيمة <strong className="text-slate-200">ADX Threshold</strong> إلى 15 أو 20.
                            <br/>
                            2. قلل <strong className="text-slate-200">Confidence Gate</strong> إلى 40% أو 50%.
                            <br/>
                            3. عطل <strong className="text-slate-200">Strict Mode</strong> إذا كنت تريد صيداً أوسع.
                            <br/>
                            4. تأكد من أن قيمة <strong className="text-slate-200">Portfolio Size</strong> كافية لفتح الصفقات.
                         </p>
                      </div>
                   </div>
                </div>
             </div>
          )}

          {activeTab === 'settings' && (
             <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-6 md:p-8 max-w-2xl mx-auto">
                <div className="flex items-center gap-3 mb-6 pb-6 border-b border-slate-700/50">
                   <Settings className="w-8 h-8 text-emerald-400" />
                   <div>
                     <h3 className="text-xl font-bold">إعدادات إدارة المخاطر</h3>
                     <p className="text-slate-400 text-sm mt-1">تعديل سلوك البوت وأحجام الدخول</p>
                   </div>
                </div>
                
                <form onSubmit={saveSettings} className="space-y-6">
                   <div>
                     <label className="block text-slate-300 mb-2 font-medium">رأس المال الافتراضي (Portfolio Size $)</label>
                     <input 
                       type="number" 
                       required
                       min="100"
                       className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                       value={settings.portfolioSize}
                       onChange={e => setSettings({...settings, portfolioSize: parseFloat(e.target.value)})}
                     />
                     <p className="text-xs text-slate-500 mt-2">المبلغ الإجمالي للمحفظة لعمل حسبة المخاطرة بناءً عليه.</p>
                   </div>

                   <div>
                     <label className="block text-slate-300 mb-2 font-medium">نسبة المخاطرة لكل صفقة (Risk %)</label>
                     <input 
                       type="number" 
                       required
                       min="0.1"
                       max="5"
                       step="0.1"
                       className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                       value={settings.riskPerTradePerc}
                       onChange={e => setSettings({...settings, riskPerTradePerc: parseFloat(e.target.value)})}
                     />
                     <p className="text-xs text-slate-500 mt-2">يُنصح دائماً بـ 1% لتفادي تصفية المحفظة بسرعة.</p>
                   </div>

                   <div>
                     <label className="block text-slate-300 mb-2 font-medium">أقصى عدد صفقات مفتوحة معاً (Max Concurrent Trades)</label>
                     <input 
                       type="number" 
                       required
                       min="1"
                       max="10"
                       className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                       value={settings.maxConcurrentTrades}
                       onChange={e => setSettings({...settings, maxConcurrentTrades: parseInt(e.target.value)})}
                     />
                     <p className="text-xs text-slate-500 mt-2">كم صفقة مسموح للبوت أن يفتحها في نفس الوقت (مثلاً: 3).</p>
                   </div>

                   <div>
                     <label className="block text-slate-300 mb-2 font-medium">الرافعة المالية (Leverage)</label>
                     <input 
                       type="number" 
                       required
                       min="1"
                       max="125"
                       className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                       value={(settings as any).leverage ?? 10}
                       onChange={e => setSettings({...settings, leverage: parseInt(e.target.value)} as any)}
                     />
                     <p className="text-xs text-slate-500 mt-2">الرافعة المالية المستخدمة في الصفقات (تؤثر على الهامش المطلوب).</p>
                   </div>

                   <div>
                     <label className="flex items-start gap-4 cursor-pointer p-4 bg-slate-900 border border-slate-700 hover:border-slate-600 transition-colors rounded-lg group">
                       <div className="relative flex items-start pt-1">
                          <input 
                            type="checkbox"
                            checked={(settings as any).strictMode || false}
                            onChange={e => setSettings({...settings, strictMode: e.target.checked} as any)}
                            className="w-5 h-5 accent-emerald-500 bg-slate-900 border-slate-700 rounded cursor-pointer"
                          />
                       </div>
                       <div>
                          <span className="block text-slate-200 font-bold mb-1 group-hover:text-emerald-400 transition-colors">خيار صارم (Strict Mode)</span>
                          <span className="text-xs text-slate-400 block leading-relaxed">
                             تفعيل الدخول بصرامة قصوى لضمان أعلى فرصة للربح وتقليل المخاطرة:
                             <ul className="list-disc list-inside mt-2 space-y-1 text-slate-500">
                                <li>تشترط توفر 6/6 شروط استراتيجية كاملة.</li>
                                <li>رفض الصفقات التي وقف الخسارة فيها أكبر من 1.0% بدلاً من 1.5%.</li>
                                <li>عدم تجاوز الشروط السبعة للسيولة والزخم.</li>
                             </ul>
                          </span>
                       </div>
                     </label>
                   </div>

                   <div>
                     <label className="flex items-start gap-4 cursor-pointer p-4 bg-slate-900 border border-slate-700 hover:border-slate-600 transition-colors rounded-lg group">
                       <div className="relative flex items-start pt-1">
                          <input 
                            type="checkbox"
                            checked={(settings as any).useSmartExit || false}
                            onChange={e => setSettings({...settings, useSmartExit: e.target.checked} as any)}
                            className="w-5 h-5 accent-emerald-500 bg-slate-900 border-slate-700 rounded cursor-pointer"
                          />
                       </div>
                       <div>
                          <span className="block text-slate-200 font-bold mb-1 group-hover:text-emerald-400 transition-colors">الخروج الذكي (Smart Exit)</span>
                          <span className="text-xs text-slate-400 block leading-relaxed">
                             يتم مراقبة الصفقات المفتوحة بشكل مستمر واكتشاف أي انعكاس حاد أو فقدان للزخم وإغلاق الصفقة مبكراً لتأمين الربح أو تقليل الخسارة.
                          </span>
                       </div>
                     </label>
                   </div>

                   <div>
                     <label className="flex items-start gap-4 cursor-pointer p-4 bg-slate-900 border border-purple-900/50 hover:border-purple-600 transition-colors rounded-lg group">
                       <div className="relative flex items-start pt-1">
                          <input 
                            type="checkbox"
                            checked={(settings as any).useKineticEngine || false}
                            onChange={e => setSettings({...settings, useKineticEngine: e.target.checked} as any)}
                            className="w-5 h-5 accent-purple-500 bg-slate-900 border-slate-700 rounded cursor-pointer"
                          />
                       </div>
                       <div>
                          <span className="block text-purple-400 font-bold mb-1 group-hover:text-purple-300 transition-colors">نظام الزخم الحركي والظل المطاطي 🚀 (Kinetic Engine)</span>
                          <span className="text-xs text-slate-400 block leading-relaxed">
                             خوارزمية معقدة لادارة الصفقات. <br/>
                             <span className="text-emerald-400">• الملاحقة المطاطية (Elastic Shadow):</span> توسيع وملاحقة متغيرة مع سرعة السوق وتضييقها في الركود.<br/>
                             <span className="text-emerald-400">• الإغلاق التكتيكي الجزئي (Tactical Split):</span> خطف 50% من الربح فوراً في الانطلاقات العنيفة، وترك النصف الآخر يطير بلا مخاطرة.<br/>
                             <span className="text-emerald-400">• مرشح سرعة الهدف (Velocity-Time):</span> التمييز بين الانفجار الذي يستحق المكابرة، وبين الزحف البطيء الذي يستوجب الخروج الكامل.<br/>
                             <span className="text-emerald-400">• قراءة السيولة الحية للمنصة (Live Micro-Structure):</span> التكيف مع التقلبات اللحظية.
                          </span>
                       </div>
                     </label>
                   </div>

                   {/* BEAST MODE UI */}
                   <div>
                     <label className="flex items-start gap-4 cursor-pointer p-5 bg-gradient-to-r from-slate-900 to-rose-950/40 border-2 border-rose-900/50 hover:border-rose-500 transition-all rounded-lg group shadow-[0_0_15px_-3px_rgba(225,29,72,0.1)] hover:shadow-[0_0_20px_-3px_rgba(225,29,72,0.3)]">
                       <div className="relative flex items-start pt-1">
                          <input 
                            type="checkbox"
                            checked={(settings as any).beastMode || false}
                            onChange={e => setSettings({...settings, beastMode: e.target.checked} as any)}
                            className="w-6 h-6 accent-rose-600 bg-slate-900 border-rose-700 rounded cursor-pointer"
                          />
                       </div>
                       <div>
                          <span className="block text-rose-500 font-black text-lg mb-1 group-hover:text-rose-400 transition-colors drop-shadow-md">الوحش المدمّر التكيفي 🐺 (Neural Beast Engine)</span>
                          <span className="text-sm text-rose-200/70 block leading-relaxed font-medium">
                             نظام ذكاء اصطناعي قاسي لا يرحم. يستبدل الشروط الصارمة الجامدة بمنطق متكيف يعمل على توليد الفرص، التعلم من الانزلاقات، واقتناص العملات الميتة!
                             <ul className="list-disc list-inside mt-3 space-y-2 text-rose-300/80">
                                <li><strong className="text-rose-400">تحويل الانزلاق لربح:</strong> لا يهرب من فخاخ الـ Stop-hunts، بل يعكس الصفقة مع صناع السوق فوراً.</li>
                                <li><strong className="text-rose-400">التعلم الذاتي (Auto-Tuning):</strong> يحلل الصفقات الخاسرة فوراً ويعدل مسافة (Breakout/Retest) ديناميكياً.</li>
                                <li><strong className="text-rose-400">صيّاد القيعان (Deep Scavenger):</strong> ينزل للعملات الضعيفة ويبحث عن سيولة مخفية لتوليد فرص من العدم.</li>
                                <li><strong className="text-rose-400">إلغاء مشاعر الخوف:</strong> يزيد المخاطرة تلقائياً (x2) إذا رصد فرصة نسبة نجاحها تفوق 95%.</li>
                             </ul>
                          </span>
                       </div>
                     </label>
                   </div>
                   
                   {(settings as any).beastMode && (
                      <div className="bg-rose-950/20 border border-rose-900/40 p-5 rounded-lg space-y-4 mb-4">
                         <h4 className="text-rose-400 font-bold mb-4 border-b border-rose-900/50 pb-2 flex items-center gap-2">
                            <Activity className="w-5 h-5 animate-pulse" />
                            تخصيص عدوانية الوحش 🩸
                         </h4>
                         
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           <div>
                             <label className="block text-rose-300 text-xs mb-1">سرعة التعلم والتكيف الآلي</label>
                             <input type="range" min="1" max="100"
                               className="w-full accent-rose-500"
                               value={typeof (settings as any).beastLearnRate === 'number' ? (settings as any).beastLearnRate : 50}
                               onChange={e => setSettings({...settings, beastLearnRate: parseInt(e.target.value)} as any)}
                             />
                             <div className="flex justify-between text-[10px] text-rose-400 font-mono mt-1">
                               <span>حذر ومتدرج</span>
                               <span>دفاعي ({ (settings as any).beastLearnRate || 50 }%)</span>
                               <span>شديد العدوانية</span>
                             </div>
                           </div>
                           
                           <label className="flex items-center gap-3 cursor-pointer p-3 bg-black/20 rounded border border-rose-900/30">
                             <input type="checkbox"
                               checked={(settings as any).beastSlippageExploit ?? true}
                               onChange={e => setSettings({...settings, beastSlippageExploit: e.target.checked} as any)}
                               className="w-4 h-4 accent-rose-600"
                             />
                             <div className="flex flex-col">
                               <span className="text-sm font-bold text-rose-300">استغلال الانزلاق والانعكاسات</span>
                               <span className="text-[10px] text-rose-500/80">عند ضرب ستوب لوز بحركة مريبة، يدخل ماركت عكسياً.</span>
                             </div>
                           </label>
                           
                           <label className="flex items-center gap-3 cursor-pointer p-3 bg-black/20 rounded border border-rose-900/30">
                             <input type="checkbox"
                               checked={(settings as any).beastLowCapHunting ?? true}
                               onChange={e => setSettings({...settings, beastLowCapHunting: e.target.checked} as any)}
                               className="w-4 h-4 accent-rose-600"
                             />
                             <div className="flex flex-col">
                               <span className="text-sm font-bold text-rose-300">محرك السكافنجر (Scavenger)</span>
                               <span className="text-[10px] text-rose-500/80">البحث في العملات ذات التصنيف الدنيوي حال غياب الفرص.</span>
                             </div>
                           </label>
                           
                           <label className="flex items-center gap-3 cursor-pointer p-3 bg-black/20 rounded border border-rose-900/30">
                             <input type="checkbox"
                               checked={(settings as any).beastAutoAdapt ?? true}
                               onChange={e => setSettings({...settings, beastAutoAdapt: e.target.checked} as any)}
                               className="w-4 h-4 accent-rose-600"
                             />
                             <div className="flex flex-col">
                               <span className="text-sm font-bold text-rose-300">Overdrive ذكي (Auto-Adapt)</span>
                               <span className="text-[10px] text-rose-500/80">السماح للنظام بتجاوز شروط (الالتزام الصارم) كلياً.</span>
                             </div>
                           </label>
                         </div>
                      </div>
                   )}

                   {(settings as any).useKineticEngine && (
                      <div className="bg-slate-900/50 border border-purple-900/30 p-5 rounded-lg space-y-4">
                         <h4 className="text-purple-400 font-bold mb-4 border-b border-purple-900/50 pb-2">إعدادات نظام الزخم الحركي 🚀</h4>
                         
                         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                           <div>
                             <label className="block text-slate-300 text-xs mb-1">الربح المستهدف المبدئي ($)</label>
                             <input type="number" step="0.1"
                               className="w-full bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                               value={typeof (settings as any).smartTpUsd === 'number' ? (settings as any).smartTpUsd : 1.0}
                               onChange={e => setSettings({...settings, smartTpUsd: parseFloat(e.target.value)} as any)}
                             />
                             <p className="text-[10px] text-purple-400 mt-1">يُتخذ كمرجع لنظام الوحش. (ضع 0 لتعطيل الهدف الثابت والاعتماد كلياً على حركة الزخم)</p>
                           </div>
                           <div>
                             <label className="block text-slate-300 text-xs mb-1">تأمين نقطة الدخول عند ($)</label>
                             <input type="number" step="0.1"
                               className="w-full bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                               value={typeof (settings as any).smartTrailingStartUsd === 'number' ? (settings as any).smartTrailingStartUsd : 0.4}
                               onChange={e => setSettings({...settings, smartTrailingStartUsd: parseFloat(e.target.value)} as any)}
                             />
                             <p className="text-[10px] text-slate-400 mt-1">تفعيل نظام التأمين لتحريك ستوب لوز.</p>
                           </div>
                           <div>
                             <label className="block text-slate-300 text-xs mb-1">زمن القتل الاساسي (دقائق)</label>
                             <input type="number" step="1"
                               className="w-full bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                               value={typeof (settings as any).smartTimeDecayMinutes === 'number' ? (settings as any).smartTimeDecayMinutes : 5}
                               onChange={e => setSettings({...settings, smartTimeDecayMinutes: parseInt(e.target.value)} as any)}
                             />
                             <p className="text-[10px] text-slate-400 mt-1">يتسارع أو يتباطأ ديناميكياً مع حية السوق.</p>
                           </div>
                           <div>
                             <label className="block text-slate-300 text-xs mb-1">مرجع الملاحقة الديناميكية المتغيرة (%)</label>
                             <input type="number" step="0.1"
                               className="w-full bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                               value={typeof (settings as any).smartTrailingThresholdPerc === 'number' ? (settings as any).smartTrailingThresholdPerc : 0.3}
                               onChange={e => setSettings({...settings, smartTrailingThresholdPerc: parseFloat(e.target.value)} as any)}
                             />
                             <p className="text-[10px] text-slate-400 mt-1">مرجع لنسبة التراجع. يتقلص ويتمدد برمجياً.</p>
                           </div>
                           <div>
                             <label className="block text-slate-300 text-xs mb-1">زمن تجمد الزخم (دقائق)</label>
                             <input type="number" step="0.5"
                               className="w-full bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                               value={typeof (settings as any).smartMomentumStallMinutes === 'number' ? (settings as any).smartMomentumStallMinutes : 2.5}
                               onChange={e => setSettings({...settings, smartMomentumStallMinutes: parseFloat(e.target.value)} as any)}
                             />
                             <p className="text-[10px] text-slate-400 mt-1">يُسرع الخروج إذا لم تُسجل قمة جديدة.</p>
                           </div>
                         </div>

                         <div className="mt-4 pt-4 border-t border-purple-900/50">
                           <h5 className="text-purple-300 text-sm font-bold mb-3 flex items-center gap-2">
                             محركات السيولة الحية للمنصة (True Flow)
                           </h5>
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                             <label className="flex items-start gap-3 cursor-pointer p-3 bg-slate-900/80 border border-slate-700 rounded hover:border-purple-500/50 transition-colors">
                               <input 
                                 type="checkbox"
                                 checked={(settings as any).kineticUseOpenInterest || false}
                                 onChange={e => setSettings({...settings, kineticUseOpenInterest: e.target.checked} as any)}
                                 className="w-4 h-4 accent-purple-500 mt-0.5 bg-slate-900 border-slate-700 rounded"
                               />
                               <div>
                                 <span className="block text-slate-200 text-sm mb-1">تتبع الفائدة المفتوحة (Open Interest)</span>
                                 <span className="text-[10px] text-slate-400 block break-words">يتجاوز مقياس الزمن. إذا كانت عقود الاوبن انترست تنخفض بحدة يدل ذلك على خروج صناع السوق، فيقوم النظام بإغلاق الصفقة فورا وانقاذ الربح.</span>
                               </div>
                             </label>

                             <label className="flex items-start gap-3 cursor-pointer p-3 bg-slate-900/80 border border-slate-700 rounded hover:border-purple-500/50 transition-colors">
                               <input 
                                 type="checkbox"
                                 checked={(settings as any).kineticUseVolume || false}
                                 onChange={e => setSettings({...settings, kineticUseVolume: e.target.checked} as any)}
                                 className="w-4 h-4 accent-purple-500 mt-0.5 bg-slate-900 border-slate-700 rounded"
                               />
                               <div>
                                 <span className="block text-slate-200 text-sm mb-1">تتبع تسارع السيولة (Volume Flow)</span>
                                 <span className="text-[10px] text-slate-400 block break-words">يقيس قوة وتدفق الفوليوم الحي. الانفجارات الحقيقية ترفع حواجز الملاحقة للمطالبة بأهداف قوية وتجاهل القتل الزمني.</span>
                               </div>
                             </label>
                           </div>
                         </div>
                      </div>
                   )}

                   {(settings as any).strictMode && (
                      <div className="bg-slate-900/50 border border-emerald-900/30 p-5 rounded-lg space-y-4">
                         <h4 className="text-emerald-400 font-bold mb-4 border-b border-emerald-900/50 pb-2">تفاصيل الفلاتر الصارمة</h4>
                         
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           <div>
                             <label className="block text-slate-300 text-xs mb-1">الحد الأدنى للتقييم (مثال: 6 من 6)</label>
                             <input type="number" min="1" max="6"
                               className="w-full bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                               value={typeof (settings as any).strictMinScore === 'number' ? (settings as any).strictMinScore : 6}
                               onChange={e => setSettings({...settings, strictMinScore: parseInt(e.target.value)} as any)}
                             />
                             <p className="text-[10px] text-slate-400 mt-1 pb-1">الرقم المرتفع (6) يضمن دقة عالية. تقليله (4 أو 5) يزيد الصفقات لكن يقلل الدقة.</p>
                           </div>
                           <div>
                             <label className="block text-slate-300 text-xs mb-1">الحد الأدنى لحجم التداول (فوليوم)</label>
                             <input type="number"
                               className="w-full bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                               value={typeof (settings as any).strictMinVolume === 'number' ? (settings as any).strictMinVolume : 5000000}
                               onChange={e => setSettings({...settings, strictMinVolume: parseFloat(e.target.value)} as any)}
                             />
                             <p className="text-[10px] text-slate-400 mt-1 pb-1">الافتراضي 5M. للبحث عن فرص أكثر في عملات متذبذبة قلله إلى 1M.</p>
                           </div>
                           <div>
                             <label className="block text-slate-300 text-xs mb-1">قوة الزخم (RVOL - الافتراضي 3.0)</label>
                             <input type="number" step="0.1"
                               className="w-full bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                               value={typeof (settings as any).strictMinRvol === 'number' ? (settings as any).strictMinRvol : 3.0}
                               onChange={e => setSettings({...settings, strictMinRvol: parseFloat(e.target.value)} as any)}
                             />
                             <p className="text-[10px] text-slate-400 mt-1 pb-1">السيولة المفاجئة. (1.5) أسرع في الدخول، و(5.0) يبحث عن انفجار سيولة حقيقي.</p>
                           </div>
                           <div>
                             <label className="block text-slate-300 text-xs mb-1">أقصى حد لوقف الخسارة % (الافتراضي 1.0)</label>
                             <input type="number" step="0.1"
                               className="w-full bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                               value={typeof (settings as any).strictMaxRisk === 'number' ? (settings as any).strictMaxRisk : 1.0}
                               onChange={e => setSettings({...settings, strictMaxRisk: parseFloat(e.target.value)} as any)}
                             />
                             <p className="text-[10px] text-slate-400 mt-1 pb-1">قيمة أقل (0.5%) خطورة ان يضرب الستوب بسرعة، الاكبر (2.0%) يترك للسعر مساحة للتذبذب.</p>
                           </div>
                           <div>
                             <label className="block text-slate-300 text-xs mb-1">تأمين الدخول السريع عند ربح % (مثال: 0.75)</label>
                             <input type="number" step="0.05"
                               className="w-full bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                               value={typeof (settings as any).strictFastBreakevenPerc === 'number' ? (settings as any).strictFastBreakevenPerc : 0.75}
                               onChange={e => setSettings({...settings, strictFastBreakevenPerc: parseFloat(e.target.value)} as any)}
                             />
                             <p className="text-[10px] text-slate-400 mt-1 pb-1">يحدد متى يتم نقل الستوب لنقطة الصفر. (0.5%) توفر حماية أسرع من الانعكاسات.</p>
                           </div>
                           <div>
                             <label className="block text-slate-300 text-xs mb-1">الحد الأعلى لمؤشر RSI (مثال: 75)</label>
                             <input type="number" step="1"
                               className="w-full bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                               value={typeof (settings as any).strictRsiHigh === 'number' ? (settings as any).strictRsiHigh : 75}
                               onChange={e => setSettings({...settings, strictRsiHigh: parseInt(e.target.value)} as any)}
                             />
                             <p className="text-[10px] text-slate-400 mt-1 pb-1">يمنع الشراء فوقه. لركوب الموجات الانفجارية الصاعدة الخارقة زده لـ 85.</p>
                           </div>
                           <div>
                             <label className="block text-slate-300 text-xs mb-1">الحد الأدنى لمؤشر RSI (مثال: 25)</label>
                             <input type="number" step="1"
                               className="w-full bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                               value={typeof (settings as any).strictRsiLow === 'number' ? (settings as any).strictRsiLow : 25}
                               onChange={e => setSettings({...settings, strictRsiLow: parseInt(e.target.value)} as any)}
                             />
                             <p className="text-[10px] text-slate-400 mt-1 pb-1">يمنع البيع (Short) تحته. في الانهيارات القوية العنيفة يمكنك تقليله لـ 15.</p>
                           </div>
                           <div>
                             <label className="block text-slate-300 text-xs mb-1">مسافة الاختراق % (Breakout Distance)</label>
                             <input type="number" step="0.1"
                               className="w-full bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                               value={typeof (settings as any).strictBreakoutDistancePerc === 'number' ? (settings as any).strictBreakoutDistancePerc : 0.5}
                               onChange={e => setSettings({...settings, strictBreakoutDistancePerc: parseFloat(e.target.value)} as any)}
                             />
                             <p className="text-[10px] text-slate-400 mt-1 pb-1">المسافة المقبولة مقارنة بأعلى قمة/قاع. لتسريع الصفقات اجعلها أوسع (1.0% أو 1.5%).</p>
                           </div>
                           <div>
                             <label className="block text-slate-300 text-xs mb-1">مسافة إعادة الاختبار % (Retest Pullback)</label>
                             <input type="number" step="0.1"
                               className="w-full bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                               value={typeof (settings as any).strictRetestPullbackPerc === 'number' ? (settings as any).strictRetestPullbackPerc : 3.0}
                               onChange={e => setSettings({...settings, strictRetestPullbackPerc: parseFloat(e.target.value)} as any)}
                             />
                             <p className="text-[10px] text-slate-400 mt-1 pb-1">التراجع المسموح بعد القمة/القاع لتأكيد الدخول. (5.0%) يقبل تذبذب أكبر.</p>
                           </div>
                         </div>

                         <div className="space-y-3 pt-3 border-t border-slate-800">
                           <label className="flex items-center gap-3 cursor-pointer">
                             <input type="checkbox"
                               checked={(settings as any).strictBtcAlignment ?? true}
                               onChange={e => setSettings({...settings, strictBtcAlignment: e.target.checked} as any)}
                               className="w-4 h-4 accent-emerald-500"
                             />
                             <span className="text-sm text-slate-300">موافقة اتجاه البيتكوين (BTC Trend Filter)</span>
                           </label>
                           <label className="flex items-center gap-3 cursor-pointer">
                             <input type="checkbox"
                               checked={(settings as any).strictRsiFilter ?? true}
                               onChange={e => setSettings({...settings, strictRsiFilter: e.target.checked} as any)}
                               className="w-4 h-4 accent-emerald-500"
                             />
                             <span className="text-sm text-slate-300">رفض الشراء من القمة/التشبع (RSI Filter)</span>
                           </label>
                           <label className="flex items-center gap-3 cursor-pointer">
                             <input type="checkbox"
                               checked={(settings as any).strictRetest ?? true}
                               onChange={e => setSettings({...settings, strictRetest: e.target.checked} as any)}
                               className="w-4 h-4 accent-emerald-500"
                             />
                             <span className="text-sm text-slate-300">الدخول بعد إعادة الاختبار (Retest Entry)</span>
                           </label>
                         </div>
                      </div>
                   )}

                   <button 
                     type="submit" 
                     className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-slate-900 font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                   >
                     {savingSettings ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'حفظ التعديلات'}
                   </button>
                   
                   <div className="pt-4 mt-4 border-t border-slate-800">
                     <a 
                       href="/api/export" 
                       download="sniper-bot-export.zip"
                       className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-lg transition-colors flex items-center justify-center gap-2 border border-slate-700 text-sm"
                     >
                       تحميل ملفات المشروع (Download ZIP)
                     </a>
                   </div>
                </form>
             </div>
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

function IntelligenceLayer({ label, value, sub, color }: { label: string, value: string, sub: string, color: string }) {
  return (
    <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-3 hover:border-slate-700 transition-colors">
       <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{label}</span>
       <div className={`text-sm font-bold mt-1 ${color}`}>{value}</div>
       <div className="text-[9px] text-slate-600 mt-0.5">{sub}</div>
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

function TroubleshootRow({ label, passed, failMsg }: { label: string, passed: boolean, failMsg: string }) {
  return (
    <div className="space-y-1">
       <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-300 font-bold">{label}</span>
          {passed ? (
             <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> جَيِّد
             </span>
          ) : (
             <span className="text-[10px] text-rose-400 font-bold flex items-center gap-1">
                <Activity className="w-3 h-3" /> بحاجة تدخل
             </span>
          )}
       </div>
       {!passed && <p className="text-[9px] text-rose-500/80 italic leading-tight">{failMsg}</p>}
    </div>
  );
}
