/**
 * Truth / Knowledge Layer — مصدر الحقيقة المركزي للعقل.
 *
 * الهدف: أن يفرّق العقل دائماً بين ما هو **حقيقة موثّقة**، وما هو **استنتاج
 * حسابي**، وما هو **فرضية**، وما هو **مجهول** أو **غير متاح** أو يحتاج **تدخّل
 * المالك**. هذا هو الفرق بين عقل صادق وعقل يبدو ذكياً بالاختلاق.
 *
 * القواعد الملزمة:
 * - لا يُرقّى ادّعاء إلى `VERIFIED_FACT` بلا مصدر حقيقي + عيّنة.
 * - كل حقيقة تحمل مصدرها (`source`) وعيّنتها (`sampleSize`) وحدودها.
 * - «لا توجد بيانات» إجابة صحيحة صريحة (`UNKNOWN` / `UNAVAILABLE` / `INSUFFICIENT_DATA`).
 * - لا سعر ولا مواصفة ولا رقم إلا بمصدر؛ وإلا `HUMAN_INPUT_REQUIRED`.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

export type TruthState =
  | 'VERIFIED_FACT'
  | 'DERIVED_FACT'
  | 'HYPOTHESIS'
  | 'UNKNOWN'
  | 'UNAVAILABLE'
  | 'HUMAN_INPUT_REQUIRED'
  | 'INSUFFICIENT_DATA';

export const TRUTH_STATE_LABELS_AR: Record<TruthState, string> = Object.freeze({
  VERIFIED_FACT: 'حقيقة موثّقة',
  DERIVED_FACT: 'استنتاج حسابي',
  HYPOTHESIS: 'فرضية تحتاج اختباراً',
  UNKNOWN: 'مجهول',
  UNAVAILABLE: 'غير متاح عبر الواجهة الرسمية',
  HUMAN_INPUT_REQUIRED: 'يحتاج تدخّل المالك',
  INSUFFICIENT_DATA: 'بيانات غير كافية',
});

export interface KnowledgeItem {
  /** معرّف منطقي ثابت (نص قصير). */
  id: string;
  statement: string;
  state: TruthState;
  /** مصدر الدليل (اسم واجهة/بيانات) — إلزامي لكل ما هو ليس مجهولاً. */
  source: string | null;
  /** عيّنة الدليل. 0 أو غياب يعني بلا دليل كافٍ. */
  sampleSize: number;
  confidence: 'low' | 'medium' | 'high';
  limitations: string;
  createdAt: string;
  /** آخر تحقق فعلي (للحقائق التجارية). */
  lastValidatedAt?: string | null;
}

/** الحد الأدنى للعيّنة لترقية استنتاج إلى حقيقة موثّقة. */
export const MIN_SAMPLE_FOR_VERIFIED = 3;

/**
 * يصنّف ادّعاءً إلى حالة صدق صريحة. لا يُسمح بـ`VERIFIED_FACT` بلا مصدر وعيّنة
 * كافية، ولا بـ`DERIVED_FACT` بلا مصدر حسابي. غياب كل ذلك = `UNKNOWN`.
 */
export function classifyClaim(input: {
  hasSource: boolean;
  sampleSize: number;
  derived?: boolean;
  hypothesis?: boolean;
  unavailable?: boolean;
  requiresHumanInput?: boolean;
}): TruthState {
  if (input.requiresHumanInput) return 'HUMAN_INPUT_REQUIRED';
  if (input.unavailable) return 'UNAVAILABLE';
  if (input.hypothesis) return 'HYPOTHESIS';
  if (!input.hasSource || input.sampleSize <= 0) return 'UNKNOWN';
  if (input.derived) return input.sampleSize >= MIN_SAMPLE_FOR_VERIFIED ? 'DERIVED_FACT' : 'INSUFFICIENT_DATA';
  return input.sampleSize >= MIN_SAMPLE_FOR_VERIFIED ? 'VERIFIED_FACT' : 'INSUFFICIENT_DATA';
}

/** يبني عنصر معرفة مع فرض حالته الصادقة (لا ترقية بلا دليل). */
export function makeKnowledgeItem(input: {
  id: string;
  statement: string;
  source: string | null;
  sampleSize: number;
  now: number;
  derived?: boolean;
  hypothesis?: boolean;
  unavailable?: boolean;
  requiresHumanInput?: boolean;
  confidence?: 'low' | 'medium' | 'high';
  limitations?: string;
  lastValidatedAt?: string | null;
}): KnowledgeItem {
  const hasSource = typeof input.source === 'string' && input.source.trim().length > 0;
  const state = classifyClaim({
    hasSource,
    sampleSize: input.sampleSize,
    derived: input.derived,
    hypothesis: input.hypothesis,
    unavailable: input.unavailable,
    requiresHumanInput: input.requiresHumanInput,
  });
  const confidence = input.confidence || (
    state === 'VERIFIED_FACT' ? 'high' : state === 'DERIVED_FACT' ? 'medium' : 'low'
  );
  return {
    id: input.id,
    statement: input.statement,
    state,
    source: hasSource ? input.source : null,
    sampleSize: input.sampleSize,
    confidence,
    limitations: input.limitations || defaultLimitation(state),
    createdAt: new Date(input.now).toISOString(),
    lastValidatedAt: input.lastValidatedAt ?? null,
  };
}

export function defaultLimitation(state: TruthState): string {
  switch (state) {
    case 'VERIFIED_FACT': return 'مصدر حقيقي وعيّنة كافية؛ لا يعني سببية ولا ضماناً.';
    case 'DERIVED_FACT': return 'استنتاج حسابي من بيانات حقيقية؛ لا يعني سببية.';
    case 'HYPOTHESIS': return 'فرضية تحتاج اختباراً قبل اعتبارها قاعدة.';
    case 'UNKNOWN': return 'لا توجد بيانات كافية؛ لا يُخترع بديل.';
    case 'UNAVAILABLE': return 'المنصة لا توفّر هذه المعلومة عبر واجهتها الرسمية.';
    case 'HUMAN_INPUT_REQUIRED': return 'معلومة تجارية تحتاج تأكيد المالك؛ لا تُخترع.';
    case 'INSUFFICIENT_DATA': return 'الدليل موجود لكن العيّنة أقل من الحد الكافي.';
  }
}

/** هل يمكن استخدام هذا العنصر في قرار آلي آمن؟ (الحقائق والاستنتاجات فقط). */
export function isActionable(item: Pick<KnowledgeItem, 'state'>): boolean {
  return item.state === 'VERIFIED_FACT' || item.state === 'DERIVED_FACT';
}

export interface KnowledgeBase {
  items: KnowledgeItem[];
  verifiedCount: number;
  derivedCount: number;
  hypothesisCount: number;
  unknownCount: number;
  unavailableCount: number;
  humanInputRequiredCount: number;
  insufficientCount: number;
  note: string;
}

export function summarizeKnowledge(items: KnowledgeItem[]): KnowledgeBase {
  const count = (s: TruthState) => items.filter((i) => i.state === s).length;
  return {
    items,
    verifiedCount: count('VERIFIED_FACT'),
    derivedCount: count('DERIVED_FACT'),
    hypothesisCount: count('HYPOTHESIS'),
    unknownCount: count('UNKNOWN'),
    unavailableCount: count('UNAVAILABLE'),
    humanInputRequiredCount: count('HUMAN_INPUT_REQUIRED'),
    insufficientCount: count('INSUFFICIENT_DATA'),
    note: 'كل عنصر يحمل حالته الصادقة ومصدره وعيّنته؛ لا يُرقّى ادّعاء إلى حقيقة بلا دليل.',
  };
}

/**
 * حقائق تجارية (سعر/ضمان/توفر/مواصفة) لا تُعتبر حقيقة إلا بمصدر مسجّل. غياب
 * المصدر = `HUMAN_INPUT_REQUIRED` صراحةً، فلا يخترع العقل سعراً ولا خصماً.
 */
export function commercialFact(input: {
  id: string;
  statement: string;
  source: string | null;
  now: number;
  lastValidatedAt?: string | null;
}): KnowledgeItem {
  const hasSource = typeof input.source === 'string' && input.source.trim().length > 0;
  return makeKnowledgeItem({
    id: input.id,
    statement: input.statement,
    source: input.source,
    // سجل تجاري مسجّل من مصدر موثوق = حقيقة قاطعة (لا مفهوم عيّنة إحصائية هنا).
    sampleSize: hasSource ? MIN_SAMPLE_FOR_VERIFIED : 0,
    now: input.now,
    requiresHumanInput: !hasSource,
    confidence: hasSource ? 'high' : 'low',
    limitations: hasSource
      ? 'حقيقة تجارية مسجّلة من مصدر؛ تُراجَع دورياً.'
      : 'لا مصدر مسجّل لهذه المعلومة التجارية؛ تحتاج تأكيد المالك — لا تُخترع.',
    lastValidatedAt: input.lastValidatedAt ?? null,
  });
}
