/**
 * اختبارات تكامل لمسارات مدير السوشيال ميديا على خادم Express حقيقي.
 *
 * تُشغَّل المسارات الفعلية عبر HTTP، مع حالة اتصال مُتحكَّم بها، للتحقق من أن
 * النظام لا يدّعي اتصالاً ولا نشراً ولا تحليلاً غير موجود.
 */

import express from 'express';
import { registerSocialManagerRoutes } from '../social/routes';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const PORT = 4319 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;

// مستخدم مصادق عليه للاختبار: المسارات تُختبر بجلسة صالحة، والمصادقة نفسها
// مغطاة ببوابة المصادقة الفعلية في الخادم.
const TEST_USER = { id: 'owner', role: 'owner' };

function buildApp(connections: Map<string, any>, workspace: any) {
  const app = express();
  app.use(express.json());
  const authenticateToken: express.RequestHandler = (req, _res, next) => {
    (req as any).user = TEST_USER;
    next();
  };
  const requireOwner: express.RequestHandler = (req, _res, next) => {
    (req as any).user = TEST_USER;
    next();
  };
  registerSocialManagerRoutes(app, {
    authenticateToken,
    requireOwner,
    workspace,
    platformConnections: connections,
    persistState: () => {},
    audit: () => {},
    workspaceId: (prefix: string) => `${prefix}-test-${Math.random().toString(16).slice(2, 8)}`,
  });
  return app;
}

function freshWorkspace() {
  return {
    showroom: { name: 'معرض الغرابي للتقسيط' },
    posts: [
      { id: 'post-approved', status: 'approved', content: 'عرض تقسيط جديد', targetPlatforms: ['facebook'], tags: ['تقسيط'] },
      { id: 'post-draft', status: 'draft', content: 'مسودة', targetPlatforms: ['facebook'] },
    ],
    socialComments: [],
    socialReplies: [],
    publishRecords: [],
    performanceRecords: [],
    marketingDecisions: [],
    strategiesTested: [],
  };
}

async function post(path: string, body: any) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json() };
}

async function run(): Promise<void> {
  // كل المنصات غير متصلة في البداية.
  const disconnected = new Map<string, any>();
  for (const id of ['tiktok', 'youtube', 'facebook', 'instagram', 'whatsapp', 'telegram', 'x', 'snapchat', 'threads', 'google_business']) {
    disconnected.set(id, { platform: id, status: 'disconnected' });
  }

  const workspace = freshWorkspace();
  const app = buildApp(disconnected, workspace);
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));

  try {
    // ------------------------------------------------------------ status
    const status = await get('/api/social/manager/status');
    check('حالة المدير تستجيب بنجاح', status.status === 200 && status.body.success === true);
    check('الحالة تعرض عشر منصات', status.body.summary.totalPlatforms === 10);
    check('كل المنصات غير متصلة عند البداية', status.body.summary.connected === 0 && status.body.summary.disconnected === 10);
    check('لا توجد أي بيانات تعليقات مُختلقة', status.body.activity.commentsTracked === 0);
    check('لا توجد أي سجلات نشر مُختلقة', status.body.activity.publishRecords === 0);

    // ------------------------------------------------------ capabilities
    const caps = await get('/api/social/manager/capabilities');
    check('القدرات تعرض المنصات العشر', caps.body.platforms.length === 10);
    check('لا منصة تُعلن جاهزية إنتاجية', caps.body.platforms.every((p: any) => p.productionReady === false));
    check('واتساب لا يعلن قدرة نشر', (() => {
      const wa = caps.body.platforms.find((p: any) => p.platform === 'whatsapp');
      return !wa.capabilities.includes('publish') && wa.capabilities.includes('messages');
    })());
    check('القدرات تتضمن توفر المؤشرات', (() => {
      const sc = caps.body.platforms.find((p: any) => p.platform === 'snapchat');
      const reach = sc.metrics.find((m: any) => m.metric === 'reach');
      return reach.available === false && Boolean(reach.reason);
    })());

    // ---------------------------------------------------------- classify
    const classify = await post('/api/social/manager/comments/classify', { text: 'بكم سعر الغسالة بالتقسيط؟', platform: 'facebook' });
    check('تصنيف الاستفسار التجاري ناجح', classify.body.classification.intent === 'business_inquiry');
    check('التصنيف يسمح بالرد الآلي للاستفسار', classify.body.autoReplyAllowed === true);
    check('التصنيف يقدم رداً حتمياً', typeof classify.body.suggestedDeterministicReply === 'string');

    const sensitive = await post('/api/social/manager/comments/classify', { text: 'سأرفع قضية قانونية ضدكم' });
    check('الحالة الحساسة لا تسمح برد آلي', sensitive.body.autoReplyAllowed === false && sensitive.body.classification.requiresHumanReview === true);

    const spam = await post('/api/social/manager/comments/classify', { text: 'اربح المال https://spam.example' });
    check('السبام لا يسمح برد آلي', spam.body.autoReplyAllowed === false);

    const empty = await post('/api/social/manager/comments/classify', { text: '   ' });
    check('نص فارغ يُرفض بطلب غير صالح', empty.status === 400);

    // ------------------------------------------------------ reply guards
    const replyDisconnected = await post('/api/social/manager/comments/reply', {
      platform: 'facebook', externalId: 'c1', text: 'أهلاً بك', commentText: 'بكم السعر؟',
    });
    check('الرد على منصة غير متصلة مرفوض', replyDisconnected.status === 409, `status=${replyDisconnected.status}`);
    check('سبب الرفض يذكر عدم الاتصال', String(replyDisconnected.body.error).includes('غير متصلة'));

    const replyNoPlatform = await post('/api/social/manager/comments/reply', { platform: 'myspace', externalId: 'c1', text: 'x' });
    check('منصة غير معروفة مرفوضة', replyNoPlatform.status === 400);

    const replyNoId = await post('/api/social/manager/comments/reply', { platform: 'facebook', text: 'x' });
    check('غياب معرّف التعليق مرفوض', replyNoId.status === 400);

    // منصة لا تدعم الرد على التعليقات أصلاً.
    const replyNoCapability = await post('/api/social/manager/comments/reply', {
      platform: 'whatsapp', externalId: 'c9', text: 'x', commentText: 'استفسار',
    });
    check('منصة لا تدعم التعليقات تُرفض بوضوح', replyNoCapability.status === 501 || replyNoCapability.status === 409);

    // ------------------------------------------------------- ingest/replay
    const ingest1 = await post('/api/social/manager/comments/ingest', {
      platform: 'facebook', externalId: 'evt-1', text: 'بكم سعر الثلاجة؟', authorName: 'أحمد',
    });
    check('تسجيل تعليق وارد ناجح', ingest1.status === 200 && ingest1.body.duplicate === false);
    check('التعليق الوارد يُصنَّف', ingest1.body.comment.classification.intent === 'business_inquiry');

    const ingest2 = await post('/api/social/manager/comments/ingest', {
      platform: 'facebook', externalId: 'evt-1', text: 'بكم سعر الثلاجة؟', authorName: 'أحمد',
    });
    check('إعادة إرسال نفس الحدث لا تُنشئ سجلاً مكرراً', ingest2.body.duplicate === true);
    check('عدد التعليقات بقي واحداً بعد إعادة الإرسال', workspace.socialComments.length === 1);

    const comments = await get('/api/social/manager/comments?platform=facebook');
    check('التعليقات المعروضة مطابقة للسجل', comments.body.count === 1);
    check('جلب التعليقات الخارجي غير متاح بدون اتصال', comments.body.externalFetchAvailable === false);

    // ---------------------------------------------------------- preflight
    const pfNoConn = await post('/api/social/manager/publish/preflight', { platform: 'facebook', postId: 'post-approved' });
    check('فحص النشر يفشل بدون اتصال', pfNoConn.body.ready === false);
    check('سبب الفشل يذكر الاتصال', pfNoConn.body.reasons.some((r: string) => r.includes('غير متصل')));

    const pfNoApproval = await post('/api/social/manager/publish/preflight', { platform: 'facebook', postId: 'post-draft' });
    check('فحص النشر يفشل بدون موافقة', pfNoApproval.body.ready === false);

    // ------------------------------------------------------------ publish
    const publishNoConn = await post('/api/social/manager/publish/execute', { platform: 'facebook', postId: 'post-approved' });
    check('تنفيذ النشر مرفوض بدون اتصال', publishNoConn.status === 409);
    check('لا يُسجَّل أي نشر ناجح', workspace.publishRecords.length === 0);

    const publishMissing = await post('/api/social/manager/publish/execute', { platform: 'facebook', postId: 'nope' });
    check('منشور غير موجود يُرفض', publishMissing.status === 404);

    // ---------------------------------------------------------- analytics
    const analytics = await get('/api/social/manager/analytics?platform=instagram');
    check('تحليلات إنستغرام تستجيب', analytics.status === 200);
    check('لا توجد قيم مختلقة بدون سجلات', analytics.body.sampleSize === 0);
    check('القيم تظهر null بدون بيانات', analytics.body.metrics.every((m: any) => m.value === null));
    check('المؤشرات غير المتاحة معللة', analytics.body.metrics.filter((m: any) => !m.available).every((m: any) => Boolean(m.reason)));
    check('جلب التحليلات الخارجي غير متاح بدون اتصال', analytics.body.externalFetchAvailable === false);

    const analyticsBad = await get('/api/social/manager/analytics?platform=myspace');
    check('تحليلات منصة غير معروفة مرفوضة', analyticsBad.status === 400);

    const recordRejected = await post('/api/social/manager/analytics/record', { platform: 'whatsapp', values: { views: 100 } });
    check('تسجيل مؤشر غير مدعوم مرفوض', recordRejected.status === 400);

    const recordOk = await post('/api/social/manager/analytics/record', {
      platform: 'instagram', values: { views: 1000, likes: 50, comments: 10, shares: 5, reach: 900, saves: 8, bogus: 999 },
    });
    check('تسجيل مؤشرات مدعومة ناجح', recordOk.status === 200);
    check('المؤشرات غير المدعومة تُستبعد', recordOk.body.record.values.bogus === undefined);
    check('المؤشرات المدعومة تُحفظ', recordOk.body.record.values.views === 1000 && recordOk.body.record.values.saves === 8);

    const analyticsAfter = await get('/api/social/manager/analytics?platform=instagram');
    check('التحليلات تعكس السجل الفعلي', analyticsAfter.body.sampleSize === 1 && analyticsAfter.body.metrics.find((m: any) => m.metric === 'views').value === 1000);
    check('نسبة التفاعل تُحسب من البيانات الفعلية', analyticsAfter.body.engagementRate === 8.11);

    // -------------------------------------------------------------- brain
    const brain = await get('/api/social/manager/brain/decision');
    check('قرار العقل التسويقي يستجيب', brain.status === 200 && brain.body.success === true);
    check('الخطة تغطي منصات', brain.body.decision.plan.length > 0);
    check('كل توصية تحمل سبباً', brain.body.decision.plan.every((p: any) => p.reason.length > 10));
    check('الخطة تُعلن فجوات البيانات', Array.isArray(brain.body.decision.dataGaps));
    check('الذاكرة مبنية على السجلات الفعلية', brain.body.memory.publishedCount === 0);

    const memory = await get('/api/social/manager/memory');
    check('ذاكرة التشغيل تستجيب', memory.status === 200 && memory.body.success === true);
    check('الذاكرة تجمع الأسئلة المتكررة من التعليقات الفعلية', memory.body.memory.frequentQuestions.length >= 1);

    // ------------------------------------- connected platform honours rules
    disconnected.set('facebook', { platform: 'facebook', status: 'connected', providerVerified: true, accountName: 'معرض الغرابي', accountId: 'fb-1' });
    const statusConnected = await get('/api/social/manager/status');
    check('المنصة المتصلة تُحتسب متصلة', statusConnected.body.summary.connected === 1);

    const pfConnected = await post('/api/social/manager/publish/preflight', { platform: 'facebook', postId: 'post-approved' });
    check('فحص النشر ينجح عند اتصال موثق وموافقة', pfConnected.body.ready === true);

    // الاتصال الموثق لا يعني نشراً حقيقياً: لا موصل إنتاجي معتمد بعد.
    const publishConnected = await post('/api/social/manager/publish/execute', { platform: 'facebook', postId: 'post-approved' });
    check('النشر لا ينجح بدون موصل إنتاجي', publishConnected.status === 501 && publishConnected.body.executed === false);
    check('سجل النشر يُسجَّل فاشلاً لا منشوراً', publishConnected.body.record.state === 'failed' && publishConnected.body.record.providerPostId === null);
    check('المحاولة مُعلَّمة كمحاكاة', publishConnected.body.record.simulated === true);

    const publishRecords = await get('/api/social/manager/publish/records');
    check('سجل النشر يحفظ المحاولة الفعلية', publishRecords.body.count === 1);
    check('لا يوجد أي نشر ناجح مُختلق', publishRecords.body.publishedCount === 0);

    const capsConnected = await get('/api/social/manager/capabilities');
    check('لا تزال المنصة غير جاهزة إنتاجياً', capsConnected.body.platforms.every((p: any) => p.productionReady === false));

    // الرد الآن: الاتصال موجود لكن لا موصل إرسال → يُسجَّل محلياً كمحاكاة.
    const replyConnected = await post('/api/social/manager/comments/reply', {
      platform: 'facebook', externalId: 'c-reply-1', text: 'أهلاً بك، نشكر تواصلك معنا.', commentText: 'بكم السعر؟',
    });
    check('الرد يُقبل عند اتصال موثق', replyConnected.status === 200);
    check('الرد لا يُدّعى إرساله', replyConnected.body.delivered === false && replyConnected.body.simulated === true);
    check('سجل الرد يحفظ البصمة', typeof replyConnected.body.reply.replyFingerprint === 'string');

    const replyDuplicate = await post('/api/social/manager/comments/reply', {
      platform: 'facebook', externalId: 'c-reply-1', text: 'رد آخر', commentText: 'بكم السعر؟',
    });
    check('الرد المكرر على نفس التعليق مرفوض', replyDuplicate.status === 409);
    check('سبب الرفض يذكر الرد المسبق', String(replyDuplicate.body.error).includes('مسبقاً'));

    const replySelf = await post('/api/social/manager/comments/reply', {
      platform: 'facebook', externalId: 'c-reply-2', text: 'شكراً', commentText: 'شكراً لكم', authorName: 'معرض الغرابي',
    });
    check('الرد على حساب المعرض نفسه مرفوض (حلقة ردود)', replySelf.status === 409);

    const replySensitive = await post('/api/social/manager/comments/reply', {
      platform: 'facebook', externalId: 'c-reply-3', text: 'نعتذر', commentText: 'سأرفع قضية قانونية ضدكم',
    });
    check('الرد الآلي على الحالة الحساسة مرفوض', replySensitive.status === 422 && replySensitive.body.requiresHumanReview === true);

    // منصة لا تدعم التعليقات: تُرفض قبل أي محاولة.
    disconnected.set('snapchat', { platform: 'snapchat', status: 'connected', providerVerified: true });
    const replyUnsupported = await post('/api/social/manager/comments/reply', {
      platform: 'snapchat', externalId: 'c-reply-4', text: 'مرحباً', commentText: 'استفسار',
    });
    check('منصة لا تدعم الرد تُرفض بوضوح', replyUnsupported.status === 501);

    // ----------------------------------------- عقد الواجهة (client/server)
    // يتحقق من أن حقول الأنواع المُعلنة في الواجهة موجودة فعلاً في استجابات
    // الخادم، حتى لا تنحرف الأنواع عن الواقع عند أي تعديل لاحق.
    const contractStatus = await get('/api/social/manager/status');
    const statusFields = ['success', 'generatedAt', 'platforms', 'summary', 'content', 'activity', 'note'];
    check('عقد الحالة يطابق الأنواع المُعلنة', statusFields.every((f) => f in contractStatus.body), `missing=${statusFields.filter((f) => !(f in contractStatus.body))}`);
    const platformFields = ['platform', 'displayName', 'connection', 'accountId', 'accountName', 'connectedAt', 'providerVerified', 'capabilities', 'productionReady', 'readinessNote'];
    check('عقد المنصة يطابق الأنواع المُعلنة', platformFields.every((f) => f in contractStatus.body.platforms[0]), `missing=${platformFields.filter((f) => !(f in contractStatus.body.platforms[0]))}`);
    const summaryFields = ['totalPlatforms', 'connected', 'disconnected', 'reauthNeeded', 'publishCapable', 'commentCapable'];
    check('عقد الملخص يطابق الأنواع المُعلنة', summaryFields.every((f) => f in contractStatus.body.summary));

    const contractCaps = await get('/api/social/manager/capabilities');
    check('عقد القدرات يتضمن المؤشرات', 'metrics' in contractCaps.body.platforms[0]);
    check('عقد المؤشر يطابق الأنواع المُعلنة', ['metric', 'available'].every((f) => f in contractCaps.body.platforms[0].metrics[0]));
    // السبب إلزامي للمؤشر غير المتاح، ومُهمَل للمتاح — مطابق للأنواع المُعلنة.
    const unavailableMetrics = contractCaps.body.platforms[0].metrics.filter((m: any) => !m.available);
    check('المؤشر غير المتاح يحمل سبباً صريحاً', unavailableMetrics.length > 0 && unavailableMetrics.every((m: any) => typeof m.reason === 'string' && m.reason.length > 0));

    const contractClassify = await post('/api/social/manager/comments/classify', { text: 'بكم السعر؟' });
    const classFields = ['intent', 'sentiment', 'isQuestion', 'isComplaint', 'isPraise', 'isBusinessInquiry', 'isSpam', 'requiresHumanReview', 'signals'];
    check('عقد التصنيف يطابق الأنواع المُعلنة', classFields.every((f) => f in contractClassify.body.classification), `missing=${classFields.filter((f) => !(f in contractClassify.body.classification))}`);
    check('عقد نتيجة التصنيف يطابق الأنواع المُعلنة', ['success', 'platform', 'classification', 'autoReplyAllowed', 'suggestedDeterministicReply', 'note'].every((f) => f in contractClassify.body));

    const contractAnalytics = await get('/api/social/manager/analytics?platform=instagram');
    const analyticsFields = ['success', 'platform', 'displayName', 'connection', 'metrics', 'engagementRate', 'sampleSize', 'externalFetchAvailable', 'note'];
    check('عقد التحليلات يطابق الأنواع المُعلنة', analyticsFields.every((f) => f in contractAnalytics.body), `missing=${analyticsFields.filter((f) => !(f in contractAnalytics.body))}`);

    const contractBrain = await get('/api/social/manager/brain/decision');
    const brainFields = ['success', 'generatedAt', 'objective', 'connectedPlatforms', 'decision', 'memory', 'note'];
    check('عقد قرار العقل يطابق الأنواع المُعلنة', brainFields.every((f) => f in contractBrain.body));
    const decisionFields = ['objective', 'audience', 'plan', 'dataGaps', 'learnings', 'nextAdjustment'];
    check('عقد القرار يطابق الأنواع المُعلنة', decisionFields.every((f) => f in contractBrain.body.decision), `missing=${decisionFields.filter((f) => !(f in contractBrain.body.decision))}`);
    const planFields = ['platform', 'contentType', 'format', 'suggestedTiming', 'timingConfidence', 'reason', 'successMetric', 'metricAvailable'];
    check('عقد خطة القرار يطابق الأنواع المُعلنة', planFields.every((f) => f in contractBrain.body.decision.plan[0]));

    const contractMemory = await get('/api/social/manager/memory');
    const memoryFields = ['publishedCount', 'scheduledCount', 'platformBreakdown', 'contentTypeBreakdown', 'topComments', 'frequentQuestions', 'decisions', 'strategiesTested'];
    check('عقد الذاكرة يطابق الأنواع المُعلنة', memoryFields.every((f) => f in contractMemory.body.memory), `missing=${memoryFields.filter((f) => !(f in contractMemory.body.memory))}`);

    const contractPublish = await get('/api/social/manager/publish/records');
    check('عقد سجلات النشر يطابق الأنواع المُعلنة', ['success', 'records', 'count', 'publishedCount', 'note'].every((f) => f in contractPublish.body));

    console.log('\n' + '='.repeat(60));
    if (failures.length) {
      console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
      for (const f of failures) console.error(`  ✗ ${f}`);
      process.exitCode = 1;
    } else {
      console.log(`PASSED: ${passed} integration checks`);
    }
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error('Integration harness crashed:', err);
  process.exit(1);
});
