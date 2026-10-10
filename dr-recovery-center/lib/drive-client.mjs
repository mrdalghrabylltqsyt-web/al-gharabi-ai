/**
 * عميل Google Drive REST (v3) — عبر gaxios فقط، بلا googleapis.
 *
 * لماذا REST مباشر: نحتاج عمليات قليلة (إنشاء مجلد، رفع، استبدال، حذف، قراءة
 * مساحة)؛ googleapis حزمة ضخمة بلا داعٍ. gaxios كافٍ ويسمح بحقن ناقل (transport)
 * كامل، فتُختبر المنظومة بخادم Drive وهمي محلي بلا مزود حقيقي.
 *
 * العقد مع الناقل (transport): دالة تأخذ `{url, method, headers, body, responseType}`
 * وتعيد `{status, headers, data}`. أي رمي منها يُصنَّف network_error.
 *
 * لا يُسجَّل ولا يُعاد أي سرّ. الرمز يُمرَّر عبر `tokenProvider` عند كل طلب.
 */

import crypto from 'node:crypto';
import { Gaxios } from 'gaxios';
import { DR_FOLDER_NAME as DR_FOLDER, DR_SUBDIRS, toBuffer } from './cloud-lib.mjs';
import {
  resolveRequestTimeoutMs,
  envTimeoutMs,
  settleWithTimeout,
} from './drive-timeouts.mjs';

export const DRIVE_API_BASE = 'https://www.googleapis.com';

/**
 * يوجّه قاعدة عناوين Drive عبر البيئة عند ضبطها (يُستخدم في الاختبارات المحلية
 * بخادم وهمي بلا أي مزود حقيقي، وفي تشخيص الاتصال). لا سرّ هنا؛ مجرد عنوان.
 */
export function resolveDriveApiBase(env = process.env) {
  const raw = env && env.DRIVE_API_BASE;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : DRIVE_API_BASE;
}

/** حدود إعادة المحاولة: أخطاء عابرة فقط (429/5xx/شبكة). */
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_RETRY_BASE_MS = 200;

// ---------------------------------------------------------------------------
// ناقل حقيقي مبني على gaxios
// ---------------------------------------------------------------------------

export function createGaxiosTransport(instance = new Gaxios(), options = {}) {
  const requestTimeout = Number.isFinite(options.requestTimeoutMs)
    ? options.requestTimeoutMs
    : envTimeoutMs(process.env, 'DRIVE_REQUEST_TIMEOUT_MS', 0);
  return async function gaxiosTransport(opts) {
    // مهلة صريحة لكل طلب: إن تعثّر الاتصال بـgoogleapis.com لا يبقى الطلب معلّقاً
    // بلا نهاية؛ ينتهي بخطأ عابر (timeout) يدخل منطق إعادة المحاولة أو يفشل بوضوح.
    const perRequestMs = requestTimeout > 0 ? requestTimeout : resolveRequestTimeoutMs(opts);
    const startedAt = Date.now();
    const fetchOnce = () => instance.request({
      url: opts.url,
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      responseType: opts.responseType || 'json',
      validateStatus: () => true,
      retry: false,
      timeout: perRequestMs,
    });
    let res;
    try {
      res = await fetchOnce();
    } catch (err) {
      // حماية إضافية: بعض مسارات gaxios الدنيا لا تحترم `timeout` دائماً. نغلّف
      // الطلب بمهلة صريحة أيضاً فنضمن ألّا يبقى `await` معلّقاً أبداً.
      if (Date.now() - startedAt < perRequestMs) {
        // لم تكتمل المهلة بعد => خطأ حقيقي (شبكة/إغلاق المقبس) لا انتهاء مهلة.
        throw err;
      }
      throw Object.assign(new Error('drive_request_timeout'), { code: 'ETIMEDOUT', timeoutMs: perRequestMs });
    }
    // gaxios يعيد ArrayBuffer لـresponseType=arraybuffer؛ نوحّده إلى Buffer.
    const data = opts.responseType === 'arraybuffer' ? toBuffer(res.data) : res.data;
    return { status: res.status, headers: res.headers || {}, data };
  };
}

/**
 * ناقل قياسي بحدّ زمني مضمون بغضّ النظر عن سلوك gaxios الداخلي: يغلّف كل نداء
 * `instance.request` بمهلة صريحة عبر `settleWithTimeout`. يُستخدم حيث نريد ضماناً
 * صريحاً (الاستضافة العامة للفيديو) فيُقطع الطلب عند انتهاء المهلة حتى لو تجاهل
 * التنفيذ الداخلي خيار `timeout`.
 */
export function createTimeoutGuardedTransport(fetchImpl, timeoutMs) {
  return function guardedTransport(opts) {
    return settleWithTimeout(Promise.resolve().then(() => fetchImpl(opts)), timeoutMs, () => {
      // لا إجراء إضافي: المهلة تكفي لتحرير المسار المعلّق.
    });
  };
}

export { resolveRequestTimeoutMs, settleWithTimeout, envTimeoutMs };

// ---------------------------------------------------------------------------
// بناء/تحليل multipart/related (رفع Drive القياسي)
// ---------------------------------------------------------------------------

export function buildMultipartRelated(metadata, content, mimeType, boundary) {
  const b = boundary || `gharabi-${crypto.randomBytes(12).toString('hex')}`;
  const head = Buffer.from(
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${b}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`,
    'utf8',
  );
  const body = Buffer.concat([
    head,
    Buffer.isBuffer(content) ? content : Buffer.from(content ?? '', 'utf8'),
    Buffer.from(`\r\n--${b}--\r\n`, 'utf8'),
  ]);
  return { body, boundary: b, contentType: `multipart/related; boundary=${b}` };
}

export function parseMultipartRelated(body, contentType) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '');
  const m = /boundary=([^;]+)/.exec(String(contentType || ''));
  const boundary = m ? m[1].trim().replace(/^"|"$/g, '') : '';
  if (!boundary) return { metadata: null, content: Buffer.alloc(0) };
  const delimiter = Buffer.from(`--${boundary}`, 'utf8');
  const parts = [];
  let idx = buf.indexOf(delimiter);
  while (idx !== -1) {
    const start = idx + delimiter.length;
    if (buf.slice(start, start + 2).toString('utf8') === '--') break; // الخاتمة
    const next = buf.indexOf(delimiter, start);
    if (next === -1) break;
    let part = buf.slice(start, next);
    // إزالة CRLF المحيطة
    if (part.slice(0, 2).toString('utf8') === '\r\n') part = part.slice(2);
    if (part.slice(-2).toString('utf8') === '\r\n') part = part.slice(0, -2);
    parts.push(part);
    idx = next;
  }
  // عقد Drive: الجزء الأول دائماً الميتاداتا (JSON)، والثاني المحتوى. لا نعتمد
  // على Content-Type لأن محتوى الملف نفسه قد يكون JSON فيلتبس بالأول.
  const payloads = parts.map((part) => {
    const sep = part.indexOf(Buffer.from('\r\n\r\n', 'utf8'));
    return sep === -1 ? part : part.slice(sep + 4);
  });
  let metadata = null;
  let content = Buffer.alloc(0);
  if (payloads.length >= 2) {
    try { metadata = JSON.parse(payloads[0].toString('utf8')); } catch { metadata = null; }
    content = payloads[1];
  } else if (payloads.length === 1) {
    content = payloads[0];
  }
  return { metadata, content };
}

// ---------------------------------------------------------------------------
// تصنيف الأخطاء
// ---------------------------------------------------------------------------

/**
 * يستخرج حقول خطأ Google الأصلية من جسم الاستجابة — **بلا أي سرّ**.
 * Google يعيد: { error: { code, message, errors:[{ reason, domain }], status } }.
 * رسالة Google آمنة (لا تحمل رمزاً ولا سرّاً) لكن نقصّها وننقّيها احتياطاً.
 */
export function extractDriveError(err) {
  const resp = err?.response;
  const data = resp?.data ?? err?.data ?? null;
  const gErr = data && typeof data === 'object' ? (data.error || data) : null;
  const first = Array.isArray(gErr?.errors) ? gErr.errors[0] : null;
  const message = typeof gErr?.message === 'string' ? gErr.message : null;
  const sanitize = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300) || null;
  return {
    googleCode: Number(gErr?.code ?? resp?.status ?? err?.status ?? 0) || null,
    googleMessage: sanitize(message),
    googleReason: sanitize(first?.reason) || sanitize(gErr?.status) || null,
    googleDomain: sanitize(first?.domain) || null,
  };
}

export function classifyDriveError(err) {
  const status = Number(err?.status ?? err?.response?.status ?? 0);
  const details = extractDriveError(err);
  // فشل المصادقة/التجديد ليس خطأ شبكة: يميّز «يلزم إعادة ربط Drive» عن أي عطل آخر،
  // فلا تظهر رسالة عامة مضلِّلة عند رفض Google لرمز التجديد (invalid_grant).
  const rawCode = String(err?.code || '');
  const lcCode = rawCode.toLowerCase();
  const authFailCodes = ['invalid_grant', 'unauthorized_client', 'invalid_rapt', 'no_refresh_token', 'refresh_token_undecryptable', 'token_key_missing', 'unauthorized'];
  if (!status && authFailCodes.includes(lcCode)) {
    return { ok: false, status: 0, code: 'drive_reauth_required', message: 'تفويض Google Drive غير صالح أو منتهٍ؛ يلزم إعادة الربط.', errorDetails: details };
  }
  // انتهاء مهلة صريح (نقل أو غلاف): كود `timeout` عابر يدخل منطق إعادة المحاولة.
  const errCode = String(err?.code || '').toUpperCase();
  if (!status && (errCode === 'ETIMEDOUT' || errCode === 'ECONNABORTED' || errCode === 'TIMEOUT' || err?.name === 'AbortError')) {
    return { ok: false, status: 0, code: 'timeout', message: 'انتهت مهلة الاتصال بـ Google Drive.', errorDetails: details };
  }
  if (!status) return { ok: false, status: 0, code: 'network_error', message: 'تعذّر الوصول إلى Google Drive.', errorDetails: details };
  if (status === 401) return { ok: false, status, code: 'unauthorized', message: 'رمز Drive غير صالح (401).', errorDetails: details };
  if (status === 403) {
    const reason = details.googleReason ? ` [${details.googleReason}]` : '';
    return {
      ok: false,
      status,
      code: 'forbidden',
      message: `صلاحية Drive مرفوضة (403)${reason}.`,
      errorDetails: details,
    };
  }
  if (status === 429) return { ok: false, status, code: 'rate_limited', message: 'تجاوز حد الطلبات (429).', errorDetails: details };
  if (status === 404) return { ok: false, status, code: 'not_found', message: 'العنصر غير موجود (404).', errorDetails: details };
  if (status >= 500) return { ok: false, status, code: 'server_error', message: `عطل مؤقت لدى Drive (${status}).`, errorDetails: details };
  return { ok: false, status, code: 'client_error', message: `طلب Drive مرفوض (${status}).`, errorDetails: details };
}

export function isTransient(code) {
  return code === 'rate_limited' || code === 'server_error' || code === 'network_error' || code === 'timeout';
}

// ---------------------------------------------------------------------------
// العميل
// ---------------------------------------------------------------------------

export class DriveClient {
  constructor(options = {}) {
    this.apiBase = options.apiBase || resolveDriveApiBase();
    this.transport = options.transport;
    if (!this.transport) throw new Error('DriveClient يحتاج ناقلاً (transport).');
    this.tokenProvider = options.tokenProvider || (() => options.accessToken || null);
    this.maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : DEFAULT_MAX_RETRIES;
    this.retryBaseMs = Number.isFinite(options.retryBaseMs) ? options.retryBaseMs : DEFAULT_RETRY_BASE_MS;
    this.sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.calls = [];
  }

  async authHeaders() {
    const token = await this.tokenProvider();
    if (!token) throw Object.assign(new Error('no_token'), { code: 'unauthorized' });
    return { Authorization: `Bearer ${token}` };
  }

  /** طلب واحد مع إعادة محاولة للأخطاء العابرة فقط. لا يعيد رمياً أبداً. */
  async request(opts) {
    const attempt = async () => {
      const started = Date.now();
      try {
        const headers = { ...(opts.headers || {}) };
        // تجديد الرمز داخل try: فشل المصادقة/التجديد يُصنَّف بدل أن يرمي ويمرّ
        // كخطأ عام يخفي السبب الحقيقي (كان يخرج قبل محاولة النقل، فلا يُصنَّف ولا يُسجَّل).
        if (!opts.skipAuth) Object.assign(headers, await this.authHeaders());
        const res = await this.transport({ ...opts, headers });
        this.calls.push({ method: opts.method, url: opts.url, status: res.status, ms: Date.now() - started });
        if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, data: res.data, headers: res.headers };
        return classifyDriveError({ status: res.status, response: { status: res.status, data: res.data } });
      } catch (err) {
        this.calls.push({ method: opts.method, url: opts.url, status: 0, ms: Date.now() - started });
        // نُمرّر الخطأ كما هو ليبقى `err.code` (مثل ETIMEDOUT/invalid_grant) فتتم تصنيفته بدقة.
        return classifyDriveError(err);
      }
    };
    let result = await attempt();
    let retries = 0;
    // idempotency: طلب يغيّر الحالة (POST/PATCH/DELETE) قد يكون قد نُفّذ فعلاً لدى
    // Drive عند تعثّر الشبكة/المهلة (الردّ ضاع فقط). إعادة إرساله تُنشئ نسخة/أثراً
    // مكرّراً بلا معرّف معروف. لذلك نعيد المحاولة فقط لطرق القراءة الآمنة، أو عند
    // خطأ خادم صريح (5xx/429: لم يُنفَّذ). أما timeout/network_error على طلب مُغيِّر
    // فلا تُعاد تلقائياً — يُعاد الفشل بوضوح ويقرّر المستدعي.
    const method = String(opts?.method || 'GET').toUpperCase();
    const mutating = method === 'POST' || method === 'PATCH' || method === 'DELETE' || method === 'PUT';
    const retriableNow = (code) => isTransient(code) && (!mutating || code === 'rate_limited' || code === 'server_error');
    while (!result.ok && retriableNow(result.code) && retries < this.maxRetries) {
      retries += 1;
      await this.sleep(this.retryBaseMs * retries);
      result = await attempt();
    }
    return { ...result, retries };
  }

  // ---- قراءة ----

  async getAbout() {
    const url = `${this.apiBase}/drive/v3/about?fields=storageQuota,user`;
    return this.request({ url, method: 'GET' });
  }

  async listChildren(parentId) {
    const q = `'${parentId}' in parents and trashed = false`;
    const fields = 'files(id,name,mimeType,size,md5Checksum,parents,modifiedTime),nextPageToken';
    const url = `${this.apiBase}/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=1000`;
    return this.request({ url, method: 'GET' });
  }

  async findFolder(name, parentId) {
    const q = `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `${this.apiBase}/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name)')}`;
    const res = await this.request({ url, method: 'GET' });
    if (!res.ok) return res;
    const files = res.data?.files || [];
    return { ok: true, status: res.status, data: files[0] || null };
  }

  /**
   * يبحث عن مجلد باسمه فقط (بلا شرط الأب). مع `drive.file` يُعيد فقط المجلدات
   * التي أنشأها التطبيق. لا نستخدم أبداً مجلداً موجوداً مسبقاً لم ينشئه التطبيق.
   * **لا يُستدعى بمرجع `root` أبداً.**
   */
  async listFoldersByName(name) {
    const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `${this.apiBase}/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name)')}&pageSize=100`;
    const res = await this.request({ url, method: 'GET' });
    if (!res.ok) return res;
    return { ok: true, status: res.status, data: res.data?.files || [] };
  }

  /** يقرأ بيانات عنصر بمعرّفه (لإثبات أن المجلد المحفوظ ما زال موجوداً). */
  async getFolder(fileId) {
    return this.getFile(fileId);
  }

  async getFile(fileId) {
    const url = `${this.apiBase}/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,md5Checksum,parents,modifiedTime`;
    return this.request({ url, method: 'GET' });
  }

  async downloadFile(fileId) {
    const url = `${this.apiBase}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    return this.request({ url, method: 'GET', responseType: 'arraybuffer' });
  }

  // ---- كتابة ----

  async createFolder(name, parentId) {
    const url = `${this.apiBase}/drive/v3/files?fields=id,name,mimeType`;
    const metadata = { name, mimeType: 'application/vnd.google-apps.folder' };
    // بلا أب => ينشئه Drive في My Drive (وهذا مسموح بـdrive.file).
    // **لا نستخدم مرجع `root` أبداً** لأنه ليس ملفاً أنشأه التطبيق.
    if (parentId) metadata.parents = [parentId];
    return this.request({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
  }

  /** إنشاء ملف بمحتواه في نداء واحد (multipart/related). */
  async createFile({ name, parentId, content, mimeType }) {
    const { body, contentType } = buildMultipartRelated(
      { name, parents: parentId ? [parentId] : undefined },
      content,
      mimeType || 'application/octet-stream',
    );
    const url = `${this.apiBase}/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,md5Checksum`;
    return this.request({ url, method: 'POST', headers: { 'Content-Type': contentType }, body });
  }

  /** استبدال محتوى ملف قائم (media) ثم مطابقة الاسم/الأب إن لزم (metadata). */
  async updateFileContent(fileId, content, mimeType) {
    const url = `${this.apiBase}/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,size,md5Checksum`;
    return this.request({
      url,
      method: 'PATCH',
      headers: { 'Content-Type': mimeType || 'application/octet-stream' },
      body: Buffer.isBuffer(content) ? content : Buffer.from(content ?? '', 'utf8'),
    });
  }

  async updateFileMetadata(fileId, metadata) {
    const url = `${this.apiBase}/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,parents`;
    return this.request({ url, method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) });
  }

  async deleteFile(fileId) {
    const url = `${this.apiBase}/drive/v3/files/${encodeURIComponent(fileId)}`;
    return this.request({ url, method: 'DELETE' });
  }

  /**
   * يمنح صلاحية قراءة عامة («أي شخص لديه الرابط») لملف أنشأه التطبيق نفسه —
   * `drive.file` يسمح بهذا للملفات المملوكة للتطبيق فقط (لا يمكن تعميم ملف لم
   * ينشئه التطبيق). يُستخدم حصراً لفيديوهات تسويقية يختار المالك نشرها علناً
   * عبر منصات تتطلب رابط فيديو عام (video_url) — لا يُستدعى لأي ملف نسخ احتياطي
   * أو سرّ (تلك تبقى دوماً خاصة، فصل تام عن هذه الدالة).
   */
  async createPublicPermission(fileId) {
    const url = `${this.apiBase}/drive/v3/files/${encodeURIComponent(fileId)}/permissions?fields=id`;
    return this.request({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'anyone', role: 'reader' }),
    });
  }

  /** يسحب صلاحية القراءة العامة عن ملف (تراجع — يُستخدم عند فشل لاحق أو طلب إزالة). */
  async deletePermission(fileId, permissionId) {
    const url = `${this.apiBase}/drive/v3/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`;
    return this.request({ url, method: 'DELETE' });
  }

  // ---- تركيب عالٍ ----

  /** هل المجلد بمعرّفه موجود فعلاً؟ (لإثبات صلاحية معرّف محفوظ). */
  async folderExists(fileId) {
    if (!fileId) return false;
    const res = await this.getFile(fileId);
    return Boolean(res.ok && res.data && res.data.id);
  }

  /**
   * يضمن وجود المجلد الجذري والمجلدات الفرعية الثلاثة، **متوافقاً مع `drive.file`**.
   *
   * القواعد الملزمة (منع 403):
   *  - لا نستخدم أبداً مرجع `root` (ليس ملفاً أنشأه التطبيق => مرفوض بـdrive.file).
   *  - الجذر يُنشأ **بلا أب** (Drive يضعه في My Drive) ما لم نكن نحفظ معرّفه.
   *  - نعتمد أولاً على المعرّفات المحفوظة، ثم مجرد البحث بالاسم (بلا شرط أب)،
   *    وأخيراً الإنشاء. الفشل يوقف بوضوح، ولا يُلمس أي عنصر غير مملوك للتطبيق.
   *
   * @param {{ rootId?: string, subdirs?: Record<string,string> } | null} [stored]
   * @param {{ create?: boolean }} [options] create=false => بحث فقط بلا إنشاء (قراءة آمنة).
   */
  async ensureStructure(stored = null, options = {}) {
    const create = options.create !== false;
    let rootId = stored?.rootId || null;
    if (rootId && !(await this.folderExists(rootId))) rootId = null;
    if (!rootId) {
      const found = await this.listFoldersByName(DR_FOLDER);
      if (!found.ok) return found;
      if (found.data.length) rootId = found.data[0].id;
    }
    if (!rootId) {
      if (!create) return { ok: false, status: 0, code: 'no_structure', message: 'بنية Drive غير موجودة بعد.' };
      const created = await this.createFolder(DR_FOLDER, null);
      if (!created.ok) return created;
      rootId = created.data?.id;
    }
    const ids = {};
    for (const sub of DR_SUBDIRS) {
      let id = stored?.subdirs?.[sub] || null;
      if (id && !(await this.folderExists(id))) id = null;
      if (!id) {
        const found = await this.findFolder(sub, rootId);
        if (!found.ok) return found;
        id = found.data?.id || null;
      }
      if (!id) {
        if (!create) return { ok: false, status: 0, code: 'no_structure', message: 'بنية Drive غير مكتملة بعد.' };
        const created = await this.createFolder(sub, rootId);
        if (!created.ok) return created;
        id = created.data?.id;
      }
      ids[sub] = id;
    }
    return { ok: true, status: 200, data: { rootId, subdirs: ids } };
  }
}
