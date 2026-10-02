/**
 * Audience Intelligence — مقاطع جمهور مدعومة بالدليل (منطق خالص).
 *
 * المقطع هنا **فرضية سلوكية** لا سمة شخصية: يُشتقّ من تفاعل حقيقي (تعليقات/
 * رسائل/استفسارات) ومن فئات منتجات مسجّلة، ويبقى `HYPOTHESIS` حتى تبلغ عيّنته
 * حدّ الكفاية. لا تُستنتج سمات حساسة (عمر/جنس/دخل/هوية/موقع) إطلاقاً.
 *
 * القواعد الملزمة:
 * - لا مقطع بلا دليل حقيقي (نص تفاعل مطابق + مصدر + عيّنة).
 * - العيّنة دون الحد ⇒ الحالة `HYPOTHESIS` صراحةً، لا `SUPPORTED`.
 * - «حيث يوجد الجمهور» يُقرأ من المنصات التي وردت منها الإشارات فعلاً، لا تخميناً.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import type { PlatformId } from '../../social/adapter';
import { classifyComment } from '../../social/comments';
import type { ClassifiedConversation } from '../audience/conversationIntelligence';

export type SegmentConfidence = 'low' | 'medium' | 'high';

/** حالة المقطع: فرضية تحتاج دليلاً أكبر، أو مدعوم بعيّنة كافية. */
export type SegmentState = 'HYPOTHESIS' | 'SUPPORTED';

export const SEGMENT_STATE_LABELS_AR: Record<SegmentState, string> = Object.freeze({
  HYPOTHESIS: 'فرضية تحتاج مزيداً من الدليل',
  SUPPORTED: 'مدعوم بعيّنة كافية',
});

export interface AudienceInteraction {
  platform: PlatformId;
  externalId: string;
  text: string;
  at?: string | null;
  productId?: string | null;
  productCategory?: string | null;
  classification: ClassifiedConversation;
}

export interface SegmentEvidence {
  statement: string;
  source: string;
  sampleSize: number;
  exampleIds: string[];
}

export interface AudienceSegment {
  id: string;
  labelAr: string;
  description: string;
  state: SegmentState;
  /** المنصات التي وردت منها الإشارات فعلاً. */
  whereActive: PlatformId[];
  /** اهتمامات مستنتجة من موضوعات الاستفسار الحقيقية (لا سمات شخصية). */
  interests: string[];
  commonQuestions: string[];
  buyingSignals: string[];
  evidence: SegmentEvidence[];
  source: string;
  sampleSize: number;
  periodDays: number | null;
  confidence: SegmentConfidence;
  limitations: string[];
}

/** الحد الأدنى لعيّنة المقطع قبل إعلان «مدعوم» — لا حكم بلا دليل. */
export const SEGMENT_MIN_SAMPLE = 3;

/** السمات الحساسة غير المتاحة — تُعلن صراحةً ولا تُستنتج. */
export const SEGMENT_NOT_AVAILABLE_FIELDS: ReadonlyArray<{ field: string; labelAr: string; reason: string }> = Object.freeze([
  { field: 'age', labelAr: 'العمر', reason: 'بيانات سكانية غير متاحة عبر الواجهات الرسمية — لا تُخترع.' },
  { field: 'gender', labelAr: 'الجنس', reason: 'بيانات سكانية غير متاحة عبر الواجهات الرسمية — لا تُخترع.' },
  { field: 'city', labelAr: 'المدينة', reason: 'بيانات جغرافية دقيقة غير متاحة — لا تُخترع.' },
  { field: 'income', labelAr: 'الدخل', reason: 'سمة حساسة غير متاحة ولا يجوز استنتاجها.' },
  { field: 'identity', labelAr: 'الهوية', reason: 'سمة حساسة غير متاحة ولا يجوز استنتاجها.' },
]);

/**
 * تعريف مقطع: مطابقة حتمية (نص مطبَّع أو فئة منتج). المطابقة تنتج **إشارة**
 * لا حقيقة؛ والدليل يُبنى من التفاعلات المطابقة فقط.
 */
export interface SegmentDefinition {
  id: string;
  labelAr: string;
  description: string;
  /** يطابق نصاً مطبَّعاً (بعد توحيد الألف/التاء/الهمزات). */
  textPattern: RegExp | null;
  /** يطابق فئة منتج مسجّلة. */
  categories: string[];
  /** يتطلب وجود خطط تقسيط مسجّلة. */
  requiresInstallmentPlans?: boolean;
}

/**
 * مقاطع مبنية على سلوك/نية ملاحَظة — كلها فرضيات حتى يُسندها دليل.
 * الترتيب لا يعني أولوية.
 */
export const AUDIENCE_SEGMENT_DEFINITIONS: readonly SegmentDefinition[] = Object.freeze([
  {
    id: 'home_appliance_shoppers',
    labelAr: 'باحثون عن أجهزة منزلية',
    description: 'يتفاعلون مع منتجات الأجهزة المنزلية ويسألون عن السعر/المواصفات/التوفر.',
    textPattern: /غساله|ثلاجه|براد|طباخ|فريزر|مكيف|سبلت|ميكروويف|تلفزيون|فرن|منشفه|سخان/,
    categories: ['appliances', 'electronics'],
  },
  {
    id: 'families_preparing_home',
    labelAr: 'عائلات تجهّز بيتاً',
    description: 'يذكرون تجهيز بيت/سكن ويطلبون أكثر من صنف.',
    textPattern: /تجهيز بيت|تجهيز البيت|بيت جديد|بيتنا|سكن جديد|اثاث|غرفه نوم|طقم|عدة بيت/,
    categories: [],
  },
  {
    id: 'newly_married',
    labelAr: 'مقبلون على الزواج',
    description: 'يذكرون الزواج/العرس/الجهاز ويطلبون تجهيزاً كاملاً.',
    textPattern: /زواج|عرس|عروس|عروسه|جهاز العروس|مهر|زواجي|خطوبه/,
    categories: [],
  },
  {
    id: 'replacing_old_appliances',
    labelAr: 'مستبدلون أجهزة قديمة',
    description: 'يذكرون تعطّل/قدم جهاز ويريدون بديلاً.',
    textPattern: /خربان|عطلان|تعطل|تبديل|استبدال|قديم|بديل|خرب|تكسر|يصير له فتره/,
    categories: [],
  },
  {
    id: 'construction_customers',
    labelAr: 'عملاء بناء',
    description: 'يذكرون البناء/المقاولات ويبحثون عن مواد أو أجهزة للمشروع.',
    textPattern: /بناء|ابني|مقاول|خرسانه|طابوق|اسمنت|حديد|اساس|سقف|بنايه/,
    categories: ['construction'],
  },
  {
    id: 'renovation_customers',
    labelAr: 'عملاء ترميم',
    description: 'يذكرون الترميم/التجديد/الصيانة.',
    textPattern: /ترميم|تجديد|صيانه|رنوفيت|اعاده تاهيل|تصليح|نغير البيت/,
    categories: [],
  },
  {
    id: 'finishing_customers',
    labelAr: 'عملاء تشطيب',
    description: 'يذكرون التشطيب/الأرضيات/السيراميك/الجبس.',
    textPattern: /تشطيب|سيراميك|ارضيات|جبس|دهان|بورسلان|كاشي|مطابخ|ابواب/,
    categories: [],
  },
  {
    id: 'installment_shoppers',
    labelAr: 'باحثون عن التقسيط',
    description: 'يسألون عن التقسيط/الدفعة الأولى/الشروط، ولا تُعلن بلا خطط تقسيط مسجّلة.',
    textPattern: /تقسيط|قسط|اقساط|أقساط|مقدم|دفعه اولى|دفعة اولى|بالشهر|شهري|بلا فوايد|بدون فوايد|شروط|مستندات/,
    categories: [],
    requiresInstallmentPlans: true,
  },
]);

function confidenceFromSample(n: number): SegmentConfidence {
  if (n >= SEGMENT_MIN_SAMPLE * 3) return 'high';
  if (n >= SEGMENT_MIN_SAMPLE * 2) return 'medium';
  return 'low';
}

function periodDaysBetween(list: AudienceInteraction[]): number | null {
  const times = list.map((i) => (i.at ? Date.parse(i.at) : NaN)).filter((n) => Number.isFinite(n));
  if (times.length < 2) return null;
  const min = Math.min(...times);
  const max = Math.max(...times);
  return Math.max(0, Math.round((max - min) / 86_400_000));
}

/**
 * يشتقّ مقاطع الجمهور من تفاعلات حقيقية + فئات منتجات. لا يُنتج مقطعاً بلا دليل،
 * ويعلن كل مقطع دون حدّ الكفاية `HYPOTHESIS` صراحةً.
 */
export function deriveAudienceSegments(input: {
  interactions: AudienceInteraction[];
  /** هل توجد خطط تقسيط مسجّلة في المعرض؟ */
  hasInstallmentPlans: boolean;
  min?: number;
}): AudienceSegment[] {
  const min = input.min ?? SEGMENT_MIN_SAMPLE;
  const interactions = input.interactions || [];
  const segments: AudienceSegment[] = [];

  for (const def of AUDIENCE_SEGMENT_DEFINITIONS) {
    if (def.requiresInstallmentPlans && !input.hasInstallmentPlans) continue;

    const matched = interactions.filter((it) => {
      const normalized = classifyComment(it.text || '').normalized || '';
      const textHit = def.textPattern ? def.textPattern.test(normalized) : false;
      const categoryHit = def.categories.length > 0 && typeof it.productCategory === 'string' && def.categories.includes(it.productCategory);
      return textHit || categoryHit;
    });
    if (!matched.length) continue;

    const platforms = [...new Set(matched.map((m) => m.platform))];
    const topics = [...new Set(matched.map((m) => m.classification.topic).filter((t) => t && t !== 'general'))];
    const questions = [...new Set(matched.filter((m) => m.classification.category === 'question').map((m) => m.classification.topic))];
    const buying = [...new Set(matched.filter((m) => m.classification.category === 'purchase_intent').map((m) => m.classification.topic))];
    const sampleSize = matched.length;
    const state: SegmentState = sampleSize >= min ? 'SUPPORTED' : 'HYPOTHESIS';

    segments.push({
      id: def.id,
      labelAr: def.labelAr,
      description: def.description,
      state,
      whereActive: platforms,
      interests: topics,
      commonQuestions: questions,
      buyingSignals: buying,
      evidence: [{
        statement: `${sampleSize} تفاعلاً حقيقياً يطابق «${def.labelAr}» على ${platforms.join(', ')}.`,
        source: 'تعليقات/رسائل حقيقية مصنّفة حتمياً',
        sampleSize,
        exampleIds: matched.slice(0, 5).map((m) => `${m.platform}:${m.externalId}`),
      }],
      source: 'تفاعل حقيقي (تعليقات/رسائل) + فئات منتجات مسجّلة',
      sampleSize,
      periodDays: periodDaysBetween(matched),
      confidence: confidenceFromSample(sampleSize),
      limitations: [
        state === 'HYPOTHESIS'
          ? `العيّنة (${sampleSize}) أقل من الحد (${min}) — المقطع فرضية لا حقيقة.`
          : 'المقطع سلوكي مدعوم بتفاعل حقيقي؛ لا يضمن تحويلاً إلى بيع.',
        'لا تُستنتج سمات سكانية (عمر/جنس/دخل/موقع).',
      ],
    });
  }

  return segments.sort((a, b) => b.sampleSize - a.sampleSize);
}

export interface AudienceSegmentsSummary {
  total: number;
  supported: number;
  hypotheses: number;
  note: string;
}

export function summarizeAudienceSegments(segments: AudienceSegment[]): AudienceSegmentsSummary {
  const supported = segments.filter((s) => s.state === 'SUPPORTED').length;
  return {
    total: segments.length,
    supported,
    hypotheses: segments.length - supported,
    note: 'المقاطع فرضيات سلوكية مدعومة بتفاعل حقيقي؛ وما دون حدّ العيّنة يُعلن فرضية صراحةً.',
  };
}
