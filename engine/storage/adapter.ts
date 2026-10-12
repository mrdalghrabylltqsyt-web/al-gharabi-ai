/**
 * محوّل تخزين موحد لكل الحالة التي كانت تُكتب في ملف JSON محلي.
 *
 * سبب الوجود: على خطة Render المجانية لا يوجد قرص دائم، فتضيع قائمة الإبطال
 * وتوكنات المنصات المشفّرة ومساحة العمل عند كل إعادة نشر. هنا backend واحد
 * بواجهة واحدة: ملف محلي (الافتراضي، للتطوير)، وPostgres خارجي (Neon Free)
 * يُفعَّل تلقائياً عند وجود DATABASE_URL.
 *
 * لا يُسجَّل أي سر هنا: نص الاتصال لا يُطبع، ورسائل الخطأ مختصرة وبلا قيم.
 */
import fs from "node:fs";
import path from "node:path";

export type StorageBackendKind = "file" | "postgres";

export interface BackupInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface StorageStatus {
  backend: StorageBackendKind;
  /** هل يُتوقَّع أن تنجو البيانات من إعادة التشغيل/إعادة النشر؟ */
  durable: boolean;
  /** هل الكتابة ممكنة فعلاً في هذه اللحظة؟ */
  writable: boolean;
  /** هل الخلفية مهيّأة وسليمة (فشل الاتصال بقاعدة خارجية يجعلها false)؟ */
  healthy: boolean;
  /** ملف محلي فقط؛ null لPostgres. */
  stateDir: string | null;
  /** سبب صريح عند عدم الجهوزية، بلا أي سر. */
  detail: string | null;
}

export interface StorageAdapter {
  readonly backend: StorageBackendKind;
  /** هل البيانات المتوقعة تنجو من إعادة التشغيل وإعادة النشر؟ */
  readonly durable: boolean;
  /** يجهّز الخلفية (مجلد/جدول/اتصال). لا يرمي: يُسجّل الحالة بدل الإسقاط. */
  init(): Promise<void>;
  /** قراءة متزامنة عند الإقلاع لتوفير الحالة فوراً (backend الملف فقط). */
  readSync<T>(key: string): T | null;
  read<T>(key: string): Promise<T | null>;
  /** كتابة ذرّية: upsert واحد لPostgres، أو tmp + rename للملف. */
  write<T>(key: string, value: T): Promise<void>;
  /**
   * نسخة نصية من حالة قاعدة البيانات (JSON) لأغراض النسخ الاحتياطي فقط.
   * لا تتصل بأي قاعدة خارجية ولا تُظهر رابط الاتصال؛ ولا تُرفع إلا **مشفّرة**.
   */
  dump(): Promise<string>;
  status(): StorageStatus;
  listBackups(): BackupInfo[];
  /** إغلاق الموارد (اتصال قاعدة البيانات) عند الإيقاف. */
  close(): Promise<void>;
}

/** مفاتيح منطقية بدل أسماء ملفات، ليبقى العقد واحداً بين الخلفيتين. */
export const STORAGE_KEY_STATE = "state";
export const STORAGE_KEY_USAGE = "usage";
/**
 * حالة تحكّم صغيرة منفصلة عن لقطة العمل: بصمة توكن المعاينة وختمه الزمني،
 * ونافذة آخر رمز OTP استُهلك لكل بريد. فصلها يمنع تضخّم لقطة العمل ويكفي
 * لتمريرها عبر المحوّل نفسه فيبقى الدوام واحداً للخلفيتين.
 */
export const STORAGE_KEY_CONTROL = "control";

/**
 * عدّاد استهلاك حصة YouTube Data API (وحدات تقديرية لكل يوم) — مفتاح صغير مستقل
 * عن لقطة العمل، يمرّ عبر المحوّل نفسه فيصمد بعد restart للخلفيتين.
 */
export const STORAGE_KEY_YOUTUBE_QUOTA = "youtubeQuota";

const FILE_NAMES: Record<string, string> = {
  [STORAGE_KEY_STATE]: ".gharabi-state.json",
  [STORAGE_KEY_USAGE]: ".gharabi-usage.json",
  [STORAGE_KEY_CONTROL]: ".gharabi-control.json",
  [STORAGE_KEY_YOUTUBE_QUOTA]: ".gharabi-youtube-quota.json",
};

const BACKUP_PREFIX = "state-";
const BACKUP_KEEP = 7;

class FileStorageAdapter implements StorageAdapter {
  readonly backend = "file" as const;
  private writable = false;
  private detail: string | null = null;
  /**
   * ملف محلي دائم فقط إن لم نكن على مضيف معروف بأن قرصه عابر (Render/Heroku/
   * Netlify/Lambda…). Render Free يضبط RENDER=true، فبلا DATABASE_URL يُعلَن
   * التخزين عابراً بصراحة بدل ادعاء دوام غير مثبت.
   */
  readonly durable: boolean;

  constructor(private readonly stateDir: string, ephemeralHost = false) {
    this.durable = !ephemeralHost;
  }

  private fileFor(key: string): string {
    return path.join(this.stateDir, FILE_NAMES[key] || `${key}.json`);
  }

  private backupDir(): string {
    return path.join(this.stateDir, ".gharabi-backups");
  }

  async init(): Promise<void> {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      const probe = path.join(this.stateDir, `.gharabi-write-probe-${process.pid}`);
      fs.writeFileSync(probe, "ok", { encoding: "utf8", mode: 0o600 });
      fs.unlinkSync(probe);
      this.writable = true;
      this.detail = null;
    } catch {
      this.writable = false;
      this.detail = "state_dir_not_writable";
    }
  }

  readSync<T>(key: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(this.fileFor(key), "utf8")) as T;
    } catch {
      return null;
    }
  }

  async read<T>(key: string): Promise<T | null> {
    return this.readSync<T>(key);
  }

  private backupBeforeWrite(): void {
    try {
      const source = this.fileFor(STORAGE_KEY_STATE);
      if (!fs.existsSync(source)) return;
      fs.mkdirSync(this.backupDir(), { recursive: true });
      const stamp = new Date().toISOString().slice(0, 10);
      const target = path.join(this.backupDir(), `${BACKUP_PREFIX}${stamp}.json`);
      if (!fs.existsSync(target)) fs.copyFileSync(source, target);
      const backups = fs.readdirSync(this.backupDir())
        .filter((n) => n.startsWith(BACKUP_PREFIX) && n.endsWith(".json"))
        .sort();
      while (backups.length > BACKUP_KEEP) {
        const oldest = backups.shift();
        if (oldest) { try { fs.unlinkSync(path.join(this.backupDir(), oldest)); } catch { /* تجاهل */ } }
      }
    } catch {
      /* النسخ الاحتياطي أفضل جهد ولا يجب أن يمنع الكتابة الأساسية */
    }
  }

  async write<T>(key: string, value: T): Promise<void> {
    if (key === STORAGE_KEY_STATE) this.backupBeforeWrite();
    const target = this.fileFor(key);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, target);
    this.writable = true;
  }

  /**
   * نسخة نصية من ملفات الحالة المحلية. لا تشمل ملفات مفاتيح/أسرار، لأن حالة
   * التطبيق (state/usage/control) تحمل توكنات مشفّرة بالفعل وليس أسراراً صريحة.
   * تُرفع هذه النسخة **مشفّرة** فقط (AES-256-GCM) ولا تصل إلى Drive خاماً.
   */
  async dump(): Promise<string> {
    const out: Record<string, unknown> = { backend: this.backend, exportedAt: new Date().toISOString(), keys: {} };
    for (const key of Object.keys(FILE_NAMES)) {
      try {
        out.keys[key] = JSON.parse(fs.readFileSync(this.fileFor(key), "utf8"));
      } catch {
        out.keys[key] = null;
      }
    }
    return JSON.stringify(out, null, 2);
  }

  status(): StorageStatus {
    return { backend: this.backend, durable: this.durable, writable: this.writable, healthy: this.writable, stateDir: this.stateDir, detail: this.detail };
  }

  listBackups(): BackupInfo[] {
    try {
      return fs.readdirSync(this.backupDir())
        .filter((name) => /^state-\d{4}-\d{2}-\d{2}\.json$/.test(name))
        .map((name) => { const stat = fs.statSync(path.join(this.backupDir(), name)); return { name, size: stat.size, modifiedAt: stat.mtime.toISOString() }; })
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    } catch {
      return [];
    }
  }

  async close(): Promise<void> {
    /* لا موارد مفتوحة */
  }
}

/**
 * إعداد pool لPostgres. دالة خالصة قابلة للاختبار بلا قاعدة فعلية.
 *
 * SSL مفروض من التطبيق (لا يُعتمد على sslmode في الرابط): بعض روابط Neon تأتي
 * بلا sslmode، فنجبر TLS حتى لا يُنقل أي سر بلا تشفير. sslmode=disable يلغي
 * الفرض صراحةً للاختبار المحلي فقط.
 *
 * الحد الأقصى للاتصالات 3 (لا 5): أثناء Rolling Deploy على Render تتعايش العملية
 * القديمة والجديدة لحظات، وفي خطة Neon المجانية يكون حد الاتصالات ضيقاً (وخصوصاً
 * على نقطة الاتصال المباشرة غير المجمّعة). تقليل max يمنع تجاوز الحد الذي يُنتج
 * `53000 insufficient_resources` ويفشل الإقلاع. min=0 فلا يبقى اتصال خامل دائم.
 * المهلة 15 ثانية حتى يتسع استيقاظ Neon من النوم.
 */
export function postgresPoolConfig(connectionString: string): Record<string, unknown> {
  const forceSsl = !/sslmode=disable/i.test(connectionString);
  return {
    connectionString,
    max: 3,
    min: 0,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    allowExitOnIdle: true,
    application_name: "gharabi-ai",
    ...(forceSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

/**
 * أخطاء إقلاع Postgres القابلة لإعادة المحاولة: فئة الاتصال (08*)، تعذّر الاتصال
 * الآن (57P03)، ضغط الاتصالات (53300 too_many_connections، 53000
 * insufficient_resources)، وأخطاء الشبكة العابرة. الأخطاء غير القابلة (فشل مصادقة
 * 28P01/28000، قاعدة غير موجودة 3D000) تفشل بسرعة بدل إهدار المحاولات — تبقى
 * fail-closed في كل الأحوال.
 */
export function isRetryablePgStartupError(error: any): boolean {
  const texts: string[] = [];
  const collect = (e: any): void => {
    if (!e) return;
    if (typeof e === "string") { texts.push(e); return; }
    const code = `${e.code ?? ""} ${e.errno ?? ""}`.trim();
    const msg = String(e.message ?? "");
    if (code) texts.push(code);
    if (msg) texts.push(msg);
    if (Array.isArray(e.errors)) e.errors.forEach(collect);
  };
  collect(error);
  const blob = texts.join(" | ").toLowerCase();
  // غير قابلة لإعادة المحاولة: مصادقة/قاعدة/صلاحية.
  if (/28p01|28000|3d000|42p01/.test(blob)) return false;
  return (
    /\b08[0-9a-f]{3}\b/.test(blob) ||               // class 08 connection exception
    blob.includes("57p03") ||                        // cannot_connect_now
    blob.includes("53300") ||                        // too_many_connections
    blob.includes("53000") ||                        // insufficient_resources
    /econnrefused|econnreset|etimedout|enotfound|eai_again|epipe/.test(blob) ||
    /timeout exceeded when trying to connect|connection terminated|server closed the connection|connection timeout/.test(blob)
  );
}

/**
 * هل رابط الاتصال يشير إلى نقطة Neon المجمّعة (pooled)؟ يُكتشف من اسم المضيف بلا
 * كشف أي قيمة (اسم المضيف ليس سراً). النقط المجمّعة تحمل عادة `-pooler`، وقد
 * تحمل وسيطة `pgbouncer`. الغرض: تحذير المالك إن كان الاتصال مباشراً على Render
 * حيث تتزامن عمليتان أثناء النشر — وهو ما يُنتج 53000/53300. لا يُعاد الرابط.
 */
export function isPooledPostgresEndpoint(connectionString: string): boolean {
  try {
    const host = new URL(connectionString.replace(/^postgresql:/i, "postgres:")).hostname.toLowerCase();
    return host.includes("-pooler") || host.includes("pgbouncer");
  } catch {
    return false;
  }
}

export interface PgStartupRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** حقن النوم للاختبار (بلا انتظار حقيقي). */
  sleep?: (ms: number) => Promise<void>;
  /** حقن دالة الاتصال بمحاولة واحدة (للاختبار بلا قاعدة فعلية). */
  connect?: () => Promise<void>;
}

/**
 * تشغيل الإقلاع مع إعادة محاولة للأخطاء العابرة فقط (منطق صافٍ قابل للاختبار).
 * كل محاولة تنفّذ `connect` كاملاً (إنشاء pool جديد) فلا يُعاد استخدام pool
 * "مسمّم" بعد خطأ اتصال (خصوصاً استيقاظ Neon من النوم). تراجع أسّي بسقف + ارتجاف.
 * الفشل النهائي يُعاد كـ`{ ok:false }` (لا رمي) ليتولّى المُستدعي الإعلان الصريح.
 */
export async function runPgStartupWithRetry(
  connect: () => Promise<void>,
  opts: PgStartupRetryOptions = {},
): Promise<{ ok: boolean; attempts: number; error?: any }> {
  const maxAttempts = opts.maxAttempts ?? 6;
  const base = opts.baseDelayMs ?? 750;
  const cap = opts.maxDelayMs ?? 4_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await connect();
      return { ok: true, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryablePgStartupError(error)) break;
      const delay = Math.min(attempt * base, cap) + Math.floor(Math.random() * 200);
      await sleep(delay);
    }
  }
  return { ok: false, attempts: maxAttempts, error: lastError };
}

/**
 * عميل Postgres بسيط: جدول key/value JSONB واحد، بلا migrations معقدة.
 * يُنشئ الجدول عند أول تشغيل إن لم يكن موجوداً.
 */
class PostgresStorageAdapter implements StorageAdapter {
  readonly backend = "postgres" as const;
  /** لا نعتبر القاعدة دائمةقبل نجاح الاتصال الفعلي والتهيئة. */
  private healthy = false;
  private detail: string | null = null;
  private pool: any = null;

  constructor(private readonly connectionString: string) {}

  get durable(): boolean {
    return this.healthy;
  }

  async init(): Promise<void> {
    // pool جديد لكل محاولة: بعد خطأ اتصال (خصوصاً استيقاظ Neon من النوم) قد
    // يبقى الـpool السابق في حالة "مسمّمة"، فنعيد البناء بدل إعادة استخدامه.
    const connectOnce = async (): Promise<void> => {
      if (this.pool) { try { await this.pool.end?.(); } catch { /* تجاهل */ } this.pool = null; }
      const { Pool } = await import("pg");
      this.pool = new Pool(postgresPoolConfig(this.connectionString));
      // خطأ اتصال عابر داخل pool لا يجب أن يُسقط العملية.
      this.pool.on?.("error", () => { /* يُعالج عند الطلب التالي */ });
      // Neon Free ينام ويستيقظ عند أول اتصال؛ المهلة 15 ثانية تكفي للاستيقاظ،
      // وإعادة المحاولة بتراجع تغطي أطول استيقاظ أو ضغط اتصالات عابر.
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS gharabi_state (
           key text PRIMARY KEY,
           value jsonb NOT NULL,
           updated_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      this.healthy = true;
      this.detail = null;
    };

    const result = await runPgStartupWithRetry(connectOnce);
    if (!result.ok) {
      this.healthy = false;
      const error: any = result.error;
      this.detail = `database_unavailable:${String(error?.code || error?.name || "error").slice(0, 40)}`;
    }
  }

  readSync<T>(_key: string): T | null {
    return null;
  }

  async read<T>(key: string): Promise<T | null> {
    if (!this.pool || !this.healthy) return null;
    try {
      const result = await this.pool.query("SELECT value FROM gharabi_state WHERE key = $1", [key]);
      return (result.rows?.[0]?.value ?? null) as T | null;
    } catch (error: any) {
      this.detail = `database_read_failed:${String(error?.code || error?.name || "error").slice(0, 40)}`;
      throw error;
    }
  }

  async write<T>(key: string, value: T): Promise<void> {
    if (!this.pool) throw new Error("storage_not_initialized");
    await this.pool.query(
      `INSERT INTO gharabi_state (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
    this.healthy = true;
  }

  /**
   * نسخة منطقية من حالة قاعدة البيانات (كل صفوف gharabi_state). لا تُظهر رابط
   * الاتصال ولا أي سرّ، ولا تُرفع إلا مشفّرة. عند تعذّر القراءة تُرمى لتُعلَن
   * النسخة فاشلة بدل نسخة ناقصة كاذبة.
   */
  async dump(): Promise<string> {
    if (!this.pool || !this.healthy) throw new Error("database_unavailable");
    const result = await this.pool.query("SELECT key, value, updated_at FROM gharabi_state ORDER BY key");
    return JSON.stringify(
      { backend: this.backend, exportedAt: new Date().toISOString(), rows: result.rows ?? [] },
      null,
      2,
    );
  }

  status(): StorageStatus {
    return { backend: this.backend, durable: this.healthy, writable: this.healthy, healthy: this.healthy, stateDir: null, detail: this.detail };
  }

  listBackups(): BackupInfo[] {
    return [];
  }

  async close(): Promise<void> {
    try { await this.pool?.end?.(); } catch { /* تجاهل */ }
    this.pool = null;
    this.healthy = false;
  }
}

export interface StorageAdapterOptions {
  stateDir: string;
  databaseUrl?: string;
  /**
   * هل المضيف الحالي معروف بأن قرصه عابر؟ (Render/Heroku/Lambda/Netlify).
   * يُمرَّر من الخادم بدل قراءة البيئة داخل المحوّل ليبقى قابلاً للاختبار.
   */
  ephemeralHost?: boolean;
}

/** يُنشئ الخلفية تلقائياً: Postgres عند وجود DATABASE_URL، وإلا ملف محلي. */
export function createStorageAdapter(options: StorageAdapterOptions): StorageAdapter {
  const url = (options.databaseUrl || "").trim();
  if (url) return new PostgresStorageAdapter(url);
  return new FileStorageAdapter(options.stateDir, options.ephemeralHost === true);
}

/**
 * مضيفات بلا قرص دائم: ملف الحالة يُمسح عند كل إعادة نشر. Render يضبط RENDER=true،
 * وHeroku/AWS Lambda/Netlify/Azure لها علاماتها. الغرض: ألا ندّعي دواماً غير مثبت.
 */
export function isEphemeralHost(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.RENDER ||
    env.DYNO ||
    env.AWS_LAMBDA_FUNCTION_NAME ||
    env.NETLIFY ||
    env.AWS_EXECUTION_ENV,
  );
}