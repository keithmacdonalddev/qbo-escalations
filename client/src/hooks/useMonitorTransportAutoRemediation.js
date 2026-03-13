import { useEffect, useRef } from 'react';
import { apiFetch } from '../api/http.js';
import { requestMonitorTransportReconnect } from '../lib/monitorTransport.js';

const REMEDIATION_COOLDOWN_MS = 300_000;
const MIN_ISSUE_AGE_MS = 90_000;
const INCIDENT_TRANSITION_URL = '/api/dev/monitor/incidents/transition';

async function transitionTransportIncident(match, state, detail = {}) {
  return apiFetch(INCIDENT_TRANSITION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      match,
      state,
      reason: detail.reason,
      note: detail.note,
      error: detail.error,
    }),
    timeout: 8_000,
  });
}

export function useMonitorTransportAutoRemediation({ enabled = true, isLeader, log, monitorTransport }) {
  const cooldownRef = useRef(new Map());
  const remediatingRef = useRef(new Set());

  useEffect(() => {
    if (!enabled || !isLeader) return;

    const transports = Array.isArray(monitorTransport?.items) ? monitorTransport.items : [];
    const now = Date.now();

    // Prune cooldown/remediating entries for transports no longer in snapshot
    const currentKeys = new Set(transports.map((t) => t?.key).filter(Boolean));
    for (const [key, ts] of cooldownRef.current) {
      if (!currentKeys.has(key) || now - ts > REMEDIATION_COOLDOWN_MS) {
        cooldownRef.current.delete(key);
      }
    }
    for (const key of remediatingRef.current) {
      if (!currentKeys.has(key)) {
        remediatingRef.current.delete(key);
      }
    }

    for (const transport of transports) {
      if (!transport?.key) continue;

      if (transport.state === 'connected') {
        if (!remediatingRef.current.has(transport.key)) continue;
        remediatingRef.current.delete(transport.key);
        transitionTransportIncident(
          { kind: 'monitor-transport', transportKey: transport.key },
          'resolved',
          {
            reason: 'monitor-transport-reconnected',
            note: `${transport.label || transport.key} reconnected after supervisor remediation`,
          }
        ).catch(() => {});
        log?.({
          type: 'fix-applied',
          message: `${transport.label || transport.key} monitor stream reconnected`,
          severity: 'info',
        });
        continue;
      }

      if (transport.state !== 'cooldown' && transport.state !== 'degraded') continue;
      const lastErrorAt = transport.lastErrorAt ? new Date(transport.lastErrorAt).getTime() : 0;
      if (!lastErrorAt || now - lastErrorAt < MIN_ISSUE_AGE_MS) continue;

      const lastAttemptAt = cooldownRef.current.get(transport.key) || 0;
      if (now - lastAttemptAt < REMEDIATION_COOLDOWN_MS) continue;
      cooldownRef.current.set(transport.key, now);
      remediatingRef.current.add(transport.key);

      transitionTransportIncident(
        { kind: 'monitor-transport', transportKey: transport.key },
        'remediating',
        {
          reason: 'monitor-transport-auto-remediation',
          note: `Supervisor forced reconnect for ${transport.label || transport.key} after sustained ${transport.state}`,
        }
      ).catch(() => {});

      const requested = requestMonitorTransportReconnect(transport.key, {
        reason: 'Supervisor forced reconnect after sustained transport degradation',
      });

      log?.({
        type: requested ? 'fix-applied' : 'health-warning',
        message: `${requested ? 'Forced' : 'Attempted'} reconnect for ${transport.label || transport.key}`,
        severity: requested ? 'info' : 'warning',
        detail: `${transport.state} for ${Math.round((now - lastErrorAt) / 1000)}s`,
      });
    }
  }, [enabled, isLeader, log, monitorTransport]);
}
