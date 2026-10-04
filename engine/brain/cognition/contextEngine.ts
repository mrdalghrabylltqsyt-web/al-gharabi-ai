/**
 * Cognitive Context Engine — بناء سياق «ما فهمه العقل» عن حدث (منطق خالص).
 *
 * يجيب صراحةً على: WHAT / WHO / WHERE / WHEN / ما سبق من نقاش / حالة المحادثة /
 * الهدف الحالي / الأدلة المتاحة / المجهول / الذاكرة ذات الصلة / السياق التسويقي /
 * القرار المطلوب. **لا يخترع** ما لا دليل عليه: المجهول وغير المتاح يُعلنان.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import type { PlatformId } from '../../social/adapter';
import type {
  CognitiveContext, CognitiveContextInput, ContextEntity,
} from './types';

/** بناء كيانات السياق من معرّفات حقيقية مُمرَّرة (بلا اختراع كيان). */
function buildEntities(input: CognitiveContextInput): ContextEntity[] {
  const entities: ContextEntity[] = [
    { kind: 'platform', id: input.platform, labelAr: `منصة ${input.platform}` },
  ];
  if (input.conversationId) {
    entities.push({ kind: 'conversation', id: input.conversationId, labelAr: `محادثة ${input.conversationId}` });
  }
  for (const id of input.referencedObjectIds || []) {
    if (id && typeof id === 'string') entities.push({ kind: 'object', id, labelAr: `كيان مرتبط ${id}` });
  }
  return entities;
}

/**
 * يبني السياق الإدراكي من مدخلات حقيقية فقط. الأدلة تُوضع FACT، والمجهول/غير
 * المتاح يبقيان معلنين، والذرية «استنتاج» لا تُرقّى.
 */
export function buildCognitiveContext(input: CognitiveContextInput): CognitiveContext {
  const at = new Date(input.now).toISOString();
  const evidence = (input.evidence || []).filter((e) => e && String(e).trim());
  const unknown = (input.unknown || []).filter((e) => e && String(e).trim());
  const unavailable = (input.unavailable || []).filter((e) => e && String(e).trim());

  const contextId = `ctx-${input.now.toString(36)}-${String(input.eventIdentity).replace(/[^a-z0-9:_-]/gi, '').slice(0, 24)}`;

  const limitations: string[] = [
    'السياق مبني من بيانات مُمرَّرة فعلياً؛ ما لا دليل عليه يُعلن مجهولاً أو غير متاح.',
    'هذا فهم تحليلي فقط — لا يُنفَّذ أي إجراء خارجي من العقل.',
  ];
  if (!evidence.length) limitations.push('لا أدلة حقيقية متاحة لهذا الحدث — الفهم محدود.');
  if (unknown.length) limitations.push(`${unknown.length} معلومة مجهولة معلنة (لا تُخترع).`);
  if (unavailable.length) limitations.push(`${unavailable.length} معلومة غير متاحة عبر الواجهة الرسمية.`);

  return {
    contextId,
    eventIdentity: input.eventIdentity,
    what: input.eventText || 'حدث بلا وصف نصّي متاح.',
    who: buildEntities(input),
    where: { platform: input.platform, surfaceKind: input.surfaceKind || 'unknown' },
    when: at,
    previousDiscussion: input.previousDiscussion ?? null,
    conversationState: {
      conversationId: input.conversationId ?? null,
      sessionMessages: Math.max(0, Number(input.sessionMessages) || 0),
      windowSize: Math.max(0, Number(input.windowSize) || 0),
      truncated: input.windowTruncated === true,
      lastActivityAt: input.lastActivityAt ?? null,
    },
    objective: input.objective || 'لا هدف معلن.',
    availableEvidence: evidence,
    unknown,
    relevantMemoryIds: [],
    relevantMarketingContext: (input.relevantMarketingContext || []).filter((c) => c && String(c).trim()),
    requiredNextDecision: input.requiredNextDecision || 'تحديد الإجراء التالي.',
    truth: {
      fact: evidence,
      derived: [],
      hypothesis: [],
      unknown,
      unavailable,
    },
    limitations,
  };
}

/** يربط الذاكرة المستدعاة بالسياق (بمرجع فقط؛ لا نسخة ثانية للذاكرة). */
export function attachRecalledMemory(context: CognitiveContext, memoryIds: string[]): CognitiveContext {
  return { ...context, relevantMemoryIds: [...new Set(memoryIds)].slice(0, 50) };
}

/** ملخّص السياق للعرض/التشخيص (بلا سرّ). */
export function summarizeCognitiveContext(context: CognitiveContext): {
  contextId: string; platform: PlatformId; objective: string; evidence: number;
  unknown: number; unavailable: number; memoryRefs: number; truncated: boolean;
} {
  return {
    contextId: context.contextId,
    platform: context.where.platform,
    objective: context.objective,
    evidence: context.availableEvidence.length,
    unknown: context.unknown.length,
    unavailable: context.truth.unavailable.length,
    memoryRefs: context.relevantMemoryIds.length,
    truncated: context.conversationState.truncated,
  };
}
