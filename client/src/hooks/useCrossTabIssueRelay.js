import { useEffect, useRef } from 'react';
import { onApiError } from '../api/http.js';

const RELAY_COOLDOWN_MS = 30_000;

function buildIssueKey(issue, tabId = '') {
  return [
    tabId,
    issue?.type || 'unknown',
    issue?.summary || '',
    issue?.detail || '',
  ].join('|');
}

export function useCrossTabIssueRelay({
  enabled = true,
  isLeader,
  broadcastStatus,
  onStatusUpdate,
  sendBackground,
  log,
}) {
  const recentRef = useRef(new Map());

  useEffect(() => {
    if (!enabled) return;

    function shouldRelay(key) {
      const now = Date.now();
      const last = recentRef.current.get(key) || 0;
      if (now - last < RELAY_COOLDOWN_MS) return false;
      recentRef.current.set(key, now);

      // Prune stale entries to prevent unbounded growth
      if (recentRef.current.size > 50) {
        for (const [k, ts] of recentRef.current) {
          if (now - ts > RELAY_COOLDOWN_MS) {
            recentRef.current.delete(k);
          }
        }
      }

      return true;
    }

    if (isLeader) {
      if (typeof onStatusUpdate !== 'function' || typeof sendBackground !== 'function') return;

      return onStatusUpdate((msg) => {
        if (!msg || msg.kind !== 'issue-relay' || !msg.issue) return;

        const key = buildIssueKey(msg.issue, msg.tabId);
        if (!shouldRelay(key)) return;

        log?.({
          type: 'health-warning',
          message: `Relayed issue from ${msg.tabId || 'other tab'}: ${msg.issue.summary || msg.issue.type || 'Unknown issue'}`,
          severity: 'warning',
          detail: msg.issue.detail || '',
        });

        sendBackground('auto-errors', [
          '[AUTO-ERROR] Issue relayed from a non-leader tab',
          '',
          `Source tab: ${msg.tabId || 'unknown'}`,
          `Type: ${msg.issue.type || 'unknown'}`,
          msg.issue.summary ? `Summary: ${msg.issue.summary}` : '',
          msg.issue.detail ? `Detail: ${msg.issue.detail}` : '',
          '',
          'Investigate the client-side surface that failed in another tab. If a clear fix is available, apply it.',
        ].filter(Boolean).join('\n'));
      });
    }

    if (typeof broadcastStatus !== 'function') return;

    function relayIssue(issue) {
      const key = buildIssueKey(issue);
      if (!shouldRelay(key)) return;

      try {
        broadcastStatus({
          kind: 'issue-relay',
          issue: {
            type: issue.type || 'unknown',
            summary: issue.summary || 'Unknown issue',
            detail: issue.detail || '',
          },
        });
      } catch {
        // best-effort only
      }
    }

    function handleWindowError(event) {
      const error = event?.error;
      const summary = error?.message || event?.message || 'Unhandled window error';
      const detail = error?.stack || `${event?.filename || 'unknown'}:${event?.lineno || 0}`;
      relayIssue({ type: 'window-error', summary, detail });
    }

    function handleRejection(event) {
      const reason = event?.reason;
      const summary = reason?.message || String(reason || 'Unhandled promise rejection');
      const detail = reason?.stack || '';
      relayIssue({ type: 'unhandled-rejection', summary, detail });
    }

    function handleReactBoundary(event) {
      const detail = event?.detail || {};
      relayIssue({
        type: 'react-boundary',
        summary: detail.message || 'React error boundary triggered',
        detail: detail.componentStack || detail.stack || '',
      });
    }

    function handleSseError(event) {
      const detail = event?.detail || {};
      relayIssue({
        type: 'sse-stream-error',
        summary: detail.error || 'SSE stream failed',
        detail: detail.url || '',
      });
    }

    const unsubscribeApi = onApiError((apiEvent) => {
      relayIssue({
        type: 'api-error',
        summary: `${apiEvent.method || 'GET'} ${apiEvent.url || 'unknown'} ${apiEvent.type || 'error'}`,
        detail: apiEvent.status ? `status ${apiEvent.status} ${apiEvent.statusText || ''}`.trim() : (apiEvent.statusText || ''),
      });
    });

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleRejection);
    window.addEventListener('react-error-boundary', handleReactBoundary);
    window.addEventListener('sse-stream-error', handleSseError);

    return () => {
      unsubscribeApi?.();
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleRejection);
      window.removeEventListener('react-error-boundary', handleReactBoundary);
      window.removeEventListener('sse-stream-error', handleSseError);
    };
  }, [enabled, isLeader, broadcastStatus, onStatusUpdate, sendBackground, log]);
}
