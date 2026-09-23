/**
 * أساس موحّد لاستقبال webhooks من المنصات.
 *
 * سبب الوجود: كل منصة ترسل التحديثات بصيغة مختلفة، لكن الخطوات الأمنية واحدة:
 * التحقق من المصدر → منع إعادة الإرسال (replay) → منع التكرار (idempotency) →
 * التحقق من الشكل → التطبيع إلى حدث داخلي واحد → الحفظ والتدقيق.
 *
 * هذا الملف حتمي بالكامل ولا يستدعي الشبكة، لذا يُختبر بلا أي مزود حقيقي.
 * كل منصة تزوّد بمُتحقّق (verifier) خاص بالطريقة التي توقّع بها طلباتها:
 * - Telegram: ترويسة `X-Telegram-Bot-Api-Secret-Token` (بلا HMAC).
 * - Meta (Facebook/Instagram/WhatsApp): توقيع HMAC-SHA256 في `X-Hub-Signature-256`.
 *
 * لا يُقبل أي حدث بلا تحقق ناجح، ولا يُخزَّن حدث مكرر.
 */

import crypto from 'node:crypto';
import { constantTimeEqual } from './telegram';
import type { PlatformId } from './adapter';

/** حدث اجتماعي موحّد يدخل مسار المعالجة الواحد بغض النظر عن مصدره. */
export interface NormalizedSocialEvent {
  platform: PlatformId;
  /** نوع الحدث كما وقع فعلاً. */
  kind: 'comment' | 'message' | 'mention' | 'reaction';
  /** معرّف الحدث لدى المنصة — أساس منع التكرار. */
  externalId: string;
  /** معرّف المنشور/المحادثة الأم إن وُجد. */
  parentExternalId: string | null;
  authorName: string | null;
  text: string;
  createdAt: string;
  /** هدف الرد الحقيقي كما تعيده المنصة (يُستخدم لاحقاً في الإرسال). */
  replyTarget: Record<string, unknown> | null;
  /** الحدث الخام كما ورد (يُحفظ للتدقيق، بلا أسرار). */
  raw: Record<string, unknown>;
}

export interface WebhookVerificationResult {
  ok: boolean;
  reason?: string;
}

/** مُتحقّق من مصدر الـwebhook. كل منصة تنفّذ طريقتها الخاصة. */
export interface WebhookVerifier {
  /** اسم آمن للتشخيص (بلا أسرار). */
  readonly kind: string;
  verify(input: { headers: Record<string, string | undefined>; rawBody: string; secret: string }): WebhookVerificationResult;
}

/**
 * التحقق بنمط Telegram: مقارنة ترويسة سرّية بزمن ثابت.
 * الفرق في الطول أو غياب السرّ/الترويسة = رفض صريح.
 */
export function secretHeaderVerifier(headerName: string): WebhookVerifier {
  return {
    kind: `secret-header:${headerName.toLowerCase()}`,
    verify({ headers, secret }) {
      if (!secret) return { ok: false, reason: 'سرّ webhook غير مضبوط؛ رُفض الحدث لحماية النظام.' };
      const provided = headers[headerName] ?? headers[headerName.toLowerCase()];
      if (!provided) return { ok: false, reason: 'الترويسة السرّية غائبة؛ الحدث غير موثوق.' };
      if (!constantTimeEqual(String(provided), secret)) return { ok: false, reason: 'الترويسة السرّية غير مطابقة؛ الحدث غير موثوق.' };
      return { ok: true };
    },
  };
}

/**
 * التحقق بنمط Meta: توقيع HMAC-SHA256 على الجسم الخام بصيغة `sha256=<hex>`.
 * يُقارن بزمن ثابت. أي جسم مُعدّل يفشل التحقق حتى لو طابقت الترويسة موجودة.
 */
export function hmacSignatureVerifier(headerName: string, algorithm = 'sha256'): WebhookVerifier {
  return {
    kind: `hmac-${algorithm}:${headerName.toLowerCase()}`,
    verify({ headers, rawBody, secret }) {
      if (!secret) return { ok: false, reason: 'سرّ التوقيع غير مضبوط؛ رُفض الحدث لحماية النظام.' };
      const provided = headers[headerName] ?? headers[headerName.toLowerCase()];
      if (!provided) return { ok: false, reason: 'ترويسة التوقيع غائبة؛ الحدث غير موثوق.' };
      const expected = crypto.createHmac(algorithm, secret).update(rawBody, 'utf8').digest('hex');
      const providedHex = String(provided).includes('=') ? String(provided).split('=').pop() || '' : String(provided);
      if (!constantTimeEqual(providedHex.toLowerCase(), expected)) {
        return { ok: false, reason: 'توقيع الحدث غير مطابق؛ الحدث غير موثوق.' };
      }
      return { ok: true };
    },
  };
}

/**
 * بوابة منع إعادة الإرسال/التكرار. تعتمد على معرّفات رأتها سابقاً، فلا تُعالج
 * نفس الحادثة مرتين عند retry من المزود أو إعادة تشغيل حدث محفوظ.
 */
export function isReplayOrDuplicate(input: {
  /** معرّف الحدث العام لدى المزود (مثل update_id). */
  providerEventId: string | number;
  /** معرّف الحدث الخارجي الموحّد. */
  externalId: string;
  seenProviderEventIds: Array<string | number>;
  seenExternalIds: string[];
}): boolean {
  if (input.seenProviderEventIds.some((x) => String(x) === String(input.providerEventId))) return true;
  return input.seenExternalIds.includes(input.externalId);
}

/**
 * تحقق شكل الحمولة الأدنى: كائن غير فارغ. تُستدعى قبل أي قراءة للحقول لتفادي
 * أخطاء القراءة على بيانات مشوّهة.
 */
export function isValidWebhookPayload(payload: unknown): payload is Record<string, unknown> {
  return Boolean(payload) && typeof payload === 'object' && !Array.isArray(payload);
}

/** يبني حدثاً موحّداً من مدخلات مُطبّعة، مع تقييد الحجم والتنظيف. */
export function buildNormalizedEvent(input: {
  platform: PlatformId;
  kind: NormalizedSocialEvent['kind'];
  externalId: string;
  parentExternalId?: string | null;
  authorName?: string | null;
  text: string;
  createdAt?: string;
  replyTarget?: Record<string, unknown> | null;
  raw?: Record<string, unknown>;
}): NormalizedSocialEvent {
  return {
    platform: input.platform,
    kind: input.kind,
    externalId: String(input.externalId),
    parentExternalId: input.parentExternalId ? String(input.parentExternalId) : null,
    authorName: input.authorName ? String(input.authorName).slice(0, 200) : null,
    text: String(input.text || '').slice(0, 8000),
    createdAt: input.createdAt || new Date().toISOString(),
    replyTarget: input.replyTarget ?? null,
    raw: input.raw ?? {},
  };
}
