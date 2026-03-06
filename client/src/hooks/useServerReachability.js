import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Tri-state server reachability monitor.
 *
 * Pings /api/health every 30 seconds using raw fetch (bypassing apiFetch and
 * any circuit breaker) to detect when the server is down. State transitions:
 *
 *   reachable --(3 failures)--> degraded --(6 failures)--> unreachable
 *   unreachable/degraded --(1 success)--> reachable
 *
 * When unreachable, callers should:
 * - Stop opening new EventSource connections
 * - Queue background sends instead of attempting them
 * - Show a visual indicator in the UI
 *
 * An offline queue (max 20 items) stores messages that would have been sent
 * while the server was down. Call drainQueue() to retrieve them when the
 * server comes back.
 *
 * @param {object} params
 * @param {function} [params.log] - Activity log function
 */

const STATES = Object.freeze({
  REACHABLE: 'reachable',
  DEGRADED: 'degraded',
  UNREACHABLE: 'unreachable',
});

const PING_INTERVAL = 30_000;     // 30s between health checks
const PING_TIMEOUT = 5_000;       // 5s abort timeout per check
const DEGRADED_THRESHOLD = 3;     // consecutive failures before degraded
const UNREACHABLE_THRESHOLD = 6;  // consecutive failures before unreachable
const MAX_QUEUE = 20;             // max offline-queued messages

export function useServerReachability({ log } = {}) {
  const [serverState, setServerState] = useState(STATES.REACHABLE);
  const failCountRef = useRef(0);
  const offlineQueueRef = useRef([]);
  const logRef = useRef(log);
  logRef.current = log;

  // Ref-mirror of serverState for use inside the interval callback
  // without causing effect re-subscription on every state change
  const stateRef = useRef(serverState);
  stateRef.current = serverState;

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT);

        // Use raw fetch -- NOT apiFetch -- to bypass circuit breaker
        const res = await fetch('/api/health', {
          signal: controller.signal,
          // Bust any aggressive caches
          headers: { 'Cache-Control': 'no-cache' },
        });
        clearTimeout(timeout);

        if (res.ok) {
          const wasDown = failCountRef.current >= DEGRADED_THRESHOLD;
          failCountRef.current = 0;

          if (wasDown && stateRef.current !== STATES.REACHABLE) {
            setServerState(STATES.REACHABLE);
            logRef.current?.({
              type: 'server-status',
              message: 'Server is reachable again',
              severity: 'info',
            });
          }
        } else {
          failCountRef.current++;
        }
      } catch {
        failCountRef.current++;
      }

      // State transitions based on current fail count
      const count = failCountRef.current;
      const current = stateRef.current;

      if (count >= UNREACHABLE_THRESHOLD && current !== STATES.UNREACHABLE) {
        setServerState(STATES.UNREACHABLE);
        logRef.current?.({
          type: 'server-status',
          message: 'Server unreachable -- background sends paused',
          severity: 'error',
        });
      } else if (
        count >= DEGRADED_THRESHOLD &&
        count < UNREACHABLE_THRESHOLD &&
        current === STATES.REACHABLE
      ) {
        setServerState(STATES.DEGRADED);
        logRef.current?.({
          type: 'server-status',
          message: 'Server appears degraded -- monitoring',
          severity: 'warning',
        });
      }
    }, PING_INTERVAL);

    return () => clearInterval(interval);
  }, []); // Stable: reads state via refs

  /**
   * Queue a message for later delivery when the server comes back.
   * Silently drops if the queue is full.
   */
  const queueForLater = useCallback((channel, message) => {
    if (offlineQueueRef.current.length < MAX_QUEUE) {
      offlineQueueRef.current.push({
        channel,
        message,
        queuedAt: Date.now(),
      });
    }
  }, []);

  /**
   * Drain all queued messages. Returns the array and clears the internal queue.
   */
  const drainQueue = useCallback(() => {
    return offlineQueueRef.current.splice(0);
  }, []);

  return { serverState, queueForLater, drainQueue, STATES };
}
