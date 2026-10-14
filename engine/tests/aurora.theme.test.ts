/**
 * اختبار انحدار الهوية البصرية "الفحم الرصين" (fail-old / pass-new).
 *
 * يثبت أن الهوية الموحّدة مطبّقة على التطبيق كله (لا الغلاف فقط):
 * محايد فحمي **بلا صبغة زرقاء/بنفسجية**، لون تمييز **واحد** (الزمردي)، خلفية صلبة
 * أنيقة (لا تدرّجات ملوّنة متعدّدة)، أسطح مرتفعة بظل عميق، تركيز موحّد، واحترام
 * تقليل الحركة.
 *
 * يفشل على الهوية القديمة (Aurora: ألوان متعدّدة + تدرّجات + زجاج ضبابي) وينجح
 * بعد إعادة البناء. لا يلمس أي منطق وظيفي.
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
check('محايد فحمي مُعاد ضبطه (slate-950)', css.includes('--color-slate-950:'));
check('لون تمييز واحد (accent)', css.includes('--color-accent:'));
check('لا ألوان Aurora متعدّدة (cyan/violet/blue)', !css.includes('--color-aurora-cyan:') && !css.includes('--color-aurora-violet:') && !css.includes('--color-aurora-blue:'));
check('محايد فحمي صلب بلا شفافية زجاجية', /--color-slate-900:\s*#/.test(css) && !/--color-slate-900:\s*oklch/.test(css));
check('لا صبغة زرقاء/بنفسجية في المحايد (hex بلا oklch hue 260+)', !/--color-slate-9\d0:\s*oklch/.test(css));

console.log('\n=== الخلفية الصلبة الأنيقة ===');
check('خلفية body صلبة (لا تدرّجات radial ملوّنة)', /body\s*\{[\s\S]*?background-color:\s*#0a0a0f/.test(css) && !/body\s*\{[\s\S]*?radial-gradient/.test(css));
check('خلفية ثابتة (background-attachment: fixed)', css.includes('background-attachment: fixed'));
check('لا سطح معتم على جذر التطبيق', !/min-h-screen\s+bg-slate-950\s+text-slate-100/.test(app));
check('لا خلفية معتمة على <body>', !html.includes('class="bg-slate-950'));

console.log('\n=== الأسطح المرتفعة المشتركة ===');
check('.glass معرّف', css.includes('.glass {'));
check('.glass-strong معرّف', css.includes('.glass-strong'));
check('.glass-active معرّف', css.includes('.glass-active'));
check('ظل عمق ناعم (shadow-elevated) لا ضبابية زجاجية', css.includes('--shadow-elevated') && !css.includes('backdrop-filter'));
check('حدّ علوي مهم بلون التمييز (accent-top)', css.includes('.accent-top'));

console.log('\n=== التطبيق على الهيكل والمكوّنات الداخلية ===');
check('الشريط الجانبي سطح مرتفع', sidebar.includes('glass-strong'));
check('الترويسة سطح مرتفع', header.includes('glass-strong'));
check('لوحة القسم سطح مرتفع', hub.includes('glass'));
const tsxFiles = fs.readdirSync(path.join(root, 'src/components'), { recursive: true })
  .map((f) => String(f)).filter((f) => f.endsWith('.tsx'));
const glassFiles = tsxFiles.filter((f) =>
  /className="[^"]*\bglass\b/.test(read(path.join('src/components', f))));
check('الأسطح مطبّقة على ≥15 مكوّناً داخلياً', glassFiles.length >= 15);

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

console.log(`\nPASSED: ${pass} فحص الهوية، ${fail} فشل`);
process.exit(fail ? 1 : 0);
