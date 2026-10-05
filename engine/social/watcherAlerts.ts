/**
 * منطق تنبيهات مراقب YouTube — قرار حتمي قابل للاختبار (بلا شبكة/أسرار).
 *
 * المشكلة: `watcherState.consecutiveErrors` يُزاد فعلاً عند كل فشل دورة، لكن لا
 * تنبيه للمالك إطلاقاً. فلو انقطع توكن Google (`reauth_needed`) أو تكرر الفشل
 * بينما المتصفح مغلق، يتوقف الرد الآلي صامتاً بلا علم المالك.
 *
 * الحل: قرار حتمي — متى نُنبّه، وبأي نص، ومتى نمنع التكرار. الإرسال نفسه عبر
 * `pushNotification(...)` الموجودة في الخادم؛ هذا الملف لا يُرسل شيئاً.
 *
 * منع الإغراق (idempotent): تنبيه واحد لكل «سلسلة فشل» (يُرفع العلم عند التنبيه،
 * ويُصفَّر عند أول دورة ناجحة)، وتنبيه واحد لحالة `reauth_needed` (يُصفَّر عند
 * استعادة الاتصال).
 */

export const WATCHER_ERROR_ALERT_THRESHOLD_ENV = 'YOUTUBE_WATCHER_ERROR_ALERT_THRESHOLD';

/**
 * عتبة التنبيه الافتراضية: 3 أخطاء متتالية.
 *
 * المبرَّر: دورة المراقبة الافتراضية كل دقيقة (تُضبط بين 1 و5 دقائق).
 *   - فشل واحد أو اثنان = اضطراب شبكي/مزود عابر لا يستحق إزعاج المالك.
 *   - 3 أخطاء متتالية = ≈3 دقائق بالحد الأدنى و≈15 دقيقة بالحد الأعلى — مدة كافية
 *     لاستبعاد العابر، وقصيرة كفاية ليعلم المالك قبل تفاقم توقف الرد الآلي.
 */
export const WATCHER_ERROR_ALERT_THRESHOLD_DEFAULT = 3;

/** الحدّ الأدنى (لا تنبيه عند أول فشل) والأعلى (لا إغراق). */
export const WATCHER_ERROR_ALERT_THRESHOLD_MIN = 2;
export const WATCHER_ERROR_ALERT_THRESHOLD_MAX = 20;

/** يحسم عتبة التنبيه من البيئة (افتراضياً 3، مقصوصة بين 2 و20). */
export function resolveWatcherErrorAlertThreshold(env: Record<string, string | undefined> = {}): number {
  const raw = env[WATCHER_ERROR_ALERT_THRESHOLD_ENV];
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return WATCHER_ERROR_ALERT_THRESHOLD_DEFAULT;
  return Math.min(WATCHER_ERROR_ALERT_THRESHOLD_MAX, Math.max(WATCHER_ERROR_ALERT_THRESHOLD_MIN, Math.floor(n)));
}

/** حالة أعلام التنبيه المحفوظة (تصمد بعد restart) — منع تكرار التنبيه لنفس السلسلة. */
export interface WatcherAlertFlags {
  /** أُرسل تنبيه سلسلة الفشل الحالية؟ (يُصفَّر عند أول دورة ناجحة). */
  errorAlerted: boolean;
  /** أُرسل تنبيه reauth_needed الحالي؟ (يُصفَّر عند استعادة الاتصال). */
  reauthAlerted: boolean;
}

/** هل نُنبّه الآن على فشل متكرر؟ (مرة واحدة لكل سلسلة فشل). */
export function shouldAlertWatcherFailure(input: { consecutiveErrors: number; errorAlerted: boolean; threshold: number }): boolean {
  if (input.errorAlerted) return false;
  return input.consecutiveErrors >= input.threshold;
}

/** هل نُنبّه الآن على reauth_needed؟ (مرة واحدة حتى استعادة الاتصال). */
export function shouldAlertReauth(input: { reauthAlerted: boolean }): boolean {
  return !input.reauthAlerted;
}

/** نص التنبيه عند تكرار الفشل — بلا أي سرّ وبلا محتوى عميل (رسالة عامة). */
export function watcherFailureAlertText(input: { consecutiveErrors: number; lastError: string | null; cadenceMinutes: number; threshold: number }): { title: string; body: string } {
  const err = String(input.lastError || 'unknown').slice(0, 60);
  return {
    title: 'توقّف متكرر في مراقبة YouTube',
    body: `فشلت ${input.consecutiveErrors} دورات مراقبة متتالية (العتبة ${input.threshold}، الفاصل ${input.cadenceMinutes} دقيقة). آخر رمز خطأ: ${err}. قد يتوقف الرد الآلي — راجع حالة الاتصال من مركز تشغيل YouTube.`,
  };
}

/** نص التنبيه عند الحاجة لإعادة ربط YouTube — رسالة عامة بلا سرّ. */
export function reauthAlertText(input: { accountName?: string | null }): { title: string; body: string } {
  return {
    title: 'إعادة ربط YouTube مطلوبة',
    body: `انتهت صلاحية اعتماد Google أو رُفض تجديد الرمز${input.accountName ? ` لقناة ${input.accountName}` : ''}. توقف الرد الآلي على YouTube حتى تُعيد الربط من مركز ربط المنصات.`,
  };
}
