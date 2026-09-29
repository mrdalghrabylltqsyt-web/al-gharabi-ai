/**
 * اختبارات مركز مراجعة تقرير YouTube اليومي (منطق خالص، بلا شبكة وبلا أسرار).
 *
 * يثبت أن كل رقم في التقرير يُربط بنفس السجلات التي كوّنته (لا discrepancy)، وأن
 * الفلاتر لا تُنشئ بيانات، وأن فتح التفاصيل لا يغيّر أي حالة، وأن قرارات المراجعة
 * لا تفرض رداً بلا بوابة، وأن الصفر يعرض حالة فارغة صحيحة.
 */

import {
  WATCHER_BRIEF_METRICS,
  WATCHER_BRIEF_METRIC_LABELS_AR,
  WATCHER_REVIEW_ACTIONS,
  computeBriefCounts,
  buildMetricViews,
  selectMetricEntries,
  toDetailRecord,
  applyDetailFilters,
  isWithinBriefWindow,
  isDeferredEntry,
  overrideForcesReply,
  overrideForcedStage,
  isValidReviewAction,
  normalizeReviewOverrides,
  latestOverridesByComment,
  type WatcherReviewOverride,
} from '../social/watcherReview';
import type { WatcherProcessedEntry } from '../social/youtubeWatcher';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const now = Date.now();
const iso = (offsetMs = 0) => new Date(now - offsetMs).toISOString();
function entry(p: Partial<WatcherProcessedEntry>): WatcherProcessedEntry {
  return {
    commentId: 'c0', stage: 'ANALYZED', action: 'skip', reason: 'r', videoId: 'v1', authorName: 'a',
    text: 'تعليق', at: iso(), ...p,
  } as WatcherProcessedEntry;
}

// مجموعة سجلات متنوعة تغطي كل الحالات + تعليق قديم خارج النافذة.
const fixtures: WatcherProcessedEntry[] = [
  entry({ commentId: 'r1', stage: 'REPLIED', text: 'تسلمون 🌹', externalReplyId: 'r1.x', replyText: 'تسلم 🌸' }),
  entry({ commentId: 'r2', stage: 'REPLIED', text: 'شكراً جزيلاً', externalReplyId: 'r2.x' }),
  entry({ commentId: 'v1', stage: 'VERIFIED', text: 'ممتاز جدا', externalReplyId: 'v1.x' }),
  entry({ commentId: 's1', stage: 'SKIPPED', code: 'SKIP_SPAM', text: 'ربح سريع https://x.y' }),
  entry({ commentId: 's2', stage: 'SKIPPED', deferred: true, code: 'DEFER_AUTOREPLY_DISABLED', reason: 'الرد الآلي غير ممكّن حالياً (إعداد المالك)؛ أُجّل التعليق بلا إرسال وسيُعاد تقييمه عند التمكين.', text: 'هل متوفر؟' }),
  entry({ commentId: 'e1', stage: 'ESCALATED', code: 'ESCALATE_BUSINESS_INQUIRY', text: 'كم سعر التقسيط؟' }),
  entry({ commentId: 'f1', stage: 'FAILED', text: 'وين موقعكم؟' }),
  entry({ commentId: 'p1', stage: 'ANALYZED', text: 'خدمة راقية ما شاء الله' }),
  entry({ commentId: 'n1', stage: 'ANALYZED', text: 'شكوى تأخير في التسليم' }),
  entry({ commentId: 'old', stage: 'REPLIED', at: iso(30 * 3_600_000), text: 'قديم' }),
];

// --- A) النافذة الزمنية ---
{
  check('A: سجل حديث داخل النافذة', isWithinBriefWindow(entry({}), now) === true);
  check('A: سجل عمره 30 ساعة خارج النافذة', isWithinBriefWindow(entry({ at: iso(30 * 3_600_000) }), now) === false);
  check('A: زمن غير صالح خارج النافذة', isWithinBriefWindow(entry({ at: 'not-a-date' }), now) === false);
}

// --- B) كل بطاقة: العدد == عدد السجلات المُرجَعة (لا discrepancy) ---
{
  const counts = computeBriefCounts(fixtures, now);
  for (const m of WATCHER_BRIEF_METRICS) {
    check(`B: ${m} — العدد يطابق قائمة السجلات`, counts[m] === selectMetricEntries(fixtures, m, now).length, `${counts[m]}`);
  }
  check('B: تعليقات جديدة = 9 (بلا القديم)', counts.newComments === 9, String(counts.newComments));
  check('B: الردود = 3 (REPLIED+VERIFIED)', counts.replies === 3, String(counts.replies));
  check('B: المتجاهلة = 2', counts.skipped === 2, String(counts.skipped));
  check('B: المصعدة = 1', counts.escalated === 1, String(counts.escalated));
  check('B: المتحققة = 1', counts.verifiedReplies === 1, String(counts.verifiedReplies));
  check('B: الفاشلة = 1', counts.failedReplies === 1, String(counts.failedReplies));
  check('B: المشاعر الموجبة > 0', counts.positive >= 1, String(counts.positive));
  check('B: المشاعر السالبة = 1 (شكوى)', counts.negative === 1, String(counts.negative));
  const views = buildMetricViews(fixtures, now);
  check('B: بطاقة لكل مفتاح مع مسمّاه العربي', views.length === WATCHER_BRIEF_METRICS.length && views.every((v) => Boolean(v.labelAr)));
  check('B: عدّاد البطاقة يطابق المُحدِّد', views.every((v) => v.count === selectMetricEntries(fixtures, v.key, now).length));
}

// --- C) بطاقة «المؤجَّلة» (skipped) تُظهر سبب التأجيل لا كلمة مبهمة ---
{
  const skipped = selectMetricEntries(fixtures, 'skipped', now);
  const deferred = skipped.find((s) => s.commentId === 's2');
  check('C: التعليق المؤجَّل داخل المتجاهلة', Boolean(deferred));
  check('C: تمييز المؤجَّل عن التجاهل النهائي', isDeferredEntry(deferred!) === true);
  const rec = toDetailRecord(deferred!);
  check('C: سبب التأجيل صريح (لا كلمة مبهمة)', rec.reason.length > 5 && rec.deferred === true);
  check('C: كود القرار محفوظ', rec.code === 'DEFER_AUTOREPLY_DISABLED');
}

// --- D) السجل التفصيلي: حقول حقيقية بلا اختلاق ---
{
  const rec = toDetailRecord(entry({ commentId: 'e1', stage: 'ESCALATED', code: 'ESCALATE_BUSINESS_INQUIRY', text: 'كم سعر التقسيط؟', authorName: 'أحمد', videoId: 'vid9', publishedAt: iso(3_600_000) }), { videoTitles: { vid9: 'عرض جديد' } });
  check('D: المعرّف الحقيقي', rec.commentId === 'e1');
  check('D: المنصة youtube', rec.platform === 'youtube');
  check('D: اسم صاحب التعليق', rec.authorName === 'أحمد');
  check('D: رابط الفيديو حقيقي', rec.videoUrl === 'https://www.youtube.com/watch?v=vid9');
  check('D: عنوان الفيديو من القراءة', rec.videoTitle === 'عرض جديد');
  check('D: مسمّى الحالة العربي', rec.stageLabelAr === 'مُصعَّد للمالك');
  check('D: يحتاج مراجعة', rec.needsReview === true);
  check('D: التصنيف يحمل مسمّى عربي', rec.classification.intentLabelAr.length > 0 && rec.classification.sentimentLabelAr.length > 0);
  check('D: الرد المقترح موجود (حتمي)', typeof rec.suggestedReply === 'string');
  check('D: لا يُعلن تسليم بلا معرّف رد', toDetailRecord(entry({ stage: 'REPLIED', externalReplyId: null })).delivered === false);
  check('D: التسليم يُعلن بمعرّف رد حقيقي', toDetailRecord(entry({ stage: 'VERIFIED', externalReplyId: 'x.y' })).delivered === true);
}

// --- E) الفلاتر لا تُنشئ بيانات ولا تُغيّر الحالة ---
{
  const all = selectMetricEntries(fixtures, 'newComments', now).map((e) => toDetailRecord(e));
  const before = JSON.stringify(all);
  const delivered = applyDetailFilters(all, { delivered: true });
  check('E: فلتر «تم الرد» يُرجع المُسلَّم فقط', delivered.every((r) => r.delivered === true));
  const review = applyDetailFilters(all, { needsReview: true });
  check('E: فلتر «يحتاج مراجعة» يُرجع المصعد/الفاشل', review.every((r) => r.needsReview === true) && review.length >= 2);
  const byStage = applyDetailFilters(all, { stage: 'SKIPPED' });
  check('E: فلتر الحالة', byStage.every((r) => r.stage === 'SKIPPED'));
  const q = applyDetailFilters(all, { q: 'التقسيط' });
  check('E: فلتر البحث', q.every((r) => r.text.includes('التقسيط')));
  const none = applyDetailFilters(all, { q: 'لا-يوجد-هذا-النص' });
  check('E: بحث بلا نتيجة = صفر (حالة فارغة)', none.length === 0);
  check('E: الفلترة لا تُغيّر السجلات الأصلية', JSON.stringify(all) === before);
}

// --- F) الصفر يعرض حالة فارغة صحيحة ---
{
  const empty: WatcherProcessedEntry[] = [];
  const counts = computeBriefCounts(empty, now);
  check('F: كل الأرقام صفر على مجموعة فارغة', WATCHER_BRIEF_METRICS.every((m) => counts[m] === 0));
  check('F: قائمة السجلات فارغة', selectMetricEntries(empty, 'positive', now).length === 0);
  const onlyOld = [entry({ at: iso(48 * 3_600_000) })];
  check('F: مجموعة خارج النافذة = صفر', computeBriefCounts(onlyOld, now).newComments === 0);
}

// --- G) قرارات المراجعة: صحة الإجراء + الأثر على الحالة ---
{
  check('G: كل الإجراءات المعروفة صحيحة', WATCHER_REVIEW_ACTIONS.every((a) => isValidReviewAction(a)));
  check('G: إجراء غير معروف مرفوض', isValidReviewAction('delete_everything') === false);
  const allow: WatcherReviewOverride = { commentId: 'c', action: 'allow_reply', at: iso(), by: 'owner' };
  const reproc: WatcherReviewOverride = { commentId: 'c', action: 'reprocess', at: iso(), by: 'owner' };
  const block: WatcherReviewOverride = { commentId: 'c', action: 'block_reply', at: iso(), by: 'owner' };
  const esc: WatcherReviewOverride = { commentId: 'c', action: 'escalate', at: iso(), by: 'owner' };
  check('G: allow_reply يفرض الرد', overrideForcesReply(allow) === true);
  check('G: reprocess يفرض الرد (إعادة تقييم)', overrideForcesReply(reproc) === true);
  check('G: block_reply لا يفرض رداً', overrideForcesReply(block) === false);
  check('G: block_reply ⇒ SKIPPED', overrideForcedStage(block) === 'SKIPPED');
  check('G: ignore ⇒ SKIPPED', overrideForcedStage({ ...block, action: 'ignore' }) === 'SKIPPED');
  check('G: escalate ⇒ ESCALATED', overrideForcedStage(esc) === 'ESCALATED');
  check('G: allow_reply لا يفرض مرحلة (يمر بالبوابات)', overrideForcedStage(allow) === null);
}

// --- H) تطبيع الـoverrides: لا فقدان/اختلاق، الأحدث يفوز ---
{
  const raw = [
    { commentId: 'c1', action: 'ignore', at: iso(1000), by: 'owner' },
    { commentId: 'c1', action: 'allow_reply', at: iso(0), by: 'owner' },
    { commentId: 'c2', action: 'bogus' },
    { nope: true },
  ];
  const norm = normalizeReviewOverrides(raw as any);
  check('H: يُسقط الإجراءات غير الصالحة', norm.length === 2 && norm.every((o) => isValidReviewAction(o.action)));
  const map = latestOverridesByComment(norm);
  check('H: آخر قرار يفوز لنفس التعليق', map['c1'].action === 'allow_reply');
  check('H: مدخل غير مصفوفة ⇒ لا انفجار', normalizeReviewOverrides(null).length === 0);
}

// --- I) التسميات العربية موجودة لكل بطاقة وكل إجراء (لواجهة مفهومة) ---
{
  check('I: مسمّى عربي لكل بطاقة', WATCHER_BRIEF_METRICS.every((m) => Boolean(WATCHER_BRIEF_METRIC_LABELS_AR[m])));
}

console.log('\n============================================================');
if (failures.length) {
  console.log(`FAILED: ${failures.length}`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
} else {
  console.log(`PASSED: ${passed} watcher review checks`);
}
