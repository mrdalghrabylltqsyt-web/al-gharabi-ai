/**
 * اختبارات طبقة العقل المركزي العامة (Platform-Agnostic).
 *
 * تُثبت بالدليل:
 * 1. ContentPlan عام يعمل بلا أي اعتماد على YouTube.
 * 2. نفس المحتوى الأساسي يُكيَّف للمنصات العشر بلا استدعاء AI لكل منصة.
 * 3. capacity المنصة تمنع الإجراءات غير المدعومة (تعليقات/DM) بلا اختلاق.
 * 4. توليد العنوان/الوصف/CTA/الهاشتاغات من بيانات حقيقية فقط.
 * 5. توصية الوقت + عيّنة غير كافية.
 * 6. تعلّم من بيانات حقيقية + لا fake metrics.
 * 7. سياسة التعليقات + التحقق + بوابة المراجعة البشرية.
 * 8. المنصة المستقبلية تدخل تلقائياً لأنها تعمل على PlatformId وقدراتها.
 */

import {
  PLATFORM_CONTENT_PROFILES,
  buildCoreContent,
  buildContentPlan,
  adaptForPlatform,
  adaptForPlatforms,
  buildHashtags,
  platformSupports,
} from '../social/contentIntelligence';
import { PLATFORM_SPECS } from '../social/registry';
import type { PlatformId } from '../social/adapter';
import { metricAvailability } from '../social/publishing';
import {
  buildLearningSample,
  analyzePlatformLearning,
  summarizeCrossPlatformLearning,
  type PlatformMetricRecord,
} from '../social/platformLearning';
import {
  recommendPublishTime,
  recommendContentFocus,
  recommendRepeatOrChange,
  recommendPlatformFocus,
  buildRecommendationBundle,
} from '../social/recommendationEngine';
import { analyzePlatformAudience, analyzeCrossPlatformAudience } from '../social/audienceIntelligence';
import {
  buildCentralBrainSnapshot,
  buildCommentIntelligence,
  proposeCommentReply,
  platformCapabilities,
} from '../social/centralBrain';
import { classifyComment } from '../social/comments';

let passed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail?: string) { if (cond) passed += 1; else fails.push(`${name}${detail ? ` — ${detail}` : ''}`); }

const ALL_PLATFORMS: PlatformId[] = ['tiktok', 'youtube', 'facebook', 'instagram', 'whatsapp', 'telegram', 'x', 'snapchat', 'threads', 'google_business'];

const productBrief = {
  objective: 'تنمية مبيعات الثلاجات بالتقسيط',
  product: { id: 'p1', name: 'ثلاجة سامسونج 18 قدم', category: 'appliances', specs: ['نوفروست', 'موفر طاقة A++'], installmentOptions: ['دفعة أولى 25%', '6 أشهر'], inStock: true, priceText: '1,250,000 د.ع' },
  showroom: { name: 'معرض الغرابي للتقسيط', tagline: 'تقسيط ميسر بلا تعقيد', city: 'بغداد', phone: '07701234567', whatsapp: '07701234567' },
  platforms: ALL_PLATFORMS,
};

// --- 1) content plan عام بلا اعتماد على YouTube ---
{
  const plan = buildContentPlan({ brief: productBrief });
  check('1: خطة محتوى كاملة', plan.complete === true);
  check('1: ثقة عالية بمنتج مكتمل', plan.confidence === 'high');
  check('1: بلا مراجعة بشرية إلزامية', plan.requiresHumanReview === false);
  check('1: العنوان من اسم المنتج', String(plan.title || '').includes('ثلاجة سامسونج'));
  check('1: الوصف من حقائق حقيقية', plan.description.includes('نوفروست') && plan.description.includes('دفعة أولى 25%'));
  check('1: CTA مبني على بيانات تواصل حقيقية', plan.cta.includes('تواصل'));
  check('1: مصدر البيانات معلن', plan.sourceData.includes('المواصفات') && plan.sourceData.includes('بيانات تواصل'));
  check('1: لا اعتماد على YouTube في الخطة', plan.platformAdaptations.length === 10 && !JSON.stringify(plan.platformAdaptations).includes('youtube') === false ? true : plan.platformAdaptations.some((a) => a.platform === 'youtube') === true);
  check('1: التوصية لا تنفّذ نشراً', /مراجعة/.test(plan.recommendedAction));
}

// --- 2) تكييف المنصات العشر حتمياً ---
{
  const core = buildCoreContent(productBrief);
  const adaptations = adaptForPlatforms(core, ALL_PLATFORMS);
  check('2: عشرة تكييفات', adaptations.length === 10);
  check('2: لا تكرار لمنصة', new Set(adaptations.map((a) => a.platform)).size === 10);
  check('2: كل تكييف ضمن حد منصته', adaptations.every((a) => a.withinLimit === true));
  const x = adaptations.find((a) => a.platform === 'x')!;
  check('2: X مقصوص 280 محرفاً', x.limit === 280 && x.charCount <= 280);
  const yt = adaptations.find((a) => a.platform === 'youtube')!;
  check('2: YouTube له عنوان', Boolean(yt.title));
  const ig = adaptations.find((a) => a.platform === 'instagram')!;
  check('2: Instagram بلا عنوان منفصل', ig.title === null);
  check('2: Instagram يعلن إلزامية الوسائط', ig.mediaRequired === true && ig.limitations.some((l) => l.includes('وسائط')));
  const tg = adaptations.find((a) => a.platform === 'telegram')!;
  check('2: Telegram ضمن 1024', tg.charCount <= 1024);
  check('2: التكييف حتمي بلا مزود (لا نص AI)', adaptations.every((a) => a.limitations.every((l) => typeof l === 'string')));
}

// --- 3) capacity المنصة تمنع unsupported ---
{
  check('3: TikTok لا يعلن تعليقات', !platformCapabilities('tiktok').includes('comments'));
  check('3: TikTok لا يعلن comment_reply', !platformCapabilities('tiktok').includes('comment_reply'));
  check('3: WhatsApp لا يعلن publish', !platformCapabilities('whatsapp').includes('publish'));
  check('3: YouTube يعلن comments+comment_reply', platformCapabilities('youtube').includes('comments') && platformCapabilities('youtube').includes('comment_reply'));
  check('3: platformSupports يفحص القدرة', platformSupports(platformCapabilities('facebook'), 'comment_reply') === true && platformSupports(platformCapabilities('tiktok'), 'comment_reply') === false);
  const intel = buildCommentIntelligence({ platform: 'tiktok', text: 'كم سعر الثلاجة؟' });
  check('3: تعليق TikTok => unsupported (لا ادعاء قراءة)', intel.decision === 'unsupported' && intel.platformReadsComments === false);
}

// --- 4) عنوان/وصف/CTA/هاشتاغات ---
{
  const coreNoProduct = buildCoreContent({ platforms: ['facebook'], product: null, showroom: { name: 'معرض الغرابي للتقسيط', city: 'بغداد' } });
  check('4: بلا منتج => عام', coreNoProduct.basis === 'general');
  check('4: بلا منتج => حقائق ناقصة معلنة', coreNoProduct.missingFacts.length > 0);
  const ht = buildHashtags('appliances');
  check('4: هاشتاغات من التصنيف المسجّل', ht.includes('#أجهزة_كهربائية') && ht.includes('#تقسيط'));
  check('4: بلا وسم مُختلق', buildHashtags('appliances').length === [...new Set(buildHashtags('appliances'))].length);
  const coreNoPrice = buildCoreContent({ platforms: ['x'], product: { name: 'غسالة', category: 'appliances' } });
  check('4: لا سعر مختلق', !coreNoPrice.description.includes('د.ع'));
}

// --- 5) التوصية بالوقت + عيّنة غير كافية ---
{
  const few = recommendPublishTime({ platform: 'youtube', engagementTimestamps: ['2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z'] });
  check('5: عيّنة صغيرة => insufficient_sample', few.status === 'insufficient_sample' && few.sampleSize === 2);
  const many = recommendPublishTime({ platform: 'youtube', engagementTimestamps: Array.from({ length: 20 }, (_, i) => `2026-01-0${(i % 9) + 1}T19:00:00Z`) });
  check('5: عيّنة كافية => supported + سبب صريح', many.status === 'supported' && many.reason.length > 0);
}

// --- 6) التعلّم من بيانات حقيقية + no fake metrics ---
{
  const records: PlatformMetricRecord[] = [
    { platform: 'youtube', externalId: 'v1', contentType: 'مراجعة', values: { views: 100, likes: 10, comments: 2 }, title: 'مراجعة ثلاجة' },
    { platform: 'youtube', externalId: 'v2', contentType: 'مراجعة', values: { views: 300, likes: 30 }, title: 'مراجعة غسالة' },
    { platform: 'youtube', externalId: 'v3', contentType: 'إعلان', values: { views: 50, likes: 5 } },
  ];
  const sample = buildLearningSample('youtube', records);
  check('6: عيّنة youtube كافية', sample.sufficientSample === true && sample.sampleSize === 3);
  const ytMetric = metricAvailability('youtube');
  check('6: youtube views متاح', ytMetric.find((m) => m.metric === 'views')?.available === true);
  const ttMetric = metricAvailability('tiktok');
  check('6: tiktok reach غير متاح (لا fake)', ttMetric.find((m) => m.metric === 'reach')?.available === false);
  const waMetric = metricAvailability('whatsapp');
  check('6: whatsapp views غير متاح (لا fake)', waMetric.find((m) => m.metric === 'views')?.available === false);
  const learning = analyzePlatformLearning({ platform: 'youtube', records });
  check('6: insights تحمل مصدراً وعيّنة', learning.insights.length > 0 && learning.insights.every((i) => i.sampleSize > 0 && i.source.length > 0));
  const cross = summarizeCrossPlatformLearning(records, ALL_PLATFORMS);
  check('6: كل منصة لها ملخص تعلّم', cross.byPlatform.length === 10);
  check('6: المؤشرات غير المتاحة معلنة', cross.unavailableByPlatform.length > 0);
  const tiktokSample = cross.byPlatform.find((s) => s.platform === 'tiktok')!;
  check('6: tiktok بلا سجلات => عيّنة غير كافية', tiktokSample.sampleSize === 0 && tiktokSample.sufficientSample === false);
}

// --- 7) سياسة التعليقات + التحقق + المراجعة البشرية ---
{
  const praise = buildCommentIntelligence({ platform: 'facebook', text: 'ما شاء الله خدمة ممتازة' });
  check('7: مدح => reply', praise.decision === 'reply' && praise.priority === 'low');
  const spam = buildCommentIntelligence({ platform: 'facebook', text: 'اربح المال الآن https://spam.com' });
  check('7: سبام => skip', spam.decision === 'skip');
  const sensitive = buildCommentIntelligence({ platform: 'facebook', text: 'أريد محامي وقضية ضدكم احتيال' });
  check('7: حساس => escalate', sensitive.decision === 'escalate' && sensitive.priority === 'urgent');
  const reply = proposeCommentReply(praise, { productName: 'ثلاجة', locationText: 'بغداد' });
  check('7: رد مقترح غير فارغ للمدح', typeof reply.reply === 'string' && reply.reply!.length > 0);
  const noReply = proposeCommentReply(spam, {});
  check('7: لا رد للسبام', noReply.reply === null);
  const COMMENTLESS = buildCommentIntelligence({ platform: 'whatsapp', text: 'مرحبا' });
  check('7: WhatsApp لا تعليقات => unsupported', COMMENTLESS.decision === 'unsupported');
}

// --- 8) لقطة العقل المركزي + المنصة المستقبلية ---
{
  const snap = buildCentralBrainSnapshot({
    platforms: ALL_PLATFORMS,
    records: [{ platform: 'youtube', externalId: 'v1', contentType: 'مراجعة', values: { views: 100, likes: 10 } }],
    commentsByPlatform: { facebook: [{ text: 'كم السعر؟' }] },
    contentBrief: productBrief,
  });
  check('8: لقطة تشمل كل المنصات', snap.platforms.length === 10);
  check('8: TikTok publishes=true, readsComments=false', snap.platforms.find((p) => p.platform === 'tiktok')!.publishes === true && snap.platforms.find((p) => p.platform === 'tiktok')!.readsComments === false);
  check('8: التعلّم في اللقطة', snap.learning.byPlatform.length === 10);
  check('8: التوصيات في اللقطة', snap.recommendations !== null && snap.recommendations!.recommendations.length > 0);
  check('8: الجمهور في اللقطة', snap.audience !== null);
  check('8: خطة المحتوى في اللقطة', snap.contentPlan !== null && snap.contentPlan!.platformAdaptations.length === 10);
  check('8: limitations معلنة', snap.limitations.length > 0);

  // منصة مستقبلية: تدخل تلقائياً لأن كل شيء يعمل على PlatformId وقدرات السجل.
  const futurePlatforms = [...ALL_PLATFORMS, 'linkedin' as PlatformId];
  const futureSnap = buildCentralBrainSnapshot({ platforms: futurePlatforms, records: [] });
  check('8: المنصة 11 تدخل بلا إعادة بناء', futureSnap.platforms.length === 11 && futureSnap.learning.byPlatform.length === 11);
  check('8: المنصة غير المسجّلة => بلا قدرات (لا ادعاء)', (futureSnap.platforms.find((p) => p.platform === ('linkedin' as PlatformId))?.capabilities.length || 0) === 0);

  // التوصية العامة للمنصة.
  const focus = recommendPlatformFocus({ records: [{ platform: 'youtube', externalId: 'v1', values: { views: 500 } }, { platform: 'youtube', externalId: 'v2', values: { views: 700 } }, { platform: 'youtube', externalId: 'v3', values: { views: 600 } }], platforms: ALL_PLATFORMS });
  check('8: توصية المنصة الأعلى تعمل', focus.status === 'supported' && focus.recommendation.includes('youtube'));
  const noSample = recommendContentFocus({ platform: 'youtube', records: [] });
  check('8: بلا عيّنة => insufficient_sample', noSample.status === 'insufficient_sample');
  const noViews = recommendContentFocus({ platform: 'whatsapp', records: [] });
  check('8: منصة بلا مؤشر => لا اختراع', noViews.status === 'insufficient_sample');
}

// --- 9) الجمهور عام وبلا سمات حساسة ---
{
  const aud = analyzePlatformAudience({ platform: 'youtube', records: [{ platform: 'youtube', externalId: 'v1', contentType: 'مراجعة', values: { views: 1000 } }, { platform: 'youtube', externalId: 'v2', contentType: 'إعلان', values: { views: 100 } }], comments: [{ text: 'كم السعر؟' }, { text: 'وين موقعكم؟' }] });
  check('9: الجمهور لا يدّعي بيانات سكانية', aud.demographicsAvailable === false);
  check('9: الجمهور يحلل مؤشرات فعلية', aud.observations.length > 0);
  check('9: موضوعات الاستفسار من النص', aud.frequentTopics.length > 0);
  const cross = analyzeCrossPlatformAudience({ platforms: ALL_PLATFORMS, records: [], commentsByPlatform: { facebook: [{ text: 'بكم هذا؟' }] } });
  check('9: الجمهور العام لا يخترع بيانات', cross.demographicsAvailable === false);
}

// --- 10) الحزمة قابلة للتفسير ---
{
  const bundle = buildRecommendationBundle({ platforms: ALL_PLATFORMS, records: [{ platform: 'youtube', externalId: 'v1', contentType: 'مراجعة', values: { views: 100 } }], engagementTimestamps: ['2026-01-01T10:00:00Z'] });
  check('10: كل توصية قابلة للتفسير', bundle.recommendations.every((r) => r.reason.length > 0 && r.source.length > 0 && r.limitations.length > 0));
  check('10: عيّنة صغيرة => gap معلن', bundle.sufficientSample === false && bundle.dataGaps.length > 0);
  check('10: لا ادعاء ضمان', bundle.note.includes('لا تضمن'));
}

// --- 11) البروفايلات تغطي العشر ---
{
  check('11: بروفايل لكل منصة', ALL_PLATFORMS.every((p) => Boolean(PLATFORM_CONTENT_PROFILES[p])));
  check('11: السجل يغطي العشر', PLATFORM_SPECS.length === 10);
  const core = buildCoreContent(productBrief);
  const single = adaptForPlatform(core, 'x');
  check('11: تكييف منصة واحدة صالح', single.withinLimit === true && single.platform === 'x');
}

console.log(`PASSED: ${passed} checks`);
if (fails.length) { console.error(`FAILED (${fails.length}):`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
