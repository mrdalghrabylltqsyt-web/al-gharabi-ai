/**
 * Audience Intelligence — بناء نموذج جمهور من بيانات حقيقية فقط.
 *
 * الجمهور هنا **طبقة استدلال** لا لوحة عرض. تُبنى المقاطع (Segments) من مؤشرات
 * وتصنيف تعليقات فعليين، وكل مقطع يحمل دليله ومصدره وعيّنته وثقته وحدوده.
 *
 * قيود صارمة:
 * - **لا تُستنتج سمات حساسة** (عمر/جنس/هوية/موقع/دخل) إن لم توفّرها المنصة رسمياً.
 * - الموقع/الديموغرافيا غير المتاحة تُعلن `NOT_AVAILABLE` بدل التخمين.
 * - لا مقطع بلا `evidence` و`source` و`sampleSize`.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';
import { classifyComment, type ClassifiedComment } from '../../social/comments';
import type { PlatformMetricRecord } from '../../social/platformLearning';

export type Confidence = 'low' | 'medium' | 'high';

export interface AudienceEvidence {
  statement: string;
  source: string;
  sampleSize: number;
}

export interface AudienceSegment {
  id: string;
  label: string;
  /** سمات **مستنتجة من التفاعل** فقط (اهتمامات/أسئلة/توقيت/نوع محتوى) — لا سمات شخصية. */
  interests: string[];
  contentPreferences: string[];
  commonQuestions: string[];
  buyingSignals: string[];
  preferredContentType: string | null;
  activePeriods: string[];
  evidence: AudienceEvidence[];
  source: string;
  sampleSize: number;
  confidence: Confidence;
  limitations: string[];
}

/** حقول غير متاحة تُعلن صراحةً حتى لا تُخترع. */
export const AUDIENCE_NOT_AVAILABLE_FIELDS: ReadonlyArray<{ field: string; labelAr: string; reason: string }> = Object.freeze([
  { field: 'age', labelAr: 'العمر', reason: 'بيانات سكانية غير متاحة عبر الواجهات الرسمية الحالية — لا تُخترع.' },
  { field: 'gender', labelAr: 'الجنس', reason: 'بيانات سكانية غير متاحة عبر الواجهات الرسمية الحالية — لا تُخترع.' },
  { field: 'city', labelAr: 'المدينة', reason: 'بيانات جغرافية دقيقة غير متاحة عبر الواجهات الحالية — لا تُخترع.' },
  { field: 'country', labelAr: 'البلد', reason: 'يتطلب واجهة تحليلات جغرافية لم تُطلب — لا تُخترع.' },
  { field: 'income', labelAr: 'الدخل', reason: 'سمة حساسة غير متاحة ولا يجوز استنتاجها.' },
  { field: 'identity', labelAr: 'الهوية', reason: 'سمة حساسة غير متاحة ولا يجوز استنتاجها.' },
]);

export interface AudienceModel {
  platform: PlatformId | 'cross_platform';
  segments: AudienceSegment[];
  /** حقول غير متاحة معلنة صراحةً. */
  notAvailableFields: Array<{ field: string; labelAr: string; reason: string }>;
  demographicsAvailable: false;
  sampleSize: number;
  confidence: Confidence;
  note: string;
  limitations: string[];
}

function confidenceFromSample(n: number): Confidence {
  if (n >= 8) return 'medium';
  return 'low';
}

/**
 * يبني نموذج جمهور لمنصة من مؤشرات وسجلات وتعليقات فعلية. لا يُنتج أي سمة شخصية،
 * ولا مقطعاً بلا دليل.
 */
export function buildAudienceModel(input: {
  platform: PlatformId;
  records: PlatformMetricRecord[];
  comments?: Array<{ text: string; authorName?: string }>;
}): AudienceModel {
  const platform = input.platform;
  const records = (input.records || []).filter((r) => r.platform === platform);
  const comments = input.comments || [];
  const classified: ClassifiedComment[] = comments.map((c) => classifyComment(c.text || ''));

  const evidence: AudienceEvidence[] = [];
  const interests: string[] = [];
  const contentPreferences: string[] = [];
  const commonQuestions: string[] = [];
  const buyingSignals: string[] = [];
  const limitations: string[] = [];

  // اهتمامات من تصنيف التعليقات الحقيقي (موضوعات متكررة).
  const topicCounts = new Map<string, number>();
  for (const c of classified) {
    if (c.topic && c.topic !== 'general') topicCounts.set(c.topic, (topicCounts.get(c.topic) || 0) + 1);
    if (c.isQuestion && c.topic && c.topic !== 'general') commonQuestions.push(c.topic);
    if (c.isBusinessInquiry) buyingSignals.push(c.topic || 'general');
  }
  for (const [topic, count] of [...topicCounts.entries()].sort((a, b) => b[1] - a[1])) {
    interests.push(topic);
    evidence.push({
      statement: `موضوع «${topic}» تكرّر في ${count} تعليقاً حقيقياً.`,
      source: `${platform} API — تصنيف تعليقات حتمي`,
      sampleSize: comments.length,
    });
  }

  // تفضيل نوع المحتوى من أداء حقيقي (views) عند التوفر.
  const withViews = records.filter((r) => typeof r.values?.views === 'number' && Number.isFinite(r.values.views));
  let preferredContentType: string | null = null;
  if (withViews.length) {
    const byType = new Map<string, { sum: number; count: number }>();
    for (const r of withViews) {
      const key = (r.contentType || r.productCategory || '').trim();
      if (!key) continue;
      const cur = byType.get(key) || { sum: 0, count: 0 };
      cur.sum += Number(r.values.views);
      cur.count += 1;
      byType.set(key, cur);
    }
    const ranked = [...byType.entries()].sort((a, b) => (b[1].sum / b[1].count) - (a[1].sum / a[1].count));
    if (ranked.length) {
      preferredContentType = ranked[0][0];
      contentPreferences.push(preferredContentType);
      evidence.push({
        statement: `نوع المحتوى الأكثر مشاهدات: «${preferredContentType}» (متوسط ≈ ${Math.round(ranked[0][1].sum / ranked[0][1].count)}).`,
        source: `${platform} API — views`,
        sampleSize: withViews.length,
      });
    }
  } else {
    limitations.push('لا مؤشر views متاح لترتيب تفضيلات نوع المحتوى.');
  }

  // نوافذ النشاط من أوقات نشر حقيقية فقط.
  const activePeriods: string[] = [];
  const hours = records
    .map((r) => (r.publishedAt ? new Date(r.publishedAt).getUTCHours() : NaN))
    .filter((h) => Number.isFinite(h));
  if (hours.length >= 3) {
    const buckets = new Map<string, number>();
    for (const h of hours) {
      const label = h < 12 ? 'صباحاً' : h < 17 ? 'بعد الظهر' : 'مساءً';
      buckets.set(label, (buckets.get(label) || 0) + 1);
    }
    const top = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0];
    activePeriods.push(top[0]);
    evidence.push({
      statement: `معظم النشر الفعلي في «${top[0]}» (${top[1]} من ${hours.length}).`,
      source: `${platform} API — أوقات نشر حقيقية`,
      sampleSize: hours.length,
    });
  } else {
    limitations.push('أوقات النشر الحقيقية غير كافية لاستنتاج نوافذ نشاط.');
  }

  const sampleSize = records.length + comments.length;
  const segments: AudienceSegment[] = [];
  if (sampleSize > 0 && (interests.length || preferredContentType)) {
    segments.push({
      id: `${platform}-primary`,
      label: `المقطع الأساسي على ${platform}`,
      interests,
      contentPreferences,
      commonQuestions: [...new Set(commonQuestions)],
      buyingSignals: [...new Set(buyingSignals)],
      preferredContentType,
      activePeriods,
      evidence,
      source: `${platform} API — مؤشرات وتعليقات فعلية`,
      sampleSize,
      confidence: confidenceFromSample(sampleSize),
      limitations: [...limitations, 'السمات الشخصية (عمر/جنس/موقع) غير متاحة ولا تُستنتج.'],
    });
  }

  if (!segments.length) {
    limitations.push('لا توجد بيانات كافية لبناء أي مقطع جمهور؛ لا يُخترع مقطع.');
  }

  return {
    platform,
    segments,
    notAvailableFields: [...AUDIENCE_NOT_AVAILABLE_FIELDS],
    demographicsAvailable: false,
    sampleSize,
    confidence: confidenceFromSample(sampleSize),
    note: 'نموذج جمهور من بيانات تفاعل حقيقية فقط. لا تُستنتج سمات حساسة، وغير المتاح يُعلن صراحةً.',
    limitations: [...limitations, 'الموقع/العمر/الجنس/العائدون تحتاج واجهات تحليلات لم تُطلب؛ معلنة NOT_AVAILABLE.'],
  };
}

/** نموذج جمهور عام عبر المنصات (يجمع بلا خلط مقاييس غير متجانسة). */
export function buildCrossPlatformAudienceModel(input: {
  platforms: PlatformId[];
  records: PlatformMetricRecord[];
  commentsByPlatform?: Partial<Record<PlatformId, Array<{ text: string; authorName?: string }>>>;
}): AudienceModel {
  const perPlatform = input.platforms.map((p) => buildAudienceModel({
    platform: p,
    records: input.records,
    comments: input.commentsByPlatform?.[p],
  }));
  const segments = perPlatform.flatMap((m) => m.segments);
  const sampleSize = perPlatform.reduce((s, m) => s + m.sampleSize, 0);
  return {
    platform: 'cross_platform',
    segments,
    notAvailableFields: [...AUDIENCE_NOT_AVAILABLE_FIELDS],
    demographicsAvailable: false,
    sampleSize,
    confidence: confidenceFromSample(sampleSize),
    note: 'نموذج جمهور عام عبر المنصات المتصلة؛ لا خلط لمقاييس غير متجانسة، ولا سمات شخصية.',
    limitations: ['المنصات التي لا توفّر تعليقات/مؤشرات لا يُدَّعى نموذج جمهور لها.', 'لا تُخترع سمات حساسة.'],
  };
}

/**
 * يقترح مقطعاً مستهدفاً لمحتوى معيّن بلا اختراع: إن لم يوجد دليل، يُعلن ذلك.
 */
export function selectTargetSegment(model: AudienceModel): { segment: AudienceSegment | null; reason: string } {
  if (!model.segments.length) {
    return { segment: null, reason: 'لا مقاطع جمهور مدعومة ببيانات؛ لا يُخترع مقطع مستهدف.' };
  }
  const best = [...model.segments].sort((a, b) => b.sampleSize - a.sampleSize)[0];
  return { segment: best, reason: `أكبر عيّنة مدعومة (${best.sampleSize}) مع دليل حقيقي.` };
}
