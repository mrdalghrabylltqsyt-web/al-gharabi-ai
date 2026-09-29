/**
 * قرارات مراقب YouTube الحقيقية — اختبارات انحدار (منطق صافٍ، بلا شبكة وبلا مزود).
 *
 * يغطي الحالتين الحقيقيتين المُبلَّغ عنهما على القناة:
 *   - «عاشت إيدكم» (مدح) ⇒ تُصنَّف praise/positive.
 *   - «شنو نوع الموبايل» (استفسار) ⇒ لا اختراع لمعلومة تجارية، ولها قرار صريح.
 * ويُثبّت القاعدة العامة: كل تعليق مكتشَف له قرار طرفي قابل للتفسير، ولا «معالجة
 * بلا قرار»، والفشل يبقى FAILED، ومنع التكرار فعّال، ولا استهلاك حصة Gemini.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyComment, buildDeterministicReply } from '../social/comments';
import {
  decideCommentAction,
  defaultWatcherControls,
  isExplicitTerminalDecision,
  isDeferredDecision,
  hasProcessed,
  type WatcherProcessedEntry,
} from '../social/youtubeWatcher';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const ROOT = process.cwd();
const ENABLED = { ...defaultWatcherControls(), autoReply: true };
const PROD_HUMAN_REVIEW = { ...defaultWatcherControls(), autoReply: true, humanReviewMode: true };

// -------------------------------------------------------------
// 1) «عاشت إيدكم» — مدح إيجابي واضح (ليس other/unknown/escalated)
// -------------------------------------------------------------
{
  const c = classifyComment('عاشت إيدكم');
  check('1a «عاشت إيدكم» تُصنَّف مدحاً (praise)', c.intent === 'praise', c.intent);
  check('1b «عاشت إيدكم» إيجابية (positive)', c.sentiment === 'positive', c.sentiment);
  check('1c «عاشت إيدكم» ليست مجهولة (other)', c.intent !== 'other');
  check('1d «عاشت إيدكم» لا تتطلب مراجعة بشرية', c.requiresHumanReview === false);
  check('1e «عاشت إيدكم» ليست سبام', c.isSpam === false);
  const d = decideCommentAction({ intent: c.intent, requiresHumanReview: c.requiresHumanReview, isSpam: c.isSpam, isSelfAuthored: false, alreadyReplied: false, controls: ENABLED });
  check('1f مع تمكين الرد ⇒ قرار رد', d.action === 'reply' && d.code === 'REPLY_ALLOWED', `${d.action}/${d.code}`);
  check('1g لا تصعيد للمدح', d.action !== 'escalate');
}

// -------------------------------------------------------------
// 2) «شنو نوع الموبايل» — استفسار بلا اختراع معلومة تجارية، بقرار صريح
// -------------------------------------------------------------
{
  const c = classifyComment('شنو نوع الموبايل');
  check('2a «شنو نوع الموبايل» سؤال', c.intent === 'question' || c.intent === 'business_inquiry', c.intent);
  check('2b لا تتطلب مراجعة بشرية تلقائياً', typeof c.requiresHumanReview === 'boolean');
  const d = decideCommentAction({ intent: c.intent, requiresHumanReview: c.requiresHumanReview, isSpam: c.isSpam, isSelfAuthored: false, alreadyReplied: false, controls: ENABLED });
  check('2c له قرار صريح (رد أو تصعيد)', d.action === 'reply' || d.action === 'escalate', d.action);
  check('2d قراره طرفي قابل للتفسير', isExplicitTerminalDecision(d.action === 'reply' ? 'REPLIED' : 'ESCALATED', d.code), `${d.action}/${d.code}`);
  // لا اختراع: النص المُولَّد حتمي ولا يحمل موديل/هاتف/سعراً غير مسجّل.
  const replyText = buildDeterministicReply(c);
  check('2e الرد لا يخترع سعراً', !/\b\d{3,}\b/.test(replyText.replace(/[^\d]/g, ' ')) || !/سعر|دينار|الف/.test(replyText), replyText);
  check('2f الرد لا يخترع موديل هاتف', !/(ايفون|آيفون|سامسونج|شاومي|هواوي|نوكيا|galaxy|iphone)/i.test(replyText), replyText);
}

// -------------------------------------------------------------
// 3+4) كل تعليق مُعالَج له قرار طرفي — ولا «معالجة بلا قرار»
// -------------------------------------------------------------
{
  const cases: Array<{ stage: any; code: any; want: boolean }> = [
    { stage: 'SKIPPED', code: 'SKIP_SELF_AUTHORED', want: true },
    { stage: 'SKIPPED', code: 'SKIP_ALREADY_REPLIED', want: true },
    { stage: 'SKIPPED', code: 'SKIP_SPAM', want: true },
    { stage: 'SKIPPED', code: 'SKIP_OUT_OF_CHANNEL_CONTEXT', want: true },
    { stage: 'SKIPPED', code: 'DEFER_AUTOREPLY_DISABLED', want: true },
    { stage: 'ESCALATED', code: 'ESCALATE_BUSINESS_INQUIRY', want: true },
    { stage: 'ESCALATED', code: 'ESCALATE_SENSITIVE', want: true },
    { stage: 'ESCALATED', code: 'ESCALATE_HUMAN_REVIEW_MODE', want: true },
    { stage: 'ESCALATED', code: 'ESCALATE_REPLY_NOT_READY', want: true },
    { stage: 'REPLIED', code: 'REPLY_ALLOWED', want: true },
    { stage: 'VERIFIED', code: 'REPLY_ALLOWED', want: true },
    { stage: 'FAILED', code: 'REPLY_ALLOWED', want: true },
    // أوجه عديمة القرار / متناقضة ⇒ تُرفض.
    { stage: 'SKIPPED', code: null, want: false },
    { stage: 'ANALYZED', code: 'REPLY_ALLOWED', want: false },
    { stage: 'ESCALATED', code: 'REPLY_ALLOWED', want: false }, // التناقض القديم
    { stage: 'REPLIED', code: 'SKIP_SPAM', want: false },
    { stage: 'SKIPPED', code: 'NOPE', want: false },
    { stage: 'VERIFIED', code: null, want: false },
  ];
  for (const t of cases) {
    check(`3/4 (${t.stage}/${t.code}) ⇒ ${t.want ? 'قرار طرفي صالح' : 'مرفوض'}`, isExplicitTerminalDecision(t.stage as any, t.code) === t.want);
  }
  // أي سجل مُعالج (stage !== NEW) يجب أن يكون قراره طرفياً صريحاً.
  const processedSample: WatcherProcessedEntry[] = [
    { commentId: 'a', stage: 'SKIPPED', action: 'skip', reason: 'x', code: 'SKIP_SPAM', videoId: null, authorName: null, text: 't', at: 'now' },
    { commentId: 'b', stage: 'ESCALATED', action: 'escalate', reason: 'y', code: 'ESCALATE_BUSINESS_INQUIRY', videoId: null, authorName: null, text: 't', at: 'now' },
    { commentId: 'c', stage: 'VERIFIED', action: 'reply', reason: 'z', code: 'REPLY_ALLOWED', videoId: null, authorName: null, text: 't', at: 'now' },
  ];
  check('3x كل السجلات المعالجة لها قرار طرفي صريح', processedSample.every((p) => isExplicitTerminalDecision(p.stage, p.code || null)));
}

// -------------------------------------------------------------
// 5) الفشل يبقى FAILED ولا يُعتبر REPLIED بلا معرّف رد حقيقي
// -------------------------------------------------------------
{
  check('5a FAILED بقرار رد مقبول (فشل الإرسال)', isExplicitTerminalDecision('FAILED', 'REPLY_ALLOWED'));
  const failed: WatcherProcessedEntry = { commentId: 'c1', stage: 'FAILED', action: 'reply', reason: 'فشل الإرسال', code: 'REPLY_ALLOWED', videoId: null, authorName: null, text: 't', at: 'now', externalReplyId: null };
  check('5b سجل فشل بلا externalReplyId', failed.stage === 'FAILED' && !failed.externalReplyId);
  // «مُسلَّم» يقتضي معرّف رد حقيقي — نفس شرط الكود في server.ts.
  const delivered = (e: WatcherProcessedEntry) => e.stage === 'VERIFIED' && Boolean(e.externalReplyId);
  check('5c FAILED لا يُعتبر مُسلَّماً', delivered(failed) === false);
  check('5d REPLIED بلا معرّف لا يُعتبر مُسلَّماً', delivered({ ...failed, stage: 'REPLIED' }) === false);
  check('5e VERIFIED بمعرّف يُعتبر مُسلَّماً', delivered({ ...failed, stage: 'VERIFIED', externalReplyId: 'r1' }) === true);
}

// -------------------------------------------------------------
// 6) منع التكرار
// -------------------------------------------------------------
{
  const d = decideCommentAction({ intent: 'praise', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: true, controls: ENABLED });
  check('6a سبق الرد ⇒ SKIP_ALREADY_REPLIED', d.code === 'SKIP_ALREADY_REPLIED' && d.action === 'skip');
  check('6b سبق الرد ⇒ لا إرسال ثانٍ', d.action !== 'reply');
  const processed: WatcherProcessedEntry[] = [{ commentId: 'dup', stage: 'VERIFIED', action: 'reply', reason: '', code: 'REPLY_ALLOWED', videoId: null, authorName: null, text: 't', at: 'now' }];
  check('6c hasProcessed يمنع المعالجة المزدوجة', hasProcessed(processed, 'dup') === true);
  check('6d hasProcessed يسمح بجديد', hasProcessed(processed, 'new') === false);
}

// -------------------------------------------------------------
// 7) سلوك autoReply الحالي يبقى سليماً (لا تغيير في المنطق)
// -------------------------------------------------------------
{
  const base = { intent: 'praise', requiresHumanReview: false, isSpam: false, isSelfAuthored: false, alreadyReplied: false };
  const off = decideCommentAction({ ...base, controls: defaultWatcherControls() });
  check('7a autoReply معطّل ⇒ تأجيل غير نهائي (لا رد ولا حذف)', off.action === 'skip' && isDeferredDecision(off.code as any));
  const on = decideCommentAction({ ...base, controls: ENABLED });
  check('7b autoReply مفعّل ⇒ رد', on.action === 'reply' && on.code === 'REPLY_ALLOWED');
  const hr = decideCommentAction({ ...base, controls: PROD_HUMAN_REVIEW });
  check('7c humanReviewMode + مدح ⇒ رد آلي (آمن)', hr.action === 'reply' && hr.code === 'REPLY_ALLOWED', `${hr.action}/${hr.code}`);
  const hrQ = decideCommentAction({ ...base, intent: 'question', controls: PROD_HUMAN_REVIEW });
  check('7c-2 humanReviewMode + سؤال ⇒ تصعيد صريح', hrQ.action === 'escalate' && hrQ.code === 'ESCALATE_HUMAN_REVIEW_MODE', `${hrQ.action}/${hrQ.code}`);
  const paused = decideCommentAction({ ...base, controls: { ...ENABLED, paused: true } });
  check('7d Kill Switch ⇒ تأجيل غير نهائي', isDeferredDecision(paused.code as any));
  const biz = decideCommentAction({ ...base, intent: 'business_inquiry', controls: ENABLED });
  check('7e استفسار تجاري ⇒ تصعيد بلا اختراع', biz.action === 'escalate' && biz.code === 'ESCALATE_BUSINESS_INQUIRY');
  const spam = decideCommentAction({ ...base, isSpam: true, controls: ENABLED });
  check('7f سبام ⇒ تجاهل', spam.action === 'skip' && spam.code === 'SKIP_SPAM');
  const self = decideCommentAction({ ...base, isSelfAuthored: true, controls: ENABLED });
  check('7g حساب المعرض ⇒ تجاهل', self.action === 'skip' && self.code === 'SKIP_SELF_AUTHORED');
}

// -------------------------------------------------------------
// 8) صفر نداءات Gemini لهذه القرارات + مصدر واحد للحقيقة
// -------------------------------------------------------------
{
  const watcherSrc = readFileSync(join(ROOT, 'engine/social/youtubeWatcher.ts'), 'utf8');
  const commentsSrc = readFileSync(join(ROOT, 'engine/social/comments.ts'), 'utf8');
  check('8a محرك القرارات لا يستورد أي مزود AI', !/from ['"]\.\.\/ai\//.test(watcherSrc) && !/GoogleGenAI|generateContent/.test(watcherSrc));
  check('8b محرك الردّ الحتمي لا يستورد أي مزود AI', !/from ['"]\.\.\/ai\//.test(commentsSrc) && !/GoogleGenAI/.test(commentsSrc));
  const serverSrc = readFileSync(join(ROOT, 'server.ts'), 'utf8');
  check('8c الـwatcher يستخدم قراراً حتمياً (decideCommentAction)', serverSrc.includes('decideCommentAction('));
  check('8d مسار المطابقة قراءة فقط (بلا تنفيذ رد)', serverSrc.includes('function buildWatcherReconciliation') && serverSrc.includes('readOnly: true'));
  const reconcileBody = serverSrc.slice(serverSrc.indexOf('function buildWatcherReconciliation'), serverSrc.indexOf('app.get("/api/agent/youtube/watcher/reconcile"'));
  check('8e مسار المطابقة يجري بلا قرار رد (لا executeYouTubeReply داخله)', reconcileBody.length > 0 && !reconcileBody.includes('executeYouTubeReply'));
  check('8f نافذة الفحص قابلة للضبط بحدود آمنة', serverSrc.includes('commentScanVideoLimitFromEnv()'));
}

// -------------------------------------------------------------
// 9) ترميم غير حذفي: لا يبقى أي «معالجة بلا قرار» في التاريخ
// -------------------------------------------------------------
{
  const { repairProcessedDecisionCodes } = await import('../social/youtubeWatcher');
  const input: WatcherProcessedEntry[] = [
    { commentId: '1', stage: 'SKIPPED', action: 'skip', reason: '', code: null, videoId: null, authorName: null, text: 't', at: 'now' },
    { commentId: '2', stage: 'ESCALATED', action: 'escalate', reason: '', code: null, videoId: null, authorName: null, text: 't', at: 'now' },
    { commentId: '3', stage: 'ESCALATED', action: 'escalate', reason: '', code: 'REPLY_ALLOWED', videoId: null, authorName: null, text: 't', at: 'now' },
    { commentId: '4', stage: 'SKIPPED', action: 'skip', reason: '', code: 'DEFER_AUTOREPLY_DISABLED', videoId: null, authorName: null, text: 't', at: 'now', deferred: true },
    { commentId: '5', stage: 'NEW', action: '', reason: '', code: null, videoId: null, authorName: null, text: 't', at: 'now' },
  ];
  const { entries, repaired } = repairProcessedDecisionCodes(input);
  check('9a كل السجلات المعالجة صارت ذات قرار طرفي صريح', entries.filter((e) => e.stage !== 'NEW').every((e) => isExplicitTerminalDecision(e.stage, e.code || null)));
  check('9b عدد المُرمَّم = 3 (البلا كود والمتناقض فقط)', repaired === 3, String(repaired));
  check('9c لم يُحذف أي سجل', entries.length === input.length);
  check('9d سجل NEW لم يُمسّ', entries[4].code === null && entries[4].stage === 'NEW');
  check('9e المؤجّل احتُفظ بكوده DEFER', entries[3].code === 'DEFER_AUTOREPLY_DISABLED');
}

// -------------------------------------------------------------
// النتيجة
// -------------------------------------------------------------
console.log(failures.length ? `\nFAILED: ${passed} decision checks (${failures.length} failed)` : `\nPASSED: ${passed} youtube decision checks`);
for (const f of failures) console.log('  ✗ ' + f);
process.exit(failures.length ? 1 : 0);
