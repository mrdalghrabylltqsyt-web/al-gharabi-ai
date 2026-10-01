/**
 * اختبارات حزمة الأسرار المشفّرة (secrets.enc) — منطق صافٍ، بلا شبكة وبلا أسرار حقيقية.
 *
 * يثبت: اكتشاف أسماء المتغيّرات الفعلية، التشفير/الفكّ، فشل المفتاح الخاطئ،
 * رفض الحزمة التالفة، عدم ظهور أي قيمة سرّية في الحزمة أو البيان، وأن المفتاح
 * الرئيسي نفسه لا يُدرج داخل الحزمة.
 */

import {
  discoverSecretEnvNames,
  isSecretEnvName,
  encryptSecretsPackage,
  decryptSecretsPackage,
  buildSecretsBundle,
  inspectMasterKey,
  resolveMasterKey,
  MASTER_KEY_ENV,
} from '../../../tools/dr/secret-crypto.mjs';
import { isEncryptedSecretsPackage } from '../../../tools/dr/cloud-lib.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// مفتاح اختبار حقيقي الشكل (64 hex) — وهمي ومولّد وقت التشغيل، لا سرّ حقيقي.
const KEY = 'a1'.repeat(32);
const KEY2 = 'b2'.repeat(32);
const ENV = { [MASTER_KEY_ENV]: KEY };

async function main() {
  // --- اكتشاف أسماء الأسرار ---
  {
    const env: Record<string, string> = {
      GEMINI_API_KEY: 'AIzaSy' + 'x'.repeat(33),
      SESSION_SECRET: 'sess-' + 'y'.repeat(40),
      TELEGRAM_BOT_TOKEN: '12345678:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi', // dummy test value (ليس سرّاً حقيقياً)
      RESEND_API_KEY: 're_' + 'z'.repeat(24),
      DATABASE_URL: 'postgres://user:pass@host/db',
      NODE_ENV: 'production',
      RENDER: 'true',
      PORT: '4517',
      AI_TIMEOUT_MS: '30000',
      GEMINI_DAILY_LIMIT: '4',
      [MASTER_KEY_ENV]: KEY,
    };
    const names = discoverSecretEnvNames(env);
    check('discovers api key', names.includes('GEMINI_API_KEY'));
    check('discovers session secret', names.includes('SESSION_SECRET'));
    check('discovers bot token', names.includes('TELEGRAM_BOT_TOKEN'));
    check('discovers resend key', names.includes('RESEND_API_KEY'));
    check('excludes operational vars', !names.includes('NODE_ENV') && !names.includes('RENDER') && !names.includes('PORT') && !names.includes('AI_TIMEOUT_MS') && !names.includes('GEMINI_DAILY_LIMIT'));
    check('excludes DATABASE_URL', !names.includes('DATABASE_URL'));
    check('excludes master key itself', !names.includes(MASTER_KEY_ENV));
    check('isSecretEnvName key/secret/token', isSecretEnvName('X_KEY') && isSecretEnvName('X_SECRET') && isSecretEnvName('X_TOKEN') && isSecretEnvName('X_PASSWORD'));
    check('isSecretEnvName rejects plain', !isSecretEnvName('NODE_ENV') && !isSecretEnvName('PORT') && !isSecretEnvName('APP_URL'));
  }

  // --- تشفير/فكّ ---
  {
    const secrets = { GEMINI_API_KEY: 'AIzaSy' + 'q'.repeat(33), SESSION_SECRET: 'super-secret-value-1234567890' };
    const enc = encryptSecretsPackage(secrets, ENV);
    check('encrypt ok', enc.ok === true && typeof enc.payload === 'string');
    check('package shape valid', isEncryptedSecretsPackage(enc.payload));
    check('no plaintext secret in package', !enc.payload.includes('AIzaSy') && !enc.payload.includes('super-secret-value'));
    check('no plaintext name in package', !enc.payload.includes('GEMINI_API_KEY'));
    const dec = decryptSecretsPackage(enc.payload, ENV);
    check('decrypt roundtrip', dec.ok === true && dec.secrets.GEMINI_API_KEY === secrets.GEMINI_API_KEY && dec.secrets.SESSION_SECRET === secrets.SESSION_SECRET);
  }

  // --- مفتاح خاطئ يفشل ---
  {
    const enc = encryptSecretsPackage({ A_SECRET: 'value-' + 'v'.repeat(20) }, ENV);
    const wrong = decryptSecretsPackage(enc.payload, { [MASTER_KEY_ENV]: KEY2 });
    check('wrong key fails', wrong.ok === false && wrong.code === 'decrypt_failed');
  }

  // --- حزمة تالفة تُرفض ---
  {
    const enc = encryptSecretsPackage({ A_SECRET: 'value-' + 'v'.repeat(20) }, ENV);
    const tampered = enc.payload.replace(/data: .+/, 'data: ' + 'A'.repeat(64));
    const dec = decryptSecretsPackage(tampered, ENV);
    check('tampered package fails', dec.ok === false);
    check('non-package rejected', decryptSecretsPackage('hello world', ENV).ok === false);
  }

  // --- بناء الحزمة + البيان (بلا قيم) ---
  {
    const env: Record<string, string> = { [MASTER_KEY_ENV]: KEY, GEMINI_API_KEY: 'AIzaSy' + 'm'.repeat(33), SESSION_SECRET: 'sess-' + 'n'.repeat(30) };
    const built = buildSecretsBundle(env, { now: '2026-01-01T00:00:00.000Z' });
    check('bundle ok', built.ok === true);
    check('bundle count', built.count === 2);
    const manifestJson = JSON.stringify(built.manifest);
    check('manifest names only (no values)', built.manifest.includedNames.includes('GEMINI_API_KEY') && !manifestJson.includes('AIzaSy') && !manifestJson.includes('sess-'));
    check('manifest has fingerprint', /^[0-9a-f]{12}$/.test(built.manifest.keyFingerprint));
    check('manifest encrypted flag', built.manifest.encrypted === true && built.manifest.masterKeyRequired === true);
    check('manifest declares master key env names', Array.isArray(built.manifest.masterKeyEnvNames) && built.manifest.masterKeyEnvNames.includes(MASTER_KEY_ENV));
  }

  // --- لا أسرار => لا حزمة فارغة ---
  {
    const built = buildSecretsBundle({ [MASTER_KEY_ENV]: KEY, NODE_ENV: 'production' });
    check('empty env => no_secrets_found', built.ok === false && built.code === 'no_secrets_found');
  }

  // --- غياب المفتاح الرئيسي ---
  {
    const built = buildSecretsBundle({ GEMINI_API_KEY: 'AIzaSy' + 'p'.repeat(33) }, {});
    check('missing master key blocks', built.ok === false && built.code === 'master_key_missing');
    check('inspect missing', inspectMasterKey({}).state === 'missing');
    check('inspect invalid', inspectMasterKey({ [MASTER_KEY_ENV]: 'short' }).state === 'invalid');
    check('inspect valid', inspectMasterKey(ENV).state === 'valid' && inspectMasterKey(ENV).source === MASTER_KEY_ENV);
    check('resolve key bytes', resolveMasterKey(ENV).key.length === 32);
    // تشخيص لكل متغيّر: يميّز الغياب عن عدم الصلاحية بلا كشف أي قيمة.
    const perKey = inspectMasterKey({ [MASTER_KEY_ENV]: 'short' }).perKey;
    check('perKey distinguishes present-invalid', Array.isArray(perKey) && perKey.length === 3
      && perKey[0].name === MASTER_KEY_ENV && perKey[0].present === true && perKey[0].valid === false && perKey[0].length === 5
      && perKey[1].present === false && perKey[1].valid === false
      && perKey[0].fingerprint === null);
    const perKeyValid = inspectMasterKey(ENV).perKey.find((p) => p.name === MASTER_KEY_ENV);
    check('perKey exposes valid fingerprint', perKeyValid.valid === true && /^[0-9a-f]{12}$/.test(perKeyValid.fingerprint) && perKeyValid.length === 64);
  }

  if (failures.length) {
    console.error(`DR SECRETS TESTS FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`DR SECRETS TESTS PASSED: ${passed} checks`);
}

main().catch((err) => {
  console.error('DR SECRETS TESTS CRASHED:', err);
  process.exit(1);
});
