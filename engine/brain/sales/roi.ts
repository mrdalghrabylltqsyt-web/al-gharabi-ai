/**
 * Marketing ROI — أساس قياس العائد التجاري بصدق (منطق خالص).
 *
 * الغرض: قياس سلسلة القيمة الحقيقية (وصول → تفاعل → استفسار → عميل → طلب →
 * بيع → إيراد) مع **إعلان صريح** لكل مقياس غير متاح. لا تُخترع تكلفة ولا إيراد
 * ولا يُحسب عائد من صفر مُختلق: غياب البيانات يعني «غير متاح» لا صفراً.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

export type RoiMetricState = 'AVAILABLE' | 'NOT_AVAILABLE' | 'INSUFFICIENT_DATA';

export const ROI_METRIC_STATES_AR: Record<RoiMetricState, string> = Object.freeze({
  AVAILABLE: 'متاح',
  NOT_AVAILABLE: 'غير متاح (لا بيانات)',
  INSUFFICIENT_DATA: 'بيانات غير كافية',
});

export interface RoiMetric {
  key: string;
  labelAr: string;
  value: number | null;
  unit: 'count' | 'currency' | 'percent';
  state: RoiMetricState;
  source: string | null;
  reason?: string;
}

export interface RoiFunnelInput {
  reach: number | null;
  engagement: number | null;
  inquiries: number | null;
  leads: number | null;
  requests: number | null;
  /** مبيعات موثّقة فقط (لا تُقدَّر). */
  verifiedSales: number | null;
  /** إيراد موثّق من نظام البيع (لا يُقدَّر). */
  revenue: number | null;
  /** تكلفة الحملة الموثّقة (لا تُقدَّر). */
  campaignCost: number | null;
  source?: string;
}

export interface RoiReport {
  metrics: RoiMetric[];
  conversionRates: RoiMetric[];
  /** تكلفة العميل المحتمل / البيع — متاحة فقط عند وجود التكلفة والعدد. */
  costPerLead: RoiMetric;
  costPerSale: RoiMetric;
  /** العائد على التكلفة — متاح فقط عند وجود الإيراد والتكلفة. */
  roas: RoiMetric;
  /** أي بيانات ناقصة تمنع حساباً دقيقاً. */
  dataGaps: string[];
  limitations: string[];
  note: string;
}

function metric(key: string, labelAr: string, value: number | null, unit: RoiMetric['unit'], source: string | null, reason?: string): RoiMetric {
  return {
    key,
    labelAr,
    value,
    unit,
    state: value === null ? 'NOT_AVAILABLE' : 'AVAILABLE',
    source: value === null ? null : source,
    reason,
  };
}

/** نسبة آمنة: null عند المقام صفر/غائب (لا قسمة على صفر ولا اختراع). */
function rate(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100; // نسبة مئوية بمنزلتين
}

/**
 * يبني تقرير ROI من بيانات حقيقية فقط. أي حقل `null` يبقى غير متاح بسببه،
 * والمعدّلات تُحسب فقط عندما يتوفر طرفاها.
 */
export function buildRoiReport(input: RoiFunnelInput): RoiReport {
  const source = input.source || 'سجلات النظام';
  const dataGaps: string[] = [];
  if (input.reach === null) dataGaps.push('الوصول غير متاح عبر الواجهات الحالية.');
  if (input.inquiries === null) dataGaps.push('لا عدّاد استفسارات مسجّل.');
  if (input.leads === null) dataGaps.push('لا عملاء محتملون مسجّلون.');
  if (input.verifiedSales === null) dataGaps.push('لا مبيعات موثّقة مرتبطة بالحملة.');
  if (input.revenue === null) dataGaps.push('الإيراد غير موثّق.');
  if (input.campaignCost === null) dataGaps.push('تكلفة الحملة غير مسجّلة — لا يُحسب عائد بلا تكلفة.');

  const metrics: RoiMetric[] = [
    metric('reach', 'وصول', input.reach, 'count', source),
    metric('engagement', 'تفاعل', input.engagement, 'count', source),
    metric('inquiries', 'استفسارات', input.inquiries, 'count', source),
    metric('leads', 'عملاء محتملون', input.leads, 'count', source),
    metric('requests', 'طلبات', input.requests, 'count', source),
    metric('verified_sales', 'مبيعات موثّقة', input.verifiedSales, 'count', source),
    metric('revenue', 'إيراد موثّق', input.revenue, 'currency', source),
    metric('campaign_cost', 'تكلفة الحملة', input.campaignCost, 'currency', source),
  ];

  const conversionRates: RoiMetric[] = [
    metric('engagement_rate', 'نسبة التفاعل من الوصول', rate(input.engagement, input.reach), 'percent', source),
    metric('inquiry_rate', 'نسبة الاستفسار من التفاعل', rate(input.inquiries, input.engagement), 'percent', source),
    metric('lead_rate', 'نسبة العميل المحتمل من الاستفسار', rate(input.leads, input.inquiries), 'percent', source),
    metric('request_rate', 'نسبة الطلب من العميل', rate(input.requests, input.leads), 'percent', source),
    metric('sale_rate', 'نسبة البيع الموثّق من الطلب', rate(input.verifiedSales, input.requests), 'percent', source),
  ];

  const cpl = (input.campaignCost !== null && input.leads !== null && input.leads > 0)
    ? Math.round(input.campaignCost / input.leads) : null;
  const cps = (input.campaignCost !== null && input.verifiedSales !== null && input.verifiedSales > 0)
    ? Math.round(input.campaignCost / input.verifiedSales) : null;
  const roas = (input.revenue !== null && input.campaignCost !== null && input.campaignCost > 0)
    ? Math.round((input.revenue / input.campaignCost) * 100) / 100 : null;

  return {
    metrics,
    conversionRates,
    costPerLead: metric('cost_per_lead', 'تكلفة العميل المحتمل', cpl, 'currency', source, cpl === null ? 'تحتاج تكلفة حملة وعملاء مسجّلين.' : undefined),
    costPerSale: metric('cost_per_sale', 'تكلفة البيع', cps, 'currency', source, cps === null ? 'تحتاج تكلفة حملة ومبيعات موثّقة.' : undefined),
    roas: metric('roas', 'العائد على التكلفة', roas, 'count', source, roas === null ? 'تحتاج إيراداً وتكلفة موثّقين.' : undefined),
    dataGaps,
    limitations: [
      'لا يُخترع إيراد ولا تكلفة ولا معدّل تحويل من صفر مضلّل.',
      'المعدّلات تُحسب فقط عند توفر طرفيها؛ وإلا تُعلن غير متاحة.',
      'الإيراد والمبيعات الموثّقة من نظام البيع فقط، لا من التفاعل.',
    ],
    note: 'قياس ROI صادق: كل مقياس بمصدره أو يُعلن غير متاح؛ لا تقدير مالي مُختلق.',
  };
}
