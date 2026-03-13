import { useEffect, useRef } from 'react';
import { apiFetch } from '../api/http.js';

const POLL_INTERVAL_MS = 15_000;
const STALE_IDLE_MS = 30_000;
const ALERT_COOLDOWN_MS = 300_000;
const STATUS_URL = '/api/dev/health';
const AI_RUNTIME_GROUPS = [
  { key: 'chat', label: 'chat', longMs: 180_000 },
  { key: 'copilot', label: 'copilot', longMs: 120_000 },
  { key: 'gmail', label: 'gmail ai', longMs: 120_000 },
  { key: 'parse', label: 'parse', longMs: 120_000 },
];

function collectAlerts(group, bucket) {
  const sessions = Array.isArray(bucket?.sessions) ? bucket.sessions : [];
  const alerts = [];

  for (const session of sessions) {
    const reasons = [];

    if ((session.idleMs || 0) >= STALE_IDLE_MS) {
      reasons.push(`no ${group.label} activity for ${Math.round((session.idleMs || 0) / 1000)}s`);
    }
    if (session.phase === 'starting' && (session.ageMs || 0) >= 60_000) {
      reasons.push(`${group.label} request is still starting after ${Math.round((session.ageMs || 0) / 1000)}s`);
    }
    if ((session.ageMs || 0) >= group.longMs) {
      reasons.push(`${group.label} request has been active for ${Math.round((session.ageMs || 0) / 1000)}s`);
    }
    if (session.clientConnected === false) {
      reasons.push('client disconnected before the AI operation finished');
    }

    if (reasons.length > 0) {
      alerts.push({ session, reasons });
    }
  }

  return alerts;
}

export function useAiRuntimeMonitor({ enabled = true, isLeader, sendBackground, log }) {
  const alertTimesRef = useRef(new Map());
  const statusErrorRef = useRef(0);

  useEffect(() => {
    if (!enabled || !isLeader || typeof sendBackground !== 'function') return;

    let cancelled = false;

    async function pollRuntimeStatus() {
      try {
        const res = await apiFetch(STATUS_URL, { timeout: 8_000 });
        if (!res.ok) return;

        const data = await res.json().catch(() => null);
        const ai = data?.ai || {};
        const now = Date.now();
        statusErrorRef.current = 0;

        const alerts = AI_RUNTIME_GROUPS.flatMap((group) => collectAlerts(group, ai[group.key]));
        const activeIds = new Set(alerts.map(({ session }) => session.id));

        for (const [id, ts] of alertTimesRef.current) {
          if (!activeIds.has(id) || now - ts > ALERT_COOLDOWN_MS) {
            alertTimesRef.current.delete(id);
          }
        }

        for (const { session, reasons } of alerts) {
          const lastAlertAt = alertTimesRef.current.get(session.id) || 0;
          if (now - lastAlertAt < ALERT_COOLDOWN_MS) continue;
          alertTimesRef.current.set(session.id, now);

          const kindLabel = session.kind || 'ai';
          const summary = `${kindLabel} runtime session ${session.id} looks stuck during ${session.phase}`;
          log?.({
            type: 'health-warning',
            message: summary,
            severity: 'warning',
            detail: reasons.join('; '),
          });

          sendBackground('auto-errors', [
            '[AUTO-ERROR] AI runtime session appears stuck',
            '',
            `Kind: ${kindLabel}`,
            `Session: ${session.id}`,
            session.route ? `Route: ${session.route}` : '',
            session.action ? `Action: ${session.action}` : '',
            `Phase: ${session.phase}`,
            `Age: ${Math.round((session.ageMs || 0) / 1000)}s`,
            `Idle: ${Math.round((session.idleMs || 0) / 1000)}s`,
            session.provider ? `Provider: ${session.provider}` : '',
            session.conversationId ? `Conversation: ${session.conversationId}` : '',
            session.promptPreview ? `Prompt preview: ${session.promptPreview}` : '',
            '',
            `Observed problem: ${reasons.join('; ')}`,
            '',
            'Investigate the route, streaming path, and provider cleanup. If a fix is clear, apply it.',
          ].filter(Boolean).join('\n'), {
            incidentMeta: {
              kind: 'ai-runtime',
              severity: 'urgent',
              category: 'runtime-stall',
              source: 'useAiRuntimeMonitor',
              subsystem: 'ai',
              component: group.key,
              fingerprint: `ai-runtime:${session.id}`,
            },
            incidentContext: {
              session,
              reasons,
              group: group.key,
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
            message: `AI runtime monitor could not read ${STATUS_URL}`,
            severity: 'warning',
            detail: err.message || 'Unknown error',
          });
        }
      }
    }

    pollRuntimeStatus();
    const interval = setInterval(pollRuntimeStatus, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, isLeader, sendBackground, log]);
}
