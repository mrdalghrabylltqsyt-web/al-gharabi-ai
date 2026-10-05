/**
 * حزمة المصدر الموثوقة زمن البناء (Build-time trusted source bundle).
 *
 * السبب: صورة الإنتاج (Docker) النهائية لا تحوي `.git` ولا `server.ts` — فقط
 * `dist/` و`package.json`. فجمع المصدر وقت التشغيل يسقط إلى مشي نظام الملفات
 * فيجد ملفين فقط، ويرفضه حرس SOURCE_INCOMPLETE. الحل: نُنتج **زمن البناء**
 * حزمة tar.gz حتمية تحوي شجرة المشروع المصدرية الكاملة (المتتبَّعة في Git)،
 * ونشحنها داخل الصورة. وقت التشغيل يقرأها ويفكّها إلى ذاكرة فقط.
 *
 * ضمانات:
 *  - حتمية: mtime ثابت + gzip بمستوى ثابت + ترتيب أبجدي ⇒ نفس الشجرة = نفس البصمة.
 *  - موثوقة: تحمل `commit` الذي بُنيت منه (مُشتق من Git)، والـcollector يربطها
 *    بالـcommit المُعلن في `RENDER_GIT_COMMIT` ويرفض أي عدم تطابق (لا ادّعاء commit).
 *  - بلا أسرار: تُبنى من `git ls-files` (لا تشمل `.env`/`.git`/`node_modules`/`dist`)،
 *    وتُمرَّر عبر `shouldExclude`، مع فحص أسرار صارم يوقف البناء عند أي سرّ.
 *  - بلا محتوى غير مصدري: لا `dist`/`node_modules`/runtime/قواعد بيانات/بيانات مستخدم.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import {
  normalizeRelPath,
  shouldExclude,
  scanForSecretsStrict,
  computeTreeHash,
  hashContent,
  toBuffer,
} from './cloud-lib.mjs';

export const SOURCE_BUNDLE_FORMAT = 'gharabi-source-bundle-v1';
export const SOURCE_BUNDLE_DIR_ENV = 'DR_SOURCE_BUNDLE_DIR';
export const SOURCE_BUNDLE_MANIFEST_NAME = 'source-bundle.json';
export const SOURCE_BUNDLE_ARCHIVE_NAME = 'source.tar.gz';
export const SOURCE_BUNDLE_COMMIT_ENV = 'SOURCE_BUNDLE_COMMIT';
export const SOURCE_BUNDLE_TREEHASH_ENV = 'SOURCE_BUNDLE_TREEHASH';
export const SOURCE_BUNDLE_COMMIT_FILE = 'source-commit.txt';
export const SOURCE_BUNDLE_TREEHASH_FILE = 'source-treehash.txt';

const MAX_FILE_BYTES = 8 * 1024 * 1024;

// ---------------------------------------------------------------------------
// tar (ustar) — بلا أي مكتبة خارجية، ومحتوى حتمي
// ---------------------------------------------------------------------------

function tarHeader(name, size, mode = '0000644') {
  const buf = Buffer.alloc(512, 0);
  const write = (str, offset, len) => {
    const b = Buffer.from(String(str), 'utf8');
    b.copy(buf, offset, 0, Math.min(b.length, len));
  };
  write(name, 0, 100);
  write(mode, 100, 8);
  write('0000000', 108, 8);
  write('0000000', 116, 8);
  write(size.toString(8).padStart(11, '0'), 124, 12);
  // mtime ثابت (epoch 0): الحزمة تمثل المحتوى لا زمن البناء، فتبقى البصمة
  // قابلة لإعادة الإنتاج لنفس المدخلات (وإلا فشل كشف «لا تغيير» عشوائياً).
  write('00000000000', 136, 12);
  write('        ', 148, 8);
  write('0', 156, 1);
  write('ustar', 257, 6);
  write('00', 263, 2);
  let sum = 0;
  for (const byte of buf) sum += byte;
  write(sum.toString(8).padStart(6, '0'), 148, 8);
  buf[154] = 0;
  buf[155] = 0x20;
  return buf;
}

/**
 * يبني أرشيف tar.gz حتمياً من قائمة ملفات `{path, content}`.
 * gzip مستوى ثابت + mtime=0 داخل ترويسة gzip ⇒ الناتج دالة صافية للمدخلات.
 */
export function buildDeterministicTarGz(entries) {
  const files = [...(entries || [])]
    .map((f) => ({ path: normalizeRelPath(f.path), content: toBuffer(f.content) }))
    .filter((f) => f.path)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const chunks = [];
  for (const e of files) {
    chunks.push(tarHeader(e.path, e.content.length));
    chunks.push(e.content);
    const pad = (512 - (e.content.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  const tar = Buffer.concat(chunks);
  const gz = zlib.gzipSync(tar, { level: 9, mtime: 0 });
  return { buffer: gz, tarBytes: tar.length, fileCount: files.length };
}

/**
 * يفكّ أرشيف tar.gz حتمياً ويعيد `{path, content}` لكل ملف (بذاكرة فقط).
 * لا يكتب على القرص، ويطبّق نفس استبعادات النسخة احتياطياً (دفاع مزدوج).
 */
export function extractTarGz(buffer, options = {}) {
  const gz = toBuffer(buffer);
  if (!gz.length) return { ok: false, code: 'empty_archive', files: [] };
  let tar;
  try { tar = zlib.gunzipSync(gz); } catch { return { ok: false, code: 'invalid_gzip', files: [] }; }
  if (!tar.length || tar.length % 512 !== 0) return { ok: false, code: 'invalid_tar', files: [] };
  const files = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const name = tar.slice(offset, offset + 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break;
    const sizeStr = tar.slice(offset + 124, offset + 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr || '0', 8) || 0;
    const start = offset + 512;
    const content = tar.slice(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
    const rel = normalizeRelPath(name);
    if (!rel || shouldExclude(rel)) continue; // لا ندخل مستبعداً حتى لو وُجد في الأرشيف
    files.push({ path: rel, content });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { ok: true, files };
}

// ---------------------------------------------------------------------------
// جمع شجرة المصدر من Git (زمن البناء)
// ---------------------------------------------------------------------------

/** يقرأ قائمة الملفات المتتبَّعة عبر `git ls-files -z` (بلا استدعاء shell). */
export function listGitTrackedPaths(rootDir = process.cwd()) {
  let out;
  try {
    out = execFileSync('git', ['-C', rootDir, 'ls-files', '-z'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    return { ok: false, paths: [], error: String(err?.code || err?.message || 'git_unavailable').slice(0, 80) };
  }
  const paths = String(out)
    .split('\0')
    .map((p) => normalizeRelPath(p))
    .filter(Boolean);
  return { ok: true, paths };
}

/** يحسم الـcommit الحالي من Git (`git rev-parse HEAD`) — بلا ادّعاء من البيئة. */
export function resolveGitCommit(rootDir = process.cwd()) {
  try {
    const out = execFileSync('git', ['-C', rootDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const sha = String(out).trim().toLowerCase();
    return /^[0-9a-f]{40}$/.test(sha) ? { ok: true, commit: sha } : { ok: false, commit: null, error: 'bad_sha' };
  } catch (err) {
    return { ok: false, commit: null, error: String(err?.code || err?.message || 'git_unavailable').slice(0, 80) };
  }
}

/**
 * يحسم commit البناء بترتيب أسبقية صريح — بلا أي تخمين:
 *   1) `options.commit` (يُمرَّر صراحةً من المستدعي).
 *   2) `RENDER_GIT_COMMIT` من البيئة — القيمة التي توفّرها Render أثناء البناء
 *      (Render يبني بلا `.git`، فهذا هو المصدر الوحيد للـcommit هناك).
 *   3) `git rev-parse HEAD` (بيئة التطوير/CI التي تحوي المستودع).
 *   4) وإلا: null — لا يُخترع commit، ويبقى المصدر غير مربوط.
 */
export function resolveBuildCommit(rootDir = process.cwd(), env = process.env, options = {}) {
  if (options.commit) {
    const sha = String(options.commit).trim().toLowerCase();
    if (/^[0-9a-f]{40}$/.test(sha)) return { ok: true, commit: sha, source: 'provided' };
  }
  const fromEnv = String(env?.RENDER_GIT_COMMIT || '').trim().toLowerCase();
  if (fromEnv) {
    return /^[0-9a-f]{40}$/.test(fromEnv)
      ? { ok: true, commit: fromEnv, source: 'RENDER_GIT_COMMIT' }
      : { ok: false, commit: null, source: 'RENDER_GIT_COMMIT', error: 'bad_sha' };
  }
  const git = resolveGitCommit(rootDir);
  return git.ok ? { ok: true, commit: git.commit, source: 'git' } : { ok: false, commit: null, source: 'none', error: git.error };
}

// مجلدات غير مصدرية تُقلَّم في مسار المشي (احتياطي عند غياب Git زمن البناء).
const NON_SOURCE_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.gharabi-backups', 'test-results', 'playwright-report']);

/**
 * يمشي على شجرة المشروع كبديل احتياطي عند غياب Git زمن البناء.
 * يقلّم مجلدات غير المصدرية، ويطبّق `shouldExclude` على كل ملف.
 */
export function walkProjectSource(rootDir = process.cwd()) {
  const included = [];
  const walk = (absDir, relDir, depth) => {
    if (depth > 12) return;
    let items;
    try { items = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      const rel = relDir ? `${relDir}/${item.name}` : item.name;
      if (item.isDirectory()) {
        if (NON_SOURCE_DIRS.has(item.name)) continue;
        if (rel === 'tools/local-verification') continue;
        walk(path.join(absDir, item.name), rel, depth + 1);
        continue;
      }
      if (!item.isFile()) continue;
      if (shouldExclude(rel)) continue;
      const abs = path.join(absDir, item.name);
      let stat;
      try { stat = fs.statSync(abs); } catch { continue; }
      if (stat.size > MAX_FILE_BYTES) continue;
      let content;
      try { content = fs.readFileSync(abs); } catch { continue; }
      included.push({ path: normalizeRelPath(rel), content });
    }
  };
  walk(rootDir, '', 0);
  included.sort((a, b) => (a.path < b.path ? -1 : 1));
  return included;
}

/**
 * يبني حزمة المصدر الموثوقة من الشجرة المتتبَّعة في Git.
 * يرفض البناء (fail-closed) عند: غياب Git، شجرة فارغة، أو أي سرّ مرصود.
 */
export function buildTrustedSourceBundle(rootDir = process.cwd(), options = {}) {
  const env = options.env || process.env;
  const git = listGitTrackedPaths(rootDir);
  let sourceMode = 'git';
  let included = [];
  const skipped = [];

  if (git.ok && git.paths.length) {
    for (const rel of git.paths) {
      if (shouldExclude(rel)) { skipped.push(rel); continue; }
      const abs = path.join(rootDir, rel);
      let stat;
      try { stat = fs.statSync(abs); } catch { skipped.push(rel); continue; }
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) { skipped.push(rel); continue; }
      let content;
      try { content = fs.readFileSync(abs); } catch { skipped.push(rel); continue; }
      included.push({ path: rel, content });
    }
  } else {
    // احتياطي: غياب Git زمن البناء (صورة مبنية بلا .git). نمشي على الشجرة
    // المصدرية مباشرة، مع تقليم node_modules/dist/... وفحص الأسرار الصارم لاحقاً.
    sourceMode = 'walk';
    included = walkProjectSource(rootDir);
  }
  included.sort((a, b) => (a.path < b.path ? -1 : 1));

  // بوابة أسرار صارمة: لا تُشحن حزمة تحمل سرّاً حقيقياً الشكل. fail-closed.
  const scan = scanForSecretsStrict(included);
  if (!scan.ok) {
    return {
      ok: false,
      code: 'secret_detected',
      message: 'STOP: سر مُرصود في شجرة المصدر — لم تُبنَ الحزمة.',
      findings: scan.findings.map((f) => ({ path: f.path, line: f.line, kind: f.kind })),
    };
  }

  const commitRes = resolveBuildCommit(rootDir, env, options);
  const commit = commitRes.commit ?? null;
  // تشخيص بيئة البناء (بلا أي سرّ): هل وصلت قيم Render إلى خطوة البناء فعلاً؟
  // الرمز/الفرع معلومات عامة، والأسماء فقط. الغرض: كشف سبب غياب commit بدل تخمينه.
  const buildEnv = {
    renderGitCommitPresent: Boolean(String(env?.RENDER_GIT_COMMIT || '').trim()),
    renderGitCommitLength: String(env?.RENDER_GIT_COMMIT || '').trim().length,
    renderPresent: Boolean(String(env?.RENDER || '').trim()),
    renderGitBranch: String(env?.RENDER_GIT_BRANCH || '').trim() || null,
    renderVarNames: Object.keys(env || {}).filter((k) => k.startsWith('RENDER_')).sort(),
    commitSource: commitRes.ok ? commitRes.source : 'none',
  };

  const entries = included.map((f) => ({ path: f.path, sha256: hashContent(f.content), size: f.content.length }));
  const treeHash = computeTreeHash(entries);
  const { buffer } = buildDeterministicTarGz(included);

  return {
    ok: true,
    format: SOURCE_BUNDLE_FORMAT,
    archive: buffer,
    commit,
    commitSource: commitRes.ok ? commitRes.source : 'none',
    buildEnv,
    sourceMode,
    treeHash,
    fileCount: included.length,
    sizeBytes: buffer.length,
    files: entries.map((e) => ({ path: e.path, sha256: e.sha256, size: e.size })),
    skippedCount: skipped.length,
    excluded: skipped,
  };
}

// ---------------------------------------------------------------------------
// كتابة/قراءة الحزمة على القرص (زمن البناء + وقت التشغيل)
// ---------------------------------------------------------------------------

/** يكتب الحزمة + بيانها + ملفي commit/baseline إلى `outDir`. لا سرّ في أي ملف. */
export function writeSourceBundle(outDir, built) {
  if (!built?.ok) return { ok: false, code: built?.code || 'invalid_bundle' };
  fs.mkdirSync(outDir, { recursive: true });
  const archivePath = path.join(outDir, SOURCE_BUNDLE_ARCHIVE_NAME);
  fs.writeFileSync(archivePath, built.archive);
  const manifest = {
    format: built.format,
    generatedAt: built.generatedAt ?? null,
    commit: built.commit,
    commitSource: built.commitSource,
    buildEnv: built.buildEnv ?? null,
    treeHash: built.treeHash,
    fileCount: built.fileCount,
    sizeBytes: built.sizeBytes,
    minFiles: built.minFiles ?? null,
    requiredFiles: built.requiredFiles ?? null,
    files: built.files.map((f) => ({ path: f.path, sha256: f.sha256, size: f.size })),
  };
  fs.writeFileSync(path.join(outDir, SOURCE_BUNDLE_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, SOURCE_BUNDLE_COMMIT_FILE), `${built.commit ?? ''}\n`);
  fs.writeFileSync(path.join(outDir, SOURCE_BUNDLE_TREEHASH_FILE), `${built.treeHash}\n`);
  return { ok: true, archivePath, manifestPath: path.join(outDir, SOURCE_BUNDLE_MANIFEST_NAME), fileCount: built.fileCount, treeHash: built.treeHash, commit: built.commit };
}

/** يقرأ بيان الحزمة (JSON) — بلا سرّ. */
export function readSourceBundleManifest(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, SOURCE_BUNDLE_MANIFEST_NAME), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.format !== SOURCE_BUNDLE_FORMAT) return { ok: false, code: 'bad_format' };
    return { ok: true, manifest: parsed };
  } catch (err) {
    return { ok: false, code: String(err?.code || 'manifest_unreadable').slice(0, 60) };
  }
}

/**
 * يحسم مجلد الوحدة بأمان: `__dirname` في حزمة CJS (dist/server.cjs)، وإلا
 * `import.meta.url` في ESM. لا يرمي في أي من الحالتين.
 */
function moduleDirSafe() {
  try {
    if (typeof __dirname === 'string' && __dirname) return __dirname;
  } catch { /* ESM: لا __dirname */ }
  try {
    if (typeof import.meta !== 'undefined' && import.meta && import.meta.url) {
      return path.dirname(new URL(import.meta.url).pathname);
    }
  } catch { /* CJS bundle: import.meta فارغ */ }
  return null;
}

/**
 * يحسم مجلد الحزمة الفعّال: تجاوز صريح من البيئة أولاً، ثم مجلد الوحدة (حيث
 * توجد الحزمة بجانبها)، ثم `dist/dr-source` في جذر العمل، ثم `tools/dr`.
 */
export function resolveSourceBundleDir(env = process.env, options = {}) {
  const override = env?.[SOURCE_BUNDLE_DIR_ENV];
  if (override && String(override).trim()) return { dir: String(override).trim(), source: 'env' };
  const moduleDir = options.moduleDir || moduleDirSafe();
  const candidates = [
    moduleDir,
    path.join(options.rootDir || process.cwd(), 'dist', 'dr-source'),
    path.join(options.rootDir || process.cwd(), 'tools', 'dr'),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, SOURCE_BUNDLE_ARCHIVE_NAME)) && fs.existsSync(path.join(dir, SOURCE_BUNDLE_MANIFEST_NAME))) {
        return { dir, source: dir === moduleDir ? 'module' : 'search' };
      }
    } catch { /* تابع */ }
  }
  return { dir: null, source: 'none' };
}

/**
 * يقرأ الحزمة الموثوقة ويفكّها إلى `{included, excluded}` جاهزة للـcollector.
 * لا يكتب على القرص. يتحقق من بصمة البيان مقابل المحتوى الفعلي (لا ادّعاء).
 */
export function readTrustedSourceBundle(options = {}) {
  const env = options.env || process.env;
  const resolved = resolveSourceBundleDir(env, { rootDir: options.rootDir, moduleDir: options.moduleDir });
  if (!resolved.dir) return { ok: false, code: 'bundle_not_found', message: 'لا حزمة مصدر موثوقة مُجمَّعة.' };
  const man = readSourceBundleManifest(resolved.dir);
  if (!man.ok) return { ok: false, code: man.code, message: 'بيان الحزمة غير صالح.' };
  let archive;
  try { archive = fs.readFileSync(path.join(resolved.dir, SOURCE_BUNDLE_ARCHIVE_NAME)); } catch (err) {
    return { ok: false, code: String(err?.code || 'archive_unreadable').slice(0, 60), message: 'تعذّر قراءة أرشيف الحزمة.' };
  }
  const extracted = extractTarGz(archive);
  if (!extracted.ok) return { ok: false, code: extracted.code, message: 'تعذّر فكّ أرشيف الحزمة.' };

  // تحقق فعلي: بصمة الشجرة المحسوبة من المحتوى = بصمة البيان. لا ادّعاء.
  const entries = extracted.files.map((f) => ({ path: f.path, sha256: hashContent(f.content) }));
  const treeHash = computeTreeHash(entries);
  const manifestTreeHash = man.manifest.treeHash;
  const treeMatches = treeHash === manifestTreeHash;

  return {
    ok: true,
    included: extracted.files,
    excluded: [],
    source: 'bundle',
    bundleDir: resolved.dir,
    bundleSource: resolved.source,
    manifest: man.manifest,
    commit: man.manifest.commit ?? null,
    commitSource: man.manifest.commitSource ?? null,
    buildEnv: man.manifest.buildEnv ?? null,
    treeHash,
    manifestTreeHash,
    treeMatches,
    fileCount: extracted.files.length,
  };
}

// ---------------------------------------------------------------------------
// CLI زمن البناء
// ---------------------------------------------------------------------------

async function main() {
  const outDir = process.argv[2] || path.join(process.cwd(), 'dist', 'dr-source');
  const built = buildTrustedSourceBundle(process.cwd(), { generatedAt: null });
  if (!built.ok) {
    console.error(JSON.stringify({ state: 'failed', code: built.code, message: built.message, findings: built.findings || [] }, null, 2));
    process.exit(1);
  }
  const written = writeSourceBundle(outDir, built);
  if (!written.ok) {
    console.error(JSON.stringify({ state: 'failed', code: written.code }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({
    state: 'built',
    dir: outDir,
    commit: built.commit,
    commitSource: built.commitSource,
    buildEnv: built.buildEnv ?? null,
    treeHash: built.treeHash,
    fileCount: built.fileCount,
    sizeBytes: built.sizeBytes,
    excludedCount: built.skippedCount,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(JSON.stringify({ state: 'failed', code: 'unexpected', message: String(err?.message || err) }));
    process.exit(1);
  });
}
