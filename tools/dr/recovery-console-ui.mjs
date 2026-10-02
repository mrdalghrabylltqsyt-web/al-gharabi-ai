#!/usr/bin/env node
/**
 * الغرابي AI — **واجهة الاستعادة المستقلة** (Standalone Recovery UI).
 *
 * واجهة ويب محلية صغيرة تعمل **بلا خادم الغرابي وبلا dist وبلا جلسة مالك**:
 *   node tools/dr/recovery-console-ui.mjs            # ثم افتح http://127.0.0.1:4599
 *   PORT=4599 node tools/dr/recovery-console-ui.mjs
 *
 * لماذا خادم محلي مستقل: إذا انهار المشروع بالكامل، لا يبقى أي زر داخل التطبيق.
 * هذا الخادم يستخدم نفس منطق `standalone-recovery.mjs` (بلا استيراد خادم الغرابي)،
 * ويتيح للمالك: عرض نقاط الاستعادة، إدخال مفتاح خزنة الطوارئ، وبدء الاستعادة.
 *
 * الأمان:
 *   - يستمع على 127.0.0.1 فقط (جهاز المالك)، لا على الشبكة.
 *   - لا يُسجَّل المفتاح ولا يُعاد في أي استجابة.
 *   - لا تُعدَّل نقاط الاستعادة (قراءة فقط)، وتُرفض قاعدة الإنتاج.
 */

import http from 'node:http';
import { URL } from 'node:url';
import {
  buildRecoveryClient,
  buildRecoveryStore,
  inspectRecoveryReadiness,
  listRecoveryPoints,
  inspectTargetEnvironment,
  runStandaloneRestore,
} from './standalone-recovery.mjs';

const HOST = process.env.RECOVERY_UI_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '4599', 10);

function page() {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>الغرابي AI — الاستعادة المستقلة</title>
<style>
  body{font-family:system-ui,Segoe UI,Tahoma,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px}
  h1{font-size:20px} .card{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:16px;margin:12px 0}
  button{background:#2563eb;color:#fff;border:0;border-radius:10px;padding:10px 16px;font-size:15px;cursor:pointer}
  button:disabled{opacity:.5;cursor:not-allowed}
  input{background:#0b1220;color:#e2e8f0;border:1px solid #334155;border-radius:10px;padding:10px;width:100%;box-sizing:border-box}
  .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .pt{border:1px solid #334155;border-radius:12px;padding:12px;margin:8px 0;cursor:pointer}
  .pt.sel{border-color:#22c55e;background:#0b2013}
  .ok{color:#4ade80}.bad{color:#f87171}.muted{color:#94a3b8}
  pre{background:#0b1220;border:1px solid #334155;border-radius:10px;padding:12px;overflow:auto;max-height:340px}
</style></head><body>
<h1>🛟 الغرابي AI — واجهة الاستعادة المستقلة</h1>
<p class="muted">تعمل بلا خادم الغرابي. تعرض نقاط الاستعادة من Google Drive، تطلب مفتاح خزنة الطوارئ، وتستعيد.</p>
<div class="card"><div class="row"><button id="load">عرض نقاط الاستعادة</button><span id="ready" class="muted"></span></div></div>
<div class="card"><h3>نقاط الاستعادة</h3><div id="points" class="muted">اضغط «عرض نقاط الاستعادة».</div></div>
<div class="card"><h3>مفتاح خزنة الطوارئ</h3>
  <input id="vaultKey" type="password" placeholder="DR_RECOVERY_VAULT_KEY" autocomplete="off">
  <p class="muted">لا يُسجَّل ولا يُحفظ — يُستخدم للفكّ فقط.</p>
  <div class="row"><button id="restore" disabled>بدء الاستعادة للنقطة المختارة</button></div>
</div>
<div class="card"><h3>النتيجة</h3><pre id="out">—</pre></div>
<script>
let selected=null;
const $=(id)=>document.getElementById(id);
async function j(url,opt){const r=await fetch(url,opt);return r.json();}
$('load').onclick=async()=>{
  $('ready').textContent='...';
  const d=await j('/api/points');
  if(!d.ok){$('out').textContent=JSON.stringify(d,null,2);$('ready').textContent='';return;}
  $('ready').textContent=(d.readiness.drive.configured?'✅ اعتماد Drive مضبوط':'⚠️ اعتماد Drive ناقص')+
    (d.readiness.vaultKey.present?' · مفتاح الخزنة مضبوط':' · أدخل مفتاح الخزنة');
  $('points').innerHTML='';
  (d.points||[]).forEach(p=>{
    const el=document.createElement('div');el.className='pt'+(p.restorable?'':' bad');
    el.innerHTML='<b>'+p.id+'</b> · '+(p.createdAt||'—')+' · commit '+String(p.commit||'—').slice(0,10)+
      ' · ملفات '+p.fileCount+' · <span class="'+(p.restorable?'ok':'bad')+'">'+(p.restorable?'سليمة':'ناقصة')+'</span>';
    el.onclick=()=>{[...document.querySelectorAll('.pt')].forEach(x=>x.classList.remove('sel'));el.classList.add('sel');selected=p;updateBtn();};
    $('points').appendChild(el);
  });
};
function updateBtn(){$('restore').disabled=!(selected&&$('vaultKey').value.length>0);}
$('vaultKey').oninput=updateBtn;
$('restore').onclick=async()=>{
  if(!selected)return;
  $('out').textContent='جارٍ الاستعادة...';
  const d=await j('/api/restore',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({point:selected.id,vaultKey:$('vaultKey').value,confirm:true})});
  $('out').textContent=JSON.stringify(d,null,2);
};
</script></body></html>`;
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

export function createRecoveryUiServer(options = {}) {
  const env = options.env || process.env;
  const clientFactory = options.clientFactory;
  const makeStore = async () => {
    const client = await buildRecoveryClient(env, { clientFactory });
    if (!client || client.ok === false) return null;
    return buildRecoveryStore(client, { readOnlyStructure: true });
  };
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(page());
      }
      if (req.method === 'GET' && url.pathname === '/api/points') {
        const readiness = await inspectRecoveryReadiness(env);
        if (!readiness.drive.configured) return json(res, 200, { ok: false, reason: 'drive_not_configured', readiness });
        const store = await makeStore();
        if (!store) return json(res, 200, { ok: false, reason: 'drive_client_unavailable', readiness });
        const listed = await listRecoveryPoints(store);
        return json(res, 200, { ok: listed.ok === true, points: listed.points || [], readiness });
      }
      if (req.method === 'POST' && url.pathname === '/api/restore') {
        const body = await readBody(req);
        if (body.confirm !== true) return json(res, 428, { ok: false, code: 'OWNER_CONFIRMATION_REQUIRED' });
        const store = await makeStore();
        if (!store) return json(res, 200, { ok: false, reason: 'drive_client_unavailable' });
        const listed = await listRecoveryPoints(store);
        const point = (listed.points || []).find((p) => p.id === body.point);
        if (!point) return json(res, 404, { ok: false, code: 'RECOVERY_POINT_NOT_FOUND' });
        const targetDb = typeof body.targetDatabaseUrl === 'string' && body.targetDatabaseUrl ? body.targetDatabaseUrl : (env.DR_RECOVERY_TEST_DATABASE_URL || null);
        if (targetDb && env.DATABASE_URL && targetDb === env.DATABASE_URL) {
          return json(res, 409, { ok: false, code: 'REFUSED_PRODUCTION_DATABASE' });
        }
        const restoreEnv = body.vaultKey ? { ...env, DR_RECOVERY_VAULT_KEY: String(body.vaultKey) } : env;
        const report = await runStandaloneRestore({ store, point, env: restoreEnv, targetDir: options.targetDir || undefined, isolatedDatabaseUrl: targetDb, applyDatabase: body.applyDatabase === true });
        return json(res, 200, { ok: report.ok === true, report, target: inspectTargetEnvironment(env, { isolatedDatabaseUrl: targetDb }) });
      }
      return json(res, 404, { ok: false, code: 'NOT_FOUND' });
    } catch (e) {
      return json(res, 500, { ok: false, code: String(e?.code || 'error').slice(0, 80) });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createRecoveryUiServer();
  server.listen(PORT, HOST, () => {
    console.log(`🛟 الغرابي AI — واجهة الاستعادة المستقلة: http://${HOST}:${PORT}`);
    console.log('   (تعمل بلا خادم الغرابي. لا يُسجَّل أي مفتاح.)');
  });
}
