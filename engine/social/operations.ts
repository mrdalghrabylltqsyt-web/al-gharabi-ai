/**
 * Social Operations Control Plane — طبقة موحّدة تحكم كل عملية اجتماعية.
 *
 * القاعدة المركزية: لا تُنفَّذ أي عملية خارجية قبل المرور بالبوابات بالترتيب:
 *   Capability → Connection → Verification → Safety/Approval → Provider Operation
 *
 * وتُفصل الحالات بدقة فلا تختلط:
 *   CODE_READY (منفّذ في الكود) ≠ CONFIGURED (بيانات الاعتماد حاضرة)
 *   ≠ CONNECTED (اتصال قائم) ≠ VERIFIED (أثبته المزود) ≠ OPERATIONAL (تشغيل حقيقي مثبت).
 *
 * هذا الملف منطق خالص بلا شبكة، فيُختبر بلا أي مزود حقيقي.
 */

import type { PlatformId, PlatformCapability } from './adapter';
import { PLATFORM_SPECS, platformSupports } from './registry';
import { readinessFor, type ReadinessLevel, type OperationalLevel, type PlatformReadinessDetail } from './readiness';
import { inspectPlatformCredentials } from './credentials';
import { TOKEN_KEY_ENV_NAME } from './tokenKey';

/** حالات المنصة الدقيقة — لا يُخلط بينها في أي عرض أو قرار. */
export type PlatformState =
  | 'CODE_READY'
  | 'EXTERNAL_SETUP_REQUIRED'
  | 'CONFIGURED'
  | 'CONNECTED'
  | 'VERIFIED'
  | 'OPERATIONAL'
  | 'NOT_SUPPORTED'
  | 'FAILED'
  | 'DISCONNECTED';

/** أكواد منع العمليات — صريحة بلا فشل صامت. */
export type OperationBlockCode =
  | 'CAPABILITY_NOT_SUPPORTED'
  | 'EXTERNAL_SETUP_REQUIRED'
  | 'NOT_CONNECTED'
  | 'NOT_VERIFIED'
  | 'CONNECTOR_NOT_IMPLEMENTED'
  | 'APPROVAL_REQUIRED'
  | 'SAFETY_BLOCKED'
  | 'CONNECTOR_NOT_READY';

export type OperationId = 'connect' | 'verify' | 'receive' | 'classify' | 'reply' | 'publish' | 'schedule' | 'metrics';

export interface OperationGate {
  operation: OperationId;
  /** هل المنصة تدعم هذه العملية عبر واجهتها الرسمية أصلاً؟ */
  supported: boolean;
  /** هل يمكن تنفيذها الآن فعلياً بحالة الاتصال الحالية؟ */
  allowed: boolean;
  code?: OperationBlockCode;
  reason?: string;
}

/** حالة الاتصال الحية كما يحفظها الخادم (تُحقن، لا تُختلق). */
export interface LiveConnection {
  status?: 'connected' | 'reauth_needed' | 'disconnected';
  providerVerified?: boolean;
  accountName?: string | null;
}

export interface PlatformControlStatus {
  platform: PlatformId;
  displayName: string;
  /** الحالة الجامعة الدقيقة. */
  state: PlatformState;
  connector: ReadinessLevel;
  capabilities: string[];
  credentialsConfigured: boolean;
  connectionConfigured: boolean;
  providerVerified: boolean;
  liveConnection: 'connected' | 'reauth_needed' | 'disconnected';
  /** سبب الحجب الرئيسي (إن وُجد) — بلا أسرار. */
  blockingReason: string | null;
  /** الإجراء التالي المحدد للمالك. */
  nextAction: string;
  /** بوابات العمليات الثماني. */
  operations: OperationGate[];
}

/** خريطة العملية → قدرة السجل التي تقابلها. */
const OPERATION_CAPABILITY: Record<OperationId, PlatformCapability | null> = {
  connect: null, // الاتصال يعتمد على اعتماد المنصة لا على قدرة تشغيلية
  verify: null,
  receive: null,
  classify: null, // التصنيف حتمي محلي ولا يحتاج اتصالاً
  reply: 'messages', // يُتحقق خاصة أدناه (رد على تعليق أو رسالة)
  publish: 'publish',
  schedule: 'scheduling',
  metrics: 'analytics',
};

/** هل تدعم المنصة «قراءة الأحداث الواردة» (تعليقات أو رسائل)؟ */
function supportsReceive(platform: PlatformId): boolean {
  return platformSupports(platform, 'comments') || platformSupports(platform, 'messages');
}

/** هل تدعم المنصة «الرد» (على تعليق أو رسالة)؟ */
function supportsReply(platform: PlatformId): boolean {
  return platformSupports(platform, 'comment_reply') || platformSupports(platform, 'messages');
}

/**
 * يبني رسالة الحجب والإجراء التالي لاعتماد ناقص، ويميّز صراحةً بين مفتاح
 * التشفير الغائب ومفتاحه المضبوط بلا صيغة صالحة، فيعرف المالك أنه ليس «ناقصاً»
 * بل «مضبوط لكن غير صالح». بلا كشف أي قيمة.
 */
function describeCredentialGap(missing: string[], invalid: string[]): { blocking: string; nextAction: string } {
  const base = `بيانات الاعتماد ناقصة: ${missing.join(', ')}`;
  const next = `ضبط متغيرات البيئة التالية: ${missing.join(', ')}`;
  const tokenInvalid = invalid.includes(TOKEN_KEY_ENV_NAME);
  if (tokenInvalid) {
    return {
      blocking: `${base} — و${TOKEN_KEY_ENV_NAME} مضبوط لكن قيمته غير صالحة: لا تمثّل 32 بايت.`,
      nextAction: `استبدل قيمة ${TOKEN_KEY_ENV_NAME} بقيمة صالحة (32 بايت hex أو Base64)، ثم أعد المحاولة.`,
    };
  }
  if (missing.includes(TOKEN_KEY_ENV_NAME)) {
    return { blocking: `${base} — و${TOKEN_KEY_ENV_NAME} غير مضبوط أصلاً.`, nextAction: next };
  }
  return { blocking: base, nextAction: next };
}

/**
 * يحسب الحالة الدقيقة للمنصة من:
 * - الجاهزية الثابتة (الكود/القدرات/المتطلبات الخارجية).
 * - توفّر بيانات الاعتماد (بلا قيم).
 * - حالة الاتصال الحية المحقونة.
 * ثم يبني بوابات العمليات. لا يدّعي تشغيلاً غير مثبت.
 */
export function computePlatformStatus(
  platform: PlatformId,
  live: LiveConnection = {},
  env: Record<string, string | undefined> = process.env,
): PlatformControlStatus | null {
  const readiness = readinessFor(platform);
  if (!readiness) return null;
  const creds = inspectPlatformCredentials(platform, env);
  const connectionConfigured = creds.connection.configured;
  const connectorImplemented = readiness.connector === 'READY';
  const connected = live.status === 'connected';
  const verified = connected && live.providerVerified === true;

  // الحالة الجامعة: أدقّ حالة تصف الواقع الآن.
  let state: PlatformState;
  if (!connectorImplemented && readiness.connector === 'NOT_SUPPORTED') state = 'NOT_SUPPORTED';
  else if (!connectorImplemented) state = connectionConfigured ? 'EXTERNAL_SETUP_REQUIRED' : 'EXTERNAL_SETUP_REQUIRED';
  else if (!connectionConfigured) state = 'CODE_READY';
  else if (live.status === 'reauth_needed') state = 'FAILED';
  else if (!connected) state = connectionConfigured ? 'CONFIGURED' : 'DISCONNECTED';
  else if (!verified) state = 'CONNECTED';
  else state = 'OPERATIONAL'; // اتصال موثق + موصل منفّذ => تشغيل حقيقي متاح

  // سبب الحجب الرئيسي (أعلى أولوية أولاً).
  let blockingReason: string | null = null;
  const credentialReason = describeCredentialGap(creds.connection.missing, creds.connection.invalid);
  if (!connectorImplemented) blockingReason = 'لا يوجد موصل تنفيذ منفّذ لهذه المنصة؛ يلزم إتمام تكاملها.';
  else if (!connectionConfigured) blockingReason = credentialReason.blocking;
  else if (live.status === 'reauth_needed') blockingReason = 'فشل التحقق من الحساب لدى المزود؛ يلزم إعادة الربط.';
  else if (!connected) blockingReason = 'المنصة غير متصلة؛ لم يُنفَّذ ربط موثق بعد.';

  const nextAction = !connectorImplemented
    ? 'إكمال إعداد المزود الخارجي (تطبيق/مراجعة/صلاحيات) قبل تنفيذ موصل الإرسال.'
    : !connectionConfigured
      ? credentialReason.nextAction
      : live.status === 'reauth_needed'
        ? 'إعادة الربط: رمز الحساب لم يعد صالحاً لدى المزود.'
        : !connected
          ? (readiness.oauth === 'EXTERNAL_SETUP_REQUIRED' ? 'بدء ربط OAuth من مركز ربط المنصات.' : 'تنفيذ ضبط الاتصال (رمز/توثيق) من مركز ربط المنصات.')
          : 'لا إجراء مطلوب؛ الحساب متصل وموثق.';

  const operations = buildOperationGates(platform, { connectorImplemented, connectionConfigured, connected, verified, live });

  return {
    platform,
    displayName: readiness.displayName,
    state,
    connector: readiness.connector,
    capabilities: [...(PLATFORM_SPECS.find((s) => s.platform === platform)?.capabilities || [])],
    credentialsConfigured: creds.connection.configured && creds.webhook.configured,
    connectionConfigured,
    providerVerified: verified,
    liveConnection: live.status || 'disconnected',
    blockingReason,
    nextAction,
    operations,
  };
}

/** بوابة عملية واحدة وفق الترتيب الملزم. */
function gate(
  operation: OperationId,
  supported: boolean,
  extra: { blocked?: boolean; code?: OperationBlockCode; reason?: string },
): OperationGate {
  if (!supported) return { operation, supported: false, allowed: false, code: 'CAPABILITY_NOT_SUPPORTED', reason: 'المنصة لا تدعم هذه العملية عبر واجهتها الرسمية.' };
  if (extra.blocked) return { operation, supported: true, allowed: false, code: extra.code, reason: extra.reason };
  return { operation, supported: true, allowed: true };
}

/**
 * يبني بوابات العمليات الثماني وفق الترتيب:
 * Capability → Connection → Verification → (Safety/Approval تُفحص في المسار الفعلي).
 * التصنيف حتمي محلي فلا يحتاج اتصالاً؛ بوابة الاتصال/التحقق تحكم العمليات الخارجية فقط.
 */
function buildOperationGates(
  platform: PlatformId,
  ctx: { connectorImplemented: boolean; connectionConfigured: boolean; connected: boolean; verified: boolean; live: LiveConnection },
): OperationGate[] {
  const externalBlocked = !ctx.connectorImplemented
    ? { code: 'CONNECTOR_NOT_IMPLEMENTED' as OperationBlockCode, reason: 'لا موصل تنفيذ منفّذ لهذه المنصة.' }
    : !ctx.connectionConfigured
      ? { code: 'EXTERNAL_SETUP_REQUIRED' as OperationBlockCode, reason: 'بيانات اعتماد المزود غير مضبوطة.' }
      : !ctx.connected
        ? { code: 'NOT_CONNECTED' as OperationBlockCode, reason: 'المنصة غير متصلة باتصال قائم.' }
        : !ctx.verified
          ? { code: 'NOT_VERIFIED' as OperationBlockCode, reason: 'الاتصال غير موثق من المزود.' }
          : null;

  const canExternal = !externalBlocked;

  return [
    // الاتصال: يلزم موصل منفّذ + اعتماد مضبوط.
    gate('connect', true, {
      blocked: !ctx.connectorImplemented || !ctx.connectionConfigured,
      code: !ctx.connectorImplemented ? 'CONNECTOR_NOT_IMPLEMENTED' : 'EXTERNAL_SETUP_REQUIRED',
      reason: !ctx.connectorImplemented ? 'لا موصل اتصال منفّذ لهذه المنصة.' : 'بيانات اعتماد المزود غير مضبوطة.',
    }),
    // التحقق: يلزم اتصال قائم ليثبته المزود.
    gate('verify', true, {
      blocked: !canExternal,
      code: externalBlocked?.code,
      reason: externalBlocked?.reason,
    }),
    // الاستقبال: يلزم دعم قراءة + اتصال موثق.
    gate('receive', supportsReceive(platform), {
      blocked: !canExternal,
      code: externalBlocked?.code,
      reason: externalBlocked?.reason,
    }),
    // التصنيف: حتمي محلي — متاح دائماً (لا يحتاج اتصالاً ولا حصة).
    gate('classify', true, {}),
    // الرد: يلزم دعم الرد + اتصال موثق.
    gate('reply', supportsReply(platform), {
      blocked: !canExternal,
      code: externalBlocked?.code,
      reason: externalBlocked?.reason,
    }),
    // النشر: يلزم قدرة النشر + اتصال موثق.
    gate('publish', platformSupports(platform, 'publish'), {
      blocked: !canExternal,
      code: externalBlocked?.code,
      reason: externalBlocked?.reason,
    }),
    // الجدولة: منطق نظام — يلزم قدرة الجدولة؛ التنفيذ الفعلي عند الموعد يخضع لبوابة الاتصال.
    gate('schedule', platformSupports(platform, 'scheduling'), {}),
    // المؤشرات: يلزم قدرة التحليلات + اتصال موثق للجلب الخارجي.
    gate('metrics', platformSupports(platform, 'analytics'), {
      blocked: !canExternal,
      code: externalBlocked?.code,
      reason: externalBlocked?.reason,
    }),
  ];
}

/** يبني حالات كل المنصات العشر — مصدر مركز ربط المنصات. */
export function computeAllPlatformStatuses(
  liveFor: (platform: PlatformId) => LiveConnection,
  env: Record<string, string | undefined> = process.env,
): PlatformControlStatus[] {
  const ids: PlatformId[] = ['tiktok', 'youtube', 'facebook', 'instagram', 'whatsapp', 'telegram', 'x', 'snapchat', 'threads', 'google_business'];
  return ids.map((id) => computePlatformStatus(id, liveFor(id), env)).filter((x): x is PlatformControlStatus => Boolean(x));
}

/** ملخص حالات المنصات — بلا أي ادعاء تشغيل. */
export function controlSummary(statuses: PlatformControlStatus[]) {
  const count = (s: PlatformState) => statuses.filter((x) => x.state === s).length;
  return {
    total: statuses.length,
    codeReady: count('CODE_READY'),
    externalSetupRequired: count('EXTERNAL_SETUP_REQUIRED'),
    configured: count('CONFIGURED'),
    connected: count('CONNECTED'),
    verified: count('VERIFIED'),
    operational: count('OPERATIONAL'),
    notSupported: count('NOT_SUPPORTED'),
    failed: count('FAILED'),
    disconnected: count('DISCONNECTED'),
  };
}

/**
 * يبني صفوف مصفوفة الجاهزية الغنية للمالك: يدمج الجاهزية الثابتة + حالة الاعتماد
 * (بلا قيم) + حالة الاتصال الحية + الحجب والإجراء التالي. هذا هو مصدر «مركز ربط
 * المنصات» في الواجهة، ولا يحمل أي سرّ.
 */
export function buildReadinessDetails(
  liveFor: (platform: PlatformId) => LiveConnection,
  env: Record<string, string | undefined> = process.env,
): PlatformReadinessDetail[] {
  const ids: PlatformId[] = ['tiktok', 'youtube', 'facebook', 'instagram', 'whatsapp', 'telegram', 'x', 'snapchat', 'threads', 'google_business'];
  const out: PlatformReadinessDetail[] = [];
  for (const id of ids) {
    const base = readinessFor(id);
    const live = liveFor(id);
    const status = computePlatformStatus(id, live, env);
    if (!base || !status) continue;
    const creds = inspectPlatformCredentials(id, env);
    // مستويات العمليات الآن: مدعومة + موثق => READY، مدعومة بلا توثيق => BLOCKED،
    // غير مدعومة => NOT_SUPPORTED. لا تُخلط مع مستويات الكود الثابتة.
    const opLevel = (lvl: ReadinessLevel): OperationalLevel => (lvl === 'NOT_SUPPORTED' ? 'NOT_SUPPORTED' : status.providerVerified ? 'READY' : 'BLOCKED');
    out.push({
      ...base,
      credentials: { configured: creds.connection.configured, missing: creds.connection.missing, invalid: creds.connection.invalid },
      webhookCredentials: { configured: creds.webhook.configured, missing: creds.webhook.missing, invalid: creds.webhook.invalid },
      operationalState: status.state,
      connected: status.liveConnection === 'connected',
      providerVerified: status.providerVerified,
      operational: {
        connection: opLevel(base.connection),
        verification: opLevel(base.verification),
        webhook: opLevel(base.webhook),
        read: opLevel(base.read),
        reply: opLevel(base.reply),
        publish: opLevel(base.publish),
        schedule: opLevel(base.schedule),
        analytics: opLevel(base.analytics),
      },
      blockingReason: status.blockingReason,
      nextAction: status.nextAction,
    });
  }
  return out;
}
