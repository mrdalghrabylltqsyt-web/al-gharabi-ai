/**
 * Audience Intelligence — تحليل جمهور عام لكل المنصات.
 *
 * يحلّل فقط ما هو متاح فعلاً من الواجهات الرسمية: أنواع المحتوى الأكثر تفاعلاً،
 * الفئات/المواضيع الأكثر اهتماماً، مواضيع التعليقات الشائعة، وأنماط التفاعل.
 *
 * **لا يُستنتج أي معلومة شخصية حساسة** (عمر/جنس/هوية/موقع/دخل) إن لم توفّرها
 * المنصة بشكل مشروع عبر واجهتها. هذه الوحدة تُعلن `demographicsAvailable: false`
 * دائماً هنا لأن أي منصة من العشر لا توفّر التركيبة السكانية في نطاقنا الحالي.
 */

import type { PlatformId } from './adapter';
import { metricAvailability } from './publishing';
import { classifyComment, type ClassifiedComment, type CommentIntent } from './comments';
import type { PlatformMetricRecord } from './platformLearning';

export interface AudienceObservation {
  observation: string;
  basis: string;
  sampleSize: number;
  confidence: 'low' | 'medium';
}

export interface AudienceAnalysis {
  platform: PlatformId | 'cross_platform';
  observations: AudienceObservation[];
  /** مواضيع الأسئلة/الطلبات الأكثر تكراراً (من نص التعليقات، بلا هوية). */
  frequentTopics: Array<{ topic: string; count: number }>;
  /** توزيع نوايا التعليقات (عند توفّر التعليقات). */
  intentBreakdown: Partial<Record<CommentIntent, number>>;
  demographicsAvailable: false;
  note: string;
  limitations: string[];
}

/**
 * تحليل جمهور لمنصة من مؤشرات وسجلات فعلية فقط. لا يُخترع أي رقم ولا أي سمة.
 */
export function analyzePlatformAudience(input: {
  platform: PlatformId;
  records: PlatformMetricRecord[];
  comments?: Array<{ text: string; authorName?: string }>;
}): AudienceAnalysis {
  const availability = metricAvailability(input.platform);
  const availableSet = new Set(availability.filter((a) => a.available).map((a) => a.metric));
  const observations: AudienceObservation[] = [];
  const limitations: string[] = [];
  const records = input.records.filter((r) => r.platform === input.platform);

  // أكثر أنواع المحتوى تفاعلاً (بمقياس متاح فعلاً).
  const primary = availableSet.has('reach') ? 'reach' : availableSet.has('views') ? 'views' : null;
  if (primary) {
    const byKey = new Map<string, { sum: number; count: number }>();
    for (const r of records) {
      const key = (r.contentType || r.productCategory || '').trim();
      const v = Number(r.values[primary]);
      if (!key || !Number.isFinite(v)) continue;
      const cur = byKey.get(key) || { sum: 0, count: 0 };
      cur.sum += v; cur.count += 1;
      byKey.set(key, cur);
    }
    const ranked = [...byKey.entries()].sort((a, b) => (b[1].sum / b[1].count) - (a[1].sum / a[1].count));
    if (ranked.length) {
      const [best, stats] = ranked[0];
      observations.push({
        observation: `أكثر أنواع المحتوى وصولاً: «${best}» (متوسط ${primary} ≈ ${Math.round(stats.sum / stats.count)}).`,
        basis: `مؤشر ${primary} من ${stats.count} عنصراً.`,
        sampleSize: records.length,
        confidence: stats.count >= 3 ? 'medium' : 'low',
      });
    }
  } else {
    limitations.push('لا مؤشر مشاهدة/وصول متاح لهذه المنصة؛ تعذّر ترتيب أنواع المحتوى.');
  }

  // مواضيع التعليقات ونواياها عند توفّر تعليقات فعلية فقط.
  const comments = input.comments || [];
  const intentBreakdown: Partial<Record<CommentIntent, number>> = {};
  const topicCounts = new Map<string, number>();
  if (comments.length) {
    for (const c of comments) {
      const cls: ClassifiedComment = classifyComment(c.text || '');
      intentBreakdown[cls.intent] = (intentBreakdown[cls.intent] || 0) + 1;
      if (cls.topic && cls.topic !== 'general' && (cls.isQuestion || cls.isBusinessInquiry)) {
        topicCounts.set(cls.topic, (topicCounts.get(cls.topic) || 0) + 1);
      }
    }
    const topIntent = (Object.entries(intentBreakdown) as Array<[CommentIntent, number]>).sort((a, b) => b[1] - a[1])[0];
    if (topIntent) {
      observations.push({
        observation: `أكثر نية تكراراً في التعليقات: ${topIntent[0]} (${topIntent[1]} من ${comments.length}).`,
        basis: 'تصنيف حتمي لنصوص التعليقات الفعلية.',
        sampleSize: comments.length,
        confidence: comments.length >= 3 ? 'medium' : 'low',
      });
    }
  } else {
    limitations.push('لا تعليقات مقروءة لهذه المنصة عبر واجهتها الرسمية؛ لا يُدَّعى تحليل نوايا.');
  }

  const frequentTopics = [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).map(([topic, count]) => ({ topic, count }));

  return {
    platform: input.platform,
    observations,
    frequentTopics,
    intentBreakdown,
    demographicsAvailable: false,
    note: 'التحليل من مؤشرات ونصوص فعلية فقط. لا تُستنتج سمات شخصية حساسة (عمر/جنس/هوية/موقع).',
    limitations: [...limitations, 'لا تتوفر بيانات سكانية عبر الواجهات الرسمية في نطاق هذا النظام؛ لا تُخترع.'],
  };
}

/**
 * تحليل جمهور عام عبر كل المنصات المتصلة: يعلن لكل منصة ما توفّره فعلاً من
 * تعليقات، ويجمع موضوعات الاستفسار الشائعة بلا أي سمة شخصية.
 */
export function analyzeCrossPlatformAudience(input: {
  platforms: PlatformId[];
  records: PlatformMetricRecord[];
  commentsByPlatform?: Partial<Record<PlatformId, Array<{ text: string; authorName?: string }>>>;
}): AudienceAnalysis {
  const perPlatform = input.platforms.map((p) => analyzePlatformAudience({
    platform: p,
    records: input.records,
    comments: input.commentsByPlatform?.[p],
  }));
  const allComments = Object.values(input.commentsByPlatform || {}).flat().filter(Boolean) as Array<{ text: string }>;
  const topicCounts = new Map<string, number>();
  for (const c of allComments) {
    const cls = classifyComment(c.text || '');
    if (cls.topic && cls.topic !== 'general' && (cls.isQuestion || cls.isBusinessInquiry)) {
      topicCounts.set(cls.topic, (topicCounts.get(cls.topic) || 0) + 1);
    }
  }
  const observations: AudienceObservation[] = perPlatform.flatMap((a) => a.observations);
  return {
    platform: 'cross_platform',
    observations,
    frequentTopics: [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).map(([topic, count]) => ({ topic, count })),
    intentBreakdown: {},
    demographicsAvailable: false,
    note: 'تحليل جمهور عام من بيانات فعلية عبر المنصات المتصلة فقط.',
    limitations: ['المنصات التي لا توفّر تعليقات عبر API لا تُدَّعى نتائج جمهور لها. لا سمات شخصية حساسة.'],
  };
}
