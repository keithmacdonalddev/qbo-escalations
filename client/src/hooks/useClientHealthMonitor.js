import { useEffect, useRef } from 'react';
import { SEVERITY } from '../lib/severityClassifier.js';

// Capture originals at module level so StrictMode and monkey-patching
// by useClientHealthExtended cannot cause false positives when the
// health monitor creates its own intervals.
const _origSetInterval = window.setInterval;
const _origClearInterval = window.clearInterval;

/**
 * Periodic client-side health monitor that detects dangerous patterns
 * BEFORE they crash the browser and routes them to the dev agent.
 *
 * Seven detection surfaces:
 * 1. Memory pressure (warning 70%, critical 85%, rapid growth 20%+/30s)
 * 2. DOM size explosion (warning 5000, critical 10000, rapid growth 50%+)
 * 3. DOM thrashing via MutationObserver (100+ mutations/sec)
 * 4. Long tasks via PerformanceObserver (200ms+ warning, 500ms+ critical)
 * 5. Frozen UI (interval gap > 15s when expecting ~5s)
 * 6. Effect loop detection via global tracker (20+ fires in 5s window)
 * 7. Render storm detection via global counter
 *
 * Safety:
 * - Leader-only (single tab reports)
 * - Circuit breaker per detection type (max 1 alert per 2 minutes)
 * - Full cleanup on unmount (intervals, observers)
 * - No npm dependencies
 *
 * @param {object}   opts
 * @param {boolean}  [opts.enabled=true]     Master kill switch
 * @param {boolean}  opts.isLeader           Tab leadership flag
 * @param {Function} opts.sendBackground     sendBackground(channel, message)
 * @param {Function} opts.log                Activity log function
 */
export function useClientHealthMonitor({ enabled = true, isLeader, sendBackground, log }) {
  const stateRef = useRef({
    lastMemory: 0,
    lastMemoryTime: 0,
    lastDomCount: 0,
    // Circuit breaker: type -> last alert timestamp
    circuitBreakers: new Map(),
  });

  useEffect(() => {
    if (!enabled || !isLeader || typeof sendBackground !== 'function') return;

    const state = stateRef.current;
    const cleanups = [];

    try {
    // --- Circuit breaker helper (max 1 per type per 2 minutes) ---------------
    const COOLDOWN_MS = 120_000;
    function canAlert(type) {
      const last = state.circuitBreakers.get(type);
      if (last && Date.now() - last < COOLDOWN_MS) return false;
      state.circuitBreakers.set(type, Date.now());
      return true;
    }

    // --- Global registries for external instrumentation ----------------------
    if (!window.__DEV_AGENT_EFFECT_TRACKER__) {
      window.__DEV_AGENT_EFFECT_TRACKER__ = new Map(); // id -> { count, windowStart }
    }
    if (typeof window.__DEV_AGENT_RENDER_COUNT__ === 'undefined') {
      window.__DEV_AGENT_RENDER_COUNT__ = 0;
    }
    let lastRenderSnapshot = window.__DEV_AGENT_RENDER_COUNT__;

    // --- 1. Memory pressure (every 10 seconds) --------------------------------
    const memoryInterval = _origSetInterval.call(window, () => {
      if (!performance.memory) return; // Chrome-only API
      const { usedJSHeapSize, jsHeapSizeLimit } = performance.memory;
      const usagePercent = usedJSHeapSize / jsHeapSizeLimit;
      const usedMB = (usedJSHeapSize / 1024 / 1024).toFixed(0);
      const limitMB = (jsHeapSizeLimit / 1024 / 1024).toFixed(0);

      if (usagePercent > 0.85 && canAlert('memory-critical')) {
        log?.({ type: 'health-warning', message: `CRITICAL: Memory at ${(usagePercent * 100).toFixed(0)}% (${usedMB}MB/${limitMB}MB)`, severity: 'error', _severity: SEVERITY.CRITICAL });
        sendBackground('auto-errors', `[AUTO-ERROR] CRITICAL: Memory usage at ${(usagePercent * 100).toFixed(0)}%

JS heap: ${usedMB}MB / ${limitMB}MB
The browser is approaching crash territory. Investigate memory leaks immediately.
Check for: growing arrays, unclosed subscriptions, DOM node accumulation, event listener leaks.`);
      } else if (usagePercent > 0.70 && canAlert('memory-warning')) {
        log?.({ type: 'health-warning', message: `Memory warning: ${(usagePercent * 100).toFixed(0)}% (${usedMB}MB/${limitMB}MB)`, severity: 'warning', _severity: SEVERITY.MONITORING });
        sendBackground('auto-errors', `[AUTO-ERROR] Memory pressure warning: ${(usagePercent * 100).toFixed(0)}%

JS heap: ${usedMB}MB / ${limitMB}MB
Memory is elevated. Monitor for continued growth. If this escalates to 85%+, the browser may become unresponsive.`);
      }

      // Rapid growth: 20%+ in ~30 seconds (3 intervals)
      // Skip the first 3 ticks (30s) to let the app finish initializing —
      // React component mounting, Vite HMR, Framer Motion setup all cause
      // normal heap growth that looks like a leak to the detector.
      state.memoryCheckCount = (state.memoryCheckCount || 0) + 1;
      if (state.memoryCheckCount > 3 && state.lastMemory > 0 && state.lastMemoryTime > 0) {
        const elapsed = Date.now() - state.lastMemoryTime;
        if (elapsed >= 25_000) { // At least ~25s have passed
          const growthPercent = (usedJSHeapSize - state.lastMemory) / state.lastMemory;
          // Only alert if heap is already above 100MB — a 46MB heap growing
          // 60% is just normal module loading, not a leak.
          if (growthPercent > 0.20 && usedJSHeapSize > 100 * 1024 * 1024 && canAlert('memory-growth')) {
            log?.({ type: 'health-warning', message: `Rapid memory growth: +${(growthPercent * 100).toFixed(0)}% in ${(elapsed / 1000).toFixed(0)}s`, severity: 'warning', _severity: SEVERITY.MONITORING });
            sendBackground('auto-errors', `[AUTO-ERROR] Rapid memory growth detected: +${(growthPercent * 100).toFixed(0)}% in ${(elapsed / 1000).toFixed(0)}s

Heap went from ${(state.lastMemory / 1024 / 1024).toFixed(0)}MB to ${usedMB}MB.
This growth rate suggests an active memory leak. Investigate recent state changes, subscriptions, or accumulating data structures.`);
          }
          state.lastMemory = usedJSHeapSize;
          state.lastMemoryTime = Date.now();
        }
      } else {
        state.lastMemory = usedJSHeapSize;
        state.lastMemoryTime = Date.now();
      }
    }, 10_000);

    // --- 2. DOM size + 6. Effect loop + 7. Render storm (every 5 seconds) ----
    const healthInterval = _origSetInterval.call(window, () => {
      // DOM size monitoring
      const domCount = document.getElementsByTagName('*').length;

      if (domCount > 10_000 && canAlert('dom-critical')) {
        log?.({ type: 'health-warning', message: `CRITICAL: DOM size critical: ${domCount} nodes`, severity: 'error', _severity: SEVERITY.CRITICAL });
        sendBackground('auto-errors', `[AUTO-ERROR] DOM size critical: ${domCount} nodes

The DOM has ${domCount} elements, which causes layout thrashing and browser sluggishness.
Investigate components that create excessive elements (long lists without virtualization, repeated renders adding nodes).`);
      } else if (domCount > 5_000 && canAlert('dom-warning')) {
        log?.({ type: 'health-warning', message: `DOM size warning: ${domCount} nodes`, severity: 'warning', _severity: SEVERITY.MONITORING });
      }

      // DOM rapid growth (50%+ since last check, only after warmup)
      // Skip first 3 ticks (15s) to let React finish mounting all components.
      // Also require absolute count > 1500 — small DOM doubling is normal startup.
      if (state.lastDomCount > 0) {
        state.domCheckCount = (state.domCheckCount || 0) + 1;
        const domGrowth = domCount - state.lastDomCount;
        if (state.domCheckCount > 3 && domCount > 1500 && domGrowth > state.lastDomCount * 0.5 && canAlert('dom-growth')) {
          log?.({ type: 'health-warning', message: `DOM explosion: ${state.lastDomCount} -> ${domCount} nodes (+${domGrowth})`, severity: 'error', _severity: SEVERITY.MONITORING });
          sendBackground('auto-errors', `[AUTO-ERROR] DOM explosion detected: ${state.lastDomCount} -> ${domCount} nodes (+${domGrowth})

The DOM grew by ${((domGrowth / state.lastDomCount) * 100).toFixed(0)}% in ~5 seconds.
Something is generating excessive DOM nodes. Check for: uncontrolled list growth, missing virtualization, recursive component rendering.`);
        }
      }
      state.lastDomCount = domCount;

      // Effect loop detection
      const tracker = window.__DEV_AGENT_EFFECT_TRACKER__;
      if (tracker) {
        const now = Date.now();
        for (const [effectId, data] of tracker) {
          const windowElapsed = now - data.windowStart;
          if (windowElapsed >= 5_000 && data.count >= 20 && canAlert(`effect-loop:${effectId}`)) {
            log?.({ type: 'health-warning', message: `Effect loop: "${effectId}" fired ${data.count}x in ${(windowElapsed / 1000).toFixed(1)}s`, severity: 'error', _severity: SEVERITY.MONITORING });
            sendBackground('auto-errors', `[AUTO-ERROR] useEffect loop detected: "${effectId}" fired ${data.count} times in ${(windowElapsed / 1000).toFixed(1)}s

This effect is running far more often than expected. It likely has incorrect or missing dependency array entries, or is setting state that triggers itself.
Investigate the useEffect with identifier "${effectId}" and fix the dependency cycle.`);
          }
          // Reset window after check
          if (windowElapsed >= 5_000) {
            data.count = 0;
            data.windowStart = now;
          }
        }
      }

      // Render storm detection (via global counter from React.Profiler / FlameBar)
      const currentRenderCount = window.__DEV_AGENT_RENDER_COUNT__ || 0;
      const renderDelta = currentRenderCount - lastRenderSnapshot;
      lastRenderSnapshot = currentRenderCount;
      if (renderDelta > 200 && canAlert('render-storm')) {
        log?.({ type: 'health-warning', message: `Render storm: ${renderDelta} renders in ~5s`, severity: 'error', _severity: SEVERITY.MONITORING });
        sendBackground('auto-errors', `[AUTO-ERROR] Render storm detected: ${renderDelta} renders in ~5 seconds

Components are re-rendering at an extreme rate. This causes UI lag and memory pressure.
Investigate: missing React.memo on frequently-rendered components, state updates in tight loops, context providers re-rendering entire subtrees.`);
      }
    }, 5_000);

    // --- 3. MutationObserver for DOM thrashing --------------------------------
    let mutationCount = 0;
    let mutationWindowStart = Date.now();
    const mutationObserver = new MutationObserver((mutations) => {
      mutationCount += mutations.length;
      const elapsed = Date.now() - mutationWindowStart;
      if (elapsed >= 1_000) {
        if (mutationCount > 100 && canAlert('dom-thrashing')) {
          log?.({ type: 'health-warning', message: `DOM thrashing: ${mutationCount} mutations in ${elapsed}ms`, severity: 'error', _severity: SEVERITY.MONITORING });
          sendBackground('auto-errors', `[AUTO-ERROR] DOM thrashing detected: ${mutationCount} mutations in ${elapsed}ms

Something is causing rapid, repeated DOM updates. This is likely a useEffect or state update loop.
Common causes: setState in useEffect without proper deps, animation loops without cleanup, recursive renders.
Investigate the React component tree for components that are re-rendering excessively.`);
        }
        mutationCount = 0;
        mutationWindowStart = Date.now();
      }
    });
    if (document.body) {
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    // --- 4. Long task detection via PerformanceObserver -----------------------
    let longTaskObserver = null;
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 500 && canAlert('long-task-critical')) {
              log?.({ type: 'health-warning', message: `CRITICAL: Long task: ${entry.duration.toFixed(0)}ms (near-freeze)`, severity: 'error', _severity: SEVERITY.CRITICAL });
              sendBackground('auto-errors', `[AUTO-ERROR] Long task detected: ${entry.duration.toFixed(0)}ms

A JavaScript task blocked the main thread for ${entry.duration.toFixed(0)}ms.
This causes the UI to freeze. Users cannot click, scroll, or interact during this time.
Investigate: heavy computation, synchronous operations, large array processing, complex renders.`);
            } else if (entry.duration > 200) {
              log?.({ type: 'health-warning', message: `Long task: ${entry.duration.toFixed(0)}ms`, severity: 'warning', _severity: SEVERITY.MONITORING });
            }
          }
        });
        longTaskObserver.observe({ type: 'longtask', buffered: true });
      } catch {
        // PerformanceObserver 'longtask' not supported in this browser
      }
    }

    // --- 5. Frozen UI detection -----------------------------------------------
    let lastTickTime = Date.now();
    const freezeInterval = _origSetInterval.call(window, () => {
      const now = Date.now();
      const elapsed = now - lastTickTime;
      if (elapsed > 15_000 && canAlert('ui-freeze')) {
        log?.({ type: 'health-warning', message: `CRITICAL: UI freeze: main thread blocked ${(elapsed / 1000).toFixed(1)}s`, severity: 'error', _severity: SEVERITY.CRITICAL });
        sendBackground('auto-errors', `[AUTO-ERROR] UI freeze detected: main thread blocked for ${(elapsed / 1000).toFixed(1)}s

The JavaScript main thread was completely blocked for ${(elapsed / 1000).toFixed(1)} seconds.
The UI was unresponsive during this time. This is a critical performance issue.
Investigate: infinite loops, extremely expensive synchronous operations, blocking computations.`);
      }
      lastTickTime = now;
    }, 5_000);

    cleanups.push(() => _origClearInterval.call(window, memoryInterval));
    cleanups.push(() => _origClearInterval.call(window, healthInterval));
    cleanups.push(() => _origClearInterval.call(window, freezeInterval));
    cleanups.push(() => mutationObserver.disconnect());
    if (longTaskObserver) cleanups.push(() => longTaskObserver.disconnect());

    } catch (err) {
      console.error('[DevAgent] useClientHealthMonitor setup failed:', err);
    }

    // --- Cleanup --------------------------------------------------------------
    return () => {
      for (const fn of cleanups) {
        try { fn(); } catch {}
      }
    };
  }, [enabled, isLeader, sendBackground, log]);
}

/**
 * Helper for manual effect loop tracking.
 * Call at the top of a useEffect to register it with the health monitor:
 *
 *   useEffect(() => {
 *     trackEffect('MyComponent/fetchData');
 *     // ... effect body
 *   }, [deps]);
 *
 * @param {string} id - Unique identifier for the effect (e.g. 'ComponentName/effectPurpose')
 */
export function trackEffect(id) {
  if (!window.__DEV_AGENT_EFFECT_TRACKER__) {
    window.__DEV_AGENT_EFFECT_TRACKER__ = new Map();
  }
  const tracker = window.__DEV_AGENT_EFFECT_TRACKER__;
  const entry = tracker.get(id);
  const now = Date.now();
  if (entry) {
    entry.count++;
  } else {
    tracker.set(id, { count: 1, windowStart: now });
  }
}
