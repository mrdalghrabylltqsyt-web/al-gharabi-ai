import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/common/ErrorBoundary';
import {installClientErrorReporting} from './utils/clientErrors';
import './index.css';

// المهندس المشرف يرى أعطال الواجهة الحقيقية (انهيار شاشة، خطأ JavaScript، خادم لا يُجيب).
installClientErrorReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary area="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
