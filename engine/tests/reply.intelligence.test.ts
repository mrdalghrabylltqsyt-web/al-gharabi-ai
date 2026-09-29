/**
 * اختبار Reply Intelligence — توليد ردود عراقية طبيعية واعية بالسياق.
 *
 * سبب الوجود: كان `buildDeterministicReply` قالباً واحداً لكل نية (4-5 جمل ثابتة)،
 * فتبدو الردود شبه ثابتة مهما اختلف نص التعليق. هذا الاختبار يثبت أن الرد الآن
 * يُشتق من: نص التعليق + معناه + نبرته + نوعه + موضوعه + سياقه + حقائق المعرض
 * الموثوقة، مع الامتناع عن اختراع أي معلومة غير مسجّلة.
 *
 * يغطي:
 *  - وحدة: محرّك generateReply الصافي (بلا شبكة/مزود).
 *  - تكامل: مسار /api/social/manager/comments/classify على خادم حقيقي بحقائق موثوقة.
 */

import express from 'express';
import { registerSocialManagerRoutes } from '../social/routes';
import { classifyComment, generateReply, type ReplyFactSet } from '../social/comments';
import { buildBusinessFacts } from '../social/contentSafety';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const PORT = 5510 + Math.floor(Math.random() * 300);
const PORT2 = PORT + 500;
const TEST_USER = { id: 'owner', role: 'owner' };

// حقائق موثوقة مسجّلة فعلاً (تُحاكي بيانات المعرض) — تُمرَّر كاعتماديات.
const TRUSTED_FACTS: ReplyFactSet = {
  productName: 'غسالة الغرابي',
  priceText: '1,250,000 د.ع',
  locationText: 'بغداد - شارع الصناعة',
  hoursText: 'يومياً من 9 صباحاً إلى 9 مساءً',
  inStock: true,
  hasRecordedPromotion: false,
};

function buildApp(withFacts: boolean) {
  const app = express();
  app.use(express.json());
  const pass: express.RequestHandler = (req, _res, next) => { (req as any).user = TEST_USER; next(); };
  registerSocialManagerRoutes(app, {
    authenticateToken: pass,
    requireOwner: pass,
    workspace: { showroom: { name: 'معرض الغرابي للتقسيط' }, products: [], socialComments: [], socialReplies: [] },
    platformConnections: new Map(),
    persistState: () => {},
    audit: () => {},
    workspaceId: (p: string) => `${p}-test`,
    ...(withFacts
      ? {
          buildReplyFacts: () => TRUSTED_FACTS,
          // نفس حقائق الرد يجب أن تكون هي حقائق حارس السلامة، وإلا حُجب السعر
          // الموثوق باعتباره غير مسجّل.
          buildFacts: () => buildBusinessFacts({ cashPrices: [1_250_000] }),
        }
      : {}),
  });
  return app;
}

async function post(base: string, path: string, body: any): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

function startServer(app: express.Express, port: number): Promise<import('node:http').Server> {
  return new Promise((resolve) => { const s = app.listen(port, () => resolve(s)); });
}

function replyOf(text: string, facts: ReplyFactSet = {}, context: any = {}) {
  return generateReply(classifyComment(text), facts, context);
}

async function main() {
  // ============================================================ وحدة (منطق صافٍ)
  group('1) وحدة: الردود واعية بالمعنى لا قالباً واحداً');

  // كل حالة من الأمثلة السلوكية مطلوبة صراحةً.
  const emoji = replyOf('❤️❤️');
  check('إيموجي فقط ⇒ رد مختصر جداً', emoji.text.length <= 20 && emoji.strategy === 'emoji_ack', emoji.text);

  const thanks = replyOf('شكراً');
  check('«شكراً» ⇒ رد قصير طبيعي', thanks.text.length <= 30 && thanks.strategy === 'thanks_short', thanks.text);

  const iidkum = replyOf('عاشت إيدكم');
  check('«عاشت إيدكم» ⇒ رد شكر عراقي قصير', iidkum.strategy === 'thanks_short' && iidkum.text.length <= 40, iidkum.text);

  const praise = replyOf('ما شاء الله شغلكم مرتب');
  check('مدح «ما شاء الله شغلكم مرتب» ⇒ استراتيجية إعجاب مختلفة', praise.strategy === 'appreciation_warm', praise.text);

  const blessing = replyOf('اللهم صل على محمد وآل محمد');
  check('«اللهم صل على محمد وآل محمد» ⇒ رد محترم مناسب', blessing.strategy === 'blessing_respect', blessing.text);

  const greeting = replyOf('هلا بيكم');
  check('«هلا بيكم» ⇒ رد ترحيبي', greeting.strategy === 'greeting_short', greeting.text);

  const teslamoon = replyOf('تسلمون');
  check('«تسلمون» ⇒ رد شكر', teslamoon.strategy === 'thanks_short', teslamoon.text);

  const allsalam = replyOf('الله يسلمكم');
  check('«الله يسلمكم» ⇒ رد شكر', allsalam.strategy === 'thanks_short', allsalam.text);

  // 2) الردود ليست قالباً واحداً لكل نية.
  const praiseReplies = new Set(['شكراً', 'تسلمون', 'الله يسلمكم', 'عاشت إيدكم', 'هلا بيكم'].map((t) => replyOf(t).text));
  check('مدائح مختلفة تنتج ردوداً مختلفة (لا قالب واحد)', praiseReplies.size >= 4, [...praiseReplies].join(' | '));
  check('«هلا بيكم» و«شكراً» لا يعطيان نفس الرد', replyOf('هلا بيكم').text !== replyOf('شكراً').text);

  // 3) لا اختراع لسعر/موقع بلا حقائق موثوقة.
  const priceNoFacts = replyOf('كم السعر؟');
  check('سؤال السعر بلا حقائق ⇒ لا رقم إطلاقاً ولا اختراع', priceNoFacts.needsInfo === true && !/\d/.test(priceNoFacts.text), priceNoFacts.text);
  const locNoFacts = replyOf('وين موقعكم؟');
  check('سؤال الموقع بلا حقائق ⇒ إحالة بلا اختراع موقع', locNoFacts.needsInfo === true && !/بغداد|شارع/.test(locNoFacts.text), locNoFacts.text);

  // عند توفر حقائق موثوقة ⇒ تُستخدم القيمة الحقيقية فقط.
  const priceTrusted = replyOf('كم السعر؟', TRUSTED_FACTS);
  check('سؤال السعر بحقائق ⇒ يذكر السعر المسجّل فعلاً', priceTrusted.strategy === 'price_trusted' && priceTrusted.text.includes('1,250,000'), priceTrusted.text);
  check('السعر الموثوق يُوسَم في usedFacts', priceTrusted.usedFacts.includes('price'));
  const locTrusted = replyOf('وين موقعكم؟', TRUSTED_FACTS);
  check('سؤال الموقع بحقائق ⇒ يذكر الموقع المسجّل فعلاً', locTrusted.strategy === 'location_trusted' && locTrusted.text.includes('بغداد'), locTrusted.text);

  // 4) لا تكرار ميكانيكي: الصيغة تتغيّر عبر التعليقات، وثابتة لنفس المدخل.
  const a1 = replyOf('شكراً');
  const a2 = replyOf('شكراً');
  check('نفس المدخل ⇒ نفس الرد (ثبات/idempotency)', a1.text === a2.text);
  const dupeGuard = replyOf('شكراً', {}, { previousReplies: [a1.text] });
  check('سياق فيه الرد السابق ⇒ يختار صيغة مختلفة (لا تكرار ميكانيكي)', dupeGuard.text !== a1.text, `${a1.text} vs ${dupeGuard.text}`);

  // 5) الردود القصيرة تبقى قصيرة (لا تُطوَّل إلى فقرة تسويقية).
  const shortOnes = ['شكراً', 'تسلمون', 'عاشت إيدكم', 'هلا بيكم', '❤️❤️'].map((t) => replyOf(t).text);
  check('كل ردود الشكر/التحية/الإيموجي قصيرة (≤ 40 محرفاً)', shortOnes.every((t) => t.length <= 40), shortOnes.join(' | '));

  // 6) الردود لا تتحول إلى إعلان تسويقي.
  const marketingWords = /عرض خاص|خصم|احجز الآن|لا تفوّت|حصري|الأفضل في|تخفيضات/;
  const allReplies = ['شكراً', 'تسلمون', 'هلا بيكم', '❤️❤️', 'ما شاء الله شغلكم مرتب', 'كم السعر؟', 'وين موقعكم؟', 'شي غريب'].map((t) => replyOf(t).text);
  check('لا رد يحمل عبارة إعلانية تسويقية', allReplies.every((t) => !marketingWords.test(t)), allReplies.join(' | '));

  // 7) الشكوى والسبام لا يُولَّد لهما رد آلي.
  const complaint = replyOf('عندي شكوى على التأخير');
  check('شكوى ⇒ escalate=true وبلا رد تسويقي', complaint.escalate === true && complaint.strategy === 'no_reply_sensitive');
  check('«كم السعر» عراقي: الاستفسار التجاري لا يُصنَّف شكوى', classifyComment('كم السعر؟').intent === 'business_inquiry');
  const spam = replyOf('اربح المال https://spam.example');
  check('سبام ⇒ لا رد آلي', spam.text === '' && spam.escalate === true);
  check('سبام لا يُسمح له برد آلي', !['praise', 'question'].includes(classifyComment('اربح المال https://spam.example').intent));

  // 8) تعليق غامض ⇒ رد قصير عام بلا ادعاء.
  const vague = replyOf('شي غريب');
  check('تعليق غامض ⇒ رد قصير عام بلا ادعاء', vague.strategy === 'neutral_generic' && !/\d/.test(vague.text), vague.text);

  // 9) التصنيف يحمل الحقول الجديدة.
  const k = classifyComment('وين موقعكم؟');
  check('التصنيف يستخرج topic=location', k.topic === 'location');
  check('التصنيف يستخرج subIntent للتحية', classifyComment('هلا بيكم').subIntent === 'greeting');
  check('التصنيف يوسم الإيموجي فقط', classifyComment('❤️❤️').isEmojiOnly === true);
  check('التصنيف يحمل النص المطبَّع', typeof k.normalized === 'string' && k.normalized.length > 0);
  check('تعليق فارغ يُحوَّل لمراجعة بشرية ويحمل topic=general', (() => {
    const c = classifyComment('   ');
    return c.requiresHumanReview === true && c.topic === 'general' && c.subIntent === 'none';
  })());

  // fuzz: لا تعليق بسيط يُنتج نصاً يحمل رقماً غير مسجّل.
  check('لا رقم في أي رد حتمي بلا حقائق', allReplies.every((t) => !/\d/.test(t)));

  // ============================================================ تكامل (خادم حقيقي)
  group('2) تكامل: مسار classify على خادم حقيقي ببيانات موثوقة');
  const noFactsApp = await startServer(buildApp(false), PORT);
  const factsApp = await startServer(buildApp(true), PORT2);
  const B1 = `http://127.0.0.1:${PORT}`;
  const B2 = `http://127.0.0.1:${PORT2}`;
  try {
    // بلا حقائق موثوقة: السعر لا يُخترع.
    const cPrice = await post(B1, '/api/social/manager/comments/classify', { text: 'كم السعر؟' });
    check('تكامل: سؤال السعر ينجح', cPrice.status === 200 && cPrice.body.autoReplyAllowed === true);
    check('تكامل: لا رقم مخترع في الرد', !/\d/.test(cPrice.body.suggestedDeterministicReply), cPrice.body.suggestedDeterministicReply);
    check('تكامل: replyIntelligence يعلن الحاجة لمعلومة', cPrice.body.replyIntelligence?.needsInfo === true);
    check('تكامل: تصنيف السعر يوسم topic=price', cPrice.body.classification.topic === 'price');

    // رد قصير فعلاً.
    const cThanks = await post(B1, '/api/social/manager/comments/classify', { text: 'شكراً' });
    check('تكامل: «شكراً» رد قصير', cThanks.body.suggestedDeterministicReply.length <= 40);
    check('تكامل: «شكراً» استراتيجية thanks_short', cThanks.body.replyIntelligence?.strategy === 'thanks_short');

    // شكوى لا تُسمح لها برد آلي.
    const cComplaint = await post(B1, '/api/social/manager/comments/classify', { text: 'عندي شكوى على التأخير' });
    check('تكامل: شكوى لا تسمح برد آلي', cComplaint.body.autoReplyAllowed === false);
    check('تكامل: شكوى بلا رد مقترح', cComplaint.body.suggestedDeterministicReply === null);

    // مع حقائق موثوقة: يُذكر السعر/الموقع الحقيقيان ويمرّان حارس السلامة.
    const tPrice = await post(B2, '/api/social/manager/comments/classify', { text: 'كم السعر؟' });
    check('تكامل(موثوق): الرد يذكر السعر المسجّل', tPrice.body.suggestedDeterministicReply.includes('1,250,000'), tPrice.body.suggestedDeterministicReply);
    check('تكامل(موثوق): الرد اجتاز حارس سلامة المحتوى', tPrice.body.contentSafety?.safe === true);
    check('تكامل(موثوق): usedFacts يحمل price', tPrice.body.replyIntelligence?.usedFacts?.includes('price'));

    const tLoc = await post(B2, '/api/social/manager/comments/classify', { text: 'وين موقعكم؟' });
    check('تكامل(موثوق): الرد يذكر الموقع المسجّل', tLoc.body.suggestedDeterministicReply.includes('بغداد'), tLoc.body.suggestedDeterministicReply);
    check('تكامل(موثوق): الموقع اجتاز حارس السلامة', tLoc.body.contentSafety?.safe === true);

    // عقد الاستجابة يحمل الحقول الجديدة.
    check('تكامل: عقد classify يحمل replyIntelligence', 'replyIntelligence' in tPrice.body);
    check('تكامل: replyIntelligence يحمل strategy/reason', typeof tPrice.body.replyIntelligence.strategy === 'string' && typeof tPrice.body.replyIntelligence.reason === 'string');
  } finally {
    noFactsApp.close();
    factsApp.close();
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} reply intelligence checks`);
}

main().catch((e) => { console.error(e); process.exit(1); });
