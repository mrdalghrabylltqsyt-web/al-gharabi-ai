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

// ---------------------------------------------------------------------------
// ثوابت العقد
// ---------------------------------------------------------------------------

export const DR_FOLDER_NAME = 'al-gharabi-ai-dr';
export const DR_SUBDIRS = ['current', 'history', 'db'];
export const DR_ROOT_DIR = '.dr-recovery';

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
  return false;
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

// ---------------------------------------------------------------------------
// قاعدة البيانات: رفض الخام، قبول المشفّر فقط
// ---------------------------------------------------------------------------

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
  const hasData = /^data:\s*[A-Za-z0-9+/=_-]{16,}\s*$/m.test(text);
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
