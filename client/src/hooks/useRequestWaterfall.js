import { useState, useRef, useCallback, useEffect } from 'react';
import { setRequestTracker } from '../api/http.js';

const MAX_REQUESTS = 100;

/**
 * Manages a ring buffer of tracked HTTP requests for the waterfall visualizer.
 * Connects to apiFetch() via setRequestTracker() to capture all API traffic.
 */
export function useRequestWaterfall() {
  const requestsRef = useRef([]);
  const [requests, setRequests] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const nextIdRef = useRef(1);
  const rafRef = useRef(null);
  const dirtyRef = useRef(false);

  // Coalesce mutations into one React render per animation frame
  const scheduleFlush = useCallback(() => {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
      dirtyRef.current = false;
      setRequests([...requestsRef.current]);
    });
  }, []);

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
    setRequests([]);
  }, []);

  return { requests, clearRequests, enabled, setEnabled };
}
