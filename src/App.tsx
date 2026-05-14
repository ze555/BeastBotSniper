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
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState({ 
    portfolioSize: 2000, 
    riskPerTradePerc: 1, 
    maxConcurrentTrades: 10,
    dynamicSafetyExit: true,
    fastExitEnabled: true,
    fastExitPerc: 0.5
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
            <NavItem icon={<Activity />} label="سجل محرك الانتظار" active={activeTab === 'wait_engine'} onClick={() => setActiveTab('wait_engine')} />
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
                                           {coin.decision.action === 'ATTACK' ? (coin.decision.confidence < 0.6 ? '🔥 الهجوم' : '🎯 قناص') : coin.decision.action === 'SLEEP' ? '😴 خمول' : '⏳ انتظار'}
                                         </span>
                                         <span className="text-[10px] text-slate-400 font-mono">{(coin.decision.confidence * 100).toFixed(0)}%</span>
                                      </div>
                                      {coin.decision.confidence < 0.6 && coin.decision.action === 'ATTACK' && (
                                         <div className="text-[9px] text-rose-400 font-bold italic">
                                            ⚠️ تقييم غير مكتمل
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
                             <td colSpan={8} className="py-8 text-center text-slate-500">لم يتم إغلاق أي صفقة بعد.</td>
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
                                       <span className="text-[9px] text-rose-400/60 italic font-medium">تقييم غير مكتمل</span>
                                    </div>
                                 ) : (
                                    <span className="flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded border border-emerald-500/20 whitespace-nowrap font-bold">
                                       <ShieldCheck className="w-3 h-3" />
                                       قناص 🎯
                                    </span>
                                 )}
                              </td>
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

          {activeTab === 'wait_engine' && (
             <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 overflow-hidden">
                <div className="p-5 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/80">
                  <div className="flex flex-col">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <Activity className="w-5 h-5 text-amber-400" />
                      سجل صفقات محرك الانتظار (Wait Engine - Closed Only)
                    </h3>
                    <p className="text-[10px] text-slate-500 mt-1">حصرياً للصفقات التي تم الانتظار لها حتى اكتمال شروط القناص.</p>
                  </div>
                  <div className="text-xs text-slate-400 font-mono italic bg-slate-900 px-3 py-1 rounded border border-slate-700/50">FILTER: SOURCE_WAIT_ENGINE</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm text-slate-300">
                     <thead className="bg-slate-800/30 text-slate-400">
                      <tr>
                        <th className="px-5 py-3 font-medium">وقت الإغلاق</th>
                        <th className="px-5 py-3 font-medium">العملة</th>
                        <th className="px-5 py-3 font-medium">الكمية ($)</th>
                        <th className="px-5 py-3 font-medium">سعر الدخول</th>
                        <th className="px-5 py-3 font-medium">سعر الخروج</th>
                        <th className="px-5 py-3 font-medium">نسبة الربح</th>
                        <th className="px-5 py-3 font-medium">صافي الربح</th>
                      </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-700/50">
                        {historyTrades.filter(t => (t.source === 'WAIT_ENGINE' || t.source === 'WAIT_ENGINE_PROTECTED' || t.source === 'AGGRESSIVE_INCOMPLETE') && t.status === 'CLOSED').length === 0 ? (
                           <tr>
                             <td colSpan={7} className="py-20 text-center">
                                <div className="flex flex-col items-center gap-4 opacity-20">
                                   <Zap className="w-16 h-16 text-amber-500" />
                                   <div className="space-y-1">
                                      <p className="text-xl font-bold text-slate-400">لا توجد صفقات منفذة حتى الآن</p>
                                      <p className="text-slate-500 text-xs italic">بانتظار محرك الانتظار لاقتناص الفرصة التالية...</p>
                                   </div>
                                </div>
                             </td>
                           </tr>
                        ) : historyTrades.filter(t => (t.source === 'WAIT_ENGINE' || t.source === 'WAIT_ENGINE_PROTECTED' || t.source === 'AGGRESSIVE_INCOMPLETE') && t.status === 'CLOSED').map((t, i) => (
                           <tr key={i} className={`hover:bg-slate-700/20 border-r-2 transition-all group ${t.source === 'AGGRESSIVE_INCOMPLETE' ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30'}`}>
                              <td className="px-5 py-4 font-mono text-slate-400 text-xs text-right">
                                 {t.exitTime ? new Date(t.exitTime).toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '...'}
                              </td>
                              <td className="px-5 py-4 font-bold font-mono text-base text-right">
                                 <div className="flex items-center gap-2 justify-end">
                                    <span className={t.source === 'AGGRESSIVE_INCOMPLETE' ? 'text-amber-400' : 'text-emerald-400'}>{t.symbol}</span>
                                    {t.source === 'AGGRESSIVE_INCOMPLETE' ? <Zap className="w-4 h-4 text-amber-500" /> : <ShieldCheck className="w-4 h-4 text-emerald-500" />}
                                 </div>
                                 {t.source === 'AGGRESSIVE_INCOMPLETE' && (
                                    <div className="text-[9px] text-amber-500/70 italic mt-0.5">تقييم غير مكتمل ⚠️</div>
                                 )}
                              </td>
                              <td className="px-5 py-4 font-mono text-slate-300">${parseFloat(t.amount || 0).toFixed(2)}</td>
                              <td className="px-5 py-4 font-mono text-slate-400">{parseFloat(t.entryPrice || 0).toFixed(4)}</td>
                              <td className="px-5 py-4 font-mono text-white font-medium">{parseFloat(t.exitPrice || 0).toFixed(4)}</td>
                              <td className={`px-5 py-4 font-mono font-bold text-base ${t.pnlPerc > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {t.pnlPerc > 0 ? '+' : ''}{t.pnlPerc?.toFixed(2)}%
                              </td>
                              <td className={`px-5 py-4 font-mono font-black text-lg ${t.pnl > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                <div className="flex items-center gap-2 justify-end">
                                   <span>{t.pnl > 0 ? '+' : ''}${t.pnl?.toFixed(2)}</span>
                                   {t.pnl > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                                </div>
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
