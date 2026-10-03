/**
 * Central Brain Consolidation — عقد السلطة الواحدة (منطق خالص قابل للاختبار).
 *
 * هذا العقد يوثّق ويُثبّت المعمارية الموحّدة: **عقل مركزي واحد (Central Brain 1)**
 * هو السلطة الوحيدة للقرار. الوكلاء الستة مستشارون فقط ولا يملكون قراراً، والناقد
 * يتحدّى ولا يستبدل. الطبقة الإدراكية **قدرة داخلية** لا عقل ثانٍ: تستقبل سياق
 * العقل المركزي (استراتيجية/جمهور/سوق/معرفة) طالبةً، لا تُنتج قراراً مستقلاً.
 *
 * قواعد ملزمة:
 * - سلطة قرار واحدة: `composeBrainDecision` هي المنتِج الوحيد للقرار النهائي.
 * - الإدراك استشاري بنيوي: يبني سياقاً/خطةً/تعلّماً، ولا يُعلن قراراً نهائياً.
 * - لا عقل ثانٍ ولا مخزن ذاكرة ثانٍ ولا حوكمة ثانية ولا كيان استراتيجية ثانٍ.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية.
 */

export const CENTRAL_BRAIN_ID = 'central-brain-1' as const;

export const CENTRAL_BRAIN_LABEL_AR = 'العقل المركزي ١' as const;

/** القدرات الداخلية للعقل المركزي (مكوّنات تابعة، ليست عقولاً مستقلة). */
export type CentralBrainCapability =
  | 'understand'
  | 'memory'
  | 'reason'
  | 'goals'
  | 'planning'
  | 'agents'
  | 'critic'
  | 'decision'
  | 'outcomes'
  | 'learning'
  | 'strategy';

export const CENTRAL_BRAIN_CAPABILITIES: readonly CentralBrainCapability[] = Object.freeze([
  'understand', 'memory', 'reason', 'goals', 'planning', 'agents', 'critic',
  'decision', 'outcomes', 'learning', 'strategy',
]);

export const CENTRAL_BRAIN_CAPABILITY_LABELS_AR: Readonly<Record<CentralBrainCapability, string>> = Object.freeze({
  understand: 'الفهم',
  memory: 'الذاكرة',
  reason: 'الاستدلال',
  goals: 'الأهداف',
  planning: 'التخطيط',
  agents: 'الوكلاء (استشاريون)',
  critic: 'الناقد (يتحدّى)',
  decision: 'القرار (سلطة واحدة)',
  outcomes: 'النتائج',
  learning: 'التعلّم',
  strategy: 'الاستراتيجية',
});

/** الوكلاء الستة — مستشارون فقط: لا يملكون قراراً ولا تنفيذاً. */
export const ADVISOR_AGENT_IDS: readonly string[] = Object.freeze([
  'orchestrator', 'research', 'analysis', 'strategy', 'critic', 'decision',
]);

export interface AdvisorContract {
  agentId: string;
  /** مستشار دائماً: لا قرار. */
  role: 'advisor';
  canDecide: false;
  canExecuteExternal: false;
}

/** عقد كل مستشار صراحةً: لا سلطة قرار ولا تنفيذ خارجي. */
export function advisorContract(agentId: string): AdvisorContract {
  return { agentId, role: 'advisor', canDecide: false, canExecuteExternal: false };
}

/** الناقد يتحدّى القرار المقترح، ولا يستبدل العقل المركزي ولا يُنتج قراراً. */
export function criticContract(): { role: 'challenger'; canDecide: false; replacesCentralBrain: false } {
  return { role: 'challenger', canDecide: false, replacesCentralBrain: false };
}

export interface SublayerContract {
  /** هل هذه الطبقة تملك سلطة قرار مستقلّة؟ يجب أن تكون false دائماً. */
  independentDecisionAuthority: false;
  /** هل هي عقل ثانٍ؟ يجب أن تكون false دائماً. */
  isSecondBrain: false;
  /** دورها كوصف صريح. */
  role: string;
}

/** الطبقات التابعة (الإدراك/المستشارون/الناقد/الاستراتيجية/الذاكرة/التعلّم): لا سلطة مستقلة. */
export function sublayerContract(name: string, role: string): SublayerContract {
  return { independentDecisionAuthority: false, isSecondBrain: false, role, name } as SublayerContract & { name: string };
}

/**
 * عقد السلطة الواحدة المركزي — يُعلنه العقل المركزي في حالته وصحته.
 * لا يحمل أي سرّ، وهو مرجع الفحوص المعمارية.
 */
export function centralBrainAuthorityContract(input?: {
  /** هل سياق العقل المركزي (استراتيجية/جمهور/سوق/معرفة) مُغذّى للدورة الإدراكية؟ */
  cognitionConsumesBrainContext?: boolean;
  /** حالات الاندماج المعلنة. */
  strategyStateOwned?: boolean;
  decisionLedgerOwned?: boolean;
}) {
  const consumes = Boolean(input?.cognitionConsumesBrainContext);
  return {
    brainId: CENTRAL_BRAIN_ID,
    labelAr: CENTRAL_BRAIN_LABEL_AR,
    decisionAuthorityCount: 1,
    decisionAuthorityProducer: 'composeBrainDecision',
    externalExecutionFromBrain: false,
    advisors: {
      ids: ADVISOR_AGENT_IDS,
      count: ADVISOR_AGENT_IDS.length,
      canDecide: false,
      canExecuteExternal: false,
    },
    critic: { canDecide: false, replacesCentralBrain: false },
    cognition: {
      independentDecisionAuthority: false,
      isSecondBrain: false,
      consumesBrainContext: consumes,
    },
    capabilities: CENTRAL_BRAIN_CAPABILITIES,
    strategyStateOwned: Boolean(input?.strategyStateOwned),
    decisionLedgerOwned: Boolean(input?.decisionLedgerOwned),
    note: 'عقل مركزي واحد هو السلطة الوحيدة للقرار؛ الإدراك والوكلاء والناقد قدرات/مستشارون تابعون.',
  };
}

/**
 * يثبت أن إشارة القرار الواردة من طبقة تابعة لا تُصبح قراراً نهائياً بذاتها.
 * أي «اقتراح» من الإدراك يبقى `advisory` حتى يعتمده العقل المركزي.
 */
export function isAdvisoryOnly(source: 'cognition' | 'agent' | 'critic' | 'strategy'): { advisory: true; decisive: false; reason: string } {
  const reasons: Record<typeof source, string> = {
    cognition: 'الإدراك يبني فهماً وخطة وتعلّماً فقط؛ لا يُعلن قراراً نهائياً.',
    agent: 'الوكلاء مستشارون؛ مخرجاتهم اقتراحات.',
    critic: 'الناقد يتحدّى القرار المقترح ولا يستبدله.',
    strategy: 'الاستراتيجية مدخل للعقل المركزي؛ القرار يبقى للعقل وحده.',
  };
  return { advisory: true, decisive: false, reason: reasons[source] };
}
