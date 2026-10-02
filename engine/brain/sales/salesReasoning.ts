/**
 * Sales Reasoning — هيكل استدلال «لماذا لم يُبِع هذا المنتج؟» (منطق خالص).
 *
 * الغرض: أن يفحص العقل **كل الفرضيات المحتملة** لنقص المبيعات، ويُعلن لكل فرضية:
 * هل هناك دليل يدعمها؟ ما نعرفه؟ ما نجهله؟ ما الذي يجب اختباره؟ — بدل التخمين.
 *
 * **طبقة تحضير فقط**: تبني القوالب والبنية وتُصنّف الأدلة المتاحة؛ ولا تُصدر
 * حكماً نهائياً ولا تخترع سبباً.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import type { PlatformId } from '../../social/adapter';

/** الأسباب المحتملة لنقص المبيعات — قائمة صريحة لا تُخترع خارجها. */
export type SalesBlocker =
  | 'insufficient_reach'
  | 'wrong_audience'
  | 'weak_content'
  | 'unclear_offer'
  | 'price_resistance'
  | 'installment_misunderstanding'
  | 'lack_of_availability'
  | 'insufficient_follow_up'
  | 'poor_cta'
  | 'repeated_objection'
  | 'competitor_alternative'
  | 'missing_information';

export const SALES_BLOCKER_LABELS_AR: Record<SalesBlocker, string> = Object.freeze({
  insufficient_reach: 'وصول غير كافٍ',
  wrong_audience: 'جمهور غير مناسب',
  weak_content: 'محتوى ضعيف',
  unclear_offer: 'عرض غير واضح',
  price_resistance: 'مقاومة سعرية',
  installment_misunderstanding: 'سوء فهم التقسيط',
  lack_of_availability: 'عدم توفر المنتج',
  insufficient_follow_up: 'متابعة غير كافية',
  poor_cta: 'دعوة للتواصل ضعيفة',
  repeated_objection: 'اعتراض متكرر',
  competitor_alternative: 'بديل/منافس',
  missing_information: 'معلومة ناقصة (سعر/مواصفة/توفر)',
});

/** حالة دليل كل سبب — الفصل الصريح بين المعروف والمجهول. */
export type BlockerEvidenceState = 'SUPPORTED' | 'CONTRADICTED' | 'UNKNOWN' | 'INSUFFICIENT_DATA';

export const BLOCKER_EVIDENCE_LABELS_AR: Record<BlockerEvidenceState, string> = Object.freeze({
  SUPPORTED: 'مدعوم بدليل',
  CONTRADICTED: 'منفي بدليل',
  UNKNOWN: 'مجهول (لا بيانات)',
  INSUFFICIENT_DATA: 'بيانات غير كافية',
});

export interface BlockerAssessment {
  blocker: SalesBlocker;
  state: BlockerEvidenceState;
  /** ما نعرفه عن هذا السبب تحديداً. */
  whatWeKnow: string[];
  /** ما نجهله ويمنع الحكم. */
  whatWeDontKnow: string[];
  /** الدليل الرقمي إن وُجد. */
  evidence: string[];
  /** الاختبار/القياس الذي يحسم هذا السبب. */
  testToResolve: string;
  requiresOwnerInput: boolean;
}

/**
 * أدلة متاحة (حقيقية فقط). الحقول الغائبة تبقى `null` فلا يُبنى عليها حكم.
 */
export interface SalesEvidenceInput {
  productId: string;
  productName: string;
  /** هل السعر موثّق فعلاً؟ */
  priceVerified: boolean;
  /** هل التوفر موثّق؟ والقيمة إن وُجدت. */
  availabilityVerified: boolean;
  inStock: boolean | null;
  /** هل عرض التقسيط موثّق؟ */
  installmentVerified: boolean;
  /** هل محتوى المنتج موجود؟ وعدد المنشورات المرتبطة به (0 = لا محتوى). */
  contentCount: number;
  /** إشارات الطلب الحقيقية على المنتج (عدد). */
  demandSignals: number;
  /** إشارات الشراء المؤهّلة (استفسارات أعمال) على المنتج. */
  qualifiedInquiries: number;
  /** مرات التكرار لاعتراضات حول المنتج. */
  objections: number;
  /** هل توجد دعوة صريحة للتواصل (CTA) في المحتوى؟ */
  hasCta: boolean;
  /** إشارات وصول متاحة فعلاً (قد تكون null لعدم توفر المؤشر). */
  reach: number | null;
  /** عملاء محتملون مسجّلون من هذا المنتج. */
  leads: number;
  /** مبيعات موثّقة لهذا المنتج. */
  verifiedSales: number;
  /** أدلة متكررة على تفضيل بديل/منافس من النص. */
  competitorMentions: number;
}

/**
 * يبني تقييم كل سبب محتمل من الأدلة الحقيقية فقط. لا يعلن سبباً «مدعوماً» بلا
 * دليل رقمي، ولا يخترع سبباً خارج القائمة.
 */
export function assessSalesBlockers(input: SalesEvidenceInput): BlockerAssessment[] {
  const list: BlockerAssessment[] = [];
  const productRef = input.productName || input.productId;

  const push = (b: BlockerAssessment) => list.push(b);

  push({
    blocker: 'missing_information',
    state: (!input.priceVerified || !input.availabilityVerified || !input.installmentVerified)
      ? 'SUPPORTED'
      : 'CONTRADICTED',
    whatWeKnow: [
      `السعر ${input.priceVerified ? 'موثّق' : 'غير موثّق'}.`,
      `التوفر ${input.availabilityVerified ? 'موثّق' : 'غير موثّق'}.`,
      `عرض التقسيط ${input.installmentVerified ? 'موثّق' : 'غير موثّق'}.`,
    ],
    whatWeDontKnow: input.priceVerified ? [] : ['السعر الرسمي غير مسجّل — يمنع أي إجابة سعرية.'],
    evidence: [],
    testToResolve: 'وثّق السعر/التوفر/التقسيط في قاعدة بيانات المعرض.',
    requiresOwnerInput: !input.priceVerified || !input.availabilityVerified || !input.installmentVerified,
  });

  push({
    blocker: 'lack_of_availability',
    state: !input.availabilityVerified ? 'UNKNOWN' : (input.inStock === false ? 'SUPPORTED' : 'CONTRADICTED'),
    whatWeKnow: [input.availabilityVerified ? `التوفر: ${input.inStock ? 'متوفر' : 'غير متوفر'}.` : 'التوفر غير موثّق.'],
    whatWeDontKnow: input.availabilityVerified ? [] : ['التوفر يحتاج تحقق.'],
    evidence: [],
    testToResolve: 'حدّث حالة المخزون للمنتج.',
    requiresOwnerInput: !input.availabilityVerified,
  });

  push({
    blocker: 'insufficient_reach',
    state: input.reach === null ? 'UNKNOWN' : (input.reach < 1000 ? 'INSUFFICIENT_DATA' : 'CONTRADICTED'),
    whatWeKnow: input.reach === null ? ['مؤشر الوصول غير متاح عبر الواجهة الحالية.'] : [`الوصول المسجّل: ${input.reach}.`],
    whatWeDontKnow: input.reach === null ? ['لا يمكن الحكم على الوصول بلا مؤشر متاح.'] : ['حدّ «الوصول الكافي» يعتمد على هدف الحملة.'],
    evidence: input.reach === null ? [] : [`reach=${input.reach}`],
    testToResolve: 'سجّل/راقب مؤشر الوصول من المنصة حيث تتوفر الواجهة.',
    requiresOwnerInput: false,
  });

  push({
    blocker: 'weak_content',
    state: input.contentCount === 0 ? 'SUPPORTED' : (input.contentCount >= 3 ? 'CONTRADICTED' : 'INSUFFICIENT_DATA'),
    whatWeKnow: [`عدد المنشورات المرتبطة بالمنتج: ${input.contentCount}.`],
    whatWeDontKnow: input.contentCount === 0 ? ['لا محتوى مخصّص للمنتج — لا يمكن قياس أي شيء.' ] : [],
    evidence: [`contentCount=${input.contentCount}`],
    testToResolve: 'أنشئ محتوى مخصّصاً للمنتج وقس الاستفسارات بعده.',
    requiresOwnerInput: false,
  });

  push({
    blocker: 'poor_cta',
    state: input.contentCount === 0 ? 'INSUFFICIENT_DATA' : (input.hasCta ? 'CONTRADICTED' : 'SUPPORTED'),
    whatWeKnow: [input.hasCta ? 'المحتوى يحمل دعوة صريحة للتواصل.' : 'لا دعوة صريحة للتواصل مسجّلة.'],
    whatWeDontKnow: [],
    evidence: [],
    testToResolve: 'أضف دعوة صريحة للتواصل واختبرها كمتغيّر واحد.',
    requiresOwnerInput: false,
  });

  push({
    blocker: 'price_resistance',
    state: input.objections > 0 && input.qualifiedInquiries > 0 ? 'SUPPORTED' : (input.qualifiedInquiries === 0 ? 'UNKNOWN' : 'INSUFFICIENT_DATA'),
    whatWeKnow: [`اعتراضات مسجّلة: ${input.objections}، استفسارات مؤهّلة: ${input.qualifiedInquiries}.`],
    whatWeDontKnow: input.qualifiedInquiries === 0 ? ['لا استفسارات لتقييم حساسية السعر.'] : [],
    evidence: [`objections=${input.objections}`],
    testToResolve: 'اختبر عرضاً سعرياً/تقسيطياً واضحاً وقس تحوّل الاستفسارات.',
    requiresOwnerInput: false,
  });

  push({
    blocker: 'installment_misunderstanding',
    state: !input.installmentVerified ? 'UNKNOWN' : (input.demandSignals > 0 && input.installmentVerified ? 'INSUFFICIENT_DATA' : 'UNKNOWN'),
    whatWeKnow: [input.installmentVerified ? 'عرض التقسيط موثّق.' : 'عرض التقسيط غير موثّق.'],
    whatWeDontKnow: ['لا نعرف إن كان سوء الفهم هو السبب بلا محتوى توضيحي وقياس بعده.'],
    evidence: [],
    testToResolve: 'انشر شرحاً للتقسيط من بيانات موثّقة وقس الاستفسارات.',
    requiresOwnerInput: !input.installmentVerified,
  });

  push({
    blocker: 'repeated_objection',
    state: input.objections >= 3 ? 'SUPPORTED' : (input.objections === 0 ? 'UNKNOWN' : 'INSUFFICIENT_DATA'),
    whatWeKnow: [`اعتراضات متكررة: ${input.objections}.`],
    whatWeDontKnow: input.objections === 0 ? ['لا اعتراضات مسجّلة.'] : [],
    evidence: [`objections=${input.objections}`],
    testToResolve: 'عالج الاعتراض الأكثر تكراراً في محتوى/رد موثّق.',
    requiresOwnerInput: false,
  });

  push({
    blocker: 'competitor_alternative',
    state: input.competitorMentions >= 3 ? 'SUPPORTED' : (input.competitorMentions === 0 ? 'UNKNOWN' : 'INSUFFICIENT_DATA'),
    whatWeKnow: [`إشارات بديل/منافس: ${input.competitorMentions}.`],
    whatWeDontKnow: input.competitorMentions === 0 ? ['لا إشارات على بديل/منافس في النص.' ] : [],
    evidence: [`competitorMentions=${input.competitorMentions}`],
    testToResolve: 'قارن المنتج بالبديل في محتوى بلا ادعاءات غير مسجّلة.',
    requiresOwnerInput: false,
  });

  push({
    blocker: 'insufficient_follow_up',
    state: input.qualifiedInquiries > 0 && input.leads === 0 ? 'SUPPORTED' : (input.qualifiedInquiries === 0 ? 'UNKNOWN' : 'CONTRADICTED'),
    whatWeKnow: [`استفسارات مؤهّلة: ${input.qualifiedInquiries}، عملاء مسجّلون: ${input.leads}.`],
    whatWeDontKnow: input.qualifiedInquiries === 0 ? ['لا استفسارات لتقييم المتابعة.'] : [],
    evidence: [`qualifiedInquiries=${input.qualifiedInquiries}`, `leads=${input.leads}`],
    testToResolve: 'حوّل الاستفسارات المؤهّلة إلى عملاء مسجّلين وتابعها.',
    requiresOwnerInput: false,
  });

  push({
    blocker: 'unclear_offer',
    state: !input.priceVerified ? 'UNKNOWN' : 'INSUFFICIENT_DATA',
    whatWeKnow: [input.priceVerified ? 'السعر موثّق لكن وضوح العرض التجاري يحتاج قياساً.' : 'السعر غير موثّق.'],
    whatWeDontKnow: ['وضوح العرض يحتاج اختبار A/B على صياغة العرض.'],
    evidence: [],
    testToResolve: 'اختبر صياغتين للعرض (واضح مقابل غامض) وقس الاستفسارات.',
    requiresOwnerInput: false,
  });

  push({
    blocker: 'wrong_audience',
    state: 'UNKNOWN',
    whatWeKnow: ['لا سمات جمهور سكانية متاحة عبر الواجهات (لا تُخترع).'],
    whatWeDontKnow: ['هل الجمهور الحالي هو الجمهور المحلي المهتم فعلاً؟'],
    evidence: [],
    testToResolve: 'اختبر محتوى موجّهاً لفئة محلية محددة وقس الاستفسارات.',
    requiresOwnerInput: false,
  });

  return list;
}

export interface SalesReasoningReport {
  productId: string;
  productName: string;
  /** الأسباب المدعومة بدليل، مرتّبة. */
  supportedBlockers: BlockerAssessment[];
  /** الأسباب التي نجهلها (تحتاج بيانات). */
  unknownBlockers: BlockerAssessment[];
  whatWeKnow: string[];
  whatWeDontKnow: string[];
  whatToTest: string[];
  /** ما يحتاج تدخّل المالك. */
  ownerActions: string[];
  /** هل الأدلة كافية لحكم؟ لا ⇒ لا حكم. */
  verdictAvailable: boolean;
  limitations: string[];
  note: string;
}

/**
 * يبني تقرير استدلال كامل: لا يحكم بلا أدلة كافية، ويعرض المجهول صراحةً
 * ويقترح الاختبارات.
 */
export function reasonAboutSales(input: SalesEvidenceInput): SalesReasoningReport {
  const assessments = assessSalesBlockers(input);
  const supported = assessments.filter((a) => a.state === 'SUPPORTED');
  const unknown = assessments.filter((a) => a.state === 'UNKNOWN' || a.state === 'INSUFFICIENT_DATA');
  const verdictAvailable = supported.length > 0 || input.verifiedSales > 0 || input.qualifiedInquiries > 0;

  return {
    productId: input.productId,
    productName: input.productName,
    supportedBlockers: supported,
    unknownBlockers: unknown,
    whatWeKnow: supported.flatMap((a) => a.whatWeKnow),
    whatWeDontKnow: unknown.flatMap((a) => a.whatWeDontKnow),
    whatToTest: assessments.map((a) => a.testToResolve).filter(Boolean),
    ownerActions: assessments.filter((a) => a.requiresOwnerInput).map((a) => a.testToResolve),
    verdictAvailable,
    limitations: [
      'الاستدلال مبني على أدلة حقيقية فقط؛ الأسباب المجهولة تُعلن ولا تُخمَّن.',
      verdictAvailable ? 'يمكن الحكم جزئياً على الأسباب المدعومة.' : 'الأدلة غير كافية لحكم على سبب نقص المبيعات.',
      'لا يُنسب سبب واحد مؤكّد بلا اختبار يحسمه.',
    ],
    note: 'تقرير استدلال صادق: ماذا نعرف/نجهل/نختبر — بلا تخمين سبب.',
  };
}
