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
  for (const fn of _circuitListeners) fn(state);
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
  for (const fn of _budgetListeners) fn(state);
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
  return _trackedFetch(url, method, options, _fetchMutationWithRetry(url, options));
}

// ---- internal ---------------------------------------------------------------

/**
 * Bounded retry loop for GET requests with circuit breaker.
 * Retries on 5xx responses. Does NOT retry on timeouts (AbortError) or 4xx.
 */
async function _fetchWithRetry(url, options) {
  if (_isCircuitOpen()) {
    throw new Error('Service temporarily unavailable');
  }

  let lastError;
  for (let attempt = 0; attempt <= MAX_GET_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, _jitteredDelay(attempt)));
    }
    try {
      const res = await _fetchWithTimeout(url, options);
      if (res.ok || res.status < 500) {
        _recordSuccess();
        return res;
      }
      // 5xx — retriable server error
      lastError = new Error(`HTTP ${res.status}`);
      _recordFailure();
    } catch (err) {
      lastError = err;
      _recordFailure();
      if (err.name === 'AbortError') break; // Timeout — don't retry
    }
  }
  throw lastError;
}

/**
 * Single retry for mutation requests (POST/PATCH/DELETE) on 5xx.
 * Does NOT retry on 4xx (client errors) or AbortError (timeout/cancel).
 * Does NOT participate in the circuit breaker.
 */
async function _fetchMutationWithRetry(url, options) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_MUTATION_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, _jitteredDelay(attempt)));
    }
    try {
      const res = await _fetchWithTimeout(url, options);
      if (res.ok || res.status < 500) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (err.name === 'AbortError') break;
    }
  }
  throw lastError;
}

function _fetchWithTimeout(url, options) {
  // If the caller already manages its own signal, don't layer a second one.
  if (options.signal) return fetch(url, options);

  const controller = new AbortController();
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

/**
 * Wraps a fetch promise with tracker lifecycle events.
 * If no tracker is registered, returns the promise as-is.
 */
function _trackedFetch(url, method, options, fetchPromise) {
  const tracker = _tracker;
  if (!tracker) return fetchPromise;

  const id = tracker.start({ url, method, startTime: performance.now(), options });

  return fetchPromise.then(
    (res) => {
      const contentType = res.headers.get('content-type') || '';
      const isSSE = contentType.includes('text/event-stream');

      tracker.headersReceived(id, {
        status: res.status,
        ok: res.ok,
        headersTime: performance.now(),
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
                    tracker.complete(id, { endTime: performance.now() });
                    controller.close();
                    return;
                  }
                  controller.enqueue(value);
                  pump();
                }).catch((err) => {
                  tracker.error(id, { endTime: performance.now(), error: err.message });
                  controller.error(err);
                });
              })();
            },
          }),
          { status: res.status, statusText: res.statusText, headers: res.headers },
        );
      }

      // Non-SSE: mark complete immediately after headers.
      // Body download for JSON API responses is negligible (<5ms), and
      // the previous approach (res.clone().text()) silently hung when the
      // tee'd body stream stalled, leaving entries stuck in 'headers' state
      // with endlessly-growing durations.
      tracker.complete(id, { endTime: performance.now() });

      return res;
    },
    (err) => {
      const endTime = performance.now();
      if (err.name === 'AbortError') {
        tracker.abort(id, { endTime });
      } else {
        tracker.error(id, { endTime, error: err.message });
      }
      throw err;
    },
  );
}
