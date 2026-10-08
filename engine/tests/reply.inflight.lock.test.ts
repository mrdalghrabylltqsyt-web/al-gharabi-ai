/**
 * REL-01 — اختبار وحدة لقفل الرد الخارجي داخل العملية (reply in-flight lock).
 * يغلق نتيجة التدقيق HIGH #7: سباق "تحقق من عدم التكرار ← انتظار شبكي ← تسجيل
 * متأخر" في مسارات الرد الخارجي (فيسبوك/إنستغرام/يوتيوب/تيليغرام). يثبت أن
 * طلبين متزامنين لنفس الحدث الخارجي لا يمكن أن يتجاوزا الحجز معاً.
 */
import {
  replyLockKey,
  acquireReplyLock,
  releaseReplyLock,
  isReplyLocked,
  resetReplyLocksForTest,
} from '../social/replyInFlightLock';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

resetReplyLocksForTest();

// بناء المفتاح.
check('key format', replyLockKey('facebook', 'comment', 'c1') === 'facebook:comment:c1');

// حجز أول ينجح، وحجز ثانٍ متزامن لنفس المفتاح يُرفض (هذا هو إغلاق السباق).
{
  check('first acquire succeeds', acquireReplyLock('facebook:comment:c1') === true);
  check('second concurrent acquire on same key fails', acquireReplyLock('facebook:comment:c1') === false);
  check('isReplyLocked reports true while held', isReplyLocked('facebook:comment:c1') === true);
  check('different key unaffected', acquireReplyLock('facebook:comment:c2') === true);
  releaseReplyLock('facebook:comment:c1');
  releaseReplyLock('facebook:comment:c2');
}

// الإفراج يتيح إعادة الحجز لاحقاً (الطلب التالي الشرعي بعد اكتمال الأول).
{
  check('re-acquire after release succeeds', acquireReplyLock('youtube:comment:yt1') === true);
  check('isReplyLocked false after release', (() => { releaseReplyLock('youtube:comment:yt1'); return !isReplyLocked('youtube:comment:yt1'); })());
}

// مفتاح بمعرّف خارجي فارغ لا يُقفل أبداً — يترك الفحوص الأخرى (معرّف مطلوب) ترفضه.
{
  const emptyKey = replyLockKey('instagram', 'message', '');
  check('empty externalId key always allowed (1st)', acquireReplyLock(emptyKey) === true);
  check('empty externalId key always allowed (2nd, no lock taken)', acquireReplyLock(emptyKey) === true);
}

// محاكاة السباق الفعلي: طلبان "يتحققان ثم ينتظران الشبكة ثم يسجّلان" — القفل
// يضمن أن واحداً فقط يصل فعلياً لمرحلة "الإرسال" (sentCount === 1)، والآخر
// يُرفض فوراً بلا أي إرسال خارجي حقيقي.
async function run(): Promise<void> {
  resetReplyLocksForTest();
  const key = replyLockKey('youtube', 'comment', 'yt-race');
  let sentCount = 0;
  async function simulateRequest(): Promise<'sent' | 'rejected'> {
    if (!acquireReplyLock(key)) return 'rejected';
    try {
      await new Promise((r) => setTimeout(r, 5)); // نافذة الانتظار الشبكي الحقيقية التي كانت الثغرة
      sentCount += 1;
      return 'sent';
    } finally {
      releaseReplyLock(key);
    }
  }
  const [r1, r2] = await Promise.all([simulateRequest(), simulateRequest()]);
  check('exactly one concurrent request actually sent', sentCount === 1, `sentCount=${sentCount}`);
  check('one accepted and one rejected', [r1, r2].sort().join(',') === 'rejected,sent', `${r1},${r2}`);
  check('key released after both settle', !isReplyLocked(key));

  console.log(`PASSED: ${passed} reply-inflight-lock checks`);
  if (failures.length) {
    console.error('FAILURES:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

run();
