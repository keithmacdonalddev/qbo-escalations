// ---------------------------------------------------------------------------
// apiFetch — thin wrapper around fetch with six mechanisms:
//
// 1. Single-flight dedupe for GET requests
// 2. Auto-timeout for GET requests (default 15 s)
// 3. Bounded retries with exponential backoff + jitter (GET only, max 2)
// 4. Circuit breaker — stops sending requests after consecutive failures
// 5. Request tracking for the waterfall visualizer (optional)
// 6. Single retry for mutations (POST/PATCH/DELETE) on 5xx server errors
// ---------------------------------------------------------------------------

// ---- API error event system ------------------------------------------------
// Lets consumers subscribe to every non-ok response and network failure
// without monkeypatching fetch.

/** @type {Set<(event: object) => void>} */
const _errorListeners = new Set();

/**
 * Subscribe to API error events.
 * Callback receives `{ url, method, status, statusText, timestamp, type }`.
 * `type` is one of: 'server-error' (5xx), 'client-error' (4xx),
 * 'network-error' (fetch rejected), 'timeout' (AbortError).
 * Returns an unsubscribe function.
 */
export function onApiError(fn) {
  _errorListeners.add(fn);
  return () => _errorListeners.delete(fn);
}

function _notifyApiError(errorEvent) {
  for (const fn of _errorListeners) {
    try { fn(errorEvent); } catch {}
  }
}

/** @type {Map<string, Promise<Response>>} */
const _inFlight = new Map();

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_GET_RETRIES = 2;
const MAX_MUTATION_RETRIES = 1;

// ---- Circuit breaker --------------------------------------------------------
// After THRESHOLD consecutive GET failures, the circuit opens for RESET_MS.
// While open, GET requests fail immediately without network cost.
// After RESET_MS, one request is allowed through (half-open). If it succeeds,
// the circuit resets. If it fails, the circuit re-opens.

const _circuit = {
  failures: 0,
  openUntil: 0,
  THRESHOLD: 5,
  RESET_MS: 30_000,
};

function _isCircuitOpen() {
  if (_circuit.failures < _circuit.THRESHOLD) return false;
  if (Date.now() > _circuit.openUntil) {
    // Half-open: allow one attempt through
    _circuit.failures = _circuit.THRESHOLD - 1;
    return false;
  }
  return true;
}

function _recordSuccess() {
  const was = _circuit.failures;
  _circuit.failures = 0;
  if (was > 0) _notifyCircuit();
}

function _recordFailure() {
  _circuit.failures++;
  if (_circuit.failures >= _circuit.THRESHOLD) {
    _circuit.openUntil = Date.now() + _circuit.RESET_MS;
  }
  _notifyCircuit();
}

// ---- Circuit state subscription ------------------------------------------------
// Lets UI components (e.g. Sidebar) observe the circuit breaker without polling.

/** @type {Set<(state: {status: string, failures: number}) => void>} */
const _circuitListeners = new Set();

function _getCircuitStatus() {
  if (_circuit.failures >= _circuit.THRESHOLD && Date.now() <= _circuit.openUntil) return 'open';
  if (_circuit.failures > 0) return 'degraded';
  return 'closed';
}

function _notifyCircuit() {
  const state = { status: _getCircuitStatus(), failures: _circuit.failures };
  for (const fn of _circuitListeners) {
    try { fn(state); } catch { /* listener error */ }
  }
  _notifyBudget();
}

/**
 * Subscribe to circuit breaker state changes.
 * Callback receives `{ status: 'closed' | 'degraded' | 'open', failures: number }`.
 * Returns an unsubscribe function.
 */
export function onCircuitChange(fn) {
  _circuitListeners.add(fn);
  fn({ status: _getCircuitStatus(), failures: _circuit.failures }); // immediate sync
  return () => _circuitListeners.delete(fn);
}

// ---- Budget tracking (in-flight + dedup + circuit snapshot) ------------------
// Lets the waterfall observe request containment mechanisms in real time.

let _dedupSaves = 0;

/** @type {Set<(state: object) => void>} */
const _budgetListeners = new Set();

function _getBudgetState() {
  return {
    inFlight: _inFlight.size,
    dedupSaves: _dedupSaves,
    circuit: _getCircuitStatus(),
    failures: _circuit.failures,
    threshold: _circuit.THRESHOLD,
  };
}

function _notifyBudget() {
  const state = _getBudgetState();
  for (const fn of _budgetListeners) {
    try { fn(state); } catch { /* listener error */ }
  }
}

/**
 * Subscribe to request budget state changes.
 * Callback receives `{ inFlight, dedupSaves, circuit, failures, threshold }`.
 * Returns an unsubscribe function.
 */
export function onBudgetChange(fn) {
  _budgetListeners.add(fn);
  fn(_getBudgetState());
  return () => _budgetListeners.delete(fn);
}

/** Reset dedup counter (called when waterfall is cleared). */
export function resetBudgetCounters() {
  _dedupSaves = 0;
  _notifyBudget();
}

/** Exponential backoff with full jitter: base * 2^(attempt-1) + random */
function _jitteredDelay(attempt) {
  const base = 500 * Math.pow(2, attempt - 1);
  return base + Math.random() * base;
}

// ---- Request tracking -------------------------------------------------------

/** @type {{ start, headersReceived, complete, error, abort } | null} */
let _tracker = null;

/**
 * Register a tracker that receives lifecycle events for every request.
 * Pass null to disable tracking.
 */
export function setRequestTracker(tracker) {
  _tracker = tracker;
}

// ---- Request event listeners ------------------------------------------------
// Parallel subscription system so multiple consumers (waterfall UI, insights
// hook, etc.) can observe request lifecycle events without fighting over the
// single _tracker slot. Listeners receive lightweight event objects.

/** @type {Set<(event: object) => void>} */
const _requestListeners = new Set();

/** @type {Map<string, object>} */
const _activeRequests = new Map();

/** @type {Set<(snapshot: object[]) => void>} */
const _activeRequestListeners = new Set();

/**
 * Subscribe to request lifecycle events.
 * Callback receives `{ phase, id, url, method, status, duration, state, isSSE, error, startTime }`.
 * `phase` is one of: 'start', 'headers', 'complete', 'error', 'abort'.
 * Returns an unsubscribe function.
 */
export function onRequestEvent(fn) {
  _requestListeners.add(fn);
  return () => _requestListeners.delete(fn);
}

function _notifyRequestEvent(event) {
  for (const fn of _requestListeners) {
    try { fn(event); } catch {}
  }
}

function _cloneActiveRequest(entry) {
  const now = Date.now();
  return {
    id: entry.id,
    url: entry.url,
    method: entry.method,
    phase: entry.phase,
    status: entry.status,
    isSSE: !!entry.isSSE,
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
    ageMs: now - entry.startedAt,
    idleMs: now - entry.updatedAt,
  };
}

function _getActiveRequestSnapshot() {
  return [..._activeRequests.values()]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(_cloneActiveRequest);
}

function _notifyActiveRequests() {
  const snapshot = _getActiveRequestSnapshot();
  for (const fn of _activeRequestListeners) {
    try { fn(snapshot); } catch {}
  }
}

function _trackActiveRequestStart(id, { url, method }) {
  const now = Date.now();
  _activeRequests.set(id, {
    id,
    url,
    method,
    phase: 'start',
    status: null,
    isSSE: false,
    startedAt: now,
    updatedAt: now,
  });
  _notifyActiveRequests();
}

function _trackActiveRequestUpdate(id, patch = {}) {
  const entry = _activeRequests.get(id);
  if (!entry) return;
  if (patch.phase !== undefined) entry.phase = patch.phase;
  if (patch.status !== undefined) entry.status = patch.status;
  if (patch.isSSE !== undefined) entry.isSSE = !!patch.isSSE;
  entry.updatedAt = Date.now();
  _notifyActiveRequests();
}

function _trackActiveRequestEnd(id) {
  if (_activeRequests.delete(id)) {
    _notifyActiveRequests();
  }
}

export function onActiveRequestsChange(fn) {
  _activeRequestListeners.add(fn);
  fn(_getActiveRequestSnapshot());
  return () => _activeRequestListeners.delete(fn);
}

export function getActiveRequestsSnapshot() {
  return _getActiveRequestSnapshot();
}

// ---- public -----------------------------------------------------------------

/**
 * Drop-in replacement for `fetch()` with GET deduplication, auto-timeout,
 * bounded retries, circuit breaker, and optional request tracking.
 *
 * @param {string} url
 * @param {RequestInit & { timeout?: number }} options
 * @returns {Promise<Response>}
 */
export function apiFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();

  // --- Single-flight dedupe for GETs ---
  if (method === 'GET') {
    if (_inFlight.has(url)) {
      _dedupSaves++;
      _notifyBudget();
      if (_requestListeners.size > 0) {
        _notifyRequestEvent({ phase: 'dedup', url, method, startTime: performance.now() });
      }
      return _inFlight.get(url).then(r => r.clone());
    }

    const p = _trackedFetch(url, method, options, _fetchWithRetry(url, options))
      .finally(() => { _inFlight.delete(url); _notifyBudget(); });
    _inFlight.set(url, p);
    _notifyBudget();
    return p.then(r => r.clone());
  }

  // Non-GET requests (POST, PATCH, DELETE) get a single retry on 5xx.
  // SSE / streaming callers already attach their own AbortController signal.
  // Callers can pass `noRetry: true` to skip mutation retry (e.g. long-running
  // vision inference where a retry would waste time and provider tokens).
  if (options.noRetry) {
    return _trackedFetch(url, method, options, _fetchWithTimeout(url, options));
  }
  return _trackedFetch(url, method, options, _fetchMutationWithRetry(url, options));
}

// ---- internal ---------------------------------------------------------------

/**
 * Bounded retry loop for GET requests with circuit breaker.
 * Retries on 5xx responses. Does NOT retry on timeouts (AbortError) or 4xx.
 */
async function _fetchWithRetry(url, options) {
  const method = (options.method || 'GET').toUpperCase();

  if (_isCircuitOpen()) {
    throw new Error('Service temporarily unavailable');
  }

  let lastError;
  let lastStatus = 0;
  let lastStatusText = '';
  for (let attempt = 0; attempt <= MAX_GET_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, _jitteredDelay(attempt)));
    }
    try {
      const res = await _fetchWithTimeout(url, options);
      if (res.ok) {
        _recordSuccess();
        return res;
      }
      if (res.status < 500) {
        // 4xx — not retriable, notify immediately
        _recordSuccess();
        _notifyApiError({
          url, method, status: res.status, statusText: res.statusText,
          timestamp: Date.now(), type: 'client-error',
        });
        return res;
      }
      // 5xx — retriable server error
      lastError = new Error(`HTTP ${res.status}`);
      lastStatus = res.status;
      lastStatusText = res.statusText;
      _recordFailure();
    } catch (err) {
      lastError = err;
      _recordFailure();
      if (err.name === 'AbortError') {
        _notifyApiError({
          url, method, status: 0, statusText: err.message,
          timestamp: Date.now(), type: 'timeout',
        });
        break; // Timeout — don't retry
      }
    }
  }
  // Final failure after retries exhausted — notify
  if (lastError) {
    const isAbort = lastError.name === 'AbortError';
    if (!isAbort) {
      _notifyApiError({
        url, method, status: lastStatus, statusText: lastStatusText || lastError.message,
        timestamp: Date.now(), type: lastStatus >= 500 ? 'server-error' : 'network-error',
      });
    }
  }
  throw lastError;
}

/**
 * Single retry for mutation requests (POST/PATCH/DELETE) on 5xx.
 * Does NOT retry on 4xx (client errors) or AbortError (timeout/cancel).
 * Does NOT participate in the circuit breaker.
 * On final 5xx failure, returns the response so callers can read the body.
 */
async function _fetchMutationWithRetry(url, options) {
  const method = (options.method || 'POST').toUpperCase();
  let lastError;
  let lastResponse;
  let lastStatus = 0;
  let lastStatusText = '';
  for (let attempt = 0; attempt <= MAX_MUTATION_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, _jitteredDelay(attempt)));
    }
    try {
      const res = await _fetchWithTimeout(url, options);
      if (res.ok) return res;
      if (res.status < 500) {
        // 4xx — not retriable, notify immediately
        _notifyApiError({
          url, method, status: res.status, statusText: res.statusText,
          timestamp: Date.now(), type: 'client-error',
        });
        return res;
      }
      // 5xx — retriable server error, keep reference to response
      lastResponse = res;
      lastError = new Error(`HTTP ${res.status}`);
      lastStatus = res.status;
      lastStatusText = res.statusText;
    } catch (err) {
      lastError = err;
      lastResponse = null;
      if (err.name === 'AbortError') {
        _notifyApiError({
          url, method, status: 0, statusText: err.message,
          timestamp: Date.now(), type: 'timeout',
        });
        break;
      }
    }
  }
  // Final failure after retries exhausted — notify
  if (lastError) {
    const isAbort = lastError.name === 'AbortError';
    if (!isAbort) {
      _notifyApiError({
        url, method, status: lastStatus, statusText: lastStatusText || lastError.message,
        timestamp: Date.now(), type: lastStatus >= 500 ? 'server-error' : 'network-error',
      });
    }
  }
  // Return the last 5xx response so callers can read the error body,
  // instead of throwing a bare Error("HTTP 500") that loses the message.
  if (lastResponse) return lastResponse;
  throw lastError;
}

function _fetchWithTimeout(url, options) {
  const externalSignal = options.signal;
  const controller = new AbortController();
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let removeAbortListener = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      const onAbort = () => controller.abort();
      externalSignal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => {
        try { externalSignal.removeEventListener('abort', onAbort); } catch {}
      };
    }
  }

  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => {
      clearTimeout(timer);
      removeAbortListener?.();
    });
}

/**
 * Wraps a fetch promise with tracker lifecycle events and request listeners.
 * Tracker is optional (waterfall UI); listeners always fire (insights hook).
 */
function _trackedFetch(url, method, options, fetchPromise) {
  const tracker = _tracker;
  const hasListeners = _requestListeners.size > 0;
  if (!tracker && !hasListeners) return fetchPromise;

  const startTime = performance.now();
  const id = tracker
    ? tracker.start({ url, method, startTime, options })
    : `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  if (hasListeners) {
    _notifyRequestEvent({ phase: 'start', id, url, method, startTime });
  }
  _trackActiveRequestStart(id, { url, method });

  return fetchPromise.then(
    (res) => {
      const contentType = res.headers.get('content-type') || '';
      const isSSE = contentType.includes('text/event-stream');
      const headersTime = performance.now();

      if (tracker) {
        tracker.headersReceived(id, { status: res.status, ok: res.ok, headersTime, isSSE });
      }
      if (hasListeners) {
        _notifyRequestEvent({ phase: 'headers', id, url, method, status: res.status, isSSE, startTime });
      }
      _trackActiveRequestUpdate(id, {
        phase: isSSE ? 'streaming' : 'headers',
        status: res.status,
        isSSE,
      });

      if (isSSE && res.body) {
        // Wrap the ReadableStream so we detect when SSE consumption finishes.
        // consumeSSEStream() in sse.js calls res.body.getReader() — the
        // wrapped stream is a transparent drop-in replacement.
        const origGetReader = res.body.getReader.bind(res.body);
        return new Response(
          new ReadableStream({
            start(controller) {
              const reader = origGetReader();
              (function pump() {
                reader.read().then(({ done, value }) => {
                  if (done) {
                    const endTime = performance.now();
                    if (tracker) tracker.complete(id, { endTime });
                    if (hasListeners) {
                      _notifyRequestEvent({ phase: 'complete', id, url, method, status: res.status, isSSE: true, duration: endTime - startTime, startTime });
                    }
                    _trackActiveRequestEnd(id);
                    controller.close();
                    return;
                  }
                  controller.enqueue(value);
                  pump();
                }).catch((err) => {
                  const endTime = performance.now();
                  if (tracker) tracker.error(id, { endTime, error: err.message });
                  if (hasListeners) {
                    _notifyRequestEvent({ phase: 'error', id, url, method, status: res.status, isSSE: true, error: err.message, duration: endTime - startTime, startTime });
                  }
                  _trackActiveRequestEnd(id);
                  controller.error(err);
                });
              })();
            },
          }),
          { status: res.status, statusText: res.statusText, headers: res.headers },
        );
      }

      // Non-SSE: mark complete immediately after headers.
      const endTime = performance.now();
      if (tracker) tracker.complete(id, { endTime });
      if (hasListeners) {
        _notifyRequestEvent({ phase: 'complete', id, url, method, status: res.status, isSSE: false, duration: endTime - startTime, startTime });
      }
      _trackActiveRequestEnd(id);

      return res;
    },
    (err) => {
      const endTime = performance.now();
      if (err.name === 'AbortError') {
        if (tracker) tracker.abort(id, { endTime });
        if (hasListeners) {
          _notifyRequestEvent({ phase: 'abort', id, url, method, duration: endTime - startTime, startTime });
        }
      } else {
        if (tracker) tracker.error(id, { endTime, error: err.message });
        if (hasListeners) {
          _notifyRequestEvent({ phase: 'error', id, url, method, error: err.message, duration: endTime - startTime, startTime });
        }
      }
      _trackActiveRequestEnd(id);
      throw err;
    },
  );
}
