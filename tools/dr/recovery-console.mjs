#!/usr/bin/env node
/**
 * الغرابي AI — **واجهة الاستعادة المستقلة** (Standalone Recovery Console).
 *
 * لماذا CLI مستقل وليس زراً داخل الغرابي:
 *   إذا انهار المشروع بالكامل (Render متوقف، dist مفقود، لا جلسة مالك)، فلا يبقى
 *   أي زر داخل التطبيق. هذه الواجهة تعمل بـNode مباشرة من حزمة المصدر المستعادة أو
 *   من نسخة git، وتصل إلى Google Drive بـ:
 *     Google Drive + Recovery Point + DR_RECOVERY_VAULT_KEY (عند المالك).
 *
 * الاستخدام (بلا تشغيل الغرابي):
 *   node tools/dr/recovery-console.mjs --list
 *   node tools/dr/recovery-console.mjs --point rp-005 --verify
 *   node tools/dr/recovery-console.mjs --point rp-005 --target ./restored --restore
 *   node tools/dr/recovery-console.mjs --point rp-005 --target ./restored --restore \
 *        --apply-db --target-db "postgres://…/restore_db"
 *
 * الأمان:
 *   - لا تُطبع أي قيمة سرّية إطلاقاً (أسماء/أعداد/حالات فقط).
 *   - لا يُكتب المفتاح في أي ملف ولا في السجل.
 *   - لا يُعدَّل أي Recovery Point (قراءة فقط).
 *   - تُرفض قاعدة الإنتاج في أي استعادة.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  buildRecoveryClient,
  buildRecoveryStore,
  inspectRecoveryReadiness,
  listRecoveryPoints,
  inspectTargetEnvironment,
  runStandaloneRestore,
} from './standalone-recovery.mjs';

function parseArgs(argv) {
  const args = { point: null, list: false, verify: false, restore: false, target: null, applyDb: false, targetDb: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--list') args.list = true;
    else if (a === '--verify') args.verify = true;
    else if (a === '--restore') args.restore = true;
    else if (a === '--apply-db') args.applyDb = true;
    else if (a === '--json') args.json = true;
    else if (a === '--point') args.point = argv[++i] || null;
    else if (a === '--target') args.target = argv[++i] || null;
    else if (a === '--target-db') args.targetDb = argv[++i] || null;
  }
  return args;
}

function print(obj, json) {
  if (json || (!obj.title && !obj.lines)) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); return; }
  // عرض عربي بسيط بلا أي سرّ.
  if (obj.title) console.log(`\n${obj.title}`);
  for (const line of obj.lines || []) console.log(line);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;
  const readiness = await inspectRecoveryReadiness(env);
  if (!readiness.drive.configured) {
    print({ state: 'blocked', reason: 'drive_not_configured', readiness }, args.json);
    process.exit(2);
  }
  const client = await buildRecoveryClient(env);
  if (!client || client.ok === false) {
    print({ state: 'blocked', reason: (client && client.code) || 'drive_client_unavailable', readiness }, args.json);
    process.exit(2);
  }
  // هوية المجلدات المحفوظة (إن وُجدت) عبر متغيّر اختياري، وإلا تُكتشف بالاسم تحت drive.file.
  let storedIdentity = null;
  try { if (env.DR_FOLDER_IDENTITY) storedIdentity = JSON.parse(env.DR_FOLDER_IDENTITY); } catch { /* تجاهل */ }
  const store = buildRecoveryStore(client, { storedIdentity, readOnlyStructure: true });

  // الخطوة 1: عرض نقاط الاستعادة.
  if (args.list || (!args.point && !args.restore)) {
    const listed = await listRecoveryPoints(store);
    if (!listed.ok) { print({ state: 'failed', reason: listed.code, readiness }, args.json); process.exit(1); }
    const lines = listed.points.map((p) => {
      const v = p.restorable ? 'سليمة' : 'ناقصة';
      return `• ${p.id} | ${p.createdAt || '—'} | commit ${(p.commit || '—').slice(0, 10)} | ملفات ${p.fileCount ?? '—'} | DB مشفّرة: ${p.database.encrypted ? 'نعم' : '—'} | أسرار: ${p.secrets.count ?? '—'} | ${v}`;
    });
    print({ title: `نقاط الاستعادة (${listed.points.length}):`, lines, readiness }, args.json);
    return;
  }

  // الخطوة 2: حلّ النقطة المطلوبة.
  const listed = await listRecoveryPoints(store);
  const point = (listed.points || []).find((p) => p.id === args.point) || null;
  if (!point) { print({ state: 'failed', reason: 'recovery_point_not_found', point: args.point }, args.json); process.exit(1); }

  // الخطوة 3: تحقق فقط.
  if (args.verify && !args.restore) {
    print({ title: `تحقق ${point.id}:`, lines: [`قابلة للاستعادة: ${point.restorable ? 'نعم' : 'لا'}`, `المشاكل: ${(point.verification.problems || []).join(', ') || 'لا شيء'}`], point }, args.json);
    process.exit(point.restorable ? 0 : 1);
  }

  // الخطوة 4: استعادة كاملة.
  const targetDir = args.target ? path.resolve(args.target) : null;
  if (targetDir) fs.mkdirSync(targetDir, { recursive: true });
  const target = inspectTargetEnvironment(env, { isolatedDatabaseUrl: args.targetDb || env.DR_RECOVERY_TEST_DATABASE_URL || null });
  const report = await runStandaloneRestore({
    store,
    point: { id: point.id, folderId: point.folderId, manifest: point.manifest },
    env,
    targetDir,
    isolatedDatabaseUrl: args.targetDb || env.DR_RECOVERY_TEST_DATABASE_URL || null,
    applyDatabase: args.applyDb,
  });
  print({
    title: report.ok ? `✅ اكتملت استعادة ${point.id}` : `⛔ توقفت الاستعادة عند المرحلة: ${report.failureStage || report.stage}`,
    lines: [
      `المراحل: ${report.stages.join(' → ')}`,
      `المصدر: ${report.extractedFileCount ?? '—'} ملف`,
      `الأسرار (أسماء فقط): ${report.secretsCount}`,
      `الخزنة: نسخة ${report.vaultVersion ?? '—'} (${report.vaultRecordCount ?? '—'} سجل)`,
      `قاعدة الهدف جاهزة: ${target.databaseReady ? 'نعم' : 'لا'}`,
      `المتطلبات الخارجية: ${report.externalRequirements.join(' / ')}`,
      `المشاكل: ${report.problems.join(', ') || 'لا شيء'}`,
      'ملاحظة: إعادة تشغيل الإنتاج خطوة خارجية (Render + متغيّرات البيئة).',
    ],
    report,
  }, args.json);
  process.exit(report.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(JSON.stringify({ state: 'failed', reason: 'unexpected', message: String(err?.message || err) }));
    process.exit(1);
  });
}

export { parseArgs };
