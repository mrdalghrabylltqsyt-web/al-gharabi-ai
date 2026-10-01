/**
 * أداة سطر أوامر لمزامنة النسخة الحالية إلى Google Drive.
 *
 * الاستخدام:
 *   node tools/dr/cloud-sync.mjs                # مزامنة current
 *   node tools/dr/cloud-sync.mjs --rp-001        # ضمان وجود نقطة الاستعادة rp-001
 *   node tools/dr/cloud-sync.mjs --db <file>     # رفع DB encrypted dump فقط
 *
 * لا يُطبع أي سرّ. عند غياب التفويض يخرج برسالة صريحة بلا محاولة اتصال.
 * القراءة من المستودع تحترم الاستبعادات (‎.env/.git/node_modules/dist/.dr-recovery
 * ومفاتيح)، لكنها تفحص الملفات المستبعدة أيضاً بحثاً عن الأسرار.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  shouldExclude,
  normalizeRelPath,
  DR_ROOT_DIR,
  RP_001_COMMIT,
} from './cloud-lib.mjs';
import { DriveClient, createGaxiosTransport } from './drive-client.mjs';
import { DriveStore } from './drive-store.mjs';
import { DriveSync } from './drive-sync.mjs';
import { createRefreshTokenProvider, inspectDriveAuthEnv } from './drive-auth.mjs';
import { readTrustedSourceBundle } from './source-bundle.mjs';

const REPO_ROOT = process.cwd();
const MAX_FILE_BYTES = 8 * 1024 * 1024; // تجاهل الملفات الضخمة جداً من النسخة

/** ملفات يجب وجودها في أي مصدر سليم (تمنع ترقية/نقطة استعادة من شجرة ناقصة). */
export const SOURCE_REQUIRED_FILES = ['server.ts', 'package.json', 'package-lock.json'];
/** أدنى عدد ملفات مقبول كمصدر كامل — يحمي من "شجرة ملفين" (حالة إنتاج سابقة). */
export const SOURCE_MIN_FILES = 10;

/** يجمع ملفات المستودع: المحتوى للمشمولة، والمحتوى للفحص فقط للمستبعدة. */
export function collectRepoFiles(rootDir = REPO_ROOT, options = {}) {
  const included = [];
  const excluded = [];
  const skipDirs = new Set(['.git', 'node_modules', 'dist', DR_ROOT_DIR]);
  const walk = (absDir, relDir) => {
    let items;
    try { items = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      const abs = path.join(absDir, item.name);
      const rel = relDir ? `${relDir}/${item.name}` : item.name;
      if (item.isDirectory()) {
        if (skipDirs.has(item.name)) continue;
        walk(abs, rel);
        continue;
      }
      if (!item.isFile()) continue;
      let stat;
      try { stat = fs.statSync(abs); } catch { continue; }
      if (stat.size > MAX_FILE_BYTES) continue;
      let content;
      try { content = fs.readFileSync(abs); } catch { continue; }
      if (shouldExclude(rel)) excluded.push({ path: rel, content });
      else included.push({ path: rel, content });
    }
  };
  walk(rootDir, '');
  included.sort((a, b) => (a.path < b.path ? -1 : 1));
  excluded.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { included, excluded };
}

/**
 * يقيس اكتمال المصدر المُجمَّع. الحالة الحقيقية على الإنتاج (Render Docker) كانت
 * `process.cwd()` = مجلد الصورة يحوي ملفين فقط (package.json/package-lock.json)،
 * فسُجّلت نسخة "سليمة" وهي ناقصة. هذا الفحص يمنع ذلك صراحةً.
 */
export function assessSourceCompleteness(files, options = {}) {
  const minFiles = Number.isFinite(options.minFiles) ? options.minFiles : SOURCE_MIN_FILES;
  const required = Array.isArray(options.requiredFiles) ? options.requiredFiles : SOURCE_REQUIRED_FILES;
  const paths = new Set(
    (files || []).map((f) => normalizeRelPath(f?.path)).filter(Boolean),
  );
  const missingRequired = required.filter((p) => !paths.has(p));
  const complete = paths.size >= minFiles && missingRequired.length === 0;
  return {
    complete,
    fileCount: paths.size,
    minFiles,
    requiredFiles: required,
    missingRequired,
    reason: complete
      ? null
      : missingRequired.length
        ? `required_files_missing:${missingRequired.join(',')}`
        : `too_few_files:${paths.size}<${minFiles}`,
  };
}

/**
 * يجمع المصدر من **الشجرة المتتبَّعة في Git** (مصدر موثوق كامل) عند توفّر Git
 * ووجود المستودع في مجلد العمل، وإلا يرجع إلى المشي على نظام الملفات.
 *
 * السبب: على بيئة تشغيل لا تحتوي المستودع (صورة Docker تحوي dist فقط) يعطي
 * المشي على المجلد شجرة ناقصة. الشجرة المتتبَّعة تمثّل المشروع المعتمد فعلاً.
 */
export function collectTrustedSourceTree(rootDir = REPO_ROOT, options = {}) {
  const env = options.env || process.env;

  // 1) الشجرة المتتبَّعة في Git — المصدر الحي في التطوير/CI (إن كانت **كاملة**).
  const git = collectGitTrackedFiles(rootDir);
  if (git.ok && git.files.length) {
    const assessment = assessSourceCompleteness(git.files, options);
    if (assessment.complete) {
      return { included: git.files, excluded: [], source: 'git', gitAvailable: true, ...assessment };
    }
    // Git موجود لكن الشجرة ناقصة ⇒ نجرّب الحزمة قبل الرفض (لا رفض فوري).
  }

  // 2) حزمة المصدر الموثوقة المُجمَّعة زمن البناء — المصدر المعتمد في بيئة الإنتاج
  //    التي لا تحوي `.git` (صورة Docker). الشجرة كاملة + مرتبطة بالـcommit المبنيّ.
  const bundle = readTrustedSourceBundle({ env, rootDir });
  if (bundle.ok) {
    const assessment = assessSourceCompleteness(bundle.included, options);
    const bound = bindBundleCommit(bundle, env, options);
    return {
      included: bundle.included,
      excluded: [],
      source: 'bundle',
      gitAvailable: Boolean(git.ok && git.files.length),
      bundle: {
        dir: bundle.bundleDir,
        bundleSource: bundle.bundleSource,
        commit: bundle.commit,
        treeHash: bundle.treeHash,
        manifestTreeHash: bundle.manifestTreeHash,
        treeMatchesManifest: bundle.treeMatches,
        boundToCommit: bound.bound,
        commitBinding: bound.reason,
      },
      ...assessment,
    };
  }

  // 3) المشي على نظام الملفات — آخر خيار (بيئة بلا Git وبلا حزمة). يُرفض إن كان ناقصاً.
  const { included, excluded } = collectRepoFiles(rootDir, options);
  const assessment = assessSourceCompleteness(included, options);
  return { included, excluded, source: 'walk', gitAvailable: false, gitError: git.error ?? null, bundleError: bundle.code ?? null, ...assessment };
}

/**
 * يربط حزمة المصدر بالـcommit المُعلن في البيئة (RENDER_GIT_COMMIT/GIT_COMMIT).
 * لا ادّعاء commit لا يُثبت محتواه: عند وجود commit مُعلن يختلف عن commit الحزمة
 * يُعلَن عدم التطابق صراحةً (فيراه الـcollector والـhealth) — بلا تعديل الشجرة.
 */
export function bindBundleCommit(bundle, env = process.env, options = {}) {
  const declared = String(env?.RENDER_GIT_COMMIT || env?.GIT_COMMIT || '').trim().toLowerCase();
  const bundleCommit = String(bundle?.commit || '').trim().toLowerCase();
  if (!declared) return { bound: null, reason: 'no_declared_commit' };
  if (!bundleCommit) return { bound: false, reason: 'bundle_commit_missing' };
  if (declared === bundleCommit) return { bound: true, reason: 'commit_matches' };
  // داخل الصورة قد يُبنى التطبيق من commit أحدث/أقدم قليلاً؛ نُعلن الفرق بدقة.
  return { bound: false, reason: `commit_mismatch:${bundleCommit.slice(0, 7)}!=${declared.slice(0, 7)}` };
}

/**
 * يقرأ قائمة الملفات المتتبَّعة عبر `git ls-files`، ثم يقرأ محتوى الملفات
 * الموجودة فقط (يتخطى المحذوف/غير المقروء/الأكبر من الحد). آمن بلا أسرار.
 */
export function collectGitTrackedFiles(rootDir = REPO_ROOT, options = {}) {
  const maxBytes = Number.isFinite(options.maxFileBytes) ? options.maxFileBytes : MAX_FILE_BYTES;
  let out;
  try {
    out = execFileSync('git', ['-C', rootDir, 'ls-files', '-z'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    return { ok: false, files: [], error: String(err?.code || err?.message || 'git_unavailable').slice(0, 80) };
  }
  const included = [];
  for (const raw of String(out).split('\0')) {
    const rel = normalizeRelPath(raw);
    if (!rel || shouldExclude(rel)) continue;
    const abs = path.join(rootDir, rel);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; } // محذوف في العمل لكن متتبَّع
    if (!stat.isFile() || stat.size > maxBytes) continue;
    let content;
    try { content = fs.readFileSync(abs); } catch { continue; }
    included.push({ path: rel, content });
  }
  included.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { ok: true, files: included };
}

function buildClientFromEnv(env = process.env) {
  const auth = inspectDriveAuthEnv(env);
  if (!auth.configured || !auth.refreshTokenConfigured) {
    return { ok: false, code: 'not_configured', auth };
  }
  const client = new DriveClient({
    transport: createGaxiosTransport(),
    tokenProvider: createRefreshTokenProvider({ env }),
  });
  return { ok: true, client, auth };
}

async function main() {
  const args = process.argv.slice(2);
  const env = process.env;
  const built = buildClientFromEnv(env);
  if (!built.ok) {
    console.log(JSON.stringify({
      state: 'not_authorized',
      message: 'التفويض غير مضبوط: DRIVE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN مطلوبة. لا يوجد رفع.',
      auth: built.auth,
    }, null, 2));
    process.exit(0);
  }
  const store = new DriveStore({ client: built.client });
  const structure = await store.ensureStructure();
  if (!structure.ok) {
    console.log(JSON.stringify({ state: 'failed', reason: structure.code, message: structure.message }, null, 2));
    process.exit(1);
  }

  if (args.includes('--rp-001')) {
    const { included } = collectRepoFiles();
    const res = await store.ensureRp001({ files: included, note: 'canonical restore point' });
    console.log(JSON.stringify({ state: res.ok ? 'rp001_ready' : 'failed', created: res.data?.created ?? false, commit: RP_001_COMMIT, reason: res.code || null }, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  const dbIdx = args.indexOf('--db');
  if (dbIdx !== -1) {
    const file = args[dbIdx + 1];
    if (!file) { console.log(JSON.stringify({ state: 'failed', reason: 'missing_db_file' }, null, 2)); process.exit(1); }
    const content = fs.readFileSync(file);
    const res = await store.uploadDbDump(path.basename(file), content);
    console.log(JSON.stringify({ state: res.ok ? 'db_uploaded' : 'blocked', reason: res.code || null, message: res.message || null }, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  const { included, excluded } = collectRepoFiles();
  const sync = new DriveSync({ store, client: built.client });
  // الفحص يشمل المستبعدة أيضاً (مفاتيح/‎.env) فلا يمر سرّ.
  const report = await sync.syncCurrent([...included, ...excluded], { commit: env.GIT_COMMIT || env.RENDER_GIT_COMMIT || null, include: () => true });
  console.log(JSON.stringify({ ...report, includedCount: included.length, excludedScanned: excluded.length }, null, 2));
  process.exit(report.state === 'failed' ? 1 : 0);
}

// يُنفَّذ فقط عند التشغيل المباشر (لا عند الاستيراد في الاختبارات).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(JSON.stringify({ state: 'failed', reason: 'unexpected', message: String(err?.message || err) }));
    process.exit(1);
  });
}
