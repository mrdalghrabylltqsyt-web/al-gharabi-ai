/**
 * اختبار انحدار Phase-2 — F-01 (CRITICAL): منع انتحال قرار الاعتماد/الجدولة على المحتوى.
 *
 * يثبت:
 *  1) الخادم: أي دور غير المالك لا يستطيع تعيين approved/scheduled/published عبر
 *     PATCH /api/workspace/content/:id (403/409 بأكواد صريحة)، ولا عبر POST الإنشاء.
 *  2) الواجهة: أزرار الاعتماد/الجدولة/النشر مخفية عن غير المالك (isOwner)، وأزرار
 *     إرسال المراجعة/التعديل تُستخدم ضمن isContent.
 *
 * يفشل على الكود القديم (قبل سياسة canSetContentStatusByRole وقبل تقييد الواجهة).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canSetContentStatusByRole, canEditContent } from '../social/contentStatusPolicy';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();

function main(): void {
  group('1) سياسة الحالة حسب الدور (مصدر واحد)');
  // غير المالك لا يستطيع تعيين الحالات المميّزة.
  for (const role of ['manager', 'staff', 'content_creator']) {
    const appr = canSetContentStatusByRole(role, 'approved');
    const sch = canSetContentStatusByRole(role, 'scheduled');
    const pub = canSetContentStatusByRole(role, 'published');
    check(`${role}: approved مرفوض`, appr.allowed === false && appr.code === 'OWNER_APPROVAL_ENDPOINT_REQUIRED');
    check(`${role}: scheduled مرفوض`, sch.allowed === false && sch.code === 'OWNER_APPROVAL_ENDPOINT_REQUIRED');
    check(`${role}: published مرفوض`, pub.allowed === false && pub.code === 'PUBLISHED_REQUIRES_PROVIDER_PROOF');
    // الحالات غير المميّزة مسموحة للمحرّرين.
    check(`${role}: review مسموح`, canSetContentStatusByRole(role, 'review').allowed === true);
    check(`${role}: edited مسموح`, canSetContentStatusByRole(role, 'edited').allowed === true);
  }
  // المالك أيضاً لا يعيّن approved/scheduled عبر PATCH (يُعيَّنان عبر مسارهما الرسمي).
  check('owner: approved مرفوض عبر PATCH (المسار الرسمي)', canSetContentStatusByRole('owner', 'approved').allowed === false);
  // دور غير محرّر لا يعدّل المحتوى إطلاقاً.
  check('customer_support: لا يعدّل المحتوى', canEditContent('customer_support') === false);
  check('content_creator: يعدّل المحتوى', canEditContent('content_creator') === true);

  group('2) الخادم يفرض السياسة في PATCH والإنشاء');
  const src = readFileSync(join(REPO_ROOT, 'server.ts'), 'utf8');
  check('PATCH يستخدم canSetContentStatusByRole', src.includes('canSetContentStatusByRole(user.role'));
  check('الإنشاء يستخدم canSetContentStatusByRole', (src.match(/canSetContentStatusByRole\(/g) || []).length >= 2);
  check('مسارات الاعتماد/الجدولة/النشر الرسمية محصورة بالمالك', 
    /workspace\/content\/:id\/approve", requireOwner/.test(src) &&
    /workspace\/content\/:id\/schedule", requireOwner/.test(src) &&
    /workspace\/content\/:id\/publish", requireOwner/.test(src));

  group('3) الواجهة: أزرار الاعتماد/الجدولة/النشر مخفية عن غير المالك');
  const ui = readFileSync(join(REPO_ROOT, 'src/components/approval/ApprovalWorkflowView.tsx'), 'utf8');
  check('isOwner معرّف', ui.includes("const isOwner = currentUser.role === 'owner'"));
  check('زر الاعتماد محصور بـ isOwner', ui.includes("/* approve owner-only */}{isOwner && ("));
  check('زر الرفض/الإرجاع محصور بـ isOwner (يطابق /reject المحمي)', /رفض\/إرجاع للتعديل owner-only[\s\S]{0,220}\{isOwner && \(/.test(ui));
  check('زر الجدولة محصور بـ isOwner', /post\.status === 'approved' && isOwner && \(/.test(ui));
  check('زر النشر المبكر محصور بـ isOwner', /post\.status === 'scheduled' && isOwner && \(/.test(ui));
  check('isContent محسوب ومستخدم', ui.includes('const isContent =') && ui.includes("post.status === 'draft' && isContent"));
  check('isManager محسوب (مستخدم في إخفاء/إظهار العناصر)', ui.includes('const isManager ='));

  group('4) الواجهة توجّه الاعتماد/الجدولة للمسارات الرسمية (لا PATCH)');
  const ctx = readFileSync(join(REPO_ROOT, 'src/context/AppContext.tsx'), 'utf8');
  check('approve عبر المسار الرسمي', ctx.includes('apiService.approveWorkspaceContent(postId'));
  check('schedule عبر المسار الرسمي', ctx.includes('apiService.scheduleWorkspaceContent(postId'));

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.log(`FAILED: ${passed} passed, ${failures.length} failed`);
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} Phase-2 F-01 approval-gate checks`);
}

main();
