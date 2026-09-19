/**
 * اختبارات وحدات لطبقة المصادقة: الجلسات الموقّعة ورموز التحقق بلا حالة.
 *
 * اختبارات حتمية سريعة بلا شبكة: تتحقق من التوقيع، العبث، الانتهاء، الإبطال،
 * ونوافذ رمز التحقق. لا تُستخدم أي أسرار حقيقية.
 */

import crypto from 'node:crypto';
import { SESSION_TTL_MS, signSession, verifySession } from '../auth/sessions';
import { CHALLENGE_TTL_MS, issueChallengeCode, verifyChallengeCode } from '../auth/challenge';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const secretA = crypto.createHash('sha256').update('gharabi-session:unit-a').digest();
const secretB = crypto.createHash('sha256').update('gharabi-session:unit-b').digest();

function run(): void {
  // ---- الجلسات الموقّعة ----
  const payload = { uid: 'owner', iat: Date.now(), exp: Date.now() + SESSION_TTL_MS, sid: 'sid-1' };
  const token = signSession(payload, secretA);

  check('التوكن له جزءان مفصولان بنقطة', token.split('.').length === 2);
  check('التوكن لا يحتوي الحمولة كنص صريح', !token.includes('owner'));

  const verified = verifySession(token, secretA);
  check('توكن صحيح يُتحقق بمفتاحه', verified?.uid === 'owner' && verified?.sid === 'sid-1');
  check('verifySession يُعيد تاريخ الإصدار', verified?.iat === payload.iat);

  check('توكن بمفتاح مختلف يُرفض', verifySession(token, secretB) === null);
  check('التوقيع محسوم بزمن ثابت: تغيير حرف يُرفض', verifySession(`${token}x`, secretA) === null);
  check('توكن بلا نقطة يُرفض', verifySession('not-a-token', secretA) === null);
  check('توكن فارغ يُرفض', verifySession('', secretA) === null);
  check('توكن بأجزاء زائدة يُرفض', verifySession(`${token}.extra`, secretA) === null);

  // عبث بالحمولة مع إبقاء التوقيع الأصلي — يجب أن يُرفض.
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 'owner', iat: Date.now(), exp: Date.now() + SESSION_TTL_MS, sid: 'sid-forged' }), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  check('حمولة مُعدَّلة بتوقيع قديم تُرفض', verifySession(`${forged}.${sig}`, secretA) === null);
  check('الحمولة الأصلية لم تُعدَّل (اختبار مرجعي)', verifySession(`${body}.${sig}`, secretA)?.sid === 'sid-1');

  check('توكن منتهي الصلاحية يُرفض', verifySession(signSession({ ...payload, exp: Date.now() - 1000, sid: 'sid-x' }, secretA), secretA) === null);

  // ---- رموز التحقق بلا حالة ----
  const email = 'owner@example.com';
  const now = Date.now();
  const code = issueChallengeCode(email, secretA, now);

  check('الرمز 6 أرقام', /^\d{6}$/.test(code));
  check('الرمز نفسه لنفس النافذة (حتمي)', issueChallengeCode(email, secretA, now + 1000) === code);
  check('الرمز يُقبل في نفس النافذة', verifyChallengeCode(email, code, secretA, now));
  check('الرمز يُقبل بعد 9 دقائق', verifyChallengeCode(email, code, secretA, now + CHALLENGE_TTL_MS - 60_000));

  check('الرمز لا يصلح لبريد آخر', !verifyChallengeCode('other@example.com', code, secretA, now));
  check('الرمز لا يصلح بمفتاح آخر', !verifyChallengeCode(email, code, secretB, now));
  check('رمز غير صحيح يُرفض', !verifyChallengeCode(email, code === '000000' ? '111111' : '000000', secretA, now));
  check('رمز بصيغة خاطئة يُرفض', !verifyChallengeCode(email, '12345', secretA, now));
  check('رمز فارغ يُرفض', !verifyChallengeCode(email, '', secretA, now));
  check('رمز بحروف يُرفض', !verifyChallengeCode(email, 'abcdef', secretA, now));

  // النافذة الزمنية: بعد أكثر من نافذتين يجب ألا يُقبل الرمز القديم.
  check('الرمز ينتهي بعد نافذتين', !verifyChallengeCode(email, code, secretA, now + CHALLENGE_TTL_MS * 2 + 1000));
  check('الرمز التالي مختلف عن السابق', issueChallengeCode(email, secretA, now + CHALLENGE_TTL_MS) !== code);
  check('النافذة السابقة تُقبل (تفادي فقدان الرمز على الحدود)', (() => {
    const boundary = CHALLENGE_TTL_MS * 100 + 1000;
    const earlier = issueChallengeCode(email, secretA, boundary - 2000);
    return verifyChallengeCode(email, earlier, secretA, boundary + 1000);
  })());

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} auth unit checks`);
  }
}

run();