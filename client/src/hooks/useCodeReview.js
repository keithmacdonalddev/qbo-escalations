import { useEffect, useRef, useState } from 'react';
import { setMonitorTransport, subscribeMonitorTransportCommands } from '../lib/monitorTransport.js';

const RECONNECT_COOLDOWN_MS = 60_000;
const TRANSPORT_KEY = 'code-review-watch';
const TRANSPORT_LABEL = 'Code Review Watch';
const TRANSPORT_URL = '/api/dev/watch';

/**
 * Subscribes to the server-side change detector via SSE (`GET /api/dev/watch`)
 * and enqueues auto-review tasks into the dev task queue.
 *
 * Only the leader tab subscribes (via `isLeader`) to avoid duplicate reviews
 * across multiple browser tabs.
 *
 * Changes are coalesced within a 5-second window before enqueuing a single
 * review task at medium priority.
 *
 * @param {object} params
 * @param {boolean} params.enabled   - Master toggle (default true)
 * @param {boolean} params.isLeader  - Only leader tab subscribes
 * @param {Function} params.enqueue  - taskQueue.enqueue from useDevTaskQueue
 */
export function useCodeReview({ enabled = true, isLeader, enqueue, log }) {
  const eventSourceRef = useRef(null);
  const coalesceBatchRef = useRef([]);
  const coalesceTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const [reconnectToken, setReconnectToken] = useState(0);

  useEffect(() => {
    if (!enabled || !isLeader || typeof enqueue !== 'function') {
      setMonitorTransport(TRANSPORT_KEY, {
        label: TRANSPORT_LABEL,
        url: TRANSPORT_URL,
        state: 'closed',
        nextRetryAt: null,
      });
      return;
    }

    let es = null;
    let unsubscribeCommand = () => {};

    const forceReconnect = (detail = {}) => {
      try {
        if (coalesceTimerRef.current) {
          clearTimeout(coalesceTimerRef.current);
          coalesceTimerRef.current = null;
        }
      } catch {}
      try {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      } catch {}
      try { eventSourceRef.current?.close(); } catch {}
      eventSourceRef.current = null;
      setMonitorTransport(TRANSPORT_KEY, {
        label: TRANSPORT_LABEL,
        url: TRANSPORT_URL,
        state: 'connecting',
        nextRetryAt: null,
        lastError: detail.reason || 'Supervisor forced reconnect',
      });
      setReconnectToken((value) => value + 1);
    };

    try {
      unsubscribeCommand = subscribeMonitorTransportCommands(TRANSPORT_KEY, forceReconnect);
      setMonitorTransport(TRANSPORT_KEY, {
        label: TRANSPORT_LABEL,
        url: TRANSPORT_URL,
        state: 'connecting',
        nextRetryAt: null,
      });

      es = new EventSource(TRANSPORT_URL);
      eventSourceRef.current = es;
      es.onopen = () => {
        setMonitorTransport(TRANSPORT_KEY, {
          label: TRANSPORT_LABEL,
          url: TRANSPORT_URL,
          state: 'connected',
          errorCount: 0,
          lastConnectedAt: Date.now(),
          nextRetryAt: null,
          lastError: '',
        });
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          coalesceBatchRef.current.push(data);

          // Reset coalesce window on each new event
          if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
          coalesceTimerRef.current = setTimeout(() => {
            const batched = coalesceBatchRef.current;
            coalesceBatchRef.current = [];

            if (batched.length === 0) return;

            // Merge all files from the batch, dedup, cap at 10
            const allFiles = [...new Set(batched.flatMap(b => b.files))].slice(0, 10);
            log?.({ type: 'change-detected', message: `Files changed: ${allFiles.slice(0, 3).join(', ')}${allFiles.length > 3 ? ` (+${allFiles.length - 3} more)` : ''}` });
            const latestDiff = batched[batched.length - 1]?.diffSummary || '';
            const latestUnified = batched[batched.length - 1]?.unifiedDiff || '';

            const message = `[AUTO-REVIEW] External file changes detected

Changed files:
${allFiles.map(f => `- ${f}`).join('\n')}

${latestDiff ? `Git diff summary:\n${latestDiff}` : ''}

${latestUnified ? `Relevant diff:\n\`\`\`diff\n${latestUnified}\n\`\`\`` : ''}

Review these changes for bugs, edge cases, and missing error handling. If you find clear issues, fix them. Report what you changed and why.`;

            log?.({ type: 'review-queued', message: `Code review enqueued for ${allFiles.length} changed file${allFiles.length === 1 ? '' : 's'}` });
            enqueue({
              id: `code-review-${Date.now()}`,
              priority: 'medium',
              channel: 'code-reviews',
              type: 'code-review',
              message,
            });
          }, 5000); // 5s coalesce window
        } catch {
          /* parse error -- ignore */
        }
      };

      let esErrors = 0;
      es.onerror = () => {
        esErrors++;
        // After 10 consecutive errors, close the EventSource to prevent
        // infinite reconnect storms when the server is down.
        if (esErrors >= 10) {
          log?.({ type: 'stream-error', message: 'Code review watch disconnected after 10 errors -- cooling down before reconnect', severity: 'warning' });
          es.close();
          setMonitorTransport(TRANSPORT_KEY, {
            label: TRANSPORT_LABEL,
            url: TRANSPORT_URL,
            state: 'cooldown',
            errorCount: esErrors,
            lastErrorAt: Date.now(),
            lastError: 'Disconnected after repeated SSE errors',
            nextRetryAt: Date.now() + RECONNECT_COOLDOWN_MS,
          });
          if (!reconnectTimerRef.current) {
            reconnectTimerRef.current = setTimeout(() => {
              reconnectTimerRef.current = null;
              setReconnectToken((value) => value + 1);
            }, RECONNECT_COOLDOWN_MS);
          }
        } else {
          setMonitorTransport(TRANSPORT_KEY, {
            label: TRANSPORT_LABEL,
            url: TRANSPORT_URL,
            state: 'degraded',
            errorCount: esErrors,
            lastErrorAt: Date.now(),
            lastError: 'Transient SSE disconnect',
          });
        }
      };
      // Reset error count on successful message
      const origOnMessage = es.onmessage;
      es.onmessage = (event) => {
        esErrors = 0;
        setMonitorTransport(TRANSPORT_KEY, {
          label: TRANSPORT_LABEL,
          url: TRANSPORT_URL,
          state: 'connected',
          errorCount: 0,
          lastEventAt: Date.now(),
          nextRetryAt: null,
          lastError: '',
        });
        origOnMessage?.(event);
      };
    } catch (err) {
      console.error('[DevAgent] useCodeReview setup failed:', err);
      setMonitorTransport(TRANSPORT_KEY, {
        label: TRANSPORT_LABEL,
        url: TRANSPORT_URL,
        state: 'degraded',
        lastErrorAt: Date.now(),
        lastError: err.message || 'Failed to initialize code review watch',
      });
    }

    return () => {
      try { es?.close(); } catch {}
      eventSourceRef.current = null;
      try {
        if (coalesceTimerRef.current) {
          clearTimeout(coalesceTimerRef.current);
          coalesceTimerRef.current = null;
        }
      } catch {}
      try {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      } catch {}
      try { unsubscribeCommand(); } catch {}
      setMonitorTransport(TRANSPORT_KEY, {
        label: TRANSPORT_LABEL,
        url: TRANSPORT_URL,
        state: 'closed',
      });
    };
  }, [enabled, isLeader, enqueue, log, reconnectToken]);
}
