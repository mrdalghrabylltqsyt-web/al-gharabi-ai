#!/usr/bin/env node
/**
 * الغرابي AI — **مركز استعادة الغرابي AI** (Recovery Center).
 *
 * خدمة مستقلة تماماً عن تطبيق الغرابي الرئيسي: لا تستورد `server.ts` ولا `dist`
 * ولا أي كود من المشروع المترجم، ولا تعتمد على جلسته ولا على Render الخاص به.
 * غرضها الوحيد: إذا توقّف الغرابي/Render/واجهته، يبقى المالك قادراً على قراءة
 * Recovery Points من Google Drive والبدء بعملية الاستعادة.
 *
 * التشغيل:
 *   node tools/dr/recovery-center.mjs                 # محلياً على 127.0.0.1:4600
 *   PORT=4600 node tools/dr/recovery-center.mjs       # خدمة مستضافة (0.0.0.0)
 *
 * الاعتماد (على بيئة **هذه الخدمة** فقط، لا في الاختصار ولا في المتصفح):
 *   DRIVE_OAUTH_CLIENT_ID / DRIVE_OAUTH_CLIENT_SECRET / DRIVE_OAUTH_REFRESH_TOKEN
 *   DRIVE_TOKEN_ENCRYPTION_KEY   (لفكّ رمز التجديد المخزّن)
 *   DR_RECOVERY_MASTER_KEY أو DRIVE_DB_BACKUP_KEY (لفكّ الأسرار/القاعدة)
 *   DR_FOLDER_IDENTITY (اختياري: معرّفات مجلدات Drive تحت drive.file)
 *
 * **مفتاح خزنة الطوارئ `DR_RECOVERY_VAULT_KEY` لا يُضبط هنا إطلاقاً**: يُدخله المالك
 * في الواجهة وقت الاستعادة فقط، ولا يُحفظ ولا يُسجَّل ولا يُعاد في أي استجابة.
 *
 * الأمان:
 *   - قراءة فقط من Drive: لا حذف ولا تعديل لأي Recovery Point (بما فيها rp-002/003/004).
 *   - لا كتابة فوق الإنتاج: قاعدة الهدف تُرفض إن طابقت `DATABASE_URL`.
 *   - لا سرّ في الاستجابة أو السجل؛ الأسماء والأعداد والحالات فقط.
 *   - المفتاح يُمرَّر في جسم POST فقط (لا يظهر في سطر الطلب/السجل)، ويُمسح بعد الاستخدام.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import {
  buildRecoveryClient,
  buildRecoveryStore,
  inspectRecoveryReadiness,
  listRecoveryPoints,
  inspectTargetEnvironment,
  runStandaloneRestore,
  openKeyVault,
  verifyRecoveryPoint,
} from './standalone-recovery.mjs';

const IS_HOSTED = Boolean(process.env.RENDER || process.env.RECOVERY_CENTER_HOSTED);
const HOST = process.env.RECOVERY_CENTER_HOST || (IS_HOSTED ? '0.0.0.0' : '127.0.0.1');
const PORT = Number.parseInt(process.env.PORT || process.env.RECOVERY_CENTER_PORT || '4600', 10);

/** الحالات الصادقة للاستعادة (تُعرض للمالك كما هي؛ لا ادّعاء نجاح غير مُثبت). */
export const RECOVERY_HONEST_STATES = [
  { key: 'verified', labelAr: 'تم التحقق', detail: 'بيان النقطة والبصمات والحزم سليمة.' },
  { key: 'vault_opened', labelAr: 'تم فكّ الخزنة', detail: 'خزنة المفاتيح فُتحت بالمفتاح المُدخَل وتحققت بصماتها.' },
  { key: 'source_restored', labelAr: 'تم استعادة المصدر', detail: 'كامل ملفات المصدر استُخرجت وطابقت عدد البيان.' },
  { key: 'database_restored', labelAr: 'تم استعادة قاعدة البيانات', detail: 'database.enc فُكّ واستُعيد في قاعدة الهدف.' },
  { key: 'secrets_restored', labelAr: 'تم استعادة الأسرار', detail: 'secrets.enc فُكّ بعد فتح الخزنة.' },
  { key: 'target_prepared', labelAr: 'تم تجهيز بيئة الهدف', detail: 'المجلد الهدف وقاعدة الهدف جُهّزا.' },
  { key: 'service_started', labelAr: 'تم تشغيل الخدمة', detail: 'يتطلّب إجراءً خارجياً (Render) — لا يُدّعى آلياً.' },
  { key: 'service_verified', labelAr: 'تم التحقق من الخدمة', detail: 'فحوص صحة على البيئة المستعادة — خطوة خارجية.' },
];

/** ترجمة تقرير الاستعادة إلى الحالات الصادقة (لا يُعلن ما لم يتحقق فعلاً). */
export function honestStatesFromReport(report) {
  const c = report?.checks || {};
  const stages = new Set(report?.stages || []);
  const reached = (k) => stages.has(k);
  return {
    verified: c.pointVerified === true,
    vault_opened: c.vaultDecrypt === true,
    source_restored: c.sourceExtract === true && c.fileCountMatch === true,
    database_restored: c.databaseRestored === true,
    secrets_restored: c.secretsDecrypt === true,
    target_prepared: Boolean(report?.targetDir) || reached('target_environment'),
    service_started: false,
    service_verified: false,
  };
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

/** يبني عميلاً/مخزناً قراءة فقط من بيئة الخدمة (قابل للحقن في الاختبار). */
async function makeStore(env, clientFactory, tokenOptions) {
  const client = await buildRecoveryClient(env, { clientFactory, ...(tokenOptions || {}) });
  if (!client) return { store: null, code: 'drive_not_configured' };
  if (client.ok === false) return { store: null, code: client.code || 'no_refresh_token' };
  let storedIdentity = null;
  try { if (env.DR_FOLDER_IDENTITY) storedIdentity = JSON.parse(env.DR_FOLDER_IDENTITY); } catch { /* تجاهل */ }
  return { store: buildRecoveryStore(client, { storedIdentity, readOnlyStructure: true }), code: null };
}

/** يحلّل كتلة متغيّرات الهدف (KEY=VALUE أو JSON) — قيمها تُستخدم في الذاكرة فقط. */
export function parseTargetEnv(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return { ...raw };
  const text = String(raw).trim();
  if (!text) return {};
  const out = {};
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text);
      for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') out[k] = v;
      return out;
    } catch { /* ليس JSON */ }
  }
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (/^[A-Z0-9_]+$/.test(key)) out[key] = val;
  }
  return out;
}

function page() {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>مركز استعادة الغرابي AI</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{font-family:system-ui,"Segoe UI",Tahoma,sans-serif;background:#0b1220;color:#e2e8f0;margin:0;padding:20px;line-height:1.7}
  .wrap{max-width:900px;margin:0 auto}
  h1{font-size:24px;margin:0 0 4px} h3{margin:0 0 8px;font-size:16px}
  .sub{color:#94a3b8;margin:0 0 18px}
  .card{background:#111c33;border:1px solid #1f2d4a;border-radius:16px;padding:16px;margin:12px 0}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .grow{flex:1}
  button{background:#2563eb;color:#fff;border:0;border-radius:10px;padding:10px 16px;font-size:15px;cursor:pointer;font-family:inherit}
  button.sec{background:#334155} button.danger{background:#b91c1c}
  button:disabled{opacity:.45;cursor:not-allowed}
  input,textarea{background:#0b1220;color:#e2e8f0;border:1px solid #1f2d4a;border-radius:10px;padding:10px;width:100%;font-family:inherit;font-size:14px}
  .pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;border:1px solid #1f2d4a}
  .pill.ok{background:#052e1a;color:#4ade80;border-color:#14532d}
  .pill.bad{background:#3a0d0d;color:#f87171;border-color:#7f1d1d}
  .pill.warn{background:#3a2a05;color:#fbbf24;border-color:#713f12}
  .muted{color:#94a3b8} .ok{color:#4ade80} .bad{color:#f87171}
  .pt{border:1px solid #1f2d4a;border-radius:12px;padding:12px;margin:8px 0;cursor:pointer}
  .pt.sel{border-color:#22c55e;background:#08251a}
  .pt .id{font-weight:700}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:6px;margin-top:8px;font-size:13px}
  .grid div{color:#cbd5e1} .grid b{color:#94a3b8;font-weight:400}
  pre{background:#0b1220;border:1px solid #1f2d4a;border-radius:10px;padding:12px;overflow:auto;max-height:360px;font-size:12px}
  ol{padding-inline-start:18px} .step{color:#cbd5e1}
  .banner{background:#3a2a05;border:1px solid #713f12;color:#fde68a;border-radius:12px;padding:10px 14px;margin:10px 0}
  a{color:#60a5fa}
</style></head><body><div class="wrap">
<h1>🛟 مركز استعادة الغرابي AI</h1>
<p class="sub">هذا المركز مخصص لاستعادة المشروع عند حدوث عطل أو فقدان بيئة التشغيل. يعمل مستقلاً عن تطبيق الغرابي الرئيسي وعن جلسته.</p>

<div class="card">
  <div class="row"><button id="load">🔄 تحديث الحالة ونقاط الاستعادة</button><span id="ready" class="muted"></span></div>
  <div id="drivestate" class="muted" style="margin-top:8px"></div>
</div>

<div class="card"><h3>1) نقاط الاستعادة (من Google Drive)</h3><div id="points" class="muted">اضغط «تحديث» لعرض النقاط.</div></div>

<div class="card"><h3>2) مفتاح خزنة الطوارئ</h3>
  <input id="vaultKey" type="password" placeholder="DR_RECOVERY_VAULT_KEY" autocomplete="off" spellcheck="false">
  <p class="muted">المفتاح الذي تحتفظ به خارج Google Drive. لا يُحفظ ولا يُسجَّل ولا يظهر بعد الإدخال.</p>
  <div class="row"><button id="verify" class="sec" disabled>🔍 التحقق من النسخة (قراءة فقط)</button></div>
</div>

<div class="card"><h3>3) إعداد بيئة الاستعادة</h3>
  <p class="muted">متغيّرات لازمة لإعادة إنشاء البيئة الهدف وغير موجودة داخل النسخة (تدخل وقت الاستعادة فقط، لا تُحفظ). مثال: قاعدة هدف معزولة.</p>
  <textarea id="targetEnv" rows="3" placeholder="DR_RECOVERY_TEST_DATABASE_URL=postgres://user:pass@host/restore_db"></textarea>
  <div class="row" style="margin-top:8px"><label class="muted"><input type="checkbox" id="applyDb" style="width:auto"> تطبيق قاعدة البيانات في القاعدة الهدف</label></div>
</div>

<div class="card"><h3>4) الاستعادة</h3>
  <div id="verdict" class="muted">لم يُتحقق بعد.</div>
  <div class="row" style="margin-top:8px"><button id="restore" class="danger" disabled>▶️ بدء الاستعادة</button></div>
  <div class="banner">سيتم استخدام نسخة الاستعادة المحددة لإنشاء بيئة المشروع. <b>لن يتم تعديل النسخة الاحتياطية الأصلية.</b></div>
</div>

<div class="card"><h3>حالات الاستعادة</h3><div id="states" class="grid"></div></div>

<div class="card"><h3>النتيجة</h3><pre id="out">—</pre></div>
</div>
<script>
let selected=null, verified=false;
const $=(id)=>document.getElementById(id);
async function j(u,o){const r=await fetch(u,o);try{return await r.json()}catch{return{ok:false,code:'bad_response'}}}
const esc=(s)=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function renderStates(st){$('states').innerHTML=Object.entries(st||{}).map(([k,v])=>
  '<div><span class="pill '+(v?'ok':'bad')+'">'+(v?'✔':'—')+'</span> '+esc(STATES[k]||k)+'</div>').join('');}
const STATES=${JSON.stringify(Object.fromEntries(RECOVERY_HONEST_STATES.map((s) => [s.key, s.labelAr])))};
renderStates({});
function updateBtns(){
  const hasKey=$('vaultKey').value.length>0;
  $('verify').disabled=!selected||!hasKey;
  $('restore').disabled=!selected||!hasKey||!verified;
}
async function load(){
  $('ready').textContent='...';$('out').textContent='—';
  const d=await j('/api/points');
  if(!d.ok){$('ready').textContent='';$('drivestate').innerHTML='<span class="bad">Google Drive: غير متاح ('+esc(d.reason||d.code||'—')+')</span>';$('out').textContent=JSON.stringify(d,null,2);return;}
  const r=d.readiness||{};
  $('drivestate').innerHTML='Google Drive: <span class="ok">متاح</span> · عميل: '+esc(r.drive.clientIdFingerprint||'—')+
    ' · خزنة: '+(r.vaultKey.present?'<span class="ok">مضبوط</span>':'<span class="warn">يُدخل الآن</span>')+
    ' · مفتاح الأسرار: '+esc(r.masterKey.state||'—');
  $('ready').textContent=(d.points||[]).length+' نقطة';
  $('points').innerHTML='';
  (d.points||[]).forEach(p=>{
    const el=document.createElement('div');el.className='pt'+(p.restorable?'':' bad');
    el.innerHTML='<div class="id">'+esc(p.id)+' <span class="pill '+(p.restorable?'ok':'bad')+'">'+(p.restorable?'سليمة':'ناقصة')+'</span></div>'+
      '<div class="grid">'+
      '<div><b>الالتزام:</b> '+esc(String(p.commit||'—').slice(0,10))+'</div>'+
      '<div><b>التاريخ:</b> '+esc(p.createdAt||'—')+'</div>'+
      '<div><b>عدد الملفات:</b> '+esc(p.fileCount??'—')+'</div>'+
      '<div><b>بصمة المصدر:</b> '+esc(String(p.hashes.sourceHash||'—').slice(0,12))+'</div>'+
      '<div><b>قاعدة البيانات:</b> '+(p.database.encrypted?'مشفّرة':'—')+'</div>'+
      '<div><b>الأسرار المشفّرة:</b> '+esc(p.secrets.count??'—')+'</div>'+
      '<div><b>خزنة المفاتيح:</b> —</div>'+
      '<div><b>التحقق:</b> '+esc((p.verification.problems||[]).join(', ')||'سليم')+'</div>'+
      '</div>';
    el.onclick=()=>{[...document.querySelectorAll('.pt')].forEach(x=>x.classList.remove('sel'));el.classList.add('sel');
      selected=p;verified=false;$('verdict').textContent='النقطة المختارة: '+p.id+' — اضغط «التحقق من النسخة».';updateBtns();};
    $('points').appendChild(el);
  });
  updateBtns();
}
$('load').onclick=load;
$('vaultKey').oninput=()=>{verified=false;updateBtns();};
$('verify').onclick=async()=>{
  if(!selected)return;
  $('verdict').textContent='جارٍ التحقق (قراءة فقط)...';
  const d=await j('/api/verify',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({point:selected.id,vaultKey:$('vaultKey').value})});
  verified=d.ok===true;
  $('verdict').innerHTML=verified?'<span class="ok">النسخة جاهزة للاستعادة ✅</span>':'<span class="bad">⛔ فشل التحقق: '+esc((d.report&&d.report.problems||[]).join(', ')||d.code||'—')+'</span>';
  if(d.report&&d.report.states)renderStates(d.report.states);
  $('out').textContent=JSON.stringify(d.report||d,null,2);
  updateBtns();
};
$('restore').onclick=async()=>{
  if(!selected)return;
  if(!confirm('سيتم استخدام النسخة '+selected.id+' لإنشاء بيئة المشروع. لن تُعدَّل النسخة الأصلية. متابعة؟'))return;
  $('out').textContent='جارٍ الاستعادة...';
  const d=await j('/api/restore',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({point:selected.id,confirm:true,vaultKey:$('vaultKey').value,
      targetEnv:$('targetEnv').value,applyDatabase:$('applyDb').checked})});
  $('vaultKey').value='';verified=false;updateBtns();
  if(d.report&&d.report.states)renderStates(d.report.states);
  $('out').textContent=JSON.stringify(d.report||d,null,2);
  $('verdict').innerHTML=d.ok?'<span class="ok">اكتملت الاستعادة (راجع الحالات والخطوة الخارجية).</span>':'<span class="bad">توقفت الاستعادة عند: '+esc((d.report&&d.report.failureStage)||d.code||'—')+'</span>';
};
load();
</script></body></html>`;
}

export function createRecoveryCenterServer(options = {}) {
  const env = options.env || process.env;
  const clientFactory = options.clientFactory;
  const tokenOptions = options.tokenOptions || null;
  const restoreRoot = options.restoreRoot || null;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(page());
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        const readiness = await inspectRecoveryReadiness(env, tokenOptions || {});
        return json(res, 200, {
          ok: true, service: 'gharabi-recovery-center', standalone: true,
          driveConfigured: readiness.drive.configured,
          drive: {
            configured: readiness.drive.configured,
            refreshTokenAvailable: readiness.drive.refreshTokenStored,
            refreshTokenSource: readiness.drive.refreshTokenSource,
            refreshTokenCode: readiness.drive.refreshTokenCode,
            stateDatabaseConfigured: readiness.drive.stateDatabaseConfigured,
          },
          vaultKeyInEnv: false, // المركز لا يحمل مفتاح الخزنة في بيئته إطلاقاً.
          honestStates: RECOVERY_HONEST_STATES.map((s) => s.key),
          target: inspectTargetEnvironment(env, {}),
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/points') {
        const readiness = await inspectRecoveryReadiness(env, tokenOptions || {});
        if (!readiness.drive.configured) return json(res, 200, { ok: false, reason: 'drive_not_configured', readiness });
        const { store, code } = await makeStore(env, clientFactory, tokenOptions);
        if (!store) return json(res, 200, { ok: false, reason: code || 'drive_client_unavailable', readiness });
        const listed = await listRecoveryPoints(store);
        return json(res, 200, { ok: listed.ok === true, points: listed.points || [], readiness });
      }
      if (req.method === 'POST' && url.pathname === '/api/verify') {
        const body = await readBody(req);
        const { store, code } = await makeStore(env, clientFactory, tokenOptions);
        if (!store) return json(res, 200, { ok: false, code: code || 'drive_client_unavailable' });
        const listed = await listRecoveryPoints(store);
        const point = (listed.points || []).find((p) => p.id === body.point);
        if (!point) return json(res, 404, { ok: false, code: 'RECOVERY_POINT_NOT_FOUND' });
        // تحقق قراءة فقط: البيان + البصمات + الحزم، ثم محاولة فكّ الخزنة بالمفتاح المُدخَل.
        const v = await verifyRecoveryPoint(store, point);
        const envWithKey = body.vaultKey ? { ...env, DR_RECOVERY_VAULT_KEY: String(body.vaultKey) } : env;
        const vault = await openKeyVault(store, envWithKey);
        const vaultAbsent = vault.ok !== true && ['no_structure', 'no_head', 'vault_package_missing'].includes(String(vault.code));
        const problems = [...(v.problems || [])];
        if (!vault.ok && !vaultAbsent) problems.push(`vault_${vault.code}`);
        if (vault.ok && vault.integrity && vault.integrity.recordsMatch === false) problems.push('vault_integrity_mismatch');
        const report = {
          recoveryPointId: point.id, readOnly: true, problems,
          checks: {
            manifest: Boolean(point.manifest), hashes: v.ok === true,
            vaultOpened: vault.ok === true, vaultAbsent,
            vaultVersion: vault.version ?? null, vaultRecords: vault.recordCount ?? null,
          },
          states: {
            verified: problems.length === 0,
            vault_opened: vault.ok === true,
            source_restored: false, database_restored: false, secrets_restored: false,
            target_prepared: false, service_started: false, service_verified: false,
          },
        };
        return json(res, 200, { ok: problems.length === 0, report });
      }
      if (req.method === 'POST' && url.pathname === '/api/restore') {
        const body = await readBody(req);
        if (body.confirm !== true) return json(res, 428, { ok: false, code: 'OWNER_CONFIRMATION_REQUIRED' });
        const { store, code } = await makeStore(env, clientFactory, tokenOptions);
        if (!store) return json(res, 200, { ok: false, code: code || 'drive_client_unavailable' });
        const listed = await listRecoveryPoints(store);
        const point = (listed.points || []).find((p) => p.id === body.point);
        if (!point) return json(res, 404, { ok: false, code: 'RECOVERY_POINT_NOT_FOUND' });
        const targetEnv = parseTargetEnv(body.targetEnv);
        const targetDb = targetEnv.DR_RECOVERY_TEST_DATABASE_URL || targetEnv.DATABASE_URL_TARGET || env.DR_RECOVERY_TEST_DATABASE_URL || null;
        if (targetDb && env.DATABASE_URL && targetDb === env.DATABASE_URL) {
          return json(res, 409, { ok: false, code: 'REFUSED_PRODUCTION_DATABASE' });
        }
        // المفتاح والبيئة الهدف يُمرَّران في الذاكرة فقط، ولا يُعاد أي منهما.
        const restoreEnv = { ...env, ...targetEnv, ...(body.vaultKey ? { DR_RECOVERY_VAULT_KEY: String(body.vaultKey) } : {}) };
        let targetDir = options.targetDir || null;
        if (!targetDir) targetDir = restoreRoot
          ? fs.mkdtempSync(path.join(restoreRoot, 'restore-'))
          : fs.mkdtempSync(path.join(os.tmpdir(), 'gharabi-restore-'));
        const report = await runStandaloneRestore({
          store, point, env: restoreEnv, targetDir,
          isolatedDatabaseUrl: targetDb, applyDatabase: body.applyDatabase === true,
        });
        const states = honestStatesFromReport(report);
        return json(res, 200, {
          ok: report.ok === true,
          report: { ...report, states, targetEnvNames: Object.keys(targetEnv).sort() },
          target: inspectTargetEnvironment(env, { isolatedDatabaseUrl: targetDb }),
        });
      }
      return json(res, 404, { ok: false, code: 'NOT_FOUND' });
    } catch (e) {
      return json(res, 500, { ok: false, code: String(e?.code || 'error').slice(0, 80) });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createRecoveryCenterServer();
  server.listen(PORT, HOST, () => {
    console.log(`🛟 مركز استعادة الغرابي AI — http://${HOST}:${PORT}`);
    console.log('   خدمة مستقلة عن تطبيق الغرابي. لا تُسجّل أي مفتاح ولا تخزّنه.');
  });
}
