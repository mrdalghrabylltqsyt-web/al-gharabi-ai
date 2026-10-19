/**
 * قاعدة معرفة المعرض للإجابة على أسئلة السياسات/الأسئلة الشائعة (منطق صافٍ).
 *
 * الغرض: أي سؤال عن الموقع/الدوام/شروط التقسيط/التوصيل/الضمان يُجاب من **نص مسجّل**
 * حرفياً، لا من صياغة AI ولا من رقم مُختلق. إن لم يوجد نص مسجّل ⇒ لا اختراع (تُعلن
 * الحاجة لمعلومة أو يُصعَّد للمالك).
 *
 * المبادئ الملزمة:
 * - لا شبكة ولا أسرار ولا ساعة. لا استدعاء أي مزود.
 * - المطابقة بتشابه عربي حتمي (تطبيع + كلمات مفتاحية + نسبة تشابه)، وليست تخميناً.
 * - النص المسجّل يُعاد **حرفياً** كما هو (بلا إعادة صياغة) عند اعتماد الإجابة.
 * - الضمان في هذا الإصدار لا يُجاب من القاعدة إطلاقاً — يُحوَّل للمالك دائماً.
 */

/** تطبيع عربي موحّد (توحيد الألف/التاء المربوطة/الهمزات/الياء) وإزالة التشكيل. */
export function normalizeArabicUniform(input: string): string {
  return String(input ?? '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** كلمات وقف عربية شائعة تُستبعد من حساب التشابه (لا تحمل معنى مميّزاً). */
const STOP_WORDS = new Set([
  'من', 'في', 'على', 'عن', 'الى', 'إلى', 'هو', 'هي', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي',
  'هل', 'ما', 'ماذا', 'كيف', 'وين', 'شكد', 'كم', 'عندكم', 'عدكم', 'اكو', 'يوجد', 'شنو',
  'اني', 'انا', 'نحن', 'انت', 'انتم', 'و', 'او', 'أو', 'ثم', 'قد', 'كل', 'بس', 'لو',
]);

/** يحوّل النص إلى مجموعة كلمات دلالية مطبَّعة (بلا كلمات وقف). */
export function tokenizeArabic(input: string): string[] {
  const n = normalizeArabicUniform(input);
  if (!n) return [];
  return n.split(' ').filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/** نسبة تشابه Jaccard بين مجموعتي كلمات (0..1). */
export function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter += 1;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}

/** مدخل قاعدة معرفة مسجّل (سؤال/جواب/وسم/كلمات مفتاحية). */
export interface KnowledgeEntry {
  id: string;
  question: string;
  answer: string;
  tags: string[];
  keywords: string[];
}

/** عتبة اعتماد المطابقة بالتشابه (بعد فشل المطابقة بالكلمات المفتاحية). */
export const KNOWLEDGE_SIMILARITY_THRESHOLD = 0.34;

/** نتيجة البحث في قاعدة المعرفة: نص مسجّل + كيف طابق + درجته. */
export interface KnowledgeMatch {
  entry: KnowledgeEntry;
  /** طريقة المطابقة: كلمات مفتاحية صريحة أو تشابه عربي. */
  method: 'keyword' | 'similarity';
  score: number;
  matchedKeywords: string[];
}

/**
 * يبحث عن أقرب مدخل معرفة لسؤال العميل. الأولوية:
 *  1) تطابق كلمة مفتاحية صريحة (بعد التطبيع) — إشارة قوية.
 *  2) أعلى نسبة تشابه عربي فوق العتبة.
 * يعيد null عند عدم بلوغ العتبة (فلا يُخترع جواب).
 */
export function findKnowledgeMatch(question: string, entries: readonly KnowledgeEntry[]): KnowledgeMatch | null {
  const qNorm = normalizeArabicUniform(question);
  if (!qNorm) return null;
  const qTokens = tokenizeArabic(question);

  let bestKeyword: KnowledgeMatch | null = null;
  let bestSim: KnowledgeMatch | null = null;

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || !entry.answer) continue;
    const matchedKeywords = (entry.keywords || [])
      .map((k) => normalizeArabicUniform(k))
      .filter((k) => k.length >= 3 && qNorm.includes(k));
    if (matchedKeywords.length) {
      // الأطول = الأدقّ؛ وكلما زادت الكلمات المطابقة ارتفع الترجيح.
      const score = matchedKeywords.reduce((s, k) => s + k.length, 0) + matchedKeywords.length * 5;
      if (!bestKeyword || score > bestKeyword.score) {
        bestKeyword = { entry, method: 'keyword', score, matchedKeywords };
      }
      continue;
    }
    const sim = similarity(qTokens, tokenizeArabic(entry.question));
    if (sim >= KNOWLEDGE_SIMILARITY_THRESHOLD && (!bestSim || sim > bestSim.score)) {
      bestSim = { entry, method: 'similarity', score: sim, matchedKeywords: [] };
    }
  }
  return bestKeyword || bestSim;
}

// ---------------------------------------------------------------------------
// بناء مدخلات المعرفة من بيانات المعرض المسجّلة فعلاً (بلا اختراع).
// ---------------------------------------------------------------------------

/** بيانات المعرض اللازمة لبناء القاعدة (كلها مسجّلة يدوياً من المالك). */
export interface ShowroomKnowledgeInput {
  address?: string;
  city?: string;
  phoneUnified?: string;
  whatsappSales?: string;
  workingHours?: string;
  /** شروط التقسيط/السياسات المسجّلة (نصوص حرة يدخلها المالك). */
  policies?: string[];
  /** الأسئلة الشائعة المسجّلة (سؤال/جواب). */
  faqs?: Array<{ id?: string; q: string; a: string; category?: string }>;
  /** المستمسكات المطلوبة للتقسيط (أسماء فقط). */
  requiredDocuments?: string[];
}

/**
 * يبني مدخلات قاعدة المعرفة من بيانات المعرض **المسجّلة فقط**. لا يُنشئ مدخلاً
 * بلا نص مسجّل (مثلاً: لا مدخل موقع إن لم يُسجَّل عنوان). الضمان لا يُبنى إطلاقاً
 * (يُحوَّل للمالك دائماً في هذا الإصدار).
 */
export function buildShowroomKnowledge(input: ShowroomKnowledgeInput): KnowledgeEntry[] {
  const entries: KnowledgeEntry[] = [];
  const addr = [input.address, input.city].map((x) => String(x ?? '').trim()).filter(Boolean).join(' - ');
  if (addr) {
    entries.push({
      id: 'kb:location',
      question: 'وين موقعكم؟ شكد عنوان المعرض؟',
      answer: addr,
      tags: ['location'],
      keywords: ['موقع', 'وين', 'عنوان', 'مكان', 'فرع', 'صاير', 'موقعكم', 'مكانكم'],
    });
  }
  const hours = String(input.workingHours ?? '').trim();
  if (hours) {
    entries.push({
      id: 'kb:hours',
      question: 'شكد دوامكم؟ شنو اوقات العمل؟',
      answer: hours,
      tags: ['hours'],
      keywords: ['دوام', 'دوامكم', 'اوقات', 'وقت', 'تفتحون', 'تفتح', 'تغلقون', 'ساعات', 'مفتوح'],
    });
  }
  const phone = String(input.phoneUnified || input.whatsappSales || '').trim();
  if (phone) {
    entries.push({
      id: 'kb:phone',
      question: 'شنو رقمكم؟ شلون اتواصل وياكم؟',
      answer: phone,
      tags: ['contact'],
      keywords: ['رقم', 'هاتف', 'موبايل', 'اتواصل', 'تواصل', 'واتساب', 'تلفون', 'رقمكم'],
    });
  }
  // شروط التقسيط: تُبنى من النصوص المسجّلة (سياسات + مستمسكات) حرفياً.
  const policyTexts = (input.policies || []).map((p) => String(p ?? '').trim()).filter(Boolean);
  const docs = (input.requiredDocuments || []).map((d) => String(d ?? '').trim()).filter(Boolean);
  if (policyTexts.length || docs.length) {
    const parts: string[] = [];
    if (policyTexts.length) parts.push(policyTexts.join(' '));
    if (docs.length) parts.push(`المستمسكات المطلوبة: ${docs.join('، ')}.`);
    entries.push({
      id: 'kb:terms',
      question: 'شنو شروط التقسيط؟ شلون يصير التقسيط؟',
      answer: parts.join(' ').trim(),
      tags: ['installment_terms'],
      keywords: ['شروط', 'شرط', 'تقسيط', 'اقساط', 'مستمسكات', 'مستندات', 'ورق', 'دفعه', 'مقدم', 'راتب', 'ماستر'],
    });
  }
  // الأسئلة الشائعة المسجّلة (سؤال/جواب) — تُضاف كما هي حرفياً.
  for (const faq of Array.isArray(input.faqs) ? input.faqs : []) {
    const q = String(faq?.q ?? '').trim();
    const a = String(faq?.a ?? '').trim();
    if (!q || !a) continue;
    entries.push({
      id: `kb:faq:${String(faq?.id || q).slice(0, 60)}`,
      question: q,
      answer: a,
      tags: [String(faq?.category || 'faq').trim() || 'faq'],
      keywords: [],
    });
  }
  return entries;
}
