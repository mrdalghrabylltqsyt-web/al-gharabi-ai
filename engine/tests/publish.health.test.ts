/**
 * صحة النشر على المنصات المتصلة — «متصل» لا يعني «ينشر».
 *
 * يثبت (منطق صافٍ، بلا شبكة):
 *  1) التلخيص لكل منصة: آخر نجاح/فشل، الإخفاقات المتتالية منذ آخر نجاح، عدّ 7 أيام،
 *     وتجاهل السجلات المحاكاة و«قيد النشر» (TikTok) كحالة محايدة.
 *  2) ترجمة سبب الفشل إلى إجراء: رمز منتهٍ (190) ⇒ إعادة ربط، صلاحية (#200/#10) ⇒
 *     منح صلاحية، وسائط ⇒ إرفاق صورة/فيديو، حصة ⇒ النظام يعيد تلقائياً.
 *  3) جاهزية البيع: منصة متصلة آخر نشر عليها فاشل ⇒ تحذير بالسبب الحقيقي والإجراء،
 *     ونجاح لاحق يمحو التحذير؛ لا نشر بعد ⇒ معلومة؛ صمت 7 أيام ⇒ معلومة؛ والدرجة تنخفض.
 *  4) سطر السجل المنظّم [publish] بلا نص منشور ولا رمز، ونتيجة مصنّفة.
 * يفشل على الكود القديم (لا وحدة ولا بند نشر في الجاهزية).
 */
import { summarizePublishHealth, publishFailureHint, formatPublishLogLine, publishOutcomeOf } from '../ops/publishHealth';
import { buildSalesReadiness } from '../ops/salesReadiness';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(t: string): void { console.log(`\n▸ ${t}`); }

const H = 3_600_000;
const NOW = Date.parse('2026-10-25T07:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

group('1) تلخيص سجل النشر');
const records = [
  { platform: 'facebook', state: 'failed', executedAt: iso(NOW - 1 * H), providerPostId: null, error: '(#200) Requires pages_manage_posts permission', code: 'PERMISSION_DENIED', providerCode: 200 },
  { platform: 'facebook', state: 'failed', executedAt: iso(NOW - 2 * H), providerPostId: null, error: 'x', code: 'PROVIDER_ERROR', providerCode: 100 },
  { platform: 'facebook', state: 'published', executedAt: iso(NOW - 30 * H), providerPostId: '1025_99' },
  { platform: 'facebook', state: 'failed', executedAt: iso(NOW - 40 * H), providerPostId: null, error: 'older' },
  { platform: 'facebook', state: 'published', executedAt: iso(NOW - 9 * 24 * H), providerPostId: '1025_1' },
  { platform: 'youtube', state: 'published', executedAt: iso(NOW - 3 * H), providerPostId: 'vid1' },
  { platform: 'youtube', state: 'published', executedAt: iso(NOW - 1 * H), providerPostId: 'sim', simulated: true },
  { platform: 'tiktok', state: 'publishing', executedAt: iso(NOW - 1 * H), providerPostId: null },
];
const [fb, yt, ig, tt] = summarizePublishHealth(records, ['facebook', 'youtube', 'instagram', 'tiktok'], NOW);
check('★ facebook: إخفاقان متتاليان منذ آخر نجاح', fb.consecutiveFailures === 2, JSON.stringify(fb));
check('facebook: آخر فشل = الأحدث بسببه الحقيقي', fb.lastFailureAt === iso(NOW - 1 * H) && fb.lastFailure?.providerCode === 200 && /pages_manage_posts/.test(fb.lastFailure.error));
check('facebook: آخر نجاح قبل 30 س', fb.lastSuccessAt === iso(NOW - 30 * H));
check('facebook: عدّ 7 أيام (نجاح 1، فشل 3)', fb.successes7d === 1 && fb.failures7d === 3, `${fb.successes7d}/${fb.failures7d}`);
check('youtube: المحاكاة مُتجاهلة', yt.lastSuccessAt === iso(NOW - 3 * H) && yt.successes7d === 1);
check('instagram بلا سجل ⇒ فارغ', ig.lastSuccessAt === null && ig.lastFailureAt === null && ig.consecutiveFailures === 0);
check('tiktok «قيد النشر» محايد', tt.lastSuccessAt === null && tt.lastFailureAt === null);
check('نجاح بلا معرّف مزود لا يُعدّ نجاحاً', summarizePublishHealth([{ platform: 'facebook', state: 'published', executedAt: iso(NOW), providerPostId: null }], ['facebook'], NOW)[0].lastSuccessAt === null);

group('2) ترجمة سبب الفشل إلى إجراء');
check('★ 190 ⇒ إعادة ربط (المالك)', /أعد الربط/.test(publishFailureHint('Facebook', { code: null, providerCode: 190, error: 'Error validating access token' }).action));
check('★ #200 ⇒ منح صلاحية النشر', /صلاحية النشر/.test(publishFailureHint('Facebook', { code: 'PERMISSION_DENIED', providerCode: 200, error: 'x' }).action));
check('وسائط مطلوبة ⇒ إرفاق صورة/فيديو', /صورة أو فيديو/.test(publishFailureHint('Instagram', { code: 'MEDIA_REQUIRED', providerCode: null, error: 'x' }).action));
const q = publishFailureHint('YouTube', { code: 'QUOTA_EXCEEDED', providerCode: null, error: 'quotaExceeded' });
check('حصة ⇒ النظام يعيد تلقائياً', q.actor === 'system');
check('غير معروف ⇒ سجل النشر', /سجل النشر/.test(publishFailureHint('X', { code: 'PROVIDER_ERROR', providerCode: 1, error: 'boom' }).action));

group('3) جاهزية البيع');
const base: any = {
  nowIso: iso(NOW), youtubeOnlyMode: false,
  platforms: [
    { id: 'facebook', name: 'Facebook', connected: true, credentialsConfigured: true, realConnector: true },
    { id: 'youtube', name: 'YouTube', connected: true, credentialsConfigured: true, realConnector: true },
  ],
  commercialBrainEnabled: true, sendMode: 'approval', ownerAlerts: { enabled: true, emailConfigured: true },
  pendingApprovals: { count: 0, oldestAt: null }, readyJobs: 0, autoExecuteEnabled: false,
  staleMarketing: { unpublished: 0, published: 0 }, geminiConfigured: true,
};
const named = (rows: any[]) => rows.map((h) => ({ ...h, name: h.platform === 'facebook' ? 'Facebook' : h.platform === 'youtube' ? 'YouTube' : h.platform }));
const failing = buildSalesReadiness({ ...base, publishing: named([fb, yt]) });
const fbItem = failing.items.find((i) => i.id === 'publish-facebook');
check('★ فشل النشر على منصة متصلة ⇒ تحذير', fbItem?.severity === 'warning' && /آخر 2 محاولات نشر على Facebook فشلت/.test(fbItem.title), JSON.stringify(fbItem));
check('★ التحذير يحمل السبب الحقيقي والإجراء', /pages_manage_posts/.test(fbItem?.detail || '') && /صلاحية النشر/.test(fbItem?.action || ''), JSON.stringify(fbItem));
const okItem = failing.items.find((i) => i.id === 'publish-health');
check('YouTube يظهر في «النشر يعمل فعلياً»', okItem?.severity === 'ok' && /YouTube/.test(okItem.detail) && !/Facebook/.test(okItem.detail), JSON.stringify(okItem));

const fixedRecords = [{ platform: 'facebook', state: 'published', executedAt: iso(NOW - 0.5 * H), providerPostId: '1025_100' }, ...records];
const fixed = buildSalesReadiness({ ...base, publishing: named(summarizePublishHealth(fixedRecords, ['facebook', 'youtube'], NOW)) });
check('★ نجاح لاحق يمحو التحذير', !fixed.items.some((i) => i.id === 'publish-facebook'), JSON.stringify(fixed.items.filter((i) => i.id.startsWith('publish'))));
check('فشل النشر يخفض الدرجة', failing.score < fixed.score, `${failing.score} < ${fixed.score}`);

const never = buildSalesReadiness({ ...base, publishing: named(summarizePublishHealth([], ['facebook'], NOW)) });
check('لا نشر بعد ⇒ معلومة', never.items.find((i) => i.id === 'publish-facebook')?.severity === 'info');
const quiet = buildSalesReadiness({ ...base, publishing: named(summarizePublishHealth([{ platform: 'facebook', state: 'published', executedAt: iso(NOW - 10 * 24 * H), providerPostId: 'p' }], ['facebook'], NOW)) });
const qi = quiet.items.find((i) => i.id === 'publish-facebook');
check('صمت 10 أيام ⇒ معلومة بعدد الأيام', qi?.severity === 'info' && /منذ 10 يوماً/.test(qi.title), JSON.stringify(qi));
const without = buildSalesReadiness(base);
check('التوافق: بلا publishing لا بنود نشر', !without.items.some((i) => i.id.startsWith('publish')));

group('4) سطر السجل [publish]');
const line = formatPublishLogLine('facebook', { status: 200, body: { success: true, providerPostId: '102540549308721_555', record: { content: 'نص سري للزبون' } } }, 812.4);
check('★ سطر منظّم بالنتيجة والمعرّف', line === '[publish] platform=facebook outcome=published status=200 providerPostId=102540549308721_555 code=- providerCode=- ms=812', line);
check('لا نص منشور في السجل', !line.includes('نص'));
const fline = formatPublishLogLine('instagram', { status: 502, body: { success: false, code: 'PROVIDER_ERROR', providerCode: 9007, error: 'Media download failed access_token=SECRET' } }, 10);
check('★ الفشل يسجّل الكود فقط بلا رسالة/رمز', /outcome=failed/.test(fline) && /providerCode=9007/.test(fline) && !fline.includes('SECRET'), fline);
check('رفض قبل المزود ⇒ rejected', publishOutcomeOf({ status: 422, body: { code: 'MEDIA_REQUIRED' } }) === 'rejected');
check('تكرار محجوز ⇒ blocked', publishOutcomeOf({ status: 409, body: { code: 'IDEMPOTENT_OPERATION_IN_PROGRESS' } }) === 'blocked');
check('انتظار حصة ⇒ pending', publishOutcomeOf({ status: 200, body: { pendingRetry: true } }) === 'pending');
check('TikTok تهيئة بلا تسليم ⇒ pending', publishOutcomeOf({ status: 200, body: { delivered: false, providerPublishId: 'v_1' } }) === 'pending');

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} publish-health checks`);
