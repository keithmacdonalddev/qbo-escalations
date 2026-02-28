// ---------------------------------------------------------------------------
// apiFetch — thin wrapper around fetch with five mechanisms:
//
// 1. Single-flight dedupe for GET requests
// 2. Auto-timeout for GET requests (default 15 s)
// 3. Bounded retries with exponential backoff + jitter (GET only, max 2)
// 4. Circuit breaker — stops sending requests after consecutive failures
// 5. Request tracking for the waterfall visualizer (optional)
// ---------------------------------------------------------------------------

/** @type {Map<string, Promise<Response>>} */
const _inFlight = new Map();

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_GET_RETRIES = 2;

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
    if (_inFlight.has(url)) return _inFlight.get(url);

    const p = _trackedFetch(url, method, options, _fetchWithRetry(url, options))
      .finally(() => _inFlight.delete(url));
    _inFlight.set(url, p);
    return p;
  }

  // Non-GET requests (POST, PATCH, DELETE) pass through directly.
  // SSE / streaming callers already attach their own AbortController signal.
  return _trackedFetch(url, method, options, fetch(url, options));
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

      // Non-SSE: clone and consume in background to detect body completion.
      // The original response passes through untouched.
      res.clone().text().then(
        () => tracker.complete(id, { endTime: performance.now() }),
        () => tracker.complete(id, { endTime: performance.now() }),
      );

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
