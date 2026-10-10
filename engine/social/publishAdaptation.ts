/**
 * تكييف المحتوى للنشر الموحّد بنقرة واحدة — منطق خالص قابل للاختبار (بلا شبكة/أسرار).
 *
 * الغرض: منع أخطاء المزود النهائية (`CLIENT_ERROR: Invalid parameter`) التي كان
 * سببها أن النص يُرسل للمنصة بلا فحص ملاءمة مسبق (نص يتجاوز الحد، أو منصة لا
 * تقبل نصاً مجرّداً بلا وسائط). هنا نُصنّف **قبل** أي استدعاء مزود:
 *
 *  - نص يتجاوز حد المنصة ⇒ `oversize` مع نص مقترح مُقصَّر (shortenedContent) —
 *    اقتراح فقط، لا يُنشر تلقائياً (نحافظ على النص الأصلي المحفوظ).
 *  - منصة لا تقبل نصاً مجرّداً (Instagram) ولا وسائط ⇒ `no_media` بسبب صريح.
 *  - وسم التعريف التلقائي (hashtagTag) للمنصات النصية لتوحيد قابلية البحث بلا
 *    اختراع معلومة تجارية (وسم عام فقط).
 *
 * **لا اختراع**: لا نولّد صورة ولا نختلق وسيطاً؛ نُعلن النقص صراحةً مع الإجراء.
 */

import { validatePlatformText, shortenToPlatformLimit, platformTextLimit, type TextCountMethod } from './textLimits';

export type PublishAdaptationOutcome = 'ok' | 'oversize' | 'no_media';

export interface PublishAdaptation {
  platform: string;
  outcome: PublishAdaptationOutcome;
  /** يمكن الإرسال كما هو. */
  ok: boolean;
  /** هل يُقبل نص مجرّد بلا وسائط (من قواعد الكود الفعلية). */
  acceptsTextOnly: boolean;
  /** هل تتوفر وسائط (صورة/فيديو) لهذا النشر؟ */
  hasMedia: boolean;
  /** حدّ المنصة (أو null). */
  limit: number | null;
  used: number;
  /** طريقة العدّ الفعلية (Threads = utf8_bytes، غيرها code_points) — تُعلَن صراحةً. */
  countMethod: TextCountMethod;
  /** نص مقترح مُقصَّر عند تجاوز الحد (اقتراح فقط — لا يُنشر تلقائياً). */
  shortenedContent: string | null;
  /** عدد الأسطر المُسقطة في الاقتراح. */
  omittedSegments: number;
  /** سبب صريح عند عدم الملاءمة (فارغ عند النجاح). */
  reason: string;
  code: 'OK' | 'TEXT_TOO_LONG' | 'MEDIA_REQUIRED';
}

/** المنصات التي لا تنشر نصاً مجرّداً بلا وسائط (مصدر واحد مطابق للمنفّذ الفعلي). */
export const TEXT_ONLY_REJECTS: readonly string[] = Object.freeze(['instagram', 'tiktok', 'youtube']);

export function platformAcceptsTextOnly(platform: string): boolean {
  return !TEXT_ONLY_REJECTS.includes(platform);
}

/** وسم تعريف عام للمنصات النصية — لا معلومة تجارية مُختلقة. */
export const PLATFORM_HASHTAG_TAG = '#الغرابي_للتقسيط';

export interface AdaptInput {
  platform: string;
  content: string;
  hasMedia: boolean;
}

/**
 * يقيّم ملاءمة النشر لمنصة واحدة. لا يعدّل النص المحفوظ؛ يُعيد اقتراحاً فقط عند
 * التجاوز، ويُعلن `MEDIA_REQUIRED` صراحةً بدل إرسال نص سيفشل لدى المزود.
 */
export function adaptPublishForPlatform(input: AdaptInput): PublishAdaptation {
  const platform = String(input.platform);
  const content = typeof input.content === 'string' ? input.content : '';
  const hasMedia = Boolean(input.hasMedia);
  const acceptsTextOnly = platformAcceptsTextOnly(platform);
  const limit = platformTextLimit(platform);
  const verdict = validatePlatformText(platform, content);

  if (!acceptsTextOnly && !hasMedia) {
    return {
      platform, outcome: 'no_media', ok: false, acceptsTextOnly, hasMedia, limit,
      used: verdict.used, countMethod: verdict.method, shortenedContent: null, omittedSegments: 0,
      reason: 'هذه المنصة لا تنشر نصاً مجرّداً؛ زوّد رابط صورة/فيديو عاماً قبل النشر.',
      code: 'MEDIA_REQUIRED',
    };
  }

  if (!verdict.ok && verdict.code === 'TEXT_TOO_LONG') {
    const shorten = shortenToPlatformLimit(platform, content);
    return {
      platform, outcome: 'oversize', ok: false, acceptsTextOnly, hasMedia, limit,
      used: verdict.used, countMethod: verdict.method,
      shortenedContent: shorten.changed ? shorten.text : null,
      omittedSegments: shorten.omittedSegments,
      reason: verdict.reason,
      code: 'TEXT_TOO_LONG',
    };
  }

  return {
    platform, outcome: 'ok', ok: true, acceptsTextOnly, hasMedia, limit,
    used: verdict.used, countMethod: verdict.method, shortenedContent: null, omittedSegments: 0,
    reason: '', code: 'OK',
  };
}
