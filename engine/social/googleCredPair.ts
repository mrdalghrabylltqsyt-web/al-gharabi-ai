/**
 * اختيار اعتماد Google زوجاً متّسقاً (2026-10-28) — منطق صافٍ قابل للاختبار.
 *
 * عطل حقيقي: ربط Google Business فشل بـ«The provided client secret is invalid» بينما ربط يوتيوب بالاعتماد
 * المشترك نجح في الدقيقة نفسها. كان المعرّف يُختار بسلسلة (GOOGLE_BUSINESS_* ثم المشترك) والسرّ بسلسلة
 * مستقلة، فيمكن أن يُقرن معرّف مشترك بسرّ خاص قديم أو العكس. الآن: زوج واحد كامل من مصدر واحد.
 */
export interface CredPair { clientId: string; clientSecret: string }

export function pickGoogleCredentialPair(i: { business: CredPair; shared: CredPair; businessRejected?: boolean }): CredPair & { source: 'business' | 'shared' | 'none' } {
  const full = (p: CredPair) => Boolean(String(p.clientId || '').trim() && String(p.clientSecret || '').trim());
  if (full(i.business) && !i.businessRejected) return { clientId: i.business.clientId, clientSecret: i.business.clientSecret, source: 'business' };
  if (full(i.shared)) return { clientId: i.shared.clientId, clientSecret: i.shared.clientSecret, source: 'shared' };
  if (full(i.business)) return { clientId: i.business.clientId, clientSecret: i.business.clientSecret, source: 'business' };
  return { clientId: '', clientSecret: '', source: 'none' };
}
