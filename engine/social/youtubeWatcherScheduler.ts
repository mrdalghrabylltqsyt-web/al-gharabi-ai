/**
 * جدولة الـwatcher — مصدر واحد يضمن مؤقّتاً واحداً فقط.
 *
 * العيب الذي يُصلحه: كان `startYouTubeWatcher` يستدعي `setInterval` عند الإقلاع
 * ويتجاهل أي استدعاء لاحق عبر `if (watcherStartedAt) return`، فلا توجد وسيلة
 * لتغيير الإيقاع أثناء التشغيل دون إعادة إنشاء. مع تغيير الإيقاع من الواجهة
 * يجب أن نُبطل المؤقّت القديم ونُنشئ واحداً جديداً **بلا تكرار**.
 *
 * هذا الملف منطق صافٍ قابل للاختبار: يمتلك المؤقّتات ويضمن عدم تجاوز واحد،
 * ويسجّل كل عملية جدولة/تغيير لأغراض الفحص. لا شبكة ولا أسرار ولا ساعة حقيقية
 * في المنطق نفسه (عدا ما يُمرَّر عبر الدوال).
 */

export interface ScheduledTimer {
  clear(): void;
}

export interface SchedulerHooks {
  /** يُنشئ مؤقّت دوري (setInterval عادةً) ويُعيد مقبضاً قابلاً للإلغاء. */
  setTimer(fn: () => void, ms: number): ScheduledTimer;
  /** يُنشئ مؤقّتاً لمرة واحدة (setTimeout) — لدورة الإقلاع القصيرة. */
  setTimeoutOnce(fn: () => void, ms: number): ScheduledTimer;
  /** يقرأ الإيقاع الحالي (ميلي ثانية). */
  getCadenceMs: () => number;
  /** يقرأ هل الفحص مستحق الآن (isPollDue) قبل تنفيذ الدورة. */
  isDue: () => boolean;
  /** ينفّذ دورة مراقبة واحدة. */
  runCycle: () => void;
  /** أقصى فاصل للتشغيل الحقيقي — لا يزيد عنه المؤقّت وإن كان الإيقاع أكبر. */
  maxTickMs?: number;
  /** مهلة دورة الإقلاع الأولى. */
  bootDelayMs?: number;
}

export interface WatcherScheduler {
  /** يبدأ الجدولة إن لم تكن قائمة. آمن للاستدعاء المتكرر. */
  start(): void;
  /** يُعيد جدولة المؤقّت بالإيقاع الحالي — يُبطل القديم أولاً (لا تكرار). */
  reschedule(): { activeTimers: number; cadenceMs: number };
  /** يُوقف الجدولة كلياً (Kill Switch/إيقاف الخادم) — لا يبقى أي مؤقّت. */
  stop(): void;
  /** حالة الجدولة للتشخيص (بلا سرّ). */
  status(): { active: boolean; activeTimers: number; cadenceMs: number; startedAt: string | null; reschedules: number };
}

/**
 * ينشئ جدولة آمنة بمؤقّت واحد. الضمانات:
 * - `start()` لا يُنشئ مؤقّتاً ثانياً إن كان قائماً.
 * - `reschedule()` يُبطل المؤقّت الحالي **قبل** إنشاء الجديد، فيبقى مؤقّت واحد
 *   حتى لو استُدعي عدة مرات متتالية.
 * - كل دورة تتحقق من `isDue()` فيتجاهل المؤقّت الزائد أي نبضة قبل موعدها.
 */
export function createWatcherScheduler(hooks: SchedulerHooks): WatcherScheduler {
  const maxTickMs = hooks.maxTickMs ?? 60_000;
  const bootDelayMs = hooks.bootDelayMs ?? 15_000;
  let timer: ScheduledTimer | null = null;
  let bootTimer: ScheduledTimer | null = null;
  let startedAt: string | null = null;
  let reschedules = 0;

  const tick = () => {
    if (timer == null) return; // أُوقفت الجدولة — لا تنفّذ.
    if (!hooks.isDue()) return;
    hooks.runCycle();
  };

  const createTimer = () => {
    const cadence = Math.max(1, hooks.getCadenceMs());
    // المؤقّت الخام لا يزيد عن الحد الأعلى (60s) كي تُلتقط تغييرات الإيقاع أكبر من
    // دقيقة في موعدها؛ التحقق الفعلي من الاستحقاق عبر isDue() في كل نبضة.
    timer = hooks.setTimer(tick, Math.min(maxTickMs, cadence));
  };

  const clearTimer = () => {
    if (timer) { try { timer.clear(); } catch { /* تجاهل */ } timer = null; }
  };

  return {
    start() {
      if (startedAt) return;
      startedAt = new Date().toISOString();
      createTimer();
      bootTimer = hooks.setTimeoutOnce(() => { bootTimer = null; tick(); }, bootDelayMs);
    },
    reschedule() {
      // إن لم تكن الجدولة قائمة، نُنشئها؛ وإن كانت قائمة نُبطل المؤقّت القديم أولاً
      // ثم نُنشئ واحداً جديداً — فلا يتجاوز العدد مؤقّتاً واحداً في أي لحظة.
      clearTimer();
      if (!startedAt) startedAt = new Date().toISOString();
      createTimer();
      reschedules += 1;
      return { activeTimers: timer ? 1 : 0, cadenceMs: Math.max(1, hooks.getCadenceMs()) };
    },
    stop() {
      clearTimer();
      if (bootTimer) { try { bootTimer.clear(); } catch { /* تجاهل */ } bootTimer = null; }
      startedAt = null;
    },
    status() {
      return { active: timer != null, activeTimers: timer ? 1 : 0, cadenceMs: Math.max(1, hooks.getCadenceMs()), startedAt, reschedules };
    },
  };
}
