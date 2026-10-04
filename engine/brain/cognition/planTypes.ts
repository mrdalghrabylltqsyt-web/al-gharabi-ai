/**
 * Plan Types — أنواع خطوات الخطة المحكومة (Batch 7، منطق خالص).
 * لا شبكة ولا أسرار.
 */

export type PlanStepKind = 'analyze' | 'draft' | 'consult' | 'external_action' | 'escalation' | 'observe';

export const PLAN_STEP_KIND_LABELS_AR: Readonly<Record<PlanStepKind, string>> = Object.freeze({
  analyze: 'تحليل',
  draft: 'صياغة مسودة',
  consult: 'استشارة الوكلاء',
  external_action: 'إجراء خارجي (عبر البوابة)',
  escalation: 'تصعيد بشري',
  observe: 'رصد النتيجة',
});

export interface PlanStep {
  order: number;
  kind: PlanStepKind;
  description: string;
  /** هل الخطوة مسموحة الآن فعلاً (لا مجرد مقترحة)؟ */
  allowed: boolean;
  /** هل تحتاج اعتماد/تفويض المالك؟ */
  requiresApproval: boolean;
  /** هل هي إجراء خارجي (نشر/رد/جدولة)؟ */
  external: boolean;
  /** سبب القرار (لماذا مسموحة/محجوبة) — إلزامي للخطوات الخارجية. */
  reason: string;
}
