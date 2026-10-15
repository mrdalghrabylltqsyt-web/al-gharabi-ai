/**
 * F-14 — إعادة محاولة نداءات المنصّات الخارجية (Facebook/Instagram/TikTok).
 *
 * المشكلة المُغلَقة: كان `facebook.ts`/`instagram.ts`/`tiktok.ts` بلا أي إعادة
 * محاولة — فانقطاع شبكي عابر أو 503 لحظي يُفشل عملية قراءة أو رد كان يمكن أن
 * ينجح بإعادة واحدة. وفي المقابل، إعادة محاولة **النشر/الرد** (POST) قد تُنشئ
 * نسخة مكررة حقيقية يراه العميل.
 *
 * السياسة الملزمة (مصدر واحد):
 *  - إعادة تلقائية **للقراءة فقط** (`GET`): أخطاء عابرة (شبكة/500/502/503/504/429).
 *  - **POST (نشر/رد): لا إعادة تلقائية أبداً** — التسليم المزدوج خطر. الاعتماد على
 *    سجل منع التكرار الدائم من F-07 (`classifyExternalOperationOutcome`): انقطاع
 *    بعد الإرسال يبقى `reserved`، ورفض صريح من المزود يصبح `failed`.
 *  - **لا إعادة على خطأ دائم**: 400، 401، 403، 404، وكود Meta 190 (رمز منتهٍ).
 *  - `429`: احترام ترويسة `Retry-After` (ثوانٍ أو تاريخ HTTP).
 *  - 3 محاولات كحد أقصى، تراجع أسّي بحدّ سقف.
 *
 * الملف **منطق صافٍ** (بلا شبكة/ساعة حقيقية — تُحقن) قابل للاختبار مباشرةً،
 * والغلاف `createRetryingFetch` يُلَفّ حول `fetch` الحقيقي في `server.ts`.
 */

/** سياسة إعادة المحاولة — حدود آمنة (كل محاولة تستهلك حصة المزود). */
export interface HttpRetryPolicy {
  /** أقصى عدد محاولات (يشمل الأولى). */
  maxAttempts: number;
  /** التأخير الأساسي بالمللي ثانية. */
  baseDelayMs: number;
  /** سقف التأخير بالمللي ثانية (باستثناء Retry-After). */
  maxDelayMs: number;
  /** معامل النمو للتراجع الأسّي. */
  factor: number;
}

export const DEFAULT_HTTP_RETRY_POLICY: HttpRetryPolicy = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 400,
  maxDelayMs: 4_000,
  factor: 2,
});

/** سقف صريح لمدة Retry-After (ثوانٍ) لتفادي انتظار طويل غير محدود. */
export const MAX_RETRY_AFTER_MS = 30_000;

/** أكواد HTTP عابرة تستحق إعادة المحاولة (قراءة فقط). */
export const TRANSIENT_HTTP_STATUSES: readonly number[] = Object.freeze([500, 502, 503, 504, 429]);

/** أكواد أخطاء دائمة لا تُعاد أبداً. */
export const PERMANENT_HTTP_STATUSES: readonly number[] = Object.freeze([400, 401, 403, 404, 405, 422]);

/** كود Meta للرمز المنتهي/المسحوب — خطأ دائم يتطلب إعادة ربط، لا إعادة محاولة. */
export const META_TOKEN_EXPIRED_CODE = 190;

/** يقرأ السياسة من البيئة بحدود آمنة (3 محاولات افتراضاً). */
export function resolveHttpRetryPolicy(env: Record<string, string | undefined> = process.env): HttpRetryPolicy {
  const raw = Number(env.HTTP_RETRY_MAX_ATTEMPTS);
  const maxAttempts = Number.isFinite(raw) ? Math.max(1, Math.min(3, Math.trunc(raw))) : DEFAULT_HTTP_RETRY_POLICY.maxAttempts;
  return { ...DEFAULT_HTTP_RETRY_POLICY, maxAttempts };
}

/**
 * يحلّل ترويسة Retry-After: عدد ثوانٍ أو تاريخ HTTP ⇒ مللي ثانية، مقيّدة بسقف.
 * غير صالحة/غائبة ⇒ `null`.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  const asNumber = Number(v);
  if (Number.isFinite(asNumber) && asNumber >= 0) return Math.min(asNumber * 1000, MAX_RETRY_AFTER_MS);
  const asDate = Date.parse(v);
  if (Number.isFinite(asDate)) return Math.min(Math.max(0, asDate - nowMs), MAX_RETRY_AFTER_MS);
  return null;
}

/** يحسب تأخير التراجع الأسّي مع عشوائية. دالة نقية (random قابل للحقن). */
export function computeHttpBackoffDelay(attempt: number, policy: HttpRetryPolicy, random: () => number = Math.random): number {
  const raw = policy.baseDelayMs * Math.pow(policy.factor, Math.max(0, attempt - 1));
  const capped = Math.min(raw, policy.maxDelayMs);
  const jitter = capped * 0.25 * (random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

export interface HttpRetryDecision {
  retry: boolean;
  /** سبب القرار (للتشخيص الآمن، بلا سرّ). */
  reason: string;
  /** مدة الانتظار المطلوبة (من Retry-After) إن وُجدت — تتقدّم على التراجع الأسّي. */
  retryAfterMs?: number;
}

/**
 * قرار إعادة المحاولة — المصدر الواحد. حاسم وحتمي:
 *  - POST/PUT/PATCH/DELETE: لا إعادة أبداً (`method_not_retryable`).
 *  - خطأ شبكي (بلا استجابة) على GET: إعادة (`network`).
 *  - 429: إعادة مع احترام Retry-After.
 *  - 5xx عابرة على GET: إعادة.
 *  - كود Meta 190: لا إعادة (`token_expired`).
 *  - 400/401/403/404 وأي 4xx أخرى: لا إعادة (`permanent_status`).
 *  - 2xx/3xx: لا إعادة (نجاح/تحويل لا يُعاد).
 */
export function classifyHttpRetry(input: {
  method: string;
  /** حالة HTTP، أو `null` عند فشل الاتصال بلا استجابة. */
  status: number | null;
  /** كود خطأ المزود الحقيقي (Meta 190 مثلاً) إن قُرئ من الجسم. */
  providerCode?: number | null;
  retryAfterMs?: number | null;
  /** true عند رمي استثناء اتصال (بلا استجابة). */
  networkError?: boolean;
}): HttpRetryDecision {
  const method = String(input.method || 'GET').toUpperCase();
  // POST وأخواته غير قابلة للإعادة التلقائية مطلقاً (خطر تسليم مزدوج).
  if (method !== 'GET' && method !== 'HEAD') return { retry: false, reason: 'method_not_retryable' };
  if (input.providerCode === META_TOKEN_EXPIRED_CODE) return { retry: false, reason: 'token_expired' };
  if (input.networkError || input.status == null) return { retry: true, reason: 'network' };
  const status = input.status;
  if (status === 429) return { retry: true, reason: 'rate_limited', retryAfterMs: input.retryAfterMs ?? undefined };
  if (PERMANENT_HTTP_STATUSES.includes(status)) return { retry: false, reason: 'permanent_status' };
  if (status >= 500 && status <= 599) return { retry: true, reason: 'server_error' };
  return { retry: false, reason: 'no_retry' };
}

export interface RetryingFetchOptions {
  policy?: HttpRetryPolicy;
  /** نوم قابل للحقن (لا انتظار فعلي في الاختبارات). */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

/**
 * يلفّ `fetch` الحقيقي بإعادة محاولة القراءة فقط. يعيد نفس شكل استجابة عميل
 * المنصّة (`{ ok, status, json }`) فيبقى التغيير شفافاً لكل المستدعين.
 *
 * ملاحظة: يُقرأ الجسم مرّة واحدة (`text()`) ثم يُعاد عبر `json()` لتفادي
 * استهلاك التدفّق، فلا يمكن إعادة قراءته من المستدعي.
 */
export function createRetryingFetch(
  realFetch: (url: string, init?: any) => Promise<any>,
  options: RetryingFetchOptions = {},
): (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }> {
  const policy = options.policy ?? resolveHttpRetryPolicy();
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => Date.now());

  return async (url: string, init?: any) => {
    const method = String(init?.method || 'GET').toUpperCase();
    for (let attempt = 1; ; attempt++) {
      let res: any;
      try {
        res = await realFetch(url, init);
      } catch (err) {
        const decision = classifyHttpRetry({ method, status: null, networkError: true });
        if (decision.retry && attempt < policy.maxAttempts) {
          await sleep(computeHttpBackoffDelay(attempt, policy, random));
          continue;
        }
        throw err;
      }
      const text = typeof res?.text === 'function' ? await res.text().catch(() => '') : '';
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      const providerCode = data && typeof data === 'object' && data.error && typeof data.error === 'object'
        ? (Number.isFinite(Number(data.error.code)) ? Number(data.error.code) : null)
        : null;
      const retryAfterMs = parseRetryAfter(typeof res?.headers?.get === 'function' ? res.headers.get('retry-after') : null, now());
      const decision = classifyHttpRetry({ method, status: Number(res?.status ?? 0) || null, providerCode, retryAfterMs });
      if (decision.retry && attempt < policy.maxAttempts) {
        const delay = decision.retryAfterMs != null ? decision.retryAfterMs : computeHttpBackoffDelay(attempt, policy, random);
        await sleep(delay);
        continue;
      }
      return { ok: Boolean(res?.ok), status: Number(res?.status ?? 0), json: async () => data };
    }
  };
}
