/**
 * اختبار تدقيق «النشر الموحّد بنقرة واحدة» — منطق خالص + ثوابت المصدر.
 *
 * الجذور المُثبتة والإصلاحات (AUDIT → ROOT CAUSE → FIX):
 *  1) YouTube كان **مستثنى** من المنفّذ الموحّد بـ`409 PLATFORM_USE_DEDICATED_PUBLISH`.
 *     الإصلاح: يُنفّذ الآن داخل `executePlatformPublish` عبر نفس `executeYouTubePublish`.
 *  2) `CONTAINER_TIMEOUT` في Threads/Instagram: مهلة ثابتة 24s بلا تراجع. الإصلاح:
 *     تراجع أسّي بميزانية واقعية (`resolveContainerPollConfig`).
 *  3) `CLIENT_ERROR: Invalid parameter`: لا فحص ملاءمة مسبق. الإصلاح: `adaptPublishForPlatform`
 *     (تجاوز الحد ⇒ اقتراح مختصر؛ منصة بلا وسائط ⇒ MEDIA_REQUIRED قبل أي نداء).
 *  4) التوحيد: كل المنصات العشر تمر بنفس المنفّذ الواحد بنقرة واحدة.
 *
 * لا شبكة ولا مزود ولا سرّ — فحص وحدة + ثوابت مصدر فقط.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CONTAINER_POLL,
  resolveContainerPollConfig,
  containerPollDelayMs,
  containerPollBudgetMs,
} from '../social/containerPolling';
import {
  adaptPublishForPlatform,
  platformAcceptsTextOnly,
  TEXT_ONLY_REJECTS,
  PLATFORM_HASHTAG_TAG,
} from '../social/publishAdaptation';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const ROOT = process.cwd();
const server = readFileSync(join(ROOT, 'server.ts'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
group('1) YouTube موحّد: لا استثناء في المنفّذ الموحّد');
check('المنفّذ الموحّد يستدعي executeYouTubePublish لـYouTube',
  /platform === "youtube"[\s\S]{0,1400}executeYouTubePublish\(/.test(server));
check('لا يُرجع PLATFORM_USE_DEDICATED_PUBLISH لـYouTube في المنفّذ الموحّد',
  !/platform === "youtube"[\s\S]{0,1400}code: "PLATFORM_USE_DEDICATED_PUBLISH"/.test(server));
check('يوجد resolver بايتات YouTube الموحّد (mediaRef/base64/رابط عام)',
  server.includes('async function resolveYouTubeBytes'));
check('منع نشر YouTube بلا مادة => MEDIA_REQUIRED',
  /platform === "youtube"[\s\S]{0,700}MEDIA_REQUIRED/.test(server));
check('لا فيديو وهمي: التنزيل بحدّ حجم مهلة صريح',
  server.includes('YOUTUBE_UNIFIED_DOWNLOAD_MAX_BYTES') && server.includes('YOUTUBE_UNIFIED_DOWNLOAD_TIMEOUT_MS'));
check('عنوان YouTube يُشتق ≤100 محرف بلا اختراع (وسم عام)',
  server.includes('function youTubeTitleFromContent') && server.includes('PLATFORM_HASHTAG_TAG'));
check('المنفّذ يجمع معرّف مزود YouTube (externalVideoId)',
  server.includes('result.body?.providerPostId || result.body?.providerPublishId || result.body?.externalVideoId'));

// ─────────────────────────────────────────────────────────────────────────────
group('2) تراجع أسّي لانتظار الحاويات (Instagram/Threads) — لا CONTAINER_TIMEOUT قسري');
check('التراجع الأسّي موجود (containerPollDelayMs)', typeof containerPollDelayMs === 'function');
check('محاولة 0 بلا انتظار', containerPollDelayMs(0, DEFAULT_CONTAINER_POLL) === 0);
check('التأخير يتزايد أسّياً قبل السقف',
  containerPollDelayMs(1, DEFAULT_CONTAINER_POLL) < containerPollDelayMs(2, DEFAULT_CONTAINER_POLL)
  && containerPollDelayMs(2, DEFAULT_CONTAINER_POLL) < containerPollDelayMs(3, DEFAULT_CONTAINER_POLL));
check('التأخير محصور بالسقف الأقصى',
  containerPollDelayMs(50, DEFAULT_CONTAINER_POLL) === DEFAULT_CONTAINER_POLL.maxDelayMs);
{
  const budget = containerPollBudgetMs(DEFAULT_CONTAINER_POLL);
  check('الميزانية الافتراضية أكبر بكثير من 24s القديمة', budget > 60000, `budget=${budget}ms`);
  check('عدد المحاولات الافتراضي معتدل (≤20)', DEFAULT_CONTAINER_POLL.maxAttempts <= 20, String(DEFAULT_CONTAINER_POLL.maxAttempts));
}
{
  // الجذر: قيمة بيئة قديمة/سيئة لا تُنتج حلقة بلا فاصل ولا ميزانية صفرية.
  const bad = resolveContainerPollConfig({ CONTAINER_POLL_MAX_ATTEMPTS: '0', CONTAINER_POLL_INITIAL_MS: '-5' } as any);
  check('إعداد بيئة غير صالح يُصحَّح لحدود آمنة (محاولة ≥1)', bad.maxAttempts >= 1 && bad.initialDelayMs >= 0, JSON.stringify(bad));
  const custom = resolveContainerPollConfig({ CONTAINER_POLL_MAX_ATTEMPTS: '3', CONTAINER_POLL_INITIAL_MS: '1000', CONTAINER_POLL_MAX_MS: '5000', CONTAINER_POLL_BACKOFF_BASE: '2' } as any);
  check('إعداد بيئة صالح يُحترم', custom.maxAttempts === 3 && custom.initialDelayMs === 1000 && custom.maxDelayMs === 5000 && custom.backoffBase === 2, JSON.stringify(custom));
}
check('الخادم يستخدم resolveContainerPollConfig لإنستغرام', /createInstagramContainerReady\([\s\S]{0,120}?igPoll\)/.test(server));
check('الخادم يستخدم resolveContainerPollConfig لـThreads', server.includes('resolveContainerPollConfig(process.env)'));
check('پیام CONTAINER_TIMEOUT يذكر الميزانية الفعلية', server.includes('containerPollBudgetMs(poll)'));

// ─────────────────────────────────────────────────────────────────────────────
group('3) تكييف المحتوى: منع Invalid parameter قبل أي نداء مزود');
check('منصات ترفض النص المجرّد معلنة صراحةً', TEXT_ONLY_REJECTS.includes('instagram') && TEXT_ONLY_REJECTS.includes('tiktok') && TEXT_ONLY_REJECTS.includes('youtube'));
check('platformAcceptsTextOnly: Threads/Telegram تقبل نصاً', platformAcceptsTextOnly('threads') && platformAcceptsTextOnly('telegram'));
check('platformAcceptsTextOnly: Instagram لا تقبل نصاً مجرّداً', platformAcceptsTextOnly('instagram') === false);
{
  const noMedia = adaptPublishForPlatform({ platform: 'instagram', content: 'نص عادي', hasMedia: false });
  check('Instagram بلا وسائط => no_media/MEDIA_REQUIRED', noMedia.ok === false && noMedia.code === 'MEDIA_REQUIRED' && noMedia.outcome === 'no_media', JSON.stringify(noMedia));
  check('MEDIA_REQUIRED يحمل سبباً عربياً صريحاً', noMedia.reason.length > 0 && noMedia.reason.includes('نص'));
  const withMedia = adaptPublishForPlatform({ platform: 'instagram', content: 'نص عادي', hasMedia: true });
  check('Instagram مع وسائط => ok', withMedia.ok === true, JSON.stringify(withMedia));
}
{
  const long = 'ا'.repeat(600); // > 500 بايت (كل حرف عربي = 2 بايت)
  const over = adaptPublishForPlatform({ platform: 'threads', content: long, hasMedia: false });
  check('تجاوز حد Threads => oversize/TEXT_TOO_LONG', over.ok === false && over.code === 'TEXT_TOO_LONG', JSON.stringify({ ok: over.ok, code: over.code }));
  check('طريقة العدّ معلنة في التكيّف (Threads = utf8_bytes)', over.countMethod === 'utf8_bytes', String(over.countMethod));
  check('التجاوز يقدّم نصاً مقترحاً مختصراً (لا نشر تلقائي)', typeof over.shortenedContent === 'string' && over.shortenedContent!.length > 0);
  check('النص المقترح لا يعيد كتابة معلومة (مجرد قصّ)', over.shortenedContent!.length < long.length);
}
{
  const okTxt = adaptPublishForPlatform({ platform: 'telegram', content: 'نص قصير', hasMedia: false });
  check('نص قصير على Telegram => ok', okTxt.ok === true);
  const ytNoMedia = adaptPublishForPlatform({ platform: 'youtube', content: 'نص', hasMedia: false });
  check('YouTube بلا وسائط => MEDIA_REQUIRED', ytNoMedia.code === 'MEDIA_REQUIRED');
}
check('وسم التعريف العام موجود بلا معلومة تجارية مُختلقة', graphSafe(PLATFORM_HASHTAG_TAG));
function graphSafe(s: string): boolean { return s.includes('الغرابي') && (s.includes('تقسيط') || s.includes('للتقسيط')); }

// ─────────────────────────────────────────────────────────────────────────────
group('4) التوحيد الكامل: كل المنصات العشر عبر منفّذ واحد');
check('منفّذ واحد `executePlatformPublish`', server.includes('async function executePlatformPublish'));
check('المسار الموحّد يستخدم Promise.allSettled (عزل كامل)', server.includes('Promise.allSettled(requested.map'));
check('كل منصة تقرأ نسختها المكيَّفة أولاً', server.includes('post.platformVersions[platform]'));
check('الوسائط تُمرَّر حسب النوع (videoUrl/imageUrl)', /post\.mediaType === "video"[\s\S]{0,160}videoUrl[\s\S]{0,160}imageUrl/.test(server));
check('لا يُعلن published بلا معرّف مزود حقيقي', /const delivered = result.status === 200 && Boolean\(providerPostId\)/.test(server));
check('الدورة الداخلية (six-agent) تستخدم نفس المنفّذ (لا مسار ثانٍ)', server.includes('executePlatformPublish(platform, { content, approved: true, postId }, "six-agent")'));

// ─────────────────────────────────────────────────────────────────────────────
group('5) لا تخفيف لأي حماية قائمة');
check('بوابة الموافقة (approved) باقية', server.includes('const approved = body?.approved === true'));
check('حارس سلامة المحتوى باقٍ قبل الإرسال', server.includes('analyzeBusinessClaims(content, buildFactsForProduct'));
check('بوابة الاتصال الموثق باقية', server.includes('conn.status !== "connected" || conn.providerVerified !== true'));
check('منع التكرار TikTok باقٍ (idempotencyKey)', server.includes('r.idempotencyKey === fingerprint'));
check('YouTube يستخدم نفس الموزّع المخصص ولا مسار جانبي', server.includes('async function executeYouTubePublish'));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} unified one-click publishing checks`);
}
