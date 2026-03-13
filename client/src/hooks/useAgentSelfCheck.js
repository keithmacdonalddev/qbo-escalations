import { useState, useEffect, useRef, useCallback } from 'react';

const AI_RUNTIME_GROUPS = [
  { key: 'chat', label: 'Chat', longMs: 180_000 },
  { key: 'copilot', label: 'Copilot', longMs: 120_000 },
  { key: 'gmail', label: 'Gmail AI', longMs: 120_000 },
  { key: 'parse', label: 'Parse', longMs: 120_000 },
];

function appendAiHealthIssues(issues, aiRuntime) {
  for (const group of AI_RUNTIME_GROUPS) {
    const bucket = aiRuntime?.[group.key] || {};
    if ((bucket.staleCount || 0) > 0) {
      issues.push(`${bucket.staleCount} ${group.label} session${bucket.staleCount === 1 ? '' : 's'} appear stalled`);
    }
    if ((bucket.longestActiveMs || 0) > group.longMs) {
      issues.push(`${group.label} activity running for ${Math.round((bucket.longestActiveMs || 0) / 1000)}s`);
    }
    if (Array.isArray(bucket.sessions)) {
      const disconnected = bucket.sessions.filter((session) => session && session.clientConnected === false);
      if (disconnected.length > 0) {
        issues.push(`${disconnected.length} ${group.label} session${disconnected.length === 1 ? '' : 's'} lost the client connection`);
      }
    }
  }
}

function appendRequestHealthIssues(issues, requestRuntime) {
  const requests = requestRuntime || {};
  if ((requests.staleCount || 0) > 0) {
    issues.push(`${requests.staleCount} server request${requests.staleCount === 1 ? '' : 's'} appear stalled`);
  }
  if ((requests.longestActiveMs || 0) > 45_000) {
    issues.push(`Server request activity running for ${Math.round((requests.longestActiveMs || 0) / 1000)}s`);
  }
  if (Array.isArray(requests.requests)) {
    const disconnected = requests.requests.filter((request) => request && request.clientConnected === false);
    if (disconnected.length > 0) {
      issues.push(`${disconnected.length} server request${disconnected.length === 1 ? '' : 's'} lost the client connection`);
    }
  }
}

function appendBackgroundHealthIssues(issues, backgroundRuntime) {
  const background = backgroundRuntime || {};
  if ((background.staleCount || 0) > 0) {
    issues.push(`${background.staleCount} background task${background.staleCount === 1 ? '' : 's'} appear stalled`);
  }
  if ((background.longestActiveMs || 0) > 60_000) {
    issues.push(`Background task activity running for ${Math.round((background.longestActiveMs || 0) / 1000)}s`);
  }
  if (Array.isArray(background.services)) {
    const errored = background.services.filter((service) => service && service.state === 'error');
    if (errored.length > 0) {
      issues.push(`${errored.length} background service${errored.length === 1 ? '' : 's'} reported an error state`);
    }
  }
}

function appendMonitorHealthIssues(issues, monitorRuntime) {
  const monitor = monitorRuntime || {};
  if ((monitor.failedIncidents || 0) > 0) {
    issues.push(`${monitor.failedIncidents} monitor incident${monitor.failedIncidents === 1 ? '' : 's'} failed`);
  }
  if ((monitor.remediatingIncidents || 0) > 0) {
    issues.push(`${monitor.remediatingIncidents} monitor incident${monitor.remediatingIncidents === 1 ? '' : 's'} currently remediating`);
  }
  if ((monitor.activeMonitorTransportIncidents || 0) > 0) {
    issues.push(`${monitor.activeMonitorTransportIncidents} monitor transport incident${monitor.activeMonitorTransportIncidents === 1 ? '' : 's'} affecting supervisor visibility`);
  }
  if ((monitor.totalSuppressed || 0) >= 20) {
    issues.push(`Monitor channel has suppressed ${monitor.totalSuppressed} duplicate incident reports`);
  }
}

function appendRemediationHealthIssues(issues, remediationRuntime) {
  const remediation = remediationRuntime || {};
  if ((remediation.activeAttempts || 0) > 0) {
    issues.push(`${remediation.activeAttempts} runtime remediation attempt${remediation.activeAttempts === 1 ? '' : 's'} still running`);
  }
  if ((remediation.failedAttempts || 0) > 0) {
    issues.push(`${remediation.failedAttempts} runtime remediation attempt${remediation.failedAttempts === 1 ? '' : 's'} failed`);
  }
  if ((remediation.partialAttempts || 0) > 0) {
    issues.push(`${remediation.partialAttempts} runtime remediation attempt${remediation.partialAttempts === 1 ? '' : 's'} partially cleared the target`);
  }
}

function appendDomainHealthIssues(issues, domainsRuntime) {
  const domains = domainsRuntime || {};
  const entries = [
    ['gmail', 'Gmail'],
    ['calendar', 'Calendar'],
    ['escalations', 'Escalations'],
  ];

  for (const [key, label] of entries) {
    const domain = domains[key] || {};
    if (domain.status === 'degraded') {
      issues.push(`${label} domain is degraded`);
    } else if (domain.status === 'warning') {
      issues.push(`${label} domain needs attention`);
    }
    if (Array.isArray(domain.issues)) {
      for (const issue of domain.issues.slice(0, 2)) {
        if (issue) issues.push(`${label}: ${issue}`);
      }
    }
    if (domain.remediation?.required && domain.remediation?.message) {
      issues.push(`${label}: ${domain.remediation.message}`);
    }
  }
}

function appendMonitorTransportIssues(issues, monitorTransport) {
  const transports = Array.isArray(monitorTransport?.items) ? monitorTransport.items : [];
  for (const transport of transports) {
    if (transport.state === 'cooldown') {
      issues.push(`${transport.label || transport.key} is cooling down before reconnect`);
    } else if (transport.state === 'degraded') {
      issues.push(`${transport.label || transport.key} is degraded`);
    }
  }
}

/**
 * Self-monitoring heartbeat for the dev agent system.
 *
 * Runs leader-only checks every 60s:
 *   1. Server reachability via raw fetch to /api/health (bypasses circuit breaker)
 *   2. Time since last successful background send
 *
 * Returns:
 *   - agentHealthy: boolean (true = all checks pass)
 *   - healthDetails: { issues: string[], checkedAt: number|null }
 *   - runtimeHealth: last successful /api/dev/health snapshot
 *   - recordBgSuccess: () => void  (call after each successful background send)
 */
export function useAgentSelfCheck({ isLeader, log, monitorTransport } = {}) {
  const [agentHealthy, setAgentHealthy] = useState(true);
  const [healthDetails, setHealthDetails] = useState({ issues: [], checkedAt: null });
  const [runtimeHealth, setRuntimeHealth] = useState(null);
  const lastSuccessRef = useRef({ bg: 0, server: 0 });
  const logRef = useRef(log);
  logRef.current = log;

  // Stable callback for external callers to record a successful bg send
  const recordBgSuccess = useCallback(() => {
    lastSuccessRef.current.bg = Date.now();
  }, []);

  useEffect(() => {
    if (!isLeader) return;

    async function runCheck() {
      const issues = [];
      const now = Date.now();
      let latestRuntimeHealth = null;

      // 1. Server reachable? Use raw fetch to avoid circuit breaker / apiFetch wrappers
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch('/api/health', { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          lastSuccessRef.current.server = now;
        } else {
          issues.push(`Server returned ${res.status}`);
        }
      } catch {
        const downFor = now - lastSuccessRef.current.server;
        if (lastSuccessRef.current.server > 0 && downFor > 90_000) {
          issues.push(`Server unreachable for ${Math.round(downFor / 1000)}s`);
        } else if (lastSuccessRef.current.server === 0) {
          issues.push('Server has never responded');
        }
        // If server === 0 and downFor < 90s, we're in the grace period — no issue yet
      }

      // 2. Server-observable dev/runtime health
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch('/api/dev/health', { signal: controller.signal, headers: { 'Cache-Control': 'no-cache' } });
        clearTimeout(timeout);
        if (res.ok) {
          latestRuntimeHealth = await res.json().catch(() => null);
          setRuntimeHealth(latestRuntimeHealth);

          const workspace = latestRuntimeHealth?.workspace || {};
          const devSession = latestRuntimeHealth?.session || {};
          const aiRuntime = latestRuntimeHealth?.ai || {};
          const requestRuntime = latestRuntimeHealth?.requests || {};
          const backgroundRuntime = latestRuntimeHealth?.background || {};
          const monitorRuntime = latestRuntimeHealth?.monitor || {};
          const remediationRuntime = latestRuntimeHealth?.remediation || {};
          const domainsRuntime = latestRuntimeHealth?.domains || {};

          if ((workspace.staleCount || 0) > 0) {
            issues.push(`${workspace.staleCount} workspace session${workspace.staleCount === 1 ? '' : 's'} appear stalled`);
          }
          if ((workspace.longestActiveMs || 0) > 180_000) {
            issues.push(`Workspace activity running for ${Math.round(workspace.longestActiveMs / 1000)}s`);
          }
          appendAiHealthIssues(issues, aiRuntime);
          appendRequestHealthIssues(issues, requestRuntime);
          appendBackgroundHealthIssues(issues, backgroundRuntime);
          appendMonitorHealthIssues(issues, monitorRuntime);
          appendRemediationHealthIssues(issues, remediationRuntime);
          appendDomainHealthIssues(issues, domainsRuntime);
          if (Array.isArray(devSession.sessions)) {
            const inactive = devSession.sessions.filter((session) => session && session.alive === false);
            if (inactive.length > 0) {
              issues.push(`${inactive.length} dev session${inactive.length === 1 ? '' : 's'} marked inactive`);
            }
            // Tool-use phases go quiet while the CLI runs file edits, bash
            // commands, etc.  Use a higher idle threshold to avoid false positives.
            const TOOL_PHASE_IDLE_MS = 180_000;
            const DEFAULT_IDLE_MS = 45_000;
            const staleStreaming = devSession.sessions.filter((session) => {
              if (!session || !session.alive || typeof session.idleMs !== 'number') return false;
              const threshold = session.phase === 'tools' || session.phase === 'spawning'
                ? TOOL_PHASE_IDLE_MS
                : DEFAULT_IDLE_MS;
              return session.idleMs > threshold;
            });
            if (staleStreaming.length > 0) {
              issues.push(`${staleStreaming.length} dev session${staleStreaming.length === 1 ? '' : 's'} idle for >45s`);
            }
          }
        } else {
          issues.push(`Dev health returned ${res.status}`);
        }
      } catch {
        issues.push('Dev health endpoint unreachable');
      }

      // 3. Background sends working?
      // Only flag if we HAVE sent before but haven't in 10+ minutes
      if (lastSuccessRef.current.bg > 0) {
        const sinceLast = now - lastSuccessRef.current.bg;
        if (sinceLast > 600_000) {
          issues.push(`No successful background send in ${Math.round(sinceLast / 60_000)}m`);
        }
      }

      appendMonitorTransportIssues(issues, monitorTransport);

      const healthy = issues.length === 0;
      setAgentHealthy(healthy);
      setHealthDetails({ issues, checkedAt: now });

      if (!healthy) {
        logRef.current?.({
          type: 'agent-health',
          message: `Self-check: ${issues.join('; ')}`,
          severity: 'warning',
        });
      }
    }

    // Initial check after 10s grace period (let everything boot)
    const initialDelay = setTimeout(runCheck, 10_000);

    // Subsequent checks every 60s
    const interval = setInterval(runCheck, 60_000);

    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
    };
  }, [isLeader, monitorTransport]);

  return { agentHealthy, healthDetails, runtimeHealth, recordBgSuccess };
}
