/**
 * المهندس المشرف — اختبار السيناريوهات الحقيقية: الرصد، القرار، الحدود، والتقارير،
 * وأن ما يُصلحه الخادم يمر عبر المشغّلات نفسها ولا يغيّر قرار المالك أبداً.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectIncidents, decideNext, forgetRecovered, addReport, emptyEngineerState, normalizeEngineerState,
  withTimeout, ENGINEER_POLICY, type EngineerSnapshot,
  incidentsFromPatrol,
} from '../ops/siteEngineer';
import { PATROL_ORDER, PATROL_CHECKS, COLLECTION_CAPS, inspectModule, capacityChecks, healthScore, slopePerHour, growthPerDay, type PatrolFacts } from '../ops/engineerPatrol';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(name + (info ? ` — ${info}` : '')); };

const NOW = Date.parse('2026-10-26T12:00:00Z');
const iso = (minAgo: number) => new Date(NOW - minAgo * 60000).toISOString();
const base = (over: Partial<EngineerSnapshot> = {}): EngineerSnapshot => ({
  nowMs: NOW, storageReady: true, persistFailStreak: 0, persistFailingSince: null,
  cycles: [
    { key: 'youtube', label: 'مراقب يوتيوب', cadenceMs: 300000, lastRunAt: iso(2), active: true, deferred: false },
    { key: 'commercial', label: 'العقل التجاري', cadenceMs: 600000, lastRunAt: iso(5), active: true, deferred: false },
  ],
  backup: { configured: true, level: 'ok', running: false, lastSuccessAt: iso(60), consecutiveFailures: 0 },
  metaFailing: [], youtube: { connected: true, consecutiveErrors: 0, lastError: null },
  memoryMb: 200, limitMb: 512, loopLagMs: 3, ...over,
});

// 1) الرصد
{
  check('★ نظام سليم = لا أعطال', detectIncidents(base(), {}).length === 0);
  const stale = detectIncidents(base({ cycles: [{ key: 'youtube', label: 'مراقب يوتيوب', cadenceMs: 300000, lastRunAt: iso(20), active: true, deferred: false }] }), {});
  check('★ دورة فاتتها أكثر من دورتين = عطل في قسمها', stale.length === 1 && stale[0].key === 'cycle_stale:youtube' && stale[0].module === 'automation' && stale[0].target === 'youtube');
  const paused = detectIncidents(base({ cycles: [{ key: 'youtube', label: 'x', cadenceMs: 300000, lastRunAt: iso(600), active: false, deferred: false }] }), {});
  check('★ الموقوف بقرار المالك ليس عطلاً (لا يُلمس)', paused.length === 0);
  const deferred = detectIncidents(base({ cycles: [{ key: 'brain', label: 'x', cadenceMs: 900000, lastRunAt: iso(600), active: true, deferred: true }] }), {});
  check('★ المؤجَّل المعلَن لحماية الخطة ليس عطلاً', deferred.length === 0);
  const heavy = detectIncidents(base({ cycles: [{ key: 'commercial', label: 'x', cadenceMs: 600000, lastRunAt: iso(40), active: true, deferred: false }] }), {});
  check('العقل التجاري المتوقف = إصلاح ثقيل في قسم الزبائن', heavy[0]?.heavy === true && heavy[0]?.module === 'customers');
  check('★ فشل الحفظ المتكرر = حرج', detectIncidents(base({ persistFailStreak: 3 }), {})[0]?.key === 'persist_failing');
  check('★ قاعدة غير جاهزة = تصعيد للمالك (لا إعادة تهيئة آلية)', Boolean(detectIncidents(base({ storageReady: false }), {})[0]?.needsOwner));
  check('النسخة المتأخرة = عطل نسخ ثقيل', detectIncidents(base({ backup: { configured: true, level: 'critical', running: false, lastSuccessAt: null, consecutiveFailures: 2 } }), {})[0]?.key === 'backup_stale');
  check('النسخ الجاري الآن لا يُعدّ عطلاً', detectIncidents(base({ backup: { configured: true, level: 'warning', running: true, lastSuccessAt: null, consecutiveFailures: 0 } }), {}).length === 0);
  check('Drive غير مربوط ⇒ لا عطل نسخ', detectIncidents(base({ backup: { configured: false, level: 'critical', running: false, lastSuccessAt: null, consecutiveFailures: 0 } }), {}).length === 0);
  const perm = detectIncidents(base({ metaFailing: [{ platform: 'facebook', code: '190', streak: 4 }] }), {});
  check('★ رمز ملغى (190) = قرار المالك لا إصلاح آلي', Boolean(perm[0]?.needsOwner));
  const transient = detectIncidents(base({ metaFailing: [{ platform: 'facebook', code: '2', streak: 4 }] }), {});
  check('خطأ مؤقت = إصلاح آلي مسموح', transient[0] && !transient[0].needsOwner);
  const streaks: Record<string, number> = {};
  const mem1 = detectIncidents(base({ memoryMb: 470 }), streaks); const mem2 = detectIncidents(base({ memoryMb: 470 }), streaks); const mem3 = detectIncidents(base({ memoryMb: 470 }), streaks);
  check('★ الذاكرة تُعلن بعد 3 فحوص متتالية فقط (لا قراءة واحدة) ومراقبة بلا إجراء', mem1.length === 0 && mem2.length === 0 && mem3[0]?.key === 'memory_high' && mem3[0]?.observeOnly === true);
  detectIncidents(base({ memoryMb: 100 }), streaks);
  check('الذاكرة الطبيعية تُصفّر العدّاد', streaks.memory === 0);
}

// 2) القرار والحدود
{
  const P = ENGINEER_POLICY;
  const inc = detectIncidents(base({ cycles: [{ key: 'youtube', label: 'مراقب يوتيوب', cadenceMs: 300000, lastRunAt: iso(20), active: true, deferred: false }] }), {});
  const st = emptyEngineerState();
  check('★ عطل جديد ⇒ إصلاح', decideNext(st, inc, NOW, { pressureCritical: false }).kind === 'repair');
  st.incidents[inc[0].key] = { attempts: 1, lastAttemptAt: NOW - 60000, escalatedAt: null, firstSeenAt: NOW - 120000 };
  check('★ تباعد: لا محاولة ثانية قبل مرور فترة الانتظار', decideNext(st, inc, NOW, { pressureCritical: false }).kind === 'wait');
  check('بعد فترة الانتظار ⇒ محاولة ثانية', decideNext(st, inc, NOW + P.backoffMs[1] + 1000, { pressureCritical: false }).kind === 'repair');
  st.incidents[inc[0].key] = { attempts: P.maxAttempts, lastAttemptAt: NOW - 3600000, escalatedAt: null, firstSeenAt: NOW - 7200000 };
  check('★ بعد 3 محاولات فاشلة ⇒ تصعيد للمالك', decideNext(st, inc, NOW, { pressureCritical: false }).kind === 'escalate');
  st.incidents[inc[0].key].escalatedAt = NOW - 60000;
  check('★ بعد التصعيد: تهدئة 6 ساعات (لا حلقة إصلاح لا نهائية)', decideNext(st, inc, NOW, { pressureCritical: false }).kind === 'wait');
  check('بعد التهدئة يُعاد النظر', decideNext(st, inc, NOW + P.cooldownAfterEscalateMs + 1000, { pressureCritical: false }).kind !== 'wait');

  const heavy = detectIncidents(base({ cycles: [{ key: 'commercial', label: 'x', cadenceMs: 600000, lastRunAt: iso(40), active: true, deferred: false }] }), {});
  check('★ إصلاح ثقيل تحت ضغط الخطة ⇒ تأجيل معلَن', decideNext(emptyEngineerState(), heavy, NOW, { pressureCritical: true }).kind === 'defer');
  const busy = emptyEngineerState(); busy.actions = Array.from({ length: P.maxActionsPerHour }, (_, i) => NOW - i * 60000);
  check('★ سقف 12 إجراء/ساعة', decideNext(busy, inc, NOW, { pressureCritical: false }).kind === 'wait');
  const owner = detectIncidents(base({ metaFailing: [{ platform: 'facebook', code: '190', streak: 4 }] }), {});
  check('★ ما يحتاج المالك يُصعَّد فوراً', decideNext(emptyEngineerState(), owner, NOW, { pressureCritical: false }).kind === 'escalate');
  const both = [...heavy, ...detectIncidents(base({ persistFailStreak: 3 }), {})];
  const pick = decideNext(emptyEngineerState(), both, NOW, { pressureCritical: false });
  check('★ الأخطر أولاً (الحفظ الحرج قبل غيره)', pick.kind === 'repair' && pick.incident.key === 'persist_failing');
}

// 3) الذاكرة والتقارير
{
  const st = emptyEngineerState();
  st.incidents['cycle_stale:youtube'] = { attempts: 1, lastAttemptAt: NOW, escalatedAt: null, firstSeenAt: NOW };
  st.incidents['backup_stale'] = { attempts: 0, lastAttemptAt: null, escalatedAt: null, firstSeenAt: NOW };
  const rec = forgetRecovered(st, new Set());
  check('★ ما زال بعد محاولاتنا يُسجَّل «تعافى» وتُنسى ذاكرته', rec.length === 1 && rec[0] === 'cycle_stale:youtube' && Object.keys(st.incidents).length === 0);
  for (let i = 0; i < ENGINEER_POLICY.maxReports + 10; i++) addReport(st, { id: `r${i}`, incidentKey: 'k', kind: 'cycle_stale', module: 'core', severity: 'warning', title: 't', evidence: [], attempt: 1, startedAt: iso(0), endedAt: iso(0), durationMs: 1, status: 'resolved', steps: [], verification: '', summary: '', nextAction: null });
  check('التقارير محدودة (لا تضخّم في التخزين)', st.reports.length === ENGINEER_POLICY.maxReports && st.reports[0].id === `r${ENGINEER_POLICY.maxReports + 9}`);
  const norm = normalizeEngineerState({ enabled: false, reports: [{ id: 'a' }, null, 5], incidents: { x: { attempts: 'z' }, y: null }, actions: [1, 'b'] });
  check('★ تحميل آمن من مخزن تالف', norm.enabled === false && norm.reports.length === 1 && norm.incidents.x.attempts === 0 && !norm.incidents.y && norm.actions.length === 1);
  check('الافتراضي: يعمل', emptyEngineerState().enabled === true && normalizeEngineerState(null).enabled === true);
}

// 4) الخادم: كتيّب الإصلاح يمر بالمشغّلات نفسها ولا يلمس قرارات المالك
const server = read('server.ts');
const engBlock = server.slice(server.indexOf('const STORAGE_KEY_ENGINEER'), server.indexOf('app.get("/api/engineer", requireOwner'));
check('★ كتلة المهندس موجودة', engBlock.length > 2000);
check('★ لا يغيّر أي مفتاح للمالك', !/setCommercialKillSwitch|commercialSendMode\s*=(?!=)|controls\.(paused|autoReply|enabled|humanReviewMode)\s*=(?!=)|setJobAutoExecute|autoExecuteApproved\s*=(?!=)|ownerAlertState\.enabled\s*=(?!=)|ownerAlertState\s*=(?!=)/.test(engBlock));
check('★ لا حذف ولا إعادة تشغيل للعملية ولا كود', !/process\.exit|\.splice\(|\bdelete workspace|storageAdapter\.(delete|clear)|DROP |TRUNCATE|child_process|execSync/.test(engBlock));
check('★ الإصلاح عبر المشغّلات الرسمية', ['runYouTubeWatcherCycle("manual")', 'runMetaWatcherCycle("self_heal")', 'runTelegramWatcherCycle("self_heal")', 'runBrainRuntimeCycleInternal("manual")', 'runCommercialBrainCycle("self_heal")', 'runMetricsSync("self_heal")', 'drAutoBackup?.runCycle?.("self_heal")', 'ensureYouTubeAccessToken()', 'persistState()'].every((x) => engBlock.includes(x)));
check('★ كل إصلاح يُتحقق منه قبل إعلانه', engBlock.includes('plan.verify(t0)') && engBlock.includes('status: "resolved"'));
check('★ كل خطوة بمهلة (لا تعليق)', engBlock.includes('withTimeout(st.run()'));
check('★ التصعيد يصل المالك + سجل تدقيق', engBlock.includes('pushNotification("owner", "engineer_escalation"') && engBlock.includes('audit("site-engineer", "engineer_escalated"'));
check('★ تقاريره تصمد بعد restart (مفتاح تخزين مستقل، بلا تغيير مخطط)', server.includes('await loadEngineerState();') && engBlock.includes('storageAdapter.write(STORAGE_KEY_ENGINEER'));
check('★ للمالك فقط', server.includes('app.get("/api/engineer", requireOwner') && server.includes('app.post("/api/engineer/check", requireOwner') && server.includes('app.post("/api/engineer/toggle", requireOwner'));
check('★ مهمة واحدة في كل مرة', engBlock.includes('if (engineerBusy) return;'));
check('يبدأ بعد الإقلاع ويعمل كل دقيقة بلا منع الإغلاق', engBlock.includes('setInterval(() => { void engineerTick(); }, 60000)') && engBlock.includes('unref'));
check('★ الغرفة الحية تعرض المهندس', server.includes('engineer: (() => { try { return engineerView(!lite); }'));

// 5) الواجهة: العنكبوت يتحرك إلى القسم المعطّل
const ui = read('src/components/live/LiveBrainRoom.tsx');
check('★ العنكبوت يمشي على مسار القسم الحقيقي', ui.includes('lbr-spider') && ui.includes('pathOut(MOD_BY_KEY'));
check('★ لوحة المهندس + التقارير الكاملة', ui.includes('المهندس المشرف') && ui.includes('(eng?.reports || []).map((r: any)'));
check('تشغيل/إيقاف وفحص الآن للمالك', ui.includes('apiService.toggleEngineer(') && ui.includes('apiService.runEngineerCheck()'));

// 6) الدورية: تجوال على كل الأقسام + قاعدة المعرفة + التنبؤ بالثغرات
{
  const facts = (over: Partial<PatrolFacts> = {}): PatrolFacts => ({
    nowMs: NOW, uptimeSec: 9000, cycleHealthy: true, staleCycleNames: [], legacyErpEnabled: false, unhandledRejections: 0, unhandledRejectionsDelta: 0, liveEventsBuffered: 10,
    pendingDrafts: 0, oldestPendingDraftAt: null, unreadCritical: 0, oldestUnreadCriticalAt: null, ownerEmailReady: true, ownerTelegramReady: false, ownerAlertsEnabled: true,
    ownerAccounts: 1, activeOwnerAccounts: 1, sessionSecretSource: 'SESSION_SECRET', revokedSessions: 3, loginEmailReady: true,
    brainEnabled: true, brainLastStatus: 'SUCCESS', brainLastError: null, brainLastSuccessAt: iso(5), brainCadenceMs: 900000, brainMemoryRecords: 10, brainMemoryCap: null,
    platforms: [{ id: 'facebook', connected: true, providerVerified: true, expiresAt: null, tokenReadable: true }], reauthUnread: 0, publishFailed24h: 0, publishOk24h: 1,
    sendModeAuto: false, commercialEnabled: true, expiredPendingDrafts: 0, schedulers: [{ key: 'youtube', label: 'يوتيوب', expected: true, armed: true }], jobsOverdue: 0, jobsFailed24h: 0,
    driveAuthorized: true, backupLevel: 'ok', backupConsecutiveFailures: 0, backupLastError: null, memoryMb: 200, limitMb: 512, memorySlopeMbPerHour: 0.5, loopLagMs: 2, loopLagMaxMs: 20, usageLevel: 'normal',
    storageReady: true, storageBackend: 'postgres', tls: 'verified', persistFailStreak: 0, writesRequested: 100, writesDone: 90, metricsLastRunAt: iso(30), metricsIntervalMs: 21600000,
    measured: [{ platform: 'youtube', ok: 5, total: 5, issue: null }], geminiConfigured: true, geminiVerified: 'ok', geminiUsed: 1, geminiLimit: 40, youtubeQuotaPercent: 10, youtubeQuotaExhausted: false,
    products: 81, productsBadPrice: 0, productsNoName: 0, installmentPlans: 2, showroomName: true, lastInboundAt: { facebook: iso(60) }, escalationsOpen: 0, oldestOpenEscalationAt: null,
    collections: [{ key: 'socialComments', size: 100, growthPerDay: 5 }], ...over,
  });
  check('★ الدورية تغطي المركز والأقسام الثلاثة عشر كلها', PATROL_ORDER.length === 14 && new Set(PATROL_ORDER).size === 14 && PATROL_ORDER.every((m) => (PATROL_CHECKS as any)[m]?.length > 0));
  const total = Object.values(PATROL_CHECKS).reduce((a, x) => a + x.length, 0);
  check('★ قاعدة معرفة واسعة (≥40 فحصاً) وكل فحص يحمل «لماذا»', total >= 40 && PATROL_ORDER.every((m) => inspectModule(m, facts()).checks.every((c) => c.why.length > 10)), `total=${total}`);
  check('★ نظام سليم ⇒ كل الأقسام سليمة وصحة 100%', PATROL_ORDER.every((m) => inspectModule(m, facts()).status !== 'fail') && (healthScore(PATROL_ORDER.map((m) => inspectModule(m, facts()))) || 0) >= 95);
  const bad = facts({ persistFailStreak: 3, sessionSecretSource: 'ephemeral', productsBadPrice: 2, platforms: [{ id: 'facebook', connected: true, providerVerified: true, expiresAt: null, tokenReadable: false }] });
  check('★ فشل الحفظ يُرصد في قسم التخزين مع إصلاح', inspectModule('storage', bad).checks.some((c) => c.id === 'storage.persist' && c.status === 'fail' && c.repair === 'persist'));
  check('★ سرّ جلسات مؤقت = عطل أمني', inspectModule('auth', bad).checks.some((c) => c.id === 'auth.secret' && c.status === 'fail'));
  check('★ رمز منصة لا يُفك = عطل صامت يُكشف', inspectModule('platforms', bad).checks.some((c) => c.id === 'platforms.token' && c.status === 'fail'));
  check('منتج بلا سعر = تحذير مع توصية', inspectModule('products', bad).checks.some((c) => c.id === 'products.integrity' && c.status === 'warn' && Boolean(c.advice)));
  check('كل فحص غير سليم يحمل «العمل»', PATROL_ORDER.flatMap((m) => inspectModule(m, bad).checks).filter((c) => c.status === 'warn' || c.status === 'fail').every((c) => Boolean(c.advice)));
  const cap = capacityChecks(facts({ collections: [{ key: 'notifications', size: 8600, growthPerDay: 90 }, { key: 'socialComments', size: 9700, growthPerDay: 10 }, { key: 'products', size: 50, growthPerDay: 0 }] }));
  check('★ التنبؤ بالثغرة: الإشعارات تبلغ سقفها خلال ~16 يوماً = تحذير مبكر', cap.find((c) => c.id === 'capacity.notifications')?.status === 'warn' && /16 يوم/.test(String(cap.find((c) => c.id === 'capacity.notifications')?.detail)));
  check('★ مجموعة عند 97% = عطل (القصّ الصامت وشيك)', cap.find((c) => c.id === 'capacity.socialComments')?.status === 'fail');
  check('مجموعة صغيرة بلا نمو = سليمة', cap.find((c) => c.id === 'capacity.products')?.status === 'ok');
  check('السقوف مطابقة لقصّ التحميل في الخادم', read('server.ts').includes('socialComments: Array.isArray(raw.workspace.socialComments) ? raw.workspace.socialComments.slice(0, ' + COLLECTION_CAPS.socialComments + ')') && read('server.ts').includes('notifications: Array.isArray(raw.workspace.notifications) ? raw.workspace.notifications.slice(0, ' + COLLECTION_CAPS.notifications + ')'));
  const leak = Array.from({ length: 10 }, (_, i) => ({ t: NOW + i * 5 * 60000, v: 300 + i * 2 }));
  check('★ كشف التسرّب: ميل الذاكرة +24 ميغا/ساعة', Math.round(slopePerHour(leak) || 0) === 24 && slopePerHour(leak.slice(0, 3)) === null);
  check('معدل النمو يحتاج 6 ساعات على الأقل (لا حكم من عيّنة قصيرة)', growthPerDay({ t: NOW, v: 0 }, { t: NOW + 3600000, v: 10 }) === null && growthPerDay({ t: NOW, v: 0 }, { t: NOW + 86400000, v: 50 }) === 50);
  const leakF = facts({ memoryMb: 400, memorySlopeMbPerHour: 20 });
  check('★ تسرّب يبلغ الحد خلال يوم = تحذير بموعده', inspectModule('monitor', leakF).checks.some((c) => c.id === 'monitor.leak' && c.status === 'warn' && /الحد بعد/.test(c.detail)));
  check('★ مسودات منتهية = إصلاح آمن عبر الكتيّب', incidentsFromPatrol(inspectModule('gate', facts({ expiredPendingDrafts: 3 })).checks).some((i) => i.key === 'patrol_fix:drafts_expired') && incidentsFromPatrol(inspectModule('gate', facts()).checks).length === 0);
  check('الفحص المعطوب لا يُسقط الدورية', inspectModule('platforms', { ...facts(), platforms: null as any }).checks.length > 0);
  const eng = read('server.ts');
  check('★ الدورية تعمل كل 5 ث على الخادم (ذاكرة فقط) ولا تمنع الإغلاق', eng.includes('const PATROL_STEP_MS = 5000;') && eng.includes('setInterval(patrolStep, PATROL_STEP_MS)') && eng.includes('startEngineerPatrol();'));
  check('★ الحسابات الثقيلة فقط عند وقفة قسمها', eng.includes('if (at("customers")) for (const c of comments)') && eng.includes('const collections = !at("storage")') && eng.includes('if (!at("platforms") || !linked(id)) return null;'));
  check('★ الثغرة الجديدة ⇒ تقرير + حدث حي، والعطل بلا إصلاح ⇒ تنبيهك (مرة/12 س)', eng.includes('الدورية: ${chk.label}') && eng.includes('"engineer_patrol"') && eng.includes('nowMs - last > 12 * 3600000'));
  check('★ التفاصيل الثقيلة في الاستطلاع الكامل فقط', eng.includes('inspections: full ? list : undefined') && eng.includes('engineerView(!lite)'));
  check('★ كتيّب المسودات المنتهية بلا حذف', eng.includes('sweepExpiredCommercialDrafts(new Date().toISOString())') && eng.includes('case "patrol_fix"'));
  check('★ العنكبوت يتجوّل على الخريطة بخطى الدورية الحقيقية', ui.includes('lbr-patrol') && ui.includes('patrol?.cursor') && ui.includes('crossPath(A, B)') && ui.includes('lbr-verdict'));
  check('★ اللوحات المعنية تُمسح أثناء الفحص', (ui.match(/scanCls\(\[/g) || []).length >= 9);
  check('★ صحة المشروع + الأقسام + الثغرات + التقارير', ui.includes('صحة المشروع') && ui.includes("'gaps'") && ui.includes('lbr-secgrid'));
}

void (async () => {
  let timedOut = false;
  try { await withTimeout(new Promise((r) => setTimeout(r, 200)), 20, 'خطوة'); } catch (e: any) { timedOut = /انتهت مهلة/.test(String(e?.message)); }
  check('★ المهلة تقطع الخطوة المعلّقة', timedOut);
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} site-engineer checks`);
})();
