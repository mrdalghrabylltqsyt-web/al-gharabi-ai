/**
 * نواة **الاستعادة المستقلة** — منطق صافٍ قابل للاختبار، مستقل عن خادم الغرابي.
 *
 * الغرض: عند انهيار المشروع بالكامل، يبقى مسار استعادة يعمل بلا خادم الغرابي
 * وبلا جلسته وبلا ملفات dist الخاصة به. يكفي:
 *   Google Drive + Recovery Point سليمة + DR_RECOVERY_VAULT_KEY (عند المالك).
 *
 * الضمانات:
 *  - لا يُعلن نجاح بلا تحقق فعلي (بيان + بصمات + فكّ تشفير + استخراج مصدر).
 *  - لا كتابة فوق أي Recovery Point (النقاط غير قابلة للتعديل؛ نقرأ فقط).
 *  - لا كتابة فوق الإنتاج: قاعدة الهدف تُرفض إن طابقت DATABASE_URL الإنتاجي.
 *  - لا سرّ يُعاد ولا يُطبع؛ الأسماء والأعداد فقط.
 *  - الفشل يُعلن مرحلته بدقة (تحقق/خزنة/أسرار/قاعدة/مصدر/بيئة هدف).
 */

import fs from 'node:fs';
import path from 'node:path';
import { DriveClient, createGaxiosTransport } from './drive-client.mjs';
import { DriveStore } from './drive-store.mjs';
import {
  inspectDriveAuthEnv,
  createRefreshTokenProvider,
  inspectDriveOAuthClient,
} from './drive-auth.mjs';
import { verifyRecoveryPoint, extractSourceBundle, materializeSource, applyDatabaseDump } from './restore.mjs';
import { decryptSecretsPackage, inspectMasterKey } from './secret-crypto.mjs';
import { decryptDbDump } from './db-crypto.mjs';
import { decryptKeyVault, inspectVaultKey } from './key-vault-crypto.mjs';
import { inspectRefreshTokenSource, resolveRefreshTokenSource } from './token-source.mjs';
import {
  hashContent,
  DRIVE_OAUTH_REFRESH_TOKEN_ENV,
} from './cloud-lib.mjs';

/**
 * يفكّ خزنة مفاتيح الطوارئ من Drive (HEAD.json → النسخة المعتمدة → فكّ → تحقق
 * بصمات السجلات). منطق صافٍ مكرّر هنا كي تبقى أداة الاستعادة قابلة للتشغيل بـNode
 * مباشرة (بلا حاجة إلى tsx أو كود المشروع المترجم) — وهذا جوهر الاستقلالية.
 */
export async function openKeyVault(store, env = process.env) {
  const headRes = await store.readKeyVaultHead();
  if (!headRes.ok) return { ok: false, code: headRes.code || 'no_structure' };
  const head = headRes.data;
  if (!head || !head.version || !head.encryptedVaultHash) return { ok: false, code: 'no_head', message: 'لا مرجع اعتماد صالح (HEAD.json) لخزنة المفاتيح.' };
  const pkg = await store.readKeyVaultVersion(head.version);
  if (!pkg.ok || !pkg.data) return { ok: false, code: 'vault_package_missing' };
  if (hashContent(pkg.data) !== head.encryptedVaultHash) return { ok: false, code: 'vault_hash_mismatch' };
  const dec = decryptKeyVault(pkg.data, env);
  if (!dec.ok) return { ok: false, code: dec.code, message: dec.message };
  const manifestRecords = new Map((head.manifest?.records || []).map((r) => [r.name, r.fingerprint]));
  const mismatched = [];
  for (const [name, value] of Object.entries(dec.values)) {
    const expected = manifestRecords.get(name);
    if (expected && hashContent(String(value)).slice(0, 16) !== expected) mismatched.push(name);
  }
  return { ok: true, version: head.version, records: dec.records, values: dec.values, recordCount: Object.keys(dec.values).length, integrity: { recordsMatch: mismatched.length === 0, mismatched } };
}

/** مراحل الاستعادة الصريحة (تُعلن للمالك بلا لبس). */
export const RESTORE_STAGES = [
  'select_point',
  'verify_point',
  'open_vault',
  'decrypt_secrets',
  'decrypt_database',
  'restore_source',
  'restore_database',
  'target_environment',
  'complete',
];

/** بيئة الاستعادة المستقلة: تُبنى من بيئة العملية (لمنظومة DR فقط). */
export function recoveryEnv(env = process.env) {
  return env;
}

/** حالة الاعتماد المتاح (أسماء وحالات فقط — بلا أي قيمة سرّية). */
export async function inspectRecoveryReadiness(env = process.env, options = {}) {
  const auth = inspectDriveAuthEnv(env);
  const oauth = inspectDriveOAuthClient(env);
  const master = inspectMasterKey(env);
  const vaultKey = inspectVaultKey(env);
  const vaultKeyPresent = Boolean(env.DR_RECOVERY_VAULT_KEY && String(env.DR_RECOVERY_VAULT_KEY).length > 0);
  const tokenSource = await inspectRefreshTokenSource(env, options);
  return {
    drive: {
      configured: Boolean(auth.configured),
      refreshTokenStored: tokenSource.available,
      refreshTokenSource: tokenSource.source,
      refreshTokenCode: tokenSource.code,
      stateDatabaseConfigured: tokenSource.stateDatabaseConfigured,
      clientIdPresent: oauth.clientIdPresent,
      clientSecretPresent: oauth.clientSecretPresent,
      clientIdFingerprint: oauth.clientIdFingerprint,
      effectiveClientIdSource: oauth.effectiveClientIdSource,
    },
    masterKey: { state: master.state, envNames: master.envNames ?? null },
    vaultKey: { state: vaultKey.state, present: vaultKeyPresent },
  };
}

/**
 * يبني عميل Drive من البيئة (نفس عقد الخادم) — قابل للحقن في الاختبار.
 * مصدر رمز التجديد: صريح/مشفّر/بيئة نصية/قاعدة الحالة المشفّرة (بلا نقل سرّ).
 * يعيد null عند غياب اعتماد العميل، أو كائن `{ ok:false, code }` عند فشل مصدر الرمز.
 */
export async function buildRecoveryClient(env = process.env, options = {}) {
  if (options.clientFactory) return options.clientFactory(env);
  const info = inspectDriveAuthEnv(env);
  if (!info.configured) return null;
  const token = await resolveRefreshTokenSource(env, options);
  if (!token.ok) return { ok: false, code: token.code };
  const provider = createRefreshTokenProvider({ env, refreshToken: token.refreshToken });
  const client = new DriveClient({ transport: options.transport || createGaxiosTransport(), tokenProvider: provider });
  client.refreshTokenSource = token.source;
  return client;
}

/** يبني مخزن Drive بهوية المجلدات المحفوظة إن وُجدت (منع 403 تحت drive.file). */
export function buildRecoveryStore(client, options = {}) {
  return new DriveStore({ client, storedIdentity: options.storedIdentity || null, readOnlyStructure: options.readOnlyStructure !== false });
}

/** يعرض نقاط الاستعادة مع حالة التحقق الفعلي (بلا أسرار) — كل ما يحتاجه المالك للاختيار. */
export async function listRecoveryPoints(store) {
  const listed = await store.listRestorePoints();
  if (!listed.ok) return { ok: false, code: listed.code || 'list_failed', points: [] };
  const points = [];
  for (const p of listed.data || []) {
    let verification = { ok: false, checks: [], problems: ['not_verified'] };
    try { verification = await verifyRecoveryPoint(store, p); } catch (e) { verification = { ok: false, checks: [], problems: [String(e?.code || 'verify_error')] }; }
    const m = p.manifest || {};
    points.push({
      id: p.id,
      folderId: p.folderId ?? null,
      manifest: p.manifest ?? null,
      commit: m.commit ?? null,
      createdAt: m.createdAt ?? null,
      fileCount: m.fileCount ?? null,
      sourceSize: m.sourceSize ?? null,
      database: { present: true, encrypted: true, hash: m.encryptedDatabaseHash ?? null, size: m.encryptedDatabaseSize ?? null },
      secrets: { present: true, encrypted: true, hash: m.encryptedSecretsHash ?? null, size: m.encryptedSecretsSize ?? null, count: m.secretsCount ?? null },
      hashes: { treeHash: m.treeHash ?? null, sourceHash: m.sourceHash ?? null },
      verification: { ok: verification.ok === true, checks: verification.checks || [], problems: verification.problems || [] },
      restorable: verification.ok === true,
      status: verification.ok === true ? 'verified' : 'incomplete',
    });
  }
  // الأحدث أولاً (أعلى رتبة رقمية).
  points.sort((a, b) => (a.id < b.id ? 1 : -1));
  return { ok: true, points };
}

/** بيئة الهدف: هل توجد بيانات خارجية لازمة لا يمكن استنتاجها من النسخة؟ */
export function inspectTargetEnvironment(env = process.env, options = {}) {
  const isolatedDatabaseUrl = options.isolatedDatabaseUrl ?? env.DR_RECOVERY_TEST_DATABASE_URL ?? null;
  const productionUrl = env.DATABASE_URL ?? null;
  const sameAsProduction = Boolean(isolatedDatabaseUrl && productionUrl && isolatedDatabaseUrl === productionUrl);
  const databaseReady = Boolean(isolatedDatabaseUrl) && !sameAsProduction;
  return {
    isolatedDatabaseUrlConfigured: Boolean(isolatedDatabaseUrl),
    sameAsProduction,
    databaseReady,
    /** إعادة تشغيل الإنتاج الفعلية تبقى خطوة خارجية (Render + env vars). */
    productionRestart: 'external_required',
    externalRequirements: [
      'حساب Render لإعادة النشر وضبط متغيّرات البيئة',
      'قاعدة Postgres هدف (Neon) لتطبيق database.enc',
      'تفويض Google Drive (OAuth) لمنظومة النسخ',
    ],
  };
}

/**
 * ينفّذ الاستعادة الكاملة في بيئة الهدف. لا يلمس الإنتاج ولا النقاط الأصلية.
 *
 * @param {object} options
 * @param {any} options.store مخزن Drive (قراءة فقط).
 * @param {object} options.point نقطة الاستعادة `{ id, folderId, manifest }`.
 * @param {object} [options.env] بيئة تتضمّن المفاتيح (DR_RECOVERY_VAULT_KEY / DR_RECOVERY_MASTER_KEY …).
 * @param {string} [options.targetDir] مجلد هدف لكتابة المصدر المستعاد (يُنشأ).
 * @param {string} [options.isolatedDatabaseUrl] قاعدة هدف معزولة (تُرفض إن طابقت الإنتاج).
 * @param {boolean} [options.applyDatabase] هل نكتب قاعدة الهدف فعلاً (افتراضاً إن وُجدت القاعدة).
 * @param {string} [options.now] طابع زمني.
 */
export async function runStandaloneRestore(options = {}) {
  const store = options.store;
  const point = options.point;
  const env = options.env || process.env;
  const now = options.now || new Date().toISOString();
  const report = {
    kind: 'standalone-restore',
    at: now,
    recoveryPointId: point?.id ?? null,
    commit: point?.manifest?.commit ?? null,
    stage: 'select_point',
    stages: [],
    checks: {},
    problems: [],
    wroteToProduction: false,
    immutablePointUntouched: true,
    secretsNames: [],
    secretsCount: 0,
    externalRequirements: [],
    ok: false,
  };
  const mark = (stage) => { report.stage = stage; report.stages.push(stage); };

  if (!store || !point) { report.problems.push('no_store_or_point'); return report; }

  // 1) تحقق من نقطة الاستعادة (بيان + بصمات + شكل الحزم). لا فكّ تشفير بعد.
  mark('verify_point');
  const verification = await verifyRecoveryPoint(store, point);
  report.checks.pointVerified = verification.ok === true;
  if (!verification.ok) { report.problems.push(...verification.problems); report.failureStage = 'verify_point'; return report; }
  const arts = verification.artifacts;
  report.fileCount = point.manifest?.fileCount ?? null;

  // 2) فكّ خزنة مفاتيح الطوارئ بالمفتاح الذي أدخله المالك.
  //    غياب الخزنة (لم تُزامَن بعد) لا يُسقط الاستعادة — المصدر والقاعدة والأسرار
  //    تُستعاد بالمفاتيح نفسها. أما خزنة موجودة بمفتاح خاطئ فتُعلن الفشل صراحةً.
  mark('open_vault');
  const vault = await openKeyVault(store, env);
  const vaultAbsent = vault.ok !== true && ['no_structure', 'no_head', 'vault_package_missing'].includes(String(vault.code));
  report.checks.vaultDecrypt = vault.ok === true;
  report.checks.vaultAbsent = vaultAbsent;
  report.vaultVersion = vault.version ?? null;
  report.vaultRecordCount = vault.recordCount ?? null;
  report.checks.vaultIntegrity = vault.ok === true ? vault.integrity?.recordsMatch === true : null;
  if (!vault.ok && !vaultAbsent) { report.problems.push(`vault_${vault.code}`); report.failureStage = 'open_vault'; return report; }
  if (vault.ok && vault.integrity && vault.integrity.recordsMatch === false) { report.problems.push('vault_integrity_mismatch'); report.failureStage = 'open_vault'; return report; }

  // 3) فكّ الأسرار المشفّرة (بالمفتاح الرئيسي — لا يُعلن أي قيمة).
  mark('decrypt_secrets');
  let secrets = null;
  if (arts.present.secrets) {
    const dec = decryptSecretsPackage(arts.secrets, env);
    report.checks.secretsDecrypt = dec.ok === true;
    if (!dec.ok) { report.problems.push(`secrets_${dec.code}`); report.failureStage = 'decrypt_secrets'; return report; }
    secrets = dec.secrets;
    report.secretsNames = Object.keys(secrets).sort();
    report.secretsCount = report.secretsNames.length;
  }

  // 4) فكّ قاعدة البيانات المشفّرة.
  mark('decrypt_database');
  let sql = null;
  if (arts.present.db) {
    const dec = decryptDbDump(arts.db, env);
    report.checks.databaseDecrypt = dec.ok === true;
    if (!dec.ok) { report.problems.push(`database_${dec.code}`); report.failureStage = 'decrypt_database'; return report; }
    sql = dec.sql;
    report.databaseSqlBytes = Buffer.byteLength(sql);
  }

  // 5) استخراج المصدر وكتابته في بيئة الهدف (مجلد جديد). لا استثناءات.
  mark('restore_source');
  const extracted = extractSourceBundle(arts.bundle);
  report.checks.sourceExtract = extracted.ok === true;
  if (!extracted.ok) { report.problems.push(`source_${extracted.code}`); report.failureStage = 'restore_source'; return report; }
  report.extractedFileCount = extracted.files.length;
  report.checks.fileCountMatch = extracted.files.length === (point.manifest?.fileCount ?? extracted.files.length);
  if (!report.checks.fileCountMatch) { report.problems.push('source_file_count_mismatch'); report.failureStage = 'restore_source'; return report; }
  if (options.targetDir) {
    try {
      const written = materializeSource(extracted.files, options.targetDir);
      report.checks.sourceMaterialized = written.ok === true;
      report.materializedFileCount = written.count;
      report.targetDir = options.targetDir;
      if (!written.ok) { report.problems.push('materialize_failed'); report.failureStage = 'restore_source'; return report; }
    } catch (e) {
      report.problems.push(`materialize_${String(e?.code || 'error')}`);
      report.failureStage = 'restore_source';
      return report;
    }
  }

  // 6) استعادة قاعدة البيانات في قاعدة **هدف معزولة** فقط. تُرفض قاعدة الإنتاج.
  mark('restore_database');
  const target = inspectTargetEnvironment(env, { isolatedDatabaseUrl: options.isolatedDatabaseUrl });
  report.externalRequirements = target.externalRequirements;
  if (target.sameAsProduction) {
    report.problems.push('REFUSED_PRODUCTION_DATABASE');
    report.failureStage = 'restore_database';
    report.checks.databaseRestored = false;
    return report;
  }
  if (options.applyDatabase !== false && target.databaseReady && sql) {
    try {
      const pg = await import('pg');
      const pool = new pg.default.Pool({ connectionString: options.isolatedDatabaseUrl || env.DR_RECOVERY_TEST_DATABASE_URL, max: 2 });
      try {
        const res = await applyDatabaseDump(sql, pool);
        report.checks.databaseRestored = res.ok === true;
        report.databaseRestore = { mode: res.mode ?? null, rows: res.rows ?? null };
        if (!res.ok) { report.problems.push(`database_restore_${res.code}`); report.failureStage = 'restore_database'; return report; }
      } finally {
        await pool.end().catch(() => {});
      }
    } catch (e) {
      report.problems.push(`database_restore_${String(e?.code || 'error')}`);
      report.failureStage = 'restore_database';
      report.checks.databaseRestored = false;
      return report;
    }
  } else if (!target.databaseReady) {
    report.checks.databaseRestored = false;
    report.databaseRestore = { attempted: false, reason: target.isolatedDatabaseUrlConfigured ? 'refused_production' : 'no_target_database' };
  }

  mark('target_environment');
  mark('complete');
  report.ok = report.problems.length === 0;
  return report;
}

export { verifyRecoveryPoint, extractSourceBundle, materializeSource, applyDatabaseDump };
