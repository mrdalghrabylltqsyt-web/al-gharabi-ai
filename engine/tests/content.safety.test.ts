/**
 * اختبارات حارس سلامة المحتوى التجاري — حتمية بالكامل بلا شبكة ولا مزود.
 *
 * الهدف: إثبات أن أي عرض تجاري غير موجود في بيانات المعرض يُحجب فعلياً، وأن
 * المحتوى المبني على بيانات حقيقية يمرّ بلا حجب. هذه هي الحماية التي كانت
 * ناقصة: الحارس القديم كان يمنع مجال السيارات والعداد الموروث فقط.
 */

import {
  analyzeBusinessClaims,
  analyzeRequestClaims,
  buildBusinessFacts,
  extractMoneyCandidates,
  extractPhoneCandidates,
  extractUrlCandidates,
  normalizeArabic,
  type BusinessFacts,
} from '../social/contentSafety';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

/** حقائق معرض واقعية: منتج بسعر 1,250,000 ودقعة 0% ومدد سداد مسجّلة. */
const REAL_FACTS: BusinessFacts = buildBusinessFacts({
  cashPrices: [1_250_000],
  derivedAmounts: [1_250_000, 41_667, 2_500_020],
  downPaymentPercents: [25],
  phones: ['07701234567'],
  urls: ['https://example.invalid/product.jpg'],
  inStock: true,
  promotions: [],
  allowedPhrases: ['إجراءات ميسرة ومتابعة كاملة للطلب'],
});

/** بيانات معرض ناقصة: لا سعر، لا رقم، لا رابط، ولا عرض مسجّل. */
const EMPTY_FACTS: BusinessFacts = buildBusinessFacts({});

function codes(text: string, facts: BusinessFacts): string[] {
  return analyzeBusinessClaims(text, facts).blocked.map((v) => v.code);
}

function run(): void {
  // ------------------------------------------------------------ تطبيع النص
  group('1) تطبيع النص العربي');
  check('توحيد الهمزات والألف', normalizeArabic('أدفع الآن') === 'ادفع الان');
  check('تحويل الأرقام العربية-الهندية', normalizeArabic('١٢٣٤') === '1234');
  check('إزالة التشكيل والتطويل', normalizeArabic('دَفْعَـــة') === 'دفعه');
  check('ضغط المسافات الزائدة', normalizeArabic('بدون    دفعة') === 'بدون دفعه');

  // ------------------------------------------------------ استخراج المبالغ
  group('2) استخراج المبالغ');
  check('مبلغ بعملة د.ع يُستخرج', extractMoneyCandidates('السعر 1,250,000 د.ع').includes(1_250_000));
  check('مبلغ بكلمة دينار يُستخرج', extractMoneyCandidates('بسعر 850000 دينار').includes(850_000));
  check('مبلغ بصيغة «الف» يُضرب بألف', extractMoneyCandidates('دفعة 250 الف').includes(250_000));
  check('سنة بلا عملة لا تُعتبر مبلغاً', extractMoneyCandidates('موديل 2026').length === 0);
  check('طابع زمني بلا عملة لا يُعتبر مبلغاً', extractMoneyCandidates('00:20 تفاصيل المنتج').length === 0);
  check('أرقام عربية-هندية تُقرأ كمبلغ', extractMoneyCandidates('١٢٥٠٠٠٠ د.ع').includes(1_250_000));

  // ------------------------------------------------------ استخراج الهواتف
  group('3) استخراج أرقام الهاتف');
  check('رقم عراقي محلي يُكتشف', extractPhoneCandidates('اتصل 07701234567').length === 1);
  check('رقم بصيغة دولية يُكتشف', extractPhoneCandidates('اتصل +9647701234567').length === 1);
  check('مبلغ ليس رقم هاتف', extractPhoneCandidates('سعر 1,250,000 د.ع').length === 0);
  check('رقم بفواصل يُكتشف', extractPhoneCandidates('0770 123 4567').length === 1);

  // --------------------------------------------------------- استخراج الروابط
  group('4) استخراج الروابط');
  check('رابط https يُكتشف', extractUrlCandidates('الرابط https://shop.example.com/x').length === 1);
  check('رابط www يُكتشف', extractUrlCandidates('زر www.example.com').length === 1);
  check('نص بلا رابط يعيد فارغاً', extractUrlCandidates('تواصل معنا للتفاصيل').length === 0);

  // ------------------------------------- جوهر المهمة: منع الاختراع التجاري
  group('5) ★ منع ادعاء «بدون دفعة أولى» غير المسجّل');
  check('بدون دفعة أولى يُحجب بلا بيانات', codes('امتلك الآن بدون دفعة أولى!', EMPTY_FACTS).includes('zero_down_payment_not_recorded'));
  check('«لا تدفع ولا ريال مقدم» يُحجب', codes('لا تدفع ولا ريال مقدم', EMPTY_FACTS).includes('zero_down_payment_not_recorded'));
  check('«بدون مقدم» يُحجب', codes('عرض بدون مقدم للعملاء', EMPTY_FACTS).includes('zero_down_payment_not_recorded'));
  check('تهجئة بألف مقصورة تتجاوز الحارس ممنوعة', codes('بدون دفعة أولى', buildBusinessFacts({ downPaymentPercents: [20] })).includes('zero_down_payment_not_recorded'));
  check('دفعة أولى 0% وحدها لا تبيح الادعاء (0 تعني غير محددة)', codes('متاح بدون دفعة أولى', buildBusinessFacts({ downPaymentPercents: [0] })).includes('zero_down_payment_not_recorded'));
  check('نص معتمد صريح في بيانات المعرض يسمح بالادعاء', analyzeBusinessClaims('متاح بدون دفعة أولى', buildBusinessFacts({ allowedPhrases: ['بدون دفعة أولى'] })).safe === true);

  group('6) ★ منع الخصومات والعروض والهدايا غير المسجّلة');
  check('خصم يُحجب بلا عرض مسجّل', codes('خصم خاص 20%', EMPTY_FACTS).includes('discount_not_recorded'));
  check('هدية مجانية تُحجب', codes('هدية مجانية مع كل طلب', EMPTY_FACTS).includes('discount_not_recorded'));
  check('تخفيضات تُحجب', codes('تخفيضات كبيرة هذا الشهر', EMPTY_FACTS).includes('discount_not_recorded'));
  check('عرض مسجّل فعلاً يسمح بالذكر', analyzeBusinessClaims('لدينا عرض خاص هذا الشهر', buildBusinessFacts({ promotions: ['عرض خاص هذا الشهر'] })).safe === true);

  group('7) ★ منع شروط التقسيط والضمان المُختلقة');
  check('«بدون فوائد» يُحجب', codes('تقسيط بدون فوائد', EMPTY_FACTS).includes('installment_terms_not_recorded'));
  check('«بدون كفيل» يُحجب', codes('نقبل بدون كفيل', EMPTY_FACTS).includes('installment_terms_not_recorded'));
  check('الضمان يُحجب بلا نص مسجّل', codes('ضمان سنتين على المنتج', EMPTY_FACTS).includes('warranty_not_recorded'));
  check('الضمان يمرّ إن كان مسجّلاً', analyzeBusinessClaims('ضمان حسب سياسة المورد', buildBusinessFacts({ allowedPhrases: ['ضمان حسب سياسة المورد'] })).safe === true);

  group('8) ★ منع ادعاء توفر غير موجود');
  check('«متوفر» يُحجب حين المخزون غير متوفر', codes('المنتج متوفر الآن', buildBusinessFacts({ inStock: false })).includes('stock_claim_conflicts'));
  check('«متوفر» يمرّ حين المخزون متوفر', analyzeBusinessClaims('المنتج متوفر الآن', buildBusinessFacts({ inStock: true })).safe === true);
  check('«متوفر» بلا معلومة مخزون يمرّ (لا ادعاء مضاد)', analyzeBusinessClaims('المنتج متوفر الآن', buildBusinessFacts({})).safe === true);

  group('9) ★ منع اختراع الأرقام والروابط');
  check('رقم هاتف غير مسجّل يُحجب', codes('اتصل على 07901112233', EMPTY_FACTS).includes('phone_not_recorded'));
  check('رقم مسجّل يمرّ', analyzeBusinessClaims('اتصل على 07701234567', REAL_FACTS).safe === true);
  check('رقم مسجّل بصيغة دولية مطابقة يمرّ', analyzeBusinessClaims('اتصل على +9647701234567', REAL_FACTS).safe === true);
  check('رابط غير مسجّل يُحجب', codes('زر الرابط https://fake-store.example', EMPTY_FACTS).includes('url_not_recorded'));
  check('رابط مسجّل يمرّ', analyzeBusinessClaims('الصورة https://example.invalid/product.jpg', REAL_FACTS).safe === true);

  group('10) ★ منع اختراع الأسعار');
  check('سعر مخترع يُحجب', codes('سعر الكاش 999,999 د.ع', REAL_FACTS).includes('price_not_recorded'));
  check('سعر مسجّل يمرّ', analyzeBusinessClaims('سعر الكاش 1,250,000 د.ع', REAL_FACTS).safe === true);
  check('مبلغ مشتق من الحسبة المسجّلة يمرّ', analyzeBusinessClaims('القسط الشهري 41,667 د.ع', REAL_FACTS).safe === true);
  check('مبلغ مشتق مخترع يُحجب', codes('القسط الشهري 33,333 د.ع', REAL_FACTS).includes('price_not_recorded'));

  group('11) ★ المحتوى السليم المبني على بيانات حقيقية يمرّ');
  const healthy = [
    'عرض تقسيط الغسالة من معرض الغرابي',
    'سعر الكاش: 1,250,000 د.ع',
    'القسط الشهري: 41,667 د.ع',
    'إجراءات ميسرة ومتابعة كاملة للطلب',
    'تواصل معنا: 07701234567',
  ].join('\n');
  check('محتوى حقيقي كامل يمرّ بلا أي حجب', analyzeBusinessClaims(healthy, REAL_FACTS).safe === true, JSON.stringify(analyzeBusinessClaims(healthy, REAL_FACTS).blocked));
  check('تقرير المحتوى السليم بلا انتهاكات', analyzeBusinessClaims(healthy, REAL_FACTS).violations.length === 0);

  group('12) ★ نص بديل عام لا يدّعي أرقاماً يمرّ');
  const generic = 'نقدم لكم في معرض الغرابي للتقسيط حلولاً تمويلية وتقسيطاً ميسراً يلبي تطلعاتكم:\nحلول مرنة وإجراءات واضحة.\nتواصل معنا للتفاصيل.';
  check('محتوى عام بلا ادعاءات رقمية يمرّ', analyzeBusinessClaims(generic, EMPTY_FACTS).safe === true);

  group('13) حارس المدخلات (قبل التوليد)');
  check('طلب عرض غير مسجّل يُحجب قبل التوليد', analyzeRequestClaims('حملة بدون دفعة أولى', EMPTY_FACTS).safe === false);
  check('طلب مطابق للبيانات يمرّ', analyzeRequestClaims('حملة عرض تقسيط الغسالة', REAL_FACTS).safe === true);

  group('14) البنية والتقارير');
  check('التقرير يفصل المحجوب عن التحذيرات', (() => {
    const r = analyzeBusinessClaims('بدون دفعة أولى', EMPTY_FACTS);
    return r.safe === false && r.blocked.length >= 1 && Array.isArray(r.warnings);
  })());
  check('كل انتهاك يحمل رمزاً ووصفاً عربياً', analyzeBusinessClaims('بدون مقدم', EMPTY_FACTS).violations.every((v) => Boolean(v.code) && Boolean(v.detail)));
  check('لا تظهر أي قيمة سرية في التقرير', !/AIza|api[_-]?key/i.test(JSON.stringify(analyzeBusinessClaims(healthy, REAL_FACTS))));

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} content safety checks`);
  }
}

run();
