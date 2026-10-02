/**
 * اختبارات الاحتفاظ بنقاط الاستعادة (3 مكتملة دائماً) + الاستعادة المستقلة
 * + محاكاة فقدان المشروع بالكامل.
 *
 * يثبت بسلوك حقيقي (خادم Drive وهمي محلي، بلا شبكة وبلا مزوّد):
 *  A) سياسة الاحتفاظ: لا حذف قبل اكتمال الجديدة، ولا حذف النقاط المحميّة، 3 مكتملة.
 *  B) الاستعادة المستقلة: اختيار نقطة → مفتاح خزنة → فكّ → تحقق → استعادة كاملة.
 *  C) فشل المفتاح، نقطة تالفة، أسرار تالفة، قاعدة تالفة، بيئة هدف، منع قاعدة الإنتاج.
 *  D) فقدان المشروع بالكامل: Drive + نقطة + مفتاح يكفي (بلا خادم الغرابي).
 *  E) عدم حذف النقاط الأصلية + عدم كشف الأسرار + عدم تسجيل المفتاح + عدم التكرار.
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
import {
  planRetention,
  resolveKeep,
  resolveProtectedIds,
  pruneCompletedRestorePoints,
  recoveryPointRank,
  DEFAULT_PROTECTED_IDS,
  DEFAULT_KEEP,
} from '../../../tools/dr/retention.mjs';
import {
  listRecoveryPoints,
  runStandaloneRestore,
  inspectRecoveryReadiness,
  inspectTargetEnvironment,
  openKeyVault,
  buildRecoveryStore,
} from '../../../tools/dr/standalone-recovery.mjs';
import { runKeyVaultSync } from '../../dr/recoveryVault/vault';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// أسرار اختبار وهمية (ليست إنتاجاً). المفتاح الرئيسي هو نفسه المفتاح الأساسي لبنية DR.
const MASTER_KEY = 'a1'.repeat(32);
const VAULT_KEY = 'f9'.repeat(32);
const SYNTH_SECRETS: Record<string, string> = {
  DR_RECOVERY_MASTER_KEY: MASTER_KEY,
  DR_RECOVERY_VAULT_KEY: VAULT_KEY,
  DRIVE_DB_BACKUP_KEY: 'b2'.repeat(32),
  DRIVE_TOKEN_ENCRYPTION_KEY: 'c3'.repeat(32),
  SESSION_SECRET: 'sess-' + 'q'.repeat(40),
  PLATFORM_TOKEN_ENCRYPTION_KEY: 'd4'.repeat(32),
  GEMINI_API_KEY: 'AIzaSy' + 'Z'.repeat(33),
};
const SQL = JSON.stringify({ backend: 'postgres', rows: [{ key: 'state', value: { users: [{ id: 'owner' }] } }] });

function noSecret(obj: any): boolean {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return Object.values(SYNTH_SECRETS).every((v) => !text.includes(v));
}

function fullSource(tag: string) {
  const included = [
    { path: 'server.ts', content: `export const x = '${tag}';` },
    { path: 'package.json', content: '{"name":"al-gharabi-ai"}' },
    { path: 'package-lock.json', content: '{"lockfileVersion":3}' },
  ];
  for (let i = 0; i < 14; i += 1) included.push({ path: `engine/f${i}.ts`, content: `export const f${i} = '${tag}';` });
  return included;
}

const META = { commit: 'c'.repeat(40), branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' };

async function makeStore(state: any) {
  return new DriveStore({ client: new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' }) });
}

async function seedBackup(store: any, tag: string, env: any, commit = META.commit) {
  return runBackup({
    store,
    files: fullSource(tag),
    dumpDatabase: async () => SQL,
    encryptDatabase: (s: string) => encryptDbDump(s, env),
    buildSecrets: () => buildSecretsBundle(env, {}),
    meta: { ...META, commit },
    now: new Date().toISOString(),
  });
}

async function main() {
  const env: any = { ...SYNTH_SECRETS, DRIVE_OAUTH_CLIENT_ID: '1234567890-drive.apps.googleusercontent.com', DRIVE_OAUTH_CLIENT_SECRET: 'GOCSPX-' + 'drive-fake-test-secret', DRIVE_OAUTH_REFRESH_TOKEN: '1//fake-refresh-token-for-test' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gharabi-standalone-'));

  // ---------- A) سياسة الاحتفاظ (منطق صافٍ) ----------
  {
    check('default keep = 3', DEFAULT_KEEP === 3 && resolveKeep({}) === 3);
    check('protected default = rp-002/003/004', JSON.stringify(resolveProtectedIds({})) === JSON.stringify(DEFAULT_PROTECTED_IDS));
    check('keep override honored', resolveKeep({ DR_RETENTION_KEEP: '5' }) === 5);
    check('keep invalid => default', resolveKeep({ DR_RETENTION_KEEP: '0' }) === 3 && resolveKeep({ DR_RETENTION_KEEP: 'x' }) === 3);
    check('rank parses rp-NNN', recoveryPointRank('rp-005') === 5 && recoveryPointRank('x') === -1);

    const pts = [
      { id: 'rp-002', complete: true },
      { id: 'rp-003', complete: true },
      { id: 'rp-004', complete: true },
      { id: 'rp-005', complete: true },
    ];
    const plan = planRetention(pts, { keep: 3, protect: ['rp-002', 'rp-003', 'rp-004'], newestId: 'rp-005' });
    check('protected points never deleted', plan.toDelete.length === 0, JSON.stringify(plan));
    check('all kept when protected', plan.kept.length === 4);

    const pts2 = [
      { id: 'rp-005', complete: true },
      { id: 'rp-006', complete: true },
      { id: 'rp-007', complete: true },
      { id: 'rp-008', complete: true },
    ];
    const plan2 = planRetention(pts2, { keep: 3, protect: ['rp-002', 'rp-003', 'rp-004'], newestId: 'rp-008' });
    check('oldest unprotected complete deleted', JSON.stringify(plan2.toDelete) === JSON.stringify(['rp-005']), JSON.stringify(plan2));
    check('newest never deleted', !plan2.toDelete.includes('rp-008'));
    check('kept = 3 after prune', plan2.kept.length === 3);

    // نقطة محميّة داخل قائمة مكتملة لا تُحذف أبداً حتى لو كانت الأقدم.
    const planProt = planRetention(
      [{ id: 'rp-004', complete: true }, { id: 'rp-005', complete: true }, { id: 'rp-006', complete: true }, { id: 'rp-007', complete: true }, { id: 'rp-008', complete: true }],
      { keep: 3, protect: ['rp-004'], newestId: 'rp-008' },
    );
    check('protected oldest skipped, next oldest deleted', JSON.stringify(planProt.toDelete) === JSON.stringify(['rp-005']), JSON.stringify(planProt));
    check('protected point reported as skipped', planProt.skippedProtected.includes('rp-004'));

    const pts3 = [
      { id: 'rp-004', complete: true },
      { id: 'rp-005', complete: false }, // قيد الإنشاء (ناقصة)
      { id: 'rp-006', complete: true },
    ];
    const plan3 = planRetention(pts3, { keep: 3, protect: [], newestId: 'rp-006' });
    check('incomplete never deleted', !plan3.toDelete.includes('rp-005'), JSON.stringify(plan3));
    check('incomplete reported separately', plan3.incomplete.includes('rp-005'));
  }

  // ---------- A2) الاحتفاظ الفعلي على مخزن Drive ----------
  {
    const state = createFakeDriveState();
    const store = await makeStore(state);
    const b1 = await seedBackup(store, 'v1', env, 'a1' + '0'.repeat(38));
    check('backup1 created point', /^rp-\d+/.test(b1.recoveryPointId || ''), JSON.stringify(b1).slice(0, 200));
    const before = await store.listRestorePoints();
    const countBefore = before.data.length;
    // محاولة تقليم قبل اكتمال أي نسخة جديدة: لا يجب أن يحذف النقطة الوحيدة (newest).
    const prune1 = await pruneCompletedRestorePoints(store, { keep: 1, protect: [], newestId: b1.recoveryPointId, now: new Date().toISOString() });
    check('prune keeps newest point', prune1.deleted.length === 0 && prune1.ok === true, JSON.stringify(prune1));
    const after = await store.listRestorePoints();
    check('no point lost by prune', after.data.length === countBefore);
  }

  // ---------- B) الاستعادة المستقلة الكاملة ----------
  let primaryState: any = null;
  let primaryStore: any = null;
  let primaryPoint: any = null;
  {
    const state = createFakeDriveState();
    primaryState = state;
    const store = await makeStore(state);
    primaryStore = store;
    const b = await seedBackup(store, 'restore-v1', env, 'ab' + '0'.repeat(38));
    check('standalone seed backup ok', b.state === 'backed_up' && b.verified === true, JSON.stringify(b).slice(0, 200));
    // خزنة المفاتيح: مزامنة فعلية (تحتاج DR_RECOVERY_VAULT_KEY).
    const kv = await runKeyVaultSync({ store, env, now: new Date().toISOString() });
    check('key vault synced', kv.state === 'synced' && kv.recordCount >= 1, JSON.stringify(kv).slice(0, 200));

    const listed = await listRecoveryPoints(store);
    check('standalone lists points', listed.ok && listed.points.length >= 1);
    const point = listed.points.find((p) => p.id === b.recoveryPointId);
    check('point is restorable', point && point.restorable === true, JSON.stringify(point?.verification));
    check('point exposes fileCount/commit', point.fileCount >= 15 && typeof point.commit === 'string');
    check('listed point carries manifest+folderId', Boolean(point.manifest && point.folderId));
    primaryPoint = point;

    // استعادة كاملة إلى مجلد هدف (بلا قاعدة هدف).
    const targetDir = path.join(tmp, 'restored');
    const report = await runStandaloneRestore({ store, point, env, targetDir, applyDatabase: false, now: new Date().toISOString() });
    check('standalone restore ok', report.ok === true, JSON.stringify(report.problems));
    check('restore reached complete', report.stage === 'complete');
    check('restore decrypted vault', report.checks.vaultDecrypt === true && report.vaultRecordCount >= 1);
    check('restore decrypted secrets', report.checks.secretsDecrypt === true && report.secretsCount >= 1);
    check('restore decrypted database', report.checks.databaseDecrypt === true);
    check('restore extracted source', report.extractedFileCount >= 15);
    check('restore file count matches manifest', report.checks.fileCountMatch === true);
    check('restore materialized files', report.checks.sourceMaterialized === true && report.materializedFileCount >= 15);
    check('restore never wrote to production', report.wroteToProduction === false);
    check('restore left point untouched', report.immutablePointUntouched === true);
    check('restore report has no secret', noSecret(report));
    // الملفات الفعلية مكتوبة على القرص.
    const serverFile = path.join(targetDir, 'server.ts');
    check('restored server.ts exists', fs.existsSync(serverFile) && fs.readFileSync(serverFile, 'utf8').includes("'restore-v1'"));
    // النقطة الأصلية لم تُمسّ: لا تزال موجودة وسليمة.
    const after = await store.listRestorePoints();
    check('original point still present', after.data.some((p: any) => p.id === b.recoveryPointId));
    const verifyAgain = await listRecoveryPoints(store);
    check('original point still restorable', verifyAgain.points.find((p: any) => p.id === b.recoveryPointId)?.restorable === true);
  }

  // ---------- C) فشل المفتاح ----------
  {
    const badEnv: any = { ...SYNTH_SECRETS, DR_RECOVERY_VAULT_KEY: '00'.repeat(32) };
    const report = await runStandaloneRestore({ store: primaryStore, point: primaryPoint, env: badEnv, targetDir: path.join(tmp, 'bad-key'), applyDatabase: false });
    check('wrong vault key => fail at open_vault', report.ok === false && report.failureStage === 'open_vault', JSON.stringify(report.problems));
    check('wrong key => no source materialized', report.extractedFileCount == null);
    check('wrong key report has no secret', noSecret(report));
  }

  // ---------- C2) نقطة تالفة (نقص في الحزمة) ----------
  {
    const state = createFakeDriveState();
    const store = await makeStore(state);
    const b = await seedBackup(store, 'corrupt', env, 'cc' + '0'.repeat(38));
    // نُتلف ملف الأسرار داخل النقطة (نستبدل المحتوى).
    const pts = await store.listRestorePoints();
    const p = pts.data.find((x: any) => x.id === b.recoveryPointId);
    // نكتب ملف secrets.enc محتوى غير صالح في مجلد النقطة.
    await store.upsertFile(p.folderId, 'secrets.enc', Buffer.from('GHARABI-SECRETS-V1\ncorrupted: true\n'), 'application/octet-stream');
    const listed = await listRecoveryPoints(store);
    const point = listed.points.find((x: any) => x.id === b.recoveryPointId);
    check('corrupted point not restorable', point.restorable === false, JSON.stringify(point.verification.problems));
    const report = await runStandaloneRestore({ store, point, env, targetDir: path.join(tmp, 'corrupt'), applyDatabase: false });
    check('corrupted point restore fails before writing', report.ok === false && report.failureStage === 'verify_point', JSON.stringify(report.problems));
    check('corrupted point still exists (not deleted)', (await store.listRestorePoints()).data.some((x: any) => x.id === b.recoveryPointId));
  }

  // ---------- C3) قاعدة الهدف = الإنتاج => رفض ----------
  {
    const prodEnv: any = { ...SYNTH_SECRETS, DATABASE_URL: 'postgres://prod', DR_RECOVERY_TEST_DATABASE_URL: 'postgres://prod' };
    const report = await runStandaloneRestore({ store: primaryStore, point: primaryPoint, env: prodEnv, targetDir: path.join(tmp, 'refuse'), applyDatabase: true });
    check('production database refused', report.ok === false && report.problems.includes('REFUSED_PRODUCTION_DATABASE'), JSON.stringify(report.problems));
    const target = inspectTargetEnvironment(prodEnv, {});
    check('target env marks sameAsProduction', target.sameAsProduction === true && target.databaseReady === false);
  }

  // ---------- C4) بيئة الهدف غير متاحة => لا كتابة قاعدة، لكن المصدر يُستعاد ----------
  {
    const noDbEnv: any = { ...SYNTH_SECRETS };
    const target = inspectTargetEnvironment(noDbEnv, {});
    check('no target db => not ready', target.databaseReady === false && target.isolatedDatabaseUrlConfigured === false);
    check('external requirements declared', Array.isArray(target.externalRequirements) && target.externalRequirements.length >= 1);
    const report = await runStandaloneRestore({ store: primaryStore, point: primaryPoint, env: noDbEnv, targetDir: path.join(tmp, 'nodb'), applyDatabase: true });
    check('restore still ok without target db (source only)', report.ok === true && report.checks.databaseRestored === false, JSON.stringify(report.problems));
    check('restore declares external requirement', report.externalRequirements.length >= 1);
  }

  // ---------- D) محاكاة فقدان المشروع بالكامل ----------
  {
    // لا خادم الغرابي، لا dist، لا جلسة: نُقلّل المدخلات إلى Drive + نقطة + مفتاح.
    const listed = await listRecoveryPoints(primaryStore);
    const point = listed.points.find((p) => p.restorable === true);
    const report = await runStandaloneRestore({ store: primaryStore, point, env: { ...SYNTH_SECRETS }, targetDir: path.join(tmp, 'lost-project'), applyDatabase: false });
    check('project-loss: reachable with drive+point+vault key', report.ok === true);
    check('project-loss: stages recorded', report.stages.includes('verify_point') && report.stages.includes('open_vault') && report.stages.includes('restore_source'));
    check('project-loss: no secret exposed', noSecret(report));
    const readiness = await inspectRecoveryReadiness(env as any);
    check('readiness: drive configured', readiness.drive.configured === true);
    check('readiness: refresh token stored', readiness.drive.refreshTokenStored === true);
    check('readiness: vault key present', readiness.vaultKey.present === true);
    check('readiness: master key state valid', readiness.masterKey.state === 'valid', JSON.stringify(readiness.masterKey));
    const readinessMissing = await inspectRecoveryReadiness({} as any);
    check('readiness without env: drive not configured', readinessMissing.drive.configured === false);
  }

  // ---------- E) عدم تكرار الاستعادة + عدم حذف النقاط الأصلية ----------
  {
    const before = await primaryStore.listRestorePoints();
    const countBefore = before.data.length;
    await runStandaloneRestore({ store: primaryStore, point: primaryPoint, env, targetDir: path.join(tmp, 'again'), applyDatabase: false });
    const after = await primaryStore.listRestorePoints();
    check('repeat restore does not delete/create points', after.data.length === countBefore);
    check('repeat restore leaves point restorable', (await listRecoveryPoints(primaryStore)).points.find((p: any) => p.id === primaryPoint.id)?.restorable === true);
  }

  // ---------- F) openKeyVault مباشرة (بلا شبكة) ----------
  {
    const vault = await openKeyVault(primaryStore, env);
    check('openKeyVault ok', vault.ok === true && vault.recordCount >= 1);
    check('openKeyVault integrity', vault.integrity.recordsMatch === true);
    check('openKeyVault records metadata has no secret', noSecret(vault.records));
    const bad = await openKeyVault(primaryStore, { ...SYNTH_SECRETS, DR_RECOVERY_VAULT_KEY: '11'.repeat(32) });
    check('openKeyVault wrong key fails', bad.ok === false);
  }

  // ---------- G) buildRecoveryStore يبني مخزناً قراءة فقط ----------
  {
    const state = createFakeDriveState();
    const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' });
    const store = buildRecoveryStore(client, {});
    check('buildRecoveryStore returns store', typeof store.listRestorePoints === 'function');
  }

  // ---------- H) واجهة الويب المستقلة (خادم محلي بلا الغرابي) ----------
  {
    const { createRecoveryUiServer } = await import('../../../tools/dr/recovery-console-ui.mjs');
    const state = createFakeDriveState();
    const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' });
    const server = createRecoveryUiServer({ env, clientFactory: () => client, targetDir: path.join(tmp, 'ui-restored') });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;
    const base = `http://127.0.0.1:${port}`;
    try {
      const html = await (await fetch(`${base}/`)).text();
      check('ui serves html page', html.includes('واجهة الاستعادة المستقلة') && html.includes('DR_RECOVERY_VAULT_KEY'));
      // نزرع نسخة في نفس المخزن عبر نفس العميل.
      const store = new DriveStore({ client });
      const b = await seedBackup(store, 'ui-v1', env, 'dd' + '0'.repeat(38));
      await runKeyVaultSync({ store, env, now: new Date().toISOString() });
      const pts = await (await fetch(`${base}/api/points`)).json();
      check('ui points ok', pts.ok === true && pts.points.length >= 1);
      check('ui readiness shown', pts.readiness.drive.configured === true);
      const point = pts.points.find((p: any) => p.id === b.recoveryPointId);
      check('ui lists seeded point', Boolean(point && point.restorable === true));
      // بلا تأكيد => 428.
      const noConfirm = await fetch(`${base}/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ point: point.id }) });
      check('ui restore requires confirm', noConfirm.status === 428);
      // مفتاح خاطئ => فشل صريح بلا استخراج.
      const badKey = await (await fetch(`${base}/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ point: point.id, confirm: true, vaultKey: '99'.repeat(32) }) })).json();
      check('ui wrong key blocked', badKey.ok === false && badKey.report.failureStage === 'open_vault');
      // استعادة فعلية => نجاح بلا سرّ.
      const good = await (await fetch(`${base}/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ point: point.id, confirm: true, vaultKey: VAULT_KEY }) })).json();
      check('ui restore ok', good.ok === true, JSON.stringify(good.report?.problems));
      check('ui restore no secret', noSecret(good));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  // ---------- I) خدمة مركز الاستعادة المستقلة (Recovery Center) ----------
  {
    const { createRecoveryCenterServer, honestStatesFromReport, RECOVERY_HONEST_STATES, parseTargetEnv } =
      await import('../../../tools/dr/recovery-center.mjs');
    // نفس الوحدة موجودة في حزمة النشر المستقلة؛ نتحقق من التكافؤ (بلا انحراف).
    const shipped = await import('../../../dr-recovery-center/lib/recovery-center.mjs');
    check('recovery-center shipped lib exports same api', typeof shipped.createRecoveryCenterServer === 'function' && typeof shipped.honestStatesFromReport === 'function');
    check('recovery-center shipped lib parseTargetEnv matches', JSON.stringify(shipped.parseTargetEnv('A=1\nB=2')) === JSON.stringify(parseTargetEnv('A=1\nB=2')));

    check('honest states are 8 and explicit', RECOVERY_HONEST_STATES.length === 8 && RECOVERY_HONEST_STATES.every((s) => s.key && s.labelAr));
    // لا ادّعاء نجاح: تقرير فاشل لا يُظهر حالات متحققة.
    const failed = honestStatesFromReport({ checks: { pointVerified: false }, stages: [] });
    check('honest states: failure => no false success', Object.values(failed).every((v) => v === false));
    const partial = honestStatesFromReport({ checks: { pointVerified: true, vaultDecrypt: true, sourceExtract: true, fileCountMatch: true }, stages: ['verify_point', 'open_vault', 'restore_source'] });
    check('honest states: partial reflects only done', partial.verified === true && partial.source_restored === true && partial.database_restored === false && partial.service_started === false);

    check('parseTargetEnv KEY=VALUE', JSON.stringify(parseTargetEnv('DR_RECOVERY_TEST_DATABASE_URL=postgres://x/y')) === JSON.stringify({ DR_RECOVERY_TEST_DATABASE_URL: 'postgres://x/y' }));
    check('parseTargetEnv ignores non-env keys', Object.keys(parseTargetEnv('foo=bar\nBad-Key=1')).length === 0);

    // خادم حقيقي بخادم Drive وهمي: الحالة، النقاط، التحقق، الاستعادة، وعدم تسريب المفتاح.
    const state = createFakeDriveState();
    const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' });
    const server = createRecoveryCenterServer({ env, clientFactory: () => client, targetDir: path.join(tmp, 'center-restored') });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const base = (server.address() as any).port;
    const cbase = `http://127.0.0.1:${base}`;
    try {
      const store = new DriveStore({ client });
      const b = await seedBackup(store, 'center-v1', env, 'ee' + '0'.repeat(38));
      await runKeyVaultSync({ store, env, now: new Date().toISOString() });

      const health = await (await fetch(`${cbase}/api/health`)).json();
      check('center health ok + standalone', health.ok === true && health.standalone === true);
      check('center health: no vault key in env', health.vaultKeyInEnv === false);
      check('center health: honest states listed', Array.isArray(health.honestStates) && health.honestStates.length === 8);

      const html = await (await fetch(`${cbase}/`)).text();
      check('center serves Arabic page', html.includes('مركز استعادة الغرابي AI') && html.includes('DR_RECOVERY_VAULT_KEY'));

      const pts = await (await fetch(`${cbase}/api/points`)).json();
      check('center lists points', pts.ok === true && pts.points.length >= 1);
      const point = pts.points.find((p: any) => p.id === b.recoveryPointId);
      check('center point restorable + fields', Boolean(point && point.restorable === true && point.hashes.sourceHash && point.database.encrypted));

      // تحقق قراءة فقط بمفتاح خاطئ => لا نجاح.
      const badVerify = await (await fetch(`${cbase}/api/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ point: point.id, vaultKey: '77'.repeat(32) }) })).json();
      check('center verify wrong key fails', badVerify.ok === false && badVerify.report.states.vault_opened === false);
      // تحقق صحيح => جاهز.
      const goodVerify = await (await fetch(`${cbase}/api/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ point: point.id, vaultKey: VAULT_KEY }) })).json();
      check('center verify ok', goodVerify.ok === true && goodVerify.report.readOnly === true && goodVerify.report.states.vault_opened === true);
      check('center verify no secret', noSecret(goodVerify));

      // بلا تأكيد => 428.
      const noConfirm = await fetch(`${cbase}/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ point: point.id }) });
      check('center restore requires confirm', noConfirm.status === 428);
      // استعادة فعلية => نجاح + حالات صادقة + بلا سرّ.
      const restore = await (await fetch(`${cbase}/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ point: point.id, confirm: true, vaultKey: VAULT_KEY, targetEnv: 'DR_RECOVERY_TEST_DATABASE_URL=postgres://isolated/x' }) })).json();
      check('center restore ok', restore.ok === true, JSON.stringify(restore.report?.problems));
      check('center restore honest states', restore.report.states.verified === true && restore.report.states.source_restored === true && restore.report.states.service_started === false);
      check('center restore no secret', noSecret(restore));
      check('center restore target env names only', Array.isArray(restore.report.targetEnvNames) && !JSON.stringify(restore.report.targetEnvNames).includes('postgres://'));
      // النقطة الأصلية سليمة (لم تُعدَّل).
      check('center did not modify original point', (await listRecoveryPoints(store)).points.find((p: any) => p.id === b.recoveryPointId)?.restorable === true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nstandalone-recovery + retention: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
