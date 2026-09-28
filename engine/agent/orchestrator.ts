/**
 * منسّق العقل المركزي (Agent Orchestrator).
 *
 * يستقبل مهمة، يبني خطة حتمية، ينفّذ أدوات السجل بالتسلسل، يقرأ النتائج،
 * يصنّف الأخطاء ويحاول إصلاح القابل منها بإعادة تنفيذ محدودة (بلا حلقة لا
 * نهائية)، ثم يتحقق ويسجّل ويُعيد تقريراً صادقاً.
 *
 * لا يدّعي تنفيذاً خارجياً لم يحدث: أدوات EXTERNAL_ACTION تُحجب ولا تُنفَّذ من
 * داخل المهمة. ولا يخترع بيانات: كل خطوة تُسجّل نتيجة أداتها الفعلية.
 *
 * منطق خالص بلا express وبلا شبكة: يُختبر بخادم أدوات وهمي.
 */

import { buildAgentPlan, normalizeTask, type AgentPlan, type AgentPlanKind, type AgentArgRef } from './planner';
import { getAgentTool, type AgentToolContext, type AgentToolResult } from './tools';
import { canUseTool, toolRequiresApproval, type AgentOperator } from './permissions';

export type AgentTaskStatus =
  | 'queued'
  | 'planning'
  | 'executing'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'blocked';

export type AgentFailureCode =
  | 'TOOL_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'MISSING_ARGUMENT'
  | 'TOOL_EXECUTION_FAILED'
  | 'EXTERNAL_APPROVAL_REQUIRED'
  | 'DELEGATION_NOT_GRANTED'
  | 'TIMEOUT'
  | 'NONE';

export interface AgentJournalEntry {
  at: string;
  step: number;
  toolId: string;
  label: string;
  permission: string;
  ok: boolean;
  code?: AgentFailureCode;
  error?: string;
  /** ملخّص قصير للنتيجة (بلا أسرار) — يُحسب حتمياً. */
  summary: string;
  durationMs: number;
  attempts: number;
}

export interface AgentTaskInput {
  task: string;
  mode?: 'auto' | AgentPlanKind;
  idempotencyKey?: string;
  context?: Record<string, any>;
  operator: AgentOperator;
  userId: string;
}

export interface AgentTaskRecord {
  id: string;
  task: string;
  mode: string;
  operator: AgentOperator;
  userId: string;
  idempotencyKey: string | null;
  status: AgentTaskStatus;
  plan: AgentPlan | null;
  journal: AgentJournalEntry[];
  result: { summary: string; data: any } | null;
  error: string | null;
  failureCode: AgentFailureCode;
  verified: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** لقطة سياق آمنة (بلا أسرار) تُحفظ داخل السجل. */
  contextSnapshot: Record<string, any> | null;
}

export interface AgentOrchestratorDeps {
  /** السياق الحقيقي لأدوات الخادم. */
  toolContext: AgentToolContext;
  now?: () => number;
  newId?: () => string;
  /** مهلة كل خطوة أداة (تُمنع الحلقة المعلّقة). */
  stepTimeoutMs?: number;
  /** الحد الأقصى لمحاولات الأداة الواحدة القابلة للإصلاح. */
  maxAttempts?: number;
  /** مفتاح قصير لملخّص النتيجة الآمن. */
  summarize?: (toolId: string, result: AgentToolResult) => string;
}

const DEFAULT_STEP_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ATTEMPTS = 2;

/** يحسب ملخّصاً قصيراً آمناً من نتيجة الأداة (بلا أسرار — أعداد ومفاتيح فقط). */
function defaultSummary(toolId: string, result: AgentToolResult): string {
  if (!result.ok) return `فشل: ${result.error || result.code || 'خطأ'}`;
  const d: any = result.data;
  if (Array.isArray(d)) return `عدد العناصر: ${d.length}`;
  if (d && typeof d === 'object') {
    const keys = Object.keys(d).slice(0, 8);
    return `مفاتيح النتيجة: ${keys.join(', ')}`;
  }
  if (typeof d === 'string') return d.slice(0, 120);
  if (d === undefined || d === null) return 'تم';
  return String(d).slice(0, 120);
}

/** هل القيمة مرجع مخرَج خطوة سابقة؟ (شكل صريح، بلا تخمين). */
function isArgRef(v: any): v is AgentArgRef {
  return Boolean(v) && typeof v === 'object' && typeof v.fromTool === 'string' && typeof v.field === 'string';
}

/** هل القيمة مرجع سياق مهمة؟ (مثل commentId/text المُزوّدين صراحةً من المالك). */
function isContextRef(v: any): v is AgentArgRef {
  return Boolean(v) && typeof v === 'object' && typeof v.fromContext === 'string';
}

/**
 * يحلّ قيمة معامل من مخرَجات الخطوات السابقة **وقت التنفيذ**.
 * لا يختلق قيمة: إن غابت القائمة/العنصر/الحقل يُعيد undefined لتفشل الخطوة
 * برسالة نقص معامل صريحة (`MISSING_ARGUMENT`) بدل تمرير معرّف وهمي.
 */
export function resolveArgValue(arg: any, outputs: Record<string, any>, context: Record<string, any> = {}): any {
  // مرجع سياق: قيمة حقيقية يزوّدها المالك في جسم المهمة (لا مخرَج خطوة).
  if (isContextRef(arg)) {
    const v = context ? context[arg.fromContext] : undefined;
    if (v === undefined || v === null || v === '') return undefined;
    return v;
  }
  if (!isArgRef(arg)) return arg;
  const output = outputs[arg.fromTool];
  if (!output) return undefined;
  // مسار متداخل: يُقرأ الحقل من كائن داخل مخرَج الخطوة (مثل latestComment.commentId
  // أو latestAnalysis.iraqiSuggestedReply). الحقل الوحيد يُقرأ مباشرة من الجذر.
  if (arg.outputPath && !arg.listPath) {
    const container = output?.[arg.outputPath];
    if (!container || typeof container !== 'object') return undefined;
    const v = container[arg.field];
    if (v === undefined || v === null || v === '') return undefined;
    return v;
  }
  let list: any = output;
  if (arg.listPath) list = output?.[arg.listPath];
  if (!Array.isArray(list) || !list.length) return undefined;
  const present = list.filter((it) => it && it[arg.field] !== undefined && it[arg.field] !== null && it[arg.field] !== '');
  if (!present.length) return undefined;
  // `list` يُمرّر العناصر الحقيقية كاملة (مثل تعليقات لها text) لتمريرها لأداة
  // تحليل، بلا اختلاق أي عنصر. منفّذ الأداة يفرض الحدّ الأقصى بنفسه.
  if (arg.mode === 'list') return present;
  const values = present.map((it) => it[arg.field]);
  // `all` يُعيد كل القيم الحقيقية (بترتيب المصدر) ليحدّد منفّذ الأداة الحدّ الأقصى؛
  // غيره (الافتراضي) يُعيد أول قيمة فقط. لا توليد قيمة عند غياب البيانات.
  return arg.pick === 'all' ? values : values[0];
}

/** يحلّ كل معاملات الخطوة من مخرَجات الخطوات السابقة (لا يُعدّل المرجع، يبني نسخة). */
function resolveArgs(args: Record<string, any>, outputs: Record<string, any>, context: Record<string, any> = {}): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(args || {})) out[k] = resolveArgValue(v, outputs, context);
  return out;
}

/** وقت التنفيذ بمهلة (لا يترك أداة معلّقة توقف العقل). */
function withTimeout<T>(p: Promise<T>, ms: number, timeoutCode: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('انتهت مهلة تنفيذ الأداة'), { code: timeoutCode })), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * منسّق مهام العقل. يحتفظ بالمهام في الذاكرة، والاستمرار يُدار من طبقة الخادم
 * التي تحفظ السجل عبر محوّل الحالة (كل المهام قابلة للتسلسل بلا أسرار).
 */
export class AgentOrchestrator {
  private tasks = new Map<string, AgentTaskRecord>();
  private order: string[] = [];
  private readonly deps: AgentOrchestratorDeps;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly stepTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly summarize: (toolId: string, result: AgentToolResult) => string;

  constructor(deps: AgentOrchestratorDeps) {
    this.deps = deps;
    this.now = deps.now || (() => Date.now());
    this.newId = deps.newId || (() => `task-${Math.random().toString(36).slice(2, 10)}`);
    this.stepTimeoutMs = deps.stepTimeoutMs || DEFAULT_STEP_TIMEOUT_MS;
    this.maxAttempts = deps.maxAttempts || DEFAULT_MAX_ATTEMPTS;
    this.summarize = deps.summarize || defaultSummary;
  }

  /** يحقن سياق الأدوات الحقيقي بعد تهيئة الخادم (يُحقن مرة واحدة). */
  setToolContext(ctx: AgentToolContext): void {
    this.deps.toolContext = ctx;
  }

  /** يعيد المهمة المطابقة لمفتاح idempotency إن وُجدت خلال 24 ساعة، وإلا null. */
  findIdempotent(userId: string, key: string | undefined): AgentTaskRecord | null {
    if (!key) return null;
    for (const id of [...this.order].reverse()) {
      const t = this.tasks.get(id);
      if (t && t.userId === userId && t.idempotencyKey === key && this.now() - new Date(t.createdAt).getTime() < 24 * 60 * 60 * 1000) {
        return t;
      }
    }
    return null;
  }

  /** ينشئ مهمة بحالة queued ويحسب خطتها فوراً (planning حتمي لا يستهلك AI). */
  createTask(input: AgentTaskInput): AgentTaskRecord {
    const task = normalizeTask(input.task);
    if (!task) throw new Error('نص المهمة مطلوب.');
    const plan = buildAgentPlan(task, { explicitKind: input.mode && input.mode !== 'auto' ? input.mode : undefined });
    const record: AgentTaskRecord = {
      id: this.newId(),
      task,
      mode: input.mode || 'auto',
      operator: input.operator,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey || null,
      status: 'queued',
      plan,
      journal: [],
      result: null,
      error: null,
      failureCode: 'NONE',
      verified: false,
      createdAt: new Date(this.now()).toISOString(),
      startedAt: null,
      finishedAt: null,
      // لا نخزّن إلا مفاتيح سياق آمنة (لا أسرار): نُسقط أي قيمة تبدو سرّية.
      contextSnapshot: sanitizeContext(input.context),
    };
    this.tasks.set(record.id, record);
    this.order.push(record.id);
    if (this.order.length > 500) {
      const dropped = this.order.shift();
      if (dropped) this.tasks.delete(dropped);
    }
    return record;
  }

  getTask(id: string): AgentTaskRecord | null {
    return this.tasks.get(id) || null;
  }

  listTasks(userId: string, operator: AgentOperator): AgentTaskRecord[] {
    const all = this.order.map((id) => this.tasks.get(id)!).filter(Boolean);
    return operator === 'owner' ? all.slice().reverse() : all.filter((t) => t.userId === userId).slice().reverse();
  }

  /** يُدرج سجلاً مُسترجعاً من التخزين (يُستخدم عند الإقلاع). */
  restore(records: AgentTaskRecord[]): void {
    for (const r of records) {
      if (!r?.id || this.tasks.has(r.id)) continue;
      this.tasks.set(r.id, r);
      this.order.push(r.id);
    }
  }

  snapshot(): AgentTaskRecord[] {
    return this.order.map((id) => this.tasks.get(id)!).filter(Boolean).map((t) => ({ ...t, journal: t.journal.slice(-50) }));
  }

  /**
   * ينفّذ المهمة خطوة بخطوة. يعيد السجل النهائي. لا يرمي: أي فشل يُسجّل
   * كحالة failed/blocked مع سبب صريح. `ctx` اختياري لتمرير سياق أدوات خاص
   * بالمهمة (يمنع تطاير السياق بين مهام متزامنة لمستخدمين مختلفين).
   */
  async run(taskId: string, ctx?: AgentToolContext): Promise<AgentTaskRecord> {
    const toolContext = ctx || this.deps.toolContext;
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('مهمة غير موجودة.');
    if (task.status === 'executing') return task; // حماية من التنفيذ المتزامن المزدوج
    if (!task.plan) {
      task.plan = buildAgentPlan(task.task, { explicitKind: task.mode !== 'auto' ? (task.mode as AgentPlanKind) : undefined });
    }
    task.status = 'executing';
    task.startedAt = new Date(this.now()).toISOString();
    const journal = task.journal;
    // مخرَجات الخطوات الناجحة — تُغذّي المراجع (`AgentArgRef`) في الخطوات التالية
    // بلا اختلاق قيم: يُمرَّر معرّف حقيقي فقط من نتيجة أداة سابقة فعلية.
    const outputs: Record<string, any> = {};

    for (let i = 0; i < task.plan.steps.length; i += 1) {
      const stepDef = task.plan.steps[i];
      const tool = getAgentTool(stepDef.toolId);
      const started = this.now();
      if (!tool) {
        journal.push(this.entry(i, stepDef, 'NONE', 'TOOL_NOT_FOUND', 'أداة غير مسجّلة', false, started, 1));
        continue;
      }
      // بوابة الصلاحية.
      const perm = canUseTool(task.operator, tool.permission);
      if (!perm.allowed) {
        journal.push(this.entry(i, stepDef, tool.permission, 'PERMISSION_DENIED', perm.reason, false, started, 1));
        continue;
      }
      // بوابة الموافقة: لا تنفيذ خارجي حقيقي من داخل مهمة تلقائية، إلا بعملية
      // YouTube مفوّضة صراحةً من المالك. حلّ المراجع أولاً لأن النشر المجدول
      // يحتاج `publish` و`schedule` معاً (قرار التفويض يعتمد على المعاملات).
      const resolvedArgs = resolveArgs(stepDef.args, outputs, task.contextSnapshot || {});
      if (toolRequiresApproval(tool.permission)) {
        const delegation = toolContext.delegationCheck
          ? toolContext.delegationCheck({ toolId: tool.id, args: resolvedArgs })
          : { allowed: false, code: 'DELEGATION_NOT_GRANTED', reason: 'لا يوجد تفويض تشغيل مفعّل لهذه العملية الخارجية.' };
        if (!delegation.allowed) {
          journal.push(this.entry(i, stepDef, tool.permission, (delegation.code as AgentFailureCode) || 'EXTERNAL_APPROVAL_REQUIRED', delegation.reason || 'أداة خارجية تتطلب موافقة صريحة أو تفويض تشغيل فعّال.', false, started, 1));
          task.status = 'waiting';
          continue;
        }
        // العملية مفوّضة: تُنفَّذ عبر نفس المنفّذ الحقيقي (بوابات المشروع سارية داخل المنفّذ).
      }

      // تنفيذ مع إعادة محدودة للأخطاء القابلة للإصلاح فقط.
      const idempotent = tool.permission === 'READ' || tool.permission === 'EXECUTE';
      const attemptsAllowed = idempotent ? this.maxAttempts : 1;
      let result: AgentToolResult = { ok: false, code: 'TOOL_EXECUTION_FAILED', error: 'لم يُنفَّذ' };
      let attempts = 0;
      let failureCode: AgentFailureCode = 'TOOL_EXECUTION_FAILED';
      for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
        attempts = attempt;
        try {
          result = await withTimeout(Promise.resolve(tool.run(resolvedArgs, toolContext)), this.stepTimeoutMs, 'TIMEOUT');
        } catch (e: any) {
          const timedOut = e?.code === 'TIMEOUT';
          result = { ok: false, code: timedOut ? 'TIMEOUT' : 'TOOL_EXECUTION_FAILED', error: String(e?.message || e).slice(0, 200) };
        }
        if (result.ok) { failureCode = 'NONE'; break; }
        failureCode = (result.code as AgentFailureCode) || 'TOOL_EXECUTION_FAILED';
        // الأخطاء غير القابلة للإصلاح (وسيط ناقص/صلاحية) لا تُعاد.
        if (failureCode === 'MISSING_ARGUMENT' || failureCode === 'PERMISSION_DENIED' || failureCode === 'EXTERNAL_APPROVAL_REQUIRED') break;
      }

      const summary = result.ok ? this.summarize(stepDef.toolId, result) : `فشل بعد ${attempts} محاولة: ${result.error || failureCode}`;
      journal.push(this.entry(i, stepDef, tool.permission, failureCode, result.error, result.ok, started, attempts, summary));
      // مخرَج الخطوة الناجحة فقط يُتاح للمراجع في الخطوات التالية (لا بيانات فاشلة).
      if (result.ok) outputs[stepDef.toolId] = result.data;

      // أي فشل في أداة ذات أثر (WRITE/SENSITIVE/EXECUTE/EXTERNAL_ACTION) يوقف
      // المهمة بحالة واضحة. فشل أدوات القراءة يُسجَّل ويُكمل (قد تكون خطوة سياق
      // اختيارية). أداة خارجية فشلت بعد تفويض فعّال = فشل حقيقي، لا يُتجاهل.
      if (!result.ok && (tool.permission === 'WRITE' || tool.permission === 'SENSITIVE' || tool.permission === 'EXECUTE' || tool.permission === 'EXTERNAL_ACTION')) {
        task.status = 'failed';
        task.failureCode = failureCode;
        task.error = `فشلت الخطوة «${stepDef.label}»: ${result.error || failureCode}`;
        task.finishedAt = new Date(this.now()).toISOString();
        task.verified = false;
        return task;
      }
    }

    // التحقق النهائي: أي خطوة ok + الخطوة الحاسمة للمهمة.
    const anyOk = journal.some((e) => e.ok);
    const wroteJob = journal.some((e) => e.toolId === 'job_create' && e.ok);
    task.verified = anyOk;
    if (task.status === 'waiting' || (task.plan.requiresApproval && wroteJob)) {
      task.status = 'waiting';
    } else if (anyOk) {
      task.status = 'completed';
    } else {
      task.status = 'failed';
      task.failureCode = task.failureCode === 'NONE' ? 'TOOL_EXECUTION_FAILED' : task.failureCode;
      task.error = task.error || 'لم ينجح أي من خطوات الخطة.';
    }
    task.result = {
      summary: buildResultSummary(task),
      // مخرَج كل خطوة الحقيقي (منقّى ومحدود الحجم/العمق) — لا أسماء مفاتيح فقط.
      // المخرَج يُقرأ من outputs للخطوات الناجحة، فلا يضيع ولا يُختلق عند الفشل.
      data: journal.map((e) => ({ step: e.step + 1, toolId: e.toolId, ok: e.ok, summary: e.summary, output: e.ok ? sanitizeOutput(outputs[e.toolId]) : null })),
    };
    task.finishedAt = new Date(this.now()).toISOString();
    return task;
  }

  private entry(
    step: number, stepDef: { toolId: string; label: string }, permission: string,
    code: AgentFailureCode, error: string | undefined, ok: boolean, started: number, attempts: number, summary?: string,
  ): AgentJournalEntry {
    return {
      at: new Date(this.now()).toISOString(),
      step,
      toolId: stepDef.toolId,
      label: stepDef.label,
      permission,
      ok,
      code: ok ? undefined : code,
      error: ok ? undefined : error,
      summary: summary || (ok ? 'تم' : 'فشل'),
      durationMs: Math.max(0, this.now() - started),
      attempts,
    };
  }
}

/** ملخّص نتيجة عربي حتمي من السجل. */
function buildResultSummary(task: AgentTaskRecord): string {
  const okCount = task.journal.filter((e) => e.ok).length;
  const failCount = task.journal.filter((e) => !e.ok).length;
  const parts = [`نُفّذت ${okCount} خطوة بنجاح`];
  if (failCount) parts.push(`وفشلت/حُجبت ${failCount}`);
  if (task.status === 'waiting') parts.push('وتنتظر موافقة بشرية قبل أي أثر خارجي');
  return parts.join('، ') + '.';
}

/** يُسقط أي مفاتيح/قيم تبدو سرّية من لقطة السياق (منع تسريب الأسرار في السجل). */
const SECRET_KEY_RE = /(token|secret|password|passwd|otp|key|credential|authorization|cookie|code_verifier|api_?key)/i;
function sanitizeContext(context: Record<string, any> | undefined): Record<string, any> | null {
  if (!context || typeof context !== 'object') return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(context)) {
    if (SECRET_KEY_RE.test(k)) continue;
    if (typeof v === 'string' && v.length > 500) { out[k] = v.slice(0, 500); continue; }
    if (v && typeof v === 'object') { out[k] = '[object]'; continue; }
    out[k] = v;
  }
  return out;
}

/** حدّ حجم نص واحد داخل مخرَج الأداة (يمنع تضخّم النتيجة). */
const MAX_OUTPUT_STRING = 4000;
/** حدّ عمق التداخل في المخرَج (يمنع البنى العميقة/الحلقية). */
const MAX_OUTPUT_DEPTH = 8;
/** حدّ عدد عناصر أي مصفوفة في المخرَج. */
const MAX_OUTPUT_ARRAY = 50;

/**
 * ينقّي مخرَج أداة للحفظ في task.result.data: يُسقط أي مفتاح يبدو سرّياً،
 * ويحدّ الحجم والعمق وعدد العناصر، ويحوّل الدوال/القيم غير القابلة للتسلسل.
 * لا يحذف نص التعليقات/التحليل (داخل الحدود) فلا يفقد التحليل الحاجة إليه.
 */
export function sanitizeOutput(value: any, depth = 0): any {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string') return value.length > MAX_OUTPUT_STRING ? value.slice(0, MAX_OUTPUT_STRING) : value;
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'function' || t === 'symbol' || t === 'bigint') return null;
  if (depth >= MAX_OUTPUT_DEPTH) return '[deep]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_OUTPUT_ARRAY).map((v) => sanitizeOutput(v, depth + 1));
  }
  if (t === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(k)) continue;
      const sv = sanitizeOutput(v, depth + 1);
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  }
  return null;
}
