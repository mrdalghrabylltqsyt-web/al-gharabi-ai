/**
 * تفويض تشغيل YouTube من المالك إلى العقل المركزي.
 *
 * سبب الوجود: بوابات المشروع تمنع أي عملية خارجية (EXTERNAL_ACTION) من داخل مهمة
 * تلقائية، وتطلب موافقة منفصلة لكل عملية. هذا صحيح أمنياً لكنه يجعل العقل عاجزاً
 * عن إدارة قناة YouTube فعلياً. الحل: **تفويض صريح محدود النطاق** يمنحه المالك
 * للعقل لتنفيذ عمليات YouTube المحدّدة فقط، مع بقاء سجل التدقيق وإمكانية الإيقاف.
 *
 * القواعد الملزمة:
 * - النطاق YouTube **فقط**: لا يسمح التفويض بأي عملية على منصة أخرى إطلاقاً.
 * - لا تفويض افتراضي: يُمنح بإرادة المالك ويُسجَّل من منحه ومتى، ويمكن إيقافه فوراً.
 * - المالك وحده يمنح/يوقف (المشغّل staff لا يستفيد من التفويض أصلاً).
 * - لا يُلغى أي حارس قائم: authentication + ownership + audit + contentSafety +
 *   الاتصال الموثق + منع التكرار + rate limit كلها تبقى سارية على العملية المفوضة.
 * - التفويض لا يحمل أي سرّ ولا يُخزَّن أي رمز هنا.
 *
 * منطق خالص بلا شبكة ولا أسرار — قابل للاختبار مباشرة.
 */

/** نطاق التفويض الوحيد المسموح. */
export const YOUTUBE_DELEGATION_SCOPE = 'youtube' as const;

/** العمليات القابلة للتفويض على YouTube (مفردات صريحة، بلا تخمين). */
export const YOUTUBE_DELEGATION_ACTIONS = Object.freeze([
  'reply',
  'publish',
  'schedule',
  'update_video',
] as const);

export type YouTubeDelegationAction = (typeof YOUTUBE_DELEGATION_ACTIONS)[number];

export const YOUTUBE_DELEGATION_ACTION_LABELS_AR: Record<YouTubeDelegationAction, string> = Object.freeze({
  reply: 'الرد على تعليقات YouTube',
  publish: 'رفع/نشر فيديو على YouTube',
  schedule: 'جدولة فيديو على YouTube',
  update_video: 'تحديث بيانات فيديو على YouTube',
});

/**
 * خريطة الأدوات الخارجية إلى العملية المطلوبة. المصدر الواحد لربط أداة العقل
 * بالتفويض، فلا تُخترع علاقة في مكان آخر. أي أداة خارجية غير مذكورة هنا تبقى
 * خاضعة للموافقة اليدوية (بلا تفويض).
 */
export const YOUTUBE_TOOL_DELEGATION: Readonly<Record<string, YouTubeDelegationAction>> = Object.freeze({
  youtube_reply: 'reply',
  youtube_publish: 'publish',
  youtube_video_update: 'update_video',
});

/** هل هذه الأداة قابلة للتفويض على YouTube؟ */
export function isDelegatableYouTubeTool(toolId: string): boolean {
  return Object.prototype.hasOwnProperty.call(YOUTUBE_TOOL_DELEGATION, toolId);
}

/**
 * العمليات المطلوبة لأداة ما. النشر المجدول (publishAt) يحتاج `publish` و
 * `schedule` معاً — فلا يكفي تفويض النشر لجدولة غير مفوّضة.
 */
export function requiredDelegationActions(toolId: string, args: Record<string, any> = {}): YouTubeDelegationAction[] {
  const base = YOUTUBE_TOOL_DELEGATION[toolId];
  if (!base) return [];
  if (base === 'publish' && args && typeof args.publishAt === 'string' && args.publishAt.trim()) {
    return ['publish', 'schedule'];
  }
  return [base];
}

/** سجل التفويض المحفوظ (بلا أي سرّ). */
export interface YouTubeDelegation {
  scope: typeof YOUTUBE_DELEGATION_SCOPE;
  granted: boolean;
  actions: YouTubeDelegationAction[];
  grantedBy: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
  /** انتهاء التفويض (ISO) أو null = بلا انتهاء. */
  expiresAt: string | null;
  note: string | null;
  version: number;
}

/** تفويض افتراضي: غير ممنوح (لا صلاحية خارجية بلا قرار صريح). */
export function defaultYouTubeDelegation(): YouTubeDelegation {
  return {
    scope: YOUTUBE_DELEGATION_SCOPE,
    granted: false,
    actions: [],
    grantedBy: null,
    grantedAt: null,
    revokedAt: null,
    expiresAt: null,
    note: null,
    version: 1,
  };
}

function isAction(value: any): value is YouTubeDelegationAction {
  return (YOUTUBE_DELEGATION_ACTIONS as readonly string[]).includes(String(value));
}

/** ينقّي العمليات: يُسقط أي عملية غير معروفة ويُزيل التكرار ويحافظ على الترتيب الرسمي. */
export function normalizeDelegationActions(actions: any): YouTubeDelegationAction[] {
  if (!Array.isArray(actions)) return [];
  const set = new Set(actions.filter(isAction) as YouTubeDelegationAction[]);
  return YOUTUBE_DELEGATION_ACTIONS.filter((a) => set.has(a));
}

/**
 * يُطبّع تفويضاً مقروءاً من المخزن: يحصر النطاق على YouTube، ويُسقط العمليات
 * غير المعروفة، ويفرض أن تفويضاً بلا عمليات غير ممنوح. لا يختلق منحاً.
 */
export function normalizeYouTubeDelegation(raw: any): YouTubeDelegation {
  if (!raw || typeof raw !== 'object') return defaultYouTubeDelegation();
  const actions = normalizeDelegationActions(raw.actions);
  const granted = raw.granted === true && actions.length > 0 && String(raw.scope || YOUTUBE_DELEGATION_SCOPE) === YOUTUBE_DELEGATION_SCOPE;
  return {
    scope: YOUTUBE_DELEGATION_SCOPE,
    granted,
    actions: granted ? actions : [],
    grantedBy: typeof raw.grantedBy === 'string' ? raw.grantedBy : null,
    grantedAt: typeof raw.grantedAt === 'string' ? raw.grantedAt : null,
    revokedAt: typeof raw.revokedAt === 'string' ? raw.revokedAt : null,
    expiresAt: typeof raw.expiresAt === 'string' ? raw.expiresAt : null,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 300) : null,
    version: Number.isFinite(raw.version) ? Number(raw.version) : 1,
  };
}

/** حالة التفويض الآن: مفعّل/منتهٍ/موقوف/غير ممنوح. */
export interface YouTubeDelegationStatus {
  granted: boolean;
  active: boolean;
  state: 'not_granted' | 'active' | 'expired' | 'revoked';
  actions: YouTubeDelegationAction[];
  reason: string;
  expiresAt: string | null;
  grantedAt: string | null;
}

/** يحسم حالة التفويض حتمياً (بلا ادعاء تفعيل). */
export function youtubeDelegationStatus(d: YouTubeDelegation, now: number = Date.now()): YouTubeDelegationStatus {
  const base = { actions: [] as YouTubeDelegationAction[], expiresAt: d.expiresAt, grantedAt: d.grantedAt };
  // الإيقاف الصريح يتقدّم على «غير ممنوح» ليبقى الأثر مقروءاً (revoked ≠ never granted).
  if (d.revokedAt) {
    return { ...base, granted: d.granted, active: false, state: 'revoked', reason: 'أُوقف تفويض تشغيل YouTube من المالك.' };
  }
  if (!d.granted) {
    return { ...base, granted: false, active: false, state: 'not_granted', reason: 'لم يمنح المالك أي تفويض تشغيل لـYouTube بعد.' };
  }
  if (d.expiresAt) {
    const at = Date.parse(d.expiresAt);
    if (!Number.isFinite(at) || at <= now) {
      return { ...base, granted: true, active: false, state: 'expired', reason: 'انتهت صلاحية تفويض تشغيل YouTube؛ يلزم منح تفويض جديد.' };
    }
  }
  return { ...base, granted: true, active: true, state: 'active', actions: d.actions, reason: 'التفويض فعّال للعمليات الممنوحة على YouTube فقط.' };
}

/** نتيجة تقييم عملية خارجية واحدة مقابل التفويض. */
export interface DelegationDecision {
  allowed: boolean;
  code?:
    | 'DELEGATION_REQUIRED'
    | 'DELEGATION_EXPIRED'
    | 'DELEGATION_REVOKED'
    | 'DELEGATION_ACTION_NOT_GRANTED'
    | 'DELEGATION_OPERATOR_NOT_OWNER'
    | 'DELEGATION_PLATFORM_SCOPE_ONLY'
    | 'TOOL_NOT_DELEGATABLE';
  reason?: string;
  required?: YouTubeDelegationAction[];
}

/**
 * يقرّر هل يجوز تنفيذ عملية خارجية لأداة عقل بموجب التفويض.
 *
 * لا يُسمح إلا إذا: الأداة قابلة للتفويض (YouTube)، والمشغّل مالك، والتفويض فعّال،
 * وكل العمليات المطلوبة ممنوحة. أي غير ذلك => منع صريح بكود مفهوم.
 */
export function evaluateYouTubeDelegation(input: {
  delegation: YouTubeDelegation;
  toolId: string;
  args?: Record<string, any>;
  operator: 'staff' | 'owner' | 'system';
  now?: number;
}): DelegationDecision {
  const now = input.now ?? Date.now();
  if (!isDelegatableYouTubeTool(input.toolId)) {
    return { allowed: false, code: 'TOOL_NOT_DELEGATABLE', reason: `الأداة ${input.toolId} ليست عملية YouTube قابلة للتفويض؛ تبقى خاضعة للموافقة اليدوية.` };
  }
  if (input.operator !== 'owner') {
    return { allowed: false, code: 'DELEGATION_OPERATOR_NOT_OWNER', reason: 'التفويض خاص بالمالك؛ المشغّل الحالي لا يملك صلاحية تنفيذ عمليات خارجية.' };
  }
  const required = requiredDelegationActions(input.toolId, input.args || {});
  const status = youtubeDelegationStatus(input.delegation, now);
  if (status.state === 'expired') return { allowed: false, code: 'DELEGATION_EXPIRED', reason: status.reason, required };
  if (status.state === 'revoked') return { allowed: false, code: 'DELEGATION_REVOKED', reason: status.reason, required };
  if (!status.active) return { allowed: false, code: 'DELEGATION_REQUIRED', reason: status.reason, required };
  const missing = required.filter((a) => !input.delegation.actions.includes(a));
  if (missing.length) {
    return {
      allowed: false,
      code: 'DELEGATION_ACTION_NOT_GRANTED',
      reason: `التفويض الحالي لا يشمل: ${missing.map((m) => YOUTUBE_DELEGATION_ACTION_LABELS_AR[m]).join('، ')}.`,
      required,
    };
  }
  return { allowed: true, required };
}

/** ملخّص آمن للعرض في الصحة/الواجهة (بلا أي سرّ). */
export function summarizeYouTubeDelegation(d: YouTubeDelegation, now: number = Date.now()) {
  const status = youtubeDelegationStatus(d, now);
  return {
    scope: YOUTUBE_DELEGATION_SCOPE,
    granted: d.granted,
    active: status.active,
    state: status.state,
    reason: status.reason,
    actions: d.actions,
    actionsLabelAr: d.actions.map((a) => YOUTUBE_DELEGATION_ACTION_LABELS_AR[a]),
    availableActions: [...YOUTUBE_DELEGATION_ACTIONS],
    availableActionsLabelAr: YOUTUBE_DELEGATION_ACTIONS.map((a) => YOUTUBE_DELEGATION_ACTION_LABELS_AR[a]),
    grantedAt: d.grantedAt,
    revokedAt: d.revokedAt,
    expiresAt: d.expiresAt,
    grantedBy: d.grantedBy,
    note: d.note,
  };
}

/**
 * يبني تفويضاً جديداً من طلب المالك: العمليات المطلوبة، ومدة اختيارية.
 * لا يمنح شيئاً غير مطلوب، ولا يختلق عملية.
 */
export function buildYouTubeDelegation(input: {
  actions: any;
  grantedBy: string;
  now?: number;
  expiresInHours?: number | null;
  note?: string | null;
}): YouTubeDelegation {
  const now = input.now ?? Date.now();
  const actions = normalizeDelegationActions(input.actions);
  const hours = Number(input.expiresInHours);
  const expiresAt = Number.isFinite(hours) && hours > 0 ? new Date(now + hours * 60 * 60 * 1000).toISOString() : null;
  return {
    scope: YOUTUBE_DELEGATION_SCOPE,
    granted: actions.length > 0,
    actions,
    grantedBy: input.grantedBy,
    grantedAt: new Date(now).toISOString(),
    revokedAt: null,
    expiresAt,
    note: input.note ? String(input.note).slice(0, 300) : null,
    version: 1,
  };
}

/** يوقف التفويض (يبقيه في السجل مع ختم الإيقاف — لا يُمسح الأثر). */
export function revokeYouTubeDelegation(d: YouTubeDelegation, now: number = Date.now()): YouTubeDelegation {
  return { ...d, granted: false, revokedAt: new Date(now).toISOString(), note: d.note };
}
