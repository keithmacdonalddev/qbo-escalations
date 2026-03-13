import { useEffect, useRef, useState } from 'react';
import { setMonitorTransport, subscribeMonitorTransportCommands } from '../lib/monitorTransport.js';

const RECONNECT_COOLDOWN_MS = 60_000;
const TRANSPORT_KEY = 'server-errors';
const TRANSPORT_LABEL = 'Server Errors';
const TRANSPORT_URL = '/api/dev/server-errors';

/**
 * Subscribe to the server-side error pipeline via SSE.
 *
 * Only the leader tab opens the EventSource to avoid duplicate processing.
 * Errors are logged to the activity log and forwarded to the background
 * agent as [AUTO-ERROR] messages for autonomous investigation.
 *
 * @param {Object} opts
 * @param {boolean} [opts.enabled=true] - Master switch
 * @param {boolean} opts.isLeader - Only leader tab subscribes
 * @param {function} opts.sendBackground - Background agent sender
 * @param {function} opts.log - Activity log function
 */
export function useServerErrors({ enabled = true, isLeader, sendBackground, log }) {
  const eventSourceRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const [reconnectToken, setReconnectToken] = useState(0);

  useEffect(() => {
    if (!enabled || !isLeader || typeof sendBackground !== 'function') {
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

          // Handle history batch on initial connect
          if (data.type === 'history' && Array.isArray(data.errors)) {
            for (const err of data.errors) {
              log?.({
                type: 'server-error',
                message: `[SERVER] ${err.message}`,
                severity: 'error',
                detail: err.detail || '',
              });
            }
            return;
          }

          // Single real-time error event
          const severity = data.severity || 'error';
          log?.({
            type: 'server-error',
            message: `[SERVER] ${data.message}`,
            severity,
            detail: data.detail || '',
          });

          // Only forward actual errors (not info like reconnections) to dev agent
          if (severity !== 'info') {
            const stackPreview = data.stack
              ? `\nStack:\n${data.stack.split('\n').slice(0, 8).join('\n')}`
              : '';

            sendBackground?.('auto-errors', [
              `[AUTO-ERROR] Server error: ${data.message}`,
              '',
              `Source: ${data.source || 'unknown'}`,
              `Category: ${data.category || 'unknown'}`,
              data.detail ? `Detail: ${data.detail}` : '',
              stackPreview,
              '',
              'This is a SERVER-SIDE error. Investigate the backend code, check the relevant route handler or service, and fix the issue.',
            ].filter(Boolean).join('\n'));
          }
        } catch {
          /* JSON parse error -- skip */
        }
      };

      let esErrors = 0;
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
      es.onerror = () => {
        esErrors++;
        if (esErrors >= 10) {
          log?.({
            type: 'server-error',
            message: 'Server error stream disconnected after 10 errors -- cooling down before reconnect',
            severity: 'warning',
          });
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
          return;
        }
        log?.({
          type: 'server-error',
          message: 'Server error stream disconnected -- will auto-reconnect',
          severity: 'warning',
        });
        setMonitorTransport(TRANSPORT_KEY, {
          label: TRANSPORT_LABEL,
          url: TRANSPORT_URL,
          state: 'degraded',
          errorCount: esErrors,
          lastErrorAt: Date.now(),
          lastError: 'Transient SSE disconnect',
        });
      };
    } catch (err) {
      console.error('[DevAgent] useServerErrors setup failed:', err);
      setMonitorTransport(TRANSPORT_KEY, {
        label: TRANSPORT_LABEL,
        url: TRANSPORT_URL,
        state: 'degraded',
        lastErrorAt: Date.now(),
        lastError: err.message || 'Failed to initialize server error stream',
      });
    }

    return () => {
      try { es?.close(); } catch {}
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
      eventSourceRef.current = null;
    };
  }, [enabled, isLeader, sendBackground, log, reconnectToken]);
}
