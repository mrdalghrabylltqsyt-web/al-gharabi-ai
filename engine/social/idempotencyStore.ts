/**
 * F-07 — مخزن منع تكرار دائم للعمليات الخارجية (رد/نشر/تنفيذ مهمة).
 *
 * المشكلة المُغلَقة: كان منع تكرار الرد والنشر داخل العملية فقط
 * (`replyInFlightLock` = Map/Set في الذاكرة)، فلا يصمد بعد إعادة التشغيل ولا
 * عبر نسختين أثناء النشر. النتيجة: بعد cold start/نشر جديد يمكن إعادة إرسال
 * نفس الرد أو إنشاء نفس النشر مرّة أخرى (رد مكرر حقيقي يراه عميل).
 *
 * الحل: حجز ذرّي لمفتاح عملية في جدول مستقل (`gharabi_idempotency`) يُنشأ بإنشاء
 * إضافي فقط (CREATE TABLE IF NOT EXISTS) — لا تعديل أي جدول قائم. يُحجز المفتاح
 * **قبل** أي نداء مزود: من ينجح حجزه وحده ينفّذ؛ ومن لا ينجح (مفتاح محجوز حيّ أو
 * منتهٍ بنجاح) لا ينفّذ إطلاقاً. بعد النداء: `done` عند النجاح، و`failed` عند فشل
 * مؤكد (يسمح بإعادة المحاولة لاحقاً). الحجز العالق (`reserved` بعد انتهاء
 * `expires_at`) يُعتبر قابلاً لإعادة الحجز فلا جمود دائم بعد تعطّل عملية.
 *
 * هذا الملف **منطق صافٍ** (بلا شبكة/أسرار/ساعة حقيقية — الآن يُمرَّر صراحةً) وهو
 * المصدر الواحد لأسماء الجدول وأعمدة الحالة وبناء المفتاح وقرار الحجز، ويستورده
 * محوّل التخزين (`engine/storage/adapter.ts`) لينفّذ نفس المنطق في الخلفيتين.
 */

/**
 * حالات سجل الحجز:
 *  - `reserved`      : قيد التنفيذ (حجز حيّ؛ لا تنفيذ مزدوج).
 *  - `done`          : نُفِّذ بنجاح مؤكد (لا إعادة أبداً).
 *  - `failed`        : فشل مؤكد من المزود (يسمح بإعادة المحاولة).
 *  - `pending_quota` : انتظار مقصود (نفاد حصة) — ليس فشلاً ولا نجاحاً؛
 *                      قابل لإعادة الحجز (كما `failed`) ولا يُخلط بـ`done`.
 * الحالتان `failed` و`pending_quota` قابلتان لإعادة الحجز؛ `done` و`reserved` الحيّ لا.
 */
export type IdempotencyStatus = "reserved" | "done" | "failed" | "pending_quota";

/** الحالات التي تُنهي الحجز (قابلة للكتابة عبر `finish`). */
export type IdempotencyFinishStatus = "done" | "failed" | "pending_quota";

/** صف جدول `gharabi_idempotency` (يعمل نفسه في خلفية الملف عبر مخزن الحالة). */
export interface IdempotencyRecord {
  key: string;
  status: IdempotencyStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

/** جدول منع التكرار — إنشاء إضافي فقط، لا يمسّ أي جدول قائم. */
export const IDEMPOTENCY_TABLE = "gharabi_idempotency";

/**
 * مفتاح مخزن الحالة في خلفية الملف/الوضع العابر (بلا Postgres). يُحفظ ككائن
 * `{ records: { <key>: IdempotencyRecord } }` عبر محوّل الحالة فيصمد بعد إعادة
 * التشغيل عند وجود قرص دائم. **محدودية موثّقة:** على مضيف عابر بلا قرص (Render
 * Free) لا يصمد، فلا يحمي عبر نسختين — ولهذا Postgres هو المصدر الدائم المطلوب.
 */
export const IDEMPOTENCY_STORAGE_KEY = "idempotency";

/**
 * DDL المصدر الواحد للجدول: `key` فريد، وحالة صريحة (reserved/done/failed)،
 * وطوابع زمنية. `CREATE TABLE IF NOT EXISTS` آمن على قاعدة قائمة (لا تعديل ولا
 * حذف). يُنفَّذ في تهيئة خلفية Postgres فقط.
 */
export const IDEMPOTENCY_TABLE_DDL = `CREATE TABLE IF NOT EXISTS ${IDEMPOTENCY_TABLE} (
  key text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('reserved','done','failed','pending_quota')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
)`;

/**
 * F-07 (ترقية صف قائم): الجدول قد يكون أُنشئ بقيود الحالات الثلاث قبل إضافة
 * `pending_quota`. يُوسَّع القيد بإنشاء **إضافي فقط** (لا حذف ولا فقدان بيانات):
 * `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` بقائمة الحالات الأربع. يُنفَّذ
 * مرة عند تهيئة الخلفية، وهو idempotent.
 */
export const IDEMPOTENCY_STATUS_CONSTRAINT = `${IDEMPOTENCY_TABLE}_status_check`;
export const IDEMPOTENCY_TABLE_UPGRADE_DDL = [
  `ALTER TABLE ${IDEMPOTENCY_TABLE} DROP CONSTRAINT IF EXISTS ${IDEMPOTENCY_STATUS_CONSTRAINT}`,
  `ALTER TABLE ${IDEMPOTENCY_TABLE} ADD CONSTRAINT ${IDEMPOTENCY_STATUS_CONSTRAINT} CHECK (status IN ('reserved','done','failed','pending_quota'))`,
];

/**
 * SQL الحجز الذرّي (Postgres): إدراج مع `ON CONFLICT DO NOTHING RETURNING`، وإن
 * وُجد صف قائم يُعاد حجزه فقط إن كان `failed` (فشل مؤكد) أو `reserved` منتهي
 * المدة (حجز عالق) — في بيان واحد ذرّي بلا سباق. يُعيد صفاً واحداً فقط عند نجاح
 * الحجز؛ عدم إرجاع صف = العملية محجوزة حيّة أو منتهية بنجاح ⇒ لا تنفيذ.
 */
export const IDEMPOTENCY_RESERVE_SQL = `WITH ins AS (
  INSERT INTO ${IDEMPOTENCY_TABLE} (key, status, created_at, updated_at, expires_at)
  VALUES ($1, 'reserved', now(), now(), $2::timestamptz)
  ON CONFLICT (key) DO NOTHING
  RETURNING key
)
UPDATE ${IDEMPOTENCY_TABLE} t
SET status = 'reserved', updated_at = now(), expires_at = $2::timestamptz
WHERE t.key = $1
  AND NOT EXISTS (SELECT 1 FROM ins)
  AND (t.status IN ('failed','pending_quota') OR (t.status = 'reserved' AND t.expires_at <= now()))
RETURNING t.key`;

/** إنهاء العملية: done عند النجاح، failed عند فشل مؤكد (يسمح بإعادة المحاولة). */
export const IDEMPOTENCY_FINISH_SQL = `UPDATE ${IDEMPOTENCY_TABLE}
SET status = $2, updated_at = now()
WHERE key = $1`;

export const IDEMPOTENCY_READ_SQL = `SELECT key, status, created_at, updated_at, expires_at FROM ${IDEMPOTENCY_TABLE} WHERE key = $1`;

/** مدة صلاحية الحجز الافتراضية (حجز عالق بعدها يُعاد حجزه): 10 دقائق. */
export const IDEMPOTENCY_RESERVATION_TTL_MS = 10 * 60 * 1000;

/** أنواع العمليات التي تُحجز في المخزن الدائم. */
export type IdempotencyOperation =
  | "comment_reply"
  | "message_reply"
  | "publish"
  | "job_execute";

export interface IdempotencyKeyInput {
  platform: string;
  operation: IdempotencyOperation;
  /**
   * معرّف الهدف عند المزود: التعليق/الرسالة/المنشور. للنشر قد يكون معرّف
   * المحتوى الداخلي (انظر `contentId`).
   */
  targetId: string;
  /** للنشر: معرّف المحتوى الداخلي (المنشور) — يُميّز نشرين لنفس المنصة. */
  contentId?: string;
  /**
   * مفتاح تكرار اختياري للردود (نمط `replyLockKey`): يسمح بمتابعة مشروعة على
   * نفس الهدف بمفتاح مميّز (`fu1`) بينما يُمنع تكرار نفس المفتاح.
   */
  idempotencyKey?: string;
}

/**
 * يبني مفتاح الحجز: المنصة + نوع العملية + معرّف الهدف عند المزود، وللنشر يضمّ
 * معرّف المحتوى الداخلي أيضاً. مفتاح تكرار الرد (إن وُجد) يُلحق فيُميّز المتابعة
 * المشروعة عن التكرار. المُدخل الفارغ يُطبَّع إلى وسم صريح فلا يُنشأ مفتاح ملتبس.
 */
export function buildIdempotencyKey(input: IdempotencyKeyInput): string {
  const platform = String(input.platform || "").trim().toLowerCase() || "unknown";
  const operation = String(input.operation || "").trim().toLowerCase() || "op";
  const target = String(input.targetId || "").trim();
  const content = String(input.contentId || "").trim();
  const idem = String(input.idempotencyKey || "").trim();
  const parts = [platform, operation, target || "no-target"];
  // لا نُكرّر معرّف المحتوى إن طابق الهدف (النشر غالباً يمرّر الاثنين نفسهما).
  if (content && content !== target) parts.push(`content:${content}`);
  if (idem) parts.push(`idem:${idem}`);
  return parts.join(":");
}

/** هل الحجز العالق (reserved) انتهت مدته فيُعاد حجزه؟ */
export function isStaleReservation(record: Pick<IdempotencyRecord, "status" | "expiresAt"> | null | undefined, nowMs: number): boolean {
  if (!record || record.status !== "reserved") return false;
  const expires = Date.parse(record.expiresAt);
  if (!Number.isFinite(expires)) return true; // طابع زمني تالف = عالق، يُستردّ
  return expires <= nowMs;
}

export interface ReservationDecision {
  reserve: boolean;
  reason: "no_record" | "retry_after_failure" | "stale_reservation" | "in_progress" | "already_done";
}

/**
 * قرار الحجز من سجل قائم (منطق صافٍ — نفس ما يُنفّذه SQL الحجز الذرّي):
 * - لا سجل ⇒ حجز.
 * - `failed` ⇒ إعادة محاولة مسموحة (فشل مؤكد سابق).
 * - `pending_quota` ⇒ إعادة حجز مسموحة (انتظار حصة مقصود، ليس نجاحاً).
 * - `reserved` منتهي المدة ⇒ حجز (حجز عالق).
 * - `reserved` حيّ ⇒ رفض (قيد التنفيذ).
 * - `done` ⇒ رفض (نُفِّذ بنجاح، لا تكرار).
 */
export function decideReservation(record: IdempotencyRecord | null | undefined, nowMs: number): ReservationDecision {
  if (!record) return { reserve: true, reason: "no_record" };
  if (record.status === "done") return { reserve: false, reason: "already_done" };
  if (record.status === "failed") return { reserve: true, reason: "retry_after_failure" };
  if (record.status === "pending_quota") return { reserve: true, reason: "retry_after_failure" };
  if (isStaleReservation(record, nowMs)) return { reserve: true, reason: "stale_reservation" };
  return { reserve: false, reason: "in_progress" };
}

/**
 * يحاول الحجز على خريطة سجلات (خلفية الملف/الوضع العابر) — منطق صافٍ مشترك مع
 * اختبارات الوحدة. يُعدّل الخريطة في مكانها ويُعيد هل نجح الحجز. الاستدعاء
 * متزامن بالكامل (بلا `await` بين الفحص والكتابة) فيبقى ذرّياً ضمن العملية.
 */
export function applyReservationToMap(
  records: Record<string, IdempotencyRecord>,
  key: string,
  nowMs: number,
  expiresAtMs: number,
): boolean {
  const decision = decideReservation(records[key] || null, nowMs);
  if (!decision.reserve) return false;
  const nowIso = new Date(nowMs).toISOString();
  const existing = records[key];
  records[key] = {
    key,
    status: "reserved",
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
  return true;
}

/** يُنهي الحجز على الخريطة: done عند النجاح، failed عند فشل مؤكد، pending_quota للانتظار. */
export function applyFinishToMap(
  records: Record<string, IdempotencyRecord>,
  key: string,
  status: IdempotencyFinishStatus,
  nowMs: number,
): void {
  const existing = records[key];
  if (!existing) return;
  existing.status = status;
  existing.updatedAt = new Date(nowMs).toISOString();
}

/** واجهة خلفية المخزن (تُنفَّذ في محوّل التخزين: Postgres أو مخزن الحالة/الملف). */
export interface IdempotencyBackend {
  reserve(key: string, nowMs: number, expiresAtMs: number): Promise<boolean>;
  finish(key: string, status: IdempotencyFinishStatus, nowMs: number): Promise<void>;
  read(key: string): Promise<IdempotencyRecord | null>;
}

export interface IdempotencyReservationResult {
  ok: boolean;
  /** سبب الرفض عند عدم نجاح الحجز (للتوثيق/التشخيص فقط، بلا سرّ). */
  reason: "in_progress" | "already_done" | "backend_unavailable";
}

export interface IdempotencyGuard {
  reserve(key: string, options?: { ttlMs?: number }): Promise<IdempotencyReservationResult>;
  complete(key: string, outcome: IdempotencyFinishStatus): Promise<void>;
  read(key: string): Promise<IdempotencyRecord | null>;
}

/**
 * غلاف الحجز فوق خلفية المخزن. عند تعذّر الخلفية (شبكة/قاعدة) **لا نُسقط العملية
 * بحجز كاذب**: نُعلن `backend_unavailable` ونسمح بالتنفيذ (fail-open) لأن
 * `replyInFlightLock` يبقى طبقة أولى، ولأن إسقاط كل رد بسبب تعذّر المخزن أسوأ من
 * تكرار نظري محكوم ببوابات المشروع القائمة (منع التكرار في السجل + فحص الاتصال).
 * هذا موثّق صراحةً ولا يُخفى.
 */
export function createIdempotencyGuard(backend: IdempotencyBackend): IdempotencyGuard {
  return {
    async reserve(key, options) {
      const nowMs = Date.now();
      const ttl = Number.isFinite(Number(options?.ttlMs)) ? Math.max(1000, Number(options?.ttlMs)) : IDEMPOTENCY_RESERVATION_TTL_MS;
      try {
        const ok = await backend.reserve(key, nowMs, nowMs + ttl);
        if (ok) return { ok: true, reason: "in_progress" as const };
        const existing = await backend.read(key);
        return { ok: false, reason: decideReservation(existing, nowMs).reason === "already_done" ? "already_done" : "in_progress" };
      } catch {
        return { ok: false, reason: "backend_unavailable" };
      }
    },
    async complete(key, outcome) {
      try {
        await backend.finish(key, outcome, Date.now());
      } catch {
        /* إنهاء الحجز أفضل جهد: تعذّره يترك الحجز `reserved` فيُستردّ بعد انتهاء مدته. */
      }
    },
    async read(key) {
      try {
        return await backend.read(key);
      } catch {
        return null;
      }
    },
  };
}

/**
 * هل يسمح الحجز بالتنفيذ؟ (`backend_unavailable` يسمح — fail-open موثّق أعلاه).
 */
export function reservationAllowsExecution(result: IdempotencyReservationResult): boolean {
  return result.ok || result.reason === "backend_unavailable";
}

/**
 * F-07: تصنيف نتيجة نداء مزود إلى حالة حجز نهائية — **جذر النتيجة الغامضة**.
 *
 * القاعدة الحاكمة: لا نُعلن `failed` (الذي يسمح بإعادة محاولة فورية) إلا عند دليل
 * صريح من المزود على **عدم التنفيذ**. إن كان النداء قد خرج فعلاً (بعد الإرسال) ثم
 * انقطع بلا رد (مهلة/انقطاع/AbortError) فلا نعرف هل نُفِّذ؛ نُبقي الحجز `reserved`
 * فيُستردّ بعد انتهاء مدته (10 دقائق) — لا تكرار فوري ولا فقدان دائم.
 *
 *  - نجاح ⇒ `done`.
 *  - فشل محلي قبل أي نداء شبكي (كود `NETWORK_ERROR`/`network` غير كافٍ وحده) ⇒
 *    يُصنّف من `failureKind` أدناه، لا من النجاح.
 *  - `failureKind = 'network_after_send'` (مهلة/انقطاع/AbortError) ⇒ `null` (يبقى reserved).
 *  - `failureKind = 'provider_rejected'` (ردّ المزود 4xx/5xx بجسم خطأ) ⇒ `failed`.
 *  - `failureKind = 'pre_provider'` (فشل قبل أي نداء) ⇒ `failed` (آمن: لم يخرج شيء).
 *  - انتظار مقصود (نفاد حصة) ⇒ `pending_quota` (قابل لإعادة الحجز، ليس done).
 */
export type ExternalFailureKind = "network_after_send" | "provider_rejected" | "pre_provider";

export function classifyExternalOperationOutcome(input: {
  ok: boolean;
  /** انتظار مقصود (نفاد حصة YouTube مثلاً) — لا فشل ولا نجاح. يتقدّم على `ok`. */
  pending?: boolean;
  /** تصنيف الفشل عند `ok=false`. */
  failureKind?: ExternalFailureKind;
}): IdempotencyFinishStatus | null {
  // الانتظار المقصود (نفاد حصة) يتقدّم على `ok`: مسار YouTube يعيد HTTP 200 مع
  // `pendingRetry=true`، فلا يجوز اعتباره نجاحاً (`done`) وإلا مُنعت إعادة المحاولة.
  if (input.pending) return "pending_quota";
  if (input.ok) return "done";
  if (input.failureKind === "network_after_send") return null; // يبقى reserved (قابل للاسترداد بعد TTL)
  // provider_rejected أو pre_provider أو غير محدَّد ⇒ فشل مؤكد ⇒ failed.
  return "failed";
}
