/**
 * منفّذ المنشورات المجدولة (إصلاح 2026-10-30): منشور «مجدول» في التقويم لم يكن يُنشر
 * أبداً لأن لا شيء في الخادم يقرأ `workspace.posts` المجدولة. يثبت القرار والتسوية
 * (منطق صافٍ) ثم أن الخادم موصول فعلاً بالمنفّذ نفسه للنقرة اليدوية.
 */
import { readFileSync } from 'node:fs';
import {
  decideScheduledDispatch,
  settleScheduledDispatch,
  SCHEDULED_DISPATCH_POLICY,
} from '../social/scheduledPostDispatch';

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const NOW = Date.parse('2026-10-30T13:44:00Z');
const T = ['facebook', 'instagram', 'youtube', 'telegram'];
const env = { nowMs: NOW, autoEnabled: true, storageHealthy: true };
const due = { status: 'scheduled', scheduledEpochMs: NOW - 44 * 60_000, targetPlatforms: T };

// 1) القرار
const d1 = decideScheduledDispatch(due, env);
check('حان الموعد + المفتاح مفعّل + الحفظ سليم ⇒ يُنشر على كل المنصات', d1.act === true && d1.platforms.length === 4);

const d2 = decideScheduledDispatch({ ...due, scheduledEpochMs: NOW + 60_000 }, env);
check('قبل الموعد ⇒ انتظار', !d2.act && d2.state === 'waiting');

const d3 = decideScheduledDispatch(due, { ...env, autoEnabled: false });
check('المفتاح مطفأ ⇒ لا نشر مع سبب صريح', !d3.act && d3.state === 'auto_disabled' && d3.changed === true);

const d4 = decideScheduledDispatch(due, { ...env, storageHealthy: false });
check('الحفظ متعطّل ⇒ لا نشر (منع التكرار بعد إعادة التشغيل)', !d4.act && d4.state === 'storage_unhealthy');

const d5 = decideScheduledDispatch({ ...due, scheduledEpochMs: NOW - SCHEDULED_DISPATCH_POLICY.lateWindowMs - 1 }, env);
check('متأخر أكثر من 24 س ⇒ فات موعده (لا نشر تلقائي)', !d5.act && d5.state === 'missed');

const d6 = decideScheduledDispatch({ ...due, status: 'approved' }, env);
check('منشور غير مجدول ⇒ لا شيء', !d6.act);

const d7 = decideScheduledDispatch({ ...due, platformResults: { facebook: { state: 'published' } } }, env);
check('المنشور على منصة لا يُعاد عليها', d7.act === true && !d7.platforms.includes('facebook') && d7.platforms.length === 3);

const d8 = decideScheduledDispatch({ ...due, dispatch: { state: 'retry_wait', attempts: 1, nextAttemptAt: new Date(NOW + 60_000).toISOString(), remainingPlatforms: ['youtube'] } }, env);
check('إعادة المحاولة تحترم موعدها', !d8.act && d8.state === 'retry_wait');

const d9 = decideScheduledDispatch({ ...due, dispatch: { state: 'retry_wait', attempts: 1, nextAttemptAt: new Date(NOW - 1).toISOString(), remainingPlatforms: ['youtube'] } }, env);
check('حان موعد الإعادة ⇒ المنصات المتبقية فقط', d9.act === true && d9.platforms.join() === 'youtube');

for (const st of ['failed', 'partial', 'missed', 'published'] as const) {
  const d = decideScheduledDispatch({ ...due, dispatch: { state: st, attempts: 3 } }, env);
  check(`الحالة النهائية ${st} لا تُعاد تلقائياً`, !d.act);
}

const d10 = decideScheduledDispatch({ ...due, status: 'published', dispatch: { state: 'retry_wait', attempts: 1, nextAttemptAt: new Date(NOW - 1).toISOString(), remainingPlatforms: ['instagram'] } }, env);
check('منشور نُشر جزئياً يُكمل منصاته المتبقية', d10.act === true && d10.platforms.join() === 'instagram');

// 2) التسوية
const allOk = Object.fromEntries(T.map((p) => [p, { state: 'published' }]));
const s1 = settleScheduledDispatch({ targetPlatforms: T, results: allOk, attemptsBefore: 0, nowMs: NOW });
check('كل المنصات نُشرت ⇒ published', s1.postStatus === 'published' && s1.dispatch.state === 'published');

const partial = { ...allOk, instagram: { state: 'failed', error: 'MEDIA_REQUIRED' } };
const s2 = settleScheduledDispatch({ targetPlatforms: T, results: partial, attemptsBefore: 0, nowMs: NOW });
check('نجاح جزئي ⇒ published + إعادة للباقي', s2.postStatus === 'published' && s2.dispatch.state === 'retry_wait' && s2.dispatch.remainingPlatforms.join() === 'instagram');
check('أول إعادة بعد 5 دقائق', Date.parse(String(s2.dispatch.nextAttemptAt)) === NOW + 5 * 60_000);

const s3 = settleScheduledDispatch({ targetPlatforms: T, results: partial, attemptsBefore: 2, nowMs: NOW });
check('انتهت المحاولات مع نشر جزئي ⇒ partial نهائي', s3.dispatch.state === 'partial' && s3.dispatch.remainingPlatforms.length === 0);

const allFail = Object.fromEntries(T.map((p) => [p, { state: 'failed' }]));
const s4 = settleScheduledDispatch({ targetPlatforms: T, results: allFail, attemptsBefore: 2, nowMs: NOW });
check('فشل نهائي بلا أي نشر ⇒ يعود approved بصدق', s4.postStatus === 'approved' && s4.dispatch.state === 'failed');

const s5 = settleScheduledDispatch({ targetPlatforms: T, results: allFail, attemptsBefore: 0, nowMs: NOW });
check('فشل أول ⇒ يبقى مجدولاً مع إعادة', s5.postStatus === 'scheduled' && s5.dispatch.state === 'retry_wait');

const quota = { ...allOk, youtube: { state: 'pending_retry', retryAt: new Date(NOW + 3 * 3600_000).toISOString() } };
const s6 = settleScheduledDispatch({ targetPlatforms: T, results: quota, attemptsBefore: 0, nowMs: NOW });
check('حصة يوتيوب ⇒ انتظار موعد التجدد بلا استهلاك محاولة', s6.dispatch.state === 'retry_wait' && s6.dispatch.attempts === 0 && Date.parse(String(s6.dispatch.nextAttemptAt)) === NOW + 3 * 3600_000);

const pend = { ...allOk, telegram: { state: 'publishing' } };
const s7 = settleScheduledDispatch({ targetPlatforms: T, results: pend, attemptsBefore: 0, nowMs: NOW });
check('«publishing» لا يُعاد (منع التكرار)', s7.dispatch.state === 'published' && !s7.dispatch.remainingPlatforms.includes('telegram'));

// 3) الربط في الخادم
const server = readFileSync('server.ts', 'utf8');
check('مؤقت المنفّذ موجود', /setInterval\(safeTimerCallback\(\(\) => \{ void runScheduledPostDispatch\("tick"\)/.test(server));
check('المنفّذ يستخدم المنفّذ نفسه للنقرة اليدوية', /async function runScheduledPostDispatch[\s\S]{0,6000}publishWorkspacePostToPlatforms\(/.test(server));
check('النقرة اليدوية تمر بالمنفّذ نفسه', /app\.post\("\/api\/workspace\/content\/:id\/publish"[\s\S]{0,1500}publishWorkspacePostToPlatforms\(/.test(server));
check('المنفّذ المشترك يمر بـexecutePlatformPublish', /async function publishWorkspacePostToPlatforms[\s\S]{0,3000}executePlatformPublish\(/.test(server));
check('حجز دائم قبل النشر', /runScheduledPostDispatch[\s\S]{0,4000}persistStateDurableOrThrow\(\)[\s\S]{0,600}publishWorkspacePostToPlatforms/.test(server));
check('إعادة الجدولة تصفّر معلومات الإرسال', server.includes('post.scheduledFor=when; post.scheduleDispatch=undefined;'));
check('المجدول يقبل النشر اليدوي', /post\.status !== "approved" && post\.status !== "scheduled"/.test(server));

console.log(`\nscheduled-post-dispatch: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error('  ✗ ' + f); process.exit(1); }
