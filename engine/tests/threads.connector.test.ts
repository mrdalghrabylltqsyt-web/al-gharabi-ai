/**
 * اختبارات موصل Threads الحقيقي (Task #24) — رابع تكامل اجتماعي خارجي.
 *
 * وحدة فقط (بلا تشغيل خادم حقيقي): الدوال الحتمية (بناء جسم الحاوية وجسم
 * النشر) وعميل الشبكة (ThreadsClient) بمحاكي fetch محلي. السبب: Threads في
 * Task #24 يملك قدرة `publish` فقط (لا webhook ولا تعليقات)، فلا حاجة لخادم
 * حقيقي ومحاكي Graph كامل كما في اختبارات Facebook/Instagram؛ التحقق من سلك
 * الاستدعاء داخل executePlatformPublish و OAuth العام يُغطّى بفحوص نصية
 * ثابتة في platform.foundation.test.ts (منع الهوية المزيّفة + سلك الفرع).
 *
 * لا يلمس أي مزود Meta حقيقي ولا يستهلك أي حصة، ولا يستخدم أي سرّ واقعي.
 */

import {
  THREADS_GRAPH_BASE,
  THREADS_GRAPH_VERSION,
  threadsGraphBase,
  threadsGraphVersion,
  threadsGraphUrl,
  buildThreadsContainerBody,
  buildThreadsPublishBody,
  ThreadsClient,
  type ThreadsFetch,
} from '../social/threads';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

async function run(): Promise<void> {
  group('1) وحدة: روابط Graph (قاعدة threads.net منفصلة عن facebook.com)');
  check('القاعدة الرسمية graph.threads.net', THREADS_GRAPH_BASE === 'https://graph.threads.net');
  check('الإصدار الافتراضي v1.0', THREADS_GRAPH_VERSION === 'v1.0');
  check('threadsGraphBase يستخدم الافتراضي بلا تجاوز', threadsGraphBase() === THREADS_GRAPH_BASE);
  check('threadsGraphBase يقبل تجاوزاً صريحاً (للاختبار)', threadsGraphBase('http://127.0.0.1:9') === 'http://127.0.0.1:9');
  check('threadsGraphBase يحذف الشرطة اللاحقة', threadsGraphBase('http://127.0.0.1:9/') === 'http://127.0.0.1:9');
  check('threadsGraphVersion يحذف الشرطات', threadsGraphVersion('/v1.0/') === 'v1.0');
  check('threadsGraphUrl يبني رابطاً كاملاً صحيحاً', threadsGraphUrl('/me') === 'https://graph.threads.net/v1.0/me');
  check('threadsGraphUrl يقبل مساراً بلا شرطة بادئة', threadsGraphUrl('me') === 'https://graph.threads.net/v1.0/me');
  check('threadsGraphUrl يحترم قاعدة مُتجاوَزة', threadsGraphUrl('/123/threads', 'http://127.0.0.1:9').startsWith('http://127.0.0.1:9/v1.0/123/threads'));

  group('2) وحدة: بناء جسم الحاوية — أولوية فيديو > صورة > نص');
  const videoBody = buildThreadsContainerBody({ text: 'عرض جديد', videoUrl: 'https://drive.example/v.mp4', imageUrl: 'https://x/img.jpg' });
  check('فيديو مزوَّد => media_type=VIDEO (أولوية على الصورة)', videoBody.mediaKind === 'video' && videoBody.body.get('media_type') === 'VIDEO');
  check('رابط الفيديو محفوظ بحقل video_url', videoBody.body.get('video_url') === 'https://drive.example/v.mp4');
  check('النص يُرفق مع الفيديو', videoBody.body.get('text') === 'عرض جديد');
  check('بلا صورة في جسم الفيديو', videoBody.body.get('image_url') === null);

  const imageBody = buildThreadsContainerBody({ text: 'صورة المنتج', imageUrl: 'https://x/img.jpg' });
  check('صورة بلا فيديو => media_type=IMAGE', imageBody.mediaKind === 'image' && imageBody.body.get('media_type') === 'IMAGE');
  check('رابط الصورة محفوظ', imageBody.body.get('image_url') === 'https://x/img.jpg');

  const textBody = buildThreadsContainerBody({ text: 'نص فقط بلا وسائط' });
  check('نص فقط مقبول (خلافاً لإنستغرام) => media_type=TEXT', textBody.mediaKind === 'text' && textBody.body.get('media_type') === 'TEXT');
  check('النص محفوظ في جسم TEXT', textBody.body.get('text') === 'نص فقط بلا وسائط');
  check('جسم TEXT بلا media_url', textBody.body.get('image_url') === null && textBody.body.get('video_url') === null);

  const emptyBody = buildThreadsContainerBody({});
  check('مدخل فارغ كلياً => TEXT بلا نص', emptyBody.mediaKind === 'text' && emptyBody.body.get('text') === null);

  const replyBody = buildThreadsContainerBody({ text: 'رد', replyToId: 'THREAD_1' });
  check('reply_to_id يحوّل المنشور إلى رد', replyBody.body.get('reply_to_id') === 'THREAD_1');
  check('بلا reply_to_id => الحقل غائب', buildThreadsContainerBody({ text: 'عادي' }).body.get('reply_to_id') === null);
  check('reply_to_id يُقصّ من المسافات', buildThreadsContainerBody({ text: 'رد', replyToId: '  THREAD_2  ' }).body.get('reply_to_id') === 'THREAD_2');

  group('3) وحدة: بناء جسم النشر');
  check('جسم النشر يحمل creation_id', buildThreadsPublishBody('CREATE_1').get('creation_id') === 'CREATE_1');
  check('جسم النشر لا يحمل أي حقل آخر', Array.from(buildThreadsPublishBody('CREATE_1').keys()).length === 1);

  group('4) وحدة: ThreadsClient.getProfile — إثبات الهوية (GET /me?fields=id,username)');
  const profileRequests: string[] = [];
  const fakeProfileFetch: ThreadsFetch = async (url) => {
    profileRequests.push(url);
    return { ok: true, status: 200, json: async () => ({ id: 'TU_1', username: 'gharabi_showroom' }) };
  };
  const profileClient = new ThreadsClient(fakeProfileFetch, 'https://graph.example');
  const profile = await profileClient.getProfile('TOKEN_A');
  check('إثبات الهوية نجح', profile.ok === true && profile.data?.threadsUserId === 'TU_1');
  check('اسم المستخدم مستخرَج', profile.data?.username === 'gharabi_showroom');
  check('طلب الحقول الصحيحة', decodeURIComponent(profileRequests[0] || '').includes('fields=id,username'));
  check('الرابط يستخدم القاعدة المتجاوزة', (profileRequests[0] || '').startsWith('https://graph.example/v1.0/me'));

  const noTokenProfile = await profileClient.getProfile('');
  check('بلا رمز وصول => رفض فوري بلا طلب شبكي', noTokenProfile.ok === false && profileRequests.length === 1);

  const noIdProfileFetch: ThreadsFetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const noIdProfile = await new ThreadsClient(noIdProfileFetch).getProfile('TOKEN_A');
  check('لا نجاح بلا id من Meta', noIdProfile.ok === false);

  const errorProfileFetch: ThreadsFetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid OAuth access token.' } }) });
  const errorProfile = await new ThreadsClient(errorProfileFetch).getProfile('BAD_TOKEN');
  check('فشل Meta => رسالة الخطأ الحقيقية محفوظة', errorProfile.ok === false && errorProfile.error === 'Invalid OAuth access token.');

  group('5) وحدة: ThreadsClient.createMediaContainer — لا نجاح بلا معرّف حاوية من Meta');
  const containerRequests: { url: string; body: any }[] = [];
  const fakeContainerFetch: ThreadsFetch = async (url, init) => {
    containerRequests.push({ url, body: Object.fromEntries(new URLSearchParams(String(init?.body || ''))) });
    return { ok: true, status: 200, json: async () => ({ id: 'CONTAINER_1' }) };
  };
  const containerClient = new ThreadsClient(fakeContainerFetch, 'https://graph.example');
  const container = await containerClient.createMediaContainer('TU_1', 'TOKEN_A', { text: 'منشور', videoUrl: 'https://drive.example/v.mp4' });
  check('إنشاء الحاوية نجح بمعرّف من Meta', container.ok === true && container.data?.containerId === 'CONTAINER_1');
  check('نوع الوسيط VIDEO مُعاد', container.data?.mediaKind === 'video');
  check('الطلب ذهب إلى /{threads-user-id}/threads', (containerRequests[0]?.url || '').includes('/TU_1/threads'));
  check('الجسم حمل media_type=VIDEO وvideo_url', containerRequests[0]?.body.media_type === 'VIDEO' && containerRequests[0]?.body.video_url === 'https://drive.example/v.mp4');

  const noContainerIdFetch: ThreadsFetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const failedContainer = await new ThreadsClient(noContainerIdFetch).createMediaContainer('TU_1', 'TOKEN_A', { text: 'x' });
  check('لا نجاح بلا معرّف حاوية', failedContainer.ok === false);

  const noUserIdContainer = await containerClient.createMediaContainer('', 'TOKEN_A', { text: 'x' });
  check('بلا معرّف حساب Threads => رفض فوري', noUserIdContainer.ok === false);

  group('6) وحدة: ThreadsClient.publishContainer — لا نجاح بلا معرّف منشور من Meta');
  const publishRequests: { url: string; body: any }[] = [];
  const fakePublishFetch: ThreadsFetch = async (url, init) => {
    publishRequests.push({ url, body: Object.fromEntries(new URLSearchParams(String(init?.body || ''))) });
    return { ok: true, status: 200, json: async () => ({ id: 'POST_1' }) };
  };
  const publishClient = new ThreadsClient(fakePublishFetch, 'https://graph.example');
  const publishResult = await publishClient.publishContainer('TU_1', 'TOKEN_A', 'CONTAINER_1');
  check('نشر الحاوية نجح بمعرّف منشور حقيقي', publishResult.ok === true && publishResult.data?.providerPostId === 'POST_1');
  check('الطلب ذهب إلى /{threads-user-id}/threads_publish', (publishRequests[0]?.url || '').includes('/TU_1/threads_publish'));
  check('الجسم حمل creation_id الصحيح', publishRequests[0]?.body.creation_id === 'CONTAINER_1');

  const noPublishIdFetch: ThreadsFetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const failedPublish = await new ThreadsClient(noPublishIdFetch).publishContainer('TU_1', 'TOKEN_A', 'CONTAINER_1');
  check('لا نجاح بلا معرّف منشور', failedPublish.ok === false);

  const missingArgsPublish = await publishClient.publishContainer('', 'TOKEN_A', '');
  check('بلا معرّف حساب أو حاوية => رفض فوري', missingArgsPublish.ok === false && publishRequests.length === 1);

  group('7) وحدة: ThreadsClient.getContainerStatus — تشخيص تأخر معالجة الفيديو');
  const statusFetch: ThreadsFetch = async () => ({ ok: true, status: 200, json: async () => ({ status: 'FINISHED', error_message: null }) });
  const statusResult = await new ThreadsClient(statusFetch).getContainerStatus('CONTAINER_1', 'TOKEN_A');
  check('حالة الحاوية مستخرجة', statusResult.ok === true && statusResult.data?.status === 'FINISHED');

  const statusErrorFetch: ThreadsFetch = async () => ({ ok: true, status: 200, json: async () => ({ status: 'ERROR', error_message: 'Media processing failed.' }) });
  const statusErrorResult = await new ThreadsClient(statusErrorFetch).getContainerStatus('CONTAINER_2', 'TOKEN_A');
  check('رسالة فشل المعالجة محفوظة', statusErrorResult.data?.errorMessage === 'Media processing failed.');

  const noContainerIdStatus = await new ThreadsClient(statusFetch).getContainerStatus('', 'TOKEN_A');
  check('بلا معرّف حاوية => رفض فوري', noContainerIdStatus.ok === false);

  group('8) وحدة: فشل الشبكة لا يُسقط الاستثناء — يُعاد كخطأ منظَّم');
  const throwingFetch: ThreadsFetch = async () => { throw new Error('network down'); };
  const thrownProfile = await new ThreadsClient(throwingFetch).getProfile('TOKEN_A');
  check('استثناء الشبكة يُعاد كـok=false بلا رمي', thrownProfile.ok === false && thrownProfile.error?.includes('network down'));

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} Threads connector checks`);
  }
}

run();
