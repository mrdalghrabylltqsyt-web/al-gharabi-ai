/**
 * سجل أدوات العقل المركزي.
 *
 * المصدر الواحد لكل أداة: معرّف + وصف عربي + مستوى صلاحية + معاملات + منفّذ
 * حقيقي مربوط بوظائف الخادم المحقونة (`AgentToolContext`). لا تُعلن أي قدرة
 * غير موجودة فعلاً، ولا تُختلق نتيجة: كل منفّذ يعيد بيانات من الخادم أو حالة
 * `unavailable` صريحة بدل قيمة وهمية.
 *
 * منطق خالص بلا express وبلا شبكة: قابل للاختبار بتشغيل المنفّذات على سياق وهمي.
 */

import type { ToolPermission } from './permissions';
import { classifyComment, buildDeterministicReply, type ClassifiedComment } from '../social/comments';

export interface AgentToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
}

export interface AgentToolResult {
  ok: boolean;
  /** نتيجة مختصرة قابلة للتسلسل — بلا أي سرّ. */
  data?: unknown;
  error?: string;
  /** كود تصنيف آمن عند الفشل (يمنع الالتباس مع النجاح). */
  code?: string;
}

export interface AgentToolContext {
  operator: 'staff' | 'owner' | 'system';
  userId: string;
  /** لقطة صحة النظام (بلا أسرار). */
  healthSnapshot: () => any;
  /** حالات المنصات الجامعة (control plane). */
  platformStatuses: () => any[];
  /** تفاصيل جاهزية الكود لكل منصة. */
  readinessMatrix: () => any;
  /** حالة الاتصال + آلية الاعتماد + وجود موصل حقيقي لكل منصة. */
  connectionStatus: () => any[];
  /** أسماء متغيرات الاعتماد الحاضرة/الغائبة لكل منصة (بلا قيم). */
  credentialIntrospection: (platform: string) => any;
  /** ملخّص مساحة العمل الحقيقي. */
  workspaceSummary: () => any;
  /** قائمة المهام الداخلية (تصفية حسب الدور). */
  listJobs: () => any[];
  /** إنشاء مهمة داخلية (معلّقة للموافقة). */
  createJob: (input: { type: string; platform?: string; title?: string; scheduledFor?: string; payload?: any }) => any;
  /** موافقة المالك على مهمة. */
  approveJob: (id: string) => any;
  cancelJob: (id: string) => any;
  retryJob: (id: string) => any;
  /** تنفيذ خارجي حقيقي — مرحّل عبر بوابات النشر الفعلية. */
  executeJob: (id: string) => Promise<any>;
  /** التعليقات الواردة الحقيقية (من webhook فقط). */
  listComments: (platform?: string) => any[];
  /** الحملات التسويقية المحفوظة. */
  listCampaigns: () => any[];
  /** خطة أسبوعية حتمية (لا تستهلك AI). */
  buildWeekPlan: (platforms: string[], focus: string) => any;
  /** قرار تسويقي حتمي مبني على سجلات حقيقية. */
  marketingDecision: (input?: any) => any;
  /** لقطة الذاكرة التشغيلية. */
  memorySnapshot: () => any;
  /** حالة نظام التحقق/الجاهزية العامة. */
  systemVerification: () => any;
  /** استدعاء مزود الذكاء الاصطناعي عند الحاجة فقط (محمي بالحصة والذاكرة). */
  aiGenerate: (prompt: string, opts?: { json?: boolean }) => Promise<{ text: string; usedProvider: boolean; source: string }>;
  // --- YouTube (المنصة التشغيلية الأساسية) ---
  /** حالة YouTube الصادقة (حالة/سبب/إجراء تالٍ/وضع YouTube-only). */
  youtubeStatus: () => any;
  /** قائمة فيديوهات القناة الحقيقية (playlistItems + videos). */
  youtubeVideos: () => Promise<{ ok: boolean; videos?: any[]; error?: string; code?: string | null }>;
  /** إحصاءات القناة والفيديو + تحليل جمهور من المؤشرات المتاحة فعلاً. */
  youtubeAnalytics: () => Promise<{ ok: boolean; summary?: any; audience?: any; channel?: any; error?: string; code?: string | null }>;
  /**
   * قراءة تعليقات فيديو/فيديوهات حقيقية (commentThreads.list - order=time) وتخزينها.
   * تقبل معرّفاً أو مجموعة معرّفات، وتبحث عن أحدث تعليق فعلي بينها بحدّ ثابت.
   */
  youtubeComments: (videoIds: string | string[]) => Promise<{ ok: boolean; comments?: any[]; latestComment?: any | null; scannedVideoIds?: string[]; videosScanned?: number; inserted?: number; duplicates?: number; error?: string; code?: string | null }>;
  /** حلقة التعلّم لـYouTube (دروس مع مصدرها وحدودها). */
  youtubeLearning: () => Promise<{ ok: boolean; learning?: any; error?: string; code?: string | null }>;
  /** الرد الحقيقي على تعليق YouTube (comments.insert) — عملية خارجية تتطلب موافقة. */
  youtubeReply: (input: { commentId: string; text: string; commentText?: string }) => Promise<any>;
  /** التحقق من تسجيل رد حقيقي مُسلَّم على تعليق (من سجل الردود الفعلي، بلا سرّ). */
  youtubeReplyVerify: (input: { commentId: string; externalReplyId?: string | null }) => Promise<{ real: boolean; record?: any; note: string }>;
  /** رفع فيديو حقيقي إلى YouTube (videos.insert) — عملية خارجية تتطلب موافقة. */
  youtubePublish: (input: { title: string; description?: string; tags?: string[]; privacyStatus?: string; publishAt?: string | null; videoBase64?: string; mimeType?: string; approved?: boolean }) => Promise<any>;
  /** تحديث بيانات فيديو مملوك للقناة (videos.update) — عملية خارجية تتطلب موافقة. */
  youtubeVideoUpdate: (input: { videoId: string; title: string; description?: string; tags?: string[]; privacyStatus?: string }) => Promise<any>;
  /**
   * تقييم تفويض تشغيل YouTube لعملية خارجية. يعيد السماح فقط إن كان التفويض
   * فعّالاً ويشمل العملية المطلوبة. يُحقن من الخادم (مصدر التفويض) ولا يُختلق هنا.
   */
  delegationCheck?: (input: { toolId: string; args: Record<string, any> }) => { allowed: boolean; code?: string; reason?: string };
}

export interface AgentTool {
  id: string;
  name: string;
  description: string;
  permission: ToolPermission;
  parameters: AgentToolParameter[];
  /** منفّذ الأداة — قد يكون متزامناً أو غير متزامن؛ المنسّق يوحّده عبر Promise.resolve. */
  run: (args: Record<string, any>, ctx: AgentToolContext) => AgentToolResult | Promise<AgentToolResult>;
}

function read<T>(fn: () => T): AgentToolResult {
  try {
    return { ok: true, data: fn() };
  } catch (e: any) {
    return { ok: false, code: 'TOOL_EXECUTION_FAILED', error: String(e?.message || e).slice(0, 200) };
  }
}

/** عنصر تعليق حقيقي وحيد الشكل لدخول التحليل (لا اختلاق عند غياب الحقول). */
interface CommentInput {
  commentId: string | null;
  videoId: string | null;
  text: string;
  authorName: string | null;
  publishedAt: string | null;
}

/** يحوّل مدخل التعليقات (نصوص أو كائنات) إلى عناصر وحيدة الشكل، ويُسقط الفارغ. */
function normalizeCommentsInput(input: any): CommentInput[] {
  const arr = Array.isArray(input) ? input : (input ? [input] : []);
  const out: CommentInput[] = [];
  for (const it of arr) {
    if (typeof it === 'string') {
      if (it.trim()) out.push({ commentId: null, videoId: null, text: it, authorName: null, publishedAt: null });
      continue;
    }
    if (it && typeof it === 'object') {
      const text = String(it.text || '').trim();
      if (text) out.push({
        commentId: it.commentId ? String(it.commentId) : null,
        videoId: it.videoId ? String(it.videoId) : null,
        text,
        authorName: it.authorName ? String(it.authorName) : null,
        publishedAt: it.publishedAt ? String(it.publishedAt) : null,
      });
    }
  }
  return out;
}

/** تصنيف حتمي: نوع التعليق + المشاعر + رد مقترح باللهجة العراقية (بلا إرسال). */
function analyzeCommentInput(c: CommentInput): {
  commentId: string | null; videoId: string | null; text: string; authorName: string | null; publishedAt: string | null;
  type: string; typeAr: string; sentiment: string; sentimentAr: string;
  requiresHumanReview: boolean; iraqiSuggestedReply: string; willAutoSend: false;
} {
  const cls: ClassifiedComment = classifyComment(c.text);
  return {
    commentId: c.commentId, videoId: c.videoId, text: c.text, authorName: c.authorName, publishedAt: c.publishedAt,
    type: cls.intent, typeAr: TYPE_AR[cls.intent] || cls.intent,
    sentiment: cls.sentiment, sentimentAr: SENTIMENT_AR[cls.sentiment] || cls.sentiment,
    requiresHumanReview: cls.requiresHumanReview,
    iraqiSuggestedReply: iraqiReply(cls),
    willAutoSend: false,
  };
}

const TYPE_AR: Record<string, string> = {
  question: 'سؤال', complaint: 'شكوى', praise: 'مدح', business_inquiry: 'استفسار تجاري', spam: 'سبام', other: 'أخرى',
};
const SENTIMENT_AR: Record<string, string> = { positive: 'إيجابية', negative: 'سلبية', neutral: 'محايدة' };

/**
 * صياغة الرد المقترح باللهجة العراقية — حتمية بالكامل من `buildDeterministicReply`
 * (يُضاف إليه خِتام عراقي). لا تُرسل أي رد ولا تعتمد على مزود خارجي، فلا يتأثر
 * التحليل بفشل المزود ولا يُختلق نص بلا بيانات.
 */
function iraqiReply(cls: ClassifiedComment): string {
  const base = buildDeterministicReply(cls);
  const closure = cls.sentiment === 'negative'
    ? 'وأكيد نتعامل وياك بجدية.'
    : 'وتدلل، آني بخدمتك.';
  return `${base} ${closure}`;
}

export const AGENT_TOOLS: ReadonlyArray<AgentTool> = [
  {
    id: 'system_health',
    name: 'فحص صحة النظام',
    description: 'يعيد نسخة صحة الخادم (الإصدار، المخزن الدائم، حالة المنصات المتصلة، حماية Gemini) بلا أي سرّ.',
    permission: 'READ',
    parameters: [],
    run: (_args, ctx) => read(() => ctx.healthSnapshot()),
  },
  {
    id: 'platform_status',
    name: 'حالة المنصات',
    description: 'الحالة الجامعة لكل منصة (CODE_READY/CONFIGURED/CONNECTED/VERIFIED/OPERATIONAL) مع سبب الحجب والإجراء التالي.',
    permission: 'READ',
    parameters: [{ name: 'platform', type: 'string', required: false, description: 'منصة محدّدة (اختياري).' }],
    run: (args, ctx) =>
      read(() => {
        const all = ctx.platformStatuses();
        return args.platform ? all.filter((p) => p.platform === args.platform) : all;
      }),
  },
  {
    id: 'platform_readiness',
    name: 'مصفوفة جاهزية الكود',
    description: 'جاهزية الكود لكل منصة وقدراتها وwebhook/oauth (بلا حالة اتصال تشغيلية).',
    permission: 'READ',
    parameters: [],
    run: (_args, ctx) => read(() => ctx.readinessMatrix()),
  },
  {
    id: 'connection_status',
    name: 'حالة الاتصال والاعتماد',
    description: 'حالة الاتصال الحية وآلية الاعتماد الرسمية وهل يوجد موصل حقيقي منفّذ، لكل منصة.',
    permission: 'READ',
    parameters: [],
    run: (_args, ctx) => read(() => ctx.connectionStatus()),
  },
  {
    id: 'oauth_config',
    name: 'فحص إعداد OAuth (بلا أسرار)',
    description: 'أسماء متغيرات الاعتماد الحاضرة/الغائبة لمنصة، بلا أي قيمة سرّية.',
    permission: 'READ',
    parameters: [{ name: 'platform', type: 'string', required: true, description: 'معرّف المنصة.' }],
    run: (args, ctx) =>
      args.platform
        ? read(() => ctx.credentialIntrospection(String(args.platform)))
        : Promise.resolve({ ok: false, code: 'MISSING_ARGUMENT', error: 'platform مطلوب.' }),
  },
  {
    id: 'workspace_summary',
    name: 'ملخّص مساحة العمل',
    description: 'أعداد المنتجات/الأقساط/المنشورات/المحادثات/العملاء/المهام ومنصات متصلة — بيانات حقيقية.',
    permission: 'READ',
    parameters: [],
    run: (_args, ctx) => read(() => ctx.workspaceSummary()),
  },
  {
    id: 'jobs_list',
    name: 'قائمة المهام الداخلية',
    description: 'مهام النشر/التشغيل الداخلية وحالتها (queued/approved/ready/executed/failed).',
    permission: 'READ',
    parameters: [{ name: 'status', type: 'string', required: false, description: 'تصفية بالحالة (اختياري).' }],
    run: (args, ctx) =>
      read(() => {
        const jobs = ctx.listJobs();
        return args.status ? jobs.filter((j: any) => j.status === args.status) : jobs;
      }),
  },
  {
    id: 'comments_list',
    name: 'التعليقات الواردة الحقيقية',
    description: 'التعليقات المستلمة فعلياً عبر webhooks موقّعة (لا تعليقات مختلقة) مع تصنيفها الحتمي.',
    permission: 'READ',
    parameters: [{ name: 'platform', type: 'string', required: false, description: 'منصة محدّدة (اختياري).' }],
    run: (args, ctx) =>
      read(() => {
        const items = ctx.listComments(args.platform ? String(args.platform) : undefined);
        return { count: items.length, items: items.slice(0, 50) };
      }),
  },
  {
    id: 'campaigns_list',
    name: 'الحملات التسويقية',
    description: 'الحملات المحفوظة فعلاً في النظام مع حالتها.',
    permission: 'READ',
    parameters: [],
    run: (_args, ctx) => read(() => ctx.listCampaigns()),
  },
  {
    id: 'content_plan',
    name: 'خطة المحتوى الأسبوعية',
    description: 'خطة أسبوعية حتمية (لا تستهلك Gemini) للوحدات المتصلة المحدّدة.',
    permission: 'READ',
    parameters: [
      { name: 'platforms', type: 'string', required: false, description: 'قائمة منصات مفصولة بفواصل؛ افتراضياً المتصلة.' },
      { name: 'focus', type: 'string', required: false, description: 'محور التركيز.' },
    ],
    run: (args, ctx) =>
      read(() => {
        const platforms = typeof args.platforms === 'string' && args.platforms.trim()
          ? args.platforms.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [];
        return ctx.buildWeekPlan(platforms, String(args.focus || 'منتجات المعرض وخدمات التقسيط'));
      }),
  },
  {
    id: 'marketing_decision',
    name: 'قرار تسويقي (حتمي)',
    description: 'قرار تسويقي مبني على سجلات الأداء الحقيقية فقط، ويعلن الفجوات إن كانت البيانات ناقصة.',
    permission: 'READ',
    parameters: [{ name: 'objective', type: 'string', required: false, description: 'هدف الحملة (اختياري).' }],
    run: (args, ctx) => read(() => ctx.marketingDecision({ objective: args.objective })),
  },
  {
    id: 'memory_snapshot',
    name: 'الذاكرة التشغيلية',
    description: 'لقطة الذاكرة التشغيلية للسوشيال ميديا من السجلات الحقيقية.',
    permission: 'READ',
    parameters: [],
    run: (_args, ctx) => read(() => ctx.memorySnapshot()),
  },
  {
    id: 'system_verification',
    name: 'تحقق النظام',
    description: 'نتيجة تحقق عام (جاهزية التطبيق + المخزن الدائم) بلا أي سرّ.',
    permission: 'EXECUTE',
    parameters: [],
    run: (_args, ctx) => read(() => ctx.systemVerification()),
  },
  {
    id: 'job_create',
    name: 'إنشاء مهمة داخلية',
    description: 'ينشئ مهمة داخلية معلّقة للمراجعة والموافقة. لا ينفّذ أي عملية خارجية.',
    permission: 'WRITE',
    parameters: [
      { name: 'type', type: 'string', required: true, description: 'نوع المهمة (publish/reply/schedule/...).' },
      { name: 'platform', type: 'string', required: false, description: 'المنصة.' },
      { name: 'title', type: 'string', required: false, description: 'عنوان المهمة.' },
      { name: 'scheduledFor', type: 'string', required: false, description: 'وقت الجدولة (جدار زمني محلي).' },
    ],
    run: (args, ctx) =>
      args.type
        ? read(() => ctx.createJob({ type: String(args.type), platform: args.platform, title: args.title, scheduledFor: args.scheduledFor }))
        : Promise.resolve({ ok: false, code: 'MISSING_ARGUMENT', error: 'type مطلوب.' }),
  },
  {
    id: 'job_approve',
    name: 'اعتماد مهمة داخلية',
    description: 'اعتماد مهمة داخلية (للمالك فقط). لا يعني تنفيذاً خارجياً.',
    permission: 'SENSITIVE',
    parameters: [{ name: 'id', type: 'string', required: true, description: 'معرّف المهمة.' }],
    run: (args, ctx) =>
      args.id
        ? read(() => ctx.approveJob(String(args.id)))
        : Promise.resolve({ ok: false, code: 'MISSING_ARGUMENT', error: 'id مطلوب.' }),
  },
  {
    id: 'job_cancel',
    name: 'إلغاء مهمة داخلية',
    description: 'إلغاء مهمة داخلية قبل التنفيذ.',
    permission: 'WRITE',
    parameters: [{ name: 'id', type: 'string', required: true, description: 'معرّف المهمة.' }],
    run: (args, ctx) =>
      args.id
        ? read(() => ctx.cancelJob(String(args.id)))
        : Promise.resolve({ ok: false, code: 'MISSING_ARGUMENT', error: 'id مطلوب.' }),
  },
  {
    id: 'job_retry',
    name: 'إعادة محاولة مهمة',
    description: 'إعادة فتح مهمة فاشلة لإعادة المعالجة.',
    permission: 'WRITE',
    parameters: [{ name: 'id', type: 'string', required: true, description: 'معرّف المهمة.' }],
    run: (args, ctx) =>
      args.id
        ? read(() => ctx.retryJob(String(args.id)))
        : Promise.resolve({ ok: false, code: 'MISSING_ARGUMENT', error: 'id مطلوب.' }),
  },
  {
    id: 'job_execute',
    name: 'تنفيذ مهمة خارجية (عبر البوابات)',
    description: 'تنفيذ خارجي حقيقي لمهمة معتمدة — يمر ببوابات النشر الفعلية ولا يدّعي تسليماً بلا إثبات مزود. يتطلب موافقة.',
    permission: 'EXTERNAL_ACTION',
    parameters: [{ name: 'id', type: 'string', required: true, description: 'معرّف المهمة المعتمدة.' }],
    run: async (args, ctx) => {
      if (!args.id) return { ok: false, code: 'MISSING_ARGUMENT', error: 'id مطلوب.' };
      try {
        return { ok: true, data: await ctx.executeJob(String(args.id)) };
      } catch (e: any) {
        return { ok: false, code: 'TOOL_EXECUTION_FAILED', error: String(e?.message || e).slice(0, 200) };
      }
    },
  },
  {
    id: 'ai_draft',
    name: 'توليد محتوى بالذكاء الاصطناعي',
    description: 'يولّد مسودة نصية، وعند تلقّي تعليقات حقيقية يصنّفها ويحدّد المشاعر ويقترح رداً باللهجة العراقية (بلا إرسال). لا يُستخدم للعمليات الحتمية.',
    permission: 'EXECUTE',
    parameters: [
      { name: 'prompt', type: 'string', required: false, description: 'نص الطلب.' },
      { name: 'comments', type: 'string', required: false, description: 'تعليقات حقيقية (عناصر أو نصوص) للتحليل واقتراح الرد.' },
    ],
    run: async (args, ctx) => {
      // مسار تحليل التعليقات: حتمي بالكامل (تصنيف + مشاعر + رد عراقي مقترح)،
      // ولا يُرسل أي شيء ولا يستهلك مزود AI، فلا يمنع فشل المزود التحليل.
      const comments = normalizeCommentsInput(args.comments);
      if (comments.length) {
        const analyzed = comments.map((c) => analyzeCommentInput(c));
        const latest = analyzed[0] || null;
        return {
          ok: true,
          data: {
            kind: 'comment_analysis',
            count: analyzed.length,
            analyzed,
            latestCommentText: latest?.text ?? null,
            latestAnalysis: latest ?? null,
            willAutoSend: false,
            note: 'تصنيف ومشاعر ورد مقترح باللهجة العراقية — لم يُرسل أي رد؛ الإرسال عملية خارجية تتطلب موافقة صريحة عبر بوابة youtube_reply.',
          },
        };
      }
      if (!args.prompt) return { ok: false, code: 'MISSING_ARGUMENT', error: 'prompt أو comments مطلوب.' };
      try {
        const res = await ctx.aiGenerate(String(args.prompt).slice(0, 4000));
        return { ok: true, data: res };
      } catch (e: any) {
        return { ok: false, code: 'AI_PROVIDER_FAILED', error: String(e?.message || e).slice(0, 200) };
      }
    },
  },
  // --- أدوات YouTube التشغيلية (المنصة الأساسية) ---
  {
    id: 'youtube_status',
    name: 'حالة YouTube',
    description: 'الحالة الصادقة لموصل YouTube (حالة/سبب/إجراء تالٍ) ووضع YOUTUBE_ONLY_OPERATIONAL — بلا أي سرّ.',
    permission: 'READ',
    parameters: [],
    run: (_args, ctx) => read(() => ctx.youtubeStatus()),
  },
  {
    id: 'youtube_videos',
    name: 'قائمة فيديوهات YouTube',
    description: 'قائمة فيديوهات القناة الحقيقية مع الإحصاءات (playlistItems + videos.list) من YouTube Data API. تُعيد أحدث معرّف فيديو حقيقي لتمريره لخطوة التعليقات.',
    permission: 'READ',
    parameters: [],
    run: async (_args, ctx) => {
      try {
        const r = await ctx.youtubeVideos();
        if (!r.ok) return { ok: false, code: r.code || 'YOUTUBE_FETCH_FAILED', error: r.error };
        const videos = r.videos || [];
        // أحدث فيديو حقيقي فقط — لا معرّف مُختلق عند غياب الفيديوهات.
        const latest = videos.find((v: any) => v && v.videoId) || null;
        return { ok: true, data: { count: videos.length, latestVideoId: latest ? latest.videoId : null, latestVideoTitle: latest ? latest.title ?? null : null, videos } };
      } catch (e: any) { return { ok: false, code: 'TOOL_EXECUTION_FAILED', error: String(e?.message || e).slice(0, 200) }; }
    },
  },
  {
    id: 'youtube_analytics',
    name: 'تحليلات YouTube',
    description: 'إحصاءات القناة والفيديو + تحليل جمهور من المؤشرات المتاحة فعلاً فقط (بلا بيانات سكانية مُختلقة).',
    permission: 'READ',
    parameters: [],
    run: async (_args, ctx) => {
      try {
        const r = await ctx.youtubeAnalytics();
        return r.ok ? { ok: true, data: { summary: r.summary, audience: r.audience, channel: r.channel } } : { ok: false, code: r.code || 'YOUTUBE_ANALYTICS_FAILED', error: r.error };
      } catch (e: any) { return { ok: false, code: 'TOOL_EXECUTION_FAILED', error: String(e?.message || e).slice(0, 200) }; }
    },
  },
  {
    id: 'youtube_comments',
    name: 'تعليقات YouTube',
    description: 'قراءة تعليقات حقيقية (commentThreads.list - order=time) لمجموعة من أحدث الفيديوهات الحقيقية، ثم إرجاع أحدث تعليق فعلي بينها. لا تعليق مُختلق.',
    permission: 'READ',
    parameters: [
      { name: 'videoId', type: 'string', required: false, description: 'معرّف فيديو واحد (اختياري).' },
      { name: 'videoIds', type: 'string', required: false, description: 'معرّفات فيديوهات مفصولة بفواصل (اختياري — يُفحَص بحدّ ثابت للعثور على أحدث تعليق).' },
    ],
    run: async (args, ctx) => {
      // نقبل معرّفاً واحداً أو مجموعة؛ لا قيمة مُصنّعة عند غياب المعرّفات.
      const ids: string[] = Array.isArray(args.videoIds)
        ? args.videoIds.map((v: any) => String(v)).filter(Boolean)
        : String(args.videoIds || args.videoId || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!ids.length) return { ok: false, code: 'MISSING_ARGUMENT', error: 'videoId/videoIds مطلوب.' };
      try {
        const r = await ctx.youtubeComments(ids);
        if (!r.ok) return { ok: false, code: r.code || 'YOUTUBE_COMMENTS_FAILED', error: r.error };
        return {
          ok: true,
          data: {
            scannedVideoIds: r.scannedVideoIds || ids,
            videosScanned: r.videosScanned ?? ids.length,
            count: r.comments?.length || 0,
            inserted: r.inserted || 0,
            duplicates: r.duplicates || 0,
            // أحدث تعليق حقيقي عبر كل الفيديوهات المفحوصة (مرتّب زمنياً عند المصدر).
            latestComment: r.latestComment || null,
            comments: (r.comments || []).slice(0, 50).map((c: any) => ({ commentId: c.commentId, videoId: c.videoId ?? null, text: c.text, authorName: c.authorName ?? null, publishedAt: c.publishedAt ?? null })),
          },
        };
      } catch (e: any) { return { ok: false, code: 'TOOL_EXECUTION_FAILED', error: String(e?.message || e).slice(0, 200) }; }
    },
  },
  {
    id: 'youtube_learning',
    name: 'تعلّم YouTube',
    description: 'حلقة تعلّم: تقارن أداء الفيديوهات وتُنتج دروساً مع مصدرها وحجم عيّنتها وحدودها.',
    permission: 'READ',
    parameters: [],
    run: async (_args, ctx) => {
      try {
        const r = await ctx.youtubeLearning();
        return r.ok ? { ok: true, data: r.learning } : { ok: false, code: r.code || 'YOUTUBE_LEARNING_FAILED', error: r.error };
      } catch (e: any) { return { ok: false, code: 'TOOL_EXECUTION_FAILED', error: String(e?.message || e).slice(0, 200) }; }
    },
  },
  {
    id: 'youtube_reply',
    name: 'الرد على تعليق YouTube',
    description: 'رد حقيقي على تعليق YouTube (comments.insert). عملية خارجية تتطلب موافقة صريحة أو تفويض تشغيل فعّال، ولا تُنفَّذ من مهمة تلقائية بلا ذلك.',
    permission: 'EXTERNAL_ACTION',
    parameters: [
      { name: 'commentId', type: 'string', required: true, description: 'معرّف التعليق لدى YouTube.' },
      { name: 'text', type: 'string', required: true, description: 'نص الرد.' },
      { name: 'commentText', type: 'string', required: false, description: 'نص التعليق الأصلي (لتصنيفه في السجل).' },
    ],
    run: async (args, ctx) => {
      if (!args.commentId || !args.text) return { ok: false, code: 'MISSING_ARGUMENT', error: 'commentId وtext مطلوبان.' };
      try {
        const data = await ctx.youtubeReply({ commentId: String(args.commentId), text: String(args.text), commentText: args.commentText });
        // لا يُعدّ الرد مُسلَّماً بلا معرّف رد حقيقي من YouTube وحالة sent.
        if (!data?.externalReplyId || !data?.delivered) {
          return { ok: false, code: 'REPLY_NOT_DELIVERED', error: 'لم يُعِد YouTube معرّف رد حقيقي؛ لا يُسجَّل تسليم.' };
        }
        return { ok: true, data };
      } catch (e: any) { return { ok: false, code: 'TOOL_EXECUTION_FAILED', error: String(e?.message || e).slice(0, 200) }; }
    },
  },
  {
    id: 'youtube_reply_verify',
    name: 'التحقق من تسليم الرد على YouTube',
    description: 'يتحقّق من أن رداً حقيقياً سُجِّل مُسلَّماً على تعليق محدد (بمعرّف رد حقيقي من المزوّد) بمقارنة معرّف التعليق ومعرّف الرد من سجل الردود الفعلي. قراءة فقط بلا سرّ.',
    permission: 'READ',
    parameters: [
      { name: 'commentId', type: 'string', required: true, description: 'معرّف التعليق الذي رُدّ عليه.' },
      { name: 'externalReplyId', type: 'string', required: false, description: 'معرّف الرد المتوقّع من المزوّد (لمطابقته مع السجل).' },
    ],
    run: async (args, ctx) => {
      if (!args.commentId) return { ok: false, code: 'MISSING_ARGUMENT', error: 'commentId مطلوب للتحقق.' };
      try {
        const r = await ctx.youtubeReplyVerify({ commentId: String(args.commentId), externalReplyId: args.externalReplyId ? String(args.externalReplyId) : null });
        // لا نجاح بلا سجل رد حقيقي مُسلَّم؛ وإلا فشل صريح (لا ادّعاء تسليم).
        if (!r.real) return { ok: false, code: 'REPLY_NOT_VERIFIED', error: r.note };
        return { ok: true, data: { verified: true, record: r.record, note: r.note } };
      } catch (e: any) { return { ok: false, code: 'TOOL_EXECUTION_FAILED', error: String(e?.message || e).slice(0, 200) }; }
    },
  },
  {
    id: 'youtube_publish',
    name: 'رفع فيديو إلى YouTube',
    description: 'رفع فيديو حقيقي (videos.insert) أو جدولته. عملية خارجية تتطلب موافقة صريحة أو تفويض تشغيل فعّال، ولا تُنفَّذ من مهمة تلقائية بلا ذلك.',
    permission: 'EXTERNAL_ACTION',
    parameters: [
      { name: 'title', type: 'string', required: true, description: 'عنوان الفيديو.' },
      { name: 'description', type: 'string', required: false, description: 'الوصف.' },
      { name: 'privacyStatus', type: 'string', required: false, description: 'public/private/unlisted.' },
      { name: 'publishAt', type: 'string', required: false, description: 'وقت الجدولة.' },
      { name: 'videoBase64', type: 'string', required: false, description: 'بايتات الفيديو base64 (مطلوبة فعلياً للرفع).' },
    ],
    run: async (args, ctx) => {
      if (!args.title) return { ok: false, code: 'MISSING_ARGUMENT', error: 'title مطلوب.' };
      try {
        return { ok: true, data: await ctx.youtubePublish({ title: String(args.title), description: args.description, privacyStatus: args.privacyStatus, publishAt: args.publishAt, videoBase64: args.videoBase64, approved: true }) };
      } catch (e: any) { return { ok: false, code: 'TOOL_EXECUTION_FAILED', error: String(e?.message || e).slice(0, 200) }; }
    },
  },
  {
    id: 'youtube_video_update',
    name: 'تحديث بيانات فيديو YouTube',
    description: 'تحديث عنوان/وصف فيديو مملوك للقناة (videos.update). عملية خارجية تتطلب موافقة صريحة أو تفويض تشغيل فعّال.',
    permission: 'EXTERNAL_ACTION',
    parameters: [
      { name: 'videoId', type: 'string', required: true, description: 'معرّف الفيديو لدى YouTube.' },
      { name: 'title', type: 'string', required: true, description: 'العنوان الجديد.' },
      { name: 'description', type: 'string', required: false, description: 'الوصف الجديد.' },
    ],
    run: async (args, ctx) => {
      if (!args.videoId || !args.title) return { ok: false, code: 'MISSING_ARGUMENT', error: 'videoId وtitle مطلوبان.' };
      try {
        return { ok: true, data: await ctx.youtubeVideoUpdate({ videoId: String(args.videoId), title: String(args.title), description: args.description, tags: Array.isArray(args.tags) ? args.tags : undefined, privacyStatus: args.privacyStatus }) };
      } catch (e: any) { return { ok: false, code: 'TOOL_EXECUTION_FAILED', error: String(e?.message || e).slice(0, 200) }; }
    },
  },
];

export const AGENT_TOOL_IDS: ReadonlyArray<string> = AGENT_TOOLS.map((t) => t.id);

export function getAgentTool(id: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.id === id);
}
