/**
 * F-14 — إعادة المحاولة الآمنة لنداءات مزوّدي المنصات (Facebook/Instagram/TikTok).
 *
 * المشكلة المُغلَقة: لم يكن هناك أي retry على نداءات هذه الموصلات، فانقطاع عابر
 * (503/مهلة شبكة) كان يعني فشلاً نهائياً بلا أي محاولة ثانية، رغم أن الطلب لم
 * يصل أو أن المزود لم ينفّذه.
 *
 * القاعدة الحاكمة (لا استثناء): **لا إعادة محاولة تلقائية لأي كتابة**.
 * النشر والرد (POST) لا يُعادان أبداً؛ لأن إعادة إرسال كتابة قد تُنشئ منشوراً أو
 * رداً مكرراً حقيقياً يراه العميل. الاعتماد على سجل idempotency من PR-D1
 * (`classifyExternalOperationOutcome`) يبقى السلطة: انقطاع بعد الإرسال يبقى
 * `reserved`، ورفض صريح من المزود يصبح `failed` (قابل لإعادة محاولة يدوية/مجدولة).
 *
 * الشروط الحصرية للإعادة التلقائية:
 *  - طلبات القراءة (GET) فقط.
 *  - أو فشل الاتصال **قبل** إرسال الطلب (هذا لا ينطبق عملياً على الكتابة، ولذلك
 *    لا نُعيد الكتابة إطلاقاً — الأسلم).
 *  - ولا إعادة على الأخطاء الدائمة: 400/401/403، أو رمز Meta 190 (OAuthException).
 *
 * احترام Retry-After عند 429 (ثوانٍ أو تاريخ HTTP)، مع سقف زمني يمنع تعليق
 * الطلب بلا نهاية. منطق صافٍ (يُحقن `sleep`/`now`) فيُختبر بلا شبكة ولا ساعة حقيقية.
 */

/** نوع الطلب: قراءة (GET) يُسمح بإعادتها، كتابة (POST/…) لا تُعاد أبداً. */
export type ProviderRequestKind = 'read' | 'write';

export interface ProviderRetryConfig {
  /** أقصى عدد محاولات كلي (المحاولة الأولى + الإعادات). الافتراضي 3. */
  maxAttempts: number;
  /** أساس التأخير التصاعدي (ms). الافتراضي 300. */
  baseDelayMs: number;
  /** سقف التأخير التصاعدي (ms). الافتراضي 5000. */
  maxDelayMs: number;
  /** سقف احترام Retry-After (ms) — يمنع تعليق الطلب بلا نهاية. الافتراضي 60000. */
  maxRetryAfterMs: number;
  /**
   * مهلة طلب **القراءة** الواحد (ms). الافتراضي 25000. صيانة 2026-10-25: لم تكن هناك أي
   * مهلة، فقراءة Graph/YouTube المعلّقة قد تحبس دورة كاملة (المراقب/المؤشرات) حتى مهلة
   * المكتبة (~5 دقائق لكل محاولة × 3)، وتتجاوز مدة القفل فتتداخل الدورات. الكتابة (رفع
   * فيديو/نشر) بلا مهلة مضافة — قد تطول مشروعاً، ولا تُعاد أصلاً.
   */
  readTimeoutMs: number;
  /** نوم قابل للحقن (اختبار حتمي بلا ساعة حقيقية). */
  sleep: (ms: number) => Promise<void>;
  /** ساعة قابلة للحقن (لتحويل تاريخ Retry-After). */
  now: () => number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_MAX_DELAY_MS = 5000;
const DEFAULT_MAX_RETRY_AFTER_MS = 60_000;

/** يقرأ عدداً صحيحاً من البيئة بحدود آمنة (لا قيم سالبة/صفرية تُعطّل السلوك). */
function envInt(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number): number {
  const n = Number(env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * يبني إعداد الإعادة من البيئة (قابل للتجاوز في الاختبار). القيم الافتراضية هي
 * المطلوبة: 3 محاولات كحد أقصى. كل القيم مُقيّدة بحدود آمنة.
 */
export function providerRetryConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<ProviderRetryConfig> = {},
): ProviderRetryConfig {
  return {
    maxAttempts: envInt(env, 'PROVIDER_RETRY_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS, 1, 6),
    baseDelayMs: envInt(env, 'PROVIDER_RETRY_BASE_MS', DEFAULT_BASE_DELAY_MS, 1, 60_000),
    maxDelayMs: envInt(env, 'PROVIDER_RETRY_MAX_MS', DEFAULT_MAX_DELAY_MS, 1, 120_000),
    maxRetryAfterMs: envInt(env, 'PROVIDER_RETRY_MAX_RETRY_AFTER_MS', DEFAULT_MAX_RETRY_AFTER_MS, 1, 300_000),
    readTimeoutMs: envInt(env, 'PROVIDER_READ_TIMEOUT_MS', 25_000, 1_000, 120_000),
    sleep: overrides.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    now: overrides.now ?? (() => Date.now()),
    ...overrides,
  };
}

/** يصنّف طريقة HTTP: GET/HEAD/OPTIONS = قراءة، وما عداها كتابة (لا إعادة). */
export function kindForMethod(method: string | null | undefined): ProviderRequestKind {
  const m = String(method || 'GET').trim().toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS' ? 'read' : 'write';
}

/** رمز خطأ Meta من جسم الاستجابة (بلا اختراع). */
export function providerErrorCodeFromBody(data: any): number | null {
  const c = data?.error?.code ?? data?.code;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

/**
 * هل الخطأ **دائم** (لا يجوز إعادته إطلاقاً)؟ القائمة المطلوبة صراحةً: 400/401/403
 * ورمز Meta 190. ونضيف كل 4xx عدا 408 (مهلة) و429 (تقييد مؤقت) — لأنها كلها رفض
 * صريح لا يتغيّر بإعادة المحاولة.
 */
export function isPermanentProviderFailure(status: number, data: any): boolean {
  const code = providerErrorCodeFromBody(data);
  if (code === 190) return true; // OAuthException: رمز مبطَل/منتهٍ — إعادة الربط مطلوبة.
  const s = Number(status);
  if (!Number.isFinite(s)) return false;
  if (s === 408 || s === 429) return false;
  return s >= 400 && s < 500;
}

/** هل الخطأ العابر يستحق إعادة المحاولة (5xx/429)؟ */
export function isTransientProviderStatus(status: number): boolean {
  const s = Number(status);
  if (!Number.isFinite(s)) return false;
  return s === 429 || s >= 500;
}

/**
 * يحلّل ترويسة Retry-After: ثوانٍ عددية أو تاريخ HTTP. يعيد ms أو null.
 * أي قيمة سالبة/غير مفهومة تُتجاهل (لا انتظار مُختلق).
 */
export function parseRetryAfterHeader(value: string | null | undefined, nowMs: number): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Math.max(0, Number(raw) * 1000);
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - nowMs);
}

/** تأخير تصاعدي: base * 2^(attempt-1)، مقيّد بالسقف. */
export function computeBackoffDelayMs(attempt: number, config: ProviderRetryConfig): number {
  const a = Math.max(1, Math.trunc(attempt));
  const exp = config.baseDelayMs * Math.pow(2, a - 1);
  return Math.min(config.maxDelayMs, Math.max(1, Math.trunc(exp)));
}

export interface ProviderRetryDecision {
  retry: boolean;
  /** سبب القرار (بلا سرّ) — للتشخيص والاختبار. */
  reason: 'read_transient' | 'read_network_error' | 'write_never_retried' | 'permanent_error' | 'attempts_exhausted';
  /** مدة الانتظار قبل الإعادة (ms) عند `retry=true`. */
  delayMs: number;
}

export interface ProviderRetryInput {
  kind: ProviderRequestKind;
  /** حالة HTTP عند وجود استجابة؛ تُترك null عند فشل الشبكة قبل أي استجابة. */
  status: number | null;
  /** جسم الاستجابة (لقراءة رمز Meta 190). */
  data?: any;
  /** ترويسة Retry-After الخام (عند 429). */
  retryAfter?: string | null;
  /** رقم المحاولة الحالية (1 = الأولى). */
  attempt: number;
  config: ProviderRetryConfig;
  nowMs?: number;
}

/**
 * قرار الإعادة الموحّد — المصدر الواحد للسلوك. الكتابة لا تُعاد أبداً، والخطأ
 * الدائم لا يُعاد، والقراءة العابرة (5xx/429) أو انقطاع الشبكة في القراءة يُعاد
 * حتى بلوغ الحد، مع احترام Retry-After عند 429.
 */
export function decideProviderRetry(input: ProviderRetryInput): ProviderRetryDecision {
  const { kind, status, data, attempt, config } = input;
  if (kind === 'write') return { retry: false, reason: 'write_never_retried', delayMs: 0 };
  if (attempt >= config.maxAttempts) return { retry: false, reason: 'attempts_exhausted', delayMs: 0 };

  // انقطاع الشبكة قبل أي استجابة: قراءة ⇒ إعادة آمنة (لا أثر جانبي).
  if (status === null) {
    return { retry: true, reason: 'read_network_error', delayMs: computeBackoffDelayMs(attempt, config) };
  }
  if (isPermanentProviderFailure(status, data)) return { retry: false, reason: 'permanent_error', delayMs: 0 };
  if (!isTransientProviderStatus(status)) return { retry: false, reason: 'permanent_error', delayMs: 0 };

  const backoff = computeBackoffDelayMs(attempt, config);
  const retryAfterMs = parseRetryAfterHeader(input.retryAfter, input.nowMs ?? config.now());
  // 429 مع Retry-After: نحترم المدة المطلوبة (بسقف يمنع التعليق)، ولا نقلّ عنها.
  const honored = retryAfterMs === null ? 0 : Math.min(config.maxRetryAfterMs, retryAfterMs);
  return { retry: true, reason: 'read_transient', delayMs: Math.max(backoff, honored) };
}

/** شكل الاستجابة الذي تعتمده الموصلات (`{ ok, status, json }`) — بلا ترويسات. */
export interface ProviderFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
}

export type ProviderFetchImpl = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<ProviderFetchResponse | any>;

/** يقرأ الجسم مرة واحدة (Response يُقرأ مرة واحدة) ويُخزّنه ليعاد استخدامه. */
async function readResponseBody(res: any): Promise<any> {
  if (res && typeof res.json === 'function') {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  return null;
}

function retryAfterOf(res: any): string | null {
  try {
    const h = res?.headers;
    if (h && typeof h.get === 'function') return h.get('retry-after');
  } catch { /* ترويسات غير متاحة ⇒ لا Retry-After */ }
  return null;
}

export interface RetryingFetchOptions {
  config?: ProviderRetryConfig;
  /** سجل اختياري لمحاولات الإعادة (بلا سرّ) — للتشخيص. */
  onRetry?: (info: { attempt: number; status: number | null; reason: string; delayMs: number }) => void;
}

/**
 * يغلّف fetch خاماً بإعادة محاولة آمنة وفق القواعد أعلاه. يُعاد كائن بنفس شكل
 * استجابة الموصل (`{ ok, status, json }`) مع جسم مُخزَّن، فلا يلاحظ العميل الفرق.
 *
 * عند فشل الشبكة في **كتابة**: يُعاد رمي الخطأ كما هو ليلتقطه العميل ويُصنَّف
 * `NETWORK_ERROR` (انقطاع بعد الإرسال ⇒ الحجز يبقى reserved).
 */
export function createRetryingProviderFetch(
  baseFetch: (url: string, init: any) => Promise<any>,
  options: RetryingFetchOptions = {},
): (url: string, init: { method: string; headers?: Record<string, string>; body?: string }) => Promise<ProviderFetchResponse> {
  const config = options.config ?? providerRetryConfig();
  return async (url, init) => {
    const kind = kindForMethod(init?.method);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      let res: any;
      let networkError: unknown = null;
      try {
        // مهلة للقراءة فقط وما لم يمرّر المستدعي إشارة إلغاء خاصة به.
        const useTimeout = kind === 'read' && !(init as any)?.signal && typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function';
        res = await baseFetch(url, useTimeout ? { ...init, signal: (AbortSignal as any).timeout(config.readTimeoutMs) } : init);
      } catch (e) {
        networkError = e;
      }
      if (networkError) {
        const decision = decideProviderRetry({ kind, status: null, attempt, config });
        if (decision.retry) {
          options.onRetry?.({ attempt, status: null, reason: decision.reason, delayMs: decision.delayMs });
          await config.sleep(decision.delayMs);
          continue;
        }
        throw networkError; // كتابة أو استنفاد المحاولات: يُرمى كما هو.
      }
      const status = Number(res?.status);
      const data = await readResponseBody(res);
      const decision = decideProviderRetry({ kind, status: Number.isFinite(status) ? status : null, data, retryAfter: retryAfterOf(res), attempt, config });
      if (!decision.retry) {
        return { ok: Boolean(res?.ok), status: Number.isFinite(status) ? status : 0, json: async () => data };
      }
      options.onRetry?.({ attempt, status, reason: decision.reason, delayMs: decision.delayMs });
      await config.sleep(decision.delayMs);
    }
  };
}
