/**
 * اختبار ثبات ذاكرة العقل (`brainMemory`) عبر محوّل الحالة نفسه.
 *
 * الغرض: إثبات أن ذاكرة العقل الدائمة تُكتب وتُقرأ عبر **نفس عقد المحوّل** الذي
 * تستخدمه الحالة (ملف/Postgres)، وأنها تصمد بعد إعادة إنشاء طبقة التخزين، وأن
 * منع التكرار والأصل (provenance) يبقيان بعد إعادة التحميل.
 *
 * خلفيتان:
 *   - CONTRACT/ADAPTER TEST (دائماً): خلفية الملف في مجلد مؤقت — يثبت أن
 *     `brainMemory` يمر عبر عقد `StorageAdapter` نفسه (read/write/init/close).
 *   - REAL INTEGRATION TEST (عند ضبط GHARABI_TEST_DATABASE_URL فقط): نفس السيناريو
 *     على Postgres حقيقي معزول. بدون المتغير يُعلن التخطي صراحةً — لا اختراع بيانات
 *     اتصال ولا استخدام قاعدة إنتاج.
 *
 * لا سرّ هنا: المجلد المؤقت ورابط الاختبار فقط؛ لا يُطبع أي نص اتصال.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorageAdapter, type StorageAdapter } from '../storage/adapter';
import { emptyBrainMemory, upsertMemoryRecord, toMemoryRecord, activeBrainMemory, type BrainMemoryStoreState } from '../brain/memory/store';
import { makeMemoryEntry } from '../brain/memory/longTerm';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(t: string) { console.log(`\n▸ ${t}`); }

const STORAGE_KEY_BRAIN_MEMORY = 'brainMemory';
const NOW = Date.parse('2026-09-28T12:00:00Z');

/** يبني سجلَّي ذاكرة حقيقيين (أصل مختلف لكل سجل) عبر نفس منطق الإنتاج. */
function buildRecords() {
  const replyEntry = makeMemoryEntry({ id: 'pm1', kind: 'outcome', statement: 'رد مُسلَّم على YouTube', origin: 'derived', source: 'youtube — سجل الردود', now: NOW, sampleSize: 1, platform: 'youtube', sourceRefs: ['socialReplies'], summary: 'رد مُسلَّم بمعرّف حقيقي' });
  const ownerEntry = makeMemoryEntry({ id: 'pm2', kind: 'business', statement: 'تفضيل المالك: تسليط الضوء على التقسيط', origin: 'owner_input', source: 'إدخال المالك', now: NOW, sampleSize: 1, sourceRefs: ['ownerInput'], summary: 'تفضيل مالك مسجّل' });
  return [toMemoryRecord(replyEntry), toMemoryRecord(ownerEntry)];
}

/** نفس ما يفعله الخادم: normalize + upsert (منع تكرار) ثم لقطة للحفظ. */
function insertRecords(store: BrainMemoryStoreState, records: ReturnType<typeof buildRecords>) {
  let s = store;
  let added = 0;
  for (const r of records) {
    const res = upsertMemoryRecord(s, r);
    s = res.store;
    if (res.added) added += 1;
  }
  return { store: s, added };
}

async function runScenario(makeAdapter: () => StorageAdapter, label: string) {
  group(label);
  // 1) إنشاء طبقة تخزين + كتابة brainMemory.
  let adapter = makeAdapter();
  await adapter.init();
  check(`${label}: المحوّل مهيّأ`, adapter.status().healthy, JSON.stringify(adapter.status()));

  const { store, added } = insertRecords(emptyBrainMemory(), buildRecords());
  check(`${label}: إدراج سجلين لأول مرة`, added === 2 && store.records.length === 2);
  await adapter.write(STORAGE_KEY_BRAIN_MEMORY, { records: store.records });

  // 2) قراءة brainMemory من نفس الطبقة.
  const readBack = await adapter.read<BrainMemoryStoreState>(STORAGE_KEY_BRAIN_MEMORY);
  check(`${label}: القراءة تُعيد السجلين`, (readBack?.records.length ?? 0) === 2);

  // 3) إعادة إنشاء طبقة التخزين (محاكاة restart/cold start).
  await adapter.close();
  adapter = makeAdapter();
  await adapter.init();

  // 4) قراءة الذاكرة مجدداً بعد إعادة الإنشاء.
  const afterRestart = await adapter.read<BrainMemoryStoreState>(STORAGE_KEY_BRAIN_MEMORY);
  // 5) الذاكرة تبقى.
  check(`${label}: ★ الذاكرة تصمد بعد إعادة إنشاء الطبقة`, (afterRestart?.records.length ?? 0) === 2, `got=${afterRestart?.records.length}`);

  // 6) إعادة إدراج نفس المضمون (بمعرّف جديد) لا يُنتج تكراراً.
  const dupInput = buildRecords().map((r) => ({ ...r, id: `${r.id}-dup` }));
  const { added: dupAdded } = insertRecords({ records: afterRestart?.records ?? [] }, dupInput);
  check(`${label}: ★ التكرار لا يُضاف (منع التكرار)`, dupAdded === 0);

  // 7) الأصل (provenance) يبقى بعد إعادة التحميل.
  const records = afterRestart?.records ?? [];
  const reply = records.find((r) => r.id === 'pm1');
  const owner = records.find((r) => r.id === 'pm2');
  check(`${label}: ★ الأصل محفوظ (derived + sourceRefs)`, reply?.origin === 'derived' && (reply?.sourceRefs.includes('socialReplies') ?? false));
  check(`${label}: ★ أصل إدخال المالك محفوظ`, owner?.origin === 'owner_input' && (owner?.sourceRefs.includes('ownerInput') ?? false));
  check(`${label}: الذاكرة النشطة تُقرأ بلا تقادم`, activeBrainMemory({ records }).length === 2);

  await adapter.close();
}

async function run(): Promise<void> {
  const dbUrl = (process.env.GHARABI_TEST_DATABASE_URL || '').trim();
  const dir = mkdtempSync(join(tmpdir(), 'gharabi-brain-mem-'));
  const fileDir = join(dir, 'file-backend');

  try {
    // --- CONTRACT/ADAPTER TEST (يعمل دائماً) ---
    await runScenario(
      () => createStorageAdapter({ stateDir: fileDir, ephemeralHost: false }),
      'CONTRACT/ADAPTER — خلفية الملف (نفس عقد StorageAdapter)',
    );

    // --- REAL INTEGRATION TEST (Postgres حقيقي معزول، عند توفره فقط) ---
    if (!dbUrl) {
      console.log('\nSKIPPED: brain memory Postgres integration — GHARABI_TEST_DATABASE_URL not set (no isolated test Postgres available).');
      console.log('   شغّله على Postgres حقيقي عبر: cd tools/local-verification && npm install && npm run verify:brain-memory');
    } else {
      await runScenario(
        () => createStorageAdapter({ stateDir: fileDir, databaseUrl: dbUrl }),
        'REAL INTEGRATION — Postgres معزول (نفس العقد)',
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASSED: ${passed} brain memory persistence checks`);
  }
}

run().catch((err) => {
  console.error('brain memory persistence test crashed:', err?.message || err);
  process.exitCode = 1;
});
