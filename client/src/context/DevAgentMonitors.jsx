// @refresh reset — force full remount on HMR to prevent hooks mismatch crashes
import { createContext, useContext, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useAutoErrorReporter } from '../hooks/useAutoErrorReporter.js';
import { useErrorResolution } from '../hooks/useErrorResolution.js';
import { useDevToolsBridge } from '../hooks/useDevToolsBridge.js';
import { useDevTaskQueue } from '../hooks/useDevTaskQueue.js';
import { useCodeReview } from '../hooks/useCodeReview.js';
import { useClientHealthMonitor } from '../hooks/useClientHealthMonitor.js';
import { useClientHealthExtended } from '../hooks/useClientHealthExtended.js';
import { useServerErrors } from '../hooks/useServerErrors.js';
import { useWaterfallInsights } from '../hooks/useWaterfallInsights.js';
import { useHMRVerification } from '../hooks/useHMRVerification.js';
import { useWorkspaceMonitor } from '../hooks/useWorkspaceMonitor.js';
import { useAiRuntimeMonitor } from '../hooks/useAiRuntimeMonitor.js';
import { useActiveRequestMonitor } from '../hooks/useActiveRequestMonitor.js';
import { useCrossTabIssueRelay } from '../hooks/useCrossTabIssueRelay.js';
import { useServerRequestMonitor } from '../hooks/useServerRequestMonitor.js';
import { useRuntimeAutoRemediation } from '../hooks/useRuntimeAutoRemediation.js';
import { useMonitorDispatch } from '../hooks/useMonitorDispatch.js';
import { useSupervisorAlerts } from '../hooks/useSupervisorAlerts.js';
import { useDomainHealthMonitor } from '../hooks/useDomainHealthMonitor.js';
import { useMonitorTransportAutoRemediation } from '../hooks/useMonitorTransportAutoRemediation.js';

// ── Secondary context for monitor-specific state ────────────────────
const DevAgentMonitorContext = createContext(null);

/**
 * Consume monitor state (taskQueue, errorReporter, etc.).
 * Returns an empty object if monitors crashed -- consumers must
 * handle undefined values gracefully.
 */
export function useDevAgentMonitors() {
  return useContext(DevAgentMonitorContext) || {};
}

// ── ErrorBoundary fallback ──────────────────────────────────────────

// Track whether we've already reported a monitor crash to prevent spam
let _monitorCrashReported = false;

function MonitorFallback({ error }) {
  // Monitors crashed — log and escalate to the dev agent directly.
  // Since the monitors (including useAutoErrorReporter) are dead,
  // we must bypass the normal pipeline and POST directly to the server.
  try {
    const msg = error?.message || String(error);
    const stack = error?.stack || '';
    (console.__original_error || console.error)(
      '[DevAgent] Monitors crashed (app continues normally):',
      msg
    );

    // Escalate to dev agent via direct fetch — only once per crash
    if (!_monitorCrashReported) {
      _monitorCrashReported = true;
      fetch('/api/dev/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelType: 'auto-errors',
          message: [
            '[AUTO-ERROR] DevAgent monitors crashed — error pipeline is offline',
            '',
            `Error: ${msg}`,
            stack ? `Stack: ${stack.slice(0, 1500)}` : '',
            '',
            'The monitor ErrorBoundary caught this. All monitor hooks (auto-error reporter,',
            'health checks, workspace monitor, etc.) are DOWN until the root cause is fixed.',
            'This error likely originated from a hook ordering issue or TDZ reference.',
            'Investigate and fix the source file immediately.',
          ].filter(Boolean).join('\n'),
        }),
      }).catch(() => {}); // best-effort, don't throw
    }
  } catch {
    // Truly best-effort -- if even logging fails, just swallow it
  }
  return null;
}

// ── Monitor boundary ────────────────────────────────────────────────

/**
 * Wraps all monitor hooks in an ErrorBoundary so that a crash in any
 * monitor hook (during render) does not take down the core provider
 * or the rest of the app.
 *
 * Children are rendered inside the DevAgentMonitorContext.Provider when
 * monitors are healthy, or directly (without monitor context) when
 * the boundary has caught an error.
 */
export function DevAgentMonitorBoundary({
  children,
  sendBackground,
  isLeader,
  broadcastStatus,
  onStatusUpdate,
  log,
  isStreaming,
  bgStreaming,
  sendMessage,
  serverState,
  emergencyActive,
  recordError,
  runtimeHealth,
  monitorTransport,
}) {
  return (
    <ErrorBoundary
      FallbackComponent={({ error }) => {
        // When monitors crash, still render children so the app works.
        // Monitor context will be null, and useDevAgentMonitors() returns {}.
        MonitorFallback({ error });
        return <>{children}</>;
      }}
    >
      <DevAgentMonitorsInner
        sendBackground={sendBackground}
        isLeader={isLeader}
        broadcastStatus={broadcastStatus}
        onStatusUpdate={onStatusUpdate}
        log={log}
        isStreaming={isStreaming}
        bgStreaming={bgStreaming}
        sendMessage={sendMessage}
        serverState={serverState}
        emergencyActive={emergencyActive}
        recordError={recordError}
        runtimeHealth={runtimeHealth}
        monitorTransport={monitorTransport}
      >
        {children}
      </DevAgentMonitorsInner>
    </ErrorBoundary>
  );
}

// ── Inner component that calls all monitor hooks ────────────────────

// ── Idle detection: 5 minutes without errors relaxes lower-priority monitors ─
const IDLE_THRESHOLD_MS = 300_000; // 5 minutes
const IDLE_CHECK_INTERVAL_MS = 60_000; // check every minute

function DevAgentMonitorsInner({
  children,
  sendBackground,
  isLeader,
  broadcastStatus,
  onStatusUpdate,
  log,
  isStreaming,
  bgStreaming,
  sendMessage,
  serverState,
  emergencyActive,
  recordError,
  runtimeHealth,
  monitorTransport,
}) {
  // ── Staggered startup: phase monitors in over 30 seconds ──────────
  //
  // Phase 0: nothing (initial render)
  // Phase 1: immediate — error capture + auto reporter (essential)
  // Phase 2: after 5s — devtools bridge + task queue
  // Phase 3: after 15s — health monitors + server errors
  // Phase 4: after 30s — waterfall insights + code review (lowest priority)
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    setPhase(1); // Immediate: error capture

    const t2 = setTimeout(() => setPhase(2), 5_000);
    const t3 = setTimeout(() => setPhase(3), 15_000);
    const t4 = setTimeout(() => setPhase(4), 30_000);

    return () => {
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []);

  // ── Adaptive idle detection ───────────────────────────────────────
  //
  // Tracks the last time an error was detected. When no errors have
  // occurred for 5+ minutes, lower-priority monitors (phase 3-4) are
  // disabled to reduce overhead. On the next error they snap back.
  const lastErrorTimeRef = useRef(Date.now());
  const [isIdle, setIsIdle] = useState(false);

  // Wrap recordError to also track timing for idle detection
  const wrappedRecordError = useCallback(() => {
    lastErrorTimeRef.current = Date.now();
    if (isIdle) setIsIdle(false);
    recordError?.();
  }, [isIdle, recordError]);

  useEffect(() => {
    const checker = setInterval(() => {
      const idleNow = Date.now() - lastErrorTimeRef.current > IDLE_THRESHOLD_MS;
      setIsIdle(prev => {
        if (prev !== idleNow && idleNow) {
          log?.({
            type: 'monitor-lifecycle',
            message: 'Monitors entering idle mode — disabling extended monitors (no errors for 5 min)',
            severity: 'info',
          });
        } else if (prev !== idleNow && !idleNow) {
          log?.({
            type: 'monitor-lifecycle',
            message: 'Monitors exiting idle mode — re-enabling extended monitors',
            severity: 'info',
          });
        }
        return idleNow;
      });
    }, IDLE_CHECK_INTERVAL_MS);

    return () => clearInterval(checker);
  }, [log]);

  // Gate SSE connections when server is unreachable to prevent reconnect storms
  const serverUp = serverState !== 'unreachable';
  const monitorSendBackground = useMonitorDispatch({
    enabled: phase >= 1 && serverUp,
    sendBackground,
    log,
  });

  // ── Phase 1 (immediate): Error resolution tracker ──────────────────
  // Closed-loop: detect -> report -> fix -> verify -> confirm/escalate
  const errorResolution = useErrorResolution({ sendBackground: monitorSendBackground, log });

  // ── Phase 1 (immediate): HMR verification ────────────────────────
  // Detects Vite HMR updates and feeds them to the resolution tracker
  // so it can confirm fixes were applied without manual refresh.
  useHMRVerification({ log, onHMRUpdate: errorResolution.onHMRUpdate });

  // ── Phase 1 (immediate): Error auto-capture pipeline ──────────────
  // Stays active in emergency but batches aggressively
  const errorReporter = useAutoErrorReporter({
    enabled: phase >= 1,
    sendBackground: monitorSendBackground,
    isLeader,
    log,
    emergencyActive,
    recordError: wrappedRecordError,
    errorResolution,
  });

  // ── Phase 1 (immediate): relay critical issues from non-leader tabs ──
  useCrossTabIssueRelay({
    enabled: phase >= 1,
    isLeader,
    broadcastStatus,
    onStatusUpdate,
    sendBackground: monitorSendBackground,
    log,
  });

  // ── Phase 2 (5s): DevTools bridge ─────────────────────────────────
  // console.error, circuit breaker, API errors, React crashes
  useDevToolsBridge({
    enabled: phase >= 2,
    isLeader,
    sendBackground: monitorSendBackground,
    log,
  });

  // ── Phase 2 (5s): Non-preemptive task queue ───────────────────────
  const taskQueue = useDevTaskQueue({
    enabled: phase >= 2,
    isStreaming,
    bgStreaming,
    sendBackground,
    sendMessage,
    log,
    emergencyActive,
  });

  // ── Phase 3 (15s): Client health monitors ─────────────────────────
  // Memory, DOM, long tasks, freezes, effect loops, render storms
  // DISABLED during emergency mode or when idle (no errors for 5 min)
  useClientHealthMonitor({
    enabled: phase >= 3 && !emergencyActive,
    isLeader,
    sendBackground: monitorSendBackground,
    log,
  });

  // Extended health: listener leaks, timer leaks, fetch pileup, etc.
  // DISABLED during emergency mode or when idle
  useClientHealthExtended({
    enabled: phase >= 3 && !emergencyActive && !isIdle,
    isLeader,
    sendBackground: monitorSendBackground,
    log,
  });

  // ── Phase 3 (15s): Server-side error pipeline via SSE ─────────────
  useServerErrors({
    enabled: phase >= 3 && serverUp,
    isLeader,
    sendBackground: monitorSendBackground,
    log,
  });

  // ── Phase 3 (15s): Workspace runtime monitor ──────────────────────
  // Watches active workspace sessions for hangs/stalls from the server side.
  useWorkspaceMonitor({
    enabled: phase >= 1 && serverUp,
    isLeader,
    sendBackground: monitorSendBackground,
    log,
  });

  // ── Phase 3 (15s): Chat/copilot runtime monitor ──────────────────
  // Watches long-running AI operations that do not have dedicated status UI.
  useAiRuntimeMonitor({
    enabled: phase >= 3 && serverUp,
    isLeader,
    sendBackground: monitorSendBackground,
    log,
  });

  // ── Phase 3 (15s): Shared HTTP active-request monitor ─────────────
  // Watches apiFetch-backed requests that are active too long.
  useActiveRequestMonitor({
    enabled: phase >= 3 && serverUp,
    isLeader,
    sendBackground: monitorSendBackground,
    log,
  });

  // ── Phase 3 (15s): Backend request runtime monitor ───────────────
  // Watches server-side requests that stay active too long.
  useServerRequestMonitor({
    enabled: phase >= 3 && serverUp,
    isLeader,
    sendBackground: monitorSendBackground,
    log,
  });

  // ── Phase 3 (15s): Domain health monitor ─────────────────────────
  // Watches Gmail, Calendar, and Escalations subsystem health summaries.
  useDomainHealthMonitor({
    enabled: phase >= 3 && serverUp,
    isLeader,
    sendBackground: monitorSendBackground,
    log,
  });

  // ── Phase 3 (15s): Deterministic runtime auto-remediation ─────────
  // Aborts clearly stale AI/runtime sessions before escalating further.
  useRuntimeAutoRemediation({
    enabled: phase >= 3 && serverUp,
    isLeader,
    sendBackground: monitorSendBackground,
    log,
  });

  // ── Phase 3 (15s): Supervisor alerts from /api/dev/health ──────────
  // Escalates server-observable stuck sessions back to the dev agent.
  useSupervisorAlerts({
    enabled: phase >= 3 && serverUp,
    isLeader,
    sendBackground: monitorSendBackground,
    log,
    runtimeHealth,
    monitorTransport,
  });

  useMonitorTransportAutoRemediation({
    enabled: phase >= 3 && serverUp,
    isLeader,
    log,
    monitorTransport,
  });

  // ── Phase 4 (30s): Code review (SSE to git change detector) ──────
  // DISABLED during emergency mode or when idle
  useCodeReview({
    enabled: phase >= 4 && serverUp && !emergencyActive && !isIdle,
    isLeader,
    enqueue: taskQueue.enqueue,
    log,
  });

  // ── Phase 4 (30s): Waterfall performance insights ─────────────────
  // DISABLED during emergency mode or when idle
  useWaterfallInsights({
    enabled: phase >= 4 && serverUp && !emergencyActive && !isIdle,
    isLeader,
    sendBackground: monitorSendBackground,
    log,
  });

  // Expose monitor values to consumers via secondary context
  const value = useMemo(() => ({
    errorReporter,
    errorResolution,
    taskQueue,
    monitorPhase: phase,
    monitorIdle: isIdle,
  }), [errorReporter, errorResolution, taskQueue, phase, isIdle]);

  return (
    <DevAgentMonitorContext.Provider value={value}>
      {children}
    </DevAgentMonitorContext.Provider>
  );
}
