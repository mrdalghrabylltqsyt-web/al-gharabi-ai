/**
 * Content Recommendation Engine — توصيات محتوى عامة لكل المنصات.
 *
 * كل توصية هنا قابلة للتفسير: تحمل سبباً ومصدراً وحجم عيّنة وحدوداً وحالة صريحة
 * (`supported` أو `insufficient_sample`). لا يُدَّعى «خوارزمية» ولا ضمان وصول،
 * ولا تُقدَّم توصية قوية إذا لم تكفِ العيّنة. التوصيات لا تنفّذ نشراً — هي توجيه
 * يخضع لبوابات الصلاحيات الحالية.
 */

import type { PlatformId } from './adapter';
import { metricAvailability } from './publishing';
import { suggestScheduleTime } from './contentPipeline';
import { PLATFORM_MIN_SAMPLE_FOR_INSIGHT, type PlatformMetricRecord } from './platformLearning';

export type RecommendationStatus = 'supported' | 'insufficient_sample';

export interface ExplainableRecommendation {
  kind: 'publish_time' | 'content_type' | 'product_focus' | 'hashtag' | 'cta' | 'platform_focus' | 'repeat_content';
  recommendation: string;
  reason: string;
  evidence: string;
  source: string;
  sampleSize: number;
  confidence: 'low' | 'medium';
  status: RecommendationStatus;
  limitations: string;
}

export interface RecommendationBundle {
  sampleSize: number;
  sufficientSample: boolean;
  recommendations: ExplainableRecommendation[];
  /** أسئلة تحتاج بيانات إضافية بدل التخمين. */
  dataGaps: string[];
  note: string;
}

const LIMIT_NOTE = 'توصية مبنية على بيانات فعلية؛ لا تضمن وصولاً أو مشاهدات.';

function withValues(records: PlatformMetricRecord[], metric: string): PlatformMetricRecord[] {
  return records.filter((r) => typeof r.values?.[metric] === 'number' && Number.isFinite(r.values[metric]));
}

/**
 * يوصي بوقت نشر لمنصة من أوقات تفاعل حقيقية فقط. عند نقص العيّنة يُعلن ذلك صراحةً
 * (status=insufficient_sample) بدل اختراع «أفضل وقت».
 */
export function recommendPublishTime(input: {
  platform: PlatformId;
  /** أوقات تفاعل/نشر حقيقية (ISO). */
  engagementTimestamps: Array<string | null | undefined>;
  minSample?: number;
}): ExplainableRecommendation {
  const suggestion = suggestScheduleTime({ engagementTimestamps: input.engagementTimestamps, minSample: input.minSample });
  const source = `${input.platform} — أوقات تفاعل حقيقية مسجّلة.`;
  if (suggestion.sampleInsufficient) {
    return {
      kind: 'publish_time',
      recommendation: 'لم يُقترح وقت: العيّنة غير كافية. اختر وقتاً صريحاً أو اجمع تفاعلاً أكثر.',
      reason: suggestion.note,
      evidence: `عدد الأوقات الصالحة: ${suggestion.sampleSize}.`,
      source,
      sampleSize: suggestion.sampleSize,
      confidence: 'low',
      status: 'insufficient_sample',
      limitations: 'لا «أفضل وقت» بلا عيّنة كافية.',
    };
  }
  return {
    kind: 'publish_time',
    recommendation: `وقت مقترح: ${suggestion.suggestedAt} (بغداد).`,
    reason: suggestion.note,
    evidence: `ساعة الذروة ${suggestion.peakHour}:00 من ${suggestion.sampleSize} تفاعلاً فعلياً.`,
    source,
    sampleSize: suggestion.sampleSize,
    confidence: suggestion.sampleSize >= (input.minSample ?? 8) * 2 ? 'medium' : 'low',
    status: 'supported',
    limitations: LIMIT_NOTE,
  };
}

/**
 * يوصي بنوع المحتوى/الفئة الأعلى أداءً لمنصة، من مفاتيح may be views/reach متاحة
 * فعلاً فقط. عند غياب مؤشر مناسب أو عيّنة كافية يُعلن ذلك.
 */
export function recommendContentFocus(input: {
  platform: PlatformId;
  records: PlatformMetricRecord[];
}): ExplainableRecommendation {
  const availability = metricAvailability(input.platform);
  const primary = availability.find((a) => a.available && (a.metric === 'views' || a.metric === 'reach'))?.metric || null;
  const source = `${input.platform} — ${primary ? `مؤشر ${primary}` : 'لا مؤشر مشاهدة/وصول متاح'}.`;
  if (!primary) {
    return {
      kind: 'content_type',
      recommendation: 'لا توصية بنوع محتوى: المنصة لا توفّر مؤشر مشاهدة/وصول عبر واجهتها الرسمية.',
      reason: 'جميع مؤشرات المشاهدة/الوصول NOT_SUPPORTED لهذه المنصة.',
      evidence: availability.filter((a) => !a.available).map((a) => a.metric).join(', '),
      source, sampleSize: 0, confidence: 'low', status: 'insufficient_sample',
      limitations: 'لا تُخترع قيمة بديلة لمؤشر غير متاح.',
    };
  }
  const scored = withValues(input.records, primary).filter((r) => r.platform === input.platform);
  if (scored.length < PLATFORM_MIN_SAMPLE_FOR_INSIGHT) {
    return {
      kind: 'content_type',
      recommendation: 'لا توصية بنوع محتوى: العيّنة غير كافية.',
      reason: `عدد العناصر المقيسة ${scored.length} أقل من الحد ${PLATFORM_MIN_SAMPLE_FOR_INSIGHT}.`,
      evidence: `عيّنة ${scored.length}.`, source, sampleSize: scored.length, confidence: 'low',
      status: 'insufficient_sample', limitations: 'اجمع نتائج فعلية قبل تعديل الصيغة.',
    };
  }
  const byKey = new Map<string, { sum: number; count: number }>();
  for (const r of scored) {
    const key = (r.contentType || r.productCategory || '').trim();
    if (!key) continue;
    const cur = byKey.get(key) || { sum: 0, count: 0 };
    cur.sum += Number(r.values[primary]);
    cur.count += 1;
    byKey.set(key, cur);
  }
  const ranked = [...byKey.entries()].filter(([, s]) => s.count > 0).sort((a, b) => (b[1].sum / b[1].count) - (a[1].sum / a[1].count));
  if (!ranked.length) {
    return {
      kind: 'content_type',
      recommendation: 'لا توصية بنوع محتوى: لا توجد بيانات تصنيف مرتبطة بالمؤشر.',
      reason: 'السجلات المقيّسة لا تحمل نوع محتوى/فئة.',
      evidence: `عيّنة ${scored.length}.`, source, sampleSize: scored.length, confidence: 'low',
      status: 'insufficient_sample', limitations: LIMIT_NOTE,
    };
  }
  const [best, stats] = ranked[0];
  return {
    kind: 'content_type',
    recommendation: `ركّز على نوع/فئة «${best}» (أعلى متوسط ${primary} ≈ ${Math.round(stats.sum / stats.count)}).`,
    reason: `من ${stats.count} عنصراً في هذه الفئة بمؤشر ${primary} حقيقي.`,
    evidence: `متوسط ${primary} لكل فئة.`,
    source, sampleSize: scored.length,
    confidence: stats.count >= PLATFORM_MIN_SAMPLE_FOR_INSIGHT ? 'medium' : 'low',
    status: 'supported', limitations: LIMIT_NOTE,
  };
}

/**
 * يوصي بتكرار نوع محتوى ثبت أداؤه (أو بتغييره). لا ادعاء خوارزمية — نمط ملاحظ
 * فقط من العيّنة.
 */
export function recommendRepeatOrChange(input: {
  platform: PlatformId;
  records: PlatformMetricRecord[];
  previousRecords?: PlatformMetricRecord[];
}): ExplainableRecommendation {
  const availability = metricAvailability(input.platform);
  const primary = availability.find((a) => a.available && (a.metric === 'views' || a.metric === 'reach'))?.metric || null;
  const source = `${input.platform} — مقارنة فترتين من بيانات فعلية.`;
  if (!primary) {
    return {
      kind: 'repeat_content',
      recommendation: 'لا توصية بالتكرار/التغيير: لا مؤشر مشاهدة/وصول متاح.',
      reason: 'مؤشرات المشاهدة/الوصول غير متاحة عبر الواجهة الرسمية.',
      evidence: 'NOT_SUPPORTED.', source, sampleSize: 0, confidence: 'low', status: 'insufficient_sample',
      limitations: LIMIT_NOTE,
    };
  }
  const avg = (list: PlatformMetricRecord[]): number | null => {
    const vals = list.filter((r) => r.platform === input.platform).map((r) => Number(r.values[primary])).filter(Number.isFinite);
    return vals.length ? vals.reduce((s, n) => s + n, 0) / vals.length : null;
  };
  const cur = avg(input.records);
  const prev = avg(input.previousRecords || []);
  const n = input.records.filter((r) => r.platform === input.platform).length;
  if (cur === null || prev === null || n < PLATFORM_MIN_SAMPLE_FOR_INSIGHT) {
    return {
      kind: 'repeat_content',
      recommendation: 'لا توصية بالتكرار/التغيير: العيّنة غير كافية.',
      reason: `عيّنة حالية ${n} (الحد ${PLATFORM_MIN_SAMPLE_FOR_INSIGHT}).`,
      evidence: 'عيّنة ناقصة.', source, sampleSize: n, confidence: 'low', status: 'insufficient_sample',
      limitations: LIMIT_NOTE,
    };
  }
  const delta = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;
  return {
    kind: 'repeat_content',
    recommendation: delta >= 0
      ? 'استمر على النمط الحالي؛ أداء الفترة الأخيرة ليس أدنى من السابقة.'
      : 'غيّر النمط؛ أداء الفترة الأخيرة أدنى من السابقة.',
    reason: `تغيّر متوسط ${primary} بنحو ${delta}%.`,
    evidence: `حالي ≈ ${Math.round(cur)} مقابل سابق ≈ ${Math.round(prev)}.`,
    source, sampleSize: n, confidence: n >= PLATFORM_MIN_SAMPLE_FOR_INSIGHT * 2 ? 'medium' : 'low',
    status: 'supported', limitations: LIMIT_NOTE,
  };
}

/**
 * يوصي بالمنصة الأعلى أداءً لمؤشر متاح فعلاً على كل المنصات المتصلة. لا يجمع
 * أرقاماً غير متجانسة — يعلن أي منصة تفتقد المؤشر.
 */
export function recommendPlatformFocus(input: {
  records: PlatformMetricRecord[];
  platforms: PlatformId[];
}): ExplainableRecommendation {
  const primary = 'views';
  const perPlatform: Array<{ platform: PlatformId; avg: number; count: number }> = [];
  const missing: PlatformId[] = [];
  for (const p of input.platforms) {
    const availability = metricAvailability(p);
    const supported = availability.some((a) => a.metric === primary && a.available);
    if (!supported) { missing.push(p); continue; }
    const vals = input.records.filter((r) => r.platform === p).map((r) => Number(r.values[primary])).filter(Number.isFinite);
    if (vals.length) perPlatform.push({ platform: p, avg: vals.reduce((s, n) => s + n, 0) / vals.length, count: vals.length });
  }
  if (!perPlatform.length) {
    return {
      kind: 'platform_focus',
      recommendation: 'لا توصية بمنصة: لا توجد بيانات مشاهدة حقيقية كافية.',
      reason: missing.length ? `منصات بلا مؤشر views: ${missing.join(', ')}.` : 'لا سجلات مقيسة.',
      evidence: 'عيّنة فارغة.', source: 'كل المنصات — مؤشر views.', sampleSize: 0, confidence: 'low',
      status: 'insufficient_sample', limitations: LIMIT_NOTE,
    };
  }
  perPlatform.sort((a, b) => b.avg - a.avg);
  const best = perPlatform[0];
  const totalSample = perPlatform.reduce((s, x) => s + x.count, 0);
  return {
    kind: 'platform_focus',
    recommendation: `المنصة الأعلى بمتوسط المشاهدات: ${best.platform} (≈ ${Math.round(best.avg)}).`,
    reason: missing.length
      ? `من ${perPlatform.length} منصة بمؤشر views فعلي؛ منصات بلا المؤشر أُعلنت: ${missing.join(', ')}.`
      : `من ${perPlatform.length} منصة بمؤشر views فعلي.`,
    evidence: 'مقارنة متوسط views بين المنصات المدعومة فقط.',
    source: 'كل المنصات — مؤشر views.',
    sampleSize: totalSample,
    confidence: best.count >= PLATFORM_MIN_SAMPLE_FOR_INSIGHT ? 'medium' : 'low',
    status: best.count >= PLATFORM_MIN_SAMPLE_FOR_INSIGHT ? 'supported' : 'insufficient_sample',
    limitations: 'المقارنة بمؤشر واحد متاح فقط؛ لا تعني أن المنصة الأفضل لكل الأهداف.',
  };
}

/**
 * يبني حزمة توصيات كاملة لهدف تسويقي: ماذا ننشر، أين، متى، وهل نكرّر. كل توصية
 * تحمل سببها ومصدرها وعيّنتها وحدودها. لا تنفيذ نشر.
 */
export function buildRecommendationBundle(input: {
  platforms: PlatformId[];
  records: PlatformMetricRecord[];
  previousRecords?: PlatformMetricRecord[];
  engagementTimestamps?: Array<string | null | undefined>;
}): RecommendationBundle {
  const recommendations: ExplainableRecommendation[] = [];
  const dataGaps: string[] = [];

  if (input.platforms.length) {
    recommendations.push(recommendPlatformFocus({ records: input.records, platforms: input.platforms }));
    for (const p of input.platforms) {
      recommendations.push(recommendContentFocus({ platform: p, records: input.records }));
    }
    recommendations.push(recommendRepeatOrChange({ platform: input.platforms[0], records: input.records, previousRecords: input.previousRecords }));
    if (input.engagementTimestamps) {
      recommendations.push(recommendPublishTime({ platform: input.platforms[0], engagementTimestamps: input.engagementTimestamps }));
    }
  }

  const sampleSize = input.records.length;
  const sufficientSample = sampleSize >= PLATFORM_MIN_SAMPLE_FOR_INSIGHT;
  if (!sufficientSample) dataGaps.push(`إجمالي سجلات الأداء (${sampleSize}) أقل من الحد الكافي (${PLATFORM_MIN_SAMPLE_FOR_INSIGHT}).`);
  const unsupported = new Set<string>();
  for (const p of input.platforms) {
    for (const a of metricAvailability(p)) if (!a.available) unsupported.add(a.metric);
  }
  if (unsupported.size) dataGaps.push(`مؤشرات غير متاحة عبر الواجهات الرسمية: ${[...unsupported].join(', ')} — لا تُخترع قيمتها.`);

  return {
    sampleSize,
    sufficientSample,
    recommendations,
    dataGaps,
    note: 'كل توصية قابلة للتفسير (سبب + مصدر + عيّنة + حدود). لا تضمن التوصيات وصولاً ولا مشاهدات، والتنفيذ يخضع لبوابات الصلاحيات.',
  };
}
