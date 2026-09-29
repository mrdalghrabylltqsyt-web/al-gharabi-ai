/**
 * Content Intelligence — طبقة بناء المحتوى العامة لكل المنصات.
 *
 * الغرض: بناء «محتوى أساسي واحد» (CoreContent) من بيانات حقيقية فقط، ثم تكييفه
 * حتمياً لكل منصة (Platform Adapter) بلا استدعاء Gemini لكل منصة. الاستدعاء
 * الوحيد الممكن للذكاء الاصطناعي هو صياغة الأساس (اختياري)، والباقي حتمي.
 *
 * قواعد ملزمة:
 * - لا اختراع: أي معلومة (سعر/خصم/ضمان/رقم/رابط/توفر) لا تُذكر إلا إن جاءت في
 *   الحقائق المُمرَّرة فعلاً. الحقائق الناقصة تُعلن في `missingFacts`.
 * - التكييف للمنصات حتمي 100% ولا يستهلك أي حصة.
 * - المنصة التي تتطلب وسائط تُعلن ذلك صراحةً في التكييف، ولا يُدَّعى محتوى جاهز
 *   للنشر بدونها.
 * - المنطق هنا لا يعرف شيئاً خاصاً بأي منصة بعينها؛ كل ما هو خاص منصةً يعيش في
 *   جدول `PLATFORM_CONTENT_PROFILES` فقط.
 */

import type { PlatformId, PlatformCapability } from './adapter';
import { buildDeterministicYouTubeDescription, buildDescriptionHashtags } from './youtubeDescription';

// ---------------------------------------------------------------------------
// الأنواع
// ---------------------------------------------------------------------------

export interface ContentBriefProduct {
  id?: string | null;
  name: string;
  category?: string | null;
  /** مواصفات مسجّلة فعلاً. */
  specs?: string[];
  /** خيارات تقسيط مسجّلة فعلاً (نص بلا ادعاء رقمي). */
  installmentOptions?: string[];
  /** هل المنتج متوفر فعلاً؟ null = غير معروف (لا يُدّعى). */
  inStock?: boolean | null;
  /** سعر مسجّل فعلاً (يُذكر كنص فقط إن وُجد). */
  priceText?: string | null;
}

export interface ContentBriefShowroom {
  name?: string | null;
  tagline?: string | null;
  about?: string | null;
  city?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  locationText?: string | null;
  hoursText?: string | null;
}

export interface ContentBrief {
  objective?: string | null;
  product?: ContentBriefProduct | null;
  showroom?: ContentBriefShowroom | null;
  /** المنصات المستهدفة. */
  platforms: PlatformId[];
  audienceHint?: string | null;
  campaign?: string | null;
  extraInstructions?: string | null;
}

/** المحتوى الأساسي الموحّد قبل التكييف لأي منصة. */
export interface CoreContent {
  headline: string | null;
  description: string;
  shortDescription: string;
  cta: string;
  hashtags: string[];
  keywords: string[];
  /** هل بُني من منتج فعلي أم عام؟ */
  basis: 'product' | 'general';
  /** الحقائق المستخدمة فعلاً (للتفسير). */
  factsUsed: string[];
  /** حقائق ناقصة منعت محتوى أدق — لا تُخترع. */
  missingFacts: string[];
  limitations: string[];
}

export interface PlatformContentProfile {
  platform: PlatformId;
  /** وصف الصيغة المتوقعة في هذه المنصة. */
  format: string;
  /** حد العنوان/الالتقاط (0 = لا عنوان منفصل). */
  titleLimit: number;
  /** حد نص المنشور/الوصف. */
  bodyLimit: number;
  /** هل تحتاج المنصة وسائط (صورة/فيديو) للنشر؟ */
  mediaRequired: boolean;
  /** هل تسمح المنصة بالرد/التعليق العام؟ (منفصل عن القدرة التشغيلية) */
  notes: string;
}

/** تكييف المحتوى الأساسي لمنصة واحدة (حتمي). */
export interface PlatformAdaptation {
  platform: PlatformId;
  format: string;
  title: string | null;
  description: string;
  shortDescription: string;
  cta: string;
  hashtags: string[];
  charCount: number;
  limit: number;
  withinLimit: boolean;
  mediaRequired: boolean;
  /** هل المنصة جاهزة لقبول هذا التكييف؟ ليس حكماً على الاتصال. */
  adaptationReady: boolean;
  notes: string;
  limitations: string[];
}

export interface ContentPlan {
  objective: string;
  audience: string;
  productContext: { id: string | null; name: string | null; category: string | null } | null;
  title: string | null;
  description: string;
  shortDescription: string;
  cta: string;
  hashtags: string[];
  keywords: string[];
  platformAdaptations: PlatformAdaptation[];
  /** وقت نشر مقترح بصيغة ISO أو null؛ لا يُخترع وقت بلا عيّنة. */
  recommendedPublishTime: string | null;
  schedulingReason: string;
  confidence: 'low' | 'medium' | 'high';
  sourceData: string[];
  limitations: string[];
  requiresHumanReview: boolean;
  /** الإجراء الموصى به — توجيه لا تنفيذ. */
  recommendedAction: string;
  /** هل الخطة كاملة للاستخدام بلا معلومات ناقصة؟ */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// جدول خصوصيات المنصات (المصدر الوحيد لكل ما هو خاص بمنصة)
// ---------------------------------------------------------------------------

/**
 * حدود وخصائص النشر لكل منصة كما تفرضها واجهاتها الرسمية (حدود سياسة، حتمية).
 * القيم هنا مقصودة كسقوف نظام لا كادعاء قدرة اتصال.
 */
export const PLATFORM_CONTENT_PROFILES: Record<PlatformId, PlatformContentProfile> = Object.freeze({
  tiktok: { platform: 'tiktok', format: 'فيديو قصير بهوك أول', titleLimit: 100, bodyLimit: 2200, mediaRequired: true, notes: 'النشر العام يتطلب Content Posting audit؛ رفع المسودة متاح بلا audit.' },
  youtube: { platform: 'youtube', format: 'فيديو توضيحي بعنوان ووصف', titleLimit: 100, bodyLimit: 5000, mediaRequired: true, notes: 'الوصف المعتمد يُتحقق من وصوله فعلاً بعد النشر.' },
  facebook: { platform: 'facebook', format: 'منشور نصي/بصري للصفحة', titleLimit: 120, bodyLimit: 5000, mediaRequired: false, notes: 'نشر على الصفحة عبر رمز الصفحة.' },
  instagram: { platform: 'instagram', format: 'منشور بصري/ريلز', titleLimit: 0, bodyLimit: 2200, mediaRequired: true, notes: 'Instagram لا ينشر نصاً فقط؛ الوسائط إلزامية.' },
  whatsapp: { platform: 'whatsapp', format: 'رسالة أعمال مباشرة', titleLimit: 0, bodyLimit: 4096, mediaRequired: false, notes: 'لا نشر منشورات عامة؛ رسائل وردود فقط.' },
  telegram: { platform: 'telegram', format: 'منشور قناة/رسالة', titleLimit: 0, bodyLimit: 1024, mediaRequired: false, notes: 'نص منظم بنقاط؛ لا تعليقات عامة عبر البوت.' },
  x: { platform: 'x', format: 'تغريدة/ثريد مختصر', titleLimit: 0, bodyLimit: 280, mediaRequired: false, notes: 'الحد 280 محرفاً؛ الردود متاحة عبر API.' },
  snapchat: { platform: 'snapchat', format: 'ستوري قصير', titleLimit: 0, bodyLimit: 250, mediaRequired: true, notes: 'واجهة إعلانات/تحويلات محدودة.' },
  threads: { platform: 'threads', format: 'منشور محادثي مختصر', titleLimit: 0, bodyLimit: 500, mediaRequired: false, notes: 'نشر وردود عبر Threads API.' },
  google_business: { platform: 'google_business', format: 'تحديث محلي', titleLimit: 0, bodyLimit: 1500, mediaRequired: false, notes: 'التعليقات غير متاحة عبر الواجهة الرسمية.' },
});

/** وسوم من التصنيف المسجّل فقط (لا وسم مُختلق). مصدر واحد: باني وسوم الوصف. */
export function buildHashtags(category?: string | null, extra: string[] = []): string[] {
  return buildDescriptionHashtags(category, extra);
}

function clean(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * يبني المحتوى الأساسي من الحقائق المُمرَّرة فقط. النص الوصفي يُبنى عبر نفس
 * الباني الحتمي المُختبَر لوصف YouTube (مصدر واحد، بلا منطق مكرّر)، ثم يُعمَّم
 * على كل المنصات في مرحلة التكييف. لا يذكر سعراً/خصماً/ضماناً/رقماً غير موجود،
 * وأي حقل ناقص يُدرج في `missingFacts`.
 */
export function buildCoreContent(brief: ContentBrief): CoreContent {
  const product = brief.product || null;
  const showroom = brief.showroom || null;
  const name = clean(product?.name, 120);
  const showroomName = clean(showroom?.name, 80);
  const factsUsed: string[] = [];
  const missingFacts: string[] = [];
  const limitations: string[] = [];

  const headline = name
    ? (clean(brief.campaign, 60) ? `${name} — ${clean(brief.campaign, 60)}` : `${name} بالتقسيط`)
    : (showroomName ? `عروض ${showroomName}` : null);
  if (name) factsUsed.push('اسم المنتج'); else missingFacts.push('اسم المنتج غير متوفر.');

  // مصدر واحد للنص الوصفي: الباني الحتمي المُختبَر (لا منطق مكرّر).
  const built = buildDeterministicYouTubeDescription({
    product: product
      ? { name, category: product.category ?? null, specs: product.specs || [], installmentOptions: product.installmentOptions || [], inStock: typeof product.inStock === 'boolean' ? product.inStock : null }
      : null,
    showroomName: showroomName || null,
    tagline: clean(showroom?.tagline, 160) || null,
    about: clean(showroom?.about, 400) || null,
    city: clean(showroom?.city, 60) || null,
    contact: { phone: clean(showroom?.phone, 40) || null, whatsapp: clean(showroom?.whatsapp, 40) || null },
    extraInstructions: clean(brief.extraInstructions, 400) || null,
  });

  factsUsed.push(...built.factsUsed);
  let description = built.description;

  // السعر يُذكر فقط إن كان مسجّلاً فعلاً (يُدرج قبل سطر الوسوم).
  const priceText = clean(product?.priceText, 60);
  if (priceText) {
    const lines = description.split('\n');
    const lastIsTags = lines.length > 1 && lines[lines.length - 1].startsWith('#');
    const insertAt = lastIsTags ? lines.length - 1 : lines.length;
    lines.splice(insertAt, 0, `السعر: ${priceText}.`);
    description = lines.join('\n');
    factsUsed.push('سعر مسجّل');
  } else if (product) {
    missingFacts.push('السعر غير مسجّل.');
  }

  if (product && !(product.specs || []).length) missingFacts.push('لا مواصفات مسجّلة لهذا المنتج.');
  if (product && !clean(showroom?.city, 60)) missingFacts.push('المدينة غير مسجّلة.');
  if (!built.hasContactCta) missingFacts.push('لا رقم تواصل مسجّل؛ دعوة التواصل عامة.');
  if (!product) missingFacts.push('لا منتج محدّد؛ المحتوى عام عن المعرض.');

  const cta = built.hasContactCta
    ? 'تواصل معنا الآن للحجز واستفسار التقسيط.'
    : 'تواصل معنا عبر قنوات المعرض الرسمية للاستفسار.';

  const specs = (product?.specs || []).map((s) => clean(s, 200)).filter(Boolean).slice(0, 8);
  const hashtags = built.hashtags.length ? built.hashtags : buildHashtags(product?.category);
  const keywords = [...new Set([
    name, clean(product?.category, 40), showroomName, clean(brief.campaign, 40),
    ...specs.map((s) => clean(s, 40)).slice(0, 6),
  ].filter(Boolean))];

  if (!product) limitations.push('لا منتج محدّد؛ المحتوى عام عن المعرض بلا تفاصيل منتج.');
  if (missingFacts.length) limitations.push(`معلومات ناقصة لم تُخترع: ${missingFacts.join(' ')}`);
  limitations.push('الوصف لا يضمن وصولاً أو مشاهدات؛ هو صياغة من بيانات فعلية فقط.');

  const shortDescription = clean(
    description.split('\n').filter((l) => !l.startsWith('•') && !l.startsWith('#')).join(' '),
    180,
  );

  return {
    headline,
    description,
    shortDescription: shortDescription || description.slice(0, 180),
    cta,
    hashtags,
    keywords,
    basis: built.basis,
    factsUsed: [...new Set(factsUsed)],
    missingFacts,
    limitations,
  };
}

// ---------------------------------------------------------------------------
// تكييف المنصة (حتمي — بلا أي استدعاء AI)
// ---------------------------------------------------------------------------

function trimToWordBoundary(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * يكيّف المحتوى الأساسي لمنصة واحدة حتمياً: يجمع العنوان + الوصف + CTA + الوسوم
 * ويقصّها ضمن حد المنصة بلا قطع منتصف كلمة، مع إعلان الوسوم المُسقَطة.
 */
export function adaptForPlatform(core: CoreContent, platform: PlatformId): PlatformAdaptation {
  const profile = PLATFORM_CONTENT_PROFILES[platform];
  const title = profile.titleLimit > 0 && core.headline ? trimToWordBoundary(core.headline, profile.titleLimit) : null;
  const limitations: string[] = [];
  let tags = [...core.hashtags];
  const render = () => [core.description, core.cta, tags.join(' ')].filter((x) => x && x.trim()).join('\n\n');
  let text = render();
  while (text.length > profile.bodyLimit && tags.length > 1) {
    tags = tags.slice(0, -1);
    text = render();
  }
  if (text.length > profile.bodyLimit) {
    tags = [];
    const reserved = render().length - core.description.length;
    const body = trimToWordBoundary(core.description, Math.max(0, profile.bodyLimit - reserved));
    text = [body, core.cta].filter(Boolean).join('\n\n');
    if (text.length > profile.bodyLimit) text = trimToWordBoundary(text, profile.bodyLimit);
    limitations.push('قُصّ النص ليطابق حد المنصة؛ أُسقطت بعض الوسوم.');
  } else if (tags.length < core.hashtags.length) {
    limitations.push(`أُسقطت ${core.hashtags.length - tags.length} وسماً لتطابق حد المنصة.`);
  }
  if (profile.mediaRequired) {
    limitations.push('هذه المنصة تتطلب وسائط (صورة/فيديو) للنشر؛ لا يُعتبر المحتوى جاهزاً للنشر بلا وسائط.');
  }
  const shortDescription = title ? title : trimToWordBoundary(core.shortDescription, Math.min(120, profile.bodyLimit));
  return {
    platform,
    format: profile.format,
    title,
    description: text,
    shortDescription,
    cta: core.cta,
    hashtags: tags,
    charCount: text.length,
    limit: profile.bodyLimit,
    withinLimit: text.length <= profile.bodyLimit,
    mediaRequired: profile.mediaRequired,
    adaptationReady: text.length > 0 && text.length <= profile.bodyLimit,
    notes: profile.notes,
    limitations,
  };
}

/** يكيّف المحتوى الأساسي لكل المنصات المطلوبة (بلا استهلاك أي حصة). */
export function adaptForPlatforms(core: CoreContent, platforms: PlatformId[]): PlatformAdaptation[] {
  const seen = new Set<PlatformId>();
  const out: PlatformAdaptation[] = [];
  for (const p of platforms) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(adaptForPlatform(core, p));
  }
  return out;
}

// ---------------------------------------------------------------------------
// الخطة الكاملة
// ---------------------------------------------------------------------------

export interface BuildContentPlanInput {
  brief: ContentBrief;
  /** وقت نشر مقترح من عيّنة حقيقية فقط (أو null). */
  recommendedPublishTime?: string | null;
  schedulingReason?: string;
  /** هل نقصت معلومات تفرض مراجعة بشرية؟ */
  extraRequiresReview?: boolean;
  objectiveType?: string | null;
}

/**
 * يبني ContentPlan كاملاً: الأساس + تكييف كل المنصات + التوصية الزمنية، مع
 * إعلان المصدر والحدود والثقة. لا ينفّذ نشراً ولا يتجاوز أي بوابة صلاحيات.
 */
export function buildContentPlan(input: BuildContentPlanInput): ContentPlan {
  const { brief } = input;
  const core = buildCoreContent(brief);
  const adaptations = adaptForPlatforms(core, brief.platforms || []);
  const platforms = brief.platforms || [];

  // الثقة مبنية على اكتمال البيانات الحقيقية، لا على تخمين.
  let confidence: ContentPlan['confidence'] = 'low';
  if (core.basis === 'product' && core.missingFacts.length === 0) confidence = 'high';
  else if (core.basis === 'product' && core.missingFacts.length <= 2) confidence = 'medium';
  else if (core.basis === 'general') confidence = 'low';

  const sourceData = [...new Set(core.factsUsed)];
  const limitations = [...core.limitations];

  // مراجعة بشرية إلزامية عند نقص معلومات حقيقية أو طلب صريح.
  const requiresHumanReview = Boolean(input.extraRequiresReview) || core.missingFacts.length > 0 || core.basis === 'general';
  const complete = !requiresHumanReview;

  const recommendedAction = requiresHumanReview
    ? 'راجع المسودة وأكمل المعلومات الناقصة قبل الاعتماد أو النشر.'
    : 'المحتوى جاهز للمراجعة البشرية؛ الاعتماد/النشر يخضع لصلاحيات المنصة الحالية.';

  const schedulingReason = input.recommendedPublishTime
    ? (input.schedulingReason || 'وقت مقترح من بيانات تفاعل حقيقية سابقة.')
    : 'لا يوجد وقت مقترح: العيّنة غير كافية — يُترك للمالك اختيار وقت صريح.';

  return {
    objective: clean(brief.objective, 200) || 'تنمية تفاعل حقيقي وتحويلات مباشرة',
    audience: clean(brief.audienceHint, 200) || 'الجمهور العراقي المهتم بالتقسيط',
    productContext: brief.product
      ? { id: brief.product.id ?? null, name: clean(brief.product.name, 120) || null, category: clean(brief.product.category, 40) || null }
      : null,
    title: core.headline,
    description: core.description,
    shortDescription: core.shortDescription,
    cta: core.cta,
    hashtags: core.hashtags,
    keywords: core.keywords,
    platformAdaptations: adaptations,
    recommendedPublishTime: input.recommendedPublishTime ?? null,
    schedulingReason,
    confidence,
    sourceData,
    limitations,
    requiresHumanReview,
    recommendedAction,
    complete,
  };
}

/** يتحقق أن منصة تدعم قدرة معينة قبل عرض إجراء عليها (بلا ادعاء قدرة). */
export function platformSupports(capabilities: readonly PlatformCapability[], capability: PlatformCapability): boolean {
  return capabilities.includes(capability);
}
