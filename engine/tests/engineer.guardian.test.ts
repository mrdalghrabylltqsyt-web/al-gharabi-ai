/**
 * ترقية المهندس المشرف إلى «حارس» (2026-10-29):
 *   1) الحارس الأمني: يرى محاولات الاختراق ويحظر مصدرها المباشر فقط، ولا يمسّ المالك أبداً.
 *   2) عصفور الكناري: يهاجم كل حارس حماية حيّاً ويكشف أي حارس معطّل.
 *   3) فحص الحافة من الإنترنت (Netlify/Render/الشهادات/ترويسات الحماية).
 *   4) الخطط المجانية بتنبؤ نهاية الشهر + حجم القاعدة الحقيقي + ثغرات المكتبات.
 *   5) كل فشل يدخل سجل الأعطال بقاعدة وخطة إصلاح تُغلقه ✅ بتقرير (بروتوكول الإغلاق).
 */
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  SecuritySentinel, resolveClientIdentity, classifyRequest, classifyResponse, maskIp, isInternalIp, SENTINEL_POLICY,
} from '../ops/securitySentinel';
import { runGuardCanary, GUARD_PROBES, guardFailureLine, type GuardDeps } from '../ops/guardCanary';
import { edgeTargets, judgeEdge, edgeRound, edgeFailureLine, EDGE_POLICY } from '../ops/edgeProbe';
import { judgePlan, judgePlans, judgeStorage, bytesGrowthPerDay, monthElapsedFraction } from '../ops/resourceWatch';
import { classifyFailure, repairPlanFor } from '../ops/defectLedger';
import { inspectModule, PATROL_CHECKS, CHECK_IMPACT, type PatrolFacts } from '../ops/engineerPatrol';
import { PROBE_ROUTES } from '../ops/engineerProactive';
import { requiresApproval, normalizeCommercialSendMode } from '../commercial/commercialDrafts';
import { analyzeBusinessClaims, buildBusinessFacts } from '../social/contentSafety';
import { sanitizeUntrustedText, UNTRUSTED_CLOSE_TAG } from '../ai/untrusted';
import { enforcePromptLimit, DEFAULT_MAX_PROMPT_CHARS } from '../ai/firewall';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(name + (info ? ` — ${info}` : '')); };
const NOW = Date.parse('2026-10-29T18:00:00Z');
const MIN = 60000;

// ─── 1) هوية المصدر: لا يُزوَّر عنوان الحظر ───
{
  const direct = resolveClientIdentity({ forwardedFor: '203.0.113.9', socketIp: '10.0.0.5' });
  check('★ اتصال مباشر: العنوان = آخر عنوان أضافه Render، قابل للحظر', direct.ip === '203.0.113.9' && direct.edge === '203.0.113.9' && direct.blockable && !direct.viaProxy);
  const viaNf = resolveClientIdentity({ forwardedFor: '198.51.100.7, 203.0.113.50', socketIp: '10.0.0.5', nfRequestId: 'abc' });
  check('★ عبر Netlify: يُنسب للزائر ولا يُحظر (الحافة عقدة مشتركة)', viaNf.ip === '198.51.100.7' && viaNf.edge === '203.0.113.50' && !viaNf.blockable);
  const forged = resolveClientIdentity({ forwardedFor: '1.2.3.4, 198.51.100.99', socketIp: '10.0.0.5' });
  check('★ من يزيّف سلسلة X-Forwarded-For لا يُحظر عنوان الضحية: الحافة الحقيقية وحدها مفتاح الحظر', !forged.blockable && forged.edge === '198.51.100.99');
  const viaHost = resolveClientIdentity({ forwardedFor: '203.0.113.51', host: 'al-gharabi-ai.onrender.com', forwardedHost: 'alghrabi.netlify.app' });
  check('★ مضيف مُمرَّر يختلف عن مضيفنا = عبر وسيط ⇒ لا حظر', viaHost.viaProxy && !viaHost.blockable);
  check('المضيف نفسه = مباشر', resolveClientIdentity({ forwardedFor: '203.0.113.51', host: 'a.onrender.com', forwardedHost: 'a.onrender.com' }).blockable);
  const internal = resolveClientIdentity({ socketIp: '::ffff:127.0.0.1' });
  check('★ فحوص المهندس الداخلية (loopback) لا تُسجَّل ولا تُحظر', internal.internal && !internal.blockable);
  check('العناوين الخاصة داخلية', isInternalIp('10.1.2.3') && isInternalIp('192.168.1.1') && isInternalIp('172.20.0.1') && !isInternalIp('8.8.8.8'));
  check('★ العنوان يُقنّع للعرض', maskIp('203.0.113.9') === '203.0.*.*' && !maskIp('2001:db8:1:2::5').includes('::5'));
  check('مدخل تالف لا يُسقط', resolveClientIdentity({ forwardedFor: 'garbage<script>, ', socketIp: null }).edge === 'unknown');
}

// ─── 2) تصنيف الطلب: يكشف الهجوم ولا يمسّ التطبيق ───
{
  const attacks: Array<[string, string]> = [
    ['/.env', 'scanner'], ['/.git/config', 'scanner'], ['/wp-login.php', 'scanner'], ['/xmlrpc.php', 'scanner'], ['/phpmyadmin/', 'scanner'],
    ['/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php', 'scanner'], ['/actuator/health', 'scanner'], ['/backup.sql', 'scanner'], ['/.aws/credentials', 'scanner'],
    ['/../../etc/passwd', 'traversal'], ['/assets/..%2f..%2fserver.cjs', 'traversal'], ['/api/x?id=1%20union%20select%201', 'injection'], ['/?q=${jndi:ldap://x}', 'injection'],
  ];
  for (const [p, want] of attacks) check(`يكشف ${p}`, classifyRequest({ path: p.split('?')[0], rawUrl: p }) === want, String(classifyRequest({ path: p.split('?')[0], rawUrl: p })));
  const publicFiles = ['/apple-touch-icon.png', '/favicon-16x16.png', '/favicon.ico', '/tiktok-developers-site-verification.txt', '/tiktokdjxlJcC4WFlCh4OZY8iVHgezp491vPoZ.txt'];
  const legit = ['/', '/index.html', '/api/health', '/api/live/room?lite=1&wait=1', '/api/platforms/facebook/webhook', '/assets/index-Bx1.js', '/assets/a.css', '/terms', '/privacy', '/api/engineer/guardian', '/api/notifications?unread=1', ...publicFiles];
  const fp = legit.filter((p) => classifyRequest({ path: p.split('?')[0], rawUrl: p }));
  check('★ لا إنذار كاذب على مسارات التطبيق وملفاته العامة', fp.length === 0, fp.join(','));
  check('★ محاولة سحب حزمة المصدر', classifyRequest({ path: '/dr-source/x', blockedSource: true }) === 'source_probe');
  check('★ /api/auth/me بلا جلسة (401) ليس هجوماً', classifyResponse({ method: 'GET', path: '/api/auth/me', status: 401 }) === null);
  check('★ رمز تحقق خاطئ = دخول فاشل', classifyResponse({ method: 'POST', path: '/api/auth/verify-owner-challenge', status: 401 }) === 'auth_fail');
  check('★ بلوغ الحد', classifyResponse({ method: 'POST', path: '/api/auth/google', status: 429 }) === 'auth_limited');
  check('★ webhook بتوقيع خاطئ', classifyResponse({ method: 'POST', path: '/api/platforms/facebook/webhook', status: 401 }) === 'webhook_forged' && classifyResponse({ method: 'POST', path: '/api/webhooks/meta', status: 403 }) === 'webhook_forged');
  check('نجاح الطلب لا يُسجَّل', classifyResponse({ method: 'POST', path: '/api/auth/google', status: 200 }) === null);
}

// ─── 3) الحارس: الحظر والثقة والمستوى والحفظ ───
{
  const atk = resolveClientIdentity({ forwardedFor: '203.0.113.66' });
  const s = new SecuritySentinel('salt', NOW);
  let r = { blocked: false, until: null as number | null, score: 0 };
  for (let i = 0; i < 5; i++) r = s.record('scanner', atk, `/x${i}.php`, NOW + i * 1000);
  check('5 مسارات فحص: لم يُحظر بعد (العتبة 6)', !r.blocked && !s.isBlocked(atk, NOW + 6000));
  check('المستوى «استطلاع»', s.level(NOW + 6000) === 'probing');
  r = s.record('scanner', atk, '/.env', NOW + 6000);
  check('★ السادس يحظر المصدر المباشر ساعة', r.blocked && s.isBlocked(atk, NOW + 7000) && r.until === NOW + 6000 + SENTINEL_POLICY.baseBlockMs);
  check('★ المستوى «هجوم» أثناء الحظر', s.level(NOW + 7000) === 'attack');
  check('الحظر مؤقت', !s.isBlocked(atk, NOW + 6000 + SENTINEL_POLICY.baseBlockMs + 1));
  const t2 = NOW + 2 * 3600000;
  for (let i = 0; i < 2; i++) r = s.record('traversal', atk, '/../../etc/passwd', t2 + i);
  check('★ التكرار يضاعف مدة الحظر', r.blocked && r.until === t2 + 1 + 2 * SENTINEL_POLICY.baseBlockMs);

  const viaProxy = resolveClientIdentity({ forwardedFor: '198.51.100.1, 203.0.113.70', nfRequestId: 'x' });
  const s2 = new SecuritySentinel('salt', NOW);
  for (let i = 0; i < 40; i++) s2.record('scanner', viaProxy, '/.env', NOW + i);
  check('★ عبر وكيل Netlify: لا حظر أبداً (يُسجَّل ويُنذر فقط)', !s2.isBlocked(viaProxy, NOW + 100) && s2.level(NOW + 100) === 'attack');

  const owner = resolveClientIdentity({ forwardedFor: '203.0.113.10' });
  const s3 = new SecuritySentinel('salt', NOW);
  s3.trust(owner, NOW);
  for (let i = 0; i < 30; i++) s3.record('auth_fail', owner, '/api/auth/verify', NOW + i);
  check('★ عنوان دخل منه المالك لا يُحظر أبداً', !s3.isBlocked(owner, NOW + 100));
  const s4 = new SecuritySentinel('salt', NOW);
  for (let i = 0; i < 12; i++) s4.record('auth_fail', owner, '/api/auth/verify', NOW + i);
  check('12 دخولاً فاشلاً من مصدر غير موثوق = حظر', s4.isBlocked(owner, NOW + 100));
  s4.trust(owner, NOW + 200);
  check('★ دخول المالك الناجح يرفع الحظر عنه فوراً', !s4.isBlocked(owner, NOW + 300));

  const s5 = new SecuritySentinel('salt', NOW);
  for (let i = 0; i < 50; i++) s5.record('webhook_forged', atk, '/api/platforms/facebook/webhook', NOW + i);
  check('★ webhook مزوّر لا يحظر (قد تكون Meta بسرّ خاطئ) لكنه يُنذر', !s5.isBlocked(atk, NOW + 100) && s5.summary(NOW + 100).forgedWebhooks1h === 50 && s5.summary(NOW + 100).advice.some((a) => a.includes('META_APP_SECRET')));

  const sum = s.summary(NOW + 7000);
  const json = JSON.stringify(sum);
  check('★ الملخص لا يحمل العنوان الخام', !json.includes('203.0.113.66') && json.includes('203.0.*.*'));
  check('الملخص: أحداث وعدّادات يومية وحظر', sum.recent.length > 0 && sum.daily.length === 1 && sum.totalBlocks >= 1);
  check('internal لا يُسجَّل', new SecuritySentinel('s', NOW).record('scanner', resolveClientIdentity({ socketIp: '127.0.0.1' }), '/.env', NOW).score === 0);

  const snap = s.snapshot(NOW + 7000);
  const restored = new SecuritySentinel('salt', NOW + 8000, JSON.parse(JSON.stringify(snap)));
  check('★ الحظر والعدّادات تصمد بعد إعادة التشغيل', restored.isBlocked(atk, NOW + 9000) && restored.summary(NOW + 9000).daily.length === 1);
  check('★ المالك يرفع كل الحظر', restored.unblockAll(NOW + 9000) === 1 && !restored.isBlocked(atk, NOW + 9001));
  check('★ quietSince: الإنذار يزول حين يهدأ', !s.quietSince(NOW, NOW + 7000) && new SecuritySentinel('s', NOW).quietSince(NOW, NOW + 1));
}

// ─── 4) كناري الحرّاس: الحقيقيون يجتازون، والمعطوب يُكشف ───
{
  const real: GuardDeps = {
    requiresApproval, normalizeSendMode: (r) => normalizeCommercialSendMode(r as any),
    analyzeClaims: (t) => analyzeBusinessClaims(t, buildBusinessFacts({})),
    sanitizeUntrusted: (t) => sanitizeUntrustedText(t), untrustedCloseTag: UNTRUSTED_CLOSE_TAG,
    isBlockedSourcePath: (p) => { const c = decodeURIComponent(decodeURIComponent(p)).toLowerCase().replace(/\/\.\//g, '/').replace(/\/[^/]+\/\.\.\//g, '/'); return c.includes('/dr-source') || c === '/server.cjs' || c === '/server.cjs.map'; },
    enforcePromptLimit: (p) => enforcePromptLimit(p, DEFAULT_MAX_PROMPT_CHARS),
    classifyScanner: (p, raw) => classifyRequest({ path: p, rawUrl: raw }),
    sessionSecretSource: () => 'SESSION_SECRET', sessionSecretLength: () => 48,
  };
  const ok = runGuardCanary(real, NOW);
  check('★ كل الحرّاس الحقيقيين يجتازون الهجوم التجريبي', ok.failed === 0 && ok.total === GUARD_PROBES.length, JSON.stringify(ok.results.filter((r) => !r.ok)));
  const breakOne = (id: string, patch: Partial<GuardDeps>) => runGuardCanary({ ...real, ...patch }, NOW).results.find((r) => r.id === id)!;
  check('★ يكشف بوابة موافقة معطّلة', !breakOne('approval_gate', { requiresApproval: () => false }).ok);
  check('★ يكشف وضعاً افتراضياً يفتح الإرسال', !breakOne('approval_fail_closed', { normalizeSendMode: () => 'auto' }).ok);
  check('★ يكشف حارس ادعاءات يمرّر كل شيء', !breakOne('claims_guard', { analyzeClaims: () => ({ safe: true, violations: [] }) }).ok);
  check('★ يكشف عازلاً لا يزيل الوسم المزوّر', !breakOne('prompt_isolation', { sanitizeUntrusted: (t) => t }).ok);
  check('★ يكشف حجب مصدر يتجاوزه الترميز', !breakOne('source_bundle_block', { isBlockedSourcePath: (p) => p.startsWith('/dr-source') }).ok);
  check('★ يكشف سقف Gemini معطّلاً', !breakOne('prompt_limit', { enforcePromptLimit: (p) => ({ truncated: false, prompt: p }) }).ok);
  check('★ يكشف كاشف اختراق أعمى', !breakOne('intrusion_detector', { classifyScanner: () => null }).ok);
  check('★ يكشف سرّ جلسات قصيراً', !breakOne('session_secret', { sessionSecretLength: () => 8 }).ok);
  check('★ الحارس الذي يرمي استثناءً = لا يحمي', !breakOne('claims_guard', { analyzeClaims: () => { throw new Error('boom'); } }).ok);
  // سطر الفشل ⇒ عطل حرج بقاعدة وخطة إصلاح
  const bad = runGuardCanary({ ...real, requiresApproval: () => false }, NOW).results.find((r) => r.id === 'approval_gate')!;
  const d = classifyFailure({ source: 'log', text: guardFailureLine(bad), level: 'error' });
  check('★ فشل الحارس = عطل حرج لمهندس الكود', d?.key === 'guard:approval_gate' && d.severity === 'critical' && d.owner === 'developer', JSON.stringify(d));
  const plan = repairPlanFor({ kind: 'code', owner: 'developer', rule: 'guard:approval_gate', fix: '', lastMethod: null, lastPath: null });
  check('★ المهندس يعيد الاختبار ويغلقه ✅ متى عاد يحمي', plan.action === 'verify_guard' && (plan as any).guard === 'approval_gate');
  const sec = classifyFailure({ source: 'log', text: guardFailureLine(breakOne('session_secret', { sessionSecretLength: () => 8 })), level: 'error' });
  check('★ سرّ الجلسات الضعيف بيد المالك بالإجراء الدقيق', sec?.owner === 'owner' && /SESSION_SECRET/.test(sec.fix) && repairPlanFor({ kind: 'config', owner: 'owner', rule: 'guard:session_secret', fix: sec.fix, lastMethod: null, lastPath: null }).action === 'owner');
}

// ─── 5) الحافة من الإنترنت ───
{
  const t = edgeTargets('https://alghrabi.netlify.app/', 'https://al-gharabi-ai.onrender.com');
  check('★ هدفان: العام وRender', t.length === 2 && t[0].id === 'public' && t[1].id === 'render');
  check('لا تكرار للنطاق نفسه ولا http', edgeTargets('https://a.onrender.com', 'https://a.onrender.com').length === 1 && edgeTargets('http://localhost:3000', null).length === 0);
  const H = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' };
  const in60 = new Date(NOW + 60 * 86400000).toISOString();
  const ok = judgeEdge(t[0], { status: 200, ms: 900, headers: H }, { validTo: in60, issuer: "Let's Encrypt" }, NOW);
  check('سليم', ok.verdict === 'ok' && ok.tlsDaysLeft === 60);
  check('★ لا يُفتح', judgeEdge(t[0], { status: 0, ms: 20000, headers: {}, error: 'ENOTFOUND' }, null, NOW).verdict === 'down');
  check('★ 502 من الوكيل = معطّل', judgeEdge(t[0], { status: 502, ms: 300, headers: H }, null, NOW).verdict === 'down');
  check('★ شهادة منتهية', judgeEdge(t[0], { status: 200, ms: 300, headers: H }, { validTo: new Date(NOW - 86400000).toISOString(), issuer: null }, NOW).verdict === 'tls_expired');
  check('★ شهادة قاربت', judgeEdge(t[0], { status: 200, ms: 300, headers: H }, { validTo: new Date(NOW + 5 * 86400000).toISOString(), issuer: null }, NOW).verdict === 'tls_soon');
  check('★ ترويسات الحماية لا تصل', judgeEdge(t[0], { status: 200, ms: 300, headers: {} }, null, NOW).verdict === 'headers');
  check('بطيء', judgeEdge(t[1], { status: 200, ms: EDGE_POLICY.slowMs + 1, headers: H }, null, NOW).verdict === 'slow');
  const down = judgeEdge(t[0], { status: 0, ms: 20000, headers: {}, error: 'ECONNRESET' }, null, NOW);
  check('الأسوأ يحكم الجولة', edgeRound([ok, down], NOW).worst === 'down');
  const line = edgeFailureLine(down)!;
  const d = classifyFailure({ source: 'log', text: line, level: 'warn' });
  check('★ الموقع المعطّل = عطل حرج يتحقق منه المهندس', d?.key === 'edge:public:down' && d.severity === 'critical' && d.owner === 'engineer', JSON.stringify(d));
  check('★ خطة الإصلاح: إعادة الفحص الخارجي', repairPlanFor({ kind: 'provider', owner: 'engineer', rule: 'edge:public:down', fix: '', lastMethod: null, lastPath: null }).action === 'verify_edge');
  check('السليم والبطيء بلا سطر عطل', edgeFailureLine(ok) === null);
}

// ─── 6) الخطط المجانية والخزن ───
{
  const mid = Date.parse('2026-10-16T00:00:00Z');
  check('نسبة الشهر', Math.abs(monthElapsedFraction(mid) - 15 / 31) < 0.01);
  const v = judgePlan({ provider: 'render', label: 'ساعات Render', usedPercent: 60, period: 'month_utc' }, mid);
  check('★ 60% في منتصف الشهر (المسموح ~53%) ⇒ سبق إيقاعه ⇒ تحذير الآن', v.status === 'warn' && (v.projectedPercent || 0) > 100 && v.paceState === 'ahead', JSON.stringify(v));
  check('★ 85% في آخر يوم من الشهر = تحت إيقاعه ⇒ سليم (تُستعمل الحصة حتى أقصاها)', judgePlan({ provider: 'render', label: 'r', usedPercent: 85, period: 'month_utc' }, Date.parse('2026-10-31T12:00:00Z')).status === 'ok');
  check('اليومي يُحكم بإيقاع يومه', judgePlan({ provider: 'gemini', label: 'g', usedPercent: 50, period: 'day_utc' }, Date.parse('2026-10-16T06:00:00Z')).status === 'fail' && judgePlan({ provider: 'gemini', label: 'g', usedPercent: 50, period: 'day_utc' }, Date.parse('2026-10-16T18:00:00Z')).status === 'ok');
  check('≥95% عطل', judgePlan({ provider: 'drive', label: 'd', usedPercent: 96, period: 'capacity' }, mid).status === 'fail');
  check('غير مقيس = غير متاح', judgePlan({ provider: 'neon', label: 'n', usedPercent: null, period: 'month_utc' }, mid).status === 'skip');
  check('الأسوأ يحكم', judgePlans([{ provider: 'a', label: 'a', usedPercent: 10, period: 'day_utc' }, { provider: 'b', label: 'b', usedPercent: 97, period: 'capacity' }], mid).worst?.provider === 'b');
  const Q = 512 * 1048576;
  const sv = judgeStorage({ at: '', backend: 'postgres', databaseBytes: 400 * 1048576, keys: [{ key: 'state', bytes: 300 * 1048576 }] }, Q, 5 * 1048576);
  check('★ القاعدة 78% وتمتلئ بعد ~22 يوماً ⇒ تحذير يسمّي الأكبر', sv.status === 'warn' && sv.daysToFull === 22 && sv.detail.includes('state'), JSON.stringify(sv));
  check('بلا قياس = غير متاح', judgeStorage(null, Q, null).status === 'skip');
  check('معدل النمو يحتاج 6 س على الأقل', bytesGrowthPerDay({ t: 0, v: 0 }, { t: 3600000, v: 10 }) === null && bytesGrowthPerDay({ t: 0, v: 0 }, { t: 86400000, v: 100 }) === 100);
}

// ─── 7) الدورية: الفحوص الجديدة ───
{
  const ids = [...read('engine/ops/engineerPatrol.ts').matchAll(/\bc\('([\w.]+)'/g)].map((m) => m[1]);
  check('عدد الفحوص المعرّفة يطابق المسجّل', ids.length === Object.values(PATROL_CHECKS).flat().length);
  for (const id of ['auth.intrusion', 'auth.bruteforce', 'auth.dependencies', 'platforms.forgery', 'gate.canary', 'monitor.edge', 'monitor.freeplans', 'storage.size']) check(`فحص ${id} موجود`, ids.includes(id));
  check('أوزان الأثر', CHECK_IMPACT['gate.canary'] === 3 && CHECK_IMPACT['monitor.edge'] === 3 && CHECK_IMPACT['storage.size'] === 3);
  const base = { nowMs: NOW, collections: [], platforms: [], schedulers: [], measured: [], lastInboundAt: {}, lastWebhookAt: {}, audienceKnown: {}, watcherErrors: { youtube: 0, meta: 0 }, staleCycleNames: [], probeFailedLabels: [] } as unknown as PatrolFacts;
  const pick = (m: any, id: string, f: Partial<PatrolFacts>) => inspectModule(m, { ...base, ...f } as PatrolFacts).checks.find((c) => c.id === id)!;
  check('★ بلا حقائق الحارس: «غير متاح» لا عطل', pick('gate', 'gate.canary', {}).status === 'skip' && pick('monitor', 'monitor.edge', {}).status === 'skip' && pick('auth', 'auth.intrusion', {}).status === 'skip');
  check('★ حارس معطّل = عطل', pick('gate', 'gate.canary', { guards: { total: 8, failed: 1, failedLabels: ['بوابة الموافقة'], ageMin: 2 } }).status === 'fail');
  check('★ الموقع لا يُفتح = عطل', pick('monitor', 'monitor.edge', { edge: { worst: 'down', details: ['x'], remedy: 'r', ageMin: 1 } }).status === 'fail');
  check('★ هجوم يُصدّ = تحذير (لا عطل: الحارس يعمل)', pick('auth', 'auth.intrusion', { security: { level: 'attack', activeBlocks: 1, last24h: { scanner: 9 }, forgedWebhooks1h: 0, lastHourScore: 9 } }).status === 'warn');
  check('استطلاع مرفوض = سليم', pick('auth', 'auth.intrusion', { security: { level: 'probing', activeBlocks: 0, last24h: { scanner: 2 }, forgedWebhooks1h: 0, lastHourScore: 2 } }).status === 'ok');
  check('★ ثغرة مكتبة حرجة = عطل', pick('auth', 'auth.dependencies', { deps: { ok: true, at: '2026-10-29', critical: 1, high: 0, moderate: 0, top: ['x'], error: null } }).status === 'fail');
  check('ثغرة عالية = تحذير', pick('auth', 'auth.dependencies', { deps: { ok: true, at: '2026-10-29', critical: 0, high: 2, moderate: 0, top: [], error: null } }).status === 'warn');
  check('★ القاعدة ممتلئة = عطل', pick('storage', 'storage.size', { storageSize: { status: 'fail', detail: '95%', advice: 'x' } }).status === 'fail');
  check('webhook مزوّر متكرر = تحذير', pick('platforms', 'platforms.forgery', { security: { level: 'probing', activeBlocks: 0, last24h: { webhook_forged: 9 }, forgedWebhooks1h: 9, lastHourScore: 0 } }).status === 'warn');
}

// ─── 8) الخادم موصول فعلاً ───
{
  const srv = read('server.ts');
  check('★ الطلب المحظور يُرفض قبل أي معالجة', srv.includes('securitySentinel.isBlocked(id, Date.now())') && srv.includes('return res.status(403).type("text/plain").send("blocked")'));
  check('★ كل طلب يُصنَّف ويُسجَّل عند انتهائه (والمالك بجلسته مستثنى)', srv.includes('classifyRequest({ path: req.path, rawUrl: req.originalUrl, blockedSource: isBlockedSourceRequest(req.path) })') && srv.includes('if ((req as any).user) return;'));
  check('★ حدود الدخول بعنوان الزائر الحقيقي لا بعنوان وكيل Render المشترك', !/(google|preview|verify-challenge):\$\{req\.ip/.test(srv) && !srv.includes('const challengeKey = `${req.ip') && srv.includes('`google:${clientKey(req)}`') && srv.includes('`preview:${clientKey(req)}`'));
  check('★ سقف لكل بريد يمنع تخمين الرمز بتدوير العناوين', srv.includes('allowAuthAttempt(`verify-email:${normalizedEmail}`, 20)') && srv.includes('allowAuthAttempt(`challenge-email:${normalizedEmail}`, 15)') && srv.includes('allowAuthAttempt("google:all", 120)'));
  check('★ عنوان المالك موثوق بعد كل دخول ناجح (Google/الرمز/المعاينة)', (srv.match(/guardianTrust\(req, (user|owner)\);/g) || []).length === 3);
  check('★ الإنذار الأمني يُغلق ✅ حين يهدأ (لا يبقى معلّقاً)', srv.includes('case "security_alert":') && srv.includes('securitySentinel.quietSince(created, Date.now())'));
  check('★ الحارس يبدأ مع المهندس ويُحمَّل بعد الإقلاع', srv.includes('  startGuardian();\n}') && srv.includes('await loadGuardianState();'));
  check('★ خطط الإصلاح الجديدة منفّذة', srv.includes('case "verify_guard": return {') && srv.includes('case "verify_edge": return {'));
  check('★ الكناري يهاجم الدوال الحقيقية نفسها', srv.includes('isBlockedSourcePath: (p) => isBlockedSourceRequest(p)') && srv.includes('analyzeClaims: (t) => analyzeBusinessClaims(t, buildBusinessFacts({}))'));
  check('★ حقائق الحارس تصل للدورية وعرضه لغرفة المهندس', srv.includes('...safe(() => guardianFacts(nowMs,') && srv.includes('guardian: (() => { try { return guardianView(full); }'));
  check('★ مسارات المالك فقط', srv.includes('app.get("/api/engineer/guardian", requireOwner') && srv.includes('app.post("/api/engineer/guardian/unblock", requireOwner') && srv.includes('app.post("/api/engineer/guardian/run", requireOwner'));
  check('★ شاشة الحارس ضمن فحص الشاشات الاستباقي', PROBE_ROUTES.some((r) => r.path === '/api/engineer/guardian'));
  const ad = read('engine/storage/adapter.ts');
  check('★ حجم القاعدة الحقيقي (قراءة فقط)', ad.includes('pg_database_size(current_database())') && (ad.match(/async sizeReport\(\)/g) || []).length === 2);
  const dock = read('Dockerfile');
  check('★ لقطة ثغرات المكتبات زمن البناء خارج dist (لا تُخدم علناً)', dock.includes('RUN node scripts/dep-audit-snapshot.mjs /app/dep-audit.json') && dock.includes('COPY --from=build /app/dep-audit.json ./dep-audit.json'));
  check('★ مراقبة ثغرات أسبوعية تفتح تذكرة وتغلقها ✅', existsSync(join(ROOT, '.github/workflows/security-watch.yml')) && read('.github/workflows/security-watch.yml').includes('gh issue close'));
}

// ─── 9) سكربت لقطة الثغرات لا يكسر البناء أبداً ───
{
  const dir = mkdtempSync(join(tmpdir(), 'dep-audit-'));
  const out = join(dir, 'snap.json');
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/dep-audit-snapshot.mjs'), out], { cwd: dir, encoding: 'utf8', timeout: 120000 });
  const snap = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  check('★ يكتب الملف ويخرج بنجاح حتى بلا مشروع/شبكة', r.status === 0 && snap && typeof snap.ok === 'boolean' && snap.counts && 'critical' in snap.counts, String(r.stderr || '').slice(0, 200));
}

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} engineer-guardian checks`);
