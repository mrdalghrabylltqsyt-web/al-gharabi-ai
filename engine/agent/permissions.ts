/**
 * نظام صلاحيات العقل المركزي.
 *
 * الفصل الصريح: ليست كل أداة متاحة لكل مُشغّل. الأدوات مصنّفة بخمسة مستويات
 * (READ/WRITE/EXECUTE/EXTERNAL_ACTION/SENSITIVE) ولكل مُشغّل (staff/owner/system)
 * مجموعة مسموحة. القرار حتمي محلي ولا يستهلك حصة AI.
 *
 * المبدأ: أقل صلاحية ممكنة. الأدوات الخارجية الحقيقية (نشر/رد/رسالة) محجوبة
 * افتراضياً لأن بوابات المشروع (Capability → Connection → Verification → Approval)
 * لا تُتجاوز من داخل العقل.
 */

export type ToolPermission = 'READ' | 'WRITE' | 'EXECUTE' | 'EXTERNAL_ACTION' | 'SENSITIVE';

/** مستوى المشغّل: system = مهام داخلية غير مرتبطة بجلسة (نادر ومحدود). */
export type AgentOperator = 'staff' | 'owner' | 'system';

export interface PermissionDecision {
  allowed: boolean;
  code?: 'OPERATOR_NOT_ALLOWED';
  reason?: string;
}

/** المستويات المسموحة لكل مُشغّل. staff قراءة فقط ما عدا EXECUTE الآمن. */
const OPERATOR_PERMISSIONS: Record<AgentOperator, ReadonlyArray<ToolPermission>> = {
  staff: ['READ', 'EXECUTE'],
  owner: ['READ', 'WRITE', 'EXECUTE', 'EXTERNAL_ACTION', 'SENSITIVE'],
  system: ['READ', 'WRITE', 'EXECUTE'],
};

/** هل يملك المُشغّل مستوى الصلاحية المطلوب للأداة؟ */
export function canUseTool(operator: AgentOperator, permission: ToolPermission): PermissionDecision {
  const allowed = OPERATOR_PERMISSIONS[operator] || [];
  if (allowed.includes(permission)) return { allowed: true };
  return {
    allowed: false,
    code: 'OPERATOR_NOT_ALLOWED',
    reason: `صلاحية ${permission} مطلوبة لهذه الأداة، والمُشغّل (${operator}) لا يملكها.`,
  };
}

/**
 * قيد صريح: الأدوات ذات المستوى EXTERNAL_ACTION (نشر/رد/رسالة حقيقية) تتطلب
 * موافقة صريحة ولا تُنفَّذ من داخل مهمة تلقائية، لأن بوابات المشروع
 * (Capability → Connection → Verification → Approval) لا تُتجاوز من العقل.
 *
 * استثناء واحد مضبوط: **تفويض تشغيل YouTube** الذي يمنحه المالك صراحةً للعقل
 * (engine/social/youtubeDelegation.ts). عند فعاليته يُسمح بتنفيذ عمليات YouTube
 * الممنوحة فقط؛ ويُحسم القرار في المنسّق عبر `delegationCheck` المحقون من الخادم.
 * التفويض لا يمنح أي منصة أخرى، ولا يلغي أي حارس (اتصال موثق/سلامة/تكرار/audit).
 */
export function toolRequiresApproval(permission: ToolPermission): boolean {
  return permission === 'EXTERNAL_ACTION';
}
