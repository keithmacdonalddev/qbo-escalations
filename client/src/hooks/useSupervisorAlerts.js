import { useEffect, useRef } from 'react';

const ALERT_COOLDOWN_MS = 300_000;
const MONITOR_TRANSPORT_ALERT_THRESHOLD_MS = 60_000;
const AI_RUNTIME_GROUPS = [
  { key: 'chat', label: 'chat', longMs: 180_000 },
  { key: 'copilot', label: 'copilot', longMs: 120_000 },
  { key: 'gmail', label: 'gmail ai', longMs: 120_000 },
  { key: 'parse', label: 'parse', longMs: 120_000 },
];

function appendAiRuntimeAlerts(nextAlerts, aiRuntime) {
  for (const group of AI_RUNTIME_GROUPS) {
    const bucket = aiRuntime?.[group.key] || {};
    if ((bucket.staleCount || 0) > 0) {
      nextAlerts.push({
        key: `${group.key}-stale`,
        summary: `${bucket.staleCount} ${group.label} session${bucket.staleCount === 1 ? '' : 's'} appear stalled`,
        detail: `Longest ${group.label} activity: ${Math.round((bucket.longestActiveMs || 0) / 1000)}s`,
      });
    }

    if ((bucket.longestActiveMs || 0) > group.longMs) {
      nextAlerts.push({
        key: `${group.key}-long`,
        summary: `${group.label} runtime has unusually long-running activity`,
        detail: `Longest active ${group.label} session: ${Math.round((bucket.longestActiveMs || 0) / 1000)}s`,
      });
    }

    if (Array.isArray(bucket.sessions)) {
      const disconnected = bucket.sessions.filter((session) => session && session.clientConnected === false);
      if (disconnected.length > 0) {
        nextAlerts.push({
          key: `${group.key}-disconnect`,
          summary: `${disconnected.length} ${group.label} session${disconnected.length === 1 ? '' : 's'} lost the client connection`,
          detail: disconnected
            .map((session) => `${session.route || group.label}:${session.phase || 'unknown'}:${Math.round((session.ageMs || 0) / 1000)}s`)
            .join(', '),
        });
      }
    }
  }
}

function appendServerRequestAlerts(nextAlerts, requestRuntime) {
  const requests = requestRuntime || {};

  if ((requests.staleCount || 0) > 0) {
    nextAlerts.push({
      key: 'server-requests-stale',
      summary: `${requests.staleCount} server request${requests.staleCount === 1 ? '' : 's'} appear stalled`,
      detail: `Longest server request: ${Math.round((requests.longestActiveMs || 0) / 1000)}s`,
    });
  }

  if ((requests.longestActiveMs || 0) > 45_000) {
    nextAlerts.push({
      key: 'server-requests-long',
      summary: 'Server runtime has unusually long-running request activity',
      detail: `Longest active server request: ${Math.round((requests.longestActiveMs || 0) / 1000)}s`,
    });
  }

  if (Array.isArray(requests.requests)) {
    const disconnected = requests.requests.filter((request) => request && request.clientConnected === false);
    if (disconnected.length > 0) {
      nextAlerts.push({
        key: 'server-requests-disconnect',
        summary: `${disconnected.length} server request${disconnected.length === 1 ? '' : 's'} lost the client connection`,
        detail: disconnected
          .map((request) => `${request.method || 'GET'}:${request.path || 'unknown'}:${Math.round((request.ageMs || 0) / 1000)}s`)
          .join(', '),
      });
    }
  }
}

function appendBackgroundAlerts(nextAlerts, backgroundRuntime) {
  const background = backgroundRuntime || {};

  if ((background.staleCount || 0) > 0) {
    nextAlerts.push({
      key: 'background-stale',
      summary: `${background.staleCount} background task${background.staleCount === 1 ? '' : 's'} appear stalled`,
      detail: `Longest background task: ${Math.round((background.longestActiveMs || 0) / 1000)}s`,
    });
  }

  if ((background.longestActiveMs || 0) > 60_000) {
    nextAlerts.push({
      key: 'background-long',
      summary: 'Background runtime has unusually long-running task activity',
      detail: `Longest active background task: ${Math.round((background.longestActiveMs || 0) / 1000)}s`,
    });
  }

  if (Array.isArray(background.services)) {
    const errored = background.services.filter((service) => service && service.state === 'error');
    if (errored.length > 0) {
      nextAlerts.push({
        key: 'background-error',
        summary: `${errored.length} background service${errored.length === 1 ? '' : 's'} reported an error state`,
        detail: errored
          .map((service) => `${service.name}:${service.lastError?.message || 'error'}`)
          .join(', '),
      });
    }
  }
}

function appendMonitorAlerts(nextAlerts, monitorRuntime) {
  const monitor = monitorRuntime || {};

  if ((monitor.failedIncidents || 0) > 0) {
    nextAlerts.push({
      key: 'monitor-failed',
      summary: `${monitor.failedIncidents} monitor incident${monitor.failedIncidents === 1 ? '' : 's'} failed`,
      detail: `Resolved: ${monitor.resolvedIncidents || 0}, suppressed: ${monitor.totalSuppressed || 0}`,
    });
  }

  if ((monitor.remediatingIncidents || 0) > 0) {
    nextAlerts.push({
      key: 'monitor-remediating',
      summary: `${monitor.remediatingIncidents} monitor incident${monitor.remediatingIncidents === 1 ? '' : 's'} still remediating`,
      detail: `Active incidents: ${monitor.activeIncidents || 0}`,
    });
  }
}

function appendRemediationAlerts(nextAlerts, remediationRuntime) {
  const remediation = remediationRuntime || {};

  if ((remediation.failedAttempts || 0) > 0) {
    nextAlerts.push({
      key: 'remediation-failed',
      summary: `${remediation.failedAttempts} runtime remediation attempt${remediation.failedAttempts === 1 ? '' : 's'} failed`,
      detail: `Verified: ${remediation.verifiedAttempts || 0}, partial: ${remediation.partialAttempts || 0}`,
    });
  }

  if ((remediation.partialAttempts || 0) > 0) {
    nextAlerts.push({
      key: 'remediation-partial',
      summary: `${remediation.partialAttempts} runtime remediation attempt${remediation.partialAttempts === 1 ? '' : 's'} only partially cleared the target`,
      detail: `Failed attempts: ${remediation.failedAttempts || 0}`,
    });
  }
}

function appendDomainAlerts(nextAlerts, domainsRuntime) {
  const domains = domainsRuntime || {};
  const entries = [
    ['gmail', 'Gmail'],
    ['calendar', 'Calendar'],
    ['escalations', 'Escalations'],
  ];

  for (const [key, label] of entries) {
    const domain = domains[key] || {};
    if (domain.status !== 'degraded' && domain.status !== 'warning') continue;

    nextAlerts.push({
      key: `domain-${key}`,
      summary: `${label} domain ${domain.status === 'degraded' ? 'is degraded' : 'needs attention'}`,
      detail: domain.remediation?.message
        || (Array.isArray(domain.issues) && domain.issues.length > 0
          ? domain.issues.slice(0, 3).join('; ')
          : `Active requests: ${domain.activeRequests || 0}`),
    });
  }
}

function appendMonitorTransportAlerts(nextAlerts, monitorTransport, now) {
  const transports = Array.isArray(monitorTransport?.items) ? monitorTransport.items : [];

  for (const transport of transports) {
    if (!transport || (transport.state !== 'cooldown' && transport.state !== 'degraded')) continue;
    const lastErrorAt = transport.lastErrorAt ? new Date(transport.lastErrorAt).getTime() : 0;
    if (!lastErrorAt || now - lastErrorAt < MONITOR_TRANSPORT_ALERT_THRESHOLD_MS) continue;

    nextAlerts.push({
      key: `monitor-transport-${transport.key}`,
      summary: `${transport.label || transport.key} monitor stream is ${transport.state}`,
      detail: transport.state === 'cooldown'
        ? `Cooling down for reconnect. Errors: ${transport.errorCount || 0}. Retry in: ${Math.max(0, Math.round((transport.retryInMs || 0) / 1000))}s`
        : `Degraded for ${Math.round((now - lastErrorAt) / 1000)}s. Errors: ${transport.errorCount || 0}. Last error: ${transport.lastError || 'unknown'}`,
      incidentMeta: {
        kind: 'monitor-transport',
        severity: transport.state === 'cooldown' ? 'elevated' : 'urgent',
        category: 'supervisor-blindness',
        source: 'useSupervisorAlerts',
        subsystem: 'dev-agent',
        component: 'monitor-transport',
        fingerprint: `monitor-transport:${transport.key}:${transport.state}`,
        transportKey: transport.key,
        transportState: transport.state,
        transportLabel: transport.label || transport.key,
      },
    });
  }
}

export function useSupervisorAlerts({ enabled = true, isLeader, sendBackground, log, runtimeHealth, monitorTransport }) {
  const alertTimesRef = useRef(new Map());

  useEffect(() => {
    if (!enabled || !isLeader || typeof sendBackground !== 'function' || !runtimeHealth) return;

    const now = Date.now();
    const nextAlerts = [];
    const workspace = runtimeHealth.workspace || {};
    const devSession = runtimeHealth.session || {};
    const aiRuntime = runtimeHealth.ai || {};
    const requestRuntime = runtimeHealth.requests || {};
    const backgroundRuntime = runtimeHealth.background || {};
    const monitorRuntime = runtimeHealth.monitor || {};
    const remediationRuntime = runtimeHealth.remediation || {};
    const domainsRuntime = runtimeHealth.domains || {};

    if ((workspace.staleCount || 0) > 0) {
      nextAlerts.push({
        key: 'workspace-stale',
        summary: `${workspace.staleCount} workspace session${workspace.staleCount === 1 ? '' : 's'} appear stalled`,
        detail: `Longest workspace activity: ${Math.round((workspace.longestActiveMs || 0) / 1000)}s`,
      });
    }

    if ((workspace.longestActiveMs || 0) > 180_000) {
      nextAlerts.push({
        key: 'workspace-long',
        summary: 'Workspace runtime has unusually long-running activity',
        detail: `Longest active workspace session: ${Math.round((workspace.longestActiveMs || 0) / 1000)}s`,
      });
    }

    appendAiRuntimeAlerts(nextAlerts, aiRuntime);
    appendServerRequestAlerts(nextAlerts, requestRuntime);
    appendBackgroundAlerts(nextAlerts, backgroundRuntime);
    appendMonitorAlerts(nextAlerts, monitorRuntime);
    appendRemediationAlerts(nextAlerts, remediationRuntime);
    appendDomainAlerts(nextAlerts, domainsRuntime);
    appendMonitorTransportAlerts(nextAlerts, monitorTransport, now);

    if (Array.isArray(devSession.sessions)) {
      const inactive = devSession.sessions.filter((session) => session && session.alive === false);
      if (inactive.length > 0) {
        nextAlerts.push({
          key: 'dev-inactive',
          summary: `${inactive.length} dev session${inactive.length === 1 ? '' : 's'} reported inactive`,
          detail: inactive.map((session) => `${session.provider || 'unknown'}:${session.sessionKey}`).join(', '),
        });
      }

      // Tool-use phases (tools, spawning) legitimately go quiet for extended
      // periods while the CLI subprocess executes file edits, bash commands,
      // etc.  Use a much higher idle threshold for those phases to avoid
      // false-positive "stuck session" alerts.
      const TOOL_PHASE_IDLE_MS = 180_000; // 3 min
      const DEFAULT_IDLE_MS = 45_000;     // 45 s
      const staleStreaming = devSession.sessions.filter((session) => {
        if (!session || !session.alive || typeof session.idleMs !== 'number') return false;
        const threshold = session.phase === 'tools' || session.phase === 'spawning'
          ? TOOL_PHASE_IDLE_MS
          : DEFAULT_IDLE_MS;
        return session.idleMs > threshold;
      });
      if (staleStreaming.length > 0) {
        nextAlerts.push({
          key: 'dev-stale',
          summary: `${staleStreaming.length} active dev session${staleStreaming.length === 1 ? '' : 's'} appear stuck`,
          detail: staleStreaming
            .map((session) => `${session.provider || 'unknown'}:${session.phase || 'unknown'}:${Math.round((session.idleMs || 0) / 1000)}s idle`)
            .join(', '),
        });
      }
    }

    for (const alert of nextAlerts) {
      const lastAlertAt = alertTimesRef.current.get(alert.key) || 0;
      if (now - lastAlertAt < ALERT_COOLDOWN_MS) continue;
      alertTimesRef.current.set(alert.key, now);

      log?.({
        type: 'health-warning',
        message: alert.summary,
        severity: 'warning',
        detail: alert.detail,
      });

      sendBackground('auto-errors', [
        '[AUTO-ERROR] Supervisor health warning',
        '',
        alert.summary,
        alert.detail ? `Detail: ${alert.detail}` : '',
        '',
        'Investigate the relevant route, session lifecycle, and monitoring path. If a clear fix is available, apply it.',
      ].filter(Boolean).join('\n'), {
        incidentMeta: alert.incidentMeta || {
          kind: 'supervisor-health',
          severity: 'elevated',
          category: 'supervisor-health',
          source: 'useSupervisorAlerts',
          subsystem: 'dev-agent',
          component: 'health-poll',
          fingerprint: `supervisor-health:${alert.key}`,
        },
        incidentContext: {
          alertKey: alert.key,
          summary: alert.summary,
          detail: alert.detail || '',
          runtimeHealth: {
            monitor: runtimeHealth?.monitor || {},
            remediation: runtimeHealth?.remediation || {},
          },
        },
      });
    }
  }, [enabled, isLeader, sendBackground, log, runtimeHealth, monitorTransport]);
}
