/**
 * اختبار مصدر رمز تجديد Drive لمركز الاستعادة المستقل.
 *
 * يثبت (بلا شبكة وبلا مزوّد حقيقي — قاعدة pg وهمية وDrive وهمي):
 *  1) الرمز يُقرأ من **قاعدة الحالة المشفّرة** (gharabi_state.control.driveRefreshToken)
 *     ويُفكّ بمفتاح التشفير نفسه — بلا نقل أي رمز نصي إلى خدمة الاستعادة.
 *  2) ترتيب المصادر: صريح → مشفّر مُمرَّر → بيئة نصية (توافق خلفي) → قاعدة الحالة.
 *  3) أكواد الفشل صريحة (state_db_not_configured / refresh_token_not_found /
 *     refresh_token_undecryptable / state_db_error / token_key_missing).
 *  4) مركز الاستعادة يقرأ نقاط الاستعادة الحقيقية عبر هذا المسار.
 *  5) لا يُسرّب أي رمز أو قيمة سرّية في الصحة/النقاط/التحقق.
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
import { encryptDriveSecret } from '../../../tools/dr/drive-auth.mjs';
import {
  resolveRefreshTokenSource,
  inspectRefreshTokenSource,
  loadRefreshTokenFromDatabase,
  stateDatabaseUrl,
  DR_STATE_DATABASE_URL_ENV,
} from '../../../tools/dr/token-source.mjs';
import { buildRecoveryClient } from '../../../tools/dr/standalone-recovery.mjs';
import { createRecoveryCenterServer } from '../../../tools/dr/recovery-center.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const TOKEN_KEY = 'c3'.repeat(32); // 32 bytes hex
const REFRESH_TOKEN = '1//' + 'R'.repeat(40);
const MASTER_KEY = 'a1'.repeat(32);
const VAULT_KEY = 'f9'.repeat(32);

const SYNTH_SECRETS: Record<string, string> = {
  DRIVE_TOKEN_ENCRYPTION_KEY: TOKEN_KEY,
  DR_RECOVERY_MASTER_KEY: MASTER_KEY,
  DR_RECOVERY_VAULT_KEY: VAULT_KEY,
  DRIVE_DB_BACKUP_KEY: 'b2'.repeat(32),
};

/** قاعدة pg وهمية: تُرجع صف `control` بقيمة قابلة للحقن، بلا أي اتصال شبكي. */
function makeFakePg(controlValue: any, opts: { fail?: string } = {}) {
  class FakeClient {
    rows: any[];
    constructor() { this.rows = controlValue === undefined ? [] : [{ key: 'control', value: controlValue }]; }
    async connect() { if (opts.fail === 'connect') throw Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }); }
    async query() { if (opts.fail === 'query') throw Object.assign(new Error('boom'), { code: '42703' }); return { rows: this.rows }; }
    async end() {}
  }
  return { default: { Client: FakeClient }, Client: FakeClient };
}

function noSecret(obj: any): boolean {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return !text.includes(REFRESH_TOKEN) && Object.values(SYNTH_SECRETS).every((v) => !text.includes(v));
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
  const env: any = { ...SYNTH_SECRETS };
  const encrypted = encryptDriveSecret(REFRESH_TOKEN, env);

  // ---------- A) ترتيب المصادر ----------
  {
    const explicit = await resolveRefreshTokenSource(env, { refreshToken: REFRESH_TOKEN });
    check('source: explicit provided wins', explicit.ok === true && explicit.source === 'provided');

    const fromEnc = await resolveRefreshTokenSource(env, { encryptedRefreshToken: encrypted, loadFromDatabase: false });
    check('source: encrypted provided decrypts', fromEnc.ok === true && fromEnc.source === 'provided_encrypted' && fromEnc.refreshToken === REFRESH_TOKEN);

    const fromEnv = await resolveRefreshTokenSource({ ...env, DRIVE_OAUTH_REFRESH_TOKEN: REFRESH_TOKEN }, { loadFromDatabase: false });
    check('source: env plaintext (back-compat)', fromEnv.ok === true && fromEnv.source === 'env_plaintext');

    const none = await resolveRefreshTokenSource(env, { loadFromDatabase: false });
    check('source: none => no_refresh_token', none.ok === false && none.code === 'no_refresh_token');
  }

  // ---------- B) القراءة من قاعدة الحالة المشفّرة ----------
  {
    const withDb = { ...env, [DR_STATE_DATABASE_URL_ENV]: 'postgres://user:pw@host/db' };
    check('state db url resolved', stateDatabaseUrl(withDb) === 'postgres://user:pw@host/db');

    const ok = await resolveRefreshTokenSource(withDb, { loadPg: () => makeFakePg({ driveRefreshToken: encrypted }) });
    check('source: state_database decrypts token', ok.ok === true && ok.source === 'state_database' && ok.refreshToken === REFRESH_TOKEN);

    const notFound = await resolveRefreshTokenSource(withDb, { loadPg: () => makeFakePg({}) });
    check('source: token missing in db => refresh_token_not_found', notFound.ok === false && notFound.code === 'refresh_token_not_found');

    const wrongKey = await resolveRefreshTokenSource({ ...withDb, DRIVE_TOKEN_ENCRYPTION_KEY: '99'.repeat(32) }, { loadPg: () => makeFakePg({ driveRefreshToken: encrypted }) });
    check('source: wrong token key => undecryptable', wrongKey.ok === false && wrongKey.code === 'refresh_token_undecryptable');

    const dbErr = await resolveRefreshTokenSource(withDb, { loadPg: () => makeFakePg({ driveRefreshToken: encrypted }, { fail: 'query' }) });
    check('source: db error classified', dbErr.ok === false && dbErr.code === 'state_db_error');

    const noKey = await resolveRefreshTokenSource({ [DR_STATE_DATABASE_URL_ENV]: 'postgres://x' }, { loadPg: () => makeFakePg({ driveRefreshToken: encrypted }) });
    check('source: missing token key => token_key_missing', noKey.ok === false && noKey.code === 'token_key_missing');

    const noDb = await resolveRefreshTokenSource(env, { loadPg: () => makeFakePg({ driveRefreshToken: encrypted }) });
    check('source: no state db configured', noDb.ok === false && noDb.code === 'state_db_not_configured');

    const pgMissing = await resolveRefreshTokenSource(withDb, { loadPg: () => { throw new Error('not installed'); } });
    check('source: pg not installed classified', pgMissing.ok === false && pgMissing.code === 'pg_not_installed');

    // loadRefreshTokenFromDatabase مباشرةً: لا يُعيد أي شيء سوى الرمز.
    const direct = await loadRefreshTokenFromDatabase(withDb, { loadPg: () => makeFakePg({ driveRefreshToken: encrypted }) });
    check('loadRefreshTokenFromDatabase ok', direct.ok === true && direct.source === 'state_database');
  }

  // ---------- C) فحص المصدر بلا سرّ ----------
  {
    const withDb = { ...env, [DR_STATE_DATABASE_URL_ENV]: 'postgres://user:pw@host/db' };
    const info = await inspectRefreshTokenSource(withDb, { loadPg: () => makeFakePg({ driveRefreshToken: encrypted }) });
    check('inspect: available + source', info.available === true && info.source === 'state_database');
    check('inspect: flags exposed', info.stateDatabaseConfigured === true && info.tokenKeyPresent === true && info.envPlaintextPresent === false);
    check('inspect: no secret', noSecret(info));
    const miss = await inspectRefreshTokenSource(env, { loadFromDatabase: false });
    check('inspect: missing code explicit', miss.available === false && miss.code === 'no_refresh_token' && noSecret(miss));
  }

  // ---------- D) buildRecoveryClient يفشل صراحةً بلا رمز ----------
  {
    const c = await buildRecoveryClient({ ...env, DRIVE_OAUTH_CLIENT_ID: '123-drive.apps.googleusercontent.com', DRIVE_OAUTH_CLIENT_SECRET: 'GOCSPX-x' }, { loadFromDatabase: false });
    check('buildRecoveryClient no token => explicit code', c && (c as any).ok === false && (c as any).code === 'no_refresh_token');
    const c2 = await buildRecoveryClient({ ...env, DRIVE_OAUTH_CLIENT_ID: '123-drive.apps.googleusercontent.com', DRIVE_OAUTH_CLIENT_SECRET: 'GOCSPX-x' }, { refreshToken: REFRESH_TOKEN });
    check('buildRecoveryClient with token => client', c2 && typeof (c2 as any).authHeaders === 'function' && (c2 as any).refreshTokenSource === 'provided');
  }

  // ---------- E) مركز الاستعادة يقرأ نقاطاً حقيقية عبر قاعدة الحالة المشفّرة ----------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gharabi-token-src-'));
  const fakeDrive = createFakeDriveState();
  const driveClient = new DriveClient({ transport: makeFakeTransport(fakeDrive), tokenProvider: () => 'tok' });
  const store = new DriveStore({ client: driveClient });
  const backup = await runBackup({
    store, files: fullSource('token-src'),
    dumpDatabase: async () => JSON.stringify({ backend: 'postgres', rows: [] }),
    encryptDatabase: (s: string) => encryptDbDump(s, env),
    buildSecrets: () => buildSecretsBundle(env, {}),
    meta: { commit: 'd'.repeat(40), branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' },
    now: new Date().toISOString(),
  });
  check('seed backup ok', backup.state === 'backed_up' && backup.verified === true);

  const centerEnv: any = {
    ...env,
    DRIVE_OAUTH_CLIENT_ID: '1234567890-drive.apps.googleusercontent.com',
    DRIVE_OAUTH_CLIENT_SECRET: 'GOCSPX-' + 'drive-fake-test-secret',
    [DR_STATE_DATABASE_URL_ENV]: 'postgres://user:pw@host/db',
  };
  const server = createRecoveryCenterServer({
    env: centerEnv,
    clientFactory: () => driveClient,
    tokenOptions: { loadPg: () => makeFakePg({ driveRefreshToken: encrypted }) },
    targetDir: path.join(tmp, 'restored'),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    check('center health: drive configured', health.driveConfigured === true);
    check('center health: token via state db', health.drive.refreshTokenAvailable === true && health.drive.refreshTokenSource === 'state_database');
    check('center health: state db flag', health.drive.stateDatabaseConfigured === true);
    check('center health: no vault key in env', health.vaultKeyInEnv === false);
    check('center health: no secret', noSecret(health));

    const pts = await (await fetch(`${base}/api/points`)).json();
    check('center lists real points via encrypted-db token', pts.ok === true && pts.points.length >= 1 && pts.points.some((p: any) => p.id === backup.recoveryPointId));
    check('center points: no secret', noSecret(pts));

    // تحقق قراءة فقط من نقطة (بلا مفتاح خزنة) — لا يُسرّب شيئاً.
    const verify = await (await fetch(`${base}/api/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ point: backup.recoveryPointId }),
    })).json();
    check('center verify read-only', verify.report && verify.report.readOnly === true);
    check('center verify: no secret', noSecret(verify));

    // استعادة كاملة بالمفتاح (في الذاكرة فقط).
    const restore = await (await fetch(`${base}/api/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ point: backup.recoveryPointId, confirm: true, vaultKey: VAULT_KEY }),
    })).json();
    check('center restore ok via db-token', restore.ok === true, JSON.stringify(restore.report?.problems));
    check('center restore: no secret', noSecret(restore));
    check('center restore: no false service claim', restore.report.states.service_started === false && restore.report.states.service_verified === false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // ---------- F) بلا رمز إطلاقاً: سبب صريح بلا كسر ----------
  {
    const server2 = createRecoveryCenterServer({
      env: { ...env, DRIVE_OAUTH_CLIENT_ID: '1234567890-drive.apps.googleusercontent.com', DRIVE_OAUTH_CLIENT_SECRET: 'GOCSPX-x' },
      tokenOptions: { loadFromDatabase: false },
    });
    await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', () => resolve()));
    const b2 = `http://127.0.0.1:${(server2.address() as any).port}`;
    try {
      const pts = await (await fetch(`${b2}/api/points`)).json();
      check('center without token => explicit reason', pts.ok === false && pts.reason === 'no_refresh_token');
      const h = await (await fetch(`${b2}/api/health`)).json();
      check('center without token health honest', h.drive.refreshTokenAvailable === false && h.drive.refreshTokenCode === 'no_refresh_token');
    } finally {
      await new Promise<void>((resolve) => server2.close(() => resolve()));
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\ntoken-source + center(db token): ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
