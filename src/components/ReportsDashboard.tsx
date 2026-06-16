import React, { useState, useEffect } from 'react';
import { RefreshCw, BrainCircuit, Activity, BarChart4, TrendingUp, TrendingDown, Target, ShieldAlert, Cpu } from 'lucide-react';

export const ReportsDashboard: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [geminiAnalysis, setGeminiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const statsRes = await fetch('/api/sovereign/stats');
      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
      const tradesRes = await fetch('/api/trades/history');
      if (tradesRes.ok) {
        setTrades(await tradesRes.json());
      }
    } catch (e) {
      console.error(e);
    }
    setIsLoading(false);
  };

  const checkGeminiConfigured = async () => {
     // Optional: check if key is there or just attempt and handle error
     return true;
  };

  const handleAskGemini = async () => {
    setIsAnalyzing(true);
    try {
      const prompt = `أنت خبير مالي ومحلل خوارزمي لنظام تداول يسمى (Sovereign Engine).
النظام يعتمد على 7 شروط أساسية للدخول.
إليك إحصائيات النظام حتى الآن:
إجمالي محاولات الفحص: ${stats?.totalEvaluations}
محاولات الشراء (Long) مع الاتجاه: ${stats?.totalLongScanned} | المقبول منها: ${stats?.acceptedLongs}
محاولات البيع (Short) مع الاتجاه: ${stats?.totalShortScanned} | المقبول منها: ${stats?.acceptedShorts}

أداء الشروط (كم مرة تحقق وكم مرة فشل عندما كان الاتجاه الأساسي صحيحاً):
1. اتجاه EMA50: (نجح: ${stats?.rules.ema50_trend.passed}, فشل: ${stats?.rules.ema50_trend.failed})
2. ترتيب EMA50 مع EMA200: (نجح: ${stats?.rules.ema_alignment.passed}, فشل: ${stats?.rules.ema_alignment.failed})
3. السيولة (RVOL>2): (نجح: ${stats?.rules.rvol.passed}, فشل: ${stats?.rules.rvol.failed})
4. نمو الفائدة (OI Rising): (نجح: ${stats?.rules.oi_rising.passed}, فشل: ${stats?.rules.oi_rising.failed})
5. سيطرة الماركت (Taker): (نجح: ${stats?.rules.taker_ratio.passed}, فشل: ${stats?.rules.taker_ratio.failed})
6. قوة الترند (ADX>25): (نجح: ${stats?.rules.adx.passed}, فشل: ${stats?.rules.adx.failed})
7. كسر 10 شموع: (نجح: ${stats?.rules.price_breakout.passed}, فشل: ${stats?.rules.price_breakout.failed})

صنف الحالات السابقة واذكر اكثر شرط حقق نجاح واكثر شرط فشل باستمرار وتسبب بتفويت صفقات.

بيانات الصفقات المغلقة لهذا النظام:
${trades.filter((t: any) => t.source?.includes('SOVEREIGN')).map((t: any) => `- عملة ${t.symbol} | نوع ${t.type} | ربح/خسارة: ${t.pnlPerc?.toFixed(2)}% | حالة السوق (Regime): ${t.exitRegime}`).join('\n')}

بناءً على الصفقات المغلقة، حدد أي حالات السوق (Regimes) تنجح فيها الإستراتيجية وأيها تفشل فيها.
قدم توصياتك العلمية والمنطقية المباشرة لتعديل مؤشرات النظام لتحقيق عوائد أفضل وتجنب الإشارات الخاطئة أو الخروج المبكر، وهل تنصح بتغيير قيمة أي مؤشر أو إضافة آخر؟`;
      
      const res = await fetch('/api/gemini/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();
      if (data.success) {
        setGeminiAnalysis(data.text);
      } else {
        setGeminiAnalysis(`حدث خطأ أثناء تحليل البيانات: ${data.message}`);
      }
    } catch (e: any) {
      setGeminiAnalysis(`حدث خطأ: ${e.message}`);
    }
    setIsAnalyzing(false);
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

  const getSovereignTrades = () => {
    return trades.filter(t => t.source?.includes('SOVEREIGN'));
  };

  const sovTrades = getSovereignTrades();
  const successfulTrades = sovTrades.filter(t => (t.pnlPerc || 0) > 0);
  const failedTrades = sovTrades.filter(t => (t.pnlPerc || 0) <= 0);

  return (
    <div className="space-y-6 mx-auto w-full max-w-5xl">
       <div className="flex items-center justify-between">
         <h1 className="text-2xl font-black text-white flex items-center gap-2 tracking-tight">
           <BarChart4 className="w-6 h-6 text-indigo-400" />
           تقارير وإحصاءات النظام الشامل (Sovereign Engine)
         </h1>
         <button 
           onClick={fetchData} 
           className="btn btn-ghost btn-sm text-slate-400 hover:text-white"
           disabled={isLoading}
         >
           <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
         </button>
       </div>

       {stats && (
         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
           {/* Section 1 */}
           <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h2 className="text-lg text-white font-bold mb-4 flex gap-2 items-center"><Activity className="w-4 h-4 text-emerald-400"/> نظرة عامة على الفحوصات</h2>
              <div className="grid grid-cols-2 gap-3 mb-4">
                 <div className="bg-slate-800 p-3 rounded">
                    <p className="text-xs text-slate-400">الفحوصات الإجمالية</p>
                    <p className="text-xl font-bold text-white">{stats.totalEvaluations}</p>
                 </div>
                 <div className="bg-slate-800 p-3 rounded">
                    <p className="text-xs text-slate-400">الصفقات المقبولة إجمالاً</p>
                    <p className="text-xl font-bold text-white">{stats.acceptedLongs + stats.acceptedShorts}</p>
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                 <div className="bg-emerald-900/30 border border-emerald-800/50 p-3 rounded">
                    <p className="text-xs text-emerald-400">لونج (مقبول / فحوصات مسار)</p>
                    <p className="text-lg font-bold text-white">{stats.acceptedLongs} / {stats.totalLongScanned}</p>
                 </div>
                 <div className="bg-rose-900/30 border border-rose-800/50 p-3 rounded">
                    <p className="text-xs text-rose-400">شورت (مقبول / فحوصات مسار)</p>
                    <p className="text-lg font-bold text-white">{stats.acceptedShorts} / {stats.totalShortScanned}</p>
                 </div>
              </div>
           </div>

           {/* Section 2 */}
           <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h2 className="text-lg text-white font-bold mb-4 flex gap-2 items-center"><Target className="w-4 h-4 text-indigo-400"/> أداء شروط الدخول (من الأقوى للأضعف)</h2>
              <div className="h-64 overflow-y-auto pr-2 custom-scrollbar">
                {renderRuleStat('تأكيد مسار EMA50', stats.rules.ema50_trend)}
                {renderRuleStat('توافق EMA50 مع EMA200', stats.rules.ema_alignment)}
                {renderRuleStat('زخم السيولة (RVOL>2.0)', stats.rules.rvol)}
                {renderRuleStat('نمو الفائدة المفتوحة (OI Rising)', stats.rules.oi_rising)}
                {renderRuleStat('سيطرة السوق (Taker Ratio)', stats.rules.taker_ratio)}
                {renderRuleStat('قوة الاتجاه (ADX>25)', stats.rules.adx)}
                {renderRuleStat('كسر قمم/قيعان 10 شموع', stats.rules.price_breakout)}
              </div>
           </div>
         </div>
       )}

       {/* Trades Analytics */}
       <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h2 className="text-lg text-white font-bold mb-4 flex gap-2 items-center"><TrendingUp className="w-4 h-4 text-amber-400"/> أداء النظام الشامل (تاريخ الصفقات المنجزة)</h2>
          
          <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-slate-800 p-4 rounded text-center">
                 <p className="text-xs text-slate-400 mb-1">إجمالي المنفذ</p>
                 <p className="text-2xl font-black text-white">{sovTrades.length}</p>
              </div>
              <div className="bg-emerald-900/40 p-4 rounded text-center border border-emerald-800/50">
                 <p className="text-xs text-emerald-400 mb-1">الصفقات الناجحة</p>
                 <p className="text-2xl font-black text-emerald-300">{successfulTrades.length}</p>
              </div>
              <div className="bg-rose-900/40 p-4 rounded text-center border border-rose-800/50">
                 <p className="text-xs text-rose-400 mb-1">الصفقات الفاشلة</p>
                 <p className="text-2xl font-black text-rose-300">{failedTrades.length}</p>
              </div>
          </div>

          <div className="overflow-x-auto">
             <table className="w-full text-sm text-right text-slate-300">
                <thead className="text-xs text-slate-400 uppercase bg-slate-800">
                   <tr>
                      <th className="px-4 py-3">الرمز</th>
                      <th className="px-4 py-3">النوع</th>
                      <th className="px-4 py-3">الربح %</th>
                      <th className="px-4 py-3">سبب الخروج</th>
                      <th className="px-4 py-3">حالة السوق (Regime)</th>
                   </tr>
                </thead>
                <tbody>
                   {sovTrades.map((t, idx) => (
                      <tr key={idx} className="border-b border-slate-800 hover:bg-slate-800/50 transition">
                         <td className="px-4 py-3 font-bold text-white">{t.symbol}</td>
                         <td className={`px-4 py-3 font-semibold ${t.type === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>{t.type}</td>
                         <td className={`px-4 py-3 font-mono ${(t.pnlPerc || 0) > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{(t.pnlPerc || 0).toFixed(2)}%</td>
                         <td className="px-4 py-3 text-xs opacity-70">{t.exitReason || 'Unknown'}</td>
                         <td className="px-4 py-3"><span className="bg-indigo-900/50 text-indigo-300 text-[10px] px-2 py-1 rounded font-mono">{t.exitRegime || 'UNKNOWN'}</span></td>
                      </tr>
                   ))}
                   {sovTrades.length === 0 && (
                      <tr>
                         <td colSpan={5} className="px-4 py-8 text-center text-slate-500">لا يوجد صفقات منفذة بواسطة هذا النظام في السجل الحالي.</td>
                      </tr>
                   )}
                </tbody>
             </table>
          </div>
       </div>

       {/* Gemini AI Action */}
       <div className="bg-indigo-950/40 border border-indigo-900/50 rounded-xl p-5">
           <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
              <div>
                 <h2 className="text-lg text-indigo-300 font-bold mb-1 flex gap-2 items-center"><BrainCircuit className="w-5 h-5"/> التحليل البعدي المعزز بـ Gemini (Post-Trade Analytics)</h2>
                 <p className="text-xs text-indigo-400/80">احصل على تحليل استراتيجي متكامل للفجوات التقنية ونصائح ضبط المؤشرات للمحرك الشامل بناءً على الإحصائيات الفعليه.</p>
              </div>
              <button 
                 onClick={handleAskGemini}
                 disabled={isAnalyzing || !stats}
                 className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded-lg text-sm flex items-center gap-2 whitespace-nowrap transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                 {isAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Cpu className="w-4 h-4"/>}
                 اصدر التقرير الذكي
              </button>
           </div>

           {geminiAnalysis && (
              <div className="mt-6 bg-slate-900/80 border border-indigo-800/30 p-5 rounded-lg">
                 <h3 className="text-white font-semibold mb-3 flex items-center gap-2"><BrainCircuit className="w-4 h-4 text-indigo-400"/> رد المستشار الذكي:</h3>
                 <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed custom-scrollbar whitespace-pre-wrap">
                    {geminiAnalysis}
                 </div>
              </div>
           )}
       </div>
    </div>
  );
};
