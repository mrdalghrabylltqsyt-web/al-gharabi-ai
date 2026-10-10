/**
 * عزل بيئة اختبارات الخادم — مصدر واحد يمنع تكرار فجوة ISO-A.
 *
 * السبب: كان عدد من الاختبارات يُشغّل الخادم بـ`{ ...process.env }` بلا عزل
 * حاسم لقاعدة البيانات. وبما أن `createStorageAdapter` يختار Postgres تلقائياً
 * عند وجود `DATABASE_URL`، فإن مضيفاً يضبطه (CI/مطوّر/رابط إنتاج) يُقلع خادم
 * الاختبار فوق قاعدة البيانات نفسها فيكتب/يقرأ فيها — تلوّث أو تلف بيانات الإنتاج.
 *
 * هنا نبني بيئة فرعية مُنقّاة: نُفرّغ كل ما قد يوجّه الكتابة إلى قاعدة حية
 * (DATABASE_URL وبدائله)، ونجبر تخزين الملف المحلي على مجلد مؤقت مستقل
 * (STATE_DIR) حتى لا يتقاسم أي اختبار الحالة مع غيره أو مع تشغيل حقيقي.
 *
 * منطق صافٍ قابل للاختبار: لا شبكة ولا أسرار.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * متغيّرات توجيه التخزين إلى قاعدة بيانات خارجية. حُذفها إلزامي لكل خادم اختبار:
 * أي واحد منها موجود => يُقلع الخادم فوق قاعدة ليست معزولة اختبارياً.
 */
export const LIVE_DB_ENV_KEYS: readonly string[] = Object.freeze([
  'DATABASE_URL',
  'GHARABI_TEST_DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL_NON_POOLING',
]);

export interface BuildServerTestEnvOptions {
  /** مجلد حالة صريح (اختباري مسبقاً). إن غاب يُنشأ مجلد مؤقت جديد. */
  stateDir?: string;
  /** بادئة اسم المجلد المؤقت (تساعد على التمييز في os.tmpdir). */
  prefix?: string;
  /** متغيّرات إضافية تُدمج في النهاية (تتقدّم على الافتراضيات). */
  overrides?: Record<string, string | undefined>;
}

/**
 * يبني بيئة آمنة لخادم اختبار منطلق من بيئة العملية:
 * 1) ينسخ البيئة، 2) يحذف مفاتيح قاعدة البيانات الحية، 3) يثبّت STATE_DIR مؤقتاً.
 * `overrides` تُطبَّق أخيراً لإتاحة ضبط PORT/NODE_ENV/APP_URL... إلخ.
 */
export function buildServerTestEnv(options: BuildServerTestEnvOptions = {}): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of LIVE_DB_ENV_KEYS) delete env[key];
  env.STATE_DIR = options.stateDir || mkdtempSync(join(tmpdir(), options.prefix || 'gharabi-test-'));
  // Render والعَلامات المشابهة تجعل المدخل يُعلن "مضيف عابر"؛ هنا نحن على مجلد
  // مؤقت محلي حقيقي، فنُزيل العلامات لئلا يظهر تحذير دوام غير مطابق للواقع.
  delete env.RENDER;
  delete env.DYNO;
  delete env.AWS_LAMBDA_FUNCTION_NAME;
  delete env.NETLIFY;
  if (options.overrides) {
    for (const [k, v] of Object.entries(options.overrides)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
  return env;
}

/** فحص انحدار: هل تخلو بيئة الخادم من أي توجيه لقاعدة حية؟ */
export function hasLiveDbEnv(env: Record<string, string | undefined>): boolean {
  return LIVE_DB_ENV_KEYS.some((key) => Boolean(env[key]));
}
