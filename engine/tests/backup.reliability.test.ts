/**
 * موثوقية النسخة الاحتياطية — انحدار لتوقّف 51 ساعة بصمت (بعد rp-052، 2026-10-23).
 *
 * يثبت (منطق صافٍ، بلا شبكة):
 *  1) تأجيل ضغط الاستهلاك له سقف: بعد 24 ساعة من آخر نجاح تُنفَّذ النسخة رغم الضغط.
 *  2) بعد الفشل إعادة محاولة خلال 30 دقيقة (لا 6 ساعات).
 *  3) الردود المبكرة بلا `state` (NOT_AUTHORIZED...) تُطبَّع إلى فشل صريح مع الكود.
 *  4) حداثة النسخة: ok < 12 س، warning 12–24 س، critical > 24 س أو غير معروفة.
 *  5) جاهزية البيع تعرض بند النسخة (عائق عند التوقف، وحل «إعادة تفويض Drive» عند خطأ تفويض).
 *  6) نوع تنبيه المالك «backup_stale» مقبول في الطابور ويصل Telegram برابط النسخ السحابية.
 * يفشل على الكود القديم.
 */
import {
  decideAutoBackupRun, normalizeBackupOutcome, parseLastSuccessAtMs, backupFreshness, isSuccessfulBackupResult,
  AUTO_BACKUP_DEFAULT_INTERVAL_MS, AUTO_BACKUP_FAILURE_RETRY_MS, AUTO_BACKUP_MAX_DEFER_MS,
} from '../dr/autoBackup';
import { buildSalesReadiness } from '../ops/salesReadiness';
import { normalizeOwnerAlertState, defaultOwnerAlertState, enqueueOwnerAlert, OWNER_ALERT_KIND_LABELS_AR } from '../notifications/ownerAlerts';
import { buildOwnerTelegramMessage } from '../notifications/ownerTelegram';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(t: string): void { console.log(`\n▸ ${t}`); }

const H = 3_600_000;
const NOW = Date.parse('2026-10-25T06:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const IV = AUTO_BACKUP_DEFAULT_INTERVAL_MS;

group('1) سقف تأجيل ضغط الاستهلاك');
{
  const recentOk = { lastRunAt: iso(NOW - 7 * H), lastRunResult: 'backed_up', lastSuccessAt: iso(NOW - 7 * H) };
  check('مستحقة + ضغط + آخر نجاح قبل 7 س ⇒ تأجيل', JSON.stringify(decideAutoBackupRun({ state: recentOk, nowMs: NOW, intervalMs: IV, trigger: 'scheduled', pressureDefer: true })) === JSON.stringify({ run: false, reason: 'pressure_defer' }));
  // نفس سيناريو الإنتاج: آخر نجاح rp-052 قبل 51 ساعة، والضغط مستمر.
  const prod = { lastRunAt: iso(NOW - 51 * H), lastRunResult: 'backed_up', lastSuccessAt: iso(NOW - 51 * H), lastSkippedReason: 'pressure_defer' };
  const d = decideAutoBackupRun({ state: prod, nowMs: NOW, intervalMs: IV, trigger: 'scheduled', pressureDefer: true });
  check('★ آخر نجاح قبل 51 ساعة + ضغط ⇒ تُنفَّذ (forced_stale)', d.run === true && d.reason === 'forced_stale', JSON.stringify(d));
  check('★ السقف 24 ساعة بالضبط', decideAutoBackupRun({ state: { ...prod, lastSuccessAt: iso(NOW - AUTO_BACKUP_MAX_DEFER_MS) }, nowMs: NOW, intervalMs: IV, trigger: 'scheduled', pressureDefer: true }).reason === 'forced_stale');
  check('لا نجاح معروف + ضغط ⇒ تُنفَّذ', decideAutoBackupRun({ state: { lastRunAt: iso(NOW - 7 * H) }, nowMs: NOW, intervalMs: IV, trigger: 'scheduled', pressureDefer: true }).run === true);
  check('الإقلاع لا يُؤجَّل بالضغط', decideAutoBackupRun({ state: recentOk, nowMs: NOW, intervalMs: IV, trigger: 'boot', pressureDefer: true }).run === true);
  check('اليدوي لا يُؤجَّل بالضغط', decideAutoBackupRun({ state: recentOk, nowMs: NOW, intervalMs: IV, trigger: 'manual', pressureDefer: true }).run === true);
  check('غير مستحقة ⇒ not_due حتى مع الضغط', decideAutoBackupRun({ state: { ...recentOk, lastRunAt: iso(NOW - H) }, nowMs: NOW, intervalMs: IV, trigger: 'scheduled', pressureDefer: true }).reason === 'not_due');
}

group('2) إعادة المحاولة بعد الفشل');
{
  const failed = { lastRunAt: iso(NOW - 31 * 60_000), lastRunResult: 'failed', lastSuccessAt: iso(NOW - 8 * H), lastError: 'NOT_AUTHORIZED' };
  const d = decideAutoBackupRun({ state: failed, nowMs: NOW, intervalMs: IV, trigger: 'scheduled', pressureDefer: false });
  check('★ فشل قبل 31 دقيقة ⇒ إعادة محاولة الآن', d.run === true && d.reason === 'retry_after_failure', JSON.stringify(d));
  check('فشل قبل 10 دقائق ⇒ ليس بعد', decideAutoBackupRun({ state: { ...failed, lastRunAt: iso(NOW - 10 * 60_000) }, nowMs: NOW, intervalMs: IV, trigger: 'scheduled', pressureDefer: false }).run === false);
  check('مهلة إعادة المحاولة 30 دقيقة', AUTO_BACKUP_FAILURE_RETRY_MS === 30 * 60_000);
  check('نجاح قبل 31 دقيقة ⇒ لا تشغيل (6 ساعات)', decideAutoBackupRun({ state: { lastRunAt: iso(NOW - 31 * 60_000), lastRunResult: 'backed_up' }, nowMs: NOW, intervalMs: IV, trigger: 'scheduled', pressureDefer: false }).run === false);
  check('no_change نجاح', isSuccessfulBackupResult('no_change') && isSuccessfulBackupResult('backed_up') && !isSuccessfulBackupResult('failed'));
}

group('3) تطبيع النتائج المبكرة');
{
  const n = normalizeBackupOutcome({ success: false, code: 'NOT_AUTHORIZED', error: 'لا تفويض' });
  check('★ NOT_AUTHORIZED بلا state ⇒ failed مع الكود', n.state === 'failed' && n.reason === 'NOT_AUTHORIZED', JSON.stringify(n));
  check('SOURCE_INCOMPLETE ⇒ failed', normalizeBackupOutcome({ success: false, code: 'SOURCE_INCOMPLETE' }).state === 'failed');
  const ok = normalizeBackupOutcome({ success: true, state: 'backed_up', recoveryPointId: 'rp-053' });
  check('نجاح يبقى نجاحاً مع النقطة', ok.state === 'backed_up' && ok.recoveryPointId === 'rp-053' && ok.reason === null);
  check('فشل بلا كود ⇒ backup_failed', normalizeBackupOutcome({}).reason === 'backup_failed');
}

group('4) حداثة النسخة');
{
  check('lastSuccessAt مقروء', parseLastSuccessAtMs({ lastSuccessAt: iso(NOW - H) }) === NOW - H);
  check('توافق خلفي: lastRunAt عند نجاح بلا lastSuccessAt', parseLastSuccessAtMs({ lastRunAt: iso(NOW - 2 * H), lastRunResult: 'backed_up' }) === NOW - 2 * H);
  check('توافق خلفي: آخر تشغيل فاشل بلا lastSuccessAt ⇒ غير معروف', parseLastSuccessAtMs({ lastRunAt: iso(NOW - 2 * H), lastRunResult: 'failed' }) === null);
  check('ok تحت 12 س', backupFreshness({ lastSuccessAt: iso(NOW - 6 * H) }, NOW).level === 'ok');
  check('warning بين 12 و24', backupFreshness({ lastSuccessAt: iso(NOW - 13 * H) }, NOW).level === 'warning');
  const crit = backupFreshness({ lastSuccessAt: iso(NOW - 51 * H), lastError: 'NOT_AUTHORIZED' }, NOW);
  check('★ critical بعد 51 ساعة مع العمر والخطأ', crit.level === 'critical' && crit.ageHours === 51 && crit.lastError === 'NOT_AUTHORIZED', JSON.stringify(crit));
  check('لا نسخة معروفة ⇒ critical', backupFreshness(null, NOW).level === 'critical');
}

group('5) جاهزية البيع');
{
  const base: any = {
    nowIso: iso(NOW), youtubeOnlyMode: false,
    platforms: [{ id: 'facebook', name: 'Facebook', connected: true, credentialsConfigured: true, realConnector: true }],
    commercialBrainEnabled: true, sendMode: 'approval', ownerAlerts: { enabled: true, emailConfigured: true },
    pendingApprovals: { count: 0, oldestAt: null }, readyJobs: 0, autoExecuteEnabled: false,
    staleMarketing: { unpublished: 0, published: 0 }, geminiConfigured: true,
  };
  const stale = buildSalesReadiness({ ...base, backup: { configured: true, ...backupFreshness({ lastSuccessAt: iso(NOW - 51 * H), lastError: 'NOT_AUTHORIZED' }, NOW) } });
  const it = stale.items.find((i) => i.id === 'backup');
  check('★ نسخة متوقفة 51 س ⇒ عائق', it?.severity === 'blocker' && /51 ساعة/.test(it.title), JSON.stringify(it));
  check('★ خطأ تفويض ⇒ الحل إعادة ربط Google Drive', /ربط Google Drive/.test(it?.action || ''), it?.action);
  const fresh = buildSalesReadiness({ ...base, backup: { configured: true, ...backupFreshness({ lastSuccessAt: iso(NOW - 2 * H) }, NOW) } });
  check('نسخة حديثة ⇒ ok', fresh.items.find((i) => i.id === 'backup')?.severity === 'ok');
  check('النسخة المتوقفة تخفض الدرجة', stale.score < fresh.score, `${stale.score} < ${fresh.score}`);
  const none = buildSalesReadiness({ ...base, backup: { configured: false, level: 'critical', lastSuccessAt: null, ageHours: null, lastError: null, lastSkippedReason: null } });
  check('غير مفعّل ⇒ عائق', none.items.find((i) => i.id === 'backup')?.severity === 'blocker');
}

group('6) تنبيه المالك backup_stale');
{
  check('تسمية عربية للنوع', OWNER_ALERT_KIND_LABELS_AR.backup_stale === 'النسخة الاحتياطية متوقفة');
  const item = { key: 'backup_stale:-:x:critical', kind: 'backup_stale' as const, platform: null, title: 'النسخة الاحتياطية متوقفة', snippet: 'آخر نسخة احتياطية ناجحة منذ 51 ساعة.', at: iso(NOW) };
  const st = enqueueOwnerAlert(defaultOwnerAlertState(), item);
  check('★ يُدرج في الطابور', st.pending.some((p) => p.kind === 'backup_stale'));
  const restored = normalizeOwnerAlertState(JSON.parse(JSON.stringify(st)));
  check('★ يصمد بعد restart (لا يُسقطه التطبيع)', restored.pending.some((p) => p.kind === 'backup_stale'), JSON.stringify(restored.pending));
  const msg = buildOwnerTelegramMessage(item, 'https://app.example');
  check('Telegram: أيقونة ورابط النسخ السحابية', msg.startsWith('💾') && msg.includes('tab=cloud_backup'), msg);
}

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} backup-reliability checks`);
