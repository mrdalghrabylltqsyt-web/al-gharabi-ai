/**
 * N1 — اختبار انحدار: سلامة العملية.
 *
 * العيب القديم: `uncaughtException` كان يُسجَّل ثم **تستمر** العملية (بلا exit)،
 * فتبقى في حالة غير معروفة ويُخفى العطل عن Render. الإصلاح: تفريغ + إغلاق + exit(1).
 * و`unhandledRejection` يبقى غير قاتل في الإنتاج، قاتلاً في وضع الاختبار.
 *
 * منطق صافٍ قابل للاختبار: كل الآثار الجانبية محقونة (لا عملية حقيقية).
 */

import { createProcessSafety, UNCAUGHT_FLUSH_MS } from '../runtime/processSafety';
import { redactSecretsFromText } from '../runtime/errorSafety';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// سرّ وهمي يُبنى وقت التشغيل (لا يظهر كنص حرفي في المصدر فيلتقطه ماسح الأسرار)،
// وبشكل يعرف مُنقّي الأسرار التقاطه (`token=<value>`) لإثبات التنقية.
const FAKE_SECRET = 'token=' + 'a1b2c3d4e5'.repeat(4);

function harness(testMode: boolean) {
  const logs: string[] = [];
  const calls: string[] = [];
  let exitCode: number | null = null;
  let flushMs = -1;
  const safety = createProcessSafety({
    // نفس نمط الخادم: التسجيل يمرّ عبر مُنقّي الأسرار قبل الطباعة.
    log: (l) => logs.push(redactSecretsFromText(l)),
    flush: async (ms) => { flushMs = ms; calls.push('flush'); },
    close: async () => { calls.push('close'); },
    exit: (code) => { exitCode = code; calls.push(`exit:${code}`); },
    testMode,
  });
  return { safety, logs, calls, getExit: () => exitCode, getFlushMs: () => flushMs };
}

async function tick(ms = 20): Promise<void> { await new Promise((r) => setTimeout(r, ms)); }

async function run(): Promise<void> {
  // 1) uncaughtException => flush ثم close ثم exit(1) (وليس استمراراً).
  {
    const h = harness(false);
    h.safety.handleUncaughtException(new Error(`boom with secret ${FAKE_SECRET}`));
    await tick(60);
    check('uncaughtException: يُفرّغ الكتابات', h.calls.includes('flush'), JSON.stringify(h.calls));
    check('uncaughtException: يُغلق المخزن', h.calls.includes('close'), JSON.stringify(h.calls));
    check('uncaughtException: يخرج برمز 1 (لا استمرار)', h.getExit() === 1, `exit=${h.getExit()}`);
    check('uncaughtException: الترتيب flush قبل close قبل exit',
      h.calls.indexOf('flush') < h.calls.indexOf('close') && h.calls.indexOf('close') < h.calls.indexOf('exit:1'),
      JSON.stringify(h.calls));
    check('uncaughtException: مهلة التفريغ قصيرة ومحدودة', h.getFlushMs() === UNCAUGHT_FLUSH_MS, `ms=${h.getFlushMs()}`);
    check('uncaughtException: يُسجَّل سطر واحد بلا مكدّس', h.logs.length === 1 && h.logs[0].includes('uncaughtException'));
    check('uncaughtException: السرّ في الرسالة يُنقّى من السجل', !h.logs.join('\n').includes(FAKE_SECRET));
  }

  // 2) unhandledRejection في الإنتاج: يُسجَّل ويُعدّ ولا يُسقط العملية.
  {
    const h = harness(false);
    h.safety.handleUnhandledRejection(new Error('r1'));
    h.safety.handleUnhandledRejection('r2');
    await tick();
    check('unhandledRejection: يُعدّ', h.safety.unhandledRejectionCount === 2, `count=${h.safety.unhandledRejectionCount}`);
    check('unhandledRejection: لا يخرج في الإنتاج', h.getExit() === null, `exit=${h.getExit()}`);
    check('unhandledRejection: يُسجَّل كل حدث', h.logs.length === 2);
  }

  // 3) unhandledRejection في وضع الاختبار: قاتل (يكشف الفشل المبتلع).
  {
    const h = harness(true);
    h.safety.handleUnhandledRejection(new Error('fatal-in-test'));
    await tick();
    check('وضع الاختبار: unhandledRejection قاتل', h.getExit() === 1, `exit=${h.getExit()}`);
    check('وضع الاختبار: testMode معلن', h.safety.testMode === true);
  }

  // 4) فشل flush/close لا يمنع الخروج (لا تعليق أبداً).
  {
    const logs: string[] = [];
    let exited: number | null = null;
    const safety = createProcessSafety({
      log: (l) => logs.push(l),
      flush: async () => { throw new Error('flush failed'); },
      close: async () => { throw new Error('close failed'); },
      exit: (c) => { exited = c; },
      testMode: false,
    });
    safety.handleUncaughtException(new Error('x'));
    await tick(60);
    check('فشل flush/close لا يمنع exit(1)', exited === 1, `exit=${exited}`);
  }

  console.log(`\n[ process-safety ] passed=${passed} failed=${failures.length}`);
  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
