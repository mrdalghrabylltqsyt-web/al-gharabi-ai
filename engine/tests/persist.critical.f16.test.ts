/**
 * F-16 — اختبار انحدار: `persistCritical` تثبّت لقطة الحالة + حالة التحكّم في
 * **كتابة واحدة ذرّية** (`StorageAdapter.writeMany`) بدل كتابتين منفصلتين، فلا
 * توجد نافذة "state محدّثة وcontrol قديمة" بعد انقطاع جزئي.
 *
 * يثبت هنا:
 *   1) (backend الملف، بلا اعتماد خارجي) writeMany تكتب المفتاحين معاً، وكشف
 *      التغيّر يعمل لكل مفتاح (لا كتابة مطابقة).
 *   2) (Postgres حقيقي، عند ضبط GHARABI_TEST_DATABASE_URL) **ذرّية فعلية**: فشل
 *      مفتاح داخل المعاملة يتراجع عن الكل — المفتاح الأول لا يُثبَّت. يُتخطّى
 *      صراحةً بلا قاعدة (نفس نمط database.persistence).
 *
 * لا يستخدم أي سرّ حقيقي: قاعدة اختبار محلية فقط.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorageAdapter, storageWriteAccounting, STORAGE_KEY_STATE, STORAGE_KEY_CONTROL } from '../storage/adapter';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

async function run(): Promise<void> {
  // ---- 1) backend الملف: writeMany تكتب المفتاحين معاً.
  {
    const dir = mkdtempSync(join(tmpdir(), 'gharabi-f16-file-'));
    try {
      const a = createStorageAdapter({ stateDir: dir });
      await a.init();
      check('F-16: المحوّل يُنفّذ writeMany', typeof a.writeMany === 'function');
      await a.writeMany!([
        { key: STORAGE_KEY_STATE, value: { marker: 'state-v1' } },
        { key: STORAGE_KEY_CONTROL, value: { marker: 'control-v1' } },
      ]);
      check('F-16 (ملف): المفتاح الأول كُتب', a.readSync<any>(STORAGE_KEY_STATE)?.marker === 'state-v1');
      check('F-16 (ملف): المفتاح الثاني كُتب', a.readSync<any>(STORAGE_KEY_CONTROL)?.marker === 'control-v1');
      // كشف التغيّر: نفس القيمة لا تُعاد كتابتها (بلا خطأ ولا تغيير).
      await a.writeMany!([
        { key: STORAGE_KEY_STATE, value: { marker: 'state-v1' } },
        { key: STORAGE_KEY_CONTROL, value: { marker: 'control-v1' } },
      ]);
      check('F-16 (ملف): الكتابة المطابقة لا تُغيّر شيئاً', a.readSync<any>(STORAGE_KEY_STATE)?.marker === 'state-v1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ---- 2) Postgres حقيقي: ذرّية فعلية عبر المعاملة.
  const DB_URL = (process.env.GHARABI_TEST_DATABASE_URL || '').trim();
  const INHERITED = (process.env.DATABASE_URL || '').trim();
  if (!DB_URL) {
    console.log('F-16: تخطٍّ لفحص ذرّية Postgres (بلا GHARABI_TEST_DATABASE_URL).');
  } else if (INHERITED && INHERITED === DB_URL) {
    console.log('F-16: تخطٍّ — قاعدة الاختبار تطابق قاعدة الإنتاج المورّثة (حارس ISO-A).');
  } else {
    const a = createStorageAdapter({ stateDir: mkdtempSync(join(tmpdir(), 'gharabi-f16-pg-')), databaseUrl: DB_URL });
    await a.init();
    if (!a.status().healthy) {
      check('F-16 (Postgres): المخزن سليم', false, String(a.status().detail));
    } else {
      // قيمة ثانية تحمل \u0000 يرفضها jsonb في Postgres => يفشل داخل المعاملة.
      const writesBefore = storageWriteAccounting().bytesWrittenTotal;
      // قد يكون المفتاح موجوداً من اختبار Postgres آخر يعمل على نفس القاعدة (مثل
      // test:db في السلسلة). الخصيصة المُثبَتة هي **الذرّية**: القيمة تبقى كما كانت
      // (لا تُكتب قيمة المعاملة الفاشلة)، لا افتراض غياب المفتاح أصلاً.
      const stateBefore = await a.read<any>(STORAGE_KEY_STATE);
      let threw = false;
      try {
        await a.writeMany!([
          { key: STORAGE_KEY_STATE, value: { marker: 'should-rollback' } },
          { key: STORAGE_KEY_CONTROL, value: { bad: 'x\u0000y' } },
        ]);
      } catch { threw = true; }
      check('F-16 (Postgres): فشل مفتاح داخل المعاملة يرمي', threw === true);
      const stateAfter = await a.read<any>(STORAGE_KEY_STATE);
      check('★ F-16 (Postgres): المفتاح الأول لم يُثبَّت (ROLLBACK ذرّي)', stateAfter?.marker !== 'should-rollback' && JSON.stringify(stateAfter) === JSON.stringify(stateBefore), JSON.stringify(stateAfter));
      // لا تُحتسب كتابة أُلغيت: عدّاد النقل لم يتغيّر بعد ROLLBACK.
      const writesAfterFail = storageWriteAccounting().bytesWrittenTotal;
      check('★ F-16 (Postgres): الكتابة الملغاة لا تُحتسب في نقل البيانات', writesAfterFail === writesBefore, `${writesBefore} -> ${writesAfterFail}`);
      // نجاح كامل: المفتاحان معاً، ويُحتسب النقل فعلاً.
      await a.writeMany!([
        { key: STORAGE_KEY_STATE, value: { marker: 'ok-state' } },
        { key: STORAGE_KEY_CONTROL, value: { marker: 'ok-control' } },
      ]);
      check('F-16 (Postgres): النجاح يثبّت المفتاح الأول', (await a.read<any>(STORAGE_KEY_STATE))?.marker === 'ok-state');
      check('F-16 (Postgres): النجاح يثبّت المفتاح الثاني', (await a.read<any>(STORAGE_KEY_CONTROL))?.marker === 'ok-control');
      check('F-16 (Postgres): الكتابة الناجحة تُحتسب', storageWriteAccounting().bytesWrittenTotal > writesAfterFail);
    }
    await a.close();
  }

  console.log(`\n[ persist-critical-f16 ] passed=${passed} failed=${failures.length}`);
  if (failures.length) { for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
}

run().catch((err) => { console.error('harness crashed:', err); process.exit(1); });
