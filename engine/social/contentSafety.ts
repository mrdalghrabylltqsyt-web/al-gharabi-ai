/**
 * بوابة سلامة المحتوى التجاري.
 *
 * سبب الوجود: حارس النص القديم كان يمنع مجال السيارات والعداد الموروث فقط.
 * لكن أي نص يولّده مزود ذكاء اصطناعي يمكن أن «يخترع» عرضاً تجارياً غير موجود
 * في بيانات المعرض: بدون دفعة أولى، خصم، ضمان، توصيل مجاني، رقم هاتف، رابط،
 * توفر مخزون… وهذا مخالف لقواعد المشروع (لا بيانات وهمية، لا ادعاء غير مثبت).
 *
 * لذلك يوجد حارسان:
 *  1) حارس المدخلات: يمنع **طلب** عرض غير مسجّل قبل أي استدعاء للمزود.
 *  2) حارس المخارج: يفحص النص بعد التوليد (سواء من Gemini أو من البديل
 *     الحتمي) ويوسم أو يحجب أي ادعاء غير مدعوم ببيانات المعرض.
 *
 * المنطق خالص وحتمي بالكامل: لا شبكة، ولا مزود، ولا استهلاك حصة.
 */

export interface BusinessFacts {
  /** أسعار كاش مسجّلة فعلاً في قاعدة بيانات المعرض. */
  cashPrices: number[];
  /**
   * مبالغ مشتقة رياضياً من السعر المسجّل وخطة التقسيط المسجّلة (دفعة أولى،
   * قسط شهري، إجمالي الأقساط). مشروعة لأنها محسوبة من بيانات حقيقية، لا مُختلقة.
   */
  derivedAmounts: number[];
  /** قيم الدفعة الأولى المسموحة فعلاً (بالنسبة المئوية) لمنتجات هذا السياق. */
  downPaymentPercents: number[];
  /** أرقام تواصل مسجّلة فعلاً في بيانات المعرض. */
  phones: string[];
  /** روابط مسجّلة فعلاً (صورة المنتج، البايو…) — لا شيء افتراضي. */
  urls: string[];
  /** هل المنتج متوفر فعلاً في المخزون؟ */
  inStock: boolean | null;
  /** هل توجد عبارات عروض/تخفيضات معتمدة في بيانات المعرض؟ */
  hasRecordedPromotion: boolean;
  /** نصوص مسجّلة في بيانات المعرض يمكن الاعتماد عليها (سياسات، مزايا…). */
  allowedPhrases: string[];
}

export type BusinessClaimSeverity = 'block' | 'warn';

export interface BusinessClaimViolation {
  /** رمز ثابت للفحص الآلي. */
  code: string;
  severity: BusinessClaimSeverity;
  /** وصف عربي واضح يظهر للمستخدم، بلا كشف أي سر. */
  detail: string;
  /** المقتطف المخالف بعد التطبيع (بلا بيانات حساسة). */
  excerpt: string;
}

export interface BusinessClaimReport {
  /** هل النص صالح للنشر الداخلي (لا يوجد ادعاء حاجب)؟ */
  safe: boolean;
  violations: BusinessClaimViolation[];
  blocked: BusinessClaimViolation[];
  warnings: BusinessClaimViolation[];
}

/** أنماط الأرقام: عربية-هندية ولاتينية على حد سواء. */
const ARABIC_DIGITS = /[٠-٩]/g;
const ARABIC_INDIC_ZERO = 0x0660;

function normalizeDigits(input: string): string {
  return input.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - ARABIC_INDIC_ZERO));
}

/** تطبيع النص: توحيد المسافات وتوحيد الألف والهمزات والتاء المربوطة لتفادي تجاوز الحراس بالتهجئة. */
export function normalizeArabic(input: string): string {
  return normalizeDigits(String(input ?? ''))
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    // توحيد التاء المربوطة مع الهاء: «دفعة» و«دفعه» صيغتان لنفس الكلمة، ولا يجوز
    // أن تتجاوز إحداهما الحارس بينما تُحجب الأخرى.
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

/** يحوّل الأرقام إلى قائمة موجبة صالحة. */
function positiveNumbers(values: (number | string | null | undefined)[]): number[] {
  const out: number[] = [];
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/**
 * يبني حقائق تجارية من بيانات المعرض الحقيقية فقط.
 * أي حقل غائب يبقى غائباً (لا قيمة افتراضية)، وهذا جوهر منع الاختراع.
 */
export function buildBusinessFacts(input: {
  cashPrices?: (number | string | null | undefined)[];
  derivedAmounts?: (number | string | null | undefined)[];
  downPaymentPercents?: (number | string | null | undefined)[];
  phones?: (string | null | undefined)[];
  urls?: (string | null | undefined)[];
  inStock?: boolean | null;
  promotions?: (string | null | undefined)[];
  allowedPhrases?: (string | null | undefined)[];
}): BusinessFacts {
  return {
    cashPrices: positiveNumbers(input.cashPrices || []),
    derivedAmounts: positiveNumbers(input.derivedAmounts || []),
    downPaymentPercents: positiveNumbers(input.downPaymentPercents || []),
    phones: (input.phones || []).map((p) => String(p ?? '').trim()).filter(Boolean),
    urls: (input.urls || []).map((u) => String(u ?? '').trim()).filter(Boolean),
    inStock: typeof input.inStock === 'boolean' ? input.inStock : null,
    hasRecordedPromotion: (input.promotions || []).some((p) => String(p ?? '').trim().length > 0),
    allowedPhrases: (input.allowedPhrases || []).map((p) => String(p ?? '').trim()).filter(Boolean),
  };
}

/**
 * استخراج أرقام مبالغ مرشّحة من نص عربي/إنجليزي.
 * يشمل "1,250,000 د.ع" و"1250000 دينار" و"250 الف".
 *
 * لا يُعدّ كل رقم مبلغاً: رقم بلا عملة يُقبل فقط إن كان ≥ 10,000 (نطاق أسعار
 * الدينار العراقي)، حتى لا تُحجب سنوات مثل 2026 أو أرقام فواصل الفيديو.
 */
export function extractMoneyCandidates(text: string): number[] {
  const normalized = normalizeDigits(text).replace(/[،,]/g, '');
  const out: number[] = [];
  const re = /(\d{3,9})\s*(د\.?\s*ع|دينار|الف|ألف|\bk\b)?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalized)) !== null) {
    const raw = match[1];
    const suffix = (match[2] || '').replace(/\s/g, '');
    const hasCurrencySuffix = /د\.?ع|دينار|الف|ألف|k/i.test(suffix);
    let value = Number(raw);
    if (Number.isFinite(value) && /الف|ألف|k/i.test(suffix)) value *= 1000;
    if (!Number.isFinite(value)) continue;
    if (hasCurrencySuffix ? value >= 1000 : value >= 10_000) out.push(value);
  }
  return out;
}

/**
 * يستخرج أرقام الهاتف المرشّحة من النص.
 *
 * الشرط: الرقم يجب أن يبدأ بـ0 أو + أو 964 أو 00964. هذا يمنع اعتبار مبلغ
 * مثل 1250000 «رقم هاتف» فيُحجب محتوى سليم، ويُبقي الكشف دقيقاً.
 */
export function extractPhoneCandidates(text: string): string[] {
  const normalized = normalizeDigits(text);
  const out = new Set<string>();
  const re = /(?:\+|00)?(?:964|0)\d[\d\s-]{5,}\d/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalized)) !== null) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 15) out.add(digits);
  }
  return [...out];
}

/** يستخرج الروابط الظاهرة في النص. */
export function extractUrlCandidates(text: string): string[] {
  const re = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  return [...String(text ?? '').matchAll(re)].map((m) => m[0]);
}

/** مقارنة مبلغ مسموح بهامش تقريب معقول (التقريب لأعلى مقبول في الحسبة). */
function amountAllowed(value: number, allowed: number[]): boolean {
  return allowed.some((a) => {
    const tolerance = Math.max(1, Math.round(a * 0.01));
    return Math.abs(value - a) <= tolerance;
  });
}

function allowedContains(normalizedText: string, phrase: string): boolean {
  const p = normalizeArabic(phrase);
  return p.length >= 3 && normalizedText.includes(p);
}

export function isPhraseRecorded(text: string, facts: BusinessFacts): boolean {
  return facts.allowedPhrases.some((p) => allowedContains(normalizeArabic(text), p));
}

/**
 * الصيغة القياسية لرقم: بلا بادئة دولية أو صفر محلي، للمقارنة بين 0770…
 * و +964770… و 00964-770….
 */
export function canonicalPhone(value: string): string {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('964')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

/** هل الرقم المذكور مطابق لرقم مسجّل في بيانات المعرض؟ */
function phoneAllowed(supplied: string, allowed: string[]): boolean {
  const target = canonicalPhone(supplied);
  if (!target) return false;
  return allowed.some((a) => {
    const candidate = canonicalPhone(a);
    if (!candidate) return false;
    if (candidate === target) return true;
    // آخر 9 خانات: يغطّي اختلاف بادئة الشركة أو كتابة الرقم بلا صفر.
    return target.length >= 9 && candidate.length >= 9 && target.slice(-9) === candidate.slice(-9);
  });
}

/**
 * يحلّل نصاً مولّداً مقابل الحقائق التجارية الفعلية.
 * القاعدة: أي ادعاء تجاري غير مسجّل يُحجب (block)، وأي رقم لا يقابل رقماً
 * مسجّلاً يُحجب. لا يوجد مسار «تحذير فقط» لادعاء عرض صريح.
 */
export function analyzeBusinessClaims(text: string, facts: BusinessFacts): BusinessClaimReport {
  const violations: BusinessClaimViolation[] = [];
  const raw = String(text ?? '');
  const normalized = normalizeArabic(raw);
  const excerpts = (pattern: RegExp): string => {
    const m = raw.match(pattern);
    return m ? m[0].slice(0, 80) : '';
  };

  const block = (code: string, detail: string, excerpt: string) =>
    violations.push({ code, severity: 'block', detail, excerpt });

  const allowedPhoneDigits = facts.phones.flatMap(extractPhoneCandidates);
  const allowedUrlSet = facts.urls.map((u) => u.trim().toLowerCase());

  // نطمس أرقام الهاتف قبل استخراج المبالغ: بلا هذا يُقرأ جزء من رقم الهاتف
  // (77012345) كمبلغ مخترع فيُحجب محتوى سليم.
  const maskedForMoney = normalizeDigits(raw).replace(
    /(?:\+|00)?(?:964|0)\d[\d\s-]{5,}\d/g,
    (m) => ' '.repeat(m.length),
  );

  // 1) لا دفعة أولى / لا مقدم.
  //
  // ملاحظة منهجية: هذه عبارات صياغة عامة لا تحتوي أرقاماً، فلا يمكن التحقق منها
  // مقابل «نسبة دفعة أولى مسجّلة» (لا توجد نسبة 0 مسجّلة أصلاً في النظام: القيمة
  // الافتراضية في النموذج 0 تعني «غير محددة»، لا «صفر دفعة»). لذلك الادعاء يُحجب
  // دائماً ما لم يكن هناك نص معتمد صريح في بيانات المعرض يسمح به.
  const zeroDownClaim =
    /بدون\s+دفعه(\s+اولي)?|بلا\s+دفعه|لا\s+تدفع|لا\s+يوجد\s+دفعه|صفر\s+دفعه|0%\s*دفعه|بدون\s+مقدم|بلا\s+مقدم|بدون\s+مقدمه/.test(normalized);
  const zeroDownApproved = facts.allowedPhrases.some((p) => /بدون\s+دفعه|بدون\s+مقدم/.test(normalizeArabic(p)));
  if (zeroDownClaim && !zeroDownApproved) {
    block('zero_down_payment_not_recorded', 'ادعاء «بدون دفعة أولى» غير مسجّل ومعتمد في بيانات المعرض.', excerpts(/بدون\s+دفعه[^\n]{0,40}|بدون\s+مقدم[^\n]{0,40}|لا\s+تدفع[^\n]{0,40}/));
  }

  // 2) خصومات وتخفيضات وعروض وهدايا: لا تُدّعى بلا عرض مسجّل.
  const discountClaim = /خصم|تخفيض|تخفيضات|عرض\s+خاص|هديه|هدايا|مجانا|مجاني|بلاش|مجانيه/.test(normalized);
  if (discountClaim && !facts.hasRecordedPromotion) {
    block('discount_not_recorded', 'ادعاء خصم أو عرض أو هدية غير مسجّل في بيانات المعرض.', excerpts(/خصم[^\n]{0,30}|تخفيض[^\n]{0,30}|هدي[^\n]{0,30}|مجان[^\n]{0,30}/));
  }

  // 3) شروط تقسيط غير مسجّلة: بدون فوائد / بدون كفيل / بدون راتب.
  const termsClaim = /بدون\s+(فوايد|فوائد|فايده)|فايده\s+صفر|صفر\s+فوايد|بدون\s+كفيل|بدون\s+راتب|بدون\s+ضامن/.test(normalized);
  if (termsClaim) {
    block('installment_terms_not_recorded', 'ادعاء شرط تقسيط (بدون فوائد/كفيل/راتب) غير مسجّل في بيانات المعرض.', excerpts(/بدون\s+(فوايد|فوائد|كفيل|راتب|ضامن)[^\n]{0,30}/));
  }

  // 4) الضمان: يُقبل فقط إن كان نص ضمان مسجّلاً فعلاً في بيانات المعرض.
  const warrantyClaim = /ضمان|مضمون\s+\d|عام\s+ضمان|ضمان\s+سنت/.test(normalized);
  const warrantyRecorded = facts.allowedPhrases.some((p) => normalizeArabic(p).includes('ضمان'));
  if (warrantyClaim && !warrantyRecorded) {
    block('warranty_not_recorded', 'ادعاء ضمان غير مسجّل في بيانات المعرض.', excerpts(/ضمان[^\n]{0,30}/));
  }

  // 5) توفر المنتج: لا يُدّعى «متوفر» إن كان المخزون غير متوفر.
  if (facts.inStock === false && /متوفر|متوفره|متاح\s+الان|جاهز\s+للاستلام|متوفر\s+الان/.test(normalized)) {
    block('stock_claim_conflicts', 'النص يدّعي توفر المنتج وهو غير متوفر في بيانات المعرض.', excerpts(/متوفر[^\n]{0,20}|متاح[^\n]{0,20}/));
  }

  // 6) أرقام الهاتف: أي رقم غير مسجّل يُحجب.
  for (const phone of extractPhoneCandidates(raw)) {
    if (!phoneAllowed(phone, allowedPhoneDigits)) {
      block('phone_not_recorded', 'رقم تواصل غير مسجّل في بيانات المعرض.', phone.slice(0, 20));
    }
  }

  // 7) الروابط: أي رابط غير مسجّل يُحجب (يمنع اختراع روابط/حسابات اجتماعية).
  for (const url of extractUrlCandidates(raw)) {
    const clean = url.replace(/[.,،\s]+$/, '').toLowerCase();
    const allowed = allowedUrlSet.some((u) => clean.includes(u) || u.includes(clean));
    if (!allowed) block('url_not_recorded', 'رابط غير مسجّل في بيانات المعرض.', clean.slice(0, 80));
  }

  // 8) أسعار مذكورة بعدد: أي مبلغ غير مطابق لسعر مسجّل أو مبلغ مشتق مشروع يُحجب.
  const allowedAmounts = [...facts.cashPrices, ...facts.derivedAmounts];
  for (const amount of extractMoneyCandidates(maskedForMoney)) {
    if (!amountAllowed(amount, allowedAmounts)) {
      block('price_not_recorded', 'مبلغ مذكور لا يطابق أي سعر أو حسبة مسجّلة في بيانات المعرض.', String(amount));
    }
  }

  const blocked = violations.filter((v) => v.severity === 'block');
  const warnings = violations.filter((v) => v.severity === 'warn');
  return { safe: blocked.length === 0, violations, blocked, warnings };
}

/**
 * يفحص نص مهمة/ملاحظات المستخدم **قبل** أي توليد.
 * الغرض: ألا تُطلب من المزود أصلاً عروض غير مسجّلة، وألا تكون الحماية بعد
 * التوليد فقط.
 */
export function analyzeRequestClaims(text: string, facts: BusinessFacts): BusinessClaimReport {
  return analyzeBusinessClaims(text, facts);
}