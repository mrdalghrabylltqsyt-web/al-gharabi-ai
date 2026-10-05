/**
 * اختبارات وحدة: حارس حصة YouTube Data API + منطق تنبيهات المراقب (C1 + C2).
 *
 * منطق صافٍ بلا شبكة: يثبت تكاليف الوحدات، حسم العملية من الرابط، الحدود الآمنة،
 * قرار بلوغ العتبة/الاستنفاد، الصدق في الحالة، وقرار التنبيه مع منع التكرار.
 */

import {
  YouTubeQuotaLedger,
  classifyYouTubeQuotaOperation,
  youtubeUrlCountsAgainstQuota,
  YOUTUBE_QUOTA_COST,
  resolveYouTubeDailyQuota,
  inspectYouTubeDailyQuota,
  resolveYouTubeQuotaAlertThreshold,
  buildYouTubeQuotaStatus,
  canAffordYouTubeQuota,
  youtubeQuotaAlertReason,
  YOUTUBE_DAILY_QUOTA_DEFAULT,
  YOUTUBE_DAILY_QUOTA_MAX_SAFE,
  YOUTUBE_QUOTA_ALERT_THRESHOLD_DEFAULT,
} from '../social/youtubeQuota';
import {
  resolveWatcherErrorAlertThreshold,
  shouldAlertWatcherFailure,
  shouldAlertReauth,
  watcherFailureAlertText,
  reauthAlertText,
  WATCHER_ERROR_ALERT_THRESHOLD_DEFAULT,
} from '../social/watcherAlerts';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

// ---------------------------------------------------------------------------
// C1 — حارس حصة YouTube Data API
// ---------------------------------------------------------------------------
group('C1-1) تكاليف الوحدات التقديرية (جدول YouTube Data API)');
check('رفع الفيديو = 1600 وحدة (~16% من 10,000)', YOUTUBE_QUOTA_COST.upload === 1600);
check('الرد = 50 وحدة (comments.insert)', YOUTUBE_QUOTA_COST.reply === 50);
check('تحديث الفيديو = 50 وحدة (videos.update)', YOUTUBE_QUOTA_COST.video_update === 50);
check('قراءة التعليقات = 1 وحدة', YOUTUBE_QUOTA_COST.comments_read === 1);
check('قراءة بيانات الفيديو = 1 وحدة', YOUTUBE_QUOTA_COST.video_list === 1);
check('قراءة القناة = 1 وحدة', YOUTUBE_QUOTA_COST.channel_read === 1);
check('PUT جلسة الرفع = 0 وحدة (لا احتساب مزدوج للـ1600)', YOUTUBE_QUOTA_COST.upload_session === 0);

group('C1-2) حسم نوع العملية من الرابط + طريقة HTTP');
check('POST /upload/... => upload', classifyYouTubeQuotaOperation('https://x/upload/youtube/v3/videos?uploadType=resumable', 'POST') === 'upload');
check('PUT جلسة الرفع (لاحقاً) => upload_session (0 وحدة)', classifyYouTubeQuotaOperation('https://upload.example/upload/session/fake-1', 'PUT') === 'upload_session');
check('POST /youtube/v3/comments => reply', classifyYouTubeQuotaOperation('https://x/youtube/v3/comments?part=snippet', 'POST') === 'reply');
check('GET /youtube/v3/commentThreads => comments_read', classifyYouTubeQuotaOperation('https://x/youtube/v3/commentThreads?videoId=v', 'GET') === 'comments_read');
check('GET /youtube/v3/videos => video_list', classifyYouTubeQuotaOperation('https://x/youtube/v3/videos?id=v', 'GET') === 'video_list');
check('PUT /youtube/v3/videos => video_update', classifyYouTubeQuotaOperation('https://x/youtube/v3/videos?part=snippet', 'PUT') === 'video_update');
check('GET /youtube/v3/channels => channel_read', classifyYouTubeQuotaOperation('https://x/youtube/v3/channels?mine=true', 'GET') === 'channel_read');
check('GET /youtube/v3/playlistItems => playlist_read', classifyYouTubeQuotaOperation('https://x/youtube/v3/playlistItems?playlistId=p', 'GET') === 'playlist_read');
check('نقطة الرمز لا تُحتسب', youtubeUrlCountsAgainstQuota('https://oauth2.googleapis.com/token') === false);
check('طلب Data API يُحتسب', youtubeUrlCountsAgainstQuota('https://www.googleapis.com/youtube/v3/videos') === true);

group('C1-3) حسم الحصة اليومية من البيئة (حدود آمنة)');
check('افتراضياً 10,000', resolveYouTubeDailyQuota({}) === YOUTUBE_DAILY_QUOTA_DEFAULT);
check('قيمة صالحة تُحترم', resolveYouTubeDailyQuota({ YOUTUBE_DAILY_QUOTA: '5000' }) === 5000);
check('قيمة صفرية تُرفض => الافتراضي', resolveYouTubeDailyQuota({ YOUTUBE_DAILY_QUOTA: '0' }) === YOUTUBE_DAILY_QUOTA_DEFAULT);
check('قيمة سالبة تُرفض => الافتراضي', resolveYouTubeDailyQuota({ YOUTUBE_DAILY_QUOTA: '-5' }) === YOUTUBE_DAILY_QUOTA_DEFAULT);
check('قيمة غير رقمية تُرفض => الافتراضي', resolveYouTubeDailyQuota({ YOUTUBE_DAILY_QUOTA: 'abc' }) === YOUTUBE_DAILY_QUOTA_DEFAULT);
check('قيمة ضخمة تُقصّ للحد الأعلى الآمن', resolveYouTubeDailyQuota({ YOUTUBE_DAILY_QUOTA: String(YOUTUBE_DAILY_QUOTA_MAX_SAFE + 1) }) === YOUTUBE_DAILY_QUOTA_MAX_SAFE);
const ins = inspectYouTubeDailyQuota({ YOUTUBE_DAILY_QUOTA: 'abc' });
check('الفحص يعلن invalid للقيمة الفاسدة', ins.state === 'invalid' && ins.limit === YOUTUBE_DAILY_QUOTA_DEFAULT);
check('الفحص يعلن default عند الغياب', inspectYouTubeDailyQuota({}).state === 'default');
check('الفحص يعلن clamped عند التجاوز', inspectYouTubeDailyQuota({ YOUTUBE_DAILY_QUOTA: String(YOUTUBE_DAILY_QUOTA_MAX_SAFE + 1) }).state === 'clamped');

group('C1-4) عتبة الإنذار (نسبة مئوية آمنة)');
check('افتراضياً 80', resolveYouTubeQuotaAlertThreshold({}) === YOUTUBE_QUOTA_ALERT_THRESHOLD_DEFAULT);
check('قيمة صالحة تُحترم', resolveYouTubeQuotaAlertThreshold({ YOUTUBE_QUOTA_ALERT_THRESHOLD_PERCENT: '70' }) === 70);
check('قيمة > 100 تُرفض => الافتراضي', resolveYouTubeQuotaAlertThreshold({ YOUTUBE_QUOTA_ALERT_THRESHOLD_PERCENT: '150' }) === YOUTUBE_QUOTA_ALERT_THRESHOLD_DEFAULT);
check('قيمة صفرية تُرفض => الافتراضي', resolveYouTubeQuotaAlertThreshold({ YOUTUBE_QUOTA_ALERT_THRESHOLD_PERCENT: '0' }) === YOUTUBE_QUOTA_ALERT_THRESHOLD_DEFAULT);

group('C1-5) سجل الاستخدام (Ledger) + snapshot/restore');
const ledger = new YouTubeQuotaLedger();
ledger.record('comments_read');
ledger.record('reply');
ledger.record('upload');
check('مجموع الوحدات = 1+50+1600', ledger.snapshot().unitsUsed === 1651);
check('عدد الطلبات = 3', ledger.snapshot().requests === 3);
check('تفصيل العمليات صحيح', ledger.snapshot().byOperation.upload === 1600 && ledger.snapshot().byOperation.reply === 50);
const snap = ledger.snapshot();
const restored = new YouTubeQuotaLedger();
restored.restore(snap);
check('الاسترجاع يطابق اللقطة', JSON.stringify(restored.snapshot()) === JSON.stringify(snap));
const bad = new YouTubeQuotaLedger();
bad.restore({ unitsUsed: -3, requests: 'x', byOperation: { upload: NaN } });
check('الاسترجاع يرفض القيم التالفة (لا حالة مبنية على بيانات فاسدة)', bad.snapshot().unitsUsed === 0 && bad.snapshot().requests === 0 && bad.snapshot().byOperation.upload === 0);
ledger.resetDaily();
check('resetDaily يصفّر كل العدّادات', ledger.snapshot().unitsUsed === 0 && ledger.snapshot().requests === 0);

group('C1-6) قرار العتبة والاستنفاد + الحارس الاستباقي');
const status80 = buildYouTubeQuotaStatus({ counters: { unitsUsed: 8000, requests: 100, thresholdReached: 0, alertsSent: 0, byOperation: { comments_read: 8000, reply: 0, upload: 0, upload_session: 0, video_update: 0, video_list: 0, channel_read: 0, playlist_read: 0, other: 0 } }, limit: 10000, alertThresholdPercent: 80, protectionEnabled: true, day: '2026-10-04' });
check('عند 8000/10000: العتبة بلغت', status80.thresholdReached === true);
check('عند 8000: ليس مستنفداً', status80.exhausted === false);
check('النسبة المئوية = 80', status80.usedPercent === 80);
check('المتبقي = 2000', status80.remainingUnits === 2000);
const statusFull = buildYouTubeQuotaStatus({ counters: { unitsUsed: 10000, requests: 1, thresholdReached: 1, alertsSent: 1, byOperation: { comments_read: 0, reply: 0, upload: 10000, upload_session: 0, video_update: 0, video_list: 0, channel_read: 0, playlist_read: 0, other: 0 } }, limit: 10000, alertThresholdPercent: 80, protectionEnabled: true, day: '2026-10-04' });
check('عند 10000: مستنفد', statusFull.exhausted === true);
check('الحارس الاستباقي يمنع رفعاً يفوق المتبقي', canAffordYouTubeQuota(9000, 10000, 1600) === false);
check('الحارس الاستباقي يسمح بما يقع داخل المتبقي', canAffordYouTubeQuota(8000, 10000, 1600) === true);
check('الحارس الاستباقي يسمح دوماً بلا حد صالح', canAffordYouTubeQuota(999999, 0, 1600) === true);
check('نص الإنذار يذكر النسبة والوحدات بلا سرّ', youtubeQuotaAlertReason(status80).includes('80%') && youtubeQuotaAlertReason(status80).includes('8000'));
check('الحالة تحمل ملاحظة الصدق (تقديري لا قراءة حيّة)', status80.note.includes('تقديرية'));

// ---------------------------------------------------------------------------
// C2 — منطق تنبيهات المراقب
// ---------------------------------------------------------------------------
group('C2-1) عتبة تنبيه الفشل المتكرر');
check('الافتراضية 3', resolveWatcherErrorAlertThreshold({}) === WATCHER_ERROR_ALERT_THRESHOLD_DEFAULT);
check('قيمة صالحة تُحترم', resolveWatcherErrorAlertThreshold({ YOUTUBE_WATCHER_ERROR_ALERT_THRESHOLD: '5' }) === 5);
check('قيمة أقل من الحد الأدنى تُقصّ إلى 2', resolveWatcherErrorAlertThreshold({ YOUTUBE_WATCHER_ERROR_ALERT_THRESHOLD: '1' }) === 2);
check('قيمة ضخمة تُقصّ إلى 20', resolveWatcherErrorAlertThreshold({ YOUTUBE_WATCHER_ERROR_ALERT_THRESHOLD: '999' }) === 20);
check('قيمة فاسدة => الافتراضي', resolveWatcherErrorAlertThreshold({ YOUTUBE_WATCHER_ERROR_ALERT_THRESHOLD: 'x' }) === WATCHER_ERROR_ALERT_THRESHOLD_DEFAULT);

group('C2-2) قرار التنبيه + منع التكرار (idempotent)');
check('تحت العتبة لا تنبيه', shouldAlertWatcherFailure({ consecutiveErrors: 2, errorAlerted: false, threshold: 3 }) === false);
check('عند العتبة يُنبَّه مرة', shouldAlertWatcherFailure({ consecutiveErrors: 3, errorAlerted: false, threshold: 3 }) === true);
check('بعد التنبيه لا تكرار في نفس السلسلة', shouldAlertWatcherFailure({ consecutiveErrors: 4, errorAlerted: true, threshold: 3 }) === false);
check('فوق العتبة بلا علم => يُنبَّه', shouldAlertWatcherFailure({ consecutiveErrors: 9, errorAlerted: false, threshold: 3 }) === true);
check('reauth: يُنبَّه أول مرة', shouldAlertReauth({ reauthAlerted: false }) === true);
check('reauth: لا تكرار حتى استعادة الاتصال', shouldAlertReauth({ reauthAlerted: true }) === false);

group('C2-3) نصوص التنبيه (بلا سرّ)');
const failText = watcherFailureAlertText({ consecutiveErrors: 3, lastError: 'VIDEO_LIST_FAILED', cadenceMinutes: 5, threshold: 3 });
check('عنوان الفشل عربي واضح', failText.title.includes('YouTube'));
check('نص الفشل يذكر عدد الدورات والعتبة والرمز', failText.body.includes('3') && failText.body.includes('VIDEO_LIST_FAILED'));
const reText = reauthAlertText({ accountName: 'قناة الغرابي' });
check('عنوان reauth واضح', reText.title.includes('إعادة ربط'));
check('نص reauth يذكر القناة', reText.body.includes('قناة الغرابي'));
check('نص reauth بلا حساب يُعلن عاماً', reauthAlertText({}).body.includes('YouTube'));

// ---------------------------------------------------------------------------
console.log('\n============================================================');
if (failures.length === 0) {
  console.log(`PASSED: ${passed} youtube quota/alerts unit checks`);
  process.exit(0);
} else {
  console.log(`FAILED: ${failures.length} of ${passed + failures.length}`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
