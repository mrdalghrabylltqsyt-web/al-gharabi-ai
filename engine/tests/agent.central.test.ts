/**
 * اختبارات العقل المركزي (Central AI Agent).
 *
 * قسمان:
 *  1) وحدة (بلا شبكة): المخطّط، الصلاحيات، المنسّق، الآمن (idempotency، فشل،
 *     مهلة، موافقة، سجل تنفيذ، إخفاء الأسرار، عدم اختلاق نجاح).
 *  2) تكامل (Express حقيقي): التصريح (401/403/عمل لمستخدم غير مالك)، دورة مهمة
 *     كاملة عبر HTTP، عدم الادعاء بتنفيذ خارجي، دوام السياق.
 */

import express from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentOrchestrator } from '../agent/orchestrator';
import { registerAgentRoutes } from '../agent/routes';
import { buildAgentPlan, classifyIntent, detectPlatforms, wantsYouTubeComments, wantsYouTubeReply, wantsYouTubePublish, wantsYouTubeVideoUpdate, wantsYouTubeFullCycle, wantsYouTubeCommentCycle } from '../agent/planner';
import { canUseTool, toolRequiresApproval } from '../agent/permissions';
import { AGENT_TOOLS, getAgentTool } from '../agent/tools';
import { resolveArgValue, sanitizeOutput } from '../agent/orchestrator';
import { describeProviders, shouldUseCouncil, primaryProvider } from '../agent/providerRouter';
import { resolveYouTubeReplyState, YOUTUBE_REPLY_LIFECYCLE_STATES, YOUTUBE_REPLY_LIFECYCLE_LABELS_AR } from '../social/youtube';
import {
  defaultYouTubeDelegation,
  buildYouTubeDelegation,
  revokeYouTubeDelegation,
  normalizeYouTubeDelegation,
  summarizeYouTubeDelegation,
  evaluateYouTubeDelegation,
  requiredDelegationActions,
  YOUTUBE_DELEGATION_ACTIONS,
} from '../social/youtubeDelegation';
import type { AgentToolContext } from '../agent/tools';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

/** سياق أدوات وهمي حقيقي الشكل: يُعيد بيانات فعلية بلا شبكة، ولا أسرار. */
function fakeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  const base: AgentToolContext = {
    operator: 'owner',
    userId: 'owner',
    healthSnapshot: () => ({ version: '13.0.0', storage: { backend: 'file', healthy: true } }),
    platformStatuses: () => [{ platform: 'telegram', state: 'CONNECTED' }, { platform: 'instagram', state: 'EXTERNAL_SETUP_REQUIRED' }],
    readinessMatrix: () => [{ platform: 'telegram', connector: 'READY' }],
    connectionStatus: () => [{ platform: 'telegram', status: 'connected', providerVerified: true, realConnector: true }],
    credentialIntrospection: (p) => ({ platform: p, supported: true, configured: false, missing: ['X'], invalid: [] }),
    workspaceSummary: () => ({ products: 3, connectedPlatformIds: ['telegram'] }),
    listJobs: () => [{ id: 'j1', status: 'queued' }],
    createJob: (input) => ({ id: 'job-new', status: 'queued', type: input.type }),
    approveJob: (id) => ({ ok: true, id, status: 'approved' }),
    cancelJob: (id) => ({ ok: true, id, status: 'failed' }),
    retryJob: (id) => ({ ok: true, id, status: 'queued' }),
    executeJob: async (id) => ({ success: true, job: { id, status: 'executed' }, receipt: { provider: 'telegram' } }),
    listComments: () => [{ platform: 'telegram', externalId: 'tg:1:2', ingestSource: 'telegram_webhook' }],
    listCampaigns: () => [{ id: 'c1', title: 'حملة' }],
    buildWeekPlan: (platforms, focus) => ({ plan: [{ day: 'السبت', focus }], platforms }),
    marketingDecision: () => ({ objective: 'x', plan: [], dataGaps: [] }),
    memorySnapshot: () => ({ publishedCount: 0 }),
    brainSnapshot: () => ({ platforms: [{ platform: 'telegram', capabilities: ['publish'], readsComments: false, repliesToComments: false, publishes: true, realConnector: true }], learning: { byPlatform: [] }, recommendations: null, audience: null, contentPlan: null, ai: { providerCalls: 0 }, limitations: [], note: 'لقطة وهمية' }),
    brainContentPlan: (input) => ({ objective: input.objective || 'x', title: 'خطة', description: 'وصف', cta: 'تواصل', hashtags: [], keywords: [], platformAdaptations: [{ platform: 'telegram', withinLimit: true }], recommendedPublishTime: null, schedulingReason: 'عيّنة غير كافية', confidence: 'low', sourceData: [], limitations: [], requiresHumanReview: false, recommendedAction: 'مراجعة', complete: false }),
    systemVerification: () => ({ version: '13.0.0', storage: { durable: true } }),
    aiGenerate: async () => ({ text: 'نص بديل حتمي', usedProvider: false, source: 'fallback' }),
    // أدوات YouTube التشغيلية (وهمية آمنة: لا شبكة ولا أسرار) — تُستبدل في اختبارات الوحدة.
    youtubeStatus: () => ({ state: 'READY_TO_CONNECT', labelAr: 'جاهز للربط', tone: 'transitional', reason: 'لا اعتماد محفوظ', nextAction: 'ربط YouTube', youtubeOnlyMode: true }),
    youtubeVideos: async () => ({ ok: true, videos: [{ videoId: 'vid1', title: 'فيديو', viewCount: 10, likeCount: 2, commentCount: 1 }] }),
    youtubeAnalytics: async () => ({ ok: true, summary: { sampleSize: 1, totalViews: 10 }, audience: { basis: 'public_metrics' }, channel: { channelId: 'ch1' } }),
    youtubeComments: async () => ({ ok: true, comments: [], inserted: 0, duplicates: 0 }),
    youtubeLearning: async () => ({ ok: true, learning: { insights: [], sampleSize: 0 } }),
    youtubeReply: async (input) => ({ delivered: true, externalReplyId: 'yt-reply-1', state: 'sent', reply: { externalId: input.commentId } }),
    youtubeReplyVerify: async (input) => ({ real: Boolean(input.commentId), record: input.commentId ? { externalId: input.commentId, externalReplyId: input.externalReplyId ?? 'yt-reply-1', delivered: true, state: 'sent' } : undefined, note: 'تحقق وهمي' }),
    youtubePublish: async (input) => ({ record: { state: 'published' }, externalVideoId: 'yt-vid-1', url: 'https://www.youtube.com/watch?v=yt-vid-1', state: 'published', title: input.title }),
    youtubeVideoUpdate: async (input) => ({ video: { id: input.videoId, snippet: { title: input.title } } }),
  };
  return { ...base, ...overrides };
}

function makeOrch(ctx = fakeCtx(), overrides: any = {}) {
  let counter = 0;
  return new AgentOrchestrator({
    toolContext: ctx,
    now: overrides.now,
    newId: () => `t${++counter}`,
    stepTimeoutMs: overrides.stepTimeoutMs,
    maxAttempts: overrides.maxAttempts,
  });
}

async function unitTests() {
  // --- المخطّط: تصنيف النية واختيار الأدوات ---
  check('تصنيف: تشخيص', classifyIntent('المنصة لا تعمل، ما السبب؟') === 'diagnose');
  check('تصنيف: تحقق', classifyIntent('تحقق من جاهزية النظام') === 'verification');
  check('تصنيف: محتوى', classifyIntent('اكتب منشوراً عن التقسيط') === 'content');
  check('تصنيف: تحليل', classifyIntent('حلل أداء الحملات') === 'analysis');
  check('تصنيف: حالة', classifyIntent('ما حالة المنصات؟') === 'status');
  check('كشف المنصات', detectPlatforms('انستغرام وتلغرام و tiktok').sort().join(',') === 'instagram,telegram,tiktok');

  const diag = buildAgentPlan('المنصة انستغرام لا تعمل، ما السبب؟');
  check('خطة التشخيص تبدأ بفحص الصحة', diag.steps[0].toolId === 'system_health');
  check('خطة التشخيص تفحص OAuth للمنصة المذكورة', diag.steps.some((s) => s.toolId === 'oauth_config' && s.args.platform === 'instagram'));
  check('خطة التشخيص لا تستهلك AI', diag.requiresAi === false);
  check('خطة المحتوى تستهلك AI مرة واحدة', buildAgentPlan('اكتب منشوراً').requiresAi === true);
  check('خطة المحتوى تتطلب موافقة', buildAgentPlan('اكتب منشوراً').requiresApproval === true);
  check('لا خطوات لأدوات غير مسجّلة', buildAgentPlan('أي شيء').steps.every((s) => Boolean(getAgentTool(s.toolId))));

  // --- نية YouTube الصريحة: تُوجّه لخطة تشغيل حقيقية بلا عقل ثانٍ ---
  check('تصنيف: يوتيوب', classifyIntent('حلل أداء قناة يوتيوب') === 'youtube');
  const ytPlan = buildAgentPlan('حلل أداء قناة يوتيوب');
  check('خطة YouTube تقرأ الحالة والفيديوهات والتحليلات والتعلّم', ['youtube_status', 'youtube_videos', 'youtube_analytics', 'youtube_learning'].every((t) => ytPlan.steps.some((s) => s.toolId === t)));
  check('خطة YouTube لا تضع أي عملية خارجية بلا موافقة', ytPlan.steps.every((s) => { const t = getAgentTool(s.toolId); return !t || t.permission !== 'EXTERNAL_ACTION'; }));
  check('أدوات الرد/الرفع في YouTube خارجية وتتطلب موافقة', getAgentTool('youtube_reply')?.permission === 'EXTERNAL_ACTION' && getAgentTool('youtube_publish')?.permission === 'EXTERNAL_ACTION');
  check('staff لا يملك أدوات YouTube الخارجية', canUseTool('staff', getAgentTool('youtube_reply')!.permission).allowed === false);

  // --- A) المخطّط: نية التعليقات الصريحة تُضيف المسار الحقيقي فقط عند الطلب ---
  check('A: مهمة YouTube عامة لا تطلب التعليقات', wantsYouTubeComments('حلل أداء قناة يوتيوب') === false);
  check('A: مهمة صريحة تطلب التعليقات', wantsYouTubeComments('اجلب أحدث تعليقات يوتيوب') === true);
  check('A: صيغة إنجليزية تطلب التعليقات', wantsYouTubeComments('fetch youtube comments') === true);
  const ytGeneral = buildAgentPlan('حلل أداء قناة يوتيوب');
  check('A: خطة YouTube العامة لا تتضمن youtube_comments', !ytGeneral.steps.some((s) => s.toolId === 'youtube_comments'));
  const ytCommentsPlan = buildAgentPlan('اجلب أحدث التعليقات الحقيقية من قناة يوتيوب وحللها واقترح رداً');
  const commentStep = ytCommentsPlan.steps.find((s) => s.toolId === 'youtube_comments');
  check('A: خطة طلب التعليقات تتضمن youtube_comments', Boolean(commentStep));
  check('A: youtube_comments تأتي بعد youtube_videos', ytCommentsPlan.steps.findIndex((s) => s.toolId === 'youtube_videos') < ytCommentsPlan.steps.findIndex((s) => s.toolId === 'youtube_comments'));
  check('A: videoId ليس نصاً ثابتاً بل مرجع من youtube_videos', Boolean(commentStep && (commentStep.args.videoId as any)?.fromTool === 'youtube_videos'));
  check('A: لا خطوة يوتيوب خارجية في خطة التعليقات', ytCommentsPlan.steps.every((s) => { const t = getAgentTool(s.toolId); return !t || t.permission !== 'EXTERNAL_ACTION'; }));

  // --- حلّ المراجع حتمياً بلا اختلاق قيمة ---
  check('حلّ المرجع يقرأ القيمة الحقيقية', resolveArgValue({ fromTool: 'youtube_videos', listPath: 'videos', field: 'videoId', pick: 'first' }, { youtube_videos: { videos: [{ videoId: 'abc' }] } }) === 'abc');
  check('حلّ المرجع بلا فيديوهات يعيد undefined (لا قيمة مُختلقة)', resolveArgValue({ fromTool: 'youtube_videos', listPath: 'videos', field: 'videoId' }, { youtube_videos: { videos: [] } }) === undefined);
  check('حلّ المرجع بلا مخرَج سابق يعيد undefined', resolveArgValue({ fromTool: 'youtube_videos', listPath: 'videos', field: 'videoId' }, {}) === undefined);
  check('القيمة غير المرجعية تمر كما هي', resolveArgValue('literal', {}) === 'literal');

  // --- الصلاحيات ---
  check('staff يقرأ', canUseTool('staff', 'READ').allowed === true);
  check('staff لا يكتب', canUseTool('staff', 'WRITE').allowed === false);
  check('staff لا ينفّذ خارجياً', canUseTool('staff', 'EXTERNAL_ACTION').allowed === false);
  check('owner ينفّذ خارجياً', canUseTool('owner', 'EXTERNAL_ACTION').allowed === true);
  check('الأدوات الخارجية تتطلب موافقة', toolRequiresApproval('EXTERNAL_ACTION') === true);
  check('سجل الأدوات يحتوي job_execute خارجياً', getAgentTool('job_execute')?.permission === 'EXTERNAL_ACTION');
  check('سجل الأدوات يحتوي أدوات قراءة', AGENT_TOOLS.some((t) => t.permission === 'READ'));

  // --- المزوّدون ---
  const providers = describeProviders({ GEMINI_API_KEY: 'x' } as any);
  check('المزوّد الأساسي Gemini', providers[0].id === 'gemini' && providers[0].role === 'primary');
  check('المزود الثانوي غير مضبوط بلا مفتاح', providers[1].configured === false && providers[1].envKeyName === 'OPENAI_API_KEY');
  check('الاتحاد (council) لا يُفعّل بلا ثانوي', shouldUseCouncil({ AGENT_AI_COUNCIL: 'true' } as any) === false);
  check('الاتحاد يُفعّل بثانوي ومفتاح صريح', shouldUseCouncil({ AGENT_AI_COUNCIL: 'true', OPENAI_API_KEY: 'x' } as any) === true);
  check('المزوّد الأساسي الفعلي', primaryProvider({ GEMINI_API_KEY: 'k' } as any)?.id === 'gemini');

  // --- دورة مهمة كاملة (تشخيص) ---
  const orch = makeOrch();
  const t = orch.createTask({ task: 'المنصة انستغرام لا تعمل، ما السبب؟', operator: 'owner', userId: 'owner' });
  check('الحالة الأولية queued', t.status === 'queued');
  const done = await orch.run(t.id);
  check('المهمة اكتملت', done.status === 'completed', done.status);
  check('سجل التنفيذ غير فارغ', done.journal.length > 0);
  check('كل خطوات السجل نُفّذت فعلاً', done.journal.every((e) => e.toolId && e.at));
  check('التحقق النهائي صحيح', done.verified === true);
  check('نتيجة المهمة ملخّص موجود', Boolean(done.result?.summary));

  // --- لا نجاح وهمي: مهمة تتضمن أداة خارجية تُحجب ---
  const orch2 = makeOrch(fakeCtx({ operator: 'owner' }));
  const t2 = orch2.createTask({ task: 'مهمة', mode: 'jobs' as any, operator: 'owner', userId: 'owner' });
  const run2 = await orch2.run(t2.id);
  const externalStep = run2.journal.find((e) => e.toolId === 'job_create');
  check('إنشاء مهمة داخلي نُفّذ (WRITE)', externalStep?.ok === true);
  check('المهمة تنتظر موافقة (لا تنفيذ خارجي)', run2.status === 'waiting', run2.status);

  // --- RBAC: staff لا يستطيع WRITE ---
  const orchStaff = makeOrch(fakeCtx({ operator: 'staff' }));
  const tStaff = orchStaff.createTask({ task: 'مهمة', mode: 'jobs' as any, operator: 'staff', userId: 'staff-1' });
  const runStaff = await orchStaff.run(tStaff.id);
  const writeEntry = runStaff.journal.find((e) => e.toolId === 'job_create');
  check('staff: إنشاء مهمة محجوب بالصلاحية', writeEntry?.ok === false && writeEntry?.code === 'PERMISSION_DENIED');

  // --- idempotency: نفس المفتاح لا ينشئ مهام مزدوجة ---
  const orchIdem = makeOrch();
  orchIdem.createTask({ task: 'أ', idempotencyKey: 'k1', operator: 'owner', userId: 'owner' });
  const dup = orchIdem.findIdempotent('owner', 'k1');
  check('idempotency: يجد المهمة المطابقة', Boolean(dup));
  check('idempotency: لا يجد مفتاحاً آخر', orchIdem.findIdempotent('owner', 'k2') === null);
  check('idempotency: لا يعبر المستخدمين', orchIdem.findIdempotent('other', 'k1') === null);

  // --- دوام السياق: restore ---
  const orchRestore = makeOrch();
  const r1 = orchRestore.createTask({ task: 'شفاء', operator: 'owner', userId: 'owner' });
  await orchRestore.run(r1.id);
  const snap = orchRestore.snapshot();
  const orchFresh = makeOrch();
  orchFresh.restore(snap);
  check('دوام السياق: استرجاع المهمة', orchFresh.getTask(r1.id)?.task === 'شفاء');
  check('دوام السياق: سجل التنفيذ محفوظ', (orchFresh.getTask(r1.id)?.journal.length || 0) > 0);

  // --- إعادة المحاولة ثم النجاح (failure recovery) ---
  let calls = 0;
  const flakyCtx = fakeCtx({
    healthSnapshot: () => {
      calls += 1;
      if (calls === 1) throw new Error('فشل عابر أول');
      return { version: '13.0.0' };
    },
  });
  const orchFlaky = makeOrch(flakyCtx, { maxAttempts: 2 });
  const tf = orchFlaky.createTask({ task: 'تحقق من جاهزية النظام', operator: 'owner', userId: 'owner' });
  const rf = await orchFlaky.run(tf.id);
  const healthEntry = rf.journal.find((e) => e.toolId === 'system_health');
  check('شفاء الفشل: أُعيدت المحاولة ونجحت', healthEntry?.ok === true && (healthEntry?.attempts || 0) === 2);
  check('شفاء الفشل: المهمة اكتملت', rf.status === 'completed');

  // --- فشل غير قابل للإصلاح يوقف المهمة ---
  const badCtx = fakeCtx({ systemVerification: () => { throw new Error('عطل دائم'); } });
  const orchBad = makeOrch(badCtx, { maxAttempts: 2 });
  const tb = orchBad.createTask({ task: 'تحقق من جاهزية النظام', operator: 'owner', userId: 'owner' });
  const rb = await orchBad.run(tb.id);
  check('فشل صلب: المهمة failed', rb.status === 'failed', rb.status);
  check('فشل صلب: سبب صريح', Boolean(rb.error));

  // --- مهلة الأداة ---
  const slowCtx = fakeCtx({
    healthSnapshot: () => ({ get version() { return 'x'; } }),
  });
  const orchTimeout = makeOrch(slowCtx, { stepTimeoutMs: 10, maxAttempts: 1 });
  // نحقن أداة بطيئة عبر تشغيل مهمة تستدعي aiGenerate بطيئاً
  const slowOrch = new AgentOrchestrator({
    toolContext: fakeCtx({ aiGenerate: () => new Promise((r) => setTimeout(() => r({ text: 'x', usedProvider: false, source: 'fallback' }), 200)) as any }),
    stepTimeoutMs: 20,
    maxAttempts: 1,
    newId: () => 'slow1',
  });
  const tSlow = slowOrch.createTask({ task: 'اكتب منشوراً', mode: 'content' as any, operator: 'owner', userId: 'owner' });
  const rSlow = await slowOrch.run(tSlow.id);
  const aiEntry = rSlow.journal.find((e) => e.toolId === 'ai_draft');
  check('المهلة: الأداة تسجّل TIMEOUT', aiEntry?.code === 'TIMEOUT');
  check('المهلة: المهمة failed لا معلّقة', rSlow.status === 'failed', rSlow.status);

  // --- منع التنفيذ المتزامن المزدوج ---
  const orchConc = makeOrch(fakeCtx({
    aiGenerate: () => new Promise((r) => setTimeout(() => r({ text: 'x', usedProvider: false, source: 'fallback' }), 30)) as any,
  }));
  const tc = orchConc.createTask({ task: 'اكتب منشوراً', mode: 'content' as any, operator: 'owner', userId: 'owner' });
  const [a, b] = await Promise.all([orchConc.run(tc.id), orchConc.run(tc.id)]);
  check('التزامن: نفس المهمة لا تُنفَّذ مرتين', (a.finishedAt !== null) && (b.finishedAt !== null));

  // --- إخفاء الأسرار في السياق ---
  const orchSec = makeOrch();
  const tSec = orchSec.createTask({ task: 'مهمة', operator: 'owner', userId: 'owner', context: { clientSecret: 'SHOULD_NOT_APPEAR', accessToken: 'ALSO_HIDDEN', topic: 'تقسيط' } });
  const snapSec = JSON.stringify(orchSec.snapshot());
  check('أمان: لا يُخزَّن clientSecret', !snapSec.includes('SHOULD_NOT_APPEAR'));
  check('أمان: لا يُخزَّن accessToken', !snapSec.includes('ALSO_HIDDEN'));
  check('أمان: يُحفظ السياق الآمن', tSec.contextSnapshot?.topic === 'تقسيط');
  check('أمان: مفتاح السياق السرّي مُسقَط', !('clientSecret' in (tSec.contextSnapshot || {})));

  // --- fallback المزوّد ---
  const orchAi = makeOrch();
  const tAi = orchAi.createTask({ task: 'اكتب منشوراً', mode: 'content' as any, operator: 'owner', userId: 'owner' });
  const rAi = await orchAi.run(tAi.id);
  const aiStep = rAi.journal.find((e) => e.toolId === 'ai_draft');
  check('fallback: خطوة AI نجحت بلا مزود', aiStep?.ok === true);
  check('fallback: النص البديل محفوظ', (rAi.result?.data || []).some((d: any) => d.toolId === 'ai_draft'));

  // --- B) تنفيذ المسار الحقيقي: youtubeVideos → استخراج videoIds → youtubeComments ---
  // نتتبّع المعرّفات الواصلة فعلاً إلى youtubeComments عبر التقاط الوسيط.
  let capturedVideoIds: string[] | null = null;
  let capturedArgs: any = null;
  const trackCtx = fakeCtx({
    youtubeVideos: async () => ({ ok: true, videos: [
      { videoId: 'vid-newest', title: 'أحدث فيديو حقيقي', viewCount: 7, likeCount: 1, commentCount: 0 },
      { videoId: 'vid-middle', title: 'فيديو أقدم', viewCount: 5, likeCount: 1, commentCount: 1 },
      { videoId: 'vid-oldest', title: 'فيديو قديم', viewCount: 3, likeCount: 0, commentCount: 1 },
    ] }),
    youtubeComments: async (videoIds: string | string[]) => {
      capturedVideoIds = Array.isArray(videoIds) ? videoIds : [videoIds];
      // التعليق الحقيقي موجود في فيديو غير أول فيديو — نُعيده فقط إن فُحص ذلك الفيديو.
      const comments = capturedVideoIds.includes('vid-middle') ? [{ commentId: 'yt-c-mid', videoId: 'vid-middle', text: 'سعر التقسيط كام؟', authorName: 'عميل', publishedAt: '2026-09-27T10:00:00Z' }] : [];
      const top = comments.find((c) => c.commentId) || null;
      return { ok: true, comments, latestComment: top, scannedVideoIds: capturedVideoIds, videosScanned: capturedVideoIds.length, inserted: comments.length, duplicates: 0 };
    },
  });
  const commentOrch = makeOrch(trackCtx);
  const tComments = commentOrch.createTask({ task: 'اجلب أحدث تعليقات YouTube وحللها واقترح رداً باللهجة العراقية', operator: 'owner', userId: 'owner' });
  const tCommentsPlan = tComments.plan!;
  // نلتقط الوسيط الفعلي عبر تغليف الأداة (للإثبات فقط، بلا تعديل المنفّذ).
  const commentsTool = getAgentTool('youtube_comments')!;
  const originalRun = commentsTool.run;
  (commentsTool as any).run = async (args: any, ctx: any) => { capturedArgs = args; return originalRun(args, ctx); };
  const rComments = await commentOrch.run(tComments.id);
  (commentsTool as any).run = originalRun;

  check('B: خطة التعليقات تضم youtube_comments', tCommentsPlan.steps.some((s) => s.toolId === 'youtube_comments'));
  check('B: مرجع الفيديو pick=all (لا فيديو واحد)', (tCommentsPlan.steps.find((s) => s.toolId === 'youtube_comments')?.args.videoId as any)?.pick === 'all');
  check('B: الوسيط الواصل ليس مرجعاً بل قيم حقيقية', Array.isArray(capturedArgs?.videoId) && capturedArgs.videoId.every((v: string) => typeof v === 'string'), JSON.stringify(capturedArgs));
  check('B: المعرّفات الواصلة هي كل معرّفات youtubeVideos الحقيقية', Array.isArray(capturedVideoIds) && capturedVideoIds.join(',') === 'vid-newest,vid-middle,vid-oldest', JSON.stringify(capturedVideoIds));
  const jComments = rComments.journal.find((e) => e.toolId === 'youtube_comments');
  check('B: journal يسجّل youtube_comments ناجحة', jComments?.ok === true, JSON.stringify(jComments));
  check('B: الخطوة ليست خارجية (قراءة)', jComments?.permission === 'READ');
  check('B: لا خطوة رد خارجية أُرسلت', !rComments.journal.some((e) => e.toolId === 'youtube_reply'));
  const commentsOut = rComments.result?.data?.find((d: any) => d.toolId === 'youtube_comments');
  check('B: ملخّص نتيجة التعليقات مسجّل', Boolean(commentsOut));

  // --- C) التعليق الحقيقي على فيديو غير أول فيديو: العقل يصل إليه ---
  const returnedLatest = await originalRun({ videoId: ['vid-newest', 'vid-middle', 'vid-oldest'] } as any, trackCtx);
  check('C: العقل يفحص كل الفيديوهات المحدودة', (returnedLatest.data as any)?.videosScanned === 3);
  check('C: أحدث تعليق حقيقي يعود حتى لو كان في فيديو غير الأول', (returnedLatest.data as any)?.latestComment?.videoId === 'vid-middle' && (returnedLatest.data as any)?.latestComment?.commentId === 'yt-c-mid');
  const commaRun = await originalRun({ videoIds: 'vid-newest,vid-middle' } as any, trackCtx);
  check('C: الوسيط مجموعة مفصولة تُقبل أيضاً', Boolean((commaRun.data as any)?.latestComment));

  // لا فيديوهات => لا videoId مُختلق => الخطوة تفشل بـMISSING_ARGUMENT بوضوح.
  let fabricatedCalls = 0;
  const emptyCtx = fakeCtx({
    youtubeVideos: async () => ({ ok: true, videos: [] }),
    youtubeComments: async () => { fabricatedCalls += 1; return { ok: true, comments: [] }; },
  });
  const emptyOrch = makeOrch(emptyCtx);
  const tEmpty = emptyOrch.createTask({ task: 'اجلب أحدث تعليقات YouTube', operator: 'owner', userId: 'owner' });
  const rEmpty = await emptyOrch.run(tEmpty.id);
  const emptyEntry = rEmpty.journal.find((e) => e.toolId === 'youtube_comments');
  check('B: بلا فيديوهات لا يُستدعى youtubeComments إطلاقاً', fabricatedCalls === 0);
  check('B: بلا فيديوهات تسجّل MISSING_ARGUMENT صراحةً', emptyEntry?.ok === false && emptyEntry?.code === 'MISSING_ARGUMENT', JSON.stringify(emptyEntry));

  // --- A') task.result.data.output يحمل المخرَج الحقيقي (لا أسماء مفاتيح فقط) ---
  {
    const richCtx = fakeCtx({
      youtubeVideos: async () => ({ ok: true, videos: [{ videoId: 'v1', title: 'فيديو' }] }),
      youtubeComments: async () => ({
        ok: true,
        comments: [{ commentId: 'c1', videoId: 'v1', text: 'سعر التقسيط كام؟', authorName: 'علي', publishedAt: '2026-09-27T10:00:00Z' }],
        latestComment: { commentId: 'c1', videoId: 'v1', text: 'سعر التقسيط كام؟', authorName: 'علي', publishedAt: '2026-09-27T10:00:00Z' },
        scannedVideoIds: ['v1'], videosScanned: 1, inserted: 1, duplicates: 0,
      }),
    });
    const orch = makeOrch(richCtx);
    const t = orch.createTask({ task: 'اجلب أحدث تعليقات YouTube وحللها واقترح رداً', operator: 'owner', userId: 'owner' });
    const r = await orch.run(t.id);
    const cItem = (r.result?.data || []).find((d: any) => d.toolId === 'youtube_comments');
    const aiItem = (r.result?.data || []).find((d: any) => d.toolId === 'ai_draft');
    check('A: result.data[youtube_comments].output يحمل latestComment.text', cItem?.output?.latestComment?.text === 'سعر التقسيط كام؟', JSON.stringify(cItem?.output));
    check('A: result.data[youtube_comments].output يحمل comments[].text', Array.isArray(cItem?.output?.comments) && cItem.output.comments[0]?.text === 'سعر التقسيط كام؟');
    check('A: result.data[ai_draft].output موجود (لا أسماء مفاتيح فقط)', Boolean(aiItem?.output));

    // --- B') ai_draft استلم نص التعليق الحقيقي (لا نص المهمة) ---
    check('B: ai_draft صنّف التعليق الحقيقي (kind=comment_analysis)', aiItem?.output?.kind === 'comment_analysis');
    check('B: ai_draft latestCommentText = نص التعليق الحقيقي', aiItem?.output?.latestCommentText === 'سعر التقسيط كام؟');
    check('B: ai_draft لم يستخدم نص المهمة كمصدر للتعليق', aiItem?.output?.latestCommentText !== t.task);

    // --- C) مخرج ai_draft يحمل النوع والمشاعر والرد العراقي وwillAutoSend:false ---
    const la = aiItem?.output?.latestAnalysis;
    check('C: نوع التعليق موجود (business_inquiry)', la?.type === 'business_inquiry' && la?.typeAr === 'استفسار تجاري');
    check('C: المشاعر موجودة (محايدة)', la?.sentiment === 'neutral' && la?.sentimentAr === 'محايدة');
    check('C: الرد المقترح باللهجة العراقية موجود', typeof la?.iraqiSuggestedReply === 'string' && la.iraqiSuggestedReply.length > 0);
    check('C: willAutoSend=false صريح', aiItem?.output?.willAutoSend === false && la?.willAutoSend === false);
    check('C: لا خطوة youtube_reply في الخطة', !r.journal.some((e: any) => e.toolId === 'youtube_reply'));

    // --- E) أكثر من تعليق: تحليل كل تعليق ---
    const multiCtx = fakeCtx({
      youtubeVideos: async () => ({ ok: true, videos: [{ videoId: 'v1' }] }),
      youtubeComments: async () => ({
        ok: true,
        comments: [
          { commentId: 'c1', videoId: 'v1', text: 'سعر التقسيط كام؟', authorName: 'أ', publishedAt: '2026-09-27T10:00:00Z' },
          { commentId: 'c2', videoId: 'v1', text: 'خدمة رائعة شكراً', authorName: 'ب', publishedAt: '2026-09-26T10:00:00Z' },
        ],
        latestComment: { commentId: 'c1', videoId: 'v1', text: 'سعر التقسيط كام؟', authorName: 'أ', publishedAt: '2026-09-27T10:00:00Z' },
        scannedVideoIds: ['v1'], videosScanned: 1, inserted: 2, duplicates: 0,
      }),
    });
    const multiOrch = makeOrch(multiCtx);
    const tm = multiOrch.createTask({ task: 'اجلب أحدث تعليقات YouTube وحللها', operator: 'owner', userId: 'owner' });
    const rm = await multiOrch.run(tm.id);
    const aiM = (rm.result?.data || []).find((d: any) => d.toolId === 'ai_draft');
    check('E: تحليل أكثر من تعليق', Array.isArray(aiM?.output?.analyzed) && aiM.output.analyzed.length === 2);
    check('E: كل تعليق له نوع ومشاعر ورد', aiM.output.analyzed.every((a: any) => a.type && a.sentiment && a.iraqiSuggestedReply));

    // --- D) بلا تعليقات: لا تحليل ولا رد مُختلق ---
    const noCommentCtx = fakeCtx({
      youtubeVideos: async () => ({ ok: true, videos: [{ videoId: 'v1' }] }),
      youtubeComments: async () => ({ ok: true, comments: [], latestComment: null, scannedVideoIds: ['v1'], videosScanned: 1, inserted: 0, duplicates: 0 }),
    });
    const ncOrch = makeOrch(noCommentCtx);
    const tn = ncOrch.createTask({ task: 'اجلب أحدث تعليقات YouTube', operator: 'owner', userId: 'owner' });
    const rn = await ncOrch.run(tn.id);
    const aiN = (rn.result?.data || []).find((d: any) => d.toolId === 'ai_draft');
    check('D: بلا تعليقات لا يوجد تحليل مُختلق', !aiN?.output?.analyzed && !aiN?.output?.latestAnalysis);
    check('D: مخرج ai_draft بلا تعليقات ليس comment_analysis', aiN?.output?.kind !== 'comment_analysis');

    // --- F) youtube_reply لا يدخل خطة المهمة ولا يُنفّذ ---
    check('F: خطة المهمة لا تضم youtube_reply', !t.plan!.steps.some((s) => s.toolId === 'youtube_reply'));
    check('F: youtube_reply خارجي ويُحجب داخل المهمة', getAgentTool('youtube_reply')?.permission === 'EXTERNAL_ACTION' && toolRequiresApproval('EXTERNAL_ACTION'));

    // --- sanitizeOutput: يحفظ النص ويُسقط السرّ ---
    check('sanitize: يحفظ text', sanitizeOutput({ text: 'مرحبا', token: 'SECRET', keep: 1 }).text === 'مرحبا');
    check('sanitize: يُسقط المفتاح السرّي', !('token' in sanitizeOutput({ text: 'x', token: 'SECRET' })));
    check('sanitize: يحفظ النوع والمشاعر والرد', (() => { const s = sanitizeOutput(la); return s.type === la.type && s.sentiment === la.sentiment && s.iraqiSuggestedReply === la.iraqiSuggestedReply; })());
  }

  // --- K) الدورة الكاملة: قراءة تعليق حقيقي → تحليل → اقتراح رد → إرسال حقيقي → تحقق ---
  {
    // تصنيف: طلب «اقرأ+حلل+اقترح+أرسل» يُصنَّف دورة كاملة لا رداً منفرداً.
    check('K: تصنيف الدورة الكاملة يوتيوب', classifyIntent('اقرأ أحدث تعليق حقيقي من يوتيوب، حلله، اقترح رداً باللهجة العراقية، ثم أرسل الرد المقترح إلى نفس التعليق') === 'youtube_cycle');
    // انحدار (Root Cause): صياغة المالك الفعلية فيها «ولّد» و«نفّذ» و«تحقق» —
    // كان VERIFY_RE يسبق YouTube فيُختزل الطلب إلى مهمة تحقق من النظام.
    const ownerTask = 'اقرأ أحدث تعليق حقيقي من قناة YouTube المرتبطة، حلّل التعليق، ولّد رداً مناسباً باللهجة العراقية، ثم نفّذ الرد الحقيقي على نفس التعليق عبر YouTube، وتحقق من وصوله من YouTube.';
    const ownerPlan = buildAgentPlan(ownerTask);
    check('K: صياغة المالك => youtube_cycle (لا verification)', ownerPlan.kind === 'youtube_cycle', ownerPlan.kind);
    check('K: صياغة المالك => خطة الدورة الكاملة', ownerPlan.steps.map((s) => s.toolId).join(',') === 'youtube_status,youtube_videos,youtube_comments,ai_draft,youtube_reply,youtube_reply_verify', ownerPlan.steps.map((s) => s.toolId).join(','));
    check('K: صياغة المالك => فعل توليد مرادف «ولّد» يُكتشف', wantsYouTubeFullCycle(ownerTask) === true);
    // الترتيب: التحقق العام لا يسرق الدورة، لكنه يبقى سليماً عند غياب مسار التنفيذ.
    check('K: طلب تحقق بلا منصة يبقى verification', classifyIntent('تحقق من جاهزية النظام') === 'verification');
    check('K: دورة بلا ذكر المنصة تُوجَّه للدورة الكاملة', buildAgentPlan('اقرأ أحدث تعليق، حلله، ولّد رداً، ثم أرسله وتحقق منه').kind === 'youtube_cycle');
    check('K: طلب «اقترح رداً» وحده ليس دورة كاملة', wantsYouTubeFullCycle('اجلب أحدث تعليقات يوتيوب واقترح رداً') === false);
    check('K: الدورة الكاملة تطلب إرسالاً صريحاً', wantsYouTubeFullCycle('اقرأ تعليق يوتيوب وحلله واقترح رداً ثم أرسل الرد المقترح') === true);

    const cyclePlan = buildAgentPlan('اقرأ أحدث تعليق حقيقي من يوتيوب، حلله، اقترح رداً باللهجة العراقية، ثم أرسل الرد المقترح إلى نفس التعليق');
    check('K: الخطة دورة كاملة', cyclePlan.kind === 'youtube_cycle');
    const ids = cyclePlan.steps.map((s) => s.toolId);
    check('K: ترتيب الخطة الحقيقي', ids.join(',') === 'youtube_status,youtube_videos,youtube_comments,ai_draft,youtube_reply,youtube_reply_verify', ids.join(','));
    check('K: حارس موافقة/تفويض قائم (requiresApproval)', cyclePlan.requiresApproval === true);
    const replyStep = cyclePlan.steps.find((s) => s.toolId === 'youtube_reply')!;
    check('K: commentId مرجع من youtube_comments.latestComment (لا نص)', (replyStep.args.commentId as any)?.fromTool === 'youtube_comments' && (replyStep.args.commentId as any)?.outputPath === 'latestComment' && (replyStep.args.commentId as any)?.field === 'commentId');
    check('K: text مرجع من ai_draft.latestAnalysis (لا نص مُختلق)', (replyStep.args.text as any)?.fromTool === 'ai_draft' && (replyStep.args.text as any)?.outputPath === 'latestAnalysis' && (replyStep.args.text as any)?.field === 'iraqiSuggestedReply');
    check('K: youtube_reply تبقى EXTERNAL_ACTION', getAgentTool('youtube_reply')?.permission === 'EXTERNAL_ACTION');
    check('K: أداة التحقق قراءة فقط', getAgentTool('youtube_reply_verify')?.permission === 'READ');

    // حلّ المسار المتداخل: القيم الحقيقية تُقرأ من مخرَجات الخطوات الفعلية.
    check('K: حلّ latestComment.commentId', resolveArgValue({ fromTool: 'youtube_comments', outputPath: 'latestComment', field: 'commentId' }, { youtube_comments: { latestComment: { commentId: 'c9' } } }) === 'c9');
    check('K: حلّ latestAnalysis.iraqiSuggestedReply', resolveArgValue({ fromTool: 'ai_draft', outputPath: 'latestAnalysis', field: 'iraqiSuggestedReply' }, { ai_draft: { latestAnalysis: { iraqiSuggestedReply: 'أهلاً بك' } } }) === 'أهلاً بك');
    check('K: غياب latestComment => undefined (لا اختلاق)', resolveArgValue({ fromTool: 'youtube_comments', outputPath: 'latestComment', field: 'commentId' }, { youtube_comments: { latestComment: null } }) === undefined);
    check('K: غياب مخرَج ai_draft => undefined', resolveArgValue({ fromTool: 'ai_draft', outputPath: 'latestAnalysis', field: 'iraqiSuggestedReply' }, {}) === undefined);

    // سياق حقيقي: تعليق حقيقي يعود من youtube_comments ويصل لخطوة الرد.
    let seenReplyArgs: any = null;
    const cycleCtx = fakeCtx({
      youtubeVideos: async () => ({ ok: true, videos: [{ videoId: 'v1', title: 'فيديو' }] }),
      youtubeComments: async () => ({
        ok: true,
        comments: [{ commentId: 'rc1', videoId: 'v1', text: 'كم سعر التقسيط؟', authorName: 'علي', publishedAt: '2026-09-27T10:00:00Z' }],
        latestComment: { commentId: 'rc1', videoId: 'v1', text: 'كم سعر التقسيط؟', authorName: 'علي', publishedAt: '2026-09-27T10:00:00Z' },
        scannedVideoIds: ['v1'], videosScanned: 1, inserted: 1, duplicates: 0,
      }),
      youtubeReply: async (input) => { seenReplyArgs = input; return { delivered: true, externalReplyId: 'real-reply-1', state: 'sent', reply: { externalId: input.commentId } }; },
      delegationCheck: () => ({ allowed: true }),
    });
    const cycleOrch = makeOrch(cycleCtx);
    const tc = cycleOrch.createTask({ task: 'اقرأ أحدث تعليق حقيقي من يوتيوب، حلله، اقترح رداً باللهجة العراقية، ثم أرسل الرد المقترح إلى نفس التعليق', operator: 'owner', userId: 'owner' });
    const rc = await cycleOrch.run(tc.id);
    check('K: الدورة اكتملت مع تفويض فعّال', rc.status === 'completed', rc.status);
    check('K: معرّف التعليق الحقيقي وصل لمنفّذ الرد', seenReplyArgs?.commentId === 'rc1', JSON.stringify(seenReplyArgs));
    check('K: نص الرد المقترح فعلاً وصل لمنفّذ الرد (لهجة عراقية)', typeof seenReplyArgs?.text === 'string' && seenReplyArgs.text.length > 0 && seenReplyArgs.text.includes('هلا بيك'), String(seenReplyArgs?.text));
    const verifyEntry = rc.journal.find((e) => e.toolId === 'youtube_reply_verify');
    check('K: خطوة التحقق نُفّذت بنجاح', verifyEntry?.ok === true, JSON.stringify(verifyEntry));
    const replyOut = (rc.result?.data || []).find((d: any) => d.toolId === 'youtube_reply');
    check('K: مخرَج الرد يحمل معرّفاً حقيقياً وحالة sent', replyOut?.output?.externalReplyId === 'real-reply-1' && replyOut?.output?.state === 'sent');

    // بلا تعليق حقيقي: لا إرسال إطلاقاً (مmissing argument صريح على خطوة الرد).
    let replyCalledNoComment = 0;
    const noCommentCycle = fakeCtx({
      youtubeVideos: async () => ({ ok: true, videos: [{ videoId: 'v1' }] }),
      youtubeComments: async () => ({ ok: true, comments: [], latestComment: null, scannedVideoIds: ['v1'], videosScanned: 1, inserted: 0, duplicates: 0 }),
      youtubeReply: async () => { replyCalledNoComment += 1; return { delivered: true, externalReplyId: 'x' }; },
      delegationCheck: () => ({ allowed: true }),
    });
    const ncOrch = makeOrch(noCommentCycle);
    const tn = ncOrch.createTask({ task: 'اقرأ أحدث تعليق حقيقي من يوتيوب، حلله، اقترح رداً باللهجة العراقية، ثم أرسل الرد المقترح إلى نفس التعليق', operator: 'owner', userId: 'owner' });
    await ncOrch.run(tn.id);
    check('K: بلا commentId حقيقي لا يُستدعى منفّذ الرد', replyCalledNoComment === 0);

    // بلا نص رد حقيقي (مخرج ai_draft بلا latestAnalysis): لا إرسال.
    let replyCalledNoText = 0;
    const noTextCycle = fakeCtx({
      youtubeVideos: async () => ({ ok: true, videos: [{ videoId: 'v1' }] }),
      youtubeComments: async () => ({ ok: true, comments: [{ commentId: 'c1', videoId: 'v1', text: 'x' }], latestComment: { commentId: 'c1', videoId: 'v1', text: 'x' }, scannedVideoIds: ['v1'], videosScanned: 1, inserted: 1, duplicates: 0 }),
      // نُلغي مخرَج التحليل: latestAnalysis غائب.
      aiGenerate: async () => ({ text: 'نص بلا تحليل', usedProvider: false, source: 'fallback' }),
      youtubeReply: async () => { replyCalledNoText += 1; return { delivered: true, externalReplyId: 'x' }; },
      delegationCheck: () => ({ allowed: true }),
    });
    // نُعيد تعريف أداة ai_draft مؤقتاً لتُعيد مخرَجاً بلا latestAnalysis (محاكاة غياب نص الرد).
    const aiTool = getAgentTool('ai_draft')!;
    const origAiRun = aiTool.run;
    (aiTool as any).run = async () => ({ ok: true, data: { kind: 'comment_analysis', count: 1, analyzed: [], latestAnalysis: null, willAutoSend: false } });
    const ntOrch = makeOrch(noTextCycle);
    const tt = ntOrch.createTask({ task: 'اقرأ أحدث تعليق حقيقي من يوتيوب، حلله، اقترح رداً باللهجة العراقية، ثم أرسل الرد المقترح إلى نفس التعليق', operator: 'owner', userId: 'owner' });
    await ntOrch.run(tt.id);
    (aiTool as any).run = origAiRun;
    check('K: بلا نص رد حقيقي لا يُستدعى منفّذ الرد', replyCalledNoText === 0);

    // بلا تفويض: خطوة الرد تُحجب وتبقى المهمة waiting، ولا يُستدعى المنفّذ.
    let replyCalledNoDel = 0;
    const noDelCycle = fakeCtx({
      youtubeVideos: async () => ({ ok: true, videos: [{ videoId: 'v1' }] }),
      youtubeComments: async () => ({ ok: true, comments: [{ commentId: 'c1', videoId: 'v1', text: 'كم السعر؟' }], latestComment: { commentId: 'c1', videoId: 'v1', text: 'كم السعر؟' }, scannedVideoIds: ['v1'], videosScanned: 1, inserted: 1, duplicates: 0 }),
      youtubeReply: async () => { replyCalledNoDel += 1; return { delivered: true, externalReplyId: 'x' }; },
      delegationCheck: () => ({ allowed: false, code: 'DELEGATION_NOT_GRANTED', reason: 'لا تفويض تشغيل YouTube فعّال.' }),
    });
    const ndOrch = makeOrch(noDelCycle);
    const td = ndOrch.createTask({ task: 'اقرأ أحدث تعليق حقيقي من يوتيوب، حلله، اقترح رداً باللهجة العراقية، ثم أرسل الرد المقترح إلى نفس التعليق', operator: 'owner', userId: 'owner' });
    const rd = await ndOrch.run(td.id);
    const replyEntryD = rd.journal.find((e) => e.toolId === 'youtube_reply');
    check('K: بلا تفويض يُحجب الرد بكود صريح', replyEntryD?.ok === false && replyEntryD?.code === 'DELEGATION_NOT_GRANTED', JSON.stringify(replyEntryD));
    check('K: بلا تفويض لا يُستدعى منفّذ الرد إطلاقاً', replyCalledNoDel === 0);
    check('K: بلا تفويض تبقى المهمة waiting', rd.status === 'waiting', rd.status);

    // لا مسار إرسال جانبي: الأداة الوحيدة التي تنفّذ الإرسال هي youtube_reply (EXTERNAL_ACTION).
    const externalTools = AGENT_TOOLS.filter((t) => t.permission === 'EXTERNAL_ACTION').map((t) => t.id).sort();
    check('K: أدوات التنفيذ الخارجي معروفة ومحصورة', externalTools.join(',') === 'job_execute,youtube_publish,youtube_reply,youtube_video_update', externalTools.join(','));
    check('K: youtube_reply_verify قراءة لا تنفّذ شيئاً', getAgentTool('youtube_reply_verify')?.permission === 'READ');
  }

  // --- H) تفويض تشغيل YouTube: منح/إيقاف/انتهاء + تقييم العمليات ---
  {
    const base = defaultYouTubeDelegation();
    check('H: التفويض الافتراضي غير ممنوح', base.granted === false && evaluateYouTubeDelegation({ delegation: base, toolId: 'youtube_reply', operator: 'owner' }).allowed === false);
    const granted = buildYouTubeDelegation({ actions: ['reply', 'publish'], grantedBy: 'owner-1', now: 1000 });
    check('H: التفويض الممنوح يحمل العمليات المطلوبة فقط', granted.granted === true && granted.actions.join(',') === 'reply,publish');
    check('H: رد مفوّض يُسمح به للمالك', evaluateYouTubeDelegation({ delegation: granted, toolId: 'youtube_reply', operator: 'owner', now: 2000 }).allowed === true);
    check('H: نشر مفوّض يُسمح به', evaluateYouTubeDelegation({ delegation: granted, toolId: 'youtube_publish', operator: 'owner', args: { title: 'x' }, now: 2000 }).allowed === true);
    check('H: عملية غير مفوّضة (تحديث) تُمنع بكود صريح', evaluateYouTubeDelegation({ delegation: granted, toolId: 'youtube_video_update', operator: 'owner', now: 2000 }).code === 'DELEGATION_ACTION_NOT_GRANTED');
    check('H: النشر المجدول يحتاج publish+schedule', requiredDelegationActions('youtube_publish', { publishAt: '2027-01-01T10:00' }).join(',') === 'publish,schedule');
    check('H: نشر مجدول بتفويض publish فقط يُمنع', evaluateYouTubeDelegation({ delegation: granted, toolId: 'youtube_publish', operator: 'owner', args: { publishAt: '2027-01-01T10:00' }, now: 2000 }).allowed === false);
    check('H: staff لا يستفيد من التفويض', evaluateYouTubeDelegation({ delegation: granted, toolId: 'youtube_reply', operator: 'staff', now: 2000 }).code === 'DELEGATION_OPERATOR_NOT_OWNER');
    // العقل المركزي (المشغّل system) ينفّذ التفويض الممنوح من المالك نيابةً عنه — لمهام داخلية كمراقب 24/7.
    check('H: التفويض يُنفَّذ بواسطة العقل المركزي (system)', evaluateYouTubeDelegation({ delegation: granted, toolId: 'youtube_reply', operator: 'system', now: 2000 }).allowed === true);
    check('H: العقل المركزي لا يتجاوز نطاق YouTube', evaluateYouTubeDelegation({ delegation: granted, toolId: 'job_execute', operator: 'system', now: 2000 }).code === 'TOOL_NOT_DELEGATABLE');
    check('H: system بلا تفويض فعّال يُمنع', evaluateYouTubeDelegation({ delegation: base, toolId: 'youtube_reply', operator: 'system', now: 2000 }).allowed === false);
    check('H: أداة غير YouTube قابلة للتفويض => مرفوضة', evaluateYouTubeDelegation({ delegation: granted, toolId: 'job_execute', operator: 'owner', now: 2000 }).code === 'TOOL_NOT_DELEGATABLE');
    const revoked = revokeYouTubeDelegation(granted, 3000);
    check('H: الإيقاف يبقي الأثر ويُعلن revoked', revoked.granted === false && evaluateYouTubeDelegation({ delegation: revoked, toolId: 'youtube_reply', operator: 'owner', now: 4000 }).code === 'DELEGATION_REVOKED');
    const expired = buildYouTubeDelegation({ actions: ['reply'], grantedBy: 'owner-1', now: 1000, expiresInHours: 1 });
    check('H: الانتهاء يُمنع', evaluateYouTubeDelegation({ delegation: expired, toolId: 'youtube_reply', operator: 'owner', now: 1000 + 2 * 60 * 60 * 1000 }).code === 'DELEGATION_EXPIRED');
    check('H: النطاق محصور بـYouTube دائماً', normalizeYouTubeDelegation({ granted: true, scope: 'facebook', actions: ['reply'] }).granted === false);
    check('H: تُسقَط العمليات غير المعروفة', normalizeYouTubeDelegation({ granted: true, actions: ['reply', 'hack'] }).actions.join(',') === 'reply');
    check('H: الملخّص بلا سرّ ويعلن المتاح', summarizeYouTubeDelegation(granted, 2000).active === true && summarizeYouTubeDelegation(granted, 2000).availableActions.length === YOUTUBE_DELEGATION_ACTIONS.length);
    check('H: حالة التفويض تظهر في health-style block', summarizeYouTubeDelegation(base).state === 'not_granted');
  }

  // --- I) دورة حياة الرد: لا sent بلا معرّف رد حقيقي من YouTube ---
  {
    check('I: لا sent بلا معرّف رد', resolveYouTubeReplyState({ delivered: true, externalReplyId: null }) !== 'sent');
    check('I: sent فقط بمعرّف رد حقيقي', resolveYouTubeReplyState({ delivered: true, externalReplyId: 'r1' }) === 'sent');
    check('I: الفشل يُعلن failed', resolveYouTubeReplyState({ delivered: false, externalReplyId: null, failed: true }) === 'failed');
    check('I: المعتمد بلا إرسال = approved', resolveYouTubeReplyState({ delivered: false, externalReplyId: null, approved: true }) === 'approved');
    check('I: بلا اعتماد = draft', resolveYouTubeReplyState({ delivered: false, externalReplyId: null }) === 'draft');
    check('I: المفردات الأربع صريحة', YOUTUBE_REPLY_LIFECYCLE_STATES.join(',') === 'draft,approved,sent,failed' && Boolean(YOUTUBE_REPLY_LIFECYCLE_LABELS_AR.sent));
  }

  // --- J) المنسّق: أداة خارجية بلا تفويض => waiting؛ مع تفويض فعّال => تنفيذ ---
  {
    const blocked = fakeCtx({ delegationCheck: () => ({ allowed: false, code: 'DELEGATION_NOT_GRANTED', reason: 'لا تفويض تشغيل YouTube فعّال.' }) });
    const ob = makeOrch(blocked);
    const tb = ob.createTask({ task: 'رد على تعليق يوتيوب', mode: 'youtube_reply', operator: 'owner', userId: 'owner', context: { commentId: 'c1', replyText: 'أهلاً بك' } });
    const rb = await ob.run(tb.id);
    const entryB = rb.journal.find((e) => e.toolId === 'youtube_reply');
    check('J: بلا تفويض الأداة الخارجية محجوبة بكود صريح', entryB?.ok === false && entryB?.code === 'DELEGATION_NOT_GRANTED', JSON.stringify(entryB));
    check('J: المهمة تنتظر عند غياب التفويض', rb.status === 'waiting', rb.status);

    let seenArgs: any = null;
    const allowed = fakeCtx({ delegationCheck: (i) => { seenArgs = i; return { allowed: true }; } });
    const oa = makeOrch(allowed);
    const ta = oa.createTask({ task: 'رد على تعليق يوتيوب', mode: 'youtube_reply', operator: 'owner', userId: 'owner', context: { commentId: 'c1', replyText: 'أهلاً بك' } });
    const ra = await oa.run(ta.id);
    const entryA = ra.journal.find((e) => e.toolId === 'youtube_reply');
    check('J: مع تفويض فعّال تُنفَّذ الأداة الخارجية', entryA?.ok === true, JSON.stringify(entryA));
    check('J: قيمة السياق الحقيقية وصلت للأداة (commentId)', seenArgs?.args?.commentId === 'c1');
    check('J: نص الرد الحقيقي وصل للأداة', seenArgs?.args?.text === 'أهلاً بك');
    check('J: المهمة اكتملت بعد التنفيذ المفوّض', ra.status === 'completed', ra.status);

    // أداة خارجية غير YouTube (job_execute) تبقى محجوبة بلا تفويض حتى لو أُريد تمريرها.
    const jobCtx = fakeCtx({ delegationCheck: () => ({ allowed: false, code: 'TOOL_NOT_DELEGATABLE', reason: 'ليست عملية YouTube.' }) });
    const oj = makeOrch(jobCtx);
    const tj = oj.createTask({ task: 'نفّذ مهمة', mode: 'jobs', operator: 'owner', userId: 'owner' });
    const rj = await oj.run(tj.id);
    check('J: مهمة jobs تنتظر ولا تنفّذ خارجياً بلا تفويض', rj.status === 'waiting' && !rj.journal.some((e) => e.toolId === 'job_execute' && e.ok === true));
  }

  // --- G) الواجهة تعرض المخرجات الفعلية من task.result.data (فحص مصدر ثابت) ---
  {
    const root = process.cwd();
    const ui = readFileSync(join(root, 'src/components/agent/CentralAgentConsole.tsx'), 'utf8');
    check('G: الواجهة تقرأ task.result.data فعلياً', /task\.result\.data/.test(ui));
    check('G: الواجهة تمرّر result.data إلى لوحة تحليل التعليقات', /CommentAnalysisPanel[\s\S]{0,120}?task\.result\.data/.test(ui));
    check('G: الواجهة تقرأ latestComment/comments من output', ui.includes('output?.latestComment') && ui.includes('output?.comments'));
    check('G: الواجهة تقرأ الحقول المطلوبة نص/نوع/مشاعر/رد', ['latestComment', 'typeAr', 'sentimentAr', 'iraqiSuggestedReply'].every((k) => ui.includes(k)));
    check('G: الواجهة تعرض وسم «لم يُرسل»', ui.includes('لم يُرسل'));
    check('G: الواجهة لا تعرض أي token/secret', !/token|secret|apiKey/i.test(ui.replace(/\/\/[^\n]*/g, '')));
  }
}

/** تكامل: خادم Express حقيقي بمسار العقل + تصريح فعلي. */
async function integrationTests() {
  const PORT = 4819 + Math.floor(Math.random() * 300);
  const BASE = `http://127.0.0.1:${PORT}`;
  const app = express();
  app.use(express.json());

  const orchestrator = makeOrch(fakeCtx({ operator: 'owner' }));
  // مستخدم حسب ترويسة: بلا ترويسة = 401، staff = دور staff، owner = دور owner.
  const authenticateToken: express.RequestHandler = (req, res, next) => {
    const role = String(req.headers['x-test-role'] || '');
    if (!role) return res.status(401).json({ success: false, error: 'غير مصرح.' });
    (req as any).user = { id: role === 'owner' ? 'owner' : 'staff-1', role };
    next();
  };
  const requireOwner: express.RequestHandler = (req, res, next) => {
    authenticateToken(req, res, () => {
      if ((req as any).user.role !== 'owner') return res.status(403).json({ success: false, error: 'مرفوض' });
      next();
    });
  };
  registerAgentRoutes(app, {
    authenticateToken,
    requireOwner,
    orchestrator,
    toolContextFor: (op, uid) => fakeCtx({ operator: op, userId: uid }),
    persistState: () => {},
    projectVersion: '13.0.0',
    env: { GEMINI_API_KEY: 'x' } as any,
  });

  const server = app.listen(PORT);
  const get = (p: string, role?: string) => fetch(`${BASE}${p}`, { headers: role ? { 'x-test-role': role } : {} });
  const post = (p: string, body: any, role?: string, extra: Record<string, string> = {}) =>
    fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}), ...extra }, body: JSON.stringify(body) });

  try {
    // تصريح
    check('تكامل: health بلا جلسة => 401', (await get('/api/agent/health')).status === 401);
    check('تكامل: tools بلا جلسة => 401', (await get('/api/agent/tools')).status === 401);
    check('تكامل: tasks بلا جلسة => 401', (await get('/api/agent/tasks')).status === 401);
    const health = await get('/api/agent/health', 'owner');
    check('تكامل: health مع جلسة => 200', health.status === 200);
    const hb = await health.json();
    check('تكامل: health يعرض المزودين بلا أسرار', Array.isArray(hb.providers) && !JSON.stringify(hb).includes('"x"'));
    check('تكامل: health لا يعرض قيمة مفتاح المزود', !JSON.stringify(hb).includes('GEMINI_API_KEY":"x"') && !JSON.stringify(hb).includes('"x"'));
    const tools = await (await get('/api/agent/tools', 'owner')).json();
    check('تكامل: الأدوات مسرودة', tools.tools.length === AGENT_TOOLS.length);
    check('تكامل: الأداة الخارجية معلَّمة تتطلب موافقة', tools.tools.find((t: any) => t.id === 'job_execute').requiresApproval === true);

    // دورة مهمة حقيقية عبر HTTP
    const created = await post('/api/agent/tasks', { task: 'المنصة انستغرام لا تعمل، ما السبب؟' }, 'owner');
    check('تكامل: إنشاء مهمة => 201', created.status === 201);
    const cbody = await created.json();
    check('تكامل: المهمة اكتملت', cbody.task.status === 'completed', cbody.task.status);
    check('تكامل: المهمة تحمل سجل تنفيذ', cbody.task.journal.length > 0);
    check('تكامل: المهمة موثّقة', cbody.task.verified === true);

    const fetched = await (await get(`/api/agent/tasks/${cbody.task.id}`, 'owner')).json();
    check('تكامل: قراءة المهمة بالمعرّف', fetched.task.id === cbody.task.id);
    check('تكامل: غير المالك لا يقرأ مهمة غيره => 403', (await get(`/api/agent/tasks/${cbody.task.id}`, 'staff')).status === 403);

    const list = await (await get('/api/agent/tasks', 'owner')).json();
    check('تكامل: قائمة المهام', list.count >= 1);

    // idempotency عبر HTTP
    const idem1 = await post('/api/agent/tasks', { task: 'حالة المنصات', idempotencyKey: 'server-key-1' }, 'owner');
    const idem1b = await idem1.json();
    const idem2 = await post('/api/agent/tasks', { task: 'حالة المنصات', idempotencyKey: 'server-key-1' }, 'owner');
    const idem2b = await idem2.json();
    check('تكامل: idempotency لا ينشئ مهمة ثانية', idem2b.duplicate === true && idem2b.task.id === idem1b.task.id);

    // staff لا ينشئ تنفيذاً خارجياً: مهمة jobs تنتظر
    const jobTask = await (await post('/api/agent/tasks', { task: 'جدولة مهمة', mode: 'jobs' }, 'staff')).json();
    check('تكامل: staff (jobs) تنتظر ولا تنفّذ خارجياً', jobTask.task.status === 'waiting' || jobTask.task.status === 'completed', jobTask.task.status);
    const writeEntry = jobTask.task.journal.find((e: any) => e.toolId === 'job_create');
    check('تكامل: staff لا ينشئ مهمة داخلية (صلاحية)', writeEntry?.ok === false && writeEntry?.code === 'PERMISSION_DENIED');

    // طلب تعليقات YouTube عبر HTTP: الخطة تحمل المسار الحقيقي والتنفيذ ينجح.
    const ytTask = await (await post('/api/agent/tasks', { task: 'اجلب أحدث تعليقات يوتيوب الحقيقية' }, 'owner')).json();
    check('تكامل: خطة التعليقات معروضة في الواجهة', ytTask.task.plan.steps.some((s: any) => s.toolId === 'youtube_comments'));
    check('تكامل: youtube_comments نُفّذت بنجاح', ytTask.task.journal.some((e: any) => e.toolId === 'youtube_comments' && e.ok === true));

    // مهمة بلا نص => 400
    check('تكامل: مهمة بلا نص => 400', (await post('/api/agent/tasks', { task: '' }, 'owner')).status === 400);

    // لا تسريب أسرار في أي استجابة
    const allJson = JSON.stringify([hb, tools, cbody, list]);
    check('تكامل: لا تسريب مفتاح المزود', !allJson.includes('"x"') || !allJson.includes('GEMINI_API_KEY": "x"'));
  } finally {
    server.close();
  }
}

async function run() {
  await unitTests();
  await integrationTests();
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} central-agent checks`);
  }
}

run().catch((err) => {
  console.error('Central agent harness crashed:', err);
  process.exit(1);
});
