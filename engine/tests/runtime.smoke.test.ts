/**
 * اختبار دخان للتشغيل الفعلي: يشغّل الخادم المبني ويفحص أن:
 * 1) الخادم يقلع ويستجيب للفحص الصحي.
 * 2) كل مسارات مدير السوشيال ميديا مركّبة ومحمية بالمصادقة (401 بدون جلسة).
 * 3) لا يوجد أي مسار AI يعيد 503 عند غياب مزود الذكاء الاصطناعي.
 * 4) حالة المزود تعلن موديلات GA حقيقية، وتميّز configured عن verified.
 * 5) الجاهزية التطبيقية منفصلة عن جاهزية مزود الذكاء الاصطناعي.
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

    // 3) حالة المزود: موديلات GA حقيقية، ولا موديل مُوقف، وبلا عداد وهمي.
    const models: string[] = health.geminiUsage?.modelCandidates || [];
    check('أسماء الموديلات حقيقية وغير مختلقة', models.length > 0 && models.every((m) => /^gemini-[0-9]/.test(m)), `models=${JSON.stringify(models)}`);
    // الموديلات يجب أن تكون من عائلة GA حديثة، والموديلات الموقوفة ممنوعة تماماً.
    check('موديل الإنتاج معرّف ومعلن', typeof health.geminiUsage?.modelPolicy?.productionModel === 'string' && health.geminiUsage.modelPolicy.productionModel.length > 0);
    check('موديل الإنتاج من عائلة GA الحديثة', /^gemini-3\.[5-9]-/.test(health.geminiUsage?.modelPolicy?.productionModel || ''), `model=${health.geminiUsage?.modelPolicy?.productionModel}`);
    check('لا موديل مُوقف في قائمة المرشحين', !models.some((m) => /^gemini-2\.0-|^gemini-1\.|^text-embedding-/.test(m)), `models=${JSON.stringify(models)}`);
    check('لا يوجد عداد وهمي 125/125', !JSON.stringify(health).includes('125/125'));
    check('الحماية المحلية معلنة كحد خادم لا حصة مزود', String(health.geminiUsage?.note || '').includes('ليست حصة مزود'));
    check('قاطع الدائرة معروض', typeof health.geminiUsage?.breaker?.open === 'boolean');
    check('مهلة المزود معلنة', Number(health.geminiUsage?.timeoutMs) > 0);

    // 3ب) حالة المزود تفرّق بين configured و verified بلا ادعاء جاهزية.
    const providerState = health.geminiUsage?.providerState || {};
    check('حالة المزود معلنة صراحةً', typeof providerState.configured === 'boolean');
    check('حالة التحقق الحي معلنة', ['not_attempted', 'ok', 'failed', 'skipped_no_key'].includes(String(providerState.verification)), `verification=${providerState.verification}`);
    check('لا ادعاء جاهزية بلا تحقق حي', providerState.verifiedLive === (providerState.verification === 'ok'));
    check('البديل الحتمي معلن كمتاح دائماً', providerState.fallbackAvailable === true);
    check('لا ادعاء verifiedLive دون مفتاح', providerState.keyPresent || providerState.verifiedLive !== true);
    check('حالة المزود لا تسرّب أي مفتاح', !/AIza|api[_-]?key=/i.test(JSON.stringify(providerState)));

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

    // 6) الجاهزية: تطبيقية منفصلة عن جاهزية المزود.
    const readiness = await (await fetch(`${BASE}/api/readiness`)).json();
    check('الجاهزية التطبيقية معلنة', readiness.success === true && readiness.ready === true && readiness.applicationReady === true);
    check('جاهزية المزود منفصلة عن جاهزية التطبيق', typeof readiness.ai?.providerReady === 'boolean');
    check('لا ادعاء جاهزية مزود بلا تحقق حي', readiness.ai.providerReady === (readiness.ai.verification === 'ok'));
    check('الجاهزية لا تسرّب أي مفتاح', !/AIza|api[_-]?key=/i.test(JSON.stringify(readiness)));

    // 7) مسار التحقق الحي محمي بالمصادقة ولا يعيد 503.
    const verify = await fetch(`${BASE}/api/ai/verify-provider`, { method: 'POST' });
    check('مسار التحقق الحي محمي بالمصادقة', verify.status === 401, `status=${verify.status}`);
    check('مسار التحقق لا يعيد 503', verify.status !== 503);
    check('مسارات التحقق لا تسرّب أي مفتاح', !/AIza|api[_-]?key=/i.test(await verify.text()));

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
