/**
 * خصوصية نقطة الصحة العامة لمنظومة DR — تمنع تسريب بيانات تعريف الأسرار.
 *
 * الثغرة المُصلَحة: `GET /api/dr/health` (بلا مصادقة) كان يعرض أطوال/صيغ/بصمات
 * SHA-256 لاعتماد OAuth وللمفتاح الرئيسي (perKey[])، وهو ما يُعين على استهداف
 * الأسرار ويخالف قاعدة «الأسرار لا تُعرض». الآن:
 *   - الصحة العامة تعلن وجود الاعتماد وحالة المفتاح فقط (بلا طول/بصمة/أسماء).
 *   - التفاصيل الكاملة في `GET /api/dr/health/detail` محمية بـauthenticateToken
 *     + requireOwner (نفس نمط الفصل في /api/health مقابل مسار المراقب المحمي).
 *
 * يشغّل خادم Express حقيقي + Drive وهمي بالكامل؛ لا سرّ حقيقي ولا شبكة ولا مزوّد.
 */

import express from 'express';
import type { Server } from 'node:http';
import { createFakeDriveState, makeFakeTransport } from './helpers/fakeDrive';
import { makeFakeTokenTransport } from './helpers/fakeTokenTransport';
import { registerDriveRoutes } from '../../dr/routes';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const KEY = 'e5'.repeat(32);
// قيم canary: نؤكد أن قيمها الخام لا تظهر في أي استجابة، ولا تُشتق أطوالها/بصماتها علناً.
const CANARY_CLIENT_ID = '1234567890-drive' + '.apps.googleusercontent.com';
const CANARY_CLIENT_SECRET = 'GOCSPX-' + 'drive-canary-secret-value';
const CANARY_MASTER_KEY = KEY;
const ENV: Record<string, string> = {
  DRIVE_OAUTH_CLIENT_ID: CANARY_CLIENT_ID,
  DRIVE_OAUTH_CLIENT_SECRET: CANARY_CLIENT_SECRET,
  DRIVE_DB_BACKUP_KEY: KEY,
  DRIVE_TOKEN_ENCRYPTION_KEY: KEY,
  DR_RECOVERY_MASTER_KEY: CANARY_MASTER_KEY,
  DR_RECOVERY_VAULT_KEY: KEY,
  SESSION_SECRET: 'sess-' + 'h'.repeat(30),
};

// حقول بيانات التعريف التي يجب ألا تظهر في النقطة العامة إطلاقاً.
const SENSITIVE_FIELDS = [
  'clientIdLength',
  'clientSecretLength',
  'clientIdFingerprint',
  'effectiveClientIdFingerprint',
  'perKey',
  'envNames',
  'effectiveClientIdSource',
];

async function main() {
  const fakeState = createFakeDriveState();
  const app = express();
  app.use(express.json());
  const authenticateToken: any = (req: any, res: any, next: any) => {
    const h = String(req.headers['x-owner'] || '');
    if (!h) return res.status(401).json({ success: false, error: 'no session' });
    req.user = { id: h, role: String(req.headers['x-role'] || 'owner') };
    return next();
  };
  const requireOwner: any = (req: any, res: any, next: any) => {
    if (!req.user || req.user.role !== 'owner') return res.status(403).json({ success: false, error: 'owner only' });
    return next();
  };
  const drControl: any = { driveOAuthStates: [], driveRefreshToken: null, driveLastError: null, driveMirror: null };

  registerDriveRoutes(app, {
    authenticateToken,
    requireOwner,
    env: ENV,
    loadControl: () => drControl,
    persistControl: (partial) => { Object.assign(drControl, partial); },
    clientFactory: () => new DriveClient({ transport: makeFakeTransport(fakeState), tokenProvider: () => 'tok' }),
    oauthTransport: makeFakeTokenTransport(),
    collectSourceFiles: () => ({ included: [], excluded: [], complete: true, source: 'test', fileCount: 0 }),
    dumpDatabase: async () => JSON.stringify({ backend: 'postgres', rows: [] }),
    buildSecrets: () => ({ ok: true }),
    gitMeta: () => ({ commit: 'a'.repeat(40), branch: 'main', repository: 'r/al-gharabi-ai', project: 'al-gharabi-ai' }),
    now: () => '2026-01-01T00:00:00.000Z',
  });

  const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const ownerHeaders = { 'x-owner': 'owner-1' };
  const staffHeaders = { 'x-owner': 'staff-1', 'x-role': 'staff' };

  try {
    // --- 1) الصحة العامة: لا حقول بيانات تعريف أسرار ---
    const pubRes = await fetch(`${base}/api/dr/health`);
    const pubText = await pubRes.text();
    const pub: any = JSON.parse(pubText);
    check('public health 200', pubRes.ok && pub.success === true, `status=${pubRes.status}`);

    for (const field of SENSITIVE_FIELDS) {
      check(`public health omits ${field}`, !pubText.includes(`"${field}"`), `field ${field} present`);
    }
    // ملخص آمن مقصود: وجود الاعتماد فقط.
    check('public health oauthClient presence-only',
      pub.dr.oauthClient.clientIdPresent === true && pub.dr.oauthClient.clientSecretPresent === true &&
      Object.keys(pub.dr.oauthClient).sort().join(',') === 'clientIdPresent,clientSecretPresent',
      JSON.stringify(pub.dr.oauthClient));
    check('public health recoveryMasterKey state-only',
      typeof pub.dr.recoveryMasterKey.state === 'string' &&
      Object.keys(pub.dr.recoveryMasterKey).join(',') === 'state',
      JSON.stringify(pub.dr.recoveryMasterKey));
    check('public health keyVault vaultKey state-only',
      typeof pub.dr.keyVault.vaultKey.state === 'string' &&
      Object.keys(pub.dr.keyVault.vaultKey).join(',') === 'state',
      JSON.stringify(pub.dr.keyVault.vaultKey));
    // لا قيمة سرّية خام إطلاقاً.
    check('public health no raw client id', !pubText.includes(CANARY_CLIENT_ID) && !pubText.includes('apps.googleusercontent.com'));
    check('public health no raw client secret', !pubText.includes(CANARY_CLIENT_SECRET) && !pubText.includes('GOCSPX-'));
    check('public health no raw master key', !pubText.includes(CANARY_MASTER_KEY));
    // تبقى الحقول العامة الآمنة كما هي.
    check('public health keeps safe fields', pub.dr.scope === 'https://www.googleapis.com/auth/drive.file' && typeof pub.dr.redirectUri === 'string' && typeof pub.dr.backupReady === 'boolean');

    // --- 2) مسار التفاصيل: 401 بلا جلسة، 403 لغير المالك ---
    const anon = await fetch(`${base}/api/dr/health/detail`);
    check('detail requires auth (401)', anon.status === 401, `status=${anon.status}`);
    const staff = await fetch(`${base}/api/dr/health/detail`, { headers: staffHeaders });
    check('detail owner-only (403 for staff)', staff.status === 403, `status=${staff.status}`);

    // --- 3) المالك: التشخيص الكامل متاح ---
    const detRes = await fetch(`${base}/api/dr/health/detail`, { headers: ownerHeaders });
    const detText = await detRes.text();
    const det: any = JSON.parse(detText);
    check('detail owner 200', detRes.ok && det.success === true, `status=${detRes.status}`);
    check('detail exposes oauthClient full', det.dr.oauthClient.clientIdLength > 0 && /^[0-9a-f]{12}$/.test(det.dr.oauthClient.clientIdFingerprint) && typeof det.dr.oauthClient.effectiveClientIdSource === 'string');
    check('detail exposes recoveryMasterKey perKey', Array.isArray(det.dr.recoveryMasterKey.perKey) && det.dr.recoveryMasterKey.perKey.some((p: any) => p.name === 'DR_RECOVERY_MASTER_KEY' && p.present === true && p.valid === true && /^[0-9a-f]{12}$/.test(p.fingerprint)));
    check('detail exposes keyVault vaultKey fingerprint', /^[0-9a-f]{12}$/.test(det.dr.keyVault.vaultKey.fingerprint || ''));
    // حتى في المسار المحمي: لا قيمة سرّية خام.
    check('detail no raw secrets', !detText.includes(CANARY_CLIENT_ID) && !detText.includes(CANARY_CLIENT_SECRET) && !detText.includes(CANARY_MASTER_KEY) && !detText.includes('GOCSPX-'));
    // أكواد تشخيص الرمز تقنية فقط (بلا قيمة).
    check('detail refreshToken technical codes only', 'reason' in det.dr.refreshToken && 'providerCode' in det.dr.refreshToken && 'httpStatus' in det.dr.refreshToken && !detText.includes('1//') && !detText.includes('ya29.'));
  } finally {
    await new Promise((r) => server.close(r));
  }

  if (failures.length) {
    console.error(`DR HEALTH PRIVACY TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR HEALTH PRIVACY TESTS PASSED: ${passed} checks`);
}

main().catch((err) => {
  console.error('DR HEALTH PRIVACY TESTS CRASHED:', err);
  process.exit(1);
});
