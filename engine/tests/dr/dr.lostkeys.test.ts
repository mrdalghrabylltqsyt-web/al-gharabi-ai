/**
 * اختبار «فقدان كل المفاتيح» (All-Keys-Lost Drill) — معزول بالكامل، بلا إنتاج.
 *
 * السيناريو: ضاعت **كل** مفاتيح بيئة التشغيل الأصلية (Render/GitHub/DATABASE_URL
 * الأصلية/جهاز التطوير). المتاح فقط:
 *   1) نقطة استعادة على Google Drive (وهمي محلي يطبّق نفس عقد REST)
 *   2) database.enc مشفّرة
 *   3) secrets.enc مشفّرة
 *   4) خزنة مفاتيح الطوارئ (KEY-VAULT) مشفّرة
 *   5) وثائق التعافي
 *   6) DR_RECOVERY_VAULT_KEY (مفتاح المالك المحفوظ خارج المشروع)
 *
 * يُثبت: فتح الخزنة بالمفتاح الصحيح، رفض المفتاح الخطأ، كشف العبث، استرجاع الجرد،
 * تصنيف ما يُستعاد/يُعاد إصداره، فكّ القاعدة والأسرار بمفاتيح **مُستعادة من الخزنة**
 * (لا من بيئة التشغيل)، رفض عبث القاعدة، استخراج المصدر، وإقلاع نسخة معزولة.
 *
 * الحمايات: لا يلمس الإنتاج؛ كل شيء على fakeDrive ومجلد مؤقت. لا يُطبع أي سرّ.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import { runBackup } from '../../../tools/dr/backup.mjs';
import { encryptDbDump, decryptDbDump } from '../../../tools/dr/db-crypto.mjs';
import { buildSecretsBundle, decryptSecretsPackage } from '../../../tools/dr/secret-crypto.mjs';
import { runKeyVaultSync, recoverKeyVault } from '../../dr/recoveryVault/vault';
import { RECOVERY_SECRET_INVENTORY } from '../../dr/recoveryVault/inventory';
import { classifyInventoryForRecovery, summarizeRecovery } from '../../dr/recoveryVault/recoveryReport';
import { verifyRecoveryPoint, extractSourceBundle, materializeSource } from '../../../tools/dr/restore.mjs';
import { collectRepoFiles } from '../../../tools/dr/cloud-sync.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function freePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(freePort(0)));
    srv.listen(preferred, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

// البيئة "الأصلية" الكاملة (قيم اختبار عابرة — ليست أسرار إنتاج).
const VAULT_KEY = 'f'.repeat(64);
const ORIGINAL_ENV: Record<string, string> = {
  DR_RECOVERY_VAULT_KEY: VAULT_KEY,
  DR_RECOVERY_MASTER_KEY: 'a1'.repeat(32),
  DRIVE_DB_BACKUP_KEY: 'b2'.repeat(32),
  DRIVE_TOKEN_ENCRYPTION_KEY: 'c3'.repeat(32),
  SESSION_SECRET: 'sess-' + 'x'.repeat(40),
  PLATFORM_TOKEN_ENCRYPTION_KEY: 'd4'.repeat(32),
  OWNER_EMAIL: 'owner@example.test',
  DATABASE_URL: 'postgres://owner@example/gharabi',
  DRIVE_OAUTH_CLIENT_ID: 'e5.apps.googleusercontent.com',
  DRIVE_OAUTH_CLIENT_SECRET: 'drive-' + 'z'.repeat(30),
  GEMINI_API_KEY: 'AIzaSy' + 'g'.repeat(33),
  TELEGRAM_BOT_TOKEN: '123456:AA' + 't'.repeat(33),
  FACEBOOK_APP_SECRET: 'fb-' + 'y'.repeat(30),
};
const SQL = JSON.stringify({ backend: 'postgres', rows: [{ key: 'state', value: { users: [{ id: 'owner', role: 'owner' }] } }] });

function makeStore(state: any) {
  const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' });
  return new DriveStore({ client });
}

async function bootRestoredSource(workDir: string, extraEnv: Record<string, string>) {
  const nm = path.join(workDir, 'node_modules');
  try { if (!fs.existsSync(nm)) fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), nm, 'dir'); } catch { /* تجاهل */ }
  const bootPort = await freePort(56100 + Math.floor(Math.random() * 80));
  const env: Record<string, string> = { ...process.env, ...extraEnv, PORT: String(bootPort) } as Record<string, string>;
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
  let health: any = null; let readiness: any = null; let drHealth: any = null;
  if (booted) {
    try { health = await (await fetch(`${base}/api/health`)).json(); } catch { /* تجاهل */ }
    try { readiness = await (await fetch(`${base}/api/readiness`)).json(); } catch { /* تجاهل */ }
    try { drHealth = await (await fetch(`${base}/api/dr/health`)).json(); } catch { /* تجاهل */ }
  }
  try { killTree('SIGTERM'); } catch { /* تجاهل */ }
  await new Promise((r) => setTimeout(r, 800));
  try { killTree('SIGKILL'); } catch { /* تجاهل */ }
  try { child.stdout?.destroy(); child.stderr?.destroy(); } catch { /* تجاهل */ }
  const secretLeak = Object.entries(extraEnv)
    .filter(([k, v]) => /_?(KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS?)$/.test(k) && typeof v === 'string' && v.length >= 16)
    .some(([, v]) => out.includes(v as string));
  return {
    booted,
    health: health ? { ok: health.status === 'ok', persistence: health.persistence || null } : null,
    readiness: readiness ? { ok: readiness.success === true, applicationReady: readiness.applicationReady } : null,
    drHealth: drHealth ? { ok: drHealth.success === true, dr: drHealth.dr || null } : null,
    secretLeak,
    logSample: out.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 400),
  };
}

async function main() {
  const state = createFakeDriveState();
  const store = makeStore(state);
  const collected = collectRepoFiles(REPO_ROOT);
  const files = [...collected.included, ...collected.excluded];

  // --- 0) نسخة احتياطية + خزنة على Drive (الحالة "قبل الكارثة") ---
  const backup = await runBackup({
    store, files,
    dumpDatabase: async () => SQL,
    encryptDatabase: (sql: string) => encryptDbDump(sql, ORIGINAL_ENV),
    buildSecrets: () => buildSecretsBundle(ORIGINAL_ENV, { now: '2026-02-01T00:00:00.000Z' }),
    meta: { commit: 'lostkeys-commit', branch: 'main', repository: 'mrdalghrabylltqsyt-web/al-gharabi-ai', project: 'al-gharabi-ai' },
    now: '2026-02-01T00:00:00.000Z',
  });
  check('backup created + verified', backup.state === 'backed_up' && backup.verified === true, backup.reason);
  const vaultSync = await runKeyVaultSync({ store, env: ORIGINAL_ENV, now: '2026-02-01T00:00:00.000Z' });
  check('key vault synced', vaultSync.state === 'synced' && vaultSync.version === 1, vaultSync.reason);

  // ==================================================================
  // الكارثة: كل مفاتيح بيئة التشغيل ضاعت. المتاح فقط مفتاح الخزنة.
  // ==================================================================
  const OWNER_ONLY_ENV: Record<string, string> = { DR_RECOVERY_VAULT_KEY: VAULT_KEY };

  // --- 1) فتح الخزنة بالمفتاح الصحيح (لا شيء من بيئة التشغيل الأصلية) ---
  const recovered = await recoverKeyVault(store, OWNER_ONLY_ENV);
  check('vault opens with owner key alone', recovered.ok === true, recovered.code);
  check('vault integrity intact', recovered.ok === true && recovered.integrity.recordsMatch === true);
  check('vault excludes its own key', recovered.ok === true && !('DR_RECOVERY_VAULT_KEY' in (recovered.values || {})));
  const vals: Record<string, string> = recovered.ok ? recovered.values : {};
  check('recovered master key present', vals.DR_RECOVERY_MASTER_KEY === ORIGINAL_ENV.DR_RECOVERY_MASTER_KEY);
  check('recovered db key present', vals.DRIVE_DB_BACKUP_KEY === ORIGINAL_ENV.DRIVE_DB_BACKUP_KEY);
  check('recovered session secret present', vals.SESSION_SECRET === ORIGINAL_ENV.SESSION_SECRET);

  // --- 2) رفض المفتاح الخطأ (لا يفتح الخزنة) ---
  const wrongKey = await recoverKeyVault(store, { DR_RECOVERY_VAULT_KEY: '9'.repeat(64) });
  check('wrong vault key rejected', wrongKey.ok === false && wrongKey.code === 'decrypt_failed');
  // --- 3) كشف العبث بحزمة الخزنة (بصمة البيان) ---
  const headRes = await store.readKeyVaultHead();
  const vDir = await store.readKeyVaultVersion(headRes.data.version);
  const tamperedVault = Buffer.from(String(vDir.data).replace(/data: (.+)/, (_m: string, b64: string) => {
    const b = Buffer.from(b64, 'base64'); b[0] ^= 0xff; return `data: ${b.toString('base64')}`;
  }), 'utf8');
  const origReadVersion = store.readKeyVaultVersion.bind(store);
  store.readKeyVaultVersion = async (v: number) => (v === headRes.data.version ? { ok: true, data: tamperedVault } : origReadVersion(v));
  const tamperRec = await recoverKeyVault(store, OWNER_ONLY_ENV);
  check('tampered vault detected', tamperRec.ok === false && (tamperRec.code === 'vault_hash_mismatch' || tamperRec.code === 'decrypt_failed'));
  store.readKeyVaultVersion = origReadVersion;

  // --- 4) استرجاع الجرد وتصنيفه (RESTORABLE / REQUIRES_OWNER_ACTION / ...) ---
  const classes = classifyInventoryForRecovery(RECOVERY_SECRET_INVENTORY, vals);
  const summary = summarizeRecovery(classes);
  check('classification covers whole inventory', classes.length === RECOVERY_SECRET_INVENTORY.length);
  check('vault self key requires owner action', classes.find((c) => c.name === 'DR_RECOVERY_VAULT_KEY')?.classification === 'REQUIRES_OWNER_ACTION');
  check('db key classified restorable', classes.find((c) => c.name === 'DRIVE_DB_BACKUP_KEY')?.classification === 'RESTORABLE');
  check('no critical NOT_RECOVERABLE when vault complete', classes.every((c) => !(c.recoveryCritical && c.classification === 'NOT_RECOVERABLE')));
  check('summary counts sane', summary.RESTORABLE >= 5 && summary.REQUIRES_OWNER_ACTION >= 1);
  // صدق التصنيف: مفتاح حرج مفقود من الخزنة يُعلن NOT_RECOVERABLE صراحةً (لا إخفاء).
  const missingClasses = classifyInventoryForRecovery(RECOVERY_SECRET_INVENTORY, {});
  check('missing critical key => NOT_RECOVERABLE', missingClasses.find((c) => c.name === 'DRIVE_DB_BACKUP_KEY')?.classification === 'NOT_RECOVERABLE');
  check('missing critical key => REQUIRES_OWNER_ACTION for vault key', missingClasses.find((c) => c.name === 'DR_RECOVERY_VAULT_KEY')?.classification === 'REQUIRES_OWNER_ACTION');

  // --- 5) فكّ database.enc بالمفتاح المُستعاد من الخزنة (لا من بيئة التشغيل) ---
  const point = await store.getRestorePoint(backup.recoveryPointId);
  const verification = await verifyRecoveryPoint(store, point.data);
  check('recovery point hashes verified', verification.ok === true, (verification.problems || []).join(','));
  const arts = verification.artifacts;
  const dbOnlyFromVault: Record<string, string> = { DRIVE_DB_BACKUP_KEY: vals.DRIVE_DB_BACKUP_KEY };
  const sqlDec = decryptDbDump(arts.db, dbOnlyFromVault);
  check('database decrypts with vault-recovered key', sqlDec.ok === true && String(sqlDec.sql).includes('owner'));
  // --- 6) رفض عبث قاعدة البيانات ---
  const tamperedDb = Buffer.from(String(arts.db).replace(/data: (.+)/, 'data: ' + 'A'.repeat(64)), 'utf8');
  check('tampered database rejected', decryptDbDump(tamperedDb, dbOnlyFromVault).ok === false);
  // --- 7) فكّ الأسرار بالمفتاح الرئيسي المُستعاد من الخزنة ---
  const secretsDec = decryptSecretsPackage(arts.secrets, { DR_RECOVERY_MASTER_KEY: vals.DR_RECOVERY_MASTER_KEY });
  check('secrets decrypt with vault-recovered master key', secretsDec.ok === true && secretsDec.secrets.SESSION_SECRET === ORIGINAL_ENV.SESSION_SECRET);
  check('wrong master key rejected', decryptSecretsPackage(arts.secrets, { DR_RECOVERY_MASTER_KEY: 'ff'.repeat(32) }).ok === false);

  // --- 8) استعادة المصدر إلى مجلد معزول + إقلاع نسخة معزولة ---
  const extracted = extractSourceBundle(arts.bundle);
  check('source extracted', extracted.ok === true && extracted.files.length === backup.manifest.fileCount);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gharabi-lostkeys-src-'));
  let boot: any = { booted: false };
  try {
    const written = materializeSource(extracted.files, workDir);
    check('source materialized', written.ok === true && fs.existsSync(path.join(workDir, 'server.ts')) && fs.existsSync(path.join(workDir, 'engine', 'storage', 'adapter.ts')));
    check('no raw db/secrets files in restored source', !fs.existsSync(path.join(workDir, 'database.enc')) && !fs.existsSync(path.join(workDir, 'secrets.enc')));

    boot = await bootRestoredSource(workDir, {
      NODE_ENV: 'production',
      STATE_DIR: path.join(workDir, '.state'),
      ...Object.fromEntries(Object.entries(secretsDec.secrets || {}).filter(([, v]) => typeof v === 'string')),
    });
    check('isolated restored app boots', boot.booted === true, boot.logSample);
    check('restored /api/health ok', boot.health?.ok === true);
    check('restored /api/readiness ok + applicationReady', boot.readiness?.ok === true && boot.readiness?.applicationReady === true);
    check('restored /api/dr/health responds', boot.drHealth?.ok === true);
    check('no secret leaked in boot logs', boot.secretLeak === false);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`DR LOST-KEYS TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR LOST-KEYS TESTS PASSED: ${passed} checks`);
}

main().catch((err) => {
  console.error('DR LOST-KEYS TESTS CRASHED:', err?.message || err);
  process.exit(1);
});
