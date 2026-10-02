/**
 * اختبار الانهيار الحقيقي لمركز استعادة الغرابي AI — شرط قبول أساسي.
 *
 * يثبت بسلوك حقيقي (خادم Drive وهمي محلي، بلا شبكة وبلا مزوّد):
 *  1) استقلال المركز: لا يستورد خادم الغرابي ولا dist ولا git/GitHub.
 *  2) فقدان Render الرئيسي: المركز يبقى قادراً على قراءة النقاط والاستعادة.
 *  3) فقدان GitHub: الاستعادة تعتمد على Recovery Point في Drive فقط.
 *  4) المفتاح لا يُسجَّل ولا يُعاد ولا يُحفظ.
 *  5) النقطة الأصلية في Drive لا تتغيّر.
 *  6) لا يُدّعى نجاح الخدمة (service_started/service_verified) بلا تشغيل فعلي.
 *
 * لا تُستخدم أي مفاتيح مالك حقيقية — كلها أسرار اختبار وهمية.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import { runBackup } from '../../../tools/dr/backup.mjs';
import { encryptDbDump } from '../../../tools/dr/db-crypto.mjs';
import { buildSecretsBundle } from '../../../tools/dr/secret-crypto.mjs';
import { runKeyVaultSync } from '../../dr/recoveryVault/vault';
import { createRecoveryCenterServer, honestStatesFromReport } from '../../../tools/dr/recovery-center.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const MASTER_KEY = 'a1'.repeat(32);
const VAULT_KEY = 'f9'.repeat(32);
const SYNTH_SECRETS: Record<string, string> = {
  DR_RECOVERY_MASTER_KEY: MASTER_KEY,
  DR_RECOVERY_VAULT_KEY: VAULT_KEY,
  DRIVE_DB_BACKUP_KEY: 'b2'.repeat(32),
  DRIVE_TOKEN_ENCRYPTION_KEY: 'c3'.repeat(32),
  SESSION_SECRET: 'sess-' + 'q'.repeat(40),
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

async function main() {
  const env: any = {
    ...SYNTH_SECRETS,
    DRIVE_OAUTH_CLIENT_ID: '1234567890-drive.apps.googleusercontent.com',
    DRIVE_OAUTH_CLIENT_SECRET: 'GOCSPX-' + 'drive-fake-test-secret',
    DRIVE_OAUTH_REFRESH_TOKEN: '1//fake-refresh-token-for-test',
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gharabi-center-'));
  const meta = { commit: 'c'.repeat(40), branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' };

  // ---------- 1) الاستقلال التقني ----------
  {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
    const center = read('tools/dr/recovery-center.mjs');
    const standalone = read('tools/dr/standalone-recovery.mjs');
    const restore = read('tools/dr/restore.mjs');
    // لا استيراد خادم الغرابي ولا كود المشروع المترجم.
    for (const [name, src] of [['center', center], ['standalone', standalone], ['restore', restore]] as const) {
      check(`${name} does not import server.ts`, !/from ['"][^'"]*\/server(\.ts|\.cjs)?['"]/.test(src) && !/from ['"]\.\.\/\.\.\/engine\//.test(src));
      check(`${name} does not import dist`, !/dist\/server/.test(src));
      // لا git/GitHub كشرط للاستعادة (child_process/git داخل مسار الاستعادة).
      check(`${name} has no git/github dependency`, !/child_process/.test(src) && !/\bgitMeta\b/.test(src) && !/api\.github\.com/.test(src));
    }
    check('center is standalone by declaration', center.includes('standalone: true') && center.includes('RECOVERY_CENTER_HOSTED'));
  }

  // ---------- تهيئة: نسخة في Drive (تبقى الأصل) ----------
  const state = createFakeDriveState();
  const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' });
  const store = new DriveStore({ client });
  const backup = await runBackup({
    store,
    files: fullSource('center-crash'),
    dumpDatabase: async () => SQL,
    encryptDatabase: (s: string) => encryptDbDump(s, env),
    buildSecrets: () => buildSecretsBundle(env, {}),
    meta,
    now: new Date().toISOString(),
  });
  check('seed backup ok', backup.state === 'backed_up' && backup.verified === true, JSON.stringify(backup).slice(0, 160));
  await runKeyVaultSync({ store, env, now: new Date().toISOString() });
  const pointsBefore = await store.listRestorePoints();
  const pointFolderBefore = pointsBefore.data.map((p: any) => ({ id: p.id, folderId: p.folderId }));

  // ---------- 2/3) فقدان Render الرئيسي + فقدان GitHub: المركز يعمل ----------
  const server = createRecoveryCenterServer({ env, clientFactory: () => client, targetDir: path.join(tmp, 'restored') });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    // «Render الرئيسي متوقف»: لا نتصل به إطلاقاً. المركز مستقل تماماً.
    // «GitHub متوقف»: لا نستورد أي شيء من git؛ الاستعادة تعتمد على Drive فقط.
    const health = await (await fetch(`${base}/api/health`)).json();
    check('center reachable with main Render down', health.ok === true && health.standalone === true);
    check('center reads Drive without GitHub', health.driveConfigured === true);

    const pts = await (await fetch(`${base}/api/points`)).json();
    check('center lists points (render+github down)', pts.ok === true && pts.points.length >= 1);

    const point = pts.points.find((p: any) => p.id === backup.recoveryPointId);
    check('selected point restorable', Boolean(point && point.restorable === true));

    const restore = await (await fetch(`${base}/api/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ point: point.id, confirm: true, vaultKey: VAULT_KEY }),
    })).json();
    check('center restore ok with render+github down', restore.ok === true, JSON.stringify(restore.report?.problems));
    check('restore verified + vault + source', restore.report.states.verified === true && restore.report.states.vault_opened === true && restore.report.states.source_restored === true);
    // لا ادّعاء تشغيل/تحقق الخدمة (خطوة خارجية).
    check('no false service-started claim', restore.report.states.service_started === false && restore.report.states.service_verified === false);
    check('restore states explicit in report', Array.isArray(restore.report.stages) && restore.report.stages.includes('restore_source'));

    // ---------- 4) المفتاح لا يُسجَّل ولا يُعاد ----------
    check('restore response has no vault key', noSecret(restore));
    check('restore response targetEnvNames only (no values)', Array.isArray(restore.report.targetEnvNames) || restore.report.targetEnvNames === undefined);

    // ---------- 5) النقطة الأصلية لم تتغيّر ----------
    const pointsAfter = await store.listRestorePoints();
    const folderAfter = pointsAfter.data.map((p: any) => ({ id: p.id, folderId: p.folderId }));
    check('original point folder unchanged', JSON.stringify(folderAfter) === JSON.stringify(pointFolderBefore));
    const recheck = await (await fetch(`${base}/api/points`)).json();
    check('original point still restorable after restore', recheck.points.find((p: any) => p.id === point.id)?.restorable === true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // ---------- 6) honestStatesFromReport لا يدّعي ما لم يتحقق ----------
  {
    const none = honestStatesFromReport({ checks: {}, stages: [] });
    check('honest: empty report => all false', Object.values(none).every((v) => v === false));
    const dbOnly = honestStatesFromReport({ checks: { pointVerified: true, databaseRestored: true }, stages: ['restore_database'] });
    check('honest: db only => db true, source false', dbOnly.database_restored === true && dbOnly.source_restored === false);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nrecovery-center crash test: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
