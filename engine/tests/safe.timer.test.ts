/**
 * Phase 6 — اختبار غلاف المؤقّتات الآمن وحراسة تداخل مصالحة TikTok.
 * يثبت أن أي استثناء/رفض داخل نداء مؤقّت لا يرمي ولا يُسقط العملية، وأن الرسائل
 * لا تسرّب كائناً كاملاً.
 */
import { safeTimerCallback, safeErrorText } from '../social/safeTimer';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// نداء متزامن يرمي: لا يرمي خارج الغلاف ويُسجَّل.
{
  const logs: string[] = [];
  const wrapped = safeTimerCallback(() => { throw new Error('boom'); }, 'sync-test', (m) => logs.push(m));
  let threw = false;
  try { wrapped(); } catch { threw = true; }
  check('sync throw is swallowed', !threw);
  check('sync throw is logged', logs.length === 1 && logs[0].includes('sync-test') && logs[0].includes('boom'));
}

// نداء غير متزامن يرفض: يُلتقط لاحقاً بلا unhandledRejection.
{
  const logs: string[] = [];
  const wrapped = safeTimerCallback(() => Promise.reject(new Error('async-boom')), 'async-test', (m) => logs.push(m));
  let threw = false;
  try { wrapped(); } catch { threw = true; }
  check('async reject does not throw synchronously', !threw);
}

// نداء ناجح: لا سجل ولا رمي، ويُنفَّذ فعلاً.
{
  const logs: string[] = [];
  let ran = 0;
  const wrapped = safeTimerCallback(() => { ran += 1; }, 'ok-test', (m) => logs.push(m));
  wrapped();
  check('success runs and stays silent', ran === 1 && logs.length === 0);
}

// رسائل الخطأ آمنة ومقطوعة.
{
  check('safeErrorText from Error', safeErrorText(new Error('x'.repeat(500))).length <= 200);
  check('safeErrorText from string', safeErrorText('short') === 'short');
  check('safeErrorText from object', typeof safeErrorText({ weird: true }) === 'string');
}

// حارس تداخل مصالحة TikTok: مصدره في server.ts (فحص ثابت).
import { readFileSync } from 'node:fs';
{
  const server = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
  check('reconcile overlap guard declared', server.includes('let tiktokReconcileRunning = false'));
  check('reconcile guard short-circuits', server.includes('if (tiktokReconcileRunning) return result;'));
  check('reconcile guard resets in finally', /tiktokReconcileRunning = false;\s*\}\s*\}/.test(server));
  check('runtime timers use safe wrapper', server.includes('safeTimerCallback(runSafeJobPreflight') && server.includes('safeTimerCallback(cleanupRuntimeState') && server.includes('safeTimerCallback(() => reconcileTikTokPublishes()'));
}

console.log(`PASSED: ${passed} safe-timer checks`);
if (failures.length) {
  console.error('FAILURES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
