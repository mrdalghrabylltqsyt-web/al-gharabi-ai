/**
 * Goal Management — إدارة أهداف العقل المركزي (منطق خالص قابل للاختبار).
 *
 * الغرض: أن يعرف العقل **لماذا** يعمل الآن: الهدف الأعلى (زيادة فرص البيع
 * والإيراد الحقيقي) ← الهدف الحالي ← الأهداف الفرعية ← الخطوة التالية الأنسب.
 * يستخدم قائمة أهداف اجتماعية/تسويقية مشروعة فقط، **بلا أنظمة KPI مالية** ولا
 * إيراد/ربح/ROI مُخترع.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import type { GoalPlan, GoalNode } from './types';

/**
 * أهداف اجتماعية/تسويقية معتمدة (مرتبطة بقُمع الاهتمام→الاستفسار→إشارة الشراء).
 * لا تشمل أي هدف مالي.
 */
export type SocialGoalKind =
  | 'INCREASE_ENGAGEMENT'
  | 'CONVERT_ATTENTION_TO_INQUIRY'
  | 'RESPOND_TO_BUYING_INTENT'
  | 'IMPROVE_CONTENT_PERFORMANCE'
  | 'IDENTIFY_AUDIENCE_OPPORTUNITY'
  | 'FOLLOW_UP_APPROPRIATELY'
  | 'INCREASE_PURCHASE_SIGNALS';

export const SOCIAL_GOAL_LABELS_AR: Readonly<Record<SocialGoalKind, string>> = Object.freeze({
  INCREASE_ENGAGEMENT: 'رفع التفاعل',
  CONVERT_ATTENTION_TO_INQUIRY: 'تحويل الانتباه إلى استفسار',
  RESPOND_TO_BUYING_INTENT: 'الرد على نية الشراء',
  IMPROVE_CONTENT_PERFORMANCE: 'تحسين أداء المحتوى',
  IDENTIFY_AUDIENCE_OPPORTUNITY: 'اكتشاف فرصة جمهور',
  FOLLOW_UP_APPROPRIATELY: 'متابعة مناسبة',
  INCREASE_PURCHASE_SIGNALS: 'زيادة إشارات الشراء',
});

/** الهدف الأعلى الثابت للمشروع (نص واحد لا يُخترع). */
export const PRIMARY_BUSINESS_OBJECTIVE = 'زيادة فرص البيع والمبيعات الحقيقية عبر السوشيال والتسويق (بلا اختراع أي رقم مالي).';

/** حقول لا يُسمح لأي هدف اجتماعي أن يشير لأرقامها المالية (حرس صريح). */
export const OUT_OF_SCOPE_FINANCIAL_TERMS: readonly string[] = Object.freeze([
  'إيراد', 'ربح', 'ROI', 'هامش ربح', 'تكلفة اكتساب', 'قيمة عمر العميل', 'محاسبة', 'مخزون',
]);

export interface GoalInput {
  now: number;
  /** الحدث الحالي (سؤال/شكوى/مدح/نية شراء…). */
  eventCategory: 'question' | 'complaint' | 'objection' | 'purchase_intent' | 'feature_request' | 'content_request' | 'praise' | 'spam' | 'unknown';
  /** موضوع الحدث (سعر/موقع/توفر/دوام/عام). */
  topic: string | null;
  /** هل السعر/المعلومة الحسّاسة موثّقة؟ (يحدّد الهدف والحجب). */
  priceUnverified: boolean;
  /** هل يوجد إشارة طلب/فرصة جمهور ملاحَظة؟ (من بيانات حقيقية فقط). */
  hasAudienceOpportunity: boolean;
  /** هل التعليق/الطلب يحتاج توضيحاً؟ */
  needsClarification: boolean;
  /** هل يوجد تصعيد معلّق في هذا السياق؟ */
  hasPendingEscalation: boolean;
}

/** يحدّد الهدف الحالي حتمياً من الحدث (بأسبقية صريحة). */
export function resolveCurrentGoal(input: GoalInput): { kind: SocialGoalKind; rationale: string } {
  if (input.hasPendingEscalation) {
    return { kind: 'FOLLOW_UP_APPROPRIATELY', rationale: 'يوجد تصعيد معلّق في هذا السياق يتطلب متابعة قبل أي إجراء جديد.' };
  }
  if (input.eventCategory === 'complaint' || input.priceUnverified) {
    return { kind: 'RESPOND_TO_BUYING_INTENT', rationale: 'الحدث حسّاس (شكوى/سعر غير موثّق) ويتعلق بنية شراء أو ثقة؛ يُعالَج بحذر مع تصعيد بشري.' };
  }
  if (input.eventCategory === 'purchase_intent') {
    return { kind: 'RESPOND_TO_BUYING_INTENT', rationale: 'الحدث يحمل نية شراء صريحة؛ الأولوية للرد من الحقائق المسجّلة.' };
  }
  if (input.eventCategory === 'question' && input.needsClarification) {
    return { kind: 'CONVERT_ATTENTION_TO_INQUIRY', rationale: 'سؤال يحتاج توضيحاً لتحويل الانتباه إلى استفسار مؤهّل.' };
  }
  if (input.eventCategory === 'content_request' || input.eventCategory === 'feature_request') {
    return { kind: 'IMPROVE_CONTENT_PERFORMANCE', rationale: 'طلب محتوى/ميزة يشير إلى حاجة جمهور تستحق محتوى موجّهاً.' };
  }
  if (input.eventCategory === 'question') {
    return { kind: 'CONVERT_ATTENTION_TO_INQUIRY', rationale: 'سؤال جمهور يعكس اهتماماً؛ يُوجَّه نحو استفسار.' };
  }
  if (input.eventCategory === 'praise' || input.eventCategory === 'objection') {
    return { kind: 'INCREASE_ENGAGEMENT', rationale: 'تفاعل/اعتراض يعكس علاقة؛ يُبنى عليه التفاعل.' };
  }
  if (input.eventCategory === 'spam') {
    return { kind: 'INCREASE_ENGAGEMENT', rationale: 'سبام؛ لا يُردّ آلياً — الهدف الحفاظ على جودة التفاعل.' };
  }
  if (input.hasAudienceOpportunity) {
    return { kind: 'IDENTIFY_AUDIENCE_OPPORTUNITY', rationale: 'توجد فرصة جمهور ملاحَظة من بيانات حقيقية.' };
  }
  return { kind: 'INCREASE_PURCHASE_SIGNALS', rationale: 'الهدف الافتراضي: زيادة إشارات الشراء من التفاعل المتاح.' };
}

/** يبني أهدافاً فرعية مشروعة من الهدف الحالي (بلا أرقام مالية). */
export function buildSubGoals(kind: SocialGoalKind, input: GoalInput): GoalNode[] {
  const base: Record<SocialGoalKind, string[]> = {
    INCREASE_ENGAGEMENT: ['الردّ المناسب على التفاعل', 'تحفيز حوار لطيف'],
    CONVERT_ATTENTION_TO_INQUIRY: ['الإجابة الواضحة من الحقائق', 'دعوة للتواصل'],
    RESPOND_TO_BUYING_INTENT: ['الرد من الحقائق المسجّلة', 'حماية الثقة (لا رقم غير موثّق)'],
    IMPROVE_CONTENT_PERFORMANCE: ['رصد الحاجة المتكررة', 'اقتراح محتوى موجّه (يحتاج اعتماد المالك)'],
    IDENTIFY_AUDIENCE_OPPORTUNITY: ['رصد الموضوعات المتكررة', 'اقتراح اختبار بمتغيّر واحد'],
    FOLLOW_UP_APPROPRIATELY: ['متابعة التصعيد المعلّق', 'مراجعة بشرية قبل الإجراء'],
    INCREASE_PURCHASE_SIGNALS: ['عرض المنتج/التقسيط من بيانات مسجّلة', 'تسهيل التواصل'],
  };
  return (base[kind] || []).map((labelAr, i) => ({
    id: `sub-${kind}-${i}`,
    kind: 'SUB_GOAL',
    labelAr,
    rationale: `هدف فرعي مشروع ضمن «${SOCIAL_GOAL_LABELS_AR[kind]}».`,
    status: 'active' as const,
  }));
}

/** الخطوة التالية الأنسب نصياً (توجيه، لا تنفيذ). */
export function resolveNextBestStep(kind: SocialGoalKind, input: GoalInput): string {
  switch (kind) {
    case 'RESPOND_TO_BUYING_INTENT':
      return input.priceUnverified ? 'صعّد للمالك لتسجيل السعر الموثّق، ثم صُغ رداً آمناً بلا رقم مُخترع.' : 'صُغ رداً من الحقائق المسجّلة ومرّره عبر بوابات المشروع.';
    case 'CONVERT_ATTENTION_TO_INQUIRY':
      return input.needsClarification ? 'اطلب توضيحاً واحداً محدداً لتأهيل الاستفسار.' : 'قدّم إجابة موجزة موثّقة مع دعوة للتواصل.';
    case 'IMPROVE_CONTENT_PERFORMANCE':
      return 'اقترح محتوى موجّهاً للحاجة الملاحَظة (يحتاج اعتماد المالك قبل أي نشر).';
    case 'IDENTIFY_AUDIENCE_OPPORTUNITY':
      return 'صُغ فرضية محتوى واختبرها بمتغيّر واحد على بيانات حقيقية.';
    case 'FOLLOW_UP_APPROPRIATELY':
      return 'راجع التصعيد المعلّق بشرياً قبل أي إجراء — لا أتمتة على الحساس.';
    case 'INCREASE_ENGAGEMENT':
      return 'تفاعل مناسب قصير (بلا رقم مُخترع) للحفاظ على العلاقة.';
    case 'INCREASE_PURCHASE_SIGNALS':
    default:
      return 'حلّل الإشارات المتاحة وحدّد أقرب حاجة جمهور موثّقة لتحويلها إلى استفسار.';
  }
}

/**
 * يبني خطة الأهداف الكاملة: الهدف الأعلى ← الحالي ← الفرعية ← الخطوة التالية.
 * يمنع أي إشارة لأرقام مالية غير مشروعة.
 */
export function buildGoalPlan(input: GoalInput): GoalPlan {
  const { kind, rationale } = resolveCurrentGoal(input);
  const currentGoal: GoalNode = {
    id: `goal-${kind}`,
    kind,
    labelAr: SOCIAL_GOAL_LABELS_AR[kind],
    rationale,
    status: 'active',
  };
  const subGoals = buildSubGoals(kind, input);
  return {
    primaryObjective: PRIMARY_BUSINESS_OBJECTIVE,
    currentGoal,
    subGoals,
    nextBestStep: resolveNextBestStep(kind, input),
    limitations: [
      'الأهداف اجتماعية/تسويقية فقط؛ لا أهداف مالية ولا أنظمة KPI إيراد/ربح.',
      'الخطوة التالية توجيه؛ التنفيذ يمرّ عبر الحوكمة وبوابات المشروع.',
      'الأرقام (سعر/تقسيط) لا تُذكر بلا بيانات مسجّلة.',
    ],
  };
}

/** حارس صريح: هل تحتوي الخطة على مصطلحات مالية خارج النطاق؟ (يجب أن تكون false). */
export function goalPlanViolatesScope(plan: GoalPlan): { violates: boolean; found: string[] } {
  const text = `${plan.primaryObjective} ${plan.currentGoal.labelAr} ${plan.currentGoal.rationale} ${plan.subGoals.map((s) => s.labelAr).join(' ')} ${plan.nextBestStep}`;
  const found = OUT_OF_SCOPE_FINANCIAL_TERMS.filter((t) => text.includes(t));
  return { violates: found.length > 0, found };
}
