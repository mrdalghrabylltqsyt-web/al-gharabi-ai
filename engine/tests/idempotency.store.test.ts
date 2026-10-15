/**
 * F-07 — اختبار وحدة لمخزن منع التكرار الدائم (idempotency store).
 *
 * يغلق نتيجة التدقيق HIGH #7: كان منع تكرار الرد والنشر داخل العملية فقط
 * (`replyInFlightLock`)، فلا يصمد بعد إعادة التشغيل ولا عبر نسختين. هنا نثبت
 * منطق الحجز/الإنهاء/الحجز العالق/الفشل القابل لإعادة المحاولة على خلفية في
 * الذاكرة تحاكي خلفية الملف/Postgres (نفس دوال الخريطة التي يستخدمها المحوّل).
 */
import {
  buildIdempotencyKey,
  decideReservation,
  isStaleReservation,
  applyReservationToMap,
  applyFinishToMap,
  createIdempotencyGuard,
  reservationAllowsExecution,
  IDEMPOTENCY_RESERVATION_TTL_MS,
  IDEMPOTENCY_TABLE,
  type IdempotencyRecord,
  type IdempotencyBackend,
} from '../social/idempotencyStore';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

/** خلفية في الذاكرة تُحاكي خلفية الملف/Postgres (نفس دوال الخريطة). */
function memoryBackend(): IdempotencyBackend & { records: Record<string, IdempotencyRecord> } {
  const records: Record<string, IdempotencyRecord> = {};
  return {
    records,
    reserve: async (key, nowMs, expiresAtMs) => applyReservationToMap(records, key, nowMs, expiresAtMs),
    finish: async (key, status, nowMs) => applyFinishToMap(records, key, status, nowMs),
    read: async (key) => records[key] || null,
  };
}

// 1) بناء المفتاح: المنصة + العملية + معرّف الهدف، وللنشر معرّف المحتوى الداخلي.
{
  check('المفتاح يضمّ المنصة والعملية والهدف',
    buildIdempotencyKey({ platform: 'facebook', operation: 'comment_reply', targetId: 'C1' }) === 'facebook:comment_reply:C1');
  check('الحالة لا تفرّق (تطبيع)',
    buildIdempotencyKey({ platform: 'Facebook', operation: 'comment_reply', targetId: 'C1' }) === 'facebook:comment_reply:C1');
  check('النشر يضمّ معرّف المحتوى عند اختلافه عن الهدف',
    buildIdempotencyKey({ platform: 'instagram', operation: 'publish', targetId: 'POST1', contentId: 'POST2' }) === 'instagram:publish:POST1:content:POST2');
  check('لا تكرار لمعرّف المحتوى إن طابق الهدف',
    buildIdempotencyKey({ platform: 'instagram', operation: 'publish', targetId: 'POST1', contentId: 'POST1' }) === 'instagram:publish:POST1');
  check('مفتاح التكرار (المتابعة) يُميّز المفتاح',
    buildIdempotencyKey({ platform: 'facebook', operation: 'comment_reply', targetId: 'C1', idempotencyKey: 'fu1' }) === 'facebook:comment_reply:C1:idem:fu1');
  check('هدف فارغ لا يُنتج مفتاحاً ملتبساً',
    buildIdempotencyKey({ platform: 'telegram', operation: 'message_reply', targetId: '' }) === 'telegram:message_reply:no-target');
}

// 2) قرار الحجز (منطق صافٍ مطابق لـSQL الحجز الذرّي).
{
  const now = 1_000_000_000_000;
  check('لا سجل => حجز', decideReservation(null, now).reason === 'no_record');
  check('done => رفض', decideReservation({ key: 'k', status: 'done', createdAt: '', updatedAt: '', expiresAt: '' }, now).reason === 'already_done');
  check('failed => إعادة محاولة', decideReservation({ key: 'k', status: 'failed', createdAt: '', updatedAt: '', expiresAt: '' }, now).reason === 'retry_after_failure');
  check('reserved حيّ => رفض', decideReservation({ key: 'k', status: 'reserved', createdAt: '', updatedAt: '', expiresAt: new Date(now + 60_000).toISOString() }, now).reason === 'in_progress');
  check('reserved عالق => حجز', decideReservation({ key: 'k', status: 'reserved', createdAt: '', updatedAt: '', expiresAt: new Date(now - 1).toISOString() }, now).reason === 'stale_reservation');
  check('طابع تالف يُعتبر عالقاً', isStaleReservation({ status: 'reserved', expiresAt: 'not-a-date' }, now) === true);
}

// 3) طلبان متزامنان لنفس المفتاح => حجز واحد فقط (إغلاق السباق).
async function raceTests(): Promise<void> {
  const backend = memoryBackend();
  const guard = createIdempotencyGuard(backend);
  const key = buildIdempotencyKey({ platform: 'facebook', operation: 'comment_reply', targetId: 'C1' });
  const [a, b] = await Promise.all([guard.reserve(key), guard.reserve(key)]);
  const allowedCount = [a, b].filter((r) => reservationAllowsExecution(r)).length;
  check('حجز واحد فقط من طلبين متزامنين', allowedCount === 1, `allowed=${allowedCount}`);
  check('المرفوض سببه قيد التنفيذ', [a, b].some((r) => r.reason === 'in_progress'));
}

// 4) done => لا نداء ثانٍ (يصمد بعد "إعادة التشغيل" لأن الخلفية نفسها تُقرأ ثانيةً).
async function doneBlocksRepeat(): Promise<void> {
  const backend = memoryBackend();
  const guard = createIdempotencyGuard(backend);
  const key = buildIdempotencyKey({ platform: 'youtube', operation: 'comment_reply', targetId: 'Y1' });
  const first = await guard.reserve(key);
  check('أول حجز مسموح', reservationAllowsExecution(first));
  await guard.complete(key, 'done');
  // "إعادة تشغيل": غلاف جديد يقرأ نفس الخلفية (كما يقرأ Postgres/الملف بعد restart).
  const guard2 = createIdempotencyGuard(backend);
  const again = await guard2.reserve(key);
  check('بعد done لا يُسمح بإعادة التنفيذ (لا نداء ثانٍ)', !reservationAllowsExecution(again), JSON.stringify(again));
  check('سبب الرفض already_done', again.reason === 'already_done');
}

// 5) failed => إعادة محاولة مسموحة (فشل مؤكد لا يمنع الإصلاح لاحقاً).
async function failedAllowsRetry(): Promise<void> {
  const backend = memoryBackend();
  const guard = createIdempotencyGuard(backend);
  const key = buildIdempotencyKey({ platform: 'telegram', operation: 'message_reply', targetId: 'M1' });
  await guard.reserve(key);
  await guard.complete(key, 'failed');
  const retry = await guard.reserve(key);
  check('فشل مؤكد => إعادة المحاولة مسموحة', reservationAllowsExecution(retry), JSON.stringify(retry));
}

// 6) الحجز العالق المنتهي => يُعاد حجزه (منطق صافٍ على الخريطة بمدة صريحة).
function staleReservationReusable(): void {
  const records: Record<string, IdempotencyRecord> = {};
  const key = buildIdempotencyKey({ platform: 'instagram', operation: 'message_reply', targetId: 'IGM1' });
  const now = 1_000_000_000_000;
  // حجز أول بمدة 10 دقائق.
  check('الحجز الأول مسموح', applyReservationToMap(records, key, now, now + IDEMPOTENCY_RESERVATION_TTL_MS) === true);
  // قبل الانتهاء: حجز ثانٍ يُرفض (قيد التنفيذ).
  check('قبل الانتهاء يُرفض الحجز', applyReservationToMap(records, key, now + 60_000, now + 60_000 + IDEMPOTENCY_RESERVATION_TTL_MS) === false);
  // بعد انتهاء المدة: الحجز العالق يُعاد حجزه.
  const after = now + IDEMPOTENCY_RESERVATION_TTL_MS + 1;
  check('الحجز العالق المنتهي يُعاد حجزه', applyReservationToMap(records, key, after, after + IDEMPOTENCY_RESERVATION_TTL_MS) === true);
  check('السجل الآن reserved بوقت انتهاء جديد', records[key].status === 'reserved' && records[key].expiresAt === new Date(after + IDEMPOTENCY_RESERVATION_TTL_MS).toISOString());
}

// 7) تعذّر الخلفية => fail-open موثّق (لا إسقاط كل رد بسبب مخزن متعذّر).
async function backendUnavailableFailOpen(): Promise<void> {
  const broken: IdempotencyBackend = {
    reserve: async () => { throw new Error('db down'); },
    finish: async () => { throw new Error('db down'); },
    read: async () => { throw new Error('db down'); },
  };
  const guard = createIdempotencyGuard(broken);
  const r = await guard.reserve(buildIdempotencyKey({ platform: 'x', operation: 'publish', targetId: 'P1' }));
  check('تعذّر المخزن => سبب backend_unavailable', r.reason === 'backend_unavailable');
  check('تعذّر المخزن => يُسمح بالتنفيذ (fail-open موثّق)', reservationAllowsExecution(r));
}

// 8) ثوابت المصدر الواحد.
{
  check('اسم الجدول كما هو مطلوب', IDEMPOTENCY_TABLE === 'gharabi_idempotency');
  check('مدة الحجز الافتراضية 10 دقائق', IDEMPOTENCY_RESERVATION_TTL_MS === 10 * 60 * 1000);
}

async function run(): Promise<void> {
  await raceTests();
  await doneBlocksRepeat();
  await failedAllowsRetry();
  staleReservationReusable();
  await backendUnavailableFailOpen();

  console.log(`PASSED: ${passed} idempotency-store checks`);
  if (failures.length) {
    console.error('FAILURES:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

run();
