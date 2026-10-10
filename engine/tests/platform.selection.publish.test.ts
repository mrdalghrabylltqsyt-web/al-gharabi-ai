/**
 * اختبار حتمية اختيار المنصات: الاختيار = مصدر الحقيقة الوحيد.
 *
 * يثبت (عبر خادم حقيقي، بلا أي مزود أو سرّ):
 *  1) اختيار Instagram وحده ⇒ الاستهداف على Instagram فقط (لا Threads ولا غيرها).
 *  2) اختيار Threads وحده ⇒ الاستهداف على Threads فقط (لا Instagram).
 *  3) اختيار Instagram + Threads معاً ⇒ المنصتان فقط بالضبط.
 *  4) بطاقات المنشورات مستقلة: كل منشور يُعيد مفاتيح نتائجه الخاصة فقط.
 *  5) إعادة القراءة (reload) لا تُضيف منصات غير مختارة ولا تُغيّر الاختيار بصمت.
 *  6) فشل منصة لا يُسجَّل نجاحاً لها ولا يخفي فشلها (حالة مستقلة لكل منصة).
 *
 * لا نشر حقيقي: لا منصة متصلة، فكل استهداف ينتهي بفشل صريح بلا معرّف مزود —
 * وهذا هو المتوقَّع، والمقصود إثبات أن *الاستهداف* حصري للاختيار.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
const APP_PORT = 7450 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'platform-selection-test-secret-not-real';
const TOKEN_KEY = randomBytes(32).toString('hex');
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-selection-'));

let proc: ChildProcess | null = null;
let log = '';

function startApp(): void {
  log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
  };
  delete env.GEMINI_API_KEY; delete env.DATABASE_URL;
  proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
}
async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
/** ينشئ منشوراً ويعتمده عبر المسار الرسمي ثم ينشره — يُعيد معرّفه ونتيجة النشر. */
async function createApprovePublish(auth: Record<string, string>, targetPlatforms: string[]): Promise<{ id: string; results: Record<string, any>; anyDelivered: boolean; requested: string[] }> {
  const created = await fetch(`${BASE}/api/workspace/content`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'اختبار اختيار', content: 'نص تسويقي مسموح بلا عرض تجاري.', targetPlatforms, status: 'review' }) });
  const createdBody = await created.json();
  const id = createdBody?.post?.id;
  const requested = createdBody?.post?.targetPlatforms;
  await fetch(`${BASE}/api/workspace/content/${id}/approve`, { method: 'POST', headers: auth, body: JSON.stringify({ note: 'اعتماد اختباري' }) });
  const pub = await fetch(`${BASE}/api/workspace/content/${id}/publish`, { method: 'POST', headers: auth, body: '{}' });
  const pubBody = await pub.json();
  return { id, results: pubBody.results || {}, anyDelivered: pubBody.anyDelivered === true, requested };
}

(async () => {
  startApp();
  const up = await waitForHealth();
  if (!up) { console.error('server did not start:\n' + log.slice(-3000)); process.exit(1); }
  const auth = await login();

  group('1) Instagram وحده ⇒ استهداف Instagram فقط (لا Threads)');
  const igOnly = await createApprovePublish(auth, ['instagram']);
  check('المنصات المحفوظة = [instagram] فقط', JSON.stringify(igOnly.requested) === JSON.stringify(['instagram']), JSON.stringify(igOnly.requested));
  check('نتيجة النشر على instagram فقط', Object.keys(igOnly.results).length === 1 && 'instagram' in igOnly.results, Object.keys(igOnly.results).join(','));
  check('لا threads في النتائج', !('threads' in igOnly.results), Object.keys(igOnly.results).join(','));

  group('2) Threads وحده ⇒ استهداف Threads فقط (لا Instagram)');
  const thOnly = await createApprovePublish(auth, ['threads']);
  check('المنصات المحفوظة = [threads] فقط', JSON.stringify(thOnly.requested) === JSON.stringify(['threads']), JSON.stringify(thOnly.requested));
  check('نتيجة النشر على threads فقط', Object.keys(thOnly.results).length === 1 && 'threads' in thOnly.results, Object.keys(thOnly.results).join(','));
  check('لا instagram في النتائج', !('instagram' in thOnly.results), Object.keys(thOnly.results).join(','));

  group('3) Instagram + Threads معاً ⇒ المنصتان فقط');
  const both = await createApprovePublish(auth, ['instagram', 'threads']);
  check('المنصتان بالضبط', JSON.stringify([...both.requested].sort()) === JSON.stringify(['instagram', 'threads']), JSON.stringify(both.requested));
  check('نتائج المنصتين فقط', Object.keys(both.results).sort().join(',') === 'instagram,threads', Object.keys(both.results).join(','));

  group('4) بطاقات المنشورات مستقلة (لكل منشور منصاته)');
  check('منشور Instagram لا يحمل نتيجة threads', !('threads' in igOnly.results) && igOnly.id !== thOnly.id);
  check('معرّفات المنشورات مختلفة', igOnly.id !== thOnly.id && igOnly.id !== both.id && thOnly.id !== both.id);

  group('5) إعادة القراءة لا تُضيف منصات غير مختارة');
  const snapshot = await (await fetch(`${BASE}/api/workspace/snapshot`, { headers: auth })).json();
  const posts: any[] = snapshot?.snapshot?.posts || [];
  const reloadedIg = posts.find((p: any) => p.id === igOnly.id);
  check('منشور Instagram بعد reload ما زال [instagram]', JSON.stringify(reloadedIg?.targetPlatforms) === JSON.stringify(['instagram']), JSON.stringify(reloadedIg?.targetPlatforms));
  const reloadedTh = posts.find((p: any) => p.id === thOnly.id);
  check('منشور Threads بعد reload ما زال [threads]', JSON.stringify(reloadedTh?.targetPlatforms) === JSON.stringify(['threads']), JSON.stringify(reloadedTh?.targetPlatforms));

  group('6) فشل منصة لا يُسجَّل نجاحاً ولا يخفى');
  for (const [name, r] of Object.entries(igOnly.results)) {
    check(`${name}: لا معرّف مزود مختلق (لا نشر حقيقي بلا اتصال)`, (r as any).providerPostId === null, JSON.stringify(r).slice(0, 160));
    check(`${name}: فشل بسبب صريح (لا نجاح وهمي)`, (r as any).state !== 'published' || Boolean((r as any).providerPostId), JSON.stringify(r).slice(0, 160));
  }
  check('لا تسليم إجمالي بلا أي منصة متصلة', igOnly.anyDelivered === false && thOnly.anyDelivered === false && both.anyDelivered === false);

  // إغلاق
  try { proc?.kill('SIGTERM'); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 1500));
  try { proc?.kill('SIGKILL'); } catch { /* ignore */ }
  try { rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ }

  console.log('\n' + '='.repeat(60));
  if (failures.length === 0) { console.log(`PASSED: ${passed} platform-selection publish checks`); process.exit(0); }
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`); failures.forEach((f) => console.error(' - ' + f)); process.exit(1);
})();
