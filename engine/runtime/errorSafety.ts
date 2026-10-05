/**
 * سلامة الأخطاء على مستوى العملية (وحدة منطق صافٍ، بلا شبكة وبلا أسرار).
 *
 * الغرض: ألا يُسقط أي خطأ غير مُلتقَط (استثناء داخل معالج، وعد مرفوض، جسم JSON
 * مشوّه) الخادم، وألا تتسرّب رسالة/مكدّس داخلي أو سرّ في استجابة عامة أو سجل.
 * لا تُعيد أي قيمة سرّية، وتُصنّف الخطأ إلى رد HTTP صريح.
 */

/** تصنيف خطأ إلى رد HTTP صريح — بلا أي تفاصيل داخلية حسّاسة. */
export interface HttpErrorInfo {
  status: number;
  code: string;
  message: string;
  kind: 'bad_request' | 'payload_too_large' | 'internal';
}

/**
 * يصنّف خطأً وصل إلى وسيط الأخطاء. أخطاء محلّل الجسم (JSON مشوّه/حجم كبير) تُرد
 * 4xx صريحة (خطأ عميل)، وما عداها 500 عام. لا يكشف stack ولا رسالة داخلية.
 */
export function classifyHttpError(err: unknown): HttpErrorInfo {
  const anyErr = err as { type?: unknown; status?: unknown; statusCode?: unknown } | null;
  const type = typeof anyErr?.type === 'string' ? anyErr.type : '';
  const rawStatus = Number(anyErr?.status ?? anyErr?.statusCode);
  if (type === 'entity.parse.failed' || type === 'entity.verify.failed') {
    return { status: 400, code: 'INVALID_JSON', message: 'جسم الطلب ليس JSON صالحاً.', kind: 'bad_request' };
  }
  if (type === 'entity.too.large' || rawStatus === 413) {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'حجم الطلب أكبر من الحد المسموح.', kind: 'payload_too_large' };
  }
  // خطأ عميل صريح مع حالة 4xx مُعلنة من طبقة سابقة.
  if (Number.isFinite(rawStatus) && rawStatus >= 400 && rawStatus < 500) {
    return { status: rawStatus, code: 'BAD_REQUEST', message: 'طلب غير صالح.', kind: 'bad_request' };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'خطأ داخلي في الخادم.', kind: 'internal' };
}

/** هل يجوز إظهار رسالة الخطأ الحقيقية؟ في الإنتاج لا — الرسائل العامة فقط. */
export function shouldExposeErrorMessage(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV !== 'production';
}

const SECRET_PATTERNS: RegExp[] = [
  /bearer\s+[a-z0-9._-]+/gi,
  /(access_token|refresh_token|client_secret|api[_-]?key|authorization|password|otp)\s*[=:]\s*[^\s,;"']+/gi,
  /\b[a-f0-9]{32,}\b/gi,
  /\b[A-Za-z0-9_-]{40,}\b/g,
];

/**
 * تنقية نص (رسالة خطأ) من أي قيمة تشبه سرّاً قبل تسجيله أو إعادته. دفاع في العمق:
 * لا يضمن التقاط كل سرّ، لكنه يمنع الأشكال الشائعة (Bearer/توكنات/مفاتيح طويلة).
 */
export function redactSecretsFromText(text: string): string {
  let out = String(text ?? '');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

/**
 * رسالة آمنة للرد/السجل: في الإنتاج رسالة عامة، وفي التطوير رسالة الخطأ مقطوعة
 * ومُنقّاة من أي سرّ. **لا يُعاد stack إطلاقاً**.
 */
export function safeErrorMessage(err: unknown, expose: boolean): string {
  if (!expose) return 'خطأ داخلي في الخادم.';
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return redactSecretsFromText(msg).slice(0, 300) || 'خطأ غير معروف.';
}
