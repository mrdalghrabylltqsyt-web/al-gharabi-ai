#!/usr/bin/env node
/**
 * فهرس البحث الشامل (2026-10-28) — يُولَّد من الكود نفسه فلا يتقادم.
 *
 * بحث «الأقسام والوظائف» في الشريط الجانبي كان يعرف ~25 اسماً فقط (أسماء التبويبات)،
 * فلا يجد «غرفة المهندس» ولا «النسخ الاحتياطي» ولا أي لوحة داخل الشاشات. هذا السكربت
 * يقرأ خريطة التبويبات في App.tsx، ويتتبّع مكوّن كل تبويب وما يستورده من مكوّنات محلية،
 * ويستخرج كل عنوان لوحة (h1–h4، summary، legend) وكل قسم مسمّى (aria-label)، فيصبح كل
 * عنوان ظاهر في أي شاشة قابلاً للبحث وينقل المستخدم إليه مباشرة.
 *
 * التشغيل: node scripts/build-search-index.mjs   (يُشغَّل تلقائياً قبل البناء)
 *          node scripts/build-search-index.mjs --check   (يفشل إن كان الفهرس قديماً — للاختبار/CI)
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(SRC, 'data', 'searchIndex.generated.ts');
const read = (p) => fs.readFileSync(p, 'utf8');

const app = read(path.join(SRC, 'App.tsx'));

// 1) اسم المكوّن ← ملفه (استيراد مباشر أو lazy).
const compFile = {};
for (const m of app.matchAll(/import\s*\{\s*([\w\s,]+)\}\s*from\s*'(\.\/components\/[^']+)'/g)) {
  for (const name of m[1].split(',').map((s) => s.trim()).filter(Boolean)) compFile[name] = m[2];
}
for (const m of app.matchAll(/const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\('(\.\/components\/[^']+)'\)/g)) compFile[m[1]] = m[2];

// 2) التبويب ← المكوّن (من switch العرض).
const tabs = [];
for (const m of app.matchAll(/case\s+'(\w+)':\s*return\s*<(\w+)\s*\/>/g)) tabs.push({ tab: m[1], comp: m[2] });

const resolve = (fromFile, spec) => {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of ['', '.tsx', '.ts', '/index.tsx', '/index.ts']) { const f = base + ext; if (fs.existsSync(f) && fs.statSync(f).isFile()) return f; }
  return null;
};

const ARABIC = /[؀-ۿ]/;
const clean = (raw) => raw
  .replace(/<[^>]*>/g, ' ')            // وسوم JSX داخلية (أيقونات/span)
  .replace(/\{\s*['"`]([^'"`{}]*)['"`]\s*\}/g, ' $1 ') // {'نص'}
  .replace(/\{[^{}]*\}/g, ' ')          // تعبيرات
  .replace(/[{}]/g, ' ')
  .replace(/&[a-z]+;/g, ' ')
  .replace(/\(\s*\)/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** عناوين الشاشة: h1–h4/summary/legend، وكل aria-label على قسم أو لوحة. */
function extract(src) {
  const out = [];
  for (const m of src.matchAll(/<(h[1-4]|summary|legend)\b[^>]*>([\s\S]{1,400}?)<\/\1>/g)) {
    const t = clean(m[2]);
    if (t.length >= 3 && t.length <= 70 && ARABIC.test(t)) out.push({ title: t, kind: m[1] });
  }
  for (const m of src.matchAll(/<(section|div|nav|aside|form)\b[^>]*?aria-label="([^"{}]{3,70})"/g)) {
    if (ARABIC.test(m[2])) out.push({ title: m[2].trim(), kind: 'section' });
  }
  // تبويبات داخلية ومراحل وأنواع (مثل { id: 'x', label: 'الذاكرة' }) — وظائف داخل الشاشة.
  for (const m of src.matchAll(/\{\s*(?:id|key|value):\s*'[\w-]+',\s*(?:label|title):\s*'([^'{}]{3,50})'/g)) {
    if (ARABIC.test(m[1])) out.push({ title: m[1].trim(), kind: 'tab' });
  }
  return out;
}

// إطار التطبيق (الشريط الجانبي/الترويسة) ليس جزءاً من أي شاشة.
const SHELL = new Set(['Sidebar.tsx', 'Header.tsx', 'ErrorBoundary.tsx']);
const owner = new Map(); // ملف ← أول تبويب يملكه (المكوّن المشترك يُنسب لأول شاشة تعرضه)
const entries = [];
const seen = new Set();
for (const { tab, comp } of tabs) {
  const rel = compFile[comp];
  if (!rel) continue;
  const start = resolve(path.join(SRC, 'App.tsx'), rel);
  if (!start) continue;
  const queue = [{ f: start, depth: 0 }];
  const visited = new Set();
  while (queue.length) {
    const { f, depth } = queue.shift();
    if (visited.has(f)) continue;
    visited.add(f);
    if (!owner.has(f)) owner.set(f, tab);
    if (owner.get(f) !== tab) continue; // مكوّن مشترك: عناوينه تُنسب لأول شاشة فقط
    const src = read(f);
    for (const e of extract(src)) {
      const key = `${tab}|${e.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ title: e.title, tab, kind: e.kind === 'tab' ? 'tab' : 'panel', file: path.relative(ROOT, f).replace(/\\/g, '/') });
    }
    if (depth >= 3) continue;
    for (const m of src.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
      const r = resolve(f, m[1]);
      if (r && r.startsWith(path.join(SRC, 'components')) && /\.tsx$/.test(r) && !SHELL.has(path.basename(r))) queue.push({ f: r, depth: depth + 1 });
    }
  }
}
entries.sort((a, b) => a.tab.localeCompare(b.tab) || a.title.localeCompare(b.title, 'ar'));

const body = `/**
 * مُولَّد آلياً بواسطة scripts/build-search-index.mjs — لا تعدّله يدوياً.
 * كل عنوان لوحة/قسم ظاهر في شاشات المشروع مع التبويب الذي يعرضه (${entries.length} عنصراً).
 */
export interface GeneratedSearchEntry { title: string; tab: string; kind: 'panel' | 'tab'; file: string }
export const GENERATED_SEARCH_INDEX: GeneratedSearchEntry[] = ${JSON.stringify(entries, null, 1)};
`;

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? read(OUT) : '';
  if (cur !== body) { console.error('searchIndex.generated.ts قديم — شغّل: node scripts/build-search-index.mjs'); process.exit(1); }
  console.log(`search index up to date (${entries.length})`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, body);
  console.log(`search index written: ${entries.length} entries from ${tabs.length} tabs`);
}
