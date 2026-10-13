/**
 * اختبار وحدة فصل مفتاح منع التكرار عن معرّف الهدف — إصلاح عطل تسليم المتابعة.
 *
 * الجذر: كان القفل وبوابة منع التكرار تُفتَّان على `externalId` وحده، فتُصنَّف
 * متابعة مشروعة على نفس التعليق «رداً مكرراً» وتُحجب خطأً. الإصلاح يفصل
 * `idempotencyKey` (مفتاح العملية) عن `externalId` (معرّف الهدف):
 *  - غياب المفتاح ⇒ السلوك السابق حرفياً (منع التكرار على externalId).
 *  - مفتاح مميّز ⇒ المتابعة تمرّ، لكن إعادة نفس المفتاح تبقى محجوبة (لا ثغرة تكرار).
 */

import { evaluateReplyGuard, type ReplyRecord } from '../social/comments';
import { replyLockKey, acquireReplyLock, releaseReplyLock } from '../social/replyInFlightLock';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const original: ReplyRecord = { externalId: 'C_FU', replyFingerprint: 'رد أصلي', repliedAt: '2026-10-12T00:00:00.000Z' };
const followUp: ReplyRecord = { externalId: 'C_FU', replyFingerprint: 'متابعة ودّية', repliedAt: '2026-10-13T00:00:00.000Z', idempotencyKey: 'fu1' };

group('1) بوابة منع التكرار — السلوك السابق محفوظ عند غياب المفتاح');
check('رد ثانٍ على نفس التعليق بلا مفتاح => محجوب',
  evaluateReplyGuard({ externalId: 'C_FU', replyText: 'أي نص', history: [original] }).allowed === false);
check('رد على تعليق آخر => مسموح',
  evaluateReplyGuard({ externalId: 'C_OTHER', replyText: 'أي نص', history: [original] }).allowed === true);
check('نص فارغ => محجوب',
  evaluateReplyGuard({ externalId: 'C_NEW', replyText: '   ', history: [] }).allowed === false);
check('معرّف فارغ => محجوب',
  evaluateReplyGuard({ externalId: '', replyText: 'نص', history: [] }).allowed === false);

group('2) متابعة مشروعة على نفس التعليق (مفتاح مميّز) => تمرّ');
const fuDecision = evaluateReplyGuard({ externalId: 'C_FU', replyText: 'متابعة ودّية', history: [original], idempotencyKey: 'fu1' });
check('متابعة بمفتاح fu1 على تعليق له رد أصلي => مسموحة (لا حجب كاذب)', fuDecision.allowed === true, JSON.stringify(fuDecision));

group('3) لا ثغرة تكرار: إعادة نفس المفتاح => محجوبة');
const repeat = evaluateReplyGuard({ externalId: 'C_FU', replyText: 'متابعة ودّية', history: [original, followUp], idempotencyKey: 'fu1' });
check('إعادة نفس مفتاح fu1 => محجوبة (تم الرد مسبقاً)', repeat.allowed === false, JSON.stringify(repeat));

group('4) مفتاح متابعة جديد (fu2) => يمرّ بعد fu1');
const fu2 = evaluateReplyGuard({ externalId: 'C_FU', replyText: 'متابعة ثانية', history: [original, followUp], idempotencyKey: 'fu2' });
check('مفتاح fu2 جديد => مسموح', fu2.allowed === true, JSON.stringify(fu2));

group('5) توافق خلفي: سجل قديم بلا مفتاح يُعامل بمفتاحه الافتراضي (externalId)');
check('سجل قديم (externalId فقط) يحجب رداً عادياً بنفس externalId',
  evaluateReplyGuard({ externalId: 'C_FU', replyText: 'أي نص', history: [original] }).allowed === false);

group('6) القفل الذرّي — فصل مفتاح التكرار');
const lockPlain = replyLockKey('facebook', 'comment', 'C_FU');
const lockFu1 = replyLockKey('facebook', 'comment', 'C_FU', 'fu1');
const lockFu1Dup = replyLockKey('facebook', 'comment', 'C_FU', 'fu1');
check('المفتاح العادي بلا لاحقة', lockPlain === 'facebook:comment:C_FU', lockPlain);
check('مفتاح المتابعة يحمل لاحقة fu1', lockFu1 === 'facebook:comment:C_FU#fu1', lockFu1);
check('نفس مفتاح التكرار ⇒ نفس القفل (إعادة الحجز تُرفض)', lockFu1 === lockFu1Dup);
check('قفل المتابعة مختلف عن القفل العادي (لا تصادم)', lockFu1 !== lockPlain);
check('مفتاح بلا معرّف خارجي لا يُقفل (يُتخطّى)', acquireReplyLock('facebook:comment:') === true);
check('قفل عادي يُحجز ثم يُفرج', acquireReplyLock(lockPlain) === true && acquireReplyLock(lockPlain) === false);
releaseReplyLock(lockPlain);
check('بعد الإفراج يُحجز مجدداً', acquireReplyLock(lockPlain) === true);
releaseReplyLock(lockPlain);
check('قفل متابعة يُحجز مستقلاً عن العادي', acquireReplyLock(lockFu1) === true && acquireReplyLock(lockPlain) === true);
releaseReplyLock(lockFu1); releaseReplyLock(lockPlain);

console.log('\n============================================================');
if (failures.length === 0) {
  console.log(`PASSED: ${passed} idempotency key separation checks`);
  process.exit(0);
} else {
  console.error(`FAILED: ${failures.length} of ${passed + failures.length} checks:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
