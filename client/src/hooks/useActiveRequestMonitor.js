import { useEffect, useRef } from 'react';
import { onActiveRequestsChange, getActiveRequestsSnapshot } from '../api/http.js';

const CHECK_INTERVAL_MS = 15_000;
const ALERT_COOLDOWN_MS = 300_000;
const LONG_PENDING_MS = 20_000;
const LONG_REQUEST_MS = 45_000;
const LONG_SSE_MS = 45_000;
const IGNORED_PREFIXES = ['/api/health', '/api/dev/health', '/api/workspace/status'];
const AI_SSE_PREFIXES = ['/api/chat', '/api/copilot', '/api/dev/'];

function shouldIgnoreRequest(request) {
  const url = String(request?.url || '');
  return IGNORED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function shouldIgnoreLongSSE(request) {
  const url = String(request?.url || '');
  return AI_SSE_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function getReasons(request) {
  if (!request || shouldIgnoreRequest(request)) return [];

  const reasons = [];
  const ageMs = request.ageMs || 0;
  const phase = request.phase || 'start';

  if (phase === 'start' && ageMs >= LONG_PENDING_MS) {
    reasons.push(`waiting ${Math.round(ageMs / 1000)}s for response headers`);
  }

  if (!request.isSSE && ageMs >= LONG_REQUEST_MS) {
    reasons.push(`request has been active for ${Math.round(ageMs / 1000)}s`);
  }

  if (request.isSSE && !shouldIgnoreLongSSE(request) && ageMs >= LONG_SSE_MS) {
    reasons.push(`SSE request has been active for ${Math.round(ageMs / 1000)}s`);
  }

  return reasons;
}

export function useActiveRequestMonitor({ enabled = true, isLeader, sendBackground, log }) {
  const requestsRef = useRef([]);
  const alertTimesRef = useRef(new Map());

  useEffect(() => {
    if (!enabled || !isLeader || typeof sendBackground !== 'function') return;

    requestsRef.current = getActiveRequestsSnapshot();
    const unsubscribe = onActiveRequestsChange((snapshot) => {
      requestsRef.current = Array.isArray(snapshot) ? snapshot : [];
    });

    function inspect() {
      const now = Date.now();
      const activeIds = new Set(requestsRef.current.map((request) => request.id));

      for (const [id, ts] of alertTimesRef.current) {
        if (!activeIds.has(id) || now - ts > ALERT_COOLDOWN_MS) {
          alertTimesRef.current.delete(id);
        }
      }

      for (const request of requestsRef.current) {
        const reasons = getReasons(request);
        if (reasons.length === 0) continue;

        const lastAlertAt = alertTimesRef.current.get(request.id) || 0;
        if (now - lastAlertAt < ALERT_COOLDOWN_MS) continue;
        alertTimesRef.current.set(request.id, now);

        const summary = `Active request ${request.method} ${request.url} looks stuck`;
        log?.({
          type: 'health-warning',
          message: summary,
          severity: 'warning',
          detail: reasons.join('; '),
        });

        sendBackground('auto-errors', [
          '[AUTO-ERROR] Active HTTP request appears stuck',
          '',
          `Request: ${request.method} ${request.url}`,
          `Phase: ${request.phase || 'unknown'}`,
          `Age: ${Math.round((request.ageMs || 0) / 1000)}s`,
          request.status ? `Status: ${request.status}` : '',
          request.isSSE ? 'Type: SSE stream' : 'Type: standard request',
          '',
          `Observed problem: ${reasons.join('; ')}`,
          '',
          'Investigate the caller, abort handling, and server route. If a clear fix is available, apply it.',
        ].filter(Boolean).join('\n'), {
          incidentMeta: {
            kind: 'client-request',
            severity: 'elevated',
            category: 'request-stall',
            source: 'useActiveRequestMonitor',
            subsystem: 'client',
            component: request.isSSE ? 'sse-request' : 'http-request',
            fingerprint: `client-request:${request.id}`,
          },
          incidentContext: {
            request,
            reasons,
            summary,
          },
        });
      }
    }

    inspect();
    const interval = setInterval(inspect, CHECK_INTERVAL_MS);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [enabled, isLeader, sendBackground, log]);
}
