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
