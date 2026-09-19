/**
 * اختبار حقيقي لدالة Netlify: يُجمّع netlify/functions/api.ts بنفس إعدادات
 * Netlify (esbuild، node، cjs) ثم يستدعي الـhandler الفعلي بحدث يشبه ما يمرره
 * Netlify، ويتحقق أن مسارات /api تصل إلى تطبيق Express بدل أن ترجع 404.
 *
 * يُشغَّل على الحزمة الناتجة فعلاً — لا mocks ولا محاكاة لمنطق التطبيق.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

type FnHandler = (event: unknown, context: unknown) => Promise<{ statusCode: number; body: string; headers?: Record<string, string> }>;

function apiEvent(path: string, method = 'GET', body: unknown = null) {
  return {
    path,
    httpMethod: method,
    headers: { 'content-type': 'application/json', host: 'test.netlify.app' },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body ? JSON.stringify(body) : null,
    isBase64Encoded: false,
    rawUrl: `https://test.netlify.app${path}`,
    rawPath: path,
  };
}

const outDir = mkdtempSync(join(tmpdir(), 'netlify-fn-test-'));
const outFile = join(outDir, 'api.cjs');

try {
  // 1) التجميع: يفشل الاختبار إن فشل bundling — كما يشترط Netlify.
  let bundleOk = true;
  let bundleErr = '';
  try {
    execFileSync(
      'npx',
      ['esbuild', 'netlify/functions/api.ts', '--bundle', '--platform=node', '--target=node20', '--format=cjs', `--outfile=${outFile}`, '--log-level=warning'],
      { stdio: 'pipe', timeout: 180_000 },
    );
  } catch (e: any) {
    bundleOk = false;
    bundleErr = String(e?.stderr || e?.message || e).slice(0, 400);
  }
  check('حزمة الدالة تُبنى بنجاح (esbuild/node/cjs)', bundleOk && existsSync(outFile), bundleErr);
  if (!bundleOk || !existsSync(outFile)) throw new Error('توقف الاختبار: فشل التجميع');

  const bundle = readFileSync(outFile, 'utf8');

  // 2) إعداد Netlify: المسارات والمعاملات المطلوبة موجودة فعلاً.
  {
    const toml = readFileSync('netlify.toml', 'utf8');
    check('netlify.toml يحدد مجلد الدوال', /\[functions\][\s\S]*?directory\s*=\s*"netlify\/functions"/.test(toml));
    check('netlify.toml يحدد node_bundler = esbuild', /node_bundler\s*=\s*"esbuild"/.test(toml));
    check('netlify.toml يعيد كتابة /api/* إلى الدالة', /from\s*=\s*"\/api\/\*"/.test(toml) && /to\s*=\s*"\/\.netlify\/functions\/api\/:splat"/.test(toml));
    check('rewrite الـAPI بحالة 200 (يحافظ على المسار بعكس 301)', /from\s*=\s*"\/api\/\*"[\s\S]{0,120}?status\s*=\s*200/.test(toml));
    check('netlify.toml ينشر dist', /publish\s*=\s*"dist"/.test(toml));
    check('netlify.toml لا يحتوي أي سر', !/AIzaSy|secret|api_?key/i.test(toml));
  }

  // 3) Vite (خاص بالتطوير) يجب ألا يُحزَّم مع الدالة.
  check('Vite غير مُضمَّن في حزمة الدالة', !bundle.includes('vite:logger') && !bundle.includes('optimizeDeps'));
  check('serverless-http مُضمَّن في الحزمة', bundle.includes('serverless-http'));
  check('الحزمة غير فارغة ومنطقية الحجم', statSync(outFile).size > 500_000, `size=${statSync(outFile).size}`);

  // 4) الاستدعاء الفعلي: التحميل داخل نفس العملية مع تعطيل الاستماع.
  delete process.env.NETLIFY;
  process.env.NETLIFY = 'true';
  process.env.NODE_ENV = 'production';
  const require_ = createRequire(import.meta.url);
  const mod = require_(outFile) as { handler?: FnHandler };
  check('الدالة تصدّر handler', typeof mod.handler === 'function');

  if (typeof mod.handler !== 'function') throw new Error('توقف الاختبار: لا يوجد handler');
  const handler = mod.handler;

  await (async () => {
    // أ) /api/health يصل إلى Express ويعيد 200 لا 404.
    const h = await handler(apiEvent('/api/health'), {});
    check('GET /api/health -> 200 (لا 404)', h.statusCode === 200, `got ${h.statusCode}`);
    const hb = JSON.parse(h.body || '{}');
    check('health.status === "ok"', hb.status === 'ok', h.body.slice(0, 120));
    check('health.version === 13.0.0', hb.version === '13.0.0');
    check('health.geminiUsage معلن', !!hb.geminiUsage);
    check('health لا يسرّب أي مفتاح', !/AIzaSy/.test(h.body || ''));

    // ب) /api/readiness يفصل جاهزية التطبيق عن جاهزية المزود.
    const r = await handler(apiEvent('/api/readiness'), {});
    check('GET /api/readiness -> 200', r.statusCode === 200, `got ${r.statusCode}`);
    const rb = JSON.parse(r.body || '{}');
    check('readiness.applicationReady === true', rb.applicationReady === true);
    check('readiness تفصل جاهزية المزود', typeof rb.ai?.providerReady === 'boolean');

    // ج) مسار المصادقة المذكور في المهمة يصل للـbackend لا يرجع 404.
    const c = await handler(apiEvent('/api/auth/request-owner-challenge', 'POST', { email: 'probe@example.com' }), {});
    check('POST /api/auth/request-owner-challenge ليس 404', c.statusCode !== 404, `got ${c.statusCode}`);
    check('POST request-owner-challenge ردّه 200 أو 503 (مسار حقيقي)', c.statusCode === 200 || c.statusCode === 503, `got ${c.statusCode}`);

    // د) المسارات المحمية تُثبت الوصول عبر 401 لا 404.
    const v = await handler(apiEvent('/api/ai/verify-provider', 'POST', {}), {});
    check('POST /api/ai/verify-provider -> 401 (لا 404)', v.statusCode === 401, `got ${v.statusCode}`);

    // هـ) مسار API غير موجود يعيد 404 صريح من Express.
    const nf = await handler(apiEvent('/api/definitely-not-a-route'), {});
    check('مسار API غير موجود -> 404 من Express', nf.statusCode === 404, `got ${nf.statusCode}`);

    // و) POST مع جسم JSON يُقرأ فعلاً (بلا 404 ولا خطأ تفريغ).
    const p = await handler(apiEvent('/api/ai/generate-content', 'POST', { platform: 'facebook', contentType: 'post', topic: 'اختبار' }), {});
    check('POST /api/ai/generate-content -> 401 (لا 404)', p.statusCode === 401, `got ${p.statusCode}`);
  })();

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} netlify function checks`);
  }
} finally {
  try { rmSync(outDir, { recursive: true, force: true }); } catch {}
}