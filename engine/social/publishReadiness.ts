/**
 * تقرير جاهزية النشر الموحّد (Publishing Readiness) — منطق خالص قابل للاختبار.
 *
 * الغرض: إعطاء المالك مصدراً واحداً صادقاً يجيب عن سؤال «هل أستطيع النشر على هذه
 * المنصة الآن، وما الذي ينقص بالضبط، وما الرابط الذي يبدأ الربط بنقرة واحدة؟» بلا
 * أي اختراع: كل حقل مشتقّ من حقائق مُمرَّرة (سجل المنصات + الاتصال الحي + البيئة).
 *
 * الفصل الملزم يبقى قائماً: CODE_READY ≠ CONFIGURED ≠ CONNECTED ≠ VERIFIED ≠
 * OPERATIONAL، ولا تُعلن جاهزية نشر بلا اتصال موثق وموصل منفّذ. ولا سرّ هنا إطلاقاً.
 */

import { hasRealConnector, platformSupports } from './registry';
import type { PlatformId } from './adapter';

export type PublishPathKind = 'dedicated_upload' | 'unified_connector' | 'not_implemented';

export type PublishReadinessState =
  | 'READY_NOW'              // يمكن النشر الآن فعلاً (متصل موثق + موصل منفّذ)
  | 'CONNECT_REQUIRED'      // الكود والبيئة جاهزان؛ يلزم ربط الحساب (OAuth بنقرة)
  | 'EXTERNAL_SETUP_REQUIRED' // يلزم إجراء خارجي من المزود (مراجعة/تطبيق/صلاحية)
  | 'NOT_IMPLEMENTED';       // لا موصل منفّذ — لا وعد بقدرة غير موجودة

export interface PublishMediaRequirement {
  /** لا بدّ من بايتات فيديو/رابط فيديو عام. */
  requiresVideo: boolean;
  /** لا بدّ من رابط وسائط عام (صورة أو فيديو) — لا نص مجرّد. */
  requiresMedia: boolean;
  /** يقبل نصاً مجرّداً بلا وسائط. */
  acceptsTextOnly: boolean;
}

export interface PublishReadinessInput {
  platform: PlatformId;
  displayName: string;
  /** الحالة الجامعة من computePlatformStatus (OPERATIONAL/CONFIGURED/...). */
  operationalState: string;
  connected: boolean;
  providerVerified: boolean;
  /** هل كل متغيّرات اعتماد الاتصال مضبوطة؟ (من inspectPlatformCredentials) */
  credentialsConfigured: boolean;
  /** هل العنوان العام صالح (https عام)؟ يلزمه Meta/Google لرابط الإرجاع. */
  publicUrlValid: boolean;
  /** سبب الحجب الحالي (من computePlatformStatus) — بلا اختراع. */
  blockingReason: string | null;
  /** الإجراء التالي المقترح (من computePlatformStatus). */
  nextAction: string | null;
  /** هل التطبيق يحتاج مراجعة من المزود للنشر العام (TikTok DIRECT_POST)؟ */
  auditRequiredForDirectPublish?: boolean;
}

export interface PublishReadinessRow {
  platform: string;
  displayName: string;
  publishPath: PublishPathKind;
  publishPathLabelAr: string;
  state: PublishReadinessState;
  stateLabelAr: string;
  /** يمكن النشر فعلاً الآن بضغطة واحدة عبر المسار الموحّد. */
  readyNow: boolean;
  connected: boolean;
  providerVerified: boolean;
  media: PublishMediaRequirement;
  mediaNoteAr: string;
  /** خطوات ناقصة صريحة (بلا أي سرّ). */
  blockers: string[];
  nextActionAr: string;
  /** مسار النشر المخصص (يحتاج بايتات) — أو null إن كان يمرّ بالمسار الموحّد. */
  dedicatedPublishRoute: string | null;
  /** مسار بدء الربط (يُعاد الرابط في الاستجابة؛ يلزمه جلسة owner). */
  oauthStartRoute: string | null;
  /** يحتاج مراجعة المزود قبل النشر العام (لا يمنع رفع المسودة). */
  auditRequiredForDirectPublish: boolean;
}

/** متطلبات الوسائط لكل منصة — مصدر واحد مطابق للكود الفعلي في executePlatformPublish. */
const MEDIA_REQUIREMENTS: Record<string, PublishMediaRequirement> = {
  youtube: { requiresVideo: true, requiresMedia: true, acceptsTextOnly: false },
  facebook: { requiresVideo: false, requiresMedia: false, acceptsTextOnly: true },
  instagram: { requiresVideo: false, requiresMedia: true, acceptsTextOnly: false },
  threads: { requiresVideo: false, requiresMedia: false, acceptsTextOnly: true },
  tiktok: { requiresVideo: false, requiresMedia: true, acceptsTextOnly: false },
  telegram: { requiresVideo: false, requiresMedia: false, acceptsTextOnly: true },
};

const MEDIA_NOTES_AR: Record<string, string> = {
  youtube: 'يلزم ملف فيديو (بايتات) عبر مسار الرفع المخصص — لا نشر نصي.',
  facebook: 'يقبل نصاً مجرّداً (/feed)، أو صورة، أو فيديو برابط عام.',
  instagram: 'لا ينشر نصاً مجرّداً؛ يلزم رابط صورة/فيديو عام (خطوتان: حاوية ثم نشر).',
  threads: 'يقبل نصاً مجرّداً (TEXT) رسمياً، أو صورة/فيديو برابط عام.',
  tiktok: 'لا ينشر نصاً مجرّداً؛ يلزم فيديو/صور برابط عام (PULL_FROM_URL).',
  telegram: 'نشر نصي في القناة/المحادثة عبر البوت.',
};

const PATH_LABELS_AR: Record<PublishPathKind, string> = {
  dedicated_upload: 'رفع مخصص (بايتات فيديو)',
  unified_connector: 'المسار الموحّد (نص/وسائط برابط عام)',
  not_implemented: 'غير منفّذ',
};

const STATE_LABELS_AR: Record<PublishReadinessState, string> = {
  READY_NOW: 'جاهز للنشر الآن',
  CONNECT_REQUIRED: 'يلزم ربط الحساب',
  EXTERNAL_SETUP_REQUIRED: 'يلزم إعداد خارجي من المزود',
  NOT_IMPLEMENTED: 'غير منفّذ بعد',
};

/** مسار النشر المخصص لمنصة تحتاج بايتات (YouTube) — أو null. */
const DEDICATED_ROUTES: Record<string, string> = {
  youtube: '/api/platforms/youtube/publish',
};

export function publishPathFor(platform: PlatformId): PublishPathKind {
  if (!hasRealConnector(platform)) return 'not_implemented';
  if (!platformSupports(platform, 'publish')) return 'not_implemented';
  return platform in DEDICATED_ROUTES ? 'dedicated_upload' : 'unified_connector';
}

export function mediaRequirementFor(platform: PlatformId): PublishMediaRequirement {
  return MEDIA_REQUIREMENTS[platform] || { requiresVideo: false, requiresMedia: false, acceptsTextOnly: false };
}

/**
 * يبني صف جاهزية واحداً من حقائق مُمرَّرة. الحكم حتمي وصريح:
 *  - لا READY_NOW إلا باتصال موثق + موصل منفّذ + مسار نشر موجود.
 *  - غياب الاعتماد/العنوان العام ⇒ CONNECT_REQUIRED مع سبب دقيق.
 *  - انتهاء/إعادة ربط ⇒ CONNECT_REQUIRED (لا ادّعاء جاهزية).
 */
export function buildPublishReadinessRow(input: PublishReadinessInput): PublishReadinessRow {
  const publishPath = publishPathFor(input.platform);
  const media = mediaRequirementFor(input.platform);
  const blockers: string[] = [];

  if (publishPath === 'not_implemented') {
    blockers.push('لا يوجد موصل نشر منفّذ لهذه المنصة بعد.');
    return {
      platform: input.platform,
      displayName: input.displayName,
      publishPath,
      publishPathLabelAr: PATH_LABELS_AR[publishPath],
      state: 'NOT_IMPLEMENTED',
      stateLabelAr: STATE_LABELS_AR.NOT_IMPLEMENTED,
      readyNow: false,
      connected: input.connected,
      providerVerified: input.providerVerified,
      media,
      mediaNoteAr: MEDIA_NOTES_AR[input.platform] || 'غير محدّد.',
      blockers,
      nextActionAr: input.nextAction || 'يجب تنفيذ موصل المزود أولاً.',
      dedicatedPublishRoute: null,
      oauthStartRoute: null,
      auditRequiredForDirectPublish: Boolean(input.auditRequiredForDirectPublish),
    };
  }

  const verified = input.connected && input.providerVerified && input.operationalState !== 'FAILED';
  const readyNow = verified;

  if (!input.credentialsConfigured) blockers.push('بيانات اعتماد التطبيق (Client ID/Secret) غير مضبوطة في بيئة الخادم.');
  if (!input.publicUrlValid) blockers.push('العنوان العام (APP_URL) غير صالح؛ Meta/Google يرفضان رابط الإرجاع.');
  if (input.operationalState === 'FAILED') blockers.push('فشل التحقق من الحساب لدى المزود؛ يلزم إعادة الربط.');
  if (!input.connected) blockers.push('الحساب غير مربوط بهذه المنصة.');
  else if (!input.providerVerified) blockers.push('الاتصال قائم لكن لم يُثبته المزود (providerVerified=false).');

  let state: PublishReadinessState;
  if (readyNow) state = 'READY_NOW';
  else if (!input.credentialsConfigured || !input.publicUrlValid) state = 'EXTERNAL_SETUP_REQUIRED';
  else state = 'CONNECT_REQUIRED';

  return {
    platform: input.platform,
    displayName: input.displayName,
    publishPath,
    publishPathLabelAr: PATH_LABELS_AR[publishPath],
    state,
    stateLabelAr: STATE_LABELS_AR[state],
    readyNow,
    connected: input.connected,
    providerVerified: input.providerVerified,
    media,
    mediaNoteAr: MEDIA_NOTES_AR[input.platform] || 'غير محدّد.',
    blockers,
    nextActionAr: input.nextAction || (readyNow ? 'لا إجراء مطلوب؛ يمكن النشر الآن.' : 'أكمل الربط من مركز ربط المنصات.'),
    dedicatedPublishRoute: DEDICATED_ROUTES[input.platform] || null,
    oauthStartRoute: `/api/platforms/${input.platform}/oauth/start`,
    auditRequiredForDirectPublish: Boolean(input.auditRequiredForDirectPublish),
  };
}

export interface PublishReadinessSummary {
  readyNow: string[];
  connectRequired: string[];
  externalSetupRequired: string[];
  notImplemented: string[];
  readyCount: number;
}

export function summarizePublishReadiness(rows: PublishReadinessRow[]): PublishReadinessSummary {
  const pick = (s: PublishReadinessState) => rows.filter((r) => r.state === s).map((r) => r.platform);
  const readyNow = pick('READY_NOW');
  return {
    readyNow,
    connectRequired: pick('CONNECT_REQUIRED'),
    externalSetupRequired: pick('EXTERNAL_SETUP_REQUIRED'),
    notImplemented: pick('NOT_IMPLEMENTED'),
    readyCount: readyNow.length,
  };
}
