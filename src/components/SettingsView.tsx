import React from 'react';
import { 
  Settings, Zap, ShieldCheck, TrendingUp, Activity, BarChart2, 
  RefreshCw, Target, BrainCircuit, Crosshair, ArrowUpRight, Layers, 
  Cpu, Wallet, AlertTriangle, ShieldAlert
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
  return (
    <div className="max-w-6xl mx-auto space-y-12 animate-in fade-in duration-700 pb-40">
      
      {/* 1. Header & Mission Description */}
      <div className="text-center space-y-4 pt-6">
         <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-widest mb-2">
            Multi-Layer Unified Architecture V4.0
         </div>
         <h1 className="text-4xl md:text-5xl font-black text-white flex justify-center items-center gap-4">
             <BrainCircuit className="w-12 h-12 text-emerald-400 animate-pulse" />
             النظام الموحد والشامل
         </h1>
         <p className="text-slate-400 max-w-3xl mx-auto text-base md:text-lg leading-relaxed">
            تم دمج "الطبقات السبعة" وجميع الانظمة الفرعية في بنية تحتية واحدة. يمكنك الآن التحكم في كل برغي في المحرك من خلال هذه اللوحة الرقمية الموحدة.
         </p>
      </div>

      {/* 2. Rapid Templates (Quick Start) */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
         <div className="absolute top-0 right-0 p-10 opacity-5 rotate-12"><Zap className="w-48 h-48 text-amber-500" /></div>
         <div className="relative z-10">
            <div className="flex items-center gap-3 mb-8">
               <div className="p-2 bg-amber-500/20 rounded-lg"><Zap className="w-6 h-6 text-amber-400" /></div>
               <h3 className="text-2xl font-black">اختيار الهوية البرمجية (Presets)</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
               {STRATEGY_TEMPLATES.map(tpl => (
                  <button 
                     key={tpl.id} type="button" onClick={() => applyTemplate(tpl.settings)}
                     className={`p-5 rounded-2xl border-2 transition-all text-right flex flex-col gap-3 hover:scale-[1.03] active:scale-[0.97] group ${tpl.color}`}
                  >
                     <div className="flex items-center gap-3 font-black text-base">
                        <div className="p-2 bg-white/10 rounded-lg group-hover:bg-white/20 transition-colors">{tpl.icon}</div>
                        {tpl.name}
                     </div>
                     <p className="text-xs leading-relaxed opacity-70 font-medium">{tpl.desc}</p>
                     <div className="mt-auto pt-3 border-t border-current/10 text-[10px] uppercase font-bold opacity-50">تطبيق التكوين كاملاً</div>
                  </button>
               ))}
            </div>
         </div>
      </div>

      <form onSubmit={saveSettings} className="space-y-12">
         
         {/* 3. Layer 0: Core Risk Setup */}
         <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-8 md:p-10 shadow-2xl">
            <div className="flex items-center justify-between mb-10 border-b border-slate-800 pb-6">
               <div className="flex items-center gap-4">
                  <div className="p-3 bg-emerald-500/20 rounded-2xl"><Wallet className="w-7 h-7 text-emerald-400" /></div>
                  <div>
                     <h2 className="text-2xl font-black text-white">الطبقة الصفرية: إدارة رأس المال</h2>
                     <p className="text-slate-500 text-sm mt-1">تحديد القواعد المالية الصارمة التي يتحرك البوت ضمنها.</p>
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
            </div>
         </section>

         {/* 4. Unified 7-Layer Intelligence */}
         <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-8 md:p-10 shadow-2xl relative">
            <div className="absolute top-10 left-10 opacity-10"><Layers className="w-24 h-24 text-indigo-500" /></div>
            <div className="flex items-center justify-between mb-10 border-b border-slate-800 pb-6">
               <div className="flex items-center gap-4">
                  <div className="p-3 bg-indigo-500/20 rounded-2xl"><Layers className="w-7 h-7 text-indigo-400" /></div>
                  <div>
                     <h2 className="text-2xl font-black text-white">ذكاء الطبقات السبعة (Unified Logic Layers)</h2>
                     <p className="text-slate-500 text-sm mt-1">تفعيل أو تعطيل محركات التحليل الرقمي وتحديد استقلاليتها في قرار التنفيذ.</p>
                  </div>
               </div>
               <div className="hidden md:block text-right">
                  <div className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">مستوى صرامة المحرك</div>
                  <div className={`text-xl font-black ${intensity.color}`}>{intensity.label}</div>
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               {/* Layer 1: Global Context */}
               <div className={`p-6 rounded-2xl border-2 transition-all flex flex-col gap-4 ${settings.layerGlobalContextEnabled ? 'bg-indigo-500/5 border-indigo-500/40 shadow-lg shadow-indigo-500/5' : 'bg-slate-950/40 border-slate-800 opacity-60'}`}>
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-black text-xs">01</div>
                        <h4 className="font-black text-slate-100">سياق الكلاود (Cloud Context)</h4>
                     </div>
                     <input type="checkbox" checked={settings.layerGlobalContextEnabled} onChange={e => setSettings({...settings, layerGlobalContextEnabled: e.target.checked})} className="w-6 h-6 accent-indigo-500" />
                  </div>
                  <div className="text-xs text-slate-400 leading-relaxed">
                     <span className="text-indigo-400 font-bold italic">الوظيفة الرقمية:</span> تتبع BTC ومؤشر الخوف/الطمع. <br/>
                     <span className="text-amber-500 font-bold italic">الأثر:</span> تمنع الدخول ضد تيار السوق الكلي. (زيادة الأمان بنسبة 40%).
                  </div>
               </div>

               {/* Layer 2: Market Regime */}
               <div className={`p-6 rounded-2xl border-2 transition-all flex flex-col gap-4 ${settings.layerRegimeEnabled ? 'bg-indigo-500/5 border-indigo-500/40 shadow-lg shadow-indigo-500/5' : 'bg-slate-950/40 border-slate-800 opacity-60'}`}>
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-black text-xs">02</div>
                        <h4 className="font-black text-slate-100">نظام السوق (Regime Filter)</h4>
                     </div>
                     <input type="checkbox" checked={settings.layerRegimeEnabled} onChange={e => setSettings({...settings, layerRegimeEnabled: e.target.checked})} className="w-6 h-6 accent-indigo-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-1">
                     <div className="space-y-1">
                        <span className="text-[10px] text-slate-500">عتبة الـ ADX</span>
                        <input type="number" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-indigo-400 font-mono" value={settings.strategyAdxThreshold ?? 25} onChange={e => setSettings({...settings, strategyAdxThreshold: parseInt(e.target.value)})} />
                     </div>
                     <div className="text-[9px] text-slate-500 self-center leading-tight">
                        رفع الرقم يعني تداول في "ترند" حاد فقط. تنزيله يسمح بالتداول في عرضية.
                     </div>
                  </div>
               </div>

               {/* Layer 3: Directional Bias */}
               <div className={`p-6 rounded-2xl border-2 transition-all flex flex-col gap-4 ${settings.layerBiasEnabled ? 'bg-indigo-500/5 border-indigo-500/40 shadow-lg shadow-indigo-500/5' : 'bg-slate-950/40 border-slate-800 opacity-60'}`}>
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-black text-xs">03</div>
                        <h4 className="font-black text-slate-100">الانحياز الزمني (Bias Sync)</h4>
                     </div>
                     <input type="checkbox" checked={settings.layerBiasEnabled} onChange={e => setSettings({...settings, layerBiasEnabled: e.target.checked})} className="w-6 h-6 accent-indigo-500" />
                  </div>
                  <div className="text-xs text-slate-400 leading-relaxed">
                     <span className="text-indigo-400 font-bold italic">الوظيفة الرقمية:</span> المزامنة مع الفريمات الكبيرة (HTF). <br/>
                     <span className="text-amber-500 font-bold italic">الأثر:</span> تضمن أن صفقات الـ 5M لا تخالف اتجاه الـ 4H.
                  </div>
               </div>

               {/* Layer 4: Liquidity Traps */}
               <div className={`p-6 rounded-2xl border-2 transition-all flex flex-col gap-4 ${settings.layerLiquidityEnabled ? 'bg-rose-500/5 border-rose-500/40 shadow-lg shadow-rose-500/5' : 'bg-slate-950/40 border-slate-800 opacity-60'}`}>
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-rose-500/20 flex items-center justify-center text-rose-400 font-black text-xs">04</div>
                        <h4 className="font-black text-slate-100">المصيدة والسيولة (Trap Logic)</h4>
                     </div>
                     <input type="checkbox" checked={settings.layerLiquidityEnabled} onChange={e => setSettings({...settings, layerLiquidityEnabled: e.target.checked})} className="w-6 h-6 accent-rose-500" />
                  </div>
                  <div className="text-xs text-slate-400 leading-relaxed">
                     <span className="text-rose-400 font-bold italic">الوظيفة الرقمية:</span> كشف "حبس" المتداولين (Long/Short Traps). <br/>
                     <span className="text-emerald-500 font-bold italic">الأثر:</span> تفعيلها يضيف صفقات الارتداد العنيف بنسبة نجاح تفوق 90%.
                  </div>
               </div>

               {/* Layer 5: Momentum Velocity */}
               <div className={`p-6 rounded-2xl border-2 transition-all flex flex-col gap-4 ${settings.layerMomentumEnabled ? 'bg-cyan-500/5 border-cyan-500/40 shadow-lg shadow-cyan-500/5' : 'bg-slate-950/40 border-slate-800 opacity-60'}`}>
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center text-cyan-400 font-black text-xs">05</div>
                        <h4 className="font-black text-slate-100">الزخم والتدفق (Momentum Core)</h4>
                     </div>
                     <input type="checkbox" checked={settings.layerMomentumEnabled} onChange={e => setSettings({...settings, layerMomentumEnabled: e.target.checked})} className="w-6 h-6 accent-cyan-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-1">
                     <div className="space-y-1">
                        <span className="text-[10px] text-slate-500">عتبة RVOL</span>
                        <input type="number" step="0.1" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-cyan-400 font-mono" value={settings.strategyRvolThreshold ?? 1.5} onChange={e => setSettings({...settings, strategyRvolThreshold: parseFloat(e.target.value)})} />
                     </div>
                     <div className="text-[9px] text-slate-500 self-center leading-tight">
                        رفع الرقم يحد من الصفقات البطيئة. تنزيله يسمح بالصيد في الأسواق الهادئة.
                     </div>
                  </div>
               </div>

               {/* Layer 6: Neural AI Gate */}
               <div className={`p-6 rounded-2xl border-2 transition-all flex flex-col gap-4 ${settings.layerConfidenceEnabled ? 'bg-amber-500/5 border-amber-500/40 shadow-lg shadow-amber-500/5' : 'bg-slate-950/40 border-slate-800 opacity-60'}`}>
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-400 font-black text-xs">06</div>
                        <h4 className="font-black text-slate-100">بوابة الثقة (Confidence Gate)</h4>
                     </div>
                     <input type="checkbox" checked={settings.layerConfidenceEnabled} onChange={e => setSettings({...settings, layerConfidenceEnabled: e.target.checked})} className="w-6 h-6 accent-amber-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-1">
                     <div className="space-y-1">
                        <span className="text-[10px] text-slate-500">يقين AI (0.1 - 1.0)</span>
                        <input type="number" step="0.05" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-amber-400 font-mono" value={settings.strategyMinConfidence ?? 0.6} onChange={e => setSettings({...settings, strategyMinConfidence: parseFloat(e.target.value)})} />
                     </div>
                     <div className="text-[9px] text-slate-500 self-center leading-tight">
                        الإعداد 0.8 يعني "صفقات ذهبية فقط". الإعداد 0.4 يسمح بدخول واسع.
                     </div>
                  </div>
               </div>

               {/* Layer 7: Execution Guard */}
               <div className={`col-span-1 md:col-span-2 p-6 rounded-2xl border-2 bg-emerald-500/5 border-emerald-500/20 shadow-lg shadow-emerald-500/5 flex items-center justify-between`}>
                  <div className="flex items-center gap-4">
                     <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-black">07</div>
                     <div>
                        <h4 className="font-black text-slate-100">طبقة التنفيذ النهائية (Risk Guard Layer)</h4>
                        <p className="text-[10px] text-slate-500">التدقيق النهائي للرافعة، حجم العقد، والسيولة المتاحة قبل الإرسال.</p>
                     </div>
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-[10px] font-black text-emerald-500 tracking-widest px-3 py-1 bg-emerald-500/10 rounded-full">ALWAYS_ACTIVE</span>
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
                     <h2 className="text-2xl font-black text-white">المحركات التكتيكية المتقدمة</h2>
                     <p className="text-slate-500 text-sm mt-1">تفعيل التقنيات الخاصة لإدارة الصفقة بعد الدخول (Beast, Kinetic, Smart Exit).</p>
                  </div>
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               {/* Beast Mode Integrated */}
               <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                     <div className="flex items-center gap-3">
                        <BrainCircuit className="w-6 h-6 text-rose-500" />
                        <div>
                           <h4 className="font-black text-rose-400">وضع الوحش (Aggressive Beast)</h4>
                           <p className="text-[10px] text-slate-500">الدخول المباشر وتجاوز شروط السيولة في الصعود الصاروخي.</p>
                        </div>
                     </div>
                     <input type="checkbox" checked={settings.beastMode} onChange={e => setSettings({...settings, beastMode: e.target.checked})} className="w-6 h-6 accent-rose-500" />
                  </div>
                  <div className={`grid grid-cols-2 gap-4 transition-all ${!settings.beastMode ? 'opacity-30 blur-[1px]' : ''}`}>
                     <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400">معدل التعلم %</label>
                        <input type="number" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-rose-400 font-mono" value={settings.beastLearnRate ?? 50} onChange={e => setSettings({...settings, beastLearnRate: parseInt(e.target.value)})} />
                     </div>
                     <div className="flex items-center gap-2 pt-5 text-right">
                       <input type="checkbox" checked={settings.beastSlippageExploit} onChange={e => setSettings({...settings, beastSlippageExploit: e.target.checked})} className="w-4 h-4 accent-rose-500" />
                       <span className="text-[10px] font-bold text-rose-300 mr-2">عكس الانزلاق</span>
                     </div>
                     
                     {/* Beast Confirmations */}
                     <div className="col-span-2 space-y-3 border-t border-slate-900 pt-4">
                        <div className="flex items-center justify-between">
                           <span className="text-[9px] font-black text-slate-500 uppercase flex items-center gap-2">
                              <TrendingUp className="w-3 h-3" /> تأكيد السيولة (RVOL)
                           </span>
                           <div className="flex items-center gap-2">
                              <input type="number" step="0.1" className="w-14 bg-slate-900 border border-slate-800 rounded-lg px-1 py-1 text-[10px] text-rose-400 text-center" value={settings.beastMinRvol ?? 1.2} onChange={e => setSettings({...settings, beastMinRvol: parseFloat(e.target.value)})} />
                              <input type="checkbox" checked={settings.beastConfirmWithVolume} onChange={e => setSettings({...settings, beastConfirmWithVolume: e.target.checked})} className="w-4 h-4 accent-rose-500" />
                           </div>
                        </div>
                        <div className="flex items-center justify-between">
                           <span className="text-[9px] font-black text-slate-500 uppercase flex items-center gap-2">
                              <ShieldCheck className="w-3 h-3 text-emerald-500" /> فلتر مؤسساتي (SMC)
                           </span>
                           <div className="flex items-center gap-2">
                              <input type="number" step="0.1" max="1" className="w-14 bg-slate-900 border border-slate-800 rounded-lg px-1 py-1 text-[10px] text-rose-400 text-center" value={settings.beastInstitutionalStrength ?? 0.4} onChange={e => setSettings({...settings, beastInstitutionalStrength: parseFloat(e.target.value)})} title="Institutional Pressure Threshold" />
                              <input type="checkbox" checked={settings.beastConfirmWithSMC} onChange={e => setSettings({...settings, beastConfirmWithSMC: e.target.checked})} className="w-4 h-4 accent-rose-500" />
                           </div>
                        </div>
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

               {/* Smart Exit Integrated */}
               <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                         <ShieldAlert className="w-6 h-6 text-blue-500" />
                         <div>
                            <h4 className="font-black text-blue-400">الخروج الذكي (Smart & Wise)</h4>
                            <p className="text-[10px] text-slate-500">خوارزميات الخروج المؤسساتي قبل عكس الاتجاه.</p>
                         </div>
                      </div>
                      <div className="flex items-center gap-4">
                         <div className="flex items-center gap-2">
                             <span className="text-[9px] text-slate-500">Smart</span>
                             <input type="checkbox" checked={settings.useSmartExit} onChange={e => setSettings({...settings, useSmartExit: e.target.checked})} className="w-5 h-5 accent-blue-500" />
                         </div>
                         <div className="flex items-center gap-2">
                             <span className="text-[9px] text-emerald-500">Wise Exit</span>
                             <input type="checkbox" checked={settings.useWiseExit} onChange={e => setSettings({...settings, useWiseExit: e.target.checked})} className="w-5 h-5 accent-emerald-500" />
                         </div>
                         <div className="flex items-center gap-2">
                             <span className="text-[9px] text-purple-500">Wise Entry</span>
                             <input type="checkbox" checked={settings.useWiseEntry} onChange={e => setSettings({...settings, useWiseEntry: e.target.checked})} className="w-5 h-5 accent-purple-500" />
                         </div>
                         <div className="flex items-center gap-2">
                             <span className="text-[9px] text-orange-500">الثعلب الماكر (Sly Fox)</span>
                             <input type="checkbox" checked={settings.useSlyFox} onChange={e => setSettings({...settings, useSlyFox: e.target.checked})} className="w-5 h-5 accent-orange-500" />
                         </div>
                      </div>
                  </div>
                  <div className="flex items-center gap-2 mt-auto">
                    <input type="checkbox" checked={settings.dynamicSafetyExit} onChange={e => setSettings({...settings, dynamicSafetyExit: e.target.checked})} className="w-4 h-4 accent-blue-500" />
                    <span className="text-[10px] font-bold text-blue-300">تتبع المؤشرات الحية للإغلاق الطارئ</span>
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
               {savingSettings ? 'جاري توظيف الذكاء المدمج...' : 'تثبيت الإعدادات في قلب النظام V4.0'}
            </button>
         </div>

      </form>
    </div>
  );
}
