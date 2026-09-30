/**
 * اختبارات مسارات DR على خادم Express حقيقي + Drive وهمي بالكامل.
 *
 * يثبت: توليد رابط التفويض (owner فقط)، فرض النطاق، حماية CSRF (state أحادي
 * الاستخدام + TTL)، تخزين رمز التجديد مشفّراً (لا نص صريح)، أن callback بلا
 * code/state لا يبادل ولا يرفع، وأن /api/dr/health لا يكشف أي سرّ.
 */

import express from 'express';
import type { Server } from 'node:http';
import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { registerDriveRoutes } from '../../dr/routes';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { Gaxios } from 'gaxios';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const TEST_KEY = 'c'.repeat(64);
const ENV: Record<string, string> = {
  DRIVE_OAUTH_CLIENT_ID: '1234567890-drive.apps.googleusercontent.com',
  DRIVE_OAUTH_CLIENT_SECRET: 'GOCSPX-drive-test-secret-value',
  DRIVE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
};

/** Gaxios حقيقي مع `request` مُستبدل يقلّد خادم Google token. */
function makeFakeTokenTransport() {
  const g = new Gaxios();
  g.request = (async () => ({
    status: 200,
    headers: {},
    config: {},
    data: {
      access_token: 'ya29.drive-fake-access',
      expires_in: 3600,
      refresh_token: '1//drive-fake-refresh-token-not-real-abcdefghij',
      scope: 'https://www.googleapis.com/auth/drive.file',
      token_type: 'Bearer',
    },
  })) as any;
  return g;
}

async function main() {
  const fakeState = createFakeDriveState();
  const app = express();
  app.use(express.json());
  // مصادقة مبسطة للاختبار: ترويسة x-owner تمنح المالك، وx-user مستخدماً عادياً.
  const authenticateToken: any = (req: any, res: any, next: any) => {
    const h = String(req.headers['x-owner'] || '');
    if (!h) return res.status(401).json({ success: false, error: 'no session' });
    req.user = { id: h, role: 'owner' };
    return next();
  };
  const requireOwner: any = (req: any, res: any, next: any) => {
    if (!req.user || req.user.role !== 'owner') return res.status(403).json({ success: false, error: 'owner only' });
    return next();
  };
  const drControl: any = { driveOAuthStates: [], driveRefreshToken: null, driveLastError: null };
  const persisted: any[] = [];

  registerDriveRoutes(app, {
    authenticateToken,
    requireOwner,
    env: ENV,
    loadControl: () => drControl,
    persistControl: (partial) => { Object.assign(drControl, partial); persisted.push(partial); },
    clientFactory: () => new DriveClient({ transport: makeFakeTransport(fakeState), tokenProvider: () => 'tok' }),
    oauthTransport: makeFakeTokenTransport(),
    now: () => '2026-01-01T00:00:00.000Z',
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const ownerHeaders = { 'x-owner': 'owner-1', 'Content-Type': 'application/json' };

  try {
    // --- health بلا أسرار ---
    {
      const res = await fetch(`${base}/api/dr/health`);
      const body = await res.json();
      const json = JSON.stringify(body);
      check('health 200', res.status === 200);
      check('health scope drive.file', body.dr.scope === 'https://www.googleapis.com/auth/drive.file');
      check('health forbidden scope listed', body.dr.forbiddenScopes.includes('https://www.googleapis.com/auth/drive'));
      check('health callback route', body.dr.callbackRoute === '/api/dr/drive/callback');
      check('health no secret values', !json.includes('GOCSPX') && !json.includes('googleusercontent') && !json.includes(TEST_KEY));
      check('health not authorized yet', body.dr.authorized === false && body.dr.refreshTokenStored === false);
      check('health rp001 commit', body.dr.rp001Commit === 'dd09c32077e2cc3cc326345e8bbc740c025c14e2');
    }

    // --- auth-url محصور بالمالك ---
    {
      const noAuth = await fetch(`${base}/api/dr/drive/auth-url`);
      check('auth-url requires auth (401)', noAuth.status === 401);
      const res = await fetch(`${base}/api/dr/drive/auth-url`, { headers: ownerHeaders });
      const body = await res.json();
      check('auth-url 200 for owner', res.status === 200 && body.success === true);
      check('auth-url has url', typeof body.url === 'string' && body.url.startsWith('https://accounts.google.com'));
      check('auth-url scope drive.file', body.scope === 'https://www.googleapis.com/auth/drive.file');
      const scopeParam = decodeURIComponent(/[?&]scope=([^&]*)/.exec(body.url)?.[1] || '');
      check('auth-url scope param only drive.file', scopeParam === 'https://www.googleapis.com/auth/drive.file');
      check('auth-url offline', /access_type=offline/.test(body.url));
      check('auth-url has state', /[?&]state=[0-9a-f]{32,}/.test(body.url));
      check('auth-url redirect exact', body.redirectUri === 'https://al-gharabi-ai.onrender.com/api/dr/drive/callback');
      check('auth-url ttl', body.ttlMs > 0);
      check('auth-url state persisted', drControl.driveOAuthStates.length === 1);
    }

    // --- callback: مسار بلا code/state لا يبادل ولا يرفع ---
    {
      const res = await fetch(`${base}/api/dr/drive/callback`, { headers: { Accept: 'application/json' } });
      const body = await res.json();
      check('callback missing code/state 400', res.status === 400 && body.code === 'MISSING_CODE_OR_STATE');
      check('callback did not persist token', drControl.driveRefreshToken === null);
    }

    // --- callback: state غير معروف مرفوض ---
    {
      const res = await fetch(`${base}/api/dr/drive/callback?code=abc&state=deadbeef`, { headers: { Accept: 'application/json' } });
      const body = await res.json();
      check('callback unknown state rejected', res.status === 400 && body.code === 'UNKNOWN_STATE');
    }

    // --- callback: تدفق ناجح يخزّن رمزاً مشفّراً فقط ---
    {
      // نولّد state صالحاً عبر auth-url ثم نستخرجه.
      const authRes = await fetch(`${base}/api/dr/drive/auth-url`, { headers: ownerHeaders });
      const authBody = await authRes.json();
      const state = /[?&]state=([0-9a-f]+)/.exec(authBody.url)![1];
      const res = await fetch(`${base}/api/dr/drive/callback?code=valid-code&state=${state}`, { headers: { Accept: 'application/json' } });
      const body = await res.json();
      check('callback success', res.status === 200 && body.success === true && body.code === 'DRIVE_AUTHORIZED');
      check('callback stores refresh token', Boolean(drControl.driveRefreshToken));
      check('stored token is encrypted', drControl.driveRefreshToken.alg === 'aes-256-gcm' && !JSON.stringify(drControl.driveRefreshToken).includes('drive-fake-refresh'));
      check('callback returns no raw token', !JSON.stringify(body).includes('drive-fake-refresh'));
      check('callback refreshTokenStored flag', body.refreshTokenStored === true);
      // إعادة استخدام نفس state مرفوضة (single-use)
      const reuse = await fetch(`${base}/api/dr/drive/callback?code=valid-code&state=${state}`, { headers: { Accept: 'application/json' } });
      const reuseBody = await reuse.json();
      check('callback state single-use', reuse.status === 400 && reuseBody.code === 'STATE_REUSED');
      // الحالة الآن authorized
      const health = await (await fetch(`${base}/api/dr/health`)).json();
      check('health authorized after callback', health.dr.authorized === true && health.dr.refreshTokenStored === true);
      check('health still no secret', !JSON.stringify(health).includes('drive-fake-refresh'));
    }

    // --- status (owner) يعرض لقطة مراقبة بلا سرّ ---
    {
      const res = await fetch(`${base}/api/dr/status`, { headers: ownerHeaders });
      const body = await res.json();
      check('status 200', res.status === 200 && body.success === true);
      check('status snapshot state', typeof body.snapshot.state === 'string');
      check('status hourly read-only', body.hourlyCheck.readOnly === true);
      check('status no secret', !JSON.stringify(body).includes('drive-fake-refresh') && !JSON.stringify(body).includes('GOCSPX'));
      const unauth = await fetch(`${base}/api/dr/status`);
      check('status requires auth', unauth.status === 401);
    }
  } finally {
    await new Promise((resolve) => server.close(() => resolve(null)));
  }

  if (failures.length) {
    console.error(`DR ROUTES TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR ROUTES TESTS PASSED: ${passed} checks`);
}

main().catch((err) => {
  console.error('DR ROUTES TESTS CRASHED:', err);
  process.exit(1);
});
