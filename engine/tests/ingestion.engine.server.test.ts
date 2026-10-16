/**
 * اختبار محرّك الاستقبال الموحّد على خادم حقيقي (تكامل).
 *
 * يثبت الدورة الكاملة عبر HTTP:
 *   ingest (تعليقات من 4 منصات) → تصنيف موحّد → محرّك الاستقبال → ملخّص/صحة →
 *   تعلّم مُدرَج في ذاكرة العقل القائمة → ثبات بعد إعادة التشغيل.
 *
 * ويؤكد القواعد الملزمة:
 * - النقطتان العامتان /api/health و/api/readiness لا تحملان أي اسم حساب/نص تعليق/
 *   نص رد (canary مبثوث في السجلات لا يظهر إطلاقاً).
 * - مسارا /api/social/manager/ingestion و/persona محميّان (401 بلا جلسة).
 * - تعلّم idempotent (لا تكرار) وبلا أي محتوى عميل.
 *
 * بلا مزود ولا حصة ولا سرّ.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
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
const PORT = 6360 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'ingestion-engine-test-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-ingestion-'));

// قيم canary: تُبثّ في نص التعليق/اسم الحساب — يجب ألا تظهر في الصحة/الجاهزية/التعلّم.
const CANARY_AUTHOR = 'ING_CANARY_AUTHOR_ZZZ';
const CANARY_TEXT = 'ING_CANARY_COMMENT_TEXT_ZZZ';
const CANARY_REPLY = 'ING_CANARY_REPLY_TEXT_ZZZ';

let proc: ChildProcess | null = null;
let log = '';
function startApp(): void {
  log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE,
    STATE_DIR: stateDir, GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
}
async function waitForHealth(timeoutMs = 180_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function loginOwner(): Promise<Record<string, string>> {
  const login = await fetch(`${BASE}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) });
  const body = await login.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
async function stop(): Promise<void> {
  if (!proc) return;
  try { proc.kill('SIGTERM'); } catch { /* تجاهل */ }
  await new Promise((r) => setTimeout(r, 1000));
  try { proc.kill('SIGKILL'); } catch { /* تجاهل */ }
}
function flatten(value: unknown, out: string[] = []): string[] {
  if (value == null) return out;
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { for (const v of value) flatten(v, out); return out; }
  if (typeof value === 'object') { for (const v of Object.values(value as Record<string, unknown>)) flatten(v, out); return out; }
  return out;
}
function hasLeak(obj: unknown): boolean {
  const joined = flatten(obj).join('\n');
  return joined.includes(CANARY_AUTHOR) || joined.includes(CANARY_TEXT) || joined.includes(CANARY_REPLY);
}

async function main(): Promise<void> {
  startApp();
  const up = await waitForHealth();
  if (!up) { console.error('SERVER FAILED TO START\n' + log.slice(-3000)); process.exit(1); }
  const owner = await loginOwner();

  group('1) النقطتان العامتان: كتلة محرّك الاستقبال موجودة ونظيفة');
  {
    const h = await (await fetch(`${BASE}/api/health`)).json();
    const r = await (await fetch(`${BASE}/api/readiness`)).json();
    check('health has ingestionEngine block', !!h.ingestionEngine);
    check('readiness has ingestionEngine block', !!r.ingestionEngine);
    check('health ingestionEngine has queueDepth', typeof h.ingestionEngine?.queueDepth === 'number');
    check('health ingestionEngine covers 10 platforms', h.ingestionEngine?.platformsCovered === 10);
    check('health ingestionEngine has channels', h.ingestionEngine?.channels?.youtube === 'polling');
    check('public health has NO canary leak', !hasLeak(h));
    check('public readiness has NO canary leak', !hasLeak(r));
  }

  group('2) الإدخال الموحّد عبر 4 منصات');
  {
    const samples: Array<[string, string, string, string]> = [
      ['youtube', 'it_yt_1', 'كم سعر الغسالة؟', CANARY_AUTHOR],
      ['facebook', 'it_fb_1', 'شنو موقع المعرض؟', 'أحمد'],
      ['instagram', 'it_ig_1', 'عاشت إيدكم', 'ليلى'],
      ['telegram', 'it_tg_1', 'أريد أعرف أقساط الثلاجة', 'محمد'],
      ['youtube', 'it_yt_2', 'كم سعر الغسالة؟', 'علي'],
      ['youtube', 'it_yt_3', CANARY_TEXT, CANARY_AUTHOR],
    ];
    for (const [p, eid, text, who] of samples) {
      const res = await fetch(`${BASE}/api/social/manager/comments/ingest`, {
        method: 'POST', headers: owner, body: JSON.stringify({ platform: p, externalId: eid, text, authorName: who }),
      });
      const body = await res.json();
      check(`ingest ${p}/${eid} accepted`, res.ok && body.success === true, JSON.stringify(body).slice(0, 120));
    }
    // إعادة إرسال نفس الحدث => منع تكرار (لا سجل ثانٍ).
    const dup = await (await fetch(`${BASE}/api/social/manager/comments/ingest`, { method: 'POST', headers: owner, body: JSON.stringify({ platform: 'youtube', externalId: 'it_yt_1', text: 'x' }) })).json();
    check('duplicate ingest not stored twice', dup.duplicate === true);
  }

  group('3) مسار الاستقبال المحمي: ملخّص حقيقي + تعلّم + بلا بيانات عملاء');
  {
    const ing = await (await fetch(`${BASE}/api/social/manager/ingestion`, { headers: owner })).json();
    check('ingestion summary counts real events', ing.summary?.totalIngested === 6, `got ${ing.summary?.totalIngested}`);
    check('queueDepth = all 6 (none replied/escalated)', ing.summary?.queueDepth === 6, `got ${ing.summary?.queueDepth}`);
    check('byPlatform merged across platforms', ing.summary?.byPlatform?.youtube === 3 && ing.summary?.byPlatform?.telegram === 1);
    check('frequent price question derived (>=3)', ing.learning?.some((l: any) => l.id === 'ingest:faq:price'), JSON.stringify(ing.learning));
    check('ingestion responses carry NO author name', !hasLeak(ing));
    check('ingestion health status healthy', ing.health?.status === 'healthy');
  }

  group('4) بصمة الشخصية العراقية الموحّدة');
  {
    const p = await (await fetch(`${BASE}/api/social/manager/persona?platform=youtube`, { headers: owner })).json();
    check('persona mentions showroom', p.persona?.includes('الغرابي'));
    check('persona instructs Iraqi dialect', /لهجة عراقية عفوية/.test(p.persona || ''));
    check('persona forbids fabrication', /لا تخترع/.test(p.persona || ''));
    check('persona same for other platform (single source)', (await (await fetch(`${BASE}/api/social/manager/persona?platform=facebook`, { headers: owner })).json()).persona === p.persona);
  }

  group('5) التعلّم يُدرَج في ذاكرة العقل القائمة + idempotent + بلا محتوى عميل');
  {
    const first = await (await fetch(`${BASE}/api/agent/youtube/watcher/learning/persist`, { method: 'POST', headers: owner })).json();
    check('learning persist added >=1', first.added >= 1, JSON.stringify(first).slice(0, 160));
    const memPath = join(stateDir, 'brainMemory.json');
    check('brainMemory.json written', existsSync(memPath));
    const memText = existsSync(memPath) ? readFileSync(memPath, 'utf8') : '';
    check('memory contains derived faq signal', memText.includes('ingest:faq:price'));
    check('memory has NO customer text', !memText.includes(CANARY_TEXT) && !memText.includes('الغسالة'));
    check('memory has NO author name', !memText.includes(CANARY_AUTHOR));
    const second = await (await fetch(`${BASE}/api/agent/youtube/watcher/learning/persist`, { method: 'POST', headers: owner })).json();
    check('second persist is idempotent (added=0)', second.added === 0, JSON.stringify(second).slice(0, 120));
  }

  group('6) تصريح: مسارات الاستقبال/الشخصية/التعلّم محميّة');
  {
    for (const path of ['/api/social/manager/ingestion', '/api/social/manager/persona']) {
      const res = await fetch(`${BASE}${path}`);
      check(`${path} requires auth (401)`, res.status === 401, `got ${res.status}`);
    }
    const res = await fetch(`${BASE}/api/agent/youtube/watcher/learning/persist`, { method: 'POST' });
    check('learning persist requires owner (401)', res.status === 401, `got ${res.status}`);
  }

  group('7) الثبات بعد إعادة التشغيل (نفس مجلد الحالة)');
  {
    await stop();
    startApp();
    const up2 = await waitForHealth();
    check('server restarted', up2);
    const owner2 = await loginOwner();
    const ing2 = await (await fetch(`${BASE}/api/social/manager/ingestion`, { headers: owner2 })).json();
    check('ingested events survived restart', ing2.summary?.totalIngested === 6, `got ${ing2.summary?.totalIngested}`);
    check('no canary leak after restart', !hasLeak(ing2));
    const memText = existsSync(join(stateDir, 'brainMemory.json')) ? readFileSync(join(stateDir, 'brainMemory.json'), 'utf8') : '';
    check('learning memory survived restart', memText.includes('ingest:faq:price'));
  }

  await stop();
  rmSync(stateDir, { recursive: true, force: true });

  console.log(`\n${failures.length ? '❌' : '✅'} ingestion engine (server): ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log('  ✗ ' + f);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); try { stop(); } catch { /* تجاهل */ } process.exit(1); });
