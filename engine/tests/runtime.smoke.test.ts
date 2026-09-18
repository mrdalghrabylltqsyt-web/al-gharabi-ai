/**
 * اختبار دخان للتشغيل الفعلي: يشغّل الخادم المبني ويفحص أن:
 * 1) الخادم يقلع ويستجيب للفحص الصحي.
 * 2) كل مسارات مدير السوشيال ميديا مركّبة ومحمية بالمصادقة (401 بدون جلسة).
 * 3) لا يوجد أي مسار AI يعيد 503 عند غياب مزود الذكاء الاصطناعي.
 * 4) حالة المزود تعلن أسماء موديلات حقيقية ولا تعرض عداداً وهمياً.
 *
 * يُشغَّل على نسخة الإنتاج المبنية (dist/server.cjs) ليكون أقرب للواقع.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const PORT = 4733;
const BASE = `http://127.0.0.1:${PORT}`;

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

const SOCIAL_GET_ROUTES = [
  '/api/social/manager/status',
  '/api/social/manager/capabilities',
  '/api/social/manager/comments?platform=facebook',
  '/api/social/manager/publish/records',
  '/api/social/manager/analytics?platform=instagram',
  '/api/social/manager/brain/decision',
  '/api/social/manager/memory',
];

const SOCIAL_POST_ROUTES = [
  '/api/social/manager/comments/classify',
  '/api/social/manager/comments/reply',
  '/api/social/manager/comments/ingest',
  '/api/social/manager/publish/preflight',
  '/api/social/manager/publish/execute',
  '/api/social/manager/analytics/record',
];

const AI_ROUTES = [
  '/api/ai/generate-content',
  '/api/ai/classify-message',
  '/api/ai/agent-chat',
];

async function run(): Promise<void> {
  if (!existsSync('dist/server.cjs')) {
    console.error('dist/server.cjs غير موجود — شغّل npm run build أولاً.');
    process.exit(1);
  }

  const server: ChildProcess = spawn('node', ['dist/server.cjs'], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLog = '';
  server.stdout?.on('data', (d) => { serverLog += String(d); });
  server.stderr?.on('data', (d) => { serverLog += String(d); });

  try {
    const up = await waitForServer();
    check('الخادم يقلع ويستجيب للفحص الصحي', up, serverLog.slice(0, 300));
    if (!up) throw new Error('الخادم لم يبدأ');

    // 1) لا يعرض أي مفتاح أو سر في السجل.
    check('سجل التشغيل لا يحتوي أي مفتاح API', !/AIzaSy|GEMINI_API_KEY=/i.test(serverLog));

    // 2) الفحص الصحي.
    const health = await (await fetch(`${BASE}/api/health`)).json();
    check('الفحص الصحي يعيد ok', health.status === 'ok');
    check('الإصدار 13.0.0', health.version === '13.0.0');

    // 3) حالة المزود: أسماء موديلات حقيقية بلا عداد وهمي.
    const models: string[] = health.geminiUsage?.modelCandidates || [];
    check('أسماء الموديلات حقيقية وغير مختلقة', models.length > 0 && models.every((m) => /^gemini-[0-9]/.test(m)), `models=${JSON.stringify(models)}`);
    check('لا يوجد موديل وهمي من النسخ القديمة', !models.some((m) => /3\.[0-9]/.test(m)), `models=${JSON.stringify(models)}`);
    check('لا يوجد عداد وهمي 125/125', !JSON.stringify(health).includes('125/125'));
    check('الحماية المحلية معلنة كحد خادم لا حصة مزود', String(health.geminiUsage?.note || '').includes('ليست حصة مزود'));
    check('قاطع الدائرة معروض', typeof health.geminiUsage?.breaker?.open === 'boolean');
    check('مهلة المزود معلنة', Number(health.geminiUsage?.timeoutMs) > 0);

    // 4) كل مسارات السوشيال مركّبة ومحمية.
    for (const route of SOCIAL_GET_ROUTES) {
      const res = await fetch(`${BASE}${route}`);
      check(`المسار ${route} مركّب ومحمي بالمصادقة`, res.status === 401, `status=${res.status}`);
    }
    for (const route of SOCIAL_POST_ROUTES) {
      const res = await fetch(`${BASE}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      check(`المسار ${route} مركّب ومحمي بالمصادقة`, res.status === 401, `status=${res.status}`);
    }

    // 5) مسارات AI محمية ولا تعيد 503 بدون مزود.
    for (const route of AI_ROUTES) {
      const res = await fetch(`${BASE}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'اختبار', platform: 'facebook', contentType: 'post' }),
      });
      check(`مسار AI ${route} محمي ولا يعيد 503`, res.status === 401, `status=${res.status}`);
    }

    // 6) الجاهزية.
    const readiness = await (await fetch(`${BASE}/api/readiness`)).json();
    check('الجاهزية معلنة', readiness.success === true && readiness.ready === true);

    console.log('\n' + '='.repeat(60));
    if (failures.length) {
      console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
      for (const f of failures) console.error(`  ✗ ${f}`);
      process.exitCode = 1;
    } else {
      console.log(`PASSED: ${passed} runtime smoke checks`);
    }
  } finally {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (!server.killed) server.kill('SIGKILL');
  }
}

run().catch((err) => {
  console.error('Runtime harness crashed:', err);
  process.exit(1);
});
