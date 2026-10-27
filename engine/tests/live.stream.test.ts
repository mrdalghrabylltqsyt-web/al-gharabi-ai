/**
 * البث اللحظي وعرض الهاتف (2026-10-27):
 *   1) انتظار طويل بدل الاستطلاع كل 4 ثوانٍ: الحدث يصل فور وقوعه، والطلبات في الهدوء أقل ~80%.
 *   2) الهاتف: الشاشة الحية كانت تُصغَّر بخمسة أعمدة حتى لا يُقرأ شيء (لقطة المالك من هاتفه).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LiveWaiters, LIVE_WAIT_MAX_MS, LIVE_WAIT_MAX_WAITERS } from '../ops/liveWait';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0; const failures: string[] = [];
const check = (name: string, ok: boolean, info = '') => { if (ok) passed++; else failures.push(name + (info ? ` — ${info}` : '')); };

// مؤقّتات المنتظرين `.unref()` (لا تمنع إغلاق الخادم)؛ هنا نُبقي الحلقة حيّة حتى نهاية الاختبار
// كي لا تخرج العملية بصمت قبل أن تُفحص النتائج.
const keepAlive = setInterval(() => undefined, 1000);
void (async () => {
  // 1) المنتظرون
  {
    const w = new LiveWaiters();
    const t0 = Date.now();
    const a = w.wait(5000), b = w.wait(5000);
    check('المنتظرون يُسجَّلون', w.size === 2);
    setTimeout(() => w.notify(), 30);
    const [ra, rb] = await Promise.all([a, b]);
    check('★ حدث جديد ⇒ كل المنتظرين يُردّ عليهم فوراً', ra === 'event' && rb === 'event' && Date.now() - t0 < 1000 && w.size === 0);

    const t1 = Date.now();
    const r = await w.wait(60);
    check('★ بلا حدث ⇒ يُرد عند انتهاء المهلة', r === 'timeout' && Date.now() - t1 >= 55 && w.size === 0);

    const small = new LiveWaiters(2);
    const p1 = small.wait(2000), p2 = small.wait(2000);
    check(`★ سقف المنتظرين (${LIVE_WAIT_MAX_WAITERS} افتراضياً) يحمي الخطة: الزائد يُرد فوراً «مشغول»`, (await small.wait(2000)) === 'busy' && small.size === 2);
    small.notify(); await Promise.all([p1, p2]);

    let cancel: (() => void) | null = null;
    const pc = w.wait(5000, (c) => { cancel = c; });
    (cancel as any)?.();
    check('★ إغلاق المتصفح للطلب يُلغي المنتظر (لا منتظر يتيم)', (await pc) === 'closed' && w.size === 0);

    const late = w.wait(10);
    await new Promise((r2) => setTimeout(r2, 30));
    check('الإشعار بعد الانتهاء لا يُعيد الحل مرتين', w.notify() === 0 && (await late) === 'timeout');
    check(`المهلة لا تتجاوز ${LIVE_WAIT_MAX_MS / 1000} ث (تحت حد وكيل Netlify ~26 ث)`, LIVE_WAIT_MAX_MS <= 20000);
    const z = new LiveWaiters(); const pz = z.wait(10); z.closeAll();
    check('الإغلاق يُطلق الجميع', (await pz) === 'closed' && z.size === 0);
  }

  // 2) الخادم
  {
    const server = read('server.ts');
    check('★ كل حدث حي يوقظ المنتظرين', server.includes('if (liveEvents.push(input, new Date().toISOString())) liveWaiters.notify();'));
    check('★ الانتظار للطلب الخفيف فقط وبعد أول لقطة، وحين لا جديد', server.includes('String(req.query?.wait || "") === "1" && String(req.query?.lite || "") === "1" && since > 0 && liveEvents.lastId <= since'));
    check('★ اللقطة تُحسب بعد الانتظار (أرقام حديثة لا قديمة)', server.indexOf('waited = await liveWaiters.wait(LIVE_WAIT_MAX_MS') < server.indexOf('  const nowMs = Date.now();\n  // حارس الخطة المجانية'));
    check('★ إغلاق الطلب يُلغي الانتظار ولا يُكتب رد على اتصال مغلق', server.includes('res.on("close", cancel)') && server.includes('if (waited === "closed" || res.writableEnded'));
    check('★ الإغلاق (SIGTERM) لا يتعلّق بطلبات معلّقة', server.includes('try { liveWaiters.notify(); } catch { /* تجاهل */ }'));
    check('الرد يُعلن نمط البث', server.includes('stream: { mode: "long-poll", maxWaitMs: LIVE_WAIT_MAX_MS, waited }'));
  }

  // 3) الواجهة
  {
    const ui = read('src/components/live/LiveBrainRoom.tsx');
    const api = read('src/services/api.ts');
    check('★ العميل يطلب الانتظار الطويل ويُلغي الطلب عند المغادرة', api.includes("${lite && opts.wait ? '&wait=1' : ''}") && api.includes('signal: opts.signal') && ui.includes('return () => { stopped = true; outer.abort(); };'));
    check('★ رجوع تلقائي للاستطلاع بعد 3 إخفاقات، ومحاولة البث مجدداً بعد دقيقتين', ui.includes("if (fails >= 3 && canStream) { canStream = false; retryStreamAt = Date.now() + 120000; setStreamMode('poll'); }"));
    check('★ خادم قديم بلا بث ⇒ استطلاع كما كان', ui.includes("if (r.stream?.mode === 'long-poll')") && ui.includes("retryStreamAt = Date.now() + 600000"));
    check('★ مهلة عميل فوق مهلة الخادم (لا طلب يتيم)', ui.includes('window.setTimeout(kill, 28000)'));
    check('★ تراجع أُسّي عند الانقطاع (لا إغراق للخادم)', ui.includes('Math.min(30000, 2000 * 2 ** Math.min(fails, 4))'));
    check('اللقطة الكاملة كل 30 ث تبقى', ui.includes('const FULL_EVERY_MS = 30000;') && ui.includes('wait: canStream && !fullDue'));
    check('«متأخر» يُقاس على نمط البث', ui.includes("(streamMode === 'stream' ? STALE_MS + 20000 : STALE_MS)") && ui.includes('بث لحظي · متصل'));

    check('★ كشف الهاتف: لمس خشن + شاشة جهاز < 700 نقطة', ui.includes("window.matchMedia('(pointer: coarse)').matches") && ui.includes('const handheld = coarse && sw > 0 && sw < 700;'));
    check('★ يُلغي تصغير «موقع سطح المكتب» بالتكبير', ui.includes('window.innerWidth / deviceW') && ui.includes('zoom: device.zoom !== 1 ? device.zoom : undefined'));
    const mb = ui.slice(ui.indexOf('const mobileBody = ('), ui.indexOf('if (!isWall) {'));
    const order = ['{alertEl}', '{engineerEl}', '{kpisEl}', '{controlEl}', '{voicesEl}', '{mapEl}'].map((k) => mb.indexOf(k));
    check('★ الهاتف بالأولوية: الحالات الحرجة ← صحة المشروع ← الأرقام ← مركز السيطرة ← أصوات الزبائن … والمخطط الزخرفي أخيراً', order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), order.join(','));
    check('★ كل لوحات الشاشة موجودة في عرض الهاتف (لا شيء يُخفى)', ['headerEl', 'sleepEl', 'alertEl', 'engineerEl', 'kpisEl', 'controlEl', 'voicesEl', 'interEl', 'intentsEl', 'platStatusEl', 'eventsEl', 'cyclesEl', 'gaugesEl', 'leadsEl', 'prodsEl', 'topicsEl', 'platInsEl', 'pulseEl', 'mapEl', 'journeyEl', 'legendEl'].every((k) => mb.includes(`{${k}}`)));
    check('★ زر «العرض الكامل/عرض الهاتف» ويُحفظ التفضيل في المتصفح فقط (محمي بـtry)', ui.includes('data-phone-layout') && ui.includes("window.localStorage.setItem(HANDHELD_PREF_KEY, n ? '1' : '0'); } catch"));
    check('★ سلوك الطبقة (إغلاق/منع الجلب المزدوج) مستقل عن التخطيط', ui.includes('if (!isWall) return;') && ui.includes('{isWall && <button type="button" onClick={() => onCloseRef.current?.()}') && ui.includes('onLeave={isWall ?'));
  }

  clearInterval(keepAlive);
  console.log('\n' + '='.repeat(60));
  if (failures.length) {
    console.error(`FAILED: ${failures.length} — passed ${passed}`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`PASSED: ${passed} live-stream checks`);
})();
