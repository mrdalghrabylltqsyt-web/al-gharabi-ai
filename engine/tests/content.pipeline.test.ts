/**
 * اختبارات مسار المحتوى الموحّد (pure) — نشر/جدولة/مراجعة بشرية.
 * منطق خالص بلا شبكة ولا مزود: يثبت كل قرارات السلامة/idempotency/الجدولة.
 */
import {
  contentGate,
  classifyContentForReview,
  decisionToState,
  contentFingerprint,
  fingerprintTag,
  matchVideoByFingerprint,
  reconcileUnknownUpload,
  isFutureSchedule,
  canTransitionContent,
  isTerminalContentState,
  summarizeContentQueue,
  computeContentBriefCounts,
  reviewActionToState,
  isValidContentReviewAction,
  suggestScheduleTime,
  filterContentActions,
  contentItemMediaState,
  CONTENT_STATES,
  CONTENT_STATE_LABELS_AR,
  CONTENT_REVIEW_ACTIONS,
} from '../social/contentPipeline';
import { defaultWatcherControls, type YouTubeWatcherControls } from '../social/youtubeWatcher';

let passed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail?: string) { if (cond) passed += 1; else fails.push(`${name}${detail ? ` — ${detail}` : ''}`); }

const on: YouTubeWatcherControls = { ...defaultWatcherControls(), enabled: true, autoReply: true, autoPublish: true, autoSchedule: true, paused: false, humanReviewMode: true };

// --- 1) بوابة المحتوى: Kill Switch أعلى من كل شيء ---
{
  check('1: Kill Switch يمنع النشر', contentGate({ ...on, paused: true }, 'publish').code === 'AUTOMATION_PAUSED');
  check('1: Kill Switch يمنع الجدولة', contentGate({ ...on, paused: true }, 'schedule').code === 'AUTOMATION_PAUSED');
  check('1: النشر يحتاج autoPublish', contentGate({ ...on, autoPublish: false }, 'publish').code === 'AUTO_PUBLISH_DISABLED');
  check('1: الجدولة تحتاج autoSchedule', contentGate({ ...on, autoSchedule: false }, 'schedule').code === 'AUTO_SCHEDULE_DISABLED');
  check('1: المراقبة المعطّلة تمنع الكل', contentGate({ ...on, enabled: false }, 'publish').code === 'WATCHER_DISABLED');
  check('1: كل الشروط => مسموح', contentGate(on, 'publish').allowed === true && contentGate(on, 'schedule').allowed === true);
}

// --- 2) تصنيف المحتوى: لا اختراع، تجاري غير موثّق => مراجعة ---
{
  const safe = classifyContentForReview({ hasMedia: true, title: 'مراجعة سيارة عائلية', safety: { safe: true, blockedCount: 0, warnCount: 0, hasCommercialClaim: false } });
  check('2: آمن وبلا وقت => auto_publish', safe.kind === 'auto_publish' && safe.code === 'SAFE_PUBLISH');
  const scheduled = classifyContentForReview({ hasMedia: true, title: 'مقطع', publishAt: '2030-01-01T00:00:00Z', safety: { safe: true, blockedCount: 0, warnCount: 0, hasCommercialClaim: false } });
  check('2: آمن وبوقت => auto_schedule', scheduled.kind === 'auto_schedule');
  const commercial = classifyContentForReview({ hasMedia: true, title: 'عرض خاص بسعر 500,000 د.ع', safety: { safe: true, blockedCount: 0, warnCount: 1, hasCommercialClaim: true } });
  check('2: تجاري غير مؤكد => review_required عالي الحساسية', commercial.kind === 'review_required' && commercial.sensitivity === 'high');
  const blocked = classifyContentForReview({ hasMedia: true, title: 'نص', safety: { safe: false, blockedCount: 2, warnCount: 0, hasCommercialClaim: false } });
  check('2: مخالفة حاجبة => blocked', blocked.kind === 'blocked');
  const noMedia = classifyContentForReview({ hasMedia: false, title: 'نص', safety: { safe: true, blockedCount: 0, warnCount: 0, hasCommercialClaim: false } });
  check('2: بلا مادة => blocked MEDIA_REQUIRED', noMedia.kind === 'blocked' && noMedia.code === 'MEDIA_REQUIRED');
  const noTitle = classifyContentForReview({ hasMedia: true, title: '  ', safety: { safe: true, blockedCount: 0, warnCount: 0, hasCommercialClaim: false } });
  check('2: بلا عنوان => blocked TITLE_REQUIRED', noTitle.kind === 'blocked' && noTitle.code === 'TITLE_REQUIRED');
}

// --- 3) قرار التصنيف => حالة أولية ---
{
  const safe = classifyContentForReview({ hasMedia: true, title: 't', safety: { safe: true, blockedCount: 0, warnCount: 0, hasCommercialClaim: false } });
  check('3: آمن + إذن ممنوح => APPROVED', decisionToState(safe, on).state === 'APPROVED');
  check('3: آمن + نشر معطّل => REVIEW_REQUIRED بصراحة', decisionToState(safe, { ...on, autoPublish: false }).state === 'REVIEW_REQUIRED');
  check('3: Kill Switch => REVIEW_REQUIRED لا تنفيذ', decisionToState(safe, { ...on, paused: true }).state === 'REVIEW_REQUIRED');
  const rev = classifyContentForReview({ hasMedia: true, title: 't', safety: { safe: true, blockedCount: 0, warnCount: 1, hasCommercialClaim: true } });
  check('3: مراجعة => REVIEW_REQUIRED', decisionToState(rev, on).state === 'REVIEW_REQUIRED');
}

// --- 4) بصمة idempotency حتمية ---
{
  const a = contentFingerprint({ title: 'نفس', description: 'd', tags: ['b', 'a'], mediaRef: 'm1' });
  const b = contentFingerprint({ title: 'نفس', description: 'd', tags: ['a', 'b'], mediaRef: 'm1' });
  const c = contentFingerprint({ title: 'مختلف', description: 'd', tags: ['a', 'b'], mediaRef: 'm1' });
  check('4: البصمة حتمية (ترتيب الوسوم لا يؤثر)', a === b);
  check('4: البصمة تتغير بتغير المحتوى', a !== c);
  check('4: الوسم يُبنى من البصمة', fingerprintTag(a).startsWith('gharabiai-'));
}

// --- 5) المطابقة الحقيقية للفيديو بالبصمة (إعادة مزامنة) ---
{
  const fp = contentFingerprint({ title: 'x', mediaRef: 'm' });
  const videos = [{ videoId: 'vid1', title: 'x', tags: ['a', fingerprintTag(fp)] }, { videoId: 'vid2', title: 'y', tags: [] }];
  const m = matchVideoByFingerprint(videos, fp);
  check('5: يطابق الفيديو الحقيقي بالوسم', m?.videoId === 'vid1');
  check('5: لا يطابق فيديو بلا البصمة', matchVideoByFingerprint([{ videoId: 'z', tags: [] }], fp) === null);
}

// --- 6) إعادة مزامنة الحالة غير المؤكدة ---
{
  const found = reconcileUnknownUpload({ videoId: 'vid9', title: 't' }, null);
  check('6: وُجد الفيديو => PUBLISHED بلا نشر ثانٍ', found.status === 'FOUND' && found.state === 'PUBLISHED');
  const foundSched = reconcileUnknownUpload({ videoId: 'vid9', title: 't' }, '2030-01-01T00:00:00Z');
  check('6: وُجد المجدول => SCHEDULED', foundSched.state === 'SCHEDULED');
  const notFound = reconcileUnknownUpload(null, null);
  check('6: لم يُوجد => NOT_FOUND (retry مضبوط)', notFound.status === 'NOT_FOUND');
}

// --- 7) تحقّق وقت الجدولة ---
{
  const now = Date.parse('2026-01-01T00:00:00Z');
  check('7: المستقبل صالح', isFutureSchedule('2027-01-01T00:00:00Z', now).ok === true);
  check('7: الماضي مرفوض', isFutureSchedule('2025-01-01T00:00:00Z', now).ok === false);
  check('7: صيغة فاسدة مرفوضة', isFutureSchedule('ليس وقتاً', now).ok === false);
  check('7: بلا وقت صالح (نشر فوري)', isFutureSchedule(null, now).ok === true);
}

// --- 8) انتقالات الحالة ---
{
  check('8: APPROVED → SCHEDULED مسموح', canTransitionContent('APPROVED', 'SCHEDULED'));
  check('8: SCHEDULED → CANCELLED مسموح', canTransitionContent('SCHEDULED', 'CANCELLED'));
  check('8: REJECTED نهائي', isTerminalContentState('REJECTED') && canTransitionContent('REJECTED', 'PUBLISHED') === false);
  check('8: CANCELLED نهائي', isTerminalContentState('CANCELLED'));
  check('8: PUBLISHED → REJECTED مرفوض', canTransitionContent('PUBLISHED', 'REJECTED') === false);
  check('8: الحالات الإحدى عشرة معرّفة', CONTENT_STATES.length === 9 && Boolean(CONTENT_STATE_LABELS_AR.VERIFIED));
}

// --- 9) قرارات المراجعة ---
{
  check('9: رفض => REJECTED', reviewActionToState('reject', on).state === 'REJECTED');
  check('9: إلغاء => CANCELLED', reviewActionToState('cancel', on).state === 'CANCELLED');
  check('9: تعديل => DRAFT', reviewActionToState('edit', on).state === 'DRAFT');
  check('9: موافقة => APPROVED', reviewActionToState('approve', on).state === 'APPROVED');
  check('9: جدولة بلا وقت => لا تنفيذ', reviewActionToState('schedule', on, null).state === 'APPROVED');
  check('9: جدولة بوقت + إذن => APPROVED', reviewActionToState('schedule', on, '2030-01-01T00:00:00Z').state === 'APPROVED');
  check('9: جدولة بوقت + جدولة معطّلة => REVIEW_REQUIRED', reviewActionToState('schedule', { ...on, autoSchedule: false }, '2030-01-01T00:00:00Z').state === 'REVIEW_REQUIRED');
  check('9: نشر الآن + Kill Switch => REVIEW_REQUIRED', reviewActionToState('publish_now', { ...on, paused: true }).state === 'REVIEW_REQUIRED');
  check('9: إجراءات المراجعة الست صالحة', ['approve', 'reject', 'edit', 'publish_now', 'schedule', 'cancel'].every(isValidContentReviewAction));
  check('9: إجراء مجهول مرفوض', isValidContentReviewAction('hack') === false);
  // حجب العمليات التي تحتاج مادة عند غياب الفيديو (مصدر واحد للواجهة والخادم).
  check('9: موافقة بلا مادة => MEDIA_REQUIRED', reviewActionToState('approve', on, null, false).code === 'MEDIA_REQUIRED');
  check('9: نشر الآن بلا مادة => مرفوض', reviewActionToState('publish_now', on, null, false).state === 'REVIEW_REQUIRED');
  check('9: جدولة بلا مادة => مرفوض', reviewActionToState('schedule', on, '2030-01-01T00:00:00Z', false).state === 'REVIEW_REQUIRED');
  check('9: الرفض يبقى مسموحاً بلا مادة', reviewActionToState('reject', on, null, false).state === 'REJECTED');
  check('9: التعديل يبقى مسموحاً بلا مادة', reviewActionToState('edit', on, null, false).state === 'DRAFT');
  check('9: filterContentActions بلا مادة يخفي الموافقة/النشر/الجدولة', JSON.stringify(filterContentActions(CONTENT_REVIEW_ACTIONS, false)) === JSON.stringify(['reject', 'edit', 'cancel']));
  check('9: filterContentActions مع مادة يُبقي الكل', filterContentActions(CONTENT_REVIEW_ACTIONS, true).length === 6);
  check('9: contentItemMediaState يعلن المادة المطلوبة بصدق', contentItemMediaState({ mediaRef: '', hasMedia: false }) === 'MEDIA_REQUIRED' && contentItemMediaState({ hasMedia: true }) === 'COMPLETE');
}

// --- 10) الملخص والبطاقات (مصدر واحد) ---
{
  const items = [
    { state: 'PUBLISHED' as const, verified: true },
    { state: 'SCHEDULED' as const, verified: false },
    { state: 'REVIEW_REQUIRED' as const, verified: false },
    { state: 'REJECTED' as const, verified: false },
    { state: 'FAILED' as const, verified: false },
  ];
  const s = summarizeContentQueue(items);
  check('10: الملخص يعدّ الحالات', s.scheduled === 1 && s.awaitingReview === 1 && s.rejected === 1 && s.failed === 1 && s.verified === 1);
  const c = computeContentBriefCounts(items);
  check('10: بطاقة منشور = منشور+متحقق', c.contentPublished === 1);
  check('10: بطاقة مجدول', c.contentScheduled === 1);
  check('10: بطاقة مراجعة', c.contentAwaitingReview === 1);
}

// --- 11) ذكاء الجدولة: لا ادعاء بلا عيّنة كافية ---
{
  const few = suggestScheduleTime({ engagementTimestamps: ['2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z'] });
  check('11: عيّنة صغيرة => sampleInsufficient + بلا ساعة مزعومة', few.sampleInsufficient === true && few.peakHour === null && few.action === 'fallback_time');
  const many = suggestScheduleTime({ engagementTimestamps: Array.from({ length: 20 }, (_, i) => `2026-01-0${(i % 9) + 1}T19:00:00Z`) });
  check('11: عيّنة كافية => ساعة ذروة حقيقية 19 ببغداد', many.sampleInsufficient === false && many.peakHour === 22 && many.action === 'use_data');
  check('11: العدد واقعي (لا اختراع)', many.sampleSize === 20);
}

console.log(`PASSED: ${passed} checks`);
if (fails.length) { console.error(`FAILED (${fails.length}):`); for (const f of fails) console.error('  - ' + f); process.exit(1); }
