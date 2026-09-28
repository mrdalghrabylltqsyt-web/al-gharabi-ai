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
  /** رفع فيديو حقيقي إلى YouTube (videos.insert) — عملية خارجية تتطلب موافقة. */
  youtubePublish: (input: { title: string; description?: string; tags?: string[]; privacyStatus?: string; publishAt?: string | null; videoBase64?: string; mimeType?: string; approved?: boolean }) => Promise<any>;
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
    description: 'استدعاء مزود AI عند الحاجة فقط (محمي بالحصة والذاكرة) لصياغة مسودة. لا يُستخدم للعمليات الحتمية.',
    permission: 'EXECUTE',
    parameters: [{ name: 'prompt', type: 'string', required: true, description: 'نص الطلب.' }],
    run: async (args, ctx) => {
      if (!args.prompt) return { ok: false, code: 'MISSING_ARGUMENT', error: 'prompt مطلوب.' };
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
    description: 'رد حقيقي على تعليق YouTube (comments.insert). عملية خارجية تتطلب موافقة صريحة ولا تُنفَّذ من مهمة تلقائية.',
    permission: 'EXTERNAL_ACTION',
    parameters: [
      { name: 'commentId', type: 'string', required: true, description: 'معرّف التعليق لدى YouTube.' },
      { name: 'text', type: 'string', required: true, description: 'نص الرد.' },
    ],
    run: async (args, ctx) => {
      if (!args.commentId || !args.text) return { ok: false, code: 'MISSING_ARGUMENT', error: 'commentId وtext مطلوبان.' };
      try {
        return { ok: true, data: await ctx.youtubeReply({ commentId: String(args.commentId), text: String(args.text) }) };
      } catch (e: any) { return { ok: false, code: 'TOOL_EXECUTION_FAILED', error: String(e?.message || e).slice(0, 200) }; }
    },
  },
  {
    id: 'youtube_publish',
    name: 'رفع فيديو إلى YouTube',
    description: 'رفع فيديو حقيقي (videos.insert) أو جدولته. عملية خارجية تتطلب موافقة صريحة ولا تُنفَّذ من مهمة تلقائية.',
    permission: 'EXTERNAL_ACTION',
    parameters: [
      { name: 'title', type: 'string', required: true, description: 'عنوان الفيديو.' },
      { name: 'description', type: 'string', required: false, description: 'الوصف.' },
      { name: 'privacyStatus', type: 'string', required: false, description: 'public/private/unlisted.' },
      { name: 'publishAt', type: 'string', required: false, description: 'وقت الجدولة.' },
    ],
    run: async (args, ctx) => {
      if (!args.title) return { ok: false, code: 'MISSING_ARGUMENT', error: 'title مطلوب.' };
      try {
        return { ok: true, data: await ctx.youtubePublish({ title: String(args.title), description: args.description, privacyStatus: args.privacyStatus, publishAt: args.publishAt, approved: true }) };
      } catch (e: any) { return { ok: false, code: 'TOOL_EXECUTION_FAILED', error: String(e?.message || e).slice(0, 200) }; }
    },
  },
];

export const AGENT_TOOL_IDS: ReadonlyArray<string> = AGENT_TOOLS.map((t) => t.id);

export function getAgentTool(id: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.id === id);
}
