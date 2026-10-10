/**
 * جدولة انتظار جاهزية حاوية الوسائط (Instagram/Threads) — منطق خالص قابل للاختبار.
 *
 * الجذر المُثبت لعطل `CONTAINER_TIMEOUT`: كانت الحلقة تنتظر بـ8 محاولات بنفس
 * الفاصل (3s) = 24 ثانية إجمالاً، وهو غير كافٍ لمعالجة فيديو/ريل لدى Meta (قد
 * يتجاوز الدقيقة عند الملفات الكبيرة). النتيجة: فشل مبكر رغم أن الحاوية ستجهز.
 *
 * الحل: تراجع أسّي (exponential backoff) مع تأخير أوّلي، فيمتد الاحتياط الزمني
 * دون إغراق المزود بطلبات سريعة: `delay(i) = min(minDelay * base^i, maxDelay)`.
 * كل الحدود قابلة للضبط من البيئة، والقيم الافتراضية محسوبة لتمنح احتياطاً
 * واقعياً (~دقيقتان) مع بقاء عدد الطلبات معتدلاً.
 */

export interface ContainerPollConfig {
  /** أقصى عدد محاولات قراءة الحالة (بعد كل تأخير). */
  maxAttempts: number;
  /** التأخير الأولي بين المحاولات (ms). */
  initialDelayMs: number;
  /** أقصى تأخير لمحاولة واحدة (ms). */
  maxDelayMs: number;
  /** أساس التراجع الأسّي. */
  backoffBase: number;
}

/** الافتراضي الواقعي: ~دقيقتان إجمالاً في ~11 محاولة معتدلة. */
export const DEFAULT_CONTAINER_POLL: ContainerPollConfig = Object.freeze({
  maxAttempts: 11,
  initialDelayMs: 2500,
  maxDelayMs: 20000,
  backoffBase: 1.5,
});

function readInt(env: NodeJS.ProcessEnv | Record<string, string | undefined>, key: string, fallback: number, min: number, max: number): number {
  const raw = Number(env?.[key]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

/** يقرأ إعداد الانتظار من البيئة بحدود آمنة (بلا قيمة صفرية = حلقة بلا فاصل). */
export function resolveContainerPollConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): ContainerPollConfig {
  const maxAttempts = readInt(env, "CONTAINER_POLL_MAX_ATTEMPTS", DEFAULT_CONTAINER_POLL.maxAttempts, 1, 60);
  const initialDelayMs = readInt(env, "CONTAINER_POLL_INITIAL_MS", DEFAULT_CONTAINER_POLL.initialDelayMs, 0, 60000);
  // الحد الأقصى لا يقلّ عن التأخير الأولي (منع انقلاب).
  const maxDelayMs = Math.max(initialDelayMs, readInt(env, "CONTAINER_POLL_MAX_MS", DEFAULT_CONTAINER_POLL.maxDelayMs, 0, 120000));
  const backoffBase = (() => {
    const raw = Number(env?.["CONTAINER_POLL_BACKOFF_BASE"]);
    if (!Number.isFinite(raw)) return DEFAULT_CONTAINER_POLL.backoffBase;
    return Math.min(4, Math.max(1, raw));
  })();
  return { maxAttempts, initialDelayMs, maxDelayMs, backoffBase };
}

/** تأخير المحاولة رقم `attempt` (0-based). attempt=0 بلا انتظار قبل القراءة الأولى. */
export function containerPollDelayMs(attempt: number, cfg: ContainerPollConfig): number {
  if (attempt <= 0) return 0;
  const raw = cfg.initialDelayMs * Math.pow(cfg.backoffBase, attempt - 1);
  return Math.min(cfg.maxDelayMs, Math.max(0, Math.round(raw)));
}

/** الميزانية الزمنية الإجمالية المتوقعة (ms) — تُعلن للمالك بلا تخمين. */
export function containerPollBudgetMs(cfg: ContainerPollConfig): number {
  let total = 0;
  for (let i = 0; i < cfg.maxAttempts; i++) total += containerPollDelayMs(i, cfg);
  return total;
}
