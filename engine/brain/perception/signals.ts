/**
 * Perception Engine — طبقة الإدراك الموحّدة (منطق خالص قابل للاختبار).
 *
 * وظيفتها **جمع الإشارات الحقيقية فقط** من المنصات وتطبيعها، دون أي قرار أو
 * تفسير. القاعدة الملزمة: لا إشارة بلا مصدر (`source`)، ولا قيمة مُختلقة، وأي
 * مؤشر لا توفّره المنصة يُعلن `NOT_AVAILABLE` صراحةً بدل صفر مضلل.
 *
 * هذه الطبقة لا تعرف أي منصة بعينها: تعمل على `PlatformId` وعلى خريطة توفر
 * المؤشرات القائمة (`metricAvailability`)، فالمنصة رقم 11 تدخل بلا تعديل هنا.
 *
 * لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import type { PlatformId } from '../../social/adapter';
import { metricAvailability } from '../../social/publishing';

export type SignalKind = 'content' | 'audience' | 'conversation';

/** مستويات الصدق لكل إشارة: متاح فعلاً، جزئي، أم غير متاح عبر الواجهة الرسمية. */
export type SignalAvailability = 'AVAILABLE' | 'PARTIAL' | 'NOT_AVAILABLE';

/** سياسة الطزاجة: كل إشارة تحمل عمراً أقصى مقبولاً قبل اعتبارها قديمة. */
export interface FreshnessPolicy {
  /** أقصى عمر مقبول بالدقائق. 0 = بلا انتهاء (بيانات ثابتة مثل الميتاداتا). */
  maxAgeMinutes: number;
}

/** الإشارة الموحّدة. لا تُستخدم في أي قرار بلا `source`. */
export interface Signal {
  source: string;
  platform: PlatformId | 'cross_platform';
  collectedAt: string;
  metric: string;
  value: number | string | boolean | null;
  scope: string;
  sampleSize?: number;
  limitations?: string;
  confidence?: 'low' | 'medium' | 'high';
  availability: SignalAvailability;
  kind: SignalKind;
}

/** سياسات الطزاجة الافتراضية لكل نوع مؤشر (بلا سحب كل شيء كل دقيقة). */
export const DEFAULT_FRESHNESS: Record<string, FreshnessPolicy> = Object.freeze({
  views: { maxAgeMinutes: 180 },
  likes: { maxAgeMinutes: 180 },
  comments: { maxAgeMinutes: 60 },
  shares: { maxAgeMinutes: 180 },
  reach: { maxAgeMinutes: 180 },
  saves: { maxAgeMinutes: 180 },
  subscribers: { maxAgeMinutes: 360 },
  followers: { maxAgeMinutes: 360 },
  watch_time: { maxAgeMinutes: 720 },
  average_view_duration: { maxAgeMinutes: 720 },
  retention: { maxAgeMinutes: 720 },
  traffic_source: { maxAgeMinutes: 720 },
  search_terms: { maxAgeMinutes: 1440 },
  metadata: { maxAgeMinutes: 0 },
  published_at: { maxAgeMinutes: 0 },
  conversation: { maxAgeMinutes: 30 },
});

export function freshnessFor(metric: string): FreshnessPolicy {
  return DEFAULT_FRESHNESS[metric] || { maxAgeMinutes: 180 };
}

/** هل الإشارة طازجة بالنسبة لساعتها وسياستها؟ */
export function isFresh(signal: Pick<Signal, 'metric' | 'collectedAt'>, now: number): boolean {
  const policy = freshnessFor(signal.metric);
  if (policy.maxAgeMinutes === 0) return true;
  const at = Date.parse(signal.collectedAt);
  if (!Number.isFinite(at)) return false;
  return now - at <= policy.maxAgeMinutes * 60_000;
}

/**
 * وصف المؤشرات الإدراكية ومصدرها الرسمي. `metrics` أسماء مفاتيح قياسية، وتوفرها
 * الفعلي يُقرأ من خريطة المنصة لا من هذا الجدول.
 */
export interface SignalSpec {
  metric: string;
  kind: SignalKind;
  labelAr: string;
  sourceTemplate: string;
}

export const SIGNAL_SPECS: readonly SignalSpec[] = Object.freeze([
  { metric: 'views', kind: 'content', labelAr: 'مشاهدات', sourceTemplate: '{platform} API — عدد المشاهدات' },
  { metric: 'likes', kind: 'content', labelAr: 'إعجابات', sourceTemplate: '{platform} API — عدد الإعجابات' },
  { metric: 'comments', kind: 'content', labelAr: 'تعليقات', sourceTemplate: '{platform} API — عدد التعليقات' },
  { metric: 'shares', kind: 'content', labelAr: 'مشاركات', sourceTemplate: '{platform} API — عدد المشاركات' },
  { metric: 'reach', kind: 'audience', labelAr: 'وصول', sourceTemplate: '{platform} API — عدد الحسابات التي شاهدت' },
  { metric: 'saves', kind: 'content', labelAr: 'حفظ', sourceTemplate: '{platform} API — عدد الحفظ' },
  { metric: 'subscribers', kind: 'audience', labelAr: 'مشتركون', sourceTemplate: '{platform} API — عدد المشتركين' },
  { metric: 'followers', kind: 'audience', labelAr: 'متابعون', sourceTemplate: '{platform} API — عدد المتابعين' },
  { metric: 'watch_time', kind: 'content', labelAr: 'زمن المشاهدة', sourceTemplate: '{platform} Analytics — إجمالي زمن المشاهدة' },
  { metric: 'average_view_duration', kind: 'content', labelAr: 'متوسط مدة المشاهدة', sourceTemplate: '{platform} Analytics — متوسط مدة المشاهدة' },
  { metric: 'retention', kind: 'content', labelAr: 'الاحتفاظ', sourceTemplate: '{platform} Analytics — منحنى الاحتفاظ' },
  { metric: 'traffic_source', kind: 'audience', labelAr: 'مصدر الزيارات', sourceTemplate: '{platform} Analytics — أبعاد مصدر الزيارات' },
  { metric: 'search_terms', kind: 'audience', labelAr: 'كلمات البحث', sourceTemplate: '{platform} Analytics — كلمات البحث' },
  { metric: 'metadata', kind: 'content', labelAr: 'ميتاداتا المحتوى', sourceTemplate: '{platform} API — بيانات المحتوى الوصفية' },
  { metric: 'published_at', kind: 'content', labelAr: 'وقت النشر', sourceTemplate: '{platform} API — وقت النشر الفعلي' },
]);

export function signalSpec(metric: string): SignalSpec | null {
  return SIGNAL_SPECS.find((s) => s.metric === metric) || null;
}

/** يبني مصدراً موحّداً للمؤشر — لا إشارة بلا مصدر. */
export function sourceFor(platform: PlatformId, metric: string): string {
  const spec = signalSpec(metric);
  return spec ? spec.sourceTemplate.replace('{platform}', platform) : `${platform} API — ${metric}`;
}

export interface BuildContentSignalsInput {
  platform: PlatformId;
  collectedAt: string;
  /** القيم المتاحة فعلاً فقط (لا تُمرَّر قيم مُختلقة). */
  values: Record<string, number>;
  scope: string;
  sampleSize?: number;
}

/**
 * يبني إشارات المحتوى لمنصة: لكل مؤشر معروف يقرّر التوفر من خريطة المنصة، ثم
 * يُصدر إشارة `AVAILABLE` بقيمة حقيقية، أو `NOT_AVAILABLE` بلا قيمة عند غيابه —
 * فلا يُخترع صفر. المؤشرات المتاحة لكن غير المُمرَّرة تُعلن `PARTIAL`.
 */
export function buildContentSignals(input: BuildContentSignalsInput): Signal[] {
  const availability = metricAvailability(input.platform);
  const out: Signal[] = [];
  for (const a of availability) {
    const spec = signalSpec(a.metric);
    if (!spec || spec.kind !== 'content') continue;
    const raw = input.values?.[a.metric];
    const hasValue = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0;
    out.push({
      source: sourceFor(input.platform, a.metric),
      platform: input.platform,
      collectedAt: input.collectedAt,
      metric: a.metric,
      value: hasValue ? raw : null,
      scope: input.scope,
      sampleSize: input.sampleSize,
      limitations: hasValue
        ? undefined
        : a.available
          ? 'المؤشر متاح عبر الواجهة الرسمية لكن لم تُمرَّر قيمته في هذه العيّنة.'
          : (a.reason || 'المؤشر غير متاح عبر الواجهة الرسمية لهذه المنصة.'),
      confidence: hasValue ? 'high' : 'low',
      availability: hasValue ? 'AVAILABLE' : a.available ? 'PARTIAL' : 'NOT_AVAILABLE',
      kind: 'content',
    });
  }
  return out;
}

export interface AudienceSignalRequest {
  metric: string;
  labelAr: string;
  /** هل المنصة توفّره عبر واجهتها الرسمية؟ */
  available: boolean;
  /** السبب عند عدم الإتاحة (إلزامي حتى لا يُدَّعى توفر). */
  reason: string;
}

/**
 * مؤشرات الجمهور غير المتوفرة في نطاق النظام الحالي — تُعلن صراحةً ولا تُخترع.
 * مصدرها الحقيقة الواحدة: كل هذه تحتاج واجهات تحليلات/سكانية لم تُطلب.
 */
export const AUDIENCE_UNAVAILABLE_SIGNALS: readonly AudienceSignalRequest[] = Object.freeze([
  { metric: 'audience_country', labelAr: 'بلد الجمهور', available: false, reason: 'يتطلب واجهة تحليلات جغرافية (YouTube Analytics API) ولم تُطلب — لا تُخترع.' },
  { metric: 'audience_city', labelAr: 'مدينة الجمهور', available: false, reason: 'يتطلب واجهة تحليلات جغرافية دقيقة ولم تُطلب — لا تُخترع.' },
  { metric: 'audience_age', labelAr: 'عمر الجمهور', available: false, reason: 'بيانات سكانية؛ تتطلب واجهة تحليلات سكانية ولم تُطلب — لا تُخترع.' },
  { metric: 'audience_gender', labelAr: 'جنس الجمهور', available: false, reason: 'بيانات سكانية؛ تتطلب واجهة تحليلات سكانية ولم تُطلب — لا تُخترع.' },
  { metric: 'audience_subscribed', labelAr: 'مشتركون/غير مشتركين', available: false, reason: 'يتطلب واجهة تحليلات الجمهور ولم تُطلب — لا تُخترع.' },
  { metric: 'audience_returning', labelAr: 'جمهور عائد/جديد', available: false, reason: 'يتطلب واجهة تحليلات الجمهور ولم تُطلب — لا تُخترع.' },
  { metric: 'audience_activity_windows', labelAr: 'نوافذ نشاط الجمهور', available: false, reason: 'يتطلب واجهة تحليلات زمنية للجمهور ولم تُطلب — لا تُخترع.' },
]);

/**
 * يبني إشارات الجمهور غير المتاحة صراحةً (بلا قيمة). وجودها مقصود: يجعل الغياب
 * مرئياً في العقل بدل أن يبدو «لا شيء معروف» بلا تفسير.
 */
export function buildAudienceUnavailableSignals(platform: PlatformId, collectedAt: string): Signal[] {
  return AUDIENCE_UNAVAILABLE_SIGNALS.map((s) => ({
    source: sourceFor(platform, s.metric),
    platform,
    collectedAt,
    metric: s.metric,
    value: null,
    scope: 'channel',
    limitations: s.reason,
    confidence: 'low' as const,
    availability: 'NOT_AVAILABLE' as SignalAvailability,
    kind: 'audience' as SignalKind,
  }));
}

/** إشارة محادثة واحدة (تعليق حقيقي) — تُصنَّف لاحقاً في طبقة الفهم. */
export interface ConversationSignalInput {
  platform: PlatformId;
  externalId: string;
  text: string;
  collectedAt: string;
  authorName?: string;
}

export function buildConversationSignal(input: ConversationSignalInput): Signal {
  return {
    source: `${input.platform} API — تعليق وارد (${input.externalId})`,
    platform: input.platform,
    collectedAt: input.collectedAt,
    metric: 'conversation',
    value: input.text,
    scope: `comment:${input.externalId}`,
    sampleSize: 1,
    limitations: 'نص تعليق حقيقي من الواجهة الرسمية؛ تحليله حتمي محلي بلا استنتاج سمات شخصية.',
    confidence: 'high',
    availability: 'AVAILABLE',
    kind: 'conversation',
  };
}

/**
 * حزمة إدراك كاملة لمنصة: إشارات محتوى + جمهور (متاح/غير متاح) + محادثة.
 * تُجمَّع فقط؛ لا قرار ولا توصية هنا.
 */
export interface PerceptionBundle {
  platform: PlatformId;
  collectedAt: string;
  signals: Signal[];
  availableCount: number;
  notAvailableCount: number;
  note: string;
}

export function buildPerceptionBundle(input: {
  platform: PlatformId;
  collectedAt: string;
  values: Record<string, number>;
  scope: string;
  sampleSize?: number;
  comments?: ConversationSignalInput[];
}): PerceptionBundle {
  const signals: Signal[] = [
    ...buildContentSignals({ platform: input.platform, collectedAt: input.collectedAt, values: input.values, scope: input.scope, sampleSize: input.sampleSize }),
    ...buildAudienceUnavailableSignals(input.platform, input.collectedAt),
    ...(input.comments || []).map((c) => buildConversationSignal(c)),
  ];
  const availableCount = signals.filter((s) => s.availability === 'AVAILABLE').length;
  const notAvailableCount = signals.filter((s) => s.availability === 'NOT_AVAILABLE').length;
  return {
    platform: input.platform,
    collectedAt: input.collectedAt,
    signals,
    availableCount,
    notAvailableCount,
    note: 'إشارات حقيقية بمصادرها فقط. المؤشرات غير المتاحة معلنة صراحةً بلا قيمة مُختلقة.',
  };
}

/** يمنع أي استخدام لإشارة بلا مصدر — حارس صريح قابل للاختبار. */
export function hasValidSource(signal: Pick<Signal, 'source'>): boolean {
  return typeof signal.source === 'string' && signal.source.trim().length > 0;
}
