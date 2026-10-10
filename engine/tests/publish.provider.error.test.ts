/**
 * اختبار انحدار: كشف السبب الحقيقي لفشل النشر الموحّد على Instagram/Threads.
 *
 * الجذر المُثبت: كان المسار العام يثبّت `MEDIA_REQUIRED` (Instagram) و`PROVIDER_ERROR`
 * (Threads) بصرف النظر عن رسالة Meta الحقيقية، فيُخفي السبب. هذا الاختبار يثبت أن:
 *  (أ) رسالة Meta الحقيقية تصل كما هي ولا تُستبدل بكود ثابت.
 *  (ب) الكود يعكس تصنيفاً حقيقياً (MEDIA_DOWNLOAD_FAILED لخطأ تنزيل الوسائط 9007).
 *  (ج) الواجهة تعرض الكود والرسالة معاً، وتُميّز YouTube بأنه يُنشر عبر طابوره المخصص.
 * بلا أي شبكة حقيقية ولا سرّ.
 */

import { InstagramClient } from '../social/instagram';
import { ThreadsClient } from '../social/threads';
import { summarizePublishFailures, formatPublishFailure, isYouTubeDedicatedPublish, formatPlatformResultState, youtubeDedicatedDisclosure } from '../../src/utils/publishResult';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

/** fetch وهمي يعيد استجابة Meta خطأ مع رمز HTTP المطلوب. */
function fakeFetch(status: number, body: any) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

async function run(): Promise<void> {
  // 1) إنستغرام: خطأ تنزيل الوسائط (Meta 9007) — الرسالة الحقيقية تصل والكود يُميَّز.
  {
    const realMessage = 'The media could not be fetched from the provided URL (download the video failed).';
    const c = new InstagramClient(fakeFetch(400, { error: { message: realMessage, code: 9007 } }));
    const res = await c.createMediaContainer('IG1', 'tok', { videoUrl: 'https://drive.example/x', caption: 'hi' });
    check('instagram: يُعلن الفشل لا النجاح', res.ok === false && !res.data);
    check('instagram: الرسالة الحقيقية تصل حرفياً (لا تُستبدل)', res.error === realMessage, String(res.error));
    check('instagram: الكود الحقيقي MEDIA_DOWNLOAD_FAILED لا MEDIA_REQUIRED', res.code === 'MEDIA_DOWNLOAD_FAILED', String(res.code));
    check('instagram: كود Meta الخام (9007) مُمرَّر للتشخيص', res.providerCode === 9007, String(res.providerCode));
  }

  // 2) إنستغرام: خطأ عام بلا صلة بالوسائط — يجب ألا يُكلَّس خطأ وسائط.
  {
    const realMessage = 'Invalid OAuth 2.0 Access Token';
    const c = new InstagramClient(fakeFetch(400, { error: { message: realMessage, code: 190 } }));
    const res = await c.createMediaContainer('IG1', 'tok', { videoUrl: 'https://drive.example/x' });
    check('instagram: رسالة خطأ المصادقة تصل حرفياً', res.error === realMessage, String(res.error));
    check('instagram: رمز منتهٍ (190) يُصنَّف TOKEN_EXPIRED لا خطأ وسائط', res.code === 'TOKEN_EXPIRED', String(res.code));
  }

  // 3) ثريدز: خطأ تنزيل الفيديو من رابط عام (Meta 9007) — الرسالة والكود الحقيقيان.
  {
    const realMessage = "The video couldn't be downloaded from video_url.";
    const c = new ThreadsClient(fakeFetch(400, { error: { message: realMessage, code: 9007 } }));
    const res = await c.createMediaContainer('TH1', 'tok', { text: 'hi', videoUrl: 'https://drive.example/y' });
    check('threads: يُعلن الفشل لا النجاح', res.ok === false && !res.data);
    check('threads: الرسالة الحقيقية تصل حرفياً (لا تُستبدل)', res.error === realMessage, String(res.error));
    check('threads: الكود الحقيقي MEDIA_DOWNLOAD_FAILED لا PROVIDER_ERROR', res.code === 'MEDIA_DOWNLOAD_FAILED', String(res.code));
  }

  // 4) ثريدز: خطأ غير وسائطي (رمز منتهٍ 190) — كود حقيقي لا PROVIDER_ERROR ثابت مضلِّل.
  {
    const realMessage = 'Error validating access token: Session has expired on Monday.';
    const c = new ThreadsClient(fakeFetch(400, { error: { message: realMessage, code: 190 } }));
    const res = await c.createMediaContainer('TH1', 'tok', { text: 'hi' });
    check('threads: الرسالة الحقيقية تصل', res.error === realMessage, String(res.error));
    check('threads: انتهاء الرمز يُصنَّف TOKEN_EXPIRED لا CLIENT_ERROR', res.code === 'TOKEN_EXPIRED', String(res.code));
  }

  // 4ب) Facebook: كود Meta الحقيقي (100) ورقمه يُمرَّران مع الرسالة الحقيقية.
  {
    const { FacebookClient } = await import('../social/facebook');
    const realMessage = '(#100) No permission to publish the video';
    const c = new FacebookClient(fakeFetch(400, { error: { message: realMessage, code: 100 } }));
    const res = await c.publishVideoToPage('PAGE1', 'tok', 'https://drive.example/v.mp4', 'desc');
    check('facebook: الرسالة الحقيقية (#100) تصل حرفياً', res.error === realMessage, String(res.error));
    check('facebook: كود Meta الخام (100) مُمرَّر', res.providerCode === 100, String(res.providerCode));
    check('facebook: الكود المصنَّف صريح (PERMISSION_DENIED)', res.code === 'PERMISSION_DENIED', String(res.code));
    // رمز منتهٍ 190 ⇒ TOKEN_EXPIRED
    const c2 = new FacebookClient(fakeFetch(400, { error: { message: 'Error validating access token: Session has expired', code: 190 } }));
    const res2 = await c2.publishToPage('PAGE1', 'tok', 'hello');
    check('facebook: انتهاء الرمز (190) يُصنَّف TOKEN_EXPIRED', res2.code === 'TOKEN_EXPIRED', String(res2.code));
  }

  // 4ج) Instagram: الفيديو (غير الموسوم ريلز) يُنشأ كـREELS — قيمة media_type=VIDEO
  // مهجورة لدى Meta وتُرد بـ(code=100, subcode=2207067, Unsupported media type VIDEO).
  {
    const { buildMediaContainerBody } = await import('../social/instagram');
    const vid = buildMediaContainerBody({ videoUrl: 'https://drive.example/v.mp4', caption: 'عرض' });
    check('instagram: الفيديو يُنشأ كـREELS لا VIDEO (القيمة المهجورة)', vid.body.get('media_type') === 'REELS', String(vid.body.get('media_type')));
    check('instagram: الفيديو يضع video_url', vid.body.get('video_url') === 'https://drive.example/v.mp4');
    check('instagram: الفيديو يضع share_to_feed=true افتراضاً', vid.body.get('share_to_feed') === 'true', String(vid.body.get('share_to_feed')));
    const reel = buildMediaContainerBody({ videoUrl: 'https://drive.example/v.mp4', reel: true });
    check('instagram: الريلز يبقى media_type=REELS', reel.body.get('media_type') === 'REELS', String(reel.body.get('media_type')));
    check('instagram: الريلز يضع share_to_feed=true افتراضاً', reel.body.get('share_to_feed') === 'true', String(reel.body.get('share_to_feed')));
    const reelNoFeed = buildMediaContainerBody({ videoUrl: 'https://drive.example/v.mp4', shareToFeed: false });
    check('instagram: shareToFeed=false => share_to_feed=false', reelNoFeed.body.get('share_to_feed') === 'false');
    check('instagram: لا توجد قيمة VIDEO المهجورة في أي طلب فيديو', [vid, reel, reelNoFeed].every((b) => b.body.get('media_type') !== 'VIDEO'));
    const img = buildMediaContainerBody({ imageUrl: 'https://drive.example/p.jpg' });
    check('instagram: الصورة لا تضع media_type/share_to_feed (الافتراضي صور)', img.body.get('media_type') === null && img.body.get('share_to_feed') === null && img.body.get('image_url') === 'https://drive.example/p.jpg');
    const textOnly = buildMediaContainerBody({ caption: 'نص فقط' });
    check('instagram: نص فقط مرفوض صراحةً بلا وسائط', !textOnly.ok && textOnly.mediaKind === null && textOnly.body.get('video_url') === null && textOnly.body.get('image_url') === null);
  }

  // 4د) Telegram: كود الخطأ الحقيقي (403/400) يُصنَّف ولا تُخفى الرسالة.
  {
    const { telegramErrorCode } = await import('../social/telegram');
    check('telegram: حجب البوت (403) ⇒ PERMISSION_DENIED', telegramErrorCode('Forbidden: bot was blocked by the user', 403) === 'PERMISSION_DENIED');
    check('telegram: chat not found (400) ⇒ BAD_REQUEST', telegramErrorCode('Bad Request: chat not found', 400) === 'BAD_REQUEST');
    check('telegram: خطأ عام ⇒ PROVIDER_ERROR', telegramErrorCode('some unknown', 500) === 'PROVIDER_ERROR');
  }

  // 4هـ) الحقول التشخيصية الكاملة (error_subcode/fbtrace_id) تُمرَّر من Meta — للتشخيص.
  {
    const full = { error: { message: 'Invalid parameter', code: 100, error_subcode: 1234567, fbtrace_id: 'AbCdEf12345', type: 'OAuthException' } };
    const ig = new InstagramClient(fakeFetch(400, full));
    const igRes = await ig.createMediaContainer('IG1', 'tok', { videoUrl: 'https://drive.example/x' });
    check('instagram: error_subcode مُمرَّر', igRes.providerSubcode === 1234567, String(igRes.providerSubcode));
    check('instagram: fbtrace_id مُمرَّر', igRes.providerTraceId === 'AbCdEf12345', String(igRes.providerTraceId));
    const { FacebookClient } = await import('../social/facebook');
    const fb = new FacebookClient(fakeFetch(400, full));
    const fbRes = await fb.publishVideoToPage('PAGE1', 'tok', 'https://drive.example/v.mp4', 'desc');
    check('facebook: error_subcode مُمرَّر', fbRes.providerSubcode === 1234567, String(fbRes.providerSubcode));
    check('facebook: fbtrace_id مُمرَّر', fbRes.providerTraceId === 'AbCdEf12345', String(fbRes.providerTraceId));
    const th = new ThreadsClient(fakeFetch(400, full));
    const thRes = await th.createMediaContainer('TH1', 'tok', { text: 'hi' });
    check('threads: error_subcode مُمرَّر', thRes.providerSubcode === 1234567, String(thRes.providerSubcode));
    check('threads: fbtrace_id مُمرَّر', thRes.providerTraceId === 'AbCdEf12345', String(thRes.providerTraceId));
  }

  // 5) الواجهة: عرض الكود والرسالة معاً (لا إخفاء لأحدهما).
  {
    const line = formatPublishFailure('instagram', { code: 'MEDIA_DOWNLOAD_FAILED', error: 'The media could not be fetched' });
    check('الواجهة: الكود ظاهر', line.includes('MEDIA_DOWNLOAD_FAILED'), line);
    check('الواجهة: الرسالة الحقيقية ظاهرة', line.includes('The media could not be fetched'), line);
    const summary = summarizePublishFailures([
      ['instagram', { code: 'MEDIA_DOWNLOAD_FAILED', error: 'The media could not be fetched' }],
    ]);
    check('ملخّص الواجهة يجمع الكود والرسالة', summary.includes('MEDIA_DOWNLOAD_FAILED') && summary.includes('The media could not be fetched'), summary);
  }

  // 6) الواجهة: YouTube يُعرض كتوجيه لطابوره المخصص لا «فشل».
  {
    const ytResult = { code: 'PLATFORM_USE_DEDICATED_PUBLISH', error: 'نشر YouTube الحقيقي يحتاج بايتات الفيديو' };
    check('isYouTubeDedicatedPublish يميّز توجيه YouTube', isYouTubeDedicatedPublish(ytResult) === true);
    const summary = summarizePublishFailures([['youtube', ytResult]]);
    check('ملخّص YouTube يذكر الطابور المخصص ولا يعرضه كفشل حقيقي', summary.includes('طابوره المخصص'), summary);
    // منصة فاشلة حقيقية + YouTube: يظهر الكود والرسالة للمنصة الحقيقية فقط.
    const mixed = summarizePublishFailures([
      ['youtube', ytResult],
      ['threads', { code: 'MEDIA_DOWNLOAD_FAILED', error: "The video couldn't be downloaded from video_url." }],
    ]);
    check('خلط YouTube + فشل حقيقي: الرسالة الحقيقية تظهر', mixed.includes("The video couldn't be downloaded"), mixed);
    check('خلط YouTube + فشل حقيقي: الطابور المخصص مذكور', mixed.includes('طابوره المخصص'), mixed);
  }

  // 8) الإفصاح **قبل** الزر: يوتيوب المحدد يُعلن صراحةً أنه يذهب لطابوره المخصص.
  {
    const withYt = youtubeDedicatedDisclosure(['facebook', 'instagram', 'youtube']);
    check('إفصاح: تظهر رسالة عند وجود يوتيوب', typeof withYt === 'string' && withYt.length > 0, String(withYt));
    check('إفصاح: يذكر أن يوتيوب مستثنى من النشر الفوري', Boolean(withYt && withYt.includes('مستثنى') && withYt.includes('يوتيوب')), String(withYt));
    check('إفصاح: يذكر الطابور المخصص', Boolean(withYt && withYt.includes('طابور')), String(withYt));
    check('إفصاح: يوضّح أن بقية المنصات تُنشر الآن', Boolean(withYt && withYt.includes('بقية المنصات')), String(withYt));
    check('إفصاح: يعود null بلا يوتيوب (لا ضجيج)', youtubeDedicatedDisclosure(['facebook', 'instagram']) === null);
    check('إفصاح: يعود null لمصفوفة فارغة', youtubeDedicatedDisclosure([]) === null);
    check('إفصاح: يعود null لغير مصفوفة (undefined)', youtubeDedicatedDisclosure(undefined) === null);
    check('إفصاح: يوتيوب وحده يُعلن صراحةً', youtubeDedicatedDisclosure(['youtube']) !== null);
  }

  // 7) الواجهة: تمييز مصير كل منصة في لوحة النتائج (لا رقم أخضر إجمالي واحد).
  {
    const ok = formatPlatformResultState({ state: 'published', providerPostId: 'POST_9' });
    check('منشور بمعرّف مزود => tone ok', ok.tone === 'ok', JSON.stringify(ok));
    check('منشور بمعرّف مزود => يذكر المعرّف', ok.label.includes('POST_9'), ok.label);
    // published بلا معرّف مزود لا يُدّعى كنجاح موثّق.
    const pubNoId = formatPlatformResultState({ state: 'published', providerPostId: null });
    check('published بلا معرّف => لا يذكر معرّفاً', pubNoId.tone === 'ok' && !pubNoId.label.includes('null'));
    const pending = formatPlatformResultState({ state: 'publishing', providerPostId: 'PID' });
    check('قيد المعالجة => tone pending ولا ادعاء تسليم', pending.tone === 'pending', JSON.stringify(pending));
    const fail = formatPlatformResultState({ state: 'failed', code: 'MEDIA_DOWNLOAD_FAILED', error: 'The media could not be fetched' });
    check('فشل => tone fail ويظهر الكود', fail.tone === 'fail' && fail.label.includes('MEDIA_DOWNLOAD_FAILED'), fail.label);
    const yt = formatPlatformResultState({ code: 'PLATFORM_USE_DEDICATED_PUBLISH', error: 'x' });
    check('YouTube => توجيه لطابوره لا فشل', yt.tone === 'pending' && yt.label.includes('طابوره المخصص'), yt.label);
  }

  console.log(`PASSED: ${passed} publish-provider-error checks`);
  if (failures.length) {
    console.error('FAILURES:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

run();
