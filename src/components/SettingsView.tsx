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
  const [activeTab, setActiveTab] = React.useState<'account' | 'risk' | 'entry' | 'exit' | 'tuning'>('account');
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

               <div className="space-y-3">
                  <label className="text-slate-300 text-sm font-bold flex items-center gap-2">
                     الحد الأدنى لحجم الصفقة <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-500">Min Allocation %</span>
                  </label>
                  <div className="relative">
                     <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">%</span>
                     <input type="number" step="1" required min="1" max="100" className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-10 py-4 text-emerald-400 font-mono focus:border-emerald-500 outline-none transition-all text-left text-lg" dir="ltr" value={settings.minPositionSizePerc ?? 20} onChange={e => setSettings({...settings, minPositionSizePerc: parseFloat(e.target.value)})} />
                  </div>
                  <p className="text-[10px] text-slate-500 italic">يضمن ألا يقل حجم الصفقة عن هذه النسبة من رأس المال مهما كانت درجة المخاطرة.</p>
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
                      <input type="checkbox" checked={settings.useFusionEngine} onChange={e => setSettings({...settings, useFusionEngine: e.target.checked})} className="w-6 h-6 accent-cyan-500" />
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
                    <input type="checkbox" checked={settings.useKineticEngine} onChange={e => setSettings({...settings, useKineticEngine: e.target.checked})} className="w-6 h-6 accent-cyan-500" />
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
                    <input type="checkbox" checked={settings.inverseTrailingEnabled} onChange={e => setSettings({...settings, inverseTrailingEnabled: e.target.checked})} className="w-6 h-6 accent-rose-500" />
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

                   <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

