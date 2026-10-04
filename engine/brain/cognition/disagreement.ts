/**
 * Disagreement Engine — تمثيل الخلاف بين الوكلاء (منطق خالص قابل للاختبار).
 *
 * الوكلاء قد يختلفون. العقل **لا يفرض إجماعاً**، بل يمثّل الخلاف صراحةً مع حالته
 * ودليله وثقته. وإذا مسّ الخلافُ السلامة أو الصحة جوهرياً:
 *   → HUMAN_ESCALATION أو FAILED_SAFE (لا أتمتة على خلاف جوهري غير محسوم).
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { TeamConflict } from '../team/types';
import type { Disagreement, DisagreementAnalysis } from './types';

/** كلمات تجعل الخلاف **جوهرياً للسلامة/الصحة** (اتصال/معرّف/سعر/خصوصية/صلاحية). */
const MATERIAL_TERMS = /اتصال|موثّق|توثيق|معرّف|سعر|قسط|خصوصي|حسّاس|صلاح|تفويض|مخالفة|قانوني|شكوى|احتيال/;

/** هل الخلاف جوهري للسلامة/الصحة؟ (يُقيَّم من نصّه وحالاته). */
export function isMaterialToSafety(conflict: TeamConflict): boolean {
  const text = `${conflict.statement} ${conflict.reason}`;
  if (MATERIAL_TERMS.test(text)) return true;
  // خلاف بين حقيقة وغياب دليل على نفس الموضوع = جوهري (لا تعميم الدليل على المجهول).
  const states = [conflict.leftState, conflict.rightState];
  if (states.includes('FACT') && (states.includes('UNKNOWN') || states.includes('UNAVAILABLE'))) return true;
  return false;
}

export function toDisagreement(conflict: TeamConflict): Disagreement {
  const material = isMaterialToSafety(conflict);
  return {
    id: conflict.id,
    between: [conflict.between[0], conflict.between[1]],
    statement: conflict.statement,
    leftState: conflict.leftState,
    rightState: conflict.rightState,
    resolved: conflict.resolved,
    materialToSafety: material,
    reason: conflict.reason,
  };
}

/**
 * يحلّل الخلافات: يظهر غير المحسوم، ويحدّد هل يفرض عدم الأتمتة. لا يفرض إجماعاً.
 */
export function analyzeDisagreements(conflicts: TeamConflict[]): DisagreementAnalysis {
  const disagreements = (conflicts || []).map(toDisagreement);
  const unresolved = disagreements.filter((d) => !d.resolved);
  const material = unresolved.filter((d) => d.materialToSafety);
  const forcesHumanOrSafe = material.length > 0;
  // خلاف جوهري => تصعيد بشري (لأن غالباً حسّاس/ثقة) لا مجرد توقف؛ التمييز من النص.
  const recommendation: DisagreementAnalysis['recommendation'] = !forcesHumanOrSafe
    ? 'proceed'
    : (material.some((d) => /سعر|شكوى|حسّاس|خصوصي|قانوني/.test(`${d.statement} ${d.reason}`)) ? 'human_escalation' : 'failed_safe');
  return {
    disagreements,
    unresolved: unresolved.length,
    forcesHumanOrSafe,
    recommendation,
    note: forcesHumanOrSafe
      ? 'يوجد خلاف جوهري غير محسوم يمسّ السلامة/الصحة — لا أتمتة؛ تصعيد بشري أو توقف آمن.'
      : 'لا خلاف جوهري غير محسوم يمنع المتابعة؛ الخلافات غير الحاسمة تبقى ظاهرة.',
  };
}

/** حارس صريح: لا يجوز اختيار «فائز» في خلاف غير محسوم بلا دليل مستقل. */
export function canResolveConflict(conflict: TeamConflict, independentEvidence: { source?: boolean; sampleSize?: number }): { resolvable: boolean; reason: string } {
  const hasEvidence = Boolean(independentEvidence?.source) && Number(independentEvidence?.sampleSize || 0) >= 3;
  return hasEvidence
    ? { resolvable: true, reason: 'دليل مستقل بعيّنة كافية => يمكن حسم الخلاف بالإشارة للدليل.' }
    : { resolvable: false, reason: 'لا دليل مستقل كافٍ => يبقى الخلاف غير محسوم (لا يُختار فائز).' };
}
