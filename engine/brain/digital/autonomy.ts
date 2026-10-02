/**
 * Digital Sales — مستويات الاستقلالية والموافقة (منطق خالص).
 *
 * الغرض: فرض حدود صريحة على كل فعل تجاري. الافتراضي آمن دائماً: لا فعل تجاري
 * خارجي بلا اعتماد مطابق. ولا يجوز للنظام أن ينفّذ صامتاً نشراً/مراسلة/تغيير سعر/
 * خصماً/التزاماً/تعديل أمان.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

export type AutonomyLevel = 'OBSERVE' | 'RECOMMEND' | 'PREPARE' | 'OWNER_APPROVAL' | 'EXECUTE';

export const AUTONOMY_LEVEL_ORDER: readonly AutonomyLevel[] = Object.freeze([
  'OBSERVE', 'RECOMMEND', 'PREPARE', 'OWNER_APPROVAL', 'EXECUTE',
]);

export const AUTONOMY_LEVEL_LABELS_AR: Record<AutonomyLevel, string> = Object.freeze({
  OBSERVE: 'مراقبة',
  RECOMMEND: 'توصية',
  PREPARE: 'تحضير',
  OWNER_APPROVAL: 'موافقة المالك',
  EXECUTE: 'تنفيذ',
});

/** الفعل التجاري ومستوى الاعتماد المطلوب له. */
export type CommercialAction =
  | 'observe'
  | 'recommend'
  | 'prepare_follow_up'
  | 'prepare_message'
  | 'send_message'
  | 'publish_content'
  | 'change_price'
  | 'approve_discount'
  | 'commercial_commitment'
  | 'modify_security'
  | 'modify_auth'
  | 'modify_encryption'
  | 'modify_recovery';

/** أدنى مستوى اعتماد مطلوب لكل فعل. الأفعال الحسّاسة تحتاج OWNER_APPROVAL+. */
export const ACTION_REQUIRED_LEVEL: Readonly<Record<CommercialAction, AutonomyLevel>> = Object.freeze({
  observe: 'OBSERVE',
  recommend: 'RECOMMEND',
  prepare_follow_up: 'PREPARE',
  prepare_message: 'PREPARE',
  send_message: 'OWNER_APPROVAL',
  publish_content: 'OWNER_APPROVAL',
  change_price: 'OWNER_APPROVAL',
  approve_discount: 'OWNER_APPROVAL',
  commercial_commitment: 'OWNER_APPROVAL',
  modify_security: 'OWNER_APPROVAL',
  modify_auth: 'OWNER_APPROVAL',
  modify_encryption: 'OWNER_APPROVAL',
  modify_recovery: 'OWNER_APPROVAL',
});

/** الأفعال التي لا يجوز تنفيذها صامتاً إطلاقاً (حتى مع التنفيذ، تحتاج موافقة صريحة). */
export const NEVER_SILENT_ACTIONS: readonly CommercialAction[] = Object.freeze([
  'publish_content', 'send_message', 'change_price', 'approve_discount',
  'commercial_commitment', 'modify_security', 'modify_auth', 'modify_encryption', 'modify_recovery',
]);

export interface AutonomyDecision {
  action: CommercialAction;
  requiredLevel: AutonomyLevel;
  grantedLevel: AutonomyLevel;
  allowed: boolean;
  /** هل يحتاج موافقة صريحة الآن؟ */
  requiresOwnerApproval: boolean;
  /** هل يجوز أن يقع صامتاً؟ (لا للأفعال الحسّاسة). */
  silentAllowed: boolean;
  reason: string;
}

const levelIndex = (l: AutonomyLevel) => AUTONOMY_LEVEL_ORDER.indexOf(l);

/**
 * يقرّر هل الفعل مسموح بمستوى الاعتماد الممنوح. **الافتراضي آمن**: المستوى
 * الممنوح الافتراضي هو OBSERVE.
 */
export function evaluateAutonomy(input: {
  action: CommercialAction;
  grantedLevel?: AutonomyLevel;
}): AutonomyDecision {
  const granted = input.grantedLevel || 'OBSERVE';
  const required = ACTION_REQUIRED_LEVEL[input.action];
  const allowed = levelIndex(granted) >= levelIndex(required);
  const sensitive = NEVER_SILENT_ACTIONS.includes(input.action);
  return {
    action: input.action,
    requiredLevel: required,
    grantedLevel: granted,
    allowed,
    requiresOwnerApproval: sensitive ? true : required === 'OWNER_APPROVAL' || required === 'EXECUTE',
    silentAllowed: sensitive ? false : required === 'OBSERVE' || required === 'RECOMMEND',
    reason: allowed
      ? `المستوى الممنوح (${granted}) يغطّي المطلوب (${required}).`
      : `المستوى الممنوح (${granted}) أقل من المطلوب (${required}) — لا تنفيذ.`,
  };
}

/** الوضع الافتراضي الآمن للنظام: مراقبة فقط. */
export function defaultGrantedLevel(): AutonomyLevel {
  return 'OBSERVE';
}
