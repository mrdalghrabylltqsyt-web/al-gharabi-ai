/**
 * إثبات المرحلة 4 (DR Stage 4) — الترتيب المطلوب، تقرير JSON واحد صادق.
 *
 * خلفيتان:
 *   - الافتراضي: Google Drive **وهمي محلي** يطبّق نفس عقد REST (ناقل قابل للحقن).
 *     هذا يثبت منطق المنظومة كاملاً — وليس دليلاً على Google Drive الحقيقي.
 *   - `--real`: يستخدم اعتماد Drive الحقيقي من البيئة (DRIVE_OAUTH_*) ويرفع فعلاً.
 *     بدون اعتماد يفشل بأمان بلا أي ادعاء.
 *
 * لا يُطبع أي سرّ: التقرير حالات وأسماء وأعداد وبصمات فقط.
 *
 * التشغيل:
 *   npx tsx engine/tests/dr/dr.stage4.evidence.ts            # محلي (contract)
 *   npx tsx engine/tests/dr/dr.stage4.evidence.ts --real     # Google Drive حقيقي
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import { runBackup, computeSourceTree } from '../../../tools/dr/backup.mjs';
import { runCurrentMirror } from '../../../tools/dr/current-mirror.mjs';
import {
  verifyRecoveryPoint,
  runRecoveryDrill,
  buildRestorePlan,
  applyDatabaseDump,
} from '../../../tools/dr/restore.mjs';
import { encryptDbDump, decryptDbDump } from '../../../tools/dr/db-crypto.mjs';
import { buildSecretsBundle } from '../../../tools/dr/secret-crypto.mjs';
import {
  classifyDbDump,
  isEncryptedSecretsPackage,
  listSourceBundleFiles,
  scanForSecretsStrict,
  RECOVERY_INFO_NAME,
  RECOVERY_INSTRUCTIONS_NAME,
  SOURCE_BUNDLE_NAME,
  DB_DUMP_NAME,
  SECRETS_PACKAGE_NAME,
  MIRROR_MANIFEST_NAME,
} from '../../../tools/dr/cloud-lib.mjs';
import { collectRepoFiles } from '../../../tools/dr/cloud-sync.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

// مفتاح اختبار عابر (32 بايت) — ليس سرّ إنتاج. الأسرار الأخرى قيم وهمية للاختبار فقط.
const MASTER_KEY = 'a1'.repeat(32);
const SYNTH_SECRETS: Record<string, string> = {
  DR_RECOVERY_MASTER_KEY: MASTER_KEY,
  DRIVE_DB_BACKUP_KEY: 'b2'.repeat(32),
  DRIVE_TOKEN_ENCRYPTION_KEY: 'c3'.repeat(32),
  GEMINI_API_KEY: 'AIzaSy' + 'Z'.repeat(33),
  SESSION_SECRET: 'stage4-session-' + 'q'.repeat(30),
  RESEND_API_KEY: 're_stage4_' + 'k'.repeat(24),
};
const SQL = JSON.stringify({ backend: 'postgres', rows: [{ key: 'state', value: { users: [{ id: 'owner' }] } }] });
const TEST_FILE = 'dr-stage4-test-file.txt';

type StepResult = { n: number; name: string; ok: boolean; evidence: any; problems?: string[] };

const steps: StepResult[] = [];
function record(n: number, name: string, ok: boolean, evidence: any, problems: string[] = []): void {
  steps.push({ n, name, ok, evidence, problems });
}

function noSecret(obj: any): boolean {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return Object.values(SYNTH_SECRETS).every((v) => !text.includes(v));
}

async function main() {
  const real = process.argv.includes('--real');
  const report: any = {
    kind: 'dr-stage4-evidence',
    at: new Date().toISOString(),
    backend: real ? 'google-drive' : 'local-drive-contract',
    realGoogleDrive: real,
    note: real
      ? 'Google Drive حقيقي (اعتماد البيئة).'
      : 'Drive وهمي محلي يطبّق نفس عقد REST — يثبت المنطق، وليس دليل Google Drive حقيقي.',
    steps,
    problems: [],
    overall: 'FAIL',
  };

  const state = real ? null : createFakeDriveState();
  const client = real ? await buildRealClient() : new DriveClient({ transport: makeFakeTransport(state!), tokenProvider: () => 'tok' });
  if (!client) {
    report.problems.push('drive_not_configured');
    report.message = 'اعتماد Google Drive غير مضبوط في البيئة — لا رفع ولا ادعاء.';
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 0;
    return;
  }
  const store = new DriveStore({ client });

  const env = { ...SYNTH_SECRETS } as NodeJS.ProcessEnv;
  const meta = { commit: 'c'.repeat(40), branch: 'main', repository: 'mrdalghrabylltqsyt-web/al-gharabi-ai', project: 'al-gharabi-ai' };

  // ملفات المصدر = نفس ما يجمعها الإنتاج بالضبط.
  const repoFiles = collectRepoFiles(process.cwd()).included;

  // ---- النسخ: rp-002 (أساس) ثم rp-003 (يحتوي ملف اختبار مخصص) ----
  let priorMirror: any = null;
  const advance = (r: any) => {
    if (r.state === 'synced' || r.state === 'no_change') {
      priorMirror = { version: r.mirrorManifest?.version ?? priorMirror?.version ?? 1, treeHash: r.treeHash, files: r.mirrorManifest?.files ?? priorMirror?.files ?? [] };
    }
    return r;
  };
  const C1 = 'c1' + '0'.repeat(38);
  const C2 = 'c2' + '0'.repeat(38);
  const b1 = await runBackup({ store, files: repoFiles, dumpDatabase: async () => SQL, encryptDatabase: (s: string) => encryptDbDump(s, env), buildSecrets: () => buildSecretsBundle(env, {}), meta: { ...meta, commit: C1 }, now: new Date().toISOString() });
  advance(await runCurrentMirror({ store, files: repoFiles, commit: C1, previousMirror: priorMirror, now: new Date().toISOString() }));

  // rp-003 يحتوي ملف الاختبار المخصص (تُختبر مزامنته في الخطوات 7-9).
  const filesV1 = [...repoFiles, { path: TEST_FILE, content: 'dr-stage4 v1' }];
  const b2 = await runBackup({ store, files: filesV1, dumpDatabase: async () => SQL, encryptDatabase: (s: string) => encryptDbDump(s, env), buildSecrets: () => buildSecretsBundle(env, {}), meta: { ...meta, commit: C2 }, now: new Date().toISOString() });

  // 1) إنشاء rp-003 حقيقية
  const pointsAfter = await store.listRestorePoints();
  const ids = (pointsAfter.ok ? pointsAfter.data : []).map((p: any) => p.id);
  record(1, 'create_rp_003', b2.state === 'backed_up' && b2.recoveryPointId === 'rp-003' && ids.includes('rp-003'),
    { state: b2.state, verified: b2.verified === true, recoveryPointId: b2.recoveryPointId, existingPoints: ids, sourceHash: b2.sourceHash, treeHash: b2.treeHash });

  // 2) CURRENT كمجلد مرآة فردية للملفات (لا ملف مضغوط واحد)
  const mirror = await store.listMirrorFiles();
  const mirrorManifest = await store.readMirrorManifest();
  const mirrorPaths = (mirror.ok ? mirror.data : []).map((f: any) => f.path);
  const nested = mirrorPaths.filter((p: string) => p.includes('/'));
  record(2, 'current_mirror_individual_files',
    mirror.ok === true && mirrorPaths.length > 10 && nested.length > 0 && mirrorPaths.includes('server.ts') && mirrorPaths.includes('package.json') && mirrorManifest.ok && mirrorManifest.data?.kind === 'current-mirror',
    { fileCount: mirrorPaths.length, nestedExamples: nested.slice(0, 5), hasServerTs: mirrorPaths.includes('server.ts'), hasPackageJson: mirrorPaths.includes('package.json'), mirrorManifestKind: mirrorManifest.data?.kind ?? null, treeHash: mirrorManifest.data?.treeHash ?? null });

  // 3) HISTORY/rp-003
  const rp3 = await store.getRestorePoint('rp-003');
  const v3 = rp3.ok && rp3.data ? await verifyRecoveryPoint(store, rp3.data) : { ok: false, problems: ['not_found'] };
  record(3, 'history_rp_003', rp3.ok && Boolean(rp3.data) && v3.ok === true,
    { present: Boolean(rp3.data), folder: rp3.data?.id ?? null, immutable: rp3.data?.manifest?.immutable === true, verified: v3.ok === true, fileCount: rp3.data?.manifest?.fileCount ?? null });

  // 4) DATABASE: قاعدة البيانات المشفّرة فقط
  const dumps = await store.listDbDumps();
  const dumpFiles = dumps.ok ? dumps.data : [];
  let dbAllEncrypted = dumpFiles.length > 0;
  for (const f of dumpFiles) {
    const dl = await store.readFile(f.id);
    if (!dl.ok || !classifyDbDump(dl.data).allowed) dbAllEncrypted = false;
  }
  const dbDir = await store.subdirId('db');
  const dbChildren = dbDir ? await store.listChildren(dbDir) : { data: [] };
  const rawSqlPresent = (dbChildren.ok ? dbChildren.data : []).some((f: any) => /\.sql$/i.test(f.name) || /raw/i.test(f.name));
  record(4, 'database_dir_encrypted_only', dbAllEncrypted && !rawSqlPresent,
    { fileNames: dumpFiles.map((f: any) => f.name), allEncrypted: dbAllEncrypted, rawSqlPresent });

  // 5) SECRETS: الأسرار المشفّرة فقط، بلا أي سرّ مكشوف
  const secretsPkg = await store.readSecretsPackage();
  const secretsManifest = await store.readSecretsManifest();
  const pkgEncrypted = secretsPkg.ok && isEncryptedSecretsPackage(secretsPkg.data);
  const pkgText = secretsPkg.ok ? String(secretsPkg.data) : '';
  const noLeak = noSecret(pkgText) && noSecret(secretsManifest.data);
  record(5, 'secrets_dir_encrypted_only',
    pkgEncrypted && noLeak && Array.isArray(secretsManifest.data?.includedNames) && secretsManifest.data.includedNames.length >= 3,
    { encrypted: pkgEncrypted, includedNames: secretsManifest.data?.includedNames ?? [], includedCount: secretsManifest.data?.includedCount ?? null, noSecretValueLeaked: noLeak, payloadBytes: secretsPkg.ok ? secretsPkg.data.length : null });

  // 6) RECOVERY: وثائق الاستعادة
  const info = await store.readRecoveryDoc(RECOVERY_INFO_NAME);
  const instr = await store.readRecoveryDoc(RECOVERY_INSTRUCTIONS_NAME);
  const latest = await store.readLatestRecovery();
  record(6, 'recovery_docs', info.ok && Boolean(info.data) && instr.ok && Boolean(instr.data) && latest.ok && Boolean(latest.data) && noSecret(info.data) && noSecret(instr.data),
    { informationPresent: Boolean(info.ok && info.data), instructionsPresent: Boolean(instr.ok && instr.data), latestRecoveryPresent: Boolean(latest.ok && latest.data), latestRecoveryPointId: latest.data?.latestRecoveryPointId ?? null, noSecretValueLeaked: noSecret(info.data) && noSecret(instr.data) });

  // ---- اختبارات المزامنة على ملف اختبار مخصص ----
  let pm = priorMirror;
  const syncRun = async (files: any[], tag: string) => {
    const r = await runCurrentMirror({ store, files, commit: tag, previousMirror: pm, now: new Date().toISOString() });
    if (r.state === 'synced' || r.state === 'no_change') pm = { version: r.mirrorManifest?.version || 1, treeHash: r.treeHash, files: r.mirrorManifest?.files || [] };
    return r;
  };

  // 7) إضافة ملف
  const sAdd = await syncRun(filesV1, 'sync-add');
  const mirrorAfterAdd = await store.listMirrorFiles();
  const addPaths = (mirrorAfterAdd.ok ? mirrorAfterAdd.data : []).map((f: any) => f.path);
  record(7, 'sync_add_file', sAdd.state === 'synced' && addPaths.includes(TEST_FILE) && (sAdd.uploaded ?? 0) >= 1,
    { state: sAdd.state, uploaded: sAdd.uploaded ?? 0, fileInMirror: addPaths.includes(TEST_FILE) });

  // 8) تعديل ملف
  const filesV2 = [...repoFiles, { path: TEST_FILE, content: 'dr-stage4 v2-modified' }];
  const sMod = await syncRun(filesV2, 'sync-modify');
  const modRead = await store.readMirrorFile(TEST_FILE);
  const modContent = modRead.ok ? modRead.data.toString('utf8') : '';
  record(8, 'sync_modify_file', sMod.state === 'synced' && sMod.uploaded === 1 && modContent.includes('v2-modified'),
    { state: sMod.state, uploaded: sMod.uploaded ?? 0, contentUpdated: modContent.includes('v2-modified') });

  // 9) حذف ملف: ينعكس في CURRENT ولا يحذف من HISTORY
  const sDel = await syncRun(repoFiles, 'sync-delete');
  const mirrorAfterDel = await store.listMirrorFiles();
  const delPaths = (mirrorAfterDel.ok ? mirrorAfterDel.data : []).map((f: any) => f.path);
  const rp3Bundle = rp3.data?.folderId ? await store.readVersionFile(rp3.data.folderId, SOURCE_BUNDLE_NAME) : { ok: false };
  const rp3Files = rp3Bundle.ok ? listSourceBundleFiles(rp3Bundle.data).files : [];
  record(9, 'sync_delete_file_current_not_history',
    sDel.state === 'synced' && sDel.removed === 1 && !delPaths.includes(TEST_FILE) && rp3Files.includes(TEST_FILE),
    { state: sDel.state, removed: sDel.removed ?? 0, goneFromCurrentMirror: !delPaths.includes(TEST_FILE), stillInHistory_rp003: rp3Files.includes(TEST_FILE) });

  // 10) لا تغيير => لا نسخة تاريخية جديدة
  const pointsBeforeNC = (await store.listRestorePoints()).data.map((p: any) => p.id).sort();
  const sNo = await syncRun(repoFiles, 'sync-no-change');
  const curBeforeNC = await store.readCurrentManifest();
  // نفس مصدر النسخة الحالية (filesV1/C2) => لا تغيير => لا نقطة تاريخية جديدة.
  const bNo = await runBackup({ store, files: filesV1, dumpDatabase: async () => SQL, encryptDatabase: (s: string) => encryptDbDump(s, env), buildSecrets: () => buildSecretsBundle(env, {}), meta: { ...meta, commit: C2 }, now: new Date().toISOString() });
  const pointsAfterNC = (await store.listRestorePoints()).data.map((p: any) => p.id).sort();
  const curAfterNC = await store.readCurrentManifest();
  const { treeHash: expectedTree } = computeSourceTree(filesV1);
  const sourceUnchanged = curBeforeNC.data?.treeHash === expectedTree && curAfterNC.data?.treeHash === expectedTree;
  record(10, 'sync_no_change_no_new_history',
    sNo.state === 'no_change' && (sNo.uploaded ?? 0) === 0 && bNo.state === 'no_change' && JSON.stringify(pointsBeforeNC) === JSON.stringify(pointsAfterNC) && sourceUnchanged,
    { mirrorState: sNo.state, mirrorUploaded: sNo.uploaded ?? 0, backupState: bNo.state, backupReason: bNo.reason ?? null, currentTreeHash: curAfterNC.data?.treeHash ?? null, expectedTreeHash: expectedTree, sourceUnchanged, prevCommit: curBeforeNC.data?.commit ?? null, prevSourceHash: curBeforeNC.data?.sourceHash ?? null, pointsBefore: pointsBeforeNC, pointsAfter: pointsAfterNC });

  // 11) Recovery Drill معزول حقيقي (من rp-003)
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gharabi-stage4-'));
  const drill = await runRecoveryDrill({ store, point: rp3.data, env, workDir, returnSql: true, returnSecrets: false, now: new Date().toISOString() });
  let dbRestore: any = { attempted: false };
  if (drill.ok && drill.sql) {
    dbRestore = await tryIsolatedDbRestore(drill.sql);
  }
  const materializedOk = fs.existsSync(path.join(workDir, 'package.json')) && fs.existsSync(path.join(workDir, 'server.ts'));
  record(11, 'recovery_drill_isolated',
    drill.ok === true && drill.checks.sourceExtract === true && drill.checks.secretsDecrypt === true && drill.checks.databaseDecrypt === true && materializedOk && dbRestore.ok === true,
    { ok: drill.ok, checks: drill.checks, extractedFileCount: drill.extractedFileCount, materializedCriticalFiles: materializedOk, isolatedDatabase: dbRestore, neverWroteProduction: drill.wroteToProduction === false, secretsCount: drill.secretsCount ?? null });

  // 12) تلف نسخة اختبارية فقط: النسخة السليمة لا تُستبدل
  const tamper = await runTamperTest(store, rp3.data);
  record(12, 'tamper_detected_healthy_intact', tamper.detected === true && tamper.healthyStillVerified === true,
    { tamperDetected: tamper.detected, tamperProblems: tamper.problems, healthyRp002StillVerified: tamper.healthyStillVerified, healthyRp003Untouched: tamper.originalStillVerified });

  // 13) rp-002 ما زالت موجودة وسليمة
  const rp2 = await store.getRestorePoint('rp-002');
  const v2 = rp2.ok && rp2.data ? await verifyRecoveryPoint(store, rp2.data) : { ok: false };
  record(13, 'rp_002_intact', rp2.ok && Boolean(rp2.data) && v2.ok === true,
    { present: Boolean(rp2.data), verified: v2.ok === true, commit: rp2.data?.manifest?.commit ?? null, createdAt: rp2.data?.manifest?.createdAt ?? null });

  // 14) مسار الاستعادة «بنقرة واحدة» بدون استعادة إنتاجية فعلية
  const plan = await buildRestorePlan(store, rp3.data, { mode: 'isolated', env });
  record(14, 'one_click_restore_plan_no_production',
    plan.verification.ok === true && plan.requiresOwnerConfirmation === true && plan.productionOverwrite === false && plan.mode === 'isolated',
    { planVerified: plan.verification.ok, mode: plan.mode, requiresOwnerConfirmation: plan.requiresOwnerConfirmation, productionOverwrite: plan.productionOverwrite, steps: ['verify', 'decrypt secrets', 'decrypt database', 'extract source', 'restore isolated db', 'owner confirms production'] });

  // 15) بوابات الأمان
  const gates = await runSecurityGates(store, repoFiles);
  record(15, 'security_gates', gates.allPassed === true, gates.details);

  // ---- خلاصة ----
  report.problems = steps.filter((s) => !s.ok).map((s) => `step_${s.n}_${s.name}`);
  report.overall = report.problems.length === 0 ? 'PASS' : 'FAIL';
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.overall === 'PASS' ? 0 : 1;
}

/** يبني عميل Drive حقيقياً من البيئة، أو null عند غياب الاعتماد. */
async function buildRealClient() {
  const env = process.env;
  if (!env.DRIVE_OAUTH_CLIENT_ID || !env.DRIVE_OAUTH_CLIENT_SECRET || !env.DRIVE_OAUTH_REFRESH_TOKEN) return null;
  const { createGaxiosTransport } = await import('../../../tools/dr/drive-client.mjs');
  const { createRefreshTokenProvider } = await import('../../../tools/dr/drive-auth.mjs');
  return new DriveClient({ transport: createGaxiosTransport(), tokenProvider: createRefreshTokenProvider({ env }) });
}

/** يستعيد قاعدة معزولة (embedded postgres) إن كانت مثبّتة، وإلا يعلن التخطّي بصراحة. */
async function tryIsolatedDbRestore(sql: string) {
  const embedded = path.join(REPO_ROOT, 'tools', 'local-verification', 'node_modules', 'embedded-postgres', 'dist', 'index.js');
  if (!fs.existsSync(embedded)) return { attempted: false, ok: null, reason: 'embedded_postgres_not_installed' };
  try {
    const EmbeddedPostgres = (await import(pathToFileURL(embedded).href)).default;
    const pg = (await import('pg')).default;
    const port = 56500 + Math.floor(Math.random() * 300);
    const password = crypto.randomBytes(12).toString('hex');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gharabi-stage4-pg-'));
    const db = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password, port, persistent: false, onLog: () => {} });
    await db.initialise();
    await db.start();
    await db.createDatabase('gharabi_stage4');
    const url = `postgresql://postgres:${password}@127.0.0.1:${port}/gharabi_stage4?sslmode=disable`;
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    try {
      const applied = await applyDatabaseDump(sql, pool);
      const row = await pool.query("SELECT value FROM gharabi_state WHERE key = 'state'");
      return { attempted: true, ok: applied.ok === true && Boolean(row.rows?.[0]?.value), mode: applied.mode ?? null, rows: applied.rows ?? null, isolated: true, production: false };
    } finally {
      await pool.end().catch(() => {});
      await db.stop().catch(() => {});
    }
  } catch (err: any) {
    return { attempted: true, ok: false, code: String(err?.code || err?.message || 'failed').slice(0, 80) };
  }
}

/**
 * يلفّ المخزن بحيث يُعاد محتوى تالف **لنسخة اختبارية واحدة فقط** (rp-003)،
 * ويثبت أن التحقق يكتشف التلف بينما النسخ السليمة (rp-002) تبقى متحقّقة.
 */
async function runTamperTest(store: any, point: any) {
  const folderId = point?.folderId;
  const proxy = Object.create(store);
  proxy.readVersionFile = async (parent: string, name: string) => {
    const res = await store.readVersionFile(parent, name);
    if (parent === folderId && name === SOURCE_BUNDLE_NAME && res.ok) {
      const buf = Buffer.from(res.data);
      for (let i = 0; i < Math.min(64, buf.length); i += 4) buf[i] ^= 0xff;
      return { ok: true, data: buf };
    }
    return res;
  };
  const tampered = await verifyRecoveryPoint(proxy, point);
  const rp2 = await store.getRestorePoint('rp-002');
  const healthy = rp2.ok && rp2.data ? await verifyRecoveryPoint(store, rp2.data) : { ok: false };
  const original = await verifyRecoveryPoint(store, point);
  return { detected: tampered.ok === false, problems: tampered.problems, healthyStillVerified: healthy.ok === true, originalStillVerified: original.ok === true };
}

/** بوابات الأمان: رفض DB خام، رفض أسرار مكشوفة، منع تعديل نقطة موجودة، فحص أسرار المرآة. */
async function runSecurityGates(store: any, repoFiles: any[]) {
  const details: any = {};
  const rawDb = await store.uploadDbDump('raw.sql', 'CREATE TABLE t(id int); INSERT INTO t VALUES (1);');
  details.rejectsRawDatabase = rawDb.ok === false;
  details.rawDatabaseCode = rawDb.code ?? null;

  const plainSecrets = await store.writeSecretsPackage('plain-text-not-encrypted', { includedNames: [] });
  details.rejectsPlaintextSecrets = plainSecrets.ok === false;

  const immutable = await store.createRestorePoint('rp-003', { commit: 'x' });
  details.rejectsImmutableRewrite = immutable.ok === false && immutable.code === 'immutable_restore_point';

  const blocked = await runCurrentMirror({ store, files: [...repoFiles, { path: 'leak.ts', content: 'const k = "AIzaSy' + 'A'.repeat(33) + '";' }], commit: 'leak' });
  details.mirrorBlocksRealSecret = blocked.state === 'secret_blocked' && blocked.uploaded === 0;

  const scanClean = scanForSecretsStrict([{ path: 'a.ts', content: 'const refreshToken = t.refresh_token || null;' }]);
  details.strictScanAllowsCleanCode = scanClean.ok === true;

  const allPassed = details.rejectsRawDatabase && details.rejectsPlaintextSecrets && details.rejectsImmutableRewrite && details.mirrorBlocksRealSecret && details.strictScanAllowsCleanCode;
  return { allPassed, details };
}

main().catch((err) => {
  console.error(JSON.stringify({ kind: 'dr-stage4-evidence', overall: 'FAIL', crash: String(err?.message || err).slice(0, 200) }));
  process.exit(1);
});
