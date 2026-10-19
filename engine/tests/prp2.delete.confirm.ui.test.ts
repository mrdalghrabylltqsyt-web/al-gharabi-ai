/**
 * PR-P2 — تأكيد قبل حذف المنتج من المعرض (واجهة فقط، بلا تغيير خادم/قاعدة).
 *
 * يثبت من المصدر الفعلي:
 *  1) زر الحذف لم يعد يستدعي deleteProduct مباشرةً — بل يفتح نافذة تأكيد.
 *  2) النافذة تعرض اسم المنتج والسعر مع زري «نعم» و«لا».
 *  3) «لا» تُغلق بلا أي حذف (لا تستدعي deleteProduct).
 *  4) «نعم» فقط ينفّذ الحذف الحالي (deleteProduct(id)).
 *  5) أثناء الحذف يُعطَّل الزرّان (منع الضغط المكرر).
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
const VIEW = readFileSync(join(REPO_ROOT, 'src/components/database/ShowroomDatabaseView.tsx'), 'utf8');

group('1) زر الحذف يفتح نافذة تأكيد لا يحذف مباشرة');
check('لا استدعاء مباشر deleteProduct(prod.id) في زر الحذف',
  !VIEW.includes('onClick={() => deleteProduct(prod.id)}'),
  'الزر يجب ألا يستدعي الحذف مباشرةً');
check('الزر يفتح التأكيد بالمنتج المعلّق',
  VIEW.includes('onClick={() => setProductPendingDelete(prod)}'),
  'onClick يجب أن يضبط المنتج المعلّق للحذف');
check('حالة المنتج المعلّق للحذف معرّفة',
  VIEW.includes('const [productPendingDelete, setProductPendingDelete] = useState<ShowroomProduct | null>(null)'),
  'state productPendingDelete مطلوب');

group('2) النافذة تعرض الاسم والسعر + زري نعم/لا');
check('نص السؤال صريح', VIEW.includes('هل أنت متأكد من حذف هذا المنتج؟'));
check('تعرض اسم المنتج', VIEW.includes('{productPendingDelete.name}'));
check('تعرض السعر', VIEW.includes('سعر الكاش:') && VIEW.includes('productPendingDelete.cashPrice'));
check('زر «نعم» موجود', VIEW.includes('>نعم<') || VIEW.includes("'نعم'"));
check('زر «لا» موجود', /[\s>]لا\s*<\/button>/.test(VIEW) || VIEW.includes("'لا'"));
check('نافذة حوارية صحيحة الوصول', VIEW.includes('role="dialog"') && VIEW.includes('aria-modal="true"'));

group('3) «لا» تُغلق بلا حذف');
check('زر «لا» يمسح الحالة فقط',
  /onClick=\{\(\) => setProductPendingDelete\(null\)\}/.test(VIEW),
  '«لا» يجب أن يضبط null بلا استدعاء deleteProduct');

group('4) «نعم» ينفّذ الحذف الحالي فقط');
check('handler التأكيد يستدعي deleteProduct بالمعرّف',
  VIEW.includes('deleteProduct(productPendingDelete.id)'),
  'الحذف الفعلي عبر المسار الحالي');
check('handler التأكيد محروس بعدم التكرار',
  VIEW.includes('if (!productPendingDelete || isDeletingProduct) return;'));

group('5) تعطيل أثناء الحذف (منع الضغط المكرر)');
check('حالة الحذف الجاري معرّفة',
  VIEW.includes('const [isDeletingProduct, setIsDeletingProduct] = useState<boolean>(false)'));
check('زر «نعم» يُعطَّل أثناء الحذف',
  /onClick=\{confirmDeleteProduct\}[\s\S]{0,200}disabled=\{isDeletingProduct\}/.test(VIEW));
check('زر «لا» يُعطَّل أثناء الحذف',
  /setProductPendingDelete\(null\)\}\s*disabled=\{isDeletingProduct\}/.test(VIEW));

group('6) بلا تغيير في الخادم (واجهة فقط)');
check('لا استدعاء fetch/api مباشر جديد في المكوّن',
  !VIEW.includes('fetch(') && !VIEW.includes('apiService.delete'),
  'الحذف يبقى عبر context deleteProduct الحالي');

console.log('\n' + '='.repeat(56));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} PR-P2 delete-confirm UI checks`);
