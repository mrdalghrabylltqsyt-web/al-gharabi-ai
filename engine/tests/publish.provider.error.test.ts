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
import { summarizePublishFailures, formatPublishFailure, isYouTubeDedicatedPublish } from '../../src/utils/publishResult';

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
    check('instagram: لا يُكلَّس خطأ وسائط زوراً', res.code === 'CLIENT_ERROR', String(res.code));
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

  // 4) ثريدز: خطأ غير وسائطي — كود عام لا PROVIDER_ERROR ثابت مضلِّل.
  {
    const realMessage = 'The access token is invalid.';
    const c = new ThreadsClient(fakeFetch(400, { error: { message: realMessage, code: 190 } }));
    const res = await c.createMediaContainer('TH1', 'tok', { text: 'hi' });
    check('threads: الرسالة الحقيقية تصل', res.error === realMessage, String(res.error));
    check('threads: لا تثبيت PROVIDER_ERROR', res.code === 'CLIENT_ERROR', String(res.code));
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

  console.log(`PASSED: ${passed} publish-provider-error checks`);
  if (failures.length) {
    console.error('FAILURES:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

run();
