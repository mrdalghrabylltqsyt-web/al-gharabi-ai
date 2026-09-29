/**
 * Goal Engine — تحديد الهدف قبل أي خطة محتوى (منطق خالص).
 *
 * القاعدة: لا محتوى بلا هدف معلن. كل هدف يحمل إشارات نجاحه وقيوده ونطاقه الزمني
 * والجمهور المستهدف. الهدف التجاري للغرابي هو البيع وبناء علاقة، لا المشاهدات
 * وحدها — لذا `SALES` و`LEADS` أهداف من الدرجة الأولى لا أثر جانبي.
 *
 * لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

export type GoalKind =
  | 'SALES'
  | 'LEADS'
  | 'LOCAL_AWARENESS'
  | 'TRUST'
  | 'ENGAGEMENT'
  | 'FOLLOWER_GROWTH'
  | 'PRODUCT_AWARENESS'
  | 'EDUCATION'
  | 'RETENTION'
  | 'COMMUNITY'
  | 'REACTIVATION';

export const GOAL_LABELS_AR: Record<GoalKind, string> = Object.freeze({
  SALES: 'مبيعات',
  LEADS: 'عملاء محتملون',
  LOCAL_AWARENESS: 'وعي محلي',
  TRUST: 'ثقة',
  ENGAGEMENT: 'تفاعل',
  FOLLOWER_GROWTH: 'نمو متابعين',
  PRODUCT_AWARENESS: 'وعي بالمنتج',
  EDUCATION: 'تعليم',
  RETENTION: 'احتفاظ',
  COMMUNITY: 'مجتمع',
  REACTIVATION: 'إعادة تنشيط',
});

/** إشارة نجاح: مؤشر قابل للقياس مع مصدره المتوقع (قد يكون غير متاح صراحةً). */
export interface SuccessSignal {
  metric: string;
  labelAr: string;
  /** هل المنصة/النظام يوفّر هذا المؤشر فعلاً؟ إن لا، يُعلن ذلك. */
  available: boolean;
  reason?: string;
}

/** إشارات النجاح القياسية لكل هدف. أي إشارة غير متاحة تُعلن صراحةً بلا ادعاء. */
export const GOAL_SUCCESS_SIGNALS: Record<GoalKind, readonly string[]> = Object.freeze({
  SALES: Object.freeze(['buying_signals', 'qualified_inquiries']),
  LEADS: Object.freeze(['buying_signals', 'qualified_inquiries']),
  LOCAL_AWARENESS: Object.freeze(['reach', 'views']),
  TRUST: Object.freeze(['positive_comments', 'returning_viewers']),
  ENGAGEMENT: Object.freeze(['likes', 'comments', 'shares']),
  FOLLOWER_GROWTH: Object.freeze(['subscribers', 'followers']),
  PRODUCT_AWARENESS: Object.freeze(['views', 'reach']),
  EDUCATION: Object.freeze(['comments', 'saves']),
  RETENTION: Object.freeze(['retention', 'returning_viewers']),
  COMMUNITY: Object.freeze(['comments', 'positive_comments']),
  REACTIVATION: Object.freeze(['reach', 'comments']),
});

/** الإشارات التي لا يوفّرها النظام الحالي عبر الواجهات الرسمية — تُعلن صراحةً. */
export const UNAVAILABLE_SUCCESS_SIGNALS: ReadonlyArray<{ metric: string; reason: string }> = Object.freeze([
  { metric: 'buying_signals', reason: 'تُستخرج من نصوص التعليقات حتمياً حيث تتوفر التعليقات؛ وإلا تُعلن غير متاحة.' },
  { metric: 'qualified_inquiries', reason: 'تُشتق من إشارات شراء مؤكدة؛ لا تُخترع ولا تُقدَّر.' },
  { metric: 'returning_viewers', reason: 'يتطلب واجهة تحليلات الجمهور العائد ولم تُطلب — لا تُخترع.' },
]);

export interface GoalDefinition {
  primary: GoalKind;
  secondary: GoalKind | null;
  successSignals: SuccessSignal[];
  constraints: string[];
  targetAudience: string;
  geographicScope: string;
  timeHorizon: string;
  /** قيود إلزامية لا تُتجاوز (مثل: معلومات منتج موثّقة فقط). */
  hardConstraints: string[];
}

/** قيد ثابت في المشروع: لا محتوى بمعلومات غير موثّقة. */
export const DEFAULT_HARD_CONSTRAINTS: readonly string[] = Object.freeze([
  'لا تُذكر أسعار/خصومات/مواصفات/ضمانات غير مسجّلة في بيانات المعرض.',
  'لا تُخترع بيانات جمهور أو نتائج؛ غير المتاح يُعلن صراحةً.',
  'أي إجراء خارجي يخضع لبوابات الصلاحيات والموافقة.',
]);

/**
 * يبني تعريف هدف كاملاً مع إشارات نجاح صريحة (متاحة/غير متاحة). لا يدّعي توفر
 * إشارة لا يوفّرها النظام.
 */
export function defineGoal(input: {
  primary: GoalKind;
  secondary?: GoalKind | null;
  targetAudience?: string;
  geographicScope?: string;
  timeHorizon?: string;
  constraints?: string[];
}): GoalDefinition {
  const metrics = new Set<string>([...GOAL_SUCCESS_SIGNALS[input.primary], ...(input.secondary ? GOAL_SUCCESS_SIGNALS[input.secondary] : [])]);
  const unavailableMap = new Map(UNAVAILABLE_SUCCESS_SIGNALS.map((u) => [u.metric, u.reason]));
  const successSignals: SuccessSignal[] = [...metrics].map((metric) => {
    const unavailable = unavailableMap.get(metric);
    return {
      metric,
      labelAr: metric,
      available: !unavailable,
      reason: unavailable,
    };
  });
  return {
    primary: input.primary,
    secondary: input.secondary ?? null,
    successSignals,
    constraints: [...(input.constraints || [])],
    targetAudience: input.targetAudience || 'الجمهور العراقي المهتم بالتقسيط',
    geographicScope: input.geographicScope || 'العراق',
    timeHorizon: input.timeHorizon || '30 يوماً',
    hardConstraints: [...DEFAULT_HARD_CONSTRAINTS],
  };
}

/** هل الهدف تجاري المباشر (بيع/عملاء)؟ يؤثر على أولوية إشارات الشراء. */
export function isCommercialGoal(goal: GoalDefinition): boolean {
  return goal.primary === 'SALES' || goal.primary === 'LEADS' || goal.secondary === 'SALES' || goal.secondary === 'LEADS';
}

/** إشارات النجاح المتاحة فعلاً (للعرض والتفسير). */
export function availableSuccessSignals(goal: GoalDefinition): SuccessSignal[] {
  return goal.successSignals.filter((s) => s.available);
}

export function unavailableSuccessSignals(goal: GoalDefinition): SuccessSignal[] {
  return goal.successSignals.filter((s) => !s.available);
}
