/**
 * فحوص جدار حماية Gemini المجاني على **خادم حقيقي** (بلا مفتاح مزود).
 *
 * يثبت أن الحماية مركزية على مستوى المشروع فعلاً في المسارات الحقيقية:
 * - `/api/ai/firewall` للمالك فقط (401 بلا جلسة)، ويعلن `scope: project-wide`
 *   و`platformSpecificQuota: false`، ويسمّي الحد «حد الحماية المحلي للمشروع».
 * - `/api/readiness` يعرض كتلة `freeTierFirewall` بلا أي سرّ.
 * - العمليات الحتمية (الصحة/الجاهزية/المراقبة) وطلبات المحتوى بلا مزود لا
 *   تستهلك أي نداء مزود: `providerCallsToday = 0`.
 * - طلب محتوى واحد لعشر منصات يعيد تكييفاً حتمياً لكل المنصات العشر بلا أي
 *   نداء مزود إضافي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const PORT = 6450 + Math.floor(Math.random() * 120);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-firewall-'));
const SESSION_SECRET = 'gemini-firewall-test-secret-not-real';

const TEN_PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook', 'whatsapp', 'telegram', 'x', 'snapchat', 'threads', 'google_business'];

function startApp(): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE,
    STATE_DIR: stateDir, GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    // لا نضبط GEMINI_DAILY_LIMIT: نتحقق من الافتراضي الجديد (40) على خادم حقيقي.
    GEMINI_FREE_TIER_PROTECTION: 'true',
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function loginOwner(): Promise<Record<string, string>> {
  const login = await fetch(`${BASE}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  const body = await login.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}

async function stop(proc: ChildProcess): Promise<void> {
  try { proc.kill('SIGTERM'); } catch { /* تجاهل */ }
  await new Promise((r) => setTimeout(r, 900));
  try { proc.kill('SIGKILL'); } catch { /* تجاهل */ }
}

async function firewall(auth?: Record<string, string>) {
  const res = await fetch(`${BASE}/api/ai/firewall`, auth ? { headers: auth } : undefined);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function run(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  const app = startApp();
  try {
    const up = await waitForHealth();
    check('الخادم يقلع للاختبار', up, app.log().slice(0, 300));
    if (!up) throw new Error('الخادم لم يبدأ');

    // 1) الحماية على المسار: بلا جلسة = 401.
    const anon = await firewall();
    check('جدار الحماية يتطلب جلسة (401 بلا توكن)', anon.status === 401, `status=${anon.status}`);

    const auth = await loginOwner();

    // 2) المالك يرى التشخيص المركزي.
    const fw = await firewall(auth);
    check('المالك يقرأ تشخيص الجدار (200)', fw.status === 200 && fw.body.success === true, `status=${fw.status}`);
    check('النطاق مشروع كامل لا منصة', fw.body.scope === 'project-wide');
    check('لا حد منصة منفصل', fw.body.platformSpecificQuota === false);
    const f = fw.body.firewall || {};
    check('protectionEnabled معلن', f.protectionEnabled === true);
    check('الحد المحلي = 40 افتراضياً (رفع متحفظ)', f.localDailyLimit === 40, String(f.localDailyLimit));
    check('الحد مُسمّى «حد الحماية المحلي للمشروع»', f.limitLabelAr === 'حد الحماية المحلي للمشروع');
    check('التسمية تنفي حصة Google', !JSON.stringify(fw.body).includes('Google quota'));
    check('المنصات العشر كلها معروفة للتشخيص', TEN_PLATFORMS.every((p) => (fw.body.knownPlatforms || []).includes(p)));
    check('حدود الـprompt معلنة', fw.body.promptLimit?.maxPromptChars > 0 && fw.body.promptLimit?.maxOutputTokens > 0);

    // 3) لا تسريب أي سرّ في التشخيص.
    const fwText = JSON.stringify(fw.body);
    check('التشخيص بلا مفتاح أو سرّ', !/AIza|apiKey|GEMINI_API_KEY|secret|Bearer/i.test(fwText));

    // 4) العمليات الحتمية لا تستهلك أي نداء مزود.
    for (let i = 0; i < 30; i++) {
      await fetch(`${BASE}/api/health`);
      await fetch(`${BASE}/api/readiness`);
    }
    const afterDet = await firewall(auth);
    check('30 دورة صحة/جاهزية = 0 نداء مزود', afterDet.body.firewall.providerCallsToday === 0, String(afterDet.body.firewall.providerCallsToday));
    check('usedToday لم يزد بالعمليات الحتمية', afterDet.body.firewall.usedToday === 0);

    // 5) طلب محتوى واحد لعشر منصات: تكييف حتمي لكل المنصات، بلا مزود.
    const gen = await fetch(`${BASE}/api/ai/generate-content`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ platform: 'youtube', contentType: 'post', topic: 'عرض تقسيط عام', platforms: TEN_PLATFORMS }),
    });
    const genBody = await gen.json();
    check('توليد المحتوى ينجح بلا مزود (بديل حتمي)', gen.status === 200 && genBody.success === true && genBody.aiSource === 'fallback', `status=${gen.status}`);
    const adapted = genBody.adaptedVersions || {};
    check('تكييف حتمي لكل المنصات العشر', TEN_PLATFORMS.every((p) => typeof adapted[p] === 'string' && adapted[p].length > 0), Object.keys(adapted).join(','));
    const afterGen = await firewall(auth);
    check('طلب محتوى بلا مزود لا يستهلك حصة', afterGen.body.firewall.providerCallsToday === 0 && afterGen.body.firewall.usedToday === 0);

    // 6) /api/readiness يعرض كتلة الجدار بلا سرّ.
    const ready = await (await fetch(`${BASE}/api/readiness`)).json();
    const rf = ready.ai?.freeTierFirewall;
    check('الجاهزية تعرض freeTierFirewall', Boolean(rf) && rf.localDailyLimit === 40);
    check('جاهزية الجدار بلا سرّ', !/AIza|apiKey|GEMINI_API_KEY=/i.test(JSON.stringify(rf)));
    check('الجاهزية التطبيقية مستقلة عن المزود', ready.applicationReady === true && ready.ai.providerReady === false);

    // 7) المحرك لا يتجاوز الحارس: بلا مزود يبقى الحارس سليماً.
    check('الحارس لم يُستهلك بلا مزود', afterGen.body.firewall.providerConfigured === false);

    console.log(`\n${failures.length === 0 ? 'PASSED' : 'FAILED'}: ${passed} gemini firewall server checks${failures.length ? ` (${failures.length} failed)` : ''}`);
    if (failures.length) { for (const f2 of failures) console.error(`  ✗ ${f2}`); }
  } finally {
    await stop(app.proc);
    try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }
  if (failures.length) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
