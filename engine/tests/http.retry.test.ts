/**
 * F-14 — اختبار إعادة محاولة نداءات المنصّات (وحدة، بلا شبكة/مزود/حصة).
 *
 * يثبت السياسة الملزمة:
 *  - GET + 503 عابر => إعادة ثم نجاح (المحاولة الثانية).
 *  - POST (رد/نشر) => لا إعادة تلقائية أبداً (نداء واحد فقط).
 *  - GET + كود Meta 190 => لا إعادة (خطأ دائم يتطلب إعادة ربط).
 *  - 400/401/403 => لا إعادة (دائمة).
 *  - 429 => احترام Retry-After (تُمرَّر مدّته للـsleep بلا تراجع أسّي).
 *  - خطأ شبكي على GET => إعادة، وعلى POST => لا إعادة.
 *  - سقف المحاولات 3.
 */

import {
  classifyHttpRetry,
  parseRetryAfter,
  computeHttpBackoffDelay,
  createRetryingFetch,
  resolveHttpRetryPolicy,
  DEFAULT_HTTP_RETRY_POLICY,
  META_TOKEN_EXPIRED_CODE,
  MAX_RETRY_AFTER_MS,
} from '../social/httpRetry';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

/** استجابة وهمية بشكل عميل المنصّة (`{ ok, status, json }`). */
function fakeRes(status: number, data: any, headers: Record<string, string> = {}): any {
  const text = data == null ? '' : JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => text,
    json: async () => (text ? JSON.parse(text) : null),
  };
}

async function main(): Promise<void> {
  group('1) تصنيف قرار الإعادة (منطق صافٍ)');
  check('GET 503 => إعادة', classifyHttpRetry({ method: 'GET', status: 503 }).retry === true);
  check('GET 502 => إعادة', classifyHttpRetry({ method: 'GET', status: 502 }).retry === true);
  check('GET 500 => إعادة', classifyHttpRetry({ method: 'GET', status: 500 }).retry === true);
  check('GET 200 => لا إعادة', classifyHttpRetry({ method: 'GET', status: 200 }).retry === false);
  check('GET 404 => لا إعادة (دائم)', classifyHttpRetry({ method: 'GET', status: 404 }).retry === false);
  check('GET 400 => لا إعادة', classifyHttpRetry({ method: 'GET', status: 400 }).retry === false);
  check('GET 401 => لا إعادة', classifyHttpRetry({ method: 'GET', status: 401 }).retry === false);
  check('GET 403 => لا إعادة', classifyHttpRetry({ method: 'GET', status: 403 }).retry === false);
  check('GET كود 190 => لا إعادة (token_expired)', classifyHttpRetry({ method: 'GET', status: 400, providerCode: META_TOKEN_EXPIRED_CODE }).retry === false);
  check('سبب كود 190 = token_expired', classifyHttpRetry({ method: 'GET', status: 400, providerCode: 190 }).reason === 'token_expired');
  check('POST 503 => لا إعادة (method_not_retryable)', classifyHttpRetry({ method: 'POST', status: 503 }).retry === false);
  check('POST 500 => لا إعادة', classifyHttpRetry({ method: 'POST', status: 500 }).retry === false);
  check('POST خطأ شبكي => لا إعادة', classifyHttpRetry({ method: 'POST', status: null, networkError: true }).retry === false);
  check('GET خطأ شبكي => إعادة', classifyHttpRetry({ method: 'GET', status: null, networkError: true }).retry === true);
  check('GET 429 => إعادة + rate_limited', (() => { const d = classifyHttpRetry({ method: 'GET', status: 429 }); return d.retry && d.reason === 'rate_limited'; })());

  group('2) Retry-After (ثوانٍ + تاريخ HTTP + سقف)');
  check('عدد ثوانٍ => مللي ثانية', parseRetryAfter('2') === 2000);
  check('0 ثانية => 0', parseRetryAfter('0') === 0);
  check('تاريخ HTTP => فرق موجب', (parseRetryAfter(new Date(Date.now() + 3000).toUTCString(), Date.now()) ?? 0) > 1000);
  check('قيمة غائبة => null', parseRetryAfter(null) === null);
  check('قيمة غير صالحة => null', parseRetryAfter('not-a-date') === null);
  check('مقيّدة بسقف أقصى', parseRetryAfter('99999') === MAX_RETRY_AFTER_MS);

  group('3) التراجع الأسّي (نمو + سقف)');
  const p = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 400, factor: 2 };
  check('المحاولة 1 = الأساس', computeHttpBackoffDelay(1, p, () => 0.5) === 100);
  check('المحاولة 2 = ×2', computeHttpBackoffDelay(2, p, () => 0.5) === 200);
  check('المحاولة 3 مقيّدة بسقف', computeHttpBackoffDelay(3, p, () => 0.5) === 400);
  check('السياسة الافتراضية 3 محاولات', DEFAULT_HTTP_RETRY_POLICY.maxAttempts === 3);
  check('resolveHttpRetryPolicy يقيّد بين 1..3', resolveHttpRetryPolicy({ HTTP_RETRY_MAX_ATTEMPTS: '99' }).maxAttempts === 3 && resolveHttpRetryPolicy({ HTTP_RETRY_MAX_ATTEMPTS: '0' }).maxAttempts === 1);

  group('4) الغلاف: GET 503 => إعادة ثم نجاح (نداءان)');
  {
    const sleeps: number[] = [];
    let calls = 0;
    const retrying = createRetryingFetch(async () => {
      calls += 1;
      return calls === 1 ? fakeRes(503, { error: { message: 'high demand', code: 1 } }) : fakeRes(200, { id: 'OK1' });
    }, { policy: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 20, factor: 2 }, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5 });
    const res = await retrying('https://graph.example/read', { method: 'GET' });
    check('نجح بعد إعادة', res.ok && res.status === 200);
    check('نداءان فقط', calls === 2);
    check('نام مرة واحدة بينهما', sleeps.length === 1);
    check('الجسم يُقرأ صحيحاً', (await res.json())?.id === 'OK1');
  }

  group('5) الغلاف: POST لا يُعاد أبداً (نداء واحد عند 503)');
  {
    let calls = 0;
    const retrying = createRetryingFetch(async () => { calls += 1; return fakeRes(503, { error: { message: 'unavailable' } }); }, { policy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, factor: 2 }, sleep: async () => {}, random: () => 0.5 });
    const res = await retrying('https://graph.example/reply', { method: 'POST', body: 'x' });
    check('POST لا يُعاد (نداء واحد)', calls === 1);
    check('يعيد 503 كما هو', res.status === 503 && res.ok === false);
  }

  group('6) الغلاف: GET كود 190 => لا إعادة (نداء واحد)');
  {
    let calls = 0;
    const retrying = createRetryingFetch(async () => { calls += 1; return fakeRes(400, { error: { message: 'Session has expired', type: 'OAuthException', code: 190 } }); }, { policy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, factor: 2 }, sleep: async () => {}, random: () => 0.5 });
    const res = await retrying('https://graph.example/me', { method: 'GET' });
    check('كود 190 لا يُعاد (نداء واحد)', calls === 1);
    check('يعيد 400 كما هو', res.status === 400);
    check('الجسم يحمل كود 190', (await res.json())?.error?.code === 190);
  }

  group('7) الغلاف: 429 مع Retry-After => ينتظر المدة المعلنة');
  {
    const sleeps: number[] = [];
    let calls = 0;
    const retrying = createRetryingFetch(async () => { calls += 1; return calls === 1 ? fakeRes(429, { error: { message: 'rate limited' } }, { 'retry-after': '3' }) : fakeRes(200, { id: 'OK' }); }, { policy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, factor: 2 }, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5 });
    const res = await retrying('https://graph.example/read', { method: 'GET' });
    check('429 أُعيد ثم نجح', res.ok && calls === 2);
    check('احترم Retry-After (3000ms)', sleeps.length === 1 && sleeps[0] === 3000);
  }

  group('8) الغلاف: خطأ شبكي على GET => إعادة؛ على POST => لا');
  {
    let getCalls = 0;
    const getRetry = createRetryingFetch(async () => { getCalls += 1; if (getCalls === 1) throw new Error('ECONNRESET'); return fakeRes(200, { id: 'OK' }); }, { policy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, factor: 2 }, sleep: async () => {}, random: () => 0.5 });
    const g = await getRetry('https://graph.example/read', { method: 'GET' });
    check('شبكة GET => إعادة ثم نجاح', g.ok && getCalls === 2);
    let postCalls = 0;
    const postRetry = createRetryingFetch(async () => { postCalls += 1; throw new Error('ECONNRESET'); }, { policy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, factor: 2 }, sleep: async () => {}, random: () => 0.5 });
    let threw = false;
    try { await postRetry('https://graph.example/publish', { method: 'POST' }); } catch { threw = true; }
    check('شبكة POST => لا إعادة + يرمي', postCalls === 1 && threw);
  }

  group('9) الغلاف: سقف 3 محاولات (استنفاد)');
  {
    let calls = 0;
    const retrying = createRetryingFetch(async () => { calls += 1; return fakeRes(503, { error: { message: 'down' } }); }, { policy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, factor: 2 }, sleep: async () => {}, random: () => 0.5 });
    const res = await retrying('https://graph.example/read', { method: 'GET' });
    check('3 محاولات كحد أقصى', calls === 3);
    check('يعيد آخر استجابة (503)', res.status === 503);
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) { console.error(`FAILED: ${failures.length} / ${passed + failures.length}`); for (const f of failures) console.error('  ✗ ' + f); process.exitCode = 1; }
  else console.log(`PASSED: ${passed} http-retry checks`);
}

main().catch((e) => { console.error('harness crashed', e); process.exitCode = 1; });
