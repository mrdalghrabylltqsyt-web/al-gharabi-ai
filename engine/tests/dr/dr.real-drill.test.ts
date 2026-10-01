/**
 * اختبار تعافٍ حقيقي معزول (Real Recovery Drill) — قاعدة بيانات حقيقية + إقلاع فعلي.
 *
 * الفرق عن بقية اختبارات DR: هنا نستخدم **Postgres حقيقياً** (embedded) و**نقلع
 * الخادم المستعاد فعلياً** ونفحص /api/health و/api/readiness. هذا يثبت أن نقطة
 * الاستعادة تعيد بناء نظام عامل، لا مجرد ملفات.
 *
 * المسار المُنفَّذ بالضبط (نفس منطق الإنتاج):
 *   state حقيقي في PG → dump → تشفير → نقطة استعادة (source+db+secrets) على Drive
 *   → تنزيل → تحقق بصمات → فكّ تشفير → استخراج مصدر إلى مجلد معزول
 *   → تحميل DB في قاعدة **معزولة** → إقلاع server.ts المستعاد → health/readiness
 *   → مطابقة البيانات + تأكيد عدم تسريب أي سرّ في السجلات.
 *
 * الحمايات:
 *  - لا يلمس الإنتاج: قاعدة embedded محلية فقط، ومجلدات مؤقتة.
 *  - لا يطبع أي سرّ: يقارن حالات وعدّادات فقط.
 *  - يتخطّى صراحةً إن لم تكن أداة embedded-postgres مثبّتة (أداة تطوير فقط).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const EMBEDDED_PG = path.join(REPO_ROOT, 'tools', 'local-verification', 'node_modules', 'embedded-postgres', 'dist', 'index.js');
const MASTER_KEY = 'ab'.repeat(32); // 32 بايت hex (قيمة اختبار عابرة، ليست سرّ إنتاج)

/** الحالة "الإنتاجية" التمثيلية: مستخدمون + workspace + brain + control + watcher. */
function seedState() {
  return {
    schemaVersion: 1,
    users: [
      { id: 'owner', email: 'owner@example.test', role: 'owner', name: 'المالك', active: true },
      { id: 'u2', email: 'staff@example.test', role: 'staff', name: 'موظف', active: true },
    ],
    revokedSessions: [],
    userRevocations: [],
    audit: [{ id: 'a1', action: 'login', at: 1 }],
    jobs: [{ id: 'j1', type: 'publish', status: 'done' }],
    platformConnections: [{ platform: 'youtube', providerVerified: true }],
    workspace: {
      showroom: { name: 'معرض الغرابي' },
      products: [{ id: 'p1', name: 'هاتف', price: 500000 }],
      posts: [], conversations: [], installmentPlans: [], leads: [], tasks: [],
      sales: [], payments: [], inventoryMovements: [], suppliers: [], purchases: [],
      expenses: [], contracts: [], installmentSchedules: [], notifications: [],
      webhookEvents: [], providerEvents: [], marketingBriefs: [], marketingCampaigns: [],
      socialComments: [{ id: 'c1', platform: 'youtube', text: 'عاشت إيدكم' }],
      socialReplies: [], socialApprovals: [], publishRecords: [], performanceRecords: [],
      marketingDecisions: [], strategiesTested: [], telegramUpdateIds: [],
      facebookEventIds: [], instagramEventIds: [], tiktokEventIds: [],
      youtubeCommentIds: ['c1'], youtubeOperationKeys: [], providerTokens: {},
    },
  };
}

async function main() {
  if (!fs.existsSync(EMBEDDED_PG)) {
    console.log('DR REAL DRILL TESTS SKIPPED: embedded-postgres غير مثبّت (شغّل npm install في tools/local-verification).');
    return;
  }

  const EmbeddedPostgres = (await import(pathToFileURL(EMBEDDED_PG).href)).default;
  const pg = (await import('pg')).default;

  // أدوات DR الحقيقية (نفس مسار الإنتاج).
  const { createFakeDriveState, makeFakeTransport } = await import('./helpers/fakeDrive');
  const { DriveClient } = await import('../../../tools/dr/drive-client.mjs');
  const { DriveStore } = await import('../../../tools/dr/drive-store.mjs');
  const { runBackup } = await import('../../../tools/dr/backup.mjs');
  const { encryptDbDump, decryptDbDump } = await import('../../../tools/dr/db-crypto.mjs');
  const { buildSecretsBundle, decryptSecretsPackage } = await import('../../../tools/dr/secret-crypto.mjs');
  const restoreMod = await import('../../../tools/dr/restore.mjs');
  const { collectRepoFiles } = await import('../../../tools/dr/cloud-sync.mjs');

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gharabi-real-drill-pg-'));
  const port = 55700 + Math.floor(Math.random() * 200);
  const password = crypto.randomBytes(12).toString('hex');
  const db = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password, port, persistent: false });
  const prodUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/gharabi_prod?sslmode=disable`;
  const restoreUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/gharabi_restore?sslmode=disable`;

  let workDir = null;
  try {
    await db.initialise();
    await db.start();
    await db.createDatabase('gharabi_prod');
    await db.createDatabase('gharabi_restore');

    // --- 1) قاعدة "الإنتاج" الحقيقية + حالة تمثيلية ---
    const prodPool = new pg.Pool({ connectionString: prodUrl, max: 3 });
    await prodPool.query('CREATE TABLE IF NOT EXISTS gharabi_state (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
    const upsert = (k: string, v: any) => prodPool.query(
      'INSERT INTO gharabi_state (key, value, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
      [k, JSON.stringify(v)],
    );
    await upsert('state', seedState());
    await upsert('control', { driveMirror: { treeHash: 'x' }, youtubeDelegation: { granted: true } });
    await upsert('brainMemory', { entries: [{ id: 'm1', type: 'fact', text: 'المعرض في بغداد' }] });
    await upsert('youtubeWatcher', { controls: { cadenceMinutes: 2 }, processed: [] });
    const dumpRow = await prodPool.query('SELECT key, value, updated_at FROM gharabi_state ORDER BY key');
    const rawDump = JSON.stringify({ backend: 'postgres', exportedAt: new Date().toISOString(), rows: dumpRow.rows }, null, 2);
    const prodState = await prodPool.query("SELECT value FROM gharabi_state WHERE key='state'");
    await prodPool.end();

    // --- 2) نقطة استعادة حقيقية على Drive (fakeDrive الوهمي الصادق للعقد) ---
    const driveState = createFakeDriveState();
    const store = new DriveStore({ client: new DriveClient({ transport: makeFakeTransport(driveState), tokenProvider: () => 'tok' }) });
    const secretEnv = {
      DR_RECOVERY_MASTER_KEY: MASTER_KEY,
      // مفتاح نسخة القاعدة منفصل عن مفتاح الأسرار في الإنتاج (يُسقط على مفتاح
      // تشفير التوكنات عند غيابه). هنا نفس القيمة لتبسيط الفحص فقط.
      DRIVE_DB_BACKUP_KEY: MASTER_KEY,
      GEMINI_API_KEY: 'AIzaSy' + 'k'.repeat(33),
      SESSION_SECRET: 'sess-' + 'r'.repeat(40),
      TELEGRAM_BOT_TOKEN: '123456:AA' + 't'.repeat(33),
    };
    const collected = collectRepoFiles(REPO_ROOT);
    const files = [...collected.included, ...collected.excluded];
    const backup = await runBackup({
      store,
      files,
      dumpDatabase: async () => rawDump,
      encryptDatabase: (sql: string) => encryptDbDump(sql, secretEnv),
      buildSecrets: () => buildSecretsBundle(secretEnv, {}),
      meta: { commit: 'drillcommit', branch: 'main', repository: 'mrdalghrabylltqsyt-web/al-gharabi-ai', project: 'al-gharabi-ai' },
      now: new Date().toISOString(),
    });
    check('drill: recovery point created + verified', backup.state === 'backed_up' && backup.verified === true, backup.reason);
    check('drill: source has many files', (backup.manifest?.fileCount ?? 0) > 20);
    check('drill: db + secrets hashes present', /^[0-9a-f]{64}$/.test(backup.manifest.encryptedDatabaseHash) && /^[0-9a-f]{64}$/.test(backup.manifest.encryptedSecretsHash));

    // --- 3) التحقق من النقطة + فكّ التشفير (مسار الاستعادة الحقيقي) ---
    const point = await store.getRestorePoint(backup.recoveryPointId);
    check('drill: point readable', point.ok && Boolean(point.data));
    const verification = await restoreMod.verifyRecoveryPoint(store, point.data);
    check('drill: hashes verified', verification.ok === true, verification.problems.join(','));
    const arts = verification.artifacts;

    const secretsDec = decryptSecretsPackage(arts.secrets, secretEnv);
    check('drill: secrets decrypt', secretsDec.ok === true && secretsDec.secrets.SESSION_SECRET === secretEnv.SESSION_SECRET);
    const sqlDec = decryptDbDump(arts.db, secretEnv);
    check('drill: database decrypt', sqlDec.ok === true && String(sqlDec.sql).includes('"key"'));

    // --- 4) استعادة المصدر إلى مجلد معزول ---
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gharabi-real-drill-src-'));
    const extracted = restoreMod.extractSourceBundle(arts.bundle);
    check('drill: source extract', extracted.ok === true && extracted.files.length === backup.manifest.fileCount);
    const written = restoreMod.materializeSource(extracted.files, workDir);
    check('drill: source materialized', written.ok === true && fs.existsSync(path.join(workDir, 'server.ts')) && fs.existsSync(path.join(workDir, 'package.json')));
    check('drill: engine restored', fs.existsSync(path.join(workDir, 'engine', 'storage', 'adapter.ts')));
    check('drill: no raw DB/secrets files in source', !fs.existsSync(path.join(workDir, 'database.enc')) && !fs.existsSync(path.join(workDir, 'secrets.enc')));

    // --- 5) استعادة قاعدة البيانات في قاعدة **معزولة** ---
    const restorePool = new pg.Pool({ connectionString: restoreUrl, max: 3 });
    const applied = await restoreMod.applyDatabaseDump(sqlDec.sql, restorePool);
    check('drill: database restore applied', applied.ok === true && applied.mode === 'postgres', JSON.stringify(applied));
    const restoredState = await restorePool.query("SELECT value FROM gharabi_state WHERE key='state'");
    const rState = restoredState.rows?.[0]?.value;
    check('drill: restored users match', Array.isArray(rState?.users) && rState.users.length === seedState().users.length);
    check('drill: restored products match', rState?.workspace?.products?.length === seedState().workspace.products.length);
    check('drill: restored showroom name intact', rState?.workspace?.showroom?.name === seedState().workspace.showroom.name);
    const rBrain = await restorePool.query("SELECT value FROM gharabi_state WHERE key='brainMemory'");
    check('drill: brain memory restored', Array.isArray(rBrain.rows?.[0]?.value?.entries) && rBrain.rows[0].value.entries.length === 1);
    const rControl = await restorePool.query("SELECT value FROM gharabi_state WHERE key='control'");
    check('drill: platform/control state restored', rControl.rows?.[0]?.value?.youtubeDelegation?.granted === true);
    await restorePool.end();

    // لا نُطابق قاعدة الإنتاج: القاعدتان منفصلتان (حماية صريحة).
    check('drill: isolated db differs from production db', prodUrl !== restoreUrl);

    // --- 6) إقلاع الخادم **المستعاد** فعلياً على القاعدة المعزولة ---
    const boot = await bootRestoredSource(workDir, {
      NODE_ENV: 'production',
      DATABASE_URL: restoreUrl,
      STATE_DIR: path.join(workDir, '.state'),
      SESSION_SECRET: secretEnv.SESSION_SECRET,
      // أسرار مفكوكة تُحقن كما يفعل المالك عند الاستعادة الفعلية.
      ...Object.fromEntries(Object.entries(secretsDec.secrets || {}).filter(([, v]) => typeof v === 'string')),
    });
    check('drill: restored application boots', boot.booted === true, boot.logSample);
    check('drill: /api/health ok', boot.health?.ok === true);
    check('drill: persistence backend is postgres', boot.health?.persistence?.backend === 'postgres');
    check('drill: /api/readiness ok + applicationReady', boot.readiness?.ok === true && boot.readiness?.applicationReady === true);
    check('drill: brain block present in readiness', Boolean(boot.readiness?.brain));
    check('drill: no secret leaked in boot logs', boot.secretLeak === false);

    // --- 7) فشل بأمان: مفتاح خاطئ لا يستبدل نسخة سليمة ---
    const wrongKeyEnv = { ...secretEnv, DR_RECOVERY_MASTER_KEY: 'cd'.repeat(32) };
    const wrongSecrets = decryptSecretsPackage(arts.secrets, wrongKeyEnv);
    check('drill: wrong master key fails safely', wrongSecrets.ok === false);
    const wrongDb = decryptDbDump(arts.db, { ...secretEnv, DRIVE_DB_BACKUP_KEY: 'ef'.repeat(32), DR_RECOVERY_MASTER_KEY: '', DRIVE_TOKEN_ENCRYPTION_KEY: '' });
    check('drill: wrong db key fails safely', wrongDb.ok === false);
    // النسخة السليمة ما زالت تُفكّ (لم تُتلف) — لا استبدال بنسخة فاسدة.
    check('drill: healthy copy still decrypts after wrong-key attempt', decryptDbDump(arts.db, secretEnv).ok === true);
  } finally {
    await db.stop().catch(() => { /* تجاهل */ });
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`DR REAL DRILL TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR REAL DRILL TESTS PASSED: ${passed} checks`);
}

/**
 * يقلع server.ts **المستعاد** من مجلد العمل المعزول عبر tsx، مع ربط node_modules
 * من المستودع (أداة تطوير فقط؛ البناء الكامل عبر npm ci غير ممكن بلا شبكة في CI).
 * يفحص health/readiness ويكشف أي سرّ ظهر في السجلات بلا طباعته.
 */
async function bootRestoredSource(workDir: string, extraEnv: Record<string, string>) {
  // ربط node_modules فقط ليجد tsx/التبعيات؛ الكود المُنفَّذ هو المستعاد فعلاً.
  const nm = path.join(workDir, 'node_modules');
  try { if (!fs.existsSync(nm)) fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), nm, 'dir'); } catch { /* تجاهل */ }
  const env: Record<string, string> = { ...process.env, ...extraEnv, PORT: String(55900 + Math.floor(Math.random() * 80)) } as Record<string, string>;
  // استدعاء tsx مباشرة (لا npx) + detached حتى تُقتل الشجرة كلها بلا عمليات يتيمة تُبقي الأنبوب مفتوحاً.
  const tsxCli = path.join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');
  const child = spawn(process.execPath, [tsxCli, 'server.ts'], { cwd: workDir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const killTree = (sig: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, sig); } catch { /* تجاهل */ } };
  let out = '';
  child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
  child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
  const base = `http://127.0.0.1:${env.PORT}`;
  const deadline = Date.now() + 90_000;
  let booted = false;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/health`)).ok) { booted = true; break; } } catch { /* لم يقلع بعد */ }
    if (child.exitCode != null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  let health: any = null;
  let readiness: any = null;
  if (booted) {
    try { health = await (await fetch(`${base}/api/health`)).json(); } catch { /* تجاهل */ }
    try { readiness = await (await fetch(`${base}/api/readiness`)).json(); } catch { /* تجاهل */ }
  }
  try { killTree('SIGTERM'); } catch { /* تجاهل */ }
  await new Promise((r) => setTimeout(r, 800));
  try { killTree('SIGKILL'); } catch { /* تجاهل */ }
  // إغلاق أنابيب الإخراج صراحةً حتى لا تُبقي عملية يتيمة تشغيل الاختبار معلّقاً.
  try { child.stdout?.destroy(); child.stderr?.destroy(); } catch { /* تجاهل */ }
  const secretLeak = Object.entries(extraEnv)
    .filter(([k, v]) => /_?(KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS?)$/.test(k) && typeof v === 'string' && v.length >= 16)
    .some(([, v]) => out.includes(v as string));
  return {
    booted,
    health: health ? { ok: health.status === 'ok', persistence: health.persistence || null } : null,
    readiness: readiness ? { ok: readiness.success === true, applicationReady: readiness.applicationReady, brain: readiness.brain || null } : null,
    secretLeak,
    logSample: out.split('\n').filter(Boolean).slice(-4).join(' | ').slice(0, 500),
  };
}

main().catch((err) => {
  console.error('DR REAL DRILL TESTS CRASHED:', err?.message || err);
  process.exit(1);
});
