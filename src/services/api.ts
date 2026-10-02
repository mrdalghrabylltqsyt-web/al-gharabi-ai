import { AppUser, UserRole, MarketingBriefRequest, MarketingBriefResult, MarketingCampaignRequest, MarketingCampaignSummary, MarketingCampaignDetail, MarketingCampaignCreationResult, MarketingCampaignStatus, MarketingDraftAction, MarketingDraftBulkResult, MarketingDraftLinkResult, SocialManagerStatus, SocialCapabilitiesResult, SocialCommentClassificationResult, SocialCommentsResult, SocialRepliesResult, SocialApprovalsResult, SocialAnalyticsResult, MarketingDecisionResult, SocialMemoryResult } from '../types';
import { classifyPreviewExchange, classifySessionCheck, type SessionOutcome } from './sessionPolicy';
import { createTimeoutSignal, GEMINI_VERIFY_TIMEOUT_MS, interpretGeminiVerification, type GeminiVerificationOutcome } from './geminiVerification';

export interface GenerateContentRequest {
  platform: string;
  contentType: string;
  topic?: string;
  tone?: string;
  productName?: string;
  productId?: string;
  installmentDetails?: string;
  customInstructions?: string;
  /** منصات إضافية مطلوب تكييف حتمي لها من نفس النص الأساسي (نداء مزود واحد فقط). */
  platforms?: string[];
}

export interface ClassifyMessageRequest {
  customerName?: string;
  message: string;
  channel?: string;
  showroomInfo?: any;
}

export interface AgentChatRequest {
  message: string;
  chatHistory?: Array<{ role: 'user' | 'model'; text: string }>;
  context?: any;
}

let _authToken: string | null = null;

// التوكن يُحفظ في localStorage لا sessionStorage: الأخير يُفقد عند إغلاق
// التبويب فيُطرد المالك إلى شاشة الدخول في كل مرة — وهو جوهر مشكلة الوصول
// المؤقت. التوكن موقّع من الخادم ومحدود الصلاحية (30 يوماً) ويمكن إبطاله.
const TOKEN_STORAGE_KEY = 'algharabi_auth_token';

export const setApiAuthToken = (token: string | null) => {
  _authToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {}
  // إزالة أي توكن قديم في sessionStorage كي لا يبقى مصدراً مزدوجاً.
  try { sessionStorage.removeItem(TOKEN_STORAGE_KEY); } catch {}
};

export const getApiAuthToken = (): string | null => {
  if (_authToken) return _authToken;
  try {
    _authToken = localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {}
  return _authToken;
};

const getAuthHeaders = (): Record<string, string> => {
  const token = getApiAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

export interface OrchestrationResult {
  success: boolean;
  intent: string;
  targetModule: string;
  platforms: string[];
  requiresGemini: boolean;
  approvalRequired: boolean;
  message: string;
}

export const apiService = {
  async getExecutiveOverview(): Promise<any> { const res = await fetch('/api/executive/overview', { headers: getAuthHeaders() }); const data = await res.json(); if(!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل لوحة القيادة التنفيذية'); return data; },
  async getFinanceAging(): Promise<any> { const res = await fetch('/api/finance/aging', { headers: getAuthHeaders() }); const data = await res.json(); if(!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل أعمار الديون'); return data; },
  async getTodayFollowUps(): Promise<any> { const res = await fetch('/api/crm/follow-ups/today', { headers: getAuthHeaders() }); const data = await res.json(); if(!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل المتابعات'); return data; },

  // --- Authentication ---
  async loginWithGoogle(credential: string): Promise<{ success: boolean; token: string; user: AppUser }> {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'فشلت المصادقة مع حساب Google.');
    }

    setApiAuthToken(data.token);
    return data;
  },

  async requestOwnerChallenge(email: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/auth/request-owner-challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({ success: false }));
    if (!res.ok || !data.success) {
      throw new Error(data.error || data.message || 'تعذر إرسال رمز التحقق، حاول مرة أخرى');
    }
    return data;
  },

  // مقايضة توكن المعاينة بجلسة مالك حقيقية. تُستخدم فقط من رابط المعاينة.
  // التوكن يُرسل في جسم POST لا في سطر الطلب، فلا يظهر في سجلات الخادم ولا
  // في محفوظات المتصفح ولا في Referer.
  // لا ترمي عند عطل الخادم: تُعيد تصنيفاً صريحاً حتى تميّز الواجهة بين توكن
  // خاطئ (fallback للدخول) وبين عطل عابر (إعادة المحاولة بلا مسح الجلسة).
  async previewLogin(previewToken: string): Promise<
    { outcome: 'ok'; token: string; user: AppUser } | { outcome: 'invalid' | 'unavailable' }
  > {
    let res: Response;
    try {
      res = await fetch('/api/auth/preview-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: previewToken }),
      });
    } catch {
      return { outcome: 'unavailable' };
    }
    const data = await res.json().catch(() => ({ success: false }));
    const outcome = classifyPreviewExchange({
      status: res.status,
      hasSessionToken: Boolean(res.ok && data?.success && typeof data.token === 'string' && data.token),
    });
    if (outcome === 'ok') return { outcome: 'ok', token: data.token, user: data.user };
    return { outcome };
  },

  async verifyChallenge(email: string, code: string): Promise<{ success: boolean; token: string; user: AppUser }> {
    const res = await fetch('/api/auth/verify-challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'رمز التحقق غير صحيح أو منتهي الصلاحية.');
    }

    setApiAuthToken(data.token);
    return data;
  },

  /**
   * يتحقق من الجلسة المحفوظة ويُصنّف النتيجة بلا آثار جانبية: مصادق/مرفوض/
   * غير متاح، مع المستخدم عند النجاح. لا يمسح التوكن إلا عند رفض صريح
   * (401/403)، ولا يرمي أبداً، حتى تتخذ الواجهة قراراً مبنياً على السياسة.
   */
  async checkSession(): Promise<{ outcome: SessionOutcome; user: AppUser | null }> {
    const token = getApiAuthToken();
    if (!token) return { outcome: classifySessionCheck({ hasToken: false, status: null, hasValidUser: false }), user: null };

    let res: Response;
    try {
      res = await fetch('/api/auth/me', { method: 'GET', headers: getAuthHeaders() });
    } catch {
      // انقطاع الشبكة: الجلسة لم تُرفض، فلا مسح ولا شاشة دخول.
      return { outcome: 'unavailable', user: null };
    }

    let user: AppUser | null = null;
    if (res.ok) {
      try {
        const data = await res.json();
        if (data?.success && data?.user) user = data.user as AppUser;
      } catch {
        user = null;
      }
    }

    const outcome = classifySessionCheck({ hasToken: true, status: res.status, hasValidUser: Boolean(user) });
    if (outcome === 'rejected') setApiAuthToken(null);
    return { outcome, user };
  },

  async logout(): Promise<void> {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
    } catch {}
    setApiAuthToken(null);
  },

  // --- User Management (Protected by server RBAC) ---
  async fetchUsers(): Promise<AppUser[]> {
    const res = await fetch('/api/users', {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch users');
    const data = await res.json();
    return data.users || [];
  },

  async createUser(payload: { name: string; email: string; role: UserRole; avatar?: string }): Promise<AppUser> {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'فشلت إضافة المستخدم');
    }
    return data.user;
  },

  async updateUserRole(userId: string, role: UserRole): Promise<AppUser> {
    const res = await fetch(`/api/users/${userId}/role`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ role }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'فشل تحديث رتبة المستخدم');
    }
    return data.user;
  },

  async updateUserStatus(userId: string, active: boolean): Promise<AppUser> {
    const res = await fetch(`/api/users/${userId}/status`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ active }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'فشل تحديث حالة المستخدم');
    }
    return data.user;
  },

  async deleteUser(userId: string): Promise<void> {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'فشل حذف المستخدم');
    }
  },

  // --- Showroom AI & Core Endpoints ---
  async orchestrate(message: string): Promise<OrchestrationResult> {
    const res = await fetch('/api/ai/orchestrate', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'فشل توجيه الطلب');
    return data;
  },

  async getAiStatus() {
    const res = await fetch('/api/ai/status', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch AI status');
    return await res.json();
  },

  async getAiCapabilities() {
    const res = await fetch('/api/ai/capabilities', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch AI capabilities');
    return await res.json();
  },

  async buildWeekPlan(platforms: string[], focus: string) {
    const res = await fetch('/api/ai/plan-week', {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ platforms, focus })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'فشل بناء الخطة');
    return data;
  },

  async getDeploymentChecklist() {
    const res = await fetch('/api/system/deployment-checklist', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error || 'تعذر تحميل قائمة الجاهزية');
    return res.json();
  },

  /**
   * فحص اتصال Gemini الحي — للمالك فقط، ويُستدعى يدوياً بضغطة زر واحدة.
   *
   * لا retry: طلب واحد بإشارة مهلة صريحة، ويُصنّف النتيجة إلى عرض آمن.
   * لا يُشغَّل تلقائياً عند تحميل الصفحة، ولا يعرض أي مفتاح. مسار الخادم
   * owner-protected ويبقى هو طبقة الأمان الإلزامية.
   */
  async verifyGeminiProvider(): Promise<GeminiVerificationOutcome> {
    const { signal, clear } = createTimeoutSignal(GEMINI_VERIFY_TIMEOUT_MS);
    try {
      const res = await fetch('/api/ai/verify-provider', { method: 'POST', headers: getAuthHeaders(), signal });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 403) return { ok: false, model: null, latencyMs: null, message: 'هذه العملية مقتصرة على مالك النظام.', hint: null };
        if (res.status === 401) return { ok: false, model: null, latencyMs: null, message: 'انتهت الجلسة، أعد تسجيل الدخول ثم حاول مجدداً.', hint: null };
        return { ok: false, model: null, latencyMs: null, message: 'تعذر تنفيذ فحص Gemini من الخادم.', hint: null };
      }
      return interpretGeminiVerification(data);
    } catch (err: any) {
      // الإلغاء = تجاوز المهلة، أو انقطاع شبكة. لا إعادة إرسال تلقائية.
      if (err?.name === 'AbortError') return { ok: false, model: null, latencyMs: null, message: 'تجاوز فحص الاتصال المهلة المحددة. لم يتم التحقق.', hint: null };
      return { ok: false, model: null, latencyMs: null, message: 'تعذر الوصول إلى الخادم لإتمام فحص Gemini.', hint: null };
    } finally {
      clear();
    }
  },

  async checkHealth() {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error('Health check failed');
      return await res.json();
    } catch {
      return { status: 'offline', aiEnabled: false };
    }
  },

  async generateContent(payload: GenerateContentRequest): Promise<{ success: boolean; content: string; generatedBy?: string }> {
    try {
      const res = await fetch('/api/ai/generate-content', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      // 422 يعني أن الطلب خالف قواعد سلامة المحتوى التجاري: لا نُخفيه ببديل محلي،
      // بل نُبلغ المستخدم صراحةً بسبب الرفض. لذلك نرفع خطأً موسوماً يمر عبر catch.
      if (res.status === 422) {
        const denied = await res.json().catch(() => ({} as any));
        const violation = new Error(denied.error || 'المحتوى خالف قواعد سلامة البيانات التجارية.') as Error & { contentRejected?: boolean };
        violation.contentRejected = true;
        throw violation;
      }
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();
      return {
        success: true,
        content: data.content || data.fallback || '',
        generatedBy: data.generatedBy,
        aiSource: data.aiSource,
        notice: data.notice,
        contentSafety: data.contentSafety,
        adaptedVersions: data.adaptedVersions,
      } as any;
    } catch (err) {
      // رفض سلامة المحتوى ليس عطلاً عابراً: لا يُستبدل ببديل محلي صامت.
      if ((err as any)?.contentRejected) throw err;
      console.warn('API call failed, falling back to local engine:', err);
      return {
        success: true,
        content: `عروض معرض الغرابي للتقسيط:
${payload.topic || payload.productName || 'أنظمة وحلول التقسيط الميسر'}
• خيارات دفع مرنة وتسهيلات ميسرة
• إجراءات واضحة ومتابعة كاملة للطلب
• تواصل معنا الآن لمعرفة التفاصيل والتقديم المباشر`,
        generatedBy: 'local-fallback',
      };
    }
  },

  async classifyMessage(payload: ClassifyMessageRequest) {
    try {
      const res = await fetch('/api/ai/classify-message', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Classification failed');
      return await res.json();
    } catch (err) {
      console.warn('Message classification error:', err);
      // لا نُصدر رداً مقترحاً من طرف المتصفح: حارس سلامة المحتوى على الخادم هو
      // المصدر الوحيد لاعتماد أي suggestedReply. عند تعذر الوصول للخادم نُعلن
      // الحاجة لمراجعة بشرية بدل عرض نص غير مفحوص.
      return {
        success: true,
        category: 'استفسار عام عن التقسيط',
        urgency: 'medium',
        needsHumanHandoff: true,
        suggestedReply: null,
        requiresHumanReview: true,
        generatedBy: 'unavailable',
        aiSource: 'fallback',
        fallbackReason: 'network_error',
        contentSafety: { safe: false, blocked: true, codes: [], violations: ['تعذر فحص سلامة الرد على الخادم؛ يلزم مراجعة بشرية.'] },
      };
    }
  },

  async agentChat(payload: AgentChatRequest): Promise<{ success: boolean; reply: string }> {
    try {
      const res = await fetch('/api/ai/agent-chat', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Agent chat failed');
      const data = await res.json();
      return {
        success: true,
        reply: data.reply || 'أهلاً بك! أنا في خدمتك لمعرض الغرابي للتقسيط.',
      };
    } catch (err) {
      console.warn('Agent chat error:', err);
      return {
        success: true,
        reply: `أهلاً بك! أنا وكيل "الغرابي AI" الذكي. يسعدني مساعدتك في حسابات التقسيط، أو اقتراح أفكار حملات لوسائل التواصل، أو استخراج تفاصيل منتجات المعرض. تفضل بسؤالي!`,
      };
    }
  },
  // --- Central AI Agent (العقل المركزي) ---
  // كل الاستدعاءات تُعيد استجابة الخادم الحقيقية؛ والواجهة لا تدّعي نجاحاً قبل
  // أن يرجع الـbackend نتيجة فعلية (لا fake success في الواجهة).
  async agentHealth(): Promise<any> {
    const res = await fetch('/api/agent/health', { headers: getAuthHeaders() });
    const data = await res.json().catch(() => ({ success: false }));
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل حالة العقل المركزي');
    return data;
  },
  async agentTools(): Promise<any> {
    const res = await fetch('/api/agent/tools', { headers: getAuthHeaders() });
    const data = await res.json().catch(() => ({ success: false }));
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل أدوات العقل');
    return data;
  },
  async agentProviders(): Promise<any> {
    const res = await fetch('/api/agent/providers', { headers: getAuthHeaders() });
    const data = await res.json().catch(() => ({ success: false }));
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل مزوّدي العقل');
    return data;
  },
  async agentCreateTask(task: string, opts?: { mode?: string; idempotencyKey?: string; context?: any }): Promise<any> {
    const headers = getAuthHeaders();
    if (opts?.idempotencyKey) headers['X-Idempotency-Key'] = opts.idempotencyKey;
    const res = await fetch('/api/agent/tasks', {
      method: 'POST',
      headers,
      body: JSON.stringify({ task, mode: opts?.mode || 'auto', idempotencyKey: opts?.idempotencyKey, context: opts?.context }),
    });
    const data = await res.json().catch(() => ({ success: false }));
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إنشاء مهمة العقل');
    return data;
  },
  async agentTask(id: string): Promise<any> {
    const res = await fetch(`/api/agent/tasks/${encodeURIComponent(id)}`, { headers: getAuthHeaders() });
    const data = await res.json().catch(() => ({ success: false }));
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل المهمة');
    return data;
  },
  async agentTasks(): Promise<any> {
    const res = await fetch('/api/agent/tasks', { headers: getAuthHeaders() });
    const data = await res.json().catch(() => ({ success: false }));
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل سجل المهام');
    return data;
  },
  async agentReplay(id: string): Promise<any> {
    const res = await fetch(`/api/agent/tasks/${encodeURIComponent(id)}/replay`, { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json().catch(() => ({ success: false }));
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إعادة تشغيل المهمة');
    return data;
  },

  async getPlatformCapabilities() {
    const res = await fetch('/api/platforms/capabilities', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch platform capabilities');
    return await res.json();
  },

  async createPlatformConnectIntent(platform: string) {
    const res = await fetch(`/api/platforms/${encodeURIComponent(platform)}/connect-intent`, { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إنشاء نية الربط');
    return data;
  },

  async getPlatformReadiness() { const res = await fetch('/api/platforms/readiness', { headers: getAuthHeaders() }); const data = await res.json(); if(!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل جاهزية المنصات'); return data; },
  /** مصفوفة جاهزية المنصات (Batch 6): قدرات/إمكانات كل منصة من الكود الحقيقي. */
  async getReadinessMatrix() { const res = await fetch('/api/platforms/readiness-matrix', { headers: getAuthHeaders() }); const data = await res.json(); if(!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل مصفوفة الجاهزية'); return data; },
  /** مركز ربط المنصات (Batch 7): الحالة الدقيقة لكل منصة + بوابات العمليات. */
  async getPlatformControlPlane() { const res = await fetch('/api/platforms/control-plane', { headers: getAuthHeaders() }); const data = await res.json(); if(!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل مركز ربط المنصات'); return data; },
  /** متطلبات الإعداد الخارجي لكل منصة (أسماء متغيرات وخطوات، بلا أسرار). */
  async getPlatformExternalSetup() { const res = await fetch('/api/platforms/external-setup', { headers: getAuthHeaders() }); const data = await res.json(); if(!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل متطلبات الإعداد'); return data; },

  async getPlatformHealth(platform: string) { const res = await fetch(`/api/platforms/${encodeURIComponent(platform)}/health`, { headers: getAuthHeaders() }); const data = await res.json(); if(!res.ok || !data.success) throw new Error(data.error || 'تعذر فحص المنصة'); return data; },

  // --- YouTube FULL OPERATION (كلها تمر ببوابات الخادم؛ لا أسرار في الواجهة) ---
  /** قائمة فيديوهات القناة الحقيقية مع الإحصاءات. */
  async getYouTubeVideos(maxResults = 25) {
    const res = await fetch(`/api/platforms/youtube/videos?maxResults=${maxResults}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) { const err: any = new Error(data.error || 'تعذر جلب فيديوهات YouTube'); err.code = data.code; throw err; }
    return data;
  },
  /** إحصاءات القناة والفيديو + تحليل الجمهور (بلا بيانات سكانية مُختلقة). */
  async getYouTubeAnalytics() {
    const res = await fetch('/api/platforms/youtube/analytics', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) { const err: any = new Error(data.error || 'تعذر جلب تحليلات YouTube'); err.code = data.code; throw err; }
    return data;
  },
  /** حلقة تعلّم YouTube (دروس مع مصدرها وحدودها). */
  async getYouTubeLearning() {
    const res = await fetch('/api/platforms/youtube/learning', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) { const err: any = new Error(data.error || 'تعذر جلب تعلّم YouTube'); err.code = data.code; throw err; }
    return data;
  },
  /** قراءة تعليقات فيديو حقيقية وتخزينها (commentThreads.list). */
  async fetchYouTubeComments(videoId: string, maxResults = 100) {
    const res = await fetch(`/api/platforms/youtube/comments?videoId=${encodeURIComponent(videoId)}&maxResults=${maxResults}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) { const err: any = new Error(data.error || 'تعذر جلب تعليقات YouTube'); err.code = data.code; throw err; }
    return data;
  },
  /** رد حقيقي على تعليق YouTube (comments.insert) — للمالك فقط. */
  async replyYouTube(payload: { commentId: string; text: string; commentText?: string }) {
    const res = await fetch('/api/platforms/youtube/reply', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) { const err: any = new Error(data.error || 'تعذر إرسال الرد عبر YouTube'); err.code = data.code; throw err; }
    return data;
  },
  /** رفع فيديو حقيقي أو جدولته (videos.insert resumable) — للمالك فقط. */
  async publishYouTube(payload: { title: string; description?: string; tags?: string[]; privacyStatus?: string; publishAt?: string | null; videoBase64: string; mimeType?: string }) {
    const res = await fetch('/api/platforms/youtube/publish', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ ...payload, approved: true }) });
    const data = await res.json();
    if (!res.ok || !data.success) { const err: any = new Error(data.error || 'تعذر رفع الفيديو إلى YouTube'); err.code = data.code; throw err; }
    return data;
  },
  /** تشخيص إعداد YouTube (نطاقات/قدرات/حالة صادقة) — للمالك فقط، بلا سرّ. */
  async getYouTubeDiagnostics() {
    const res = await fetch('/api/platforms/youtube/diagnostics', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب تشخيص YouTube');
    return data;
  },

  /** تفويض تشغيل YouTube (للمالك): حالة التفويض الحالية (نطاق YouTube فقط، بلا سرّ). */
  async getYouTubeDelegation() {
    const res = await fetch('/api/platforms/youtube/delegation', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) { const err: any = new Error(data.error || 'تعذر جلب تفويض YouTube'); err.code = data.code; throw err; }
    return data;
  },
  /** منح تفويض تشغيل YouTube للعمليات المحدّدة (للمالك فقط). */
  async grantYouTubeDelegation(payload: { actions: string[]; expiresInHours?: number | null; note?: string }) {
    const res = await fetch('/api/platforms/youtube/delegation', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) { const err: any = new Error(data.error || 'تعذر منح تفويض YouTube'); err.code = data.code; throw err; }
    return data;
  },
  /** إيقاف تفويض تشغيل YouTube (للمالك فقط) — يعود كل تنفيذ خارجي ليتطلب موافقة. */
  async revokeYouTubeDelegation() {
    const res = await fetch('/api/platforms/youtube/delegation', { method: 'DELETE', headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) { const err: any = new Error(data.error || 'تعذر إيقاف تفويض YouTube'); err.code = data.code; throw err; }
    return data;
  },

  async getProductionReadiness() { const res = await fetch('/api/platforms/production-readiness', { headers: getAuthHeaders() }); const data = await res.json(); if(!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل الجاهزية الإنتاجية'); return data; },

  async getFinalReadiness() { const res = await fetch('/api/system/final-readiness', { headers: getAuthHeaders() }); const data = await res.json(); if(!res.ok && !data) throw new Error('تعذر تحميل فحص الجاهزية النهائية'); return data; },

  async startPlatformOAuth(platform: string) { const res = await fetch(`/api/platforms/${encodeURIComponent(platform)}/oauth/start`, { headers: getAuthHeaders() }); const data = await res.json(); if(!res.ok || !data.success) { const msg = [data.error, data.hint].filter(Boolean).join(' — ') || 'تعذر بدء ربط المنصة'; const err: any = new Error(msg); err.code = data.code; err.redirectUri = data.redirectUri; err.appTokenKind = data.appTokenKind; throw err; } return data; },

  /**
   * يُكمل OAuth عندما تُلحق Meta الرمز في **مقطع** الاستجابة (تدفّق Instagram
   * الرسمي: response_type=token). المقطع لا يُرسَل إلى الخادم مع الطلب، فنرسله في
   * الجسم صراحةً — فلا يظهر الرمز في سطر الطلب ولا في سجلات الوسيط ولا Referer.
   */
  async completePlatformOAuthFragment(platform: string, state: string, fragment: string) {
    const res = await fetch(`/api/platforms/${encodeURIComponent(platform)}/oauth/callback`, {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ state, fragment }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err: any = new Error(data?.error || 'تعذر إكمال ربط المنصة'); err.code = data?.code; throw err; }
    return data;
  },

  // الرمز اختياري: إن غاب يُستخدم TELEGRAM_BOT_TOKEN من بيئة الخادم (لا نطلب نسخ أسرار للواجهة).
  async configureTelegram(botToken?: string) {
    const res = await fetch('/api/platforms/telegram/configure', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify(botToken ? { botToken } : {}) });
    const data = await res.json(); if(!res.ok || !data.success) throw new Error(data.error || 'تعذر ربط Telegram'); return data;
  },

  // إرسال رد حقيقي عبر Telegram بعد موافقة المالك؛ يمر بحارس السلامة ومنع التكرار على الخادم.
  async replyTelegram(payload: { externalId: string; text: string; commentText?: string; productId?: string; productName?: string }) {
    const res = await fetch('/api/platforms/telegram/reply', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إرسال الرد عبر Telegram');
    return data;
  },

  // حالة webhook الحقيقية من Telegram (getWebhookInfo) بلا أي سرّ — للمالك فقط.
  async getTelegramWebhookInfo() {
    const res = await fetch('/api/platforms/telegram/webhook-info', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب حالة webhook من Telegram');
    return data;
  },

  // العقل المركزي العام (Batch 26): قراءات حتمية بلا استهلاك AI وبلا أسرار.
  async getBrainDiagnostics() {
    const res = await fetch('/api/brain/diagnostics', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب تشخيص العقل المركزي');
    return data;
  },
  async getBrainLearning() {
    const res = await fetch('/api/brain/learning', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب تعلّم العقل المركزي');
    return data;
  },
  async getBrainRecommendations() {
    const res = await fetch('/api/brain/recommendations', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب توصيات العقل المركزي');
    return data;
  },
  async getBrainAudience() {
    const res = await fetch('/api/brain/audience', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب تحليل الجمهور');
    return data;
  },
  async buildBrainContentPlan(payload: { productId?: string; productName?: string; platforms?: string[]; objective?: string; extraInstructions?: string }) {
    const res = await fetch('/api/brain/content-plan', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر بناء خطة المحتوى');
    return data;
  },
  async analyzeBrainComment(payload: { platform: string; text: string; productName?: string }) {
    const res = await fetch('/api/brain/comment-intelligence', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحليل التعليق');
    return data;
  },

  // طبقة العقل المركزي المُطوَّرة (Central Brain upgrade): قراءة/تحليل فقط بلا تنفيذ.
  async getBrainState() {
    const res = await fetch('/api/agent/brain/state', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب لقطة العقل المركزي');
    return data;
  },
  async getBrainCapabilities() {
    const res = await fetch('/api/agent/brain/capabilities', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب مصفوفة قدرات المنصات');
    return data;
  },
  async getBrainDiagnosticsV2() {
    const res = await fetch('/api/agent/brain/diagnostics', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب تشخيص العقل');
    return data;
  },
  async getBrainDailyCycle() {
    const res = await fetch('/api/agent/brain/cycles/daily', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب الدورة اليومية');
    return data;
  },
  async getBrainWeeklyReview() {
    const res = await fetch('/api/agent/brain/cycles/weekly', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب المراجعة الأسبوعية');
    return data;
  },
  async getBrainDryRun(platform?: string) {
    const qs = platform ? `?platform=${encodeURIComponent(platform)}` : '';
    const res = await fetch(`/api/agent/brain/dry-run${qs}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب سيناريو dry-run');
    return data;
  },

  // العقل التجاري (Sales & Growth): قراءة فقط من بيانات المعرض الحقيقية.
  async getCommercialState() {
    const res = await fetch('/api/agent/brain/sales/state', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب الحالة التجارية');
    return data;
  },
  async getCommercialSummary() {
    const res = await fetch('/api/agent/brain/sales/summary', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب الملخّص التجاري');
    return data;
  },

  // عقل التسويق والطلب (Growth & Demand): قراءة فقط من بيانات المعرض الحقيقية.
  async getGrowthState() {
    const res = await fetch('/api/agent/brain/growth/state', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب حالة عقل التسويق');
    return data;
  },
  async getGrowthDashboard() {
    const res = await fetch('/api/agent/brain/growth/dashboard', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب لوحة عقل التسويق');
    return data;
  },

  // العقل المركزي للمبيعات الرقمية: قراءة وتحضير فقط من بيانات حقيقية.
  async getDigitalSalesState() {
    const res = await fetch('/api/agent/brain/sales/digital/state', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب حالة المبيعات الرقمية');
    return data;
  },
  async getDigitalSalesSummary() {
    const res = await fetch('/api/agent/brain/sales/digital/summary', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب ملخّص المبيعات الرقمية');
    return data;
  },
  async getDigitalSalesDashboard() {
    const res = await fetch('/api/agent/brain/sales/digital/dashboard', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب لوحة المبيعات الرقمية');
    return data;
  },
  async getDigitalSalesEvents() {
    const res = await fetch('/api/agent/brain/sales/digital/events', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب أحداث المبيعات الرقمية');
    return data;
  },
  async getDigitalSalesAutonomy() {
    const res = await fetch('/api/agent/brain/sales/digital/autonomy', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب مستويات الاستقلالية');
    return data;
  },

  // العقل التجاري المركزي الموحّد (الدفعة 4): قراءة/تحليل/اقتراح فقط من بيانات حقيقية.
  async getUnifiedCommercialState() {
    const res = await fetch('/api/agent/brain/commercial/state', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب العقل التجاري المركزي');
    return data;
  },
  async getUnifiedCommercialSummary() {
    const res = await fetch('/api/agent/brain/commercial/summary', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب ملخّص العقل التجاري المركزي');
    return data;
  },
  async getUnifiedCommercialCommandCenter() {
    const res = await fetch('/api/agent/brain/commercial/command-center', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب مركز القيادة التجاري');
    return data;
  },
  async getUnifiedCommercialOwnerControl() {
    const res = await fetch('/api/agent/brain/commercial/owner-control', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب مركز تحكّم المالك');
    return data;
  },
  async getUnifiedCommercialCapabilities() {
    const res = await fetch('/api/agent/brain/commercial/capabilities', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب تطوّر القدرات');
    return data;
  },
  async getUnifiedCommercialHealth() {
    const res = await fetch('/api/agent/brain/commercial/health', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب صحة النظام');
    return data;
  },
  async getUnifiedCommercialOperatingLoop() {
    const res = await fetch('/api/agent/brain/commercial/operating-loop', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب دورة التشغيل');
    return data;
  },
  async setDigitalSalesConsent(input: { customerKey: string; consent?: boolean; optedOut?: boolean }) {
    const res = await fetch('/api/agent/brain/sales/digital/consent', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(input) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحديث الموافقة');
    return data;
  },

  // صفحات Facebook التي يديرها الحساب بعد OAuth (معرّفات وأسماء فقط بلا رموز).
  async getFacebookPages() {
    const res = await fetch('/api/platforms/facebook/pages', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب صفحات Facebook');
    return data;
  },

  // اختيار صفحة Facebook لإتمام الربط (إثبات فعلي + اشتراك في webhook).
  async selectFacebookPage(pageId: string) {
    const res = await fetch('/api/platforms/facebook/select-page', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify({ pageId }) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر ربط صفحة Facebook');
    return data;
  },

  // إرسال رد حقيقي على تعليق Facebook بعد الموافقة؛ يمر بحارس السلامة ومنع التكرار.
  async replyFacebook(payload: { externalId: string; text: string; commentText?: string; productId?: string; productName?: string }) {
    const res = await fetch('/api/platforms/facebook/reply', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إرسال الرد عبر Facebook');
    return data;
  },

  // إرسال رسالة Facebook Messenger حقيقية عبر مسار message_reply المنفصل.
  async messageReplyFacebook(payload: { externalId?: string; recipientId?: string; text: string; commentText?: string }) {
    const res = await fetch('/api/platforms/facebook/message-reply', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إرسال الرسالة عبر Facebook');
    return data;
  },

  // حالة اشتراك صفحة Facebook في webhook (حقيقية من Meta بلا أي سرّ).
  async getFacebookWebhookInfo() {
    const res = await fetch('/api/platforms/facebook/webhook-info', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب حالة webhook من Facebook');
    return data;
  },

  // حسابات Instagram المهنية المرتبطة بصفحات الحساب بعد OAuth (معرّفات فقط بلا رموز).
  async getInstagramAccounts() {
    const res = await fetch('/api/platforms/instagram/accounts', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب حسابات Instagram');
    return data;
  },

  // اختيار حساب Instagram مهني لإتمام الربط (إثبات فعلي + اشتراك في webhook).
  async selectInstagramAccount(pageId: string) {
    const res = await fetch('/api/platforms/instagram/select-account', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify({ pageId }) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر ربط حساب Instagram');
    return data;
  },

  // إرسال رد حقيقي على تعليق Instagram بعد الموافقة؛ يمر بحارس السلامة ومنع التكرار.
  async replyInstagram(payload: { externalId: string; text: string; commentText?: string; productId?: string; productName?: string }) {
    const res = await fetch('/api/platforms/instagram/reply', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إرسال الرد عبر Instagram');
    return data;
  },

  // إرسال رسالة Instagram مباشرة عبر مسار message_reply المنفصل.
  async messageReplyInstagram(payload: { externalId?: string; recipientId?: string; text: string; commentText?: string }) {
    const res = await fetch('/api/platforms/instagram/message-reply', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إرسال الرسالة عبر Instagram');
    return data;
  },

  // حالة اشتراك حساب Instagram في webhook (حقيقية من Meta بلا أي سرّ).
  async getInstagramWebhookInfo() {
    const res = await fetch('/api/platforms/instagram/webhook-info', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب حالة webhook من Instagram');
    return data;
  },

  // ---- TikTok (رابع موصل حقيقي) — كلها بلا أي سرّ في الواجهة ----
  /** حالة TikTok الحقيقية: اتصال + توكنات (منطقي) + مصفوفة القدرات الرسمية. */
  async getTikTokStatus() {
    const res = await fetch('/api/platforms/tiktok/status', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب حالة TikTok');
    return data;
  },

  /** معلومات الناشر الرسمية من TikTok (إلزامية قبل النشر المباشر). */
  async getTikTokCreatorInfo() {
    const res = await fetch('/api/platforms/tiktok/creator-info', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب معلومات الناشر من TikTok');
    return data;
  },

  /** استعلام حالة نشر TikTok بـpublish_id (لا يُعلن تسليم إلا بـPUBLISH_COMPLETE). */
  async getTikTokPublishStatus(publishId: string) {
    const res = await fetch(`/api/platforms/tiktok/publish-status?publishId=${encodeURIComponent(publishId)}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر استعلام حالة النشر من TikTok');
    return data;
  },

  /** سجل عمليات نشر TikTok المحفوظ (بلا سرّ) — التسليم يُحسم تلقائياً من دليل المزود. */
  async getTikTokPublishes() {
    const res = await fetch('/api/platforms/tiktok/publishes', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب سجل عمليات النشر');
    return data;
  },

  /**
   * تهيئة نشر TikTok (Direct Post أو رفع مسودة). TikTok لا ينشر نصاً فقط:
   * يلزم videoUrl أو photoUrls عامة. لا يُعلن التسليم هنا بل بالاستعلام.
   */
  async publishTikTok(payload: { content: string; videoUrl?: string; photoUrls?: string[]; postMode?: 'DIRECT_POST' | 'MEDIA_UPLOAD'; privacyLevel?: string; approved: boolean; postId?: string }) {
    const res = await fetch('/api/platforms/tiktok/publish', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تهيئة النشر عبر TikTok');
    return data;
  },

  // نشر حقيقي على Instagram (حاوية + نشر) — يتطلب رابط صورة/فيديو عاماً.
  async publishInstagram(payload: { content: string; imageUrl?: string; videoUrl?: string; reel?: boolean; approved: boolean; postId?: string }) {
    const res = await fetch('/api/platforms/instagram/publish', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر النشر عبر Instagram');
    return data;
  },

  // إعداد OAuth الدقيق للمنصة (رابط الإرجاع والنطاق المطلوب) — للمالك، بلا أي سرّ.
  async getPlatformOAuthSetup(platform: string) {
    const res = await fetch(`/api/platforms/${encodeURIComponent(platform)}/oauth/setup`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب إعداد OAuth للمنصة');
    return data;
  },

  async executeJob(jobId: string) { const res = await fetch(`/api/control/jobs/${encodeURIComponent(jobId)}/execute`, { method:'POST', headers:getAuthHeaders() }); const data=await res.json(); if(!res.ok || !data.success) throw new Error(data.error || 'تعذر تنفيذ المهمة'); return data; },

  async disconnectPlatform(platform: string) {
    const res = await fetch(`/api/platforms/${encodeURIComponent(platform)}/disconnect`, { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر فصل المنصة');
    return data;
  },

  async calculateInstallmentQuote(payload: { cashPrice: number; downPayment?: number; months: number }) {
    const res = await fetch('/api/catalog/quote', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر حساب القسط');
    return data.quote;
  },

  async createCampaignDraft(payload: { title?: string; productName?: string; platforms?: string[] }) {
    const res = await fetch('/api/campaigns/draft', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إنشاء الحملة');
    return data.campaign;
  },

  async buildCampaignBatch(payload: { title?: string; productName?: string; focus?: string; platforms: string[] }) {
    const res = await fetch('/api/campaigns/build-batch', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر بناء دفعة الحملة');
    return data.campaign;
  },

  async listCampaigns() {
    const res = await fetch('/api/campaigns', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب الحملات');
    return data.campaigns || [];
  },

  async createAutomationJob(payload: { type?: string; payload?: any }, idempotencyKey?: string) {
    const headers = getAuthHeaders();
    if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
    const res = await fetch('/api/control/jobs', { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إنشاء المهمة');
    return data.job;
  },

  async cancelJob(jobId: string) {
    const res = await fetch(`/api/control/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إلغاء المهمة');
    return data.job;
  },


  async retryJob(jobId: string) {
    const res = await fetch(`/api/control/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إعادة المهمة');
    return data.job;
  },

  async publishPreflight(payload: { platform: string; content: string; approved: boolean }) {
    const res = await fetch('/api/publish/preflight', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    if (!res.ok) throw new Error('تعذر فحص جاهزية النشر');
    return await res.json();
  },

  async getControlAudit(limit = 50) {
    const res = await fetch(`/api/control/audit?limit=${encodeURIComponent(String(limit))}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب سجل العمليات');
    return data.entries || [];
  },

  async getJobPreflight(jobId: string) {
    const res = await fetch(`/api/control/jobs/${encodeURIComponent(jobId)}/preflight`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر فحص المهمة');
    return data;
  },

  async runJobPreflight() {
    const res = await fetch('/api/control/jobs/preflight', { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر فحص المهام');
    return data;
  },

  async listSystemBackups() {
    const res = await fetch('/api/system/backups', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب النسخ الاحتياطية');
    return data.backups || [];
  },

  async getSystemIntegrity() {
    const res = await fetch('/api/system/integrity', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok && !data) throw new Error('تعذر فحص سلامة النظام');
    return data;
  },

  async listSystemBackupsDetailed() {
    const res = await fetch('/api/system/backups', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب النسخ الاحتياطية');
    return data;
  },

  async exportSystemBackup() {
    const res = await fetch('/api/system/export', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('تعذر تصدير النسخة الاحتياطية');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `al-gharabi-ai-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    return true;
  },

  async getAnalyticsOverview() {
    const res = await fetch('/api/analytics/overview', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب التحليلات');
    return data;
  },

  async searchWorkspace(q: string) {
    const res = await fetch(`/api/workspace/search?q=${encodeURIComponent(q)}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تنفيذ البحث');
    return data;
  },

  async getSystemDiagnostics() {
    const res = await fetch('/api/system/diagnostics', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب تشخيص النظام');
    return data;
  },

  async getSystemAlerts() {
    const res = await fetch('/api/system/alerts', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب تنبيهات النظام');
    return data.alerts || [];
  },

  async preflightAllJobs(ids?: string[]) {
    const res = await fetch('/api/control/jobs/preflight-all', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(ids ? { ids } : {}) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر فحص جميع المهام');
    return data;
  },

  async getControlOverview() {
    const res = await fetch('/api/control/overview', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب حالة مركز التحكم');
    return data.overview;
  },

  async getWorkspaceSnapshot() {
    const res = await fetch('/api/workspace/snapshot', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب لقطة مساحة العمل');
    return data.snapshot;
  },

  async getWorkspaceSummary() {
    const res = await fetch('/api/workspace/summary', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب ملخص مساحة العمل');
    return data.summary;
  },

  async getWorkspaceShowroom() {
    const res = await fetch('/api/workspace/showroom', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب معلومات المعرض');
    return data.showroom;
  },

  async updateWorkspaceShowroom(payload: Record<string, unknown>) {
    const res = await fetch('/api/workspace/showroom', { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر حفظ معلومات المعرض');
    return data.showroom;
  },

  async getWorkspacePlans() {
    const res = await fetch('/api/workspace/plans', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب خطط التقسيط');
    return data.plans || [];
  },

  async createWorkspacePlan(payload: Record<string, unknown>) {
    const res = await fetch('/api/workspace/plans', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إضافة خطة التقسيط');
    return data.plan;
  },

  async updateWorkspacePlan(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/workspace/plans/${encodeURIComponent(id)}`, { method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تعديل خطة التقسيط');
    return data.plan;
  },

  async deleteWorkspacePlan(id: string) {
    const res = await fetch(`/api/workspace/plans/${encodeURIComponent(id)}`, { method: 'DELETE', headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر حذف خطة التقسيط');
    return data;
  },

  async getWorkspaceContent() {
    const res = await fetch('/api/workspace/content', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب المحتوى');
    return data.posts || [];
  },

  async createWorkspaceContent(payload: Record<string, unknown>) {
    const res = await fetch('/api/workspace/content', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر حفظ المحتوى');
    return data.post;
  },

  async updateWorkspaceContent(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/workspace/content/${encodeURIComponent(id)}`, { method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تعديل المحتوى');
    return data.post;
  },

  async deleteWorkspaceContent(id: string) {
    const res = await fetch(`/api/workspace/content/${encodeURIComponent(id)}`, { method: 'DELETE', headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر حذف المحتوى');
    return data;
  },

  async getWorkspaceConversations() {
    const res = await fetch('/api/workspace/conversations', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب المحادثات');
    return data.conversations || [];
  },

  async createWorkspaceConversation(payload: Record<string, unknown>) {
    const res = await fetch('/api/workspace/conversations', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر حفظ المحادثة');
    return data.conversation;
  },

  async updateWorkspaceConversation(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/workspace/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تعديل المحادثة');
    return data.conversation;
  },

  async getWorkspaceProducts() {
    const res = await fetch('/api/workspace/products', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب المنتجات');
    return data.products || [];
  },

  async createWorkspaceProduct(payload: Record<string, unknown>) {
    const res = await fetch('/api/workspace/products', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إضافة المنتج');
    return data.product;
  },

  async updateWorkspaceProduct(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/workspace/products/${encodeURIComponent(id)}`, { method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تعديل المنتج');
    return data.product;
  },

  async deleteWorkspaceProduct(id: string) {
    const res = await fetch(`/api/workspace/products/${encodeURIComponent(id)}`, { method: 'DELETE', headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر حذف المنتج');
    return data;
  },

  async getInventory(){const r=await fetch('/api/inventory',{headers:getAuthHeaders()});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'تعذر جلب المخزون');return d;},
  async adjustInventory(id:string,delta:number,reason:string){const r=await fetch(`/api/inventory/${encodeURIComponent(id)}/adjust`,{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({delta,reason})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'تعذر تعديل المخزون');return d;},
  async getInventoryMovements(id?:string){const u=id?`/api/inventory/movements?productId=${encodeURIComponent(id)}`:'/api/inventory/movements';const r=await fetch(u,{headers:getAuthHeaders()});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'تعذر جلب الحركات');return d.movements||[];},
  async getCustomer360(q?:string){const u=q?`/api/customers/360?q=${encodeURIComponent(q)}`:'/api/customers/360';const r=await fetch(u,{headers:getAuthHeaders()});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'تعذر جلب ملف العملاء');return d.customers||[];},
  async getOperationsReport(days=30){const r=await fetch(`/api/reports/operations?days=${days}`,{headers:getAuthHeaders()});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'تعذر جلب التقرير');return d;},

  async getLeads(status?: string) {
    const url = status ? `/api/crm/leads?status=${encodeURIComponent(status)}` : '/api/crm/leads';
    const res = await fetch(url, { headers: getAuthHeaders() }); const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب العملاء المحتملين'); return data.leads || [];
  },
  async createLead(payload: Record<string, unknown>) {
    const res = await fetch('/api/crm/leads', { method:'POST', headers:getAuthHeaders(), body:JSON.stringify(payload) }); const data=await res.json();
    if(!res.ok||!data.success) throw new Error(data.error||'تعذر إضافة العميل المحتمل'); return data.lead;
  },
  async updateLead(id:string,payload:Record<string,unknown>) {
    const res=await fetch(`/api/crm/leads/${encodeURIComponent(id)}`,{method:'PATCH',headers:getAuthHeaders(),body:JSON.stringify(payload)}); const data=await res.json();
    if(!res.ok||!data.success) throw new Error(data.error||'تعذر تعديل العميل المحتمل'); return data.lead;
  },
  async getTasks(status?: string) {
    const url=status?`/api/tasks?status=${encodeURIComponent(status)}`:'/api/tasks'; const res=await fetch(url,{headers:getAuthHeaders()}); const data=await res.json();
    if(!res.ok||!data.success) throw new Error(data.error||'تعذر جلب المهام'); return data.tasks||[];
  },
  async createTask(payload:Record<string,unknown>) {
    const res=await fetch('/api/tasks',{method:'POST',headers:getAuthHeaders(),body:JSON.stringify(payload)}); const data=await res.json();
    if(!res.ok||!data.success) throw new Error(data.error||'تعذر إنشاء المهمة'); return data.task;
  },
  async updateTask(id:string,payload:Record<string,unknown>) {
    const res=await fetch(`/api/tasks/${encodeURIComponent(id)}`,{method:'PATCH',headers:getAuthHeaders(),body:JSON.stringify(payload)}); const data=await res.json();
    if(!res.ok||!data.success) throw new Error(data.error||'تعذر تعديل المهمة'); return data.task;
  },
  async deleteTask(id:string) {
    const res=await fetch(`/api/tasks/${encodeURIComponent(id)}`,{method:'DELETE',headers:getAuthHeaders()}); const data=await res.json();
    if(!res.ok||!data.success) throw new Error(data.error||'تعذر حذف المهمة'); return data;
  },
  async getCalendarSchedule(from?:string,to?:string) {
    const params=new URLSearchParams(); if(from) params.set('from',from); if(to) params.set('to',to); const res=await fetch(`/api/calendar/schedule?${params.toString()}`,{headers:getAuthHeaders()}); const data=await res.json();
    if(!res.ok||!data.success) throw new Error(data.error||'تعذر جلب الجدول'); return data.entries||[];
  },


  async getSales(status?: string) {
    const url=status?`/api/sales?status=${encodeURIComponent(status)}`:'/api/sales'; const res=await fetch(url,{headers:getAuthHeaders()}); const data=await res.json();
    if(!res.ok||!data.success) throw new Error(data.error||'تعذر جلب المبيعات'); return data.sales||[];
  },
  async createSale(payload:Record<string,unknown>) {
    const res=await fetch('/api/sales',{method:'POST',headers:getAuthHeaders(),body:JSON.stringify(payload)}); const data=await res.json();
    if(!res.ok||!data.success) throw new Error(data.error||'تعذر إنشاء عملية البيع'); return data.sale;
  },
  async updateSale(id:string,payload:Record<string,unknown>) {
    const res=await fetch(`/api/sales/${encodeURIComponent(id)}`,{method:'PATCH',headers:getAuthHeaders(),body:JSON.stringify(payload)}); const data=await res.json();
    if(!res.ok||!data.success) throw new Error(data.error||'تعذر تعديل عملية البيع'); return data.sale;
  },
  async recordSalePayment(id:string,payload:{amount:number;method:string;note?:string}) {
    const res=await fetch(`/api/sales/${encodeURIComponent(id)}/payments`,{method:'POST',headers:getAuthHeaders(),body:JSON.stringify(payload)}); const data=await res.json();
    if(!res.ok||!data.success) throw new Error(data.error||'تعذر تسجيل الدفعة'); return data;
  },
  async getFinanceOverview() {
    const res=await fetch('/api/finance/overview',{headers:getAuthHeaders()}); const data=await res.json();
    if(!res.ok||!data.success) throw new Error(data.error||'تعذر جلب الملخص المالي'); return data.metrics;
  },

  async validateWorkspaceContent(payload: { platform?: string; content: string }) {
    const res = await fetch('/api/workspace/content/validate', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'تعذر فحص المحتوى');
    return data;
  },

  async getBusinessOverview() { const res=await fetch('/api/business/overview',{headers:getAuthHeaders()}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر جلب مركز الأعمال'); return data.metrics; },
  async getSuppliers() { const res=await fetch('/api/suppliers',{headers:getAuthHeaders()}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر جلب الموردين'); return data.suppliers||[]; },
  async createSupplier(payload:Record<string,unknown>) { const res=await fetch('/api/suppliers',{method:'POST',headers:getAuthHeaders(),body:JSON.stringify(payload)}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر إضافة المورد'); return data.supplier; },
  async deleteSupplier(id:string) { const res=await fetch(`/api/suppliers/${encodeURIComponent(id)}`,{method:'DELETE',headers:getAuthHeaders()}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر حذف المورد'); return data; },
  async getPurchases() { const res=await fetch('/api/purchases',{headers:getAuthHeaders()}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر جلب المشتريات'); return data.purchases||[]; },
  async createPurchase(payload:Record<string,unknown>) { const res=await fetch('/api/purchases',{method:'POST',headers:getAuthHeaders(),body:JSON.stringify(payload)}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر تسجيل الشراء'); return data.purchase; },
  async getExpenses(category?:string) { const qs=category?`?category=${encodeURIComponent(category)}`:''; const res=await fetch(`/api/expenses${qs}`,{headers:getAuthHeaders()}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر جلب المصروفات'); return data; },
  async createExpense(payload:Record<string,unknown>) { const res=await fetch('/api/expenses',{method:'POST',headers:getAuthHeaders(),body:JSON.stringify(payload)}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر تسجيل المصروف'); return data.expense; },
  async deleteExpense(id:string) { const res=await fetch(`/api/expenses/${encodeURIComponent(id)}`,{method:'DELETE',headers:getAuthHeaders()}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر حذف المصروف'); return data; },
  async getContracts() { const res=await fetch('/api/contracts',{headers:getAuthHeaders()}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر جلب العقود'); return data.contracts||[]; },
  async createContract(payload:Record<string,unknown>) { const res=await fetch('/api/contracts',{method:'POST',headers:getAuthHeaders(),body:JSON.stringify(payload)}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر إنشاء العقد'); return data.contract; },
  async signContract(id:string,payload?:Record<string,unknown>) { const res=await fetch(`/api/contracts/${encodeURIComponent(id)}/sign`,{method:'POST',headers:getAuthHeaders(),body:JSON.stringify(payload||{})}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر توقيع العقد'); return data.contract; },
  async getInstallmentSchedule(saleId?:string) { const qs=saleId?`?saleId=${encodeURIComponent(saleId)}`:''; const res=await fetch(`/api/installments/schedule${qs}`,{headers:getAuthHeaders()}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر جلب جدول الأقساط'); return data.schedules||[]; },
  async generateInstallmentSchedule(saleId:string) { const res=await fetch('/api/installments/generate',{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({saleId})}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر إنشاء جدول الأقساط'); return data.schedules||[]; },
  async getDueInstallments(days=7) { const res=await fetch(`/api/installments/due?days=${encodeURIComponent(String(days))}`,{headers:getAuthHeaders()}); const data=await res.json(); if(!res.ok||!data.success) throw new Error(data.error||'تعذر جلب الأقساط المستحقة'); return data.schedules||[]; },
  async getControlAlerts(){const r=await fetch('/api/control/alerts',{headers:getAuthHeaders()});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'تعذر جلب التنبيهات');return d;},
  async getCustomerDirectory(q?:string){const u=q?`/api/control/customer-directory?q=${encodeURIComponent(q)}`:'/api/control/customer-directory';const r=await fetch(u,{headers:getAuthHeaders()});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'تعذر جلب دليل العملاء');return d.customers||[];},
  async getCashflow(days=30){const r=await fetch(`/api/control/cashflow?days=${days}`,{headers:getAuthHeaders()});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'تعذر جلب التدفق النقدي');return d;},
  async getReconciliation(){const r=await fetch('/api/control/reconciliation',{headers:getAuthHeaders()});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'تعذر إجراء المطابقة');return d;},
  async getDailyBrief(){const r=await fetch('/api/control/daily-brief',{headers:getAuthHeaders()});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'تعذر جلب ملخص اليوم');return d;},

  // وكيل الغرابي الذكي — مهمة محتوى تسويقي (حتمي، بدون Gemini وبدون اتصال خارجي)
  async createMarketingBrief(payload: MarketingBriefRequest): Promise<MarketingBriefResult> {
    const res = await fetch('/api/ai/content-brief', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تنفيذ مهمة المحتوى');
    return data.result as MarketingBriefResult;
  },

  async listMarketingBriefs(limit = 20): Promise<Array<Record<string, unknown>>> {
    const res = await fetch(`/api/ai/content-briefs?limit=${encodeURIComponent(String(limit))}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب سجل المهام');
    return data.briefs || [];
  },

  // مسار A — الحملات التسويقية الصغيرة (حتمية، بدون Gemini وبدون نشر خارجي)
  async createMarketingCampaign(payload: MarketingCampaignRequest): Promise<MarketingCampaignCreationResult> {
    const res = await fetch('/api/ai/marketing-campaigns', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر إنشاء الحملة');
    return data.campaign as MarketingCampaignCreationResult;
  },

  async listMarketingCampaigns(limit = 20): Promise<MarketingCampaignSummary[]> {
    const res = await fetch(`/api/ai/marketing-campaigns?limit=${encodeURIComponent(String(limit))}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب الحملات');
    return data.campaigns || [];
  },

  async getMarketingCampaign(id: string): Promise<MarketingCampaignDetail> {
    const res = await fetch(`/api/ai/marketing-campaigns/${encodeURIComponent(id)}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب تفاصيل الحملة');
    return data.campaign as MarketingCampaignDetail;
  },

  async updateMarketingCampaignStatus(id: string, status: MarketingCampaignStatus): Promise<MarketingCampaignSummary> {
    const res = await fetch(`/api/ai/marketing-campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', headers: getAuthHeaders(), body: JSON.stringify({ status }) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحديث حالة الحملة');
    return data.campaign as MarketingCampaignSummary;
  },

  /** قرار فردي على مسودة داخل الحملة: مراجعة / اعتماد / رفض. */
  async actOnMarketingDraft(campaignId: string, taskId: string, action: MarketingDraftAction, note?: string): Promise<{ result: { taskId: string; from: string; to: string; action: string }; campaign: MarketingCampaignDetail }> {
    const res = await fetch(`/api/ai/marketing-campaigns/${encodeURIComponent(campaignId)}/drafts/${encodeURIComponent(taskId)}/action`, {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ action, note }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تنفيذ الإجراء على المسودة');
    return data;
  },

  /** عملية جماعية على مسودات محددة داخل الحملة. */
  async bulkMarketingDraftAction(campaignId: string, taskIds: string[], action: MarketingDraftAction, note?: string): Promise<MarketingDraftBulkResult> {
    const res = await fetch(`/api/ai/marketing-campaigns/${encodeURIComponent(campaignId)}/drafts/bulk`, {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ taskIds, action, note }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تنفيذ العملية الجماعية');
    return data as MarketingDraftBulkResult;
  },

  /** ربط المسودة المعتمدة بالمنشور في مساحة المنشورات دون إنشاء نسخة مكررة. */
  async linkMarketingDraft(campaignId: string, taskId: string): Promise<MarketingDraftLinkResult> {
    const res = await fetch(`/api/ai/marketing-campaigns/${encodeURIComponent(campaignId)}/drafts/${encodeURIComponent(taskId)}/link`, {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر ربط المسودة بالمنشور');
    return data as MarketingDraftLinkResult;
  },

  // ---------------------------------------------------------------
  // مدير السوشيال ميديا — قراءات حقيقية من الخادم، بلا أي بيانات وهمية.
  // ---------------------------------------------------------------

  /** حالة المدير الكاملة: المنصات، المحتوى، والنشاط الفعلي. */
  async getSocialManagerStatus(): Promise<SocialManagerStatus> {
    const res = await fetch('/api/social/manager/status', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل حالة مدير السوشيال ميديا');
    return data as SocialManagerStatus;
  },

  /** قدرات كل منصة وتوفر مؤشراتها كما تسمح به واجهاتها الرسمية. */
  async getSocialCapabilities(): Promise<SocialCapabilitiesResult> {
    const res = await fetch('/api/social/manager/capabilities', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل قدرات المنصات');
    return data as SocialCapabilitiesResult;
  },

  /** تصنيف تعليق حتمياً دون استهلاك أي حصة ذكاء اصطناعي. */
  async classifySocialComment(text: string, platform?: string): Promise<SocialCommentClassificationResult> {
    const res = await fetch('/api/social/manager/comments/classify', {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ text, platform }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تصنيف التعليق');
    return data as SocialCommentClassificationResult;
  },

  /** التعليقات المسجلة فعلياً. يوضّح الرد ما إذا كان الجلب الخارجي متاحاً. */
  async getSocialComments(platform?: string): Promise<SocialCommentsResult> {
    const qs = platform ? `?platform=${encodeURIComponent(platform)}` : '';
    const res = await fetch(`/api/social/manager/comments${qs}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل التعليقات');
    return data as SocialCommentsResult;
  },

  /** تحليلات منصة: القيم الفعلية فقط، وغير المتاح يظهر كغير متاح. */
  async getSocialAnalytics(platform: string): Promise<SocialAnalyticsResult> {
    const res = await fetch(`/api/social/manager/analytics?platform=${encodeURIComponent(platform)}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل التحليلات');
    return data as SocialAnalyticsResult;
  },

  /** قرار العقل التسويقي مبني على بيانات النظام الفعلية. */
  async getMarketingDecision(params?: { objective?: string; platforms?: string[] }): Promise<MarketingDecisionResult> {
    const search = new URLSearchParams();
    if (params?.objective) search.set('objective', params.objective);
    if (params?.platforms?.length) search.set('platforms', params.platforms.join(','));
    const qs = search.toString() ? `?${search.toString()}` : '';
    const res = await fetch(`/api/social/manager/brain/decision${qs}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل قرار العقل التسويقي');
    return data as MarketingDecisionResult;
  },

  /** الذاكرة التشغيلية للسوشيال ميديا من السجلات الحقيقية. */
  async getSocialMemory(): Promise<SocialMemoryResult> {
    const res = await fetch('/api/social/manager/memory', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل الذاكرة التشغيلية');
    return data as SocialMemoryResult;
  },

  // ---------------------------------------------------------------
  // وحدة التعليقات والردود — كل الردود تُسجَّل داخلياً فقط (لا إرسال خارجي).
  // ---------------------------------------------------------------

  /** تسجيل تعليق وارد. إعادة نفس الحدث (replay) لا تُنشئ سجلاً مكرراً. */
  async ingestSocialComment(payload: { platform: string; externalId: string; text: string; authorName?: string; postExternalId?: string }): Promise<any> {
    const res = await fetch('/api/social/manager/comments/ingest', {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تسجيل التعليق');
    return data;
  },

  /** تسجيل رد داخلي على تعليق. يمر عبر حارس سلامة المحتوى من جهة الخادم. */
  async replyToSocialComment(payload: { platform: string; externalId: string; text: string; commentText?: string; authorName?: string; productId?: string; productName?: string }): Promise<any> {
    const res = await fetch('/api/social/manager/comments/reply', {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      const error: any = new Error(data.error || 'تعذر تسجيل الرد');
      error.status = res.status;
      error.body = data;
      throw error;
    }
    return data;
  },

  /** الردود المسجّلة داخلياً للتعليقات. */
  async getSocialReplies(platform?: string): Promise<SocialRepliesResult> {
    const qs = platform ? `?platform=${encodeURIComponent(platform)}` : '';
    const res = await fetch(`/api/social/manager/replies${qs}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل الردود');
    return data as SocialRepliesResult;
  },

  /** سجل قرارات المراجعة البشرية (اعتماد/رفض داخلي فقط). */
  async getSocialApprovals(params?: { platform?: string; status?: string }): Promise<SocialApprovalsResult> {
    const search = new URLSearchParams();
    if (params?.platform) search.set('platform', params.platform);
    if (params?.status) search.set('status', params.status);
    const qs = search.toString() ? `?${search.toString()}` : '';
    const res = await fetch(`/api/social/manager/approvals${qs}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل قرارات المراجعة');
    return data as SocialApprovalsResult;
  },

  /** تسجيل قرار مراجعة (pending/approved/rejected) — للمالك فقط. */
  async submitSocialApproval(payload: { platform: string; externalId: string; status: 'pending' | 'approved' | 'rejected'; commentText?: string; replyText?: string; productId?: string; productName?: string }): Promise<any> {
    const res = await fetch('/api/social/manager/approvals', {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      const error: any = new Error(data.error || 'تعذر تسجيل قرار المراجعة');
      error.status = res.status;
      error.body = data;
      throw error;
    }
    return data;
  },

  // --- YouTube Operations Manager (مدير تشغيل YouTube 24/7) ---
  /** لقطة حالة المراقبة الحقيقية (نشاط/إيقاع/آخر فحص/رد/معلّق/أخطاء) بلا سرّ. */
  async getYouTubeWatcher(): Promise<any> {
    const res = await fetch('/api/agent/youtube/watcher', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل حالة مراقبة YouTube');
    return data.watcher;
  },
  /** تحديث عناصر التحكم (Kill Switch/الرد/النشر/المراجعة/فاصل الأتمتة cadenceMinutes) — للمالك فقط. */
  async setYouTubeWatcherControls(controls: Record<string, boolean | number>): Promise<any> {
    const res = await fetch('/api/agent/youtube/watcher/controls', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(controls) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحديث إعدادات الأتمتة');
    return data;
  },
  /** تشغيل دورة مراقبة يدوية فوراً (للمالك) — للاختبار/التشغيل الفوري. */
  async pollYouTubeWatcher(): Promise<any> {
    const res = await fetch('/api/agent/youtube/watcher/poll', { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تشغيل دورة المراقبة');
    return data;
  },
  /** التقرير اليومي الحتمي لـYouTube من بيانات حقيقية. */
  async getYouTubeDailyBrief(): Promise<any> {
    const res = await fetch('/api/agent/youtube/watcher/brief', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل التقرير اليومي');
    return data.brief;
  },
  /** سجل عمليات الأتمتة (بلا أسرار). */
  async getYouTubeWatcherAudit(limit = 50): Promise<any[]> {
    const res = await fetch(`/api/agent/youtube/watcher/audit?limit=${limit}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل سجل الأتمتة');
    return data.audit || [];
  },
  /** تفاصيل رقم من التقرير اليومي: نفس السجلات التي كوّنته (بلا اختلاق). */
  async getYouTubeWatcherDetails(metric: string, filters: Record<string, string> = {}): Promise<any> {
    const qs = new URLSearchParams({ metric, ...filters }).toString();
    const res = await fetch(`/api/agent/youtube/watcher/details?${qs}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحميل تفاصيل التقرير');
    return data;
  },
  /** قرار مراجعة المالك على تعليق (للمالك فقط). */
  async reviewYouTubeWatcherComment(payload: { commentId: string; action: string; text?: string; note?: string }): Promise<any> {
    const res = await fetch('/api/agent/youtube/watcher/review', {
      method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تنفيذ قرار المراجعة');
    return data;
  },

  // --- طابور محتوى YouTube (نشر/جدولة/مراجعة بشرية) ---
  async getYouTubeContentQueue(): Promise<any> {
    const res = await fetch('/api/platforms/youtube/content/queue', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب طابور المحتوى');
    return data;
  },

  async getYouTubeContentDetails(metric: string): Promise<any> {
    const res = await fetch(`/api/platforms/youtube/content/details?metric=${encodeURIComponent(metric)}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب تفاصيل المحتوى');
    return data;
  },

  async createYouTubeContentDraft(payload: Record<string, any>): Promise<any> {
    const res = await fetch('/api/platforms/youtube/content/drafts', {
      method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || data.code || 'تعذر إنشاء عنصر المحتوى');
    return data;
  },

  async reviewYouTubeContentItem(id: string, payload: Record<string, any>): Promise<any> {
    const res = await fetch(`/api/platforms/youtube/content/queue/${encodeURIComponent(id)}/review`, {
      method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || data.code || 'تعذر تنفيذ قرار المحتوى');
    return data;
  },

  /** تنظيف بيانات الاختبار (owner): عرض افتراضاً، أو حذف تجريبي غير مرتبط بفيديو حقيقي. */
  async cleanupYouTubeContentTestData(dryRun = true): Promise<any> {
    const res = await fetch('/api/platforms/youtube/content/cleanup-test-data', {
      method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تنظيف بيانات الاختبار');
    return data;
  },

  /** توليد وصف تسويقي عبر العقل المركزي (owner) — من بيانات منتج/معرض حقيقية فقط. */
  async generateYouTubeContentDescription(payload: { productId?: string; productName?: string; extraInstructions?: string }): Promise<any> {
    const res = await fetch('/api/platforms/youtube/content/generate-description', {
      method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || data.code || 'تعذر توليد الوصف');
    return data;
  },

  async getYouTubeScheduleSuggestion(): Promise<any> {
    const res = await fetch('/api/platforms/youtube/content/schedule-suggestion', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر جلب اقتراح الجدولة');
    return data;
  },

  // --- النسخ السحابي والاستعادة (Google Drive / DR) — قراءة فقط ---
  /** صحة منظومة DR بلا أسرار (عام). */
  async getDrHealth(): Promise<any> {
    const res = await fetch('/api/dr/health');
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر قراءة حالة النسخ السحابي');
    return data;
  },

  /** لقطة مراقبة DR (owner) — بلا رفع/حذف. يحمل رمز HTTP على الخطأ لتصنيفه في الواجهة. */
  async getDrStatus(): Promise<any> {
    const res = await fetch('/api/dr/status', { headers: getAuthHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const err: any = new Error(data?.error || data?.code || 'تعذر قراءة حالة النسخ السحابي');
      err.status = res.status;
      err.code = data?.code;
      throw err;
    }
    return data;
  },

  /** رابط تفويض Google Drive (owner). لا يُعاد أي سرّ؛ تُستهلك الحالة على الخادم. */
  async getDrAuthUrl(): Promise<{ success: boolean; url: string; scope: string; redirectUri: string; ttlMs: number; expiresAt: string; authorized: boolean }> {
    const res = await fetch('/api/dr/drive/auth-url', { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || data.code || 'تعذر توليد رابط ربط Google Drive');
    return data;
  },

  /**
   * إنشاء نسخة احتياطية فعلية إلى Google Drive (owner). عملية كتابة على Drive
   * تمر بالمسار الرسمي الوحيد (فحص أسرار صارم + تشفير DB + تحقق فعلي). يحمل رمز
   * HTTP وحالة النسخة على الخطأ ليعرضها المستخدم صراحةً بلا ابتلاع.
   */
  async createDrBackup(): Promise<any> {
    const res = await fetch('/api/dr/backup', { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const err: any = new Error(data?.message || data?.error || data?.code || 'تعذّر إنشاء النسخة الاحتياطية');
      err.status = res.status;
      err.code = data?.code;
      err.state = data?.state;
      err.reason = data?.reason;
      throw err;
    }
    return data;
  },

  // --- منظومة التعافي الكامل (DR): مزامنة CURRENT + نقاط استعادة + استعادة ---
  /** مزامنة CURRENT الفعلية: مرآة الملفات الفردية ببنية المجلدات (owner). */
  async syncDrCurrent(): Promise<any> {
    const res = await fetch('/api/dr/sync', { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const err: any = new Error(data?.message || data?.error || data?.code || 'تعذّرت مزامنة CURRENT');
      err.status = res.status; err.code = data?.code; err.state = data?.state;
      throw err;
    }
    return data;
  },

  /** نقاط الاستعادة الكاملة + حالة CURRENT + حالة حزمة الأسرار (owner). */
  async getDrRecoveryPoints(): Promise<any> {
    const res = await fetch('/api/dr/recovery-points', { headers: getAuthHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const err: any = new Error(data?.error || data?.code || 'تعذّر قراءة نقاط الاستعادة');
      err.status = res.status; err.code = data?.code;
      throw err;
    }
    return data;
  },

  /** حالة المفتاح الرئيسي وحزمة الأسرار (owner) — أسماء وحالات بلا قيم سرّية. */
  async getDrSecretsStatus(): Promise<any> {
    const res = await fetch('/api/dr/secrets/status', { headers: getAuthHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const err: any = new Error(data?.error || data?.code || 'تعذّر قراءة حالة الأسرار');
      err.status = res.status; err.code = data?.code;
      throw err;
    }
    return data;
  },

  /** خطة الاستعادة (owner): عرض صادق قبل أي تنفيذ — بلا كتابة. */
  async getDrRestorePlan(point?: string): Promise<any> {
    const q = point ? `?point=${encodeURIComponent(point)}` : '';
    const res = await fetch(`/api/dr/restore/plan${q}`, { headers: getAuthHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const err: any = new Error(data?.error || data?.code || 'تعذّر بناء خطة الاستعادة');
      err.status = res.status; err.code = data?.code;
      throw err;
    }
    return data;
  },

  /** اختبار الاستعادة المعزول (owner): لا يلمس الإنتاج. */
  async drillDrRestore(point?: string): Promise<any> {
    const res = await fetch('/api/dr/restore/drill', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(point ? { point } : {}) });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const err: any = new Error(data?.error || data?.code || 'تعذّر تنفيذ اختبار الاستعادة');
      err.status = res.status; err.code = data?.code;
      throw err;
    }
    return data;
  },

  /** استعادة الإنتاج (owner): تتطلّب تأكيداً صريحاً؛ لا تُكتب فوق الإنتاج تلقائياً. */
  async requestProductionRestore(point?: string): Promise<any> {
    const res = await fetch('/api/dr/restore/production', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ ...(point ? { point } : {}), confirm: true }) });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const err: any = new Error(data?.error || data?.code || 'تعذّر بدء الاستعادة الإنتاجية');
      err.status = res.status; err.code = data?.code; err.steps = data?.steps;
      throw err;
    }
    return data;
  },

  // --- خزنة مفاتيح الطوارئ (Emergency Key Vault) — owner، بلا أي قيمة سرّية ---
  /** حالة الخزنة + الجرد المعتمد (أسماء/حالات/بصمات فقط). */
  async getDrKeyVaultStatus(): Promise<any> {
    const res = await fetch('/api/dr/key-vault/status', { headers: getAuthHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const err: any = new Error(data?.error || data?.code || 'تعذّر قراءة حالة خزنة المفاتيح');
      err.status = res.status; err.code = data?.code;
      throw err;
    }
    return data;
  },

  /** مزامنة الخزنة (owner): نسخة جديدة عند التغيّر فقط + تحقق + اعتماد. */
  async syncDrKeyVault(): Promise<any> {
    const res = await fetch('/api/dr/key-vault/sync', { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const err: any = new Error(data?.message || data?.error || data?.code || 'تعذّرت مزامنة خزنة المفاتيح');
      err.status = res.status; err.code = data?.code; err.state = data?.state;
      throw err;
    }
    return data;
  },

  /** إنشاء نسخة طوارئ من الخزنة (owner). */
  async backupDrKeyVault(): Promise<any> {
    const res = await fetch('/api/dr/key-vault/backup', { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const err: any = new Error(data?.message || data?.error || data?.code || 'تعذّر إنشاء نسخة خزنة المفاتيح');
      err.status = res.status; err.code = data?.code; err.state = data?.state;
      throw err;
    }
    return data;
  },

  /** فحص الخزنة (owner): فكّ تجريبي + تحقق تكامل — بلا كشف أي قيمة. */
  async verifyDrKeyVault(): Promise<any> {
    const res = await fetch('/api/dr/key-vault/verify', { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.verified) {
      const err: any = new Error(data?.message || data?.error || data?.code || 'فشل فحص خزنة المفاتيح');
      err.status = res.status; err.code = data?.code;
      throw err;
    }
    return data;
  },

  /** اختبار استعادة الخزنة (owner): فكّ في الذاكرة بلا أي كتابة إنتاجية. */
  async drillDrKeyVault(): Promise<any> {
    const res = await fetch('/api/dr/key-vault/drill', { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const err: any = new Error(data?.message || data?.error || data?.code || 'تعذّر اختبار استعادة خزنة المفاتيح');
      err.status = res.status; err.code = data?.code;
      throw err;
    }
    return data;
  }
};
