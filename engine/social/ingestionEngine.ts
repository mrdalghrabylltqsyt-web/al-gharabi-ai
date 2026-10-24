/**
 * Unified Ingestion Engine — محرّك الاستقبال الموحّد لكل المنصات العشر.
 *
 * سبب الوجود: كانت كل منصة تستقبل تعليقاتها/رسائلها بمسارها الخاص (webhook أو
 * polling) وتخزّنها في `workspace.socialComments` بالشكل نفسه، لكن لا توجد طبقة
 * **موحّدة** تُطبّع الحدث الواحد عبر كل المنصات، ولا صحة استقبال واحدة، ولا
 * شخصية رد عراقية واحدة. هذا الملف هو تلك الطبقة.
 *
 * قواعد ملزمة:
 * - القدرات تُقرأ من سجل الموصلات (`PLATFORM_SPECS`) — لا قائمة منفصلة تنحرف.
 * - لا ادّعاء استقبال حيّ لمنصة بلا موصل/قناة إدخال حقيقية.
 * - الحدث الموحّد بنية واحدة بغض النظر عن المنصة (تعليق/رسالة).
 * - منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 * - لا يستهلك أي حصة AI: التصنيف والقياس حتميان.
 */

import { PLATFORM_SPECS } from './registry';
import type { PlatformId } from './adapter';
import { classifyComment, type ClassifiedComment } from './comments';

// ---------------------------------------------------------------------------
// الحدث الاجتماعي الموحّد
// ---------------------------------------------------------------------------

/** نوع الحدث الموحّد عبر كل المنصات. */
export type UnifiedEventKind = 'comment' | 'message';

/**
 * الحدث الاجتماعي الموحّد: بنية واحدة يدخل بها أي تعليق/رسالة من أي منصة إلى
 * مسار المعالجة الواحد (تصنيف → قرار → رد/تصعيد). لا تختلف المعالجة بتغيّر المنصة.
 */
export interface UnifiedSocialEvent {
  platform: PlatformId;
  kind: UnifiedEventKind;
  externalId: string;
  parentExternalId: string | null;
  authorName: string | null;
  text: string;
  createdAt: string;
  ingestSource: string;
  /** نتيجة التصنيف الحتمي (نفس مصنّف التعليقات في كل المنصات). */
  classification: ClassifiedComment;
}

/** يحوّل سجلاً مخزّناً في `workspace.socialComments` إلى حدث موحّد (تطبيع صريح). */
export function toUnifiedSocialEvent(record: any): UnifiedSocialEvent | null {
  if (!record || typeof record !== 'object') return null;
  const platform = typeof record.platform === 'string' ? record.platform : '';
  if (!platform) return null;
  const text = typeof record.text === 'string' ? record.text : '';
  const kind: UnifiedEventKind = record.kind === 'message' || /message/i.test(String(record.ingestSource || '')) ? 'message' : 'comment';
  const classification: ClassifiedComment = record.classification && typeof record.classification === 'object'
    ? record.classification
    : classifyComment(text);
  return {
    platform: platform as PlatformId,
    kind,
    externalId: String(record.externalId ?? ''),
    parentExternalId: record.postExternalId ?? record.parentId ?? null,
    authorName: typeof record.authorName === 'string' ? record.authorName : null,
    text,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
    ingestSource: typeof record.ingestSource === 'string' ? record.ingestSource : 'unknown',
    classification,
  };
}

// ---------------------------------------------------------------------------
// مصفوفة المنصات للاستقبال (القدرة ≠ الاتصال ≠ القناة)
// ---------------------------------------------------------------------------

/**
 * قناة إدخال الحدث الحقيقية للمنصة:
 * - webhook: المزود يدفع الحدث إلى نقطة استقبال موقّعة.
 * - polling: لا webhook رسمي ⇒ سحب دوري عبر واجهة القراءة.
 * - none: لا واجهة استقبال عامة ⇒ لا ادّعاء استقبال.
 */
export type IngestionChannel = 'webhook' | 'polling' | 'none';

export interface PlatformIngestionRow {
  platform: PlatformId;
  displayName: string;
  /** هل تعلن المنصة قدرة تعليقات عامة؟ */
  supportsComments: boolean;
  /** هل تعلن المنصة قدرة رسائل مباشرة؟ */
  supportsMessages: boolean;
  hasRealConnector: boolean;
  channel: IngestionChannel;
  /** هل يمكن أن يصل حدث حقيقي الآن (موصل حقيقي + قناة إدخال). */
  canIngest: boolean;
}

/**
 * مصدر واحد لقناة الإدخال لكل منصة. المنصات ذات الموصل الحقيقي المنفّذ
 * (Telegram/Facebook/Instagram/WhatsApp) تستقبل عبر webhook موقّع؛ وYouTube (بلا
 * webhook عام في هذا النظام) يسحب دورياً؛ والبقية بلا قناة استقبال منفّذة الآن.
 */
const INGESTION_CHANNEL_BY_PLATFORM: Record<string, IngestionChannel> = Object.freeze({
  telegram: 'webhook',
  facebook: 'webhook',
  instagram: 'webhook',
  // W1: استقبال WhatsApp Cloud API عبر webhook موقّع (X-Hub-Signature-256 على الجسم الخام).
  whatsapp: 'webhook',
  youtube: 'polling',
});

/** يبني مصفوفة الاستقبال من سجل الموصلات مباشرةً (لا قائمة موازية). */
export function buildIngestionMatrix(): PlatformIngestionRow[] {
  return PLATFORM_SPECS.map((spec) => {
    const caps = spec.capabilities as readonly string[];
    const supportsComments = caps.includes('comments');
    const supportsMessages = caps.includes('messages');
    const hasRealConnector = spec.realConnector === true;
    const channel = INGESTION_CHANNEL_BY_PLATFORM[spec.platform] ?? 'none';
    return {
      platform: spec.platform as PlatformId,
      displayName: spec.displayName,
      supportsComments,
      supportsMessages,
      hasRealConnector,
      channel,
      canIngest: hasRealConnector && channel !== 'none' && (supportsComments || supportsMessages),
    };
  });
}

/** المنصات التي يمكن أن يصل منها حدث حقيقي الآن. */
export function ingestiblePlatforms(): PlatformId[] {
  return buildIngestionMatrix().filter((r) => r.canIngest).map((r) => r.platform);
}

// ---------------------------------------------------------------------------
// تجميع/قياس الاستقبال الموحّد (من سجلات حقيقية فقط)
// ---------------------------------------------------------------------------

export interface IngestionEngineSummary {
  /** عمق الطابور: أحدث تعليقات/رسائل غير مُعالجة (بلا رد ولا تصعيد). */
  queueDepth: number;
  /** إجمالي الأحداث المخزّنة عبر كل المنصات. */
  totalIngested: number;
  /** آخر وقت استقبال فعلي (ISO) عبر كل الأحداث، أو null. */
  lastIngestionAt: string | null;
  /** آخر وقت استقبال لكل منصة (ISO) — بلا اسم حساب أو نص. */
  perPlatformLastAt: Record<string, string | null>;
  /** عدد الأحداث المخزّنة لكل منصة (تقني فقط). */
  byPlatform: Record<string, number>;
  /** عدد الأحداث حسب نوع القناة المدخلة (webhook/polling/...). */
  byIngestSource: Record<string, number>;
  /** عدد الأحداث التي تحتاج مراجعة بشرية. */
  requiresHumanReview: number;
  /** هل استُقبل أي حدث من منصة بلا قناة إدخال حقيقية (انحراف يُكشف)؟ */
  unexpectedSources: string[];
}

/**
 * يجمع قياسات الاستقبال الموحّد من سجلات حقيقية. لا يخترع أي رقم: عند غياب
 * السجلات يكون عمق الطابور صفراً والفروق صريحة. `repliedExternalIds` مجموعة
 * معرّفات التعليقات التي رُدّ عليها فعلاً (من `socialReplies`) لتحديد المعلّق.
 */
export function summarizeIngestion(input: {
  events: UnifiedSocialEvent[];
  repliedExternalIds?: Iterable<string>;
  escalatedExternalIds?: Iterable<string>;
}): IngestionEngineSummary {
  const events = input.events;
  const replied = new Set(input.repliedExternalIds ?? []);
  const escalated = new Set(input.escalatedExternalIds ?? []);
  const byPlatform: Record<string, number> = {};
  const byIngestSource: Record<string, number> = {};
  const perPlatformLastAt: Record<string, string | null> = {};
  let lastIngestionAt: string | null = null;
  let queueDepth = 0;
  let requiresHumanReview = 0;

  for (const ev of events) {
    byPlatform[ev.platform] = (byPlatform[ev.platform] || 0) + 1;
    byIngestSource[ev.ingestSource] = (byIngestSource[ev.ingestSource] || 0) + 1;
    const prev = perPlatformLastAt[ev.platform];
    if (!prev || ev.createdAt > prev) perPlatformLastAt[ev.platform] = ev.createdAt;
    if (!lastIngestionAt || ev.createdAt > lastIngestionAt) lastIngestionAt = ev.createdAt;
    if (ev.classification.requiresHumanReview) requiresHumanReview += 1;
    // المعلّق: لم يُرَدّ عليه ولم يُصعَّد ⇒ ينتظر المعالجة.
    if (ev.externalId && !replied.has(ev.externalId) && !escalated.has(ev.externalId)) queueDepth += 1;
  }

  const ingestible = new Set(ingestiblePlatforms());
  const unexpectedSources = Object.keys(byPlatform).filter((p) => !ingestible.has(p as PlatformId) && INGESTION_CHANNEL_BY_PLATFORM[p] === undefined);

  return {
    queueDepth,
    totalIngested: events.length,
    lastIngestionAt,
    perPlatformLastAt,
    byPlatform,
    byIngestSource,
    requiresHumanReview,
    unexpectedSources,
  };
}

// ---------------------------------------------------------------------------
// الشخصية العراقية الموحّدة (مصدر واحد لكل المنصات)
// ---------------------------------------------------------------------------

/**
 * بنية شخصية الوكيل: تُبنى مرة واحدة وتُستخدم في صياغة ردود كل المنصات (بلا
 * شخصية منفصلة لكل منصة). الحقائق (سعر/موقع/دوام) تُحقن من بيانات مسجّلة فقط.
 */
export interface ShowroomFacts {
  name?: string;
  city?: string;
  locationText?: string;
  hoursText?: string;
  installmentNote?: string;
  contactHint?: string;
}

export const SHOWROOM_NAME = 'معرض الغرابي للتقسيط';
export const SHOWROOM_CITY = 'كربلاء';

/**
 * قواعد النبرة العراقية العفوية واللطيفة — مصدر واحد. تُستهلك في بصمة الشخصية
 * وفي اختبار اللهجة، فلا تنحرف النسخ.
 */
export const IRAQI_PERSONA_GUIDELINES_AR: readonly string[] = Object.freeze([
  'تكلّم بلهجة عراقية عفوية لطيفة مفهومة لكل عراقي، لا بالفصحى المتكلّفة.',
  'كن دافئاً وقريباً من القلب، بلا تكلّف ولا إعلانات فجّة.',
  'ردود قصيرة على التعليقات القصيرة، وتفصيل عند الحاجة فقط.',
  'لا تبالغ ولا تخلق ندرة/إلحاحاً غير مثبت، ولا تحطّ من المنافسين.',
  'لا تذكر سعراً أو قسطاً أو موقعاً أو ضماناً غير مسجّل في بيانات المعرض؛ أعلن عدم توفّرها وأحل للتواصل.',
  'خاطب العميل مباشرة بضمير المخاطب، واشكره على تفاعله عند اللزوم.',
]);

/**
 * يبني بصمة الشخصية (system prompt fragment) الموحّدة لكل المنصات. تشرح الهوية
 * والمهمة والنبرة والقواعد الصارمة، وتحقن الحقائق **المسجّلة فقط** — بلا اختراع.
 */
export function buildIraqiPersonaPrompt(facts: ShowroomFacts = {}): string {
  const f = facts || {};
  const lines: string[] = [];
  lines.push(`أنت "الغرابي AI" — مساعد ${f.name || SHOWROOM_NAME} في خدمة العملاء على مواقع التواصل.`);
  lines.push(`المعرض يقدّم حلول تقسيط وتسهيلات ميسّرة، ومقره في ${f.city || SHOWROOM_CITY}.`);
  lines.push('');
  lines.push('الشخصية والنبرة (إلزامية):');
  for (const g of IRAQI_PERSONA_GUIDELINES_AR) lines.push(`- ${g}`);
  lines.push('');
  lines.push('حقائق مسجّلة (استخدمها فقط عندما تكون مذكورة؛ غيابها يعني «غير متوفرة»):');
  if (f.locationText) lines.push(`- الموقع: ${f.locationText}`); else lines.push('- الموقع: غير مسجّل — لا تذكره ولا تخترعه.');
  if (f.hoursText) lines.push(`- الدوام: ${f.hoursText}`); else lines.push('- الدوام: غير مسجّل — لا تذكره.');
  if (f.installmentNote) lines.push(`- التقسيط: ${f.installmentNote}`); else lines.push('- التقسيط: لا تذكر نسباً/مبالغ غير مسجّلة.');
  if (f.contactHint) lines.push(`- التواصل: ${f.contactHint}`); else lines.push('- التواصل: لا تخترع أرقاماً أو روابط غير مسجّلة.');
  lines.push('');
  lines.push('إن سُئل عن معلومة غير مسجّلة (سعر/قسط/توفر/موقع/دوام) فلا تخترعها، بل اعرض المساعدة والتحقق مع المعرض.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// تعلّم الاستقبال (إشارات تُغذّي ذاكرة العقل الموجودة — لا نظام ذاكرة ثانٍ)
// ---------------------------------------------------------------------------

/** الحد الأدنى للعيّنة قبل إعلان سؤال «متكرر». */
export const INGESTION_FREQUENT_MIN = 3;

export interface IngestionLearningRecord {
  /** خلاصة قصيرة بلا نص عميل خام ولا اسم. */
  summary: string;
  platform: PlatformId | null;
  /** أصل المعرفة: بيانات منصة (سلوك ملاحَظ) — لا قول AI. */
  origin: 'platform_data';
  sampleSize: number;
  sourceRefs: string[];
  /** معرّف مستقر (idempotent) لمنع تكرار نفس الإشارة. */
  id: string;
}

export interface IngestionFrequentQuestion {
  topic: ClassifiedComment['topic'];
  count: number;
  sampleSize: number;
}

/**
 * يُشتقّ من الأحداث الحقيقية أسئلة متكررة (موضوع/نوع). لا يعلن «متكرراً» بلا
 * عيّنة كافية، ولا يستخدم نص عميل. النتيجة تُغذّي ذاكرة العقل عبر نفس محوّلها.
 */
export function deriveFrequentQuestions(
  events: UnifiedSocialEvent[],
  min = INGESTION_FREQUENT_MIN,
): IngestionFrequentQuestion[] {
  const groups = new Map<ClassifiedComment['topic'], number>();
  for (const ev of events) {
    const cls = ev.classification;
    if (cls.isSpam) continue;
    if (!(cls.isQuestion || cls.isBusinessInquiry || cls.intent === 'question')) continue;
    if (!cls.topic || cls.topic === 'general') continue;
    groups.set(cls.topic, (groups.get(cls.topic) || 0) + 1);
  }
  return [...groups.entries()]
    .filter(([, count]) => count >= min)
    .map(([topic, count]) => ({ topic, count, sampleSize: events.length }))
    .sort((a, b) => b.count - a.count);
}

const TOPIC_LABELS_AR: Record<string, string> = Object.freeze({
  price: 'السعر',
  location: 'الموقع',
  availability: 'التوفر',
  hours: 'أوقات الدوام',
  warranty: 'الضمان',
  delivery: 'التوصيل',
  installment_terms: 'شروط التقسيط',
  installment: 'مدة التقسيط',
  general: 'عام',
});

/**
 * يحوّل الأحداث الحقيقية + الردود الناجحة إلى سجلات تعلّم صادقة تُغذّي ذاكرة
 * العقل القائمة (نفس `brainMemory`، لا نظام ثانٍ):
 * - سؤال متكرر (عيّنة كافية) ⇒ سجل `derived` بموضوعه وعدده.
 * - نجاح رد فعلي عبر منصة ⇒ سجل `platform_data` بأن المنصة تُنتج ردوداً مقبولة.
 * لا نص عميل خام ولا اسم حساب في أي خلاصة.
 */
export function deriveIngestionLearning(input: {
  events: UnifiedSocialEvent[];
  /** معرّفات التعليقات التي رُدّ عليها فعلاً (نجاح مثبت). */
  successfulReplyExternalIds?: Iterable<string>;
  now: number;
}): IngestionLearningRecord[] {
  const events = input.events;
  const successful = new Set(input.successfulReplyExternalIds ?? []);
  const records: IngestionLearningRecord[] = [];

  for (const q of deriveFrequentQuestions(events)) {
    records.push({
      id: `ingest:faq:${q.topic}`,
      // خلاصة ثابتة (بلا عدّاد) لتبقى الإشارة idempotent في الذاكرة؛ العدّ في sampleSize.
      summary: `سؤال متكرر (${TOPIC_LABELS_AR[q.topic] || q.topic}) عبر المنصات — تُقترح إجابة/محتوى ثابت.`,
      platform: null,
      origin: 'platform_data',
      sampleSize: q.sampleSize,
      sourceRefs: ['socialComments', 'ingestionEngine'],
    });
  }

  const successByPlatform = new Map<string, number>();
  for (const ev of events) {
    if (ev.externalId && successful.has(ev.externalId)) {
      successByPlatform.set(ev.platform, (successByPlatform.get(ev.platform) || 0) + 1);
    }
  }
  for (const [platform, count] of successByPlatform) {
    if (count < INGESTION_FREQUENT_MIN) continue;
    records.push({
      id: `ingest:reply-success:${platform}`,
      summary: `ردود فعلية ناجحة على ${platform} عبر الرد العراقي الموحّد — سلوك مُلاحَظ لا قاعدة تسعير.`,
      platform: platform as PlatformId,
      origin: 'platform_data',
      sampleSize: count,
      sourceRefs: ['socialReplies', 'ingestionEngine'],
    });
  }

  return records;
}

// ---------------------------------------------------------------------------
// صحة محرّك الاستقبال (للمراقبة المحمية فقط — لا بيانات عملاء)
// ---------------------------------------------------------------------------

export interface IngestionHealth {
  status: 'healthy' | 'degraded' | 'idle';
  /** منصات يمكن أن يصل منها حدث حقيقي الآن. */
  ingestiblePlatforms: PlatformId[];
  /** منصات مُعلنة لكن بلا قناة إدخال منفّذة (شفافية، لا ادّعاء). */
  channelsMissing: PlatformId[];
  queueDepth: number;
  totalIngested: number;
  lastIngestionAt: string | null;
  requiresHumanReview: number;
  platformsCovered: number;
  channels: Record<string, IngestionChannel>;
  note: string;
}

/**
 * صحة محرّك الاستقبال — الحقول التشغيلية غير الحساسة فقط (عمق الطابور، آخر
 * استقبال، القنوات). **لا** اسم حساب ولا نص تعليق ولا نص رد. آمن لو حُمِل داخل
 * النقطتين العامتين بعد تنقية الحارس.
 */
export function buildIngestionHealth(summary: IngestionEngineSummary): IngestionHealth {
  const matrix = buildIngestionMatrix();
  const ingestible = matrix.filter((r) => r.canIngest);
  const missing = matrix.filter((r) => !r.canIngest).map((r) => r.platform);
  const status: IngestionHealth['status'] = ingestible.length === 0
    ? 'idle'
    : summary.unexpectedSources.length > 0
      ? 'degraded'
      : 'healthy';
  const channels: Record<string, IngestionChannel> = {};
  for (const r of matrix) channels[r.platform] = r.channel;
  return {
    status,
    ingestiblePlatforms: ingestible.map((r) => r.platform),
    channelsMissing: missing,
    queueDepth: summary.queueDepth,
    totalIngested: summary.totalIngested,
    lastIngestionAt: summary.lastIngestionAt,
    requiresHumanReview: summary.requiresHumanReview,
    platformsCovered: matrix.length,
    channels,
    note: 'صحة استقبال تقنية فقط (عمق الطابور/آخر استقبال/القنوات). لا بيانات عملاء: النصوص والأسماء متاحة للمالك عبر المسارات المحمية.',
  };
}

/**
 * طبقة تعلّم الاستقبال: تُولّد سجلات التعلّم من لقطة الاستقبال. مصدر واحد يمنع
 * أن تنحرف نسخة الواجهة عن نسخة الخادم.
 */
export function buildIngestionEngine(input: {
  events: UnifiedSocialEvent[];
  successfulReplyExternalIds?: Iterable<string>;
  repliedExternalIds?: Iterable<string>;
  escalatedExternalIds?: Iterable<string>;
  now: number;
}): { summary: IngestionEngineSummary; health: IngestionHealth; learning: IngestionLearningRecord[] } {
  const summary = summarizeIngestion({
    events: input.events,
    repliedExternalIds: input.repliedExternalIds,
    escalatedExternalIds: input.escalatedExternalIds,
  });
  const health = buildIngestionHealth(summary);
  const learning = deriveIngestionLearning({
    events: input.events,
    successfulReplyExternalIds: input.successfulReplyExternalIds,
    now: input.now,
  });
  return { summary, health, learning };
}
