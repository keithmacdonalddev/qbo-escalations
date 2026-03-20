import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import { TooltipProvider } from './hooks/useTooltipLevel.jsx';
import { ToastProvider } from './hooks/useToast.jsx';
import ErrorFallback from './components/ErrorFallback.jsx';
import CrashModeAgent from './components/CrashModeAgent.jsx';
import App from './App.jsx';
import './App.css';
import './settings.css';
import './depth-effects.css';
import './design-system.css';
import './design-system-v2.css';
import './themes/atmospherics.css';
import './themes/new-atmospherics.css';
import './themes/apple.css';

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

  // Auto-save draft state before ANY page unload (Vite HMR full reload, manual refresh, etc.)
  // This ensures draft input and scroll position survive reloads without user action.
  const saveDraftState = () => {
    try {
      const textarea = document.querySelector('.compose-body textarea');
      if (textarea?.value) sessionStorage.setItem('qbo-draft-input', textarea.value);
      const msgBox = document.querySelector('.chat-messages');
      if (msgBox) sessionStorage.setItem('qbo-draft-scroll', String(msgBox.scrollTop));
    } catch {}
  };

  window.addEventListener('beforeunload', saveDraftState);

  // Also intercept Vite's full reload signal to save state before it triggers
  if (import.meta.hot) {
    import.meta.hot.on('vite:beforeFullReload', saveDraftState);
  }

  // ── Reload Guard ──────────────────────────────────────────
  // When an AI stream is active (window.__qboStreaming), intercept
  // location.reload() calls (fired by Vite's debounced pageReload) and
  // defer the reload until the stream completes. This prevents killing
  // in-progress AI responses.
  //
  // Why monkey-patch location.reload:
  //   Vite 7's vite:beforeFullReload uses Promise.allSettled — throwing
  //   in the listener does NOT prevent the subsequent pageReload().
  //   The only reliable interception point is location.reload itself.
  {
    const _realReload = location.reload.bind(location);
    let reloadDeferred = false;
    let deferToastEl = null;

    const showDeferToast = () => {
      if (deferToastEl) return;
      const el = document.createElement('div');
      el.id = 'qbo-reload-deferred-toast';
      el.textContent = 'Update queued — reloading after stream completes';
      Object.assign(el.style, {
        position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
        zIndex: '99999', background: 'rgba(30,30,30,0.92)', color: 'rgba(255,255,255,0.85)',
        padding: '8px 16px', borderRadius: '8px', fontSize: '12px',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
        border: '1px solid rgba(255,255,255,0.08)',
        pointerEvents: 'none',
      });
      document.body.appendChild(el);
      deferToastEl = el;
    };

    const removeDeferToast = () => {
      if (deferToastEl) {
        deferToastEl.remove();
        deferToastEl = null;
      }
    };

    // Override location.reload — defer when streaming is active.
    // Use direct assignment (defineProperty throws on location in most browsers).
    const guardedReload = function patchedReload() {
      if (window.__qboStreaming) {
        if (!reloadDeferred) {
          reloadDeferred = true;
          showDeferToast();
          const check = setInterval(() => {
            if (!window.__qboStreaming) {
              clearInterval(check);
              reloadDeferred = false;
              removeDeferToast();
              saveDraftState();
              _realReload();
            }
          }, 500);
        }
        return;
      }
      _realReload();
    };
    try { location.reload = guardedReload; } catch (_) { /* readonly in some engines */ }

    // Also intercept Vite's full reload via beforeunload — if streaming,
    // cancel the navigation (browsers show a confirmation dialog or block it).
    window.addEventListener('beforeunload', (e) => {
      if (window.__qboStreaming && reloadDeferred) {
        e.preventDefault();
      }
    });
  }

  // ── Recovery Toast ────────────────────────────────────────
  // After a reload recovery (sessionStorage restore), show a brief
  // informational toast. Uses DOM directly because this runs before React.
  window.addEventListener('qbo:session-recovered', () => {
    const el = document.createElement('div');
    el.textContent = 'Session restored';
    Object.assign(el.style, {
      position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '99998', background: 'rgba(34,120,75,0.92)', color: '#fff',
      padding: '8px 16px', borderRadius: '8px', fontSize: '12px',
      fontFamily: 'system-ui, sans-serif',
      boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
      transition: 'opacity 400ms ease',
      pointerEvents: 'none',
    });
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
    }, 3000);
  });

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
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onError={(error, info) => {
        // Clear streaming flag so the monkey-patched location.reload()
        // doesn't defer indefinitely when the app crashes mid-stream.
        window.__qboStreaming = false;

        // Dispatch custom event for the DevTools bridge to pick up.
        // This bridges React render crashes to the auto-error pipeline
        // without coupling main.jsx to DevAgentContext.
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
    <CrashModeAgent />
  </StrictMode>
);
