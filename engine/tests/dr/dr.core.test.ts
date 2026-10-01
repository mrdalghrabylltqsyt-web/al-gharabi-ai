/**
 * اختبارات نواة منظومة DR (منطق صافٍ، بلا شبكة وبلا Drive).
 *
 * يثبت: بصمة الشجرة، تصنيف الفروق (إضافة/تعديل/حذف/نقل/لا تغيير)، الاستبعادات،
 * فحص الأسرار (بما فيها الملفات المستبعدة)، رفض قاعدة البيانات الخام وقبول
 * المشفّرة، بوابة المساحة، لقطة المراقبة، الفحص الساعي، وبيان نقطة الاستعادة
 * وربط rp-001 بالـcommit المعتمد.
 */

import zlib from 'node:zlib';
import {
  computeTreeHash,
  diffSnapshots,
  hashContent,
  buildSourceBundle,
  shouldExclude,
  scanForSecrets,
  classifyDbDump,
  withinQuota,
  buildMonitoringSnapshot,
  hourlySafetyCheck,
  buildRecoveryManifest,
  assertRp001Manifest,
  encodeFileName,
  decodeFileName,
  DESIGN_QUOTA_BYTES,
  QUOTA_HEADROOM_BYTES,
  RP_001_COMMIT,
  DRIVE_FILE_SCOPE,
  DRIVE_FORBIDDEN_SCOPES,
} from '../../../tools/dr/cloud-lib.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// --- بصمة الشجرة ---
const t1 = computeTreeHash([{ path: 'a', sha256: '1' }, { path: 'b', sha256: '2' }]);
const t2 = computeTreeHash([{ path: 'b', sha256: '2' }, { path: 'a', sha256: '1' }]);
check('treeHash stable order-independent', t1 === t2 && /^[0-9a-f]{64}$/.test(t1));
const t3 = computeTreeHash([{ path: 'a', sha256: '9' }, { path: 'b', sha256: '2' }]);
check('treeHash changes with content', t1 !== t3);
check('hashContent deterministic', hashContent('x') === hashContent(Buffer.from('x')));

// --- حزمة المصدر قابلة لإعادة الإنتاج (لا mtime متغيّر) ---
// يضمن كشف «لا تغيير» فعلاً: نفس المحتوى => نفس البصمة، مهما اختلف زمن البناء.
{
  const files = [{ path: 'a.txt', content: 'hello' }, { path: 'dir/b.txt', content: 'world' }];
  const b1 = buildSourceBundle(files).buffer;
  const b2 = buildSourceBundle(files).buffer;
  check('source bundle deterministic (same hash)', hashContent(b1) === hashContent(b2));
  const tar = zlib.gunzipSync(b1);
  const mtimeField = tar.subarray(136, 147).toString('utf8');
  check('source bundle tar mtime is fixed epoch', mtimeField === '00000000000');
  const changed = buildSourceBundle([{ path: 'a.txt', content: 'hello!' }, { path: 'dir/b.txt', content: 'world' }]).buffer;
  check('source bundle hash changes with content', hashContent(b1) !== hashContent(changed));
}

// --- diff: إضافة ---
const base = [{ path: 'a.txt', sha256: 'aa' }, { path: 'b.txt', sha256: 'bb' }];
let d = diffSnapshots(base, [...base, { path: 'c.txt', sha256: 'cc' }]);
check('diff add', d.added.length === 1 && d.added[0].path === 'c.txt' && !d.noChange);

// --- diff: تعديل ---
d = diffSnapshots(base, [{ path: 'a.txt', sha256: 'AA' }, { path: 'b.txt', sha256: 'bb' }]);
check('diff modify', d.modified.length === 1 && d.modified[0].path === 'a.txt' && d.modified[0].previousSha256 === 'aa');

// --- diff: حذف ---
d = diffSnapshots(base, [{ path: 'a.txt', sha256: 'aa' }]);
check('diff delete', d.removed.length === 1 && d.removed[0].path === 'b.txt');

// --- diff: نقل (نفس المحتوى بمسار جديد) ---
d = diffSnapshots(base, [{ path: 'a.txt', sha256: 'aa' }, { path: 'b2.txt', sha256: 'bb' }]);
check('diff rename detected', d.renamed.length === 1 && d.renamed[0].from === 'b.txt' && d.renamed[0].to === 'b2.txt');
check('diff rename not double-counted', d.added.length === 0 && d.removed.length === 0);

// --- diff: لا تغيير ---
d = diffSnapshots(base, base);
check('diff no_change', d.noChange && d.unchanged.length === 2);

// --- استبعادات ---
check('exclude .env', shouldExclude('.env') && shouldExclude('.env.local'));
check('exclude .git', shouldExclude('.git/config'));
check('exclude node_modules', shouldExclude('node_modules/x/y.js'));
check('exclude dist', shouldExclude('dist/server.cjs'));
check('exclude .dr-recovery', shouldExclude('.dr-recovery/current/x'));
check('exclude *.pem/*.key/*.p12', shouldExclude('a/b.pem') && shouldExclude('k.key') && shouldExclude('c.p12'));
check('exclude id_rsa/.npmrc/.pypirc', shouldExclude('sub/id_rsa') && shouldExclude('.npmrc') && shouldExclude('.pypirc'));
check('keep normal source', !shouldExclude('server.ts') && !shouldExclude('tools/dr/cloud-lib.mjs'));

// --- فحص الأسرار: يشمل المستبعدة ---
const secret = scanForSecrets([
  { path: 'src/ok.ts', content: 'const x = 1;' },
  { path: '.env', content: 'GEMINI_API_KEY=AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345678FAKE' },
  { path: 'a/b.key', content: '-----BEGIN PRIVATE KEY-----\nMIIabc-fake-not-real\n-----END PRIVATE KEY-----' },
  { path: 'conf.json', content: '{"refresh_token":"1//0abcdefghijklmnopqrstuvwxyzABCDEFGH-fake"}' },
]);
check('secret scan detects (incl excluded)', !secret.ok && secret.findings.length >= 3);
check('secret scan no value leaked', secret.findings.every((f) => !('value' in f)));
check('secret scan clean passes', scanForSecrets([{ path: 'x.ts', content: 'const a = 1;' }]).ok);
check('secret scan ignores placeholder', scanForSecrets([{ path: 'e.txt', content: 'api_key=your_key_here_change_me' }]).ok);

// --- قاعدة البيانات: خام مرفوض، مشفّر مقبول ---
check('db raw rejected', classifyDbDump('CREATE TABLE t(id int); INSERT INTO t VALUES (1);').allowed === false);
check('db pg_dump rejected', classifyDbDump('-- PostgreSQL database dump\npg_dump output').raw === true);
check('db encrypted allowed', classifyDbDump(`GHARABI-DB-DUMP-V1\nencrypted: true\ncipher: aes-256-gcm\ndata: ${'A'.repeat(32)}\n`).allowed === true);
check('db not-a-dump rejected', classifyDbDump('hello world').allowed === false);

// --- بوابة المساحة ---
check('quota allows small', withinQuota(0, 1024).allowed === true);
check('quota blocks overflow', withinQuota(DESIGN_QUOTA_BYTES - 1024, 5000).allowed === false);
check('quota blocks without purchase', withinQuota(DESIGN_QUOTA_BYTES - 1024, 5000).reason === 'quota_exceeded');
check('quota headroom respected', withinQuota(DESIGN_QUOTA_BYTES - QUOTA_HEADROOM_BYTES, 1).allowed === false);
check('quota design 15GiB', DESIGN_QUOTA_BYTES === 15 * 1024 * 1024 * 1024 && QUOTA_HEADROOM_BYTES === 512 * 1024 * 1024);

// --- لقطة المراقبة ---
const snap = buildMonitoringSnapshot({
  state: 'synced', lastSyncAt: 'T', lastChangeAt: 'T', commit: 'c', treeHash: 'h',
  versionSizeBytes: 10, fileCount: 2, restorePointCount: 3, lastDbBackupAt: 'T', dbEncrypted: true,
  secretScan: { ok: true, findings: 0 }, currentIntegrity: { verified: true, detail: null },
  quota: { usageBytes: 10, designBytes: DESIGN_QUOTA_BYTES, headroomBytes: QUOTA_HEADROOM_BYTES },
  lastError: null, lastCheckAt: 'T', authorized: true,
});
const requiredKeys = ['state', 'lastSyncAt', 'lastChangeAt', 'commit', 'treeHash', 'versionSizeBytes', 'restorePointCount', 'lastDbBackupAt', 'dbEncrypted', 'secretScan', 'currentIntegrity', 'quota', 'lastError', 'lastCheckAt'];
check('monitoring has all fields', requiredKeys.every((k) => k in snap));
check('monitoring no secret', !/token|secret|refresh/i.test(JSON.stringify(snap).replace(/secretScan/g, '')));

// --- الفحص الساعي (قراءة فقط) ---
check('hourly ok', hourlySafetyCheck({ authorized: true, currentIntegrity: true }).ok === true);
check('hourly read-only', hourlySafetyCheck({ authorized: true }).readOnly === true);
check('hourly detects unauthorized', hourlySafetyCheck({ authorized: false }).issues.some((i) => i.code === 'not_authorized'));
check('hourly detects secret', hourlySafetyCheck({ authorized: true, secretFinding: true }).issues.some((i) => i.code === 'secret_detected'));
check('hourly detects quota', hourlySafetyCheck({ authorized: true, quotaExceeded: true }).issues.some((i) => i.code === 'quota_exceeded'));
check('hourly detects tree mismatch', hourlySafetyCheck({ authorized: true, treeMismatch: true }).issues.some((i) => i.code === 'tree_mismatch'));
check('hourly detects raw db', hourlySafetyCheck({ authorized: true, rawDbDetected: true }).issues.some((i) => i.code === 'raw_db_detected'));

// --- بيان نقطة الاستعادة ---
const rp = buildRecoveryManifest({ id: 'rp-001', commit: RP_001_COMMIT, fileCount: 5, sizeBytes: 100 });
check('recovery manifest immutable', rp.immutable === true && rp.kind === 'recovery-point');
check('rp-001 correct', assertRp001Manifest(rp).ok === true);
check('rp-001 wrong commit rejected', assertRp001Manifest({ ...rp, commit: 'deadbeef' }).ok === false);
check('rp-001 not immutable rejected', assertRp001Manifest({ ...rp, immutable: false }).reason === 'rp001_not_immutable');
check('rp-001 constant', RP_001_COMMIT === 'dd09c32077e2cc3cc326345e8bbc740c025c14e2');

// --- ترميز أسماء Drive ---
const enc = encodeFileName('src/components/App.tsx');
check('encode filename no slash', !enc.includes('/'));
check('encode filename reversible', decodeFileName(enc) === 'src/components/App.tsx');

// --- النطاق ---
check('scope is drive.file only', DRIVE_FILE_SCOPE === 'https://www.googleapis.com/auth/drive.file');
check('full drive scope forbidden', DRIVE_FORBIDDEN_SCOPES.includes('https://www.googleapis.com/auth/drive'));

if (failures.length) {
  console.error(`DR CORE TESTS FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`DR CORE TESTS PASSED: ${passed} checks`);
