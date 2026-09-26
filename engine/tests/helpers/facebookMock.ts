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
  /** يفشل إرسال رسالة عند true. */
  failSend: boolean;
  /** يفشل النشر عند true. */
  failPublish: boolean;
  /** اشتراكات كل صفحة (page-id → app-ids). */
  subscribed: Record<string, string[]>;
  /** آخر طلب اشتراك (للتحقق). */
  lastSubscribe: { pageId: string; fields: string; token: string } | null;
  /** الردود على التعليقات المُرسلة. */
  commentReplies: { commentId: string; message: string; token: string; id: string }[];
  /** الرسائل المُرسلة. */
  sentMessages: { pageId: string; recipientId: string; text: string; messageId: string }[];
  /** منشورات الصفحة. */
  posts: { pageId: string; message: string; postId: string }[];
  /** عدد استدعاءات نقاط الشبكة — لإثبات التنفيذ الحقيقي. */
  calls: number;
  /** معرّف التطبيق الذي يقبله الخادم الوهمي في client_credentials. */
  validAppId: string;
  /** سرّ التطبيق المطابق. */
  validAppSecret: string;
  /** آخر فحص رمز تطبيق (بلا سرّ كامل، فقط الطول للتحقق). */
  lastAppTokenCheck: { clientId: string; secretLen: number } | null;
  /** سلوك حوار التفويض: consent = تطبيق صالح، invalid_app_id = صفحة «حدث خطأ ما»،
   * http_500 = فشل Meta العام (500 + «حدث خطأ ما») عندما لا تُتحقق مجموعة الصلاحيات. */
  dialogOutcome: 'consent' | 'login' | 'invalid_app_id' | 'opaque_200' | 'http_500';
  /** إن حُدِّدت: يرد الحوار 500 فقط عندما تحمل مجموعة scope هذه الصلاحية (لعزل السبب). */
  failingScope?: string | null;
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
    failSend: false,
    failPublish: false,
    subscribed: {},
    lastSubscribe: null,
    commentReplies: [],
    sentMessages: [],
    posts: [],
    calls: 0,
    validAppId: state.validAppId ?? '145634995501895',
    validAppSecret: state.validAppSecret ?? 'test-fb-client-secret',
    lastAppTokenCheck: null,
    // استجابة حوار التفويض: consent (تطبيق صالح) | login | invalid_app_id (صفحة «حدث خطأ ما»).
    dialogOutcome: state.dialogOutcome ?? 'consent',
    failingScope: state.failingScope ?? null,
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
    if (state.dialogOutcome === 'opaque_200') {
      // صفحة غير مفهومة بلا أي دليل رفض: لا يجوز الحجب بلا إثبات.
      return res.status(200).send('<html><body>Consent screen</body></html>');
    }
    if (state.dialogOutcome === 'http_500') {
      // ما تردّه Meta فعلياً عندما لا تُتحقق مجموعة scope مقابل منتج التطبيق:
      // HTTP 500 مع الصفحة العامة «حدث خطأ ما» (بلا error_code في الترويسة).
      return res.status(500).send('<html><body>Sorry, something went wrong. We\u2019re working on getting this fixed as soon as we can.</body></html>');
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

  app.get('/:version/:pageId', (req, res) => {
    const { pageId } = req.params;
    if (!pageId || pageId === 'me') return res.status(400).json({ error: { message: 'unsupported' } });
    state.calls += 1;
    if (state.failPageProfile) return res.status(400).json({ error: { message: 'Unsupported get request', code: 100 } });
    const page = state.pages.find((p) => p.id === pageId);
    if (!page) return res.status(400).json({ error: { message: 'Unknown page', code: 803 } });
    const fields = String(req.query.fields || '');
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
    if (state.failCommentReply) return res.status(400).json({ error: { message: 'Cannot reply', code: 200 } });
    const message = String(req.body?.message || '');
    const id = `REPLY_${commentId}_${state.commentReplies.length + 1}`;
    state.commentReplies.push({ commentId, message, token: String(req.headers.authorization || ''), id });
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

  app.post('/:version/:pageId/feed', (req, res) => {
    const { pageId } = req.params;
    state.calls += 1;
    if (state.failPublish) return res.status(400).json({ error: { message: 'Cannot publish', code: 200 } });
    const message = String(req.body?.message || '');
    const postId = `${pageId}_${2000 + state.posts.length}`;
    state.posts.push({ pageId, message, postId });
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
