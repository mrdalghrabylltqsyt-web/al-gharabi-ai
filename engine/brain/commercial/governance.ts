/**
 * Governance — التحكم الذاتي والتحسين الذاتي وحكامة الإجراءات والسلامة الإنتاجية
 * (منطق خالص).
 *
 * الغرض: أن يقترح العقل تحسينات على **نفسه** وأن يقترح تغييرات برمجية — **بلا تنفيذ
 * صامت** — مع بوابات موافقة صريحة، وبيان نوع الإجراء وخطورته وقابليته للعكس، ومنع
 * أي مساس صامت بالمصادقة/التشفير/الأسرار/التعافي/الحقيقة التجارية الإنتاجية.
 *
 * مستويات الاستقلالية (0..5):
 *   0 OBSERVE · 1 ANALYZE · 2 RECOMMEND · 3 PREPARE · 4 OWNER_APPROVAL · 5 EXECUTE_RULES
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر `nowMs`.
 */

export type AutonomyTier = 0 | 1 | 2 | 3 | 4 | 5;

export const AUTONOMY_TIER_LABELS_AR: Record<AutonomyTier, string> = Object.freeze({
  0: 'L0 — مراقبة',
  1: 'L1 — تحليل',
  2: 'L2 — توصية',
  3: 'L3 — تحضير',
  4: 'L4 — موافقة المالك',
  5: 'L5 — تنفيذ ضمن قواعد معتمدة مسبقاً',
});

/** الحالة الافتراضية: مراقبة فقط — لا توسيع سلطة صامت. */
export function defaultAutonomyTier(): AutonomyTier { return 0; }

/** لا يُسمح بتوسيع السلطة إلا بتفعيل صريح من المالك (بلا صمت). */
export function assertNoSilentAuthorityExpansion(current: AutonomyTier, requested: AutonomyTier, ownerApproved: boolean): { ok: boolean; reason: string } {
  if (requested <= current) return { ok: true, reason: 'لا توسيع للسلطة.' };
  if (!ownerApproved) return { ok: false, reason: 'رفض: لا توسيع سلطة صامت — يلزم اعتماد المالك الصريح.' };
  return { ok: true, reason: 'توسيع سلطة بموافقة مالك صريحة.' };
}

// ---------------------------------------------------------------------------
// حكامة الإجراءات (§28)
// ---------------------------------------------------------------------------

export type ActionType =
  | 'send_message' | 'change_offer' | 'discount' | 'commercial_commitment'
  | 'publish' | 'change_price' | 'production_code_change' | 'read_analysis' | 'prepare_draft';

export const ACTION_TYPE_LABELS_AR: Record<ActionType, string> = Object.freeze({
  send_message: 'إرسال رسالة عميل',
  change_offer: 'تغيير عرض',
  discount: 'خصم',
  commercial_commitment: 'التزام تجاري',
  publish: 'نشر',
  change_price: 'تغيير سعر',
  production_code_change: 'تغيير كود إنتاجي',
  read_analysis: 'قراءة/تحليل',
  prepare_draft: 'تحضير مسودة',
});

/** الإجراءات عالية الخطورة التي تتطلب موافقة المالك دائماً. */
export const HIGH_RISK_ACTIONS: readonly ActionType[] = Object.freeze([
  'send_message', 'change_offer', 'discount', 'commercial_commitment',
  'publish', 'change_price', 'production_code_change',
]);

export interface ActionGovernanceDeclaration {
  actionType: ActionType;
  authorityRequired: AutonomyTier;
  risk: 'low' | 'medium' | 'high';
  reversibility: 'reversible' | 'partially_reversible' | 'irreversible';
  commercialImpact: string;
  evidence: string[];
  approvalState: 'not_required' | 'required' | 'granted' | 'denied';
}

/**
 * يعلن حكامة إجراء. أي إجراء عالي الخطورة يتطلب موافقة المالك (L4) ولا يُنفّذ بلا
 * اعتماد صريح.
 */
export function declareAction(input: {
  actionType: ActionType;
  commercialImpact: string;
  evidence: string[];
  ownerApproved?: boolean;
}): ActionGovernanceDeclaration {
  const highRisk = HIGH_RISK_ACTIONS.includes(input.actionType);
  const authorityRequired: AutonomyTier = highRisk ? 4 : 2;
  const risk: ActionGovernanceDeclaration['risk'] = highRisk ? 'high' : input.actionType === 'prepare_draft' ? 'low' : 'medium';
  const reversibility: ActionGovernanceDeclaration['reversibility'] =
    input.actionType === 'send_message' || input.actionType === 'publish' || input.actionType === 'commercial_commitment'
      ? 'irreversible'
      : input.actionType === 'production_code_change' ? 'partially_reversible' : 'reversible';
  let approvalState: ActionGovernanceDeclaration['approvalState'];
  if (!highRisk) approvalState = 'not_required';
  else if (input.ownerApproved === true) approvalState = 'granted';
  else if (input.ownerApproved === false) approvalState = 'denied';
  else approvalState = 'required';
  return {
    actionType: input.actionType,
    authorityRequired,
    risk,
    reversibility,
    commercialImpact: input.commercialImpact,
    evidence: [...input.evidence],
    approvalState,
  };
}

// ---------------------------------------------------------------------------
// السلامة الإنتاجية (§42)
// ---------------------------------------------------------------------------

/** ممنوعات صريحة لا ينفّذها العقل ذاتياً أبداً. */
export const PRODUCTION_SAFETY_PROHIBITIONS: readonly string[] = Object.freeze([
  'اختراع سعر', 'اختراع مخزون', 'اختراع منتج', 'اختراع بيع', 'اختراع عميل',
  'اختراع إيراد', 'اختراع ربح', 'خصم غير مصرّح', 'إرسال سبام', 'كشف بيانات عملاء',
  'كشف اعتماد', 'تعديل التشفير', 'تعديل المصادقة', 'تعديل التعافي', 'تعديل ضوابط الأمان',
  'نشر كود صامت', 'تعديل الإنتاج صامتاً',
]);

export interface SafetyCheck {
  safe: boolean;
  violations: string[];
  reason: string;
}

/** يفحص إجراءً مقابل الممنوعات؛ أي مطابقة = رفض صريح. */
export function checkProductionSafety(description: string): SafetyCheck {
  const d = String(description || '');
  const violations = PRODUCTION_SAFETY_PROHIBITIONS.filter((p) => d.includes(p));
  return {
    safe: violations.length === 0,
    violations,
    reason: violations.length === 0 ? 'لا مخالفة للسلامة الإنتاجية.' : `مخالفة صريحة: ${violations.join('، ')}.`,
  };
}

// ---------------------------------------------------------------------------
// التحسين الذاتي (§25, §26)
// ---------------------------------------------------------------------------

export type ImprovementDomain =
  | 'capability' | 'workflow' | 'knowledge' | 'tooling' | 'data_quality'
  | 'strategy' | 'experiment' | 'software' | 'security';

export const IMPROVEMENT_DOMAIN_LABELS_AR: Record<ImprovementDomain, string> = Object.freeze({
  capability: 'قدرة ناقصة', workflow: 'سير عمل غير كفؤ', knowledge: 'معرفة قديمة',
  tooling: 'قيد أدوات', data_quality: 'مشكلة جودة بيانات', strategy: 'استراتيجية أفضل',
  experiment: 'تجربة أفضل', software: 'تحسين برمجي', security: 'أثر أمني',
});

export interface SelfImprovementProposal {
  id: string;
  problem: string;
  evidence: string[];
  proposedImprovement: string;
  expectedCommercialBenefit: string;
  risk: 'low' | 'medium' | 'high';
  affectedComponents: string[];
  testPlan: string;
  securityImpact: string;
  rollbackPlan: string;
  ownerApprovalRequired: boolean;
  domain: ImprovementDomain;
  /** لا تنفيذ ذاتي — الحالة تبدأ عند الاقتراح. */
  status: 'PROPOSED';
}

/**
 * يبني اقتراح تحسين ذاتي كامل العناصر. **لا** ينفّذ شيئاً؛ كل اقتراح يبدأ `PROPOSED`
 * ويتطلب موافقة المالك عند أي مساس بالكود/الأمان.
 */
export function buildSelfImprovementProposal(input: {
  id: string;
  problem: string;
  evidence: string[];
  proposedImprovement: string;
  expectedCommercialBenefit: string;
  affectedComponents: string[];
  domain: ImprovementDomain;
  risk?: 'low' | 'medium' | 'high';
  testPlan?: string;
  securityImpact?: string;
  rollbackPlan?: string;
}): SelfImprovementProposal {
  const securitySensitive = input.domain === 'security' || input.domain === 'software';
  const safety = checkProductionSafety(input.proposedImprovement);
  return {
    id: input.id,
    problem: input.problem,
    evidence: [...input.evidence],
    proposedImprovement: input.proposedImprovement,
    expectedCommercialBenefit: input.expectedCommercialBenefit,
    risk: input.risk || (securitySensitive ? 'high' : 'low'),
    affectedComponents: [...input.affectedComponents],
    testPlan: input.testPlan || 'اختبارات آلية تغطي السلوك الجديد + عدم كسر السلوك القائم.',
    securityImpact: input.securityImpact || (securitySensitive ? 'يلزم فحص أمني قبل الدمج.' : 'لا أثر أمني مباشر.'),
    rollbackPlan: input.rollbackPlan || 'إرجاع الالتزام (revert) — لا تغيير غير قابل للعكس.',
    ownerApprovalRequired: true,
    domain: input.domain,
    status: 'PROPOSED',
  };
}

// ---------------------------------------------------------------------------
// مسار تغيير الكود الآمن (§26)
// ---------------------------------------------------------------------------

export type ChangePipelineStage =
  | 'DISCOVER' | 'PROPOSE' | 'CREATE_CHANGE' | 'TEST' | 'AUDIT'
  | 'SECURITY_CHECK' | 'OWNER_APPROVAL' | 'DEPLOY' | 'VERIFY' | 'ROLLBACK';

export const CHANGE_PIPELINE_ORDER: readonly ChangePipelineStage[] = Object.freeze([
  'DISCOVER', 'PROPOSE', 'CREATE_CHANGE', 'TEST', 'AUDIT',
  'SECURITY_CHECK', 'OWNER_APPROVAL', 'DEPLOY', 'VERIFY', 'ROLLBACK',
]);

export const CHANGE_PIPELINE_LABELS_AR: Record<ChangePipelineStage, string> = Object.freeze({
  DISCOVER: 'اكتشاف', PROPOSE: 'اقتراح', CREATE_CHANGE: 'إنشاء تغيير', TEST: 'اختبار',
  AUDIT: 'تدقيق', SECURITY_CHECK: 'فحص أمني', OWNER_APPROVAL: 'موافقة المالك',
  DEPLOY: 'نشر', VERIFY: 'تحقق', ROLLBACK: 'إرجاع',
});

export interface ChangePipelineReport {
  changeId: string;
  whatChanged: string;
  why: string;
  files: string[];
  expectedBenefit: string;
  tests: string;
  securityResult: string;
  rollbackPlan: string;
  stages: Array<{ stage: ChangePipelineStage; label: string; done: boolean; blocked: boolean }>;
  /** هل يمكن النشر الآن؟ لا بلا موافقة المالك. */
  deployable: boolean;
  blocker: string | null;
}

/**
 * يحسب حالة مسار تغيير كود. **لا يُنشر بلا موافقة المالك**؛ وغياب فحص أمني أو اختبار
 * يُحجب المسار. لا تعديل صامت للمصادقة/التشفير/الأسرار/التعافي.
 */
export function evaluateChangePipeline(input: {
  changeId: string;
  whatChanged: string;
  why: string;
  files: string[];
  expectedBenefit: string;
  testsRun: boolean;
  auditPassed: boolean;
  securityChecked: boolean;
  ownerApproved: boolean;
  rollbackPlan: string;
  touchesSecurityCritical?: boolean;
}): ChangePipelineReport {
  const done: Record<ChangePipelineStage, boolean> = {
    DISCOVER: true, PROPOSE: true, CREATE_CHANGE: true,
    TEST: input.testsRun, AUDIT: input.auditPassed, SECURITY_CHECK: input.securityChecked,
    OWNER_APPROVAL: input.ownerApproved, DEPLOY: false, VERIFY: false, ROLLBACK: false,
  };
  const stages = CHANGE_PIPELINE_ORDER.map((stage) => ({
    stage, label: CHANGE_PIPELINE_LABELS_AR[stage],
    done: done[stage],
    blocked: !done[stage] && stage !== 'DEPLOY' && stage !== 'VERIFY' && stage !== 'ROLLBACK',
  }));

  let blocker: string | null = null;
  if (!input.testsRun) blocker = 'لم تُشغَّل الاختبارات.';
  else if (!input.auditPassed) blocker = 'لم يُمرّ التدقيق.';
  else if (!input.securityChecked) blocker = 'لم يُجرَ الفحص الأمني.';
  else if (input.touchesSecurityCritical && !input.ownerApproved) blocker = 'يمسّ مكوّناً أمنياً حسّاساً — يلزم اعتماد المالك.';
  else if (!input.ownerApproved) blocker = 'يلزم اعتماد المالك قبل النشر.';

  return {
    changeId: input.changeId,
    whatChanged: input.whatChanged,
    why: input.why,
    files: [...input.files],
    expectedBenefit: input.expectedBenefit,
    tests: input.testsRun ? 'مُشغَّلة وناجحة.' : 'لم تُشغَّل.',
    securityResult: input.securityChecked ? 'فُحص — لا كشف أسرار ولا مساس بالضوابط.' : 'لم يُفحص.',
    rollbackPlan: input.rollbackPlan,
    stages,
    deployable: blocker === null,
    blocker,
  };
}

export interface GovernanceSummary {
  proposals: number;
  highRiskActions: number;
  ownerApprovalRequired: number;
  safetyViolations: number;
  deployableChanges: number;
  limitations: string[];
}

export function summarizeGovernance(proposals: SelfImprovementProposal[], actions: ActionGovernanceDeclaration[], changes: ChangePipelineReport[]): GovernanceSummary {
  return {
    proposals: proposals.length,
    highRiskActions: actions.filter((a) => a.risk === 'high').length,
    ownerApprovalRequired: actions.filter((a) => a.approvalState === 'required').length,
    safetyViolations: actions.filter((a) => !checkProductionSafety(a.commercialImpact).safe).length,
    deployableChanges: changes.filter((c) => c.deployable).length,
    limitations: ['لا تنفيذ ذاتي: كل تحسين/تغيير يبدأ باقتراح ويتطلب اعتماد المالك.'],
  };
}
