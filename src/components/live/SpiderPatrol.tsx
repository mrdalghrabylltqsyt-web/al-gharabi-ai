import React, { useEffect, useRef } from 'react';

/**
 * العنكبوت المتجوّل (2026-10-26، الإصدار 2) — طبقة فوق الغرفة الحية كاملة.
 *
 * يتجوّل بلا توقف على **كل** محطات الواجهة: كل عنصر يحمل `data-station` محطة فحص مرتبطة بفحوص
 * حقيقية من قاعدة معرفة المهندس (مؤشرات، مفاتيح الأمان، المقاييس، صفوف الدورات، المنصات، اللوحات،
 * بطاقات المخطط، شارات الرأس). يسير بجولة كبرى أفعوانية على شبكة الشاشة كلها (محطة من كل خلية)، يقف فوقها، يُنزل خيطه، ويعرض **آخر نتيجة حقيقية** لفحوصها من الخادم.
 * ويترك خلفه خيط سحب حريرياً من محطة إلى محطة، يبقى ويخبو ببطء فيُنسج على الشاشة نسيج مؤقت.
 * مهمة الإصلاح تتقدّم على الجولة (كهرماني بمفتاح ربط، إلى القسم المعطّل).
 *
 * الأداء: حلقة إطارات تكتب DOM مباشرة (لا إعادة رسم React في كل إطار)، وعناصر الخيوط تُعاد
 * استعمالها (حلقة ثابتة الحجم). تتوقف عند إخفاء الصفحة أو إيقاف الحركة.
 */

export interface SpiderCheck { id: string; label: string; status: 'ok' | 'warn' | 'fail' | 'skip'; detail?: string }
export interface SpiderInspection { module: string; status: string; counts: { ok: number; warn: number; fail: number; skip: number }; checks: SpiderCheck[] }
export interface SpiderPatrolProps {
  rootRef: React.RefObject<HTMLElement>;
  /** آخر فحص كامل لكل قسم (من الخادم). */
  inspections: SpiderInspection[];
  /** الفحص الجاري الآن على الخادم (أحدث من الكامل). */
  current: SpiderInspection | null;
  titles: Record<string, string>;
  repair: { module: string; label: string } | null;
  motion: boolean;
}

type Mode = 'idle' | 'move' | 'drop' | 'inspect' | 'lift';
type Stop = { el: Element; label: string; status: string; tx: number; ty: number; anchorY: number };
const COL: Record<string, string> = { ok: '#34D399', warn: '#FBBF24', fail: '#F87171', skip: '#94A3B8' };
const ICON: Record<string, string> = { ok: '✓', warn: '⚠', fail: '✗', skip: '–' };
const RANK: Record<string, number> = { fail: 0, warn: 1, ok: 2, skip: 3 };
const THREADS = 12;
const THREAD_LIFE_MS = 14000;

export const SpiderPatrol: React.FC<SpiderPatrolProps> = ({ rootRef, inspections, current, titles, repair, motion }) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<SVGLineElement>(null);
  const dragRef = useRef<SVGGElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const props = useRef({ inspections, current, titles, repair, motion });
  props.current = { inspections, current, titles, repair, motion };

  useEffect(() => {
    const root = rootRef.current, layer = layerRef.current, body = bodyRef.current, thread = threadRef.current, drag = dragRef.current, tag = tagRef.current;
    if (!root || !layer || !body || !thread || !drag || !tag) return;
    let raf = 0, last = performance.now(), scanEl: Element | null = null;
    const S = {
      x: 0, y: 0, heading: 0, vx: 0, vy: 0, placed: false, mode: 'idle' as Mode, modeAt: 0, threadLen: 0,
      cur: null as Stop | null, visited: new WeakSet<Element>(), lastEl: null as Element | null, cellStep: 0,
      anchor: null as null | { x: number; y: number },
      repairKey: null as string | null, repairQueue: [] as Element[],
      // خيوط السحب: حلقة ثابتة من عناصر <line> + نقاط ارتكاز
      threads: [] as Array<{ x1: number; y1: number; x2: number; y2: number; born: number }>, live: null as null | { x1: number; y1: number },
    };

    // عناصر الخيوط والنقاط تُنشأ مرة واحدة وتُعاد (لا إنشاء في كل إطار).
    const NS = 'http://www.w3.org/2000/svg';
    const lines: SVGLineElement[] = [], dots: SVGCircleElement[] = [];
    drag.innerHTML = '';
    for (let i = 0; i < THREADS + 1; i++) { const l = document.createElementNS(NS, 'line'); l.setAttribute('class', 'lbr-drag'); drag.appendChild(l); lines.push(l); }
    for (let i = 0; i < THREADS; i++) { const c = document.createElementNS(NS, 'circle'); c.setAttribute('r', '2.6'); c.setAttribute('class', 'lbr-drag-dot'); drag.appendChild(c); dots.push(c); }

    const scale = () => { const r = layer.getBoundingClientRect(); return layer.offsetWidth ? r.width / layer.offsetWidth : 1; };
    const local = (el: Element) => { const lr = layer.getBoundingClientRect(), r = el.getBoundingClientRect(), k = scale() || 1; return { x: (r.left - lr.left) / k, y: (r.top - lr.top) / k, w: r.width / k, h: r.height / k }; };
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 10 && r.height > 8 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth; };

    /** الحكم الحقيقي لمحطة من آخر فحوص الخادم. */
    const verdict = (el: Element): { label: string; status: string } => {
      const P = props.current;
      const spec = el.getAttribute('data-station') || '';
      const name = el.getAttribute('data-st-name') || el.getAttribute('aria-label') || (el.querySelector('h2')?.textContent || '').slice(0, 30);
      const byModule = new Map<string, SpiderInspection>();
      for (const m of P.inspections || []) byModule.set(m.module, m);
      if (P.current) byModule.set(P.current.module, P.current);
      if (spec.startsWith('module:')) {
        const m = spec.slice(7); const insp = byModule.get(m); const title = P.titles[m] || m;
        if (!insp) return { label: `يفحص ${title}`, status: 'ok' };
        const total = insp.counts.ok + insp.counts.warn + insp.counts.fail;
        return { label: `${title} · ${insp.counts.ok}/${total} سليم`, status: insp.status };
      }
      const ids = spec.replace(/^check:/, '').split(',').map((x) => x.trim()).filter(Boolean);
      const all = new Map<string, SpiderCheck>();
      for (const m of byModule.values()) for (const c of m.checks) all.set(c.id, c);
      const found = ids.map((id) => all.get(id)).filter((c): c is SpiderCheck => Boolean(c) && c!.status !== 'skip');
      if (!found.length) return { label: `يفحص ${name || 'هذا القسم'}`, status: 'ok' };
      found.sort((a, b) => RANK[a.status] - RANK[b.status]);
      const w = found[0];
      const detail = w.detail ? ` · ${String(w.detail).slice(0, 34)}` : '';
      return { label: `${name ? `${name}: ` : ''}${w.label}${w.status === 'ok' ? '' : detail}`, status: w.status };
    };

    const stopAt = (el: Element, label: string, status: string): Stop => {
      const r = local(el);
      const jitter = ((Math.round(r.x + r.y) * 37) % 36) - 18;
      const tx = Math.max(24, Math.min(layer.offsetWidth - 24, r.x + r.w / 2 + jitter));
      const ty = Math.max(44, r.y - 40);
      return { el, label, status, tx, ty, anchorY: r.y + 4 };
    };

    /**
     * المحطة التالية — جولة كبرى على الشاشة كلها: الشاشة شبكة 5×4 خلايا يُمرّ عليها بمسار أفعواني
     * (يمين↔يسار، أعلى→أسفل)، ومن كل خلية تؤخذ محطة واحدة غير مزارة (الأقرب للعنكبوت). فكل دورة
     * تغطي كل أنحاء الواجهة بدل التكدّس في مكان واحد، والدورات التالية تأخذ محطات أخرى من الخلايا.
     */
    const GC = 5, GR = 4;
    const ORDER: number[] = [];
    for (let r = 0; r < GR; r++) for (let i = 0; i < GC; i++) ORDER.push(r * GC + (r % 2 ? GC - 1 - i : i));
    const nextStation = (): Element | null => {
      const W = layer.offsetWidth || 1, H = layer.offsetHeight || 1;
      const all = Array.from(root.querySelectorAll('[data-station]')).filter(visible);
      if (!all.length) return null;
      const cells = new Map<number, Array<{ e: Element; x: number; y: number }>>();
      for (const e of all) {
        if (e === S.lastEl) continue;
        const r = local(e); const x = r.x + r.w / 2, y = r.y + r.h / 2;
        const cell = Math.min(GR - 1, Math.max(0, Math.floor((y / H) * GR))) * GC + Math.min(GC - 1, Math.max(0, Math.floor((x / W) * GC)));
        const arr = cells.get(cell) || []; arr.push({ e, x, y }); cells.set(cell, arr);
      }
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < ORDER.length; k++) {
          const idx = (S.cellStep + k) % ORDER.length;
          const pool = (cells.get(ORDER[idx]) || []).filter((o) => !S.visited.has(o.e));
          if (!pool.length) continue;
          let best = pool[0], bd = Infinity;
          for (const o of pool) { const d = Math.hypot(o.x - S.x, o.y - S.y); if (d < bd) { bd = d; best = o; } }
          S.cellStep = (idx + 1) % ORDER.length;
          return best.e;
        }
        S.visited = new WeakSet<Element>(); // كل المحطات زيرت: جولة جديدة
      }
      return null;
    };

    const setMode = (m: Mode, now: number) => { S.mode = m; S.modeAt = now; };
    const startNext = (now: number) => {
      let el: Element | null = null; let label = '', status = 'ok';
      if (S.repairKey) {
        el = S.repairQueue.shift() || null;
        if (!el) { const m = props.current.repair!.module; S.repairQueue = [root.querySelector(`[data-modcard="${m}"]`), ...Array.from(root.querySelectorAll(`[data-mod~="${m}"]`)).slice(0, 1)].filter((e): e is Element => Boolean(e) && visible(e as Element)); el = S.repairQueue.shift() || null; }
        label = `🔧 يُصلح: ${props.current.repair?.label || ''}`; status = 'warn';
      }
      if (!el) { el = nextStation(); if (el) { const v = verdict(el); label = v.label; status = v.status; } }
      if (!el) { S.cur = null; setMode('idle', now); return; }
      S.cur = stopAt(el, label, status);
      if (S.anchor) S.live = { x1: S.anchor.x, y1: S.anchor.y };
      setMode('move', now);
    };
    const scanOn = (el: Element | null) => { if (scanEl && scanEl !== el) scanEl.classList.remove('lbr-scanning'); scanEl = el; if (el) el.classList.add('lbr-scanning'); };

    const paint = (now: number) => {
      const k = S.mode === 'move' ? Math.min(1, Math.hypot(S.vx, S.vy) / 300) : 0;
      body.style.transform = `translate(${S.x.toFixed(1)}px, ${S.y.toFixed(1)}px) rotate(${(S.heading + 90).toFixed(1)}deg)`;
      body.dataset.walk = S.mode === 'move' ? '1' : '0';
      body.style.setProperty('--gait', `${(0.4 - 0.24 * k).toFixed(2)}s`);
      const show = S.mode === 'drop' || S.mode === 'inspect' || S.mode === 'lift';
      thread.setAttribute('x1', S.x.toFixed(1)); thread.setAttribute('y1', (S.y + 16).toFixed(1));
      thread.setAttribute('x2', S.x.toFixed(1)); thread.setAttribute('y2', (S.y + 16 + S.threadLen).toFixed(1));
      thread.style.opacity = show ? '1' : '0';
      // خيوط السحب: الجاري يتبع العنكبوت، والمكتملة تخبو ببطء.
      S.threads = S.threads.filter((t) => now - t.born < THREAD_LIFE_MS).slice(-THREADS);
      for (let i = 0; i < THREADS; i++) {
        const t = S.threads[i]; const l = lines[i], d = dots[i];
        if (!t) { l.style.opacity = '0'; d.style.opacity = '0'; continue; }
        const a = Math.max(0, 1 - (now - t.born) / THREAD_LIFE_MS);
        l.setAttribute('x1', t.x1.toFixed(1)); l.setAttribute('y1', t.y1.toFixed(1)); l.setAttribute('x2', t.x2.toFixed(1)); l.setAttribute('y2', t.y2.toFixed(1));
        l.style.opacity = (0.75 * a).toFixed(3);
        d.setAttribute('cx', t.x2.toFixed(1)); d.setAttribute('cy', t.y2.toFixed(1)); d.style.opacity = (0.8 * a).toFixed(3);
      }
      const liveLine = lines[THREADS];
      if (S.live && S.mode === 'move') {
        liveLine.setAttribute('x1', S.live.x1.toFixed(1)); liveLine.setAttribute('y1', S.live.y1.toFixed(1));
        liveLine.setAttribute('x2', S.x.toFixed(1)); liveLine.setAttribute('y2', (S.y + 12).toFixed(1)); liveLine.style.opacity = '0.6';
      } else liveLine.style.opacity = '0';
      if (S.cur && S.mode === 'inspect') {
        tag.style.opacity = '1';
        if (S.y > 80) tag.style.transform = `translate(${S.x.toFixed(1)}px, ${(S.y - 30).toFixed(1)}px) translate(-50%, -100%)`;
        else tag.style.transform = `translate(${(S.x + 40).toFixed(1)}px, ${S.y.toFixed(1)}px) translate(0, -50%)`;
        const c = COL[S.cur.status] || COL.ok;
        tag.style.borderColor = c; tag.style.color = c;
        tag.textContent = `${S.cur.label.startsWith('🔧') ? '' : `${ICON[S.cur.status] || '✓'} `}${S.cur.label}`;
        thread.style.stroke = c;
      } else tag.style.opacity = '0';
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const P = props.current;
      const rk = P.repair ? `${P.repair.module}|${P.repair.label}` : null;
      if (rk !== S.repairKey) { S.repairKey = rk; S.repairQueue = []; if (rk && (S.mode === 'idle' || S.mode === 'move')) startNext(now); }
      layer.dataset.repair = rk ? '1' : '0';
      if (!S.placed) {
        const core = root.querySelector('[data-modcard="core"]');
        if (core && visible(core)) { const r = local(core); S.x = r.x + r.w / 2; S.y = r.y + r.h / 2; S.anchor = { x: S.x, y: S.y }; S.placed = true; }
      }
      const t = now - S.modeAt;
      if (S.mode === 'idle') startNext(now);
      if (S.mode === 'move' && S.cur) {
        if (!S.cur.el.isConnected) { startNext(now); }
        else {
          const dx = S.cur.tx - S.x, dy = S.cur.ty - S.y, d = Math.hypot(dx, dy);
          if (d < 2.5) {
            S.x = S.cur.tx; S.y = S.cur.ty; S.vx = S.vy = 0;
            if (S.live) S.threads.push({ x1: S.live.x1, y1: S.live.y1, x2: S.x, y2: S.y + 12, born: now });
            S.live = null; S.anchor = { x: S.x, y: S.y + 12 };
            S.visited.add(S.cur.el); S.lastEl = S.cur.el;
            setMode('drop', now); scanOn(S.cur.el);
          } else {
            const maxV = S.repairKey ? 520 : 440, want = Math.min(maxV, d * 2.8 + 40);
            const wob = Math.sin(now / 150) * Math.min(36, d * 0.12);
            const nx = dx / d, ny = dy / d;
            const a = Math.min(1, dt * 5);
            S.vx += (nx * want - ny * wob * 0.6 - S.vx) * a; S.vy += (ny * want + nx * wob * 0.6 - S.vy) * a;
            S.x += S.vx * dt; S.y += S.vy * dt;
            const target = (Math.atan2(S.vy, S.vx) * 180) / Math.PI;
            S.heading += (((target - S.heading + 540) % 360) - 180) * Math.min(1, dt * 8);
          }
        }
      }
      if (S.cur && S.mode !== 'move' && S.mode !== 'idle') {
        const full = Math.max(8, S.cur.anchorY - (S.y + 16));
        if (S.mode === 'drop') { S.threadLen = full * Math.min(1, t / 320); if (t >= 320) { S.cur = { ...S.cur, ...(S.repairKey ? {} : verdict(S.cur.el)) }; setMode('inspect', now); } }
        else if (S.mode === 'inspect') { S.threadLen = full + Math.sin(now / 260) * 1.5; if (t >= (S.repairKey ? 2600 : 1500)) setMode('lift', now); }
        else if (S.mode === 'lift') { S.threadLen = full * Math.max(0, 1 - t / 220); if (t >= 220) { scanOn(null); startNext(now); } }
        if (S.mode === 'drop' || S.mode === 'inspect') S.heading += (((90 - S.heading + 540) % 360) - 180) * Math.min(1, dt * 6);
      }
      paint(now);
      raf = requestAnimationFrame(tick);
    };

    const still = () => {
      const el = (S.repairKey && root.querySelector(`[data-modcard="${props.current.repair?.module}"]`)) || nextStation();
      if (!el) return;
      const v = S.repairKey ? { label: `🔧 يُصلح: ${props.current.repair?.label || ''}`, status: 'warn' } : verdict(el);
      S.cur = stopAt(el, v.label, v.status); S.x = S.cur.tx; S.y = S.cur.ty; S.heading = 90; S.mode = 'inspect';
      S.threadLen = Math.max(8, S.cur.anchorY - (S.y + 16)); S.threads = []; paint(performance.now());
    };
    const run = () => { cancelAnimationFrame(raf); if (props.current.motion && document.visibilityState === 'visible') { last = performance.now(); raf = requestAnimationFrame(tick); } else still(); };
    run();
    const onVis = () => run();
    document.addEventListener('visibilitychange', onVis);
    const onResize = () => { S.placed = false; S.threads = []; };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); scanOn(null); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion]);

  return (
    <div ref={layerRef} className="lbr-roam" aria-hidden="true">
      <svg className="lbr-roam-svg" width="100%" height="100%">
        <g ref={dragRef} />
        <line ref={threadRef} x1="0" y1="0" x2="0" y2="0" stroke="#A7F3D0" strokeWidth="1.4" />
      </svg>
      <div ref={tagRef} className="lbr-roam-tag" />
      <div ref={bodyRef} className="lbr-roam-body" data-walk="0">
        <svg width="68" height="68" viewBox="-28 -28 56 56">
          <defs>
            <radialGradient id="lbrSpBody" cx="40%" cy="35%" r="70%"><stop offset="0%" stopColor="var(--sp-hi)" /><stop offset="60%" stopColor="var(--sp-mid)" /><stop offset="100%" stopColor="#030712" /></radialGradient>
          </defs>
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
.lbr-roam-svg>line{transition:opacity .2s}
.lbr-drag{stroke:#C4F5E1;stroke-width:1.3;stroke-dasharray:1 0;filter:none;stroke-linecap:round;opacity:0}
.lbr-drag-dot{fill:#A7F3D0;opacity:0}
.lbr-roam-body{position:absolute;left:0;top:0;width:68px;height:68px;margin:-34px 0 0 -34px;will-change:transform;filter:drop-shadow(0 0 8px var(--sp-leg)) drop-shadow(0 0 18px rgba(52,211,153,.35))}
.lbr-roam[data-repair="1"] .lbr-roam-body{filter:drop-shadow(0 0 10px #FBBF24) drop-shadow(0 0 22px rgba(251,191,36,.5))}
.lbr-roam-body[data-walk="1"] .lbr-leg-a{animation:lbr-step var(--gait,.36s) ease-in-out infinite alternate}
.lbr-roam-body[data-walk="1"] .lbr-leg-b{animation:lbr-step var(--gait,.36s) ease-in-out infinite alternate-reverse}
.lbr-roam-body[data-walk="0"] .lbr-leg-a{animation:lbr-idle 2.4s ease-in-out infinite}
.lbr-roam-body[data-walk="0"] .lbr-leg-b{animation:lbr-idle 2.4s ease-in-out -1.2s infinite}
@keyframes lbr-step{from{transform:rotate(-11deg)}to{transform:rotate(11deg)}}
@keyframes lbr-idle{0%,100%{transform:rotate(0)}50%{transform:rotate(3deg)}}
.lbr-roam-wrench{position:absolute;top:-6px;left:50px;font-size:22px;opacity:0;transform-origin:bottom left}
.lbr-roam[data-repair="1"] .lbr-roam-wrench{opacity:1;animation:lbr-hammer .4s ease-in-out infinite alternate}
.lbr-roam-tag{position:absolute;left:0;top:0;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:800;padding:3px 10px;border-radius:999px;border:1px solid;background:rgba(3,6,18,.94);opacity:0;transition:opacity .25s;box-shadow:0 0 14px rgba(0,0,0,.6)}
.lbr-still .lbr-leg{animation:none!important}
@media (prefers-reduced-motion: reduce){.lbr-leg{animation:none!important}}
`;
