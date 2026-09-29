/**
 * مركز مراجعة تقرير YouTube اليومي — منطق خالص قابل للاختبار (بلا شبكة وبلا أسرار).
 *
 * الغرض: ربط كل رقم في التقرير اليومي **بنفس السجلات** التي كوّنته، وإتاحة مراجعة
 * المالك لكل تعليق (سبب القرار + الرد المقترح) ثم قرار صريح لا يغيّر الحالة تلقائياً.
 *
 * مصدر الحقيقة الوحيد هو `watcherState.processed` (سجلات حقيقية محفوظة). لا يُنشأ
 * مصدر بيانات جديد ولا يُختلق سجل: نفس المُحدِّدات (selectors) تُستخدم لحساب الرقم
 * ولإرجاع قائمته، فلا يقع discrepancy بين العدد والمحتوى.
 */

import {
  YOUTUBE_COMMENT_STAGE_LABELS_AR,
  type WatcherProcessedEntry,
  type YouTubeCommentStage,
} from './youtubeWatcher';
import { classifyComment, buildDeterministicReply, type ClassifiedComment } from './comments';

/** نافذة التقرير اليومي: آخر 24 ساعة من زمن معالجة النظام (كما في التقرير الحالي). */
export const WATCHER_BRIEF_WINDOW_MS = 24 * 3_600_000;

/** مفاتيح بطاقات التقرير اليومي — مصدر واحد يربط الرقم بقائمته. */
export const WATCHER_BRIEF_METRICS = [
  'newComments',
  'replies',
  'skipped',
  'escalated',
  'verifiedReplies',
  'failedReplies',
  'positive',
  'negative',
] as const;
export type WatcherBriefMetric = (typeof WATCHER_BRIEF_METRICS)[number];

export const WATCHER_BRIEF_METRIC_LABELS_AR: Record<WatcherBriefMetric, string> = {
  newComments: 'تعليقات جديدة',
  replies: 'ردود',
  skipped: 'مُتجاهَلة / مؤجَّلة',
  escalated: 'مُصعَّدة',
  verifiedReplies: 'ردود مُتحقَّقة',
  failedReplies: 'ردود فاشلة',
  positive: 'مشاعر +',
  negative: 'مشاعر −',
};

/** مسمّى مختصر للتصنيف (يُعرض بلا إعادة تفسير). */
const INTENT_LABELS_AR: Record<string, string> = {
  praise: 'مدح/إعجاب',
  question: 'سؤال',
  business_inquiry: 'استفسار تجاري',
  complaint: 'شكوى',
  spam: 'سبام',
  neutral: 'محايد',
  other: 'غير محدّد',
};
const SENTIMENT_LABELS_AR: Record<string, string> = { positive: 'إيجابي', negative: 'سلبي', neutral: 'محايد' };
const TOPIC_LABELS_AR: Record<string, string> = {
  location: 'الموقع', price: 'السعر', availability: 'التوفر', hours: 'الدوام', general: 'عام',
};
const SUB_INTENT_LABELS_AR: Record<string, string> = {
  thanks: 'شكر', blessing: 'دعاء', greeting: 'تحية', appreciation: 'إعجاب', emoji: 'إيموجي', none: 'لا شيء',
};

/** هل السجل داخل نافذة التقرير اليومي؟ */
export function isWithinBriefWindow(entry: WatcherProcessedEntry, now: number, windowMs = WATCHER_BRIEF_WINDOW_MS): boolean {
  const t = Date.parse(String(entry?.at || ''));
  return Number.isFinite(t) && t >= now - windowMs;
}

/** تعليق «مؤجَّل» (تعذّر بسبب إعداد المالك) لا يُخلط بالتجاهل النهائي. */
export function isDeferredEntry(entry: WatcherProcessedEntry): boolean {
  return Boolean(entry?.deferred) || entry?.code === 'DEFER_AUTOREPLY_DISABLED';
}

/**
 * المُحدِّد الحتمي لكل بطاقة: يُعيد **نفس** السجلات التي يُبنى منها الرقم.
 * لا يجتهد: شرط واحد واضح لكل بطاقة، مطابق تماماً لحساب `buildWatcherDailyBrief`.
 */
export function selectMetricEntries(
  entries: WatcherProcessedEntry[],
  metric: WatcherBriefMetric,
  now: number,
): WatcherProcessedEntry[] {
  const recent = (entries || []).filter((e) => isWithinBriefWindow(e, now));
  switch (metric) {
    case 'newComments': return recent;
    case 'replies': return recent.filter((e) => e.stage === 'REPLIED' || e.stage === 'VERIFIED');
    case 'skipped': return recent.filter((e) => e.stage === 'SKIPPED');
    case 'escalated': return recent.filter((e) => e.stage === 'ESCALATED');
    case 'verifiedReplies': return recent.filter((e) => e.stage === 'VERIFIED');
    case 'failedReplies': return recent.filter((e) => e.stage === 'FAILED');
    case 'positive': return recent.filter((e) => classifyComment(e.text).sentiment === 'positive');
    case 'negative': return recent.filter((e) => classifyComment(e.text).sentiment === 'negative');
    default: return [];
  }
}

/** عدّادات التقرير اليومي — مشتقّة من نفس المُحدِّدات (ضمان تطابق العدد والمحتوى). */
export function computeBriefCounts(entries: WatcherProcessedEntry[], now: number): Record<WatcherBriefMetric, number> {
  const out = {} as Record<WatcherBriefMetric, number>;
  for (const m of WATCHER_BRIEF_METRICS) out[m] = selectMetricEntries(entries, m, now).length;
  return out;
}

/** بطاقات التقرير للواجهة: المفتاح + المسمّى + العدد (قابل للنقر). */
export function buildMetricViews(entries: WatcherProcessedEntry[], now: number): Array<{ key: WatcherBriefMetric; labelAr: string; count: number }> {
  const counts = computeBriefCounts(entries, now);
  return WATCHER_BRIEF_METRICS.map((key) => ({ key, labelAr: WATCHER_BRIEF_METRIC_LABELS_AR[key], count: counts[key] }));
}

/** سجل تفصيلي واحد للعرض/المراجعة — كل الحقول من السجل الحقيقي فقط. */
export interface WatcherDetailRecord {
  commentId: string;
  platform: 'youtube';
  videoId: string | null;
  videoTitle: string | null;
  videoUrl: string | null;
  authorName: string | null;
  text: string;
  at: string;
  publishedAt: string | null;
  stage: YouTubeCommentStage;
  stageLabelAr: string;
  action: string;
  reason: string;
  code: string | null;
  deferred: boolean;
  needsReview: boolean;
  delivered: boolean;
  externalReplyId: string | null;
  replyText: string | null;
  /** التصنيف الحتمي (نفس التصنيف المستخدم في القرار). */
  classification: {
    intent: string; intentLabelAr: string;
    sentiment: string; sentimentLabelAr: string;
    topic: string; topicLabelAr: string;
    subIntent: string; subIntentLabelAr: string;
    isSpam: boolean; requiresHumanReview: boolean; reviewReason: string | null;
  };
  /** الرد المقترح (حتمي) — يُعرض قبل أي إرسال ولا يُرسَل تلقائياً. */
  suggestedReply: string;
  /** هل يمكن للمالك إرسال رد هنا؟ (المصدر: قدرة المنصة/الحالة — لا يُرسَل بلا بوابات). */
  canReply: boolean;
}

function youtubeWatchUrl(videoId: string | null): string | null {
  return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : null;
}

/** يحوّل سجل معالجة حقيقي إلى سجل تفصيلي للعرض (بلا أي سرّ). */
export function toDetailRecord(
  entry: WatcherProcessedEntry,
  opts: { videoTitles?: Record<string, string | null | undefined> } = {},
): WatcherDetailRecord {
  const text = String(entry?.text || '');
  const cls: ClassifiedComment = classifyComment(text);
  const videoId = entry?.videoId ?? null;
  const title = videoId ? (opts.videoTitles?.[videoId] ?? null) : null;
  const suggested = buildDeterministicReply(cls);
  const delivered = Boolean(entry?.externalReplyId) && (entry?.stage === 'REPLIED' || entry?.stage === 'VERIFIED');
  return {
    commentId: String(entry.commentId),
    platform: 'youtube',
    videoId,
    videoTitle: title ?? null,
    videoUrl: youtubeWatchUrl(videoId),
    authorName: entry?.authorName ?? null,
    text,
    at: entry?.at ?? '',
    publishedAt: entry?.publishedAt ?? null,
    stage: entry.stage,
    stageLabelAr: YOUTUBE_COMMENT_STAGE_LABELS_AR[entry.stage] || entry.stage,
    action: entry?.action || '',
    reason: entry?.reason || '',
    code: entry?.code ?? null,
    deferred: isDeferredEntry(entry),
    needsReview: entry.stage === 'ESCALATED' || entry.stage === 'FAILED',
    delivered,
    externalReplyId: entry?.externalReplyId ?? null,
    replyText: entry?.replyText ?? null,
    classification: {
      intent: cls.intent, intentLabelAr: INTENT_LABELS_AR[cls.intent] || cls.intent,
      sentiment: cls.sentiment, sentimentLabelAr: SENTIMENT_LABELS_AR[cls.sentiment] || cls.sentiment,
      topic: cls.topic, topicLabelAr: TOPIC_LABELS_AR[cls.topic] || cls.topic,
      subIntent: cls.subIntent, subIntentLabelAr: SUB_INTENT_LABELS_AR[cls.subIntent] || cls.subIntent,
      isSpam: cls.isSpam, requiresHumanReview: cls.requiresHumanReview, reviewReason: cls.reviewReason ?? null,
    },
    suggestedReply: suggested,
    // لا يُعلن إمكان الرد إلا لتعليق ليس مُسلَّماً بعد (الإرسال الفعلي يمر بكل البوابات).
    canReply: !delivered,
  };
}

/** فلاتر شاشة التفاصيل (كلها اختيارية؛ «الكل» = بلا فلتر). */
export interface WatcherDetailFilters {
  stage?: string;
  intent?: string;
  sentiment?: string;
  delivered?: boolean;
  needsReview?: boolean;
  q?: string;
}

/** يطبّق الفلاتر على السجلات التفصيلية (بلا تغيير أي حالة). */
export function applyDetailFilters(records: WatcherDetailRecord[], filters: WatcherDetailFilters = {}): WatcherDetailRecord[] {
  return (records || []).filter((r) => {
    if (filters.stage && r.stage !== filters.stage) return false;
    if (filters.intent && r.classification.intent !== filters.intent) return false;
    if (filters.sentiment && r.classification.sentiment !== filters.sentiment) return false;
    if (typeof filters.delivered === 'boolean' && r.delivered !== filters.delivered) return false;
    if (typeof filters.needsReview === 'boolean' && r.needsReview !== filters.needsReview) return false;
    if (filters.q) {
      const q = filters.q.trim().toLowerCase();
      if (q && !(`${r.text} ${r.authorName || ''} ${r.commentId}`.toLowerCase().includes(q))) return false;
    }
    return true;
  });
}

// -------------------------------------------------------------
// قرارات المراجعة (Override) — لا تُغيّر الحالة إلا بفعل صريح من المالك.
// -------------------------------------------------------------

export const WATCHER_REVIEW_ACTIONS = ['allow_reply', 'reprocess', 'ignore', 'escalate', 'block_reply'] as const;
export type WatcherReviewAction = (typeof WATCHER_REVIEW_ACTIONS)[number];

export const WATCHER_REVIEW_ACTION_LABELS_AR: Record<WatcherReviewAction, string> = {
  allow_reply: 'السماح بالرد (إرسال الآن)',
  reprocess: 'إعادة المعالجة',
  ignore: 'تجاهل',
  escalate: 'تصعيد للمراجعة البشرية',
  block_reply: 'منع الرد على هذا التعليق',
};

export interface WatcherReviewOverride {
  commentId: string;
  action: WatcherReviewAction;
  at: string;
  by: string;
  note?: string | null;
}

/** هل يسمح الـoverride بفرض الرد رغم قرار النظام؟ (يبقى مرور البوابات إلزامياً). */
export function overrideForcesReply(o: WatcherReviewOverride | null | undefined): boolean {
  return Boolean(o && (o.action === 'allow_reply' || o.action === 'reprocess'));
}

/** القرار المفروض من المالك على التعليق (أو null إن لا override فعّال). */
export function overrideForcedStage(o: WatcherReviewOverride | null | undefined): YouTubeCommentStage | null {
  if (!o) return null;
  if (o.action === 'ignore' || o.action === 'block_reply') return 'SKIPPED';
  if (o.action === 'escalate') return 'ESCALATED';
  return null;
}

/** تحقق من صحة طلب مراجعة (يُستخدم في الخادم قبل أي تنفيذ). */
export function isValidReviewAction(action: unknown): action is WatcherReviewAction {
  return typeof action === 'string' && (WATCHER_REVIEW_ACTIONS as readonly string[]).includes(action);
}

/** تطبيع قائمة الـoverrides المسترجَعة من الحالة (بلا فقدان/اختلاق). */
export function normalizeReviewOverrides(raw: any): WatcherReviewOverride[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o: any) => o && typeof o.commentId === 'string' && isValidReviewAction(o.action))
    .map((o: any) => ({ commentId: o.commentId, action: o.action, at: typeof o.at === 'string' ? o.at : '', by: typeof o.by === 'string' ? o.by : 'owner', note: o.note ?? null }))
    .slice(0, 5000);
}

/** آخر override فعّال لكل تعليق (خريطة commentId → override). */
export function latestOverridesByComment(overrides: WatcherReviewOverride[]): Record<string, WatcherReviewOverride> {
  const map: Record<string, WatcherReviewOverride> = {};
  for (const o of overrides || []) map[o.commentId] = o; // الأحدث أولاً في المصفوفة ⇒ آخر كتابة تفوز
  return map;
}
