import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastContext = createContext(null);

let _nextId = 1;
const MAX_VISIBLE = 3;
const DEFAULT_DURATION_MS = 5000;

const ICONS = {
  error: '!',
  success: '\u2713',
  warning: '\u26A0',
  info: '\u2139',
};

function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast--${t.type}`}>
          <span className="toast-icon">{ICONS[t.type]}</span>
          <span className="toast-message">{t.message}</span>
          <button className="toast-dismiss" onClick={() => onDismiss(t.id)} aria-label="Dismiss" type="button">
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timersRef.current.get(id));
    timersRef.current.delete(id);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback(({ type = 'info', message, duration = DEFAULT_DURATION_MS }) => {
    const id = _nextId++;
    const toast = { id, type, message, createdAt: Date.now() };
    setToasts(prev => {
      const next = [...prev, toast];
      while (next.length > MAX_VISIBLE) {
        const evicted = next.shift();
        clearTimeout(timersRef.current.get(evicted.id));
        timersRef.current.delete(evicted.id);
      }
      return next;
    });
    if (duration > 0) {
      timersRef.current.set(id, setTimeout(() => dismiss(id), duration));
    }
    return id;
  }, [dismiss]);

  const toast = {
    error:   (message, opts) => addToast({ type: 'error',   message, ...opts }),
    success: (message, opts) => addToast({ type: 'success', message, ...opts }),
    warning: (message, opts) => addToast({ type: 'warning', message, ...opts }),
    info:    (message, opts) => addToast({ type: 'info',    message, ...opts }),
    dismiss,
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
