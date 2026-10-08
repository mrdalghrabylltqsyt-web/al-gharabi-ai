/**
 * Google Drive وهمي بالكامل — في الذاكرة، بلا شبكة وبلا مزود حقيقي.
 *
 * يُحقن كناقل (transport) في `DriveClient`، فينفّذ نفس عقد REST (v3) الذي
 * يستدعيه العميل: about، files list/create/update/delete، والرفع multipart/media.
 * يدعم حقن الأخطاء (401/403/429/5xx/شبكة) وعدّ الطلبات، لإثبات سلوك المزامنة
 * الآمن دون أي اتصال بـGoogle.
 */

import { parseMultipartRelated } from '../../../../tools/dr/drive-client.mjs';

export interface FakeDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content: Buffer;
  modifiedTime: string;
}

export interface FakeDrivePermission {
  id: string;
  fileId: string;
  type: string;
  role: string;
}

export interface FakeDriveState {
  files: Map<string, FakeDriveFile>;
  permissions: Map<string, FakeDrivePermission>;
  seq: number;
  requests: Array<{ method: string; url: string }>;
  /** كل الطلبات تُرفض بهذه الحالة حتى تُصفَّر (0 = بلا). */
  forcedStatus: number;
  /** الطلب التالي فقط يُرفض بهذه الحالة ثم تُصفَّر. */
  failOnceStatus: number;
  /** الطلب التالي فقط يرمي خطأ شبكة ثم يُصفَّر. */
  failOnceNetwork: boolean;
  /** كل الطلبات ترمي خطأ شبكة (لا يتعافى). */
  alwaysNetworkError: boolean;
  /** أسماء ملفات يفشل إنشاؤها (لمحاكاة رفع جزئي). */
  failCreateNames: Set<string>;
  /**
   * يحاكي فرض `drive.file`: أي طلب يشير إلى مرجع `root` (في q أو parents)
   * يُرفض 403 insufficientPermissions، تماماً كما يفعل Google للمجلد الجذر
   * الذي لم يُنشئه التطبيق.
   */
  forbidRootReference: boolean;
  usageBytes: number;
  limitBytes: number;
}

export function createFakeDriveState(): FakeDriveState {
  return {
    files: new Map(),
    permissions: new Map(),
    seq: 0,
    requests: [],
    forcedStatus: 0,
    failOnceStatus: 0,
    failOnceNetwork: false,
    alwaysNetworkError: false,
    failCreateNames: new Set<string>(),
    forbidRootReference: false,
    usageBytes: 0,
    limitBytes: 15 * 1024 * 1024 * 1024,
  };
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function nextId(state: FakeDriveState): string {
  state.seq += 1;
  return `f_${state.seq}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function findByName(state: FakeDriveState, name: string, parent: string): FakeDriveFile | undefined {
  return [...state.files.values()].find((f) => f.name === name && f.parents.includes(parent));
}

function toMeta(f: FakeDriveFile): any {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: String(f.content.length),
    parents: f.parents,
    modifiedTime: f.modifiedTime,
    // روابط وهمية تماثل شكل Drive الحقيقي (بلا أي استدعاء شبكي فعلي).
    webContentLink: `https://drive.google.com/uc?id=${f.id}&export=download`,
    webViewLink: `https://drive.google.com/file/d/${f.id}/view`,
  };
}

function parseQuery(url: string): Record<string, string> {
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return {};
  const out: Record<string, string> = {};
  for (const pair of url.slice(qIdx + 1).split('&')) {
    const [k, v] = pair.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  }
  return out;
}

function parseQ(q: string): { name?: string; parent?: string; folderOnly: boolean } {
  const out: { name?: string; parent?: string; folderOnly: boolean } = { folderOnly: false };
  const nameMatch = /name\s*=\s*'((?:[^'\\]|\\.)*)'/.exec(q);
  if (nameMatch) out.name = nameMatch[1].replace(/\\'/g, "'");
  const parentMatch = /'([^']+)'\s+in\s+parents/.exec(q);
  if (parentMatch) out.parent = parentMatch[1];
  if (/mimeType\s*=\s*'application\/vnd\.google-apps\.folder'/.test(q)) out.folderOnly = true;
  return out;
}

function splitUrl(url: string): { path: string; query: Record<string, string> } {
  const qIdx = url.indexOf('?');
  const path = qIdx === -1 ? url : url.slice(0, qIdx);
  return { path, query: parseQuery(url) };
}

/**
 * ينفّذ طلباً واحداً على Drive الوهمي ويعيد `{status, headers, data}` كما يفعل
 * الناقل الحقيقي. يرمي عند حقن خطأ الشبكة.
 */
export async function fakeDriveTransport(state: FakeDriveState, opts: any): Promise<{ status: number; headers: Record<string, string>; data: any }> {
  state.requests.push({ method: String(opts.method || 'GET'), url: String(opts.url || '') });

  if (state.alwaysNetworkError) {
    throw Object.assign(new Error('network down'), { code: 'ENOTFOUND' });
  }
  if (state.failOnceNetwork) {
    state.failOnceNetwork = false;
    throw Object.assign(new Error('network down'), { code: 'ENOTFOUND' });
  }
  if (state.failOnceStatus) {
    const s = state.failOnceStatus;
    state.failOnceStatus = 0;
    return { status: s, headers: {}, data: { error: { code: s, message: `injected ${s}`, errors: [{ domain: 'global', reason: s === 403 ? 'insufficientPermissions' : 'injected', message: `injected ${s}` }] } } };
  }
  if (state.forcedStatus) {
    return { status: state.forcedStatus, headers: {}, data: { error: { code: state.forcedStatus, message: `forced ${state.forcedStatus}`, errors: [{ domain: 'global', reason: state.forcedStatus === 403 ? 'insufficientPermissions' : 'forced', message: `forced ${state.forcedStatus}` }] } } };
  }

  const { path, query } = splitUrl(String(opts.url || ''));
  const method = String(opts.method || 'GET').toUpperCase();

  // فرض `drive.file`: مرجع `root` ليس ملفاً أنشأه التطبيق => يُرفض كما عند Google.
  if (state.forbidRootReference) {
    const qHasRoot = /'root'\s+in\s+parents/.test(String(query.q || ''));
    const bodyStr = opts.body == null ? '' : String(opts.body);
    const bodyHasRootParent = /"parents"\s*:\s*\[\s*"root"/.test(bodyStr);
    if (qHasRoot || bodyHasRootParent) {
      return {
        status: 403,
        headers: {},
        data: { error: { code: 403, message: 'The user does not have sufficient permissions for this file.', errors: [{ domain: 'global', reason: 'insufficientPermissions', message: 'The user does not have sufficient permissions for this file.' }] } },
      };
    }
  }

  // about
  if (path.endsWith('/drive/v3/about')) {
    return { status: 200, headers: {}, data: { user: { displayName: 'owner' }, storageQuota: { usage: String(state.usageBytes), limit: String(state.limitBytes) } } };
  }

  // upload endpoints
  if (path.includes('/upload/drive/v3/files')) {
    const idMatch = /\/files\/([^/?]+)/.exec(path);
    if (method === 'POST') {
      const contentType = String(opts.headers?.['Content-Type'] || opts.headers?.['content-type'] || '');
      const parsed = parseMultipartRelated(opts.body, contentType);
      const meta = parsed.metadata || {};
      if (state.failCreateNames.has(String(meta.name || ''))) {
        return { status: 500, headers: {}, data: { error: { code: 500, message: 'injected create failure' } } };
      }
      const file: FakeDriveFile = {
        id: nextId(state),
        name: String(meta.name || ''),
        mimeType: String(meta.mimeType || 'application/octet-stream'),
        parents: (meta.parents as string[]) || [],
        content: parsed.content,
        modifiedTime: nowIso(),
      };
      state.files.set(file.id, file);
      state.usageBytes += file.content.length;
      return { status: 200, headers: {}, data: toMeta(file) };
    }
    if (method === 'PATCH' && idMatch) {
      const file = state.files.get(idMatch[1]);
      if (!file) return { status: 404, headers: {}, data: { error: { code: 404 } } };
      const body = Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(String(opts.body ?? ''), 'utf8');
      state.usageBytes += body.length - file.content.length;
      file.content = body;
      file.modifiedTime = nowIso();
      return { status: 200, headers: {}, data: toMeta(file) };
    }
    return { status: 400, headers: {}, data: { error: { code: 400, message: 'unsupported upload' } } };
  }

  // files collection
  if (path.endsWith('/drive/v3/files') && method === 'GET') {
    const parsed = parseQ(query.q || '');
    let list = [...state.files.values()];
    if (parsed.parent) list = list.filter((f) => f.parents.includes(parsed.parent!));
    if (parsed.name != null) list = list.filter((f) => f.name === parsed.name);
    if (parsed.folderOnly) list = list.filter((f) => f.mimeType === FOLDER_MIME);
    return { status: 200, headers: {}, data: { files: list.map(toMeta) } };
  }
  if (path.endsWith('/drive/v3/files') && method === 'POST') {
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
    if (body.mimeType === FOLDER_MIME && state.failCreateNames.has(String(body.name || ''))) {
      return { status: 500, headers: {}, data: { error: { code: 500, message: 'injected folder create failure' } } };
    }
    const file: FakeDriveFile = {
      id: nextId(state),
      name: String(body.name || ''),
      mimeType: String(body.mimeType || 'application/octet-stream'),
      parents: body.parents || [],
      content: Buffer.alloc(0),
      modifiedTime: nowIso(),
    };
    state.files.set(file.id, file);
    return { status: 200, headers: {}, data: toMeta(file) };
  }

  // صلاحيات مشاركة ملف — تحاكي POST .../files/:id/permissions و
  // DELETE .../files/:id/permissions/:permissionId فقط للملفات المملوكة
  // (المنشأة عبر هذا الناقل نفسه)، كما يفرض `drive.file` فعلياً.
  const permCreate = /\/drive\/v3\/files\/([^/?]+)\/permissions$/.exec(path);
  if (permCreate && method === 'POST') {
    const fileId = permCreate[1];
    const file = state.files.get(fileId);
    if (!file) {
      return {
        status: 404,
        headers: {},
        data: { error: { code: 404, message: 'File not found.', errors: [{ domain: 'global', reason: 'notFound', message: 'File not found.' }] } },
      };
    }
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body || {};
    const perm: FakeDrivePermission = {
      id: `perm_${nextId(state)}`,
      fileId,
      type: String(body.type || 'anyone'),
      role: String(body.role || 'reader'),
    };
    state.permissions.set(perm.id, perm);
    return { status: 200, headers: {}, data: { id: perm.id } };
  }
  const permDelete = /\/drive\/v3\/files\/([^/?]+)\/permissions\/([^/?]+)$/.exec(path);
  if (permDelete && method === 'DELETE') {
    const [, fileId, permissionId] = permDelete;
    const perm = state.permissions.get(permissionId);
    if (!perm || perm.fileId !== fileId) {
      return {
        status: 404,
        headers: {},
        data: { error: { code: 404, message: 'Permission not found.', errors: [{ domain: 'global', reason: 'notFound', message: 'Permission not found.' }] } },
      };
    }
    state.permissions.delete(permissionId);
    return { status: 204, headers: {}, data: {} };
  }

  // single file
  const single = /\/drive\/v3\/files\/([^/?]+)/.exec(path);
  if (single) {
    const id = single[1];
    const file = state.files.get(id);
    if (method === 'GET') {
      if (!file) return { status: 404, headers: {}, data: { error: { code: 404 } } };
      if (query.alt === 'media') {
        return { status: 200, headers: {}, data: Buffer.from(file.content) };
      }
      return { status: 200, headers: {}, data: toMeta(file) };
    }
    if (method === 'PATCH') {
      if (!file) return { status: 404, headers: {}, data: { error: { code: 404 } } };
      const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
      if (body.name) file.name = String(body.name);
      if (body.parents) file.parents = body.parents;
      file.modifiedTime = nowIso();
      return { status: 200, headers: {}, data: toMeta(file) };
    }
    if (method === 'DELETE') {
      if (!file) return { status: 404, headers: {}, data: { error: { code: 404 } } };
      state.usageBytes -= file.content.length;
      state.files.delete(id);
      for (const [permId, perm] of state.permissions) if (perm.fileId === id) state.permissions.delete(permId);
      return { status: 204, headers: {}, data: {} };
    }
  }

  return { status: 404, headers: {}, data: { error: { code: 404, message: 'unknown route' } } };
}

/** ناقل جاهز للحقن في DriveClient. */
export function makeFakeTransport(state: FakeDriveState) {
  return (opts: any) => fakeDriveTransport(state, opts);
}

/** يزرع ملفاً/مجلداً مباشرة في الحالة (لتهيئة اختبار). */
export function seedFile(state: FakeDriveState, file: Partial<FakeDriveFile> & { name: string }): FakeDriveFile {
  const f: FakeDriveFile = {
    id: file.id || nextId(state),
    name: file.name,
    mimeType: file.mimeType || 'application/octet-stream',
    parents: file.parents || [],
    content: file.content || Buffer.alloc(0),
    modifiedTime: file.modifiedTime || nowIso(),
  };
  state.files.set(f.id, f);
  state.usageBytes += f.content.length;
  return f;
}
