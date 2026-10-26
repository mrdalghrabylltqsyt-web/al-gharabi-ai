import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { apiService } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { LiveAlertStrip, LiveControlCenter } from './LiveControlCenter';
import { SpiderPatrol, SPIDER_CSS } from './SpiderPatrol';
import { getSoundtrack, SOUND_MODES, type SoundMode, type SoundState, type PingLevel } from './liveSoundtrack';

/**
 * غرفة العقل الحية — الإصدار 2 (2026-10-25).
 *
 * المخطط الهندسي للمشروع حيّاً: العقل المركزي والأقسام الثلاثة عشر بخطوط طاقة متوهجة،
 * العقول الستة تدور حول العقل، نبضة ضوئية لكل حدث حقيقي، نبض نشاط حقيقي (آخر 5 دقائق)،
 * رؤى الزبائن والنشر (24 ساعة، النوايا، المواضيع، أكثر المنتجات سؤالاً)، ومقاييس الخادم
 * الحيّة (الذاكرة، تأخّر الحلقة، Gemini، ضغط الخطة، الكتابات الموفّرة).
 * كل رقم من `/api/live/room` (للمالك) — لا أرقام ثابتة. التحديث كل 4 ثوانٍ أثناء الفتح.
 */

type Status = 'ok' | 'partial' | 'off';
type ModKey = 'owner' | 'auth' | 'agents' | 'platforms' | 'external' | 'gate' | 'automation' | 'backup' | 'monitor' | 'storage' | 'memory' | 'products' | 'customers';

interface ModMeta {
  key: ModKey; title: string; en: string; x: number; y: number; mx: number; my: number; ex: number; ey: number;
  color: string; dir: 'in' | 'out'; parts: string[];
}

const W = 1040, H = 800, CX = 520, CY = 400;
const MODS: ModMeta[] = [
  { key: 'owner', title: 'المالك والمستخدم', en: 'OWNER · UI', x: 520, y: 78, mx: 488, my: 223, ex: 520, ey: 339, color: '#F0ABFC', dir: 'in', parts: ['إنشاء/رفع محتوى', 'اختيار المنصات', 'جدولة النشر', 'مراجعة الردود', 'متابعة النتائج'] },
  { key: 'auth', title: 'المصادقة والأمان', en: 'AUTH · SECURITY', x: 720, y: 115, mx: 601, my: 223, ex: 558, ey: 346, color: '#38BDF8', dir: 'in', parts: ['تحدّي بريد المالك', 'جلسات HMAC', 'RBAC', 'requireOwner', 'حماية واجهات API'] },
  { key: 'agents', title: 'العقول المتخصصة', en: 'SIX-AGENT COUNCIL', x: 874, y: 217, mx: 696, my: 264, ex: 587, ey: 365, color: '#E879F9', dir: 'out', parts: ['الإدراك والمعرفة', 'الجمهور والطلب', 'الاستراتيجية والقرار', 'العروض والمبيعات', 'التعلّم والتوقيت'] },
  { key: 'platforms', title: 'النشر والمنصات', en: 'UNIFIED PUBLISHING', x: 947, y: 361, mx: 751, my: 336, ex: 601, ey: 393, color: '#60A5FA', dir: 'in', parts: ['فيسبوك', 'إنستغرام', 'تيك توك', 'يوتيوب', 'تيليغرام', 'ثريدز', 'واتساب', 'X', 'سناب', 'Google Business'] },
  { key: 'external', title: 'الخدمات الخارجية', en: 'EXTERNAL APIS', x: 922, y: 514, mx: 753, my: 423, ex: 596, ey: 422, color: '#FBBF24', dir: 'in', parts: ['Google (Drive)', 'Gemini AI', 'Meta Graph', 'TikTok API', 'YouTube API', 'Telegram Bot API'] },
  { key: 'gate', title: 'بوابة الصلاحيات', en: 'APPROVAL GATE', x: 805, y: 641, mx: 701, my: 504, ex: 574, ey: 446, color: '#F472B6', dir: 'out', parts: ['سياسة التشغيل', 'مراجعة المحتوى', 'حجب غير الموثّق', 'EXTERNAL_ACTION', 'سجل الموافقات'] },
  { key: 'automation', title: 'محرك الأتمتة', en: 'AUTOMATION', x: 623, y: 713, mx: 608, my: 562, ex: 540, ey: 459, color: '#A78BFA', dir: 'out', parts: ['جدولة المنشورات', 'مهام الخلفية', 'متابعة التنفيذ', 'إعادة المحاولة', 'منع التكرار'] },
  { key: 'backup', title: 'النسخ والتعافي', en: 'BACKUP · RECOVERY', x: 417, y: 713, mx: 495, my: 582, ex: 500, ey: 459, color: '#34D399', dir: 'out', parts: ['نسخ البيانات', 'نقاط الاستعادة', 'اختبار الاستعادة', 'تعافٍ معزول'] },
  { key: 'monitor', title: 'المراقبة والصحة', en: 'MONITORING', x: 235, y: 641, mx: 387, my: 561, ex: 466, ey: 446, color: '#22D3EE', dir: 'in', parts: ['/api/health', '/api/readiness', 'حالة الموصلات', 'تنبيهات المشاكل'] },
  { key: 'storage', title: 'التخزين الدائم', en: 'POSTGRES · NEON', x: 118, y: 514, mx: 310, my: 503, ex: 444, ey: 422, color: '#2DD4BF', dir: 'out', parts: ['gharabi_state', 'المنصات والمحتوى', 'التفاعلات والزبائن', 'المنتجات', 'سجل الأحداث'] },
  { key: 'memory', title: 'الذاكرة والتقارير', en: 'MEMORY · ANALYTICS', x: 93, y: 361, mx: 281, my: 421, ex: 439, ey: 393, color: '#C084FC', dir: 'in', parts: ['تخزين الأحداث', 'ذاكرة السياق', 'تحليل الأداء', 'استخراج المؤشرات', 'تقارير المالك'] },
  { key: 'products', title: 'مستودع المنتجات', en: 'PRODUCTS · KNOWLEDGE', x: 166, y: 217, mx: 307, my: 335, ex: 453, ey: 365, color: '#FB7185', dir: 'in', parts: ['الأسماء والتصنيفات', 'الأسعار والأقساط', 'التوفر', 'منع اختلاق البيانات'] },
  { key: 'customers', title: 'مركز الزبائن', en: 'CUSTOMER CENTER', x: 320, y: 115, mx: 382, my: 263, ex: 482, ey: 346, color: '#7DD3FC', dir: 'in', parts: ['جمع التعليقات', 'تحليل النية', 'الربط بالمنتج', 'الرد العراقي', 'المتابعات'] },
];
const MOD_BY_KEY: Record<string, ModMeta> = Object.fromEntries(MODS.map((m) => [m.key, m]));
const CROSS: Array<[ModKey, ModKey]> = [['platforms', 'external'], ['gate', 'automation'], ['backup', 'monitor'], ['storage', 'memory'], ['products', 'customers'], ['owner', 'auth']];
const AGENTS = ['الإدراك', 'الجمهور', 'الاستراتيجية', 'العروض', 'التعلّم', 'الناقد'];

const STATUS_COLOR: Record<string, string> = { ok: '#34D399', partial: '#FBBF24', off: '#F87171', neutral: '#93A1C3' };
const STATUS_TEXT: Record<string, string> = { ok: 'يعمل ومُثبت', partial: 'جزئي — ينقصه إجراء', off: 'متوقف' };
const LEVEL_COLOR: Record<string, string> = { ok: '#34D399', info: '#38BDF8', warn: '#FBBF24', error: '#F87171' };
const PLATFORM_AR: Record<string, string> = { facebook: 'فيسبوك', instagram: 'إنستغرام', youtube: 'يوتيوب', threads: 'ثريدز', tiktok: 'تيك توك', telegram: 'تيليغرام', whatsapp: 'واتساب للأعمال', x: 'X', snapchat: 'سناب شات', google_business: 'Google Business' };
const PLATFORM_COLOR: Record<string, string> = { facebook: '#3B82F6', instagram: '#E879F9', youtube: '#F43F5E', threads: '#A5B4FC', tiktok: '#22D3EE', telegram: '#38BDF8', whatsapp: '#34D399', x: '#E5E7EB', snapchat: '#FDE047', google_business: '#FBBF24' };
const INTENT_COLOR: Record<string, string> = { business_inquiry: '#E879F9', question: '#38BDF8', praise: '#34D399', complaint: '#F87171', spam: '#64748B', other: '#A78BFA' };
const STAGE_AR: Record<string, string> = { NEW: 'جديد', ENGAGED: 'متفاعل', QUALIFIED: 'مؤهّل', NEGOTIATING: 'تفاوض', PROPOSAL_PENDING: 'عرض بانتظارك', ESCALATED: 'مُصعَّد', WON: 'تمّ البيع', LOST: 'لم يتم' };
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
/** الاستطلاع الكامل (مع الرؤى الثقيلة) كل 30 ث؛ ما بينها خفيف (أحداث + حالة). */
const FULL_EVERY_MS = 30000;
/** البث يُعدّ متأخراً إن لم ينجح جلب منذ هذه المدة. */
const STALE_MS = 15000;
/** حارس الخطة المجانية: بين 00:00 و06:00 بغداد ينام الخادم؛ الشاشة الخاملة لا توقظه. */
const NIGHT_IDLE_MS = 10 * 60000;
// عدد الغرف المفتوحة (التبويب + الشاشة الحية): الموسيقى تتوقف حين تُغلق آخر غرفة.
let openRooms = 0;
const BUCKET_MS = 10000;
const BUCKETS = 30; // 5 دقائق
const RECENT_MS = 10 * 60000;

const pathIn = (m: ModMeta) => `M${m.x} ${m.y} Q${m.mx} ${m.my} ${m.ex} ${m.ey}`;
const pathOut = (m: ModMeta) => `M${m.ex} ${m.ey} Q${m.mx} ${m.my} ${m.x} ${m.y}`;
function crossPath(a: ModMeta, b: ModMeta): string {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = mx - CX, dy = my - CY; const L = Math.hypot(dx, dy) || 1;
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
  try { return new Date(iso).toLocaleTimeString('ar-IQ-u-nu-latn', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Baghdad' }); } catch { return ''; }
}
const fmt = (n: number) => { try { return Math.round(n).toLocaleString('en-US'); } catch { return String(Math.round(n)); } };

/** عدّاد يتصاعد بسلاسة نحو القيمة الحقيقية الجديدة. */
function useCountUp(target: number, ms = 900): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now(); const a = from.current; const b = Number.isFinite(target) ? target : 0;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms); const e = 1 - Math.pow(1 - k, 3);
      setV(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** مقاس الحاوية (عرض وارتفاع): لتصغير المخطط على الهاتف بدل قصّه، ولملاءمة الشاشة الحية. */
function useBox(ref: React.RefObject<HTMLDivElement>, init: { w: number; h: number }): { w: number; h: number } {
  const [box, setBox] = useState(init);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const update = () => {
      const w = el.clientWidth || init.w, h = el.clientHeight || init.h;
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => { ro?.disconnect(); window.removeEventListener('resize', update); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  return box;
}

function sparkPath(vals: number[], w: number, h: number): { line: string; area: string } {
  if (!vals.length) return { line: '', area: '' };
  const max = Math.max(1, ...vals);
  const step = vals.length > 1 ? w / (vals.length - 1) : w;
  const pts = vals.map((v, i) => [i * step, h - 2 - (v / max) * (h - 6)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return { line, area: `${line} L${w} ${h} L0 ${h} Z` };
}

interface LiveEvt { id: number; at: string; module: string; level: string; title: string; text: string }
interface Burst { id: number; color: string; path: string }

const CSS = `
.lbr{--glass:rgba(9,13,32,.78)}
.lbr-mono{font-family:'JetBrains Mono',ui-monospace,monospace;letter-spacing:.02em}
.lbr-stars{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(1px 1px at 12% 18%,#fff8,transparent),radial-gradient(1px 1px at 72% 34%,#fff6,transparent),radial-gradient(1.5px 1.5px at 38% 72%,#c4b5fd99,transparent),radial-gradient(1px 1px at 88% 82%,#7dd3fc88,transparent),radial-gradient(1px 1px at 22% 58%,#fff5,transparent),radial-gradient(1.5px 1.5px at 58% 12%,#f0abfc88,transparent),radial-gradient(1px 1px at 8% 92%,#fff4,transparent),radial-gradient(1px 1px at 94% 8%,#fff6,transparent);background-size:340px 340px;animation:lbr-drift 120s linear infinite;opacity:.8;inset:-340px 0 0 -340px;will-change:transform}
@keyframes lbr-drift{to{transform:translate3d(340px,340px,0)}}
.lbr-grid{position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(99,102,241,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,.07) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(ellipse 70% 60% at 50% 45%,#000 30%,transparent 80%)}
.lbr-scan{position:absolute;left:0;right:0;height:120px;top:-120px;pointer-events:none;will-change:transform;background:linear-gradient(180deg,transparent,rgba(232,121,249,.06),transparent);animation:lbr-scan 7s linear infinite}
@keyframes lbr-scan{to{transform:translateY(1100px)}}
.lbr-flow-in{stroke-dasharray:3 13;animation:lbr-dash 1.2s linear infinite}
.lbr-flow-out{stroke-dasharray:3 13;animation:lbr-dash 1.6s linear infinite reverse}
.lbr-flow-x{stroke-dasharray:2 8;animation:lbr-dash 2.6s linear infinite}
@keyframes lbr-dash{to{stroke-dashoffset:-32}}
.lbr-halo{transform-origin:520px 400px;animation:lbr-halo 3.2s ease-out infinite}
.lbr-halo2{transform-origin:520px 400px;animation:lbr-halo 3.2s ease-out 1.6s infinite}
@keyframes lbr-halo{0%{transform:scale(.75);opacity:.9}100%{transform:scale(1.9);opacity:0}}
.lbr-ring{position:absolute;left:0;top:0;width:1040px;height:800px;pointer-events:none;will-change:transform}
.lbr-rot{transform-origin:520px 400px;animation:lbr-rot 60s linear infinite}
.lbr-rot2{transform-origin:520px 400px;animation:lbr-rot 30s linear infinite reverse}
.lbr-rot3{transform-origin:520px 400px;animation:lbr-rot 18s linear infinite}
.lbr-orbit{transform-origin:520px 400px;animation:lbr-rot 22s linear infinite}
.lbr-counter{animation:lbr-rot 22s linear infinite reverse}
@keyframes lbr-rot{to{transform:rotate(360deg)}}
.lbr-radar{position:absolute;left:300px;top:180px;width:440px;height:440px;border-radius:50%;background:conic-gradient(from 0deg,rgba(232,121,249,.0) 0deg,rgba(232,121,249,.0) 300deg,rgba(232,121,249,.22) 350deg,rgba(125,211,252,.35) 360deg);animation:lbr-rot 6s linear infinite;mask-image:radial-gradient(circle,#000 0 60%,transparent 70%);pointer-events:none;will-change:transform}
.lbr-blink{animation:lbr-blink 1.3s ease-in-out infinite;will-change:opacity}
@keyframes lbr-blink{50%{opacity:.25}}
.lbr-core{box-shadow:0 0 30px rgba(217,70,239,.45),0 0 70px rgba(99,102,241,.25),inset 0 0 30px rgba(217,70,239,.25)}
.lbr-core::before{content:"";position:absolute;inset:-2px;border-radius:50%;box-shadow:0 0 50px rgba(217,70,239,.75),0 0 120px rgba(56,189,248,.35),inset 0 0 44px rgba(56,189,248,.3);opacity:0;animation:lbr-glowp 2.6s ease-in-out infinite;pointer-events:none;will-change:opacity}
@keyframes lbr-glowp{50%{opacity:1}}
.lbr-burst{position:absolute;left:0;top:0;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;offset-rotate:0deg;animation:lbr-travel 1.4s cubic-bezier(.4,.1,.3,1) forwards;pointer-events:none;mix-blend-mode:screen}
@keyframes lbr-travel{0%{offset-distance:0%;opacity:0;transform:scale(.5)}10%{opacity:1;transform:scale(1.4)}100%{offset-distance:100%;opacity:.1;transform:scale(.7)}}
.lbr-mod{backdrop-filter:blur(6px);transition:transform .25s, box-shadow .3s, border-color .2s}
.lbr-mod:hover{transform:translateY(-3px) scale(1.02)}
.lbr-mod.sel{border-color:#F0ABFC!important;box-shadow:0 0 0 1px #F0ABFC,0 0 32px rgba(240,171,252,.55)!important}
.lbr-mod.hit{animation:lbr-hit 1.4s ease-out}
@keyframes lbr-hit{0%{box-shadow:0 0 0 2px #fff,0 0 60px rgba(255,255,255,.8)}100%{box-shadow:0 0 0 1px transparent,0 0 0 transparent}}
.lbr-step.on{border-color:#E879F9!important;background:linear-gradient(135deg,#2A0F45,#0A1026)!important;box-shadow:0 0 26px rgba(232,121,249,.45)}
.lbr-evt-new{animation:lbr-evtin 1.4s ease-out}
@keyframes lbr-evtin{from{background:rgba(232,121,249,.22);transform:translateX(-6px)}to{background:transparent;transform:none}}
.lbr-panel{position:relative;border:1px solid rgba(99,102,241,.22);border-radius:18px;background:var(--glass);padding:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 10px 40px rgba(0,0,0,.35)}
.lbr-panel:before{content:"";position:absolute;inset:-1px;border-radius:18px;padding:1px;background:linear-gradient(135deg,rgba(232,121,249,.45),transparent 35%,transparent 65%,rgba(56,189,248,.45));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.lbr-h{margin:0;font-size:14px;font-weight:700;letter-spacing:.2px;display:flex;align-items:center;gap:8px}
.lbr-h:before{content:"";width:6px;height:6px;border-radius:2px;background:#E879F9;box-shadow:0 0 10px #E879F9}
.lbr-kpi .v{font-size:30px;font-weight:700;text-shadow:0 0 18px currentColor}
.lbr-ticker{animation:lbr-tick 40s linear infinite}
.lbr-ticker:hover{animation-play-state:paused}
@keyframes lbr-tick{from{transform:translateY(0)}to{transform:translateY(-50%)}}
.lbr-bar{transition:height .8s cubic-bezier(.2,.8,.2,1),width .8s cubic-bezier(.2,.8,.2,1)}
.lbr-heart{stroke-dasharray:6 400;animation:lbr-heart 2.4s linear infinite}
@keyframes lbr-heart{from{stroke-dashoffset:406}to{stroke-dashoffset:0}}
.lbr-still .lbr-stars,.lbr-still .lbr-scan,.lbr-still .lbr-flow-in,.lbr-still .lbr-flow-out,.lbr-still .lbr-flow-x,.lbr-still .lbr-halo,.lbr-still .lbr-halo2,.lbr-still .lbr-rot,.lbr-still .lbr-rot2,.lbr-still .lbr-rot3,.lbr-still .lbr-orbit,.lbr-still .lbr-counter,.lbr-still .lbr-radar,.lbr-still .lbr-blink,.lbr-still .lbr-core::before,.lbr-still .lbr-ticker,.lbr-still .lbr-heart{animation:none}
.lbr-wallgrid{flex:1 1 0;min-height:0;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1.5fr) minmax(0,.85fr) minmax(0,.85fr) minmax(0,.9fr);gap:10px;padding:0 12px}
.lbr-col{display:flex;flex-direction:column;gap:10px;min-height:0;min-width:0;overflow:hidden}
.lbr-col>*{flex-shrink:0}
.lbr-wall .lbr-panel{padding:10px 12px}
.lbr-wall .lbr-kpi{padding:8px 12px!important}
.lbr-wall .lbr-kpi .v{font-size:28px}
.lbr-sel-wall>div{margin-top:8px!important;padding:10px 12px!important}
.lbr-wall .lbr-gauges svg{width:78px;height:78px}
.lbr-wall .lbr-step>span:first-child{width:30px!important;height:30px!important;font-size:14px!important}
.lbr-wall .lbr-step{align-items:center!important}
.lbr-wall .lbr-h{font-size:15px}
.lbr-wall .lbr-h:before{width:8px;height:8px}
.lbr-wall .lbr-gauges>div>div{font-size:10.5px!important}
.lbr-wall .lbr-col ::-webkit-scrollbar{width:6px}
.lbr-wall .lbr-col ::-webkit-scrollbar-thumb{background:#2B3A66;border-radius:6px}
.lbr-core{transition:transform .17s cubic-bezier(.2,.8,.2,1),filter .17s}
.lbr-core.lbr-thump{transform:scale(1.07);filter:brightness(1.35) saturate(1.2)}
.lbr-snd{display:inline-flex;align-items:center;gap:6px;padding:3px 6px 3px 4px;border-radius:999px;border:1px solid #2B3A66;background:#0F1630}
.lbr-snd.on{border-color:#E879F9;box-shadow:0 0 16px rgba(232,121,249,.35)}
.lbr-snd-btn{display:inline-flex;align-items:center;gap:7px;padding:5px 12px;min-height:30px;border-radius:999px;border:0;background:linear-gradient(135deg,#3B0D4F,#140B30);color:#FDF4FF;font-weight:700;cursor:pointer}
.lbr-snd select{background:#0B1028;color:#E7ECF8;border:1px solid #1E2A5E;border-radius:999px;padding:4px 8px;font-size:12px;cursor:pointer}
.lbr-snd input[type=range]{width:78px;accent-color:#E879F9;cursor:pointer}
.lbr-eq{display:inline-flex;align-items:flex-end;gap:2px;height:14px}
.lbr-eq i{display:block;width:3px;height:4px;border-radius:2px;background:#F0ABFC}
.lbr-snd.on .lbr-eq i{animation:lbr-eq .9s ease-in-out infinite}
.lbr-snd.on .lbr-eq i:nth-child(2){animation-delay:-.3s}.lbr-snd.on .lbr-eq i:nth-child(3){animation-delay:-.6s}.lbr-snd.on .lbr-eq i:nth-child(4){animation-delay:-.45s}
@keyframes lbr-eq{0%,100%{height:3px}50%{height:14px}}
.lbr-spider{position:absolute;left:0;top:0;width:72px;height:72px;margin:-36px 0 0 -36px;offset-rotate:auto 90deg;offset-distance:0%;transition:offset-distance 1.7s cubic-bezier(.45,.05,.3,1),opacity .3s;z-index:6;filter:drop-shadow(0 0 10px #FBBF24) drop-shadow(0 0 22px rgba(251,191,36,.6));pointer-events:none}
.lbr-spider.out,.lbr-spider.work{offset-distance:100%}
.lbr-spider.back{offset-distance:0%}
.lbr-spider .lbr-legs{animation:lbr-walk .28s ease-in-out infinite alternate;transform-origin:24px 27px}
.lbr-spider.work .lbr-legs{animation-duration:.12s}
@keyframes lbr-walk{from{transform:scaleX(.9)}to{transform:scaleX(1.1)}}
.lbr-wrench{position:absolute;top:-16px;left:48px;font-size:28px;animation:lbr-hammer .4s ease-in-out infinite alternate;transform-origin:bottom left}
@keyframes lbr-hammer{from{transform:rotate(-30deg)}to{transform:rotate(25deg)}}
.lbr-mod.fixing{border-color:#FBBF24!important;box-shadow:0 0 0 2px #FBBF24,0 0 34px rgba(251,191,36,.65)!important;animation:lbr-fix 0.9s ease-in-out infinite}
@keyframes lbr-fix{50%{box-shadow:0 0 0 1px #FDE68A,0 0 14px rgba(251,191,36,.35)}}
.lbr-eng-btn{padding:4px 10px;border-radius:999px;border:1px solid #2B3A66;background:#0F1630;color:#E7ECF8;font-size:11.5px;font-weight:700;cursor:pointer}
.lbr-eng-btn:disabled{opacity:.5;cursor:wait}
.lbr-eng-now{padding:8px 10px;border-radius:12px;border:1px solid rgba(52,211,153,.35);background:rgba(6,78,59,.18);font-size:12.5px;line-height:1.6}
.lbr-eng-now.busy{border-color:#FBBF24;background:rgba(120,80,10,.25);animation:lbr-fix 1.4s ease-in-out infinite}
.lbr-eng-stat{text-align:center;font-size:10.5px;color:#93A1C3;padding:5px 2px;border-radius:10px;background:rgba(0,0,0,.25);border:1px solid #1B2550}
.lbr-eng-stat span{display:block;font-size:17px;font-weight:800;font-family:'JetBrains Mono',ui-monospace,monospace}
.lbr-eng-rep{border:1px solid #1B2550;border-radius:10px;background:rgba(6,9,24,.6);padding:5px 8px}
.lbr-eng-rep summary{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;list-style:none}
.lbr-eng-rep summary::-webkit-details-marker{display:none}
.lbr-eng-badge{flex:none;font-size:10px;padding:1px 7px;border-radius:999px;border:1px solid}
.lbr-still .lbr-spider .lbr-legs,.lbr-still .lbr-wrench,.lbr-still .lbr-mod.fixing,.lbr-still .lbr-eng-now.busy{animation:none}
.lbr-patrol{width:64px;height:64px;margin:-32px 0 0 -32px;filter:drop-shadow(0 0 8px #34D399) drop-shadow(0 0 18px rgba(52,211,153,.5))}
.lbr-patrol.walking{animation:lbr-hop 1.7s cubic-bezier(.45,.05,.3,1) forwards}
.lbr-patrol.arrived{offset-distance:100%;transition:none}
.lbr-patrol.arrived .lbr-legs{animation-duration:.9s}
@keyframes lbr-hop{from{offset-distance:0%}to{offset-distance:100%}}
.lbr-scanring{transform-box:fill-box;transform-origin:center;animation:lbr-ring 1.6s ease-out infinite}
@keyframes lbr-ring{0%{opacity:.9;transform:scale(.55)}100%{opacity:0;transform:scale(1.05)}}
.lbr-verdict{position:absolute;transform:translateX(-50%);z-index:7;font-size:19px;font-weight:800;padding:4px 14px;border-radius:999px;border:1px solid;background:rgba(3,6,18,.92);white-space:nowrap;animation:lbr-pop .35s ease-out;pointer-events:none}
@keyframes lbr-pop{from{opacity:0;transform:translate(-50%,6px) scale(.8)}to{opacity:1;transform:translate(-50%,0) scale(1)}}
.lbr-mod.p-warn{box-shadow:inset 0 0 0 1px rgba(251,191,36,.6)}
.lbr-mod.p-fail{box-shadow:inset 0 0 0 1px rgba(248,113,113,.8),0 0 18px rgba(248,113,113,.35)}
.lbr-scanning{overflow:hidden}
.lbr-scanning:not(.lbr-mod):not(.lbr-core){position:relative}
.lbr-scanning::after{content:"";position:absolute;left:0;right:0;top:-40%;height:40%;background:linear-gradient(180deg,transparent,rgba(52,211,153,.13),rgba(167,243,208,.22),transparent);animation:lbr-sweep 1.8s linear infinite;pointer-events:none;border-radius:18px}
@keyframes lbr-sweep{to{top:100%}}
.lbr-score{flex:none;width:74px;height:74px;border-radius:50%;border:3px solid;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.3)}
.lbr-score b{font-size:20px;font-family:'JetBrains Mono',ui-monospace,monospace;line-height:1}
.lbr-score span{font-size:9px;color:#93A1C3;margin-top:3px}
.lbr-secgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:4px;margin-top:8px}
.lbr-sec{display:flex;align-items:center;gap:5px;font-size:10.5px;padding:3px 6px;border-radius:8px;border:1px solid;background:rgba(6,9,24,.6);color:#DDE4F5;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lbr-sec i{flex:none;width:7px;height:7px;border-radius:50%}
.lbr-sec.cur{background:rgba(6,78,59,.45);box-shadow:0 0 10px rgba(52,211,153,.4)}
.lbr-sec.sel{outline:1px solid #F0ABFC}
.lbr-tab{padding:3px 10px;border-radius:999px;font-size:11px;cursor:pointer;border:1px solid #1E2A5E;background:#0B1028;color:#C9D3EA}
.lbr-tab.on{background:#2A0F45;border-color:#E879F9;color:#fff}
.lbr-gap{font-size:11.5px;line-height:1.6;padding:6px 8px;border-radius:10px;border:1px solid;background:rgba(6,9,24,.6)}
.lbr-still .lbr-patrol.walking{animation-duration:.01s}.lbr-still .lbr-scanring,.lbr-still .lbr-scanning::after{animation:none}
@media (prefers-reduced-motion: reduce){.lbr-stars,.lbr-scan,.lbr-radar,.lbr-rot,.lbr-rot2,.lbr-rot3,.lbr-orbit,.lbr-counter,.lbr-ticker{animation:none}}
`;

const Spark: React.FC<{ vals: number[]; color: string; w?: number; h?: number; id: string }> = ({ vals, color, w = 120, h = 32, id }) => {
  const p = sparkPath(vals, w, h);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".45" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {p.area && <path d={p.area} fill={`url(#${id})`} />}
      {p.line && <path d={p.line} fill="none" stroke={color} strokeWidth="1.6" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />}
    </svg>
  );
};

const Gauge: React.FC<{ value: number | null; max: number; label: string; text: string; color: string; station?: string }> = ({ value, max, label, text, color, station }) => {
  const r = 34, c = 2 * Math.PI * r;
  const frac = value == null || !max ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <div data-station={station} data-st-name={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
      <svg width="90" height="90" viewBox="0 0 90 90" role="img" aria-label={`${label}: ${text}`}>
        <circle cx="45" cy="45" r={r} fill="none" stroke="#1B2550" strokeWidth="7" />
        <circle cx="45" cy="45" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(c * frac).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 45 45)" style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke-dasharray .9s cubic-bezier(.2,.8,.2,1)' }} />
        <text x="45" y="50" textAnchor="middle" fontSize="15" fontWeight="700" fill="#E7ECF8" className="lbr-mono">{value == null ? '—' : `${Math.round(frac * 100)}%`}</text>
      </svg>
      <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'center' }}>{label}</div>
      <div className="lbr-mono" style={{ fontSize: 10, color: '#93A1C3', textAlign: 'center' }}>{text}</div>
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: number; suffix?: string; sub: string; color: string; spark?: number[]; id: string; station?: string }> = ({ label, value, suffix, sub, color, spark, id, station }) => {
  const v = useCountUp(value);
  return (
    <div className="lbr-panel lbr-kpi" data-station={station} data-st-name={label} style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: '#93A1C3' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
        <span className="v lbr-mono" dir="ltr" style={{ color }}>{fmt(v)}{suffix || ''}</span>
        {spark && spark.length > 1 && <Spark vals={spark} color={color} id={id} w={96} h={30} />}
      </div>
      <div style={{ fontSize: 11, color: '#7C89AD' }}>{sub}</div>
    </div>
  );
};

/**
 * variant='wall' = «الشاشة الحية»: تُفتح من زر في الترويسة فوق كل الواجهة (تختفي الأقسام
 * الجانبية)، وتعرض كل لوحات الغرفة دفعة واحدة في شاشة واحدة بلا تمرير. البيانات نفسها
 * من `/api/live/room` — لا مصدر ثانٍ ولا أرقام مختلقة.
 */
export const LiveBrainRoom: React.FC<{ variant?: 'page' | 'wall'; onClose?: () => void }> = ({ variant = 'page', onClose }) => {
  const wall = variant === 'wall';
  const { currentUser, showToast } = useApp();
  const isOwner = currentUser?.role === 'owner';
  const [data, setData] = useState<any>(null);
  const [events, setEvents] = useState<LiveEvt[]>([]);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [hits, setHits] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<ModKey>('platforms');
  const [motion, setMotion] = useState(true);
  // حارس الخطة المجانية (الليل): لا يُبقي الشاشةُ الخاملة الخادمَ مستيقظاً 00:00–06:00 بغداد.
  const [sleeping, setSleeping] = useState(false);
  const sleepingRef = useRef(false);
  const lastInteractRef = useRef(Date.now());
  useEffect(() => {
    const bump = () => {
      lastInteractRef.current = Date.now();
      if (sleepingRef.current) { sleepingRef.current = false; setSleeping(false); }
    };
    const evs = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = window.setInterval(() => {
      const h = Number(new Date(Date.now() + skewRef.current).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Baghdad' })) % 24;
      const night = h >= 0 && h < 6;
      if (night && Date.now() - lastInteractRef.current > NIGHT_IDLE_MS && !sleepingRef.current) { sleepingRef.current = true; setSleeping(true); }
    }, 30000);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); window.clearInterval(t); };
  }, []);
  const [snd, setSnd] = useState<SoundState>(() => getSoundtrack().state);
  // ——— المهندس المشرف: العنكبوت يمشي من المركز إلى القسم المعطّل، يعمل، ثم يعود ———
  // home = في المركز · out = يمشي إليه · work = يُصلح · back = يعود. الرحلة تُشغَّل لكل مهمة
  // حقيقية (مهمة جارية، أو تقرير جديد أُنجز بين استطلاعين) — لا حركة بلا مهمة.
  const [spider, setSpider] = useState<{ phase: 'home' | 'out' | 'work' | 'back'; module: string | null; label: string }>({ phase: 'home', module: null, label: '' });
  const spiderTimers = useRef<number[]>([]);
  const seenJob = useRef<string | null>(null);
  const seenReport = useRef<string | null>(null);
  const [engBusy, setEngBusy] = useState(false);

  const coreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const st = getSoundtrack();
    openRooms += 1;
    const unsub = st.subscribe(setSnd);
    // نبض قلب العقل المركزي مع كل ضربة إيقاع.
    const unbeat = st.onBeat(() => {
      const el = coreRef.current; if (!el) return;
      el.classList.add('lbr-thump');
      window.setTimeout(() => el.classList.remove('lbr-thump'), 170);
    });
    // إن اختار المالك التشغيل سابقاً تُستأنف تلقائياً (يتجاهلها المتصفح بصمت إن لم يسمح بعد).
    if (st.wanted && !st.state.playing) void st.start();
    return () => {
      unsub(); unbeat();
      openRooms -= 1;
      if (openRooms <= 0) st.stop(false);
    };
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [eventTimes, setEventTimes] = useState<Array<{ t: number; m: string }>>([]);
  const lastIdRef = useRef(0);
  const burstSeq = useRef(0);
  const firstLoad = useRef(true);
  const stageWrap = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const stageBox = useBox(stageWrap, { w: W, h: H });
  const wrapW = stageBox.w;
  const scale = wall
    ? Math.max(0.2, Math.min(1, (stageBox.w - 4) / W, (stageBox.h - 4) / H))
    : Math.min(1, Math.max(0.3, (wrapW - 4) / W));

  // ——— الشاشة الحية (wall) ———
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const wallRef = useRef<HTMLDivElement>(null);
  const wallGridRef = useRef<HTMLDivElement>(null);
  const wallInnerRef = useRef<HTMLDivElement>(null);
  const pageRootRef = useRef<HTMLDivElement>(null);
  const wallPageRef = useRef<HTMLDivElement>(null);
  const wallBox = useBox(wallRef, { w: typeof window !== 'undefined' ? window.innerWidth : 1920, h: typeof window !== 'undefined' ? window.innerHeight : 1080 });
  const fitMode = wall && wallBox.w >= 900;
  // تصميم الشاشة على عرض 1680–1920 نقطة؛ الشاشات الأكبر (تلفاز/4K) تُكبَّر حتى 1.35.
  const baseScale = wallBox.w >= 1920 ? Math.min(1.35, wallBox.w / 1920) : Math.min(1, wallBox.w / 1680);
  const [fitScale, setFitScale] = useState<number | null>(null);
  const wallScale = fitScale ?? baseScale;
  const fsSupported = typeof document !== 'undefined' && typeof document.documentElement?.requestFullscreen === 'function';
  const [isFs, setIsFs] = useState(() => typeof document !== 'undefined' && Boolean(document.fullscreenElement));
  const toggleFs = useCallback(() => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
      else void document.documentElement.requestFullscreen?.().catch(() => undefined);
    } catch { /* ملء الشاشة اختياري */ }
  }, []);

  useEffect(() => {
    if (!wall) return;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    body.dataset.liveWall = '1'; // الغرفة في التبويب تتوقف عن الجلب ما دامت الشاشة الحية مفتوحة (لا جلب مزدوج).
    const onKey = (e: KeyboardEvent) => {
      // Esc يغلق الشاشة — إلا إن كان مربع تأكيد مفتوحاً فوقها.
      if (e.key === 'Escape' && !document.fullscreenElement && document.querySelectorAll('[aria-modal="true"]').length <= 1) onCloseRef.current?.();
    };
    const onFs = () => setIsFs(Boolean(document.fullscreenElement));
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      body.style.overflow = prevOverflow;
      delete body.dataset.liveWall;
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      try { if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined); } catch { /* */ }
    };
  }, [wall]);

  const ingest = useCallback((incoming: LiveEvt[]) => {
    if (!incoming.length) return;
    setEvents((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      const add = incoming.filter((e) => !seen.has(e.id));
      return [...add.reverse(), ...prev].slice(0, 60);
    });
    // تاريخ النشاط الحقيقي (أوقات الأحداث نفسها) — يغذّي نبض النشاط وتوهّج الأقسام.
    setEventTimes((prev) => {
      const cutoff = Date.now() + skewRef.current - RECENT_MS;
      const add = incoming.map((e) => ({ t: Date.parse(e.at), m: e.module })).filter((x) => Number.isFinite(x.t));
      return [...prev, ...add].filter((x) => x.t >= cutoff).slice(-600);
    });
    if (firstLoad.current) return;
    setFreshIds(new Set(incoming.map((e) => e.id)));
    // كل حدث حقيقي جديد نغمةٌ على الإيقاع (حتى 3 لكل دفعة كي لا تتزاحم).
    for (const e of incoming.slice(-3)) getSoundtrack().ping((['ok', 'info', 'warn', 'error'].includes(e.level) ? e.level : 'info') as PingLevel);
    const t = Date.now();
    const newBursts: Burst[] = [];
    const hitUpd: Record<string, number> = {};
    for (const e of incoming.slice(-10)) {
      const m = MOD_BY_KEY[e.module];
      if (!m) continue;
      hitUpd[m.key] = t;
      const color = LEVEL_COLOR[e.level] || m.color;
      newBursts.push({ id: ++burstSeq.current, color, path: m.dir === 'in' ? pathIn(m) : pathOut(m) });
      newBursts.push({ id: ++burstSeq.current, color: m.color, path: m.dir === 'in' ? pathIn(m) : pathOut(m) });
    }
    if (newBursts.length) {
      setBursts((b) => [...b, ...newBursts].slice(-20));
      setHits((h) => ({ ...h, ...hitUpd }));
      const ids = new Set(newBursts.map((b) => b.id));
      window.setTimeout(() => setBursts((b) => b.filter((x) => !ids.has(x.id))), 1600);
      const lastMod = incoming[incoming.length - 1]?.module;
      const idx = JOURNEY.findIndex((j) => j.mods.includes(lastMod));
      if (idx >= 0) setActiveStep(idx);
    }
  }, []);

  const skewRef = useRef(0); // فرق ساعة الجهاز عن ساعة الخادم — كل الأزمنة تُحسب بساعة الخادم
  const lastFullRef = useRef(0);
  const poll = useCallback(async () => {
    try {
      const full = !lastFullRef.current || Date.now() - lastFullRef.current >= FULL_EVERY_MS;
      const r = full ? await apiService.getLiveRoom(lastIdRef.current) : await apiService.getLiveRoom(lastIdRef.current, true);
      if (full) lastFullRef.current = Date.now();
      const st = Date.parse(String(r?.serverTime || ''));
      if (Number.isFinite(st)) skewRef.current = Math.round(skewRef.current * 0.5 + (st - Date.now()) * 0.5);
      // الاستطلاع الخفيف لا يحمل الرؤى: تبقى آخر رؤى كاملة حتى الاستطلاع الكامل التالي.
      setData((prev: any) => ({ ...r, insights: r.insights ?? prev?.insights }));
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
    // يتوقف عند إخفاء الصفحة؛ وغرفة التبويب تصمت ما دامت الشاشة الحية مفتوحة (هي تجلب بنفسها).
    const t = window.setInterval(() => { if (document.visibilityState === 'visible' && (wall || document.body.dataset.liveWall !== '1') && !sleepingRef.current) void poll(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [isOwner, poll, wall]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() + skewRef.current), 1000);
    return () => window.clearInterval(t);
  }, []);

  const modules = data?.modules || {};
  const ins = data?.insights || {};
  const tel = data?.telemetry || {};
  const appr = data?.approvals || {};
  const sel = MOD_BY_KEY[selected];
  const selView = modules[selected];
  // تدقيق 2026-10-26: لا تدوير وهمي — نص قلب العقل = آخر حدث حقيقي (خلال دقيقتين)، والحلقة
  // تضيء القسم الذي وقع فيه؛ وإن لم يقع حدث يُقال ذلك صراحة.
  const lastEvt = events[0];
  const lastEvtAge = lastEvt ? now - Date.parse(lastEvt.at) : Infinity;
  const coreLive = Number.isFinite(lastEvtAge) && lastEvtAge < 120000;
  const coreIdx = coreLive ? Math.abs([...String(lastEvt.module)].reduce((a, ch) => a + ch.charCodeAt(0), 0)) % CORE_FNS.length : -1;
  const hitActive = (k: string) => Boolean(hits[k] && now - hits[k] < 1500);
  const journeyIdx = activeStep != null && Number.isFinite(lastEvtAge) && lastEvtAge < RECENT_MS ? activeStep : -1;

  // نبض النشاط الحقيقي: أحداث لكل 10 ثوانٍ على آخر 5 دقائق.
  const buckets = useMemo(() => {
    const end = Math.floor(now / BUCKET_MS) * BUCKET_MS + BUCKET_MS;
    const arr = new Array(BUCKETS).fill(0);
    for (const e of eventTimes) {
      const idx = BUCKETS - 1 - Math.floor((end - e.t) / BUCKET_MS);
      if (idx >= 0 && idx < BUCKETS) arr[idx] += 1;
    }
    return arr;
  }, [eventTimes, now]);
  const perMinute = buckets.slice(-6).reduce((a, b) => a + b, 0);
  const moduleHeat = useMemo<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    const cutoff = now - RECENT_MS;
    for (const e of eventTimes) if (e.t >= cutoff) m[e.m] = (m[e.m] || 0) + 1;
    return m;
  }, [eventTimes, now]);
  const maxHeat = Math.max(1, ...(Object.values(moduleHeat) as number[]));

  const hourly: number[] = Array.isArray(ins.hourly24) ? ins.hourly24 : [];
  const hourlyInq: number[] = Array.isArray(ins.hourlyInquiries24) ? ins.hourlyInquiries24 : [];
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const plats: any[] = data?.platforms || [];
  const connected = plats.filter((p) => p.connected).length;
  const publishedTotal = (ins.publish || []).reduce((a: number, p: any) => a + Number(p.published || 0), 0);
  const scheduledTotal = (ins.publish || []).reduce((a: number, p: any) => a + Number(p.scheduled || 0), 0);

  // دورات 24/7 من الخادم: الإيقاع الفعلي (مع مضاعف ضغط الخطة)، العدد، التأجيل، التأخّر.
  const CYCLE_COLOR: Record<string, string> = { youtube: '#F43F5E', meta: '#60A5FA', telegram: '#38BDF8', brain: '#A78BFA', commercial: '#E879F9', metrics: '#22D3EE', backup: '#34D399' };
  const CYCLE_STATE: Record<string, { t: string; c: string }> = {
    ok: { t: '', c: '#C9D3EA' }, late: { t: 'متأخرة', c: '#F87171' }, deferred: { t: 'مؤجّلة', c: '#FBBF24' }, paused: { t: 'موقوفة', c: '#93A1C3' }, never: { t: 'لم تبدأ', c: '#FBBF24' },
  };
  const cadText = (ms: number | null | undefined) => (!ms ? '' : ms >= 3600000 ? `كل ${Math.round(ms / 3600000)} س` : `كل ${Math.round(ms / 60000)} د`);
  // كل صف دورة = محطة فحص مرتبطة بفحوصها الحقيقية لدى المهندس.
  const CYCLE_ST: Record<string, string> = { youtube: 'check:automation.timers,automation.watcherErrors,external.youtubeQuota', meta: 'check:automation.timers,automation.watcherErrors,platforms.webhook', telegram: 'check:automation.timers,external.telegram', brain: 'check:agents.run,agents.failures,agents.locks', commercial: 'check:core.cycles,gate.expired', metrics: 'check:memory.sync,memory.measured', backup: 'check:backup.fresh,backup.failures,backup.auth' };
  const JOURNEY_ST = ['check:customers.inbound', 'check:customers.escalations', 'check:gate.mode,gate.window', 'check:owner.pending', 'check:automation.jobs', 'check:platforms.publish', 'check:memory.sync'];
  const pulseRows = useMemo(() => {
    const cy: any[] = Array.isArray(data?.cycles) ? data.cycles : [];
    return cy.map((c) => {
      const stt = CYCLE_STATE[c.status] || CYCLE_STATE.ok;
      const parts = [typeof c.cycles === 'number' && c.cycles > 0 ? `${fmt(c.cycles)} دورة` : '', c.status === 'paused' ? '' : ago(c.lastRunAt, now)].filter(Boolean);
      return {
        key: String(c.key), name: String(c.label), sub: cadText(c.cadenceMs), color: CYCLE_COLOR[c.key] || '#A5B4FC',
        value: parts.join(' · ') || '—', state: stt.t, stateColor: stt.c, note: c.note || '', ok: c.status === 'ok',
        title: [c.note, c.nextDueAt ? `الدورة التالية ${clock(c.nextDueAt)}` : ''].filter(Boolean).join(' — '),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, now]);

  // حلقة النوايا (donut) من التصنيف الحقيقي.
  const intents: any[] = ins.intents || [];
  const intentTotal = Math.max(1, sum(intents.map((x) => x.count)));
  let acc = 0;
  const donut = intents.map((x) => {
    const frac = x.count / intentTotal; const start = acc; acc += frac;
    return { ...x, start, frac, color: INTENT_COLOR[x.key] || '#A78BFA' };
  });
  const arc = (start: number, frac: number, r: number) => {
    const a0 = start * 2 * Math.PI - Math.PI / 2, a1 = (start + frac) * 2 * Math.PI - Math.PI / 2;
    const large = frac > 0.5 ? 1 : 0;
    const x0 = 60 + r * Math.cos(a0), y0 = 60 + r * Math.sin(a0), x1 = 60 + r * Math.cos(a1), y1 = 60 + r * Math.sin(a1);
    return frac >= 0.999 ? `M${60 - r} 60 A${r} ${r} 0 1 1 ${60 + r} 60 A${r} ${r} 0 1 1 ${60 - r} 60` : `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  const eng: any = data?.engineer || null;
  useEffect(() => {
    if (!eng) return;
    const clear = () => { spiderTimers.current.forEach((t) => window.clearTimeout(t)); spiderTimers.current = []; };
    const later = (fn: () => void, ms: number) => { spiderTimers.current.push(window.setTimeout(fn, ms)); };
    const job = eng.job;
    const top = Array.isArray(eng.reports) ? eng.reports[0] : null;
    if (seenReport.current === null) seenReport.current = top?.id || '';
    if (job && job.id !== seenJob.current) {
      seenJob.current = job.id; clear();
      setSpider({ phase: 'out', module: job.module, label: job.title });
      later(() => setSpider((s) => (s.phase === 'out' ? { ...s, phase: 'work' } : s)), 1700);
      return;
    }
    if (!job && (spider.phase === 'out' || spider.phase === 'work')) {
      if (top) seenReport.current = top.id;
      clear();
      later(() => setSpider((s) => ({ ...s, phase: 'back' })), spider.phase === 'out' ? 1700 : 600);
      later(() => setSpider({ phase: 'home', module: null, label: '' }), (spider.phase === 'out' ? 1700 : 600) + 1700);
      return;
    }
    // مهمة اكتملت كلها بين استطلاعين: تُعرض الرحلة كاملة من تقريرها الحقيقي.
    if (!job && top && top.id !== seenReport.current && ['resolved', 'escalated', 'retrying'].includes(top.status) && spider.phase === 'home') {
      seenReport.current = top.id; clear();
      setSpider({ phase: 'out', module: top.module, label: top.title });
      later(() => setSpider((s) => ({ ...s, phase: 'work' })), 1700);
      later(() => setSpider((s) => ({ ...s, phase: 'back' })), 1700 + 2200);
      later(() => setSpider({ phase: 'home', module: null, label: '' }), 1700 + 2200 + 1700);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eng?.job?.id, eng?.reports?.[0]?.id, Boolean(eng?.job)]);
  useEffect(() => () => { spiderTimers.current.forEach((t) => window.clearTimeout(t)); }, []);

  // ——— دورية العنكبوت: يمشي بلا توقف من قسم إلى قسم كما تفحص الدورية على الخادم فعلاً ———
  // كل قفزة = انتقال الدورية الحقيقية إلى القسم التالي (cursor من الخادم)؛ عند الوصول يمدّ خيطاً
  // ويعرض نتيجة الفحص الحقيقية لذلك القسم.
  const patrol: any = eng?.patrol || null;
  const patrolMod = (k: string) => patrol?.modules?.[k] || null;
  const [patrolTab, setPatrolTab] = useState<'gaps' | 'reports' | 'sections'>('gaps');
  const [patrolSel, setPatrolSel] = useState<string | null>(null);
  const engCheck = async () => {
    setEngBusy(true);
    try { await apiService.runEngineerCheck(); showToast('اكتمل فحص المهندس المشرف'); void poll(); }
    catch (e: any) { showToast(e?.message || 'تعذّر الفحص'); }
    finally { setEngBusy(false); }
  };
  const engToggle = async () => {
    setEngBusy(true);
    try { await apiService.toggleEngineer(!eng?.enabled); showToast(eng?.enabled ? 'أُوقف المهندس المشرف' : 'شُغّل المهندس المشرف'); void poll(); }
    catch (e: any) { showToast(e?.message || 'تعذّر التغيير'); }
    finally { setEngBusy(false); }
  };

  // طاقة الإيقاع من النظام الحقيقي: نشاط الأحداث في الدقيقة + أخطر تنبيه قائم.
  const alarmLevel: 'ok' | 'warn' | 'critical' = (data?.alerts || []).some((a: any) => a.severity === 'critical') ? 'critical' : (data?.alerts || []).some((a: any) => a.severity === 'warning') ? 'warn' : 'ok';
  useEffect(() => { getSoundtrack().setEnergy(perMinute, alarmLevel); }, [perMinute, alarmLevel]);

  // ملاءمة الشاشة: يُبحث عن أكبر مقياس لا يخرج عنده أي عمود عن الشاشة — فيُكبَّر المحتوى
  // حين يتسع المكان ويُصغَّر بالقدر اللازم فقط حين يضيق. القياس على DOM مباشرة قبل الرسم
  // (بلا وميض)، ويُعاد عند تغيّر مقاس الشاشة أو بنية المحتوى، ومرة كل دقيقة.
  const fitKey = `${wallBox.w}x${wallBox.h}|${plats.length}|${(ins.topics || []).length}|${(ins.topProducts || []).length}|${(ins.byPlatform || []).length}|${(ins.leadStages || []).length}|${appr.latest ? 1 : 0}|${(selView?.items || []).length}|${selected}|${data ? 1 : 0}|${(data?.alerts || []).length}|${sleeping ? 1 : 0}|${(data?.cycles || []).length}|${Math.floor(now / 60000)}`;
  const fitKeyRef = useRef('');
  useLayoutEffect(() => {
    if (!fitMode || fitKeyRef.current === fitKey) return;
    const inner = wallInnerRef.current, grid = wallGridRef.current;
    if (!inner || !grid) return;
    fitKeyRef.current = fitKey;
    const fits = (sc: number) => {
      inner.style.width = `${wallBox.w / sc}px`;
      inner.style.height = `${wallBox.h / sc}px`;
      return (Array.from(grid.children) as HTMLElement[]).every((c) => c.scrollHeight <= c.clientHeight + 1);
    };
    // الحد الأعلى: لا يقل عرض التصميم عن 1500 نقطة (حتى لا تنضغط الأعمدة)، ولا يتجاوز 1.6.
    let lo = 0.45, hi = Math.max(lo, Math.min(1.6, wallBox.w / 1500));
    if (fits(hi)) lo = hi;
    else for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
    fits(lo);
    setFitScale(Math.round(lo * 1000) / 1000);
  });

  if (!isOwner) {
    return <div className="p-8 rounded-2xl glass text-center text-slate-300">غرفة العقل الحية مخصصة لمالك النظام فقط.</div>;
  }

  const wave = sparkPath(buckets, 600, 70);
  const maxHour = Math.max(1, ...hourly);
  // البث متأخر إن لم ينجح جلب منذ 15 ث (لا يُعرض «بث حي» على بيانات قديمة).
  const feedStale = Boolean(data && lastOkAt && Date.now() - lastOkAt > STALE_MS);
  const feedWarn = feedStale || sleeping;
  // لوحة تتمدّد لتملأ ما تبقّى من العمود في الشاشة الحية (قوائم تُمرَّر داخلها فقط).
  const flexPanel: React.CSSProperties | undefined = wall ? { display: 'flex', flexDirection: 'column', flex: '1 1 0', minHeight: 190 } : undefined;


  const headerEl = (
      <header style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: wall ? '8px 14px' : '16px 18px', flex: 'none', borderBottom: '1px solid rgba(99,102,241,.2)', background: 'linear-gradient(180deg, rgba(10,8,30,.9), rgba(6,9,22,.6))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <svg width="46" height="46" viewBox="0 0 48 48" aria-hidden="true" style={{ filter: 'drop-shadow(0 0 10px #E879F9)' }}><g fill="none" stroke="#F0ABFC" strokeWidth="1.8" strokeLinecap="round"><ellipse cx="24" cy="27" rx="7" ry="8" /><circle cx="24" cy="15" r="4" /><path d="M17 23 L8 15 L4 18 M17 27 L5 27 L2 31 M17 31 L8 39 L5 44 M31 23 L40 15 L44 18 M31 27 L43 27 L46 31 M31 31 L40 39 L43 44" /></g></svg>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, textShadow: '0 0 22px rgba(232,121,249,.55)' }}><span style={{ color: '#F0ABFC' }}>الغرابي</span> AI · غرفة العقل الحية</h1>
            <div className="lbr-mono" style={{ fontSize: 11, color: '#93A1C3' }}>LIVE NEURAL OPS · المخطط الهندسي كما يجري الآن</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span data-station="check:core.events,monitor.lag" data-st-name="البث الحي" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, border: `1px solid ${error ? '#7A1F3A' : feedWarn ? '#6B4A12' : '#1E6B55'}`, color: error ? '#FDA4AF' : feedWarn ? '#FCD34D' : '#6EE7B7', background: 'rgba(0,0,0,.25)' }}>
            <span className="lbr-blink" style={{ width: 8, height: 8, borderRadius: '50%', background: error ? '#F87171' : feedWarn ? '#FBBF24' : '#34D399', boxShadow: `0 0 10px ${error ? '#F87171' : feedWarn ? '#FBBF24' : '#34D399'}` }} />
            {sleeping ? 'سكون ليلي — المس الشاشة للاستئناف' : error ? 'انقطاع مؤقت — إعادة المحاولة' : feedStale ? `البث متأخر — آخر تحديث ${ago(lastOkAt ? new Date(lastOkAt + skewRef.current).toISOString() : null, now)}` : data ? `بث حي · ${ago(lastOkAt ? new Date(lastOkAt + skewRef.current).toISOString() : null, now)}` : 'جارٍ الاتصال…'}
          </span>
          {modules.gate && <span data-station="check:gate.mode,gate.window,gate.expired" data-st-name="البوابة" style={{ padding: '7px 12px', borderRadius: 999, border: '1px solid #6B4A12', color: '#FCD34D', background: 'rgba(0,0,0,.25)' }}>{modules.gate.metric}</span>}
          {modules.automation && modules.automation.status !== 'ok' && <span data-station="check:automation.timers,automation.watcherErrors" data-st-name="الأتمتة" style={{ padding: '7px 12px', borderRadius: 999, border: '1px solid #7A1F3A', color: '#FDA4AF', background: 'rgba(0,0,0,.25)' }}>{modules.automation.metric}</span>}
          <span className="lbr-mono" data-station="check:core.uptime,core.scope" data-st-name="ساعة الخادم" style={{ padding: '7px 12px', borderRadius: 999, border: '1px solid #1A2350', background: 'rgba(0,0,0,.25)' }}>{clock(new Date(now).toISOString())} بغداد</span>
          {wall && <span style={{ display: 'inline-flex', gap: 10, padding: '7px 12px', borderRadius: 999, border: '1px solid #1A2350', background: 'rgba(0,0,0,.25)' }}>{(['ok', 'partial', 'off'] as const).map((k) => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 3, background: STATUS_COLOR[k], boxShadow: `0 0 8px ${STATUS_COLOR[k]}` }} />{k === 'ok' ? 'يعمل' : k === 'partial' ? 'جزئي' : 'متوقف'}</span>)}</span>}
          {snd.supported && (
            <span className={'lbr-snd' + (snd.playing ? ' on' : '')} role="group" aria-label="إيقاع الغرفة">
              <button type="button" className="lbr-snd-btn" onClick={() => getSoundtrack().toggle()} aria-pressed={snd.playing} title={snd.playing ? 'إيقاف إيقاع الغرفة' : 'تشغيل إيقاع حيّ يتفاعل مع أحداث النظام'}>
                <span className="lbr-eq" aria-hidden="true"><i /><i /><i /><i /></span>
                {snd.playing ? 'إيقاف الإيقاع' : 'تشغيل الإيقاع'}
              </button>
              <select aria-label="نمط الإيقاع" value={snd.mode} onChange={(e) => getSoundtrack().setMode(e.target.value as SoundMode)}>
                {SOUND_MODES.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.bpm}</option>)}
              </select>
              <input type="range" min={0} max={100} step={1} aria-label="مستوى الصوت" title={`الصوت ${Math.round(snd.volume * 100)}%`} value={Math.round(snd.volume * 100)} onChange={(e) => getSoundtrack().setVolume(Number(e.target.value) / 100)} />
            </span>
          )}
          <button type="button" onClick={() => setMotion((m) => !m)} style={{ padding: '7px 14px', minHeight: 34, borderRadius: 999, border: '1px solid #2B3A66', background: '#0F1630', color: '#E7ECF8', cursor: 'pointer' }}>{motion ? 'إيقاف الحركة' : 'تشغيل الحركة'}</button>
          {wall && fsSupported && <button type="button" onClick={toggleFs} style={{ padding: '7px 14px', minHeight: 34, borderRadius: 999, border: '1px solid #2B3A66', background: '#0F1630', color: '#E7ECF8', cursor: 'pointer' }}>{isFs ? 'خروج من ملء الشاشة' : 'ملء الشاشة'}</button>}
          {wall && <button type="button" onClick={() => onCloseRef.current?.()} aria-label="إغلاق الشاشة الحية" title="إغلاق (Esc)" style={{ padding: '7px 16px', minHeight: 34, borderRadius: 999, border: '1px solid #F0ABFC', background: 'linear-gradient(135deg,#3B0D4F,#140B30)', color: '#FDF4FF', fontWeight: 700, cursor: 'pointer', boxShadow: '0 0 16px rgba(240,171,252,.35)' }}>✕ إغلاق</button>}
        </div>
      </header>
  );
  const sleepEl = sleeping ? (
    <div role="status" style={{ margin: wall ? '0 12px' : 0, padding: '10px 14px', borderRadius: 14, border: '1px solid #6B4A12', background: 'linear-gradient(90deg, rgba(120,80,10,.3), rgba(6,9,24,.85))', color: '#FCD34D', fontSize: 13, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <span>🌙 سكون ليلي لحماية ساعات الخطة المجانية: الخادم ينام 00:00–06:00، والشاشة الخاملة أوقفت الجلب كي لا توقظه. البيانات المعروضة آخر ما وصل.</span>
      <button type="button" onClick={() => { lastInteractRef.current = Date.now(); sleepingRef.current = false; setSleeping(false); void poll(); }} style={{ padding: '6px 14px', borderRadius: 999, border: '1px solid #FBBF24', background: '#2A1B05', color: '#FDE68A', cursor: 'pointer', fontWeight: 700 }}>استئناف الآن</button>
    </div>
  ) : null;
  const alertEl = (
        <LiveAlertStrip data={data} hideJump={wall} onJump={() => controlRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
  );
  const kpisEl = (
        <section aria-label="المؤشرات الحية" data-mod="customers owner platforms" style={{ display: 'grid', gridTemplateColumns: wall ? 'repeat(6, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(170px, 1fr))', gap: wall ? 10 : 12 }}>
          <Kpi id="k1" station="check:customers.inbound" label="تفاعلات الزبائن · 24 ساعة" value={sum(hourly)} sub={`من كل المنصات — الإجمالي ${fmt(sum((ins.byPlatform || []).map((p: any) => p.total)))}`} color="#7DD3FC" spark={hourly} />
          <Kpi id="k2" station="check:customers.escalations,customers.leads" label="استفسارات تجارية · 24 ساعة" value={sum(hourlyInq)} sub="سعر · تقسيط · توفر" color="#F0ABFC" spark={hourlyInq} />
          <Kpi id="k3" station="check:owner.pending,owner.backlog" label="ردود بانتظار موافقتك" value={Number(appr.pending || 0)} sub="جاهزة للإرسال بنقرة" color="#FCD34D" />
          <Kpi id="k4" station="check:platforms.verified,platforms.token,platforms.expiry" label="منصات متصلة" value={connected} suffix={` / ${fmt(plats.length || 10)}`} sub="بتحقق من المزوّد" color="#6EE7B7" />
          <Kpi id="k5" station="check:platforms.publish" label="منشورات بمعرّف حقيقي" value={publishedTotal} sub={scheduledTotal ? `منشورة فعلاً · ${fmt(scheduledTotal)} مجدولة لدى المنصات` : 'منشورة فعلاً على المنصات'} color="#A5B4FC" />
          <Kpi id="k6" station="check:core.events" label="نبض الأحداث · دقيقة" value={perMinute} sub="أحداث حقيقية آخر 60 ثانية" color="#22D3EE" spark={buckets} />
        </section>
  );
  const controlEl = (
        <LiveControlCenter data={data} refresh={() => { void poll(); }} now={now} anchorRef={controlRef} compact={wall} onLeave={wall ? () => onCloseRef.current?.() : undefined} />
  );
  const selectedBlock = (
              <div style={{ marginTop: 12, border: '1px solid rgba(192,132,252,.35)', borderRadius: 16, background: 'linear-gradient(110deg, rgba(42,15,69,.55), rgba(10,16,38,.7))', padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: 18 }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div className="lbr-mono" style={{ fontSize: 10, color: '#C4B5FD' }}>SELECTED MODULE · القسم المحدد</div>
                  <div style={{ fontSize: 21, fontWeight: 800, color: sel.color, textShadow: `0 0 16px ${sel.color}88` }}>{sel.title}</div>
                  <div className="lbr-mono" style={{ fontSize: 10, color: '#93A1C3' }}>{sel.en}</div>
                  {selView && <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, color: STATUS_COLOR[selView.status] }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[selView.status], boxShadow: `0 0 8px ${STATUS_COLOR[selView.status]}` }} />{STATUS_TEXT[selView.status]} — {selView.metric}</div>}
                  <div style={{ fontSize: 11, color: '#93A1C3', marginTop: 6 }}>نشاط آخر 10 دقائق: <span className="lbr-mono" style={{ color: '#E7ECF8' }}>{moduleHeat[selected] || 0}</span> حدث</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {sel.parts.map((p) => <span key={p} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, border: `1px solid ${sel.color}55`, color: '#DDE4F5', background: `${sel.color}10` }}>{p}</span>)}
                  </div>
                </div>
                <div style={{ flex: '2 1 320px', minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                  {(selView?.items || []).map((it: any) => (
                    <div key={it.name} style={{ padding: '8px 10px', border: '1px solid rgba(99,102,241,.25)', borderRadius: 12, background: 'rgba(6,9,24,.75)' }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{it.name}</div>
                      <div style={{ fontSize: 11, color: STATUS_COLOR[it.status] || '#93A1C3' }}>{it.value}</div>
                    </div>
                  ))}
                  {!selView && <div style={{ fontSize: 12, color: '#93A1C3' }}>جارٍ جلب الحالة الحقيقية…</div>}
                </div>
              </div>
  );
  const mapEl = (
            <section aria-label="المخطط الحي" data-mod="agents" className="lbr-panel" style={wall ? { padding: 10, flex: '1 1 0', minHeight: 420, display: 'flex', flexDirection: 'column' } : { padding: 12 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, padding: '2px 6px 8px' }}>
                <h2 className="lbr-h">المخطط الهندسي الحي — 13 قسماً حول العقل المركزي</h2>
                <span style={{ fontSize: 11, color: '#93A1C3' }}>الخط المتدفق = قسم يعمل · الوميض الأبيض = حدث حقيقي لحظة وقوعه · التوهّج = نشاط آخر 10 دقائق</span>
              </div>
              <div ref={stageWrap} style={wall ? { width: '100%', flex: '1 1 0', minHeight: 0, overflow: 'hidden', display: 'flex', alignItems: 'center' } : { width: '100%' }}>
                <div style={{ position: 'relative', width: '100%', height: H * scale }}>
                  <div style={{ position: 'absolute', left: '50%', top: 0, width: W, height: H, transform: `translateX(-50%) scale(${scale})`, transformOrigin: 'top center' }}>
                    <div className="lbr-radar" />
                    {/* طبقة توهّج ثابتة منفصلة: يُحسب تمويهها مرة واحدة ويُخزَّن (لا يُعاد كل إطار مع العناصر المتحركة). */}
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, willChange: 'transform', pointerEvents: 'none' }} aria-hidden="true">
                      <defs><filter id="lbrGlowWideS" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" /></filter></defs>
                      {MODS.map((m) => {
                        const st: Status = modules[m.key]?.status || 'partial';
                        if (st === 'off') return null;
                        const heat = Math.round(((moduleHeat[m.key] || 0) / maxHeat) * 4) / 4; // درجات قليلة = إعادة حساب نادرة
                        return <path key={'gw' + m.key} d={pathIn(m)} fill="none" stroke={m.color} strokeWidth={5 + heat * 6} strokeOpacity={0.16 + heat * 0.25} filter="url(#lbrGlowWideS)" />;
                      })}
                    </svg>
                    {/* حلقات العقل الدوّارة: كل حلقة طبقة مستقلة تدور على المعالج الرسومي (بلا إعادة رسم للمخطط في كل إطار). */}
                    <div className="lbr-ring lbr-rot"><svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><ellipse cx={CX} cy={CY} rx="320" ry="240" fill="none" stroke="#1E2A5E" strokeDasharray="1 9" /></svg></div>
                    <div className="lbr-ring lbr-rot2"><svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">                      
                        <circle cx={CX} cy={CY} r="160" fill="none" stroke="#3B2A7A" strokeOpacity=".8" strokeDasharray="22 8 3 8" />
                        {Array.from({ length: 48 }).map((_, i) => {
                          const a = (i / 48) * 2 * Math.PI; const r1 = i % 4 === 0 ? 168 : 164, r2 = 174;
                          return <line key={i} x1={CX + r1 * Math.cos(a)} y1={CY + r1 * Math.sin(a)} x2={CX + r2 * Math.cos(a)} y2={CY + r2 * Math.sin(a)} stroke={i % 4 === 0 ? '#C084FC' : '#3B3F7A'} strokeWidth={i % 4 === 0 ? 1.6 : 1} />;
                        })}
                      </svg></div>
                    <div className="lbr-ring lbr-rot3"><svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><circle cx={CX} cy={CY} r="122" fill="none" stroke="#7DD3FC" strokeOpacity=".35" strokeDasharray="60 20 4 20" strokeWidth="1.4" /></svg></div>
                    <div className="lbr-ring lbr-orbit"><svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">                      
                        {AGENTS.map((a, i) => {
                          const ang = (i / AGENTS.length) * 2 * Math.PI - Math.PI / 2; const x = CX + 140 * Math.cos(ang), y = CY + 140 * Math.sin(ang);
                          return (
                            <g key={a}>
                              <line x1={CX} y1={CY} x2={x} y2={y} stroke="#7C3AED" strokeOpacity=".25" />
                              <circle cx={x} cy={y} r="13" fill="#140B30" stroke="#C084FC" strokeWidth="1.4" /><circle cx={x} cy={y} r="16" fill="none" stroke="#C084FC" strokeOpacity=".25" strokeWidth="4" />
                              <g style={{ transformOrigin: `${x}px ${y}px` }} className="lbr-counter"><text x={x} y={y + 28} textAnchor="middle" fontSize="10" fill="#D8B4FE">{a}</text></g>
                            </g>
                          );
                        })}
                      </svg></div>
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0 }} role="img" aria-label="تدفق البيانات بين أقسام المشروع والعقل المركزي">
                      <defs>
                        <radialGradient id="lbrCore" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#D946EF" stopOpacity=".6" /><stop offset="45%" stopColor="#6366F1" stopOpacity=".2" /><stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" /></radialGradient>
                        <filter id="lbrGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                        <filter id="lbrGlowWide" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" /></filter>
                        {MODS.map((m) => (
                          <linearGradient key={'g' + m.key} id={`lbrG-${m.key}`} gradientUnits="userSpaceOnUse" x1={m.x} y1={m.y} x2={m.ex} y2={m.ey}>
                            <stop offset="0%" stopColor={m.color} /><stop offset="100%" stopColor="#F0ABFC" />
                          </linearGradient>
                        ))}
                      </defs>
                      <circle cx={CX} cy={CY} r="300" fill="url(#lbrCore)" />
                      {MODS.map((m) => {
                        const st: Status = modules[m.key]?.status || 'partial';
                        if (st === 'off') return <path key={'s' + m.key} d={pathIn(m)} fill="none" stroke="#5B2236" strokeWidth="1.2" strokeDasharray="3 7" />;
                        const heat = (moduleHeat[m.key] || 0) / maxHeat;
                        return (
                          <g key={'s' + m.key}>
                            <path d={pathIn(m)} fill="none" stroke={`url(#lbrG-${m.key})`} strokeWidth="1.4" strokeOpacity=".55" />
                            <path d={pathIn(m)} fill="none" stroke={m.color} strokeWidth="2.2" strokeLinecap="round" className={m.dir === 'in' ? 'lbr-flow-in' : 'lbr-flow-out'} />
                          </g>
                        );
                      })}
                      {CROSS.map(([a, b]) => <path key={a + b} d={crossPath(MOD_BY_KEY[a], MOD_BY_KEY[b])} fill="none" stroke="#6D7BD0" strokeOpacity=".55" strokeWidth="1.1" className="lbr-flow-x" />)}
                      {motion && MODS.filter((m) => (modules[m.key]?.status || 'partial') !== 'off').flatMap((m, i) => {
                        const n = 1 + Math.min(1, Math.round(((moduleHeat[m.key] || 0) / maxHeat) * 1));
                        return Array.from({ length: n }).map((_, j) => (
                          <circle key={`amb${m.key}${j}`} r={j === 0 ? 3.4 : 2.4} fill={m.color} stroke={m.color} strokeOpacity=".35" strokeWidth="5">
                            <animateMotion dur={`${2 + (i % 4) * 0.35}s`} begin={`${((i * 0.37) + j * 0.6) % 2.4}s`} repeatCount="indefinite" path={m.dir === 'in' ? pathIn(m) : pathOut(m)} />
                          </circle>
                        ));
                      })}
                      {CORE_FNS.map((f, i) => {
                        const s0 = i / CORE_FNS.length + 0.006, fr = 1 / CORE_FNS.length - 0.012;
                        const r = 104; const a0 = s0 * 2 * Math.PI - Math.PI / 2, a1 = (s0 + fr) * 2 * Math.PI - Math.PI / 2;
                        const d = `M${CX + r * Math.cos(a0)} ${CY + r * Math.sin(a0)} A${r} ${r} 0 0 1 ${CX + r * Math.cos(a1)} ${CY + r * Math.sin(a1)}`;
                        return <path key={f} d={d} fill="none" stroke={i === coreIdx ? '#F0ABFC' : '#3B2A7A'} strokeWidth={i === coreIdx ? 5 : 3} strokeLinecap="round"  style={{ transition: 'stroke .4s' }} />;
                      })}
                      <circle cx={CX} cy={CY} r="88" fill="none" stroke="#E879F9" strokeWidth="2" className="lbr-halo" />
                      <circle cx={CX} cy={CY} r="88" fill="none" stroke="#38BDF8" strokeWidth="1.4" className="lbr-halo2" />
                    </svg>

                    {motion && bursts.map((b) => (
                      <span key={b.id} className="lbr-burst" style={{ offsetPath: `path('${b.path}')`, background: `radial-gradient(circle, #fff 0%, ${b.color} 45%, transparent 70%)`, boxShadow: `0 0 16px ${b.color}, 0 0 36px ${b.color}` } as React.CSSProperties} />
                    ))}

                    <div ref={coreRef} data-modcard="core" data-station="module:core" className="lbr-core" style={{ position: 'absolute', left: CX - 92, top: CY - 92, width: 184, height: 184, borderRadius: '50%', border: '2px solid #F0ABFC', background: 'radial-gradient(circle at 50% 38%, #3B1166 0%, #160A33 45%, #070417 80%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, textAlign: 'center' }}>
                      <svg width="52" height="52" viewBox="0 0 48 48" aria-hidden="true" style={{ filter: 'drop-shadow(0 0 12px #E879F9)' }}><g fill="none" stroke="#FDF4FF" strokeWidth="1.8" strokeLinecap="round"><ellipse cx="24" cy="27" rx="7" ry="8" /><circle cx="24" cy="15" r="4" /><path d="M17 23 L8 15 L4 18 M17 27 L5 27 L2 31 M17 31 L8 39 L5 44 M31 23 L40 15 L44 18 M31 27 L43 27 L46 31 M31 31 L40 39 L43 44" /></g></svg>
                      <div style={{ fontSize: 15, fontWeight: 800, textShadow: '0 0 14px rgba(240,171,252,.8)' }}>العقل المركزي</div>
                      <div style={{ fontSize: 10, color: '#D8B4FE' }}>والمنسّق التنفيذي</div>
                      <div style={{ fontSize: 11, color: '#F5D0FE', fontWeight: 600 }}>{coreLive ? String(lastEvt.title).slice(0, 26) : 'بانتظار حدث'}</div>
                      {modules.core && <div className="lbr-mono" style={{ fontSize: 9, color: '#A5B4FC' }}>{modules.core.metric}</div>}
                    </div>

                    {MODS.map((m) => {
                      const v = modules[m.key];
                      const st: Status = v?.status || 'partial';
                      const heat = (moduleHeat[m.key] || 0) / maxHeat;
                      const glow = STATUS_COLOR[st];
                      const cls = 'lbr-mod' + (selected === m.key ? ' sel' : '') + (hitActive(m.key) ? ' hit' : '') + (spider.module === m.key && spider.phase === 'work' ? ' fixing' : '') + (patrolMod(m.key)?.status === 'fail' ? ' p-fail' : patrolMod(m.key)?.status === 'warn' ? ' p-warn' : '');
                      return (
                        <button key={m.key} type="button" data-modcard={m.key} data-station={`module:${m.key}`} className={cls} onClick={() => setSelected(m.key)} aria-label={`عرض قسم ${m.title}`}
                          style={{ position: 'absolute', left: m.x - 90, top: m.y - 38, width: 180, minHeight: 76, padding: '8px 10px', borderRadius: 14, border: `1px solid ${m.color}55`, background: `linear-gradient(160deg, rgba(14,18,44,.95), rgba(8,10,26,.9))`, color: '#E7ECF8', textAlign: 'right', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3, boxShadow: `0 0 ${10 + heat * 26}px ${m.color}${heat > 0.05 ? '66' : '22'}, inset 0 0 18px ${m.color}14` }}>
                          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%' }}>
                            <span style={{ fontSize: 13, fontWeight: 700 }}>{m.title}</span>
                            <span className={st === 'ok' ? '' : 'lbr-blink'} style={{ width: 9, height: 9, flex: 'none', borderRadius: '50%', background: glow, boxShadow: `0 0 10px ${glow}` }} />
                          </span>
                          <span className="lbr-mono" style={{ fontSize: 9, color: m.color, opacity: 0.85 }}>{m.en}</span>
                          <span style={{ fontSize: 11, color: st === 'ok' ? '#C9D3EA' : glow, lineHeight: 1.4 }}>{v?.metric || '…'}</span>
                          <span style={{ height: 3, borderRadius: 999, background: '#141B3D', overflow: 'hidden' }}><span className="lbr-bar" style={{ display: 'block', height: 3, width: `${Math.max(4, heat * 100)}%`, background: `linear-gradient(90deg, ${m.color}, #F0ABFC)`, boxShadow: `0 0 8px ${m.color}` }} /></span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {scale < 0.7 && !wall && (
                <div aria-label="الأقسام الثلاثة عشر" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 10 }}>
                  {MODS.map((m) => {
                    const v = modules[m.key]; const st: Status = v?.status || 'partial'; const c = STATUS_COLOR[st];
                    return (
                      <button key={'mg' + m.key} type="button" onClick={() => setSelected(m.key)} className={'lbr-mod' + (selected === m.key ? ' sel' : '') + (hitActive(m.key) ? ' hit' : '')}
                        style={{ minHeight: 56, padding: '8px 10px', borderRadius: 12, border: `1px solid ${m.color}55`, background: 'rgba(8,10,26,.9)', color: '#E7ECF8', textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 2, boxShadow: `0 0 12px ${m.color}33` }}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 12, fontWeight: 700 }}>{m.title}</span><span className={st === 'ok' ? '' : 'lbr-blink'} style={{ width: 8, height: 8, flex: 'none', borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}` }} /></span>
                        <span style={{ fontSize: 10, color: st === 'ok' ? '#A3B0D0' : c, lineHeight: 1.4 }}>{v?.metric || '…'}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {wall ? <div className="lbr-sel-wall" style={{ flex: 'none', maxHeight: '30%', overflowY: 'auto' }}>{selectedBlock}</div> : selectedBlock}
            </section>
  );
  const pulseEl = (
            <section aria-label="نبض النشاط" data-mod="monitor core" data-station="check:core.events,core.rejections" data-st-name="نبض النشاط" className="lbr-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                <h2 className="lbr-h">نبض النشاط الحقيقي — آخر 5 دقائق</h2>
                <span className="lbr-mono" style={{ fontSize: 11, color: '#93A1C3' }}>{perMinute} حدث/دقيقة · {sum(buckets)} في 5 د</span>
              </div>
              <svg viewBox="0 0 600 80" width="100%" height="90" preserveAspectRatio="none" role="img" aria-label="عدد الأحداث الحقيقية لكل 10 ثوانٍ">
                <defs><linearGradient id="lbrWave" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E879F9" stopOpacity=".5" /><stop offset="100%" stopColor="#38BDF8" stopOpacity="0" /></linearGradient></defs>
                {[20, 40, 60].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="#1B2550" strokeDasharray="2 6" />)}
                {wave.area && <path d={wave.area} fill="url(#lbrWave)" transform="translate(0 6)" />}
                {wave.line && <path d={wave.line} fill="none" stroke="#F0ABFC" strokeWidth="2" transform="translate(0 6)" style={{ filter: 'drop-shadow(0 0 6px #E879F9)' }} />}
                {wave.line && <path d={wave.line} fill="none" stroke="#FFFFFF" strokeWidth="2.5" className="lbr-heart" transform="translate(0 6)" />}
              </svg>
            </section>
  );
  const interEl = (
              <section className="lbr-panel" data-mod="customers" aria-label="تفاعلات 24 ساعة" data-station="check:customers.inbound" data-st-name="تفاعلات 24 ساعة">
                <h2 className="lbr-h" style={{ marginBottom: 10 }}>تفاعلات الزبائن — 24 ساعة</h2>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
                  {hourly.map((v, i) => (
                    <div key={i} title={`${v} تفاعل · ${hourlyInq[i] || 0} استفسار`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 1 }}>
                      <div className="lbr-bar" style={{ height: `${(v / maxHour) * 100}%`, minHeight: v ? 3 : 1, borderRadius: '4px 4px 0 0', background: 'linear-gradient(180deg, #7DD3FC, #3B82F6)', boxShadow: v ? '0 0 10px rgba(125,211,252,.6)' : 'none', position: 'relative' }}>
                        {hourlyInq[i] ? <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${(hourlyInq[i] / Math.max(1, v)) * 100}%`, background: 'linear-gradient(180deg, #F0ABFC, #C026D3)', borderRadius: 2 }} /> : null}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#7C89AD', marginTop: 4 }}><span>قبل 24 س</span><span>الآن</span></div>
                {data && sum(hourly) === 0 && <div style={{ fontSize: 12, color: '#93A1C3', marginTop: 6 }}>لا تفاعلات من الزبائن في آخر 24 ساعة — يظهر كل تعليق أو رسالة هنا لحظة وصوله.</div>}
                <div style={{ display: 'flex', gap: 12, fontSize: 11, marginTop: 6 }}><span style={{ color: '#7DD3FC' }}>■ تفاعلات</span><span style={{ color: '#F0ABFC' }}>■ استفسارات تجارية</span></div>
              </section>
  );
  const intentsEl = (
              <section className="lbr-panel" data-mod="customers" aria-label="نوايا الزبائن" data-station="check:customers.escalations" data-st-name="نوايا الزبائن">
                <h2 className="lbr-h" style={{ marginBottom: 10 }}>ماذا يريد الزبائن؟ — النوايا</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="توزيع نوايا الزبائن">
                    <circle cx="60" cy="60" r="44" fill="none" stroke="#141B3D" strokeWidth="14" />
                    {donut.map((d) => <path key={d.key} d={arc(d.start, d.frac, 44)} fill="none" stroke={d.color} strokeWidth="14" style={{ filter: `drop-shadow(0 0 5px ${d.color})` }} />)}
                    <text x="60" y="58" textAnchor="middle" fontSize="18" fontWeight="700" fill="#E7ECF8" className="lbr-mono">{fmt(sum(intents.map((x) => x.count)))}</text>
                    <text x="60" y="74" textAnchor="middle" fontSize="9" fill="#93A1C3">تفاعل مصنّف</text>
                  </svg>
                  <div style={{ flex: 1, minWidth: 140, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {donut.map((d) => (
                      <div key={d.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: d.color, boxShadow: `0 0 6px ${d.color}` }} />{d.label}</span>
                        <span className="lbr-mono" style={{ color: '#C9D3EA' }}>{fmt(d.count)} · {Math.round(d.frac * 100)}%</span>
                      </div>
                    ))}
                    {!donut.length && <span style={{ fontSize: 12, color: '#93A1C3' }}>لا تصنيفات بعد.</span>}
                  </div>
                </div>
              </section>
  );
  const topicsEl = (
              <section className="lbr-panel" data-mod="customers" aria-label="مواضيع الأسئلة" data-station="check:customers.inbound,customers.escalations" data-st-name="مواضيع الأسئلة">
                <h2 className="lbr-h" style={{ marginBottom: 10 }}>عن ماذا يسألون؟ — المواضيع</h2>
                {(ins.topics || []).map((t: any, i: number) => {
                  const max = Math.max(1, ...(ins.topics || []).map((x: any) => x.count));
                  const c = ['#F0ABFC', '#7DD3FC', '#FCD34D', '#6EE7B7', '#A5B4FC', '#FDA4AF', '#67E8F9', '#C4B5FD'][i % 8];
                  return (
                    <div key={t.key} data-station="check:customers.inbound" data-st-name={String(t.label || 'موضوع')} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{t.label}</span><span className="lbr-mono" style={{ color: '#C9D3EA' }}>{fmt(t.count)}</span></div>
                      <div style={{ height: 7, borderRadius: 999, background: '#141B3D', overflow: 'hidden' }}><div className="lbr-bar" style={{ height: 7, width: `${(t.count / max) * 100}%`, background: `linear-gradient(90deg, ${c}, ${c}88)`, boxShadow: `0 0 10px ${c}` }} /></div>
                    </div>
                  );
                })}
                {!(ins.topics || []).length && <span style={{ fontSize: 12, color: '#93A1C3' }}>لا مواضيع مصنّفة بعد.</span>}
              </section>
  );
  const prodsEl = (
              <section className="lbr-panel" data-mod="products" aria-label="أكثر المنتجات سؤالاً" data-station="check:products.count,products.integrity" data-st-name="المنتجات">
                <h2 className="lbr-h" style={{ marginBottom: 10 }}>أكثر المنتجات طلباً من الزبائن</h2>
                {(ins.topProducts || []).map((p: any, i: number) => {
                  const max = Math.max(1, ...(ins.topProducts || []).map((x: any) => x.count));
                  return (
                    <div key={p.name} data-station="check:products.stock,products.images" data-st-name={String(p.name)} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span className="lbr-mono" style={{ width: 20, height: 20, flex: 'none', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, background: i === 0 ? '#F0ABFC' : '#1B2550', color: i === 0 ? '#05070F' : '#C9D3EA' }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span><span className="lbr-mono" style={{ color: '#C9D3EA' }}>{p.count}</span></div>
                        <div style={{ height: 5, borderRadius: 999, background: '#141B3D', overflow: 'hidden' }}><div className="lbr-bar" style={{ height: 5, width: `${(p.count / max) * 100}%`, background: 'linear-gradient(90deg, #FB7185, #F0ABFC)', boxShadow: '0 0 8px #FB7185' }} /></div>
                      </div>
                    </div>
                  );
                })}
                {!(ins.topProducts || []).length && <span style={{ fontSize: 12, color: '#93A1C3' }}>لم يُحدَّد منتج من أسئلة الزبائن بعد.</span>}
              </section>
  );
  const platInsEl = (
              <section className="lbr-panel" data-mod="platforms memory" aria-label="المنصات" data-station="check:memory.measured,memory.records,memory.sync" data-st-name="قياس المنصات">
                <h2 className="lbr-h" style={{ marginBottom: 10 }}>المنصات — جمهور ووارد ونشر</h2>
                {(ins.byPlatform || []).map((p: any) => {
                  const pl = plats.find((x) => x.id === p.platform);
                  const max = Math.max(1, ...(ins.byPlatform || []).map((x: any) => x.total));
                  const pub = (ins.publish || []).find((x: any) => x.platform === p.platform);
                  const c = PLATFORM_COLOR[p.platform] || '#A5B4FC';
                  return (
                    <div key={p.platform} data-station="check:memory.measured,platforms.audience" data-st-name={PLATFORM_AR[p.platform] || p.platform} style={{ marginBottom: 9 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12 }}>
                        <span style={{ color: c, fontWeight: 600 }}>{p.label}</span>
                        <span className="lbr-mono" style={{ color: '#C9D3EA', fontSize: 11 }}>{fmt(p.total)} وارد · {p.last24h} اليوم{typeof pl?.followers === 'number' ? ` · ${fmt(pl.followers)} متابع` : ''}{pub ? ` · ${fmt(pub.published)} منشور${pub.scheduled ? ` + ${fmt(pub.scheduled)} مجدول` : ''}` : ''}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 999, background: '#141B3D', overflow: 'hidden' }}><div className="lbr-bar" style={{ height: 6, width: `${(p.total / max) * 100}%`, background: `linear-gradient(90deg, ${c}, ${c}66)`, boxShadow: `0 0 8px ${c}` }} /></div>
                    </div>
                  );
                })}
              </section>
  );
  const leadsEl = (
              <section className="lbr-panel" data-mod="owner gate" aria-label="مراحل الزبائن" data-station="check:customers.leads,owner.pending" data-st-name="مراحل الزبائن">
                <h2 className="lbr-h" style={{ marginBottom: 10 }}>رحلة الزبائن المحتملين</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(ins.leadStages || []).map((s: any) => (
                    <div key={s.key} data-station="check:customers.leads" data-st-name={STAGE_AR[s.key] || String(s.key)} style={{ padding: '8px 12px', borderRadius: 12, border: '1px solid rgba(240,171,252,.3)', background: 'rgba(42,15,69,.35)', textAlign: 'center', minWidth: 84 }}>
                      <div className="lbr-mono" style={{ fontSize: 20, fontWeight: 700, color: '#F0ABFC', textShadow: '0 0 12px rgba(240,171,252,.6)' }}>{s.count}</div>
                      <div style={{ fontSize: 11, color: '#C9D3EA' }}>{STAGE_AR[s.key] || s.key}</div>
                    </div>
                  ))}
                  {!(ins.leadStages || []).length && <span style={{ fontSize: 12, color: '#93A1C3' }}>لا زبائن محتملين بعد.</span>}
                </div>
                {appr.latest && (
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: '1px solid rgba(252,211,77,.4)', background: 'linear-gradient(135deg, rgba(120,80,10,.25), rgba(10,12,30,.6))', boxShadow: '0 0 24px rgba(252,211,77,.12)' }}>
                    <div style={{ fontSize: 11, color: '#FCD34D', marginBottom: 4 }}>أحدث رد بانتظار موافقتك · {appr.latest.platform} · {ago(appr.latest.at, now)}</div>
                    <div style={{ fontSize: 13, lineHeight: 1.7 }}>«{appr.latest.text}»</div>
                  </div>
                )}
              </section>
  );
  const voicesEl = (
            <section aria-label="أصوات الزبائن" className="lbr-panel" data-mod="customers" data-station="check:customers.inbound,platforms.webhook" data-st-name="أصوات الزبائن" style={flexPanel}>
              <h2 className="lbr-h" style={{ marginBottom: 10 }}>أصوات الزبائن — آخر ما وصل</h2>
              <div style={{ ...(wall ? { flex: '1 1 0', minHeight: 60 } : { height: 170 }), overflow: 'hidden', maskImage: 'linear-gradient(180deg, transparent, #000 15%, #000 85%, transparent)' }}>
                <div className={(ins.latestComments || []).length > 3 ? 'lbr-ticker' : ''}>
                  {[...(ins.latestComments || []), ...((ins.latestComments || []).length > 3 ? ins.latestComments : [])].map((c: any, i: number) => (
                    <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 4px', borderBottom: '1px solid rgba(27,37,80,.6)' }}>
                      <span style={{ width: 8, height: 8, marginTop: 6, flex: 'none', borderRadius: '50%', background: PLATFORM_COLOR[c.platform] || '#A5B4FC', boxShadow: `0 0 8px ${PLATFORM_COLOR[c.platform] || '#A5B4FC'}` }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, lineHeight: 1.6 }}>«{c.text}»</div>
                        <div style={{ fontSize: 10, color: '#7C89AD' }}>{c.label} · {c.intent} · {ago(c.at, now)}</div>
                      </div>
                    </div>
                  ))}
                  {!(ins.latestComments || []).length && <div style={{ fontSize: 12, color: '#93A1C3' }}>لا تعليقات بعد.</div>}
                </div>
              </div>
            </section>
  );
  const journeyEl = (
            <section aria-label="السير العام" data-mod="owner automation" data-station="check:automation.jobs,automation.failed" data-st-name="السير العام" className="lbr-panel">
              <h2 className="lbr-h" style={{ marginBottom: wall ? 6 : 10 }}>{wall ? 'السير العام — يضيء مع آخر حدث' : 'السير العام — تضيء الخطوة التي وقع فيها آخر حدث'}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: wall ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(150px, 1fr))', gap: wall ? 6 : 10 }}>
                {JOURNEY.map((j, i) => (
                  <div key={j.title} data-station={JOURNEY_ST[i % JOURNEY_ST.length]} data-st-name={j.title} title={wall ? j.detail : undefined} className={'lbr-step' + (i === journeyIdx ? ' on' : '')} style={{ padding: wall ? '5px 10px' : '10px 12px', border: '1px solid rgba(99,102,241,.25)', borderRadius: 14, display: 'flex', gap: 10, alignItems: 'flex-start', background: 'rgba(6,9,24,.6)', transition: 'all .4s' }}>
                    <span className="lbr-mono" style={{ width: 28, height: 28, flex: 'none', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, background: j.badge, color: '#05070F', boxShadow: `0 0 14px ${j.badge}` }}>{i + 1}</span>
                    <div><div style={{ fontSize: 13, fontWeight: 700 }}>{j.title}</div>{!wall && <div style={{ fontSize: 11, color: '#93A1C3' }}>{j.detail}</div>}</div>
                  </div>
                ))}
              </div>
            </section>
  );
  const ENG_STATUS: Record<string, [string, string]> = { resolved: ['أُصلح', '#34D399'], escalated: ['صُعِّد إليك', '#F87171'], retrying: ['سيعيد المحاولة', '#FBBF24'], deferred: ['مؤجّل', '#FBBF24'], monitoring: ['تحت المراقبة', '#38BDF8'], self_recovered: ['تعافى', '#A5B4FC'] };
  const SEC_AR: Record<string, string> = { core: 'المركز', ...Object.fromEntries(MODS.map((m) => [m.key, m.title])) };
  const ST_COL: Record<string, string> = { ok: '#34D399', warn: '#FBBF24', fail: '#F87171', skip: '#64748B' };
  const ST_ICON: Record<string, string> = { ok: '✓', warn: '⚠', fail: '✗', skip: '–' };
  const score: number | null = typeof patrol?.score === 'number' ? patrol.score : null;
  const scoreCol = score == null ? '#93A1C3' : score >= 90 ? '#34D399' : score >= 70 ? '#FBBF24' : '#F87171';
  // الاستطلاع الخفيف لا يحمل الفحوص الكاملة: نحتفظ بآخر نسخة كاملة ونحدّث القسم الجاري منها.
  const inspCache = useRef<any[]>([]);
  if (Array.isArray(patrol?.inspections)) inspCache.current = patrol.inspections;
  else if (patrol?.current?.module) inspCache.current = [...inspCache.current.filter((x) => x.module !== patrol.current.module), patrol.current];
  const inspections: any[] = inspCache.current;
  const selInsp = patrolSel ? inspections.find((x) => x.module === patrolSel) : null;
  const engineerEl = (
            <section className="lbr-panel lbr-eng" aria-label="المهندس المشرف" data-station="check:storage.ready,storage.tls,core.scope" data-st-name="المهندس المشرف" style={wall ? { ...flexPanel, minHeight: 360, overflow: 'hidden' } : undefined}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <h2 className="lbr-h">المهندس المشرف — حارس المشروع</h2>
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <button type="button" className="lbr-eng-btn" disabled={engBusy || !eng} onClick={() => void engCheck()}>افحص الآن</button>
                  <button type="button" className="lbr-eng-btn" disabled={engBusy || !eng} aria-pressed={Boolean(eng?.enabled)} onClick={() => void engToggle()} style={{ borderColor: eng?.enabled ? '#34D399' : '#F87171', color: eng?.enabled ? '#6EE7B7' : '#FCA5A5' }}>{eng?.enabled ? '● يُصلح' : '○ الإصلاح متوقف'}</button>
                </span>
              </div>
              {!eng ? <div style={{ fontSize: 12, color: '#93A1C3' }}>{data ? 'المهندس غير متاح على هذا الخادم بعد.' : 'جارٍ الاتصال…'}</div> : (
                <>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div className="lbr-score" style={{ borderColor: scoreCol, color: scoreCol, boxShadow: `0 0 18px ${scoreCol}55` }} title="صحة المشروع من آخر فحص لكل قسم">
                      <b>{score == null ? '—' : `${score}%`}</b><span>صحة المشروع</span>
                    </div>
                    <div className={'lbr-eng-now' + (eng.job ? ' busy' : '')} style={{ flex: 1, minWidth: 0 }}>
                      {eng.job
                        ? <><b>🕷 يُصلح الآن:</b> {eng.job.title}<div style={{ fontSize: 11, color: '#FDE68A' }}>{eng.job.phase === 'verifying' ? 'يتحقق من زوال العطل…' : `الخطوة: ${eng.job.step}`}</div></>
                        : spider.phase !== 'home' ? <><b>🕷 {spider.phase === 'back' ? 'يعود إلى المركز' : 'في طريقه للإصلاح'}:</b> {spider.label}</>
                        : patrol?.cursor ? <><b>🕸 يتجوّل ويفحص:</b> {SEC_AR[patrol.cursor] || patrol.cursor}<div style={{ fontSize: 11, color: '#93A1C3' }}>الجولة {fmt(patrol.round || 0)} · {fmt(patrol.checksTotal || 0)} فحصاً · قسم كل {Math.round((patrol.stepMs || 5000) / 1000)} ث · أُصلح {fmt(eng.stats?.resolved24h || 0)} اليوم</div></>
                        : <><b>🕸 يستعد للدورية…</b><div style={{ fontSize: 11, color: '#93A1C3' }}>تبدأ بعد دقيقة من الإقلاع</div></>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, margin: '6px 0' }}>
                    {([['gaps', `الثغرات (${(patrol?.gaps || []).length})`], ['reports', `التقارير (${(eng.reports || []).length})`], ['sections', 'تفاصيل القسم']] as const).map(([k, t]) => (
                      <button key={k} type="button" className={'lbr-tab' + (patrolTab === k ? ' on' : '')} onClick={() => setPatrolTab(k)}>{t}</button>
                    ))}
                  </div>
                  <div style={{ ...(wall ? { flex: '1 1 0', minHeight: 0 } : { maxHeight: 380 }), overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {patrolTab === 'gaps' && (
                      (patrol?.gaps || []).length === 0
                        ? <div style={{ fontSize: 12, color: '#6EE7B7' }}>{patrol?.round ? 'لا ثغرات في آخر جولة — كل ما فُحص سليم.' : 'الجولة الأولى قيد التنفيذ…'}</div>
                        : (patrol.gaps as any[]).map((g) => (
                          <div key={g.id} className="lbr-gap" style={{ borderColor: `${ST_COL[g.status]}66` }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}><b style={{ color: ST_COL[g.status] }}>{ST_ICON[g.status]}</b><b style={{ flex: 1 }}>{g.label}</b><span style={{ fontSize: 10, color: '#7C89AD' }}>{SEC_AR[g.module] || g.module}</span></div>
                            <div style={{ color: '#C9D3EA' }}>{g.detail}</div>
                            {g.advice && <div style={{ color: g.repair ? '#6EE7B7' : '#FCD34D' }}>{g.repair ? '🔧 ' : '👤 '}{g.advice}</div>}
                          </div>
                        ))
                    )}
                    {patrolTab === 'sections' && (
                  <div className="lbr-secgrid" style={{ marginTop: 0 }} role="list" aria-label="أقسام الدورية">
                    {(patrol?.order || []).map((k: string) => {
                      const r = patrolMod(k); const st = r?.status || 'skip';
                      return (
                        <button key={k} type="button" role="listitem" className={'lbr-sec' + (patrol?.cursor === k ? ' cur' : '') + (patrolSel === k ? ' sel' : '')} style={{ borderColor: `${ST_COL[st]}88` }} title={`${SEC_AR[k] || k}: ${r ? `${r.counts.ok} سليم · ${r.counts.warn} تحذير · ${r.counts.fail} عطل` : 'لم يُفحص بعد'}`} onClick={() => { setPatrolSel(k === patrolSel ? null : k); setPatrolTab('sections'); }}>
                          <i style={{ background: ST_COL[st], boxShadow: `0 0 6px ${ST_COL[st]}` }} />{SEC_AR[k] || k}
                        </button>
                      );
                    })}
                  </div>
                    )}
                    {patrolTab === 'sections' && (
                      !selInsp ? <div style={{ fontSize: 12, color: '#93A1C3' }}>{inspections.length ? 'اختر قسماً من الأعلى لترى كل فحوصه.' : 'تظهر التفاصيل مع أول تحديث كامل (كل 30 ث).'}</div> : (
                        <>
                          <div style={{ fontSize: 11, color: '#93A1C3' }}>{SEC_AR[selInsp.module]} · فُحص {ago(selInsp.at, now)}</div>
                          {selInsp.checks.map((c: any) => (
                            <div key={c.id} className="lbr-gap" style={{ borderColor: `${ST_COL[c.status]}55` }}>
                              <div style={{ display: 'flex', gap: 6 }}><b style={{ color: ST_COL[c.status] }}>{ST_ICON[c.status]}</b><b style={{ flex: 1 }}>{c.label}</b></div>
                              <div style={{ color: '#C9D3EA' }}>{c.detail}</div>
                              <div style={{ color: '#7C89AD' }}>لماذا: {c.why}</div>
                              {c.advice && <div style={{ color: '#FCD34D' }}>العمل: {c.advice}</div>}
                            </div>
                          ))}
                        </>
                      )
                    )}
                    {patrolTab === 'reports' && (
                      !(eng?.reports || []).length ? <div style={{ fontSize: 12, color: '#6EE7B7' }}>لا تقارير بعد — لم يحتج أي قسم إلى تدخّل.</div> :
                      (eng?.reports || []).map((r: any) => {
                        const [t, c] = ENG_STATUS[r.status] || ['—', '#93A1C3'];
                        return (
                          <details key={r.id} className="lbr-eng-rep">
                            <summary>
                              <span className="lbr-eng-badge" style={{ borderColor: c, color: c }}>{t}</span>
                              <span style={{ flex: 1, minWidth: 0 }}>{r.title}</span>
                              <span className="lbr-mono" style={{ fontSize: 10, color: '#7C89AD', flex: 'none' }}>{ago(r.endedAt, now)}</span>
                            </summary>
                            <div style={{ fontSize: 11.5, lineHeight: 1.7, color: '#C9D3EA', padding: '6px 2px 2px' }}>
                              <div>{r.summary}</div>
                              {(r.evidence || []).length > 0 && <div style={{ color: '#93A1C3' }}>الدليل: {(r.evidence || []).join(' · ')}</div>}
                              {(r.steps || []).map((st: any, i: number) => (
                                <div key={i} style={{ display: 'flex', gap: 6 }}><span style={{ color: st.ok ? '#34D399' : '#F87171' }}>{st.ok ? '✓' : '✗'}</span><span><b>{st.label}</b> — {st.detail} <span className="lbr-mono" style={{ fontSize: 10, color: '#6B7AA0' }}>{clock(st.at)}</span></span></div>
                              ))}
                              <div><b>التحقق:</b> {r.verification}</div>
                              <div style={{ color: '#93A1C3' }}>المحاولة {r.attempt} · المدة {Math.max(1, Math.round((r.durationMs || 0) / 1000))} ث{r.nextAction ? ` · التالي: ${r.nextAction}` : ''}</div>
                            </div>
                          </details>
                        );
                      })
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: '#6B7AA0', marginTop: 6, lineHeight: 1.6 }}>يتجوّل ويفحص كل الأقسام بلا توقف · يُصلح الآمن فقط ويتحقق · لا يغيّر قراراتك ولا يحذف · {eng.policy?.maxAttempts || 3} محاولات ثم يصعّد إليك · حد {eng.policy?.maxActionsPerHour || 12} إجراء/ساعة</div>
                </>
              )}
            </section>
  );
  const gaugesEl = (
            <section className="lbr-panel" data-mod="monitor storage">
              <h2 className="lbr-h" style={{ marginBottom: 12 }}>جسد الخادم — مقاييس حيّة</h2>
              <div className="lbr-gauges" style={{ display: 'grid', gridTemplateColumns: wall ? 'repeat(4, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))', gap: wall ? 6 : 10 }}>
                <Gauge value={tel.rssMb ?? null} max={tel.limitMb || 512} station="check:monitor.memory,monitor.heap,monitor.leak" label="الذاكرة" text={`${tel.rssMb ?? '—'} / ${tel.limitMb || 512} ميغا`} color={(tel.rssMb || 0) > 400 ? '#F87171' : '#34D399'} />
                <Gauge value={tel.geminiLimit ? tel.geminiUsedToday : null} max={tel.geminiLimit || 1} station="check:external.geminiQuota,external.gemini" label="Gemini اليوم" text={`${tel.geminiUsedToday ?? 0} / ${tel.geminiLimit || '—'} طلب`} color="#A78BFA" />
                <Gauge value={tel.pressurePercent} max={100} station="check:monitor.pressure" label="استهلاك الخطة" text={tel.pressurePercent == null ? `${tel.pressureLevel || '—'}` : `${tel.pressureProvider || ''} · ${tel.pressureLevel}`} color={tel.pressureLevel === 'normal' ? '#22D3EE' : '#FBBF24'} />
                <Gauge value={tel.writes ? tel.writes.coalesced : null} max={Math.max(1, (tel.writes?.coalesced || 0) + (tel.writes?.written || 0))} station="check:storage.coalesce,storage.persist" label="كتابات موفّرة" text={`${tel.writes?.coalesced ?? 0} مدموجة من ${(tel.writes?.coalesced || 0) + (tel.writes?.written || 0)}`} color="#2DD4BF" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10, fontSize: 11, color: '#93A1C3' }}>
                <span data-station="check:monitor.lag" data-st-name="حلقة الأحداث">تأخّر حلقة الأحداث: <span className="lbr-mono" style={{ color: (tel.loopLagMs || 0) > 200 ? '#FBBF24' : '#6EE7B7' }}>{tel.loopLagMs ?? '—'} ms</span></span>
                <span data-station="check:core.uptime" data-st-name="مدة التشغيل">يعمل منذ <span className="lbr-mono" style={{ color: '#E7ECF8' }}>{tel.uptimeSec ? Math.round(tel.uptimeSec / 60) : '—'} د</span></span>
              </div>
            </section>
  );
  const eventsEl = (
            <section className="lbr-panel" data-mod="core" data-station="check:core.events,core.rejections" data-st-name="آخر الأحداث" style={flexPanel}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h2 className="lbr-h">آخر الأحداث</h2>
                <span className="lbr-blink" style={{ fontSize: 11, color: '#6EE7B7' }}>● مباشر</span>
              </div>
              {events.length === 0 && <div style={{ fontSize: 12, color: '#93A1C3', padding: '8px 0' }}>{data ? 'لم يقع حدث منذ إقلاع الخادم بعد — سيظهر هنا لحظة وقوعه.' : 'جارٍ الاتصال بالخادم…'}</div>}
              <div style={{ ...(wall ? { flex: '1 1 0', minHeight: 0 } : { maxHeight: 560 }), overflowY: 'auto' }}>
                {events.slice(0, 30).map((e) => {
                  const c = LEVEL_COLOR[e.level] || '#93A1C3';
                  return (
                    <div key={e.id} className={freshIds.has(e.id) ? 'lbr-evt-new' : ''} style={{ display: 'flex', gap: 10, padding: '8px 6px', borderBottom: '1px solid rgba(27,37,80,.6)', borderRadius: 8 }}>
                      <span style={{ width: 10, height: 10, marginTop: 5, flex: 'none', borderRadius: '50%', background: c, boxShadow: `0 0 10px ${c}` }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{e.title}</div>
                        {e.text && <div style={{ fontSize: 11, color: '#A3B0D0', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{e.text}</div>}
                        <div style={{ fontSize: 10, color: MOD_BY_KEY[e.module]?.color || '#6B7AA0' }}>{MOD_BY_KEY[e.module]?.title || 'العقل المركزي'}</div>
                      </div>
                      <span className="lbr-mono" style={{ fontSize: 10, color: '#93A1C3', flex: 'none' }}>{clock(e.at)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
  );
  const platStatusEl = (
            <section className="lbr-panel" data-mod="platforms external">
              <h2 className="lbr-h" style={{ marginBottom: 8 }}>حالة المنصات العشر</h2>
              {/* في الشاشة الحية: عمودان متجاوران بدل قائمة طويلة، لتوفير الارتفاع. */}
              <div style={wall ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 14 } : undefined}>
              {plats.map((p: any) => {
                const c = p.connected ? (p.partial ? STATUS_COLOR.partial : STATUS_COLOR.ok) : STATUS_COLOR.off;
                const txt = p.connected ? (p.partial ? `متصل — ${p.partial}` : `متصل${typeof p.followers === 'number' ? ` · ${fmt(p.followers)}` : ''}`) : 'غير مربوط';
                return (
                  <div key={p.id} data-station={p.connected ? 'check:platforms.token,platforms.expiry,platforms.reauth' : 'check:platforms.verified'} data-st-name={PLATFORM_AR[p.id] || p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: wall ? 'flex-start' : 'center', flexDirection: wall ? 'column' : 'row', gap: wall ? 2 : 8, padding: wall ? '5px 0' : '7px 0', borderBottom: '1px solid rgba(27,37,80,.6)', fontSize: wall ? 11.5 : 12 }}>
                    <span style={{ color: PLATFORM_COLOR[p.id] || '#E7ECF8', fontWeight: 600 }}>{PLATFORM_AR[p.id] || p.id}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: c, textAlign: 'left' }}><span className={p.connected && !p.partial ? '' : 'lbr-blink'} style={{ width: 8, height: 8, flex: 'none', borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}` }} />{txt}</span>
                  </div>
                );
              })}
              </div>
            </section>
  );
  const cyclesEl = (
            <section className="lbr-panel" data-mod="automation agents backup memory">
              <h2 className="lbr-h" style={{ marginBottom: 8 }}>نبض الدورات 24/7</h2>
              {pulseRows.map((c) => (
                <div key={c.key} data-station={CYCLE_ST[c.key] || 'check:automation.timers'} data-st-name={c.name} title={c.title || undefined} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(27,37,80,.6)', fontSize: 12 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {/* النقطة تنبض فقط حين تعمل الدورة في موعدها؛ وإلا تأخذ لون حالتها ثابتة. */}
                    <span className={c.ok ? 'lbr-blink' : ''} style={{ width: 7, height: 7, flex: 'none', borderRadius: '50%', background: c.ok ? c.color : c.stateColor, boxShadow: `0 0 8px ${c.ok ? c.color : c.stateColor}` }} />
                    {c.name}{c.sub && <span style={{ color: '#6B7AA0', fontSize: 10 }}>{c.sub}</span>}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                    {c.state && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 999, border: `1px solid ${c.stateColor}`, color: c.stateColor }}>{c.state}</span>}
                    <span className="lbr-mono" style={{ fontSize: 11, color: '#C9D3EA' }}>{c.value}</span>
                  </span>
                </div>
              ))}
              {!pulseRows.length && <div style={{ fontSize: 12, color: '#93A1C3', padding: '6px 0' }}>{data ? 'لا بيانات دورات من الخادم.' : 'جارٍ الاتصال…'}</div>}
              {pulseRows.some((c) => c.note && !c.ok) && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#93A1C3', lineHeight: 1.6 }}>
                  {pulseRows.filter((c) => c.note && !c.ok).map((c) => <div key={'n' + c.key}><span style={{ color: c.stateColor }}>● </span>{c.name}: {c.note}</div>)}
                </div>
              )}
            </section>
  );
  const legendEl = (
            <section className="lbr-panel" style={{ fontSize: 12 }}>
              <div style={{ color: '#93A1C3', marginBottom: 8 }}>مفتاح الحالة</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {(['ok', 'partial', 'off'] as const).map((k) => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: STATUS_COLOR[k], boxShadow: `0 0 8px ${STATUS_COLOR[k]}` }} />{STATUS_TEXT[k]}</span>)}
              </div>
            </section>
  );

  // العنكبوت المتجوّل على كل الواجهة: يتبع الدورية الحقيقية، والإصلاح يتقدّم عليها.
  const spiderEl = (root: React.RefObject<HTMLDivElement>) => eng ? (
    <SpiderPatrol
      rootRef={root}
      inspections={inspections}
      current={patrol?.current || null}
      titles={SEC_AR}
      repair={eng?.job ? { module: String(eng.job.module), label: String(eng.job.title) } : spider.phase !== 'home' && spider.module ? { module: spider.module, label: spider.label } : null}
      motion={motion}
    />
  ) : null;
  const backdrop = (
    <>
      <style>{CSS}</style>
      <style>{SPIDER_CSS}</style>
      <div className="lbr-stars" />
      <div className="lbr-grid" />
      <div className="lbr-scan" />
    </>
  );

  // تخطيط الصفحة العادي (كما كان) — يُستخدم في التبويب، وفي الشاشة الحية على الشاشات الضيقة.
  const pageBody = (
    <>
      {headerEl}

      <div style={{ position: 'relative', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {sleepEl}
        {alertEl}
        {kpisEl}

        {controlEl}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <main style={{ flex: '999 1 680px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {mapEl}
            {pulseEl}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
              {interEl}
              {intentsEl}
              {topicsEl}
              {prodsEl}
              {platInsEl}
              {leadsEl}
            </div>
            {voicesEl}
            {journeyEl}
          </main>

          <aside aria-label="اللوحات الحية" style={{ flex: '1 1 300px', maxWidth: 400, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {engineerEl}
            {gaugesEl}
            {eventsEl}
            {platStatusEl}
            {cyclesEl}
            {legendEl}
          </aside>
        </div>
      </div>
    </>
  );

  if (!wall) {
    return (
      <div ref={pageRootRef} dir="rtl" className={'lbr' + (motion ? '' : ' lbr-still')} style={{ position: 'relative', background: 'radial-gradient(ellipse 90% 60% at 50% 22%, #170F3A 0%, #070A1A 55%, #03040B 100%)', color: '#E7ECF8', borderRadius: 22, border: '1px solid #1A2350', overflow: 'hidden' }}>
        {backdrop}
        {pageBody}
        {spiderEl(pageRootRef)}
      </div>
    );
  }

  // الشاشة الحية: كل اللوحات في شاشة واحدة بلا تمرير — خمسة أعمدة تملأ الشاشة، ثم
  // تُصغَّر الكتلة كلها بالمقدار اللازم فقط حتى لا يخرج شيء عن حدود الشاشة.
  const wallBody = (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', gap: 10, padding: '0 0 10px' }}>
      {headerEl}
      {sleepEl}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 3.2fr)', gap: 10, padding: '0 12px', flex: 'none', alignItems: 'stretch' }}>
        {alertEl}
        {kpisEl}
      </div>
      <div ref={wallGridRef} className="lbr-wallgrid">
        <div className="lbr-col">{controlEl}</div>
        <div className="lbr-col">{mapEl}{pulseEl}</div>
        <div className="lbr-col">{interEl}{intentsEl}{topicsEl}{prodsEl}{voicesEl}</div>
        <div className="lbr-col">{engineerEl}{platInsEl}{leadsEl}{journeyEl}</div>
        <div className="lbr-col">{gaugesEl}{cyclesEl}{platStatusEl}{eventsEl}</div>
      </div>
    </div>
  );

  return (
    <div ref={wallRef} dir="rtl" role="dialog" aria-modal="true" aria-label="الشاشة الحية — اللوحة الحية كاملة" className={'lbr lbr-wall' + (motion ? '' : ' lbr-still')}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'radial-gradient(ellipse 90% 60% at 50% 22%, #170F3A 0%, #070A1A 55%, #03040B 100%)', color: '#E7ECF8', overflowX: 'hidden', overflowY: fitMode ? 'hidden' : 'auto' }}>
      {backdrop}
      {fitMode ? (
        <div ref={wallInnerRef} style={{ position: 'absolute', top: 0, right: 0, width: wallBox.w / wallScale, height: wallBox.h / wallScale, transform: `scale(${wallScale})`, transformOrigin: 'top right' }}>
          {wallBody}
          {spiderEl(wallInnerRef)}
        </div>
      ) : (
        <div ref={wallPageRef} style={{ position: 'relative' }}>{pageBody}{spiderEl(wallPageRef)}</div>
      )}
    </div>
  );
};
