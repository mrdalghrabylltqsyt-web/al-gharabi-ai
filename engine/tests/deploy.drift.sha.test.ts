/**
 * انحدار حتمي لمطابقة SHA في حارس انحراف النشر.
 *
 * الجذر المُثبت: المقارنة النصية الساذجة `[ "$HEAD" != "$PROD" ]` صنّفت
 * `bb004fef1dd29c5c005a830fb80dbedaecfee2e6` (main HEAD) مقابل `bb004fe` (الإنتاج)
 * انحرافاً كاذباً وهما **نفس الالتزام**. الإصلاح: مطابقة البادئة المشتركة بطول أقصر
 * المدخلين بحدّ أدنى 7 محارف، والقيمة الفارغة انحراف دائماً.
 *
 * هذا الاختبار يستخرج منطق المقارنة من ملف الـworkflow نفسه (لا نسخة منحرفة) ويشغّله
 * عبر bash على الحالات المطلوبة — فالكود المُنفَّذ في CI هو الكود المُختبَر.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const WF_PATH = '.github/workflows/deploy-drift-watchdog.yml';
const wf = readFileSync(WF_PATH, 'utf8');

// 1) البنية: لا توجد مقارنة نصية ساذجة، ووجود منطق البادئة.
check('لا مقارنة نصية ساذجة `"$HEAD" != "$PROD"`',
  !/\[ "\$HEAD" != "\$PROD" \]/.test(wf));
check('يستخدم بادئة HEAD', wf.includes('${HEAD:0:$len}'));
check('يستخدم بادئة PROD', wf.includes('${PROD:0:$len}'));
check('حدّ أدنى 7 محارف', /len.*-ge 7/.test(wf));
check('يفحص خلو القيمتين من الفراغ', /\[ -n "\$HEAD" \] && \[ -n "\$PROD" \]/.test(wf));

// 2) استخراج كتلة المقارنة حرفياً من الـworkflow وتشغيلها عبر bash.
const startMarker = 'match=false';
const endMarker = 'echo "drift=true" >> "$GITHUB_OUTPUT"';
const start = wf.indexOf(startMarker);
const end = wf.indexOf(endMarker, start);
check('كتلة المقارنة موجودة في الـworkflow', start !== -1 && end !== -1);

const block = wf.slice(start, end + endMarker.length) + '\nfi';
const script = `classify() {
  HEAD="$1"; PROD="$2"
  ${block}
}
classify "$1" "$2"`;

function classify(head: string, prod: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gharabi-drift-'));
  const outFile = join(dir, 'out.txt');
  try {
    execFileSync('bash', ['-c', script, '_', head, prod], {
      encoding: 'utf8',
      // بيئة صريحة دنيا (PATH فقط) + ملف الإخراج — لا وراثة process.env كاملة،
      // ولا نُقلع الخادم هنا إطلاقاً (فحص منطق bash خالص).
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', GITHUB_OUTPUT: outFile },
    });
    const written = readFileSync(outFile, 'utf8');
    if (/^drift=false$/m.test(written)) return 'NO_DRIFT';
    if (/^drift=true$/m.test(written)) return 'DRIFT';
    return 'UNKNOWN:' + written.trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FULL = 'bb004fef1dd29c5c005a830fb80dbedaecfee2e6';
const OTHER = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';

check('SHA كامل متطابق => لا انحراف', classify(FULL, FULL) === 'NO_DRIFT', classify(FULL, FULL));
check('SHORT7 (الإنتاج) بادئة لـHEAD => لا انحراف', classify(FULL, 'bb004fe') === 'NO_DRIFT', classify(FULL, 'bb004fe'));
check('SHORT8 (الإنتاج) بادئة لـHEAD => لا انحراف', classify(FULL, 'bb004fef') === 'NO_DRIFT', classify(FULL, 'bb004fef'));
check('HEAD قصير بادئة لـPROD (الاتجاه المعاكس) => لا انحراف', classify('bb004fe', FULL) === 'NO_DRIFT', classify('bb004fe', FULL));
check('SHA مختلف فعلاً => انحراف', classify(OTHER, '038830f') === 'DRIFT', classify(OTHER, '038830f'));
check('PROD فارغ => انحراف', classify(FULL, '') === 'DRIFT', classify(FULL, ''));
check('HEAD فارغ => انحراف', classify('', 'bb004fe') === 'DRIFT', classify('', 'bb004fe'));
check('كلاهما فارغ => انحراف', classify('', '') === 'DRIFT', classify('', ''));
check('قيمتان قصيرتان (<7) متطابقتان => لا ادّعاء تطابق => انحراف', classify('bb004f', 'bb004f') === 'DRIFT', classify('bb004f', 'bb004f'));

console.log('\n============================================================');
if (failures.length) {
  console.log(`FAILED: ${failures.length} — ${passed} passed`);
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} deploy-drift SHA-match checks`);
