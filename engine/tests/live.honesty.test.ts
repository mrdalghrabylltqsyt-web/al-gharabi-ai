/**
 * صدق الشاشة الحية (2026-10-27) — عطلان رُصدا على الشاشة نفسها:
 *   1) ردود الصفحة نفسها («حياك الله، موقعنا… والدوام…») كانت تظهر في «أصوات الزبائن»
 *      وتُحسب «استفساراً تجارياً»، فتضخّم التفاعلات والنوايا.
 *   2) «صحة المشروع 95%» رغم طلب إعادة ربط قائم، وتصعيدات عمرها 14 يوماً، وتنبيهات حرجة
 *      غير مقروءة منذ 8 أيام، و81 من 81 منتجاً بلا صورة. المتوسط البسيط ساوى بين «سعة
 *      مجموعة» و«زبون بلا رد».
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOwnIdentity, isOwnVoice, customerVoices, normalizeVoiceText, OWN_REPLY_MIN_CHARS } from '../social/ownVoice';
import { buildLiveInsights } from '../ops/liveRoom';
import { PATROL_ORDER, inspectModule, healthBreakdown, healthScore, checkImpact, HEALTH_CAP_WITH_FAIL, HEALTH_CAP_WITH_HIGH_WARN, type PatrolFacts } from '../ops/engineerPatrol';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(name + (info ? ` — ${info}` : '')); };

const NOW = Date.parse('2026-10-27T15:00:00Z');
const iso = (minAgo: number) => new Date(NOW - minAgo * 60000).toISOString();

// 1) صوت المعرض ليس صوت زبون
{
  const OWN_REPLY = 'حياك الله، موقعنا: الطريق كربلاء الطويريج مقابل 202، والدوام يومياً من 8 صباحاً حتى 8 مساءً، وللتواصل: 07800000000';
  const id = buildOwnIdentity({
    names: ['معرض الغرابي', '@alghrabi.store', null, ''],
    ids: ['PAGE_123', 'UC_channel', undefined],
    replyTexts: [OWN_REPLY, 'شكراً لك'],
  });
  check('★ وسم صريح من المنصة = صوت المعرض', isOwnVoice({ text: 'أي نص', selfAuthored: true }, id) && isOwnVoice({ text: 'x', ownedByMe: true }, id));
  check('★ معرّف الكاتب = معرّف صفحة/قناة المعرض', isOwnVoice({ authorId: 'PAGE_123', text: 'مرحبا' }, id) && isOwnVoice({ authorChannelId: 'UC_channel', text: 'x' }, id));
  check('★ اسم الكاتب = اسم حساب المعرض (بعد حذف @ وتوحيد الأحرف)', isOwnVoice({ authorName: 'ALGHRABI.STORE', text: 'x' }, id) && isOwnVoice({ username: '@معرض  الغرابي', text: 'x' }, id));
  check('الاسم بالمطابقة الكاملة لا الاحتواء (زبون اسمه «علي الغرابي» زبون)', !isOwnVoice({ authorName: 'علي معرض الغرابي', text: 'بكم الثلاجة؟' }, id));
  // الحالة الحقيقية من الشاشة: السجل القديم خُزّن قبل الوسم وباسم صفحة مختلف — نصّه هو ردّنا.
  check('★ الحالة الحقيقية: سجل قديم بلا وسم واسم صفحة مختلف — يُعرف من مطابقته لردّ أرسله المعرض', isOwnVoice({ authorName: 'معرض الغرابي للتقسيط', text: `«${OWN_REPLY}»` }, id));
  check('المطابقة تتجاهل المسافات والتشكيل والاقتباسات', normalizeVoiceText('  «حيّاك   الله»  ') === normalizeVoiceText('حياك الله'));
  check(`★ نص قصير (< ${OWN_REPLY_MIN_CHARS} حرفاً) لا يُستبعد ولو طابق رداً — «شكراً لك» من زبون تبقى`, !isOwnVoice({ authorName: 'زبون', text: 'شكراً لك' }, id));
  check('★ زبون حقيقي يبقى', !isOwnVoice({ authorName: 'أبو حسين', authorId: 'USER_9', text: 'بكم ثلاجة سامسونج بالأقساط؟' }, id));
  check('بلا دليل = زبون (لا استبعاد بالتخمين)', !isOwnVoice({ text: 'سؤال' }, buildOwnIdentity({})) && !isOwnVoice(null, id));

  const comments = [
    { platform: 'facebook', createdAt: iso(10), authorName: 'معرض الغرابي للتقسيط', text: OWN_REPLY, classification: { intent: 'business_inquiry', isBusinessInquiry: true } },
    { platform: 'facebook', createdAt: iso(20), authorName: 'معرض الغرابي للتقسيط', text: OWN_REPLY, classification: { intent: 'business_inquiry', isBusinessInquiry: true } },
    { platform: 'instagram', createdAt: iso(30), authorId: 'PAGE_123', text: 'منتج جديد وصل', classification: { intent: 'other' } },
    { platform: 'facebook', createdAt: iso(40), authorName: 'أبو حسين', text: 'بكم الثلاجة بالأقساط؟', classification: { intent: 'business_inquiry', isBusinessInquiry: true } },
    { platform: 'youtube', createdAt: iso(50), authorName: 'زهراء', text: 'رائع 👏', classification: { intent: 'praise' } },
  ];
  const only = customerVoices(comments, id);
  check('★ تصفية الوارد: يبقى الزبونان فقط وبالترتيب', only.length === 2 && only[0].authorName === 'أبو حسين' && only[1].authorName === 'زهراء');
  const before = buildLiveInsights({ nowMs: NOW, comments, leads: [], publishRecords: [] });
  const after = buildLiveInsights({ nowMs: NOW, comments: only, leads: [], publishRecords: [] });
  const inq = (x: typeof before) => x.intents.find((i) => i.key === 'business_inquiry')?.count || 0;
  check('★ قبل الإصلاح: ردّانا يُحسبان استفسارين تجاريين (العطل كما رُصد)', inq(before) === 3 && before.latestComments.some((c) => c.text.includes('حياك الله')));
  check('★ بعد الإصلاح: استفسار تجاري واحد حقيقي، ولا ردّ للمعرض في «أصوات الزبائن»', inq(after) === 1 && !after.latestComments.some((c) => c.text.includes('حياك الله')) && after.hourly24.reduce((a, b) => a + b, 0) === 2);
}

// 2) صحة المشروع صادقة: موزونة بالأثر + سقف عند العطل
{
  const facts = (over: Partial<PatrolFacts> = {}): PatrolFacts => ({
    nowMs: NOW, uptimeSec: 9000, cycleHealthy: true, staleCycleNames: [], legacyErpEnabled: false, unhandledRejections: 0, unhandledRejectionsDelta: 0, liveEventsBuffered: 10, defectsOpen: 0, defectsCritical: 0, defectsTopTitle: null,
    pendingDrafts: 0, oldestPendingDraftAt: null, unreadCritical: 0, oldestUnreadCriticalAt: null, ownerEmailReady: true, ownerTelegramReady: true, ownerAlertsEnabled: true,
    ownerAccounts: 1, activeOwnerAccounts: 1, sessionSecretSource: 'SESSION_SECRET', revokedSessions: 3, loginEmailReady: true,
    brainEnabled: true, brainLastStatus: 'SUCCESS', brainLastError: null, brainLastSuccessAt: iso(5), brainLastCompletedAt: iso(5), brainCadenceMs: 900000, brainMemoryRecords: 10, brainMemoryCap: null,
    platforms: [{ id: 'facebook', connected: true, providerVerified: true, expiresAt: null, tokenReadable: true }], reauthUnread: 0, publishFailed24h: 0, publishOk24h: 1,
    sendModeAuto: false, commercialEnabled: true, expiredPendingDrafts: 0, schedulers: [{ key: 'youtube', label: 'يوتيوب', expected: true, armed: true }], jobsOverdue: 0, jobsFailed24h: 0,
    driveAuthorized: true, backupLevel: 'ok', backupConsecutiveFailures: 0, backupLastError: null, memoryMb: 200, limitMb: 512, memorySlopeMbPerHour: 0.5, loopLagMs: 2, loopLagMaxMs: 20, usageLevel: 'normal',
    storageReady: true, storageBackend: 'postgres', tls: 'verified', persistFailStreak: 0, writesRequested: 100, writesDone: 90, metricsLastRunAt: iso(30), metricsIntervalMs: 21600000,
    measured: [{ platform: 'youtube', ok: 5, total: 5, issue: null }], geminiConfigured: true, geminiVerified: 'ok', geminiUsed: 1, geminiLimit: 40, youtubeQuotaPercent: 10, youtubeQuotaExhausted: false,
    products: 81, productsBadPrice: 0, productsNoName: 0, installmentPlans: 2, showroomName: true, lastInboundAt: { facebook: iso(60) }, escalationsOpen: 0, oldestOpenEscalationAt: null,
    tokenKeyState: 'valid', draftsExpiringSoon: 0, unreadNotifications: 12, brainPersistFailures: 0, brainStaleLockRecoveries: 0, heapMb: 90, watcherErrors: { youtube: 0, meta: 0 },
    lastWebhookAt: { facebook: iso(120) }, staleOpenLeads: 0, openLeads: 5, productsNoImage: 0, productsStockMismatch: 0,
    telegramBotReady: true, emailProviderReady: true, audienceKnown: { facebook: true }, performanceRecords: 40,
    collections: [{ key: 'socialComments', size: 100, growthPerDay: 5 }], ...over,
  });
  const all = (f: PatrolFacts) => PATROL_ORDER.map((m) => inspectModule(m, f));
  const healthy = healthBreakdown(all(facts()));
  check('★ نظام سليم = 100% بلا سقف', healthy.score === 100 && !healthy.capped && healthy.fails === 0, JSON.stringify(healthy));

  // ما رصدته الشاشة الحية فعلاً (2026-10-27).
  const screen = facts({
    reauthUnread: 1,
    escalationsOpen: 44, oldestOpenEscalationAt: iso(14 * 1440),
    unreadCritical: 10, oldestUnreadCriticalAt: iso(8 * 1440),
    productsNoImage: 81, showroomName: false,
    staleOpenLeads: 21, openLeads: 21,
  });
  const ins = all(screen);
  const hb = healthBreakdown(ins);
  const oldMean = (() => { let s = 0, n = 0; for (const m of ins) for (const x of m.checks) { if (x.status === 'skip') continue; n += 1; s += x.status === 'ok' ? 1 : x.status === 'warn' ? 0.5 : 0; } return Math.round((s / n) * 100); })();
  check('★ المتوسط القديم كان يُعلن الحالة نفسها ≥88% (العطل كما رُصد)', oldMean >= 88, `old=${oldMean}`);
  check(`★ الصحة الجديدة ≤${HEALTH_CAP_WITH_FAIL}% مع وجود أعطال قائمة`, (hb.score ?? 100) <= HEALTH_CAP_WITH_FAIL && hb.fails >= 3, JSON.stringify({ score: hb.score, weighted: hb.weighted, fails: hb.fails, warns: hb.warns }));
  check('★ تصعيدات زبائن بلا رد أكثر من أسبوع = عطل لا تحذير', ins.flatMap((m) => m.checks).some((c) => c.id === 'customers.escalations' && c.status === 'fail'));
  check('★ تنبيهات حرجة مهملة أسبوعاً = عطل', ins.flatMap((m) => m.checks).some((c) => c.id === 'owner.critical' && c.status === 'fail'));
  check('تصعيد عمره 3 أيام يبقى تحذيراً (لا تضخيم)', inspectModule('customers', facts({ escalationsOpen: 2, oldestOpenEscalationAt: iso(3 * 1440) })).checks.find((c) => c.id === 'customers.escalations')?.status === 'warn');
  check('★ أثقل الثغرات أولاً: الأعطال ثم الأعلى أثراً', hb.top.length > 0 && hb.top[0].status === 'fail' && hb.top[0].impact === 3 && hb.top.every((t, i, a) => i === 0 || a[i - 1].status === 'fail' || t.status === 'warn'));
  check('★ الشفافية: يُعلن الموزون قبل السقف ومتى خُفّض', typeof hb.weighted === 'number' && hb.capped === ((hb.weighted ?? 0) > (hb.score ?? 0)));
  const highWarnOnly = healthBreakdown(all(facts({ staleOpenLeads: 3 })));
  check(`★ تحذير يمسّ الزبائن وحده ⇒ لا يُعلن «ممتاز» (≤${HEALTH_CAP_WITH_HIGH_WARN}%)`, (highWarnOnly.score ?? 100) <= HEALTH_CAP_WITH_HIGH_WARN && highWarnOnly.fails === 0);
  const lowWarnOnly = healthBreakdown(all(facts({ revokedSessions: 460 })));
  check('تحذير صيانة منخفض الأثر لا يُسقط الصحة بلا سبب (≥95%)', (lowWarnOnly.score ?? 0) >= 95 && !lowWarnOnly.capped, JSON.stringify(lowWarnOnly));
  check('الوزن: الزبون/البيانات 3 · المالك/المحتوى 2 · الصيانة 1 · السعة 2', checkImpact('customers.escalations') === 3 && checkImpact('products.images') === 2 && checkImpact('auth.revoked') === 1 && checkImpact('capacity.notifications') === 2);
  check('healthScore = رقم التفصيل نفسه (مصدر واحد)', healthScore(ins) === hb.score && healthScore([]) === null);
}

// 3) الربط في الخادم والواجهة
{
  const server = read('server.ts');
  const ui = read('src/components/live/LiveBrainRoom.tsx');
  check('★ الغرفة الحية تقرأ أصوات الزبائن فقط', server.includes('const inbound = customerComments();') && server.includes('function customerComments(): any[]'));
  check('★ تنبيه «استفسارات 24 ساعة» وبطاقات المنصات وفحص «الوارد» من الزبائن فقط', server.includes('const inquiries24h = customerComments().filter(') && server.includes('inbound: customerComments().filter((c) => c?.platform === platform).length') && server.includes('safe(() => customerComments(), comments)'));
  check('★ الهوية من مصادر حقيقية: حسابات متصلة + معرّفات المزوّد + ردود أُرسلت فعلاً', server.includes('for (const c of platformConnections.values() as any)') && server.includes('tok("facebook").pageId') && server.includes('r.simulated !== true') && server.includes('a?.sentText'));
  check('★ الوسم عند الاستقبال: ردّ الصفحة يُوسم selfAuthored، ويوتيوب يحفظ معرّف قناة الكاتب', server.includes('...(selfAuthored ? { selfAuthored: true } : {})') && server.includes('authorId: (c as any).authorChannelId || null'));
  check('★ لا حذف: الاستبعاد من العرض والإحصاء فقط', !/socialComments\s*=\s*customerVoices/.test(server) && !/socialComments\s*=\s*customerComments/.test(server));
  check('★ تفصيل الصحة يصل للواجهة ويُعرض سببه', server.includes('health: healthBreakdown(list)') && ui.includes('const healthWhy: string') && ui.includes('data-health-counts'));
}

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} live-honesty checks`);
