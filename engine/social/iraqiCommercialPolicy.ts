/**
 * سياسة التواصل التجاري العراقي (Iraqi Commercial Communication Policy).
 *
 * الغرض: قواعد حتمية للنبرة والصياغة التجارية العراقية، فوق حارس سلامة المحتوى
 * (الذي يمنع الأرقام/الروابط غير المسجّلة). هذه الطبقة تمنع:
 * - المبالغة والإعلانية الفجّة (hype).
 * - الإلحاح الكاذب والندرة المُختلقة.
 * - الوعد المطلق/الضمان غير المسجّل.
 * - الحطّ من المنافسين.
 * وتفرض: لهجة عراقية طبيعية، جملة قصيرة، بلا وعود غير قابلة للتحقق.
 *
 * منطق صافٍ قابل للاختبار: لا شبكة ولا أسرار. لا يقرّر «صحة» معلومة تجارية —
 * ذلك يبقى لحارس المحتوى وبيانات المعرض المسجّلة.
 */

export type CommercialViolationCode =
  | 'hype_language'
  | 'false_urgency'
  | 'absolute_promise'
  | 'unregistered_guarantee'
  | 'competitor_disparagement'
  | 'pressure_tactic';

export interface CommercialPolicyViolation {
  code: CommercialViolationCode;
  detail: string;
}

export interface CommercialPolicyReport {
  /** هل الرسالة مطابقة للسياسة؟ */
  compliant: boolean;
  violations: CommercialPolicyViolation[];
  /** مسمّيات عربية للعرض. */
  violationLabelsAr: string[];
}

/** تطبيع عربي مبسّط (توحيد الألف/الهمزات/التاء) لمطابقة أنماط النبرة. */
export function normalizePolicyText(input: string): string {
  return String(input || '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const HYPE_PATTERNS: RegExp[] = [
  /الافضل في العراق/, /الافضل علي الاطلاق/, /افضل عرض/, /افضل عرض في السوق/, /لا يقاوم/, /عرض خرافي/, /عرض لا يفوتك/, /لا يفوتك/, /فرصه العمر/,
  /اقوي عرض/, /ارخص من الكل/, /ماكو مثله/, /لا مثيل له/, /عرض ما يتفوت/,
];
const URGENCY_PATTERNS: RegExp[] = [
  /اخر قطعه/, /اخر حبه/, /راح يخلص/, /يخلص اليوم/, /الحق قبل/, /بسرعه قبل ما/, /العرض ينتهي الليله/, /كميه محدوده جدا/, /اخر فرصه/,
];
const ABSOLUTE_PROMISE_PATTERNS: RegExp[] = [
  /مضمون 100/, /مضمون ميه بالميه/, /اكيد 100/, /بلا شك راح/, /نضمن لك/, /مضمون للابد/, /بدون اي مشاكل ابدا/,
];
const COMPETITOR_PATTERNS: RegExp[] = [
  /ارخص منهم/, /احسن من غيرنا/, /لا تشتري من/, /نصب عليك غيرنا/, /البقيه غالي/, /الاخرين يغشون/,
];
const PRESSURE_PATTERNS: RegExp[] = [
  /لازم تشتري هسه/, /اشتري حالا/, /لا تفكر/, /قرارك غلط لو ما اشتريت/, /راح تخسر لو ما/,
];

const CODE_LABELS_AR: Record<CommercialViolationCode, string> = {
  hype_language: 'مبالغة إعلانية',
  false_urgency: 'إلحاح كاذب/ندرة مُختلقة',
  absolute_promise: 'وعد مطلق غير قابل للتحقق',
  unregistered_guarantee: 'ضمان غير مسجّل',
  competitor_disparagement: 'الحطّ من المنافسين',
  pressure_tactic: 'ضغط على العميل',
};

function scan(text: string, patterns: RegExp[], code: CommercialViolationCode, label: string): CommercialPolicyViolation[] {
  const out: CommercialPolicyViolation[] = [];
  for (const p of patterns) {
    if (p.test(text)) out.push({ code, detail: label });
  }
  return out;
}

/**
 * يفحص نصاً تجارياً مقابل السياسة. لا يفشل عند غياب أي نمط ⇒ متوافق.
 */
export function checkCommercialPolicy(text: string): CommercialPolicyReport {
  const t = normalizePolicyText(text);
  const violations: CommercialPolicyViolation[] = [
    ...scan(t, HYPE_PATTERNS, 'hype_language', 'عبارة مبالغة إعلانية غير مناسبة للتواصل العراقي الطبيعي.'),
    ...scan(t, URGENCY_PATTERNS, 'false_urgency', 'إلحاح/ندرة غير مثبتة (لا تُختلق ندرة).'),
    ...scan(t, ABSOLUTE_PROMISE_PATTERNS, 'absolute_promise', 'وعد مطلق لا يمكن إثباته.'),
    ...scan(t, COMPETITOR_PATTERNS, 'competitor_disparagement', 'حطّ من المنافسين — ممنوع.'),
    ...scan(t, PRESSURE_PATTERNS, 'pressure_tactic', 'ضغط مباشر على قرار العميل — ممنوع.'),
  ];
  // إزالة التكرار بحسب الكود+التفصيل.
  const seen = new Set<string>();
  const unique = violations.filter((v) => {
    const k = `${v.code}|${v.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    compliant: unique.length === 0,
    violations: unique,
    violationLabelsAr: unique.map((v) => CODE_LABELS_AR[v.code]),
  };
}

/** قواعد النبرة العراقية المعلنة (بلا تنفيذ هنا — مرجع موحّد). */
export const IRAQI_TONE_GUIDELINES_AR: readonly string[] = Object.freeze([
  'استخدم لهجة عراقية طبيعية قصيرة، لا فصحى رسمية متكلّفة.',
  'لا تبالغ ولا تستخدم عبارات إعلانية فجّة.',
  'لا تخلق ندرة أو إلحاحاً غير مثبت.',
  'لا تعِد بوعد مطلق أو ضمان غير مسجّل في بيانات المعرض.',
  'لا تحطّ من المنافسين ولا تذكرهم بالسوء.',
  'إذا لم تتوفر معلومة موثوقة، أعلن ذلك وأحل العميل للتواصل بدل اختراعها.',
]);

export const COMMERCIAL_POLICY_CODES: readonly CommercialViolationCode[] = Object.freeze([
  'hype_language', 'false_urgency', 'absolute_promise', 'unregistered_guarantee', 'competitor_disparagement', 'pressure_tactic',
]);
