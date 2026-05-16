import React from 'react';
import { 
  Settings, Zap, ShieldCheck, Wallet, RefreshCw, BrainCircuit, ArrowUpRight, Cpu, Key
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
                     <p className="text-slate-500 text-sm mt-1">تداول حقيقي باستخدام مفاتيح الـ API أو متغيرات البيئة (.env).</p>
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
                  <div className={`px-4 py-3 rounded-2xl border text-sm font-bold flex items-center gap-3 animate-in slide-in-from-left duration-300 ${
                     testResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  }`}>
                     {testResult.success ? <ShieldCheck className="w-5 h-5" /> : <Zap className="w-5 h-5 animate-pulse" />}
                     {testResult.message}
                  </div>
               )}
            </div>

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
                     <input type="number" required min="100" className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-10 py-4 text-emerald-400 font-mono focus:border-emerald-500 outline-none transition-all text-left text-lg" dir="ltr" value={settings.portfolioSize} onChange={e => setSettings({...settings, portfolioSize: parseFloat(e.target.value)})} />
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
                     رسوم التداول <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-500">Fees %</span>
                  </label>
                  <div className="relative">
                     <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">%</span>
                     <input type="number" step="0.01" required min="0" className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-10 py-4 text-rose-400 font-mono focus:border-rose-500 outline-none transition-all text-left text-lg" dir="ltr" value={((settings.tradingFeeRate || 0.001) * 100).toFixed(2)} onChange={e => setSettings({...settings, tradingFeeRate: parseFloat(e.target.value) / 100})} />
                  </div>
               </div>
            </div>
         </section>

         {/* 5. Tactical Sub-Engines */}
         <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-8 md:p-10 shadow-2xl">
            <div className="flex items-center justify-between mb-10 border-b border-slate-800 pb-6">
               <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-500/20 rounded-2xl"><Cpu className="w-7 h-7 text-blue-400" /></div>
                  <div>
                     <h2 className="text-2xl font-black text-white">إعدادات محرك الاسكالبنج</h2>
                     <p className="text-slate-500 text-sm mt-1">تحديد آليات الخروج السريع والملاحقة.</p>
                  </div>
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               {/* Quantum Engine Integrated */}
               <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 space-y-6 md:col-span-2">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                     <div className="flex items-center gap-3">
                        <BrainCircuit className="w-6 h-6 text-purple-500" />
                        <div>
                           <h4 className="font-black text-purple-400">إعدادات المحرك الكمي (Quantum Engine)</h4>
                           <p className="text-[10px] text-slate-500">حساسية المؤشرات وعتبات السيولة لدخول الصفقات السريعة.</p>
                        </div>
                     </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                     <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400">مدة البولنجر (Period)</label>
                        <input type="number" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-purple-400 font-mono" value={settings.quantumBbPeriod ?? 20} onChange={e => setSettings({...settings, quantumBbPeriod: parseInt(e.target.value)})} />
                        <p className="text-[9px] text-slate-500 mt-1">الافتراضي 20. تقليل الرقم يجعله أسرع في التقاط الإشارات.</p>
                     </div>
                     <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400">مضاعف البولنجر (Multiplier)</label>
                        <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-purple-400 font-mono" value={settings.quantumBbMultiplier ?? 1.8} onChange={e => setSettings({...settings, quantumBbMultiplier: parseFloat(e.target.value)})} />
                        <p className="text-[9px] text-slate-500 mt-1">الافتراضي 1.8. رقم أصغر يعني دخول أسهل ومخاطرة أعلى.</p>
                     </div>
                     <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400">عتبة الفوليوم الارتدادي (Reversion Vol)</label>
                        <input type="number" step="0.01" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-emerald-400 font-mono" value={settings.quantumVolThreshold ?? 1.02} onChange={e => setSettings({...settings, quantumVolThreshold: parseFloat(e.target.value)})} />
                        <p className="text-[9px] text-slate-500 mt-1">الافتراضي 1.02 (أي %102 أعلى من المتوسط). لصفقات ارتداد الضغط.</p>
                     </div>
                     <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400">عتبة فوليوم الزخم السريع (Momentum Vol)</label>
                        <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-rose-400 font-mono" value={settings.quantumMomentumVol ?? 1.5} onChange={e => setSettings({...settings, quantumMomentumVol: parseFloat(e.target.value)})} />
                        <p className="text-[9px] text-slate-500 mt-1">الافتراضي 1.5. الصعود المفاجئ للسيولة.</p>
                     </div>
                  </div>
               </div>

               {/* Kinetic Engine Integrated */}
               <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                     <div className="flex items-center gap-3">
                        <ArrowUpRight className="w-6 h-6 text-cyan-500" />
                        <div>
                           <h4 className="font-black text-cyan-400">الملاحقة الحركية (Kinetic Trailing)</h4>
                           <p className="text-[10px] text-slate-500">ملاحقة الأرباح بنظام الظلال Rubber-Band.</p>
                        </div>
                     </div>
                     <input type="checkbox" checked={settings.useKineticEngine} onChange={e => setSettings({...settings, useKineticEngine: e.target.checked})} className="w-6 h-6 accent-cyan-500" />
                  </div>
                  <div className={`grid grid-cols-2 gap-4 transition-all ${!settings.useKineticEngine ? 'opacity-30 blur-[1px]' : ''}`}>
                     <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400">بدء التتبع عند ربح $</label>
                        <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-cyan-400 font-mono" value={settings.smartTrailingStartUsd ?? 0.4} onChange={e => setSettings({...settings, smartTrailingStartUsd: parseFloat(e.target.value)})} />
                     </div>
                     <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400">مرونة الظل %</label>
                        <input type="number" step="0.1" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-cyan-400 font-mono" value={settings.smartTrailingThresholdPerc ?? 0.3} onChange={e => setSettings({...settings, smartTrailingThresholdPerc: parseFloat(e.target.value)})} />
                     </div>
                  </div>
               </div>

               {/* Fast Exit Integrated */}
               <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 flex flex-col gap-4">
                   <div className="flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <Zap className="w-6 h-6 text-emerald-500" />
                        <div>
                           <h4 className="font-black text-emerald-400">تأمين الربح السريع (Fast-TP)</h4>
                           <p className="text-[10px] text-slate-500">إغلاق فوري عند تحقيق ربح ثابت محدد.</p>
                        </div>
                     </div>
                     <input type="checkbox" checked={settings.fastExitEnabled} onChange={e => setSettings({...settings, fastExitEnabled: e.target.checked})} className="w-6 h-6 accent-emerald-500" />
                  </div>
                  <div className="flex items-center gap-3 mt-auto">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">عتبة الإغلاق المباشر:</span>
                    <input type="number" step="0.1" className="w-20 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-emerald-400 font-mono" value={settings.fastExitPerc ?? 0.5} onChange={e => setSettings({...settings, fastExitPerc: parseFloat(e.target.value)})} />
                    <span className="text-xs text-emerald-500 font-bold">%</span>
                  </div>
               </div>
            </div>
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

      </form>
    </div>
  );
}

