/**
 * اختبارات واجهة النسخ السحابي (DR) + العودة الآمنة من OAuth.
 *
 * يثبت:
 *  1) التبويب cloud_backup يظهر للمالك فقط (Sidebar ownerOnly + فلترة).
 *  2) App.tsx يعالج عودة dr (authorized/error) ويفتح التبويب وينظّف الرابط.
 *  3) apiService يحوي getDrStatus/getDrHealth/getDrAuthUrl عبر getAuthHeaders.
 *  4) CloudBackupView: زر الربط فقط عند (configured && !authorized)، وينتقل إلى
 *     رابط الخادم، ولا يخزّن/يعرض state أو authorization code أو refresh token.
 *  5) على خادم Express حقيقي: فرع المتصفح في callback يعيد 302 إلى /?dr=authorized
 *     أو /?dr=error&reason=<آمن>، بلا أي سرّ في الرابط، وفرع JSON كما هو.
 */

import express from 'express';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const TEST_KEY = 'c'.repeat(64);
// قيم وهمية للاختبار تُبنى وقت التشغيل (لا تظهر كاملة كصيغة سرّ حقيقي في المصدر).
const ENV: Record<string, string> = {
  DRIVE_OAUTH_CLIENT_ID: '1234567890-drive' + '.apps.googleusercontent.com',
  DRIVE_OAUTH_CLIENT_SECRET: 'GOCSPX-' + 'drive-fake-test-secret-value',
  DRIVE_TOKEN_ENCRYPTION_KEY: TEST_KEY,
};

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

// ---------------------------------------------------------------------------
// 1) فحوص المصدر الثابتة (الواجهة)
// ---------------------------------------------------------------------------
function staticChecks() {
  const sidebar = read('src/components/common/Sidebar.tsx');
  const app = read('src/App.tsx');
  const api = read('src/services/api.ts');
  const view = read('src/components/system/CloudBackupView.tsx');

  // التبويب للمالك فقط
  check('sidebar has cloud_backup id', sidebar.includes("id: 'cloud_backup'"));
  check('sidebar cloud_backup is ownerOnly', /id:\s*'cloud_backup'[\s\S]{0,200}ownerOnly:\s*true/.test(sidebar));
  check('sidebar filters ownerOnly by role', /navigationItems\.filter\([\s\S]{0,80}ownerOnly[\s\S]{0,60}currentUser\?\.role\s*===\s*'owner'/.test(sidebar));

  // App.tsx: حالة + معالجة العودة
  check('app has cloud_backup case', app.includes("case 'cloud_backup': return <CloudBackupView />"));
  check('app reads dr param', /params\.get\('dr'\)/.test(app));
  check('app handles authorized', app.includes("dr === 'authorized'") && app.includes('cloud_backup'));
  check('app handles error reason', /params\.get\('reason'\)/.test(app) && app.includes('DR_RETURN_MESSAGES'));
  check('app cleans url params', /replaceState/.test(app) && /params\.delete\('dr'\)/.test(app) && /params\.delete\('reason'\)/.test(app));

  // apiService: الدوال الثلاث + getAuthHeaders
  check('api has getDrStatus', api.includes('getDrStatus') && api.includes("'/api/dr/status'"));
  check('api has getDrHealth', api.includes('getDrHealth') && api.includes("'/api/dr/health'"));
  check('api has getDrAuthUrl', api.includes('getDrAuthUrl') && api.includes("'/api/dr/drive/auth-url'"));
  check('api dr status uses getAuthHeaders', /getDrStatus[\s\S]{0,220}getAuthHeaders\(\)/.test(api));
  check('api dr auth-url uses getAuthHeaders', /getDrAuthUrl[\s\S]{0,220}getAuthHeaders\(\)/.test(api));

  // CloudBackupView: الحماية + زر الربط + عدم كشف الأسرار
  check('view owner gate', view.includes("currentUser?.role === 'owner'") && view.includes('if (!isOwner)'));
  check('view connect reachable when not operable && configured', /configured\s*&&\s*\(!canOperate\)/.test(view));
  check('view reauth reachable when google rejected token', view.includes('reauthorizationNeeded') && view.includes('إعادة الربط بنقرة واحدة'));
  check('view gates ops on refresh usability not mere storage', view.includes('refreshTokenUsable') && view.includes('canOperate = authorized && !reauthorizationNeeded'));
  check('view calls getDrAuthUrl', view.includes('apiService.getDrAuthUrl'));
  check('view navigates to server url', view.includes('window.location.assign'));
  check('view no token storage', !/localStorage[\s\S]{0,40}(state|token|code)/i.test(view) && !view.includes('setApiAuthToken'));
  check('view no secret display of state/code', !/\.state\b/.test(view.replace(/oauthStates?/g, '')) || !view.includes('authorizationCode'));
}

// ---------------------------------------------------------------------------
// 2) فحوص الخادم الحقيقي: العودة الآمنة من OAuth
// ---------------------------------------------------------------------------
async function serverChecks() {
  const fakeState = createFakeDriveState();
  const app = express();
  app.use(express.json());
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

  registerDriveRoutes(app, {
    authenticateToken,
    requireOwner,
    env: ENV,
    loadControl: () => drControl,
    persistControl: (partial) => { Object.assign(drControl, partial); },
    clientFactory: () => new DriveClient({ transport: makeFakeTransport(fakeState), tokenProvider: () => 'tok' }),
    oauthTransport: makeFakeTokenTransport(),
    now: () => '2026-01-01T00:00:00.000Z',
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const ownerHeaders = { 'x-owner': 'owner-1' };

  try {
    // فرع المتصفح الناجح: 302 إلى /?dr=authorized
    {
      const authRes = await fetch(`${base}/api/dr/drive/auth-url`, { headers: ownerHeaders });
      const authBody = await authRes.json();
      const state = /[?&]state=([0-9a-f]+)/.exec(authBody.url)![1];
      // بلا Accept: application/json => فرع المتصفح
      const res = await fetch(`${base}/api/dr/drive/callback?code=valid-code&state=${state}`, { redirect: 'manual' });
      const loc = res.headers.get('location') || '';
      check('browser success 302', res.status === 302, `got ${res.status}`);
      check('browser success location', loc.endsWith('/?dr=authorized'), loc);
      check('browser success no secret in location', !loc.includes('drive-fake') && !loc.includes('code=') && !loc.includes('state='));
      check('browser success stored encrypted token', Boolean(drControl.driveRefreshToken));
    }

    // فرع المتصفح الفاشل: 302 إلى /?dr=error&reason=UNKNOWN_STATE
    {
      const res = await fetch(`${base}/api/dr/drive/callback?code=x&state=deadbeef`, { redirect: 'manual' });
      const loc = res.headers.get('location') || '';
      check('browser error 302', res.status === 302, `got ${res.status}`);
      check('browser error location dr=error', loc.includes('/?dr=error'), loc);
      check('browser error reason safe', /reason=UNKNOWN_STATE/.test(loc), loc);
      check('browser error no secret', !loc.includes('deadbeef') && !loc.includes('GOCSPX'));
    }

    // رفض Google: OAUTH_DENIED
    {
      const res = await fetch(`${base}/api/dr/drive/callback?error=access_denied`, { redirect: 'manual' });
      const loc = res.headers.get('location') || '';
      check('browser denied 302', res.status === 302);
      check('browser denied reason', /reason=OAUTH_DENIED/.test(loc), loc);
    }

    // بلا code/state: MISSING_CODE_OR_STATE
    {
      const res = await fetch(`${base}/api/dr/drive/callback`, { redirect: 'manual' });
      const loc = res.headers.get('location') || '';
      check('browser missing 302', res.status === 302);
      check('browser missing reason', /reason=MISSING_CODE_OR_STATE/.test(loc), loc);
    }

    // فرع JSON يبقى كما هو (Accept: application/json)
    {
      const res = await fetch(`${base}/api/dr/drive/callback`, { headers: { Accept: 'application/json' } });
      const body = await res.json();
      check('json branch still 400', res.status === 400 && body.code === 'MISSING_CODE_OR_STATE');
    }

    // auth-url محصور بالمالك
    {
      const unauth = await fetch(`${base}/api/dr/drive/auth-url`);
      check('auth-url 401 without session', unauth.status === 401);
      const ok = await fetch(`${base}/api/dr/drive/auth-url`, { headers: ownerHeaders });
      check('auth-url 200 for owner', ok.status === 200);
    }
  } finally {
    await new Promise((resolve) => server.close(() => resolve(null)));
  }
}

// ---------------------------------------------------------------------------
// 3) المعالجة الصريحة لفشل /api/dr/status (منطق صافٍ + مصدر الواجهة)
// ---------------------------------------------------------------------------
function explicitErrorHandlingChecks() {
  const view = read('src/components/system/CloudBackupView.tsx');
  const api = read('src/services/api.ts');

  // لا ابتلاع للخطأ
  check('view no silent catch-null', !view.includes('.catch(() => null)'));
  check('view uses allSettled', view.includes('Promise.allSettled'));
  check('view has error state', view.includes('statusError') && view.includes('DrStatusErrorInfo'));
  check('view shows toast on failure', /showToast\(/.test(view));

  // زر التحديث: حالة تحميل + عودة للحالة الطبيعية
  check('view refresh shows loading label', view.includes('جارٍ التحديث') && /loading\s*\?\s*'جارٍ التحديث/.test(view));
  check('view refresh disabled while loading', /disabled=\{loading\}/.test(view));
  check('view retry button present', view.includes('إعادة المحاولة'));

  // api يحمل رمز HTTP للتصنيف
  check('api getDrStatus attaches status', /getDrStatus[\s\S]{0,400}err\.status\s*=\s*res\.status/.test(api));

  // لا تسريب أسرار في الواجهة
  check('view no secret display', !view.includes('authorizationCode') && !/localStorage[\s\S]{0,40}(state|token|code)/i.test(view));
}

// فحوص المنطق الصافي: تُستورد الوحدة فعلاً (سايد-إفكتات فقط عند التركيب) وتُختبر الدوال.
async function pureLogicChecks() {
  const mod: any = await import(pathToFileURL(join(ROOT, 'src/components/system/CloudBackupView.tsx')).href);
  const c = mod.classifyDrStatusError;
  const r = mod.resolveDrStatusUpdate;

  check('classify 401 => session', c({ status: 401 }).kind === 'session' && /إعادة تسجيل الدخول/.test(c({ status: 401 }).message));
  check('classify 403 => forbidden', c({ status: 403 }).kind === 'forbidden' && /مالك/.test(c({ status: 403 }).message));
  check('classify 500 => unavailable', c({ status: 500 }).kind === 'unavailable');
  check('classify network => unavailable', c(new Error('network')).kind === 'unavailable');

  // النجاح يعرض البيانات، والفشل يُبقي السابقة
  const okUpd = r({ status: 'fulfilled', value: { snapshot: { state: 'synced' } } } as any, '2026-01-01T00:00:00.000Z');
  check('success exposes snapshot', okUpd.ok === true && okUpd.snapshot.state === 'synced' && okUpd.statusError === null);
  check('success sets updatedAt', okUpd.updatedAt === '2026-01-01T00:00:00.000Z');
  const failUpd = r({ status: 'rejected', reason: { status: 401 } } as any, 'x');
  check('failure preserves previous (no snapshot key)', failUpd.ok === false && !('snapshot' in failUpd) && failUpd.statusError?.kind === 'session');
  check('failure message is user-facing', typeof failUpd.statusError?.message === 'string' && failUpd.statusError!.message.length > 10);
}

// ---------------------------------------------------------------------------
// 3ب) زر النسخة الاحتياطية الفعلية (منطق صافٍ + مصدر الواجهة + api)
// ---------------------------------------------------------------------------
function backupUiChecks() {
  const view = read('src/components/system/CloudBackupView.tsx');
  const api = read('src/services/api.ts');

  check('view has backup button', view.includes('إنشاء Recovery Point') && view.includes('apiService.createDrBackup'));
  check('view backup disabled while running', /disabled=\{backingUp\}/.test(view));
  check('view backup shows running label', view.includes('جارٍ إنشاء النسخة'));
  check('view shows backup result', view.includes('resolveDrBackupResult') && view.includes('backupResult'));
  check('view history table present', view.includes('نقاط الاستعادة') && view.includes('snapshot?.history'));
  // منظومة التعافي الكامل في الواجهة
  check('view has sync button', view.includes('مزامنة الآن') && view.includes('apiService.syncDrCurrent'));
  check('view has drill button', view.includes('اختبار الاستعادة') && view.includes('apiService.drillDrRestore'));
  check('view lists recovery points', view.includes('نقاط الاستعادة الكاملة') && view.includes('recoveryPoints'));
  check('view has restore plan', view.includes('apiService.getDrRestorePlan') && view.includes('restorePlan'));
  check('view has production restore (confirmed)', view.includes('apiService.requestProductionRestore') && view.includes('window.confirm'));
  check('view shows secrets status', view.includes('apiService.getDrSecretsStatus') && view.includes('secretsStatus'));
  check('view shows drill report', view.includes('drillReport') && view.includes('تقرير اختبار الاستعادة'));
  check('view never renders secret values', !/AIzaSy|GOCSPX|refresh_token=|access_token=/.test(view));
  check('api has createDrBackup', api.includes('createDrBackup') && api.includes("'/api/dr/backup'"));
  check('api backup is POST', /createDrBackup[\s\S]{0,200}method:\s*'POST'/.test(api));
  check('api backup attaches status', /createDrBackup[\s\S]{0,500}err\.status\s*=\s*res\.status/.test(api));
}

async function backupLogicChecks() {
  const mod: any = await import(pathToFileURL(join(ROOT, 'src/components/system/CloudBackupView.tsx')).href);
  const r = mod.resolveDrBackupResult;

  const created = r({ state: 'backed_up', verified: true, recoveryPointId: 'rp-002', commit: 'abcdef1234567890' });
  check('backup backed_up => created ok', created.ok === true && created.outcome === 'created');
  const unverified = r({ state: 'backed_up', verified: false });
  check('backup backed_up without verified => failed', unverified.ok === false && unverified.outcome === 'failed');
  const noChange = r({ state: 'no_change' });
  check('backup no_change => ok', noChange.ok === true && noChange.outcome === 'no_change');
  const blocked = r({ state: 'blocked' });
  check('backup blocked => blocked', blocked.ok === false && blocked.outcome === 'blocked');
  const failed = r({ state: 'failed', reason: 'verification_failed', message: 'لم تكتمل' });
  check('backup failed => failed with reason', failed.ok === false && failed.outcome === 'failed' && failed.detail.includes('verification_failed'));
}

async function main() {
  staticChecks();
  explicitErrorHandlingChecks();
  backupUiChecks();
  await pureLogicChecks();
  await backupLogicChecks();
  await serverChecks();

  if (failures.length) {
    console.error(`DR UI TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR UI TESTS PASSED: ${passed} checks`);
}

void main();
