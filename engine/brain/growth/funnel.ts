/**
 * Sales-Oriented Funnel — REACH → INTEREST → INQUIRY → LEAD → VERIFIED SALE
 * مع تحديد موضع توقّف التحويل (منطق خالص).
 *
 * الغرض: أن يقيس العقل مسار القيمة التجاري الحقيقي لا مقاييس التفاعل وحدها،
 * وأن يحدّد **أين يتوقف التحويل** بأدلة حقيقية لا بتخمين.
 *
 * القواعد الملزمة:
 * - كل مرحلة بمصدرها؛ والمرحلة غير المتاحة تُعلن `NOT_AVAILABLE` (لا صفر مُختلق).
 * - معدّل التحويل يُحسب فقط عند توفر طرفيه؛ وإلا `null`.
 * - عنق الزجاجة يُعلن فقط عند وجود انخفاض كبير مقيس بين مرحلتين متاحتين.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

export type FunnelStageKey = 'REACH' | 'INTEREST' | 'INQUIRY' | 'LEAD' | 'VERIFIED_SALE';

export const SALES_FUNNEL_LABELS_AR: Record<FunnelStageKey, string> = Object.freeze({
  REACH: 'وصول',
  INTEREST: 'اهتمام',
  INQUIRY: 'استفسار',
  LEAD: 'عميل محتمل',
  VERIFIED_SALE: 'بيع موثّق',
});

export const SALES_FUNNEL_ORDER: readonly FunnelStageKey[] = Object.freeze([
  'REACH', 'INTEREST', 'INQUIRY', 'LEAD', 'VERIFIED_SALE',
]);

export interface FunnelStageValue {
  stage: FunnelStageKey;
  labelAr: string;
  value: number | null;
  available: boolean;
  source: string | null;
  reason?: string;
}

export interface FunnelConversion {
  from: FunnelStageKey;
  to: FunnelStageKey;
  ratePct: number | null;
  available: boolean;
  reason?: string;
}

export interface SalesFunnel {
  stages: FunnelStageValue[];
  conversions: FunnelConversion[];
  /** أول موضع توقّف ملاحَظ (أو null). */
  bottleneck: FunnelBottleneck | null;
  dataGaps: string[];
  note: string;
  limitations: string[];
}

export interface FunnelBottleneck {
  stage: FunnelStageKey;
  stageLabel: string;
  /** سبب الحكم (انخفاض مقيس / بيانات ناقصة). */
  reason: string;
  /** هل الحكم مبني على بيانات متاحة؟ */
  evidenceBacked: boolean;
  recommendedAction: string;
}

/** نسبة آمنة: null عند المقام صفر/غائب. */
function ratePct(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

export interface SalesFunnelInput {
  reach: number | null;
  interest: number | null;
  inquiries: number | null;
  leads: number | null;
  verifiedSales: number | null;
  sources?: Partial<Record<FunnelStageKey, string>>;
}

/**
 * يبني القُمع البيعي من أرقام حقيقية فقط، ويحدّد عنق الزجاجة. لا يخترع رقماً،
 * وعند غياب بيانات مرحلة يعلنها «غير متاحة» بدل صفر مضلّل.
 */
export function buildSalesFunnel(input: SalesFunnelInput): SalesFunnel {
  const src = (k: FunnelStageKey) => input.sources?.[k] ?? 'سجلات النظام الحقيقية';
  const mk = (stage: FunnelStageKey, value: number | null, reason?: string): FunnelStageValue => ({
    stage,
    labelAr: SALES_FUNNEL_LABELS_AR[stage],
    value,
    available: value !== null,
    source: value === null ? null : src(stage),
    reason: value === null ? (reason || 'المؤشر غير متاح عبر الواجهة الحالية.') : undefined,
  });

  const stages: FunnelStageValue[] = [
    mk('REACH', input.reach, 'مؤشر الوصول غير متاح عبر الواجهات الحالية.'),
    mk('INTEREST', input.interest, 'مؤشر التفاعل غير متاح.'),
    mk('INQUIRY', input.inquiries, 'لا عدّاد استفسارات حقيقي مسجّل.'),
    mk('LEAD', input.leads, 'لا عملاء محتملون مسجّلون.'),
    mk('VERIFIED_SALE', input.verifiedSales, 'لا مبيعات موثّقة مرتبطة.'),
  ];

  const valueOf = (k: FunnelStageKey) => stages.find((s) => s.stage === k)!.value;
  const conversions: FunnelConversion[] = [];
  for (let i = 0; i < SALES_FUNNEL_ORDER.length - 1; i += 1) {
    const from = SALES_FUNNEL_ORDER[i];
    const to = SALES_FUNNEL_ORDER[i + 1];
    const r = ratePct(valueOf(to), valueOf(from));
    conversions.push({
      from,
      to,
      ratePct: r,
      available: r !== null,
      reason: r === null ? 'يحتاج توفر طرفي التحويل.' : undefined,
    });
  }

  const dataGaps = stages.filter((s) => !s.available).map((s) => `${s.labelAr}: ${s.reason}`);

  // عنق الزجاجة: أدنى معدّل تحويل متاح، مع إعلان صريح إن كان الحكم مدعوماً.
  const availableConversions = conversions.filter((c) => c.available && c.ratePct !== null) as Array<FunnelConversion & { ratePct: number }>;
  let bottleneck: FunnelBottleneck | null = null;
  if (availableConversions.length) {
    const worst = availableConversions.reduce((a, b) => (b.ratePct < a.ratePct ? b : a));
    const evidenceBacked = worst.ratePct < 25;
    bottleneck = {
      stage: worst.to,
      stageLabel: SALES_FUNNEL_LABELS_AR[worst.to],
      reason: `أدنى تحويل: ${worst.ratePct}% من ${SALES_FUNNEL_LABELS_AR[worst.from]} إلى ${SALES_FUNNEL_LABELS_AR[worst.to]}.`,
      evidenceBacked,
      recommendedAction: worst.to === 'VERIFIED_SALE'
        ? 'راجع متابعة العملاء المحتملين حتى البيع الموثّق؛ لا يوجد بيع كافٍ من الطلب.'
        : worst.to === 'LEAD'
          ? 'حوّل الاستفسارات المؤهّلة إلى عملاء مسجّلين وتابعها.'
          : worst.to === 'INQUIRY'
            ? 'حسّن المحتوى/الدعوة للتواصل لرفع الاستفسارات.'
            : 'راجع الرسالة والجمهور لرفع الاهتمام الحقيقي.',
    };
  }

  return {
    stages,
    conversions,
    bottleneck,
    dataGaps,
    note: 'القُمع البيعي يقيس الوصول→الاهتمام→الاستفسار→العميل→البيع الموثّق، ويحدّد موضع التوقّف بأدلة حقيقية.',
    limitations: [
      'لا يُخترع رقم لمرحلة غير متاحة؛ تُعلن NOT_AVAILABLE.',
      'معدّل التحويل يُحسب فقط عند توفر طرفيه.',
      '«البيع الموثّق» من نظام البيع فقط، لا من التفاعل.',
    ],
  };
}

export interface SalesFunnelSummary {
  bottleneckStage: FunnelStageKey | null;
  bottleneckEvidenceBacked: boolean;
  availableStages: number;
  totalStages: number;
  note: string;
}

export function summarizeSalesFunnel(funnel: SalesFunnel): SalesFunnelSummary {
  return {
    bottleneckStage: funnel.bottleneck?.stage ?? null,
    bottleneckEvidenceBacked: funnel.bottleneck?.evidenceBacked ?? false,
    availableStages: funnel.stages.filter((s) => s.available).length,
    totalStages: funnel.stages.length,
    note: 'موضع التوقّف يُعلن من انخفاض مقيس بين مرحلتين متاحتين؛ والمراحل غير المتاحة تُعلن صراحةً.',
  };
}
