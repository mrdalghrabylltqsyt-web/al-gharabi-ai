/**
 * اختبار محوّل التخزين (backend الملف) — بلا أي اعتماد خارجي.
 *
 * يثبت أن الواجهة الموحدة تعمل: كتابة ذرّية، قراءة، استبدال، النسخ الاحتياطية
 * اليومية بحفظ 7، وحالة صريحة. كما يثبت أن الاختيار التلقائي بين الملف و
 * Postgres يتم بناءً على وجود DATABASE_URL فقط.
 */

import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createStorageAdapter,
  STORAGE_KEY_STATE,
  STORAGE_KEY_USAGE,
} from '../storage/adapter';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

async function run(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'gharabi-storage-'));
  try {
    const adapter = createStorageAdapter({ stateDir: dir });
    check('الاختيار التلقائي: بلا DATABASE_URL => ملف', adapter.backend === 'file');
    check('الاختيار التلقائي: ملف دائم افتراضاً', adapter.durable === true);

    await adapter.init();
    const statusBefore = adapter.status();
    check('الحالة بعد التهيئة: قابل للكتابة', statusBefore.writable === true, JSON.stringify(statusBefore));
    check('الحالة تعلن الخلفية الصحيحة', statusBefore.backend === 'file' && statusBefore.stateDir === dir);
    check('لا قراءة قبل أي كتابة تعيد null', adapter.readSync(STORAGE_KEY_STATE) === null);

    // كتابة أولى ثم قراءة.
    const first = { schemaVersion: 16, marker: 'first', nested: { a: 1 } };
    await adapter.write(STORAGE_KEY_STATE, first);
    check('القراءة المتزامنة تعيد ما كُتب', adapter.readSync<any>(STORAGE_KEY_STATE)?.marker === 'first');
    check('القراءة غير المتزامنة تعيد نفس المحتوى', (await adapter.read<any>(STORAGE_KEY_STATE))?.nested?.a === 1);

    // استبدال ذرّي: لا ملفات مؤقتة متروكة.
    const second = { schemaVersion: 16, marker: 'second' };
    await adapter.write(STORAGE_KEY_STATE, second);
    check('الاستبدال الذرّي يعيد أحدث قيمة', adapter.readSync<any>(STORAGE_KEY_STATE)?.marker === 'second');
    check('لا يبقى ملف مؤقت بعد الكتابة', !existsSync(join(dir, '.gharabi-state.json.tmp')));

    // نسخة احتياطية يومية واحدة، ولا تُستبدل في اليوم نفسه.
    const backupsDir = join(dir, '.gharabi-backups');
    check('أُنشئ مجلد النسخ الاحتياطية', existsSync(backupsDir));
    const backups = adapter.listBackups();
    check('نسخة احتياطية يومية واحدة', backups.length === 1, JSON.stringify(backups));

    // أنشئ 10 نسخ بأسماء تواريخ مختلفة ثم تحقق أن السقف 7 عند كتابة جديدة.
    for (let i = 0; i < 10; i += 1) {
      const day = String(i).padStart(2, '0');
      writeFileSync(join(backupsDir, `state-2026-01-${day}.json`), '{}');
    }
    await adapter.write(STORAGE_KEY_STATE, { marker: 'third' });
    check('التقليم يُبقي 7 نسخ على الأكثر', adapter.listBackups().length <= 7, `count=${adapter.listBackups().length}`);

    // مفتاح الاستخدام مستقل عن الحالة.
    await adapter.write(STORAGE_KEY_USAGE, { day: '2026-09-20', count: 3 });
    check('مفتاح الاستخدام يُخزَّن منفصلاً', adapter.readSync<any>(STORAGE_KEY_USAGE)?.count === 3);
    check('الحالة لم تتأثر بكتابة الاستخدام', adapter.readSync<any>(STORAGE_KEY_STATE)?.marker === 'third');

    // النسخة الاحتياطية عند نقطة الكتابة تحفظ اللقطة السابقة لا اللاحقة.
    const today = new Date().toISOString().slice(0, 10);
    const todayBackup = join(backupsDir, `state-${today}.json`);
    check('نسخة اليوم تحمل لقطة سابقة للحالة', existsSync(todayBackup) && !readFileSync(todayBackup, 'utf8').includes('third'));

    await adapter.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // مجلد للقراءة فقط: الحالة تُعلن عدم القدرة على الكتابة بصراحة.
  const roDir = mkdtempSync(join(tmpdir(), 'gharabi-ro-'));
  try {
    const { chmodSync } = await import('node:fs');
    chmodSync(roDir, 0o555);
    const roAdapter = createStorageAdapter({ stateDir: join(roDir, 'nested') });
    await roAdapter.init();
    const roStatus = roAdapter.status();
    check('مجلد غير قابل للكتابة: الحالة صريحة غير قابلة للكتابة', roStatus.writable === false && roStatus.healthy === false, JSON.stringify(roStatus));
    check('مجلد غير قابل للكتابة: يوجد سبب معلن', typeof roStatus.detail === 'string' && roStatus.detail.length > 0);
  } finally {
    const { chmodSync } = await import('node:fs');
    try { chmodSync(roDir, 0o755); } catch { /* تجاهل */ }
    rmSync(roDir, { recursive: true, force: true });
  }

  // اختيار الخلفية عند وجود DATABASE_URL (لا يتصل هنا، فقط الاختيار).
  const pg = createStorageAdapter({ stateDir: dir, databaseUrl: 'postgresql://user:secret@host/db' });
  check('وجود DATABASE_URL => خلفية Postgres', pg.backend === 'postgres');
  check('Postgres غير مهيّأ => غير دائم حتى يثبت الاتصال', pg.durable === false);
  check('حالة Postgres الأولية لا تسرّب قيمة الاتصال', !JSON.stringify(pg.status()).includes('secret'));

  // مضيف بلا قرص دائم (Render Free): الملف المحلي لا يجوز أن يدّعي الدوام.
  const ephemeral = createStorageAdapter({ stateDir: dir, ephemeralHost: true });
  await ephemeral.init();
  check('★ مضيف بقرص عابر + بلا DATABASE_URL => durable=false', ephemeral.durable === false);
  check('★ لكن الكتابة ما زالت ممكنة', ephemeral.status().writable === true && ephemeral.status().healthy === true);
  check('مضيف دائم (تطوير) => durable=true', createStorageAdapter({ stateDir: dir }).durable === true);

  // كشف المضيفات العابرة: Render/Heroku/Lambda/Netlify.
  const { isEphemeralHost } = await import('../storage/adapter');
  check('RENDER=true يُكتشف كمضيف عابر', isEphemeralHost({ RENDER: 'true' } as any) === true);
  check('DYNO يُكتشف كمضيف عابر', isEphemeralHost({ DYNO: 'web.1' } as any) === true);
  check('بيئة فارغة ليست عابرة', isEphemeralHost({} as any) === false);

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} storage adapter checks`);
  }
}

run().catch((err) => {
  console.error('Storage adapter harness crashed:', err);
  process.exit(1);
});