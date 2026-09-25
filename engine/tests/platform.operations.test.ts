/**
 * Batch 7 — اختبار طبقة التحكم التشغيلي للمنصات (وحدة، بلا شبكة).
 *
 * يثبت الفصل الدقيق بين الحالات:
 *   CODE_READY ≠ EXTERNAL_SETUP_REQUIRED ≠ CONFIGURED ≠ CONNECTED ≠ VERIFIED
 *   ≠ OPERATIONAL ≠ NOT_SUPPORTED ≠ FAILED ≠ DISCONNECTED
 * وأن بوابات العمليات تنفّذ الترتيب: Capability → Connection → Verification.
 * وأن كشف الاعتماد لا يكشف أي قيمة سرّية أبداً.
 */

import { CREDENTIAL_SPECS, GLOBAL_CREDENTIALS, inspectPlatformCredentials, inspectCredentialPurpose, needsExternalCredentials } from '../social/credentials';
import {
  computePlatformStatus,
  computeAllPlatformStatuses,
  controlSummary,
  buildReadinessDetails,
  type PlatformState,
} from '../social/operations';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

/** بيئة وهمية كاملة: مفتاح تشفير + APP_URL + بيانات مزودين اختبارية (ليست أسراراً). */
const FULL_ENV: Record<string, string> = {
  PLATFORM_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
  APP_URL: 'https://example.test',
  TELEGRAM_BOT_TOKEN: 'bot-token-xyz',
  TELEGRAM_WEBHOOK_SECRET: 'wh-secret-xyz',
  GOOGLE_OAUTH_CLIENT_ID: 'gid', GOOGLE_OAUTH_CLIENT_SECRET: 'gsec',
  TIKTOK_CLIENT_KEY: 'tk', TIKTOK_CLIENT_SECRET: 'tks',
  FACEBOOK_OAUTH_CLIENT_ID: 'fbid', FACEBOOK_OAUTH_CLIENT_SECRET: 'fbsec', FACEBOOK_APP_SECRET: 'fbapp', FACEBOOK_VERIFY_TOKEN: 'fbver',
  INSTAGRAM_OAUTH_CLIENT_ID: 'igid', INSTAGRAM_OAUTH_CLIENT_SECRET: 'igsec', INSTAGRAM_APP_SECRET: 'igapp', INSTAGRAM_VERIFY_TOKEN: 'igver',
  X_OAUTH_CLIENT_ID: 'xid', X_OAUTH_CLIENT_SECRET: 'xsec',
  SNAPCHAT_OAUTH_CLIENT_ID: 'scid', SNAPCHAT_OAUTH_CLIENT_SECRET: 'scsec',
  THREADS_OAUTH_CLIENT_ID: 'thid', THREADS_OAUTH_CLIENT_SECRET: 'thsec', THREADS_APP_SECRET: 'thapp', THREADS_VERIFY_TOKEN: 'thver',
  WHATSAPP_ACCESS_TOKEN: 'wa', WHATSAPP_PHONE_NUMBER_ID: 'waid', WHATSAPP_APP_SECRET: 'waapp', WHATSAPP_VERIFY_TOKEN: 'waver',
};
const EMPTY_ENV: Record<string, string> = {};
const connectedVerified = { status: 'connected' as const, providerVerified: true };
const connectedUnverified = { status: 'connected' as const, providerVerified: false };
const disconnected = { status: 'disconnected' as const, providerVerified: false };
const reauth = { status: 'reauth_needed' as const, providerVerified: false };

function main(): void {
  group('1) اكتشاف الاعتماد — بلا كشف قيم');
  const teleCreds = inspectPlatformCredentials('telegram', FULL_ENV);
  check('Telegram: اعتماد الاتصال مضبوط كاملاً', teleCreds.connection.configured && teleCreds.connection.missing.length === 0);
  check('Telegram: webhook مضبوط', teleCreds.webhook.configured);
  const emptyTele = inspectPlatformCredentials('telegram', EMPTY_ENV);
  check('Telegram بلا بيئة: ناقص بأسماء صحيحة', emptyTele.connection.missing.includes('PLATFORM_TOKEN_ENCRYPTION_KEY') && emptyTele.connection.missing.includes('APP_URL') && emptyTele.connection.missing.includes('TELEGRAM_BOT_TOKEN'));
  check('لا قيمة سرّية في تقرير الاعتماد', !JSON.stringify(teleCreds).includes('bot-token-xyz') && !JSON.stringify(emptyTele).includes('bot-token-xyz'));
  check('اسم المتغير كافٍ للعرض التشخيصي', teleCreds.connection.required.includes('TELEGRAM_BOT_TOKEN'));

  group('2) الاعتماد البديل (Instagram يرث Meta)');
  const igViaFb = inspectPlatformCredentials('instagram', { ...FULL_ENV, INSTAGRAM_OAUTH_CLIENT_ID: '', INSTAGRAM_OAUTH_CLIENT_SECRET: '', INSTAGRAM_APP_SECRET: '', INSTAGRAM_VERIFY_TOKEN: '' });
  check('Instagram يقبل بيانات Facebook بديلاً', igViaFb.connection.configured && igViaFb.webhook.configured);
  const igNone = inspectPlatformCredentials('instagram', EMPTY_ENV);
  check('Instagram بلا بيئة: ناقص', !igNone.connection.configured);
  check('needsExternalCredentials صحيح', needsExternalCredentials('instagram', EMPTY_ENV) && !needsExternalCredentials('instagram', FULL_ENV));

  group('3) غرض النشر الاختياري');
  const waPublish = inspectCredentialPurpose('whatsapp', 'publish', EMPTY_ENV);
  check('منصة بلا متطلبات نشر = مضبوطة (اختياري)', waPublish.configured && waPublish.required.length === 0);
  const telePublish = inspectCredentialPurpose('telegram', 'publish', EMPTY_ENV);
  check('Telegram نشر يحتاج chat افتراضي (اختياري لكن مُتاح للتشخيص)', telePublish.required.includes('TELEGRAM_DEFAULT_CHAT_ID'));

  group('4) الفصل الدقيق للحالات — Telegram موصل منفّذ');
  const tCodeReady = computePlatformStatus('telegram', disconnected, EMPTY_ENV)!;
  check('Telegram بلا اعتماد => CODE_READY', tCodeReady.state === 'CODE_READY');
  check('CODE_READY يعني الاتصال محجوب', !tCodeReady.operations.find((o) => o.operation === 'publish')!.allowed);
  check('سبب الحجب يذكر أسماء المتغيرات الناقصة', Boolean(tCodeReady.blockingReason && /TELEGRAM_BOT_TOKEN|APP_URL|PLATFORM_TOKEN/.test(tCodeReady.blockingReason)));
  const tConfigured = computePlatformStatus('telegram', disconnected, FULL_ENV)!;
  check('Telegram باعتماد كامل وغير متصل => CONFIGURED', tConfigured.state === 'CONFIGURED');
  check('CONFIGURED ≠ CONNECTED', tConfigured.state !== 'CONNECTED');
  const tConnected = computePlatformStatus('telegram', connectedUnverified, FULL_ENV)!;
  check('متصل بلا توثيق => CONNECTED', tConnected.state === 'CONNECTED');
  check('CONNECTED ≠ VERIFIED', tConnected.state !== 'VERIFIED' && tConnected.providerVerified === false);
  check('CONNECTED: النشر محجوب NOT_VERIFIED', tConnected.operations.find((o) => o.operation === 'publish')!.code === 'NOT_VERIFIED');
  const tOperational = computePlatformStatus('telegram', connectedVerified, FULL_ENV)!;
  check('متصل موثق + موصل منفّذ => OPERATIONAL', tOperational.state === 'OPERATIONAL' && tOperational.providerVerified);
  check('OPERATIONAL: النشر متاح', tOperational.operations.find((o) => o.operation === 'publish')!.allowed);
  const tReauth = computePlatformStatus('telegram', reauth, FULL_ENV)!;
  check('reauth_needed => FAILED', tReauth.state === 'FAILED');
  check('FAILED يوجّه لإعادة الربط', /إعادة الربط/.test(tReauth.nextAction));

  group('5) منصة بلا موصل منفّذ (Threads)؛ وInstagram صار موصلاً حقيقياً');
  // Threads ما زال أساساً فقط: يلزم موصل منفّذ + اعتماد.
  const thNoCreds = computePlatformStatus('threads', disconnected, EMPTY_ENV)!;
  check('بلا موصل => EXTERNAL_SETUP_REQUIRED', thNoCreds.state === 'EXTERNAL_SETUP_REQUIRED');
  check('الاتصال محجوب موصل غير منفّذ', thNoCreds.operations.find((o) => o.operation === 'connect')!.code === 'CONNECTOR_NOT_IMPLEMENTED');
  const thCreds = computePlatformStatus('threads', disconnected, FULL_ENV)!;
  check('حتى مع الاعتماد يبقى EXTERNAL_SETUP_REQUIRED (لا موصل)', thCreds.state === 'EXTERNAL_SETUP_REQUIRED');
  check('لا OPERATIONAL لمنصة بلا موصل مهما كان', thCreds.state !== 'OPERATIONAL');
  // Instagram أصبح ثالث موصل حقيقي: CONFIGURED بلا اتصال، وOPERATIONAL عند الاتصال الموثق.
  const igConfigured = computePlatformStatus('instagram', disconnected, FULL_ENV)!;
  check('Instagram موصل منفّذ => CONFIGURED (لا EXTERNAL_SETUP_REQUIRED)', igConfigured.state === 'CONFIGURED');
  const igOperational = computePlatformStatus('instagram', connectedVerified, FULL_ENV)!;
  check('Instagram متصل موثق + موصل منفّذ => OPERATIONAL', igOperational.state === 'OPERATIONAL' && igOperational.providerVerified);
  check('لا OPERATIONAL لـInstagram بلا توثيق', computePlatformStatus('instagram', connectedUnverified, FULL_ENV)!.state !== 'OPERATIONAL');

  group('6) قدرات غير مدعومة تُعلن صراحةً');
  const wa = computePlatformStatus('whatsapp', connectedVerified, FULL_ENV)!;
  check('WhatsApp: النشر NOT_SUPPORTED (لا نشر عبر Cloud API للنشر العام)', wa.operations.find((o) => o.operation === 'publish')!.code === 'CAPABILITY_NOT_SUPPORTED');
  const sc = computePlatformStatus('snapchat', connectedVerified, FULL_ENV)!;
  check('Snapchat: الاستقبال NOT_SUPPORTED', sc.operations.find((o) => o.operation === 'receive')!.code === 'CAPABILITY_NOT_SUPPORTED');
  check('Snapchat: الرد NOT_SUPPORTED', sc.operations.find((o) => o.operation === 'reply')!.code === 'CAPABILITY_NOT_SUPPORTED');
  const gb = computePlatformStatus('google_business', connectedVerified, FULL_ENV)!;
  check('Google Business: الرد NOT_SUPPORTED', gb.operations.find((o) => o.operation === 'reply')!.code === 'CAPABILITY_NOT_SUPPORTED');

  group('7) التصنيف حتمي محلي — لا يحتاج اتصالاً');
  for (const p of ['telegram', 'instagram', 'snapchat', 'whatsapp'] as const) {
    const st = computePlatformStatus(p, disconnected, EMPTY_ENV)!;
    const classify = st.operations.find((o) => o.operation === 'classify')!;
    check(`التصنيف متاح دائماً (${p})`, classify.supported && classify.allowed);
  }

  group('8) المصفوفة الكاملة والملخص');
  const all = computeAllPlatformStatuses((p) => (p === 'telegram' ? connectedVerified : disconnected), FULL_ENV);
  check('عشر منصات', all.length === 10);
  const sum = controlSummary(all);
  check('الملخص يحصي OPERATIONAL = 1 (Telegram)', sum.operational === 1);
  check('الملخص يحصي غير المتصل/غيره بشكل صحيح', sum.operational + sum.connected + sum.verified === 1);
  check('لا ادعاء تشغيل لمنصات أخرى', all.filter((x) => x.platform !== 'telegram').every((x) => x.state !== 'OPERATIONAL'));

  group('9) صفوف الجاهزية الغنية (مركز الربط)');
  const details = buildReadinessDetails((p) => (p === 'telegram' ? connectedVerified : disconnected), FULL_ENV);
  check('عشر صفوف غنية', details.length === 10);
  const teleDetail = details.find((d) => d.platform === 'telegram')!;
  check('levels الثابتة تحفظ READY للكود', teleDetail.connector === 'READY');
  check('operational.publish = READY عند التشغيل الفعلي', teleDetail.operational.publish === 'READY');
  check('state = OPERATIONAL', teleDetail.operationalState === 'OPERATIONAL' && teleDetail.providerVerified);
  const fbDetail = details.find((d) => d.platform === 'facebook')!;
  check('Facebook: operational.publish = BLOCKED (قدرة موجودة بلا توثيق)', fbDetail.operational.publish === 'BLOCKED');
  check('Facebook: nextAction يذكر خطوة واضحة', fbDetail.nextAction.length > 5);
  check('لا سرّ في صفوف الجاهزية', !JSON.stringify(details).includes('fbsec') && !JSON.stringify(details).includes('fbapp'));
  const waDetail = details.find((d) => d.platform === 'whatsapp')!;
  check('WhatsApp: operational.publish = NOT_SUPPORTED', waDetail.operational.publish === 'NOT_SUPPORTED');

  group('10) نقاء الحالات: لا خلط');
  const states: PlatformState[] = ['CODE_READY', 'EXTERNAL_SETUP_REQUIRED', 'CONFIGURED', 'CONNECTED', 'VERIFIED', 'OPERATIONAL', 'NOT_SUPPORTED', 'FAILED', 'DISCONNECTED'];
  check('كل الحالات قيم فريدة معروفة', new Set(states).size === 9);
  // لا منصة تعلن OPERATIONAL بلا providerVerified في أي سيناريو.
  const scenarios = [
    { env: EMPTY_ENV, live: disconnected }, { env: FULL_ENV, live: disconnected },
    { env: FULL_ENV, live: connectedUnverified }, { env: FULL_ENV, live: reauth },
  ];
  const noFalseOperational = scenarios.every(({ env, live }) =>
    computeAllPlatformStatuses(() => live, env).every((s) => s.state !== 'OPERATIONAL' || s.providerVerified));
  check('لا OPERATIONAL بدون توثيق مزود في أي سيناريو', noFalseOperational);

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} operations control-plane checks`);
  }
}

main();
