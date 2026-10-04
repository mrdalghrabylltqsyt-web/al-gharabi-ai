/**
 * YouTube Operations Manager — منطق خالص قابل للاختبار (بلا شبكة وبلا أسرار).
 *
 * الغرض: تحويل العقل المركزي من وكيل ينتظر مهمة يدوية إلى مدير تشغيلي لقناة
 * YouTube يعمل 24/7. كل القرارات هنا **حتمية** (بلا AI): التحكم، بوابة الأتمتة،
 * قرار الرد/التصعيد، دورة حياة التعليق، الإيقاع، الزخم، والتقرير اليومي.
 *
 * المبادئ:
 * - لا اختراع بيانات: كل دالة تعيد فقط ما تُثبته مدخلاتها، وتُعلن حجم العيّنة.
 * - لا رد آلي على الحالات الحساسة/السبام: التصعيد للمالك بدل الرد.
 * - آمن افتراضياً: الأتمتة معطّلة حتى يمكّنها المالك صراحةً.
 * - لا سرّ هنا إطلاقاً.
 */

// -------------------------------------------------------------
// عناصر التحكم (Owner Controls) + Kill Switch
// -------------------------------------------------------------

export interface YouTubeWatcherControls {
  /** المراقبة والتخزين والتحليل (قراءة فقط) — آمنة افتراضياً. */
  enabled: boolean;
  /** الرد الآلي الحقيقي (comments.insert) — معطّل افتراضياً. */
  autoReply: boolean;
  /** النشر الآلي — معطّل افتراضياً. */
  autoPublish: boolean;
  /** الجدولة الآلية — معطّلة افتراضياً. */
  autoSchedule: boolean;
  /** إيقاف كل الأتمتة فوراً (Kill Switch) مع إبقاء القراءة/التحليل. */
  paused: boolean;
  /** فرض مراجعة بشرية: يمنع أي إرسال آلي ويحوّل القابل للرد إلى تصعيد. */
  humanReviewMode: boolean;
  /** فاصل فحص تعليقات YouTube بالدقائق (قيمة المالك: 1..5 فقط). الافتراضي 1. */
  cadenceMinutes: number;
}

export const YOUTUBE_WATCHER_CONTROL_KEYS: ReadonlyArray<keyof YouTubeWatcherControls> = [
  'enabled', 'autoReply', 'autoPublish', 'autoSchedule', 'paused', 'humanReviewMode', 'cadenceMinutes',
];

/** نطاق فاصل الأتمتة المسموح (بالدقائق) — لا polling عدواني ولا تعطيل طويل. */
export const WATCHER_MIN_CADENCE_MINUTES = 1;
export const WATCHER_MAX_CADENCE_MINUTES = 5;
export const WATCHER_DEFAULT_CADENCE_MINUTES = 1;

/**
 * يتحقق من قيمة فاصل (دقائق) قادمة من المستخدم/البيئة. يقبل عدداً صحيحاً
 * فقط ضمن [1..5]، ويرفض صراحةً: NaN، العشري، 0 والسالب، والأكبر من 5،
 * والنصوص غير الرقمية. لا يُقرَّب ولا يُقصّ صامتاً — الرفض معلن.
 */
export function validateCadenceMinutes(input: unknown): { ok: boolean; minutes: number; reason: string } {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, minutes: WATCHER_DEFAULT_CADENCE_MINUTES, reason: 'قيمة غير رقمية (NaN/لانهاية).' };
    if (!Number.isInteger(input)) return { ok: false, minutes: WATCHER_DEFAULT_CADENCE_MINUTES, reason: 'لا يُقبل العشري؛ اختر دقيقة كاملة.' };
    if (input < WATCHER_MIN_CADENCE_MINUTES) return { ok: false, minutes: WATCHER_DEFAULT_CADENCE_MINUTES, reason: `أصغر فاصل مسموح ${WATCHER_MIN_CADENCE_MINUTES} دقيقة.` };
    if (input > WATCHER_MAX_CADENCE_MINUTES) return { ok: false, minutes: WATCHER_DEFAULT_CADENCE_MINUTES, reason: `أكبر فاصل مسموح ${WATCHER_MAX_CADENCE_MINUTES} دقائق.` };
    return { ok: true, minutes: input, reason: 'قيمة صحيحة.' };
  }
  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) return { ok: false, minutes: WATCHER_DEFAULT_CADENCE_MINUTES, reason: 'قيمة فارغة.' };
    if (!/^-?\d+$/.test(s)) return { ok: false, minutes: WATCHER_DEFAULT_CADENCE_MINUTES, reason: 'النص ليس عدداً صحيحاً.' };
    return validateCadenceMinutes(Number(s));
  }
  return { ok: false, minutes: WATCHER_DEFAULT_CADENCE_MINUTES, reason: 'نوع قيمة غير مدعوم.' };
}

/** يحوّل الدقائق إلى ميلي ثانية بعد التحقق فقط (لا قبل). */
export function cadenceMinutesToMs(minutes: number): number {
  const v = validateCadenceMinutes(minutes);
  return v.minutes * 60 * 1000;
}

/** يشتقّ الدقائق الصحيحة من ميلي ثانية (لقراءة الحالة المحفوظة قديماً). */
export function cadenceMsToMinutes(ms: unknown): number {
  const n = typeof ms === 'string' ? Number(ms) : ms;
  if (!Number.isFinite(n)) return WATCHER_DEFAULT_CADENCE_MINUTES;
  const minutes = Math.round(Number(n) / 60000);
  const v = validateCadenceMinutes(minutes);
  return v.ok ? v.minutes : WATCHER_DEFAULT_CADENCE_MINUTES;
}

/**
 * الافتراضي آمن: المراقبة مفعّلة (قراءة/تحليل فقط) وكل الإرسال معطّل حتى
 * يمكّنه المالك. هذا يمنع أي رد أو نشر غير مقصود.
 */
export function defaultWatcherControls(): YouTubeWatcherControls {
  return { enabled: true, autoReply: false, autoPublish: false, autoSchedule: false, paused: false, humanReviewMode: false, cadenceMinutes: WATCHER_DEFAULT_CADENCE_MINUTES };
}

/** تطبيع آمن لحالة محفوظة (تصمد بعد restart) — بلا أي قيمة غير منطقية. */
export function normalizeWatcherControls(raw: any): YouTubeWatcherControls {
  const d = defaultWatcherControls();
  if (!raw || typeof raw !== 'object') return d;
  // الفاصل: يسبق التحقق قيمة قديمة محفوظة كـ cadenceMs (توافق خلفي) قبل الافتراضي.
  const cadenceSource = raw.cadenceMinutes ?? (raw.cadenceMs != null ? cadenceMsToMinutes(raw.cadenceMs) : d.cadenceMinutes);
  const cadence = validateCadenceMinutes(cadenceSource);
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : d.enabled,
    autoReply: typeof raw.autoReply === 'boolean' ? raw.autoReply : d.autoReply,
    autoPublish: typeof raw.autoPublish === 'boolean' ? raw.autoPublish : d.autoPublish,
    autoSchedule: typeof raw.autoSchedule === 'boolean' ? raw.autoSchedule : d.autoSchedule,
    paused: typeof raw.paused === 'boolean' ? raw.paused : d.paused,
    humanReviewMode: typeof raw.humanReviewMode === 'boolean' ? raw.humanReviewMode : d.humanReviewMode,
    cadenceMinutes: cadence.ok ? cadence.minutes : d.cadenceMinutes,
  };
}

export type WatcherAction = 'read' | 'reply' | 'publish' | 'schedule';

export interface WatcherGateDecision {
  allowed: boolean;
  reason: string;
  code: string;
}

/**
 * بوابة الأتمتة الموحّدة. لا يجوز لأي عملية أن تتجاوزها:
 * - القراءة/التحليل مسموحة ما لم يكن paused.
 * - الإرسال (رد/نشر/جدولة) يحتاج enabled + non-paused + الإذن الخاص.
 *
 * ملاحظة مهمة: `humanReviewMode` لا يُعطّل كل الأتمتة. الحالات الآمنة والواضحة
 * تُنفَّذ آلياً؛ أما غير الواضحة/الحساسة فتُوجَّه إلى المراجعة عبر قرار التصنيف
 * (`decideCommentAction`) لا عبر بوابة عامة. لذا لا تُحجب كل الردود هنا.
 */
export function watcherGate(controls: YouTubeWatcherControls, action: WatcherAction): WatcherGateDecision {
  const c = normalizeWatcherControls(controls);
  if (!c.enabled) return { allowed: false, code: 'WATCHER_DISABLED', reason: 'مراقبة YouTube معطّلة من المالك.' };
  if (c.paused) return { allowed: false, code: 'AUTOMATION_PAUSED', reason: 'الأتمتة موقوفة مؤقتاً (Kill Switch)؛ القراءة والتحليل فقط.' };
  if (action === 'read') return { allowed: true, code: 'ALLOWED', reason: 'قراءة/تحليل مسموحان.' };
  if (action === 'reply' && !c.autoReply) return { allowed: false, code: 'AUTO_REPLY_DISABLED', reason: 'الرد الآلي معطّل من المالك.' };
  if (action === 'publish' && !c.autoPublish) return { allowed: false, code: 'AUTO_PUBLISH_DISABLED', reason: 'النشر الآلي معطّل من المالك.' };
  if (action === 'schedule' && !c.autoSchedule) return { allowed: false, code: 'AUTO_SCHEDULE_DISABLED', reason: 'الجدولة الآلية معطّلة من المالك.' };
  return { allowed: true, code: 'ALLOWED', reason: 'مسموح بموجب تفويض المالك وإعدادات الأتمتة.' };
}

/**
 * هل هذا النوع من التعليقات آمن وواضح بما يكفي للتنفيذ الآلي حتى في وضع
 * المراجعة البشرية؟ المدح/التفاعل الإيجابي/الشكر لا يحمل ادعاءً ولا يخترع
 * بيانات، فيُسمح بالرد الآلي عليه. الأسئلة/الاستفسارات التجارية/الشكاوى
 * والمجهول غير الواضح تذهب إلى المراجعة.
 */
export function isSafeForAutoReply(intent: string): boolean {
  return intent === 'praise';
}

/** ملخص للعرض في الصحة/الواجهة (بلا أي سرّ). */
export function watcherControlsView(controls: YouTubeWatcherControls) {
  const c = normalizeWatcherControls(controls);
  const cadencePaused = c.enabled && c.paused;
  return {
    ...c,
    /** الفاصل الفعلي المطبَّق على الجدولة (ميلي ثانية). عند Kill Switch لا فحص. */
    cadenceMs: cadencePaused ? 0 : cadenceMinutesToMs(c.cadenceMinutes),
    cadenceEffectiveMinutes: c.cadenceMinutes,
    killSwitchActive: c.paused,
    autoReplyEffective: c.enabled && !c.paused && !c.humanReviewMode && c.autoReply,
    note: 'الأتمتة آمنة افتراضياً: المراقبة قراءة/تحليل فقط حتى يمكّن المالك الرد الآلي صراحةً.',
  };
}

// -------------------------------------------------------------
// دورة حياة التعليق (Comment lifecycle) + قرار الرد/التصعيد
// -------------------------------------------------------------

export const YOUTUBE_COMMENT_STAGES = [
  'NEW', 'FETCHED', 'ANALYZED', 'REPLY_DECISION', 'REPLIED', 'VERIFIED', 'SKIPPED', 'ESCALATED', 'FAILED',
] as const;
export type YouTubeCommentStage = (typeof YOUTUBE_COMMENT_STAGES)[number];

export const YOUTUBE_COMMENT_STAGE_LABELS_AR: Record<YouTubeCommentStage, string> = {
  NEW: 'جديد',
  FETCHED: 'مُجلَب',
  ANALYZED: 'مُحلَّل',
  REPLY_DECISION: 'قرار الرد',
  REPLIED: 'تم الرد',
  VERIFIED: 'تم التحقق',
  SKIPPED: 'مُتجاهَل',
  ESCALATED: 'مُصعَّد للمالك',
  FAILED: 'فشل',
};

export type WatcherReplyAction = 'reply' | 'skip' | 'escalate';

/** قرار مركزي نهائي (من العقل المركزي `composeBrainDecision`) — مرجع التصميم. */
export type CentralActionDecision = 'NO_ACTION' | 'ALLOWED_ACTION' | 'APPROVAL_REQUIRED' | 'HUMAN_ESCALATION' | 'FAILED_SAFE';

/**
 * كود حتمي لكل قرار — يجعل القرار قابلاً للتصنيف الآلي (تشخيص/إحصاء/إعادة تقييم)
 * بلا الاعتماد على نص السبب. مهم: يميّز «تعذّر بسبب إعداد المالك» (غير نهائي،
 * قابل لإعادة التقييم لاحقاً) عن القرارات النهائية (رد/تصعيد مضمون/تجاهل).
 *
 * **ملاحظة معمارية (Batch 8.1):** هذه الأكواد صارت تُشتقّ الآن من **قرار العقل
 * المركزي** عبر `resolveCommentExecution` (لا من قرار مستقل). يبقى
 * `decideCommentAction` مصنّفاً استشارياً فقط (لا يفوّض تنفيذاً).
 */
export type CommentDecisionCode =
  | 'SKIP_SELF_AUTHORED'
  | 'SKIP_ALREADY_REPLIED'
  | 'SKIP_SPAM'
  | 'SKIP_OUT_OF_CHANNEL_CONTEXT'
  | 'ESCALATE_BUSINESS_INQUIRY'
  | 'ESCALATE_SENSITIVE'
  | 'ESCALATE_HUMAN_REVIEW_MODE'
  | 'ESCALATE_REPLY_NOT_READY'
  | 'ESCALATE_LEGACY_UNCLASSIFIED'
  | 'SKIP_LEGACY_UNCLASSIFIED'
  | 'DEFER_AUTOREPLY_DISABLED'
  | 'REPLY_ALLOWED';

/**
 * ربط صريح بين كل كود قرار والمراحل الطرفية المسموح بها. يمنع أي «معالجة بلا
 * قرار»: أي سجل محفوظ يجب أن تكون مرحلته الطرفية مطابقة لكوده (رد/تجاهل/تصعيد/فشل).
 * يمنع أيضاً تناقضاً كان قائماً: سجل ESCALATED كان يحمل كود REPLY_ALLOWED.
 */
export const YOUTUBE_DECISION_CODE_STAGES: Record<CommentDecisionCode, ReadonlyArray<YouTubeCommentStage>> = {
  SKIP_SELF_AUTHORED: ['SKIPPED'],
  SKIP_ALREADY_REPLIED: ['SKIPPED'],
  SKIP_SPAM: ['SKIPPED'],
  SKIP_OUT_OF_CHANNEL_CONTEXT: ['SKIPPED'],
  ESCALATE_BUSINESS_INQUIRY: ['ESCALATED'],
  ESCALATE_SENSITIVE: ['ESCALATED'],
  ESCALATE_HUMAN_REVIEW_MODE: ['ESCALATED'],
  ESCALATE_REPLY_NOT_READY: ['ESCALATED'],
  ESCALATE_LEGACY_UNCLASSIFIED: ['ESCALATED'],
  SKIP_LEGACY_UNCLASSIFIED: ['SKIPPED'],
  DEFER_AUTOREPLY_DISABLED: ['SKIPPED'],
  // رد ناجح (REPLIED/VERIFIED) أو فشل إرسال (FAILED) — كلها انطلاقاً من قرار «رد».
  REPLY_ALLOWED: ['REPLIED', 'VERIFIED', 'FAILED'],
};

/** هل (المرحلة، الكود) قرار طرفي صريح ومتّسق؟ أي تعليق مُعالج يجب أن يحقّقه. */
export function isExplicitTerminalDecision(stage: YouTubeCommentStage, code: string | null | undefined): boolean {
  if (!code) return false;
  const allowed = YOUTUBE_DECISION_CODE_STAGES[code as CommentDecisionCode];
  if (!allowed) return false;
  return allowed.includes(stage);
}

/**
 * ترميم **غير حذفي** لسجلات قديمة معالجة بلا كود (أو بكود متناقض مع المرحلة) —
 * يُضيف/يصحّح الكود فقط ولا يحذف أي سجل ولا يغيّر مرحلته أو سببه. الغرض: ألا يبقى
 * أي «معالجة بلا قرار» في التاريخ الحقيقي، مع الحفاظ الكامل على السجلات.
 */
export function repairProcessedDecisionCodes(entries: WatcherProcessedEntry[]): { entries: WatcherProcessedEntry[]; repaired: number } {
  let repaired = 0;
  const out = (entries || []).map((p) => {
    if (!p || p.stage === 'NEW') return p;
    if (isExplicitTerminalDecision(p.stage, p.code || null)) return p;
    // كود بديل مشتق من المرحلة فقط — الاسم يحمل "legacy" صراحةً ليعرف المشغّل مصدره.
    let code: CommentDecisionCode;
    if (p.stage === 'SKIPPED') code = p.deferred ? 'DEFER_AUTOREPLY_DISABLED' : 'SKIP_LEGACY_UNCLASSIFIED';
    else if (p.stage === 'ESCALATED') code = 'ESCALATE_LEGACY_UNCLASSIFIED';
    else code = 'REPLY_ALLOWED';
    repaired += 1;
    return { ...p, code };
  });
  return { entries: out, repaired };
}



export interface CommentDecision {
  action: WatcherReplyAction;
  reason: string;
  requiresHuman: boolean;
  code: CommentDecisionCode;
}

/**
 * تصنيف حتمي استشاري لكل تعليق حقيقي (Batch 8.1: **ليس سلطة تنفيذ**).
 *
 * كان هذا القرار مستقلاً ويقود التنفيذ فعلاً (عطل معماري: سلطتا قرار). الآن هو
 * **مصنّف/فحص سلامة استشاري** فقط: يصف كيف يجب أن يُفسَّر التعليق (رد/تصعيد/تجاهل)
 * لبناء قرار العقل المركزي. **لا يفوّض تنفيذاً** — التفويض الوحيد عبر
 * `resolveCommentExecution` الذي يستهلك قرار العقل المركزي (`composeBrainDecision`).
 *
 * القواعد (نفسها محفوظة، لكن كمخرَج استشاري لا حاكم):
 * - تعليق من حساب المعرض أو سبام أو مُعالَج سابقاً ⇒ تجاهل.
 * - شكوى/حساس/استفسار تجاري/طلب سعر/تقسيط ⇒ توصية بتصعيد للمالك بلا رد.
 * - سؤال عام أو مدح أو تفاعل بسيط وقد مرّت الحمايات ⇒ توصية برد.
 * - تعطيل الرد الآلي (إعداد المالك) ⇒ توصية بتأجيل غير نهائي (DEFER).
 */
export function decideCommentAction(input: {
  intent: string;
  requiresHumanReview: boolean;
  isSpam: boolean;
  isSelfAuthored: boolean;
  alreadyReplied: boolean;
  controls: YouTubeWatcherControls;
}): CommentDecision {
  const c = normalizeWatcherControls(input.controls);
  if (input.isSelfAuthored) return { action: 'skip', code: 'SKIP_SELF_AUTHORED', reason: 'التعليق صادر من حساب المعرض؛ لا حلقة ردود.', requiresHuman: false };
  if (input.alreadyReplied) return { action: 'skip', code: 'SKIP_ALREADY_REPLIED', reason: 'سبق الرد على هذا التعليق (منع التكرار).', requiresHuman: false };
  if (input.isSpam) return { action: 'skip', code: 'SKIP_SPAM', reason: 'تعليق مصنّف سبام؛ لا رد آلي.', requiresHuman: false };
  // التصعيد بسبب حقيقي مرتبط بمضمون التعليق (لا بسبب حالة إعداد فقط):
  if (input.intent === 'business_inquiry') {
    return { action: 'escalate', code: 'ESCALATE_BUSINESS_INQUIRY', reason: 'استفسار عن السعر/التقسيط — يحتاج بيانات المنتج المؤكدة قبل الرد، ولا تُخترع أسعار.', requiresHuman: true };
  }
  if (input.intent === 'complaint' || input.requiresHumanReview) {
    return { action: 'escalate', code: 'ESCALATE_SENSITIVE', reason: 'شكوى/حالة حساسة تستوجب متابعة المالك مباشرة قبل أي رد.', requiresHuman: true };
  }
  // وضع المراجعة البشرية: الحالات الآمنة والواضحة (مدح/تفاعل إيجابي) تُنفَّذ
  // آلياً، وغير الواضحة (سؤال/مجهول) تُوجَّه للمراجعة. لا إيقاف شامل للأتمتة.
  if (c.humanReviewMode && !isSafeForAutoReply(input.intent)) {
    return { action: 'escalate', code: 'ESCALATE_HUMAN_REVIEW_MODE', reason: 'وضع المراجعة البشرية مفعّل: الحالات غير الواضحة تُحوَّل للمراجعة، والحالات الواضحة تُرد آلياً.', requiresHuman: true };
  }
  if (!c.enabled || c.paused || !c.autoReply) {
    // تعذّر بسبب إعداد المالك: قرار غير نهائي — لا يُوسَم مُعالَجاً لئلا يُفقد عند
    // تمكين الرد لاحقاً. لا تصعيد (ليس حالة حساسة) ولا رد (الأتمتة معطّلة).
    return { action: 'skip', code: 'DEFER_AUTOREPLY_DISABLED', reason: 'الرد الآلي غير ممكّن حالياً (إعداد المالك)؛ أُجّل التعليق بلا إرسال وسيُعاد تقييمه عند التمكين.', requiresHuman: false };
  }
  return { action: 'reply', code: 'REPLY_ALLOWED', reason: 'تعليق قابل للرد الآلي من بيانات موثوقة (سؤال عام/مدح/تفاعل بسيط).', requiresHuman: false };
}

/** هل القرار غير نهائي (تعذّر بسبب إعداد المالك) ويجب إعادة تقييمه لاحقاً؟ */
export function isDeferredDecision(code: CommentDecisionCode): boolean {
  return code === 'DEFER_AUTOREPLY_DISABLED';
}

/**
 * سلطة التنفيذ الوحيدة (Batch 8.1). تستهلك **قرار العقل المركزي**
 * (`centralDecision` من `composeBrainDecision`) وتُنتج إجراءً تنفيذياً على YouTube:
 * reply/skip/escalate. **لا تنشئ قراراً مستقلاً** — تطابق قرار العقل مع:
 * - التصنيف الاستشاري (`decideCommentAction` — فحص سلامة، يمنع مثلاً الرد على سبام
 *   أو حساب المعرض، ويصعّد الحساس).
 * - سياق القناة (هل التعليق يخص قناة موثّقة؟).
 * - بوابة الأتمتة (Watcher Gate + Kill Switch + خفض autoReply).
 * - السبب الحقيقي (درجة الحساسية من التصنيف، `centralEscalationReason`).
 *
 * **لا تنفيذ خارجي هنا**: تُنتج القرار فقط؛ التنفيذ عبر `executeYouTubeReply`
 * (بكل بواباته). قاعدة الأمان: لا `reply` إن لم يكن قرار العقل `ALLOWED_ACTION`.
 * تدرّج الأسبقية: تجاهل → تصعيد → رد → تأجيل (لا فقدان) → تجاهل آمن افتراضي.
 */
export function resolveCommentExecution(input: {
  /** قرار العقل المركزي النهائي (سلطة القرار الواحدة). */
  centralDecision: CentralActionDecision;
  /** تصنيف استشاري حتمي (فحص سلامة التعليق — لا قرار). */
  advisory: CommentDecision;
  /** هل بوابة الأتمتة تسمح بالإرسال الآن (Watcher Gate: autoReply/paused)؟ */
  automationAllowed: boolean;
  /** هل يمكن تنفيذ الرد فعلاً الآن (اتصال موثق + force-ssl + تفويض)؟ */
  replyReady: boolean;
  /** هل التعليق يخص سياق القناة الموثّقة؟ */
  belongsToChannel: boolean;
  /** هل التعليق مدح/تفاعل إيجابي آمن؟ (خفض الإيقاع عند humanReviewMode). */
  isPraise: boolean;
  /** وضع المراجعة البشرية (يحوّل غير الواضح إلى تصعيد). */
  humanReviewMode: boolean;
  /** السبب الحقيقي للتصعيد من التصنيف (`price_unverified`/`complaint`/`sensitive`). */
  centralEscalationReason: string | null;
}): CommentDecision {
  // 1) تجاهل بموجب سلامة التعليق (نفس/حساب المعرض/سبام/مُعالَج سابقاً).
  if (input.advisory.code === 'SKIP_SELF_AUTHORED'
    || input.advisory.code === 'SKIP_ALREADY_REPLIED'
    || input.advisory.code === 'SKIP_SPAM') {
    return input.advisory;
  }

  // 2) حساسية/تصعيد: السبب الحقيقي (سعر/شكوى/حساس) أو خلاف جوهري (من العقل).
  //    قرار العقل HUMAN_ESCALATION/FAILED_SAFE ⇒ لا رد آلي إطلاقاً.
  const reasonSensitive = input.centralEscalationReason === 'price_unverified'
    || input.centralEscalationReason === 'complaint'
    || input.centralEscalationReason === 'sensitive';
  if (input.centralDecision === 'HUMAN_ESCALATION' || input.centralDecision === 'FAILED_SAFE' || reasonSensitive) {
    const code: CommentDecisionCode = input.centralEscalationReason === 'complaint'
      ? 'ESCALATE_SENSITIVE'
      : reasonSensitive ? 'ESCALATE_BUSINESS_INQUIRY' : 'ESCALATE_HUMAN_REVIEW_MODE';
    return { action: 'escalate', code, reason: 'قرار العقل المركزي يوجب تصعيداً بشرياً (حساس/شكوى/سعر غير موثّق/خلاف جوهري) — لا رد آلي.', requiresHuman: true };
  }

  // 3) وضع المراجعة البشرية: يحوّل غير الواضح إلى تصعيد (الحالات الواضحة تُتابع).
  if (input.humanReviewMode && !input.isPraise) {
    return { action: 'escalate', code: 'ESCALATE_HUMAN_REVIEW_MODE', reason: 'وضع المراجعة البشرية مفعّل: الحالات غير الواضحة تُحوَّل للمراجعة، والحالات الواضحة تُتابع.', requiresHuman: true };
  }

  // 4) الرد: **فقط** إن قرّر العقل المركزي ALLOWED_ACTION.
  if (input.centralDecision === 'ALLOWED_ACTION') {
    if (!input.belongsToChannel) {
      return { action: 'skip', code: 'SKIP_OUT_OF_CHANNEL_CONTEXT', reason: 'التعليق لا يخص سياق القناة الموثّقة.', requiresHuman: false };
    }
    if (!input.automationAllowed) {
      return { action: 'skip', code: 'DEFER_AUTOREPLY_DISABLED', reason: 'قرار العقل يسمح بالرد لكن الأتمتة معطّلة (إعداد المالك)؛ أُجّل التعليق بلا إرسال وسيُعاد تقييمه عند التمكين.', requiresHuman: false };
    }
    if (!input.replyReady) {
      return { action: 'escalate', code: 'ESCALATE_REPLY_NOT_READY', reason: 'قرار العقل يسمح بالرد لكن بوابة التنفيذ غير مكتملة (اتصال/نطاق/تفويض).', requiresHuman: true };
    }
    return { action: 'reply', code: 'REPLY_ALLOWED', reason: 'قرار العقل المركزي ALLOWED_ACTION وبوابات التنفيذ مكتملة.', requiresHuman: false };
  }

  // 5) غير مسموح: NO_ACTION (لا إجراء مطلوب) أو تعذّر بسبب إعداد المالك
  //    ⇒ تأجيل غير نهائي (لا فقدان)، وإلا فتصعيد آمن بلا اختراع (لا رد).
  if (input.centralDecision === 'NO_ACTION' || !input.automationAllowed) {
    return { action: 'skip', code: 'DEFER_AUTOREPLY_DISABLED', reason: 'لا إجراء فوري مطلوب أو الأتمتة معطّلة (إعداد المالك)؛ أُجّل التعليق بلا إرسال وسيُعاد تقييمه عند الحاجة.', requiresHuman: false };
  }
  return { action: 'escalate', code: 'ESCALATE_REPLY_NOT_READY', reason: 'قرار العقل لا يسمح بالرد الآن (موافقة/تفويض ناقص أو لا إجراء).', requiresHuman: true };
}

// -------------------------------------------------------------
// الإيقاع (cadence) + حالة الـcheckpoint
// -------------------------------------------------------------

/** الإيقاع الافتراضي: فحص كل دقيقة (60,000ms) لمراقبة 24/7. */
export const WATCHER_DEFAULT_CADENCE_MS = 60 * 1000;
export const WATCHER_MIN_CADENCE_MS = 60 * 1000;
export const WATCHER_MAX_CADENCE_MS = 60 * 60 * 1000;

/** إيقاع قابل للضبط من البيئة مع حدود آمنة (لا polling عدواني). */
export function normalizeCadenceMs(input?: string | number | null): number {
  const raw = typeof input === 'string' ? Number(input) : input;
  const n = Number.isFinite(raw) ? Number(raw) : WATCHER_DEFAULT_CADENCE_MS;
  if (n < WATCHER_MIN_CADENCE_MS) return WATCHER_MIN_CADENCE_MS;
  if (n > WATCHER_MAX_CADENCE_MS) return WATCHER_MAX_CADENCE_MS;
  return Math.floor(n);
}

/** هل حان وقت الفحص التالي؟ */
export function isPollDue(lastPollAt: string | null | undefined, now: number, cadenceMs: number): boolean {
  if (!lastPollAt) return true;
  const t = Date.parse(lastPollAt);
  if (!Number.isFinite(t)) return true;
  return now - t >= cadenceMs;
}

export function nextPollAt(lastPollAt: string | null | undefined, cadenceMs: number): string | null {
  if (!lastPollAt) return null;
  const t = Date.parse(lastPollAt);
  if (!Number.isFinite(t)) return null;
  return new Date(t + cadenceMs).toISOString();
}

/** سجل معالجة التعليقات: يمنع المعالجة المزدوجة ويصمد بعد restart. */
export interface WatcherProcessedEntry {
  commentId: string;
  stage: YouTubeCommentStage;
  action: string;
  reason: string;
  videoId: string | null;
  authorName: string | null;
  text: string;
  /** زمن معالجة النظام (checkpoint/dedupe). */
  at: string;
  /** زمن نشر التعليق الحقيقي لدى YouTube — مصدر الزخم/الذروة (لا اختلاق). */
  publishedAt?: string | null;
  externalReplyId?: string | null;
  replyText?: string | null;
  /**
   * بصمة تفاعل المتابعة على الرد (إعجاب/ردود) عند أول رصد بعد التسليم — تُستخدم
   * لكشف تغيّر التفاعل الحقيقي لاحقاً (لا تُخترع قيمة).
   */
  followUpBaseline?: { likes: number; replies: number } | null;
  /** نتيجة تفاعل المتابعة الملاحَظة (تغيّر حقيقي فقط) — بلا ادعاء بيع. */
  followUpOutcome?: {
    kind: 'engagement_changed' | 'no_change';
    likesDelta: number;
    repliesDelta: number;
    at: string;
  } | null;
  /** كود القرار الحتمي (لتصنيف آلي بلا نص). */
  code?: string | null;
  /**
   * مؤجَّل بسبب إعداد المالك (الرد الآلي معطّل/موقوف): ليس قراراً نهائياً،
   * ويُعاد تقييمه تلقائياً عند تمكين الرد — بلا فقدان التعليق.
   */
  deferred?: boolean;
}

export function hasProcessed(processed: WatcherProcessedEntry[], commentId: string): boolean {
  return processed.some((p) => p.commentId === commentId && p.stage !== 'NEW');
}

/**
 * يحرّر التعليقات المؤجَّلة (تعذّر بسبب إعداد المالك) لإعادة تقييمها مرة واحدة عند
 * تمكين الرد الآلي. لا يمسّ أي قرار نهائي (رد/تصعيد/تجاهل حقيقي). يغطّي أيضاً
 * السجلات القديمة التي وُسمت «الرد الآلي غير ممكّن» قبل إدخال حقل deferred.
 */
export function releaseDeferredEntries(processed: WatcherProcessedEntry[]): { processed: WatcherProcessedEntry[]; released: number } {
  const isDeferred = (p: WatcherProcessedEntry) => Boolean(p?.deferred)
    || p?.code === 'DEFER_AUTOREPLY_DISABLED'
    || (typeof p?.reason === 'string' && p.reason.includes('الرد الآلي غير ممكّن'));
  const kept = (processed || []).filter((p) => !isDeferred(p));
  return { processed: kept, released: (processed || []).length - kept.length };
}

/** آخر checkpoint: معرّف آخر تعليق عُولج ووقته (للاستئناف بعد الانقطاع). */
export function advanceCheckpoint(prev: { lastCommentId: string | null; lastCommentAt: string | null }, commentId: string | null, at: string | null) {
  return {
    lastCommentId: commentId || prev.lastCommentId || null,
    lastCommentAt: at || prev.lastCommentAt || null,
  };
}

// -------------------------------------------------------------
// الزخم (velocity) — من الطوابع الزمنية الحقيقية فقط، مع إعلان حجم العيّنة
// -------------------------------------------------------------

export interface VelocityWindow {
  count: number;
  perHour: number;
}
export interface CommentVelocity {
  lastHour: VelocityWindow;
  last6h: VelocityWindow;
  last24h: VelocityWindow;
  last7d: VelocityWindow;
  trend: 'rising' | 'steady' | 'falling' | 'insufficient';
  sampleSize: number;
  note: string;
}

/**
 * يحسب سرعة التعليقات من طوابعها الزمنية الفعلية. لا يُخترع أي رقم: النوافذ
 * تُحسب بالعدّ الفعلي، والاتجاه لا يُعلن إلا إذا كانت العيّنة كافية (≥4 تعليقات
 * في آخر 24 ساعة و≥1 في نافذة سابقة للمقارنة).
 */
export function computeCommentVelocity(timestamps: Array<string | null | undefined>, now: number): CommentVelocity {
  const valid = timestamps.map((t) => (t ? Date.parse(t) : NaN)).filter((n) => Number.isFinite(n));
  const within = (ms: number) => valid.filter((t) => now - t >= 0 && now - t <= ms).length;
  const perHour = (count: number, ms: number) => (count <= 0 ? 0 : Number((count / (ms / 3_600_000)).toFixed(3)));
  const hour = within(3_600_000);
  const six = within(6 * 3_600_000);
  const day = within(24 * 3_600_000);
  const week = within(7 * 24 * 3_600_000);
  const prevDay = valid.filter((t) => now - t > 24 * 3_600_000 && now - t <= 48 * 3_600_000).length;
  let trend: CommentVelocity['trend'] = 'insufficient';
  if (day >= 4) {
    if (day > prevDay) trend = 'rising';
    else if (day < prevDay) trend = 'falling';
    else trend = 'steady';
  }
  return {
    lastHour: { count: hour, perHour: perHour(hour, 3_600_000) },
    last6h: { count: six, perHour: perHour(six, 6 * 3_600_000) },
    last24h: { count: day, perHour: perHour(day, 24 * 3_600_000) },
    last7d: { count: week, perHour: perHour(week, 7 * 24 * 3_600_000) },
    trend,
    sampleSize: valid.length,
    note: trend === 'insufficient' ? 'العيّنة غير كافية لإعلان اتجاه (يلزم ≥4 تعليقات في 24 ساعة).' : 'الاتجاه محسوب من طوابع زمنية حقيقية.',
  };
}

// -------------------------------------------------------------
// التقرير اليومي (Daily Brief) — من البيانات الحقيقية فقط
// -------------------------------------------------------------

export interface DailyBriefInput {
  date: string;
  newComments: number;
  replies: number;
  skipped: number;
  escalated: number;
  verifiedReplies: number;
  failedReplies: number;
  sentiment: { positive: number; negative: number; neutral: number };
  topQuestions: Array<{ text: string; count: number }>;
  velocity: CommentVelocity;
  /** أوقات الذروة من زمن النشر الحقيقي (اختياري؛ لا يُعلن بلا عيّنة). */
  peakHours?: ReturnType<typeof computePeakHours>;
  videos: { total: number; bestPerforming: Array<{ videoId: string; title?: string | null; metric?: number }>; weakPerforming: Array<{ videoId: string; title?: string | null; metric?: number }> };
  attentionRequired: Array<{ commentId: string; reason: string; text: string }>;
  sampleNotes: string[];
}

export interface DailyBrief {
  date: string;
  generatedAt: string;
  source: 'deterministic';
  newComments: number;
  replies: number;
  skipped: number;
  escalated: number;
  verifiedReplies: number;
  failedReplies: number;
  sentiment: { positive: number; negative: number; neutral: number };
  topQuestions: Array<{ text: string; count: number }>;
  velocity: CommentVelocity;
  videos: DailyBriefInput['videos'];
  attentionRequired: DailyBriefInput['attentionRequired'];
  recommendations: string[];
  sampleNotes: string[];
  peakHours?: ReturnType<typeof computePeakHours>;
  note: string;
}

/**
 * يبني ملخصاً يومياً حتمياً (بلا AI) من الأرقام الحقيقية. لا يُخترع رقم؛ إن كان
 * المدخل صفراً يبقى صفراً، وإذا كانت العيّنة ضعيفة تُعلن القيود في sampleNotes.
 */
export function buildDailyBrief(input: DailyBriefInput): DailyBrief {
  const recommendations: string[] = [];
  const attention = input.attentionRequired.length;
  if (attention > 0) recommendations.push(`راجع ${attention} تعليقاً يحتاج تدخلاً (شكاوى/استفسارات تجارية/حساسة).`);
  if (input.velocity.trend === 'rising') recommendations.push('التفاعل في ارتفاع: خصّص وقتاً للردود لتعزيز الزخم.');
  else if (input.velocity.trend === 'falling') recommendations.push('التفاعل في انخفاض: راجع أداء المنشورات الأخيرة وأوقات النشر.');
  if (input.failedReplies > 0) recommendations.push(`هناك ${input.failedReplies} ردّ فشل إرساله — راجع الاتصال/التفويض.`);
  if (input.videos.weakPerforming.length) recommendations.push('توجد فيديوهات بأداء ضعيف: فكّر بإعادة استخدام الأفكار أو تحسين العنوان.');
  if (!recommendations.length) recommendations.push('لا توجد إجراءات عاجلة اليوم؛ استمرار المراقبة كافٍ.');

  return {
    date: input.date,
    generatedAt: new Date().toISOString(),
    source: 'deterministic',
    newComments: input.newComments,
    replies: input.replies,
    skipped: input.skipped,
    escalated: input.escalated,
    verifiedReplies: input.verifiedReplies,
    failedReplies: input.failedReplies,
    sentiment: input.sentiment,
    topQuestions: input.topQuestions.slice(0, 10),
    velocity: input.velocity,
    videos: input.videos,
    attentionRequired: input.attentionRequired.slice(0, 50),
    recommendations,
    sampleNotes: input.sampleNotes,
    peakHours: input.peakHours,
    note: 'ملخص حتمي من بيانات YouTube الحقيقية وسجلات النظام — لا بيانات مُختلقة.',
  };
}

/** يسجّل فرصة (Opportunity) عند تكرار سؤال/موضوع أو قفزة تفاعل — بلا تنفيذ. */
export interface WatcherOpportunity {
  id: string;
  kind: 'repeated_question' | 'top_topic' | 'engagement_spike' | 'attention_needed';
  detail: string;
  count: number;
  at: string;
}

/**
 * أوقات الذروة: توزيع التعليقات الحقيقية على ساعات اليوم (Asia/Baghdad).
 * لا يُعلن أي «ذروة» بلا عيّنة كافية (≥6 تعليقات)، والساعة تُحسم من `publishedAt`
 * الحقيقي لا من وقت معالجتنا.
 */
export function computePeakHours(timestamps: Array<string | null | undefined>): {
  buckets: Array<{ hour: number; count: number }>;
  peakHour: number | null;
  sampleSize: number;
  sufficient: boolean;
  note: string;
} {
  const valid = timestamps.map((t) => (t ? Date.parse(t) : NaN)).filter((n) => Number.isFinite(n));
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const t of valid) {
    // ساعة بغداد محلياً (UTC+3 بلا توقيت صيفي).
    const hour = new Date(t + 3 * 3_600_000).getUTCHours();
    buckets[hour].count += 1;
  }
  const total = valid.length;
  const sufficient = total >= 6;
  let peakHour: number | null = null;
  if (sufficient) {
    peakHour = buckets.reduce((best, b) => (b.count > best.count ? b : best), buckets[0]).hour;
  }
  return {
    buckets,
    peakHour,
    sampleSize: total,
    sufficient,
    note: sufficient ? 'الذروة محسوبة من أوقات نشر تعليقات حقيقية (ساعة بغداد).' : 'العيّنة غير كافية لإعلان وقت ذروة (يلزم ≥6 تعليقات حقيقية).',
  };
}

export function detectOpportunities(input: {
  repeatedQuestions: Array<{ text: string; count: number }>;
  minCount?: number;
  newScanned: number;
  previousScanned: number;
  now: number;
}): WatcherOpportunity[] {
  const min = input.minCount ?? 3;
  const out: WatcherOpportunity[] = [];
  const at = new Date(input.now).toISOString();
  for (const q of input.repeatedQuestions) {
    if (q.count >= min) out.push({ id: `opp-q-${q.text.slice(0, 24)}`, kind: 'repeated_question', detail: `سؤال متكرر: ${q.text.slice(0, 120)}`, count: q.count, at });
  }
  if (input.previousScanned > 0 && input.newScanned >= input.previousScanned * 2 && input.newScanned >= 4) {
    out.push({ id: `opp-spike-${input.now}`, kind: 'engagement_spike', detail: `قفزة في التعليقات المكتشفة (${input.previousScanned} → ${input.newScanned}).`, count: input.newScanned, at });
  }
  return out;
}

// -----------------------------------------------------------------------------
// تفاعل المتابعة (Follow-up Engagement) — كشف تغيّر التفاعل على الرد المُسلَّم.
//
// حلقة التعلّم الكاملة: ACTION (رد) → RESULT (تسليم بمعرّف) → OBSERVATION
// (تفاعل لاحق) → LESSON → MEMORY → FUTURE DECISION. هنا تُقاس **الحقيقة** فقط:
// إعجابات/ردود فعلية من `commentThreads.list`. **لا تُخترع قيمة**، وإن تعذّرت
// القراءة يبقى الأساس بلا تغيير (لا ادعاء تغيّر).
// -----------------------------------------------------------------------------

/** مهلة أول بصمة تفاعل بعد التسليم (يُمنح الجمهور وقتاً للتفاعل). */
export const FOLLOWUP_BASELINE_DELAY_MS = 30 * 60 * 1000;
/** أقل فارق إعجاب/رد يُعدّ تغيّراً ملاحَظاً (تحت ذلك = ضجيج). */
export const FOLLOWUP_MIN_DELTA = 1;

/** يقرأ مهلة بصمة المتابعة من البيئة ضمن [0..24س] (افتراضي 30 دقيقة). 0 للاختبار فقط. */
export function followUpBaselineDelayMsFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env.YOUTUBE_FOLLOWUP_BASELINE_DELAY_MS;
  if (raw === undefined || raw === null || String(raw).trim() === '') return FOLLOWUP_BASELINE_DELAY_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return FOLLOWUP_BASELINE_DELAY_MS;
  return Math.min(24 * 60 * 60 * 1000, Math.floor(n));
}

export interface FollowUpSignal {
  likes: number | null;
  replies: number | null;
}

/** يختار عناصر تحتاج رصد تفاعل المتابعة (رد مُسلَّم، بلا نتيجة نهائية، موعد البصمة حلّ). */
export function selectFollowUpCandidates(
  processed: WatcherProcessedEntry[],
  now: number,
  opts: { limit?: number; baselineDelayMs?: number } = {},
): WatcherProcessedEntry[] {
  const delay = opts.baselineDelayMs ?? FOLLOWUP_BASELINE_DELAY_MS;
  const limit = opts.limit ?? 5;
  const out: WatcherProcessedEntry[] = [];
  for (const p of processed) {
    if (out.length >= limit) break;
    if (!p || !p.externalReplyId) continue;
    if (p.followUpOutcome) continue; // محسوم مسبقاً
    const anchor = Date.parse(String(p.at || ''));
    if (!Number.isFinite(anchor) || now - anchor < delay) continue;
    out.push(p);
  }
  return out;
}

/**
 * يقيّم إشارة تفاعل المتابعة حتمياً:
 *   - بلا بصمة سابقة ⇒ تُثبَّت البصمة (`baseline`) ولا يُعلن تغيّر بعد.
 *   - مع بصمة ⇒ فرق إعجاب/رد ≥ الحد ⇒ `engagement_changed`، وإلا `no_change`.
 * **لا ادعاء بيع** ولا رقم مالي. `signal` غير متاح (null) ⇒ لا تغيير في الأساس.
 */
export function evaluateFollowUpEngagement(
  entry: WatcherProcessedEntry,
  signal: FollowUpSignal,
  now: number,
): { baseline?: { likes: number; replies: number }; outcome?: NonNullable<WatcherProcessedEntry['followUpOutcome']>; note: string } {
  const likes = signal?.likes;
  const replies = signal?.replies;
  if (likes === null && replies === null) {
    return { note: 'إشارة التفاعل غير متاحة (تعذّرت قراءة الإعجابات/الردود) — لا ادعاء تغيّر.' };
  }
  const cur = { likes: Number(likes || 0), replies: Number(replies || 0) };
  const base = entry.followUpBaseline || null;
  if (!base) {
    return { baseline: cur, note: 'ثُبّتت بصمة التفاعل عند أول رصد بعد التسليم — لا يُعلن تغيّر بعد.' };
  }
  const likesDelta = cur.likes - base.likes;
  const repliesDelta = cur.replies - base.replies;
  const changed = likesDelta >= FOLLOWUP_MIN_DELTA || repliesDelta >= FOLLOWUP_MIN_DELTA;
  return {
    outcome: {
      kind: changed ? 'engagement_changed' : 'no_change',
      likesDelta: Math.max(0, likesDelta),
      repliesDelta: Math.max(0, repliesDelta),
      at: new Date(now).toISOString(),
    },
    note: changed
      ? `تفاعل متابعة ملاحَظ: +${Math.max(0, likesDelta)} إعجاب، +${Math.max(0, repliesDelta)} رد.`
      : 'لا تغيّر ملاحَظ في تفاعل المتابعة بعد.',
  };
}

