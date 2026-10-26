/**
 * دورية المهندس المشرف (2026-10-26) — منطق صافٍ قابل للاختبار.
 *
 * العنكبوت لا ينتظر العطل: يتجوّل بلا توقف على أقسام المشروع الأربعة عشر (المركز + الثلاثة
 * عشر)، يقف عند كل قسم ويفحص كل ما بُني فيه من أول يوم، ثم ينتقل للذي يليه. كل فحص:
 *   - يقرأ حقيقة واحدة من حالة الخادم (تُجمع في `PatrolFacts` من الذاكرة — بلا شبكة ولا حصة)،
 *   - يحكم: سليم / تحذير / عطل / غير متاح،
 *   - ويحمل «معرفته»: لماذا يهم، وماذا يُفعل — فيكون التقرير تشخيصاً لا رقماً.
 * ويتنبأ بالثغرات قبل أن تكبر: يقيس نمو كل مجموعة بيانات ويقدّر متى تبلغ سقفها (حيث يُقصّ
 * الأقدم بصمت عند التحميل)، ونمو الذاكرة.
 *
 * لا شيء هنا يغيّر الحالة. الإصلاح (إن وُجد له إجراء آمن) يمر عبر كتيّب المهندس.
 */
import type { EngineerModule } from './siteEngineer';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';
export interface CheckResult {
  id: string;
  module: EngineerModule;
  label: string;
  status: CheckStatus;
  detail: string;
  /** المعرفة: لماذا يهم هذا الفحص. */
  why: string;
  /** المعرفة: ما العمل إن لم يكن سليماً. */
  advice: string | null;
  /** إصلاح آمن متاح في كتيّب المهندس (إن وُجد). */
  repair?: string | null;
}
export interface ModuleInspection { module: EngineerModule; at: string; status: CheckStatus; counts: { ok: number; warn: number; fail: number; skip: number }; checks: CheckResult[] }

/** ترتيب التجوال: مسار متصل يدور حول العقل (يبدأ وينتهي عند المركز). */
export const PATROL_ORDER: readonly EngineerModule[] = Object.freeze([
  'core', 'owner', 'auth', 'agents', 'platforms', 'gate', 'automation', 'backup', 'monitor', 'storage', 'memory', 'external', 'products', 'customers',
]);

/** سقوف المجموعات عند التحميل (server.ts — normalizePersistedState): ما يتجاوزها يُقصّ الأقدم بصمت. */
export const COLLECTION_CAPS: Readonly<Record<string, number>> = Object.freeze({
  socialComments: 10000, notifications: 10000, webhookEvents: 10000, providerEvents: 10000,
  socialReplies: 5000, socialEscalations: 5000, socialApprovals: 5000, publishRecords: 5000,
  performanceRecords: 20000, products: 1000, posts: 1000, conversations: 1000,
  telegramUpdateIds: 20000, facebookEventIds: 20000, instagramEventIds: 20000, youtubeCommentIds: 20000, youtubeOperationKeys: 20000,
  marketingDecisions: 2000, strategiesTested: 2000,
});
const COLLECTION_AR: Record<string, string> = {
  socialComments: 'التعليقات والرسائل', notifications: 'الإشعارات', webhookEvents: 'أحداث webhook', providerEvents: 'أحداث المزوّد',
  socialReplies: 'الردود', socialEscalations: 'التصعيدات', socialApprovals: 'الموافقات', publishRecords: 'سجل النشر',
  performanceRecords: 'سجل الأداء', products: 'المنتجات', posts: 'المحتوى', conversations: 'المحادثات',
  telegramUpdateIds: 'معرّفات تيليغرام', facebookEventIds: 'معرّفات فيسبوك', instagramEventIds: 'معرّفات إنستغرام',
  youtubeCommentIds: 'معرّفات تعليقات يوتيوب', youtubeOperationKeys: 'مفاتيح عمليات يوتيوب', marketingDecisions: 'قرارات التسويق', strategiesTested: 'الاستراتيجيات المجرّبة',
};

export interface PatrolFacts {
  nowMs: number;
  uptimeSec: number;
  // core
  cycleHealthy: boolean | null; staleCycleNames: string[];
  legacyErpEnabled: boolean;
  unhandledRejections: number; unhandledRejectionsDelta: number;
  liveEventsBuffered: number;
  // owner
  pendingDrafts: number; oldestPendingDraftAt: string | null;
  unreadCritical: number; oldestUnreadCriticalAt: string | null;
  ownerEmailReady: boolean; ownerTelegramReady: boolean; ownerAlertsEnabled: boolean;
  // auth
  ownerAccounts: number; activeOwnerAccounts: number;
  sessionSecretSource: string;
  revokedSessions: number;
  loginEmailReady: boolean;
  // agents
  brainEnabled: boolean; brainLastStatus: string | null; brainLastError: string | null; brainLastSuccessAt: string | null; brainCadenceMs: number;
  brainMemoryRecords: number; brainMemoryCap: number | null;
  // platforms
  platforms: Array<{ id: string; connected: boolean; providerVerified: boolean; expiresAt: string | null; tokenReadable: boolean | null }>;
  reauthUnread: number;
  publishFailed24h: number; publishOk24h: number;
  // gate
  sendModeAuto: boolean; commercialEnabled: boolean;
  expiredPendingDrafts: number;
  // automation
  schedulers: Array<{ key: string; label: string; expected: boolean; armed: boolean }>;
  jobsOverdue: number; jobsFailed24h: number;
  // backup
  driveAuthorized: boolean; backupLevel: 'ok' | 'warning' | 'critical' | null; backupConsecutiveFailures: number; backupLastError: string | null;
  // monitor
  memoryMb: number; limitMb: number; memorySlopeMbPerHour: number | null;
  loopLagMs: number; loopLagMaxMs: number;
  usageLevel: string;
  // storage
  storageReady: boolean; storageBackend: string; tls: string | null; persistFailStreak: number; writesRequested: number; writesDone: number;
  // memory (analytics)
  metricsLastRunAt: string | null; metricsIntervalMs: number;
  measured: Array<{ platform: string; ok: number; total: number; issue: string | null }>;
  // external
  geminiConfigured: boolean; geminiVerified: string | null; geminiUsed: number; geminiLimit: number;
  youtubeQuotaPercent: number | null; youtubeQuotaExhausted: boolean;
  // products
  products: number; productsBadPrice: number; productsNoName: number; installmentPlans: number;
  showroomName: boolean;
  // customers
  lastInboundAt: Record<string, string | null>;
  escalationsOpen: number; oldestOpenEscalationAt: string | null;
  // capacity (حجم كل مجموعة + معدّل نموها اليومي المقيس)
  collections: Array<{ key: string; size: number; growthPerDay: number | null }>;
}

const H = 3600000, D = 86400000;
const ageMs = (iso: string | null | undefined, now: number) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? now - t : null; };
const ageText = (ms: number | null) => (ms == null ? '—' : ms < H ? `${Math.max(1, Math.round(ms / 60000))} د` : ms < 2 * D ? `${Math.round(ms / H)} س` : `${Math.round(ms / D)} يوم`);
const PLATFORM_AR: Record<string, string> = { facebook: 'فيسبوك', instagram: 'إنستغرام', youtube: 'يوتيوب', threads: 'ثريدز', tiktok: 'تيك توك', telegram: 'تيليغرام', whatsapp: 'واتساب', x: 'X', snapchat: 'سناب شات', google_business: 'Google Business' };
const pa = (p: string) => PLATFORM_AR[p] || p;

type Check = (f: PatrolFacts) => Omit<CheckResult, 'module'>;
const c = (id: string, label: string, why: string, judge: (f: PatrolFacts) => { status: CheckStatus; detail: string; advice?: string | null; repair?: string | null }): Check =>
  (f) => { const r = judge(f); return { id, label, why, status: r.status, detail: r.detail, advice: r.status === 'ok' || r.status === 'skip' ? null : (r.advice ?? null), repair: r.repair ?? null }; };

/** قاعدة المعرفة: كل فحوص كل قسم. */
export const PATROL_CHECKS: Readonly<Record<EngineerModule, Check[]>> = Object.freeze({
  core: [
    c('core.cycles', 'كل الدورات النشطة في موعدها', 'توقف دورة بصمت يعني أن جزءاً من المشروع مات دون أن يُرى.', (f) => f.cycleHealthy == null ? { status: 'skip', detail: 'غير متاح' } : f.cycleHealthy ? { status: 'ok', detail: 'لا دورة متأخرة' } : { status: 'fail', detail: `متأخرة: ${f.staleCycleNames.join('، ')}`, advice: 'المهندس يعيد تسليحها تلقائياً — إن بقيت راجع تقريره', repair: 'cycles' }),
    c('core.scope', 'عزل أسطح ERP القديمة', 'النطاق المعلن سوشيال + AI + تسويق؛ فتح الأسطح القديمة يكشف مسارات غير مختبرة.', (f) => f.legacyErpEnabled ? { status: 'warn', detail: 'GHARABI_ENABLE_LEGACY_ERP_SCOPE مفعّل', advice: 'أعده إلى false ما لم تقرّر غير ذلك صراحة' } : { status: 'ok', detail: 'معزولة (404 قبل المصادقة)' }),
    c('core.rejections', 'وعود غير معالَجة', 'خطأ غير ملتقط قد يترك عملية في حالة غير معروفة.', (f) => f.unhandledRejectionsDelta > 0 ? { status: 'warn', detail: `${f.unhandledRejectionsDelta} جديدة منذ الجولة السابقة (المجموع ${f.unhandledRejections})`, advice: 'راجع سجل Render عند هذا الوقت لمعرفة المسار' } : { status: 'ok', detail: `لا جديد (المجموع منذ الإقلاع ${f.unhandledRejections})` }),
    c('core.uptime', 'استقرار العملية', 'إعادة التشغيل المتكررة تعني انهياراً أو نفاد ذاكرة.', (f) => f.uptimeSec < 300 ? { status: 'warn', detail: `أقلع منذ ${Math.round(f.uptimeSec / 60)} د`, advice: 'طبيعي بعد النشر؛ إن تكرر بلا نشر فهو انهيار — راجع سجل Render' } : { status: 'ok', detail: `يعمل منذ ${ageText(f.uptimeSec * 1000)}` }),
  ],
  owner: [
    c('owner.pending', 'ردود تنتظر قرارك', 'رد جاهز لا يُرسل يعني زبوناً ينتظر.', (f) => { const a = ageMs(f.oldestPendingDraftAt, f.nowMs); return f.pendingDrafts === 0 ? { status: 'ok', detail: 'لا شيء ينتظر' } : a != null && a > 48 * H ? { status: 'warn', detail: `${f.pendingDrafts} رداً، أقدمها منذ ${ageText(a)}`, advice: 'افتح «صندوق الزبائن» ووافق أو عدّل' } : { status: 'ok', detail: `${f.pendingDrafts} رداً حديثاً` }; }),
    c('owner.critical', 'تنبيهات حرجة غير مقروءة', 'تنبيه حرج قديم غير مقروء يخفي ما يستجد.', (f) => { const a = ageMs(f.oldestUnreadCriticalAt, f.nowMs); return f.unreadCritical === 0 ? { status: 'ok', detail: 'لا شيء' } : a != null && a > 24 * H ? { status: 'warn', detail: `${f.unreadCritical} منذ ${ageText(a)}`, advice: 'اقرأها من مركز السيطرة أو علّمها مقروءة' } : { status: 'ok', detail: `${f.unreadCritical} حديثة` }; }),
    c('owner.channel', 'قناة تنبيهك الخارجية', 'بلا قناة خارجية لن تعلم بالعطل إلا إن فتحت الشاشة.', (f) => !f.ownerAlertsEnabled ? { status: 'warn', detail: 'التنبيهات الخارجية معطّلة', advice: 'فعّلها من مركز السيطرة' } : f.ownerEmailReady || f.ownerTelegramReady ? { status: 'ok', detail: [f.ownerEmailReady ? 'بريد' : '', f.ownerTelegramReady ? 'تيليغرام' : ''].filter(Boolean).join(' + ') } : { status: 'fail', detail: 'لا بريد ولا تيليغرام مضبوط', advice: 'اضبط RESEND/البريد أو OWNER_TELEGRAM_CHAT_ID' }),
  ],
  auth: [
    c('auth.owner', 'حساب المالك', 'بلا مالك نشط لا أحد يملك القرار.', (f) => f.activeOwnerAccounts > 0 ? { status: 'ok', detail: `${f.activeOwnerAccounts} مالك نشط` } : { status: 'fail', detail: 'لا مالك نشط', advice: 'راجع المستخدمين والصلاحيات' }),
    c('auth.secret', 'سرّ توقيع الجلسات', 'سرّ مؤقت يعني خروج الجميع عند كل إعادة تشغيل.', (f) => f.sessionSecretSource === 'ephemeral' ? { status: 'fail', detail: 'سرّ مؤقت', advice: 'اضبط SESSION_SECRET في Render' } : { status: 'ok', detail: `من ${f.sessionSecretSource}` }),
    c('auth.login', 'بريد رمز الدخول', 'دخول المالك برمز يُرسل بالبريد؛ بلا بريد لا دخول.', (f) => f.loginEmailReady ? { status: 'ok', detail: 'مزوّد البريد مضبوط' } : { status: 'fail', detail: 'مزوّد البريد غير مضبوط', advice: 'اضبط مزوّد البريد قبل انتهاء جلستك' }),
    c('auth.revoked', 'سجل الجلسات الملغاة', 'السجل محدود بـ500؛ تجاوزه يُسقط الأقدم فتعود جلسات ملغاة صالحة.', (f) => f.revokedSessions >= 450 ? { status: 'warn', detail: `${f.revokedSessions} من 500`, advice: 'استخدم «إبطال كل الجلسات» بدل الإبطال الفردي' } : { status: 'ok', detail: `${f.revokedSessions} من 500` }),
  ],
  agents: [
    c('agents.run', 'دورة العقل المركزي', 'العقل يتعلّم من البيانات كل 15 دقيقة؛ توقّفه يجمّد التوصيات.', (f) => { if (!f.brainEnabled) return { status: 'skip', detail: 'معطّل من الإعداد' }; const a = ageMs(f.brainLastSuccessAt, f.nowMs); return a == null ? { status: 'warn', detail: 'لا دورة ناجحة بعد', advice: 'انتظر الدورة الأولى' } : a > f.brainCadenceMs * 3 ? { status: 'fail', detail: `آخر نجاح منذ ${ageText(a)}`, advice: 'المهندس يشغّل دورة مباشرة', repair: 'cycles' } : { status: 'ok', detail: `آخر نجاح منذ ${ageText(a)}` }; }),
    c('agents.failures', 'آخر دورة للعقل', 'دورة FAILED تعني خطأ في بناء العقل من البيانات.', (f) => f.brainLastStatus === 'FAILED' ? { status: 'fail', detail: `فشلت${f.brainLastError ? `: ${f.brainLastError}` : ''}`, advice: 'المهندس يعيد التشغيل؛ إن تكرر راجع سجل Render' } : { status: 'ok', detail: `آخر حالة ${f.brainLastStatus || '—'}` }),
    c('agents.memory', 'ذاكرة العقل', 'امتلاء الذاكرة يجعل العقل ينسى الأقدم.', (f) => f.brainMemoryCap && f.brainMemoryRecords >= f.brainMemoryCap * 0.9 ? { status: 'warn', detail: `${f.brainMemoryRecords} من ${f.brainMemoryCap}`, advice: 'طبيعي أن تدور؛ تأكد أن الدروس المهمة مثبّتة' } : { status: 'ok', detail: `${f.brainMemoryRecords} سجلاً${f.brainMemoryCap ? ` من ${f.brainMemoryCap}` : ''}` }),
  ],
  platforms: [
    c('platforms.verified', 'المنصات المتصلة موثّقة', '«متصل» بلا تحقق من المزوّد اتصال وهمي.', (f) => { const bad = f.platforms.filter((p) => p.connected && !p.providerVerified); const n = f.platforms.filter((p) => p.connected).length; return bad.length ? { status: 'fail', detail: `بلا توثيق: ${bad.map((p) => pa(p.id)).join('، ')}`, advice: 'أعد الربط من مركز ربط المنصات' } : { status: 'ok', detail: `${n} متصلة وكلها موثّقة` }; }),
    c('platforms.token', 'رموز المنصات قابلة للفك', 'رمز مخزّن لا يُفك (تغيّر مفتاح التشفير) يعني أن المنصة «متصلة» شكلاً ومعطّلة فعلاً.', (f) => { const bad = f.platforms.filter((p) => p.connected && p.tokenReadable === false); return bad.length ? { status: 'fail', detail: `رمز غير قابل للفك: ${bad.map((p) => pa(p.id)).join('، ')}`, advice: 'تحقق من PLATFORM_TOKEN_ENCRYPTION_KEY ثم أعد ربط المنصة' } : { status: 'ok', detail: 'كل الرموز المخزّنة سليمة' }; }),
    c('platforms.expiry', 'صلاحية رموز المنصات', 'رمز ينتهي دون تجديد يوقف القراءة والنشر فجأة.', (f) => { if (!f.platforms.some((p) => p.connected && p.expiresAt)) return { status: 'skip', detail: 'المنصات لا تعلن تاريخ انتهاء (تُجدَّد تلقائياً)' }; const soon = f.platforms.filter((p) => p.connected && p.expiresAt && (ageMs(p.expiresAt, f.nowMs) ?? -Infinity) > -7 * D); const gone = soon.filter((p) => (ageMs(p.expiresAt, f.nowMs) ?? -1) >= 0); return gone.length ? { status: 'fail', detail: `منتهية: ${gone.map((p) => pa(p.id)).join('، ')}`, advice: 'أعد الربط الآن' } : soon.length ? { status: 'warn', detail: `تنتهي خلال 7 أيام: ${soon.map((p) => pa(p.id)).join('، ')}`, advice: 'أعد الربط قبل الانتهاء' } : { status: 'ok', detail: 'لا رمز ينتهي قريباً' }; }),
    c('platforms.reauth', 'طلبات إعادة ربط', 'المنصة أبلغت أن الرمز لم يعد صالحاً.', (f) => f.reauthUnread ? { status: 'fail', detail: `${f.reauthUnread} طلب غير مقروء`, advice: 'افتح مركز ربط المنصات' } : { status: 'ok', detail: 'لا طلبات' }),
    c('platforms.publish', 'نجاح النشر · 24 ساعة', 'فشل النشر المتكرر يضيّع المحتوى المعتمد.', (f) => { const t = f.publishOk24h + f.publishFailed24h; return t === 0 ? { status: 'ok', detail: 'لا محاولات نشر اليوم' } : f.publishFailed24h / t > 0.3 ? { status: 'warn', detail: `${f.publishFailed24h} فشل من ${t}`, advice: 'افتح سجل النشر لمعرفة رمز الفشل' } : { status: 'ok', detail: `${f.publishOk24h} نجاح من ${t}` }; }),
  ],
  gate: [
    c('gate.mode', 'وضع الإرسال', 'التلقائي يرسل بلا مراجعتك.', (f) => f.sendModeAuto ? { status: 'warn', detail: 'تلقائي (بقرارك)', advice: 'أعده إلى «موافقة» إن لم يكن مقصوداً' } : { status: 'ok', detail: 'لا إرسال بلا موافقتك' }),
    c('gate.expired', 'مسودات تجاوزت نافذة الرد', 'مسودة منتهية النافذة لا يمكن إرسالها وتضلّل العدّاد.', (f) => f.expiredPendingDrafts ? { status: 'warn', detail: `${f.expiredPendingDrafts} مسودة منتهية ما زالت «معلّقة»`, advice: 'المهندس يعلّمها منتهية (بلا حذف)', repair: 'drafts_expired' } : { status: 'ok', detail: 'لا مسودات منتهية معلّقة' }),
  ],
  automation: [
    c('automation.timers', 'مؤقّتات الدورات حيّة', 'دورة مفعّلة بلا مؤقّت لن تعمل أبداً.', (f) => { const dead = f.schedulers.filter((s) => s.expected && !s.armed); return dead.length ? { status: 'fail', detail: `بلا مؤقّت: ${dead.map((s) => s.label).join('، ')}`, advice: 'المهندس يعيد تسليحها', repair: 'cycles' } : { status: 'ok', detail: `${f.schedulers.filter((s) => s.armed).length} مؤقّتات تعمل` }; }),
    c('automation.jobs', 'مهام فات موعدها', 'مهمة معتمدة فات موعدها والنشر التلقائي مفعّل يعني أن المنفّذ لا يعمل.', (f) => f.jobsOverdue ? { status: 'warn', detail: `${f.jobsOverdue} مهمة جاهزة فات موعدها بأكثر من 30 د`, advice: 'افتح التقويم ← المهام المجدولة ونفّذها يدوياً' } : { status: 'ok', detail: 'لا مهام متأخرة' }),
    c('automation.failed', 'مهام فاشلة · 24 ساعة', 'فشل المهام يعني محتوى معتمداً لم يُنشر.', (f) => f.jobsFailed24h ? { status: 'warn', detail: `${f.jobsFailed24h} مهمة فشلت`, advice: 'أعد المحاولة من المهام المجدولة' } : { status: 'ok', detail: 'لا فشل' }),
  ],
  backup: [
    c('backup.auth', 'تفويض Google Drive', 'بلا تفويض لا نسخ احتياطي ولا استعادة.', (f) => f.driveAuthorized ? { status: 'ok', detail: 'مفوّض' } : { status: 'fail', detail: 'غير مفوّض', advice: 'اربط Drive من «النسخ السحابي»' }),
    c('backup.fresh', 'حداثة النسخة', 'نسخة قديمة تعني فقدان ما بعدها عند الكارثة.', (f) => !f.driveAuthorized ? { status: 'skip', detail: 'لا تفويض' } : f.backupLevel === 'ok' ? { status: 'ok', detail: 'ضمن 6 ساعات' } : { status: f.backupLevel === 'critical' ? 'fail' : 'warn', detail: f.backupLevel === 'critical' ? 'قديمة جداً' : 'متأخرة', advice: 'المهندس يشغّل دورة النسخ', repair: 'backup' }),
    c('backup.failures', 'إخفاقات النسخ المتتالية', 'تكرار الفشل يعني سبباً ثابتاً (مساحة/تفويض).', (f) => f.backupConsecutiveFailures >= 2 ? { status: 'fail', detail: `${f.backupConsecutiveFailures} فشل متتالٍ${f.backupLastError ? ` (${f.backupLastError})` : ''}`, advice: 'راجع مساحة Drive والتفويض' } : { status: 'ok', detail: 'لا إخفاقات' }),
  ],
  monitor: [
    c('monitor.memory', 'ذاكرة الخادم', 'تجاوز 512 ميغا ينهي العملية فوراً (خطة Render المجانية).', (f) => f.memoryMb >= f.limitMb * 0.85 ? { status: 'fail', detail: `${f.memoryMb} من ${f.limitMb} ميغا`, advice: 'راقب: إن استمر الارتفاع فهناك تسرّب' } : f.memoryMb >= f.limitMb * 0.7 ? { status: 'warn', detail: `${f.memoryMb} من ${f.limitMb} ميغا`, advice: 'قريب من الحد' } : { status: 'ok', detail: `${f.memoryMb} من ${f.limitMb} ميغا` }),
    c('monitor.leak', 'اتجاه الذاكرة (تسرّب؟)', 'نمو ثابت بلا توقف هو تسرّب سيُسقط الخادم بعد ساعات.', (f) => { if (f.memorySlopeMbPerHour == null) return { status: 'skip', detail: 'يجمع عيّنات (يحتاج 20 دقيقة)' }; const left = f.limitMb - f.memoryMb; const hrs = f.memorySlopeMbPerHour > 0 ? left / f.memorySlopeMbPerHour : Infinity; return f.memorySlopeMbPerHour > 5 && hrs < 24 ? { status: 'warn', detail: `+${f.memorySlopeMbPerHour.toFixed(1)} ميغا/ساعة — الحد بعد ~${Math.round(hrs)} س`, advice: 'إن استمر: تسرّب — راجع آخر تغيير نُشر' } : { status: 'ok', detail: `${f.memorySlopeMbPerHour >= 0 ? '+' : ''}${f.memorySlopeMbPerHour.toFixed(1)} ميغا/ساعة — مستقر` }; }),
    c('monitor.lag', 'سرعة الاستجابة', 'تأخّر حلقة الأحداث يعني عملاً متزامناً ثقيلاً يجمّد الطلبات.', (f) => f.loopLagMs >= 400 ? { status: 'fail', detail: `${f.loopLagMs}ms`, advice: 'عمل ثقيل يجمّد الخادم — راجع السجل' } : f.loopLagMaxMs >= 1500 ? { status: 'warn', detail: `ذروة ${f.loopLagMaxMs}ms (الحالي ${f.loopLagMs}ms)`, advice: 'ذروة عابرة؛ راقب تكرارها' } : { status: 'ok', detail: `${f.loopLagMs}ms` }),
    c('monitor.pressure', 'ضغط الخطة المجانية', 'الضغط الحرج يؤجّل الأعمال الثقيلة.', (f) => f.usageLevel === 'critical' ? { status: 'warn', detail: 'حرج — الأعمال الثقيلة مؤجّلة', advice: 'يعود تلقائياً بتجدد الحصة' } : { status: 'ok', detail: f.usageLevel }),
  ],
  storage: [
    c('storage.ready', 'قاعدة البيانات جاهزة', 'بلا قاعدة لا يُحفظ شيء.', (f) => f.storageReady ? { status: 'ok', detail: f.storageBackend } : { status: 'fail', detail: 'غير جاهزة', advice: 'تحقق من Neon وDATABASE_URL' }),
    c('storage.tls', 'تشفير الاتصال بالقاعدة', 'اتصال بلا تحقق من الشهادة قابل للاعتراض.', (f) => f.storageBackend !== 'postgres' ? { status: 'skip', detail: 'تخزين ملف محلي' } : f.tls === 'verified' ? { status: 'ok', detail: 'TLS موثّق' } : { status: 'warn', detail: `TLS: ${f.tls || '—'}`, advice: 'راجع إعداد SSL لـ Neon' }),
    c('storage.persist', 'الحفظ', 'فشل الحفظ يعني ضياع كل تغيير عند إعادة التشغيل.', (f) => f.persistFailStreak ? { status: 'fail', detail: `${f.persistFailStreak} فشل متتالٍ`, advice: 'المهندس يعيد المحاولة', repair: 'persist' } : { status: 'ok', detail: `${f.writesDone} كتابة منفّذة` }),
    c('storage.coalesce', 'كفاءة الكتابة', 'دمج الكتابات يحمي حصة Neon المجانية.', (f) => f.writesRequested < 20 ? { status: 'ok', detail: 'عيّنة قليلة بعد' } : { status: 'ok', detail: `${Math.round((1 - f.writesDone / Math.max(1, f.writesRequested)) * 100)}% موفّرة` }),
  ],
  memory: [
    c('memory.sync', 'مزامنة الأرقام', 'الأرقام القديمة تضلّل قرارات المحتوى.', (f) => { const a = ageMs(f.metricsLastRunAt, f.nowMs); return a == null ? { status: 'warn', detail: 'لم تُنفّذ بعد', advice: 'تُنفَّذ تلقائياً' } : a > f.metricsIntervalMs * 2.5 ? { status: 'fail', detail: `آخرها منذ ${ageText(a)}`, advice: 'المهندس يشغّلها', repair: 'cycles' } : { status: 'ok', detail: `آخرها منذ ${ageText(a)}` }; }),
    c('memory.measured', 'تغطية القياس', 'منشور بلا أرقام لا يُتعلّم منه.', (f) => { const zero = f.measured.filter((m) => m.total > 0 && m.ok === 0); return zero.length ? { status: 'warn', detail: zero.map((m) => `${pa(m.platform)} 0/${m.total}${m.issue && m.issue !== '-' ? ` (${m.issue})` : ''}`).join('، '), advice: 'غالباً إذن إحصاءات ناقص — أعد ربط المنصة بالأذونات الكاملة' } : { status: 'ok', detail: f.measured.map((m) => `${pa(m.platform)} ${m.ok}/${m.total}`).join(' · ') || 'لا منشورات للقياس' }; }),
  ],
  external: [
    c('external.gemini', 'Gemini', 'الذكاء المساعد للمحتوى؛ النظام يعمل بدونه لكن أضعف.', (f) => !f.geminiConfigured ? { status: 'warn', detail: 'غير مضبوط (المسارات الحتمية تعمل)', advice: 'اضبط GEMINI_API_KEY' } : f.geminiVerified === 'failed' ? { status: 'fail', detail: 'المفتاح/الموديل مرفوض', advice: 'تحقق من GEMINI_API_KEY والموديل' } : { status: 'ok', detail: `مضبوط${f.geminiVerified === 'ok' ? ' وموثّق' : ''}` }),
    c('external.geminiQuota', 'حصة Gemini اليوم', 'تجاوز الحارس يوقف الذكاء حتى الغد.', (f) => f.geminiLimit <= 0 ? { status: 'skip', detail: '—' } : f.geminiUsed >= f.geminiLimit * 0.9 ? { status: 'warn', detail: `${f.geminiUsed}/${f.geminiLimit}`, advice: 'تتجدد يومياً' } : { status: 'ok', detail: `${f.geminiUsed}/${f.geminiLimit}` }),
    c('external.youtubeQuota', 'حصة YouTube API', 'نفادها يوقف القراءة والنشر على يوتيوب حتى التجدد.', (f) => f.youtubeQuotaPercent == null ? { status: 'skip', detail: '—' } : f.youtubeQuotaExhausted ? { status: 'fail', detail: 'مستنفدة', advice: 'تتجدد منتصف الليل بتوقيت المحيط الهادئ' } : f.youtubeQuotaPercent >= 80 ? { status: 'warn', detail: `${f.youtubeQuotaPercent}%` } : { status: 'ok', detail: `${f.youtubeQuotaPercent}%` }),
  ],
  products: [
    c('products.count', 'مستودع المنتجات', 'بلا منتجات لا يجد العقل ما يجيب به عن السعر.', (f) => f.products ? { status: 'ok', detail: `${f.products} منتجاً` } : { status: 'fail', detail: 'فارغ', advice: 'أضف المنتجات من قاعدة بيانات المعرض' }),
    c('products.integrity', 'سلامة بيانات المنتجات', 'منتج بلا سعر أو اسم يُنتج رداً خاطئاً للزبون.', (f) => f.productsBadPrice || f.productsNoName ? { status: 'warn', detail: [f.productsBadPrice ? `${f.productsBadPrice} بلا سعر نقدي` : '', f.productsNoName ? `${f.productsNoName} بلا اسم` : ''].filter(Boolean).join('، '), advice: 'أكمل بياناتها — العقل لا يذكر سعراً غير مسجّل' } : { status: 'ok', detail: 'كل المنتجات مكتملة' }),
    c('products.showroom', 'بيانات المعرض', 'الاسم والعنوان والدوام تدخل في كل رد.', (f) => f.showroomName ? { status: 'ok', detail: 'مكتملة' } : { status: 'warn', detail: 'اسم المعرض غير مضبوط', advice: 'أكمل بيانات المعرض' }),
  ],
  customers: [
    c('customers.inbound', 'وصول التعليقات من المنصات', 'منصة متصلة لا يصلها شيء منذ أسبوع قد يكون استقبالها مقطوعاً.', (f) => { const quiet = Object.entries(f.lastInboundAt).filter(([, at]) => { const a = ageMs(at, f.nowMs); return a == null || a > 7 * D; }).map(([p]) => p); return quiet.length ? { status: 'warn', detail: `لا وارد منذ أسبوع: ${quiet.map(pa).join('، ')}`, advice: 'قد يكون طبيعياً (لا تفاعل)؛ وإلا تحقق من webhook/الأذونات' } : { status: 'ok', detail: 'كل المنصات المتصلة يصلها وارد' }; }),
    c('customers.escalations', 'تصعيدات مفتوحة قديمة', 'زبون صُعّد ولم يُرد عليه منذ يومين قد خسرته.', (f) => { const a = ageMs(f.oldestOpenEscalationAt, f.nowMs); return !f.escalationsOpen ? { status: 'ok', detail: 'لا تصعيدات' } : a != null && a > 48 * H ? { status: 'warn', detail: `${f.escalationsOpen} مفتوحة، أقدمها منذ ${ageText(a)}`, advice: 'ردّ يدوياً ثم «حُلّت» من مركز السيطرة' } : { status: 'ok', detail: `${f.escalationsOpen} حديثة` }; }),
  ],
});

/** الثغرات قبل أن تكبر: سعة كل مجموعة ومتى تبلغ سقفها (حيث يُقصّ الأقدم بصمت). */
export function capacityChecks(f: PatrolFacts): CheckResult[] {
  return f.collections.filter((x) => COLLECTION_CAPS[x.key]).map((x) => {
    const cap = COLLECTION_CAPS[x.key]; const pct = Math.round((x.size / cap) * 100);
    const days = x.growthPerDay && x.growthPerDay > 0 ? (cap - x.size) / x.growthPerDay : null;
    const name = COLLECTION_AR[x.key] || x.key;
    const status: CheckStatus = pct >= 95 ? 'fail' : pct >= 80 || (days != null && days < 30) ? 'warn' : 'ok';
    return {
      id: `capacity.${x.key}`, module: 'storage', label: `سعة ${name}`, status,
      detail: `${x.size} من ${cap} (${pct}%)${days != null ? ` — السقف بعد ~${Math.max(0, Math.round(days))} يوم` : ''}`,
      why: 'عند السقف يُقصّ الأقدم بصمت عند كل تحميل — فقدان بيانات بلا إنذار.',
      advice: status === 'ok' ? null : 'قرار مالك: أرشفة الأقدم إلى جدول مستقل (B7) قبل بلوغ السقف — المهندس لا يحذف ولا ينقل بيانات',
    };
  });
}

/** فحص قسم واحد: كل فحوصه + (للتخزين) فحوص السعة. */
export function inspectModule(module: EngineerModule, f: PatrolFacts): ModuleInspection {
  const checks: CheckResult[] = (PATROL_CHECKS[module] || []).map((fn) => {
    try { return { ...fn(f), module }; } catch (e: any) { return { id: `${module}.error`, module, label: 'فحص', status: 'skip' as const, detail: `تعذّر الفحص: ${String(e?.message || e).slice(0, 80)}`, why: '', advice: null }; }
  });
  if (module === 'storage') checks.push(...capacityChecks(f));
  const counts = { ok: 0, warn: 0, fail: 0, skip: 0 };
  for (const x of checks) counts[x.status] += 1;
  const status: CheckStatus = counts.fail ? 'fail' : counts.warn ? 'warn' : counts.ok ? 'ok' : 'skip';
  return { module, at: new Date(f.nowMs).toISOString(), status, counts, checks };
}

/** صحة المشروع الكلية من آخر فحص لكل قسم: سليم=1، تحذير=0.5، عطل=0 (غير المتاح مستبعد). */
export function healthScore(inspections: ModuleInspection[]): number | null {
  let sum = 0, n = 0;
  for (const m of inspections) for (const x of m.checks) { if (x.status === 'skip') continue; n += 1; sum += x.status === 'ok' ? 1 : x.status === 'warn' ? 0.5 : 0; }
  return n ? Math.round((sum / n) * 100) : null;
}

/** ميل خطي (وحدة/ساعة) من عيّنات {t,v} — لكشف التسرّب والنمو. يحتاج 20 دقيقة على الأقل. */
export function slopePerHour(samples: Array<{ t: number; v: number }>): number | null {
  if (samples.length < 5) return null;
  const span = samples[samples.length - 1].t - samples[0].t;
  if (span < 20 * 60000) return null;
  const n = samples.length; const mt = samples.reduce((a, s) => a + s.t, 0) / n; const mv = samples.reduce((a, s) => a + s.v, 0) / n;
  let num = 0, den = 0;
  for (const s of samples) { num += (s.t - mt) * (s.v - mv); den += (s.t - mt) ** 2; }
  return den ? (num / den) * 3600000 : null;
}

/** معدل النمو اليومي من عيّنتين متباعدتين (أول وآخر قياس محفوظ). */
export function growthPerDay(first: { t: number; v: number } | null, last: { t: number; v: number }): number | null {
  if (!first || last.t - first.t < 6 * 3600000) return null;
  return ((last.v - first.v) / (last.t - first.t)) * 86400000;
}
