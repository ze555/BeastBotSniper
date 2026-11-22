import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Activity, Target, TrendingUp, Swords, Play, Square, Terminal, LayoutDashboard, FileText, Settings as SettingsIcon, Save, Download, Database } from 'lucide-react';

export const PredatorDashboard: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [closedTrades, setClosedTrades] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [botActive, setBotActive] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'REPORTS' | 'SETTINGS'>('DASHBOARD');
  
  // Settings state
  const [balanceInput, setBalanceInput] = useState('1000');
  const [maxTradesInput, setMaxTradesInput] = useState('3');
  const [haltProfitEnabled, setHaltProfitEnabled] = useState(false);
  const [haltProfitTarget, setHaltProfitTarget] = useState('150');
  const [haltLossEnabled, setHaltLossEnabled] = useState(false);
  const [haltLossTarget, setHaltLossTarget] = useState('50');
  const [scanBatchSize, setScanBatchSize] = useState('0');
  const [feeRateInput, setFeeRateInput] = useState('0.0004');
  const [slippageRateInput, setSlippageRateInput] = useState('0.0002');
  const [liveWebsocketEnabled, setLiveWebsocketEnabled] = useState(true);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [tradingMode, setTradingMode] = useState<'SCHEDULED' | 'ALWAYS'>('SCHEDULED');
  const [tradingStart, setTradingStart] = useState('18:00');
  const [tradingEnd, setTradingEnd] = useState('02:00');
  const [configError, setConfigError] = useState('');
  const tradingSettingsDirty = useRef(false);

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
        if (document.activeElement?.tagName !== 'INPUT' && !tradingSettingsDirty.current) {
            if (data.strategySettings?.tradingSchedule) {
                setTradingMode(data.strategySettings.tradingSchedule.mode);
                setTradingStart(data.strategySettings.tradingSchedule.startLocal);
                setTradingEnd(data.strategySettings.tradingSchedule.endLocal);
            }
            setBalanceInput(data.initialBalance?.toString() || '1000');
            setMaxTradesInput(data.maxOpenTrades?.toString() || '3');
            if (data.haltProfitTarget !== undefined) setHaltProfitTarget(data.haltProfitTarget.toString());
            if (data.haltProfitEnabled !== undefined) setHaltProfitEnabled(data.haltProfitEnabled);
            if (data.haltLossTarget !== undefined) setHaltLossTarget(data.haltLossTarget.toString());
            if (data.haltLossEnabled !== undefined) setHaltLossEnabled(data.haltLossEnabled);
            if (data.scanBatchSize !== undefined) setScanBatchSize(data.scanBatchSize.toString());
            if (data.feeRate !== undefined) setFeeRateInput(data.feeRate.toString());
            if (data.slippageRate !== undefined) setSlippageRateInput(data.slippageRate.toString());
            if (typeof data.liveWebsocketEnabled === 'boolean') setLiveWebsocketEnabled(data.liveWebsocketEnabled);
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
    } catch {
      // Ignore transient network blips during dev server restart or polling
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
      setConfigError('');
      try {
          const result = await fetch('/api/predator/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  balance: Number(balanceInput),
                  maxTrades: Number(maxTradesInput),
                  haltProfitEnabled,
                  haltProfitTarget: Number(haltProfitTarget),
                  haltLossEnabled,
                  haltLossTarget: Number(haltLossTarget),
                  scanBatchSize: Number(scanBatchSize),
                  feeRate: Number(feeRateInput),
                  slippageRate: Number(slippageRateInput),
                  tradingSchedule: {mode: tradingMode, startLocal: tradingStart, endLocal: tradingEnd},
                  liveWebsocketEnabled,
              })
          });
          if (!result.ok) {
              const data = await safeJson(result).catch(() => ({message:'تعذر حفظ الإعدادات'}));
              throw new Error(data.message || 'تعذر حفظ الإعدادات');
          }
          tradingSettingsDirty.current = false;
          await fetchData();
      } catch (e) {
          console.error(e);
          setConfigError(e instanceof Error ? e.message : 'تعذر حفظ الإعدادات');
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
                      <div className="flex items-center gap-2 flex-wrap">
                         <span className="text-xl font-black text-white">{t.symbol}</span>
                         <span className={`text-xs px-2 py-0.5 rounded font-bold ${t.direction === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                            {t.direction}
                         </span>
                         <span className="bg-slate-800 text-slate-300 text-[10px] px-2 py-0.5 rounded shadow-sm">{t.grade}</span>
                         {t.setupLabel && (
                            <span className="bg-blue-950/80 text-blue-300 border border-blue-500/40 text-[10px] px-2 py-0.5 rounded font-bold">
                               {t.setupLabel}
                            </span>
                         )}
                         {t.be_done && (
                            <span className="bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 text-[10px] px-2 py-0.5 rounded font-bold flex items-center gap-1 animate-pulse">
                               🛡️ صفر مخاطرة (مؤمنة بربح)
                            </span>
                         )}
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
             <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
                <h2 className="text-lg text-white font-bold flex gap-2 items-center">
                   <SettingsIcon className="w-5 h-5 text-blue-400"/> إعدادات المحرك الجديد فقط
                </h2>
                <p className="text-sm text-slate-300 leading-relaxed">
                   المحرك التكيفي V2: إشارة الدقيقة تمر بانتظار شمعة مغلقة إضافية، ثم تأكيد اتجاه 5m/15m وتدفق تنفيذ حي ودفتر أوامر حقيقي وبيانات OI تاريخية موثقة.
                   يتم رفض الدخول في حال ضعف السيولة أو ارتفاع التكلفة أو تغير الاتجاه. المخاطرة المستهدفة 0.35% لكل صفقة PAPER.
                   التداول الافتراضي طوال اليوم، ولا توجد ضمانة للربحية قبل اختبارات مستقلة.
                </p>
                <p className="text-xs text-amber-400">التداول ورقي (Paper) فقط. الوقت يتحكم في فتح الصفقات الجديدة، وتستمر حماية وإغلاق الصفقات المفتوحة خارج النافذة.</p>
                <div className="border border-slate-700 rounded-lg p-4 space-y-2">
                   <label className="flex items-center gap-3 text-sm text-white font-semibold">
                     <input type="checkbox" checked={liveWebsocketEnabled}
                       onChange={e=>{tradingSettingsDirty.current=true;setLiveWebsocketEnabled(e.target.checked);}}/>
                     استعمال WebSocket الحي في قرارات التداول — مفعّل افتراضياً
                   </label>
                   <p className="text-xs text-slate-400">
                     عند التشغيل: يؤكد تدفق aggTrade اللحظي دخول الاختراقات ويدعم كشف الانعكاس في الصفقات المفتوحة.
                     يلزم وصول بيانات حديثة للاختراق؛ استمرار الاتجاه والتصحيح يحتفظان بقواعد دخولهما السابقة.
                     عند الإيقاف: لا تؤثر بيانات WebSocket على الدخول أو الخروج، وتبقى قواعد السعر وREST والوقف والأهداف كما كانت.
                   </p>
                   <p className="text-xs text-sky-400">
                     الحالة: {stats?.institutionalMonitor?.connected ? 'متصل' : 'غير متصل'}
                     {' | '}تأكيد الاشتراكات: {stats?.institutionalMonitor?.subscriptionAcks ?? 0}
                     {' | '}رسائل aggTrade: {stats?.institutionalMonitor?.aggTradeEvents ?? 0}
                     {' | '}أخطاء الاشتراك: {stats?.institutionalMonitor?.subscriptionErrors ?? 0}
                   </p>
                   <p className="text-xs text-amber-400">
                     التغيير يسري عند حفظ الإعدادات، ويعود الخيار إلى الافتراضي (مفعّل) عند إعادة تشغيل السيرفر؛ حالة الإعدادات غير محفوظة بتخزين دائم.
                   </p>
                </div>
                <div className="border border-slate-700 rounded-lg p-4 space-y-3">
                   <label className="block text-sm font-bold text-white">وقت فتح الصفقات
                      <select value={tradingMode} onChange={e => {tradingSettingsDirty.current = true; setTradingMode(e.target.value as 'SCHEDULED'|'ALWAYS');}}
                        className="mt-2 w-full bg-slate-950 border border-slate-700 rounded p-2 text-white">
                         <option value="SCHEDULED">توقيت محدد (الافتراضي: 18:00–02:00)</option>
                         <option value="ALWAYS">طوال اليوم 24/7</option>
                      </select>
                   </label>
                   {tradingMode === 'SCHEDULED' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                         <label className="text-sm text-slate-300">وقت البدء — بتوقيت ليبيا
                            <input type="time" value={tradingStart} onChange={e => {tradingSettingsDirty.current = true; setTradingStart(e.target.value);}}
                              className="mt-2 w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"/>
                         </label>
                         <label className="text-sm text-slate-300">وقت التوقف عن فتح صفقات جديدة — بتوقيت ليبيا
                            <input type="time" value={tradingEnd} onChange={e => {tradingSettingsDirty.current = true; setTradingEnd(e.target.value);}}
                              className="mt-2 w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"/>
                         </label>
                      </div>
                   )}
                   <p className="text-xs text-slate-400">يمكن عبور منتصف الليل (مثل 18:00–02:00). وقت النهاية غير مشمول. التغيير يسري فور الحفظ.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <label className="text-sm text-slate-300">الرصيد الافتراضي الأولي ($)
                      <input type="number" min="100" value={balanceInput} onChange={e=>setBalanceInput(e.target.value)}
                        className="mt-2 w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"/>
                   </label>
                   <label className="text-sm text-slate-300">أقصى عدد صفقات مفتوحة (1–10)
                      <input type="number" min="1" max="10" value={maxTradesInput} onChange={e=>setMaxTradesInput(e.target.value)}
                        className="mt-2 w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"/>
                   </label>
                   <label className="text-sm text-slate-300">حجم دفعة الفحص (0 = تلقائي لفحص جميع العملات)
                      <input type="number" min="0" max="200" value={scanBatchSize} onChange={e=>setScanBatchSize(e.target.value)}
                        className="mt-2 w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"/>
                      <span className="block mt-1 text-xs text-slate-400">الافتراضي 0: تقسيم كل العقود المتاحة على نحو 4 دورات. أي رقم من 5–200 يغيّر سرعة التغطية فقط، ولا يستبعد عملة.</span>
                   </label>
                   <label className="text-sm text-slate-300">رسوم التداول
                      <input type="number" step="0.0001" min="0" value={feeRateInput} onChange={e=>setFeeRateInput(e.target.value)}
                        className="mt-2 w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"/>
                   </label>
                   <label className="text-sm text-slate-300">الانزلاق السعري التقديري
                      <input type="number" step="0.0001" min="0" value={slippageRateInput} onChange={e=>setSlippageRateInput(e.target.value)}
                        className="mt-2 w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"/>
                   </label>
                </div>
                <div className="space-y-4 border-t border-slate-700 pt-4">
                   <label className="flex gap-2 items-center text-sm text-white">
                      <input type="checkbox" checked={haltProfitEnabled} onChange={e=>setHaltProfitEnabled(e.target.checked)}/>
                      منع دخول صفقات جديدة عند الوصول لهدف الربح
                   </label>
                   <input type="number" min="1" value={haltProfitTarget} onChange={e=>setHaltProfitTarget(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"/>
                   <label className="flex gap-2 items-center text-sm text-white">
                      <input type="checkbox" checked={haltLossEnabled} onChange={e=>setHaltLossEnabled(e.target.checked)}/>
                      منع دخول صفقات جديدة عند حد الخسارة
                   </label>
                   <input type="number" min="1" value={haltLossTarget} onChange={e=>setHaltLossTarget(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"/>
                </div>
                {configError && <p role="alert" className="text-sm text-rose-400">{configError}</p>}
                <button onClick={saveConfig} disabled={isSavingConfig}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2">
                   {isSavingConfig ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
                   حفظ الإعدادات
                </button>
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

             {/* Research & ChatGPT Analysis Dataset Card */}
             <div className="bg-gradient-to-r from-blue-950/60 via-slate-900 to-indigo-950/60 border border-blue-500/40 rounded-xl p-5 shadow-lg">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                   <div>
                      <div className="flex items-center gap-2 mb-1">
                         <Database className="w-5 h-5 text-blue-400" />
                         <h2 className="text-lg text-white font-bold">حزمة بيانات البحث والتشخيص (ChatGPT Data Export)</h2>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed max-w-2xl">
                         سجل متكامل ومباشر لكل قرار تداول: الشموع السابقة (30-50 شمعة)، وحركة السعر أثناء الصفقة (MFE / MAE)، وشموع ما بعد الخروج، والإشارات المرفوضة وسبب رفضها. جاهزة للتحليل الفوري مع ChatGPT لتشخيص أسباب الخسائر وتحسين الدخول والخروج.
                      </p>
                   </div>
                   <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                      <a
                         href="/api/research/export-all"
                         target="_blank"
                         rel="noreferrer"
                         download="beastbot_full_research_export.json"
                         className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs px-4 py-2.5 rounded-lg font-bold shadow-md transition-all flex-1 sm:flex-none"
                      >
                         <Download className="w-4 h-4" />
                         تحميل الحزمة الكاملة (JSON)
                      </a>
                      <a
                         href="/api/research/trades"
                         target="_blank"
                         rel="noreferrer"
                         className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs px-3 py-2.5 rounded-lg font-mono transition-all"
                      >
                         الصفقات المنفذة
                      </a>
                      <a
                         href="/api/research/rejected"
                         target="_blank"
                         rel="noreferrer"
                         className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs px-3 py-2.5 rounded-lg font-mono transition-all"
                      >
                         الإشارات المرفوضة
                      </a>
                      <a
                         href="/api/research/performance"
                         target="_blank"
                         rel="noreferrer"
                         className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs px-3 py-2.5 rounded-lg font-mono transition-all"
                      >
                         الملخص الإحصائي
                      </a>
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
             {/* 3:1 Genius Architecture Banner */}
             <div className="bg-gradient-to-r from-blue-950/70 via-slate-900 to-emerald-950/60 border border-blue-500/30 rounded-xl p-4 shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="space-y-1">
                   <div className="flex items-center gap-2">
                      <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-xs px-2.5 py-0.5 rounded-full font-black flex items-center gap-1.5">
                         <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                         نظام التفوق الرياضي 3:1 نشط
                      </span>
                      <span className="text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded font-mono">
                         Adaptive • PAPER
                      </span>
                   </div>
                   <p className="text-sm font-bold text-white">
                      استراتيجية التناغم الثلاثي + درع الوقف الصفري لحماية رأس المال ($1,000)
                   </p>
                   <p className="text-xs text-slate-400">
                      يتم اقتناص الصفقات عند تلاقي سيولة الحيتان (CVD + OI) مع اتجاه البيتكوين، وتأمين الربح عند +0.70R بنقل الوقف لنقطة الدخول فوراً.
                   </p>
                </div>
                <div className="flex items-center gap-3 bg-slate-950/70 p-3 rounded-lg border border-slate-800 text-xs font-mono shrink-0">
                   <div className="text-center px-2">
                      <span className="text-slate-400 block text-[10px]">رابحة اليوم</span>
                      <span className="text-emerald-400 font-bold text-base">{stats?.today?.wins || 0}</span>
                   </div>
                   <div className="text-slate-600 text-lg">/</div>
                   <div className="text-center px-2">
                      <span className="text-slate-400 block text-[10px]">خاسرة اليوم</span>
                      <span className="text-rose-400 font-bold text-base">{stats?.today?.losses || 0}</span>
                   </div>
                   <div className="text-slate-600 text-lg">|</div>
                   <div className="text-center px-2">
                      <span className="text-slate-400 block text-[10px]">نسبة الفوز</span>
                      <span className="text-blue-400 font-bold text-base">
                         {stats?.today?.count > 0 
                            ? `${((stats.today.wins / stats.today.count) * 100).toFixed(0)}%` 
                            : '0%'}
                      </span>
                   </div>
                </div>
             </div>

             {stats?.scanCoverage && (
                <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm text-slate-200">
                   <h3 className="font-bold text-white mb-2">تغطية سوق Binance Futures — جميع العقود الدائمة USDT / USDC</h3>
                   <div className="flex flex-wrap gap-x-5 gap-y-2">
                      <span>العقود المؤهلة: <strong>{stats.scanCoverage.universeLastUpdatedAt ? stats.scanCoverage.eligibleSymbols : 'جارٍ تحميل القائمة'}</strong></span>
                      <span>حجم الدفعة: <strong>{stats.scanCoverage.effectiveBatchSize}</strong></span>
                      <span>مفحوصة في الجولة الحالية: <strong>{stats.scanCoverage.currentPassAttempted}</strong></span>
                      <span>جولات مكتملة: <strong>{stats.scanCoverage.completedPasses}</strong></span>
                   </div>
                   {stats.scanCoverage.lastCompletedPass && <p className="mt-2 text-xs text-slate-400">
                      آخر جولة: {stats.scanCoverage.lastCompletedPass.succeeded} عقد ببيانات شموع كافية من {stats.scanCoverage.lastCompletedPass.universeSize} عقد
                      ، في {(stats.scanCoverage.lastCompletedPass.durationMs/1000).toFixed(0)} ثانية
                   </p>}
                   {stats.scanCoverage.rateLimitBackoffUntil && <p className="mt-2 text-xs text-amber-400">توقف مؤقت لحماية اتصال Binance من تجاوز حد الطلبات.</p>}
                </div>
             )}

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


