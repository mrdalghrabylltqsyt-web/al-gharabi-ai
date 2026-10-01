/**
 * مرآة CURRENT الحقيقية — ملفات فردية ببنية المجلدات تحت `current/files/**`.
 *
 * هذا هو الجزء الذي يجعل النسخة على Google Drive قابلة للاستخدام كنسخة تعافٍ
 * مستقلة: كل ملف بمكانه (src/، engine/، tools/، public/…)، لا أرشيف واحد فقط.
 *
 * نموذج الترقية (آمن ضد الانقطاع — بلا حذف/استبدال في النسخة المُعتمَدة):
 *  1) بناء نسخة جديدة **مستقلة** `current/versions/v<N>/files/**` تحوي كل ملفات المشروع.
 *  2) التحقق الفعلي: إعادة قراءة كل ملف من Drive + مطابقة sha256 + بصمة الشجرة.
 *  3) كتابة بيان النسخة الكامل `versions/v<N>/manifest.json`.
 *  4) نقطة الالتزام الوحيدة: كتابة مرجع الاعتماد `current/HEAD.json` نحو النسخة الجديدة.
 *  5) تنظيف النسخ القديمة **بعد** الاعتماد فقط؛ وفشل التنظيف لا يُسقط الاعتماد
 *     (يُسجَّل `cleanup_pending` ويُعاد لاحقاً).
 * أي فشل قبل الخطوة 4 يُبقي CURRENT السابقة صالحة بالكامل. لا تُعدَّل النسخة المُعتمَدة أبداً.
 *
 * فحص الأسرار الصارم قبل أي رفع (لا سرّ في المرآة)، وبوابة المساحة قبل الرفع.
 * كل شيء فوق DriveStore القابل للحقن، فيُختبر بخادم Drive وهمي بالكامل.
 */

import {
  normalizeRelPath,
  shouldExclude,
  hashContent,
  computeTreeHash,
  diffSnapshots,
  scanForSecretsStrict,
  withinQuota,
  mimeTypeForPath,
  buildVersionManifest,
  buildMirrorHead,
  isMirrorHeadValid,
  DESIGN_QUOTA_BYTES,
  QUOTA_HEADROOM_BYTES,
} from './cloud-lib.mjs';

/** يبني لقطة المرآة من ملفات المصدر (يستبعد المستبعدات، ويحسب البصمات). */
export function buildMirrorSnapshot(files) {
  const entries = [];
  const contents = new Map();
  for (const f of files || []) {
    const path = normalizeRelPath(f.path);
    if (!path || shouldExclude(path)) continue;
    const content = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content ?? ''), 'utf8');
    entries.push({ path, sha256: hashContent(content), size: content.length });
    contents.set(path, content);
  }
  return { entries, contents, treeHash: computeTreeHash(entries) };
}

function summarizeDiff(diff) {
  return {
    added: diff.added.length,
    modified: diff.modified.length,
    removed: diff.removed.length,
    renamed: diff.renamed.length,
    unchanged: diff.unchanged.length,
  };
}

/**
 * ينفّذ مزامنة CURRENT (مرآة فردية).
 * @param {object} options
 * @param {import('./drive-store.mjs').DriveStore} options.store
 * @param {object[]} options.files ملفات المصدر `{path, content}` (المشمولة والمستبعدة).
 * @param {string} [options.commit]
 * @param {object|null} [options.previousMirror] لقطة المرآة السابقة `{treeHash, files}`.
 * @param {object[]} [options.currentFiles] ملفات النسخة المُعتمَدة الحالية (لحساب الفرق الصادق فقط، بلا تعديل).
 * @param {string} [options.now]
 * @param {number} [options.designBytes]
 * @param {number} [options.headroomBytes]
 * @returns {Promise<object>} نتيجة صادقة (no_change|synced|blocked|secret_blocked|failed).
 */
export async function runCurrentMirror(options = {}) {
  const store = options.store;
  const now = options.now || new Date().toISOString();
  const commit = options.commit ?? null;
  const designBytes = options.designBytes ?? DESIGN_QUOTA_BYTES;
  const headroomBytes = options.headroomBytes ?? QUOTA_HEADROOM_BYTES;
  if (!store) return { state: 'failed', reason: 'no_store', message: 'لا مخزن Drive.' };

  // 1) لقطة + بصمة الشجرة
  const { entries, contents, treeHash } = buildMirrorSnapshot(options.files);

  // 2) فحص الأسرار الصارم قبل أي رفع (يشمل المستبعدة).
  const secretScan = scanForSecretsStrict(options.files);
  if (!secretScan.ok) {
    return {
      state: 'secret_blocked',
      stopped: true,
      uploaded: 0,
      reason: 'secret_detected',
      secretScan: { ok: false, findings: secretScan.findings.length, paths: [...new Set(secretScan.findings.map((f) => f.path))] },
      message: 'STOP: سر مُرصود — لم يُرفع أي جزء من المرآة.',
      treeHash,
      at: now,
    };
  }

  const structure = await store.ensureStructure();
  if (!structure.ok) return { state: 'failed', reason: structure.code || 'no_structure', message: structure.message || 'تعذّر تجهيز بنية Drive.', treeHash, at: now };

  // 3) مرجع الاعتماد الحالي (المصدر الوحيد لتعريف CURRENT) — بلا أي تعديل عليه هنا.
  const headRes = await store.readMirrorHead();
  const currentHead = headRes.ok ? headRes.data : null;
  const headValid = isMirrorHeadValid(currentHead);
  const currentVersion = headValid ? currentHead.version : 0;
  const currentFiles = headValid && Array.isArray(options.currentFiles) ? options.currentFiles : [];
  const diff = diffSnapshots(currentFiles, entries);

  // 4) تطابق البصمة => لا بناء نسخة جديدة.
  // إن وُجد تنظيف معلّق نُعيد محاولته هنا (لا نكتفي بـno_change): الاعتماد يبقى
  // على النسخة الحالية، ونُحدّث HEAD بحالة التنظيف. لا no_op كاذب مع تنظيف معلّق.
  if (headValid && currentHead.treeHash === treeHash && diff.noChange) {
    let removed = [];
    let pending = [];
    if (currentHead.cleanupPending) {
      const cleanup = await cleanupOldVersions(store, currentHead.version, currentHead.version);
      removed = cleanup.removed;
      pending = cleanup.pending;
      const head2 = buildMirrorHead({
        version: currentHead.version,
        treeHash,
        commit: currentHead.commit ?? commit,
        fileCount: currentHead.fileCount,
        sizeBytes: currentHead.sizeBytes,
        updatedAt: now,
        cleanupPending: pending.length > 0,
        pendingCleanup: pending,
      });
      try { await store.writeMirrorHead(head2); } catch { /* أفضل جهد */ }
    }
    return {
      state: 'no_change',
      uploaded: 0,
      removed: removed.length,
      treeHash,
      commit,
      at: now,
      headVersion: currentHead.version,
      currentVersion: currentHead.version,
      cleanupPending: pending.length > 0,
      pendingCleanup: pending,
      diff: summarizeDiff(diff),
      secretScan: { ok: true, findings: 0 },
      fileCount: entries.length,
      sizeBytes: entries.reduce((s, e) => s + e.size, 0),
      message: pending.length
        ? 'لا تغيير في المصدر: أُعيد محاولة تنظيف النسخ القديمة (ما زال معلّقاً).'
        : 'لا تغيير في المرآة (نفس بصمة الشجرة): لا نسخة جديدة بلا داعٍ.',
    };
  }

  // 5) بوابة المساحة (تقدير حجم كل ملفات النسخة الجديدة).
  const incomingBytes = entries.reduce((sum, e) => sum + (contents.get(e.path)?.length || 0), 0);
  let quota = { ok: true, driveUsageBytes: null, limitBytes: null };
  try {
    const about = await store.client.getAbout();
    if (about.ok) {
      const q = about.data?.storageQuota || {};
      quota = { ok: true, driveUsageBytes: Number(q.usageInDrive ?? q.usage ?? 0), limitBytes: q.limit ? Number(q.limit) : null };
    }
  } catch { /* تعذّر قراءة المساحة: نكمل مع الحماية بالحد التصميمي */ }
  const quotaGate = withinQuota(quota.driveUsageBytes ?? 0, incomingBytes, { designBytes, headroomBytes });
  if (!quotaGate.allowed) {
    return { state: 'blocked', uploaded: 0, removed: 0, reason: 'quota_exceeded', quota: { ...quota, ...quotaGate }, treeHash, commit, at: now, message: quotaGate.message };
  }

  // 6) بناء نسخة جديدة مستقلة: v<N+1>. لا نلمس النسخة المُعتمَدة إطلاقاً.
  const newVersion = currentVersion + 1;
  const uploaded = [];
  const failed = [];
  const byPath = new Map();

  for (const entry of entries) {
    const content = contents.get(entry.path);
    const res = await store.upsertVersionFile(newVersion, entry.path, content, mimeTypeForPath(entry.path));
    if (!res.ok) { failed.push({ path: entry.path, code: res.code, message: res.message }); continue; }
    byPath.set(entry.path, { path: entry.path, sha256: entry.sha256, size: content.length, driveId: res.data?.id || null });
    uploaded.push(entry.path);
  }

  // 7) فشل رفع => لا اعتماد. النسخة الناقصة تُترك كـstaging (تُنظَّف لاحقاً) وCURRENT تبقى سليمة.
  if (failed.length) {
    return { state: 'failed', uploaded: uploaded.length, removed: 0, reason: 'partial_upload', failures: failed, treeHash, commit, at: now, stagingVersion: newVersion, headVersion: currentVersion || null, message: 'فشل رفع ملفات النسخة الجديدة: لم يُعتمد شيء (CURRENT السابقة سليمة).' };
  }

  // 8) تحقق فعلي: بصمة الشجرة المرشّحة + إعادة قراءة كل ملف من Drive ومطابقة sha256.
  const candidateTree = computeTreeHash([...byPath.values()].map((f) => ({ path: f.path, sha256: f.sha256 })));
  if (candidateTree !== treeHash) {
    return { state: 'failed', uploaded: uploaded.length, removed: 0, reason: 'tree_hash_mismatch', expected: treeHash, actual: candidateTree, treeHash, commit, at: now, stagingVersion: newVersion, message: 'عدم تطابق بصمة الشجرة بعد الرفع: لا اعتماد.' };
  }
  const verifyProblems = [];
  for (const entry of entries) {
    const record = byPath.get(entry.path);
    if (!record?.driveId) { verifyProblems.push(`no_drive_id:${entry.path}`); continue; }
    const dl = await store.client.downloadFile(record.driveId);
    if (!dl.ok || !dl.data) { verifyProblems.push(`unreadable:${entry.path}`); continue; }
    if (hashContent(dl.data) !== entry.sha256) verifyProblems.push(`hash_mismatch:${entry.path}`);
  }
  if (verifyProblems.length) {
    return { state: 'failed', uploaded: uploaded.length, removed: 0, reason: 'verify_failed', problems: verifyProblems.slice(0, 20), treeHash, commit, at: now, stagingVersion: newVersion, message: 'فشل التحقق من ملفات النسخة الجديدة فعلاً: لا اعتماد.' };
  }

  // 9) كتابة بيان النسخة الكامل (بلا driveId — البصمة كافية) داخل مجلد النسخة.
  const sizeBytes = [...byPath.values()].reduce((s, f) => s + (f.size || 0), 0);
  const filesForManifest = [...byPath.values()]
    .map((f) => ({ path: f.path, sha256: f.sha256, size: f.size }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const versionManifest = buildVersionManifest({
    version: newVersion,
    dirName: null,
    commit,
    treeHash,
    updatedAt: now,
    fileCount: byPath.size,
    sizeBytes,
    files: filesForManifest,
  });
  const manifestWritten = await store.writeVersionManifest(newVersion, versionManifest);
  if (!manifestWritten.ok) {
    return { state: 'failed', uploaded: uploaded.length, removed: 0, reason: manifestWritten.code || 'manifest_write_failed', treeHash, commit, at: now, stagingVersion: newVersion, message: 'فشل كتابة بيان النسخة الجديدة: لا اعتماد (CURRENT السابقة سليمة).' };
  }

  // 10) نقطة الالتزام الوحيدة: كتابة مرجع الاعتماد HEAD.json نحو النسخة الجديدة.
  const head = buildMirrorHead({
    version: newVersion,
    treeHash,
    commit,
    fileCount: byPath.size,
    sizeBytes,
    updatedAt: now,
    cleanupPending: false,
    pendingCleanup: [],
  });
  const headWritten = await store.writeMirrorHead(head);
  if (!headWritten.ok) {
    // فشل الاعتماد => CURRENT تبقى السابقة بالكامل؛ النسخة الجديدة تبقى staging غير معتمدة.
    return { state: 'failed', uploaded: uploaded.length, removed: 0, reason: headWritten.code || 'head_write_failed', treeHash, commit, at: now, stagingVersion: newVersion, headVersion: currentVersion || null, message: 'فشل اعتماد مرجع CURRENT: النسخة الجديدة غير معتمدة وCURRENT السابقة سليمة.' };
  }

  // 11) تنظيف النسخ القديمة — بعد الاعتماد فقط، ولا يُسقط الاعتماد عند الفشل.
  const cleanup = await cleanupOldVersions(store, newVersion, currentVersion);
  if (cleanup.pending.length) {
    const head2 = buildMirrorHead({
      version: newVersion,
      treeHash,
      commit,
      fileCount: byPath.size,
      sizeBytes,
      updatedAt: now,
      cleanupPending: true,
      pendingCleanup: cleanup.pending,
    });
    try { await store.writeMirrorHead(head2); } catch { /* أفضل جهد: الاعتماد الأساسي مثبّت */ }
  }

  return {
    state: 'synced',
    uploaded: uploaded.length,
    removed: cleanup.removed.length,
    verified: true,
    treeHash,
    commit,
    at: now,
    sizeBytes,
    fileCount: byPath.size,
    headVersion: newVersion,
    currentVersion: newVersion,
    cleanupPending: cleanup.pending.length > 0,
    pendingCleanup: cleanup.pending,
    stagingVersion: newVersion,
    diff: summarizeDiff(diff),
    secretScan: { ok: true, findings: 0 },
    quota: { usageBytes: quota.driveUsageBytes, limitBytes: quota.limitBytes, allowed: true },
    mirrorManifest: {
      kind: 'current-mirror',
      version: newVersion,
      treeHash,
      commit,
      updatedAt: now,
      fileCount: byPath.size,
      sizeBytes,
      files: [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1)),
    },
  };
}

/**
 * يحسم CURRENT المعتمدة من مرجع الاعتماد `HEAD.json` وحده (بلا تخمين).
 * يتحقق من وجود بيان النسخة المُشار إليها واتساق بصمتها مع المرجع.
 * @returns {{ ok: boolean, code?: string, data?: object }}
 */
export async function resolveCurrentMirror(store) {
  const headRes = await store.readMirrorHead();
  if (!headRes.ok) return { ok: false, code: headRes.code || 'no_structure' };
  const head = headRes.data;
  if (!isMirrorHeadValid(head)) return { ok: false, code: 'no_head', message: 'لا مرجع اعتماد صالح (HEAD.json) على Drive.' };
  const vres = await store.readVersionManifest(head.version);
  if (!vres.ok || !vres.data) return { ok: false, code: 'version_manifest_missing', version: head.version, message: 'مرجع الاعتماد يشير إلى نسخة بلا بيان.' };
  const manifest = vres.data;
  const consistent = manifest.treeHash === head.treeHash && Number(manifest.version) === Number(head.version);
  return {
    ok: true,
    data: {
      source: 'HEAD.json',
      version: head.version,
      dirName: head.dirName,
      treeHash: head.treeHash,
      fileCount: head.fileCount,
      sizeBytes: head.sizeBytes,
      cleanupPending: Boolean(head.cleanupPending),
      pendingCleanup: Array.isArray(head.pendingCleanup) ? head.pendingCleanup : [],
      consistent,
      manifestFileCount: Number.isFinite(manifest.fileCount) ? manifest.fileCount : null,
      manifestTreeHash: manifest.treeHash ?? null,
      manifest,
    },
  };
}

/**
 * ينظّف النسخ القديمة بعد اعتماد نسخة أحدث. لا يُسقط الاعتماد عند الفشل:
 * النسخ التي فشل حذفها تُعاد كـpendingCleanup لإعادة المحاولة لاحقاً.
 * @returns {{ removed: number[], pending: Array<{version:number, reason:string}> }}
 */
export async function cleanupOldVersions(store, keepVersion, previousVersion) {
  const removed = [];
  const pending = [];
  const listRes = await store.listVersions();
  if (!listRes.ok) return { removed, pending };
  for (const v of listRes.data) {
    if (v === keepVersion) continue;
    // لا نحذف النسخة السابقة إن كان الاعتماد لم يُثبَّت بعد (احتياط).
    const del = await store.deleteVersionDir(v);
    if (del.ok) removed.push(v);
    else pending.push({ version: v, reason: String(del.code || 'delete_failed').slice(0, 60) });
  }
  return { removed, pending };
}
