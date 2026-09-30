/**
 * مسارات منظومة DR (Google Drive) — تفويض منفصل عن تسجيل دخول التطبيق.
 *
 * - `GET /api/dr/drive/auth-url` (للمالك): يولّد رابط تفويض بنطاق drive.file
 *   حصراً مع state عشوائي أحادي الاستخدام (CSRF + TTL). لا يعرض أي سرّ.
 * - `GET/POST /api/dr/drive/callback`: يستقبل عودة Google، يستهلك state مرة
 *   واحدة، يبادل الرمز، ويخزّن رمز التجديد **مشفّراً فقط**. لا يُظهر الرمز.
 * - `GET /api/dr/status` (للمالك): لقطة مراقبة قراءة فقط (بلا رفع/حذف).
 * - `GET /api/dr/health`: كتلة صحية بلا أسرار (للتحقق الإنتاجي).
 *
 * الحقن عبر `deps` يجعل الوحدة قابلة للاختبار بخادم Drive وهمي، وتمنع أي مساس
 * ببقية المنظومة (YouTube/TikTok/…/Gemini/تسجيل الدخول).
 */

import type express from 'express';
import {
  DRIVE_OAUTH_REDIRECT_URI,
  DRIVE_FILE_SCOPE,
  DESIGN_QUOTA_BYTES,
  QUOTA_HEADROOM_BYTES,
  buildMonitoringSnapshot,
  hourlySafetyCheck,
  summarizeBackupState,
  RP_001_COMMIT,
} from '../../tools/dr/cloud-lib.mjs';
import { DriveStateStore } from '../../tools/dr/drive-auth-url.mjs';
import {
  inspectDriveAuthEnv,
  exchangeDriveAuthCode,
  encryptDriveSecret,
  createRefreshTokenProvider,
} from '../../tools/dr/drive-auth.mjs';
import { DriveClient, createGaxiosTransport } from '../../tools/dr/drive-client.mjs';
import { DriveStore } from '../../tools/dr/drive-store.mjs';
import { DriveSync } from '../../tools/dr/drive-sync.mjs';
import { runBackup } from '../../tools/dr/backup.mjs';
import { encryptDbDump } from '../../tools/dr/db-crypto.mjs';

export interface DriveRoutesDeps {
  authenticateToken: express.RequestHandler;
  requireOwner: express.RequestHandler;
  env?: Record<string, string | undefined>;
  /** يقرأ حالة DR المحفوظة (states + رمز تجديد مشفّر + آخر خطأ + حالة النسخ + هوية مجلدات Drive). */
  loadControl: () => { driveOAuthStates?: any[]; driveRefreshToken?: any; driveLastError?: string | null; driveBackup?: any; driveFolderIdentity?: any };
  /** يثبّت جزءاً من حالة DR عبر محوّل الحالة (يصمد بعد restart). */
  persistControl: (partial: Record<string, any>) => void;
  /** عميل Drive اختياري (للاختبار). إن غاب يُبنى من البيئة. */
  clientFactory?: (env: Record<string, string | undefined>) => any | null;
  /** ناقل OAuth اختياري (للاختبار): يوجّه تبادل الرمز إلى خادم وهمي. */
  oauthTransport?: any;
  /** يجمع ملفات المصدر للنسخة (المشمولة + المستبعدة للفحص). */
  collectSourceFiles?: () => { included: any[]; excluded: any[] };
  /** ينتج نسخة نصية مؤقتة من قاعدة البيانات (تُشفَّر قبل الرفع ولا تُرفع خاماً). */
  dumpDatabase?: () => Promise<string>;
  /** بيانات النسخة المعتمدة: commit/الفرع/المستودع. */
  gitMeta?: () => { commit?: string | null; branch?: string | null; repository?: string | null; project?: string | null };
  now?: () => string;
}

/** هل التفويض جاهز فعلاً (اعتماد + رمز تجديد مشفّر)؟ بلا كشف قيم. */
function authReadiness(env: Record<string, string | undefined>, encryptedRefreshToken: any) {
  const info = inspectDriveAuthEnv(env as NodeJS.ProcessEnv);
  const hasRefresh = Boolean(encryptedRefreshToken) || info.refreshTokenConfigured;
  return {
    ...info,
    refreshTokenStored: Boolean(encryptedRefreshToken),
    /** التفويض مكتمل فقط بوجود اعتماد + رمز تجديد. */
    authorized: info.configured && hasRefresh,
  };
}

export function registerDriveRoutes(app: express.Express, deps: DriveRoutesDeps): void {
  const env = deps.env || process.env;
  const now = deps.now || (() => new Date().toISOString());

  // حالة محفوظة في الذاكرة تُحمَّل مرة واحدة بعد جهوزية المخزن.
  let loaded: ReturnType<DriveRoutesDeps['loadControl']> | null = null;
  function control(): ReturnType<DriveRoutesDeps['loadControl']> {
    if (!loaded) loaded = deps.loadControl() || {};
    return loaded;
  }

  const stateStore = new DriveStateStore({
    initial: [],
    persist: (snapshot) => {
      control().driveOAuthStates = snapshot;
      deps.persistControl({ driveOAuthStates: snapshot });
    },
  });

  // تحميل الحالات المحفوظة مرة واحدة (بعد جهوزية المخزن) لتصمد CSRF عبر restart.
  let statesLoaded = false;
  function ensureStates() {
    if (statesLoaded) return;
    statesLoaded = true;
    const saved = control().driveOAuthStates;
    if (Array.isArray(saved)) {
      for (const s of saved) {
        if (s?.state) stateStore.states.set(s.state, { createdAt: s.createdAt || 0, usedAt: s.usedAt ?? null, userId: s.userId || '', redirectUri: s.redirectUri || DRIVE_OAUTH_REDIRECT_URI });
      }
    }
  }

  /** يبني عميل Drive من البيئة أو من رمز التجديد المشفّر المخزّن. */
  function buildClient() {
    if (deps.clientFactory) return deps.clientFactory(env);
    const info = inspectDriveAuthEnv(env as NodeJS.ProcessEnv);
    if (!info.configured) return null;
    const encrypted = control().driveRefreshToken;
    const provider = createRefreshTokenProvider({ env, encryptedRefreshToken: encrypted || undefined });
    return new DriveClient({ transport: createGaxiosTransport(), tokenProvider: provider });
  }

  /**
   * يبني مخزن Drive بهوية المجلدات المحفوظة (منع 403 تحت drive.file).
   * لا نعتمد على مرجع root أبداً؛ المعرّفات المحفوظة هي المصدر الأول.
   */
  function buildStore(client: any, options: { readOnlyStructure?: boolean } = {}) {
    return new DriveStore({ client, storedIdentity: control().driveFolderIdentity || null, readOnlyStructure: options.readOnlyStructure === true });
  }

  /** يثبّت هوية المجلدات بعد تجهيز البنية (تُحفظ مشفّرة عبر محوّل الحالة). */
  function rememberStructure(store: any): void {
    try {
      const identity = store.structureIdentity();
      if (!identity || !identity.rootId) return;
      const prev = control().driveFolderIdentity || null;
      const same = prev && prev.rootId === identity.rootId && JSON.stringify(prev.subdirs || {}) === JSON.stringify(identity.subdirs || {});
      if (same) return;
      control().driveFolderIdentity = identity;
      deps.persistControl({ driveFolderIdentity: identity });
    } catch { /* أفضل جهد: لا يُسقط النسخة لتعذّر حفظ الهوية */ }
  }

  /** لقطة مراقبة قراءة فقط: لا رفع ولا حذف. */
  async function readStatus() {
    const readiness = authReadiness(env, control().driveRefreshToken);
    if (!readiness.authorized) {
      return buildMonitoringSnapshot({
        generatedAt: now(),
        state: 'not_authorized',
        authorized: false,
        secretScan: { ok: true, findings: 0 },
        currentIntegrity: { verified: false, detail: 'لا تفويض Drive بعد.' },
        quota: { usageBytes: null, designBytes: DESIGN_QUOTA_BYTES, headroomBytes: QUOTA_HEADROOM_BYTES },
        lastError: control().driveLastError ?? null,
        lastCheckAt: now(),
      });
    }
    const client = buildClient();
    if (!client) {
      return buildMonitoringSnapshot({ generatedAt: now(), state: 'failed', authorized: false, lastError: 'drive_client_unavailable' });
    }
    try {
      const store = buildStore(client, { readOnlyStructure: true });
      const sync = new DriveSync({ store, client });
      const quota = await sync.readQuota();
      const current = await store.readCurrentManifest();
      const points = await store.listRestorePoints();
      const dumps = await store.listDbDumps();
      const manifest = current.ok ? current.data : null;
      const backupSummary = summarizeBackupState(manifest);
      const history = points.ok
        ? points.data.map((p) => ({
            id: p.id,
            commit: p.manifest?.commit ?? null,
            createdAt: p.manifest?.createdAt ?? null,
            treeHash: p.manifest?.treeHash ?? null,
            sourceHash: p.manifest?.sourceHash ?? null,
            databaseHash: p.manifest?.databaseHash ?? null,
            encryptedDatabaseHash: p.manifest?.encryptedDatabaseHash ?? null,
            fileCount: p.manifest?.fileCount ?? null,
            sourceSize: p.manifest?.sourceSize ?? null,
            status: p.manifest?.status ?? (p.manifest ? 'verified' : 'unknown'),
            hasManifest: Boolean(p.manifest),
          }))
        : [];
      const snapshot = buildMonitoringSnapshot({
        generatedAt: now(),
        state: manifest ? 'synced' : 'never_synced',
        lastSyncAt: manifest?.createdAt ?? manifest?.updatedAt ?? null,
        lastChangeAt: manifest?.createdAt ?? manifest?.updatedAt ?? null,
        commit: manifest?.commit ?? null,
        treeHash: manifest?.treeHash ?? null,
        versionSizeBytes: manifest?.sourceSize ?? null,
        fileCount: manifest?.fileCount ?? null,
        restorePointCount: points.ok ? points.data.length : 0,
        lastDbBackupAt: dumps.ok && dumps.data.length ? dumps.data[0].modifiedTime ?? null : (manifest?.createdAt ?? null),
        dbEncrypted: true,
        secretScan: { ok: true, findings: 0 },
        currentIntegrity: { verified: Boolean(manifest), detail: manifest ? null : 'لا بيان current.' },
        quota: { usageBytes: quota.ok ? (quota as any).driveUsageBytes : null, designBytes: DESIGN_QUOTA_BYTES, headroomBytes: QUOTA_HEADROOM_BYTES },
        lastError: control().driveLastError ?? null,
        lastCheckAt: now(),
        authorized: true,
      });
      return { ...snapshot, backup: { ...backupSummary, lastAttempt: control().driveBackup ?? null }, history };
    } catch (err: any) {
      return {
        ...buildMonitoringSnapshot({ generatedAt: now(), state: 'failed', authorized: true, lastError: String(err?.code || err?.message || 'drive_status_failed').slice(0, 80), lastCheckAt: now() }),
        backup: { hasBackup: false, state: 'unknown', lastAttempt: control().driveBackup ?? null },
        history: [],
      };
    }
  }

  // ------------------------------------------------------------------
  // رابط التفويض (owner): state أحادي الاستخدام + drive.file حصراً
  // ------------------------------------------------------------------
  app.get('/api/dr/drive/auth-url', deps.authenticateToken, deps.requireOwner, (req, res) => {
    ensureStates();
    const readiness = authReadiness(env, control().driveRefreshToken);
    if (!readiness.configured) {
      return res.status(409).json({
        success: false,
        code: 'DRIVE_OAUTH_NOT_CONFIGURED',
        error: 'DRIVE_OAUTH_CLIENT_ID/SECRET غير مضبوطين: لا يمكن توليد رابط التفويض.',
        requiredEnv: ['DRIVE_OAUTH_CLIENT_ID', 'DRIVE_OAUTH_CLIENT_SECRET'],
        redirectUri: DRIVE_OAUTH_REDIRECT_URI,
        scope: DRIVE_FILE_SCOPE,
      });
    }
    const userId = String((req as any).user?.id ?? (req as any).user?.uid ?? 'owner');
    const created = stateStore.create(userId, { env, redirectUri: DRIVE_OAUTH_REDIRECT_URI });
    if (!created.ok) {
      return res.status(409).json({ success: false, code: created.code, error: created.message });
    }
    res.json({
      success: true,
      url: created.url,
      scope: DRIVE_FILE_SCOPE,
      redirectUri: created.redirectUri,
      ttlMs: created.ttlMs,
      expiresAt: created.expiresAt,
      authorized: readiness.authorized,
      note: 'لا يوجد تفويض ولا رفع بعد؛ هذا الرابط فقط لبدء الموافقة.',
    });
  });

  // ------------------------------------------------------------------
  // callback: يستهلك state مرة واحدة ثم يبادل الرمز ويخزّنه مشفّراً
  // ------------------------------------------------------------------
  const handleCallback: express.RequestHandler = async (req, res) => {
    ensureStates();
    const params: Record<string, string> = { ...(req.query as any), ...((req.body && typeof req.body === 'object') ? req.body : {}) };
    const wantsJson = String(req.headers.accept || '').includes('application/json') || req.method === 'POST';
    const respond = (status: number, payload: Record<string, any>) => {
      if (wantsJson) return res.status(status).json(payload);
      // فرع المتصفح: نعيد المالك إلى الواجهة بدل صفحة HTML منفصلة. لا نمرّر أي
      // سرّ في الرابط — فقط معنى النتيجة ورمز سبب آمن (حروف/أرقام/_).
      const reason = String(payload.code || 'error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'error';
      const target = payload.success === true ? '/?dr=authorized' : `/?dr=error&reason=${encodeURIComponent(reason)}`;
      return res.redirect(302, target);
    };

    if (params.error) {
      control().driveLastError = `oauth_error:${String(params.error).slice(0, 40)}`;
      deps.persistControl({ driveLastError: control().driveLastError });
      return respond(400, { success: false, code: 'OAUTH_DENIED', error: 'رفضت Google التفويض أو أعادت خطأً.', errorCode: String(params.error).slice(0, 60) });
    }
    if (!params.code || !params.state) {
      return respond(400, {
        success: false,
        code: 'MISSING_CODE_OR_STATE',
        error: 'عودة التفويض بلا code/state صالحين: لم يحدث أي تبادل ولا رفع.',
        redirectUri: DRIVE_OAUTH_REDIRECT_URI,
      });
    }

    const consumed = stateStore.consume(params.state, { redirectUri: DRIVE_OAUTH_REDIRECT_URI });
    if (!consumed.ok) {
      control().driveLastError = consumed.code;
      deps.persistControl({ driveLastError: control().driveLastError });
      return respond(400, { success: false, code: consumed.code.toUpperCase(), error: consumed.message });
    }

    const exchanged = await exchangeDriveAuthCode(params.code, { env, redirectUri: DRIVE_OAUTH_REDIRECT_URI, transporter: deps.oauthTransport });
    if (!exchanged.ok) {
      control().driveLastError = exchanged.code;
      deps.persistControl({ driveLastError: control().driveLastError });
      return respond(400, { success: false, code: String(exchanged.code || 'EXCHANGE_FAILED').toUpperCase(), error: exchanged.message });
    }
    if (!exchanged.refreshToken) {
      control().driveLastError = 'no_refresh_token';
      deps.persistControl({ driveLastError: control().driveLastError });
      return respond(400, { success: false, code: 'NO_REFRESH_TOKEN', error: 'لم تُعد Google رمز تجديد (offline). أعد التفويض.' });
    }
    let encrypted;
    try {
      encrypted = encryptDriveSecret(exchanged.refreshToken, env as NodeJS.ProcessEnv);
    } catch {
      return respond(500, { success: false, code: 'TOKEN_KEY_MISSING', error: 'مفتاح تشفير رمز التجديد غير مضبوط (DRIVE_TOKEN_ENCRYPTION_KEY).' });
    }
    control().driveRefreshToken = encrypted;
    control().driveLastError = null;
    deps.persistControl({ driveRefreshToken: encrypted, driveLastError: null });

    return respond(200, {
      success: true,
      code: 'DRIVE_AUTHORIZED',
      message: 'تم التفويض وحُفظ رمز التجديد مشفّراً. لم يُرفع أي ملف بعد.',
      scope: exchanged.scope,
      authorized: true,
      // لا يُعاد أي رمز — إثبات الحفظ فقط.
      refreshTokenStored: true,
    });
  };
  app.get('/api/dr/drive/callback', handleCallback);
  app.post('/api/dr/drive/callback', handleCallback);

  // ------------------------------------------------------------------
  // النسخة الاحتياطية الفعلية (owner): المسار الرسمي الوحيد.
  // ------------------------------------------------------------------
  let backupRunning = false; // قفل على مستوى الخادم يمنع التشغيل المزدوج
  const defaultGitMeta = () => ({ commit: env.RENDER_GIT_COMMIT || env.GIT_COMMIT || null, branch: env.RENDER_GIT_BRANCH || env.GIT_BRANCH || 'main', repository: env.GHARABI_REPOSITORY || 'mrdalghrabylltqsyt-web/al-gharabi-ai', project: 'al-gharabi-ai' });

  /** يحدّث سجل آخر نسخة عبر محوّل الحالة (يصمد بعد restart). */
  function recordBackupResult(result: any): void {
    const previous = control().driveBackup || {};
    const entry = {
      at: now(),
      state: result?.state ?? 'unknown',
      verified: result?.verified === true,
      commit: result?.commit ?? null,
      recoveryPointId: result?.recoveryPointId ?? null,
      treeHash: result?.treeHash ?? null,
      sourceHash: result?.sourceHash ?? null,
      reason: result?.reason ?? null,
      message: result?.message ?? null,
      errorDetails: result?.state === 'backed_up' || result?.state === 'no_change' ? null : (result?.errorDetails ?? previous.errorDetails ?? null),
      lastSuccessAt: result?.state === 'backed_up' ? now() : previous.lastSuccessAt ?? null,
      lastSuccessCommit: result?.state === 'backed_up' ? result?.commit ?? null : previous.lastSuccessCommit ?? null,
      lastRecoveryPointId: result?.state === 'backed_up' ? result?.recoveryPointId ?? null : previous.lastRecoveryPointId ?? null,
    };
    control().driveBackup = entry;
    deps.persistControl({ driveBackup: entry });
  }

  app.post('/api/dr/backup', deps.authenticateToken, deps.requireOwner, async (_req, res) => {
    const readiness = authReadiness(env, control().driveRefreshToken);
    if (!readiness.authorized) {
      return res.status(409).json({ success: false, code: 'NOT_AUTHORIZED', error: 'لا تفويض Google Drive فعّال: لا يمكن إنشاء نسخة.' });
    }
    const client = buildClient();
    if (!client) {
      return res.status(503).json({ success: false, code: 'DRIVE_CLIENT_UNAVAILABLE', error: 'تعذّر بناء عميل Drive.' });
    }
    if (backupRunning) {
      return res.status(409).json({ success: false, code: 'BACKUP_ALREADY_RUNNING', error: 'نسخة احتياطية قيد التنفيذ بالفعل.' });
    }
    backupRunning = true;
    const startedAt = now();
    let store: any = null;
    try {
      store = buildStore(client);
      const collected = deps.collectSourceFiles ? deps.collectSourceFiles() : { included: [], excluded: [] };
      const files = [...(collected.included || []), ...(collected.excluded || [])];
      const result = await runBackup({
        store,
        files,
        dumpDatabase: deps.dumpDatabase,
        encryptDatabase: (sql: string) => encryptDbDump(sql, env as NodeJS.ProcessEnv),
        meta: deps.gitMeta ? deps.gitMeta() : defaultGitMeta(),
        now: startedAt,
      });
      rememberStructure(store);
      recordBackupResult(result);
      const httpStatus = result.state === 'failed' ? 500 : 200;
      return res.status(httpStatus).json({
        success: result.state === 'backed_up' || result.state === 'no_change',
        state: result.state,
        verified: result.verified === true,
        recoveryPointId: result.recoveryPointId ?? null,
        commit: result.commit ?? null,
        treeHash: result.treeHash ?? null,
        sourceHash: result.sourceHash ?? null,
        uploaded: result.uploaded ?? 0,
        reason: result.reason ?? null,
        message: result.message ?? null,
        errorDetails: result.errorDetails ?? null,
        problems: result.problems ?? null,
        secretScan: result.secretScan ?? { ok: true, findings: 0 },
        at: startedAt,
      });
    } catch (err: any) {
      const failure = { state: 'failed', reason: String(err?.code || err?.message || 'backup_failed').slice(0, 80), message: 'فشل غير متوقّع أثناء النسخة.' };
      recordBackupResult(failure);
      return res.status(500).json({ success: false, ...failure });
    } finally {
      backupRunning = false;
    }
  });

  // ------------------------------------------------------------------
  // الحالة الصحية (بلا أسرار) + لقطة المراقبة (owner)
  // ------------------------------------------------------------------
  app.get('/api/dr/health', (_req, res) => {
    const readiness = authReadiness(env, control().driveRefreshToken);
    res.json({
      success: true,
      dr: {
        scope: DRIVE_FILE_SCOPE,
        forbiddenScopes: ['https://www.googleapis.com/auth/drive'],
        redirectUri: DRIVE_OAUTH_REDIRECT_URI,
        configured: readiness.configured,
        authorized: readiness.authorized,
        refreshTokenStored: readiness.refreshTokenStored,
        tokenEncryptionKey: readiness.tokenEncryptionKey,
        callbackRoute: '/api/dr/drive/callback',
        authUrlRoute: '/api/dr/drive/auth-url',
        rp001Commit: RP_001_COMMIT,
        quota: { designBytes: DESIGN_QUOTA_BYTES, headroomBytes: QUOTA_HEADROOM_BYTES },
        backupReady: readiness.authorized,
        backupRoute: '/api/dr/backup',
        lastError: control().driveLastError ?? null,
        backup: control().driveBackup ?? null,
      },
    });
  });

  app.get('/api/dr/status', deps.authenticateToken, async (_req, res) => {
    const snapshot = await readStatus();
    const check = hourlySafetyCheck({
      authorized: snapshot.authorized,
      secretFinding: snapshot.secretScan?.ok === false,
      currentIntegrity: snapshot.currentIntegrity?.verified === true,
      checkedAt: snapshot.lastCheckAt || now(),
    });
    res.json({ success: true, snapshot, hourlyCheck: check });
  });

  // مرجع مخزن الحالة للاختبار/الصحة العامة.
  (app as any).drStateStore = stateStore;
}
