import React, { useEffect, useRef, useState } from 'react';
import { apiService } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { focusFeature } from '../common/featureSearch';

/**
 * مركز السيطرة داخل غرفة العقل الحية (2026-10-26).
 *
 * كل ما يحتاج عين المالك في مكان واحد ومن مصدر واحد (`/api/live/room`):
 *  - شريط إنذار علوي ينبض بحسب أخطر حالة قائمة.
 *  - كل مفاتيح الأمان: العقل التجاري، وضع الإرسال، مراقبو يوتيوب/ميتا/تيليغرام،
 *    النشر التلقائي، تنبيهات المالك — مع «إيقاف طارئ شامل».
 *  - كل التنبيهات: تنبيهات النظام، الإشعارات (مقروء/الكل)، والتصعيدات (اطّلاع/حل).
 * أي تغيير يمرّ بمسار الخادم الرسمي نفسه (requireOwner + سجل التدقيق)، والتحويل
 * نحو «أتمتة أكثر» أو «تنبيه أقل» يطلب تأكيداً صريحاً. الإيقاف فوري (أمان أولاً).
 */

type Sev = 'critical' | 'warning' | 'info';
const SEV: Record<Sev, { c: string; bg: string; t: string }> = {
  critical: { c: '#F87171', bg: 'rgba(127,29,29,.35)', t: 'حرج' },
  warning: { c: '#FBBF24', bg: 'rgba(120,80,10,.28)', t: 'انتباه' },
  info: { c: '#38BDF8', bg: 'rgba(12,74,110,.25)', t: 'معلومة' },
};
const sevOf = (s: any): Sev => (s === 'critical' ? 'critical' : s === 'warning' ? 'warning' : 'info');

interface Confirm { title: string; body: string; danger: boolean; run: () => Promise<any> }

const CSS = `
.lcc-strip{position:relative;overflow:hidden;border-radius:16px;padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:12px;justify-content:space-between}
.lcc-crit{box-shadow:0 0 0 1px #F87171,0 0 24px rgba(248,113,113,.35)}
.lcc-crit::before{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 2px #FCA5A5,inset 0 0 46px rgba(248,113,113,.55);opacity:0;animation:lcc-pulse 1.4s ease-in-out infinite;pointer-events:none;will-change:opacity}
.lcc-warn{box-shadow:0 0 0 1px #FBBF24,0 0 16px rgba(251,191,36,.25)}
.lcc-warn::before{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 1px #FDE68A,inset 0 0 34px rgba(251,191,36,.4);opacity:0;animation:lcc-pulse 2.4s ease-in-out infinite;pointer-events:none;will-change:opacity}
@keyframes lcc-pulse{50%{opacity:1}}
.lcc-ok{box-shadow:0 0 0 1px #34D399,0 0 22px rgba(52,211,153,.25)}
.lcc-sweep:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.08),transparent);transform:translateX(-100%);animation:lcc-sweep 3s linear infinite;pointer-events:none}
@keyframes lcc-sweep{to{transform:translateX(100%)}}
.lcc-btn{min-height:36px;padding:7px 14px;border-radius:12px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid;transition:transform .15s, box-shadow .2s, opacity .2s}
.lcc-btn:hover{transform:translateY(-1px)}
.lcc-btn:disabled{opacity:.5;cursor:wait}
.lcc-danger{background:linear-gradient(135deg,#7F1D1D,#450A0A);border-color:#F87171;color:#FEE2E2;box-shadow:0 0 18px rgba(248,113,113,.35)}
.lcc-safe{background:linear-gradient(135deg,#064E3B,#022C22);border-color:#34D399;color:#D1FAE5}
.lcc-neutral{background:#0F1630;border-color:#2B3A66;color:#E7ECF8}
.lcc-big{position:relative;font-size:15px;padding:12px 20px;border-radius:16px}
.lcc-big::before{content:"";position:absolute;inset:-2px;border-radius:inherit;box-shadow:0 0 0 2px #FCA5A5,0 0 40px rgba(248,113,113,.7);opacity:0;animation:lcc-pulse 2.2s ease-in-out infinite;pointer-events:none;will-change:opacity}
.lcc-card{border:1px solid rgba(99,102,241,.25);border-radius:16px;padding:12px;background:rgba(6,9,24,.75);display:flex;flex-direction:column;gap:8px;min-width:0}
.lcc-pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:3px 10px;border-radius:999px;border:1px solid}
.lcc-tab{padding:6px 12px;border-radius:10px;font-size:12px;cursor:pointer;border:1px solid #1E2A5E;background:#0B1028;color:#C9D3EA}
.lcc-tab.on{background:#2A0F45;border-color:#E879F9;color:#fff;box-shadow:0 0 14px rgba(232,121,249,.35)}
.lcc-new{animation:lcc-new 2s ease-out}
@keyframes lcc-new{from{background:rgba(248,113,113,.3)}to{background:transparent}}
.lcc-compact .lcc-note{display:none}
.lcc-compact .lcc-card .lcc-btn{min-height:28px;padding:4px 10px;border-radius:10px}
.lcc-compact .lcc-big{font-size:13px;padding:8px 14px;border-radius:12px}
.lbr-still .lcc-crit::before,.lbr-still .lcc-warn::before,.lbr-still .lcc-big::before,.lbr-still .lcc-sweep:after{animation:none}
`;

function beep(): void {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.22].forEach((t) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
      o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
    window.setTimeout(() => { try { ctx.close(); } catch { /* */ } }, 800);
  } catch { /* الصوت اختياري */ }
}
/** كل مفتاح أمان = محطة فحص للعنكبوت المهندس، مرتبطة بفحوصها الحقيقية (يقرأ فقط، لا يغيّر المفتاح). */
const ccStation = (key: string): string => {
  if (key === 'commercial') return 'check:core.cycles,gate.expired';
  if (key === 'sendmode' || key.endsWith('-reply') || key.endsWith('-review')) return 'check:gate.mode,gate.window';
  if (key.endsWith('-run')) return 'check:automation.timers,automation.watcherErrors';
  if (key === 'yt-publish' || key === 'jobs') return 'check:automation.jobs,automation.failed,platforms.publish';
  if (key === 'owneralerts') return 'check:owner.channel,external.telegram,external.email';
  return 'check:auth.owner,auth.secret';
};
const readPref = (k: string): boolean => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const writePref = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* */ } };

function ago(iso: string | null | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} د`;
  const h = Math.round(m / 60);
  return h < 48 ? `قبل ${h} س` : `قبل ${Math.round(h / 24)} يوم`;
}

/** شريط الإنذار العلوي — يعكس أخطر حالة قائمة الآن. */
export const LiveAlertStrip: React.FC<{ data: any; onJump: () => void; hideJump?: boolean }> = ({ data, onJump, hideJump }) => {
  const alerts: any[] = Array.isArray(data?.alerts) ? data.alerts : [];
  const notes = data?.notifications || {};
  const esc = data?.escalations || {};
  // «تنبيهات حرجة غير مقروءة» تنبيه نظام يلخّص الإشعارات نفسها — لا يُعدّ مرتين.
  const crit = alerts.filter((a) => a.severity === 'critical' && a.id !== 'notifications-critical').length + Number(notes.critical || 0);
  const warn = alerts.filter((a) => a.severity === 'warning').length;
  const [idx, setIdx] = useState(0);
  const top = [...alerts.filter((a) => a.severity === 'critical'), ...alerts.filter((a) => a.severity === 'warning')];
  useEffect(() => { const t = window.setInterval(() => setIdx((i) => i + 1), 3500); return () => window.clearInterval(t); }, []);
  if (!data) return null;
  const level: Sev | 'ok' = crit ? 'critical' : warn ? 'warning' : 'ok';
  const color = level === 'ok' ? '#34D399' : SEV[level].c;
  const cur = top.length ? top[idx % top.length] : null;
  return (
    <section aria-label="حالة الإنذار" data-station="check:owner.critical,owner.channel" data-st-name="شريط الإنذار" className={`lcc-strip lcc-sweep ${level === 'critical' ? 'lcc-crit' : level === 'warning' ? 'lcc-warn' : 'lcc-ok'}`}
      style={{ background: level === 'ok' ? 'linear-gradient(90deg, rgba(6,78,59,.45), rgba(6,9,24,.8))' : `linear-gradient(90deg, ${SEV[level].bg}, rgba(6,9,24,.85))` }}>
      <style>{CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 300px' }}>
        <span className="lbr-blink" style={{ width: 14, height: 14, flex: 'none', borderRadius: '50%', background: color, boxShadow: `0 0 16px ${color}` }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color }}>
            {level === 'ok' ? 'كل الأنظمة تحت السيطرة' : level === 'critical' ? `${crit} ${crit === 1 ? 'تنبيه حرج يحتاجك' : 'تنبيهات حرجة تحتاجك'} الآن` : `${warn} ${warn === 1 ? 'تنبيه يحتاج' : 'تنبيهات تحتاج'} انتباهك`}
          </div>
          <div style={hideJump ? { fontSize: 12, color: '#C9D3EA', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.6 } : { fontSize: 12, color: '#C9D3EA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {cur ? `${cur.title} — ${cur.detail || ''}` : 'لا تنبيه حرج ولا تحذير قائم — المراقبة مستمرة.'}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12 }}>
        <span className="lcc-pill" style={{ borderColor: '#F87171', color: '#FCA5A5' }}>إشعارات غير مقروءة {Number(notes.unread || 0)}</span>
        <span className="lcc-pill" style={{ borderColor: '#F472B6', color: '#F9A8D4' }}>تصعيدات مفتوحة {Number(esc.open || 0)}</span>
        {!hideJump && <button type="button" className="lcc-btn lcc-neutral" onClick={onJump}>مركز السيطرة ↓</button>}
      </div>
    </section>
  );
};

/** compact = عرض الشاشة الحية: بطاقات مضغوطة وقائمة تنبيهات تملأ ما تبقّى من العمود. onLeave يُغلق الشاشة عند الانتقال لصفحة أخرى. */
export const LiveControlCenter: React.FC<{ data: any; refresh: () => void; now: number; anchorRef: React.RefObject<HTMLDivElement>; compact?: boolean; onLeave?: () => void }> = ({ data, refresh, now, anchorRef, compact, onLeave }) => {
  const { setActiveTab, showToast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [tab, setTab] = useState<'alerts' | 'notes' | 'esc'>('alerts');
  // القوائم الكاملة (2026-10-28): الحمولة الحية تحمل آخر 12 إشعاراً و6 تصعيدات فقط، فكانت
  // «11 تنبيهاً حرجاً» و«44 حالة» لا يُوصل إليها. عند الفتح تُجلب القائمة كاملة من مسارها الرسمي.
  const [noteFilter, setNoteFilter] = useState<'all' | 'critical'>('all');
  const [fullNotes, setFullNotes] = useState<any[] | null>(null);
  const [fullEsc, setFullEsc] = useState<any[] | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const reveal = () => window.setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  const loadNotes = async (only: 'all' | 'critical' = 'all') => {
    setListBusy(true);
    // غير المقروء فقط ومُرشَّح على الخادم قبل القصّ — فلا يضيع حرج قديم خلف مئات الإشعارات.
    try { const r = await apiService.getNotifications({ unread: true, ...(only === 'critical' ? { severity: 'critical' as const } : {}) }); setFullNotes((r.notifications || []).filter((n: any) => !n.userId || n.userId === 'owner')); }
    catch (e: any) { showToast(e?.message || 'تعذّر جلب الإشعارات'); }
    finally { setListBusy(false); }
  };
  const loadEsc = async () => {
    setListBusy(true);
    try { const r = await apiService.getEscalations(); setFullEsc(r.escalations || []); }
    catch (e: any) { showToast(e?.message || 'تعذّر جلب الحالات'); }
    finally { setListBusy(false); }
  };
  const openCritical = () => { setTab('notes'); setNoteFilter('critical'); void loadNotes('critical'); reveal(); };
  const openEscalations = () => { setTab('esc'); void loadEsc(); reveal(); };
  const [sound, setSound] = useState(() => readPref('gharabi.live.sound'));
  const seenCrit = useRef<Set<string> | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  const c = data?.controls || {};
  const alerts: any[] = Array.isArray(data?.alerts) ? data.alerts : [];
  const notes = data?.notifications || { unread: 0, latest: [] };
  const esc = data?.escalations || { open: 0, latest: [] };

  // تنبيه صوتي + وميض لكل حالة حرجة جديدة (لا عند أول تحميل).
  useEffect(() => {
    if (!data) return;
    const ids = [
      ...alerts.filter((a) => a.severity === 'critical').map((a) => `a:${a.id}`),
      ...(notes.latest || []).map((n: any) => `n:${n.id}`),
      ...(esc.latest || []).map((e: any) => `e:${e.id}`),
    ];
    if (seenCrit.current === null) { seenCrit.current = new Set(ids); return; }
    const fresh = ids.filter((id) => !seenCrit.current!.has(id));
    if (fresh.length) {
      fresh.forEach((id) => seenCrit.current!.add(id));
      setFreshIds(new Set(fresh));
      if (sound) beep();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const run = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    try { await fn(); showToast(ok); }
    catch (e: any) { showToast(e?.message || 'تعذر تنفيذ الإجراء'); }
    finally { setBusy(null); refresh(); if (fullNotes) void loadNotes(noteFilter); if (fullEsc) void loadEsc(); }
  };
  const ask = (cf: Confirm) => setConfirm(cf);

  const emergencyAll = () => ask({
    title: 'إيقاف طارئ شامل',
    danger: true,
    body: 'سيُوقف فوراً: العقل التجاري، ومراقبي يوتيوب وفيسبوك/إنستغرام وتيليغرام (لا قراءة ولا رد)، والنشر التلقائي للمعتمد، ويعيد إرسال الزبائن إلى «بموافقتك». لا يُحذف أي شيء، وتستأنف كل جزء من هنا متى شئت.',
    run: async () => {
      const steps: Array<[string, () => Promise<any>]> = [
        ['العقل التجاري', () => apiService.setCommercialKillSwitch(false, 'emergency_stop_live_room')],
        ['وضع الإرسال', () => apiService.setCommercialSendMode('approval')],
        ['مراقب يوتيوب', () => apiService.setYouTubeWatcherControls({ paused: true })],
        ['مراقب ميتا', () => apiService.setMetaWatcherControls({ paused: true })],
        ['مراقب تيليغرام', () => apiService.setTelegramWatcherControls({ paused: true })],
        ['النشر التلقائي', () => apiService.setJobAutoExecute(false)],
      ];
      const res = await Promise.allSettled(steps.map(([, f]) => f()));
      const failed = steps.filter((_, i) => res[i].status === 'rejected').map(([n]) => n);
      if (failed.length) throw new Error(`تعذّر إيقاف: ${failed.join('، ')} — البقية أُوقفت`);
    },
  });

  type Row = { key: string; title: string; desc: string; on: boolean; onLabel: string; offLabel: string; goodWhenOn: boolean; toOn: () => Promise<any>; toOff: () => Promise<any>; riskyOn?: string; riskyOff?: string };
  const watcherRows = (id: 'youtube' | 'meta' | 'telegram', label: string, setter: (x: Record<string, boolean | number>) => Promise<any>): Row[] => {
    const w = c[id] || {};
    return [
      { key: `${id}-run`, title: `مراقب ${label}`, desc: id === 'meta' ? 'قراءة التعليقات والرسائل الجديدة كل دورة (فيسبوك وإنستغرام وثريدز).' : 'قراءة التعليقات والرسائل الجديدة كل دورة.', on: !w.paused, onLabel: 'يعمل', offLabel: 'موقوف طارئاً', goodWhenOn: true,
        toOn: () => setter({ paused: false }), toOff: () => setter({ paused: true }), riskyOn: `استئناف مراقب ${label}: تعود القراءة فقط، ويبقى الرد الآلي معطّلاً حتى تفعّله صراحةً.` },
      { key: `${id}-reply`, title: `الرد الآلي — ${label}`, desc: c.commercial?.sendMode === 'auto' ? 'يرد العقل بنفسه على الأسئلة المؤكدة.' : 'وضع الموافقة: كل رد يُجهَّز وينتظر نقرتك في «صندوق الزبائن». هذا المفتاح يجعل المنصة ترد بنفسها حين تختار «إرسال تلقائي».', on: !!w.autoReply, onLabel: 'مفعّل', offLabel: 'معطّل', goodWhenOn: false,
        toOn: () => setter({ autoReply: true }), toOff: () => setter({ autoReply: false }), riskyOn: `تفعيل الرد الآلي على ${label}: سيرد العقل على الزبائن بلا مراجعتك (ضمن حدود الحقائق الموثّقة فقط).` },
      { key: `${id}-review`, title: `المراجعة البشرية — ${label}`, desc: 'كل رد يُحجز لمراجعتك قبل الإرسال.', on: !!w.humanReviewMode, onLabel: 'مفعّلة', offLabel: 'معطّلة', goodWhenOn: true,
        toOn: () => setter({ humanReviewMode: true }), toOff: () => setter({ humanReviewMode: false }), riskyOff: `إلغاء المراجعة البشرية على ${label}: الردود قد تُرسل بلا مراجعتك إن كان الرد الآلي مفعّلاً.` },
    ];
  };
  const rows: Row[] = [
    { key: 'commercial', title: 'العقل التجاري', desc: c.commercial?.killAt ? `أُوقف ${ago(c.commercial.killAt, now)}${c.commercial.killReason ? ` — ${c.commercial.killReason}` : ''}` : 'متابعة الزبائن المحتملين 24/72 ساعة.', on: !!c.commercial?.enabled, onLabel: 'يعمل', offLabel: 'موقوف', goodWhenOn: true,
      toOn: () => apiService.setCommercialKillSwitch(true, 'owner_live_room'), toOff: () => apiService.setCommercialKillSwitch(false, 'owner_live_room'), riskyOn: 'إعادة تفعيل العقل التجاري: يستأنف متابعة الزبائن وفق وضع الإرسال الحالي.' },
    { key: 'sendmode', title: 'إرسال الرسائل للزبائن', desc: c.commercial?.sendMode === 'auto' ? 'يرسل العقل المتابعات بنفسه.' : 'كل رسالة تنتظر موافقتك.', on: c.commercial?.sendMode === 'auto', onLabel: 'تلقائي', offLabel: 'بموافقتك', goodWhenOn: false,
      toOn: () => apiService.setCommercialSendMode('auto'), toOff: () => apiService.setCommercialSendMode('approval'), riskyOn: 'تحويل الإرسال إلى «تلقائي»: سيرسل العقل التجاري الرسائل والمتابعات للزبائن دون موافقتك المسبقة.' },
    ...watcherRows('youtube', 'يوتيوب', (x) => apiService.setYouTubeWatcherControls(x)),
    { key: 'yt-publish', title: 'النشر الآلي على يوتيوب', desc: 'نشر محتوى الطابور المعتمد على القناة.', on: !!c.youtube?.autoPublish, onLabel: 'مفعّل', offLabel: 'معطّل', goodWhenOn: false,
      toOn: () => apiService.setYouTubeWatcherControls({ autoPublish: true }), toOff: () => apiService.setYouTubeWatcherControls({ autoPublish: false }), riskyOn: 'تفعيل النشر الآلي على يوتيوب: يُنشر المحتوى المعتمد تلقائياً على القناة.' },
    ...watcherRows('meta', 'فيسبوك/إنستغرام/ثريدز', (x) => apiService.setMetaWatcherControls(x)),
    ...watcherRows('telegram', 'تيليغرام', (x) => apiService.setTelegramWatcherControls(x)),
    { key: 'jobs', title: 'نشر المعتمد تلقائياً في موعده', desc: 'تنفيذ مهام النشر المعتمدة عند حلول موعدها.', on: !!c.jobs?.autoExecute, onLabel: 'مفعّل', offLabel: 'معطّل', goodWhenOn: false,
      toOn: () => apiService.setJobAutoExecute(true), toOff: () => apiService.setJobAutoExecute(false), riskyOn: 'تفعيل النشر التلقائي للمعتمد: تُنشر المهام المعتمدة بنفسها عند موعدها عبر بوابات النشر.' },
    { key: 'owneralerts', title: 'تنبيهاتك الخارجية', desc: `بريد ${c.ownerAlerts?.emailReady ? 'جاهز' : 'غير مضبوط'} · تيليغرام ${c.ownerAlerts?.telegramReady ? 'جاهز' : 'غير مربوط'}`, on: !!c.ownerAlerts?.enabled, onLabel: 'مفعّلة', offLabel: 'معطّلة', goodWhenOn: true,
      toOn: () => apiService.setOwnerAlerts(true), toOff: () => apiService.setOwnerAlerts(false), riskyOff: 'إيقاف تنبيهاتك الخارجية: لن يصلك بريد/تيليغرام عند المشاكل — تبقى ظاهرة هنا فقط.' },
  ];

  const toggle = (r: Row) => {
    const goingOn = !r.on;
    const fn = goingOn ? r.toOn : r.toOff;
    const risky = goingOn ? r.riskyOn : r.riskyOff;
    const ok = `${r.title}: ${goingOn ? r.onLabel : r.offLabel}`;
    if (risky) ask({ title: r.title, body: risky, danger: true, run: fn });
    else void run(r.key, fn, ok);
  };

  const go = (tab: string) => { setActiveTab(tab); onLeave?.(); };
  const openLink = (link: string | null | undefined) => { if (link && /^[a-z_]+$/.test(link) && link !== 'live_room') go(link); };

  return (
    <section ref={anchorRef} data-mod="gate auth owner" aria-label="مركز السيطرة والأمان" className={'lbr-panel' + (compact ? ' lcc-compact' : '')} style={{ display: 'flex', flexDirection: 'column', gap: compact ? 10 : 14, ...(compact ? { flex: '1 1 0', minHeight: 0 } : {}) }}>
      <style>{CSS}</style>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <h2 className="lbr-h">مركز السيطرة والأمان</h2>
          <div className="lcc-note" style={{ fontSize: 11, color: '#93A1C3', marginTop: 4 }}>كل مفتاح هنا يعمل على الخادم فوراً ويُسجَّل في سجل التدقيق. الإيقاف فوري، والتشغيل نحو أتمتة أكثر يطلب تأكيدك.</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button type="button" className="lcc-btn lcc-neutral" aria-pressed={sound} onClick={() => { const v = !sound; setSound(v); writePref('gharabi.live.sound', v); if (v) beep(); }}>
            {sound ? '🔔 التنبيه الصوتي مفعّل' : '🔕 التنبيه الصوتي معطّل'}
          </button>
          <button type="button" className="lcc-btn lcc-danger lcc-big" disabled={busy === 'all'} onClick={emergencyAll}>⏻ إيقاف طارئ شامل</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(auto-fill, minmax(min(128px, 100%), 1fr))' : 'repeat(auto-fill, minmax(min(150px, 100%), 1fr))', gap: compact ? 8 : 10 }}>
        {rows.map((r) => {
          const healthy = r.on === r.goodWhenOn;
          const col = healthy ? '#34D399' : r.goodWhenOn ? '#F87171' : '#FBBF24';
          return (
            <div key={r.key} className="lcc-card" data-station={ccStation(r.key)} data-st-name={r.title} title={compact ? r.desc : undefined} style={{ boxShadow: `inset 0 0 22px ${col}14, 0 0 14px ${col}22`, ...(compact ? { padding: 9, gap: 6 } : {}) }}>
              <div style={{ display: 'flex', flexWrap: compact ? 'wrap' : undefined, justifyContent: 'space-between', alignItems: 'center', gap: compact ? 4 : 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{r.title}</span>
                <span className="lcc-pill" style={{ borderColor: col, color: col }}>
                  <span className={healthy ? '' : 'lbr-blink'} style={{ width: 7, height: 7, borderRadius: '50%', background: col, boxShadow: `0 0 8px ${col}` }} />
                  {r.on ? r.onLabel : r.offLabel}
                </span>
              </div>
              {!compact && <div style={{ fontSize: 11, color: '#93A1C3', lineHeight: 1.6, flex: 1 }}>{r.desc}</div>}
              <button type="button" disabled={busy === r.key || !data} onClick={() => toggle(r)}
                className={`lcc-btn ${r.on ? (r.goodWhenOn ? 'lcc-danger' : 'lcc-safe') : (r.goodWhenOn ? 'lcc-safe' : 'lcc-neutral')}`}>
                {r.on ? (r.goodWhenOn ? (r.key.endsWith('-run') || r.key === 'commercial' ? 'إيقاف طارئ' : 'إيقاف') : 'إطفاء') : (r.key.endsWith('-run') ? 'استئناف' : 'تفعيل')}
              </button>
            </div>
          );
        })}
        {c.youtubeOnlyMode && (
          <div className="lcc-card" style={{ borderColor: '#FBBF24' }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>وضع «يوتيوب فقط»</span>
            <div style={{ fontSize: 11, color: '#FCD34D' }}>مفعّل من إعداد الخادم: كل تنفيذ خارجي على غير يوتيوب محجوب.</div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className={`lcc-tab${tab === 'alerts' ? ' on' : ''}`} onClick={() => setTab('alerts')}>تنبيهات النظام ({alerts.length})</button>
        <button type="button" className={`lcc-tab${tab === 'notes' ? ' on' : ''}`} onClick={() => { setTab('notes'); setNoteFilter('all'); void loadNotes('all'); }}>الإشعارات ({Number(notes.unread || 0)})</button>
        {Number(notes.critical || 0) > 0 && <button type="button" className={`lcc-tab${tab === 'notes' && noteFilter === 'critical' ? ' on' : ''}`} style={{ borderColor: '#F87171', color: '#FCA5A5' }} onClick={openCritical}>الحرجة ({Number(notes.critical)})</button>}
        <button type="button" className={`lcc-tab${tab === 'esc' ? ' on' : ''}`} onClick={openEscalations}>التصعيدات ({Number(esc.open || 0)})</button>
      </div>

      <div ref={listRef} aria-label="قائمة التنبيهات والحالات" style={{ display: 'flex', flexDirection: 'column', gap: 8, ...(compact ? { flex: '1 1 0', minHeight: 210 } : { maxHeight: 520 }), overflowY: 'auto' }}>
        {listBusy && <div style={{ fontSize: 11, color: '#93A1C3' }}>جارٍ جلب القائمة كاملة…</div>}
        {tab === 'alerts' && (alerts.length === 0
          ? <div style={{ fontSize: 12, color: '#6EE7B7' }}>لا تنبيهات قائمة — كل شيء سليم الآن.</div>
          : [...alerts].sort((a, b) => ({ critical: 0, warning: 1, info: 2 } as any)[sevOf(a.severity)] - ({ critical: 0, warning: 1, info: 2 } as any)[sevOf(b.severity)]).map((a) => {
            const s = SEV[sevOf(a.severity)];
            return (
              <div key={a.id} className={freshIds.has(`a:${a.id}`) ? 'lcc-new' : ''} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, borderRadius: 12, border: `1px solid ${s.c}55`, background: s.bg }}>
                <span className={a.severity === 'critical' ? 'lbr-blink' : ''} style={{ width: 10, height: 10, marginTop: 4, flex: 'none', borderRadius: '50%', background: s.c, boxShadow: `0 0 10px ${s.c}` }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{a.title} <span style={{ fontSize: 10, color: s.c }}>· {s.t}</span></div>
                  <div style={{ fontSize: 11, color: '#C9D3EA', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{a.detail}</div>
                </div>
                {a.id === 'notifications-critical'
                  ? <button type="button" className="lcc-btn lcc-danger" onClick={openCritical}>اعرضها الآن</button>
                  : a.id === 'escalations-open'
                    ? <button type="button" className="lcc-btn lcc-neutral" onClick={openEscalations}>اعرض الحالات</button>
                    : a.link && a.link !== 'live_room' && <button type="button" className="lcc-btn lcc-neutral" onClick={() => openLink(a.link)}>افتح</button>}
              </div>
            );
          }))}

        {tab === 'notes' && (() => {
          const src: any[] = fullNotes ? fullNotes.filter((n: any) => !n.read) : (notes.latest || []);
          const list = noteFilter === 'critical' ? src.filter((n: any) => n.severity === 'critical') : src;
          return (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <button type="button" className={`lcc-tab${noteFilter === 'all' ? ' on' : ''}`} onClick={() => { setNoteFilter('all'); void loadNotes('all'); }}>كل غير المقروءة ({Number(notes.unread || 0)})</button>
              <button type="button" className={`lcc-tab${noteFilter === 'critical' ? ' on' : ''}`} onClick={() => { setNoteFilter('critical'); void loadNotes('critical'); }}>الحرجة فقط ({Number(notes.critical || 0)})</button>
              {noteFilter === 'critical' && list.length > 0 && (
                <button type="button" className="lcc-btn lcc-safe" disabled={busy === 'readcrit'} onClick={() => void run('readcrit', async () => { for (const n of list) await apiService.markNotificationRead(n.id); }, `عُلّمت ${list.length} تنبيهات حرجة كمقروءة`)}>
                  قرأتها كلها ({list.length})
                </button>
              )}
            </div>
            {!listBusy && list.length === 0 && <div style={{ fontSize: 12, color: '#6EE7B7' }}>{noteFilter === 'critical' ? 'لا تنبيهات حرجة غير مقروءة.' : 'لا إشعارات غير مقروءة.'}</div>}
            {list.map((n: any) => {
              const s = SEV[sevOf(n.severity)];
              return (
                <div key={n.id} className={freshIds.has(`n:${n.id}`) ? 'lcc-new' : ''} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, borderRadius: 12, border: `1px solid ${s.c}55`, background: s.bg }}>
                  <span style={{ width: 10, height: 10, marginTop: 4, flex: 'none', borderRadius: '50%', background: s.c, boxShadow: `0 0 10px ${s.c}` }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{n.title} <span style={{ fontSize: 10, color: s.c }}>· {s.t}</span></div>
                    {n.body && <div style={{ fontSize: 11, color: '#C9D3EA', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{n.body}</div>}
                    <div style={{ fontSize: 10, color: '#7C89AD' }}>{ago(n.createdAt, now)}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {n.link && n.link !== 'live_room' && <button type="button" className="lcc-btn lcc-neutral" onClick={() => { void apiService.markNotificationRead(n.id).catch(() => undefined); openLink(n.link); }}>افتح</button>}
                    <button type="button" className="lcc-btn lcc-safe" disabled={busy === n.id} onClick={() => void run(n.id, () => apiService.markNotificationRead(n.id), 'عُلّم كمقروء')}>قرأته</button>
                  </div>
                </div>
              );
            })}
            {noteFilter === 'all' && Number(notes.unread || 0) > 0 && (
              <button type="button" className="lcc-btn lcc-neutral" disabled={busy === 'readall'} onClick={() => void run('readall', () => apiService.markAllNotificationsRead(), 'عُلّمت كل الإشعارات كمقروءة')}>
                تعليم كل الإشعارات ({Number(notes.unread)}) كمقروءة
              </button>
            )}
          </>
          );
        })()}

        {tab === 'esc' && (() => {
          // القائمة الكاملة من مسار التصعيدات الرسمي (كل الحالات المفتوحة لا آخر 6 فقط).
          const PF: Record<string, string> = { facebook: 'فيسبوك', instagram: 'إنستغرام', youtube: 'يوتيوب', threads: 'ثريدز', tiktok: 'تيك توك', telegram: 'تيليغرام', whatsapp: 'واتساب' };
          const list: any[] = fullEsc
            ? fullEsc.filter((e: any) => e.state !== 'RESOLVED').sort((a: any, b: any) => Date.parse(String(b.createdAt || '')) - Date.parse(String(a.createdAt || '')))
              .map((e: any) => ({ id: e.id, platform: PF[e.platform] || e.platform, reason: e.reasonLabelAr || e.reason, text: String(e.commentText || '').slice(0, 300), state: e.state, createdAt: e.createdAt }))
            : (esc.latest || []);
          const pendingOnes = list.filter((e: any) => e.state === 'PENDING');
          return (
          <>
            <div style={{ fontSize: 11, color: '#93A1C3', lineHeight: 1.7 }}>
              أوقف العقل الرد الآلي على هذه الحالات (شكوى، طلب بشري، معلومة غير مؤكدة). اقرأ كلام الزبون، ردّ بنفسك من المنصة أو من «الرد اليدوي»، ثم اضغط «حُلّت».
            </div>
            {pendingOnes.length > 1 && (
              <button type="button" className="lcc-btn lcc-neutral" disabled={busy === 'ackall'} onClick={() => void run('ackall', async () => { for (const e of pendingOnes) await apiService.transitionEscalation(e.id, 'acknowledge'); }, `اطّلعت على ${pendingOnes.length} حالة`)}>
                اطّلعت على كل الجديدة ({pendingOnes.length})
              </button>
            )}
            {!listBusy && list.length === 0 && <div style={{ fontSize: 12, color: '#6EE7B7' }}>لا حالات مصعّدة مفتوحة.</div>}
            {list.map((e: any) => (
              <div key={e.id} className={freshIds.has(`e:${e.id}`) ? 'lcc-new' : ''} style={{ padding: 10, borderRadius: 12, border: '1px solid rgba(244,114,182,.4)', background: 'rgba(80,7,36,.3)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
                  <span style={{ color: '#F9A8D4', fontWeight: 700 }}>{e.reason}</span>
                  <span style={{ color: '#93A1C3' }}>{e.platform} · {ago(e.createdAt, now)} · {e.state === 'ACKNOWLEDGED' ? 'مُطّلع عليه' : 'جديد'}</span>
                </div>
                {e.text && <div style={{ fontSize: 13, lineHeight: 1.7 }}>«{e.text}»</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {e.state === 'PENDING' && <button type="button" className="lcc-btn lcc-neutral" disabled={busy === e.id} onClick={() => void run(e.id, () => apiService.transitionEscalation(e.id, 'acknowledge'), 'تم الاطلاع')}>اطّلعت</button>}
                  <button type="button" className="lcc-btn lcc-safe" disabled={busy === e.id} onClick={() => void run(e.id, () => apiService.transitionEscalation(e.id, 'resolve'), 'حُلّت الحالة')}>حُلّت</button>
                  <button type="button" className="lcc-btn lcc-neutral" onClick={() => { go('social_manager'); focusFeature('التصعيدات البشرية', 'panel'); }}>الرد اليدوي</button>
                </div>
              </div>
            ))}
            {!fullEsc && Number(esc.open || 0) > (esc.latest || []).length && (
              <button type="button" className="lcc-btn lcc-neutral" onClick={openEscalations}>اعرض كل الحالات ({Number(esc.open)})</button>
            )}
          </>
          );
        })()}
      </div>

      {confirm && (
        <div role="dialog" aria-modal="true" aria-label={confirm.title} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(2,3,10,.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setConfirm(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, width: '100%', borderRadius: 18, padding: 18, background: 'linear-gradient(160deg,#160A33,#070A1A)', border: `1px solid ${confirm.danger ? '#F87171' : '#34D399'}`, boxShadow: `0 0 50px ${confirm.danger ? 'rgba(248,113,113,.35)' : 'rgba(52,211,153,.3)'}`, color: '#E7ECF8' }}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8, color: confirm.danger ? '#FCA5A5' : '#6EE7B7' }}>تأكيد: {confirm.title}</div>
            <div style={{ fontSize: 13, lineHeight: 1.8, color: '#C9D3EA' }}>{confirm.body}</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button type="button" className="lcc-btn lcc-neutral" onClick={() => setConfirm(null)}>إلغاء</button>
              <button type="button" className={`lcc-btn ${confirm.danger ? 'lcc-danger' : 'lcc-safe'}`} autoFocus
                onClick={() => { const cf = confirm; setConfirm(null); void run(cf.title === 'إيقاف طارئ شامل' ? 'all' : cf.title, cf.run, `${cf.title}: تم`); }}>
                نعم، نفّذ
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
