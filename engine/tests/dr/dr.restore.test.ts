/**
 * اختبارات محرّك الاستعادة — Drive وهمي بالكامل، بلا قاعدة إنتاج وبلا أسرار حقيقية.
 *
 * يثبت: التحقق من البصمات، فكّ الأسرار، فكّ قاعدة البيانات، استخراج المصدر،
 * الاستعادة المعزولة، وفشل آمن عند: ملف ناقص، بصمة خاطئة، حزمة تالفة، مفتاح خاطئ.
 * **لا كتابة فوق الإنتاج** — الاختبار يثبت أن المحرّك لا يلمس الإنتاج.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import { runBackup } from '../../../tools/dr/backup.mjs';
import { encryptDbDump } from '../../../tools/dr/db-crypto.mjs';
import { buildSecretsBundle } from '../../../tools/dr/secret-crypto.mjs';
import { runRecoveryDrill, verifyRecoveryPoint, buildRestorePlan, applyDatabaseDump, extractSourceBundle } from '../../../tools/dr/restore.mjs';
import { SOURCE_BUNDLE_NAME, DB_DUMP_NAME, SECRETS_PACKAGE_NAME } from '../../../tools/dr/cloud-lib.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const KEY = 'c3'.repeat(32);
const ENV: Record<string, string> = { DRIVE_DB_BACKUP_KEY: KEY, GEMINI_API_KEY: 'AIzaSy' + 'r'.repeat(33), SESSION_SECRET: 'sess-' + 'w'.repeat(30) };
const SQL = JSON.stringify({ backend: 'postgres', rows: [{ key: 'workspace', value: { products: 1 } }, { key: 'serverUsers', value: [{ id: 'owner', role: 'owner' }] }] });

function makeStore(state: any) {
  const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' });
  return new DriveStore({ client });
}

const FILES = [
  { path: 'server.ts', content: 'export const server = 1;' },
  { path: 'package.json', content: '{"name":"al-gharabi-ai"}' },
  { path: 'src/App.tsx', content: 'export const App = 1;' },
];

async function makeBackup(state: any) {
  const store = makeStore(state);
  const result = await runBackup({
    store,
    files: FILES,
    dumpDatabase: async () => SQL,
    encryptDatabase: (sql: string) => encryptDbDump(sql, ENV),
    buildSecrets: () => buildSecretsBundle(ENV, { now: '2026-01-01T00:00:00.000Z' }),
    meta: { commit: 'c1', branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' },
    now: '2026-01-01T00:00:00.000Z',
  });
  return { store, result };
}

async function main() {
  // --- نسخة كاملة + استعادة معزولة ناجحة ---
  {
    const state = createFakeDriveState();
    const { store, result } = await makeBackup(state);
    check('backup created', result.state === 'backed_up' && result.verified === true);
    const point = (await store.getRestorePoint(result.recoveryPointId)).data;
    check('recovery point has secrets hash', /^[0-9a-f]{64}$/.test(point.manifest.encryptedSecretsHash));

    const plan = await buildRestorePlan(store, point, { env: ENV });
    check('plan verification ok', plan.verification.ok === true);
    check('plan has database + secrets', plan.database.present === true && plan.secrets.present === true);
    check('plan requires owner confirmation', plan.requiresOwnerConfirmation === true && plan.productionOverwrite === false);
    check('plan master key valid', plan.masterKey.state === 'valid');

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gharabi-drill-test-'));
    const report = await runRecoveryDrill({ store, point, env: ENV, workDir, now: '2026-01-02T00:00:00.000Z' });
    check('drill ok', report.ok === true && report.state === 'verified');
    check('drill manifest+hashes', report.checks.manifestAndHashes === true);
    check('drill secrets decrypt', report.checks.secretsDecrypt === true && report.secretsCount === 2);
    check('drill database decrypt', report.checks.databaseDecrypt === true);
    check('drill source extract', report.checks.sourceExtract === true && report.extractedFileCount === 3);
    check('drill wrote isolated source', report.checks.sourceMaterialized === true && report.materializedFileCount === 3);
    check('drill never wrote production', report.wroteToProduction === false && report.isolated === true);
    check('drill secrets not leaked in report', !JSON.stringify(report).includes('AIzaSy') && !JSON.stringify(report).includes('sess-'));
    check('restored server.ts exists', fs.existsSync(path.join(workDir, 'server.ts')));
    check('restored nested file exists', fs.existsSync(path.join(workDir, 'src/App.tsx')));
    fs.rmSync(workDir, { recursive: true, force: true });

    // --- قاعدة البيانات المعزولة: تطبيق النسخة المفكوكة على pool وهمي ---
    const drillDb = await runRecoveryDrill({ store, point, env: ENV, returnSql: true, includeDatabase: true });
    const queries: any[] = [];
    const fakePool = { query: async (sql: string, params?: any[]) => { queries.push({ sql, params }); return { rows: [] }; } };
    const applied = await applyDatabaseDump(drillDb.sql, fakePool as any);
    check('db dump applied to isolated pool', applied.ok === true && applied.mode === 'postgres' && applied.rows === 2);
    check('db restore created table first', queries[0].sql.includes('CREATE TABLE IF NOT EXISTS gharabi_state'));
  }

  // --- بصمة خاطئة: فشل آمن ---
  {
    const state = createFakeDriveState();
    const { store, result } = await makeBackup(state);
    const point = (await store.getRestorePoint(result.recoveryPointId)).data;
    // نُتلف حزمة المصدر نفسها عن قصد => بصمتها لا تطابق sourceHash في البيان.
    const bundleFile = [...state.files.values()].find((f: any) => f.parents.includes(point.folderId) && f.name === SOURCE_BUNDLE_NAME);
    bundleFile.content = Buffer.concat([bundleFile.content, Buffer.from('tampered')]);
    const v = await verifyRecoveryPoint(store, point);
    check('wrong source hash detected', v.ok === false && v.problems.includes('source_hash_mismatch'));
    const drill = await runRecoveryDrill({ store, point, env: ENV });
    check('wrong hash drill fails safely', drill.ok === false && drill.state === 'verify_failed');
  }

  // --- ملف ناقص (حزمة مصدر مفقودة) ---
  {
    const state = createFakeDriveState();
    const { store, result } = await makeBackup(state);
    const point = (await store.getRestorePoint(result.recoveryPointId)).data;
    const bundleFile = [...state.files.values()].find((f: any) => f.parents.includes(point.folderId) && f.name === SOURCE_BUNDLE_NAME);
    state.files.delete(bundleFile.id);
    const v = await verifyRecoveryPoint(store, point);
    check('missing bundle detected', v.ok === false && v.problems.includes('source_bundle_missing'));
    const drill = await runRecoveryDrill({ store, point, env: ENV });
    check('missing bundle drill fails safely', drill.ok === false);
  }

  // --- قاعدة بيانات مشفّرة تالفة ---
  {
    const state = createFakeDriveState();
    const { store, result } = await makeBackup(state);
    const point = (await store.getRestorePoint(result.recoveryPointId)).data;
    const dbFile = [...state.files.values()].find((f: any) => f.parents.includes(point.folderId) && f.name === DB_DUMP_NAME);
    dbFile.content = Buffer.from('CREATE TABLE raw(id int);');
    const drill = await runRecoveryDrill({ store, point, env: ENV });
    check('corrupted db dump fails safely', drill.ok === false);
  }

  // --- أسرار تالفة ---
  {
    const state = createFakeDriveState();
    const { store, result } = await makeBackup(state);
    const point = (await store.getRestorePoint(result.recoveryPointId)).data;
    const secFile = [...state.files.values()].find((f: any) => f.parents.includes(point.folderId) && f.name === SECRETS_PACKAGE_NAME);
    secFile.content = Buffer.from('GHARABI-SECRETS-V1\nencrypted: true\ncipher: aes-256-gcm\ndata: ' + 'A'.repeat(64) + '\n');
    const v = await verifyRecoveryPoint(store, point);
    check('tampered secrets detected', v.ok === false && v.problems.includes('secrets_hash_mismatch'));
  }

  // --- مفتاح خاطئ: يفشل فكّ الأسرار ---
  {
    const state = createFakeDriveState();
    const { store, result } = await makeBackup(state);
    const point = (await store.getRestorePoint(result.recoveryPointId)).data;
    const wrongEnv = { ...ENV, DRIVE_DB_BACKUP_KEY: 'd4'.repeat(32) };
    const drill = await runRecoveryDrill({ store, point, env: wrongEnv });
    check('wrong master key fails drill', drill.ok === false && drill.state === 'secrets_failed');
    check('wrong key reported explicitly', drill.problems.some((p: string) => p.startsWith('secrets_')));
  }

  // --- نقطة استعادة ناقصة (بلا بيان) ---
  {
    const state = createFakeDriveState();
    const { store, result } = await makeBackup(state);
    const point = (await store.getRestorePoint(result.recoveryPointId)).data;
    const manifestFile = [...state.files.values()].find((f: any) => f.parents.includes(point.folderId) && f.name === 'manifest.json');
    state.files.delete(manifestFile.id);
    const points = await store.listRestorePoints();
    const broken = points.data.find((p: any) => p.id === result.recoveryPointId);
    const v = await verifyRecoveryPoint(store, broken);
    check('incomplete point detected', v.ok === false && v.problems.includes('manifest_missing'));
  }

  // --- استخراج المصدر يرفض gzip تالف ---
  {
    const bad = extractSourceBundle(Buffer.from('not gzip'));
    check('invalid gzip rejected', bad.ok === false && bad.code === 'invalid_gzip');
  }

  if (failures.length) {
    console.error(`DR RESTORE TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR RESTORE TESTS PASSED: ${passed} checks`);
}

main().catch((err) => {
  console.error('DR RESTORE TESTS CRASHED:', err);
  process.exit(1);
});
