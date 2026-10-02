/**
 * Product Commercial Intelligence + Product Opportunity Engine (منطق خالص).
 *
 * الغرض: أن يفهم العقل **كل منتج** من بيانات حقيقية فقط، ويصنّفه بحالة تجارية صريحة،
 * ويولّد فرصاً ذات دليل/مصدر/فترة/عيّنة/ثقة/أثر/تكلفة/خطر/اختبار تالٍ.
 *
 * القواعد الملزمة:
 * - لا حالة تجارية بلا دليل كافٍ؛ غير الكافي يُعلن `DATA_INSUFFICIENT`.
 * - الحالات محصورة: HIGH/LOW/RISING/FALLING DEMAND, HIGH/LOW CONVERSION,
 *   HIGH_INTEREST_LOW_SALES, LOW_INTEREST_LOW_SALES, DATA_INSUFFICIENT.
 * - كل فرصة تحمل عناصرها الإلزامية كاملة؛ لا فرصة ناقصة.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر `nowMs`.
 */

export type ProductCommercialStatus =
  | 'HIGH_DEMAND' | 'LOW_DEMAND' | 'RISING_DEMAND' | 'FALLING_DEMAND'
  | 'HIGH_CONVERSION' | 'LOW_CONVERSION' | 'HIGH_INTEREST_LOW_SALES'
  | 'LOW_INTEREST_LOW_SALES' | 'DATA_INSUFFICIENT';

export const PRODUCT_STATUS_LABELS_AR: Record<ProductCommercialStatus, string> = Object.freeze({
  HIGH_DEMAND: 'طلب مرتفع',
  LOW_DEMAND: 'طلب منخفض',
  RISING_DEMAND: 'طلب صاعد',
  FALLING_DEMAND: 'طلب هابط',
  HIGH_CONVERSION: 'تحويل مرتفع',
  LOW_CONVERSION: 'تحويل منخفض',
  HIGH_INTEREST_LOW_SALES: 'اهتمام مرتفع / مبيعات منخفضة',
  LOW_INTEREST_LOW_SALES: 'اهتمام منخفض / مبيعات منخفضة',
  DATA_INSUFFICIENT: 'بيانات غير كافية',
});

/** الحد الأدنى للعيّنة قبل إعلان أي حالة تجارية للمنتج. */
export const PRODUCT_MIN_SAMPLE = 3;

export interface ProductCommercialFacts {
  productId: string;
  productName: string | null;
  /** سعر موثّق؟ (VERIFIED) */
  priceVerified: boolean;
  availabilityVerified: boolean;
  installmentAvailable: boolean;
  /** عدّادات حقيقية (null = غير متاح). */
  demandSignals: number | null;
  purchaseSignals: number | null;
  qualifiedLeads: number | null;
  requests: number | null;
  verifiedSales: number | null;
  revenue: number | null;
  profit: number | null;
  campaignCount: number | null;
  /** عدّ اعتراضات/أسئلة متكرّرة. */
  priceObjections: number | null;
  installmentQuestions: number | null;
  availabilityRequests: number | null;
  specificationRequests: number | null;
  /** اتجاه الطلب من نافذتين حقيقيتين. */
  demandFirstHalf: number | null;
  demandSecondHalf: number | null;
  lostCount: number | null;
  evidenceSource: string;
  sampleSize: number;
}

export interface ProductIntelligence {
  productId: string;
  productName: string | null;
  status: ProductCommercialStatus;
  statusLabelAr: string;
  reason: string;
  evidence: string[];
  sampleSize: number;
  confidence: 'low' | 'medium' | 'high';
  /** قيم حقيقية أو null (لا اختراع). */
  facts: ProductCommercialFacts;
  limitations: string[];
}

function safeRate(num: number | null, den: number | null): number | null {
  if (num === null || den === null || den <= 0) return null;
  return num / den;
}

/**
 * يحسم الحالة التجارية للمنتج من الحقائق. الأولوية: بيانات غير كافية ← اتجاه الطلب ←
 * اهتمام/تحويل. لا حكم بلا عيّنة ≥ الحد.
 */
export function classifyProductCommercial(facts: ProductCommercialFacts): ProductIntelligence {
  const limitations: string[] = [];
  const evidence: string[] = [];
  const sample = facts.sampleSize;

  const pushIf = (cond: boolean, txt: string) => { if (cond) evidence.push(txt); };

  if (sample < PRODUCT_MIN_SAMPLE) {
    return {
      productId: facts.productId, productName: facts.productName,
      status: 'DATA_INSUFFICIENT', statusLabelAr: PRODUCT_STATUS_LABELS_AR.DATA_INSUFFICIENT,
      reason: `عيّنة ${sample} < الحد ${PRODUCT_MIN_SAMPLE} — لا حكم تجاري.`,
      evidence: [`sampleSize=${sample}`], sampleSize: sample, confidence: 'low', facts,
      limitations: ['بيانات غير كافية — لا يُعلن طلب/تحويل.'],
    };
  }

  const demand = facts.demandSignals;
  const sales = facts.verifiedSales;
  const leads = facts.qualifiedLeads;

  // اتجاه الطلب (نافذتان حقيقيتان).
  if (facts.demandFirstHalf !== null && facts.demandSecondHalf !== null) {
    if (facts.demandSecondHalf > facts.demandFirstHalf) { evidence.push(`الطلب: ${facts.demandFirstHalf}→${facts.demandSecondHalf}`); }
  }

  const conversion = safeRate(sales, leads);
  pushIf(demand !== null, `إشارات الطلب=${demand}`);
  pushIf(leads !== null, `عملاء مؤهّلون=${leads}`);
  pushIf(sales !== null, `مبيعات موثّقة=${sales}`);
  pushIf(conversion !== null, `التحويل=${Math.round((conversion as number) * 100)}%`);

  let status: ProductCommercialStatus;
  let reason: string;

  const highDemand = demand !== null && demand >= 5;
  const lowDemand = demand !== null && demand < PRODUCT_MIN_SAMPLE;
  const rising = facts.demandFirstHalf !== null && facts.demandSecondHalf !== null && facts.demandSecondHalf > facts.demandFirstHalf;
  const falling = facts.demandFirstHalf !== null && facts.demandSecondHalf !== null && facts.demandSecondHalf < facts.demandFirstHalf;
  const highConversion = conversion !== null && conversion >= 0.3;
  const lowConversion = conversion !== null && conversion < 0.15;
  const highInterest = demand !== null && demand >= 5;
  const lowSales = sales !== null && sales === 0;

  if (rising) { status = 'RISING_DEMAND'; reason = 'الطلب يرتفع بين نافذتين حقيقيتين.'; }
  else if (falling) { status = 'FALLING_DEMAND'; reason = 'الطلب ينخفض بين نافذتين حقيقيتين.'; }
  else if (highInterest && lowSales) { status = 'HIGH_INTEREST_LOW_SALES'; reason = 'اهتمام مرتفع بلا مبيعات موثّقة — فرصة تحويل.'; }
  else if (lowDemand && lowSales) { status = 'LOW_INTEREST_LOW_SALES'; reason = 'اهتمام ومبيعات منخفضان.'; }
  else if (highConversion) { status = 'HIGH_CONVERSION'; reason = 'نسبة تحويل مرتفعة من العملاء المؤهّلين.'; }
  else if (lowConversion) { status = 'LOW_CONVERSION'; reason = 'نسبة تحويل منخفضة من العملاء المؤهّلين.'; }
  else if (highDemand) { status = 'HIGH_DEMAND'; reason = 'طلب مرتفع من إشارات حقيقية.'; }
  else if (lowDemand) { status = 'LOW_DEMAND'; reason = 'طلب منخفض.'; }
  else { status = 'DATA_INSUFFICIENT'; reason = 'لا دليل كافٍ لحالة محدّدة.'; }

  return {
    productId: facts.productId, productName: facts.productName,
    status, statusLabelAr: PRODUCT_STATUS_LABELS_AR[status], reason,
    evidence, sampleSize: sample,
    confidence: sample >= 5 ? 'medium' : 'low',
    facts,
    limitations: [
      'الحالة من بيانات حقيقية فقط؛ null يعني «غير متاح» لا صفراً.',
      'لا حالة تحويل بلا طرفي النسبة (عملاء مؤهّلون + مبيعات).',
    ],
  };
}

// ---------------------------------------------------------------------------
// Product Opportunity Engine (§8, §24)
// ---------------------------------------------------------------------------

export type ProductOpportunityKind =
  | 'high_demand_weak_conversion' | 'strong_conversion_insufficient_reach'
  | 'repeated_price_objections' | 'repeated_installment_questions'
  | 'availability_bottleneck' | 'rising_demand' | 'falling_demand'
  | 'requested_unavailable' | 'repeated_information_request'
  | 'needs_better_presentation' | 'needs_better_audience' | 'needs_different_offer';

export const PRODUCT_OPPORTUNITY_LABELS_AR: Record<ProductOpportunityKind, string> = Object.freeze({
  high_demand_weak_conversion: 'طلب مرتفع وتحويل ضعيف',
  strong_conversion_insufficient_reach: 'تحويل قوي ووصول غير كافٍ',
  repeated_price_objections: 'اعتراضات سعرية متكرّرة',
  repeated_installment_questions: 'أسئلة تقسيط متكرّرة',
  availability_bottleneck: 'عنق زجاجة في التوفّر',
  rising_demand: 'طلب صاعد',
  falling_demand: 'طلب هابط',
  requested_unavailable: 'منتج مطلوب وغير متوفّر',
  repeated_information_request: 'معلومة يطلبها العملاء مراراً',
  needs_better_presentation: 'يحتاج عرضاً أفضل',
  needs_better_audience: 'يحتاج جمهوراً أفضل',
  needs_different_offer: 'يحتاج عرضاً تجارياً مختلفاً',
});

export interface ProductOpportunity {
  id: string;
  kind: ProductOpportunityKind;
  kindLabelAr: string;
  productId: string;
  productName: string | null;
  /** العناصر الإلزامية الكاملة. */
  evidence: string[];
  source: string;
  timePeriod: string;
  sampleSize: number;
  confidence: 'low' | 'medium' | 'high';
  expectedImpact: 'high' | 'medium' | 'low';
  cost: 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
  recommendedNextTest: string;
  limitations: string[];
}

export interface ProductOpportunityInput {
  intel: ProductIntelligence;
  timePeriod: string;
}

/** يولّد فرصاً للمنتج من حالته التجارية. كل فرصة مكتملة العناصر الإلزامية. */
export function buildProductOpportunities(input: ProductOpportunityInput): ProductOpportunity[] {
  const { intel } = input;
  const f = intel.facts;
  const out: ProductOpportunity[] = [];
  const base = {
    productId: intel.productId, productName: intel.productName,
    source: f.evidenceSource, timePeriod: input.timePeriod,
    sampleSize: intel.sampleSize, confidence: intel.confidence,
    evidence: [...intel.evidence],
    limitations: ['الفرصة من بيانات حقيقية؛ التنفيذ يمر ببوابات الصلاحيات.'],
  };
  const mk = (kind: ProductOpportunityKind, impact: ProductOpportunity['expectedImpact'], cost: ProductOpportunity['cost'], risk: ProductOpportunity['risk'], test: string): ProductOpportunity => ({
    id: `opp-${intel.productId}-${kind}`,
    kind, kindLabelAr: PRODUCT_OPPORTUNITY_LABELS_AR[kind],
    ...base, expectedImpact: impact, cost, risk, recommendedNextTest: test,
  });

  switch (intel.status) {
    case 'HIGH_INTEREST_LOW_SALES':
      out.push(mk('high_demand_weak_conversion', 'high', 'medium', 'medium', 'اختبر عرضاً/سعراً/توفّراً مختلفاً على نفس الجمهور واقس أثر المبيعات الموثّقة.'));
      break;
    case 'HIGH_CONVERSION':
      out.push(mk('strong_conversion_insufficient_reach', 'high', 'medium', 'low', 'اختبر توسيع جمهور/توقيت مشابه مع قياس البيع الموثّق.'));
      break;
    case 'RISING_DEMAND':
      out.push(mk('rising_demand', 'high', 'low', 'low', 'جهّز عرضاً/توفّراً للطلب الصاعد وقس التحويل.'));
      break;
    case 'FALLING_DEMAND':
      out.push(mk('falling_demand', 'medium', 'medium', 'medium', 'افحص سبب الانخفاض (موسمية/عرض/جمهور) واختبر متغيّراً واحداً.'));
      break;
    case 'LOW_CONVERSION':
      out.push(mk('needs_different_offer', 'medium', 'medium', 'medium', 'اختبر عرضاً مختلفاً (تقسيط/مقدّم) واقس التحويل.'));
      break;
    case 'LOW_INTEREST_LOW_SALES':
      out.push(mk('needs_better_audience', 'medium', 'medium', 'medium', 'اختبر جمهوراً مختلفاً واقس الاهتمام والمبيعات.'));
      break;
    default:
      break;
  }

  if ((f.priceObjections ?? 0) >= PRODUCT_MIN_SAMPLE) out.push(mk('repeated_price_objections', 'high', 'low', 'medium', 'اختبر عرض سعر/تقسيط أو رسالة قيمة واقس الاعتراضات.'));
  if ((f.installmentQuestions ?? 0) >= PRODUCT_MIN_SAMPLE) out.push(mk('repeated_installment_questions', 'high', 'low', 'low', 'وضّح خيارات التقسيط الموثّقة وقس الأسئلة المتكرّرة.'));
  if (!f.availabilityVerified && (f.availabilityRequests ?? 0) >= PRODUCT_MIN_SAMPLE) out.push(mk('requested_unavailable', 'high', 'low', 'medium', 'ثبّت التوفّر الموثّق واختبر أثره على التحويل.'));
  if ((f.specificationRequests ?? 0) >= PRODUCT_MIN_SAMPLE) out.push(mk('repeated_information_request', 'medium', 'low', 'low', 'أضف المواصفات الموثّقة الناقصة وقس الأسئلة المتكرّرة.'));
  if (!f.priceVerified && intel.sampleSize >= PRODUCT_MIN_SAMPLE) out.push(mk('needs_better_presentation', 'medium', 'low', 'low', 'ثبّت السعر الموثّق أولاً (لا يُخترع) ثم قس التحويل.'));

  return out;
}

export interface ProductIntelSummary {
  total: number;
  insufficient: number;
  opportunities: number;
  topOpportunityId: string | null;
  byStatus: Record<ProductCommercialStatus, number>;
}

export function summarizeProductIntel(intel: ProductIntelligence[], opportunities: ProductOpportunity[]): ProductIntelSummary {
  const byStatus = Object.fromEntries(
    (Object.keys(PRODUCT_STATUS_LABELS_AR) as ProductCommercialStatus[]).map((s) => [s, 0]),
  ) as Record<ProductCommercialStatus, number>;
  for (const i of intel) byStatus[i.status] = (byStatus[i.status] || 0) + 1;
  return {
    total: intel.length,
    insufficient: byStatus.DATA_INSUFFICIENT,
    opportunities: opportunities.length,
    topOpportunityId: opportunities.length ? opportunities[0].id : null,
    byStatus,
  };
}
