import { useState, useCallback, useRef, useMemo, useEffect } from 'react';

const MAX_LOG_ENTRIES = 200;
const FLUSH_INTERVAL = 200; // ms — debounce window to batch log() calls

/**
 * Central activity log store for the dev agent ecosystem.
 *
 * All agent hooks push events here so the UI can render a real-time
 * streaming log of everything the agent thinks and does.
 *
 * Uses debounced batching: log() calls accumulate in a buffer and
 * flush to React state every FLUSH_INTERVAL ms, avoiding a re-render
 * on every single log() call.
 *
 * Event types:
 * - error-captured    — runtime error caught (window.onerror, console.error, API)
 * - error-reported    — error sent to the dev agent for fixing
 * - error-circuit     — circuit breaker tripped, preventing more auto-sends
 * - bg-send           — background message sent to a channel
 * - bg-response       — background response received from agent
 * - bg-rotate         — background channel rotated (hit turn limit)
 * - fg-send           — foreground user message sent
 * - fg-response       — foreground response received
 * - task-queued       — task added to queue (with priority)
 * - task-started      — task dequeued and started processing
 * - task-completed    — task finished
 * - change-detected   — file changes detected by git polling
 * - review-queued     — code review enqueued
 * - idle-scan         — idle scan started
 * - leader-change     — tab leadership changed
 * - context-refresh   — system prompt context was refreshed
 * - circuit-breaker   — circuit breaker state changed
 * - api-error         — API call failed
 * - stream-error      — SSE stream broke
 * - react-crash       — React error boundary triggered
 * - health-warning    — client health monitor alert (memory, DOM, freeze, etc.)
 * - resource-error    — failed to load <img>, <script>, or <link> resource
 * - security-warning  — CSP violation or other security policy block
 * - network-error     — browser offline or EventSource reconnect storm
 * - network-info      — browser back online after offline event
 * - perf-insight      — automated performance insight from waterfall analysis
 *
 * @returns {{ entries: Array, log: Function, clear: Function }}
 */
export function useAgentActivityLog() {
  const [entries, setEntries] = useState([]);
  const bufferRef = useRef([]);
  const flushTimerRef = useRef(null);
  const idCounterRef = useRef(0);

  const log = useCallback((entry) => {
    bufferRef.current.push({
      id: ++idCounterRef.current,
      timestamp: Date.now(),
      severity: 'info',
      ...entry,
    });

    // Debounce: flush every FLUSH_INTERVAL ms instead of on every single call
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        const batch = bufferRef.current.splice(0);
        if (batch.length === 0) return;
        setEntries((prev) => {
          const next = [...prev, ...batch];
          return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
        });
      }, FLUSH_INTERVAL);
    }
  }, []);

  const clear = useCallback(() => {
    bufferRef.current = [];
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setEntries([]);
    idCounterRef.current = 0;
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, []);

  return useMemo(() => ({ entries, log, clear }), [entries, log, clear]);
}
