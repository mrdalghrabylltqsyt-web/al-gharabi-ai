/**
 * اختبارات تفويض Drive — بخادم رمز وهمي (transporter محقون) بلا Google حقيقي.
 *
 * يثبت: توليد رابط التفويض (offline + drive.file + state)، فرض النطاق ومنع
 * `auth/drive`، حماية CSRF (state أحادي الاستخدام + TTL + ربط المستخدم/redirect)،
 * تبادل الرمز وتجديده وتصنيف الفشل، تشفير رمز التجديد (لا نص صريح)، وأن البيئة
 * لا تُكشف قيمها.
 */

import {
  enforceDriveFileScope,
  buildDriveAuthorizationUrl,
  exchangeDriveAuthCode,
  refreshDriveAccessToken,
  createRefreshTokenProvider,
  encryptDriveSecret,
  decryptDriveSecret,
  decodeTokenEncryptionKey,
  inspectTokenEncryptionKey,
  inspectDriveAuthEnv,
} from '../../../tools/dr/drive-auth.mjs';
import { DriveStateStore } from '../../../tools/dr/drive-auth-url.mjs';
import { DRIVE_FILE_SCOPE, DRIVE_OAUTH_REDIRECT_URI } from '../../../tools/dr/cloud-lib.mjs';
import { Gaxios } from 'gaxios';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const TEST_KEY = 'a'.repeat(64); // 32 بايت hex (اختباري فقط)
const AUTH_ENV: Record<string, string> = {
  DRIVE_OAUTH_CLIENT_ID: '1234567890-test.apps.googleusercontent.com',
  DRIVE_OAUTH_CLIENT_SECRET: 'GOCSPX-not-a-real-secret-value',
  DRIVE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
};

/** خادم رمز وهمي: Gaxios حقيقي مع `request` مُستبدل (يوفّر interceptors). */
function makeFakeTokenTransport(state: { fail?: string; status?: number; lastBody?: any; lastUrl?: string }) {
  const g = new Gaxios();
  g.request = (async (opts: any) => {
    state.lastUrl = opts.url;
    state.lastBody = opts.data ?? opts.body;
    if (state.fail) {
      // gaxios يرمي عند غير 2xx؛ نحاكي ذلك بنفس شكل الخطأ (response.status/data).
      const err: any = new Error(state.fail);
      err.response = { status: state.status || 400, data: { error: state.fail } };
      throw err;
    }
    return {
      status: 200,
      headers: {},
      config: {},
      data: {
        access_token: 'ya29.fake-access-token',
        expires_in: 3600,
        refresh_token: '1//fake-refresh-token-not-real-abcdefghijklmnop',
        scope: DRIVE_FILE_SCOPE,
        token_type: 'Bearer',
      },
    };
  }) as any;
  return g;
}

async function main() {
  // --- فرض النطاق ---
  check('drive.file accepted', enforceDriveFileScope([DRIVE_FILE_SCOPE]).ok === true);
  check('full drive rejected', enforceDriveFileScope(['https://www.googleapis.com/auth/drive']).ok === false);
  check('drive.readonly rejected', enforceDriveFileScope(['https://www.googleapis.com/auth/drive.readonly']).ok === false);
  check('missing drive.file rejected', enforceDriveFileScope(['https://www.googleapis.com/auth/userinfo.email']).code === 'missing_drive_file_scope');
  check('mixed forbidden rejected', enforceDriveFileScope([DRIVE_FILE_SCOPE, 'https://www.googleapis.com/auth/drive']).ok === false);

  // --- رابط التفويض ---
  {
    const res = buildDriveAuthorizationUrl({ env: AUTH_ENV, state: 'state-abc', redirectUri: DRIVE_OAUTH_REDIRECT_URI });
    check('auth url built', res.ok === true && typeof res.url === 'string');
    check('auth url has drive.file scope', res.url.includes(encodeURIComponent(DRIVE_FILE_SCOPE)));
    check('auth url offline', /access_type=offline/.test(res.url));
    check('auth url has state', /state=state-abc/.test(res.url));
    check('auth url redirect matches', res.url.includes(encodeURIComponent(DRIVE_OAUTH_REDIRECT_URI)));
    const scopeParam = decodeURIComponent(/[?&]scope=([^&]*)/.exec(res.url)?.[1] || '');
    check('auth url scope param is drive.file only', scopeParam.split(/\s+/).every((s) => s === DRIVE_FILE_SCOPE) && scopeParam.includes(DRIVE_FILE_SCOPE));
    const bad = buildDriveAuthorizationUrl({ env: AUTH_ENV, state: 's', scopes: ['https://www.googleapis.com/auth/drive'] });
    check('auth url rejects forbidden scope', bad.ok === false && bad.code === 'forbidden_scope');
  }

  // --- CSRF state store ---
  {
    const persisted: any[] = [];
    const store = new DriveStateStore({ persist: (s) => persisted.push(s), env: AUTH_ENV, now: () => 1_000_000 });
    const created = store.create('user-1', { env: AUTH_ENV });
    check('state created', created.ok === true && created.state.length >= 32);
    check('state url built', typeof created.url === 'string' && created.url.includes('drive.file'));
    const consume = store.consume(created.state, { userId: 'user-1' });
    check('state consumed once', consume.ok === true);
    const reuse = store.consume(created.state, { userId: 'user-1' });
    check('state single-use', reuse.ok === false && reuse.code === 'state_reused');
    const unknown = store.consume('nope', {});
    check('unknown state rejected', unknown.ok === false && unknown.code === 'unknown_state');
    // TTL
    let clock = 2_000_000;
    const s2 = new DriveStateStore({ now: () => clock });
    const c2 = s2.create('u', { env: AUTH_ENV });
    check('state url created with env', c2.ok === true && Boolean(c2.state));
    clock += 11 * 60 * 1000; // > 10 دقائق
    const exp = s2.consume(c2.state, {});
    check('state expired after TTL', exp.ok === false && exp.code === 'state_expired');
    // mismatch المستخدم وredirect
    const s3 = new DriveStateStore({ now: () => 5 });
    const c3 = s3.create('owner', { env: AUTH_ENV, redirectUri: DRIVE_OAUTH_REDIRECT_URI });
    check('state user mismatch', s3.consume(c3.state, { userId: 'other' }).code === 'state_user_mismatch');
    check('state redirect mismatch', s3.consume(c3.state, { redirectUri: 'https://evil.example/cb' }).code === 'state_redirect_mismatch');
    const c4 = s3.create('owner', { env: AUTH_ENV, redirectUri: DRIVE_OAUTH_REDIRECT_URI });
    check('state redirect match ok', s3.consume(c4.state, { userId: 'owner', redirectUri: DRIVE_OAUTH_REDIRECT_URI }).ok === true);
    check('state forbidden scope rejected', s3.create('owner', { env: AUTH_ENV, scopes: ['https://www.googleapis.com/auth/drive'] }).ok === false);
    check('state persisted', persisted.length > 0);
  }

  // --- تبادل الرمز ---
  {
    const state: any = {};
    const res = await exchangeDriveAuthCode('auth-code-123', { env: AUTH_ENV, transporter: makeFakeTokenTransport(state) });
    check('exchange ok', res.ok === true && Boolean(res.refreshToken));
    check('exchange got refresh token', /^1\/\//.test(res.refreshToken));
    check('exchange scope enforced', enforceDriveFileScope(res.scope).ok === true);
    check('exchange missing code', (await exchangeDriveAuthCode('', { env: AUTH_ENV })).code === 'missing_code');
  }

  // --- تجديد الرمز ---
  {
    const state: any = {};
    const res = await refreshDriveAccessToken('1//refresh', { env: AUTH_ENV, transporter: makeFakeTokenTransport(state) });
    check('refresh ok', res.ok === true && Boolean(res.accessToken));
    const fail: any = { fail: 'invalid_grant', status: 400 };
    const bad = await refreshDriveAccessToken('1//refresh', { env: AUTH_ENV, transporter: makeFakeTokenTransport(fail) });
    check('refresh failure classified', bad.ok === false && bad.code === 'refresh_failure');
    const unauth: any = { fail: 'invalid_client', status: 401 };
    const u = await refreshDriveAccessToken('1//refresh', { env: AUTH_ENV, transporter: makeFakeTokenTransport(unauth) });
    check('refresh unauthorized classified', u.code === 'unauthorized');
    const srv: any = { fail: 'backend_error', status: 503 };
    const s = await refreshDriveAccessToken('1//refresh', { env: AUTH_ENV, transporter: makeFakeTokenTransport(srv) });
    check('refresh server_error classified', s.code === 'server_error');
  }

  // --- مزوّد الرمز ---
  {
    const state: any = {};
    const provider = createRefreshTokenProvider({ env: AUTH_ENV, refreshToken: '1//refresh', transporter: makeFakeTokenTransport(state) });
    const token = await provider();
    check('token provider returns access token', token === 'ya29.fake-access-token');
    const token2 = await provider();
    check('token provider caches', token2 === token);
    const none = createRefreshTokenProvider({ env: {} });
    let threw = false;
    try { await none(); } catch { threw = true; }
    check('token provider without refresh throws', threw === true);
  }

  // --- تشفير رمز التجديد ---
  {
    const enc = encryptDriveSecret('1//super-secret-refresh', AUTH_ENV as any);
    check('encrypted record has alg', enc.alg === 'aes-256-gcm');
    check('encrypted record no plaintext', !JSON.stringify(enc).includes('super-secret'));
    const dec = decryptDriveSecret(enc, AUTH_ENV as any);
    check('decrypt roundtrip', dec === '1//super-secret-refresh');
    const wrong = decryptDriveSecret(enc, { DRIVE_TOKEN_ENCRYPTION_KEY: 'b'.repeat(64) } as any);
    check('decrypt wrong key fails', wrong === null);
    check('decode key valid hex', decodeTokenEncryptionKey(TEST_KEY)?.length === 32);
    check('decode key rejects short', decodeTokenEncryptionKey('abcd') === null);
    check('inspect key missing', inspectTokenEncryptionKey({}).state === 'missing');
    check('inspect key invalid', inspectTokenEncryptionKey({ DRIVE_TOKEN_ENCRYPTION_KEY: 'short' }).state === 'invalid');
    check('inspect key valid', inspectTokenEncryptionKey({ DRIVE_TOKEN_ENCRYPTION_KEY: TEST_KEY }).state === 'valid');
  }

  // --- البيئة لا تكشف قيماً ---
  {
    const info = inspectDriveAuthEnv(AUTH_ENV as any);
    const json = JSON.stringify(info);
    check('env info flags only', info.clientIdConfigured === true && info.clientSecretConfigured === true);
    check('env info no values', !json.includes('GOCSPX') && !json.includes('googleusercontent') && !json.includes(TEST_KEY));
    check('env info redirect', info.redirectUri === DRIVE_OAUTH_REDIRECT_URI);
    check('env info scope', info.scope === DRIVE_FILE_SCOPE);
  }

  if (failures.length) {
    console.error(`DR AUTH TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR AUTH TESTS PASSED: ${passed} checks`);
}

main().catch((err) => {
  console.error('DR AUTH TESTS CRASHED:', err);
  process.exit(1);
});
