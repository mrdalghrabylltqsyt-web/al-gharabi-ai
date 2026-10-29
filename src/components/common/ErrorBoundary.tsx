import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportClientError, firstFrame } from '../../utils/clientErrors';
import { isStaleChunkError, reloadForNewVersion } from '../../utils/staleChunk';

/**
 * حاجز الانهيار (2026-10-28): كان أي خطأ في أي شاشة يُفرغ التطبيق كله (شاشة بيضاء) بلا
 * أثر عند الخادم. الآن: الشاشة المنهارة وحدها تعرض رسالة مع زر «إعادة المحاولة»، والمهندس
 * المشرف يتلقى العطل بموضعه ليُصلَح في الكود.
 */
type Props = { children: ReactNode; area?: string };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  // المشروع بلا @types/react فيُستنتج نوع Component من JavaScript؛ نعلن الحقلين صراحةً.
  declare props: Readonly<Props>;
  declare setState: (next: State) => void;
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // شاشة من نسخة سابقة بعد النشر: ليست عيباً — إعادة تحميل مرة تأخذ النسخة الجديدة.
    if (isStaleChunkError(error) && reloadForNewVersion()) return;
    const comp = String(info?.componentStack || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
    reportClientError(`render crash: ${error?.name || 'Error'}: ${error?.message || error}`, this.props.area || location.hash || 'app', firstFrame(error?.stack) || comp.slice(0, 140));
  }

  render() {
    if (!this.state.error) return this.props.children;
    const staleVersion = isStaleChunkError(this.state.error);
    return (
      <div dir="rtl" role="alert" style={{ margin: '40px auto', maxWidth: 520, padding: 24, borderRadius: 16, border: '1px solid #F8717155', background: '#1E1B2E', color: '#E5E7EB', fontFamily: 'inherit', textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>{staleVersion ? 'نُشرت نسخة جديدة' : 'تعذّر عرض هذه الشاشة'}</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#C9D3EA', lineHeight: 1.8 }}>
          {staleVersion
            ? 'هذه الصفحة مفتوحة من النسخة السابقة. حدّث الصفحة لتحميل النسخة الجديدة — بياناتك محفوظة على الخادم.'
            : 'حدث خطأ برمجي في هذه الشاشة وأُبلغ المهندس المشرف به تلقائياً. بياناتك محفوظة على الخادم ولم يتأثر شيء منها.'}
        </p>
        <button type="button" onClick={() => this.setState({ error: null })} style={{ padding: '8px 18px', borderRadius: 10, border: '1px solid #34D399', background: 'transparent', color: '#6EE7B7', cursor: 'pointer', marginInlineEnd: 8 }}>إعادة المحاولة</button>
        <button type="button" onClick={() => location.reload()} style={{ padding: '8px 18px', borderRadius: 10, border: '1px solid #64748B', background: 'transparent', color: '#CBD5E1', cursor: 'pointer' }}>تحديث الصفحة</button>
      </div>
    );
  }
}
