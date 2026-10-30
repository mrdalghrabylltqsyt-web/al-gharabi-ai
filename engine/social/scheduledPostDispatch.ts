/**
 * منفّذ المنشورات المجدولة في التقويم (إصلاح جذري 2026-10-30).
 *
 * السبب الجذري: «جدولة منشور» تضع `post.status = "scheduled"` و`scheduledFor` في
 * `workspace.posts` فقط، بينما المنفّذ التلقائي (B4) يقرأ `automationJobs` وحدها، ومسار
 * النشر متعدد المنصات يرفض أي حالة غير `approved`. فلم يكن في الخادم أي شيء يقرأ منشوراً
 * مجدولاً حان موعده — يبقى «مجدولاً» في التقويم للأبد ولا يصل لأي منصة، ولا يظهر في
 * «طابور مهام النشر» (لا مهام)، ولا يُسجَّل فشل.
 *
 * هذا الملف منطق صافٍ (بلا شبكة/ساعة/أسرار) يقرّر لكل منشور: هل يُنشر الآن؟ ولماذا لا؟
 * التنفيذ نفسه يمرّ بالمنفّذ المشترك نفسه في الخادم (`executePlatformPublish`) بكل بواباته.
 *
 * القواعد:
 *  - الجدولة نفسها لا تتم إلا لمنشور اعتمده المالك (مسار `/schedule` بـrequireOwner)،
 *    والنشر التلقائي محكوم بمفتاح المالك «نشر المعتمد تلقائياً في موعده».
 *  - لا نشر والحفظ الدائم متعطّل: نشرٌ لا تُحفظ نتيجته قد يُعاد بعد إعادة التشغيل فيتكرر
 *    على المنصات. ننتظر عودة الحفظ ونعلن السبب.
 *  - المتأخر أكثر من `lateWindowMs` لا يُنشر تلقائياً (قد يكون عرضاً انتهى) — يُعلَّم «فات
 *    موعده» وينتظر نقرة المالك.
 *  - كل منصة مستقلة: ما نُشر لا يُعاد، والفاشل يُعاد حتى `maxAttempts` بفواصل متزايدة،
 *    وانتظار حصة YouTube يُحترم حتى موعد تجدّدها.
 */

export const SCHEDULED_DISPATCH_POLICY = {
  /** أقصى تأخير يُنشر بعده المنشور تلقائياً (بعد نوم الخادم/تعطل مؤقت). */
  lateWindowMs: 24 * 60 * 60 * 1000,
  /** محاولات تلقائية لكل منصة قبل التسليم للمالك. */
  maxAttempts: 3,
  /** فواصل إعادة المحاولة بعد كل فشل (دقائق). */
  retryDelaysMin: [5, 15, 45] as readonly number[],
  /** منشورات تُعالَج في الدورة الواحدة (منع موجة نشر). */
  maxPerCycle: 3,
} as const;

export type DispatchState =
  | 'waiting'          // لم يحن الموعد
  | 'auto_disabled'    // حان الموعد والمفتاح مطفأ
  | 'storage_unhealthy'// حان الموعد والحفظ الدائم متعطّل
  | 'publishing'       // قيد التنفيذ الآن
  | 'retry_wait'       // فشل عابر/حصة — إعادة في nextAttemptAt
  | 'published'        // نُشر على كل المنصات
  | 'partial'          // نُشر على بعضها وانتهت محاولات الباقي
  | 'failed'           // لم يُنشر على أي منصة بعد كل المحاولات
  | 'missed';          // فات موعده بأكثر من نافذة التأخير

export interface PlatformDispatchResult {
  state: 'published' | 'pending_retry' | 'publishing' | 'failed' | string;
  retryAt?: string | null;
  error?: string | null;
  code?: string | null;
}

export interface ScheduleDispatchInfo {
  state: DispatchState;
  reason: string;
  attempts: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  /** المنصات التي لم تُنشر بعد وما زالت ضمن المحاولات. */
  remainingPlatforms: string[];
  updatedAt: string;
}

export interface DispatchCandidateInput {
  status: string;
  scheduledEpochMs: number;
  targetPlatforms: string[];
  dispatch?: Partial<ScheduleDispatchInfo> | null;
  platformResults?: Record<string, PlatformDispatchResult> | null;
}

export interface DispatchEnv {
  nowMs: number;
  autoEnabled: boolean;
  storageHealthy: boolean;
}

/** شكل واحد (لا اتحاد مميَّز): tsconfig المشروع غير صارم فلا يضيّق `act` المنطقي. */
export interface DispatchDecision {
  act: boolean;
  /** المنصات المطلوب النشر عليها الآن (فارغة حين act=false). */
  platforms: string[];
  state: DispatchState;
  reason: string;
  /** تغيّرت الحالة عن المحفوظة (يُكتب وينبَّه مرة واحدة). */
  changed: boolean;
}

const REASONS: Record<DispatchState, string> = {
  waiting: 'لم يحن موعد النشر بعد.',
  auto_disabled: 'حان الموعد لكن مفتاح «نشر المعتمد تلقائياً في موعده» مطفأ — فعّله أو انشر يدوياً.',
  storage_unhealthy: 'حان الموعد لكن حفظ البيانات في القاعدة متعطّل؛ النشر مؤجَّل حتى يعود الحفظ كي لا يتكرر المنشور على المنصات.',
  publishing: 'جارٍ النشر على المنصات الآن.',
  retry_wait: 'فشلت محاولة النشر على منصة أو أكثر؛ إعادة تلقائية في الموعد المحدد.',
  published: 'نُشر على كل المنصات المستهدفة.',
  partial: 'نُشر على بعض المنصات وفشل الباقي بعد كل المحاولات — راجع السبب لكل منصة.',
  failed: 'لم يُنشر على أي منصة بعد كل المحاولات التلقائية — راجع السبب لكل منصة.',
  missed: 'فات موعد النشر بأكثر من 24 ساعة؛ لا يُنشر تلقائياً متأخراً هكذا — انشره يدوياً أو أعد جدولته.',
};
export function dispatchReasonAr(state: DispatchState): string { return REASONS[state]; }

/** المنصات المستهدفة التي لم تُنشر فعلاً بعد. */
export function unpublishedPlatforms(targets: string[], results?: Record<string, PlatformDispatchResult> | null): string[] {
  return targets.filter((p) => results?.[p]?.state !== 'published');
}

/** قرار حتمي: هل يُنشر هذا المنشور المجدول الآن، وعلى أي منصات؟ */
export function decideScheduledDispatch(post: DispatchCandidateInput, env: DispatchEnv): DispatchDecision {
  const prev = post.dispatch || {};
  const same = (state: DispatchState) => prev.state === state;
  const hold = (state: DispatchState): DispatchDecision => ({ act: false, platforms: [], state, reason: REASONS[state], changed: !same(state) });

  // منشور منشور فعلاً يُعاد فقط لمنصاته المتبقية ضمن خطة إعادة المحاولة.
  const retryingPublished = post.status === 'published' && prev.state === 'retry_wait' && (prev.remainingPlatforms || []).length > 0;
  if (post.status !== 'scheduled' && !retryingPublished) return { act: false, platforms: [], state: (prev.state as DispatchState) || 'waiting', reason: prev.reason || '', changed: false };
  if (!Number.isFinite(post.scheduledEpochMs)) return { act: false, platforms: [], state: 'waiting', reason: 'موعد غير صالح.', changed: false };
  if (post.scheduledEpochMs > env.nowMs) return hold('waiting');
  // حالات نهائية: لا إعادة تلقائية حتى يعيد المالك الجدولة (يُصفّر معلومات الإرسال) أو ينشر يدوياً.
  if (prev.state === 'missed' || prev.state === 'failed' || prev.state === 'partial' || prev.state === 'published') return { act: false, platforms: [], state: prev.state, reason: prev.reason || REASONS[prev.state], changed: false };

  const attempts = Number(prev.attempts || 0);
  // نافذة التأخير تخص الإطلاق الأول فقط؛ إعادة محاولة بدأت في موعدها تُكمَل.
  if (attempts === 0 && env.nowMs - post.scheduledEpochMs > SCHEDULED_DISPATCH_POLICY.lateWindowMs) return hold('missed');
  if (!env.autoEnabled) return hold('auto_disabled');
  if (!env.storageHealthy) return hold('storage_unhealthy');

  const nextAt = prev.nextAttemptAt ? Date.parse(String(prev.nextAttemptAt)) : NaN;
  if (Number.isFinite(nextAt) && nextAt > env.nowMs) return { act: false, platforms: [], state: 'retry_wait', reason: prev.reason || REASONS.retry_wait, changed: false };

  const platforms = attempts > 0 && Array.isArray(prev.remainingPlatforms) && prev.remainingPlatforms.length
    ? prev.remainingPlatforms
    : unpublishedPlatforms(post.targetPlatforms, post.platformResults);
  if (!platforms.length) return hold('published');
  return { act: true, platforms, state: 'publishing', reason: REASONS.publishing, changed: true };
}

/**
 * بعد محاولة: يحسب الحالة التالية للمنشور ومعلومات الإرسال.
 * `results` = نتائج كل المنصات المستهدفة بعد دمج المحاولة الحالية مع السابقة.
 */
export function settleScheduledDispatch(input: {
  targetPlatforms: string[];
  results: Record<string, PlatformDispatchResult>;
  attemptsBefore: number;
  nowMs: number;
}): { postStatus: 'published' | 'scheduled' | 'approved'; dispatch: ScheduleDispatchInfo } {
  const attempts = input.attemptsBefore + 1;
  const nowIso = new Date(input.nowMs).toISOString();
  const published = input.targetPlatforms.filter((p) => input.results[p]?.state === 'published');
  // «publishing» = قبِل المزود الطلب بلا معرّف بعد: لا يُعاد أبداً (إعادته قد تكرر المنشور).
  const remaining = input.targetPlatforms.filter((p) => input.results[p]?.state !== 'published' && input.results[p]?.state !== 'publishing');
  const anyPublished = published.length > 0;
  const finalFail = !anyPublished && remaining.length > 0 && attempts >= SCHEDULED_DISPATCH_POLICY.maxAttempts
    && !remaining.every((p) => input.results[p]?.state === 'pending_retry');
  // فشل نهائي بلا أي نشر ⇒ يعود «معتمداً» فيظهر للمالك صادقاً ويقبل النشر اليدوي/إعادة الجدولة.
  const postStatus: 'published' | 'scheduled' | 'approved' = anyPublished ? 'published' : (finalFail ? 'approved' : 'scheduled');
  const mk = (state: DispatchState, next: string | null, rem: string[]): { postStatus: 'published' | 'scheduled' | 'approved'; dispatch: ScheduleDispatchInfo } => ({
    postStatus,
    dispatch: { state, reason: REASONS[state], attempts, lastAttemptAt: nowIso, nextAttemptAt: next, remainingPlatforms: rem, updatedAt: nowIso },
  });
  if (!remaining.length) return mk('published', null, []);

  // انتظار حصة يوتيوب ليس فشلاً ولا يستهلك محاولة: يُعاد عند موعد التجدد.
  const quotaRetries = remaining.map((p) => input.results[p]).filter((r) => r?.state === 'pending_retry' && r.retryAt).map((r) => Date.parse(String(r!.retryAt))).filter(Number.isFinite);
  const allQuota = remaining.every((p) => input.results[p]?.state === 'pending_retry');
  if (allQuota && quotaRetries.length) {
    const next = new Date(Math.max(input.nowMs + 60_000, Math.min(...quotaRetries))).toISOString();
    return { postStatus, dispatch: { ...mk('retry_wait', next, remaining).dispatch, attempts: input.attemptsBefore } };
  }
  if (attempts >= SCHEDULED_DISPATCH_POLICY.maxAttempts) return mk(anyPublished ? 'partial' : 'failed', null, []);
  const delayMin = SCHEDULED_DISPATCH_POLICY.retryDelaysMin[Math.min(attempts - 1, SCHEDULED_DISPATCH_POLICY.retryDelaysMin.length - 1)];
  return mk('retry_wait', new Date(input.nowMs + delayMin * 60_000).toISOString(), remaining);
}
