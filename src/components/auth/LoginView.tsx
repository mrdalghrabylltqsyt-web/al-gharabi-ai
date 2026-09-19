import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import {
  ShieldCheck,
  Lock,
  Mail,
  ArrowRight,
  Sparkles,
  AlertCircle,
  KeyRound,
  Building2,
  CheckCircle2,
} from 'lucide-react';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          renderButton: (element: HTMLElement, options: any) => void;
          prompt: () => void;
        };
      };
    };
  }
}

export const LoginView: React.FC = () => {
  const { loginWithGoogle, requestOwnerChallenge, verifyOwnerChallenge } = useApp();
  const [activeTab, setActiveTab] = useState<'google' | 'challenge'>('google');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);

  const googleBtnRef = useRef<HTMLDivElement>(null);
  const googleClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || '';

  // Initialize Google Identity Services if client ID is configured
  useEffect(() => {
    if (!googleClientId) return;

    const interval = setInterval(() => {
      if (window.google?.accounts?.id && googleBtnRef.current) {
        clearInterval(interval);
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response: any) => {
            if (response.credential) {
              setLoading(true);
              setError(null);
              try {
                await loginWithGoogle(response.credential);
              } catch (err: any) {
                setError(err.message || 'فشلت المصادقة مع Google');
              } finally {
                setLoading(false);
              }
            }
          },
        });

        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'filled_black',
          size: 'large',
          width: 320,
          text: 'signin_with',
          locale: 'ar',
          shape: 'rectangular',
        });
      }
    }, 300);

    return () => clearInterval(interval);
  }, [googleClientId, loginWithGoogle]);

  const handleRequestChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('يرجى إدخال البريد الإلكتروني المصرح له');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessInfo(null);
    try {
      const res = await requestOwnerChallenge(email.trim());
      if (res.success) {
        setStep('verify');
        setSuccessInfo(res.message || 'تم إرسال رمز التحقق إلى بريد المالك');
      } else {
        setError('تعذر إرسال رمز التحقق، حاول مرة أخرى');
      }
    } catch (err: any) {
      setError(err?.message || 'تعذر إرسال رمز التحقق، حاول مرة أخرى');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('يرجى إدخال رمز التحقق المكون من 6 أرقام');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await verifyOwnerChallenge(email.trim(), code.trim());
    } catch (err: any) {
      setError(err.message || 'رمز التحقق غير صحيح أو منتهي الصلاحية');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden font-['Cairo',sans-serif]">
      {/* Background Ambience */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 backdrop-blur-xl rounded-3xl p-6 sm:p-8 shadow-2xl relative z-10 space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 mb-2 shadow-inner">
            <Building2 className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">معرض الغرابي للتقسيط</h1>
          <p className="text-xs text-slate-400 flex items-center justify-center gap-1.5 font-medium">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            بوابة المصادقة والتحكم الآمنة (Authentication Gate)
          </p>
        </div>

        {/* Security Notice */}
        <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300 space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-emerald-400">
            <Lock className="w-3.5 h-3.5" />
            <span>نظام محمي برمجياً برتبة مالك النظام (Owner)</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            الوصول إلى لوحة الإدارة محصور حصراً بالمالك والمستخدمين المعتمدين مسبقاً من قِبل المالك. لن يتم تحميل أي بيانات قبل التحقق الناجح.
          </p>
        </div>

        {/* Auth Method Selector */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-slate-950 border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setActiveTab('google');
              setError(null);
            }}
            className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'google'
                ? 'bg-emerald-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Google Sign-In
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('challenge');
              setError(null);
            }}
            className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'challenge'
                ? 'bg-emerald-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            تحقق البريد المعتمد
          </button>
        </div>

        {/* Error / Success Feedback */}
        {error && (
          <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {successInfo && (
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{successInfo}</span>
          </div>
        )}

        {/* Tab 1: Google Sign-In */}
        {activeTab === 'google' && (
          <div className="space-y-4 py-2">
            {googleClientId ? (
              <div className="flex flex-col items-center justify-center gap-3">
                <div ref={googleBtnRef} className="flex justify-center" />
                <p className="text-[11px] text-slate-400 text-center">
                  سجل الدخول بحساب Google المعتمد لدى المعرض للمصادقة الفورية.
                </p>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 text-center space-y-3">
                <p className="text-xs text-slate-300 leading-relaxed">
                  لم يتم ضبط <code className="text-emerald-400 bg-slate-900 px-1 py-0.5 rounded text-[11px]">VITE_GOOGLE_CLIENT_ID</code> في البيئة الحالية.
                </p>
                <p className="text-[11px] text-slate-400">
                  يمكن لمالك النظام الدخول فوراً عبر تبويب <strong className="text-emerald-300">"تحقق البريد المعتمد"</strong> بالأعلى واستخدام بريد المالك الرسمي.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('challenge')}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <KeyRound className="w-4 h-4" />
                  الانتقال للتحقق ببريد المالك
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Authorized Email Verification Challenge */}
        {activeTab === 'challenge' && (
          <div>
            {step === 'request' ? (
              <form onSubmit={handleRequestChallenge} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 block">
                    البريد الإلكتروني المعتمد
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="mrdalghrabylltqsyt@gmail.com"
                      dir="ltr"
                      className="w-full px-3.5 py-2.5 pl-10 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 text-xs focus:outline-none focus:border-emerald-500 transition"
                    />
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    بريد المالك الوحيد حالياً: mrdalghrabylltqsyt@gmail.com
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-50"
                >
                  {loading ? (
                    'جاري التحقق وإرسال الرمز...'
                  ) : (
                    <>
                      <span>طلب رمز التحقق الآمن</span>
                      <ArrowRight className="w-4 h-4 rotate-180" />
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyChallenge} className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold text-slate-300 block">
                      رمز التحقق (6 أرقام)
                    </label>
                    <button
                      type="button"
                      onClick={() => setStep('request')}
                      className="text-[11px] text-emerald-400 hover:underline cursor-pointer"
                    >
                      تغيير البريد
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={6}
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••••"
                      dir="ltr"
                      className="w-full px-3.5 py-2.5 pl-10 text-center tracking-widest text-lg font-mono rounded-xl bg-slate-950 border border-slate-800 text-emerald-400 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
                    />
                    <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    تم إرسال رمز التحقق إلى بريد المالك. أدخل الرمز المكوّن من 6 أرقام لإتمام الدخول.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-50"
                >
                  {loading ? 'جاري التحقق وتسجيل الدخول...' : 'تأكيد الرمز والدخول للنظام'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Bottom Metadata */}
        <div className="pt-2 border-t border-slate-800/80 text-center text-[10px] text-slate-500">
          نظام حوكمة معرض الغرابي للتقسيط • مشفر ببروتوكولات الأمان القياسية
        </div>
      </div>
    </div>
  );
};
