import React, { useState, useEffect } from 'react';
import { RefreshCw, Activity, Target, TrendingUp, Swords, Play, Square, Terminal, LayoutDashboard, FileText, Settings as SettingsIcon, Save } from 'lucide-react';

export const PredatorDashboard: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [closedTrades, setClosedTrades] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [botActive, setBotActive] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'REPORTS' | 'SETTINGS'>('DASHBOARD');
  
  // Settings state
  const [balanceInput, setBalanceInput] = useState('10000');
  const [maxTradesInput, setMaxTradesInput] = useState('3');
  const [haltProfitEnabled, setHaltProfitEnabled] = useState(false);
  const [haltProfitTarget, setHaltProfitTarget] = useState('500');
  const [haltLossEnabled, setHaltLossEnabled] = useState(false);
  const [haltLossTarget, setHaltLossTarget] = useState('200');
  const [smartBtcHoldEnabled, setSmartBtcHoldEnabled] = useState(true);
  const [btcVolThresholdStr, setBtcVolThresholdStr] = useState('0.80');
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  useEffect(() => {
    fetchData();
    const inv = setInterval(fetchData, 5000);
    return () => clearInterval(inv);
  }, []);

  const safeJson = async (res: Response) => {
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await res.json();
    }
    throw new Error('Response is not JSON');
  };

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const statsRes = await fetch('/api/predator/stats');
      if (statsRes.ok) {
        const data = await safeJson(statsRes);
        setStats(data);
        if (document.activeElement?.tagName !== 'INPUT') {
            setBalanceInput(data.initialBalance?.toString() || '10000');
            setMaxTradesInput(data.maxOpenTrades?.toString() || '3');
            if (data.haltProfitTarget !== undefined) setHaltProfitTarget(data.haltProfitTarget.toString());
            if (data.haltProfitEnabled !== undefined) setHaltProfitEnabled(data.haltProfitEnabled);
            if (data.haltLossTarget !== undefined) setHaltLossTarget(data.haltLossTarget.toString());
            if (data.haltLossEnabled !== undefined) setHaltLossEnabled(data.haltLossEnabled);
            if (data.smartBtcHoldEnabled !== undefined) setSmartBtcHoldEnabled(data.smartBtcHoldEnabled);
            if (data.btcVolThresholdStr !== undefined) setBtcVolThresholdStr(data.btcVolThresholdStr);
        }
      }
      const tradesRes = await fetch('/api/trades/active');
      if ( tradesRes.ok) {
        setTrades(await safeJson(tradesRes));
      }
      const closedTradesRes = await fetch('/api/trades/closed');
      if (closedTradesRes.ok) {
        setClosedTrades(await safeJson(closedTradesRes));
      }
      const botRes = await fetch('/api/bot/status');
      if (botRes.ok) {
        setBotActive((await safeJson(botRes)).active);
      }
      const logsRes = await fetch('/api/system/logs');
      if (logsRes.ok) {
        setLogs(await safeJson(logsRes));
      }
    } catch (e) {
      console.error(e);
    }
    setIsLoading(false);
  };

  const toggleBot = async () => {
     try {
       const res = await fetch('/api/bot/toggle', { method: 'POST' });
       if (res.ok) {
         setBotActive((await safeJson(res)).active);
       }
     } catch (e) {
       console.error(e);
     }
  };

  const saveConfig = async () => {
      setIsSavingConfig(true);
      try {
          await fetch('/api/predator/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  balance: Number(balanceInput),
                  maxTrades: Number(maxTradesInput),
                  haltProfitEnabled,
                  haltProfitTarget: Number(haltProfitTarget),
                  haltLossEnabled,
                  haltLossTarget: Number(haltLossTarget),
                  smartBtcHoldEnabled,
                  btcVolThresholdStr,
              })
          });
          await fetchData();
      } catch (e) {
          console.error(e);
      }
      setIsSavingConfig(false);
  };

  const renderRuleStat = (name: string, stat: any) => {
    if (!stat) return null;
    const total = stat.passed + stat.failed;
    const passPerc = total > 0 ? (stat.passed / total) * 100 : 0;
    
    return (
      <div className="bg-slate-800 p-3 rounded border border-slate-700 flex justify-between items-center mb-2">
        <span className="text-sm font-semibold text-slate-300">{name}</span>
        <div className="flex gap-4 text-xs font-mono">
          <span className="text-emerald-400">Pass: {stat.passed} ({passPerc.toFixed(1)}%)</span>
          <span className="text-rose-400">Fail: {stat.failed}</span>
        </div>
      </div>
    );
  };

  const getPredatorTrades = () => {
    return trades;
  };

  const sovTrades = getPredatorTrades();
  
  // Floating PnL calculation
  let floatingPnLAmount = 0;
  let realizedPnLAmount = 0;
  
  if (stats) {
     // Realized PnL is the difference between current virtual balance and initial balance
     realizedPnLAmount = stats.balance - stats.initialBalance;
     // Floating PnL is the sum of PnL from the remaining active positions
     floatingPnLAmount = sovTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
  }
  const totalPnL = realizedPnLAmount + floatingPnLAmount;

  const formatDuration = (entryTime: string, exitTime?: string) => {
     if (!entryTime) return '-';
     const start = new Date(entryTime).getTime();
     const end = exitTime ? new Date(exitTime).getTime() : Date.now();
     const diffMs = end - start;
     const diffMins = Math.floor(diffMs / 60000);
     if (diffMins < 60) return `${diffMins} دق`;
     const hours = Math.floor(diffMins / 60);
     const mins = diffMins % 60;
     return `${hours} س ${mins} دق`;
  };

  const renderTradesList = (tradesList: any[], isClosed: boolean = false) => (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
         {tradesList.map((t, idx) => (
            <div key={idx} className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden group">
               <div className={`absolute top-0 right-0 w-1 h-full ${t.direction === 'LONG' ? 'bg-emerald-500' : 'bg-rose-500'} opacity-80`} />
               
               <div className="flex justify-between items-start mb-2">
                   <div>
                      <div className="flex items-center gap-2">
                         <span className="text-xl font-black text-white">{t.symbol}</span>
                         <span className={`text-xs px-2 py-0.5 rounded font-bold ${t.direction === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                            {t.direction}
                         </span>
                         <span className="bg-slate-800 text-slate-300 text-[10px] px-2 py-0.5 rounded shadow-sm">{t.grade}</span>
                      </div>
                      <div className="text-xs text-slate-400 mt-2 flex flex-col gap-1.5">
                          <div className="flex gap-4">
                            <span>الدخول: <strong className="text-slate-200">{Number(t.entry).toFixed(4)}</strong></span>
                            {!isClosed && (
                              <span>الوقف: <strong className="text-slate-200">{Number(t.sl).toFixed(4)}</strong></span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-2 text-[10px] sm:text-xs bg-slate-900/50 p-2 rounded border border-slate-800">
                            <span className="cursor-help" title="حجم العقد الإجمالي في السوق (Position Size)">
                               إجمالي العقد: <strong className="text-slate-200">${(t.initialPos * t.entry).toFixed(2)}</strong>
                            </span>
                            <span className="cursor-help" title="الرافعة المالية المستخدمة (Leverage)">
                               الرافعة: <strong className="text-blue-400">10x</strong>
                            </span>
                            <span className="cursor-help" title="الهامش الأصلي المحجوز من الرصيد (Margin)">
                               الهامش: <strong className="text-slate-200">${((t.initialPos * t.entry) / 10).toFixed(2)}</strong>
                            </span>
                            <span className="cursor-help text-rose-400/90" title="كم سيخسر الحساب فعلياً إذا تم ضرب وقف الخسارة">
                               المخاطرة: <strong>${(t.initialPos * Math.abs(t.entry - t.sl)).toFixed(2)}</strong>
                            </span>
                            <span className="text-slate-400">
                               المدة: <strong className="text-slate-200">{formatDuration(t.entryTime, t.exitTime)}</strong>
                            </span>
                          </div>
                          {!isClosed && t.entryTime && (
                           <div className="text-[10px] text-slate-500">
                             فتح: {new Date(t.entryTime).toLocaleTimeString('en-US', {hour12: false, hour: '2-digit', minute: '2-digit'})} 
                           </div>
                          )}
                          {isClosed && t.exitReason && (
                            <div className="text-[10px] text-slate-500 mt-1">
                              إغلاق ({t.exitReason}) {t.exitTime && `- ${new Date(t.exitTime).toLocaleTimeString('en-US', {hour12: false, hour: '2-digit', minute: '2-digit'})}`}
                            </div>
                          )}
                      </div>
                   </div>
                   <div className="text-left" dir="ltr">
                      <div className={`text-xl font-mono font-bold ${(t.profitR || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                         {(t.profitR || 0) >= 0 ? '+' : ''}{(t.profitR || 0).toFixed(2)} R
                      </div>
                      <div className="text-[10px] text-slate-500 mb-1">عائد النقطة: {t.peak_r?.toFixed(2)} R</div>
                      {isClosed && (
                         <div className={`text-sm font-bold ${(t.finalPnl || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {(t.finalPnl || 0) >= 0 ? '+$' : '-$'}{Math.abs(t.finalPnl || 0).toFixed(2)}
                         </div>
                      )}
                      {!isClosed && t.pnl !== undefined && (
                         <div className={`text-sm font-bold ${(t.pnl || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {(t.pnl || 0) >= 0 ? '+$' : '-$'}{Math.abs(t.pnl || 0).toFixed(2)}
                         </div>
                      )}
                      {!isClosed && t.realizedPnl !== undefined && t.realizedPnl !== 0 && (
                         <div className={`text-[10px] mt-1 ${(t.realizedPnl || 0) > 0 ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
                            محقق: {(t.realizedPnl || 0) > 0 ? '+$' : '-$'}{Math.abs(t.realizedPnl || 0).toFixed(2)}
                         </div>
                      )}
                   </div>
               </div>

               {(t.whaleData || t.priceData) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 bg-slate-900/50 p-3 rounded-lg border border-slate-800/50">
                     {t.whaleData && (
                        <div className="space-y-1">
                           <div className="text-[10px] text-blue-400 uppercase tracking-widest mb-2 font-semibold">المؤشرات المؤسساتية</div>
                           <div className="text-[10px] sm:text-[11px] flex justify-between text-slate-300"><span className="text-slate-500 text-[10px] mr-1">السيناريو:</span> <span>{t.whaleData.scenario}</span></div>
                           <div className="text-[10px] sm:text-[11px] flex justify-between text-slate-300"><span className="text-slate-500 text-[10px] mr-1">التمركز:</span> <span>{t.whaleData.institutionalBias}</span></div>
                           <div className="text-[10px] sm:text-[11px] flex justify-between text-slate-300"><span className="text-slate-500 text-[10px] mr-1">نشاط مخفي:</span> <span>{t.whaleData.hiddenBuy}</span></div>
                           <div className="text-[10px] sm:text-[11px] flex justify-between text-slate-300"><span className="text-slate-500 text-[10px] mr-1">التمويل:</span> <span dir="ltr">{t.whaleData.fund}</span></div>
                        </div>
                     )}
                     {t.priceData && (
                        <div className="space-y-1 mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/50">
                           <div className="text-[10px] text-blue-400 uppercase tracking-widest mb-2 font-semibold">بنية السعر الفنية</div>
                           <div className="text-[10px] sm:text-[11px] flex justify-between text-slate-300"><span className="text-slate-500 text-[10px] mr-1">حالة الترند:</span> <span>{t.priceData.marketAlignment}</span></div>
                           <div className="text-[10px] sm:text-[11px] flex justify-between text-slate-300"><span className="text-slate-500 text-[10px] mr-1">RSI:</span> <span>{t.priceData.rsi}</span></div>
                           <div className="text-[10px] sm:text-[11px] flex justify-between text-slate-300"><span className="text-slate-500 text-[10px] mr-1">الزخم:</span> <span>{t.priceData.adx}</span></div>
                           <div className="text-[9px] sm:text-[10px] flex gap-1 mt-2 flex-wrap">
                              <span className={`px-1.5 py-0.5 rounded ${t.a_closed ? 'bg-slate-700 text-slate-300' : 'bg-blue-500/20 text-blue-400 border border-blue-500/20'}`}>TP1 35%</span>
                              <span className={`px-1.5 py-0.5 rounded ${t.b_closed ? 'bg-slate-700 text-slate-300' : 'bg-blue-500/20 text-blue-400 border border-blue-500/20'}`}>TP2 40%</span>
                              <span className={`px-1.5 py-0.5 rounded ${t.c_closed ? 'bg-slate-700 text-slate-300' : 'bg-blue-500/20 text-blue-400 border border-blue-500/20'}`}>TP3 25%</span>
                           </div>
                        </div>
                     )}
                  </div>
               )}
            </div>
         ))}
         {tradesList.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-500 bg-slate-900 border border-dashed border-slate-700 rounded-xl">
               {isClosed ? 'لا توجد صفقات مغلقة حتى الآن.' : 'لا يوجد صفقات نشطة حالياً. يقوم النظام الآن بمسح الأسواق بحثاً عن الفرص.'}
            </div>
         )}
      </div>
  );

  return (
    <div className="space-y-6 mx-auto w-full max-w-5xl animate-in slide-in-from-left-4 duration-300 p-2 sm:p-0">
       <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
         <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2 tracking-tight">
           <Swords className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />
           لوحة تحكم (APEX PREDATOR SYSTEM)
         </h1>
         <div className="flex w-full sm:w-auto gap-2 items-center">
           {stats?.isSleeping && botActive && (
             <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded font-bold animate-pulse">
                مرحلة السكون (تجنب التذبذب)
             </span>
           )}
           <button
              onClick={toggleBot}
              className={`flex-1 sm:flex-none justify-center items-center gap-2 px-4 py-2 rounded font-bold text-sm transition-all flex ${botActive ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}
           >
              {botActive ? <><Square className="w-4 h-4 fill-current"/> إيقاف المحرك</> : <><Play className="w-4 h-4 fill-current"/> تشغيل المحرك</>}
           </button>
           <button 
             onClick={fetchData} 
             className="btn btn-ghost btn-sm text-slate-400 hover:text-white border border-slate-700 rounded px-3 py-2 bg-slate-800 shrink-0"
             disabled={isLoading}
           >
             <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
           </button>
         </div>
       </div>

       {/* Tabs Navigation */}
       <div className="flex border-b border-slate-800 gap-6 overflow-x-auto custom-scrollbar pb-1">
          <button 
             onClick={() => setActiveTab('DASHBOARD')}
             className={`pb-2 text-sm font-bold flex items-center gap-2 whitespace-nowrap transition-colors ${activeTab === 'DASHBOARD' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-400 hover:text-slate-300'}`}
          >
             <LayoutDashboard className="w-4 h-4" /> المنصة الحية
          </button>
          <button 
             onClick={() => setActiveTab('REPORTS')}
             className={`pb-2 text-sm font-bold flex items-center gap-2 whitespace-nowrap transition-colors ${activeTab === 'REPORTS' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-400 hover:text-slate-300'}`}
          >
             <FileText className="w-4 h-4" /> التقارير والتحليل
          </button>
          <button 
             onClick={() => setActiveTab('SETTINGS')}
             className={`pb-2 text-sm font-bold flex items-center gap-2 whitespace-nowrap transition-colors ${activeTab === 'SETTINGS' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-400 hover:text-slate-300'}`}
          >
             <SettingsIcon className="w-4 h-4" /> إعدادات الروبوت
          </button>
       </div>

       {/* Settings Tab */}
       {activeTab === 'SETTINGS' && (
          <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
             <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-[0_0_15px_rgba(59,130,246,0.05)]">
                <h2 className="text-lg text-white font-bold mb-6 flex gap-2 items-center">
                   <SettingsIcon className="w-5 h-5 text-blue-400"/> إعدادات رأس المال والمخاطر
                </h2>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
                   <div className="space-y-2">
                       <label className="text-sm text-slate-300 font-semibold block">الرصيد الافتراضي الأولي ($)</label>
                       <p className="text-xs text-slate-500 mb-2">إعادة تعيين الرصيد التجريبي (سيتم تطبيقه إذا لم يكن هناك صفقات مغلقة بعد)</p>
                       <input 
                         type="number" 
                         value={balanceInput}
                         onChange={(e) => setBalanceInput(e.target.value)}
                         className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white font-mono focus:border-blue-500 focus:outline-none transition-colors"
                       />
                   </div>
                   <div className="space-y-2">
                       <label className="text-sm text-slate-300 font-semibold block">الحد الأقصى للصفقات المفتوحة</label>
                       <p className="text-xs text-slate-500 mb-2">كم عدد الصفقات التي يمكن أن يفتحها الروبوت في نفس الوقت</p>
                       <input 
                         type="number" 
                         value={maxTradesInput}
                         onChange={(e) => setMaxTradesInput(e.target.value)}
                         className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white font-mono focus:border-blue-500 focus:outline-none transition-colors"
                       />
                   </div>
                </div>

                 <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-[0_0_15px_rgba(59,130,246,0.05)] mb-6">
                 <h2 className="text-lg text-white font-bold mb-6 flex gap-2 items-center">
                    <Target className="w-5 h-5 text-emerald-400"/> إعدادات إيقاف الروبوت الذاتي والذكاء الاصطناعي
                 </h2>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6 pt-4 border-t border-slate-800/50">
                    <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800/80">
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input 
                               type="checkbox" 
                               checked={haltProfitEnabled}
                               onChange={(e) => setHaltProfitEnabled(e.target.checked)}
                               className="w-5 h-5 accent-emerald-500 bg-slate-800 border-slate-700 rounded focus:ring-emerald-500 focus:ring-offset-slate-900" 
                            />
                            <span className="text-sm text-slate-200 font-bold">إيقاف الروبوت عند تحقيق ربح محدد</span>
                        </label>
                        <div className={`transition-opacity duration-300 ${haltProfitEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                            <p className="text-[11px] text-slate-500 mb-2">سيتم إيقاف تشغيل الروبوت تلقائياً إذا وصل صافي الربح التراكمي إلى هذا الرقم ($)</p>
                            <input 
                              type="number" 
                              value={haltProfitTarget}
                              onChange={(e) => setHaltProfitTarget(e.target.value)}
                              disabled={!haltProfitEnabled}
                              className="w-full bg-slate-900 border border-emerald-900/50 focus:border-emerald-500 rounded-lg p-2 text-emerald-100 font-mono focus:outline-none"
                            />
                        </div>
                    </div>

                    <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800/80">
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input 
                               type="checkbox" 
                               checked={haltLossEnabled}
                               onChange={(e) => setHaltLossEnabled(e.target.checked)}
                               className="w-5 h-5 accent-rose-500 bg-slate-800 border-slate-700 rounded focus:ring-rose-500 focus:ring-offset-slate-900" 
                            />
                            <span className="text-sm text-slate-200 font-bold">إيقاف الروبوت عند الوصول لخسارة محددة</span>
                        </label>
                        <div className={`transition-opacity duration-300 ${haltLossEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                            <p className="text-[11px] text-slate-500 mb-2">سيتم إيقاف التشغيل كإجراء وقائي إذا وصل صافي الخسارة التراكمي لهذا الرقم ($)</p>
                            <input 
                              type="number" 
                              value={haltLossTarget}
                              onChange={(e) => setHaltLossTarget(e.target.value)}
                              disabled={!haltLossEnabled}
                              className="w-full bg-slate-900 border border-rose-900/50 focus:border-rose-500 rounded-lg p-2 text-rose-100 font-mono focus:outline-none"
                            />
                        </div>
                    </div>
                 </div>

                 <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 mt-2">
                    <label className="flex items-start sm:items-center gap-3 cursor-pointer">
                        <input 
                           type="checkbox" 
                           checked={smartBtcHoldEnabled}
                           onChange={(e) => setSmartBtcHoldEnabled(e.target.checked)}
                           className="w-5 h-5 mt-1 sm:mt-0 accent-blue-500 shrink-0 bg-slate-800 border-slate-700 rounded focus:ring-blue-500 focus:ring-offset-slate-900" 
                        />
                        <div>
                           <span className="text-sm text-slate-200 font-bold block mb-1">الاحتفاظ الذكي مع اتجاه البيتكوين (Smart Hold)</span>
                           <span className="text-[11px] text-slate-400 block leading-relaxed">
                              عند تفعيل هذا الخيار، سيقوم الروبوت بتجاهل إشارات الخروج الطارئة (Emergency Exits) الناجمة عن تخبط السوق إذا كانت اتجاهات الصفقات المفتوحة موازية لحركة البيتكوين، لتجنب الخروج المبكر من الصفقات الرابحة فقط بسبب تذبذب البيتكوين المؤقت.
                           </span>
                        </div>
                    </label>
                 </div>

                 <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 mt-2">
                    <div>
                        <span className="text-sm text-slate-200 font-bold block mb-1">نسبة التذبذب العنيف للبيتكوين (%)</span>
                        <span className="text-[11px] text-slate-400 block leading-relaxed mb-3">
                            إذا تحرك البيتكوين بنسبة فجائية (خلال ربع ساعة) تفوق هذه النسبة المئوية المحددة، سيعتبره الروبوت تذبذب طارئ (BTC Chaos) وقد يقوم بإيقاف الصفقات وإلغاء عمليات الفحص لضمان الأمان.
                        </span>
                        <input 
                            type="number" 
                            step="0.05"
                            min="0.10"
                            value={btcVolThresholdStr}
                            onChange={(e) => setBtcVolThresholdStr(e.target.value)}
                            className="w-full sm:w-1/2 bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-lg p-2 text-slate-200 font-mono focus:outline-none"
                        />
                    </div>
                 </div>
                 </div>

                <div className="flex justify-end pt-4 border-t border-slate-800">
                   <button 
                     onClick={saveConfig}
                     disabled={isSavingConfig}
                     className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition"
                   >
                     {isSavingConfig ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                     حفظ التغييرات
                   </button>
                </div>
             </div>
          </div>
       )}

       {/* Reports Tab */}
       {activeTab === 'REPORTS' && stats && (
          <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {/* Section 1 */}
               <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-[0_0_15px_rgba(59,130,246,0.05)] border-l-4 border-l-blue-500/50">
                  <h2 className="text-lg text-white font-bold mb-4 flex gap-2 items-center"><Activity className="w-4 h-4 text-emerald-400"/> نظرة عامة على الفحوصات</h2>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                     <div className="bg-slate-800 p-3 rounded">
                        <p className="text-xs text-slate-400">الفحوصات الإجمالية</p>
                        <p className="text-xl font-bold text-white">{stats.totalEvaluations}</p>
                     </div>
                     <div className="bg-slate-800 p-3 rounded">
                        <p className="text-xs text-slate-400">الصفقات المقبولة (DANGER ZONE)</p>
                        <p className="text-xl font-bold text-white">{stats.acceptedLongs + stats.acceptedShorts}</p>
                     </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                     <div className="bg-emerald-900/30 border border-emerald-800/50 p-3 rounded">
                        <p className="text-xs text-emerald-400">صعود (مقبول / فحوصات)</p>
                        <p className="text-lg font-bold text-white">{stats.acceptedLongs} / {stats.totalLongScanned}</p>
                     </div>
                     <div className="bg-rose-900/30 border border-rose-800/50 p-3 rounded">
                        <p className="text-xs text-rose-400">هبوط (مقبول / فحوصات)</p>
                        <p className="text-lg font-bold text-white">{stats.acceptedShorts} / {stats.totalShortScanned}</p>
                     </div>
                  </div>
               </div>

               {/* Section 2 */}
               <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-[0_0_15px_rgba(59,130,246,0.05)]">
                  <h2 className="text-lg text-white font-bold mb-4 flex gap-2 items-center"><Target className="w-4 h-4 text-blue-400"/> أداء شروط الدخول (Scoring Layers)</h2>
                  <div className="h-48 overflow-y-auto pr-2 custom-scrollbar">
                    {renderRuleStat('اتجاه ووضع السوق العام', stats.rules?.market_context)}
                    {renderRuleStat('توقع سيطرة الحيتان', stats.rules?.whale_reader)}
                    {renderRuleStat('هيكل السعر', stats.rules?.price_structure)}
                    {renderRuleStat('الزخم والسيولة', stats.rules?.momentum_ignition)}
                  </div>
               </div>
             </div>

             {/* Closed Trades History */}
             <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-[0_0_15px_rgba(59,130,246,0.05)]">
                <h2 className="text-lg text-white font-bold mb-4 flex gap-2 items-center"><FileText className="w-4 h-4 text-emerald-400"/> سجل الصفقات المغلقة</h2>
                {renderTradesList(closedTrades, true)}
             </div>
          </div>
       )}

       {/* Dashboard Tab */}
       {activeTab === 'DASHBOARD' && (
          <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
             {/* Financial Summary */}
             <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                 <div className="col-span-2 lg:col-span-1 bg-slate-900 border-l-2 border-blue-500 border-y border-r border-y-slate-800 border-r-slate-800 p-4 rounded-xl shadow">
                    <p className="text-xs text-slate-400 mb-1">الرصيد المتاح</p>
                    <p className="text-xl sm:text-2xl font-black text-white">${stats?.balance?.toFixed(2) || 0}</p>
                 </div>
                 <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow">
                    <p className="text-[10px] sm:text-xs text-slate-400 mb-1">صافي الربح/الخسارة</p>
                    <p className={`text-lg sm:text-xl font-bold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                       {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
                    </p>
                 </div>
                 <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl shadow">
                    <p className="text-[10px] sm:text-xs text-slate-400 mb-1">الربح العائم (Floating)</p>
                    <p className={`text-lg sm:text-xl font-bold ${floatingPnLAmount >= 0 ? 'text-blue-400' : 'text-rose-400'}`}>
                       {floatingPnLAmount >= 0 ? '+' : ''}${floatingPnLAmount.toFixed(2)}
                    </p>
                 </div>
                 <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl shadow">
                    <p className="text-[10px] sm:text-xs text-slate-400 mb-1">الربح المحقق (Closed)</p>
                    <p className={`text-lg sm:text-xl font-bold ${realizedPnLAmount >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                       {realizedPnLAmount >= 0 ? '+' : ''}${realizedPnLAmount.toFixed(2)}
                    </p>
                 </div>
                 <div className="col-span-2 lg:col-span-1 bg-slate-900/50 border border-slate-800 p-4 rounded-xl shadow">
                    <p className="text-[10px] sm:text-xs text-slate-400 mb-1">الصفقات النشطة</p>
                    <p className="text-lg sm:text-xl font-bold text-slate-300">{sovTrades.length} / {stats?.maxOpenTrades || 3}</p>
                 </div>
             </div>

             {/* Trades Analytics */}
             <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-[0_0_15px_rgba(59,130,246,0.05)]">
                <h2 className="text-lg text-white font-bold mb-4 flex gap-2 items-center"><TrendingUp className="w-4 h-4 text-emerald-400"/> الصفقات المفتوحة والحية</h2>
                {renderTradesList(sovTrades, false)}
             </div>

             {/* System Terminal Logs */}
             <div className="bg-black/80 border border-slate-800 rounded-xl p-5 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
                <h2 className="text-lg text-slate-300 font-bold mb-4 flex gap-2 items-center"><Terminal className="w-4 h-4 text-slate-400"/> سجل النظام الحي (Live Logs)</h2>
                <div className="h-64 overflow-y-auto font-mono text-[11px] leading-relaxed pr-2 custom-scrollbar flex flex-col-reverse">
                   {logs.map((log, i) => (
                      <div key={i} className={`py-1 border-b border-slate-800/50 ${
                         log.type === 'error' ? 'text-rose-400' : 
                         log.type === 'success' ? 'text-emerald-400' : 
                         log.type === 'warn' ? 'text-amber-400' : 'text-slate-400'
                      }`}>
                         <span className="opacity-50 mr-3 text-[10px] break-keep whitespace-nowrap">
                            {new Date(log.time).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                         </span>
                         {log.msg}
                      </div>
                   ))}
                   {logs.length === 0 && <div className="text-center text-slate-600 py-10">لا يوجد سجلات حتى الآن</div>}
                </div>
             </div>
          </div>
       )}
    </div>
  );
};


