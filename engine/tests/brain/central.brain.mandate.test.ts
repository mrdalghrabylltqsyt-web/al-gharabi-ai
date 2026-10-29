/**
 * MANDATE — تفويض العقل المركزي: يعرف كل مهامه (تفكير/استشارات/تطوير/إدارة) ويرتّب أولوياته
 * من أرقام حقيقية، والمستشارون الخمسة تحته بلا قرار ولا تنفيذ.
 *
 * لا شبكة ولا أسرار ولا AI.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  CENTRAL_BRAIN_DUTIES, MANDATE_PILLAR_LABELS_AR, buildCentralBrainMandate, derivePriorities,
} from '../../brain/mandate';
import { ADVISOR_AGENT_IDS } from '../../brain/consolidation';
import { PROBE_ROUTES } from '../../ops/engineerProactive';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed += 1; else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(t: string) { console.log(`\n▸ ${t}`); }
const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

group('1) أربعة محاور تغطي كل مهام العقل');
const pillars = Object.keys(MANDATE_PILLAR_LABELS_AR);
check('أربعة محاور بالضبط', pillars.length === 4, pillars.join(','));
for (const p of pillars) check(`محور «${p}» له مهام`, CENTRAL_BRAIN_DUTIES.some((d) => d.pillar === p));
check('معرّفات المهام فريدة', new Set(CENTRAL_BRAIN_DUTIES.map((d) => d.id)).size === CENTRAL_BRAIN_DUTIES.length);
for (const d of CENTRAL_BRAIN_DUTIES) {
  for (const m of d.modules) check(`ملف المهمة موجود: ${d.id} ← ${m}`, fs.existsSync(path.join(ROOT, m)));
}

group('2) سلطة قرار واحدة + خمسة مستشارين');
const deciders = CENTRAL_BRAIN_DUTIES.filter((d) => d.authority === 'decides');
check('كل مهام القرار في التفكير/التنسيق فقط', deciders.every((d) => d.id === 'think:decision' || d.id === 'consult:coordination'));
const advisors = CENTRAL_BRAIN_DUTIES.filter((d) => d.id.startsWith('advisor:'));
check('خمسة مستشارين في التفويض', advisors.length === 5 && ADVISOR_AGENT_IDS.length === 5);
check('المستشارون يوصون فقط', advisors.every((d) => d.authority === 'advises'));
check('المنسّق ليس مستشاراً', !advisors.some((d) => d.id === 'advisor:orchestrator'));

group('3) التطوير والإدارة لا ينفّذان خارج البوابة');
check('مهام التطوير ترفع للعقل', CENTRAL_BRAIN_DUTIES.filter((d) => d.pillar === 'development').every((d) => d.authority === 'reports_to_brain'));
check('الموظف والنشر الموحّد عبر البوابة فقط', ['manage:employee', 'manage:publishing'].every((id) => CENTRAL_BRAIN_DUTIES.find((d) => d.id === id)?.authority === 'executes_via_gate'));

group('4) الأولويات من أرقام حقيقية فقط');
const empty = buildCentralBrainMandate();
check('بلا أرقام: لا أولويات مخترعة', empty.priorities.length === 0);
check('بلا أرقام: المصادر معلنة غير متاحة', !empty.live.engineer.available && !empty.live.employee.available && !empty.live.publishing.available && empty.live.pendingApprovals === null);
check('العقل لا ينفّذ ولا يستهلك حصة AI', empty.executesExternalActions === false && empty.consumesAiQuota === false);
const pr = derivePriorities({
  engineer: { open: 3, critical: 1, forDeveloper: 1, forOwner: 1, forEngineer: 1, regressions: 0 },
  employee: { verdict: 'partial', verdictText: 'يعمل جزئياً', score: 60, blockers: [] },
  publishing: { readyNow: [], connectRequired: ['instagram'], externalSetupRequired: ['tiktok'] },
  pendingApprovals: 4,
});
check('العطل الحرج للمهندس أولاً', pr[0]?.severity === 'critical');
check('الحرج قبل التحذير قبل المعلومة', pr.every((x, i) => i === 0 || ['critical', 'warning', 'info'].indexOf(pr[i - 1].severity) <= ['critical', 'warning', 'info'].indexOf(x.severity)));
check('عطل المالك يُسند للمالك', pr.some((x) => x.actor === 'owner' && x.pillar === 'development'));
check('عيب الكود يُسند لمهندس الكود', pr.some((x) => x.actor === 'developer'));
check('لا منصة جاهزة = حرج للنشر الموحّد', pr.some((x) => x.pillar === 'management' && x.severity === 'critical' && /نشر الموحّد/.test(x.title)));
check('الردود المعلّقة تظهر برقمها', pr.some((x) => x.title.startsWith('4 رد')));
check('الترتيب متسلسل', pr.every((x, i) => x.rank === i + 1));
const healthy = derivePriorities({
  engineer: { open: 0, critical: 0, forDeveloper: 0, forOwner: 0, forEngineer: 0, regressions: 0 },
  employee: { verdict: 'selling', verdictText: 'جاهز', score: 100, blockers: [] },
  publishing: { readyNow: ['facebook', 'youtube'], connectRequired: [], externalSetupRequired: [] },
  pendingApprovals: 0,
});
check('حالة سليمة: لا أولويات', healthy.length === 0);

group('5) المسار موصول بالخادم ويُفحص استباقياً');
const server = read('server.ts');
check('المسار مسجّل للمالك', server.includes('app.get("/api/agent/brain/mandate", authenticateToken, requireOwner'));
check('يقرأ سجل الأعطال الحقيقي', /ledgerSummary\(defectLedger\)[\s\S]{0,400}salesReadinessReport\(\)/.test(server));
check('يقرأ جاهزية النشر الموحّد', server.includes('buildPublishReadinessReport().summary'));
check('المهندس يفحص شاشة التفويض', PROBE_ROUTES.some((r) => r.path === '/api/agent/brain/mandate'));

if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`PASSED: ${passed} central brain mandate checks`);
