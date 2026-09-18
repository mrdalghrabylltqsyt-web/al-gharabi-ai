/**
 * العقل التسويقي والذاكرة التشغيلية.
 *
 * العقل ليس Prompt ثابتاً: هو قرارات مبنية على بيانات حقيقية متاحة في النظام
 * (المنتجات، الأصول، الاتصال، الأداء المسجل). كل توصية تحمل سبباً صريحاً، وإن
 * كانت البيانات غير كافية تُعلن الحاجة لبيانات إضافية بدل اختلاق نتيجة.
 *
 * الذاكرة تشغيلية للسوشيال ميديا فقط، ومصدرها سجلات النظام الحقيقية.
 */

import type { PlatformId } from './adapter';
import { metricAvailability } from './publishing';

export interface AudienceProfile {
  /** شرائح الجمهور المعروفة من بيانات المعرض الحقيقية. */
  segments: string[];
  /** هل بيانات الجمهور كافية للاستنتاج؟ */
  dataAvailable: boolean;
  note: string;
}

export interface ContentPlanItem {
  platform: PlatformId;
  contentType: string;
  format: string;
  suggestedTiming: string;
  timingConfidence: 'estimated' | 'measured';
  reason: string;
  successMetric: string;
  metricAvailable: boolean;
}

export interface MarketingDecision {
  audience: AudienceProfile;
  objective: string;
  plan: ContentPlanItem[];
  /** ما تعلمناه من السجلات السابقة فعلياً. */
  learnings: string[];
  /** ما الذي يجب تغييره في المنشور القادم. */
  nextAdjustment: string;
  /** بيانات ناقصة تمنع توصية أدق. */
  dataGaps: string[];
}

export interface PerformanceRecord {
  platform: PlatformId;
  contentType?: string;
  values: Record<string, number>;
  at: string;
}

export interface OperationalMemorySnapshot {
  publishedCount: number;
  scheduledCount: number;
  platformBreakdown: Record<string, number>;
  contentTypeBreakdown: Record<string, number>;
  topComments: string[];
  frequentQuestions: string[];
  decisions: Array<{ decision: string; at: string; reason: string }>;
  strategiesTested: Array<{ strategy: string; outcome: string; at: string }>;
}

/** شرائح الجمهور المعروفة لنشاط معرض الغرابي — من نشاط المعرض الفعلي. */
const KNOWN_SEGMENTS = ['الموظفون', 'المتقاعدون', 'حاملو بطاقة الماستر كارد', 'الأسر حديثة التكوين'];

export function analyzeAudience(performance: PerformanceRecord[]): AudienceProfile {
  const hasMeasuredData = performance.some((p) => Object.keys(p.values || {}).length > 0);
  return {
    segments: KNOWN_SEGMENTS,
    dataAvailable: hasMeasuredData,
    note: hasMeasuredData
      ? 'الشرائح معروفة من نشاط المعرض، وتوجد بيانات أداء فعلية لتحسين الاستهداف.'
      : 'الشرائح معروفة من نشاط المعرض، لكن لا توجد بيانات أداء فعلية بعد لقياس تفاعل كل شريحة.',
  };
}

interface PlatformPlanHint {
  contentType: string;
  format: string;
  timing: string;
  successMetric: string;
}

/** تلميحات الصيغة لكل منصة، مبنية على طبيعة كل واجهة. */
const PLATFORM_PLAN_HINTS: Record<PlatformId, PlatformPlanHint> = {
  tiktok: { contentType: 'فيديو قصير', format: 'سكربت 20-30 ثانية بهوك أول', timing: 'مساءً', successMetric: 'views' },
  youtube: { contentType: 'فيديو توضيحي', format: 'عنوان ووصف وفواصل زمنية', timing: 'مساءً', successMetric: 'views' },
  facebook: { contentType: 'منشور تفصيلي', format: 'نص مع تفاصيل العرض', timing: 'ظهراً ومساءً', successMetric: 'reach' },
  instagram: { contentType: 'منشور بصري', format: 'صورة/ريلز مع فواصل أنيقة', timing: 'مساءً', successMetric: 'reach' },
  whatsapp: { contentType: 'رسالة مباشرة', format: 'رسالة برودكاست منظمة', timing: 'صباحاً', successMetric: 'views' },
  telegram: { contentType: 'منشور قناة', format: 'نص منظم بنقاط', timing: 'مساءً', successMetric: 'views' },
  x: { contentType: 'تغريدة/ثريد', format: 'نص مختصر 280 محرفاً', timing: 'مساءً', successMetric: 'views' },
  snapchat: { contentType: 'ستوري', format: '3 لقطات متتالية', timing: 'مساءً', successMetric: 'views' },
  threads: { contentType: 'منشور قصير', format: 'نص محادثي مختصر', timing: 'مساءً', successMetric: 'views' },
  google_business: { contentType: 'تحديث محلي', format: 'تحديث مع الموقع وساعات العمل', timing: 'صباحاً', successMetric: 'views' },
};

/**
 * يبني قراراً تسويقياً كاملاً.
 * `connectedPlatforms` تأتي من حالة الاتصال الحقيقية؛ المنصات غير المتصلة
 * تُخطَّط لها كتابةً فقط، مع تنبيه صريح أن النشر يحتاج اتصالاً.
 */
export function buildMarketingDecision(input: {
  objective: string;
  platforms: PlatformId[];
  performance: PerformanceRecord[];
  memory: OperationalMemorySnapshot;
}): MarketingDecision {
  const audience = analyzeAudience(input.performance);
  const dataGaps: string[] = [];
  const learnings: string[] = [];

  if (!audience.dataAvailable) dataGaps.push('لا توجد مؤشرات أداء فعلية من المنصات؛ التوصيات مبنية على خصائص الصيغة لا على قياس.');
  if (!input.performance.length) dataGaps.push('لا يوجد سجل أداء سابق لمقارنة المنشورات.');

  // تعلّم فعلي من السجلات المتاحة فقط.
  const measured = input.performance.filter((p) => Object.keys(p.values || {}).length > 0);
  if (measured.length) {
    const byPlatform = new Map<string, number>();
    for (const record of measured) {
      const score = (record.values.views || 0) + (record.values.likes || 0) * 2;
      byPlatform.set(record.platform, (byPlatform.get(record.platform) || 0) + score);
    }
    const best = [...byPlatform.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > 0) learnings.push(`أعلى تفاعل مسجل حتى الآن على منصة ${best[0]} وفق بيانات الأداء المتوفرة.`);
  } else {
    learnings.push('لم تُسجَّل أي مؤشرات أداء بعد؛ لا يمكن الجزم بأفضل منصة أو أفضل وقت بشكل موثوق.');
  }

  if (input.memory.frequentQuestions.length) {
    learnings.push(`الأسئلة الأكثر تكراراً من الجمهور: ${input.memory.frequentQuestions.slice(0, 3).join(' | ')}.`);
  }

  const plan: ContentPlanItem[] = input.platforms.map((platform) => {
    const hint = PLATFORM_PLAN_HINTS[platform];
    const availability = metricAvailability(platform);
    const metricAvailable = availability.some((m) => m.metric === hint.successMetric && m.available);
    return {
      platform,
      contentType: hint.contentType,
      format: hint.format,
      suggestedTiming: hint.timing,
      // لا يُقدَّم وقت "مقاس" إلا عند وجود بيانات أداء فعلية.
      timingConfidence: measured.length ? 'measured' : 'estimated',
      reason: measured.length
        ? 'الصيغة مختارة حسب طبيعة المنصة، والتوقيت مدعوم ببيانات أداء مسجلة.'
        : 'الصيغة مختارة حسب طبيعة المنصة؛ التوقيت تقديري حتى تتوفر بيانات أداء فعلية.',
      successMetric: hint.successMetric,
      metricAvailable,
    };
  });

  const nextAdjustment = measured.length
    ? 'قارن أداء المنشور القادم بأفضل منشور مسجل، وعدّل الصيغة نحو ما حقق أعلى وصول فعلي.'
    : 'ابدأ باختبار صيغتين مختلفتين على نفس المنصة، ثم سجّل النتائج لبناء قياس حقيقي قبل أي تعديل استراتيجي.';

  return {
    audience,
    objective: input.objective,
    plan,
    learnings,
    nextAdjustment,
    dataGaps,
  };
}

/** يستخرج ذاكرة تشغيلية من السجلات الحقيقية. */
export function buildMemorySnapshot(input: {
  posts: Array<{ status?: string; targetPlatforms?: string[]; tags?: string[]; campaignName?: string; metrics?: Record<string, unknown> }>;
  comments: Array<{ text: string; intent?: string }>;
  decisions: Array<{ decision: string; at: string; reason: string }>;
  strategies: Array<{ strategy: string; outcome: string; at: string }>;
}): OperationalMemorySnapshot {
  const platformBreakdown: Record<string, number> = {};
  const contentTypeBreakdown: Record<string, number> = {};
  let publishedCount = 0;
  let scheduledCount = 0;

  for (const post of input.posts) {
    if (post.status === 'published') publishedCount += 1;
    if (post.status === 'scheduled') scheduledCount += 1;
    for (const platform of post.targetPlatforms || []) {
      platformBreakdown[platform] = (platformBreakdown[platform] || 0) + 1;
    }
    for (const tag of post.tags || []) {
      contentTypeBreakdown[tag] = (contentTypeBreakdown[tag] || 0) + 1;
    }
  }

  const frequentQuestions = input.comments
    .filter((c) => c.intent === 'question' || c.intent === 'business_inquiry')
    .map((c) => c.text.replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 10);

  return {
    publishedCount,
    scheduledCount,
    platformBreakdown,
    contentTypeBreakdown,
    topComments: input.comments.map((c) => c.text.slice(0, 80)).slice(0, 10),
    frequentQuestions: [...new Set(frequentQuestions)],
    decisions: input.decisions.slice(0, 50),
    strategiesTested: input.strategies.slice(0, 50),
  };
}
