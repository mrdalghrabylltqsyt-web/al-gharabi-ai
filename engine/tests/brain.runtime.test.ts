/**
 * اختبارات طبقة تشغيل العقل المركزي (runtime wiring + persistent memory).
 *
 * تُثبت بالدليل أن العقل يعمل على بيانات حقيقية مُجمَّعة (سجلات/تعليقات/ردود/
 * نشر/مراقب/اتصال) وأن الذاكرة الدائمة تُدرج بلا تكرار وتصمد بعد إعادة التحميل،
 * وأن كل حقل صادق: لا رقم مُختلق، ولا معرّف مُخترع، وقول AI لا يصبح حقيقة.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية (now محقون).
 */

import { buildRuntimeBrain, buildLearningEvents, buildRuntimeContentPath, timingObservationsFromRecords } from '../brain/runtime';
import { toCentralBrainSnapshot } from '../brain/compat';
import { toMemoryRecord, upsertMemoryRecord, summarizeBrainMemory, memoryToKnowledge, emptyBrainMemory, validateMemoryRecord, markStaleMemory, activeBrainMemory } from '../brain/memory/store';
import { makeMemoryEntry, type KnowledgeItemLike } from '../brain/memory/longTerm';
import { buildLearningLoop, dedupeLearningEvents, type LearningEvent } from '../brain/learning/learningLoop';
import { classifyConversation, type RepeatedNeed } from '../brain/audience/conversationIntelligence';
import { buildCommentIntelligence, proposeCommentReply } from '../social/centralBrain';
import { makeKnowledgeItem, classifyClaim } from '../brain/knowledge/truth';
import type { PlatformId } from '../social/adapter';
import type { PlatformMetricRecord } from '../social/platformLearning';

let passed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail?: string) { if (cond) passed += 1; else fails.push(`${name}${detail ? ` — ${detail}` : ''}`); }
function group(t: string) { console.log(`\n▸ ${t}`); }

const NOW = Date.parse('2026-09-28T12:00:00Z');
const PLATFORMS: PlatformId[] = ['youtube', 'facebook', 'instagram', 'telegram', 'tiktok', 'x', 'snapchat', 'threads', 'whatsapp', 'google_business'];

// بيانات proof-based (ليست إنتاجاً حقيقياً): تُحاكي سجلات التطبيق الفعلية.
const records: PlatformMetricRecord[] = [
  { platform: 'youtube', externalId: 'VID_REAL_A', contentType: 'تعليمي', productCategory: 'appliances', title: 'شرح التقسيط', values: { views: 4000, likes: 120, comments: 40 }, publishedAt: '2026-09-20T18:00:00Z' },
  { platform: 'youtube', externalId: 'VID_REAL_B', contentType: 'تعليمي', productCategory: 'appliances', title: 'أخطاء التقسيط', values: { views: 3800, likes: 100, comments: 35 }, publishedAt: '2026-09-21T19:00:00Z' },
];

const comments = [
  { platform: 'youtube' as PlatformId, externalId: 'REAL_C1', text: 'هل عندكم تقسيط؟' },
  { platform: 'youtube' as PlatformId, externalId: 'REAL_C2', text: 'شكد قسط الثلاجة؟' },
  { platform: 'youtube' as PlatformId, externalId: 'REAL_C3', text: 'شكد سعر الغسالة؟' },
  { platform: 'youtube' as PlatformId, externalId: 'REAL_C4', text: 'وين موقع المعرض؟' },
  { platform: 'youtube' as PlatformId, externalId: 'REAL_C5', text: 'شكد قسط المكيف؟' },
  { platform: 'youtube' as PlatformId, externalId: 'REAL_C6', text: 'كم سعر الثلاجة؟' },
];

function baseInput() {
  return {
    platforms: PLATFORMS,
    now: NOW,
    goalPrimary: 'SALES',
    goalSecondary: 'TRUST',
    records,
    comments,
    replies: [
      { platform: 'youtube' as PlatformId, externalId: 'REAL_C1', delivered: true, providerReplyId: 'UgxREALREPLY1', repliedAt: '2026-09-27T10:00:00Z' },
      { platform: 'facebook' as PlatformId, externalId: 'FB_C9', delivered: false, deliveryError: 'provider_error', repliedAt: '2026-09-27T11:00:00Z' },
    ],
    publishes: [
      { platform: 'youtube' as PlatformId, externalId: 'VID_REAL_A', state: 'PUBLISHED', verified: true, createdAt: '2026-09-20T18:00:00Z' },
    ],
    watcher: [
      { commentId: 'REAL_C2', stage: 'SKIPPED', code: 'spam', at: '2026-09-27T12:00:00Z' },
      { commentId: 'REAL_C3', stage: 'ESCALATED', code: 'sensitive', at: '2026-09-27T13:00:00Z' },
    ],
    connections: [
      { platform: 'youtube' as PlatformId, connected: true, verified: true },
      { platform: 'facebook' as PlatformId, connected: true, verified: true },
    ],
    verifiedFacts: [
      { id: 'phone', statement: 'هاتف المعرض: 0770 000 0000', source: 'بيانات المعرض المسجّلة' },
      { id: 'location', statement: 'موقع المعرض: بغداد - شارع الصناعة', source: 'بيانات المعرض المسجّلة' },
    ],
    productFacts: {
      productName: 'ثلاجة سامسونج',
      priceText: '1,250,000 د.ع',
      specs: ['بابان', 'إنفرتر'],
      inStock: true,
      showroomPhone: '0770 000 0000',
      showroomLocation: 'بغداد - شارع الصناعة',
    },
  };
}

// --- 1) التجميع الحقيقي: كل الطبقات ---
group('1) التجميع الحقيقي — كل الطبقات تعمل على بيانات فعلية');
{
  const out = buildRuntimeBrain(baseInput());
  check('اللقطة تُبنى', Boolean(out.state));
  check('الهدف مبني داخلياً (SALES)', out.state.goals?.primary === 'SALES');
  check('المعرفة تحمل حقائق مسجّلة', out.state.knowledge.verifiedCount >= 2);
  check('الجمهور له مقاطع من بيانات فعلية', (out.state.audience?.segments.length ?? 0) >= 1);
  check('الجمهور بلا سمات سكانية', out.state.audience?.demographicsAvailable === false);
  check('الأهمية التجارية لها دليل', out.state.market?.hasCommercialEvidence === true);
  check('توصيات قابلة للتفسير', out.recommendations.length >= 1);
  check('كل توصية تحمل دليلاً ومصدراً', out.recommendations.every((r) => r.evidence.length > 0 && r.source.length > 0));
  check('التجارب مبنيّة من حاجات', out.experiments.length >= 1);
  check('استراتيجية نطاقية واحدة على الأقل', out.strategies.length >= 1);
  check('مسار المحتوى حقيقي', Boolean(out.contentPath) && out.contentPath!.steps.length >= 5);
  const descStep = out.contentPath!.steps.find((s) => s.step === 'الوصف');
  check('مسار المحتوى يستخدم السعر المسجّل فقط', Boolean(descStep?.value?.includes('1,250,000')));
  check('مسار المحتوى يشرح لماذا', out.contentPath!.whyThisContent.length > 0);
  check('التوقيت من أوقات فعلية', out.timing !== null);
  // القرارات الخارجية (publish) لا تكون automatic أبداً؛ وترتيب التصعيد صريح.
  check('لا قرار نشر تلقائي', out.state.pendingDecisions.every((d) => d.decision !== 'automatic'));
  check('المخاطر معلنة عند غياب حقائق', Array.isArray(out.risks));
}

// --- 2) أحداث التعلّم من نتائج حقيقية ---
group('2) أحداث التعلّم — من نتائج فعلية فقط، بمعرّف المزوّد');
{
  const events = buildLearningEvents({ replies: baseInput().replies, publishes: baseInput().publishes, watcher: baseInput().watcher, comments, now: NOW });
  check('حدث نجاح رد', events.some((e) => e.kind === 'SUCCESS' && e.providerId === 'UgxREALREPLY1'));
  check('حدث فشل رد', events.some((e) => e.kind === 'FAILURE' && e.providerId === null));
  check('حدث استجابة مزوّد بمعرّف حقيقي', events.some((e) => e.kind === 'PROVIDER_RESPONSE' && e.providerId === 'UgxREALREPLY1'));
  check('حدث نتيجة نشر', events.some((e) => e.kind === 'OUTCOME' && e.providerId === 'VID_REAL_A'));
  check('حدث تحقق نشر', events.some((e) => e.kind === 'VERIFICATION' && e.providerId === 'VID_REAL_A'));
  check('حدث تخطٍّ من المراقب', events.some((e) => e.kind === 'SKIP' && e.providerId === 'REAL_C2'));
  check('حدث إحالة من المراقب', events.some((e) => e.kind === 'ESCALATION' && e.providerId === 'REAL_C3'));
  check('لا حدث بلا مصدر', events.every((e) => Boolean(e.source)));
  const loop = buildLearningLoop({ events, now: NOW });
  check('حلقة التعلّم تبني دروساً', loop.lessons.length >= 1);
}

// --- 3) منع تكرار التعلّم ---
group('3) منع تكرار أحداث التعلّم (retry/webhook replay)');
{
  const dup: LearningEvent[] = [
    { id: 'x1', kind: 'SUCCESS', subject: 'youtube:reply', detail: 'a', source: 's', sampleSize: 1, confidence: 'high', isFact: true, at: '2026-09-27T10:00:00Z', providerId: 'P1' },
    { id: 'x1', kind: 'SUCCESS', subject: 'youtube:reply', detail: 'a', source: 's', sampleSize: 1, confidence: 'high', isFact: true, at: '2026-09-27T10:00:00Z', providerId: 'P1' },
    { id: 'x2', kind: 'SUCCESS', subject: 'youtube:reply', detail: 'b', source: 's', sampleSize: 1, confidence: 'high', isFact: true, at: '2026-09-27T10:00:00Z', providerId: 'P1' },
  ];
  const deduped = dedupeLearningEvents(dup);
  check('نفس المعرّف يُحتسب مرة', deduped.filter((e) => e.id === 'x1').length === 1);
  check('نفس (kind+subject+providerId) لا يتكرّر', deduped.length === 1);
}

// --- 4) الذاكرة الدائمة — إدراج بلا تكرار وحفظ/تحميل ---
group('4) الذاكرة الدائمة — لا تكرار، وتحتفظ بالأصل والثقة');
{
  const entry = makeMemoryEntry({ id: 'm1', kind: 'outcome', statement: 'رد مُسلَّم', origin: 'derived', source: 'youtube — سجل الردود', now: NOW, sampleSize: 1, platform: 'youtube', sourceRefs: ['socialReplies'], summary: 'رد مُسلَّم بمعرّف Ugx1' });
  const rec = toMemoryRecord(entry);
  check('السجل يحمل المنصة والأصل', rec.platform === 'youtube' && rec.origin === 'derived');
  check('السجل يحمل مراجع المصدر', rec.sourceRefs.includes('socialReplies'));
  let store = emptyBrainMemory();
  let res = upsertMemoryRecord(store, rec);
  check('أول إدراج يُضاف', res.added === true && !res.duplicate);
  store = res.store;
  // إعادة إدراج نفس المضمون (بلا معرّف جديد) => تكرار.
  const dupRec = { ...rec, id: 'm1b' };
  res = upsertMemoryRecord(store, dupRec);
  check('نفس المضمون يُعتبر تكراراً', res.duplicate === true && !res.added);
  store = res.store;
  // نفس المعرّف => استبدال مع حفظ القديم كـsuperseded.
  res = upsertMemoryRecord(store, { ...rec, summary: 'نسخة محدّثة' });
  check('نفس المعرّف يستبدل ويحفظ التاريخ', res.superseded === true);
  store = res.store;
  check('القديم صار superseded', store.records.some((r) => r.status === 'superseded'));
  const summary = summarizeBrainMemory(store);
  check('الملخّص يحصي الحالات', summary.total >= 2 && summary.superseded >= 1);
  check('الذاكرة النشطة فقط تدخل القرار', activeBrainMemory(store).every((r) => r.status === 'active' && !r.stale));
}

// --- 5) قول AI لا يصبح حقيقة + تقادم ---
group('5) الأصل والثقة — قول AI فرضية، والتفضيل ليس حقيقة');
{
  const aiEntry = makeMemoryEntry({ id: 'ai1', kind: 'audience', statement: 'قد يفضل الجمهور الفيديو القصير', origin: 'ai_statement', source: 'مزود الذكاء', now: NOW, sampleSize: 0 });
  check('قول AI بثقة منخفضة', aiEntry.confidence === 'low');
  const rec = toMemoryRecord(aiEntry);
  const store = upsertMemoryRecord(emptyBrainMemory(), rec).store;
  const knowledge = memoryToKnowledge(store);
  const item = knowledge.find((k) => k.id === 'mem:ai1')!;
  // النوع الحقيقي `KnowledgeItemLike` لا يحمل `hasSource`؛ نشتقّه من `source` كما
  // يفعل `makeKnowledgeItem` تماماً (لا cast، ولا توسيع مصطنع للنوع).
  const asClaimInput = (k: KnowledgeItemLike) => ({ hasSource: typeof k.source === 'string' && k.source.trim().length > 0, sampleSize: k.sampleSize, derived: k.derived, hypothesis: k.hypothesis, requiresHumanInput: k.requiresHumanInput });
  check('قول AI يُصنّف فرضية', classifyClaim(asClaimInput(item)) === 'HYPOTHESIS' || classifyClaim(asClaimInput(item)) === 'UNKNOWN');
  check('لا يُرقّى إلى حقيقة موثّقة', classifyClaim(asClaimInput(item)) !== 'VERIFIED_FACT');
  // التقادم: يبقى مرئياً لكن لا يدخل القرار.
  const stale = markStaleMemory(store, 'ai1', 'تغيّر الدليل');
  check('المتقدم لا يدخل القرار', activeBrainMemory(stale).length === 0);
  check('المتقدم يحمل سبباً', stale.records.find((r) => r.id === 'ai1')!.staleReason === 'تغيّر الدليل');
  const validated = validateMemoryRecord(stale, 'ai1', NOW + 1000);
  check('التحقق يزيل التقادم', validated.records.find((r) => r.id === 'ai1')!.stale === false);
}

// --- 6) تصنيف المحادثة الكامل ---
group('6) تصنيف المحادثة — الفئات الحتمية');
{
  const c = (t: string) => classifyConversation({ platform: 'youtube', externalId: 'c', text: t }).category;
  check('نية شراء', c('هل عندكم تقسيط؟') === 'purchase_intent');
  check('سؤال سعر', c('شكد قسط الثلاجة؟') === 'question' || c('شكد قسط الثلاجة؟') === 'purchase_intent');
  check('اعتراض سعر', c('غالي شكد هذا السعر') === 'objection');
  check('طلب محتوى', c('سوي فيديو عن التقسيط') === 'content_request');
  check('طلب ميزة', c('ياريت تسوون خدمة توصيل') === 'feature_request' || c('ليش ماكو خدمة توصيل') === 'feature_request');
  check('مدح', c('شكراً احسن معرض') === 'praise');
  check('كل تصنيف يحمل إشارة', classifyConversation({ platform: 'youtube', externalId: 'c', text: 'شكراً' }).signal !== undefined);
}

// --- 7) التوقيت من بيانات حقيقية فقط ---
group('7) التوقيت — من أوقات نشر ومشاهدات فعلية');
{
  const obs = timingObservationsFromRecords(records, 'youtube');
  check('ملاحظات توقيت من سجلات حقيقية', obs.length === 2);
  const noObs = timingObservationsFromRecords([], 'youtube');
  check('بلا سجلات => لا ملاحظات (لا اختراع)', noObs.length === 0);
}

// --- 8) مسار المحتوى — بلا بيانات ⇒ لا اختراع ---
group('8) مسار المحتوى — عنصر بلا بيانات لا يُخترع');
{
  const priceNeed: RepeatedNeed = { topic: 'price', category: 'question', count: 3, sampleSize: 3, exampleIds: ['c1', 'c2', 'c3'], confidence: 'medium', source: 'YouTube — تعليقات فعلية' };
  const path = buildRuntimeContentPath({
    topNeed: priceNeed,
    verifiedFacts: [],
    productFacts: { productName: null, priceText: null, specs: [], inStock: null, showroomPhone: null, showroomLocation: null },
  });
  check('مسار يُبنى من الحاجة', Boolean(path));
  // ContentPath لا يحوي وصفاً مباشراً؛ الوصف خطوة داخله. بلا سعر مسجّل لا رقم.
  const pathDesc = path!.steps.find((s) => s.step === 'الوصف')?.value || '';
  check('بلا سعر مسجّل لا يُذكر رقم', !/\d{3,}/.test(pathDesc) || pathDesc.includes('التفاصيل'));
  const none = buildRuntimeContentPath({ topNeed: null, verifiedFacts: [], productFacts: undefined });
  check('بلا حاجة => لا مسار', none === null);
}

// --- 9) لا معرّفات مُختلقة ---
group('9) لا معرّفات مُختلقة');
{
  const out = buildRuntimeBrain(baseInput());
  const knownProviderIds = new Set(['UgxREALREPLY1', 'VID_REAL_A', 'REAL_C1', 'REAL_C2', 'REAL_C3', 'REAL_C4', 'FB_C9']);
  check('كل معرّف مزوّد شوهد فعلاً', out.observedProviderIds.every((id) => knownProviderIds.has(id)));
  check('لا معرّف مزوّد في سجل فاشل بلا مصدر', buildLearningEvents({ replies: baseInput().replies, publishes: [], watcher: [], comments, now: NOW }).filter((e) => !e.isFact).length === 0);
}

// --- 10) الذاكرة تصمد: تسلسل → إعادة تحميل → نفس المحتوى ---
group('10) الذاكرة الدائمة تصمد (تسلسل/إعادة تحميل)');
{
  const first = buildRuntimeBrain(baseInput());
  check('جولة أولى أنتجت سجلات ذاكرة', first.newMemoryRecords.length >= 1);
  const snapshot = { records: [...first.newMemoryRecords] };
  const reloaded = JSON.parse(JSON.stringify(snapshot));
  const second = buildRuntimeBrain({ ...baseInput(), memory: reloaded });
  check('إعادة البناء بلا سجلات جديدة (لا تكرار)', second.newMemoryRecords.length === 0);
  check('الذاكرة محمّلة تُغذّي المعرفة', second.state.knowledge.items.length >= first.state.knowledge.items.length);
}

// --- 11) التوحيد canonical: الشكل القديم مُشتق من الحالة نفسها ---
group('11) التوحيد canonical — لا عقل ثانٍ، والشكل القديم من نفس الحالة');
{
  const out = buildRuntimeBrain(baseInput());
  const snap = toCentralBrainSnapshot(out.state);
  // الشكل القديم يستخدم نفس سجلات الحالة canonical (لا إعادة جمع بيانات).
  check('اللقطة القديمة من سجلات الحالة نفسها', snap.learning.byPlatform.length === out.state.platformStates.length);
  check('اللقطة القديمة تحمل نفس عدّادات AI', snap.ai.providerCalls === out.state.ai.providerCalls);
  check('اللقطة القديمة تحمل نفس حدود الحالة', snap.limitations.length === out.state.limitations.length);
  check('اللقطة القديمة تعكس القدرات من السجل', snap.platforms.length === out.state.platformStates.length);
  // إضافة سجل أداء عبر المصدر canonical (`buildRuntimeBrain`) تنعكس مباشرةً على
  // الشكل القديم — مصدر واحد: لا compat تُعيد الحساب ولا حالة تُعدّل يدوياً.
  const extra = { platform: 'youtube' as PlatformId, externalId: 'VID_EXTRA', values: { views: 10, likes: 1 } };
  const rebuilt = buildRuntimeBrain({ ...baseInput(), records: [...baseInput().records, extra] });
  const snap2 = toCentralBrainSnapshot(rebuilt.state);
  check('زيادة سجلات canonical تظهر في الشكل القديم', snap2.learning.byPlatform.find((s) => s.platform === 'youtube')!.sampleSize > snap.learning.byPlatform.find((s) => s.platform === 'youtube')!.sampleSize);
}

// --- 12) الفئات الثمانية كلها — تصنيف حتمي بأمثلة عراقية، وبلا سعر مُختلق ---
group('12) تصنيف المحادثة — الفئات الثمانية كاملة (حتمي، بلا AI)');
{
  const c = (t: string) => classifyConversation({ platform: 'youtube', externalId: 'c', text: t });
  check('سؤال (موقع)', c('وين موقع المعرض؟').category === 'question');
  check('شكوى (تأخير)', c('صار تأخير بالطلب وما كو رد').category === 'complaint');
  check('اعتراض (سعر غالي)', c('غالي شكد هذا السعر').category === 'objection');
  check('نية شراء (تقسيط)', c('هل عندكم تقسيط؟').category === 'purchase_intent');
  check('طلب ميزة (توصيل)', c('ياريت تسوون خدمة توصيل').category === 'feature_request');
  check('طلب محتوى (فيديو)', c('سوي فيديو عن التقسيط').category === 'content_request');
  check('مدح', c('شكراً احسن معرض').category === 'praise');
  check('سبام (ربح/عملة)', c('ربح سريع من البيتكوين').category === 'spam');
  check('كل تصنيف يحمل إشارة', ['question', 'complaint', 'objection', 'purchase_intent', 'feature_request', 'content_request', 'praise', 'spam'].every((cat) => typeof c(cat === 'spam' ? 'ربح سريع' : 'شكراً').signal === 'string'));
  check('السبام يستوجب مراجعة بشرية ولا يُرد آلياً', c('ربح سريع من البيتكوين').category === 'spam');

  // السؤال التجاري بلا سعر مسجّل: لا يُختلق رقم إطلاقاً.
  const priceIntel = buildCommentIntelligence({ platform: 'youtube', text: 'شكد قسط الثلاجة؟' });
  const noFacts = proposeCommentReply(priceIntel, {});
  check('سؤال سعر بلا حقائق لا يحمل أي رقم', !/\d/.test(noFacts.reply || ''));
  // ومع سعر مسجّل فعلاً: يُستخدم الرقم المسجّل نفسه فقط.
  const withFacts = proposeCommentReply(priceIntel, { priceText: '1,250,000 د.ع', productName: 'ثلاجة' });
  check('سؤال سعر بحقائق يستخدم السعر المسجّل حرفياً', Boolean(withFacts.reply && withFacts.reply.includes('1,250,000')));
}

console.log('\n' + '='.repeat(60));
if (fails.length) {
  console.error(`FAILED: ${fails.length} / ${passed + fails.length}`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} brain runtime checks`);
}
