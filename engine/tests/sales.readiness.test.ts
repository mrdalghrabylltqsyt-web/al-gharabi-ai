/**
 * جاهزية البيع — تشخيص ذاتي حتمي لما يمنع البيع الآن.
 *
 * 1) وحدة (buildSalesReadiness): ترتيب الخطورة، عتبة انتظار الزبون، وضع YouTube فقط،
 *    فشل ربط بسرّ خاطئ ⇒ إجراء «السر خاطئ»، مسودات بقسط قديم، الحكم والدرجة.
 * 2) تنقية رسالة فشل الربط: لا رمز ولا سرّ يمرّ.
 * 3) تكامل على خادم حقيقي (حالة مزروعة): المسار للمالك فقط (401 بلا جلسة)، ويكشف
 *    من الحالة الحقيقية: زبون ينتظر منذ 5 ساعات، وضع YouTube فقط، فشل ربط Google
 *    Business المحفوظ، ومسودة تسويق بقسط قديم — بلا أي نص زبون في الاستجابة.
 *
 * بلا مزود خارجي وبلا Gemini وبلا أسرار حقيقية. يفشل على الكود القديم (لا وحدة ولا مسار).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { reserveFreePort } from './helpers/freePort';
import { buildSalesReadiness, sanitizeOAuthFailureMessage, type SalesReadinessInput } from '../ops/salesReadiness';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const NOW = '2026-10-25T10:00:00.000Z';
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();

function baseInput(over: Partial<SalesReadinessInput> = {}): SalesReadinessInput {
  return {
    nowIso: NOW,
    youtubeOnlyMode: false,
    platforms: [
      { id: 'facebook', name: 'Facebook', connected: true, credentialsConfigured: true, realConnector: true },
      { id: 'youtube', name: 'YouTube', connected: true, credentialsConfigured: true, realConnector: true },
      { id: 'whatsapp', name: 'WhatsApp', connected: false, credentialsConfigured: false, realConnector: true },
      { id: 'google_business', name: 'Google Business', connected: false, credentialsConfigured: true, realConnector: true },
      { id: 'x', name: 'X', connected: false, credentialsConfigured: false, realConnector: false },
    ],
    commercialBrainEnabled: true,
    sendMode: 'approval',
    ownerAlerts: { enabled: true, emailConfigured: true },
    pendingApprovals: { count: 0, oldestAt: null },
    readyJobs: 0,
    autoExecuteEnabled: false,
    staleMarketing: { unpublished: 0, published: 0 },
    geminiConfigured: true,
    ...over,
  };
}

async function main(): Promise<void> {
  group('1) وحدة: الترتيب والعتبات والحكم');
  {
    const r = buildSalesReadiness(baseInput());
    const order = r.items.map((i) => i.severity);
    const rank = { blocker: 0, warning: 1, info: 2, ok: 3 } as const;
    check('البنود مرتبة: عائق ثم إجراء ثم معلومة ثم يعمل', order.every((s, i) => i === 0 || rank[order[i - 1]] <= rank[s]), order.join(','));
    check('منصة بلا موصل حقيقي (X) لا تظهر', !r.items.some((i) => i.id === 'platform-x'));
    check('واتساب غير مهيّأ ⇒ إجراء (warning)', r.items.find((i) => i.id === 'platform-whatsapp')?.severity === 'warning');
    check('Google Business مهيّأ وغير مربوط ⇒ معلومة «جاهز للربط»', r.items.find((i) => i.id === 'platform-google_business')?.title.includes('جاهز للربط') === true);
    check('بلا عوائق ⇒ الحكم partial (توجد إجراءات)', r.verdict === 'partial', r.verdict);
  }
  {
    const r = buildSalesReadiness(baseInput({ pendingApprovals: { count: 3, oldestAt: hoursAgo(1) } }));
    const it = r.items.find((i) => i.id === 'customers-waiting');
    check('انتظار ساعة واحدة ⇒ warning', it?.severity === 'warning', JSON.stringify(it));
    check('العنوان يذكر العدد', it?.title.includes('3') === true);
    const r2 = buildSalesReadiness(baseInput({ pendingApprovals: { count: 1, oldestAt: hoursAgo(5) } }));
    const it2 = r2.items.find((i) => i.id === 'customers-waiting');
    check('★ انتظار 5 ساعات ⇒ blocker', it2?.severity === 'blocker', JSON.stringify(it2));
    check('التفصيل يذكر مدة الانتظار', it2?.detail.includes('5 ساعة') === true, it2?.detail);
    check('عائق ⇒ الحكم blocked', r2.verdict === 'blocked');
    check('العائق أول البنود', r2.items[0]?.id === 'customers-waiting', r2.items[0]?.id);
  }
  {
    const r = buildSalesReadiness(baseInput({ youtubeOnlyMode: true }));
    const it = r.items.find((i) => i.id === 'youtube-only-mode');
    check('★ وضع YouTube فقط ⇒ blocker مع خطوة Render', it?.severity === 'blocker' && it.action.includes('YOUTUBE_ONLY_OPERATIONAL'), JSON.stringify(it));
  }
  {
    const r = buildSalesReadiness(baseInput({
      platforms: [
        { id: 'facebook', name: 'Facebook', connected: true, credentialsConfigured: true, realConnector: true },
        { id: 'google_business', name: 'Google Business', connected: false, credentialsConfigured: true, realConnector: true, lastOAuthFailure: { at: hoursAgo(20), message: 'The provided client secret is invalid.' } },
      ],
    }));
    const it = r.items.find((i) => i.id === 'platform-google_business');
    check('★ فشل ربط محفوظ ⇒ «فشل ربط» مع الرسالة', it?.title.includes('فشل ربط') === true && it.detail.includes('client secret is invalid'), JSON.stringify(it));
    check('★ سر خاطئ ⇒ الإجراء يقول إن السر خاطئ', it?.action.includes('سر تطبيق') === true, it?.action);
  }
  {
    const r = buildSalesReadiness(baseInput({ platforms: [{ id: 'facebook', name: 'Facebook', connected: false, credentialsConfigured: true, realConnector: true }] }));
    check('لا منصة بيع متصلة ⇒ blocker', r.items.find((i) => i.id === 'no-sales-channel')?.severity === 'blocker');
  }
  {
    const r = buildSalesReadiness(baseInput({ ownerAlerts: { enabled: true, emailConfigured: false } }));
    check('بريد التنبيه غير مهيّأ ⇒ blocker', r.items.find((i) => i.id === 'owner-alerts')?.severity === 'blocker');
    const r2 = buildSalesReadiness(baseInput({ commercialBrainEnabled: false, readyJobs: 2 }));
    check('العقل التجاري موقوف ⇒ warning', r2.items.find((i) => i.id === 'commercial-brain')?.severity === 'warning');
    check('مهام جاهزة بلا تنفيذ تلقائي ⇒ warning يذكر العدد', r2.items.find((i) => i.id === 'ready-jobs')?.title.includes('2') === true);
    const r3 = buildSalesReadiness(baseInput({ readyJobs: 2, autoExecuteEnabled: true }));
    check('مهام جاهزة مع تنفيذ تلقائي ⇒ لا بند', !r3.items.some((i) => i.id === 'ready-jobs'));
    const r4 = buildSalesReadiness(baseInput({ staleMarketing: { unpublished: 4, published: 1 } }));
    check('مسودات بقسط قديم ⇒ warning يذكر 4', r4.items.find((i) => i.id === 'stale-marketing-drafts')?.title.includes('4') === true);
    check('منشور منشور بقسط قديم ⇒ info', r4.items.find((i) => i.id === 'stale-marketing-published')?.severity === 'info');
  }
  {
    const all = buildSalesReadiness(baseInput({
      platforms: ['whatsapp', 'facebook', 'instagram', 'tiktok', 'telegram', 'google_business', 'youtube'].map((id) => ({ id, name: id, connected: true, credentialsConfigured: true, realConnector: true })),
    }));
    check('كل شيء يعمل ⇒ الدرجة 100 والحكم selling', all.score === 100 && all.verdict === 'selling', `${all.score} ${all.verdict}`);
    const none = buildSalesReadiness(baseInput({ youtubeOnlyMode: true, commercialBrainEnabled: false, ownerAlerts: { enabled: false, emailConfigured: false } }));
    check('حالة سيئة ⇒ درجة أقل', none.score < all.score, String(none.score));
  }

  group('2) تنقية رسالة فشل الربط');
  {
    const msg = sanitizeOAuthFailureMessage('invalid token ya29.a0AfH6SMBxxxxxxxxxxxxxxxx\nsecret=abcdefghijklmnopqrstuvwxyz0123456789ABCD');
    check('رمز Google محجوب', !msg.includes('ya29.a0AfH6'), msg);
    check('سلسلة طويلة تشبه السر محجوبة', !msg.includes('abcdefghijklmnopqrstuvwxyz0123456789ABCD'), msg);
    check('سطر واحد', !/[\r\n]/.test(msg));
    check('بحد 200 حرف', sanitizeOAuthFailureMessage('x '.repeat(500)).length <= 200);
  }

  group('3) تكامل: المسار على خادم حقيقي بحالة مزروعة');
  const APP_PORT = await reserveFreePort();
  const BASE = `http://127.0.0.1:${APP_PORT}`;
  const PREVIEW_TOKEN = randomBytes(24).toString('hex');
  const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-readiness-'));
  const now = new Date();
  const fiveHoursAgo = new Date(now.getTime() - 5 * 3_600_000).toISOString();
  const CUSTOMER_TEXT = 'نص زبون سري لا يجب أن يظهر في التقرير';
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: now.toISOString(),
    users: [{ id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك', avatar: '', active: true, createdAt: now.toISOString() }],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: {
      showroom: { name: 'معرض الغرابي' }, products: [],
      posts: [{ id: 'post_old_quote', platform: 'facebook', title: 'عرض قديم', content: 'قسط قديم', status: 'draft', createdAt: now.toISOString() }],
      marketingBriefs: [{ id: 'brief_old', task: 'x', platforms: ['facebook'], quote: { cashPrice: 600000, downPayment: 0, financedAmount: 600000, months: 12, monthlyPayment: 50000, totalInstallments: 600000 }, savedPostIds: ['post_old_quote'], createdAt: now.toISOString() }],
    },
  }), 'utf8');
  writeFileSync(join(stateDir, 'commercial.json'), JSON.stringify({
    leads: [], sendMode: 'approval',
    outboundApprovals: [{ id: 'approval_1', platform: 'facebook', operation: 'comment_reply', externalId: 'C1', recipientId: null, text: CUSTOMER_TEXT, productId: null, actor: 'watcher', at: fiveHoursAgo, status: 'pending' }],
  }), 'utf8');
  writeFileSync(join(stateDir, '.gharabi-control.json'), JSON.stringify({
    oauthFailures: { google_business: { at: fiveHoursAgo, message: 'The provided client secret is invalid.' } },
  }), 'utf8');

  let log = '';
  const env: Record<string, string> = {
    PATH: process.env.PATH || '', HOME: process.env.HOME || stateDir,
    PORT: String(APP_PORT), NODE_ENV: 'production', APP_URL: BASE, STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET: 'sales-readiness-secret-not-real',
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    YOUTUBE_ONLY_OPERATIONAL: 'true',
    GOOGLE_BUSINESS_OAUTH_CLIENT_ID: 'test-gbp-id', GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET: 'test-gbp-secret',
  };
  const proc: ChildProcess = spawn(process.execPath, [join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(process.cwd(), 'server.ts')], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  try {
    let up = false;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      try { if ((await fetch(`${BASE}/api/health`)).ok) { up = true; break; } } catch { /* لم يقلع بعد */ }
      await new Promise((r) => setTimeout(r, 400));
    }
    check('الخادم يقلع', up, log.slice(-600));

    const anon = await fetch(`${BASE}/api/control/sales-readiness`);
    check('بلا جلسة ⇒ 401', anon.status === 401, String(anon.status));

    const login = await (await fetch(`${BASE}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) })).json();
    const res = await fetch(`${BASE}/api/control/sales-readiness`, { headers: { Authorization: `Bearer ${login.token}` } });
    const body = await res.json();
    const r = body?.readiness || {};
    const items: any[] = Array.isArray(r.items) ? r.items : [];
    const raw = JSON.stringify(body);
    check('المالك ⇒ 200 بلا Gemini', res.status === 200 && body.usesGemini === false, `${res.status} ${raw.slice(0, 200)}`);
    check('★ زبون ينتظر منذ 5 ساعات ⇒ blocker', items.find((i) => i.id === 'customers-waiting')?.severity === 'blocker', JSON.stringify(items.find((i) => i.id === 'customers-waiting')));
    check('★ وضع YouTube فقط مكتشف من البيئة', items.some((i) => i.id === 'youtube-only-mode' && i.severity === 'blocker'));
    check('★ فشل ربط Google Business المحفوظ يظهر بعد restart', items.find((i) => i.id === 'platform-google_business')?.detail?.includes('client secret is invalid') === true, JSON.stringify(items.find((i) => i.id === 'platform-google_business')));
    check('★ مسودة التسويق بقسط قديم معدودة (1)', items.find((i) => i.id === 'stale-marketing-drafts')?.title?.includes('1') === true, JSON.stringify(items.find((i) => i.id === 'stale-marketing-drafts')));
    check('الحكم blocked', r.verdict === 'blocked', r.verdict);
    check('★ لا نص زبون في الاستجابة', !raw.includes(CUSTOMER_TEXT));
    check('لا قيمة سر في الاستجابة', !raw.includes('test-gbp-secret') && !raw.includes(PREVIEW_TOKEN));
  } finally {
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1200));
    if (!proc.killed) proc.kill('SIGKILL');
    rmSync(stateDir, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} sales-readiness checks`);
}

void main();
