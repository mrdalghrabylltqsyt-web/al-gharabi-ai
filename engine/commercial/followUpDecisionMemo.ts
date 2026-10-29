/**
 * ذاكرة قرارات المتابعة (2026-10-29) — تسجيل «التغيّر» لا «التكرار».
 *
 * العطل الذي تعالجه: دورة العقل التجاري (كل 10 د) كانت تكتب سطر audit لكل زبون «مستحق
 * متابعة لكن غير مؤهل» في **كل** دورة، بالسبب نفسه. النتيجة: سجل العمليات (سقفه 100) يُمحى
 * بالكامل كل بضع دورات فتضيع العمليات الحقيقية (دخول، نشر، تعديل منتج…)، وكل سطر يطلب
 * حفظ الحالة، والغرفة الحية تعرض هذا التكرار كأنه «نشاط حقيقي» منتظم.
 *
 * القاعدة: يُسجَّل قرار المنع لزبون عند أول ظهوره أو عند تغيّر سببه فقط. حين يصبح الزبون
 * مؤهلاً (أو يُحذف) يُنسى قراره، فيُسجَّل من جديد لو مُنع لاحقاً. الحجم محدود (الأقدم يُسقط).
 * صافٍ: بلا شبكة ولا ساعة ولا حالة عامة.
 */

export interface FollowUpDecisionMemo {
  /** true إن كان هذا القرار جديداً لهذا الزبون (يستحق سطر audit)، false إن كان تكراراً. */
  changed(leadKey: string, code: string): boolean;
  /** الزبون صار مؤهلاً أو أُرسلت/صيغت متابعته: يُنسى قراره السابق. */
  forget(leadKey: string): void;
  size(): number;
}

export function createFollowUpDecisionMemo(max = 2000): FollowUpDecisionMemo {
  const seen = new Map<string, string>();
  const cap = Math.max(1, Math.floor(max));
  return {
    changed(leadKey, code) {
      const k = String(leadKey || '');
      const c = String(code || '');
      if (!k) return true;
      if (seen.get(k) === c) return false;
      seen.delete(k); // يُعاد إدراجه في الآخر (الأحدث)
      seen.set(k, c);
      while (seen.size > cap) {
        const oldest = seen.keys().next().value;
        if (oldest === undefined) break;
        seen.delete(oldest);
      }
      return true;
    },
    forget(leadKey) { seen.delete(String(leadKey || '')); },
    size() { return seen.size; },
  };
}
