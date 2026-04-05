import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import { TooltipProvider } from './hooks/useTooltipLevel.jsx';
import { ToastProvider } from './hooks/useToast.jsx';
import ErrorFallback from './components/ErrorFallback.jsx';
import App from './App.jsx';
import { installRuntimeGuards } from './lib/installRuntimeGuards.js';
import { setRuntimeStreamingState } from './lib/runtimeStreamingState.js';
import './App.css';
import './settings.css';
import './depth-effects.css';
import './design-system.css';
import './design-system-v2.css';
import './themes/atmospherics.css';
import './themes/new-atmospherics.css';
import './themes/apple.css';
import './overhaul.css';

installRuntimeGuards({ isDev: import.meta.env.DEV, hot: import.meta.hot });

// ── App mount ────────────────────────────────────────────────
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(error, info) => {
        // Clear streaming flag so the monkey-patched location.reload()
        // doesn't defer indefinitely when the app crashes mid-stream.
        setRuntimeStreamingState(false);

        // Dispatch custom event for the DevTools bridge to pick up.
        // This keeps crash details available to any outer listeners
        // without coupling main.jsx to app-specific providers.
        window.dispatchEvent(new CustomEvent('react-error-boundary', {
          detail: { error, componentStack: info?.componentStack },
        }));
      }}
    >
      <TooltipProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </TooltipProvider>
    </ErrorBoundary>
  </StrictMode>
);
