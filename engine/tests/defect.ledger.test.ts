/**
 * سجل الأعطال الحقيقية — يُختبر بأسطر سجل الإنتاج الفعلية (Render، 25–28 أكتوبر 2026)
 * التي لم تلتقطها الدورية القديمة، وبأحداث 500/استثناء/انهيار شاشة.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyFailure, recordFailure, sweepLedger, markDefect, openDefects, ledgerSummary, normalizeLedger,
  emptyLedger, fingerprint, normalizeRoute, sanitizeSample, defectLogLine, LEDGER_POLICY,
  repairPlanFor, recordRepair, recentlyRepaired, countsAsRegression, isDeployOverlapCrash,
} from '../ops/defectLedger';
import { incidentsFromDefects, decideNext, emptyEngineerState } from '../ops/siteEngineer';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(name + (info ? ` — ${info}` : '')); };
const NOW = Date.parse('2026-10-28T05:00:00Z');
const log = (text: string, level: 'info' | 'warn' | 'error' = 'info') => ({ source: 'log' as const, text, level });

// ---------------------------------------------------------------------------
// 1) أسطر الإنتاج الحقيقية
// ---------------------------------------------------------------------------
const secret = classifyFailure(log('[oauth-callback-error] google_business status=502 message=The provided client secret is invalid.'));
check('★ سرّ OAuth خاطئ ⇒ إعداد حرج بيد المالك', secret?.kind === 'config' && secret.owner === 'owner' && secret.severity === 'critical', JSON.stringify(secret));
check('★ العلاج يذكر Render والمنصة', /Render/.test(secret?.fix || '') && /Google Business/.test(secret?.fix || ''));

const refresh = classifyFailure(log('[youtube-oauth] outcome=refresh_failed'));
check('★ فشل تجديد رمز يوتيوب ⇒ حرج + إعادة ربط', refresh?.severity === 'critical' && /أعد ربط يوتيوب/.test(refresh.fix));

const slow = classifyFailure(log('[dr-backup] outcome=ok state=backed_up trigger=scheduled decision=due recoveryPoint=rp-064 ms=1678473'));
check('★ نسخة احتياطية 28 دقيقة ⇒ عطل أداء (لم تره الدورية)', slow?.kind === 'performance' && /28 دقيقة/.test(slow.diagnosis), JSON.stringify(slow));
check('نسخة احتياطية سريعة ليست عطلاً', classifyFailure(log('[dr-backup] outcome=ok state=backed_up ms=42000')) === null);
check('النسخ المؤجّل/المفروض ليس فشلاً', classifyFailure(log('[dr-backup] outcome=deferred reason=pressure_defer trigger=scheduled')) === null && classifyFailure(log('[dr-backup] outcome=forcing reason=stale_over_24h trigger=scheduled')) === null);
check('سطر مراحل النسخ ليس عطلاً', classifyFailure(log('[dr-backup] stages snapshot=900s mirror=400s files=300 uploaded=12')) === null);
check('نسخة احتياطية فاشلة ⇒ حرج', classifyFailure(log('[dr-backup] outcome=failed reason=quota ms=1000'))?.severity === 'critical');

const tiktok = classifyFailure(log('[metrics] platform=tiktok posts=0 withMetrics=0 followers=- issue=SCOPE_MISSING_video.list'));
check('★ إذن video.list ناقص ⇒ إعداد بيد المالك', tiktok?.kind === 'config' && tiktok.owner === 'owner' && /تيك توك/.test(tiktok.title));
check('رمز Meta 10 ⇒ إذن ناقص', classifyFailure(log('[metrics] platform=facebook posts=7 withMetrics=5 followers=1064 error=10'))?.kind === 'config');
check('مزامنة سليمة issue=- ليست عطلاً', classifyFailure(log('[metrics] platform=facebook posts=5 withMetrics=5 followers=1067 issue=-')) === null);

const rejected = classifyFailure(log('[oauth] youtube {"outcome":"callback_rejected","reason":"جلسة OAuth غير معروفة أو أُعيد استخدامها."}'));
check('عودة OAuth مرفوضة ⇒ تحذير للمالك', rejected?.severity === 'warning' && rejected.owner === 'owner');

for (const ok of [
  '[oauth] youtube {"outcome":"authorized_url_issued","redirectUri":"x"}',
  '[oauth] youtube {"outcome":"callback_completed","status":200}',
  '[youtube-oauth] outcome=token_refreshed scopeCount=3',
  '[storage] state_writes requested=75 written=74 coalesced=1 fail_streak=0 (since boot)',
  '[الغرابي AI Server] running on http://0.0.0.0:10000',
  '[defect] new fp=abc kind=code title="x"',
]) check(`ليس عطلاً: ${ok.slice(0, 50)}`, classifyFailure(log(ok)) === null);

const gp = classifyFailure(log('[facebook-graph-error] {"endpoint":"POST /102540549308721/subscribed_apps","status":403,"code":200,"subcode":null,"message":"(#200) To subscribe to the messages field, one of these permissions is needed: pages_messaging","type":"OAuthException","fbtraceId":"x","errorUserTitle":null,"errorUserMsg":null}'));
check('★ رفض Graph الحي (pages_messaging) ⇒ إذن ناقص بيد المالك مع اسم الإذن', gp?.kind === 'config' && gp.owner === 'owner' && /pages_messaging/.test(gp.title) && /subscribed_apps/.test(gp.diagnosis), JSON.stringify(gp));
check('رمز Graph ملغى 190 ⇒ إعادة ربط', /ملغى/.test(classifyFailure(log('[threads-graph-error] {"endpoint":"GET /me","status":400,"code":190,"message":"Error validating access token"}'))?.title || ''));

// ---------------------------------------------------------------------------
// 2) أعطال الكود الحقيقية: 500، استثناء، انهيار شاشة
// ---------------------------------------------------------------------------
const h500 = classifyFailure({ source: 'http', text: 'Cannot read properties of undefined (reading map)', status: 500, where: '/api/commercial/leads/lead_9f8e7d6c5b/draft' });
check('★ 500 من مسار ⇒ عيب كود حرج لمهندس الكود', h500?.kind === 'code' && h500.owner === 'developer' && h500.severity === 'critical');
check('مسار يُطبَّع بلا معرّفات', normalizeRoute('/api/commercial/leads/lead_9f8e7d6c5b/draft') === '/api/commercial/leads/:id/draft', normalizeRoute('/api/commercial/leads/lead_9f8e7d6c5b/draft'));
check('502 ⇒ مزوّد لا كود', classifyFailure({ source: 'http', text: '', status: 502, where: '/api/x' })?.kind === 'provider');
check('200 بطيء جداً ⇒ أداء', classifyFailure({ source: 'http', text: '', status: 200, where: '/api/x', durationMs: 20000 })?.kind === 'performance');
check('200 عادي ليس عطلاً', classifyFailure({ source: 'http', text: '', status: 200, where: '/api/x', durationMs: 80 }) === null);
check('★ استثناء غير معالج ⇒ حرج', classifyFailure({ source: 'exception', text: 'TypeError: x is not a function' })?.severity === 'critical');
check('★ انهيار شاشة ⇒ عيب واجهة حرج', classifyFailure({ source: 'client', text: 'render crash: Cannot read properties of null', where: 'live' })?.severity === 'critical');
check('★ شاشة تلقت 500 ⇒ عيب كود', classifyFailure({ source: 'client', text: 'api 500 /api/finance/aging', where: '/api/finance/aging' })?.kind === 'code');
check('★ شاشة تلقت 502 ⇒ الخادم لم يُجب (لا عيب كود)', classifyFailure({ source: 'client', text: 'api 502 /api/live/room', where: '/api/live/room' })?.kind === 'provider');
check('خطأ JS في سطر تحذير ⇒ عيب كود', classifyFailure(log('[brain] something TypeError: a.b is undefined', 'warn'))?.kind === 'code');
check('دورة المهندس فشلت ⇒ عيب كود', classifyFailure(log('[engineer] tick_failed boom', 'warn'))?.owner === 'developer');

// ---------------------------------------------------------------------------
// 3) الدفتر: تجميع، تكرار، حل، عودة، سقف
// ---------------------------------------------------------------------------
const L = emptyLedger();
const ev500 = (id: string) => ({ source: 'http' as const, text: `Cannot read properties of undefined (reading 'map') id=${id}`, status: 500, where: `/api/leads/lead_${id}aaaaaa/draft` });
const r1 = recordFailure(L, ev500('111111'), { nowMs: NOW, version: 'aaa1111' });
const r2 = recordFailure(L, ev500('222222'), { nowMs: NOW + 60000, version: 'aaa1111' });
check('★ تكرار العطل نفسه بمعرّفات مختلفة ⇒ مجموعة واحدة', r1?.isNew === true && r2?.isNew === false && r1?.group.fp === r2?.group.fp && Object.keys(L.groups).length === 1);
check('العدّاد يزيد', r2?.group.count === 2);
check('لا عطل ⇒ لا تسجيل', recordFailure(L, log('[storage] state_writes requested=1'), { nowMs: NOW }) === null && L.events === 2);

// عيب الكود لا يُغلق بالصمت وحده على نفس النسخة
let res = sweepLedger(L, { nowMs: NOW + 3 * 86400000, version: 'aaa1111', versionSinceMs: NOW - 86400000 });
check('★ عيب كود لا يُغلق بالصمت على النسخة نفسها', res.length === 0 && openDefects(L).length === 1);
// نسخة جديدة نُشرت وغاب عليها أكثر من 6 ساعات ⇒ حُلّ
res = sweepLedger(L, { nowMs: NOW + 3 * 86400000, version: 'bbb2222', versionSinceMs: NOW + 3 * 86400000 - 7 * 3600000 });
check('★ يُغلق بعد نسخة جديدة وغيابه عليها', res.length === 1 && openDefects(L).length === 0);
const back = recordFailure(L, ev500('333333'), { nowMs: NOW + 4 * 86400000, version: 'bbb2222' });
check('★ عودة بعد الحل ⇒ regression', back?.isRegression === true && back.group.regressions === 1 && back.group.status === 'open');

// عطل مزوّد يُغلق بعد 24 ساعة صمت
const L2 = emptyLedger();
recordFailure(L2, log('[youtube-oauth] outcome=refresh_failed'), { nowMs: NOW });
check('عطل مزوّد يُغلق بعد 24 س صمت', sweepLedger(L2, { nowMs: NOW + LEDGER_POLICY.autoResolveMs + 1000 }).length === 1);
check('المحلول يُنسى بعد 14 يوماً', (sweepLedger(L2, { nowMs: NOW + 20 * 86400000 }), Object.keys(L2.groups).length === 0));

// قرار المالك
const L3 = emptyLedger();
const g = recordFailure(L3, log('[metrics] platform=threads posts=9 withMetrics=0 issue=10x9'), { nowMs: NOW })!.group;
check('المالك يتجاهل', markDefect(L3, g.fp, 'ignored', NOW)?.status === 'ignored' && openDefects(L3).length === 0);

// السقف
const L4 = emptyLedger();
for (let i = 0; i < LEDGER_POLICY.maxGroups + 40; i++) recordFailure(L4, { source: 'http', text: `boom variant ${'x'.repeat(i % 7)} ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, status: 500, where: `/api/r${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}` }, { nowMs: NOW + i });
check('★ سقف المجموعات محترم', Object.keys(L4.groups).length <= LEDGER_POLICY.maxGroups, String(Object.keys(L4.groups).length));

// تنقية العيّنات
const s = sanitizeSample('failed for ali@example.com phone +964 770 123 4567 Bearer abcdefghijklmnopqrstuvwxyz0123456789');
check('★ العيّنة بلا بريد/هاتف/رمز', !/example\.com/.test(s) && !/770 123/.test(s) && !/abcdefghijklmnop/.test(s), s);

// التحميل الآمن
const N = normalizeLedger({ groups: { a: { title: 't', firstAt: '2026-10-28T00:00:00Z', kind: 'code', severity: 'critical', samples: ['x'] }, bad: null }, events: 3 });
check('التحميل يتجاهل التالف', Object.keys(N.groups).length === 1 && N.events === 3);
check('التحميل من قيمة فارغة', Object.keys(normalizeLedger(null).groups).length === 0);

// سطر السجل للمهندس المجدول
const line = defectLogLine(back!.group, 'regression');
check('★ سطر [defect] واحد مُهيكل', /^\[defect\] regression fp=\w{12} kind=code sev=critical owner=developer where=\/api\/leads\/:id\/draft/.test(line) && !line.includes('\n'), line);
check('سطر [defect] لا يُعاد تسجيله كعطل', classifyFailure(log(line, 'warn')) === null);

const sum = ledgerSummary(L);
check('الملخص يعدّ المفتوح لمهندس الكود', sum.open === 1 && sum.forDeveloper === 1 && sum.regressions === 1);
check('البصمة ثابتة', fingerprint({ kind: 'code', key: 'k' }, { source: 'log', text: 'x 1' }) === fingerprint({ kind: 'code', key: 'k' }, { source: 'log', text: 'x 2' }));

// ---------------------------------------------------------------------------
// 4) التوصيل في الخادم والواجهة
// ---------------------------------------------------------------------------
const server = read('server.ts');
check('★ الخادم يسجّل 500 والبطء لكل /api', /res\.on\("finish"/.test(server) && /defectIntake\(\{ source: "http"/.test(server));
check('★ الخادم يسجّل الاستثناء غير المعالج', /defectIntake\(\{ source: "exception"/.test(server));
check('★ وسيط الأخطاء يسجّل الرسالة الحقيقية داخلياً (لا «خطأ داخلي» فقط)', /request error \(\$\{info\.code\}\) \$\{req\?\.method/.test(server));
check('★ مسار تقارير الواجهة محمي ومحدود', /app\.post\("\/api\/engineer\/client-error", authenticateToken/.test(server) && /clientErrorWindow/.test(server));
check('★ مسارات الدفتر للمالك فقط', /app\.get\("\/api\/engineer\/defects", requireOwner/.test(server) && /app\.post\("\/api\/engineer\/defects\/:fp", requireOwner/.test(server));
check('الدفتر يُحفظ ويُحمَّل', /STORAGE_KEY_DEFECTS/.test(server) && /normalizeLedger\(/.test(server));
const main = read('src/main.tsx');
check('★ الواجهة تلتقط الانهيار وأخطاء الخادم', /ErrorBoundary/.test(main) && /installClientErrorReporting\(\)/.test(main) && /reportClientError/.test(read('src/components/common/ErrorBoundary.tsx')));
const ui = read('src/components/live/LiveBrainRoom.tsx');
check('★ تبويب «الأعطال الحقيقية» في غرفة المهندس', ui.includes("'defects'") && ui.includes('الأعطال الحقيقية'));


// ---------------------------------------------------------------------------
// 5) الإصلاح الذاتي — بالأعطال الأربعة الحقيقية التي ظهرت للمالك في الإنتاج (2026-10-28)
// ---------------------------------------------------------------------------
const R = emptyLedger();
const tg = recordFailure(R, { source: 'http', text: 'GET fetch failed', status: 502, where: '/api/platforms/telegram/webhook-info', method: 'GET', path: '/api/platforms/telegram/webhook-info' }, { nowMs: NOW, version: 'f7db9a4' })!.group;
const tgPlan = repairPlanFor(tg);
check('★ 502 من مسار قراءة ⇒ يُعاد تنفيذ الطلب نفسه للتحقق', tgPlan.action === 'replay_route' && (tgPlan as any).path === '/api/platforms/telegram/webhook-info', JSON.stringify(tgPlan));
const gw = recordFailure(R, { source: 'client', text: 'api 502 /api/live/room', where: '/api/live/room', method: 'GET', path: '/api/live/room' }, { nowMs: NOW })!.group;
check('★ الخادم لم يُجب ⇒ فحص الخادم + إعادة الطلب', repairPlanFor(gw).action === 'verify_server' && (repairPlanFor(gw) as any).path === '/api/live/room');
const ttk = recordFailure(R, log('[metrics] platform=tiktok posts=0 withMetrics=0 followers=- issue=SCOPE_MISSING_video.list'), { nowMs: NOW })!.group;
check('★ إذن تيك توك ⇒ المهندس يتحقق من الإعداد والرمز بنفسه', repairPlanFor(ttk).action === 'verify_scope_setup');
// إذن إحصاءات Meta الناقص يبقى إعداداً بيد المالك بالإجراء الدقيق (لا ادعاء إصلاح).
const tt = recordFailure(R, log('[metrics] platform=facebook posts=7 withMetrics=0 followers=1064 error=10'), { nowMs: NOW })!.group;
check('★ إذن إحصاءات فيسبوك ⇒ بيد المالك بالإجراء الدقيق (لا ادعاء إصلاح)', repairPlanFor(tt).action === 'owner' && /أعد ربط فيسبوك/.test((repairPlanFor(tt) as any).instructions));
const post500 = recordFailure(R, { source: 'http', text: 'POST boom', status: 502, where: '/api/posts/x/publish', method: 'POST', path: '/api/posts/x/publish' }, { nowMs: NOW })!.group;
check('★ الكتابة لا تُعاد أبداً (لا نشر مكرر)', repairPlanFor(post500).action !== 'replay_route');
const code = recordFailure(R, { source: 'http', text: 'TypeError: x.map is not a function', status: 500, where: '/api/commercial/leads', method: 'GET', path: '/api/commercial/leads' }, { nowMs: NOW })!.group;
check('★ عيب كود ⇒ مهندس الكود (لا إعادة تشغيل تخفيه)', repairPlanFor(code).action === 'developer');
check('تجديد رمز يوتيوب ⇒ refresh_token', repairPlanFor(recordFailure(R, log('[youtube-oauth] outcome=refresh_failed'), { nowMs: NOW })!.group).action === 'refresh_token');
check('مزامنة متعثّرة ⇒ إعادة المزامنة', repairPlanFor({ kind: 'provider', owner: 'engineer', rule: 'metrics:facebook', fix: '', lastMethod: null, lastPath: null }).action === 'rerun_metrics');

// النتيجة تُكتب على البطاقة، والنجاح المتحقَّق يغلق العطل «أصلحه المهندس»
recordRepair(R, tg.fp, { outcome: 'fixed', summary: 'أُصلح وتحقّقتُ: الطلب ينجح الآن', steps: ['✓ إعادة تنفيذ الطلب: 200'], nowMs: NOW + 60000 });
check('★ الإصلاح المتحقَّق يغلق العطل باسم المهندس', R.groups[tg.fp].status === 'resolved' && R.groups[tg.fp].resolvedBy === 'engineer' && R.groups[tg.fp].repair?.outcome === 'fixed');
check('★ يظهر في «أصلحه المهندس مؤخراً»', recentlyRepaired(R, NOW + 120000).some((g) => g.fp === tg.fp));
recordFailure(R, { source: 'http', text: 'GET fetch failed', status: 502, where: '/api/platforms/telegram/webhook-info', method: 'GET', path: '/api/platforms/telegram/webhook-info' }, { nowMs: NOW + 3600000 });
check('★ عودته بعد الإصلاح ⇒ يُفتح و«الإصلاح لم يصمد» (لا إصلاح شكلي)', R.groups[tg.fp].status === 'open' && R.groups[tg.fp].regressions === 1 && R.groups[tg.fp].repair?.outcome === 'failed');
recordRepair(R, tt.fp, { outcome: 'owner', summary: 'يحتاج إجراءك', steps: [], nowMs: NOW });
check('حالة «بيد المالك» لا تغلق العطل', R.groups[tt.fp].status === 'open');

// من الدفتر إلى مهام المهندس
const incs = incidentsFromDefects(openDefects(R).map((g) => ({ fp: g.fp, kind: g.kind, severity: g.severity, title: g.title, samples: g.samples, plan: repairPlanFor(g) as any })));
const incTg = incs.find((i) => i.target === tg.fp)!; const incTt = incs.find((i) => i.target === tt.fp)!; const incCode = incs.find((i) => i.target === code.fp)!;
check('★ عطل قابل للإصلاح ⇒ مهمة إصلاح', incTg && !incTg.needsOwner && !incTg.observeOnly);
check('★ عطل المالك ⇒ تصعيد بتهدئة 3 أيام (لا إزعاج)', Boolean(incTt?.needsOwner) && incTt.cooldownMs === 72 * 3600000);
check('★ عيب الكود ⇒ إحالة بلا إزعاج', Boolean(incCode?.observeOnly));
const st = emptyEngineerState();
const d1 = decideNext(st, [incTg], NOW, { pressureCritical: false });
check('★ المهندس يقرّر «إصلاح» للعطل القابل', d1.kind === 'repair');
st.incidents[incTt.key] = { attempts: 0, lastAttemptAt: null, escalatedAt: NOW, firstSeenAt: NOW };
check('لا يُعاد التصعيد قبل 3 أيام', decideNext(st, [incTt], NOW + 24 * 3600000, { pressureCritical: false }).kind === 'wait');

// التوصيل الحقيقي في الخادم والواجهة
const srv = read('server.ts');
check('★ الأعطال تدخل مهام المهندس كل دقيقة', srv.includes('incidentsFromDefects(openDefects(defectLedger)'));
check('★ إعادة التنفيذ بالمسار الحقيقي وبجلسة مالك قصيرة (GET فقط) ولا تُسجَّل كحادثة', /async function engineerReplayGet/.test(srv) && srv.includes('exp: now + 60000') && srv.includes('req.headers["x-engineer-probe"] === ENGINEER_PROBE_ID'));
check('★ نتيجة الإصلاح تُكتب على العطل وتُغلقه', srv.includes('defectRepairOutcome(String(inc.target), "fixed"'));
check('★ Telegram صار بإعادة محاولة للقراءة (جذر 502 fetch failed)', srv.includes('createTelegramFetch((url, init) => fetch(url, init as any))') && /export function createTelegramFetch/.test(read('engine/social/telegram.ts')));
const ce = read('src/utils/clientErrors.ts');
check('★ الواجهة تعيد القراءة المؤقتة الفاشلة قبل أن يرى المالك خطأ', ce.includes("method === 'GET'") && ce.includes('const retry = await nativeFetch(input, init);'));
check('★ 502 من الخادم نفسه لا يُحسب «الخادم لم يُجب»', ce.includes("res.headers.get('x-request-id')"));
check('★ تقرير لم يصل يُرسل عند عودة الخادم', ce.includes('flushPending()'));
check('★ الواجهة تعرض ما أصلحه المهندس وخطواته', read('src/components/live/LiveBrainRoom.tsx').includes('أغلقه المهندس بتقرير'));

// عطل إعداد دوري أُغلق بالهدوء ثم ظهر في دورته التالية ليس «عاد بعد حله»
{
  const Q = emptyLedger();
  const line = log('[metrics] platform=tiktok posts=0 withMetrics=0 followers=- issue=SCOPE_MISSING_video.list');
  recordFailure(Q, line, { nowMs: NOW });
  sweepLedger(Q, { nowMs: NOW + LEDGER_POLICY.autoResolveMs + 60000 });
  const fpq = Object.keys(Q.groups)[0];
  check('عطل الإعداد يُغلق بالهدوء', Q.groups[fpq]?.status === 'resolved' && Q.groups[fpq]?.resolvedBy === 'auto');
  const again = recordFailure(Q, line, { nowMs: NOW + LEDGER_POLICY.autoResolveMs + 120000 });
  check('★ ظهوره الدوري التالي يعيد فتحه بلا «regression» زائف', again?.isRegression === false && Q.groups[fpq].status === 'open' && Q.groups[fpq].regressions === 0);
  markDefect(Q, fpq, 'resolved', NOW + LEDGER_POLICY.autoResolveMs + 180000);
  check('ما أغلقه المالك ثم عاد ⇒ regression حقيقي', recordFailure(Q, line, { nowMs: NOW + LEDGER_POLICY.autoResolveMs + 240000 })?.isRegression === true);
}

// 2026-10-28: «انهيار» أثناء النشر (تداخل النسختين) ليس انهياراً.
{
  const base = { where: ['crash:process'], firstVersion: 'e23ffde' } as any;
  check('★ انهيار بعينة نسخة سابقة مختلفة = تبديل نشر لا انهيار', isDeployOverlapCrash({ ...base, samples: ['[crash:process] الخادم انهار وأعيد تشغيله: لم يُغلق إغلاقاً نظيفاً (آخر نبضة —، آخر ذاكرة 143 ميغا، النسخة 30b2305)'] }) === true);
  check('انهيار على النسخة نفسها = انهيار حقيقي', isDeployOverlapCrash({ ...base, samples: ['[crash:process] ... النسخة e23ffde)'] }) === false);
  check('نفاد الذاكرة لا يُعاد تصنيفه', isDeployOverlapCrash({ where: ['crash:oom'], firstVersion: 'e23ffde', samples: ['النسخة 30b2305'] } as any) === false);
  check('عطل إعداد أغلقه الهدوء لا يُحسب «عاد بعد حله»', countsAsRegression({ status: 'resolved', resolvedBy: 'auto', kind: 'config' }) === false);
  check('عيب كود أُغلق بنسخة جديدة ثم عاد = regression', countsAsRegression({ status: 'resolved', resolvedBy: 'auto', kind: 'code' }) === true);
  const legacy = normalizeLedger({ groups: { a: { kind: 'config', owner: 'owner', title: 't', firstAt: '2026-10-28T00:00:00Z', lastAt: '2026-10-28T00:00:00Z', regressions: 6, samples: [], where: [] } } });
  check('★ عدّاد «عاد» القديم لإذن بيد المالك يُصفَّر (6× زائفة)', legacy.groups.a.regressions === 0);
}

// نطاق قياس تيك توك اختياري لم يُطلب في الإعداد: سطر setup= ليس عطلاً ولا يُنبَّه به كل مزامنة.
check('★ نطاق اختياري لم يُطلب (setup=) لا يدخل سجل الأعطال', classifyFailure(log('[metrics] platform=tiktok posts=0 withMetrics=0 followers=- issue=- setup=SCOPE_NOT_REQUESTED_video.list')) === null);
{
  const srv = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
  check('★ المزامنة تميّز النطاق غير المطلوب عن المطلوب الناقص', srv.includes('if (!tiktokOAuthScopes().includes("video.list")) st.setupPending = "video.list";'));
  check('★ نظافة الإشعارات تتحقق من زوال السبب حياً', srv.includes('notificationHygiene(rows, Date.now(), notificationCauseCleared)'));
}

// ملف شاشة من نسخة سابقة بعد النشر: ليس عيب كود ولا حرجاً — والواجهة تعيد التحميل مرة.
{
  const stale = classifyFailure({ source: 'client', text: 'render crash: TypeError: error loading dynamically imported module: https://x/assets/LiveBrainRoom-BCLZ6HV1.js', where: 'tab:section_home' });
  check('★ ملف نسخة سابقة ⇒ ليس عيب كود ولا حرجاً', stale?.kind === 'provider' && stale.severity === 'warning' && stale.owner === 'engineer');
  check('★ صيغ المتصفحات الثلاث تُميَّز', ['Failed to fetch dynamically imported module: /a.js', 'Importing a module script failed.', 'ChunkLoadError: Loading chunk 12 failed'].every((t) => classifyFailure({ source: 'client', text: `render crash: ${t}`, where: 'x' })?.kind === 'provider'));
  check('★ انهيار شاشة حقيقي يبقى عيب واجهة حرجاً', classifyFailure({ source: 'client', text: 'render crash: TypeError: Cannot read properties of null', where: 'x' })?.severity === 'critical');
  const sp = repairPlanFor({ kind: 'provider', owner: 'engineer', rule: 'client-stale-chunk', fix: '', lastMethod: null, lastPath: null, samples: ['[tab:x] render crash: error loading dynamically imported module: https://h/assets/LiveBrainRoom-BCLZ6HV1.js'] });
  check('★ إصلاحه بيد المهندس: التحقق من النسخة الجديدة والملف المفقود', sp.action === 'verify_new_version' && (sp as any).asset === 'LiveBrainRoom-BCLZ6HV1.js');
  check('★ تكراره مع نشر لاحق ليس «عاد بعد حله»', countsAsRegression({ status: 'resolved', resolvedBy: 'engineer', kind: 'provider', rule: 'client-stale-chunk' }) === false);
  const tp = repairPlanFor({ kind: 'config', owner: 'owner', rule: 'metrics-perm:tiktok', fix: 'x', lastMethod: null, lastPath: null });
  check('★ إذن قياس تيك توك: المهندس يتحقق بنفسه لا إحالة فورية للمالك', tp.action === 'verify_scope_setup');
  check('إذن Meta الناقص يبقى بيد المالك', repairPlanFor({ kind: 'config', owner: 'owner', rule: 'metrics-perm:facebook', fix: 'x', lastMethod: null, lastPath: null }).action === 'owner');
  // عطل قديم سُجّل قبل التمييز (client حرج) وكل عيّناته من نسخة سابقة ⇒ يُغلق في الصيانة.
  const L = emptyLedger();
  L.groups['old'] = { fp: 'old', kind: 'client', severity: 'critical', owner: 'developer', title: 'خطأ في الواجهة (tab:section_home)', diagnosis: '', fix: '', where: [], frame: null, count: 1, firstAt: new Date(NOW).toISOString(), lastAt: new Date(NOW).toISOString(), samples: ['[tab:section_home] render crash: TypeError: error loading dynamically imported module: https://x/assets/A-1.js'], status: 'open', resolvedAt: null, resolvedBy: null, regressions: 0, firstVersion: 'v1', lastVersion: 'v1', rule: 'client:tab:section_home', lastMethod: null, lastPath: null, repair: null } as any;
  L.groups['real'] = { ...L.groups['old'], fp: 'real', samples: ['[x] render crash: TypeError: Cannot read properties of null'] } as any;
  const closed = sweepLedger(L, { nowMs: NOW + 60000, version: 'v1', versionSinceMs: NOW });
  check('★ عطل نسخة سابقة القديم لا يُغلق بصمت — يُعاد تصنيفه للمهندس ليصلحه بتقرير', !closed.includes('old') && L.groups['old'].status === 'open' && L.groups['old'].owner === 'engineer' && L.groups['old'].rule === 'client-stale-chunk' && L.groups['old'].severity === 'warning');
  check('★ بعد التصنيف خطته إصلاح المهندس', repairPlanFor(L.groups['old']).action === 'verify_new_version');
  check('★ عطل واجهة حقيقي لا يُغلق بالصمت', !closed.includes('real') && L.groups['real'].status === 'open' && L.groups['real'].owner === 'developer');
  const srv2 = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
  check('★ المهندس ينفّذ التحقق من النسخة (ملفات dist) ومن إذن القياس', srv2.includes('case "verify_new_version"') && srv2.includes('case "verify_scope_setup"') && srv2.includes('fs.readFileSync(path.join(dist, "index.html")'));
  check('★ نجاح التحقق يُغلق العطل «أصلحه المهندس» بتقرير', srv2.includes('defectRepairOutcome(String(inc.target), "fixed"'));
  const ui = readFileSync(join(process.cwd(), 'src/components/common/ErrorBoundary.tsx'), 'utf8');
  const ce2 = readFileSync(join(process.cwd(), 'src/utils/clientErrors.ts'), 'utf8');
  check('★ الواجهة تعيد التحميل مرة عند ملف نسخة سابقة', ui.includes('isStaleChunkError(error) && reloadForNewVersion()') && ce2.includes("'vite:preloadError'"));
  check('★ إعادة التحميل بحارس زمني (لا حلقة)', readFileSync(join(process.cwd(), 'src/utils/staleChunk.ts'), 'utf8').includes('RELOAD_GUARD_MS'));
}

// بروتوكول الإغلاق في السجل: الإغلاق بالهدوء صار تحقّقاً موثّقاً يظهر في قائمة ✅.
{
  const L2 = emptyLedger();
  const g1 = recordFailure(L2, log('[metrics] platform=facebook posts=7 withMetrics=0 followers=1064 error=10'), { nowMs: NOW })!.group;
  recordRepair(L2, g1.fp, { outcome: 'owner', summary: 'يحتاج إجراءك', steps: [], nowMs: NOW });
  const later = NOW + LEDGER_POLICY.autoResolveMs + 3600000;
  sweepLedger(L2, { nowMs: later, version: 'v2', versionSinceMs: NOW });
  const g = L2.groups[g1.fp];
  check('★ الإغلاق بالهدوء موثّق (لا صامت)', g.status === 'resolved' && g.repair?.closure === 'verified_gone' && g.repair.steps.length >= 2);
  check('★ يذكر أنه زال بعد إجراء المالك', /بعد إجراء المالك/.test(g.repair?.summary || ''));
  check('★ يظهر في قائمة ✅', recentlyRepaired(L2, later + 1000).some((x) => x.fp === g1.fp));
  check('عودة عطل إعداد أُغلق بالتحقق ليست «عاد بعد حله» (إعادة رصد دورية)', countsAsRegression(g) === false);
  const srv3 = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
  check('★ المهندس يغلق كل حادثة زالت بتقرير (closeRecovered)', srv3.includes('closeRecovered(engineerState') && srv3.includes('closureReportAr(c)'));
  check('★ التنبيه الذي زال سببه يُغلق بتقرير ✅ يسمّيه', srv3.includes('h.clearedIds.length') && srv3.includes('تحققتُ وأغلقتُ'));
  check('★ قائمة واحدة لكل ما أغلقه المهندس', srv3.includes('closed: engineerClosures(Date.now())'));
}

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} defect-ledger checks`);
