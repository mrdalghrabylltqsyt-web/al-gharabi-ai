/**
 * منطق حارس انحراف النشر (Deploy Drift Watchdog) — مصدر واحد بلا اعتماديات.
 *
 * سابقاً كان المنطق مكتوباً في سطري `run:` داخل الـ workflow، فاستحال اختباره، وفشل
 * مرتين: (1) مقارنة SHA نصّية ساذجة صنّفت `bb004fef…` مقابل `bb004fe` كـ drift وهما
 * نفس الالتزام؛ (2) استدعاء `gh` بلا سياق مستودع (لا `.git` ولا checkout) ففشل بـ
 * «fatal: not a git repository». الآن المنطق هنا (يُنفَّذ في CI ويُختبر محلياً بنفس الكود
 * بلا نسخ ثانٍ ينحرف)، والـ workflow يشغّله مباشرة عبر `node`.
 *
 * لا شبكة ولا أسرار في هذا الملف عدا ما يُمرَّر صراحةً إلى مزوّد `gh` (للبلاغ فقط).
 * لا يعتمد على `git` إطلاقاً.
 */

/**
 * أطوال sha المدعومة: 40 الكامل، 8 المختصر الحالي، 7 التقليدي (المشروع يعرض 7).
 */
export const SUPPORTED_SHA_LENGTHS = Object.freeze([40, 8, 7]);

/** هل السلسلة sha كامل (hex بطول 40)؟ */
export function isFullSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value.trim().toLowerCase());
}

/**
 * مقارنة SHA: تعيد true فقط عند تطابق مؤكّد (تساوٍ أو كون أحدهما بادئة للآخر)، وfalse
 * لكل ما عدا ذلك. تطبيع بحالة الأحرف الصغيرة لأن git hex غير حسّاس للحالة.
 * - قيمتان فارغتان ليستا تطابقاً (غياب الدليل لا يعني التطابق).
 * - شكل غير hex أو طول غير مدعوم => لا تطابق (نُطلق فحصاً، لا صمتاً).
 */
export function shaMatches(prodSha, headSha) {
  const prod = String(prodSha ?? '').trim().toLowerCase();
  const head = String(headSha ?? '').trim().toLowerCase();
  if (!prod || !head) return false;
  const hex = /^[0-9a-f]+$/;
  if (!hex.test(prod) || !hex.test(head)) return false;
  if (!SUPPORTED_SHA_LENGTHS.includes(prod.length) || !SUPPORTED_SHA_LENGTHS.includes(head.length)) return false;
  if (prod === head) return true;
  const [shorter, longer] = prod.length <= head.length ? [prod, head] : [head, prod];
  return longer.startsWith(shorter);
}

/**
 * قرار الانحراف. لا يُصنَّف التطابق drift ولا العكس.
 *  - head صالح + prod صالح + لا يطابق => { drift:true, reason:'sha_mismatch' }
 *  - head صالح + prod صالح + يطابق    => { drift:false, reason:'match' }
 *  - head صالح + prod غائب            => { drift:true, reason:'unknown_production_commit' }
 *  - head غائب                        => { drift:true, reason:'unknown_head_sha' } (فشل قراءة main)
 */
export function classifyDrift({ headSha, prodSha } = {}) {
  const head = String(headSha ?? '').trim();
  const prod = String(prodSha ?? '').trim();
  const headIsSha = /^[0-9a-f]+$/.test(head.toLowerCase());
  const headValid = headIsSha && (isFullSha(head) || SUPPORTED_SHA_LENGTHS.includes(head.length));
  if (!headValid) return { drift: true, reason: 'unknown_head_sha', headSha: head, prodSha: prod };
  const prodIsSha = /^[0-9a-f]+$/.test(prod.toLowerCase());
  const prodValid = prodIsSha && SUPPORTED_SHA_LENGTHS.includes(prod.length);
  if (!prod || !prodValid) return { drift: true, reason: 'unknown_production_commit', headSha: head, prodSha: prod };
  if (shaMatches(prod, head)) return { drift: false, reason: 'match', headSha: head, prodSha: prod };
  return { drift: true, reason: 'sha_mismatch', headSha: head, prodSha: prod };
}

/** نص بلاغ الانحراف (Markdown) — بلا أي سرّ ولا بيانات حساسة، فقط SHAs وأزمنة. */
export function buildIssueBody({ headSha, prodSha, reason, when } = {}) {
  return [
    `⚠️ انحراف نشر مرصود: main HEAD = \`${headSha || '(غير مقروء)'}\` بينما الإنتاج يخدم \`${prodSha || '(لا يوجد commit في /api/health)'}\`.`,
    `السبب المُصنَّف: \`${reason}\`.`,
    'تحقّق من لوحة Render → خدمة al-gharabi-ai → Deploys (هل فشل النشر أم لم يُطلَق؟)، ومن إعداد Auto-Deploy الفعلي.',
    `الوقت: ${when}.`,
  ].join('\n');
}

export const ISSUE_TITLE = '⚠️ انحراف النشر: الإنتاج لا يخدم آخر commit على main';

export const ISSUE_SEARCH_QUERY = 'انحراف النشر in:title';

/**
 * بواني أوامر gh — **كلها تحمل `--repo` صراحةً** فلا تعتمد على `.git` المحلي إطلاقاً
 * (كان غياب checkout يُنتج «fatal: not a git repository»). الوحدة منطق صافٍ قابل للاختبار.
 */
export function buildGhIssueListArgs(repo, search = ISSUE_SEARCH_QUERY) {
  return ['issue', 'list', '--repo', repo, '--state', 'open', '--search', search, '--limit', '1', '--json', 'number'];
}

export function buildGhIssueCommentArgs(repo, number, body) {
  return ['issue', 'comment', String(number), '--repo', repo, '--body', body];
}

export function buildGhIssueCreateArgs(repo, title, body) {
  return ['issue', 'create', '--repo', repo, '--title', title, '--body', body];
}

/** يحلّل ناتج `gh issue list --json number` إلى رقم أول تذكرة مفتوحة، أو null. */
export function parseExistingIssueNumber(stdout) {
  try {
    const arr = JSON.parse(String(stdout || '[]'));
    if (Array.isArray(arr) && arr.length && arr[0] && Number.isFinite(Number(arr[0].number))) {
      return Number(arr[0].number);
    }
  } catch { /* ناتج غير JSON => لا تذكرة قائمة */ }
  return null;
}
