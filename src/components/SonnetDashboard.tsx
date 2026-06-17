import React, { useState, useEffect } from 'react';
import { RefreshCw, BrainCircuit, Activity, BarChart4, TrendingUp, TrendingDown, Target, Cpu, Crosshair } from 'lucide-react';

export const SonnetDashboard: React.FC = () => {
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
      const statsRes = await fetch('/api/sonnet/stats');
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

  const handleAskGemini = async () => {
    setIsAnalyzing(true);
    try {
      const prompt = `أنت خبير مالي ومحلل خوارزمي لنظام تداول يسمى (Sonnet Engine - APEX SNIPER v3).
النظام يعتمد على 7 طبقات أساسية للحماية والدخول.
إليك إحصائيات النظام حتى الآن:
إجمالي محاولات الفحص: ${stats?.totalEvaluations}
محاولات الشراء (Long) مع الاتجاه: ${stats?.totalLongScanned} | المقبول منها: ${stats?.acceptedLongs}
محاولات البيع (Short) مع الاتجاه: ${stats?.totalShortScanned} | المقبول منها: ${stats?.acceptedShorts}

أداء الطبقات السبعة (كم مرة تجاوزت وكم مرة رفضت بناءً على توافق الاتجاه الأساسي):
1. حارس البيتكوين: (نجح: ${stats?.rules.btc_guard.passed}, تأمن/منع: ${stats?.rules.btc_guard.failed})
2. تحليل الاتجاه الكبير: (نجح: ${stats?.rules.htf_trend.passed}, فشل: ${stats?.rules.htf_trend.failed})
3. البنية الدقيقة للسوق: (نجح: ${stats?.rules.microstructure.passed}, فشل: ${stats?.rules.microstructure.failed})
4. الحمض النووي للسيولة: (نجح: ${stats?.rules.volume_dna.passed}, فشل: ${stats?.rules.volume_dna.failed})
5. جودة الشموع: (نجح: ${stats?.rules.candle_quality.passed}, فشل: ${stats?.rules.candle_quality.failed})
6. ذاكرة الاختراقات الكاذبة: (نجح: ${stats?.rules.false_breakout.passed}, فشل: ${stats?.rules.false_breakout.failed})
7. تقاطع الزخم: (نجح: ${stats?.rules.momentum.passed}, فشل: ${stats?.rules.momentum.failed})

يرجى تحليل هذه البيانات ومعرفة ما هي أكثر طبقة تمنع الصفقات وتتسبب بانخفاض نسبة الدخول، وهل شروط البنية الدقيقة للسوق قاسية جداً؟

بيانات الصفقات المغلقة لهذا النظام:
${trades.filter((t: any) => t.source?.includes('SONNET')).map((t: any) => `- عملة ${t.symbol} | نوع ${t.type} | ربح/خسارة: ${t.pnlPerc?.toFixed(2)}% | حالة السوق (Regime): ${t.exitRegime}`).join('\n')}

بناءً على الصفقات المغلقة، حدد قوة النظام في تحقيق أرباح، وقدم توصيات لمعايرة محرك APEX v3 والطبقات الخاصة به (مثل تخفيف قيود جودة الشموع أو الحجم).`;
      
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

  const getSonnetTrades = () => {
    return trades.filter(t => t.source?.includes('SONNET'));
  };

  const sovTrades = getSonnetTrades();
  const successfulTrades = sovTrades.filter(t => (t.pnlPerc || 0) > 0);
  const failedTrades = sovTrades.filter(t => (t.pnlPerc || 0) <= 0);

  return (
    <div className="space-y-6 mx-auto w-full max-w-5xl">
       <div className="flex items-center justify-between">
         <h1 className="text-2xl font-black text-white flex items-center gap-2 tracking-tight">
           <Crosshair className="w-6 h-6 text-red-500" />
           تقارير وإحصاءات محرك (APEX SNIPER v3)
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
           <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-[0_0_15px_rgba(239,68,68,0.05)] border-l-4 border-l-red-500/50">
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
           <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-[0_0_15px_rgba(239,68,68,0.05)]">
              <h2 className="text-lg text-white font-bold mb-4 flex gap-2 items-center"><Target className="w-4 h-4 text-red-400"/> أداء شروط الدخول (طبقات الحماية)</h2>
              <div className="h-64 overflow-y-auto pr-2 custom-scrollbar">
                {renderRuleStat('حارس البيتكوين', stats.rules.btc_guard)}
                {renderRuleStat('توافق الاتجاه الكبير', stats.rules.htf_trend)}
                {renderRuleStat('البنية الدقيقة للسوق', stats.rules.microstructure)}
                {renderRuleStat('الحمض النووي للسيولة', stats.rules.volume_dna)}
                {renderRuleStat('جودة الشموع', stats.rules.candle_quality)}
                {renderRuleStat('الذاكرة (الفخاخ الكاذبة)', stats.rules.false_breakout)}
                {renderRuleStat('تقاطع الزخم', stats.rules.momentum)}
              </div>
           </div>
         </div>
       )}

       {/* Trades Analytics */}
       <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-[0_0_15px_rgba(239,68,68,0.05)]">
          <h2 className="text-lg text-white font-bold mb-4 flex gap-2 items-center"><TrendingUp className="w-4 h-4 text-emerald-400"/> أداء نظام القناص (تاريخ الصفقات المنفذة)</h2>
          
          <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-slate-800 p-4 rounded text-center border-l-2 border-slate-600">
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
                      <th className="px-4 py-3">حالة السوق</th>
                   </tr>
                </thead>
                <tbody>
                   {sovTrades.map((t, idx) => (
                      <tr key={idx} className="border-b border-slate-800 hover:bg-slate-800/50 transition">
                         <td className="px-4 py-3 font-bold text-white">{t.symbol}</td>
                         <td className={`px-4 py-3 font-semibold ${t.type === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>{t.type}</td>
                         <td className={`px-4 py-3 font-mono ${(t.pnlPerc || 0) > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{(t.pnlPerc || 0).toFixed(2)}%</td>
                         <td className="px-4 py-3 text-xs opacity-70">{t.exitReason || 'Unknown'}</td>
                         <td className="px-4 py-3"><span className="bg-slate-700 text-slate-300 text-[10px] px-2 py-1 rounded font-mono">{t.exitRegime || 'UNKNOWN'}</span></td>
                      </tr>
                   ))}
                   {sovTrades.length === 0 && (
                      <tr>
                         <td colSpan={5} className="px-4 py-8 text-center text-slate-500">لا يوجد صفقات منفذة بواسطة نظام القناص في السجل الحالي.</td>
                      </tr>
                   )}
                </tbody>
             </table>
          </div>
       </div>

       {/* Gemini AI Action */}
       <div className="bg-red-950/20 border border-red-900/50 rounded-xl p-5 shadow-[0_0_15px_rgba(239,68,68,0.1)] relative overflow-hidden">
           <div className="absolute top-0 left-0 p-4 opacity-5 pointer-events-none"><BrainCircuit className="w-40 h-40 text-red-500 rotate-12"/></div>
           <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between relative z-10">
              <div>
                 <h2 className="text-lg text-red-300 font-bold mb-1 flex gap-2 items-center"><BrainCircuit className="w-5 h-5"/> التوجيه الخوارزمي (AI Post-Trade Insight)</h2>
                 <p className="text-xs text-red-400/80">استعن بالذكاء الاصطناعي لتحليل أي من المستويات السبعة هو الأكثر إعاقة لدخول الصفقات وما هي الحلول المثالية.</p>
              </div>
              <button 
                 onClick={handleAskGemini}
                 disabled={isAnalyzing || !stats}
                 className="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-6 rounded-lg text-sm flex items-center gap-2 whitespace-nowrap transition disabled:opacity-50 disabled:cursor-not-allowed border border-red-400/30"
              >
                 {isAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Cpu className="w-4 h-4"/>}
                 استخراج الإستراتيجية
              </button>
           </div>

           {geminiAnalysis && (
              <div className="mt-6 bg-slate-900/90 border border-red-500/30 p-5 rounded-lg relative z-10 shadow-lg">
                 <h3 className="text-white font-semibold mb-3 flex items-center gap-2"><BrainCircuit className="w-4 h-4 text-red-400"/> التحليل الذكي للطبقات:</h3>
                 <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed custom-scrollbar whitespace-pre-wrap">
                    {geminiAnalysis}
                 </div>
              </div>
           )}
       </div>
    </div>
  );
};
