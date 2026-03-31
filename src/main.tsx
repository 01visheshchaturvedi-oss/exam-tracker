import { StrictMode, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './AuthContext.tsx';
import './index.css';

// ── Error Boundary: catches any render crash and shows the error instead of blank ──
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ExamRigor] Render error:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', background: '#0a0a0b', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '2rem', fontFamily: 'monospace'
        }}>
          <div style={{ maxWidth: 600, width: '100%' }}>
            <div style={{ color: '#ef4444', fontWeight: 'bold', fontSize: 18, marginBottom: 12 }}>
              ⚠ ExamRigor crashed on startup
            </div>
            <div style={{
              background: '#1c1d21', border: '1px solid #ef444440',
              borderRadius: 12, padding: '1rem', marginBottom: 12,
              color: '#fca5a5', fontSize: 13, lineHeight: 1.6,
              overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
            }}>
              {this.state.error.message}
            </div>
            <div style={{ color: '#ffffff40', fontSize: 11, marginBottom: 16 }}>
              {this.state.error.stack}
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#ef4444', color: '#fff', border: 'none',
                borderRadius: 10, padding: '10px 24px', fontWeight: 'bold',
                cursor: 'pointer', fontSize: 14
              }}
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── PWA / Service Worker setup ──
const manifestLink = document.createElement('link');
manifestLink.rel = 'manifest';
manifestLink.href = '/manifest.webmanifest';
document.head.appendChild(manifestLink);

const themeMeta = document.createElement('meta');
themeMeta.name = 'theme-color';
themeMeta.content = '#dc2626';
document.head.appendChild(themeMeta);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const periodicSync = (registration as any).periodicSync;
      const sync = (registration as any).sync;
      if (periodicSync) {
        await periodicSync.register('examrigor-reminder-check', { minInterval: 15 * 60 * 1000 });
      }
      if (sync) {
        await sync.register('examrigor-reminder-check');
      }
    } catch {
      // Silent fallback
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
