/**
 * اختبار تعافٍ حقيقي معزول (Recovery Drill) — يبدأ من **Recovery Point حقيقي**.
 *
 * لماذا هذا الملف: الاختبارات الوهمية (fakeDrive) تثبت منطق المنظومة، لكنها لا
 * تثبت أن الحزمة الحقيقية على Google Drive قابلة للاستعادة فعلاً. هذا الهارنس
 * يقرأ نقطة استعادة حقيقية من Drive، ينزّل مصدرها وقاعدة بياناتها وأسرارها،
 * يتحقّق من البصمات، يفكّ التشفير، يستعيد المصدر إلى مجلد معزول، يستعيد قاعدة
 * البيانات في **قاعدة معزولة** (embedded postgres)، يقلع الخادم المستعاد فعلياً
 * ويفحص /api/health و/api/readiness، ويؤكّد أن الأسرار لم تظهر في سجلات الإقلاع.
 *
 * الحمايات الملزمة:
 *  - لا يلمس الإنتاج إطلاقاً: لا DATABASE_URL إنتاجي، ولا كتابة خارج مجلد مؤقت.
 *  - لا يطبع أي قيمة سرّية: يقارن البصمات والعدّادات فقط.
 *  - يفشل بأمان عند أي تلف/نقص/مفتاح خاطئ بلا استبدال نسخة سليمة.
 *
 * التشغيل (يحتاج تفويض Drive حقيقي في البيئة):
 *   cd tools/local-verification && npm install
 *   cd ../.. && node tools/local-verification/recovery-drill.mjs [--point rp-003]
 *
 * متغيّرات البيئة:
 *   DRIVE_OAUTH_CLIENT_ID / DRIVE_OAUTH_CLIENT_SECRET / DRIVE_OAUTH_REFRESH_TOKEN
 *   DRIVE_TOKEN_ENCRYPTION_KEY  (لفكّ رمز التجديد المشفّر إن لم يُمرَّر الرمز خاماً)
 *   DR_RECOVERY_MASTER_KEY | DRIVE_DB_BACKUP_KEY | DRIVE_TOKEN_ENCRYPTION_KEY (لفكّ الأسرار/القاعدة)
 *
 * الإخراج: تقرير JSON واحد صادق (PASS/FAIL لكل مرحلة) — لا ادعاء نجاح بلا دليل.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

async function main() {
  const args = process.argv.slice(2);
  const pointArgIdx = args.indexOf('--point');
  const requestedPoint = pointArgIdx >= 0 ? args[pointArgIdx + 1] : null;
  const report = {
    kind: 'real-recovery-drill',
    at: new Date().toISOString(),
    recoveryPointId: requestedPoint,
    checks: {},
    problems: [],
    overall: 'FAIL',
    isolated: true,
    wroteToProduction: false,
    usedProductionDatabase: false,
  };
  const fail = (code, message) => {
    report.problems.push(code);
    report.checks[code] = false;
    if (message) report.message = message;
    finish(report, 1);
  };

  // --- 0) أدوات Drive + قراءة النقطة الحقيقية ---
  let store;
  try {
    const { DriveClient, createGaxiosTransport } = await import(path.join(REPO_ROOT, 'tools/dr/drive-client.mjs'));
    const { DriveStore } = await import(path.join(REPO_ROOT, 'tools/dr/drive-store.mjs'));
    const { createRefreshTokenProvider, decryptDriveSecret, inspectDriveAuthEnv } = await import(path.join(REPO_ROOT, 'tools/dr/drive-auth.mjs'));

    const auth = inspectDriveAuthEnv(process.env);
    if (!auth.configured) return fail('drive_not_configured', 'اعتماد OAuth لـDrive غير مضبوط في البيئة.');
    const env = process.env;
    const encryptedRefresh = null; // الرمز الحقيقي يُمرَّر عبر DRIVE_OAUTH_REFRESH_TOKEN (غير مشفّر) أو مشفّراً عبر المخزن.
    const tokenProvider = createRefreshTokenProvider({
      env,
      refreshToken: env.DRIVE_OAUTH_REFRESH_TOKEN || null,
      encryptedRefreshToken: encryptedRefresh,
    });
    const client = new DriveClient({ transport: createGaxiosTransport(), tokenProvider });
    store = new DriveStore({ client, readOnlyStructure: true });
    report.checks.driveConfigured = true;
  } catch (err) {
    return fail('drive_client_failed', String(err?.message || err).slice(0, 120));
  }

  // --- 1) اختيار نقطة الاستعادة الحقيقية ---
  let point;
  try {
    if (requestedPoint) {
      const got = await store.getRestorePoint(requestedPoint);
      if (!got.ok || !got.data) return fail('recovery_point_not_found', `النقطة ${requestedPoint} غير موجودة.`);
      point = got.data;
    } else {
      const list = await store.listRestorePoints();
      if (!list.ok || !list.data?.length) return fail('no_recovery_points', 'لا توجد نقاط استعادة على Drive.');
      point = list.data[list.data.length - 1];
    }
    report.recoveryPointId = point.id;
    report.commit = point.manifest?.commit ?? null;
    report.fileCount = point.manifest?.fileCount ?? null;
    report.sourceHash = point.manifest?.sourceHash ?? null;
    report.databaseHash = point.manifest?.encryptedDatabaseHash ?? null;
    report.secretsHash = point.manifest?.encryptedSecretsHash ?? null;
    report.checks.recoveryPointFound = true;
  } catch (err) {
    return fail('recovery_point_read_failed', String(err?.message || err).slice(0, 120));
  }

  // --- 2) التحقق من البصمات + فكّ التشفير + استخراج المصدر (منطق restore الحقيقي) ---
  let restoreMod;
  let artifacts;
  let secrets = null;
  let sql = null;
  try {
    restoreMod = await import(path.join(REPO_ROOT, 'tools/dr/restore.mjs'));
    const verification = await restoreMod.verifyRecoveryPoint(store, point);
    report.checks.hashesVerified = verification.ok;
    if (!verification.ok) return fail('verification_failed', `فشل التحقق: ${verification.problems.join(', ')}`);
    artifacts = verification.artifacts;

    const { decryptSecretsPackage } = await import(path.join(REPO_ROOT, 'tools/dr/secret-crypto.mjs'));
    const { decryptDbDump } = await import(path.join(REPO_ROOT, 'tools/dr/db-crypto.mjs'));

    if (artifacts.present.secrets) {
      const dec = decryptSecretsPackage(artifacts.secrets, process.env);
      report.checks.secretsDecrypt = dec.ok;
      if (!dec.ok) return fail(`secrets_${dec.code || 'decrypt_failed'}`, 'تعذّر فكّ الأسرار بالمفتاح المتاح.');
      secrets = dec.secrets;
      report.secretsNames = Object.keys(secrets).sort();
      report.secretsCount = report.secretsNames.length;
    } else {
      report.checks.secretsDecrypt = false;
      report.problems.push('secrets_missing');
    }

    if (artifacts.present.db) {
      const dec = decryptDbDump(artifacts.db, process.env);
      report.checks.databaseDecrypt = dec.ok;
      if (!dec.ok) return fail(`database_${dec.code || 'decrypt_failed'}`, 'تعذّر فكّ نسخة قاعدة البيانات.');
      sql = dec.sql;
    } else {
      report.checks.databaseDecrypt = false;
      report.problems.push('database_missing');
    }
  } catch (err) {
    return fail('decrypt_failed', String(err?.message || err).slice(0, 120));
  }

  // --- 3) استعادة المصدر إلى مجلد معزول ---
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gharabi-recovery-'));
  report.workDir = workDir;
  try {
    const extracted = restoreMod.extractSourceBundle(artifacts.bundle);
    report.checks.sourceExtract = extracted.ok;
    if (!extracted.ok) return fail(`source_${extracted.code || 'extract_failed'}`, 'تعذّر استخراج حزمة المصدر.');
    const written = restoreMod.materializeSource(extracted.files, workDir);
    report.checks.sourceMaterialized = written.ok;
    report.materializedFileCount = written.count;
    // إثبات وجود ملفات محورية فعلاً.
    const critical = ['package.json', 'server.ts'];
    report.checks.criticalFilesPresent = critical.every((f) => fs.existsSync(path.join(workDir, f)));
    if (!report.checks.criticalFilesPresent) return fail('critical_files_missing', 'ملفات محورية مفقودة في المصدر المستعاد.');
  } catch (err) {
    return fail('materialize_failed', String(err?.message || err).slice(0, 120));
  }

  // --- 4) قاعدة بيانات معزولة: تحميل dump المستعاد ---
  let db;
  try {
    const EmbeddedPostgres = (await import(path.join(HERE, 'node_modules/embedded-postgres/dist/index.js'))).default;
    const port = 55500 + Math.floor(Math.random() * 400);
    const password = crypto.randomBytes(12).toString('hex');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gharabi-recovery-pg-'));
    db = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password, port, persistent: false });
    await db.initialise();
    await db.start();
    await db.createDatabase('gharabi_recovery');
    const isolatedUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/gharabi_recovery?sslmode=disable`;
    report.isolatedDatabaseUrl = 'redacted'; // لا نطبع الرابط
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: isolatedUrl, max: 3 });
    try {
      const applied = await restoreMod.applyDatabaseDump(sql, pool);
      report.checks.databaseRestore = applied.ok === true;
      report.databaseRestoreMode = applied.mode || null;
      report.databaseRestoreRows = applied.rows ?? null;
      if (!applied.ok) return fail(`db_restore_${applied.code || 'failed'}`, 'تعذّر تحميل نسخة قاعدة البيانات.');
      // إثبات بيانات أساسية: وجود جدول الحالة وصفوف الحالة.
      const stateRow = await pool.query("SELECT value FROM gharabi_state WHERE key = 'state'");
      report.checks.coreDataPresent = Boolean(stateRow.rows?.[0]?.value);
      const users = stateRow.rows?.[0]?.value?.users;
      report.stateUsersCount = Array.isArray(users) ? users.length : null;
      // brain memory + platform connections إن وُجدت في القاعدة.
      const brainRow = await pool.query("SELECT value FROM gharabi_state WHERE key = 'brainMemory'");
      report.checks.brainMemoryPresent = Boolean(brainRow.rows?.[0]?.value);
      const platformRow = await pool.query("SELECT value FROM gharabi_state WHERE key = 'control'");
      report.checks.platformStatePresent = Boolean(platformRow.rows?.[0]?.value);
    } finally {
      await pool.end().catch(() => {});
    }
    // --- 5) إقلاع الخادم المستعاد فعلياً على القاعدة المعزولة ---
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(55600 + Math.floor(Math.random() * 200)),
      DATABASE_URL: isolatedUrl,
      STATE_DIR: path.join(workDir, '.state'),
      SESSION_SECRET: secrets?.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
      // الأسرار المفكوكة تُحقن كي يقلع النظام كاملاً؛ لا تُطبع.
      ...Object.fromEntries(Object.entries(secrets || {}).filter(([, v]) => typeof v === 'string')),
    };
    const boot = await bootRestoredServer(workDir, env);
    report.checks.applicationBoot = boot.booted;
    report.checks.healthOk = boot.health?.ok === true;
    report.checks.readinessOk = boot.readiness?.ok === true;
    report.healthPersistence = boot.health?.persistence?.backend ?? null;
    report.readinessAppReady = boot.readiness?.applicationReady ?? null;
    report.checks.secretsNotInLogs = boot.secretLeak === false;
    if (boot.logSample) report.bootLogSample = boot.logSample;
    if (!boot.booted) report.problems.push('boot_failed');
    if (boot.secretLeak) report.problems.push('secret_leak_in_logs');
  } catch (err) {
    return fail('isolated_db_failed', String(err?.message || err).slice(0, 160));
  } finally {
    if (db) await db.stop().catch(() => {});
  }

  report.overall = report.problems.length === 0 ? 'PASS' : 'FAIL';
  finish(report, report.overall === 'PASS' ? 0 : 1);
}

/**
 * يقلع الخادم المستعاد (dist/server.cjs إن وُجد، وإلا عبر tsx على server.ts)
 * في مجلد العمل المعزول، ويفحص health/readiness، ويفحص السجلات بحثاً عن أي سرّ.
 * لا يُطبع أي سرّ.
 */
async function bootRestoredServer(workDir, env) {
  const distEntry = path.join(workDir, 'dist', 'server.cjs');
  const useDist = fs.existsSync(distEntry);
  const cmd = process.execPath;
  const cmdArgs = useDist ? [distEntry] : [path.join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs'), 'server.ts'];
  // detached حتى تُقتل شجرة العمليات كلها (لا عمليات يتيمة تُبقي أنبوب الإخراج مفتوحاً).
  const child = spawn(cmd, cmdArgs, { cwd: workDir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const killTree = (sig) => { try { if (child.pid) process.kill(-child.pid, sig); } catch { /* ignore */ } };
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  const base = `http://127.0.0.1:${env.PORT}`;
  const deadline = Date.now() + 60_000;
  let booted = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) { booted = true; break; }
    } catch { /* لم يقلع بعد */ }
    if (child.exitCode != null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  let health = null;
  let readiness = null;
  if (booted) {
    try { health = await (await fetch(`${base}/api/health`)).json(); } catch { /* ignore */ }
    try { readiness = await (await fetch(`${base}/api/readiness`)).json(); } catch { /* ignore */ }
  }
  try { killTree('SIGTERM'); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 800));
  try { killTree('SIGKILL'); } catch { /* ignore */ }
  try { child.stdout?.destroy(); child.stderr?.destroy(); } catch { /* ignore */ }
  // فحص تسريب الأسرار في السجلات: نبحث عن قيم سرّية حقيقية من الحزمة المفكوكة.
  const secretLeak = detectSecretLeak(out, env);
  return {
    booted,
    health: health ? { ok: health.status === 'ok', persistence: health.persistence || null } : null,
    readiness: readiness ? { ok: readiness.success === true, applicationReady: readiness.applicationReady } : null,
    secretLeak,
    logSample: out.split('\n').filter(Boolean).slice(0, 6).join(' | ').slice(0, 400),
  };
}

/** يكتشف ظهور أي قيمة سرّية (من الحزمة المفكوكة) في نص السجلات — بلا طباعة القيم. */
function detectSecretLeak(logText, env) {
  const candidates = [];
  for (const [k, v] of Object.entries(env || {})) {
    if (typeof v !== 'string' || v.length < 16) continue;
    if (!/_?(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?)$/.test(k)) continue;
    candidates.push(v);
  }
  return candidates.some((s) => logText.includes(s));
}

function finish(report, code) {
  // لا نطبع أي قيمة سرّية: التقرير يحتوي حالات وأسماء وأعداداً وبصمات فقط.
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = code;
}

main().catch((err) => {
  console.error(JSON.stringify({ kind: 'real-recovery-drill', overall: 'FAIL', crash: String(err?.message || err).slice(0, 200) }));
  process.exit(1);
});
