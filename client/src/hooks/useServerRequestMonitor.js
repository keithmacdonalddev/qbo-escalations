import { useEffect, useRef } from 'react';
import { apiFetch } from '../api/http.js';

const POLL_INTERVAL_MS = 15_000;
const ALERT_COOLDOWN_MS = 300_000;
const STATUS_URL = '/api/dev/health';
const START_THRESHOLD_MS = 20_000;
const REQUEST_THRESHOLD_MS = 45_000;
const IGNORED_PREFIXES = [
  '/api/health',
  '/api/dev/health',
  '/api/dev/server-errors',
  '/api/dev/watch',
  '/api/workspace/status',
  '/api/chat',
  '/api/copilot',
  '/api/dev/chat',
];

function shouldIgnorePath(pathname) {
  const path = String(pathname || '');
  return IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function getReasons(request) {
  if (!request || shouldIgnorePath(request.path)) return [];

  const reasons = [];
  if ((request.ageMs || 0) >= START_THRESHOLD_MS && request.phase === 'running') {
    reasons.push(`backend request has been running for ${Math.round((request.ageMs || 0) / 1000)}s`);
  }
  if ((request.ageMs || 0) >= REQUEST_THRESHOLD_MS) {
    reasons.push(`backend request exceeded ${Math.round(REQUEST_THRESHOLD_MS / 1000)}s`);
  }
  if (request.clientConnected === false) {
    reasons.push('client disconnected while the server request was still active');
  }
  return reasons;
}

export function useServerRequestMonitor({ enabled = true, isLeader, sendBackground, log }) {
  const alertTimesRef = useRef(new Map());
  const statusErrorRef = useRef(0);

  useEffect(() => {
    if (!enabled || !isLeader || typeof sendBackground !== 'function') return;

    let cancelled = false;

    async function pollServerRequests() {
      try {
        const res = await apiFetch(STATUS_URL, { timeout: 8_000 });
        if (!res.ok) return;

        const data = await res.json().catch(() => null);
        const requests = Array.isArray(data?.requests?.requests) ? data.requests.requests : [];
        const now = Date.now();
        statusErrorRef.current = 0;

        const activeIds = new Set(requests.map((request) => request.id));
        for (const [id, ts] of alertTimesRef.current) {
          if (!activeIds.has(id) || now - ts > ALERT_COOLDOWN_MS) {
            alertTimesRef.current.delete(id);
          }
        }

        for (const request of requests) {
          const reasons = getReasons(request);
          if (reasons.length === 0) continue;

          const lastAlertAt = alertTimesRef.current.get(request.id) || 0;
          if (now - lastAlertAt < ALERT_COOLDOWN_MS) continue;
          alertTimesRef.current.set(request.id, now);

          const summary = `Server request ${request.method} ${request.path} looks stuck`;
          log?.({
            type: 'health-warning',
            message: summary,
            severity: 'warning',
            detail: reasons.join('; '),
          });

          sendBackground('auto-errors', [
            '[AUTO-ERROR] Server request appears stuck',
            '',
            `Request: ${request.method} ${request.path}`,
            request.requestId ? `Request ID: ${request.requestId}` : '',
            `Phase: ${request.phase || 'unknown'}`,
            `Age: ${Math.round((request.ageMs || 0) / 1000)}s`,
            request.statusCode ? `Status: ${request.statusCode}` : '',
            '',
            `Observed problem: ${reasons.join('; ')}`,
            '',
            'Investigate the server route, downstream dependency, and abort path. If a clear fix is available, apply it.',
          ].filter(Boolean).join('\n'), {
            incidentMeta: {
              kind: 'server-request',
              severity: 'urgent',
              category: 'request-stall',
              source: 'useServerRequestMonitor',
              subsystem: 'server',
              component: 'request-runtime',
              fingerprint: `server-request:${request.requestId || request.id || `${request.method}:${request.path}`}`,
            },
            incidentContext: {
              request,
              reasons,
              summary,
            },
          });
        }
      } catch (err) {
        if (cancelled) return;
        statusErrorRef.current += 1;
        if (statusErrorRef.current === 1 || statusErrorRef.current % 4 === 0) {
          log?.({
            type: 'health-warning',
            message: `Server request monitor could not read ${STATUS_URL}`,
            severity: 'warning',
            detail: err.message || 'Unknown error',
          });
        }
      }
    }

    pollServerRequests();
    const interval = setInterval(pollServerRequests, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, isLeader, sendBackground, log]);
}
