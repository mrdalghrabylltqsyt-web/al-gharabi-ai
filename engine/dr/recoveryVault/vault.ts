/**
 * خزنة مفاتيح الطوارئ (Emergency Key Vault) — المحرّك.
 *
 * نفس مبدأ CURRENT الآمن ضد الانقطاع:
 *   staging(encrypt) → upload version → verify(actual read) → content hash
 *   → commit(HEAD.json) → promote current.enc → cleanup later (pending).
 *
 * لا تعديل في المكان؛ كل تحديث يبني نسخة مستقلة `KV-<N>`. الفشل قبل الاعتماد
 * يُبقي الخزنة الحالية سليمة بالكامل. فشل التنظيف لا يُسقط الاعتماد (cleanupPending).
 *
 * الأمان:
 *  - القيم تُشفَّر فقط (AES-256-GCM) — لا plaintext في Drive ولا في البيان ولا في أي رد.
 *  - مفتاح الخزنة (DR_RECOVERY_VAULT_KEY) **لا يوجد داخل Drive أبداً**.
 *  - كل المخرجات المُعادة للواجهة/الصحة تحمل metadata فقط (أسماء/حالات/بصمات/أعداد).
 */

import {
  buildKeyVaultManifest,
  buildKeyVaultHead,
  isKeyVaultHeadValid,
  hashContent,
  VAULT_KEY_ENV,
} from '../../../tools/dr/cloud-lib.mjs';
import { buildVaultRecords, encryptKeyVault, decryptKeyVault, resolveVaultKey, inspectVaultKey } from '../../../tools/dr/key-vault-crypto.mjs';
import { INVENTORY_BY_NAME, RECOVERY_SECRET_INVENTORY, presentInventoryNames, VAULT_SELF_KEY_ENV } from './inventory';
import { classifyInventoryForRecovery, summarizeRecovery } from './recoveryReport';

export { VAULT_KEY_ENV };

/** تصنيف اسم سرّ من الجرد المعتمد (بلا قيمة). */
function classifyFromInventory(name: string) {
  const e = INVENTORY_BY_NAME.get(name);
  if (!e) return { kind: 'unknown', source: 'environment', recoverability: 'value' };
  return {
    kind: e.kind,
    service: e.service,
    purpose: e.purpose,
    recoveryCritical: e.recoveryCritical,
    source: e.source,
    recoverability: e.recoverability,
    note: e.note ?? null,
  };
}

/** بصمة حتمية لمحتوى الخزنة (أسماء + بصمات قيم) — تكشف «لا تغيير» بلا كشف قيمة. */
export function vaultContentHash(records: any[]): string {
  const canonical = [...(records || [])]
    .map((r) => ({ name: r.name, fingerprint: r.fingerprint }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  return hashContent(JSON.stringify(canonical));
}

/** يقارن سجلّين: مضاف/معدّل/محذوف (أسماء وبصمات فقط). */
export function diffVaultRecords(previous: any[], next: any[]) {
  const prevMap = new Map((previous || []).map((r) => [r.name, r.fingerprint]));
  const nextMap = new Map((next || []).map((r) => [r.name, r.fingerprint]));
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [name, fp] of nextMap) {
    if (!prevMap.has(name)) added.push(name);
    else if (prevMap.get(name) !== fp) changed.push(name);
  }
  for (const name of prevMap.keys()) if (!nextMap.has(name)) removed.push(name);
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
}

/**
 * يبني سجلات الخزنة من البيئة الفعلية ∩ الجرد المعتمد. لا يشمل أي اسم غير معتمد،
 * ولا أي متغيّر غير موجود. يُوسَم كل سجل بمصدره وقابلية استعادته.
 */
export function buildVaultSnapshot(env: Record<string, string | undefined> = {}, now?: string) {
  const names = presentInventoryNames(env);
  const values: Record<string, string> = {};
  for (const name of names) values[name] = String(env[name]);
  const records = buildVaultRecords(values, classifyFromInventory, { now });
  return { names, values, records };
}

/** يحسم الخزنة الحالية من HEAD.json وحده (بلا تخمين)، ويتحقق من اتساق البيان. */
export async function resolveCurrentKeyVault(store: any) {
  const headRes = await store.readKeyVaultHead();
  if (!headRes.ok) return { ok: false, code: headRes.code || 'no_structure' };
  const head = headRes.data;
  if (!isKeyVaultHeadValid(head)) return { ok: false, code: 'no_head', message: 'لا مرجع اعتماد صالح (HEAD.json) لخزنة المفاتيح.' };
  const vres = await store.readKeyVaultVersionManifest(head.version);
  if (!vres.ok || !vres.data) return { ok: false, code: 'version_manifest_missing', version: head.version, message: 'مرجع الاعتماد يشير إلى نسخة خزنة بلا بيان.' };
  const manifest = vres.data;
  const consistent = manifest.encryptedVaultHash === head.encryptedVaultHash && Number(manifest.version) === Number(head.version);
  return {
    ok: true,
    data: {
      source: 'HEAD.json',
      version: head.version,
      dirName: head.dirName,
      encryptedVaultHash: head.encryptedVaultHash,
      recordCount: head.recordCount,
      cleanupPending: Boolean(head.cleanupPending),
      pendingCleanup: Array.isArray(head.pendingCleanup) ? head.pendingCleanup : [],
      consistent,
      manifest,
    },
  };
}

/** ينظّف نسخ الخزنة القديمة بعد الاعتماد. فشل الحذف يُعاد كـpending (لا يُسقط الاعتماد). */
export async function cleanupOldKeyVaultVersions(store: any, keepVersion: number) {
  const removed: number[] = [];
  const pending: Array<{ version: number; reason: string }> = [];
  const listRes = await store.listKeyVaultVersions();
  if (!listRes.ok) return { removed, pending };
  for (const v of listRes.data) {
    if (v === keepVersion) continue;
    const del = await store.deleteKeyVaultVersionDir(v);
    if (del.ok) removed.push(v);
    else pending.push({ version: v, reason: String(del.code || 'delete_failed').slice(0, 60) });
  }
  return { removed, pending };
}

/**
 * يزامن خزنة المفاتيح: يبني سجلات من البيئة، يكشف «لا تغيير»، وإلا يبني نسخة جديدة.
 * @returns نتيجة صادقة (no_change|synced|blocked|failed) بلا أي قيمة سرّية.
 */
export async function runKeyVaultSync(options: {
  store: any;
  env?: Record<string, string | undefined>;
  now?: string;
}): Promise<any> {
  const store = options.store;
  const env = options.env || process.env;
  const now = options.now || new Date().toISOString();
  if (!store) return { state: 'failed', reason: 'no_store', message: 'لا مخزن Drive.' };

  // مفتاح الخزنة إلزامي: بلا مفتاح لا خزنة (لا ادعاء).
  const keyRes = resolveVaultKey(env);
  if (!keyRes.ok) return { state: 'blocked', reason: keyRes.reason, message: keyRes.message, vaultKey: inspectVaultKey(env) };

  const structure = await store.ensureStructure();
  if (!structure.ok) return { state: 'failed', reason: structure.code || 'no_structure', message: structure.message || 'تعذّر تجهيز بنية Drive.' };

  const snapshot = buildVaultSnapshot(env, now);
  if (!snapshot.records.length) return { state: 'failed', reason: 'no_secrets_found', message: 'لا أسرار معتمدة مضبوطة في البيئة: لا خزنة فارغة.' };
  const contentHash = vaultContentHash(snapshot.records);

  // كشف «لا تغيير» عبر بصمة المحتوى مقابل الخزنة الحالية (من HEAD).
  const current = await resolveCurrentKeyVault(store);
  const currentHead = current.ok ? current.data : null;
  const contentUnchanged = Boolean(currentHead && currentHead.manifest?.contentHash === contentHash);

  // لا تغيير وبلا تنظيف معلّق: لا نسخة جديدة.
  if (contentUnchanged && !currentHead!.cleanupPending) {
    return {
      state: 'no_change',
      version: currentHead!.version,
      recordCount: snapshot.records.length,
      contentHash,
      removed: 0,
      cleanupPending: false,
      pendingCleanup: [],
      records: snapshot.records,
      at: now,
      message: 'لا تغيير في أسرار الخزنة (نفس بصمة المحتوى): لم تُنشأ نسخة جديدة.',
    };
  }

  // لا تغيير لكن تنظيف معلّق: أعِد محاولة التنظيف فقط — بلا نسخة جديدة ولا no_change كاذب.
  if (contentUnchanged && currentHead!.cleanupPending) {
    const cleanup = await cleanupOldKeyVaultVersions(store, currentHead!.version);
    const pending = cleanup.pending;
    try {
      await store.writeKeyVaultHead(buildKeyVaultHead({
        version: currentHead!.version,
        encryptedVaultHash: currentHead!.encryptedVaultHash,
        recordCount: currentHead!.recordCount,
        createdAt: now,
        cleanupPending: pending.length > 0,
        pendingCleanup: pending,
      }));
    } catch { /* أفضل جهد */ }
    return {
      state: 'no_change',
      version: currentHead!.version,
      recordCount: currentHead!.recordCount,
      contentHash,
      removed: cleanup.removed.length,
      cleanupPending: pending.length > 0,
      pendingCleanup: pending,
      records: currentHead!.manifest?.records || [],
      at: now,
      message: pending.length
        ? 'لا تغيير في المحتوى: أُعيدت محاولة التنظيف وبعض النسخ ما زالت معلّقة.'
        : 'لا تغيير في المحتوى: اكتمل تنظيف النسخ القديمة المعلّق.',
    };
  }

  const nextVersion = (currentHead?.version || 0) + 1;
  const encrypted = encryptKeyVault(snapshot.records, snapshot.values, env);
  if (!encrypted.ok) return { state: 'failed', reason: encrypted.code, message: encrypted.message, at: now };

  const encryptedVaultHash = hashContent(encrypted.payload);
  const manifest = buildKeyVaultManifest({
    version: nextVersion,
    createdAt: now,
    updatedAt: now,
    keyFingerprint: encrypted.keyFingerprint,
    recordCount: snapshot.records.length,
    encryptedVaultHash,
    encryptedVaultSize: Buffer.byteLength(encrypted.payload),
    contentHash,
    records: snapshot.records,
    vaultKeyEnvName: VAULT_KEY_ENV,
  });

  // 1) رفع نسخة مستقلة + بيانها.
  const wrote = await store.writeKeyVaultVersion(nextVersion, encrypted.payload, manifest);
  if (!wrote.ok) return { state: 'failed', reason: wrote.code || 'version_write_failed', message: wrote.message || 'تعذّر رفع نسخة الخزنة.', stagingVersion: nextVersion, at: now };

  // 2) تحقق فعلي: أعِد قراءة الحزمة من Drive وطابق بصمتها.
  const readBack = await store.readKeyVaultVersion(nextVersion);
  if (!readBack.ok || !readBack.data) return { state: 'failed', reason: 'verify_unreadable', stagingVersion: nextVersion, at: now, message: 'تعذّر قراءة نسخة الخزنة بعد الرفع: لا اعتماد.' };
  if (hashContent(readBack.data) !== encryptedVaultHash) return { state: 'failed', reason: 'verify_hash_mismatch', stagingVersion: nextVersion, at: now, message: 'عدم تطابق بصمة الخزنة بعد الرفع: لا اعتماد.' };

  // 3) نقطة الالتزام الوحيدة: HEAD.json نحو النسخة الجديدة.
  const head = buildKeyVaultHead({ version: nextVersion, encryptedVaultHash, recordCount: snapshot.records.length, createdAt: now, cleanupPending: false, pendingCleanup: [] });
  const headWritten = await store.writeKeyVaultHead(head);
  if (!headWritten.ok) return { state: 'failed', reason: headWritten.code || 'head_write_failed', stagingVersion: nextVersion, headVersion: currentHead?.version || null, at: now, message: 'فشل اعتماد مرجع الخزنة: النسخة الجديدة غير معتمدة والخزنة السابقة سليمة.' };

  // 4) ترقية المؤشر البشري current.enc (بعد الاعتماد؛ فشله لا يُسقط الاعتماد).
  await store.writeKeyVaultCurrent(encrypted.payload);

  // 5) تنظيف النسخ القديمة (بعد الاعتماد فقط).
  const cleanup = await cleanupOldKeyVaultVersions(store, nextVersion);
  const pending = cleanup.pending;
  if (pending.length) {
    try { await store.writeKeyVaultHead(buildKeyVaultHead({ version: nextVersion, encryptedVaultHash, recordCount: snapshot.records.length, createdAt: now, cleanupPending: true, pendingCleanup: pending })); } catch { /* أفضل جهد */ }
  }

  const previousRecords = currentHead?.manifest?.records || [];
  const diff = diffVaultRecords(previousRecords, snapshot.records);
  return {
    state: 'synced',
    version: nextVersion,
    recordCount: snapshot.records.length,
    contentHash,
    encryptedVaultHash,
    removed: cleanup.removed.length,
    cleanupPending: pending.length > 0,
    pendingCleanup: pending,
    diff,
    records: snapshot.records,
    at: now,
    message: 'تمت مزامنة خزنة المفاتيح والتحقق منها.',
  };
}

/**
 * يستعيد الخزنة في سيناريو كارثة: يقرأ النسخة المعتمدة من HEAD، يفكّها بمفتاح
 * المالك، ويتحقق أن بصمات القيم تطابق البيان (كشف عبث/تلف).
 * @returns `{ ok, records, values }` أو فشلاً صريحاً — القيم تُعاد للاختبار/الاستعادة فقط.
 */
export async function recoverKeyVault(store: any, env: Record<string, string | undefined> = process.env) {
  const current = await resolveCurrentKeyVault(store);
  if (!current.ok) return { ok: false, code: current.code, message: current.message };
  const version = current.data.version;
  const pkg = await store.readKeyVaultVersion(version);
  if (!pkg.ok || !pkg.data) return { ok: false, code: 'vault_package_missing', message: 'حزمة الخزنة المعتمدة غير موجودة.' };
  // تحقق من البصمة المعلنة قبل الفكّ (كشف استبدال الملف).
  if (hashContent(pkg.data) !== current.data.encryptedVaultHash) {
    return { ok: false, code: 'vault_hash_mismatch', message: 'بصمة حزمة الخزنة لا تطابق البيان (ملف مُبدَّل/تالف).' };
  }
  const dec = decryptKeyVault(pkg.data, env);
  if (!dec.ok) return { ok: false, code: dec.code, message: dec.message };
  // تحقق أن بصمات القيم تطابق metadata البيان (كشف عبث بالمحتوى).
  const manifestRecords = new Map((current.data.manifest?.records || []).map((r: any) => [r.name, r.fingerprint]));
  const mismatched: string[] = [];
  for (const [name, value] of Object.entries(dec.values)) {
    const expected = manifestRecords.get(name);
    if (expected && hashContent(String(value)).slice(0, 16) !== expected) mismatched.push(name);
  }
  return {
    ok: true,
    version,
    records: dec.records,
    values: dec.values,
    recordCount: Object.keys(dec.values).length,
    integrity: { recordsMatch: mismatched.length === 0, mismatched },
  };
}

/** ملخص صادق للواجهة/الصحة: بلا أي قيمة سرّية (أسماء/حالات/أعداد/بصمات فقط). */
export async function keyVaultStatus(store: any, env: Record<string, string | undefined> = process.env) {
  const vaultKey = inspectVaultKey(env);
  const out: any = { vaultKey, inventoryCount: RECOVERY_SECRET_INVENTORY.length, presentCount: presentInventoryNames(env).length };
  if (!store) { out.state = 'unavailable'; return out; }
  try {
    const current = await resolveCurrentKeyVault(store);
    if (!current.ok) {
      out.state = current.code === 'no_head' ? 'empty' : 'unknown';
      out.reason = current.code;
      return out;
    }
    // فكّ تجريبي (بلا كشف قيم): يثبت أن المفتاح الحالي يفتح الخزنة فعلاً.
    let canDecrypt = false;
    let recordCount = current.data.manifest?.recordCount ?? current.data.recordCount ?? null;
    try {
      const pkg = await store.readKeyVaultVersion(current.data.version);
      if (pkg.ok && pkg.data) {
        const dec = decryptKeyVault(pkg.data, env);
        canDecrypt = dec.ok;
        if (dec.ok) recordCount = Object.keys(dec.values).length;
      }
    } catch { canDecrypt = false; }
    out.state = 'present';
    out.version = current.data.version;
    out.recordCount = recordCount;
    out.encryptedVaultHash = current.data.encryptedVaultHash;
    out.contentHash = current.data.manifest?.contentHash ?? null;
    out.cleanupPending = current.data.cleanupPending;
    out.pendingCleanup = current.data.pendingCleanup;
    out.consistent = current.data.consistent;
    out.canDecrypt = canDecrypt;
    out.records = current.data.manifest?.records || [];
    // تصنيف الاستعادة (أسماء/تصنيفات فقط بلا قيم): يوضّح للمالك ما يُستعاد حرفياً
    // وما يلزم إجراء مالك/مزوّد — بلا أي قيمة سرّية.
    const vaultRecordNames = new Set((current.data.manifest?.records || []).map((r: any) => r.name));
    const classes = classifyInventoryForRecovery(RECOVERY_SECRET_INVENTORY, Object.fromEntries([...vaultRecordNames].map((n) => [n, ''])) as Record<string, string>);
    out.recovery = { summary: summarizeRecovery(classes), items: classes };
    // صدق صريح: مفتاح فتح الخزنة **لا** يجب أن يكون داخلها.
    out.vaultSelfKeyStored = vaultRecordNames.has(VAULT_SELF_KEY_ENV);
    return out;
  } catch (e: any) {
    out.state = 'error';
    out.reason = String(e?.code || e?.message || 'vault_status_failed').slice(0, 80);
    return out;
  }
}
