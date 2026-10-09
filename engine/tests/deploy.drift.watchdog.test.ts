/**
 * اختبار حارس انحراف النشر (Deploy Drift Watchdog) — يثبت إصلاح العطلين المثبّتين من
 * التشغيل #37950528349:
 *  1) مقارنة SHA: SHA الإنتاج المختصر يطابق بداية SHA الكامل (لا إنذار كاذب)، SHA مختلف
 *     فعلاً يُرصد، وقيمة فارغة ليست تطابقاً.
 *  2) البلاغ: كل أمر gh يحمل `--repo` صريحاً (لا اعتماد على .git محلي)، سلوك البلاغ
 *     الواحد (تعليق على تذكرة قائمة بدل إنشاء)، وفشل الإنشاء يُعلن (لا ابتلاع صامت).
 *
 * منطق صافٍ بلا شبكة ولا أسرار: نستورد الوحدة الفعلية المُشغَّلة في CI (نفس الكود بلا نسخ).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  shaMatches, classifyDrift, buildIssueBody, buildGhIssueListArgs,
  buildGhIssueCommentArgs, buildGhIssueCreateArgs, parseExistingIssueNumber, isFullSha,
  SUPPORTED_SHA_LENGTHS, ISSUE_TITLE,
} from '../../scripts/deploy-drift/lib.mjs';
import { reportDrift } from '../../scripts/deploy-drift/report.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const FULL = 'bb004fef1dd29c5c005a830fb80dbedaecfee2e6';
const SHORT7 = 'bb004fe';
const SHORT8 = 'bb004fef';
const REPO = 'mrdalghrabylltqsyt-web/al-gharabi-ai';

function run(): void {
  // ---- 1) SHA متطابق كامل/مختصر (سيناريو العطل الحقيقي) ----
  check('SHA كامل يطابق مختصره (7)', shaMatches(SHORT7, FULL) === true, `${SHORT7} vs ${FULL}`);
  check('مختصر مقابل كامل يطابق أيضاً (اتجاه معاكس)', shaMatches(FULL, SHORT8) === true);
  check('قرار العطل الحقيقي: لا drift عند تطابق المختصر', classifyDrift({ headSha: FULL, prodSha: SHORT7 }).drift === false);
  check('سبب التطابق = match', classifyDrift({ headSha: FULL, prodSha: SHORT7 }).reason === 'match');
  check('كامل مقابل نفسه يطابق', shaMatches(FULL, FULL) === true);
  check('مختصران متساويان يطابقان', shaMatches(SHORT7, SHORT7) === true);
  check('أحرف كبيرة/صغيرة لا تفرّق', shaMatches('BB004FE', FULL) === true);

  // ---- 2) SHA مختلف فعلاً يُرصد ----
  const OTHER = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  check('SHA مختلف فعلاً لا يطابق', shaMatches('a1b2c3d', FULL) === false);
  check('قرار الاختلاف = drift', classifyDrift({ headSha: FULL, prodSha: 'a1b2c3d' }).drift === true);
  check('سبب الاختلاف = sha_mismatch', classifyDrift({ headSha: FULL, prodSha: 'a1b2c3d' }).reason === 'sha_mismatch');

  // ---- 3) قيمة فارغة ليست تطابقاً ----
  check('فارغ/فارغ ليس تطابقاً', shaMatches('', '') === false);
  check('prod فارغ => ليس تطابقاً', shaMatches('', FULL) === false);
  check('head فارغ => ليس تطابقاً', shaMatches(SHORT7, '') === false);
  check('prod فارغ مع head صالح => drift unknown_production_commit', classifyDrift({ headSha: FULL, prodSha: '' }).drift === true && classifyDrift({ headSha: FULL, prodSha: '' }).reason === 'unknown_production_commit');
  check('head فارغ => drift unknown_head_sha (لا ادّعاء تطابق)', classifyDrift({ headSha: '', prodSha: SHORT7 }).reason === 'unknown_head_sha');
  check('قيمة غير hex لا تُعتبر تطابقاً', shaMatches('zzzzzzz', FULL) === false);
  check('طول غير مدعوم لا يُعتبر تطابقاً', shaMatches('bb004', FULL) === false);
  check('isFullSha يتحقق من 40', isFullSha(FULL) === true && isFullSha(SHORT7) === false);
  check('أطوال SHA المدعومة = 40/8/7', SUPPORTED_SHA_LENGTHS.join(',') === '40,8,7');

  // ---- 4) البلاغ: --repo صريح (سبب «not a git repository» مُغلق) ----
  const listArgs = buildGhIssueListArgs(REPO);
  check('gh issue list يحمل --repo', listArgs.includes('--repo') && listArgs[listArgs.indexOf('--repo') + 1] === REPO, listArgs.join(' '));
  const commentArgs = buildGhIssueCommentArgs(REPO, 12, 'b');
  check('gh issue comment يحمل --repo', commentArgs.includes('--repo') && commentArgs[commentArgs.indexOf('--repo') + 1] === REPO);
  const createArgs = buildGhIssueCreateArgs(REPO, ISSUE_TITLE, 'b');
  check('gh issue create يحمل --repo', createArgs.includes('--repo') && createArgs[createArgs.indexOf('--repo') + 1] === REPO);
  check('كل بواني gh تحمل --repo (لا اعتماد على .git)', [listArgs, commentArgs, createArgs].every((a) => a.includes('--repo')));

  // سلوك البلاغ الواحد: تذكرة قائمة => تعليق (لا إنشاء مكرر).
  const calls: { args: string[] }[] = [];
  const fakeExec = (args: string[]) => { calls.push({ args }); if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify([{ number: 42 }]); return ''; };
  const commented = reportDrift({ repo: REPO, headSha: FULL, prodSha: 'a1b2c3d', reason: 'sha_mismatch', when: 'T' }, fakeExec as any);
  check('تذكرة قائمة => تعليق لا إنشاء', commented.action === 'commented' && commented.number === 42, JSON.stringify(commented));
  check('لا استدعاء لـgh issue create عند وجود تذكرة', !calls.some((c) => c.args[1] === 'create'));
  check('كل استدعاءات gh الفعلية تحمل --repo', calls.every((c) => c.args.includes('--repo')));

  // لا تذكرة قائمة => إنشاء.
  const calls2: { args: string[] }[] = [];
  const fakeExec2 = (args: string[]) => { calls2.push({ args }); if (args[0] === 'issue' && args[1] === 'list') return '[]'; return ''; };
  const created = reportDrift({ repo: REPO, headSha: FULL, prodSha: 'a1b2c3d', reason: 'sha_mismatch', when: 'T' }, fakeExec2 as any);
  check('لا تذكرة => إنشاء واحدة', created.action === 'created' && calls2.some((c) => c.args[1] === 'create'));
  check('الإنشاء يمرّ بـ--repo', calls2.find((c) => c.args[1] === 'create')?.args.includes('--repo') === true);

  // ---- 5) فشل إنشاء البلاغ يُعلن (لا ابتلاع صامت) ----
  const throwingExec = (args: string[]) => { if (args[1] === 'list') return '[]'; throw new Error('gh: HTTP 403'); };
  let threw = false;
  try { reportDrift({ repo: REPO, headSha: FULL, prodSha: 'a1b2c3d', reason: 'sha_mismatch', when: 'T' }, throwingExec as any); } catch { threw = true; }
  check('فشل gh issue create يرمي (لا فشل صامت)', threw === true);
  let threwNoRepo = false;
  try { reportDrift({ repo: '', headSha: FULL, prodSha: 'x', reason: 'r', when: 'T' }, fakeExec as any); } catch { threwNoRepo = true; }
  check('غياب REPO يرمي صراحةً (لا أمر gh بلا وجهة)', threwNoRepo === true);

  check('parseExistingIssueNumber يقرأ الرقم', parseExistingIssueNumber('[{"number":7}]') === 7);
  check('parseExistingIssueNumber يعيد null لفراغ', parseExistingIssueNumber('[]') === null);

  // ---- 6) بنية الـworkflow: يغطّي الإصلاحين ولا يحذف الوظيفة ----
  const wf = read('.github/workflows/deploy-drift-watchdog.yml');
  check('الـworkflow ما زال موجوداً باسمه', wf.includes('name: Deploy Drift Watchdog'));
  check('الـworkflow يشغّل المشغّل عبر node', wf.includes('node scripts/deploy-drift/run.mjs'));
  check('الـworkflow يشغّل البلاغ عبر node', wf.includes('node scripts/deploy-drift/report.mjs'));
  check('خطوة البلاغ مشروطة بـdrift', wf.includes("steps.cmp.outputs.drift == 'true'"));
  check('لا يحذف صلاحيات أقل امتياز', wf.includes('issues: write') && wf.includes('contents: read'));
  check('لم تبقَ المقارنة النصّية الساذجة', !wf.includes('[ "$HEAD" != "$PROD" ]'));

  console.log(`\nPASSED: ${passed} deploy-drift-watchdog checks, ${failures.length} فشل`);
  if (failures.length) { for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
}

run();
