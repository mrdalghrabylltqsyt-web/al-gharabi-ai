#!/usr/bin/env node
/**
 * لقطة ثغرات المكتبات زمن البناء (2026-10-29) — ليعرف المهندس المشرف على الخادم الحي ثغرات
 * المكتبات التي بُني بها فعلاً (لا ينتظر CI).
 *
 * يشغّل `npm audit --omit=dev --json` ويكتب ملخصاً صغيراً (أعداد حسب الخطورة + أسماء الحزم المصابة
 * وعناوين الثغرات) إلى المسار المعطى. **يكتب دائماً** (حتى عند الفشل/انعدام الشبكة: ok=false مع
 * السبب) كي لا يكسر البناء، ولا يُرجع رمز فشل أبداً. الملف خارج dist فلا يُخدم علناً
 * (لا نكشف للمهاجم ثغراتنا).
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const out = process.argv[2] || 'dep-audit.json';
const snap = { at: new Date().toISOString(), ok: false, error: null, counts: { critical: 0, high: 0, moderate: 0, low: 0 }, packages: [] };
try {
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', timeout: 90_000, maxBuffer: 32 * 1024 * 1024 });
  const text = String(r.stdout || '').trim();
  if (!text) throw new Error(String(r.error?.message || r.stderr || 'no output').slice(0, 160));
  const j = JSON.parse(text);
  if (j.error) throw new Error(String(j.error.summary || j.error.code || 'audit error').slice(0, 160));
  const v = j.metadata?.vulnerabilities || {};
  snap.counts = { critical: v.critical || 0, high: v.high || 0, moderate: v.moderate || 0, low: v.low || 0 };
  const rank = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  snap.packages = Object.values(j.vulnerabilities || {})
    .map((x) => ({
      name: String(x.name || ''), severity: String(x.severity || ''), fixAvailable: Boolean(x.fixAvailable),
      title: (Array.isArray(x.via) ? x.via.find((y) => typeof y === 'object')?.title : null) || null,
    }))
    .sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))
    .slice(0, 15);
  snap.ok = true;
} catch (e) {
  snap.error = String(e?.message || e).slice(0, 200);
}
writeFileSync(out, JSON.stringify(snap, null, 2));
console.log(`[dep-audit] ok=${snap.ok} critical=${snap.counts.critical} high=${snap.counts.high} moderate=${snap.counts.moderate}${snap.error ? ` error=${JSON.stringify(snap.error)}` : ''}`);
