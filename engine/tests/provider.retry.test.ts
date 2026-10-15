/**
 * F-14 — اختبار وحدة لإعادة المحاولة الآمنة على نداءات المزوّد.
 *
 * يثبت القواعد حصراً بلا شبكة ولا ساعة حقيقية (يُحقن `sleep`/`now`):
 *  - 503 على GET => إعادة ثم نجاح.
 *  - 429 مع Retry-After => يُحترم المدة المطلوبة (لا أقل).
 *  - POST (نشر/رد) => لا إعادة تلقائية أبداً، ولو تكرّر 503.
 *  - انقطاع الشبكة على POST => يُرمى الخطأ كما هو (فيتصنّف NETWORK_ERROR ⇒ الحجز يبقى reserved).
 *  - خطأ دائم (400/401/403/كود 190) => لا إعادة.
 *  - 3 محاولات كحد أقصى.
 */

import {
  createRetryingProviderFetch,
  providerRetryConfig,
  decideProviderRetry,
  parseRetryAfterHeader,
  isPermanentProviderFailure,
  kindForMethod,
} from '../social/providerRetry';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

/** ساعة/نوم وهميان: لا وقت حقيقي، ويُسجَّل كل نوم. */
function testConfig(overrides: Record<string, unknown> = {}) {
  const sleeps: number[] = [];
  const config = providerRetryConfig({}, {
    sleep: async (ms: number) => { sleeps.push(ms); },
    now: () => 1_000_000,
    ...overrides,
  });
  return { config, sleeps };
}

/** استجابة وهمية بشكل موصل (`{ ok, status, json }`). */
function res(status: number, body: any = {}, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[String(k).toLowerCase()] ?? null },
    json: async () => body,
  };
}

async function main(): Promise<void> {
  group('1) وحدة: تصنيف الطريقة والأخطاء');
  check('GET قراءة', kindForMethod('GET') === 'read');
  check('POST كتابة', kindForMethod('POST') === 'write');
  check('بلا طريقة => قراءة (افتراضي آمن)', kindForMethod(undefined) === 'read');
  check('400 دائم', isPermanentProviderFailure(400, {}) === true);
  check('401 دائم', isPermanentProviderFailure(401, {}) === true);
  check('403 دائم', isPermanentProviderFailure(403, {}) === true);
  check('كود 190 دائم', isPermanentProviderFailure(200, { error: { code: 190 } }) === true);
  check('429 عابر (لا دائم)', isPermanentProviderFailure(429, {}) === false);
  check('503 عابر (لا دائم)', isPermanentProviderFailure(503, {}) === false);
  check('408 مهلة عابر (لا دائم)', isPermanentProviderFailure(408, {}) === false);

  group('2) وحدة: Retry-After (ثوانٍ أو تاريخ HTTP)');
  check('ثوانٍ => ms', parseRetryAfterHeader('2', 0) === 2000);
  check('تاريخ مستقبلي => فرق صحيح', parseRetryAfterHeader(new Date(1_000_000 + 5000).toUTCString(), 1_000_000) === 5000);
  check('قيمة غير مفهومة => null (لا انتظار مُختلق)', parseRetryAfterHeader('soon', 0) === null);
  check('قيمة غائبة => null', parseRetryAfterHeader(null, 0) === null);

  group('3) وحدة: 503 على GET => إعادة ثم نجاح');
  {
    const { config, sleeps } = testConfig({ baseDelayMs: 300, maxDelayMs: 5000 });
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return calls < 3 ? res(503, { error: { message: 'unavailable' } }) : res(200, { id: 'OK' }); };
    const wrapped = createRetryingProviderFetch(fetchImpl, { config });
    const out = await wrapped('https://x/y', { method: 'GET' });
    check('نجح بعد إعادتين', out.ok === true && (await out.json()).id === 'OK');
    check('عدد النداءات 3 (الحد الأقصى)', calls === 3);
    check('تأخير تصاعدي: 300 ثم 600', sleeps[0] === 300 && sleeps[1] === 600, JSON.stringify(sleeps));
  }

  group('4) وحدة: 429 مع Retry-After => يُحترم المدة');
  {
    const { config, sleeps } = testConfig({ baseDelayMs: 100, maxDelayMs: 5000, maxRetryAfterMs: 60_000 });
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return calls === 1 ? res(429, { error: { message: 'slow down' } }, { 'retry-after': '7' }) : res(200, { id: 'OK' }); };
    const wrapped = createRetryingProviderFetch(fetchImpl, { config });
    const out = await wrapped('https://x/y', { method: 'GET' });
    check('نجح بعد احترام المدة', out.ok === true && calls === 2);
    check('الانتظار 7000ms (لا أقل من Retry-After)', sleeps[0] === 7000, JSON.stringify(sleeps));
  }

  group('5) وحدة: Retry-After بسقف يمنع التعليق');
  {
    const { config, sleeps } = testConfig({ maxRetryAfterMs: 2000, baseDelayMs: 10 });
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return calls === 1 ? res(429, {}, { 'retry-after': '600' }) : res(200, {}); };
    const wrapped = createRetryingProviderFetch(fetchImpl, { config });
    await wrapped('https://x/y', { method: 'GET' });
    check('السقف يقيّد الانتظار إلى 2000ms', sleeps[0] === 2000, JSON.stringify(sleeps));
  }

  group('6) وحدة: POST (نشر/رد) => لا إعادة تلقائية أبداً');
  {
    const { config, sleeps } = testConfig();
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return res(503, { error: { message: 'unavailable' } }); };
    const wrapped = createRetryingProviderFetch(fetchImpl, { config });
    const out = await wrapped('https://x/feed', { method: 'POST', body: 'message=hi' });
    check('نداء واحد فقط على POST', calls === 1);
    check('لا نوم إطلاقاً', sleeps.length === 0);
    check('يُعاد الفشل كما هو (502/503 من المزود)', out.ok === false && out.status === 503);
  }

  group('7) وحدة: انقطاع الشبكة على POST => يُرمى الخطأ كما هو');
  {
    const { config, sleeps } = testConfig();
    let calls = 0;
    const fetchImpl = async () => { calls += 1; throw new TypeError('socket hang up'); };
    const wrapped = createRetryingProviderFetch(fetchImpl, { config });
    let thrown: any = null;
    try { await wrapped('https://x/feed', { method: 'POST', body: 'x' }); } catch (e) { thrown = e; }
    check('يُرمى الخطأ (فيتصنّف NETWORK_ERROR)', thrown instanceof TypeError);
    check('نداء واحد فقط (لا إعادة على كتابة)', calls === 1);
    check('لا نوم', sleeps.length === 0);
  }

  group('8) وحدة: انقطاع الشبكة على GET => يُعاد ثم ينجح');
  {
    const { config } = testConfig({ baseDelayMs: 5 });
    let calls = 0;
    const fetchImpl = async () => { calls += 1; if (calls === 1) throw new TypeError('ECONNRESET'); return res(200, { id: 'OK' }); };
    const wrapped = createRetryingProviderFetch(fetchImpl, { config });
    const out = await wrapped('https://x/y', { method: 'GET' });
    check('نجح بعد انقطاع عابر', out.ok === true && calls === 2);
  }

  group('9) وحدة: خطأ دائم على GET => لا إعادة (400/401/403/190)');
  for (const [status, body] of [[400, {}], [401, {}], [403, {}], [400, { error: { code: 190 } }]] as [number, any][]) {
    const { config, sleeps } = testConfig();
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return res(status, body); };
    const wrapped = createRetryingProviderFetch(fetchImpl, { config });
    await wrapped('https://x/y', { method: 'GET' });
    check(`لا إعادة على ${status}${body?.error?.code ? '/190' : ''}`, calls === 1 && sleeps.length === 0, `calls=${calls}`);
  }

  group('10) وحدة: قرار الإعادة الموحّد (المصدر الواحد)');
  {
    const { config } = testConfig();
    check('كتابة => لا إعادة', decideProviderRetry({ kind: 'write', status: 503, attempt: 1, config }).reason === 'write_never_retried');
    check('قراءة 503 => إعادة', decideProviderRetry({ kind: 'read', status: 503, attempt: 1, config }).retry === true);
    check('قراءة 190 => لا إعادة', decideProviderRetry({ kind: 'read', status: 400, data: { error: { code: 190 } }, attempt: 1, config }).reason === 'permanent_error');
    check('استنفاد المحاولات => لا إعادة', decideProviderRetry({ kind: 'read', status: 503, attempt: 3, config }).reason === 'attempts_exhausted');
    check('الحد الأقصى 3 افتراضياً', config.maxAttempts === 3);
  }

  console.log(`\nPASSED: ${passed} provider-retry checks`);
  if (failures.length) { console.error(`\nFAILED (${failures.length}):`); for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
}

main().catch((err) => { console.error('provider retry harness crashed:', err); process.exit(1); });
