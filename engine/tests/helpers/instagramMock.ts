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
  failSend: boolean;
  failPublish: boolean;
  failPublishStep: boolean;
  subscribed: Record<string, string[]>;
  lastSubscribe: { pageId: string; fields: string } | null;
  commentReplies: { commentId: string; message: string; id: string }[];
  sentMessages: { pageId: string; recipientId: string; text: string; messageId: string }[];
  containers: { igId: string; body: Record<string, string>; containerId: string }[];
  published: { igId: string; creationId: string; postId: string }[];
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
    failSend: false,
    failPublish: false,
    failPublishStep: false,
    subscribed: {},
    lastSubscribe: null,
    commentReplies: [],
    sentMessages: [],
    containers: [],
    published: [],
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

  // هوية صفحة أو حساب Instagram: التمييز بالمعرّف.
  app.get('/:version/:id', (req, res) => {
    const { id } = req.params;
    const fields = String(req.query.fields || '');
    state.calls += 1;
    if (state.failProfile) return res.status(400).json({ error: { message: 'Unsupported get request', code: 100 } });
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
    // حاوية نشر: حقول الحالة.
    if (fields.includes('status_code')) return res.json({ id, status_code: 'FINISHED' });
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
