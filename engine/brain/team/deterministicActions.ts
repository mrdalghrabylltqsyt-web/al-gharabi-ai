/**
 * Deterministic Actions — تنفيذ الأفعال الأربعة المسموحة للعقول الستة.
 *
 * المنطق خالص وقابل للاختبار: كل تأثير خارجي (كتابة عدّاد، إعادة نشر، إرسال رد)
 * يُحقَن عبر `DeterministicActionDeps`، فلا شبكة ولا أسرار هنا. الخادم يحقن
 * المنفّذات الحقيقية القائمة (نفس بوابات المشروع: اتصال موثق/سلامة/منع تكرار).
 *
 * **لا استدعاء Gemini** في أي مسار هنا. النجاح لا يُعلن إلا بدليل حقيقي من المزود
 * (معرّف رد/منشور)؛ وإلا فشل صريح.
 */

import {
  evaluateSixAgentAction,
  type SixAgentActionInput,
  type SixAgentPolicyDecision,
  type SixAgentPolicyDecisionCode,
} from './executionPolicy';

export interface DeterministicActionDeps {
  /** تثبيت/تصنيف تعليق محلياً (لا قرار) — يعيد معرّف الدليل. */
  tagComment: (platform: string, commentId: string, tag: string) => { ok: boolean; evidenceRef: string | null };
  /** تسجيل/تحديث عدّاد (قراءة/كتابة بيانات، لا قرار). */
  recordCounter: (platform: string, metric: string, value: number) => void;
  /** إعادة محاولة نشر فاشل على منصة واحدة عبر المنفّذ المشترك. */
  retryPublish: (platform: string, postId: string, content: string) => Promise<{ ok: boolean; providerPostId: string | null; error?: string }>;
  /** إرسال رد عبر المنفّذ المشترك (كل بوابات السلامة/التكرار سارية داخله). */
  sendReply: (platform: string, target: { commentId: string }, text: string) => Promise<{ ok: boolean; providerReplyId: string | null; error?: string }>;
}

export type SixAgentOutcome = 'executed' | 'failed' | 'escalated' | 'rejected';

export interface SixAgentActionExecution {
  decision: SixAgentPolicyDecision;
  outcome: SixAgentOutcome;
  /** دليل حقيقي (معرّف رد/منشور) عند التنفيذ — بلا اختراع. */
  evidenceRef: string | null;
  note: string;
}

export interface SixAgentExecuteInput extends SixAgentActionInput {
  agentId: string;
  platform: string;
  commentId?: string;
  /** للتصنيف: الوسم المحسوب حتمياً. */
  tag?: string;
  /** للعدّادات. */
  metric?: string;
  value?: number;
  /** لإعادة النشر. */
  postId?: string;
  content?: string;
  /** نص الرد من النمط المحفوظ المطابق (لا اختراع) عند فعل الرد. */
  patternReplyText?: string;
}

/**
 * يقيّم الفعل ثم ينفّذه حتمياً إن كان مسموحاً. عند التصعيد/الرفض لا يُنفَّذ شيء
 * (يعود للعقل المركزي). لا Gemini.
 */
export async function executeSixAgentAction(
  input: SixAgentExecuteInput,
  deps: DeterministicActionDeps,
): Promise<SixAgentActionExecution> {
  const decision = evaluateSixAgentAction(input);

  if (decision.code === 'REJECT_OUT_OF_WHITELIST') {
    return { decision, outcome: 'rejected', evidenceRef: null, note: decision.reasonAr };
  }
  if (!decision.allowed) {
    return { decision, outcome: 'escalated', evidenceRef: null, note: decision.reasonAr };
  }

  try {
    if (input.action === 'classify_tag_comment') {
      const r = deps.tagComment(input.platform, String(input.commentId || ''), String(input.tag || 'neutral'));
      return { decision, outcome: r.ok ? 'executed' : 'failed', evidenceRef: r.evidenceRef, note: r.ok ? 'صُنّف محلياً بقاعدة حتمية.' : 'تعذّر التصنيف المحلي.' };
    }
    if (input.action === 'update_engagement_counters') {
      deps.recordCounter(input.platform, String(input.metric || 'views'), Number(input.value || 0));
      return { decision, outcome: 'executed', evidenceRef: null, note: 'سُجّل العدّاد.' };
    }
    if (input.action === 'retry_failed_publish_once') {
      const r = await deps.retryPublish(input.platform, String(input.postId || ''), String(input.content || ''));
      return { decision, outcome: r.ok && r.providerPostId ? 'executed' : 'failed', evidenceRef: r.providerPostId, note: r.ok ? 'أُعيد النشر وثُبّت بمعرّف المزود.' : `تعذّرت إعادة النشر: ${r.error || 'سبب غير معروف'}` };
    }
    if (input.action === 'reply_from_stored_pattern') {
      // النص يأتي من النمط المطابق فقط (لا اختراع): نطلبه من القرار.
      const patternText = (input as any).patternReplyText as string | undefined;
      if (!patternText) return { decision, outcome: 'escalated', evidenceRef: null, note: 'نمط مطابق بلا نص محفوظ ⇒ العقل المركزي.' };
      const r = await deps.sendReply(input.platform, { commentId: String(input.commentId || '') }, patternText);
      return { decision, outcome: r.ok && r.providerReplyId ? 'executed' : 'failed', evidenceRef: r.providerReplyId, note: r.ok ? 'أُرسل الرد وثُبّت بمعرّف المزود.' : `تعذّر إرسال الرد: ${r.error || 'سبب غير معروف'}` };
    }
    return { decision, outcome: 'rejected', evidenceRef: null, note: 'فعل غير معروف.' };
  } catch (e: any) {
    return { decision, outcome: 'failed', evidenceRef: null, note: String(e?.message || e).slice(0, 160) };
  }
}

/** كود التصعيد الموحّد للعقل المركزي (للتوثيق والاختبار). */
export const SIX_AGENT_ESCALATION_CODE: SixAgentPolicyDecisionCode = 'ESCALATE_CENTRAL';
