/**
 * اختبار جودة الرد — تصنيف الاستفسارات الحقيقية من صندوق الزبائن.
 *
 * سبب الوجود (الجذر المُثبت من الإنتاج): مسودات صندوق الزبائن كانت تُولَّد بنصوص
 * غير مناسبة لأسئلة حقيقية:
 *   1) «العنوان والسعر» / «السعر والمكان» / «وين موجودين» تُصنَّف price/availability
 *      بدل location ⇒ يُسأل العميل «خبرني الماركة والمقاس» بدل إعطائه العنوان المسجّل.
 *   2) «بكام سعر» / «شو سعر» / «متاح» تسقط إلى intent=other ⇒ رد عام «شكراً، نورتنا».
 *   3) «في تقسيط» / «عندكم توصيل» تسقط إلى neutral_generic بلا سؤال حقيقي.
 *
 * هذا الاختبار يثبّت الإصلاح: التصنيف الصحيح + الرد المؤرّض من البيانات المسجّلة،
 * مع بقاء حواجز عدم الاختراع (بلا حقائق ⇒ سؤال/تصعيد، لا رقم مُختلق).
 *
 * منطق صافٍ: لا شبكة ولا مزود ولا ساعة.
 */

import { classifyComment, generateReply } from '../social/comments';
import { resolveInquiry } from '../social/inquiryResolver';
import { buildShowroomKnowledge, findKnowledgeMatch } from '../social/showroomKnowledge';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

// حقائق المعرض المسجّلة فعلاً (نفس ما يحقنه الخادم عبر replyFactsForProduct).
const SHOWROOM_FACTS = {
  locationText: 'الطريق كربلاء الطويريج، مقابل العمود 202. - كربلاء',
  hoursText: 'يومياً من 8 صباحاً حتى 8 مساءً.',
  installmentMonthsText: '10 أشهر',
};

const KNOWLEDGE = buildShowroomKnowledge({
  address: 'الطريق كربلاء الطويريج، مقابل العمود 202.',
  city: 'كربلاء',
  phoneUnified: '07728705767',
  workingHours: 'يومياً من 8 صباحاً حتى 8 مساءً.',
  policies: ['المدة الأساسية 10 أشهر.'],
  faqs: [],
  requiredDocuments: ['هوية', 'راتب'],
});

function resolveFor(text: string, opts: { facts?: any; products?: any[]; knowledge?: boolean } = {}) {
  const cls = classifyComment(text);
  const m = opts.knowledge === false ? null : findKnowledgeMatch(text, KNOWLEDGE);
  const knowledge = m ? { answer: m.entry.answer, topic: (m.entry.tags[0] || 'general') } : null;
  const r = resolveInquiry({
    classification: cls, text,
    products: opts.products || [],
    productFacts: opts.facts || {},
    knowledge,
    installmentMonthsText: '10 أشهر',
    buildProductFacts: () => opts.facts || {},
  });
  return { cls, r };
}

// ---------------------------------------------------------------------------
group('1) تصنيف الأسئلة الحقيقية (لا سقوط إلى other/neutral)');

const inquiryCases: Array<[string, string, string]> = [
  ['العنوان والسعر', 'business_inquiry', 'location'],
  ['السعر والمكان', 'business_inquiry', 'location'],
  ['السعر والعنوان', 'business_inquiry', 'location'],
  ['وين موجودين', 'business_inquiry', 'location'],
  ['وين موقعكم', 'question', 'location'],
  ['بكام سعر', 'business_inquiry', 'price'],
  ['شو سعر', 'business_inquiry', 'price'],
  ['كم السعر', 'business_inquiry', 'price'],
  ['سعرها كم', 'business_inquiry', 'price'],
  ['متاح', 'business_inquiry', 'availability'],
  ['اكو موجود', 'business_inquiry', 'availability'],
  ['هل متاح', 'business_inquiry', 'availability'],
  ['في تقسيط', 'business_inquiry', 'general'],
  ['شكد الضمان', 'business_inquiry', 'warranty'],
];
for (const [text, intent, topic] of inquiryCases) {
  const cls = classifyComment(text);
  check(`«${text}» ⇒ intent=${intent}`, cls.intent === intent, `got ${cls.intent}`);
  check(`«${text}» ⇒ topic=${topic}`, cls.topic === topic, `got ${cls.topic}`);
}

// «عندكم توصيل» موضوع delivery بلا كلمة استفهام صريحة ⇒ استفسار لا «محايد».
{
  const cls = classifyComment('عندكم توصيل');
  check('«عندكم توصيل» ⇒ topic=delivery', cls.topic === 'delivery', `got ${cls.topic}`);
  check('«عندكم توصيل» ⇒ استفسار لا محايد', cls.intent !== 'other', `got ${cls.intent}`);
}

// ---------------------------------------------------------------------------
group('2) الرد المؤرّض من البيانات المسجّلة (لا سؤال ماركة/مقاس على سؤال موقع)');

for (const text of ['العنوان والسعر', 'السعر والمكان', 'وين موجودين']) {
  const { r } = resolveFor(text, { facts: SHOWROOM_FACTS });
  check(`«${text}» ⇒ جواب (لا سؤال توضيحي)`, r.kind === 'answer', `got ${r.kind}/${r.strategy}`);
  check(`«${text}» ⇒ يذكر العنوان المسجّل`, r.text.includes('الطويريج'), r.text);
  check(`«${text}» ⇒ لا يسأل عن الماركة والمقاس`, !r.text.includes('الماركة والمقاس'), r.text);
}

{
  const { r } = resolveFor('في تقسيط', { facts: SHOWROOM_FACTS });
  check('«في تقسيط» ⇒ جواب من القاعدة', r.kind === 'answer', `got ${r.kind}/${r.strategy}`);
  check('«في تقسيط» ⇒ يذكر شروط التقسيط المسجّلة', r.text.includes('10 أشهر'), r.text);
}

{
  const { r } = resolveFor('شلون دوامكم', { facts: SHOWROOM_FACTS });
  check('سؤال الدوام ⇒ يذكر الدوام المسجّل', r.kind === 'answer' && r.text.includes('8 صباحاً'), r.text);
}

// ---------------------------------------------------------------------------
group('3) سعر منتج مطابق ⇒ رقم حقيقي (لا اختراع، لا سؤال)');

const PRODUCT = { id: 'p1', name: 'ثلاجة سامسونج', cashPrice: 750000, downPaymentPercent: 0, durationMonths: 10, inStock: true };
const PRODUCT_FACTS = { productName: 'ثلاجة سامسونج', priceText: '750,000 د.ع', monthlyInstallmentText: '75,000 د.ع', inStock: true };
for (const text of ['بكام ثلاجة سامسونج', 'شو سعر ثلاجة سامسونج', 'كم سعر ثلاجة سامسونج']) {
  const { r } = resolveFor(text, { facts: PRODUCT_FACTS, products: [PRODUCT] });
  check(`«${text}» ⇒ جواب سعر موثوق`, r.kind === 'answer' && r.strategy === 'price_trusted', `got ${r.kind}/${r.strategy}`);
  check(`«${text}» ⇒ يذكر السعر المسجّل`, r.text.includes('750,000'), r.text);
}

// ---------------------------------------------------------------------------
group('4) حواجز عدم الاختراع تبقى قائمة');

{
  const { r } = resolveFor('كم السعر', { facts: {} });
  check('سعر بلا حقائق ⇒ لا رقم مُختلق', !/\d{3,}/.test(r.text), r.text);
  check('سعر بلا حقائق ⇒ سؤال/تصعيد لا جواب', r.kind !== 'answer' || r.needsInfo === true, `${r.kind}/${r.strategy}`);
}
{
  const { r } = resolveFor('شكد الضمان', { facts: SHOWROOM_FACTS });
  check('الضمان ⇒ تصعيد للمالك بلا مدة', r.kind === 'escalate' && !/\d/.test(r.text), r.text);
}
{
  const cls = classifyComment('😍');
  check('إيموجي فقط ⇒ مدح لا استفسار', cls.intent === 'praise' && cls.isEmojiOnly === true, `${cls.intent}/${cls.isEmojiOnly}`);
}
{
  const cls = classifyComment('ربح سريع https://spam.example');
  check('سبام ⇒ لا رد آلي', cls.isSpam === true && cls.intent === 'spam', `${cls.intent}`);
}
{
  const cls = classifyComment('عاشت إيدكم');
  check('مدح «عاشت إيدكم» يبقى مدحاً', cls.intent === 'praise', `got ${cls.intent}`);
}

group('5) تنوّع بادئة الرد المؤرّض (ROOT-7: لا تكرار ميكانيكي)');
{
  const facts = { productName: 'ثلاجة سامسونج', priceText: '750,000 د.ع', monthlyInstallmentText: '75,000 د.ع' };
  const prev: string[] = [];
  const openers = new Set<string>();
  let idempotent = true;
  for (let i = 0; i < 4; i++) {
    const r = generateReply(classifyComment('كم سعر الثلاجة؟'), facts, { previousReplies: prev });
    openers.add(r.text.split('،')[0]);
    prev.push(r.text);
    // نفس المدخل بنفس السياق (بلا سابق) ⇒ نفس النص حرفياً.
    if (i === 0) {
      const a = generateReply(classifyComment('كم سعر الثلاجة؟'), facts, {}).text;
      const b = generateReply(classifyComment('كم سعر الثلاجة؟'), facts, {}).text;
      idempotent = a === b;
    }
  }
  check('البادئة تتنوّع عبر المحادثة (≥3 صيغ لـ4 ردود)', openers.size >= 3, [...openers].join(' | '));
  check('نفس المدخل بنفس السياق ⇒ نفس النص (idempotency)', idempotent);
  check('الرد يبقى مؤرّضاً بالبيانات المسجّلة', prev[0].includes('750,000'), prev[0]);
  check('لا كسر لصيغة السعر/القسط', prev[0].includes('75,000'), prev[0]);
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`PASSED: ${passed} reply-quality checks`);
if (failures.length) {
  console.log(`FAILED: ${failures.length}`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
