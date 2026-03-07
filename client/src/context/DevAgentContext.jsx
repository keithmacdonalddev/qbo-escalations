import { createContext, useContext, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useDevChat } from '../hooks/useDevChat.js';
import { useBackgroundAgent } from '../hooks/useBackgroundAgent.js';
import { useTabLeadership } from '../hooks/useTabLeadership.js';
import { useAgentActivityLog } from '../hooks/useAgentActivityLog.js';
import { useAgentSelfCheck } from '../hooks/useAgentSelfCheck.js';
import { useServerReachability } from '../hooks/useServerReachability.js';
import { useEmergencyMode } from '../hooks/useEmergencyMode.js';
import { useTokenMonitor } from '../hooks/useTokenMonitor.js';
import { initTelemetry } from '../lib/devTelemetry.js';
import { DevAgentMonitorBoundary } from './DevAgentMonitors.jsx';

const DevAgentContext = createContext(null);

/**
 * Core dev agent provider -- MUST NEVER CRASH.
 *
 * Contains only the foundation hooks that the app depends on:
 * - devChat: foreground conversation (messages, streaming, provider, etc.)
 * - bgAgent: background execution (sendBackground, bgStreaming, channels)
 * - tabLeadership: cross-tab coordination (isLeader, broadcastStatus)
 * - activityLog: central event log for real-time UI
 *
 * All optional monitoring hooks (error capture, health monitors, task queue,
 * code review, waterfall insights) are in DevAgentMonitorBoundary, wrapped
 * in its own ErrorBoundary. If ANY monitor crashes, the core provider and
 * the rest of the app continue unaffected.
 *
 * @param {object} props
 * @param {object} [props.aiSettings] - AI settings forwarded to useDevChat
 * @param {import('react').ReactNode} props.children
 */
export function DevAgentProvider({ aiSettings, children }) {
  // Layer 0: Foundation -- these MUST work
  const activityLog = useAgentActivityLog();
  const tabLeadership = useTabLeadership({ log: activityLog.log });
  const devChat = useDevChat({ aiSettings, log: activityLog.log });
  const selfCheck = useAgentSelfCheck({ isLeader: tabLeadership.isLeader, log: activityLog.log });
  const bgAgent = useBackgroundAgent({ log: activityLog.log, onSuccess: selfCheck.recordBgSuccess });
  const serverReachability = useServerReachability({ log: activityLog.log });
  const emergency = useEmergencyMode({ log: activityLog.log });

  // Centralized token monitor — consumed by DevMode and DevMiniWidget via context
  const tokenStats = useTokenMonitor({
    messages: devChat.messages,
    bgLastResults: bgAgent.lastResults,
    sessionBudget: aiSettings?.sessionBudget,
  });
  const budgetPaused = tokenStats.budget?.shouldPauseBg || false;

  // Wrap sendBackground with server-state gate: when unreachable, silently
  // queue the message instead of attempting a request that will fail.
  // Also gates on budget: at 95%+, autonomous background sends are paused.
  const safeSendBackground = useCallback(async (channel, message, options) => {
    if (serverReachability.serverState === serverReachability.STATES.UNREACHABLE) {
      serverReachability.queueForLater(channel, message);
      activityLog.log?.({
        type: 'server-status',
        message: `Queued message for ${channel} (server unreachable)`,
        severity: 'warning',
      });
      return null;
    }
    if (budgetPaused) {
      activityLog.log?.({
        type: 'budget-paused',
        message: `Background send to ${channel} blocked — token budget nearly exhausted`,
        severity: 'warning',
      });
      return null;
    }
    return bgAgent.sendBackground(channel, message, options);
  }, [serverReachability.serverState, serverReachability.STATES.UNREACHABLE, serverReachability.queueForLater, bgAgent.sendBackground, activityLog.log, budgetPaused]);

  // When server comes back from degraded/unreachable, drain the offline queue
  // and send a single batched summary to the auto-errors channel.
  useEffect(() => {
    if (serverReachability.serverState === serverReachability.STATES.REACHABLE) {
      const queued = serverReachability.drainQueue();
      if (queued.length > 0) {
        const summary = queued
          .map(q => `- [${q.channel}] ${typeof q.message === 'string' ? q.message.slice(0, 100) : '(non-string)'}`)
          .join('\n');
        bgAgent.sendBackground(
          'auto-errors',
          `[AUTO-ERROR] ${queued.length} queued errors from server downtime:\n\n${summary}`
        );
        activityLog.log?.({
          type: 'server-status',
          message: `Drained ${queued.length} queued errors after server recovery`,
          severity: 'info',
        });
      }
    }
  }, [serverReachability.serverState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wire telemetry system into the provider so tel() calls route here
  useEffect(() => {
    initTelemetry(activityLog.log, bgAgent.sendBackground);
  }, [activityLog.log, bgAgent.sendBackground]);

  // Mini-widget quick-chat expansion state (controlled from App via Ctrl+Shift+D)
  const [miniWidgetOpen, setMiniWidgetOpen] = useState(false);
  const miniWidgetInputRef = useRef(null);
  const toggleMiniWidget = useCallback(() => {
    setMiniWidgetOpen(prev => {
      const next = !prev;
      if (next) {
        setTimeout(() => miniWidgetInputRef.current?.focus(), 50);
      }
      return next;
    });
  }, []);
  const focusMiniWidget = useCallback(() => {
    setMiniWidgetOpen(true);
    setTimeout(() => miniWidgetInputRef.current?.focus(), 50);
  }, []);

  // Core context value -- always available regardless of monitor health
  const coreValue = useMemo(() => ({
    // Foreground state (all useDevChat fields)
    ...devChat,
    // Background execution (wrapped with server-reachability + budget gate)
    sendBackground: safeSendBackground,
    bgStreaming: bgAgent.bgStreaming,
    bgQueue: bgAgent.bgQueue,
    bgLastResults: bgAgent.lastResults,
    bgChannels: bgAgent.channels,
    // Tab leadership
    isLeader: tabLeadership.isLeader,
    tabId: tabLeadership.tabId,
    broadcastStatus: tabLeadership.broadcastStatus,
    onStatusUpdate: tabLeadership.onStatusUpdate,
    // Mini-widget quick-chat state
    miniWidgetOpen,
    setMiniWidgetOpen,
    miniWidgetInputRef,
    toggleMiniWidget,
    focusMiniWidget,
    // Activity log
    activityLog,
    // Self-monitoring heartbeat
    agentHealthy: selfCheck.agentHealthy,
    healthDetails: selfCheck.healthDetails,
    recordBgSuccess: selfCheck.recordBgSuccess,
    // Server reachability (tri-state)
    serverState: serverReachability.serverState,
    // Emergency mode (backpressure triage)
    emergencyActive: emergency.emergencyActive,
    resetEmergency: emergency.resetEmergency,
    // Token budget tracking (centralized)
    tokenStats,
    budgetPaused,
  }), [
    devChat,
    safeSendBackground, bgAgent.bgStreaming, bgAgent.bgQueue, bgAgent.lastResults, bgAgent.channels,
    tabLeadership.isLeader, tabLeadership.tabId, tabLeadership.broadcastStatus, tabLeadership.onStatusUpdate,
    miniWidgetOpen, toggleMiniWidget, focusMiniWidget,
    activityLog,
    selfCheck.agentHealthy, selfCheck.healthDetails, selfCheck.recordBgSuccess,
    serverReachability.serverState,
    emergency.emergencyActive, emergency.resetEmergency,
    tokenStats, budgetPaused,
  ]);

  return (
    <DevAgentContext.Provider value={coreValue}>
      <DevAgentMonitorBoundary
        sendBackground={safeSendBackground}
        isLeader={tabLeadership.isLeader}
        log={activityLog.log}
        isStreaming={devChat.isStreaming}
        bgStreaming={bgAgent.bgStreaming}
        sendMessage={devChat.sendMessage}
        serverState={serverReachability.serverState}
        emergencyActive={emergency.emergencyActive}
        recordError={emergency.recordError}
      >
        {children}
      </DevAgentMonitorBoundary>
    </DevAgentContext.Provider>
  );
}

/**
 * Consume dev agent state from the nearest DevAgentProvider.
 * Throws if used outside the provider tree.
 */
export function useDevAgent() {
  const ctx = useContext(DevAgentContext);
  if (!ctx) {
    throw new Error(
      'useDevAgent() must be used within a <DevAgentProvider>. ' +
      'Wrap your component tree with <DevAgentProvider> in App.jsx.'
    );
  }
  return ctx;
}
