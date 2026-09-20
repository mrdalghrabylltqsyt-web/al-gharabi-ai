/**
 * اختبار سياسة الجلسة على الواجهة (منطق خالص، بلا متصفح وبلا شبكة).
 *
 * يثبت القاعدة الحرجة: لا يُسجَّل خروج ولا تُعرض شاشة الدخول بسبب عطل شبكة أو
 * 5xx — فقط الرفض الصريح 401/403 أو غياب التوكن. هذا هو جوهر شكوى
 * «يطلب OTP من جديد بعد cold start / إعادة تشغيل» في جانب المتصفح.
 */

import { classifySessionCheck, classifyPreviewExchange } from '../../src/services/sessionPolicy';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// ---- authenticated ----
check('200 + مستخدم صالح => مصادق', classifySessionCheck({ hasToken: true, status: 200, hasValidUser: true }) === 'authenticated');
check('200 بلا مستخدم => ليس مصادقاً', classifySessionCheck({ hasToken: true, status: 200, hasValidUser: false }) !== 'authenticated');

// ---- rejected: الرفض الصريح فقط ----
check('401 => مرفوض', classifySessionCheck({ hasToken: true, status: 401, hasValidUser: false }) === 'rejected');
check('403 => مرفوض', classifySessionCheck({ hasToken: true, status: 403, hasValidUser: false }) === 'rejected');
check('بلا توكن => مرفوض', classifySessionCheck({ hasToken: false, status: null, hasValidUser: false }) === 'rejected');

// ---- unavailable: أي عطل عابر لا يُخرج المستخدم ----
for (const status of [500, 502, 503, 504, 429, 408, 400, 0]) {
  check(`الحالة ${status} => غير متاح (لا خروج)`, classifySessionCheck({ hasToken: true, status, hasValidUser: false }) === 'unavailable', `status=${status}`);
}
check('فشل شبكة (status=null) => غير متاح (لا خروج)', classifySessionCheck({ hasToken: true, status: null, hasValidUser: false }) === 'unavailable');

// ---- preview exchange classification ----
check('تبادل ناجح => ok', classifyPreviewExchange({ status: 200, hasSessionToken: true }) === 'ok');
check('401 => توكن غير صالح', classifyPreviewExchange({ status: 401, hasSessionToken: false }) === 'invalid');
check('403 => توكن غير صالح', classifyPreviewExchange({ status: 403, hasSessionToken: false }) === 'invalid');
check('404 (الميزة معطّلة) => توكن غير صالح', classifyPreviewExchange({ status: 404, hasSessionToken: false }) === 'invalid');
check('503 => غير متاح لا غير صالح', classifyPreviewExchange({ status: 503, hasSessionToken: false }) === 'unavailable');
check('فشل شبكة => غير متاح لا غير صالح', classifyPreviewExchange({ status: null, hasSessionToken: false }) === 'unavailable');

// ---- الحماية: لا مسار عطل عابر يؤدي إلى "مرفوض" ----
const transient = [null, 500, 502, 503, 504, 429, 408];
check(
  'لا حالة عابرة واحدة تُصنَّف مرفوض',
  transient.every((s) => classifySessionCheck({ hasToken: true, status: s, hasValidUser: false }) !== 'rejected'),
);

console.log('');
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} session policy checks`);
}