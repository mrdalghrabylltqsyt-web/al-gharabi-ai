/**
 * اختبار جدولة المنشورات وتوحيد التوقيت (Asia/Baghdad).
 *
 * يثبت أن المعنى المحلي الذي يختاره المستخدم في العراق هو الثابت في كل المسار:
 * الواجهة → الإرسال → التحقق في الخادم → التخزين → إعادة القراءة → العرض،
 * وأن مقارنة «الماضي/المستقبل» تجري على لحظة UTC حقيقية لا على مقارنة نصية أو
 * تحويل `toISOString()` يزحزح الساعة 3 ساعات.
 *
 * الجزء الأول منطق خالص (بلا شبكة)، والجزء الثاني يشغّل الخادم الفعلي ويجرّب
 * مسار المحتوى نفسه عبر جلسة مالك (بلا OTP ولا Resend، بلا أي نشر خارجي).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  APP_TIMEZONE,
  defaultScheduleInput,
  isScheduleInFuture,
  normalizeScheduleInput,
  parseWallClock,
  toScheduleDisplay,
  wallClockInputValue,
  wallClockToEpoch,
  wallClockToIsoWithOffset,
  zonedWallClockToEpoch,
} from '../../src/utils/scheduleTime';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

// ------------------------------------------------------------ منطق خالص
group('1) قراءة الجدار الزمني المحلي');
check('يقبل صيغة datetime-local', parseWallClock('2026-09-25T19:30') !== null);
check('يقبل صيغة التخزين بالمسافة', parseWallClock('2026-09-25 19:30') !== null);
check('يرفض نصاً بلا وقت', parseWallClock('2026-09-25') === null);
check('يرفض لحظة ISO تحمل منطقة (ليست جداراً محلياً)', parseWallClock('2026-09-25T19:30:00.000Z') === null);
check('يرفض تاريخاً غير حقيقي (31 فبراير)', parseWallClock('2026-02-31T10:00') === null);
check('يرفض القيم غير النصية', parseWallClock(null as unknown as string) === null && parseWallClock(123 as unknown as string) === null);

group('2) تحويل Asia/Baghdad إلى لحظة UTC (لا فرق ساعات مضاعف)');
const wall1930 = parseWallClock('2026-09-25T19:30')!;
check('19:30 بغداد = 16:30 UTC', new Date(zonedWallClockToEpoch(wall1930)).toISOString() === '2026-09-25T16:30:00.000Z', new Date(zonedWallClockToEpoch(wall1930)).toISOString());
check('الإزاحة +03:00', wallClockToIsoWithOffset('2026-09-25T19:30') === '2026-09-25T19:30:00+03:00', String(wallClockToIsoWithOffset('2026-09-25T19:30')));
check('wallClockToEpoch يساوي التحويل المباشر', wallClockToEpoch('2026-09-25T19:30') === zonedWallClockToEpoch(wall1930));

group('3) لا فرق ساعات عند العرض');
check('لحظة UTC تُعرض بالساعة المحلية الصحيحة', toScheduleDisplay('2026-09-25T16:30:00.000Z') === '2026-09-25T19:30', String(toScheduleDisplay('2026-09-25T16:30:00.000Z')));
check('الجدار المحلي المخزَّن يُعرض كما هو بلا زحزحة', toScheduleDisplay('2026-09-25T19:30') === '2026-09-25T19:30');
check('قيمة حقل datetime-local تطابق اختيار المستخدم', wallClockInputValue('2026-09-25T19:30') === '2026-09-25T19:30');
check('toScheduleDisplay يرفض النص غير الصالح', toScheduleDisplay('ليس وقتاً') === null);

group('4) عبور منتصف الليل عبر التاريخ');
check('23:30 بغداد = 20:30 UTC في نفس اليوم', new Date(wallClockToEpoch('2026-09-25T23:30')).toISOString() === '2026-09-25T20:30:00.000Z', new Date(wallClockToEpoch('2026-09-25T23:30')).toISOString());
check('00:30 بغداد = 21:30 UTC في اليوم السابق', new Date(wallClockToEpoch('2026-09-26T00:30')).toISOString() === '2026-09-25T21:30:00.000Z', new Date(wallClockToEpoch('2026-09-26T00:30')).toISOString());
check('الميلاد يتقدم يوماً عند العودة للعرض', toScheduleDisplay(new Date(wallClockToEpoch('2026-09-26T00:30')).toISOString()) === '2026-09-26T00:30');

group('5) منع جدولة الماضي بمقارنة صحيحة');
const now = Date.UTC(2026, 8, 22, 12, 0); // 2026-09-22T12:00Z = 15:00 بغداد
check('موعد محلي قبل الآن يُرفض', isScheduleInFuture('2026-09-22T14:59', now) === false);
check('موعد محلي على الحد تماماً يُرفض (ليس مستقبلاً)', isScheduleInFuture('2026-09-22T15:00', now) === false);
check('موعد محلي بعد الآن يُقبل', isScheduleInFuture('2026-09-22T15:01', now) === true);
check('موعد اليوم التالي يُقبل', isScheduleInFuture('2026-09-23T09:00', now) === true);
check('موعد غير صالح لا يُقبل', isScheduleInFuture('foo', now) === false);

group('6) التوحيد والافتراضي');
check('normalizeScheduleInput يوحّد المسافة إلى T', normalizeScheduleInput('2026-09-25 19:30') === '2026-09-25T19:30');
check('normalizeScheduleInput يرفض اللحظة التي تحمل منطقة', normalizeScheduleInput('2026-09-25T19:30:00Z') === null);
check('الحقل الافتراضي = 21:00 بغداد بعد 3 ساعات من 18:00 محلي', defaultScheduleInput(Date.UTC(2026, 8, 22, 15, 0)) === '2026-09-22T20:00', defaultScheduleInput(Date.UTC(2026, 8, 22, 15, 0)));
check('المنطقة المعتمدة هي Asia/Baghdad', APP_TIMEZONE === 'Asia/Baghdad');

group('7) فحص مصدري: لا toISOString في مسار الجدولة');
const approvalSrc = readFileSync(join(process.cwd(), 'src/components/approval/ApprovalWorkflowView.tsx'), 'utf8');
check('واجهة الجدولة لم تعد تستخدم toISOString', !approvalSrc.includes('toISOString'));
check('الموعد المختار يُمرَّر إلى updatePostStatus لا عبر مسار منفصل قد يُستبدل بالافتراضي', /updatePostStatus\(\s*schedulingPost\.id,\s*'scheduled',[\s\S]{0,220}?scheduledFor\s*\)/.test(approvalSrc));
const appContextSrc = readFileSync(join(process.cwd(), 'src/context/AppContext.tsx'), 'utf8');
check('عرض/اشتقاق الموعد لا يعتمد على toISOString للموعد المجدول', !/scheduledFor:\s*new Date\(\)\.toISOString/.test(appContextSrc));
check('updatePostStatus يقبل الموعد صراحةً ويحترم الموعد الممرَّر', /updatePostStatus: \(postId: string, newStatus: PostStatus, note\?: string, scheduledFor\?: string\)/.test(appContextSrc) && appContextSrc.includes('scheduleValue ?? changedPost.scheduledFor'));

// ------------------------------------------------------ تحقق حي من الخادم
group('8) مسار الخادم الفعلي: تخزين وإعادة قراءة الموعد المحلي');

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const OWNER_TOKEN = randomBytes(24).toString('hex');

function startApp(port: number, cwd: string): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    NODE_ENV: 'production',
    APP_URL: `http://127.0.0.1:${port}`,
    GHARABI_PREVIEW_TOKEN: OWNER_TOKEN,
    OWNER_EMAIL: 'owner@al-gharabi.test',
    STATE_DIR: cwd,
  };
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(base: string, timeoutMs = 40_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return true; } catch { /* لم يقلع */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** وقت محلي في بغداد بعد `offsetMs` — لنبني مواعيد مستقبلة/ماضية بمعزل عن ساعة المضيف. */
function baghdadWall(offsetMs: number): string {
  return toScheduleDisplay(new Date(Date.now() + offsetMs).toISOString())!;
}

async function runServerTests(): Promise<void> {
  if (!existsSync(tsxCli)) { failures.push('tsx CLI غير موجود — شغّل npm install أولاً'); return; }
  const cwd = mkdtempSync(join(tmpdir(), 'gharabi-sched-'));
  const port = 5410 + Math.floor(Math.random() * 200);
  const base = `http://127.0.0.1:${port}`;
  const app = startApp(port, cwd);
  try {
    check('الخادم يقلع', await waitForHealth(base), app.log().slice(0, 400));
    const login = await fetch(`${base}/api/auth/preview-login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: OWNER_TOKEN }),
    });
    const loginBody = await login.json() as { success: boolean; token?: string };
    check('جلسة المالك أُنشئت', login.ok && loginBody.success && Boolean(loginBody.token), JSON.stringify(loginBody).slice(0, 160));
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${loginBody.token}` };

    const created = await fetch(`${base}/api/workspace/content`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ content: 'عرض جديد على الأجهزة المنزلية من معرض الغرابي.', targetPlatforms: ['facebook'], status: 'approved' }),
    });
    const createdBody = await created.json() as { success: boolean; post?: { id: string } };
    check('إنشاء منشور معتمد', created.ok && createdBody.success && Boolean(createdBody.post?.id), JSON.stringify(createdBody).slice(0, 160));
    const postId = createdBody.post!.id;

    // موعد مستقبلي محلي (بعد ساعة) — يُرسل كما اختاره المستخدم.
    const futureWall = baghdadWall(3600_000);
    const patched = await fetch(`${base}/api/workspace/content/${encodeURIComponent(postId)}`, {
      method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'scheduled', scheduledFor: futureWall }),
    });
    const patchedBody = await patched.json() as { success: boolean; post?: { scheduledFor?: string; status?: string } };
    check('قبول موعد مستقبلي', patched.ok && patchedBody.success, JSON.stringify(patchedBody).slice(0, 160));
    check('الموعد المخزَّن يطابق اختيار المستخدم بلا زحزحة', patchedBody.post?.scheduledFor === futureWall, `${patchedBody.post?.scheduledFor} !== ${futureWall}`);

    // إعادة القراءة من الخادم: نفس المعنى المحلي.
    const read = await fetch(`${base}/api/workspace/content`, { headers: auth });
    const readBody = await read.json() as { posts: Array<{ id: string; scheduledFor?: string }> };
    const stored = readBody.posts.find((p) => p.id === postId);
    check('إعادة القراءة تعيد نفس الموعد المحلي', stored?.scheduledFor === futureWall, `${stored?.scheduledFor} !== ${futureWall}`);
    check('العرض من نفس القيمة = نفس الساعة', toScheduleDisplay(stored?.scheduledFor) === futureWall);

    // موعد ماضٍ محلي (قبل ساعة) — يجب رفضه. نعيد الحالة إلى approved لأن المسار
    // المخصص يشترط الموافقة أولاً (كالتدفق الحقيقي في الواجهة).
    await fetch(`${base}/api/workspace/content/${encodeURIComponent(postId)}`, {
      method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'approved' }),
    });
    const pastWall = baghdadWall(-3600_000);
    const rejected = await fetch(`${base}/api/workspace/content/${encodeURIComponent(postId)}/schedule`, {
      method: 'POST', headers: auth, body: JSON.stringify({ scheduledFor: pastWall }),
    });
    check('مسار الجدولة المخصص يرفض موعداً في الماضي', rejected.status === 400, `got ${rejected.status}`);
    const rejBody = await rejected.json() as { success: boolean; error?: string };
    check('سبب الرفض صريح عن الماضي', rejBody.success === false && /الماضي/.test(rejBody.error || ''), JSON.stringify(rejBody).slice(0, 160));

    // مسار الجدولة المخصص يقبل موعداً مستقبلياً ويوحّده.
    const futureWall2 = baghdadWall(2 * 3600_000);
    const okSchedule = await fetch(`${base}/api/workspace/content/${encodeURIComponent(postId)}/schedule`, {
      method: 'POST', headers: auth, body: JSON.stringify({ scheduledFor: futureWall2.replace('T', ' ') }),
    });
    const okBody = await okSchedule.json() as { success: boolean; post?: { scheduledFor?: string } };
    check('مسار الجدولة المخصص يقبل موعداً مستقبلياً', okSchedule.ok && okBody.success, JSON.stringify(okBody).slice(0, 160));
    check('التوحيد يحوّل المسافة إلى T ويحفظ الساعة المحلية', okBody.post?.scheduledFor === futureWall2.replace(' ', 'T'), String(okBody.post?.scheduledFor));

    // رفض قيمة تحمل منطقة UTC (ليست جداراً محلياً) لئلا يزحزح toISOString الساعة.
    await fetch(`${base}/api/workspace/content/${encodeURIComponent(postId)}`, {
      method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'approved' }),
    });
    const isoZ = await fetch(`${base}/api/workspace/content/${encodeURIComponent(postId)}/schedule`, {
      method: 'POST', headers: auth, body: JSON.stringify({ scheduledFor: '2027-01-01T19:30:00.000Z' }),
    });
    check('رفض لحظة ISO تحمل منطقة بدل الجدار المحلي', isoZ.status === 400, `got ${isoZ.status}`);
    // نعيد الحالة المجدولة للموعد المستقبلي لعرضه في التقويم.
    await fetch(`${base}/api/workspace/content/${encodeURIComponent(postId)}/schedule`, {
      method: 'POST', headers: auth, body: JSON.stringify({ scheduledFor: futureWall2 }),
    });

    // التقويم يعرض الموعد بنفس المعنى ويفصح عن المنطقة.
    const cal = await fetch(`${base}/api/calendar/schedule`, { headers: auth });
    const calBody = await cal.json() as { success: boolean; timeZone?: string; entries: Array<{ id: string; scheduledFor?: string }> };
    check('التقويم يفصح عن Asia/Baghdad', calBody.timeZone === 'Asia/Baghdad', String(calBody.timeZone));
    const calEntry = calBody.entries.find((e) => e.id === postId);
    check('التقويم يعيد الموعد المحلي الصحيح', calEntry?.scheduledFor === futureWall2, String(calEntry?.scheduledFor));
  } finally {
    app.proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 800));
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* تجاهل */ }
  }
}

await runServerTests();

console.log('');
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} timezone scheduling checks`);
}
