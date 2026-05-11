import React, { useState, useEffect } from 'react';
import { Target, Activity, Settings, BarChart2, ShieldCheck, Power, RefreshCw, TrendingUp, TrendingDown, Play, Square } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [activeTrades, setActiveTrades] = useState<any[]>([]);
  const [historyTrades, setHistoryTrades] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalPnl: 0, winRate: 0, openCount: 0, totalTrades: 0 });
  const [botActive, setBotActive] = useState(false);
  const [recentAnalyses, setRecentAnalyses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState({ portfolioSize: 1000, riskPerTradePerc: 1, maxConcurrentTrades: 3 });
  const [savingSettings, setSavingSettings] = useState(false);

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
      const [wlRes, activeRes, histRes, statsRes, statusRes, analysesRes] = await Promise.all([
        fetch('/api/scanner/watchlist'),
        fetch('/api/trades/active'),
        fetch('/api/trades/history'),
        fetch('/api/stats'),
        fetch('/api/bot/status'),
        fetch('/api/bot/analyses')
      ]);
      const wlData = await wlRes.json();
      setWatchlist(wlData.coins || []);
      setActiveTrades(await activeRes.json());
      setHistoryTrades(await histRes.json());
      setStats(await statsRes.json());
      const statusData = await statusRes.json();
      setBotActive(statusData.active);
      setRecentAnalyses(await analysesRes.json());
    } catch(e) { }
  }

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

              {/* NEW: Live Radar & Watchlist Section */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column: Analyses Radar */}
                  <div className="lg:col-span-1 rounded-xl bg-slate-800/80 border border-slate-700/50 flex flex-col h-[500px]">
                    <div className="p-4 border-b border-slate-700/50 flex items-center justify-between bg-black/20">
                      <h3 className="text-sm font-bold flex items-center gap-2 text-emerald-400">
                        <Activity className="w-4 h-4" />
                        رادار الفحص الحي (Live Radar)
                      </h3>
                      <span className="text-[10px] text-slate-500 font-mono text-left">Real-time</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                      {recentAnalyses.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-600 text-xs text-center p-8">
                          بانتظار دورة الفحص القادمة...
                        </div>
                      ) : recentAnalyses.map((item, id) => (
                        <div key={id} className={`p-2 rounded border border-transparent hover:border-slate-700 transition-colors flex items-center justify-between gap-3 ${item.reason === 'ENTRY_EXECUTED' ? 'bg-emerald-500/10' : 'bg-slate-900/40'}`}>
                           <div className="flex items-center gap-2">
                             <div className={`w-1.5 h-1.5 rounded-full ${item.reason === 'ENTRY_EXECUTED' ? 'bg-emerald-500 animate-ping' : 'bg-slate-700'}`}></div>
                             <span className="font-mono text-xs font-bold text-white leading-none">{item.symbol}</span>
                             {item.type !== 'NEUTRAL' && (
                               <span className={`text-[8px] font-black px-1 rounded ${item.type === 'LONG' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'}`}>
                                 {item.type}
                               </span>
                             )}
                           </div>
                           <div className="flex-1 text-right overflow-hidden">
                             <span className={`text-[10px] truncate block ${item.reason === 'ENTRY_EXECUTED' ? 'text-emerald-400 font-bold' : 'text-slate-500'}`}>
                               {item.reason}
                             </span>
                           </div>
                           <div className="text-[9px] font-mono text-slate-600">
                              {new Date(item.time).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                           </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right Column: Watchlist */}
                  <div className="lg:col-span-2 rounded-xl bg-slate-800/80 border border-slate-700/50 overflow-hidden">
                    <div className="p-4 border-b border-slate-700/50 flex justify-between items-center bg-black/20">
                      <h3 className="text-sm font-bold flex items-center gap-2 text-emerald-400">
                        <Target className="w-4 h-4" />
                        المرشحين الأعلى تقييماً (Watchlist)
                      </h3>
                      <button onClick={manualRefreshScanner} disabled={loading} className="p-1 px-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors flex items-center gap-2 text-[10px] font-medium font-mono text-left">
                        REFRESH
                      </button>
                    </div>
                    
                    <div className="overflow-x-auto h-[444px]">
                      <table className="w-full text-right text-xs">
                         <thead className="bg-slate-900/50 text-slate-500 sticky top-0 uppercase tracking-wider font-bold">
                          <tr>
                            <th className="px-5 py-3 border-b border-slate-700/50">العملة</th>
                            <th className="px-5 py-3 border-b border-slate-700/50">التقييم</th>
                            <th className="px-5 py-3 border-b border-slate-700/50">الاتجاه</th>
                            <th className="px-5 py-3 border-b border-slate-700/50">RVOL</th>
                            <th className="px-5 py-3 border-b border-slate-700/50">الفحص</th>
                          </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-700/30">
                            {watchlist.map((coin, i) => (
                               <tr key={i} className="hover:bg-slate-700/20 transition-colors border-b border-slate-700/10">
                                  <td className="px-5 py-3 font-bold font-mono text-white text-sm">{coin.symbol}</td>
                                  <td className="px-5 py-3">
                                    <span className={`px-2 py-0.5 rounded inline-flex items-center gap-1 font-bold ${coin.score >= 5 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-500'}`}>
                                      {coin.score}/5
                                    </span>
                                  </td>
                                  <td className="px-5 py-3 font-bold truncate">
                                    <span className={`flex items-center gap-1 ${coin.trend === 'LONG' ? 'text-emerald-400' : coin.trend === 'SHORT' ? 'text-rose-400' : 'text-slate-500'}`}>
                                      {coin.trend === 'LONG' ? <TrendingUp className="w-3 h-3"/> : coin.trend === 'SHORT' ? <TrendingDown className="w-3 h-3" /> : null}
                                      {coin.trend}
                                    </span>
                                  </td>
                                  <td className="px-5 py-3 font-mono text-slate-300 font-bold">{coin.rvol.toFixed(2)}x</td>
                                  <td className="px-5 py-3">
                                    <div className="flex gap-1">
                                      <CheckBadge active={coin.checks.oiPass} label="OI" />
                                      <CheckBadge active={coin.checks.rvolPass} label="RV" />
                                      <CheckBadge active={coin.checks.spreadPass} label="SP" />
                                    </div>
                                  </td>
                               </tr>
                            ))}
                         </tbody>
                      </table>
                    </div>
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
                          <label className="flex items-start gap-4 cursor-pointer p-4 bg-black/40 border-2 border-rose-600 hover:border-rose-400 transition-all rounded-lg group animate-pulse mb-6">
                            <div className="relative flex items-start pt-1">
                               <input 
                                 type="checkbox"
                                 checked={(settings as any).isNightmareMode || false}
                                 onChange={e => setSettings({...settings, isNightmareMode: e.target.checked} as any)}
                                 className="w-6 h-6 accent-rose-600 bg-slate-900 border-rose-700 rounded cursor-pointer"
                               />
                            </div>
                            <div>
                               <span className="block text-rose-500 font-black text-lg mb-1 group-hover:text-rose-400 transition-colors">🩸 وضع الكابوس الـ4.2 (Nightmare Mode)</span>
                               <span className="text-xs text-rose-200/70 block leading-relaxed">
                                  <b>تحذير:</b> هذا الوضع يلغي جميع ضوابط الأمان العادية لتحقيق أقصى ربحية هجومية.
                               </span>
                            </div>
                          </label>

                         
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
                               onChange={e => setSettings({...settings, smartTimeDecayMinutes: parseInt(e.target.value)} as any)} />
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
