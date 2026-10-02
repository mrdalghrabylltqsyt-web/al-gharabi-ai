/**
 * System Health + Brain Versioning + Capability Evolution + Event Architecture
 * (منطق خالص).
 *
 * الغرض:
 *   - مراقبة صحة النظام (جودة/طزاجة البيانات، سلامة الذاكرة/المعرفة، توفّر الأدوات/الموصلات،
 *     المهام الفاشلة، الأخطاء، تنبيهات الأمان) وإعلان الفشل لا إخفاؤه.
 *   - تتبّع إصدارات ذكاء العقل (بلا تزييف تقدّم).
 *   - حساب **مستويات القدرة** من قدرات منفّذة فعلاً + جهوزية وقت التشغيل + تغطية اختبار
 *     (لا نِسَب عشوائية؛ لا «تحسّن» لمجرد وجود كود).
 *   - عقد أحداث التعلّم (استمرارية الأحداث المنظّمة من الدفعة 3).
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر `nowMs`.
 */

import type { SalesEvent, SalesEventType } from '../digital/events';

// ---------------------------------------------------------------------------
// صحة النظام (§29)
// ---------------------------------------------------------------------------

export type HealthLevel = 'OK' | 'DEGRADED' | 'FAILED' | 'UNKNOWN';

export const HEALTH_LEVEL_LABELS_AR: Record<HealthLevel, string> = Object.freeze({
  OK: 'سليم', DEGRADED: 'متدهور', FAILED: 'فاشل', UNKNOWN: 'غير معروف',
});

export interface HealthCheck {
  key: string;
  labelAr: string;
  level: HealthLevel;
  detail: string;
  /** إجراء مقترح عند التدهور/الفشل. */
  proposedFix: string | null;
}

export interface SystemHealthInput {
  dataQuality: HealthLevel;
  dataFreshness: HealthLevel;
  memoryIntegrity: HealthLevel;
  knowledgeIntegrity: HealthLevel;
  toolAvailability: HealthLevel;
  connectorState: HealthLevel;
  modelAvailability: HealthLevel;
  failedJobs: number;
  errorCount: number;
  securityAlerts: number;
  learningPipeline: HealthLevel;
}

/**
 * يبني تقرير صحة النظام. كل فحص يحمل حالته وإجراءً مقترحاً — **لا إخفاء للفشل**.
 */
export function buildSystemHealth(input: SystemHealthInput): { overall: HealthLevel; checks: HealthCheck[]; report: string; proposeFix: string[] } {
  const checks: HealthCheck[] = [
    { key: 'data_quality', labelAr: 'جودة البيانات', level: input.dataQuality, detail: 'اكتمال/تناسق/ثقة المصدر/عيّنة.', proposedFix: input.dataQuality === 'OK' ? null : 'راجع مصادر البيانات الناقصة وارفع العيّنة.' },
    { key: 'data_freshness', labelAr: 'طزاجة البيانات', level: input.dataFreshness, detail: 'عمر القيم التجارية.', proposedFix: input.dataFreshness === 'OK' ? null : 'حدّث القيم القديمة (سعر/توفّر/عرض).' },
    { key: 'memory_integrity', labelAr: 'سلامة الذاكرة', level: input.memoryIntegrity, detail: 'ذاكرة العقل الدائمة.', proposedFix: input.memoryIntegrity === 'OK' ? null : 'تحقّق من حفظ/استرجاع الذاكرة.' },
    { key: 'knowledge_integrity', labelAr: 'سلامة المعرفة', level: input.knowledgeIntegrity, detail: 'اتساق الكتالوج والحقائق.', proposedFix: input.knowledgeIntegrity === 'OK' ? null : 'راجع تعارضات المصادر.' },
    { key: 'tool_availability', labelAr: 'توفّر الأدوات', level: input.toolAvailability, detail: 'أدوات العقل المتاحة.', proposedFix: input.toolAvailability === 'OK' ? null : 'راجع الأدوات غير المتاحة.' },
    { key: 'connector_state', labelAr: 'حالة الموصلات', level: input.connectorState, detail: 'اتصال المنصات الموثّق.', proposedFix: input.connectorState === 'OK' ? null : 'راجع اتصال المنصات (لا ادّعاء بلا توثيق).' },
    { key: 'model_availability', labelAr: 'توفّر الموديل', level: input.modelAvailability, detail: 'مزوّد AI الخارجي (مدخل غير موثوق).', proposedFix: input.modelAvailability === 'OK' ? null : 'راجع حصة/مفتاح المزوّد — البديل الحتمي يعمل.' },
    { key: 'failed_jobs', labelAr: 'مهام فاشلة', level: input.failedJobs === 0 ? 'OK' : input.failedJobs < 5 ? 'DEGRADED' : 'FAILED', detail: `${input.failedJobs} مهمة فاشلة.`, proposedFix: input.failedJobs === 0 ? null : 'راجع المهام الفاشلة وأسبابها.' },
    { key: 'errors', labelAr: 'أخطاء', level: input.errorCount === 0 ? 'OK' : input.errorCount < 10 ? 'DEGRADED' : 'FAILED', detail: `${input.errorCount} خطأ.`, proposedFix: input.errorCount === 0 ? null : 'افحص سجلات الأخطاء.' },
    { key: 'security_alerts', labelAr: 'تنبيهات أمان', level: input.securityAlerts === 0 ? 'OK' : 'FAILED', detail: `${input.securityAlerts} تنبيه.`, proposedFix: input.securityAlerts === 0 ? null : 'عالج تنبيهات الأمان فوراً.' },
    { key: 'learning_pipeline', labelAr: 'مسار التعلّم', level: input.learningPipeline, detail: 'صحة دورة التعلّم.', proposedFix: input.learningPipeline === 'OK' ? null : 'راجع أحداث التعلّم ونتائجها.' },
  ];

  let overall: HealthLevel = 'OK';
  if (checks.some((c) => c.level === 'FAILED')) overall = 'FAILED';
  else if (checks.some((c) => c.level === 'DEGRADED')) overall = 'DEGRADED';
  else if (checks.some((c) => c.level === 'UNKNOWN')) overall = 'UNKNOWN';

  const proposeFix = checks.filter((c) => c.proposedFix).map((c) => c.proposedFix as string);
  const report = `الحالة العامة: ${HEALTH_LEVEL_LABELS_AR[overall]}. ${checks.filter((c) => c.level !== 'OK').length} فحصاً يحتاج انتباهاً.`;
  return { overall, checks, report, proposeFix };
}

// ---------------------------------------------------------------------------
// إصدار ذكاء العقل (§32)
// ---------------------------------------------------------------------------

export interface BrainVersionRecord {
  version: string;
  date: string;
  change: string;
  reason: string;
  evidence: string[];
  tests: string;
  result: string;
  rollbackOption: string;
}

/** سجل الإصدارات — يُبنى من سجل الدفعات الحقيقية، لا تزييف تقدّم. */
export function buildBrainVersionHistory(): BrainVersionRecord[] {
  return [
    {
      version: 'v1.0',
      date: '2026-10-02',
      change: 'العقل التجاري المتصل ببيانات الغرابي الحقيقية (الدفعة 1)',
      reason: 'قراءة الواقع التجاري من بيانات حقيقية بلا اختراع.',
      evidence: ['workspace.products', 'workspace.sales', 'workspace.leads'],
      tests: 'sales.foundation (70) + sales.integration (48) + sales.routes (20)',
      result: 'كتالوج وسعر/تقسيط موثّق ومسار عميل ومبيعات موثّقة.',
      rollbackOption: 'revert الدفعة 1',
    },
    {
      version: 'v1.1',
      date: '2026-10-02',
      change: 'عقل التسويق والطلب (الدفعة 2)',
      reason: 'تحويل التفاعل إلى إشارات طلب وفرص ومطابقة منتج↔جمهور وحملات.',
      evidence: ['growth.foundation', 'growth.routes'],
      tests: 'growth.foundation (56) + antifabrication (19) + routes (28)',
      result: 'مقاطع جمهور + فرص طلب + حملات + تجارب + قُمع بيعي بأدلة.',
      rollbackOption: 'revert الدفعة 2',
    },
    {
      version: 'v1.2',
      date: '2026-10-02',
      change: 'العقل المركزي للمبيعات الرقمية (الدفعة 3)',
      reason: 'الجانب الرقمي قناة بيع ثانية: تأهيل، تحقق عرض، متابعة، إسناد، أحداث.',
      evidence: ['digital.sales.foundation', 'digital.sales.routes'],
      tests: 'foundation (79) + antifabrication (25) + routes (39)',
      result: 'قُمع رقمي + إشارات شراء + عملاء مؤهّلون + إسناد + أحداث تعلّم.',
      rollbackOption: 'revert الدفعة 3',
    },
    {
      version: 'v2.0',
      date: '2026-10-02',
      change: 'دمج الدفعات 1–3 في نظام ذكاء تجاري واحد + تعلّم + بحث + استراتيجية + تحسين ذاتي آمن (الدفعة 4)',
      reason: 'غاية واحدة: زيادة المبيعات والربح الموثّقين — بلا تحسين مقاييس وهمية.',
      evidence: ['commercial.*', 'one central brain'],
      tests: 'commercial.unified + antifabrication + routes + final-audit',
      result: 'عقل تجاري مركزي واحد بغاية عليا صريحة ودورة تشغيل مكتملة.',
      rollbackOption: 'revert الدفعة 4 — الدفعات 1–3 تبقى سليمة',
    },
  ];
}

export function latestBrainVersion(): string {
  const h = buildBrainVersionHistory();
  return h.length ? h[h.length - 1].version : 'v0.0';
}

// ---------------------------------------------------------------------------
// القدرات والتطوّر (§33)
// ---------------------------------------------------------------------------

export type CapabilityLevel = 'NOT_IMPLEMENTED' | 'IMPLEMENTED' | 'TESTED' | 'RUNTIME_READY';

export const CAPABILITY_LEVEL_LABELS_AR: Record<CapabilityLevel, string> = Object.freeze({
  NOT_IMPLEMENTED: 'غير منفّذة',
  IMPLEMENTED: 'منفّذة بالكود',
  TESTED: 'مغطّاة باختبارات',
  RUNTIME_READY: 'جاهزة وقت التشغيل',
});

/** ترتيب تصاعدي: لا يُعلن مستوى أعلى من دليله. */
export const CAPABILITY_LEVEL_ORDER: readonly CapabilityLevel[] = Object.freeze(['NOT_IMPLEMENTED', 'IMPLEMENTED', 'TESTED', 'RUNTIME_READY']);

export interface CapabilityEvidenceInput {
  key: string;
  labelAr: string;
  implemented: boolean;
  testCoverage: boolean;
  runtimeReady: boolean;
  evidence: string[];
  lastUpdate: string | null;
  nextImprovement: string | null;
}

export interface CapabilityRow {
  key: string;
  labelAr: string;
  level: CapabilityLevel;
  levelLabelAr: string;
  evidence: string[];
  testCoverage: boolean;
  runtimeReady: boolean;
  lastUpdate: string | null;
  nextImprovement: string | null;
}

/**
 * يحسب مستوى القدرة من **أدلة فعلية**: منفّذة ← مغطّاة باختبار ← جاهزة وقت التشغيل.
 * لا نِسَب عشوائية، ولا «تحسّن» لمجرد وجود كود (يلزم اختبار + جهوزية).
 */
export function computeCapabilityLevel(input: CapabilityEvidenceInput): CapabilityRow {
  let level: CapabilityLevel = 'NOT_IMPLEMENTED';
  if (input.implemented) level = 'IMPLEMENTED';
  if (input.implemented && input.testCoverage) level = 'TESTED';
  if (input.implemented && input.testCoverage && input.runtimeReady) level = 'RUNTIME_READY';
  return {
    key: input.key,
    labelAr: input.labelAr,
    level,
    levelLabelAr: CAPABILITY_LEVEL_LABELS_AR[level],
    evidence: [...input.evidence],
    testCoverage: input.testCoverage,
    runtimeReady: input.runtimeReady,
    lastUpdate: input.lastUpdate,
    nextImprovement: input.nextImprovement,
  };
}

export interface CapabilityEvolution {
  version: string;
  capabilities: CapabilityRow[];
  /** عدّ لكل مستوى — بديل النِسَب العشوائية. */
  counts: Record<CapabilityLevel, number>;
  /** أي قدرة لا تزال غير جاهزة وقت التشغيل (شفافية). */
  notRuntimeReady: string[];
  note: string;
}

/**
 * يبني لوحة تطوّر القدرات. المستوى محسوب من الأدلة، والمستويات غير الجاهزة معلنة
 * صراحةً — لا ادّعاء تقدّم بلا دليل.
 */
export function buildCapabilityEvolution(rows: CapabilityEvidenceInput[]): CapabilityEvolution {
  const capabilities = rows.map(computeCapabilityLevel);
  const counts = Object.fromEntries(
    CAPABILITY_LEVEL_ORDER.map((l) => [l, 0]),
  ) as Record<CapabilityLevel, number>;
  for (const c of capabilities) counts[c.level] = (counts[c.level] || 0) + 1;
  return {
    version: latestBrainVersion(),
    capabilities,
    counts,
    notRuntimeReady: capabilities.filter((c) => c.level !== 'RUNTIME_READY').map((c) => c.labelAr),
    note: 'المستوى محسوب من: منفّذة + مغطّاة باختبارات + جاهزة وقت التشغيل — لا نِسَب عشوائية.',
  };
}

// ---------------------------------------------------------------------------
// عقد أحداث التعلّم (§44)
// ---------------------------------------------------------------------------

export interface LearningEventEnvelope {
  event: SalesEventType;
  timestamp: string;
  source: string;
  entityRefs: { productId: string | null; leadId: string | null; campaignId: string | null; customerKey: string | null };
  previousState: string | null;
  newState: string | null;
  evidence: string[];
  confidence: 'low' | 'medium' | 'high';
  outcome: string | null;
  /** لا تعلّم من حدث غير مؤهّل (مثل بيع غير موثّق). */
  learningEligible: boolean;
}

/** يلفّ حدثاً منظّماً في مغلّف تعلّم. بلا بيانات شخصية. */
export function toLearningEnvelope(event: SalesEvent): LearningEventEnvelope {
  return {
    event: event.type,
    timestamp: event.at,
    source: 'digital_sales_events',
    entityRefs: { productId: event.productId, leadId: event.leadId, campaignId: event.campaignId, customerKey: event.customerKey },
    previousState: event.previousState,
    newState: event.newState,
    evidence: [...event.evidence],
    confidence: event.confidence,
    outcome: event.outcome,
    learningEligible: event.learningEligible,
  };
}

export interface EventArchitectureSummary {
  total: number;
  eligible: number;
  byType: Record<string, number>;
  note: string;
}

export function summarizeEventArchitecture(events: SalesEvent[]): EventArchitectureSummary {
  const byType: Record<string, number> = {};
  for (const e of events) byType[e.type] = (byType[e.type] || 0) + 1;
  return {
    total: events.length,
    eligible: events.filter((e) => e.learningEligible).length,
    byType,
    note: 'أحداث منظّمة آمنة الخصوصية تدعم تعلّم الطلب/العميل/الحملة/التجربة/المتابعة/الإسناد/البيع/الربح/القدرات.',
  };
}
