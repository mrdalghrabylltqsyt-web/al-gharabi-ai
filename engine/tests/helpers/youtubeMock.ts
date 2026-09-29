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
  /** عمر رمز الوصول بالثواني (اختبار الانتهاء: قيمة < 60 تُعتبر منتهية فوراً بسبب هامش الأمان). */
  tokenExpiresInSeconds: number;
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
  // --- قدرات المحتوى (فيديوهات/تعليقات/رفع) ---
  /** نطاق force-ssl ممنوح فعلاً (لإدارة التعليقات). */
  hasForceSslScope: boolean;
  /** فيديوهات القناة الوهمية (تُعاد عبر playlistItems + videos). */
  videos: Array<{ id: string; title: string; publishedAt: string; viewCount: number; likeCount: number; commentCount: number; tags?: string[] }>;
  /** تعليقات الفيديو الوهمية (تُعاد عبر commentThreads.list). */
  comments: Array<{ id: string; threadId: string; videoId: string; author: string; text: string; publishedAt: string; likeCount: number }>;
  /** يفشل قراءة الفيديوهات بـ403. */
  failVideos: boolean;
  /** آخر مسار/معرّف فيديو طُلب من commentThreads — يثبت أن Data API استُدعي فعلاً. */
  lastCommentsPath: string | null;
  lastCommentsVideoId: string | null;
  /** التعليقات معطّلة على الفيديو (403 commentsDisabled). */
  commentsDisabled: boolean;
  /** يفشل إدراج الرد (يحاكي فشل provider). */
  failReply: boolean;
  /** يفشل الرفع (يحاكي فشل videos.insert). */
  failUpload: boolean;
  /** معرّف الفيديو الناتج عن الرفع (حقيقي من المزود الوهمي). */
  uploadedVideoId: string;
  /** حالة الخصوصية الفعلية للفيديو المرفوع (يعكسها videos.list كما يفعل YouTube). */
  uploadedPrivacyStatus: 'public' | 'private' | 'unlisted';
  /** تجاوز اختياري لحالة التحقق (لمحاكاة عدم تطابق فعلي من المزود). */
  verifyPrivacyOverride: 'public' | 'private' | 'unlisted' | null;
  /** آخر مسار رفع/إدراج/تحديث — يثبت أن المسار الرسمي هو المستخدم. */
  lastUploadPath: string | null;
  lastInsertPath: string | null;
  lastUpdatePath: string | null;
  /** آخر جسم رفع (metadata) لإثبات publishAt/privacyStatus. */
  lastUploadBody: any;
  /** الوصف الفعلي الذي يعيده videos.list للفيديو المرفوع (لمحاكاة وصول/عدم وصول الوصف). */
  uploadedDescriptionOverride: string | null;
  /** آخر جسم إدراج تعليق. */
  lastCommentBody: any;
  /** آخر جسم تحديث فيديو. */
  lastUpdateBody: any;
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
      'https://www.googleapis.com/auth/youtube.force-ssl',
    ],
    failTokenExchange: false,
    failRefresh: false,
    tokenExpiresInSeconds: 3600,
    failChannelsInsufficient: false,
    emptyChannel: false,
    hasReadonlyScope: true,
    calls: 0,
    lastExchange: null,
    lastRefresh: null,
    lastGrantedScope: [],
    lastChannelsAuth: null,
    lastChannelsPath: null,
    hasForceSslScope: true,
    videos: [
      { id: 'vid_alpha', title: 'تقسيط أجهزة كهربائية', publishedAt: '2026-09-01T10:00:00Z', viewCount: 1200, likeCount: 45, commentCount: 12, tags: ['تقسيط'] },
      { id: 'vid_beta', title: 'أفضل عروض الأثاث', publishedAt: '2026-09-10T12:00:00Z', viewCount: 800, likeCount: 30, commentCount: 5, tags: ['أثاث'] },
    ],
    comments: [
      { id: 'cmt_1', threadId: 'thr_1', videoId: 'vid_alpha', author: 'علي', text: 'كم سعر التقسيط؟', publishedAt: '2026-09-02T09:00:00Z', likeCount: 2 },
      { id: 'cmt_2', threadId: 'thr_2', videoId: 'vid_alpha', author: 'زينب', text: 'خدمة رائعة، شكراً', publishedAt: '2026-09-03T09:00:00Z', likeCount: 1 },
    ],
    failVideos: false,
    lastCommentsPath: null,
    lastCommentsVideoId: null,
    commentsDisabled: false,
    failReply: false,
    failUpload: false,
    uploadedVideoId: 'vid_uploaded_0001',
    uploadedPrivacyStatus: 'public',
    verifyPrivacyOverride: null,
    lastUploadPath: null,
    lastInsertPath: null,
    lastUpdatePath: null,
    lastUploadBody: null,
    uploadedDescriptionOverride: null,
    lastCommentBody: null,
    lastUpdateBody: null,
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
      return res.json({ access_token: state.accessToken, expires_in: state.tokenExpiresInSeconds, scope: state.scope.join(' ') });
    }
    // authorization_code
    state.lastExchange = { clientId: String(req.body?.client_id || ''), secretLen: String(req.body?.client_secret || '').length, redirectUri: String(req.body?.redirect_uri || '') };
    if (state.failTokenExchange) return res.status(400).json({ error: 'invalid_grant', error_description: 'Bad Request' });
    state.lastGrantedScope = state.scope;
    return res.json({ access_token: state.accessToken, refresh_token: state.refreshToken, expires_in: state.tokenExpiresInSeconds, token_type: 'Bearer', scope: state.scope.join(' ') });
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
        statistics: { viewCount: '99999', subscriberCount: '1234', videoCount: String(state.videos.length) },
      }],
    });
  });

  // قائمة فيديوهات القناة: playlistItems على قائمة الرفع (نطاق youtube.readonly).
  app.get('/youtube/v3/playlistItems', (req, res) => {
    state.calls += 1;
    if (state.failVideos) return res.status(403).json({ error: { code: 403, message: 'Forbidden', errors: [{ reason: 'forbidden' }] } });
    return res.json({
      kind: 'youtube#playlistItemListResponse',
      items: state.videos.map((v) => ({ kind: 'youtube#playlistItem', contentDetails: { videoId: v.id } })),
    });
  });

  // قراءة فيديوهات بالمعرّف مع الإحصاءات والحالة (videos.list part=snippet,statistics,status).
  app.get('/youtube/v3/videos', (req, res) => {
    state.calls += 1;
    if (state.failVideos) return res.status(403).json({ error: { code: 403, message: 'Forbidden', errors: [{ reason: 'forbidden' }] } });
    const ids = String(req.query?.id || '').split(',').filter(Boolean);
    const items = state.videos
      .filter((v) => !ids.length || ids.includes(v.id))
      .concat(
        // الفيديو المرفوع حديثاً يظهر في videos.list بحالته الفعلية كما لدى YouTube.
        ids.includes(state.uploadedVideoId)
          ? [{ id: state.uploadedVideoId, title: state.lastUploadBody?.snippet?.title || '', publishedAt: '2026-09-25T10:00:00Z', viewCount: 0, likeCount: 0, commentCount: 0, tags: [] }]
          : [],
      )
      .map((v) => ({
        kind: 'youtube#video',
        id: v.id,
        snippet: {
          title: v.title,
          description: v.id === state.uploadedVideoId
            ? (state.uploadedDescriptionOverride != null ? state.uploadedDescriptionOverride : String(state.lastUploadBody?.snippet?.description || ''))
            : ((v as any).description || ''),
          publishedAt: v.publishedAt,
          tags: v.tags || [],
        },
        statistics: { viewCount: String(v.viewCount), likeCount: String(v.likeCount), commentCount: String(v.commentCount) },
        status: { privacyStatus: v.id === state.uploadedVideoId ? (state.verifyPrivacyOverride || state.uploadedPrivacyStatus) : 'public', uploadStatus: 'processed' },
      }));
    return res.json({ kind: 'youtube#videoListResponse', items });
  });

  // قراءة سلاسل التعليقات (commentThreads.list — نطاق youtube.force-ssl).
  app.get('/youtube/v3/commentThreads', (req, res) => {
    state.calls += 1;
    if (!state.hasForceSslScope) {
      return res.status(403).json({ error: { code: 403, message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } });
    }
    if (state.commentsDisabled) {
      return res.status(403).json({ error: { code: 403, message: 'The video does not allow comments.', errors: [{ reason: 'commentsDisabled' }] } });
    }
    const videoId = String(req.query?.videoId || '');
    state.lastCommentsPath = req.originalUrl;
    state.lastCommentsVideoId = videoId;
    const items = state.comments.filter((c) => !videoId || c.videoId === videoId).map((c) => ({
      kind: 'youtube#commentThread',
      id: c.threadId,
      snippet: {
        videoId: c.videoId,
        topLevelComment: {
          kind: 'youtube#comment',
          id: c.id,
          snippet: {
            authorDisplayName: c.author,
            textOriginal: c.text,
            textDisplay: c.text,
            publishedAt: c.publishedAt,
            updatedAt: c.publishedAt,
            likeCount: c.likeCount,
            videoId: c.videoId,
          },
        },
      },
    }));
    return res.json({ kind: 'youtube#commentThreadListResponse', items });
  });

  // إدراج رد (comments.insert — نطاق youtube.force-ssl).
  app.post('/youtube/v3/comments', (req, res) => {
    state.calls += 1;
    state.lastInsertPath = req.originalUrl;
    state.lastCommentBody = req.body;
    if (!state.hasForceSslScope) {
      return res.status(403).json({ error: { code: 403, message: 'insufficient', errors: [{ reason: 'insufficientPermissions' }] } });
    }
    if (state.failReply) return res.status(500).json({ error: { code: 500, message: 'Internal error', errors: [{ reason: 'backendError' }] } });
    const parentId = String(req.body?.snippet?.parentId || '');
    if (!parentId) return res.status(400).json({ error: { code: 400, message: 'parentId required', errors: [{ reason: 'invalidArgument' }] } });
    return res.json({ kind: 'youtube#comment', id: 'reply_0001', snippet: { parentId, textOriginal: String(req.body?.snippet?.textOriginal || '') } });
  });

  // رفع فيديو resumable: المسار الأول يرد Location، ثم PUT البايتات يرد الفيديو.
  app.post('/upload/youtube/v3/videos', (req, res) => {
    state.calls += 1;
    state.lastUploadPath = req.originalUrl;
    state.lastUploadBody = req.body;
    if (state.failUpload) return res.status(500).json({ error: { code: 500, message: 'Upload failed', errors: [{ reason: 'backendError' }] } });
    const origin = `${req.protocol}://${req.get('host')}`;
    res.setHeader('Location', `${origin}/upload/session/fake-1`);
    return res.status(200).json({});
  });
  app.put('/upload/session/fake-1', express.raw({ type: '*/*', limit: '20mb' }), (req, res) => {
    state.calls += 1;
    return res.json({ kind: 'youtube#video', id: state.uploadedVideoId, snippet: { title: state.lastUploadBody?.snippet?.title || '' }, status: { privacyStatus: state.uploadedPrivacyStatus, uploadStatus: 'uploaded' } });
  });

  // تحديث فيديو (videos.update).
  app.put('/youtube/v3/videos', (req, res) => {
    state.calls += 1;
    state.lastUpdatePath = req.originalUrl;
    state.lastUpdateBody = req.body;
    return res.json({ kind: 'youtube#video', id: String(req.body?.id || ''), snippet: req.body?.snippet || {} });
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
