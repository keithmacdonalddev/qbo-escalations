import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import { TooltipProvider } from './hooks/useTooltipLevel.jsx';
import { ToastProvider } from './hooks/useToast.jsx';
import ErrorFallback from './components/ErrorFallback.jsx';
import App from './App.jsx';
import './App.css';
import './settings.css';
import './depth-effects.css';

// ── HMR desync detection ─────────────────────────────────────
// Catches React hook invariant violations caused by Vite HMR.
// Shows a non-intrusive toast with refresh button — does NOT auto-reload
// because that would kill active AI chat streams.
if (import.meta.env.DEV) {
  const HMR_PATTERNS = [
    'Rendered fewer hooks than expected',
    'Rendered more hooks than expected',
    'change between renders',
    'Should have a queue',
    'invalid hook call',
    'Hooks conditionally',
  ];

  let toastEl = null;

  const showDesyncToast = () => {
    if (toastEl) return;

    const toast = document.createElement('div');
    toast.innerHTML = '<span>HMR desync</span>'
      + '<button id="hmr-refresh" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.2);color:#fff;padding:3px 10px;border-radius:5px;cursor:pointer;font-size:11px;margin-left:8px">Reload</button>';
    Object.assign(toast.style, {
      position: 'fixed', bottom: '16px', right: '16px',
      zIndex: '99999', background: 'rgba(30,30,30,0.9)', color: 'rgba(255,255,255,0.7)',
      padding: '6px 12px', borderRadius: '8px', fontSize: '11px',
      display: 'flex', alignItems: 'center',
      fontFamily: 'system-ui, sans-serif',
      boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
      transition: 'opacity 300ms ease',
    });
    document.body.appendChild(toast);
    toastEl = toast;

    toast.querySelector('#hmr-refresh').onclick = () => {
      try {
        sessionStorage.setItem('qbo-hmr-reload-at', String(Date.now()));
        // Save draft input + scroll position for safe reload
        const textarea = document.querySelector('.compose-body textarea');
        if (textarea?.value) sessionStorage.setItem('qbo-draft-input', textarea.value);
        const msgBox = document.querySelector('.chat-messages');
        if (msgBox) sessionStorage.setItem('qbo-draft-scroll', String(msgBox.scrollTop));
      } catch {}
      location.reload();
    };

    // Auto-dismiss after 8s — it's just informational
    setTimeout(() => { if (toastEl === toast) { toast.style.opacity = '0'; setTimeout(() => { toast.remove(); toastEl = null; }, 300); } }, 8000);
  };

  window.addEventListener('error', (e) => {
    if (e.message && HMR_PATTERNS.some(p => e.message.includes(p))) showDesyncToast();
  });

  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message || String(e.reason || '');
    if (HMR_PATTERNS.some(p => msg.includes(p))) showDesyncToast();
  });
}

// ── App mount ────────────────────────────────────────────────
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <TooltipProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </TooltipProvider>
    </ErrorBoundary>
  </StrictMode>
);
