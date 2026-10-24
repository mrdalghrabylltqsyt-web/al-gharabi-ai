/**
 * اختبار قبول المرحلة 4 (منطق العقل عند الاستفسار) + المرحلة 5 (بيانات المعرض المؤكدة).
 *
 * يثبت، على **خادم حقيقي** (بلا أي مزود ذكاء اصطناعي وبلا حصة)، الحالات الإلزامية:
 *   الموقع / الدوام / مدة التقسيط / شروط التقسيط / الضمان (تحويل للمالك بلا مدة) /
 *   سعر بلا نوع (سؤال توضيحي) / «أسعد ثلاجات» (سؤال ميزانية) / «شعرس شاشة 55»
 *   (مطابقة بالمقاس) / «شارك 50» (مرادف شارب + القسط من القاعدة) / أخطاء إملائية /
 *   خارج النطاق (اعتذار وإعادة توجيه).
 *
 * القاعدة الحاكمة: **كل رقم في الرد مصدره بيانات المعرض/المنتجات المسجّلة فقط**؛
 * وعند غياب القاعدة لا يُذكر أي رقم (يُسأل أو يُصعَّد).
 *
 * لا يلمس أي مزود حقيقي ولا يستهلك حصة ولا يستخدم أي سرّ واقعي.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { classifyComment } from '../social/comments';
import { resolveInquiry } from '../social/inquiryResolver';
import { buildShowroomKnowledge, findKnowledgeMatch } from '../social/showroomKnowledge';
import { applyShowroomSeedDefaults, SHOWROOM_SEED_ADDRESS, SHOWROOM_SEED_HOURS, SHOWROOM_SEED_PHONE } from '../social/showroomSeed';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const REPO_ROOT = process.cwd();
const tsxCli = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = join(REPO_ROOT, 'server.ts');
const APP_PORT = 7520 + Math.floor(Math.random() * 60);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const PREVIEW_TOKEN = randomBytes(24).toString('hex');
const SESSION_SECRET = 'phase4-phase5-acceptance-secret-not-real';
const stateDir = mkdtempSync(join(tmpdir(), 'gharabi-phase45-'));

const PRODUCTS = [
  { id: 'p_fridge_sharp', name: 'ثلاجة شارب 16 قدم', cashPrice: 750000, downPaymentPercent: 10, durationMonths: 10, inStock: true, category: 'fridges' },
  { id: 'p_tv_samsung55', name: 'شاشة سامسونج 55 بوصة', cashPrice: 600000, downPaymentPercent: 10, durationMonths: 10, inStock: true, category: 'tvs' },
  { id: 'p_tv_sharp50', name: 'شاشة شارب 50 بوصة', cashPrice: 480000, downPaymentPercent: 10, durationMonths: 10, inStock: true, category: 'tvs' },
  { id: 'p_washer_lg', name: 'غسالة LG 12 كيلو', cashPrice: 900000, inStock: true, category: 'washers' },
];

function startApp(): { proc: ChildProcess; log: () => string } {
  let log = '';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(APP_PORT),
    NODE_ENV: 'production',
    APP_URL: BASE,
    STATE_DIR: stateDir,
    GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN,
    SESSION_SECRET,
    PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  };
  delete env.GEMINI_API_KEY;
  delete env.DATABASE_URL;
  const proc = spawn(process.execPath, [tsxCli, serverEntry], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', (d) => (log += String(d)));
  proc.stderr?.on('data', (d) => (log += String(d)));
  return { proc, log: () => log };
}

async function waitForHealth(timeoutMs = 180_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* لم يقلع بعد */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function stop(proc: ChildProcess): Promise<void> {
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1200));
  if (!proc.killed) proc.kill('SIGKILL');
}
async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/auth/preview-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }),
  });
  const body = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}` };
}
async function classify(auth: Record<string, string>, text: string): Promise<any> {
  const r = await fetch(`${BASE}/api/social/manager/comments/classify`, { method: 'POST', headers: auth, body: JSON.stringify({ text }) });
  return r.json();
}

// ---------------------------------------------------------------------------
// 1) وحدة: تطبيع عربي + مرادفات + مطابقة + قاعدة معرفة (بلا شبكة).
// ---------------------------------------------------------------------------
function unitTests(): void {
  group('1) وحدة: المُحلّل (تصنيف موضوعي + مطابقة بالخصائص + قاعدة معرفة)');
  const showroom: any = { name: 'معرض الغرابي' };
  applyShowroomSeedDefaults(showroom);
  const kb = buildShowroomKnowledge({
    address: showroom.address, city: showroom.city, phoneUnified: showroom.phoneUnified,
    workingHours: showroom.workingHours, policies: showroom.policies, requiredDocuments: showroom.requiredDocuments,
  });

  check('المرحلة 5: العنوان المؤكد يُملأ كما هو', showroom.address === SHOWROOM_SEED_ADDRESS);
  check('المرحلة 5: الهاتف المؤكد يُملأ كما هو', showroom.phoneUnified === SHOWROOM_SEED_PHONE);
  check('المرحلة 5: الدوام المؤكد يُملأ كما هو', showroom.workingHours === SHOWROOM_SEED_HOURS);
  check('المرحلة 5: مدة التقسيط 10 أشهر مسجّلة', showroom.defaultInstallmentMonths === 10);
  check('المرحلة 5: لا تُضاف أي معلومة ضمان للقاعدة', !JSON.stringify(showroom).includes('ضمان'));

  // لا يطمس قيمة قائمة أدخلها المالك (غير مُدمِّر).
  const owner: any = { address: 'عنوان المالك الخاص', workingHours: 'دوام مخصص' };
  applyShowroomSeedDefaults(owner);
  check('المرحلة 5: التغذية غير مُدمِّرة (لا تطمس قيمة المالك)', owner.address === 'عنوان المالك الخاص' && owner.workingHours === 'دوام مخصص');

  // تصنيف موضوعي: كل موضوع مستقل (لا خلط سعر/توفر/ضمان/دوام/مدة).
  const topicOf = (t: string) => classifyComment(t).topic;
  check('تصنيف: «وين موقعكم؟» ⇒ location', topicOf('وين موقعكم؟') === 'location');
  check('تصنيف: «شكد دوامكم؟» ⇒ hours', topicOf('شكد دوامكم؟') === 'hours');
  check('تصنيف: «شكد مدة التقسيط؟» ⇒ installment', topicOf('شكد مدة التقسيط؟') === 'installment');
  check('تصنيف: «شنو شروط التقسيط؟» ⇒ installment_terms', topicOf('شنو شروط التقسيط؟') === 'installment_terms');
  check('تصنيف: «عندكم ضمان؟» ⇒ warranty (لا price/availability)', topicOf('عندكم ضمان؟') === 'warranty');
  check('تصنيف: «توصلون للبصرة؟» ⇒ delivery', topicOf('توصلون للبصرة؟') === 'delivery');

  // قاعدة المعرفة: عنوان/دوام مسجّلان ⇒ مطابقة كلمة مفتاحية.
  const kLoc = findKnowledgeMatch('وين موقعكم؟', kb);
  check('قاعدة معرفة: سؤال الموقع يطابق مدخل الموقع', Boolean(kLoc) && kLoc!.entry.tags[0] === 'location');
  const kHours = findKnowledgeMatch('شكد دوامكم؟', kb);
  check('قاعدة معرفة: سؤال الدوام يطابق مدخل الدوام', Boolean(kHours) && kHours!.entry.tags[0] === 'hours');

  // مُحلّل الاستفسار: سؤال خارج النطاق ⇒ اعتذار (لا ادّعاء معرفة).
  const offTopic = resolveInquiry({ classification: classifyComment('شكد نتيجة مباراة ريال مدريد؟'), text: 'شكد نتيجة مباراة ريال مدريد؟', products: PRODUCTS });
  check('خارج النطاق: اعتذار وإعادة توجيه (لا جواب مختلق)', offTopic.kind === 'answer' && /معرض|أجهزة|تقسيط/.test(offTopic.text), offTopic.text);
  check('خارج النطاق: بلا أي رقم', !/\d/.test(offTopic.text), offTopic.text);
}

// ---------------------------------------------------------------------------
// 2) تكامل: خادم حقيقي + بيانات معرض مؤكدة ⇒ كل سؤال يُجاب من القاعدة فقط.
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  if (!existsSync(tsxCli)) { console.error('tsx CLI غير موجود — شغّل npm install أولاً.'); process.exit(1); }
  unitTests();

  // حالة أولية: بيانات المعرض المؤكدة + منتجات مسجّلة (مصدر الأرقام الوحيد).
  writeFileSync(join(stateDir, '.gharabi-state.json'), JSON.stringify({
    schemaVersion: 16, savedAt: new Date().toISOString(),
    users: [{ id: 'owner', name: 'مالك النظام', email: 'owner@example.invalid', role: 'owner', roleTitleArabic: 'مالك النظام', avatar: '', active: true, createdAt: new Date().toISOString() }],
    revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
    workspace: {
      showroom: {
        name: 'معرض الغرابي للتقسيط',
        address: SHOWROOM_SEED_ADDRESS,
        phoneUnified: SHOWROOM_SEED_PHONE,
        workingHours: SHOWROOM_SEED_HOURS,
        policies: ['المدة الأساسية 10 أشهر.'],
        defaultInstallmentMonths: 10,
      },
      products: PRODUCTS, posts: [], socialComments: [], socialReplies: [], socialApprovals: [], publishRecords: [],
    },
  }), 'utf8');

  const app = startApp();
  const auth = { 'Content-Type': 'application/json' } as Record<string, string>;
  try {
    check('الخادم يقلع', await waitForHealth(), app.log().slice(0, 400));
    Object.assign(auth, await login());

    group('2) قبول: الموقع والدوام (القيمة المؤكدة كما هي حرفياً)');
    const loc = await classify(auth, 'وين موقعكم؟');
    check('«وين موقعكم؟» ⇒ يعطي العنوان المؤكد', String(loc.suggestedDeterministicReply || '').includes('الطريق كربلاء الطويريج، مقابل العمود 202'), loc.suggestedDeterministicReply);
    check('الموقع: استراتيجية location_trusted', loc.replyIntelligence?.strategy === 'location_trusted', JSON.stringify(loc.replyIntelligence));
    const hours = await classify(auth, 'شكد دوامكم؟');
    check('«شكد دوامكم؟» ⇒ 8 صباحاً حتى 8 مساءً', String(hours.suggestedDeterministicReply || '').includes('يومياً من 8 صباحاً حتى 8 مساءً'), hours.suggestedDeterministicReply);

    group('3) قبول: مدة التقسيط وشروطه (من القاعدة فقط)');
    const months = await classify(auth, 'شكد مدة التقسيط؟');
    check('«شكد مدة التقسيط؟» ⇒ 10 أشهر', /10\s*أشهر/.test(String(months.suggestedDeterministicReply || '')), months.suggestedDeterministicReply);
    const terms = await classify(auth, 'شنو شروط التقسيط؟');
    check('«شنو شروط التقسيط؟» ⇒ يجيب من القاعدة (10 أشهر)', /10\s*أشهر/.test(String(terms.suggestedDeterministicReply || '')), terms.suggestedDeterministicReply);

    group('4) قبول: الضمان ⇒ تحويل للمالك دون أي مدة');
    const w1 = await classify(auth, 'عندكم ضمان؟');
    check('«عندكم ضمان؟» ⇒ تصعيد (escalate)', w1.replyIntelligence?.escalate === true, JSON.stringify(w1.replyIntelligence));
    check('«عندكم ضمان؟» ⇒ لا تُذكر أي مدة ضمان رقمية', !/\d/.test(String(w1.suggestedDeterministicReply || '')), w1.suggestedDeterministicReply);
    check('«عندكم ضمان؟» ⇒ مسودة موجودة وغير محجوبة بحارس السلامة', Boolean(w1.suggestedDeterministicReply) && w1.replyIntelligence?.blockedBySafety === false, JSON.stringify({ reply: w1.suggestedDeterministicReply, blocked: w1.replyIntelligence?.blockedBySafety }));
    const w2 = await classify(auth, 'شكد ضمان الثلاجة؟');
    check('«شكد ضمان الثلاجة؟» ⇒ تصعيد بلا مدة', w2.replyIntelligence?.escalate === true && !/\d/.test(String(w2.suggestedDeterministicReply || '')), w2.suggestedDeterministicReply);

    group('5) قبول: سعر بلا نوع ⇒ سؤال توضيحي (لا رقم عشوائي)');
    const p1 = await classify(auth, 'شكد سعر ثلاجة؟');
    check('«شكد سعر ثلاجة؟» ⇒ سؤال عن النوع/الحجم', /الماركة|المقاس|الحجم/.test(String(p1.suggestedDeterministicReply || '')), p1.suggestedDeterministicReply);
    check('«شكد سعر ثلاجة؟» ⇒ لا رقم في الرد', !/\d/.test(String(p1.suggestedDeterministicReply || '')), p1.suggestedDeterministicReply);
    const p2 = await classify(auth, 'أسعد ثلاجات؟');
    check('«أسعد ثلاجات؟» ⇒ سؤال عن الميزانية/النوع/المقاس', /الميزانية|الماركة|المقاس|الحجم/.test(String(p2.suggestedDeterministicReply || '')), p2.suggestedDeterministicReply);
    const p3 = await classify(auth, 'شكد سعر الشاشة؟');
    check('«شكد سعر الشاشة؟» ⇒ سؤال عن الماركة والمقاس', /الماركة/.test(String(p3.suggestedDeterministicReply || '')) && /المقاس/.test(String(p3.suggestedDeterministicReply || '')), p3.suggestedDeterministicReply);

    group('6) قبول: المطابقة بالمقاس والمرادف (الأرقام من القاعدة فقط)');
    const tv = await classify(auth, 'شعرس شاشة 55؟');
    check('«شعرس شاشة 55؟» ⇒ مطابقة بالمقاس وتعرض السعر المسجّل', String(tv.suggestedDeterministicReply || '').includes('600,000'), tv.suggestedDeterministicReply);
    const sharp = await classify(auth, 'شكد القسط لشارك 50 على 10 شهور؟');
    check('«شارك 50» ⇒ يطابق شارب (مرادف) ويعطي القسط', String(sharp.suggestedDeterministicReply || '').includes('480,000'), sharp.suggestedDeterministicReply);
    // المعادلة الموحّدة (المصدر الواحد installmentPrice): ceil((الكاش + 25%) ÷ المدة)
    // = ceil(480,000 × 1.25 ÷ 10) = ceil(60,000) = 60,000 (لا cash/المدة = 43,200).
    check('«شارك 50» ⇒ القسط مشتقّ من القاعدة (60,000)', String(sharp.suggestedDeterministicReply || '').includes('60,000'), sharp.suggestedDeterministicReply);
    check('«شارك 50» ⇒ لا يذكر سعراً غير مسجّل', !/750,000|900,000|600,000/.test(String(sharp.suggestedDeterministicReply || '')), sharp.suggestedDeterministicReply);

    group('7) قبول: أخطاء إملائية ولهجة مختلطة ⇒ فهم وإجابة من القاعدة');
    const typo = await classify(auth, 'وين موقكم بالزبط؟');
    check('سؤال بالخطأ الإملائي ⇒ يعطي العنوان المؤكد', String(typo.suggestedDeterministicReply || '').includes('الطريق كربلاء الطويريج'), typo.suggestedDeterministicReply);
    const dialect = await classify(auth, 'اكم شهر التقسيط عندكم؟');
    check('لهجة مختلطة عن المدة ⇒ 10 أشهر', /10\s*أشهر/.test(String(dialect.suggestedDeterministicReply || '')), dialect.suggestedDeterministicReply);

    group('8) قبول: خارج النطاق ⇒ اعتذار وإعادة توجيه بلا أرقام');
    const off = await classify(auth, 'شكد نتيجة مباراة ريال مدريد اليوم؟');
    check('سؤال رياضة ⇒ اعتذار وإعادة توجيه', /معرض|أجهزة|تقسيط/.test(String(off.suggestedDeterministicReply || '')), off.suggestedDeterministicReply);
    check('سؤال رياضة ⇒ بلا أي رقم', !/\d/.test(String(off.suggestedDeterministicReply || '')), off.suggestedDeterministicReply);

    group('9) عقد: كل رقم في الرد مصدره القاعدة (لا اختراع)');
    // الأرقام المشروعة: أسعار المنتجات المسجّلة + الأقساط المشتقّة بالمعادلة الموحّدة
    // ceil((الكاش + 25%) ÷ المدة) [شارب 50 ⇒ 60,000، سامسونج 55 ⇒ 75,000، ثلاجة شارب ⇒ 93,750]
    // + أرقام بيانات المعرض المؤكدة (العنوان «العمود 202» والدوام «8» والمدة «10»)
    // + مقاسات/أحجام أسماء المنتجات. أي رقم آخر = اختراع ⇒ فشل.
    const allowedNumbers = new Set(['750,000', '600,000', '480,000', '900,000', '60,000', '75,000', '93,750', '10', '202', '8', '55', '50', '16', '12']);
    const all = [loc, hours, months, terms, p1, p2, p3, tv, sharp, typo, dialect, off];
    let leaked: string | null = null;
    for (const r of all) {
      const txt = String(r.suggestedDeterministicReply || '');
      const nums = txt.match(/\d[\d,]*/g) || [];
      for (const n of nums) {
        // الأرقام المشروعة: أسعار/أقساط مسجّلة، مقاسات/أحجام أسماء المنتجات المسجّلة،
        // أو أرقام بيانات المعرض المؤكدة (العنوان/الدوام/المدة). أي رقم آخر = اختراع.
        if (!allowedNumbers.has(n)) { leaked = `${n} في «${txt}»`; break; }
      }
      if (leaked) break;
    }
    check('لا رقم خارج بيانات المعرض/المنتجات المسجّلة', leaked === null, leaked || '');

    group('10) عقد: بلا قاعدة (معرض بلا عنوان/سعر) ⇒ لا رقم ولا اختراع');
    const emptyStateDir = mkdtempSync(join(tmpdir(), 'gharabi-phase45-empty-'));
    const emptyPort = APP_PORT + 1;
    writeFileSync(join(emptyStateDir, '.gharabi-state.json'), JSON.stringify({
      schemaVersion: 16, savedAt: new Date().toISOString(),
      users: [{ id: 'owner', name: 'مالك', email: 'owner@example.invalid', role: 'owner', active: true, createdAt: new Date().toISOString() }],
      revokedSessions: [], userRevocations: [], audit: [], jobs: [], platformConnections: [],
      workspace: { showroom: { name: 'معرض بلا بيانات', address: '', phoneUnified: '', workingHours: '', policies: [], defaultInstallmentMonths: 0 }, products: [], posts: [], socialComments: [], socialReplies: [], socialApprovals: [], publishRecords: [] },
    }), 'utf8');
    let emptyLog = '';
    const emptyProc = spawn(process.execPath, [tsxCli, serverEntry], {
      cwd: REPO_ROOT,
      env: { ...(process.env as Record<string, string>), PORT: String(emptyPort), NODE_ENV: 'production', APP_URL: `http://127.0.0.1:${emptyPort}`, STATE_DIR: emptyStateDir, GHARABI_PREVIEW_TOKEN: PREVIEW_TOKEN, SESSION_SECRET, PLATFORM_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'), GEMINI_API_KEY: '', DATABASE_URL: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    emptyProc.stdout?.on('data', (d) => (emptyLog += String(d)));
    emptyProc.stderr?.on('data', (d) => (emptyLog += String(d)));
    try {
      const deadline = Date.now() + 120_000;
      let up = false;
      while (Date.now() < deadline) {
        try { if ((await fetch(`http://127.0.0.1:${emptyPort}/api/health`)).ok) { up = true; break; } } catch { /* بعد */ }
        await new Promise((r) => setTimeout(r, 400));
      }
      check('خادم «بلا قاعدة» يقلع', up, emptyLog.slice(0, 300));
      const eLogin = await (await fetch(`http://127.0.0.1:${emptyPort}/api/auth/preview-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: PREVIEW_TOKEN }) })).json();
      const eAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${eLogin.token}` };
      // ملاحظة: تغذية المرحلة 5 تُعيد ملء العنوان/الدوام الفارغين — لكن الأسعار لا تُخترع.
      const ePrice = await (await fetch(`http://127.0.0.1:${emptyPort}/api/social/manager/comments/classify`, { method: 'POST', headers: eAuth, body: JSON.stringify({ text: 'شكد سعر ثلاجة شارب؟' }) })).json();
      check('بلا منتج مسجّل ⇒ لا سعر مُختلق', !/[0-9]{3,}/.test(String(ePrice.suggestedDeterministicReply || '')), ePrice.suggestedDeterministicReply);
    } finally {
      await stop(emptyProc);
      rmSync(emptyStateDir, { recursive: true, force: true });
    }
  } finally {
    await stop(app.proc);
    rmSync(stateDir, { recursive: true, force: true });
  }

  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} / ${passed + failures.length}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} phase4/phase5 acceptance checks`);
}

void main();
