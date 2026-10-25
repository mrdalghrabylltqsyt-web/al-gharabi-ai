/**
 * خطأ قراءة التعليقات **لكل منصة** — انحدار لعطل حقيقي (18→24 أكتوبر 2026).
 *
 * الجذر: خطأ مراقب Meta كان عاماً؛ الدورة تقرأ Facebook ثم Instagram، فنجاح
 * Instagram يمسح فشل Facebook في نفس الدورة. قراءة تعليقات منشورات Facebook فشلت
 * ~6 أيام (خطأ Graph #12 كل 5 دقائق) والحالة «healthy» بلا أي تحذير للمالك.
 *
 * يثبت (منطق صافٍ):
 *  1) فشل Facebook + نجاح Instagram ⇒ الخطأ العام يبقى ظاهراً بكود Facebook.
 *  2) سلسلة الفشل لكل منصة (بدايتها/عددها)، والتعافي يصفّرها؛ السجل: أول فشل،
 *     كل 12 دورة، والتعافي فقط (لا إغراق كل 5 دقائق).
 *  3) بعد 3 دورات فاشلة ⇒ تحذير «قراءة التعليقات تفشل» حتى لو لا منشورات مفحوصة.
 *  4) الكتلة العامة لا تحمل نص خطأ المزوّد الخام (الكود فقط)، والحالة degraded.
 *  5) نوع تنبيه المالك ingest_failing مقبول ويصل Telegram برابط ربط المنصات.
 *  6) جاهزية البيع: «تعليقات X لا تصل» عائق، وإعادة ربط عند كود 190.
 * يفشل على الكود القديم.
 */
import {
  applyMetaReadOutcome, aggregateMetaReadErrors, metaReadErrorCode, metaIngestWarning,
  defaultMetaPlatformIngestStats, defaultMetaPollingState, metaPollingPublicBlock, normalizeMetaPollingState,
  META_READ_FAIL_WARN_CYCLES,
} from '../social/metaWatcher';
import { normalizeOwnerAlertState, OWNER_ALERT_KIND_LABELS_AR, buildOwnerAlertDigest } from '../notifications/ownerAlerts';
import { buildOwnerTelegramMessage } from '../notifications/ownerTelegram';
import { buildSalesReadiness } from '../ops/salesReadiness';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(t: string): void { console.log(`\n▸ ${t}`); }

const T0 = Date.parse('2026-10-18T09:24:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const FB_ERR = { ok: false as const, error: '(#12) deprecate_post_aggregated_fields_for_attachement is deprecated', code: metaReadErrorCode({ code: 'PROVIDER_ERROR', providerCode: 12 }) };
const IG_OK = { ok: true as const, postsScanned: 10, commentsVisible: 4, commentsTotalReported: 4, callsPerCycle: 2 };

group('1) لا يُمسح فشل منصة بنجاح أخرى (سيناريو الإنتاج)');
{
  let fb = defaultMetaPlatformIngestStats();
  let ig = defaultMetaPlatformIngestStats();
  const logs: string[] = [];
  for (let i = 0; i < 24; i++) {
    const now = iso(T0 + i * 5 * 60_000);
    const f = applyMetaReadOutcome(fb, FB_ERR, now); fb = f.stats; if (f.log) logs.push(f.log);
    const g = applyMetaReadOutcome(ig, IG_OK, now); ig = g.stats;
  }
  const agg = aggregateMetaReadErrors({ facebook: fb, instagram: ig });
  check('★ الخطأ العام يحمل facebook رغم نجاح instagram بعده', agg.lastError === 'facebook.PROVIDER_ERROR.12' && agg.consecutiveErrors === 24, JSON.stringify(agg));
  check('سلسلة الفشل وبدايتها محفوظتان', fb.consecutiveErrors === 24 && fb.failingSince === iso(T0), JSON.stringify(fb));
  check('★ السجل: أول فشل ثم كل 12 دورة فقط', JSON.stringify(logs) === JSON.stringify(['failed', 'still_failing', 'still_failing']), JSON.stringify(logs));
  check('instagram سليم', ig.consecutiveErrors === 0 && ig.lastOkAt !== null && ig.postsScanned === 10);
  const r = applyMetaReadOutcome(fb, { ok: true, postsScanned: 25, commentsVisible: 7, commentsTotalReported: 9, callsPerCycle: 3 }, iso(T0 + 25 * 5 * 60_000));
  check('★ التعافي يصفّر السلسلة ويسجّل recovered مرة', r.log === 'recovered' && r.recoveredAfter === 24 && r.stats.consecutiveErrors === 0 && r.stats.failingSince === null && r.stats.lastError === null, JSON.stringify(r));
  check('بعد التعافي لا خطأ عام', aggregateMetaReadErrors({ facebook: r.stats, instagram: ig }).lastError === null);
  check('lastIngestAt لا يُمسح بالفشل', applyMetaReadOutcome({ ...defaultMetaPlatformIngestStats(), lastIngestAt: iso(T0) }, FB_ERR, iso(T0 + 1)).stats.lastIngestAt === iso(T0));
}

group('2) التحذير');
{
  let fb = { ...defaultMetaPlatformIngestStats(), postsScanned: 0 };
  for (let i = 0; i < META_READ_FAIL_WARN_CYCLES - 1; i++) fb = applyMetaReadOutcome(fb, FB_ERR, iso(T0)).stats;
  check('دورتان فاشلتان ⇒ لا تحذير بعد (تذبذب عابر)', metaIngestWarning(fb, T0).stale === false);
  fb = applyMetaReadOutcome(fb, FB_ERR, iso(T0)).stats;
  const w = metaIngestWarning(fb, T0 + 6 * 3600_000);
  check(`★ ${META_READ_FAIL_WARN_CYCLES} دورات ⇒ تحذير بالكود والمدة حتى بلا منشورات`, w.stale && /تفشل منذ 6 ساعة/.test(w.reason) && /PROVIDER_ERROR\.12/.test(w.reason), JSON.stringify(w));
}

group('3) الكتلة العامة');
{
  let fb = defaultMetaPlatformIngestStats();
  for (let i = 0; i < 4; i++) fb = applyMetaReadOutcome(fb, FB_ERR, iso(Date.now() - 3600_000)).stats;
  const st = normalizeMetaPollingState({ ...defaultMetaPollingState(), lastPollAt: new Date().toISOString(), ...aggregateMetaReadErrors({ facebook: fb }), platformStats: { facebook: fb } });
  const pub = metaPollingPublicBlock(st);
  check('★ الحالة degraded (لا healthy)', pub.status === 'degraded', pub.status);
  check('★ لا نص خطأ المزوّد الخام في الكتلة العامة', !JSON.stringify(pub).includes('deprecate_post'), JSON.stringify(pub.platformStats));
  check('الكود التقني ظاهر', (pub.platformStats.facebook as any).lastErrorCode === 'PROVIDER_ERROR.12');
  check('التحذير العام يشمل facebook', pub.staleIngestWarning === true && (pub.warnings as any[]).some((w) => w.platform === 'facebook'));
  check('التوافق: حالة قديمة بلا الحقول الجديدة', normalizeMetaPollingState({ platformStats: { facebook: { postsScanned: 3 } } }).platformStats.facebook.consecutiveErrors === 0);
}

group('4) تنبيه المالك ingest_failing');
{
  check('تسمية عربية', OWNER_ALERT_KIND_LABELS_AR.ingest_failing === 'قراءة التعليقات متوقفة');
  const st = normalizeOwnerAlertState({ enabled: true, pending: [{ key: 'ingest_failing:facebook:x', kind: 'ingest_failing', platform: 'facebook', title: 't', snippet: 's', at: iso(T0) }] });
  check('★ النوع يصمد بعد التطبيع (لا يتحول إلى تصعيد)', st.pending[0]?.kind === 'ingest_failing', JSON.stringify(st.pending[0]));
  check('سطر في ملخص البريد', /قراءة التعليقات متوقفة على 1 منصة/.test(buildOwnerAlertDigest(st, null).text));
  const msg = buildOwnerTelegramMessage(st.pending[0], 'https://x.app');
  check('Telegram برابط ربط المنصات', msg.includes('📭') && msg.includes('tab=platform_connections'), msg);
}

group('5) جاهزية البيع');
{
  const base: any = {
    nowIso: iso(T0), youtubeOnlyMode: false,
    platforms: [{ id: 'facebook', name: 'Facebook', connected: true, credentialsConfigured: true, realConnector: true }],
    commercialBrainEnabled: true, sendMode: 'approval', ownerAlerts: { enabled: true, emailConfigured: true },
    pendingApprovals: { count: 0, oldestAt: null }, readyJobs: 0, autoExecuteEnabled: false,
    staleMarketing: { unpublished: 0, published: 0 }, geminiConfigured: true,
  };
  const bad = buildSalesReadiness({ ...base, commentIngest: [{ platform: 'facebook', name: 'Facebook', failing: true, reason: 'قراءة التعليقات تفشل منذ 6 ساعة', code: 'PROVIDER_ERROR.12' }] });
  const it = bad.items.find((i) => i.id === 'comments-facebook');
  check('★ تعليقات لا تصل ⇒ عائق', it?.severity === 'blocker' && it.title === 'تعليقات Facebook لا تصل', JSON.stringify(it));
  const good = buildSalesReadiness({ ...base, commentIngest: [{ platform: 'facebook', name: 'Facebook', failing: false, reason: '', code: null }] });
  check('القراءة سليمة ⇒ لا بند، ودرجة أعلى', !good.items.some((i) => i.id === 'comments-facebook') && good.score > bad.score, `${good.score} > ${bad.score}`);
  const reauth = buildSalesReadiness({ ...base, commentIngest: [{ platform: 'facebook', name: 'Facebook', failing: true, reason: 'x', code: 'PROVIDER_ERROR.190' }] });
  check('كود 190 ⇒ إعادة ربط على المالك', reauth.items.find((i) => i.id === 'comments-facebook')?.actor === 'owner');
}

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} meta-ingest-perplatform checks`);
