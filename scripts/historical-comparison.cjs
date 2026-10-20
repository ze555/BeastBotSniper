#!/usr/bin/env node
'use strict';
// Offline allocation ablation only. Never imports the live engine or uses network data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'analysis/historical-comparison');
const BASE = '5a67fd60015e022b1f8633e1a610ea066520ac3b';
const FILES = ['study_all_trades_master.json', 'study_master_candles_1m.json'];
const FEE = 0.0004, SLIP = 0.0002;
const TARGET_R = [0.75, 1.8, 3.5];
const OLD = [0.40, 0.35, 0.25], NEW = [0.15, 0.25, 0.60];
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const git = (...args) => cp.execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();
const near = (a, b) => Math.abs(a - b) < 1e-9;

function auditConfig() {
  const old = git('show', `${BASE}:src/lib/apexPredator.ts`);
  const current = read('src/lib/tradeSafety.ts');
  assert(/part_a:\s*0\.40, part_b:\s*0\.35, part_c:\s*0\.25/.test(old));
  assert(/TARGET_WEIGHTS\s*=\s*\[0\.15, 0\.25, 0\.60\]/.test(current));
  assert(/TARGET_R\s*=\s*\[0\.75, 1\.8, 3\.5\]/.test(current));
  for (const [name, val] of [['TP1_R', '0.75'], ['TP2_R', '1.80'], ['TP3_R', '3.50']]) {
    assert(old.includes(`const ${name} = ${val};`), `Baseline ${name} changed`);
  }
  return { baseline_weights: OLD, current_weights: NEW, targets_r: TARGET_R,
    baseline_source_sha256: digest(old), current_source_sha256: digest(current),
    baseline_commit: BASE, current_code_commit: git('rev-parse', 'HEAD') };
}

function replay(trade, candles, weights) {
  assert(near(weights.reduce((a, b) => a + b, 0), 1));
  const entry = Number(trade.entry_price), side = trade.side;
  const et = Date.parse(trade.timestamp_entry), xt = Date.parse(trade.timestamp_exit);
  const targets = [trade.take_profit_1, trade.take_profit_2, trade.take_profit_3].map(Number);
  if (!['LONG', 'SHORT'].includes(side) || !(entry > 0) || !Number.isFinite(et) || !(xt > et)) return { status: 'invalid', net_r: null };
  const sign = side === 'LONG' ? 1 : -1;
  const risk = Math.abs(targets[0] - entry) / TARGET_R[0];
  if (!(risk > 0) || !targets.every((p, i) => Number.isFinite(p) && Math.abs(sign * (p - entry) / risk - TARGET_R[i]) < 0.02)) {
    return { status: 'incompatible_targets', net_r: null };
  }
  const first = Math.ceil(et / 60000) * 60000;
  const seen = new Set();
  const bars = (candles || []).filter(c => {
    const values = [c.time, c.open, c.high, c.low, c.close].map(Number);
    if (!values.every(Number.isFinite) || seen.has(+c.time) || +c.time < first || +c.time + 60000 > xt) return false;
    if (!(c.low > 0 && c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close))) return false;
    seen.add(+c.time); return true;
  }).sort((a, b) => a.time - b.time);
  const gaps = bars.slice(1).filter((c, i) => c.time - bars[i].time !== 60000).length;
  if (!bars.length) return { status: 'no_complete_candle', net_r: null, candles: 0, gaps };
  if (gaps) return { status: 'gapped_data', net_r: null, candles: bars.length, gaps };

  const active = [true, true, true], fills = [];
  let stopR = -1, reason = 'censored_mtm', eventTime = null;
  const toR = price => sign * (price - entry) / risk;
  const fromR = r => entry + sign * risk * r;
  const fill = (i, raw, why, time) => {
    assert(active[i], 'Portion cannot be filled twice');
    active[i] = false;
    const price = raw * (1 - sign * SLIP);
    const net = (sign * (price - entry) - (entry + price) * FEE) / risk;
    fills.push({ part: i + 1, weight: weights[i], reason: why, time, raw_price: raw, fill_price: price, net_r_per_unit: net, weighted_r: weights[i] * net });
  };
  const closeRemaining = (raw, why, time) => {
    for (let i = 0; i < 3; i++) if (active[i]) fill(i, raw, why, time);
    reason = why; eventTime = time;
  };
  const takeTargets = (r, time) => {
    for (let i = 0; i < 3; i++) if (active[i] && r >= TARGET_R[i]) {
      fill(i, targets[i], `TP${i + 1}`, time);
      if (i === 0) stopR = 0.30;
      if (i === 1) stopR = 0.75;
    }
    if (!active.some(Boolean)) { reason = 'TP3'; eventTime = time; }
  };
  for (const c of bars) {
    const openR = toR(c.open);
    if (openR <= stopR) { closeRemaining(c.open, 'STOP', c.time); break; }
    // Favorable gaps fill only at the target, not an invented improved price.
    takeTargets(openR, c.time);
    if (!active.some(Boolean)) break;
    // Shared deterministic path: open -> adverse extreme -> favorable extreme -> close.
    const points = [openR, toR(sign === 1 ? c.low : c.high), toR(sign === 1 ? c.high : c.low), toR(c.close)];
    for (let j = 1; j < points.length && active.some(Boolean); j++) {
      if (points[j] < points[j - 1] && points[j] <= stopR) {
        closeRemaining(fromR(stopR), 'STOP', c.time); break;
      }
      if (points[j] >= points[j - 1]) takeTargets(points[j], c.time);
    }
    if (!active.some(Boolean)) break;
  }
  const resolved = !active.some(Boolean);
  const partialR = fills.reduce((sum, f) => sum + f.weighted_r, 0);
  const last = bars.at(-1);
  if (!resolved) closeRemaining(last.close, 'MTM_CENSOR', last.time + 60000);
  assert(near(fills.reduce((sum, f) => sum + f.weight, 0), 1), 'Every unit must be settled exactly once');
  return { status: resolved ? 'resolved' : 'censored_mtm', net_r: fills.reduce((sum, f) => sum + f.weighted_r, 0),
    partial_realized_r_before_mtm: partialR, candles: bars.length, gaps, first_candle: bars[0].time,
    last_complete_candle: last.time, event_time: eventTime, exit_reason: reason,
    initial_risk_distance: risk, stored_final_stop_not_used: trade.stop_loss, fills };
}

function metrics(rows, variant, resolvedOnly = false) {
  const valid = rows.map(r => r[variant]).filter(r => Number.isFinite(r.net_r) && (!resolvedOnly || r.status === 'resolved'));
  let sum = 0, peak = 0, dd = 0;
  for (const r of valid) { sum += r.net_r; peak = Math.max(peak, sum); dd = Math.max(dd, peak - sum); }
  const wins = valid.filter(r => r.net_r > 0), losses = valid.filter(r => r.net_r < 0);
  const gain = wins.reduce((s, r) => s + r.net_r, 0), loss = -losses.reduce((s, r) => s + r.net_r, 0);
  return { evaluated: valid.length, wins: wins.length, losses: losses.length,
    win_rate: valid.length ? wins.length / valid.length : null, net_r: sum,
    profit_factor: loss ? gain / loss : null, sequence_drawdown_r: dd };
}

function selfTest() {
  const t = { side: 'LONG', entry_price: 100, stop_loss: 123, take_profit_1: 100.75, take_profit_2: 101.8, take_profit_3: 103.5, timestamp_entry: new Date(0).toISOString(), timestamp_exit: new Date(300000).toISOString() };
  const bar = (o, h, l, c, time = 60000) => ({ open: o, high: h, low: l, close: c, time });
  const net = raw => { const p = raw * (1 - SLIP); return p - 100 - (100 + p) * FEE; };
  let r = replay(t, [bar(100, 100.1, 99, 99.5)], OLD);
  assert(near(r.net_r, net(99))); assert.equal(r.fills.length, 3);
  const short = { ...t, side: 'SHORT', take_profit_1: 99.25, take_profit_2: 98.2, take_profit_3: 96.5 };
  r = replay(short, [bar(100, 101, 99.9, 100.5)], OLD);
  const p = 101 * (1 + SLIP); assert(near(r.net_r, 100 - p - (100 + p) * FEE));
  r = replay(t, [bar(100, 100.8, 99.5, 100.2)], OLD);
  assert.equal(r.status, 'resolved'); assert.equal(r.fills[0].reason, 'TP1');
  assert(near(r.net_r, .4 * net(100.75) + .6 * net(100.3)));
  r = replay(t, [bar(100, 104, 99.5, 104)], NEW);
  assert(near(r.net_r, NEW.reduce((s, w, i) => s + w * net([100.75, 101.8, 103.5][i]), 0)));
  r = replay(t, [bar(100, 100.2, 99.5, 100.1)], OLD);
  assert.equal(r.status, 'censored_mtm'); assert(near(r.net_r, net(100.1)));
  r = replay({ ...t, timestamp_entry: new Date(65000).toISOString(), timestamp_exit: new Date(179999).toISOString() }, [bar(100, 104, 98, 104, 60000), bar(100, 104, 98, 104, 120000)], OLD);
  assert.equal(r.status, 'no_complete_candle'); assert.equal(r.net_r, null);
  assert.equal(replay(t, [bar(100, 100.2, 99.5, 100), bar(100, 100.2, 99.5, 100, 180000)], OLD).status, 'gapped_data');
  assert(near(replay({ ...t, stop_loss: 100 }, [bar(100, 100.1, 99, 99.5)], OLD).net_r, net(99)));
  console.log('8 historical replay self-tests passed (numeric costs, exactly-once fills, mirrored stop, same-bar protection, targets, MTM, timing/gaps, moved stop).');
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const config = auditConfig(), sourceTexts = FILES.map(read), trades = JSON.parse(sourceTexts[0]), candles = JSON.parse(sourceTexts[1]);
  const ids = new Set();
  for (const t of trades) { assert(!ids.has(t.trade_id), `Duplicate trade ${t.trade_id}`); ids.add(t.trade_id); }
  const rows = [...trades].sort((a, b) => Date.parse(a.timestamp_entry) - Date.parse(b.timestamp_entry) || a.trade_id.localeCompare(b.trade_id)).map(t => {
    const baseline = replay(t, candles[t.trade_id], OLD), current = replay(t, candles[t.trade_id], NEW);
    return { trade_id: t.trade_id, symbol: t.symbol, entry: t.timestamp_entry, side: t.side,
      baseline, current, delta_net_r: Number.isFinite(baseline.net_r) && Number.isFinite(current.net_r) ? current.net_r - baseline.net_r : null };
  });
  const coverage = { source_trades: trades.length, unique_trades: ids.size, matched_candle_keys: trades.filter(t => Array.isArray(candles[t.trade_id])).length,
    source_candles: Object.values(candles).reduce((s, a) => s + a.length, 0), eligible_full_candles: rows.reduce((s, r) => s + (r.baseline.candles || 0), 0),
    statuses: rows.reduce((counts, r) => { counts[r.baseline.status] = (counts[r.baseline.status] || 0) + 1; return counts; }, {}) };
  const result = { schema_version: 3, method: 'same-entry allocation ablation, not a full strategy backtest', config,
    costs: { fee_each_side: FEE, exit_slippage: SLIP }, source_files: FILES,
    source_sha256: Object.fromEntries(FILES.map((f, i) => [f, digest(sourceTexts[i])])), replay_sha256: digest(fs.readFileSync(__filename, 'utf8')),
    timing_rule: 'Only full candles with open >= ceil(entry/60000)*60000 and open+60000 <= original recorded exit; exclude entry-minute partial and final incomplete candle.',
    bar_path: 'Open -> adverse extreme -> favorable extreme -> close. Existing stop fills first, gaps at open; targets fill at their level; raised stop can trigger on later segments of the same bar. This is one shared conservative path assumption, not tick replay.',
    coverage, metrics: { baseline: { observed_mtm: metrics(rows, 'baseline'), resolved_only: metrics(rows, 'baseline', true) }, current: { observed_mtm: metrics(rows, 'current'), resolved_only: metrics(rows, 'current', true) } },
    limitations: ['Paper trade sample, not real-money fills.', 'Only allocation changes; entries, initial risk, targets and protections held constant; no revised entry gates, structure-target planner, flow, exhaustion, trailing or halts replayed.',
      'MTM horizons are bounded by each original exit and available candles; they are not new strategy exit signals. Entry-minute action is unobserved.',
      'No-complete-candle and gapped streams excluded rather than assigned zero profit.', 'Per-trade R uses equal initial risk units; trades overlap. Sequence drawdown is not account/portfolio drawdown.',
      'Saved pnl_r is terminal price displacement, not realized weighted profit, and is never used. Saved stop_loss can be moved; initial risk recovered from consistent target spacing.', 'Small selected historical sample; no out-of-sample validation or profitability guarantee.'], rows };
  result.metrics.delta_observed_mtm_r = result.metrics.current.observed_mtm.net_r - result.metrics.baseline.observed_mtm.net_r;
  result.metrics.delta_resolved_only_r = result.metrics.current.resolved_only.net_r - result.metrics.baseline.resolved_only.net_r;
  const b = result.metrics.baseline, c = result.metrics.current;
  const headers = ['trade_id', 'symbol', 'entry', 'side', 'status', 'candles', 'baseline_net_r', 'current_net_r', 'delta_net_r', 'baseline_exit', 'current_exit'];
  const quote = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const csv = [headers.join(','), ...rows.map(r => [r.trade_id, r.symbol, r.entry, r.side, r.baseline.status, r.baseline.candles || 0, r.baseline.net_r, r.current.net_r, r.delta_net_r, r.baseline.exit_reason, r.current.exit_reason].map(quote).join(','))].join('\n') + '\n';
  const f = n => n.toFixed(4), pct = n => n === null ? 'غير محسوبة' : (100 * n).toFixed(1) + '%';
  const report = `# هل تحسّن الأداء على الصفقات القديمة؟\n\n**النتيجة مختلطة؛ لا يوجد دليل كافٍ على تحسن الاستراتيجية كاملة.** المقارنة أدناه تختبر تغيير توزيع جني الربح وحده، على نفس مداخل الصفقات وأهدافها. لا تعيد تشغيل كل قواعد الدخول والخروج المصححة.\n\n## المقارنة بالأرقام\n\nالسجلات تخص **${coverage.source_trades} صفقة تجريبية محفوظة (Paper)** مع شموع دقيقة. أمكن تقييم **${b.observed_mtm.evaluated}** صفقة؛ الحالات بلا شمعة كاملة أو ذات فجوات تُستبعد بدل منحها ربحًا صفريًا.\n\n| المقياس | التوزيع السابق 40/35/25% | الجديد 15/25/60% |\n|---|---:|---:|\n| إجمالي العائد عند تسعير المتبقي بآخر إغلاق متاح | ${f(b.observed_mtm.net_r)}R | ${f(c.observed_mtm.net_r)}R |\n| صفقات رابحة بهذا التقييم | ${b.observed_mtm.wins}/${b.observed_mtm.evaluated} | ${c.observed_mtm.wins}/${c.observed_mtm.evaluated} |\n| نسبة الربح بهذا التقييم | ${pct(b.observed_mtm.win_rate)} | ${pct(c.observed_mtm.win_rate)} |\n| العائد من الصفقات المحسومة بوقف أو الأهداف فقط (${b.resolved_only.evaluated}) | ${f(b.resolved_only.net_r)}R | ${f(c.resolved_only.net_r)}R |\n\nفرق التقييم الشامل الجديد ناقص السابق: **${f(result.metrics.delta_observed_mtm_r)}R**. وفرق الصفقات المحسومة فقط: **${f(result.metrics.delta_resolved_only_r)}R**. لا يصح انتقاء أحد الرقمين وإخفاء الآخر.\n\n**R** وحدة المخاطرة الأصلية لكل صفقة، وليس نسبة مئوية من الحساب. جُمعت الوحدات دون محاكاة رصيد مركّب أو حدود عدد المراكز؛ لذلك ليست هذه نتيجة محفظة فعلية.\n\n## ما الذي تم اختباره؟\n\nثبتنا الدخول والمخاطرة الأولية والأهداف 0.75R و1.8R و3.5R، مع حماية الوقف عند +0.30R بعد الهدف الأول و+0.75R بعد الثاني. التغيير الوحيد بين العمودين هو أوزان الأهداف. الرسوم **0.04% لكل جانب** والانزلاق عند الخروج **0.02%** متساويان. لم تُضبط المعلمات لاستخراج نتيجة أفضل.\n\nلم نحسب الربح من حقل pnl_r المحفوظ لأنه يقيس حركة السعر عند الخروج لا إجمالي الربح الموزون. واستخرجنا الوقف الابتدائي من تباعد الأهداف المتسق بدل الوقف النهائي الذي قد يكون متحركًا.\n\n## لماذا لا تُعد النتيجة إثباتًا؟\n\nتوزيع الحالات: ${Object.entries(coverage.statuses).map(([k,v]) => k + ': ' + v).join('؛ ')}. تُسعّر المراكز غير المحسومة افتراضيًا عند آخر شمعة كاملة ضمن نافذة الخروج الأصلية، لا عند خروج تولّده الاستراتيجية الجديدة. أغلب الحالات قد لا تصل إلى نهاية طبيعية داخل النافذة؛ هذه نقطة ضعف مهمة.\n\nلا تتوافر سلسلة كاملة كافية لإعادة بناء كل بوابات الدخول وسياق بيتكوين وتدفق الأوامر ووقف التتبع والإنهاك. استُبعدت دقيقة الدخول غير المكتملة وأي شمعة لا تكتمل قبل الخروج الأصلي، واستُخدم نفس مسار OHLC الافتراضي للنسختين: الافتتاح ثم الطرف المعاكس ثم الطرف الملائم ثم الإغلاق؛ لا نعرف ترتيب الأسعار الفعلي داخل الدقيقة.\n\n**الخلاصة:** الإصلاحات البرمجية واختبارات الأنواع لا تعني تلقائيًا ربحية أفضل. لا أوصي باعتماد تغيير توزيع الأهداف بوصفه تحسينًا مثبتًا؛ يلزمه اختبار كامل خارج هذه العينة ببيانات زمنية مكتملة. لم يحدث دمج أو نشر أو تداول حقيقي، ولم تتغير السجلات التاريخية.\n\nالتفاصيل لكل صفقة في [per-trade.csv](per-trade.csv)، والإعدادات والبصمات والمحاسبة في [comparison.json](comparison.json). أمر التكرار: node scripts/historical-comparison.cjs --self-test ثم node scripts/historical-comparison.cjs.\n`;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'comparison.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'per-trade.csv'), csv);
  fs.writeFileSync(path.join(OUT, 'results.ar.md'), report);
  FILES.forEach((file, i) => assert.equal(read(file), sourceTexts[i], `Source mutated: ${file}`));
  console.log(JSON.stringify({ coverage, metrics: result.metrics }, null, 2));
}
main();
