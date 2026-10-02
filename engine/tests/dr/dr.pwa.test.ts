/**
 * اختبار PWA لمركز استعادة الغرابي AI — تثبيت على الجوال وسطح المكتب.
 *
 * يثبت بسلوك حقيقي (خادم المركز نفسه على منفذ محلي، بلا شبكة وبلا مزوّد):
 *  1) البيان صالح ويُخدَم بنوع manifest صحيح و`display: standalone`.
 *  2) `start_url` و`scope` صحيحان، والاسم/الاسم القصير بالعربية.
 *  3) الأيقونات تُخدَم 200 PNG فعلياً وبأحجامها الصحيحة (192/512/180 + maskable).
 *  4) الصفحة تحمل وسم `rel="manifest"` وتسجيل الـService Worker.
 *  5) الـService Worker: تمرير شفّاف بلا كاش إطلاقاً، ولا يتدخّل في `/api/*` ولا POST.
 *  6) لا أي سرّ/مفتاح/متغيّر بيئة داخل البيان أو الصفحة أو الأصول.
 *  7) مسارات `/api/*` الحسّاسة تبقى بلا `Cache-Control` تخزين (no-store).
 *  8) انحدار: مسارات المركز الأصلية (health/points) ما زالت تعمل كما قبل.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRecoveryCenterServer } from '../../../tools/dr/recovery-center.mjs';
import {
  buildManifest,
  manifestJson,
  encodePng,
  iconPng,
  renderIconRgba,
  SERVICE_WORKER_JS,
  pwaHeadTags,
  injectPwaIntoHtml,
  servePwaAsset,
  PWA_MANIFEST_PATH,
  PWA_SW_PATH,
} from '../../../tools/dr/recoveryPwa.mjs';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

/** لا يجب أن يظهر أي نمط سرّي في أي أصل PWA. */
const SECRET_PATTERNS = [
  /GOCSPX-/,
  /AIzaSy/,
  /1\/\/[A-Za-z0-9_-]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // رابط قاعدة حقيقي فقط — يُستثنى العنصر النائب الموثّق user:pass@host.
  /postgres(ql)?:\/\/(?!user:pass@host\b)[^\s"']+:[^\s"']+@/,
  /refresh[_-]?token["'\s:=]+[A-Za-z0-9_-]{12,}/i,
  /DRIVE_TOKEN_ENCRYPTION_KEY["'\s:=]+[A-Za-z0-9+/=]{16,}/,
  /DR_RECOVERY_VAULT_KEY["'\s:=]+[A-Za-z0-9+/=]{16,}/,
];
function hasNoSecret(text: string): boolean {
  return !SECRET_PATTERNS.some((re) => re.test(text));
}

async function main() {
  // --- 1) وحدة البيان والأيقونات (بلا خادم) ---
  const manifest = buildManifest();
  check('manifest name arabic', manifest.name === 'مركز استعادة الغرابي AI');
  check('manifest short_name arabic', manifest.short_name === 'استعادة الغرابي');
  check('manifest start_url root', manifest.start_url === '/');
  check('manifest scope root', manifest.scope === '/');
  check('manifest display standalone', manifest.display === 'standalone');
  check('manifest lang rtl', manifest.lang === 'ar' && manifest.dir === 'rtl');
  check('manifest theme color', /^#[0-9a-f]{6}$/i.test(manifest.theme_color));
  check('manifest background color', /^#[0-9a-f]{6}$/i.test(manifest.background_color));
  check('manifest no secret', hasNoSecret(manifestJson()));

  const iconSizes = new Set(manifest.icons.map((i: any) => i.sizes));
  check('manifest has 192 icon', iconSizes.has('192x192'));
  check('manifest has 512 icon', iconSizes.has('512x512'));
  check('manifest has maskable icons', manifest.icons.some((i: any) => i.purpose === 'maskable'));
  check('manifest icons are png', manifest.icons.every((i: any) => i.type === 'image/png'));

  // PNG فعلي صالح بأبعاد صحيحة
  const png192 = iconPng(192);
  check('png192 signature', png192.slice(0, 8).toString('hex') === '89504e470d0a1a0a');
  check('png192 dimensions', png192.readUInt32BE(16) === 192 && png192.readUInt32BE(20) === 192);
  check('png192 color type RGBA', png192[25] === 6);
  const png512 = iconPng(512);
  check('png512 dimensions', png512.readUInt32BE(16) === 512 && png512.readUInt32BE(20) === 512);
  // كل بكسلات الأيقونة معتمة (مناسبة للـmaskable بلا حواف شفافة)
  const rgba = renderIconRgba(64);
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
  check('icon fully opaque (maskable-safe)', opaque);

  // --- 2) Service Worker: بلا كاش ولا تدخّل في API/POST ---
  check('sw no caches api', !/caches\.open|cache\.put|CacheStorage/.test(SERVICE_WORKER_JS));
  // نزيل التعليقات أولاً كي لا يُحتسب ذكر المصطلح داخل شرح السياسة.
  const swCode = SERVICE_WORKER_JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('sw does not respondWith', !swCode.includes('respondWith'));
  check('sw guards /api', SERVICE_WORKER_JS.includes('/api/'));
  check('sw guards non-GET', SERVICE_WORKER_JS.includes("method") || SERVICE_WORKER_JS.includes('GET'));
  check('sw no secret', hasNoSecret(SERVICE_WORKER_JS));

  // --- 3) الحقن في HTML ---
  const sampleHtml = '<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>';
  const injected = injectPwaIntoHtml(sampleHtml);
  check('inject adds manifest link', injected.includes('rel="manifest"'));
  check('inject adds theme-color', injected.includes('name="theme-color"'));
  check('inject adds apple touch icon', injected.includes('apple-touch-icon'));
  check('inject adds sw register', injected.includes(PWA_SW_PATH));
  check('inject is idempotent', injectPwaIntoHtml(injected) === injected);
  check('head tags no secret', hasNoSecret(pwaHeadTags()));

  // --- 4) servePwaAsset (بلا خادم) ---
  check('serve manifest', servePwaAsset(PWA_MANIFEST_PATH)?.contentType.startsWith('application/manifest+json') === true);
  check('serve sw no-cache', servePwaAsset(PWA_SW_PATH)?.cacheControl === 'no-cache');
  check('serve unknown null', servePwaAsset('/nope') === null);
  check('encodePng standalone works', encodePng(2, 2, Buffer.alloc(16, 255)).slice(0, 8).toString('hex') === '89504e470d0a1a0a');

  // --- 5) الخادم الحقيقي: الأصول تُخدَم 200 ---
  const env: any = {}; // لا حاجة لأي اعتماد لعرض أصول PWA
  const server = createRecoveryCenterServer({ env, clientFactory: null });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const get = async (p: string) => {
    const r = await fetch(base + p);
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ct: r.headers.get('content-type') || '', cc: r.headers.get('cache-control') || '', buf };
  };

  const root = await get('/');
  check('root 200 html', root.status === 200 && root.ct.includes('text/html'));
  check('root has manifest link', root.buf.toString('utf8').includes('rel="manifest"'));
  check('root has sw register', root.buf.toString('utf8').includes(PWA_SW_PATH));
  check('root no-store', root.cc.includes('no-store'));
  check('root viewport-fit cover', root.buf.toString('utf8').includes('viewport-fit=cover'));
  check('root no secret', hasNoSecret(root.buf.toString('utf8')));

  const mf = await get(PWA_MANIFEST_PATH);
  check('manifest 200', mf.status === 200);
  check('manifest content-type', mf.ct.startsWith('application/manifest+json'));
  let parsed: any = null;
  try { parsed = JSON.parse(mf.buf.toString('utf8')); } catch { /* ignore */ }
  check('manifest valid json', parsed && parsed.display === 'standalone' && parsed.start_url === '/');
  check('manifest no secret (served)', hasNoSecret(mf.buf.toString('utf8')));

  const sw = await get(PWA_SW_PATH);
  check('sw 200 js', sw.status === 200 && sw.ct.includes('javascript'));
  check('sw no-cache', sw.cc.includes('no-cache'));

  for (const [iconPath, size] of [
    ['/icons/icon-192.png', 192],
    ['/icons/icon-512.png', 512],
    ['/icons/maskable-192.png', 192],
    ['/icons/maskable-512.png', 512],
    ['/icons/apple-touch-icon.png', 180],
  ] as [string, number][]) {
    const ic = await get(iconPath);
    check(`icon ${iconPath} 200 png`, ic.status === 200 && ic.ct.includes('image/png'));
    check(`icon ${iconPath} is png`, ic.buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a');
    check(`icon ${iconPath} size ${size}`, ic.buf.readUInt32BE(16) === size && ic.buf.readUInt32BE(20) === size);
    check(`icon ${iconPath} no secret`, hasNoSecret(ic.buf.toString('latin1')));
  }

  // --- 6) لا تخزين لاستجابات API الحسّاسة (online-first) ---
  const health = await get('/api/health');
  check('api/health 200', health.status === 200);
  check('api/health no-store', health.cc.includes('no-store'));
  const points = await get('/api/points');
  check('api/points no-store', points.cc.includes('no-store'));
  check('api/points no secret', hasNoSecret(points.buf.toString('utf8')));

  // --- 7) لا ملف أصول PWA خارج الوحدة (لا drift) ---
  const libPwa = path.join(repoRoot, 'dr-recovery-center/lib/recoveryPwa.mjs');
  const toolPwa = path.join(repoRoot, 'tools/dr/recoveryPwa.mjs');
  check('lib copy exists', fs.existsSync(libPwa));
  check('lib copy identical to tools', fs.existsSync(libPwa) && fs.readFileSync(libPwa, 'utf8') === fs.readFileSync(toolPwa, 'utf8'));

  // --- 8) انحدار: المركز ما زال مستقلاً (لا يستورد خادم الغرابي/dist/git) ---
  const centerSrc = fs.readFileSync(path.join(repoRoot, 'tools/dr/recovery-center.mjs'), 'utf8');
  check('center no server.ts import', !/from\s+['"][^'"]*server(\.ts)?['"]/.test(centerSrc));
  check('center no dist import', !/from\s+['"][^'"]*\/dist\//.test(centerSrc));
  check('center imports pwa module', centerSrc.includes("from './recoveryPwa.mjs'"));

  server.close();

  const total = passed + failures.length;
  if (failures.length) {
    console.error(`\n❌ PWA TEST FAILURES (${failures.length}/${total}):`);
    for (const f of failures) console.error(`   ✗ ${f}`);
    process.exit(1);
  }
  console.log(`\n✅ PWA RECOVERY CENTER TESTS PASSED: ${passed} checks`);
}

main().catch((e) => { console.error('PWA test crashed:', e); process.exit(1); });
