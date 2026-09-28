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
  | 'youtube_cycle'
  | 'youtube_reply'
  | 'youtube_publish'
  | 'youtube_video_update'
  | 'general';

/**
 * مرجع حتمي إلى مخرَج خطوة سابقة. يُحلّ في المنسّق **وقت التنفيذ** من نتيجة
 * الخطوة الفعلية، فلا يُختلق videoId (أو أي معرّف) قبل وجود بيانات حقيقية.
 */
export interface AgentArgRef {
  /** معرّف أداة الخطوة السابقة التي يُقرأ مخرَجها. */
  fromTool: string;
  /** القائمة داخل مخرَجها (مثل videos). */
  listPath?: string;
  /**
   * مسار متداخل داخل مخرَج الخطوة السابقة (مثل `latestComment` في مخرَج
   * youtube_comments، أو `latestAnalysis` في مخرَج ai_draft). يُقرأ الحقل
   * (`field`) من هذا الكائن مباشرة. إن غاب المسار يُقرأ الحقل من جذر المخرَج.
   */
  outputPath?: string;
  /** الحقل داخل العنصر (مثل videoId) أو داخل كائن `outputPath`. */
  field: string;
  /**
   * `first` = أول قيمة غير فارغة فقط. `all` = كل القيم غير الفارغة (بترتيب
   * المصدر). `list` = تمرير العناصر الحقيقية كاملة (لتسليم نص التعليق لأداة
   * تحليل، بلا اختلاق عنصر). القيمة الفعلية يحدّدها منفّذ الأداة بحدّ أقصى صريح
   * لمنع أي استهلاك غير محدود للـAPI. لا قيمة مُصنّعة عند غياب البيانات.
   */
  pick?: 'first' | 'all';
  mode?: 'first' | 'all' | 'list';
  /**
   * مرجع إلى قيمة حقيقية من سياق المهمة (لا من مخرَج خطوة سابقة). يُستخدم في
   * المهام الصريحة التي يزوّد فيها المالك معرّفاً/نصاً فعلياً في جسم المهمة
   * (مثل commentId وtext لعملية رد مفوّضة). إن غابت القيمة يُعيد undefined
   * فتفشل الخطوة بـMISSING_ARGUMENT بدل تنفيذ عملية بمعرّف مُختلق.
   */
  fromContext?: string;
}

export interface AgentPlanStep {
  toolId: string;
  /** معاملات الأداة (قد تحمل مراجع تُحلّ من مخرَجات خطوات سابقة). */
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
/**
 * نية جلب/قراءة تعليقات YouTube الصريحة. نطلب كلمة تعليق (أو مرادفها) مع سياق
 * YouTube (عربي/إنجليزي) حتى لا تُشغَّل خطوة التعليقات في كل مهمة YouTube عامة
 * (توفيراً لاستدعاءات Data API).
 */
const YOUTUBE_COMMENTS_RE = /(اجلب|اقرأ|اعرض|حلل|راجع|اقترح|أظهر)?[^.]{0,30}(تعليق|تعليقات|ردود)[^.]{0,30}(يوتيوب|قناتي|الفيديو|فيديوهات|youtube)|(تعليقات\s*youtube)|(youtube)[^.]{0,30}(comments?)/i;
/** هل المهمة تطلب صراحةً جلب/قراءة تعليقات YouTube؟ (حتمي، بلا AI) */
export function wantsYouTubeComments(task: string): boolean {
  return YOUTUBE_COMMENTS_RE.test(String(task || ''));
}
/**
 * نية رد YouTube الصريحة: فعل **إرسال** (أرسل/انشر/ردّ على/علّق على) مع سياق
 * YouTube. لا يكفي «اقترح رداً» أو «اكتب رداً» لأنهما إعداد محتوى لا إرسال، فيبقى
 * ذلك في نية التعليقات (تحليل + مسودة) بلا عملية خارجية.
 */
// مصادر مفردات النية (مصدر واحد): القراءة والتحليل، توليد الرد، ثم التنفيذ/الإرسال.
// توسيعها ضروري كي لا يُحوَّل طلب صريح فيه «تحقق» أو «ولّد/نفّذ» إلى خطة قراءة فقط.
const YT_READ_VERB = 'اقرأ|اقرا|اجلب|أجلب|اعرض|راجع|حلّل|حلل|افحص|افتح';
const YT_COMMENT_WORD = 'تعليق|تعليقات|تعليقا|ردود|comment';
const YT_GEN_VERB = 'اقترح|أقترح|اقتراح|صيغ|صياغة|ولّد|ولد|أنشئ|انشئ|اكتب|جهّز|جهز|generate|draft|suggest';
const YT_SEND_VERB = 'أرسل|ارسل|ابعث|ابعت|انشر|نفّذ|نفذ|send|reply';
const YOUTUBE_REPLY_RE = new RegExp(`(${YT_SEND_VERB})[^.]{0,40}(يوتيوب|youtube|${YT_COMMENT_WORD})|(يوتيوب|youtube)[^.]{0,30}(أرسل|ارسل|ابعث|ابعث|انشر|نفّذ|نفذ|ردّ|reply)`, 'i');
/** أنماط الإعداد/الاقتراح: لا تُعتبر إرسالاً خارجياً بذاتها (الدورة الكاملة تُكتشف قبلها). */
const YOUTUBE_DRAFT_ONLY_RE = /(اقترح|اقتراح|صياغة|صغ|اكتب\s*رد|مسودة|جهّز\s*رد|جهز\s*رد|draft|suggest)/i;
/** فعل إرسال/تنفيذ صريح — وجوده يمنع اعتبار الطلب «اقتراحاً فقط». */
const YOUTUBE_EXPLICIT_SEND_RE = new RegExp(`(${YT_SEND_VERB})`, 'i');
/**
 * نية الدورة الكاملة: طلب صريح لقراءة تعليق حقيقي ثم تحليله ثم توليد/اقتراح رد ثم
 * **إرسال/تنفيذ** الرد على نفس التعليق. تشمل صيغاً متعددة (اقترح/ولّد/صيغ) وأفعال
 * إرسال متعددة (أرسل/نفّذ/ابعث/انشر) كي لا تُفلت صياغة المالك الفعلية.
 */
const YOUTUBE_FULL_CYCLE_RE = new RegExp(`(${YT_READ_VERB})[^.]{0,60}(${YT_COMMENT_WORD})[^.]{0,120}(${YT_GEN_VERB})[^.]{0,120}(${YT_SEND_VERB})|(${YT_COMMENT_WORD})[^.]{0,120}(${YT_GEN_VERB})[^.]{0,120}(${YT_SEND_VERB})`, 'i');
const YOUTUBE_SEND_SUGGESTED_RE = /(أرسل|ارسل|ابعث|ابعت|انشر|نفّذ|نفذ)[^.]{0,60}(الرد|رد)[^.]{0,30}(المقترح|المقترحة|الناتج|المولَّد|المولّد|الذي\s*اقترحت)|(أرسل|ارسل|ابعث|نفّذ|نفذ)[^.]{0,60}نفس\s*التعليق|(أرسل|ارسل|نفّذ|نفذ)[^.]{0,60}(الرد|رد)[^.]{0,60}على\s*(نفس\s*)?التعليق/i;
/** هل المهمة تطلب دورة YouTube كاملة: اقرأ → حلل → ولّد/اقترح → أرسل/نفّذ الرد؟ */
export function wantsYouTubeFullCycle(task: string): boolean {
  const t = String(task || '');
  return YOUTUBE_FULL_CYCLE_RE.test(t) || YOUTUBE_SEND_SUGGESTED_RE.test(t);
}
/**
 * دورة تعليق كاملة **بلا ذكر المنصّة** (اقرأ تعليقاً + حلّله + ولّد رداً + أرسل/
 * نفّذ الرد). تُوجَّه إلى دورة YouTube لأنها المسار التنفيذي الكامل المتاح، كي لا
 * يُختزل طلب تنفيذي صريح إلى مهمة قراءة/تحقق. تشترط فعل قراءة + تعليق + توليد +
 * إرسال معاً (لا يكفي «أرسل رداً» مجرّداً).
 */
const YOUTUBE_READ_CYCLE_RE = new RegExp(`(${YT_READ_VERB})[^.]{0,60}(${YT_COMMENT_WORD})[^.]{0,120}(${YT_GEN_VERB})[^.]{0,120}(${YT_SEND_VERB})`, 'i');
export function wantsYouTubeCommentCycle(task: string): boolean {
  const t = String(task || '');
  return YOUTUBE_READ_CYCLE_RE.test(t) && YOUTUBE_EXPLICIT_SEND_RE.test(t);
}
/** نية رفع/نشر فيديو YouTube الصريحة (تشمل الجدولة). */
const YOUTUBE_PUBLISH_RE = /(ارفع|حمّل|حمل|انشر|نشر|جدول|جدولة|publish|upload)[^.]{0,40}(فيديو|مقطع|video)[^.]{0,40}(يوتيوب|youtube)?|(يوتيوب|youtube)[^.]{0,40}(فيديو|video)[^.]{0,20}(ارفع|انشر|جدول|upload|publish)?/i;
/** نية تحديث بيانات فيديو YouTube الصريحة. */
const YOUTUBE_UPDATE_RE = /(حدّث|حدث|عدّل|عدل|غيّر|غير|update)[^.]{0,40}(بيانات|عنوان|وصف|وسوم|فيديو)[^.]{0,30}(يوتيوب|youtube)|(يوتيوب|youtube)[^.]{0,30}(update)/i;

/** هل المهمة تطلب صراحةً إرسال رد حقيقي على تعليق YouTube؟ */
export function wantsYouTubeReply(task: string): boolean {
  const t = String(task || '');
  // فعل إرسال/تنفيذ صريح يسبق أي اعتبار «اقتراح فقط» — فلا يُسقَط طلب الإرسال
  // لأنه يحتوي كلمة «اقترح» عرضاً.
  if (YOUTUBE_EXPLICIT_SEND_RE.test(t)) return true;
  if (YOUTUBE_DRAFT_ONLY_RE.test(t)) return false;
  return YOUTUBE_REPLY_RE.test(t);
}
/** هل المهمة تطلب صراحةً رفع/نشر/جدولة فيديو YouTube؟ */
export function wantsYouTubePublish(task: string): boolean {
  return YOUTUBE_PUBLISH_RE.test(String(task || ''));
}
/** هل المهمة تطلب صراحةً تحديث بيانات فيديو YouTube؟ */
export function wantsYouTubeVideoUpdate(task: string): boolean {
  return YOUTUBE_UPDATE_RE.test(String(task || ''));
}
/** استخراج معرّف تعليق YouTube من نص المهمة (يلزم وسم صريح: commentId أو «معرّف التعليق»). */
export function extractYouTubeCommentId(task: string): string | null {
  const m = String(task || '').match(/(?:commentId|معرّف\s*التعليق)\s*[:=]\s*([A-Za-z0-9_\-]{6,})/i);
  return m ? m[1] : null;
}
/** استخراج معرّف فيديو YouTube من نص المهمة (يلزم وسم صريح: videoId أو «معرّف الفيديو»). */
export function extractYouTubeVideoId(task: string): string | null {
  const m = String(task || '').match(/(?:videoId|معرّف\s*الفيديو)\s*[:=]\s*([A-Za-z0-9_\-]{6,})/i);
  return m ? m[1] : null;
}
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
  youtube_reply_verify: 'التحقق من تسليم الرد على YouTube',
  youtube_publish: 'رفع فيديو حقيقي إلى YouTube',
  youtube_video_update: 'تحديث بيانات فيديو YouTube',
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
    case 'youtube_cycle': {
      // دورة YouTube الكاملة في مهمة واحدة: قراءة التعليق الحقيقي → تحليله →
      // اقتراح رد عراقي → إرسال الرد المقترح إلى **نفس** التعليق → التحقق من
      // التسليم. معرّف التعليق ونص الرد يُحلّان وقت التنفيذ من مخرَجات الخطوات
      // السابقة الفعلية (لا من نص المهمة ولا اختلاق). الإرسال يبقى EXTERNAL_ACTION
      // فيُحجب داخل المهمة بلا تفويض تشغيل فعّال.
      const steps: AgentPlanStep[] = [
        step('youtube_status'),
        step('youtube_videos'),
        step('youtube_comments', { videoId: { fromTool: 'youtube_videos', listPath: 'videos', field: 'videoId', pick: 'all' } as AgentArgRef }),
        // التحليل حتمي من نص التعليق الحقيقي — بلا prompt فلا استهلاك AI ولا رد مُختلق
        // عند غياب تعليق (تفشل الخطوة بـMISSING_ARGUMENT صراحةً بدل توليد نص بلا مصدر).
        step('ai_draft', { comments: { fromTool: 'youtube_comments', listPath: 'comments', field: 'text', mode: 'list' } as AgentArgRef }),
        step('youtube_reply', {
          // معرّف التعليق الحقيقي فقط من أحدث تعليق جلبته youtube_comments.
          commentId: { fromTool: 'youtube_comments', outputPath: 'latestComment', field: 'commentId' } as AgentArgRef,
          // نص الرد المقترح فعلاً من مخرَج ai_draft (الرد العراقي الحتمي).
          text: { fromTool: 'ai_draft', outputPath: 'latestAnalysis', field: 'iraqiSuggestedReply' } as AgentArgRef,
          // نص التعليق الأصلي للتصنيف في السجل (من المصدر الحقيقي).
          commentText: { fromTool: 'youtube_comments', outputPath: 'latestComment', field: 'text' } as AgentArgRef,
        }),
        step('youtube_reply_verify', {
          commentId: { fromTool: 'youtube_comments', outputPath: 'latestComment', field: 'commentId' } as AgentArgRef,
          externalReplyId: { fromTool: 'youtube_reply', field: 'externalReplyId' } as AgentArgRef,
        }),
      ];
      return ensureKnown({
        kind,
        summary: 'دورة YouTube كاملة: الحالة → الفيديوهات → أحدث تعليق حقيقي (commentThreads.list) → تحليل واقتراح رد عراقي (ai_draft) → إرسال الرد المقترح إلى نفس التعليق (comments.insert) → التحقق من التسليم بمعرّف رد حقيقي.',
        steps,
        requiresAi: false,
        requiresApproval: true,
        reason: 'الرد الإرسالي عملية خارجية (comments.insert): معرّف التعليق ونص الرد يُحلّان من مخرَجات الخطوات الحقيقية، ويُحجب الإرسال بلا تفويض تشغيل YouTube فعّال، ولا يُعدّ الرد مُسلَّماً بلا معرّف رد من Google.',
      });
    }
    case 'youtube': {
      // طلب صريح للتعليقات: نضيف مسار قراءة حقيقي عبر videoId يُستخرج من نتيجة
      // youtube_videos الفعلية (مرجع وقت التنفيذ)، ثم نحلّل ونقترح رداً بلا إرسال.
      const wantsComments = wantsYouTubeComments(task);
      const steps: AgentPlanStep[] = [
        step('youtube_status'),
        step('youtube_videos'),
        ...(wantsComments
          ? [
              step('youtube_comments', { videoId: { fromTool: 'youtube_videos', listPath: 'videos', field: 'videoId', pick: 'all' } as AgentArgRef }),
              // نص التعليقات الحقيقي يُمرَّر إلى ai_draft عبر مرجع list من مخرَج
              // youtube_comments.comments (لا من نص المهمة) — بلا اختلاق عند غيابه.
              step('ai_draft', { prompt: task, comments: { fromTool: 'youtube_comments', listPath: 'comments', field: 'text', mode: 'list' } as AgentArgRef }),
            ]
          : [step('ai_draft', { prompt: task })]),
        step('youtube_analytics'),
        step('youtube_learning'),
      ];
      return ensureKnown({
        kind,
        summary: wantsComments
          ? 'تشغيل YouTube: الحالة → الفيديوهات → تعليقات الفيديو الأحدث (commentThreads.list) → تحليل نوع/مشاعر واقتراح رد عراقي عبر ai_draft → التحليلات → التعلّم، بلا إرسال.'
          : 'تشغيل YouTube: الحالة الصادقة → الفيديوهات → التحليلات → التعلّم، ثم مسودة محتوى واحدة عند الحاجة.',
        steps,
        requiresAi: true,
        requiresApproval: false,
        reason: wantsComments
          ? 'طلب صريح لتعليقات YouTube: قراءة حقيقية عبر commentThreads.list بمعرّف فيديو مستخرج من البيانات الفعلية (لا تعليق داخلي/وهمي)؛ أي رد خارجي يبقى EXTERNAL_ACTION بموافقة صريحة.'
          : 'نية YouTube: قراءة حقيقية من Data API ثم مسودة نصية واحدة؛ أي رفع/رد خارجي يبقى بموافقة صريحة.',
      });
    }
    case 'youtube_reply': {
      // رد حقيقي على تعليق YouTube: يمر عبر أداة EXTERNAL_ACTION. لا يُنفَّذ إلا
      // بموافقة صريحة أو تفويض تشغيل YouTube فعّال (يُحسم في المنسّق/الصلاحيات).
      // معرّف التعليق/نص الرد إما صريحان في نص المهمة أو من سياقها — لا اختلاق.
      const explicitCommentId = extractYouTubeCommentId(task);
      const args: Record<string, any> = { text: { fromContext: 'replyText' } as AgentArgRef };
      if (explicitCommentId) args.commentId = explicitCommentId;
      else args.commentId = { fromContext: 'commentId' } as AgentArgRef;
      return ensureKnown({
        kind,
        steps: [step('youtube_status'), step('youtube_reply', args)],
        summary: 'رد حقيقي على تعليق YouTube (comments.insert) عبر بوابة خارجية؛ لا يُنفَّذ إلا بموافقة صريحة أو تفويض تشغيل فعّال.',
        requiresAi: false,
        requiresApproval: true,
        reason: 'العملية خارجية (comments.insert)؛ النص ومعرّف التعليق يجب أن يكونا حقيقيين من نص المهمة أو سياقها، ولا إرسال بلا معرّف رد من YouTube.',
      });
    }
    case 'youtube_publish': {
      return ensureKnown({
        kind,
        steps: [step('youtube_status'), step('youtube_publish', { title: { fromContext: 'videoTitle' } as AgentArgRef, description: { fromContext: 'videoDescription' } as AgentArgRef, publishAt: { fromContext: 'publishAt' } as AgentArgRef, videoBase64: { fromContext: 'videoBase64' } as AgentArgRef })],
        summary: 'رفع فيديو حقيقي إلى YouTube (videos.insert resumable) — نشر فوري أو جدولة؛ بوابة خارجية بموافقة/تفويض.',
        requiresAi: false,
        requiresApproval: true,
        reason: 'العملية خارجية (videos.insert)؛ تحتاج بايتات فيديو فعلية، ولا تُسجَّل نشراً بلا معرّف فيديو من YouTube.',
      });
    }
    case 'youtube_video_update': {
      const explicitVideoId = extractYouTubeVideoId(task);
      const args: Record<string, any> = { title: { fromContext: 'videoTitle' } as AgentArgRef, description: { fromContext: 'videoDescription' } as AgentArgRef };
      if (explicitVideoId) args.videoId = explicitVideoId;
      else args.videoId = { fromContext: 'videoId' } as AgentArgRef;
      return ensureKnown({
        kind,
        steps: [step('youtube_status'), step('youtube_video_update', args)],
        summary: 'تحديث بيانات فيديو YouTube (videos.update) — عنوان/وصف؛ بوابة خارجية بموافقة/تفويض.',
        requiresAi: false,
        requiresApproval: true,
        reason: 'العملية خارجية (videos.update) على فيديو مملوك للقناة؛ تحتاج معرّف فيديو وعنواناً حقيقيين.',
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
  const isYt = t.includes('youtube') || task.includes('يوتيوب');
  // عمليات YouTube الخاصة تتقدّم على التصنيف العام **قبل** فحص «تحقق/تشخيص»، لأن
  // طلب الدورة الكاملة يحمل كلمة «تحقق» عرضاً (تحقق من وصول الرد) فلا يجوز أن
  // يُختزل إلى مهمة تحقق من النظام. الرد/الدورة صريحان (فعل إرسال/تنفيذ).
  if (YOUTUBE_UPDATE_RE.test(task) && isYt) return 'youtube_video_update';
  if (YOUTUBE_PUBLISH_RE.test(task) && isYt) return 'youtube_publish';
  if (wantsYouTubeFullCycle(task) && isYt) return 'youtube_cycle';
  if (wantsYouTubeReply(task) && isYt) return 'youtube_reply';
  // نية YouTube الصريحة (تعليقات/تحليل/حالة) قبل «تحقق النظام»: المذكور يوتيوب صراحةً.
  if (YOUTUBE_RE.test(task) || isYt) return 'youtube';
  // دورة تعليق كاملة بلا ذكر المنصّة: طلب تنفيذي صريح (اقرأ+تعليق+ولّد+أرسل) لا
  // يجوز اختزاله إلى «تحقق/تشخيص». تُوجَّه لدورة YouTube الكاملة.
  if (wantsYouTubeCommentCycle(task)) return 'youtube_cycle';
  // دورة كاملة بلا ذكر المنصّة لكن بذكر «يوتيوب» غائب: لا تُختزل إلى قراءة.
  if (wantsYouTubeFullCycle(task) && !VERIFY_RE.test(task)) return 'youtube_cycle';
  if (VERIFY_RE.test(task)) return 'verification';
  if (DIAGNOSE_RE.test(task)) return 'diagnose';
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
