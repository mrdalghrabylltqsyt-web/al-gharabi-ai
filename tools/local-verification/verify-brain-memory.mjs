/**
 * تحقق محلي لثبات ذاكرة العقل (`brainMemory`) على Postgres حقيقي معزول.
 *
 * يقلع قاعدة بيانات مدمجة (embedded-postgres، أداة تطوير فقط، ليست تبعية إنتاج
 * ولا تُثبَّت في Render/CI)، ثم يشغّل اختبار brain.memory.persistence على نفس
 * عقد المحوّل الحقيقي. لا يُستخدم أي قاعدة إنتاج ولا أي بيانات اتصال حقيقية.
 *
 * الاستخدام:
 *   cd tools/local-verification && npm install && npm run verify:brain-memory
 */
import EmbeddedPostgres from 'embedded-postgres';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const PORT = 55440 + Math.floor(Math.random() * 50);
const password = crypto.randomBytes(12).toString('hex');
const user = 'postgres';
const dbName = 'gharabi_test';
const dataDir = mkdtempSync(join(tmpdir(), 'gharabi-embedded-pg-brain-'));

const db = new EmbeddedPostgres({ databaseDir: dataDir, user, password, port: PORT, persistent: false });

async function main() {
  await db.initialise();
  await db.start();
  await db.createDatabase(dbName);
  // القاعدة المدمجة محلية بلا TLS؛ sslmode=disable يلغي فرض TLS صراحةً للاختبار.
  const url = `postgresql://${user}:${password}@127.0.0.1:${PORT}/${dbName}?sslmode=disable`;
  try {
    const res = spawnSync('npx', ['tsx', 'engine/tests/brain.memory.persistence.test.ts'], {
      stdio: 'inherit',
      cwd: REPO_ROOT,
      env: { ...process.env, GHARABI_TEST_DATABASE_URL: url },
    });
    if (res.status !== 0) process.exitCode = res.status ?? 1;
  } finally {
    await db.stop().catch(() => { /* تجاهل */ });
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Embedded Postgres harness crashed:', err?.message || err);
  process.exit(1);
});
