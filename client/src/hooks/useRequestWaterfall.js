import { useState, useRef, useCallback, useEffect } from 'react';
import { setRequestTracker, apiFetch, onBudgetChange, resetBudgetCounters } from '../api/http.js';

const MAX_REQUESTS = 500;
const STORAGE_KEY = 'qbo-waterfall-requests';
const THRESHOLD_KEY = 'qbo-waterfall-slow-ms';
const PERSIST_KEY = 'qbo-waterfall-persist';
const DEFAULT_SLOW_MS = 500;
const DUPLICATE_WINDOW_MS = 100;
const DUPLICATE_BADGE_DURATION_MS = 3000;

// ── localStorage helpers (silent on quota errors) ────────────

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

// ── Slow-request notification (fires once per request) ───────

const _notifiedIds = new Set();

function notifySlow(req, duration) {
  if (_notifiedIds.has(req.id)) return;
  _notifiedIds.add(req.id);
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.hasFocus()) return; // only notify when tab is backgrounded
  const ms = duration < 1000 ? `${Math.round(duration)}ms` : `${(duration / 1000).toFixed(1)}s`;
  new Notification('Slow request', {
    body: `${req.method} ${req.url.split('?')[0].replace('/api/', '')} — ${ms}`,
    tag: req.id, // dedup
  });
}

/**
 * Manages a persistent buffer of tracked HTTP requests for the waterfall.
 * Connects to apiFetch() via setRequestTracker() to capture all API traffic.
 *
 * - Up to 500 entries, oldest evicted
 * - Optional localStorage persistence across sessions
 * - Configurable slow-request threshold with browser notifications
 */
export function useRequestWaterfall() {
  const [persist, setPersist] = useState(() => loadJSON(PERSIST_KEY, false));
  const [slowThreshold, setSlowThreshold] = useState(() => loadJSON(THRESHOLD_KEY, DEFAULT_SLOW_MS));
  const [enabled, setEnabled] = useState(true);
  const [budget, setBudget] = useState({ inFlight: 0, dedupSaves: 0, circuit: 'closed', failures: 0, threshold: 5 });

  // Restore persisted requests on mount (only completed ones — in-flight state is meaningless)
  const restoredRef = useRef(null);
  if (restoredRef.current === null) {
    const saved = persist ? loadJSON(STORAGE_KEY, []) : [];
    restoredRef.current = saved.filter(r => r.state === 'complete' || r.state === 'error' || r.state === 'aborted');
  }

  const requestsRef = useRef(restoredRef.current);
  const [requests, setRequests] = useState(restoredRef.current);
  const nextIdRef = useRef((() => {
    if (restoredRef.current.length === 0) return 1;
    const maxId = Math.max(...restoredRef.current.map(r => {
      const num = parseInt(r.id.slice(4), 10);
      return isNaN(num) ? 0 : num;
    }));
    return maxId + 1;
  })());
  const rafRef = useRef(null);
  const dirtyRef = useRef(false);
  const slowThresholdRef = useRef(slowThreshold);

  // Keep ref in sync so tracker closures see latest value
  useEffect(() => { slowThresholdRef.current = slowThreshold; }, [slowThreshold]);

  // Persist threshold + persist toggle to localStorage
  useEffect(() => { saveJSON(THRESHOLD_KEY, slowThreshold); }, [slowThreshold]);
  useEffect(() => { saveJSON(PERSIST_KEY, persist); }, [persist]);

  // Save request buffer to localStorage (debounced via rAF — only completed entries)
  // Strip _options before persisting — they can contain large bodies (images)
  const persistIfEnabled = useCallback(() => {
    if (!persist) return;
    const completed = requestsRef.current
      .filter(r => r.state === 'complete' || r.state === 'error' || r.state === 'aborted')
      .map(({ _options, ...rest }) => rest);
    saveJSON(STORAGE_KEY, completed);
  }, [persist]);

  // Coalesce mutations into one React render per animation frame
  const scheduleFlush = useCallback(() => {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
      dirtyRef.current = false;
      setRequests([...requestsRef.current]);
      persistIfEnabled();
    });
  }, [persistIfEnabled]);

  // Stable tracker object — mutates entries in-place for perf
  const tracker = useRef({
    start({ url, method, startTime, options }) {
      const id = `req-${nextIdRef.current++}`;
      const shortUrl = url.split('?')[0].replace('/api/', '');
      const endpoint = url.split('?')[0]; // full endpoint without query params
      const entry = {
        id,
        url,
        method,
        startTime,
        headersTime: null,
        endTime: null,
        status: null,
        ok: null,
        state: 'pending',
        isSSE: false,
        error: null,
        label: `${method} ${shortUrl}`,
        _options: options || null, // kept in memory only, stripped before persist
        isDuplicate: false,
        duplicateClearTimer: null,
      };

      // Check for duplicates within 100ms window
      const arr = requestsRef.current;
      for (let i = arr.length - 1; i >= 0 && arr.length > 0; i--) {
        const prev = arr[i];
        if (prev.method === method && prev.url.split('?')[0] === endpoint) {
          const timeDiff = startTime - prev.startTime;
          if (timeDiff >= 0 && timeDiff <= DUPLICATE_WINDOW_MS) {
            entry.isDuplicate = true;
            break;
          }
        }
        // Stop checking once we're outside the time window
        if (startTime - prev.startTime > DUPLICATE_WINDOW_MS) {
          break;
        }
      }

      const updatedArr = arr.length >= MAX_REQUESTS
        ? [...arr.slice(-(MAX_REQUESTS - 1)), entry]
        : [...arr, entry];
      requestsRef.current = updatedArr;

      // Set timer to clear duplicate flag after 3 seconds
      if (entry.isDuplicate) {
        entry.duplicateClearTimer = setTimeout(() => {
          const req = requestsRef.current.find(r => r.id === id);
          if (req) {
            req.isDuplicate = false;
            scheduleFlush();
          }
        }, DUPLICATE_BADGE_DURATION_MS);
      }

      scheduleFlush();
      return id;
    },

    headersReceived(id, { status, ok, headersTime, isSSE }) {
      const req = requestsRef.current.find(r => r.id === id);
      if (!req) return;
      req.headersTime = headersTime;
      req.status = status;
      req.ok = ok;
      req.isSSE = isSSE;
      req.state = isSSE ? 'streaming' : 'headers';
      scheduleFlush();
    },

    complete(id, { endTime }) {
      const req = requestsRef.current.find(r => r.id === id);
      if (!req) return;
      req.endTime = endTime;
      req.state = 'complete';
      const dur = endTime - req.startTime;
      if (slowThresholdRef.current > 0 && dur > slowThresholdRef.current) {
        notifySlow(req, dur);
      }
      scheduleFlush();
    },

    error(id, { endTime, error }) {
      const req = requestsRef.current.find(r => r.id === id);
      if (!req) return;
      req.endTime = endTime;
      req.error = error || 'Unknown error';
      req.state = 'error';
      scheduleFlush();
    },

    abort(id, { endTime }) {
      const req = requestsRef.current.find(r => r.id === id);
      if (!req) return;
      req.endTime = endTime;
      req.state = 'aborted';
      scheduleFlush();
    },
  }).current;

  // Connect / disconnect tracker based on enabled flag
  useEffect(() => {
    if (enabled) {
      setRequestTracker(tracker);
    } else {
      setRequestTracker(null);
    }
    return () => {
      setRequestTracker(null);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // Clean up all duplicate timers on unmount
      for (const req of requestsRef.current) {
        if (req.duplicateClearTimer) {
          clearTimeout(req.duplicateClearTimer);
        }
      }
    };
  }, [enabled, tracker]);

  // Subscribe to budget state (in-flight, dedup, circuit)
  useEffect(() => onBudgetChange(setBudget), []);

  const clearRequests = useCallback(() => {
    // Clear all duplicate timers before clearing requests
    for (const req of requestsRef.current) {
      if (req.duplicateClearTimer) {
        clearTimeout(req.duplicateClearTimer);
      }
    }
    requestsRef.current = [];
    nextIdRef.current = 1;
    _notifiedIds.clear();
    setRequests([]);
    resetBudgetCounters();
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ok */ }
  }, []);

  // Re-fire a completed request. The new request flows through apiFetch
  // and appears as a fresh entry in the waterfall.
  const replayRequest = useCallback((reqId) => {
    const req = requestsRef.current.find(r => r.id === reqId);
    if (!req) return;
    const { url, method, _options } = req;
    // Rebuild options — strip signal (stale AbortController) but keep body/headers/method
    const opts = { method };
    if (_options) {
      if (_options.body) opts.body = _options.body;
      if (_options.headers) opts.headers = _options.headers;
    }
    // Fire and forget — tracking will pick it up automatically
    apiFetch(url, opts).catch(() => { /* errors tracked by waterfall */ });
  }, []);

  return {
    requests, clearRequests, enabled, setEnabled,
    slowThreshold, setSlowThreshold,
    persist, setPersist,
    replayRequest,
    budget,
  };
}
