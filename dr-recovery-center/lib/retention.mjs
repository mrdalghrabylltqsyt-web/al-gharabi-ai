/**
 * سياسة الاحتفاظ بنقاط الاستعادة — منطق صافٍ قابل للاختبار (بلا شبكة).
 *
 * القاعدة الملزمة:
 *  - نحتفظ بـ`keep` نقاط **مكتملة** على الأكثر.
 *  - لا نحذف نقطة أبداً قبل أن تكتمل النقطة الجديدة وتنجح كل فحوصها.
 *  - لا نحذف نقطة ناقصة/قيد الإنشاء، ولا أحدث نقطة، ولا نقطة محميّة صراحةً.
 *  - الفشل في الحذف لا يُسقط النسخة (يُعاد كـpending).
 *
 * الحماية التاريخية: `rp-002/rp-003/rp-004` تُحمى افتراضياً فلا تُحذف (تساوي
 * مطلب «لا تحذف النسخ الأصلية»). يمكن للمالك رفع الحماية عبر `DR_RETENTION_PROTECTED_IDS`.
 */

export const RETENTION_KEEP_ENV = 'DR_RETENTION_KEEP';
export const RETENTION_PROTECTED_ENV = 'DR_RETENTION_PROTECTED_IDS';
export const RETENTION_DISABLE_ENV = 'DR_AUTO_RETENTION';
/** النقاط التاريخية المحميّة افتراضياً (لا تُحذف). */
export const DEFAULT_PROTECTED_IDS = ['rp-002', 'rp-003', 'rp-004'];
export const DEFAULT_KEEP = 3;

/** هل سياسة الاحتفاظ مُفعّلة؟ (افتراضاً نعم؛ `DR_AUTO_RETENTION=false` يُعطّلها). */
export function retentionEnabled(env = process.env) {
  return String(env[RETENTION_DISABLE_ENV] ?? 'true').toLowerCase() !== 'false';
}

/** عدد النقاط المكتملة المحفوظة (افتراضاً 3). */
export function resolveKeep(env = process.env) {
  const raw = env[RETENTION_KEEP_ENV];
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1 || n > 50) return DEFAULT_KEEP;
  return n;
}

/** معرّفات النقاط المحميّة (لا تُحذف). افتراضاً الثلاث التاريخية. */
export function resolveProtectedIds(env = process.env) {
  const raw = env[RETENTION_PROTECTED_ENV];
  if (raw == null || String(raw).trim() === '') return [...DEFAULT_PROTECTED_IDS];
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

/** رتبة رقمية من `rp-NNN` (بلا تخمين: غير الصالح = -1). */
export function recoveryPointRank(id) {
  const m = /^rp-(\d+)$/.exec(String(id ?? ''));
  return m ? Number.parseInt(m[1], 10) : -1;
}

/**
 * يحسب قرار الاحتفاظ بلا أي تنفيذ (منطق صافٍ قابل للاختبار).
 * @param {Array<{id:string, complete?:boolean}>} points
 * @param {{keep?:number, protect?:string[], newestId?:string}} options
 */
export function planRetention(points, options = {}) {
  const keep = Number.isFinite(options.keep) ? options.keep : DEFAULT_KEEP;
  const protect = new Set(options.protect ?? []);
  const sorted = [...(points || [])].sort((a, b) => recoveryPointRank(a.id) - recoveryPointRank(b.id));
  const complete = sorted.filter((p) => p && p.complete === true);
  const incomplete = sorted.filter((p) => p && p.complete !== true).map((p) => p.id);
  const newest = options.newestId ?? (sorted.length ? sorted[sorted.length - 1].id : null);
  // المرشّحون للحذف: المكتملون غير المحميّين، الأقدم أولاً، مع استثناء الأحدث دائماً.
  const candidates = complete.filter((p) => !protect.has(p.id) && p.id !== newest);
  const overflow = Math.max(0, candidates.length - Math.max(0, keep - 1));
  const toDelete = candidates.slice(0, overflow).map((p) => p.id);
  const kept = sorted.map((p) => p.id).filter((id) => !toDelete.includes(id));
  const skippedProtected = complete.filter((p) => protect.has(p.id)).map((p) => p.id);
  return { keep, toDelete, kept, skippedProtected, incomplete, newest };
}

/**
 * ينفّذ الاحتفاظ على مخزن Drive: يحذف أقدم النقاط المكتملة الزائدة فقط.
 * **لا يُستدعى إلا بعد نجاح النقطة الجديدة والتحقق منها.**
 * @param {any} store DriveStore
 * @param {{keep?:number, protect?:string[], newestId?:string, now?:string}} options
 */
export async function pruneCompletedRestorePoints(store, options = {}) {
  const now = options.now || new Date().toISOString();
  const listed = await store.listRestorePoints();
  if (!listed.ok) return { ok: false, code: listed.code || 'list_failed', deleted: [], at: now };
  const entries = [];
  for (const p of listed.data || []) {
    // «مكتمل» = البيان موجود + الملفات الأساسية موجودة (بلا فكّ تشفير هنا).
    const manifest = p.manifest || null;
    const complete = Boolean(manifest && manifest.fileCount != null && manifest.sourceHash && manifest.encryptedDatabaseHash && manifest.encryptedSecretsHash);
    entries.push({ id: p.id, complete, folderId: p.folderId });
  }
  const plan = planRetention(entries, { keep: options.keep, protect: options.protect, newestId: options.newestId });
  const deleted = [];
  const pending = [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const id of plan.toDelete) {
    const entry = byId.get(id);
    if (!entry || !entry.folderId) { pending.push({ id, reason: 'no_folder' }); continue; }
    try {
      const res = await store.deleteFolderRecursive(entry.folderId);
      if (res && res.ok) deleted.push(id);
      else pending.push({ id, reason: res?.code || 'delete_failed' });
    } catch (e) {
      pending.push({ id, reason: String(e?.code || e?.message || 'delete_error').slice(0, 60) });
    }
  }
  return { ok: true, keep: plan.keep, deleted, pending, kept: plan.kept, skippedProtected: plan.skippedProtected, incomplete: plan.incomplete, at: now };
}
