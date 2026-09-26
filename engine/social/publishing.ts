/**
 * دورة النشر والتحليلات.
 *
 * قواعد ثابتة:
 * - لا يُسجَّل أي منشور كـ"منشور" إلا إذا أعاد المزود معرّف منشور حقيقياً.
 * - الحساب غير المتصل لا يُحاول النشر إطلاقاً ولا يُدّعى نجاحه.
 * - أي مؤشر غير متاح من المنصة يظهر صراحة كغير متاح، ولا يُخترع رقم بديل.
 * - مزود الاختبار (mock) مُعلَّم بوضوح ولا يُخلط أبداً مع النشر الحقيقي.
 */

import type { PlatformId } from './adapter';

export type PublishState = 'draft' | 'review' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed';

/** الحالات المسموح منها بالانتقال إلى الحالة التالية. */
const TRANSITIONS: Record<PublishState, PublishState[]> = {
  draft: ['review'],
  review: ['approved', 'draft'],
  approved: ['scheduled', 'publishing', 'draft'],
  scheduled: ['publishing', 'approved'],
  publishing: ['published', 'failed'],
  published: [],
  failed: ['approved', 'draft'],
};

export function canTransition(from: PublishState, to: PublishState): boolean {
  return (TRANSITIONS[from] || []).includes(to);
}

export interface PublishPreflightInput {
  platform: string;
  approved: boolean;
  hasContent: boolean;
  connected: boolean;
  providerVerified: boolean;
  supportsPublish: boolean;
}

export interface PublishPreflightResult {
  ready: boolean;
  checks: Record<string, boolean>;
  reasons: string[];
}

/**
 * فحص ما قبل النشر: حتمي بالكامل ولا يستهلك أي حصة.
 * يفشل بوضوح إن كان الحساب غير متصل أو لم تُعط الموافقة.
 */
export function publishPreflight(input: PublishPreflightInput): PublishPreflightResult {
  const checks = {
    content: Boolean(input.hasContent),
    approval: Boolean(input.approved),
    connection: Boolean(input.connected),
    providerVerified: Boolean(input.providerVerified),
    capability: Boolean(input.supportsPublish),
  };
  const reasons: string[] = [];
  if (!checks.content) reasons.push('المحتوى غير موجود.');
  if (!checks.approval) reasons.push('المحتوى لم تتم الموافقة عليه.');
  if (!checks.connection) reasons.push('الحساب غير متصل باتصال فعلي.');
  if (!checks.providerVerified) reasons.push('الاتصال غير موثق من مزود المنصة.');
  if (!checks.capability) reasons.push('المنصة لا تدعم النشر عبر واجهتها الرسمية في هذا النظام.');

  return { ready: reasons.length === 0, checks, reasons };
}

export interface PublishRecord {
  platform: PlatformId;
  postId: string;
  scheduledFor: string | null;
  executedAt: string;
  state: PublishState;
  providerPostId: string | null;
  error: string | null;
  simulated: boolean;
}

/**
 * يبني سجل نتيجة النشر.
 * إن لم يُعد المزود معرّف منشور، تُسجَّل الحالة failed وليس published.
 */
export function buildPublishRecord(input: {
  platform: PlatformId;
  postId: string;
  scheduledFor?: string | null;
  providerPostId: string | null;
  simulated: boolean;
  error?: string | null;
  executedAt?: string;
}): PublishRecord {
  const published = Boolean(input.providerPostId) && !input.error;
  return {
    platform: input.platform,
    postId: input.postId,
    scheduledFor: input.scheduledFor ?? null,
    executedAt: input.executedAt ?? new Date().toISOString(),
    state: published ? 'published' : 'failed',
    providerPostId: input.providerPostId,
    error: published ? null : (input.error || 'لم يُعد المزود معرّف منشور؛ لم يتم تسجيل النشر.'),
    simulated: input.simulated,
  };
}

/** مؤشرات كل منصة كما تسميها واجهتها الرسمية. */
const PLATFORM_METRIC_SUPPORT: Record<PlatformId, { supported: string[]; unsupported: string[] }> = {
  // Display API الرسمية تُعيد view_count/like_count/comment_count/share_count.
  // لا reach ولا saves في واجهة TikTok العامة.
  tiktok: { supported: ['views', 'likes', 'comments', 'shares'], unsupported: ['reach', 'saves'] },
  youtube: { supported: ['views', 'likes', 'comments'], unsupported: ['shares', 'reach', 'saves'] },
  facebook: { supported: ['views', 'likes', 'comments', 'shares', 'reach'], unsupported: ['saves'] },
  instagram: { supported: ['views', 'likes', 'comments', 'shares', 'reach', 'saves'], unsupported: [] },
  whatsapp: { supported: [], unsupported: ['views', 'likes', 'comments', 'shares', 'reach', 'saves'] },
  telegram: { supported: ['views'], unsupported: ['likes', 'comments', 'shares', 'reach', 'saves'] },
  x: { supported: ['views', 'likes', 'comments', 'shares'], unsupported: ['reach', 'saves'] },
  snapchat: { supported: ['views'], unsupported: ['likes', 'comments', 'shares', 'reach', 'saves'] },
  threads: { supported: ['views', 'likes', 'comments', 'shares', 'reach'], unsupported: ['saves'] },
  google_business: { supported: ['views'], unsupported: ['likes', 'comments', 'shares', 'reach', 'saves'] },
};

const ALL_METRICS = ['views', 'likes', 'comments', 'shares', 'reach', 'saves'] as const;

/**
 * يبني قائمة توفر المؤشرات لمنصة ما.
 * أي مؤشر غير مدعوم يُعاد مع سبب صريح بدل قيمة صفرية مضللة.
 */
export function metricAvailability(platform: PlatformId): { metric: string; available: boolean; reason?: string }[] {
  const spec = PLATFORM_METRIC_SUPPORT[platform];
  if (!spec) return ALL_METRICS.map((metric) => ({ metric, available: false, reason: 'المنصة غير مدعومة في النظام.' }));
  return ALL_METRICS.map((metric) => ({
    metric,
    available: spec.supported.includes(metric),
    reason: spec.supported.includes(metric) ? undefined : 'المؤشر غير متاح عبر الواجهة الرسمية لهذه المنصة.',
  }));
}

/** يجمع القيم المتاحة فقط؛ المؤشرات غير المدعومة لا تُدرج إطلاقاً. */
export function collectAvailableMetrics(platform: PlatformId, raw: Record<string, unknown>): Record<string, number> {
  const availability = metricAvailability(platform);
  const out: Record<string, number> = {};
  for (const item of availability) {
    if (!item.available) continue;
    const value = Number(raw?.[item.metric]);
    if (Number.isFinite(value) && value >= 0) out[item.metric] = value;
  }
  return out;
}

/** حساب نسبة التفاعل من المؤشرات المتاحة فقط؛ يعيد null إن تعذر الحساب. */
export function engagementRate(values: Record<string, number>): number | null {
  const base = values.reach ?? values.views;
  if (!base || base <= 0) return null;
  const interactions = (values.likes || 0) + (values.comments || 0) + (values.shares || 0) + (values.saves || 0);
  return Math.round((interactions / base) * 10000) / 100;
}
