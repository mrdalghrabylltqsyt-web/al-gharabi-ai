/**
 * سياسة إعادة المحاولة والتأخير التصاعدي وقاطع الدائرة.
 *
 * قواعد ثابتة في هذا المشروع:
 * - لا إعادة محاولة على خطأ دائم (مفتاح خاطئ، طلب غير صالح، موديل غير موجود).
 * - عدد محاولات محدود جداً لأن كل محاولة تستهلك حصة المزود.
 * - تأخير تصاعدي مع عشوائية (jitter) لتفادي تصادم الطلبات المتزامنة.
 * - قاطع دائرة يمنع إغراق مزود متعطل، ويعيد المحاولة بعد فترة تعافٍ قصيرة.
 */

import { classifyAiError, type AiErrorInfo } from './errors';

export interface RetryPolicy {
  /** أقصى عدد محاولات (يشمل المحاولة الأولى). */
  maxAttempts: number;
  /** التأخير الأساسي بالمللي ثانية. */
  baseDelayMs: number;
  /** سقف التأخير بالمللي ثانية. */
  maxDelayMs: number;
  /** معامل النمو للـ exponential backoff. */
  factor: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 400,
  maxDelayMs: 4_000,
  factor: 2,
};

export interface AttemptRecord {
  attempt: number;
  error: AiErrorInfo;
}

export interface RetryOutcome<T> {
  ok: boolean;
  value?: T;
  error?: AiErrorInfo;
  attempts: number;
  /** كل الأخطاء بالترتيب، للتشخيص الآمن. */
  errors: AttemptRecord[];
}

/** يحسب التأخير التصاعدي مع عشوائية. دالة نقية قابلة للاختبار عبر حقن random. */
export function computeBackoffDelay(attempt: number, policy: RetryPolicy, random: () => number = Math.random): number {
  const raw = policy.baseDelayMs * Math.pow(policy.factor, Math.max(0, attempt - 1));
  const capped = Math.min(raw, policy.maxDelayMs);
  // jitter بنسبة ±25% لتفادي تزامن الطلبات.
  const jitter = capped * 0.25 * (random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * ينفذ عملية مع إعادة محاولة ذكية.
 * `sleep` قابل للحقن حتى لا تنتظر الاختبارات فعلياً.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    policy?: Partial<RetryPolicy>;
    model?: string;
    /** يُنادى بعد كل فشل، مفيد للتسجيل الآمن. */
    onRetry?: (record: AttemptRecord, delayMs: number) => void;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
    /** يوقف المحاولات مبكراً (مثلاً عند نفاد الحصة المحلية). */
    shouldRetry?: (info: AiErrorInfo, attempt: number) => boolean;
  } = {},
): Promise<RetryOutcome<T>> {
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...(options.policy || {}) };
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;
  const errors: AttemptRecord[] = [];

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      const value = await operation(attempt);
      return { ok: true, value, attempts: attempt, errors };
    } catch (err) {
      const info = classifyAiError(err, options.model);
      errors.push({ attempt, error: info });

      const isLast = attempt >= policy.maxAttempts;
      const extraAllowed = options.shouldRetry ? options.shouldRetry(info, attempt) : true;
      if (!info.retryable || isLast || !extraAllowed) {
        return { ok: false, error: info, attempts: attempt, errors };
      }

      const delay = computeBackoffDelay(attempt, policy, random);
      options.onRetry?.({ attempt, error: info }, delay);
      await sleep(delay);
    }
  }

  // لا يُوصل إليها منطقياً، لكنها تعيد آخر خطأ بدل الرمي.
  return { ok: false, error: errors[errors.length - 1]?.error, attempts: policy.maxAttempts, errors };
}

/** قاطع دائرة بسيط: يفتح بعد عدد محدد من الأخطاء القابلة لإعادة المحاولة. */
export class CircuitBreaker {
  /** علم صريح بدل الاعتماد على قيمة 0 كمؤشر، لأن الطابع الزمني قد يكون صفراً. */
  private open = false;
  private openedAt = 0;
  private failures = 0;

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 60_000,
  ) {}

  isOpen(now = Date.now()): boolean {
    if (!this.open) return false;
    if (now - this.openedAt >= this.cooldownMs) {
      // انتهت فترة التهدئة: يُسمح بمحاولة استكشاف واحدة.
      this.open = false;
      this.openedAt = 0;
      this.failures = 0;
      return false;
    }
    return true;
  }

  recordFailure(now = Date.now()): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.open = true;
      this.openedAt = now;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.open = false;
    this.openedAt = 0;
  }

  snapshot(now = Date.now()) {
    return { open: this.isOpen(now), failures: this.failures, cooldownMs: this.cooldownMs };
  }
}
