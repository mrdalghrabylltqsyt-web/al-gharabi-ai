/**
 * منطق خالص لفحص اتصال Gemini من الواجهة — قابل للاختبار بلا متصفح.
 *
 * سبب الفصل: نتيجة الفحص ورسالتها الأمنية ومهلة الطلب قواعد حرجة يجب أن
 * تُختبَر حتمياً. هذا الملف لا يستدعي الشبكة ولا يعرف أي سر، بل يحوّل نتيجة
 * الخادم إلى عرض آمن، ويوفّر إشارة إلغاء بمهلة صريحة لا تعاود الإرسال.
 *
 * المبادئ:
 * - البرهان يخصّ نموذج الإنتاج فقط؛ لا نجاح بديل ولا failover صامت.
 * - لا يُعرض أي مفتاح أو تفصيل سري؛ رسالة الفشل عامة ومختصرة.
 */

export interface GeminiVerificationResponse {
  success?: boolean;
  verified?: boolean;
  state?: string;
  model?: string | null;
  latencyMs?: number;
  safeMessage?: string;
  detail?: string;
  errorKind?: string;
  hint?: string;
  [key: string]: unknown;
}

export interface GeminiVerificationOutcome {
  ok: boolean;
  model: string | null;
  latencyMs: number | null;
  message: string;
  /** التوجيه التشخيصي الأمين حسب الفئة الفعلية (عطل مزود/حصة/مفتاح) — بلا أي سر. */
  hint: string | null;
}

/** مهلة صريحة لطلب التحقق من جهة الواجهة — تمنع بقاء الزر في حالة تحميل أبدية. */
export const GEMINI_VERIFY_TIMEOUT_MS = 30_000;

/**
 * إشارة إلغاء ترتبط بمهلة صريحة وتُنظّف تلقائياً عند الإلغاء.
 * تُستخدم مع fetch لإيقاف الطلب عند تجاوز المهلة (بلا أي إعادة إرسال).
 */
export function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const clear = () => clearTimeout(timer);
  // عند الإلغاء نُفرّغ المهلة كي لا تبقى مرجعاً حياً.
  controller.signal.addEventListener('abort', clear, { once: true });
  return { signal: controller.signal, clear };
}

/** يحوّل نتيجة الخادم الناجحة إلى عرض آمن: نجاح + اسم النموذج المتحقق منه. */
export function buildGeminiSuccessText(model?: string | null, latencyMs?: number | null): string {
  const name = (model || '').trim();
  const base = name ? `Gemini متصل — النموذج المتحقق منه: ${name}` : 'Gemini متصل.';
  const ms = Number(latencyMs);
  return Number.isFinite(ms) && ms > 0 ? `${base} (${ms}ms)` : base;
}

/**
 * يحوّل استجابة الخادم إلى نتيجة نهائية.
 *
 * النجاح مشروط بـ verified === true صراحةً، فلا يُستنتج من HTTP 200 وحده
 * (وقد يكون النموذج الأساسي قد فشل). أي فشل يعرض رسالة عامة آمنة، مع أفضل
 * تفصيل غير سرّي متاح من الخادم، وبلا أي مفتاح.
 */
export function interpretGeminiVerification(data: GeminiVerificationResponse | null | undefined): GeminiVerificationOutcome {
  const verified = data?.verified === true && data?.success === true;
  if (verified) {
    return {
      ok: true,
      model: (data?.model as string) || null,
      latencyMs: typeof data?.latencyMs === 'number' ? data.latencyMs : null,
      message: buildGeminiSuccessText(data?.model as string, data?.latencyMs as number),
      hint: null,
    };
  }
  // رسالة الفشل: عامة ومختصرة، مع تفصيل الخادم غير السرّي إن وُجد.
  const safe = typeof data?.safeMessage === 'string' && data.safeMessage.trim() ? data.safeMessage.trim() : '';
  const detail = typeof data?.detail === 'string' && data.detail.trim() ? data.detail.trim() : '';
  const hint = typeof data?.hint === 'string' && data.hint.trim() ? data.hint.trim() : '';
  return {
    ok: false,
    model: null,
    latencyMs: null,
    message: safe || detail || 'تعذر إثبات اتصال النموذج الإنتاجي. لم يتم التحقق.',
    hint: hint || null,
  };
}
