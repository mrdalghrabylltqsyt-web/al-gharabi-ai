/**
 * اختبار دوام نتيجة التحقق الحي من Gemini.
 *
 * المشكلة: نتيجة `POST /api/ai/verify-provider` كانت في الذاكرة فقط، فتضيع بعد
 * restart/cold start ويظهر المزود «غير متحقَّق» رغم إثباته فعلاً — والتحقق يستهلك
 * طلباً من الحصة فلا يجوز إعادته بلا داعٍ.
 *
 * يثبت: (1) النتيجة المحفوظة تُسترجع عند الإقلاع وتظهر في /api/health،
 * (2) بنية الكود تحفظها في مفتاح التحكّم وتستدعي الحفظ في كل فرع نهائي،
 * (3) لا تسريب أي مفتاح/سرّ في الاستجابة.
 *
 * لا يلمس أي مزود ولا يستهلك حصة (لا يوجد GEMINI_API_KEY في الاختبار).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

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
const PORT = 7810 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-ai-verify-persist-'));

// نُحاكي عملية سابقة أنجزت تحققاً حقيقياً ثم أُعيد تشغيل الخادم: النتيجة في مفتاح التحكّم.
const SEEDED_MODEL = 'gemini-3.8-flash';
const SEEDED_AT = '2026-10-01T00:00:00.000Z';
writeFileSync(join(stateDir, '.gharabi-control.json'), JSON.stringify({
  aiLiveVerification: {
    state: 'ok',
    detail: 'تم إثبات الاتصال بالموديل الإنتاجي gemini-3.8-flash بطلب حقيقي واحد.',
    model: SEEDED_MODEL, at: SEEDED_AT, errorKind: null, hint: null,
  },
}, null, 2));

let proc: ChildProcess | null = null;
function startApp(): void {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    SESSION_SECRET: 'ai-verify-persist-secret-not-real',
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  delete env.GEMINI_API_KEY; delete env.DATABASE_URL;
  proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
}
async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function structureTests(): void {
  group('1) بنية: الحفظ والاسترجاع موجودان');
  const src = readFileSync(join(REPO_ROOT, 'server.ts'), 'utf8');
  check('مفتاح التحكّم يحمل aiLiveVerification', src.includes('aiLiveVerification: aiLiveVerificationState.snapshot()'));
  check('الاسترجاع في applyControlSnapshot', src.includes('aiLiveVerificationState.restore(control.aiLiveVerification)'));
  check('الترطيب بعد الجهوزية', src.includes('hydrateAiLiveVerificationFromDurable()') && /storageReady = true;[\s\S]{0,400}?hydrateAiLiveVerificationFromDurable\(\)/.test(src));
  const persists = (src.match(/persistAiLiveVerification\(\)/g) || []).length;
  check('الحفظ يُستدعى في كل فرع نهائي (>=5)', persists >= 5, `count=${persists}`);
  check('لا حفظ لـstack أو سرّ', !/persistAiLiveVerification\(\)[\s\S]{0,80}?process\.env\.GEMINI_API_KEY/.test(src));
}

async function integrationTests(): Promise<void> {
  startApp();
  try {
    group('2) تكامل: النتيجة المحفوظة تُسترجع وتظهر في /api/health');
    const up = await waitForHealth();
    check('الخادم يقلع', up);
    if (!up) return;
    const health = await (await fetch(`${BASE}/api/health`)).json();
    const ps = health?.geminiUsage?.providerState || {};
    check('providerState موجود', Boolean(health?.geminiUsage?.providerState));
    check('verifiedLive = true بعد إعادة التشغيل', ps.verifiedLive === true, JSON.stringify(ps));
    check('verifiedModel = الموديل المحفوظ', ps.verifiedModel === SEEDED_MODEL, String(ps.verifiedModel));
    check('verifiedAt = وقت التحقق المحفوظ', ps.verifiedAt === SEEDED_AT, String(ps.verifiedAt));
    check('verification = ok', ps.verification === 'ok', String(ps.verification));

    group('3) تكامل: بلا تسريب أي مفتاح/سرّ');
    const raw = JSON.stringify(health);
    check('لا GEMINI_API_KEY في الصحة', !/GEMINI_API_KEY\s*[:=]/i.test(raw));
    check('لا نمط مفتاح AIza', !/AIza[0-9A-Za-z_-]{10,}/.test(raw));
    check('لا حقل aiLiveVerification خامّاً منفصلاً', !('aiLiveVerification' in health));
  } finally {
    try { if (proc) { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1000)); if (!proc.killed) proc.kill('SIGKILL'); } } catch { /* تجاهل */ }
    rmSync(stateDir, { recursive: true, force: true });
  }
}

(async () => {
  structureTests();
  await integrationTests();
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} ai-verification-persistence checks`);
  }
})().catch((err) => { console.error('ai-verify-persist harness crashed:', err); process.exit(1); });
