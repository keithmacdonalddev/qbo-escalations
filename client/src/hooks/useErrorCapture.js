import { useEffect, useRef } from 'react';

/**
 * Captures runtime errors (window.onerror) and unhandled promise rejections,
 * deduplicates them, and flushes coalesced batches to a callback.
 *
 * @param {object}   opts
 * @param {boolean}  opts.enabled   Whether capture is active (default true)
 * @param {(errors: CoalescedError[]) => void} opts.onErrors  Flush callback
 * @param {number}   [opts.debounceMs=500]   Flush debounce window
 * @param {number}   [opts.dedupeWindowMs=30000]  Per-hash dedup window
 *
 * @typedef {object} CoalescedError
 * @property {string} message
 * @property {string} stack
 * @property {string} source
 * @property {number} line
 * @property {number} col
 * @property {number} timestamp
 * @property {string} hash
 * @property {number} count
 */
export function useErrorCapture({
  enabled = true,
  onErrors,
  debounceMs = 500,
  dedupeWindowMs = 30_000,
} = {}) {
  const errorQueueRef = useRef([]);
  const dedupeMapRef = useRef(new Map()); // hash -> last-seen timestamp
  const flushTimerRef = useRef(null);
  const onErrorsRef = useRef(onErrors);

  // Keep callback ref fresh without re-registering listeners
  useEffect(() => { onErrorsRef.current = onErrors; }, [onErrors]);

  useEffect(() => {
    if (!enabled) return;

    function errorHash(msg, source, line) {
      return `${msg}|${source || ''}|${line || ''}`;
    }

    function scheduleFlush() {
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        const errors = errorQueueRef.current.splice(0);
        if (errors.length > 0 && onErrorsRef.current) {
          onErrorsRef.current(coalesceErrors(errors));
        }
      }, debounceMs);
    }

    function handleError(event) {
      const { message, filename, lineno, colno, error } = event;
      const hash = errorHash(message, filename, lineno);

      // Dedup: skip if same hash seen within window
      const lastSeen = dedupeMapRef.current.get(hash);
      if (lastSeen && Date.now() - lastSeen < dedupeWindowMs) return;
      dedupeMapRef.current.set(hash, Date.now());

      errorQueueRef.current.push({
        message,
        stack: error?.stack || '',
        source: filename || '',
        line: lineno || 0,
        col: colno || 0,
        timestamp: Date.now(),
        hash,
      });

      scheduleFlush();
    }

    function handleRejection(event) {
      const reason = event.reason;
      const message = reason?.message || String(reason);
      const stack = reason?.stack || '';
      const hash = errorHash(message, '', '');

      const lastSeen = dedupeMapRef.current.get(hash);
      if (lastSeen && Date.now() - lastSeen < dedupeWindowMs) return;
      dedupeMapRef.current.set(hash, Date.now());

      errorQueueRef.current.push({
        message,
        stack,
        source: '',
        line: 0,
        col: 0,
        timestamp: Date.now(),
        hash,
      });

      scheduleFlush();
    }

    // Prune stale dedup entries every 60s to prevent unbounded Map growth
    const pruneInterval = setInterval(() => {
      const now = Date.now();
      for (const [hash, ts] of dedupeMapRef.current) {
        if (now - ts > dedupeWindowMs) dedupeMapRef.current.delete(hash);
      }
    }, 60_000);

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      clearInterval(pruneInterval);
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      // Discard remaining errors on teardown — flushing during unmount
      // would trigger state updates on unmounted components via the
      // sendBackground chain.
      errorQueueRef.current.length = 0;
    };
  }, [enabled, debounceMs, dedupeWindowMs]);
}

/**
 * Group errors by hash and add occurrence counts.
 */
function coalesceErrors(errors) {
  const groups = new Map();
  for (const err of errors) {
    const existing = groups.get(err.hash);
    if (existing) {
      existing.count++;
      // Keep the most recent timestamp
      if (err.timestamp > existing.timestamp) {
        existing.timestamp = err.timestamp;
      }
    } else {
      groups.set(err.hash, { ...err, count: 1 });
    }
  }
  return [...groups.values()];
}
