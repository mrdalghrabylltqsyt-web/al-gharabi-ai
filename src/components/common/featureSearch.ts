/**
 * البحث الشامل في الأقسام والوظائف (2026-10-28).
 *
 * كان البحث يطابق نصاً حرفياً على ~25 اسم تبويب فقط، فلا يجد «غرفة المهندس» ولا «النسخ
 * الاحتياطي» ولا أي لوحة داخل الشاشات، ويفشل مع اختلاف الكتابة (أ/ا، ة/ه، ى/ي، «ال»).
 * الآن يبحث في ثلاثة مصادر معاً:
 *   1. شجرة التنقل (الأقسام والفروع والوظائف) — navConfig.
 *   2. كل عنوان لوحة وتبويب داخلي في كل شاشة — مُولَّد من الكود (searchIndex.generated.ts).
 *   3. وظائف مسمّاة يدوياً بمرادفاتها (FEATURE_ALIASES) لما يبحث عنه المالك بكلماته.
 * ومطابقة عربية مُطبَّعة: كل كلمة في البحث يجب أن تظهر (بداية كلمة أو جزءاً منها).
 */
import { NAV_SECTIONS, visibleSectionBranches, type NavLeaf } from './navConfig';
import { GENERATED_SEARCH_INDEX } from '../../data/searchIndex.generated';

export interface FeatureHit {
  key: string;
  /** العنوان الظاهر في النتيجة. */
  title: string;
  /** الشاشة التي تُفتح. */
  tab: string;
  /** اسم الشاشة للعرض («داخل: غرفة العقل الحية»). */
  tabLabel: string;
  /** ما يُبحث عنه داخل الشاشة لإبرازه بعد الفتح (عنوان لوحة أو زر تبويب داخلي). */
  anchor: string | null;
  anchorKind: 'panel' | 'tab' | null;
  desc: string;
  score: number;
}

interface IndexEntry {
  title: string;
  tab: string;
  anchor: string | null;
  anchorKind: 'panel' | 'tab' | null;
  desc: string;
  keywords: string[];
  /** وزن المصدر: الوظائف الرئيسية والمسمّاة يدوياً أولاً. */
  weight: number;
}

/**
 * وظائف بأسماء المالك ومرادفاتها — ما لا يظهر حرفياً كعنوان. كل عنصر يشير إلى شاشة حقيقية
 * وإلى عنوان لوحة موجود فيها فعلاً (اختبار يتحقق أن كل anchor موجود في الفهرس المولَّد).
 */
export const FEATURE_ALIASES: Array<{ title: string; tab: string; anchor: string | null; desc: string; keywords: string[] }> = [
  { title: 'غرفة المهندس المشرف', tab: 'live_room', anchor: 'المهندس المشرف — حارس المشروع', desc: 'الأعطال الحقيقية، ثغرات الإعداد، تقارير الإصلاح، وصحة المشروع', keywords: ['مهندس', 'المهندس', 'عنكبوت', 'سبايدر', 'spider', 'engineer', 'مشرف', 'حارس', 'دورية', 'patrol', 'إصلاح', 'اصلاح'] },
  { title: 'الأعطال الحقيقية', tab: 'live_room', anchor: 'المهندس المشرف — حارس المشروع', desc: 'كل طلب فشل، استثناء، انهيار شاشة، رفض منصة، أو عملية بطيئة — مع التشخيص والعلاج', keywords: ['أعطال', 'اعطال', 'عطل', 'أخطاء', 'اخطاء', 'خطأ', 'خلل', 'مشاكل', 'مشكلة', 'defects', 'errors', 'bugs', '500', 'انهيار'] },
  { title: 'صحة المشروع', tab: 'live_room', anchor: 'المهندس المشرف — حارس المشروع', desc: 'نسبة صحة موزونة بالأثر مع سبب كل نقطة', keywords: ['صحة', 'health', 'score', 'نسبة', 'حالة المشروع'] },
  { title: 'الشاشة الحية الكاملة', tab: 'live_room', anchor: 'الشاشة الحية — اللوحة الحية كاملة', desc: 'كل اللوحات الحية في شاشة واحدة', keywords: ['شاشة حية', 'حائط', 'wall', 'live', 'مباشر'] },
  { title: 'مفتاح الإيقاف الطارئ الشامل', tab: 'live_room', anchor: 'مركز السيطرة والأمان', desc: 'إيقاف كل الإرسال والنشر الآلي بضغطة', keywords: ['إيقاف', 'ايقاف', 'طوارئ', 'طارئ', 'kill', 'stop', 'أمان'] },
  { title: 'إشعارات وتنبيهات المالك', tab: 'live_room', anchor: 'مركز السيطرة والأمان', desc: 'كل التنبيهات والإشعارات والتصعيدات في مكان واحد', keywords: ['إشعارات', 'اشعارات', 'تنبيهات', 'تنبيه', 'notifications', 'alerts', 'تصعيد'] },
  { title: 'التنبيهات الحرجة غير المقروءة', tab: 'live_room', anchor: 'مركز السيطرة والأمان', desc: 'اقرأها من «تنبيهات النظام» ← «اعرضها الآن» أو تبويب «الحرجة»', keywords: ['حرجة', 'حرج', 'تنبيهات حرجة', 'غير مقروءة', 'critical', 'إعادة ربط'] },
  { title: 'حالات الزبائن المصعّدة (تحتاج تدخّلك)', tab: 'live_room', anchor: 'مركز السيطرة والأمان', desc: 'شكاوى وطلبات بشرية أوقف العقل الرد عليها — اطّلعت/حُلّت/الرد اليدوي', keywords: ['تصعيد', 'تصعيدات', 'مصعدة', 'حالات', 'شكوى', 'شكاوى', 'تدخل', 'escalations'] },
  { title: 'ذاكرة الخادم والأداء', tab: 'live_room', anchor: 'جسد الخادم — مقاييس حيّة', desc: 'الذاكرة، سرعة الاستجابة، وضغط الخطة المجانية', keywords: ['ذاكرة', 'memory', 'ram', 'أداء', 'بطء', 'سرعة', 'خادم', 'server'] },
  { title: 'نبض الدورات (المراقبين)', tab: 'live_room', anchor: 'نبض الدورات 24/7', desc: 'هل يعمل مراقب يوتيوب/ميتا/تيليغرام والعقل الآن', keywords: ['دورات', 'مراقب', 'watcher', 'cycles', 'نبض'] },
  { title: 'النسخ الاحتياطي والاستعادة', tab: 'cloud_backup', anchor: null, desc: 'Google Drive، نقاط الاستعادة، وخزنة المفاتيح', keywords: ['نسخ', 'نسخة', 'احتياطي', 'backup', 'استعادة', 'restore', 'drive', 'درايف', 'تعافي'] },
  { title: 'ربط منصة (فيسبوك، يوتيوب، تيك توك…)', tab: 'platform_connections', anchor: null, desc: 'ربط وإعادة ربط المنصات العشر وحالة كل منها', keywords: ['ربط', 'اربط', 'اتصال', 'oauth', 'فيسبوك', 'facebook', 'انستغرام', 'instagram', 'يوتيوب', 'youtube', 'تيك توك', 'tiktok', 'تيليغرام', 'telegram', 'ثريدز', 'threads', 'واتساب', 'whatsapp', 'جوجل', 'google'] },
  { title: 'الردود الجاهزة بانتظار موافقتك', tab: 'commercial_inbox', anchor: null, desc: 'ردود جاهزة على التعليقات والرسائل — أرسلها بنقرة', keywords: ['ردود', 'رد', 'موافقة', 'جاهز', 'replies', 'approve', 'إرسال'] },
  { title: 'وضع الإرسال (موافقة / تلقائي)', tab: 'commercial_kill_switch', anchor: null, desc: 'هل تُرسل الردود بلا مراجعتك', keywords: ['تلقائي', 'آلي', 'الي', 'auto', 'وضع الإرسال', 'موافقة'] },
  { title: 'حالة الخادم والجاهزية', tab: 'system', anchor: null, desc: 'Health/Readiness والخدمات وسجل العمليات', keywords: ['health', 'readiness', 'جاهزية', 'سجل', 'logs', 'خدمات'] },
  { title: 'الأقساط وحاسبة التقسيط', tab: 'database', anchor: null, desc: 'خطط التقسيط وأسعار المنتجات', keywords: ['قسط', 'أقساط', 'اقساط', 'تقسيط', 'installment', 'حاسبة', 'سعر', 'أسعار'] },
  { title: 'جدولة منشور', tab: 'calendar', anchor: null, desc: 'التقويم وأوقات النشر', keywords: ['جدولة', 'موعد', 'تقويم', 'schedule', 'calendar'] },
  { title: 'إنشاء منشور أو فيديو', tab: 'content', anchor: null, desc: 'توليد نص المنشور وتكييفه لكل منصة', keywords: ['منشور', 'بوست', 'post', 'فيديو', 'ريلز', 'reels', 'محتوى', 'كتابة', 'هاشتاغ'] },
  { title: 'المستخدمون وكلمات الدخول', tab: 'users', anchor: null, desc: 'الأدوار والجلسات والصلاحيات', keywords: ['مستخدم', 'صلاحيات', 'دخول', 'جلسة', 'جلسات', 'login', 'otp', 'رمز'] },
];

/** تطبيع عربي: بلا تشكيل ولا تطويل، توحيد الهمزات والتاء المربوطة والياء، وأرقام لاتينية. */
export function normalizeArabic(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** كلمات بلا «ال» التعريف وبلا حروف الجر الملتصقة الشائعة (و/ب/ل) — للمطابقة فقط. */
function stems(normalized: string): string[] {
  const out: string[] = [];
  for (const w of normalized.split(' ').filter(Boolean)) {
    out.push(w);
    const noAl = w.replace(/^(و|ب|ل|ف|ك)?ال(?=\p{L}{2,})/u, '');
    if (noAl !== w) out.push(noAl);
  }
  return out;
}

const TAB_LABELS: Record<string, string> = Object.fromEntries(
  NAV_SECTIONS.flatMap((s) => s.branches.flatMap((b) => b.items.map((l) => [l.id, l.label]))),
);

/** الفهرس الكامل لدور المستخدم (الشاشات المخفية أو الخاصة بالمالك لا تظهر لغيره). */
export function buildFeatureIndex(isOwner: boolean): IndexEntry[] {
  const visible = new Map<string, NavLeaf>();
  for (const s of NAV_SECTIONS) {
    if (s.ownerOnly && !isOwner) continue;
    for (const b of visibleSectionBranches(s, isOwner)) for (const l of b.items) if (!visible.has(l.id)) visible.set(l.id, l);
  }
  const out: IndexEntry[] = [];
  for (const [id, l] of visible) {
    out.push({ title: l.label, tab: id, anchor: null, anchorKind: null, desc: l.desc, keywords: l.keywords || [], weight: 3 });
  }
  for (const a of FEATURE_ALIASES) {
    if (!visible.has(a.tab)) continue;
    out.push({ title: a.title, tab: a.tab, anchor: a.anchor, anchorKind: a.anchor ? 'panel' : null, desc: a.desc, keywords: a.keywords, weight: 3 });
  }
  for (const g of GENERATED_SEARCH_INDEX) {
    if (!visible.has(g.tab)) continue;
    out.push({ title: g.title, tab: g.tab, anchor: g.title, anchorKind: g.kind, desc: '', keywords: [], weight: g.kind === 'panel' ? 2 : 1 });
  }
  return out;
}

const indexCache = new Map<boolean, Array<IndexEntry & { nTitle: string; nAll: string[] }>>();
function preparedIndex(isOwner: boolean) {
  let idx = indexCache.get(isOwner);
  if (!idx) {
    idx = buildFeatureIndex(isOwner).map((e) => {
      const nTitle = normalizeArabic(e.title);
      const nAll = stems(normalizeArabic([e.title, e.desc, ...e.keywords, TAB_LABELS[e.tab] || ''].join(' ')));
      return { ...e, nTitle, nAll };
    });
    indexCache.set(isOwner, idx);
  }
  return idx;
}

/**
 * يبحث في كل وظائف المشروع. كل كلمة في الاستعلام يجب أن تطابق (بداية كلمة أو جزءاً منها)
 * في العنوان أو الوصف أو المرادفات. الترتيب: مطابقة العنوان أولاً، ثم الوزن، ثم الأقصر.
 */
export function searchFeatures(query: string, isOwner: boolean, limit = 40): FeatureHit[] {
  const q = normalizeArabic(query);
  if (!q) return [];
  const qTokens = stems(q).filter((t, i, a) => a.indexOf(t) === i);
  const words = q.split(' ');
  const hits: FeatureHit[] = [];
  const seen = new Set<string>();
  for (const e of preparedIndex(isOwner)) {
    // كل كلمة من كلمات البحث (أو جذرها بلا «ال») يجب أن تظهر.
    const ok = words.every((w) => {
      const variants = stems(w);
      return variants.some((v) => e.nAll.some((t) => t.startsWith(v) || (v.length >= 3 && t.includes(v))));
    });
    if (!ok) continue;
    let score = e.weight * 10;
    if (e.nTitle === q) score += 100;
    else if (e.nTitle.startsWith(q)) score += 60;
    else if (e.nTitle.includes(q)) score += 40;
    else if (qTokens.every((t) => e.nTitle.includes(t))) score += 25;
    score -= Math.min(15, Math.floor(e.title.length / 8));
    const key = `${e.tab}|${e.nTitle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ key, title: e.title, tab: e.tab, tabLabel: TAB_LABELS[e.tab] || e.tab, anchor: e.anchor, anchorKind: e.anchorKind, desc: e.desc, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.length - b.title.length).slice(0, limit);
}

/**
 * بعد فتح الشاشة: يجد العنوان المطلوب داخلها، يمرّر إليه، يفتح ما كان مطوياً (details)،
 * يضغط التبويب الداخلي إن كان الهدف تبويباً، ويبرزه لحظة. يعيد المحاولة حتى تُحمَّل الشاشة.
 */
export function focusFeature(anchor: string | null, kind: 'panel' | 'tab' | null, timeoutMs = 4000): void {
  if (!anchor || typeof document === 'undefined') return;
  const target = normalizeArabic(anchor);
  const started = Date.now();
  const attempt = () => {
    const root = document.querySelector('main') || document.body;
    const selector = kind === 'tab' ? 'button, [role="tab"], a, h1, h2, h3, h4, summary' : 'h1, h2, h3, h4, summary, legend, [aria-label]';
    let found: HTMLElement | null = null;
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
      const text = normalizeArabic(el.getAttribute('aria-label') || el.textContent || '');
      if (text && (text === target || text.includes(target))) { found = el; break; }
    }
    if (!found) { if (Date.now() - started < timeoutMs) window.setTimeout(attempt, 200); return; }
    const details = found.closest('details');
    if (details && !details.open) details.open = true;
    if (kind === 'tab' && (found.tagName === 'BUTTON' || found.getAttribute('role') === 'tab')) { try { found.click(); } catch { /* تجاهل */ } }
    const box = (found.closest('section') as HTMLElement | null) || found;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const prev = box.style.outline; const prevOff = box.style.outlineOffset;
    box.style.outline = '2px solid #34D399'; box.style.outlineOffset = '4px';
    window.setTimeout(() => { box.style.outline = prev; box.style.outlineOffset = prevOff; }, 2200);
  };
  window.setTimeout(attempt, 120);
}
