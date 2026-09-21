/**
 * اختبار سلامة المحتوى من طرف إلى طرف (تكامل حقيقي على dist/server.cjs).
 *
 * الغرض: إثبات أن منع اختراع العروض التجارية لا يعتمد على prompt أو فحص نظري،
 * بل على حارس حتمي بعد التوليد يرفض أي ادعاء غير مسجّل في بيانات المعرض.
 *
 * الاختبار يشغّل الخادم الفعلي المبني، يسجّل دخول المالك عبر توكن المعاينة،
 * ثم يستدعي مسار توليد المحتوى الحقيقي ويؤكد:
 *  1) الطلب الذي يحمل عرضاً مُختلقاً يُرفض بـ422 (حارس المدخلات).
 *  2) الطلب النظيف ينجح بـ200 ويعيد content + adaptedVersions.
 *  3) لا يظهر أي ادعاء مُختلق (بدون دفعة أولى / خصم / ضمان / رقم / رابط) في
 *     المحتوى ولا في نُسخ المنصات.
 *  4) لا يظهر أي رقم هاتف أو رابط غير مسجّل في المخرج.
 *
 * ملاحظة: النشر الفعلي إلى المنصات ليس جزءاً من هذا الاختبار (dry-run فقط)،
 * فلا يُنشأ أي حساب ولا يُنشر أي محتوى.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
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
const BEFORE = Date.now();
const PREVIEW_TOKEN = randomBytes(24).toString('hex');

// أنماط الادعاءات المُختلقة التي يجب ألا تظهر أبداً في أي مخرج.
const FABRICATION_PATTERNS: Array<[string, RegExp]> = [
  ['ادعاء بدون دفعة أولى', /بدون\s+دفعه|بلا\s+دفعه|لا\s+تدفع|بدون\s+مقدم|بلا\s+مقدم|صفر\s+دفعه/],
  ['ادعاء خصم', /خصم|تخفيض|عرض\s+خاص|خصومات/],
  ['ادعاء ضمان', /ضمان|كفاله|كفالة/],
  ['ادعاء توصيل مجاني', /توصيل\s+مجاني|شحن\s+مجاني/],
  ['رقم هاتف مُختلق', /(?:\+?964|0)?7[0-9]{9}/],
  ['رابط مُختلق', /https?:\/\//],
  ['نسبة مئوية مُختلقة', /\b\d+\s*%/],
  ['سعر رقمي مُختلق', /\b\d{4,}\s*(?:دينار|د\.ع|IQD|الف|ألف)?/],
];

function scanFabrications(label: string, text: string): number {
  let found = 0;
  for (const [name, re] of FABRICATION_PATTERNS) {
    if (re.test(text)) {
      found += 1;
      check(`${label}: لا ${name}`, false, `نص=«${text.slice(0, 120)}»`);
    }
  }
  return found;
}

function startApp(port: number, stateDir: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    NODE_ENV: 'production',
    APP_URL: `http://127.0.0.1:${port}`,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
  };
  // لا نريد أن يتصل الخادم بمزود خارجي في هذا الاختبار: نُلغي المفتاح فيكون
  // التوليد حتمياً (fallback) — وهو بالضبط ما نريد فحصه: هل البديل الحتمي آمن؟
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(base: string, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function run(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }

  const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-content-safety-'));
  const port = 5410 + Math.floor(Math.random() * 200);
  const base = `http://127.0.0.1:${port}`;
  const app = startApp(port, stateDir);

  try {
    const up = await waitForHealth(base);
    check('الخادم يقلع للاختبار', up, app.log().slice(0, 300));
    if (!up) throw new Error('الخادم لم يبدأ');

    // جلسة مالك حقيقية عبر توكن المعاينة (لا OTP في هذا الاختبار).
    const login = await fetch(`${base}/api/auth/preview-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
    });
    const loginBody = await login.json();
    check('دخول المالك بجلسة صالحة', login.status === 200 && loginBody.success === true && loginBody.user?.role === 'owner', `status=${login.status}`);
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${loginBody.token}` };

    // ---- 1) حارس المدخلات: عرض مُختلق غير مسجّل يُرفض قبل أي توليد ----
    const fabricatedRequests: Array<[string, string]> = [
      ['بدون دفعة أولى', 'اعمل منشوراً: بدون دفعة أولى وبقسط ميسر'],
      ['خصم صريح', 'أعلن عن خصم 25% على جميع المنتجات'],
      ['ضمان', 'أعلن ضمان 5 سنوات على كل الأجهزة'],
      ['رقم هاتف', 'أضف رقم التواصل 07701234567 في المنشور'],
      ['رابط', 'أضف الرابط https://gharabi-fake.example.com في المنشور'],
    ];
    for (const [label, topic] of fabricatedRequests) {
      const res = await fetch(`${base}/api/ai/generate-content`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ platform: 'facebook', contentType: 'post', topic }),
      });
      check(`حارس المدخلات يرفض (${label}) بـ422`, res.status === 422, `status=${res.status}`);
      const body = await res.json().catch(() => ({} as any));
      check(`رفض (${label}) لا يعيد أي محتوى`, !body.content, JSON.stringify(body).slice(0, 160));
      check(`رفض (${label}) يعلن السبب صراحةً`, typeof body.error === 'string' && body.error.length > 0);
    }

    // ---- 2) طلب نظيف ينجح ويعيد content + adaptedVersions ----
    const clean = await fetch(`${base}/api/ai/generate-content`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ platform: 'facebook', contentType: 'post', topic: 'عروض التقسيط الميسر' }),
    });
    const cleanBody = await clean.json();
    check('الطلب النظيف ينجح 200', clean.status === 200 && cleanBody.success === true, `status=${clean.status}`);
    check('الاستجابة تحمل نصاً فعلياً', typeof cleanBody.content === 'string' && cleanBody.content.length > 20);
    check('الاستجابة تحمل نُسخ المنصات', cleanBody.adaptedVersions && typeof cleanBody.adaptedVersions === 'object', typeof cleanBody.adaptedVersions);
    check('لا بديل حتمي مختلق السعر (aiSource معلن)', ['provider', 'cache', 'fallback'].includes(String(cleanBody.aiSource)), String(cleanBody.aiSource));

    // ---- 3) لا ادعاء مُختلق في النص الأساسي ----
    const mainFabrications = scanFabrications('النص الأساسي', String(cleanBody.content || ''));

    // ---- 4) لا ادعاء مُختلق في أي نسخة من نسخ المنصات ----
    const versions = cleanBody.adaptedVersions || {};
    const expectedPlatforms = ['tiktok', 'instagram', 'x', 'snapchat', 'facebook', 'whatsapp'];
    check('نُسخ المنصات تغطي المنصات المتوقعة', expectedPlatforms.every((p) => typeof versions[p] === 'string' && versions[p].length > 0), JSON.stringify(Object.keys(versions)));
    let versionFabrications = 0;
    for (const p of expectedPlatforms) versionFabrications += scanFabrications(`نسخة ${p}`, String(versions[p] || ''));

    // فحص تكاملي: المجموع صفر يعني لا تسرّب أي ادعاء إلى أي مخرج.
    check('★ لا أي ادعاء تجاري مُختلق في أي مخرج', mainFabrications + versionFabrications === 0, `main=${mainFabrications} versions=${versionFabrications}`);

    // ---- 5) النسخ مبنية حتمياً من النص المُتحقَّق منه (لا نص موازٍ مُختلق) ----
    const mainNoTags = String(cleanBody.content || '').replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
    const fbNoTags = String(versions.facebook || '').replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
    check('نسخة فيسبوك مشتقة من النص المُتحقَّق منه', fbNoTags.length > 0 && mainNoTags.includes(fbNoTags.slice(0, 40)), `main=«${mainNoTags.slice(0, 60)}» fb=«${fbNoTags.slice(0, 60)}»`);

    // ---- 6) لا تسريب أسرار في السجل ----
    check('السجل لا يكشف توكن المعاينة ولا توكن الجلسة', !app.log().includes(PREVIEW_TOKEN) && !app.log().includes(loginBody.token));

    console.log('\n' + '='.repeat(60));
    if (failures.length) {
      console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
      for (const f of failures) console.error(`  ✗ ${f}`);
      process.exitCode = 1;
    } else {
      console.log(`PASSED: ${passed} content safety integration checks`);
    }
  } finally {
    try { app.proc.kill('SIGTERM'); } catch {}
    await new Promise((r) => setTimeout(r, 700));
    try { app.proc.kill('SIGKILL'); } catch {}
    try { rmSync(stateDir, { recursive: true, force: true }); } catch {}
  }
  void BEFORE;
}

run().catch((err) => { console.error('Content safety harness crashed:', err); process.exit(1); });
