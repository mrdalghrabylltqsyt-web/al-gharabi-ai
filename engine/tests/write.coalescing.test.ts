/**
 * توفير الخطة المجانية — دمج كتابات «مسك الدفاتر» لحالات المراقبين والعقل والمؤشرات.
 *
 * الجذر: كل دورة مراقبة (5 دقائق × 3 مراقبين) وكل دورة عقل (15 دقيقة) وكل طلب
 * /api/health كانت تعيد كتابة كائن حالة كامل إلى Neon لأن طوابع/عدّادات تتغير دائماً،
 * فتبقى حوسبة Neon مستيقظة وتتضخم الكتابات بلا أي حدث حقيقي.
 *
 * يثبت (منطق صافٍ):
 *  1) أول كتابة بعد الإقلاع تُكتب؛ تغيّر طابع/عدّاد فقط ⇒ لا كتابة حتى 30 دقيقة.
 *  2) أي تغيير حقيقي (تعليق جديد في processed، خطأ، تحكم، تحرير قفل) ⇒ كتابة فوراً.
 *  3) بعد 30 دقيقة ⇒ كتابة (لا يبقى وقت آخر دورة قديماً بلا حد).
 *  4) force (الإغلاق) يكتب دائماً.
 *  5) مسارات العقل والمؤشرات: العدّادات متطايرة، وتغيّر الإعداد/الخطأ/الشهر مهم.
 *  6) القيمة الأصلية لا تُعدَّل (نسخة عميقة).
 */
import {
  decideCoalescedWrite, significantFingerprint, BOOKKEEPING_MAX_DELAY_MS,
  BRAIN_RUNTIME_VOLATILE_PATHS, USAGE_INDICATOR_VOLATILE_PATHS,
} from '../ops/writeCoalescing';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(t: string): void { console.log(`\n▸ ${t}`); }

const T = 1_761_400_000_000;
const MIN = 60_000;
const meta = (over: any = {}) => ({
  controls: { enabled: true, paused: false, autoReply: false },
  processed: [{ commentId: 'c1', stage: 'ANALYZED' }],
  lastPollAt: new Date(T).toISOString(), lastError: null, consecutiveErrors: 0, pollCount: 10, lastScanned: 3,
  platformStats: { facebook: { postsScanned: 13, commentsVisible: 4, commentsTotalReported: 4, callsPerCycle: 3, lastIngestAt: 'x', lastOkAt: 'a', consecutiveErrors: 0, lastError: null } },
  lease: { owner: 'meta-1', acquiredAtMs: T, expiresAtMs: T + 5 * MIN },
  deferral: { deferred: false, deferredReason: null, lastDeferredAt: null },
  ...over,
});

group('1) مسك الدفاتر لا يكتب');
const first = decideCoalescedWrite(undefined, meta(), T);
check('★ أول كتابة بعد الإقلاع تُكتب', first.write && first.reason === 'first');
const tick = meta({
  lastPollAt: new Date(T + 5 * MIN).toISOString(), pollCount: 11, lastScanned: 4,
  lease: { owner: 'meta-1', acquiredAtMs: T + 5 * MIN, expiresAtMs: T + 10 * MIN },
  platformStats: { facebook: { postsScanned: 14, commentsVisible: 4, commentsTotalReported: 5, callsPerCycle: 3, lastIngestAt: 'x', lastOkAt: 'b', consecutiveErrors: 0, lastError: null } },
});
const d2 = decideCoalescedWrite(first.memo, tick, T + 5 * MIN);
check('★ دورة بلا حدث ⇒ لا كتابة', d2.write === false && d2.reason === 'bookkeeping_only', d2.reason);
check('الذاكرة لا تتقدم عند التخطي (المهلة من آخر كتابة فعلية)', d2.memo.atMs === T);

group('2) التغيير الحقيقي يُكتب فوراً');
const cases: Array<[string, any]> = [
  ['تعليق جديد', meta({ processed: [{ commentId: 'c2', stage: 'NEW' }, { commentId: 'c1', stage: 'ANALYZED' }] })],
  ['تغيّر مرحلة تعليق', meta({ processed: [{ commentId: 'c1', stage: 'REPLIED' }] })],
  ['خطأ قراءة', meta({ lastError: 'facebook.PROVIDER_ERROR.12', consecutiveErrors: 1 })],
  ['تحكم المالك', meta({ controls: { enabled: true, paused: true, autoReply: false } })],
  ['تحرير القفل (إغلاق)', meta({ lease: null })],
  ['وصول تعليق (lastIngestAt)', meta({ platformStats: { facebook: { postsScanned: 13, commentsVisible: 5, commentsTotalReported: 5, callsPerCycle: 3, lastIngestAt: 'y', lastOkAt: 'a', consecutiveErrors: 0, lastError: null } } })],
  ['تأجيل بسبب الضغط', meta({ deferral: { deferred: true, deferredReason: 'p', lastDeferredAt: 'z' } })],
];
for (const [name, v] of cases) {
  const d = decideCoalescedWrite(first.memo, v, T + 1 * MIN);
  check(`★ ${name} ⇒ كتابة`, d.write && d.reason === 'changed', d.reason);
}

group('3) المهلة القصوى + force');
check('★ بعد 30 دقيقة ⇒ كتابة', decideCoalescedWrite(first.memo, tick, T + BOOKKEEPING_MAX_DELAY_MS).reason === 'max_delay');
check('قبلها بدقيقة ⇒ لا كتابة', decideCoalescedWrite(first.memo, tick, T + BOOKKEEPING_MAX_DELAY_MS - MIN).write === false);
check('★ force يكتب دائماً', decideCoalescedWrite(first.memo, tick, T + MIN, { force: true }).reason === 'forced');
check('المهلة 30 دقيقة', BOOKKEEPING_MAX_DELAY_MS === 30 * MIN);

group('4) العقل والمؤشرات');
const ctrl = (over: any = {}) => ({ driveRefreshToken: 'enc', ownerAlerts: { enabled: true }, brainRuntime: { status: 'IDLE', lock: null, cycleCount: 5, lastCycleStartedAt: 'a', lastError: null, failedCount: 0, deferral: { deferred: false, lastDeferredAt: null } }, ...over });
const b0 = decideCoalescedWrite(undefined, ctrl(), T, { volatilePaths: BRAIN_RUNTIME_VOLATILE_PATHS });
const bTick = decideCoalescedWrite(b0.memo, ctrl({ brainRuntime: { status: 'RUNNING', lock: { owner: 'x' }, cycleCount: 6, lastCycleStartedAt: 'b', lastError: null, failedCount: 0, deferral: { deferred: false, lastDeferredAt: 'q' } } }), T + 15 * MIN, { volatilePaths: BRAIN_RUNTIME_VOLATILE_PATHS });
check('★ دورة عقل عادية ⇒ لا إعادة كتابة لحالة التحكم كاملة', bTick.write === false, bTick.reason);
check('★ فشل دورة العقل ⇒ كتابة', decideCoalescedWrite(b0.memo, ctrl({ brainRuntime: { status: 'IDLE', lock: null, cycleCount: 6, lastCycleStartedAt: 'b', lastError: 'boom', failedCount: 1, deferral: { deferred: false, lastDeferredAt: null } } }), T + MIN, { volatilePaths: BRAIN_RUNTIME_VOLATILE_PATHS }).write);
check('★ تغيّر إعداد آخر في حالة التحكم ⇒ كتابة', decideCoalescedWrite(b0.memo, ctrl({ ownerAlerts: { enabled: false } }), T + MIN, { volatilePaths: BRAIN_RUNTIME_VOLATILE_PATHS }).write);
check('★ تغيّر رمز Drive ⇒ كتابة', decideCoalescedWrite(b0.memo, ctrl({ driveRefreshToken: 'enc2' }), T + MIN, { volatilePaths: BRAIN_RUNTIME_VOLATILE_PATHS }).write);
const u = (over: any = {}) => ({ month: '2026-10', egressBytesMonth: 100, egressBytesSinceBoot: 5, updatedAt: 'a', accountingVersion: 2, renderUptime: { month: '2026-10', hoursThisMonth: 500.1, lastAccruedAt: 'a', firstSeenAt: 'f', updatedAt: 'a' }, ...over });
const u0 = decideCoalescedWrite(undefined, u(), T, { volatilePaths: USAGE_INDICATOR_VOLATILE_PATHS });
check('★ طلب /api/health ⇒ لا كتابة لمؤشر عرض', decideCoalescedWrite(u0.memo, u({ egressBytesMonth: 200, updatedAt: 'b', renderUptime: { month: '2026-10', hoursThisMonth: 500.2, lastAccruedAt: 'b', firstSeenAt: 'f', updatedAt: 'b' } }), T + MIN, { volatilePaths: USAGE_INDICATOR_VOLATILE_PATHS }).write === false);
check('تغيّر الشهر ⇒ كتابة', decideCoalescedWrite(u0.memo, u({ month: '2026-11' }), T + MIN, { volatilePaths: USAGE_INDICATOR_VOLATILE_PATHS }).write);

group('5) سلامة');
const original = meta();
significantFingerprint(original);
check('★ القيمة الأصلية لا تُعدَّل', original.lastPollAt === new Date(T).toISOString() && original.pollCount === 10 && original.lease.expiresAtMs === T + 5 * MIN);
check('بصمة حتمية', significantFingerprint(meta()) === significantFingerprint(meta()));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} write-coalescing checks`);
