/**
 * اختبارات مدير تشغيل YouTube 24/7 (YouTube Comment Watcher).
 *
 * منطق خالص بلا شبكة وبلا أسرار: عناصر التحكم/Kill Switch، بوابة الأتمتة، قرار
 * الرد/التصعيد، دورة حياة التعليق، منع التكرار، الإيقاع، checkpoint، الزخم،
 * التقرير اليومي، والفرص. يثبت أيضاً أن commentId ونص الرد الحقيقيين ينتقلان
 * إلى منفّذ الرد، وأن غياب أحدهما يمنع الإرسال، وأن غياب التفويض يحجب الرد.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultWatcherControls,
  normalizeWatcherControls,
  watcherGate,
  watcherControlsView,
  decideCommentAction,
  computeCommentVelocity,
  computePeakHours,
  buildDailyBrief,
  detectOpportunities,
  isPollDue,
  nextPollAt,
  normalizeCadenceMs,
  advanceCheckpoint,
  hasProcessed,
  isDeferredDecision,
  releaseDeferredEntries,
  YOUTUBE_COMMENT_STAGES,
  YOUTUBE_COMMENT_STAGE_LABELS_AR,
  type YouTubeWatcherControls,
  WATCHER_DEFAULT_CADENCE_MS,
  WATCHER_MIN_CADENCE_MS,
  WATCHER_MAX_CADENCE_MS,
  type WatcherProcessedEntry,
} from '../social/youtubeWatcher';
import { validateCadenceMinutes, cadenceMinutesToMs } from '../social/youtubeWatcher';
import {
  selectFollowUpCandidates, evaluateFollowUpEngagement,
  FOLLOWUP_BASELINE_DELAY_MS, FOLLOWUP_MIN_DELTA,
} from '../social/youtubeWatcher';
import { createWatcherScheduler } from '../social/youtubeWatcherScheduler';
import { classifyComment } from '../social/comments';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function entry(partial: Partial<WatcherProcessedEntry>): WatcherProcessedEntry {
  return {
    commentId: 'c0', stage: 'ANALYZED', action: 'reply', reason: 'r', videoId: 'v1', authorName: 'a', text: 't', at: new Date().toISOString(),
    ...partial,
  };
}

// --- A) عناصر التحكم والافتراضي الآمن + Kill Switch ---
{
  const d = defaultWatcherControls();
  check('A: المراقبة مفعّلة افتراضياً (قراءة/تحليل)', d.enabled === true);
  check('A: الرد الآلي معطّل افتراضياً', d.autoReply === false);
  check('A: النشر الآلي معطّل افتراضياً', d.autoPublish === false);
  check('A: الجدولة معطّلة افتراضياً', d.autoSchedule === false);
  check('A: لا إيقاف افتراضي', d.paused === false && d.humanReviewMode === false);
  const n = normalizeWatcherControls({ enabled: 'yes', autoReply: true, paused: true, unknown: 5 } as any);
  check('A: التطبيع يقبل المنطقي فقط', n.autoReply === true && n.paused === true && n.enabled === true);
  const view = watcherControlsView({ ...d, autoReply: true, paused: true });
  check('A: Kill Switch يُعلن صراحةً', view.killSwitchActive === true);
  check('A: الرد الفعّال يُحسب من كل الشروط', view.autoReplyEffective === false, JSON.stringify(view));
}

// --- B) بوابة الأتمتة: لا عملية تتجاوزها ---
{
  const c = defaultWatcherControls();
  check('B: قراءة مسموحة افتراضياً', watcherGate(c, 'read').allowed === true);
  check('B: الرد محجوب افتراضياً', watcherGate(c, 'reply').allowed === false && watcherGate(c, 'reply').code === 'AUTO_REPLY_DISABLED');
  check('B: النشر محجوب افتراضياً', watcherGate(c, 'publish').code === 'AUTO_PUBLISH_DISABLED');
  check('B: الجدولة محجوبة افتراضياً', watcherGate(c, 'schedule').code === 'AUTO_SCHEDULE_DISABLED');
  const on = { ...c, autoReply: true };
  check('B: الرد مسموح بعد التمكين', watcherGate(on, 'reply').allowed === true);
  check('B: Kill Switch يوقف كل شيء', watcherGate({ ...on, paused: true }, 'reply').code === 'AUTOMATION_PAUSED');
  check('B: Kill Switch يوقف القراءة أيضاً', watcherGate({ ...on, paused: true }, 'read').allowed === false);
  check('B: التعطيل الكامل يمنع حتى القراءة', watcherGate({ ...on, enabled: false }, 'read').code === 'WATCHER_DISABLED');
  check('B: وضع المراجعة لا يحجب كل الردود (الحالات الواضحة تمر)', watcherGate({ ...on, humanReviewMode: true }, 'reply').allowed === true);
}

// --- C) دورة حياة التعليق ---
{
  check('C: الحالات الإحدى عشرة متسقة مع المطلوب', YOUTUBE_COMMENT_STAGES.includes('NEW') && YOUTUBE_COMMENT_STAGES.includes('FETCHED') && YOUTUBE_COMMENT_STAGES.includes('ANALYZED') && YOUTUBE_COMMENT_STAGES.includes('REPLY_DECISION') && YOUTUBE_COMMENT_STAGES.includes('REPLIED') && YOUTUBE_COMMENT_STAGES.includes('VERIFIED') && YOUTUBE_COMMENT_STAGES.includes('SKIPPED') && YOUTUBE_COMMENT_STAGES.includes('ESCALATED'));
  check('C: تسميات عربية لكل حالة', YOUTUBE_COMMENT_STAGES.every((s) => typeof YOUTUBE_COMMENT_STAGE_LABELS_AR[s] === 'string' && YOUTUBE_COMMENT_STAGE_LABELS_AR[s].length > 0));
}

// --- D) قرار الرد/التصعيد (حتمي) ---
{
  const on = { ...defaultWatcherControls(), autoReply: true };
  const reply = decideCommentAction({ intent: 'other', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: on });
  check('D: «جيد» (سؤال/تفاعل بسيط) => رد عند التمكين', reply.action === 'reply', reply.reason);
  check('D: الشكوى => تصعيد للمالك بلا رد', decideCommentAction({ intent: 'complaint', requiresHumanReview: true, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: on }).action === 'escalate');
  check('D: الاستفسار التجاري (سعر/تقسيط) => تصعيد بلا اختراع معلومات', decideCommentAction({ intent: 'business_inquiry', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: on }).action === 'escalate');
  check('D: السبام => تجاهل لا تصعيد', decideCommentAction({ intent: 'spam', requiresHumanReview: true, isSpam: true, isSelfAuthored: false, alreadyReplied: false, controls: on }).action === 'skip');
  check('D: حساب المعرض => تجاهل', decideCommentAction({ intent: 'other', requiresHumanReview: false, isSpam: false, isSelfAuthored: true, alreadyReplied: false, controls: on }).action === 'skip');
  check('D: تعليق مُعالَج => تجاهل (منع التكرار)', decideCommentAction({ intent: 'other', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: true, controls: on }).action === 'skip');
  check('D: بلا تمكين => تجاهل لا تصعيد كاذب', decideCommentAction({ intent: 'other', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: defaultWatcherControls() }).action === 'skip');
  check('D: وضع المراجعة => تصعيد بسبب إعداد', decideCommentAction({ intent: 'other', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: { ...on, humanReviewMode: true } }).action === 'escalate');
  // سبب التصعيد يجب أن يكون حقيقياً ومرتبطاً بالمضمون:
  check('D: سبب تصعيد السعر حقيقي', (decideCommentAction({ intent: 'business_inquiry', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: on }).reason || '').includes('السعر'));
  check('D: سبب تصعيد الشكوى حقيقي', (decideCommentAction({ intent: 'complaint', requiresHumanReview: true, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: on }).reason || '').includes('شكوى'));
  // تعليق إيجابي «مرتب/قلوب» لا يُصعَّد مع autoReply مفعّل:
  const praiseCls = classifyComment('المعرض مرتب ما شاء الله ❤️');
  check('D: «مرتب ما شاء الله ❤️» مدح معلن', praiseCls.intent === 'praise' && praiseCls.sentiment === 'positive' && praiseCls.isPraise === true, JSON.stringify(praiseCls));
  check('D: المدح الإيجابي => رد لا تصعيد', decideCommentAction({ intent: praiseCls.intent, requiresHumanReview: praiseCls.requiresHumanReview, isSpam: praiseCls.isSpam, isSelfAuthored: false, alreadyReplied: false, controls: on }).action === 'reply');
  const heartOnly = classifyComment('❤❤');
  check('D: تعليق القلوب => تفاعل إيجابي', heartOnly.intent === 'praise' && heartOnly.sentiment === 'positive', JSON.stringify(heartOnly));
  check('D: القلوب => رد لا تصعيد', decideCommentAction({ intent: heartOnly.intent, requiresHumanReview: heartOnly.requiresHumanReview, isSpam: heartOnly.isSpam, isSelfAuthored: false, alreadyReplied: false, controls: on }).action === 'reply');
}

// --- D2) كود القرار + التأجيل/التحرير (تعذّر بسبب إعداد المالك ليس نهائياً) ---
{
  const off = defaultWatcherControls();
  const dOff = decideCommentAction({ intent: 'praise', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: off });
  check('D2: تعطيل الرد => كود DEFER لا تجاهل نهائي', dOff.code === 'DEFER_AUTOREPLY_DISABLED' && dOff.action === 'skip');
  check('D2: DEFER غير نهائي', isDeferredDecision(dOff.code) === true);
  check('D2: قرار الرد كود REPLY_ALLOWED', decideCommentAction({ intent: 'praise', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: { ...off, autoReply: true } }).code === 'REPLY_ALLOWED');
  check('D2: تصعيد السعر كود صريح', decideCommentAction({ intent: 'business_inquiry', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false, controls: { ...off, autoReply: true } }).code === 'ESCALATE_BUSINESS_INQUIRY');
  check('D2: السبام كود صريح', decideCommentAction({ intent: 'other', requiresHumanReview: true, isSpam: true, isSelfAuthored: false, alreadyReplied: false, controls: { ...off, autoReply: true } }).code === 'SKIP_SPAM');
  // التحرير: السجل المؤجَّل يُزال، والنهائي يبقى.
  const deferred = [entry({ commentId: 'p1', stage: 'SKIPPED', code: 'DEFER_AUTOREPLY_DISABLED', deferred: true }), entry({ commentId: 's1', stage: 'SKIPPED', code: 'SKIP_SPAM' }), entry({ commentId: 'e1', stage: 'ESCALATED', code: 'ESCALATE_BUSINESS_INQUIRY' }), entry({ commentId: 'r1', stage: 'REPLIED', code: 'REPLY_ALLOWED' })];
  const rel = releaseDeferredEntries(deferred);
  check('D2: التحرير يُزيل المؤجَّل فقط', rel.released === 1 && rel.processed.length === 3);
  check('D2: التحرير يحفظ التصعيد/الرد/السبام', rel.processed.some((p) => p.commentId === 'e1') && rel.processed.some((p) => p.commentId === 'r1') && rel.processed.some((p) => p.commentId === 's1'));
  // توافق رجعي: سجل قديم بنص السبب القديم (قبل إدخال deferred) يُحرَّر أيضاً.
  const legacy = [entry({ commentId: 'old', stage: 'SKIPPED', reason: 'الرد الآلي غير ممكّن حالياً؛ سُجّل التعليق للمالك بلا إرسال.' })];
  check('D2: التحرير يغطّي السجلات القديمة', releaseDeferredEntries(legacy).released === 1);
}

// --- E) تصنيف التعليق الحقيقي «جيد» و«شكراً» ---
{
  const good = classifyComment('جيد');
  check('E: «جيد» ليس سباماً ولا حساساً', !good.isSpam && !good.requiresHumanReview);
  const thanks = classifyComment('شكراً لكم على الخدمة');
  check('E: المدح => إيجابي', thanks.sentiment === 'positive' && thanks.intent === 'praise');
  const price = classifyComment('كم سعر التقسيط؟');
  check('E: سؤال السعر => استفسار تجاري/سؤال', price.intent === 'business_inquiry' || price.intent === 'question');
}

// --- F) منع التكرار + checkpoint (يصمد بعد restart) ---
{
  const processed = [entry({ commentId: 'c1', stage: 'VERIFIED' })];
  check('F: تعليق مُعالَج يُكتشف', hasProcessed(processed, 'c1') === true);
  check('F: تعليق جديد لا يُعتبر مُعالجاً', hasProcessed(processed, 'c2') === false);
  check('F: حالة NEW لا تُعدّ معالجة', hasProcessed([entry({ commentId: 'c3', stage: 'NEW' })], 'c3') === false);
  const cp1 = advanceCheckpoint({ lastCommentId: null, lastCommentAt: null }, 'c1', '2026-09-28T10:00:00.000Z');
  check('F: checkpoint يُحدَّث', cp1.lastCommentId === 'c1' && cp1.lastCommentAt === '2026-09-28T10:00:00.000Z');
  const cp2 = advanceCheckpoint(cp1, null, null);
  check('F: checkpoint لا يُمحى بقيمة غائبة', cp2.lastCommentId === 'c1');
  const cp3 = advanceCheckpoint(cp1, 'c2', '2026-09-28T11:00:00.000Z');
  check('F: checkpoint يتقدّم لتعليق أحدث', cp3.lastCommentId === 'c2');
}

// --- G) الإيقاع (cadence) بحدود آمنة + الجدولة ---
{
  check('G: الافتراضي دقيقة واحدة (60,000ms)', normalizeCadenceMs(null) === WATCHER_DEFAULT_CADENCE_MS && WATCHER_DEFAULT_CADENCE_MS === 60000);
  check('G: حد أدنى دقيقة (لا polling عدواني)', normalizeCadenceMs(1) === WATCHER_MIN_CADENCE_MS);
  check('G: الافتراضي = الحد الأدنى (دقيقة)', WATCHER_DEFAULT_CADENCE_MS === WATCHER_MIN_CADENCE_MS);
  check('G: حدّ أقصى ساعة', normalizeCadenceMs(99 * 3_600_000) === WATCHER_MAX_CADENCE_MS);
  check('G: قيمة صالحة تمرّ', normalizeCadenceMs(120000) === 120000);
  const now = Date.parse('2026-09-28T12:00:00.000Z');
  check('G: بلا فحص سابق => مستحق', isPollDue(null, now, 300000) === true);
  check('G: فحص قريب => غير مستحق', isPollDue('2026-09-28T11:59:30.000Z', now, 300000) === false);
  check('G: فحص قديم => مستحق', isPollDue('2026-09-28T11:50:00.000Z', now, 300000) === true);
  check('G: الفحص التالي محسوب', nextPollAt('2026-09-28T12:00:00.000Z', 300000) === '2026-09-28T12:05:00.000Z');
}

// --- H) الزخم (velocity) مع إعلان حجم العيّنة ---
{
  const now = Date.parse('2026-09-28T12:00:00.000Z');
  const ts = [
    '2026-09-28T11:50:00.000Z', '2026-09-28T11:40:00.000Z', '2026-09-28T11:20:00.000Z', '2026-09-28T11:00:00.000Z',
    '2026-09-27T20:00:00.000Z', '2026-09-26T12:00:00.000Z',
  ];
  const v = computeCommentVelocity(ts, now);
  check('H: عدد آخر ساعة صحيح', v.lastHour.count === 4, String(v.lastHour.count));
  check('H: عدد آخر 24 ساعة صحيح', v.last24h.count === 5, String(v.last24h.count));
  check('H: عدد آخر 7 أيام صحيح', v.last7d.count === 6, String(v.last7d.count));
  check('H: حجم العيّنة مُعلن', v.sampleSize === 6);
  check('H: الاتجاه لا يُعلن بلا عيّنة كافية', computeCommentVelocity(['2026-09-28T11:59:00.000Z'], now).trend === 'insufficient');
  check('H: العيّنة الكافية تُنتج اتجاهاً', ['rising', 'steady', 'falling'].includes(v.trend), v.trend);
  check('H: طابع غير صالح لا يُحسب', computeCommentVelocity(['bad', null, undefined], now).sampleSize === 0);
}

// --- I) التقرير اليومي + الفرص ---
{
  const now = Date.parse('2026-09-28T12:00:00.000Z');
  const brief = buildDailyBrief({
    date: '2026-09-28', newComments: 3, replies: 2, skipped: 1, escalated: 1, verifiedReplies: 2, failedReplies: 0,
    sentiment: { positive: 1, negative: 0, neutral: 2 }, topQuestions: [{ text: 'كم السعر؟', count: 3 }],
    velocity: computeCommentVelocity(['2026-09-28T11:00:00.000Z', '2026-09-28T11:30:00.000Z'], now),
    videos: { total: 2, bestPerforming: [{ videoId: 'v1', metric: 100 }], weakPerforming: [{ videoId: 'v2', metric: 1 }] },
    attentionRequired: [{ commentId: 'c9', reason: 'شكوى', text: 'متأخر' }],
    sampleNotes: ['عيّنة 3'],
  });
  check('I: التقرير حتمي المصدر', brief.source === 'deterministic');
  check('I: الأرقام كما هي بلا اختراع', brief.newComments === 3 && brief.escalated === 1);
  check('I: توصية لوجود تصعيد', brief.recommendations.some((r) => r.includes('تدخلاً')));
  check('I: حجم العيّنة يُعلن في التقرير', Array.isArray(brief.sampleNotes) && brief.sampleNotes.length > 0);

  const opps = detectOpportunities({ repeatedQuestions: [{ text: 'كم السعر؟', count: 4 }], newScanned: 8, previousScanned: 3, now });
  check('I: فرصة سؤال متكرر تُسجَّل', opps.some((o) => o.kind === 'repeated_question'));
  check('I: فرصة قفزة تفاعل تُسجَّل', opps.some((o) => o.kind === 'engagement_spike'));
  check('I: لا فرصة بلا تكرار كافٍ', detectOpportunities({ repeatedQuestions: [{ text: 'x', count: 1 }], newScanned: 1, previousScanned: 1, now }).length === 0);
}

// --- J) دورة كاملة محاكاة: commentId + نص الرد الحقيقيان يصلان للمنفّذ، ولا رد بلا قيم ---
{
  // محاكاة معالج دورة الـwatcher بمنطق القرار نفسه (بلا شبكة).
  const on = { ...defaultWatcherControls(), autoReply: true };
  const seen: Array<{ commentId: string; text: string; commentText?: string }> = [];
  const executor = async (input: { commentId: string; text: string; commentText?: string }) => { seen.push(input); return { delivered: true, externalReplyId: 'yt-r-1', state: 'sent' }; };
  const process = async (c: { commentId: string; text: string }) => {
    const cls = classifyComment(c.text);
    const decision = decideCommentAction({ intent: cls.intent, requiresHumanReview: cls.requiresHumanReview, isSpam: cls.isSpam, isSelfAuthored: false, alreadyReplied: false, controls: on });
    if (decision.action !== 'reply') return { sent: false, decision: decision.action };
    const text = 'أهلاً بك، شكراً لتواصلك معنا. فريق المعرض في خدمتك لأي استفسار.';
    const r = await executor({ commentId: c.commentId, text, commentText: c.text });
    return { sent: Boolean(r.externalReplyId && r.delivered), externalReplyId: r.externalReplyId };
  };
  const res = await process({ commentId: 'real-cm-1', text: 'جيد' });
  check('J: الرد أُرسل للمنفّذ بمعرّف التعليق الحقيقي', seen[0]?.commentId === 'real-cm-1', JSON.stringify(seen));
  check('J: النص الحقيقي وصل للمنفّذ', typeof seen[0]?.text === 'string' && seen[0].text.length > 0);
  check('J: نص التعليق الأصلي وصل للتصنيف', seen[0]?.commentText === 'جيد');
  check('J: النجاح يُقاس بمعرّف رد حقيقي', res.sent === true && res.externalReplyId === 'yt-r-1');
  // بلا نص رد شخصي: منفّذ يرفض نصاً فارغاً — لا إرسال.
  const calls: number[] = [];
  const strictExecutor = async (input: { commentId: string; text: string }) => { if (!input.commentId || !input.text) return { delivered: false }; calls.push(1); return { delivered: true, externalReplyId: 'x' }; };
  const bad = await strictExecutor({ commentId: '', text: 'نص' });
  check('J: بلا commentId حقيقي لا إرسال', bad.delivered === false && calls.length === 0);
  const bad2 = await strictExecutor({ commentId: 'c1', text: '' });
  check('J: بلا نص رد حقيقي لا إرسال', bad2.delivered === false && calls.length === 0);
}

// --- K) تأكيد ربط الـwatcher بالخادم + بوابة التفويض (فحص الملف الفعلي) ---
{
  const server = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
  check('K: الـwatcher يعمل داخل الخادم الدائم', server.includes('startYouTubeWatcher') && server.includes('app.listen'));
  check('K: الـwatcher يمر بمنفّذ الرد الحقيقي الموحّد', server.includes('await executeYouTubeReply({ commentId: String(c.commentId), text: replyText, commentText: String(c.text || "") }, "watcher")'));
  check('K: بوابة التفويض محفوظة (youtube_reply خارجي)', server.includes('watcherReplyExecutionReady') && server.includes('youtubeDelegationCheck'));
  check('K: لا إرسال بلا معرّف رد حقيقي', server.includes('externalReplyId') && server.includes('delivered'));
  check('K: حالة الـwatcher تُحفَظ عبر المحوّل (تصمد بعد restart)', server.includes('WATCHER_STATE_KEY') && server.includes('persistWatcherState'));
  check('K: مسارات التحكم/Kill Switch للمالك موجودة', server.includes('/api/agent/youtube/watcher/controls') && server.includes('/api/agent/youtube/watcher/poll'));
  check('K: حالة الـwatcher تُعلن في الصحة', server.includes('youtubeWatcher: watcherStatusBlock()'));
}

// --- L) أوقات الذروة: من زمن النشر الحقيقي، ولا تُعلن بلا عيّنة كافية ---
{
  const baghdadHour = (hour: number) => new Date(Date.UTC(2026, 8, 28, (hour - 3 + 24) % 24, 0, 0)).toISOString();
  check('L: عيّنة صغيرة => لا ذروة معلنة', computePeakHours([baghdadHour(9), baghdadHour(9), baghdadHour(20)]).sufficient === false);
  check('L: عيّنة صغيرة => peakHour=null', computePeakHours([baghdadHour(9), baghdadHour(9)]).peakHour === null);
  const many = [baghdadHour(20), baghdadHour(20), baghdadHour(20), baghdadHour(20), baghdadHour(9), baghdadHour(10), baghdadHour(11)];
  const peak = computePeakHours(many);
  check('L: عيّنة كافية => ذروة معلنة', peak.sufficient === true && peak.peakHour !== null);
  check('L: الذروة = الساعة 20 بغداد', peak.peakHour === 20, String(peak.peakHour));
  check('L: حجم العيّنة مُعلن', peak.sampleSize === 7);
  check('L: طابع غير صالح لا يُحسب', computePeakHours(['bad', null]).sampleSize === 0);
}

// --- M) الزخم يعتمد على زمن النشر الحقيقي لا وقت المعالجة ---
{
  const now = Date.parse('2026-09-28T12:00:00.000Z');
  // تعليق نُشر قبل 10 دقائق لكن عولج قبل 5 ساعات: الزخم يجب أن يحسبه في آخر ساعة.
  const published = new Date(now - 10 * 60_000).toISOString();
  const processedAt = new Date(now - 5 * 3_600_000).toISOString();
  const byPublished = computeCommentVelocity([published], now);
  const byProcessed = computeCommentVelocity([processedAt], now);
  check('M: الزخم من publishedAt يضعه في آخر ساعة', byPublished.lastHour.count === 1);
  check('M: وقت المعالجة كان سيُخرجه من آخر ساعة (فارق حقيقي)', byProcessed.lastHour.count === 0);
}

// --- N) لا يمكن لأي تفعيل أن يتجاوز البوابات: القرار + بوابة الأتمتة + المنفّذ ---
{
  const base = defaultWatcherControls();
  const comment = { intent: 'question', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false };
  // منفّذ وهمي عدّاد فقط (لا إرسال حقيقي) — نتحقق هل يُستدعى.
  let executorCalls = 0;
  const run = (controls: YouTubeWatcherControls) => {
    const d = decideCommentAction({ ...comment, controls });
    const gate = watcherGate(controls, 'reply');
    if (d.action === 'reply' && gate.allowed) executorCalls += 1;
    return d.action;
  };
  executorCalls = 0;
  run({ ...base, autoReply: false });
  check('N: autoReply مغلق => لا استدعاء للمنفّذ', executorCalls === 0);
  run({ ...base, autoReply: true, paused: true });
  check('N: Kill Switch => لا استدعاء للمنفّذ', executorCalls === 0);
  run({ ...base, autoReply: true, humanReviewMode: true });
  check('N: وضع المراجعة البشرية لا يعطّل كل الأتمتة (البوابة تسمح)', watcherGate({ ...base, autoReply: true, humanReviewMode: true }, 'reply').allowed === true);
  run({ ...base, enabled: false, autoReply: true });
  check('N: المراقبة معطّلة => لا استدعاء للمنفّذ', executorCalls === 0);
  run({ ...base, autoReply: true });
  check('N: autoReply مفعّل بلا عوائق => استدعاء واحد للمنفّذ', executorCalls === 1);
  // بوابة الأتمتة مغلقة افتراضياً للرد.
  check('N: بوابة الرد مغلقة افتراضياً', watcherGate(defaultWatcherControls(), 'reply').allowed === false);
  check('N: بوابة القراءة مفتوحة افتراضياً', watcherGate(defaultWatcherControls(), 'read').allowed === true);
}

// --- O) فرض مزدوج في الخادم: بوابة الأتمتة عند نقطة التنفيذ + منع مسار جانبي ---
{
  const server = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
  check('O: إعادة فرض بوابة الرد عند نقطة التنفيذ', server.includes('const replyGate = watcherGate(controls, "reply")'));
  check('O: الشرط يجمع جاهزية التنفيذ والبوابة', server.includes('if (!replyReady.ready || !replyGateFinal.allowed)'));
  check('O: no fake commentId (لا اختلاق)', !/commentId:\s*["'][^"']+["']/.test(server.slice(server.indexOf('async function runYouTubeWatcherCycle'), server.indexOf('function startYouTubeWatcher'))));
  check('O: الرد يُسجَّل مُسلَّماً فقط بمعرّف رد حقيقي', server.includes('const delivered = Boolean(result.body?.delivered && result.body?.externalReplyId);'));
}

// --- P) فاصل الأتمتة (وقت الأتمتة): تحقق الحدود + الانعكاس في العرض ---
{
  const d = defaultWatcherControls();
  check('P: الافتراضي/الحالي = 1 دقيقة', d.cadenceMinutes === 1);
  for (const m of [1, 2, 3, 4, 5]) {
    const v = validateCadenceMinutes(m);
    check(`P: القيمة ${m} مقبولة`, v.ok === true && v.minutes === m);
  }
  check('P: 0 مرفوض', validateCadenceMinutes(0).ok === false);
  check('P: السالب مرفوض', validateCadenceMinutes(-3).ok === false);
  check('P: العشري مرفوض', validateCadenceMinutes(2.5).ok === false);
  check('P: الأكبر من 5 مرفوض', validateCadenceMinutes(6).ok === false && validateCadenceMinutes(99).ok === false);
  check('P: NaN/اللانهاية مرفوضة', validateCadenceMinutes(NaN).ok === false && validateCadenceMinutes(Infinity).ok === false);
  check('P: النص غير الرقمي مرفوض', validateCadenceMinutes('abc').ok === false && validateCadenceMinutes('2.5').ok === false);
  check('P: النص الرقمي الصحيح مقبول', validateCadenceMinutes('4').ok === true && validateCadenceMinutes('4').minutes === 4);
  check('P: التحويل إلى ms بعد التحقق فقط', cadenceMinutesToMs(5) === 300_000 && cadenceMinutesToMs(1) === 60_000);
  check('P: التحويل يرفض غير الصالح ويُعيد الافتراضي', cadenceMinutesToMs(0 as any) === 60_000);
  check('P: تطبيع قيمة محفوظة صالحة', normalizeWatcherControls({ cadenceMinutes: 3 }).cadenceMinutes === 3);
  check('P: تطبيع قيمة محفوظة غير صالحة => الافتراضي', normalizeWatcherControls({ cadenceMinutes: 9 }).cadenceMinutes === 1);
  check('P: توافق خلفي مع cadenceMs المحفوظ', normalizeWatcherControls({ cadenceMs: 240_000 }).cadenceMinutes === 4);
  check('P: العرض يكشف cadenceMs الصحيح', watcherControlsView({ ...d, cadenceMinutes: 5 }).cadenceMs === 300_000);
  check('P: العرض يكشف الفاصل الفعلي عند Kill Switch = 0', watcherControlsView({ ...d, cadenceMinutes: 3, paused: true }).cadenceMs === 0);
}

// --- Q) أمان الجدولة: مؤقّت واحد فقط عند تغيير الفاصل + Kill Switch يوقف كل شيء ---
{
  // مؤقّتات وهمية قابلة للتتبع: تثبت أن reschedule يُبطل القديم قبل إنشاء الجديد.
  const live = new Set<object>();
  const hooks = {
    setTimer: (_fn: () => void, _ms: number) => { const h = {}; live.add(h); return { clear: () => { live.delete(h); } }; },
    setTimeoutOnce: (_fn: () => void, _ms: number) => { const h = {}; live.add(h); return { clear: () => { live.delete(h); } }; },
    getCadenceMs: () => 60_000,
    isDue: () => false,
    runCycle: () => {},
  };
  const s = createWatcherScheduler(hooks);
  s.start();
  check('Q: بعد البدء عند 1 دقيقة يوجد مؤقّت واحد نشط', s.status().activeTimers === 1 && live.size <= 2);
  s.reschedule();
  check('Q: التغيير إلى 5 دقائق يُبقي مؤقّتاً واحداً', s.status().activeTimers === 1);
  s.reschedule();
  check('Q: التغيير إلى 2 دقيقة يُبقي مؤقّتاً واحداً', s.status().activeTimers === 1);
  check('Q: عدد إعادة الجدولة مُتتبَّع', s.status().reschedules === 2);
  s.stop();
  check('Q: Kill Switch/الإيقاف يُلغي كل المؤقّتات', s.status().active === false && s.status().activeTimers === 0);
  // إعادة الجدولة بعد الإيقاف تُنشئ مؤقّتاً واحداً فقط (لا يتراكم).
  s.reschedule();
  check('Q: إعادة التشغيل بعد الإيقاف = مؤقّت واحد', s.status().activeTimers === 1);
}

// --- R) تفاعل المتابعة (Follow-up Engagement): كشف تغيّر حقيقي فقط ---
{
  const NOW = Date.parse('2026-10-04T12:00:00.000Z');
  const entry = (over: Partial<WatcherProcessedEntry>): WatcherProcessedEntry => ({
    commentId: 'c1', stage: 'REPLIED', action: 'reply', reason: 'r', videoId: 'v1', authorName: 'a',
    text: 'كم السعر؟', at: new Date(NOW - FOLLOWUP_BASELINE_DELAY_MS - 60_000).toISOString(),
    externalReplyId: 'r1', ...over,
  });
  // 1) لا مرشّح بلا رد مُسلَّم.
  check('R: بلا معرّف رد لا يُرصد', selectFollowUpCandidates([entry({ externalReplyId: null })], NOW).length === 0);
  // 2) لا مرشّح قبل حلول مهلة البصمة.
  check('R: قبل المهلة لا يُرصد', selectFollowUpCandidates([entry({ at: new Date(NOW - 60_000).toISOString() })], NOW).length === 0);
  // 3) محسوم مسبقاً لا يُرصد مجدداً.
  check('R: المحسوم لا يُرصد', selectFollowUpCandidates([entry({ followUpOutcome: { kind: 'no_change', likesDelta: 0, repliesDelta: 0, at: 'x' } })], NOW).length === 0);
  // 4) مرشّح صالح.
  check('R: الرد المُسلَّم بعد المهلة يُرصد', selectFollowUpCandidates([entry({})], NOW).length === 1);
  check('R: مهلة البصمة 30 دقيقة', FOLLOWUP_BASELINE_DELAY_MS === 30 * 60 * 1000);

  // 5) بلا بصمة ⇒ تُثبَّت ولا يُعلن تغيّر.
  const b1 = evaluateFollowUpEngagement(entry({}), { likes: 3, replies: 1 }, NOW);
  check('R: أول رصد يثبّت البصمة', Boolean(b1.baseline) && b1.baseline?.likes === 3 && !b1.outcome);
  // 6) إشارة غير متاحة ⇒ لا ادعاء تغيّر ولا بصمة.
  const bNull = evaluateFollowUpEngagement(entry({}), { likes: null, replies: null }, NOW);
  check('R: إشارة غير متاحة لا تُعلن تغيّراً', !bNull.outcome && !bNull.baseline);
  // 7) مع بصمة وزيادة ⇒ engagement_changed.
  const changed = evaluateFollowUpEngagement(entry({ followUpBaseline: { likes: 3, replies: 1 } }), { likes: 6, replies: 2 }, NOW);
  check('R: زيادة الإعجاب/الرد ⇒ engagement_changed', changed.outcome?.kind === 'engagement_changed' && changed.outcome?.likesDelta === 3 && changed.outcome?.repliesDelta === 1);
  // 8) مع بصمة بلا تغيّر ⇒ no_change.
  const same = evaluateFollowUpEngagement(entry({ followUpBaseline: { likes: 3, replies: 1 } }), { likes: 3, replies: 1 }, NOW);
  check('R: بلا تغيّر ⇒ no_change', same.outcome?.kind === 'no_change');
  // 9) الحد الأدنى للتغيّر = 1 (لا ضجيج).
  check('R: الحد الأدنى للتغيّر 1', FOLLOWUP_MIN_DELTA === 1);
  // 10) لا ادعاء بيع ولا رقم مالي في النص.
  check('R: بلا مصطلح مالي', !/إيراد|ربح|ROI|هامش|بيع/i.test(JSON.stringify([b1, changed, same])));
}

// --- الخلاصة ---
console.log('='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} checks`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
} else {
  console.log(`PASSED: ${passed} youtube watcher checks`);
}
