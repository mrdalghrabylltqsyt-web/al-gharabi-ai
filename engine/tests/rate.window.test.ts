/**
 * اختبار سقف النوافذ المفتاحية (محاولات الدخول/رموز التحقق).
 *
 * يثبت أن الخريطة لا تنمو بلا حدود: عند بلوغ السقف تُسقط المنتهية أولاً ثم الأقدم،
 * وأن دلالات تحديد المعدّل (العدّ داخل النافذة) تبقى كما هي، وأن الخادم يستخدم
 * الدالة المشتركة فعلاً في كلا المسارين.
 *
 * لا يلمس أي مزود ولا سرّ.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enforceRateWindowCap, RATE_WINDOW_MAX_KEYS, RATE_WINDOW_TTL_MS } from '../runtime/rateWindow';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();

function unitTests(): void {
  group('1) وحدة: فرض السقف على خريطة النوافذ');
  const now = 1_700_000_000_000;

  // تحت السقف: لا حذف.
  const small = new Map<string, { startedAt: number }>();
  for (let i = 0; i < 10; i++) small.set(`k${i}`, { startedAt: now });
  enforceRateWindowCap(small, now, 20);
  check('تحت السقف: لا حذف', small.size === 10);

  // فوق السقف بلا منتهية: يُحذف الأقدم (ترتيب الإدراج) حتى السقف.
  const over = new Map<string, { startedAt: number }>();
  for (let i = 0; i < 8; i++) over.set(`k${i}`, { startedAt: now });
  enforceRateWindowCap(over, now, 5);
  check('فوق السقف: الحجم = السقف', over.size === 5, `size=${over.size}`);
  check('فوق السقف: الأقدم أُزيل', !over.has('k0') && !over.has('k1') && !over.has('k2'));
  check('فوق السقف: الأحدث بقي', over.has('k7') && over.has('k3'));

  // المنتهية تُسقط أولاً قبل الأقدم.
  const withStale = new Map<string, { startedAt: number }>();
  withStale.set('old', { startedAt: now - RATE_WINDOW_TTL_MS - 1 });
  for (let i = 0; i < 6; i++) withStale.set(`fresh${i}`, { startedAt: now });
  enforceRateWindowCap(withStale, now, 5);
  check('المنتهية تُسقط أولاً', !withStale.has('old'));
  check('الحجم بعد السقف = 5', withStale.size === 5);

  // الحدّ الدقيق: الحجم = السقف => لا حذف.
  const exact = new Map<string, { startedAt: number }>();
  for (let i = 0; i < 5; i++) exact.set(`k${i}`, { startedAt: now });
  enforceRateWindowCap(exact, now, 5);
  check('الحجم = السقف بالضبط: لا حذف', exact.size === 5);
  check('السقف الافتراضي معقول', RATE_WINDOW_MAX_KEYS === 5000 && RATE_WINDOW_TTL_MS === 15 * 60 * 1000);

  group('2) وحدة: دلالات تحديد المعدّل محفوظة بعد الفرض');
  // نحاكي allowAuthAttempt: 12 مسموحة، الـ13 مرفوضة، ونافذة جديدة بعد TTL.
  const win = new Map<string, { startedAt: number; count: number }>();
  const allow = (key: string, limit: number, t: number): boolean => {
    const item = win.get(key);
    if (!item || t - item.startedAt >= RATE_WINDOW_TTL_MS) { win.set(key, { startedAt: t, count: 1 }); enforceRateWindowCap(win, t); return true; }
    if (item.count >= limit) return false;
    item.count += 1; return true;
  };
  let allowed = 0;
  for (let i = 0; i < 20; i++) if (allow('a@b.com', 12, now)) allowed += 1;
  check('يُسمح 12 محاولة ثم يُحجب', allowed === 12, `allowed=${allowed}`);
  check('بعد TTL تُفتح نافذة جديدة', allow('a@b.com', 12, now + RATE_WINDOW_TTL_MS + 1) === true);
}

function structureTests(): void {
  group('3) بنية: الخادم يستخدم الدالة المشتركة في المسارين');
  const src = readFileSync(join(REPO_ROOT, 'server.ts'), 'utf8');
  check('يستورد enforceRateWindowCap', src.includes('enforceRateWindowCap') && src.includes('from "./engine/runtime/rateWindow"'));
  check('allowAuthAttempt يفرض السقف', /function allowAuthAttempt[\s\S]{0,320}?enforceRateWindowCap\(authAttemptWindow/.test(src));
  check('allowChallengeAttempt يفرض السقف', /function allowChallengeAttempt[\s\S]{0,320}?enforceRateWindowCap\(challengeWindow/.test(src));
  check('التقليم يستخدم الثابت المشترك', src.includes('>= RATE_WINDOW_TTL_MS) challengeWindow.delete') && src.includes('>= RATE_WINDOW_TTL_MS) authAttemptWindow.delete'));
  check('لا يُعاد تعريف enforceRateWindowCap محلياً', !src.includes('function enforceRateWindowCap('));
}

unitTests();
structureTests();
console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} rate-window checks`);
}
