/**
 * اختبار **مصادقة المالك** لمركز استعادة الغرابي AI (خدمة مستقلة).
 *
 * الثغرة المُغلقة: كانت `/api/points` (وما يشبهها) تكشف بيانات وصفية لنقاط الاستعادة
 * (الالتزامات، عدد الملفات، عدد الأسرار) لأي زائر بلا أي مصادقة.
 *
 * يثبت هذا الاختبار بسلوك حقيقي (خادم المركز على منفذ محلي + خادم Drive وهمي، بلا شبكة):
 *  1) بلا مفتاح مضبوط: المسارات الحسّاسة تُرد **401** (fail-closed) — لا بيانات لأي زائر.
 *  2) بمفتاح مضبوط وبلا ترويسة Bearer: **401**.
 *  3) بمفتاح خاطئ: **401**.
 *  4) بالمفتاح الصحيح: **200** ويعمل كما كان (قائمة النقاط).
 *  5) بديل البصمة (`..._TOKEN_HASH`) يعمل بنفس السلوك.
 *  6) `/api/health` و`/` و`/api/owner-auth` تبقى عامة بلا أي بيانات وصفية حساسة.
 *  7) `/api/verify` و`/api/restore` محميّان أيضاً.
 *  8) الوضع المحلي الصريح `ALLOW_UNAUTHENTICATED=true` يسمح (للتوافق المحلي فقط).
 *  9) لا يُسرّب المفتاح ولا قيمته في أي استجابة.
 * 10) نسخة `lib` المتزامنة مطابقة لوحدة `tools/dr` (بلا انحراف).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../../tools/dr/drive-store.mjs';
import { runBackup } from '../../../tools/dr/backup.mjs';
import { encryptDbDump } from '../../../tools/dr/db-crypto.mjs';
import { buildSecretsBundle } from '../../../tools/dr/secret-crypto.mjs';
import { runKeyVaultSync } from '../../dr/recoveryVault/vault';
import { createRecoveryCenterServer, RECOVERY_CENTER_BUILD } from '../../../tools/dr/recovery-center.mjs';
import {
  inspectRecoveryOwnerAuth,
  checkRecoveryOwnerAuth,
  extractBearerToken,
  isProtectedRecoveryPath,
  recoveryOwnerAuthStatus,
  RECOVERY_CENTER_PROTECTED_PATHS,
  OWNER_TOKEN_ENV,
  OWNER_TOKEN_HASH_ENV,
  ALLOW_UNAUTHENTICATED_ENV,
} from '../../../tools/dr/recoveryAuth.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const OWNER_TOKEN = 'owner-' + 'a'.repeat(40);
const MASTER_KEY = 'a1'.repeat(32);
const VAULT_KEY = 'f9'.repeat(32);
const SYNTH_SECRETS: Record<string, string> = {
  DR_RECOVERY_MASTER_KEY: MASTER_KEY,
  DR_RECOVERY_VAULT_KEY: VAULT_KEY,
  DRIVE_DB_BACKUP_KEY: 'b2'.repeat(32),
  DRIVE_TOKEN_ENCRYPTION_KEY: 'c3'.repeat(32),
};
const SQL = JSON.stringify({ backend: 'postgres', rows: [{ key: 'state', value: {} }] });

function noSecret(obj: any): boolean {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return Object.values(SYNTH_SECRETS).every((v) => !text.includes(v)) && !text.includes(OWNER_TOKEN);
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
  const baseEnv: any = {
    ...SYNTH_SECRETS,
    DRIVE_OAUTH_CLIENT_ID: '1234567890-drive.apps.googleusercontent.com',
    DRIVE_OAUTH_CLIENT_SECRET: 'GOCSPX-' + 'drive-fake-test-secret',
    DRIVE_OAUTH_REFRESH_TOKEN: '1//fake-refresh-token-for-test',
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gharabi-owner-auth-'));

  // ---------- A) وحدة المنطق الصافي (بلا خادم) ----------
  {
    check('protected paths single source', JSON.stringify(RECOVERY_CENTER_PROTECTED_PATHS) === JSON.stringify(['/api/points', '/api/verify', '/api/restore']));
    check('isProtected true for points/verify/restore', isProtectedRecoveryPath('/api/points') && isProtectedRecoveryPath('/api/verify') && isProtectedRecoveryPath('/api/restore'));
    check('isProtected false for health/root/owner-auth', !isProtectedRecoveryPath('/api/health') && !isProtectedRecoveryPath('/') && !isProtectedRecoveryPath('/api/owner-auth'));

    check('extract bearer basic', extractBearerToken('Bearer abc123') === 'abc123');
    check('extract bearer case-insensitive', extractBearerToken('bearer abc') === 'abc');
    check('extract bearer missing', extractBearerToken(undefined) === '' && extractBearerToken('abc') === '');
    check('extract bearer trims', extractBearerToken('Bearer   xyz  ') === 'xyz');

    // بلا مفتاح: مقيّد افتراضياً (fail-closed).
    const noCfg = inspectRecoveryOwnerAuth({});
    check('no token => not configured', noCfg.configured === false && noCfg.source === 'none' && noCfg.allowUnauthenticated === false);
    check('no token => protected check denied', checkRecoveryOwnerAuth({ headers: {} }, {}).allowed === false && checkRecoveryOwnerAuth({ headers: {} }, {}).reason === 'owner_token_not_configured');

    // بمفتاح: قبول/رفض.
    const withCfg = { [OWNER_TOKEN_ENV]: OWNER_TOKEN };
    check('token configured source env_token', inspectRecoveryOwnerAuth(withCfg).source === 'env_token');
    check('correct bearer accepted', checkRecoveryOwnerAuth({ headers: { authorization: 'Bearer ' + OWNER_TOKEN } }, withCfg).allowed === true);
    check('wrong bearer rejected', checkRecoveryOwnerAuth({ headers: { authorization: 'Bearer nope-nope-nope' } }, withCfg).allowed === false && checkRecoveryOwnerAuth({ headers: { authorization: 'Bearer nope-nope-nope' } }, withCfg).reason === 'invalid_bearer_token');
    check('missing bearer rejected', checkRecoveryOwnerAuth({ headers: {} }, withCfg).allowed === false && checkRecoveryOwnerAuth({ headers: {} }, withCfg).reason === 'missing_bearer_token');

    // بديل البصمة.
    const hash = crypto.createHash('sha256').update(OWNER_TOKEN, 'utf8').digest('hex');
    const hashCfg = { [OWNER_TOKEN_HASH_ENV]: hash };
    check('token hash configured', inspectRecoveryOwnerAuth(hashCfg).source === 'env_token_hash');
    check('correct token matches hash', checkRecoveryOwnerAuth({ headers: { authorization: 'Bearer ' + OWNER_TOKEN } }, hashCfg).allowed === true);
    check('wrong token vs hash rejected', checkRecoveryOwnerAuth({ headers: { authorization: 'Bearer wrong' } }, hashCfg).allowed === false);
    check('short/invalid hash ignored', inspectRecoveryOwnerAuth({ [OWNER_TOKEN_HASH_ENV]: 'abc' }).configured === false);

    // الوضع المحلي الصريح فقط.
    const allowCfg = { [ALLOW_UNAUTHENTICATED_ENV]: 'true' };
    check('allow-unauthenticated opt-in', checkRecoveryOwnerAuth({ headers: {} }, allowCfg).allowed === true && checkRecoveryOwnerAuth({ headers: {} }, allowCfg).reason === 'unauthenticated_allowed_by_owner');
    check('status block no secret', !JSON.stringify(recoveryOwnerAuthStatus(withCfg)).includes(OWNER_TOKEN));
  }

  // ---------- تهيئة: نسخة حقيقية في Drive وهمي ----------
  const state = createFakeDriveState();
  const client = new DriveClient({ transport: makeFakeTransport(state), tokenProvider: () => 'tok' });
  const store = new DriveStore({ client });
  const backup = await runBackup({
    store, files: fullSource('owner-auth'),
    dumpDatabase: async () => SQL,
    encryptDatabase: (s: string) => encryptDbDump(s, baseEnv),
    buildSecrets: () => buildSecretsBundle(baseEnv, {}),
    meta: { commit: 'e'.repeat(40), branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' },
    now: new Date().toISOString(),
  });
  check('seed backup ok', backup.state === 'backed_up' && backup.verified === true, JSON.stringify(backup).slice(0, 160));
  await runKeyVaultSync({ store, env: baseEnv, now: new Date().toISOString() });

  const start = async (env: any) => {
    const server = createRecoveryCenterServer({ env, clientFactory: () => client, targetDir: path.join(tmp, 'r-' + Math.random().toString(36).slice(2)) });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    return { server, base: `http://127.0.0.1:${(server.address() as any).port}` };
  };
  const close = (server: any) => new Promise<void>((resolve) => server.close(() => resolve()));

  // ---------- B) مفتاح مضبوط: الحماية الفعلية ----------
  {
    const env: any = { ...baseEnv, [OWNER_TOKEN_ENV]: OWNER_TOKEN };
    const { server, base } = await start(env);
    try {
      // بلا ترويسة => 401.
      const anon = await fetch(`${base}/api/points`);
      check('anonymous /api/points => 401', anon.status === 401);
      const anonBody = await anon.json();
      check('401 body explicit code', anonBody.code === 'UNAUTHORIZED' && anonBody.reason === 'missing_bearer_token');
      check('401 leaks no point metadata', anonBody.points === undefined && !JSON.stringify(anonBody).includes('rp-'));

      // مفتاح خاطئ => 401.
      const bad = await fetch(`${base}/api/points`, { headers: { authorization: 'Bearer wrong-token' } });
      check('wrong token /api/points => 401', bad.status === 401);

      // المفتاح الصحيح => 200 ويعمل كما كان.
      const good = await fetch(`${base}/api/points`, { headers: { authorization: 'Bearer ' + OWNER_TOKEN } });
      check('correct token /api/points => 200', good.status === 200);
      const goodBody = await good.json();
      check('authorized points real', goodBody.ok === true && (goodBody.points || []).some((p: any) => p.id === backup.recoveryPointId));
      check('authorized points no secret', noSecret(goodBody));

      // verify/restore محميّان أيضاً.
      const anonVerify = await fetch(`${base}/api/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ point: backup.recoveryPointId }) });
      check('anonymous /api/verify => 401', anonVerify.status === 401);
      const anonRestore = await fetch(`${base}/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ point: backup.recoveryPointId, confirm: true, vaultKey: VAULT_KEY }) });
      check('anonymous /api/restore => 401', anonRestore.status === 401);

      const goodVerify = await fetch(`${base}/api/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', authorization: 'Bearer ' + OWNER_TOKEN }, body: JSON.stringify({ point: backup.recoveryPointId, vaultKey: VAULT_KEY }) });
      check('authorized /api/verify => 200', goodVerify.status === 200 && (await goodVerify.json()).ok === true);
      const goodRestore = await fetch(`${base}/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json', authorization: 'Bearer ' + OWNER_TOKEN }, body: JSON.stringify({ point: backup.recoveryPointId, confirm: true, vaultKey: VAULT_KEY }) });
      check('authorized /api/restore => 200', goodRestore.status === 200 && (await goodRestore.json()).ok === true);

      // الصحة/الواجهة/owner-auth عامة.
      const health = await fetch(`${base}/api/health`);
      check('health public 200', health.status === 200);
      const healthBody = await health.json();
      check('health no secret', noSecret(healthBody));
      check('health exposes ownerAuth block (boolean only)', healthBody.ownerAuth && healthBody.ownerAuth.required === true && healthBody.ownerAuth.configured === true && !JSON.stringify(healthBody.ownerAuth).includes(OWNER_TOKEN));
      check('health no point metadata', !JSON.stringify(healthBody).includes('rp-'));

      const root = await fetch(`${base}/`);
      check('root public 200 html', root.status === 200 && (root.headers.get('content-type') || '').includes('text/html'));
      const rootHtml = await root.text();
      check('root has owner-token input', rootHtml.includes('ownerToken') && rootHtml.includes(OWNER_TOKEN_ENV));
      check('root no secret', noSecret(rootHtml));

      const authOk = await fetch(`${base}/api/owner-auth`, { headers: { authorization: 'Bearer ' + OWNER_TOKEN } });
      check('owner-auth with token 200', authOk.status === 200 && (await authOk.json()).ok === true);
      const authNo = await fetch(`${base}/api/owner-auth`);
      check('owner-auth without token 401', authNo.status === 401);
    } finally { await close(server); }
  }

  // ---------- C) بديل البصمة يعمل بنفس السلوك ----------
  {
    const hash = crypto.createHash('sha256').update(OWNER_TOKEN, 'utf8').digest('hex');
    const env: any = { ...baseEnv, [OWNER_TOKEN_HASH_ENV]: hash };
    const { server, base } = await start(env);
    try {
      check('hash: anonymous 401', (await fetch(`${base}/api/points`)).status === 401);
      const good = await fetch(`${base}/api/points`, { headers: { authorization: 'Bearer ' + OWNER_TOKEN } });
      check('hash: correct token 200', good.status === 200 && (await good.json()).ok === true);
    } finally { await close(server); }
  }

  // ---------- D) بلا مفتاح مضبوط: fail-closed ----------
  {
    const { server, base } = await start({ ...baseEnv });
    try {
      check('unconfigured: /api/points 401', (await fetch(`${base}/api/points`)).status === 401);
      const body = await (await fetch(`${base}/api/points`)).json();
      check('unconfigured: explicit reason', body.reason === 'owner_token_not_configured');
      const health = await (await fetch(`${base}/api/health`)).json();
      check('unconfigured: health honest', health.ownerAuth.required === true && health.ownerAuth.configured === false);
    } finally { await close(server); }
  }

  // ---------- E) الوضع المحلي الصريح فقط ----------
  {
    const env: any = { ...baseEnv, [ALLOW_UNAUTHENTICATED_ENV]: 'true' };
    const { server, base } = await start(env);
    try {
      const pts = await fetch(`${base}/api/points`);
      check('local opt-in allows anonymous', pts.status === 200 && (await pts.json()).ok === true);
      const health = await (await fetch(`${base}/api/health`)).json();
      check('local opt-in: health honest', health.ownerAuth.required === false && health.ownerAuth.configured === false);
    } finally { await close(server); }
  }

  // ---------- F2) تحديد معدّل التخمين لكل IP (fail-closed بعد الحدّ) ----------
  {
    const env: any = { ...baseEnv, [OWNER_TOKEN_ENV]: OWNER_TOKEN };
    const { server, base } = await start(env);
    try {
      // 10 محاولات خاطئة متتالية من نفس العميل — كل واحدة 401 (ليست محظورة بعد).
      for (let i = 0; i < 10; i += 1) {
        const r = await fetch(`${base}/api/points`, { headers: { authorization: 'Bearer still-wrong' } });
        check(`rate-limit warmup attempt ${i + 1} => 401`, r.status === 401, String(r.status));
      }
      // المحاولة الحادية عشرة: محظورة (429) بصرف النظر عن صحة المفتاح هذه المرة.
      const blocked = await fetch(`${base}/api/points`, { headers: { authorization: 'Bearer ' + OWNER_TOKEN } });
      check('11th attempt rate-limited even with correct token', blocked.status === 429);
      const blockedBody = await blocked.json();
      check('rate-limited body explicit', blockedBody.ok === false && blockedBody.code === 'RATE_LIMITED' && blockedBody.reason === 'rate_limited');
      // /api/owner-auth من نفس العميل محظور أيضاً (نفس مفتاح IP).
      const ownerAuthBlocked = await fetch(`${base}/api/owner-auth`, { headers: { authorization: 'Bearer ' + OWNER_TOKEN } });
      check('owner-auth rate-limited too (shared IP key)', ownerAuthBlocked.status === 429);
    } finally { await close(server); }
  }

  // ---------- F) بصمة البناء + نسخة lib متزامنة ----------
  {
    check('build marker updated', RECOVERY_CENTER_BUILD === 'points-timeout-1');
    const toolAuth = fs.readFileSync(path.join(repoRoot, 'tools/dr/recoveryAuth.mjs'), 'utf8');
    const libAuth = fs.readFileSync(path.join(repoRoot, 'dr-recovery-center/lib/recoveryAuth.mjs'), 'utf8');
    check('recoveryAuth lib synced (no drift)', toolAuth === libAuth);
    const toolCenter = fs.readFileSync(path.join(repoRoot, 'tools/dr/recovery-center.mjs'), 'utf8');
    const libCenter = fs.readFileSync(path.join(repoRoot, 'dr-recovery-center/lib/recovery-center.mjs'), 'utf8');
    check('recovery-center lib synced (no drift)', toolCenter === libCenter);
    check('center imports recoveryAuth', toolCenter.includes("from './recoveryAuth.mjs'"));
    check('center no secret literal', !/(GOCSPX|AIzaSy|1\/\/)[A-Za-z0-9_-]{8,}/.test(toolCenter));
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nrecovery-center owner-auth: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
