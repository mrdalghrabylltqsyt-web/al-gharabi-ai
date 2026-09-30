/**
 * مرآة CURRENT الحقيقية — ملفات فردية ببنية المجلدات تحت `current/files/**`.
 *
 * هذا هو الجزء الذي يجعل النسخة على Google Drive قابلة للاستخدام كنسخة تعافٍ
 * مستقلة: كل ملف بمكانه (src/، engine/، tools/، public/…)، لا أرشيف واحد فقط.
 *
 * القواعد الملزمة:
 *  - ملف جديد → يرفع. ملف تغيّر → يحدّث. ملف حُذف → يُحذف من CURRENT. غير متغيّر → لا يُرفع.
 *  - لا يُرقّى `current` إلى الحالة الجديدة قبل التحقق الفعلي (إعادة قراءة وبصمة).
 *  - الفشل الجزئي لا يفسد الحالة السابقة: لا نحذف شيئاً ولا نبدّل البيان.
 *  - فحص الأسرار الصارم قبل أي رفع (لا سرّ في المرآة).
 *  - بوابة المساحة قبل الرفع.
 *
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
  buildMirrorManifest,
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

  // 3) لا تغيير => لا رفع ولا بيان جديد
  const previous = options.previousMirror || null;
  const prevFiles = previous?.files || [];
  const diff = diffSnapshots(prevFiles, entries);
  if (previous && previous.treeHash === treeHash && diff.noChange) {
    return {
      state: 'no_change',
      uploaded: 0,
      removed: 0,
      treeHash,
      commit,
      at: now,
      diff: summarizeDiff(diff),
      secretScan: { ok: true, findings: 0 },
      fileCount: entries.length,
      sizeBytes: entries.reduce((s, e) => s + e.size, 0),
      message: 'لا تغيير في المرآة (نفس بصمة الشجرة): لا رفع بلا داعٍ.',
    };
  }

  // 4) بوابة المساحة
  const incomingBytes = [...diff.added, ...diff.modified, ...diff.renamed].reduce((sum, e) => sum + (contents.get(e.path || e.to)?.length || 0), 0);
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

  const priorById = new Map(prevFiles.map((f) => [f.path, f]));
  const obsoletePaths = [...diff.removed.map((r) => r.path), ...diff.renamed.map((r) => r.from)];
  const obsoleteSet = new Set(obsoletePaths);
  const byPath = new Map(prevFiles.filter((f) => !obsoleteSet.has(f.path)).map((f) => [f.path, { ...f }]));
  const uploaded = [];
  const failed = [];

  // 5) رفع/تحديث الملفات المتغيّرة فقط
  const toUpload = [...diff.added, ...diff.modified, ...diff.renamed.map((r) => ({ path: r.to, sha256: r.sha256 }))];
  for (const entry of toUpload) {
    const content = contents.get(entry.path);
    const res = await store.upsertMirrorFile(entry.path, content, mimeTypeForPath(entry.path));
    if (!res.ok) { failed.push({ path: entry.path, code: res.code, message: res.message }); continue; }
    byPath.set(entry.path, { path: entry.path, sha256: entry.sha256, size: content.length, driveId: res.data?.id || null });
    uploaded.push(entry.path);
  }

  // 6) فشل جزئي => لا حذف ولا ترقية
  if (failed.length) {
    return { state: 'failed', uploaded: uploaded.length, removed: 0, reason: 'partial_upload', failures: failed, treeHash, commit, at: now, message: 'فشل جزئي في الرفع: لم يُحذف شيء ولم تُرقَّ المرآة (الحالة السابقة سليمة).' };
  }

  // 7) تحقق فعلي: بصمة الشجرة المرشّحة + إعادة قراءة الملفات المرفوعة من Drive
  const candidateTree = computeTreeHash([...byPath.values()].map((f) => ({ path: f.path, sha256: f.sha256 })));
  if (candidateTree !== treeHash) {
    return { state: 'failed', uploaded: uploaded.length, removed: 0, reason: 'tree_hash_mismatch', expected: treeHash, actual: candidateTree, treeHash, commit, at: now, message: 'عدم تطابق بصمة الشجرة بعد الرفع: لا ترقية.' };
  }
  const verifyProblems = [];
  for (const entry of toUpload) {
    const record = byPath.get(entry.path);
    if (!record?.driveId) { verifyProblems.push(`no_drive_id:${entry.path}`); continue; }
    const dl = await store.client.downloadFile(record.driveId);
    if (!dl.ok || !dl.data) { verifyProblems.push(`unreadable:${entry.path}`); continue; }
    if (hashContent(dl.data) !== entry.sha256) verifyProblems.push(`hash_mismatch:${entry.path}`);
  }
  if (verifyProblems.length) {
    return { state: 'failed', uploaded: uploaded.length, removed: 0, reason: 'verify_failed', problems: verifyProblems.slice(0, 20), treeHash, commit, at: now, message: 'فشل التحقق من الملفات المرفوعة فعلاً: لا ترقية.' };
  }

  // 8) بيان المرآة المعلّق في staging (دليل قبل الترقية)
  const sizeBytes = [...byPath.values()].reduce((s, f) => s + (f.size || 0), 0);
  const mirrorManifest = buildMirrorManifest({
    version: (previous?.version || 0) + 1,
    commit,
    treeHash,
    updatedAt: now,
    fileCount: byPath.size,
    sizeBytes,
    files: [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1)),
  });
  try { await store.writePendingMirrorManifest(mirrorManifest); } catch { /* أفضل جهد */ }

  // 9) حذف المتقادم من المرآة (بعد نجاح الرفع والتحقق)
  const removed = [];
  for (const path of obsoletePaths) {
    const del = await store.removeMirrorFile(path);
    if (del.ok) { byPath.delete(path); removed.push(path); }
    else failed.push({ path, code: del.code, message: del.message });
  }

  // 10) ترقية المرآة: كتابة البيان في current **آخراً** (نقطة الالتزام)
  const written = await store.writeMirrorManifest(mirrorManifest);
  if (!written.ok) {
    return { state: 'failed', uploaded: uploaded.length, removed: removed.length, reason: written.code, message: 'فشل تثبيت بيان المرآة في current.', treeHash, commit, at: now };
  }
  try { await store.removePendingMirrorManifest(); } catch { /* أفضل جهد */ }

  return {
    state: 'synced',
    uploaded: uploaded.length,
    removed: removed.length,
    verified: true,
    treeHash,
    commit,
    at: now,
    sizeBytes,
    fileCount: byPath.size,
    diff: summarizeDiff(diff),
    secretScan: { ok: true, findings: 0 },
    quota: { usageBytes: quota.driveUsageBytes, limitBytes: quota.limitBytes, allowed: true },
    mirrorManifest,
  };
}
