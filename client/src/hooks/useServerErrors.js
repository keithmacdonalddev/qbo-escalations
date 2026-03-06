import { useEffect, useRef } from 'react';

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

  useEffect(() => {
    if (!enabled || !isLeader || typeof sendBackground !== 'function') return;

    let es = null;

    try {
      es = new EventSource('/api/dev/server-errors');
      eventSourceRef.current = es;

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
        origOnMessage?.(event);
      };
      es.onerror = () => {
        esErrors++;
        if (esErrors >= 10) {
          log?.({
            type: 'server-error',
            message: 'Server error stream disconnected after 10 errors -- stopped reconnecting',
            severity: 'warning',
          });
          es.close();
          return;
        }
        log?.({
          type: 'server-error',
          message: 'Server error stream disconnected -- will auto-reconnect',
          severity: 'warning',
        });
      };
    } catch (err) {
      console.error('[DevAgent] useServerErrors setup failed:', err);
    }

    return () => {
      try { es?.close(); } catch {}
      eventSourceRef.current = null;
    };
  }, [enabled, isLeader, sendBackground, log]);
}
