/**
 * Commercial North Star — هرم الأهداف التجاري + حرس مكافحة المقاييس الوهمية.
 *
 * الغرض: تثبيت **الغاية العليا** للنظام التجاري صراحةً ومنع أي تحسين يقايض نتيجة
 * تجارية حقيقية بمقياس وهمي (مشاهدات/إعجابات/متابعين/وصول).
 *
 * القاعدة الحاكمة:
 *   PRIMARY    = VERIFIED_SALES      (بيع موثّق)
 *   SECONDARY  = VERIFIED_REVENUE    (إيراد موثّق من نظام البيع)
 *   TERTIARY   = VERIFIED_PROFIT     (ربح موثّق — فقط عند توفّر تكلفة موثوقة)
 *   SUPPORTING = مؤشرات دعم (طلب مؤهّل، عملاء، طلبات، تحويل، متابعة، احتفاظ…)
 *   VANITY     = مشاهدات/إعجابات/متابعون/وصول/تعليقات — **لا تكون هدف التحسين أبداً**.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر `now`.
 */

export type ObjectiveTier = 'PRIMARY' | 'SECONDARY' | 'TERTIARY' | 'SUPPORTING' | 'VANITY';

export const OBJECTIVE_TIER_LABELS_AR: Record<ObjectiveTier, string> = Object.freeze({
  PRIMARY: 'الهدف الأول: مبيعات موثّقة',
  SECONDARY: 'الهدف الثاني: إيراد موثّق',
  TERTIARY: 'الهدف الثالث: ربح/هامش موثّق (عند توفّر التكلفة)',
  SUPPORTING: 'مؤشرات دعم',
  VANITY: 'مقياس وهمي (لا يُحسَّن على حسابه)',
});

/** مؤشر وهمي: قد يرتفع بلا أي نتيجة تجارية. مصدر واحد للقائمة. */
export const VANITY_METRICS: readonly string[] = Object.freeze([
  'views', 'likes', 'followers', 'reach', 'impressions', 'comments', 'shares', 'saves', 'subscribers',
]);

/** مؤشر دعم: يساعد على التنبؤ بالبيع لكنه ليس بيعاً. */
export const SUPPORTING_METRICS: readonly string[] = Object.freeze([
  'qualified_demand', 'qualified_leads', 'requests', 'conversion', 'campaign_performance',
  'follow_up_effectiveness', 'retention', 'repeat_purchase', 'product_demand', 'content_performance',
]);

export const NORTH_STAR_STATEMENT =
  'الغاية العليا: زيادة المبيعات الحقيقية الموثّقة للغرابي، وزيادة الربح الحقيقي الموثّق حين تتوفّر بيانات تكلفة موثوقة. كل ما عدا ذلك قدرات مساندة.';

/** ترتيب الأولوية صريح: بيع > إيراد > ربح > دعم > وهمي. */
export const OBJECTIVE_ORDER: readonly ObjectiveTier[] = Object.freeze([
  'PRIMARY', 'SECONDARY', 'TERTIARY', 'SUPPORTING', 'VANITY',
]);

export function tierOfMetric(metric: string): ObjectiveTier {
  const m = String(metric || '').trim().toLowerCase();
  if (m === 'verified_sales' || m === 'sales') return 'PRIMARY';
  if (m === 'verified_revenue' || m === 'revenue') return 'SECONDARY';
  if (m === 'verified_profit' || m === 'profit' || m === 'margin') return 'TERTIARY';
  if (VANITY_METRICS.includes(m)) return 'VANITY';
  return 'SUPPORTING';
}

export function isVanityMetric(metric: string): boolean {
  return tierOfMetric(metric) === 'VANITY';
}

/** سبب رفض الاعتماد على مقياس وهمي كهدف — يُستخدم في التوصيات والشرح. */
export function vanityRejectionReason(metric: string): string {
  return `«${metric}» مقياس وهمي: قد يرتفع بلا أي بيع أو ربح. لا يُعتمد هدف تحسين ولا يُعلن نجاح على أساسه.`;
}

export interface OutcomeComparison {
  a: { label: string; metric: string; value: number | null; qualifiedLeads: number | null; verifiedSales: number | null };
  b: { label: string; metric: string; value: number | null; qualifiedLeads: number | null; verifiedSales: number | null };
  /** هل هدف أحد الطرفين تجاري صريح (بيع)؟ إن لا، لا يُقارَن على أساس وهمي. */
  salesObjective?: boolean;
}

export interface AntiVanityVerdict {
  /** الطرف الأعلى بالنتيجة التجارية (أو null عند عدم كفاية البيانات). */
  commercialLeader: 'a' | 'b' | null;
  /** الطرف الأعلى بالمقياس الوهمي — معلن للشفافية فقط، لا يُعتمد. */
  vanityLeader: 'a' | 'b' | null;
  /** هل انقلبت المقارنة (وهمي أعلى لكن تجاري أدنى)؟ */
  vanityTrap: boolean;
  reason: string;
  limitations: string[];
}

/**
 * يقارن نتيجتين تجاريتين. **لا** يُرتّب على أساس المقياس الوهمي عندما يكون الهدف
 * بيعياً: الترتيب من المبيعات الموثّقة ثم العملاء المؤهّلين. وإن انقلبت المقارنة
 * (وهمي أعلى، تجاري أدنى) يُعلن `vanityTrap`.
 */
export function compareOutcomesCommercial(input: OutcomeComparison): AntiVanityVerdict {
  const { a, b } = input;
  const limitations: string[] = [];

  const salesA = a.verifiedSales;
  const salesB = b.verifiedSales;
  const leadsA = a.qualifiedLeads;
  const leadsB = b.qualifiedLeads;

  let commercialLeader: 'a' | 'b' | null = null;
  if (salesA !== null && salesB !== null) {
    if (salesA !== salesB) commercialLeader = salesA > salesB ? 'a' : 'b';
    else if (leadsA !== null && leadsB !== null && leadsA !== leadsB) commercialLeader = leadsA > leadsB ? 'a' : 'b';
  } else {
    limitations.push('المبيعات الموثّقة غير متاحة لأحد الطرفين — لا ترتيب تجاري مؤكّد.');
  }

  const metricA = a.value;
  const metricB = b.value;
  let vanityLeader: 'a' | 'b' | null = null;
  if (metricA !== null && metricB !== null && metricA !== metricB) {
    vanityLeader = metricA > metricB ? 'a' : 'b';
  }

  const vanityTrap = Boolean(commercialLeader && vanityLeader && commercialLeader !== vanityLeader);

  let reason: string;
  if (input.salesObjective === false) {
    reason = 'الهدف غير بيعي صراحةً — تُقارَن الحملة بهدفها الأصلي لا بالبيع.';
  } else if (!commercialLeader) {
    reason = 'لا ترتيب تجاري: الأدلة (مبيعات/عملاء مؤهّلون) غير كافية للمقارنة.';
  } else if (vanityTrap) {
    reason = `فخ المقياس الوهمي: «${vanityLeader === 'a' ? a.label : b.label}» أعلى بالمقياس (${vanityLeader === 'a' ? a.metric : b.metric}) لكن «${commercialLeader === 'a' ? a.label : b.label}» أعلى تجارياً — الاعتماد على المقياس الوهمي خطأ.`;
  } else {
    reason = `الترتيب التجاري موافق: «${commercialLeader === 'a' ? a.label : b.label}» أعلى بالمبيعات/العملاء المؤهّلين.`;
  }

  limitations.push('المقارنة تعتمد على قيم حقيقية فقط؛ null يعني «غير متاح» لا صفراً.');
  return { commercialLeader, vanityLeader, vanityTrap, reason, limitations };
}

export interface NorthStarInput {
  verifiedSales: number | null;
  verifiedRevenue: number | null;
  /** الربح يُحسب فقط عند توفّر إيراد وتكلفة موثوقين. */
  verifiedProfit: number | null;
  qualifiedDemand: number | null;
  qualifiedLeads: number | null;
  requests: number | null;
}

export interface NorthStarReport {
  statement: string;
  objectives: Array<{ tier: ObjectiveTier; label: string; metric: string; value: number | null; available: boolean }>;
  primaryAvailable: boolean;
  secondaryAvailable: boolean;
  tertiaryAvailable: boolean;
  /** تحذير صريح عند غياب بيانات الربح. */
  profitGuard: string | null;
  limitations: string[];
}

/**
 * يبني تقرير الغاية العليا. لا يُخترع ربح بلا تكلفة؛ وغياب الإيراد/الربح يُعلن.
 */
export function buildNorthStarReport(input: NorthStarInput): NorthStarReport {
  const objectives: NorthStarReport['objectives'] = [
    { tier: 'PRIMARY', label: OBJECTIVE_TIER_LABELS_AR.PRIMARY, metric: 'verified_sales', value: input.verifiedSales, available: input.verifiedSales !== null },
    { tier: 'SECONDARY', label: OBJECTIVE_TIER_LABELS_AR.SECONDARY, metric: 'verified_revenue', value: input.verifiedRevenue, available: input.verifiedRevenue !== null },
    { tier: 'TERTIARY', label: OBJECTIVE_TIER_LABELS_AR.TERTIARY, metric: 'verified_profit', value: input.verifiedProfit, available: input.verifiedProfit !== null },
    { tier: 'SUPPORTING', label: OBJECTIVE_TIER_LABELS_AR.SUPPORTING, metric: 'qualified_leads', value: input.qualifiedLeads, available: input.qualifiedLeads !== null },
    { tier: 'SUPPORTING', label: OBJECTIVE_TIER_LABELS_AR.SUPPORTING, metric: 'requests', value: input.requests, available: input.requests !== null },
  ];
  return {
    statement: NORTH_STAR_STATEMENT,
    objectives,
    primaryAvailable: input.verifiedSales !== null,
    secondaryAvailable: input.verifiedRevenue !== null,
    tertiaryAvailable: input.verifiedProfit !== null,
    profitGuard: input.verifiedProfit === null
      ? 'الربح غير متاح: لا يُحسب ربح بلا إيراد موثّق + تكلفة منتج/حملة موثوقة. UNKNOWN ≠ صفر.'
      : null,
    limitations: [
      'المقاييس الوهمية (مشاهدات/إعجابات/وصول) لا تُعتمد هدفاً للتحسين.',
      'الأهداف الثلاثة العليا تُقرأ من سجلات حقيقية فقط؛ غير المتاح يُعلن.',
    ],
  };
}
