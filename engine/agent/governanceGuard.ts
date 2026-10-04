/**
 * حوكمة الوكلاء (Agent Governance Guard) — طبقة اجتماعية موحّدة فوق الصلاحيات.
 *
 * الغرض: نقطة قرار واحدة تُجيب «هل يجوز لهذا الفاعل تنفيذ هذا الإجراء الآن؟» بدمج:
 * 1) الصلاحية (staff/owner/system × READ..SENSITIVE) — من `agent/permissions.ts`.
 * 2) بوابة التنفيذ الخارجي (يحتاج تفويضاً/موافقة صريحة — لا تنفيذ صامت).
 * 3) بوابة الصدق (لا إجراء مبني على ادّعاء غير مثبت).
 *
 * منطق صافٍ قابل للاختبار: لا شبكة ولا أسرار ولا تنفيذ فعلي — قرار فقط.
 */

import { canUseTool, toolRequiresApproval, type AgentOperator, type ToolPermission } from '../agent/permissions';

export type GovernanceDecisionCode =
  | 'ALLOWED'
  | 'PERMISSION_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'UNVERIFIED_CLAIM'
  | 'SENSITIVE_HUMAN_REQUIRED';

export interface GovernanceRequest {
  operator: AgentOperator;
  permission: ToolPermission;
  /** هل الإجراء خارجي (نشر/رد/جدولة/تعديل لدى مزود)؟ */
  externalAction: boolean;
  /** هل هناك موافقة/تفويض صريح من المالك لهذا الإجراء؟ */
  approved: boolean;
  /** هل تُبنى المعطيات على ادّعاء مثبت من المزود (اتصال موثق/معرّف حقيقي)؟ */
  claimVerified: boolean;
  /** هل الإجراء حسّاس (سعر/شكوى/بيانات شخصية) يستوجب بشراً؟ */
  sensitive: boolean;
}

export interface GovernanceDecision {
  allowed: boolean;
  code: GovernanceDecisionCode;
  reasonAr: string;
  /** لا يُنفَّذ أي إجراء خارجي بلا موافقة صريحة، ولا حسّاس بلا بشر. */
  requiresApproval: boolean;
  requiresHuman: boolean;
}

/**
 * قرار الحوكمة بترتيب أسبقية صريح: الحساسية أولاً (لا أتمتة على الحساس)، ثم
 * الصلاحية، ثم الصدق، ثم الموافقة الخارجية. الترتيب مقصود: الحساس والصلاحية
 * يحجبان قبل أن نصل لفحص الموافقة.
 */
export function evaluateGovernance(req: GovernanceRequest): GovernanceDecision {
  // 1) الإجراءات الحسّاسة تتطلب بشراً دائماً، ولا تُنفَّذ آلياً.
  if (req.sensitive) {
    return {
      allowed: false, code: 'SENSITIVE_HUMAN_REQUIRED', requiresApproval: true, requiresHuman: true,
      reasonAr: 'إجراء حسّاس: يتطلب مراجعة بشرية ولا يُنفَّذ آلياً.',
    };
  }
  // 2) الصلاحية.
  const perm = canUseTool(req.operator, req.permission);
  if (!perm.allowed) {
    return {
      allowed: false, code: 'PERMISSION_DENIED', requiresApproval: false, requiresHuman: false,
      reasonAr: perm.reason || 'المُشغّل لا يملك الصلاحية المطلوبة.',
    };
  }
  // 3) الصدق: لا إجراء على ادّعاء غير مثبت من المزود.
  if (!req.claimVerified) {
    return {
      allowed: false, code: 'UNVERIFIED_CLAIM', requiresApproval: false, requiresHuman: false,
      reasonAr: 'لا يُنفَّذ الإجراء على ادّعاء غير مثبت من المزود (اتصال/معرّف حقيقي مطلوب).',
    };
  }
  // 4) الموافقة/التفويض للإجراءات الخارجية أو التي تتطلب موافقة بطبيعتها.
  const needsApproval = req.externalAction || toolRequiresApproval(req.permission);
  if (needsApproval && !req.approved) {
    return {
      allowed: false, code: 'APPROVAL_REQUIRED', requiresApproval: true, requiresHuman: false,
      reasonAr: 'الإجراء خارجي/يتطلب موافقة: لا تنفيذ بلا تفويض صريح من المالك.',
    };
  }
  return {
    allowed: true, code: 'ALLOWED', requiresApproval: false, requiresHuman: false,
    reasonAr: 'مسموح: الصلاحية متحققة، والادعاء مثبت، والموافقة (إن لزمت) موجودة.',
  };
}

/** مبادئ حوكمة الوكلاء المعلنة (مرجع موحّد — كل مبدأ قابل للفحص). */
export const AGENT_GOVERNANCE_PRINCIPLES_AR: readonly string[] = Object.freeze([
  'لا تنفيذ صامت: كل إجراء خارجي يحتاج تفويضاً/موافقة صريحة.',
  'فصل السلطة: staff يقرأ وينفّذ فقط؛ الكتابة والحساس والخارجي للمالك.',
  'لا إجراء على ادّعاء غير مثبت من المزود.',
  'الإجراءات الحسّاسة (سعر/شكوى/بيانات شخصية) تتطلب بشراً دائماً.',
  'لا توسيع صلاحية صامت: أي رفع استقلالية يتطلب موافقة المالك.',
  'كل قرار يحمل كوداً وسبباً عربياً صريحاً (بلا غموض).',
]);
