/**
 * الغرابي AI — قدرات PWA لمركز الاستعادة (تطبيق قابل للتثبيت على الجوال وسطح المكتب).
 *
 * هذا الملف يوفّر **العناصر اللازمة للتثبيت فقط** لخدمة مركز الاستعادة القائمة،
 * بلا أي تغيير في المصادقة ولا في الجلسات ولا في التشفير ولا في OAuth ولا في أي
 * منطق استعادة. لا يقرأ أي سرّ ولا يُصدر أي سرّ.
 *
 * لماذا وحدة منفصلة: تُستورَد من `recovery-center.mjs` و`recovery-console-ui.mjs`
 * وتُنسخ إلى `dr-recovery-center/lib/` عبر `sync-lib.mjs`، فتبقى الحزمة المستقلة
 * قابلة للنشر وحدها (بلا اعتماد على بقية المشروع).
 *
 * مبادئ الأمان المطبَّقة:
 *   - لا Service Worker يخزّن أي شيء: تمرير شفّاف بلا كاش إطلاقاً (online-first).
 *   - لا يتدخّل في `/api/*` مطلقاً (لا تخزين استجابات مصادقة/رموز/خزنة/نسخ).
 *   - الأيقونات والبيان لا تحمل أي سرّ/معرّف/مفتاح/متغيّر بيئة.
 *   - كل الصور مُولَّدة محلياً (PNG مُرمَّز داخلياً) بلا اعتماد خارجي.
 *
 * الهوية البصرية: درع (حماية) + صليب (استعادة/طوارئ) بألوان الغرابي (أخضر زمردي
 * على خلفية داكنة) — بلا أي شعار خارجي مُختلق.
 */

import zlib from 'node:zlib';

/** اسم التطبيق الكامل (كما يظهر في واجهة التثبيت). */
export const PWA_APP_NAME = 'مركز استعادة الغرابي AI';
/** الاسم القصير (تحت أيقونة الشاشة الرئيسية). */
export const PWA_SHORT_NAME = 'استعادة الغرابي';
/** عنوان مختصر لأيقونة iOS. */
export const PWA_APPLE_TITLE = 'استعادة الغرابي';
/** وصف التطبيق. */
export const PWA_DESCRIPTION = 'تطبيق مستقل لقراءة نقاط استعادة الغرابي AI من Google Drive والبدء بالاستعادة عند فقدان بيئة التشغيل.';
/** مسار البيان ومسار الـService Worker. */
export const PWA_MANIFEST_PATH = '/manifest.webmanifest';
export const PWA_SW_PATH = '/service-worker.js';
/** لون الهوية (خلفية داكنة + زمردي). */
export const PWA_THEME_COLOR = '#0b1220';
export const PWA_BACKGROUND_COLOR = '#0b1220';

// ---------------------------------------------------------------------------
// مُرمّز PNG داخلي (بلا أي مكتبة خارجية) — 8-bit RGBA
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** يُرمّز مصفوفة RGBA (عرض×ارتفاع×4) إلى ملف PNG كامل. */
export function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // فلتر الصف = None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// رسم الأيقونة: درع (حماية) + صليب (استعادة) — ألوان الغرابي
// ---------------------------------------------------------------------------

/** مضلّع الدرع بإحداثيات مُطبَّعة [0..1]. */
const SHIELD_POLY = [
  [0.27, 0.19], [0.73, 0.19], [0.73, 0.50],
  [0.66, 0.65], [0.50, 0.82], [0.34, 0.65], [0.27, 0.50],
];

function pointInPoly(nx, ny, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (((yi > ny) !== (yj > ny)) && (nx < ((xj - xi) * (ny - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

const CROSS_V = { x0: 0.435, x1: 0.565, y0: 0.33, y1: 0.68 };
const CROSS_H = { x0: 0.355, x1: 0.645, y0: 0.435, y1: 0.565 };
function inRect(nx, ny, r) { return nx >= r.x0 && nx <= r.x1 && ny >= r.y0 && ny <= r.y1; }

const HEX = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const COL_BG = HEX(PWA_BACKGROUND_COLOR);
const COL_SHIELD_TOP = HEX('#34d399');
const COL_SHIELD_BOT = HEX('#059669');
const COL_CROSS = HEX('#ffffff');

/**
 * يرسم أيقونة مركز الاستعادة بحجم مربّع. خلفية داكنة كاملة (آمنة للـmaskable)
 * + درع زمردي متدرّج + صليب أبيض في المركز.
 */
export function renderIconRgba(size) {
  const SS = 3; // supersampling للتلطيف (anti-alias)
  const W = size * SS;
  const acc = new Float64Array(size * size * 4);
  for (let sy = 0; sy < W; sy += 1) {
    const ny = (sy + 0.5) / W;
    for (let sx = 0; sx < W; sx += 1) {
      const nx = (sx + 0.5) / W;
      let r; let g; let b;
      const inShield = pointInPoly(nx, ny, SHIELD_POLY);
      if (inShield && (inRect(nx, ny, CROSS_V) || inRect(nx, ny, CROSS_H))) {
        [r, g, b] = COL_CROSS;
      } else if (inShield) {
        const t = Math.min(1, Math.max(0, (ny - 0.19) / (0.82 - 0.19)));
        r = COL_SHIELD_TOP[0] + (COL_SHIELD_BOT[0] - COL_SHIELD_TOP[0]) * t;
        g = COL_SHIELD_TOP[1] + (COL_SHIELD_BOT[1] - COL_SHIELD_TOP[1]) * t;
        b = COL_SHIELD_TOP[2] + (COL_SHIELD_BOT[2] - COL_SHIELD_TOP[2]) * t;
      } else {
        [r, g, b] = COL_BG;
      }
      const ox = Math.floor(sx / SS);
      const oy = Math.floor(sy / SS);
      const o = (oy * size + ox) * 4;
      acc[o] += r; acc[o + 1] += g; acc[o + 2] += b; acc[o + 3] += 255;
    }
  }
  const samples = SS * SS;
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const o = i * 4;
    rgba[o] = Math.round(acc[o] / samples);
    rgba[o + 1] = Math.round(acc[o + 1] / samples);
    rgba[o + 2] = Math.round(acc[o + 2] / samples);
    rgba[o + 3] = 255; // معتمة تماماً (الأفضل للأيقونات وmaskable)
  }
  return rgba;
}

const iconCache = new Map();
/** يُعيد PNG الأيقونة بالحجم المطلوب (مُخزَّن في الذاكرة لتفادي إعادة الرسم). */
export function iconPng(size) {
  const key = `icon-${size}`;
  if (!iconCache.has(key)) iconCache.set(key, encodePng(size, size, renderIconRgba(size)));
  return iconCache.get(key);
}

/** مسارات الأيقونات المدعومة (مصدر واحد للحقن في البيان وفي المسارات). */
export const PWA_ICON_PATHS = {
  '/icons/icon-192.png': 192,
  '/icons/icon-512.png': 512,
  '/icons/maskable-192.png': 192,
  '/icons/maskable-512.png': 512,
  '/icons/apple-touch-icon.png': 180,
};

// ---------------------------------------------------------------------------
// بيان التطبيق (Web App Manifest)
// ---------------------------------------------------------------------------

/** يبني كائن البيان. لا يحتوي أي سرّ — بيانات وصفية للعرض فقط. */
export function buildManifest() {
  return {
    name: PWA_APP_NAME,
    short_name: PWA_SHORT_NAME,
    description: PWA_DESCRIPTION,
    lang: 'ar',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: PWA_THEME_COLOR,
    background_color: PWA_BACKGROUND_COLOR,
    categories: ['business', 'productivity', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/** البيان كـJSON (بلا أي سرّ). */
export function manifestJson() {
  return JSON.stringify(buildManifest(), null, 2);
}

// ---------------------------------------------------------------------------
// Service Worker — تمرير شفّاف بلا كاش إطلاقاً (online-first للعمليات الحسّاسة)
// ---------------------------------------------------------------------------

/**
 * Service Worker آمن: لا يخزّن أي طلب. وجوده يجعل التطبيق قابلاً للتثبيت،
 * لكنه لا يتدخّل في `/api/*` ولا في أي طلب غير GET، ولا يضع شيئاً في الكاش.
 */
export const SERVICE_WORKER_JS = `/* مركز استعادة الغرابي AI — Service Worker (بلا كاش إطلاقاً). */
'use strict';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (event) {
  // سياسة أمان صارمة: لا تخزين لأي شيء. تمرير شفّاف بالكامل (online-first).
  // - لا نتدخّل في أي طلب غير GET (POST للتحقق/الاستعادة يمرّ للشبكة دائماً).
  // - لا نتدخّل في /api/* مطلقاً (استجابات المصادقة/النقاط/الخزنة لا تُلمَس).
  // - لا نستدعي respondWith إطلاقاً، فلا كاش ولا استجابة مُصنّعة.
  return;
});
`;

// ---------------------------------------------------------------------------
// وسوم <head> وسكربت التسجيل
// ---------------------------------------------------------------------------

/** وسوم PWA التي تُحقن في <head> (بيان + أيقونات + theme + iOS). */
export function pwaHeadTags() {
  return [
    `<link rel="manifest" href="${PWA_MANIFEST_PATH}">`,
    `<meta name="theme-color" content="${PWA_THEME_COLOR}">`,
    `<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">`,
    `<link rel="icon" type="image/png" sizes="512x512" href="/icons/icon-512.png">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">`,
    `<meta name="apple-mobile-web-app-capable" content="yes">`,
    `<meta name="mobile-web-app-capable" content="yes">`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
    `<meta name="apple-mobile-web-app-title" content="${PWA_APPLE_TITLE}">`,
  ].join('\n');
}

/** سكربت تسجيل الـService Worker (بلا أي كاش؛ التسجيل فقط). */
export function pwaRegistrationScript() {
  return `<script>
if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('${PWA_SW_PATH}',{scope:'/'}).catch(function(){});});}
</script>`;
}

/**
 * يحقن وسوم PWA وسكربت التسجيل داخل مستند HTML قائم (بلا تغيير أي منطق آخر).
 * يُدرج الوسوم قبل </head> والسكربت قبل </body>.
 */
export function injectPwaIntoHtml(html) {
  let out = String(html);
  if (!out.includes('rel="manifest"')) out = out.replace('</head>', `${pwaHeadTags()}\n</head>`);
  if (!out.includes(PWA_SW_PATH)) out = out.replace('</body>', `${pwaRegistrationScript()}\n</body>`);
  return out;
}

// ---------------------------------------------------------------------------
// خدمة أصول PWA (يستخدمها الخادم المستقل)
// ---------------------------------------------------------------------------

/**
 * يُعيد أصل PWA (بيان/أيقونة/service worker) للمسار المطلوب، أو null إن لم يكن
 * من أصول PWA. بلا أي سرّ، وبترويسات تخزين مناسبة.
 * @returns {{status:number, contentType:string, body:Buffer|string, cacheControl:string}|null}
 */
export function servePwaAsset(pathname) {
  if (pathname === PWA_MANIFEST_PATH) {
    return { status: 200, contentType: 'application/manifest+json; charset=utf-8', body: manifestJson(), cacheControl: 'public, max-age=3600' };
  }
  if (pathname === PWA_SW_PATH) {
    // الـService Worker يجب ألا يُخزَّن طويلاً كي تسري التحديثات.
    return { status: 200, contentType: 'application/javascript; charset=utf-8', body: SERVICE_WORKER_JS, cacheControl: 'no-cache' };
  }
  if (Object.prototype.hasOwnProperty.call(PWA_ICON_PATHS, pathname)) {
    return { status: 200, contentType: 'image/png', body: iconPng(PWA_ICON_PATHS[pathname]), cacheControl: 'public, max-age=86400' };
  }
  return null;
}
