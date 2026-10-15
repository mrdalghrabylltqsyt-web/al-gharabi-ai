/**
 * F-07 — اختبار منع التكرار الدائم على Postgres حقيقي (الجدول gharabi_idempotency).
 *
 * يثبت سلوك SQL الحجز الذرّي على قاعدة حقيقية: طلبان متزامنان => حجز واحد،
 * done يمنع، failed يسمح، والحجز العالق المنتهي يُعاد حجزه — ويصمد بعد "إعادة
 * تشغيل" (محوّل جديد يقرأ نفس الجدول).
 *
 * لا يعمل إلا عند ضبط GHARABI_TEST_DATABASE_URL (قاعدة اختبار فقط، لا إنتاج).
 * بدونها يُعلن التخطي صراحةً (exit 2) ولا يفشل البناء.
 */

import { createStorageAdapter } from '../storage/adapter';
import { buildIdempotencyKey, IDEMPOTENCY_RESERVATION_TTL_MS } from '../social/idempotencyStore';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const DB_URL = (process.env.GHARABI_TEST_DATABASE_URL || '').trim();
const INHERITED = (process.env.DATABASE_URL || '').trim();

async function main(): Promise<void> {
  if (!DB_URL) {
    console.log('SKIPPED: idempotency postgres checks — GHARABI_TEST_DATABASE_URL not set (no real Postgres available).');
    process.exit(2);
  }
  if (INHERITED && DB_URL === INHERITED) {
    console.log('SKIPPED: idempotency postgres checks — GHARABI_TEST_DATABASE_URL equals the inherited DATABASE_URL (refusing to run against production).');
    process.exit(2);
  }

  const adapter = createStorageAdapter({ stateDir: '/tmp/gharabi-idem-pg', databaseUrl: DB_URL });
  await adapter.init();
  const backend = adapter.idempotencyBackend?.();
  if (!backend) {
    console.error('FAIL: Postgres adapter did not expose an idempotency backend.');
    process.exit(1);
  }

  const now = Date.now();
  const key = buildIdempotencyKey({ platform: 'facebook', operation: 'comment_reply', targetId: 'PG_C1' });

  // 1) حجز أول ينجح.
  check('حجز أول على Postgres ينجح', (await backend.reserve(key, now, now + IDEMPOTENCY_RESERVATION_TTL_MS)) === true);
  check('السجل محجوز بحالة reserved', (await backend.read(key))?.status === 'reserved');

  // 2) طلبان متزامنان لنفس المفتاح => حجز واحد فقط.
  const key2 = buildIdempotencyKey({ platform: 'instagram', operation: 'message_reply', targetId: 'PG_IG1' });
  const [c1, c2] = await Promise.all([
    backend.reserve(key2, now, now + IDEMPOTENCY_RESERVATION_TTL_MS),
    backend.reserve(key2, now, now + IDEMPOTENCY_RESERVATION_TTL_MS),
  ]);
  check('حجز واحد فقط من طلبين متزامنين (Postgres)', [c1, c2].filter(Boolean).length === 1, `c1=${c1} c2=${c2}`);

  // 3) done يمنع إعادة الحجز.
  await backend.finish(key, 'done', Date.now());
  check('done يمنع إعادة الحجز', (await backend.reserve(key, Date.now(), Date.now() + IDEMPOTENCY_RESERVATION_TTL_MS)) === false);
  check('الحالة done', (await backend.read(key))?.status === 'done');

  // 4) failed يسمح بإعادة المحاولة.
  const key3 = buildIdempotencyKey({ platform: 'telegram', operation: 'message_reply', targetId: 'PG_T1' });
  await backend.reserve(key3, now, now + IDEMPOTENCY_RESERVATION_TTL_MS);
  await backend.finish(key3, 'failed', Date.now());
  check('failed يسمح بإعادة الحجز', (await backend.reserve(key3, Date.now(), Date.now() + IDEMPOTENCY_RESERVATION_TTL_MS)) === true);

  // 5) حجز عالق منتهي المدة => يُعاد حجزه (نحجز بمدة انتهت بالفعل).
  const key4 = buildIdempotencyKey({ platform: 'youtube', operation: 'comment_reply', targetId: 'PG_Y1' });
  const past = Date.now() - 60_000;
  check('حجز بمدة منتهية (عالق) ينجح', (await backend.reserve(key4, past, past)) === true);
  check('الحجز العالق المنتهي يُعاد حجزه', (await backend.reserve(key4, Date.now(), Date.now() + IDEMPOTENCY_RESERVATION_TTL_MS)) === true);

  // 6) الثبات بعد "إعادة تشغيل": محوّل جديد (عملية جديدة) يقرأ نفس الجدول.
  const key5 = buildIdempotencyKey({ platform: 'facebook', operation: 'publish', targetId: 'POST_PG', contentId: 'POST_PG' });
  await backend.reserve(key5, now, now + IDEMPOTENCY_RESERVATION_TTL_MS);
  await backend.finish(key5, 'done', Date.now());
  const adapter2 = createStorageAdapter({ stateDir: '/tmp/gharabi-idem-pg-2', databaseUrl: DB_URL });
  await adapter2.init();
  const backend2 = adapter2.idempotencyBackend?.();
  check('الحجز الدائم يصمد في محوّل جديد (إعادة تشغيل محاكاة)', (await backend2!.reserve(key5, Date.now(), Date.now() + IDEMPOTENCY_RESERVATION_TTL_MS)) === false);
  check('الحالة done مصمد بعد إعادة التشغيل', (await backend2!.read(key5))?.status === 'done');

  console.log(`PASSED: ${passed} idempotency-postgres checks`);
  if (failures.length) {
    console.error('FAILURES:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
