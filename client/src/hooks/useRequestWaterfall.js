import { useState, useRef, useCallback, useEffect } from 'react';
import { setRequestTracker } from '../api/http.js';

const MAX_REQUESTS = 500;
const STORAGE_KEY = 'qbo-waterfall-requests';
const THRESHOLD_KEY = 'qbo-waterfall-slow-ms';
const PERSIST_KEY = 'qbo-waterfall-persist';
const DEFAULT_SLOW_MS = 500;

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

  // Restore persisted requests on mount (only completed ones — in-flight state is meaningless)
  const restoredRef = useRef(null);
  if (restoredRef.current === null) {
    const saved = persist ? loadJSON(STORAGE_KEY, []) : [];
    restoredRef.current = saved.filter(r => r.state === 'complete' || r.state === 'error' || r.state === 'aborted');
  }

  const requestsRef = useRef(restoredRef.current);
  const [requests, setRequests] = useState(restoredRef.current);
  const nextIdRef = useRef(restoredRef.current.length + 1);
  const rafRef = useRef(null);
  const dirtyRef = useRef(false);
  const slowThresholdRef = useRef(slowThreshold);

  // Keep ref in sync so tracker closures see latest value
  useEffect(() => { slowThresholdRef.current = slowThreshold; }, [slowThreshold]);

  // Persist threshold + persist toggle to localStorage
  useEffect(() => { saveJSON(THRESHOLD_KEY, slowThreshold); }, [slowThreshold]);
  useEffect(() => { saveJSON(PERSIST_KEY, persist); }, [persist]);

  // Save request buffer to localStorage (debounced via rAF — only completed entries)
  const persistIfEnabled = useCallback(() => {
    if (!persist) return;
    const completed = requestsRef.current.filter(r => r.state === 'complete' || r.state === 'error' || r.state === 'aborted');
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
    start({ url, method, startTime }) {
      const id = `req-${nextIdRef.current++}`;
      const shortUrl = url.split('?')[0].replace('/api/', '');
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
      };
      const arr = requestsRef.current;
      requestsRef.current = arr.length >= MAX_REQUESTS
        ? [...arr.slice(-(MAX_REQUESTS - 1)), entry]
        : [...arr, entry];
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
    };
  }, [enabled, tracker]);

  const clearRequests = useCallback(() => {
    requestsRef.current = [];
    nextIdRef.current = 1;
    _notifiedIds.clear();
    setRequests([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ok */ }
  }, []);

  return {
    requests, clearRequests, enabled, setEnabled,
    slowThreshold, setSlowThreshold,
    persist, setPersist,
  };
}
