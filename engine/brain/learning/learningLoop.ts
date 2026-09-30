/**
 * Learning Loop + Owner Preference — تعلّم العقل من النتائج وقرارات المالك.
 *
 * يتعلّم من: SUCCESS / FAILURE / SKIP / ESCALATION / OWNER_REJECTION / OWNER_EDIT /
 * AUDIENCE_RESPONSE / PLATFORM_RESPONSE. وكل تعلّم يحمل مصدره وعيّنته وثقته.
 *
 * **Owner Preference ليس حقيقة تجارية**: إذا عدّل المالك العناوين دائماً بطريقة
 * معينة، تُسجَّل كـ«تفضيل مالك مُلاحَظ» بإشعار صريح، لا كقاعدة مطلقة.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import { remember, makeMemoryEntry, type MemoryStore, type MemoryKind } from '../memory/longTerm';

export type LearningEventKind =
  | 'SUCCESS'
  | 'FAILURE'
  | 'SKIP'
  | 'ESCALATION'
  | 'OWNER_REJECTION'
  | 'OWNER_EDIT'
  | 'AUDIENCE_RESPONSE'
  | 'PLATFORM_RESPONSE'
  | 'PROVIDER_RESPONSE'
  | 'VERIFICATION'
  | 'OUTCOME';

export const LEARNING_EVENT_LABELS_AR: Record<LearningEventKind, string> = Object.freeze({
  SUCCESS: 'نجاح',
  FAILURE: 'فشل',
  SKIP: 'تخطٍّ',
  ESCALATION: 'إحالة',
  OWNER_REJECTION: 'رفض المالك',
  OWNER_EDIT: 'تعديل المالك',
  AUDIENCE_RESPONSE: 'استجابة جمهور',
  PLATFORM_RESPONSE: 'استجابة منصة',
  PROVIDER_RESPONSE: 'استجابة مزوّد',
  VERIFICATION: 'تحقق من مزوّد',
  OUTCOME: 'نتيجة فعلية',
});

export interface LearningEvent {
  id: string;
  kind: LearningEventKind;
  /** موضوع التعلّم (منصة/نوع محتوى/متغير). */
  subject: string;
  detail: string;
  source: string;
  sampleSize: number;
  confidence: 'low' | 'medium' | 'high';
  /** هل يمكن اعتبار هذا التعلّم حقيقة، أم ملاحظة/فرضية؟ */
  isFact: boolean;
  at: string;
  /** المنصة المرتبطة (اختياري). */
  platform?: string | null;
  /**
   * معرّف المزوّد الحقيقي (تعليق/منشور/رسالة) — لا يُخترع أبداً. يُحفظ إن وُجد
   * من استجابة مزوّد فعلية، ويُستبعد كلياً إن غاب.
   */
  providerId?: string | null;
  /** مرجع المصدر (سجل/واجهة) للتدقيق. */
  sourceRef?: string | null;
}

/** يحوّل حدث تعلّم إلى عنصر ذاكرة (بأصل صحيح، بلا ترقية AI إلى حقيقة). */
export function learningEventToMemory(event: LearningEvent, now: number): { store: (s: MemoryStore) => MemoryStore; entry: ReturnType<typeof makeMemoryEntry> } {
  const kind: MemoryKind = event.kind === 'FAILURE' || event.kind === 'OWNER_REJECTION' ? 'failure'
    : event.kind === 'OWNER_EDIT' ? 'decision'
      : event.kind === 'SUCCESS' || event.kind === 'OUTCOME' ? 'outcome'
        : event.kind === 'AUDIENCE_RESPONSE' ? 'audience'
          : event.kind === 'PROVIDER_RESPONSE' || event.kind === 'VERIFICATION' ? 'platform'
            : 'platform';
  const origin = event.kind === 'OWNER_EDIT' || event.kind === 'OWNER_REJECTION' ? 'owner_input' : 'derived';
  const entry = makeMemoryEntry({
    id: event.id,
    kind,
    statement: `${LEARNING_EVENT_LABELS_AR[event.kind]}: ${event.subject} — ${event.detail}`,
    origin,
    source: event.source,
    now,
    sampleSize: event.sampleSize,
    confidence: event.confidence,
    refs: { subject: event.subject, providerId: event.providerId ?? null },
    platform: event.platform ?? null,
    sourceRefs: event.sourceRef ? [event.source, event.sourceRef] : [event.source],
    summary: `${LEARNING_EVENT_LABELS_AR[event.kind]}: ${event.detail}`.slice(0, 300),
  });
  return { store: (s) => remember(s, entry), entry };
}

export interface LearningResult {
  events: LearningEvent[];
  /** دروس قابلة للتطبيق (بلا ادعاء سببية). */
  lessons: Array<{ statement: string; source: string; sampleSize: number; confidence: 'low' | 'medium' | 'high'; limitations: string }>;
  statisticallyValid: boolean;
  note: string;
}

export const LEARNING_MIN_SAMPLE = 3;

/**
 * يمنع تكرار أحداث التعلّم: نفس المعرّف أو نفس (kind + subject + providerId)
 * يُعتبر حدثاً واحداً. هذا يمنع استجابة مزوّد مُعادة (retry/webhook replay) من
 * إنشاء تعلّم مكرر. الأحداث الجديدة تحتفظ بترتيبها (الأحدث أولاً عند التمرير).
 */
export function dedupeLearningEvents(events: LearningEvent[]): LearningEvent[] {
  const seenId = new Set<string>();
  const seenKey = new Set<string>();
  const out: LearningEvent[] = [];
  for (const e of events || []) {
    if (!e || !e.id) continue;
    const key = `${e.kind}|${e.subject}|${e.providerId || ''}`;
    if (seenId.has(e.id) || seenKey.has(key)) continue;
    seenId.add(e.id);
    seenKey.add(key);
    out.push(e);
  }
  return out;
}

/**
 * يبني حلقة تعلّم من أحداث حقيقية فقط. عند نقص العيّنة يُعلن ذلك ويصف التعلّم
 * كمؤشر مبدئي لا حقيقة.
 */
export function buildLearningLoop(input: {
  events: LearningEvent[];
  now: number;
}): LearningResult {
  const events = dedupeLearningEvents(input.events || []);
  const facts = events.filter((e) => e.isFact);
  const lessons = facts.map((e) => ({
    statement: `${LEARNING_EVENT_LABELS_AR[e.kind]} على «${e.subject}»: ${e.detail}`,
    source: e.source,
    sampleSize: e.sampleSize,
    confidence: e.confidence,
    limitations: e.sampleSize >= LEARNING_MIN_SAMPLE
      ? 'درس من بيانات فعلية؛ لا يُثبت سببية قاطعة.'
      : `عيّنة صغيرة (${e.sampleSize})؛ مؤشر مبدئي لا حقيقة إحصائية.`,
  }));
  if (!lessons.length) {
    lessons.push({
      statement: 'لا توجد أحداث أداء/استجابة كافية لاستخراج درس موثوق بعد.',
      source: 'لا مصدر بعد',
      sampleSize: 0,
      confidence: 'low',
      limitations: 'يجب جمع أحداث حقيقية قبل أي استنتاج.',
    });
  }
  return {
    events,
    lessons,
    statisticallyValid: facts.some((e) => e.sampleSize >= LEARNING_MIN_SAMPLE),
    note: 'كل درس يحمل مصدره وعيّنته؛ لا تُعتبر النتيجة حقيقة إحصائية بلا عيّنة كافية.',
  };
}

// ---------------------------------------------------------------------------
// Owner Preference — تعلّم من قرارات المالك (ليس حقيقة تجارية)
// ---------------------------------------------------------------------------

export type OwnerPreferenceKind =
  | 'content_type'
  | 'cta'
  | 'wording'
  | 'audience'
  | 'goal'
  | 'tone'
  | 'timing';

export const OWNER_PREFERENCE_LABELS_AR: Record<OwnerPreferenceKind, string> = Object.freeze({
  content_type: 'تفضيل نوع محتوى',
  cta: 'تفضيل دعوة إجراء',
  wording: 'تفضيل صياغة',
  audience: 'تفضيل جمهور',
  goal: 'تفضيل هدف',
  tone: 'تفضيل نبرة',
  timing: 'تفضيل توقيت',
});

export interface OwnerPreference {
  kind: OwnerPreferenceKind;
  /** الوصف المُستخرج (بلا اختراع: من تعديلات/رفض المالك الفعلية). */
  statement: string;
  /** عدد المرات التي لاحظنا فيها ذلك. */
  evidenceCount: number;
  confidence: 'low' | 'medium' | 'high';
  /** صريح: هذه ملاحظة تفضيل لا حقيقة تجارية. */
  isCommercialFact: false;
  source: string;
  limitations: string;
}

export const OWNER_PREFERENCE_MIN_EVIDENCE = 3;

/**
 * يستخرج تفضيلات المالك من أحداث OWNER_EDIT/OWNER_REJECTION فقط. لا يُرقّى إلى
 * حقيقة تجارية أبداً، ولا يُطبَّق كقاعدة مطلقة بلا تكرار كافٍ.
 */
export function extractOwnerPreferences(input: {
  events: LearningEvent[];
  kind: OwnerPreferenceKind;
  /** مستخرج الوصف من حدث التعديل/الرفض. */
  describe: (e: LearningEvent) => string;
}): OwnerPreference | null {
  const relevant = (input.events || []).filter((e) => (e.kind === 'OWNER_EDIT' || e.kind === 'OWNER_REJECTION') && e.subject);
  if (!relevant.length) return null;
  const descriptions = relevant.map(input.describe).filter((d) => d && d.trim());
  if (!descriptions.length) return null;
  // الأكثر تكراراً.
  const counts = new Map<string, number>();
  for (const d of descriptions) counts.set(d, (counts.get(d) || 0) + 1);
  const [statement, evidenceCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const confidence = evidenceCount >= OWNER_PREFERENCE_MIN_EVIDENCE * 2 ? 'medium' : 'low';
  return {
    kind: input.kind,
    statement,
    evidenceCount,
    confidence,
    isCommercialFact: false,
    source: 'سجل قرارات المالك (تعديل/رفض فعلي)',
    limitations: evidenceCount >= OWNER_PREFERENCE_MIN_EVIDENCE
      ? 'تفضيل مالك مُلاحَظ بإشعار كافٍ؛ يُستخدم كإشارة لا كقاعدة مطلقة.'
      : `عدد الملاحظات (${evidenceCount}) أقل من الحد ${OWNER_PREFERENCE_MIN_EVIDENCE}؛ لا يُعتمد بعد.`,
  };
}

/** هل التفضيل ناضج بما يكفي للاستخدام كإشارة؟ */
export function ownerPreferenceUsable(pref: OwnerPreference): boolean {
  return pref.evidenceCount >= OWNER_PREFERENCE_MIN_EVIDENCE;
}
