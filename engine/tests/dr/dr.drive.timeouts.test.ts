/**
 * اختبار طبقة المهلات لـ Google Drive (Task: تعليق رفع الفيديو بلا نهاية).
 *
 * يثبت (fail-old / pass-new):
 *  - الناقل يمرّر خيار `timeout` فعلاً لـgaxios، فلا يبقى الطلب معلّقاً إلى الأبد.
 *  - عند تجاهل التنفيذ الداخلي للمهلة، يقطعها الغلاف الصريح (settleWithTimeout).
 *  - الخطأ يُصنَّف `timeout` (عابر) فيدخل إعادة المحاولة أو يفشل بوضوح.
 *  - تجديد رمز OAuth محدود بمهلة أيضاً فلا يعلّق السلسلة.
 * لا شبكة حقيقية ولا مزود.
 */

import {
  DRIVE_METADATA_TIMEOUT_MS,
  DRIVE_TRANSFER_TIMEOUT_MS,
  DRIVE_TOKEN_TIMEOUT_MS,
  DRIVE_PUBLIC_HOST_TIMEOUT_MS,
  resolveRequestTimeoutMs,
  envTimeoutMs,
  settleWithTimeout,
} from '../../../tools/dr/drive-timeouts.mjs';
import {
  DriveClient,
  createGaxiosTransport,
  classifyDriveError,
  isTransient,
} from '../../../tools/dr/drive-client.mjs';
import { refreshDriveAccessToken } from '../../../tools/dr/drive-auth.mjs';
import { Gaxios } from 'gaxios';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** شبيه gaxios لأغراض الاختبار: يحترم المهلة، أو يتجاهلها تماماً. */
function makeGaxiosLike(mode: 'respect' | 'ignore' | 'ok') {
  const calls: any[] = [];
  return {
    calls,
    request: async (opts: any) => {
      calls.push(opts);
      if (mode === 'ignore') return new Promise(() => { /* لا ينتهي أبداً */ });
      if (mode === 'respect' && Number.isFinite(opts.timeout)) {
        await sleep(opts.timeout);
        throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
      }
      return { status: 200, headers: {}, data: { ok: true } };
    },
  };
}

async function main(): Promise<void> {
  group('1) قيم المهلة القياسية ومنطق الاستنتاج');
  check('مهلة البيانات الوصفية في النطاق المطلوب (60–90s)', DRIVE_METADATA_TIMEOUT_MS >= 60_000 && DRIVE_METADATA_TIMEOUT_MS <= 90_000, String(DRIVE_METADATA_TIMEOUT_MS));
  check('مهلة النقل أوسع من الوصفية وفي النطاق (60–90s)', DRIVE_TRANSFER_TIMEOUT_MS >= 60_000 && DRIVE_TRANSFER_TIMEOUT_MS <= 90_000 && DRIVE_TRANSFER_TIMEOUT_MS >= DRIVE_METADATA_TIMEOUT_MS, String(DRIVE_TRANSFER_TIMEOUT_MS));
  check('مهلة التحقق من واجهة الاستضافة صريحة وفي النطاق (60–90s)', DRIVE_PUBLIC_HOST_TIMEOUT_MS >= DRIVE_TRANSFER_TIMEOUT_MS && DRIVE_PUBLIC_HOST_TIMEOUT_MS >= 60_000 && DRIVE_PUBLIC_HOST_TIMEOUT_MS <= 90_000, String(DRIVE_PUBLIC_HOST_TIMEOUT_MS));
  check('مهلة الرمز معقولة (<= 20s)', DRIVE_TOKEN_TIMEOUT_MS <= 20_000 && DRIVE_TOKEN_TIMEOUT_MS > 0, String(DRIVE_TOKEN_TIMEOUT_MS));
  check('طلب JSON وصفّي => مهلة البيانات الوصفية', resolveRequestTimeoutMs({ method: 'GET' }) === DRIVE_METADATA_TIMEOUT_MS);
  check('طلب arraybuffer (تنزيل) => مهلة النقل', resolveRequestTimeoutMs({ responseType: 'arraybuffer' }) === DRIVE_TRANSFER_TIMEOUT_MS);
  check('جسم كبير => مهلة النقل', resolveRequestTimeoutMs({ body: Buffer.alloc(2 * 1024 * 1024) }) === DRIVE_TRANSFER_TIMEOUT_MS);
  check('جسم صغير => مهلة الوصفية', resolveRequestTimeoutMs({ body: Buffer.alloc(1024) }) === DRIVE_METADATA_TIMEOUT_MS);
  check('envTimeoutMs يقرأ الرقم الصالح', envTimeoutMs({ X: '1234' }, 'X', 9) === 1234);
  check('envTimeoutMs يرفض غير الصالح ويُعيد الافتراضي', envTimeoutMs({ X: 'abc' }, 'X', 9) === 9 && envTimeoutMs({ X: '-5' }, 'X', 9) === 9);

  group('2) الناقل يمرّر timeout فعلاً ويقطع الطلب المتعثّر');
  {
    const inst = makeGaxiosLike('respect');
    const transport = createGaxiosTransport(inst as any, { requestTimeoutMs: 60 });
    const client = new DriveClient({ transport, accessToken: 'x', maxRetries: 0 });
    const t0 = Date.now();
    const res: any = await client.getAbout();
    const elapsed = Date.now() - t0;
    check('لم يبقَ معلّقاً (انتهى سريعاً)', elapsed < 2000, `${elapsed}ms`);
    check('التصنيف timeout صريح', res.ok === false && res.code === 'timeout', JSON.stringify({ ok: res.ok, code: res.code }));
    check('خيار timeout مُرّر لـgaxios (نفس القيمة)', inst.calls[0]?.timeout === 60, String(inst.calls[0]?.timeout));
  }

  group('3) الغلاف الصريح يقطع حتى لو تجاهل gaxios المهلة تماماً');
  {
    const inst = makeGaxiosLike('ignore');
    const transport = createGaxiosTransport(inst as any, { requestTimeoutMs: 60 });
    // نمط الخادم: غلاف settleWithTimeout حول الناقل (حيث لا يُضبط timeout الفعلي).
    const guarded = (opts: any) => settleWithTimeout(Promise.resolve().then(() => transport(opts)), 120);
    const client = new DriveClient({ transport: guarded, accessToken: 'x', maxRetries: 0 });
    const t0 = Date.now();
    const res: any = await client.getAbout();
    const elapsed = Date.now() - t0;
    check('قُطع رغم تجاهل gaxios (<= 1s)', elapsed < 1000, `${elapsed}ms`);
    check('نتيجة timeout لا تعليق', res.ok === false && res.code === 'timeout', JSON.stringify({ ok: res.ok, code: res.code }));
  }

  group('4) تصنيف الخطأ وإعادة المحاولة');
  check('ETIMEDOUT => code timeout', classifyDriveError({ code: 'ETIMEDOUT' }).code === 'timeout');
  check('AbortError => code timeout', classifyDriveError({ name: 'AbortError' }).code === 'timeout');
  check('timeout عابر (يدخل إعادة المحاولة)', isTransient('timeout') === true);
  check('network_error عابر', isTransient('network_error') === true);
  {
    const inst = makeGaxiosLike('respect');
    const transport = createGaxiosTransport(inst as any, { requestTimeoutMs: 30 });
    const client = new DriveClient({ transport, accessToken: 'x', maxRetries: 2, retryBaseMs: 5 });
    const res: any = await client.getAbout();
    check('إعادة المحاولة على timeout (3 محاولات)', inst.calls.length === 3 && res.retries === 2, JSON.stringify({ calls: inst.calls.length, retries: res.retries }));
    check('ينتهي بفشل timeout صريح (لا تعليق)', res.code === 'timeout', String(res.code));
  }
  // idempotency: طلب مُغيِّر (POST) عند timeout/network لا يُعاد تلقائياً فلا ينتج نسخة مكرّرة.
  {
    const inst = makeGaxiosLike('respect');
    const transport = createGaxiosTransport(inst as any, { requestTimeoutMs: 30 });
    const client = new DriveClient({ transport, accessToken: 'x', maxRetries: 2, retryBaseMs: 5 });
    const res: any = await client.request({ url: 'https://www.googleapis.com/upload/drive/v3/files', method: 'POST', body: 'x' });
    check('POST عند timeout: محاولة واحدة فقط (بلا نسخة مكرّرة)', inst.calls.length === 1 && res.retries === 0, JSON.stringify({ calls: inst.calls.length, retries: res.retries }));
    check('POST عند timeout: فشل صريح timeout', res.ok === false && res.code === 'timeout', String(res.code));
  }
  // 5xx على POST عابر فعلاً (لم يُنفَّذ لدى Drive) => يُعاد بأمان.
  {
    let n = 0;
    const inst = {
      calls: 0,
      request: async () => {
        inst.calls += 1;
        n += 1;
        if (n === 1) throw Object.assign(new Error('boom'), { response: { status: 503, data: { error: { message: 'unavailable' } } } });
        return { status: 200, headers: {}, data: { id: 'f_ok' } };
      },
    };
    const transport = createGaxiosTransport(inst as any, { requestTimeoutMs: 500 });
    const client = new DriveClient({ transport, accessToken: 'x', maxRetries: 2, retryBaseMs: 5 });
    const res: any = await client.request({ url: 'https://www.googleapis.com/upload/drive/v3/files', method: 'POST', body: 'x' });
    check('POST على 503 صريح يُعاد بأمان (لا فشل حقيقي => لا تكرار ملف)', inst.calls === 2 && res.ok === true && res.retries === 1, JSON.stringify({ calls: inst.calls, ok: res.ok, retries: res.retries }));
  }
  // GET على timeout يُعاد (قراءة آمنة الإعادة) لكن محدوداً maxRetries.
  {
    const inst = makeGaxiosLike('respect');
    const transport = createGaxiosTransport(inst as any, { requestTimeoutMs: 30 });
    const client = new DriveClient({ transport, accessToken: 'x', maxRetries: 2, retryBaseMs: 5 });
    await client.request({ url: 'https://www.googleapis.com/drive/v3/about', method: 'GET' });
    check('GET عند timeout يُعاد بحد أقصى (3 محاولات لا أكثر)', inst.calls.length === 3, String(inst.calls.length));
  }

  group('5) تجديد رمز OAuth محدود بمهلة');
  {
    // gaxios حقيقي (يحمل interceptors) لكن نداؤه يتعثّر بلا نهاية تماماً.
    const hanging = new Gaxios();
    (hanging as any).request = () => new Promise(() => { /* لا ينتهي أبداً */ });
    const t0 = Date.now();
    const res = await refreshDriveAccessToken('refresh-token-fake', {
      clientId: 'id.apps.googleusercontent.com',
      clientSecret: 'secret',
      env: { DRIVE_TOKEN_TIMEOUT_MS: '60' } as any,
      transporter: hanging,
    });
    const elapsed = Date.now() - t0;
    check('تجديد الرمز لا يعلّق', elapsed < 1500, `${elapsed}ms`);
    check('فشل الرمز المكتوم صُنّف عابراً (network_error)', res.ok === false && res.code === 'network_error', JSON.stringify({ ok: res.ok, code: res.code }));
  }

  console.log('\n============================================================');
  if (failures.length) { console.log(`FAILED: ${failures.length}`); for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
  console.log(`PASSED: ${passed} drive timeout checks`);
  process.exit(0);
}

main().catch((e) => { console.log(`EXCEPTION: ${e?.stack || e?.message || e}`); process.exit(1); });
