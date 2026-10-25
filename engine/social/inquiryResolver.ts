/**
 * مُحلّل الاستفسار (Inquiry Resolver) — المرحلة 4.
 *
 * يربط معاً: التصنيف الحتمي (comments.ts) + خصائص الاستفسار (productMatch.ts) +
 * قاعدة معرفة المعرض (showroomKnowledge.ts) + محرّك الردود/التوضيح (replyDialogue.ts)،
 * فيُنتج قراراً واحداً صريحاً لكل استفسار:
 *   - `answer`         : جواب نهائي من بيانات مسجّلة (سعر/قسط/موقع/دوام/سياسة).
 *   - `product_choice` : تعدّدت المطابقات ⇒ اعرض أقرب خيارين واسأل الزبون.
 *   - `clarify`        : نقص معلومة أساسية ⇒ سؤال توضيحي واحد موجّه.
 *   - `escalate`       : غير مسجّل (ضمان/سياسة غير موثّقة) ⇒ «سأتأكد وأرجعلك» + المالك.
 *
 * المبادئ الملزمة:
 * - منطق صافٍ: لا شبكة ولا أسرار ولا ساعة ولا استدعاء أي مزود.
 * - لا اختراع: أي رقم/مدة/شرط يأتي من بيانات مسجّلة فقط؛ غيابها ⇒ سؤال أو تصعيد.
 * - النص المسجّل (سياسة/سؤال شائع) يُستخدم حرفياً بلا إعادة صياغة.
 * - الضمان لا يُجاب في هذا الإصدار — يُحوَّل للمالك دائماً بلا ذكر أي مدة.
 */

import { generateReply, asksInstallmentAvailability, isOffTopic, type ClassifiedComment, type ReplyFactSet, type ReplyContext } from './comments';
import { generateConversationalReply, type DialogueContext } from './replyDialogue';
import {
  extractInquiryAttributes, matchProducts, type InquiryAttributes,
} from './productMatch';

/** جواب مسجّل من قاعدة المعرفة (نصّ حرفي) مع موضوعه. */
export interface ResolvedKnowledge {
  answer: string;
  topic: string;
}

export interface ResolveInquiryInput {
  /** التصنيف الحتمي لنص العميل. */
  classification: ClassifiedComment;
  /** نص العميل الخام. */
  text: string;
  /** منتج مرتبط بمنشور بدليل صريح (أولوية على المطابقة بالخصائص)، أو null. */
  postProduct?: any | null;
  /** كل منتجات المعرض المسجّلة (للمطابقة المرجّحة). */
  products?: readonly any[];
  /** جواب مسجّل من قاعدة المعرفة لموضوع السؤال (أو null). */
  knowledge?: ResolvedKnowledge | null;
  /** حقائق الرد الأساسية (سعر/قسط/موقع/دوام/توفر) لمنتج محدّد. */
  productFacts?: ReplyFactSet;
  /**
   * يبني حقائق الرد (ReplyFactSet) لمنتج **طابقته الخصائص** (لا يمرّره المستدعي).
   * يُحقن من الخادم فيبقى الحساب (السعر/القسط) في مصدره الواحد، والمُحلّل بلا منطق أسعار.
   * عند غيابه يسقط المُحلّل لقراءة الحقول المسجّلة على المنتج مباشرةً (بلا اختراع).
   */
  buildProductFacts?: (product: any) => ReplyFactSet;
  /** مدة التقسيط المسجّلة نصاً (مثال «10 أشهر») إن وُجدت. */
  installmentMonthsText?: string;
  /** نص المسودة السابقة/السياق (لمنع التكرار الميكانيكي + حدّ جولات التوضيح). */
  context?: DialogueContext;
}

export type ResolveInquiryKind = 'answer' | 'product_choice' | 'clarify' | 'escalate';

export interface ResolveInquiryResult {
  kind: ResolveInquiryKind;
  text: string;
  /** استراتيجية الرد (للتشخيص). */
  strategy: string;
  /** الحقائق المستخدمة فعلاً في النص (price/installment/location/hours/knowledge...). */
  usedFacts: string[];
  /** هل يحتاج معلومة غير مسجّلة (لم يخترعها)؟ */
  needsInfo: boolean;
  /** هل يُصعَّد للمالك؟ */
  escalate: boolean;
  /** تعليل عربي صريح. */
  reason: string;
  /** المنتج المطابق الموثوق (أو null). */
  product: any | null;
  /** المرشحون عند التعدّد (للعرض). */
  candidates: any[];
  /** ثقة المطابقة 0..1. */
  confidence: number;
  /** خصائص الاستفسار المستخرجة (تشخيص). */
  attributes: InquiryAttributes;
}

/**
 * موضوعات السياسات/الأسئلة التي تُجاب من قاعدة المعرفة. **بلا `location`/`hours`**:
 * العنوان والدوام يُجابان حرفياً من حقول المعرض المسجّلة (`f.locationText`/`f.hoursText`)
 * عبر محرّك الردود — فلا تكرار ولا مساس بصيغة القاعدة الحالية.
 */
const KNOWLEDGE_TOPICS = new Set(['delivery', 'installment_terms', 'installment', 'contact']);

/** منتج مرتبط بمنشور وله سعر مسجّل ⇒ يُعتمد مباشرة (دليل صريح). */
function usablePostProduct(product: any | null | undefined): any | null {
  const price = Number(product?.cashPrice);
  return product && Number.isFinite(price) && price > 0 ? product : null;
}

/**
 * هل تحمل الحقائق المحقونة قيمة **مسجّلة** تخصّ موضوع السؤال؟ يمنع اختراعاً
 * ويثبّت عقد «الحقائق المسجّلة تُذكر كما هي» في مسار التصنيف (الذي يزوّد الحقائق
 * مباشرةً بلا منتج مطابق).
 */
function factsHaveTopicValue(topic: string, f: ReplyFactSet): boolean {
  switch (topic) {
    case 'price': return Boolean(f.priceText);
    case 'location': return Boolean(f.locationText);
    case 'hours': return Boolean(f.hoursText);
    case 'availability': return f.inStock === true || f.inStock === false;
    case 'delivery':
    case 'installment_terms': return Boolean(f.knowledgeAnswer);
    case 'installment': return Boolean(f.knowledgeAnswer) || Boolean(f.installmentMonthsText);
    default: return false;
  }
}

/** يبني سؤال اختيار بين أقرب خيارين عند تعدّد المطابقات (بلا اختراع سعر). */
export function buildProductChoiceReply(candidates: readonly any[]): string {
  const names = candidates.slice(0, 2).map((p) => String(p?.name || '').trim()).filter(Boolean);
  if (names.length < 2) {
    return 'هلا وغلا 🌸 خبرني أي موديل بالضبط تقصد وأنا أعطيك التفاصيل.';
  }
  return `هلا وغلا 🌸 عندنا أكثر من خيار: ${names[0]} أو ${names[1]}؟ خبرني أي واحد تقصد وأحسبلك التفاصيل.`;
}

/** يبني سؤال توضيحي موجّهاً حسب الخصائص الناقصة (النوع/المقاس/الماركة/الميزانية). */
export function buildAttributeClarifyReply(attrs: InquiryAttributes, topic: string): string {
  const asks: string[] = [];
  if (!attrs.brand) asks.push('الماركة');
  if (!attrs.size) asks.push(topic === 'tv' ? 'المقاس (كم بوصة)' : 'المقاس أو الحجم');
  if (!attrs.budget) asks.push('الميزانية');
  const list = asks.slice(0, 2).join(' و');
  if (topic === 'price' || topic === 'installment') {
    return list
      ? `هلا وغلا 🌸 تدلل، خبرني ${list} حتى أعطيك السعر والقسط الأدق.`
      : 'هلا وغلا 🌸 خبرني أي موديل بالضبط تقصد وأنا أحسبلك السعر والقسط.';
  }
  return list
    ? `هلا وغلا 🌸 وضّحلي ${list} وأنا أساعدك بالتفاصيل.`
    : 'هلا وغلا 🌸 وضّحلي شنو تحتاج بالضبط وأنا أساعدك.';
}

/**
 * يحلّ استفساراً واحداً إلى قرار صريح. الأولوية:
 *  1) سبام/حساس ⇒ لا رد آلي (تصعيد/تجاهل) عبر محرّك الردود.
 *  2) الضمان ⇒ تصعيد للمالك دائماً (بلا مدة).
 *  3) جواب مسجّل من قاعدة المعرفة (نصّ حرفي) ⇒ جواب نهائي.
 *  4) منتج موثوق (مرتبط أو مطابقة واثقة) ⇒ جواب من بياناته.
 *  5) تعدّدت المطابقات ⇒ سؤال اختيار.
 *  6) نقص معلومة ⇒ سؤال توضيحي موجّه بالخصائص.
 *  7) غير ذلك ⇒ محرّك الحوار الحتمي (سؤال/تصعيد حسب الحالة).
 */
/**
 * فحص الشاشات (2026-10-25 #3): «شو سعر، وين بالضبط، باي محافظة؟» سؤالان في رسالة واحدة
 * (سعر + موقع). المصنّف يختار موضوعاً واحداً (السعر) فيُهمل الموقع، فيُسأل الزبون عن
 * الماركة ولا يُعطى العنوان رغم أنه مسجّل. يُكشف طلب الموقع المرافق هنا.
 */
const LOCATION_ASK_RE = /(^|\s)(?:و|ف|ب)?(وين|وين ما|منين|عنوان|العنوان|عنوانكم|موقع|موقعكم|مكان|مكانكم|محافظ|محافظه|اي محافظه|فرع|فروع|لوكيشن|location|address)(\s|$|[؟?،,.])/;
export function asksLocationToo(text: string): boolean {
  const t = String(text || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
  return LOCATION_ASK_RE.test(` ${t} `);
}

export function resolveInquiry(input: ResolveInquiryInput): ResolveInquiryResult {
  const r = resolveInquiryCore(input);
  // الموقع المسجّل يُضاف عندما يسأل الزبون عنه مع سؤال آخر ولم يتضمنه الرد — نصّاً
  // حرفياً من بيانات المعرض (عنوان + دوام + هاتف)، بلا اختراع. لا يُضاف للتصعيد/السبام.
  const f = input.productFacts || {};
  if (f.locationText && r.kind !== 'escalate' && !r.usedFacts.includes('location')
    && !input.classification.isSpam && !input.classification.requiresHumanReview
    && asksLocationToo(input.text)) {
    const parts: string[] = [`موقعنا: ${String(f.locationText).replace(/[.،\s]+$/, '')}`];
    if (f.hoursText) parts.push(`والدوام ${String(f.hoursText).replace(/[.،\s]+$/, '')}`);
    const body = r.text.replace(/\s*🌸\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const opener = /^(هلا وغلا|تدلل|حياك الله|نورتنا|من عيوني)[ ،,]*/.exec(body);
    const rest = opener ? body.slice(opener[0].length) : body;
    const text = `${opener ? opener[1] : 'هلا وغلا'} 🌸 ${parts.join('، ')}. ${rest}`.replace(/\s+/g, ' ').trim();
    return { ...r, text, usedFacts: [...r.usedFacts, 'location', ...(f.hoursText ? ['hours'] : [])], reason: `${r.reason} + طلب موقع مرافق ⇒ أُضيف العنوان المسجّل.` };
  }
  return r;
}

function resolveInquiryCore(input: ResolveInquiryInput): ResolveInquiryResult {
  const cls = input.classification;
  const attrs = extractInquiryAttributes(input.text);
  const facts: ReplyFactSet = { ...(input.productFacts || {}) };
  if (input.installmentMonthsText) facts.installmentMonthsText = input.installmentMonthsText;
  if (input.knowledge?.answer) {
    facts.knowledgeAnswer = input.knowledge.answer;
    facts.knowledgeTopic = input.knowledge.topic;
  }
  const replyCtx: ReplyContext = { videoTitle: input.context?.subjectTitle, previousReplies: input.context?.previousReplies };

  // الجواب المسجّل يُجاب به فقط إن كان موضوعه يطابق موضوع التصنيف (أو التصنيف عام)
  // — فيمنع خطأً خفيّاً: سؤال سعر لا يُجاب عنه بنص سياسة مسجّل، والعكس.
  // الأسئلة الشائعة (وسم خارج الموضوعات المعروفة) تُقبل فقط حين يكون التصنيف عاماً،
  // فلا تختطف سؤالاً مصنَّفاً بوضوح (سعر/توفر/ضمان).
  const knowledgeTopic = String(input.knowledge?.topic || '');
  const knownKnowledgeTopic = KNOWLEDGE_TOPICS.has(knowledgeTopic);
  const knowledgeMatchesTopic = Boolean(input.knowledge?.answer)
    && (knownKnowledgeTopic
      ? (cls.topic === 'general' || cls.topic === knowledgeTopic)
      : cls.topic === 'general');

  const base = (kind: ResolveInquiryKind, text: string, strategy: string, reason: string, extra: Partial<ResolveInquiryResult> = {}): ResolveInquiryResult => ({
    kind, text, strategy, usedFacts: [], needsInfo: kind === 'clarify', escalate: kind === 'escalate',
    reason, product: null, candidates: [], confidence: 0, attributes: attrs, ...extra,
  });

  // 1) سبام/شكوى/حساس: يبقى القرار لمحرّك الردود (تصعيد/لا رد).
  if (cls.isSpam || cls.requiresHumanReview || cls.intent === 'complaint') {
    const g = generateReply(cls, facts, replyCtx);
    return base(g.escalate ? 'escalate' : 'answer', g.text, g.strategy, g.reason, { usedFacts: g.usedFacts, escalate: g.escalate, needsInfo: g.needsInfo });
  }

  // 1ب) سؤال خارج نطاق المعرض (رياضة/سياسة/أخبار/ترفيه...): اعتذار وإعادة توجيه.
  //     يُفحص **قبل** أي مسار سعر/منتج، لأن كلمات مثل «شكد» قد تُصنَّف استفساراً
  //     تجارياً خطأً فتُسأل عنه أسئلة منتج لا معنى لها.
  if (isOffTopic(input.text)) {
    const g = generateReply(cls, facts, replyCtx);
    return base('answer', g.text, g.strategy, g.reason, { usedFacts: g.usedFacts });
  }

  // 2) الضمان: تصعيد للمالك دائماً (لا مدة ولا رقم) — بلا سؤال توضيحي.
  if (cls.topic === 'warranty') {
    const g = generateReply(cls, facts, replyCtx);
    return base('escalate', g.text, g.strategy, g.reason, { usedFacts: g.usedFacts, escalate: true, needsInfo: true });
  }

  // 3) جواب مسجّل من قاعدة المعرفة ⇒ يُعاد **حرفياً** كما هو (لا إعادة صياغة، ولا
  //    تغيير أي رقم). هذا يثبّت عقد «الأرقام من القاعدة فقط».
  //    استثناء: سؤال «في تقسيط؟» يُجاب أولاً بـ«نعم» + المدة المسجّلة + دعوة
  //    للتفاصيل (طلب المالك) — فلا يختطفه نص السياسة المسجّل.
  if (asksInstallmentAvailability(input.text)) {
    const g = generateReply(cls, facts, replyCtx);
    return base('answer', g.text, g.strategy, g.reason, { usedFacts: g.usedFacts });
  }
  if (knowledgeMatchesTopic) {
    return base('answer', String(input.knowledge!.answer), 'knowledge_recorded',
      'جواب مسجّل حرفياً من قاعدة معرفة المعرض ⇒ يُستخدم كما هو بلا أي تغيير في الأرقام.',
      { usedFacts: ['knowledge'] });
  }

  const isInquiry = cls.intent === 'business_inquiry' || cls.intent === 'question' || cls.isBusinessInquiry || cls.isQuestion;

  // 4) حسم المنتج: مرتبط بمنشور (دليل) ← وإلا مطابقة مرجّحة بالخصائص.
  const postProduct = usablePostProduct(input.postProduct);
  let product: any | null = postProduct;
  let candidates: any[] = [];
  let confidence = 0;
  if (!product && isInquiry) {
    const m = matchProducts(attrs, input.products || []);
    candidates = m.candidates;
    confidence = m.confidence;
    if (m.confident && m.best) product = m.best;
  }

  // الموضوع الفعّال: عند مطابقة منتج واضح على سؤال عام/غير معرّف الموضوع، نستنتج
  // الموضوع من **خصائص المنتج المطابق** (سؤال عن سعر جهاز) — لا نبقى «عاماً» فنضيع
  // الجواب. عند غياب منتج مطابق يبقى الموضوع كما صنّفه المحرّك (لا تخمين).
  const effectiveTopic = (cls.topic === 'general' && product) ? 'price' : cls.topic;

  // 4أ) منتج موثوق ⇒ جواب من بياناته (السعر/القسط/التوفر). حقائقه تُبنى من المنتج
  //     المطابق عبر الباني المحقون (مصدر الحساب الواحد) وإلا من حقول المنتج المسجّلة.
  if (product) {
    const price = Number(product?.cashPrice);
    if (Number.isFinite(price) && price > 0) {
      const built = input.buildProductFacts ? input.buildProductFacts(product) : {};
      const productFacts: ReplyFactSet = {
        ...facts,
        ...built,
        productName: product.name ? String(product.name) : facts.productName,
        priceText: built.priceText || `${Math.round(price).toLocaleString('en-US')} د.ع`,
        inStock: typeof product?.inStock === 'boolean' ? product.inStock : facts.inStock ?? null,
      };
      const g = generateReply({ ...cls, topic: effectiveTopic } as ClassifiedComment, productFacts, replyCtx);
      return base('answer', g.text, g.strategy, g.reason, { usedFacts: g.usedFacts, product, candidates, confidence });
    }
  }

  // 4ب) لا منتج مطابق، لكن الحقائق المحقونة تحمل القيمة المسجّلة للموضوع (سياق
  //     المستدعي الذي يزوّد الحقائق مباشرةً — مثل مسار التصنيف) ⇒ جواب من الحقائق
  //     بلا اختراع. يحفظ العقد السابق: الحقائق المسجّلة تُذكر كما هي.
  if (factsHaveTopicValue(cls.topic, facts)) {
    const g = generateReply(cls, facts, replyCtx);
    return base('answer', g.text, g.strategy, g.reason, { usedFacts: g.usedFacts, candidates, confidence });
  }

  // 5) استفسار بلا أي سمة مميّزة (لا ماركة ولا مقاس ولا ميزانية) ⇒ اسأل سؤالاً
  //    موجّهاً واحداً عن الميزانية/النوع/المقاس بدل عرض خيارين عشوائيين.
  const noDistinguishing = !attrs.brand && !attrs.size && !attrs.budget;
  if (isInquiry && noDistinguishing && (effectiveTopic === 'price' || effectiveTopic === 'availability' || effectiveTopic === 'installment' || effectiveTopic === 'general')) {
    const text = buildAttributeClarifyReply(attrs, effectiveTopic);
    return base('clarify', text, 'attribute_clarify', 'استفسار بلا سمة مميّزة ⇒ سؤال توضيحي واحد (النوع/المقاس/الميزانية) بلا اختراع رقم.', { candidates, confidence });
  }

  // 6) تعدّدت المطابقات بثقة غير حاسمة ⇒ اعرض أقرب خيارين واسأل الزبون.
  if (isInquiry && candidates.length >= 2) {
    const text = buildProductChoiceReply(candidates);
    return base('product_choice', text, 'product_choice', 'تعدّدت المطابقات بثقة غير حاسمة ⇒ يُعرض أقرب خيارين ويُسأل الزبون (لا يُخترع سعر).', { candidates, confidence, needsInfo: true });
  }

  // 6ب) سؤال سعر/قسط/توفر بمنتج غير حاسم ⇒ سؤال توضيحي موجّه بالخصائص.
  if (isInquiry && (effectiveTopic === 'price' || effectiveTopic === 'availability' || effectiveTopic === 'installment')) {
    const text = buildAttributeClarifyReply(attrs, effectiveTopic);
    return base('clarify', text, 'attribute_clarify', 'استفسار بلا منتج محدّد ⇒ سؤال توضيحي واحد موجّه (الماركة/المقاس/الميزانية) بلا اختراع رقم.', { candidates, confidence });
  }

  // 7) غير ذلك ⇒ محرّك الحوار الحتمي (سؤال/تصعيد/رد عام حسب الحالة والسياق).
  const conv = generateConversationalReply(cls, facts, input.context || {});
  const kind: ResolveInquiryKind = conv.escalate ? 'escalate' : conv.clarifying ? 'clarify' : 'answer';
  return base(kind, conv.text, conv.strategy, conv.reason, { usedFacts: conv.usedFacts, candidates, confidence, escalate: conv.escalate, needsInfo: conv.needsInfo });
}
