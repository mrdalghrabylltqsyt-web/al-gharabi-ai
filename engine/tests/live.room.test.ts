/**
 * غرفة العقل الحية — المنطق الصافي + عقود الربط بالخادم والواجهة.
 *  1) أسطر السجل المعروفة فقط تتحوّل لأحداث (لا بث لسطر عشوائي)، بنص عربي واضح.
 *  2) عمليات audit ⇒ أحداث، والقراءة الروتينية (بحث/عرض) لا تُبث.
 *  3) المخزن الدائري: ترتيب، since، منع تكرار فوري، سقف.
 *  4) حالة الأقسام من أرقام حقيقية (لا افتراض).
 *  5) الخادم: مسار للمالك فقط، يُغذّى من السجل/audit/التعليقات/المسودات/المراقب.
 *  6) الواجهة: استطلاع حقيقي، نبضة لكل حدث، لا أرقام ثابتة.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyLogLine, auditToLiveEvent, LiveEventBuffer, buildLiveModules, LIVE_MODULE_KEYS, buildLiveInsights, buildLiveCycles, describeMetricsIssue } from '../ops/liveRoom';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// 1) السجل
const m = classifyLogLine('[metrics] platform=facebook posts=7 withMetrics=5 followers=1064 error=10');
check('★ سطر المؤشرات ⇒ حدث الذاكرة بالعربية', m?.module === 'memory' && m.title === 'أرقام فيسبوك' && m.text.includes('قيست 5 من 7') && m.text.includes('1064'), JSON.stringify(m));
check('منصة بلا أي قياس ⇒ تحذير', classifyLogLine('[metrics] platform=threads posts=11 withMetrics=0 followers=- error=10')?.level === 'warn');
check('★ نشر ناجح ⇒ النشر والمنصات', classifyLogLine('[publish] platform=instagram outcome=published status=200 providerPostId=1 code=- providerCode=- ms=900')?.module === 'platforms');
check('فشل نشر ⇒ خطأ', classifyLogLine('[publish] platform=threads outcome=failed status=502 providerPostId=- code=X providerCode=- ms=1')?.level === 'error');
check('★ نسخة احتياطية ناجحة', classifyLogLine('[dr-backup] outcome=ok state=done trigger=auto decision=due recoveryPoint=rp-055 ms=1000')?.module === 'backup');
check('★ تعثّر قراءة التعليقات', classifyLogLine('[comments] platform=facebook outcome=failed code=100 streak=3')?.level === 'error');
check('TLS قاعدة البيانات', classifyLogLine('[storage] tls verify=ok mode=strict')?.module === 'storage');
check('فشل الحفظ', classifyLogLine('Could not persist server state: ETIMEDOUT streak=2')?.level === 'error');
check('إقلاع الخادم', classifyLogLine('[الغرابي AI Server] running on http://0.0.0.0:10000')?.module === 'monitor');
check('★ سطر عشوائي لا يُبث', classifyLogLine('some random debug token=abc') === null && classifyLogLine('') === null);

// 2) audit
check('★ عملية معروفة ⇒ حدث', auditToLiveEvent('product_created', 'سبلت 2 طن')?.module === 'products');
check('★ البحث/العرض لا يُبث', auditToLiveEvent('workspace_search', 'x') === null && auditToLiveEvent('commercial_inbox_view') === null);
check('تفصيل JSON لا يُعرض خاماً', auditToLiveEvent('commercial_draft_refreshed', '{"from":"a"}')?.text === '');
check('عملية غير معروفة ⇒ قسم مستنتج', auditToLiveEvent('youtube_reply_sent')?.module === 'automation');

// 3) المخزن
const buf = new LiveEventBuffer(5);
const t0 = Date.parse('2026-10-25T20:00:00Z');
for (let i = 0; i < 8; i += 1) buf.push({ module: 'core', level: 'info', title: `e${i}`, text: '' }, new Date(t0 + i * 5000).toISOString());
check('★ سقف المخزن', buf.since(0).length === 5 && buf.since(0)[0].title === 'e3');
check('★ since يعيد الجديد فقط', buf.since(6).map((e) => e.title).join(',') === 'e6,e7');
check('منع التكرار الفوري', buf.push({ module: 'core', level: 'info', title: 'e7', text: '' }, new Date(t0 + 7 * 5000 + 1000).toISOString()) === null);
check('lastId يتقدّم', buf.lastId === 8);

// 4) الأقسام
const base = {
  nowMs: t0, platforms: [{ id: 'facebook', connected: true }, { id: 'threads', connected: true, partial: 'ينقص صلاحية الرؤى' }, { id: 'whatsapp', connected: false }],
  pendingReplies: 4, inbound: 156, inquiries24h: 3, leadsOpen: 15, products: 81, productsInStock: 80, publishedPosts: 16,
  measured: [{ platform: 'youtube', ok: 50, total: 50 }, { platform: 'threads', ok: 0, total: 11 }], followers: { facebook: 1064 },
  sendModeApproval: true, commercialEnabled: true, youtubeAutoReply: false, youtubeCycles: 2516, youtubeLastPollAt: new Date(t0 - 60000).toISOString(),
  metaLastPollAt: new Date(t0 - 120000).toISOString(), metaFailing: [], brainCycles: 40, brainLastSuccessAt: new Date(t0 - 600000).toISOString(),
  storageHealthy: true, tls: 'verified', persistFailStreak: 0, writesCoalesced: 30, writesDone: 60, backupLevel: 'ok' as const,
  backupLastSuccessAt: new Date(t0 - 3600000).toISOString(), memoryMb: 150, uptimeSec: 3600, geminiEnabled: true, ownerTelegram: false, ownerEmailAlerts: true, usagePressure: 'normal',
};
const v = buildLiveModules(base);
check('★ كل الأقسام الثلاثة عشر موجودة', LIVE_MODULE_KEYS.every((k) => Boolean((v as any)[k])));
check('★ المنصات جزئية (غير مربوطة + صلاحية ناقصة)', v.platforms.status === 'partial' && v.platforms.metric.startsWith('2 من 3'));
check('الرد الآلي الموقوف ⇒ الأتمتة جزئية', v.automation.status === 'partial');
check('المالك: 4 ردود تنتظره', v.owner.metric.includes('4'));
check('★ التخزين الموثّق ⇒ يعمل', v.storage.status === 'ok');
check('★ فشل الحفظ ⇒ التخزين متوقف', buildLiveModules({ ...base, persistFailStreak: 3 }).storage.status === 'off');
check('الذاكرة: 50 من 61 مقاساً', v.memory.metric.startsWith('50 من 61'));
check('لا نسخ ⇒ النسخ متوقف', buildLiveModules({ ...base, backupLevel: null, backupLastSuccessAt: null }).backup.status === 'off');

// 5) الخادم
const server = read('server.ts');
check('★ المسار للمالك فقط', server.includes('app.get("/api/live/room", requireOwner,'));
check('★ يُغذّى من السجل (بادئات معروفة)', server.includes('if (first) liveEvent(classifyLogLine(first));'));
check('★ ومن audit', server.includes('liveEvent(auditToLiveEvent(action, detail));'));
check('★ ومن كل تعليق وارد', (server.match(/liveEvent\(liveCommentEvent\(/g) || []).length === 3);
check('ومن مسودات الردود وقرارات المراقب', server.includes("title: `رد جاهز بانتظار موافقتك") && server.includes('const WATCHER_LIVE'));
check('اللقطة من الذاكرة بلا استعلام قاعدة', !/app\.get\("\/api\/live\/room"[\s\S]{0,4000}storageAdapter\.read/.test(server));

// 6) الواجهة
const ui = read('src/components/live/LiveBrainRoom.tsx');
check('★ استطلاع حقيقي للخادم', ui.includes('apiService.getLiveRoom(lastIdRef.current)') && ui.includes('const POLL_MS = 4000;'));
check('★ نبضة لكل حدث على خط قسمه', ui.includes('lbr-burst') && ui.includes('offsetPath'));
check('يتوقف عند إخفاء الصفحة', ui.includes("document.visibilityState === 'visible'"));
check('للمالك فقط في الواجهة والتنقل', ui.includes("currentUser?.role === 'owner'") && read('src/components/common/navConfig.tsx').includes("id: 'live_room'") && read('src/App.tsx').includes("case 'live_room': return <LiveBrainRoom />;"));
check('لا أرقام ثابتة مختلقة في الواجهة', !/1,064|2,516|\b156\b/.test(ui));

// 7) الإصدار 2 — رؤى حقيقية + مقاييس الخادم + واجهة متوهجة متجاوبة
const nowI = Date.parse('2026-10-25T20:00:00Z');
const iso = (msAgo: number) => new Date(nowI - msAgo).toISOString();
const insights = buildLiveInsights({
  nowMs: nowI,
  comments: [
    { createdAt: iso(10 * 60000), platform: 'facebook', text: 'بيش السبلت؟', classification: { intent: 'business_inquiry', topic: 'price' } },
    { createdAt: iso(30 * 60000), platform: 'facebook', text: 'شنو شروط التقسيط', classification: { intent: 'question', topic: 'installment', isBusinessInquiry: true } },
    { createdAt: iso(5 * 3600000), platform: 'youtube', text: 'حلو', classification: { intent: 'praise' } },
    { createdAt: iso(3 * 86400000), platform: 'instagram', text: 'قديم', classification: { intent: 'question' } },
    { createdAt: iso(60000), platform: 'facebook', text: 'مستورد', backfill: true, classification: { intent: 'question' } },
  ],
  leads: [{ interestedProductName: 'سبلت 2 طن', stage: 'NEW' }, { interestedProductName: 'سبلت 2 طن', stage: 'QUALIFIED' }, { interestedProductName: 'ثلاجة', archived: true }],
  publishRecords: [{ platform: 'youtube', state: 'published', externalVideoId: 'v1' }, { platform: 'facebook', state: 'published' }, { platform: 'facebook', state: 'failed' }, { platform: 'x', state: 'published', providerPostId: 'p', simulated: true }],
});
check('★ 24 خانة ساعية', insights.hourly24.length === 24 && insights.hourlyInquiries24.length === 24);
check('★ آخر 24 ساعة فقط، بلا المستورد', insights.hourly24.reduce((a, b) => a + b, 0) === 3, JSON.stringify(insights.hourly24));
check('★ الاستفسارات التجارية (بما فيها isBusinessInquiry)', insights.hourlyInquiries24.reduce((a, b) => a + b, 0) === 2);
check('الأحدث في آخر خانة', insights.hourly24[23] === 2);
check('النوايا بالعربية مرتبة', insights.intents[0].key === 'business_inquiry' && insights.intents[0].count === 2 && insights.intents[0].label === 'استفسار تجاري');
check('المواضيع', insights.topics.some((t) => t.key === 'price' && t.label === 'السعر'));
check('★ حسب المنصة', insights.byPlatform[0].platform === 'facebook' && insights.byPlatform[0].total === 2 && insights.byPlatform[0].last24h === 2);
check('★ أكثر منتج مطلوب من الزبائن غير المؤرشفين', insights.topProducts.length === 1 && insights.topProducts[0].name === 'سبلت 2 طن' && insights.topProducts[0].count === 2);
check('★ النشر يُحسب بمعرّف حقيقي فقط ولا يحسب المُحاكى', insights.publish.find((p) => p.platform === 'youtube')?.published === 1 && insights.publish.find((p) => p.platform === 'facebook')?.published === 0 && insights.publish.find((p) => p.platform === 'facebook')?.failed === 1 && !insights.publish.some((p) => p.platform === 'x'));
check('★ آخر التعليقات بلا أسماء الزبائن', insights.latestComments.length === 4 && insights.latestComments.every((c) => !('authorName' in c)) && insights.latestComments[0].text === 'بيش السبلت؟');
check('مراحل الزبائن', insights.leadStages.length === 2);
check('★ الخادم يرسل الرؤى والمقاييس والموافقات', server.includes('insights: buildLiveInsights({') && server.includes('telemetry: (() => {') && server.includes('approvals: (() => {'));
check('★ تأخّر حلقة الأحداث يُقاس فعلاً', server.includes('liveLoop') && /setInterval\([\s\S]{0,400}liveLoop[\s\S]{0,200}\.unref/.test(server));
check('★ الواجهة تتصغّر على الهاتف بدل القصّ', ui.includes('ResizeObserver') && ui.includes('scale(${scale})'));
check('★ توهّج SVG حقيقي', ui.includes('feGaussianBlur') && ui.includes('url(#lbrGlow)'));
check('★ نبض النشاط من أوقات الأحداث الحقيقية', ui.includes('eventTimes') && ui.includes('BUCKET_MS'));
check('★ لوحات الرؤى والمقاييس', ['hourly24', 'intents', 'topProducts', 'latestComments', 'leadStages', 'tel.rssMb', 'tel.loopLagMs', 'appr.latest'].every((k) => ui.includes(k)));
check('احترام تقليل الحركة', ui.includes('prefers-reduced-motion') && ui.includes('lbr-still'));

// 8) مركز السيطرة — كل التنبيهات والإشعارات والتصعيدات ومفاتيح الأمان داخل الغرفة
const cc = read('src/components/live/LiveControlCenter.tsx');
check('★ مصدر تنبيهات واحد للشاشتين', server.includes('function buildSystemAlerts(): any[]') && server.includes('const alerts = buildSystemAlerts();') && server.includes('alerts: (() => { try { return buildSystemAlerts(); }'));
check('★ الغرفة تحمل الإشعارات والتصعيدات والمفاتيح', server.includes('notifications: (() => {') && server.includes('escalations: (() => {') && server.includes('controls: (() => {'));
check('★ حالات الأمان صارت تنبيهات', ['escalations-open', 'commercial-killed', 'send-mode-auto', 'watcher-paused-', 'backup-stale', 'notifications-critical'].every((k) => server.includes(k)));
check('★ كل إشعار يُبث لحظياً في الغرفة', /function pushNotification[\s\S]{0,900}liveEvent\(/.test(server));
check('★ كل مفاتيح الأمان مربوطة', ['setCommercialKillSwitch', 'setCommercialSendMode', 'setYouTubeWatcherControls', 'setMetaWatcherControls', 'setTelegramWatcherControls', 'setJobAutoExecute', 'setOwnerAlerts'].every((m) => cc.includes(`apiService.${m}(`)));
check('★ إيقاف طارئ شامل', cc.includes('إيقاف طارئ شامل') && cc.includes('Promise.allSettled'));
check('★ التحويل نحو أتمتة أكثر يطلب تأكيداً', cc.includes('riskyOn') && cc.includes('role="dialog"'));
check('الإشعارات تُعلَّم مقروءة والتصعيدات تُحَل من الغرفة', cc.includes('apiService.markNotificationRead(n.id)') && cc.includes('apiService.markAllNotificationsRead()') && cc.includes("apiService.transitionEscalation(e.id, 'resolve')"));
check('شريط إنذار بلا عدّ مزدوج', cc.includes("a.id !== 'notifications-critical'"));
check('★ مدمج في الغرفة', ui.includes('<LiveAlertStrip') && ui.includes('<LiveControlCenter'));

// 9) الشاشة الحية — اللوحة كاملة في شاشة واحدة بضغطة زر من الترويسة
const header = read('src/components/common/Header.tsx');
const app = read('src/App.tsx');
check('★ زر الشاشة الحية في الترويسة للمالك فقط', header.includes('الشاشة الحية') && header.includes("currentUser?.role === 'owner' && onOpenLiveWall") && header.includes('requestFullscreen'));
check('★ الشاشة الحية فوق الواجهة (تخفي الأقسام الجانبية)', app.includes('<LiveBrainRoom variant="wall" onClose={closeLiveWall} />') && ui.includes("position: 'fixed', inset: 0, zIndex: 60"));
check('★ نفس المصدر لا مصدر ثانٍ', !/fetch\(/.test(ui) && ui.includes('apiService.getLiveRoom(lastIdRef.current)'));
check('★ ملاءمة شاشة واحدة بلا تمرير', ui.includes('lbr-wallgrid') && ui.includes('c.scrollHeight <= c.clientHeight + 1') && ui.includes('wallBox.w / 1500') && ui.includes("transformOrigin: 'top right'"));
check('لا جلب مزدوج أثناء فتح الشاشة', ui.includes("document.body.dataset.liveWall !== '1'") && ui.includes('delete body.dataset.liveWall'));
check('Esc والإغلاق يعيدان الواجهة كما كانت', ui.includes("e.key === 'Escape'") && ui.includes('body.style.overflow = prevOverflow') && ui.includes('exitFullscreen'));
check('مركز السيطرة المضغوط يغلق الشاشة عند الانتقال', cc.includes('compact?: boolean') && cc.includes('onLeave?.()'));
check('الإشعار المنبثق يظهر فوق الشاشة الحية', app.includes('z-[90] glass-strong'));

// 10) إيقاع الغرفة — موسيقى تُولَّد محلياً وتتفاعل مع الأحداث الحقيقية
const snd = read('src/components/live/liveSoundtrack.ts');
check('★ الإيقاع يُولَّد في المتصفح (لا ملفات ولا شبكة ولا حصة)', snd.includes('createOscillator') && !/fetch\(|new Audio\(|\.mp3|\.wav|apiService/.test(snd));
check('★ زر تشغيل/إيقاف + نمط + مستوى صوت', ui.includes('getSoundtrack().toggle()') && ui.includes('نمط الإيقاع') && ui.includes('مستوى الصوت') && snd.includes("SOUND_MODES"));
check('★ كل حدث حقيقي نغمة على الإيقاع', ui.includes('getSoundtrack().ping(') && snd.includes('ping(level: PingLevel)'));
check('الطاقة من النشاط الحقيقي وأخطر تنبيه', ui.includes('getSoundtrack().setEnergy(perMinute, alarmLevel)'));
check('قلب العقل ينبض مع الضربة', ui.includes('lbr-thump') && snd.includes('onBeat('));
check('محرّك واحد مشترك ويتوقف بإغلاق آخر غرفة', snd.includes('export function getSoundtrack()') && ui.includes('if (openRooms <= 0) st.stop(false)'));
check('لا تشغيل بلا نقرة (سياسة المتصفح) والاختيار محفوظ', snd.includes("ctx.state !== 'running'") && snd.includes('gharabi.live.music'));

// 11) تدقيق الحقيقة (2026-10-26 #3): كل رقم من مصدره، لا نص ثابت ولا حركة توحي بنشاط غير حاصل
{
  const NOW = Date.parse('2026-10-26T10:00:00Z');
  const iso = (minAgo: number) => new Date(NOW - minAgo * 60000).toISOString();
  const cy = buildLiveCycles([
    { key: 'yt', label: 'يوتيوب', cadenceMs: 300000, lastRunAt: iso(2), cycles: 10, active: true },
    { key: 'cm', label: 'تجاري', cadenceMs: 600000, lastRunAt: iso(40), active: true },
    { key: 'tg', label: 'تيليغرام', cadenceMs: 600000, lastRunAt: null, active: false, pausedReason: 'غير مربوط' },
    { key: 'br', label: 'عقل', cadenceMs: 900000, lastRunAt: iso(60), active: true, deferred: true, deferredReason: 'ضغط الخطة' },
    { key: 'mx', label: 'أرقام', cadenceMs: 21600000, lastRunAt: null, active: true },
  ], NOW);
  check('★ دورة في موعدها = سليمة مع موعد التالية', cy[0].status === 'ok' && cy[0].nextDueAt === iso(-3) && cy[0].cycles === 10);
  check('★ دورة فاتتها أكثر من دورتين = متأخرة (منطق /api/health)', cy[1].status === 'late' && /فاتتها/.test(String(cy[1].note)));
  check('★ دورة موقوفة تُعلن سببها لا «متأخرة»', cy[2].status === 'paused' && cy[2].note === 'غير مربوط');
  check('★ دورة مؤجّلة تُعلن سبب التأجيل', cy[3].status === 'deferred' && cy[3].note === 'ضغط الخطة');
  check('دورة لم تُنفَّذ منذ الإقلاع تُقال صراحة', cy[4].status === 'never');
  check('★ رموز أخطاء المنصات بالعربية', describeMetricsIssue('10x11') === 'ينقص إذن الإحصاءات (11 منشوراً · 10x11)' && describeMetricsIssue('-') === null && /انتهت صلاحية/.test(String(describeMetricsIssue('190x2,4x1'))));
  check('سطر الأرقام يشرح الرمز بالعربية', /ينقص إذن الإحصاءات/.test(String(classifyLogLine('[metrics] platform=threads posts=11 withMetrics=0 followers=- issue=10x11')?.text)));
  const pub = buildLiveInsights({ nowMs: NOW, comments: [], leads: [], publishRecords: [
    { platform: 'facebook', state: 'published', providerPostId: 'a' }, { platform: 'facebook', state: 'published', providerPostId: 'a' },
    { platform: 'facebook', state: 'scheduled', providerPostId: 'b' }, { platform: 'facebook', state: 'scheduled', providerPostId: 'a' },
  ] }).publish.find((p) => p.platform === 'facebook');
  check('★ المنشور يُعدّ مرة واحدة والمجدول لا يُخلط بالمنشور', pub?.published === 1 && pub?.scheduled === 1);
  check('★ الخادم يرسل الدورات بإيقاعها الفعلي (مع مضاعف الضغط)', server.includes('cycles: (() => {') && server.includes('cadenceMs: 10 * 60 * 1000 * mult') && server.includes('resolveAutoBackupIntervalMs(process.env'));
  check('★ «جزئي» من البيانات لا نص ثابت', server.includes('Number(m.withMetrics || 0) === 0') && !server.includes('if (id === "tiktok") return "الإحصاءات'));
  check('★ استطلاع خفيف + كامل كل 30 ث (حارس الخطة)', server.includes('const lite = String(req.query?.lite') && ui.includes('const FULL_EVERY_MS = 30000;') && ui.includes('insights: r.insights ?? prev?.insights'));
  check('★ الأزمنة بساعة الخادم لا الجهاز', ui.includes('skewRef.current') && ui.includes('r?.serverTime'));
  check('★ «بث حي» لا يُعرض على بيانات قديمة', ui.includes('const STALE_MS = 15000;') && ui.includes('البث متأخر'));
  check('★ لا تدوير وهمي للسير العام ولا لنص قلب العقل', !ui.includes('Math.floor(now / 2600) % JOURNEY.length') && !ui.includes('Math.floor(now / 2200) % CORE_FNS.length') && ui.includes("'بانتظار حدث'"));
  check('★ سكون ليلي يحمي ساعات الخطة المجانية', ui.includes('NIGHT_IDLE_MS') && ui.includes("timeZone: 'Asia/Baghdad'") && ui.includes('!sleepingRef.current) void poll()'));
}

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const x of failures) console.error('  ✗ ' + x);
  process.exit(1);
}
console.log(`PASSED: ${passed} live-room checks`);
