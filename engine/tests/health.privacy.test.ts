/**
 * اختبار خصوصية النقاط العامة /api/health و/api/readiness.
 *
 * يثبت أن النقطتين العامتين (بلا مصادقة، لأدوات المراقبة) لا تحملان أي بيانات
 * عملاء: لا اسم حساب، ولا نص تعليق، ولا نص رد. الحقول التقنية فقط (status،
 * العدّادات، watcherActive، pollCount، آخر خطأ كرمز تقني) مسموحة.
 *
 * ويُثبت أن البيانات التفصيلية (attentionRequired/lastReply) تبقى متاحة عبر
 * المسار المحمي بالتصريح /api/agent/youtube/watcher — فلم تُحذف من النظام،
 * فقط أُزيلت من النقطتين العامتين.
 *
 * لا يلمس أي منصة ولا مزود ولا سرّ؛ يزرع حالة مراقبة محفوظة في مجلد حالة مؤقت
 * ثم يقرأ الاستجابات الفعلية من خادم حقيقي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const PORT = 6300 + Math.floor(Math.random() * 120);
const BASE = `http://127.0.0.1:${PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'health-privacy-test-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-health-privacy-'));

// قيم اختبارية تحمل بصمة واضحة (اسم/نص تعليق/نص رد) لنكشف أي تسريب إلى النقاط العامة.
const LEAK_AUTHOR = 'PRIVACY_CANARY_AUTHOR_ZZZ';
const LEAK_COMMENT = 'PRIVACY_CANARY_COMMENT_TEXT_ZZZ';
const LEAK_REPLY = 'PRIVACY_CANARY_REPLY_TEXT_ZZZ';
const LEAK_ERROR = 'فشل مزود يحوي نصاً عربياً محتملاً من محادثة عميل';
// canary للإدراك: نص تعليق/هدف/إجراء رد — للتحقق أن الحقول النصّية لا تُعلن في الصحة/الجاهزية العامة.
const LEAK_COGNITION = 'PRIVACY_CANARY_COGNITION_TEXT_ZZZ';

/** حالة مراقبة محفوظة: قرار تصعيد + رد مُسلَّم + خطأ بنص حر (لاختبار التنقية). */
const seededWatcherState = {
  controls: { enabled: false, paused: true, autoReply: false, autoPublish: false, autoSchedule: false, humanReviewMode: false, cadenceMinutes: 2 },
  processed: [
    {
      commentId: 'cmt_canary_escalated', stage: 'ESCALATED', action: 'escalate',
      reason: 'استفسار تجاري', videoId: 'vid_canary', authorName: LEAK_AUTHOR,
      text: LEAK_COMMENT, at: new Date().toISOString(), code: 'ESCALATE_BUSINESS_INQUIRY',
    },
    {
      commentId: 'cmt_canary_replied', stage: 'REPLIED', action: 'reply',
      reason: 'رد', videoId: 'vid_canary', authorName: LEAK_AUTHOR,
      text: LEAK_COMMENT, at: new Date().toISOString(), externalReplyId: 'yt_reply_canary', replyText: LEAK_REPLY,
    },
  ],
  opportunities: [{ id: 'opp-canary', kind: 'repeated_question', detail: `سؤال متكرر: ${LEAK_COMMENT}`, count: 3, at: new Date().toISOString() }],
  audit: [],
  lastPollAt: new Date().toISOString(),
  lastCommentId: 'cmt_canary_escalated',
  lastCommentAt: new Date().toISOString(),
  lastError: LEAK_ERROR,
  consecutiveErrors: 1,
  pollCount: 7,
  brief: null,
  briefDate: null,
  lastScanned: 0,
  reviewOverrides: [],
  lease: null,
  contentQueue: [],
  contentMediaTotalBytes: 0,
};

function seedState(): void {
  writeFileSync(join(stateDir, 'youtubeWatcher.json'), JSON.stringify(seededWatcherState, null, 2));
  // تقرير دورة إدراكية محفوظ يحمل نصاً حساساً في الحقول النصّية الحرة. الغرض: إثبات
  // أن /api/health و/api/readiness العامتين لا تُعلنان هذه الحقول (كانت lastObjective/
  // lastGoal/lastNextAction تسرّب نص التعليق/الرد)، وأن التفاصيل تبقى للمالك فقط.
  const now = new Date().toISOString();
  writeFileSync(join(stateDir, 'workingMemory.json'), JSON.stringify({
    workingMemory: { entries: [
      { conversationId: 'canary-conv', platform: 'youtube', objective: LEAK_COGNITION, lastCustomerMessage: LEAK_COMMENT, unresolvedQuestion: LEAK_COMMENT, updatedAt: now },
    ] },
    reports: [{
      cycleId: 'cy-canary', eventIdentity: 'canary-event', platform: 'youtube', status: 'completed',
      observability: { currentObjective: LEAK_COGNITION, escalationState: 'none', memoryUsed: 0, agentsConsulted: [] },
      goalPlan: { currentGoal: { labelAr: LEAK_COGNITION } },
      nextAction: { labelAr: LEAK_REPLY },
      decisionStatus: 'AUTO_SAFE', phases: [],
    }],
  }, null, 2));
}

let proc: ChildProcess | null = null;
let log = '';
function startApp(): void {
  log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(PORT), NODE_ENV: 'production', APP_URL: BASE,
    STATE_DIR: stateDir, GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET,
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
}

async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function loginOwner(): Promise<Record<string, string>> {
  const login = await fetch(`${BASE}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  const body = await login.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}

async function stop(): Promise<void> {
  if (!proc) return;
  try { proc.kill('SIGTERM'); } catch { /* تجاهل */ }
  await new Promise((r) => setTimeout(r, 900));
  try { proc.kill('SIGKILL'); } catch { /* تجاهل */ }
}

/** يفكّ كل قيم الكائن المتداخلة (بما فيها المصفوفات) للبحث النصي الشامل. */
function flatten(value: unknown, out: string[] = []): string[] {
  if (value == null) return out;
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { for (const v of value) flatten(v, out); return out; }
  if (typeof value === 'object') { for (const v of Object.values(value as Record<string, unknown>)) flatten(v, out); return out; }
  return out;
}
function hasLeak(obj: unknown): boolean {
  const joined = flatten(obj).join('\n');
  return joined.includes(LEAK_AUTHOR) || joined.includes(LEAK_COMMENT) || joined.includes(LEAK_REPLY) || joined.includes(LEAK_COGNITION);
}
function keysOf(obj: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(obj)) { for (const v of obj) keysOf(v, acc); return acc; }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) { acc.add(k); keysOf(v, acc); }
  }
  return acc;
}

// أسماء حقول تحمل بيانات عميل صراحةً — ممنوعة في أي مكان بالنقطتين العامتين.
// قائمة صريحة (لا أنماط واسعة) لتفادي الإنذارات الكاذبة على مفاتيح تقنية مثل
// commentsCapability/nextAction. أي حقل جديد بهذا المعنى يجب أن يُضاف هنا عن قصد.
const FORBIDDEN_CUSTOMER_FIELDS = [
  'authorName', 'commentText', 'commentAuthor', 'replyText', 'lastReply',
  'attentionRequired', 'customerName', 'customerPhone', 'customerEmail',
  'contactPhone', 'contactEmail', 'objective', 'lastGoal', 'lastObjective',
  'lastNextAction', 'customerMessage', 'lastCustomerMessage', 'unresolvedQuestion',
];

// الحقول التقنية الدنيا المسموح بها فقط في الكتلة العامة youtubeWatcher (allow-list
// صارم): أي حقل جديد (قد يحمل بيانات عميل أو تفاصيل تشغيلية زائدة) يُفشل الاختبار
// حتى يُراجَع عن قصد. العدّادات التفصيلية (counters) والمعرّفات نُقلت للمسار المحمي.
// pollCount وlastPollAt حُسِما كمؤشرات تقنية (liveness): عدّاد دورات الفحص الناجحة
// وطابع آخر دورة — لا يحملان بيانات عملاء ولا عدّادات تجارية، فيُعلنان في النقطتين
// العامتين. أما counters التفصيلية (detected/replied/escalated...) والمعرّفات فتبقى
// للمالك فقط عبر المسار المحمي.
const ALLOWED_WATCHER_PUBLIC_KEYS = new Set([
  'status', 'watcherActive', 'cadenceMinutes', 'cadenceMs', 'lastError',
  'consecutiveErrors', 'note', 'pollCount', 'lastPollAt',
]);

// الحقول التشغيلية التفصيلية التي يجب ألا تظهر في النقطتين العامتين (نُقلت للمالك).
// pollCount مُستثنى عن قصد (مؤشر تقني liveness لا تفصيل تجاري).
const FORBIDDEN_OPERATIONAL_DETAIL_FIELDS = [
  'counters', 'usedUnits', 'remainingUnits', 'byOperation', 'mediaTotalBytes',
  'mediaStored', 'byState',
];

async function run(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  seedState();
  startApp();
  try {
    const up = await waitForHealth();
    check('الخادم يقلع للاختبار', up, log.slice(0, 400));
    if (!up) throw new Error('الخادم لم يبدأ');

    group('1) /api/health العامة لا تحمل أي بيانات عميل');
    const healthRes = await fetch(`${BASE}/api/health`);
    const health = await healthRes.json();
    check('الصحة بلا مصادقة تعمل (200)', healthRes.status === 200 && health.status === 'ok');
    check('لا اسم حساب/نص تعليق/نص رد في استجابة الصحة', !hasLeak(health), JSON.stringify(flatten(health).filter((s) => s.includes('CANARY')).slice(0, 5)));
    const healthKeys = keysOf(health);
    check('لا حقل replyText في الصحة', !healthKeys.has('replyText'));
    check('لا حقل attentionRequired في الصحة', !healthKeys.has('attentionRequired'));
    check('لا حقل authorName في الصحة', !healthKeys.has('authorName'));
    check('لا حقل lastReply في الصحة', !healthKeys.has('lastReply'));
    // الإدراك: الحقول النصّية الحرة كانت تسرّب نص التعليق/الهدف/الرد — لا تُعلن عامةً.
    check('لا حقل آخر هدف إدراكي نصّي في الصحة', !healthKeys.has('lastGoal'));
    check('لا حقل آخر objective إدراكي نصّي في الصحة', !healthKeys.has('lastObjective'));
    check('لا حقل آخر إجراء إدراكي نصّي في الصحة', !healthKeys.has('lastNextAction'));
    // حارس صريح عام: لا أي حقل يحمل بيانات عميل في أي مكان بالنقطة العامة.
    const forbiddenInHealth = FORBIDDEN_CUSTOMER_FIELDS.filter((f) => healthKeys.has(f));
    check('لا حقل بيانات عميل معروف في الصحة (قائمة صريحة)', forbiddenInHealth.length === 0, forbiddenInHealth.join(','));

    group('2) /api/health تُبقي الحقول التقنية غير الحساسة فقط');
    const w = health.youtubeWatcher;
    check('كتلة youtubeWatcher موجودة', Boolean(w));
    check('watcherActive منطقي', typeof w?.watcherActive === 'boolean');
    check('حالة عامة status (healthy/degraded/disabled)', ['healthy', 'degraded', 'disabled'].includes(w?.status), String(w?.status));
    check('آخر خطأ نُقّي إلى رمز تقني/رسالة عامة', w?.lastError === 'connection error', String(w?.lastError));
    check('commit النشر يُعلن', 'deploy' in health && 'commit' in (health.deploy || {}));
    // allow-list صارم: الكتلة العامة youtubeWatcher لا تحمل إلا الحقول التقنية الدنيا.
    const watcherPublicExtra = Object.keys(w || {}).filter((k) => !ALLOWED_WATCHER_PUBLIC_KEYS.has(k));
    check('الكتلة العامة youtubeWatcher ضمن allow-list فقط', watcherPublicExtra.length === 0, watcherPublicExtra.join(','));
    // تقليص M2: لا عدّادات تفصيلية في الكتلة العامة.
    check('لا عدّاد تفصيلي counters في الكتلة العامة', !('counters' in (w || {})));
    // pollCount حُسِم كمؤشر تقني (liveness): يُعلن في العامتين، ويطابق العدد المُغذّى.
    check('pollCount مؤشر تقني مُعلن في الكتلة العامة', typeof w?.pollCount === 'number', String(w?.pollCount));
    check('pollCount يطابق العدد المُغذّى (7)', w?.pollCount === 7, String(w?.pollCount));
    check('lastPollAt مؤشر تقني مُعلن في الكتلة العامة', typeof w?.lastPollAt === 'string', String(w?.lastPollAt));

    group('2b) M2: /api/health لا تكشف تفاصيل تشغيلية زائدة');
    // youtubeQuota: الحالة المجملة فقط في الصحة (لا usedUnits/remainingUnits/byOperation).
    const q = health.youtubeQuota || {};
    check('youtubeQuota تُعلن في الصحة (حالة مجملة)', Boolean(health.youtubeQuota));
    check('youtubeQuota: الحقول التقنية المجملة فقط', ['protectionEnabled', 'thresholdReached', 'exhausted', 'usedPercent', 'alertThresholdPercent', 'note'].every((k) => k in q), Object.keys(q).join(','));
    check('youtubeQuota: لا usedUnits في الصحة', !('usedUnits' in q));
    check('youtubeQuota: لا remainingUnits في الصحة', !('remainingUnits' in q));
    check('youtubeQuota: لا byOperation في الصحة', !('byOperation' in q));
    // youtubeContent: مجاميع عامة فقط (لا byState ولا mediaTotalBytes).
    const c = health.youtubeContent || {};
    check('youtubeContent: لا byState في الصحة', !('byState' in c) && !('byState' in (c.summary || {})));
    check('youtubeContent: لا mediaTotalBytes في الصحة', !('mediaTotalBytes' in c));
    // قائمة الحقول التشغيلية التفصيلية الممنوعة على المستوى العلوي للصحة.
    const healthTopKeys = new Set(Object.keys(health));
    const forbiddenOperational = FORBIDDEN_OPERATIONAL_DETAIL_FIELDS.filter((f) => healthTopKeys.has(f));
    check('لا حقول تشغيلية تفصيلية معروفة في الصحة (قائمة صريحة)', forbiddenOperational.length === 0, forbiddenOperational.join(','));
    // التفاصيل الكاملة متاحة للمالك عبر المسار المحمي الجديد.
    const authQuota = await loginOwner();
    const anonQuota = await fetch(`${BASE}/api/agent/youtube/quota`);
    check('مسار تفاصيل الحصة محمي (401 بلا جلسة)', anonQuota.status === 401, String(anonQuota.status));
    const ownerQuota = await (await fetch(`${BASE}/api/agent/youtube/quota`, { headers: authQuota })).json();
    check('المالك يقرأ التفاصيل الكاملة للحصة', ownerQuota.success === true && 'usedUnits' in (ownerQuota.quota || {}) && 'byOperation' in (ownerQuota.quota || {}));

    group('3) /api/readiness العامة لا تحمل أي بيانات عميل');
    const readyRes = await fetch(`${BASE}/api/readiness`);
    const ready = await readyRes.json();
    check('الجاهزية بلا مصادقة تعمل (200)', readyRes.status === 200 && ready.success === true);
    check('لا اسم حساب/نص تعليق/نص رد في استجابة الجاهزية', !hasLeak(ready));
    const readyKeys = keysOf(ready);
    check('لا حقل replyText في الجاهزية', !readyKeys.has('replyText'));
    check('لا حقل attentionRequired في الجاهزية', !readyKeys.has('attentionRequired'));
    check('لا حقل lastGoal إدراكي في الجاهزية', !readyKeys.has('lastGoal'));
    const forbiddenInReady = FORBIDDEN_CUSTOMER_FIELDS.filter((f) => readyKeys.has(f));
    check('لا حقل بيانات عميل معروف في الجاهزية (قائمة صريحة)', forbiddenInReady.length === 0, forbiddenInReady.join(','));

    group('4) البيانات التفصيلية تبقى في المسار المحمي بالمالك');
    const auth = await loginOwner();
    const anonWatcher = await fetch(`${BASE}/api/agent/youtube/watcher`);
    check('مسارات التفاصيل محمية (401 بلا جلسة)', anonWatcher.status === 401, String(anonWatcher.status));
    const ownerRes = await fetch(`${BASE}/api/agent/youtube/watcher`, { headers: auth });
    const owner = await ownerRes.json();
    check('المالك يقرأ الحالة الكاملة (200)', ownerRes.status === 200 && owner.success === true);
    check('attentionRequired متاح للمالك', Array.isArray(owner.watcher?.attentionRequired) && owner.watcher.attentionRequired.length === 1);
    check('نص التعليق واسم الحساب متاحان للمالك', owner.watcher?.attentionRequired?.[0]?.text === LEAK_COMMENT && owner.watcher?.attentionRequired?.[0]?.authorName === LEAK_AUTHOR);
    check('lastReply.replyText متاح للمالك', owner.watcher?.lastReply?.replyText === LEAK_REPLY);
    check('الحقول التفصيلية فعلاً محميّة (ليست عامة)', hasLeak(owner.watcher) && !hasLeak(health));
    // الإدراك: التفاصيل النصّية تبقى للمالك عبر المسار المحمي (لا تُحذف من النظام).
    const anonCognition = await fetch(`${BASE}/api/agent/brain/cognition/reports`);
    check('تقارير الإدراك محمية (401 بلا جلسة)', anonCognition.status === 401, String(anonCognition.status));
    const ownerCognition = await (await fetch(`${BASE}/api/agent/brain/cognition/reports`, { headers: auth })).json();
    check('التفاصيل النصّية للإدراك متاحة للمالك', ownerCognition.reports?.[0]?.currentGoal === LEAK_COGNITION && ownerCognition.reports?.[0]?.nextAction === LEAK_REPLY);

    console.log('\n' + '='.repeat(60));
    if (failures.length) {
      console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
      for (const f of failures) console.error(`  ✗ ${f}`);
      process.exitCode = 1;
    } else {
      console.log(`PASSED: ${passed} health/readiness privacy checks`);
    }
  } finally {
    await stop();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

run().catch((err) => { console.error('Health privacy harness crashed:', err); process.exit(1); });
