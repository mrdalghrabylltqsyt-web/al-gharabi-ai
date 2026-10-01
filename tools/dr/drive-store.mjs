/**
 * مخزن Drive: يبني البنية `al-gharabi-ai-dr/{current,history,db}` ويدير
 * نقاط الاستعادة المستقلة غير القابلة للاستبدال، ويضمن أن `rp-001` يمثل
 * الـcommit المعتمد بالضبط.
 *
 * كل الأساليب تعمل فوق DriveClient (وبالتالي فوق ناقل قابل للحقن)، فتُختبر
 * بخادم Drive وهمي بالكامل بلا مزود حقيقي. لا سرّ يُخزَّن أو يُسجَّل هنا.
 */

import crypto from 'node:crypto';
import {
  DR_FOLDER_NAME,
  DR_SUBDIRS,
  RP_001_ID,
  RP_001_COMMIT,
  buildRecoveryManifest,
  assertRp001Manifest,
  isValidRestorePointId,
  classifyDbDump,
  encodeFileName,
  normalizeRelPath,
  toBuffer,
  mimeTypeForPath,
  dirSegments,
  isEncryptedSecretsPackage,
  SOURCE_BUNDLE_NAME,
  SOURCE_BUNDLE_VERSION,
  DB_DUMP_NAME,
  CURRENT_STATE_NAME,
  RECOVERY_MANIFEST_NAME,
  SECRETS_PACKAGE_NAME,
  LATEST_RECOVERY_NAME,
  MIRROR_MANIFEST_NAME,
  MIRROR_DIR_NAME,
} from './cloud-lib.mjs';

export const CURRENT_MANIFEST_NAME = 'manifest.json';
export const RESTORE_MANIFEST_NAME = 'manifest.json';
export const HISTORY_INDEX_NAME = 'history.json';

function md5Hex(content) {
  return crypto.createHash('md5').update(Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')).digest('hex');
}

export class DriveStore {
  constructor({ client, folderName = DR_FOLDER_NAME, storedIdentity = null, readOnlyStructure = false }) {
    if (!client) throw new Error('DriveStore يحتاج DriveClient.');
    this.client = client;
    this.folderName = folderName;
    this.storedIdentity = storedIdentity || null;
    this.readOnlyStructure = readOnlyStructure === true;
    this.structure = null;
    this._mirrorRootId = null;
    this._mirrorDirs = new Map();
  }

  // ------------------------------------------------------------------
  // البنية
  // ------------------------------------------------------------------

  async ensureStructure() {
    if (this.structure) return { ok: true, data: this.structure };
    const res = await this.client.ensureStructure(this.storedIdentity, { create: !this.readOnlyStructure });
    if (!res.ok) return res;
    this.structure = res.data;
    return { ok: true, data: this.structure };
  }

  /**
   * هوية البنية المحفوظة: معرّفات الجذر والمجلدات الفرعية. تُخزَّن مشفّرة في
   * حالة الخادم فلا نعتمد على مجلد موجود مسبقاً ولا على مرجع root.
   */
  structureIdentity() {
    if (!this.structure) return null;
    return { rootId: this.structure.rootId, subdirs: { ...this.structure.subdirs } };
  }

  async subdirId(name) {
    const s = await this.ensureStructure();
    if (!s.ok) return null;
    return s.data.subdirs[name] || null;
  }

  async listChildren(parentId) {
    const res = await this.client.listChildren(parentId);
    if (!res.ok) return res;
    return { ok: true, data: res.data?.files || [] };
  }

  async findChild(parentId, name) {
    const list = await this.listChildren(parentId);
    if (!list.ok) return list;
    return { ok: true, data: list.data.find((f) => f.name === name) || null };
  }

  /** إنشاء أو استبدال ملف باسم محدّد داخل مجلد (idempotent). */
  async upsertFile(parentId, name, content, mimeType = 'application/octet-stream') {
    const found = await this.findChild(parentId, name);
    if (!found.ok) return found;
    if (found.data) {
      const updated = await this.client.updateFileContent(found.data.id, content, mimeType);
      if (!updated.ok) return updated;
      return { ok: true, data: { id: found.data.id, name, created: false }, status: updated.status };
    }
    const created = await this.client.createFile({ name, parentId, content, mimeType });
    if (!created.ok) return created;
    return { ok: true, data: { id: created.data?.id, name, created: true }, status: created.status };
  }

  async readFile(fileId) {
    return this.client.downloadFile(fileId);
  }

  async readJsonChild(parentId, name) {
    const found = await this.findChild(parentId, name);
    if (!found.ok) return found;
    if (!found.data) return { ok: true, data: null };
    const dl = await this.readFile(found.data.id);
    if (!dl.ok) return dl;
    try {
      const text = Buffer.isBuffer(dl.data) ? dl.data.toString('utf8') : String(dl.data ?? '');
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, code: 'invalid_json', message: `ملف ${name} ليس JSON صالحاً.` };
    }
  }

  async writeJson(parentId, name, obj) {
    return this.upsertFile(parentId, name, JSON.stringify(obj, null, 2), 'application/json');
  }

  async removeChild(parentId, name) {
    const found = await this.findChild(parentId, name);
    if (!found.ok) return found;
    if (!found.data) return { ok: true, data: { removed: false } };
    const del = await this.client.deleteFile(found.data.id);
    if (!del.ok) return del;
    return { ok: true, data: { removed: true, id: found.data.id } };
  }

  // ------------------------------------------------------------------
  // current/
  // ------------------------------------------------------------------

  async readCurrentManifest() {
    const id = await this.subdirId('current');
    if (!id) return { ok: false, code: 'no_structure', message: 'بنية Drive غير مهيّأة.' };
    return this.readJsonChild(id, CURRENT_MANIFEST_NAME);
  }

  async writeCurrentManifest(manifest) {
    const id = await this.subdirId('current');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.writeJson(id, CURRENT_MANIFEST_NAME, manifest);
  }

  // ------------------------------------------------------------------
  // history/ — نقاط استعادة مستقلة وغير قابلة للاستبدال
  // ------------------------------------------------------------------

  async listRestorePoints() {
    const historyId = await this.subdirId('history');
    if (!historyId) return { ok: false, code: 'no_structure' };
    const list = await this.listChildren(historyId);
    if (!list.ok) return list;
    const points = [];
    for (const folder of list.data.filter((f) => f.mimeType === 'application/vnd.google-apps.folder')) {
      const manifest = await this.readJsonChild(folder.id, RESTORE_MANIFEST_NAME);
      points.push({ id: folder.name, folderId: folder.id, manifest: manifest.ok ? manifest.data : null });
    }
    points.sort((a, b) => (a.id < b.id ? -1 : 1));
    return { ok: true, data: points };
  }

  async getRestorePoint(id) {
    const points = await this.listRestorePoints();
    if (!points.ok) return points;
    return { ok: true, data: points.data.find((p) => p.id === id) || null };
  }

  /**
   * ينشئ نقطة استعادة جديدة. **يرفض** إن وُجدت (immutability): لا تُعدّل نقطة
   * موجودة أبداً. `rp-001` له تحقق إضافي مقابل الـcommit المعتمد.
   */
  async createRestorePoint(id, { commit, files, note, parentId, dbBackupId, dbEncrypted } = {}) {
    if (!isValidRestorePointId(id)) return { ok: false, code: 'invalid_id', message: `معرّف نقطة استعادة غير صالح: ${id}` };
    const historyId = await this.subdirId('history');
    if (!historyId) return { ok: false, code: 'no_structure' };

    const existing = await this.findChild(historyId, id);
    if (!existing.ok) return existing;
    if (existing.data) {
      return { ok: false, code: 'immutable_restore_point', message: `نقطة الاستعادة ${id} موجودة: لا يجوز تعديل نقطة موجودة.` };
    }

    const manifest = buildRecoveryManifest({
      id,
      commit,
      note,
      parentId: parentId ?? null,
      dbBackupId: dbBackupId ?? null,
      dbEncrypted: dbEncrypted === true,
      treeHash: null,
      fileCount: (files || []).length,
      sizeBytes: (files || []).reduce((sum, f) => sum + Buffer.byteLength(f.content ?? ''), 0),
    });
    if (id === RP_001_ID) {
      const check = assertRp001Manifest(manifest);
      if (!check.ok) return { ok: false, code: check.reason, message: `rp-001 يجب أن يمثل الـcommit ${RP_001_COMMIT}.` };
    }

    const created = await this.client.createFolder(id, historyId);
    if (!created.ok) return created;
    const folderId = created.data?.id;

    // نكتب الملفات أولاً ثم البيان آخراً: وجود البيان يعني نقطة مكتملة.
    for (const file of files || []) {
      const res = await this.upsertFile(folderId, encodeFileName(file.path), file.content, file.mimeType || 'application/octet-stream');
      if (!res.ok) return res;
    }
    const written = await this.writeJson(folderId, RESTORE_MANIFEST_NAME, manifest);
    if (!written.ok) return written;
    return { ok: true, data: { id, folderId, manifest } };
  }

  /**
   * يضمن وجود `rp-001` مرتبطاً بالـcommit المعتمد. إن وُجد لا يُعدّل، وإن كان
   * مرتبطاً بغير الـcommit يُعلن الانحراف صراحةً.
   */
  async ensureRp001({ files, note } = {}) {
    const existing = await this.getRestorePoint(RP_001_ID);
    if (!existing.ok) return existing;
    if (existing.data) {
      const check = assertRp001Manifest(existing.data.manifest);
      if (!check.ok) return { ok: false, code: check.reason, message: 'rp-001 موجود لكنه لا يمثل الـcommit المعتمد.' };
      return { ok: true, data: { id: RP_001_ID, created: false, manifest: existing.data.manifest } };
    }
    const created = await this.createRestorePoint(RP_001_ID, { commit: RP_001_COMMIT, files, note });
    if (!created.ok) return created;
    return { ok: true, data: { id: RP_001_ID, created: true, manifest: created.data.manifest } };
  }

  // ------------------------------------------------------------------
  // db/ — رفض الخام، قبول المشفّر فقط
  // ------------------------------------------------------------------

  /** يرفع نسخة DB **مشفّرة** فقط. أي محتوى خام يُرفض بلا رفع أي جزء. */
  async uploadDbDump(name, content) {
    const verdict = classifyDbDump(content);
    if (!verdict.allowed) {
      return { ok: false, code: verdict.reason || 'not_an_encrypted_dump', message: 'المسموح فقط DB encrypted dump؛ لا يُرفع أي جزء.' };
    }
    const dbId = await this.subdirId('db');
    if (!dbId) return { ok: false, code: 'no_structure' };
    const res = await this.upsertFile(dbId, name, content, 'application/octet-stream');
    if (!res.ok) return res;
    return { ok: true, data: { id: res.data.id, name, encrypted: true } };
  }

  /** يحذف نسخة DB مشفّرة (تنظيف نسخة مؤقتة بعد ترقيتها إلى current). */
  async removeDbDump(name) {
    const dbId = await this.subdirId('db');
    if (!dbId) return { ok: false, code: 'no_structure' };
    return this.removeChild(dbId, name);
  }

  // ------------------------------------------------------------------
  // current/ + history/ — ملفات النسخة (source.tar.gz + database.enc)
  // ------------------------------------------------------------------

  /**
   * يرفع ملفات النسخة (الحزمة المصدرية + قاعدة البيانات المشفّرة) إلى مجلد
   * `current/`. يرفض أي قاعدة بيانات خام قبل أي رفع. يكتب الملفات أولاً ثم البيان
   * آخراً، فلا يُعلَن `current` مكتملاً قبل وجود ملفاته فعلاً.
   * @param {{ bundle?: Buffer|string, bundleName?: string, dbEncrypted?: Buffer|string, dbName?: string, manifest?: object }} payload
   */
  async writeCurrentVersion({ bundle, bundleName = SOURCE_BUNDLE_NAME, dbEncrypted, dbName = DB_DUMP_NAME, secrets, secretsManifest, manifest } = {}) {
    const currentId = await this.subdirId('current');
    if (!currentId) return { ok: false, code: 'no_structure' };
    const bundleBuf = Buffer.isBuffer(bundle) ? bundle : Buffer.from(bundle ?? '');
    if (!bundleBuf.length) return { ok: false, code: 'missing_bundle' };
    const dbBuf = Buffer.isBuffer(dbEncrypted) ? dbEncrypted : Buffer.from(dbEncrypted ?? '');
    const verdict = classifyDbDump(dbBuf);
    if (!verdict.allowed) return { ok: false, code: verdict.reason || 'not_an_encrypted_dump', message: 'المسموح فقط DB encrypted dump في current.' };
    const secretsBuf = Buffer.isBuffer(secrets) ? secrets : Buffer.from(secrets ?? '');
    if (secretsBuf.length && !isEncryptedSecretsPackage(secretsBuf)) {
      return { ok: false, code: 'not_an_encrypted_secrets_package', message: 'المسموح فقط حزمة أسرار مشفّرة في current.' };
    }

    const b = await this.upsertFile(currentId, bundleName, bundleBuf, 'application/gzip');
    if (!b.ok) return b;
    const d = await this.upsertFile(currentId, dbName, dbBuf, 'application/octet-stream');
    if (!d.ok) return d;
    if (secretsBuf.length) {
      const s = await this.upsertFile(currentId, SECRETS_PACKAGE_NAME, secretsBuf, 'application/octet-stream');
      if (!s.ok) return s;
      if (secretsManifest) {
        const sm = await this.writeJson(currentId, 'secrets-manifest.json', secretsManifest);
        if (!sm.ok) return sm;
      }
    }
    const w = await this.writeJson(currentId, CURRENT_MANIFEST_NAME, manifest);
    if (!w.ok) return w;
    return { ok: true, data: { bundleId: b.data.id, dbId: d.data.id, manifestId: w.data.id } };
  }

  /** يقرأ ملف نسخة من مجلد (current أو نقطة استعادة) ويعيد محتواه الخام. */
  async readVersionFile(parentId, name) {
    const found = await this.findChild(parentId, name);
    if (!found.ok) return found;
    if (!found.data) return { ok: true, data: null };
    const dl = await this.readFile(found.data.id);
    if (!dl.ok) return dl;
    return { ok: true, data: toBuffer(dl.data), fileId: found.data.id };
  }

  /**
   * ينشئ نقطة استعادة تاريخية غير قابلة للتعديل: مجلد `history/<id>/` يحوي
   * `source.tar.gz` و`database.enc` و`manifest.json` (يُكتب أخيراً كدليل اكتمال).
   * يرفض إن وُجدت النقطة (immutability).
   * @param {string} id
   * @param {{ commit?: string, bundle?: Buffer|string, dbEncrypted?: Buffer|string, manifest?: object }} payload
   */
  async createVersionedRestorePoint(id, { commit, bundle, dbEncrypted, secrets, secretsManifest, manifest } = {}) {
    if (!isValidRestorePointId(id)) return { ok: false, code: 'invalid_id', message: `معرّف نقطة استعادة غير صالح: ${id}` };
    const historyId = await this.subdirId('history');
    if (!historyId) return { ok: false, code: 'no_structure' };
    const existing = await this.findChild(historyId, id);
    if (!existing.ok) return existing;
    if (existing.data) return { ok: false, code: 'immutable_restore_point', message: `نقطة الاستعادة ${id} موجودة: لا يجوز تعديل نقطة موجودة.` };

    const bundleBuf = Buffer.isBuffer(bundle) ? bundle : Buffer.from(bundle ?? '');
    if (!bundleBuf.length) return { ok: false, code: 'missing_bundle' };
    const dbBuf = Buffer.isBuffer(dbEncrypted) ? dbEncrypted : Buffer.from(dbEncrypted ?? '');
    const verdict = classifyDbDump(dbBuf);
    if (!verdict.allowed) return { ok: false, code: verdict.reason || 'not_an_encrypted_dump', message: 'المسموح فقط DB encrypted dump في نقطة الاستعادة.' };
    const secretsBuf = Buffer.isBuffer(secrets) ? secrets : Buffer.from(secrets ?? '');
    if (secretsBuf.length && !isEncryptedSecretsPackage(secretsBuf)) {
      return { ok: false, code: 'not_an_encrypted_secrets_package', message: 'المسموح فقط حزمة أسرار مشفّرة في نقطة الاستعادة.' };
    }

    if (id === RP_001_ID) {
      const check = assertRp001Manifest({ ...(manifest || {}), id: RP_001_ID });
      if (!check.ok) return { ok: false, code: check.reason, message: `rp-001 يجب أن يمثل الـcommit ${RP_001_COMMIT}.` };
    }

    const created = await this.client.createFolder(id, historyId);
    if (!created.ok) return created;
    const folderId = created.data?.id;
    const b = await this.upsertFile(folderId, SOURCE_BUNDLE_NAME, bundleBuf, 'application/gzip');
    if (!b.ok) return b;
    const d = await this.upsertFile(folderId, DB_DUMP_NAME, dbBuf, 'application/octet-stream');
    if (!d.ok) return d;
    if (secretsBuf.length) {
      const s = await this.upsertFile(folderId, SECRETS_PACKAGE_NAME, secretsBuf, 'application/octet-stream');
      if (!s.ok) return s;
      if (secretsManifest) {
        const sm = await this.writeJson(folderId, 'secrets-manifest.json', secretsManifest);
        if (!sm.ok) return sm;
      }
    }
    // البيان يُكتب **أخيراً** كدليل على اكتمال النقطة.
    const w = await this.writeJson(folderId, RESTORE_MANIFEST_NAME, manifest);
    if (!w.ok) return w;
    return { ok: true, data: { id, folderId, manifest } };
  }

  async listDbDumps() {
    const dbId = await this.subdirId('db');
    if (!dbId) return { ok: false, code: 'no_structure' };
    return this.listChildren(dbId);
  }

  /** يرفع/يحدّث نسخة DB مشفّرة مستقلة في `db/` (تبقى كمرجع حتى بعد ترقيتها). */
  async keepAliveDbDump(name, content) {
    return this.uploadDbDump(name, content);
  }

  // ------------------------------------------------------------------
  // current-state.json — ملخص المزامنة الحالية (بلا أسرار)
  // ------------------------------------------------------------------

  async writeCurrentState(state) {
    const id = await this.subdirId('current');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.writeJson(id, CURRENT_STATE_NAME, state);
  }

  async readCurrentState() {
    const id = await this.subdirId('current');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.readJsonChild(id, CURRENT_STATE_NAME);
  }

  /** بيان آخر نقطة استعادة مرتبطة بـcurrent (recovery-manifest.json). */
  async writeRecoveryManifest(manifest) {
    const id = await this.subdirId('current');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.writeJson(id, RECOVERY_MANIFEST_NAME, manifest);
  }

  async readRecoveryManifest() {
    const id = await this.subdirId('current');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.readJsonChild(id, RECOVERY_MANIFEST_NAME);
  }

  // ------------------------------------------------------------------
  // current/files/** — مرآة الملفات الحقيقية ببنية المجلدات
  // ------------------------------------------------------------------

  /** يضمن وجود مجلد داخل أب (بحث بالاسم ثم إنشاء). */
  async ensureFolder(parentId, name) {
    const found = await this.findChild(parentId, name);
    if (!found.ok) return found;
    if (found.data && found.data.mimeType === 'application/vnd.google-apps.folder') return { ok: true, data: found.data.id };
    const created = await this.client.createFolder(name, parentId);
    if (!created.ok) return created;
    return { ok: true, data: created.data?.id };
  }

  /** يضمن سلسلة مجلدات تحت `current/files` ويعيد معرّف المجلد الورقي. */
  async ensureMirrorDir(segments) {
    const root = await this.ensureMirrorRoot();
    if (!root.ok) return root;
    let parentId = root.data;
    let key = '';
    for (const seg of segments || []) {
      key = key ? `${key}/${seg}` : seg;
      const cached = this._mirrorDirs.get(key);
      if (cached) { parentId = cached; continue; }
      const ensured = await this.ensureFolder(parentId, seg);
      if (!ensured.ok) return ensured;
      parentId = ensured.data;
      this._mirrorDirs.set(key, parentId);
    }
    return { ok: true, data: parentId };
  }

  /** يضمن وجود مجلد المرآة `current/files`. */
  async ensureMirrorRoot() {
    if (this._mirrorRootId) return { ok: true, data: this._mirrorRootId };
    const currentId = await this.subdirId('current');
    if (!currentId) return { ok: false, code: 'no_structure' };
    const ensured = await this.ensureFolder(currentId, MIRROR_DIR_NAME);
    if (!ensured.ok) return ensured;
    this._mirrorRootId = ensured.data;
    return { ok: true, data: ensured.data };
  }

  /** يرفع/يحدّث ملفاً في المرآة بالمسار النسبي نفسه (بلا ترميز الاسم). */
  async upsertMirrorFile(relPath, content, mimeType) {
    const path = normalizeRelPath(relPath);
    const dir = await this.ensureMirrorDir(dirSegments(path));
    if (!dir.ok) return dir;
    const name = path.split('/').pop();
    const buf = toBuffer(content);
    const res = await this.upsertFile(dir.data, name, buf, mimeType || mimeTypeForPath(path));
    if (!res.ok) return res;
    return { ok: true, data: { id: res.data?.id, name, size: buf.length } };
  }

  /** يقرأ ملفاً من المرآة بمساره النسبي. */
  async readMirrorFile(relPath) {
    const path = normalizeRelPath(relPath);
    const dir = await this.ensureMirrorDir(dirSegments(path));
    if (!dir.ok) return dir;
    return this.readVersionFile(dir.data, path.split('/').pop());
  }

  /** يحذف ملفاً من المرآة بمساره النسبي. */
  async removeMirrorFile(relPath) {
    const path = normalizeRelPath(relPath);
    const dir = await this.ensureMirrorDir(dirSegments(path));
    if (!dir.ok) return dir;
    return this.removeChild(dir.data, path.split('/').pop());
  }

  /** يسرد كل ملفات المرآة بشكل تعاودي: `[{ path, driveId, size }]`. */
  async listMirrorFiles() {
    const root = await this.ensureMirrorRoot();
    if (!root.ok) return root;
    const out = [];
    const walk = async (folderId, prefix) => {
      const list = await this.listChildren(folderId);
      if (!list.ok) return list;
      for (const item of list.data) {
        const rel = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          const res = await walk(item.id, rel);
          if (!res.ok) return res;
        } else {
          out.push({ path: rel, driveId: item.id, size: Number(item.size ?? 0) });
        }
      }
      return { ok: true };
    };
    const res = await walk(root.data, '');
    if (!res.ok) return res;
    out.sort((a, b) => (a.path < b.path ? -1 : 1));
    return { ok: true, data: out };
  }

  async writeMirrorManifest(manifest) {
    const id = await this.subdirId('current');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.writeJson(id, MIRROR_MANIFEST_NAME, manifest);
  }

  async readMirrorManifest() {
    const id = await this.subdirId('current');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.readJsonChild(id, MIRROR_MANIFEST_NAME);
  }

  /** بيان مرآة معلّق (staging) — يُكتب قبل التحقق ثم يُرقّى أو يُزال. */
  async writePendingMirrorManifest(manifest) {
    const id = await this.subdirId('staging');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.writeJson(id, MIRROR_MANIFEST_NAME, manifest);
  }

  async removePendingMirrorManifest() {
    const id = await this.subdirId('staging');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.removeChild(id, MIRROR_MANIFEST_NAME);
  }

  // ------------------------------------------------------------------
  // secrets/ — حزمة الأسرار المشفّرة (secrets.enc) + بيانها
  // ------------------------------------------------------------------

  async writeSecretsPackage(payload, manifest) {
    const id = await this.subdirId('secrets');
    if (!id) return { ok: false, code: 'no_structure' };
    if (!isEncryptedSecretsPackage(payload)) {
      return { ok: false, code: 'not_an_encrypted_secrets_package', message: 'المسموح فقط حزمة أسرار مشفّرة.' };
    }
    const p = await this.upsertFile(id, SECRETS_PACKAGE_NAME, payload, 'application/octet-stream');
    if (!p.ok) return p;
    const m = await this.writeJson(id, CURRENT_MANIFEST_NAME, manifest);
    if (!m.ok) return m;
    return { ok: true, data: { id: p.data?.id, name: SECRETS_PACKAGE_NAME, size: Buffer.byteLength(payload) } };
  }

  async readSecretsPackage() {
    const id = await this.subdirId('secrets');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.readVersionFile(id, SECRETS_PACKAGE_NAME);
  }

  async readSecretsManifest() {
    const id = await this.subdirId('secrets');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.readJsonChild(id, CURRENT_MANIFEST_NAME);
  }

  // ------------------------------------------------------------------
  // recovery/ — وثائق التعافي المستقلة (تُقرأ بلا تشغيل الغرابي)
  // ------------------------------------------------------------------

  async writeRecoveryDoc(name, text) {
    const id = await this.subdirId('recovery');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.upsertFile(id, name, text, 'text/markdown');
  }

  async readRecoveryDoc(name) {
    const id = await this.subdirId('recovery');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.readVersionFile(id, name);
  }

  /** يكتب وثيقة RECOVERY بصيغة JSON (مثل RECOVERY-MANIFEST.json). */
  async writeRecoveryJson(name, obj) {
    const id = await this.subdirId('recovery');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.writeJson(id, name, obj);
  }

  async readRecoveryJson(name) {
    const id = await this.subdirId('recovery');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.readJsonChild(id, name);
  }

  async writeLatestRecovery(obj) {
    const id = await this.subdirId('recovery');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.writeJson(id, LATEST_RECOVERY_NAME, obj);
  }

  async readLatestRecovery() {
    const id = await this.subdirId('recovery');
    if (!id) return { ok: false, code: 'no_structure' };
    return this.readJsonChild(id, LATEST_RECOVERY_NAME);
  }
}

export { md5Hex };
