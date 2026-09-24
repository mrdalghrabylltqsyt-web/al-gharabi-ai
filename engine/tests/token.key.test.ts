/**
 * اختبار انحدار لمفتاح تشفير توكنات المنصات (PLATFORM_TOKEN_ENCRYPTION_KEY).
 *
 * سبب الوجود: كان tokenKeyBytes() يفكّ Base64 متسامحاً فلا يميّز «غائباً» من
 * «مضبوطاً لكن غير صالح»، بينما credentials/readiness كانا يفحصان وجود الاسم
 * فقط فيُعلنان «مضبوط» لنفس القيمة، فيظهر تضارب «التطبيق يقول غير مضبوط» رغم
 * أن المتغير موجود في Render. هذا الاختبار يثبّت التعريف الموحّد:
 *  - hex بطول 64 محرفاً => صالح (32 بايت).
 *  - Base64 يمثّل 32 بايت => صالح.
 *  - قيمة 32 محرفاً لا تمثّل 32 بايت => invalid صراحة (لا missing).
 *  - رسالة الحالة تفرّق missing من invalid.
 * ولا يعتمد على أي قيمة سرّية حقيقية: كل القيم مولّدة محلياً.
 */

import crypto from 'node:crypto';
import { decodeTokenKey, inspectTokenKey, inspectTokenKeyFromEnv, isTokenKeyValid, TOKEN_KEY_ENV_NAME, TOKEN_KEY_BYTES } from '../social/tokenKey';
import { inspectPlatformCredentials, inspectCredentialPurpose } from '../social/credentials';
import { computePlatformStatus } from '../social/operations';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

function main(): void {
  const keyBytes = crypto.randomBytes(32);
  const hex64 = keyBytes.toString('hex');
  const b64 = keyBytes.toString('base64');
  const b64unpadded = b64.replace(/=+$/, '');
  const b64url = keyBytes.toString('base64url');
  const ascii32 = 'a'.repeat(32); // 32 محرفاً ASCII ليست 32 بايت بعد الفك
  const b64Of24 = crypto.randomBytes(24).toString('base64'); // يفك إلى 24 بايت
  const hex32 = crypto.randomBytes(16).toString('hex'); // 16 بايت

  group('1) صيغ صالحة تُقبل وتُفكّ إلى 32 بايت بالضبط');
  check('hex 64 محرفاً يُقبل', decodeTokenKey(hex64)?.length === TOKEN_KEY_BYTES);
  check('hex يعيد نفس البايتات', decodeTokenKey(hex64)?.equals(keyBytes) === true);
  check('Base64 مع حشو يُقبل', decodeTokenKey(b64)?.length === TOKEN_KEY_BYTES);
  check('Base64 بلا حشو يُقبل', decodeTokenKey(b64unpadded)?.length === TOKEN_KEY_BYTES);
  check('Base64url يُقبل', decodeTokenKey(b64url)?.length === TOKEN_KEY_BYTES);
  check('كل الصيغ تُفكّ إلى نفس المفتاح', [b64, b64unpadded, b64url].every((v) => decodeTokenKey(v)!.equals(keyBytes)));

  group('2) قيم غير صالحة تُرفض صراحةً (لا تُقبل بصمت)');
  check('32 محرفاً ASCII تُرفض (ليست 32 بايت)', decodeTokenKey(ascii32) === null);
  check('Base64 لـ24 بايت (32 محرفاً) يُرفض', decodeTokenKey(b64Of24) === null);
  check('hex 32 (16 بايت) يُرفض', decodeTokenKey(hex32) === null);
  check('نص قصير يُرفض', decodeTokenKey('short') === null);
  check('محارف غريبة تُرفض', decodeTokenKey('!!!'.repeat(8)) === null);
  check('علامات تنصيص حول قيمة صالحة تُرفض (لا تفكيك متسامح)', decodeTokenKey(`"${b64}"`) === null);

  group('3) التمييز الصريح بين missing وinvalid');
  const missing = inspectTokenKey('');
  const missing2 = inspectTokenKey(undefined);
  const invalid = inspectTokenKey(ascii32);
  const valid = inspectTokenKey(b64);
  check('الغائب => state=missing', missing.state === 'missing' && missing2.state === 'missing');
  check('غير الصالح => state=invalid', invalid.state === 'invalid');
  check('الصالح => state=valid and bytes=32', valid.state === 'valid' && valid.bytes === TOKEN_KEY_BYTES);
  check('رسالة missing تذكر عدم الضبط والصيغة المطلوبة', /غير مضبوط/.test(missing.reason) && /32 بايت/.test(missing.reason));
  check('رسالة invalid تذكر أن القيمة مضبوطة لكن غير صالحة', /مضبوط/.test(invalid.reason) && /غير صالحة/.test(invalid.reason) && /32 بايت/.test(invalid.reason));
  check('رسالتا missing وinvalid مختلفتان', missing.reason !== invalid.reason);
  check('لا قيمة سرّية داخل أي رسالة حالة', ![hex64, b64, b64url].some((v) => invalid.reason.includes(v) || valid.reason.includes(v)));

  group('4) credentials يستخدم التحقق الحقيقي لا وجود الاسم');
  const envInvalid: Record<string, string> = { [TOKEN_KEY_ENV_NAME]: ascii32, APP_URL: 'https://example.test', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_WEBHOOK_SECRET: 's' };
  const credsInvalid = inspectPlatformCredentials('telegram', envInvalid);
  check('مفتاح غير صالح => الاعتماد غير مضبوط', !credsInvalid.connection.configured);
  check('مفتاح غير صالح يظهر في invalid لا في missing', credsInvalid.connection.invalid.includes(TOKEN_KEY_ENV_NAME) && !credsInvalid.connection.missing.includes(TOKEN_KEY_ENV_NAME));
  const envMissing: Record<string, string> = { APP_URL: 'https://example.test', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_WEBHOOK_SECRET: 's' };
  const credsMissing = inspectPlatformCredentials('telegram', envMissing);
  check('مفتاح غائب يظهر في missing لا في invalid', credsMissing.connection.missing.includes(TOKEN_KEY_ENV_NAME) && !credsMissing.connection.invalid.includes(TOKEN_KEY_ENV_NAME));
  const envValid: Record<string, string> = { ...envMissing, [TOKEN_KEY_ENV_NAME]: hex64 };
  const credsValid = inspectPlatformCredentials('telegram', envValid);
  check('مفتاح صالح => الاعتماد مضبوط', credsValid.connection.configured);
  check('لا قيمة سرّية في تقرير الاعتماد', !JSON.stringify([credsInvalid, credsMissing, credsValid]).includes(b64) && !JSON.stringify([credsInvalid, credsMissing, credsValid]).includes(hex64));

  group('5) operations يميّز الغياب من عدم الصلاحية في الحجب');
  const noKeyStatus = computePlatformStatus('telegram', { status: 'disconnected' }, envMissing)!;
  const badKeyStatus = computePlatformStatus('telegram', { status: 'disconnected' }, envInvalid)!;
  check('مفتاح غائب => سبب الحجب يذكر عدم الضبط', /غير مضبوط/.test(noKeyStatus.blockingReason || ''));
  check('مفتاح غير صالح => سبب الحجب يذكر عدم الصلاحية', /غير صالحة/.test(badKeyStatus.blockingReason || ''));
  check('الحالتان لا تتطابقان في السبب', noKeyStatus.blockingReason !== badKeyStatus.blockingReason);
  check('الحالة في الحالتين ليست OPERATIONAL', noKeyStatus.state !== 'OPERATIONAL' && badKeyStatus.state !== 'OPERATIONAL');
  check('المفتاح الصالح يزيل ذكر المفتاح من الحجب', !(computePlatformStatus('telegram', { status: 'disconnected' }, envValid)!.blockingReason || '').includes(TOKEN_KEY_ENV_NAME));

  group('6) فحص البيئة الكاملة');
  check('inspectTokenKeyFromEnv من بيئة فارغة => missing', inspectTokenKeyFromEnv({}).state === 'missing');
  check('isTokenKeyValid صحيح للحالتين', isTokenKeyValid(envValid) === true && isTokenKeyValid(envInvalid) === false);
  check('لا يغيّر المتغير الذي لا علاقة له', inspectCredentialPurpose('telegram', 'webhook', envInvalid).configured === true);

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`OK: ${passed} checks passed`);
  }
}

main();
