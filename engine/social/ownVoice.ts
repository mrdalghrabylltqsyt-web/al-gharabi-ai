/**
 * صوت المعرض أم صوت الزبون؟ (2026-10-27) — منطق صافٍ قابل للاختبار.
 *
 * العطل الذي رُصد على الشاشة الحية: مراقبو المنصات يقرؤون كل تعليقات المنشور، ومنها ردود
 * الصفحة نفسها («حياك الله، موقعنا… والدوام…»). كانت تُخزَّن في `socialComments` بلا وسم،
 * فتظهر في «أصوات الزبائن» وتُحسب «استفساراً تجارياً» وتضخّم عدّاد التفاعلات والنوايا.
 *
 * القاعدة: التعليق صوت المعرض إن ثبت ذلك بأي دليل حقيقي واحد مما يلي — وإلا فهو زبون:
 *   1) وسم صريح عند الاستقبال (`selfAuthored` / `ownedByMe` من المنصة نفسها)،
 *   2) معرّف الكاتب = معرّف حساب المعرض على المنصة (صفحة فيسبوك، حساب إنستغرام، قناة يوتيوب…)،
 *   3) اسم الكاتب = أحد أسماء حسابات المعرض (مطابقة كاملة بعد التطبيع، لا احتواء)،
 *   4) نصّه مطابق حرفياً (بعد التطبيع) لرد أرسله المعرض فعلاً — يلتقط السجلات القديمة التي
 *      خُزّنت قبل الوسم. لا يُطبَّق على النصوص القصيرة (< 12 حرفاً) كي لا يُستبعد زبون كتب «شكراً».
 *
 * لا شيء هنا يحذف بيانات: الاستبعاد من العرض والإحصاء فقط، والسجل الأصلي يبقى كما هو.
 */

export interface OwnIdentity {
  names: ReadonlySet<string>;
  ids: ReadonlySet<string>;
  replyTexts: ReadonlySet<string>;
}

export interface VoiceComment {
  authorName?: string | null;
  username?: string | null;
  authorId?: string | null;
  authorChannelId?: string | null;
  text?: string | null;
  selfAuthored?: boolean;
  ownedByMe?: boolean;
}

/** أقصر نص يُقارن بردود المعرض (دون ذلك تتشابه عبارات الزبائن والمعرض: «شكراً»، «تم»). */
export const OWN_REPLY_MIN_CHARS = 12;

/** تطبيع الاسم: حذف @ والمسافات الزائدة وحالة الأحرف. */
export function normalizeOwnName(name: unknown): string {
  return String(name ?? '').replace(/^@+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * تطبيع النص للمقارنة: حذف علامات الاقتباس والتشكيل والتطويل وتوحيد المسافات.
 * (المنصات قد تعيد النص بمسافات أو اقتباسات مختلفة عمّا أرسلناه.)
 */
export function normalizeVoiceText(text: unknown): string {
  return String(text ?? '')
    .replace(/[ً-ْـ]/g, '')
    .replace(/["'«»“”‘’`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function buildOwnIdentity(input: { names?: unknown[]; ids?: unknown[]; replyTexts?: unknown[] }): OwnIdentity {
  const names = new Set<string>();
  for (const n of input.names || []) { const v = normalizeOwnName(n); if (v) names.add(v); }
  const ids = new Set<string>();
  for (const i of input.ids || []) { const v = String(i ?? '').trim(); if (v) ids.add(v); }
  const replyTexts = new Set<string>();
  for (const t of input.replyTexts || []) { const v = normalizeVoiceText(t); if (v.length >= OWN_REPLY_MIN_CHARS) replyTexts.add(v); }
  return { names, ids, replyTexts };
}

/** هل هذا التعليق صادر من حساب المعرض نفسه؟ (دليل واحد حقيقي يكفي.) */
export function isOwnVoice(c: VoiceComment | null | undefined, id: OwnIdentity): boolean {
  if (!c) return false;
  if (c.selfAuthored === true || c.ownedByMe === true) return true;
  for (const a of [c.authorId, c.authorChannelId]) { const v = String(a ?? '').trim(); if (v && id.ids.has(v)) return true; }
  for (const n of [c.authorName, c.username]) { const v = normalizeOwnName(n); if (v && id.names.has(v)) return true; }
  const t = normalizeVoiceText(c.text);
  return t.length >= OWN_REPLY_MIN_CHARS && id.replyTexts.has(t);
}

/** تعليقات الزبائن فقط (بلا صوت المعرض). يحفظ الترتيب والكائنات كما هي. */
export function customerVoices<T extends VoiceComment>(comments: readonly T[] | null | undefined, id: OwnIdentity): T[] {
  return (comments || []).filter((c) => !isOwnVoice(c, id));
}
