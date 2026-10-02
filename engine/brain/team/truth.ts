/**
 * Team Truth Model — نموذج الحقيقة لفريق الوكلاء (منطق خالص قابل للاختبار).
 *
 * يفرض الفصل الصريح بين ما هو **حقيقة موثّقة**، وما هو **استنتاج**، وما هو
 * **فرضية**، وما هو **مجهول**، وما هو **غير متاح**. والقاعدة الحاكمة:
 *
 *   **الفرضية لا تصبح حقيقة لمجرد أن وكيلاً آخر كرّرها.**
 *
 * التكرار/التأييد بين الوكلاء يرفع الثقة (`confidence`) فقط، ولا يرقّي الحالة
 * (`truthState`). الترقية إلى `FACT` تحتاج مصدراً مستقلاً وعيّنة كافية.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

export type TeamTruthState = 'FACT' | 'DERIVED' | 'HYPOTHESIS' | 'UNKNOWN' | 'UNAVAILABLE';

export const TEAM_TRUTH_STATES: readonly TeamTruthState[] = Object.freeze([
  'FACT', 'DERIVED', 'HYPOTHESIS', 'UNKNOWN', 'UNAVAILABLE',
]);

export const TEAM_TRUTH_LABELS_AR: Record<TeamTruthState, string> = Object.freeze({
  FACT: 'حقيقة ملاحَظة من بيانات',
  DERIVED: 'استنتاج حسابي من بيانات',
  HYPOTHESIS: 'فرضية تحتاج اختباراً',
  UNKNOWN: 'مجهول',
  UNAVAILABLE: 'غير متاح عبر الواجهة الرسمية',
});

export type Confidence = 'low' | 'medium' | 'high';

/** الحد الأدنى للعيّنة لترقية استنتاج إلى حقيقة موثّقة (يطابق طبقة الحقيقة المركزية). */
export const TEAM_MIN_SAMPLE_FOR_FACT = 3;

/**
 * يصنّف ادّعاءً إلى حالة صدق صريحة. لا `FACT` بلا مصدر وعيّنة كافية، ولا `DERIVED`
 * بلا مصدر حسابي؛ وغياب كل ذلك = `UNKNOWN`، والمؤشر غير المتاح = `UNAVAILABLE`.
 */
export function truthStateForEvidence(input: {
  hasSource: boolean;
  sampleSize: number;
  derived?: boolean;
  hypothesis?: boolean;
  unavailable?: boolean;
}): TeamTruthState {
  if (input.unavailable) return 'UNAVAILABLE';
  if (input.hypothesis) return 'HYPOTHESIS';
  if (!input.hasSource || input.sampleSize <= 0) return 'UNKNOWN';
  if (input.derived) return input.sampleSize >= TEAM_MIN_SAMPLE_FOR_FACT ? 'DERIVED' : 'HYPOTHESIS';
  return input.sampleSize >= TEAM_MIN_SAMPLE_FOR_FACT ? 'FACT' : 'HYPOTHESIS';
}

/** ثقة مشتقّة من الحالة والعيّنة (بلا مبالغة). */
export function confidenceForTruth(state: TeamTruthState, sampleSize: number): Confidence {
  if (state === 'FACT') return 'high';
  if (state === 'DERIVED') return sampleSize >= TEAM_MIN_SAMPLE_FOR_FACT ? 'high' : 'medium';
  if (state === 'HYPOTHESIS') return sampleSize >= TEAM_MIN_SAMPLE_FOR_FACT ? 'medium' : 'low';
  return 'low';
}

/**
 * يحسم الحالة بعد تأييد/تكرار من وكلاء آخرين. **لا ترقية للحالة أبداً** بلا دليل
 * جديد مستقل؛ فقط تُحفظ الحالة الأصلية. يعيد الحالة نفسها والسبب صراحةً.
 */
export function confirmTruthState(original: TeamTruthState, corroborations: number): { state: TeamTruthState; promoted: boolean; reason: string } {
  const n = Math.max(0, Math.floor(corroborations));
  return {
    state: original,
    promoted: false,
    reason: n > 0
      ? `تأييد ${n} وكيل لا يرقّي «${TEAM_TRUTH_LABELS_AR[original]}» إلى حقيقة — الترقية تحتاج دليلاً مستقلاً.`
      : 'لا تأييد إضافي؛ الحالة كما هي.',
  };
}

/**
 * يرقّي حالة إلى `FACT` **فقط** عند وجود مصدر مستقل جديد وعيّنة كافية. تُستخدم
 * عند وصول دليل جديد فعلي (لا مجرد تكرار). غياب الدليل = لا ترقية.
 */
export function promoteWithIndependentEvidence(
  original: TeamTruthState,
  evidence: { independentSource: boolean; sampleSize: number },
): { state: TeamTruthState; promoted: boolean; reason: string } {
  const eligible = evidence.independentSource && evidence.sampleSize >= TEAM_MIN_SAMPLE_FOR_FACT;
  if (!eligible) {
    return { state: original, promoted: false, reason: 'لا دليل مستقل كافٍ؛ لا ترقية.' };
  }
  if (original === 'FACT' || original === 'DERIVED') {
    return { state: original, promoted: false, reason: 'الحالة بالفعل حقيقة/استنتاج؛ لا ترقية مطلوبة.' };
  }
  return { state: 'FACT', promoted: true, reason: 'دليل مستقل بعيّنة كافية؛ رُقّيت إلى حقيقة.' };
}

/** هل يمكن بناء قرار آلي آمن على هذه الحالة؟ (الحقائق والاستنتاجات فقط). */
export function isActionableTruth(state: TeamTruthState): boolean {
  return state === 'FACT' || state === 'DERIVED';
}
