/**
 * اختبارات تقوية أدوات الاستعادة (tools/dr) — دفعة F-20..F-23.
 *
 * يثبت لكل بند أن الثغرة لم تعد موجودة، وأن الحماية تفشل بأمان:
 *  F-21: حدّ أقصى صريح لفكّ الضغط (منع «قنبلة ضغط») مع تمييز الفشل عن فساد gzip.
 *  F-20: الماسح الصارم يفحص **ملفات الشيفرة** أيضاً (سرّ مُثبَّت بإنتروبيا عالية)
 *        بلا false positives على القيم الوصفية في الاختبارات، ويمرّ على الشجرة الحقيقية.
 *  F-22: رفض قاعدة الإنتاج بمقارنة **دلالية** (host+port+database) لا نصّية.
 *  F-23: علم تعطيل المصادقة يُطبَّق على اتصال محلي (loopback) فقط.
 *  + لا انحراف بين tools/dr وdr-recovery-center/lib (تزامن إلزامي).
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  gunzipBounded,
  scanForSecretsStrict,
  isSameDatabaseTarget,
  databaseTargetKey,
  refuseProductionDatabaseTarget,
  MAX_GUNZIP_OUTPUT_BYTES,
} from '../../../tools/dr/cloud-lib.mjs';
import {
  isLocalAddress,
  checkRecoveryOwnerAuth,
  ALLOW_UNAUTHENTICATED_ENV,
  OWNER_TOKEN_ENV,
} from '../../../tools/dr/recoveryAuth.mjs';
import { collectTrustedSourceTree } from '../../../tools/dr/cloud-sync.mjs';
import { encryptDbDump, decryptDbDump } from '../../../tools/dr/db-crypto.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  // ---------- F-21: فكّ ضغط محدود ----------
  {
    const payload = Buffer.from('x'.repeat(500 * 1024), 'utf8');
    const gz = zlib.gzipSync(payload);
    const ok = gunzipBounded(gz);
    check('F-21 legit gzip decompresses', ok.ok === true && ok.data.length === payload.length);
    const capped = gunzipBounded(gz, 1024);
    check('F-21 bomb rejected explicitly', capped.ok === false && capped.code === 'decompressed_too_large');
    const bad = gunzipBounded(Buffer.from('not-a-gzip-stream'));
    check('F-21 invalid gzip classified separately', bad.ok === false && bad.code === 'invalid_gzip');
    check('F-21 default cap is finite and positive', Number.isFinite(MAX_GUNZIP_OUTPUT_BYTES) && MAX_GUNZIP_OUTPUT_BYTES > 0);
    // لا يُخزّن الناتج كاملاً عند التجاوز (فشل بأمان بلا استنزاف).
    const huge = zlib.gzipSync(Buffer.alloc(64 * 1024 * 1024));
    const blocked = gunzipBounded(huge, 1024 * 1024);
    check('F-21 large bomb blocked without full output', blocked.ok === false && blocked.code === 'decompressed_too_large');
  }

  // ---------- F-20: فحص أسرار في ملفات الشيفرة ----------
  {
    // تُبنى القيم وقت التشغيل من مقاطع كي لا يوجد نصّ يشبه السرّ في الملف نفسه
    // (الماسح يفحص هذا الملف ضمن الشجرة الحقيقية أيضاً).
    const fakeSession = 'aB3xK9mN2pQ7rT4vW8yZ1cD5fG6hJ0kL' + '9z';
    const planted = [{ path: 'src/leak.ts', content: `const SESSION_SECRET = "${fakeSession}";\n` }];
    const plantedScan = scanForSecretsStrict(planted as any);
    check('F-20 hardcoded code secret detected', plantedScan.ok === false && plantedScan.findings.some((f) => f.kind === 'hardcoded_code_secret'));

    const benign = [{ path: 'engine/tests/x.test.ts', content: 'const SESSION_SECRET = "phase2-batch-secret-local-only";\n' }];
    check('F-20 descriptive test literal not flagged', scanForSecretsStrict(benign as any).ok === true);

    const fakeGoogle = 'AIzaSy' + 'D-1234567890' + 'abcdefghijklmnopqrstu';
    const known = [{ path: 'src/g.ts', content: `const key = "${fakeGoogle}";\n` }];
    check('F-20 known google key pattern still detected', scanForSecretsStrict(known as any).ok === false);

    const tree = collectTrustedSourceTree(repoRoot);
    check('F-20 real tracked tree complete', tree.complete === true && tree.fileCount >= 10);
    const realScan = scanForSecretsStrict(tree.included as any);
    check('F-20 real tracked tree has no secret', realScan.ok === true, realScan.findings.slice(0, 3).map((f) => `${f.path}:${f.line}:${f.kind}`).join(','));

    // F-20: استثناء صريح موثّق لكل سطر — سطر مُستثنى لا يُفشل البناء، وسطر آخر بنفس
    // القيمة **بلا** استثناء يبقى مُرصوداً (الاستثناء محدود بالسطر لا بالملف).
    const allowReason = 'fixture deliberately public, not a real secret';
    const allowed = [{ path: 'src/allow.ts', content: `const SESSION_SECRET = "${fakeSession}"; // secret-scan-allow: ${allowReason}\n` }];
    check('F-20 allow-line exception passes', scanForSecretsStrict(allowed as any).ok === true);
    const notAllowed = [{ path: 'src/noallow.ts', content: `const SESSION_SECRET = "${fakeSession}";\n` }];
    check('F-20 same value without exception still fails', scanForSecretsStrict(notAllowed as any).ok === false);
    // الاستثناء يتطلّب سبباً غير فارغ (لا استثناء صامت).
    const bare = [{ path: 'src/bare.ts', content: `const SESSION_SECRET = "${fakeSession}"; // secret-scan-allow:\n` }];
    check('F-20 empty-reason exception does NOT apply', scanForSecretsStrict(bare as any).ok === false);

    // F-20 (مراجعة): الاستثناء يُسكت فحص الإنتروبيا فقط — لا يُسكت الأنماط المعروفة.
    const allowNote = '// secret-scan-allow: documented reason';
    const allowedGoogle = [{ path: 'src/g2.ts', content: `const key = "${fakeGoogle}"; ${allowNote}\n` }];
    check('F-20 allow does NOT silence google key pattern', scanForSecretsStrict(allowedGoogle as any).ok === false
      && scanForSecretsStrict(allowedGoogle as any).findings.some((f) => f.kind === 'google_api_key'));
    const fakeGithub = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
    const allowedGithub = [{ path: 'src/gh.ts', content: `const t = "${fakeGithub}"; ${allowNote}\n` }];
    check('F-20 allow does NOT silence github token pattern', scanForSecretsStrict(allowedGithub as any).ok === false
      && scanForSecretsStrict(allowedGithub as any).findings.some((f) => f.kind === 'github_token'));
    const dbUrl = 'postgres://admin:' + 'S3cretP4ssword' + '@db.prod-gharabi.net:5432/gharabi';
    const allowedDb = [{ path: 'src/db.ts', content: `const url = "${dbUrl}"; ${allowNote}\n` }];
    check('F-20 allow does NOT silence db credential URL', scanForSecretsStrict(allowedDb as any).ok === false
      && scanForSecretsStrict(allowedDb as any).findings.some((f) => f.kind === 'db_credential_url'));

    // رسالة الفشل في البناء تذكر الملف/السطر/النوع فقط ولا تسرّب القيمة.
    const sb = fs.readFileSync(path.join(repoRoot, 'tools/dr/source-bundle.mjs'), 'utf8');
    check('F-20 build failure message names file:line [kind]', sb.includes('${f.path}:${f.line} [${f.kind}]'));
    check('F-20 build failure message never prints value', !/console\.error\([^)]*f\.value/.test(sb));
  }

  // ---------- F-22: مقارنة دلالية لقاعدة البيانات ----------
  {
    const prod = 'postgres://user:pw@Host-1:5432/gharabi?sslmode=require';
    check('F-22 same db different creds/params', isSameDatabaseTarget(prod, 'postgres://other@host-1/gharabi') === true);
    check('F-22 same db default port vs explicit', isSameDatabaseTarget('postgresql://u@h/db', 'postgres://u@h:5432/db') === true);
    check('F-22 different database name', isSameDatabaseTarget('postgres://u@h/prod', 'postgres://u@h/other') === false);
    check('F-22 different host', isSameDatabaseTarget('postgres://u@a/prod', 'postgres://u@b/prod') === false);
    check('F-22 unparseable returns null key', databaseTargetKey('not a url') === null);
    check('F-22 null-safe comparison', isSameDatabaseTarget(null as any, prod) === false);

    // Neon pooler vs direct = نفس القاعدة
    const direct = 'postgres://u@ep-cool-1.us-east-2.aws.neon.tech/gharabi';
    const pooler = 'postgres://u@ep-cool-1-pooler.us-east-2.aws.neon.tech/gharabi';
    check('F-22 neon pooler == direct', isSameDatabaseTarget(pooler, direct) === true);
    check('F-22 pooler reverse order', isSameDatabaseTarget(direct, pooler) === true);
    check('F-22 host case-insensitive', isSameDatabaseTarget('postgres://u@EP-Cool-1.us-east-2.aws.neon.tech/gharabi', direct) === true);
    check('F-22 pooler suffix only (not mid-host)', databaseTargetKey('postgres://u@ep-pooler-x.host/db') === 'ep-pooler-x.host:5432/db');
    check('F-22 localhost == 127.0.0.1', isSameDatabaseTarget('postgres://u@localhost:5432/db', 'postgres://u@127.0.0.1:5432/db') === true);
    check('F-22 ::1 == localhost', isSameDatabaseTarget('postgres://u@[::1]:5432/db', 'postgres://u@localhost/db') === true);

    // fail-closed decision
    const g = refuseProductionDatabaseTarget;
    check('F-22 guard: same db refuses', g(pooler, direct).refuse === true && g(pooler, direct).reason === 'same_database');
    check('F-22 guard: distinct db allows', g('postgres://u@a/db1', 'postgres://u@b/db2').refuse === false);
    check('F-22 guard: target present + prod missing => refuse', g('postgres://u@a/db1', '').refuse === true && g('postgres://u@a/db1', '').reason === 'production_url_missing');
    check('F-22 guard: unparseable production => refuse', g('postgres://u@a/db1', 'not a url').refuse === true && g('postgres://u@a/db1', 'not a url').reason === 'unparseable_production');
    check('F-22 guard: unparseable target => refuse', g('not a url', 'postgres://u@a/db1').refuse === true && g('not a url', 'postgres://u@a/db1').reason === 'unparseable_target');
    check('F-22 guard: no target => no write, allowed', g('', 'postgres://u@a/db1').refuse === false);

    // فرض فعلي في المسارات (لا فقط دالة معزولة).
    const standalone = fs.readFileSync(path.join(repoRoot, 'tools/dr/standalone-recovery.mjs'), 'utf8');
    check('F-22 standalone uses fail-closed guard', standalone.includes('refuseProductionDatabaseTarget(isolatedDatabaseUrl, productionUrl)'));
    const routes = fs.readFileSync(path.join(repoRoot, 'engine/dr/routes.ts'), 'utf8');
    check('F-22 routes uses fail-closed guard', routes.includes('refuseProductionDatabaseTarget(isolatedUrl, productionUrl)'));
    const center = fs.readFileSync(path.join(repoRoot, 'tools/dr/recovery-center.mjs'), 'utf8');
    check('F-22 recovery-center uses fail-closed guard', center.includes('refuseProductionDatabaseTarget(targetDb, env.DATABASE_URL)'));
  }

  // ---------- F-23: علم تعطيل المصادقة محلي فقط ----------
  {
    check('F-23 loopback v4', isLocalAddress('127.0.0.1') === true);
    check('F-23 loopback v6', isLocalAddress('::1') === true);
    check('F-23 wrapped loopback', isLocalAddress('::ffff:127.0.0.1') === true);
    check('F-23 public ip not local', isLocalAddress('8.8.8.8') === false);
    check('F-23 128.x not loopback', isLocalAddress('128.0.0.1') === false);

    const env = { [ALLOW_UNAUTHENTICATED_ENV]: 'true' };
    const localReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as any;
    const externalReq = { headers: {}, socket: { remoteAddress: '203.0.113.9' } } as any;
    check('F-23 flag allows local', checkRecoveryOwnerAuth(localReq, env as any).allowed === true);
    check('F-23 flag does NOT allow external', checkRecoveryOwnerAuth(externalReq, env as any).allowed === false);

    const center = fs.readFileSync(path.join(repoRoot, 'tools/dr/recovery-center.mjs'), 'utf8');
    check('F-23 hosted center binds to 0.0.0.0 (non-local) so flag stays fail-closed', center.includes("'0.0.0.0'"));
  }

  // ---------- F-05: توليد مفتاح مالك مركز الاستعادة إلزامياً (32 بايت عشوائي) ----------
  {
    const gen = fs.readFileSync(path.join(repoRoot, 'scripts/generate-secrets.mjs'), 'utf8');
    check('F-05 generator emits RECOVERY_CENTER_OWNER_TOKEN', gen.includes('RECOVERY_CENTER_OWNER_TOKEN'));
    check('F-05 generator uses 32 random bytes for the owner token',
      /RECOVERY_CENTER_OWNER_TOKEN\s*=\s*crypto\.randomBytes\(32\)/.test(gen));
    check('F-05 generator does not add DRIVE_TOKEN_ENCRYPTION_KEY (would break existing backups)',
      !/DRIVE_TOKEN_ENCRYPTION_KEY\s*=/.test(gen));
  }

  // ---------- F-05: تحديد معدّل محاولات التخمين على نقطة مصادقة المالك (429) ----------
  {
    const center = fs.readFileSync(path.join(repoRoot, 'tools/dr/recovery-center.mjs'), 'utf8');
    check('F-05 owner-auth route returns 429 on rate limit',
      /req\.method === 'GET' && url\.pathname === '\/api\/owner-auth'/.test(center)
      && /auth\.reason === 'rate_limited' \? 429 : 401/.test(center));
    // محاولات فاشلة متكررة من نفس IP => 429 (سلوك الوحدة).
    const env = { [OWNER_TOKEN_ENV]: 'a'.repeat(32) };
    const req = { headers: { authorization: 'Bearer wrong-token-value' }, socket: { remoteAddress: '203.0.113.55' } } as any;
    let sawRateLimited = false;
    for (let i = 0; i < 12; i++) {
      const r = checkRecoveryOwnerAuth(req, env as any);
      if (r.reason === 'rate_limited') { sawRateLimited = true; break; }
    }
    check('F-05 repeated bad attempts => rate_limited', sawRateLimited === true);
  }

  // ---------- F-21: قياس نسخة قاعدة البيانات (مضغوطة وبعد الفك) ----------
  // نسخة القاعدة تُخزَّن application/octet-stream (AES-256-GCM + base64) ولا تمرّ
  // بـgunzipBounded إطلاقاً، فلا ينطبق عليها حدّ فكّ الضغط. الحزمة الوحيدة المضغوطة
  // (source bundle) لها هامش 12.4×. القياس أدناه يوثّق الحجم ويؤكد عدم انطباق الحدّ.
  {
    const dbDump = encryptDbDump('x'.repeat(1024 * 1024), { DRIVE_DB_BACKUP_KEY: 'ab'.repeat(32) });
    check('F-21 DB artifact is an encrypted dump (never raw SQL)', dbDump.ok === true && /encrypted: true/.test(String(dbDump.payload)));
    const roundTrip = decryptDbDump(String(dbDump.payload), { DRIVE_DB_BACKUP_KEY: 'ab'.repeat(32) });
    check('F-21 DB artifact round-trips (measurement is valid)', roundTrip.ok === true);
    // قاعدة ملزمة: نسخة القاعدة لا تُفكّ بـgunzipBounded (لا قنبلة ضغط ممكنة هنا).
    const store = fs.readFileSync(path.join(repoRoot, 'tools/dr/drive-store.mjs'), 'utf8');
    check('F-21 DB dump is stored octet-stream and never gunzipped',
      store.includes("dbName, dbBuf, 'application/octet-stream'") && !/gunzipBounded\([^)]*DB_DUMP/.test(store));
  }

  // ---------- تزامن lib (لا انحراف) ----------
  {
    for (const rel of ['cloud-lib.mjs', 'recoveryAuth.mjs', 'standalone-recovery.mjs', 'recovery-center.mjs']) {
      const tool = fs.readFileSync(path.join(repoRoot, 'tools/dr', rel), 'utf8');
      const lib = fs.readFileSync(path.join(repoRoot, 'dr-recovery-center/lib', rel), 'utf8');
      check(`lib synced: ${rel}`, tool === lib);
    }
  }

  console.log(`\ndr tools hardening (F-20..F-23): ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
