/**
 * خادم Instagram Graph وهمي محلي للاختبارات فقط.
 *
 * يُستخدم لتوجيه `FACEBOOK_GRAPH_API_BASE` إليه، فلا يلمس أي اختبار مزود Meta
 * الحقيقي ولا يستهلك أي حصة، ولا يستخدم أي سرّ واقعي. يغطّي مسار
 * Instagram API with Facebook Login: تبادل الرمز، اكتشاف الحساب المهني المرتبط
 * بالصفحة، إثبات الهوية، اشتراك webhook، الرد على تعليق، رسالة مباشرة، وإنشاء
 * حاوية النشر ثم نشرها.
 */

import express from 'express';
import type { Server } from 'node:http';

export interface InstagramAccountMock {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  /** حساب Instagram المهني المرتبط (null يعني صفحة بلا حساب مهني). */
  igAccountId: string | null;
  igUsername: string | null;
}

export interface InstagramMockState {
  accounts: InstagramAccountMock[];
  userAccessToken: string;
  failTokenExchange: boolean;
  failAccounts: boolean;
  failProfile: boolean;
  failSubscribe: boolean;
  failCommentReply: boolean;
  /** F-02: خطأ مخصّص للرد على تعليق (مثلاً `{ message: 'Session has expired', code: 190 }`). */
  replyError?: { message: string; code: number } | null;
  /** F-14: عدد مرات فشل قراءة هوية الحساب بـ503 قبل النجاح (إثبات إعادة القراءة). */
  profileTransientFailures: number;
  /** F-02: يرد قراءة الهوية بـOAuthException (190) — يقلب الاتصال إلى reauth_needed. */
  profileOAuthError: boolean;
  /** F-02/F-14: عدد محاولات الرد على التعليق فعلياً (إثبات عدم الإعادة على الكتابة). */
  commentReplyAttempts: number;
  failSend: boolean;
  failPublish: boolean;
  failPublishStep: boolean;
  subscribed: Record<string, string[]>;
  lastSubscribe: { pageId: string; fields: string } | null;
  commentReplies: { commentId: string; message: string; id: string }[];
  sentMessages: { pageId: string; recipientId: string; text: string; messageId: string }[];
  /** وسائط الحساب مع تعليقاتها الواردة (يقرأها المراقب عبر `/{ig-id}/media?fields=comments`). */
  feedMedia: { id: string; comments: { id: string; text: string; username?: string; from?: { id: string; name?: string }; created_time?: string }[] }[];
  containers: { igId: string; body: Record<string, string>; containerId: string }[];
  published: { igId: string; creationId: string; postId: string }[];
  /** تسلسل حالة الحاوية (status_code) الذي يُقرأ استعلاماً بعد آخر قيمة. */
  containerStatusSequence: string[];
  containerStatusReads: number;
  /** عدد نداءات القراءة المجمّعة (`GET /?ids=`) — لإثبات ≤ نداء واحد للتعليقات. */
  commentBatchCalls: number;
  /** يرفض الطلب المجمّع `GET /?ids=` كاملاً — لإثبات السقوط الآمن على إنستغرام. */
  failCommentBatch?: boolean;
  /** عدد نداءات قراءة تعليقات وسيط منفرد (`GET /{media-id}?fields=comments...`) — يجب أن يبقى 0. */
  commentNodeCalls: number;
  calls: number;
  validAppId: string;
  validAppSecret: string;
  /** سلوك حوار التفويض: consent = تطبيق صالح، invalid_app_id = صفحة «حدث خطأ ما». */
  dialogOutcome: 'consent' | 'login' | 'invalid_app_id' | 'opaque_200' | 'http_500' | 'business_login_surface' | 'classic_login_surface';
}

export function createInstagramMock(state: Partial<InstagramMockState> = {}): InstagramMockState {
  return {
    accounts: state.accounts ?? [
      { pageId: 'PAGE_IG_1', pageName: 'معرض الغرابي', pageAccessToken: 'PAGE_TOKEN_TEST', igAccountId: '17841400000000001', igUsername: 'algharabi.gallery' },
    ],
    userAccessToken: state.userAccessToken ?? 'IG_USER_TOKEN_TEST_LONG',
    failTokenExchange: false,
    failAccounts: false,
    failProfile: false,
    failSubscribe: false,
    failCommentReply: false,
    replyError: state.replyError ?? null,
    profileTransientFailures: state.profileTransientFailures ?? 0,
    profileOAuthError: false,
    commentReplyAttempts: 0,
    failSend: false,
    failPublish: false,
    failPublishStep: false,
    subscribed: {},
    lastSubscribe: null,
    commentReplies: [],
    sentMessages: [],
    feedMedia: state.feedMedia ?? [],
    containers: [],
    published: [],
    containerStatusSequence: state.containerStatusSequence ?? ['FINISHED'],
    containerStatusReads: 0,
    commentBatchCalls: 0,
    failCommentBatch: state.failCommentBatch ?? false,
    commentNodeCalls: 0,
    calls: 0,
    validAppId: state.validAppId ?? '145634995501895',
    validAppSecret: state.validAppSecret ?? 'test-fb-client-secret',
    dialogOutcome: state.dialogOutcome ?? 'consent',
  };
}

export async function startInstagramMockServer(
  port: number,
  state: InstagramMockState = createInstagramMock(),
): Promise<{ server: Server; state: InstagramMockState; base: string; stop: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Meta تحوّل مسار الجوال إلى مضيف الجوال؛ نُحاكي ذلك حتى يسلك الفحص السلسلة
  // كاملة (www → m) كما يفعل متصفح المالك، فلا يتوقّف التصنيف عند قفزة www.
  app.get('/mobile/dialog/oauth', (req, res) => {
    state.calls += 1;
    return res.redirect(302, `https://www.facebook.com/login.php?is_business_login=${state.dialogOutcome === 'classic_login_surface' ? '0' : '1'}`);
  });

  // صفحة الدخول: صفحة حقيقية (200) كما تفعل Meta، فلا تُصنَّف 404 خطأً.
  // قفزتها تحمل علم is_business_login الذي يحدّد واجهة Meta.
  app.get('/login.php', (req, res) => {
    state.calls += 1;
    return res.status(200).send('<html><head><title>Log in to Facebook</title></head><body>Log in</body></html>');
  });

  // حوار التفويض: نُحاكي سلوك Meta الحقيقي بترويسة Location بلا متابعة تحويل.
  app.get('/:version/dialog/oauth', (req, res) => {
    state.calls += 1;
    if (state.dialogOutcome === 'invalid_app_id') {
      return res.redirect(302, '/oauth/error/?error_code=PLATFORM__INVALID_APP_ID');
    }
    if (state.dialogOutcome === 'login') {
      return res.redirect(302, `https://www.facebook.com/login.php?next=${encodeURIComponent(String(req.originalUrl || ''))}`);
    }
    if (state.dialogOutcome === 'business_login_surface') {
      // Meta مع تطبيق Business وبلا config_id: قفزة الدخول على واجهة Business Login.
      return res.redirect(302, `https://www.facebook.com/login.php?is_business_login=1&next=${encodeURIComponent(String(req.originalUrl || ''))}`);
    }
    if (state.dialogOutcome === 'classic_login_surface') {
      // مع config_id: Facebook Login الكلاسيكي.
      return res.redirect(302, `https://www.facebook.com/login.php?is_business_login=0&next=${encodeURIComponent(String(req.originalUrl || ''))}`);
    }
    if (state.dialogOutcome === 'opaque_200') {
      // صفحة غير مفهومة بلا أي دليل رفض: لا يجوز الحجب بلا إثبات.
      return res.status(200).send('<html><body>Consent screen</body></html>');
    }
    if (state.dialogOutcome === 'http_500') {
      // HTTP 500 + «حدث خطأ ما»: رفض صريح لمجموعة الصلاحيات مقابل منتج التطبيق.
      return res.status(500).send('<html><body>Sorry, something went wrong. We\u2019re working on getting this fixed as soon as we can.</body></html>');
    }
    return res.redirect(302, `/v21.0/dialog/oauth?client_id=${String(req.query.client_id || '')}&state=${String(req.query.state || '')}`);
  });

  app.get('/:version/oauth/access_token', (req, res) => {
    state.calls += 1;
    if (req.query.grant_type === 'client_credentials') {
      if (String(req.query.client_id || '') !== state.validAppId) return res.status(400).json({ error: { message: 'Invalid Client ID', code: 101 } });
      if (String(req.query.client_secret || '') !== state.validAppSecret) return res.status(400).json({ error: { message: 'Error validating client secret.', code: 1 } });
      return res.json({ access_token: 'APP_TOKEN_TEST', token_type: 'bearer' });
    }
    if (state.failTokenExchange) return res.status(400).json({ error: { message: 'Invalid code', code: 100 } });
    if (req.query.grant_type === 'fb_exchange_token') return res.json({ access_token: state.userAccessToken, expires_in: 5_184_000 });
    if (!req.query.code) return res.status(400).json({ error: { message: 'Missing code' } });
    return res.json({ access_token: 'SHORT_USER_TOKEN', expires_in: 3600 });
  });

  // اكتشاف الصفحات + حساب Instagram المهني المرتبط.
  app.get('/:version/me/accounts', (req, res) => {
    state.calls += 1;
    if (state.failAccounts) return res.status(400).json({ error: { message: 'No pages', code: 190 } });
    return res.json({
      data: state.accounts.map((a) => ({
        id: a.pageId,
        name: a.pageName,
        access_token: a.pageAccessToken,
        instagram_business_account: a.igAccountId ? { id: a.igAccountId, username: a.igUsername } : undefined,
      })),
    });
  });

  // وسائط الحساب مع تعليقاتها: يقرأها مراقب Meta عبر
  // `GET /{ig-id}/media?fields=id,permalink_url,comments.order(reverse_chronological).summary(true).limit(N){id,text,username,from,created_time,permalink_url}`.
  // يُسجَّل **قبل** المسار العام `/:version/:id` كي لا يبتلعه.
  app.get('/:version/:igId/media', (req, res) => {
    const { igId } = req.params;
    state.calls += 1;
    const fields = String(req.query.fields || '');
    const data = state.feedMedia.map((m) => {
      let list = [...m.comments];
      if (/order\(reverse_chronological\)/.test(fields)) {
        list.sort((a, b) => Date.parse(String(b?.created_time || 0)) - Date.parse(String(a?.created_time || 0)));
      }
      const lim = fields.match(/limit\((\d+)\)/);
      if (lim) list = list.slice(0, Number(lim[1]));
      const wantPermalink = /permalink_url/.test(fields);
      return {
        id: m.id,
        ...(wantPermalink ? { permalink_url: `https://www.instagram.com/p/${String(m.id)}` } : {}),
        comments: {
          data: list.map((c) => ({
            id: c.id,
            text: c.text,
            username: c.username,
            from: c.from,
            created_time: c.created_time,
            ...(wantPermalink ? { permalink_url: `https://www.instagram.com/p/${String(m.id)}#${String(c.id)}` } : {}),
          })),
          summary: fields.includes('summary') ? { total_count: m.comments.length } : undefined,
        },
      };
    });
    return res.json({ data, paging: {} });
  });

  // القراءة المجمّعة (إصلاح حجم النداءات): `GET /?ids=<id1,id2,...>&fields=comments...`
  // تُعيد كائناً مفتاحه معرّف كل وسيط وقيمته تعليقاته — كما يفعل Graph الحقيقي.
  // يُسجَّل **قبل** `/:version/:id` وإلا التقطه كعقدة معرّفها فارغ.
  app.get('/:version/', (req, res) => {
    const idsRaw = String(req.query.ids || '').trim();
    if (!idsRaw) return res.status(400).json({ error: { message: 'ids required', code: 100 } });
    // يحاكي رفض Graph لشكل الطلب المجمّع كاملاً (لا على مستوى معرّف واحد).
    if (state.failCommentBatch) { state.calls += 1; state.commentBatchCalls += 1; return res.status(400).json({ error: { message: 'Unsupported get request for multiple ids.', code: 100 } }); }
    const fields = String(req.query.fields || '');
    const ids = idsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    state.calls += 1;
    state.commentBatchCalls += 1;
    const out: Record<string, unknown> = {};
    for (const id of ids) {
      const media = state.feedMedia.find((m) => m.id === id);
      out[id] = media
        ? { id, comments: fields.includes('comments') ? { data: media.comments.map((c) => ({ id: c.id, text: c.text, username: c.username, from: c.from, created_time: c.created_time })) } : undefined }
        : { error: { message: `Unsupported get request for object with ID ${id}`, code: 100 } };
    }
    return res.json(out);
  });

  // هوية صفحة أو حساب Instagram: التمييز بالمعرّف.
  app.get('/:version/:id', (req, res) => {
    const { id } = req.params;
    const fields = String(req.query.fields || '');
    state.calls += 1;
    // F-14: فشل عابر (503) على قراءة هوية الحساب — يُثبت أن إعادة القراءة تعمل.
    if (state.profileTransientFailures > 0 && !fields.includes('status_code')) {
      state.profileTransientFailures -= 1;
      return res.status(503).json({ error: { message: 'Service temporarily unavailable', code: 2 } });
    }
    // F-02: OAuthException (190) على قراءة الهوية — يقلب الاتصال إلى reauth_needed.
    if (state.profileOAuthError && !fields.includes('status_code')) {
      return res.status(400).json({ error: { message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190, error_subcode: 463 } });
    }
    if (state.failProfile) return res.status(400).json({ error: { message: 'Unsupported get request', code: 100 } });
    // تعليقات وسائط محدّدة (`GET /{media-id}?fields=comments.order(...){...}`) —
    // تُخدم لأي media معروف. تُثبت أن السحب يقرأ تعليقات منشورات النظام الفعلية.
    if (fields.includes('comments')) {
      const media = state.feedMedia.find((m) => m.id === id);
      if (media) {
        state.commentNodeCalls += 1;
        return res.json({ id: media.id, comments: { data: media.comments.map((c) => ({ id: c.id, text: c.text, username: c.username, from: c.from, created_time: c.created_time })) } });
      }
    }
    const account = state.accounts.find((a) => a.igAccountId === id);
    if (account) return res.json({ id: account.igAccountId, username: account.igUsername });
    const page = state.accounts.find((a) => a.pageId === id);
    if (page) {
      const out: Record<string, unknown> = { id: page.pageId };
      if (fields.includes('name')) out.name = page.pageName;
      if (fields.includes('access_token')) out.access_token = page.pageAccessToken;
      if (fields.includes('instagram_business_account') && page.igAccountId) out.instagram_business_account = { id: page.igAccountId, username: page.igUsername };
      return res.json(out);
    }
    // حاوية نشر: حقول الحالة. تُقرأ الحالة بالتسلسل المُهيَّأ (IN_PROGRESS ثم FINISHED
    // مثلاً) لإثبات أن النشر ينتظر الجاهزية فعلاً ولا يستدعي media_publish مبكراً.
    if (fields.includes('status_code')) {
      const seq = state.containerStatusSequence.length ? state.containerStatusSequence : ['FINISHED'];
      const idx = Math.min(state.containerStatusReads, seq.length - 1);
      const statusCode = seq[idx];
      state.containerStatusReads += 1;
      return res.json({ id, status_code: statusCode });
    }
    return res.status(400).json({ error: { message: 'Unknown object', code: 803 } });
  });

  app.post('/:version/:pageId/subscribed_apps', (req, res) => {
    const { pageId } = req.params;
    state.calls += 1;
    state.lastSubscribe = { pageId, fields: String(req.query.subscribed_fields || '') };
    if (state.failSubscribe) return res.status(400).json({ error: { message: 'Cannot subscribe', code: 200 } });
    const fields = String(req.query.subscribed_fields || '').split(',').filter(Boolean);
    state.subscribed[pageId] = fields;
    return res.json({ success: true });
  });

  app.get('/:version/:pageId/subscribed_apps', (req, res) => {
    const { pageId } = req.params;
    state.calls += 1;
    const fields = state.subscribed[pageId] || [];
    return res.json({ data: [{ id: 'APP_UNDER_TEST', subscribed_fields: fields }] });
  });

  app.post('/:version/:commentId/replies', (req, res) => {
    const { commentId } = req.params;
    state.calls += 1;
    state.commentReplyAttempts += 1;
    if (state.replyError) return res.status(400).json({ error: state.replyError });
    if (state.failCommentReply) return res.status(400).json({ error: { message: 'Cannot reply', code: 200 } });
    const message = String(req.body?.message || '');
    const id = `IG_REPLY_${commentId}_${state.commentReplies.length + 1}`;
    state.commentReplies.push({ commentId, message, id });
    return res.json({ id });
  });

  app.post('/:version/:pageId/messages', (req, res) => {
    const { pageId } = req.params;
    state.calls += 1;
    if (state.failSend) return res.status(400).json({ error: { message: 'Message not sent', code: 551 } });
    const recipientId = String(req.body?.recipient?.id || '');
    const text = String(req.body?.message?.text || '');
    const messageId = `mid.ig.${1000 + state.sentMessages.length}`;
    state.sentMessages.push({ pageId, recipientId, text, messageId });
    return res.json({ recipient_id: recipientId, message_id: messageId });
  });

  app.post('/:version/:igId/media', (req, res) => {
    const { igId } = req.params;
    state.calls += 1;
    if (state.failPublish) return res.status(400).json({ error: { message: 'Cannot create container', code: 9007 } });
    const containerId = `IG_CONTAINER_${state.containers.length + 1}`;
    state.containers.push({ igId, body: req.body || {}, containerId });
    return res.json({ id: containerId });
  });

  app.post('/:version/:igId/media_publish', (req, res) => {
    const { igId } = req.params;
    state.calls += 1;
    if (state.failPublish || state.failPublishStep) return res.status(400).json({ error: { message: 'Cannot publish', code: 200 } });
    const creationId = String(req.body?.creation_id || '');
    const postId = `IG_POST_${state.published.length + 1}`;
    state.published.push({ igId, creationId, postId });
    return res.json({ id: postId });
  });

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  return { server, state, base: `http://127.0.0.1:${port}`, stop: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
