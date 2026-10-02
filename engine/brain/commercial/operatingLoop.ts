/**
 * Commercial Operating Loop — دورة التشغيل التجارية المركزية (منطق خالص).
 *
 * الغرض: تمثيل الحلقة النهائية صراحةً:
 *   OBSERVE → UNDERSTAND → VERIFY → RESEARCH → IDENTIFY_OPPORTUNITY → PRIORITIZE →
 *   HYPOTHESIS → PLAN → PREPARE → OWNER_APPROVAL → ACT_WITHIN_AUTHORITY → MEASURE →
 *   COMPARE_EXPECTED_VS_ACTUAL → LEARN → UPDATE_STRATEGY → PROPOSE_IMPROVEMENT →
 *   TEST → AUDIT → IMPROVE_SAFELY → REPEAT
 *
 * ولا يتقدّم النظام إلى خطوة تحتاج موافقة مالك بلا موافقة صريحة. الخطوات الخارجية
 * (ACT_WITHIN_AUTHORITY) تبقى مشروطة ببوابة الصلاحيات ولا تُنفَّذ هنا.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر `nowMs`.
 */

export type OperatingLoopStep =
  | 'OBSERVE' | 'UNDERSTAND' | 'VERIFY' | 'RESEARCH' | 'IDENTIFY_OPPORTUNITY'
  | 'PRIORITIZE' | 'HYPOTHESIS' | 'PLAN' | 'PREPARE' | 'OWNER_APPROVAL'
  | 'ACT_WITHIN_AUTHORITY' | 'MEASURE' | 'COMPARE_EXPECTED_VS_ACTUAL' | 'LEARN'
  | 'UPDATE_STRATEGY' | 'PROPOSE_IMPROVEMENT' | 'TEST' | 'AUDIT' | 'IMPROVE_SAFELY' | 'REPEAT';

export const OPERATING_LOOP_ORDER: readonly OperatingLoopStep[] = Object.freeze([
  'OBSERVE', 'UNDERSTAND', 'VERIFY', 'RESEARCH', 'IDENTIFY_OPPORTUNITY', 'PRIORITIZE',
  'HYPOTHESIS', 'PLAN', 'PREPARE', 'OWNER_APPROVAL', 'ACT_WITHIN_AUTHORITY', 'MEASURE',
  'COMPARE_EXPECTED_VS_ACTUAL', 'LEARN', 'UPDATE_STRATEGY', 'PROPOSE_IMPROVEMENT',
  'TEST', 'AUDIT', 'IMPROVE_SAFELY', 'REPEAT',
]);

export const OPERATING_LOOP_LABELS_AR: Record<OperatingLoopStep, string> = Object.freeze({
  OBSERVE: 'مراقبة',
  UNDERSTAND: 'فهم',
  VERIFY: 'تحقّق',
  RESEARCH: 'بحث',
  IDENTIFY_OPPORTUNITY: 'تحديد فرصة',
  PRIORITIZE: 'ترتيب أولوية',
  HYPOTHESIS: 'فرضية',
  PLAN: 'تخطيط',
  PREPARE: 'تحضير',
  OWNER_APPROVAL: 'موافقة المالك',
  ACT_WITHIN_AUTHORITY: 'تنفيذ ضمن الصلاحية',
  MEASURE: 'قياس',
  COMPARE_EXPECTED_VS_ACTUAL: 'مقارنة المتوقّع بالواقع',
  LEARN: 'تعلّم',
  UPDATE_STRATEGY: 'تحديث الاستراتيجية',
  PROPOSE_IMPROVEMENT: 'اقتراح تحسين',
  TEST: 'اختبار',
  AUDIT: 'تدقيق',
  IMPROVE_SAFELY: 'تحسين آمن',
  REPEAT: 'تكرار',
});

/** الخطوات التي تتطلب موافقة المالك قبل المتابعة. */
export const APPROVAL_GATED_STEPS: readonly OperatingLoopStep[] = Object.freeze(['OWNER_APPROVAL', 'ACT_WITHIN_AUTHORITY', 'IMPROVE_SAFELY']);

/** الخطوات الخارجية (لا تُنفَّذ في طبقة الذكاء). */
export const EXTERNAL_STEPS: readonly OperatingLoopStep[] = Object.freeze(['ACT_WITHIN_AUTHORITY', 'IMPROVE_SAFELY']);

export interface OperatingLoopState {
  currentStep: OperatingLoopStep;
  completed: OperatingLoopStep[];
  pending: OperatingLoopStep[];
  /** الخطوة التالية (null عند اكتمال الدورة — تُعاد من REPEAT). */
  nextStep: OperatingLoopStep | null;
  /** هل الخطوة التالية موقوفة على موافقة مالك؟ */
  blockedOnOwnerApproval: boolean;
  reason: string;
}

/**
 * يحسب حالة الحلقة من الخطوات المكتملة. لا يقفز خطوة موافقة/تنفيذ بلا اعتماد؛
 * وغياب اعتماد المالك يوقف التقدّم عند `OWNER_APPROVAL`.
 */
export function advanceOperatingLoop(input: {
  completed: OperatingLoopStep[];
  ownerApproved?: boolean;
}): OperatingLoopState {
  const completedSet = new Set(input.completed);
  const pending = OPERATING_LOOP_ORDER.filter((s) => !completedSet.has(s));
  const currentStep = pending[0] ?? 'REPEAT';
  const idx = OPERATING_LOOP_ORDER.indexOf(currentStep);
  const nextStep = OPERATING_LOOP_ORDER[idx + 1] ?? null;

  const needsApproval = APPROVAL_GATED_STEPS.includes(currentStep) && !input.ownerApproved;
  return {
    currentStep,
    completed: [...input.completed],
    pending,
    nextStep,
    blockedOnOwnerApproval: needsApproval,
    reason: needsApproval
      ? `الخطوة «${OPERATING_LOOP_LABELS_AR[currentStep]}» تتطلّب اعتماد المالك — لا تقدّم بلا موافقة.`
      : `الخطوة الحالية: ${OPERATING_LOOP_LABELS_AR[currentStep]}.`,
  };
}

/** الأسئلة التجارية التي يطرحها العقل باستمرار (§47). */
export const FINAL_COMMERCIAL_QUESTIONS: readonly string[] = Object.freeze([
  'كيف يبيع الغرابي أكثر؟',
  'ما الدليل الذي أملكه؟',
  'ما الذي يمنع البيع؟',
  'أي منتجات عليها طلب حقيقي؟',
  'أي عملاء يُظهرون نية شراء حقيقية؟',
  'أي عملاء يحتاجون انتباهاً؟',
  'أي حملة تنتج طلباً مؤهّلاً؟',
  'أي حملة تنتج مبيعات موثّقة؟',
  'لماذا ترتفع المبيعات أو تنخفض؟',
  'أين نخسر العملاء؟',
  'ما الذي نختبره بعد ذلك؟',
  'ماذا تعلّمنا؟',
  'هل التعلّم حسّن النتائج الموثّقة فعلاً؟',
  'ما الذي يمكن تحسينه بأمان؟',
  'ما الذي يحتاج موافقة المالك؟',
]);
