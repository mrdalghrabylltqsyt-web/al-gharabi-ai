/**
 * المسار الرسمي الوحيد للنسخ الاحتياطي إلى Google Drive.
 *
 * الترتيب الملزم (لا مسار موازٍ):
 *   owner session → Drive auth → read state → resolve commit → source bundle
 *   → strict secret scan → DB dump → DB encrypt → manifest → hashes
 *   → current (atomic) → history recovery point → upload → verify
 *   → update backup state → honest result
 *
 * ضمانات:
 *  - لا سرّ في الحزمة أو البيان أو السجل (فحص صارم قبل أي رفع).
 *  - لا قاعدة بيانات خام: تشفير AES-256-GCM قبل الرفع، والنسخة الخام مؤقتة تُحذف.
 *  - لا نسخة كاذبة: النجاح يتطلّب وجود الملفات فعلاً في Drive ومطابقة الأحجام والبصمات.
 *  - لا تكرار بلا تغيير: نفس (commit + treeHash + sourceHash) => NO_CHANGE.
 *  - منع التشغيل المزدوج بقفل على مستوى العملية (بالإضافة إلى قفل على مستوى الخادم).
 *
 * كل شيء فوق DriveStore/DriveClient القابلين للحقن، فتُختبر المنظومة كاملة بخادم Drive وهمي.
 */

import {
  buildSourceBundle,
  verifySourceBundle,
  computeTreeHash,
  hashContent,
  toBuffer,
  scanForSecretsStrict,
  redactSecretFindings,
  buildBackupManifest,
  isSameSource,
  nextRecoveryPointId,
  evaluateBackupVerification,
  shouldExclude,
  normalizeRelPath,
  SOURCE_BUNDLE_NAME,
  DB_DUMP_NAME,
  SOURCE_BUNDLE_VERSION,
  BACKUP_VERSION,
} from './cloud-lib.mjs';
import { CURRENT_MANIFEST_NAME } from './drive-store.mjs';

/** قفل تشغيل على مستوى العملية (حماية ثانية فوق قفل الخادم). */
const inProcessLock = { running: false };

export function isBackupRunning() {
  return inProcessLock.running;
}

/** يحسب بصمة الشجرة من قائمة ملفات المصدر المُمرَّرة (نفس منطق المزامنة). */
export function computeSourceTree(files) {
  const entries = [];
  for (const f of files || []) {
    const path = normalizeRelPath(f.path);
    if (!path || shouldExclude(path)) continue;
    const content = toBuffer(f.content);
    entries.push({ path, sha256: hashContent(content), size: content.length });
  }
  return { entries, treeHash: computeTreeHash(entries) };
}

/**
 * ينفّذ نسخة احتياطية كاملة.
 * @param {object} options
 * @param {import('./drive-store.mjs').DriveStore} options.store
 * @param {object[]} options.files ملفات المصدر `{path, content}` (المشمولة والمستبعدة).
 * @param {() => Promise<string|null>|string|null} [options.dumpDatabase] ينتج نص SQL خام (مؤقت).
 * @param {(sql:string)=>object} options.encryptDatabase يشفر نص SQL إلى DB encrypted dump.
 * @param {object} [options.meta] { commit, branch, repository, project }
 * @param {string} [options.now]
 * @returns {Promise<object>} نتيجة صادقة (state: no_change|backed_up|failed|secret_blocked|blocked)
 */
export async function runBackup(options = {}) {
  const store = options.store;
  const now = options.now || new Date().toISOString();
  const meta = options.meta || {};

  if (!store) return { state: 'failed', reason: 'no_store', message: 'لا مخزن Drive.' };
  if (inProcessLock.running) {
    return { state: 'blocked', reason: 'backup_already_running', message: 'نسخة احتياطية قيد التنفيذ بالفعل.' };
  }
  inProcessLock.running = true;
  try {
    return await runBackupInner({ ...options, store, now, meta });
  } finally {
    inProcessLock.running = false;
  }
}

async function runBackupInner({ store, files, dumpDatabase, encryptDatabase, meta, now }) {
  // 1) البنية
  const structure = await store.ensureStructure();
  if (!structure.ok) return { state: 'failed', reason: structure.code || 'no_structure', message: structure.message || 'تعذّر تجهيز بنية Drive.' };

  // 2) حزمة المصدر + بصمة الشجرة
  const { entries, treeHash } = computeSourceTree(files);
  const bundle = buildSourceBundle(files);
  if (!bundle.ok) return { state: 'failed', reason: 'bundle_failed', message: 'تعذّر بناء حزمة المصدر.' };
  const bundleVerify = verifySourceBundle(bundle.buffer, { fileCount: bundle.fileCount });
  if (!bundleVerify.ok) return { state: 'failed', reason: bundleVerify.code, message: 'حزمة المصدر غير سليمة.' };
  const sourceHash = hashContent(bundle.buffer);

  // 3) فحص الأسرار الصارم — قبل أي رفع. الفشل يوقف كل شيء.
  const secretScan = scanForSecretsStrict(files);
  if (!secretScan.ok) {
    return {
      state: 'secret_blocked',
      stopped: true,
      uploaded: 0,
      reason: 'secret_detected',
      secretScan: { ok: false, findings: secretScan.findings.length, paths: [...new Set(secretScan.findings.map((f) => f.path))], details: redactSecretFindings(secretScan.findings).slice(0, 50) },
      message: 'STOP: سر مُرصود — لم يُرفع أي جزء من النسخة.',
      treeHash,
      sourceHash,
      at: now,
    };
  }

  // 4) نسخة قاعدة البيانات: dump مؤقت → hash → تشفير → حذف الخام
  let dbEncrypted = null;
  let databaseHash = null;
  let databaseSize = null;
  let encryptedDatabaseHash = null;
  let encryptedDatabaseSize = null;
  if (typeof dumpDatabase === 'function' && typeof encryptDatabase === 'function') {
    let rawSql = null;
    try {
      rawSql = await dumpDatabase();
    } catch (err) {
      return { state: 'failed', reason: 'database_dump_failed', message: `تعذّر إنشاء نسخة قاعدة البيانات: ${String(err?.code || err?.message || 'error').slice(0, 80)}`, treeHash, sourceHash, at: now };
    }
    if (rawSql == null) {
      return { state: 'failed', reason: 'database_unavailable', message: 'لا قاعدة بيانات لإنتاج نسخة منها.', treeHash, sourceHash, at: now };
    }
    const rawBuf = toBuffer(rawSql);
    databaseHash = hashContent(rawBuf);
    databaseSize = rawBuf.length;
    const encrypted = encryptDatabase(rawBuf.toString('utf8'));
    rawSql = null; // لا يبقى النص الخام في الذاكرة
    if (!encrypted || !encrypted.ok) {
      return { state: 'failed', reason: encrypted?.code || 'encrypt_failed', message: encrypted?.message || 'تعذّر تشفير نسخة قاعدة البيانات.', treeHash, sourceHash, at: now };
    }
    dbEncrypted = encrypted.payload;
    encryptedDatabaseHash = hashContent(dbEncrypted);
    encryptedDatabaseSize = Buffer.byteLength(dbEncrypted);
  }

  // 5) مقارنة مع النسخة الحالية => منع التكرار بلا تغيير
  const currentRead = await store.readCurrentManifest();
  const previousManifest = currentRead.ok ? currentRead.data : null;
  const candidateManifest = buildBackupManifest({
    ...meta,
    createdAt: now,
    treeHash,
    sourceHash,
    fileCount: bundle.fileCount,
    sourceSize: bundle.sizeBytes,
    databaseHash,
    databaseSize,
    encryptedDatabaseHash,
    encryptedDatabaseSize,
    schemaVersion: undefined,
    bundleVersion: SOURCE_BUNDLE_VERSION,
    backupVersion: BACKUP_VERSION,
  });

  if (previousManifest && isSameSource(previousManifest, candidateManifest)) {
    // الحالة لم تتغيّر: لا نُبدّل current ولا نُنشئ نقطة تاريخية مكررة.
    return {
      state: 'no_change',
      uploaded: 0,
      changed: false,
      treeHash,
      sourceHash,
      commit: meta.commit ?? null,
      current: previousManifest,
      at: now,
      message: 'الحالة لم تتغيّر (نفس commit/treeHash/sourceHash): لا نسخة تاريخية مكررة.',
    };
  }

  // 6) نقطة الاستعادة التاريخية: العدد من قائمة النقاط الحالية
  const points = await store.listRestorePoints();
  const existingIds = points.ok ? points.data.map((p) => p.id) : [];
  const recoveryPointId = nextRecoveryPointId(existingIds);
  const manifest = buildBackupManifest({ ...candidateManifest, recoveryPointId, previousRecoveryPointId: previousManifest?.recoveryPointId ?? null });
  const recoveryManifest = {
    kind: 'recovery-point',
    id: recoveryPointId,
    immutable: true,
    createdAt: now,
    commit: manifest.commit,
    treeHash: manifest.treeHash,
    sourceHash: manifest.sourceHash,
    databaseHash: manifest.databaseHash,
    encryptedDatabaseHash: manifest.encryptedDatabaseHash,
    fileCount: manifest.fileCount,
    sourceSize: manifest.sourceSize,
    databaseSize: manifest.databaseSize,
    encryptedDatabaseSize: manifest.encryptedDatabaseSize,
    bundleVersion: manifest.bundleVersion,
    backupVersion: manifest.backupVersion,
    note: meta.note ?? null,
  };

  // 7) الرفع: history أولاً (لا يُلمس current بعد)، ثم ترقية current ذرّياً.
  //    إن فشل أي جزء => current السابق يبقى سليماً بلا حالة نصف مكتملة.
  const rp = await store.createVersionedRestorePoint(recoveryPointId, {
    commit: manifest.commit,
    bundle: bundle.buffer,
    dbEncrypted,
    manifest: recoveryManifest,
  });
  if (!rp.ok) {
    return { state: 'failed', reason: rp.code || 'history_write_failed', message: rp.message || 'تعذّر إنشاء نقطة الاستعادة.', treeHash, sourceHash, at: now };
  }

  const promoted = await store.writeCurrentVersion({ bundle: bundle.buffer, dbEncrypted, manifest });
  if (!promoted.ok) {
    return { state: 'failed', reason: promoted.code || 'current_write_failed', message: promoted.message || 'تعذّر ترقية current (نقطة الاستعادة أُنشئت).', treeHash, sourceHash, recoveryPointId, at: now };
  }

  // 8) تحقق فعلي: إعادة قراءة ما على Drive ومقارنة الأحجام والبصمات
  const actual = await readBackCurrent(store, { bundleName: SOURCE_BUNDLE_NAME, dbName: DB_DUMP_NAME });
  const verification = evaluateBackupVerification(
    { sourceSize: bundle.sizeBytes, encryptedDatabaseSize, sourceHash, encryptedDatabaseHash, treeHash },
    actual,
  );
  if (!verification.ok) {
    return {
      state: 'failed',
      reason: 'verification_failed',
      problems: verification.problems,
      treeHash,
      sourceHash,
      recoveryPointId,
      at: now,
      message: 'فشل التحقق النهائي من النسخة على Drive: لا نُعلن نجاحاً.',
    };
  }

  // 9) حذف نسخة DB المؤقتة من db/ (بعد الترقية) — لا تبقى نسخة مكررة.
  if (dbEncrypted) { try { await store.removeDbDump(DB_DUMP_NAME); } catch { /* تنظيف أفضل جهد */ } }

  return {
    state: 'backed_up',
    uploaded: 2 + (dbEncrypted ? 1 : 0),
    verified: true,
    changed: true,
    commit: manifest.commit,
    treeHash,
    sourceHash,
    recoveryPointId,
    manifest,
    verification,
    at: now,
    message: 'اكتملت النسخة الاحتياطية بنجاح وتم التحقق منها فعلاً على Google Drive.',
  };
}

/** يقرأ ملفات current الفعلية من Drive ويعيد وجودها وحجمها وبصمتها. */
export async function readBackCurrent(store, names = {}) {
  const bundleName = names.bundleName || SOURCE_BUNDLE_NAME;
  const dbName = names.dbName || DB_DUMP_NAME;
  const currentId = await store.subdirId('current');
  if (!currentId) return { bundlePresent: false, dbPresent: false, manifestPresent: false };
  const bundle = await store.readVersionFile(currentId, bundleName);
  const db = await store.readVersionFile(currentId, dbName);
  const manifest = await store.readJsonChild(currentId, CURRENT_MANIFEST_NAME);
  return {
    bundlePresent: Boolean(bundle.ok && bundle.data),
    dbPresent: Boolean(db.ok && db.data),
    manifestPresent: Boolean(manifest.ok && manifest.data),
    bundleSize: bundle.ok && bundle.data ? bundle.data.length : null,
    dbSize: db.ok && db.data ? db.data.length : null,
    bundleHash: bundle.ok && bundle.data ? hashContent(bundle.data) : null,
    dbHash: db.ok && db.data ? hashContent(db.data) : null,
    treeHash: manifest.ok && manifest.data ? manifest.data.treeHash : null,
  };
}
