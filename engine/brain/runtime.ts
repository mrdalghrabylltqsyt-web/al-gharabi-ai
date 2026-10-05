/**
 * Central Brain Runtime — طبقة التجميع للقراءة فقط.
 *
 * تحوّل بيانات التطبيق الحقيقية القائمة (سجلات الأداء، التعليقات، الردود، سجلات
 * النشر، اتصالات المنصات، سجل مراقبة YouTube، والحقائق التجارية المسجّلة) إلى
 * مدخلات موحّدة للعقل: إشارات، معرفة، جمهور، سوق، محادثة، توقيت، أداء، قرارات،
 * تعلّم، وذاكرة — **بلا أي شبكة وبلا أسرار وبلا اختراع**.
 *
 * القاعدة الملزمة: كل ما هو غير متاح يبقى غير متاح (value=null / NOT_AVAILABLE)
 * ولا يتحوّل إلى صفر، وكل مخرج يحمل مصدره وعيّنته وثقته وحدوده.
 *
 * منطق خالص قابل للاختبار: تُحقن `now` والبيانات؛ لا ساعة ولا شبكة هنا.
 */

import type { PlatformId } from '../social/adapter';
import type { PlatformMetricRecord } from '../social/platformLearning';
import { buildPerceptionBundle, type Signal, type ConversationSignalInput } from './perception/signals';
import { makeKnowledgeItem, commercialFact, type KnowledgeItem } from './knowledge/truth';
import { buildCrossPlatformAudienceModel, type AudienceModel, type AudienceSegment, type Confidence } from './audience/audienceModel';
import { computeCommercialRelevance, type CommercialRelevance } from './market/commercialRelevance';
import { classifyConversation, aggregateRepeatedNeeds, proposeContentFromNeed, type ClassifiedConversation, type RepeatedNeed } from './audience/conversationIntelligence';
import { recommendTimingWindow, type TimingObservation, type TimingRecommendation } from './timing/timingModel';
import { buildRecommendation, buildStrategyPlan, type ExplainableRecommendation, type StrategyPlan } from './strategy/strategyEngine';
import { createExperiment, type Experiment } from './experiments/experimentEngine';
import { decide, type DecisionAction, type DecisionExplanation } from './decisions/decisionEngine';
import {
  buildLearningLoop, learningEventToMemory, extractOwnerPreferences, dedupeLearningEvents,
  type LearningEvent, type LearningResult, type OwnerPreference,
} from './learning/learningLoop';
import { emptyMemory, remember, type MemoryStore } from './memory/longTerm';
import { toMemoryRecord, upsertMemoryRecord, memoryToKnowledge, emptyBrainMemory, type BrainMemoryStoreState, type BrainMemoryRecord } from './memory/store';
import { buildContentPath, buildContentPerformanceModel, type ContentPath } from './strategy/contentIntelligence';
import { capabilityMatrix } from './strategy/capabilityMatrix';
import { buildCentralBrainState, type CentralBrainState, type BrainPlatformState, type BrainRisk } from './state';
import { type DecisionLedger, type DecisionLedgerEntry } from './cognition/decisionLedger';

/** ملخّص حالة الاستراتيجية المحفوظة (من `strategyState`) — قراءة فقط بلا دورة دورية. */
export interface StrategyStateSummary {
  currentVersion: number;
  lastReason: string;
  itemScopes: string[];
  itemCount: number;
  lastUpdatedAt: string | null;
}

/**
 * إسقاط (projection) لمقطع جمهور حقيقي للاستخدام في سياق القرار. مشتقّ من
 * `AudienceSegment` الكانوني بلا أي حقل مُخترع؛ الحقول هي عينها الموجودة في النوع
 * الحقيقي (label/sampleSize/confidence/dominantIntent) بعد طيّها إلى ملخّص.
 */
export interface AudienceSegmentProjection {
  /** تسمية المقطع (المعرّف العربي) — من `AudienceSegment.label`. */
  label: string;
  /** حجم العيّنة الحقيقي الذي بُني عليه المقطع. */
  sampleSize: number;
  /** الثقة المشتقّة من حجم العيّنة. */
  confidence: Confidence;
  /**
   * النية المهيمنة **المستنتجة من التفاعل**: أكثر الأنواع المفضّلة تكراراً في
   * `contentPreferences` (وهي مُشتقّة فعلاً من تصنيف تعليقات حقيقي). null عند غياب دليل.
   */
  dominantIntent: string | null;
}

/**
 * سياق القراءة التاريخي (قراءة فقط) الذي يغذّي القرار المستقبلي فعل YouTube:
 * الاستراتيجية الكانونية + الجمهور + السوق + تاريخ القرارات ونتائجها الحقيقية.
 * يستدعيه مسار التنفيذ لبناء قرار العقل المركزي على الصورة الكاملة (Batch 8.1).
 */
export interface RuntimeDecisionContext {
  /** الخطط الاستراتيجية الكانونية (المصدر الوحيد — buildRuntimeBrain). */
  strategies: StrategyPlan[];
  /** ملخّص الاستراتيجية المحفوظة (إصدار/سبب تغيير) — لا عقلاً ثانياً. */
  strategyState: StrategyStateSummary | null;
  /** مقاطع الجمهور المبنية من تفاعل حقيقي فقط. */
  audienceSegments: AudienceSegmentProjection[];
  /** هل يوجد دليل تجاري ملاحَظ فعلاً؟ */
  marketHasEvidence: boolean;
  /** سياق قرارات سابقة حقيقية (بنتائج ملاحَظة فقط — لا اختراع) — أقرب 5. */
  priorOutcomes: Array<{ decisionId: string; finalStatus: string; outcomeSummary: string; actionText: string; observedAt: string | null; providerReplyId: string | null }>;
  /** هل قرأ العقل السجل فعلاً (جعل النتائج السابقة تُغذّي القرار)؟ */
  consumedDecisionHistory: boolean;
  /** الخطوة التالية المستنتجة من التاريخ (اقتراح توجيهي — لا قرار). */
  strategyHint: string;
  note: string;
}

/**
 * يحوّل مقطع جمهور كانوني (`AudienceSegment`) إلى إسقاط ملخّص لسياق القرار.
 * مُوقَّع بالنوع الحقيقي (لا `any`) فيمنع الأخطاء الصامتة إذا تغيّر النوع مستقبلاً:
 * أي حقل غير موجود يُفشل الترجمة بدل أن يُفرَّغ صامتاً. `dominantIntent` مشتقّ من
 * `contentPreferences` الحقيقية (تصنيف تفاعل فعلي)، و`null` عند غياب دليل.
 */
function projectAudienceSegment(s: AudienceSegment): AudienceSegmentProjection {
  return {
    label: s.label,
    sampleSize: s.sampleSize,
    confidence: s.confidence,
    dominantIntent: s.contentPreferences.length ? s.contentPreferences[0] : null,
  };
}

/** يبني سياق القراءة التاريخي كاملاً. لا شبكة ولا أسرار ولا اختراع. */
export function buildRuntimeDecisionContext(input: RuntimeBrainInput): RuntimeDecisionContext {
  const built = buildRuntimeBrain(input);
  const ledger = input.decisionLedger;
  const prior = (ledger?.entries || [])
    .filter((e) => e.outcome.availability === 'available')
    .slice(-5)
    .reverse()
    .map((e: DecisionLedgerEntry) => ({
      decisionId: e.decisionId,
      finalStatus: e.finalStatus,
      outcomeSummary: e.outcome.summary,
      actionText: e.actionText,
      observedAt: e.outcome.observedAt,
      providerReplyId: e.links.providerReplyId,
    }));
  const failures = prior.filter((p) => p.finalStatus === 'FAILED' || /فشل/.test(p.outcomeSummary)).length;
  const strategyHint = failures > 0
    ? `${failures} إجراء سابق لم ينجح (دليل تاريخي)؛ راجع الشرط قبل تكراره على هذا التعليق.`
    : (prior.length
      ? 'توجد نتائج سابقة ملاحَظة؛ ابنِ عليها بلا تكرار الإجراء نفسه بلا داعٍ.'
      : 'لا سياق قرارات سابق بعد؛ القرار الحالي بلا تاريخ — يُبنى على الأدلة الحاضرة فقط.');
  const strategies = (built.strategies || []) as StrategyPlan[];
  return {
    strategies,
    strategyState: input.strategyState ?? null,
    audienceSegments: (built.state.audience?.segments || []).slice(0, 6).map(projectAudienceSegment),
    marketHasEvidence: Boolean(built.state.market?.hasCommercialEvidence),
    priorOutcomes: prior,
    consumedDecisionHistory: prior.length > 0,
    strategyHint,
    note: 'سياق قراءة فقط: استراتيجية/جمهور/سوق كانونية + تاريخ قرارات حقيقي بلا اختراع.',
  };
}

/** تعليق حقيقي وارد من التطبيق (اجتماعي/مراقب YouTube). */
export interface RuntimeComment {
  platform: PlatformId;
  externalId: string;
  text: string;
  authorName?: string | null;
  at?: string | null;
}

/** رد حقيقي مُسجَّل (سجل socialReplies). */
export interface RuntimeReply {
  platform: PlatformId;
  externalId: string;
  delivered: boolean;
  providerReplyId?: string | null;
  reviewStatus?: string | null;
  deliveryError?: string | null;
  repliedAt?: string | null;
  /** تعليق تمّ الرد عليه — معرّفه الحقيقي (للربط). */
  parentExternalId?: string | null;
}

/** سجل نشر حقيقي (سجل publishRecords). */
export interface RuntimePublish {
  platform: PlatformId;
  externalId: string | null;
  state?: string | null;
  verified?: boolean;
  error?: string | null;
  createdAt?: string | null;
}

/** سجل معالجة مراقب YouTube (watcherState.processed). */
export interface RuntimeWatcherEntry {
  commentId: string;
  stage: string;
  action?: string | null;
  code?: string | null;
  videoId?: string | null;
  publishedAt?: string | null;
  at?: string | null;
  externalReplyId?: string | null;
}

/** اتصال حقيقي لمنصة (من الخادم؛ لا يُدَّعى). */
export interface RuntimeConnection {
  platform: PlatformId;
  connected: boolean;
  verified: boolean;
  accountName?: string | null;
}

/** حقيقة تجارية مسجّلة (نص + مصدر). لا تُخترع؛ بلا مصدر ⇒ HUMAN_INPUT_REQUIRED. */
export interface RuntimeVerifiedFact {
  id: string;
  statement: string;
  source: string;
}

export interface RuntimeBrainInput {
  platforms: PlatformId[];
  now: number;
  goalPrimary: string;
  goalSecondary?: string | null;
  records: PlatformMetricRecord[];
  comments: RuntimeComment[];
  replies: RuntimeReply[];
  publishes: RuntimePublish[];
  watcher: RuntimeWatcherEntry[];
  connections: RuntimeConnection[];
  verifiedFacts?: RuntimeVerifiedFact[];
  /** بيانات المنتجات الحقيقية (اسم/سعر/توفر) لبناء مسار المحتوى بلا اختراع. */
  productFacts?: {
    productName: string | null;
    priceText: string | null;
    specs: string[];
    inStock: boolean | null;
    showroomPhone: string | null;
    showroomLocation: string | null;
  };
  /** الذاكرة الدائمة المحمّلة (تُقرأ فقط). */
  memory?: BrainMemoryStoreState;
  /**
   * سجل القرار→النتيجة (قراءة فقط). يجعله العقل سلطة **تقرأ** تاريخ قراراتها
   * ونتائجها الحقيقية كدليل ⇒ تُغذّي القرار المستقبلي (Batch 8.1). لا نظام ثانٍ:
   * الذاكرة تبقى واحدة، والسجل مجرّد دليل تاريخي يُحوَّل إلى ذاكرة العقل القائمة.
   */
  decisionLedger?: DecisionLedger;
  /** حالة الاستراتيجية المحفوظة (قراءة فقط) لتمييز تغيّر الاستراتيجية تاريخياً. */
  strategyState?: StrategyStateSummary;
  aiCounters?: CentralBrainState['ai'];
}

export interface RuntimeBrainOutput {
  state: CentralBrainState;
  learning: LearningResult;
  ownerPreferences: OwnerPreference[];
  /** أحداث تعلّم جديدة (مُزالة التكرار) — تُحفظ في الذاكرة الدائمة. */
  learningEvents: LearningEvent[];
  /** سجلات ذاكرة جديدة (بعد منع التكرار) — تُحفظ في المخزن الدائم. */
  newMemoryRecords: BrainMemoryRecord[];
  contentPath: ContentPath | null;
  strategies: StrategyPlan[];
  experiments: Experiment[];
  timing: TimingRecommendation | null;
  recommendations: ExplainableRecommendation[];
  knowledge: KnowledgeItem[];
  risks: BrainRisk[];
  /** المعرّفات الحقيقية التي شوهدت في السجلات (للتحقق، بلا اختراع). */
  observedProviderIds: string[];
}

const PUBLISH_OK_STATES = new Set(['PUBLISHED', 'VERIFIED']);

/** يحوّل سجلات الأداء الحقيقية إلى ملاحظات توقيت (المشاهدات كمؤشر أداء). */
export function timingObservationsFromRecords(records: PlatformMetricRecord[], platform?: PlatformId): TimingObservation[] {
  const out: TimingObservation[] = [];
  for (const r of records) {
    if (platform && r.platform !== platform) continue;
    const views = Number(r.values?.views);
    if (!r.publishedAt || !Number.isFinite(views)) continue;
    out.push({ platform: r.platform, contentType: r.contentType ?? null, at: r.publishedAt, performance: views });
  }
  return out;
}

/**
 * يبني أحداث التعلّم من نتائج حقيقية: ردود فعلية (نجاح/فشل)، سجلات نشر
 * (نجاح/فشل/تحقق)، ومعالجات مراقب (تخطٍّ/إحالة). كل حدث يحمل معرّف المزوّد إن
 * وُجد فقط. لا حدث بلا مصدر.
 */
export function buildLearningEvents(input: {
  replies: RuntimeReply[];
  publishes: RuntimePublish[];
  watcher: RuntimeWatcherEntry[];
  comments: RuntimeComment[];
  now: number;
}): LearningEvent[] {
  const events: LearningEvent[] = [];

  for (const r of input.replies) {
    const providerId = r.providerReplyId || null;
    const kind = r.delivered ? 'SUCCESS' : 'FAILURE';
    events.push({
      id: `reply:${r.platform}:${r.externalId}`,
      kind,
      subject: `${r.platform}:reply`,
      detail: r.delivered
        ? `رد مُسلَّم على ${r.externalId}${providerId ? ` (معرّف المزوّد ${providerId})` : ''}.`
        : `فشل رد على ${r.externalId}: ${r.deliveryError || 'خطأ غير محدّد'}.`,
      source: `${r.platform} — سجل الردود`,
      sourceRef: 'socialReplies',
      sampleSize: 1,
      confidence: 'high',
      isFact: true,
      at: r.repliedAt || new Date(input.now).toISOString(),
      platform: r.platform,
      providerId,
    });
    if (r.delivered && providerId) {
      events.push({
        id: `provider:${r.platform}:${providerId}`,
        kind: 'PROVIDER_RESPONSE',
        subject: `${r.platform}:provider_response`,
        detail: `استجابة مزوّد بمعرّف ${providerId}.`,
        source: `${r.platform} — استجابة مزوّد`,
        sourceRef: 'socialReplies',
        sampleSize: 1,
        confidence: 'high',
        isFact: true,
        at: r.repliedAt || new Date(input.now).toISOString(),
        platform: r.platform,
        providerId,
      });
    }
  }

  for (const p of input.publishes) {
    const ok = Boolean(p.verified) || PUBLISH_OK_STATES.has(String(p.state || ''));
    events.push({
      id: `publish:${p.platform}:${p.externalId || 'unknown'}`,
      kind: ok ? 'OUTCOME' : 'FAILURE',
      subject: `${p.platform}:publish`,
      detail: ok
        ? `نشر ${p.externalId || ''} وصل حالة ${p.state || 'PUBLISHED'}.`
        : `نشر فشل/غير مُتحقَّق: ${p.error || p.state || 'غير معروف'}.`,
      source: `${p.platform} — سجل النشر`,
      sourceRef: 'publishRecords',
      sampleSize: 1,
      confidence: 'high',
      isFact: true,
      at: p.createdAt || new Date(input.now).toISOString(),
      platform: p.platform,
      providerId: p.externalId || null,
    });
    if (ok) {
      events.push({
        id: `verify:${p.platform}:${p.externalId || 'unknown'}`,
        kind: 'VERIFICATION',
        subject: `${p.platform}:publish_verified`,
        detail: `تحقق نشر بمعرّف ${p.externalId || 'غير معروف'}.`,
        source: `${p.platform} — تحقق نشر`,
        sourceRef: 'publishRecords',
        sampleSize: 1,
        confidence: 'high',
        isFact: true,
        at: p.createdAt || new Date(input.now).toISOString(),
        platform: p.platform,
        providerId: p.externalId || null,
      });
    }
  }

  for (const w of input.watcher) {
    if (w.stage === 'SKIPPED') {
      events.push({
        id: `watcher:skip:${w.commentId}`,
        kind: 'SKIP',
        subject: 'youtube:watcher',
        detail: `تعليق ${w.commentId} تُخطّي (${w.code || w.stage}).`,
        source: 'YouTube — مراقب التعليقات',
        sourceRef: 'watcherState.processed',
        sampleSize: 1,
        confidence: 'high',
        isFact: true,
        at: w.at || new Date(input.now).toISOString(),
        platform: 'youtube',
        providerId: w.commentId,
      });
    } else if (w.stage === 'ESCALATED') {
      events.push({
        id: `watcher:escalate:${w.commentId}`,
        kind: 'ESCALATION',
        subject: 'youtube:watcher',
        detail: `تعليق ${w.commentId} أُحيل للمالك (${w.code || w.stage}).`,
        source: 'YouTube — مراقب التعليقات',
        sourceRef: 'watcherState.processed',
        sampleSize: 1,
        confidence: 'high',
        isFact: true,
        at: w.at || new Date(input.now).toISOString(),
        platform: 'youtube',
        providerId: w.commentId,
      });
    }
  }

  return dedupeLearningEvents(events);
}

/**
 * يبني المعرفة من: حقائق تجارية مسجّلة (مصدر ⇒ VERIFIED_FACT) + الذاكرة الدائمة
 * النشطة (بأصولها الصادقة). لا معلومة بلا مصدر تُرقّى.
 */
export function buildRuntimeKnowledge(input: {
  verifiedFacts: RuntimeVerifiedFact[];
  memory: BrainMemoryStoreState;
  now: number;
}): KnowledgeItem[] {
  const items: KnowledgeItem[] = [];
  for (const f of input.verifiedFacts) {
    items.push(commercialFact({ id: `fact:${f.id}`, statement: f.statement, source: f.source, now: input.now }));
  }
  for (const like of memoryToKnowledge(input.memory)) {
    items.push(makeKnowledgeItem({
      id: like.id,
      statement: like.statement,
      source: like.source,
      sampleSize: like.sampleSize,
      now: input.now,
      derived: like.derived,
      hypothesis: like.hypothesis,
      requiresHumanInput: like.requiresHumanInput,
      confidence: like.confidence,
      limitations: like.limitations,
    }));
  }
  return items;
}

/**
 * يبني مسار المحتوى الحقيقي من حاجة جمهور ملاحَظة + حقائق المنتج المسجّلة فقط.
 * أي عنصر بلا بيانات مسجّلة يُعلن `available:false` أو `HUMAN_INPUT_REQUIRED`.
 */
export function buildRuntimeContentPath(input: {
  topNeed: RepeatedNeed | null;
  verifiedFacts: RuntimeVerifiedFact[];
  productFacts: RuntimeBrainInput['productFacts'];
}): ContentPath | null {
  const need = input.topNeed;
  if (!need) return null;
  const pf: NonNullable<RuntimeBrainInput['productFacts']> = input.productFacts || { productName: null, priceText: null, specs: [], inStock: null, showroomPhone: null, showroomLocation: null };
  const factsText = (input.verifiedFacts || []).map((f) => f.statement).join(' | ');
  const priceText = pf.priceText || (/(سعر|تقسيط|قسط)/.test(factsText) ? factsText : null);
  const name = pf.productName || null;
  const labelAr: Record<string, string> = { location: 'الموقع', price: 'السعر/التقسيط', availability: 'التوفر', hours: 'أوقات الدوام', general: 'استفسار عام' };
  const label = labelAr[need.topic] || 'استفسار';
  const idea = `فيديو يجيب على «${label}» من بيانات المعرض المسجّلة فقط${name ? ` (${name})` : ''}.`;
  const hook = `«${label}» — الجواب الكامل في أقل من دقيقة.`;
  const script = priceText
    ? `نستعرض ${label}${name ? ` لـ${name}` : ''} من المعلومات المسجّلة: ${priceText}.`
    : `نشرح ${label} خطوة بخطوة بلا أرقام غير مسجّلة، وندعو للتواصل للتفاصيل.`;
  const cta = pf.showroomPhone ? `تواصل معنا على ${pf.showroomPhone} أو عبر قنوات المعرض الرسمية.` : 'تواصل معنا عبر قنوات المعرض الرسمية.';
  const hashtags = need.topic === 'price' ? ['#تقسيط', '#الغرابي'] : need.topic === 'location' ? ['#الغرابي', '#موقعنا'] : ['#الغرابي'];
  return buildContentPath({
    audienceNeed: `${need.count} تعليقاً عن «${label}»`,
    audienceNeedSource: need.source,
    businessGoal: 'SALES',
    contentIdea: idea,
    hook,
    script,
    visualPlan: pf.inStock === false ? 'مشهد بديل للمنتج مع بدائل متوفرة.' : 'مشهد المنتج + لقطة بيانات التقسيط المسجّلة.',
    title: `${label}${name ? ` — ${name}` : ''} | معرض الغرابي للتقسيط`,
    description: priceText ? `${label}${name ? ` لـ${name}` : ''}: ${priceText}.` : `${label}${name ? ` لـ${name}` : ''} — التفاصيل المسجّلة عبر قنوات المعرض.`,
    cta,
    hashtags,
  });
}

/**
 * يحوّل سجل القرار→النتيجة إلى **سجلات ذاكرة العقل القائمة** (بلا نظام ذاكرة ثانٍ).
 * لا يُنتج سجلاً إلا لقرار له **نتيجة ملاحَظة حقيقية** (`availability==='available'`)
 * فلا تُخترع نتيجة، وتُرحَّل عبر `origin='platform_data'` (دليل حقيقي) مع عيّنة ≥1،
 * ويُصان معرّف القرار ومعرّف رد المزوّد كمراجع حقيقية. النتائج غير المتاحة تُتجاهل.
 */
export function decisionHistoryToMemoryRecords(ledger: DecisionLedger | undefined, now: number): BrainMemoryRecord[] {
  const out: BrainMemoryRecord[] = [];
  for (const e of (ledger?.entries || [])) {
    if (e.outcome.availability !== 'available') continue; // لا اختراع نتيجة
    out.push(toMemoryRecord({
      id: `brain-decision-outcome:${e.decisionId}`,
      kind: 'outcome',
      statement: `نتيجة قرار مركزي حقيقية (${e.finalStatus}): ${e.outcome.summary}`,
      origin: 'platform_data',
      source: e.outcome.source || 'decisionLedger',
      createdAt: e.outcome.observedAt || new Date(now).toISOString(),
      lastValidatedAt: e.outcome.observedAt ?? null,
      confidence: 'high',
      status: 'active',
      sampleSize: 1,
      limitations: 'نتيجة ملاحَظة من تاريخ القرار المركزي؛ رابط القرار حقيقي ومعرّف رد المزوّد إن وُجد.',
      refs: { decisionId: e.decisionId, platform: e.platform, providerReplyId: e.links.providerReplyId ?? null },
      platform: e.platform,
      sourceRefs: ['decisionLedger'],
      summary: e.outcome.summary,
    }));
  }
  return out;
}

export function buildRuntimeBrain(input: RuntimeBrainInput): RuntimeBrainOutput {
  const memory = input.memory || emptyBrainMemory();
  const now = input.now;
  const comments = input.comments || [];
  const records = input.records || [];

  // 1) الإدراك — إشارات حقيقية + إشارات جمهور غير متاحة معلنة + إشارات محادثة.
  const primaryPlatform = input.platforms[0] || 'youtube';
  const primaryRecords = records.filter((r) => r.platform === primaryPlatform);
  const primaryComments = comments.filter((c) => c.platform === primaryPlatform);
  const views = primaryRecords.reduce((s, r) => s + (Number(r.values?.views) || 0), 0);
  const likes = primaryRecords.reduce((s, r) => s + (Number(r.values?.likes) || 0), 0);
  const conversationSignals: ConversationSignalInput[] = comments.map((c) => ({
    platform: c.platform, externalId: c.externalId, text: c.text, collectedAt: c.at || new Date(now).toISOString(), authorName: c.authorName || undefined,
  }));
  const perception = buildPerceptionBundle({
    platform: primaryPlatform,
    collectedAt: new Date(now).toISOString(),
    values: { views, likes, comments: primaryComments.length },
    scope: 'channel_recent',
    sampleSize: primaryRecords.length,
    comments: conversationSignals,
  });
  const signals: Signal[] = perception.signals;

  // 2) المعرفة — حقائق مسجّلة + ذاكرة دائمة نشطة.
  const knowledge = buildRuntimeKnowledge({ verifiedFacts: input.verifiedFacts || [], memory, now });

  // 3) الجمهور — من بيانات تفاعل حقيقية فقط (بلا سمات حساسة).
  const commentsByPlatform: Partial<Record<PlatformId, Array<{ text: string; authorName?: string }>>> = {};
  for (const c of comments) {
    const list = commentsByPlatform[c.platform] || (commentsByPlatform[c.platform] = []);
    list.push({ text: c.text, authorName: c.authorName || undefined });
  }
  const audience: AudienceModel = buildCrossPlatformAudienceModel({ platforms: input.platforms, records, commentsByPlatform });

  // 4) الأهمية التجارية — القُمع من أول منصة لها بيانات فعلية.
  const marketPlatform = input.platforms.find((p) => records.some((r) => r.platform === p) || comments.some((c) => c.platform === p)) || primaryPlatform;
  const marketRecords = records.filter((r) => r.platform === marketPlatform);
  const marketComments = comments.filter((c) => c.platform === marketPlatform);
  const marketClassified = marketComments.map((c) => classifyConversation({ platform: c.platform, externalId: c.externalId, text: c.text }));
  const marketViews = marketRecords.reduce((s, r) => s + (Number(r.values?.views) || 0), 0);
  const marketEngaged = marketRecords.reduce((s, r) => s + (Number(r.values?.likes) || 0), 0) + marketClassified.length;
  const market: CommercialRelevance = computeCommercialRelevance({
    platform: marketPlatform,
    views: marketRecords.length ? marketViews : null,
    engagedViews: marketRecords.length ? marketEngaged : null,
    comments: marketClassified.map((c) => ({ isBusinessInquiry: c.category === 'purchase_intent', intent: 'business_inquiry' as const, topic: c.topic })),
  });

  // 5) المحادثة — تصنيف + حاجات متكررة + فرضيات محتوى.
  const classifiedAll: ClassifiedConversation[] = comments.map((c) => classifyConversation({ platform: c.platform, externalId: c.externalId, text: c.text }));
  const byPlatformConversations = new Map<PlatformId, ClassifiedConversation[]>();
  for (const c of classifiedAll) {
    const list = byPlatformConversations.get(c.platform) || [];
    list.push(c);
    byPlatformConversations.set(c.platform, list);
  }
  const needs: RepeatedNeed[] = [...byPlatformConversations.entries()].flatMap(([platform, convs]) => aggregateRepeatedNeeds({ platform, conversations: convs }));
  const hypotheses = needs.map((n) => proposeContentFromNeed({ need: n, verifiedFacts: (input.verifiedFacts || []).map((f) => f.statement) }));
  const topNeed = [...needs].sort((a, b) => b.count - a.count)[0] || null;

  // 6) التوقيت — من أوقات نشر ومشاهدات حقيقية فقط.
  const timing = (() => {
    const obs = timingObservationsFromRecords(records, marketPlatform);
    if (!obs.length) return null;
    return recommendTimingWindow({ observations: obs, platform: marketPlatform });
  })();

  // 7) التجارب — فرضية واحدة لكل حاجة (متغيّر واحد).
  const experiments: Experiment[] = needs.slice(0, 2).map((n, i) => createExperiment({
    id: `exp-${n.topic}-${n.category}-${i}`,
    hypothesis: `محتوى يوضّح «${n.topic}» سيرفع الإشارات المؤهّلة.`,
    variable: 'content_topic_focus',
    variantA: { id: 'a', label: 'محتوى عام', description: 'محتوى متنوّع بلا تركيز على حاجة واحدة.' },
    variantB: { id: 'b', label: `تركيز على ${n.topic}`, description: 'محتوى موجّه لحاجة الجمهور المتكررة.' },
    successMetric: n.category === 'purchase_intent' ? 'buying_signals' : 'comments',
    now,
  }));

  // 8) الأداء — نموذج متعدد الأبعاد لأفضل سجل أداء (بلا score واحد).
  const bestRecord = [...marketRecords].sort((a, b) => (Number(b.values?.views) || 0) - (Number(a.values?.views) || 0))[0] || null;
  const performance = buildContentPerformanceModel({
    platform: marketPlatform,
    views: bestRecord ? Number(bestRecord.values?.views) || null : null,
    engagementRate: null,
    retentionPct: null,
    buyingSignals: marketClassified.length ? marketClassified.filter((c) => c.category === 'purchase_intent').length : null,
    followerDelta: null,
    conversationQuality: marketClassified.length || null,
  });

  // 9) التعلّم — من نتائج حقيقية، مع منع تكرار.
  const learningEvents = buildLearningEvents({ replies: input.replies || [], publishes: input.publishes || [], watcher: input.watcher || [], comments, now });
  const learning = buildLearningLoop({ events: learningEvents, now });

  // 10) تفضيلات المالك — من أحداث تعديل/رفض فعلية (وإلا لا شيء).
  const ownerPreferences = (() => {
    const prefs: OwnerPreference[] = [];
    const p = extractOwnerPreferences({ events: learningEvents, kind: 'content_type', describe: (e) => e.detail });
    if (p) prefs.push(p);
    return prefs;
  })();

  // 11) التوصيات — قابلة للتفسير، وتُعلن insufficient_sample بلا دليل.
  const recommendations: ExplainableRecommendation[] = [];
  hypotheses.forEach((h, i) => {
    recommendations.push(buildRecommendation({
      id: `rec-content-${i}`,
      recommendation: h.suggestedContent,
      reason: h.hypothesis,
      evidence: h.evidence,
      source: [h.need.source, 'حاجة متكررة ملاحَظة'],
      sampleSize: h.need.count,
      expectedOutcome: h.expectedSignal,
      risk: 'low',
      nextTest: 'اختبر هذا المحتوى كمتغيّر واحد وقس الإشارات المؤهّلة.',
      limitations: h.limitations,
    }));
  });
  if (timing && timing.status === 'supported' && timing.window) {
    recommendations.push(buildRecommendation({
      id: 'rec-timing',
      recommendation: `انشر في نافذة ${timing.window} (${timing.timezone}).`,
      reason: timing.reason,
      evidence: [timing.evidence],
      source: [`${marketPlatform} API — أوقات نشر ومشاهدات فعلية`],
      sampleSize: timing.sampleSize,
      expectedOutcome: 'وصول أوسع للجمهور المحلي في نافذة النشاط.',
      risk: 'low',
      nextTest: 'اختبر نافذتين متقاربتين وقس الوصول.',
      limitations: timing.limitations,
    }));
  }

  // 12) الاستراتيجيات — يومية/أسبوعية/منصة/جمهور/منتج حسب توفّر الأدلة.
  const strategies: StrategyPlan[] = [];
  if (hypotheses.length) {
    strategies.push(buildStrategyPlan({
      scope: 'weekly',
      what: hypotheses[0].suggestedContent,
      why: hypotheses[0].hypothesis,
      who: audience.segments[0]?.label || 'جمهور محلي',
      where: [marketPlatform],
      when: timing && timing.status === 'supported' && timing.window ? timing.window : 'غير محدّد (بلا دليل كافٍ)',
      how: 'مسار محتوى كامل: حاجة → هدف → فكرة → نص → CTA → تكييف المنصة.',
      expectedSignal: hypotheses[0].expectedSignal,
      evidence: hypotheses[0].evidence,
      risk: 'low',
    }));
  }

  // 13) القرارات — تحليل آلي، ومسودة آمنة، ونشر يحتاج موافقة/اتصال.
  const decisions: Array<{ id: string; summary: string; explanation: DecisionExplanation }> = [
    { id: 'analyze', summary: 'تحليل الإشارات والجمهور', explanation: decide({ kind: 'analyze', platform: marketPlatform } as DecisionAction) },
    { id: 'draft', summary: 'صياغة مسودة محتوى', explanation: decide({ kind: 'draft', platform: marketPlatform } as DecisionAction) },
    {
      id: 'publish',
      summary: 'نشر محتوى مقترح',
      explanation: decide({
        kind: 'publish', platform: marketPlatform, capability: 'publish',
        authorized: true,
        connectedVerified: Boolean((input.connections || []).find((c) => c.platform === marketPlatform && c.connected && c.verified)),
        safetyPassed: true,
        dataSufficient: recommendations.length > 0,
        risk: 'medium', reversible: false,
      } as DecisionAction),
    },
  ];

  // 14) المخاطر — من غياب البيانات المؤثرة على القرار (بلا اختلاق).
  const risks: BrainRisk[] = [];
  if (!records.length) risks.push({ id: 'no-performance', risk: 'لا سجلات أداء حقيقية؛ التعلّم والتوصيات محدودة.', severity: 'medium', mitigation: 'اقرأ إحصاءات المنصة الرسمية لتغذية السجل.' });
  if (!input.verifiedFacts || !input.verifiedFacts.length) risks.push({ id: 'no-commercial-facts', risk: 'لا حقائق تجارية مسجّلة (سعر/ضمان/توفر)؛ لا يُذكر أي رقم.', severity: 'medium', mitigation: 'سجّل الأسعار/الضمانات الرسمية لدى المالك.' });
  if (marketClassified.length < 3) risks.push({ id: 'small-conversation-sample', risk: 'عيّنة التعليقات صغيرة؛ لا حكم تجاري قاطع.', severity: 'low', mitigation: 'اجمع تعليقات إضافية قبل تعديل القاعدة.' });

  // 15) الذاكرة الدائمة — إدراج أحداث التعلّم بلا تكرار مع الحفاظ على الأصل.
  let memStore: BrainMemoryStoreState = memory;
  const newMemoryRecords: BrainMemoryRecord[] = [];
  for (const event of learningEvents) {
    const { entry } = learningEventToMemory(event, now);
    const record = toMemoryRecord(entry);
    const res = upsertMemoryRecord(memStore, record);
    memStore = res.store;
    if (res.added) newMemoryRecords.push(record);
  }

  // 16) مسار المحتوى الحقيقي.
  const contentPath = buildRuntimeContentPath({ topNeed, verifiedFacts: input.verifiedFacts || [], productFacts: input.productFacts });

  // 17) اللقطة الموحّدة.
  const liveConnections: Partial<Record<PlatformId, { connected: boolean; verified: boolean }>> = {};
  for (const c of input.connections || []) liveConnections[c.platform] = { connected: c.connected, verified: c.verified };
  const platformStates: BrainPlatformState[] = capabilityMatrix(input.platforms).map((row) => ({
    platform: row.platform,
    capabilities: row.states,
    realConnector: row.realConnector,
    connected: Boolean(liveConnections[row.platform]?.connected),
    verified: Boolean(liveConnections[row.platform]?.verified),
  }));

  const state = buildCentralBrainState({
    platforms: input.platforms,
    now,
    goalPrimary: input.goalPrimary,
    goalSecondary: input.goalSecondary ?? null,
    knowledge,
    audience,
    market,
    experiments,
    contentStrategy: strategies.length ? recommendations.slice(0, 1) : [],
    strategies,
    contentPath,
    timing,
    signals,
    records,
    publishes: input.publishes,
    commentsByPlatform,
    liveConnections,
    platformStates,
    learning,
    ownerPreferences,
    recommendations,
    decisions,
    risks,
    aiCounters: input.aiCounters,
  });

  const observedProviderIds = learningEvents.map((e) => e.providerId).filter((x): x is string => Boolean(x));

  return {
    state,
    learning,
    ownerPreferences,
    learningEvents,
    newMemoryRecords,
    contentPath,
    strategies,
    experiments,
    timing,
    recommendations,
    knowledge,
    risks,
    observedProviderIds,
  };
}
