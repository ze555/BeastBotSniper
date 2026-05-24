import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Square, 
  TrendingUp, 
  Coins, 
  Activity, 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  Layers, 
  Gauge,
  Compass,
  ArrowRight
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend 
} from 'recharts';

interface Scenario {
  id: string;
  name: string;
  description: string;
  regime: string;
}

interface AuditLog {
  step: number;
  time: number;
  price: number;
  openInterest: number;
  takerRatio: number;
  decision: string;
  activeState: string;
  expansionProb: number;
  exhaustionProb: number;
  distributionProb: number;
  pnl: number;
  sizeMultiplier: number;
  executionTactic: string;
  message: string;
}

interface BacktestResult {
  scenarioId: string;
  scenarioName: string;
  totalSteps: number;
  status: 'SUCCESS' | 'STOPPED_OUT' | 'NO_TRADE' | 'ACTIVE';
  entryPrice: number;
  exitPrice: number;
  maxDrawdown: number;
  peakPnL: number;
  finalPnL: number;
  auditLogs: AuditLog[];
  chartData: any[];
}

export function ReplaySimulatorView() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [portfolioSize, setPortfolioSize] = useState<number>(5000);
  const [leverage, setLeverage] = useState<number>(10);
  const [beastMode, setBeastMode] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  
  // Real-time animation streaming state variables
  const [streaming, setStreaming] = useState<boolean>(false);
  const [streamIndex, setStreamIndex] = useState<number>(0);
  const [displayedLogs, setDisplayedLogs] = useState<AuditLog[]>([]);
  const [displayedChartData, setDisplayedChartData] = useState<any[]>([]);

  useEffect(() => {
    fetchScenarios();
  }, []);

  const fetchScenarios = async () => {
    try {
      const res = await fetch('/api/backtest/scenarios');
      const data = await res.json();
      setScenarios(data);
      if (data.length > 0) {
        setSelectedScenarioId(data[0].id);
      }
    } catch (e) {
      console.error('Error fetching scenarios:', e);
    }
  };

  const runBacktestAndStream = async () => {
    if (!selectedScenarioId) return;
    setLoading(true);
    setStreaming(false);
    setResult(null);

    try {
      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: selectedScenarioId,
          settings: {
            portfolioSize,
            leverage,
            beastMode,
            maxConcurrentTrades: 5,
            minPositionSizePerc: 5,
            tradingFeeRate: 0.0006
          }
        })
      });

      const fullResult: BacktestResult = await res.json();
      setResult(fullResult);
      setLoading(false);
      
      // Start animated streaming
      setStreaming(true);
      setStreamIndex(0);
      setDisplayedLogs([]);
      setDisplayedChartData([]);
    } catch (e) {
      console.error('Error executing simulation:', e);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!streaming || !result) return;

    if (streamIndex < result.chartData.length) {
      const timer = setTimeout(() => {
        // Add chart point
        setDisplayedChartData(prev => [...prev, result.chartData[streamIndex]]);
        
        // Find any logs associated with this step
        const associatedLogs = result.auditLogs.filter(log => log.step === streamIndex + 1);
        if (associatedLogs.length > 0) {
          setDisplayedLogs(prev => [...associatedLogs, ...prev]);
        }
        
        setStreamIndex(prev => prev + 1);
      }, 150); // stream a tick every 150ms

      return () => clearTimeout(timer);
    } else {
      setStreaming(false);
    }
  }, [streaming, streamIndex, result]);

  const activeScenario = scenarios.find(s => s.id === selectedScenarioId);

  return (
    <div className="space-y-6" id="replay-simulator-view">
      {/* HEADER CARD */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-md" id="replay-header">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold font-sans text-slate-100 flex items-center gap-2">
              <Compass className="text-amber-500 w-5 h-5 animate-spin-slow" />
              محاكي السيولة الهيكلي وإعادة البث التكتيكي
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              اختبر ردود أفعال آلية اتخاذ القرار (Stateful Reasoning Engine) من خلال ضخ محاكاة تدفقات سيولة حية وعقود مفتوحة (OI) ونسب شراء صانعي السوق (CVD).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="bg-emerald-950 text-emerald-400 text-xs px-2 py-1 rounded border border-emerald-900 font-mono">
              ★ Stateful Evaluation
            </span>
            <span className="bg-amber-950 text-amber-400 text-xs px-2 py-1 rounded border border-amber-900 font-mono">
              ★ Microstructure Logic
            </span>
          </div>
        </div>
      </div>

      {/* PARAMETERS GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="replay-config-grid">
        {/* CONFIG SECTION */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4" id="replay-settings-card">
          <h3 className="text-sm font-semibold text-slate-200 border-b border-slate-800 pb-2 flex items-center gap-2">
            <Gauge className="text-teal-500 w-4 h-4" />
            إعدادات بيئة البث والمحاكاة
          </h3>

          {/* Scenario chooser */}
          <div className="space-y-2">
            <label className="text-xs text-slate-400 block font-medium">اختر سيناريو السيولة والتدفق</label>
            <div className="grid grid-cols-1 gap-2">
              {scenarios.map(s => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelectedScenarioId(s.id);
                    setResult(null);
                    setStreaming(false);
                  }}
                  className={`text-right p-3 rounded-lg border text-xs transition duration-200 flex flex-col gap-1 ${
                    selectedScenarioId === s.id
                      ? 'bg-amber-950/40 border-amber-500 text-amber-100'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <span className="font-bold flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${selectedScenarioId === s.id ? 'bg-amber-400' : 'bg-slate-600'}`}></span>
                    {s.name}
                  </span>
                  <span className="text-[10px] text-slate-400 leading-relaxed font-sans mt-0.5">
                    {s.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Sizing multipliers info */}
          <div className="space-y-3 pt-2">
            <div className="bg-slate-950/80 rounded-lg p-3 border border-slate-800 space-y-2">
              <span className="text-[11px] font-bold text-amber-400 block pb-1 border-b border-slate-900">
                ميزة التحكم بالمخاطر وتكتيكات التداول:
              </span>
              <ul className="text-[10px] text-slate-400 space-y-1 block list-disc list-inside">
                <li>معيار سيولة الدفتر يغير التكتيك بين (Twap, Limit, Market)</li>
                <li>حجم الصفقة ديناميكي بالكامل بناءً على الثقة والاستقرار</li>
                <li>تكامل ذكي مع حجم الـ Stop Loss والرافعة لتقليل الانزلاق</li>
              </ul>
            </div>
          </div>

          {/* Portfolio & Lever */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">حجم المحفظة المحاكاة ($)</label>
              <input 
                type="number"
                value={portfolioSize}
                onChange={(e) => setPortfolioSize(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:border-amber-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">الرافعة المالية القصوى</label>
              <input 
                type="number"
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:border-amber-500 outline-none"
              />
            </div>
          </div>

          <button
            onClick={runBacktestAndStream}
            disabled={loading || !selectedScenarioId}
            className="w-full bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-xs py-2.5 px-4 rounded-lg transition duration-200 shadow flex items-center justify-center gap-1"
          >
            {loading ? (
              <span className="animate-spin h-4 w-4 border-2 border-slate-950 border-t-transparent rounded-full"></span>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                تحميل وبث محاكاة الحدث الهيكلي
              </>
            )}
          </button>
        </div>

        {/* RESULTS METRICS (PEAK STATS) */}
        <div className="lg:col-span-2 flex flex-col justify-between space-y-4" id="replay-results-card">
          {/* TOP SPEED METRICS */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between h-24">
              <span className="text-[10px] text-slate-400 font-medium">حالة المحاكاة الحالية</span>
              <div className="flex items-center gap-1.5 mt-2">
                {streaming ? (
                  <span className="flex h-2.5 w-2.5 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                  </span>
                ) : null}
                <span className="text-sm font-bold text-slate-100 font-mono">
                  {streaming ? `بث الخطوة ${streamIndex}` : result ? 'مكتمل' : 'بانتظار التحميل'}
                </span>
              </div>
              <span className="text-[9px] text-slate-500">معدل البث 150ms / حركة</span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between h-24">
              <span className="text-[10px] text-slate-400 font-medium">الربح/الخسارة الصافي المولد</span>
              <span className={`text-lg font-extrabold font-mono mt-2 ${
                result ? (result.finalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-500'
              }`}>
                {result ? `${result.finalPnL >= 0 ? '+' : ''}$${result.finalPnL.toFixed(2)}` : '$0.00'}
              </span>
              <span className="text-[9px] text-slate-500">شاملاً لرسوم المنصة والنزلاق السعري</span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between h-24">
              <span className="text-[10px] text-slate-400 font-medium">أعلى ذروة ربح (Peak PnL)</span>
              <span className="text-lg font-extrabold font-mono text-emerald-400 mt-2">
                {result ? `$${result.peakPnL.toFixed(2)}` : '$0.00'}
              </span>
              <span className="text-[9px] text-slate-500">أعلى مكاسب ورقية غير محققة</span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between h-24">
              <span className="text-[10px] text-slate-400 font-medium">أقصى تراجع محاكي (Drawdown)</span>
              <span className="text-lg font-extrabold font-mono text-rose-500 mt-2">
                {result ? `$${Math.abs(result.maxDrawdown).toFixed(2)}` : '$0.00'}
              </span>
              <span className="text-[9px] text-slate-500">أقصى عمق تصحيحي داخل الصفقة</span>
            </div>
          </div>

          {/* REAL-TIME SIMULATION CHART */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex-1 flex flex-col justify-between min-h-[280px]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <h3 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Activity className="text-amber-500 w-4 h-4" />
                المخطط المتوازن للسيولة والسعر (Price vs Open Interest / CVD)
              </h3>
              <span className="text-[10px] font-mono text-slate-500">
                Scenario: {activeScenario ? activeScenario.name : 'Not Simulated'}
              </span>
            </div>

            <div className="flex-1 w-full h-[220px]">
              {displayedChartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-lg">
                  قم ببدء البث لعرض الشارات والبيانات المتناسقة
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={displayedChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                    <XAxis dataKey="step" stroke="#64748b" fontSize={10} tickLine={false} />
                    <YAxis yAxisId="left" stroke="#38bdf8" fontSize={10} domain={['auto', 'auto']} tickLine={false} />
                    <YAxis yAxisId="right" orientation="right" stroke="#fbbf24" fontSize={10} domain={['auto', 'auto']} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                      labelStyle={{ color: '#94a3b8', fontSize: '10px' }}
                      itemStyle={{ fontSize: '11px', color: '#f8fafc' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '10px', marginTop: '5px' }} />
                    <Line yAxisId="left" type="monotone" dataKey="price" name="السعر المحاكي" stroke="#38bdf8" strokeWidth={2.5} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="openInterest" name="الفائدة المفتوحة (OI)" stroke="#fbbf24" strokeWidth={1.5} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="takerRatio" name="معامل CVD (نسبة الشراء لماركت)" stroke="#f43f5e" strokeWidth={1} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* DETAILED SIGNAL AUDIT LOGS / STATE MACHINE THINKING */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5" id="replay-audit-card">
        <h3 className="text-sm font-semibold text-slate-200 border-b border-slate-800 pb-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <FileText className="text-slate-400 w-4 h-4" />
            سجل التدقيق البرمجي لقرارات المحرك (Engine Signal Audit Trails)
          </span>
          <span className="bg-slate-950 px-2 py-0.5 rounded text-[10px] text-slate-400 font-mono">
            {displayedLogs.length} سجلات بث حالية
          </span>
        </h3>

        <div className="mt-4 space-y-3 max-h-[400px] overflow-y-auto pr-1" id="replay-logs-container">
          {displayedLogs.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-500">
              بانتظار إطلاق البث لرصد تفكير الآلة وتحديد طبقات الفشل أو الكفاح
            </div>
          ) : (
            displayedLogs.map((log, index) => {
              const pnlColor = log.pnl > 0 ? 'text-emerald-400' : log.pnl < 0 ? 'text-rose-400' : 'text-slate-400';
              const decisionType = log.decision;
              let decisionBadge = 'bg-slate-950 text-slate-400 border-slate-800';
              
              if (decisionType.startsWith('ENTER')) {
                decisionBadge = 'bg-emerald-950 text-emerald-400 border-emerald-900';
              } else if (decisionType === 'CLOSE') {
                decisionBadge = 'bg-rose-950 text-rose-400 border-rose-900';
              } else if (decisionType === 'PARTIAL_EXIT') {
                decisionBadge = 'bg-purple-950 text-purple-400 border-purple-900';
              } else if (decisionType === 'COMMITTED') {
                decisionBadge = 'bg-slate-800 text-slate-200 border-slate-700';
              }

              return (
                <div key={index} className="bg-slate-950 rounded-lg p-4 border border-slate-850 space-y-3 transition duration-150 hover:bg-slate-9000/40">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-slate-900 pb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="bg-slate-900 text-slate-300 font-mono text-[10px] px-1.5 py-0.5 rounded">
                        خطوة المحاكاة {log.step}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${decisionBadge}`}>
                        {decisionType}
                      </span>
                      <span className="bg-slate-900 text-slate-400 text-[10px] px-1.5 py-0.5 rounded font-mono">
                        السعر: {log.price.toFixed(2)}
                      </span>
                      <span className="bg-slate-900 text-teal-400 text-[10px] px-1.5 py-0.5 rounded font-mono">
                        OI: {log.openInterest.toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      {log.pnl !== 0 && (
                        <span className={`text-xs font-mono font-bold ${pnlColor}`}>
                          P&L: ${log.pnl.toFixed(2)}
                        </span>
                      )}
                      
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(log.time).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  {/* PROBABILITY GAUGE ROW */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-900/60 p-2 rounded border border-slate-900">
                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-400 block font-medium">احتمال التوسع السعري (Expansion)</span>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-950 h-2 rounded overflow-hidden">
                          <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${log.expansionProb}%` }}></div>
                        </div>
                        <span className="text-[10px] font-mono text-slate-300 w-8">{log.expansionProb}%</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-400 block font-medium">احتمال نضوب السيولة (Exhaustion)</span>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-950 h-2 rounded overflow-hidden">
                          <div className="bg-yellow-500 h-full transition-all duration-300" style={{ width: `${log.exhaustionProb}%` }}></div>
                        </div>
                        <span className="text-[10px] font-mono text-slate-300 w-8">{log.exhaustionProb}%</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[9px] text-slate-400 block font-medium">احتمال التوزيع العشوائي (Distribution)</span>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-950 h-2 rounded overflow-hidden">
                          <div className="bg-rose-500 h-full transition-all duration-300" style={{ width: `${log.distributionProb}%` }}></div>
                        </div>
                        <span className="text-[10px] font-mono text-slate-300 w-8">{log.distributionProb}%</span>
                      </div>
                    </div>
                  </div>

                  {/* NARRATIVE MESSAGE */}
                  <p className="text-xs text-slate-300 leading-relaxed font-sans mt-2">
                    {log.message}
                  </p>

                  {/* PARAMETERS FOOTER */}
                  {log.executionTactic !== 'NONE' && (
                    <div className="flex items-center gap-4 text-[9px] text-slate-400 pt-1 border-t border-slate-900">
                      <span>تكتيك الحجم: <strong className="text-amber-400 font-mono font-bold">{log.sizeMultiplier}x</strong></span>
                      <span>سوق التنفيذ المختار: <strong className="text-slate-200">{log.executionTactic}</strong></span>
                      <span>الحالة الحركية: <strong className="text-orange-400 font-mono font-semibold">{log.activeState}</strong></span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
