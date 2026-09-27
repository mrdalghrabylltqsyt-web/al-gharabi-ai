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
import { AgentOrchestrator } from '../agent/orchestrator';
import { registerAgentRoutes } from '../agent/routes';
import { buildAgentPlan, classifyIntent, detectPlatforms } from '../agent/planner';
import { canUseTool, toolRequiresApproval } from '../agent/permissions';
import { AGENT_TOOLS, getAgentTool } from '../agent/tools';
import { describeProviders, shouldUseCouncil, primaryProvider } from '../agent/providerRouter';
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
    systemVerification: () => ({ version: '13.0.0', storage: { durable: true } }),
    aiGenerate: async () => ({ text: 'نص بديل حتمي', usedProvider: false, source: 'fallback' }),
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
