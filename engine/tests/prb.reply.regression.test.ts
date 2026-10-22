/**
 * PR-B — اختبار انحدار بجودة الرد على التعليقات التسعة حرفياً + البنود الستة الأخرى.
 *
 * يتحقق من:
 *  1) الترحيب المحايد: لا «هلا بيك»/«مرحبا بيك» في أي رد مولَّد من أي قالب.
 *  2) رد الموقع: العنوان ثم الدوام ثم الهاتف (من المسجّل فقط، والغائب لا يُذكر).
 *  3) السؤال المركّب (عنوان+سعر): رد واحد يجيب الموضوعين.
 *  4) رد سابق من الصفحة ⇒ لا مسودة + SKIP_PAGE_ALREADY_REPLIED.
 *  5) «في تقسيط» ⇒ يبدأ بعد الترحيب بـ«نعم».
 *  6) شارة Gemini في الترويسة: المنطق الصادق (لا «محمي/غير مفعّل»).
 *  7) ربط منشور بمنتج: التحقق من وجود المنتج (منطق الخادم).
 *
 * منطق صافٍ: لا شبكة ولا مزود ولا ساعة.
 */

import { classifyComment, generateReply, type ReplyFactSet } from '../social/comments';
import { resolveInquiry } from '../social/inquiryResolver';
import { buildShowroomKnowledge, findKnowledgeMatch } from '../social/showroomKnowledge';
import { decideCommentAction } from '../social/youtubeWatcher';
import { describeGeminiBadge } from '../../src/services/geminiBadge';
import { resolveProductLink, FORBIDDEN_GENDERED_OPENERS } from '../social/replyQuality';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

// بيانات المعرض المسجّلة (نفس ما يحقنه الخادم عبر replyFactsForProduct).
const FACTS: ReplyFactSet = {
  locationText: 'الطريق كربلاء الطويريج، مقابل العمود 202. - كربلاء',
  hoursText: 'يومياً من 8 صباحاً حتى 8 مساءً.',
  phoneText: '07728705767',
  installmentMonthsText: '10 أشهر',
};

const KNOWLEDGE = buildShowroomKnowledge({
  address: 'الطريق كربلاء الطويريج، مقابل العمود 202.',
  city: 'كربلاء',
  phoneUnified: '07728705767',
  workingHours: 'يومياً من 8 صباحاً حتى 8 مساءً.',
  policies: ['المدة الأساسية 10 أشهر.'],
  faqs: [],
});

/** يمرّ بالنظام كاملاً كما يمرّ به رد المراقب (classification → knowledge → resolveInquiry). */
function fullReply(text: string, facts: ReplyFactSet = FACTS, products: any[] = []) {
  const cls = classifyComment(text);
  const m = findKnowledgeMatch(text, KNOWLEDGE);
  const knowledge = m ? { answer: m.entry.answer, topic: (m.entry.tags[0] || 'general') } : null;
  const r = resolveInquiry({
    classification: cls, text,
    products,
    productFacts: facts,
    knowledge,
    installmentMonthsText: '10 أشهر',
    buildProductFacts: () => facts,
  });
  return { cls, r };
}

// التعليقات التسعة حرفياً (كما وردت في المهمة).
const NINE = ['العنوان والسعر', 'السعر والمكان', 'السعر والعنوان', 'وين موجودين', 'في تقسيط', 'كم السعر', 'بكام سعر', 'شو سعر', 'متاح'] as const;

// ---------------------------------------------------------------------------
group('0) الترحيب المحايد — لا «هلا بيك»/«مرحبا بيك» في أي رد مولَّد (البند 1)');

for (const text of NINE) {
  const { r } = fullReply(text);
  const bad = FORBIDDEN_GENDERED_OPENERS.filter((b) => r.text.includes(b));
  check(`«${text}» ⇒ بلا صيغة تفترض الجنس`, bad.length === 0, `${bad.join(',')} — ${r.text}`);
}

// كل مسارات المحرّك (سعر/موقع/دوام/تقسيط/توضيح/شكوى/خارج النطاق) تُفحص أيضاً.
for (const probe of ['كم السعر', 'وين موقعكم', 'شكد الضمان', 'شلون دوامكم', 'في تقسيط', 'شي غريب سؤال', 'اشتكي من خدمة']) {
  const { r } = fullReply(probe);
  const bad = FORBIDDEN_GENDERED_OPENERS.filter((b) => r.text.includes(b));
  check(`مسارات المحرّك «${probe}» بلا صيغة مجنّسة`, bad.length === 0, `${bad.join(',')} — ${r.text}`);
}

// القوالب المباشرة (بلا قاعدة معرفة) — سعر بلا حقائق / موقع بلا حقائق / دوام بلا حقائق.
for (const [probe, noFacts] of [
  ['كم السعر', {}], ['وين موقعكم', {}], ['شلون دوامكم', {}], ['في تقسيط', {}],
] as Array<[string, ReplyFactSet]>) {
  const g = generateReply(classifyComment(probe), noFacts, {});
  const bad = FORBIDDEN_GENDERED_OPENERS.filter((b) => g.text.includes(b));
  check(`قالب «${probe}» (بلا حقائق) بلا صيغة مجنّسة`, bad.length === 0, `${bad.join(',')} — ${g.text}`);
}

// ---------------------------------------------------------------------------
group('1) «وين موجودين» ⇒ العنوان + الدوام + الهاتف (البند 2)');

{
  const { r } = fullReply('وين موجودين');
  check('يذكر العنوان المسجّل', r.text.includes('الطويريج'), r.text);
  check('يذكر أوقات الدوام (8 صباحاً)', r.text.includes('8 صباحاً'), r.text);
  check('يذكر رقم الهاتف/الواتساب', r.text.includes('07728705767'), r.text);
  check('ترتيب: العنوان قبل الدوام قبل الهاتف', r.text.indexOf('الطويريج') < r.text.indexOf('8 صباحاً') && r.text.indexOf('8 صباحاً') < r.text.indexOf('07728705767'), r.text);
}
{
  // الحقل الغائب لا يُذكر ولا يُخترع (بلا هاتف).
  const { r } = fullReply('وين موجودين', { locationText: 'الطويريج', hoursText: 'من 8 صباحاً حتى 8 مساءً' });
  check('غياب الهاتف ⇒ لا رقم مُختلق', !/\d{7,}/.test(r.text), r.text);
  check('غياب الهاتف ⇒ يبقى العنوان والدوام', r.text.includes('الطويريج') && r.text.includes('8 صباحاً'), r.text);
}

// ---------------------------------------------------------------------------
group('2) السؤال المركّب (عنوان+سعر) ⇒ رد واحد يجيب الموضوعين (البند 3)');

for (const text of ['العنوان والسعر', 'السعر والمكان', 'السعر والعنوان']) {
  const { r } = fullReply(text);
  check(`«${text}» ⇒ جواب (لا سؤال توضيحي)`, r.kind === 'answer', `${r.kind}/${r.strategy}`);
  check(`«${text}» ⇒ يذكر العنوان`, r.text.includes('الطويريج'), r.text);
  const hasPriceNumber = /\d{3,}/.test(r.text);
  const invitesContact = /الخاص|الواتساب|راسلنا/.test(r.text);
  check(`«${text}» ⇒ إشارة سعر (رقم حقيقي أو دعوة للتواصل)`, hasPriceNumber || invitesContact, r.text);
  check(`«${text}» ⇒ يذكر الدوام كذلك`, r.text.includes('8 صباحاً'), r.text);
}
{
  // منتج معروف ⇒ رقم السعر الحقيقي يظهر في الرد المركّب.
  const productFacts: ReplyFactSet = { ...FACTS, productName: 'ثلاجة سامسونج', priceText: '750,000 د.ع', monthlyInstallmentText: '75,000 د.ع' };
  const product = { id: 'p1', name: 'ثلاجة سامسونج', cashPrice: 750000 };
  const { r } = fullReply('العنوان وسعر ثلاجة سامسونج', productFacts, [product]);
  check('سؤال مركّب بمنتج معروف ⇒ يذكر السعر الحقيقي', r.text.includes('750,000'), r.text);
  check('سؤال مركّب بمنتج معروف ⇒ يذكر العنوان أيضاً', r.text.includes('الطويريج'), r.text);
}

// ---------------------------------------------------------------------------
group('3) «في تقسيط» ⇒ يبدأ بعد الترحيب بـ«نعم» (البند 5)');

for (const text of ['في تقسيط', 'عدكم تقسيط', 'اكو تقسيط']) {
  const { r } = fullReply(text);
  check(`«${text}» ⇒ جواب`, r.kind === 'answer', `${r.kind}/${r.strategy}`);
  // بعد بادئة الترحيب (حتى أول فاصلة) يجب أن يبدأ المتن بـ«نعم».
  const afterOpener = r.text.split('،').slice(1).join('،').trim();
  check(`«${text}» ⇒ يبدأ بعد الترحيب بـ«نعم»`, afterOpener.startsWith('نعم'), r.text);
  check(`«${text}» ⇒ يذكر المدة المسجّلة`, r.text.includes('10 أشهر'), r.text);
}

// ---------------------------------------------------------------------------
group('4) رد سابق من الصفحة ⇒ لا مسودة + SKIP_PAGE_ALREADY_REPLIED (البند 4)');

{
  const controls = { enabled: true, paused: false, autoReply: true, humanReviewMode: false, autoPublish: false, autoSchedule: false, cadenceMinutes: 1 };
  const base = { intent: 'question', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: controls as any };
  const withoutPage = decideCommentAction(base);
  check('بلا رد سابق من الصفحة ⇒ لا كود SKIP_PAGE_ALREADY_REPLIED', withoutPage.code !== 'SKIP_PAGE_ALREADY_REPLIED', withoutPage.code);
  const withPage = decideCommentAction({ ...base, pageAlreadyReplied: true });
  check('رد سابق من الصفحة ⇒ skip', withPage.action === 'skip', withPage.action);
  check('رد سابق من الصفحة ⇒ SKIP_PAGE_ALREADY_REPLIED', withPage.code === 'SKIP_PAGE_ALREADY_REPLIED', withPage.code);
}

// ---------------------------------------------------------------------------
group('5) شارة Gemini في الترويسة (البند 6)');

{
  const enabled = describeGeminiBadge({ status: 'ok', aiEnabled: true, geminiUsage: { firewall: { protectionEnabled: true } } });
  check('aiEnabled=true ⇒ «Gemini مفعّل»', enabled.label === 'Gemini مفعّل', enabled.label);
  check('aiEnabled=true ⇒ لا نص «محمي/غير مفعّل»', !/محمي\/غير مفعّل/.test(enabled.label), enabled.label);
  check('aiEnabled=true ⇒ الحماية تُذكر في العنوان لا النص', enabled.title.includes('حماية'), enabled.title);

  const det = describeGeminiBadge({ status: 'ok', aiEnabled: false, geminiUsage: { firewall: { protectionEnabled: true } } });
  check('بلا مفتاح + حماية ⇒ «محرّك حتمي» لا «محمي/غير مفعّل»', det.label === 'Gemini: محرّك حتمي', det.label);

  const offline = describeGeminiBadge(null);
  check('تعذّر الجلب ⇒ «غير معروف»', offline.tone === 'unknown', offline.label);

  // 503 مع جسم صحيح (عطل مخزن) ⇒ يُقرأ aiEnabled بلا «offline».
  const degraded = describeGeminiBadge({ status: 'degraded', aiEnabled: true });
  check('503/جسم صحيح ⇒ يُقرأ aiEnabled=true', degraded.label === 'Gemini مفعّل', degraded.label);
}

// ---------------------------------------------------------------------------
group('6) ربط منشور بمنتج — تحقق وجود المنتج (البند 7)');

{
  const products = [{ id: 'p1', name: 'ثلاجة' }, { id: 'p2', name: 'غسالة' }];
  check('معرّف منتج موجود ⇒ يُربط', resolveProductLink('p1', products) === 'p1', String(resolveProductLink('p1', products)));
  check('معرّف منتج غير موجود ⇒ لا ربط (undefined)', resolveProductLink('nope', products) === undefined, String(resolveProductLink('nope', products)));
  check('قيمة فارغة ⇒ فكّ الربط (undefined)', resolveProductLink('', products) === undefined, String(resolveProductLink('', products)));
  check('بلا منتجات ⇒ لا ربط بالتخمين', resolveProductLink('p1', []) === undefined, String(resolveProductLink('p1', [])));
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`PASSED: ${passed} PR-B regression checks`);
if (failures.length) {
  console.log(`FAILED: ${failures.length}`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
