/**
 * المهندس — الطبقة الاستباقية: كشف العطل قبل أن يراه المالك (2026-10-28).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyFailure } from '../ops/defectLedger';
import { PROBE_ROUTES, PROACTIVE_POLICY, evaluateProbe, summarizeRound, deployVerdict, RouteLatency, slowRoutes, isSpiking, buildForecasts, notificationHygiene, judgeBoot, type ForecastInput } from '../ops/engineerProactive';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (n: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(n + (info ? ` — ${info}` : '')); };
const NOW = Date.parse('2026-10-28T12:00:00Z');
const H = 3600000;

// 1) مسارات الفحص: موجودة فعلاً، قراءة داخلية فقط
const server = read('server.ts'); const routes = read('engine/social/routes.ts');
for (const r of PROBE_ROUTES) {
  const base = r.path.split('?')[0];
  const exists = server.includes(`app.get("${base}"`) || routes.includes(`app.get('${base}'`);
  check(`مسار الفحص موجود: ${base}`, exists);
  check(`مسار الفحص لا يكتب ولا يتصل بمزوّد: ${base}`, !/oauth|webhook-info|sync|run|poll|publish|send|refresh|verify|backup/i.test(base));
}
check('★ 15+ شاشة تُفحص', PROBE_ROUTES.length >= 15);

// 2) الحكم على الفحص
const ok = evaluateProbe(PROBE_ROUTES[0], { status: 200, ms: 120 }, NOW);
const bad = evaluateProbe(PROBE_ROUTES[3], { status: 500, ms: 300, detail: '/api/live/room أجاب 500 — x' }, NOW);
const slow = evaluateProbe(PROBE_ROUTES[4], { status: 200, ms: 9000 }, NOW);
check('سليم/فاشل/بطيء', ok.ok && !ok.slow && !bad.ok && slow.ok && slow.slow);
check('لا جواب (0) = فشل', !evaluateProbe(PROBE_ROUTES[0], { status: 0, ms: 45000 }, NOW).ok);
const prev = summarizeRound([ok, evaluateProbe(PROBE_ROUTES[3], { status: 200, ms: 100 }, NOW)], 'schedule', 'aaa', NOW - H);
const round = summarizeRound([ok, bad], 'deploy', 'bbb', NOW);
const v = deployVerdict(round, prev);
check('★ فحص ما بعد النشر يكشف شاشة كانت تعمل وتعطّلت بالنسخة الجديدة', !v.ok && v.regressions.length === 1 && /كانت تعمل قبل النشر/.test(v.summary), v.summary);
check('النسخة السليمة تُعلن سليمة', deployVerdict(summarizeRound([ok], 'deploy', 'ccc', NOW), null).ok);

// 3) زمن المسارات
const L = new RouteLatency();
for (let i = 0; i < 20; i++) L.record('/api/slow', i < 18 ? 6000 : 300, 200, NOW);
for (let i = 0; i < 20; i++) L.record('/api/fast', 50, 200, NOW);
const sum = L.summary();
check('★ p95 لكل مسار والأبطأ أولاً', sum[0].route === '/api/slow' && sum[0].p95 >= 6000 && sum[1].p95 <= 60);
check('★ المسار المتباطئ يُنذر به', slowRoutes(sum).some((x) => x.route === '/api/slow') && !slowRoutes(sum).some((x) => x.route === '/api/fast'));
check('الانتظار الطويل المقصود لا يُعدّ بطئاً', slowRoutes([{ route: '/api/live/room?wait=1', n: 9, p50: 20000, p95: 20000, errors: 0 }]).length === 0);

// 4) التصاعد
check('★ 5 مرات في 10 دقائق = يتصاعد', isSpiking([NOW - 60000, NOW - 50000, NOW - 40000, NOW - 30000, NOW], NOW));
check('متفرقة ≠ تصاعد', !isSpiking([NOW - 5 * H, NOW - 3 * H, NOW - H, NOW - 30 * 60000, NOW], NOW));

// 5) التوقعات
const base: ForecastInput = {
  nowMs: NOW, platforms: [], collections: [], memory: { mb: 200, limitMb: 512, slopeMbPerHour: 0 }, youtubeQuota: null, gemini: null, slow: [], spiking: [], backup: null,
};
check('لا شيء متوقع في حالة سليمة', buildForecasts(base).length === 0);
const fb = buildForecasts({ ...base, platforms: [{ id: 'facebook', label: 'فيسبوك', connected: true, expiresAt: new Date(NOW + 30 * H).toISOString(), refreshable: false }] });
check('★ رمز فيسبوك ينتهي بعد 30 ساعة ⇒ حرج بيد المالك قبل الوقوع', fb[0]?.severity === 'critical' && fb[0].owner === 'owner' && /أعد ربط فيسبوك/.test(fb[0].action), JSON.stringify(fb[0]));
check('رمز يُجدَّد تلقائياً (يوتيوب) لا يُنذر', buildForecasts({ ...base, platforms: [{ id: 'youtube', label: 'يوتيوب', connected: true, expiresAt: new Date(NOW + H).toISOString(), refreshable: true }] }).length === 0);
const cap = buildForecasts({ ...base, collections: [{ key: 'socialComments', label: 'التعليقات', size: 9500, cap: 10000, growthPerDay: 100 }] });
check('★ مجموعة تمتلئ بعد 5 أيام ⇒ حرج قبل القصّ الصامت', cap[0]?.severity === 'critical' && /5 يوم|120 ساعة/.test(cap[0].title), cap[0]?.title);
const mem = buildForecasts({ ...base, memory: { mb: 450, limitMb: 512, slopeMbPerHour: 20 } });
check('★ الذاكرة تبلغ الحد بعد ~3 ساعات ⇒ حرج', mem[0]?.id === 'memory' && mem[0].severity === 'critical');
const gem = buildForecasts({ ...base, gemini: { used: 80, limit: 100, hoursElapsed: 4, hoursLeftInDay: 20 } });
check('حصة Gemini بهذا المعدل تنفد قبل نهاية اليوم ⇒ إنذار', gem.some((x) => x.id === 'gemini-quota'));
check('العطل المتصاعد يظهر في التوقعات', buildForecasts({ ...base, spiking: [{ title: 'x', count10m: 7 }] })[0]?.id === 'spike:x');
check('الحرج قبل التحذير', buildForecasts({ ...base, slow: [{ route: '/a', p95: 6000 }], spiking: [{ title: 'y', count10m: 6 }] })[0].severity === 'critical');

// 6) نظافة الإشعارات
const day = 86400000;
const rows = [
  { id: 'c1', severity: 'critical', createdAt: new Date(NOW - 60 * day).toISOString(), title: 'ربط' },
  { id: 'i1', severity: 'info', createdAt: new Date(NOW - 10 * day).toISOString(), title: 'a', type: 't' },
  { id: 'i2', severity: 'info', createdAt: new Date(NOW - day).toISOString(), title: 'dup', type: 'd' },
  { id: 'i3', severity: 'info', createdAt: new Date(NOW - 2 * day).toISOString(), title: 'dup', type: 'd' },
  { id: 'w1', severity: 'warning', createdAt: new Date(NOW - 10 * day).toISOString(), title: 'w' },
  { id: 'r1', severity: 'info', createdAt: new Date(NOW - 30 * day).toISOString(), title: 'old read', read: true },
];
const h = notificationHygiene(rows, NOW);
check('★ الحرج لا يُلمس أبداً', !h.ids.includes('c1'));
check('★ القديم المعلوماتي والمكرر يُعلَّمان مقروءين', h.ids.includes('i1') && h.ids.includes('i3') && !h.ids.includes('i2'));
check('التحذير الحديث نسبياً يبقى', !h.ids.includes('w1'));
check('المقروء لا يُعاد', !h.ids.includes('r1'));

// 7) التوصيل
check('★ جولة فحص كل 10 دقائق + فحص ما بعد النشر', server.includes('void runProbeRound("deploy")') && server.includes('PROACTIVE_POLICY.probeIntervalMs'));
check('★ ما يفشل في الفحص يدخل سجل الأعطال فيُصلَح', server.includes('كشفه الفحص الاستباقي قبل أن يراه المالك'));
check('★ الفحص بالمسار الحقيقي ولا يملأ سجل التدقيق', server.includes('engineerReplayGet(route.path, { audit: false })'));
check('★ زمن كل مسار يُقاس من الطلبات الحقيقية', server.includes('routeLatency.record(normalizeRoute(path), ms, status)'));
check('★ العطل المتصاعد يُرفع حرجاً ويُنذر', server.includes('"engineer_spike"'));
check('★ تحرير الأعلام العالقة بتقرير', server.includes('check("metrics", metricsSyncRunning'));
check('★ «افحص الآن» يشغّل جولة الفحص فوراً', server.includes('await runProbeRound("manual");'));
check('★ الشاشات والتوقعات تدخل صحة المشروع', read('engine/ops/engineerPatrol.ts').includes("c('core.probes'") && read('engine/ops/engineerPatrol.ts').includes("c('core.forecasts'"));
check('★ تبويب «الاستباقي» في غرفة المهندس', read('src/components/live/LiveBrainRoom.tsx').includes("['proactive', `الاستباقي"));
const crash = classifyFailure({ source: 'exception', text: 'الخادم انهار…', where: 'crash:oom' });
check('★ انهيار بنفاد الذاكرة يُشخَّص كذلك', crash?.severity === 'critical' && /نفاد الذاكرة/.test(crash.title));
check('★ كشف الانهيار: نبضة + علامة إغلاق نظيف + فحص عند الإقلاع', server.includes('async function startCrashDetection') && server.includes('markCleanShutdown();') && server.includes('!prev.cleanShutdownAt'));
check('سياسة: لا يُلمس الحرج + 10 دقائق', PROACTIVE_POLICY.probeIntervalMs === 600000);

// الحكم على الإقلاع: تداخل النشر ليس انهياراً (كان كل نشر يُسجَّل «الخادم انهار»)
{
  const boot = Date.parse('2026-10-28T16:10:54Z');
  const old = { bootId: 'A', version: '30b2305', heartbeatAt: '2026-10-28T16:10:26Z', cleanShutdownAt: null, memoryMb: 143 };
  check('★ نشر جديد والقديمة نبضت قبيل إقلاعنا ⇒ تداخل نشر لا انهيار', judgeBoot({ prev: old, recheck: old, currentBootId: 'B', currentVersion: 'e23ffde', bootMs: boot }) === 'deploy_overlap');
  check('★ القديمة كتبت الإغلاق النظيف خلال المهلة ⇒ سليم', judgeBoot({ prev: old, recheck: { ...old, cleanShutdownAt: '2026-10-28T16:11:30Z' }, currentBootId: 'B', currentVersion: 'e23ffde', bootMs: boot }) === 'clean');
  check('القديمة ما زالت تنبض بعد إقلاعنا ⇒ ليس انهياراً', judgeBoot({ prev: old, recheck: { ...old, heartbeatAt: '2026-10-28T16:12:00Z' }, currentBootId: 'B', currentVersion: '30b2305', bootMs: boot }) === 'deploy_overlap');
  check('★ النسخة نفسها أُعيد تشغيلها بلا إغلاق نظيف ⇒ انهيار حقيقي', judgeBoot({ prev: old, recheck: old, currentBootId: 'B', currentVersion: '30b2305', bootMs: boot }) === 'crash');
  check('نسخة مختلفة لكن آخر نبضة قديمة (ماتت قبل النشر) ⇒ انهيار', judgeBoot({ prev: { ...old, heartbeatAt: '2026-10-28T15:30:00Z' }, recheck: null, currentBootId: 'B', currentVersion: 'e23ffde', bootMs: boot }) === 'crash');
  check('إغلاق نظيف سابق ⇒ سليم', judgeBoot({ prev: { ...old, cleanShutdownAt: '2026-10-28T16:09:00Z' }, recheck: null, currentBootId: 'B', currentVersion: 'e23ffde', bootMs: boot }) === 'clean');
  check('★ الخادم ينتظر قبل الحكم ولا ينبض قبله', server.includes('await new Promise((r) => { const t = setTimeout(r, BOOT_RECHECK_MS);') && server.includes('if (verdict === "crash") {'));
}

console.log('\n' + '='.repeat(60));
if (failures.length) { console.error(`FAILED: ${failures.length} — passed ${passed}`); for (const f of failures) console.error('  ✗ ' + f); process.exit(1); }
console.log(`PASSED: ${passed} engineer-proactive checks`);
