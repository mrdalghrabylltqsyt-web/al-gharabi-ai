/**
 * Specialized Agents — الوكلاء المتخصّصون لفريق العقل المركزي (منطق خالص).
 *
 * ستة وكلاء منطقيون (وحدات، لا اشتراكات AI خارجية):
 *   orchestrator (المنسّق) · research (البحث) · analysis (التحليل) ·
 *   strategy (الاستراتيجية) · critic (النقد/التحقق) · decision (القرار).
 *
 * القواعد الملزمة:
 * - كل مخرج يحمل حالته الصادقة (FACT/DERIVED/HYPOTHESIS/UNKNOWN/UNAVAILABLE) ودليله
 *   ومصدره وعيّنته وثقته وحدوده — بلا اختراع أي بيانات تجارية.
 * - الفرضية لا تصبح حقيقة بتكرار وكيل آخر (انظر `truth.ts`).
 * - الوكلاء يرصدون/يحلّلون/يوصون فقط؛ **لا ينفّذون** أي إجراء خارجي.
 * - المنصات غير YouTube تبقى UNCONNECTED/OFFLINE؛ المؤشر غير المتاح يُعلن UNAVAILABLE.
 *
 * منطق حاسم حتمي: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import type { PlatformId } from '../../social/adapter';
import { capabilityRow } from '../strategy/capabilityMatrix';
import { confidenceForTruth, truthStateForEvidence, type Confidence, type TeamTruthState } from './truth';
import {
  TEAM_AGENT_LABELS_AR, type TeamAgentId, type TeamAgentOutput, type TeamConflict,
  type TeamDecision, type TeamProvenance, type TeamOutputKind,
} from './types';

/** السياق الحقيقي الذي يقرأه الفريق — كل حقل من بيانات مسجّلة فعلية. */
export interface TeamContext {
  now: number;
  /** المهمة النصية. */
  task: string;
  /** المنصة المستهدفة (الوحيدة المتصلة فعلياً في الإنتاج: youtube). */
  platform: PlatformId;
  /** تعليقات حقيقية واردة (socialComments). */
  comments: Array<{ platform: string; externalId: string; text: string; at?: string | null; authorName?: string | null }>;
  /** سجل معالجة مراقب YouTube الحقيقي. */
  watcher: Array<{ commentId: string; stage: string; action?: string | null; code?: string | null; at?: string | null; externalReplyId?: string | null }>;
  /** اتصالات المنصات الحقيقية (لا يُدَّعى اتصال). */
  connections: Array<{ platform: PlatformId; connected: boolean; verified: boolean; accountName?: string | null }>;
  /** حقائق تجارية مسجّلة (نص + مصدر) — لا تُخترع. */
  verifiedFacts: Array<{ id: string; statement: string; source: string }>;
  /** عدد سجلات الذاكرة النشطة (تشخيص فقط). */
  memoryActive: number;
  /** هل مزود AI متاح؟ يُعلن ولا يُخترع. */
  aiAvailable: boolean;
  /** ملخّص ذاكرة الفريق السابقة (عدد الجلسات المكتملة) — للتكرار/التعلّم. */
  priorSessions: number;
}

/** استدعاء اختياري لمزود AI (يُحقن؛ غيابه يعني منطق حتمي بالكامل). */
export type TeamAiDraft = (input: { purpose: string; prompt: string; deterministic: () => string }) => Promise<{ text: string; provenance: TeamProvenance; providerUsed: boolean; error?: string }>;

function output(input: {
  agentId: TeamAgentId;
  kind: TeamOutputKind;
  truthState: TeamTruthState;
  statement: string;
  evidence: string[];
  source: string;
  sampleSize: number;
  limitations: string;
  at: string;
  provenance?: TeamProvenance;
  confidence?: Confidence;
  status?: 'ran' | 'failed' | 'skipped';
  error?: string;
}): TeamAgentOutput {
  return {
    agentId: input.agentId,
    status: input.status ?? 'ran',
    kind: input.kind,
    truthState: input.truthState,
    statement: input.statement,
    evidence: input.evidence,
    source: input.source,
    sampleSize: input.sampleSize,
    confidence: input.confidence ?? confidenceForTruth(input.truthState, input.sampleSize),
    limitations: input.limitations,
    provenance: input.provenance ?? 'deterministic',
    at: input.at,
    ...(input.error ? { error: input.error } : {}),
  };
}

/** منصات حقيقية متصلة وموثّقة (لا يُدَّعى اتصال بلا توثيق). */
export function connectedPlatforms(ctx: Pick<TeamContext, 'connections'>): PlatformId[] {
  return ctx.connections.filter((c) => c.connected && c.verified).map((c) => c.platform);
}

/** المنصات المطلوبة في المهمة (كشف حتمي بسيط بذكر الاسم/المعرّف). */
export function platformsInTask(task: string): PlatformId[] {
  const t = task.toLowerCase();
  const names: Array<[PlatformId, string[]]> = [
    ['youtube', ['youtube', 'يوتيوب', 'قناة']],
    ['facebook', ['facebook', 'فيسبوك', 'فيس']],
    ['instagram', ['instagram', 'إنستغرام', 'انستغرام']],
    ['tiktok', ['tiktok', 'تيك توك', 'تيكتوك']],
    ['whatsapp', ['whatsapp', 'واتساب', 'واتس']],
    ['telegram', ['telegram', 'تليغرام', 'تلغرام']],
    ['x', ['twitter', 'تويتر', ' x ']],
    ['snapchat', ['snapchat', 'سناب']],
    ['threads', ['threads', 'ثريدز']],
    ['google_business', ['google business', 'خرائط', 'business profile']],
  ];
  return names.filter(([, keys]) => keys.some((k) => t.includes(k))).map(([id]) => id);
}

/**
 * وكيل البحث: يجمع الأدلة الحقيقية المتاحة فقط، ويُعلن ما هو غير متاح صراحةً.
 * لا يخترع أي بيانات.
 */
export function researchAgent(ctx: TeamContext): { outputs: TeamAgentOutput[]; platformOffline: PlatformId[] } {
  const at = new Date(ctx.now).toISOString();
  const outputs: TeamAgentOutput[] = [];
  const connected = connectedPlatforms(ctx);
  const requested = platformsInTask(ctx.task);
  const offline = requested.filter((p) => !connected.includes(p));

  // تعليقات حقيقية على المنصة المستهدفة.
  const platformComments = ctx.comments.filter((c) => c.platform === ctx.platform && c.text && c.text.trim());
  const source = `socialComments (${ctx.platform})`;
  if (platformComments.length > 0) {
    const sample = Math.min(platformComments.length, 20);
    outputs.push(output({
      agentId: 'research', kind: 'observation', truthState: 'FACT',
      statement: `وُجدت ${platformComments.length} تعليقاً حقيقياً مسجّلاً على ${ctx.platform} (آخر ${sample} متاحة للقراءة).`,
      evidence: platformComments.slice(-sample).map((c) => `«${String(c.text).slice(0, 120)}» — ${c.externalId}`),
      source, sampleSize: platformComments.length,
      limitations: 'أدلة من تعليقات مسجّلة فعلاً؛ لا تمثّل جمهوراً كاملاً ولا تُثبت سببية.',
      at,
    }));
  } else {
    outputs.push(output({
      agentId: 'research', kind: 'observation', truthState: 'UNKNOWN',
      statement: `لا توجد تعليقات حقيقية مسجّلة على ${ctx.platform} في النطاق المتاح.`,
      evidence: [], source, sampleSize: 0,
      limitations: 'غياب الدليل ليس دليلاً على الغياب؛ لا يُخترع تعليق بديل.',
      at,
    }));
  }

  // سجل مراقب YouTube الحقيقي.
  const watcherEntries = ctx.watcher.filter((w) => w.commentId);
  if (watcherEntries.length > 0) {
    outputs.push(output({
      agentId: 'research', kind: 'observation', truthState: 'FACT',
      statement: `سجل المراقب الحقيقي يحوي ${watcherEntries.length} تعليقاً معالَجاً على YouTube.`,
      evidence: watcherEntries.slice(-10).map((w) => `${w.commentId} — ${w.stage}${w.externalReplyId ? ` — رد ${w.externalReplyId}` : ''}`),
      source: 'watcherState.processed', sampleSize: watcherEntries.length,
      limitations: 'سجل معالجة داخلي؛ لا يمثّل كل تعليقات القناة.',
      at,
    }));
  }

  // حقائق تجارية مسجّلة.
  if (ctx.verifiedFacts.length > 0) {
    outputs.push(output({
      agentId: 'research', kind: 'observation', truthState: 'FACT',
      statement: `${ctx.verifiedFacts.length} حقيقة تجارية مسجّلة متاحة (بلا اختراع أي رقم).`,
      evidence: ctx.verifiedFacts.slice(0, 8).map((f) => `${f.statement} — ${f.source}`),
      source: 'workspace (بيانات المعرض المسجّلة)', sampleSize: ctx.verifiedFacts.length,
      limitations: 'حقائق مسجّلة يدوياً؛ تُراجَع دورياً وقد تتغيّر.',
      at,
    }));
  }

  // اتصالات المنصات الحقيقية + المنصات غير المتصلة (offline).
  outputs.push(output({
    agentId: 'research', kind: 'observation',
    truthState: truthStateForEvidence({ hasSource: true, sampleSize: ctx.connections.length }),
    statement: connected.length
      ? `المنصات المتصلة والموثّقة فعلاً: ${connected.join(', ')}.`
      : 'لا توجد أي منصة متصلة وموثّقة فعلاً.',
    evidence: connected.map((p) => `${p}: connected+verified`),
    source: 'platformConnections (الخادم)', sampleSize: ctx.connections.length,
    limitations: 'الاتصال يُقرأ من الخادم؛ لا يُدَّعى اتصال بلا توثيق مزود.',
    at,
  }));

  if (offline.length) {
    outputs.push(output({
      agentId: 'research', kind: 'observation', truthState: 'UNAVAILABLE',
      statement: `المنصات المطلوبة في المهمة لكنها غير متصلة (UNCONNECTED/OFFLINE): ${offline.join(', ')}.`,
      evidence: offline.map((p) => `${p}: not connected`),
      source: 'platformConnections (الخادم)', sampleSize: offline.length,
      limitations: 'لا يمكن جمع أدلة من منصة غير متصلة؛ لا يُخترع مصدر بديل.',
      at,
    }));
  }

  // المؤشرات المتعلقة بالمهمة: تُعلن غير متاحة صراحةً (لا صفر مضلل).
  const metrics = taskMetrics(ctx.task);
  for (const metric of metrics) {
    outputs.push(output({
      agentId: 'research', kind: 'observation', truthState: 'UNAVAILABLE',
      statement: `المؤشر «${metric}» غير متاح عبر الواجهة الحالية لهذه المنصة.`,
      evidence: [], source: 'capabilityMatrix', sampleSize: 0,
      limitations: 'المؤشر غير المتاح يُعلن صراحةً ولا يُقدَّر ولا يُخترع.',
      at,
    }));
  }

  return { outputs, platformOffline: offline };
}

/** مؤشرات قد تطلبها المهمة لكنها غير متاحة — تُعلن صراحةً. */
function taskMetrics(task: string): string[] {
  const t = task.toLowerCase();
  const metrics: string[] = [];
  if (/(وصول|reach|impressions|ظهور)/.test(t)) metrics.push('reach/impressions');
  if (/(مشاهد|views)/.test(t)) metrics.push('views');
  if (/(تحويل|conversion|معدل التحويل)/.test(t)) metrics.push('conversion rate');
  if (/(جمهور|audience|demographics|ديموغراف)/.test(t)) metrics.push('audience demographics');
  return metrics;
}

/**
 * وكيل التحليل: يشتقّ أنماطاً/إشارات من الأدلة الحقيقية، ويفصل الحقيقة عن الاستنتاج.
 * لا يرقّي الفرضية إلى حقيقة.
 */
export function analysisAgent(ctx: TeamContext, research: TeamAgentOutput[]): TeamAgentOutput[] {
  const at = new Date(ctx.now).toISOString();
  const outputs: TeamAgentOutput[] = [];

  const platformComments = ctx.comments.filter((c) => c.platform === ctx.platform && c.text && c.text.trim());
  const factObs = research.filter((r) => r.truthState === 'FACT');
  const sample = platformComments.length;

  if (sample > 0) {
    const questions = platformComments.filter((c) => /[?؟]|كم|وين|شكد|شنو|كيف|هل/.test(String(c.text))).length;
    outputs.push(output({
      agentId: 'analysis', kind: 'analysis', truthState: 'DERIVED',
      statement: `من ${sample} تعليقاً حقيقياً، ${questions} يحمل صيغة سؤال/استفسار (استنتاج حسابي).`,
      evidence: [`نسبة الأسئلة ${questions}/${sample}`],
      source: `socialComments (${ctx.platform})`, sampleSize: sample,
      limitations: 'تصنيف نصي حتمي؛ لا يُثبت نية شراء ولا سببية.',
      at,
    }));
  }

  if (factObs.length > 0) {
    outputs.push(output({
      agentId: 'analysis', kind: 'analysis', truthState: 'DERIVED',
      statement: `الأدلة الحقيقية المتاحة ${factObs.length} ملاحظة موثّقة؛ منها ما يتعلق بالاتصال ومنها بالمحتوى.`,
      evidence: factObs.map((f) => f.statement.slice(0, 100)),
      source: 'تحليل تجميعي لأدلة وكيل البحث', sampleSize: factObs.length,
      limitations: 'استنتاج من أدلة متاحة فقط؛ الناقص يبقى مجهولاً.',
      at,
    }));
  } else {
    outputs.push(output({
      agentId: 'analysis', kind: 'analysis', truthState: 'UNKNOWN',
      statement: 'لا أدلة حقيقية كافية لاستخلاص نمط — لا يُخترع نمط.',
      evidence: [], source: 'تحليل تجميعي', sampleSize: 0,
      limitations: 'غياب الدليل يُعلن ولا يُخترع.',
      at,
    }));
  }

  // فرضية (لا حقيقة) عند وجود إشارة نصية متكرّرة.
  if (sample >= 3) {
    outputs.push(output({
      agentId: 'analysis', kind: 'analysis', truthState: 'HYPOTHESIS',
      statement: 'فرضية: جزء من التعليقات يعكس اهتماماً بموضوع/منتج بعينه يستحق محتوى موجّهاً.',
      evidence: [`عيّنة ${sample} تعليقاً`],
      source: `socialComments (${ctx.platform})`, sampleSize: sample,
      limitations: 'فرضية تحتاج اختباراً؛ لا تُعتبر حقيقة مهما كرّرها وكلاء آخرون.',
      at,
    }));
  }

  return outputs;
}

/**
 * وكيل الاستراتيجية: يحوّل الأدلة إلى توصيات قابلة للتنفيذ مع السبب والغرض المتوقّع.
 * لا يدّعي أي نتيجة لم تحدث، ويحترم قدرات المنصة (لا توصية بقدرة NOT_AVAILABLE).
 */
export function strategyAgent(ctx: TeamContext, analysis: TeamAgentOutput[]): TeamAgentOutput[] {
  const at = new Date(ctx.now).toISOString();
  const outputs: TeamAgentOutput[] = [];
  const hasEvidence = analysis.some((a) => a.truthState === 'DERIVED' || a.truthState === 'FACT');

  const replyCapable = capabilityRow(ctx.platform).states.reply === 'AVAILABLE';
  const publishCapable = capabilityRow(ctx.platform).states.publish === 'AVAILABLE';

  if (hasEvidence) {
    outputs.push(output({
      agentId: 'strategy', kind: 'recommendation', truthState: 'HYPOTHESIS',
      statement: `توصية: جهّز ردوداً/محتوى موجّهاً يجيب على الأسئلة المتكرّرة على ${ctx.platform} من الحقائق المسجّلة فقط، مع دعوة للتواصل.`,
      evidence: analysis.filter((a) => a.truthState === 'DERIVED' || a.truthState === 'FACT').map((a) => a.statement.slice(0, 100)),
      source: 'استراتيجية مبنية على أدلة وكيل التحليل', sampleSize: ctx.comments.filter((c) => c.platform === ctx.platform).length,
      limitations: 'توصية (فرضية) لا وعد؛ النتيجة الفعلية تُقاس من تفاعل حقيقي لاحقاً.',
      at,
    }));
  } else {
    outputs.push(output({
      agentId: 'strategy', kind: 'recommendation', truthState: 'UNKNOWN',
      statement: 'لا توصية بلا دليل كافٍ — يُنتظر توفّر أدلة حقيقية.',
      evidence: [], source: 'استراتيجية', sampleSize: 0,
      limitations: 'لا توصية بلا دليل؛ لا يُخترع سبب.',
      at,
    }));
  }

  // تحذير قدرة: لا توصية بقدرة غير متاحة.
  if (!replyCapable && /(رد|reply|تعليق)/i.test(ctx.task)) {
    outputs.push(output({
      agentId: 'strategy', kind: 'recommendation', truthState: 'UNAVAILABLE',
      statement: `لا يمكن التوصية بالرد على التعليقات على ${ctx.platform}: القدرة غير متاحة عبر الواجهة العامة.`,
      evidence: [], source: 'capabilityMatrix', sampleSize: 0,
      limitations: 'القدرة غير المنفّذة تُعلن NOT_AVAILABLE ولا يُوصى بما لا يمكن تنفيذه.',
      at,
    }));
  }
  if (!publishCapable && /(نشر|publish|جدول|schedule)/i.test(ctx.task)) {
    outputs.push(output({
      agentId: 'strategy', kind: 'recommendation', truthState: 'UNAVAILABLE',
      statement: `لا يمكن التوصية بالنشر/الجدولة على ${ctx.platform}: القدرة غير متاحة عبر الواجهة العامة.`,
      evidence: [], source: 'capabilityMatrix', sampleSize: 0,
      limitations: 'القدرة غير المنفّذة تُعلن NOT_AVAILABLE ولا يُوصى بما لا يمكن تنفيذه.',
      at,
    }));
  }

  return outputs;
}

/** كلمات تدل على إجراء خارجي (يمنع الناقد ادّعاء تنفيذها من الفريق). */
const EXTERNAL_ACTION_WORDS = /(نشر|انشر|أرسل|ارسل|رد تلقائي|جدول|احذف|عدّل الاعتماد|oauth|توكن|token|دفع|شراء|تحصيل|عقد|قسط مالي)/i;

/**
 * وكيل النقد/التحقق: يتحدّى الفريق — يرفض الادعاءات غير المدعومة، يكشف التناقض
 * والتجاوز، ويتحقق من حالة الاتصال والصلاحيات وحدود السلامة.
 */
export function criticAgent(
  ctx: TeamContext,
  allOutputs: TeamAgentOutput[],
): { objections: TeamAgentOutput[]; conflicts: TeamConflict[]; rejected: number; criticFailed: boolean } {
  const at = new Date(ctx.now).toISOString();
  const objections: TeamAgentOutput[] = [];
  const conflicts: TeamConflict[] = [];
  let rejected = 0;

  // 1) ادعاء FACT بلا مصدر أو بلا عيّنة => مرفوض (تُعلن الحالة الحقيقية).
  for (const o of allOutputs) {
    if (o.truthState === 'FACT' && (o.sampleSize <= 0 || !o.source)) {
      rejected += 1;
      objections.push(output({
        agentId: 'critic', kind: 'objection', truthState: 'UNKNOWN',
        statement: `ادعاء «${o.statement.slice(0, 80)}» من ${TEAM_AGENT_LABELS_AR[o.agentId]} بلا مصدر/عيّنة كافية — مرفوض كحقيقة.`,
        evidence: [], source: 'critic', sampleSize: 0,
        limitations: 'لا يُقبل ادعاء حقيقة بلا مصدر وعيّنة.',
        at,
      }));
    }
  }

  // 2) تجاوز الصلاحيات: أي مخرج يدّعي تنفيذ إجراء خارجي => مرفوض.
  for (const o of allOutputs) {
    if (EXTERNAL_ACTION_WORDS.test(o.statement) && o.kind !== 'decision') {
      rejected += 1;
      objections.push(output({
        agentId: 'critic', kind: 'objection', truthState: 'HYPOTHESIS',
        statement: `مخرج من ${TEAM_AGENT_LABELS_AR[o.agentId]} يقترب من إجراء خارجي («${o.statement.slice(0, 60)}») — الفريق لا ينفّذ؛ التنفيذ عبر بوابات المشروع فقط.`,
        evidence: [], source: 'critic', sampleSize: 0,
        limitations: 'الوكلاء يرصدون/يحلّلون/يوصون فقط؛ لا تنفيذ خارجي.',
        at,
      }));
    }
  }

  // 3) تحقق حالة الاتصال: توصية تخصّ منصة غير متصلة => خلاف ظاهر.
  const connected = connectedPlatforms(ctx);
  const offline = platformsInTask(ctx.task).filter((p) => !connected.includes(p));
  for (const p of offline) {
    conflicts.push({
      id: `conflict:offline:${p}`,
      between: ['strategy', 'critic'],
      statement: `المهمة تخصّ ${p} لكن المنصة غير متصلة/موثّقة — لا يمكن الاعتماد على أي مخرج تنفيذي.`,
      leftState: 'HYPOTHESIS', rightState: 'UNAVAILABLE',
      resolved: false,
      reason: 'قرار حسم يحتاج اتصالاً موثّقاً فعلياً؛ لا يُختار فائز بلا دليل.',
    });
  }

  // 4) تناقض صريح: وكيل يقول FACT وآخر يقول UNKNOWN/UNAVAILABLE لنفس الموضوع.
  const factSubjects = allOutputs.filter((o) => o.truthState === 'FACT').map((o) => o.statement.slice(0, 40));
  const unknownSubjects = allOutputs.filter((o) => o.truthState === 'UNKNOWN' || o.truthState === 'UNAVAILABLE').map((o) => o.statement.slice(0, 40));
  if (factSubjects.length && unknownSubjects.length) {
    conflicts.push({
      id: 'conflict:evidence-vs-gap',
      between: ['analysis', 'critic'],
      statement: 'يوجد دليل موثّق في بعض المحاور، وفجوة بيانات في محاور أخرى — لا يُعمَّم الدليل على المجهول.',
      leftState: 'FACT', rightState: 'UNKNOWN',
      resolved: false,
      reason: 'يبقى الخلاف ظاهراً؛ لا يُرقّى المجهول إلى حقيقة بسبب وجود دليل في محور آخر.',
    });
  }

  if (!objections.length) {
    objections.push(output({
      agentId: 'critic', kind: 'objection', truthState: 'FACT',
      statement: 'لم يُرصد أي ادعاء غير مدعوم ولا تجاوز صلاحيات في هذه الجلسة.',
      evidence: [], source: 'critic', sampleSize: 0,
      limitations: 'فحص نقدي حتمي؛ غياب الملاحظات لا يعني كمال المخرجات.',
      at,
    }));
  }

  return { objections, conflicts, rejected, criticFailed: false };
}

/**
 * وكيل القرار: يجمّع الأدلة المُتحقَّقة، يسجّل الخلافات، ويصدر قراراً مقترحاً مع
 * الثقة والحدود. لا يتجاوز القدرات المصرّح بها، ولا ينفّذ.
 */
export function decisionAgent(
  ctx: TeamContext,
  allOutputs: TeamAgentOutput[],
  conflicts: TeamConflict[],
  critic: { ran: boolean; failed: boolean; rejected: number },
): TeamDecision {
  const actionable = allOutputs.filter((o) => o.truthState === 'FACT' || o.truthState === 'DERIVED');
  const evidence = actionable.flatMap((o) => o.evidence).slice(0, 12);
  const hasActionable = actionable.length > 0;
  const unresolved = conflicts.filter((c) => !c.resolved).length;

  const replyCapable = capabilityRow(ctx.platform).states.reply === 'AVAILABLE';
  const publishCapable = capabilityRow(ctx.platform).states.publish === 'AVAILABLE';
  const wantsReply = /(رد|reply|تعليق)/i.test(ctx.task);
  const wantsPublish = /(نشر|publish|جدول|schedule)/i.test(ctx.task);

  let proposedAction = 'مراجعة بشرية: لا إجراء آلي مقترح.';
  let requiresHumanApproval = true;
  if (hasActionable && wantsReply && replyCapable) {
    proposedAction = 'جهّز مسودة رد من الحقائق المسجّلة ومرّرها عبر بوابة الرد القائمة (موافقة/بوابات المشروع).';
  } else if (hasActionable && wantsPublish && publishCapable) {
    proposedAction = 'جهّز مسودة محتوى ومرّرها عبر بوابة النشر القائمة (موافقة/بوابات المشروع).';
  } else if (hasActionable) {
    proposedAction = 'تحليل وتوصية فقط: لا إجراء خارجي ضمن هذه المهمة.';
    requiresHumanApproval = false;
  }

  const verified = critic.ran && !critic.failed;
  const truthState: TeamTruthState = hasActionable ? 'DERIVED' : 'UNKNOWN';
  const confidence: Confidence = !hasActionable
    ? 'low'
    : (verified && unresolved === 0 ? 'medium' : 'low');

  const limitations: string[] = [
    'القرار مقترح تحليلي؛ لا يُنفَّذ أي إجراء خارجي من الفريق.',
    'الثقة محدودة بالدليل المتاح؛ المجهول يبقى معلناً.',
  ];
  if (!verified) limitations.push('لم يخضع القرار لتحقق ناقد فعلي — غير مُتحقَّق.');
  if (unresolved > 0) limitations.push(`يوجد ${unresolved} خلاف غير محسوم — يبقى ظاهراً.`);
  if (critic.rejected > 0) limitations.push(`رُفض ${critic.rejected} ادعاءً غير مدعوم.`);

  return {
    statement: hasActionable
      ? `بناءً على ${actionable.length} مخرجاً موثّقاً، القرار المقترح: ${proposedAction}`
      : 'لا دليل كافٍ لقرار؛ القرار المقترح: انتظار بيانات حقيقية أو تدخّل المالك.',
    truthState,
    confidence,
    verified,
    verificationNote: verified ? 'خضع لتحقق ناقد؛ لا ادعاء كمال.' : 'لم يخضع لتحقق ناقد فعلي.',
    limitations,
    requiresHumanApproval,
    proposedAction,
    evidence,
  };
}
