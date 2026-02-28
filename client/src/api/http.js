// ---------------------------------------------------------------------------
// apiFetch — thin wrapper around fetch with three mechanisms:
//
// 1. Single-flight dedupe for GET requests:
//    If a GET to the same URL is already in-flight, callers share the same
//    promise instead of issuing a duplicate network request.
//
// 2. Auto-timeout for GET requests (default 15 s):
//    Prevents hanging requests from accumulating when the backend is slow.
//    POST / SSE callers supply their own AbortController, so they are exempt.
//
// 3. Request tracking (optional):
//    When a tracker is registered via setRequestTracker(), every request's
//    lifecycle is recorded for the waterfall visualizer.
// ---------------------------------------------------------------------------

/** @type {Map<string, Promise<Response>>} */
const _inFlight = new Map();

const DEFAULT_TIMEOUT_MS = 15_000;

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
 * and optional request tracking.
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

    const p = _trackedFetch(url, method, _fetchWithTimeout(url, options))
      .finally(() => _inFlight.delete(url));
    _inFlight.set(url, p);
    return p;
  }

  // Non-GET requests (POST, PATCH, DELETE) pass through directly.
  // SSE / streaming callers already attach their own AbortController signal.
  return _trackedFetch(url, method, fetch(url, options));
}

// ---- internal ---------------------------------------------------------------

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
function _trackedFetch(url, method, fetchPromise) {
  const tracker = _tracker;
  if (!tracker) return fetchPromise;

  const id = tracker.start({ url, method, startTime: performance.now() });

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
