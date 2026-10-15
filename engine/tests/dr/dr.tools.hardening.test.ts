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
  MAX_GUNZIP_OUTPUT_BYTES,
} from '../../../tools/dr/cloud-lib.mjs';
import {
  isLocalAddress,
  checkRecoveryOwnerAuth,
  ALLOW_UNAUTHENTICATED_ENV,
} from '../../../tools/dr/recoveryAuth.mjs';
import { collectTrustedSourceTree } from '../../../tools/dr/cloud-sync.mjs';

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

    // فرض فعلي في المسارات (لا فقط دالة معزولة).
    const standalone = fs.readFileSync(path.join(repoRoot, 'tools/dr/standalone-recovery.mjs'), 'utf8');
    check('F-22 standalone uses semantic check', standalone.includes('isSameDatabaseTarget(isolatedDatabaseUrl, productionUrl)'));
    const routes = fs.readFileSync(path.join(repoRoot, 'engine/dr/routes.ts'), 'utf8');
    check('F-22 routes uses semantic check', routes.includes('isSameDatabaseTarget(isolatedUrl, productionUrl)'));
    const center = fs.readFileSync(path.join(repoRoot, 'tools/dr/recovery-center.mjs'), 'utf8');
    check('F-22 recovery-center uses semantic check', center.includes('isSameDatabaseTarget(targetDb, env.DATABASE_URL)'));
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
