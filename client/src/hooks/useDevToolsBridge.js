import { useEffect, useRef } from 'react';
import { onCircuitChange, onApiError } from '../api/http.js';
import { SEVERITY } from '../lib/severityClassifier.js';

// Capture originals at module level so StrictMode double-mount cannot
// snapshot an already-patched console method as the "original".
const _originalConsoleError = console.error;
const _originalConsoleWarn = console.warn;

/**
 * Bridges browser DevTools signals into the dev agent's auto-error pipeline.
 *
 * Six capture surfaces:
 * 1. **console.error** -- intercepts calls that carry a real Error with a stack
 *    trace (crashes, React error boundaries, library throws). Intentional
 *    console.error('some string') calls without stack traces are ignored to
 *    avoid noise from React dev warnings and library diagnostics.
 *
 * 2. **Circuit breaker** -- subscribes to http.js onCircuitChange() and reports
 *    when the circuit trips to 'open' (5+ consecutive GET failures). This
 *    surfaces cascading API outages that might not throw uncaught exceptions.
 *
 * 3. **API errors** -- subscribes to http.js onApiError() and reports every
 *    non-ok response (4xx, 5xx) and network/timeout failures. Deduped per
 *    url+status within 15 seconds.
 *
 * 4. **React error boundary** -- listens for 'react-error-boundary' custom
 *    events dispatched from the ErrorBoundary onError callback in main.jsx.
 *
 * 5. **SSE stream errors** -- listens for 'sse-stream-error' custom events
 *    dispatched by SSE consumers when streams break mid-response.
 *
 * 6. **console.warn (selective)** -- captures specific dangerous patterns:
 *    deprecated APIs, memory leak warnings, unmounted component state updates.
 *
 * Safety:
 * - Only active when `enabled && isLeader` (single tab reports).
 * - Feedback-loop prevention: errors from /api/dev/ and React warnings skipped.
 * - Stack traces truncated to 8 frames.
 * - Dedup: same error message not re-sent within 30 seconds (console.error),
 *   same url+status not re-sent within 15 seconds (API errors).
 * - Cleanup restores original console.error/warn and unsubscribes all listeners.
 *
 * @param {object}   opts
 * @param {boolean}  [opts.enabled=true]     Master kill switch
 * @param {boolean}  opts.isLeader           Tab leadership flag
 * @param {Function} opts.sendBackground     sendBackground(channel, message)
 */
export function useDevToolsBridge({ enabled = true, isLeader, sendBackground, log }) {
  const recentRef = useRef(new Map()); // key -> timestamp (dedup)

  useEffect(() => {
    if (!enabled || !isLeader || typeof sendBackground !== 'function') return;

    const cleanups = [];

    try {
    // --- Console.error capture ------------------------------------------------
    console.error = (...args) => {
      // Always call original first -- never swallow output
      _originalConsoleError.apply(console, args);

      const firstArg = args[0];

      // Filter: only errors with real stack traces.
      // React dev warnings, intentional string logs, and library diagnostics
      // are excluded to keep the auto-error channel signal-rich.
      const error = firstArg instanceof Error
        ? firstArg
        : (args.length > 1 && args[1] instanceof Error ? args[1] : null);

      if (!error || !error.stack) return;

      const message = error.message || String(firstArg);
      const stack = error.stack || '';

      // Feedback loop prevention
      if (stack.includes('/api/dev/') || message.includes('/api/dev/')) return;
      if (stack.includes('useDevToolsBridge') || stack.includes('useAutoErrorReporter')) return;

      // Skip React internal warnings that route through console.error
      if (message.startsWith('Warning:')) return;
      if (message.includes('React does not recognize')) return;
      if (message.includes('validateDOMNesting')) return;

      // 30-second dedup per unique message
      const now = Date.now();
      const lastSeen = recentRef.current.get(message);
      if (lastSeen && now - lastSeen < 30_000) return;
      recentRef.current.set(message, now);

      // Prune stale dedup entries (keep map bounded)
      if (recentRef.current.size > 50) {
        for (const [key, ts] of recentRef.current) {
          if (now - ts > 30_000) recentRef.current.delete(key);
        }
      }

      const truncatedStack = stack.split('\n').slice(0, 8).join('\n');

      const errPreview = message.length > 80 ? message.slice(0, 80) + '...' : message;
      log?.({ type: 'console-error', message: `Console error: ${errPreview}`, severity: 'error', _severity: SEVERITY.URGENT });

      sendBackground('auto-errors', `[AUTO-ERROR] Console error captured

Error: ${message}
${truncatedStack ? `Stack:\n${truncatedStack}` : ''}

Fix this error. Read the source file, identify the root cause, and apply the fix.`);
    };

    // --- Circuit breaker capture ----------------------------------------------
    let lastCircuitStatus = null;
    const unsubCircuit = onCircuitChange((state) => {
      if (state.status === 'open' && lastCircuitStatus !== 'open') {
        log?.({ type: 'circuit-breaker', message: `Circuit breaker OPENED (${state.failures} failures)`, severity: 'error', _severity: SEVERITY.ELEVATED });
        sendBackground('auto-errors', `[AUTO-ERROR] Circuit breaker OPENED (${state.failures} consecutive failures)

The API circuit breaker has tripped to OPEN state. This means ${state.failures}+ consecutive API failures have been detected. All GET requests will fail immediately for 30 seconds.

Investigate recent API errors. Check if the server is running and responding. Report the likely cause and suggest a fix.`);
      }
      lastCircuitStatus = state.status;
    });

    // --- API error subscription ------------------------------------------------
    const unsubApiError = onApiError((evt) => {
      // Feedback loop prevention: skip dev agent's own endpoints
      if (evt.url?.includes('/api/dev/')) return;

      // 15-second dedup per url+status combo
      const key = `api:${evt.url}:${evt.status}`;
      const now = Date.now();
      const lastSeen = recentRef.current.get(key);
      if (lastSeen && now - lastSeen < 15_000) return;
      recentRef.current.set(key, now);

      log?.({ type: 'api-error', message: `${evt.method} ${evt.url} -> ${evt.status}`, severity: 'error', _severity: SEVERITY.ELEVATED });

      sendBackground('auto-errors', `[AUTO-ERROR] API ${evt.type}: ${evt.method} ${evt.url} → ${evt.status} ${evt.statusText}

The ${evt.method} request to ${evt.url} failed with status ${evt.status}. Investigate the endpoint handler, check for issues in the route and any services it calls.`);
    });

    // --- React error boundary listener ----------------------------------------
    function handleReactBoundary(e) {
      const { error, componentStack } = e.detail || {};

      log?.({ type: 'react-crash', message: `React render crash: ${error?.message || 'Unknown'}`, severity: 'error', _severity: SEVERITY.CRITICAL });

      sendBackground('auto-errors', `[AUTO-ERROR] React render crash

Error: ${error?.message || 'Unknown'}
Stack: ${error?.stack?.split('\n').slice(0, 8).join('\n') || 'unavailable'}
Component Stack: ${componentStack?.split('\n').slice(0, 5).join('\n') || 'unavailable'}

A React component crashed during render. This triggers the error boundary fallback UI. Fix the component.`);
    }
    window.addEventListener('react-error-boundary', handleReactBoundary);

    // --- SSE stream error listener --------------------------------------------
    function handleSSEError(e) {
      const { url, error, lastChunk } = e.detail || {};
      // Feedback loop prevention
      if (url?.includes('/api/dev/')) return;

      log?.({ type: 'stream-error', message: `SSE stream error on ${url || 'unknown endpoint'}`, severity: 'error', _severity: SEVERITY.ELEVATED });

      sendBackground('auto-errors', `[AUTO-ERROR] SSE stream error on ${url || 'unknown endpoint'}

Error: ${error || 'unknown'}
Last received chunk: ${lastChunk?.slice(0, 200) || 'none'}

The streaming connection broke mid-response. Check the server endpoint and network stability.`);
    }
    window.addEventListener('sse-stream-error', handleSSEError);

    // --- console.warn capture (selective patterns) ----------------------------
    const WARN_PATTERNS = [
      'deprecated',
      'memory leak',
      "Can't perform a React state update on an unmounted component",
    ];

    console.warn = (...args) => {
      _originalConsoleWarn.apply(console, args);

      const msg = String(args[0] || '');
      const msgLower = msg.toLowerCase();

      if (!WARN_PATTERNS.some(p => msgLower.includes(p.toLowerCase()))) return;

      // Feedback loop prevention
      if (msg.includes('/api/dev/') || msg.includes('useDevToolsBridge')) return;

      // 30-second dedup per warning message
      const warnKey = `warn:${msg.slice(0, 100)}`;
      const warnNow = Date.now();
      const warnLastSeen = recentRef.current.get(warnKey);
      if (warnLastSeen && warnNow - warnLastSeen < 30_000) return;
      recentRef.current.set(warnKey, warnNow);

      log?.({ type: 'console-warn', message: `Warning: ${msg.slice(0, 80)}`, severity: 'info', _severity: SEVERITY.INFO });

      sendBackground('auto-errors', `[AUTO-ERROR] Warning: ${msg.slice(0, 300)}

This warning indicates a potential issue that should be investigated.`);
    };

    cleanups.push(() => unsubCircuit());
    cleanups.push(() => unsubApiError());
    cleanups.push(() => window.removeEventListener('react-error-boundary', handleReactBoundary));
    cleanups.push(() => window.removeEventListener('sse-stream-error', handleSSEError));

    } catch (err) {
      _originalConsoleError.call(console, '[DevAgent] useDevToolsBridge setup failed:', err);
    }

    return () => {
      // Restore original console methods independently
      try { console.error = _originalConsoleError; } catch {}
      try { console.warn = _originalConsoleWarn; } catch {}
      // Run registered cleanups (unsubscribes, listener removals)
      for (const fn of cleanups) {
        try { fn(); } catch {}
      }
      // Clear dedup map
      try { recentRef.current.clear(); } catch {}
    };
  }, [enabled, isLeader, sendBackground, log]);
}
