/**
 * أساس التحليلات الموحّد عبر المنصات.
 *
 * القاعدة الملزمة: أي مؤشر لا توفّره المنصة عبر واجهتها الرسمية يُعاد كـ
 * `NOT_SUPPORTED` مع سبب، ولا يُخترع له صفر ولا رقم تقديري. والصفر الحقيقي
 * (تفاعل فعلي = 0) يبقى صفراً لأن المنصة أعادته فعلاً.
 *
 * يوفّر الغلاف الموحّد للموصلات الثلاث واجهات:
 *   fetchPostMetrics() / fetchAccountMetrics() / fetchEngagement()
 * وكلها تعيد الحالة الفعلية للمنصة (SUPPORTED مع قيم، أو NOT_SUPPORTED).
 */

import type { PlatformId } from './adapter';
import { metricAvailability } from './publishing';

export type MetricStatus = 'SUPPORTED' | 'NOT_SUPPORTED';

export interface MetricResult {
  metric: string;
  status: MetricStatus;
  /** القيمة فقط عند SUPPORTED؛ غيابه يعني عدم الإتاحة لا صفراً. */
  value?: number;
  reason?: string;
}

export interface MetricsEnvelope {
  platform: PlatformId;
  scope: 'post' | 'account' | 'engagement';
  externalId: string | null;
  metrics: MetricResult[];
  fetchedAt: string;
  /** ملاحظة صريحة عندما لا تتوفر أي قيمة. */
  note?: string;
}

/**
 * يحوّل خام المزود إلى غلاف موحّد، باستخدام جدول توفر المؤشرات الرسمي.
 * القيمة غير الرقمية أو السلبية تُعدّ غير متاحة (لا تُصبح صفراً).
 */
export function fetchPostMetrics(platform: PlatformId, externalId: string, raw: Record<string, unknown>): MetricsEnvelope {
  return buildMetrics(platform, 'post', externalId, raw);
}

export function fetchAccountMetrics(platform: PlatformId, raw: Record<string, unknown>): MetricsEnvelope {
  return buildMetrics(platform, 'account', null, raw);
}

export function fetchEngagement(platform: PlatformId, externalId: string, raw: Record<string, unknown>): MetricsEnvelope {
  return buildMetrics(platform, 'engagement', externalId, raw);
}

function buildMetrics(platform: PlatformId, scope: MetricsEnvelope['scope'], externalId: string | null, raw: Record<string, unknown>): MetricsEnvelope {
  const availability = metricAvailability(platform);
  const metrics: MetricResult[] = availability.map((item) => {
    if (!item.available) {
      return { metric: item.metric, status: 'NOT_SUPPORTED', reason: item.reason || 'المؤشر غير متاح عبر الواجهة الرسمية لهذه المنصة.' };
    }
    const value = Number(raw?.[item.metric]);
    if (!Number.isFinite(value) || value < 0) {
      // المؤشر مدعوم لكن لا قيمة فعلية في الخام → لا نخترع صفراً.
      return { metric: item.metric, status: 'NOT_SUPPORTED', reason: 'لم تُعد المنصة قيمة فعلية لهذا المؤشر في هذا الطلب.' };
    }
    return { metric: item.metric, status: 'SUPPORTED', value };
  });
  const anySupported = metrics.some((m) => m.status === 'SUPPORTED');
  return {
    platform,
    scope,
    externalId,
    metrics,
    fetchedAt: new Date().toISOString(),
    note: anySupported ? undefined : 'لا توجد قيم فعلية متاحة من الواجهة الرسمية لهذه المنصة؛ لم تُخترع أي قيمة.',
  };
}

/** تتحقق أن نتيجة المؤشر لا تُستبدل بصفر وهمي: النتيجة NOT_SUPPORTED يجب أن تبقى بلا قيمة. */
export function isHonestMetricResult(result: MetricResult): boolean {
  if (result.status === 'NOT_SUPPORTED') return result.value === undefined;
  return typeof result.value === 'number' && Number.isFinite(result.value);
}
