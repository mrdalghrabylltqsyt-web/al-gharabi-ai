/**
 * مسارات العقل المركزي (Central AI Agent API).
 *
 * كل المسارات محمية بـauthenticateToken. الصلاحيات تُفرض من طبقة الصلاحيات
 * (READ/WRITE/EXECUTE/EXTERNAL_ACTION/SENSITIVE) لا من إخفاء زر. لا تُعاد أي
 * أسرار في أي استجابة، والمهام تُعيد حالة حقيقية وخطوات وأدوات ونتائج فعلية.
 *
 * الحقن عبر `deps` يجعل الوحدة قابلة للاختبار بخادم أدوات وهمي.
 */

import type express from 'express';
import { AgentOrchestrator } from './orchestrator';
import { AGENT_TOOLS } from './tools';
import { describeToolParameters } from './planner';
import { describeProviders, shouldUseCouncil, COUNCIL_PIPELINE, hasPrimaryProvider } from './providerRouter';
import type { AgentOperator } from './permissions';

export interface AgentRoutesDeps {
  authenticateToken: express.RequestHandler;
  requireOwner: express.RequestHandler;
  orchestrator: AgentOrchestrator;
  /** سياق الأدوات الحقيقي للمُشغّل الحالي. */
  toolContextFor: (operator: AgentOperator, userId: string) => any;
  /** يُستدعى بعد تغيّر حالة المهام لتثبيتها في المخزن الدائم. */
  persistState: () => void;
  /** إصدار المشروع للعرض في الصحة. */
  projectVersion: string;
  env?: Record<string, string | undefined>;
}

function operatorOf(user: any): AgentOperator {
  return user?.role === 'owner' ? 'owner' : 'staff';
}

/** يعرض أداة بلا منفّذها (لا يُرسَل كود إلى العميل). */
function toolView(t: (typeof AGENT_TOOLS)[number]) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    permission: t.permission,
    parameters: t.parameters,
    parametersLabel: describeToolParameters(t.parameters),
    requiresApproval: t.permission === 'EXTERNAL_ACTION',
  };
}

/** عرض مهمة بلا أي قيمة سرّية (السجل والسياق منقّى أصلاً). */
function taskView(t: any) {
  return {
    id: t.id,
    task: t.task,
    mode: t.mode,
    operator: t.operator,
    status: t.status,
    failureCode: t.failureCode,
    verified: t.verified,
    idempotencyKey: t.idempotencyKey,
    createdAt: t.createdAt,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
    error: t.error,
    plan: t.plan ? { kind: t.plan.kind, summary: t.plan.summary, requiresAi: t.plan.requiresAi, requiresApproval: t.plan.requiresApproval, reason: t.plan.reason, steps: t.plan.steps.map((s: any) => ({ toolId: s.toolId, label: s.label, args: s.args })) } : null,
    journal: t.journal,
    result: t.result,
    contextSummary: t.contextSnapshot ? Object.keys(t.contextSnapshot) : [],
  };
}

export function registerAgentRoutes(app: express.Express, deps: AgentRoutesDeps): void {
  const { authenticateToken, orchestrator, toolContextFor, persistState, projectVersion } = deps;
  const env = deps.env || process.env;

  app.get('/api/agent/health', authenticateToken, (_req, res) => {
    res.json({
      success: true,
      version: projectVersion,
      ready: true,
      tools: AGENT_TOOLS.length,
      providers: describeProviders(env),
      primaryProviderConfigured: hasPrimaryProvider(env),
      councilEnabled: shouldUseCouncil(env),
      councilPipeline: COUNCIL_PIPELINE,
      note: 'العقل المركزي منسّق؛ النماذج الخارجية أدوات استشارية لا تملك القرار النهائي. لا تُستهلك حصة AI في العمليات الحتمية.',
      generatedAt: new Date().toISOString(),
    });
  });

  app.get('/api/agent/tools', authenticateToken, (_req, res) => {
    res.json({ success: true, tools: AGENT_TOOLS.map(toolView) });
  });

  app.get('/api/agent/providers', authenticateToken, (_req, res) => {
    res.json({
      success: true,
      providers: describeProviders(env),
      councilEnabled: shouldUseCouncil(env),
      councilPipeline: COUNCIL_PIPELINE,
      note: 'لا تُضاف أي مفاتيح وهمية؛ المزوّد غير المضبوط يظهر configured=false بلا اتصال.',
    });
  });

  app.get('/api/agent/tasks', authenticateToken, (req, res) => {
    const user = (req as any).user;
    const tasks = orchestrator.listTasks(user.id, operatorOf(user));
    res.json({ success: true, count: tasks.length, tasks: tasks.slice(0, 50).map(taskView) });
  });

  app.get('/api/agent/tasks/:id', authenticateToken, (req, res) => {
    const user = (req as any).user;
    const task = orchestrator.getTask(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'مهمة غير موجودة.' });
    if (user.role !== 'owner' && task.userId !== user.id) {
      return res.status(403).json({ success: false, error: 'صلاحية مرفوضة: لا تملك الوصول لهذه المهمة.' });
    }
    res.json({ success: true, task: taskView(task) });
  });

  app.post('/api/agent/tasks', authenticateToken, async (req, res) => {
    const user = (req as any).user;
    const operator = operatorOf(user);
    const task = typeof req.body?.task === 'string' ? req.body.task : '';
    if (!task.trim()) return res.status(400).json({ success: false, error: 'نص المهمة مطلوب.' });
    const mode = typeof req.body?.mode === 'string' ? req.body.mode : 'auto';
    const headerKey = typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'].trim() : '';
    const idempotencyKey = (typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '') || headerKey || undefined;

    // منع التنفيذ المزدوج بنفس مفتاح idempotency.
    if (idempotencyKey) {
      const existing = orchestrator.findIdempotent(user.id, idempotencyKey);
      if (existing) {
        return res.json({ success: true, duplicate: true, task: taskView(existing) });
      }
    }

    let record;
    try {
      record = orchestrator.createTask({ task, mode: mode as any, idempotencyKey, context: req.body?.context, operator, userId: user.id });
    } catch (e: any) {
      return res.status(400).json({ success: false, error: String(e?.message || 'تعذر إنشاء المهمة.') });
    }
    persistState();
    const finished = await orchestrator.run(record.id, toolContextFor(operator, user.id));
    persistState();
    res.status(201).json({ success: true, task: taskView(finished) });
  });

  // إعادة تشغيل مهمة (للمالك، أو لصاحبها): تنشئ مهمة جديدة بمعرّف جديد.
  app.post('/api/agent/tasks/:id/replay', authenticateToken, async (req, res) => {
    const user = (req as any).user;
    const operator = operatorOf(user);
    const original = orchestrator.getTask(req.params.id);
    if (!original) return res.status(404).json({ success: false, error: 'مهمة غير موجودة.' });
    if (user.role !== 'owner' && original.userId !== user.id) {
      return res.status(403).json({ success: false, error: 'صلاحية مرفوضة.' });
    }
    const record = orchestrator.createTask({ task: original.task, mode: original.mode as any, operator, userId: user.id, context: original.contextSnapshot || undefined });
    persistState();
    const finished = await orchestrator.run(record.id, toolContextFor(operator, user.id));
    persistState();
    res.status(201).json({ success: true, task: taskView(finished) });
  });
}
