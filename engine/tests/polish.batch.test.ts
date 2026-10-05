/**
 * الدفعة الأخيرة (تحسينات غير حرجة): حرّاس انحدار لكل بند أُصلح.
 *
 * تغطّي:
 * A) إسقاط مقاطع الجمهور في buildRuntimeDecisionContext: حقول مطابقة للنوع الحقيقي
 *    (لا topic/intent مُختلقين يُفرَّغان صامتاً) — اختبار سلوكي حقيقي.
 * B) توحيد كشف الأسرار: SECRET_KEY_RE مشترك واحد + توسيع الأنماط (cookie/session/
 *    credential/token/secret).
 * C) CentralAgentView: agentChat داخل try/setIsLoading(false) داخل finally (لا تعليق).
 * D) server.ts: معالج app.listen('error') لـEADDRINUSE.
 * E) معرّف العميل cust_ صار تجزئة أحادية الاتجاه (لا base64url قابل للعكس).
 * F) App.tsx: مكوّنات ERP القديمة lazy (code splitting) لا استيراداً ثابتاً.
 * G) LoginView: لا بريد مالك حقيقي ظاهر (placeholder عام).
 * H) AGENTS.md: عدد فحوصات final-audit مطابق للفعلي.
 *
 * لا شبكة ولا مزود ولا سرّ: كل الفحوص وحدة/بنية + استدعاء دوال حقيقية.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRuntimeDecisionContext } from '../brain/runtime';
import { SECRET_KEY_RE, SECRET_TEXT_PATTERNS, redactSecretsFromText } from '../runtime/errorSafety';
import { sanitizeOutput } from '../agent/orchestrator';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

// ---------------------------------------------------------------
group('A) إسقاط مقاطع الجمهور يطابق النوع الحقيقي (لا topic/intent مُختلقين)');
{
  const now = new Date().toISOString();
  const input: any = {
    platforms: ['youtube'], now: Date.now(), goalPrimary: 'SALES',
    records: [], replies: [], publishes: [], watcher: [], connections: [], decisionLedger: undefined,
    comments: [
      { platform: 'youtube', externalId: 'c1', text: 'كم السعر؟', authorName: 'a', at: now },
      { platform: 'youtube', externalId: 'c2', text: 'وين موقعكم؟', authorName: 'b', at: now },
      { platform: 'youtube', externalId: 'c3', text: 'بكم التقسيط؟', authorName: 'c', at: now },
      { platform: 'youtube', externalId: 'c4', text: 'كم السعر؟', authorName: 'd', at: now },
    ],
  };
  const dc = buildRuntimeDecisionContext(input);
  const seg = dc.audienceSegments[0];
  check('يوجد مقطع جمهور حقيقي', Boolean(seg), JSON.stringify(dc.audienceSegments));
  check('label غير فارغ (كان يُفرَّغ صامتاً قبل الإصلاح)', typeof seg?.label === 'string' && seg.label.length > 0, `label=${JSON.stringify(seg?.label)}`);
  check('sampleSize حقيقي = عدد التعليقات', seg?.sampleSize === 4, String(seg?.sampleSize));
  check('confidence قيمة صحيحة من النوع', ['low', 'medium', 'high'].includes(seg?.confidence as string), String(seg?.confidence));
  check('الحقول المُختلقة topic/intent لم تعد موجودة', !('topic' in (seg as any)) && !('intent' in (seg as any)), Object.keys(seg || {}).join(','));
  check('dominantIntent نص أو null (لا قيمة مُخترعة)', seg?.dominantIntent === null || typeof seg?.dominantIntent === 'string');
  // لا `any` في الملف: أي تغيير مستقبلي في النوع يُفشل الترجمة بدل الإفراغ الصامت.
  const runtimeSrc = read('engine/brain/runtime.ts');
  check('لا يوجد any في إسقاط المقاطع', !/\.map\(\(s: any\)/.test(runtimeSrc) && runtimeSrc.includes('function projectAudienceSegment(s: AudienceSegment)'));
}

// ---------------------------------------------------------------
group('B) توحيد كشف الأسرار + توسيع الكلمات المفتاحية');
{
  check('SECRET_KEY_RE مطابق لـcookie', SECRET_KEY_RE.test('cookie'));
  check('SECRET_KEY_RE مطابق لـsession', SECRET_KEY_RE.test('user_session'));
  check('SECRET_KEY_RE مطابق لـcredential', SECRET_KEY_RE.test('credential'));
  check('SECRET_KEY_RE مطابق لـtoken المجرّد', SECRET_KEY_RE.test('token'));
  check('SECRET_KEY_RE مطابق لـsecret المجرّد', SECRET_KEY_RE.test('secret'));
  check('SECRET_KEY_RE لا يطابق مفتاحاً عادياً', !SECRET_KEY_RE.test('customerName'));
  const r1 = redactSecretsFromText('cookie=abc123session');
  check('تنقية cookie=<قيمة>', !r1.includes('abc123session') && r1.includes('[redacted]'), r1);
  const r2 = redactSecretsFromText('session: SESSVALUE123');
  check('تنقية session: <قيمة>', !r2.includes('SESSVALUE123'), r2);
  const r3 = redactSecretsFromText('credential = CREDXYZ');
  check('تنقية credential = <قيمة>', !r3.includes('CREDXYZ'), r3);
  const r4 = redactSecretsFromText('token=TOKENVALUE99');
  check('تنقية token=<قيمة> المجرّد', !r4.includes('TOKENVALUE99'), r4);
  const r5 = redactSecretsFromText('secret: SECRETVALUE99');
  check('تنقية secret: <قيمة> المجرّد', !r5.includes('SECRETVALUE99'), r5);
  check('SECRET_TEXT_PATTERNS مصدر مشترك مُصدَّر', Array.isArray(SECRET_TEXT_PATTERNS) && SECRET_TEXT_PATTERNS.length >= 4);
  // مصدر واحد: orchestrator يستورد من errorSafety بدل تعريف قائمة ثانية.
  const orchSrc = read('engine/agent/orchestrator.ts');
  check('orchestrator يستورد SECRET_KEY_RE المشترك', orchSrc.includes("import { SECRET_KEY_RE } from '../runtime/errorSafety'"));
  check('orchestrator لم يعد يُعرّف SECRET_KEY_RE محلياً', !/^const SECRET_KEY_RE =/m.test(orchSrc));
  check('sanitizeOutput يُسقط token (انحدار)', !('token' in sanitizeOutput({ text: 'x', token: 'SECRET' })));
  check('sanitizeOutput يُسقط cookie (جديد)', !('cookie' in sanitizeOutput({ text: 'x', cookie: 'v' })));
  check('sanitizeOutput يُسقط session (جديد)', !('session' in sanitizeOutput({ text: 'x', session: 'v' })));
  check('sanitizeOutput يُسقط credential (جديد)', !('credential' in sanitizeOutput({ text: 'x', credential: 'v' })));
  check('sanitizeOutput يحفظ نص التعليق', sanitizeOutput({ text: 'مرحبا', token: 'S' }).text === 'مرحبا');
}

// ---------------------------------------------------------------
group('C) CentralAgentView: لا تعليق حالة التحميل عند فشل الطلب');
{
  const src = read('src/components/agent/CentralAgentView.tsx');
  const fn = src.slice(src.indexOf('const handleSendMessage'));
  check('agentChat داخل try', /try\s*\{[\s\S]*?apiService\.agentChat\(/.test(fn.slice(0, 1200)));
  check('setIsLoading(false) داخل finally', /finally\s*\{\s*setIsLoading\(false\);/.test(fn));
  check('رسالة خطأ للمستخدم عند الفشل', /showToast\(/.test(fn.slice(0, 2200)));
}

// ---------------------------------------------------------------
group('D) server.ts: معالج فشل ربط المنفذ');
{
  const src = read('server.ts');
  check('httpServer.on("error") موجود', /httpServer\.on\("error"/.test(src));
  check('يذكر EADDRINUSE برسالة واضحة', src.includes("EADDRINUSE") && /المنفذ \$\{PORT\} مستخدم بالفعل/.test(src));
  check('ينهي العملية برمز فشل', /process\.exit\(1\)/.test(src.slice(src.indexOf('httpServer.on("error"'), src.indexOf('httpServer.on("error"') + 400)));
}

// ---------------------------------------------------------------
group('E) معرّف العميل تجزئة أحادية الاتجاه');
{
  const src = read('server.ts');
  check('customerPublicId يستخدم SHA-256', /function customerPublicId\(key:string\)\{ return `cust_\$\{crypto\.createHash\('sha256'\)/.test(src));
  check('لم يعد يُبنى base64url من مفتاح العميل', !/cust_\$\{Buffer\.from\(key\)\.toString\('base64url'\)/.test(src));
}

// ---------------------------------------------------------------
group('F) App.tsx: مكوّنات ERP القديمة lazy (لا استيراد ثابت)');
{
  const src = read('src/App.tsx');
  const legacy = ['ExecutiveCommandView', 'BusinessSuiteView', 'FinanceView', 'InventoryView', 'ReportsView', 'OperationsView'];
  for (const name of legacy) {
    const staticImport = new RegExp(`import \\{ ${name} \\}`);
    const lazyImport = new RegExp(`const ${name} = lazy\\(\\(\\) => import\\('\\./components/`);
    check(`${name} lazy لا ثابت`, !staticImport.test(src) && lazyImport.test(src));
  }
  check('الحالات في switch باقية (لا كسر تنقّل)', src.includes("case 'finance': return <FinanceView />") && src.includes("case 'inventory': return <InventoryView />"));
}

// ---------------------------------------------------------------
group('G) LoginView: لا بريد مالك حقيقي ظاهر');
{
  const src = read('src/components/auth/LoginView.tsx');
  check('لا بريد المالك الحقيقي', !src.includes('mrdalghrabylltqsyt'));
  check('placeholder عام', src.includes('example@domain.com'));
}

// ---------------------------------------------------------------
group('H) AGENTS.md: عدد فحوصات final-audit مطابق للفعلي');
{
  const auditSrc = read('final-audit.mjs');
  const actualCount = (auditSrc.match(/^\s*add\(/gm) || []).length;
  const agentsSrc = read('AGENTS.md');
  check('AGENTS.md يذكر العدد الفعلي', agentsSrc.includes(`final-audit.mjs (${actualCount} فحصاً)`), `actual=${actualCount}`);
}

// ---------------------------------------------------------------
console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${passed} polish-batch checks`);
}
