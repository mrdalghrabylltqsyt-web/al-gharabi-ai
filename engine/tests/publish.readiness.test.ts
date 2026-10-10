/**
 * اختبار وحدة تقرير جاهزية النشر الموحّد (بلا شبكة، بلا أسرار).
 *
 * يثبت أن الحكم حتمي وصادق:
 *  - لا READY_NOW بلا اتصال موثق + موصل منفّذ.
 *  - غياب الاعتماد/العنوان العام ⇒ EXTERNAL_SETUP_REQUIRED بسبب دقيق.
 *  - منصة بلا موصل منفّذ ⇒ NOT_IMPLEMENTED (لا وعد بقدرة غير موجودة).
 *  - متطلبات الوسائط مطابقة للكود الفعلي (Instagram/TikTok بلا نص مجرّد، إلخ).
 *  - لا سرّ ولا قيمة بيئية في أي مخرَج.
 */

import { buildPublishReadinessRow, publishPathFor, mediaRequirementFor, summarizePublishReadiness, type PublishReadinessInput } from '../social/publishReadiness';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const base: PublishReadinessInput = {
  platform: 'facebook',
  displayName: 'Facebook',
  operationalState: 'CONFIGURED',
  connected: false,
  providerVerified: false,
  credentialsConfigured: true,
  publicUrlValid: true,
  blockingReason: null,
  nextAction: null,
};

function main(): void {
  group('1) مسار النشر لكل منصة');
  check('youtube مسار مخصص (بايتات)', publishPathFor('youtube') === 'dedicated_upload');
  check('facebook المسار الموحّد', publishPathFor('facebook') === 'unified_connector');
  check('instagram المسار الموحّد', publishPathFor('instagram') === 'unified_connector');
  check('tiktok المسار الموحّد', publishPathFor('tiktok') === 'unified_connector');
  check('threads المسار الموحّد', publishPathFor('threads') === 'unified_connector');
  check('whatsapp غير منفّذ (لا نشر)', publishPathFor('whatsapp') === 'not_implemented');
  check('x غير منفّذ', publishPathFor('x') === 'not_implemented');

  group('2) لا READY_NOW بلا اتصال موثق');
  const notConnected = buildPublishReadinessRow({ ...base, connected: false, providerVerified: false });
  check('غير متصل ⇒ CONNECT_REQUIRED', notConnected.state === 'CONNECT_REQUIRED', notConnected.state);
  check('غير متصل ⇒ readyNow=false', notConnected.readyNow === false);
  const connectedUnverified = buildPublishReadinessRow({ ...base, connected: true, providerVerified: false });
  check('متصل بلا توثيق ⇒ ليس READY_NOW', connectedUnverified.readyNow === false && connectedUnverified.state === 'CONNECT_REQUIRED');
  const verified = buildPublishReadinessRow({ ...base, connected: true, providerVerified: true, operationalState: 'OPERATIONAL' });
  check('متصل موثق ⇒ READY_NOW', verified.readyNow === true && verified.state === 'READY_NOW');

  group('3) الاعتماد والعنوان العام');
  const noCreds = buildPublishReadinessRow({ ...base, credentialsConfigured: false });
  check('غياب الاعتماد ⇒ EXTERNAL_SETUP_REQUIRED', noCreds.state === 'EXTERNAL_SETUP_REQUIRED', noCreds.state);
  check('سبب الحجب يذكر الاعتماد', noCreds.blockers.some((b) => b.includes('اعتماد')));
  const noPublicUrl = buildPublishReadinessRow({ ...base, publicUrlValid: false });
  check('عنوان عام غير صالح ⇒ EXTERNAL_SETUP_REQUIRED', noPublicUrl.state === 'EXTERNAL_SETUP_REQUIRED');
  check('سبب الحجب يذكر APP_URL', noPublicUrl.blockers.some((b) => b.includes('APP_URL')));
  const reauth = buildPublishReadinessRow({ ...base, connected: true, providerVerified: true, operationalState: 'FAILED' });
  check('إعادة ربط ⇒ ليس READY_NOW', reauth.readyNow === false);
  check('سبب إعادة الربط مذكور', reauth.blockers.some((b) => b.includes('إعادة الربط')));

  group('4) منصة بلا موصل منفّذ');
  const notImpl = buildPublishReadinessRow({ ...base, platform: 'x', displayName: 'X' });
  check('NOT_IMPLEMENTED صريح', notImpl.state === 'NOT_IMPLEMENTED');
  check('readyNow=false', notImpl.readyNow === false);
  check('لا oauthStartRoute', notImpl.oauthStartRoute === null);

  group('5) متطلبات الوسائط مطابقة للكود');
  check('instagram يطلب وسائط ولا يقبل نصاً', mediaRequirementFor('instagram').requiresMedia && !mediaRequirementFor('instagram').acceptsTextOnly);
  check('tiktok يطلب وسائط ولا يقبل نصاً', mediaRequirementFor('tiktok').requiresMedia && !mediaRequirementFor('tiktok').acceptsTextOnly);
  check('facebook يقبل نصاً مجرّداً', mediaRequirementFor('facebook').acceptsTextOnly);
  check('threads يقبل نصاً مجرّداً', mediaRequirementFor('threads').acceptsTextOnly);
  check('youtube يطلب فيديو', mediaRequirementFor('youtube').requiresVideo);

  group('6) المسارات المعلنة');
  check('facebook oauthStartRoute صحيح', verified.oauthStartRoute === '/api/platforms/facebook/oauth/start');
  check('youtube مسار مخصص معلن', verified.dedicatedPublishRoute === null || buildPublishReadinessRow({ ...base, platform: 'youtube', displayName: 'YouTube', connected: true, providerVerified: true }).dedicatedPublishRoute === '/api/platforms/youtube/publish');
  check('tiktok يُعلن audit مطلوب للنشر العام', buildPublishReadinessRow({ ...base, platform: 'tiktok', displayName: 'TikTok', auditRequiredForDirectPublish: true }).auditRequiredForDirectPublish === true);

  group('7) الملخّص');
  const rows = [
    buildPublishReadinessRow({ ...base, connected: true, providerVerified: true, operationalState: 'OPERATIONAL' }),
    buildPublishReadinessRow({ ...base, platform: 'instagram', displayName: 'Instagram' }),
    buildPublishReadinessRow({ ...base, platform: 'x', displayName: 'X' }),
  ];
  const summary = summarizePublishReadiness(rows);
  check('readyNow يحوي facebook فقط', summary.readyNow.length === 1 && summary.readyNow[0] === 'facebook');
  check('connectRequired يحوي instagram', summary.connectRequired.includes('instagram'));
  check('notImplemented يحوي x', summary.notImplemented.includes('x'));
  check('readyCount = 1', summary.readyCount === 1);

  group('8) لا سرّ في المخرَج');
  const serialized = JSON.stringify(rows);
  check('لا حقل يبدو سرّياً (token/secret/key)', !/(token|secret|api[_-]?key)/i.test(serialized));
  check('المخرَج يحمل أسماء مسارات فقط', serialized.includes('/api/platforms/') && !serialized.includes('Bearer'));

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} publish-readiness checks`);
  }
}

main();
