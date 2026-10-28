/**
 * اسم المرسل الظاهر (2026-10-27): بريد مثل onboarding@resend.dev كان يظهر في Gmail باسم
 * «onboarding». إن لم يحمل العنوان اسماً يُضاف «الغرابي AI» — العنوان نفسه لا يتغيّر.
 */
export function withSenderName(from: string | null | undefined): string {
  const f = String(from || '').trim();
  if (!f || f.includes('<')) return f;
  return `الغرابي AI <${f}>`;
}
