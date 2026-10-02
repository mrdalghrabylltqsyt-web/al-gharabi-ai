#!/usr/bin/env node
/**
 * يزامن ملفات DR المستقلة من `tools/dr/` إلى `dr-recovery-center/lib/` كي تبقى حزمة
 * خدمة الاستعادة المستقلة **قابلة للنشر وحدها** (Render منفصل) بلا اعتماد على مستودع
 * المشروع كاملاً. يوجد فحص في `final-audit` يمنع أي انحراف (drift) بين النسختين.
 *
 *   node dr-recovery-center/sync-lib.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const srcDir = path.join(repoRoot, 'tools', 'dr');
const libDir = path.join(here, 'lib');

// الوحدات التي تحتاجها خدمة الاستعادة المستقلة فعلاً (وتبعيّاتها المتعدية).
const MODULES = [
  'cloud-lib.mjs',
  'drive-auth.mjs',
  'drive-client.mjs',
  'drive-store.mjs',
  'restore.mjs',
  'secret-crypto.mjs',
  'db-crypto.mjs',
  'key-vault-crypto.mjs',
  'retention.mjs',
  'standalone-recovery.mjs',
  'recovery-center.mjs',
];

fs.mkdirSync(libDir, { recursive: true });
for (const name of MODULES) {
  const src = path.join(srcDir, name);
  if (!fs.existsSync(src)) { console.error(`missing: ${name}`); process.exit(1); }
  fs.copyFileSync(src, path.join(libDir, name));
}
console.log(`synced ${MODULES.length} modules → dr-recovery-center/lib/`);
