/**
 * Digital Sales — مخزن الموافقة/الإلغاء وسجل المتابعة (منطق خالص).
 *
 * الغرض: حفظ حالة الموافقة (consent/opt-out) وسجل المتابعات **بمفاتيح بصمة
 * آمنة الخصوصية فقط** (لا هاتف/معرّف خام). يُستخدم لاحترام الإلغاء ومنع التكرار
 * والسبام، ويصمد بعد إعادة التشغيل عبر محوّل الحالة.
 *
 * منطق خالص: لا شبكة ولا أسرار.
 */

import { applyConsentUpdate, isDuplicateFollowUp, type ConsentState } from './followup';

/** حالة العميل المحفوظة: مفاتيح بصمة فقط (بلا بيانات شخصية). */
export interface StoredCustomerConsent {
  /** بصمة العميل الآمنة (privacyCustomerHash). */
  hash: string;
  consent: boolean;
  optedOut: boolean;
  updatedAt: string;
}

export interface StoredFollowUp {
  hash: string;
  productId: string | null;
  at: string;
}

export interface DigitalSalesStore {
  consents: StoredCustomerConsent[];
  followUps: StoredFollowUp[];
}

export const EMPTY_DIGITAL_SALES_STORE: DigitalSalesStore = Object.freeze({ consents: [], followUps: [] });

const MAX_CONSENTS = 5000;
const MAX_FOLLOW_UPS = 5000;

/** يطبّع مخزناً مقروءاً من الحالة — يتجاهل أي صف بلا بصمة أو بمفتاح خام. */
export function normalizeDigitalSalesStore(raw: any): DigitalSalesStore {
  const consents: StoredCustomerConsent[] = Array.isArray(raw?.consents)
    ? raw.consents
        .filter((c: any) => c && typeof c.hash === 'string' && c.hash.startsWith('k_'))
        .slice(-MAX_CONSENTS)
        .map((c: any) => ({ hash: c.hash, consent: Boolean(c.consent), optedOut: Boolean(c.optedOut), updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : new Date(0).toISOString() }))
    : [];
  const followUps: StoredFollowUp[] = Array.isArray(raw?.followUps)
    ? raw.followUps
        .filter((f: any) => f && typeof f.hash === 'string' && f.hash.startsWith('k_'))
        .slice(-MAX_FOLLOW_UPS)
        .map((f: any) => ({ hash: f.hash, productId: typeof f.productId === 'string' ? f.productId : null, at: typeof f.at === 'string' ? f.at : new Date(0).toISOString() }))
    : [];
  return { consents, followUps };
}

/** يقرأ حالة موافقة ببصمة العميل. */
export function getConsentByHash(store: DigitalSalesStore, hash: string | null): StoredCustomerConsent | null {
  if (!hash) return null;
  return store.consents.find((c) => c.hash === hash) || null;
}

/** يحدّث حالة الموافقة/الإلغاء لبصمة عميل (الإلغاء يُقدَّم دائماً). */
export function updateConsentByHash(store: DigitalSalesStore, hash: string, update: { consent?: boolean; optedOut?: boolean; nowMs: number }): DigitalSalesStore {
  const current: ConsentState = (() => {
    const existing = store.consents.find((c) => c.hash === hash);
    return { customerKey: hash, consent: existing?.consent ?? false, optedOut: existing?.optedOut ?? false, updatedAt: existing?.updatedAt ?? new Date(0).toISOString() };
  })();
  const next = applyConsentUpdate(current, update);
  const consents = store.consents.filter((c) => c.hash !== hash);
  consents.push({ hash, consent: next.consent, optedOut: next.optedOut, updatedAt: next.updatedAt });
  return { ...store, consents: consents.slice(-MAX_CONSENTS) };
}

/** يسجّل متابعة منفّذة (ببصمة) لمنع التكرار لاحقاً. */
export function recordFollowUp(store: DigitalSalesStore, entry: StoredFollowUp): DigitalSalesStore {
  return { ...store, followUps: [...store.followUps, entry].slice(-MAX_FOLLOW_UPS) };
}

/** يحوّل سجل المتابعة إلى الصيغة التي يفهمها محرّك المتابعة (بمفاتيح البصمة). */
export function followUpLogFor(store: DigitalSalesStore, hash: string | null): Array<{ customerKey: string; productId: string | null; at: string }> {
  if (!hash) return [];
  return store.followUps.filter((f) => f.hash === hash).map((f) => ({ customerKey: hash, productId: f.productId, at: f.at }));
}

/** يمنع تكرار متابعة مطابقة لنفس العميل/المنتج خلال النافذة. */
export function guardDuplicateFollowUp(store: DigitalSalesStore, input: { hash: string | null; productId: string | null; nowMs: number; windowDays?: number }): { duplicate: boolean; reason: string } {
  if (!input.hash) return { duplicate: false, reason: 'لا بصمة عميل — لا منع تكرار.' };
  return isDuplicateFollowUp({
    customerKey: input.hash,
    productId: input.productId,
    recent: store.followUps.map((f) => ({ customerKey: f.hash, productId: f.productId, at: f.at })),
    nowMs: input.nowMs,
    windowDays: input.windowDays,
  });
}
