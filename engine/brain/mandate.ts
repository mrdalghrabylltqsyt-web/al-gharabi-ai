/**
 * Central Brain Mandate — تفويض العقل المركزي: ما يملكه من مهام ومن يعمل تحته (منطق خالص).
 *
 * لماذا: مهام العقل كانت موزّعة على وحدات منفصلة (الإدراك، الفريق، المهندس، الموظف، النشر) بلا
 * مرجع واحد يعرف منه العقل كل مهامه وأولويتها الآن. هذا العقد يجمعها في أربعة محاور:
 *   1) التفكير    — الإدراك/التخطيط/الذاكرة/التعلّم/الاستراتيجية/القرار (سلطة واحدة).
 *   2) الاستشارات — المستشارون الخمسة تحت تنسيق العقل نفسه.
 *   3) التطوير    — المهندس ذراع التطوير: يرصد ويصلح ويرفع ما يجده للعقل.
 *   4) إدارة المهام — الموظف الرقمي (الردود بموافقة) + النشر الموحّد + بوابة الموافقة + تنبيه المالك.
 *
 * القواعد:
 * - العقل يقرّر ويرتّب الأولويات فقط؛ كل تنفيذ خارجي يمرّ بالبوابات القائمة وموافقة المالك.
 * - الأولويات تُشتق من أرقام حقيقية تُحقن (سجل الأعطال، جاهزية البيع، جاهزية النشر) — الغائب يُعلن غير متاح.
 * - حتمي بالكامل: لا شبكة ولا أسرار ولا Gemini.
 */

import { ADVISOR_AGENT_IDS, ADVISOR_ROLES_AR, BRAIN_COORDINATOR_AGENT_ID, CENTRAL_BRAIN_ID, CENTRAL_BRAIN_LABEL_AR } from './consolidation';

export type MandatePillar = 'thinking' | 'consultation' | 'development' | 'management';

/** نوع سلطة كل مهمة بالنسبة للعقل. */
export type DutyAuthority =
  | 'decides'            // العقل يقرّر (سلطة واحدة)
  | 'brain_internal'     // قدرة داخلية للعقل
  | 'advises'            // مستشار: توصية فقط
  | 'reports_to_brain'   // يعمل ذاتياً ويرفع نتائجه للعقل
  | 'executes_via_gate'; // ينفّذ فقط عبر بوابة الموافقة/الحوكمة

export interface MandateDuty {
  id: string;
  pillar: MandatePillar;
  labelAr: string;
  what: string;
  authority: DutyAuthority;
  /** ملفات الكود التي تنفّذ المهمة (الاختبار يثبت وجودها). */
  modules: string[];
  cadence: string;
}

export const MANDATE_PILLAR_LABELS_AR: Readonly<Record<MandatePillar, string>> = Object.freeze({
  thinking: 'التفكير',
  consultation: 'الاستشارات',
  development: 'التطوير',
  management: 'إدارة المهام',
});

const ADVISOR_DUTIES: MandateDuty[] = ADVISOR_AGENT_IDS.map((id) => ({
  id: `advisor:${id}`,
  pillar: 'consultation' as const,
  labelAr: ADVISOR_ROLES_AR[id].labelAr,
  what: ADVISOR_ROLES_AR[id].role,
  authority: 'advises' as const,
  modules: ['engine/brain/team/agents.ts'],
  cadence: 'عند الحاجة: العقل يختار المستشارين حسب نوع الحدث',
}));

/** سجل المهام الكامل للعقل المركزي ومن تحته. ثابت: يتغيّر بالكود فقط. */
export const CENTRAL_BRAIN_DUTIES: readonly MandateDuty[] = Object.freeze([
  // ── التفكير ────────────────────────────────────────────────────────────
  { id: 'think:cognition', pillar: 'thinking', labelAr: 'الدورة الإدراكية', what: 'يدرك الحدث ويفهمه ويستدعي الذاكرة ويستدلّ ثم يستشير ويخطط وينتقد ويقرّر ويتعلّم.', authority: 'brain_internal', modules: ['engine/brain/cognition/cognitiveLoop.ts'], cadence: 'مع كل حدث حقيقي وارد' },
  { id: 'think:planning', pillar: 'thinking', labelAr: 'التخطيط والأهداف', what: 'يحدد الهدف الحالي والإجراء التالي من الاستراتيجية والجمهور المسجّلين.', authority: 'brain_internal', modules: ['engine/brain/cognition/planningEngine.ts', 'engine/brain/goals/goalEngine.ts'], cadence: 'كل دورة' },
  { id: 'think:memory', pillar: 'thinking', labelAr: 'الذاكرة', what: 'يحفظ الدروس والحقائق الموثّقة ويستدعيها — لا حقيقة بلا مصدر.', authority: 'brain_internal', modules: ['engine/brain/memory/longTerm.ts', 'engine/brain/memory/store.ts'], cadence: 'دائمة' },
  { id: 'think:learning', pillar: 'thinking', labelAr: 'التعلّم من النتائج', what: 'إجراء ← نتيجة ← متابعة ← درس ← ذاكرة ← قرار مستقبلي، من نتائج حقيقية فقط.', authority: 'brain_internal', modules: ['engine/brain/learning/learningLoop.ts', 'engine/brain/cognition/outcomeLearning.ts'], cadence: 'بعد كل نتيجة مقاسة' },
  { id: 'think:strategy', pillar: 'thinking', labelAr: 'الاستراتيجية', what: 'يملك الاستراتيجية الكانونية ويحدّثها بالأدلة.', authority: 'brain_internal', modules: ['engine/brain/strategy/strategyEngine.ts', 'engine/brain/strategyState.ts'], cadence: 'دورية' },
  { id: 'think:decision', pillar: 'thinking', labelAr: 'القرار (سلطة واحدة)', what: 'يجمع آراء المستشارين ويصدر القرار المحكوم — المنتِج الوحيد للقرار.', authority: 'decides', modules: ['engine/brain/team/brainDecision.ts'], cadence: 'كل حدث يحتاج قراراً' },
  // ── الاستشارات ────────────────────────────────────────────────────────
  { id: 'consult:coordination', pillar: 'consultation', labelAr: 'تنسيق المجلس (وظيفة العقل)', what: 'يختار المستشارين المطلوبين لكل حدث ويجمع آراءهم ويحسم الخلاف.', authority: 'decides', modules: ['engine/brain/cognition/agentCouncil.ts', 'engine/brain/team/orchestrator.ts'], cadence: 'كل حدث' },
  ...ADVISOR_DUTIES,
  // ── التطوير ───────────────────────────────────────────────────────────
  { id: 'dev:defects', pillar: 'development', labelAr: 'سجل الأعطال الحقيقية', what: 'يرصد كل عطل حقيقي لحظة وقوعه بتشخيصه وعلاجه ومالكه.', authority: 'reports_to_brain', modules: ['engine/ops/defectLedger.ts'], cadence: 'لحظي' },
  { id: 'dev:self-repair', pillar: 'development', labelAr: 'الإصلاح الذاتي الآمن', what: 'يصلح الأعطال التشغيلية عبر المشغّلات نفسها ويتحقق، ويصعّد ما لا يملكه.', authority: 'reports_to_brain', modules: ['engine/ops/siteEngineer.ts'], cadence: 'كل دقيقة، ≤12 إجراء/ساعة' },
  { id: 'dev:proactive', pillar: 'development', labelAr: 'الكشف الاستباقي', what: 'يفحص الشاشات وما بعد النشر والتوقعات قبل أن يقع العطل.', authority: 'reports_to_brain', modules: ['engine/ops/engineerProactive.ts', 'engine/ops/engineerPatrol.ts'], cadence: 'كل 10 دقائق' },
  { id: 'dev:tokens', pillar: 'development', labelAr: 'حارس الرموز', what: 'يجدّد رموز المنصات قبل انتهائها حتى لا ينقطع الموظف.', authority: 'reports_to_brain', modules: ['engine/ops/tokenKeeper.ts'], cadence: 'كل 15 دقيقة' },
  { id: 'dev:code-engineer', pillar: 'development', labelAr: 'مهندس الكود المجدول', what: 'يصلح عيوب الكود في فرع ويفتح Pull Request للمراجعة — لا دمج ولا نشر بنفسه.', authority: 'reports_to_brain', modules: ['.github/workflows/ci.yml'], cadence: 'مرتين يومياً' },
  // ── إدارة المهام ─────────────────────────────────────────────────────
  { id: 'manage:employee', pillar: 'management', labelAr: 'الموظف الرقمي', what: 'يستقبل التعليقات والرسائل من كل المنصات المتصلة ويجهّز الرد، ولا يرسله إلا بموافقة المالك في وضع «موافقة».', authority: 'executes_via_gate', modules: ['engine/social/ingestionEngine.ts', 'engine/ops/salesReadiness.ts'], cadence: 'مع كل وارد' },
  { id: 'manage:publishing', pillar: 'management', labelAr: 'النشر الموحّد', what: 'منشور واحد يُوزَّع على كل منصة جاهزة فعلاً عبر بوابة الموافقة، بمعرّف منشور حقيقي من كل مزوّد.', authority: 'executes_via_gate', modules: ['engine/social/publishReadiness.ts', 'engine/ops/publishHealth.ts', 'engine/social/publishing.ts'], cadence: 'حسب التقويم بعد الموافقة' },
  { id: 'manage:governance', pillar: 'management', labelAr: 'بوابة الموافقة والحوكمة', what: 'تحجب أي إجراء خارجي حتى يعتمده المالك أو يسمح به التفويض.', authority: 'executes_via_gate', modules: ['engine/agent/governanceGuard.ts', 'engine/agent/permissions.ts'], cadence: 'قبل كل إجراء خارجي' },
  { id: 'manage:owner-alerts', pillar: 'management', labelAr: 'تنبيه المالك', what: 'يرفع للمالك ما يحتاج قراره فقط، فوراً عبر Telegram وبريدياً.', authority: 'reports_to_brain', modules: ['engine/notifications/ownerAlerts.ts', 'engine/notifications/ownerTelegram.ts'], cadence: 'فوري للحرج، كل 30 دقيقة للبريد' },
]);

/** الأرقام الحقيقية التي يقرأها العقل ليرتّب أولوياته. كل حقل اختياري: الغائب = غير متاح. */
export interface MandateLiveInput {
  /** ملخّص سجل الأعطال (`ledgerSummary`). */
  engineer?: { open: number; critical: number; forDeveloper: number; forOwner: number; forEngineer: number; regressions: number } | null;
  /** جاهزية الموظف (`buildSalesReadiness`). */
  employee?: { verdict: 'selling' | 'partial' | 'blocked'; verdictText: string; score: number; blockers: string[] } | null;
  /** جاهزية النشر الموحّد (`summarizePublishReadiness`). */
  publishing?: { readyNow: string[]; connectRequired: string[]; externalSetupRequired: string[] } | null;
  /** ردود جاهزة تنتظر موافقة المالك. */
  pendingApprovals?: number | null;
}

export interface MandatePriority {
  rank: number;
  pillar: MandatePillar;
  severity: 'critical' | 'warning' | 'info';
  /** من يتحرك: العقل/المهندس/المالك/مهندس الكود. */
  actor: 'brain' | 'engineer' | 'owner' | 'developer';
  title: string;
  why: string;
}

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

/** يرتّب ما يحتاج انتباه العقل الآن من الأرقام الحقيقية فقط. */
export function derivePriorities(input: MandateLiveInput): MandatePriority[] {
  const out: Omit<MandatePriority, 'rank'>[] = [];
  const e = input.engineer;
  if (e) {
    if (e.critical > 0) out.push({ pillar: 'development', severity: 'critical', actor: 'engineer', title: `${e.critical} عطل حرج مفتوح`, why: 'المهندس يعالجه الآن؛ العقل يؤجّل أي نشر يتأثر به حتى يُغلق.' });
    if (e.forOwner > 0) out.push({ pillar: 'development', severity: 'warning', actor: 'owner', title: `${e.forOwner} عطل ينتظر إجراء المالك`, why: 'إعداد أو إذن لا يملكه المهندس (مثل إعادة ربط منصة).' });
    if (e.forDeveloper > 0) out.push({ pillar: 'development', severity: 'warning', actor: 'developer', title: `${e.forDeveloper} عيب كود محال لمهندس الكود`, why: 'يُصلَح في فرع عبر Pull Request.' });
    if (e.regressions > 0) out.push({ pillar: 'development', severity: 'warning', actor: 'engineer', title: `${e.regressions} عطل عاد بعد حله`, why: 'الإصلاح السابق لم يصمد — يحتاج سبباً جذرياً.' });
  }
  const m = input.employee;
  if (m) {
    if (m.verdict === 'blocked') out.push({ pillar: 'management', severity: 'critical', actor: 'owner', title: 'الموظف الرقمي متوقف عن البيع', why: m.blockers[0] || m.verdictText });
    else if (m.verdict === 'partial') out.push({ pillar: 'management', severity: 'warning', actor: 'owner', title: 'الموظف يعمل جزئياً', why: m.blockers[0] || m.verdictText });
  }
  const p = input.pendingApprovals;
  if (typeof p === 'number' && p > 0) out.push({ pillar: 'management', severity: p >= 10 ? 'warning' : 'info', actor: 'owner', title: `${p} رد جاهز ينتظر موافقتك`, why: 'الزبون لا يتلقى الرد قبل نقرة المالك.' });
  const pub = input.publishing;
  if (pub) {
    if (pub.readyNow.length === 0) out.push({ pillar: 'management', severity: 'critical', actor: 'owner', title: 'لا منصة جاهزة للنشر الموحّد', why: 'لا يُنشر شيء حتى تُربط منصة بإثبات مزوّد.' });
    const missing = pub.connectRequired.length + pub.externalSetupRequired.length;
    if (missing > 0) out.push({ pillar: 'management', severity: 'info', actor: 'owner', title: `${missing} منصة تنتظر الربط أو الإعداد الخارجي`, why: [...pub.connectRequired, ...pub.externalSetupRequired].slice(0, 6).join('، ') });
  }
  return out
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .map((x, i) => ({ rank: i + 1, ...x }));
}

/** التفويض الكامل كما يعرفه العقل ويعرضه للمالك — بلا أي سرّ. */
export function buildCentralBrainMandate(input: MandateLiveInput = {}) {
  const pillars = (Object.keys(MANDATE_PILLAR_LABELS_AR) as MandatePillar[]).map((pillar) => ({
    pillar,
    labelAr: MANDATE_PILLAR_LABELS_AR[pillar],
    duties: CENTRAL_BRAIN_DUTIES.filter((d) => d.pillar === pillar),
  }));
  const live = {
    engineer: input.engineer ? { available: true, ...input.engineer } : { available: false },
    employee: input.employee ? { available: true, ...input.employee } : { available: false },
    publishing: input.publishing ? { available: true, readyCount: input.publishing.readyNow.length, ...input.publishing } : { available: false },
    pendingApprovals: typeof input.pendingApprovals === 'number' ? input.pendingApprovals : null,
  };
  return {
    brainId: CENTRAL_BRAIN_ID,
    labelAr: CENTRAL_BRAIN_LABEL_AR,
    coordinator: { agentId: BRAIN_COORDINATOR_AGENT_ID, labelAr: 'التنسيق — وظيفة العقل نفسه' },
    advisors: ADVISOR_AGENT_IDS.map((id) => ({ id, ...ADVISOR_ROLES_AR[id], canDecide: false, canExecuteExternal: false })),
    pillars,
    dutyCount: CENTRAL_BRAIN_DUTIES.length,
    live,
    priorities: derivePriorities(input),
    rules: [
      'العقل المركزي هو السلطة الوحيدة للقرار، ويتولى التنسيق بنفسه.',
      'المستشارون الخمسة يوصون فقط — لا قرار ولا تنفيذ.',
      'المهندس يصلح التشغيلي ويرفع للعقل؛ عيوب الكود تُصلَح عبر Pull Request لا بالدمج المباشر.',
      'بروتوكول الإغلاق: كل مشكلة أو تنبيه ينتهي بـ✅ «أصلحه المهندس» أو ✅ «تحقق من زواله» بتقرير، أو «بيد المالك» بالإجراء الدقيق — لا إغلاق صامت ولا رسالة بدل الإصلاح.',
      'لا تنفيذ خارجي (رد/نشر) إلا عبر بوابة الموافقة وبإثبات مزوّد حقيقي.',
      'الأولويات من أرقام حقيقية؛ الغائب يُعلن غير متاح ولا يُقدَّر.',
    ],
    executesExternalActions: false,
    consumesAiQuota: false,
  };
}
