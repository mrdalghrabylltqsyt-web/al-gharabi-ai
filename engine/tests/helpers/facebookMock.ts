/**
 * خادم Facebook Graph وهمي محلي للاختبارات فقط.
 *
 * يُستخدم لتوجيه `FACEBOOK_GRAPH_API_BASE` إليه في الاختبارات، فلا يلمس أي
 * اختبار مزود Meta الحقيقي ولا يستهلك أي حصة. يفصل بوضوح بين بيئة الاختبار
 * والـRuntime الحقيقي (حيث القاعدة الرسمية graph.facebook.com).
 *
 * يغطّي: تبادل الرمز (code + fb_exchange_token)، الصفحات (me/accounts)،
 * هوية الصفحة، اشتراك التطبيق (subscribed_apps)، الرد على تعليق، رسالة
 * Messenger، والنشر على الصفحة. كلها بلا أي سرّ حقيقي.
 */

import express from 'express';
import type { Server } from 'node:http';

export interface FacebookPageMock {
  id: string;
  name: string;
  accessToken: string;
  tasks: string[];
}

export interface FacebookMockState {
  pages: FacebookPageMock[];
  /** رمز مستخدم يُعاد عند تبادل الرمز (يُعاد إطالته أيضاً). */
  userAccessToken: string;
  /** يفشل تبادل الرمز عند true. */
  failTokenExchange: boolean;
  /** يفشل جلب الصفحات عند true. */
  failPages: boolean;
  /** يفشل إثبات هوية الصفحة عند true. */
  failPageProfile: boolean;
  /** يفشل اشتراك التطبيق عند true. */
  failSubscribe: boolean;
  /** يفشل الرد على تعليق عند true. */
  failCommentReply: boolean;
  /**
   * F-02: خطأ مخصّص للرد على التعليق (مثلاً `{ message: 'Session has expired', code: 190 }`)
   * لمحاكاة OAuthException حقيقي من Meta يُقلب الاتصال إلى reauth_needed.
   */
  replyError?: { message: string; code: number } | null;
  /**
   * F-14: عدد المرات التي يرد فيها `GET /{page-id}` بخطأ عابر (503) قبل النجاح —
   * لإثبات أن إعادة المحاولة على القراءة تعمل ثم تنجح فعلاً.
   */
  pageNodeTransientFailures: number;
  /** F-14: إذا حُدِّد، أول `GET /{page-id}` يرد 429 مع Retry-After ثم يُصفَّر. */
  pageNodeRetryAfterOnce: string | null;
  /**
   * F-02: إذا true، يرد `GET /{page-id}` بـOAuthException (كود 190) — يُثبت أن
   * فحص health الحقيقي يقلب الاتصال إلى reauth_needed بدل ادعاء الصحة.
   */
  pageNodeOAuthError: boolean;
  /**
   * F-14: محاكاة «انقطاع بعد الإرسال» في **النشر** (POST /{page-id}/feed): يُسجَّل
   * المنشور فعلياً ثم يُقطع الاتصال — لإثبات عدم وجود إعادة تلقائية للكتابة.
   */
  hangPublish: boolean;
  /**
   * F-07: محاكاة «انقطاع بعد الإرسال» — يُسجَّل الرد فعلياً (كأن المزود نفّذه)
   * ثم لا يُرسل أي استجابة فينقطع الاتصال. يُثبت أن الانقطاع لا يُصنَّف فشلاً مؤكداً.
   */
  hangCommentReply: boolean;
  /** يفشل إرسال رسالة عند true. */
  failSend: boolean;
  /** يفشل النشر عند true. */
  failPublish: boolean;
  /** اشتراكات كل صفحة (page-id → app-ids). */
  subscribed: Record<string, string[]>;
  /** آخر طلب اشتراك (للتحقق). */
  lastSubscribe: { pageId: string; fields: string; token: string } | null;
  /** آخر حقل fields طُلب من إثبات هوية الصفحة (GET /{page-id}) — لكشف طلب tasks الزائد. */
  lastPageProfileFields: string | null;
  /** عدد استدعاءات GET /{page-id} (يجب أن يبقى 0 في مسار الربط بعد الإصلاح). */
  pageProfileCalls: number;
  /** الردود على التعليقات المُرسلة. */
  commentReplies: { commentId: string; message: string; token: string; id: string }[];
  /** F-02/F-14: عدد محاولات الرد على التعليق فعلياً (يُثبت عدم الإعادة على الكتابة). */
  commentReplyAttempts: number;
  /** الرسائل المُرسلة. */
  sentMessages: { pageId: string; recipientId: string; text: string; messageId: string }[];
  /** منشورات الصفحة. */
  posts: { pageId: string; message: string; postId: string }[];
  /** فيديوهات الصفحة المرفوعة من رابط عام (`file_url`). */
  videos: { pageId: string; fileUrl: string; description: string; videoId: string; published?: boolean }[];
  /** صور الصفحة المنشورة من رابط عام (`url`) عبر `POST /{page-id}/photos`. */
  photos: { pageId: string; imageUrl: string; message: string; postId: string }[];
  /** عدد استدعاءات نقاط الشبكة — لإثبات التنفيذ الحقيقي. */
  calls: number;
  /** معرّف التطبيق الذي يقبله الخادم الوهمي في client_credentials. */
  validAppId: string;
  /** سرّ التطبيق المطابق. */
  validAppSecret: string;
  /** آخر فحص رمز تطبيق (بلا سرّ كامل، فقط الطول للتحقق). */
  lastAppTokenCheck: { clientId: string; secretLen: number } | null;
  /** سلوك حوار التفويض: consent = تطبيق صالح، invalid_app_id = صفحة «حدث خطأ ما»،
   * http_500 = فشل Meta العام (500 + «حدث خطأ ما») عندما لا تُتحقق مجموعة الصلاحيات.
   * mobile_redirect_then_fail = مسار الجوال الحقيقي: www → m.facebook.com (encrypted_query_string)
   *   ثم فشل جوال — يُثبت أن الفحص يجب أن يسلك السلسلة لا أول قفزة فقط. */
  dialogOutcome: 'consent' | 'login' | 'invalid_app_id' | 'opaque_200' | 'http_500' | 'mobile_redirect_then_fail' | 'business_login_surface' | 'classic_login_surface';
  /** إن حُدِّدت: يرد الحوار 500 فقط عندما تحمل مجموعة scope هذه الصلاحية (لعزل السبب). */
  failingScope?: string | null;
  /** صلاحيات رمز الصفحة الممنوحة فعلاً (يُعيدها /debug_token) — للتشخيص. */
  grantedScopes?: string[];
  /** نوع الرمز الذي يُعيده /debug_token (PAGE عادةً). */
  debugTokenType?: string;
  /** خطأ مخصّص لنشر الفيديو (يحاكي #100 لا صلاحية) — لاختبار حفظ التشخيص وسحبه. */
  publishVideoError?: { message: string; code: number; error_subcode?: number; fbtrace_id?: string } | null;
  /** اسم التطبيق/الشركة/النطاقات المعلنة في عقدة /{app-id} (محاكاة Graph). */
  appName?: string;
  appCompany?: string;
  appDomains?: string[];
  /** أدوار المطوّر على التطبيق (GET /{app-id}/roles) — تُظهر معرّف المستخدم الفعلي. */
  appRoles?: Array<{ user: string; role: string }>;
  /** حافظات الأعمال التي يراها الرمز الحالي (GET /me/businesses). */
  userBusinesses?: Array<{ id: string; name: string; permitted_roles: string[] }>;
  failUserBusinesses?: boolean;
  /** معرّف الحافظة وتطبيقاتها (GET /{business-id}/owned_apps). */
  businessId?: string;
  ownedApps?: string[];
  failOwnedApps?: boolean;
  /** منشورات الصفحة وتعليقاتها (GET /{page-id}/feed) — لقراءة تعليقات المراقب. */
  feedPosts?: Array<{ id: string; message?: string; description?: string; comments?: Array<{ id: string; message?: string; from?: { id?: string; name?: string }; created_time?: string; parent?: { id?: string }; permalink_url?: string }>; commentsTotalCount?: number }>;
  /**
   * منشورات فيديو/ريلز للصفحة (`GET /{page-id}/videos` و`/{page-id}/video_reels`) —
   * لإثبات أن سحب التعليقات يقرأ من كل أنواع المنشورات لا من `/feed` وحده.
   */
  pageVideos?: Array<{ id: string; message?: string; description?: string; comments?: Array<{ id: string; message?: string; from?: { id?: string; name?: string }; created_time?: string; parent?: { id?: string }; permalink_url?: string }>; commentsTotalCount?: number }>;
  pageReels?: Array<{ id: string; message?: string; description?: string; comments?: Array<{ id: string; message?: string; from?: { id?: string; name?: string }; created_time?: string; parent?: { id?: string }; permalink_url?: string }>; commentsTotalCount?: number }>;
  failFeed?: boolean;
  /** عدد نداءات القراءة المجمّعة (`GET /?ids=`) — لإثبات ≤ نداء واحد لـ45 منشوراً. */
  commentBatchCalls: number;
  /** يرفض الطلب المجمّع `GET /?ids=` كاملاً (يحاكي رفض Graph لشكل الطلب) — لإثبات السقوط الآمن. */
  failCommentBatch?: boolean;
  /** عدد نداءات قراءة تعليقات منشور منفرد (`GET /{post-id}?fields=comments...`) — يجب أن يبقى 0. */
  commentNodeCalls: number;
  /** PR-S4: معرّفات التعليقات التي أُعيدت فعلاً في قراءات الحواف (لإثبات أيها قُرئ). */
  commentIdsReturned: string[];
  /** PR-S4: حقول `comments...` التي طُلبت فعلاً في كل قراءة حافة (لإثبات filter(stream)). */
  commentFieldsSeen: string[];
  /** خطأ مخصّص لقراءة عقدة المنشور `GET /{post-id}?fields=...` يحاكي #100
   *  «Tried accessing nonexisting field (is_published)» — لإثبات إصلاح الجذر. */
  nodeFieldsError?: { message: string; code: number } | null;
  /** حقول عقدة غير مدعومة (يُرفض أي طلب يضمّها بـ#100) — لعزل الحقول حقلاً حقلاً. */
  unsupportedNodeFields?: string[];
  /** سجلّ الحقول المطلوبة في كل قراءة عقدة (للتحقق من السقوط للاحتياطي والاختبار الحقلي). */
  nodeFieldReads: string[];
}

export function createFacebookMock(state: Partial<FacebookMockState> = {}): FacebookMockState {
  return {
    pages: state.pages ?? [{ id: 'PAGE_123', name: 'معرض الغرابي', accessToken: 'PAGE_TOKEN_TEST', tasks: ['CREATE_CONTENT', 'MODERATE'] }],
    userAccessToken: state.userAccessToken ?? 'USER_TOKEN_TEST_LONG',
    failTokenExchange: false,
    failPages: false,
    failPageProfile: false,
    failSubscribe: false,
    failCommentReply: false,
    replyError: state.replyError ?? null,
    pageNodeTransientFailures: state.pageNodeTransientFailures ?? 0,
    pageNodeRetryAfterOnce: state.pageNodeRetryAfterOnce ?? null,
    pageNodeOAuthError: false,
    hangPublish: false,
    hangCommentReply: false,
    failSend: false,
    failPublish: false,
    subscribed: {},
    lastSubscribe: null,
    lastPageProfileFields: null,
    pageProfileCalls: 0,
    commentReplies: [],
    commentReplyAttempts: 0,
    sentMessages: [],
    posts: [],
    videos: [],
    photos: [],
    calls: 0,
    validAppId: state.validAppId ?? '145634995501895',
    validAppSecret: state.validAppSecret ?? 'test-fb-client-secret',
    lastAppTokenCheck: null,
    // استجابة حوار التفويض: consent (تطبيق صالح) | login | invalid_app_id (صفحة «حدث خطأ ما»).
    dialogOutcome: state.dialogOutcome ?? 'consent',
    failingScope: state.failingScope ?? null,
    grantedScopes: state.grantedScopes ?? ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list', 'pages_messaging'],
    debugTokenType: state.debugTokenType ?? 'PAGE',
    publishVideoError: state.publishVideoError ?? null,
    appName: state.appName,
    appCompany: state.appCompany,
    appDomains: state.appDomains,
    appRoles: state.appRoles ?? [{ user: '100000000000001', role: 'administrators' }],
    userBusinesses: state.userBusinesses ?? [{ id: 'BIZ_999', name: 'عباس الغرابي', permitted_roles: ['ADMIN'] }],
    failUserBusinesses: state.failUserBusinesses ?? false,
    businessId: state.businessId ?? 'BIZ_999',
    ownedApps: state.ownedApps ?? [state.validAppId ?? '145634995501895'],
    failOwnedApps: state.failOwnedApps ?? false,
    feedPosts: state.feedPosts ?? [],
    pageVideos: state.pageVideos ?? [],
    pageReels: state.pageReels ?? [],
    failFeed: state.failFeed ?? false,
    commentBatchCalls: 0,
    failCommentBatch: state.failCommentBatch ?? false,
    commentNodeCalls: 0,
    commentIdsReturned: [],
    commentFieldsSeen: [],
    nodeFieldsError: state.nodeFieldsError ?? null,
    unsupportedNodeFields: state.unsupportedNodeFields ?? [],
    nodeFieldReads: [],
  };
}

/** يشغّل الخادم الوهمي ويعيد المنفذ + حالة التحكم. */
export async function startFacebookMockServer(
  port: number,
  state: FacebookMockState = createFacebookMock(),
): Promise<{ server: Server; state: FacebookMockState; base: string; stop: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  // قراءة الجسم الخام أيضاً (Meta توقّع الجسم الخام) — غير مطلوب هنا لكنه آمن.
  app.use(express.urlencoded({ extended: false }));

  // مضيف الجوال الوهمي (m.facebook.com): يُسجَّل **قبل** المسار العام
  // `/:version/dialog/oauth` لأن Express يطابق حسب ترتيب التسجيل، ولولا ذلك
  // لالتقط المسار العام `:version='mobile'` بدل مسار الجوال المقصود.
  // الأول يعيد صفحة خطأ الجوال، والثاني صفحة «Invalid App ID» بصيغة الجوال.
  app.get('/mobile/dialog/oauth', (_req, res) => {
    state.calls += 1;
    return res.status(200).send('<html><head><title>Error</title></head><body>Facebook Error Login Error: There is an error in logging you into this application. Please try again later.</body></html>');
  });
  app.get('/mobile/oauth/error', (_req, res) => {
    state.calls += 1;
    return res.status(200).send('<html><head><title>Error</title></head><body>Invalid App ID: The provided app ID does not look like a valid app ID.</body></html>');
  });

  // صفحة تسجيل الدخول الوهمية: تُسجَّل **قبل** `/:version/dialog/oauth` لأن
  // Express يطابق حسب الترتيب، ولولا ذلك لالتقطها المسار العام بـ`version='login.php'`.
  // وجودها يسمح للفحص بسلوك قفزة «login» الفعلية (كما يحدث مع Meta الحقيقي).
  app.get('/login.php', (req, res) => {
    state.calls += 1;
    return res.status(200).send('<html><head><title>Log in to Facebook</title></head><body>Log in</body></html>');
  });

  // حوار التفويض: نُحاكي سلوك Meta الحقيقي بترويسة Location بلا متابعة تحويل.
  app.get('/:version/dialog/oauth', (req, res) => {
    state.calls += 1;
    // عزل السبب: 500 فقط عندما تحمل المجموعة الصلاحية المسبّبة (كما تفعل Meta فعلاً).
    if (state.failingScope) {
      const reqScopes = String(req.query.scope || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (reqScopes.includes(state.failingScope)) {
        return res.status(500).send('<html><body>Sorry, something went wrong. We\u2019re working on getting this fixed as soon as we can.</body></html>');
      }
      return res.redirect(302, `/v21.0/dialog/oauth?client_id=${String(req.query.client_id || '')}&state=${String(req.query.state || '')}`);
    }
    if (state.dialogOutcome === 'invalid_app_id') {
      return res.redirect(302, '/oauth/error/?error_code=PLATFORM__INVALID_APP_ID');
    }
    if (state.dialogOutcome === 'login') {
      return res.redirect(302, `https://www.facebook.com/login.php?next=${encodeURIComponent(String(req.originalUrl || ''))}`);
    }
    if (state.dialogOutcome === 'business_login_surface') {
      // سلوك Meta الحقيقي المُثبت: مع تطبيق Facebook Login for Business وبلا
      // config_id تُوجَّه قفزة الدخول إلى واجهة Business Login (is_business_login=1)
      // التي تقرأ الصلاحيات من Configuration لا من scope.
      return res.redirect(302, `https://www.facebook.com/login.php?is_business_login=1&next=${encodeURIComponent(String(req.originalUrl || ''))}`);
    }
    if (state.dialogOutcome === 'classic_login_surface') {
      // العكس: مع config_id تُوجَّه Meta إلى Facebook Login الكلاسيكي (is_business_login=0).
      return res.redirect(302, `https://www.facebook.com/login.php?is_business_login=0&next=${encodeURIComponent(String(req.originalUrl || ''))}`);
    }
    if (state.dialogOutcome === 'opaque_200') {
      // صفحة غير مفهومة بلا أي دليل رفض: لا يجوز الحجب بلا إثبات.
      return res.status(200).send('<html><body>Consent screen</body></html>');
    }
    if (state.dialogOutcome === 'http_500') {
      // ما تردّه Meta فعلياً عندما لا تُتحقق مجموعة scope مقابل منتج التطبيق:
      // HTTP 500 مع الصفحة العامة «حدث خطأ ما» (بلا error_code في الترويسة).
      return res.status(500).send('<html><body>Sorry, something went wrong. We\u2019re working on getting this fixed as soon as we can.</body></html>');
    }
    if (state.dialogOutcome === 'mobile_redirect_then_fail') {
      // يحاكي سلوك Meta الحقيقي حسب User-Agent: مع وكيل جوال يحوّل إلى مضيف
      // m.facebook.com (كما يفعل www.facebook.com فعلاً) ثم يفشل هناك. هذا هو
      // الجذر المُثبت: أول قفزة تبدو مقبولة (تحويل داخلي)، والفشل في قفزة تالية.
      const ua = String(req.headers['user-agent'] || '');
      if (/iPhone|Android|Mobile/i.test(ua)) {
        // كل نداء بوكيل جوال يحوّل إلى مضيف الجوال (كما تفعل Meta فعلاً)، والفشل
        // يُخدم من مسار الجوال لا من www — فلا حلقة لأن مضيف الجوال لا يعيد التحويل.
        return res.redirect(302, `https://m.facebook.com/mobile/dialog/oauth?client_id=${String(req.query.client_id || '')}&state=${String(req.query.state || '')}&encrypted_query_string=MOCK`);
      }
      return res.redirect(302, `https://www.facebook.com/login.php?next=${encodeURIComponent(String(req.originalUrl || ''))}`);
    }
    return res.redirect(302, `/v21.0/dialog/oauth?client_id=${String(req.query.client_id || '')}&state=${String(req.query.state || '')}`);
  });

  app.get('/:version/oauth/access_token', (req, res) => {
    state.calls += 1;
    if (req.query.grant_type === 'client_credentials') {
      const clientId = String(req.query.client_id || '');
      const secret = String(req.query.client_secret || '');
      state.lastAppTokenCheck = { clientId, secretLen: secret.length };
      if (clientId !== state.validAppId) return res.status(400).json({ error: { message: 'Invalid Client ID', type: 'OAuthException', code: 101 } });
      if (secret !== state.validAppSecret) return res.status(400).json({ error: { message: 'Error validating client secret.', type: 'OAuthException', code: 1 } });
      return res.json({ access_token: 'APP_TOKEN_TEST', token_type: 'bearer' });
    }
    if (state.failTokenExchange) return res.status(400).json({ error: { message: 'Invalid code', type: 'OAuthException', code: 100 } });
    if (req.query.grant_type === 'fb_exchange_token') {
      return res.json({ access_token: state.userAccessToken, token_type: 'bearer', expires_in: 5_184_000 });
    }
    if (!req.query.code) return res.status(400).json({ error: { message: 'Missing code' } });
    return res.json({ access_token: 'SHORT_USER_TOKEN', token_type: 'bearer', expires_in: 3600 });
  });

  app.get('/:version/me/accounts', (req, res) => {
    state.calls += 1;
    if (state.failPages) return res.status(400).json({ error: { message: 'No pages', code: 190 } });
    return res.json({ data: state.pages.map((p) => ({ id: p.id, name: p.name, access_token: p.accessToken, tasks: p.tasks })) });
  });

  // حافظات الأعمال التي يراها الرمز الحالي (GET /me/businesses) — تمييز هوية الحساب.
  app.get('/:version/me/businesses', (req, res) => {
    state.calls += 1;
    if (state.failUserBusinesses) return res.status(400).json({ error: { message: 'Permissions error', code: 200 } });
    return res.json({ data: state.userBusinesses });
  });

  // فحص رمز الصفحة (GET /debug_token) — يستلزم app access token. يُعيد الصلاحيات
  // الممنوحة فعلاً، فتُحسم مشكلة «#100 لا صلاحية» بلا تخمين (تحديد الصلاحية الناقصة).
  // يُسجَّل قبل /:version/:pageId وإلا التقطه كصفحة اسمها debug_token.
  app.get('/:version/debug_token', (req, res) => {
    state.calls += 1;
    const inputToken = String(req.query.input_token || '');
    const appToken = String(req.query.access_token || '');
    if (!inputToken || !appToken) return res.status(400).json({ error: { message: 'input_token and access_token required', code: 100 } });
    return res.json({ data: { is_valid: true, type: state.debugTokenType, app_id: 'APP_UNDER_TEST', scopes: state.grantedScopes, expires_at: 0 } });
  });

  // أدوار المطوّر على التطبيق (GET /{app-id}/roles) — تُظهر معرّف المستخدم الفعلي.
  app.get('/:version/:appId/roles', (req, res) => {
    const { appId } = req.params;
    state.calls += 1;
    if (appId !== state.validAppId) return res.status(400).json({ error: { message: 'Invalid app id', code: 100 } });
    return res.json({ data: state.appRoles });
  });

  // تطبيقات الحافظة (GET /{business-id}/owned_apps) — إثبات عكسي قراءة-فقط.
  app.get('/:version/:businessId/owned_apps', (req, res) => {
    const { businessId } = req.params;
    state.calls += 1;
    if (state.failOwnedApps) return res.status(400).json({ error: { message: 'Permissions error', code: 200 } });
    if (businessId !== state.businessId) return res.status(400).json({ error: { message: 'Unknown business', code: 803 } });
    return res.json({ data: state.ownedApps.map((id) => ({ id, name: 'app' })) });
  });

  // القراءة المجمّعة (إصلاح حجم النداءات): `GET /?ids=<id1,id2,...>&fields=comments...`
  // تُعيد كائناً مفتاحه معرّف كل منشور وقيمته تعليقاته — كما يفعل Graph الحقيقي.
  // يُسجَّل **قبل** `/:version/:pageId` وإلا التقطه كعقدة منشور اسمها فارغ.
  app.get('/:version/', (req, res) => {
    const idsRaw = String(req.query.ids || '').trim();
    if (!idsRaw) return res.status(400).json({ error: { message: 'ids required', code: 100 } });
    // يحاكي رفض Graph لشكل الطلب المجمّع كاملاً (لا على مستوى معرّف واحد).
    if (state.failCommentBatch) { state.calls += 1; state.commentBatchCalls += 1; return res.status(400).json({ error: { message: 'Unsupported get request for multiple ids.', code: 100 } }); }
    const fields = String(req.query.fields || '');
    const ids = idsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const known = [...(state.feedPosts || []), ...(state.pageVideos || []), ...(state.pageReels || [])];
    state.calls += 1;
    state.commentBatchCalls += 1;
    const out: Record<string, unknown> = {};
    for (const id of ids) {
      const post = known.find((p) => p.id === id);
      // معرّف غير معروف ⇒ خطأ منفصل له وحده (لا يُسقط الباقي) — كما في Graph.
      out[id] = post
        ? { id, comments: fields.includes('comments') ? { data: post.comments || [] } : undefined }
        : { error: { message: `Unsupported get request for object with ID ${id}`, code: 100 } };
    }
    return res.json(out);
  });

  app.get('/:version/:pageId', (req, res) => {
    const { pageId } = req.params;
    if (!pageId || pageId === 'me') return res.status(400).json({ error: { message: 'unsupported' } });
    const fields = String(req.query.fields || '');
    // محاكاة #100 «حقل غير موجود» على عقدة المنشور/الفيديو (is_published على Video):
    // يُطبَّق أولاً على أي عقدة في وضع الحقل غير المدعوم، فتبدو العقدة كأن النوع لا
    // يدعم الحقل (لا 803 «صفحة غير معروفة»).
    if (state.unsupportedNodeFields?.length || state.nodeFieldsError) {
      state.calls += 1;
      state.nodeFieldReads.push(fields);
      const requested = fields.split(',').map((s) => s.trim()).filter(Boolean);
      const unsupported = requested.find((f) => (state.unsupportedNodeFields || []).includes(f));
      if (unsupported) {
        return res.status(400).json({ error: { message: `Tried accessing nonexisting field (${unsupported}) on node type "Video"`, code: 100 } });
      }
      if (state.nodeFieldsError) {
        return res.status(400).json({ error: { message: state.nodeFieldsError.message, code: state.nodeFieldsError.code } });
      }
      // وضع التشخيص: أي معرّف يُعامل كعقدة منشور حقيقية تدعم الحقول المدعومة.
      const out: Record<string, unknown> = { id: pageId, created_time: '2026-01-01T00:00:00+0000' };
      if (fields.includes('permalink_url')) out.permalink_url = `https://www.facebook.com/${pageId}`;
      if (fields.includes('is_published')) out.is_published = true;
      return res.json(out);
    }
    // قراءة تعليقات منشور محدّد (`GET /{post-id}?fields=comments.order(...){...}`) —
    // يعيد التعليقات لأي منشور معروف (feed/videos/video_reels). يُثبت أن السحب
    // يقرأ من كل أنواع المنشورات لا من /feed وحده.
    if (fields.includes('comments')) {
      const known = [...(state.feedPosts || []), ...(state.pageVideos || []), ...(state.pageReels || [])].find((p) => p.id === pageId);
      if (known) {
        state.calls += 1;
        state.commentNodeCalls += 1;
        return res.json({ id: known.id, comments: { data: known.comments || [] } });
      }
    }
    // قراءة حالة فيديو/منشور أُنشئ عبر API (GET /{video-id}) — لمسارات تشخيص الظهور.
    // تُخدم قبل منطق الصفحة: المعرّف يطابق فيديو سبق إنشاؤه.
    const vid = state.videos.find((v) => v.videoId === pageId);
    if (vid) {
      state.calls += 1;
      return res.json({ id: vid.videoId, is_published: vid.published !== false, created_time: '2026-01-01T00:00:00+0000' });
    }
    // عقدة التطبيق `GET /{app-id}?fields=id,name,company,app_domains`: تُخدم عندما
    // يطابق المعرّف معرّف التطبيق الصالح — تحاكي Graph الحقيقي بلا اختراع حقل `business`.
    if (pageId === state.validAppId) {
      state.calls += 1;
      const appFields = String(req.query.fields || '');
      const out: Record<string, unknown> = { id: state.validAppId };
      if (appFields.includes('name')) out.name = state.appName ?? 'معرض الغرابي -صفحات';
      if (appFields.includes('company')) out.company = state.appCompany ?? 'الغرابي';
      if (appFields.includes('app_domains')) out.app_domains = state.appDomains ?? ['al-gharabi-ai.onrender.com'];
      return res.json(out);
    }
    state.calls += 1;
    state.pageProfileCalls += 1;
    // F-14: خطأ عابر (503) على قراءة عقدة الصفحة — يُثبت أن إعادة المحاولة تعمل.
    if (state.pageNodeTransientFailures > 0) {
      state.pageNodeTransientFailures -= 1;
      return res.status(503).json({ error: { message: 'Service temporarily unavailable', code: 2 } });
    }
    // F-14: 429 مع Retry-After مرة واحدة — يُثبت احترام المدة المطلوبة.
    if (state.pageNodeRetryAfterOnce) {
      const ra = state.pageNodeRetryAfterOnce;
      state.pageNodeRetryAfterOnce = null;
      res.setHeader('Retry-After', ra);
      return res.status(429).json({ error: { message: 'Rate limited', code: 4 } });
    }
    if (state.failPageProfile) return res.status(400).json({ error: { message: 'Unsupported get request', code: 100 } });
    // F-02: OAuthException حقيقي (190) على قراءة عقدة الصفحة — يقلب الاتصال.
    if (state.pageNodeOAuthError) return res.status(400).json({ error: { message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190, error_subcode: 463 } });
    const page = state.pages.find((p) => p.id === pageId);
    if (!page) return res.status(400).json({ error: { message: 'Unknown page', code: 803 } });
    state.lastPageProfileFields = fields;
    const out: Record<string, unknown> = { id: page.id };
    if (fields.includes('name')) out.name = page.name;
    if (fields.includes('access_token')) out.access_token = page.accessToken;
    if (fields.includes('tasks')) out.tasks = page.tasks;
    return res.json(out);
  });

  app.post('/:version/:pageId/subscribed_apps', (req, res) => {
    const { pageId } = req.params;
    state.calls += 1;
    state.lastSubscribe = { pageId, fields: String(req.query.subscribed_fields || ''), token: String(req.query.access_token || '') };
    if (state.failSubscribe) return res.status(400).json({ error: { message: 'Cannot subscribe', code: 200 } });
    state.subscribed[pageId] = ['APP_UNDER_TEST'];
    return res.json({ success: true });
  });

  app.get('/:version/:pageId/subscribed_apps', (req, res) => {
    const { pageId } = req.params;
    state.calls += 1;
    const apps = state.subscribed[pageId] || [];
    return res.json({ data: apps.map((id) => ({ id, name: 'app' })) });
  });

  app.post('/:version/:commentId/comments', (req, res) => {
    const { commentId } = req.params;
    state.calls += 1;
    state.commentReplyAttempts += 1;
    if (state.replyError) return res.status(400).json({ error: state.replyError });
    if (state.failCommentReply) return res.status(400).json({ error: { message: 'Cannot reply', code: 200 } });
    const message = String(req.body?.message || '');
    const id = `REPLY_${commentId}_${state.commentReplies.length + 1}`;
    state.commentReplies.push({ commentId, message, token: String(req.headers.authorization || ''), id });
    if (state.hangCommentReply) { try { res.socket?.destroy(); } catch { /* تجاهل */ } return; }
    return res.json({ id });
  });

  app.post('/:version/:pageId/messages', (req, res) => {
    const { pageId } = req.params;
    state.calls += 1;
    if (state.failSend) return res.status(400).json({ error: { message: 'Message not sent', code: 551 } });
    const recipientId = String(req.body?.recipient?.id || '');
    const text = String(req.body?.message?.text || '');
    const messageId = `mid.${1000 + state.sentMessages.length}`;
    state.sentMessages.push({ pageId, recipientId, text, messageId });
    return res.json({ recipient_id: recipientId, message_id: messageId });
  });

  // حائط الصفحة (قراءة تعليقات) — `GET /{page-id}/feed`. يُستخدم في السحب
  // الاحتياطي للمراقب (قراءة-فقط). يعيد المنشورات وتعليقاتها المتداخلة.
  app.get('/:version/:pageId/feed', (req, res) => {
    state.calls += 1;
    if (state.failFeed) return res.status(400).json({ error: { message: 'Permissions error', code: 200 } });
    const fields = String(req.query.fields || '');
    const rows = (state.feedPosts || []).map((p) => ({
      id: p.id,
      created_time: '2026-01-01T00:00:00+0000',
      message: p.message,
      description: p.description,
      comments: p.comments ? applyCommentFields(p.comments, fields) : undefined,
    }));
    return res.json({ data: rows });
  });

  // منشورات الفيديو (`GET /{page-id}/videos`) والريلز (`/{page-id}/video_reels`).
  // منفصلة عن /feed كما في Graph الحقيقي — تُثبت أن السحب يقرأ من كل الأنواع.
  // تُعيد التعليقات مضمَّنة عند طلبها (كما يفعل Graph) ليعمل السقوط الآمن.
  //
  // PR-S4: تُحترم مُعدِّلات الحقل الحقيقية: `filter(toplevel)` (الافتراضي) يستبعد
  // الردود المتداخلة (تعليقات لها `parent`)، و`filter(stream)` يُدخلها، و
  // `order(reverse_chronological)` يرتّب الأحدث أولاً، و`limit(N)` يقتطع، و
  // `summary(true)` يُعيد `total_count` المُعلَن، و`permalink_url` يُعاد عند طلبه.
  const applyCommentFields = (comments: any[] | undefined, fields: string) => {
    let list = Array.isArray(comments) ? [...comments] : [];
    if (fields.includes('comments')) {
      state.commentFieldsSeen.push(fields);
      if (/filter\(stream\)/.test(fields)) {
        // stream = كل المستويات (بما فيها الردود).
      } else {
        list = list.filter((c) => !c?.parent?.id);
      }
      if (/order\(reverse_chronological\)/.test(fields)) {
        list.sort((a, b) => Date.parse(String(b?.created_time || 0)) - Date.parse(String(a?.created_time || 0)));
      } else if (/order\(chronological\)/.test(fields)) {
        list.sort((a, b) => Date.parse(String(a?.created_time || 0)) - Date.parse(String(b?.created_time || 0)));
      }
      const m = fields.match(/limit\((\d+)\)/);
      if (m) list = list.slice(0, Number(m[1]));
      const wantPermalink = /permalink_url/.test(fields);
      list = list.map((c) => (wantPermalink && !c.permalink_url ? { ...c, permalink_url: `https://www.facebook.com/${String(c.id)}` } : c));
      state.commentIdsReturned.push(...list.map((c: any) => String(c.id)));
      return { data: list, summary: fields.includes('summary') ? { total_count: comments ? comments.length : 0 } : undefined };
    }
    return undefined;
  };
  const listPostRows = (rows?: Array<{ id: string; message?: string; description?: string; comments?: any[]; commentsTotalCount?: number }>, fields = '') => (rows || []).map((p) => ({
    id: p.id,
    created_time: '2026-01-01T00:00:00+0000',
    message: p.message,
    description: p.description,
    comments: p.comments ? applyCommentFields(p.comments, fields) : undefined,
  }));
  app.get('/:version/:pageId/videos', (req, res) => { state.calls += 1; return res.json({ data: listPostRows(state.pageVideos, String(req.query.fields || '')) }); });
  app.get('/:version/:pageId/video_reels', (req, res) => { state.calls += 1; return res.json({ data: listPostRows(state.pageReels, String(req.query.fields || '')) }); });

  app.post('/:version/:pageId/feed', (req, res) => {
    const { pageId } = req.params;
    state.calls += 1;
    if (state.failPublish) return res.status(400).json({ error: { message: 'Cannot publish', code: 200 } });
    const message = String(req.body?.message || '');
    const postId = `${pageId}_${2000 + state.posts.length}`;
    state.posts.push({ pageId, message, postId });
    // F-14: انقطاع بعد الإرسال — المنشور نُفِّذ فعلاً ثم يُقطع الاتصال، فلا إعادة تلقائية.
    if (state.hangPublish) { try { res.socket?.destroy(); } catch { /* تجاهل */ } return; }
    return res.json({ id: postId });
  });

  // نشر فيديو على الصفحة من رابط عام (`file_url`) — Task #22. يُثبت أن التوزيع
  // الموحّد يمرّر videoUrl الحقيقي لفيسبوك لا النص فقط. `published` صريح (افتراضيه
  // في Graph true) — يُحفظ لإثبات أننا لا نحول الفيديو لمسودة.
  app.post('/:version/:pageId/videos', (req, res) => {
    const { pageId } = req.params;
    state.calls += 1;
    if (state.publishVideoError) return res.status(400).json({ error: state.publishVideoError });
    if (state.failPublish) return res.status(400).json({ error: { message: 'Cannot publish video', code: 200 } });
    const fileUrl = String(req.body?.file_url || '');
    const description = String(req.body?.description || '');
    const published = String(req.body?.published ?? 'true') !== 'false';
    const videoId = `${pageId}_v${3000 + state.videos.length}`;
    state.videos.push({ pageId, fileUrl, description, videoId, published });
    return res.json({ id: videoId });
  });

  // حائط الصفحة (المنشورات المنشورة) — `GET /{page-id}/published_posts`. يُستخدم
  // كدليل ظهور فعلي. يُعيد معرّفات الفيديوهات المنشورة (`published !== false`) كلها.
  app.get('/:version/:pageId/published_posts', (req, res) => {
    const { pageId } = req.params;
    state.calls += 1;
    const rows = state.videos.filter((v) => v.pageId === pageId && v.published !== false).map((v) => ({ id: v.videoId }));
    return res.json({ data: rows });
  });

  // نشر صورة على الصفحة من رابط عام (`url`) — `POST /{page-id}/photos`. يُثبت أن
  // وسيط الصورة (imageUrl) يُمرَّر فعلاً لفيسبوك بدل إسقاطه والنشر نصياً.
  app.post('/:version/:pageId/photos', (req, res) => {
    const { pageId } = req.params;
    state.calls += 1;
    if (state.failPublish) return res.status(400).json({ error: { message: 'Cannot publish photo', code: 200 } });
    const imageUrl = String(req.body?.url || '');
    const message = String(req.body?.message || '');
    const postId = `${pageId}_${4000 + state.photos.length}`;
    state.photos.push({ pageId, imageUrl, message, postId });
    return res.json({ id: postId });
  });

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  return {
    server,
    state,
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
