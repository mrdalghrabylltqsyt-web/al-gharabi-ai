/**
 * Decision Engine + Autonomy Levels — أين يُسمح للعقل أن يتصرّف (منطق خالص).
 *
 * الفصل الصريح بين أنواع القرارات:
 *   automatic  — آمن ومسموح ويمكن تنفيذه (قراءة/تحليل/صياغة/اقتراح).
 *   suggested  — يحتاج موافقة المالك.
 *   human_required — إجراء خارجي حساس.
 *   blocked    — البيانات أو الصلاحيات غير كافية.
 *   not_available — المنصة لا تسمح بهذه العملية.
 *
 * مستويات الاستقلالية L0..L5، ولا يُسمح بـL5 إلا للعمليات الواضحة القابلة
 * للعكس منخفضة الخطورة داخل صلاحيات المالك وقدرات المنصة وسياسة السلامة.
 *
 * لا تنفيذ خارجي هنا إطلاقاً — القرار توجيه فقط.
 */

import type { PlatformId } from '../../social/adapter';
import { platformCan, capabilityReason, type CapabilityKey } from '../strategy/capabilityMatrix';

export type AutonomyLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export const AUTONOMY_LABELS_AR: Record<AutonomyLevel, string> = Object.freeze({
  L0: 'L0 — إدراك فقط',
  L1: 'L1 — تحليل',
  L2: 'L2 — توصية',
  L3: 'L3 — مسودة',
  L4: 'L4 — تنفيذ بموافقة المالك',
  L5: 'L5 — تنفيذ آمن مستقل',
});

export type DecisionKind = 'automatic' | 'suggested' | 'human_required' | 'blocked' | 'not_available';

export const DECISION_KIND_LABELS_AR: Record<DecisionKind, string> = Object.freeze({
  automatic: 'قرار آلي آمن',
  suggested: 'قرار مقترح (يحتاج موافقة)',
  human_required: 'يحتاج موافقة بشرية',
  blocked: 'محجوب (بيانات/صلاحيات غير كافية)',
  not_available: 'غير متاح عبر المنصة',
});

export interface DecisionAction {
  /** نوع العملية. */
  kind: 'observe' | 'analyze' | 'recommend' | 'draft' | 'publish' | 'reply' | 'message' | 'schedule' | 'delete' | 'edit_settings';
  platform: PlatformId | 'cross_platform';
  /** القدرة المطلوبة من المنصة (إن كان الإجراء خارجياً). */
  capability?: CapabilityKey;
  /** هل الإجراء قابل للعكس؟ */
  reversible?: boolean;
  /** مستوى الخطورة. */
  risk?: 'low' | 'medium' | 'high';
  /** هل يملك المالك/المشغّل الصلاحية؟ */
  authorized?: boolean;
  /** هل المنصة متصلة وموثقة (للإجراءات الخارجية)؟ */
  connectedVerified?: boolean;
  /** هل اجتاز حارس السلامة/الموافقة؟ */
  safetyPassed?: boolean;
  /** هل البيانات كافية؟ */
  dataSufficient?: boolean;
}

export interface DecisionExplanation {
  decision: DecisionKind;
  autonomyLevel: AutonomyLevel;
  reason: string;
  /** البديل عند الحجب/عدم الإتاحة. */
  alternative: string | null;
  limitations: string[];
}

/** الإجراءات الآلية الآمنة دائماً (بلا لمس خارجي). */
const SAFE_LOCAL_KINDS = new Set<DecisionAction['kind']>(['observe', 'analyze', 'recommend', 'draft']);

/**
 * يحسم الإجراء إلى نوع قرار ومستوى استقلالية، مع تفسير صريح وبديل. لا يُسمح
 * بإجراء خارجي بلا: صلاحية + اتصال موثق + قدرة + سلامة + بيانات.
 */
export function decide(action: DecisionAction): DecisionExplanation {
  const limitations: string[] = [];

  // 1) إجراءات محلية آمنة (قراءة/تحليل/توصية/مسودة): آلية دائماً.
  if (SAFE_LOCAL_KINDS.has(action.kind)) {
    const level: AutonomyLevel = action.kind === 'observe' ? 'L0'
      : action.kind === 'analyze' ? 'L1'
        : action.kind === 'recommend' ? 'L2'
          : 'L3';
    return {
      decision: 'automatic',
      autonomyLevel: level,
      reason: 'إجراء محلي آمن (لا لمس خارجي): يُنفَّذ داخل العقل بلا موافقة.',
      alternative: null,
      limitations: ['الإجراء محلي فقط؛ لا ينشر ولا يرد ولا يعدّل لدى أي منصة.'],
    };
  }

  // 2) قدرة المنصة: إن لم تكن متاحة، القرار not_available فوراً.
  if (action.platform !== 'cross_platform' && action.capability) {
    if (!platformCan(action.platform, action.capability)) {
      return {
        decision: 'not_available',
        autonomyLevel: 'L0',
        reason: capabilityReason(action.platform, action.capability),
        alternative: 'استخدم قدرة متاحة بديلة، أو اتركه لمراجعة المالك.',
        limitations: ['لا يُنفَّذ إجراء لا تدعمه المنصة عبر واجهتها الرسمية.'],
      };
    }
  }

  // 3) الصلاحية: بلا صلاحية → human_required (لا blocked) لأن المالك قد يمنحها.
  if (action.authorized === false) {
    return {
      decision: 'human_required',
      autonomyLevel: 'L4',
      reason: 'المُشغّل الحالي لا يملك صلاحية هذا الإجراء الخارجي.',
      alternative: 'يُنفَّذ بموافقة المالك أو عبر تفويض صريح.',
      limitations: ['لا تُتجاوز بوابات الصلاحيات من داخل العقل.'],
    };
  }

  // 4) الاتصال الموثق شرط لأي إجراء خارجي.
  if (action.connectedVerified === false) {
    return {
      decision: 'blocked',
      autonomyLevel: 'L4',
      reason: 'الحساب غير متصل باتصال موثق؛ لا يُنفَّذ إجراء خارجي.',
      alternative: 'أكمل الربط/التحقق أولاً.',
      limitations: ['لا اتصال مُختلق؛ التحقق من المزود شرط.'],
    };
  }

  // 5) البيانات غير كافية → blocked.
  if (action.dataSufficient === false) {
    return {
      decision: 'blocked',
      autonomyLevel: 'L2',
      reason: 'البيانات أو العيّنة غير كافية لاتخاذ إجراء موثوق.',
      alternative: 'اجمع إشارات/عيّنات إضافية قبل التنفيذ.',
      limitations: ['لا يُتخذ إجراء حساس على بيانات ناقصة.'],
    };
  }

  // 6) حارس السلامة/الموافقة.
  if (action.safetyPassed === false) {
    return {
      decision: 'human_required',
      autonomyLevel: 'L4',
      reason: 'لم يجتز الإجراء حارس السلامة/الموافقة.',
      alternative: 'راجع النص/السياسة، أو اعتمده المالك صراحةً.',
      limitations: ['السياسة تسبق التنفيذ دائماً.'],
    };
  }

  // 7) إجراءات عالية الخطورة/غير قابلة للعكس → موافقة بشرية دائماً.
  const highRisk = action.risk === 'high' || action.kind === 'delete' || action.kind === 'edit_settings' || action.reversible === false;
  if (highRisk) {
    return {
      decision: 'human_required',
      autonomyLevel: 'L4',
      reason: 'إجراء حساس/غير قابل للعكس: يتطلب موافقة بشرية صريحة.',
      alternative: 'اقتراح فقط حتى موافقة المالك.',
      limitations: ['النشر العام/الحذف/تغيير الإعدادات لا يُنفَّذ آلياً.'],
    };
  }

  // 8) إجراء خارجي منخفض الخطورة قابل للعكس مع كل الشروط → يمكن L5 نظرياً،
  //    لكن المشروع يبقى على L4 افتراضياً إلا بتفويض صريح من المالك.
  return {
    decision: 'suggested',
    autonomyLevel: 'L4',
    reason: 'إجراء خارجي منخفض الخطورة اجتاز الشروط، لكنه يبقى بموافقة المالك (L4) حتى يوجد تفويض صريح.',
    alternative: 'تنفيذ آلي آمن (L5) عند تفويض المالك الصريح فقط.',
    limitations: ['L5 لا يُفعَّل إلا لعمليات واضحة قابلة للعكس منخفضة الخطورة بصلاحية المالك وقدرة المنصة.'],
  };
}

/** أعلى مستوى استقلالية مسموح لمجموعة إجراءات (للعرض). */
export function highestAutonomy(explanations: DecisionExplanation[]): AutonomyLevel {
  const order: AutonomyLevel[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
  return explanations.reduce((max, e) => (order.indexOf(e.autonomyLevel) > order.indexOf(max) ? e.autonomyLevel : max), 'L0' as AutonomyLevel);
}

/** هل القرار آلي التنفيذ بلا موافقة؟ */
export function isAutomatic(exp: DecisionExplanation): boolean {
  return exp.decision === 'automatic';
}
