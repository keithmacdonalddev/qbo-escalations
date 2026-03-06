import { useEffect, useRef } from 'react';
import { onBudgetChange } from '../api/http.js';
import { SEVERITY } from '../lib/severityClassifier.js';

// Capture originals at module level so StrictMode double-mount cannot
// snapshot an already-patched or null-ed ref as the "original".
const _origAddEventListener = EventTarget.prototype.addEventListener;
const _origRemoveEventListener = EventTarget.prototype.removeEventListener;
const _origSetInterval = window.setInterval;
const _origClearInterval = window.clearInterval;
const _origSetTimeout = window.setTimeout;
const _origClearTimeout = window.clearTimeout;
const _origConsoleLog = console.log;

/**
 * Extended client health monitor — catches edge-case failures the base
 * health monitor (memory, DOM, long tasks, freezes) does not cover.
 *
 * Ten detection surfaces:
 *  1. Event listener leak detection (patched addEventListener/removeEventListener)
 *  2. Timer leak detection (patched setInterval/setTimeout + clear variants)
 *  3. Fetch request pileup (via http.js onBudgetChange)
 *  4. Resource load failures (<img>, <script>, <link> capture-phase errors)
 *  5. Console.log flood detection (100+ calls in 10s)
 *  6. localStorage/sessionStorage quota monitoring
 *  7. CSP violation detection
 *  8. Vite chunk load / preload failures
 *  9. EventSource reconnect storm detection
 * 10. Offline/online network transitions
 *
 * NOTE: Render storm detection moved to useClientHealthMonitor (surface #7)
 * to consolidate duplicate monitoring of __DEV_AGENT_RENDER_COUNT__.
 *
 * Safety:
 * - Leader-only (single tab reports)
 * - Per-type throttle (max 1 report per type per 2 minutes)
 * - ALL patched globals restored on unmount
 * - ALL listeners removed on unmount
 * - ALL intervals cleared on unmount
 *
 * @param {object}   opts
 * @param {boolean}  [opts.enabled=true]     Master kill switch
 * @param {boolean}  opts.isLeader           Tab leadership flag
 * @param {Function} opts.sendBackground     sendBackground(channel, message)
 * @param {Function} opts.log                Activity log function
 */
export function useClientHealthExtended({ enabled = true, isLeader, sendBackground, log }) {
  const throttleRef = useRef(new Map()); // type -> lastFired timestamp

  useEffect(() => {
    if (!enabled || !isLeader || typeof sendBackground !== 'function') return;

    // Per-type throttle: max 1 report per 2 minutes
    function throttled(type, fn) {
      const last = throttleRef.current.get(type) || 0;
      if (Date.now() - last < 120_000) return;
      throttleRef.current.set(type, Date.now());
      fn();
    }

    const cleanups = [];

    try {

    // =====================================================================
    // 1. Event listener leak detection
    // =====================================================================
    let addCount = 0;
    let removeCount = 0;
    let prevNetListeners = 0;

    EventTarget.prototype.addEventListener = function (...args) {
      addCount++;
      return _origAddEventListener.apply(this, args);
    };
    EventTarget.prototype.removeEventListener = function (...args) {
      removeCount++;
      return _origRemoveEventListener.apply(this, args);
    };

    const listenerCheckInterval = setInterval(() => {
      const net = addCount - removeCount;
      const growth = net - prevNetListeners;
      prevNetListeners = net;

      if (net > 1000) {
        throttled('listener-critical', () => {
          log?.({ type: 'health-warning', message: `CRITICAL: ${net} net event listeners (leak likely)`, severity: 'error', _severity: SEVERITY.CRITICAL });
          sendBackground('auto-errors', `[AUTO-ERROR] Event listener leak: ${net} net listeners

Added: ${addCount}, Removed: ${removeCount}, Net: ${net}
Growth this window: +${growth}

Over 1000 active event listeners detected. This is almost certainly a leak.
Check for: addEventListener calls in useEffect without matching removeEventListener in cleanup,
event listeners added in loops or hot render paths, third-party libraries attaching listeners.`);
        });
      } else if (net > 500) {
        throttled('listener-warning', () => {
          log?.({ type: 'health-warning', message: `Event listener warning: ${net} net listeners`, severity: 'warning', _severity: SEVERITY.MONITORING });
        });
      }

      if (growth > 50) {
        throttled('listener-growth', () => {
          log?.({ type: 'health-warning', message: `Rapid listener growth: +${growth} in 30s`, severity: 'warning', _severity: SEVERITY.MONITORING });
          sendBackground('auto-errors', `[AUTO-ERROR] Rapid event listener growth: +${growth} in 30 seconds

Net listeners: ${net} (added ${addCount}, removed ${removeCount})
Something is attaching listeners without cleaning up. Check recent component mounts and useEffect hooks.`);
        });
      }
    }, 30_000);
    cleanups.push(() => clearInterval(listenerCheckInterval));

    // =====================================================================
    // 2. Timer leak detection
    // =====================================================================
    const activeIntervals = new Set();
    const activeTimeouts = new Set();

    window.setInterval = function (...args) {
      const id = _origSetInterval.apply(window, args);
      activeIntervals.add(id);
      return id;
    };
    window.clearInterval = function (id) {
      activeIntervals.delete(id);
      return _origClearInterval.call(window, id);
    };
    window.setTimeout = function (callback, ...rest) {
      // Wrap the callback to auto-remove from tracking when it fires,
      // without creating a second timer (which would double timer volume).
      // Use closure over idRef to capture the ID after it's assigned.
      const idRef = { value: 0 };
      const wrappedCallback = typeof callback === 'function'
        ? function () { activeTimeouts.delete(idRef.value); return callback.apply(this, arguments); }
        : callback;
      const id = _origSetTimeout.call(window, wrappedCallback, ...rest);
      idRef.value = id;
      activeTimeouts.add(id);
      return id;
    };
    window.clearTimeout = function (id) {
      activeTimeouts.delete(id);
      return _origClearTimeout.call(window, id);
    };

    const timerCheckInterval = _origSetInterval.call(window, () => {
      if (activeIntervals.size > 20) {
        throttled('interval-leak', () => {
          log?.({ type: 'health-warning', message: `Timer leak: ${activeIntervals.size} active intervals`, severity: 'warning', _severity: SEVERITY.MONITORING });
          sendBackground('auto-errors', `[AUTO-ERROR] Timer leak: ${activeIntervals.size} active setInterval timers

Having ${activeIntervals.size} concurrent intervals is abnormal. Each interval consumes CPU every tick.
Check for: setInterval in useEffect without clearInterval in cleanup, intervals created on every render.`);
        });
      }
      if (activeTimeouts.size > 100) {
        throttled('timeout-leak', () => {
          log?.({ type: 'health-warning', message: `Timer warning: ${activeTimeouts.size} pending timeouts`, severity: 'warning', _severity: SEVERITY.MONITORING });
          sendBackground('auto-errors', `[AUTO-ERROR] Timeout accumulation: ${activeTimeouts.size} pending setTimeout timers

Having ${activeTimeouts.size} pending timeouts suggests something is scheduling work faster than it completes.
Check for: setTimeout in tight loops, debounce functions creating new timers without clearing old ones.`);
        });
      }
    }, 30_000);
    cleanups.push(() => _origClearInterval.call(window,timerCheckInterval));

    // =====================================================================
    // 3. Fetch request pileup (via http.js budget subscription)
    // =====================================================================
    const unsubBudget = onBudgetChange((state) => {
      if (state.inFlight > 10) {
        throttled('fetch-pileup', () => {
          log?.({ type: 'health-warning', message: `Request pileup: ${state.inFlight} concurrent API requests`, severity: 'warning', _severity: SEVERITY.MONITORING });
          sendBackground('auto-errors', `[AUTO-ERROR] Request pileup: ${state.inFlight} concurrent API requests

The app is making ${state.inFlight} simultaneous requests. This can overwhelm the server
and cause timeouts. Check for: polling loops without dedup, components re-fetching on every
render, missing abort controllers on unmount.`);
        });
      }
    });
    cleanups.push(unsubBudget);

    // =====================================================================
    // 4. Resource load failures (capture-phase error listener)
    // =====================================================================
    function handleResourceError(event) {
      const el = event.target;
      if (!el || !el.tagName) return;
      const tag = el.tagName.toUpperCase();
      if (tag !== 'IMG' && tag !== 'SCRIPT' && tag !== 'LINK') return;

      const src = el.src || el.href || 'unknown';
      // Feedback loop prevention
      if (src.includes('/api/dev/')) return;

      const kind = tag === 'IMG' ? 'image' : tag === 'SCRIPT' ? 'script' : 'stylesheet';
      log?.({ type: 'resource-error', message: `Failed to load ${tag}: ${src}`, severity: 'error', _severity: SEVERITY.MONITORING });

      throttled(`resource:${src}`, () => {
        sendBackground('auto-errors', `[AUTO-ERROR] Resource load failure

Element: <${tag.toLowerCase()}>
Source: ${src}

A ${kind} failed to load. Check if the file exists, the path is correct, and the server is serving it.`);
      });
    }
    window.addEventListener('error', handleResourceError, true);
    cleanups.push(() => window.removeEventListener('error', handleResourceError, true));

    // =====================================================================
    // 5. Console.log flood detection
    // =====================================================================
    let consoleLogCount = 0;

    console.log = function (...args) {
      consoleLogCount++;
      return _origConsoleLog.apply(console, args);
    };

    const consoleCheckInterval = _origSetInterval.call(window, () => {
      if (consoleLogCount > 100) {
        throttled('console-flood', () => {
          log?.({ type: 'health-warning', message: `Console flood: ${consoleLogCount} console.log calls in 10s`, severity: 'warning', _severity: SEVERITY.MONITORING });
          sendBackground('auto-errors', `[AUTO-ERROR] Console.log flood: ${consoleLogCount} calls in 10 seconds

A component is logging excessively, likely in a hot render path or tight loop.
This slows the browser and pollutes DevTools. Find and remove or gate the log statement.`);
        });
      }
      consoleLogCount = 0;
    }, 10_000);
    cleanups.push(() => _origClearInterval.call(window,consoleCheckInterval));

    // =====================================================================
    // 6. localStorage quota monitoring
    // =====================================================================
    const storageCheckInterval = _origSetInterval.call(window, () => {
      // Probe for quota exhaustion
      try {
        const testKey = '__health_storage_test__';
        const testValue = 'x'.repeat(1024 * 100); // 100KB probe
        localStorage.setItem(testKey, testValue);
        localStorage.removeItem(testKey);
      } catch (e) {
        if (e.name === 'QuotaExceededError') {
          throttled('storage-quota', () => {
            log?.({ type: 'health-warning', message: 'localStorage quota exceeded', severity: 'error', _severity: SEVERITY.MONITORING });
            sendBackground('auto-errors', `[AUTO-ERROR] localStorage quota exceeded

The browser's localStorage is full. New writes will fail silently.
Check for: unbounded caching, conversation history stored locally, large base64 data.
Consider pruning old entries or switching to IndexedDB for large data.`);
          });
        }
      }

      // Check current usage
      let totalSize = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          totalSize += (localStorage.getItem(key) || '').length;
        }
      } catch { /* access denied in some contexts */ }

      if (totalSize > 4 * 1024 * 1024) { // 4MB (limit is usually 5MB)
        throttled('storage-high', () => {
          log?.({ type: 'health-warning', message: `localStorage usage: ${(totalSize / 1024 / 1024).toFixed(1)}MB of ~5MB`, severity: 'warning', _severity: SEVERITY.MONITORING });
        });
      }
    }, 60_000);
    cleanups.push(() => _origClearInterval.call(window,storageCheckInterval));

    // =====================================================================
    // 7. CSP violation detection
    // =====================================================================
    function handleCSP(e) {
      throttled(`csp:${e.blockedURI}`, () => {
        log?.({ type: 'security-warning', message: `CSP violation: ${e.violatedDirective} blocked ${e.blockedURI}`, severity: 'error', _severity: SEVERITY.MONITORING });
        sendBackground('auto-errors', `[AUTO-ERROR] Content Security Policy violation

Directive: ${e.violatedDirective}
Blocked URI: ${e.blockedURI}
Source: ${e.sourceFile}:${e.lineNumber}

A resource was blocked by the Content Security Policy. This may break functionality.`);
      });
    }
    document.addEventListener('securitypolicyviolation', handleCSP);
    cleanups.push(() => document.removeEventListener('securitypolicyviolation', handleCSP));

    // =====================================================================
    // 8. Vite chunk / preload failures
    // =====================================================================
    function handleVitePreloadError(e) {
      throttled('vite-chunk', () => {
        log?.({ type: 'resource-error', message: `Vite chunk load failed: ${e.payload?.message || 'unknown'}`, severity: 'error', _severity: SEVERITY.MONITORING });
        sendBackground('auto-errors', `[AUTO-ERROR] Vite chunk load failed

A lazy-loaded module failed to load. This usually means a deployment mismatch or network issue.
Error: ${e.payload?.message || 'Unknown'}

The user may see a blank page or broken component. Consider implementing a retry or full page reload.`);
      });
    }
    window.addEventListener('vite:preloadError', handleVitePreloadError);
    cleanups.push(() => window.removeEventListener('vite:preloadError', handleVitePreloadError));

    // =====================================================================
    // 9. EventSource reconnect storm detection
    // =====================================================================
    const esErrorCounts = new Map(); // url -> { count, windowStart }
    const OrigEventSource = window.EventSource;

    if (OrigEventSource) {
      window.EventSource = function (url, opts) {
        const instance = new OrigEventSource(url, opts);
        instance.addEventListener('error', () => {
          // Feedback loop: skip dev agent's own streams
          if (url.includes('/api/dev/')) return;

          const now = Date.now();
          let entry = esErrorCounts.get(url);
          if (!entry || now - entry.windowStart > 60_000) {
            entry = { count: 0, windowStart: now };
            esErrorCounts.set(url, entry);
          }
          entry.count++;

          if (entry.count >= 5) {
            throttled(`es-storm:${url}`, () => {
              log?.({ type: 'network-error', message: `EventSource reconnect storm: ${url} (${entry.count} errors in 60s)`, severity: 'error', _severity: SEVERITY.MONITORING });
              sendBackground('auto-errors', `[AUTO-ERROR] EventSource reconnect storm

URL: ${url}
Errors: ${entry.count} in 60 seconds

The SSE connection is failing and reconnecting repeatedly. This wastes bandwidth and server resources.
Check: server health, CORS headers, proxy timeouts, and whether the endpoint actually exists.`);
            });
            entry.count = 0;
            entry.windowStart = now;
          }
        });
        return instance;
      };
      // Preserve prototype chain so instanceof checks work
      window.EventSource.prototype = OrigEventSource.prototype;
      window.EventSource.CONNECTING = OrigEventSource.CONNECTING;
      window.EventSource.OPEN = OrigEventSource.OPEN;
      window.EventSource.CLOSED = OrigEventSource.CLOSED;
      cleanups.push(() => { window.EventSource = OrigEventSource; });
    }

    // =====================================================================
    // 10. Offline/online network detection
    // =====================================================================
    function handleOffline() {
      log?.({ type: 'network-error', message: 'Browser went offline', severity: 'error', _severity: SEVERITY.MONITORING });
      // Do NOT call sendBackground here — the browser is offline so the
      // request would fail, triggering cascading error reports.
    }
    function handleOnline() {
      log?.({ type: 'network-info', message: 'Browser back online', severity: 'info', _severity: SEVERITY.INFO });
    }
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    cleanups.push(() => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    });

    // NOTE: Render storm detection is handled by useClientHealthMonitor
    // (surface #7: __DEV_AGENT_RENDER_COUNT__ checked every 5s, threshold
    // 200 renders/5s). Removed from here to avoid duplicate alerting on
    // the same global counter.

    } catch (err) {
      console.error('[DevAgent] useClientHealthExtended setup failed:', err);
    }

    // =====================================================================
    // Cleanup -- restore ALL patched globals and remove ALL listeners
    // =====================================================================
    return () => {
      // Run all registered cleanups (intervals, listeners, subscriptions)
      for (const fn of cleanups) {
        try { fn(); } catch {}
      }

      // Restore each patched global independently -- one failure must not
      // prevent the others from being restored.
      try { EventTarget.prototype.addEventListener = _origAddEventListener; } catch {}
      try { EventTarget.prototype.removeEventListener = _origRemoveEventListener; } catch {}
      try { window.setInterval = _origSetInterval; } catch {}
      try { window.clearInterval = _origClearInterval; } catch {}
      try { window.setTimeout = _origSetTimeout; } catch {}
      try { window.clearTimeout = _origClearTimeout; } catch {}
      try { console.log = _origConsoleLog; } catch {}

      // Clear throttle map
      try { throttleRef.current.clear(); } catch {}
    };
  }, [enabled, isLeader, sendBackground, log]);
}
