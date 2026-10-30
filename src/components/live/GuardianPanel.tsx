import React from 'react';

/**
 * «الحارس» في غرفة المهندس (2026-10-29): الأمن والحرّاس والوصول من الإنترنت والخطط المجانية والخزن
 * وثغرات المكتبات — في لوحة واحدة، من أرقام الخادم الحقيقية (GET /api/engineer → guardian).
 * العناوين تصل مقنّعة من الخادم (a.b.*.*) ولا يُعرض عنوان خام أبداً.
 */

type Props = {
  g: any;
  now: number;
  busy: boolean;
  onRun: () => void;
  onUnblock: () => void;
};

const LEVEL: Record<string, { c: string; t: string }> = {
  calm: { c: '#34D399', t: 'هادئ' },
  probing: { c: '#FBBF24', t: 'استطلاع مرصود' },
  attack: { c: '#F87171', t: 'هجوم يُصدّ' },
};
const ST: Record<string, string> = { ok: '#34D399', warn: '#FBBF24', fail: '#F87171', skip: '#94A3B8' };
const KIND_AR: Record<string, string> = {
  scanner: 'فحص ثغرات', traversal: 'اجتياز مسارات', injection: 'حقن', source_probe: 'سحب المصدر',
  auth_fail: 'دخول فاشل', auth_limited: 'بلوغ حد الدخول', webhook_forged: 'webhook مزوّر',
};
const EDGE_AR: Record<string, string> = { ok: 'سليم', slow: 'بطيء', down: 'لا يُفتح', tls_soon: 'الشهادة تقترب', tls_expired: 'الشهادة منتهية', headers: 'ترويسات ناقصة' };

function ago(iso: string | null | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '—';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} د`;
  const h = Math.round(m / 60);
  return h < 48 ? `قبل ${h} س` : `قبل ${Math.round(h / 24)} يوم`;
}
const until = (iso: string, now: number) => { const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000)); return m < 60 ? `${m} د` : m < 48 * 60 ? `${Math.round(m / 60)} س` : `${Math.round(m / 1440)} يوم`; };
const mb = (b: number | null | undefined) => (b == null ? '—' : `${(b / 1048576).toFixed(b >= 10 * 1048576 ? 0 : 1)} ميغا`);

const Row: React.FC<{ status: string; children: React.ReactNode; station?: string; name?: string }> = ({ status, children, station, name }) => (
  <div className="lbr-gap" data-station={station} data-st-name={name} style={{ borderColor: `${ST[status] || ST.skip}55`, display: 'flex', gap: 6, alignItems: 'baseline' }}>
    <b style={{ color: ST[status] || ST.skip, flex: 'none' }}>{status === 'ok' ? '✓' : status === 'fail' ? '✗' : status === 'warn' ? '⚠' : '–'}</b>
    <div style={{ flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 1.7 }}>{children}</div>
  </div>
);

export const GuardianPanel: React.FC<Props> = ({ g, now, busy, onRun, onUnblock }) => {
  if (!g) return <div style={{ fontSize: 12, color: '#93A1C3' }}>الحارس يستعد — أول فحص للحرّاس بعد دقيقة من الإقلاع، والوصول من الإنترنت بعد 4 دقائق.</div>;
  const sec = g.security || {};
  const lv = LEVEL[sec.level] || LEVEL.calm;
  const guards = g.guards;
  const edge = g.edge;
  const plans = g.plans;
  const storage = g.storage;
  const deps = g.dependencies;
  const counts = Object.entries(sec.last24h || {}).filter(([, n]) => Number(n) > 0) as Array<[string, number]>;
  return (
    <div aria-label="الحارس الأمني والحرّاس" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h3 style={{ margin: 0, fontSize: 13, color: '#A5B4FC' }}>🛡 الحارس الأمني والحرّاس</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span data-station="check:auth.intrusion" data-st-name="مستوى الخطر" className="lbr-eng-badge" style={{ borderColor: lv.c, color: lv.c }}>الأمن: {lv.t}</span>
        <span data-station="check:gate.canary" data-st-name="الحرّاس" className="lbr-eng-badge" style={{ borderColor: guards ? (guards.failed ? ST.fail : ST.ok) : ST.skip, color: guards ? (guards.failed ? ST.fail : ST.ok) : ST.skip }}>
          الحرّاس: {guards ? `${guards.total - guards.failed}/${guards.total} يحمون` : 'بعد دقيقة'}
        </span>
        <span data-station="check:monitor.edge" data-st-name="الوصول من الإنترنت" className="lbr-eng-badge" style={{ borderColor: edge ? (edge.worst === 'ok' ? ST.ok : ['down', 'tls_expired'].includes(edge.worst) ? ST.fail : ST.warn) : ST.skip, color: edge ? (edge.worst === 'ok' ? ST.ok : ['down', 'tls_expired'].includes(edge.worst) ? ST.fail : ST.warn) : ST.skip }}>
          الإنترنت: {edge ? EDGE_AR[edge.worst] || edge.worst : (g.edgeConfigured || []).length ? 'بعد 4 د' : 'غير مضبوط'}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="lbr-tab" disabled={busy} onClick={onRun}>افحص الآن</button>
      </div>

      {/* الأمن */}
      <div style={{ fontSize: 11.5, color: '#C9D3EA', lineHeight: 1.7 }}>
        <b style={{ color: lv.c }}>{sec.levelText || lv.t}</b>
        {' · '}خلال 24 س: {counts.length ? counts.map(([k, n]) => `${KIND_AR[k] || k} ${n}`).join('، ') : 'لا محاولة'}
        {' · '}حُظر منذ البداية {sec.totalBlocks || 0}
        {g.sight && !g.sight.seesVisitors && (g.sight.internal || 0) > 50 ? <div style={{ color: '#FDE68A' }}>⚠ الحارس لا يرى عناوين الزوار (كل الطلبات تصله داخلية) — الرصد يعمل على المسارات والحظر معطّل حتى يمرّر المضيف العنوان.</div> : null}
      </div>
      {(sec.activeBlocks || []).length > 0 && (
        <div data-station="check:auth.intrusion" data-st-name="المصادر المحظورة" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(sec.activeBlocks as any[]).map((b) => (
            <Row key={b.fp} status="warn"><b>محظور</b> {b.masked} <span style={{ color: '#7C89AD' }}>#{b.fp}</span> — {b.reason} · يبقى {until(b.until, now)}{b.offenses > 1 ? ` · المرة ${b.offenses}` : ''}</Row>
          ))}
          <div><button type="button" className="lbr-tab" disabled={busy} onClick={onUnblock}>رفع كل الحظر</button> <span style={{ fontSize: 10.5, color: '#7C89AD' }}>الحظر مؤقت وتلقائي، لا يمسّ عنواناً دخلت منه، ولا يوقف الرصد.</span></div>
        </div>
      )}
      {(sec.recent || []).slice(0, 8).map((e: any, i: number) => (
        <Row key={`${e.at}-${i}`} status={e.kind === 'auth_fail' || e.kind === 'webhook_forged' ? 'warn' : 'fail'} station="check:auth.intrusion" name="محاولة مرصودة">
          {e.label} — <span className="lbr-mono" style={{ color: '#93A1C3' }}>{e.path}</span> <span style={{ color: '#7C89AD' }}>من {e.masked}{e.viaProxy ? ' (عبر الوكيل)' : ''} · {ago(e.at, now)}</span>
        </Row>
      ))}
      {(sec.advice || []).map((a: string, i: number) => <div key={i} style={{ fontSize: 11, color: '#FCD34D' }}>• {a}</div>)}

      {/* الحرّاس */}
      <div style={{ fontSize: 11.5, color: '#A5B4FC', fontWeight: 700, marginTop: 4 }}>الحرّاس (هجوم تجريبي حي كل 30 د{guards ? ` · آخره ${ago(guards.at, now)}` : ''})</div>
      {(guards?.results || []).map((r: any) => (
        <Row key={r.id} status={r.ok ? 'ok' : 'fail'} station="check:gate.canary" name={r.label}>
          <b>{r.label}</b> — {r.protects}<div style={{ fontSize: 10.5, color: r.ok ? '#93A1C3' : '#FCA5A5' }}>{r.detail}</div>
        </Row>
      ))}

      {/* الوصول من الإنترنت */}
      <div style={{ fontSize: 11.5, color: '#A5B4FC', fontWeight: 700, marginTop: 4 }}>الوصول من الإنترنت (كل 15 د{edge ? ` · آخره ${ago(edge.at, now)}` : ''})</div>
      {(edge?.results || []).map((r: any) => (
        <Row key={r.id} status={r.verdict === 'ok' ? 'ok' : ['down', 'tls_expired'].includes(r.verdict) ? 'fail' : 'warn'} station="check:monitor.edge" name={r.label}>
          <b>{r.label}</b> <span className="lbr-mono" style={{ color: '#7C89AD' }}>{r.host}</span> — {r.detail}
          {r.remedy ? <div style={{ fontSize: 10.5, color: '#FCD34D' }}>{r.remedy}</div> : null}
        </Row>
      ))}
      {!edge && <div style={{ fontSize: 11, color: '#93A1C3' }}>{(g.edgeConfigured || []).length ? 'أول فحص خارجي بعد 4 دقائق من الإقلاع.' : 'لا عنوان عام https مضبوط (APP_URL) — يعمل على الخادم المنشور فقط.'}</div>}

      {/* الخطط المجانية: كل حصة موزّعة على مدتها */}
      <div style={{ fontSize: 11.5, color: '#A5B4FC', fontWeight: 700, marginTop: 4 }}>الحصص المجانية — موزّعة على مدتها</div>
      {g.pacing?.rule && <div style={{ fontSize: 10.5, color: '#93A1C3', lineHeight: 1.6 }}>{g.pacing.rule}</div>}
      {((g.pacing?.rows || []) as any[]).filter((r) => r.state !== 'unknown').map((r) => {
        const st = r.level === 'critical' ? 'fail' : r.level === 'watch' ? 'warn' : 'ok';
        const pct = Math.min(100, Number(r.usedPercent) || 0);
        const allow = r.allowedPercent == null ? null : Math.min(100, Number(r.allowedPercent));
        return (
          <Row key={r.provider} status={st} station="check:monitor.freeplans" name={r.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}><b>{r.label}</b><span className="lbr-mono" style={{ color: '#93A1C3' }}>{r.usedPercent}%{allow != null ? ` / المسموح الآن ${allow}%` : ''}</span></div>
            <div style={{ position: 'relative', height: 6, borderRadius: 999, background: '#141B3D', margin: '3px 0' }} aria-hidden="true">
              <div style={{ position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 999, background: ST[st] }} />
              {allow != null && <div title="خط الإيقاع" style={{ position: 'absolute', top: -2, bottom: -2, insetInlineStart: `calc(${allow}% - 1px)`, width: 2, background: '#E7ECF8' }} />}
            </div>
            <div style={{ fontSize: 10.5, color: '#93A1C3' }}>{r.detail}{r.resetsAt ? ` · تتجدد بعد ${until(r.resetsAt, now)}` : ''}</div>
          </Row>
        );
      })}
      {!((g.pacing?.rows || []) as any[]).some((r) => r.state !== 'unknown') && <div style={{ fontSize: 11, color: '#93A1C3' }}>لا قياس للحصص بعد.</div>}
      {g.pacing && (
        <div style={{ fontSize: 10.5, color: '#93A1C3', lineHeight: 1.6 }}>
          YouTube: قراءات المراقبة ≤ {g.pacing.youtube?.allowedNowUnits ?? '—'} وحدة حتى الآن (ميزانيتها {g.pacing.youtube?.readBudget ?? '—'}، واحتياطي النشر {g.pacing.youtube?.publishReserve ?? '—'} محفوظ) ·
          Gemini: العمل الخلفي موزّع على اليوم{g.pacing.gemini?.pacedSkips ? ` (أُجّل ${g.pacing.gemini.pacedSkips} طلباً للمحرك المحلي)` : ''}، وطلباتك تأخذ حتى السقف ·
          المهندس نفسه: لا يوقظ الخادم ولا القاعدة بفحوصه{g.selfCost?.edgeSkippedIdle ? ` (تخطّى ${g.selfCost.edgeSkippedIdle} فحصاً خارجياً والموقع بلا زوار)` : ''}.
        </div>
      )}

      {/* الخزن */}
      <div style={{ fontSize: 11.5, color: '#A5B4FC', fontWeight: 700, marginTop: 4 }}>الخزن (كل 6 س{storage ? ` · آخره ${ago(storage.at, now)}` : ''})</div>
      {storage ? (
        <Row status={storage.verdict?.status || 'skip'} station="check:storage.size" name="حجم القاعدة">
          {storage.verdict?.detail || mb(storage.databaseBytes)}
          {storage.verdict?.advice ? <div style={{ fontSize: 10.5, color: '#FCD34D' }}>{storage.verdict.advice}</div> : null}
        </Row>
      ) : <div style={{ fontSize: 11, color: '#93A1C3' }}>أول قياس لحجم القاعدة بعد 5 دقائق من الإقلاع.</div>}

      {/* ثغرات المكتبات */}
      <div style={{ fontSize: 11.5, color: '#A5B4FC', fontWeight: 700, marginTop: 4 }}>ثغرات المكتبات في النسخة الحية</div>
      {deps ? (
        <Row status={!deps.ok ? 'skip' : deps.counts.critical ? 'fail' : deps.counts.high ? 'warn' : 'ok'} station="check:auth.dependencies" name="ثغرات المكتبات">
          {deps.ok ? `حرجة ${deps.counts.critical} · عالية ${deps.counts.high} · متوسطة ${deps.counts.moderate} — فحص بناء ${String(deps.at).slice(0, 10)}` : `تعذّر الفحص عند البناء: ${deps.error || ''}`}
          {(deps.packages || []).filter((p: any) => p.severity === 'critical' || p.severity === 'high').slice(0, 5).map((p: any) => (
            <div key={p.name} style={{ fontSize: 10.5, color: '#FCA5A5' }}>{p.severity} · {p.name}{p.fixAvailable ? ' (له إصلاح)' : ''}{p.title ? ` — ${p.title}` : ''}</div>
          ))}
        </Row>
      ) : <div style={{ fontSize: 11, color: '#93A1C3' }}>لا لقطة ثغرات لهذه النسخة (تُنشأ عند بناء Docker في Render).</div>}
    </div>
  );
};

export default GuardianPanel;
