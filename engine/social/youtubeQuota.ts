/**
 * حارس حصة YouTube Data API v3 — طبقة حماية مركزية واحدة لمسار YouTube كله.
 *
 * نمط المرجع المعماري: `engine/ai/firewall.ts` (حارس حصة Gemini). نفس المبادئ:
 * مورد واحد (هنا: حصة مشروع/تطبيق Google لـYouTube Data API، 10,000 وحدة/يوم)،
 * لا تفريع على اسم منصة، منطق صافٍ قابل للاختبار بحقن `now`، سجل أعداد بلا أسرار.
 *
 * لماذا الحارس: رفع فيديو واحد (videos.insert) يستهلك ~1600 وحدة (~16% من الحصة
 * اليومية)، ودورة المراقبة كل دقيقة تستهلك وحدات إضافية. تجاوز الحصة يوقف **كل**
 * عمليات YouTube فجأة بلا إنذار مسبق. لذلك نتتبّع الوحدات التقديرية ونُنبّه المالك
 * عند الاقتراب من عتبة آمنة **قبل** وقوع `quotaExceeded`، لا بعده.
 *
 * **الصدق:** كل الأرقام تقديرية (جدول تكاليف YouTube Data API الرسمي)، وهي حماية
 * داخلية للمشروع وليست قراءة حيّة لحصة Google. الحصة الفعلية من Google Cloud Console.
 * لا شبكة ولا أسرار ولا ساعة حقيقية هنا.
 */

/** أسماء متغيرات البيئة (مصدر واحد). */
export const YOUTUBE_DAILY_QUOTA_ENV = 'YOUTUBE_DAILY_QUOTA';
export const YOUTUBE_QUOTA_ALERT_THRESHOLD_ENV = 'YOUTUBE_QUOTA_ALERT_THRESHOLD_PERCENT';

/** الحصة الافتراضية المعلنة لـ YouTube Data API v3: 10,000 وحدة/يوم لكل مشروع. */
export const YOUTUBE_DAILY_QUOTA_DEFAULT = 10_000;

/** الحدّ الأدنى المعقول (لا حدّ صفري/سالب). */
export const YOUTUBE_DAILY_QUOTA_MIN = 100;

/**
 * الحدّ الأعلى الآمن الذي يفرضه الحارس مهما كانت قيمة البيئة: الحصص الأكبر تُقصّ
 * (clamp) فلا يمكن تعطيل الإنذار بقيمة بيئة ضخمة.
 */
export const YOUTUBE_DAILY_QUOTA_MAX_SAFE = 1_000_000;

/** عتبة الإنذار الافتراضية: 80% من الحصة اليومية (هامش أمان 20%). */
export const YOUTUBE_QUOTA_ALERT_THRESHOLD_DEFAULT = 80;

/**
 * أنواع العمليات المُتتبَّعة (تقديرية) — كل نوع يقابل نقطة نهاية واحدة في YouTube
 * Data API حتى تكون التكلفة دقيقة. التكلفة التقديرية (جدول تكاليف YouTube الرسمي):
 * - `comments_read`:  commentThreads.list + comments.list (1 وحدة/طلب).
 * - `reply`:          comments.insert (50 وحدة/طلب).
 * - `upload`:         videos.insert resumable (1600 وحدة/رفع).
 * - `video_update`:   videos.update (50 وحدة/طلب).
 * - `video_list`:     videos.list (1 وحدة/طلب).
 * - `channel_read`:   channels.list (1 وحدة/طلب).
 * - `playlist_read`:  playlistItems.list (1 وحدة/طلب).
 * - `other`:          أي طلب YouTube Data API آخر (1 وحدة افتراضاً).
 */
export type YouTubeQuotaOperation =
  | 'comments_read'
  | 'reply'
  | 'upload'
  | 'upload_session'
  | 'video_update'
  | 'video_list'
  | 'channel_read'
  | 'playlist_read'
  | 'other';

/** تكلفة الوحدات التقديرية لكل نوع عملية (مصدر واحد). */
export const YOUTUBE_QUOTA_COST: Readonly<Record<YouTubeQuotaOperation, number>> = Object.freeze({
  comments_read: 1,
  reply: 50,
  upload: 1600,
  // PUT بايتات جلسة الرفع resumable: لا يستهلك وحدات إضافية — الـ1600 تُحتسب مرة
  // واحدة على إنشاء الجلسة (videos.insert)، ولو احتُسبت مرتين لحُجب الرفع خطأً.
  upload_session: 0,
  video_update: 50,
  video_list: 1,
  channel_read: 1,
  playlist_read: 1,
  other: 1,
});

export const YOUTUBE_QUOTA_OPERATION_LABELS_AR: Readonly<Record<YouTubeQuotaOperation, string>> = Object.freeze({
  comments_read: 'قراءة التعليقات',
  reply: 'الرد على تعليق',
  upload: 'رفع فيديو',
  upload_session: 'رفع بايتات الفيديو (جلسة)',
  video_update: 'تحديث بيانات فيديو',
  video_list: 'قراءة بيانات فيديو',
  channel_read: 'قراءة بيانات القناة',
  playlist_read: 'قراءة قائمة الفيديوهات',
  other: 'طلب YouTube آخر',
});

const OPERATIONS: readonly YouTubeQuotaOperation[] = Object.freeze([
  'comments_read', 'reply', 'upload', 'upload_session', 'video_update', 'video_list', 'channel_read', 'playlist_read', 'other',
]);

function emptyByOperation(): Record<YouTubeQuotaOperation, number> {
  return { comments_read: 0, reply: 0, upload: 0, upload_session: 0, video_update: 0, video_list: 0, channel_read: 0, playlist_read: 0, other: 0 };
}

/**
 * يحسم نوع عملية YouTube من مسار الطلب + طريقة HTTP (مصدر واحد للتكلفة).
 * نقطة الرمز (`/token`) ليست ضمن حصة Data API — تُصنَّف `other` ولا تُحتسب
 * (الاستثناء الفعلي في غلاف الحارس، لا هنا).
 */
export function classifyYouTubeQuotaOperation(url: string, method = 'GET'): YouTubeQuotaOperation {
  const u = String(url || '');
  const m = String(method || 'GET').toUpperCase();
  // رفع الفيديو (resumable): POST إنشاء الجلسة = 1600 وحدة (videos.insert)، أما PUT
  // البايتات إلى الجلسة فلا يستهلك وحدات إضافية (upload_session = 0). هذا يمنع
  // احتساب 1600 مرتين على نفس عملية الرفع.
  if (u.includes('/upload/')) return m === 'PUT' ? 'upload_session' : 'upload';
  if (u.includes('/youtube/v3/comments')) return m === 'POST' ? 'reply' : 'comments_read';
  if (u.includes('/youtube/v3/commentThreads')) return 'comments_read';
  if (u.includes('/youtube/v3/playlistItems')) return 'playlist_read';
  if (u.includes('/youtube/v3/channels')) return 'channel_read';
  if (u.includes('/youtube/v3/videos')) return m === 'GET' ? 'video_list' : 'video_update';
  return 'other';
}

/** هل يُحتسب هذا الطلب ضمن حصة Data API؟ (نقطة الرمز /token مستثناة). */
export function youtubeUrlCountsAgainstQuota(url: string): boolean {
  return !String(url || '').includes('/token');
}

/** عدّادات الاستهلاك اليومي (أعداد فقط — بلا أي سرّ). */
export interface YouTubeQuotaCounters {
  /** الوحدات التقديرية المستهلكة اليوم. */
  unitsUsed: number;
  /** عدد الطلبات المقدّرة اليوم. */
  requests: number;
  /** عدد مرات بلوغ عتبة الإنذار (تشخيص). */
  thresholdReached: number;
  /** عدد الإنذارات المُرسَلة فعلاً (تشخيص). */
  alertsSent: number;
  /** تفصيل الوحدات حسب نوع العملية. */
  byOperation: Record<YouTubeQuotaOperation, number>;
}

/**
 * سجل استخدام مركزي بلا أسرار: يحفظ أعداداً فقط. لا يُخزَّن أي محتوى ولا أي مفتاح.
 * يُصفَّر عند تغيّر اليوم (نفس مبدأ `AiUsageLedger.resetDaily`).
 */
export class YouTubeQuotaLedger {
  private counters: YouTubeQuotaCounters = {
    unitsUsed: 0, requests: 0, thresholdReached: 0, alertsSent: 0, byOperation: emptyByOperation(),
  };

  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * يسجّل استهلاك عملية YouTube واحدة. `unitsOverride` يسمح بتكلفة أدق عند الحاجة.
   * القيمة الافتراضية من `YOUTUBE_QUOTA_COST`، وأي قيمة غير صالحة تُسقط إليها.
   */
  record(operation: YouTubeQuotaOperation, unitsOverride?: number): number {
    const base = YOUTUBE_QUOTA_COST[operation] ?? YOUTUBE_QUOTA_COST.other;
    const units = Number.isFinite(unitsOverride as number) && (unitsOverride as number) > 0 ? Math.floor(unitsOverride as number) : base;
    this.counters.unitsUsed += units;
    this.counters.requests += 1;
    this.counters.byOperation[operation] = (this.counters.byOperation[operation] ?? 0) + units;
    return units;
  }

  snapshot(): YouTubeQuotaCounters {
    return { ...this.counters, byOperation: { ...this.counters.byOperation } };
  }

  /**
   * يسترجع العدّادات من لقطة محفوظة (بعد restart/cold start). يتحقق من كل حقل
   * رقمياً ويرفض أي قيمة غير صالحة، فلا تُبنى حالة على بيانات تالفة.
   */
  restore(raw: any): void {
    const next: YouTubeQuotaCounters = { unitsUsed: 0, requests: 0, thresholdReached: 0, alertsSent: 0, byOperation: emptyByOperation() };
    if (raw && typeof raw === 'object') {
      const pos = (v: any) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
      next.unitsUsed = pos(raw.unitsUsed);
      next.requests = pos(raw.requests);
      next.thresholdReached = pos(raw.thresholdReached);
      next.alertsSent = pos(raw.alertsSent);
      const by = raw.byOperation && typeof raw.byOperation === 'object' ? raw.byOperation : {};
      for (const op of OPERATIONS) next.byOperation[op] = pos(by[op]);
    }
    this.counters = next;
  }

  /** يزيد عدّاد بلوغ العتبة (يُنادى مرة عند العبور، لا في كل طلب). */
  recordThresholdReached(): void { this.counters.thresholdReached += 1; }
  /** يزيد عدّاد الإنذارات المُرسَلة فعلاً (بعد منع التكرار). */
  recordAlertSent(): void { this.counters.alertsSent += 1; }

  /** تصفير العدّادات اليومية (عند تغيّر اليوم فقط). */
  resetDaily(): void {
    this.counters = { unitsUsed: 0, requests: 0, thresholdReached: 0, alertsSent: 0, byOperation: emptyByOperation() };
  }
}

/** حالة قرار الحصة اليومية (للتشخيص) بلا أي سرّ. */
export interface YouTubeQuotaLimitInspection {
  limit: number;
  configuredRaw: string | null;
  state: 'default' | 'configured' | 'clamped' | 'invalid';
  defaultLimit: number;
  maxSafe: number;
  envName: string;
}

/** يحسم الحصة اليومية من البيئة: غائب/غير صالح ⇒ الافتراضي؛ صالح ⇒ مقصوص [100, 1e6]. */
export function resolveYouTubeDailyQuota(env: Record<string, string | undefined> = {}): number {
  const raw = env[YOUTUBE_DAILY_QUOTA_ENV];
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return YOUTUBE_DAILY_QUOTA_DEFAULT;
  return Math.min(YOUTUBE_DAILY_QUOTA_MAX_SAFE, Math.max(YOUTUBE_DAILY_QUOTA_MIN, Math.floor(n)));
}

/** حالة قرار الحصة (بلا أي سرّ). */
export function inspectYouTubeDailyQuota(env: Record<string, string | undefined> = {}): YouTubeQuotaLimitInspection {
  const raw = env[YOUTUBE_DAILY_QUOTA_ENV];
  const present = raw != null && String(raw).trim() !== '';
  const n = Number(raw);
  const limit = resolveYouTubeDailyQuota(env);
  let state: YouTubeQuotaLimitInspection['state'];
  if (!present) state = 'default';
  else if (!Number.isFinite(n) || n <= 0) state = 'invalid';
  else if (n > YOUTUBE_DAILY_QUOTA_MAX_SAFE) state = 'clamped';
  else state = 'configured';
  return { limit, configuredRaw: present ? String(raw) : null, state, defaultLimit: YOUTUBE_DAILY_QUOTA_DEFAULT, maxSafe: YOUTUBE_DAILY_QUOTA_MAX_SAFE, envName: YOUTUBE_DAILY_QUOTA_ENV };
}

/** يحسم عتبة الإنذار (نسبة مئوية): غائب/خارج (0,100] ⇒ الافتراضي 80؛ صالح ⇒ مقصوص [1,100]. */
export function resolveYouTubeQuotaAlertThreshold(env: Record<string, string | undefined> = {}): number {
  const raw = env[YOUTUBE_QUOTA_ALERT_THRESHOLD_ENV];
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return YOUTUBE_QUOTA_ALERT_THRESHOLD_DEFAULT;
  return Math.max(1, Math.floor(n));
}

export interface YouTubeQuotaStatus {
  limit: number;
  usedUnits: number;
  remainingUnits: number;
  usedPercent: number;
  alertThresholdPercent: number;
  thresholdReached: boolean;
  exhausted: boolean;
  requests: number;
  thresholdReachedCount: number;
  alertsSent: number;
  byOperation: Record<YouTubeQuotaOperation, number>;
  protectionEnabled: boolean;
  day: string;
  limitLabelAr: string;
  note: string;
}

/** هل يمكن تنفيذ عملية وحداتها `units` ضمن الحصة المتبقية؟ (حارس استباقي). */
export function canAffordYouTubeQuota(usedUnits: number, limit: number, units: number): boolean {
  if (!Number.isFinite(limit) || limit <= 0) return true;
  return usedUnits + Math.max(0, units) <= limit;
}

/** يبني عدّادات تشخيصية مقروءة من العدّادات الخام + الحالة، بلا أي سرّ. */
export function buildYouTubeQuotaStatus(input: {
  counters: YouTubeQuotaCounters;
  limit: number;
  alertThresholdPercent: number;
  protectionEnabled: boolean;
  day: string;
}): YouTubeQuotaStatus {
  const used = Math.max(0, Math.floor(input.counters.unitsUsed));
  const limit = input.limit;
  const usedPercent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const thresholdReached = limit > 0 && used >= Math.floor((limit * input.alertThresholdPercent) / 100);
  return {
    limit,
    usedUnits: used,
    remainingUnits: Math.max(0, limit - used),
    usedPercent,
    alertThresholdPercent: input.alertThresholdPercent,
    thresholdReached,
    exhausted: limit > 0 && used >= limit,
    requests: input.counters.requests,
    thresholdReachedCount: input.counters.thresholdReached,
    alertsSent: input.counters.alertsSent,
    byOperation: { ...input.counters.byOperation },
    protectionEnabled: input.protectionEnabled,
    day: input.day,
    limitLabelAr: 'حصة YouTube Data API التقديرية اليومية',
    note: 'أرقام تقديرية لحماية المشروع (جدول تكاليف YouTube Data API)، وليست قراءة حيّة لحصة Google. الحصة الفعلية من Google Cloud Console.',
  };
}

/** تسمية عربية لسبب بلوغ العتبة (بلا أي سرّ). */
export function youtubeQuotaAlertReason(status: YouTubeQuotaStatus): string {
  return `استهلاك حصة YouTube Data API بلغ ${status.usedPercent}% (${status.usedUnits}/${status.limit} وحدة تقديرية) — العتبة الآمنة ${status.alertThresholdPercent}%.`;
}
