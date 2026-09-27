/**
 * خادم Google/YouTube وهمي محلي للاختبارات فقط.
 *
 * يُوجَّه إليه `YOUTUBE_TOKEN_BASE` و`YOUTUBE_API_BASE` في الاختبارات، فلا يلمس
 * أي مزود Google حقيقي ولا يستهلك أي حصة. يحاكي النقاط الرسمية فقط:
 *   - /token   (تبادل الرمز + التجديد)
 *   - /youtube/v3/channels  (channels.list?mine=true — إثبات هوية القناة عبر youtube.readonly)
 *
 * كل الاستجابات بلا أي سرّ حقيقي، وتُسجَّل الطلبات لإثبات التنفيذ الفعلي.
 */

import express from 'express';
import type { Server } from 'node:http';

export interface YouTubeMockState {
  accessToken: string;
  refreshToken: string;
  channelId: string;
  channelTitle: string;
  uploadsPlaylistId: string;
  scope: string[];
  failTokenExchange: boolean;
  failRefresh: boolean;
  /** يفشل قراءة القناة بـ403 insufficientPermissions (يحاكي غياب youtube.readonly). */
  failChannelsInsufficient: boolean;
  /** يعيد items فارغة (حساب بلا قناة YouTube). */
  emptyChannel: boolean;
  /** صلاحية القراءة: عند false يُعيد 403 insufficientPermissions. */
  hasReadonlyScope: boolean;
  calls: number;
  lastExchange: { clientId: string; secretLen: number; redirectUri: string } | null;
  lastRefresh: { clientId: string; secretLen: number } | null;
  /** آخر scope مُعاد في رمز الوصول — للتحقق من النطاقات المطلوبة فعلاً. */
  lastGrantedScope: string[];
  /** آخر Authorization header وصل لقراءة القناة. */
  lastChannelsAuth: string | null;
  /** آخر مسار طُلب — يثبت أن channels.list?mine=true هو المستخدم فعلاً. */
  lastChannelsPath: string | null;
}

export function createYouTubeMock(): YouTubeMockState {
  return {
    accessToken: 'ya29.test-access-token-not-real',
    refreshToken: '1//test-refresh-token-not-real',
    channelId: 'UC_TEST_CHANNEL_0001',
    channelTitle: 'قناة الغرابي التجريبية',
    uploadsPlaylistId: 'UU_TEST_CHANNEL_0001',
    scope: [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.upload',
    ],
    failTokenExchange: false,
    failRefresh: false,
    failChannelsInsufficient: false,
    emptyChannel: false,
    hasReadonlyScope: true,
    calls: 0,
    lastExchange: null,
    lastRefresh: null,
    lastGrantedScope: [],
    lastChannelsAuth: null,
    lastChannelsPath: null,
  };
}

export function startYouTubeMockServer(state: YouTubeMockState, port: number): Promise<{ server: Server; state: YouTubeMockState; base: string; stop: () => Promise<void> }> {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // تبادل/تجديد رمز Google: x-www-form-urlencoded على /token.
  app.post('/token', (req, res) => {
    state.calls += 1;
    const grant = String(req.body?.grant_type || '');
    if (grant === 'refresh_token') {
      state.lastRefresh = { clientId: String(req.body?.client_id || ''), secretLen: String(req.body?.client_secret || '').length };
      if (state.failRefresh) return res.status(400).json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      // التجديد يعيد access_token بلا refresh_token جديد (سلوك Google).
      return res.json({ access_token: state.accessToken, expires_in: 3600, scope: state.scope.join(' ') });
    }
    // authorization_code
    state.lastExchange = { clientId: String(req.body?.client_id || ''), secretLen: String(req.body?.client_secret || '').length, redirectUri: String(req.body?.redirect_uri || '') };
    if (state.failTokenExchange) return res.status(400).json({ error: 'invalid_grant', error_description: 'Bad Request' });
    state.lastGrantedScope = state.scope;
    return res.json({ access_token: state.accessToken, refresh_token: state.refreshToken, expires_in: 3600, token_type: 'Bearer', scope: state.scope.join(' ') });
  });

  // إثبات هوية القناة: channels.list?mine=true (نطاق youtube.readonly).
  app.get('/youtube/v3/channels', (req, res) => {
    state.calls += 1;
    state.lastChannelsPath = req.originalUrl;
    state.lastChannelsAuth = String(req.headers.authorization || '');
    if (state.failChannelsInsufficient || !state.hasReadonlyScope) {
      return res.status(403).json({ error: { code: 403, message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions', message: 'Insufficient Permission' }] } });
    }
    if (state.emptyChannel) return res.json({ kind: 'youtube#channelListResponse', items: [] });
    return res.json({
      kind: 'youtube#channelListResponse',
      items: [{
        kind: 'youtube#channel',
        id: state.channelId,
        snippet: { title: state.channelTitle },
        contentDetails: { relatedPlaylists: { uploads: state.uploadsPlaylistId } },
      }],
    });
  });

  return new Promise((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => resolve({
      server,
      state,
      base: `http://127.0.0.1:${port}`,
      stop: () => new Promise<void>((r) => server.close(() => r())),
    }));
  });
}
