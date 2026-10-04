/**
 * Outcome Feedback + Continuous Learning — حلقة التعلّم الآمنة (منطق خالص).
 *
 * ACTION → RESULT → OBSERVATION → ANALYSIS → LESSON → MEMORY → FUTURE DECISION.
 * تعلّم فقط من نتائج اجتماعية/تسويقية ملاحَظة فعلاً (تفاعل تغيّر/استجابة/استفسار/
 * إشارة شراء). **لا بيع مُخترع**، ولا إيراد/ربح/ROI. ولا تعلّم يُرقّى إلى معرفة
 * دائمة بلا مصدر وعيّنة كافية. لا تعلّم معزّز ولا كود يعدّل قواعده.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import type { PlatformId } from '../../social/adapter';
import type { OutcomeObservation, Lesson, LearningOutcome } from './types';
import { makeMemoryEntry, type MemoryEntry, type MemoryOrigin } from '../memory/longTerm';

/** الحد الأدنى للعيّنة لترقية درس إلى معرفة دائمة. */
export const LESSON_DURABLE_MIN_SAMPLE = 3;

/** أنواع النتائج المسموح تعلّمها (اجتماعية/تسويقية فقط). */
export const ALLOWED_OUTCOME_KINDS: readonly OutcomeObservation['kind'][] = Object.freeze([
  'engagement_changed', 'response_received', 'inquiry', 'purchase_signal', 'no_change',
]);

/** مصطلحات مالية خارج النطاق — تُرفض صراحةً في أي نتيجة/درس. */
const OUT_OF_SCOPE = /إيراد|ربح|ROI|هامش|تكلفة اكتساب|قيمة عمر|محاسبة|مخزون|فاتورة/i;

/**
 * يبني ملاحظة نتيجة من بيانات حقيقية فقط. يرفض أي ادعاء بيع غير مُثبت: النوع
 * `purchase_signal` يعبّر عن إشارة لا عن بيع مؤكد، ولا يُخترع إيراد.
 */
export function makeOutcomeObservation(input: {
  id: string;
  platform: PlatformId;
  kind: OutcomeObservation['kind'];
  summary: string;
  source: string;
  sampleSize: number;
  now: number;
}): OutcomeObservation {
  if (!ALLOWED_OUTCOME_KINDS.includes(input.kind)) {
    throw new Error(`نوع نتيجة غير مسموح: ${input.kind}`);
  }
  if (OUT_OF_SCOPE.test(input.summary)) {
    throw new Error('نتيجة تمسّ مجالاً مالياً خارج النطاق (مرفوضة).');
  }
  return {
    id: input.id,
    platform: input.platform,
    kind: input.kind,
    summary: String(input.summary).slice(0, 300),
    source: input.source,
    sampleSize: Math.max(0, Number(input.sampleSize) || 0),
    at: new Date(input.now).toISOString(),
  };
}

/**
 * يستخرج درساً من ملاحظة. لا يُرقّى إلى دائم إلا بمصدر وعيّنة كافية. السببية
 * لا تُدّعى من ملاحظة واحدة (يُعلن ذلك في الحدود).
 */
export function deriveLesson(observation: OutcomeObservation, now: number): Lesson {
  const durable = observation.sampleSize >= LESSON_DURABLE_MIN_SAMPLE && Boolean(observation.source);
  const kindAr: Record<OutcomeObservation['kind'], string> = {
    engagement_changed: 'تغيّر التفاعل',
    response_received: 'وصول استجابة',
    inquiry: 'استفسار',
    purchase_signal: 'إشارة شراء',
    no_change: 'لا تغيّر ملحوظ',
  };
  return {
    id: `lesson:${observation.id}`,
    statement: `${kindAr[observation.kind]} على ${observation.platform}: ${observation.summary}`,
    source: observation.source,
    sampleSize: observation.sampleSize,
    confidence: durable ? (observation.sampleSize >= LESSON_DURABLE_MIN_SAMPLE * 2 ? 'medium' : 'low') : 'low',
    durable,
    limitations: durable
      ? 'درس من بيانات فعلية؛ لا يُثبت سببية قاطعة (مراقبة لا تجربة).'
      : `عيّنة/مصدر غير كافٍ (عيّنة ${observation.sampleSize} < ${LESSON_DURABLE_MIN_SAMPLE})؛ ملاحظة مبدئية لا معرفة دائمة.`,
  };
}

/**
 * يبني حلقة التعلّم من ملاحظات حقيقية فقط. الدروس المعتبرة معرفة دائمة = التي
 * استوفت المصدر والعيّنة. لا استنتاج بلا دليل.
 */
export function buildLearningOutcome(observations: OutcomeObservation[], now: number): LearningOutcome {
  const obs = (observations || []).filter((o) => o && ALLOWED_OUTCOME_KINDS.includes(o.kind));
  const lessons = obs.map((o) => deriveLesson(o, now));
  const durableLessons = lessons.filter((l) => l.durable);
  return {
    observations: obs,
    lessons,
    durableLessons,
    note: durableLessons.length
      ? `${durableLessons.length} درساً استوفى المصدر والعيّنة ويُرقّى لمعرفة دائمة؛ الباقي ملاحظات مبدئية.`
      : 'لا درس استوفى شرط المعرفة الدائمة بعد؛ تُحفظ الملاحظات بلا ترقية (لا اختراع).',
  };
}

/** حارس صريح: هل تحتوي الحلقة على أي ادّعاء مالي خارج النطاق؟ (يجب أن تكون false). */
export function learningOutcomeViolatesScope(outcome: LearningOutcome): { violates: boolean; found: string[] } {
  const text = `${outcome.observations.map((o) => o.summary).join(' ')} ${outcome.lessons.map((l) => l.statement).join(' ')}`;
  const found = OUT_OF_SCOPE.test(text) ? ['مصطلح مالي خارج النطاق'] : [];
  return { violates: found.length > 0, found };
}

/** يثبت أن التعلّم لا يعدّل قواعد النظام (لا self-modifying). */
export function learningIsNonSelfModifying(): { selfModifying: false; reason: string } {
  return { selfModifying: false, reason: 'التعلّم يُنتج ملاحظات/دروساً فقط؛ لا يُعدّل أي قاعدة حوكمة أو كود، ولا تعلّم معزّز.' };
}

/**
 * يحوّل درساً دائماً (استوفى المصدر والعيّنة) إلى عنصر ذاكرة طويلة المدى.
 * **لا ترقية بلا شرط**: يُرجع null للدروس غير الدائمة. والأصل صريح:
 *   - تغيّر تفاعل / لا تغيّر (نمط ملاحَظ) => `derived` (استنتاج، ليس حقيقة قاطعة).
 *   - استفسار / إشارة شراء => `platform_data` (وصل فعلاً من تفاعل المنصة).
 * **لا** يُرقّى أي درس إلى `FACT` تجاري، ولا يُخترع رقم.
 */
export function lessonToMemoryEntry(
  lesson: Lesson,
  ctx: { id: string; platform: string | null; now: number; source: string },
): MemoryEntry | null {
  if (!lesson.durable || !lesson.source) return null;
  const origin: MemoryOrigin = lesson.source.includes('platform') || lesson.source.includes('social') || lesson.source.includes('workspace')
    ? 'platform_data'
    : 'derived';
  return makeMemoryEntry({
    id: ctx.id,
    kind: 'outcome',
    statement: lesson.statement,
    origin,
    source: ctx.source || lesson.source,
    now: ctx.now,
    sampleSize: lesson.sampleSize,
    confidence: lesson.confidence,
    limitations: lesson.limitations,
    platform: ctx.platform,
    sourceRefs: [lesson.source],
    relatedGoal: 'INCREASE_PURCHASE_SIGNALS',
  });
}

/**
 * يبني سجلات ذاكرة طويلة المدى من حلقة تعلّم، **بلا ترقية غير مستحقة**.
 * مفاتيح ثابتة (`lesson:<obs.id>`) لمنع التكرار عبر `upsertMemoryRecord`.
 */
export function learningToMemoryEntries(
  outcome: LearningOutcome,
  ctx: { platform: string | null; now: number; source: string },
): { entry: MemoryEntry; key: string }[] {
  const result: { entry: MemoryEntry; key: string }[] = [];
  for (const lesson of outcome.durableLessons) {
    const entry = lessonToMemoryEntry(lesson, { id: lesson.id || `lesson:${ctx.now}`, platform: ctx.platform, now: ctx.now, source: ctx.source });
    if (entry) result.push({ entry, key: `lesson:${lesson.id.replace(/^lesson:/, '')}` });
  }
  return result;
}
