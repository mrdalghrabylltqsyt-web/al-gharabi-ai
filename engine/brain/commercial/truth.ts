/**
 * Commercial Truth Layer — طبقة الحقيقة التجارية المركزية (منطق خالص).
 *
 * الغرض: حالة صدق موحّدة **أوسع** من `knowledge/truth.ts` (التي تغطي حقائق المعرفة
 * العامة)، مخصّصة للحقائق التجارية القابلة للتغيّر (سعر/قسط/توفر/مواصفات/عرض/حملة/بيع)
 * مع **طزاجة** و**كشف تعارض** و**جودة بيانات**.
 *
 * الحالات (كما تطلبها الدفعة النهائية):
 *   VERIFIED / DERIVED / OBSERVED / INFERRED / HYPOTHESIS / RECOMMENDATION / UNKNOWN / STALE / CONFLICTING
 *
 * القواعد الملزمة:
 * - لا ترقية HYPOTHESIS → FACT ولا AI_STATEMENT → FACT بلا تحقّق.
 * - القيمة القديمة تُعلن STALE ولا تُعرض كحالية.
 * - تعارض مصدرين موثوقين يُعلن CONFLICTING صراحةً — لا اختيار صامت.
 * - جودة بيانات غير كافية ⇒ تخفيض الثقة أو NOT_ENOUGH_EVIDENCE.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر `nowMs`.
 */

export type CommercialTruthState =
  | 'VERIFIED'
  | 'DERIVED'
  | 'OBSERVED'
  | 'INFERRED'
  | 'HYPOTHESIS'
  | 'RECOMMENDATION'
  | 'UNKNOWN'
  | 'STALE'
  | 'CONFLICTING';

export const COMMERCIAL_TRUTH_LABELS_AR: Record<CommercialTruthState, string> = Object.freeze({
  VERIFIED: 'موثّق',
  DERIVED: 'استنتاج حسابي',
  OBSERVED: 'مُلاحَظ من بيانات المنصة',
  INFERRED: 'مستنتج (ليس حقيقة)',
  HYPOTHESIS: 'فرضية تحتاج اختباراً',
  RECOMMENDATION: 'توصية',
  UNKNOWN: 'مجهول',
  STALE: 'قديم — يحتاج تحديثاً',
  CONFLICTING: 'مصادر متعارضة',
});

/** حالة الطزاجة لحقيقة تجارية. */
export type FreshnessState = 'FRESH' | 'AGING' | 'STALE' | 'UNKNOWN';

export const FRESHNESS_LABELS_AR: Record<FreshnessState, string> = Object.freeze({
  FRESH: 'حديث',
  AGING: 'يقترب من التقادم',
  STALE: 'قديم',
  UNKNOWN: 'عمر غير معروف',
});

/** الحالات التي يمكن استخدامها في إجابة تجارية موثوقة. */
export const USABLE_TRUTH_STATES: readonly CommercialTruthState[] = Object.freeze(['VERIFIED', 'DERIVED', 'OBSERVED']);

export function isUsableTruth(state: CommercialTruthState): boolean {
  return USABLE_TRUTH_STATES.includes(state);
}

/** حدود الطزاجة الافتراضية لكل نوع حقيقة تجارية (بالدقائق). */
export const COMMERCIAL_FRESHNESS_POLICY: Readonly<Record<string, number>> = Object.freeze({
  price: 30 * 24 * 60,        // السعر قد يتغيّر — شهر
  installment: 30 * 24 * 60,
  availability: 2 * 24 * 60,  // التوفر يتغيّر أسرع
  specifications: 180 * 24 * 60,
  approved_offer: 30 * 24 * 60,
  campaign_state: 24 * 60,
  sales_data: 24 * 60,
});

export function freshnessPolicyMinutes(field: string): number {
  return COMMERCIAL_FRESHNESS_POLICY[field] ?? 7 * 24 * 60;
}

/**
 * يحسم الطزاجة من عمر القيمة: FRESH ≤ 60%، AGING ≤ 100%، STALE > 100%.
 */
export function classifyFreshness(lastVerifiedAt: string | null | undefined, field: string, nowMs: number): FreshnessState {
  if (!lastVerifiedAt) return 'UNKNOWN';
  const at = Date.parse(lastVerifiedAt);
  if (!Number.isFinite(at)) return 'UNKNOWN';
  const ageMin = Math.max(0, (nowMs - at) / 60_000);
  const max = freshnessPolicyMinutes(field);
  if (ageMin <= max * 0.6) return 'FRESH';
  if (ageMin <= max) return 'AGING';
  return 'STALE';
}

export interface CommercialFact {
  key: string;
  value: unknown;
  state: CommercialTruthState;
  freshness: FreshnessState;
  source: string | null;
  observedAt: string | null;
  confidence: 'low' | 'medium' | 'high';
  sampleSize: number;
  limitations: string;
  /** عند STALE: القيمة لا تُعرض كحالية. */
  requiresVerification: boolean;
  /** عند CONFLICTING: مصادر متعارضة معلنة. */
  conflict?: { sourceA: string; sourceB: string; at: string | null; impact: string } | null;
}

export interface CommercialFactInput {
  key: string;
  value: unknown;
  state: CommercialTruthState;
  source?: string | null;
  observedAt?: string | null;
  confidence?: 'low' | 'medium' | 'high';
  sampleSize?: number;
  limitations?: string;
  nowMs: number;
}

/**
 * يبني حقيقة تجارية مع تطبيق الطزاجة. حقيقة موثّقة/مُلاحَظة قديمة تُرقّى حالتها إلى
 * `STALE` تلقائياً (لا تُعرض كحالية)، ويُرفع `requiresVerification`.
 */
export function makeCommercialFact(input: CommercialFactInput): CommercialFact {
  const freshness = classifyFreshness(input.observedAt ?? null, input.key, input.nowMs);
  const baseUsable = isUsableTruth(input.state);
  const stale = baseUsable && freshness === 'STALE';
  const state: CommercialTruthState = stale ? 'STALE' : input.state;
  return {
    key: input.key,
    value: input.value,
    state,
    freshness,
    source: input.source ?? null,
    observedAt: input.observedAt ?? null,
    confidence: input.confidence ?? (input.sampleSize && input.sampleSize >= 3 ? 'medium' : 'low'),
    sampleSize: input.sampleSize ?? 0,
    limitations: input.limitations || 'حقيقة تجارية تُراجَع دورياً؛ لا تُعرض كحالية إن تقادمت.',
    requiresVerification: stale || state === 'CONFLICTING' || state === 'UNKNOWN',
    conflict: null,
  };
}

/** هل يجوز استخدام هذه الحقيقة في إجابة تجارية موثوقة؟ */
export function canUseForCommercialAnswer(fact: CommercialFact): { usable: boolean; reason: string } {
  if (fact.state === 'STALE') return { usable: false, reason: 'القيمة قديمة — DATA_REQUIRES_VERIFICATION قبل عرضها كحالية.' };
  if (fact.state === 'CONFLICTING') return { usable: false, reason: 'مصادر متعارضة — تحتاج حسم المالك قبل العرض.' };
  if (!isUsableTruth(fact.state)) return { usable: false, reason: `حالة الصدق (${COMMERCIAL_TRUTH_LABELS_AR[fact.state]}) لا تكفي لإجابة تجارية موثوقة.` };
  if (!fact.source) return { usable: false, reason: 'لا مصدر — لا حقيقة بلا مصدر.' };
  return { usable: true, reason: 'حقيقة موثّقة وحديثة بمصدر معلن.' };
}

/**
 * يكتشف تعارض مصدرين موثوقين لقيمة واحدة. **لا** يختار صامتاً: يُعيد حقيقة
 * `CONFLICTING` تحمل المصدرين والتاريخ والأثر.
 */
export function resolveConflict(input: {
  key: string;
  sourceA: { value: unknown; source: string; at: string | null };
  sourceB: { value: unknown; source: string; at: string | null };
  nowMs: number;
}): { conflicting: boolean; fact: CommercialFact | null } {
  const { sourceA, sourceB } = input;
  const same = JSON.stringify(sourceA.value) === JSON.stringify(sourceB.value);
  if (same) return { conflicting: false, fact: null };
  const fact: CommercialFact = {
    key: input.key,
    value: null,
    state: 'CONFLICTING',
    freshness: 'UNKNOWN',
    source: null,
    observedAt: null,
    confidence: 'low',
    sampleSize: 0,
    limitations: 'مصدران موثوقان يعطيان قيمتين مختلفتين — يلزم حسم المالك.',
    requiresVerification: true,
    conflict: {
      sourceA: sourceA.source, sourceB: sourceB.source,
      at: sourceB.at ?? sourceA.at ?? null,
      impact: 'أي إجابة تجارية تعتمد على هذه القيمة غير آمنة حتى الحسم.',
    },
  };
  return { conflicting: true, fact };
}

/** جودة بيانات: تُقيَّم قبل أي استدلال تجاري. */
export interface DataQualityInput {
  completeness: number;   // 0..1
  consistency: number;    // 0..1
  sourceTrust: number;    // 0..1
  sampleSize: number;
  freshness: FreshnessState;
}

export interface DataQualityVerdict {
  level: 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_ENOUGH_EVIDENCE';
  confidenceCap: 'high' | 'medium' | 'low' | 'none';
  reasons: string[];
}

/** يقيّم جودة البيانات ويحدّ سقف الثقة؛ لا يُخفي القيود. */
export function assessDataQuality(input: DataQualityInput): DataQualityVerdict {
  const reasons: string[] = [];
  if (input.sampleSize < 3) reasons.push('عيّنة أقل من الحد الأدنى (3).');
  if (input.freshness === 'STALE') reasons.push('البيانات قديمة.');
  if (input.freshness === 'UNKNOWN') reasons.push('عمر البيانات غير معروف.');
  if (input.consistency < 0.8) reasons.push('تناسق منخفض بين المصادر.');
  if (input.sourceTrust < 0.7) reasons.push('ثقة مصدر منخفضة.');

  const composite = (input.completeness + input.consistency + input.sourceTrust) / 3;
  if (input.sampleSize < 3 || input.freshness === 'STALE' || composite < 0.5) {
    return { level: 'NOT_ENOUGH_EVIDENCE', confidenceCap: 'none', reasons };
  }
  if (composite >= 0.85 && input.sampleSize >= 5 && input.freshness === 'FRESH') {
    return { level: 'HIGH', confidenceCap: 'high', reasons };
  }
  if (composite >= 0.7) return { level: 'MEDIUM', confidenceCap: 'medium', reasons };
  return { level: 'LOW', confidenceCap: 'low', reasons };
}

export interface CommercialTruthSummary {
  total: number;
  byState: Record<CommercialTruthState, number>;
  needsVerification: number;
  conflicts: number;
  stale: number;
}

export function summarizeCommercialTruth(facts: CommercialFact[]): CommercialTruthSummary {
  const byState = Object.fromEntries(
    (Object.keys(COMMERCIAL_TRUTH_LABELS_AR) as CommercialTruthState[]).map((s) => [s, 0]),
  ) as Record<CommercialTruthState, number>;
  let needsVerification = 0; let conflicts = 0; let stale = 0;
  for (const f of facts) {
    byState[f.state] = (byState[f.state] || 0) + 1;
    if (f.requiresVerification) needsVerification += 1;
    if (f.state === 'CONFLICTING') conflicts += 1;
    if (f.state === 'STALE') stale += 1;
  }
  return { total: facts.length, byState, needsVerification, conflicts, stale };
}
