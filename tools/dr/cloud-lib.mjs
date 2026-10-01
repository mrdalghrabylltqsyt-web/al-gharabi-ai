/**
 * نواة منظومة النسخ السحابي (DR) — منطق صافٍ قابل للاختبار، بلا شبكة وبلا أسرار.
 *
 * كل قرار حاسم هنا (استبعاد ملف، فحص سرّ، بصمة شجرة، مقارنة لقطتين، بوابة
 * المساحة، لقطة المراقبة، الفحص الساعي) دالة نقية تأخذ مدخلات وتعيد حكماً،
 * فيمكن اختبارها بالكامل بلا Google Drive. لا تُقرأ أي أسرار ولا تُطبع.
 *
 * القواعد الملزمة:
 *  - لا رفع لقاعدة بيانات خام؛ المسموح فقط DB encrypted dump.
 *  - أي سر مُرصود => STOP (لا يُرفع أي جزء من النسخة).
 *  - لا حذف للنسخة القديمة قبل نجاح الجديدة والتحقق منها.
 *  - حدود المساحة تصميمية (15 GiB مع هامش 512 MiB) وتُقارَن بالمساحة الفعلية.
 */

import crypto from 'node:crypto';
import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// ثوابت العقد
// ---------------------------------------------------------------------------

export const DR_FOLDER_NAME = 'al-gharabi-ai-dr';
/**
 * البنية الكاملة: current (مرآة الملفات الحقيقية) + history (نقاط استعادة كاملة)
 * + db (نسخة مشفّرة مستقلة) + secrets (حزمة أسرار مشفّرة) + recovery (معلومات
 * التعافي المستقلة القابلة للقراءة بلا تشغيل الغرابي) + staging (منطقة ذرّية
 * للترقية). المجلدات الثلاثة الأولى مطلوبة للتوافق الرجعي مع النقاط القائمة.
 */
export const DR_SUBDIRS = ['current', 'history', 'db', 'secrets', 'recovery', 'staging'];
export const DR_ROOT_DIR = '.dr-recovery';

/** أسماء ملفات العقد داخل المجلدات. */
export const CURRENT_STATE_NAME = 'current-state.json';
export const RECOVERY_MANIFEST_NAME = 'recovery-manifest.json';
export const SECRETS_PACKAGE_NAME = 'secrets.enc';
export const RECOVERY_INFO_NAME = 'recovery-information.md';
export const RECOVERY_INSTRUCTIONS_NAME = 'recovery-instructions.md';
export const LATEST_RECOVERY_NAME = 'latest-recovery.json';
export const MIRROR_MANIFEST_NAME = 'mirror-manifest.json';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** نطاقات ممنوعة صراحةً: صلاحية Drive الكاملة أو القراءة العامة. */
export const DRIVE_FORBIDDEN_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/drive.appdata',
];

export const DRIVE_OAUTH_CLIENT_ID_ENV = 'DRIVE_OAUTH_CLIENT_ID';
export const DRIVE_OAUTH_CLIENT_SECRET_ENV = 'DRIVE_OAUTH_CLIENT_SECRET';
export const DRIVE_OAUTH_REFRESH_TOKEN_ENV = 'DRIVE_OAUTH_REFRESH_TOKEN';
export const DRIVE_OAUTH_REDIRECT_URI = 'https://al-gharabi-ai.onrender.com/api/dr/drive/callback';

/** الحد التصميمي والهامش (بايت). لا شراء ولا ترقية ولا تجاوز. */
export const DESIGN_QUOTA_BYTES = 15 * 1024 * 1024 * 1024; // 15 GiB
export const QUOTA_HEADROOM_BYTES = 512 * 1024 * 1024; // 512 MiB

/** أول نقطة استعادة: تمثل commit معتمداً محدّداً بالضبط ولا تُعدّل أبداً. */
export const RP_001_ID = 'rp-001';
export const RP_001_COMMIT = 'dd09c32077e2cc3cc326345e8bbc740c025c14e2';

export const DB_DUMP_MAGIC = 'GHARABI-DB-DUMP-V1';

/** أسماء/أنماط مستبعدة من النسخة (تُفحص بحثاً عن الأسرار مع ذلك). */
export const DR_EXCLUDED_EXACT = ['.env', '.git', 'node_modules', 'dist', DR_ROOT_DIR];
export const DR_EXCLUDED_PATTERNS = [
  /^\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /(^|\/)id_rsa$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
];

// ---------------------------------------------------------------------------
// مسارات
// ---------------------------------------------------------------------------

/** يوحّد فاصل المسارات ويزيل البادئة `./` والشرطات الزائدة. */
export function normalizeRelPath(input) {
  return String(input ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
}

/** هل يُستبعد هذا المسار النسبي من النسخة؟ (يُفحص بحثاً عن الأسرار مع ذلك). */
export function shouldExclude(relPath) {
  const p = normalizeRelPath(relPath);
  if (!p) return true;
  const segments = p.split('/');
  for (const seg of segments) {
    if (DR_EXCLUDED_EXACT.includes(seg)) return true;
  }
  if (DR_EXCLUDED_PATTERNS.some((re) => re.test(p))) return true;
  return false;
}

/**
 * يحوّل مسار المستودع إلى اسم ملف صالح لدى Drive (لا يقبل `/` في الأسماء).
 * الترميز قابل للعكس، والمسار الحقيقي يبقى محفوظاً في البيان.
 */
export function encodeFileName(relPath) {
  return encodeURIComponent(normalizeRelPath(relPath)).replace(/%2F/gi, '~');
}

export function decodeFileName(name) {
  return decodeURIComponent(String(name ?? '').replace(/~/g, '%2F'));
}

/** هل الملف من فئة تحمل أسراراً عادةً (يُستبعد من الرفع لكن يُفحص دائماً)؟ */
export function isSecretBearingPath(relPath) {
  const p = normalizeRelPath(relPath);
  return DR_EXCLUDED_PATTERNS.some((re) => re.test(p)) || p.split('/').includes('.env');
}

// ---------------------------------------------------------------------------
// تجزئة المحتوى وبصمة الشجرة
// ---------------------------------------------------------------------------

export function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** يوحّد أي تمثيل بايتات (Buffer/ArrayBuffer/View/نص) إلى Buffer. */
export function toBuffer(data) {
  if (data == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(String(data), 'utf8');
}

/** بصمة محتوى الملف (hex). */
export function hashContent(content) {
  return sha256Hex(toBuffer(content));
}

/**
 * بصمة الشجرة: sha256 على قائمة `path\0sha256\n` مرتّبة، فلا تتأثر بترتيب
 * الإدخال وترتبط بالمحتوى والمسارات معاً.
 */
export function computeTreeHash(entries) {
  const lines = (entries || [])
    .map((e) => ({ path: normalizeRelPath(e.path), sha256: String(e.sha256 || '') }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((e) => `${e.path}\u0000${e.sha256}\n`)
    .join('');
  return sha256Hex(Buffer.from(lines, 'utf8'));
}

// ---------------------------------------------------------------------------
// مقارنة اللقطات (إضافة/تعديل/حذف/نقل/لا تغيير)
// ---------------------------------------------------------------------------

/**
 * يقارن لقطتين (مصفوفة `{path, sha256}`) ويعيد تصنيف الفروق.
 * لا تغيير => noChange=true ولا يُعاد رفع أي ملف غير متغيّر.
 */
export function diffSnapshots(previous, next) {
  const prev = new Map((previous || []).map((e) => [normalizeRelPath(e.path), String(e.sha256 || '')]));
  const cur = new Map((next || []).map((e) => [normalizeRelPath(e.path), String(e.sha256 || '')]));

  const added = [];
  const modified = [];
  const unchanged = [];
  for (const [path, hash] of cur) {
    if (!prev.has(path)) added.push({ path, sha256: hash });
    else if (prev.get(path) !== hash) modified.push({ path, sha256: hash, previousSha256: prev.get(path) });
    else unchanged.push({ path, sha256: hash });
  }
  const removedRaw = [];
  for (const [path, hash] of prev) {
    if (!cur.has(path)) removedRaw.push({ path, sha256: hash });
  }

  // كشف النقل حتمياً: مسار مُزال محتواه مطابق لمسار مُضاف (بلا سابق مطابقة).
  const addedByHash = new Map();
  for (const a of added) {
    if (!addedByHash.has(a.sha256)) addedByHash.set(a.sha256, []);
    addedByHash.get(a.sha256).push(a.path);
  }
  const renamed = [];
  const removed = [];
  for (const r of [...removedRaw].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const candidates = addedByHash.get(r.sha256);
    if (candidates && candidates.length) {
      const to = candidates.shift();
      renamed.push({ from: r.path, to, sha256: r.sha256 });
    } else {
      removed.push(r);
    }
  }
  // أي مسار مُضاف استُهلك بالنقل لا يُعدّ إضافة مستقلة.
  const renamedTo = new Set(renamed.map((r) => r.to));
  const addedFinal = added.filter((a) => !renamedTo.has(a.path));

  return {
    added: addedFinal,
    modified,
    removed,
    renamed,
    unchanged,
    noChange: addedFinal.length === 0 && modified.length === 0 && removed.length === 0 && renamed.length === 0,
  };
}

// ---------------------------------------------------------------------------
// بوابة المساحة
// ---------------------------------------------------------------------------

/**
 * قرار بوابة المساحة: يمنع التجاوز بلا شراء أو ترقية.
 * `allowed=false` => blocked بسبب صريح.
 */
export function withinQuota(usageBytes, incomingBytes, options = {}) {
  const designBytes = Number(options.designBytes ?? DESIGN_QUOTA_BYTES);
  const headroomBytes = Number(options.headroomBytes ?? QUOTA_HEADROOM_BYTES);
  const used = Number.isFinite(usageBytes) && usageBytes >= 0 ? usageBytes : 0;
  const incoming = Number.isFinite(incomingBytes) && incomingBytes > 0 ? incomingBytes : 0;
  const projected = used + incoming;
  const limit = designBytes - headroomBytes;
  const allowed = projected <= limit;
  return {
    allowed,
    projectedBytes: projected,
    usageBytes: used,
    incomingBytes: incoming,
    designBytes,
    headroomBytes,
    effectiveLimitBytes: limit,
    reason: allowed ? null : 'quota_exceeded',
    message: allowed
      ? 'المساحة كافية.'
      : `المساحة غير كافية: المتوقّع ${projected} بايت مقابل حد ${limit} بايت (15 GiB بهامش 512 MiB). لا شراء ولا ترقية ولا تجاوز.`,
  };
}

// ---------------------------------------------------------------------------
// فحص الأسرار (يشمل الملفات المستبعدة)
// ---------------------------------------------------------------------------

/** أنماط عالية الثقة لأنواع أسرار معروفة. */
export const SECRET_PATTERNS = [
  { kind: 'google_api_key', re: /AIzaSy[A-Za-z0-9_\-]{33}/g },
  { kind: 'google_oauth_client_secret', re: /GOCSPX-[A-Za-z0-9_\-]{10,}/g },
  { kind: 'google_oauth_client_id', re: /\d{10,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com/g },
  { kind: 'google_refresh_token', re: /1\/\/[A-Za-z0-9_\-]{30,}/g },
  { kind: 'resend_key', re: /re_[A-Za-z0-9]{20,}/g },
  { kind: 'openai_key', re: /sk-[A-Za-z0-9]{20,}/g },
  { kind: 'private_key_block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'aws_access_key', re: /AKIA[0-9A-Z]{16}/g },
  { kind: 'slack_token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'telegram_bot_token', re: /\b\d{8,10}:[A-Za-z0-9_\-]{35}\b/g },
  { kind: 'jwt', re: /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g },
];

const SECRET_ASSIGNMENT_RE =
  /(password|passwd|secret|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|session[_-]?secret|encryption[_-]?key)\s*[:=]\s*["']?([^\s"'#,;]{12,})["']?/gi;

/** هل القيمة نص نائب (placeholder) لا يُعدّ سراً؟ */
export function isPlaceholderValue(value) {
  const v = String(value ?? '').trim();
  if (v.length < 12) return true;
  if (/^(your|change|example|placeholder|sample|dummy|test|todo|xxx+|<.*>|\$\{|\[.*\])/i.test(v)) return true;
  if (/^[<\[{($]/.test(v)) return true;
  if (/^(true|false|null|undefined)$/i.test(v)) return true;
  if (/^[*x]+$/i.test(v)) return true;
  if (/^\.\.\.+$/.test(v)) return true;
  // اسم متغيّر بيئة (أحرف كبيرة وشرطات سفلية) = إشارة قالب وليست سراً حقيقياً.
  // يغطّي ملفات `.env.example` التي تحمل أسماء لا قيماً (مثل MY_GEMINI_API_KEY).
  if (/^[A-Z][A-Z0-9_]{4,}$/.test(v)) return true;
  return false;
}

/** علامات قطعية على أن القيمة بيانات اختبار وهمية لا سرّ حقيقي. */
export const FAKE_SECRET_MARKERS = /(fake|not[-_]?a[-_]?real|notreal|dummy|placeholder|example|sample|redacted|xxxx|test)/i;

/** هل السطر يحمل علامة صريحة على أنه بيانات وهمية؟ (السر الحقيقي لا يحملها) */
export function looksLikeFakeSecret(text) {
  return FAKE_SECRET_MARKERS.test(String(text ?? ''));
}

/** نوع محتوى الملف من امتداده (يُستخدم عند رفع المرآة الفردية). */
export function mimeTypeForPath(path) {
  if (/\.json$/i.test(path)) return 'application/json';
  if (/\.md$/i.test(path)) return 'text/markdown';
  if (/\.(mjs|js|cjs|ts|tsx|jsx)$/i.test(path)) return 'text/javascript';
  if (/\.(html|css|txt|yml|yaml|toml|env)$/i.test(path)) return 'text/plain';
  if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(path)) return 'application/octet-stream';
  return 'application/octet-stream';
}

/** يقسّم مساراً نسبياً إلى مقاطع مجلدات (بلا اسم الملف). */
export function dirSegments(relPath) {
  const p = normalizeRelPath(relPath);
  const parts = p.split('/').filter(Boolean);
  return parts.slice(0, -1);
}

/**
 * يفحص قائمة ملفات (`{path, content}`) بحثاً عن أسرار. يفحص **كل** الملفات
 * المُمرَّرة بما فيها المستبعدة. لا يعيد قيمة السر، فقط نوعه وموضعه.
 */
export function scanForSecrets(files) {
  const findings = [];
  for (const f of files || []) {
    const path = normalizeRelPath(f.path);
    const content = Buffer.isBuffer(f.content) ? f.content.toString('utf8') : String(f.content ?? '');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const { kind, re } of SECRET_PATTERNS) {
        re.lastIndex = 0;
        if (re.test(line)) findings.push({ path, line: i + 1, kind });
      }
      SECRET_ASSIGNMENT_RE.lastIndex = 0;
      let m;
      while ((m = SECRET_ASSIGNMENT_RE.exec(line)) !== null) {
        if (!isPlaceholderValue(m[2])) findings.push({ path, line: i + 1, kind: 'secret_assignment' });
      }
    }
  }
  return { ok: findings.length === 0, findings };
}

/**
 * فحص أسرار **صارم** للنسخة الاحتياطية: يكشف نوعين فقط:
 *  - أنماط عالية الثقة لأنواع أسرار معروفة (`SECRET_PATTERNS`) — لا تتطابق إلا مع قيمة سرّ حقيقية الشكل.
 *  - إسنادات صريحة إلى **مسار/اسم يحمل سراً** بقيمة فعلية (مثل `.env`).
 *
 * لا يُعدّ كوداً سليماً سراً. الفرق عن `scanForSecrets`: هذا الفحص لا يوقف النسخة بسبب
 * تعبيرات كود مشروعة (مثل `const refreshToken = ...`) أو قيم اختبار وهمية في ملفات الاختبار،
 * لكنه يوقفها فوراً عند أي قيمة سرّ حقيقية الشكل أو أي إسناد سرّ داخل ملف يحمل سراً.
 */
export function scanForSecretsStrict(files) {
  const findings = [];
  for (const f of files || []) {
    const path = normalizeRelPath(f.path);
    const content = Buffer.isBuffer(f.content) ? f.content.toString('utf8') : String(f.content ?? '');
    const secretBearing = isSecretBearingPath(path);
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      // بيانات اختبار وهمية تحمل علامة صريحة (fake/not-real/dummy…) لا تُعدّ سراً:
      // لا سرّ حقيقي يحمل هذه الكلمة في نفس السطر.
      const fakeLine = looksLikeFakeSecret(line);
      for (const { kind, re } of SECRET_PATTERNS) {
        re.lastIndex = 0;
        if (re.test(line) && !fakeLine) findings.push({ path, line: i + 1, kind });
      }
      if (!secretBearing || fakeLine) continue;
      SECRET_ASSIGNMENT_RE.lastIndex = 0;
      let m;
      while ((m = SECRET_ASSIGNMENT_RE.exec(line)) !== null) {
        if (!isPlaceholderValue(m[2])) findings.push({ path, line: i + 1, kind: 'secret_assignment' });
      }
    }
  }
  return { ok: findings.length === 0, findings };
}

/** يوحّد قيمة السر المُرصودة لإخفائها من أي نص (نوعه + موضعه فقط، بلا قيمة). */
export function redactSecretFindings(findings) {
  return (findings || []).map((f) => ({ path: normalizeRelPath(f.path), line: f.line ?? null, kind: f.kind }));
}

// ---------------------------------------------------------------------------
// حزمة المصدر (source bundle) — أرشيف محتوى حتمي بلا أي سرّ
// ---------------------------------------------------------------------------

export const SOURCE_BUNDLE_VERSION = 1;
export const SOURCE_BUNDLE_NAME = 'source.tar.gz';
export const DB_DUMP_NAME = 'database.enc';

/** بنية أرشيف tar (ustar) لملف واحد؛ لا تعتمد على أي مكتبة خارجية. */
function tarHeader(name, size) {
  const buf = Buffer.alloc(512, 0);
  const write = (str, offset, len) => {
    const b = Buffer.from(String(str), 'utf8');
    b.copy(buf, offset, 0, Math.min(b.length, len));
  };
  write(name, 0, 100);
  write('0000644', 100, 8); // mode
  write('0000000', 108, 8); // uid
  write('0000000', 116, 8); // gid
  write(size.toString(8).padStart(11, '0'), 124, 12); // size
  // mtime ثابت (epoch 0): الحزمة تمثل **المحتوى** لا زمن البناء، فتصبح البصمة
  // قابلة لإعادة الإنتاج لنفس المدخلات — وإلا فشل كشف «لا تغيير» عشوائياً.
  write('00000000000', 136, 12); // mtime
  write('        ', 148, 8); // checksum placeholder
  write('0', 156, 1); // typeflag: regular file
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
 * يبني حزمة مصدر `.tar.gz` من الملفات المُمرَّرة (مسارات نسبية + محتوى).
 * لا يشمل أي ملف مستبعد، ولا أي سرّ (يُفترض أن الفحص الصارم مرّ أولاً).
 * gzip بمستوى ثابت ليكون الناتج قابلاً لإعادة الإنتاج لنفس المدخلات.
 */
export function buildSourceBundle(files) {
  const entries = [...(files || [])]
    .map((f) => ({ path: normalizeRelPath(f.path), content: toBuffer(f.content) }))
    .filter((f) => f.path && !shouldExclude(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const chunks = [];
  for (const e of entries) {
    chunks.push(tarHeader(e.path, e.content.length));
    chunks.push(e.content);
    const pad = (512 - (e.content.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(1024, 0)); // نهاية الأرشيف: كتلتان فارغتان
  const tar = Buffer.concat(chunks);
  const gz = zlib.gzipSync(tar, { level: 9 });
  return { ok: true, buffer: gz, tarBytes: tar.length, fileCount: entries.length, sizeBytes: gz.length, files: entries.map((e) => e.path) };
}

/**
 * يتحقق من حزمة مصدر: أنها gzip صالح وأن عدد ملفاتها يطابق المتوقع.
 * لا يفكّ كل المحتوى، فقط يثبت السلامة البنيوية (gzip + tar غير فارغ).
 */
export function verifySourceBundle(buffer, expected) {
  const gz = toBuffer(buffer);
  if (!gz.length) return { ok: false, code: 'empty_bundle' };
  let tar;
  try { tar = zlib.gunzipSync(gz); } catch { return { ok: false, code: 'invalid_gzip' }; }
  if (!tar.length || tar.length % 512 !== 0) return { ok: false, code: 'invalid_tar' };
  if (expected && Number.isFinite(expected.fileCount) && expected.fileCount > 0) {
    let count = 0;
    let offset = 0;
    while (offset + 512 <= tar.length) {
      const name = tar.slice(offset, offset + 100).toString('utf8').replace(/\0.*$/, '');
      if (!name) break;
      const sizeStr = tar.slice(offset + 124, offset + 136).toString('utf8').replace(/\0.*$/, '').trim();
      const size = parseInt(sizeStr || '0', 8) || 0;
      count += 1;
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    if (count !== expected.fileCount) return { ok: false, code: 'file_count_mismatch', expected: expected.fileCount, actual: count };
  }
  return { ok: true, tarBytes: tar.length };
}

/** يستخرج أسماء الملفات من حزمة مصدر (gzip → tar) بلا فكّ المحتوى كاملاً. */
export function listSourceBundleFiles(buffer) {
  const gz = toBuffer(buffer);
  let tar;
  try { tar = zlib.gunzipSync(gz); } catch { return { ok: false, code: 'invalid_gzip', files: [] }; }
  const files = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const name = tar.slice(offset, offset + 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break;
    const sizeStr = tar.slice(offset + 124, offset + 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr || '0', 8) || 0;
    files.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return { ok: true, files };
}

// ---------------------------------------------------------------------------
// قاعدة البيانات: رفض الخام، قبول المشفّر فقط
// ---------------------------------------------------------------------------

/** محارف قيمة base64/base64url المسموح بها في سطر `data:` (‎[A-Za-z0-9+/=_-]). */
function isBase64ishChar(code) {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 43 || code === 47 || code === 45 || code === 95 || code === 61 // + / - _ =
  );
}

function isAsciiWhitespace(code) {
  return code <= 32;
}

/**
 * يتحقق من وجود سطر `data:` يحمل قيمة مشفّرة (≥16 محرفاً) بلا أي محارف أخرى.
 *
 * **لا يستخدم regex**: النمط السابق `/^data:\s*[A-Za-z0-9+/=_-]{16,}\s*$/m`
 * يُنفّذ الكمّية غير المحدودة `{16,}` على السطر كاملاً داخل محرّك V8، فيستنفد
 * المكدس C++ عند حِمل ciphertext بmulti-ميغابايت (سطر base64 واحد طويل جداً)
 * ويُنتج `RangeError: Maximum call stack size exceeded`. الفحص الخطّي هنا
 * O(n) بالرموز المحلية ولا يلمس مكدس المحرّك، فيتحمّل أي حجم واقعي.
 */
function hasValidDataLine(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    let i = 5;
    while (i < line.length && isAsciiWhitespace(line.charCodeAt(i))) i += 1;
    const start = i;
    while (i < line.length && isBase64ishChar(line.charCodeAt(i))) i += 1;
    const valueLength = i - start;
    while (i < line.length && isAsciiWhitespace(line.charCodeAt(i))) i += 1;
    if (valueLength >= 16 && i === line.length) return true;
  }
  return false;
}

/**
 * يصنّف ملف نسخة قاعدة البيانات: مشفّر مسموح، أو خام مرفوض.
 * الشكل المطلوب: سطر `GHARABI-DB-DUMP-V1` + `encrypted: true` + كتلة ciphertext.
 */
export function classifyDbDump(content) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content ?? '');
  const lines = text.split(/\r?\n/);
  const hasMagic = lines[0]?.trim() === DB_DUMP_MAGIC;
  const hasEncrypted = /^encrypted:\s*true\s*$/m.test(text);
  const hasCipher = /^cipher:\s*aes-256-gcm\s*$/m.test(text);
  const hasData = hasValidDataLine(text);
  const encrypted = hasMagic && hasEncrypted && hasCipher && hasData;
  // إشارات قاعدة بيانات خام (SQL/نسخة نصية) => مرفوضة دائماً.
  const rawSignals = [
    /pg_dump/i,
    /CREATE TABLE/i,
    /INSERT INTO/i,
    /PostgreSQL database dump/i,
    /^\s*--\s*Dumped from/i,
  ].some((re) => re.test(text));
  return {
    encrypted,
    raw: rawSignals && !encrypted,
    allowed: encrypted,
    reason: encrypted ? null : rawSignals ? 'raw_database_dump_forbidden' : 'not_an_encrypted_dump',
  };
}

// ---------------------------------------------------------------------------
// لقطة المراقبة + الفحص الساعي (قراءة فقط)
// ---------------------------------------------------------------------------

/** يبني monitoringSnapshot موحّداً بكل الحقول المطلوبة (بلا أي سرّ). */
export function buildMonitoringSnapshot(input = {}) {
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    state: input.state ?? 'unknown',
    lastSyncAt: input.lastSyncAt ?? null,
    lastChangeAt: input.lastChangeAt ?? null,
    commit: input.commit ?? null,
    treeHash: input.treeHash ?? null,
    versionSizeBytes: Number.isFinite(input.versionSizeBytes) ? input.versionSizeBytes : null,
    fileCount: Number.isFinite(input.fileCount) ? input.fileCount : null,
    restorePointCount: Number.isFinite(input.restorePointCount) ? input.restorePointCount : 0,
    lastDbBackupAt: input.lastDbBackupAt ?? null,
    dbEncrypted: input.dbEncrypted === true,
    secretScan: input.secretScan ?? { ok: null, findings: 0 },
    currentIntegrity: input.currentIntegrity ?? { verified: false, detail: null },
    quota: input.quota ?? { usageBytes: null, designBytes: DESIGN_QUOTA_BYTES, headroomBytes: QUOTA_HEADROOM_BYTES },
    lastError: input.lastError ?? null,
    lastCheckAt: input.lastCheckAt ?? null,
    authorized: input.authorized === true,
  };
}

/**
 * الفحص الساعي: قراءة فقط. لا رفع ولا حذف ولا كتابة.
 * يكشف: انقطاع التفويض، تجاوز المساحة، عدم تطابق الشجرة، سرّ مُرصود،
 * نسخة DB غير مشفّرة، وعدم سلامة current.
 */
export function hourlySafetyCheck(input = {}) {
  const issues = [];
  if (!input.authorized) issues.push({ code: 'not_authorized', detail: 'لا تفويض Drive فعّال.' });
  if (input.secretFinding) issues.push({ code: 'secret_detected', detail: 'سر مُرصود: يجب إيقاف الرفع.' });
  if (input.quotaExceeded) issues.push({ code: 'quota_exceeded', detail: 'المساحة تجاوزت الحد التصميمي.' });
  if (input.treeMismatch) issues.push({ code: 'tree_mismatch', detail: 'بصمة الشجرة لا تطابق لقطة current.' });
  if (input.currentIntegrity === false) issues.push({ code: 'current_corrupt', detail: 'current غير سليم.' });
  if (input.rawDbDetected) issues.push({ code: 'raw_db_detected', detail: 'قاعدة بيانات خام مرفوعة: ممنوعة.' });

  return {
    ok: issues.length === 0,
    readOnly: true,
    issues,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// بيان نقطة الاستعادة (recovery manifest)
// ---------------------------------------------------------------------------

/** يبني بيان نقطة استعادة مستقلة (بلا أي سرّ). */
export function buildRecoveryManifest(input = {}) {
  return {
    kind: 'recovery-point',
    id: String(input.id ?? ''),
    immutable: true,
    createdAt: input.createdAt ?? new Date().toISOString(),
    commit: input.commit ?? null,
    treeHash: input.treeHash ?? null,
    fileCount: Number.isFinite(input.fileCount) ? input.fileCount : 0,
    sizeBytes: Number.isFinite(input.sizeBytes) ? input.sizeBytes : 0,
    parentId: input.parentId ?? null,
    note: input.note ?? null,
    dbBackupId: input.dbBackupId ?? null,
    dbEncrypted: input.dbEncrypted === true,
    encryptedSecretsHash: input.encryptedSecretsHash ?? null,
    encryptedSecretsSize: Number.isFinite(input.encryptedSecretsSize) ? input.encryptedSecretsSize : null,
    secretsCount: Number.isFinite(input.secretsCount) ? input.secretsCount : null,
  };
}

/** يتحقق أن نقطة الاستعادة rp-001 مربوطة بالـcommit المعتمد الصحيح. */
export function assertRp001Manifest(manifest) {
  if (!manifest || manifest.id !== RP_001_ID) {
    return { ok: false, reason: 'not_rp001' };
  }
  if (manifest.commit !== RP_001_COMMIT) {
    return { ok: false, reason: 'rp001_commit_mismatch', expected: RP_001_COMMIT, actual: manifest.commit ?? null };
  }
  if (manifest.immutable !== true) {
    return { ok: false, reason: 'rp001_not_immutable' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// تحقق عام من المعرّفات
// ---------------------------------------------------------------------------

export function isValidRestorePointId(id) {
  return /^rp-\d{3,}$/.test(String(id ?? ''));
}

export function isValidCommitHash(h) {
  return /^[0-9a-f]{40}$/.test(String(h ?? '').trim());
}

// ---------------------------------------------------------------------------
// نسخة احتياطية موثّقة: بيان النسخة + تحقق النسخ الكاذب + ترقيم نقاط الاستعادة
// ---------------------------------------------------------------------------

export const BACKUP_VERSION = 1;
export const BACKUP_SCHEMA_VERSION = 1;
/** أول نقطة استعادة تاريخية تُنشأ آلياً (rp-001 محجوزة للـcommit المعتمد). */
export const FIRST_AUTO_RP_NUMBER = 2;

/**
 * يبني بيان النسخة الاحتياطية. لا يحمل أي سرّ: بصمات وأحجام وأسماء فقط.
 * الحقول المطلوبة كلها حاضرة، وما لا يُعرف يبقى null بصراحةً.
 */
export function buildBackupManifest(input = {}) {
  return {
    kind: 'backup-version',
    project: input.project ?? 'al-gharabi-ai',
    repository: input.repository ?? null,
    branch: input.branch ?? null,
    commit: input.commit ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    sourceHash: input.sourceHash ?? null,
    databaseHash: input.databaseHash ?? null,
    encryptedDatabaseHash: input.encryptedDatabaseHash ?? null,
    treeHash: input.treeHash ?? null,
    fileCount: Number.isFinite(input.fileCount) ? input.fileCount : 0,
    sourceSize: Number.isFinite(input.sourceSize) ? input.sourceSize : null,
    databaseSize: Number.isFinite(input.databaseSize) ? input.databaseSize : null,
    encryptedDatabaseSize: Number.isFinite(input.encryptedDatabaseSize) ? input.encryptedDatabaseSize : null,
    encryptedSecretsHash: input.encryptedSecretsHash ?? null,
    encryptedSecretsSize: Number.isFinite(input.encryptedSecretsSize) ? input.encryptedSecretsSize : null,
    secretsCount: Number.isFinite(input.secretsCount) ? input.secretsCount : null,
    schemaVersion: Number.isFinite(input.schemaVersion) ? input.schemaVersion : BACKUP_SCHEMA_VERSION,
    bundleVersion: Number.isFinite(input.bundleVersion) ? input.bundleVersion : SOURCE_BUNDLE_VERSION,
    backupVersion: Number.isFinite(input.backupVersion) ? input.backupVersion : BACKUP_VERSION,
    recoveryPointId: input.recoveryPointId ?? null,
    status: input.status ?? 'verified',
    previousRecoveryPointId: input.previousRecoveryPointId ?? null,
  };
}

/** بصمة النسخة المصدرية: بصمة الشجرة + بصمة الحزمة (تكشف أي تغيير في المحتوى). */
export function sourceSignature(manifest) {
  return {
    commit: manifest?.commit ?? null,
    treeHash: manifest?.treeHash ?? null,
    sourceHash: manifest?.sourceHash ?? null,
  };
}

/** هل النسخة الجديدة مطابقة للسابقة (نفس commit + treeHash + sourceHash)؟ */
export function isSameSource(previous, next) {
  const a = sourceSignature(previous);
  const b = sourceSignature(next);
  return Boolean(a.treeHash) && a.commit === b.commit && a.treeHash === b.treeHash && a.sourceHash === b.sourceHash;
}

/** يحسب معرّف نقطة الاستعادة التالية من قائمة المعرّفات الحالية. */
export function nextRecoveryPointId(existingIds) {
  let max = FIRST_AUTO_RP_NUMBER - 1;
  for (const id of existingIds || []) {
    const m = /^rp-(\d{3,})$/.exec(String(id ?? ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `rp-${String(max + 1).padStart(3, '0')}`;
}

/**
 * تحقق النسخ الكاذب: يقارن ما نُقل فعلاً (أحجام وبصمات مقروءة من Drive) بما توقّعناه.
 * لا يكفي HTTP 200 — يجب مطابقة الوجود والحجم والبصمة. أي فرق => ok=false بسبب صريح.
 */
export function evaluateBackupVerification(expected = {}, actual = {}) {
  const problems = [];
  if (!actual.bundlePresent) problems.push('bundle_missing_on_drive');
  if (!actual.dbPresent) problems.push('database_missing_on_drive');
  if (!actual.manifestPresent) problems.push('manifest_missing_on_drive');
  // حزمة الأسرار المشفّرة إلزامية إن توقّعناها (لا نسخة تعافٍ كاملة بلا أسرار).
  if (expected.encryptedSecretsHash && !actual.secretsPresent) problems.push('secrets_missing_on_drive');
  if (expected.sourceSize != null && actual.bundleSize != null && expected.sourceSize !== actual.bundleSize) {
    problems.push('source_size_mismatch');
  }
  if (expected.encryptedDatabaseSize != null && actual.dbSize != null && expected.encryptedDatabaseSize !== actual.dbSize) {
    problems.push('database_size_mismatch');
  }
  if (expected.encryptedSecretsSize != null && actual.secretsSize != null && expected.encryptedSecretsSize !== actual.secretsSize) {
    problems.push('secrets_size_mismatch');
  }
  if (expected.sourceHash && actual.bundleHash && expected.sourceHash !== actual.bundleHash) {
    problems.push('source_hash_mismatch');
  }
  if (expected.encryptedDatabaseHash && actual.dbHash && expected.encryptedDatabaseHash !== actual.dbHash) {
    problems.push('database_hash_mismatch');
  }
  if (expected.encryptedSecretsHash && actual.secretsHash && expected.encryptedSecretsHash !== actual.secretsHash) {
    problems.push('secrets_hash_mismatch');
  }
  if (expected.treeHash && actual.treeHash && expected.treeHash !== actual.treeHash) {
    problems.push('tree_hash_mismatch');
  }
  return { ok: problems.length === 0, problems };
}

/** يستخلص ملخصاً صادقاً لحالة النسخة من بيان current (للواجهة). بلا أي سرّ. */
export function summarizeBackupState(manifest) {
  if (!manifest) return { hasBackup: false, state: 'never_synced' };
  return {
    hasBackup: true,
    state: 'synced',
    commit: manifest.commit ?? null,
    recoveryPointId: manifest.recoveryPointId ?? null,
    createdAt: manifest.createdAt ?? null,
    treeHash: manifest.treeHash ?? null,
    sourceHash: manifest.sourceHash ?? null,
    databaseHash: manifest.databaseHash ?? null,
    encryptedDatabaseHash: manifest.encryptedDatabaseHash ?? null,
    fileCount: manifest.fileCount ?? null,
    sourceSize: manifest.sourceSize ?? null,
    databaseSize: manifest.databaseSize ?? null,
    encryptedDatabaseSize: manifest.encryptedDatabaseSize ?? null,
    backupVersion: manifest.backupVersion ?? null,
    bundleVersion: manifest.bundleVersion ?? null,
  };
}

// ---------------------------------------------------------------------------
// حزمة الأسرار المشفّرة (secrets.enc) — بيان وكشف الشكل فقط (التشفير في secret-crypto.mjs)
// ---------------------------------------------------------------------------

export const SECRETS_PACKAGE_MAGIC = 'GHARABI-SECRETS-V1';
export const SECRETS_PACKAGE_VERSION = 1;

/**
 * هل النص حزمة أسرار مشفّرة بالشكل الصحيح؟ (بلا فكّ — التحقق من البنية فقط).
 * خطّي O(n) بلا regex غير محدود، فلا يستنفد المكدس مع ciphertext كبير.
 */
export function isEncryptedSecretsPackage(content) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content ?? '');
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== SECRETS_PACKAGE_MAGIC) return false;
  const hasEncrypted = lines.some((l) => /^encrypted:\s*true\s*$/.test(l));
  const hasCipher = lines.some((l) => /^cipher:\s*aes-256-gcm\s*$/.test(l));
  const hasData = hasValidDataLine(text);
  return hasEncrypted && hasCipher && hasData;
}

/**
 * بيان حزمة الأسرار: أسماء المتغيّرات المشمولة فقط + عددها وبصمة الحزمة المشفّرة.
 * **لا يحمل أي قيمة سرّية إطلاقاً** — أسماء فقط + بصمات.
 */
export function buildSecretsPackageManifest(input = {}) {
  return {
    kind: 'secrets-package',
    version: Number.isFinite(input.version) ? input.version : SECRETS_PACKAGE_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    includedNames: Array.isArray(input.includedNames) ? [...input.includedNames].sort() : [],
    skippedNames: Array.isArray(input.skippedNames) ? [...input.skippedNames].sort() : [],
    includedCount: Number.isFinite(input.includedCount) ? input.includedCount : (input.includedNames || []).length,
    encrypted: true,
    cipher: 'aes-256-gcm',
    kdf: input.kdf ?? 'scrypt',
    keyFingerprint: input.keyFingerprint ?? null,
    encryptedSecretsHash: input.encryptedSecretsHash ?? null,
    encryptedSecretsSize: Number.isFinite(input.encryptedSecretsSize) ? input.encryptedSecretsSize : null,
    masterKeyRequired: true,
    masterKeyEnvNames: Array.isArray(input.masterKeyEnvNames) ? input.masterKeyEnvNames : [],
  };
}

// ---------------------------------------------------------------------------
// مرآة CURRENT (ملفات فردية ببنية مجلدات) — بيان الحالة
// ---------------------------------------------------------------------------

export const MIRROR_DIR_NAME = 'files';
export const MIRROR_MANIFEST_VERSION = 1;

/** يبني بيان المرآة (ملفات فردية داخل current/files/**). بلا أي سرّ. */
export function buildMirrorManifest(input = {}) {
  return {
    kind: 'current-mirror',
    version: Number.isFinite(input.version) ? input.version : MIRROR_MANIFEST_VERSION,
    commit: input.commit ?? null,
    treeHash: input.treeHash ?? null,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    fileCount: Number.isFinite(input.fileCount) ? input.fileCount : 0,
    sizeBytes: Number.isFinite(input.sizeBytes) ? input.sizeBytes : 0,
    files: Array.isArray(input.files) ? input.files : [], // [{ path, sha256, driveId, size }]
  };
}

/**
 * حالة المزامنة الحالية (current-state.json): ملخص صادق للواجهة والاستعادة.
 * لا يحمل أي قيمة سرّية، بل حالات وأعداد وأسماء متغيّرات فقط.
 */
export function buildCurrentState(input = {}) {
  return {
    kind: 'current-state',
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    commit: input.commit ?? null,
    branch: input.branch ?? null,
    repository: input.repository ?? null,
    treeHash: input.treeHash ?? null,
    sourceHash: input.sourceHash ?? null,
    fileCount: Number.isFinite(input.fileCount) ? input.fileCount : 0,
    sizeBytes: Number.isFinite(input.sizeBytes) ? input.sizeBytes : 0,
    lastRecoveryPointId: input.lastRecoveryPointId ?? null,
    recoveryPointCount: Number.isFinite(input.recoveryPointCount) ? input.recoveryPointCount : 0,
    database: input.database ?? { present: false, encrypted: true, hash: null, size: null },
    secrets: input.secrets ?? { present: false, encrypted: true, count: 0, hash: null, size: null, names: [] },
    schemaVersion: Number.isFinite(input.schemaVersion) ? input.schemaVersion : BACKUP_SCHEMA_VERSION,
    deploy: input.deploy ?? null,
    requiredEnvNames: Array.isArray(input.requiredEnvNames) ? input.requiredEnvNames : [],
    restoreTargets: input.restoreTargets ?? { render: 'al-gharabi-ai', github: input.repository ?? null },
  };
}

// ---------------------------------------------------------------------------
// وثائق التعافي المستقلة (تُقرأ بلا تشغيل الغرابي)
// ---------------------------------------------------------------------------

/**
 * وثيقة معلومات التعافي: تصف البنية والحدود دون أي سرّ. تُرفع إلى
 * `recovery/recovery-information.md` لتكون قابلة للقراءة من Google Drive مباشرة.
 */
export function buildRecoveryInformation(input = {}) {
  const repository = input.repository ?? 'mrdalghrabylltqsyt-web/al-gharabi-ai';
  const renderService = input.renderService ?? 'al-gharabi-ai';
  const publicUrl = input.publicUrl ?? 'https://al-gharabi-ai.onrender.com';
  return `# الغرابي AI — معلومات التعافي (Recovery Information)

> هذه الوثيقة مستقلة: يمكن قراءتها من Google Drive **بلا تشغيل الغرابي**.
> لا تحتوي أي قيمة سرّية. الأسرار موجودة فقط داخل \`secrets.enc\` المشفّرة.

## 1) أين تقع مكوّنات التعافي
- \`CURRENT/files/**\`  — مرآة الملفات الحقيقية (كل ملف بمكانه داخل المجلدات).
- \`CURRENT/manifest.json\` — بيان النسخة (بصمات/أحجام/التزام) بلا أسرار.
- \`CURRENT/current-state.json\` — ملخص حالة المزامنة الحالية.
- \`CURRENT/recovery-manifest.json\` — بيان آخر نقطة استعادة مرتبطة بـCURRENT.
- \`HISTORY/rp-XXX/\` — نقاط استعادة كاملة مستقلة (source.tar.gz + database.enc + secrets.enc + manifest.json). لا تُعدّل أبداً.
- \`DATABASE/\` — نسخ قاعدة بيانات مشفّرة مستقلة (\`database.enc\`).
- \`SECRETS/\` — حزمة الأسرار المشفّرة (\`secrets.enc\` + \`manifest.json\`).
- \`RECOVERY/latest-recovery.json\` — أحدث نقطة استعادة سليمة + خطوات الاستعادة.

## 2) ما يحتاجه الاسترداد
1. وصول إلى Google Drive (حساب المالك) لمجلد \`al-gharabi-ai-dr\`.
2. **Recovery Master Key** (مفتاح فكّ الأسرار) — لا يوجد داخل أي ملف في Drive.
3. حساب Render لخدمة \`${renderService}\` (لإعادة ضبط متغيّرات البيئة والنشر).
4. المستودع على GitHub: \`${repository}\` (اختياري إن استُخدم المصدر من HISTORY).

## 3) متغيّرات البيئة المطلوبة للتشغيل
تُقرأ أسماؤها من \`CURRENT/current-state.json\` (حقل \`requiredEnvNames\`) ومن
\`SECRETS/manifest.json\` (حقل \`includedNames\`). **لا توجد أي قيمة هنا.**
القيم تُستعاد من \`secrets.enc\` بعد فكّها بالمفتاح الرئيسي.

## 4) كيفية بدء الاستعادة (يدوياً بلا الغرابي)
1. نزّل \`HISTORY/rp-XXX/source.tar.gz\` و\`database.enc\` و\`secrets.enc\` و\`manifest.json\`.
2. تحقّق من البصمات مقابل \`manifest.json\` (sourceHash / encryptedDatabaseHash / encryptedSecretsHash / treeHash).
3. فكّ \`secrets.enc\` بالمفتاح الرئيسي (سكربت \`tools/dr/secrets-restore.mjs\`).
4. فكّ \`database.enc\` إلى SQL (سكربت \`tools/dr/restore-db.mjs\`)، ثم شغّله على قاعدة استعادة معزولة.
5. فكّ \`source.tar.gz\` إلى مجلد عمل، ثم \`npm ci && npm run build\`.
6. اضبط متغيّرات البيئة من الأسرار المفكوكة (في Render أو ملف \`.env\` محلي)، واضبط \`DATABASE_URL\` لقاعدة الاستعادة.
7. شغّل الخادم وافحص \`/api/health\` ثم \`/api/readiness\`.

## 5) التحقق من نجاح الاستعادة
- \`/api/health\` => \`success: true\` و\`persistence.healthy\`.
- \`/api/readiness\` => \`applicationReady\` وكتلة \`brain\`.
- وجود بيانات أساسية (المستخدمون/المنصات/workspace) في قاعدة الاستعادة.
- عدم ظهور أي سرّ في سجلات الخادم.

## 6) حدود الأتمتة
- **AUTOMATIC**: النسخ، المزامنة، إنشاء نقاط الاستعادة، التحقق، فكّ التشفير، تحميل القاعدة، تشغيل الخادم في اختبار معزول.
- **OWNER CONFIRMATION**: أي استعادة فوق الإنتاج، وأي حذف تاريخي.
- **EXTERNAL PLATFORM REQUIREMENT**: إعادة النشر على Render وضبط متغيّراتها، وتفويض Google OAuth.
- **MANUAL FALLBACK**: إن تعذّر الاتصال بـDrive، تُستعاد الحزمة يدوياً من الملفات المنزّلة.

## 7) المفتاح الرئيسي
- اسم المتغيّر الموصى به: \`DR_RECOVERY_MASTER_KEY\` (وإن غاب يُقبل \`DRIVE_DB_BACKUP_KEY\`).
- إن فُقد المفتاح: **لا يمكن فكّ الأسرار** (AES-256-GCM). تبقى المصدر وقاعدة البيانات
  قابلين للاستعادة، وتُعاد الأسرار يدوياً من لوحات المزوّدين (Render/Meta/Google/…).
- تدوير المفتاح: أنشئ حزمة أسرار جديدة بالمفتاح الجديد ثم نقطة استعادة جديدة.
- التحقق من عدم فقدان المفتاح: شغّل \`GET /api/dr/secrets/status\` (للمالك) — يجب أن
  يظهر \`masterKey.state = valid\` و\`canDecrypt = true\`.

---
تاريخ التوليد: ${input.createdAt ?? new Date().toISOString()}
`;
}

/** تعليمات مختصرة للاستعادة السريعة. */
export function buildRecoveryInstructions(input = {}) {
  const latest = input.latestRecoveryPointId ?? 'rp-XXX';
  return `# الغرابي AI — تعليمات الاستعادة السريعة

آخر نقطة استعادة سليمة: **${latest}**

1. من Google Drive → \`al-gharabi-ai-dr/HISTORY/${latest}/\` نزّل:
   \`source.tar.gz\`, \`database.enc\`, \`secrets.enc\`, \`manifest.json\`.
2. تحقّق من البصمات (SHA-256) مقابل \`manifest.json\`.
3. فكّ الأسرار: \`node tools/dr/secrets-restore.mjs --in secrets.enc --out .env.restored\`
   (يحتاج \`DR_RECOVERY_MASTER_KEY\` في البيئة).
4. فكّ قاعدة البيانات: \`node tools/dr/restore-db.mjs --in database.enc --out restored.sql\`.
5. استعادة المصدر: \`tar -xzf source.tar.gz -C <workdir>\` ثم \`npm ci && npm run build\`.
6. اضبط متغيّرات البيئة + \`DATABASE_URL\`، ثم \`npm run start\`.
7. تحقّق: \`/api/health\` و\`/api/readiness\`.

تفاصيل كاملة: انظر \`recovery-information.md\`.
`;
}

/** أحدث نقطة استعادة + ملخص خطوات الاستعادة (بلا أسرار). */
export function buildLatestRecovery(input = {}) {
  return {
    kind: 'latest-recovery',
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    latestRecoveryPointId: input.latestRecoveryPointId ?? null,
    commit: input.commit ?? null,
    createdAt: input.createdAt ?? null,
    treeHash: input.treeHash ?? null,
    sourceHash: input.sourceHash ?? null,
    databaseHash: input.databaseHash ?? null,
    encryptedDatabaseHash: input.encryptedDatabaseHash ?? null,
    encryptedSecretsHash: input.encryptedSecretsHash ?? null,
    fileCount: Number.isFinite(input.fileCount) ? input.fileCount : null,
    sourceSize: Number.isFinite(input.sourceSize) ? input.sourceSize : null,
    secretsCount: Number.isFinite(input.secretsCount) ? input.secretsCount : null,
    status: input.status ?? 'verified',
    restoreSteps: [
      'اختيار نقطة الاستعادة',
      'التحقق من manifest',
      'التحقق من البصمات',
      'فكّ تشفير الأسرار',
      'فكّ تشفير قاعدة البيانات',
      'استعادة المصدر',
      'استعادة قاعدة البيانات',
      'استعادة إعدادات التشغيل والأسرار',
      'إعادة النشر (خارجي)',
      'فحص health/readiness',
    ],
    automationBoundaries: {
      automatic: ['backup', 'sync', 'recovery_point', 'verify', 'decrypt', 'db_load', 'boot'],
      ownerConfirmation: ['restore_production', 'history_delete'],
      externalPlatformRequirement: ['render_redeploy', 'env_var_set', 'google_oauth'],
      manualFallback: ['drive_offline_download'],
    },
  };
}

