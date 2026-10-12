/**
 * حارس معدّل موحّد للعمليات الخارجية (ردود/رسائل Meta، وعمليات YouTube) — مصدر واحد.
 *
 * النافذة داخل العملية (`Map`)، و`reserveOperationRate` **تحجز ذرّياً** داخل نداء
 * متزامن واحد: تقرأ أحدث قائمة، تفحصها عبر `checkOperationRateLimit` (المصدر الواحد
 * لفحص النافذة)، ثم تكتب القائمة فوراً **قبل أي `await`**. لذلك لا يمكن لعمليتين
 * متزامنتين (دورة مراقب + استدعاء يدوي) تجاوز الحد — كل نداء يرى أثر الذي قبله.
 *
 * منطق صافٍ قابل للاختبار (بلا شبكة وبلا أسرار وبلا ساعة حقيقية): يُمرَّر `now`.
 */

import { checkOperationRateLimit, type RateLimitDecision } from './youtube';

export function reserveOperationRate(
  windows: Map<string, number[]>,
  key: string,
  now: number,
  limit: number,
  windowMs: number,
): RateLimitDecision {
  const decision = checkOperationRateLimit({ timestamps: windows.get(key) || [], now, limit, windowMs });
  if (decision.allowed) {
    const list = (windows.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now);
    windows.set(key, list);
  }
  return decision;
}
