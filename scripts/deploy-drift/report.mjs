/**
 * بلاغ انحراف النشر — يفتح تذكرة واحدة أو يعلّق على القائمة، **دائماً عبر `--repo` صريح**
 * فلا يعتمد على سياق مستودع محلي (كان هذا سبب «fatal: not a git repository» قبل الإصلاح).
 *
 * المنطق قابل للاختبار بالكامل: `reportDrift` يستقبل دالة تنفيذ (exec) قابلة للحقن،
 * فتتحقق الاختبارات من البواني الفعلية (gh issue list/create/comment) ومن فشل الإنشاء
 * بلا شبكة ولا أسرار.
 *
 * البواني تُبنى في lib.mjs (المصدر الواحد المُختبر)، ولا يطبع أي سرّ.
 */
import { execFileSync } from 'node:child_process';
import {
  buildIssueBody, buildGhIssueListArgs, buildGhIssueCommentArgs, buildGhIssueCreateArgs,
  parseExistingIssueNumber, ISSUE_TITLE,
} from './lib.mjs';

/** تنفيذ gh الافتراضي — يرمي عند فشل الأمر (لا ابتلاع صامت). */
function defaultExec(args, opts) {
  return execFileSync('gh', args, { encoding: 'utf8', env: opts?.env || process.env });
}

/**
 * ينفّذ البلاغ. `exec(args, opts)` يحقن للاختبار. يعيد { action, number }.
 * كل استدعاءات gh تحمل `--repo` => لا حاجة لـ.git (سبب العطل مُغلق).
 */
export function reportDrift({ repo, headSha, prodSha, reason, when }, exec = defaultExec, opts = {}) {
  if (!repo) throw new Error('reportDrift: REPO مطلوب لتمرير --repo إلى gh');
  const body = buildIssueBody({ headSha, prodSha, reason, when });
  const listOut = exec(buildGhIssueListArgs(repo), opts);
  const existing = parseExistingIssueNumber(listOut);
  if (existing) {
    exec(buildGhIssueCommentArgs(repo, existing, body), opts);
    return { action: 'commented', number: existing };
  }
  exec(buildGhIssueCreateArgs(repo, ISSUE_TITLE, body), opts);
  return { action: 'created', number: null };
}

async function main() {
  const repo = process.env.REPO;
  const result = reportDrift({
    repo,
    headSha: process.env.HEAD,
    prodSha: process.env.PROD,
    reason: process.env.REASON,
    when: process.env.NOW || new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  });
  console.log(`بلاغ الانحراف: ${result.action}${result.number ? ` #${result.number}` : ''}`);
}

if (process.argv[1] && process.argv[1].endsWith('report.mjs')) {
  main().catch((e) => { console.error('drift report error:', e?.message || e); process.exit(1); });
}
