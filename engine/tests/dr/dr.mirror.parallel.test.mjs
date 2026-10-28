// سرعة المرآة (2026-10-28): رفع/تحقق بتوازٍ محدود (≤8)، المجلدات تُنشأ قبل الرفع، والتلاعب ما زال يمنع الاعتماد.
import { runCurrentMirror, mapLimit } from '../../../tools/dr/current-mirror.mjs';
import crypto from 'node:crypto';
const files = Array.from({ length: 120 }, (_, i) => ({ path: `src/d${i % 7}/sub${i % 3}/f${i}.ts`, content: Buffer.from(`file ${i}\n`) }));
const blobs = new Map(); let inflight = 0, peak = 0, folderCreates = 0; const folders = new Set(); let calls = 0;
const delay = () => new Promise((r) => setTimeout(r, 5));
const store = {
  client: { getAbout: async () => ({ ok: true, data: { storageQuota: { usage: 0, limit: 1e12 } } }),
    downloadFile: async (id) => { inflight++; peak = Math.max(peak, inflight); calls++; await delay(); inflight--; return { ok: true, data: blobs.get(id) }; } },
  ensureStructure: async () => ({ ok: true }),
  readMirrorHead: async () => ({ ok: false }),
  ensureVersionDirPath: async (v, segs) => { const k = `${v}:${segs.join('/')}`; if (!folders.has(k)) { folders.add(k); folderCreates++; } return { ok: true, data: k }; },
  upsertVersionFile: async (v, p, c) => { const k = `${v}:${p.split('/').slice(0, -1).join('/')}`; if (!folders.has(k)) throw new Error('folder not precreated ' + k); inflight++; peak = Math.max(peak, inflight); calls++; await delay(); inflight--; const id = crypto.randomUUID(); blobs.set(id, Buffer.from(c)); return { ok: true, data: { id } }; },
  writeVersionManifest: async () => ({ ok: true }), writeMirrorHead: async () => ({ ok: true }),
  listVersions: async () => ({ ok: true, data: [] }),
};
const t = Date.now();
const r = await runCurrentMirror({ store, files, now: '2026-10-28T00:00:00Z' });
console.log('state', r.state, 'uploaded', r.uploaded, 'peak', peak, 'folders', folderCreates, 'calls', calls, 'ms', Date.now() - t);
if (r.state !== 'synced' || r.uploaded !== 120 || peak > 8 || peak < 2) process.exit(1);
// verify failure still blocks commit
const bad = { ...store, client: { ...store.client, downloadFile: async () => ({ ok: true, data: Buffer.from('x') }) } };
const r2 = await runCurrentMirror({ store: bad, files, now: '2026-10-28T00:00:00Z' });
console.log('tampered', r2.state, r2.reason);
if (r2.state !== 'failed' || r2.reason !== 'verify_failed') process.exit(1);
let n = 0; await mapLimit([1,2,3], 2, async () => { n++; }); if (n !== 3) process.exit(1);
console.log('OK');
