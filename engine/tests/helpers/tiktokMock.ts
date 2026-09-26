/**
 * خادم TikTok وهمي محلي للاختبارات فقط.
 *
 * يُوجَّه إليه `TIKTOK_API_BASE` في الاختبارات، فلا يلمس أي مزود TikTok حقيقي
 * ولا يستهلك أي حصة. يحاكي النقاط الرسمية فقط:
 *   - /v2/oauth/token/  (exchange + refresh + revoke)
 *   - /v2/user/info/    (user.info.basic)
 *   - /v2/post/publish/creator_info/query/
 *   - /v2/post/publish/video/init/
 *   - /v2/post/publish/content/init/  (صور)
 *   - /v2/post/publish/status/fetch/
 *
 * كل الاستجابات بلا أي سرّ حقيقي، وتُسجَّل الطلبات لإثبات التنفيذ الفعلي.
 */

import express from 'express';
import type { Server } from 'node:http';

export interface TikTokMockState {
  /** رمز الوصول الذي يُعاد عند تبادل الرمز. */
  accessToken: string;
  /** refresh token الذي يُعاد. */
  refreshToken: string;
  /** open_id للحساب. */
  openId: string;
  displayName: string;
  /** الصلاحيات المُعادة (تفصل ما منحه المستخدم). */
  scope: string[];
  /** يفشل تبادل الرمز عند true. */
  failTokenExchange: boolean;
  /** يفشل التجديد عند true. */
  failRefresh: boolean;
  /** يفشل user/info عند true. */
  failUserInfo: boolean;
  /** يفشل creator info عند true. */
  failCreatorInfo: boolean;
  /** يفشل تهيئة النشر عند true. */
  failPublishInit: boolean;
  /** حالة النشر التي تُعاد من status/fetch. */
  publishStatus: string;
  /** سبب فشل النشر إن حُدِّد. */
  failReason: string | null;
  /** معرّف المنشور المتاح علناً عند PUBLISH_COMPLETE. */
  publiclyAvailablePostId: string | null;
  /** publish_id الذي يُعاد عند التهيئة. */
  publishId: string;
  /** privacy_level_options المُعادة في creator info. */
  privacyLevelOptions: string[];
  /** عدد استدعاءات النقاط — لإثبات التنفيذ الحقيقي. */
  calls: number;
  /** آخر تهيئة نشر (للتحقق من الوضع/الرابط). */
  lastPublishInit: { path: string; body: any; token: string } | null;
  /** آخر refresh (للتحقق من المعاملات). */
  lastRefresh: { clientKey: string; secretLen: number; refreshTokenLen: number } | null;
  /** آخر تبادل رمز. */
  lastExchange: { clientKey: string; secretLen: number; codeVerifierLen: number; redirectUri: string } | null;
  /** آخر إبطال رمز (للتحقق من أن المسار الرسمي المنفصل استُخدم). */
  lastRevoke: { path: string; clientKey: string; tokenLen: number } | null;
  /** رمز التطبيق المقبول (client_key). */
  validClientKey: string;
  /** السرّ المطابق. */
  validClientSecret: string;
}

export function createTikTokMock(state: Partial<TikTokMockState> = {}): TikTokMockState {
  return {
    accessToken: state.accessToken ?? 'act.tiktok_test_access_token',
    refreshToken: state.refreshToken ?? 'rft.tiktok_test_refresh_token',
    openId: state.openId ?? 'open_id_test_1234567890',
    displayName: state.displayName ?? 'معرض الغرابي للتقسيط',
    scope: state.scope ?? ['user.info.basic', 'video.publish', 'video.list'],
    failTokenExchange: state.failTokenExchange ?? false,
    failRefresh: state.failRefresh ?? false,
    failUserInfo: state.failUserInfo ?? false,
    failCreatorInfo: state.failCreatorInfo ?? false,
    failPublishInit: state.failPublishInit ?? false,
    publishStatus: state.publishStatus ?? 'PUBLISH_COMPLETE',
    failReason: state.failReason ?? null,
    publiclyAvailablePostId: state.publiclyAvailablePostId ?? 'video_post_id_9876543210',
    publishId: state.publishId ?? 'publish_id_test_abc123',
    privacyLevelOptions: state.privacyLevelOptions ?? ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
    calls: 0,
    lastPublishInit: null,
    lastRefresh: null,
    lastExchange: null,
    lastRevoke: null,
    validClientKey: state.validClientKey ?? 'test_tiktok_client_key',
    validClientSecret: state.validClientSecret ?? 'test-tiktok-client-secret-not-real',
  };
}

export async function startTikTokMockServer(
  port: number,
  state: TikTokMockState = createTikTokMock(),
): Promise<{ server: Server; state: TikTokMockState; base: string; stop: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // تبادل الرمز/التجديد/الإبطال: نقطة واحدة رسمية /v2/oauth/token/.
  app.post('/v2/oauth/token/', (req, res) => {
    state.calls += 1;
    const body = req.body || {};
    const grantType = String(body.grant_type || '');
    const clientKey = String(body.client_key || '');
    const secret = String(body.client_secret || '');
    if (clientKey !== state.validClientKey || secret !== state.validClientSecret) {
      return res.status(400).json({ error: 'invalid_client', error_description: 'Client key or secret invalid' });
    }
    if (grantType === 'authorization_code') {
      state.lastExchange = { clientKey, secretLen: secret.length, codeVerifierLen: String(body.code_verifier || '').length, redirectUri: String(body.redirect_uri || '') };
      if (state.failTokenExchange) return res.status(400).json({ error: 'invalid_grant', error_description: 'code expired' });
      return res.json({
        access_token: state.accessToken,
        refresh_token: state.refreshToken,
        open_id: state.openId,
        scope: state.scope.join(','),
        expires_in: 86400,
        refresh_expires_in: 31536000,
        token_type: 'Bearer',
      });
    }
    if (grantType === 'refresh_token') {
      state.lastRefresh = { clientKey, secretLen: secret.length, refreshTokenLen: String(body.refresh_token || '').length };
      if (state.failRefresh) return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh token expired' });
      return res.json({
        access_token: `${state.accessToken}_refreshed`,
        refresh_token: `${state.refreshToken}_refreshed`,
        open_id: state.openId,
        scope: state.scope.join(','),
        expires_in: 86400,
        refresh_expires_in: 31536000,
        token_type: 'Bearer',
      });
    }
    // revoke: مسار منفصل رسمياً. وجود الطلب على /v2/oauth/token/ بلا grant_type
    // يُرد invalid_request (سلوك TikTok الفعلي) — فلا يُقبل الإبطال من مسار الرمز.
    return res.status(400).json({ error: 'invalid_request', error_description: 'The request parameters are malformed.' });
  });

  // إبطال الرمز — المسار الرسمي المنفصل (مطابق لـTIKTOK_REVOKE_PATH).
  app.post('/v2/oauth/revoke/', (req, res) => {
    state.calls += 1;
    const body = req.body || {};
    const clientKey = String(body.client_key || '');
    const secret = String(body.client_secret || '');
    state.lastRevoke = { path: '/v2/oauth/revoke/', clientKey, tokenLen: String(body.token || '').length };
    if (clientKey !== state.validClientKey || secret !== state.validClientSecret) {
      return res.status(400).json({ error: 'invalid_client', error_description: 'Client key or secret invalid' });
    }
    if (body.grant_type) {
      // الوثيقة: الإبطال يأخذ client_key + client_secret + token بلا grant_type.
      return res.status(400).json({ error: 'invalid_request', error_description: 'grant_type not allowed' });
    }
    // TikTok يُعيد {} عند نجاح الإبطال.
    return res.json({});
  });

  app.get('/v2/user/info/', (req, res) => {
    state.calls += 1;
    if (state.failUserInfo) return res.status(401).json({ error: { code: 'access_token_invalid', message: 'invalid token' } });
    return res.json({
      data: { user: { open_id: state.openId, union_id: 'union_test', display_name: state.displayName, avatar_url: 'https://example.invalid/avatar.jpg' } },
      error: { code: 'ok', message: '', log_id: 'log_test' },
    });
  });

  app.post('/v2/post/publish/creator_info/query/', (req, res) => {
    state.calls += 1;
    if (state.failCreatorInfo) return res.status(400).json({ error: { code: 'scope_not_authorized', message: 'video.publish not granted' } });
    return res.json({
      data: {
        creator_avatar_url: 'https://example.invalid/avatar.jpg',
        creator_username: 'algharabi',
        creator_nickname: state.displayName,
        privacy_level_options: state.privacyLevelOptions,
        comment_disabled: false,
        duet_disabled: false,
        stitch_disabled: false,
        max_video_post_duration_sec: 600,
      },
      error: { code: 'ok', message: '', log_id: 'log_test' },
    });
  });

  app.post('/v2/post/publish/video/init/', (req, res) => {
    state.calls += 1;
    state.lastPublishInit = { path: 'video', body: req.body, token: String(req.headers.authorization || '') };
    if (state.failPublishInit) return res.status(400).json({ error: { code: 'unaudited_client_can_only_post_to_private_accounts', message: 'audit required' } });
    return res.json({
      data: { publish_id: state.publishId, upload_url: 'https://open-upload.tiktokapis.com/upload/test' },
      error: { code: 'ok', message: '', log_id: 'log_test' },
    });
  });

  // Upload API الرسمي (رفع مسودة): مسار مختلف عن Direct Post وبجسم source_info فقط.
  app.post('/v2/post/publish/inbox/video/init/', (req, res) => {
    state.calls += 1;
    state.lastPublishInit = { path: 'inbox', body: req.body, token: String(req.headers.authorization || '') };
    if (state.failPublishInit) return res.status(400).json({ error: { code: 'spam_risk_too_many_pending_share', message: 'upload cap reached' } });
    return res.json({
      data: { publish_id: state.publishId, upload_url: 'https://open-upload.tiktokapis.com/upload/test' },
      error: { code: 'ok', message: '', log_id: 'log_test' },
    });
  });

  app.post('/v2/post/publish/content/init/', (req, res) => {
    state.calls += 1;
    state.lastPublishInit = { path: 'content', body: req.body, token: String(req.headers.authorization || '') };
    if (state.failPublishInit) return res.status(400).json({ error: { code: 'unaudited_client_can_only_post_to_private_accounts', message: 'audit required' } });
    return res.json({
      data: { publish_id: state.publishId },
      error: { code: 'ok', message: '', log_id: 'log_test' },
    });
  });

  app.post('/v2/post/publish/status/fetch/', (req, res) => {
    state.calls += 1;
    const data: any = { status: state.publishStatus };
    if (state.failReason) data.fail_reason = state.failReason;
    if (state.publishStatus === 'PUBLISH_COMPLETE' && state.publiclyAvailablePostId) data.publicaly_available_post_id = [state.publiclyAvailablePostId];
    return res.json({ data, error: { code: 'ok', message: '', log_id: 'log_test' } });
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
