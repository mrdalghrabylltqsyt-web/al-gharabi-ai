/**
 * وصف YouTube التسويقي — العقل المركزي لصياغة الوصف.
 *
 * منطق خالص قابل للاختبار (بلا شبكة ولا أسرار). الغرض: تحويل **البيانات الحقيقية
 * فقط** عن المنتج/المعرض إلى وصف تسويقي احترافي موجه للجمهور العراقي، بلا أي
 * اختراع لمعلومة (لا سعر غير مسجّل، لا خصم، لا ضمان، لا رقم تواصل مفقود).
 *
 * الوصف عملية AI فعلية واحدة تمر Central Agent → AiEngine → Gemini Firewall؛
 * البديل الحتمي هنا آمن ويصلح للنشر بلا أي مزود (لا يُسقط النظام).
 *
 * قاعدة مطابقة الوصف بعد النشر: لا نعتبر دورة النشر مُتحقَّقة إن لم يصل الوصف
 * المعتمد إلى YouTube. المقارنة بتطبيع واضح لا يعتمد على تنسيق المزود.
 */

import { normalizeArabic } from './contentSafety';

export interface YouTubeDescriptionProduct {
  name: string;
  category?: string | null;
  /** مواصفات مسجّلة فعلاً في بيانات المعرض. */
  specs?: string[];
  /** خيارات تقسيط مسجّلة فعلاً (نص بلا ادعاء). */
  installmentOptions?: string[];
  /** هل المنتج متوفر فعلاً؟ لا يُدّعى التوفر إن كانت القيمة false. */
  inStock?: boolean | null;
}

export interface YouTubeDescriptionContact {
  phone?: string | null;
  whatsapp?: string | null;
}

export interface YouTubeDescriptionInput {
  product?: YouTubeDescriptionProduct | null;
  showroomName?: string | null;
  tagline?: string | null;
  about?: string | null;
  city?: string | null;
  contact?: YouTubeDescriptionContact | null;
  /** ملاحظات المالك الإضافية (نبرة/تركيز) — لا تُضاف كادعاء. */
  extraInstructions?: string | null;
}

export interface YouTubeDescriptionResult {
  description: string;
  /** هل بنى الوصف من بيانات منتج فعلية أم عاماً؟ */
  basis: 'product' | 'general';
  /** هل أُدرج CTA لبيانات تواصل حقيقية؟ */
  hasContactCta: boolean;
  hashtags: string[];
  factsUsed: string[];
}

const HASHTAG_BY_CATEGORY: Record<string, string[]> = Object.freeze({
  appliances: ['#أجهزة_كهربائية', '#أدوات_منزلية'],
  phones: ['#هواتف', '#موبايلات'],
  construction: ['#مواد_إنشائية', '#بناء'],
  electronics: ['#إلكترونيات', '#تقنية'],
  other: ['#منتجات'],
});

const BASE_HASHTAGS = Object.freeze(['#تقسيط', '#الغرابي', '#العراق', '#بغداد']);

/** يبني وسوماً من التصنيف المسجّل فقط (لا وسم مُختلق). */
export function buildDescriptionHashtags(category?: string | null, extra: string[] = []): string[] {
  const cat = String(category || '').trim().toLowerCase();
  const catTags = HASHTAG_BY_CATEGORY[cat] || HASHTAG_BY_CATEGORY.other;
  const out = [...BASE_HASHTAGS, ...catTags, ...extra.map((h) => String(h || '').trim()).filter(Boolean)];
  return [...new Set(out)];
}

function cleanLine(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * الوصف الحتمي الآمن (بلا مزود): يستخدم فقط الحقائق المُمرَّرة، ولا يذكر أي
 * سعر/خصم/ضمان/توفر لم يُمرَّر. يصلح للنشر المباشر بلا أي استهلاك AI.
 */
export function buildDeterministicYouTubeDescription(input: YouTubeDescriptionInput): YouTubeDescriptionResult {
  const product = input.product || null;
  const name = cleanLine(product?.name, 120);
  const showroom = cleanLine(input.showroomName, 80);
  const tagline = cleanLine(input.tagline, 160);
  const about = cleanLine(input.about, 400);
  const city = cleanLine(input.city, 60);
  const factsUsed: string[] = [];

  const lines: string[] = [];
  if (name) {
    lines.push(showroom ? `${name} — من ${showroom}.` : `${name}.`);
    factsUsed.push('اسم المنتج');
  } else if (showroom) {
    lines.push(`تعريف من ${showroom}.`);
  }

  if (tagline) { lines.push(tagline); factsUsed.push('شعار المعرض'); }
  else if (about) { lines.push(about); factsUsed.push('نبذة المعرض'); }

  const specs = (product?.specs || []).map((s) => cleanLine(s, 200)).filter(Boolean).slice(0, 8);
  if (specs.length) {
    lines.push('أبرز المواصفات:');
    for (const s of specs) lines.push(`• ${s}`);
    factsUsed.push('المواصفات');
  }

  const installments = (product?.installmentOptions || []).map((s) => cleanLine(s, 200)).filter(Boolean).slice(0, 4);
  if (installments.length) {
    lines.push('خيارات التقسيط المتاحة:');
    for (const s of installments) lines.push(`• ${s}`);
    factsUsed.push('خيارات التقسيط');
  } else {
    // بلا أرقام وبلا ادعاءات: دعوة عامة للاستفسار عن التقسيط.
    lines.push('مناسب للتوصيل داخل بغداد والمحافظات، والتقسيط متاح بحسب الخطة المعتمدة لدى المعرض.');
    factsUsed.push('إشارة تقسيط عامة');
  }

  if (city) lines.push(`الموقع: ${city}.`);

  const phone = cleanLine(input.contact?.phone, 40);
  const whatsapp = cleanLine(input.contact?.whatsapp, 40);
  let hasContactCta = false;
  if (phone || whatsapp) {
    const parts: string[] = [];
    if (phone) parts.push(`الهاتف: ${phone}`);
    if (whatsapp) parts.push(`واتساب: ${whatsapp}`);
    lines.push(`للاستفسار والحجز: ${parts.join(' | ')}.`);
    hasContactCta = true;
    factsUsed.push('بيانات تواصل');
  } else {
    lines.push('يسعدنا استقبال استفسارك عبر قنوات المعرض الرسمية.');
  }

  const hashtags = buildDescriptionHashtags(product?.category);
  lines.push(hashtags.join(' '));

  return {
    description: lines.join('\n').trim(),
    basis: name ? 'product' : 'general',
    hasContactCta,
    hashtags,
    factsUsed,
  };
}

/**
 * يبني تعليمات المزود لصياغة وصف YouTube. يمرّر الحقائق كـJSON ويُلزم المزود
 * بعدم اختراع أي معلومة. التعليمات لا تتضمن أي سرّ.
 */
export function buildYouTubeDescriptionPrompt(input: YouTubeDescriptionInput): string {
  const facts = {
    productName: cleanLine(input.product?.name, 120) || null,
    category: cleanLine(input.product?.category, 40) || null,
    specs: (input.product?.specs || []).map((s) => cleanLine(s, 200)).filter(Boolean).slice(0, 12),
    installmentOptions: (input.product?.installmentOptions || []).map((s) => cleanLine(s, 200)).filter(Boolean).slice(0, 6),
    inStock: typeof input.product?.inStock === 'boolean' ? input.product.inStock : null,
    showroomName: cleanLine(input.showroomName, 80) || null,
    tagline: cleanLine(input.tagline, 160) || null,
    about: cleanLine(input.about, 400) || null,
    city: cleanLine(input.city, 60) || null,
    phone: cleanLine(input.contact?.phone, 40) || null,
    whatsapp: cleanLine(input.contact?.whatsapp, 40) || null,
    hashtags: buildDescriptionHashtags(input.product?.category),
  };
  const extra = cleanLine(input.extraInstructions, 400);
  return `أنت مسؤول تسويق محترف في معرض الغرابي للتقسيط في العراق. اكتب **وصف فيديو YouTube** تسويقياً بالعربية الفصحى المبسطة موجه للجمهور العراقي.

المنتج والحقائق المسموحة (استخدمها حصراً — بصيغة JSON):
${JSON.stringify(facts, null, 2)}

قواعد إلزامية:
- لا تختلق أي معلومة غير موجودة في الحقائق أعلاه.
- ممنوع منعاً تاماً ذكر أي سعر أو مبلغ أو خصم أو تخفيض أو عرض أو هدية أو ضمان أو «بدون دفعة أولى» أو شروط تقسيط رقمية أو توفر مخزون، إلا إذا ورد صراحةً في الحقائق.
- لا تذكر أي رقم هاتف أو رابط غير موجود في الحقائق.
- حوّل المواصفات الموثوقة إلى فوائد مفهومة للعميل (لماذا تنفعه)، بنبرة مقنعة بلا مبالغة كاذبة.
- أضف دعوة واضحة للتواصل (CTA) فقط إن وُجد رقم هاتف أو واتساب في الحقائق؛ وإلا فاستخدم دعوة عامة للاستفسار عبر قنوات المعرض الرسمية.
- ضع الوسوم (hashtags) المذكورة في نهاية الوصف كما هي، بلا اختراع وسوم جديدة.
- أعد الوصف كنص عربي صافٍ فقط بلا أي شرح إضافي، بطول بين 3 و10 أسطر.${extra ? `\nملاحظة المالك: ${extra}` : ''}`;
}

/**
 * تطبيع نص الوصف للمقارنة: توحيد المسافات والأسطر والتطبيع العربي، فلا يفشل
 * التحقق بسبب اختلاف تنسيق (سطر/مسافة) لا يغيّر المعنى.
 */
export function normalizeDescriptionForMatch(text: unknown): string {
  return normalizeArabic(String(text ?? '').replace(/\r\n?/g, '\n'))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

export interface DescriptionVerification {
  /** هل كان هناك وصف معتمد غير فارغ يجب أن يصل فعلاً؟ */
  required: boolean;
  /** هل أُثبت وصول الوصف المطلوب؟ */
  verified: boolean;
  code: 'DESCRIPTION_NOT_REQUIRED' | 'DESCRIPTION_CONFIRMED' | 'DESCRIPTION_MISSING' | 'DESCRIPTION_MISMATCH' | 'DESCRIPTION_UNREADABLE';
  expectedLength: number;
  actualLength: number | null;
  note: string;
}

/**
 * يتحقق من وصول الوصف المعتمد إلى YouTube فعلاً.
 * - وصف معتمد فارغ ⇒ لا مطلوب التحقق (لا ادعاء).
 * - وصف معتمد غير فارغ ولم يُقرأ من المزود ⇒ غير مُتحقَّق (لا ادعاء).
 * - وصف معتمد غير فارغ وقُرئ ⇒ يلزم التطابق بعد التطبيع.
 */
export function verifyUploadedDescription(expected: string | null | undefined, actual: string | null | undefined): DescriptionVerification {
  const exp = String(expected ?? '');
  const expectedNorm = normalizeDescriptionForMatch(exp);
  const required = expectedNorm.length > 0;
  if (!required) {
    return { required: false, verified: false, code: 'DESCRIPTION_NOT_REQUIRED', expectedLength: 0, actualLength: actual == null ? null : String(actual).length, note: 'لا يوجد وصف معتمد غير فارغ؛ لا يُدَّعى تحقق وصف.' };
  }
  if (actual == null) {
    return { required: true, verified: false, code: 'DESCRIPTION_UNREADABLE', expectedLength: expectedNorm.length, actualLength: null, note: 'تعذّر قراءة الوصف من YouTube الآن؛ لم يُدَّع وصوله.' };
  }
  const actualNorm = normalizeDescriptionForMatch(actual);
  if (!actualNorm) {
    return { required: true, verified: false, code: 'DESCRIPTION_MISSING', expectedLength: expectedNorm.length, actualLength: 0, note: 'الوصف المعتمد لم يصل إلى YouTube (الوصف الفعلي فارغ).' };
  }
  if (actualNorm !== expectedNorm) {
    return { required: true, verified: false, code: 'DESCRIPTION_MISMATCH', expectedLength: expectedNorm.length, actualLength: actualNorm.length, note: 'الوصف الفعلي على YouTube لا يطابق الوصف المعتمد في النظام.' };
  }
  return { required: true, verified: true, code: 'DESCRIPTION_CONFIRMED', expectedLength: expectedNorm.length, actualLength: actualNorm.length, note: 'أثبت YouTube وصول الوصف المعتمد كما هو.' };
}
