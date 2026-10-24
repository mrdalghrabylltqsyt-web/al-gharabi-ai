/**
 * اختبار تكاملي (خادم حقيقي + خادم Graph وهمي) لإصلاح 2026-10-20:
 *  - عند ضغط استهلاك critical (96%): دورات الاستقبال الخفيفة (Meta) **تعمل** وتُحدّث
 *    lastPollAt — لا تُؤجَّل (كانت تُوقف ~32 ساعة).
 *  - الأعمال الثقيلة (العقل التجاري/وقت تشغيل العقل) تُؤجَّل، وتظهر deferred في الحالة.
 *  - /api/health لا تعرض status=healthy وهي مؤجَّلة/فائتة، ويعرض سبب التأجيل.
 *  - عند usedPercent < 80: لا تغيير في السلوك (لا deferred).
 *
 * لا يلمس أي مزود Meta حقيقي ولا يستهلك حصة، ولا يستخدم أي سرّ واقعي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createFacebookMock, startFacebookMockServer } from './helpers/facebookMock';
import { FREE_TIER_QUOTAS, RENDER_RECOVERY_CENTER_ALLOWANCE_HOURS } from '../ops/freeTierUsage';
import { reserveFreePort } from './helpers/freePort';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const APP_PORT = await reserveFreePort();
const BASE = `http://127.0.0.1:${APP_PORT}`;
const FB_PORT = await reserveFreePort();
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'usage-pressure-test-secret-not-real';
const FB_APP_SECRET = 'fb_test_app_secret_not_real_1234567890';
const FB_VERIFY_TOKEN = 'fb_test_verify_token_not_real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-usage-pressure-'));

const ownerUser = { id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() };

/**
 * يزرع مؤشّر ساعات تشغيل Render بقيمة تُنتج النسبة المطلوبة (الأداة الوحيدة
 * المتاحة لرفع الضغط دون شبكة/سرّ): المحتسَب الحارس = المقيس + هامش مركز
 * الاستعادة. لعتبة 96%: نضبط الساعات بحيث (hours + 60)/750 ≈ 0.96.
 */
function seedUsageIndicators(dir: string, hoursThisMonth: number): void {
  writeFileSync(join(dir, '.gharabi-free-tier-usage.json'), JSON.stringify({
    month: new Date().toISOString().slice(0, 7),
    egressBytesMonth: 0,
    egressBytesSinceBoot: 0,
    updatedAt: new Date().toISOString(),
    renderUptime: { month: new Date().toISOString().slice(0, 7), hoursThisMonth, lastAccruedAt: new Date().toISOString(), firstSeenAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  }), 'utf8');
}

function startApp(fbBase: string, extraEnv: Record<string, string> = {}, dir: string = stateDir): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: dir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    FACEBOOK_GRAPH_API_BASE: fbBase,
    FACEBOOK_DIALOG_BASE: fbBase,
    FACEBOOK_OAUTH_CLIENT_ID: '145634995501895',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'test-fb-client-secret',
    FACEBOOK_APP_SECRET: FB_APP_SECRET,
    FACEBOOK_VERIFY_TOKEN: FB_VERIFY_TOKEN,
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    ...extraEnv,
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  delete env.NEON_API_KEY;
  delete env.NEON_PROJECT_ID;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(timeoutMs = 180_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function stop(proc: ChildProcess): Promise<void> {
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  if (!proc.killed) proc.kill('SIGKILL');
}
async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}

async function run(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  const criticalHours = Math.ceil(FREE_TIER_QUOTAS.renderWorkspaceMonthlyHours * 0.96) - RENDER_RECOVERY_CENTER_ALLOWANCE_HOURS;
  const mock = await startFacebookMockServer(FB_PORT, createFacebookMock({
    feedPosts: [{ id: 'POST1', comments: [
      { id: 'C_USER', message: 'عاشت إيدكم على الخدمة', from: { id: 'U1', name: 'أحمد' }, created_time: '2026-01-01T00:00:00+0000' },
    ] }],
  }));

  try {
    // ═══════════════════════════════════════════════════════════════════
    // السيناريو أ: ضغط critical (96%) — الاستقبال الخفيف يعمل، الثقيل يُؤجَّل.
    // ═══════════════════════════════════════════════════════════════════
    seedUsageIndicators(stateDir, criticalHours);
    writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
      schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser],
      revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
      workspace: { showroom: { name: 'معرض الغرابي' }, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [] },
    }), 'utf8');

    let app = startApp(mock.base);
    const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
    try {
      check('الخادم يقلع تحت ضغط critical', await waitForHealth(), app.log().slice(0, 400));
      Object.assign(auth, await login());

      group('1) ضغط critical: الحالة تعكس level=critical (لا صحة كاذبة)');
      const health1 = await (await fetch(`${BASE}/api/health`)).json();
      const pressure = health1?.freeTierUsage?.pressure;
      check('pressure.level = critical عند 96%', pressure?.level === 'critical', JSON.stringify(pressure));
      check('pressure.deferIngest = false (الاستقبال لا يُؤجَّل)', pressure?.deferIngest === false, String(pressure?.deferIngest));
      check('pressure.deferNonCritical = true (الثقيل يُؤجَّل)', pressure?.deferNonCritical === true, String(pressure?.deferNonCritical));
      check('freeTierUsage يحمل كتلة neonActual (قياس فعلي/تقدير معلن)', health1?.freeTierUsage?.neonActual !== undefined);
      check('مؤشّر النقل معلن basis', typeof health1?.freeTierUsage?.neonTransfer?.basis === 'string', String(health1?.freeTierUsage?.neonTransfer?.basis));

      group('2) ربط Facebook (خادم Graph وهمي) ثم دورة استقبال خفيفة');
      const startRes = await (await fetch(`${BASE}/api/platforms/facebook/oauth/start`, { headers: auth })).json();
      const state = new URL(startRes.authorizationUrl).searchParams.get('state') || '';
      const cbRes = await fetch(`${BASE}/api/platforms/facebook/oauth/callback?state=${encodeURIComponent(state)}&code=TESTCODE`);
      check('callback ينجح', cbRes.status === 200, `status=${cbRes.status}`);

      // دورة استقبال Meta الخفيفة **يدوياً** (المسار يستدعي الدورة مباشرة، لا حارس ضغط).
      const pollRes = await fetch(`${BASE}/api/agent/meta/watcher/poll`, { method: 'POST', headers: auth, body: '{}' });
      check('دورة Meta الخفيفة تُنفَّذ عند critical (لا 4xx/5xx)', pollRes.status === 200, `status=${pollRes.status}`);

      group('3) /api/health: Meta تعمل فعلاً (لا تأجيل) والحالة صادقة');
      const health2 = await (await fetch(`${BASE}/api/health`)).json();
      const meta = health2?.metaPolling;
      check('metaPolling.deferred = false (الاستقبال لم يُؤجَّل)', meta?.deferred === false, JSON.stringify(meta));
      check('metaPolling.lastPollAt محدَّث فعلاً بعد الدورة', Boolean(meta?.lastPollAt), String(meta?.lastPollAt));
      // بما أن الدورة نُفِّذت فعلاً فـhealthy صادقة (ليست صحّة كاذبة) — الهدف أن
      // الاستقبال لا يتوقّف عند critical.
      check('metaPolling.status = healthy لأن الدورة نُفِّذت فعلاً', meta?.status === 'healthy', String(meta?.status));

      group('4) cycleHealth: الأعمال الثقيلة تُؤجَّل وتُعلَن (لا تخطٍّ صامت)');
      const cycle = health2?.cycleHealth;
      check('cycleHealth موجود', cycle !== undefined);
      check('cycleHealth يعلن أسماء الدورات النشطة', Array.isArray(cycle?.staleCycles));
      check('cycleHealth.auxiliaryDeferrals مصفوفة', Array.isArray(cycle?.auxiliaryDeferrals));

      // العقل التجاري (عمل ثقيل): دورة يدوية عبر مسار المالك تُنفَّذ مباشرة (المسار
      // اليدوي لا يمر بحارس الضغط)، لكن دورة الجدولة تُؤجَّل — نتحقق من إعلان
      // كتلة التأجيل في الحالة، ونُعلن حالة العقل.
      const commRun = await fetch(`${BASE}/api/agent/commercial/run`, { method: 'POST', headers: auth, body: '{}' });
      check('مسار العقل التجاري يعمل', commRun.status === 200, `status=${commRun.status}`);
      const health3 = await (await fetch(`${BASE}/api/health`)).json();
      const comm = health3?.commercialBrain;
      check('commercialBrain.deferral معلن (منطقي/سبب/وقت)', comm?.deferral !== undefined && typeof comm?.deferral?.deferred === 'boolean', JSON.stringify(comm?.deferral));
      check('commercialBrain.enabled معلن', typeof comm?.enabled === 'boolean');

      app.proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 1500));
      if (!app.proc.killed) app.proc.kill('SIGKILL');
    } finally {
      await stop(app.proc);
    }

    // ═══════════════════════════════════════════════════════════════════
    // السيناريو ب: usedPercent < 80 — لا تغيير في السلوك (لا ضغط).
    // ═══════════════════════════════════════════════════════════════════
    const normalDir = mkdtempSync(join(tmpdir(), 'gharabi-usage-normal-'));
    seedUsageIndicators(normalDir, 100); // (100+60)/750 ≈ 21% < 80
    writeFileSync(join(normalDir, '.gharabi-state.json'), JSON.stringify({
      schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser],
      revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
      workspace: { showroom: { name: 'معرض الغرابي' }, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [] },
    }), 'utf8');
    const normalApp = startApp(mock.base, {}, normalDir);
    try {
      check('الخادم يقلع تحت ضغط عادي', await waitForHealth(), normalApp.log().slice(0, 400));
      await login();
      group('5) ضغط < 80%: لا تأجيل، الحالة طبيعية');
      const h = await (await fetch(`${BASE}/api/health`)).json();
      check('pressure.level = normal', h?.freeTierUsage?.pressure?.level === 'normal', JSON.stringify(h?.freeTierUsage?.pressure));
      check('pressure.deferNonCritical = false', h?.freeTierUsage?.pressure?.deferNonCritical === false);
      check('pressure.deferIngest = false', h?.freeTierUsage?.pressure?.deferIngest === false);
      check('cycleHealth.healthy صحيح (لا دورات فائتة في إقلاع نظيف)', h?.cycleHealth?.healthy === true, JSON.stringify(h?.cycleHealth));
    } finally {
      await stop(normalApp.proc);
      rmSync(normalDir, { recursive: true, force: true });
    }
    // ═══════════════════════════════════════════════════════════════════
    // السيناريو ج: حالة تأجيل مزروعة — /api/health تُعلن deferred لا healthy.
    // ═══════════════════════════════════════════════════════════════════
    const deferredDir = mkdtempSync(join(tmpdir(), 'gharabi-usage-deferred-'));
    seedUsageIndicators(deferredDir, criticalHours);
    writeFileSync(join(deferredDir, '.gharabi-state.json'), JSON.stringify({
      schemaVersion: 16, savedAt: new Date().toISOString(), users: [ownerUser],
      revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
      workspace: { showroom: { name: 'معرض الغرابي' }, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [] },
    }), 'utf8');
    // نزرع حالة مراقب Meta مؤجَّلة وآخر دورة قديمة (32 ساعة) ⇒ stale أيضاً.
    writeFileSync(join(deferredDir, 'metaPolling.json'), JSON.stringify({
      controls: { enabled: true, paused: false, autoReply: false, humanReviewMode: false, cadenceMinutes: 5 },
      processed: [], lastPollAt: new Date(Date.now() - 32 * 3600_000).toISOString(),
      lastError: null, consecutiveErrors: 0, pollCount: 12, lastScanned: 0,
      platformStats: { facebook: { postsScanned: 0, commentsVisible: 0, commentsTotalReported: 0, lastIngestAt: null, callsPerCycle: 0 }, instagram: { postsScanned: 0, commentsVisible: 0, commentsTotalReported: 0, lastIngestAt: null, callsPerCycle: 0 } },
      deferral: { deferred: true, deferredReason: 'تأجيل دورة استقبال Meta بسبب ضغط الاستهلاك.', lastDeferredAt: new Date().toISOString() },
    }), 'utf8');
    const deferredApp = startApp(mock.base, {}, deferredDir);
    try {
      check('الخادم يقلع بحالة تأجيل مزروعة', await waitForHealth(), deferredApp.log().slice(0, 400));
      await login();
      group('6) حالة مؤجَّلة: /api/health لا تُعلن healthy وتُظهر السبب');
      const h = await (await fetch(`${BASE}/api/health`)).json();
      const meta = h?.metaPolling;
      check('metaPolling.deferred = true', meta?.deferred === true, JSON.stringify(meta));
      check('metaPolling.deferredReason معلن', typeof meta?.deferredReason === 'string' && meta.deferredReason.length > 0, String(meta?.deferredReason));
      check('metaPolling.lastDeferredAt معلن', Boolean(meta?.lastDeferredAt), String(meta?.lastDeferredAt));
      check('metaPolling.status = deferred (ليست healthy)', meta?.status === 'deferred', String(meta?.status));
      check('metaPolling.stale = true (32 ساعة بلا دورة)', meta?.stale === true, String(meta?.stale));
      // cycleHealth يعلن الدورة الفائتة صراحةً (لا توقّف صامت).
      const cycle = h?.cycleHealth;
      check('cycleHealth.healthy = false عند وجود دورة فائتة', cycle?.healthy === false, JSON.stringify(cycle));
      check('cycleHealth يذكر metaPolling ضمن الدورات الفائتة', Array.isArray(cycle?.staleCycles) && cycle.staleCycles.some((c: any) => c.name === 'metaPolling'), JSON.stringify(cycle?.staleCycles));
    } finally {
      await stop(deferredApp.proc);
      rmSync(deferredDir, { recursive: true, force: true });
    }

  } finally {
    rmSync(stateDir, { recursive: true, force: true });
    await mock.stop().catch(() => { /* تجاهل */ });
  }

  console.log(`\n${'='.repeat(60)}`);
  if (failures.length === 0) {
    console.log(`PASSED: ${passed} usage-pressure-deferral checks`);
  } else {
    console.log(`FAILED: ${failures.length} of ${passed + failures.length}`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  }
}

void run();
