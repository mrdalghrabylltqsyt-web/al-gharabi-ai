/**
 * استضافة Drive عامة لفيديوهات التسويق (Task #21).
 *
 * الهدف: منصات مثل إنستغرام/تيك توك لا تقبل رفع بايتات مباشرة عبر الأتمتة —
 * تتطلب رابطاً عاماً قابلاً للسحب (`video_url`). هذه الوحدة ترفع الفيديو إلى
 * مجلد Drive **منفصل تماماً** عن مجلد النسخ الاحتياطي (`al-gharabi-ai-dr`)،
 * ثم تمنحه صلاحية قراءة عامة («أي شخص لديه الرابط»)، وتعيد رابطاً مباشراً.
 *
 * فصل الجذر عمداً: صلاحية القراءة العامة لا تُمنح أبداً لأي ملف نسخة احتياطية
 * أو سرّ — تلك تبقى دوماً خاصة ضمن `al-gharabi-ai-dr`. هذا الملف لا يستورد ولا
 * يلمس تلك البنية؛ يُعيد استخدام فقط عميل Drive العام (`DriveClient`) ومزوّد
 * رمز التجديد نفسه (نفس حساب Drive الشخصي للمالك، المصرَّح له مرة واحدة).
 *
 * تنبيه تشغيلي موثَّق (وليس عيباً في الكود، بل قيد خارجي في Drive نفسه):
 * رابط `webContentLink`/`uc?export=download` العام غير مضمون رسمياً كبثّ بايتات
 * مباشر لكل طالب تلقائي؛ قد يُعيد Drive صفحة HTML وسيطة ("لا يمكن فحص الملف
 * بحثاً عن الفيروسات") خصوصاً للملفات الكبيرة. يجب التحقق بفحص Content-Type
 * الفعلي عند أول استخدام حقيقي مع إنستغرام/تيك توك، وإن ظهرت الصفحة الوسيطة
 * فالحل هو خدمة الفيديو من نقطة نهاية الخادم نفسها (تمرير Range) بدل الرابط
 * العام مباشرة — ليس ضمن نطاق هذه الوحدة بعد.
 */

import { DriveClient } from '../../tools/dr/drive-client.mjs';

/** جذر منفصل تماماً عن `al-gharabi-ai-dr` — لا يُشارك أي معرّف أو منطق معه. */
export const MARKETING_ROOT_FOLDER_NAME = 'al-gharabi-ai-marketing';

export interface MarketingFolderIdentity {
  rootId?: string | null;
}

export interface PublicVideoUploadResult {
  ok: boolean;
  status?: number;
  code?: string;
  message?: string;
  fileId?: string;
  permissionId?: string;
  publicUrl?: string;
  webViewLink?: string | null;
  sizeBytes?: number | null;
}

/**
 * واجهة عميل Drive التي نحتاجها — مُعلَنة صراحةً. الأعضاء تُعيد `DriveResult` ذا
 * الحقول الكاملة (data/status/code/message)، فلا يعتمد TS على الاستدلال عبر الحدود
 * (كان `ok` يُوسَّع إلى `boolean` فيمنع تضييق النوع ويُنتج أخطاء TS2339).
 * `DriveClient` يطابق هذه البنية تماماً — إعادة استخدام لا تعديل.
 */
export type DriveResult = {
  ok: boolean;
  status?: number;
  code?: string;
  message?: string;
  data?: any;
  headers?: any;
};
export interface DriveClientLike {
  apiBase: string;
  folderExists(folderId: string): Promise<boolean>;
  listFoldersByName(name: string): Promise<DriveResult>;
  createFolder(name: string, parentId: string | null): Promise<DriveResult>;
  createFile(input: { name: string; parentId: string; content: Buffer; mimeType: string }): Promise<DriveResult>;
  createPublicPermission(fileId: string): Promise<DriveResult>;
  deletePermission(fileId: string, permissionId: string): Promise<DriveResult>;
  deleteFile(fileId: string): Promise<DriveResult>;
  request(opts: { url: string; method: string }): Promise<DriveResult>;
}
// تأكيد وقت الترجمة: عميل Drive الحقيقي يطابق الواجهة المعلنة — لا انحراف صامت.
type _DriveClientMatches = InstanceType<typeof DriveClient> extends DriveClientLike ? true : never;
const _driveClientCompat: _DriveClientMatches = true;

/**
 * يضمن وجود مجلد الجذر التسويقي (منفصل عن DR)، متوافقاً مع قواعد `drive.file`
 * نفسها (بلا `root` أبداً، معرّف محفوظ أولاً ثم بحث بالاسم ثم إنشاء).
 */
export async function ensureMarketingFolder(
  client: DriveClientLike,
  stored: MarketingFolderIdentity | null = null,
): Promise<{ ok: boolean; status?: number; code?: string; message?: string; rootId?: string }> {
  let rootId = stored?.rootId || null;
  if (rootId) {
    const exists = await client.folderExists(rootId);
    if (!exists) rootId = null;
  }
  if (!rootId) {
    const found = await client.listFoldersByName(MARKETING_ROOT_FOLDER_NAME);
    if (!found.ok) return found;
    if (Array.isArray(found.data) && found.data.length) rootId = found.data[0].id;
  }
  if (!rootId) {
    const created = await client.createFolder(MARKETING_ROOT_FOLDER_NAME, null);
    if (!created.ok) return created;
    rootId = created.data?.id;
  }
  if (!rootId) return { ok: false, status: 0, code: 'folder_missing', message: 'تعذّر تحديد مجلد الفيديوهات العامة.' };
  return { ok: true, rootId };
}

/**
 * يرفع فيديو إلى المجلد التسويقي، يمنحه صلاحية قراءة عامة، ويعيد رابطاً مباشراً.
 * عند فشل منح الصلاحية بعد نجاح الرفع، يحاول حذف الملف (تراجع — لا يترك ملفاً
 * خاصاً ظنّاً أنه عام، ولا ملفاً يتيماً بلا رابط صالح).
 */
export async function uploadPublicVideo(
  client: DriveClientLike,
  input: { folderId: string; fileName: string; content: Buffer; mimeType?: string },
): Promise<PublicVideoUploadResult> {
  const created = await client.createFile({
    name: input.fileName,
    parentId: input.folderId,
    content: input.content,
    mimeType: input.mimeType || 'video/mp4',
  });
  if (!created.ok) return { ok: false, status: created.status, code: created.code, message: created.message };
  const fileId = created.data?.id;
  if (!fileId) return { ok: false, status: 0, code: 'no_file_id', message: 'رفع الفيديو لم يُعِد معرّف ملف.' };

  const perm = await client.createPublicPermission(fileId);
  if (!perm.ok) {
    // تراجع: لا نترك ملفاً مرفوعاً بلا رابط عام صالح معلّقاً بصمت.
    await client.deleteFile(fileId).catch(() => null);
    return { ok: false, status: perm.status, code: perm.code, message: perm.message };
  }

  const linksUrl = `${client.apiBase}/drive/v3/files/${encodeURIComponent(fileId)}?fields=webContentLink,webViewLink,size`;
  const links = await client.request({ url: linksUrl, method: 'GET' });
  if (!links.ok) {
    // الملف مرفوع وعام فعلاً؛ فقط تعذّر قراءة الرابط الجاهز — نبني رابطاً معروفاً كبديل.
    return {
      ok: true,
      fileId,
      permissionId: perm.data?.id,
      publicUrl: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
      webViewLink: null,
      sizeBytes: null,
    };
  }

  const webContentLink = links.data?.webContentLink || null;
  return {
    ok: true,
    fileId,
    permissionId: perm.data?.id,
    publicUrl: webContentLink || `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
    webViewLink: links.data?.webViewLink || null,
    sizeBytes: Number.isFinite(Number(links.data?.size)) ? Number(links.data.size) : null,
  };
}

/**
 * يسحب صلاحية القراءة العامة ويحذف الملف — يُستخدم عند انتهاء الحاجة إلى الرابط
 * العام (مثلاً بعد نجاح النشر على كل المنصات المستهدفة)، لتقليل التعرّض العلني
 * بدل تركه عاماً إلى الأبد بلا داعٍ.
 */
export async function revokePublicVideo(
  client: DriveClientLike,
  input: { fileId: string; permissionId?: string | null },
): Promise<{ ok: boolean; status?: number; code?: string; message?: string }> {
  if (input.permissionId) {
    const revoked = await client.deletePermission(input.fileId, input.permissionId);
    if (!revoked.ok && revoked.code !== 'not_found') return revoked;
  }
  return client.deleteFile(input.fileId);
}

/** تركيب شامل: يضمن المجلد، يرفع، يعيد رابطاً عاماً جاهزاً — نقطة الدخول المقترحة لبقية النظام. */
export async function publishVideoPublicly(
  client: DriveClientLike,
  input: { fileName: string; content: Buffer; mimeType?: string; storedFolder?: MarketingFolderIdentity | null },
): Promise<PublicVideoUploadResult & { folderId?: string }> {
  const folder = await ensureMarketingFolder(client, input.storedFolder || null);
  if (!folder.ok || !folder.rootId) {
    return { ok: false, status: folder.status, code: folder.code, message: folder.message };
  }
  const uploaded = await uploadPublicVideo(client, {
    folderId: folder.rootId,
    fileName: input.fileName,
    content: input.content,
    mimeType: input.mimeType,
  });
  return { ...uploaded, folderId: folder.rootId };
}
