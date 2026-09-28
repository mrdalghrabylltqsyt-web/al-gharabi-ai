/**
 * مخطط العقل المركزي (Task Planner).
 *
 * تخفيف الحمل: التخطيط **حتمي محلي** في الحالات الشائعة، والحاجة للذكاء
 * الاصطناعي هي استثناء. كل نية تُترجم إلى خطوات من أدوات السجل الرسمي فقط.
 * لا تختلق خطة أداة غير موجودة، ولا تستدعي AI إلا عند نية تتطلب صياغة نصية.
 *
 * منطق خالص بلا شبكة: يُختبر مباشرة.
 */

import { AGENT_TOOLS, type AgentToolParameter } from './tools';

export type AgentPlanKind =
  | 'diagnose'
  | 'status'
  | 'content'
  | 'analysis'
  | 'jobs'
  | 'comments'
  | 'verification'
  | 'youtube'
  | 'general';

export interface AgentPlanStep {
  toolId: string;
  /** معاملات الأداة (تُمرَّر كما هي للمنفّذ). */
  args: Record<string, any>;
  /** ما تمثله الخطوة بالعربية. */
  label: string;
}

export interface AgentPlan {
  kind: AgentPlanKind;
  /** وصف مختصر لخطة التنفيذ. */
  summary: string;
  steps: AgentPlanStep[];
  /** هل تحتاج المهمة استدعاء مزود AI فعلياً؟ */
  requiresAi: boolean;
  /** هل تحتاج النتيجة موافقة بشرية قبل أي أثر خارجي؟ */
  requiresApproval: boolean;
  /** سبب اختيار هذه الخطة — يظهر للمالك. */
  reason: string;
}

const DIAGNOSE_RE = /(عطل|خطأ|مشكلة|لم يعمل|لا يعمل|تشخيص|فشل|سبب|لماذا|لم يتم|يتعذر|تعذّر)/;
const CONTENT_RE = /(محتوى|منشور|اكتب|صياغ|مسودة|إعلان|اعلان|كابشن|نص حملة|سكربت)/;
const ANALYSIS_RE = /(تحليل|أداء|احصائ|إحصائ|تفاعل|متابع|أفضل وقت|توصية|خطة|استراتيجية|حملة|تسويق|قياس)/;
const JOBS_RE = /(مهمة|مهام|جدول|جدولة|مجدول|طابور|نشر|موافقة|اعتماد)/;
const COMMENTS_RE = /(تعليق|تعليقات|رد|رسالة|رسائل|تفاعل العملاء|استفسار)/;
const VERIFY_RE = /(تحقق|فحص النظام|جاهز|سلامة|استمراري|persistence|صحة النظام)/;
const STATUS_RE = /(حالة|وضع|المنصات|متصل|الاتصال|ربط|oauth)/;
/** نية تشغيل YouTube الصريحة (اسم المنصة بالعربية أو الإنجليزية أو كلمات التشغيل). */
const YOUTUBE_RE = /(يوتيوب|قناة يوتيوب|فيديو يوتيوب|رفع فيديو|تعليقات يوتيوب)/;
const PLATFORM_IDS = ['tiktok', 'youtube', 'facebook', 'instagram', 'whatsapp', 'telegram', 'x', 'snapchat', 'threads', 'google_business'];
const PLATFORM_AR: Record<string, string> = {
  tiktok: 'تيك توك', youtube: 'يوتيوب', facebook: 'فيسبوك', instagram: 'انستغرام',
  whatsapp: 'واتساب', telegram: 'تلغرام', x: 'تويتر', snapchat: 'سناب', threads: 'ثريدز', google_business: 'جوجل',
};

/** أدوات مساعدة داخلية لبناء الخطوات (لا تُصدَّر). */
const labels: Record<string, string> = {
  system_health: 'فحص صحة النظام',
  platform_status: 'قراءة حالة المنصات',
  platform_readiness: 'قراءة مصفوفة جاهزية الكود',
  connection_status: 'قراءة حالة الاتصال والاعتماد',
  oauth_config: 'فحص إعداد OAuth بلا أسرار',
  workspace_summary: 'قراءة ملخّص مساحة العمل',
  jobs_list: 'قراءة قائمة المهام الداخلية',
  comments_list: 'قراءة التعليقات الواردة الحقيقية',
  campaigns_list: 'قراءة الحملات المحفوظة',
  content_plan: 'بناء خطة المحتوى الحتمية',
  marketing_decision: 'بناء قرار تسويقي حتمي',
  memory_snapshot: 'قراءة الذاكرة التشغيلية',
  system_verification: 'تشغيل تحقق النظام',
  job_create: 'إنشاء مهمة داخلية معلّقة للموافقة',
  job_approve: 'اعتماد مهمة داخلية',
  job_cancel: 'إلغاء مهمة داخلية',
  job_retry: 'إعادة محاولة مهمة',
  job_execute: 'تنفيذ خارجي عبر البوابات',
  ai_draft: 'توليد مسودة نصية بالذكاء الاصطناعي',
  youtube_status: 'قراءة حالة YouTube الصادقة',
  youtube_videos: 'قراءة فيديوهات YouTube الحقيقية',
  youtube_analytics: 'قراءة تحليلات YouTube الحقيقية',
  youtube_comments: 'قراءة تعليقات YouTube الحقيقية',
  youtube_learning: 'استخراج دروس التعلّم من أداء YouTube',
  youtube_reply: 'الرد الحقيقي على تعليق YouTube',
  youtube_publish: 'رفع فيديو حقيقي إلى YouTube',
};

function step(toolId: string, args: Record<string, any> = {}): AgentPlanStep {
  return { toolId, args, label: labels[toolId] || toolId };
}

/** هل الأداة موجودة في السجل فعلاً؟ نمنع خططاً لأدوات غير مسجّلة. */
function ensureKnown(plan: AgentPlan): AgentPlan {
  const known = new Set(AGENT_TOOLS.map((t) => t.id));
  plan.steps = plan.steps.filter((s) => known.has(s.toolId));
  return plan;
}

/** المنصات المذكورة صراحةً في نص المهمة (بالإنجليزية أو العربية). */
export function detectPlatforms(text: string): string[] {
  const t = text.toLowerCase();
  const found: string[] = [];
  for (const id of PLATFORM_IDS) {
    if (t.includes(id) || text.includes(PLATFORM_AR[id] || '')) found.push(id);
  }
  return found;
}

/** استخراج نص المهمة الفعلي (بعد إزالة كلمات الأمر الشائعة عند الحاجة). */
export function normalizeTask(task: string): string {
  return String(task || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
}

/**
 * يبني خطة حتمية من نص المهمة. الترتيب: تشخيص صريح > تحقق > تعليقات >
 * مهام > محتوى > تحليل > حالة > عام.
 */
export function buildAgentPlan(rawTask: string, options: { explicitKind?: AgentPlanKind; platformsHint?: string[] } = {}): AgentPlan {
  const task = normalizeTask(rawTask);
  const platforms = [...new Set([...(options.platformsHint || []), ...detectPlatforms(task)])];
  const kind = options.explicitKind || classifyIntent(task);

  switch (kind) {
    case 'diagnose': {
      const steps = [
        step('system_health'),
        step('platform_status'),
        ...platforms.map((p) => step('oauth_config', { platform: p })),
        step('connection_status'),
        step('system_verification'),
        // عند ذكر YouTube صراحةً نضيف أدواته التشغيلية الحقيقية للتشخيص الكامل.
        ...(platforms.includes('youtube') ? [step('youtube_status'), step('youtube_videos')] : []),
      ];
      return ensureKnown({
        kind,
        summary: 'تشخيص منهجي: صحة النظام → حالة المنصات → إعداد OAuth (بلا أسرار) → تحقق نهائي.',
        steps,
        requiresAi: false,
        requiresApproval: false,
        reason: 'المهمة تصف عطلاً أو تطلب سبباً؛ التشخيص حتمي ولا يحتاج مزود AI.',
      });
    }
    case 'verification': {
      return ensureKnown({
        kind,
        summary: 'تحقق مباشر: صحة النظام + تحقق الجاهزية/الاستمرارية.',
        steps: [step('system_health'), step('system_verification')],
        requiresAi: false,
        requiresApproval: false,
        reason: 'المهمة تطلب تحققاً؛ الأداة الحتمية الوحيدة تكفي.',
      });
    }
    case 'comments': {
      return ensureKnown({
        kind,
        summary: 'قراءة التعليقات/الرسائل الواردة الحقيقية وتلخيص حالتها.',
        steps: [step('comments_list', platforms[0] ? { platform: platforms[0] } : {}), step('workspace_summary')],
        requiresAi: false,
        requiresApproval: false,
        reason: 'التصنيف والقراءة حتميان محلياً؛ لا حاجة لمزود AI.',
      });
    }
    case 'jobs': {
      return ensureKnown({
        kind,
        summary: 'قراءة المهام الداخلية وحالتها؛ أي إنشاء مهمة يبقى معلّقاً للموافقة.',
        steps: [step('jobs_list'), step('platform_status'), step('job_create', { type: 'general', title: task })],
        requiresAi: false,
        requiresApproval: true,
        reason: 'المهام الداخلية تمر بمرحلة مراجعة/موافقة قبل أي تنفيذ.',
      });
    }
    case 'content': {
      return ensureKnown({
        kind,
        summary: 'خطة محتوى حتمية ثم توليد مسودة نصية واحدة بالذكاء الاصطناعي (محمي بالحصة).',
        steps: [step('content_plan', { platforms: platforms.join(','), focus: task }), step('ai_draft', { prompt: task })],
        requiresAi: true,
        requiresApproval: true,
        reason: 'صياغة النص تحتاج مزود AI؛ الباقي حتمي، وأي نشر يبقى بموافقة.',
      });
    }
    case 'analysis': {
      return ensureKnown({
        kind,
        summary: 'تحليل حتمي من السجلات الحقيقية + قرار تسويقي + خطة محتوى، بلا استهلاك AI إن كفى الواقع.',
        steps: [
          step('platform_status'),
          step('memory_snapshot'),
          // عند تحليل YouTube نضيف إحصاءاته ودروس تعلّمه الحقيقية.
          ...(platforms.includes('youtube') ? [step('youtube_analytics'), step('youtube_learning')] : []),
          step('marketing_decision', { objective: task }),
          step('content_plan', { platforms: platforms.join(','), focus: task }),
        ],
        requiresAi: false,
        requiresApproval: false,
        reason: 'قرارات التسويق مبنية على بيانات مسجّلة؛ لا نستهلك AI لتجنّب تكرار غير ضروري.',
      });
    }
    case 'status': {
      return ensureKnown({
        kind,
        summary: 'قراءة حالة المنصات وجاهزية الكود وملخّص مساحة العمل.',
        steps: [
          step('platform_status'),
          step('platform_readiness'),
          step('workspace_summary'),
          ...(platforms.includes('youtube') ? [step('youtube_status')] : []),
        ],
        requiresAi: false,
        requiresApproval: false,
        reason: 'حالة المنصات حتمية ولا تكلف حصة.',
      });
    }
    case 'youtube': {
      return ensureKnown({
        kind,
        summary: 'تشغيل YouTube: الحالة الصادقة → الفيديوهات → التحليلات → التعلّم، ثم مسودة محتوى واحدة عند الحاجة.',
        steps: [
          step('youtube_status'),
          step('youtube_videos'),
          step('youtube_analytics'),
          step('youtube_learning'),
          step('ai_draft', { prompt: task }),
        ],
        requiresAi: true,
        requiresApproval: false,
        reason: 'نية YouTube: قراءة حقيقية من Data API ثم مسودة نصية واحدة؛ أي رفع/رد خارجي يبقى بموافقة صريحة.',
      });
    }
    default: {
      return ensureKnown({
        kind: 'general',
        summary: 'قراءة الحالة العامة ثم توليد رد نصي واحد إن لزم.',
        steps: [step('system_health'), step('workspace_summary'), step('ai_draft', { prompt: task })],
        requiresAi: true,
        requiresApproval: false,
        reason: 'نية عامة: نمنح سياقاً واقعياً ثم نصيغ رداً واحداً.',
      });
    }
  }
}

/** تصنيف النية حتمياً من النص (بلا AI). */
export function classifyIntent(task: string): AgentPlanKind {
  const t = task.toLowerCase();
  if (VERIFY_RE.test(task)) return 'verification';
  if (DIAGNOSE_RE.test(task)) return 'diagnose';
  // نية YouTube الصريحة تتقدّم على التصنيف العام: المستخدم يريد تشغيل/تحليل يوتيوب.
  if (YOUTUBE_RE.test(task) || t.includes('youtube') || task.includes('يوتيوب')) return 'youtube';
  if (COMMENTS_RE.test(task)) return 'comments';
  if (CONTENT_RE.test(task)) return 'content';
  if (ANALYSIS_RE.test(task)) return 'analysis';
  if (JOBS_RE.test(task)) return 'jobs';
  if (STATUS_RE.test(task) || PLATFORM_IDS.some((p) => t.includes(p)) || Object.values(PLATFORM_AR).some((a) => task.includes(a))) return 'status';
  return 'general';
}

/** وصف معاملات أداة — تستخدمه الواجهة وتوثيق الأدوات. */
export function describeToolParameters(params: readonly AgentToolParameter[]): string {
  if (!params.length) return 'بلا معاملات';
  return params.map((p) => `${p.name}${p.required ? ' (مطلوب)' : ''}`).join('، ');
}
