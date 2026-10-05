/**
 * سقف دفاعي لخرائط النوافذ المفتاحية (محاولات الدخول/رموز التحقق) — منطق صافٍ
 * قابل للاختبار. مفاتيح هذه الخرائط من مدخلات خارجية (بريد/IP)، وتُقلّم دورياً،
 * لكنها تبقى قابلة للنمو بين التقليمين. عند بلوغ السقف نُزيل المنتهية أولاً ثم
 * الأقدم، فلا ينمو الاستهلاك بلا حدود ولا يُحجب مستخدم نشط إلا نظرياً.
 */

/** أقصى عدد مفاتيح في نافذة واحدة (مثل سقف الجلسات). */
export const RATE_WINDOW_MAX_KEYS = 5000;
/** عمر النافذة قبل اعتبارها منتهية (15 دقيقة، مطابق لحد المحاولات). */
export const RATE_WINDOW_TTL_MS = 15 * 60 * 1000;

/**
 * يفرض السقف على خريطة نوافذ (`key -> { startedAt }`) **دون استبدال مرجعها**.
 * الإزالة بترتيب الإدراج (الأقدم أولاً) بعد إسقاط المنتهية. لا يرمي.
 */
export function enforceRateWindowCap(
  map: Map<string, { startedAt: number }>,
  now: number = Date.now(),
  max: number = RATE_WINDOW_MAX_KEYS,
): void {
  if (map.size <= max) return;
  for (const [key, window] of map) if (now - window.startedAt >= RATE_WINDOW_TTL_MS) map.delete(key);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
