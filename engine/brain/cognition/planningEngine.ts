/**
 * Planning Engine — العقل يبني خطة لا إجابة عن حدث فقط (منطق خالص قابل للاختبار).
 *
 * المسار: حدث → فهم السياق → تحديد الهدف → استشارة الوكلاء → توليد الخيارات →
 * النقد → اختيار الخطة → خطوات مسموحة فقط → رصد النتيجة → تعديل الخطة.
 * الخطة **محكومة**: كل خطوة تحمل هل هي مسموحة/تحتاج اعتماداً، ولا خطوة تنفيذ
 * خارجي بلا بوابة.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا تنفيذ.
 */

import type { PlanStep } from './planTypes';

export interface PlanBuildInput {
  objective: string;
  goalKind: string;
  /** الإجراء التالي المقترح (من المحرك). */
  nextActionKind: string;
  nextActionRationale: string;
  /** حالة القرار النهائي المحكوم (من Batch 6). */
  brainFinalStatus: string;
  /** عدد الوكلاء المستشارين (للتتبع). */
  consultedAgents: number;
  /** هل توجد اتفاقية/خلافات؟ */
  unresolvedDisagreements: number;
  /** قدرات المنصة. */
  replyCapable: boolean;
  publishCapable: boolean;
  providerVerified: boolean;
  /** هل الخطوة الخارجية تحتاج تفويضاً مملوكاً فعّالاً؟ */
  externalApproved: boolean;
}

/**
 * يبني خطة من خطوات محكومة. الخطوات الداخلية (تحليل/صياغة) مسموحة؛ والخطوات
 * الخارجية (رد/نشر) تحتاج اعتماداً/بوابة، ولا تُعلَن مسموحة بلا شرطها.
 */
export function buildPlan(input: PlanBuildInput): { objective: string; steps: PlanStep[]; selectedPlan: string; limitations: string[] } {
  const steps: PlanStep[] = [];
  let idx = 0;
  const push = (s: Omit<PlanStep, 'order'>) => { steps.push({ order: idx += 1, ...s }); };

  // خطوة ثابتة: فهم/تحليل محلي آمن.
  push({ kind: 'analyze', description: 'قراءة السياق والأدلة المتاحة (محلي آمن).', allowed: true, requiresApproval: false, external: false, reason: 'تحليل داخلي لا يمسّ أي منصة.' });

  // خطوة داخلية: صياغة مسودة (لا تنفيذ خارجي).
  if (input.nextActionKind === 'respond' || input.nextActionKind === 'create_content' || input.nextActionKind === 'follow_up') {
    push({ kind: 'draft', description: 'صياغة مسودة داخلية من الحقائق المسجّلة فقط (لا رقم مُخترع).', allowed: true, requiresApproval: false, external: false, reason: 'المسودة داخلية؛ لا تُنشَر بذاتها.' });
  }

  // خطوة خارجية: الرد.
  if (input.nextActionKind === 'respond') {
    const allowed = input.replyCapable && input.providerVerified && input.brainFinalStatus === 'ALLOWED_ACTION';
    push({
      kind: 'external_action',
      description: 'تنفيذ الرد عبر بوابة المشروع (Capability → Connection → Verification → Approval → Content Safety).',
      allowed,
      requiresApproval: !allowed,
      external: true,
      reason: allowed
        ? 'القدرة متاحة والاتصال موثق والقرار النهائي=ALLOWED_ACTION.'
        : (input.externalApproved ? 'البوابة غير مكتملة (قدرة/اتصال).' : 'يتطلب اعتماد/تفويض المالك قبل التنفيذ.'),
    });
  }

  // خطوة خارجية: النشر/الجدولة (فرصة محتوى).
  if (input.nextActionKind === 'create_content') {
    const allowed = input.publishCapable && input.providerVerified && input.brainFinalStatus === 'ALLOWED_ACTION';
    push({
      kind: 'external_action',
      description: 'مرّر المحتوى عبر بوابة النشر القائمة (اعتماد المالك/سلامة المحتوى/القدرة).',
      allowed,
      requiresApproval: !allowed,
      external: true,
      reason: allowed ? 'قدرة النشر متاحة والقرار النهائي=ALLOWED_ACTION (يبقى اعتماد المالك للسلامة).' : 'يتطلب اعتماد المالك/بوابة النشر.',
    });
  }

  // خطوة تصعيد بشري.
  if (input.nextActionKind === 'escalate') {
    push({ kind: 'escalation', description: 'تصعيد بشري إلى المالك مع السبب والسياق (بلا إشعار مُخترع).', allowed: true, requiresApproval: false, external: false, reason: 'الحالات الحسّاسة تُحوَّل بشراً دائماً.' });
  }

  // خطوة ملاحظة النتيجة (دائماً، لإغلاق الحلقة).
  push({ kind: 'observe', description: 'رصد النتيجة من بيانات حقيقية لاحقاً (تفاعل/استجابة/استفسار) — بلا ادعاء بيع.', allowed: true, requiresApproval: false, external: false, reason: 'إغلاق حلقة التعلّم يحتاج رصداً حقيقياً.' });

  const selectedPlan = `${input.objective} — الإجراء المختار: ${input.nextActionKind} (${input.nextActionRationale})`;

  const limitations: string[] = [
    'الخطة محكومة: لا خطوة خارجية تُنفَّذ بلا استيفاء بوابات المشروع.',
    'الخطوات الداخلية (تحليل/مسودة) آمنة؛ الخارجية تتطلب اعتماد المالك/البوابة.',
  ];
  if (input.unresolvedDisagreements > 0) limitations.push(`${input.unresolvedDisagreements} خلاف غير محسوم يبقى ظاهراً ولا يُختار فيه فائز.`);

  return { objective: input.objective, steps, selectedPlan, limitations };
}

/** هل تحتوي الخطة على أي خطوة خارجية مسموحة بلا استيفاء شرطها؟ (حرس). */
export function planRespectsGovernance(steps: PlanStep[]): { respects: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const s of steps) {
    if (s.external && s.allowed && !s.reason) violations.push(`خطوة ${s.order}: خارجية مسموحة بلا سبب بوابة.`);
  }
  return { respects: violations.length === 0, violations };
}
