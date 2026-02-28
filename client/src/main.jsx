import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from './hooks/useTooltipLevel.jsx';
import App from './App.jsx';
import './App.css';
import './settings.css';
import './depth-effects.css';

// ── HMR desync detection ─────────────────────────────────────
// Catches React hook invariant violations caused by Vite HMR
// getting out of sync after file edits, and shows a refresh toast.
if (import.meta.env.DEV) {
  const HMR_PATTERNS = [
    'Rendered fewer hooks than expected',
    'Rendered more hooks than expected',
    'change between renders',
    'Should have a queue',
    'invalid hook call',
    'Hooks conditionally',
  ];

  let toastShown = false;

  const showHmrToast = () => {
    if (toastShown) return;
    toastShown = true;

    const toast = document.createElement('div');
    toast.innerHTML = `
      <span style="margin-right:10px">HMR desync detected</span>
      <button id="hmr-refresh" style="
        background:rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.25);
        color:#fff; padding:4px 12px; border-radius:6px; cursor:pointer;
        font-size:12px; font-weight:600;
      ">Refresh</button>
      <button id="hmr-dismiss" style="
        background:none; border:none; color:rgba(255,255,255,0.5);
        cursor:pointer; font-size:16px; margin-left:6px; padding:2px 6px;
      ">&times;</button>
    `;
    Object.assign(toast.style, {
      position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '99999', background: 'rgba(30,30,30,0.95)', color: '#fff',
      padding: '10px 16px', borderRadius: '10px', fontSize: '13px',
      display: 'flex', alignItems: 'center', gap: '4px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08)',
      backdropFilter: 'blur(12px)', fontFamily: 'system-ui, sans-serif',
      animation: 'hmr-toast-in 0.25s ease-out',
    });

    // Inject keyframe once
    if (!document.getElementById('hmr-toast-style')) {
      const style = document.createElement('style');
      style.id = 'hmr-toast-style';
      style.textContent = `
        @keyframes hmr-toast-in {
          from { opacity: 0; transform: translateX(-50%) translateY(12px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    toast.querySelector('#hmr-refresh').onclick = () => location.reload();
    toast.querySelector('#hmr-dismiss').onclick = () => { toast.remove(); toastShown = false; };
  };

  window.addEventListener('error', (e) => {
    if (e.message && HMR_PATTERNS.some(p => e.message.includes(p))) showHmrToast();
  });

  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message || String(e.reason || '');
    if (HMR_PATTERNS.some(p => msg.includes(p))) showHmrToast();
  });
}

// ── App mount ────────────────────────────────────────────────
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>
);
