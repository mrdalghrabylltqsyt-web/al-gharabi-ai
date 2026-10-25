import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiService } from '../../services/api';
import { useApp } from '../../context/AppContext';

/**
 * غرفة العقل الحية — المخطط الهندسي للمشروع حيّاً ومتدفقاً (2026-10-25).
 *
 * كل ما يظهر هنا من الخادم الحقيقي (`/api/live/room`، للمالك): حالة الأقسام الثلاثة عشر حول
 * العقل المركزي، المنصات العشر، نبض الدورات، والأحداث لحظة وقوعها (تعليق وارد، رد جاهز،
 * نشر، نسخة احتياطية، مزامنة أرقام، فشل/تعافٍ…). كل حدث جديد يُطلق نبضة ضوئية على خط
 * قسمه نحو العقل أو منه. التحديث كل 4 ثوانٍ أثناء فتح الشاشة فقط (يتوقف إن أُخفيت).
 */

type Status = 'ok' | 'partial' | 'off';
type ModKey = 'owner' | 'auth' | 'agents' | 'platforms' | 'external' | 'gate' | 'automation' | 'backup' | 'monitor' | 'storage' | 'memory' | 'products' | 'customers';

interface ModMeta {
  key: ModKey; title: string; en: string; x: number; y: number; mx: number; my: number; ex: number; ey: number;
  color: string; dir: 'in' | 'out'; parts: string[];
}

const MODS: ModMeta[] = [
  { key: 'owner', title: 'المالك والمستخدم', en: 'Owner & UI', x: 520, y: 78, mx: 488, my: 223, ex: 520, ey: 339, color: '#F0ABFC', dir: 'in', parts: ['إنشاء/رفع محتوى', 'اختيار المنصات', 'جدولة النشر', 'مراجعة الردود', 'متابعة النتائج'] },
  { key: 'auth', title: 'المصادقة والأمان', en: 'Auth & Security', x: 720, y: 115, mx: 601, my: 223, ex: 558, ey: 346, color: '#38BDF8', dir: 'in', parts: ['تحدّي بريد المالك', 'جلسات HMAC', 'RBAC', 'requireOwner', 'حماية واجهات API'] },
  { key: 'agents', title: 'العقول المتخصصة', en: 'Six-Agent Council', x: 874, y: 217, mx: 696, my: 264, ex: 587, ey: 365, color: '#E879F9', dir: 'out', parts: ['الإدراك والمعرفة', 'الجمهور والطلب', 'الاستراتيجية والقرار', 'العروض والمبيعات', 'التعلّم والتوقيت'] },
  { key: 'platforms', title: 'النشر والمنصات', en: 'Unified Publishing', x: 947, y: 361, mx: 751, my: 336, ex: 601, ey: 393, color: '#60A5FA', dir: 'in', parts: ['فيسبوك', 'إنستغرام', 'تيك توك', 'يوتيوب', 'تيليغرام', 'ثريدز', 'واتساب', 'X', 'سناب', 'Google Business'] },
  { key: 'external', title: 'الخدمات الخارجية', en: 'External APIs', x: 922, y: 514, mx: 753, my: 423, ex: 596, ey: 422, color: '#FBBF24', dir: 'in', parts: ['Google (Drive)', 'Gemini AI', 'Meta Graph', 'TikTok API', 'YouTube API', 'Telegram Bot API'] },
  { key: 'gate', title: 'بوابة الصلاحيات', en: 'Approval Gate', x: 805, y: 641, mx: 701, my: 504, ex: 574, ey: 446, color: '#F0ABFC', dir: 'out', parts: ['سياسة التشغيل', 'مراجعة المحتوى', 'حجب غير الموثّق', 'EXTERNAL_ACTION', 'سجل الموافقات'] },
  { key: 'automation', title: 'محرك الأتمتة', en: 'Automation & Scheduling', x: 623, y: 713, mx: 608, my: 562, ex: 540, ey: 459, color: '#A78BFA', dir: 'out', parts: ['جدولة المنشورات', 'مهام الخلفية', 'متابعة التنفيذ', 'إعادة المحاولة', 'منع التكرار'] },
  { key: 'backup', title: 'النسخ والتعافي', en: 'Backup & Recovery', x: 417, y: 713, mx: 495, my: 582, ex: 500, ey: 459, color: '#34D399', dir: 'out', parts: ['نسخ البيانات', 'نقاط الاستعادة', 'اختبار الاستعادة', 'تعافٍ معزول'] },
  { key: 'monitor', title: 'المراقبة والصحة', en: 'Monitoring & Health', x: 235, y: 641, mx: 387, my: 561, ex: 466, ey: 446, color: '#22D3EE', dir: 'in', parts: ['/api/health', '/api/readiness', 'حالة الموصلات', 'تنبيهات المشاكل'] },
  { key: 'storage', title: 'التخزين الدائم', en: 'PostgreSQL · Neon', x: 118, y: 514, mx: 310, my: 503, ex: 444, ey: 422, color: '#34D399', dir: 'out', parts: ['gharabi_state', 'المنصات والمحتوى', 'التفاعلات والزبائن', 'المنتجات', 'سجل الأحداث'] },
  { key: 'memory', title: 'الذاكرة والتقارير', en: 'Memory & Analytics', x: 93, y: 361, mx: 281, my: 421, ex: 439, ey: 393, color: '#A78BFA', dir: 'in', parts: ['تخزين الأحداث', 'ذاكرة السياق', 'تحليل الأداء', 'استخراج المؤشرات', 'تقارير المالك'] },
  { key: 'products', title: 'مستودع المنتجات', en: 'Products & Knowledge', x: 166, y: 217, mx: 307, my: 335, ex: 453, ey: 365, color: '#F472B6', dir: 'in', parts: ['الأسماء والتصنيفات', 'الأسعار والأقساط', 'التوفر', 'منع اختلاق البيانات'] },
  { key: 'customers', title: 'مركز الزبائن', en: 'Customer Center', x: 320, y: 115, mx: 382, my: 263, ex: 482, ey: 346, color: '#38BDF8', dir: 'in', parts: ['جمع التعليقات', 'تحليل النية', 'الربط بالمنتج', 'الرد العراقي', 'المتابعات'] },
];
const MOD_BY_KEY: Record<string, ModMeta> = Object.fromEntries(MODS.map((m) => [m.key, m]));
const CROSS: Array<[ModKey, ModKey]> = [['platforms', 'external'], ['gate', 'automation'], ['backup', 'monitor'], ['storage', 'memory'], ['products', 'customers'], ['owner', 'auth']];

const STATUS_COLOR: Record<string, string> = { ok: '#34D399', partial: '#FBBF24', off: '#F87171', neutral: '#93A1C3' };
const STATUS_TEXT: Record<string, string> = { ok: 'يعمل ومُثبت', partial: 'جزئي — ينقصه إجراء', off: 'متوقف' };
const LEVEL_COLOR: Record<string, string> = { ok: '#34D399', info: '#38BDF8', warn: '#FBBF24', error: '#F87171' };
const PLATFORM_AR: Record<string, string> = { facebook: 'فيسبوك', instagram: 'إنستغرام', youtube: 'يوتيوب', threads: 'ثريدز', tiktok: 'تيك توك', telegram: 'تيليغرام', whatsapp: 'واتساب للأعمال', x: 'X', snapchat: 'سناب شات', google_business: 'Google Business' };
const CORE_FNS = ['فهم الأمر', 'تخطيط المهام', 'اختيار الأدوات', 'التحقق من الصلاحيات', 'متابعة التنفيذ', 'التعلّم من النتائج', 'اقتراح التوصيات'];
const JOURNEY = [
  { title: 'المالك يرفع المحتوى', detail: 'ويحدد المنصات والجدولة', badge: '#60A5FA', mods: ['owner', 'auth'] },
  { title: 'العقل يخطط', detail: 'ويستدعي العقول الستة', badge: '#C084FC', mods: ['agents', 'core'] },
  { title: 'الأتمتة تنفذ', detail: 'النشر والرد عبر البوابة', badge: '#FBBF24', mods: ['automation', 'gate'] },
  { title: 'المنصات تنشر', detail: 'وترجع التعليقات والنتائج', badge: '#34D399', mods: ['platforms', 'customers', 'external'] },
  { title: 'تُسجَّل البيانات', detail: 'في الذاكرة والتخزين', badge: '#F87171', mods: ['storage', 'backup', 'products'] },
  { title: 'تحليل النتائج', detail: 'وتوصيات للتحسين', badge: '#38BDF8', mods: ['memory', 'monitor'] },
];
const POLL_MS = 4000;

function pathIn(m: ModMeta): string { return `M${m.x} ${m.y} Q${m.mx} ${m.my} ${m.ex} ${m.ey}`; }
function pathOut(m: ModMeta): string { return `M${m.ex} ${m.ey} Q${m.mx} ${m.my} ${m.x} ${m.y}`; }
function crossPath(a: ModMeta, b: ModMeta): string {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = mx - 520, dy = my - 400; const L = Math.hypot(dx, dy) || 1;
  return `M${a.x} ${a.y} Q${Math.round(mx + (dx / L) * 40)} ${Math.round(my + (dy / L) * 40)} ${b.x} ${b.y}`;
}
function ago(iso: string | null | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `قبل ${s} ث`;
  const m = Math.round(s / 60);
  if (m < 60) return `قبل ${m} د`;
  const h = Math.round(m / 60);
  return h < 48 ? `قبل ${h} س` : `قبل ${Math.round(h / 24)} يوم`;
}
function clock(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('ar-IQ', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Baghdad' }); } catch { return ''; }
}

interface LiveEvt { id: number; at: string; module: string; level: string; title: string; text: string }
interface Burst { id: number; module: ModKey; color: string; path: string }

const CSS = `
.lbr-mono{font-family:'JetBrains Mono',ui-monospace,monospace}
.lbr-flow-in{stroke-dasharray:4 12;animation:lbr-dash 1.5s linear infinite}
.lbr-flow-out{stroke-dasharray:4 12;animation:lbr-dash 1.9s linear infinite reverse}
.lbr-flow-x{stroke-dasharray:2 8;animation:lbr-dash 2.6s linear infinite}
@keyframes lbr-dash{to{stroke-dashoffset:-32}}
.lbr-halo{transform-origin:520px 400px;animation:lbr-halo 3.4s ease-out infinite}
.lbr-halo2{transform-origin:520px 400px;animation:lbr-halo 3.4s ease-out 1.7s infinite}
@keyframes lbr-halo{0%{transform:scale(.8);opacity:.8}100%{transform:scale(1.7);opacity:0}}
.lbr-rot{transform-origin:520px 400px;animation:lbr-rot 40s linear infinite}
.lbr-rotr{transform-origin:520px 400px;animation:lbr-rot 26s linear infinite reverse}
@keyframes lbr-rot{to{transform:rotate(360deg)}}
.lbr-blink{animation:lbr-blink 1.3s ease-in-out infinite}
@keyframes lbr-blink{50%{opacity:.25}}
.lbr-core{animation:lbr-breathe 2.8s ease-in-out infinite}
@keyframes lbr-breathe{50%{box-shadow:0 0 34px rgba(217,70,239,.55),0 0 80px rgba(56,189,248,.25)}}
.lbr-burst{position:absolute;left:0;top:0;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;offset-rotate:0deg;animation:lbr-travel 1.5s cubic-bezier(.4,.1,.3,1) forwards;pointer-events:none}
@keyframes lbr-travel{0%{offset-distance:0%;opacity:0;transform:scale(.6)}12%{opacity:1;transform:scale(1.25)}100%{offset-distance:100%;opacity:.15;transform:scale(.8)}}
.lbr-mod{transition:transform .2s, box-shadow .25s, border-color .2s}
.lbr-mod:hover{transform:translateY(-2px);border-color:#7DD3FC}
.lbr-mod.sel{border-color:#E879F9;box-shadow:0 0 0 1px #E879F9,0 0 28px rgba(232,121,249,.45)}
.lbr-mod.hit{box-shadow:0 0 0 1px #F5D0FE,0 0 34px rgba(245,208,254,.6)}
.lbr-step.on{border-color:#E879F9!important;background:#1A0F2E;box-shadow:0 0 22px rgba(232,121,249,.35)}
.lbr-evt-new{animation:lbr-evtin 1.2s ease-out}
@keyframes lbr-evtin{from{background:#1B2547}to{background:transparent}}
.lbr-still .lbr-flow-in,.lbr-still .lbr-flow-out,.lbr-still .lbr-flow-x,.lbr-still .lbr-halo,.lbr-still .lbr-halo2,.lbr-still .lbr-rot,.lbr-still .lbr-rotr,.lbr-still .lbr-blink,.lbr-still .lbr-core{animation:none}
@media (prefers-reduced-motion: reduce){.lbr-flow-in,.lbr-flow-out,.lbr-flow-x,.lbr-halo,.lbr-halo2,.lbr-rot,.lbr-rotr,.lbr-core{animation:none}}
`;

export const LiveBrainRoom: React.FC = () => {
  const { currentUser } = useApp();
  const isOwner = currentUser?.role === 'owner';
  const [data, setData] = useState<any>(null);
  const [events, setEvents] = useState<LiveEvt[]>([]);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [hits, setHits] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<ModKey>('platforms');
  const [motion, setMotion] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const lastIdRef = useRef(0);
  const burstSeq = useRef(0);
  const firstLoad = useRef(true);

  const ingest = useCallback((incoming: LiveEvt[]) => {
    if (!incoming.length) return;
    setEvents((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      const add = incoming.filter((e) => !seen.has(e.id));
      return [...add.reverse(), ...prev].slice(0, 40);
    });
    if (firstLoad.current) return; // التحميل الأول: تاريخ قريب بلا نبضات (لا مبالغة في الحركة)
    setFreshIds(new Set(incoming.map((e) => e.id)));
    const t = Date.now();
    const newBursts: Burst[] = [];
    const hitUpd: Record<string, number> = {};
    for (const e of incoming.slice(-8)) {
      const m = MOD_BY_KEY[e.module];
      if (!m) continue;
      hitUpd[m.key] = t;
      newBursts.push({ id: ++burstSeq.current, module: m.key, color: LEVEL_COLOR[e.level] || m.color, path: m.dir === 'in' ? pathIn(m) : pathOut(m) });
    }
    if (newBursts.length) {
      setBursts((b) => [...b, ...newBursts].slice(-14));
      setHits((h) => ({ ...h, ...hitUpd }));
      const ids = new Set(newBursts.map((b) => b.id));
      window.setTimeout(() => setBursts((b) => b.filter((x) => !ids.has(x.id))), 1700);
      const lastMod = incoming[incoming.length - 1]?.module;
      const idx = JOURNEY.findIndex((j) => j.mods.includes(lastMod));
      if (idx >= 0) setActiveStep(idx);
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const r = await apiService.getLiveRoom(lastIdRef.current);
      setData(r);
      ingest(Array.isArray(r.events) ? r.events : []);
      if (typeof r.lastEventId === 'number') lastIdRef.current = r.lastEventId;
      firstLoad.current = false;
      setError(null);
      setLastOkAt(Date.now());
    } catch (e: any) {
      setError(e?.message || 'انقطاع مؤقت');
    }
  }, [ingest]);

  useEffect(() => {
    if (!isOwner) return;
    void poll();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void poll(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [isOwner, poll]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const modules = data?.modules || {};
  const sel = MOD_BY_KEY[selected];
  const selView = modules[selected];
  const coreLine = CORE_FNS[Math.floor(now / 2200) % CORE_FNS.length];
  const hitActive = (k: string) => Boolean(hits[k] && now - hits[k] < 1600);
  const journeyIdx = activeStep ?? (Math.floor(now / 2600) % JOURNEY.length);

  const pulseRows = useMemo(() => {
    const p = data?.pulse || {};
    const cad = (ms: number | null | undefined) => (ms ? `كل ${Math.round(ms / 60000)} د` : '');
    return [
      { name: 'مراقب يوتيوب', value: `${p.youtube?.cycles ?? '—'} دورة · ${ago(p.youtube?.lastAt, now)}`, sub: cad(p.youtube?.cadenceMs), color: '#F43F5E' },
      { name: 'مراقب فيسبوك/إنستغرام', value: `${p.meta?.cycles ?? '—'} دورة · ${ago(p.meta?.lastAt, now)}`, sub: cad(p.meta?.cadenceMs), color: '#60A5FA' },
      { name: 'العقل المركزي', value: `${p.brain?.cycles ?? '—'} دورة · ${ago(p.brain?.lastAt, now)}`, sub: 'كل 15 د', color: '#A78BFA' },
      { name: 'العقل التجاري', value: ago(p.commercial?.lastAt, now), sub: 'كل 10 د', color: '#E879F9' },
      { name: 'مزامنة الأرقام', value: ago(p.metrics?.lastAt, now), sub: 'كل 6 س', color: '#22D3EE' },
      { name: 'النسخ الاحتياطي', value: ago(p.backup?.lastAt, now), sub: p.backup?.level === 'ok' ? 'حديثة' : p.backup?.level ? 'متأخرة' : '', color: p.backup?.level === 'ok' ? '#34D399' : '#FBBF24' },
    ];
  }, [data, now]);

  if (!isOwner) {
    return <div className="p-8 rounded-2xl glass text-center text-slate-300">غرفة العقل الحية مخصصة لمالك النظام فقط.</div>;
  }

  const panel: React.CSSProperties = { border: '1px solid #172042', borderRadius: 16, background: 'rgba(8,11,28,.8)', padding: 14 };

  return (
    <div dir="rtl" className={motion ? '' : 'lbr-still'} style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 30%, #0E1230 0%, #05070F 70%)', color: '#E7ECF8', borderRadius: 20, border: '1px solid #172042', overflow: 'hidden' }}>
      <style>{CSS}</style>

      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderBottom: '1px solid #172042', background: 'rgba(6,9,22,.85)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <svg width="40" height="40" viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="#E879F9" strokeWidth="1.8" strokeLinecap="round"><ellipse cx="24" cy="27" rx="7" ry="8" /><circle cx="24" cy="15" r="4" /><path d="M17 23 L8 15 L4 18 M17 27 L5 27 L2 31 M17 31 L8 39 L5 44 M31 23 L40 15 L44 18 M31 27 L43 27 L46 31 M31 31 L40 39 L43 44" /></g></svg>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}><span style={{ color: '#E879F9' }}>الغرابي</span> AI — غرفة العقل الحية</h1>
            <div style={{ fontSize: 12, color: '#93A1C3' }}>المخطط الهندسي للمشروع كما يجري الآن — يراقب · يفهم · يقرر · يرد · يتعلّم</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, border: `1px solid ${error ? '#7A1F3A' : '#1E6B55'}`, color: error ? '#FDA4AF' : '#6EE7B7' }}>
            <span className="lbr-blink" style={{ width: 8, height: 8, borderRadius: '50%', background: error ? '#F87171' : '#34D399' }} />
            {error ? 'انقطاع مؤقت — إعادة المحاولة' : data ? `بث حي · ${ago(lastOkAt ? new Date(lastOkAt).toISOString() : null, now)}` : 'جارٍ الاتصال…'}
          </span>
          {modules.gate && (
            <span style={{ padding: '7px 12px', borderRadius: 999, border: '1px solid #6B4A12', color: '#FCD34D' }}>{modules.gate.metric}</span>
          )}
          {modules.automation && modules.automation.status !== 'ok' && (
            <span style={{ padding: '7px 12px', borderRadius: 999, border: '1px solid #7A1F3A', color: '#FDA4AF' }}>{modules.automation.metric}</span>
          )}
          <span className="lbr-mono" style={{ padding: '7px 12px', borderRadius: 999, border: '1px solid #172042' }}>{clock(new Date(now).toISOString())} بغداد</span>
          <button type="button" onClick={() => setMotion((m) => !m)} style={{ padding: '7px 14px', minHeight: 34, borderRadius: 999, border: '1px solid #2B3A66', background: '#0F1630', color: '#E7ECF8', cursor: 'pointer' }}>{motion ? 'إيقاف الحركة' : 'تشغيل الحركة'}</button>
        </div>
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: 16 }}>
        <main style={{ flex: '999 1 720px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section aria-label="المخطط الحي" style={{ ...panel, padding: 12, borderRadius: 18 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, padding: '2px 6px 8px' }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>المخطط الهندسي الحي — 13 قسماً حول العقل المركزي</h2>
              <span style={{ fontSize: 11, color: '#93A1C3' }}>كل نبضة ضوئية = حدث حقيقي وقع الآن · اضغط أي قسم لتفاصيله</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ position: 'relative', width: 1040, height: 800, margin: '0 auto' }}>
                <svg width="1040" height="800" viewBox="0 0 1040 800" style={{ position: 'absolute', inset: 0 }} role="img" aria-label="تدفق البيانات بين أقسام المشروع والعقل المركزي">
                  <defs>
                    <radialGradient id="lbrCore" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#D946EF" stopOpacity=".55" /><stop offset="55%" stopColor="#6366F1" stopOpacity=".18" /><stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" /></radialGradient>
                  </defs>
                  <circle cx="520" cy="400" r="260" fill="url(#lbrCore)" />
                  <g className="lbr-rot"><ellipse cx="520" cy="400" rx="300" ry="226" fill="none" stroke="#1B2550" strokeDasharray="1 9" /></g>
                  <g className="lbr-rotr"><circle cx="520" cy="400" r="128" fill="none" stroke="#3B2A7A" strokeDasharray="14 6 2 6" /></g>
                  <circle cx="520" cy="400" r="96" fill="none" stroke="#5B21B6" strokeOpacity=".6" strokeWidth="1.2" />
                  {MODS.map((m) => {
                    const st: Status = modules[m.key]?.status || 'partial';
                    return (
                      <path key={m.key} d={pathIn(m)} fill="none" strokeWidth={st === 'off' ? 1 : 1.6} strokeLinecap="round"
                        stroke={st === 'off' ? '#3B2030' : m.color} strokeOpacity={st === 'off' ? 0.7 : 0.9}
                        className={st === 'off' ? undefined : m.dir === 'in' ? 'lbr-flow-in' : 'lbr-flow-out'} strokeDasharray={st === 'off' ? '3 7' : undefined} />
                    );
                  })}
                  {CROSS.map(([a, b]) => <path key={a + b} d={crossPath(MOD_BY_KEY[a], MOD_BY_KEY[b])} fill="none" stroke="#4B5B95" strokeWidth="1" className="lbr-flow-x" />)}
                  {motion && MODS.filter((m) => (modules[m.key]?.status || 'partial') !== 'off').map((m, i) => (
                    <circle key={'amb' + m.key} r="3" fill={m.color} opacity=".85">
                      <animateMotion dur={`${2.2 + (i % 5) * 0.3}s`} begin={`${(i * 0.37) % 2}s`} repeatCount="indefinite" path={m.dir === 'in' ? pathIn(m) : pathOut(m)} />
                    </circle>
                  ))}
                  <circle cx="520" cy="400" r="80" fill="none" stroke="#E879F9" strokeWidth="2" className="lbr-halo" />
                  <circle cx="520" cy="400" r="80" fill="none" stroke="#38BDF8" strokeWidth="1.4" className="lbr-halo2" />
                </svg>

                {motion && bursts.map((b) => (
                  <span key={b.id} className="lbr-burst" style={{ offsetPath: `path('${b.path}')`, background: b.color, boxShadow: `0 0 14px ${b.color}, 0 0 28px ${b.color}` } as React.CSSProperties} />
                ))}

                <div className="lbr-core" style={{ position: 'absolute', left: 430, top: 310, width: 180, height: 180, borderRadius: '50%', border: '2px solid #E879F9', background: 'radial-gradient(circle at 50% 40%, #2A0F45 0%, #0B0820 75%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, textAlign: 'center', boxShadow: '0 0 26px rgba(217,70,239,.4), 0 0 60px rgba(56,189,248,.15)' }}>
                  <svg width="50" height="50" viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="#F0ABFC" strokeWidth="1.8" strokeLinecap="round"><ellipse cx="24" cy="27" rx="7" ry="8" /><circle cx="24" cy="15" r="4" /><path d="M17 23 L8 15 L4 18 M17 27 L5 27 L2 31 M17 31 L8 39 L5 44 M31 23 L40 15 L44 18 M31 27 L43 27 L46 31 M31 31 L40 39 L43 44" /></g></svg>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>العقل المركزي</div>
                  <div style={{ fontSize: 11, color: '#D8B4FE' }}>والمنسّق التنفيذي</div>
                  <div className="lbr-mono" style={{ fontSize: 10, color: '#93A1C3' }}>{coreLine}</div>
                  {modules.core && <div className="lbr-mono" style={{ fontSize: 10, color: '#C4B5FD' }}>{modules.core.metric}</div>}
                </div>

                {MODS.map((m) => {
                  const v = modules[m.key];
                  const st: Status = v?.status || 'partial';
                  const cls = 'lbr-mod' + (selected === m.key ? ' sel' : '') + (hitActive(m.key) ? ' hit' : '');
                  return (
                    <button key={m.key} type="button" className={cls} onClick={() => setSelected(m.key)} aria-label={`عرض قسم ${m.title}`}
                      style={{ position: 'absolute', left: m.x - 88, top: m.y - 35, width: 176, minHeight: 70, padding: '8px 10px', borderRadius: 14, border: '1px solid #22305E', background: 'rgba(10,15,36,.92)', color: '#E7ECF8', textAlign: 'right', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%' }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{m.title}</span>
                        <span style={{ width: 9, height: 9, flex: 'none', borderRadius: '50%', background: STATUS_COLOR[st], boxShadow: `0 0 8px ${STATUS_COLOR[st]}` }} />
                      </span>
                      <span className="lbr-mono" style={{ fontSize: 10, color: '#93A1C3' }}>{m.en}</span>
                      <span style={{ fontSize: 11, color: st === 'ok' ? '#B6C2DE' : STATUS_COLOR[st] }}>{v?.metric || '…'}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 10, border: '1px solid #3B2A7A', borderRadius: 14, background: 'linear-gradient(90deg, #120A2A, #0A1026)', padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: 18 }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontSize: 11, color: '#C4B5FD' }}>القسم المحدد</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{sel.title}</div>
                <div className="lbr-mono" style={{ fontSize: 11, color: '#93A1C3' }}>{sel.en}</div>
                {selView && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, color: STATUS_COLOR[selView.status] }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[selView.status] }} />{STATUS_TEXT[selView.status]} — {selView.metric}
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {sel.parts.map((p) => <span key={p} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, border: '1px solid #2B3A66', color: '#C9D3EA' }}>{p}</span>)}
                </div>
              </div>
              <div style={{ flex: '2 1 320px', minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                {(selView?.items || []).map((it: any) => (
                  <div key={it.name} style={{ padding: '8px 10px', border: '1px solid #1F2A55', borderRadius: 10, background: 'rgba(8,12,30,.8)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{it.name}</div>
                    <div style={{ fontSize: 11, color: STATUS_COLOR[it.status] || '#93A1C3' }}>{it.value}</div>
                  </div>
                ))}
                {!selView && <div style={{ fontSize: 12, color: '#93A1C3' }}>جارٍ جلب الحالة الحقيقية…</div>}
              </div>
            </div>
          </section>

          <section aria-label="السير العام" style={{ ...panel, borderRadius: 18 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600 }}>السير العام — من المحتوى إلى التعلّم <span style={{ fontSize: 11, color: '#93A1C3', fontWeight: 400 }}>(تضيء الخطوة التي وقع فيها آخر حدث)</span></h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              {JOURNEY.map((j, i) => (
                <div key={j.title} className={'lbr-step' + (i === journeyIdx ? ' on' : '')} style={{ padding: '10px 12px', border: '1px solid #1F2A55', borderRadius: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span className="lbr-mono" style={{ width: 26, height: 26, flex: 'none', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: j.badge, color: '#05070F' }}>{i + 1}</span>
                  <div><div style={{ fontSize: 13, fontWeight: 600 }}>{j.title}</div><div style={{ fontSize: 11, color: '#93A1C3' }}>{j.detail}</div></div>
                </div>
              ))}
            </div>
          </section>
        </main>

        <aside aria-label="اللوحات الحية" style={{ flex: '1 1 300px', maxWidth: 380, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>آخر الأحداث</h2>
              <span className="lbr-blink" style={{ fontSize: 11, color: '#6EE7B7' }}>● مباشر</span>
            </div>
            {events.length === 0 && <div style={{ fontSize: 12, color: '#93A1C3', padding: '8px 0' }}>{data ? 'لم يقع حدث منذ إقلاع الخادم بعد — سيظهر هنا لحظة وقوعه.' : 'جارٍ الاتصال بالخادم…'}</div>}
            <div style={{ maxHeight: 520, overflowY: 'auto' }}>
              {events.slice(0, 25).map((e) => (
                <div key={e.id} className={freshIds.has(e.id) ? 'lbr-evt-new' : ''} style={{ display: 'flex', gap: 10, padding: '8px 6px', borderBottom: '1px solid #10172F', borderRadius: 6 }}>
                  <span style={{ width: 10, height: 10, marginTop: 5, flex: 'none', borderRadius: '50%', background: LEVEL_COLOR[e.level] || '#93A1C3', boxShadow: `0 0 8px ${LEVEL_COLOR[e.level] || '#93A1C3'}` }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{e.title}</div>
                    {e.text && <div style={{ fontSize: 11, color: '#93A1C3', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{e.text}</div>}
                    <div style={{ fontSize: 10, color: '#6B7AA0' }}>{MOD_BY_KEY[e.module]?.title || 'العقل المركزي'}</div>
                  </div>
                  <span className="lbr-mono" style={{ fontSize: 10, color: '#93A1C3', flex: 'none' }}>{clock(e.at)}</span>
                </div>
              ))}
            </div>
          </section>

          <section style={panel}>
            <h2 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600 }}>حالة المنصات العشر</h2>
            {(data?.platforms || []).map((p: any) => {
              const c = p.connected ? (p.partial ? STATUS_COLOR.partial : STATUS_COLOR.ok) : STATUS_COLOR.off;
              const txt = p.connected ? (p.partial ? `متصل — ${p.partial}` : `متصل${typeof p.followers === 'number' ? ` · ${p.followers.toLocaleString('ar-IQ')}` : ''}`) : 'غير مربوط';
              return (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #10172F', fontSize: 12 }}>
                  <span>{PLATFORM_AR[p.id] || p.id}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: c, textAlign: 'left' }}><span style={{ width: 8, height: 8, flex: 'none', borderRadius: '50%', background: c }} />{txt}</span>
                </div>
              );
            })}
          </section>

          <section style={panel}>
            <h2 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600 }}>المراقبة — نبض 24/7</h2>
            {pulseRows.map((c) => (
              <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #10172F', fontSize: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="lbr-blink" style={{ width: 7, height: 7, borderRadius: '50%', background: c.color }} />{c.name}{c.sub && <span style={{ color: '#6B7AA0', fontSize: 10 }}>{c.sub}</span>}</span>
                <span className="lbr-mono" style={{ fontSize: 11, color: '#C9D3EA' }}>{c.value}</span>
              </div>
            ))}
          </section>

          <section style={{ ...panel, fontSize: 12 }}>
            <div style={{ color: '#93A1C3', marginBottom: 8 }}>مفتاح الحالة</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: STATUS_COLOR.ok }} />يعمل ومُثبت</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: STATUS_COLOR.partial }} />جزئي / ينقصه إجراء</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: STATUS_COLOR.off }} />متوقف</span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};
