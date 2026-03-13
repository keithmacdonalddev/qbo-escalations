import { useEffect, useRef } from 'react';
import { apiFetch } from '../api/http.js';

const POLL_INTERVAL_MS = 15_000;
const ALERT_COOLDOWN_MS = 300_000;
const STATUS_URL = '/api/dev/health';
const DOMAIN_ENTRIES = [
  { key: 'gmail', label: 'Gmail' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'escalations', label: 'Escalations' },
];

export function useDomainHealthMonitor({ enabled = true, isLeader, sendBackground, log }) {
  const alertTimesRef = useRef(new Map());
  const statusErrorRef = useRef(0);

  useEffect(() => {
    if (!enabled || !isLeader || typeof sendBackground !== 'function') return;

    let cancelled = false;

    async function pollDomainHealth() {
      try {
        const res = await apiFetch(STATUS_URL, { timeout: 8_000 });
        if (!res.ok) return;

        const data = await res.json().catch(() => null);
        const domains = data?.domains || {};
        const now = Date.now();
        statusErrorRef.current = 0;

        for (const [key, ts] of alertTimesRef.current) {
          if (now - ts > ALERT_COOLDOWN_MS || !domains[key]) {
            alertTimesRef.current.delete(key);
          }
        }

        for (const entry of DOMAIN_ENTRIES) {
          const domain = domains[entry.key] || {};
          if (domain.status !== 'degraded' && domain.status !== 'warning') continue;

          const lastAlertAt = alertTimesRef.current.get(entry.key) || 0;
          if (now - lastAlertAt < ALERT_COOLDOWN_MS) continue;
          alertTimesRef.current.set(entry.key, now);

          const issues = Array.isArray(domain.issues) ? domain.issues.filter(Boolean) : [];
          const summary = `${entry.label} domain ${domain.status === 'degraded' ? 'is degraded' : 'needs attention'}`;

          log?.({
            type: 'health-warning',
            message: summary,
            severity: domain.status === 'degraded' ? 'warning' : 'info',
            detail: issues.join('; ') || `Active requests: ${domain.activeRequests || 0}`,
          });

          sendBackground('auto-errors', [
            `[AUTO-ERROR] ${entry.label} domain health warning`,
            '',
            `Status: ${domain.status || 'unknown'}`,
            domain.auth?.appConfigured === false ? 'Google app credentials are not configured' : '',
            domain.auth?.manualActionRequired ? 'Google account is disconnected and needs reconnect' : '',
            `Active requests: ${domain.activeRequests || 0}`,
            domain.recentFailureCount ? `Recent failures: ${domain.recentFailureCount}` : '',
            domain.recentPipelineErrorCount ? `Recent server errors: ${domain.recentPipelineErrorCount}` : '',
            domain.lastFailure?.path ? `Last failure: ${domain.lastFailure.method || 'GET'} ${domain.lastFailure.path}` : '',
            '',
            domain.remediation?.message
              ? `Recommended remediation: ${domain.remediation.message}`
              : (issues.length > 0 ? `Observed problem: ${issues.join('; ')}` : 'Observed problem: domain health summary is not healthy'),
            '',
            'Investigate the subsystem-specific route, integration state, and remediation path. If a clear safe fix exists, apply it.',
          ].filter(Boolean).join('\n'), {
            incidentMeta: {
              kind: 'domain-health',
              severity: domain.status === 'degraded' ? 'urgent' : 'elevated',
              category: 'domain-health',
              source: 'useDomainHealthMonitor',
              subsystem: entry.key,
              component: 'domain',
              fingerprint: `domain-health:${entry.key}:${domain.status || 'unknown'}`,
            },
            incidentContext: {
              domain: entry.key,
              label: entry.label,
              summary,
              status: domain.status || 'unknown',
              issues,
              remediation: domain.remediation || null,
              auth: domain.auth || null,
              recentFailureCount: domain.recentFailureCount || 0,
              recentPipelineErrorCount: domain.recentPipelineErrorCount || 0,
              lastFailure: domain.lastFailure || null,
            },
          });
        }
      } catch (err) {
        if (cancelled) return;
        statusErrorRef.current += 1;
        if (statusErrorRef.current === 1 || statusErrorRef.current % 4 === 0) {
          log?.({
            type: 'health-warning',
            message: `Domain health monitor could not read ${STATUS_URL}`,
            severity: 'warning',
            detail: err.message || 'Unknown error',
          });
        }
      }
    }

    pollDomainHealth();
    const interval = setInterval(pollDomainHealth, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, isLeader, sendBackground, log]);
}
