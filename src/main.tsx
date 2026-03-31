import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './AuthContext.tsx';
import './index.css';

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
      const periodicSync = (registration as ServiceWorkerRegistration & {
        periodicSync?: {
          register: (tag: string, options: { minInterval: number }) => Promise<void>;
        };
        sync?: {
          register: (tag: string) => Promise<void>;
        };
      }).periodicSync;
      const sync = (registration as ServiceWorkerRegistration & {
        sync?: {
          register: (tag: string) => Promise<void>;
        };
      }).sync;

      // Best-effort background reminder checks where supported.
      if (periodicSync) {
        await periodicSync.register('examrigor-reminder-check', {
          minInterval: 15 * 60 * 1000,
        });
      }

      if (sync) {
        await sync.register('examrigor-reminder-check');
      }
    } catch {
      // Silent fallback: app still works with in-tab reminders.
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
