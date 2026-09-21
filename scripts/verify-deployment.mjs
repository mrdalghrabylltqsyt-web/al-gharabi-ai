/**
 * فحص ما بعد النشر. لا يكتب أي ملف ولا يسجّل أي سر.
 *
 * الاستخدام:
 *   APP_URL="https://your-deployment-host" \
 *   GHARABI_PREVIEW_TOKEN="<التوكن الذي ضبطته في المنصة>" \
 *   node scripts/verify-deployment.mjs
 *
 * يفحص:
 *  1) /api/health: خلفية التخزين وحالتها، وفرق دوام التوقيع (sessionsDurable،
 *     أي نجاة الجلسة عبر العمليات) عن دوام الإبطال (revocationsDurable، أي
 *     نجاة قائمة الإبطال عبر إعادة النشر) — الاثنان صريحان ولا يُدَّعى أي منهما.
 *  2) أن preview-login يرفض توكن المعاينة الخاطئ بغير 404 (الميزة مُفعَّلة فعلاً)،
 *     والقيمة الصحيحة تمنح جلسة تعمل على مسار محمي.
 *  3) أن التوكن لا يظهر في أي استجابة.
 *
 * ويطبع PASS/FAIL لكل فحص ورابط الدخول بصيغة المقطع (#) دون كتابته في ملف.
 */

const BASE = (process.env.APP_URL || '').trim().replace(/\/$/, '');
const PREVIEW_TOKEN = (process.env.GHARABI_PREVIEW_TOKEN || '').trim();

if (!BASE) {
  console.error('FAIL: APP_URL غير مضبوط. مثال: APP_URL="https://host" node scripts/verify-deployment.mjs');
  process.exit(1);
}

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`PASS: ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failures.push(name); console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function json(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body, raw: JSON.stringify(body ?? {}) };
}

async function run() {
  console.log(`== فحص النشر على ${BASE} ==`);

  // 1) الصحة وثبات التخزين.
  let health;
  try {
    health = await json('/api/health');
  } catch (error) {
    check('/api/health متاح', false, String(error?.message || error).slice(0, 120));
    report();
    return;
  }
  check('/api/health يستجيب 200 وبحالة ok', health.status === 200 && health.body?.status === 'ok', `status=${health.status}`);

  const p = health.body?.persistence || {};
  check(`خلفية التخزين Postgres (وليست ملفاً محلياً)`, p.backend === 'postgres', `backend=${p.backend}`);
  check(`التخزين سليم ووضع الدوام معلن`, p.healthy === true && p.mode === 'durable', `healthy=${p.healthy} mode=${p.mode}`);
  check(`لا كتابة فاشلة معلنة`, !p.lastPersistError, `lastPersistError=${p.lastPersistError ?? 'null'}`);

  // دوامان متمايزان: دوام التوقيع (الجلسات) ودوام الإبطال (قائمة الإبطال).
  check('★ الجلسات دائمة عبر عمليات منفصلة (sessionsDurable)', p.sessionsDurable === true, `sessionSecretSource=${p.sessionSecretSource}`);
  check('★ الإبطال دائم عبر إعادة النشر (revocationsDurable)', p.revocationsDurable === true);
  check('مصدر مفتاح الجلسة ليس عابراً', p.sessionSecretSource !== 'ephemeral', `source=${p.sessionSecretSource}`);
  check('توكن المعاينة مُفعَّل في بيئة النشر', p.previewLoginEnabled === true);

  // 2) preview-login: يرفض الخطأ بغير 404، أي أن المسار مُفعَّل فعلاً.
  let wrong;
  try {
    wrong = await json('/api/auth/preview-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'definitely-wrong-token-value' }),
    });
  } catch (error) {
    check('preview-login متاح', false, String(error?.message || error).slice(0, 120));
    report();
    return;
  }
  check('★ preview-login مُفعَّل (لا يعيد 404)', wrong.status !== 404, `status=${wrong.status}`);
  check('توكن خاطئ يُرفض صراحةً (401/403)', wrong.status === 401 || wrong.status === 403, `status=${wrong.status}`);
  check('رد الخطأ لا يكشف أي توكن', !wrong.raw.includes(PREVIEW_TOKEN || '\u0000'));

  // 3) التوكن الصحيح يمنح جلسة تعمل (يُفحص فقط إن مُرِّر في البيئة).
  if (PREVIEW_TOKEN) {
    const ok = await json('/api/auth/preview-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: PREVIEW_TOKEN }),
    });
    check('التوكن الصحيح يمنح جلسة مالك', ok.status === 200 && typeof ok.body?.token === 'string', `status=${ok.status}`);
    if (typeof ok.body?.token === 'string') {
      const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${ok.body.token}` } });
      check('الجلسة الممنوحة تعمل على مسار محمي', me.status === 200, `status=${me.status}`);
      check('الدور هو المالك', ok.body?.user?.role === 'owner', `role=${ok.body?.user?.role}`);
    }
  } else {
    console.log('تنبيه: GHARABI_PREVIEW_TOKEN غير مضبوط في الطرفية، فتُخطَّى فحوص الدخول الصحيح.');
  }

  report();
}

function report() {
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAIL: ${failures.length} / ${passed + failures.length}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${passed} checks`);
    // رابط الدخول بصيغة المقطع: لا يظهر في سجلات الخادم ولا في محفوظات المتصفح،
    // والواجهة تمسحه من شريط العنوان فوراً بعد التبادل.
    console.log(`رابط الدخول (استبدل <TOKEN> بقيمة GHARABI_PREVIEW_TOKEN): ${BASE}/#preview_token=<TOKEN>`);
    console.log('افتحه مرة واحدة واحفظه؛ الجلسة تبقى 30 يوماً وتنجو من إعادة التشغيل.');
  }
}

run().catch((err) => { console.error('Deployment verification crashed:', String(err?.message || err).slice(0, 200)); process.exit(1); });
