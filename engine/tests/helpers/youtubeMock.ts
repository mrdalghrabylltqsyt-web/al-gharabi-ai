/**
 * خادم Google/YouTube وهمي محلي للاختبارات فقط.
 *
 * يُوجَّه إليه `YOUTUBE_API_BASE` (Data API) و`YOUTUBE_GOOGLE_BASE` (token/revoke)
 * في الاختبارات، فلا يُلمس أي مزود Google حقيقي ولا تُستهلك أي حصة.
 *
 * يحاكي النقاط الرسمية فقط:
 *   - POST /token           (تبادل الرمز + التجديد)
 *   - POST /revoke          (إبطال الرمز)
 *   - GET  /youtube/v3/channels         (channels.list)
 *   - GET  /youtube/v3/playlists        (playlists.list)
 *   - GET  /youtube/v3/search           (search.list)
 *   - GET  /youtube/v3/videos           (videos.list)
 *   - GET  /youtube/v3/commentThreads   (commentThreads.list)
 *   - POST /youtube/v3/comments         (comments.insert)
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
  /** النطاقات المُعادة عند التبادل. */
  scope: string[];
  /** معرّف التعليق الناتج عن الرد. */
  replyCommentId: string;
  /** يفشل تبادل الرمز. */
  failTokenExchange: boolean;
  /** رمز خطأ OAuth المُعاد عند فشل التبادل (invalid_grant/access_denied/redirect_uri_mismatch). */
  tokenExchangeError: string;
  /** رمز خطأ OAuth المُعاد عند فشل التجديد. */
  refreshError: string;
  /** رمز خطأ OAuth المُعاد عند التبادل (error_description). */
  tokenExchangeErrorDescription: string;
  /** يفشل التجديد. */
  failRefresh: boolean;
  /** يفشل channels.list بـ401 لاختبار reauth. */
  failChannelsAuth: boolean;
  /** حقن خطأ عام على استدعاءات Data API (رمز HTTP + سبب Google + وصف). */
  apiError: { status: number; reason?: string; message?: string } | null;
  /** يجعل القناة بلا فيديوهات (search يعيد []). */
  videosEmpty: boolean;
  /** يجعل الفيديو بلا تعليقات (commentThreads يعيد []). */
  commentsEmpty: boolean;
  /** يفشل أي استدعاء Data API بخطأ حصة quotaExceeded حقيقي. */
  quotaExceeded: boolean;
  /** عدد استدعاءات Data API. */
  apiCalls: number;
  /** آخر مسار Data API مُستدعى. */
  lastApiPath: string | null;
  /** آخر تبادل رمز. */
  lastExchange: { clientId: string; secretLen: number; redirectUri: string; code: string } | null;
  /** آخر تجديد. */
  lastRefresh: { clientId: string; refreshTokenLen: number } | null;
  /** آخر إبطال. */
  lastRevoke: { tokenLen: number } | null;
  /** آخر رد على تعليق. */
  lastReply: { parentId: string; text: string } | null;
  /** قائمة الفيديوهات المُعادة. */
  videos: Array<{ videoId: string; title: string; viewCount: string; likeCount: string; commentCount: string }>;
  /** قائمة التعليقات المُعادة. */
  comments: Array<{ commentId: string; videoId: string; authorName: string; text: string }>;
}

export function createYouTubeMock(state: Partial<YouTubeMockState> = {}): YouTubeMockState {
  return {
    accessToken: state.accessToken ?? 'ya29.test_youtube_access_token',
    refreshToken: state.refreshToken ?? '1//test_youtube_refresh_token',
    channelId: state.channelId ?? 'UC_test_channel_1234567890',
    channelTitle: state.channelTitle ?? 'معرض الغرابي للتقسيط',
    scope: state.scope ?? ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.force-ssl'],
    replyCommentId: state.replyCommentId ?? 'Ugz_reply_comment_id_123',
    failTokenExchange: state.failTokenExchange ?? false,
    tokenExchangeError: state.tokenExchangeError ?? 'invalid_grant',
    tokenExchangeErrorDescription: state.tokenExchangeErrorDescription ?? 'code expired',
    failRefresh: state.failRefresh ?? false,
    refreshError: state.refreshError ?? 'invalid_grant',
    failChannelsAuth: state.failChannelsAuth ?? false,
    apiError: state.apiError ?? null,
    videosEmpty: state.videosEmpty ?? false,
    commentsEmpty: state.commentsEmpty ?? false,
    quotaExceeded: state.quotaExceeded ?? false,
    apiCalls: 0,
    lastApiPath: null,
    lastExchange: null,
    lastRefresh: null,
    lastRevoke: null,
    lastReply: null,
    videos: state.videos ?? [
      { videoId: 'vid_aaa111', title: 'تقسيط غسالات — شرح', viewCount: '1234', likeCount: '56', commentCount: '7' },
      { videoId: 'vid_bbb222', title: 'عرض الثلاجات', viewCount: '4321', likeCount: '88', commentCount: '3' },
    ],
    comments: state.comments ?? [
      { commentId: 'Ugz_comment_top_1', videoId: 'vid_aaa111', authorName: 'أحمد', text: 'بكم سعر الغسالة بالتقسيط؟' },
      { commentId: 'Ugz_comment_reply_1', videoId: 'vid_aaa111', authorName: 'سارة', text: 'شكراً على الشرح' },
    ],
  };
}

/** يستخرج معرّف الفيديو المطلوب من query. */
function videoIdFrom(body: any, items: any[]): string {
  const vid = typeof body?.snippet?.videoId === 'string' ? body.snippet.videoId : '';
  return vid || items[0]?.videoId || 'vid_aaa111';
}

export async function startYouTubeMockServer(
  port: number,
  state: YouTubeMockState = createYouTubeMock(),
): Promise<{ server: Server; state: YouTubeMockState; base: string; stop: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // تبادل/تجديد الرمز (Google token endpoint).
  app.post('/token', (req, res) => {
    const body = req.body || {};
    const grantType = String(body.grant_type || '');
    if (grantType === 'authorization_code') {
      state.lastExchange = { clientId: String(body.client_id || ''), secretLen: String(body.client_secret || '').length, redirectUri: String(body.redirect_uri || ''), code: String(body.code || '') };
      if (state.failTokenExchange) return res.status(400).json({ error: state.tokenExchangeError, error_description: state.tokenExchangeErrorDescription });
      return res.json({ access_token: state.accessToken, refresh_token: state.refreshToken, scope: state.scope.join(' '), expires_in: 3600, token_type: 'Bearer' });
    }
    if (grantType === 'refresh_token') {
      state.lastRefresh = { clientId: String(body.client_id || ''), refreshTokenLen: String(body.refresh_token || '').length };
      if (state.failRefresh) return res.status(400).json({ error: state.refreshError, error_description: 'Token has been expired or revoked.' });
      // Google لا يُعيد refresh_token عند التجديد.
      return res.json({ access_token: `${state.accessToken}_refreshed`, scope: state.scope.join(' '), expires_in: 3600, token_type: 'Bearer' });
    }
    return res.status(400).json({ error: 'unsupported_grant_type' });
  });

  app.post('/revoke', (req, res) => {
    const token = String(req.query.token || '');
    state.lastRevoke = { tokenLen: token.length };
    return res.json({});
  });

  // وسيط يفرض الحصة على كل استدعاءات Data API (خطأ Google الحقيقي).
  const guard = (path: string, handler: (req: express.Request, res: express.Response) => void): express.RequestHandler => (req, res) => {
    state.apiCalls += 1;
    state.lastApiPath = path;
    if (state.quotaExceeded) {
      res.status(403).json({ error: { code: 403, message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded', message: 'quota exceeded' }] } });
      return;
    }
    if (state.failChannelsAuth && path === '/youtube/v3/channels') {
      res.status(401).json({ error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError', message: 'invalid token' }] } });
      return;
    }
    // حقن خطأ عام محكوم للاختبار الهجومي: rate limit / 403 / 404 / 500 / صلاحية.
    if (state.apiError) {
      const { status, reason, message } = state.apiError;
      res.status(status).json({ error: { code: status, message: message || `injected ${status}`, errors: reason ? [{ reason, message: message || `injected ${status}` }] : [] } });
      return;
    }
    handler(req, res);
  };

  app.get('/youtube/v3/channels', guard('/youtube/v3/channels', (req, res) => {
    const id = String(req.query.id || '');
    res.json({ items: [{
      id: id || state.channelId,
      snippet: { title: state.channelTitle, description: 'قناة المعرض', publishedAt: '2020-01-01T00:00:00Z', thumbnails: { default: { url: 'https://example.invalid/t.jpg' } } },
      statistics: { viewCount: '99999', subscriberCount: '1234', videoCount: '42', hiddenSubscriberCount: false },
      contentDetails: { relatedPlaylists: { uploads: 'UU_test' } },
    }] });
  }));

  app.get('/youtube/v3/playlists', guard('/youtube/v3/playlists', (_req, res) => {
    res.json({ items: [
      { id: 'PL_list_1', snippet: { title: 'عروض التقسيط', publishedAt: '2021-01-01T00:00:00Z' }, contentDetails: { itemCount: 12 } },
    ] });
  }));

  app.get('/youtube/v3/search', guard('/youtube/v3/search', (_req, res) => {
    const videos = state.videosEmpty ? [] : state.videos;
    res.json({ items: videos.map((v) => ({ id: { kind: 'youtube#video', videoId: v.videoId }, snippet: { title: v.title, channelId: state.channelId, channelTitle: state.channelTitle, publishedAt: '2022-01-01T00:00:00Z' } })) });
  }));

  app.get('/youtube/v3/videos', guard('/youtube/v3/videos', (req, res) => {
    const ids = String(req.query.id || '').split(',').map((s) => s.trim()).filter(Boolean);
    const wanted = ids.length ? ids : state.videos.map((v) => v.videoId);
    res.json({ items: state.videos.filter((v) => wanted.includes(v.videoId)).map((v) => ({
      id: v.videoId,
      snippet: { title: v.title, channelId: state.channelId, channelTitle: state.channelTitle, publishedAt: '2022-01-01T00:00:00Z' },
      statistics: { viewCount: v.viewCount, likeCount: v.likeCount, commentCount: v.commentCount },
      contentDetails: { duration: 'PT5M' },
    })) });
  }));

  app.get('/youtube/v3/commentThreads', guard('/youtube/v3/commentThreads', (req, res) => {
    const videoId = String(req.query.videoId || '');
    const items = state.commentsEmpty ? [] : state.comments.filter((c) => !videoId || c.videoId === videoId);
    res.json({ items: items.map((c) => ({
      snippet: { topLevelComment: { id: c.commentId, snippet: { videoId: c.videoId, authorDisplayName: c.authorName, textOriginal: c.text, likeCount: 3, publishedAt: '2022-02-01T00:00:00Z' } } },
    })) });
  }));

  app.post('/youtube/v3/comments', guard('/youtube/v3/comments', (req, res) => {
    const body = req.body || {};
    state.lastReply = { parentId: String(body?.snippet?.parentId || ''), text: String(body?.snippet?.textOriginal || '') };
    res.json({ id: state.replyCommentId, snippet: { parentId: state.lastReply.parentId, textOriginal: state.lastReply.text, authorDisplayName: state.channelTitle } });
  }));

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
