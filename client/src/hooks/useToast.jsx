import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

const ToastContext = createContext(null);

let _nextId = 1;
const MAX_VISIBLE = 10;
const DEFAULT_DURATION_MS = 12000;
const EXIT_ANIMATION_MS = 650;
const ENTRY_QUEUE_DELAY_MS = 700;

const ICONS = {
  error: '!',
  success: '\u2713',
  warning: '\u26A0',
  info: '\u2139',
};

function ToastContainer({ toasts, onDismiss, onDismissAll }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container" role="status" aria-live="polite">
      <div className="toast-list-controls">
        <button className="toast-list-close" onClick={onDismissAll} type="button" aria-label="Close all notifications">
          Close
        </button>
      </div>
      {toasts.map(t => (
        <div key={t.id} className={`toast toast--${t.type}${t.dismissing ? ' toast-exit' : ''}`}>
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
  const exitTimersRef = useRef(new Map());
  const queuedToastsRef = useRef([]);
  const queueTimerRef = useRef(null);
  const toastsRef = useRef([]);

  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  const dismiss = useCallback((id) => {
    clearTimeout(timersRef.current.get(id));
    timersRef.current.delete(id);
    if (exitTimersRef.current.has(id)) return;
    setToasts(prev => {
      const next = prev.map(t => (t.id === id ? { ...t, dismissing: true } : t));
      toastsRef.current = next;
      return next;
    });
    const exitTimer = setTimeout(() => {
      exitTimersRef.current.delete(id);
      setToasts(prev => {
        const next = prev.filter(t => t.id !== id);
        toastsRef.current = next;
        return next;
      });
    }, EXIT_ANIMATION_MS);
    exitTimersRef.current.set(id, exitTimer);
  }, []);

  const showToastNow = useCallback((toast, duration) => {
    setToasts(prev => {
      const next = [...prev, toast];
      while (next.length > MAX_VISIBLE) {
        const evicted = next.shift();
        clearTimeout(timersRef.current.get(evicted.id));
        timersRef.current.delete(evicted.id);
        clearTimeout(exitTimersRef.current.get(evicted.id));
        exitTimersRef.current.delete(evicted.id);
      }
      toastsRef.current = next;
      return next;
    });
    if (duration > 0) {
      timersRef.current.set(toast.id, setTimeout(() => dismiss(toast.id), duration));
    }
  }, [dismiss]);

  const scheduleQueuedToast = useCallback(() => {
    if (queueTimerRef.current || queuedToastsRef.current.length === 0) return;
    queueTimerRef.current = setTimeout(() => {
      queueTimerRef.current = null;
      const next = queuedToastsRef.current.shift();
      if (next) {
        showToastNow(next.toast, next.duration);
      }
      scheduleQueuedToast();
    }, ENTRY_QUEUE_DELAY_MS);
  }, [showToastNow]);

  const addToast = useCallback(({ type = 'info', message, duration = DEFAULT_DURATION_MS, groupKey = '' }) => {
    const id = _nextId++;
    const toast = { id, type, message, groupKey, createdAt: Date.now() };
    const hasActiveQueue = Boolean(queueTimerRef.current) || queuedToastsRef.current.length > 0;
    const canShowImmediately = toastsRef.current.length === 0 && !hasActiveQueue;
    if (canShowImmediately) {
      showToastNow(toast, duration);
    } else {
      queuedToastsRef.current.push({ toast, duration });
      scheduleQueuedToast();
    }
    return id;
  }, [scheduleQueuedToast, showToastNow]);

  const dismissAll = useCallback(() => {
    queuedToastsRef.current = [];
    clearTimeout(queueTimerRef.current);
    queueTimerRef.current = null;
    const ids = toastsRef.current
      .filter(t => !t.dismissing)
      .map(t => t.id);
    ids.forEach(id => dismiss(id));
  }, [dismiss]);

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    for (const timer of exitTimersRef.current.values()) clearTimeout(timer);
    clearTimeout(queueTimerRef.current);
    timersRef.current.clear();
    exitTimersRef.current.clear();
    queuedToastsRef.current = [];
    queueTimerRef.current = null;
  }, []);

  const toast = {
    error:   (message, opts) => addToast({ type: 'error',   message, ...opts }),
    success: (message, opts) => addToast({ type: 'success', message, ...opts }),
    warning: (message, opts) => addToast({ type: 'warning', message, ...opts }),
    info:    (message, opts) => addToast({ type: 'info',    message, ...opts }),
    dismiss,
    dismissAll,
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} onDismissAll={dismissAll} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
