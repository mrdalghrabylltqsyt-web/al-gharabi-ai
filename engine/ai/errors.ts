/**
 * تصنيف أخطاء مزود الذكاء الاصطناعي.
 *
 * الهدف: التمييز بين خطأ قابل لإعادة المحاولة (ضغط مؤقت على المزود) وخطأ دائم
 * (مفتاح غير صالح، طلب خاطئ، موديل غير موجود). إعادة المحاولة على خطأ دائم
 * تستهلك الحصة وتُطيل زمن الاستجابة دون أي فائدة.
 *
 * لا تُعاد هنا أي تفاصيل حساسة؛ الرسائل العربية آمنة للعرض للمستخدم.
 */

export type AiErrorKind =
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'network'
  | 'auth'
  | 'invalid_request'
  | 'not_found'
  | 'blocked'
  | 'unknown';

export interface AiErrorInfo {
  kind: AiErrorKind;
  /** رمز HTTP إن توفر من المزود. */
  status: number | null;
  /** هل يجوز إعادة المحاولة؟ */
  retryable: boolean;
  /** رسالة عربية آمنة للعرض للمستخدم النهائي. */
  safeMessage: string;
  /** اسم الموديل المرتبط بالخطأ إن كان الخطأ خطأ موديل. */
  model?: string;
}

const SAFE_MESSAGES: Record<AiErrorKind, string> = {
  rate_limited: 'مزود الذكاء الاصطناعي مشغول حالياً. تم استخدام المحرك المحلي الحتمي كبديل آمن.',
  unavailable: 'خدمة الذكاء الاصطناعي غير متاحة مؤقتاً. تم استخدام المحرك المحلي الحتمي كبديل آمن.',
  timeout: 'تجاوز طلب الذكاء الاصطناعي الوقت المسموح. تم استخدام المحرك المحلي الحتمي كبديل آمن.',
  network: 'تعذر الوصول إلى مزود الذكاء الاصطناعي. تم استخدام المحرك المحلي الحتمي كبديل آمن.',
  auth: 'إعداد مفتاح مزود الذكاء الاصطناعي غير صالح على الخادم. تم استخدام المحرك المحلي الحتمي.',
  invalid_request: 'تعذر تنفيذ طلب الذكاء الاصطناعي لعدم صلاحية المدخلات. تم استخدام المحرك المحلي.',
  not_found: 'موديل الذكاء الاصطناعي المطلوب غير متاح. تم استخدام المحرك المحلي الحتمي كبديل آمن.',
  blocked: 'تم حجب المحتوى من مزود الذكاء الاصطناعي وفق سياسات المزود. تم استخدام المحرك المحلي.',
  unknown: 'تعذر إكمال طلب الذكاء الاصطناعي. تم استخدام المحرك المحلي الحتمي كبديل آمن.',
};

/** الحالات التي تستحق إعادة المحاولة فقط. */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function safeMessageFor(kind: AiErrorKind): string {
  return SAFE_MESSAGES[kind] || SAFE_MESSAGES.unknown;
}

function statusFrom(err: any): number | null {
  const raw = err?.status ?? err?.code ?? err?.response?.status;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 100 && n <= 599 ? n : null;
}

/** يستخرج رمز الحالة من نص الخطأ عند غياب حقل status (بعض أخطاء الشبكة نصية فقط). */
function statusFromMessage(message: string): number | null {
  const m = message.match(/\b(400|401|403|404|408|409|425|429|500|501|502|503|504)\b/);
  return m ? Number(m[1]) : null;
}

export function classifyAiError(err: any, model?: string): AiErrorInfo {
  const message = String(err?.message ?? err ?? '');
  const lower = message.toLowerCase();

  // الإلغاء بسبب انتهاء المهلة يصل كخطأ AbortError أو كخطأ مهلة صريح.
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || /timed?\s*out|deadline exceeded|etimedout/.test(lower)) {
    return { kind: 'timeout', status: null, retryable: true, safeMessage: SAFE_MESSAGES.timeout, model };
  }

  if (/fetch failed|enotfound|econnreset|econnrefused|eai_again|socket hang up|network error/.test(lower)) {
    return { kind: 'network', status: null, retryable: true, safeMessage: SAFE_MESSAGES.network, model };
  }

  const status = statusFrom(err) ?? statusFromMessage(message);

  // ملاحظة مهمة مكتشفة من الاختبار الفعلي: مزود Google يعيد 400 وليس 401 عند
  // وجود مفتاح غير صالح. لذلك يُفحص نص الخطأ قبل تفسير 400 كخطأ مدخلات، لأن
  // خطأ المفتاح مشكلة تهيئة على الخادم وليست مشكلة في مدخلات المستخدم.
  if (/api key not valid|api_key_invalid|invalid api key|permission denied|unauthenticated/.test(lower)) {
    return { kind: 'auth', status, retryable: false, safeMessage: SAFE_MESSAGES.auth, model };
  }

  if (status === 429) {
    return { kind: 'rate_limited', status, retryable: true, safeMessage: SAFE_MESSAGES.rate_limited, model };
  }
  if (status === 401 || status === 403) {
    return { kind: 'auth', status, retryable: false, safeMessage: SAFE_MESSAGES.auth, model };
  }
  if (status === 400 || status === 422) {
    return { kind: 'invalid_request', status, retryable: false, safeMessage: SAFE_MESSAGES.invalid_request, model };
  }
  if (status === 404) {
    return { kind: 'not_found', status, retryable: false, safeMessage: SAFE_MESSAGES.not_found, model };
  }
  if (status !== null && RETRYABLE_STATUS.has(status)) {
    return { kind: 'unavailable', status, retryable: true, safeMessage: SAFE_MESSAGES.unavailable, model };
  }

  if (/resource_exhausted|quota|rate limit|overloaded|high demand|unavailable/.test(lower)) {
    return { kind: 'rate_limited', status, retryable: true, safeMessage: SAFE_MESSAGES.rate_limited, model };
  }
  if (/safety|blocked|prohibited/.test(lower)) {
    return { kind: 'blocked', status, retryable: false, safeMessage: SAFE_MESSAGES.blocked, model };
  }

  return { kind: 'unknown', status, retryable: false, safeMessage: SAFE_MESSAGES.unknown, model };
}

/** رسالة تشخيصية آمنة للسجلات: لا تحتوي مفتاحاً ولا توكن ولا جسم طلب. */
export function diagnosticLabel(info: AiErrorInfo): string {
  return `${info.kind}${info.status ? `/${info.status}` : ''}${info.model ? `@${info.model}` : ''}`;
}