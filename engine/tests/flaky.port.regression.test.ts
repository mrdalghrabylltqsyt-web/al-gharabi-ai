/**
 * انحدار حتمي لتصادم المنافذ (فلوك test:control-plane).
 *
 * الجذر المُثبت: كانت الاختبارات تختار منفذاً من نطاق ثابت، وبعض المنافذ داخل
 * تلك النطاقات محظورة في fetch/undici (bad port) — فينجح listen ويفشل كل طلب HTTP،
 * أو يتصادف المنفذ مع اختبار آخر فيرد خادم آخر على /api/health ثم يُغلق.
 *
 * هذا الاختبار يثبت الإصلاح حتمياً:
 * 1) الحاجز لا يعيد أبداً منفذاً محظوراً في fetch (لا نطاق ثابت مخمّن).
 * 2) كل ملفات الاختبارات توقّفت عن تخمين المنافذ (لا `Math.floor(Math.random() * N)`
 *    في تعبير منفذ، ولا تعريف freePort محلي).
 * 3) الحاجز يعيد منفذاً حراً فعلياً يمكن لخادم حقيقي الاستماع عليه فوراً (لا تصادم).
 * 4) لا ملف اختبار يستورد `node:net` بلا استخدام (بقايا الكود القديم).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, relative } from 'node:path';
import { FETCH_BLOCKED_PORTS, isFetchBlockedPort, reserveFreePort } from './helpers/freePort';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const TESTS_DIR = join(process.cwd(), 'engine', 'tests');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

// ---- 1) المنافذ المحظورة معروفة ومُكتشفة صحيحاً ----
check('قائمة المنافذ المحظورة غير فارغة', FETCH_BLOCKED_PORTS.length > 0, `len=${FETCH_BLOCKED_PORTS.length}`);
check('6000 محظور', isFetchBlockedPort(6000));
check('6566 محظور (كان يظهر في النطاق القديم)', isFetchBlockedPort(6566));
check('6667 محظور', isFetchBlockedPort(6667));
check('منفذ مؤقت عادي غير محظور', !isFetchBlockedPort(38447));

// ---- 2) لا تخمين منافذ في أي اختبار ----
const randomPortRe = /\d{3,5}\s*\+\s*Math\.floor\(\s*Math\.random\(\)\s*\*\s*\d+\s*\)/;
const offenders: string[] = [];
const localFreePort: string[] = [];
for (const f of walk(TESTS_DIR)) {
  const rel = relative(TESTS_DIR, f);
  if (rel === 'helpers/freePort.ts') continue;
  const src = readFileSync(f, 'utf8');
  if (randomPortRe.test(src)) offenders.push(rel);
  if (/function\s+freePort\s*\(/.test(src)) localFreePort.push(rel);
}
check('لا اختبار يخمّن منفذاً عبر Math.random', offenders.length === 0, `offenders=${offenders.join(', ')}`);
check('لا تعريف freePort محلي مكرّر (مصدر واحد)', localFreePort.length === 0, `files=${localFreePort.join(', ')}`);

// ---- 3) الحاجز يعيد منفذاً حراً فعلياً قابلاً للاستماع فوراً ----
const reserved = await reserveFreePort();
check('الحاجز يعيد منفذاً صالحاً', Number.isInteger(reserved) && reserved > 0 && reserved < 65536, `port=${reserved}`);
check('الحاجز لا يعيد منفذاً محظوراً في fetch', !isFetchBlockedPort(reserved), `port=${reserved}`);
check('المنفذ من نطاق النظام المؤقت (>= 32768) فلا يصطدم بمنفذ اختبار ثابت', reserved >= 32768, `port=${reserved}`);

const listenOk = await new Promise<boolean>((resolve) => {
  const srv = createServer();
  srv.once('error', () => resolve(false));
  srv.listen(reserved, '127.0.0.1', () => srv.close(() => resolve(true)));
});
check('يمكن لخادم حقيقي الاستماع على المنفذ المُعاد', listenOk, `port=${reserved}`);

// ---- 4) حجز متتالٍ: كل حجز صالح ومحرَّر (لا تسريب منفذ) ----
const a = await reserveFreePort();
const b = await reserveFreePort();
check('حجزان متتاليان يعيدان منفذين صالحين وغير محظورين',
  a > 0 && b > 0 && !isFetchBlockedPort(a) && !isFetchBlockedPort(b), `a=${a} b=${b}`);

// ---- 5) لا بقايا استيراد net بلا استخدام ----
const netLeftovers: string[] = [];
for (const f of walk(TESTS_DIR)) {
  const rel = relative(TESTS_DIR, f);
  const src = readFileSync(f, 'utf8');
  if (/import\s+net\s+from\s+['"]node:net['"];/.test(src) && !/\bnet\./.test(src)) netLeftovers.push(rel);
}
check('لا استيراد node:net بلا استخدام', netLeftovers.length === 0, `files=${netLeftovers.join(', ')}`);

console.log('\n============================================================');
if (failures.length) {
  console.log(`FAILED: ${failures.length} — ${passed} passed`);
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} flaky-port regression checks`);
