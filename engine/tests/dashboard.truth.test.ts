/**
 * تدقيق شاشات المالك حرفاً حرفاً (2026-10-27) — ما رُصد على لقطات الهاتف:
 *   1) «سجلات أداء للتعلّم 0» رغم 64 سجلاً مقاساً (الواجهة تقرأ حقلاً غير موجود).
 *   2) عمود «مؤشرات متاحة —» لكل المنصات (حقل غير موجود).
 *   3) جلسات فيسبوك موسومة «youtube_event».
 *   4) «دورات إدراكية 2» — الطبقة الإدراكية تعمل ليوتيوب وحده رغم 166 جلسة.
 *   5) «استفسارات التقسيط 0» — تعدّ المحادثات القديمة لا استفسارات المنصات الحقيقية.
 *   6) متابعو المنصات غير المقيسة «0» (صفر مختلق بدل «—»).
 *   7) سناب شات «النشر: مراجعة» رغم عدم وجود كود نشر.
 *   8) تنبيه تيليغرام: التعليمة تطلب ضبط Render يدوياً، والرمز لا يصل إن لم يكن webhook مسجّلاً.
 *   9) «منشورات مسجّلة 17» مقابل «حالة النشر 16» بلا تفسير.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sessionSourceLabel } from '../../src/utils/sessionSource';
import { capabilityRow } from '../brain/strategy/capabilityMatrix';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(name + (info ? ` — ${info}` : '')); };

const server = read('server.ts');
const brainUi = read('src/components/agent/CentralBrainView.tsx');
const team = read('src/components/agent/AgentTeamCenter.tsx');
const dash = read('src/components/dashboard/DashboardView.tsx');
const cc = read('src/components/dashboard/CommandCenterView.tsx');
const ready = read('engine/ops/salesReadiness.ts');
const readyUi = read('src/components/dashboard/SalesReadinessPanel.tsx');
const pairUi = read('src/components/system/OwnerTelegramPair.tsx');
const tg = read('engine/social/telegram.ts');

// 1–2) العقل المركزي
check('★ «سجلات أداء للتعلّم» = مجموع عيّنات المنصات الحقيقية (لا حقل غير موجود)', brainUi.includes('const totalSamples: number = byPlatform.reduce(') && brainUi.includes('value={totalSamples}') && !brainUi.includes('learning?.totalSamples'));
check('★ «مؤشرات متاحة» من عيّنة التعلم نفسها', brainUi.includes('{metricsOf(p.platform)}') && !brainUi.includes('p.availableMetrics.join'));

// 3) مصدر الجلسات
check('★ أحداث فيسبوك/إنستغرام/ثريدز/تيليغرام = platform_event (يوتيوب يبقى youtube_event)', (server.match(/"platform_event"/g) || []).length === 3 && server.includes("runTeamSessionNow('platform_event', 'تحليل تعليق Threads") && /runTeamSessionNow\(\s*"youtube_event",\s*`تحليل تعليق YouTube/.test(server));
check('★ الجلسات القديمة تُعرض بمنصتها الحقيقية من نص مهمتها', sessionSourceLabel({ trigger: 'youtube_event', task: 'تحليل تعليق Facebook جديد' }) === 'حدث فيسبوك' && sessionSourceLabel({ trigger: 'youtube_event', task: 'تحليل تعليق YouTube جديد' }) === 'حدث يوتيوب' && sessionSourceLabel({ trigger: 'platform_event', task: 'تحليل رسالة Telegram جديدة' }) === 'حدث تيليغرام' && sessionSourceLabel({ trigger: 'owner_request', task: 'x' }) === 'طلب المالك');
check('الواجهة تستعمل التسمية العربية لا المعرّف الخام', team.includes('{sessionSourceLabel(s)}') && !team.includes('{s.trigger}</span>'));

// 4) الإدراك لكل المنصات
check('★ الطبقة الإدراكية تعمل بعد جلسة كل منصة (4 مواضع + يوتيوب)', (server.match(/cognitionAfterTeam\(teamRes, \{/g) || []).length === 4 && server.includes('runCognitiveCycleNow({\n              session: teamResult.session,'));
check('★ الإدراك لا يفترض تفويضاً خارجياً (الإرسال خلف بوابة الموافقة)', server.includes('      externalApproved: false,\n    });\n  } catch { /* الدورة الإدراكية لا تُسقط دورة المراقبة */ }'));

// 5–6) الرئيسية
check('★ «استفسارات التقسيط» من استفسارات المنصات الحقيقية (بلا ردود المعرض)', dash.includes('const realInquiries = platforms.reduce(') && dash.includes('{realInquiries + conversations.length}') && server.includes('inquiries: customerComments().filter((c) => c?.platform === platform && (c?.classification?.isBusinessInquiry === true'));
check('★ المتابعون «—» حين لا قياس (لا صفر مختلق)', dash.includes("typeof p.measured?.followers === 'number' ? p.measured.followers.toLocaleString() : '—'") && dash.includes('{fmtFollowers(p)}'));
check('مجموع المتابعين من الأرقام المقيسة فقط', dash.includes("acc + (typeof p.measured?.followers === 'number' ? p.measured.followers : 0)"));
check('★ «منشورات مسجّلة» تُفصَّل (منشور/مجدول · مسودة/مراجعة)', cc.includes('data-posts-breakdown'));

// 7) مصفوفة القدرات
check('★ سناب شات بلا كود نشر = النشر غير متاح (لا «مراجعة»)', capabilityRow('snapchat').states.publish === 'NOT_AVAILABLE');
check('تيك توك يبقى «مراجعة» للنشر (تدقيق تيك توك مطلوب فعلاً)', capabilityRow('tiktok').states.publish === 'REQUIRES_REVIEW');

// 8) تيليغرام بنقرة
check('★ التعليمة على الرئيسية: نقرة واحدة لا إعدادات Render', ready.includes('اضغط «اربط هاتفي بنقرة واحدة» هنا') && !ready.includes('userinfobot'));
check('★ الزر داخل بطاقة «جاهزية البيع» نفسها', readyUi.includes("{it.id === 'owner-telegram' && <OwnerTelegramPair compact"));
check('★ النقرة تفتح البوت فوراً (نافذة ضمن النقرة فلا يحجبها الهاتف)', pairUi.includes("win = window.open('', '_blank')") && pairUi.includes('win.location.href = r.deepLink'));
check('★ بلا webhook: الخادم يلتقط الرمز من رسائل البوت كل 3 ث حتى انتهاء الرمز', server.includes('if (!webhook.ready) startOwnerPairingPoller();') && server.includes('const r = await client.peekUpdates(100);') && server.includes('}, 3000);'));
check('★ القراءة بلا تأكيد: لا offset ⇒ لا يُستهلك أي تحديث لدى Telegram', tg.includes('async peekUpdates(') && !/peekUpdates[\s\S]{0,700}offset=/.test(tg));
check('المُلتقِط يتوقف عند الربط أو انتهاء الرمز', server.includes('if (!p || Date.now() > p.expiresAt || !client) { if (ownerPairingPoller) clearInterval(ownerPairingPoller);') && server.includes('if (outcome === "paired") { if (ownerPairingPoller) clearInterval(ownerPairingPoller);'));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} dashboard-truth checks`);
