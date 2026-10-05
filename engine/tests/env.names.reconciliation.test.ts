/**
 * اختبار مطابقة أسماء متغيّرات البيئة بين الكود و`.env.example` و`render.yaml`.
 *
 * يمنع انحرافاً حقيقياً: اسم اعتماد يقرأه الكود فعلاً (OAUTH_CONFIG عبر envSecret)
 * لكنه غير موثّق في `.env.example` — فيظن المالك أن متغيّراً غير موجود/غير مطلوب.
 * وكذلك يمنع تسريب أي سرّ عبر متغيّر `VITE_` (يُضمَّن في حزمة المتصفح).
 *
 * لا يلمس أي سرّ: أسماء فقط.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8');

// أسماء تُعلنها البيئة كمتغيّرات تشغيلية (منصة) لا أسرار تطبيق — تُوثَّق في render.yaml فقط.
const PLATFORM_ONLY = new Set(['NODE_ENV', 'NODE_VERSION']);

function envExampleNames(): Set<string> {
  const names = new Set<string>();
  for (const m of read('.env.example').matchAll(/^([A-Z][A-Z0-9_]+)=/gm)) names.add(m[1]);
  return names;
}
function renderKeys(): Set<string> {
  const names = new Set<string>();
  for (const m of read('render.yaml').matchAll(/key:\s*([A-Z][A-Z0-9_]+)/g)) names.add(m[1]);
  return names;
}
function codeReadNames(): Set<string> {
  const src = read('server.ts');
  const names = new Set<string>();
  for (const m of src.matchAll(/envSecret\("([A-Z0-9_]+)"\)/g)) names.add(m[1]);
  return names;
}

function main(): void {
  const envNames = envExampleNames();
  const render = renderKeys();
  const codeNames = codeReadNames();

  group('1) كل اعتماد OAuth يقرأه الكود موثّق في .env.example');
  const undocumented = [...codeNames].filter((n) => !envNames.has(n)).sort();
  check('لا اسم اعتماد غير موثّق في .env.example', undocumented.length === 0, undocumented.join(','));

  group('2) المنصّات المذكورة صراحةً موثّقة');
  for (const n of [
    'X_OAUTH_CLIENT_ID', 'X_OAUTH_CLIENT_SECRET',
    'SNAPCHAT_OAUTH_CLIENT_ID', 'SNAPCHAT_OAUTH_CLIENT_SECRET',
    'THREADS_OAUTH_CLIENT_ID', 'THREADS_OAUTH_CLIENT_SECRET', 'THREADS_APP_SECRET', 'THREADS_VERIFY_TOKEN',
    'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'VITE_GOOGLE_CLIENT_ID',
  ]) {
    check(`${n} موثّق`, envNames.has(n));
  }

  group('3) مفاتيح render.yaml موثّقة في .env.example (عدا متغيّرات المنصة)');
  const renderUndocumented = [...render].filter((n) => !envNames.has(n) && !PLATFORM_ONLY.has(n)).sort();
  check('لا مفتاح Render غير موثّق', renderUndocumented.length === 0, renderUndocumented.join(','));

  group('4) لا سرّ عبر متغيّر VITE_ (يُضمَّن في حزمة المتصفح)');
  const viteNames = new Set<string>();
  for (const f of ['src/components/auth/LoginView.tsx', 'src/services/api.ts']) {
    if (!existsSync(join(REPO_ROOT, f))) continue;
    for (const m of read(f).matchAll(/VITE_[A-Z0-9_]+/g)) viteNames.add(m[0]);
  }
  const secretVite = [...viteNames].filter((n) => /(SECRET|TOKEN|PASSWORD|_KEY$|PRIVATE)/.test(n));
  check('لا VITE_ سرّي في الواجهة', secretVite.length === 0, secretVite.join(','));
  check('VITE_GOOGLE_CLIENT_ID مسموح (معرّف عام)', viteNames.has('VITE_GOOGLE_CLIENT_ID') && !secretVite.includes('VITE_GOOGLE_CLIENT_ID'));

  group('5) ثوابت الملفين سليمة');
  check('.env.example غير فارغ', envNames.size > 40);
  check('render.yaml يحوي keys', render.size > 20);
  check('الكود يقرأ اعتمادات OAuth', codeNames.size >= 6);
}

main();
console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} env-names-reconciliation checks`);
}
