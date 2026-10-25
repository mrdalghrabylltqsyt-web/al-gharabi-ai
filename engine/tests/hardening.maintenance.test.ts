/**
 * صيانة عامة (2026-10-25) — ركائز المتانة:
 *  1) مهلة لطلبات القراءة من المزودين (لا تعليق دورة كاملة)، والكتابة بلا مهلة مضافة.
 *  2) مهلة استعلام Postgres (لا يُحبس طابور الكتابة للأبد).
 *  3) دمج كتابات الحالة الكاملة (لا كتابة كاملة لكل audit) مع نفس ضمان الدوام.
 *  4) فشل الحفظ المتكرر ⇒ تنبيه للمالك (لا فقدان صامت).
 *  5) تدقيق ثغرات الحزم في CI (تقرير دائم).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRetryingProviderFetch, providerRetryConfig } from '../social/providerRetry';
import { postgresPoolConfig, pgTlsVerifyMode, isTlsCertError } from '../storage/adapter';
import { OWNER_ALERT_KIND_LABELS_AR } from '../notifications/ownerAlerts';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0;
let finished = false;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  // AbortSignal.timeout يستخدم مؤقّتاً غير مُثبِّت (unref): نُبقي الحلقة حيّة في الاختبار.
  const keepAlive = setInterval(() => {}, 1000);
  // 1) مهلة القراءة
  const seen: any[] = [];
  const base = async (_url: string, init: any) => { seen.push(init); return { ok: true, status: 200, json: async () => ({ ok: 1 }), headers: { get: () => null } }; };
  const cfg = providerRetryConfig({}, { sleep: async () => {} });
  check('المهلة الافتراضية 25 ثانية', cfg.readTimeoutMs === 25_000);
  check('قابلة للضبط بحدود', providerRetryConfig({ PROVIDER_READ_TIMEOUT_MS: '999999' }).readTimeoutMs === 120_000 && providerRetryConfig({ PROVIDER_READ_TIMEOUT_MS: '5000' }).readTimeoutMs === 5000);
  const f = createRetryingProviderFetch(base, { config: cfg });
  await f('https://x/read', { method: 'GET' });
  await f('https://x/write', { method: 'POST', body: '{}' });
  check('★ القراءة تحمل إشارة مهلة', Boolean(seen[0]?.signal));
  check('★ الكتابة (رفع/نشر) بلا مهلة مضافة', !seen[1]?.signal);
  // قراءة معلّقة تُقطع ثم تُعاد ثم تفشل صراحةً (لا تعليق)
  let calls = 0;
  const hang = (_u: string, init: any) => new Promise((_res, rej) => { calls += 1; init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))); });
  const fh = createRetryingProviderFetch(hang as any, { config: providerRetryConfig({ PROVIDER_READ_TIMEOUT_MS: '1000' }, { sleep: async () => {} }) });
  const t0 = Date.now();
  let threw = false;
  try { await fh('https://x/hang', { method: 'GET' }); } catch { threw = true; }
  check('★ قراءة معلّقة تنتهي بخطأ صريح خلال المهل (لا تعليق)', threw && Date.now() - t0 < 6000 && calls === 3, `calls=${calls} ms=${Date.now() - t0}`);

  // 2) Postgres
  const pc: any = postgresPoolConfig('postgresql://u:p@h/d?sslmode=require');
  check('★ مهلة استعلام على العميل والخادم', pc.query_timeout === 45_000 && pc.statement_timeout === 45_000);

  // 3) دمج كتابات الحالة
  const server = read('server.ts');
  check('★ persistState يدمج الكتابات المجدولة', server.includes('if (persistPending) { persistStats.coalesced += 1; return; }') && server.includes('persistPending = false;\n      const snapshot = buildPersistedState();'));
  check('سطر سجل لعدد الكتابات المدموجة', server.includes('[storage] state_writes requested='));

  // 4) تنبيه فشل الحفظ
  check('★ نوع تنبيه «حفظ البيانات يفشل»', OWNER_ALERT_KIND_LABELS_AR.storage_failing === 'حفظ البيانات يفشل');
  check('★ يُفحص في دورة التنبيه ويظهر في تنبيهات النظام', server.includes('syncStorageFailingAlert();') && server.includes('id:"storage-failing"'));

  // 5) CI
  const ci = read('.github/workflows/ci.yml');
  check('★ تدقيق ثغرات حزم الإنتاج في CI (غير مانع)', ci.includes('npm audit --omit=dev --json') && ci.includes('continue-on-error: true'));


  // 6) التحقق من شهادة TLS لقاعدة البيانات (المرحلة 1: auto مع رجوع مُسجَّل)
  check('★ الوضع الافتراضي auto', pgTlsVerifyMode({}) === 'auto' && pgTlsVerifyMode({ PG_TLS_VERIFY: 'STRICT' }) === 'strict' && pgTlsVerifyMode({ PG_TLS_VERIFY: 'off' }) === 'off' && pgTlsVerifyMode({ PG_TLS_VERIFY: 'x' }) === 'auto');
  check('★ التحقق مفعّل حين يُطلب', (postgresPoolConfig('postgresql://u:p@h/d?sslmode=require', { verifyTls: true }) as any).ssl.rejectUnauthorized === true);
  check('بلا طلب ⇒ السلوك القديم', (postgresPoolConfig('postgresql://u:p@h/d?sslmode=require') as any).ssl.rejectUnauthorized === false);
  check('★ أخطاء الشهادة فقط تُعدّ أخطاء TLS', isTlsCertError({ code: 'SELF_SIGNED_CERT_IN_CHAIN' }) && isTlsCertError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }) && isTlsCertError({ message: 'unable to verify the first certificate' }) && !isTlsCertError({ code: 'ECONNREFUSED' }) && !isTlsCertError({ code: '28P01' }));
  const adapterSrc = read('engine/storage/adapter.ts');
  check('★ رجوع مُسجَّل فقط عند رفض الشهادة في وضع auto', adapterSrc.includes("if (!result.ok && mode === 'auto' && verifyTls && isTlsCertError(result.error))") && adapterSrc.includes('tls verify=failed code='));
  check('حالة TLS ظاهرة للمالك + تنبيه عند الرجوع', server.includes('databaseTls: ((storageAdapter as any).tlsStatus?.result') && server.includes('id:"db-tls"'));
  clearInterval(keepAlive);
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const x of failures) console.error('  ✗ ' + x);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} hardening checks`);
  finished = true;
}
main().catch((e) => { console.error('FAILED: crash', e); process.exit(1); });
// خروج صامت قبل اكتمال main = فشل (لا نجاح كاذب).
process.on('beforeExit', () => { if (!finished) { console.error('FAILED: exited before completion'); process.exit(1); } });
