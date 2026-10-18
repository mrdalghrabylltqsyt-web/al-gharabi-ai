/**
 * PR-S5 — واجهة صندوق الزبائن (فحوص ثابتة على المصدر، بلا متصفح).
 *
 * تثبت (تفشل على الكود القديم):
 *  - قسم أول «أسئلة تنتظر جوابك» يعرض مسودات الجواب (purpose !== follow_up) بالأحدث أولاً.
 *  - قسم «متابعات» مطوي افتراضياً (لا يُفتح إلا بضغطة).
 *  - زر «رفض الكل في هذا القسم» مع تأكيد (window.confirm) لكل قسم.
 *  - زر التنظيف + زر تشخيص اسم الكاتب (from) موصولان بالـAPI.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const ui = readFileSync(join(REPO_ROOT, 'src/components/agent/CommercialInbox.tsx'), 'utf8');
const api = readFileSync(join(REPO_ROOT, 'src/services/api.ts'), 'utf8');

group('1) قسم «أسئلة تنتظر جوابك» (جواب على سؤال) بالأحدث أولاً');
check('العنوان موجود', ui.includes('أسئلة تنتظر جوابك'));
check('يُقسَّم على purpose !== follow_up', ui.includes("d.purpose !== 'follow_up'"));
check('ترتيب تنازلي بالتاريخ (الأحدث أولاً)', ui.includes('Date.parse(b.createdAt) - Date.parse(a.createdAt)'));
check('قسم المتابعات يفصل purpose === follow_up', ui.includes("d.purpose === 'follow_up'"));

group('2) قسم «متابعات» مطوي افتراضياً');
check('حالة الطيّ موجودة', ui.includes('followUpsOpen') && ui.includes('setFollowUpsOpen'));
check('القيمة الابتدائية false (مطوي)', /useState\(false\)/.test(ui) && ui.includes('const [followUpsOpen, setFollowUpsOpen] = useState(false)'));
check('يُفتح بالضغط فقط (toggle)', ui.includes('setFollowUpsOpen((v) => !v)'));
check('عنوان قسم المتابعات موجود', ui.includes('متابعات (24/72)'));

group('3) زر «رفض الكل في هذا القسم» مع تأكيد');
check('الزر موجود في القسمين', (ui.match(/رفض الكل في هذا القسم/g) || []).length >= 2);
check('يستدعي rejectAllInSection', ui.includes('rejectAllInSection(answerDrafts') && ui.includes('rejectAllInSection(followUpDrafts'));
check('تأكيد قبل التنفيذ (window.confirm)', ui.includes('window.confirm('));
check('الرفض لا يرسل (reject فقط)', ui.includes("decideCommercialDraft(d.id, 'reject')"));

group('4) زر التنظيف + تشخيص اسم الكاتب');
check('زر التنظيف يستدعي runCleanup', ui.includes('runCleanup') && ui.includes('تنظيف المسودات المخالفة'));
check('يستدعي apiService.cleanupCommercialDrafts', ui.includes('apiService.cleanupCommercialDrafts'));
check('زر تشخيص الاسم موجود', ui.includes('تشخيص اسم الكاتب (from)'));
check('يستدعي apiService.getCommercialAuthorNameDiagnosis', ui.includes('apiService.getCommercialAuthorNameDiagnosis'));
check('يعرض OWNER SESSION REQUIRED عند الحجب', ui.includes('OWNER SESSION REQUIRED'));

group('5) واجهة الـAPI موصولة بالمسارات الصحيحة');
check('cleanupCommercialDrafts → /api/commercial/cleanup', api.includes("'/api/commercial/cleanup'"));
check('getCommercialAuthorNameDiagnosis → /api/commercial/author-name-diagnosis', api.includes("'/api/commercial/author-name-diagnosis'"));
check('يُرسل رمز التفويض (getAuthHeaders)', (api.match(/getAuthHeaders\(\)/g) || []).length >= 10);

console.log(`\nPR-S5 inbox UI: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1); }
