/**
 * اختبار حارس سلامة المحتوى على مسار تصنيف الرسائل (/api/ai/classify-message).
 *
 * سبب الوجود: كان المسار يعيد suggestedReply إلى الواجهة دون المرور الإلزامي
 * عبر حارس ادعاءات المعرض (analyzeBusinessClaims)، فيمكن أن يصل رد يحمل عرضاً
 * غير مسجّل إلى CustomerCenterView.
 *
 * يثبت الاختبار أمرين:
 *  1) منطق الحارس الصافي (buildSafeBusinessReply): نص غير آمن لا يُعرض أبداً،
 *     بل يُستبدل برد حتمي آمن أو يُحجب.
 *  2) المسار الفعلي على خادم حقيقي (بلا مزود): كل استجابة تحمل contentSafety،
 *     والرد المُعاد آمن بالبناء، والمصدر لا يُنسب إلى Gemini عند استخدام البديل.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { analyzeBusinessClaims, buildBusinessFacts, buildSafeBusinessReply } from '../social/contentSafety';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const PORT = 5920 + Math.floor(Math.random() * 120);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-classify-safety-'));
const SESSION_SECRET = 'classify-safety-test-secret-not-real';

function startApp(): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE,
    STATE_DIR: stateDir, GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
  };
  // بلا مزود: نريد البديل الحتمي بالضبط، وهو المسار الذي يجب أن يكون آمناً.
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

async function run(): Promise<void> {
  // ---------- 1) منطق الحارس الصافي (بلا شبكة) ----------
  const emptyFacts = buildBusinessFacts({ phones: [], urls: [], allowedPhrases: [] });

  const unsafe = buildSafeBusinessReply('عرض خاص: بدون دفعة أولى وخصم 50%', emptyFacts, () =>
    'أهلاً بك، يسعد فريق المعرض بتزويدك بالتفاصيل.');
  check('النص غير الآمن لا يُعرض كما هو', unsafe.text !== 'عرض خاص: بدون دفعة أولى وخصم 50%');
  check('النص غير الآمن يُعلن استبداله', unsafe.replaced === true);
  check('النص الأصلي غير الآمن مُعلن كمحجوب', unsafe.originalReport.safe === false && unsafe.originalReport.blocked.length > 0);
  check('النص البديل المعروض آمن', unsafe.report.safe === true && analyzeBusinessClaims(unsafe.text, emptyFacts).safe === true);

  const safe = buildSafeBusinessReply('أهلاً بك، شكراً لتواصلك معنا.', emptyFacts, () => 'بديل');
  check('النص الآمن يُعرض بلا استبدال', safe.replaced === false && safe.report.safe === true && safe.originalReport.safe === true);

  // إذا كان النص والبديل غير آمنين معاً، يظهر نص محايد لا يدّعي أي معلومة.
  const bothUnsafe = buildSafeBusinessReply('ضمان 5 سنوات', emptyFacts, () => 'خصم 25%');
  check('لا يُعرض أي ادعاء عندما يكون الأصل والبديل غير آمنين', analyzeBusinessClaims(bothUnsafe.text, emptyFacts).safe === true, bothUnsafe.text);
  check('حالة الأصل والبديل غير الآمنين تُعلن محجوبة', bothUnsafe.originalReport.safe === false);

  // ---------- 2) المسار الفعلي على خادم حقيقي ----------
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  const app = startApp();
  try {
    const up = await waitForHealth();
    check('الخادم يقلع للاختبار', up, app.log().slice(0, 300));
    if (!up) throw new Error('الخادم لم يبدأ');

    const login = await fetch(`${BASE}/api/auth/preview-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
    });
    const loginBody = await login.json();
    check('دخول المالك بجلسة صالحة', login.status === 200 && loginBody.user?.role === 'owner');
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${loginBody.token}` };

    const res = await fetch(`${BASE}/api/ai/classify-message`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ customerName: 'أحمد', message: 'بكم سعر الثلاجة بالتقسيط؟', channel: 'facebook' }),
    });
    const body = await res.json();
    check('تصنيف الرسالة يستجيب بنجاح', res.status === 200 && body.success === true, `status=${res.status}`);
    check('الاستجابة تحمل كتلة contentSafety', body.contentSafety && typeof body.contentSafety.safe === 'boolean');
    check('الرد المقترح المُعاد آمن', body.contentSafety.safe === true && typeof body.suggestedReply === 'string' && body.suggestedReply.length > 0);
    check('الرد المُعاد يمر حارس الادعاءات مستقلاً', analyzeBusinessClaims(String(body.suggestedReply || ''), emptyFacts).safe === true);
    check('المصدر لا يُنسب إلى Gemini عند البديل', body.aiSource !== 'provider' && body.generatedBy === 'local-deterministic-engine', `aiSource=${body.aiSource}`);
    check('سبب البديل معلن صراحةً', typeof body.fallbackReason === 'string' && body.fallbackReason.length > 0);
    check('قرار المراجعة البشرية معلن', typeof body.requiresHumanReview === 'boolean');
    check('لا سعر/رقم/رابط مُختلق في الرد', !/\d{4,}|https?:\/\/|\b07\d{8}\b/.test(String(body.suggestedReply || '')));

    console.log('\n' + '='.repeat(60));
    if (failures.length) {
      console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
      for (const f of failures) console.error(`  ✗ ${f}`);
      process.exitCode = 1;
    } else {
      console.log(`PASSED: ${passed} classify-message safety checks`);
    }
  } finally {
    try { app.proc.kill('SIGTERM'); } catch { /* تجاهل */ }
    await new Promise((r) => setTimeout(r, 700));
    try { app.proc.kill('SIGKILL'); } catch { /* تجاهل */ }
    rmSync(stateDir, { recursive: true, force: true });
  }
}

run().catch((err) => { console.error('Classify safety harness crashed:', err); process.exit(1); });
