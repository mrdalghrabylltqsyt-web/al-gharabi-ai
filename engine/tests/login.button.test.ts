/**
 * إصلاح «زر طلب رمز التحقق لا يستجيب» — حرّاس انحدار وحدة/سلوكية.
 *
 * يثبت:
 *  1. requestOwnerChallenge يُرسل POST فعلاً إلى المسار الصحيح (لا نقر ميّت).
 *  2. مهلة صريحة (AbortController): الشبكة المتعطلة تُقطع ولا يبقى الزر «بلا استجابة».
 *  3. رد غير ناجح (502/429/503) يرمي رسالة واضحة بلا أي سرّ.
 *  4. LoginView: النموذج noValidate (تحقق برمجي، لا اعتماد على فقاعة الجوال).
 *  5. LoginView: زر «إعادة المحاولة» موجود ويُربط بالمعالج الفعلي.
 *  6. LoginView: رسالة الخطأ عنصر role=alert (واضحة لقارئ الشاشة وللاختبار).
 *  7. لا تغيير في بوابة الأمان: المسار محمي على الخادم كما هو (طلب بلا مصادقة).
 *
 * لا شبكة حقيقية: نُحقن fetch وهمي ونتحقق من السلوك الفعلي للدالة.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiService } from '../../src/services/api';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

async function run() {
  const login = read('src/components/auth/LoginView.tsx');
  const api = read('src/services/api.ts');

  // --- 1) إرسال فعلي للمسار الصحيح ---
  const calls: Array<{ url: string; method?: string; body?: any; hasSignal: boolean }> = [];
  (globalThis as any).fetch = async (url: string, init: any = {}) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body || '{}'), hasSignal: Boolean(init.signal) });
    return { ok: true, status: 200, json: async () => ({ success: true, message: 'تم إرسال رمز التحقق إلى بريد المالك' }) } as any;
  };
  const ok = await apiService.requestOwnerChallenge('owner@example.com');
  check('يُرسل إلى مسار طلب رمز المالك', calls[0]?.url === '/api/auth/request-owner-challenge');
  check('الطريقة POST', calls[0]?.method === 'POST');
  check('يحمل البريد في الجسم', calls[0]?.body?.email === 'owner@example.com');
  check('يحمل إشارة مهلة (AbortController)', calls[0]?.hasSignal === true);
  check('يعيد نجاحاً مع الرسالة', ok.success === true && typeof ok.message === 'string');

  // --- 2) فشل الخادم: رسالة واضحة بلا سرّ ---
  (globalThis as any).fetch = async () =>
    ({ ok: false, status: 502, json: async () => ({ success: false, error: 'تعذر إرسال رمز التحقق، حاول مرة أخرى' }) } as any);
  let errMsg = '';
  try { await apiService.requestOwnerChallenge('owner@example.com'); } catch (e: any) { errMsg = e?.message || ''; }
  check('فشل 502 يعطي رسالة واضحة', /تعذر إرسال رمز التحقق/.test(errMsg));

  // --- 2ب) كود السبب غير السرّي يُنقل إلى الخطأ (للتشخيص) ---
  (globalThis as any).fetch = async () =>
    ({ ok: false, status: 502, json: async () => ({ success: false, error: 'تعذر إرسال رمز التحقق، حاول مرة أخرى', reason: 'invalid_from_address' }) } as any);
  let errReason = '';
  try { await apiService.requestOwnerChallenge('owner@example.com'); } catch (e: any) { errReason = e?.reason || ''; }
  check('كود السبب غير السرّي يُنقل إلى الخطأ', errReason === 'invalid_from_address', errReason);
  check('الخطأ لا يسرّب أي سرّ', !/Bearer|secret|re_/i.test(errMsg) && !/Bearer|secret|re_/i.test(errReason));

  // --- 3) تعطّل الشبكة: رسالة اتصال لا تعليق ---
  (globalThis as any).fetch = async () => { const e: any = new Error('boom'); e.name = 'TypeError'; throw e; };
  try { await apiService.requestOwnerChallenge('owner@example.com'); errMsg = ''; } catch (e: any) { errMsg = e?.message || ''; }
  check('تعطّل الشبكة يعطي رسالة اتصال', /تعذّر الوصول إلى الخادم/.test(errMsg));

  // --- 4) مهلة الطلب: AbortError => رسالة مهلة ---
  (globalThis as any).fetch = async () => { const e: any = new Error('aborted'); e.name = 'AbortError'; throw e; };
  try { await apiService.requestOwnerChallenge('owner@example.com'); errMsg = ''; } catch (e: any) { errMsg = e?.message || ''; }
  check('انتهاء المهلة يعطي رسالة مهلة', /انتهت مهلة الاتصال/.test(errMsg));
  check('لا كشف أي سرّ في رسائل الخطأ', !/token|secret|key|Bearer/i.test(errMsg));

  // --- 5) بنية LoginView: تحقق برمجي + إعادة محاولة + role=alert ---
  check('النموذج noValidate (تحقق داخل الواجهة)', /<form onSubmit=\{handleRequestChallenge\} noValidate/.test(login));
  check('تحقق برمجي صريح من البريد الفارغ', login.includes("يرجى إدخال البريد الإلكتروني المصرح له."));
  check('تحقق صيغة البريد', login.includes('صيغة البريد الإلكتروني غير صحيحة'));
  check('زر إعادة المحاولة موجود', /إعادة المحاولة/.test(login) && /setRequestFailed\(true\)/.test(login));
  check('حالة requestFailed موجودة', login.includes('const [requestFailed'));
  check('رسالة الخطأ role=alert', /role="alert"/.test(login));
  check('توجيه تشخيصي من كود السبب (غير سرّي)', login.includes('challengeFailureHint') && login.includes('email_provider_not_configured') && login.includes('errorHint'));
  check('حالة تحميل واضحة على الزر', login.includes('جاري إرسال الرمز...') && login.includes('aria-busy={loading}'));
  check('مهلة الطلب معرّفة في api', api.includes('OWNER_CHALLENGE_TIMEOUT_MS') && api.includes('AbortController'));

  // --- 6) بوابة الأمان سليمة (لا تخفيف) ---
  const server = read('server.ts');
  check('مسار الطلب يبقى على الخادم (لا يُختلق قبول محلي)', server.includes('"/api/auth/request-owner-challenge"'));
  check('لا يتجاوز التحقق من المالك (البريد غير المطابق لا يُرسل له)', server.includes('normalizedEmail !== OWNER_EMAIL'));

  console.log(`\nPASSED: ${passed} login-button checks, ${failures.length} فشل`);
  if (failures.length) { for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
}

run().catch((e) => { console.error('FAILED to run:', e); process.exit(1); });
