/**
 * جدولة النسخة الاحتياطية الكاملة التلقائية (Recovery Point كل 6 ساعات).
 *
 * منطق صافٍ قابل للاختبار بلا شبكة وبلا ساعة حقيقية: يقرر **هل النسخة مستحقة الآن**
 * انطلاقاً من آخر تشغيل محفوظ (يصمد بعد restart). لا يعتمد على المتصفح ولا على طلب،
 * ولا يُنشئ نسخة عند كل إعادة تشغيل لأن القرار مبني على الزمن المنقضي منذ آخر تشغيل.
 *
 * القاعدة الحاكمة: لا نسخة مكرّرة بلا داعٍ (تتخطّى الدورة إن لم يحل الموعد أو إن كانت
 * نسخة/مزامنة قيد التنفيذ)، ولا نسخة كاذبة (الفشل يُسجَّل فشلاً صريحاً ولا يُعدّ نقطة).
 */

/** الإيقاع الافتراضي: كل 6 ساعات (الطلب المُلزِم). */
export const AUTO_BACKUP_DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** حدّان آمنان: دقيقة على الأقل، ويوم على الأكثر (يُمنع الإيقاع العبثي). */
export const AUTO_BACKUP_MIN_INTERVAL_MS = 60 * 1000;
export const AUTO_BACKUP_MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
/**
 * دورية المؤقّت الداخلي (لا دورية النسخة). المؤقّت ينبض كل 15 دقيقة كحدّ أقصى،
 * ويقرّر `isAutoBackupDue` إن كانت النسخة مستحقة فعلاً. هذا يجعل الجدولة تصمد حتى
 * لو أُعيد تشغيل الخادم قبل انقضاء 6 ساعات (Render)، فلا تفوت النسخة لأن المؤقّت
 * الطويل أُبطل بإعادة التشغيل.
 */
export const AUTO_BACKUP_TICK_MS = 15 * 60 * 1000;
export const AUTO_BACKUP_ENV = 'DR_AUTO_BACKUP_INTERVAL_MS';

/** أنواع المُشغِّل: مجدول، فحص إقلاع، أو يدوي (تشخيص). */
export const AUTO_BACKUP_TRIGGERS = ['scheduled', 'boot', 'manual'] as const;
export type AutoBackupTrigger = (typeof AUTO_BACKUP_TRIGGERS)[number];

/**
 * يحسم الإيقاع من البيئة بحدود آمنة. أي قيمة غائبة/غير رقمية/خارج الحدود تُعاد
 * إلى الافتراضي (6 ساعات) بدل كسر الجدولة — لا إيقاع صفري ولا سلبي.
 */
export function resolveAutoBackupIntervalMs(env: Record<string, string | undefined> = {}): number {
  const raw = env?.[AUTO_BACKUP_ENV];
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return AUTO_BACKUP_DEFAULT_INTERVAL_MS;
  return Math.min(AUTO_BACKUP_MAX_INTERVAL_MS, Math.max(AUTO_BACKUP_MIN_INTERVAL_MS, Math.floor(n)));
}

/** هل حان موعد النسخة؟ لا تشغيل سابق ⇒ مستحقة (أول تشغيل). */
export function isAutoBackupDue(lastRunAtMs: number | null, nowMs: number, intervalMs: number): boolean {
  if (lastRunAtMs == null || !Number.isFinite(lastRunAtMs)) return true;
  if (!Number.isFinite(nowMs)) return false;
  return nowMs - lastRunAtMs >= Math.max(0, intervalMs);
}

/** يقرأ زمن آخر تشغيل من الحالة المحفوظة (ISO) إلى ميلي ثانية، أو null. */
export function parseLastRunAtMs(state: any): number | null {
  const raw = state?.lastRunAt;
  if (!raw) return null;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : null;
}

/** الموعد المتوقّع للتشغيل التالي (ISO)، أو null إن لم يُشغَّل بعد. */
export function nextAutoBackupAtMs(lastRunAtMs: number | null, intervalMs: number): number | null {
  if (lastRunAtMs == null || !Number.isFinite(lastRunAtMs)) return null;
  return lastRunAtMs + Math.max(0, intervalMs);
}

/**
 * لقطة حالة صادقة (بلا سرّ): الإيقاع، آخر تشغيل/نتيجته، آخر نقطة، وعدد التخطّيات.
 * `due` تُحسب من الزمن المنقضي فلا تحتاج تخزيناً.
 */
export function buildAutoBackupStatus(state: any, nowMs: number, intervalMs: number) {
  const lastRunAtMs = parseLastRunAtMs(state);
  const next = nextAutoBackupAtMs(lastRunAtMs, intervalMs);
  return {
    enabled: true,
    intervalMinutes: Math.round(intervalMs / 60000),
    intervalMs,
    lastRunAt: state?.lastRunAt ?? null,
    lastRunResult: state?.lastRunResult ?? null,
    lastRunTrigger: state?.lastRunTrigger ?? null,
    lastRecoveryPointId: state?.lastRecoveryPointId ?? null,
    lastError: state?.lastError ?? null,
    runCount: state?.runCount ?? 0,
    skippedCount: state?.skippedCount ?? 0,
    lastSkippedAt: state?.lastSkippedAt ?? null,
    lastSkippedReason: state?.lastSkippedReason ?? null,
    nextRunAt: next == null ? null : new Date(next).toISOString(),
    due: isAutoBackupDue(lastRunAtMs, nowMs, intervalMs),
  };
}

// -----------------------------------------------------------------------------
// موثوقية النسخة (إصلاح 2026-10-25): توقّفت النسخ 51 ساعة بصمت بعد rp-052.
//
// ثلاث ثغرات أُغلقت هنا (منطق صافٍ):
//  1) تأجيل ضغط الاستهلاك كان بلا سقف ⇒ يُؤجّل كل 15 دقيقة حتى نهاية الشهر.
//     الآن: إن مضى على آخر نسخة **ناجحة** 24 ساعة تُنفَّذ النسخة رغم الضغط.
//  2) بعد الفشل كان الانتظار 6 ساعات كاملة ⇒ الآن إعادة محاولة بعد 30 دقيقة.
//  3) النتائج غير الناجحة بلا `state` (مثل NOT_AUTHORIZED) كانت تُسجَّل بلا خطأ
//     ⇒ الآن تُطبَّع إلى فشل صريح مع الكود، ويُقاس عمر آخر نسخة ناجحة للتنبيه.
// -----------------------------------------------------------------------------

/** إعادة المحاولة بعد تشغيل فاشل (لا انتظار 6 ساعات بعد الفشل). */
export const AUTO_BACKUP_FAILURE_RETRY_MS = 30 * 60 * 1000;
/** أقصى عمر لآخر نسخة ناجحة قبل تجاوز تأجيل ضغط الاستهلاك. */
export const AUTO_BACKUP_MAX_DEFER_MS = 24 * 60 * 60 * 1000;
/** عتبتا التنبيه على عمر آخر نسخة ناجحة. */
export const BACKUP_STALE_WARNING_MS = 12 * 60 * 60 * 1000;
export const BACKUP_STALE_CRITICAL_MS = 24 * 60 * 60 * 1000;

const SUCCESS_STATES = new Set(['backed_up', 'no_change']);

/** هل النتيجة المحفوظة نجاح (نسخة جديدة أو بلا تغيير منذ آخر نسخة)؟ */
export function isSuccessfulBackupResult(state: unknown): boolean {
  return SUCCESS_STATES.has(String(state ?? ''));
}

/**
 * يطبّع نتيجة `runFullBackup` إلى حالة صريحة: نجاح بحالته، أو فشل بكوده. الردود
 * المبكرة (NOT_AUTHORIZED / DRIVE_CLIENT_UNAVAILABLE / SOURCE_INCOMPLETE / ...)
 * لا تحمل `state` وكانت تُسجَّل كـ«undefined» بلا خطأ.
 */
export function normalizeBackupOutcome(body: any): { state: string; recoveryPointId: string | null; reason: string | null } {
  const state = typeof body?.state === 'string' && body.state ? body.state : (body?.success === true ? 'backed_up' : 'failed');
  const reasonRaw = body?.reason ?? body?.code ?? (isSuccessfulBackupResult(state) ? null : 'backup_failed');
  return {
    state,
    recoveryPointId: body?.recoveryPointId ?? null,
    reason: reasonRaw == null ? null : String(reasonRaw).slice(0, 120),
  };
}

/** وقت آخر نسخة ناجحة (ms) — من الحقل الجديد، أو من آخر تشغيل إن كان ناجحاً. */
export function parseLastSuccessAtMs(state: any): number | null {
  const raw = state?.lastSuccessAt ?? (isSuccessfulBackupResult(state?.lastRunResult) ? state?.lastRunAt : null);
  if (!raw) return null;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : null;
}

export type AutoBackupDecisionReason = 'not_due' | 'pressure_defer' | 'due' | 'retry_after_failure' | 'forced_stale';

/**
 * قرار التشغيل الموحّد: الاستحقاق (6 ساعات، أو 30 دقيقة بعد فشل) ثم الضغط (يُؤجّل
 * المجدول فقط، وبسقف 24 ساعة منذ آخر نجاح). اليدوي والإقلاع لا يُؤجَّلان بالضغط.
 */
export function decideAutoBackupRun(input: {
  state: any; nowMs: number; intervalMs: number; trigger: string; pressureDefer: boolean;
  retryMs?: number; maxDeferMs?: number;
}): { run: boolean; reason: AutoBackupDecisionReason } {
  const retryMs = input.retryMs ?? AUTO_BACKUP_FAILURE_RETRY_MS;
  const maxDeferMs = input.maxDeferMs ?? AUTO_BACKUP_MAX_DEFER_MS;
  const lastRun = parseLastRunAtMs(input.state);
  const lastFailed = lastRun != null && input.state?.lastRunResult != null && !isSuccessfulBackupResult(input.state?.lastRunResult);
  const regularDue = isAutoBackupDue(lastRun, input.nowMs, input.intervalMs);
  const retryDue = lastFailed && lastRun != null && input.nowMs - lastRun >= retryMs;
  if (!regularDue && !retryDue) return { run: false, reason: 'not_due' };
  if (input.trigger === 'scheduled' && input.pressureDefer) {
    const lastSuccess = parseLastSuccessAtMs(input.state);
    const age = lastSuccess == null ? Number.POSITIVE_INFINITY : input.nowMs - lastSuccess;
    if (age < maxDeferMs) return { run: false, reason: 'pressure_defer' };
    return { run: true, reason: 'forced_stale' };
  }
  return { run: true, reason: lastFailed ? 'retry_after_failure' : 'due' };
}

/** حداثة آخر نسخة ناجحة: ok (< 12 س) · warning (12–24 س) · critical (> 24 س أو لا نسخة معروفة). */
export function backupFreshness(state: any, nowMs: number): {
  level: 'ok' | 'warning' | 'critical'; lastSuccessAt: string | null; ageHours: number | null;
  lastError: string | null; lastSkippedReason: string | null;
} {
  const t = parseLastSuccessAtMs(state);
  const ageMs = t == null ? null : Math.max(0, nowMs - t);
  const level = ageMs == null || ageMs >= BACKUP_STALE_CRITICAL_MS ? 'critical' : ageMs >= BACKUP_STALE_WARNING_MS ? 'warning' : 'ok';
  return {
    level,
    lastSuccessAt: t == null ? null : new Date(t).toISOString(),
    ageHours: ageMs == null ? null : Math.round((ageMs / 3_600_000) * 10) / 10,
    lastError: state?.lastError ?? null,
    lastSkippedReason: state?.lastSkippedReason ?? null,
  };
}
