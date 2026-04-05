import { useState, useEffect, useRef, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { apiFetchJson } from '../api/http.js';
import { renderMarkdown } from '../utils/markdown.jsx';
import { useWorkspaceMonitorStream } from '../context/WorkspaceMonitorContext.jsx';
import { useToast } from '../hooks/useToast.jsx';
import useWorkspaceAgentFeedState from '../hooks/useWorkspaceAgentFeedState.js';
import useWorkspaceAlertBriefingState from '../hooks/useWorkspaceAlertBriefingState.js';
import useWorkspaceAgentRuntime from '../hooks/useWorkspaceAgentRuntime.js';
import useWorkspaceAgentPanelActions from '../hooks/useWorkspaceAgentPanelActions.js';
import WorkspaceBriefingBanner from './workspace/WorkspaceBriefingBanner.jsx';
import WorkspaceActivityFeed from './workspace/WorkspaceActivityFeed.jsx';
import WorkspaceConversationThread from './workspace/WorkspaceConversationThread.jsx';
import WorkspaceWelcomePanel from './workspace/WorkspaceWelcomePanel.jsx';
import WorkspaceComposer from './workspace/WorkspaceComposer.jsx';
import WorkspaceHistoryDrawer from './workspace/WorkspaceHistoryDrawer.jsx';
import WorkspacePanelHeader from './workspace/WorkspacePanelHeader.jsx';
import WorkspaceSignalRail from './workspace/WorkspaceSignalRail.jsx';
import ShipmentTracker from './ShipmentTracker.jsx';
import useWorkspaceAgentPanelControls from '../hooks/useWorkspaceAgentPanelControls.js';
import {
  getProviderShortLabel,
} from '../lib/providerCatalog.js';
import { WORKSPACE_AGENT_REQUEST_EVENT } from '../lib/workspaceAgentEvents.js';
import './WorkspaceAgentPanel.css';

// ---------------------------------------------------------------------------
// WorkspaceAgentPanel — shared docked panel for Gmail + Calendar views
// ---------------------------------------------------------------------------

export default function WorkspaceAgentPanel({ open, onToggle, viewContext, embedded = false }) {
  const workspaceMonitor = useWorkspaceMonitorStream();
  const toast = useToast();
  const [reasoningNotice, setReasoningNotice] = useState('');
  const {
    sessionKey,
    patchSession,
    setController,
    abortSession,
    workspaceSessionId,
    setActiveAgentSessionId,
    conversationRestored,
    provider,
    mode,
    fallbackProvider,
    model,
    fallbackModel,
    reasoningEffort,
    messages,
    input,
    streaming,
    streamText,
    thinkingText,
    statusState,
    lastActions,
    providerStatus,
    clearStallWatch,
    resetReasoningState,
    abortActiveAgentSession,
    loadConversation,
    startNewConversation,
    startWorkspaceRequest,
  } = useWorkspaceAgentRuntime({
    viewContext,
    setReasoningNotice,
  });
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  // Gmail and Calendar are two views into the same workspace agent.
  // The transcript should stay unified when the user switches between them.

  const {
    alerts,
    dismissedAlerts,
    snoozedAlerts,
    alertReactions,
    briefing,
    briefingExpanded,
    briefingDismissed,
    dismissAlert,
    snoozeAlert,
    logAlertInteraction,
    handleBriefingToggle,
    handleBriefingDismiss,
  } = useWorkspaceAlertBriefingState({
    open,
    workspaceMonitor,
  });

  const {
    nudges,
    dismissedNudges,
    patternActionLoading,
    recentActivity,
    activityExpanded,
    activityScrollReady,
    dismissNudge,
    acceptPatternRule,
    rejectPatternRule,
    applyCategorization,
    handleActivityToggle,
  } = useWorkspaceAgentFeedState({
    open,
    workspaceMonitor,
  });

  // ---------------------------------------------------------------------------
  // Memory indicator — count of workspace memory facts
  // ---------------------------------------------------------------------------
  const [memoryCount, setMemoryCount] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetchJson('/api/workspace/memory/count', {}, 'Failed to load workspace memory count');
        if (!cancelled && data.ok && typeof data.count === 'number') {
          setMemoryCount(data.count);
        }
      } catch {
        // Memory count is cosmetic — don't block on failure
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const hasStackAboveWelcome = Boolean((briefing && !briefingDismissed) || recentActivity.length > 0);
  const {
    historyOpen,
    historyItems,
    historyLoading,
    toggleHistory,
    handleLoadConversation,
    handleStartNewConversation,
  } = useWorkspaceAgentPanelControls({
    open,
    workspaceSessionId,
    conversationRestored,
    messagesLength: messages.length,
    streaming,
    loadConversation,
    startNewConversation,
    startWorkspaceRequest,
  });
  const {
    feedbackMap,
    quickActions,
    handleSend,
    handleStop,
    handleQuickAction,
    handleAlertAction,
    handleBriefingCardAction,
    handleFeedback,
  } = useWorkspaceAgentPanelActions({
    sessionKey,
    patchSession,
    setController,
    abortSession,
    workspaceSessionId,
    setActiveAgentSessionId,
    messages,
    input,
    streaming,
    provider,
    mode,
    fallbackProvider,
    model,
    fallbackModel,
    reasoningEffort,
    clearStallWatch,
    resetReasoningState,
    abortActiveAgentSession,
    handleStartNewConversation,
    startWorkspaceRequest,
    viewContext,
    toast,
    dismissAlert,
    logAlertInteraction,
  });

  const statusMsg = useMemo(() => {
    if (!statusState) return null;
    const elapsedSeconds = typeof statusState.elapsedMs === 'number'
      ? Math.max(0, Math.round(statusState.elapsedMs / 1000))
      : null;
    const phaseLabel = statusState.phase === 'pass1'
      ? 'Thinking'
      : statusState.phase === 'actions-detected'
        ? 'Planning actions'
        : statusState.phase === 'actions'
          ? 'Executing actions'
          : statusState.phase === 'pass2' || statusState.phase === 'summary'
            ? 'Summarizing'
            : statusState.phase?.startsWith('loop-')
              ? `Working (round ${statusState.iteration || ''})`
              : null;
    const base = statusState.message || phaseLabel || 'Working...';
    if (elapsedSeconds == null) return base;
    if (elapsedSeconds >= 90) return `${base} Taking longer than usual (${elapsedSeconds}s)`;
    return `${base} (${elapsedSeconds}s)`;
  }, [statusState]);

  const thinkingPhaseLabel = useMemo(() => {
    if (statusState?.phase === 'pass2' || statusState?.phase === 'summary') return 'Summary pass';
    if (statusState?.phase === 'pass1') return 'Thinking';
    if (statusState?.phase === 'actions-detected') return 'Planning actions';
    if (statusState?.phase === 'actions') return 'Executing actions';
    return 'Responding';
  }, [statusState]);

  const showThinkingPanel = streaming && Boolean(thinkingText || reasoningNotice);
  const showProviderModeHint = mode === 'fallback' && Boolean(providerStatus);

  useEffect(() => {
    const handleExternalRequest = (event) => {
      const prompt = typeof event?.detail?.prompt === 'string' ? event.detail.prompt.trim() : '';
      if (!prompt) return;
      if (streaming) {
        toast?.warning?.('Wait for the current workspace reply to finish first.');
        return;
      }
      startWorkspaceRequest(prompt, {
        contextOverride: event?.detail?.viewContext && typeof event.detail.viewContext === 'object'
          ? event.detail.viewContext
          : viewContext,
      });
    };

    window.addEventListener(WORKSPACE_AGENT_REQUEST_EVENT, handleExternalRequest);
    return () => window.removeEventListener(WORKSPACE_AGENT_REQUEST_EVENT, handleExternalRequest);
  }, [startWorkspaceRequest, streaming, toast, viewContext]);

  if (!open) return null;

  return (
    <div
      className="workspace-agent-panel"
      style={embedded ? { width: '100%', minWidth: 0, maxWidth: 'none', borderLeft: 'none' } : undefined}
    >
      <WorkspacePanelHeader
        embedded={embedded}
        viewLabel={viewContext?.view === 'gmail' ? 'Email' : viewContext?.view === 'calendar' ? 'Calendar' : 'Workspace'}
        memoryCount={memoryCount}
        providerMenuOpen={providerMenuOpen}
        onToggleProviderMenu={() => setProviderMenuOpen((prev) => !prev)}
        provider={provider}
        mode={mode}
        fallbackProvider={fallbackProvider}
        model={model}
        fallbackModel={fallbackModel}
        reasoningEffort={reasoningEffort}
        patchSession={patchSession}
        historyOpen={historyOpen}
        onToggleHistory={toggleHistory}
        hasMessages={messages.length > 0}
        onNewConversation={handleStartNewConversation}
        onCopyConversation={() => {
          const text = messages
            .filter((m) => m.role !== 'system')
            .map((m) => {
              const role = m.role === 'user' ? 'You' : 'Workspace Agent';
              const time = m.timestamp ? ` [${new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]` : '';
              return `${role}${time}:\n${m.content || ''}`;
            })
            .join('\n\n---\n\n');
          navigator.clipboard.writeText(text).then(() => {
            if (toast) toast('Conversation copied to clipboard');
          }).catch(() => {});
        }}
        onClose={embedded ? null : onToggle}
      />
      {providerStatus && (
        <div className={`workspace-agent-provider-notice is-${providerStatus.tone || 'info'}`}>
          <div className="workspace-agent-provider-notice-top">
            <span className="workspace-agent-provider-notice-pill">Provider status</span>
            <span className="workspace-agent-provider-notice-title">{providerStatus.title}</span>
          </div>
          <div className="workspace-agent-provider-notice-message">{providerStatus.message}</div>
          {(providerStatus.activeProvider || providerStatus.failedProvider || providerStatus.activeModel) && (
            <div className="workspace-agent-provider-notice-meta">
              {providerStatus.activeProvider && (
                <span>Active: {getProviderShortLabel(providerStatus.activeProvider)}</span>
              )}
              {providerStatus.failedProvider && providerStatus.failedProvider !== providerStatus.activeProvider && (
                <span>Primary attempt: {getProviderShortLabel(providerStatus.failedProvider)}</span>
              )}
              {providerStatus.activeModel && (
                <span>Model: {providerStatus.activeModel}</span>
              )}
            </div>
          )}
          {providerStatus.detail && (
            <div className="workspace-agent-provider-notice-detail">{providerStatus.detail}</div>
          )}
          {showProviderModeHint && (
            <div className="workspace-agent-provider-notice-hint">
              Fallback mode is on. Switch Mode to <strong>Single</strong> in the model menu if you want the API provider to fail loudly instead of auto-switching.
            </div>
          )}
        </div>
      )}
      <WorkspaceSignalRail
        alerts={alerts}
        nudges={nudges}
        dismissedAlerts={dismissedAlerts}
        snoozedAlerts={snoozedAlerts}
        dismissedNudges={dismissedNudges}
        alertReactions={alertReactions}
        streaming={streaming}
        patternActionLoading={patternActionLoading}
        onAlertAction={handleAlertAction}
        onDismissAlert={dismissAlert}
        onSnoozeAlert={snoozeAlert}
        onLogAlertInteraction={logAlertInteraction}
        onDismissNudge={dismissNudge}
        onAcceptPatternRule={acceptPatternRule}
        onRejectPatternRule={rejectPatternRule}
        onApplyCategorization={applyCategorization}
      />

      {/* Conversation history drawer */}
      <WorkspaceHistoryDrawer
        open={historyOpen}
        workspaceSessionId={workspaceSessionId}
        historyItems={historyItems}
        historyLoading={historyLoading}
        onStartNewConversation={handleStartNewConversation}
        onLoadConversation={handleLoadConversation}
      />

      <div className="workspace-agent-messages">
        {/* Morning briefing banner — inside scroll area */}
        <AnimatePresence>
          {briefing && !briefingDismissed && (
            <WorkspaceBriefingBanner
              briefing={briefing}
              expanded={briefingExpanded}
              onToggle={handleBriefingToggle}
              onDismiss={handleBriefingDismiss}
              onAction={handleBriefingCardAction}
            />
          )}
        </AnimatePresence>

        {/* Active shipments tracker */}
        <ShipmentTracker />

        {/* Recent EA Activity */}
        <AnimatePresence>
          {recentActivity.length > 0 && (
            <WorkspaceActivityFeed
              recentActivity={recentActivity}
              expanded={activityExpanded}
              scrollReady={activityScrollReady}
              onToggle={handleActivityToggle}
            />
          )}
        </AnimatePresence>

        {messages.length === 0 && !streaming && (
          <WorkspaceWelcomePanel
            compact={hasStackAboveWelcome}
            quickActions={quickActions}
            onQuickAction={handleQuickAction}
          />
        )}

        <WorkspaceConversationThread
          messages={messages}
          streaming={streaming}
          streamText={streamText}
          statusMsg={statusMsg}
          showThinkingPanel={showThinkingPanel}
          thinkingText={thinkingText}
          thinkingPhaseLabel={thinkingPhaseLabel}
          reasoningNotice={reasoningNotice}
          feedbackMap={feedbackMap}
          onFeedback={handleFeedback}
          onSuggestedAction={handleQuickAction}
          renderText={renderMarkdown}
          messagesEndRef={messagesEndRef}
        />
      </div>

      <WorkspaceComposer
        input={input}
        streaming={streaming}
        inputRef={inputRef}
        onChangeInput={(value) => patchSession({ input: value })}
        onSubmit={handleSend}
        onStop={handleStop}
      />
    </div>
  );
}
