import React from 'react';
import { Settings, Zap, ShieldCheck, TrendingUp, Activity, BarChart2, RefreshCw, Target, BrainCircuit, Crosshair, ArrowUpRight } from 'lucide-react';

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
    <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in duration-500 pb-32">
      
      <div className="text-center space-y-4 mb-10 pt-4 cursor-default">
         <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white flex justify-center items-center gap-3">
             <BrainCircuit className="w-10 h-10 text-emerald-400 animate-pulse" />
             النظام الموحد الذكي <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">V4.0</span>
         </h1>
         <p className="text-slate-400 max-w-2xl mx-auto text-sm md:text-base leading-relaxed">
             تم دمج جميع المحركات (الوحش، الحركي، والصارم) في نظام كمومي واحد. قم بتخصيص كل المتغيرات بدقة عالية من لوحة تحكم واحدة متكاملة للحصول على الأداء الأمثل لك.
         </p>
      </div>

      {/* Templates Section */}
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 shadow-xl max-w-4xl mx-auto">
         <div className="flex items-center gap-3 mb-6">
            <Zap className="w-6 h-6 text-amber-500" />
            <h3 className="text-xl font-bold">قوالب وإعدادات مسبقة سريعة</h3>
         </div>
         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {STRATEGY_TEMPLATES.map(tpl => (
               <button 
                  key={tpl.id} type="button" onClick={() => applyTemplate(tpl.settings)}
                  className={`p-4 rounded-xl border transition-all text-right flex flex-col gap-2 hover:scale-[1.02] active:scale-[0.98] ${tpl.color}`}
               >
                  <div className="flex items-center gap-2 font-bold text-sm">{tpl.icon} {tpl.name}</div>
                  <p className="text-[10px] leading-relaxed opacity-80">{tpl.desc}</p>
               </button>
            ))}
         </div>
      </div>

      <form onSubmit={saveSettings} className="space-y-10">

         {/* 1. Risk and Portfolio */}
         <section className="relative p-[1px] rounded-2xl bg-gradient-to-b from-slate-700/50 to-slate-800/10 hover:from-emerald-500/30 transition-all duration-500 overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5"><Settings className="w-40 h-40" /></div>
            <div className="relative bg-slate-900/90 backdrop-blur-sm p-6 md:p-8 rounded-2xl h-full">
               <div className="flex items-center gap-4 mb-8 border-b border-slate-700/50 pb-4">
                  <div className="p-3 bg-emerald-500/20 rounded-xl"><ShieldCheck className="w-6 h-6 text-emerald-400" /></div>
                  <div>
                     <h2 className="text-2xl font-bold text-slate-100">إدارة رأس المال والمخاطرة</h2>
                     <p className="text-slate-400 text-sm mt-1">تكوين أحجام التداول وحدود التعرض للسوق.</p>
                  </div>
               </div>
               
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="space-y-2">
                     <label className="text-slate-300 text-sm font-bold">رأس المال الافتراضي</label>
                     <div className="relative">
                       <span className="absolute left-4 top-3 text-slate-500 font-bold">$</span>
                       <input type="number" required min="100" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-10 py-3 text-emerald-400 font-mono focus:border-emerald-500 outline-none transition-all text-left" dir="ltr" value={settings.portfolioSize} onChange={e => setSettings({...settings, portfolioSize: parseFloat(e.target.value)})} />
                     </div>
                  </div>
                  <div className="space-y-2">
                     <label className="text-slate-300 text-sm font-bold">المخاطرة لكل صفقة</label>
                     <div className="relative">
                       <span className="absolute left-4 top-3 text-slate-500 font-bold">%</span>
                       <input type="number" step="0.1" required min="0.1" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-10 py-3 text-amber-400 font-mono focus:border-amber-500 outline-none transition-all text-left" dir="ltr" value={settings.riskPerTradePerc} onChange={e => setSettings({...settings, riskPerTradePerc: parseFloat(e.target.value)})} />
                     </div>
                  </div>
                  <div className="space-y-2">
                     <label className="text-slate-300 text-sm font-bold">الحد الأقصى للصفقات المتزامنة</label>
                     <input type="number" required min="1" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-blue-400 font-mono focus:border-blue-500 outline-none transition-all text-left" dir="ltr" value={settings.maxConcurrentTrades} onChange={e => setSettings({...settings, maxConcurrentTrades: parseInt(e.target.value)})} />
                  </div>
                  <div className="space-y-2">
                     <label className="text-slate-300 text-sm font-bold">الرافعة المالية</label>
                     <div className="relative">
                       <span className="absolute left-4 top-3 text-slate-500 font-bold">x</span>
                       <input type="number" required min="1" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-10 py-3 text-purple-400 font-mono focus:border-purple-500 outline-none transition-all text-left" dir="ltr" value={settings.leverage} onChange={e => setSettings({...settings, leverage: parseInt(e.target.value)})} />
                     </div>
                  </div>
               </div>
            </div>
         </section>

         {/* 2. Target Hunting & Engine Logic */}
         <section className="relative p-[1px] rounded-2xl bg-gradient-to-b from-slate-700/50 to-slate-800/10 hover:from-amber-500/30 transition-all duration-500 overflow-hidden">
            <div className="absolute top-0 left-0 p-8 opacity-5"><Target className="w-40 h-40" /></div>
            <div className="relative bg-slate-900/90 backdrop-blur-sm p-6 md:p-8 rounded-2xl h-full">
               <div className="flex items-center justify-between mb-8 border-b border-slate-700/50 pb-4">
                  <div className="flex items-center gap-4">
                     <div className="p-3 bg-amber-500/20 rounded-xl"><Crosshair className="w-6 h-6 text-amber-400" /></div>
                     <div>
                        <h2 className="text-2xl font-bold text-slate-100">رصد واصطياد الفرص (Entry Logic)</h2>
                        <p className="text-slate-400 text-sm mt-1">كيف يحلل النظام الأسواق ويختار نقاط الدخول وتحديد التوجه العام.</p>
                     </div>
                  </div>
                  {/* Analysis Box */}
                  <div className="hidden md:flex flex-col items-end gap-1">
                     <div className="text-[10px] text-slate-500 font-bold uppercase">كثافة التداول المتوقعة</div>
                     <div className={`text-xl font-black ${intensity.color}`}>{intensity.label}</div>
                  </div>
               </div>

               <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Left Column: Core Settings */}
                  <div className="space-y-4">
                     <div className="flex items-center justify-between p-4 bg-slate-800/80 rounded-xl border border-slate-700/80 hover:bg-slate-700 transition-colors">
                        <div>
                           <div className="font-bold text-amber-400 mb-1">فلتر تحديد المسار (ADX/Trend)</div>
                           <div className="text-xs text-slate-400">تجاهل الأسواق العرضية أو ذات السيولة الضعيفة.</div>
                        </div>
                        <div className="flex items-center gap-4">
                           {settings.useStrategyTrendFilter && <input type="number" dir="ltr" className="w-16 bg-slate-950 border border-slate-600 rounded px-2 py-1 text-xs text-center font-mono text-amber-400 outline-none" value={settings.strategyAdxThreshold ?? 25} onChange={e => setSettings({...settings, strategyAdxThreshold: parseInt(e.target.value)})} title="عتبة ADX" />}
                           <input type="checkbox" checked={settings.useStrategyTrendFilter} onChange={e => setSettings({...settings, useStrategyTrendFilter: e.target.checked})} className="w-5 h-5 accent-amber-500 cursor-pointer" />
                        </div>
                     </div>

                     <div className="flex items-center justify-between p-4 bg-slate-800/80 rounded-xl border border-slate-700/80 hover:bg-slate-700 transition-colors">
                        <div>
                           <div className="font-bold text-blue-400 mb-1">التكيف مع التقلبات (ATR Dynamic)</div>
                           <div className="text-xs text-slate-400">توسيع أو تضييق وقف الخسارة بناءً على التقلب.</div>
                        </div>
                        <div className="flex items-center gap-4">
                           {settings.useStrategyVolatilityRule && <input type="number" step="0.1" dir="ltr" className="w-16 bg-slate-950 border border-slate-600 rounded px-2 py-1 text-xs text-center font-mono text-blue-400 outline-none" value={settings.strategyAtrMultiplier ?? 1.5} onChange={e => setSettings({...settings, strategyAtrMultiplier: parseFloat(e.target.value)})} title="مضاعف ATR" />}
                           <input type="checkbox" checked={settings.useStrategyVolatilityRule} onChange={e => setSettings({...settings, useStrategyVolatilityRule: e.target.checked})} className="w-5 h-5 accent-blue-500 cursor-pointer" />
                        </div>
                     </div>

                     <div className="flex items-center justify-between p-4 bg-slate-800/80 rounded-xl border border-slate-700/80 hover:bg-slate-700 transition-colors">
                        <div>
                           <div className="font-bold text-purple-400 mb-1">قاعدة تدفق الزخم (RVOL Filter)</div>
                           <div className="text-xs text-slate-400">يقتنص الانفجارات السعرية الناتجة عن سيولة مفاجئة.</div>
                        </div>
                        <div className="flex items-center gap-4">
                           {settings.useStrategyMomentumRule && <input type="number" step="0.1" dir="ltr" className="w-16 bg-slate-950 border border-slate-600 rounded px-2 py-1 text-xs text-center font-mono text-purple-400 outline-none" value={settings.strategyRvolThreshold ?? 1.5} onChange={e => setSettings({...settings, strategyRvolThreshold: parseFloat(e.target.value)})} title="عتبة RVOL" />}
                           <input type="checkbox" checked={settings.useStrategyMomentumRule} onChange={e => setSettings({...settings, useStrategyMomentumRule: e.target.checked})} className="w-5 h-5 accent-purple-500 cursor-pointer" />
                        </div>
                     </div>
                  </div>

                  {/* Right Column: AI & Strict Rules */}
                  <div className="space-y-4">
                     <div className={`p-5 rounded-xl border shadow-inner transition-all bg-slate-800/50 border-slate-700/50`}>
                        <div className="flex items-start justify-between gap-4">
                           <div>
                              <div className="font-bold flex items-center gap-2 text-lg text-rose-400"><BrainCircuit className="w-5 h-5" />الذكاء التكيفي والتدخل العميق</div>
                              <div className="text-xs text-slate-400 mt-1 leading-relaxed">يتيح للنظام التعلم الآلي وتجاوز الشروط التقليدية لاستغلال الانزلاقات والدخول العدواني في الفرص النادرة.</div>
                           </div>
                           <input type="checkbox" checked={settings.beastMode !== false} onChange={e => setSettings({...settings, beastMode: e.target.checked})} className="w-6 h-6 mt-1 accent-rose-500 cursor-pointer flex-shrink-0" title="تفعيل التنفيذ الذكي" />
                        </div>
                        <div className={`pt-4 mt-4 border-t border-rose-900/50 grid grid-cols-1 sm:grid-cols-2 gap-4 ${settings.beastMode === false ? 'opacity-50 pointer-events-none' : ''}`}>
                           <div>
                              <label className="text-[10px] text-rose-300/80 mb-1 block">سرعة التعلم والتكيف %</label>
                              <input type="number" min="1" max="100" className="w-full bg-slate-950 border border-rose-900/50 rounded-lg px-3 py-2 text-rose-400 text-sm font-mono focus:border-rose-500 outline-none" value={settings.beastLearnRate ?? 50} onChange={e => setSettings({...settings, beastLearnRate: parseInt(e.target.value)})} />
                           </div>
                           <div className="flex items-center gap-2 pt-5">
                              <input type="checkbox" checked={settings.beastSlippageExploit !== false} onChange={e => setSettings({...settings, beastSlippageExploit: e.target.checked})} className="w-4 h-4 accent-rose-500" />
                              <label className="text-xs text-rose-300 font-bold">عكس فخاخ الانزلاقات لصالحنا</label>
                           </div>
                        </div>
                     </div>

                     <div className="p-5 rounded-xl border shadow-inner transition-all flex flex-col bg-slate-800/50 border-slate-700/50">
                        <div className="flex items-start justify-between gap-4">
                           <div>
                              <div className="font-bold flex items-center gap-2 text-lg text-emerald-400"><ShieldCheck className="w-5 h-5" />قيود الاستقرار والفلاتر المتقدمة</div>
                              <div className="text-xs text-slate-400 mt-1 leading-relaxed">تخصيص الفلاتر الإضافية لتصفية الصفقات بدقة عالية لانتظار الاستقرار وتقليل الخسائر العشوائية.</div>
                           </div>
                           <input type="checkbox" checked={settings.strictMode !== false} onChange={e => setSettings({...settings, strictMode: e.target.checked})} className="w-6 h-6 mt-1 accent-emerald-500 cursor-pointer flex-shrink-0" />
                        </div>
                        <div className={`pt-4 mt-4 border-t border-emerald-900/50 grid grid-cols-2 sm:grid-cols-3 gap-3 ${settings.strictMode === false ? 'opacity-50 pointer-events-none' : ''}`}>
                           <div className="space-y-1 relative group">
                              <label className="text-[10px] text-emerald-300/80">الحد الأدنى لليقين AI</label>
                              <input type="number" step="0.05" className="w-full bg-slate-950 border border-emerald-900/50 rounded px-2 py-1.5 text-emerald-400 text-xs font-mono outline-none focus:border-emerald-500" value={settings.strategyMinConfidence ?? 0.6} onChange={e => setSettings({...settings, strategyMinConfidence: parseFloat(e.target.value)})} />
                           </div>
                           <div className="space-y-1 relative group">
                              <label className="text-[10px] text-emerald-300/80">شروط التطابق (Max 6)</label>
                              <input type="number" max="6" min="1" className="w-full bg-slate-950 border border-emerald-900/50 rounded px-2 py-1.5 text-emerald-400 text-xs font-mono outline-none focus:border-emerald-500" value={settings.strictMinScore ?? 6} onChange={e => setSettings({...settings, strictMinScore: parseInt(e.target.value)})} />
                           </div>
                           <div className="space-y-1 relative group">
                              <label className="text-[10px] text-emerald-300/80">أقصى خسارة حركية مسموحة %</label>
                              <input type="number" step="0.1" className="w-full bg-slate-950 border border-emerald-900/50 rounded px-2 py-1.5 text-emerald-400 text-xs font-mono outline-none focus:border-emerald-500" value={settings.strictMaxRisk ?? 1.0} onChange={e => setSettings({...settings, strictMaxRisk: parseFloat(e.target.value)})} />
                           </div>
                           <div className="space-y-1 relative group">
                              <label className="text-[10px] text-emerald-300/80">RSI سقف تشبع شرائي</label>
                              <input type="number" className="w-full bg-slate-950 border border-emerald-900/50 rounded px-2 py-1.5 text-emerald-400 text-xs font-mono outline-none focus:border-emerald-500" value={settings.strictRsiHigh ?? 75} onChange={e => setSettings({...settings, strictRsiHigh: parseInt(e.target.value)})} />
                           </div>
                           <div className="space-y-1 relative group">
                              <label className="text-[10px] text-emerald-300/80">RSI قاع تشبع بيعي</label>
                              <input type="number" className="w-full bg-slate-950 border border-emerald-900/50 rounded px-2 py-1.5 text-emerald-400 text-xs font-mono outline-none focus:border-emerald-500" value={settings.strictRsiLow ?? 25} onChange={e => setSettings({...settings, strictRsiLow: parseInt(e.target.value)})} />
                           </div>
                        </div>
                     </div>
                  </div>
               </div>
            </div>
         </section>

         {/* 3. Exit and Wealth Management */}
         <section className="relative p-[1px] rounded-2xl bg-gradient-to-b from-slate-700/50 to-slate-800/10 hover:from-cyan-500/30 transition-all duration-500 overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5"><ArrowUpRight className="w-40 h-40" /></div>
            <div className="relative bg-slate-900/90 backdrop-blur-sm p-6 md:p-8 rounded-2xl h-full">
               <div className="flex items-center gap-4 mb-8 border-b border-slate-700/50 pb-4">
                  <div className="p-3 bg-cyan-500/20 rounded-xl"><ArrowUpRight className="w-6 h-6 text-cyan-400" /></div>
                  <div>
                     <h2 className="text-2xl font-bold text-slate-100">الإدارة الديناميكية والخروج الفعال</h2>
                     <p className="text-slate-400 text-sm mt-1">تحديد كيفية حماية الأرباح وتتبع الزخم للإغلاق في الوقت المثالي.</p>
                  </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Dynamic Trailing / Kinetic */}
                  <div className="p-6 rounded-xl border transition-all bg-slate-800/30 border-slate-700/50 space-y-6">
                     <div className="flex items-start justify-between gap-4 border-b border-slate-700/50 pb-4">
                        <div>
                           <div className="font-bold mb-1 text-lg text-cyan-400">ملاحقة الأهداف والظل المطاطي</div>
                           <div className="text-xs text-slate-400 leading-relaxed">السماح للأرباح بالنمو عبر تعديل أوتوماتيكي لمسافة التأمين (Trailing) والإغلاق الزمني.</div>
                        </div>
                        <input type="checkbox" checked={settings.useKineticEngine !== false} onChange={e => setSettings({...settings, useKineticEngine: e.target.checked})} className="w-6 h-6 mt-1 accent-cyan-500 cursor-pointer flex-shrink-0" />
                     </div>
                     
                     <div className={`grid grid-cols-2 gap-4 ${settings.useKineticEngine === false ? 'opacity-50 pointer-events-none' : ''}`}>
                         <div className="space-y-1">
                             <label className="text-xs text-slate-300 font-bold">بوابة نقل الوقف لنقطة الصفر عند ربح %</label>
                             <input type="number" step="0.05" className="w-full bg-slate-950 border border-cyan-900/50 rounded-lg px-3 py-2 text-cyan-400 font-mono focus:border-cyan-500 outline-none" value={settings.strictFastBreakevenPerc ?? 0.75} onChange={e => setSettings({...settings, strictFastBreakevenPerc: parseFloat(e.target.value)})} />
                         </div>
                         <div className="space-y-1">
                             <label className="text-xs text-slate-300 font-bold">بدء نظام الملاحقة الحركية (Trailing $) عند ربح:</label>
                             <input type="number" step="0.1" className="w-full bg-slate-950 border border-cyan-900/50 rounded-lg px-3 py-2 text-cyan-400 font-mono focus:border-cyan-500 outline-none" value={settings.smartTrailingStartUsd ?? 0.4} onChange={e => setSettings({...settings, smartTrailingStartUsd: parseFloat(e.target.value)})} />
                         </div>
                         <div className="space-y-1">
                             <label className="text-xs text-slate-300 font-bold">مرونة التذبذب المسموح (المطاط %)</label>
                             <input type="number" step="0.1" className="w-full bg-slate-950 border border-cyan-900/50 rounded-lg px-3 py-2 text-cyan-400 font-mono focus:border-cyan-500 outline-none" value={settings.smartTrailingThresholdPerc ?? 0.3} onChange={e => setSettings({...settings, smartTrailingThresholdPerc: parseFloat(e.target.value)})} />
                         </div>
                         <div className="space-y-1">
                             <label className="text-xs text-slate-300 font-bold">عمر الزخم ومعدل القتل (دقائق)</label>
                             <input type="number" className="w-full bg-slate-950 border border-cyan-900/50 rounded-lg px-3 py-2 text-cyan-400 font-mono focus:border-cyan-500 outline-none" value={settings.smartTimeDecayMinutes ?? 5} onChange={e => setSettings({...settings, smartTimeDecayMinutes: parseInt(e.target.value)})} />
                         </div>
                     </div>
                  </div>

                  {/* Smart Exit & Fast Exit */}
                  <div className="space-y-6">
                     <div className="flex flex-col gap-4 p-5 rounded-xl border transition-colors bg-slate-800/50 border-slate-700/50">
                        <div className="flex items-center justify-between">
                           <div className="flex-1 pr-4">
                              <div className="font-bold mb-1 text-lg text-blue-400">الخروج الذكي (استشعار الانعكاس)</div>
                              <div className="text-xs text-slate-400 leading-relaxed">اكتشاف الارتدادات العنيفة والخروج من الصفقة تلقائياً قبل ان تضرب الوقف العادي لتقليل الخسائر.</div>
                           </div>
                           <input type="checkbox" checked={settings.useSmartExit !== false} onChange={e => setSettings({...settings, useSmartExit: e.target.checked})} className="w-6 h-6 accent-blue-500 cursor-pointer flex-shrink-0" />
                        </div>
                        <div className={`flex items-center gap-2 pt-3 border-t border-blue-900/30 mt-2 ${settings.useSmartExit === false ? 'opacity-50 pointer-events-none' : ''}`}>
                           <input type="checkbox" checked={settings.dynamicSafetyExit !== false} onChange={e => setSettings({...settings, dynamicSafetyExit: e.target.checked})} className="w-4 h-4 accent-blue-400" />
                           <label className="text-xs text-blue-300 font-bold">تفعيل تتبع المؤشرات الحية والإغلاق الطارئ</label>
                        </div>
                     </div>

                     <div className="flex flex-col gap-4 p-5 rounded-xl border transition-colors bg-slate-800/50 border-slate-700/50">
                        <div className="flex items-center justify-between">
                           <div className="flex-1 pr-4">
                              <div className="font-bold mb-1 text-lg text-emerald-400">تأمين الربح القسري (Pro-Active Take Profit)</div>
                              <div className="text-xs text-slate-400 leading-relaxed">اغلاق فوري قسري للصفقة عند تحقيقها ربح سريع مضمون لحماية المحصلة الاجمالية.</div>
                           </div>
                           <input type="checkbox" checked={settings.fastExitEnabled !== false} onChange={e => setSettings({...settings, fastExitEnabled: e.target.checked})} className="w-6 h-6 accent-emerald-500 cursor-pointer flex-shrink-0" />
                        </div>
                        <div className={`flex items-center gap-3 pt-4 border-t border-emerald-900/30 mt-2 ${settings.fastExitEnabled === false ? 'opacity-50 pointer-events-none' : ''}`}>
                           <span className="text-sm font-bold text-slate-300">الاغلاق الآلي الثابت عند تحقق عائد %:</span>
                           <div className="relative">
                              <input type="number" step="0.1" className="w-24 bg-slate-950 border border-emerald-500/50 rounded-lg px-3 py-2 font-mono text-emerald-400 text-lg outline-none focus:border-emerald-500" value={settings.fastExitPerc ?? 0.5} onChange={e => setSettings({...settings, fastExitPerc: parseFloat(e.target.value)})} />
                              <span className="absolute left-3 top-2.5 text-emerald-500/50 font-bold">%</span>
                           </div>
                        </div>
                     </div>
                  </div>
               </div>
            </div>
         </section>

         {/* Fixed Save Button */}
         <div className="fixed bottom-0 left-0 right-0 p-4 border-t border-slate-800/80 bg-slate-900/80 backdrop-blur-xl z-50 flex justify-center items-center">
            <button type="submit" disabled={savingSettings} className="w-full max-w-4xl py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-900 font-black text-xl rounded-2xl transition-all shadow-lg hover:shadow-emerald-500/20 active:scale-[0.98] flex items-center justify-center gap-3">
               {savingSettings ? <RefreshCw className="w-7 h-7 animate-spin" /> : <Settings className="w-7 h-7" />}
               {savingSettings ? 'جاري تطبيق التعديلات الموحدة...' : 'حفظ التعديلات على النظام وتحديث الخوارزمية'}
            </button>
         </div>

      </form>
    </div>
  );
}
