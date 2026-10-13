/**
 * اختبار المستمسكات المطلوبة للتقسيط في ردود العقل.
 *
 * يثبت أن محرّك الرد الحتمي يذكر المستمسكات **المسجّلة فقط** في رد السعر/القسط،
 * ولا يذكر أي مستمسك عند عدم تسجيلها، ولا يخترع وثيقة غير موجودة.
 */

import { classifyComment, generateReply, type ReplyFactSet } from '../social/comments';

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function group(title: string): void { console.log(`\n▸ ${title}`); }

const PRICE_COMMENT = 'كم سعر الغسالة بالتقسيط؟';

function replyWith(docs: string[] | undefined): string {
  const cls = classifyComment(PRICE_COMMENT);
  const facts: ReplyFactSet = {
    productName: 'غسالة الغرابي',
    priceText: '1,250,000 د.ع',
    monthlyInstallmentText: '156,250 د.ع',
    requiredDocuments: docs,
  };
  return generateReply(cls, facts).text;
}

group('1) ذكر المستمسكات المسجّلة');
{
  const text = replyWith(['إثبات هوية', 'كفيل']);
  check('docs mentioned', text.includes('المستمسكات المطلوبة'), text);
  check('doc1 present', text.includes('إثبات هوية'), text);
  check('doc2 present', text.includes('كفيل'), text);
  check('price still present', text.includes('1,250,000'), text);
}

group('2) عدم اختراع مستمسك عند عدم التسجيل');
{
  const text = replyWith(undefined);
  check('no docs clause', !text.includes('المستمسكات المطلوبة'), text);
  check('price present', text.includes('1,250,000'), text);
  const empty = replyWith([]);
  check('empty list => no clause', !empty.includes('المستمسكات المطلوبة'), empty);
}

group('3) تلخيص القائمة الطويلة (أكثر من ثلاثة)');
{
  const text = replyWith(['أ', 'ب', 'ج', 'د']);
  check('summarized for >3', text.includes('بيانات أساسية') && text.includes('مستمسكات إضافية'), text);
  check('no raw long listing', !text.includes('، د'), text);
}

group('4) بلا سعر/قسط مسجّل لا تُذكر المستمسكات (لا صلة)');
{
  const cls = classifyComment('كم السعر؟');
  const text = generateReply(cls, { requiredDocuments: ['إثبات هوية'] }).text;
  check('no docs without price', !text.includes('المستمسكات المطلوبة'), text);
}

if (failures.length) {
  console.error(`\n✖ ${failures.length} فحصاً فاشلاً:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`\n${passed} فحصاً ناجحاً.`);
