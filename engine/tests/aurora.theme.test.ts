/**
 * اختبار انحدار هوية "Aurora Glass" (fail-old / pass-new).
 *
 * يثبت أن الهوية البصرية الموحّدة مطبّقة على التطبيق كله (لا الغلاف فقط):
 * خلفية كحلية متدرّجة، أسطح زجاجية، رموز ألوان من مصدر واحد، تركيز موحّد،
 * احترام تقليل الحركة، وإصلاح التمرير الأفقي في ترويسة الهاتف.
 *
 * يفشل على الشجرة قبل إعادة التصميم (لا @theme، ولا .glass، ولا خلفية متدرّجة،
 * وترويسة الهاتف تُحدث تمريراً أفقياً) وينجح بعدها. لا يلمس أي منطق وظيفي.
 */
import fs from 'node:fs';
import path from 'node:path';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const css = read('src/index.css');
const html = read('index.html');
const app = read('src/App.tsx');
const header = read('src/components/common/Header.tsx');
const sidebar = read('src/components/common/Sidebar.tsx');
const hub = read('src/components/common/SectionHub.tsx');

console.log('\n=== رموز الهوية (مصدر واحد) ===');
check('@theme معرّف', css.includes('@theme {'));
check('كحلي مُعاد ضبطه (slate-950)', css.includes('--color-slate-950:'));
check('لون تركوازي Aurora', css.includes('--color-aurora-cyan:'));
check('لون بنفسجي Aurora', css.includes('--color-aurora-violet:'));
check('أسطح 900/800 شبه شفافة (تأثير زجاجي)', /--color-slate-900:\s*oklch\([^)]*\/\s*0\./.test(css));

console.log('\n=== الخلفية المتدرّجة ===');
check('خلفية body متدرّجة (radial-gradient)', /body\s*\{[\s\S]*?radial-gradient/.test(css));
check('خلفية ثابتة (background-attachment: fixed)', css.includes('background-attachment: fixed'));
check('لا سطح معتم على جذر التطبيق', !/min-h-screen\s+bg-slate-950\s+text-slate-100/.test(app));
check('لا خلفية معتمة على <body>', !html.includes('class="bg-slate-950'));

console.log('\n=== الأنماط الزجاجية المشتركة ===');
check('.glass معرّف', css.includes('.glass {'));
check('.glass-strong معرّف', css.includes('.glass-strong'));
check('.glass-active معرّف', css.includes('.glass-active'));
check('ضبابية (backdrop-filter) في الأنماط', css.includes('backdrop-filter'));

console.log('\n=== التطبيق على الهيكل والمكوّنات الداخلية ===');
check('الشريط الجانبي زجاجي', sidebar.includes('glass-strong'));
check('الترويسة زجاجية', header.includes('glass-strong'));
check('لوحة القسم زجاجية', hub.includes('glass'));
const tsxFiles = fs.readdirSync(path.join(root, 'src/components'), { recursive: true })
  .map((f) => String(f)).filter((f) => f.endsWith('.tsx'));
const glassFiles = tsxFiles.filter((f) =>
  /className="[^"]*\bglass\b/.test(read(path.join('src/components', f))));
check('الزجاج مطبّق على ≥15 مكوّناً داخلياً', glassFiles.length >= 15);

console.log('\n=== وصولية وتقليل الحركة ===');
check('تركيز موحّد (:focus-visible)', css.includes(':focus-visible'));
check('احترام تقليل الحركة', css.includes('prefers-reduced-motion') && css.includes('animation: none'));
check('حركة nav-in محفوظة', css.includes('@keyframes nav-in') && css.includes('.animate-nav-in'));

console.log('\n=== إصلاح التمرير الأفقي على الهاتف ===');
check('ترويسة الهاتف تلتفّ (flex-wrap)', header.includes('flex-wrap sm:flex-nowrap'));
check('مجموعة الإجراءات لا تنكمش (shrink-0)', header.includes('shrink-0'));

console.log('\n=== لا تكرار CSS متضارب (لا خلفيات صريحة غير الهوية) ===');
const allSrc = tsxFiles.map((f) => read(path.join('src/components', f))).join('\n');
check('لا خلفيات رمادية/سوداء صريحة تشوّه الهوية', !/bg-(black|gray|zinc|neutral|stone)-\d/.test(allSrc));

console.log(`\nPASSED: ${pass} فحص Aurora، ${fail} فشل`);
process.exit(fail ? 1 : 0);
