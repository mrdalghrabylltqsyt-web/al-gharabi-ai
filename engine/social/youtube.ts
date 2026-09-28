/**
 * موصل YouTube الحقيقي — خامس تكامل اجتماعي خارجي منفّذ، ومُنفّذ الآن بقدرات
 * المحتوى الكاملة: قائمة الفيديوهات، رفع/تحديث الفيديو، النشر والجدولة، قراءة
 * التعليقات، الرد عليها، والإحصاءات الحقيقية. مبنيّ على Google OAuth 2.0
 * وYouTube Data API v3 الرسميين فقط.
 *
 * سبب البنية:
 * - النطاق `youtube.force-ssl` هو الوحيد الذي يقبل `commentThreads.list` و
 *   `comments.list` و`comments.insert` (قراءة التعليقات والرد عليها). بدونه
 *   تُرفض هذه الاستدعاءات بـ403 `insufficientPermissions`.
 * - `youtube.upload` يقابل `videos.insert`/`videos.update`.
 * - `youtube.readonly` يقابل `channels.list`/`videos.list`/`playlistItems.list`.
 *
 * القاعدة الملزمة: لا تُعلن قدرة لم تُنفَّذ فعلاً، ولا تُخترع قيمة. كل دالة
 * حتمية (بناء الروابط/الأجسام، تطبيع الاستجابات، تصنيف الأخطاء) مفصولة عن
 * عميل الشبكة لتُختبر بخادم وهمي محلي بلا مزود ولا حصة.
 *
 * كل الأسرار تُمرَّر كوسائط؛ لا تُسجَّل ولا تُعاد.
 */

import crypto from 'node:crypto';
import {
  buildTokenExchangeBody,
  parseTokenResponse,
  isAccessTokenExpired,
} from './oauth';

export const YOUTUBE_API_BASE = 'https://www.googleapis.com';

/**
 * حدّ أقصى لعدد الفيديوهات التي تُفحص عند البحث عن أحدث تعليقات القناة.
 * يمنع أي استهلاك غير محدود لـcommentThreads.list: طلب واحد لكل فيديو، وبحدّ ثابت.
 */
export const YOUTUBE_COMMENT_SCAN_VIDEO_LIMIT = 5;
export const YOUTUBE_UPLOAD_BASE = 'https://www.googleapis.com';
export const YOUTUBE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** نطاق القراءة الرسمي الذي يغطّي channels.list/videos.list/playlistItems.list. */
export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
/** نطاق رفع/تحديث الفيديو (videos.insert/videos.update). */
export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
/** نطاق إدارة التعليقات (قراءة + رد) — يقابل commentThreads.list/comments.insert. */
export const YOUTUBE_FORCE_SSL_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
/**
 * نطاق YouTube Analytics API (تحليلات متقدّمة). **لم يُطلب**: يتطلب تمكين
 * YouTube Analytics API وموافقة منفصلة، والإحصاءات الأساسية متاحة من Data API.
 */
export const YOUTUBE_ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';

/**
 * النطاقات المطلوبة فعلاً — كل نطاق يقابله استدعاء منفّذ في الكود:
 * - youtube.readonly → channels.list + videos.list/playlistItems.list.
 * - youtube.upload   → videos.insert/videos.update.
 * - youtube.force-ssl → commentThreads.list + comments.list + comments.insert.
 */
export const YOUTUBE_REQUIRED_SCOPES: readonly string[] = Object.freeze([
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_UPLOAD_SCOPE,
  YOUTUBE_FORCE_SSL_SCOPE,
]);

/** تجاوز اختياري من البيئة: لا يُقبل نطاق غير رسمي، والمطلوبة تُضمّ دائماً. */
export function resolveYouTubeScopes(requested?: readonly string[]): string[] {
  const known = new Set(YOUTUBE_REQUIRED_SCOPES);
  const extra = (requested || [])
    .map((s) => String(s).trim())
    .filter((s) => Boolean(s) && known.has(s));
  return [...new Set<string>([...YOUTUBE_REQUIRED_SCOPES, ...extra])];
}

// ---------------------------------------------------------------------------
// مصفوفة القدرات الرسمية
// ---------------------------------------------------------------------------

export type YouTubeCapabilityStatus =
  | 'SUPPORTED'
  | 'NOT_IMPLEMENTED'
  | 'REQUIRES_REVIEW'
  | 'NOT_AVAILABLE';

export interface YouTubeCapabilityRow {
  key: string;
  label: string;
  status: YouTubeCapabilityStatus;
  scope?: string;
  evidence: string;
}

/** كل صف `SUPPORTED` يقابله استدعاء منفّذ فعلاً في هذا الملف. */
export const YOUTUBE_CAPABILITY_MATRIX: readonly YouTubeCapabilityRow[] = Object.freeze([
  { key: 'oauth_login', label: 'تسجيل الدخول (Google OAuth 2.0)', status: 'SUPPORTED', scope: YOUTUBE_READONLY_SCOPE, evidence: 'accounts.google.com/o/oauth2/v2/auth (response_type=code, access_type=offline, prompt=consent) وتبادل الرمز على oauth2.googleapis.com/token.' },
  { key: 'channel_identity', label: 'هوية القناة (قراءة)', status: 'SUPPORTED', scope: YOUTUBE_READONLY_SCOPE, evidence: 'GET /youtube/v3/channels?part=snippet,contentDetails,statistics&mine=true — لا يُعلن اتصال موثق بلا معرّف قناة حقيقي من Google.' },
  { key: 'connection_persistence', label: 'حفظ الاتصال المشفّر', status: 'SUPPORTED', scope: YOUTUBE_READONLY_SCOPE, evidence: 'الرمز يُحفظ مشفّراً AES-256-GCM عبر محوّل الحالة، ولا يُعاد ولا يُسجَّل.' },
  { key: 'video_list', label: 'قائمة فيديوهات القناة', status: 'SUPPORTED', scope: YOUTUBE_READONLY_SCOPE, evidence: 'GET /youtube/v3/playlistItems على قائمة الرفع (UU…) + GET /youtube/v3/videos?part=snippet,statistics,status.' },
  { key: 'video_upload', label: 'رفع فيديو (videos.insert)', status: 'SUPPORTED', scope: YOUTUBE_UPLOAD_SCOPE, evidence: 'رفع resumable رسمي: POST /upload/youtube/v3/videos?uploadType=resumable ثم PUT البايتات إلى Location. لا نشر بلا معرّف فيديو من Google.' },
  { key: 'video_update', label: 'تحديث بيانات فيديو (videos.update)', status: 'SUPPORTED', scope: YOUTUBE_UPLOAD_SCOPE, evidence: 'PUT /youtube/v3/videos?part=snippet,status — يحدّث العنوان/الوصف/الوسوم/الخصوصية لفيديو مملوك للقناة.' },
  { key: 'publishing', label: 'النشر (public/private/unlisted)', status: 'SUPPORTED', scope: YOUTUBE_UPLOAD_SCOPE, evidence: 'videos.insert بحقل status.privacyStatus — لا يُسجَّل النشر بلا externalVideoId من Google.' },
  { key: 'scheduling', label: 'جدولة النشر (publishAt)', status: 'SUPPORTED', scope: YOUTUBE_UPLOAD_SCOPE, evidence: 'videos.insert بحقل status.publishAt (RFC3339) وprivacyStatus=private — الجدولة حقيقية لدى YouTube لا حقل داخلي.' },
  { key: 'comments_read', label: 'قراءة التعليقات', status: 'SUPPORTED', scope: YOUTUBE_FORCE_SSL_SCOPE, evidence: 'GET /youtube/v3/commentThreads?part=snippet,replies&videoId=… وGET /youtube/v3/comments?part=snippet&parentId=… (youtube.force-ssl).' },
  { key: 'comment_reply', label: 'الرد على التعليقات', status: 'SUPPORTED', scope: YOUTUBE_FORCE_SSL_SCOPE, evidence: 'POST /youtube/v3/comments?part=snippet بجسم snippet.parentId + snippet.textOriginal. لا رد مُسلَّم بلا معرّف تعليق من Google.' },
  { key: 'analytics', label: 'إحصاءات الفيديو والقناة (Data API)', status: 'SUPPORTED', scope: YOUTUBE_READONLY_SCOPE, evidence: 'videos.list part=statistics (viewCount/likeCount/commentCount) وchannels.list part=statistics.' },
  { key: 'audience_demographics', label: 'التركيبة السكانية للجمهور (عمر/جنس/موقع)', status: 'NOT_AVAILABLE', scope: YOUTUBE_ANALYTICS_SCOPE, evidence: 'غير متاحة عبر Data API؛ تتطلب YouTube Analytics API وتمكينها وموافقة منفصلة — لم تُطلب ولم تُنفَّذ، فلا تُخترع أي بيانات سكانية.' },
  { key: 'webhook_pubsub', label: 'إشعارات PubSubHubbub', status: 'REQUIRES_REVIEW', evidence: 'تُحتاج موافقة/تسجيل على Google PubSubHubbub وربط نطاق؛ إجراء خارجي على المالك. غير منفّذ في الكود.' },
]);

export function youtubeCapabilityStatus(key: string): YouTubeCapabilityStatus | null {
  return YOUTUBE_CAPABILITY_MATRIX.find((r) => r.key === key)?.status ?? null;
}

export function youtubeCapabilityImplemented(key: string): boolean {
  return youtubeCapabilityStatus(key) === 'SUPPORTED';
}

/** القدرات المنفّذة فعلاً (تُغذّي سجل المنصات والقدرات). */
export const YOUTUBE_IMPLEMENTED_CAPABILITIES: readonly string[] = Object.freeze(
  YOUTUBE_CAPABILITY_MATRIX.filter((r) => r.status === 'SUPPORTED').map((r) => r.key),
);

// ---------------------------------------------------------------------------
// القواعد الفعلية للشبكة (قابلة للتجاوز في الاختبار فقط)
// ---------------------------------------------------------------------------

export function youtubeApiBase(override?: string): string {
  const base = override || process.env.YOUTUBE_API_BASE || YOUTUBE_API_BASE;
  return base.replace(/\/+$/, '');
}

export function youtubeUploadBase(override?: string): string {
  const base = override || process.env.YOUTUBE_UPLOAD_BASE || YOUTUBE_UPLOAD_BASE;
  return base.replace(/\/+$/, '');
}

export function youtubeTokenUrl(override?: string): string {
  return override || process.env.YOUTUBE_TOKEN_BASE || YOUTUBE_TOKEN_ENDPOINT;
}

export function youtubeApiUrl(path: string, baseOverride?: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${youtubeApiBase(baseOverride)}${suffix}`;
}

/** رابط إثبات هوية القناة. */
export function buildChannelsMineUrl(baseOverride?: string): string {
  return youtubeApiUrl('/youtube/v3/channels?part=snippet,contentDetails,statistics&mine=true', baseOverride);
}

/** رابط قائمة فيديوهات قناة عبر قائمة الرفع الرسمية. */
export function buildUploadsPlaylistItemsUrl(playlistId: string, maxResults = 50, pageToken?: string | null, baseOverride?: string): string {
  const params = new URLSearchParams({ part: 'snippet,contentDetails', playlistId: String(playlistId || ''), maxResults: String(Math.max(1, Math.min(50, maxResults))) });
  if (pageToken) params.set('pageToken', String(pageToken));
  return youtubeApiUrl(`/youtube/v3/playlistItems?${params.toString()}`, baseOverride);
}

/** رابط قراءة فيديوهات بالمعرّف مع الإحصاءات والحالة. */
export function buildVideosListUrl(videoIds: string[], baseOverride?: string): string {
  const params = new URLSearchParams({ part: 'snippet,statistics,status', id: videoIds.filter(Boolean).join(',') });
  return youtubeApiUrl(`/youtube/v3/videos?${params.toString()}`, baseOverride);
}

/** رابط قراءة سلاسل التعليقات لفيديو. */
export function buildCommentThreadsUrl(videoId: string, maxResults = 100, pageToken?: string | null, baseOverride?: string): string {
  const params = new URLSearchParams({ part: 'snippet,replies', videoId: String(videoId || ''), maxResults: String(Math.max(1, Math.min(100, maxResults))), textFormat: 'plainText', order: 'time' });
  if (pageToken) params.set('pageToken', String(pageToken));
  return youtubeApiUrl(`/youtube/v3/commentThreads?${params.toString()}`, baseOverride);
}

/** رابط قراءة الردود على تعليق (parentId). */
export function buildCommentsListUrl(parentId: string, maxResults = 100, pageToken?: string | null, baseOverride?: string): string {
  const params = new URLSearchParams({ part: 'snippet', parentId: String(parentId || ''), maxResults: String(Math.max(1, Math.min(100, maxResults))), textFormat: 'plainText' });
  if (pageToken) params.set('pageToken', String(pageToken));
  return youtubeApiUrl(`/youtube/v3/comments?${params.toString()}`, baseOverride);
}

/** رابط إدراج تعليق/رد (comments.insert). */
export function buildCommentsInsertUrl(baseOverride?: string): string {
  return youtubeApiUrl('/youtube/v3/comments?part=snippet', baseOverride);
}

/** رابط إدراج فيديو (videos.insert) بوضع رفع resumable الرسمي. */
export function buildVideoInsertResumableUrl(baseOverride?: string): string {
  return `${youtubeUploadBase(baseOverride)}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`;
}

/** رابط تحديث بيانات فيديو (videos.update). */
export function buildVideosUpdateUrl(baseOverride?: string): string {
  return youtubeApiUrl('/youtube/v3/videos?part=snippet,status', baseOverride);
}

// ---------------------------------------------------------------------------
// الهوية والإحصاءات
// ---------------------------------------------------------------------------

export interface YouTubeChannel {
  channelId: string;
  title: string | null;
  uploadsPlaylistId: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
  viewCount: number | null;
}

/** يحوّل قيمة إحصاء نصية إلى رقم؛ غيابها يعني null (لا صفر مُختلق). */
function toCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** يقرأ استجابة channels.list ويستخرج هوية القناة. لا يختلق هوية عند غياب items. */
export function parseChannelListResponse(data: any): YouTubeChannel | null {
  const item = data?.items?.[0];
  if (!item || !item.id) return null;
  const stats = item.statistics || {};
  return {
    channelId: String(item.id),
    title: item.snippet?.title != null ? String(item.snippet.title) : null,
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads != null ? String(item.contentDetails.relatedPlaylists.uploads) : null,
    // subscriberCount قد يُعاد مخفياً (hiddenSubscriberCount) => يبقى null.
    subscriberCount: item.statistics?.hiddenSubscriberCount === true ? null : toCount(stats.subscriberCount),
    videoCount: toCount(stats.videoCount),
    viewCount: toCount(stats.viewCount),
  };
}

export interface YouTubeVideo {
  videoId: string;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
  channelId: string | null;
  tags: string[];
  privacyStatus: string | null;
  uploadStatus: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  durationIso: string | null;
  thumbnails: Record<string, string>;
}

/** يقرأ عنصر videos.list/playlistItems.list ويطبّعه بلا اختراع قيم. */
export function normalizeVideoItem(item: any): YouTubeVideo | null {
  if (!item) return null;
  const id = typeof item.id === 'string' ? item.id : (item.contentDetails?.videoId || item.snippet?.resourceId?.videoId);
  if (!id) return null;
  const snippet = item.snippet || {};
  const stats = item.statistics || {};
  const thumbs: Record<string, string> = {};
  for (const [k, v] of Object.entries(snippet.thumbnails || {})) {
    const url = (v as any)?.url;
    if (typeof url === 'string') thumbs[k] = url;
  }
  return {
    videoId: String(id),
    title: snippet.title != null ? String(snippet.title) : null,
    description: snippet.description != null ? String(snippet.description) : null,
    publishedAt: snippet.publishedAt != null ? String(snippet.publishedAt) : null,
    channelId: snippet.channelId != null ? String(snippet.channelId) : null,
    tags: Array.isArray(snippet.tags) ? snippet.tags.map((t: any) => String(t)) : [],
    privacyStatus: item.status?.privacyStatus != null ? String(item.status.privacyStatus) : null,
    uploadStatus: item.status?.uploadStatus != null ? String(item.status.uploadStatus) : null,
    viewCount: toCount(stats.viewCount),
    likeCount: toCount(stats.likeCount),
    commentCount: toCount(stats.commentCount),
    durationIso: item.contentDetails?.duration != null ? String(item.contentDetails.duration) : null,
    thumbnails: thumbs,
  };
}

export interface YouTubeComment {
  commentId: string;
  threadId: string | null;
  videoId: string | null;
  authorName: string | null;
  authorChannelId: string | null;
  text: string;
  publishedAt: string | null;
  updatedAt: string | null;
  likeCount: number | null;
  replyCount: number | null;
  isReply: boolean;
  parentId: string | null;
}

/** يطبّع عنصر تعليق (comments.list أو replies داخل commentThreads). */
export function normalizeCommentItem(item: any, fallbackVideoId?: string | null): YouTubeComment | null {
  if (!item || !item.id) return null;
  const snippet = item.snippet || {};
  return {
    commentId: String(item.id),
    threadId: null,
    videoId: snippet.videoId != null ? String(snippet.videoId) : (fallbackVideoId || null),
    authorName: snippet.authorDisplayName != null ? String(snippet.authorDisplayName) : null,
    authorChannelId: snippet.authorChannelId?.value != null ? String(snippet.authorChannelId.value) : null,
    text: String(snippet.textDisplay ?? snippet.textOriginal ?? ''),
    publishedAt: snippet.publishedAt != null ? String(snippet.publishedAt) : null,
    updatedAt: snippet.updatedAt != null ? String(snippet.updatedAt) : null,
    likeCount: toCount(snippet.likeCount),
    replyCount: null,
    isReply: Boolean(snippet.parentId),
    parentId: snippet.parentId != null ? String(snippet.parentId) : null,
  };
}

/** يطبّع سلسلة تعليقات كاملة (top-level + replies) إلى قائمة مسطّحة. */
export function normalizeCommentThread(item: any): { thread: YouTubeComment; replies: YouTubeComment[] } | null {
  if (!item) return null;
  const top = normalizeCommentItem(item.snippet?.topLevelComment, item.snippet?.videoId);
  if (!top) return null;
  const threadId = item.id != null ? String(item.id) : null;
  top.threadId = threadId;
  top.replyCount = toCount(item.snippet?.totalReplyCount);
  const replies = Array.isArray(item.replies?.comments)
    ? item.replies.comments.map((c: any) => normalizeCommentItem(c, top.videoId)).filter((c: YouTubeComment | null): c is YouTubeComment => Boolean(c))
    : [];
  for (const r of replies) r.threadId = threadId;
  return { thread: top, replies };
}

/** يبني جسم إدراج رد على تعليق (comments.insert). */
export function buildCommentInsertBody(input: { parentCommentId: string; text: string }): Record<string, unknown> {
  return { snippet: { parentId: String(input.parentCommentId || ''), textOriginal: String(input.text || '') } };
}

// ---------------------------------------------------------------------------
// بناء/التحقق من بيانات رفع الفيديو (حتمي، بلا شبكة)
// ---------------------------------------------------------------------------

export type YouTubePrivacyStatus = 'public' | 'private' | 'unlisted';
export const YOUTUBE_PRIVACY_STATUSES: readonly YouTubePrivacyStatus[] = Object.freeze(['public', 'private', 'unlisted']);

export const YOUTUBE_DEFAULT_CATEGORY_ID = '22'; // People & Blogs
export const YOUTUBE_VALID_CATEGORY_IDS: readonly string[] = Object.freeze([
  '1', '2', '10', '15', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44',
]);

export interface VideoUploadMetadataInput {
  title: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus?: YouTubePrivacyStatus | string;
  /** وقت الجدولة RFC3339 (UTC). عند وجوده يُفرض privacyStatus=private. */
  publishAt?: string | null;
  madeForKids?: boolean;
  defaultLanguage?: string;
}

/**
 * يبني جسم videos.insert الرسمي (snippet + status).
 * الجدولة: وثيقة YouTube تشترط `status.publishAt` بصيغة RFC3339 وأن تكون
 * الخصوصية `private` قبله، وإلا فشل الطلب.
 */
export function buildVideoInsertMetadata(input: VideoUploadMetadataInput): Record<string, unknown> {
  const privacy: YouTubePrivacyStatus = YOUTUBE_PRIVACY_STATUSES.includes(input.privacyStatus as YouTubePrivacyStatus)
    ? (input.privacyStatus as YouTubePrivacyStatus)
    : 'private';
  const snippet: Record<string, unknown> = {
    title: String(input.title || '').slice(0, 100),
    description: String(input.description || '').slice(0, 5000),
    categoryId: String(input.categoryId || YOUTUBE_DEFAULT_CATEGORY_ID),
  };
  const tags = (input.tags || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
  if (tags.length) snippet.tags = tags;
  if (input.defaultLanguage) snippet.defaultLanguage = String(input.defaultLanguage);
  const status: Record<string, unknown> = {
    privacyStatus: input.publishAt ? 'private' : privacy,
    selfDeclaredMadeForKids: Boolean(input.madeForKids),
  };
  if (input.publishAt) status.publishAt = String(input.publishAt);
  return { snippet, status };
}

export interface UploadValidation {
  ok: boolean;
  code?: 'TITLE_REQUIRED' | 'PRIVACY_INVALID' | 'PUBLISH_AT_NOT_FUTURE' | 'PUBLISH_AT_INVALID' | 'CATEGORY_INVALID' | 'MEDIA_REQUIRED';
  reasons: string[];
}

/**
 * يتحقق من مدخلات الرفع قبل أي طلب شبكة. لا رفع بلا عنوان، ولا رفع بلا مادة
 * (بايتات)، ولا جدولة في الماضي، ولا خصوصية/قسم غير رسميين.
 */
export function validateVideoUploadInput(input: {
  title?: string;
  privacyStatus?: string;
  publishAt?: string | null;
  categoryId?: string;
  hasMedia: boolean;
  now?: number;
}): UploadValidation {
  const reasons: string[] = [];
  let code: UploadValidation['code'];
  if (!String(input.title || '').trim()) { reasons.push('عنوان الفيديو مطلوب (YouTube يرفض فيديو بلا عنوان).'); code = code || 'TITLE_REQUIRED'; }
  if (input.privacyStatus && !YOUTUBE_PRIVACY_STATUSES.includes(input.privacyStatus as YouTubePrivacyStatus)) {
    reasons.push(`حالة الخصوصية غير صالحة: ${input.privacyStatus}.`); code = code || 'PRIVACY_INVALID';
  }
  if (input.categoryId && !YOUTUBE_VALID_CATEGORY_IDS.includes(String(input.categoryId))) {
    reasons.push(`categoryId غير رسمي: ${input.categoryId}.`); code = code || 'CATEGORY_INVALID';
  }
  if (!input.hasMedia) { reasons.push('لا توجد مادة فعلية للرفع (بايتات ملف أو رابط فيديو عام).'); code = code || 'MEDIA_REQUIRED'; }
  if (input.publishAt) {
    const epoch = Date.parse(String(input.publishAt));
    if (!Number.isFinite(epoch)) { reasons.push('صيغة publishAt غير صالحة (يلزم RFC3339).'); code = code || 'PUBLISH_AT_INVALID'; }
    else if (epoch <= (input.now ?? Date.now())) { reasons.push('وقت الجدولة في الماضي؛ YouTube يرفضه.'); code = code || 'PUBLISH_AT_NOT_FUTURE'; }
  }
  return { ok: reasons.length === 0, code, reasons };
}

/**
 * بصمة idempotency حتمية لعملية رفع/نشر: تمنع إنشاء نفس الفيديو مرتين بسبب
 * retry أو إعادة إرسال (العنوان + الوصف + الوسوم + الخصوصية + الجدولة + المادة).
 */
export function youtubeUploadFingerprint(input: {
  title?: string;
  description?: string;
  tags?: string[];
  privacyStatus?: string;
  publishAt?: string | null;
  mediaRef?: string;
}): string {
  const payload = JSON.stringify({
    title: String(input.title || '').trim(),
    description: String(input.description || '').trim(),
    tags: (input.tags || []).map((t) => String(t).trim()).sort(),
    privacyStatus: String(input.privacyStatus || ''),
    publishAt: input.publishAt ? String(input.publishAt) : null,
    mediaRef: String(input.mediaRef || ''),
  });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** تصنيف نتيجة رفع الفيديو من استجابة videos.insert. */
export function classifyVideoUploadResult(video: any): { state: 'published' | 'scheduled' | 'processing' | 'failed'; delivered: boolean; externalVideoId: string | null; detail: string } {
  const id = video?.id ? String(video.id) : null;
  if (!id) return { state: 'failed', delivered: false, externalVideoId: null, detail: 'لم يُعد YouTube معرّف فيديو؛ لم يُسجَّل أي نشر.' };
  const uploadStatus = String(video?.status?.uploadStatus || '');
  const publishAt = video?.status?.publishAt ? String(video.status.publishAt) : null;
  if (uploadStatus === 'failed' || uploadStatus === 'rejected') {
    return { state: 'failed', delivered: false, externalVideoId: id, detail: `رفض YouTube الفيديو (${uploadStatus}).` };
  }
  if (publishAt) {
    return { state: 'scheduled', delivered: false, externalVideoId: id, detail: `جدول YouTube النشر عند ${publishAt} (private حتى الموعد).` };
  }
  if (uploadStatus === 'uploaded' || uploadStatus === 'processed' || !uploadStatus) {
    return { state: 'published', delivered: true, externalVideoId: id, detail: 'أعاد YouTube معرّف فيديو حقيقي؛ النشر مُثبت من المزود.' };
  }
  return { state: 'processing', delivered: false, externalVideoId: id, detail: `YouTube ما زال يعالج الفيديو (${uploadStatus}).` };
}

/** رابط مشاهدة عام مبني على معرّف فيديو حقيقي فقط. */
export function youtubeWatchUrl(videoId: string | null): string | null {
  return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : null;
}

// ---------------------------------------------------------------------------
// دورة حياة الرد على التعليق (draft → approved → sent / failed)
// ---------------------------------------------------------------------------

/** حالات دورة حياة الرد — مفردات صريحة بلا لبس بين «مسودة» و«مُرسل». */
export type YouTubeReplyLifecycleState = 'draft' | 'approved' | 'sent' | 'failed';

export const YOUTUBE_REPLY_LIFECYCLE_STATES: readonly YouTubeReplyLifecycleState[] = Object.freeze([
  'draft',
  'approved',
  'sent',
  'failed',
]);

export const YOUTUBE_REPLY_LIFECYCLE_LABELS_AR: Record<YouTubeReplyLifecycleState, string> = Object.freeze({
  draft: 'مسودة (لم تُعتمد)',
  approved: 'معتمد (بانتظار الإرسال)',
  sent: 'أُرسل فعلاً (أثبته YouTube)',
  failed: 'فشل الإرسال',
});

/**
 * يحسم حالة دورة حياة الرد من الحقائق الفعلية فقط. القاعدة الحاكمة:
 * **لا `sent` بلا معرّف رد حقيقي من YouTube**. ترتيب الأسبقية: دليل الإرسال >
 * فشل الإرسال > قرار الاعتماد > مسودة.
 */
export function resolveYouTubeReplyState(input: {
  delivered: boolean;
  externalReplyId: string | null;
  approved?: boolean;
  failed?: boolean;
}): YouTubeReplyLifecycleState {
  if (input.delivered && input.externalReplyId) return 'sent';
  if (input.failed) return 'failed';
  if (input.approved) return 'approved';
  return 'draft';
}

/** هل الحالة تعني إرسالاً مُثبتاً من YouTube؟ */
export function youtubeReplyIsSent(state: YouTubeReplyLifecycleState): boolean {
  return state === 'sent';
}

// ---------------------------------------------------------------------------
// تصنيف الأخطاء (بلا كشف أي قيمة)
// ---------------------------------------------------------------------------

export type YouTubeErrorKind =
  | 'invalid_grant'
  | 'invalid_client'
  | 'unauthorized_client'
  | 'insufficient_permissions'
  | 'access_not_configured'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'comments_disabled'
  | 'video_not_found'
  | 'forbidden'
  | 'invalid_request'
  | 'conflict'
  | 'provider_error'
  | 'network'
  | 'unknown';

export function classifyYouTubeTokenError(data: any): YouTubeErrorKind {
  const err = String(data?.error || '').toLowerCase();
  if (!err) return 'unknown';
  if (err === 'invalid_grant') return 'invalid_grant';
  if (err === 'invalid_client') return 'invalid_client';
  if (err === 'unauthorized_client') return 'unauthorized_client';
  if (err === 'invalid_request') return 'invalid_request';
  if (err === 'rate_limit_exceeded' || err === 'user_rate_limit_exceeded') return 'rate_limited';
  return 'provider_error';
}

/**
 * يصنّف خطأ استجابة Data API. يميّز quotaExceeded عن rateLimitExceeded عن
 * commentsDisabled عن insufficientPermissions — فلا تُخلط حصة الحساب بصلاحية
 * ناقصة ولا بتعطيل التعليقات.
 */
export function classifyYouTubeApiError(data: any, status?: number): YouTubeErrorKind {
  const reason = String(data?.error?.errors?.[0]?.reason || data?.error?.status || '').toLowerCase();
  const message = String(data?.error?.message || '').toLowerCase();
  if (reason.includes('quot') || message.includes('quota')) return 'quota_exceeded';
  if (reason.includes('ratelimit') || reason.includes('userratelimit')) return 'rate_limited';
  if (reason.includes('commentsdisabled') || message.includes('comments are disabled')) return 'comments_disabled';
  if (reason.includes('videonotfound') || reason.includes('notfound') || status === 404) return 'video_not_found';
  if (reason.includes('insufficientpermission')) return 'insufficient_permissions';
  if (reason.includes('accessnotconfigured') || reason.includes('service_disabled')) return 'access_not_configured';
  if (reason === 'forbidden' || status === 403) return 'forbidden';
  if (reason === 'invalid_grant') return 'invalid_grant';
  if (reason.includes('conflict') || status === 409) return 'conflict';
  if (reason.includes('invalid') || status === 400) return 'invalid_request';
  return 'provider_error';
}

/** رسالة خطأ عربية دقيقة حسب فئة خطأ Google token (بلا أي قيمة سرّية). */
export function youTubeErrorMessage(data: any, kind: YouTubeErrorKind, fallback: string): string {
  switch (kind) {
    case 'invalid_grant': return 'رمز التفويض منتهٍ أو أُعيد استخدامه (invalid_grant)؛ أعد بدء الربط.';
    case 'invalid_client': return 'معرّف/سرّ تطبيق Google غير مقبول (invalid_client)؛ تحقق من GOOGLE_OAUTH_CLIENT_ID/SECRET وأن Redirect URI مسجّل بالضبط.';
    case 'unauthorized_client': return 'التطبيق غير مصرّح له بطلب هذه الصلاحيات (unauthorized_client)؛ فعّل YouTube Data API وراجع شاشة الموافقة.';
    case 'invalid_request': return 'طلب الرمز غير مكتمل (invalid_request)؛ تحقق من redirect_uri وcode.';
    case 'rate_limited': return 'حصة/تقييد مؤقت لدى Google؛ أعد المحاولة لاحقاً.';
    default: return data?.error_description ? String(data.error_description).slice(0, 200) : fallback;
  }
}

/** رسالة خطأ عربية دقيقة عند فشل عملية Data API. */
export function youTubeApiErrorMessage(kind: YouTubeErrorKind, fallback: string): string {
  switch (kind) {
    case 'insufficient_permissions': return 'الرمز لا يملك الصلاحية المطلوبة (insufficientPermissions)؛ أعد ربط YouTube لتفعيل youtube.force-ssl لإدارة التعليقات.';
    case 'access_not_configured': return 'YouTube Data API v3 غير مُمكّن في مشروع Google (accessNotConfigured)؛ فعّله من Cloud Console ثم أعد المحاولة.';
    case 'quota_exceeded': return 'حصة YouTube Data API اليومية مستهلكة (quotaExceeded)؛ أعد المحاولة بعد تجدد الحصة أو ارفع الحد في Cloud Console.';
    case 'rate_limited': return 'تقييد معدّل مؤقت من YouTube (rateLimitExceeded)؛ أعد المحاولة لاحقاً.';
    case 'comments_disabled': return 'التعليقات معطّلة على هذا الفيديو لدى YouTube (commentsDisabled)؛ لا يمكن قراءتها أو الرد عليها.';
    case 'video_not_found': return 'الفيديو غير موجود أو غير متاح لهذا الرمز (videoNotFound).';
    case 'forbidden': return 'رفض YouTube العملية (403)؛ تحقق من الصلاحيات وملكية الفيديو.';
    case 'conflict': return 'تعارض في حالة المورد لدى YouTube (409)؛ أعد قراءة الحالة قبل إعادة المحاولة.';
    case 'invalid_grant': return 'رمز الوصول لم يعد صالحاً؛ أعد الربط.';
    case 'invalid_request': return 'طلب YouTube غير صالح (400)؛ تحقق من المعاملات المُرسلة.';
    default: return fallback;
  }
}

/** رسالة توافق قديمة (يبقى الاسم لتفادي كسر المستدعين القدامى). */
export function youTubeChannelErrorMessage(kind: YouTubeErrorKind): string {
  return youTubeApiErrorMessage(kind, 'تعذّر إثبات هوية قناة YouTube من Google.');
}

// ---------------------------------------------------------------------------
// حد المعدّل (rate limit) — منطق خالص قابل للاختبار
// ---------------------------------------------------------------------------

export interface RateLimitDecision {
  allowed: boolean;
  used: number;
  limit: number;
  windowMs: number;
  retryAfterMs: number;
}

/**
 * حارس معدّل حتمي بنافذة زمنية منزلقة: يمنع العقل من إرسال عدد غير محدود من
 * العمليات الخارجية. عند الوصول للحد تُرفض العملية (pending/retryable) بلا
 * إنشاء duplicates.
 */
export function checkOperationRateLimit(input: { timestamps: number[]; now: number; limit: number; windowMs: number }): RateLimitDecision {
  const windowMs = Math.max(1000, Number(input.windowMs) || 60_000);
  const limit = Math.max(1, Number(input.limit) || 30);
  const recent = (input.timestamps || []).filter((t) => Number.isFinite(t) && input.now - t < windowMs).sort((a, b) => a - b);
  if (recent.length < limit) return { allowed: true, used: recent.length, limit, windowMs, retryAfterMs: 0 };
  const oldest = recent[0];
  return { allowed: false, used: recent.length, limit, windowMs, retryAfterMs: Math.max(0, windowMs - (input.now - oldest)) };
}

// ---------------------------------------------------------------------------
// عميل الشبكة (يُمرَّر fetchImpl فيُختبر بخادم وهمي محلي)
// ---------------------------------------------------------------------------

export interface YouTubeHttpResponse {
  ok: boolean;
  status: number;
  /** ترويسات الاستجابة (يلزمها رفع resumable لقراءة Location). */
  headers?: { get(name: string): string | null };
  json: () => Promise<any>;
}

export type YouTubeFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array },
) => Promise<YouTubeHttpResponse>;

export interface YouTubeResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
  code?: YouTubeErrorKind | string | null;
}

export interface YouTubeTokenBundle {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope: string[];
}

export interface YouTubeUploadInput {
  /** بايتات الملف الفعلية (إلزامية للرفع الحقيقي). */
  bytes: Uint8Array;
  mimeType: string;
  metadata: VideoUploadMetadataInput;
}

export class YouTubeClient {
  constructor(
    private readonly fetchImpl: YouTubeFetch,
    private readonly apiBase?: string,
    private readonly tokenUrlOverride?: string,
    private readonly uploadBase?: string,
  ) {}

  /** يبادل رمز التفويض برمز وصول (+ refresh token بسبب access_type=offline). */
  async exchangeCode(input: { clientId: string; clientSecret: string; code: string; redirectUri: string }): Promise<YouTubeResult<YouTubeTokenBundle>> {
    return this.tokenRequest(
      buildTokenExchangeBody({ clientId: input.clientId, clientSecret: input.clientSecret, code: input.code, redirectUri: input.redirectUri }),
      'فشل تبادل رمز Google.',
    );
  }

  /** يجدّد رمز الوصول عبر refresh_token. */
  async refreshAccessToken(input: { clientId: string; clientSecret: string; refreshToken: string }): Promise<YouTubeResult<YouTubeTokenBundle>> {
    const body = new URLSearchParams();
    body.set('client_id', input.clientId);
    body.set('client_secret', input.clientSecret);
    body.set('refresh_token', input.refreshToken);
    body.set('grant_type', 'refresh_token');
    return this.tokenRequest(body, 'فشل تجديد رمز Google.');
  }

  private async tokenRequest(body: URLSearchParams, fallback: string): Promise<YouTubeResult<YouTubeTokenBundle>> {
    try {
      const res = await this.fetchImpl(youtubeTokenUrl(this.tokenUrlOverride), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const data = await res.json().catch(() => null);
      const parsed = parseTokenResponse(data);
      if (!res.ok || !parsed.valid || !parsed.accessToken) {
        const kind = classifyYouTubeTokenError(data);
        return { ok: false, data: null, error: youTubeErrorMessage(data, kind, fallback), code: kind };
      }
      const scope = typeof data?.scope === 'string' ? String(data.scope).split(/\s+/).filter(Boolean) : [];
      return { ok: true, data: { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken, expiresIn: parsed.expiresIn, scope } };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'تعذّر الاتصال بـGoogle.'), code: 'network' };
    }
  }

  /** استدعاء GET على Data API مع ترجمة موحّدة للأخطاء. */
  private async apiGet<T>(url: string, accessToken: string, map: (data: any) => T | null, fallback: string): Promise<YouTubeResult<T>> {
    if (!accessToken) return { ok: false, data: null, error: 'رمز الوصول غير متوفر.' };
    try {
      const res = await this.fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const kind = classifyYouTubeApiError(data, res.status);
        return { ok: false, data: null, error: youTubeApiErrorMessage(kind, fallback), code: kind };
      }
      const mapped = map(data);
      if (mapped === null) return { ok: false, data: null, error: fallback, code: 'provider_error' };
      return { ok: true, data: mapped };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'تعذّر الاتصال بـGoogle.'), code: 'network' };
    }
  }

  /** استدعاء JSON (POST/PUT) على Data API مع ترجمة موحّدة للأخطاء. */
  private async apiJson<T>(url: string, method: 'POST' | 'PUT', accessToken: string, body: unknown, map: (data: any) => T | null, fallback: string): Promise<YouTubeResult<T>> {
    if (!accessToken) return { ok: false, data: null, error: 'رمز الوصول غير متوفر.' };
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const kind = classifyYouTubeApiError(data, res.status);
        return { ok: false, data: null, error: youTubeApiErrorMessage(kind, fallback), code: kind };
      }
      const mapped = map(data);
      if (mapped === null) return { ok: false, data: null, error: fallback, code: 'provider_error' };
      return { ok: true, data: mapped };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'تعذّر الاتصال بـGoogle.'), code: 'network' };
    }
  }

  /** يثبت هوية القناة فعلياً عبر channels.list?mine=true. */
  async fetchMyChannel(accessToken: string): Promise<YouTubeResult<YouTubeChannel>> {
    return this.apiGet(buildChannelsMineUrl(this.apiBase), accessToken, parseChannelListResponse, 'تعذّر إثبات هوية قناة YouTube من Google.');
  }

  /** يقرأ قائمة فيديوهات القناة عبر قائمة الرفع ثم يجلب إحصاءاتها وحالتها. */
  async listMyVideos(accessToken: string, input: { uploadsPlaylistId: string; maxResults?: number; pageToken?: string | null }): Promise<YouTubeResult<{ videos: YouTubeVideo[]; nextPageToken: string | null }>> {
    if (!input.uploadsPlaylistId) return { ok: false, data: null, error: 'معرّف قائمة رفع القناة غير متوفر.' };
    const items = await this.apiGet(
      buildUploadsPlaylistItemsUrl(input.uploadsPlaylistId, input.maxResults ?? 50, input.pageToken ?? null, this.apiBase),
      accessToken,
      (d) => (Array.isArray(d?.items) ? d.items : []),
      'تعذّر قراءة قائمة فيديوهات القناة.',
    );
    if (!items.ok || !items.data) return { ok: false, data: null, error: items.error, code: items.code ?? null };
    const ids = items.data.map((it: any) => it.contentDetails?.videoId || it.snippet?.resourceId?.videoId).filter(Boolean);
    let enriched: any[] = items.data;
    if (ids.length) {
      const detail = await this.apiGet(buildVideosListUrl(ids, this.apiBase), accessToken, (d) => (Array.isArray(d?.items) ? d.items : []), 'تعذّر قراءة تفاصيل الفيديوهات.');
      if (detail.ok && detail.data) {
        const byId = new Map(detail.data.map((v: any) => [String(v.id), v]));
        enriched = items.data.map((it: any) => {
          const vid = it.contentDetails?.videoId || it.snippet?.resourceId?.videoId;
          return byId.get(String(vid)) || it;
        });
      }
    }
    const videos = enriched.map((it: any) => normalizeVideoItem(it)).filter((v: YouTubeVideo | null): v is YouTubeVideo => Boolean(v));
    const nextPageToken = typeof (items.data as any)?.nextPageToken === 'string' ? String((items.data as any).nextPageToken) : null;
    return { ok: true, data: { videos, nextPageToken } };
  }

  /** يقرأ فيديوهات بمعرّفاتها مع الإحصاءات والحالة (videos.list). */
  async getVideos(accessToken: string, videoIds: string[]): Promise<YouTubeResult<YouTubeVideo[]>> {
    const ids = (videoIds || []).filter(Boolean);
    if (!ids.length) return { ok: true, data: [] };
    return this.apiGet(
      buildVideosListUrl(ids, this.apiBase),
      accessToken,
      (d) => (Array.isArray(d?.items) ? d.items.map((it: any) => normalizeVideoItem(it)).filter((v: YouTubeVideo | null): v is YouTubeVideo => Boolean(v)) : []),
      'تعذّر قراءة بيانات الفيديوهات.',
    );
  }

  /** إحصاءات فيديو واحد (videos.list part=statistics) — بلا اختراع قيم. */
  async getVideoStatistics(accessToken: string, videoId: string): Promise<YouTubeResult<YouTubeVideo>> {
    if (!videoId) return { ok: false, data: null, error: 'معرّف الفيديو مطلوب.' };
    const videos = await this.getVideos(accessToken, [videoId]);
    if (!videos.ok || !videos.data || !videos.data.length) return { ok: false, data: null, error: videos.error || 'لم يُعد YouTube بيانات لهذا الفيديو.', code: videos.code ?? null };
    return { ok: true, data: videos.data[0] };
  }

  /** إحصاءات القناة (channels.list part=statistics) — بلا اختراع قيم. */
  async getChannelStatistics(accessToken: string): Promise<YouTubeResult<YouTubeChannel>> {
    return this.fetchMyChannel(accessToken);
  }

  /** يقرأ سلاسل تعليقات فيديو (commentThreads.list) ويفلطحها (top-level + replies). */
  async listCommentThreads(accessToken: string, input: { videoId: string; maxResults?: number; pageToken?: string | null }): Promise<YouTubeResult<{ comments: YouTubeComment[]; nextPageToken: string | null }>> {
    if (!input.videoId) return { ok: false, data: null, error: 'معرّف الفيديو مطلوب لقراءة التعليقات.' };
    const r = await this.apiGet(
      buildCommentThreadsUrl(input.videoId, input.maxResults ?? 100, input.pageToken ?? null, this.apiBase),
      accessToken,
      (d) => {
        const threads = Array.isArray(d?.items) ? d.items : [];
        const comments: YouTubeComment[] = [];
        for (const t of threads) {
          const norm = normalizeCommentThread(t);
          if (!norm) continue;
          comments.push(norm.thread, ...norm.replies);
        }
        return comments;
      },
      'تعذّر قراءة تعليقات الفيديو.',
    );
    if (!r.ok) return { ok: false, data: null, error: r.error, code: r.code ?? null };
    return { ok: true, data: { comments: r.data as YouTubeComment[], nextPageToken: null } };
  }

  /** يقرأ ردود تعليق محدّد (comments.list?parentId). */
  async listComments(accessToken: string, input: { parentCommentId: string; maxResults?: number; pageToken?: string | null }): Promise<YouTubeResult<{ comments: YouTubeComment[]; nextPageToken: string | null }>> {
    if (!input.parentCommentId) return { ok: false, data: null, error: 'معرّف التعليق الأب مطلوب.' };
    const r = await this.apiGet(
      buildCommentsListUrl(input.parentCommentId, input.maxResults ?? 100, input.pageToken ?? null, this.apiBase),
      accessToken,
      (d) => (Array.isArray(d?.items) ? d.items.map((it: any) => normalizeCommentItem(it)).filter((c: YouTubeComment | null): c is YouTubeComment => Boolean(c)) : []),
      'تعذّر قراءة ردود التعليق.',
    );
    if (!r.ok) return { ok: false, data: null, error: r.error, code: r.code ?? null };
    return { ok: true, data: { comments: r.data as YouTubeComment[], nextPageToken: null } };
  }

  /** يرد على تعليق حقيقي (comments.insert) — لا رد مُسلَّم بلا معرّف تعليق من Google. */
  async replyToComment(accessToken: string, input: { parentCommentId: string; text: string }): Promise<YouTubeResult<{ commentId: string; text: string }>> {
    if (!input.parentCommentId) return { ok: false, data: null, error: 'معرّف التعليق الأب مطلوب للرد.' };
    if (!String(input.text || '').trim()) return { ok: false, data: null, error: 'نص الرد مطلوب.' };
    return this.apiJson(
      buildCommentsInsertUrl(this.apiBase),
      'POST',
      accessToken,
      buildCommentInsertBody(input),
      (d) => (d?.id ? { commentId: String(d.id), text: String(d.snippet?.textDisplay ?? d.snippet?.textOriginal ?? input.text) } : null),
      'لم يُعد YouTube معرّف تعليق؛ لم يُسجَّل أي رد.',
    );
  }

  /**
   * يرفع فيديو حقيقياً عبر الرفع resumable الرسمي:
   *   1) POST /upload/youtube/v3/videos?uploadType=resumable → Location.
   *   2) PUT بايتات الملف إلى Location.
   * لا يُعلن النشر بلا معرّف فيديو حقيقي من Google.
   */
  async uploadVideo(accessToken: string, input: YouTubeUploadInput): Promise<YouTubeResult<{ video: any; state: 'published' | 'scheduled' | 'processing' | 'failed'; delivered: boolean; externalVideoId: string | null; watchUrl: string | null; detail: string }>> {
    if (!accessToken) return { ok: false, data: null, error: 'رمز الوصول غير متوفر.' };
    if (!input.bytes || !input.bytes.length) return { ok: false, data: null, error: 'لا توجد بايتات فيديو للرفع.', code: 'MEDIA_REQUIRED' };
    const metadata = buildVideoInsertMetadata(input.metadata);
    try {
      const initRes = await this.fetchImpl(buildVideoInsertResumableUrl(this.uploadBase), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': input.mimeType || 'video/*',
          'X-Upload-Content-Length': String(input.bytes.length),
        },
        body: JSON.stringify(metadata),
      });
      if (!initRes.ok) {
        const data = await initRes.json().catch(() => null);
        const kind = classifyYouTubeApiError(data, initRes.status);
        return { ok: false, data: null, error: youTubeApiErrorMessage(kind, 'فشل بدء جلسة رفع الفيديو لدى YouTube.'), code: kind };
      }
      const sessionUrl = initRes.headers?.get('location') || initRes.headers?.get('Location') || null;
      if (!sessionUrl) return { ok: false, data: null, error: 'لم يُعد YouTube رابط جلسة الرفع (Location)؛ لا رفع بلا جلسة رسمية.', code: 'provider_error' };
      const putRes = await this.fetchImpl(sessionUrl, {
        method: 'PUT',
        headers: { 'Content-Type': input.mimeType || 'video/*', 'Content-Length': String(input.bytes.length) },
        body: input.bytes,
      });
      const video = await putRes.json().catch(() => null);
      if (!putRes.ok) {
        const kind = classifyYouTubeApiError(video, putRes.status);
        return { ok: false, data: null, error: youTubeApiErrorMessage(kind, 'فشل رفع بايتات الفيديو إلى YouTube.'), code: kind };
      }
      const classified = classifyVideoUploadResult(video);
      return {
        ok: true,
        data: { video, state: classified.state, delivered: classified.delivered, externalVideoId: classified.externalVideoId, watchUrl: youtubeWatchUrl(classified.externalVideoId), detail: classified.detail },
      };
    } catch (e: any) {
      return { ok: false, data: null, error: String(e?.message || 'تعذّر الاتصال بـGoogle.'), code: 'network' };
    }
  }

  /** يحدّث بيانات فيديو مملوك للقناة (videos.update). */
  async updateVideo(accessToken: string, input: { videoId: string; metadata: VideoUploadMetadataInput }): Promise<YouTubeResult<YouTubeVideo>> {
    if (!input.videoId) return { ok: false, data: null, error: 'معرّف الفيديو مطلوب للتحديث.' };
    const body = { id: input.videoId, ...buildVideoInsertMetadata(input.metadata) };
    return this.apiJson(buildVideosUpdateUrl(this.apiBase), 'PUT', accessToken, body, (d) => normalizeVideoItem(d), 'تعذّر تحديث بيانات الفيديو.');
  }
}

export { isAccessTokenExpired };
