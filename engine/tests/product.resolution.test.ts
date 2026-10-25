/**
 * ربط العقل والعقول المساعدة بمخزن المنتجات — حسم المنتج من مصدر واحد.
 *
 * الجذر: بوابة العقل المركزي كانت تحسم المنتج من الربط الصريح للمنشور فقط، فكل سؤال
 * سعر على منشور غير مربوط (أغلب المنشورات) يُصعَّد `price_unverified` رغم أن المنتج
 * وسعره وقسطه في المخزن. الآن: اهتمام الزبون ← ربط صريح ← نص المنشور يسمّي المنتج ←
 * نص الزبون يسمّيه/مطابقة حاسمة. وحارس تعارض + لا منتج بلا سعر + غموض ⇒ null.
 */
import { resolveInteractionProduct, productNamedInText, conflictsWithComment, productFactStatement } from '../social/productResolution';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(t: string): void { console.log(`\n▸ ${t}`); }

const P = [
  { id: 'wash', name: 'غسالة رويال رحماني', cashPrice: 450000, inStock: true },
  { id: 'fr18', name: 'ثلاجة كولر 18 قدم', cashPrice: 1000000, inStock: true },
  { id: 'fr14', name: 'ثلاجة كولر 14 قدم', cashPrice: 800000, inStock: true },
  { id: 'tv55', name: 'تلفزيون سامسونج 55 بوصة', cashPrice: 900000, inStock: true },
  { id: 'pump', name: 'بور هواء', cashPrice: 120000 },
  { id: 'noprice', name: 'مراية فيها اضواء', cashPrice: 0 },
];

group('1) ترتيب الأدلة');
check('اهتمام الزبون أولاً', resolveInteractionProduct({ products: P, leadProductId: 'tv55', postLinkedProduct: P[0], commentText: 'كم السعر' }).via === 'lead');
check('ربط المنشور الصريح ثانياً (السلوك السابق)', resolveInteractionProduct({ products: P, postLinkedProduct: P[1], postText: 'غسالة رويال رحماني', commentText: 'كم السعر' }).product?.id === 'fr18');
const fromPost = resolveInteractionProduct({ products: P, postText: '📌 [محتوى فيديو] غسالة رويال رحماني — دليلك الشامل للتقسيط', commentText: 'شكد سعرها؟' });
check('★ منشور غير مربوط يسمّي المنتج ⇒ يُحسم من نص المنشور', fromPost.product?.id === 'wash' && fromPost.via === 'post_text', JSON.stringify(fromPost));
const fromComment = resolveInteractionProduct({ products: P, postText: 'عروض التقسيط الميسر', commentText: 'شكد سعر ثلاجة كولر 14 قدم؟' });
check('★ الزبون يسمّي المنتج ⇒ يُحسم من نصه', fromComment.product?.id === 'fr14' && fromComment.via === 'comment_text', JSON.stringify(fromComment));
check('مطابقة خصائص حاسمة (ماركة+نوع+مقاس)', resolveInteractionProduct({ products: P, commentText: 'بيش تلفزيون سامسونج 55؟' }).product?.id === 'tv55');

group('2) لا اختراع');
check('★ منشور عام بلا منتج + سؤال عام ⇒ null', resolveInteractionProduct({ products: P, postText: 'عروض معرض الغرابي للتقسيط', commentText: 'شكد السعر؟' }).product === null);
check('★ «ثلاجة كولر» بلا مقاس (منتجان) ⇒ null لا اختيار عشوائي', productNamedInText('ثلاجات كولر بكل الأحجام', P) === null);
check('★ منتج بلا سعر مسجّل لا يُعتمد', productNamedInText('مراية فيها اضواء حديثة', P) === null);
check('الاسم الأطول يفوز عند الاحتواء', productNamedInText('ثلاجة كولر 18 قدم بأقساط', P)?.id === 'fr18');
check('ترتيب الكلمات حر', productNamedInText('هواء بور قوي للتصليح', P)?.id === 'pump');

group('3) حارس التعارض');
check('★ منشور ثلاجة + سؤال عن تلفزيون ⇒ لا يُعطى سعر الثلاجة', resolveInteractionProduct({ products: [P[1]], postText: 'ثلاجة كولر 18 قدم', commentText: 'شنو سعر التلفزيون؟' }).product === null);
check('منشور ثلاجة + «كم سعرها» ⇒ الثلاجة', resolveInteractionProduct({ products: P, postText: 'ثلاجة كولر 18 قدم', commentText: 'كم سعرها؟' }).product?.id === 'fr18');
check('ذكر نفس النوع ليس تعارضاً', conflictsWithComment(P[1], 'كم سعر الثلاجة') === false);
check('منشور ثلاجة + سؤال عن تلفزيون سامسونج 55 ⇒ التلفزيون من نص الزبون', resolveInteractionProduct({ products: P, postText: 'ثلاجة كولر 18 قدم', commentText: 'وتلفزيون سامسونج 55 بوصة بيش؟' }).product?.id === 'tv55');

group('4) حقيقة المنتج للعقل والعقول المساعدة');
const fact = productFactStatement(P[0], { priceText: '450,000 د.ع', installmentText: '46,875 د.ع شهرياً', inStock: true });
check('★ الحقيقة تحمل الاسم والسعر والقسط والتوفر', fact === 'المنتج: غسالة رويال رحماني — السعر: 450,000 د.ع — القسط: 46,875 د.ع شهرياً — متوفر', fact);
check('بلا قسط مسجّل لا يُذكر قسط', !productFactStatement(P[4], { priceText: '120,000 د.ع', installmentText: null, inStock: null }).includes('القسط'));

console.log('\n' + '='.repeat(60));
if (failures.length) {
  console.error(`FAILED: ${failures.length} — passed ${passed}`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`PASSED: ${passed} product-resolution checks`);
