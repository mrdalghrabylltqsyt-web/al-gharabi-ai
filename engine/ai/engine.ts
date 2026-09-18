/**
 * محرك الذكاء الاصطناعي المركزي.
 *
 * ترتيب المعالجة الثابت في هذا المشروع:
 *   Provider → Guard → Timeout → Retry → Cache → Fallback → نتيجة آمنة
 *
 * المبادئ:
 * - كل عملية قابلة للتنفيذ حتمياً لا تصل إلى المزود إطلاقاً.
 * - لا يفشل الطلب أبداً بسبب تعطل المزود: يُعاد دائماً بديل حتمي آمن.
 * - المفتاح والتوكنات تبقى على الخادم ولا تظهر في أي استجابة.
 * - الطلبات المتزامنة المتطابقة تُدمج في تنفيذ واحد (in-flight dedup).
 *
 * المحرك لا يعتمد على express ولا على @google/genai مباشرة، بل على واجهة
 * `AiProvider` محقونة، ما يجعل الاختبار حتمياً بدون شبكة.
 */

import { classifyAiError, diagnosticLabel, type AiErrorInfo } from './errors';
import { CircuitBreaker, withRetry, type RetryPolicy } from './retry';

export interface AiProvider {
  /** اسم المزود للتشخيص الآمن (بدون مفاتيح). */
  readonly name: string;
  /** ينفذ توليد نص. يجب أن يرمي خطأ عند الفشل. */
  generate(input: { model: string; prompt: string; json?: boolean; signal?: AbortSignal }): Promise<string>;
}

export interface AiUsageGuard {
  /** هل يُسمح باستهلاك طلب واحد الآن؟ */
  canConsume(): boolean;
  /** يحجز طلباً واحداً؛ يعيد false إذا نفدت الحصة. */
  consume(): boolean;
  /** يعيد الحجز عند فشل الطلب حتى لا تُحسب محاولة فاشلة على الحصة. */
  release(): void;
  /** حالة الحارس للتشخيص. */
  status(): { usedToday: number; limit: number; remaining: number; enabled: boolean };
}

export interface AiCacheEntry {
  value: string;
  expiresAt: number;
}

export interface AiEngineOptions {
  provider: AiProvider | null;
  guard: AiUsageGuard;
  models: string[];
  cache?: Map<string, AiCacheEntry>;
  cacheTtlMs?: number;
  timeoutMs?: number;
  policy?: Partial<RetryPolicy>;
  breaker?: CircuitBreaker;
  /** سجل تشخيص آمن: لا يحتوي أي مفتاح أو توكن أو جسم طلب كامل. */
  onEvent?: (event: { type: string; detail: string }) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export type AiSource = 'provider' | 'cache' | 'fallback' | 'deterministic' | 'breaker';

export interface AiResult {
  text: string;
  source: AiSource;
  model: string | null;
  /** هل النص ناتج عن مزود ذكاء اصطناعي فعلي؟ */
  usedProvider: boolean;
  /** رسالة آمنة تُعرض للمستخدم عند استخدام البديل. */
  notice?: string;
  attempts: number;
  errorKind?: string;
  cacheKey?: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * تنفيذ الطلب عبر مزود مع مهلة صريحة.
 * المهلة تُنفَّذ عبر AbortController حتى لا يبقى الطلب معلقاً بلا نهاية.
 */
async function generateWithTimeout(
  provider: AiProvider,
  model: string,
  prompt: string,
  json: boolean,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    // لا نستخدم unref هنا: المؤقت قصير العمر ويُنظَّف في finally، وإلغاء
    // تتبعه كان يسمح للعملية بالخروج قبل إتمام المهلة.
    timer = setTimeout(() => {
      controller.abort();
      const err: any = new Error('AI request timed out');
      err.name = 'TimeoutError';
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      provider.generate({ model, prompt, json, signal: controller.signal }),
      timeoutPromise,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class AiEngine {
  private readonly provider: AiProvider | null;
  private readonly guard: AiUsageGuard;
  private readonly models: string[];
  private readonly cache: Map<string, AiCacheEntry>;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly policy: Partial<RetryPolicy>;
  private readonly breaker: CircuitBreaker;
  private readonly onEvent: (event: { type: string; detail: string }) => void;
  private readonly now: () => number;
  private readonly sleep?: (ms: number) => Promise<void>;
  private readonly random?: () => number;
  /** دمج الطلبات المتزامنة المتطابقة في تنفيذ واحد. */
  private readonly inFlight = new Map<string, Promise<AiResult>>();

  constructor(options: AiEngineOptions) {
    this.provider = options.provider;
    this.guard = options.guard;
    this.models = options.models.length ? options.models : ['gemini-2.5-flash'];
    this.cache = options.cache ?? new Map();
    this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60 * 1000;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.policy = options.policy ?? {};
    this.breaker = options.breaker ?? new CircuitBreaker();
    this.onEvent = options.onEvent ?? (() => {});
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep;
    this.random = options.random;
  }

  /** هل المزود مهيأ؟ (وجود مفتاح صالح على الخادم) */
  get providerConfigured(): boolean {
    return Boolean(this.provider);
  }

  private cached(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  private store(key: string, value: string): void {
    this.cache.set(key, { value, expiresAt: this.now() + this.cacheTtlMs });
  }

  /** يزيل المدخلات المنتهية؛ يُنادى من منظف الحالة الدوري. */
  pruneCache(): void {
    const now = this.now();
    for (const [key, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(key);
  }

  /** عدد المدخلات المخزنة حالياً، للتشخيص الآمن. */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** حالة قاطع الدائرة للتشخيص. */
  breakerStatus() {
    return this.breaker.snapshot(this.now());
  }

  /**
   * تنفيذ طلب ذكاء اصطناعي.
   * `deterministicFallback` يُستخدم عند تعذر المزود أو نفاد الحصة أو فتح القاطع.
   */
  async run(input: {
    /** مفتاح التخزين المؤقت: يجب أن يمثل المدخلات بدقة. */
    cacheKey: string;
    prompt: string;
    json?: boolean;
    /** بديل حتمي آمن — لا يعتمد على أي خدمة خارجية. */
    deterministicFallback: () => string;
  }): Promise<AiResult> {
    const { cacheKey, prompt, json, deterministicFallback } = input;

    // 1) التخزين المؤقت: لا يستهلك حصة ولا يلمس الشبكة.
    const hit = this.cached(cacheKey);
    if (hit !== null) {
      this.onEvent({ type: 'cache_hit', detail: cacheKey });
      return { text: hit, source: 'cache', model: null, usedProvider: false, attempts: 0, cacheKey };
    }

    // 2) دمج الطلبات المتزامنة المتطابقة.
    const running = this.inFlight.get(cacheKey);
    if (running) {
      this.onEvent({ type: 'in_flight_join', detail: cacheKey });
      return running;
    }

    const task = this.execute({ cacheKey, prompt, json, deterministicFallback })
      .finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, task);
    return task;
  }

  private async execute(input: {
    cacheKey: string;
    prompt: string;
    json?: boolean;
    deterministicFallback: () => string;
  }): Promise<AiResult> {
    const { cacheKey, prompt, json, deterministicFallback } = input;
    const fallbackResult = (notice: string, errorKind?: string, attempts = 0): AiResult => ({
      text: deterministicFallback(),
      source: 'fallback',
      model: null,
      usedProvider: false,
      notice,
      attempts,
      errorKind,
      cacheKey,
    });

    // 3) لا مزود مهيأ → تنفيذ حتمي فوري بدون أي استهلاك.
    if (!this.provider) {
      this.onEvent({ type: 'provider_absent', detail: cacheKey });
      return fallbackResult('محرك الذكاء الاصطناعي غير مهيأ على الخادم؛ تم استخدام المحرك المحلي الحتمي.');
    }

    // 4) قاطع الدائرة مفتوح → لا نغرق مزوداً متعطلاً.
    if (this.breaker.isOpen(this.now())) {
      this.onEvent({ type: 'breaker_open', detail: cacheKey });
      return fallbackResult('مزود الذكاء الاصطناعي في فترة تعافٍ مؤقتة؛ تم استخدام المحرك المحلي الحتمي.', 'unavailable');
    }

    // 5) الحارس: لا استهلاك بدون رصيد.
    if (!this.guard.canConsume() || !this.guard.consume()) {
      this.onEvent({ type: 'guard_blocked', detail: cacheKey });
      return fallbackResult('تم بلوغ حد الحماية اليومي المحلي للذكاء الاصطناعي؛ تم استخدام المحرك المحلي الحتمي.', 'rate_limited');
    }

    let consumed = true;
    const releaseSlot = () => {
      if (consumed) {
        this.guard.release();
        consumed = false;
      }
    };

    try {
      const outcome = await withRetry<string>(
        async () => {
          // نجرّب كل موديل مرشح بالتتابع: خطأ "غير موجود" ينتقل للموديل التالي،
          // وخطأ الضغط يُعاد عليه بنفس الموديل عبر withRetry.
          let lastError: any = null;
          for (const model of this.models) {
            try {
              const text = await generateWithTimeout(this.provider as AiProvider, model, prompt, Boolean(json), this.timeoutMs);
              const trimmed = (text || '').trim();
              if (!trimmed) throw new Error('empty response from provider');
              return trimmed;
            } catch (err) {
              lastError = err;
              const info = classifyAiError(err, model);
              this.onEvent({ type: 'model_failed', detail: diagnosticLabel(info) });
              // خطأ الموديل غير الموجود أو الطلب غير الصالح: جرّب الموديل التالي.
              if (info.kind === 'not_found' || info.kind === 'invalid_request') continue;
              throw err;
            }
          }
          throw lastError ?? new Error('no model candidate succeeded');
        },
        {
          policy: this.policy,
          sleep: this.sleep,
          random: this.random,
          onRetry: (record, delay) => {
            this.onEvent({ type: 'retry', detail: `${diagnosticLabel(record.error)}:attempt=${record.attempt}:delay=${delay}` });
          },
        },
      );

      if (!outcome.ok || !outcome.value) {
        const info = outcome.error;
        this.breaker.recordFailure(this.now());
        releaseSlot();
        this.onEvent({ type: 'provider_failed', detail: info ? diagnosticLabel(info) : 'unknown' });
        return fallbackResult(
          info?.safeMessage || 'تعذر إكمال طلب الذكاء الاصطناعي؛ تم استخدام المحرك المحلي.',
          info?.kind,
          outcome.attempts,
        );
      }

      this.breaker.recordSuccess();
      this.store(cacheKey, outcome.value);
      this.onEvent({ type: 'provider_ok', detail: `attempts=${outcome.attempts}` });
      return {
        text: outcome.value,
        source: 'provider',
        model: null,
        usedProvider: true,
        attempts: outcome.attempts,
        cacheKey,
      };
    } catch (err) {
      // شبكة أمان أخيرة: أي خطأ غير متوقع لا يجب أن يُسقط الطلب.
      const info: AiErrorInfo = classifyAiError(err);
      this.breaker.recordFailure(this.now());
      releaseSlot();
      this.onEvent({ type: 'engine_error', detail: diagnosticLabel(info) });
      return fallbackResult(info.safeMessage, info.kind);
    } finally {
      // إن نجح الطلب فلا نُعيد الحجز؛ وإن فشل فقد أُعيد أعلاه.
      if (!consumed) {
        // لا شيء: الحجز أُعيد بالفعل.
      }
    }
  }
}
