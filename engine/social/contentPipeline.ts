/**
 * مسار المحتوى الموحّد لـYouTube — منطق خالص حتمي قابل للاختبار (بلا شبكة/أسرار).
 *
 * الغرض: توحيد دورة المحتوى (فكرة → تحضير → فحص سلامة → قرار مراجعة → موافقة →
 * نشر/جدولة → تحقق → تقرير) في سياسة واحدة، بدل أن يكون كل خيار نظاماً منفصلاً.
 *
 * المبادئ الملزمة:
 * - لا اختراع بيانات: القرار مبني على مدخلات مُثبتة فقط، وسبب القرار صريح.
 * - المحتوى التجاري بمعلومة غير موجودة ⇒ مراجعة بشرية، لا نشر آلي (لا اختراع سعر/عرض).
 * - Kill Switch أعلى من كل شيء: يمنع النشر والجدولة تماماً.
 * - `Scheduled ≠ Published`: الحالة تعكس الواقع الخارجي لدى YouTube.
 * - idempotency حتمي: بصمة محتوى واحدة تمنع إنشاء نفس الفيديو مرتين.
 */

import type { YouTubeWatcherControls } from './youtubeWatcher';

// ---------------------------------------------------------------------------
// دورة حياة المحتوى (مفردات صريحة بلا لبس)
// ---------------------------------------------------------------------------

export const CONTENT_STATES = Object.freeze([
  'DRAFT',
  'REVIEW_REQUIRED',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHED',
  'VERIFIED',
  'REJECTED',
  'CANCELLED',
  'FAILED',
] as const);

export type ContentState = (typeof CONTENT_STATES)[number];

export const CONTENT_STATE_LABELS_AR: Record<ContentState, string> = Object.freeze({
  DRAFT: 'مسودة',
  REVIEW_REQUIRED: 'بانتظار المراجعة البشرية',
  APPROVED: 'مُعتمد من المالك',
  SCHEDULED: 'مجدول على YouTube',
  PUBLISHED: 'منشور على YouTube',
  VERIFIED: 'مُتحقَّق من نشره',
  REJECTED: 'مرفوض',
  CANCELLED: 'ملغى',
  FAILED: 'فشل النشر',
});

export type ContentStateTone = 'operational' | 'transitional' | 'blocked' | 'neutral';

export const CONTENT_STATE_TONES: Record<ContentState, ContentStateTone> = Object.freeze({
  DRAFT: 'neutral',
  REVIEW_REQUIRED: 'transitional',
  APPROVED: 'transitional',
  SCHEDULED: 'operational',
  PUBLISHED: 'operational',
  VERIFIED: 'operational',
  REJECTED: 'blocked',
  CANCELLED: 'blocked',
  FAILED: 'blocked',
});

/** الحالات النهائية التي لا يجوز لأي watcher/scheduler/agent نقضها تلقائياً. */
export const TERMINAL_CONTENT_STATES: ReadonlyArray<ContentState> = Object.freeze(['REJECTED', 'CANCELLED']);

/** هل الحالة نهائية (لا نشر آلي بعدها)؟ */
export function isTerminalContentState(state: ContentState): boolean {
  return TERMINAL_CONTENT_STATES.includes(state);
}

/** خريطة الانتقالات المسموحة — كل انتقال غير مذكور مرفوض صراحةً. */
const CONTENT_TRANSITIONS: Record<ContentState, ContentState[]> = Object.freeze({
  DRAFT: ['REVIEW_REQUIRED', 'APPROVED', 'REJECTED', 'CANCELLED'],
  REVIEW_REQUIRED: ['APPROVED', 'REJECTED', 'CANCELLED', 'DRAFT'],
  APPROVED: ['SCHEDULED', 'PUBLISHED', 'REJECTED', 'CANCELLED', 'FAILED'],
  SCHEDULED: ['PUBLISHED', 'CANCELLED', 'FAILED', 'VERIFIED'],
  PUBLISHED: ['VERIFIED', 'FAILED'],
  VERIFIED: [],
  REJECTED: [],
  CANCELLED: [],
  FAILED: ['APPROVED', 'CANCELLED'],
});

export function canTransitionContent(from: ContentState, to: ContentState): boolean {
  if (from === to) return true;
  return (CONTENT_TRANSITIONS[from] || []).includes(to);
}

// ---------------------------------------------------------------------------
// بوّابة المحتوى — Kill Switch أعلى من كل شيء
// ---------------------------------------------------------------------------

export type ContentAction = 'publish' | 'schedule';

/**
 * مصدر القرار: `manual` قرار مباشر من المالك (نشر الآن/جدولة الآن)، و`auto`
 * أتمتة وفق إعدادات المالك. الفصل إلزامي — لا يجوز أن يُقفل مفتاح الأتمتة
 * (`autoPublish`/`autoSchedule`) قرار المالك اليدوي بعد استيفاء شروط الحالة.
 */
export type ContentActionMode = 'manual' | 'auto';

export interface ContentGateDecision {
  allowed: boolean;
  code: string;
  reason: string;
}

/**
 * بوابة موحّدة للنشر/الجدولة. Kill Switch (`paused`) وتعطيل المراقبة يمنعان
 * الاثنين (قرار المالك والأتمتة) لأنهما يوقفان التشغيل كله. أما `autoPublish`
 * و`autoSchedule` فيخصّان الأتمتة فقط (`mode='auto'`) ولا يقفلان قرار المالك
 * اليدوي (`mode='manual'`). `humanReviewMode` لا يمنع هنا إطلاقاً — بل يوجّه
 * المحتوى غير الواضح إلى المراجعة عبر قرار التصنيف.
 */
export function contentGate(controls: YouTubeWatcherControls, action: ContentAction, mode: ContentActionMode = 'auto'): ContentGateDecision {
  if (!controls.enabled) return { allowed: false, code: 'WATCHER_DISABLED', reason: 'مراقبة YouTube معطّلة من المالك.' };
  if (controls.paused) return { allowed: false, code: 'AUTOMATION_PAUSED', reason: 'Kill Switch فعّال: توقّف النشر والجدولة.' };
  if (mode === 'auto') {
    if (action === 'publish' && !controls.autoPublish) return { allowed: false, code: 'AUTO_PUBLISH_DISABLED', reason: 'النشر الآلي معطّل من المالك.' };
    if (action === 'schedule' && !controls.autoSchedule) return { allowed: false, code: 'AUTO_SCHEDULE_DISABLED', reason: 'الجدولة الآلية معطّلة من المالك.' };
  }
  return { allowed: true, code: 'ALLOWED', reason: mode === 'manual' ? 'مسموح بقرار المالك المباشر بعد استيفاء شروط الحالة.' : 'مسموح بموجب إعدادات المالك.' };
}

// ---------------------------------------------------------------------------
// تصنيف المحتوى للمراجعة — القرار الحتمي
// ---------------------------------------------------------------------------

export type ContentSensitivity = 'low' | 'medium' | 'high';

export type ContentDecisionKind = 'auto_publish' | 'auto_schedule' | 'review_required' | 'blocked';

export interface ContentSafetyInput {
  /** هل النص آمن (لا ادعاء تجاري غير مسجّل حاجب)؟ */
  safe: boolean;
  /** عدد المخالفات الحاجبة. */
  blockedCount: number;
  /** عدد التحذيرات (ادعاءات مشكوكة غير حاجبة). */
  warnCount: number;
  /** هل النص يحمل ادعاءً تجارياً (سعر/خصم/عرض/تقسيط/توفر)؟ */
  hasCommercialClaim: boolean;
}

export interface ContentDecision {
  kind: ContentDecisionKind;
  code: string;
  reason: string;
  sensitivity: ContentSensitivity;
}

/**
 * يحسم مصير المحتوى حتمياً قبل أي طلب شبكة:
 * - بلا مادة فعلية ⇒ blocked (MEDIA_REQUIRED) — لا نشر بلا بايتات.
 * - ادعاء تجاري بلا مصدر موثّق ⇒ review_required (لا اختراع سعر/عرض).
 * - مخالفة حاجبة غير تجارية (سبام/محتوى ممنوع) ⇒ blocked.
 * - محتوى واضح وآمن: auto_publish أو auto_schedule (يُحسم لاحقاً بالبوابة).
 */
export function classifyContentForReview(input: {
  hasMedia: boolean;
  safety: ContentSafetyInput;
  publishAt?: string | null;
  title?: string;
}): ContentDecision {
  if (!String(input.title || '').trim()) {
    return { kind: 'blocked', code: 'TITLE_REQUIRED', reason: 'لا نشر بلا عنوان (YouTube يرفض فيديو بلا عنوان).', sensitivity: 'low' };
  }
  if (!input.hasMedia) {
    return { kind: 'blocked', code: 'MEDIA_REQUIRED', reason: 'لا توجد مادة فعلية للرفع؛ لا يُولّد النظام فيديو وهمياً.', sensitivity: 'low' };
  }
  if (input.safety.hasCommercialClaim && (!input.safety.safe || input.safety.warnCount > 0)) {
    return {
      kind: 'review_required',
      code: 'COMMERCIAL_CLAIM_UNVERIFIED',
      reason: 'المحتوى يحمل ادعاءً تجارياً (سعر/خصم/عرض/تقسيط/توفر) غير مؤكّد من مصدر موثّق — يُراجَع بشرياً ولا يُنشر آلياً.',
      sensitivity: 'high',
    };
  }
  if (!input.safety.safe) {
    return {
      kind: 'blocked',
      code: 'CONTENT_SAFETY_BLOCKED',
      reason: 'المحتوى خالف قواعد السلامة الحاجبة؛ أوقِف قبل الرفع.',
      sensitivity: 'high',
    };
  }
  if (input.safety.warnCount > 0) {
    return {
      kind: 'review_required',
      code: 'CONTENT_WARNING_REVIEW',
      reason: 'المحتوى يحمل عناصر مشكوكة تحتاج تأكيد المالك قبل النشر.',
      sensitivity: 'medium',
    };
  }
  if (input.publishAt) {
    return { kind: 'auto_schedule', code: 'SAFE_SCHEDULE', reason: 'محتوى واضح وآمن وبوقت جدولة؛ يُجدول آلياً عند تمكين الجدولة.', sensitivity: 'low' };
  }
  return { kind: 'auto_publish', code: 'SAFE_PUBLISH', reason: 'محتوى واضح وآمن؛ يُنشر آلياً عند تمكين النشر.', sensitivity: 'low' };
}

/**
 * يحوّل قرار التصنيف إلى الحالة الأولية للعنصر داخل الطابور:
 * - auto_* مع تمكين وإذن ⇒ APPROVED (جاهز للتنفيذ الآلي).
 * - auto_* بلا إذن/مع Kill Switch ⇒ REVIEW_REQUIRED? لا: يبقى DRAFT بانتظار الإذن.
 *   لكن لئلا يُفقد العنصر، نضعه REVIEW_REQUIRED مع سبب صريح (يحتاج إجراء المالك).
 * - review_required ⇒ REVIEW_REQUIRED.
 * - blocked ⇒ DRAFT (لا يُعتمد) مع سبب.
 */
export function decisionToState(decision: ContentDecision, controls: YouTubeWatcherControls): { state: ContentState; code: string; reason: string } {
  if (decision.kind === 'review_required') return { state: 'REVIEW_REQUIRED', code: decision.code, reason: decision.reason };
  if (decision.kind === 'blocked') return { state: 'DRAFT', code: decision.code, reason: decision.reason };
  const gate = contentGate(controls, decision.kind === 'auto_schedule' ? 'schedule' : 'publish');
  if (gate.allowed) return { state: 'APPROVED', code: decision.code, reason: decision.reason };
  return { state: 'REVIEW_REQUIRED', code: gate.code, reason: `${decision.reason} (${gate.reason})` };
}

// ---------------------------------------------------------------------------
// عنصر المحتوى + idempotency
// ---------------------------------------------------------------------------

export interface ContentDraftInput {
  title: string;
  description?: string;
  tags?: string[];
  privacyStatus?: string;
  publishAt?: string | null;
  /** مرجع المادة (لا يُخزَّن أي محتوى سرّي؛ مجرّد مرجع/وصف). */
  mediaRef?: string | null;
  /** مصدر المحتوى (owner/idea/comment…). */
  source?: string;
  categoryId?: string;
  /** معرّف المنتج الحقيقي المرتبط بالمحتوى (اختياري) — يربط الفيديو بمنتجات المعرض
   * فيُستخدم في الرد على استفسارات السعر من بيانات مسجّلة فعلاً (بلا اختراع). */
  productId?: string | null;
}

/**
 * بصمة idempotency حتمية لعنصر محتوى (بلا الحقن الوسمي).
 * تُستخدم لمنع إنشاء نفس الفيديو مرتين عبر retry/restart/deploy.
 */
export function contentFingerprint(input: ContentDraftInput): string {
  const payload = JSON.stringify({
    title: String(input.title || '').trim(),
    description: String(input.description || '').trim(),
    tags: (input.tags || []).map((t) => String(t).trim()).filter(Boolean).sort(),
    privacyStatus: String(input.privacyStatus || ''),
    publishAt: input.publishAt ? String(input.publishAt) : null,
    mediaRef: String(input.mediaRef || ''),
  });
  // بصمة FNV-1a مقتطعة (حتمية بلا اعتماد على crypto في المنطق الخالص).
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `gh${h.toString(16).padStart(8, '0')}`;
}

/** الوسم الذي يُحقن في الفيديو ليتيح المطابقة عند إعادة المزامنة (بلا سرّ). */
export function fingerprintTag(fingerprint: string): string {
  return `gharabiai-${String(fingerprint).slice(0, 16)}`;
}

/** يطابق فيديو حقيقياً ببصمته عبر الوسم المحقون (لإعادة المزامنة بعد انقطاع). */
export function matchVideoByFingerprint(videos: Array<{ videoId?: string | null; tags?: string[] | null; title?: string | null }>, fingerprint: string): { videoId: string | null; title: string | null } | null {
  if (!fingerprint) return null;
  const needle = fingerprintTag(fingerprint).toLowerCase();
  for (const v of videos || []) {
    const tags = (v?.tags || []).map((t) => String(t).toLowerCase());
    if (tags.includes(needle)) return { videoId: v?.videoId ? String(v.videoId) : null, title: v?.title ?? null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// حالات عدم اليقين الخارجي وإعادة المزامنة
// ---------------------------------------------------------------------------

/** نتيجة رفع غير حاسمة: انقطع الاتصال بعد إرسال الطلب — لا إعادة نشر عمياء. */
export interface ExternalReconciliation {
  status: 'FOUND' | 'NOT_FOUND';
  videoId: string | null;
  state: ContentState | null;
  note: string;
}

/**
 * يحسم نتيجة انقطاع الاتصال أثناء الرفع:
 * - وُجد الفيديو ببصمته ⇒ نُسجّله منشوراً/مجدولاً (لا نشر ثانٍ).
 * - لم يُوجد ⇒ retry محدود مسموح (بلا ادعاء نجاح).
 */
export function reconcileUnknownUpload(found: { videoId: string | null; title: string | null } | null, publishAt?: string | null): ExternalReconciliation {
  if (found && found.videoId) {
    const state: ContentState = publishAt ? 'SCHEDULED' : 'PUBLISHED';
    return { status: 'FOUND', videoId: found.videoId, state, note: publishAt ? 'وُجد الفيديو المجدول بنفس البصمة لدى YouTube؛ لا إعادة نشر.' : 'وُجد الفيديو المنشور بنفس البصمة لدى YouTube؛ لا إعادة نشر.' };
  }
  return { status: 'NOT_FOUND', videoId: null, state: null, note: 'لم يُوجد الفيديو لدى YouTube؛ يُسمح بإعادة محاولة مضبوطة (بلا ادعاء نجاح).' };
}

// ---------------------------------------------------------------------------
// تواريخ الجدولة: تحقّق حتمي (بلا ساعة حقيقية في المنطق)
// ---------------------------------------------------------------------------

/** يتحقق أن وقت الجدولة مستقبلي و RFC3339 صالح (يستخدم epoch مُمرَّراً للاختبار). */
export function isFutureSchedule(publishAt: string | null | undefined, now: number): { ok: boolean; reason: string } {
  if (!publishAt) return { ok: true, reason: 'بلا جدولة (نشر فوري).' };
  const epoch = Date.parse(String(publishAt));
  if (!Number.isFinite(epoch)) return { ok: false, reason: 'صيغة وقت الجدولة غير صالحة (يلزم RFC3339).' };
  if (epoch <= now) return { ok: false, reason: 'وقت الجدولة في الماضي؛ YouTube يرفضه.' };
  return { ok: true, reason: 'وقت جدولة مستقبلي صالح.' };
}

/** ملخّص المحتوى للعرض (بلا أي سرّ). */
export function summarizeContentQueue(items: Array<{ state: ContentState; publishAt?: string | null; verified?: boolean; externalVideoId?: string | null; verifiedVideoId?: string | null }>) {
  const byState: Record<string, number> = {};
  for (const s of CONTENT_STATES) byState[s] = 0;
  for (const it of items) byState[it.state] = (byState[it.state] || 0) + 1;
  return {
    total: items.length,
    byState,
    scheduled: items.filter((i) => i.state === 'SCHEDULED').length,
    published: items.filter((i) => i.state === 'PUBLISHED' || i.state === 'VERIFIED').length,
    // التحقق يُعدّ فقط عند وجود دليل فعلي (معرّف مزود + حالة نشر/جدولة).
    verified: items.filter((i) => isVerificationSubstantiated(i as any)).length,
    awaitingReview: items.filter((i) => i.state === 'REVIEW_REQUIRED').length,
    rejected: items.filter((i) => i.state === 'REJECTED').length,
    failed: items.filter((i) => i.state === 'FAILED').length,
  };
}

/** البطاقات القابلة للنقر للتقرير اليومي (مفتاح + مسمّى + عدّاد) — مصدر واحد. */
export const CONTENT_BRIEF_METRICS = Object.freeze([
  'contentPublished',
  'contentScheduled',
  'contentAwaitingReview',
  'contentRejected',
  'contentFailed',
  'contentVerified',
] as const);

export type ContentBriefMetric = (typeof CONTENT_BRIEF_METRICS)[number];

export const CONTENT_BRIEF_METRIC_LABELS_AR: Record<ContentBriefMetric, string> = Object.freeze({
  contentPublished: 'محتوى منشور',
  contentScheduled: 'محتوى مجدول',
  contentAwaitingReview: 'محتوى بانتظار المراجعة',
  contentRejected: 'محتوى مرفوض',
  contentFailed: 'محتوى فشل نشره',
  contentVerified: 'محتوى تم التحقق من نشره',
});

/** يحسب عدّاد كل بطاقة محتوى من نفس السجلات (مصدر واحد ⇒ لا discrepancy). */
export function computeContentBriefCounts(items: Array<{ state: ContentState; verified?: boolean; externalVideoId?: string | null; verifiedVideoId?: string | null }>): Record<ContentBriefMetric, number> {
  return {
    contentPublished: items.filter((i) => i.state === 'PUBLISHED' || i.state === 'VERIFIED').length,
    contentScheduled: items.filter((i) => i.state === 'SCHEDULED').length,
    contentAwaitingReview: items.filter((i) => i.state === 'REVIEW_REQUIRED').length,
    contentRejected: items.filter((i) => i.state === 'REJECTED').length,
    contentFailed: items.filter((i) => i.state === 'FAILED').length,
    contentVerified: items.filter((i) => isVerificationSubstantiated(i as any)).length,
  };
}

/** يحوّل قرار مراجعة المالك على عنصر محتوى إلى الحالة الهدف. */
export type ContentReviewAction = 'approve' | 'reject' | 'edit' | 'publish_now' | 'schedule' | 'cancel';

export const CONTENT_REVIEW_ACTIONS: ReadonlyArray<ContentReviewAction> = Object.freeze(['approve', 'reject', 'edit', 'publish_now', 'schedule', 'cancel']);

export const CONTENT_REVIEW_ACTION_LABELS_AR: Record<ContentReviewAction, string> = Object.freeze({
  approve: 'موافقة',
  reject: 'رفض',
  edit: 'تعديل',
  publish_now: 'نشر الآن',
  schedule: 'جدولة',
  cancel: 'إلغاء',
});

export function isValidContentReviewAction(action: unknown): action is ContentReviewAction {
  return typeof action === 'string' && (CONTENT_REVIEW_ACTIONS as readonly string[]).includes(action);
}

/**
 * العمليات التي لا يجوز أن تُتاح أو تُنفَّذ بلا مادة فيديو حقيقية.
 * الموافقة/النشر/الجدولة تحتاج بايتات فعلية؛ الرفض/التعديل/الإلغاء لا.
 * مصدر واحد تستخدمه الواجهة (لإخفاء الأزرار) والخادم (لمنع التنفيذ فعلاً).
 */
export const CONTENT_MEDIA_REQUIRED_ACTIONS: ReadonlyArray<ContentReviewAction> = Object.freeze(['approve', 'publish_now', 'schedule']);

export function contentActionRequiresMedia(action: ContentReviewAction): boolean {
  return (CONTENT_MEDIA_REQUIRED_ACTIONS as readonly string[]).includes(action);
}

/** يُخفي عمليات النشر/الجدولة/الموافقة حين لا توجد مادة حقيقية (يبقي الرفض/التعديل/الإلغاء). */
export function filterContentActions(actions: ReadonlyArray<ContentReviewAction>, hasMedia: boolean): ContentReviewAction[] {
  return actions.filter((a) => hasMedia || !contentActionRequiresMedia(a));
}

/** حالة المادة الصادقة لعنصر محتوى: COMPLETE فقط عند وجود مادة فعلية (بلا اختلاق). */
export function contentItemMediaState(item: { mediaRef?: string | null; hasMedia?: boolean }): 'COMPLETE' | 'MEDIA_REQUIRED' {
  const ok = item.hasMedia === true || Boolean(String(item.mediaRef || '').trim());
  return ok ? 'COMPLETE' : 'MEDIA_REQUIRED';
}

/**
 * يحوّل قرار المالك إلى الحالة الهدف (حتمي). `publish_now`/`schedule` قرار
 * مالك مباشر (`mode='manual'`): لا يحتاج `autoPublish`/`autoSchedule`، لكنه
 * يُمنع بـKill Switch/تعطيل المراقبة (بوابة `manual`) ويحتاج مادة فيديو حقيقية.
 * `humanReviewMode` لا يقفل النشر بعد الموافقة — إنه سياسة مراجعة لا قفل تنفيذ.
 */
export function reviewActionToState(action: ContentReviewAction, controls: YouTubeWatcherControls, publishAt?: string | null, hasMedia = true): { state: ContentState; code: string; reason: string } {
  // لا موافقة/نشر/جدولة بلا مادة فعلية — لا يُولّد النظام فيديو وهمياً.
  if (!hasMedia && contentActionRequiresMedia(action)) {
    return { state: 'REVIEW_REQUIRED', code: 'MEDIA_REQUIRED', reason: 'لا يمكن اعتماد/نشر/جدولة محتوى بلا مادة فيديو حقيقية؛ أضف الفيديو أولاً.' };
  }
  switch (action) {
    case 'reject': return { state: 'REJECTED', code: 'OWNER_REJECTED', reason: 'رفض المالك المحتوى؛ لا نشر آلي بعد الآن.' };
    case 'cancel': return { state: 'CANCELLED', code: 'OWNER_CANCELLED', reason: 'ألغى المالك عنصر المحتوى.' };
    case 'edit': return { state: 'DRAFT', code: 'OWNER_EDITED', reason: 'عدّل المالك المحتوى؛ يُعاد تقييمه.' };
    case 'approve': return { state: 'APPROVED', code: 'OWNER_APPROVED', reason: 'اعتمد المالك المحتوى للنشر/الجدولة.' };
    case 'schedule': {
      if (!publishAt) return { state: 'APPROVED', code: 'SCHEDULE_TIME_REQUIRED', reason: 'الجدولة تحتاج وقت publishAt صالحاً.' };
      const gate = contentGate(controls, 'schedule', 'manual');
      if (!gate.allowed) return { state: 'REVIEW_REQUIRED', code: gate.code, reason: gate.reason };
      return { state: 'APPROVED', code: 'OWNER_SCHEDULED', reason: 'اعتمد المالك الجدولة يدوياً؛ ستُنفَّذ على YouTube (private حتى الموعد).' };
    }
    case 'publish_now': {
      const gate = contentGate(controls, 'publish', 'manual');
      if (!gate.allowed) return { state: 'REVIEW_REQUIRED', code: gate.code, reason: gate.reason };
      return { state: 'APPROVED', code: 'OWNER_PUBLISH_NOW', reason: 'طلب المالك النشر الآن (public).' };
    }
    default: return { state: 'REVIEW_REQUIRED', code: 'UNKNOWN_ACTION', reason: 'إجراء غير معروف.' };
  }
}

/** هل يمكن نشر عنصر تلقائياً الآن؟ (بوابة أتمتة + حالة) */
export function canAutoPublish(item: { state: ContentState; publishAt?: string | null }, controls: YouTubeWatcherControls): ContentGateDecision {
  if (item.state !== 'APPROVED') return { allowed: false, code: 'NOT_APPROVED', reason: 'العنصر ليس في حالة APPROVED.' };
  const action: ContentAction = item.publishAt ? 'schedule' : 'publish';
  return contentGate(controls, action, 'auto');
}

/**
 * هل التحقق مُدعَّم بدليل فعلي؟ لا يُقبل `verified=true` إلا مع معرّف فيديو حقيقي
 * من المزود وحالة نشر/جدولة. أي تحقق بلا معرّف (بيانات قديمة/مخزّنة يدوياً) يُسقَط
 * عند التحميل حتى لا يُعلن تحقق بلا دليل — قاعدة المشروع: لا ادعاء بلا إثبات.
 */
export function isVerificationSubstantiated(item: { verified?: boolean; externalVideoId?: string | null; verifiedVideoId?: string | null; state?: string | null }): boolean {
  if (item.verified !== true) return false;
  const vid = String(item.verifiedVideoId || item.externalVideoId || '').trim();
  if (!vid) return false;
  return item.state === 'PUBLISHED' || item.state === 'SCHEDULED' || item.state === 'VERIFIED';
}

/**
 * حكم حتمي على عنصر مجدول حلّ موعده، بناءً على الحالة الحقيقية المقروءة من
 * المزود. لا يُعلن VERIFIED إلا بحالة `public` فعلية؛ وأي حالة أخرى تبقى SCHEDULED
 * بسبب صريح بلا اختراع. منطق صافٍ قابل للاختبار (بلا شبكة).
 *
 * `publishAtEpoch` يُمرَّر محسوباً مسبقاً بسياسة المنطقة الموحّدة (لا `Date.parse`
 * هنا) لئلا يُفسَّر الجدار المحلي بتوقيت المضيف فيُزحزح الموعد.
 */
export function evaluateDueScheduledContent(
  item: { state: ContentState; externalVideoId?: string | null },
  publishAtEpoch: number,
  actualPrivacyStatus: string | null,
  nowMs: number,
): { action: 'verify' | 'hold' | 'unreadable'; state: ContentState; code: string; reason: string } | null {
  if (item.state !== 'SCHEDULED') return null;
  if (!String(item.externalVideoId || '').trim()) return null;
  if (!Number.isFinite(publishAtEpoch) || publishAtEpoch > nowMs) return null;
  if (actualPrivacyStatus === 'public') {
    return { action: 'verify', state: 'VERIFIED', code: 'VERIFIED_PUBLIC_ON_YOUTUBE', reason: 'أثبت YouTube أن الفيديو أصبح عاماً فعلاً بعد موعد الجدولة.' };
  }
  if (actualPrivacyStatus === null) {
    return { action: 'unreadable', state: 'SCHEDULED', code: 'SCHEDULED_VERIFY_UNREADABLE', reason: 'موعد الجدولة حلّ لكن تعذّر تأكيد الحالة من YouTube الآن؛ بقي مجدولاً بلا ادعاء.' };
  }
  return { action: 'hold', state: 'SCHEDULED', code: 'SCHEDULED_STILL_NOT_PUBLIC', reason: `موعد الجدولة حلّ والحالة الفعلية لدى YouTube (${actualPrivacyStatus}) ليست public بعد؛ بقي مجدولاً.` };
}

/**
 * تصنيف حتمي لبيانات الاختبار التجريبية — بلا تخمين. لا يُصنّف «اختباراً» إلا
 * بدليل مقصود وموثّق (مصدر `test`)، أو بوسم صريح داخل السجل/السجل التاريخي.
 * العناصر المُنشأة عبر الواجهة (source='owner') **لا** تُصنّف اختباراً أبداً،
 * حتى لا تُحذف بيانات حقيقية. أي عنصر لا يُطابق دليلاً يبقى production.
 */
export const TEST_MARKER_RE = /\b(test|dummy|sample|smoke|e2e|qa)\b|اختبار|تجريب/i;

export function classifyContentRecord(
  item: { source?: string | null; title?: string | null; description?: string | null; history?: Array<{ action?: string }> },
): { classification: 'test' | 'production'; reason: string } {
  if (String(item.source || '') === 'test') return { classification: 'test', reason: 'مصدر موثّق: test.' };
  if (TEST_MARKER_RE.test(`${item.title || ''} ${item.description || ''}`)) return { classification: 'test', reason: 'وسم اختبار صريح في العنوان/الوصف.' };
  const hist = Array.isArray(item.history) ? item.history : [];
  if (hist.some((h) => String(h?.action || '') === 'test_marker')) return { classification: 'test', reason: 'وسم اختبار صريح في السجل.' };
  return { classification: 'production', reason: 'لا دليل اختبار؛ يُعامَل كبيانات إنتاج.' };
}

/**
 * هل يسمح قرار مالك مباشر (نشر الآن/جدولة) على هذا العنصر الآن؟ حتمي ويجمع:
 * الحالة (ليست نهائية) + المادة (فعلية) + البوابة اليدوية (Kill Switch/تعطيل).
 * يُستخدم لعرض الأزرار في الواجهة ولمنع التنفيذ في الخادم بنفس المنطق.
 * النشر الآن يفترض `public`، والجدولة تفترض `private` حتى الموعد.
 */
export function contentManualReadiness(
  item: { state: ContentState; hasMedia?: boolean; mediaRef?: string | null; publishAt?: string | null },
  controls: YouTubeWatcherControls,
): {
  canPublishNow: boolean; canSchedule: boolean;
  publishBlockedCode: string | null; publishBlockedReason: string | null;
  scheduleBlockedCode: string | null; scheduleBlockedReason: string | null;
  publishPrivacyStatus: 'public'; schedulePrivacyStatus: 'private';
  scheduleRequiresPublishAt: true;
} {
  const hasMedia = item.hasMedia === true || Boolean(String(item.mediaRef || '').trim());
  const terminal = isTerminalContentState(item.state);
  let publishBlockedCode: string | null = null;
  let publishBlockedReason: string | null = null;
  let scheduleBlockedCode: string | null = null;
  let scheduleBlockedReason: string | null = null;
  if (terminal) {
    publishBlockedCode = scheduleBlockedCode = 'TERMINAL_STATE';
    publishBlockedReason = scheduleBlockedReason = `الحالة ${item.state} نهائية؛ لا نشر ولا جدولة.`;
  } else if (!hasMedia) {
    publishBlockedCode = scheduleBlockedCode = 'MEDIA_REQUIRED';
    publishBlockedReason = scheduleBlockedReason = 'لا توجد مادة فيديو حقيقية؛ أضف الفيديو أولاً.';
  } else {
    const pg = contentGate(controls, 'publish', 'manual');
    if (!pg.allowed) { publishBlockedCode = pg.code; publishBlockedReason = pg.reason; }
    const sg = contentGate(controls, 'schedule', 'manual');
    if (!sg.allowed) { scheduleBlockedCode = sg.code; scheduleBlockedReason = sg.reason; }
  }
  return {
    canPublishNow: publishBlockedCode === null,
    canSchedule: scheduleBlockedCode === null,
    publishBlockedCode, publishBlockedReason, scheduleBlockedCode, scheduleBlockedReason,
    publishPrivacyStatus: 'public', schedulePrivacyStatus: 'private', scheduleRequiresPublishAt: true,
  };
}

// ---------------------------------------------------------------------------
// ذكاء الجدولة — من بيانات حقيقية فقط، وبلا اختراع "أفضل وقت" بلا عيّنة
// ---------------------------------------------------------------------------

export interface ScheduleIntelligenceInput {
  /** أوقات التفاعل الحقيقية (تعليقات/مشاهدات) بصيغة ISO. */
  engagementTimestamps: Array<string | null | undefined>;
  /** عدد أفراد العيّنة الكافية لاعتبار التحليل موثوقاً. */
  minSample?: number;
  /** المنطقة الزمنية المستهدفة (افتراضياً بغداد UTC+3 بلا توقيت صيفي). */
  tzOffsetMinutes?: number;
}

export interface ScheduleIntelligenceResult {
  sampleInsufficient: boolean;
  sampleSize: number;
  /** ساعة الذروة بغداد (0..23) أو null إن كانت العيّنة غير كافية. */
  peakHour: number | null;
  /** الإجراء المعلن: اقتراح وقت من بيانات كافية، أو fallback زمني واضح، أو مراجعة بشرية. */
  action: 'use_data' | 'fallback_time' | 'human_review';
  suggestedAt: string | null;
  note: string;
}

/**
 * يحسب نافذة الجدولة المقترحة من أوقات تفاعل حقيقية فقط. القاعدة الملزمة:
 * لا يُدّعى أن ساعة معينة "أفضل" إن كانت العيّنة غير كافية — بل يُعلن
 * `sampleInsufficient: true` ويُستخدم fallback معلن أو تُحوَّل للمراجعة.
 */
export function suggestScheduleTime(input: ScheduleIntelligenceInput): ScheduleIntelligenceResult {
  const minSample = Math.max(3, Number(input.minSample ?? 8));
  const tz = Number.isFinite(input.tzOffsetMinutes) ? Number(input.tzOffsetMinutes) : 180; // بغداد UTC+3
  const epochs = (input.engagementTimestamps || [])
    .map((t) => (t ? Date.parse(String(t)) : NaN))
    .filter((n) => Number.isFinite(n));
  const sampleSize = epochs.length;
  if (sampleSize < minSample) {
    return {
      sampleInsufficient: true,
      sampleSize,
      peakHour: null,
      action: 'fallback_time',
      suggestedAt: null,
      note: `عيّنة التفاعل (${sampleSize}) أقل من الحد الكافي (${minSample})؛ لا يُدّعى وجود «أفضل وقت» — يُترك للمالك اختيار وقت صريح أو مراجعة بشرية.`,
    };
  }
  const hourCounts = new Array(24).fill(0);
  for (const e of epochs) {
    const h = new Date(e + tz * 60000).getUTCHours();
    hourCounts[h] += 1;
  }
  let peakHour = 0;
  for (let h = 1; h < 24; h += 1) if (hourCounts[h] > hourCounts[peakHour]) peakHour = h;
  // الوقت المقترح: أول نافذة ذروة مستقبلية على الساعة المحلية.
  const now = Date.now();
  const base = new Date(now + tz * 60000);
  const candidate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), peakHour, 0, 0) - tz * 60000);
  if (candidate.getTime() <= now) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return {
    sampleInsufficient: false,
    sampleSize,
    peakHour,
    action: 'use_data',
    suggestedAt: candidate.toISOString(),
    note: `ساعة الذروة الحقيقية ${peakHour}:00 (بغداد) من عيّنة ${sampleSize} من التفاعلات الفعلية.`,
  };
}
