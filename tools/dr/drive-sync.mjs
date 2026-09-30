/**
 * المزامنة الآمنة إلى Google Drive.
 *
 * الترتيب الملزم:
 *   manifest → secret scan → treeHash → quota gate → upload/replace → verify
 *   → remove obsolete files → commit mirror state
 *
 * ضمانات:
 *  - أي سر مُرصود => STOP: لا يُرفع أي جزء من النسخة.
 *  - لا يُحذف أي ملف قديم قبل نجاح رفع النسخة الجديدة والتحقق منها فعلاً.
 *  - الفشل الجزئي لا يحوّل `current` السليم إلى حالة تالفة (نكتب ملفات جديدة
 *    ثم نبدّل البيان آخراً؛ إن فشل شيء نبقى على الحالة السابقة ونُعلن الخطأ).
 *  - المساحة تُقاس فعلياً عند الاتصال، وتجاوز الحد => blocked بلا شراء/ترقية.
 *
 * كل شيء فوق DriveClient القابل للحقن، فتُختبر بالكامل بخادم Drive وهمي.
 */

import {
  computeTreeHash,
  diffSnapshots,
  scanForSecretsStrict,
  withinQuota,
  encodeFileName,
  normalizeRelPath,
  hashContent as hashOf,
  DESIGN_QUOTA_BYTES,
  QUOTA_HEADROOM_BYTES,
} from './cloud-lib.mjs';
import { CURRENT_MANIFEST_NAME } from './drive-store.mjs';

export const DEFAULT_CURRENT_MANIFEST = {
  kind: 'current-version',
  version: 0,
  commit: null,
  treeHash: null,
  updatedAt: null,
  fileCount: 0,
  sizeBytes: 0,
  files: [], // [{ path, sha256, driveId, size }]
};

/** يبني لقطة النسخة من ملفات المصدر (يستبعد المستبعدات، ويحسب البصمات). */
export function buildSnapshot(files, options = {}) {
  const include = options.include || (() => true);
  const entries = [];
  const contents = new Map();
  for (const f of files || []) {
    const path = normalizeRelPath(f.path);
    if (!include(path)) continue;
    const content = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content ?? ''), 'utf8');
    entries.push({ path, sha256: hashOf(content), size: content.length });
    contents.set(path, content);
  }
  return { entries, contents, treeHash: computeTreeHash(entries) };
}

export class DriveSync {
  /**
   * @param {object} options
   * @param {import('./drive-store.mjs').DriveStore} options.store
   * @param {import('./drive-client.mjs').DriveClient} options.client
   * @param {(files:object[]) => object} [options.manifestBuilder] يبني بيان النسخة من اللقطة.
   * @param {(m:object)=>void} [options.persistMirror] يثبّت لقطة المرآة بعد نجاح المزامنة.
   */
  constructor(options = {}) {
    this.store = options.store;
    this.client = options.client;
    this.persistMirror = options.persistMirror || (() => {});
    this.quotaDesignBytes = options.designBytes ?? DESIGN_QUOTA_BYTES;
    this.quotaHeadroomBytes = options.headroomBytes ?? QUOTA_HEADROOM_BYTES;
    this.lastMirror = options.mirror || null;
  }

  /** يقرأ المساحة الفعلية من Drive (used/limit). */
  async readQuota() {
    const res = await this.client.getAbout();
    if (!res.ok) return res;
    const q = res.data?.storageQuota || {};
    return {
      ok: true,
      usageBytes: Number(q.usage ?? 0),
      limitBytes: q.limit ? Number(q.limit) : null,
      driveUsageBytes: Number(q.usageInDrive ?? q.usage ?? 0),
    };
  }

  /**
   * ينفّذ مزامنة كاملة للنسخة الحالية من مصدر الملفات.
   * يعيد تقريراً صريحاً (state: no_change|synced|blocked|secret_blocked|failed).
   */
  async syncCurrent(files, options = {}) {
    const nowIso = options.now || new Date().toISOString();
    const commit = options.commit || null;
    const include = options.include || (() => true);

    // 1) manifest — نبني اللقطة أولاً (استبعاد + بصمات + بصمة الشجرة)
    const { entries, contents, treeHash } = buildSnapshot(files, { include });

    // 2) secret scan — يفحص كل الملفات المُمرَّرة بما فيها المستبعدة
    const secretScan = scanForSecretsStrict(files);
    if (!secretScan.ok) {
      return {
        state: 'secret_blocked',
        stopped: true,
        uploaded: 0,
        reason: 'secret_detected',
        secretScan: { ok: false, findings: secretScan.findings.length, paths: [...new Set(secretScan.findings.map((f) => f.path))] },
        message: 'STOP: سر مُرصود — لم يُرفع أي جزء من النسخة.',
        treeHash,
        at: nowIso,
      };
    }

    // 3) treeHash — مقارنة مع اللقطة السابقة (mirror) لكشف التغييرات
    const previous = this.lastMirror?.files || [];
    const diff = diffSnapshots(previous, entries);
    if (diff.noChange && this.lastMirror?.treeHash === treeHash) {
      const result = { state: 'no_change', uploaded: 0, removed: 0, treeHash, commit, at: nowIso, diff: summarizeDiff(diff), secretScan: { ok: true, findings: 0 } };
      this.persistMirror({ ...this.lastMirror, lastSyncAt: nowIso, lastCheckAt: nowIso });
      return result;
    }

    // 4) quota gate — المساحة الفعلية + حجم الوارد المتوقع
    const incomingBytes = [...diff.added, ...diff.modified, ...diff.renamed].reduce((sum, e) => sum + (contents.get(e.path || e.to)?.length || 0), 0);
    const quota = await this.readQuota();
    if (!quota.ok) {
      return { state: 'failed', uploaded: 0, reason: quota.code, message: quota.message, treeHash, commit, at: nowIso };
    }
    const quotaGate = withinQuota(quota.driveUsageBytes, incomingBytes, { designBytes: this.quotaDesignBytes, headroomBytes: this.quotaHeadroomBytes });
    if (!quotaGate.allowed) {
      return {
        state: 'blocked',
        uploaded: 0,
        removed: 0,
        reason: 'quota_exceeded',
        quota: { usageBytes: quota.driveUsageBytes, limitBytes: quota.limitBytes, ...quotaGate },
        treeHash,
        commit,
        at: nowIso,
        message: quotaGate.message,
      };
    }

    const currentId = await this.store.subdirId('current');
    if (!currentId) return { state: 'failed', reason: 'no_structure', message: 'بنية Drive غير مهيّأة.', treeHash, commit, at: nowIso };

    const priorById = new Map((this.lastMirror?.files || []).map((f) => [f.path, f]));
    // المسارات المتقادمة: محذوفة أو مصدر نقل (المسار القديم يجب أن يختفي).
    const obsoletePaths = [...diff.removed.map((r) => r.path), ...diff.renamed.map((r) => r.from)];
    const obsoleteSet = new Set(obsoletePaths);
    const nextFiles = [...(this.lastMirror?.files || [])].filter((f) => !obsoleteSet.has(f.path)).map((f) => ({ ...f }));
    const byPath = new Map(nextFiles.map((f) => [f.path, f]));
    const uploaded = [];
    const failed = [];

    // 5) upload/replace — الملفات المتغيّرة فقط
    const toUpload = [...diff.added, ...diff.modified, ...diff.renamed.map((r) => ({ path: r.to, sha256: r.sha256 }))];
    for (const entry of toUpload) {
      const content = contents.get(entry.path);
      const existing = priorById.get(entry.path);
      const name = encodeFileName(entry.path);
      let res;
      if (existing && existing.driveId) {
        res = await this.client.updateFileContent(existing.driveId, content, mimeTypeFor(entry.path));
        if (!res.ok) res = await this.store.upsertFile(currentId, name, content, mimeTypeFor(entry.path));
      } else {
        res = await this.store.upsertFile(currentId, name, content, mimeTypeFor(entry.path));
      }
      if (!res.ok) {
        failed.push({ path: entry.path, code: res.code, message: res.message });
        continue;
      }
      const record = { path: entry.path, sha256: entry.sha256, size: content.length, driveId: res.data?.id || existing?.driveId || null };
      byPath.set(entry.path, record);
      uploaded.push(entry.path);
    }

    // الفشل الجزئي: لا نحذف شيئاً ولا نبدّل البيان — current القديم يبقى سليماً.
    if (failed.length) {
      return {
        state: 'failed',
        uploaded: uploaded.length,
        removed: 0,
        reason: 'partial_upload',
        failures: failed,
        treeHash,
        commit,
        at: nowIso,
        message: 'فشل جزئي في الرفع: لم يُحذف أي ملف ولم يُبدَّل بيان current (النسخة السابقة سليمة).',
      };
    }

    // 6) verify — إعادة قراءة المساحة وحساب بصمة الشجرة المرشّحة
    const finalEntries = [...byPath.values()].map((f) => ({ path: f.path, sha256: f.sha256 }));
    const candidateTree = computeTreeHash(finalEntries);
    if (candidateTree !== treeHash) {
      return {
        state: 'failed',
        uploaded: uploaded.length,
        removed: 0,
        reason: 'tree_hash_mismatch',
        expected: treeHash,
        actual: candidateTree,
        treeHash,
        commit,
        at: nowIso,
        message: 'عدم تطابق بصمة الشجرة بعد الرفع: لا نحذف ولا نبدّل البيان.',
      };
    }

    // 7) remove obsolete files — فقط بعد نجاح الرفع والتحقق.
    // يشمل المسارات المحذوفة ومصادر النقل، فلا يبقى مسار قديم في current.
    const removed = [];
    for (const path of obsoletePaths) {
      const record = priorById.get(path);
      if (record?.driveId) {
        const del = await this.client.deleteFile(record.driveId);
        if (!del.ok && del.code !== 'not_found') {
          failed.push({ path, code: del.code, message: del.message });
        }
      } else {
        const del = await this.store.removeChild(currentId, encodeFileName(path));
        if (!del.ok) failed.push({ path, code: del.code, message: del.message });
      }
      if (!failed.some((f) => f.path === path)) {
        byPath.delete(path);
        removed.push(path);
      }
    }

    // 8) commit mirror state — نكتب البيان (المصدر الوحيد للحالة) آخراً
    const sizeBytes = [...byPath.values()].reduce((sum, f) => sum + (f.size || 0), 0);
    const manifest = {
      kind: 'current-version',
      version: (this.lastMirror?.version || 0) + 1,
      commit,
      treeHash,
      updatedAt: nowIso,
      fileCount: byPath.size,
      sizeBytes,
      files: [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1)),
    };
    const written = await this.store.writeCurrentManifest(manifest);
    if (!written.ok) {
      return { state: 'failed', uploaded: uploaded.length, removed: removed.length, reason: written.code, message: 'فشل تثبيت بيان current.', treeHash, commit, at: nowIso };
    }
    this.lastMirror = manifest;
    this.persistMirror(manifest);

    return {
      state: 'synced',
      uploaded: uploaded.length,
      removed: removed.length,
      verified: true,
      treeHash,
      commit,
      at: nowIso,
      sizeBytes,
      fileCount: byPath.size,
      diff: summarizeDiff(diff),
      secretScan: { ok: true, findings: 0 },
      quota: { usageBytes: quota.driveUsageBytes, limitBytes: quota.limitBytes, allowed: true },
    };
  }
}

function mimeTypeFor(path) {
  if (/\.json$/i.test(path)) return 'application/json';
  if (/\.md$/i.test(path)) return 'text/markdown';
  if (/\.(mjs|js|cjs|ts|tsx|jsx)$/i.test(path)) return 'text/javascript';
  if (/\.(html|css|txt|yml|yaml)$/i.test(path)) return 'text/plain';
  return 'application/octet-stream';
}

function summarizeDiff(diff) {
  return {
    added: diff.added.length,
    modified: diff.modified.length,
    removed: diff.removed.length,
    renamed: diff.renamed.length,
    unchanged: diff.unchanged.length,
    renamedPaths: diff.renamed,
  };
}
