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
import {
  shouldExclude,
  DR_ROOT_DIR,
  RP_001_COMMIT,
} from './cloud-lib.mjs';
import { DriveClient, createGaxiosTransport } from './drive-client.mjs';
import { DriveStore } from './drive-store.mjs';
import { DriveSync } from './drive-sync.mjs';
import { createRefreshTokenProvider, inspectDriveAuthEnv } from './drive-auth.mjs';

const REPO_ROOT = process.cwd();
const MAX_FILE_BYTES = 8 * 1024 * 1024; // تجاهل الملفات الضخمة جداً من النسخة

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
