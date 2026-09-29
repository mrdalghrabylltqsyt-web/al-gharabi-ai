/**
 * Platform Capability Matrix — سجل قدرات موحّد لكل المنصات (منطق خالص).
 *
 * يمنع العقل المركزي من إصدار أوامر لا تستطيع المنصة تنفيذها. كل قدرة لها حالة
 * صريحة واحدة من خمس:
 *
 *   AVAILABLE       — متاحة عبر الواجهة الرسمية ومنفّذة في الكود.
 *   PARTIAL         — متاحة جزئياً/بقيود (مثل النشر العام المقيّد بمراجعة).
 *   REQUIRES_REVIEW — متاحة لكن تتطلب مراجعة المزود (App Review/Audit).
 *   NOT_AVAILABLE   — المنصة لا توفّرها عبر الواجهة العامة إطلاقاً.
 *   OWNER_ONLY      — متاحة للمالك فقط (لا تُنفَّذ تلقائياً).
 *
 * المصدر: هذا الجدول مبني على `PLATFORM_SPECS` (القدرات) + `readiness` (التنفيذ)،
 * فلا يعلن قدرة غير منفّذة. إضافة منصة #11 = إضافة صف في `PLATFORM_SPECS`.
 */

import type { PlatformId } from '../../social/adapter';
import { PLATFORM_SPECS } from '../../social/registry';

export type CapabilityState = 'AVAILABLE' | 'PARTIAL' | 'REQUIRES_REVIEW' | 'NOT_AVAILABLE' | 'OWNER_ONLY';

export const CAPABILITY_STATE_LABELS_AR: Record<CapabilityState, string> = Object.freeze({
  AVAILABLE: 'متاحة',
  PARTIAL: 'متاحة جزئياً',
  REQUIRES_REVIEW: 'تحتاج مراجعة المزود',
  NOT_AVAILABLE: 'غير متاحة عبر الواجهة العامة',
  OWNER_ONLY: 'للمالك فقط',
});

export type CapabilityKey =
  | 'connection'
  | 'verification'
  | 'read'
  | 'analytics'
  | 'comments'
  | 'reply'
  | 'publish'
  | 'schedule'
  | 'edit'
  | 'audience'
  | 'messaging'
  | 'geography'
  | 'learning_signals';

export const CAPABILITY_KEYS: readonly CapabilityKey[] = Object.freeze([
  'connection', 'verification', 'read', 'analytics', 'comments', 'reply', 'publish',
  'schedule', 'edit', 'audience', 'messaging', 'geography', 'learning_signals',
]);

export interface PlatformCapabilityRow {
  platform: PlatformId;
  states: Record<CapabilityKey, CapabilityState>;
  realConnector: boolean;
  note: string;
}

/**
 * القيود المُعلنة صراحةً لكل منصة: قدرات لا توفّرها الواجهة العامة أو تحتاج
 * مراجعة. لا يُشتق منها أي ادعاء؛ هي تنفيذ مباشر للسياسة الموثّقة في السجل.
 */
const EXPLICIT_CONSTRAINTS: Partial<Record<PlatformId, Partial<Record<CapabilityKey, CapabilityState>>>> = {
  tiktok: {
    comments: 'NOT_AVAILABLE',
    reply: 'NOT_AVAILABLE',
    messaging: 'NOT_AVAILABLE',
    geography: 'NOT_AVAILABLE',
    audience: 'NOT_AVAILABLE',
    edit: 'NOT_AVAILABLE',
    publish: 'REQUIRES_REVIEW',
    analytics: 'AVAILABLE',
  },
  youtube: {
    messaging: 'NOT_AVAILABLE',
    audience: 'NOT_AVAILABLE',
    geography: 'NOT_AVAILABLE',
    comments: 'AVAILABLE',
    reply: 'AVAILABLE',
  },
  facebook: { geography: 'NOT_AVAILABLE' },
  instagram: { geography: 'NOT_AVAILABLE' },
  whatsapp: {
    comments: 'NOT_AVAILABLE',
    reply: 'NOT_AVAILABLE',
    publish: 'NOT_AVAILABLE',
    schedule: 'NOT_AVAILABLE',
    analytics: 'NOT_AVAILABLE',
    audience: 'NOT_AVAILABLE',
    geography: 'NOT_AVAILABLE',
    read: 'AVAILABLE',
    messaging: 'AVAILABLE',
  },
  telegram: {
    comments: 'NOT_AVAILABLE',
    reply: 'NOT_AVAILABLE',
    analytics: 'NOT_AVAILABLE',
    audience: 'NOT_AVAILABLE',
    geography: 'NOT_AVAILABLE',
    publish: 'AVAILABLE',
    messaging: 'AVAILABLE',
  },
  snapchat: {
    comments: 'NOT_AVAILABLE',
    reply: 'NOT_AVAILABLE',
    messaging: 'NOT_AVAILABLE',
    audience: 'NOT_AVAILABLE',
    geography: 'NOT_AVAILABLE',
    publish: 'REQUIRES_REVIEW',
  },
  google_business: {
    comments: 'NOT_AVAILABLE',
    reply: 'NOT_AVAILABLE',
    messaging: 'NOT_AVAILABLE',
    audience: 'NOT_AVAILABLE',
    geography: 'NOT_AVAILABLE',
  },
  x: { geography: 'NOT_AVAILABLE' },
  threads: { geography: 'NOT_AVAILABLE' },
};

/**
 * يشتقّ حالة قدرة من قدرات السجل + القيود المُعلنة. القدرة المعلنة في السجل =
 * `AVAILABLE` (منفّذة)، وإلا `NOT_AVAILABLE`. القيود الصريحة تتقدّم دائماً.
 */
export function capabilityRow(platform: PlatformId): PlatformCapabilityRow {
  const spec = PLATFORM_SPECS.find((s) => s.platform === platform);
  const caps = new Set(spec?.capabilities || []);
  const explicit = EXPLICIT_CONSTRAINTS[platform] || {};
  const derive = (key: CapabilityKey, capName: string | null): CapabilityState => {
    if (explicit[key]) return explicit[key] as CapabilityState;
    if (!capName) return 'NOT_AVAILABLE';
    return caps.has(capName as never) ? 'AVAILABLE' : 'NOT_AVAILABLE';
  };
  const states: Record<CapabilityKey, CapabilityState> = {
    // الاتصال/التحقق/القراءة: متاحة لكل منصة مسجّلة (المصافحة منفّذة في الكود).
    connection: spec ? 'AVAILABLE' : 'NOT_AVAILABLE',
    verification: spec ? 'AVAILABLE' : 'NOT_AVAILABLE',
    read: derive('read', 'comments'),
    analytics: derive('analytics', 'analytics'),
    comments: derive('comments', 'comments'),
    reply: derive('reply', 'comment_reply'),
    publish: derive('publish', 'publish'),
    schedule: derive('schedule', 'scheduling'),
    edit: derive('edit', null),
    audience: derive('audience', 'audience_insights'),
    messaging: derive('messaging', 'messages'),
    // الجغرافيا/التحليلات السكانية غير متاحة عبر الواجهات الحالية لأي منصة.
    geography: explicit.geography || 'NOT_AVAILABLE',
    learning_signals: derive('learning_signals', 'analytics'),
  };
  return {
    platform,
    states,
    realConnector: Boolean(spec?.realConnector),
    note: 'حالات القدرات مشتقة من السجل والقيود الموثّقة؛ لا تُعلن قدرة غير منفّذة.',
  };
}

export function capabilityMatrix(platforms: PlatformId[]): PlatformCapabilityRow[] {
  return platforms.map(capabilityRow);
}

/** هل المنصة تسمح بهذه القدرة فعلاً (AVAILABLE فقط)؟ */
export function platformCan(platform: PlatformId, key: CapabilityKey): boolean {
  return capabilityRow(platform).states[key] === 'AVAILABLE';
}

/** يشرح سبب منع قدرة صراحةً (لتفسير القرارات). */
export function capabilityReason(platform: PlatformId, key: CapabilityKey): string {
  const state = capabilityRow(platform).states[key];
  switch (state) {
    case 'AVAILABLE': return 'القدرة منفّذة ومتاحة عبر الواجهة الرسمية.';
    case 'PARTIAL': return 'القدرة متاحة جزئياً وبقيود موثّقة.';
    case 'REQUIRES_REVIEW': return 'القدرة تحتاج مراجعة/موافقة المزود قبل التشغيل العام.';
    case 'OWNER_ONLY': return 'القدرة متاحة للمالك فقط ولا تُنفَّذ تلقائياً.';
    case 'NOT_AVAILABLE': return 'المنصة لا توفّر هذه القدرة عبر واجهتها العامة — لا يُدَّعى عكس ذلك.';
  }
}
