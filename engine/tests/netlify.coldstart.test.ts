/**
 * اختبار حقيقي لسلوك دالة Netlify عبر عمليات منفصلة (cold start فعلي).
 *
 * يشغّل حزمة الدالة الفعلية (netlify/functions/api.ts مُجمّعة كما يفعل Netlify)
 * في عمليات Node منفصلة تماماً — كل استدعاء في عملية جديدة، تماماً كما تفعل
 * Netlify Functions. يثبت أن الجلسة تبقى صالحة عبر العمليات وإعادة التشغيل
 * بلا أي ذاكرة مشتركة، وأن الإبطال يسري عبر العمليات، وأن التوكنات لا تُسجَّل.
 *
 * لا يستخدم أي مفتاح حقيقي: SESSION_SECRET وGHARABI_PREVIEW_TOKEN قيم اختبار.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const TOKEN = crypto.randomBytes(24).toString('hex');
const SECRET = crypto.randomBytes(32).toString('hex');
const OTHER_SECRET = crypto.randomBytes(32).toString('hex');
const OWNER = 'owner-coldstart@example.invalid';

const workDir = mkdtempSync(join(tmpdir(), 'netlify-cold-'));
const bundle = join(workDir, 'api.cjs');
const stateDir = join(workDir, 'state');
const roStateDir = join(workDir, 'ro-state');

// العامل: يُحمّل الحزمة في عملية جديدة ويطبع JSON فقط. يُحاكي حدث Netlify.
const worker = join(workDir, 'worker.cjs');
writeFileSync(
  worker,
  `const path = require('path');
(async () => {
  const [, , bundle, dir, secret, token, owner, action, ...args] = process.argv;
  process.env.NETLIFY = 'true';
  process.env.NODE_ENV = 'production';
  process.env.SESSION_SECRET = secret;
  process.env.GHARABI_PREVIEW_TOKEN = token;
  process.env.OWNER_EMAIL = owner;
  process.env.STATE_DIR = dir;
  delete process.env.PLATFORM_TOKEN_ENCRYPTION_KEY;
  const handler = require(path.resolve(bundle)).handler;
  const ev = (p, method, body, query, auth) => ({
    path: p, httpMethod: method || 'GET',
    headers: Object.assign({ 'content-type': 'application/json', host: 'h' }, auth ? { authorization: 'Bearer ' + auth } : {}),
    multiValueHeaders: {}, queryStringParameters: query || null, multiValueQueryStringParameters: null,
    body: body ? JSON.stringify(body) : null, isBase64Encoded: false,
    rawUrl: 'https://h' + p, rawPath: p,
  });
  const call = async (...a) => { const r = await handler(ev(...a), {}); let j = null; try { j = JSON.parse(r.body); } catch {} return { status: r.statusCode, json: j }; };
  let out;
  if (action === 'login') out = await call('/api/auth/preview-login', 'GET', null, { token });
  else if (action === 'login-post') out = await call('/api/auth/preview-login', 'POST', { token });
  else if (action === 'me') out = await call('/api/auth/me', 'GET', null, null, args[0]);
  else if (action === 'users') out = await call('/api/users', 'GET', null, null, args[0]);
  else if (action === 'logout') out = await call('/api/auth/logout', 'POST', {}, null, args[0]);
  else if (action === 'verify') out = await call('/api/auth/verify-challenge', 'POST', { email: owner, code: args[0] });
  else if (action === 'unknown-api') out = await call('/api/definitely-not-a-route', 'GET');
  else out = { status: 0, json: { error: 'unknown action' } };
  // يُكتب الناتج إلى ملف كي لا تختلط الاستجابة (التي تحوي التوكن مشروعاً للعميل)
  // مع سجلات الخادم عند فحص التسريب.
  require('fs').writeFileSync(args[args.length - 1], JSON.stringify(out));
})().catch((e) => { try { require('fs').writeFileSync(process.argv[process.argv.length - 1], JSON.stringify({ status: -1, json: { crash: String(e) } })); } catch {} });`,
);

// جلسة تُحسب بنفس اشتقاق الخادم لاختبار مسار OTP بلا بريد حقيقي.
function otpCodeFor(email: string, secret: string): string {
  const buf = crypto.createHash('sha256').update(`gharabi-session:${secret}`).digest();
  const window = Math.floor(Date.now() / (10 * 60 * 1000));
  for (const w of [window, window - 1]) {
    const digest = crypto.createHmac('sha256', buf).update(`gharabi-otp:${email.toLowerCase().trim()}:${w}`).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
    return (binary % 1_000_000).toString().padStart(6, '0');
  }
  return '000000';
}

let combinedLog = '';
const outFile = join(workDir, 'out.json');
function cold(dir: string, secret: string, action: string, ...args: string[]): { status: number; json: any } {
  writeFileSync(outFile, '{}');
  const res = spawnSync(
    process.execPath,
    [worker, bundle, dir, secret, TOKEN, OWNER, action, ...args, outFile],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 },
  );
  // سجلات الخادم فقط (stdout/stderr) — لا استجابة العميل التي تحوي التوكن مشروعاً.
  combinedLog += String(res.stdout || '') + String(res.stderr || '');
  try {
    return JSON.parse(readFileSync(outFile, 'utf8'));
  } catch {
    return { status: -1, json: { raw: String(res.stderr || res.stdout || '').slice(0, 200) } };
  }
}

try {
  // 1) التجميع كما يفعل Netlify.
  let bundleOk = true;
  let bundleErr = '';
  try {
    execFileSync('npx', ['esbuild', 'netlify/functions/api.ts', '--bundle', '--platform=node', '--target=node20', '--format=cjs', `--outfile=${bundle}`, '--log-level=warning'], { stdio: 'pipe', timeout: 180_000 });
  } catch (e: any) {
    bundleOk = false;
    bundleErr = String(e?.stderr || e?.message || e).slice(0, 300);
  }
  check('حزمة الدالة تُبنى بنجاح', bundleOk && existsSync(bundle), bundleErr);
  if (!bundleOk || !existsSync(bundle)) throw new Error('توقف: فشل التجميع');

  execFileSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(stateDir)},{recursive:true})`]);

  // 2) login في عملية (cold start #1).
  const login = cold(stateDir, SECRET, 'login');
  check('عملية جديدة: تبادل توكن المعاينة (GET) => 200', login.status === 200 && login.json?.success === true, `status=${login.status}`);
  const session: string = login.json?.token || '';
  check('العملية تُعيد توكن جلسة حقيقي وليس توكن المعاينة', session.length >= 32 && session !== TOKEN);
  check('دور الجلسة مالك', login.json?.user?.role === 'owner');

  // 3) التحقق من نفس الجلسة في عملية منفصلة تماماً (cold start #2).
  const me = cold(stateDir, SECRET, 'me', session);
  check('عملية منفصلة: /api/auth/me بالجلسة => 200', me.status === 200, `status=${me.status}`);
  const users = cold(stateDir, SECRET, 'users', session);
  check('عملية منفصلة: مسار owner-only /api/users => 200', users.status === 200, `status=${users.status}`);

  // 4) OTP عبر عملية منفصلة: الرمز مشتق رياضياً فلا يحتاج ذاكرة مشتركة.
  const code = otpCodeFor(OWNER, SECRET);
  const verify = cold(stateDir, SECRET, 'verify', code);
  check('عملية منفصلة: التحقق من OTP => 200', verify.status === 200 && verify.json?.success === true, `status=${verify.status}`);
  const otpSession: string = verify.json?.token || '';
  check('جلسة OTP صالحة في عملية أخرى', cold(stateDir, SECRET, 'me', otpSession).status === 200);

  // 5) إعادة التشغيل/البدء البارد مع مجلد حالة فارغ جديد: الجلسة تبقى (stateless).
  const freshDir = join(workDir, 'fresh-state');
  execFileSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(freshDir)},{recursive:true})`]);
  check('بدء بارد بمجلد حالة فارغ: الجلسة ما زالت صالحة', cold(freshDir, SECRET, 'me', session).status === 200);

  // 6) جلسة صادرة قبل «إعادة النشر» تبقى صالحة بعدها (نفس السر، عملية جديدة).
  check('الجلسة تنجو من إعادة التشغيل/النشر', cold(stateDir, SECRET, 'me', session).status === 200);

  // 7) سرّ مختلف (كما لو ضاع SESSION_SECRET) => رفض صريح 401 لا خطأ 5xx.
  const wrongSecret = cold(stateDir, OTHER_SECRET, 'me', session);
  check('سرّ مختلف: الجلسة تُرفض 401 صراحةً', wrongSecret.status === 401, `status=${wrongSecret.status}`);

  // 8) جلسة غير صالحة/مفقودة.
  check('جلسة مشوّهة => 401', cold(stateDir, SECRET, 'me', 'not.a.token').status === 401);
  check('بلا جلسة => 401', cold(stateDir, SECRET, 'me', '').status === 401);
  check('مسار API غير معروف => 404 JSON (لا HTML)', cold(stateDir, SECRET, 'unknown-api').status === 404);

  // 9) الإبطال عبر العمليات: logout في عملية يسري في عملية أخرى.
  cold(stateDir, SECRET, 'logout', session);
  check('الخروج في عملية يسري في عملية أخرى => 401', cold(stateDir, SECRET, 'me', session).status === 401);

  // 10) الجلسة لا تعتمد على الكتابة على القرص: مجلد حالة للقراءة فقط.
  execFileSync(process.execPath, ['-e', `const fs=require('fs');fs.mkdirSync(${JSON.stringify(roStateDir)},{recursive:true});fs.chmodSync(${JSON.stringify(roStateDir)},0o555);`]);
  const roLogin = cold(roStateDir, SECRET, 'login');
  const roSession: string = roLogin.json?.token || '';
  check('STATE_DIR للقراءة فقط: تبادل المعاينة => 200', roLogin.status === 200, `status=${roLogin.status}`);
  check('STATE_DIR للقراءة فقط: الجلسة تعمل في عملية أخرى', cold(roStateDir, SECRET, 'me', roSession).status === 200);

  // 11) لا تسريب لأي توكن في مخرجات العمليات.
  check('لا يظهر توكن المعاينة في أي مخرجات', !combinedLog.includes(TOKEN));
  check('لا يظهر أي توكن جلسة في المخرجات', !combinedLog.includes(session) && !combinedLog.includes(otpSession));

  // 12) التحقق من تهيئة Netlify.
  const toml = readFileSync('netlify.toml', 'utf8');
  check('netlify.toml يعيد كتابة /api/* للدالة بحالة 200', /from\s*=\s*"\/api\/\*"/.test(toml) && /status\s*=\s*200/.test(toml));
  check('netlify.toml لا يحتوي أي سر', !/AIzaSy|re_[A-Za-z0-9]|sk-[A-Za-z0-9]/.test(toml));
} finally {
  try {
    execFileSync(process.execPath, ['-e', `try{require('fs').chmodSync(${JSON.stringify(roStateDir)},0o755)}catch{}`]);
  } catch { /* تجاهل */ }
  try { rmSync(workDir, { recursive: true, force: true }); } catch { /* تجاهل */ }
}

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} netlify cold-start checks`);
}