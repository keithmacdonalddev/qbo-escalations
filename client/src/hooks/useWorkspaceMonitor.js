import { useEffect, useRef } from 'react';
import { apiFetch } from '../api/http.js';

const POLL_INTERVAL_MS = 5_000;
const STALE_IDLE_MS = 15_000;
const LONG_PASS1_MS = 20_000;
const LONG_TOTAL_MS = 45_000;
const ALERT_COOLDOWN_MS = 300_000;
const STATUS_URL = '/api/workspace/status';

export function useWorkspaceMonitor({ enabled = true, isLeader, sendBackground, log }) {
  const alertTimesRef = useRef(new Map());
  const statusErrorRef = useRef(0);

  useEffect(() => {
    if (!enabled || !isLeader || typeof sendBackground !== 'function') return;

    let cancelled = false;

    function shouldAlert(session) {
      if (!session || typeof session !== 'object') return [];
      const reasons = [];

      if (session.idleMs >= STALE_IDLE_MS) {
        reasons.push(`no workspace activity for ${Math.round(session.idleMs / 1000)}s`);
      }
      if (session.phase === 'pass1' && session.ageMs >= LONG_PASS1_MS) {
        reasons.push(`pass 1 has been running for ${Math.round(session.ageMs / 1000)}s`);
      }
      if (session.ageMs >= LONG_TOTAL_MS) {
        reasons.push(`workspace request has been active for ${Math.round(session.ageMs / 1000)}s total`);
      }

      return reasons;
    }

    async function pollWorkspaceStatus() {
      try {
        const res = await apiFetch(STATUS_URL, { timeout: 8_000 });
        if (!res.ok) return;

        const data = await res.json().catch(() => null);
        const sessions = Array.isArray(data?.workspace?.sessions) ? data.workspace.sessions : [];
        const now = Date.now();
        statusErrorRef.current = 0;

        for (const [id, ts] of alertTimesRef.current) {
          if (!sessions.some((session) => session.id === id) || now - ts > ALERT_COOLDOWN_MS) {
            alertTimesRef.current.delete(id);
          }
        }

        for (const session of sessions) {
          const reasons = shouldAlert(session);
          if (reasons.length === 0) continue;

          const lastAlertAt = alertTimesRef.current.get(session.id) || 0;
          if (now - lastAlertAt < ALERT_COOLDOWN_MS) continue;
          alertTimesRef.current.set(session.id, now);

          const summary = `Workspace session ${session.id} looks stuck during ${session.phase}`;
          log?.({
            type: 'health-warning',
            message: summary,
            severity: 'warning',
            detail: reasons.join('; '),
          });

          sendBackground('auto-errors', [
            '[AUTO-ERROR] Workspace session appears stuck',
            '',
            `Session: ${session.id}`,
            `Phase: ${session.phase}`,
            `Age: ${Math.round(session.ageMs / 1000)}s`,
            `Idle: ${Math.round(session.idleMs / 1000)}s`,
            session.promptPreview ? `Prompt preview: ${session.promptPreview}` : '',
            '',
            `Observed problem: ${reasons.join('; ')}`,
            '',
            'Investigate the workspace route, streaming path, and subprocess lifecycle. If a fix is clear, apply it.',
          ].filter(Boolean).join('\n'), {
            incidentMeta: {
              kind: 'workspace-runtime',
              severity: 'urgent',
              category: 'runtime-stall',
              source: 'useWorkspaceMonitor',
              subsystem: 'workspace',
              component: 'workspace-route',
              fingerprint: `workspace-runtime:${session.id}`,
            },
            incidentContext: {
              session,
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
            message: `Workspace monitor could not read ${STATUS_URL}`,
            severity: 'warning',
            detail: err.message || 'Unknown error',
          });
        }
      }
    }

    pollWorkspaceStatus();
    const interval = setInterval(pollWorkspaceStatus, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, isLeader, sendBackground, log]);
}
