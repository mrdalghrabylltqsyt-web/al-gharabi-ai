/**
 * اختبارات وصف YouTube (منطق خالص) — صياغة حتمية آمنة + تطبيع + تحقق وصول الوصف.
 * بلا شبكة ولا مزود: يثبت أن الوصف لا يخترع معلومة، وأن التحقق لا يُدَّعى بلا دليل.
 */
import {
  buildDeterministicYouTubeDescription,
  buildYouTubeDescriptionPrompt,
  buildDescriptionHashtags,
  normalizeDescriptionForMatch,
  verifyUploadedDescription,
} from '../social/youtubeDescription';

let passed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail?: string) { if (cond) passed += 1; else fails.push(`${name}${detail ? ` — ${detail}` : ''}`); }

const baseInput = {
  product: {
    name: 'ثلاجة سامسونغ 18 قدم',
    category: 'appliances',
    specs: ['تبريد No Frost', 'ضمان المصنع سنة'],
    installmentOptions: ['دفعة أولى 25%', 'أقساط حتى 12 شهراً'],
    inStock: true,
  },
  showroomName: 'معرض الغرابي للتقسيط',
  tagline: 'قسّمها علينا… وارتاح',
  city: 'بغداد',
  contact: { phone: '07701234567', whatsapp: '07701234567' },
};

// --- 1) الوصف الحتمي يستخدم الحقائق الفعلية فقط ---
{
  const r = buildDeterministicYouTubeDescription(baseInput);
  check('1: يضم اسم المنتج', r.description.includes('ثلاجة سامسونغ 18 قدم'));
  check('1: يضم اسم المعرض', r.description.includes('معرض الغرابي للتقسيط'));
  check('1: يضم المواصفات', r.description.includes('تبريد No Frost'));
  check('1: يضم خيارات التقسيط', r.description.includes('أقساط حتى 12 شهراً'));
  check('1: يضم CTA ببيانات تواصل حقيقية', r.hasContactCta && r.description.includes('07701234567'));
  check('1: الأساس منتج', r.basis === 'product');
  check('1: يذكر حقائق صريحة', r.factsUsed.length > 0);
  check('1: يضم الوسوم', r.description.includes('#تقسيط'));
}

// --- 2) بلا منتج (عام) لا يخترع اسماً ولا سعراً ولا رقماً ---
{
  const r = buildDeterministicYouTubeDescription({ showroomName: 'معرض الغرابي', city: 'بغداد' });
  check('2: الأساس عام', r.basis === 'general');
  check('2: بلا CTA عند غياب بيانات تواصل', r.hasContactCta === false && !/\d{7,}/.test(r.description));
  check('2: لا ادعاء سعر', !/سعر|دينار|د\.ع/.test(r.description));
}

// --- 3) لا دفعة أولى/خصم/ضمان مُختلق عند غيابها في الحقائق ---
{
  const r = buildDeterministicYouTubeDescription({ product: { name: 'مكيف', category: 'appliances', specs: [], installmentOptions: [], inStock: null }, showroomName: 'الغرابي' });
  check('3: لا «بدون دفعة أولى»', !/بدون دفعة/.test(r.description));
  check('3: لا خصم', !/خصم|تخفيض/.test(r.description));
  check('3: لا ضمان مُختلق', !/ضمان/.test(r.description));
}

// --- 4) وسوم مبنية على التصنيف المسجّل فقط ---
{
  const tags = buildDescriptionHashtags('phones');
  check('4: وسم الهواتف موجود', tags.includes('#هواتف'));
  check('4: بلا تكرار', new Set(tags).size === tags.length);
  check('4: تصنيف مجهول => وسم عام', buildDescriptionHashtags('unknown-cat').includes('#منتجات'));
}

// --- 5) تعليمات المزود لا تحمل سراً وتُلزم بالحقائق ---
{
  const p = buildYouTubeDescriptionPrompt(baseInput);
  check('5: تمنع اختراع السعر', p.includes('ممنوع') && p.includes('سعر'));
  check('5: تتضمن اسم المنتج', p.includes('ثلاجة سامسونغ 18 قدم'));
  check('5: بلا أي سرّ', !/token|secret|client/i.test(p));
}

// --- 6) تطبيع نص الوصف ---
{
  check('6: توحيد المسافات والأسطر', normalizeDescriptionForMatch('سطر   واحد\n\nسطر 2') === normalizeDescriptionForMatch('سطر واحد\nسطر 2'));
  check('6: توحيد الألف', normalizeDescriptionForMatch('أهلا') === normalizeDescriptionForMatch('اهلا'));
  check('6: CRLF مثل LF', normalizeDescriptionForMatch('a\r\nb') === normalizeDescriptionForMatch('a\nb'));
}

// --- 7) تحقق وصول الوصف: لا يُدَّعى بلا دليل ---
{
  check('7: بلا وصف معتمد => غير مطلوب', verifyUploadedDescription('', 'anything').code === 'DESCRIPTION_NOT_REQUIRED');
  const ok = verifyUploadedDescription('وصف معتمد', 'وصف معتمد');
  check('7: تطابق تام => مُثبت', ok.verified && ok.code === 'DESCRIPTION_CONFIRMED');
  const norm = verifyUploadedDescription('سطر واحد\nسطر 2', 'سطر   واحد\n\n سطر 2');
  check('7: تطابق بعد التطبيع => مُثبت', norm.verified, norm.code);
  const missing = verifyUploadedDescription('وصف معتمد', '');
  check('7: وصف فارغ => مفقود', !missing.verified && missing.code === 'DESCRIPTION_MISSING');
  const unread = verifyUploadedDescription('وصف معتمد', null);
  check('7: تعذّرت القراءة => غير مُثبت', !unread.verified && unread.code === 'DESCRIPTION_UNREADABLE');
  const mismatch = verifyUploadedDescription('الوصف المعتمد الكامل', 'نص آخر مختلف');
  check('7: عدم تطابق => غير مُثبت', !mismatch.verified && mismatch.code === 'DESCRIPTION_MISMATCH');
}

console.log(`\nوصف YouTube: ${passed} ناجح، ${fails.length} فاشل`);
if (fails.length) { for (const f of fails) console.log(`  ✗ ${f}`); process.exit(1); }
else console.log('✓ كل فحوص وصف YouTube ناجحة');
