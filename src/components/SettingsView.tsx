import React from 'react';
import { 
  Settings, Zap, ShieldCheck, Wallet, RefreshCw, BrainCircuit, ArrowUpRight, Cpu, Key, Trash2,
  ChevronDown, ChevronUp, Gauge, History, BarChart3, Activity, Flame, Shield, Skull
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
  const [showAdvancedQuantum, setShowAdvancedQuantum] = React.useState(false);

  const handleResetDB = async () => {
    setResetting(true);
    try {
      const response = await fetch('/api/utils/reset-db', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        alert('تم مسح قاعدة البيانات بنجاح.');
        setShowResetConfirm(false);
        // Refresh page to clear local history in UI
        window.location.reload();
      } else {
        alert('فشل المسح: ' + data.message);
      }
    } catch (e: any) {
      alert('خطأ في الاتصال: ' + e.message);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-12 animate-in fade-in duration-700 pb-40">
      
      {/* 1. Header & Mission Description */}
      <div className="text-center space-y-4 pt-6">
         <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-widest mb-2">
            Quantum Scalping Engine V1.0 (True Edge)
         </div>
         <h1 className="text-4xl md:text-5xl font-black text-white flex justify-center items-center gap-4">
             <BrainCircuit className="w-12 h-12 text-emerald-400 animate-pulse" />
             النظام الكمي السريع (الاسكالبنج المؤسساتي)
         </h1>
         <p className="text-slate-400 max-w-3xl mx-auto text-base md:text-lg leading-relaxed">
            تم إلغاء كل تعقيدات النظام القديم والطبقات البطيئة بناءً على طلبك. النظام الآن يبحث عن فرص حقيقية وفروق أسعار فورية على فريم (1 دقيقة) لدخول صفقات سريعة وكثيرة مستنداً على 
            الانحراف المعياري (Bollinger Bands) وضغط الشراء (Taker Ratio).
         </p>
      </div>

      <form onSubmit={saveSettings} className="space-y-12">
         
         {/* 0. Binance Live Connection */}
         <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-8 md:p-10 shadow-2xl relative overflow-hidden">
            <div className={`absolute inset-0 bg-rose-500/5 pointer-events-none transition-opacity ${settings.tradingMode === 'LIVE' ? 'opacity-100' : 'opacity-0'}`}></div>
            <div className="flex items-center justify-between mb-10 border-b border-slate-800 pb-6 relative z-10">
               <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-2xl transition-all ${settings.tradingMode === 'LIVE' ? 'bg-rose-500/20' : 'bg-slate-800'}`}><Key className={`w-7 h-7 ${settings.tradingMode === 'LIVE' ? 'text-rose-400' : 'text-slate-400'}`} /></div>
               <div>
                  <h2 className="text-2xl font-black text-white">ربط منصة بايننس (Binance Live)</h2>
                  <div className="flex items-center gap-2 mt-1">
                     <p className="text-slate-500 text-sm">تداول حقيقي باستخدام مفاتيح الـ API أو متغيرات البيئة (.env).</p>
                     <span className="px-2 py-0.5 bg-rose-500/20 text-rose-400 text-[10px] font-black rounded-lg border border-rose-500/30 animate-pulse">
                        وضع التداول المعاكس (INVERSE) نَشِط 🔄
                     </span>
                  </div>
               </div>
               </div>
               <div className="flex gap-2">
                  <button 
                    type="button"
                    onClick={() => setSettings({...settings, tradingMode: 'PAPER'})}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${settings.tradingMode === 'PAPER' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-slate-800 text-slate-500 hover:bg-slate-700'}`}
                  >
                     وضع التجريبي (PAPER)
                  </button>
                  <button 
                    type="button"
                    onClick={() => setSettings({...settings, tradingMode: 'LIVE'})}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${settings.tradingMode === 'LIVE' ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20' : 'bg-slate-800 text-slate-500 hover:bg-rose-700 hover:text-white'}`}
                  >
                     وضع الحقيقي (LIVE)
                  </button>
               </div>
            </div>

            <div className={`grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10 transition-all ${settings.tradingMode === 'LIVE' ? 'opacity-100' : 'opacity-50'}`}>
               <div className="space-y-3">
                  <label className="text-slate-300 text-sm font-bold flex items-center gap-2">
                     Binance API Key
                  </label>
                  <input 
                    type="password" 
                    placeholder="أدخل مفتاح الـ API هنا (أو اتركه فارغاً لاستخدام .env)..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 text-slate-300 font-mono focus:border-rose-500 outline-none transition-all" 
                    value={settings.binanceApiKey || ''} 
                    onChange={e => setSettings({...settings, binanceApiKey: e.target.value})} 
                  />
               </div>

               <div className="space-y-3">
                  <label className="text-slate-300 text-sm font-bold flex items-center gap-2">
                     Binance Secret Key
                  </label>
                  <input 
                    type="password" 
                    placeholder="أدخل المفتاح السري هنا (أو اتركه فارغاً لاستخدام .env)..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 text-slate-300 font-mono focus:border-rose-500 outline-none transition-all" 
                    value={settings.binanceSecretKey || ''} 
                    onChange={e => setSettings({...settings, binanceSecretKey: e.target.value})} 
                  />
               </div>
            </div>
            
            <div className="mt-8 flex flex-wrap items-center gap-4 relative z-10">
               <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl text-sm font-bold flex items-center gap-3 transition-all border border-slate-700 active:scale-95 disabled:opacity-50"
               >
                  {testing ? <RefreshCw className="w-4 h-4 animate-spin text-rose-400" /> : <Zap className="w-4 h-4 text-rose-400" />}
                  فحص الاتصال بمنصة بايننس
               </button>

               {testResult && (
                  <div className="flex flex-col gap-2 w-full">
                     <div className={`px-4 py-3 rounded-2xl border text-sm font-bold flex items-center gap-3 animate-in slide-in-from-left duration-300 ${
                        testResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                     }`}>
                        {testResult.success ? <ShieldCheck className="w-5 h-5" /> : <Zap className="w-5 h-5 animate-pulse" />}
                        {testResult.message}
                     </div>
                     {!testResult.success && testResult.message.includes('-2015') && (
                        <div className="px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-[10px] text-slate-400 space-y-1">
                           <p className="text-rose-400 font-bold">حلول مقترحة لخطأ API Key / IP:</p>
                           <ul className="list-disc list-inside">
                              <li>تأكد من تفعيل <span className="text-white italic">Enable Futures</span> في إعدادات API بايننس.</li>
                              <li>إذا كنت تستخدم Railway، تأكد من تعطيل <span className="text-white italic">Unrestricted IP Access</span> أو إضافة الـ IP الصحيح.</li>
                              {serverIp && (
                                <li className="text-emerald-400 font-bold">
                                  عنوان IP السيرفر الحالي: <span className="underline select-all">{serverIp}</span> (انسخه وضعه في بايننس)
                                </li>
                              )}
                              <li>تأكد من شحن رصيد USDT في محفظة <span className="text-white italic">Futures</span> وليس Spot.</li>
                           </ul>
                        </div>
                     )}
                  </div>
               )}
            </div>

            {serverIp && !testResult && (
              <div className="mt-4 px-4 py-2 bg-slate-800/30 border border-slate-800 rounded-xl inline-flex items-center gap-3 text-[10px] text-slate-400">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                عنوان IP السيرفر (للإضافة في بايننس): <span className="text-white font-mono font-bold select-all">{serverIp}</span>
              </div>
            )}

            {settings.tradingMode === 'LIVE' && (
              <div className="mt-8 p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-start gap-4 relative z-10">
                 <Zap className="w-6 h-6 text-amber-400 shrink-0 mt-1" />
                 <div className="space-y-2">
                    <p className="text-xs text-amber-300 leading-relaxed font-bold">
                       تنبيه: أنت في وضع التداول الحقيقي (LIVE). 
                    </p>
                    <ul className="text-[10px] text-amber-300/70 list-disc list-inside space-y-1">
                       <li>تأكد من تفعيل صلاحيات Futures فقط في إعدادات API بايننس.</li>
                       <li>لا تقم بتفعيل صلاحيات السحب (Withdrawal) لأي سبب.</li>
                       <li>يفضل قصر الوصول على عنوان IP الخاص بالسيرفر لزيادة الأمان.</li>
                    </ul>
                 </div>
              </div>
            )}
         </section>
         
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
            </div>
         </section>

          {/* 5. Quantum Core System */}
          <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-8 md:p-10 shadow-2xl relative overflow-hidden">
             <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl -mr-32 -mt-32"></div>
             <div className="flex items-center justify-between mb-10 border-b border-slate-800 pb-6 relative z-10">
                <div className="flex items-center gap-4">
                   <div className="p-3 bg-purple-500/20 rounded-2xl"><Cpu className="w-7 h-7 text-purple-400" /></div>
                   <div>
                      <h2 className="text-2xl font-black text-white">النظام الكمي الموحد (Quantum Core)</h2>
                      <p className="text-slate-500 text-sm mt-1">محرك ذكاء اصطناعي موحد يدير الفريمات والسيولة والملاحقة.</p>
                   </div>
                </div>
             </div>
             
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative z-10">
                
                {/* 📊 Mode Selection */}
                <div className="lg:col-span-3 bg-slate-950/50 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 border-l-4 border-l-purple-500">
                   <div className="space-y-1">
                      <h4 className="font-black text-white text-lg">وضعية التشغيل (System Mode)</h4>
                      <p className="text-xs text-slate-500">اختر بين الاسكالبنج السريع (1د) أو التداول المؤسساتي المستقر (15د/1س).</p>
                   </div>
                   <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 w-full md:w-auto">
                      <button 
                         type="button"
                         onClick={() => setSettings({...settings, isLongTerm: false})}
                         className={`flex-1 md:px-8 py-3 rounded-lg text-xs font-black transition-all ${!settings.isLongTerm ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                         اسكالبنج سريع (SCALP)
                      </button>
                      <button 
                         type="button"
                         onClick={() => setSettings({...settings, isLongTerm: true})}
                         className={`flex-1 md:px-8 py-3 rounded-lg text-xs font-black transition-all ${settings.isLongTerm ? 'bg-amber-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                         تداول مستقر (LONG)
                      </button>
                   </div>
                </div>

                {/* 🧠 Quantum Sensitivity */}
                <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 space-y-6">
                   <div className="flex items-center gap-3 border-b border-slate-800/50 pb-4">
                      <BrainCircuit className="w-5 h-5 text-purple-400" />
                      <h4 className="font-black text-white text-sm uppercase">حساسية المحرك (Indicators)</h4>
                   </div>
                   <div className="space-y-4">
                      <div className="space-y-1">
                         <label className="text-[10px] font-bold text-slate-500 uppercase">مضاعف النطاق (BB Multiplier)</label>
                         <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-purple-400 font-mono text-sm" value={settings.quantumBbMultiplier ?? 2.0} onChange={e => setSettings({...settings, quantumBbMultiplier: parseFloat(e.target.value)})} />
                      </div>
                      <div className="space-y-1">
                         <label className="text-[10px] font-bold text-slate-500 uppercase">ضغط السيولة الارتدادي</label>
                         <input type="number" step="0.01" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-emerald-400 font-mono text-sm" value={settings.quantumVolThreshold ?? 1.02} onChange={e => setSettings({...settings, quantumVolThreshold: parseFloat(e.target.value)})} />
                      </div>
                   </div>
                </div>

                {/* 📉 Elastic Trailing */}
                <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 space-y-6">
                   <div className="flex items-center justify-between border-b border-slate-800/50 pb-4">
                      <div className="flex items-center gap-3">
                         <ArrowUpRight className="w-5 h-5 text-cyan-400" />
                         <h4 className="font-black text-white text-sm uppercase">الملاحقة الحركية (Kinetic)</h4>
                      </div>
                      <input type="checkbox" checked={settings.useKineticEngine} onChange={e => setSettings({...settings, useKineticEngine: e.target.checked})} className="w-5 h-5 accent-cyan-500" />
                   </div>
                   <div className={`space-y-4 transition-all ${!settings.useKineticEngine ? 'opacity-20 grayscale' : ''}`}>
                      <div className="space-y-1">
                         <label className="text-[10px] font-bold text-slate-500 uppercase">بدء التتبع (بعد ربح $)</label>
                         <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-cyan-400 font-mono text-sm" value={settings.smartTrailingStartUsd ?? 0.4} onChange={e => setSettings({...settings, smartTrailingStartUsd: parseFloat(e.target.value)})} />
                      </div>
                      <div className="space-y-1">
                         <label className="text-[10px] font-bold text-slate-500 uppercase">مرونة الظل (Rubber Band %)</label>
                         <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-cyan-400 font-mono text-sm" value={settings.smartTrailingThresholdPerc ?? 0.3} onChange={e => setSettings({...settings, smartTrailingThresholdPerc: parseFloat(e.target.value)})} />
                      </div>
                   </div>
                </div>

                {/* 🔄 Inverse Protection */}
                <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 space-y-6">
                   <div className="flex items-center justify-between border-b border-slate-800/50 pb-4">
                      <div className="flex items-center gap-3">
                         <RefreshCw className="w-5 h-5 text-rose-400" />
                         <h4 className="font-black text-white text-sm uppercase">الحماية المعكوسة (Inverse)</h4>
                      </div>
                      <input type="checkbox" checked={settings.inverseTrailingEnabled} onChange={e => setSettings({...settings, inverseTrailingEnabled: e.target.checked})} className="w-5 h-5 accent-rose-500" />
                   </div>
                   <div className={`space-y-4 transition-all ${!settings.inverseTrailingEnabled ? 'opacity-20 grayscale' : ''}`}>
                      <div className="space-y-1">
                         <label className="text-[10px] font-bold text-slate-500 uppercase">حساسية الارتداد العكسي %</label>
                         <input type="number" step="0.005" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-rose-400 font-mono text-sm" value={settings.inverseTrailingSensitivity ?? 0.05} onChange={e => setSettings({...settings, inverseTrailingSensitivity: parseFloat(e.target.value)})} />
                      </div>
                      <div className="p-3 bg-rose-500/5 border border-rose-500/10 rounded-xl">
                         <p className="text-[9px] text-slate-500 leading-tight">يهدف هذا النظام لتأمين الربح الحقيقي في محفظة بايننس بمجرد توقف الزخم.</p>
                      </div>
                   </div>
                </div>

             </div>
          </section>

          {/* 6. Advanced Quantum Tuning (Full Control) */}
          <section className="bg-slate-900/80 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl mb-20 transition-all duration-500">
             <button 
                type="button"
                onClick={() => setShowAdvancedQuantum(!showAdvancedQuantum)}
                className="w-full p-8 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
             >
                <div className="flex items-center gap-4 text-right">
                   <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20"><Gauge className="w-6 h-6 text-indigo-400" /></div>
                   <div>
                      <h2 className="text-xl font-black text-white">إعدادات المحرك الكمي المتقدمة (Advanced Control)</h2>
                      <p className="text-slate-500 text-sm mt-1">التحكم الدقيق في عتبات التيكر، مقاييس الأهداف، ومفاتيح الاستراتيجيات.</p>
                   </div>
                </div>
                {showAdvancedQuantum ? <ChevronUp className="w-8 h-8 text-slate-500" /> : <ChevronDown className="w-8 h-8 text-indigo-400 animate-bounce" />}
             </button>

             {showAdvancedQuantum && (
                <div className="p-8 md:p-10 border-t border-slate-800 bg-slate-950/20 space-y-10 animate-in fade-in slide-in-from-top-4 duration-500">
                   
                   {/* Strategic Toggles */}
                   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 space-y-4">
                         <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-white uppercase flex items-center gap-2">
                               <History className="w-4 h-4 text-emerald-400" />
                               نظام الارتداد (Reversion)
                            </span>
                            <input type="checkbox" checked={settings.quantumUseReversion !== false} onChange={e => setSettings({...settings, quantumUseReversion: e.target.checked})} className="w-5 h-5 accent-emerald-500" />
                         </div>
                         <p className="text-[10px] text-slate-500 leading-relaxed">السماح للمحرك بدخول صفقات الارتداد عند لمس حدود البولنجر مع سيولة عالية.</p>
                      </div>

                      <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 space-y-4">
                         <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-white uppercase flex items-center gap-2">
                               <Activity className="w-4 h-4 text-rose-400" />
                               نظام الزخم (Momentum)
                            </span>
                            <input type="checkbox" checked={settings.quantumUseMomentum !== false} onChange={e => setSettings({...settings, quantumUseMomentum: e.target.checked})} className="w-5 h-5 accent-rose-500" />
                         </div>
                         <p className="text-[10px] text-slate-500 leading-relaxed">السماح للمحرك بركوب موجات الانفجار السعري عند اختراق السيولة الفجائي.</p>
                      </div>

                      <div className="bg-slate-900/50 p-6 rounded-2xl border border-rose-500/20 space-y-4 relative overflow-hidden group">
                         <div className="absolute top-0 right-0 p-1 opacity-10 group-hover:opacity-30 transition-opacity">
                            <Skull className="w-12 h-12 text-rose-500 rotate-12" />
                         </div>
                         <div className="flex items-center justify-between relative z-10">
                            <span className="text-sm font-bold text-rose-400 uppercase flex items-center gap-2">
                               <Flame className="w-4 h-4 text-rose-500 animate-pulse" />
                               الوضع الوحش (Beast Mode)
                            </span>
                            <input type="checkbox" checked={settings.quantumBeastMode} onChange={e => setSettings({...settings, quantumBeastMode: e.target.checked})} className="w-5 h-5 accent-rose-600" />
                         </div>
                         <p className="text-[10px] text-rose-300/60 leading-relaxed relative z-10">تجاهل تأكيدات السيولة الضعيفة ورفع أهداف الربح للحد الأقصى (عدواني جداً).</p>
                         
                         {settings.quantumBeastMode && (
                            <div className="space-y-2 pt-2 border-t border-rose-500/10 animate-in fade-in duration-300">
                               <div className="flex justify-between items-center">
                                  <label className="text-[9px] text-rose-400 font-bold uppercase">شدة الهجوم: x{settings.quantumBeastAggression || 1.5}</label>
                               </div>
                               <input type="range" min="1" max="2.5" step="0.1" className="w-full h-1 bg-rose-950 rounded-lg appearance-none cursor-pointer accent-rose-500" value={settings.quantumBeastAggression || 1.5} onChange={e => setSettings({...settings, quantumBeastAggression: parseFloat(e.target.value)})} />
                            </div>
                         )}
                      </div>

                      <div className="bg-slate-900/50 p-6 rounded-2xl border border-indigo-500/20 space-y-4">
                         <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-indigo-400 uppercase flex items-center gap-2">
                               <BrainCircuit className="w-4 h-4 text-indigo-400" />
                               الخروج الذكي (Smart Exit)
                            </span>
                            <input type="checkbox" checked={settings.quantumSmartExit} onChange={e => setSettings({...settings, quantumSmartExit: e.target.checked})} className="w-5 h-5 accent-indigo-500" />
                         </div>
                         <p className="text-[10px] text-indigo-300/60 leading-relaxed">تعديل الأهداف ووقف الخسارة ديناميكياً لتأمين رأس المال بأسرع وقت.</p>

                         {settings.quantumSmartExit && (
                            <div className="space-y-2 pt-2 border-t border-indigo-500/10 animate-in fade-in duration-300">
                               <div className="flex justify-between items-center">
                                  <label className="text-[9px] text-indigo-400 font-bold uppercase">سرعة الخروج: {Math.round((1 - (settings.quantumSmartExitAggression || 0.8)) * 100)}% أبكر</label>
                               </div>
                               <input type="range" min="0.5" max="0.95" step="0.05" className="w-full h-1 bg-indigo-950 rounded-lg appearance-none cursor-pointer accent-indigo-500" value={settings.quantumSmartExitAggression || 0.8} onChange={e => setSettings({...settings, quantumSmartExitAggression: parseFloat(e.target.value)})} />
                            </div>
                         )}
                      </div>

                      <div className="bg-slate-900/50 p-6 rounded-2xl border border-emerald-500/20 space-y-4">
                         <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-emerald-400 uppercase flex items-center gap-2">
                               <Shield className="w-4 h-4 text-emerald-400" />
                               الدخول الحكيم (Wise Entry)
                            </span>
                            <input type="checkbox" checked={settings.quantumWiseEntry} onChange={e => setSettings({...settings, quantumWiseEntry: e.target.checked})} className="w-5 h-5 accent-emerald-500" />
                         </div>
                         <p className="text-[10px] text-emerald-300/60 leading-relaxed">اشتراط ضغط شرائي/بيعي (Taker Ratio) عنيف جداً قبل فتح أي صفقة.</p>

                         {settings.quantumWiseEntry && (
                            <div className="space-y-2 pt-2 border-t border-emerald-500/10 animate-in fade-in duration-300">
                               <div className="flex justify-between items-center">
                                  <label className="text-[9px] text-emerald-400 font-bold uppercase">عتبة تيكر: {settings.quantumWiseEntryThreshold || 1.05}</label>
                               </div>
                               <input type="range" min="1.01" max="1.3" step="0.01" className="w-full h-1 bg-emerald-950 rounded-lg appearance-none cursor-pointer accent-emerald-500" value={settings.quantumWiseEntryThreshold || 1.05} onChange={e => setSettings({...settings, quantumWiseEntryThreshold: parseFloat(e.target.value)})} />
                            </div>
                         )}
                      </div>
                   </div>

                   {/* Taker Sensitive Thresholds */}
                   <div className="space-y-6">
                      <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                         <BarChart3 className="w-4 h-4" />
                         عتبات ضغط التيكر (Taker Ratio Thresholds)
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                         <div className="space-y-1">
                            <label className="text-[10px] text-slate-500 font-bold uppercase">ارتداد LONG</label>
                            <input type="number" step="0.01" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-indigo-400 font-mono text-sm" value={settings.quantumTakerLongThresh ?? 1.01} onChange={e => setSettings({...settings, quantumTakerLongThresh: parseFloat(e.target.value)})} />
                         </div>
                         <div className="space-y-1">
                            <label className="text-[10px] text-slate-500 font-bold uppercase">ارتداد SHORT</label>
                            <input type="number" step="0.01" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-indigo-400 font-mono text-sm" value={settings.quantumTakerShortThresh ?? 0.99} onChange={e => setSettings({...settings, quantumTakerShortThresh: parseFloat(e.target.value)})} />
                         </div>
                         <div className="space-y-1">
                            <label className="text-[10px] text-slate-500 font-bold uppercase">زخم LONG</label>
                            <input type="number" step="0.01" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-white font-mono text-sm" value={settings.quantumMomentumLongThresh ?? 1.15} onChange={e => setSettings({...settings, quantumMomentumLongThresh: parseFloat(e.target.value)})} />
                         </div>
                         <div className="space-y-1">
                            <label className="text-[10px] text-slate-500 font-bold uppercase">زخم SHORT</label>
                            <input type="number" step="0.01" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-white font-mono text-sm" value={settings.quantumMomentumShortThresh ?? 0.85} onChange={e => setSettings({...settings, quantumMomentumShortThresh: parseFloat(e.target.value)})} />
                         </div>
                      </div>
                   </div>

                   {/* Target Scaling */}
                   <div className="space-y-6">
                      <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                         <Zap className="w-4 h-4" />
                         مقياس الأهداف الديناميكي (Target Scaling)
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                         <div className="space-y-3">
                            <div className="flex justify-between items-center">
                               <label className="text-[10px] text-slate-400 font-bold uppercase">مضاعف جني الأرباح (TP Scale): x{settings.quantumTpScale ?? 1.0}</label>
                            </div>
                            <input type="range" min="0.5" max="3" step="0.1" className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" value={settings.quantumTpScale ?? 1.0} onChange={e => setSettings({...settings, quantumTpScale: parseFloat(e.target.value)})} />
                            <p className="text-[9px] text-slate-500 italic">تكبير الأهداف المقترحة من محرك الكوانتم.</p>
                         </div>
                         <div className="space-y-3">
                            <div className="flex justify-between items-center">
                               <label className="text-[10px] text-slate-400 font-bold uppercase">مضاعف وقف الخسارة (SL Scale): x{settings.quantumSlScale ?? 1.0}</label>
                            </div>
                            <input type="range" min="0.5" max="3" step="0.1" className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" value={settings.quantumSlScale ?? 1.0} onChange={e => setSettings({...settings, quantumSlScale: parseFloat(e.target.value)})} />
                            <p className="text-[9px] text-slate-500 italic">توسيع أو تضييق وقف الخسارة مقارنة بالأهداف.</p>
                         </div>
                      </div>
                   </div>

                </div>
             )}
          </section>

         {/* Final Action Bar */}
         <div className="fixed bottom-0 left-0 right-0 p-6 border-t border-slate-800 bg-slate-950/90 backdrop-blur-xl z-50 flex justify-center items-center">
            <button 
              type="submit" 
              disabled={savingSettings} 
              className="w-full max-w-5xl py-5 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 disabled:opacity-50 text-white font-black text-2xl rounded-3xl transition-all shadow-2xl hover:shadow-emerald-500/40 active:scale-95 flex items-center justify-center gap-4 group"
            >
               {savingSettings ? <RefreshCw className="w-8 h-8 animate-spin" /> : <Settings className="w-8 h-8 group-hover:rotate-90 transition-transform duration-500" />}
               {savingSettings ? 'جاري توظيف الذكاء المدمج...' : 'تثبيت الإعدادات في قلب النظام الكمي'}
            </button>
         </div>

          {/* Maintenance Section */}
          <section className="bg-slate-900/50 border border-slate-800/50 rounded-3xl p-8 md:p-10 shadow-xl opacity-80 hover:opacity-100 transition-opacity mb-20">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                 <div className="p-3 bg-rose-500/10 rounded-2xl border border-rose-500/20"><Trash2 className="w-6 h-6 text-rose-500" /></div>
                 <div>
                    <h2 className="text-xl font-black text-white">صيانة النظام (System Maintenance)</h2>
                    <p className="text-slate-500 text-sm mt-1 text-right">إجراءات حساسة لمسح البيانات وإعادة الضبط.</p>
                 </div>
              </div>
            </div>
            
            <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6">
               <div className="space-y-1 text-center md:text-right">
                  <h4 className="font-bold text-rose-400">مسح تاريخ التداول (Clear Trading History)</h4>
                  <p className="text-[11px] text-slate-400">سيتم مسح جميع الصفقات المفتوحة والمغلقة من قاعدة البيانات. لن يتم لمس الإعدادات.</p>
               </div>
               
               {!showResetConfirm ? (
                 <button 
                   type="button"
                   onClick={() => setShowResetConfirm(true)}
                   className="px-8 py-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white rounded-xl text-sm font-black transition-all active:scale-95 flex items-center gap-2"
                 >
                    <Trash2 className="w-4 h-4" />
                    مسح بيانات التداول
                 </button>
               ) : (
                 <div className="flex items-center gap-3 animate-in zoom-in-95 duration-200">
                    <button 
                      type="button"
                      onClick={() => setShowResetConfirm(false)}
                      className="px-4 py-2 bg-slate-800 text-slate-400 rounded-lg text-xs font-bold"
                    >
                       إلغاء
                    </button>
                    <button 
                      type="button"
                      onClick={handleResetDB}
                      className="px-6 py-2 bg-rose-600 text-white rounded-lg text-xs font-black shadow-lg shadow-rose-900/40 flex items-center gap-2"
                    >
                       {resetting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                       تأكيد المسح النهائي
                    </button>
                 </div>
               )}
            </div>
          </section>

      </form>
    </div>
  );
}

