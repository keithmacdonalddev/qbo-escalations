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

function MonitorFallback({ error }) {
  // Silent fallback -- monitors crashed but app continues.
  // Log to original console.error to avoid any patched interceptors.
  try {
    const msg = error?.message || String(error);
    // Use Function constructor to get unpatched console reference
    (console.__original_error || console.error)(
      '[DevAgent] Monitors crashed (app continues normally):',
      msg
    );
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
  log,
  isStreaming,
  bgStreaming,
  sendMessage,
  serverState,
  emergencyActive,
  recordError,
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
        log={log}
        isStreaming={isStreaming}
        bgStreaming={bgStreaming}
        sendMessage={sendMessage}
        serverState={serverState}
        emergencyActive={emergencyActive}
        recordError={recordError}
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
  log,
  isStreaming,
  bgStreaming,
  sendMessage,
  serverState,
  emergencyActive,
  recordError,
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

  // ── Phase 1 (immediate): Error resolution tracker ──────────────────
  // Closed-loop: detect -> report -> fix -> verify -> confirm/escalate
  const errorResolution = useErrorResolution({ sendBackground, log });

  // ── Phase 1 (immediate): HMR verification ────────────────────────
  // Detects Vite HMR updates and feeds them to the resolution tracker
  // so it can confirm fixes were applied without manual refresh.
  useHMRVerification({ log, onHMRUpdate: errorResolution.onHMRUpdate });

  // ── Phase 1 (immediate): Error auto-capture pipeline ──────────────
  // Stays active in emergency but batches aggressively
  const errorReporter = useAutoErrorReporter({
    enabled: phase >= 1,
    sendBackground,
    isLeader,
    log,
    emergencyActive,
    recordError: wrappedRecordError,
    errorResolution,
  });

  // ── Phase 2 (5s): DevTools bridge ─────────────────────────────────
  // console.error, circuit breaker, API errors, React crashes
  useDevToolsBridge({
    enabled: phase >= 2,
    isLeader,
    sendBackground,
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
    sendBackground,
    log,
  });

  // Extended health: listener leaks, timer leaks, fetch pileup, etc.
  // DISABLED during emergency mode or when idle
  useClientHealthExtended({
    enabled: phase >= 3 && !emergencyActive && !isIdle,
    isLeader,
    sendBackground,
    log,
  });

  // ── Phase 3 (15s): Server-side error pipeline via SSE ─────────────
  useServerErrors({
    enabled: phase >= 3 && serverUp,
    isLeader,
    sendBackground,
    log,
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
    sendBackground,
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
