/**
 * عرض موحّد للأوقات في الواجهة — فحص الشاشات (2026-10-25 #3).
 *
 * كانت شاشات عدة تعرض الطابع الزمني الخام (`2026-10-25T16:41:55.345Z`) بتوقيت UTC،
 * فيقرؤه المالك خطأً (فرق 3 ساعات عن بغداد) ويبدو كعطل. مصدر واحد: كل وقت يُعرض
 * بتوقيت بغداد وبصيغة عربية قصيرة. النص غير القابل للتحليل يُعاد كما هو (لا اختراع).
 */
export const DISPLAY_TIME_ZONE = 'Asia/Baghdad';

export function fmtDateTime(value: unknown, empty = '—'): string {
  if (value === null || value === undefined || value === '') return empty;
  const raw = String(value);
  // لا نحلّل نصاً بلا تاريخ (مثل «مؤخراً»).
  if (!/\d{4}-\d{2}-\d{2}/.test(raw) && typeof value !== 'number') return raw;
  const t = typeof value === 'number' ? value : Date.parse(raw);
  if (!Number.isFinite(t)) return raw;
  try {
    return new Date(t).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short', timeZone: DISPLAY_TIME_ZONE });
  } catch {
    return new Date(t).toLocaleString('ar-IQ');
  }
}
