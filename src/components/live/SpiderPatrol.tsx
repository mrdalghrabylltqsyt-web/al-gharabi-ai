import React, { useEffect, useRef } from 'react';

/**
 * العنكبوت المتجوّل (2026-10-26) — طبقة فوق الغرفة الحية كاملة.
 *
 * يمشي بسلاسة (60 إطاراً/ث، تسارع وتباطؤ، يدير جسده نحو اتجاه سيره، ومشية رباعية متناوبة:
 * أربع أرجل تتقدّم وأربع تدفع) على كل عناصر الواجهة: بطاقات المخطط واللوحات ومركز السيطرة.
 * لا يتحرك عشوائياً: يتبع الدورية الحقيقية على الخادم (`patrol.cursor`) — يذهب إلى بطاقة القسم
 * الذي يُفحص الآن ثم إلى لوحاته، يقف فوق كل عنصر، يُنزل خيطه الحريري عليه، ويعرض نتيجة الفحص
 * الحقيقي الجاري (✓/⚠/✗ + اسم الفحص)، ثم يرفع الخيط ويمضي. عند مهمة إصلاح: يتحول كهرماني
 * ويحمل مفتاح ربط، ويذهب إلى القسم المعطّل.
 *
 * الأداء: لا إعادة رسم React في كل إطار — الحلقة تكتب الموضع مباشرة في DOM. تتوقف حين تُخفى
 * الصفحة أو تُوقف الحركة (يقف العنكبوت ساكناً فوق القسم الجاري).
 */

export interface SpiderCheck { label: string; status: 'ok' | 'warn' | 'fail' | 'skip' }
export interface SpiderPatrolProps {
  rootRef: React.RefObject<HTMLElement>;
  /** القسم الذي تفحصه الدورية الآن على الخادم. */
  cursor: string | null;
  /** فحوص القسم الجاري (من الخادم). */
  checks: SpiderCheck[];
  /** عناوين الأقسام بالعربية. */
  titles: Record<string, string>;
  /** مهمة إصلاح جارية (تتقدّم على الدورية). */
  repair: { module: string; label: string } | null;
  motion: boolean;
}

type Mode = 'idle' | 'move' | 'drop' | 'inspect' | 'lift';
const COL: Record<string, string> = { ok: '#34D399', warn: '#FBBF24', fail: '#F87171', skip: '#94A3B8' };
const ICON: Record<string, string> = { ok: '✓', warn: '⚠', fail: '✗', skip: '–' };

export const SpiderPatrol: React.FC<SpiderPatrolProps> = ({ rootRef, cursor, checks, titles, repair, motion }) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<SVGLineElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  // كل الحالة المتحركة في refs (لا إعادة رسم في كل إطار).
  const st = useRef({
    x: 0, y: 0, heading: 0, vx: 0, vy: 0, placed: false,
    mode: 'idle' as Mode, modeAt: 0,
    plan: [] as Array<{ el: Element; module: string; label: string; status: string }>,
    cur: null as null | { el: Element; module: string; label: string; status: string; tx: number; ty: number; anchorY: number },
    lastCursor: null as string | null, lastRepair: null as string | null, checkIdx: 0, threadLen: 0,
  });
  const props = useRef({ cursor, checks, titles, repair, motion });
  props.current = { cursor, checks, titles, repair, motion };

  useEffect(() => {
    const root = rootRef.current, layer = layerRef.current, body = bodyRef.current, thread = threadRef.current, tag = tagRef.current;
    if (!root || !layer || !body || !thread || !tag) return;
    const S = st.current;
    let raf = 0, last = performance.now(), scanEl: Element | null = null;

    /** تحويل موضع عنصر إلى إحداثيات الطبقة (تراعي تصغير الشاشة الحية). */
    const scale = () => { const r = layer.getBoundingClientRect(); return layer.offsetWidth ? r.width / layer.offsetWidth : 1; };
    const local = (el: Element) => {
      const lr = layer.getBoundingClientRect(), r = el.getBoundingClientRect(), k = scale() || 1;
      return { x: (r.left - lr.left) / k, y: (r.top - lr.top) / k, w: r.width / k, h: r.height / k };
    };
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 8 && r.height > 8; };
    /** أهداف قسم: بطاقته على المخطط ثم لوحاته في الواجهة. */
    const targetsFor = (m: string, repairing: boolean) => {
      const card = root.querySelector(`[data-modcard="${m}"]`);
      const panels = Array.from(root.querySelectorAll(`[data-mod~="${m}"]`)).filter(visible);
      const list = [card, ...(repairing ? [] : panels.slice(0, 2))].filter((e): e is Element => Boolean(e) && visible(e as Element));
      return list.length ? list : panels.slice(0, 1);
    };
    const nextCheck = () => {
      const cs = props.current.checks.filter((c) => c.status !== 'skip');
      if (!cs.length) return null;
      const c = cs[S.checkIdx % cs.length]; S.checkIdx += 1; return c;
    };
    const planFor = (m: string, repairing: boolean) => {
      const title = props.current.titles[m] || m;
      S.plan = targetsFor(m, repairing).map((el, i) => {
        if (repairing) return { el, module: m, label: `🔧 يُصلح: ${props.current.repair?.label || title}`, status: 'warn' };
        if (i === 0) {
          const cs = props.current.checks.filter((c) => c.status !== 'skip');
          const worst = cs.some((c) => c.status === 'fail') ? 'fail' : cs.some((c) => c.status === 'warn') ? 'warn' : 'ok';
          const ok = cs.filter((c) => c.status === 'ok').length;
          return { el, module: m, label: cs.length ? `${title} · ${ok}/${cs.length} سليم` : `يفحص ${title}`, status: cs.length ? worst : 'ok' };
        }
        const c = nextCheck();
        return { el, module: m, label: c ? c.label : `يفحص ${title}`, status: c ? c.status : 'ok' };
      });
    };
    const setMode = (m: Mode, now: number) => { S.mode = m; S.modeAt = now; };
    const startNext = (now: number) => {
      const t = S.plan.shift();
      if (!t || !t.el.isConnected) { S.cur = null; setMode('idle', now); return; }
      const r = local(t.el);
      // يقف فوق الحافة العليا للعنصر، قرب منتصفها (مع إزاحة صغيرة كي لا يبدو آلياً).
      const jitter = ((S.checkIdx * 37) % 40) - 20;
      const tx = Math.max(20, Math.min(layer.offsetWidth - 20, r.x + r.w / 2 + jitter));
      // يقف فوق الحافة العليا (لا يغطي محتوى العنصر)، والخيط ينزل حتى الحافة فقط.
      const ty = Math.max(44, r.y - 40);
      S.cur = { ...t, tx, ty, anchorY: r.y + 4 };
      setMode('move', now);
    };
    const paint = () => {
      const k = S.mode === 'move' ? Math.min(1, Math.hypot(S.vx, S.vy) / 260) : 0;
      body.style.transform = `translate(${S.x.toFixed(1)}px, ${S.y.toFixed(1)}px) rotate(${(S.heading + 90).toFixed(1)}deg)`;
      body.dataset.walk = S.mode === 'move' ? '1' : '0';
      body.style.setProperty('--gait', `${(0.42 - 0.24 * k).toFixed(2)}s`);
      const showThread = S.mode === 'drop' || S.mode === 'inspect' || S.mode === 'lift';
      thread.setAttribute('x1', S.x.toFixed(1)); thread.setAttribute('y1', (S.y + 16).toFixed(1));
      thread.setAttribute('x2', S.x.toFixed(1)); thread.setAttribute('y2', (S.y + 16 + S.threadLen).toFixed(1));
      thread.style.opacity = showThread ? '1' : '0';
      if (S.cur && (S.mode === 'inspect' || S.mode === 'drop')) {
        tag.style.opacity = S.mode === 'inspect' ? '1' : '0';
        // اللافتة فوق العنكبوت (لا فوق العنصر المفحوص).
        // قرب أعلى الشاشة لا مكان فوقه: تُعرض بجانبه بدل أن تُقصّ.
        if (S.y > 80) tag.style.transform = `translate(${S.x.toFixed(1)}px, ${(S.y - 30).toFixed(1)}px) translate(-50%, -100%)`;
        else tag.style.transform = `translate(${(S.x + 40).toFixed(1)}px, ${S.y.toFixed(1)}px) translate(0, -50%)`;
        const c = COL[S.cur.status] || COL.ok;
        tag.style.borderColor = c; tag.style.color = c;
        tag.textContent = `${ICON[S.cur.status] || '✓'} ${S.cur.label}`;
        thread.style.stroke = c;
      } else tag.style.opacity = '0';
    };
    const scanOn = (el: Element | null) => { if (scanEl && scanEl !== el) scanEl.classList.remove('lbr-scanning'); scanEl = el; if (el) el.classList.add('lbr-scanning'); };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const P = props.current;
      // أولوية الإصلاح، ثم الدورية الحقيقية.
      const repairKey = P.repair ? `${P.repair.module}|${P.repair.label}` : null;
      if (repairKey && repairKey !== S.lastRepair) { S.lastRepair = repairKey; planFor(P.repair!.module, true); if (S.mode === 'idle' || S.mode === 'move') startNext(now); }
      if (!repairKey) S.lastRepair = null;
      if (!repairKey && P.cursor && P.cursor !== S.lastCursor) { S.lastCursor = P.cursor; planFor(P.cursor, false); if (S.mode === 'idle') startNext(now); }
      if (!S.placed) {
        const core = root.querySelector('[data-modcard="core"]');
        if (core) { const r = local(core); S.x = r.x + r.w / 2; S.y = r.y + r.h / 2; S.placed = true; }
      }
      layer.dataset.repair = repairKey ? '1' : '0';
      const t = now - S.modeAt;
      if (S.mode === 'idle' && S.plan.length) startNext(now);
      if (S.mode === 'move' && S.cur) {
        // توجيه «وصول» ناعم: سرعة قصوى تُخفَّض قرب الهدف، مع تأرجح جانبي خفيف كالمشي الحقيقي.
        const dx = S.cur.tx - S.x, dy = S.cur.ty - S.y, d = Math.hypot(dx, dy);
        if (d < 2.5) { S.x = S.cur.tx; S.y = S.cur.ty; S.vx = S.vy = 0; setMode('drop', now); scanOn(S.cur.el); }
        else {
          const maxV = repairKey ? 420 : 300, want = Math.min(maxV, d * 2.6 + 30);
          const wob = Math.sin(now / 140) * Math.min(40, d * 0.15);
          const nx = dx / d, ny = dy / d;
          const tvx = nx * want - ny * wob * 0.6, tvy = ny * want + nx * wob * 0.6;
          const a = Math.min(1, dt * 5);
          S.vx += (tvx - S.vx) * a; S.vy += (tvy - S.vy) * a;
          S.x += S.vx * dt; S.y += S.vy * dt;
          const target = (Math.atan2(S.vy, S.vx) * 180) / Math.PI;
          let dh = ((target - S.heading + 540) % 360) - 180;
          S.heading += dh * Math.min(1, dt * 8);
        }
      }
      if (S.cur) {
        const full = Math.max(8, S.cur.anchorY - (S.y + 16));
        if (S.mode === 'drop') { S.threadLen = full * Math.min(1, t / 380); if (t >= 380) setMode('inspect', now); }
        else if (S.mode === 'inspect') { S.threadLen = full + Math.sin(now / 260) * 1.5; if (t >= (repairKey ? 2600 : 1700)) setMode('lift', now); }
        else if (S.mode === 'lift') { S.threadLen = full * Math.max(0, 1 - t / 260); if (t >= 260) { scanOn(null); if (repairKey && !S.plan.length) planFor(P.repair!.module, true); startNext(now); } }
      }
      // يتجه نحو الأسفل (نحو خيطه) أثناء الفحص.
      if (S.mode === 'drop' || S.mode === 'inspect') { let dh = ((90 - S.heading + 540) % 360) - 180; S.heading += dh * Math.min(1, dt * 6); }
      paint();
      raf = requestAnimationFrame(tick);
    };

    const still = () => {
      // بلا حركة: يقف ساكناً فوق بطاقة القسم الجاري ويعرض نتيجته.
      const P = props.current; const m = P.repair?.module || P.cursor;
      if (!m) return;
      planFor(m, Boolean(P.repair)); const tgt = S.plan.shift(); S.plan = [];
      if (!tgt) return;
      const r = local(tgt.el); S.x = r.x + r.w / 2; S.y = Math.max(44, r.y - 40); S.heading = 90;
      S.cur = { ...tgt, tx: S.x, ty: S.y, anchorY: r.y + 4 }; S.mode = 'inspect'; S.threadLen = Math.max(8, S.cur.anchorY - (S.y + 16)); paint();
    };

    const run = () => { cancelAnimationFrame(raf); if (props.current.motion && document.visibilityState === 'visible') { last = performance.now(); raf = requestAnimationFrame(tick); } else still(); };
    run();
    const onVis = () => run();
    document.addEventListener('visibilitychange', onVis);
    const onResize = () => { S.placed = false; };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); scanOn(null); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('resize', onResize); };
    // يُعاد تشغيل الحلقة فقط عند تغيّر «الحركة»؛ باقي الخصائص تُقرأ حيّة من props.current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion]);

  return (
    <div ref={layerRef} className="lbr-roam" aria-hidden="true">
      <svg className="lbr-roam-svg" width="100%" height="100%"><line ref={threadRef} x1="0" y1="0" x2="0" y2="0" stroke="#A7F3D0" strokeWidth="1.4" strokeDasharray="1 0" /></svg>
      <div ref={tagRef} className="lbr-roam-tag" />
      <div ref={bodyRef} className="lbr-roam-body" data-walk="0">
        <svg width="68" height="68" viewBox="-28 -28 56 56">
          <defs>
            <radialGradient id="lbrSpBody" cx="40%" cy="35%" r="70%"><stop offset="0%" stopColor="var(--sp-hi)" /><stop offset="60%" stopColor="var(--sp-mid)" /><stop offset="100%" stopColor="#030712" /></radialGradient>
          </defs>
          {/* أرجل بمفصلين، مجموعتان متناوبتان (A/B) للمشية الرباعية */}
          {[-1, 1].map((side) => [0, 1, 2, 3].map((i) => {
            const grp = (i + (side > 0 ? 1 : 0)) % 2 === 0 ? 'a' : 'b';
            const y0 = -5 + i * 3.6, kx = side * (11 + (i === 0 || i === 3 ? 1 : 3)), ky = -12 + i * 7.5, fx = side * (17 + (i === 1 || i === 2 ? 3 : 0)), fy = -18 + i * 12;
            return <path key={`${side}${i}`} className={`lbr-leg lbr-leg-${grp}`} style={{ transformOrigin: `${side * 3}px ${y0}px` }} d={`M${side * 3} ${y0} Q${kx} ${ky - 6} ${kx} ${ky} L${fx} ${fy}`} fill="none" stroke="var(--sp-leg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />;
          }))}
          <ellipse cx="0" cy="7" rx="7.2" ry="9" fill="url(#lbrSpBody)" stroke="var(--sp-leg)" strokeWidth="0.8" />
          <path d="M-3 4 L0 9 L3 4 M-2 10 L0 13 L2 10" fill="none" stroke="var(--sp-mark)" strokeWidth="1" strokeLinecap="round" />
          <circle cx="0" cy="-6" r="4.6" fill="url(#lbrSpBody)" stroke="var(--sp-leg)" strokeWidth="0.8" />
          <circle cx="-1.6" cy="-8.6" r="0.9" fill="var(--sp-eye)" /><circle cx="1.6" cy="-8.6" r="0.9" fill="var(--sp-eye)" />
          <circle cx="-2.8" cy="-7.4" r="0.55" fill="var(--sp-eye)" /><circle cx="2.8" cy="-7.4" r="0.55" fill="var(--sp-eye)" />
        </svg>
        <span className="lbr-roam-wrench">🔧</span>
      </div>
    </div>
  );
};

export const SPIDER_CSS = `
.lbr-roam{position:absolute;inset:0;pointer-events:none;z-index:40;--sp-hi:#A7F3D0;--sp-mid:#065F46;--sp-leg:#6EE7B7;--sp-mark:#ECFDF5;--sp-eye:#F0FDFA}
.lbr-roam[data-repair="1"]{--sp-hi:#FDE68A;--sp-mid:#92400E;--sp-leg:#FBBF24;--sp-mark:#FFFBEB;--sp-eye:#FFF7ED}
.lbr-roam-svg{position:absolute;inset:0;overflow:visible}
.lbr-roam-svg line{transition:opacity .2s;filter:drop-shadow(0 0 3px currentColor)}
.lbr-roam-body{position:absolute;left:0;top:0;width:68px;height:68px;margin:-34px 0 0 -34px;will-change:transform;filter:drop-shadow(0 0 8px var(--sp-leg)) drop-shadow(0 0 18px rgba(52,211,153,.35))}
.lbr-roam[data-repair="1"] .lbr-roam-body{filter:drop-shadow(0 0 10px #FBBF24) drop-shadow(0 0 22px rgba(251,191,36,.5))}
.lbr-leg{transition:transform .2s}
.lbr-roam-body[data-walk="1"] .lbr-leg-a{animation:lbr-step var(--gait,.36s) ease-in-out infinite alternate}
.lbr-roam-body[data-walk="1"] .lbr-leg-b{animation:lbr-step var(--gait,.36s) ease-in-out infinite alternate-reverse}
.lbr-roam-body[data-walk="0"] .lbr-leg-a{animation:lbr-idle 2.4s ease-in-out infinite}
.lbr-roam-body[data-walk="0"] .lbr-leg-b{animation:lbr-idle 2.4s ease-in-out -1.2s infinite}
@keyframes lbr-step{from{transform:rotate(-11deg)}to{transform:rotate(11deg)}}
@keyframes lbr-idle{0%,100%{transform:rotate(0)}50%{transform:rotate(3deg)}}
.lbr-roam-wrench{position:absolute;top:-6px;left:50px;font-size:22px;opacity:0;transform-origin:bottom left}
.lbr-roam[data-repair="1"] .lbr-roam-wrench{opacity:1;animation:lbr-hammer .4s ease-in-out infinite alternate}
.lbr-roam-tag{position:absolute;left:0;top:0;white-space:nowrap;font-size:12.5px;font-weight:800;padding:3px 10px;border-radius:999px;border:1px solid;background:rgba(3,6,18,.94);opacity:0;transition:opacity .25s;box-shadow:0 0 14px rgba(0,0,0,.6)}
.lbr-still .lbr-leg{animation:none!important}
@media (prefers-reduced-motion: reduce){.lbr-leg{animation:none!important}}
`;
