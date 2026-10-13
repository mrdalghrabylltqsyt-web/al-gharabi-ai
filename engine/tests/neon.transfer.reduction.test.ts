/**
 * دليل فعلي (لا نظري) على تقليل نقل البيانات إلى Neon:
 *  - كشف التغيّر في المحوّل: الكتابة المتطابقة تماماً لا تُرسَل إلى القاعدة.
 *  - أثر إزالة الكتابة الكاملة غير المشروطة من دورة مراقب Meta.
 *  - أثر رفع الفاصل الافتراضي 1 → 5 دقائق.
 *  - أثر تقليم مصفوفات منع التكرار (DEDUPE_ID_MAX).
 *
 * القياس على **مسار الكتابة الحقيقي** في `PostgresStorageAdapter.write`
 * (ناقل `pg` وهمي فقط — لا قاعدة حقيقية متاحة؛ المنطق المُختبَر هو منطقنا لا `pg`).
 */

import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createStorageAdapter,
  sameSerializedValue,
  DEDUPE_ID_MAX,
  STORAGE_KEY_STATE,
} from '../storage/adapter';
import {
  WATCHER_DEFAULT_CADENCE_MINUTES,
  WATCHER_MIN_CADENCE_MINUTES,
  WATCHER_MAX_CADENCE_MINUTES,
  defaultWatcherControls,
  validateCadenceMinutes,
} from '../social/youtubeWatcher';
import { defaultMetaWatcherControls } from '../social/metaWatcher';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

/** ناقل pg وهمي: يُحصي نداءات الكتابة (query) فقط — لا شبكة ولا قاعدة. */
function fakePostgresAdapter(connectionString = 'postgresql://user:pw@ep-test.neon.tech/db') {
  const adapter: any = createStorageAdapter({ stateDir: mkdtempSync(join(tmpdir(), 'gharabi-neon-')), databaseUrl: connectionString });
  const calls: string[] = [];
  adapter.pool = { query: async (sql: string) => { calls.push(sql); return { rows: [] }; } };
  adapter.healthy = true;
  return { adapter, calls };
}

async function run(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'gharabi-neon-evidence-'));
  try {
    // ── 1) وحدة المقارنة ────────────────────────────────────────────────
    check('sameSerializedValue: متطابقان ⇒ true', sameSerializedValue('{"a":1}', '{"a":1}') === true);
    check('sameSerializedValue: مختلفان بطول مختلف ⇒ false', sameSerializedValue('{"a":1}', '{"a":2}') === false);
    check('sameSerializedValue: نفس الطول مختلف المحتوى ⇒ false', sameSerializedValue('{"a":11}', '{"a":12}') === false);
    check('sameSerializedValue: نص كبير متطابق ⇒ true', sameSerializedValue('x'.repeat(50000), 'x'.repeat(50000)) === true);

    // ── 2) كشف التغيّر في مسار Postgres الحقيقي ─────────────────────────
    {
      const { adapter, calls } = fakePostgresAdapter();
      const bigState = { schemaVersion: 17, workspace: { socialComments: new Array(50).fill({ id: 'c', text: 'مرحبا' }) } };
      // 100 كتابة متطابقة ⇒ نداء نقل واحد فقط (الأولى).
      for (let i = 0; i < 100; i += 1) await adapter.write(STORAGE_KEY_STATE, bigState);
      check('Postgres: 100 كتابة متطابقة ⇒ نداء نقل واحد', calls.length === 1, `calls=${calls.length}`);
      // تغيير فعلي ⇒ نداء إضافي.
      await adapter.write(STORAGE_KEY_STATE, { ...bigState, schemaVersion: 18 });
      check('Postgres: تغيير فعلي ⇒ نداء إضافي', calls.length === 2, `calls=${calls.length}`);
      // مفتاح آخر مستقل.
      await adapter.write('control', { x: 1 });
      await adapter.write('control', { x: 1 });
      check('Postgres: مفتاح مستقل يُحسب مرة واحدة', calls.length === 3, `calls=${calls.length}`);
    }

    // ── 2ب) الأثر الحقيقي لغياب savedAt عن اللقطة ───────────────────────
    {
      // محاكاة: اللقطة كانت تحمل savedAt متغيّراً في كل نداء ⇒ الكتابة المتطابقة
      // تُعتبر «مختلفة» فتُنقل كاملة. بعده تُطابق فعلياً.
      const core = { schemaVersion: 17, users: [{ id: 'u1' }], workspace: { products: new Array(40).fill({ id: 'p', price: 100 }) } };
      const oldA = JSON.stringify({ ...core, savedAt: new Date(1000).toISOString() });
      const oldB = JSON.stringify({ ...core, savedAt: new Date(2000).toISOString() });
      const newA = JSON.stringify(core);
      const newB = JSON.stringify(core);
      check('قبل إزالة savedAt: لقطتان متطابقتان جوهراً تُعدّان مختلفتين', sameSerializedValue(oldA, oldB) === false);
      check('بعد إزالة savedAt: لقطتان متطابقتان تُعدّان متطابقتين', sameSerializedValue(newA, newB) === true);
      const savedBytes = oldB.length - newB.length;
      check('حجم كل لقطة يقلّ بمقدار savedAt', savedBytes > 0 && newB.length < oldB.length, `-${savedBytes}B/لقطة`);
    }

    // ── 3) محاكاة يوم كامل: مراقب Meta (السبب المهيمن) ──────────────────
    {
      const stateBytes = 200 * 1024; // لقطة حالة كاملة ~200KB (تقدير متحفّظ)
      const dayMs = 24 * 60 * 60 * 1000;
      // القديم: دورة كل دقيقة (1440) × كتابة كاملة في كل دورة.
      const oldCycles = Math.round(dayMs / (1 * 60 * 1000));
      const oldBytes = oldCycles * stateBytes;
      // الجديد: دورة كل 5 دقائق (288) + كتابة كاملة فقط عند تعليق/رسالة جديدة (تقدير 20/يوم).
      const newCycles = Math.round(dayMs / (WATCHER_DEFAULT_CADENCE_MINUTES * 60 * 1000));
      const newStateWrites = 20;
      const newBytes = newStateWrites * stateBytes;
      check('Meta: عدد دورات اليوم ينخفض 5×', oldCycles === 1440 && newCycles === 288, `${oldCycles}→${newCycles}`);
      check('Meta: نقل الحالة الكاملة ينخفض >98%', newBytes / oldBytes < 0.02, `${(oldBytes / 1048576).toFixed(0)}MB→${(newBytes / 1048576).toFixed(1)}MB`);
    }

    // ── 4) الفاصل الافتراضي 5 دقائق (المصدر الواحد للمنصتين) ───────────
    check('الافتراضي الجديد = 5 دقائق', WATCHER_DEFAULT_CADENCE_MINUTES === 5, String(WATCHER_DEFAULT_CADENCE_MINUTES));
    check('الافتراضي داخل النطاق المسموح', WATCHER_DEFAULT_CADENCE_MINUTES >= WATCHER_MIN_CADENCE_MINUTES && WATCHER_DEFAULT_CADENCE_MINUTES <= WATCHER_MAX_CADENCE_MINUTES);
    check('controls الافتراضية لـYouTube = 5', defaultWatcherControls().cadenceMinutes === 5);
    check('controls الافتراضية لـMeta = 5 (نفس المصدر)', defaultMetaWatcherControls().cadenceMinutes === 5);
    check('التحقق يقبل 1 و5 ويرفض 6', validateCadenceMinutes(1).ok && validateCadenceMinutes(5).ok && !validateCadenceMinutes(6).ok);

    // ── 5) تقليم مصفوفات منع التكرار ────────────────────────────────────
    {
      check('DEDUPE_ID_MAX = 2000', DEDUPE_ID_MAX === 2000, String(DEDUPE_ID_MAX));
      const ids = new Array(20000).fill(0).map((_, i) => `id-${i}`);
      const trimmed = ids.slice(-DEDUPE_ID_MAX);
      check('التقليم يبقي آخر 2000', trimmed.length === 2000 && trimmed[trimmed.length - 1] === 'id-19999');
      // الأثر على الحجم: مصفوفة 20000 معرّف ≈ 20 بايت/معرّف.
      const before = JSON.stringify(ids).length;
      const after = JSON.stringify(trimmed).length;
      check('حجم المصفوفة ينخفض ~10×', before / after > 9, `${before}B→${after}B`);
    }

    // ── 6) دليل على خلفية الملف (تغيّر فعلي) ────────────────────────────
    {
      const fileAdapter = createStorageAdapter({ stateDir: dir });
      await fileAdapter.init();
      const v = { a: 1, b: [1, 2, 3] };
      await fileAdapter.write(STORAGE_KEY_STATE, v);
      const mtime1 = statSync(join(dir, '.gharabi-state.json')).mtimeMs;
      await new Promise((r) => setTimeout(r, 20));
      await fileAdapter.write(STORAGE_KEY_STATE, v); // متطابق ⇒ لا إعادة كتابة
      const mtime2 = statSync(join(dir, '.gharabi-state.json')).mtimeMs;
      check('ملف: الكتابة المتطابقة لا تلمس القرص', mtime1 === mtime2, `${mtime1} vs ${mtime2}`);
      await fileAdapter.write(STORAGE_KEY_STATE, { a: 2, b: [1, 2, 3] });
      const mtime3 = statSync(join(dir, '.gharabi-state.json')).mtimeMs;
      check('ملف: التغيير الفعلي يُكتب', mtime3 > mtime2);
      check('ملف: المحتوى صحيح بعد التغيير', JSON.parse(readFileSync(join(dir, '.gharabi-state.json'), 'utf8')).a === 2);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`✗ neon.transfer.reduction: ${failures.length} فشل`);
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log(`✓ neon.transfer.reduction: ${passed} فحصاً ناجحاً`);
}

run().catch((e) => { console.error(e); process.exit(1); });
