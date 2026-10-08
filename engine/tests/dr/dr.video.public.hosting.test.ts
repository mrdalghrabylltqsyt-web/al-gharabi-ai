/**
 * Task #21 — اختبار منطقي لاستضافة Drive العامة لفيديوهات التسويق (بلا شبكة
 * حقيقية، عبر Drive وهمي بالكامل). يثبت:
 *  - إنشاء مجلد الجذر التسويقي `al-gharabi-ai-marketing` منفصلاً تماماً عن
 *    مجلد DR، وإعادة استخدامه إن وُجد بدل إنشاء مجلد مكرر.
 *  - رفع الفيديو، منح صلاحية قراءة عامة («anyone»/«reader») فقط، وإعادة رابط
 *    مباشر (`publicUrl`) قابل للاستخدام في `video_url`.
 *  - فشل منح الصلاحية بعد رفع ناجح => تراجع (حذف الملف) بدل تركه معلّقاً.
 *  - سحب الصلاحية العامة وحذف الملف معاً (`revokePublicVideo`).
 */

import {
  ensureMarketingFolder,
  uploadPublicVideo,
  revokePublicVideo,
  publishVideoPublicly,
  MARKETING_ROOT_FOLDER_NAME,
} from '../../social/videoPublicHosting';
import { DriveClient } from '../../../tools/dr/drive-client.mjs';
import { createFakeDriveState, makeFakeTransport, seedFile } from './helpers/fakeDrive';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function buildClient(state: ReturnType<typeof createFakeDriveState>) {
  return new DriveClient({ transport: makeFakeTransport(state), accessToken: 'fake-token-for-test' });
}

async function run(): Promise<void> {
  // 1) إنشاء المجلد الجذري من الصفر.
  {
    const state = createFakeDriveState();
    const client = buildClient(state);
    const res = await ensureMarketingFolder(client, null);
    check('ensureMarketingFolder creates root when absent', res.ok === true && Boolean(res.rootId));
    const folderReq = state.requests.find((r) => r.method === 'POST' && r.url.includes('/drive/v3/files?'));
    check('root created via POST /files (not root reference)', Boolean(folderReq));
  }

  // 2) إعادة استخدام المجلد الموجود بالاسم بدل إنشاء مكرر.
  {
    const state = createFakeDriveState();
    const existing = seedFile(state, { name: MARKETING_ROOT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' });
    const client = buildClient(state);
    const res = await ensureMarketingFolder(client, null);
    check('ensureMarketingFolder reuses existing folder by name', res.ok === true && res.rootId === existing.id);
    check('no duplicate folder created', [...state.files.values()].filter((f) => f.name === MARKETING_ROOT_FOLDER_NAME).length === 1);
  }

  // 3) معرّف محفوظ صالح => لا بحث ولا إنشاء إطلاقاً.
  {
    const state = createFakeDriveState();
    const existing = seedFile(state, { name: MARKETING_ROOT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' });
    const client = buildClient(state);
    const res = await ensureMarketingFolder(client, { rootId: existing.id });
    check('stored rootId short-circuits lookup', res.ok === true && res.rootId === existing.id);
  }

  // 4) رفع فيديو + منح صلاحية عامة + رابط مباشر.
  {
    const state = createFakeDriveState();
    const client = buildClient(state);
    const folder = await ensureMarketingFolder(client, null);
    const content = Buffer.from('fake-video-bytes');
    const uploaded = await uploadPublicVideo(client, { folderId: folder.rootId!, fileName: 'product-ad.mp4', content, mimeType: 'video/mp4' });
    check('uploadPublicVideo succeeds', uploaded.ok === true, JSON.stringify(uploaded));
    check('returns a fileId', typeof uploaded.fileId === 'string' && uploaded.fileId.length > 0);
    check('returns a permissionId', typeof uploaded.permissionId === 'string' && uploaded.permissionId.length > 0);
    check('returns a usable publicUrl', typeof uploaded.publicUrl === 'string' && uploaded.publicUrl!.includes(uploaded.fileId!));
    const perm = state.permissions.get(uploaded.permissionId!);
    check('permission is anyone/reader only (public read, nothing more)', Boolean(perm) && perm!.type === 'anyone' && perm!.role === 'reader');
  }

  // 5) فشل منح الصلاحية بعد رفع ناجح => تراجع (الملف لا يبقى معلّقاً).
  {
    const state = createFakeDriveState();
    const client = buildClient(state);
    const folder = await ensureMarketingFolder(client, null);
    const content = Buffer.from('fake-video-bytes-2');
    const uploaded = await client.createFile({ name: 'will-fail-permission.mp4', parentId: folder.rootId!, content, mimeType: 'video/mp4' });
    check('setup: file created before permission attempt', uploaded.ok === true);
    const fileId = uploaded.data.id;
    // نحقن فشل الطلب التالي فقط (منح الصلاحية) لمحاكاة 403/429 من Drive.
    state.failOnceStatus = 403;
    const result = await uploadPublicVideo(client, { folderId: folder.rootId!, fileName: 'second-file.mp4', content, mimeType: 'video/mp4' });
    check('uploadPublicVideo reports failure when permission grant fails', result.ok === false);
    // الملف الثاني (الذي فشل منحه) يجب أن يُحذف تراجعاً — لا يبقى ملفان معلّقان.
    const remainingNames = [...state.files.values()].map((f) => f.name);
    check('rolled back file is deleted after permission failure', !remainingNames.includes('second-file.mp4'), remainingNames.join(','));
    check('earlier unrelated file untouched', remainingNames.includes('will-fail-permission.mp4'));
    void fileId;
  }

  // 6) السحب الكامل (صلاحية + ملف).
  {
    const state = createFakeDriveState();
    const client = buildClient(state);
    const folder = await ensureMarketingFolder(client, null);
    const content = Buffer.from('fake-video-bytes-3');
    const uploaded = await uploadPublicVideo(client, { folderId: folder.rootId!, fileName: 'to-revoke.mp4', content, mimeType: 'video/mp4' });
    check('setup: uploaded before revoke', uploaded.ok === true);
    const revoked = await revokePublicVideo(client, { fileId: uploaded.fileId!, permissionId: uploaded.permissionId });
    check('revokePublicVideo succeeds', revoked.ok === true);
    check('file actually removed from Drive', !state.files.has(uploaded.fileId!));
    check('permission actually removed from Drive', !state.permissions.has(uploaded.permissionId!));
  }

  // 7) تركيب شامل (publishVideoPublicly) من الصفر في نداء واحد.
  {
    const state = createFakeDriveState();
    const client = buildClient(state);
    const content = Buffer.from('fake-video-bytes-4');
    const result = await publishVideoPublicly(client, { fileName: 'full-flow.mp4', content, mimeType: 'video/mp4' });
    check('publishVideoPublicly end-to-end succeeds', result.ok === true, JSON.stringify(result));
    check('publishVideoPublicly returns folderId for persistence', typeof result.folderId === 'string');
    check('publishVideoPublicly returns publicUrl', typeof result.publicUrl === 'string');
    // يستخدم المجلد التسويقي المنفصل، وليس أي مجلد DR.
    const folder = [...state.files.values()].find((f) => f.id === result.folderId);
    check('used the separate marketing root folder, not a DR folder', Boolean(folder) && folder!.name === MARKETING_ROOT_FOLDER_NAME);
  }

  console.log(`PASSED: ${passed} video-public-hosting checks`);
  if (failures.length) {
    console.error('FAILURES:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

run();
