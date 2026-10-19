/**
 * مطابقة المنتج المرجّحة بالخصائص (منطق صافٍ قابل للاختبار، بلا شبكة/أسرار/AI).
 *
 * الغرض: العميل يكتب «شارك 50» أو «شاشة 55» أو «أسعد ثلاجات» — لا اسم المنتج
 * الحرفي. المطابقة الحرفية تفشل، فيُصعَّد الطلب أو يُسأل سؤالاً لا داعي له. هنا
 * نستخرج الخصائص (النوع/المقاس/الماركة/الموديل/الميزانية/عدد الأشهر) ونطابق بها
 * المنتجات المسجّلة، فنعيد أفضل تطابق + قائمة مرشحين + ثقة — **بلا اختراع أي سعر
 * أو توفر**: هذه الطبقة تُطابق فقط، والحقائق تبقى من بيانات المنتج المسجّلة.
 *
 * مرادفات الماركات **قاموس مُدار** في مكان واحد: يُوحّد التهجئة العامية للمطابقة
 * فقط (لا يغيّر أي اسم محفوظ ولا يخترع ماركة).
 */

import { normalizeArabicUniform } from './showroomKnowledge';

// ---------------------------------------------------------------------------
// قاموس مرادفات الماركات (مُدار — مصدر واحد).
// ---------------------------------------------------------------------------

/**
 * كل مجموعة: العنصر الأول هو الصيغة القياسية، وباقي العناصر مرادفات عامية/إنجليزية.
 * تُوحَّد كل المرادفات إلى الصيغة القياسية داخل المطابقة فقط.
 */
export const BRAND_SYNONYM_GROUPS: readonly (readonly string[])[] = Object.freeze([
  ['شارب', 'شارك', 'شاب', 'sharp'],
  ['سامسونج', 'سامسونك', 'سامسنغ', 'samsung'],
  ['ال جي', 'الجي', 'ال جي', 'lg'],
  ['سوني', 'سني', 'sony'],
  ['ابل', 'ايفون', 'apple', 'iphone'],
  ['هواوي', 'هوواي', 'huawei'],
  ['شاومي', 'شياومي', 'xiaomi'],
  ['توشيبا', 'toshiba'],
  ['نوكيا', 'nokia'],
  ['ريلمي', 'realme'],
  ['اوبو', 'oppo'],
  ['فيفو', 'vivo'],
  ['كولر', 'cooler'],
  ['بيكو', 'beko'],
  ['هيتاشي', 'hitachi'],
]);

/** خريطة: مرادف مطبَّع ⇒ الصيغة القياسية المطبَّعة. */
const BRAND_CANONICAL: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const group of BRAND_SYNONYM_GROUPS) {
    const canonical = normalizeArabicUniform(group[0]);
    for (const variant of group) {
      const key = normalizeArabicUniform(variant);
      if (key) m.set(key, canonical);
    }
  }
  return m;
})();

/** يوحّد تهجئة الماركات العامية إلى صيغة قياسية (للمطابقة فقط — بلا مساس بالأسعار). */
export function canonicalizeBrands(input: string): string {
  const n = normalizeArabicUniform(input);
  if (!n) return n;
  return n.split(' ').map((token) => BRAND_CANONICAL.get(token) || token).join(' ');
}

/**
 * هل النص يذكر ماركة معروفة (بأي تهجئة)؟ يُعيد الصيغة القياسية أو null.
 * يتحمّل السوابق العربية الشائعة («لشارك»، «بالجوال») بمطابقة كل مرادف كجزء من
 * النص (النوافذ الطويلة/المركّبة)، ومطابقة الكلمات القصيرة كوحدات مستقلة فقط —
 * فلا تنتج ماركة من جزء كلمة عابرة (لا اختراع ماركة).
 */
export function brandFromText(input: string): string | null {
  const n = normalizeArabicUniform(input);
  if (!n) return null;
  const tokens = n.split(' ');
  const tokenSet = new Set(tokens);
  for (const [variant, canonical] of BRAND_CANONICAL) {
    if (!variant) continue;
    if (variant.includes(' ') || variant.length >= 4) {
      if (n.includes(variant)) return canonical;
    } else if (tokenSet.has(variant)) {
      return canonical;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// أنواع الأجهزة (مُدار — مصدر واحد).
// ---------------------------------------------------------------------------

export type DeviceType = 'fridge' | 'tv' | 'washer' | 'phone' | 'ac' | 'cooker' | 'other';

const DEVICE_PATTERNS: ReadonlyArray<{ type: DeviceType; re: RegExp; labelAr: string }> = Object.freeze([
  { type: 'fridge', re: /ثلاج|فريزر|فريجيدير|براد|fridge|freezer/, labelAr: 'ثلاجة' },
  { type: 'tv', re: /شاشه|شاش|تلفزيون|تلفزيون|تلفاز|تي في|tv|television/, labelAr: 'شاشة' },
  { type: 'washer', re: /غساله|غسالات|نشافه|washer|washing/, labelAr: 'غسالة' },
  { type: 'phone', re: /موبايل|تلفون|هاتف|جوال|ايفون|ايباد|phone|mobile/, labelAr: 'موبايل' },
  { type: 'ac', re: /مكيف|سبليت|تكييف|\bac\b|air\s*condition/, labelAr: 'مكيف' },
  { type: 'cooker', re: /طباخ|فرن|غاز|مايكرويف|cooker|oven|microwave/, labelAr: 'طباخ' },
]);

export const DEVICE_TYPE_LABELS_AR: Readonly<Record<DeviceType, string>> = Object.freeze({
  fridge: 'ثلاجة', tv: 'شاشة', washer: 'غسالة', phone: 'موبايل', ac: 'مكيف', cooker: 'طباخ', other: 'جهاز',
});

export function deviceTypeFromText(input: string): DeviceType | null {
  const n = normalizeArabicUniform(input);
  if (!n) return null;
  for (const p of DEVICE_PATTERNS) if (p.re.test(n)) return p.type;
  return null;
}

/** يحوّل الإيموجي/الأرقام العربية ويستخرج وحدات القياس (بوصة/قدم/لتر). */
const ARABIC_DIGITS_RE = /[٠-٩]/g;
function normalizeDigits(input: string): string {
  return String(input ?? '').replace(ARABIC_DIGITS_RE, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * يستخرج المقاس/الحجم من النص: رقم مع وحدة (بوصة/إنش/قدم/لتر)، أو رقم مجرّد
 * بجانب نوع جهاز (مثل «شاشة 55» ⇒ 55 بوصة، «شارب 50» ⇒ 50 بوصة).
 * يعيد { value, unit } أو null. لا يخترع مقاساً غير مذكور.
 */
export function sizeFromText(input: string): { value: number; unit: 'inch' | 'feet' | 'liter' | null } | null {
  const n = normalizeDigits(normalizeArabicUniform(input));
  if (!n) return null;
  const withUnit = n.match(/(\d{1,3})\s*(بوصه|انش|انج|قدم|لتر|liter|inch|feet|ft)/);
  if (withUnit) {
    const value = Number(withUnit[1]);
    const u = withUnit[2];
    const unit = /قدم|feet|ft/.test(u) ? 'feet' : /لتر|liter/.test(u) ? 'liter' : 'inch';
    return Number.isFinite(value) ? { value, unit } : null;
  }
  // رقم مجرّد بجانب نوع جهاز معروف ⇒ يُفترض مقاساً (بوصة للشاشات/الموبايل، قدم للثلاجات).
  // لا `\b` مع العربية (حدّ كلمة غير موثوق)؛ نطابق رقماً محاطاً بمسافات/حدود النص.
  const bare = n.match(/(?:^|\s)(\d{2,3})(?:\s|$)/);
  if (bare) {
    const value = Number(bare[1]);
    if (!Number.isFinite(value) || value < 10 || value > 400) return null;
    const device = deviceTypeFromText(n);
    if (device === 'fridge') return { value, unit: 'feet' };
    if (device === 'tv' || device === 'phone') return { value, unit: 'inch' };
    return { value, unit: null };
  }
  return null;
}

/** يستخرج الميزانية المذكورة (رقم + «الف»/دينار) — بلا اختراع. */
export function budgetFromText(input: string): number | null {
  const n = normalizeDigits(normalizeArabicUniform(input));
  if (!n) return null;
  const m = n.match(/(\d{1,4})\s*(الف|ألف|k\b)?/g);
  if (!m) return null;
  // نلتقط أول رقم يحمل دلالة ميزانية (يسبقه «ميزانيه/بحدود/حوالي/داخل» أو يليه «الف»).
  const ctx = n.match(/(?:ميزانيه|بحدود|حدود|حوالي|داخل|عندي)\s*(\d{1,4})(?:\s*(الف|ألف|k))?/);
  if (ctx) {
    let v = Number(ctx[1]);
    if (/الف|ألف|k/.test(ctx[2] || '')) v *= 1000;
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/** يستخرج عدد أشهر التقسيط المذكور صراحةً (مثال: «10 شهور»). */
export function monthsFromText(input: string): number | null {
  const n = normalizeDigits(normalizeArabicUniform(input));
  if (!n) return null;
  const m = n.match(/(\d{1,2})\s*(شهر|شهور|اشهر)/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v >= 1 && v <= 60 ? v : null;
}

// ---------------------------------------------------------------------------
// استخراج خصائص الاستفسار ومطابقتها بالمنتجات.
// ---------------------------------------------------------------------------

export interface InquiryAttributes {
  deviceType: DeviceType | null;
  size: { value: number; unit: 'inch' | 'feet' | 'liter' | null } | null;
  brand: string | null;
  model: string | null;
  budget: number | null;
  months: number | null;
}

/** يستخرج كل خصائص الاستفسار من نص العميل (حتمي، بلا تخمين). */
export function extractInquiryAttributes(text: string): InquiryAttributes {
  const n = normalizeArabicUniform(text);
  return {
    deviceType: deviceTypeFromText(text),
    size: sizeFromText(text),
    brand: brandFromText(text),
    model: null,
    budget: budgetFromText(text),
    months: monthsFromText(text),
  };
}

export interface ProductAttributes {
  deviceType: DeviceType | null;
  size: { value: number; unit: 'inch' | 'feet' | 'liter' | null } | null;
  brand: string | null;
}

/** يستخرج خصائص منتج مسجّل من اسمه ومواصفاته (لا يخترع أي خاصية). */
export function deriveProductAttributes(product: any): ProductAttributes {
  const hay = [product?.name, ...(Array.isArray(product?.specs) ? product.specs : [])]
    .map((x: any) => String(x ?? '')).join(' ');
  return {
    deviceType: deviceTypeFromText(hay),
    size: sizeFromText(hay),
    brand: brandFromText(hay),
  };
}

export interface ProductMatchResult {
  /** أفضل تطابق واحد موثوق، أو null إن لم يوجد تطابق واضح. */
  best: any | null;
  /** المرشحون مرتّبون بالتنازلي (يُعرض أقرب خيارين عند التعدد). */
  candidates: any[];
  /** درجة الثقة 0..1 للتطابق الأفضل. */
  confidence: number;
  /** هل يوجد تطابق واضح ووحيد (يمكن استخدام سعره)؟ */
  confident: boolean;
}

const WEIGHT_BRAND = 3;
const WEIGHT_DEVICE = 2;
const WEIGHT_SIZE = 3;

/**
 * مطابقة مرجّحة بالخصائص. تعيد الأفضل + المرشحين + الثقة.
 * - `confident` فقط عند وجود تطابق واحد في المقدمة بفارق واضح وبلغ الحد الأدنى.
 * - عند تعدّد المرشحين بدرجات متقاربة لا يُعلن ثقة (يُسأل العميل).
 */
export function matchProducts(attrs: InquiryAttributes, products: readonly any[]): ProductMatchResult {
  const list = Array.isArray(products) ? products : [];
  const scored: Array<{ product: any; score: number; brandHit: boolean; sizeHit: boolean }> = [];
  for (const p of list) {
    if (!p) continue;
    const pa = deriveProductAttributes(p);
    let score = 0;
    const brandHit = Boolean(attrs.brand && pa.brand && attrs.brand === pa.brand);
    const sizeHit = Boolean(attrs.size && pa.size && attrs.size.value === pa.size.value);
    if (brandHit) score += WEIGHT_BRAND;
    if (attrs.deviceType && pa.deviceType && attrs.deviceType === pa.deviceType) score += WEIGHT_DEVICE;
    if (sizeHit) score += WEIGHT_SIZE;
    if (score > 0) scored.push({ product: p, score, brandHit, sizeHit });
  }
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return { best: null, candidates: [], confidence: 0, confident: false };

  const maxScore = WEIGHT_BRAND + WEIGHT_DEVICE + WEIGHT_SIZE;
  const top = scored[0];
  const second = scored[1];
  // تطابق واحد في المقدمة بفارق واضح، أو تطابق واحد فقط أصلاً.
  const uniqueTop = !second || top.score > second.score;
  const confidence = Math.min(1, top.score / maxScore);
  // **لا ثقة بنوع الجهاز وحده**: «ثلاجة» تصف فئة لا منتجاً؛ فحسم سعر منتج بمجرد
  // تطابق الفئة يخترع جواباً عن سؤال «أي ثلاجة؟». الثقة تحتاج إشارة مميّزة
  // (ماركة أو مقاس) مع كونها الأعلى وحدها — وإلا نعرض المرشحين ونسأل.
  const confident = uniqueTop && (top.brandHit || top.sizeHit);
  return {
    best: top.product,
    candidates: scored.slice(0, 3).map((s) => s.product),
    confidence,
    confident,
  };
}

/** هل يمكن ذكر سعر المنتج: لابد من سعر مسجّل موجب. */
export function hasRecordedPrice(product: any): boolean {
  const price = Number(product?.cashPrice);
  return Number.isFinite(price) && price > 0;
}
