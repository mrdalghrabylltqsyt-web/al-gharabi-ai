/**
 * Strategic State — حالة استراتيجية واحدة يملكها العقل المركزي (منطق خالص).
 *
 * **ليست عقلاً استراتيجياً ثانياً**: هذه حالة/سجل يملكه العقل المركزي (`central-brain-1`)
 * ويقرأها أثناء الاستدلال. تُحفظ عبر محوّل الحالة القائم (مفتاح `centralBrainStrategy`)
 * فتصمد بعد restart/cold start. لا حوكمة ثانية ولا مخزن ثانٍ.
 *
 * تدعم: الاستراتيجية الحالية، رقم الإصدار، الإصدارات السابقة (تاريخ)، سبب التغيير،
 * الدليل/المصدر، الطابع الزمني، والثقة. **لا اختراع**: تُسجَّل نسخة جديدة فقط عند
 * تغيّر لقطة الاستراتيجية فعلياً؛ وإلا فهي `no_change`.
 *
 * منطق خالص: لا شبكة ولا أسرار ولا ساعة حقيقية إلا عبر حقن `now`.
 */

import { CENTRAL_BRAIN_ID } from './consolidation';

/** الحد الأقصى للإصدارات المحفوظة في التاريخ (بلا حذف صامت: الأقدم يُطوى صراحةً). */
export const STRATEGY_HISTORY_MAX = 20;

export type StrategyChangeReason =
  | 'initial'
  | 'strategy_changed'
  | 'evidence_update'
  | 'no_change';

export const STRATEGY_CHANGE_REASON_LABELS_AR: Readonly<Record<StrategyChangeReason, string>> = Object.freeze({
  initial: 'الاستراتيجية الأولية',
  strategy_changed: 'تغيّر مكوّنات الاستراتيجية',
  evidence_update: 'تحديث الدليل/المصدر',
  no_change: 'لا تغيير',
});

/** لقطة استراتيجية واحدة (مُطبَّعة من خطط الاستراتيجية القائمة — لا مصدر ثانٍ). */
export interface StrategySnapshotItem {
  scope: string;
  what: string;
  why: string;
  where: string[];
  expectedSignal: string;
  status: string;
  evidence: string[];
}

export interface StrategyStateVersion {
  version: number;
  at: string;
  reason: StrategyChangeReason;
  reasonLabelAr: string;
  /** ملخّص نصّي (بلا سرّ). */
  summary: string;
  evidence: string[];
  source: string;
  confidence: 'low' | 'medium' | 'high';
  items: StrategySnapshotItem[];
}

export interface StrategyState {
  /** معرّف العقل المركزي المالك (ثابت). */
  owner: typeof CENTRAL_BRAIN_ID;
  currentVersion: number;
  current: StrategyStateVersion | null;
  /** الإصدارات السابقة (الأحدث أولاً)، بحدّ أعلى — لا حذف لغير الأقدم صراحةً. */
  history: StrategyStateVersion[];
  updateCount: number;
  lastReason: StrategyChangeReason;
  lastUpdatedAt: string | null;
}

export function emptyStrategyState(): StrategyState {
  return {
    owner: CENTRAL_BRAIN_ID,
    currentVersion: 0,
    current: null,
    history: [],
    updateCount: 0,
    lastReason: 'no_change',
    lastUpdatedAt: null,
  };
}

/** يبني لقطة استراتيجية مُطبَّعة من خطط الاستراتيجية القائمة (بلا إعادة حساب). */
export function toStrategySnapshot(plans: Array<{
  scope?: string; what?: string; why?: string; where?: unknown; expectedSignal?: string;
  status?: string; evidence?: unknown;
}>): StrategySnapshotItem[] {
  return (plans || []).slice(0, 12).map((p) => ({
    scope: String(p.scope ?? 'general'),
    what: String(p.what ?? '').slice(0, 200),
    why: String(p.why ?? '').slice(0, 300),
    where: Array.isArray(p.where) ? p.where.map((w) => String(w)) : [],
    expectedSignal: String(p.expectedSignal ?? '').slice(0, 200),
    status: String(p.status ?? 'unknown'),
    evidence: Array.isArray(p.evidence) ? p.evidence.map((e) => String(e)).slice(0, 10) : [],
  }));
}

/** بصمة حتمية بسيطة (FNV-1a) لمقارنة اللقطات بلا اعتماد على مكتبة. */
export function strategyFingerprint(items: StrategySnapshotItem[]): string {
  const text = (items || []).map((i) => `${i.scope}|${i.what}|${i.why}|${i.where.join(',')}|${i.expectedSignal}|${i.status}`).join('\n');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function confidenceOf(items: StrategySnapshotItem[]): 'low' | 'medium' | 'high' {
  if (!items.length) return 'low';
  const supported = items.filter((i) => i.status === 'supported').length;
  const withEvidence = items.filter((i) => i.evidence.length > 0).length;
  if (supported >= 3 && withEvidence === items.length) return 'high';
  if (supported >= 1) return 'medium';
  return 'low';
}

export interface StrategyUpdateResult {
  state: StrategyState;
  changed: boolean;
  reason: StrategyChangeReason;
  version: number;
}

/**
 * يُحدّث الحالة الاستراتيجية من لقطة جديدة. لا يُسجّل إصداراً إلا عند تغيّر فعلي
 * (أو تحديث دليل لنفس اللقطة)؛ وإلا يرجع `no_change` بلا كتابة.
 */
export function updateStrategyState(
  state: StrategyState,
  input: { items: StrategySnapshotItem[]; now: number; source?: string; signal?: string },
): StrategyUpdateResult {
  const base = state || emptyStrategyState();
  const items = input.items || [];
  const at = new Date(input.now).toISOString();
  const source = String(input.source || 'brain:strategyEngine');

  // لا دليل ولا استراتيجية => لا نُسجّل نسخة وهمية.
  if (!items.length) {
    return { state: { ...base, lastReason: 'no_change' }, changed: false, reason: 'no_change', version: base.currentVersion };
  }

  const fingerprint = strategyFingerprint(items);
  const prevFingerprint = base.current ? strategyFingerprint(base.current.items) : null;

  if (prevFingerprint === fingerprint) {
    return { state: { ...base, lastReason: 'no_change' }, changed: false, reason: 'no_change', version: base.currentVersion };
  }

  const reason: StrategyChangeReason = base.currentVersion === 0 ? 'initial' : 'strategy_changed';
  const version = base.currentVersion + 1;
  const evidenceSummary = [...new Set(items.flatMap((i) => i.evidence))].slice(0, 8);
  const entry: StrategyStateVersion = {
    version,
    at,
    reason,
    reasonLabelAr: STRATEGY_CHANGE_REASON_LABELS_AR[reason],
    summary: input.signal ? String(input.signal).slice(0, 300) : `${items.length} خطة استراتيجية (بصمة ${fingerprint}).`,
    evidence: evidenceSummary,
    source,
    confidence: confidenceOf(items),
    items,
  };

  const history = [entry, ...base.history].slice(0, STRATEGY_HISTORY_MAX);
  return {
    state: {
      owner: CENTRAL_BRAIN_ID,
      currentVersion: version,
      current: entry,
      history: version > 1 ? [base.current!, ...base.history].filter(Boolean).slice(0, STRATEGY_HISTORY_MAX) : history,
      updateCount: base.updateCount + 1,
      lastReason: reason,
      lastUpdatedAt: at,
    },
    changed: true,
    reason,
    version,
  };
}

/** يسترجع حالة استراتيجية محفوظة (توافق خلفي عند غياب/فساد المخزون). */
export function normalizeStrategyState(raw: any): StrategyState {
  if (!raw || typeof raw !== 'object') return emptyStrategyState();
  const current = raw.current && typeof raw.current === 'object' ? raw.current as StrategyStateVersion : null;
  const history = Array.isArray(raw.history) ? raw.history.slice(0, STRATEGY_HISTORY_MAX) : [];
  return {
    owner: CENTRAL_BRAIN_ID,
    currentVersion: Number.isFinite(Number(raw.currentVersion)) ? Number(raw.currentVersion) : (current?.version ?? 0),
    current,
    history,
    updateCount: Number.isFinite(Number(raw.updateCount)) ? Number(raw.updateCount) : history.length,
    lastReason: (raw.lastReason as StrategyChangeReason) || 'no_change',
    lastUpdatedAt: typeof raw.lastUpdatedAt === 'string' ? raw.lastUpdatedAt : null,
  };
}

/** ملخّص بلا سرّ لحالة الاستراتيجية (للعرض/الصحة). */
export function summarizeStrategyState(state: StrategyState) {
  const s = state || emptyStrategyState();
  return {
    owner: s.owner,
    currentVersion: s.currentVersion,
    hasCurrent: Boolean(s.current),
    currentScopeCount: s.current?.items.length ?? 0,
    confidence: s.current?.confidence ?? null,
    lastReason: s.lastReason,
    lastReasonLabelAr: STRATEGY_CHANGE_REASON_LABELS_AR[s.lastReason] ?? s.lastReason,
    lastUpdatedAt: s.lastUpdatedAt,
    historyCount: s.history.length,
  };
}
