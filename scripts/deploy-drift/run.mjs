/**
 * مشغّل حارس انحراف النشر — يُنفَّذ من الـ workflow عبر `node` مباشرةً (بلا git، بلا gh
 * للقراءات). يقرأ commit main وcommit الإنتاج عبر واجهة GitHub العامة (بلا مصادقة —
 * قراءة عامة، فأقل امتياز ممكن) و/ أو متغيّرات البيئة، يصنّف الانحراف بالمنطق المُختبر في
 * lib.mjs، ويطبع مخرجات واضحة للـ workflow.
 *
 * البلاغ (issue) لا يُنشأ هنا: يبقى في خطوة `gh` منفصلة داخل الـ workflow حيث يُستخدم
 * `--repo` صريح. هذا الفصل يُبقي هذا الملف قابلاً للاختبار بالكامل بلا شبكة.
 *
 * المدخلات (بيئة): REPO، HEAD_SHA (اختياري — من الخطوة السابقة)، PROD_SHA (اختياري)،
 * PROD_URL (افتراضي خدمة Render)، GH_API (افتراضي api.github.com)، NOW (ISO، للاختبار).
 * المخرجات: تُطبع أسطر `drift=…`, `reason=…`, `head=…`, `prod=…` ثم تُكتب إلى $GITHUB_OUTPUT
 * إن وُجد (لا يطبع أي سرّ).
 */
import { classifyDrift } from './lib.mjs';

/** قراءة commit main من واجهة GitHub العامة (بلا مصادقة). تفشل بأمان إلى ''. */
async function fetchMainSha(repo, ghApi) {
  try {
    const res = await fetch(`https://${ghApi}/repos/${repo}/commits/main`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return '';
    const data = await res.json();
    return String(data?.sha || '');
  } catch {
    return '';
  }
}

/** قراءة commit الإنتاج من /api/health. تفشل بأمان إلى ''. */
async function fetchProdSha(prodUrl) {
  try {
    const sep = prodUrl.includes('?') ? '&' : '?';
    const res = await fetch(`${prodUrl}${sep}t=${Date.now()}`, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) return '';
    const data = await res.json();
    return String(data?.deploy?.commit || '');
  } catch {
    return '';
  }
}

export async function evaluateDrift(env = process.env) {
  const repo = env.REPO || '';
  const headEnv = String(env.HEAD_SHA || '').trim();
  const prodEnv = String(env.PROD_SHA || '').trim();
  const headSha = headEnv || (repo ? await fetchMainSha(repo, env.GH_API || 'api.github.com') : '');
  const prodSha = prodEnv || (await fetchProdSha(env.PROD_URL || 'https://al-gharabi-ai.onrender.com/api/health'));
  const decision = classifyDrift({ headSha, prodSha });
  decision.when = env.NOW || new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return decision;
}

async function main() {
  const d = await evaluateDrift(process.env);
  console.log(`UTC: ${d.when}`);
  console.log(`main HEAD:  ${d.headSha || '(unreadable)'}`);
  console.log(`production: ${d.prodSha || '(none)'}`);
  console.log(`drift=${d.drift}`);
  console.log(`reason=${d.reason}`);
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(out, `drift=${d.drift}\nreason=${d.reason}\nhead=${d.headSha}\nprod=${d.prodSha}\n`);
  }
  if (!d.drift) console.log('الإنتاج يخدم آخر commit على main — لا انحراف.');
}

// يُنفَّذ فقط عند الاستدعاء المباشر (ليس عند الاستيراد في الاختبار).
if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  main().catch((e) => { console.error('drift runner error:', e?.message || e); process.exit(1); });
}
