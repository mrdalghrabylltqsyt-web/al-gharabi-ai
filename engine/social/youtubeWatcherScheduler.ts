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
  /** فاصل نبضات الحارس (watchdog) التي تتأكد أن المؤقّت ما زال حياً. */
  watchdogMs?: number;
  /** عتبة «الجمود»: إن مرّت هذه المدة بلا نبضة مؤقّت، يُعاد إنشاء المؤقّت. */
  stallMs?: number;
  /** مصدر الزمن (للاختبار) — افتراضياً Date.now. */
  nowMs?: () => number;
  /** يُنادى عند فشل متزامن داخل نبضة (لا يخرج استثناء ليصبح uncaughtException). */
  onTickError?: (error: unknown) => void;
  /** يُنادى عند إصلاح ذاتي (إعادة إنشاء المؤقّت بعد فقدانه). */
  onSelfHeal?: (info: { watchdogChecks: number }) => void;
}

export interface WatcherScheduler {
  /** يبدأ الجدولة إن لم تكن قائمة. آمن للاستدعاء المتكرر. */
  start(): void;
  /** يُعيد جدولة المؤقّت بالإيقاع الحالي — يُبطل القديم أولاً (لا تكرار). */
  reschedule(): { activeTimers: number; cadenceMs: number };
  /** يُوقف الجدولة كلياً (Kill Switch/إيقاف الخادم) — لا يبقى أي مؤقّت. */
  stop(): void;
  /** ينفّذ نبضة الآن (للدورة اليدوية + الاختبار) — محصّن من الاستثناءات. */
  tickNow(): void;
  /** حالة الجدولة للتشخيص (بلا سرّ). */
  status(): { active: boolean; activeTimers: number; cadenceMs: number; startedAt: string | null; lastTickMs: number | null; reschedules: number; watchdogChecks: number; selfHeals: number; tickErrors: number; lastError: string | null };
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
  const watchdogMs = hooks.watchdogMs ?? Math.max(60_000, maxTickMs);
  const nowMs = hooks.nowMs ?? (() => Date.now());
  const stallMs = hooks.stallMs ?? 10 * 60_000;
  let timer: ScheduledTimer | null = null;
  let bootTimer: ScheduledTimer | null = null;
  let watchdog: ScheduledTimer | null = null;
  let startedAt: string | null = null;
  let lastTickMs = 0;
  let reschedules = 0;
  let watchdogChecks = 0;
  let selfHeals = 0;
  let tickErrors = 0;
  let lastError: string | null = null;

  const safeRun = () => {
    lastTickMs = nowMs();
    try { hooks.runCycle(); } catch (error: unknown) {
      // دورة فاشلة لا توقف الجدولة ولا تخرج كـuncaughtException.
      tickErrors += 1;
      // بلا نص الخطأ أبداً (قد يحمل محتوى) — رمز نوع فقط.
      lastError = String((error as any)?.code || (error as any)?.name || 'tick_error').slice(0, 60);
      try { hooks.onTickError?.(error); } catch { /* التنبيه لا يُسقط النبضة */ }
    }
  };

  const tick = () => {
    if (timer == null) return; // أُوقفت الجدولة — لا تنفّذ.
    if (!hooks.isDue()) { lastTickMs = nowMs(); return; }
    safeRun();
  };

  const createTimer = () => {
    const cadence = Math.max(1, hooks.getCadenceMs());
    // المؤقّت الخام لا يزيد عن الحد الأعلى (60s) كي تُلتقط تغييرات الإيقاع أكبر من
    // دقيقة في موعدها؛ التحقق الفعلي من الاستحقاق عبر isDue() في كل نبضة.
    timer = hooks.setTimer(tick, Math.min(maxTickMs, cadence));
    lastTickMs = nowMs();
  };

  const clearTimer = () => {
    if (timer) { try { timer.clear(); } catch { /* تجاهل */ } timer = null; }
  };

  // الحارس (watchdog): يكشف **الجمود الصامت** — إن مضت مدة الجمود بلا نبضة مؤقّت
  // بينما الجدولة مُفترض أن تكون نشطة، فهذا يعني أن المؤقّت توقّف (لم يُستدعَ)
  // فيُعاد إنشاؤه من جديد — إصلاح ذاتي بلا تدخّل وبلا كشف أي محتوى عميل.
  const watchdogTick = () => {
    watchdogChecks += 1;
    if (!startedAt) return; // متوقّفة عن قصد (Kill Switch) — لا إصلاح.
    if (timer != null && nowMs() - lastTickMs < stallMs) return; // سليمة وتنبض.
    // المؤقّت توقّف فعلاً (أو فُقد): أعِد إنشاءه — إصلاح ذاتي.
    clearTimer();
    createTimer();
    selfHeals += 1;
    lastError = 'timer_stalled_self_healed';
    try { hooks.onSelfHeal?.({ watchdogChecks }); } catch { /* لا يُسقط الحارس */ }
  };

  const clearWatchdog = () => { if (watchdog) { try { watchdog.clear(); } catch { /* تجاهل */ } watchdog = null; } };

  return {
    start() {
      if (startedAt) return;
      startedAt = new Date().toISOString();
      createTimer();
      bootTimer = hooks.setTimeoutOnce(() => { bootTimer = null; tick(); }, bootDelayMs);
      clearWatchdog();
      watchdog = hooks.setTimer(watchdogTick, watchdogMs);
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
      clearWatchdog();
      if (bootTimer) { try { bootTimer.clear(); } catch { /* تجاهل */ } bootTimer = null; }
      startedAt = null;
    },
    tickNow() { safeRun(); },
    status() {
      return { active: timer != null, activeTimers: timer ? 1 : 0, cadenceMs: Math.max(1, hooks.getCadenceMs()), startedAt, lastTickMs: lastTickMs || null, reschedules, watchdogChecks, selfHeals, tickErrors, lastError };
    },
  };
}
