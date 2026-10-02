/**
 * محرّك الاستعادة — من Google Drive إلى نظام عامل، بمنطق صافٍ قابل للاختبار.
 *
 * الفصل الصريح: هذه الوحدة **لا تكتب فوق الإنتاج أبداً**. تُنتج خطة استعادة،
 * وتُنفّذ استعادة معزولة (drill) في مجلد/قاعدة منفصلة، وتُعيد تقريراً صادقاً.
 * الاستعادة الإنتاجية تبقى قراراً صريحاً للمالك (OWNER CONFIRMATION).
 *
 * الضمانات:
 *  - لا يُعلن نجاح بلا تحقق فعلي (بيان + بصمات + فكّ تشفير + استخراج مصدر).
 *  - لا كتابة فوق نسخة سليمة عند فشل نسخة تالفة/ناقصة/مفتاح خاطئ.
 *  - لا سرّ يُطبع؛ يُعاد عدد الأسماء فقط.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  hashContent,
  toBuffer,
  verifySourceBundle,
  classifyDbDump,
  isEncryptedSecretsPackage,
  evaluateBackupVerification,
  SOURCE_BUNDLE_NAME,
  DB_DUMP_NAME,
  SECRETS_PACKAGE_NAME,
} from './cloud-lib.mjs';
import { decryptDbDump } from './db-crypto.mjs';
import { decryptSecretsPackage, inspectMasterKey } from './secret-crypto.mjs';

/** يفكّ أرشيف tar (بلا gzip) إلى قائمة ملفات بالمحتوى. خطّي بلا مكتبات. */
export function extractTarEntries(tarBuffer) {
  const tar = toBuffer(tarBuffer);
  const files = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.slice(offset, offset + 512);
    const name = header.slice(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break;
    const sizeStr = header.slice(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr || '0', 8) || 0;
    const prefix = header.slice(345, 500).toString('utf8').replace(/\0.*$/, '');
    const fullPath = prefix ? `${prefix}/${name}` : name;
    const start = offset + 512;
    const content = tar.slice(start, start + size);
    files.push({ path: fullPath, content });
    offset = start + Math.ceil(size / 512) * 512;
  }
  return { ok: files.length > 0, files };
}

/** يفكّ حزمة المصدر (gzip → tar) إلى ملفات. */
export function extractSourceBundle(buffer) {
  const gz = toBuffer(buffer);
  if (!gz.length) return { ok: false, code: 'empty_bundle', files: [] };
  let tar;
  try { tar = zlib.gunzipSync(gz); } catch { return { ok: false, code: 'invalid_gzip', files: [] }; }
  const res = extractTarEntries(tar);
  if (!res.ok) return { ok: false, code: 'invalid_tar', files: [] };
  return { ok: true, files: res.files };
}

/** يقرأ ملفات نقطة استعادة من Drive (حزمة + قاعدة مشفّرة + أسرار مشفّرة). */
export async function readRecoveryArtifacts(store, point) {
  const folderId = point?.folderId;
  if (!folderId) return { ok: false, code: 'no_folder', message: 'نقطة الاستعادة بلا مجلد.' };
  const bundle = await store.readVersionFile(folderId, SOURCE_BUNDLE_NAME);
  const db = await store.readVersionFile(folderId, DB_DUMP_NAME);
  const secrets = await store.readVersionFile(folderId, SECRETS_PACKAGE_NAME);
  return {
    ok: true,
    bundle: bundle.ok ? bundle.data : null,
    db: db.ok ? db.data : null,
    secrets: secrets.ok ? secrets.data : null,
    present: { bundle: Boolean(bundle.ok && bundle.data), db: Boolean(db.ok && db.data), secrets: Boolean(secrets.ok && secrets.data) },
  };
}

/**
 * يتحقق من نقطة استعادة: البيان + البصمات + الشكل البنيوي للحزم.
 * لا يفكّ تشفيراً (ذلك خطوة لاحقة صريحة).
 */
export async function verifyRecoveryPoint(store, point) {
  const problems = [];
  const checks = [];
  const manifest = point?.manifest || null;
  if (!manifest) return { ok: false, problems: ['manifest_missing'], checks, manifest: null };
  checks.push('manifest_present');

  const arts = await readRecoveryArtifacts(store, point);
  if (!arts.ok) return { ok: false, problems: [arts.code], checks, manifest };
  if (!arts.present.bundle) problems.push('source_bundle_missing'); else checks.push('source_bundle_present');
  if (!arts.present.db) problems.push('database_missing'); else checks.push('database_present');
  if (!arts.present.secrets) problems.push('secrets_missing'); else checks.push('secrets_present');

  // الحزمة المصدرية: gzip صالح + عدد الملفات يطابق البيان
  if (arts.present.bundle) {
    const vb = verifySourceBundle(arts.bundle, { fileCount: manifest.fileCount });
    if (!vb.ok) problems.push(`source_bundle_${vb.code}`); else checks.push('source_bundle_valid');
    if (manifest.sourceHash && hashContent(arts.bundle) !== manifest.sourceHash) problems.push('source_hash_mismatch'); else if (manifest.sourceHash) checks.push('source_hash_match');
  }
  // قاعدة البيانات: شكل مشفّر + بصمة
  if (arts.present.db) {
    if (!classifyDbDump(arts.db).allowed) problems.push('database_not_encrypted');
    else checks.push('database_encrypted');
    if (manifest.encryptedDatabaseHash && hashContent(arts.db) !== manifest.encryptedDatabaseHash) problems.push('database_hash_mismatch');
    else if (manifest.encryptedDatabaseHash) checks.push('database_hash_match');
  }
  // الأسرار: شكل مشفّر + بصمة
  if (arts.present.secrets) {
    if (!isEncryptedSecretsPackage(arts.secrets)) problems.push('secrets_not_encrypted');
    else checks.push('secrets_encrypted');
    if (manifest.encryptedSecretsHash && hashContent(arts.secrets) !== manifest.encryptedSecretsHash) problems.push('secrets_hash_mismatch');
    else if (manifest.encryptedSecretsHash) checks.push('secrets_hash_match');
  }
  return { ok: problems.length === 0, problems, checks, manifest, artifacts: arts };
}

/** يبني خطة استعادة صادقة للعرض قبل أي تنفيذ (بلا أسرار). */
export async function buildRestorePlan(store, point, options = {}) {
  const verification = await verifyRecoveryPoint(store, point);
  const manifest = point?.manifest || {};
  const env = options.env || process.env;
  return {
    kind: 'restore-plan',
    mode: options.mode === 'production' ? 'production' : 'isolated',
    recoveryPointId: point?.id ?? manifest.id ?? null,
    createdAt: manifest.createdAt ?? null,
    commit: manifest.commit ?? null,
    fileCount: manifest.fileCount ?? null,
    sourceSize: manifest.sourceSize ?? null,
    database: {
      present: verification.artifacts?.present?.db === true,
      encrypted: true,
      hash: manifest.encryptedDatabaseHash ?? null,
      size: manifest.encryptedDatabaseSize ?? null,
    },
    secrets: {
      present: verification.artifacts?.present?.secrets === true,
      encrypted: true,
      hash: manifest.encryptedSecretsHash ?? null,
      size: manifest.encryptedSecretsSize ?? null,
    },
    hashes: {
      treeHash: manifest.treeHash ?? null,
      sourceHash: manifest.sourceHash ?? null,
      encryptedDatabaseHash: manifest.encryptedDatabaseHash ?? null,
      encryptedSecretsHash: manifest.encryptedSecretsHash ?? null,
    },
    verification: { ok: verification.ok, checks: verification.checks, problems: verification.problems },
    masterKey: inspectMasterKey(env),
    /** الاستعادة الإنتاجية تتطلّب تأكيداً صريحاً من المالك. */
    requiresOwnerConfirmation: true,
    productionOverwrite: false,
  };
}

/**
 * ينفّذ استعادة معزولة (drill): تحقق → فكّ أسرار → فكّ قاعدة → استخراج مصدر →
 * كتابة في مجلد معزول (إن مُرِّر). لا يلمس الإنتاج.
 *
 * @param {object} options
 * @param {import('./drive-store.mjs').DriveStore} options.store
 * @param {object} options.point نقطة الاستعادة `{ id, folderId, manifest }`.
 * @param {object} [options.env]
 * @param {string} [options.workDir] مجلد معزول لكتابة المصدر المستعاد.
 * @param {boolean} [options.includeSecrets] هل نفكّ الأسرار (افتراضاً نعم).
 * @param {boolean} [options.includeDatabase] هل نفكّ قاعدة البيانات (افتراضاً نعم).
 * @param {boolean} [options.returnSql] هل نُعيد SQL المفكوك في التقرير (للاستعادة).
 * @param {boolean} [options.returnSecrets] هل نُعيد الأسرار المفكوكة (للاختبار فقط).
 * @param {string} [options.now]
 */
export async function runRecoveryDrill(options = {}) {
  const store = options.store;
  const env = options.env || process.env;
  const now = options.now || new Date().toISOString();
  const point = options.point;
  if (!store || !point) return { ok: false, state: 'failed', reason: 'no_store_or_point', at: now };

  const report = {
    kind: 'recovery-drill',
    at: now,
    recoveryPointId: point.id ?? null,
    commit: point.manifest?.commit ?? null,
    sourceHash: point.manifest?.sourceHash ?? null,
    databaseHash: point.manifest?.encryptedDatabaseHash ?? null,
    secretsHash: point.manifest?.encryptedSecretsHash ?? null,
    fileCount: point.manifest?.fileCount ?? null,
    checks: {},
    problems: [],
    secretsNames: [],
    isolated: true,
    wroteToProduction: false,
  };

  // 1) تحقق
  const verification = await verifyRecoveryPoint(store, point);
  report.checks.manifestAndHashes = verification.ok;
  if (!verification.ok) { report.problems.push(...verification.problems); return { ok: false, state: 'verify_failed', ...report }; }

  const arts = verification.artifacts;

  // 2) فكّ الأسرار (اختياري)
  let secrets = null;
  if (options.includeSecrets !== false && arts.present.secrets) {
    const dec = decryptSecretsPackage(arts.secrets, env);
    report.checks.secretsDecrypt = dec.ok;
    if (!dec.ok) { report.problems.push(`secrets_${dec.code}`); return { ok: false, state: 'secrets_failed', ...report }; }
    secrets = dec.secrets;
    report.secretsNames = Object.keys(secrets).sort();
    report.secretsCount = report.secretsNames.length;
  }

  // 3) فكّ قاعدة البيانات (اختياري)
  let sql = null;
  if (options.includeDatabase !== false && arts.present.db) {
    const dec = decryptDbDump(arts.db, env);
    report.checks.databaseDecrypt = dec.ok;
    if (!dec.ok) { report.problems.push(`database_${dec.code}`); return { ok: false, state: 'database_failed', ...report }; }
    sql = dec.sql;
    report.databaseSqlBytes = Buffer.byteLength(sql);
  }

  // 4) استخراج المصدر
  const extracted = extractSourceBundle(arts.bundle);
  report.checks.sourceExtract = extracted.ok;
  if (!extracted.ok) { report.problems.push(`source_${extracted.code}`); return { ok: false, state: 'source_failed', ...report }; }
  report.extractedFileCount = extracted.files.length;
  report.checks.fileCountMatch = extracted.files.length === (point.manifest?.fileCount ?? extracted.files.length);

  // 5) كتابة في مجلد معزول (إن مُرِّر)
  if (options.workDir) {
    try {
      const written = materializeSource(extracted.files, options.workDir);
      report.checks.sourceMaterialized = written.ok;
      report.materializedDir = options.workDir;
      report.materializedFileCount = written.count;
      if (!written.ok) { report.problems.push('materialize_failed'); return { ok: false, state: 'materialize_failed', ...report }; }
    } catch (err) {
      report.problems.push(`materialize_${String(err?.code || 'error')}`);
      return { ok: false, state: 'materialize_failed', ...report };
    }
  }

  report.ok = report.problems.length === 0;
  report.state = report.ok ? 'verified' : 'failed';
  report.sql = options.returnSql === true ? sql : undefined;
  report.secrets = options.returnSecrets === true ? secrets : undefined;
  return report;
}

/** يكتب ملفات المصدر المستعادة في مجلد معزول (ينشئ المجلدات). */
export function materializeSource(files, targetDir) {
  let count = 0;
  for (const f of files || []) {
    const rel = String(f.path || '').replace(/^\/+/, '');
    if (!rel || rel.includes('..')) continue;
    const abs = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
    count += 1;
  }
  return { ok: count > 0, count };
}

/** يضمن وجود جدول الحالة في قاعدة معزولة (نفس schema المحوّل، بلا migrations). */
export async function ensureGharabiStateTable(pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS gharabi_state (key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now())');
}

/**
 * يطبّق نسخة قاعدة بيانات مفكوكة على قاعدة **معزولة** فقط. يفهم شكلين:
 *  - Postgres: `{ rows: [{ key, value, updated_at }] }`
 *  - ملف محلي: `{ keys: { <key>: <value> } }`
 * لا يُستدعى أبداً على قاعدة الإنتاج (الحماية في طبقة المسار).
 */
export async function applyDatabaseDump(dumpText, pool) {
  let parsed;
  try { parsed = JSON.parse(dumpText); } catch { return { ok: false, code: 'invalid_dump_json' }; }
  await ensureGharabiStateTable(pool);
  const upsert = (key, value) => pool.query(
    'INSERT INTO gharabi_state (key, value, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
    [key, typeof value === 'string' ? value : JSON.stringify(value)],
  );
  if (Array.isArray(parsed?.rows)) {
    let n = 0;
    for (const r of parsed.rows) { if (!r?.key) continue; await upsert(r.key, r.value); n += 1; }
    return { ok: true, mode: 'postgres', rows: n };
  }
  if (parsed?.keys && typeof parsed.keys === 'object') {
    let n = 0;
    for (const [k, v] of Object.entries(parsed.keys)) { if (v == null) continue; await upsert(k, v); n += 1; }
    return { ok: true, mode: 'file-keys', rows: n };
  }
  return { ok: false, code: 'unrecognized_dump_shape' };
}

export { SOURCE_BUNDLE_NAME, DB_DUMP_NAME, SECRETS_PACKAGE_NAME };
