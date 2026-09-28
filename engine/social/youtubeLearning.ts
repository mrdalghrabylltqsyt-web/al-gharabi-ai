/**
 * حلقة التعلّم والذاكرة التشغيلية لـYouTube — منطق خالص قابل للاختبار.
 *
 * سبب الوجود: العقل المركزي يجب أن يتعلّم من أداء القناة الفعلي، لا أن يخترع
 * استنتاجات. هنا تُبنى مؤشرات القناة والتحليلات الجماهيرية (من المؤشرات المتاحة
 * فعلاً فقط) وحلقة تعلّم تُعلن مصدر كل insight وحجم العيّنة والنطاق الزمني وحدود
 * الثقة — فلا تُعتبر نتيجة «حقيقة إحصائية» إذا لم تكفِ البيانات.
 *
 * لا بيانات سكانية مُختلقة: YouTube Data API لا يوفّر العمر/الجنس/الموقع، فلا
 * تُخترع، ويُستخدم بدلاً منها ما هو متاح فعلاً (مشاهدات/إعجابات/تعليقات/تفاعل/
 * توقيت/مواضيع/رد الجمهور).
 */

export interface YouTubeVideoMetricRecord {
  videoId: string;
  title: string | null;
  publishedAt: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  /** وسوم/موضوع تقديري مستخرج من العنوان عند غياب الوسوم (لا اختراع). */
  topic?: string | null;
  at: string;
}

export interface YouTubeAnalyticsSummary {
  /** إجمالي المشاهدات الفعلية (مجموع ما أعاده YouTube فقط). */
  totalViews: number | null;
  totalLikes: number | null;
  totalComments: number | null;
  videoCount: number;
  /** متوسط التفاعل لكل فيديو (null إن غابت المؤشرات). */
  avgEngagementPerVideo: number | null;
  /** نسبة التفاعل (إعجابات+تعليقات)/مشاهدات — null إن غابت المشاهدات. */
  engagementRate: number | null;
  /** مؤشرات غير متاحة صراحةً مع السبب (بلا اختراع قيمة). */
  unavailable: Array<{ metric: string; reason: string }>;
  /** هل البيانات كافية لاستنتاج إحصائي موثوق؟ */
  sufficientSample: boolean;
  sampleSize: number;
  /** مصدر كل رقم — يجب أن يظهر دائماً. */
  source: string;
  timeRange: { from: string | null; to: string | null };
}

/** مؤشرات YouTube Data API المتاحة فعلاً (بلا Analytics API). */
export const YOUTUBE_ANALYTICS_AVAILABLE_METRICS: readonly string[] = Object.freeze(['views', 'likes', 'comments']);
/** مؤشرات تتطلب YouTube Analytics API ولم تُطلب — تُعلن غير متاحة صراحةً. */
export const YOUTUBE_ANALYTICS_UNAVAILABLE_METRICS: ReadonlyArray<{ metric: string; reason: string }> = Object.freeze([
  { metric: 'impressions', reason: 'يتطلب YouTube Analytics API (لم يُطلب).' },
  { metric: 'watch_time_minutes', reason: 'يتطلب YouTube Analytics API (لم يُطلب).' },
  { metric: 'average_view_duration', reason: 'يتطلب YouTube Analytics API (لم يُطلب).' },
  { metric: 'subscribers_gained', reason: 'يتطلب YouTube Analytics API (لم يُطلب).' },
  { metric: 'audience_age_gender', reason: 'بيانات سكانية؛ تتطلب YouTube Analytics API ولم تُطلب — لا تُخترع.' },
  { metric: 'audience_geography', reason: 'بيانات سكانية/جغرافية؛ تتطلب YouTube Analytics API ولم تُطلب — لا تُخترع.' },
]);

/** الحد الأدنى لحجم عيّنة يُعتبر كافياً لاستنتاج إحصائي محدود. */
export const YOUTUBE_MIN_SAMPLE_FOR_INSIGHT = 3;

/** يجمع إحصاءات القناة من سجلات الفيديو الفعلية بلا اختراع قيم. */
export function summarizeChannelAnalytics(records: YouTubeVideoMetricRecord[]): YouTubeAnalyticsSummary {
  const withViews = records.filter((r) => typeof r.viewCount === 'number');
  const withLikes = records.filter((r) => typeof r.likeCount === 'number');
  const withComments = records.filter((r) => typeof r.commentCount === 'number');
  const totalViews = withViews.length ? withViews.reduce((s, r) => s + (r.viewCount || 0), 0) : null;
  const totalLikes = withLikes.length ? withLikes.reduce((s, r) => s + (r.likeCount || 0), 0) : null;
  const totalComments = withComments.length ? withComments.reduce((s, r) => s + (r.commentCount || 0), 0) : null;
  const interactions = (totalLikes || 0) + (totalComments || 0);
  const engagementRate = totalViews && totalViews > 0 ? Math.round((interactions / totalViews) * 10000) / 100 : null;
  const avgEngagementPerVideo = records.length && (totalLikes !== null || totalComments !== null)
    ? Math.round((interactions / records.length) * 100) / 100
    : null;
  const dates = records.map((r) => r.publishedAt || r.at).filter(Boolean).sort();
  return {
    totalViews,
    totalLikes,
    totalComments,
    videoCount: records.length,
    avgEngagementPerVideo,
    engagementRate,
    unavailable: YOUTUBE_ANALYTICS_UNAVAILABLE_METRICS.map((m) => ({ ...m })),
    sufficientSample: records.length >= YOUTUBE_MIN_SAMPLE_FOR_INSIGHT,
    sampleSize: records.length,
    source: 'YouTube Data API v3 (videos.list part=statistics) — قيم مُعادة من Google فقط.',
    timeRange: { from: dates[0] || null, to: dates[dates.length - 1] || null },
  };
}

export interface AudienceInsight {
  insight: string;
  /** المؤشر الذي بُني عليه الاستنتاج. */
  basis: string;
  /** حجم العيّنة. */
  sampleSize: number;
  timeRange: { from: string | null; to: string | null };
  confidence: 'low' | 'medium';
  limitations: string;
}

/**
 * تحليل جمهور اعتماداً على المؤشرات المتاحة فعلاً فقط (مشاهدات/إعجابات/تعليقات/
 * تفاعل/توقيت/مواضيع/رد الجمهور). لا بيانات سكانية مُختلقة — تُعلن صراحةً.
 */
export function analyzeYouTubeAudience(records: YouTubeVideoMetricRecord[], summary?: YouTubeAnalyticsSummary): { insights: AudienceInsight[]; note: string; demographicsAvailable: false } {
  const sum = summary || summarizeChannelAnalytics(records);
  const insights: AudienceInsight[] = [];
  const timeRange = sum.timeRange;
  const limitations = sum.sufficientSample
    ? 'استنتاج من بيانات القناة الفعلية؛ لا تتوفر بيانات سكانية (عمر/جنس/موقع) عبر Data API.'
    : 'عيّنة صغيرة؛ الاستنتاج مؤشر مبدئي لا حقيقة إحصائية.';

  if (sum.engagementRate !== null) {
    insights.push({
      insight: `نسبة التفاعل الإجمالية للقناة ≈ ${sum.engagementRate}% (إعجابات + تعليقات ÷ مشاهدات).`,
      basis: 'views/likes/comments من videos.list',
      sampleSize: sum.sampleSize,
      timeRange,
      confidence: sum.sufficientSample ? 'medium' : 'low',
      limitations,
    });
  }

  const withEngagement = records
    .filter((r) => typeof r.viewCount === 'number' && r.viewCount > 0)
    .map((r) => ({ r, rate: (((r.likeCount || 0) + (r.commentCount || 0)) / (r.viewCount || 1)) * 100 }))
    .sort((a, b) => b.rate - a.rate);
  if (withEngagement.length && withEngagement[0].rate > 0) {
    insights.push({
      insight: `أعلى تفاعل نسبي سجّلته القناة على الفيديو «${withEngagement[0].r.title || withEngagement[0].r.videoId}» (≈ ${Math.round(withEngagement[0].rate * 100) / 100}%).`,
      basis: 'مقارنة (إعجابات+تعليقات)÷مشاهدات لكل فيديو',
      sampleSize: sum.sampleSize,
      timeRange,
      confidence: sum.sufficientSample ? 'medium' : 'low',
      limitations,
    });
  }

  const topics = new Map<string, { views: number; count: number }>();
  for (const r of records) {
    const topic = (r.topic || '').trim();
    if (!topic || typeof r.viewCount !== 'number') continue;
    const cur = topics.get(topic) || { views: 0, count: 0 };
    cur.views += r.viewCount;
    cur.count += 1;
    topics.set(topic, cur);
  }
  if (topics.size >= 2) {
    const ranked = [...topics.entries()].sort((a, b) => (b[1].views / b[1].count) - (a[1].views / a[1].count));
    const [bestTopic, bestStats] = ranked[0];
    insights.push({
      insight: `موضوع «${bestTopic}» يحقق أعلى متوسط مشاهدات (≈ ${Math.round(bestStats.views / bestStats.count)}) بين مواضيع القناة المسجّلة.`,
      basis: 'تصنيف بسيط حسب topic المستخرج من بيانات الفيديو',
      sampleSize: sum.sampleSize,
      timeRange,
      confidence: bestStats.count >= YOUTUBE_MIN_SAMPLE_FOR_INSIGHT ? 'medium' : 'low',
      limitations,
    });
  }

  return {
    insights,
    note: 'التحليل مبني على مؤشرات YouTube Data API المتاحة فعلاً فقط (مشاهدات/إعجابات/تعليقات/تفاعل/مواضيع). لا تُخترع بيانات سكانية (عمر/جنس/موقع) لأنها تتطلب YouTube Analytics API.',
    demographicsAvailable: false,
  };
}

export interface YouTubeLearningResult {
  insights: Array<{
    statement: string;
    evidence: string;
    source: string;
    sampleSize: number;
    timeRange: { from: string | null; to: string | null };
    confidence: 'low' | 'medium';
    limitations: string;
  }>;
  /** هل البيانات كافية لاعتبار الاستنتاج حقيقة إحصائية؟ */
  statisticallyValid: boolean;
  sampleSize: number;
  note: string;
}

/**
 * حلقة التعلّم: تقارن الأداء الحالي بالسابق وتستخرج دروساً قابلة للتطبيق، مع
 * إعلان المصدر وحجم العيّنة والحدود. لا تُعتبر النتيجة حقيقة إحصائية بلا عيّنة
 * كافية.
 */
export function buildYouTubeLearning(input: {
  records: YouTubeVideoMetricRecord[];
  previousRecords?: YouTubeVideoMetricRecord[];
}): YouTubeLearningResult {
  const records = input.records || [];
  const previous = input.previousRecords || [];
  const sum = summarizeChannelAnalytics(records);
  const insights: YouTubeLearningResult['insights'] = [];

  const avgViews = (list: YouTubeVideoMetricRecord[]): number | null => {
    const withViews = list.filter((r) => typeof r.viewCount === 'number');
    if (!withViews.length) return null;
    return Math.round(withViews.reduce((s, r) => s + (r.viewCount || 0), 0) / withViews.length);
  };

  const currentAvg = avgViews(records);
  const prevAvg = avgViews(previous);
  if (currentAvg !== null && prevAvg !== null && prevAvg > 0) {
    const delta = Math.round(((currentAvg - prevAvg) / prevAvg) * 100);
    insights.push({
      statement: delta >= 0
        ? `متوسط مشاهدات الفيديوهات الحديثة أعلى بنحو ${delta}% من المجموعة السابقة.`
        : `متوسط مشاهدات الفيديوهات الحديثة أقل بنحو ${Math.abs(delta)}% من المجموعة السابقة.`,
      evidence: `متوسط حالي ≈ ${currentAvg} مقابل سابق ≈ ${prevAvg}.`,
      source: 'YouTube Data API v3 — videos.list part=statistics',
      sampleSize: records.length + previous.length,
      timeRange: sum.timeRange,
      confidence: records.length >= YOUTUBE_MIN_SAMPLE_FOR_INSIGHT && previous.length >= YOUTUBE_MIN_SAMPLE_FOR_INSIGHT ? 'medium' : 'low',
      limitations: 'المقارنة بين مجموعتين فقط؛ لا تُعتبر دليلاً سببيّاً.',
    });
  }

  if (sum.engagementRate !== null) {
    insights.push({
      statement: `نسبة التفاعل الحالية ≈ ${sum.engagementRate}%؛ يُوصى بمراقبة اتجاهها مع كل فيديو جديد.`,
      evidence: `إعجابات ${sum.totalLikes ?? '—'} وتعليقات ${sum.totalComments ?? '—'} على ${sum.totalViews ?? '—'} مشاهدة.`,
      source: 'YouTube Data API v3 — videos.list part=statistics',
      sampleSize: sum.sampleSize,
      timeRange: sum.timeRange,
      confidence: sum.sufficientSample ? 'medium' : 'low',
      limitations: 'التفاعل يتأثر بعوامل خارجية غير مقيسة (وصول/توقيت/موضوع).',
    });
  }

  if (!insights.length) {
    insights.push({
      statement: 'لا توجد بيانات أداء كافية لاستخراج درس موثوق بعد.',
      evidence: `عدد الفيديوهات المقيسة: ${records.length}.`,
      source: 'YouTube Data API v3',
      sampleSize: records.length,
      timeRange: sum.timeRange,
      confidence: 'low',
      limitations: 'يجب جمع مؤشرات أداء فعلية لعدة فيديوهات قبل أي استنتاج.',
    });
  }

  return {
    insights,
    statisticallyValid: sum.sufficientSample,
    sampleSize: records.length,
    note: 'كل درس يحمل مصدره وحجم عيّنته ونطاقه الزمني وحدوده. لا تُعتبر أي نتيجة حقيقة إحصائية إذا لم تكفِ البيانات.',
  };
}
