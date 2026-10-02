/**
 * Digital Sales — القُمع البيعي الرقمي (منطق خالص).
 *
 * الغرض: قياس القُمع الرقمي (تفاعلات → إشارات شراء → عملاء مؤهّلين → طلبات →
 * مبيعات موثّقة) وتحديد عنق الزجاجة — **بلا أرقام مُختلقة، وبلا اعتبار البيانات
 * الناقصة صفراً، وبلا قسمة على صفر**.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

export type DigitalFunnelStage = 'INTERACTIONS' | 'PURCHASE_SIGNALS' | 'QUALIFIED_LEADS' | 'REQUESTS' | 'VERIFIED_SALES';

export const DIGITAL_FUNNEL_ORDER: readonly DigitalFunnelStage[] = Object.freeze([
  'INTERACTIONS', 'PURCHASE_SIGNALS', 'QUALIFIED_LEADS', 'REQUESTS', 'VERIFIED_SALES',
]);

export const DIGITAL_FUNNEL_LABELS_AR: Record<DigitalFunnelStage, string> = Object.freeze({
  INTERACTIONS: 'تفاعلات',
  PURCHASE_SIGNALS: 'إشارات شراء',
  QUALIFIED_LEADS: 'عملاء مؤهّلون',
  REQUESTS: 'طلبات',
  VERIFIED_SALES: 'مبيعات موثّقة',
});

export interface DigitalFunnelStageResult {
  stage: DigitalFunnelStage;
  labelAr: string;
  value: number | null;
  available: boolean;
  source: string | null;
}

export interface DigitalFunnelConversion {
  from: DigitalFunnelStage;
  to: DigitalFunnelStage;
  ratePct: number | null;
  available: boolean;
  note: string;
}

export interface DigitalFunnelReport {
  stages: DigitalFunnelStageResult[];
  conversions: DigitalFunnelConversion[];
  /** عنق الزجاجة = أدنى تحويل متاح. */
  bottleneck: { from: DigitalFunnelStage; to: DigitalFunnelStage; ratePct: number; reason: string } | null;
  limitations: string[];
}

function stageValue(input: Record<string, number | null>, stage: DigitalFunnelStage, source: string): DigitalFunnelStageResult {
  const v = input[stage];
  const available = typeof v === 'number' && Number.isFinite(v);
  return {
    stage,
    labelAr: DIGITAL_FUNNEL_LABELS_AR[stage],
    value: available ? (v as number) : null,
    available,
    source: available ? source : null,
  };
}

/**
 * يبني القُمع الرقمي. أي مرحلة بلا بيانات تُعلن `available:false` (NOT_AVAILABLE)
 * ولا تُعامَل كصفر.
 */
export function buildDigitalSalesFunnel(input: {
  interactions: number | null;
  purchaseSignals: number | null;
  qualifiedLeads: number | null;
  requests: number | null;
  verifiedSales: number | null;
}): DigitalFunnelReport {
  const stages = [
    stageValue({ INTERACTIONS: input.interactions }, 'INTERACTIONS', 'social_interactions'),
    stageValue({ PURCHASE_SIGNALS: input.purchaseSignals }, 'PURCHASE_SIGNALS', 'purchase_intent'),
    stageValue({ QUALIFIED_LEADS: input.qualifiedLeads }, 'QUALIFIED_LEADS', 'lead_qualification'),
    stageValue({ REQUESTS: input.requests }, 'REQUESTS', 'lead_pipeline'),
    stageValue({ VERIFIED_SALES: input.verifiedSales }, 'VERIFIED_SALES', 'workspace.sales'),
  ];

  const conversions: DigitalFunnelConversion[] = [];
  for (let i = 1; i < stages.length; i += 1) {
    const from = stages[i - 1];
    const to = stages[i];
    if (!from.available || !to.available) {
      conversions.push({ from: from.stage, to: to.stage, ratePct: null, available: false, note: 'طرفا النسبة غير متاحين — لا معدّل.' });
      continue;
    }
    if (!from.value || from.value <= 0) {
      conversions.push({ from: from.stage, to: to.stage, ratePct: null, available: false, note: 'المقام صفر — لا قسمة على صفر.' });
      continue;
    }
    const rate = Math.round(((to.value as number) / (from.value as number)) * 10000) / 100;
    conversions.push({ from: from.stage, to: to.stage, ratePct: rate, available: true, note: `${to.value} من ${from.value}.` });
  }

  const availableConversions = conversions.filter((c) => c.available && typeof c.ratePct === 'number');
  let bottleneck: DigitalFunnelReport['bottleneck'] = null;
  if (availableConversions.length) {
    const lowest = availableConversions.reduce((min, c) => ((c.ratePct as number) < (min.ratePct as number) ? c : min), availableConversions[0]);
    bottleneck = {
      from: lowest.from, to: lowest.to, ratePct: lowest.ratePct as number,
      reason: `أدنى تحويل: ${lowest.ratePct}% من ${DIGITAL_FUNNEL_LABELS_AR[lowest.from]} إلى ${DIGITAL_FUNNEL_LABELS_AR[lowest.to]}.`,
    };
  }

  return {
    stages,
    conversions,
    bottleneck,
    limitations: [
      'الأرقام من سجلات حقيقية فقط؛ المرحلة بلا بيانات تُعلن NOT_AVAILABLE لا صفراً.',
      'لا معدّل تحويل بمقام صفر.',
    ],
  };
}
