/**
 * Platform Learning Engine — حلقة التعلّم العامة لكل المنصات.
 *
 * الغرض: استقبال مؤشرات الأداء **الحقيقية** من أي منصة وتعلّم أنماط منها
 * (أوقات/أنواع محتوى/مواضيع/وسوم/CTA/تصنيف منتج) مع إعلان المصدر وحجم العيّنة
 * والحدود — بلا اختراع أي قيمة وبلا ادعاء «خوارزمية» أو ضمان وصول.
 *
 * القاعدة المركزية: أي مؤشر لا توفّره المنصة عبر واجهتها الرسمية يُعاد
 * `unavailable` مع السبب، ولا يُعوَّض بصفر ولا بتقدير. وهذه الطبقة هي نفسها لكل
 * المنصات (العشر والحالية والمستقبلية) لأنها تعمل على `PlatformId` وقدراتها.
 */

import type { PlatformId } from './adapter';
import { metricAvailability } from './publishing';

export interface PlatformMetricRecord {
  platform: PlatformId;
  /** معرّف المنشور لدى المنصة (لا يُخترع). */
  externalId: string;
  productCategory?: string | null;
  contentType?: string | null;
  title?: string | null;
  hashtags?: string[];
  ctaType?: string | null;
  /** وقت النشر الفعلي (ISO) إن كان معروفاً. */
  publishedAt?: string | null;
  /** القيم المتاحة فعلاً فقط (مفتاحها أسماء المؤشرات القياسية). */
  values: Record<string, number>;
}

export interface PlatformLearningSample {
  platform: PlatformId;
  availableMetrics: Array<{ metric: string; available: boolean; reason?: string }>;
  unavailableMetrics: Array<{ metric: string; reason: string }>;
  sampleSize: number;
  sufficientSample: boolean;
  note: string;
}

export interface LearningInsight {
  statement: string;
  /** الدليل الرقمي الذي بُني عليه الاستنتاج. */
  evidence: string;
  source: string;
  sampleSize: number;
  confidence: 'low' | 'medium';
  limitations: string;
}

export interface Recommendation {
  kind: 'publish_time' | 'content_type' | 'product_focus' | 'hashtag' | 'cta' | 'platform_focus';
  recommendation: string;
  reason: string;
  sampleSize: number;
  source: string;
  confidence: 'low' | 'medium';
  /** الحالة الصريحة: توصية مدعومة ببيانات، أو عيّنة غير كافية. */
  status: 'supported' | 'insufficient_sample';
  limitations: string;
}

export const PLATFORM_MIN_SAMPLE_FOR_INSIGHT = 3;

/** المؤشرات القياسية عبر المنصات؛ التوفر يُقرأ من جدول قدرات كل منصة. */
export const LEARNING_METRIC_KEYS = Object.freeze(['views', 'likes', 'comments', 'shares', 'reach', 'saves'] as const);

/**
 * يبني عيّنة تعلّم لمنصة: يفصل المؤشرات المتاحة فعلاً عن غير المتاحة (مع السبب)
 * ويعلن كفاية العيّنة. لا يخترع قيمة لأي مؤشر غائب.
 */
export function buildLearningSample(platform: PlatformId, records: PlatformMetricRecord[]): PlatformLearningSample {
  const platformRecords = records.filter((r) => r.platform === platform);
  const availability = metricAvailability(platform);
  const available = availability.filter((a) => a.available);
  const unavailable = availability.filter((a) => !a.available).map((a) => ({ metric: a.metric, reason: a.reason || 'المؤشر غير متاح عبر الواجهة الرسمية لهذه المنصة.' }));
  // نحسب العيّنة من السجلات التي تحمل قيمة فعلية لواحد على الأقل من المؤشرات المتاحة.
  const withValues = platformRecords.filter((r) =>
    available.some((a) => typeof r.values?.[a.metric] === 'number' && Number.isFinite(r.values[a.metric])),
  );
  const sampleSize = withValues.length;
  return {
    platform,
    availableMetrics: availability,
    unavailableMetrics: unavailable,
    sampleSize,
    sufficientSample: sampleSize >= PLATFORM_MIN_SAMPLE_FOR_INSIGHT,
    note: sampleSize >= PLATFORM_MIN_SAMPLE_FOR_INSIGHT
      ? `عيّنة كافية (${sampleSize}) لاستنتاج أنماط محدودة على ${platform}.`
      : `عيّنة غير كافية (${sampleSize}/${PLATFORM_MIN_SAMPLE_FOR_INSIGHT}) على ${platform}؛ لا تُقدَّم توصية قوية.`,
  };
}

/** مقياس مركّب من المؤشرات المتاحة فقط (لا يعني «خوارزمية»؛ مجرد مجموع مرجّح شفّاف). */
function engagementScore(values: Record<string, number>, availableMetrics: Set<string>): number | null {
  const base = availableMetrics.has('reach') ? Number(values.reach) : availableMetrics.has('views') ? Number(values.views) : NaN;
  const interactions = ['likes', 'comments', 'shares', 'saves']
    .filter((m) => availableMetrics.has(m))
    .reduce((s, m) => s + (Number(values[m]) || 0), 0);
  if (!Number.isFinite(base) || base <= 0) return null;
  return interactions / base;
}

/**
 * يحلّل أنماط الأداء لمنصة من السجلات الحقيقية فقط، ويعيد أسئلة تحتاج بيانات
 * إضافية بدل التخمين. كل insight يحمل دليله ومصدره وحجم عيّنته وحدوده.
 */
export function analyzePlatformLearning(input: {
  platform: PlatformId;
  records: PlatformMetricRecord[];
  previousRecords?: PlatformMetricRecord[];
}): { sample: PlatformLearningSample; insights: LearningInsight[]; note: string } {
  const records = input.records.filter((r) => r.platform === input.platform);
  const previous = (input.previousRecords || []).filter((r) => r.platform === input.platform);
  const sample = buildLearningSample(input.platform, records);
  const availability = metricAvailability(input.platform);
  const availableSet = new Set(availability.filter((a) => a.available).map((a) => a.metric));
  const source = `${input.platform} API — مؤشرات متاحة فعلاً: ${[...availableSet].join('/') || 'لا شيء'}.`;
  const limitations = sample.sufficientSample
    ? 'الاستنتاج من بيانات المنصة الفعلية؛ لا يُثبت سببية ولا يضمن وصولاً.'
    : 'عيّنة صغيرة؛ مؤشر مبدئي لا حقيقة إحصائية.';
  const insights: LearningInsight[] = [];

  const scored = records
    .map((r) => ({ r, score: engagementScore(r.values, availableSet) }))
    .filter((x) => x.score !== null) as Array<{ r: PlatformMetricRecord; score: number }>;

  if (scored.length) {
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    insights.push({
      statement: `أعلى تفاعل نسبي على ${input.platform} سجّله «${best.r.title || best.r.externalId}» بمعدل ≈ ${Math.round(best.score * 10000) / 100}%.`,
      evidence: `مقارنة مؤشرات متاحة فعلاً على ${scored.length} عنصراً.`,
      source,
      sampleSize: scored.length,
      confidence: sample.sufficientSample ? 'medium' : 'low',
      limitations,
    });
  }

  // نمط التصنيف/نوع المحتوى: متوسط مشاهدات لكل فئة من الفئات ذات العيّنة.
  const byCategory = new Map<string, { sum: number; count: number }>();
  for (const r of records) {
    const key = (r.productCategory || r.contentType || '').trim();
    if (!key || !availableSet.has('views')) continue;
    const v = Number(r.values.views);
    if (!Number.isFinite(v)) continue;
    const cur = byCategory.get(key) || { sum: 0, count: 0 };
    cur.sum += v;
    cur.count += 1;
    byCategory.set(key, cur);
  }
  const ranked = [...byCategory.entries()].filter(([, s]) => s.count > 0).sort((a, b) => (b[1].sum / b[1].count) - (a[1].sum / a[1].count));
  if (ranked.length >= 2 && availableSet.has('views')) {
    const [bestCat, bestStats] = ranked[0];
    insights.push({
      statement: `الفئة «${bestCat}» تحقق أعلى متوسط مشاهدات (≈ ${Math.round(bestStats.sum / bestStats.count)}) بين الفئات المسجّلة على ${input.platform}.`,
      evidence: `متوسط views لكل فئة من ${records.length} سجلاً.`,
      source,
      sampleSize: records.length,
      confidence: bestStats.count >= PLATFORM_MIN_SAMPLE_FOR_INSIGHT ? 'medium' : 'low',
      limitations,
    });
  } else if (!availableSet.has('views')) {
    insights.push({
      statement: `لا يمكن تحليل أنواع المحتوى على ${input.platform}: مؤشر views غير متاح عبر واجهتها الرسمية.`,
      evidence: 'خرائط التوفر أعلنت NOT_SUPPORTED لـviews.',
      source,
      sampleSize: records.length,
      confidence: 'low',
      limitations: 'لا تُخترع قيمة بديلة لمؤشر غير متاح.',
    });
  }

  // مقارنة فترة حالية/سابقة بلا ادعاء سببية.
  const avgViews = (list: PlatformMetricRecord[]): number | null => {
    const vals = list.map((r) => Number(r.values.views)).filter((n) => Number.isFinite(n));
    if (!vals.length) return null;
    return Math.round(vals.reduce((s, n) => s + n, 0) / vals.length);
  };
  const cur = avgViews(records);
  const prev = avgViews(previous);
  if (cur !== null && prev !== null && prev > 0) {
    const delta = Math.round(((cur - prev) / prev) * 100);
    insights.push({
      statement: delta >= 0
        ? `متوسط المشاهدات على ${input.platform} أعلى بنحو ${delta}% من المجموعة السابقة.`
        : `متوسط المشاهدات على ${input.platform} أقل بنحو ${Math.abs(delta)}% من المجموعة السابقة.`,
      evidence: `متوسط حالي ≈ ${cur} مقابل سابق ≈ ${prev}.`,
      source,
      sampleSize: records.length + previous.length,
      confidence: records.length >= PLATFORM_MIN_SAMPLE_FOR_INSIGHT && previous.length >= PLATFORM_MIN_SAMPLE_FOR_INSIGHT ? 'medium' : 'low',
      limitations: 'مقارنة بين مجموعتين؛ لا تُعتبر دليلاً سببيّاً.',
    });
  }

  if (!insights.length) {
    insights.push({
      statement: `لا توجد بيانات أداء كافية لاستخراج درس موثوق على ${input.platform} بعد.`,
      evidence: `عدد السجلات المقيسة: ${records.length}.`,
      source,
      sampleSize: records.length,
      confidence: 'low',
      limitations: 'يجب جمع مؤشرات فعلية قبل أي استنتاج.',
    });
  }

  return {
    sample,
    insights,
    note: 'كل درس يحمل مصدره وحجم عيّنته وحدوده. لا تُعتبر أي نتيجة حقيقة إحصائية إذا لم تكفِ البيانات، ولا يُدَّعى أي ضمان وصول.',
  };
}

/**
 * ملخّص تعلّم عام عبر كل المنصات المتاحة: يبني عيّنة لكل منصة ويعيد ملاحظات
 * صادقة عن المؤشرات غير المتاحة. لا يجمع أرقاماً غير قابلة للمقارنة عبر المنصات.
 */
export function summarizeCrossPlatformLearning(records: PlatformMetricRecord[], platforms: PlatformId[]): {
  byPlatform: Array<PlatformLearningSample & { insights: number }>;
  unavailableByPlatform: Array<{ platform: PlatformId; metric: string; reason: string }>;
  note: string;
} {
  const byPlatform = platforms.map((p) => {
    const analysis = analyzePlatformLearning({ platform: p, records });
    return { ...analysis.sample, insights: analysis.insights.length };
  });
  const unavailableByPlatform = byPlatform.flatMap((s) =>
    s.unavailableMetrics.map((u) => ({ platform: s.platform, metric: u.metric, reason: u.reason })),
  );
  return {
    byPlatform,
    unavailableByPlatform,
    note: 'المؤشرات غير المتاحة مُعلنة صراحةً لكل منصة بلا اختراع قيمة؛ والمنصات لا تُقارَن بمقاييس غير متجانسة.',
  };
}
