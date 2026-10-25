/**
 * حسم المنتج لتفاعل زبون — مصدر واحد يقرؤه العقل المركزي ومولّد الرد معاً.
 *
 * الجذر (فحص 2026-10-25): بوابة العقل المركزي (هل يُصعَّد استفسار السعر؟) كانت تحسم
 * المنتج من **ربط صريح للمنشور فقط** (productId على المنشور/سجل النشر/الطابور). أغلب
 * المنشورات أُنشئت بلا ربط، فكل «شكد سعرها؟» على منشور «غسالة رويال رحماني» يُصعَّد
 * `price_unverified` إلى المالك — رغم أن المنتج وسعره وقسطه موجودة في مخزن المنتجات،
 * ورغم أن مولّد الرد قادر على مطابقته. فالعقل يقول «لا أعرف» والمخزن يعرف.
 *
 * الترتيب (أقوى دليل أولاً، وكل خطوة صارمة لا تخمين):
 *  1) `lead`       — منتج اهتمام مسجّل للزبون.
 *  2) `post_link`  — منتج مربوط صراحةً بالمنشور (السلوك السابق كما هو).
 *  3) `post_text`  — نص المنشور/عنوان الفيديو **يسمّي** منتجاً واحداً: اسمه كاملاً
 *                    فيه، أو كل كلمات اسمه المميّزة موجودة فيه ولا يشاركه منتج آخر.
 *  4) `comment_text` — نص الزبون يسمّي منتجاً واحداً بنفس القاعدة، أو مطابقة خصائص
 *                    حاسمة وحيدة (ماركة/نوع/مقاس) من محرّك المطابقة القائم.
 * أي تعدّد/غموض ⇒ null (فيُسأل الزبون أو يُصعَّد كما كان). منتج بلا سعر نقدي مسجّل
 * لا يُعتمد (لا اختراع سعر). منطق صافٍ بلا شبكة ولا أسرار.
 */
import { normalizeArabicUniform, tokenizeArabic } from './showroomKnowledge';
import { canonicalizeBrands, extractInquiryAttributes, matchProducts, deriveProductAttributes } from './productMatch';

export type ProductResolutionVia = 'lead' | 'post_link' | 'post_text' | 'comment_text' | null;

export interface ProductResolution {
  product: any | null;
  via: ProductResolutionVia;
  /** تعليل عربي قصير (للتدقيق والعرض للمالك). */
  reason: string;
}

function priced(p: any): boolean {
  const n = Number(p?.cashPrice);
  return Boolean(p) && Number.isFinite(n) && n > 0;
}

/** كلمات اسم المنتج المميّزة (بعد توحيد الماركات والتطبيع). */
function nameTokens(name: string): string[] {
  return tokenizeArabic(canonicalizeBrands(name));
}

/**
 * هل يسمّي النص منتجاً واحداً بعينه؟
 *  أ) الاسم كاملاً داخل النص (الأطول يفوز).
 *  ب) كل كلمات الاسم المميّزة (≥ 2) موجودة في النص، والمرشح وحيد بهذه الدرجة.
 */
export function productNamedInText(text: string, products: readonly any[]): any | null {
  const hay = canonicalizeBrands(String(text || ''));
  if (!hay) return null;
  const list = (Array.isArray(products) ? products : []).filter(priced);
  // أ) اسم كامل.
  let best: any | null = null; let bestLen = 0; let tie = false;
  for (const p of list) {
    const name = canonicalizeBrands(String(p?.name || ''));
    if (name.length < 3 || !hay.includes(name)) continue;
    if (name.length > bestLen) { best = p; bestLen = name.length; tie = false; }
    else if (name.length === bestLen && String(p?.id) !== String(best?.id)) tie = true;
  }
  if (best && !tie) return best;
  // ب) كل كلمات الاسم موجودة (ترتيب حر)، ووحيد.
  const hayTokens = new Set(normalizeArabicUniform(hay).split(' '));
  const full = list.filter((p) => {
    const toks = nameTokens(String(p?.name || ''));
    return toks.length >= 2 && toks.every((t) => hayTokens.has(t));
  });
  if (full.length === 1) return full[0];
  if (full.length > 1) {
    // الأكثر تحديداً (أطول قائمة كلمات) إن كان وحيداً بها.
    const maxLen = Math.max(...full.map((p) => nameTokens(String(p.name)).length));
    const top = full.filter((p) => nameTokens(String(p.name)).length === maxLen);
    if (top.length === 1) return top[0];
  }
  return null;
}

/** هل يذكر الزبون نوع جهاز أو ماركة **مختلفة** عن المنتج؟ (ذكر نفسها أو لا شيء ⇒ لا تعارض) */
export function conflictsWithComment(product: any, commentText: string): boolean {
  const a = extractInquiryAttributes(String(commentText || ''));
  const pa = deriveProductAttributes(product);
  if (a.deviceType && pa.deviceType && a.deviceType !== pa.deviceType) return true;
  if (a.brand && pa.brand && a.brand !== pa.brand) return true;
  return false;
}

export function resolveInteractionProduct(input: {
  products: readonly any[];
  leadProductId?: string | null;
  postLinkedProduct?: any | null;
  postText?: string | null;
  commentText?: string | null;
}): ProductResolution {
  const products = Array.isArray(input.products) ? input.products : [];
  if (input.leadProductId) {
    const p = products.find((x: any) => String(x?.id) === String(input.leadProductId));
    if (priced(p)) return { product: p, via: 'lead', reason: 'منتج اهتمام مسجّل للزبون.' };
  }
  if (priced(input.postLinkedProduct)) {
    return { product: input.postLinkedProduct, via: 'post_link', reason: 'منتج مربوط صراحةً بالمنشور.' };
  }
  const comment = String(input.commentText || '');
  const fromPost = input.postText ? productNamedInText(input.postText, products) : null;
  // حارس التعارض: زبون على منشور ثلاجة يسأل «سعر التلفزيون؟» لا يُعطى سعر الثلاجة.
  if (fromPost && !conflictsWithComment(fromPost, comment)) {
    return { product: fromPost, via: 'post_text', reason: 'نص المنشور يسمّي هذا المنتج من المخزن.' };
  }
  if (comment) {
    const named = productNamedInText(comment, products);
    if (named) return { product: named, via: 'comment_text', reason: 'الزبون سمّى المنتج باسمه.' };
    const m = matchProducts(extractInquiryAttributes(comment), products.filter(priced));
    if (m.confident && priced(m.best)) return { product: m.best, via: 'comment_text', reason: 'مطابقة خصائص حاسمة وحيدة (ماركة/نوع/مقاس).' };
  }
  return { product: null, via: null, reason: 'لا دليل كافٍ على منتج واحد — يُسأل الزبون أو يُصعَّد بلا اختراع.' };
}

/** نص حقيقة المنتج للعقل والعقول المساعدة (بيانات المخزن فقط). */
export function productFactStatement(product: any, facts: { priceText?: string | null; installmentText?: string | null; inStock?: boolean | null }): string {
  const parts = [`المنتج: ${String(product?.name || '').trim()}`];
  if (facts.priceText) parts.push(`السعر: ${facts.priceText}`);
  if (facts.installmentText) parts.push(`القسط: ${facts.installmentText}`);
  if (facts.inStock === true) parts.push('متوفر');
  else if (facts.inStock === false) parts.push('غير متوفر حالياً');
  return parts.join(' — ');
}
