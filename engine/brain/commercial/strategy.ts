/**
 * Commercial Strategy & Priority Engine — الاستراتيجية والأولويات والأهداف (منطق خالص).
 *
 * الغرض: تحويل الأدلة التجارية إلى:
 *   - توصيات قابلة للتفسير (WHY / EVIDENCE / BENEFIT / COST / RISK / CONFIDENCE / NEXT STEP)
 *   - ترتيب أولويات للفرص (لا قائمة لا نهائية بلا ترتيب)
 *   - أهداف تجارية بخط أساس موثّق (لا خط أساس مُختلق)
 *   - شرح قرار تجاري كامل (WHY THIS? WHY NOW? …)
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر `nowMs`.
 */

import type { ObjectiveTier } from './northStar';
import { tierOfMetric, vanityRejectionReason, isVanityMetric } from './northStar';

export interface CommercialRecommendation {
  id: string;
  /** «ماذا نفعل؟» */
  action: string;
  /** «لماذا؟» — إلزامي. */
  why: string;
  evidence: string[];
  expectedBenefit: string;
  cost: string;
  risk: 'low' | 'medium' | 'high';
  confidence: 'low' | 'medium' | 'high';
  nextStep: string;
  /** الهدف الذي يخدمه (فئة الغاية العليا). */
  servesObjective: ObjectiveTier;
  sampleSize: number;
  limitations: string[];
}

export interface RecommendationInput {
  id: string;
  action: string;
  why: string;
  evidence: string[];
  expectedBenefit: string;
  cost?: string;
  risk?: 'low' | 'medium' | 'high';
  sampleSize: number;
  nextStep?: string;
  objectiveMetric?: string;
}

/** الحد الأدنى لعيّنة التوصية — لا توصية بلا دليل. */
export const MIN_RECOMMENDATION_SAMPLE = 1;

/**
 * يبني توصية تجارية قابلة للتفسير. ترفض التوصية إن كان هدفها مقياساً وهمياً، أو إن
 * لم يوجد دليل/سبب.
 */
export function buildCommercialRecommendation(input: RecommendationInput): { ok: true; recommendation: CommercialRecommendation } | { ok: false; code: string; error: string } {
  if (!input.why || !input.why.trim()) return { ok: false, code: 'NO_WHY', error: 'لا توصية بلا سبب (WHY).' };
  if (!input.evidence || input.evidence.length === 0) return { ok: false, code: 'NO_EVIDENCE', error: 'لا توصية بلا دليل.' };
  const objectiveMetric = input.objectiveMetric || 'verified_sales';
  if (isVanityMetric(objectiveMetric)) return { ok: false, code: 'VANITY_OBJECTIVE', error: vanityRejectionReason(objectiveMetric) };
  return {
    ok: true,
    recommendation: {
      id: input.id,
      action: input.action,
      why: input.why,
      evidence: [...input.evidence],
      expectedBenefit: input.expectedBenefit,
      cost: input.cost || 'غير معروف — يلزم تقدير المالك.',
      risk: input.risk || 'low',
      confidence: input.sampleSize >= 3 ? 'medium' : 'low',
      nextStep: input.nextStep || 'اختبار متغيّر واحد وقياس أثره على المبيعات الموثّقة.',
      servesObjective: tierOfMetric(objectiveMetric),
      sampleSize: input.sampleSize,
      limitations: ['التوصية توجيه لا تنفيذ؛ التنفيذ يمر ببوابات الصلاحيات.'],
    },
  };
}

// ---------------------------------------------------------------------------
// ترتيب أولويات الفرص (§20)
// ---------------------------------------------------------------------------

export interface PrioritizableOpportunity {
  id: string;
  title: string;
  /** الأثر التجاري المتوقّع (من دليل). */
  expectedImpact: 'high' | 'medium' | 'low';
  evidenceStrength: 'strong' | 'moderate' | 'weak';
  confidence: 'low' | 'medium' | 'high';
  urgency: 'high' | 'medium' | 'low';
  cost: 'low' | 'medium' | 'high';
  difficulty: 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
  sampleSize: number;
}

export interface PrioritizedOpportunity extends PrioritizableOpportunity {
  rank: number;
  score: number;
  rationale: string;
}

const LEVEL = { high: 3, medium: 2, low: 1 } as const;
const STRENGTH = { strong: 3, moderate: 2, weak: 1 } as const;

/**
 * يرتّب الفرص بوزن صريح (أثر + قوة دليل + ثقة + إلحاح) مطروحاً منه (تكلفة + صعوبة +
 * خطر). العيّنة غير الكافية تُخفض الدرجة. **لا** يُخترع رقم بلا دليل.
 */
export function prioritizeOpportunities(items: PrioritizableOpportunity[]): PrioritizedOpportunity[] {
  const scored = items.map((it) => {
    const positive = LEVEL[it.expectedImpact] * 3 + STRENGTH[it.evidenceStrength] * 2 + LEVEL[it.confidence] * 2 + LEVEL[it.urgency] * 2;
    const negative = LEVEL[it.cost] + LEVEL[it.difficulty] + LEVEL[it.risk];
    const samplePenalty = it.sampleSize < 3 ? 2 : 0;
    const score = positive - negative - samplePenalty;
    return {
      ...it,
      score,
      rank: 0,
      rationale: `أثر=${it.expectedImpact} · دليل=${it.evidenceStrength} · ثقة=${it.confidence} · إلحاح=${it.urgency} · تكلفة=${it.cost} · صعوبة=${it.difficulty} · خطر=${it.risk}${samplePenalty ? ' · عيّنة صغيرة (−)' : ''}`,
    };
  });
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  scored.forEach((it, i) => { it.rank = i + 1; });
  return scored;
}

// ---------------------------------------------------------------------------
// الأهداف التجارية (§36)
// ---------------------------------------------------------------------------

export type CommercialGoalKind =
  | 'increase_verified_sales' | 'improve_lead_conversion' | 'reduce_lost_opportunities'
  | 'improve_follow_up_conversion' | 'improve_campaign_attribution' | 'increase_verified_profit';

export const COMMERCIAL_GOAL_LABELS_AR: Record<CommercialGoalKind, string> = Object.freeze({
  increase_verified_sales: 'زيادة المبيعات الموثّقة',
  improve_lead_conversion: 'تحسين تحويل العملاء المؤهّلين',
  reduce_lost_opportunities: 'تقليل الفرص المفقودة',
  improve_follow_up_conversion: 'تحسين تحويل المتابعة',
  improve_campaign_attribution: 'تحسين إسناد الحملة إلى البيع',
  increase_verified_profit: 'زيادة الربح الموثّق (عند توفّر التكلفة)',
});

export interface CommercialGoal {
  id: string;
  kind: CommercialGoalKind;
  target: number;
  timePeriod: string;
  /** القيمة الموثّقة الحالية (null = لا خط أساس موثّق ⇒ لا ادّعاء تقدّم). */
  currentVerified: number | null;
  evidence: string[];
  strategy: string;
  progressPct: number | null;
  nextAction: string;
  limitations: string[];
}

export interface CommercialGoalInput {
  id: string;
  kind: CommercialGoalKind;
  target: number;
  timePeriod: string;
  currentVerified: number | null;
  evidence?: string[];
  strategy?: string;
  nowMs: number;
}

/**
 * يبني هدفاً تجارياً. **لا يُخترع خط أساس**: غياب القيمة الموثّقة ⇒ `progressPct=null`
 * وإجراء أول «سجّل خط الأساس». والربح لا يُهدف إليه بلا بيانات تكلفة.
 */
export function buildCommercialGoal(input: CommercialGoalInput): CommercialGoal {
  const limitations: string[] = [];
  let progressPct: number | null = null;
  let nextAction: string;

  if (input.currentVerified === null) {
    limitations.push('لا خط أساس موثّق — لا يُعلن تقدّم.');
    nextAction = 'سجّل خط الأساس الموثّق أولاً (لا يُخترع).';
  } else if (input.target <= 0) {
    limitations.push('الهدف غير موجب.');
    nextAction = 'صحّح قيمة الهدف.';
  } else {
    progressPct = Math.round((input.currentVerified / input.target) * 10_000) / 100;
    nextAction = progressPct >= 100 ? 'تحقّق من ديمومة النتيجة بمدّة أطول.' : 'حدّد فرصة مرتّبة عالية الأثر لسدّ الفجوة.';
  }

  if (input.kind === 'increase_verified_profit' && input.currentVerified === null) {
    limitations.push('الربح يحتاج إيراداً موثّقاً + تكلفة موثوقة؛ لا يُهدف إليه بلا تكلفة.');
  }

  return {
    id: input.id,
    kind: input.kind,
    target: input.target,
    timePeriod: input.timePeriod,
    currentVerified: input.currentVerified,
    evidence: [...(input.evidence || [])],
    strategy: input.strategy || 'استراتيجية تُشتقّ من الأدلة والفرص المرتّبة.',
    progressPct,
    nextAction,
    limitations,
  };
}

// ---------------------------------------------------------------------------
// شرح القرار التجاري (§38)
// ---------------------------------------------------------------------------

export interface CommercialDecisionExplanation {
  decision: string;
  whyThis: string;
  whyNow: string;
  basedOn: string[];
  confidence: 'low' | 'medium' | 'high';
  whatCouldMakeThisWrong: string[];
  whatToTest: string;
  generatedFrom: 'stored_evidence';
}

export interface DecisionExplanationInput {
  decision: string;
  whyThis: string;
  whyNow: string;
  evidence: string[];
  sampleSize: number;
  alternativeExplanations?: string[];
  whatToTest?: string;
}

/** يبني شرح قرار من **أدلة مخزّنة** فقط. لا شرح بلا أدلة. */
export function explainCommercialDecision(input: DecisionExplanationInput): CommercialDecisionExplanation {
  return {
    decision: input.decision,
    whyThis: input.whyThis,
    whyNow: input.whyNow,
    basedOn: [...input.evidence],
    confidence: input.sampleSize >= 5 ? 'high' : input.sampleSize >= 3 ? 'medium' : 'low',
    whatCouldMakeThisWrong: input.alternativeExplanations?.length
      ? [...input.alternativeExplanations]
      : ['موسمية', 'تغيّر عرض', 'تغيّر جمهور', 'خطأ قياس', 'عيّنة صغيرة'],
    whatToTest: input.whatToTest || 'اختبار متغيّر واحد لعزل السبب.',
    generatedFrom: 'stored_evidence',
  };
}

export interface StrategySummary {
  total: number;
  highImpact: number;
  averageScore: number;
  topId: string | null;
  limitations: string[];
}

export function summarizeStrategy(items: PrioritizedOpportunity[]): StrategySummary {
  return {
    total: items.length,
    highImpact: items.filter((i) => i.expectedImpact === 'high').length,
    averageScore: items.length ? Math.round((items.reduce((s, i) => s + i.score, 0) / items.length) * 100) / 100 : 0,
    topId: items.length ? items[0].id : null,
    limitations: ['الترتيب بوزن صريح قابل للتدقيق؛ لا قائمة لا نهائية بلا أولوية.'],
  };
}
