import React from 'react';
import { 
  Settings, Zap, ShieldCheck, Wallet, RefreshCw, BrainCircuit, ArrowUpRight, Cpu, Key, Trash2,
  ChevronDown, ChevronUp, Gauge, History, BarChart3, Activity, Flame, Shield, Skull,
  Waves, ShieldAlert, AlertTriangle
} from 'lucide-react';

export function SettingsView({ 
  settings, 
  setSettings, 
  savingSettings, 
  saveSettings, 
  applyTemplate, 
  STRATEGY_TEMPLATES, 
  intensity 
}: { 
  settings: any, 
  setSettings: (s: any) => void, 
  savingSettings: boolean, 
  saveSettings: (e: React.FormEvent) => void, 
  applyTemplate: (tpl: any) => void, 
  STRATEGY_TEMPLATES: any[], 
  intensity: any 
}) {
  const [activeTab, setActiveTab] = React.useState<'account' | 'risk' | 'entry' | 'exit' | 'tuning' | 'beast'>('account');
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{success: boolean, message: string} | null>(null);
  const [serverIp, setServerIp] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/utils/server-ip')
      .then(res => res.json())
      .then(data => setServerIp(data.ip))
      .catch(() => setServerIp('فشل في جلب الـ IP'));
  }, []);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch('/api/binance/test-connection');
      const data = await response.json();
      setTestResult({ success: data.success, message: data.message });
    } catch (e: any) {
      setTestResult({ success: false, message: e.message || 'خطأ في الاتصال بالسيرفر' });
    } finally {
      setTesting(false);
    }
  };

  const [resetting, setResetting] = React.useState(false);
  const [showResetConfirm, setShowResetConfirm] = React.useState(false);

  const handleResetDB = async () => {
    setResetting(true);
    try {
      const response = await fetch('/api/utils/reset-db', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        alert('تم المسح بنجاح.');
        window.location.reload();
      }
    } finally {
      setResetting(false);
    }
  };

  const TabButton = ({ id, label, icon: Icon }: { id: typeof activeTab, label: string, icon: any }) => (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`flex items-center gap-2 px-6 py-4 border-b-2 font-bold transition-all shrink-0 ${
        activeTab === id 
          ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5' 
          : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
      }`}
    >
      <Icon className="w-5 h-5" />
      {label}
    </button>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-700 pb-40" dir="rtl">
      
      {/* Advanced Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <div className="relative">
            <div className="w-20 h-20 bg-emerald-500/20 rounded-2xl flex items-center justify-center border border-emerald-500/30 text-emerald-400 shadow-[0_0_20px_-10px_rgba(16,185,129,0.5)]">
              <BrainCircuit className="w-10 h-10 animate-pulse" />
            </div>
            <div className="absolute -top-2 -right-2 bg-rose-500 text-white text-[8px] font-black px-2 py-1 rounded-full animate-bounce shadow-lg">V1.5 PRO</div>
          </div>
          <div className="text-right">
            <h1 className="text-3xl font-black text-white">مركز التحكم المتقدم</h1>
            <p className="text-slate-500 text-sm mt-1">تنسيق الأنظمة، ضبط الحساسية، وإدارة المخاطر المؤسساتية.</p>
          </div>
        </div>
        <div className="flex bg-slate-950 p-1 rounded-2xl border border-slate-800">
          <button type="button" onClick={() => setSettings({...settings, tradingMode: 'PAPER'})} className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${settings.tradingMode === 'PAPER' ? 'bg-emerald-500 text-white' : 'text-slate-500 hover:text-slate-300'}`}>TRIAL</button>
          <button type="button" onClick={() => setSettings({...settings, tradingMode: 'LIVE'})} className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${settings.tradingMode === 'LIVE' ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20' : 'text-slate-500 hover:text-rose-400'}`}>LIVE EXECUTION</button>
        </div>
      </div>

      <form onSubmit={saveSettings} className="space-y-8">
        <div className="bg-slate-900/50 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
          {/* Navigation Tabs */}
          <div className="flex overflow-x-auto border-b border-slate-800 bg-slate-900/80 backdrop-blur-xl sticky top-0 z-20 no-scrollbar">
            <TabButton id="account" label="الحساب والربط" icon={Key} />
            <TabButton id="risk" label="إدارة المخاطر" icon={ShieldCheck} />
            <TabButton id="entry" label="محركات الدخول" icon={Zap} />
            <TabButton id="exit" label="دروع الخروج" icon={Shield} />
            <TabButton id="beast" label="الوحش الذكي" icon={Flame} />
            <TabButton id="tuning" label="المعايرة الفنية" icon={Gauge} />
          </div>

          <div className="p-8 md:p-10 min-h-[500px]">
            {/* 1. Account & Connectivity */}
            {activeTab === 'account' && (
              <div className="space-y-10 animate-in slide-in-from-left-4 duration-300">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-right">
                  <div className="space-y-3">
                    <label className="text-slate-310 text-sm font-bold">Binance API Key</label>
                    <input type="password" placeholder="لاستخدام .env اتركه فارغاً..." className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 text-emerald-400 font-mono focus:border-emerald-500 outline-none transition-all text-left" value={settings.binanceApiKey || ''} onChange={e => setSettings({...settings, binanceApiKey: e.target.value})} />
                  </div>
                  <div className="space-y-3">
                    <label className="text-slate-310 text-sm font-bold">Binance Secret Key</label>
                    <input type="password" placeholder="لاستخدام .env اتركه فارغاً..." className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 text-emerald-400 font-mono focus:border-emerald-500 outline-none transition-all text-left" value={settings.binanceSecretKey || ''} onChange={e => setSettings({...settings, binanceSecretKey: e.target.value})} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 border-t border-slate-800 pt-8 justify-end">
                  {serverIp && <div className="text-[10px] text-slate-500 bg-slate-950 px-4 py-2 rounded-xl border border-slate-800">IP السيرفر: <span className="text-white font-mono select-all">{serverIp}</span></div>}
                  <button type="button" onClick={handleTestConnection} disabled={testing} className="px-8 py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl text-sm font-black flex items-center gap-3 transition-all">
                    {testing ? <RefreshCw className="animate-spin text-rose-400 w-5 h-5" /> : <Zap className="text-rose-400 w-5 h-5" />}
                    فحص الاتصال المباشر
                  </button>
                  {testResult && (
                    <div className={`px-6 py-4 rounded-2xl border text-sm font-bold flex items-center gap-3 ${testResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
                      {testResult.success ? <ShieldCheck className="w-5 h-5" /> : <Skull className="w-5 h-5" />}
                      {testResult.message}
                    </div>
                  )}
                </div>
              </div>
            )}
         
         {/* 3. Layer 0: Core Risk Setup */}
         <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-8 md:p-10 shadow-2xl">
            <div className="flex items-center justify-between mb-10 border-b border-slate-800 pb-6">
               <div className="flex items-center gap-4">
                  <div className="p-3 bg-emerald-500/20 rounded-2xl"><Wallet className="w-7 h-7 text-emerald-400" /></div>
                  <div>
                     <h2 className="text-2xl font-black text-white">إدارة رأس المال</h2>
                     <p className="text-slate-500 text-sm mt-1">القواعد المالية الصارمة التي يتحرك البوت ضمنها.</p>
                  </div>
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
               <div className="space-y-3">
                  <label className="text-slate-300 text-sm font-bold flex items-center gap-2">
                     حجم المحفظة <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-500">Virtual</span>
                  </label>
                  <div className="relative">
                     <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span>
                     <input type="number" required min="1" className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-10 py-4 text-emerald-400 font-mono focus:border-emerald-500 outline-none transition-all text-left text-lg" dir="ltr" value={settings.portfolioSize} onChange={e => setSettings({...settings, portfolioSize: parseFloat(e.target.value)})} />
                  </div>
               </div>

               <div className="space-y-3">
                  <label className="text-slate-300 text-sm font-bold flex items-center gap-2">
                     المخاطرة لكل صفقة <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-500">Risk %</span>
                  </label>
                  <div className="relative">
                     <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">%</span>
                     <input type="number" step="0.1" required min="0.1" className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-10 py-4 text-amber-400 font-mono focus:border-amber-500 outline-none transition-all text-left text-lg" dir="ltr" value={settings.riskPerTradePerc} onChange={e => setSettings({...settings, riskPerTradePerc: parseFloat(e.target.value)})} />
                  </div>
               </div>

               <div className="space-y-3">
                  <label className="text-slate-300 text-sm font-bold flex items-center gap-2">
                     أقصى صفقات مفتوحة <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-500">Max Slots</span>
                  </label>
                  <input type="number" required min="1" className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 text-blue-400 font-mono focus:border-blue-500 outline-none transition-all text-left text-lg" dir="ltr" value={settings.maxConcurrentTrades} onChange={e => setSettings({...settings, maxConcurrentTrades: parseInt(e.target.value)})} />
               </div>

               <div className="space-y-3">
                  <label className="text-slate-300 text-sm font-bold flex items-center gap-2">
                     الرافعة المالية <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-500">Leverage</span>
                  </label>
                  <div className="relative">
                     <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">x</span>
                     <input type="number" required min="1" max="125" className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-10 py-4 text-purple-400 font-mono focus:border-purple-500 outline-none transition-all text-left text-lg" dir="ltr" value={settings.leverage} onChange={e => setSettings({...settings, leverage: parseInt(e.target.value)})} />
                  </div>
               </div>

               <div className="space-y-3 bg-slate-900/60 p-4 rounded-2xl border border-emerald-500/20 text-right">
                  <span className="text-xs font-bold text-emerald-400">تقسيم رأس المال التلقائي والموزع (Dynamic Capital Allocation)</span>
                  <p className="text-[10px] text-slate-400 leading-relaxed font-sans mt-1">
                     مُفعّل تلقائياً: يتم تقسيم وإفراز الهامش لكل صفقة بالتساوي بناءً على عدد الصفقات الأقصى المسموح به (<span className="text-emerald-300 font-mono">{settings.maxConcurrentTrades || 10} صفقات</span>). يضمن هذا النظام حجز جزء آمن من المحفظة لكل صفقة بحيث لا تستهلك أي صفقة كامل الرصيد ولا يتم فتح صفقة بدون رصيد كافٍ.
                  </p>
               </div>

               <div className="space-y-3">
                  <label className="text-slate-300 text-sm font-bold flex items-center gap-2">
                     رسوم التداول <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-500">Fees %</span>
                  </label>
                  <div className="relative">
                     <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">%</span>
                     <input type="number" step="0.01" required min="0" className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-10 py-4 text-rose-400 font-mono focus:border-rose-500 outline-none transition-all text-left text-lg" dir="ltr" value={((settings.tradingFeeRate || 0.001) * 100).toFixed(2)} onChange={e => setSettings({...settings, tradingFeeRate: parseFloat(e.target.value) / 100})} />
                  </div>
               </div>

               <div className="space-y-3">
                  <label className="text-slate-300 text-sm font-bold flex items-center gap-2">
                     تأمين الدخول السريع (Breakeven %)
                  </label>
                  <input type="number" step="0.1" className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 text-blue-400 font-mono focus:border-blue-500 outline-none transition-all text-left text-lg" dir="ltr" value={settings.strictFastBreakevenPerc ?? 0.5} onChange={e => setSettings({...settings, strictFastBreakevenPerc: parseFloat(e.target.value)})} />
                  <p className="text-[9px] text-slate-500 italic">نقل الوقف لسعر الدخول بمجرد وصول الربح السعري لهذه النسبة.</p>
               </div>
            </div>
         </section>

             {/* 3. Entry Engines */}
            {activeTab === 'entry' && (
              <div className="space-y-10 animate-in slide-in-from-left-4 duration-300 text-right">
                <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 flex items-center justify-between gap-6 border-r-4 border-r-purple-500">
                  <div className="space-y-1">
                    <h4 className="font-black text-white text-lg">وضعية التداول الموحدة</h4>
                    <p className="text-xs text-slate-500">اختر بين الاسكالبنج السريع (1 دقيقة) أو التداول الاستراتيجي (15 دقيقة فما فوق).</p>
                  </div>
                  <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
                    <button type="button" onClick={() => setSettings({...settings, isLongTerm: false})} className={`px-8 py-3 rounded-lg text-xs font-black transition-all ${!settings.isLongTerm ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>SCALP (1M)</button>
                    <button type="button" onClick={() => setSettings({...settings, isLongTerm: true})} className={`px-8 py-3 rounded-lg text-xs font-black transition-all ${settings.isLongTerm ? 'bg-amber-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>STRATEGIC (15M+)</button>
                  </div>
                </div>

                {/* المحرك الفولاذي الموحد الخارق (Steel Engine) */}
                <div className="bg-gradient-to-l from-slate-900 via-slate-950 to-indigo-950/40 border-2 border-indigo-500/50 rounded-3xl p-8 space-y-8 overflow-hidden relative shadow-[0_0_30px_rgba(99,102,241,0.15)]">
                  <div className="absolute top-0 right-0 p-2 opacity-5"><Shield className="w-40 h-40 text-indigo-400 rotate-12" /></div>
                  
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-indigo-500/20 pb-6 relative z-10 gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/30 text-indigo-400">
                        <Cpu className="w-8 h-8 animate-pulse text-indigo-400" />
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2">
                          <span className="bg-indigo-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">محرك متفوق</span>
                          <h4 className="font-black text-indigo-350 text-xl">المحرك الفولاذي المطلق (Steel Engine)</h4>
                        </div>
                        <p className="text-xs text-slate-400 mt-2 font-sans max-w-xl">
                          مُصمم بعبقرية مطلقة لدمج وتوحيد قوى ٣ محركات (الكمي والابتكاري والاندماجي) في شبكة عصبية واحدة. يقوم الذكاء الفولاذي بدراسة علم الاحتمالات الرقمية والاتجاهات الائتمانية وتدفقات الحيتان وحل أي تعارضات سوقية لصنع القرار المثالي بدقة خارقة.
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 self-end md:self-center ml-0 mr-auto">
                      {settings.useSteelEngine && (
                        <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-1.5 rounded-xl font-bold animate-pulse">TRIPLE HARMONY ACTIVE</span>
                      )}
                      <input 
                         type="checkbox" 
                         checked={!!settings.useSteelEngine} 
                         onChange={e => {
                           const isChecked = e.target.checked;
                           setSettings({
                             ...settings, 
                             useSteelEngine: isChecked,
                             useCreativeEngine: isChecked ? false : settings.useCreativeEngine,
                             useFusionEngine: isChecked ? false : settings.useFusionEngine
                           });
                         }} 
                         className="w-8 h-8 accent-indigo-500 cursor-pointer" 
                      />
                    </div>
                  </div>

                  <div className={`space-y-8 transition-all relative z-10 ${!settings.useSteelEngine ? 'opacity-25 grayscale pointer-events-none' : ''}`}>
                    
                    {/* Grid for Parameters */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-right">
                      
                      {/* Column 1: Threshold & Weights */}
                      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
                        <h5 className="font-extrabold text-white text-sm border-b border-slate-800 pb-2 flex items-center gap-2 justify-end">
                          مستويات الدقة والاتخاذ
                          <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                        </h5>
                        
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs font-bold text-slate-300">
                            <span>% {settings.steelMinProbability ?? 65}</span>
                            <span>الحد الأدنى للاحتمالية المقبولة</span>
                          </div>
                          <input type="range" min="50" max="95" className="w-full h-1 bg-slate-800 rounded-lg accent-indigo-400" value={settings.steelMinProbability ?? 65} onChange={e => setSettings({...settings, steelMinProbability: parseFloat(e.target.value)})} />
                        </div>

                        <div className="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                          <span className="text-[11px] text-slate-400 font-bold">الأهداف التكيفية المطلقة (Adaptive Targets)</span>
                          <input 
                            type="checkbox" 
                            checked={settings.steelAdaptiveSlTp !== false} 
                            onChange={e => setSettings({...settings, steelAdaptiveSlTp: e.target.checked})} 
                            className="w-5 h-5 accent-indigo-500" 
                          />
                        </div>
                      </div>

                      {/* Column 2: Engine Influence Weights */}
                      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
                        <h5 className="font-extrabold text-white text-sm border-b border-slate-800 pb-2 flex items-center gap-2 justify-end">
                          أوزان وتأثير المحركات الفرعية
                          <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                        </h5>
                        
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs font-bold text-slate-300">
                            <span>{settings.steelInfluenceCreative ?? 0.35}</span>
                            <span>تأثير المحرك الإبداعي (SMC/Structures)</span>
                          </div>
                          <input type="range" min="0.1" max="0.8" step="0.05" className="w-full h-1 bg-slate-800 rounded-lg accent-amber-400" value={settings.steelInfluenceCreative ?? 0.35} onChange={e => setSettings({...settings, steelInfluenceCreative: parseFloat(e.target.value)})} />
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between text-xs font-bold text-slate-300">
                            <span>{settings.steelInfluenceQuantum ?? 0.35}</span>
                            <span>تأثير المحرك الكمي (Volatility/BB)</span>
                          </div>
                          <input type="range" min="0.1" max="0.8" step="0.05" className="w-full h-1 bg-slate-800 rounded-lg accent-purple-500" value={settings.steelInfluenceQuantum ?? 0.35} onChange={e => setSettings({...settings, steelInfluenceQuantum: parseFloat(e.target.value)})} />
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between text-xs font-bold text-slate-300">
                            <span>{settings.steelInfluenceFusion ?? 0.30}</span>
                            <span>تأثير محرك الاندماج والسيولة (Fusion)</span>
                          </div>
                          <input type="range" min="0.1" max="0.8" step="0.05" className="w-full h-1 bg-slate-800 rounded-lg accent-cyan-500" value={settings.steelInfluenceFusion ?? 0.30} onChange={e => setSettings({...settings, steelInfluenceFusion: parseFloat(e.target.value)})} />
                        </div>
                      </div>

                      {/* Column 3: Institutional Gravity Weights */}
                      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
                        <h5 className="font-extrabold text-white text-sm border-b border-slate-800 pb-2 flex items-center gap-2 justify-end">
                          أوزان الجاذبية المؤسساتية لحسم الاتجاه
                          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                        </h5>
                        
                        <div className="grid grid-cols-2 gap-4 text-xs font-bold text-slate-300">
                          <div className="space-y-1">
                            <span>مضرّب حجم الـ Taker</span>
                            <input type="number" step="0.1" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-center text-emerald-400 font-mono" value={settings.steelTakerWeight ?? 1.5} onChange={e => setSettings({...settings, steelTakerWeight: parseFloat(e.target.value)})} />
                          </div>
                          <div className="space-y-1">
                            <span>مضرّب العقود المفتوحة OI</span>
                            <input type="number" step="0.1" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-center text-blue-400 font-mono" value={settings.steelOiWeight ?? 1.2} onChange={e => setSettings({...settings, steelOiWeight: parseFloat(e.target.value)})} />
                          </div>
                          <div className="space-y-1">
                            <span>مضرّب التمويل Funding</span>
                            <input type="number" step="0.1" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-center text-rose-400 font-mono" value={settings.steelFundingWeight ?? 1.0} onChange={e => setSettings({...settings, steelFundingWeight: parseFloat(e.target.value)})} />
                          </div>
                          <div className="space-y-1">
                            <span>مضرّب سيولة الجذب Magnet</span>
                            <input type="number" step="0.1" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-center text-indigo-400 font-mono" value={settings.steelLiquidityWeight ?? 1.3} onChange={e => setSettings({...settings, steelLiquidityWeight: parseFloat(e.target.value)})} />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-slate-400">
                            <span>{settings.steelHtfTrendWeight ?? 1.4}</span>
                            <span>مضرّب ميل الفاصل الأكبر HTF</span>
                          </div>
                          <input type="range" min="0.5" max="3" step="0.1" className="w-full h-1 bg-slate-800 rounded-lg accent-indigo-400" value={settings.steelHtfTrendWeight ?? 1.4} onChange={e => setSettings({...settings, steelHtfTrendWeight: parseFloat(e.target.value)})} />
                        </div>
                      </div>

                    </div>

                    {/* خيار نظام تعظيم الخسارة والربح الأدنى الفولاذي */}
                    <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-rose-500/10 pb-4 gap-2">
                        <div className="flex items-center gap-2">
                          <span className="bg-rose-500/20 text-rose-300 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase">نظام الأبحاث المعكوسة</span>
                        </div>
                        <h5 className="font-extrabold text-white text-sm flex items-center gap-2 justify-end">
                          وضع تعظيم الخسائر الفولاذي والارتداد المعكوس (Max Loss Mode)
                          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse"></span>
                        </h5>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed font-sans mt-2 text-right">
                        صُمم هذا الوضع الثوري لتمكين فحص الأنظمة والمعادلات المعكوسة. بدلاً من جني الأرباح التقليدي وحماية الوقف المبكرة، يقوم النظام العكسي بترك صفقة التداول تسجل أقصى خسارة ممكنة، ويراقب التراجع اللحظي باستمرار، فإذا حصل ارتداد صاعد أو هابط من قاع الخسارة بنسبة محددة يتم تصفية الصفقة فوراً لتجميد الخسارة عند أعلى مستوياتها، طالما يحظر النظام أي أرباح إيجابية متراكمة ويغلقها فور تخطي حد الربح المصغر.
                      </p>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                        <div className="flex items-center justify-between p-4 bg-slate-950/60 rounded-xl border border-slate-800">
                          <input 
                            type="checkbox" 
                            checked={!!settings.steelMaxLossMode} 
                            onChange={e => setSettings({...settings, steelMaxLossMode: e.target.checked})} 
                            className="w-5 h-5 accent-rose-500 cursor-pointer" 
                          />
                          <span className="text-xs text-slate-300 font-bold">تفعيل تعظيم الخسائر المعكوس</span>
                        </div>

                        <div className="bg-slate-950/30 border border-slate-800 p-4 rounded-xl space-y-2 text-right">
                          <div className="flex justify-between text-xs font-bold text-slate-300">
                            <span className="text-rose-400 font-mono">%{(settings.steelReboundSensitivity ?? 0.15).toFixed(2)}</span>
                            <span>مدى ارتداد قاع الخسارة للإغلاق</span>
                          </div>
                          <input 
                            type="range" 
                            min="0.05" 
                            max="1.5" 
                            step="0.05" 
                            className="w-full h-1 bg-slate-800 rounded-lg accent-rose-500" 
                            value={settings.steelReboundSensitivity ?? 0.15} 
                            onChange={e => setSettings({...settings, steelReboundSensitivity: parseFloat(e.target.value)})} 
                          />
                        </div>

                        <div className="bg-slate-950/30 border border-slate-800 p-4 rounded-xl space-y-2 text-right">
                          <div className="flex justify-between text-xs font-bold text-slate-300">
                            <span className="text-emerald-400 font-mono">%{(settings.steelMinProfitTake ?? 0.05).toFixed(2)}</span>
                            <span>الحد الأدنى لجني الأرباح السريع</span>
                          </div>
                          <input 
                            type="range" 
                            min="0.01" 
                            max="0.5" 
                            step="0.01" 
                            className="w-full h-1 bg-slate-800 rounded-lg accent-emerald-500" 
                            value={settings.steelMinProfitTake ?? 0.05} 
                            onChange={e => setSettings({...settings, steelMinProfitTake: parseFloat(e.target.value)})} 
                          />
                        </div>
                      </div>
                    </div>

                    {/* Bilateral Explainer Footnote */}
                    <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-2xl p-4 text-xs text-indigo-450 text-right leading-relaxed font-sans">
                      💡 <strong>التدفق العصبي الفولاذي:</strong> بحال وجود تعارض اتجاهي بين المحركات (مثال: محرك Bollinger يفضل الشراء ومحرك SMC يفضل البيع)، لن يتم تفويت الصفقة أو حدوث تضارب، بل يقوم المحرك بحساب معادلات الاحتمالية الصارمة ودراسة ضغط صانع السوق (Taker Buy/Sell ratio) وسرعة تزايد العقود المفتوحة لتحديد وتسمية الاتجاه بدقة نهائية وحسمه لجهة المنتصر فورا.
                    </div>

                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-8 space-y-6">
                    <div className="flex items-center gap-3 border-b border-slate-800/50 pb-4">
                      <Cpu className="w-5 h-5 text-purple-400" />
                      <h4 className="font-black text-white text-sm uppercase">محرك الدقة الكمي (Quantum Core)</h4>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-slate-800">
                        <span className="text-xs font-bold text-slate-300 tracking-wider">نظام الارتداد (Reversion)</span>
                        <input type="checkbox" checked={settings.quantumUseReversion !== false} onChange={e => setSettings({...settings, quantumUseReversion: e.target.checked})} className="w-6 h-6 accent-emerald-500" />
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-slate-800">
                        <span className="text-xs font-bold text-slate-300 tracking-wider">نظام الزخم (Momentum)</span>
                        <input type="checkbox" checked={settings.quantumUseMomentum !== false} onChange={e => setSettings({...settings, quantumUseMomentum: e.target.checked})} className="w-6 h-6 accent-rose-500" />
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-8 space-y-6 overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-2 opacity-5"><Activity className="w-20 h-20 text-cyan-400 rotate-12" /></div>
                    <div className="flex items-center gap-3 border-b border-slate-800/50 pb-4 justify-between relative z-10">
                      <div className="flex items-center gap-3">
                        <Waves className="w-5 h-5 text-cyan-400" />
                        <h4 className="font-black text-white text-sm uppercase">المحرك الاندماجي (Fusion)</h4>
                      </div>
                      <input type="checkbox" checked={!!settings.useFusionEngine} onChange={e => setSettings({...settings, useFusionEngine: e.target.checked, useCreativeEngine: e.target.checked ? false : settings.useCreativeEngine})} className="w-6 h-6 accent-cyan-500" />
                    </div>
                    <div className={`space-y-4 transition-all relative z-10 ${!settings.useFusionEngine ? 'opacity-20 grayscale pointer-events-none' : ''}`}>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500 font-black uppercase">عتبة التنفيذ الدنيا: {settings.fusionMinScore ?? 70}%</label>
                        <input type="range" min="30" max="95" className="w-full h-1 bg-slate-800 rounded-lg accent-cyan-500" value={settings.fusionMinScore ?? 70} onChange={e => setSettings({...settings, fusionMinScore: parseFloat(e.target.value)})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500 font-black uppercase">حساسية البيانات: {settings.fusionSensitivity ?? 1.0}</label>
                        <input type="range" min="0.1" max="5" step="0.1" className="w-full h-1 bg-slate-800 rounded-lg accent-cyan-500" value={settings.fusionSensitivity ?? 1.0} onChange={e => setSettings({...settings, fusionSensitivity: parseFloat(e.target.value)})} />
                      </div>
                    </div>
                  </div>

                  {/* المحرك الدخول الابداعي (Creative Entry Engine) */}
                  <div className="col-span-1 md:col-span-2 bg-gradient-to-l from-amber-950/20 to-slate-950/50 border border-amber-500/30 rounded-2xl p-8 space-y-6 overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-2 opacity-10"><BrainCircuit className="w-24 h-24 text-amber-500 rotate-12" /></div>
                    
                    <div className="flex items-center justify-between border-b border-amber-500/20 pb-4 relative z-10">
                      <div className="flex items-center gap-3">
                        <BrainCircuit className="w-6 h-6 text-amber-500 animate-pulse" />
                        <div className="text-right">
                          <h4 className="font-black text-amber-400 text-base uppercase">المحرك الدخول الابداعي (Creative Engine)</h4>
                          <p className="text-[10px] text-slate-400 mt-1 font-sans">محرك استراتيجي ذكي مستقل مبني بالكامل على هيكلية السيولة وقراءة تلاعبات الأسواق وحركة المال الذكي (SMC)</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {settings.useCreativeEngine && (
                          <span className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-1 rounded font-black animate-pulse">SOLO MODE ACTIVE</span>
                        )}
                        <input 
                          type="checkbox" 
                          checked={!!settings.useCreativeEngine} 
                          onChange={e => {
                            const isChecked = e.target.checked;
                            setSettings({
                              ...settings, 
                              useCreativeEngine: isChecked,
                              useFusionEngine: isChecked ? false : settings.useFusionEngine
                            });
                          }} 
                          className="w-7 h-7 accent-amber-500 cursor-pointer" 
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10 text-right">
                      {/* Section 1: Playbooks */}
                      <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-2">
                        <div className="flex items-center gap-2 font-bold text-xs text-white justify-end">
                          دليل الصفقات الذكية (Smart Playbooks)
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                          يحتوي على نماذج دخول مستقلة دقيقة تتوافق تلقائياً مع نظام السوق المكتشف مثل الكسر الحقيقي، نطاقات التجميع، والمصائد.
                        </p>
                      </div>

                      {/* Section 2: Rejection Checks */}
                      <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-2">
                        <div className="flex items-center gap-2 font-bold text-xs text-white justify-end">
                          فحص الفخاخ ورفض الاختراقات
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                          يتتبع تدفقات سيول الأسواق الحقيقية ومستويات الفائدة المفتوحة (OI) لتجاوز فخاخ الثيران والدببة وتجمعات عقود التجميع.
                        </p>
                      </div>

                      {/* Section 3: Candle Confirmation */}
                      <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-2">
                        <div className="flex items-center gap-2 font-bold text-xs text-white justify-end">
                          التأكيد الهيكلي لذيول الشموع
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                          يبحث عن إثباتات واضحة على ذيول الرفض وضغط التجاوز قبل إعطاء الإذن النهائي بالدخول الفعلي لمنع أي ارتدادات مباغتة.
                        </p>
                      </div>
                    </div>
                    
                    {/* خيار الخروج التكيفي للصفقات الإبداعية */}
                    <div className="flex items-center justify-between p-4 bg-slate-900/60 rounded-xl border border-amber-500/20 relative z-10 text-right">
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-amber-400">توجيه الصفقات الإبداعية للخروج التكيفي (Creative Adaptive Exit)</span>
                        <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                          عند تفعيل هذا الخيار، سيتم تسليم صفقات المحرك الإبداعي بمجرد دخولها لنظام الخروج التكيفي المتسلسل (Adaptive Exit Cascade) بدلاً من استراتيجية الخروج الافتراضية الخاصة بالمحرك الإبداعي لتأمين ونحت الأرباح كلياً في الأوقات الارتدادية.
                        </p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={!!settings.creativeUseAdaptiveExit} 
                        onChange={e => setSettings({...settings, creativeUseAdaptiveExit: e.target.checked})} 
                        className="w-6 h-6 accent-amber-500 cursor-pointer shrink-0 ml-4" 
                      />
                    </div>

                    {/* خيار إلغاء حماية الخسائر المتتالية */}
                    <div className="flex items-center justify-between p-4 bg-slate-900/60 rounded-xl border border-amber-500/20 relative z-10 text-right">
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-amber-400">إلغاء حماية الخسائر المتتالية (Disable Consecutive Loss Protection)</span>
                        <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                          عند تفعيل هذا الخيار، سيتم تعطيل حماية الحد من المخاطر للمحرك الإبداعي التي تحظر فتح الصفقات تلقائياً عند تتابع الخسائر للوصول للاستمرارية التوليدية للإشارات.
                        </p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={!!settings.disableConsecutiveLoss} 
                        onChange={e => setSettings({...settings, disableConsecutiveLoss: e.target.checked})} 
                        className="w-6 h-6 accent-amber-500 cursor-pointer shrink-0 ml-4" 
                      />
                    </div>

                    {settings.useCreativeEngine && (
                      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-xs text-amber-300 relative z-10 text-right font-sans">
                        💡 <strong>ملاحظة التوافق المستقل:</strong> تم تفعيل محرك الدخول الإبداعي في <strong>الوضع الفردي الحصري (Solo Mode)</strong>. تم إلغاء تفعيل المحركات الأخرى (Quantum Core و Fusion Engine) احترازاً وتحت إدارته المستقلة لمنع أي تضارب مالي أو تقني.
                      </div>
                    )}
                  </div>

                </div>
              </div>
            )}

            {/* 4. Exit Armor */}
            {activeTab === 'exit' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in slide-in-from-left-4 duration-300 text-right">
                <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-8 space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-800/50 pb-4">
                    <div className="flex items-center gap-3">
                      <ArrowUpRight className="w-5 h-5 text-cyan-400" />
                      <h4 className="font-black text-white text-sm uppercase">الملاحقة الحركية (Kinetic)</h4>
                    </div>
                    <input type="checkbox" checked={!!settings.useKineticEngine} onChange={e => setSettings({...settings, useKineticEngine: e.target.checked})} className="w-6 h-6 accent-cyan-500" />
                  </div>
                  <div className={`space-y-4 transition-all ${!settings.useKineticEngine ? 'opacity-20 grayscale-0 pointer-events-none' : ''}`}>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 font-black uppercase">بدء التتبع (بعد ربح $)</label>
                      <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-cyan-400 font-mono text-sm text-left" value={settings.smartTrailingStartUsd ?? 0.4} onChange={e => setSettings({...settings, smartTrailingStartUsd: parseFloat(e.target.value)})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 font-black uppercase">مرونة التتبع (Rubber Band %)</label>
                      <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-cyan-400 font-mono text-sm text-left" value={settings.smartTrailingThresholdPerc ?? 0.3} onChange={e => setSettings({...settings, smartTrailingThresholdPerc: parseFloat(e.target.value)})} />
                    </div>
                  </div>
                </div>

                <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-8 space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-800/50 pb-4">
                    <div className="flex items-center gap-3">
                      <RefreshCw className="w-5 h-5 text-rose-400" />
                      <h4 className="font-black text-white text-sm uppercase">الحماية المعكوسة (Inverse)</h4>
                    </div>
                    <input type="checkbox" checked={!!settings.inverseTrailingEnabled} onChange={e => setSettings({...settings, inverseTrailingEnabled: e.target.checked})} className="w-6 h-6 accent-rose-500" />
                  </div>
                  <div className={`space-y-4 transition-all ${!settings.inverseTrailingEnabled ? 'opacity-20 pointer-events-none' : ''}`}>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-500 font-black uppercase">حساسية الارتداد العكسي %</label>
                      <input type="number" step="0.005" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-rose-400 font-mono text-sm text-left" value={settings.inverseTrailingSensitivity ?? 0.05} onChange={e => setSettings({...settings, inverseTrailingSensitivity: parseFloat(e.target.value)})} />
                    </div>
                    <p className="text-[9px] text-slate-500 italic p-3 bg-rose-500/5 border border-rose-500/10 rounded-xl">يعمل هذا النظام كغطاء أمني لإغلاق الصفقة فور تغير الزخم المؤسساتي.</p>
                  </div>
                </div>

                <div className="md:col-span-2 bg-slate-950/50 border border-slate-800 rounded-2xl p-8 space-y-8">
                   <div className="flex items-center justify-between border-b border-slate-800/50 pb-4">
                      <div className="flex items-center gap-3">
                         <ShieldAlert className="w-5 h-5 text-indigo-400" />
                         <h4 className="font-black text-white text-sm uppercase">نظام الخروج التكيفي (Adaptive Exit Cascade)</h4>
                      </div>
                      <select 
                        className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs font-black text-indigo-400 outline-none focus:border-indigo-500"
                        value={settings.exitValidationMode ?? 'ADAPTIVE_CASCADE'}
                        onChange={e => setSettings({...settings, exitValidationMode: e.target.value})}
                      >
                        <option value="QUANTUM_ONLY">Quantum Only (ارتداد فقط)</option>
                        <option value="FUSION_PRIORITY">Fusion Priority (أولوية السيولة)</option>
                        <option value="MOMENTUM_ASSISTED">Momentum Assisted (دعم الزخم)</option>
                        <option value="FULL_CONSENSUS">Full Consensus (إجماع كامل)</option>
                        <option value="ADAPTIVE_CASCADE">Adaptive Cascade (التسلسل التكيفي - الأفضل)</option>
                      </select>
                   </div>

                   <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-2xl border border-slate-800">
                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase">1. فحص الانعكاس</span>
                          <p className="text-[8px] text-slate-500">Quantum Reversion</p>
                        </div>
                        <input type="checkbox" checked={settings.exitUseQuantumCheck !== false} onChange={e => setSettings({...settings, exitUseQuantumCheck: e.target.checked})} className="w-5 h-5 accent-emerald-500" />
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-2xl border border-slate-800">
                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase">2. فحص السيولة</span>
                          <p className="text-[8px] text-slate-500">Fusion Engine</p>
                        </div>
                        <input type="checkbox" checked={settings.exitUseFusionCheck !== false} onChange={e => setSettings({...settings, exitUseFusionCheck: e.target.checked})} className="w-5 h-5 accent-cyan-500" />
                      </div>
                      <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-2xl border border-slate-800">
                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase">3. فحص الزخم</span>
                          <p className="text-[8px] text-slate-500">Momentum Node</p>
                        </div>
                        <input type="checkbox" checked={settings.exitUseMomentumCheck !== false} onChange={e => setSettings({...settings, exitUseMomentumCheck: e.target.checked})} className="w-5 h-5 accent-rose-500" />
                       </div>
                       <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-2xl border border-slate-800">
                         <div className="space-y-1 text-right">
                           <span className="text-[10px] font-black text-slate-400 uppercase">4. فحص الزخم (RSI)</span>
                           <p className="text-[8px] text-slate-500 font-medium">RSI Check</p>
                         </div>
                         <input type="checkbox" checked={settings.exitUseRsiCheck !== false} onChange={e => setSettings({...settings, exitUseRsiCheck: e.target.checked})} className="w-5 h-5 accent-amber-500" />
                      </div>
                   </div>

                   <div className="space-y-3 pt-4 border-t border-slate-800/50">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] text-slate-400 font-black uppercase">حساسية الخروج التكيفي (Aggression): {settings.exitAdaptiveAggression ?? 0.8}</label>
                        <span className="text-[9px] text-slate-600 bg-slate-950 px-2 py-0.5 rounded italic">كلما زادت القيمة، زادت احتمالية "الاستمرار" في الصفقة</span>
                      </div>
                      <input 
                        type="range" min="0.1" max="1" step="0.05" 
                        className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" 
                        value={settings.exitAdaptiveAggression ?? 0.8} 
                        onChange={e => setSettings({...settings, exitAdaptiveAggression: parseFloat(e.target.value)})} 
                      />
                   </div>

                   <div className="flex items-center justify-between p-5 bg-slate-900/60 border border-slate-800 rounded-2xl">
                      <div className="space-y-1">
                        <h4 className="text-sm font-black text-rose-450 uppercase">مخرج الأمان الديناميكي (Dynamic Safety Exit) 🛡️</h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed max-w-sm">
                          عند التفعيل، يتدخل النظام لتصفية المركز فوراً إذا رصد ضعفاً ديناميكياً حاداً وتراجعاً في مؤشر قوة الاتجاه (ADX) أو انعكاساً في مؤشر الزخم (RSI / EMA Trend).
                        </p>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <input 
                          type="checkbox" 
                          checked={settings.dynamicSafetyExit !== false} 
                          onChange={e => setSettings({...settings, dynamicSafetyExit: e.target.checked})} 
                          className="w-10 h-10 accent-rose-600 cursor-pointer" 
                        />
                        <span className="text-[8px] font-black text-rose-500">{settings.dynamicSafetyExit !== false ? 'مخرج أمان نَشِط' : 'مخرج أمان مُعطّل'}</span>
                      </div>
                   </div>

                   <div className="flex items-center justify-between p-5 bg-indigo-500/5 border border-indigo-500/20 rounded-2xl animate-pulse shadow-lg shadow-indigo-500/5">
                      <div className="space-y-1">
                        <h4 className="text-sm font-black text-indigo-400 uppercase">الهيمنة التكيفية (Adaptive Dominance)</h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed max-w-sm">
                          عند التفعيل، سيتم منح محرك الاندماج والزخم الصلاحية الكاملة لتجاوز الستوب لوس التقليدي (SL) والأهداف (TP) إذا كان الزخم المؤسساتي لا يزال قوياً.
                        </p>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <input 
                          type="checkbox" 
                          checked={!!settings.overrideAllWithAdaptive} 
                          onChange={e => setSettings({...settings, overrideAllWithAdaptive: e.target.checked})} 
                          className="w-10 h-10 accent-indigo-600 cursor-pointer" 
                        />
                        <span className="text-[8px] font-black text-indigo-500">{settings.overrideAllWithAdaptive ? 'نظام مُهيمن نَشِط' : 'نظام تابع'}</span>
                      </div>
                   </div>

                   <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6 border-t border-slate-800/50">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500 font-black uppercase tracking-tighter">مضاعف الربح (TP)</label>
                        <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-emerald-400 font-mono text-sm text-left" value={settings.quantumTpScale ?? 1.5} onChange={e => setSettings({...settings, quantumTpScale: parseFloat(e.target.value)})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500 font-black uppercase tracking-tighter">مضاعف الخسارة (SL)</label>
                        <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-rose-400 font-mono text-sm text-left" value={settings.quantumSlScale ?? 1.0} onChange={e => setSettings({...settings, quantumSlScale: parseFloat(e.target.value)})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-500 font-black uppercase tracking-tighter">أدنى ربح للتأمين ($)</label>
                        <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-blue-400 font-mono text-sm text-left" value={settings.smartTpUsd ?? 1.5} onChange={e => setSettings({...settings, smartTpUsd: parseFloat(e.target.value)})} />
                      </div>
                   </div>
                </div>

                {/* 🦅 Savage & Fierce Exit Engine (محرك الخروج الشرس المستقل) */}
                <div className="md:col-span-2 bg-gradient-to-l from-slate-950 via-slate-900/40 to-amber-950/20 border border-amber-500/30 rounded-2xl p-8 space-y-6 text-right">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                    <div className="flex items-center gap-3">
                      <Flame className="w-6 h-6 text-amber-500 animate-pulse animate-duration-1000" />
                      <div className="text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <span className="bg-amber-500 text-slate-955 text-[9px] font-black px-1.5 py-0.5 rounded-full">محرك مستقل فائق القوة</span>
                          <h4 className="font-black text-white text-sm uppercase">محرك الخروج الشرس (Fierce & Savage Exit Engine)</h4>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">تأمين مجهري مستميت وحماية لحظية للمكاسب متطابقة مع آلية الخروج في التوليفة</p>
                      </div>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={!!settings.useFierceExitEngine} 
                      onChange={e => setSettings({...settings, useFierceExitEngine: e.target.checked})} 
                      className="w-6 h-6 accent-amber-500 cursor-pointer" 
                    />
                  </div>

                  <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 transition-all duration-305 ${!settings.useFierceExitEngine ? 'opacity-20 grayscale pointer-events-none' : ''}`}>
                    <div className="space-y-2 text-right">
                      <label className="text-[10px] text-amber-400 font-black uppercase">وضعية ملاحقة السقف وجني الأرباح (Exit Mode)</label>
                      <select 
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs font-black text-amber-300 outline-none focus:border-amber-500 text-right"
                        value={settings.fierceTakeProfitMode ?? 'FUSION_CASCADE'}
                        onChange={e => setSettings({...settings, fierceTakeProfitMode: e.target.value as any})}
                      >
                        <option value="FUSION_CASCADE">FUSION_CASCADE (التسييل التراكمي وتأمين الدخول الصارم)</option>
                        <option value="TRAILING_MOMENTUM">TRAILING_MOMENTUM (ملاحقة الزخم ومطاردة السقوف والقمم)</option>
                      </select>
                      <p className="text-[9px] text-slate-500 mt-1">
                        {settings.fierceTakeProfitMode === 'FUSION_CASCADE' 
                          ? 'تسييل مجهري تدريجي للمراكز بمعدل 0.15% لكل صعود، مع سحب الاستوب لوس فوراً لتأمين تكاليف التداول ومنع الخسائر.' 
                          : 'المطاردة اللحظية لقمة السلوك السعري، وتوفير مرونة بمجرد استنفاد الزخم بالكامل للتصفية في الأعلى.'
                        }
                      </p>
                    </div>

                    <div className="space-y-2 text-right">
                      <label className="text-[10px] text-amber-400 font-black uppercase">الهدف المرجو لجني الأرباح الشرس (Take Profit %): {settings.fierceTakeProfitValue ?? 1.5}%</label>
                      <div className="flex items-center gap-4">
                        <input 
                          type="range" min="0.3" max="5.0" step="0.1" 
                          className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500" 
                          value={settings.fierceTakeProfitValue ?? 1.5} 
                          onChange={e => setSettings({...settings, fierceTakeProfitValue: parseFloat(e.target.value)})} 
                        />
                        <span className="font-mono text-sm text-amber-400 font-bold">{settings.fierceTakeProfitValue ?? 1.5}%</span>
                      </div>
                      <p className="text-[9px] text-slate-500 font-black tracking-tight mt-1">يمثل الحد الأدنى لتفعيل التسييل المتتابع أو بداية التتبع اللحظي الذكي.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 4.5. Beast Mode AI (الوحش الذكي) */}
            {activeTab === 'beast' && (
              <div className="space-y-10 animate-in slide-in-from-left-4 duration-300 text-right">
                
                {/* Main Hero Card for Beast Mode */}
                <div className="bg-gradient-to-l from-slate-900 via-slate-950 to-rose-950/40 border-2 border-rose-500/50 rounded-3xl p-8 space-y-8 overflow-hidden relative shadow-[0_0_30px_rgba(244,63,94,0.15)]">
                  <div className="absolute top-0 right-0 p-2 opacity-5"><Skull className="w-40 h-40 text-rose-500 rotate-12" /></div>
                  
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-rose-500/20 pb-6 relative z-10 gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-rose-500/10 rounded-2xl border border-rose-500/30 text-rose-400">
                        <Flame className="w-8 h-8 animate-pulse text-rose-500" />
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2">
                          <span className="bg-rose-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">نظام الذكاء الهجومي</span>
                           <h4 className="font-black text-rose-350 text-xl">نظام الوحش المدمّر والمخترق الرياضي (Beast Mode AI)</h4>
                        </div>
                        <p className="text-xs text-slate-400 mt-2 font-sans max-w-2xl">
                          محرك عصبوني قائم على اقتناص الانحرافات العنيفة، استغلال انزلاقات السيولة وضرب استوبات الجمهور. يعمل الوحش بكامل طاقته التشغيلية بتوجيه ذكي من مصفوفات التحليل لتنفيذ مراكز استباقية سريعة بنسب كفاءة عالية ومخاطر مضبوطة.
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 self-end md:self-center ml-0 mr-auto">
                      {settings.beastMode && (
                        <span className="text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30 px-3 py-1.5 rounded-xl font-bold animate-pulse">BEAST_ENGINE_ACTIVE 🐺</span>
                      )}
                      <input 
                         type="checkbox" 
                         checked={!!settings.beastMode} 
                         onChange={e => setSettings({...settings, beastMode: e.target.checked})} 
                         className="w-8 h-8 accent-rose-500 cursor-pointer" 
                      />
                    </div>
                  </div>

                  {/* Sub cards details */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-2">
                      <div className="flex items-center gap-2 font-bold text-xs text-white justify-end">
                        صيد التذبذبات الشاذة
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                        يبحث بشكل متسارع عن الحركات غير الطبيعية وعشوائيات الشارت لاقتناص اللحظات التذبذبية بدقة متناهية.
                      </p>
                    </div>

                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-2">
                      <div className="flex items-center gap-2 font-bold text-xs text-white justify-end">
                        التفوق على انزلاق الأسعار
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                        يتعامل مع فخاخ صناع السوق وتدفقات السيولة السائبة لضمان أفضل سعر تنفيذ وتفادي انزلاقات الاستوبات.
                      </p>
                    </div>

                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-2">
                      <div className="flex items-center gap-2 font-bold text-xs text-white justify-end">
                        تحسين المعامل الفوري
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-relaxed font-sans">
                        عبر التقييم الرياضي لمعدلات مبيعات ومشتريات الماركت (CVD) وضغوط حيتان المنصة.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Section 1: المفاتيح الهجومية للعمليات الخاطفة */}
                <div className="bg-slate-950/40 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6">
                  <h3 className="text-lg font-black text-white flex items-center gap-2 border-b border-slate-800 pb-4">
                    <Zap className="w-5 h-5 text-rose-500" />
                    المفاتيح الهجومية للعمليات الخاطفة
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Nightmare Mode Toggle */}
                    <div className="flex items-center justify-between p-5 bg-slate-900/60 border border-slate-800 rounded-2xl">
                      <div className="space-y-1 pl-4">
                        <h4 className="text-sm font-black text-rose-450">وضع الكابوس المدمر (Nightmare Mode) 🔥</h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                          نهج مضاعف العدوانية للغاية. يركز على تفتيت مستويات الدعم والمقاومة واختراق حواجز التداول دون انتظار تراجع هادئ.
                        </p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={!!settings.isNightmareMode} 
                        onChange={e => setSettings({...settings, isNightmareMode: e.target.checked})} 
                        className="w-6 h-6 accent-rose-600 cursor-pointer shrink-0" 
                      />
                    </div>

                    {/* Slippage & Trap Exploit Toggle */}
                    <div className="flex items-center justify-between p-5 bg-slate-900/60 border border-slate-800 rounded-2xl">
                      <div className="space-y-1 pl-4">
                        <h4 className="text-sm font-black text-rose-450">استغلال انزلاق السيولة وفخاخ التسييل 🛡️</h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                          تحديد مستويات تسييل الجمهور والأوردر بلوك الهابطة لضرب مراكز قصيرة/طويلة معاكسة بسرعة البرق.
                        </p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={!!settings.beastSlippageExploit} 
                        onChange={e => setSettings({...settings, beastSlippageExploit: e.target.checked})} 
                        className="w-6 h-6 accent-rose-600 cursor-pointer shrink-0" 
                      />
                    </div>

                    {/* Low Cap Hunting Toggle */}
                    <div className="flex items-center justify-between p-5 bg-slate-900/60 border border-slate-800 rounded-2xl">
                      <div className="space-y-1 pl-4">
                        <h4 className="text-sm font-black text-rose-450">صيد الأصول ضعيفة السيولة (Low Cap Scavenger) 🪙</h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                          السماح بمسح العملات ذات القيمة السوقية المنخفضة ورصد حركات المضاربة الحادة واشتقاق الأرباح من طفراتها.
                        </p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={!!settings.beastLowCapHunting} 
                        onChange={e => setSettings({...settings, beastLowCapHunting: e.target.checked})} 
                        className="w-6 h-6 accent-rose-600 cursor-pointer shrink-0" 
                      />
                    </div>

                    {/* Auto Adapt Toggle */}
                    <div className="flex items-center justify-between p-5 bg-slate-900/60 border border-slate-800 rounded-2xl">
                      <div className="space-y-1 pl-4">
                        <h4 className="text-sm font-black text-rose-450">المعايرة الذاتية المستمرة للاعدادات 🧠</h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                          يقوم الذكاء الاصطناعي بدراسة نتائج الصفقات التاريخية لضبط معامل العنف وفترات الحيازة ذاتياً دون تدخل يدوي.
                        </p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={!!settings.beastAutoAdapt} 
                        onChange={e => setSettings({...settings, beastAutoAdapt: e.target.checked})} 
                        className="w-6 h-6 accent-rose-600 cursor-pointer shrink-0" 
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: مرشحات وفلاتر الحماية المؤسساتية للوحش */}
                <div className="bg-slate-950/40 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6">
                  <h3 className="text-lg font-black text-white flex items-center gap-2 border-b border-slate-800 pb-4">
                    <ShieldCheck className="w-5 h-5 text-rose-500" />
                    مرشحات وفلاتر الحماية المؤسساتية للوحش
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* SMC Confirmation Toggle */}
                    <div className="flex items-center justify-between p-5 bg-slate-900/60 border border-slate-800 rounded-2xl">
                      <div className="space-y-1 pl-4">
                        <h4 className="text-sm font-black text-emerald-400">تأكيد هيكل السوق المؤسساتي (SMC Structure) 🏛️</h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                          يمنع الاستباق المتهور عبر فرض مطابقة شروط هيكل السوق الذكي لكشف قمم/قيعان حقيقية وتأكيد رغبة صناع السوق.
                        </p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={!!settings.beastConfirmWithSMC} 
                        onChange={e => setSettings({...settings, beastConfirmWithSMC: e.target.checked})} 
                        className="w-6 h-6 accent-emerald-600 cursor-pointer shrink-0" 
                      />
                    </div>

                    {/* Volume Confirmation Toggle */}
                    <div className="flex items-center justify-between p-5 bg-slate-900/60 border border-slate-800 rounded-2xl">
                      <div className="space-y-1 pl-4">
                        <h4 className="text-sm font-black text-emerald-400">بوابة فلترة وقوة زخم السيولة (RVOL Gate) 📊</h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                          تعطيل الدخول في وضع الراحة أو التذبذب الضعيف، لضمان مرافقة الشموع ذات الأحجام الضخمة والشرارة الحية.
                        </p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={!!settings.beastConfirmWithVolume} 
                        onChange={e => setSettings({...settings, beastConfirmWithVolume: e.target.checked})} 
                        className="w-6 h-6 accent-emerald-600 cursor-pointer shrink-0" 
                      />
                    </div>
                  </div>
                </div>

                {/* Section 3: المكونات والمعايرة الحركية الدقيقة للوحش */}
                <div className="bg-slate-950/40 border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6">
                  <h3 className="text-lg font-black text-white flex items-center gap-2 border-b border-slate-800 pb-4">
                    <Gauge className="w-5 h-5 text-rose-500" />
                    المكونات والمعايرة الحركية الدقيقة للاستباق والتعلم
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {/* Beast Learn Rate */}
                    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-3">
                      <label className="text-[10px] text-slate-500 font-black uppercase">معدل التعلم من الخسائر (%)</label>
                      <input 
                        type="number" 
                        step="1" 
                        min="1" 
                        max="100" 
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-rose-450 font-mono text-left" 
                        value={settings.beastLearnRate ?? 50} 
                        onChange={e => setSettings({...settings, beastLearnRate: parseInt(e.target.value)})} 
                      />
                      <p className="text-[8px] text-slate-500">حساسية معالجة النتائج السلبية لترميم العتبات لامتصاص الخسائر.</p>
                    </div>

                    {/* Beast Institutional Strength */}
                    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-3">
                      <label className="text-[10px] text-slate-500 font-black uppercase">القوة المؤسساتية المطلوبة (0.1 - 1.0)</label>
                      <input 
                        type="number" 
                        step="0.05" 
                        min="0.1" 
                        max="1.0" 
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-rose-450 font-mono text-left" 
                        value={settings.beastInstitutionalStrength ?? 0.4} 
                        onChange={e => setSettings({...settings, beastInstitutionalStrength: parseFloat(e.target.value)})} 
                      />
                      <p className="text-[8px] text-slate-500">معدل فارق الماركت الصافي وسيطرة التيكر المطلوبة لبدء الإطلاق.</p>
                    </div>

                    {/* Beast Min RVOL */}
                    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-3">
                      <label className="text-[10px] text-slate-500 font-black uppercase">أدنى حجم إطلاق نسبي (RVOL)</label>
                      <input 
                        type="number" 
                        step="0.1" 
                        min="0.5" 
                        max="5.0" 
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-rose-450 font-mono text-left" 
                        value={settings.beastMinRvol ?? 1.2} 
                        onChange={e => setSettings({...settings, beastMinRvol: parseFloat(e.target.value)})} 
                      />
                      <p className="text-[8px] text-slate-500">تضاعف الحجم الحالي مقابل المتوسط التاريخي لإعطاء الإذن.</p>
                    </div>

                    {/* Quantum Beast Aggression */}
                    <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-5 space-y-3">
                      <label className="text-[10px] text-slate-500 font-black uppercase">عدوانية وحش الكم (1.0 - 2.0)</label>
                      <input 
                        type="number" 
                        step="0.1" 
                        min="1.0" 
                        max="2.0" 
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-rose-450 font-mono text-left" 
                        value={settings.quantumBeastAggression ?? 1.5} 
                        onChange={e => setSettings({...settings, quantumBeastAggression: parseFloat(e.target.value)})} 
                      />
                      <p className="text-[8px] text-slate-500">مضاعف الحركية لملاحقة واستهداف الصفقات بنطاق كمي متناهي الصغر.</p>
                    </div>
                  </div>

                  {/* Quantum Beast Toggle inside calibration */}
                  <div className="flex items-center justify-between p-5 bg-slate-900/60 border border-slate-800 rounded-2xl mt-4">
                    <div className="space-y-1 pl-4">
                      <h4 className="text-sm font-black text-rose-450">التكامل الفائق لنسب وحش الكم (Quantum Beast Aggressive Tuning) 🌀</h4>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        عند التفيعل، سيقوم المحرك الإحصائي بتسريع الاستشعارات وتجاوز عوائق حيادية السوق لتعزيز الصفقات في الاتجاهات الفورية المشتعلة.
                      </p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={!!settings.quantumBeastMode} 
                      onChange={e => setSettings({...settings, quantumBeastMode: e.target.checked})} 
                      className="w-6 h-6 accent-rose-600 cursor-pointer shrink-0" 
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 5. Technical Tuning */}
            {activeTab === 'tuning' && (
              <div className="space-y-10 animate-in slide-in-from-left-4 duration-300 text-right">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 space-y-4">
                    <label className="text-[10px] text-slate-500 font-black uppercase">عتبة تيكر LONG</label>
                    <input type="number" step="0.01" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-emerald-400 font-mono text-left" value={settings.quantumTakerLongThresh ?? 1.05} onChange={e => setSettings({...settings, quantumTakerLongThresh: parseFloat(e.target.value)})} />
                  </div>
                  <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 space-y-4">
                    <label className="text-[10px] text-slate-500 font-black uppercase">عتبة تيكر SHORT</label>
                    <input type="number" step="0.01" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-rose-400 font-mono text-left" value={settings.quantumTakerShortThresh ?? 0.95} onChange={e => setSettings({...settings, quantumTakerShortThresh: parseFloat(e.target.value)})} />
                  </div>
                  <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 space-y-4">
                    <label className="text-[10px] text-slate-500 font-black uppercase">مضاعف البولنجر (BB)</label>
                    <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-purple-400 font-mono text-left" value={settings.quantumBbMultiplier ?? 2.0} onChange={e => setSettings({...settings, quantumBbMultiplier: parseFloat(e.target.value)})} />
                  </div>
                </div>

                <div className="bg-slate-900/50 border border-dashed border-slate-800 rounded-3xl p-10 flex flex-col items-center justify-center space-y-6">
                   <div className="p-4 bg-amber-500/10 rounded-full"><AlertTriangle className="w-8 h-8 text-amber-500" /></div>
                   <div className="text-center space-y-2">
                      <h4 className="text-xl font-black text-white">منطقة الصيانة العميقة</h4>
                      <p className="text-slate-500 text-sm">مسح البيانات التاريخية وإعادة ضبط محركات التداول.</p>
                   </div>
                   <div className="flex gap-4">
                     {!showResetConfirm ? (
                       <button type="button" onClick={() => setShowResetConfirm(true)} className="px-10 py-4 bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white border border-rose-500/20 rounded-2xl font-black transition-all">مسح سجل التداول بالكامل</button>
                     ) : (
                       <div className="flex items-center gap-3 animate-in zoom-in-95">
                         <button type="button" onClick={() => setShowResetConfirm(false)} className="px-6 py-3 bg-slate-800 text-slate-400 rounded-xl font-bold">إلغاء</button>
                         <button type="button" onClick={handleResetDB} className="px-8 py-3 bg-rose-600 text-white rounded-xl font-black shadow-lg shadow-rose-900/40">تأكيد المسح النهائي</button>
                       </div>
                     )}
                   </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Global Save Button */}
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-6">
          <button
            type="submit"
            disabled={savingSettings}
            className="w-full py-5 bg-emerald-500 hover:bg-emerald-400 text-white rounded-3xl font-black text-xl shadow-[0_20px_50px_-15px_rgba(16,185,129,0.5)] flex items-center justify-center gap-4 transition-all active:scale-95 disabled:opacity-50"
          >
            {savingSettings ? <RefreshCw className="animate-spin w-6 h-6" /> : <ShieldCheck className="w-6 h-6" />}
            حفظ وتطبيق الإعدادات الفورية
          </button>
        </div>
      </form>
    </div>
  );
}

