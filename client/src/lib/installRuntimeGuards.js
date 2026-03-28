import { isRuntimeStreaming } from './runtimeStreamingState.js';

function installRuntimeGuards({ isDev, hot }) {
  if (!isDev) return;

  const HMR_PATTERNS = [
    'Rendered fewer hooks than expected',
    'Rendered more hooks than expected',
    'change between renders',
    'Should have a queue',
    'invalid hook call',
    'Hooks conditionally',
  ];

  let toastEl = null;

  const saveDraftState = () => {
    try {
      const textarea = document.querySelector('.compose-body textarea');
      if (textarea?.value) sessionStorage.setItem('qbo-draft-input', textarea.value);
      const msgBox = document.querySelector('.chat-messages');
      if (msgBox) sessionStorage.setItem('qbo-draft-scroll', String(msgBox.scrollTop));
    } catch {
      // Ignore storage failures; reload protection should stay non-blocking.
    }
  };

  const showDesyncToast = () => {
    if (toastEl) return;

    const toast = document.createElement('div');
    toast.innerHTML = '<span>HMR desync</span>'
      + '<button id="hmr-refresh" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.2);color:#fff;padding:3px 10px;border-radius:5px;cursor:pointer;font-size:11px;margin-left:8px">Reload</button>';
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '16px',
      right: '16px',
      zIndex: '99999',
      background: 'rgba(30,30,30,0.9)',
      color: 'rgba(255,255,255,0.7)',
      padding: '6px 12px',
      borderRadius: '8px',
      fontSize: '11px',
      display: 'flex',
      alignItems: 'center',
      fontFamily: 'system-ui, sans-serif',
      boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
      transition: 'opacity 300ms ease',
    });
    document.body.appendChild(toast);
    toastEl = toast;

    toast.querySelector('#hmr-refresh').onclick = () => {
      try {
        sessionStorage.setItem('qbo-hmr-reload-at', String(Date.now()));
        saveDraftState();
      } catch {
        // Keep reload available even if draft persistence fails.
      }
      location.reload();
    };

    setTimeout(() => {
      if (toastEl !== toast) return;
      toast.style.opacity = '0';
      setTimeout(() => {
        toast.remove();
        toastEl = null;
      }, 300);
    }, 8000);
  };

  window.addEventListener('beforeunload', saveDraftState);

  if (hot) {
    hot.on('vite:beforeFullReload', saveDraftState);
  }

  {
    const realReload = location.reload.bind(location);
    let reloadDeferred = false;
    let deferToastEl = null;

    const showDeferToast = () => {
      if (deferToastEl) return;
      const el = document.createElement('div');
      el.id = 'qbo-reload-deferred-toast';
      el.textContent = 'Update queued — reloading after stream completes';
      Object.assign(el.style, {
        position: 'fixed',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '99999',
        background: 'rgba(30,30,30,0.92)',
        color: 'rgba(255,255,255,0.85)',
        padding: '8px 16px',
        borderRadius: '8px',
        fontSize: '12px',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
        border: '1px solid rgba(255,255,255,0.08)',
        pointerEvents: 'none',
      });
      document.body.appendChild(el);
      deferToastEl = el;
    };

    const removeDeferToast = () => {
      if (!deferToastEl) return;
      deferToastEl.remove();
      deferToastEl = null;
    };

    const guardedReload = function patchedReload() {
      if (isRuntimeStreaming()) {
        if (!reloadDeferred) {
          reloadDeferred = true;
          showDeferToast();
          const check = setInterval(() => {
            if (!isRuntimeStreaming()) {
              clearInterval(check);
              reloadDeferred = false;
              removeDeferToast();
              saveDraftState();
              realReload();
            }
          }, 500);
        }
        return;
      }
      realReload();
    };

    try {
      location.reload = guardedReload;
    } catch {
      // Some engines expose location.reload as read-only.
    }

    window.addEventListener('beforeunload', (event) => {
      if (isRuntimeStreaming() && reloadDeferred) {
        event.preventDefault();
      }
    });
  }

  window.addEventListener('qbo:session-recovered', () => {
    const el = document.createElement('div');
    el.textContent = 'Session restored';
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '99998',
      background: 'rgba(34,120,75,0.92)',
      color: '#fff',
      padding: '8px 16px',
      borderRadius: '8px',
      fontSize: '12px',
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

  window.addEventListener('error', (event) => {
    if (event.message && HMR_PATTERNS.some((pattern) => event.message.includes(pattern))) {
      showDesyncToast();
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const message = event.reason?.message || String(event.reason || '');
    if (HMR_PATTERNS.some((pattern) => message.includes(pattern))) {
      showDesyncToast();
    }
  });
}

export {
  installRuntimeGuards,
};
