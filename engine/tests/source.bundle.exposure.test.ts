/**
 * SEC-01 regression test — منع التسريب العام لحزمة المصدر (dist/dr-source).
 *
 * الثغرة: `express.static(dist)` كان يخدم `dist/dr-source/*` علناً بلا مصادقة،
 * فيتاح `source.tar.gz` (المصدر الكامل + بصمة الالتزام) لأي طلب.
 *
 * هذا الاختبار يشغّل نسخة الإنتاج المبنية فعلياً (dist/server.cjs) ويثبت:
 * - أن ملفات الحزمة **موجودة على القرص** (فشل الرد سببه الحجب لا غياب الملف).
 * - أن كل مسارات /dr-source تُرد 404 (بما فيها تنويعات حالة الأحرف).
 * - أن بقية الأصول الثابتة والـAPI تعمل كما هي (لا كسر للواجهة).
 *
 * يُشغَّل على النسخة المبنية، لذا شغّل `npm run build` قبله (كما runtime-smoke).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const PORT = 4741;
const BASE = `http://127.0.0.1:${PORT}`;
const BUNDLE_DIR = path.join(process.cwd(), 'dist', 'dr-source');

async function waitForServer(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* الخادم لم يقلع بعد */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** يمنع المفرقعات/التشويش: نطالب الرد ألا يكون الحزمة ولا HTML الواجهة. */
async function statusOf(url: string): Promise<{ status: number; contentType: string; body: string }> {
  const res = await fetch(url, { redirect: 'manual' });
  let body = '';
  try { body = await res.text(); } catch { /* لا جسم */ }
  return { status: res.status, contentType: String(res.headers.get('content-type') || ''), body };
}

const BLOCKED_PATHS = [
  // عادي
  '/dr-source/source.tar.gz',
  '/dr-source/source-bundle.json',
  '/dr-source/source-commit.txt',
  '/dr-source/source-treehash.txt',
  '/dr-source/',
  '/dr-source',
  '/dist/dr-source/source.tar.gz',
  '/dist/dr-source/source-bundle.json',
  // حزمة الخادم المبنية وخريطتها (تحملان الكود المصدري الكامل).
  '/server.cjs',
  '/server.cjs.map',
  // أحرف كبيرة
  '/DR-SOURCE/source.tar.gz',
  '/Dr-Source/source-bundle.json',
  '/SERVER.CJS',
  '/Server.cjs.map',
  '/SERVER.CJS.MAP',
  // ترميز percent
  '/%64r-source/source.tar.gz',
  '/%64R-SOURCE/source.tar.gz',
  '/%73erver.cjs',
  '/%73erver.cjs.map',
  '/dr-source%2fsource.tar.gz',
  '/server%2ecjs.map',
  // ترميز مزدوج
  '/%2564r-source/source.tar.gz',
  '/%2573erver.cjs.map',
  // اجتياز/تطبيع
  '/dr-source/%2e%2e/dr-source/source.tar.gz',
  '/x/dr-source/source.tar.gz',
  '/foo/dr-source/source-bundle.json',
  '/./dr-source/source.tar.gz',
  '/dr-source/./source.tar.gz',
];

async function run(): Promise<void> {
  if (!existsSync('dist/server.cjs')) {
    console.error('dist/server.cjs غير موجود — شغّل npm run build أولاً.');
    process.exit(1);
  }
  // نثبت أولاً أن الحزمة موجودة فعلاً على القرص؛ وإلا فالاختبار لا معنى له.
  const archiveExists = existsSync(path.join(BUNDLE_DIR, 'source.tar.gz'));
  const manifestExists = existsSync(path.join(BUNDLE_DIR, 'source-bundle.json'));
  check('source bundle archive exists on disk (guard test is meaningful)', archiveExists);
  check('source bundle manifest exists on disk', manifestExists);

  const server: ChildProcess = spawn('node', ['dist/server.cjs'], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout?.on('data', (d) => { serverLog += String(d); });
  server.stderr?.on('data', (d) => { serverLog += String(d); });

  try {
    const up = await waitForServer();
    check('server started', up, serverLog.slice(-300));
    if (!up) return;

    // --- الحجب: كل مسارات dist/dr-source تُرد 404 ---
    for (const p of BLOCKED_PATHS) {
      const r = await statusOf(`${BASE}${p}`);
      check(`blocked ${p} => 404`, r.status === 404, `status=${r.status} type=${r.contentType}`);
    }
    // الرد ليس الحزمة ولا HTML الواجهة (لا تسريب ولا fallback مضلّل).
    const tar = await statusOf(`${BASE}/dr-source/source.tar.gz`);
    check('archive response is not the gzip bundle', !/gzip|octet-stream/i.test(tar.contentType) && !tar.body.includes('\x1f\x8b'), tar.contentType);
    const manifest = await statusOf(`${BASE}/dr-source/source-bundle.json`);
    check('manifest response body is not the bundle manifest', !manifest.body.includes('gharabi-source-bundle'), manifest.contentType);
    // خريطة الخادم تحمل sourcesContent؛ نتأكد أن الرد ليس الخريطة ولا مصدراً أصلياً.
    const mapFile = await statusOf(`${BASE}/server.cjs.map`);
    check('server.cjs.map is not served as the source map', !mapFile.body.includes('sourcesContent') && !mapFile.body.includes('server.ts'), `status=${mapFile.status} type=${mapFile.contentType}`);
    const serverCjs = await statusOf(`${BASE}/server.cjs`);
    check('server.cjs is not served as the node bundle', !serverCjs.body.includes('require(') && serverCjs.status === 404, `status=${serverCjs.status}`);
    // التجاوز بالترميز: الرد أيضاً ليس الخريطة ولا مصدراً أصلياً.
    const encMap = await statusOf(`${BASE}/%73erver.cjs.map`);
    check('encoded server.cjs.map does not disclose sourcesContent', !encMap.body.includes('sourcesContent') && !encMap.body.includes('server.ts'), `status=${encMap.status}`);
    const encTar = await statusOf(`${BASE}/%64r-source/source.tar.gz`);
    check('encoded dr-source does not disclose the gzip bundle', !encTar.body.includes('\x1f\x8b') && !/gzip|octet-stream/i.test(encTar.contentType), `status=${encTar.status} type=${encTar.contentType}`);
    const encSlash = await statusOf(`${BASE}/dr-source%2fsource-bundle.json`);
    check('encoded-slash dr-source does not disclose the manifest', !encSlash.body.includes('gharabi-source-bundle'), `status=${encSlash.status}`);

    // --- عدم كسر بقية المسارات: الصحة والواجهة تعملان ---
    const health = await statusOf(`${BASE}/api/health`);
    check('control: /api/health still responds 200', health.status === 200, `status=${health.status}`);
    const root = await statusOf(`${BASE}/`);
    check('control: SPA root still served 200', root.status === 200, `status=${root.status}`);
    const spa = await statusOf(`${BASE}/some/spa/route`);
    check('control: SPA fallback still served 200', spa.status === 200, `status=${spa.status}`);
    const unknownApi = await statusOf(`${BASE}/api/definitely-not-a-route`);
    check('control: unknown /api still JSON 404', unknownApi.status === 404, `status=${unknownApi.status}`);
    // لا حجب زائد: أصل واجهة حقيقي (JS) يجب أن يعمل.
    const assetsDir = path.join(process.cwd(), 'dist', 'assets');
    const firstJs = existsSync(assetsDir) ? readdirSync(assetsDir).find((f) => f.endsWith('.js')) : undefined;
    if (firstJs) {
      const asset = await statusOf(`${BASE}/assets/${firstJs}`);
      check('control: real frontend JS asset still served', asset.status === 200 && /javascript/i.test(asset.contentType), `status=${asset.status} type=${asset.contentType} file=${firstJs}`);
    }
  } finally {
    server.kill('SIGKILL');
  }
}

run()
  .then(() => {
    console.log(`PASSED: ${passed} SEC-01 source-bundle exposure checks`);
    if (failures.length) {
      console.error('FAILURES:');
      for (const f of failures) console.error(`  - ${f}`);
      process.exit(1);
    }
  })
  .catch((e) => {
    console.error('SEC-01 test crashed:', e);
    process.exit(1);
  });
