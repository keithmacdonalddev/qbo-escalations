import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { fadeSlideDown, fadeSlideUp, transitions } from '../../utils/motion.js';
import { getProviderLabel } from '../../utils/markdown.jsx';
import { REASONING_EFFORT_OPTIONS } from '../../lib/providerCatalog.js';
import ChatMessage from '../ChatMessage.jsx';
import ParallelResponsePair from '../ParallelResponsePair.jsx';
import TriageCard from '../TriageCard.jsx';
import InvMatchBanner from '../InvMatchBanner.jsx';

const MODE_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'fallback', label: 'Fallback' },
  { value: 'parallel', label: 'Parallel' },
];

function groupMessagesForRendering(messages) {
  const groups = [];
  const seenTurnIds = new Set();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const turnId = msg.attemptMeta?.turnId;

    if (msg.role === 'assistant' && msg.mode === 'parallel' && turnId) {
      if (seenTurnIds.has(turnId)) continue;
      seenTurnIds.add(turnId);

      const turnMessages = messages
        .map((m, idx) => ({ ...m, _index: idx }))
        .filter(m => m.role === 'assistant' && m.mode === 'parallel' && m.attemptMeta?.turnId === turnId);

      groups.push({
        type: 'parallel-pair',
        turnId,
        responses: turnMessages,
        firstIndex: turnMessages[0]._index,
      });
    } else {
      groups.push({ type: 'single', message: msg, index: i });
    }
  }

  return groups;
}

function detectImageParseTurn(messages, parallelIndex) {
  for (let i = parallelIndex - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return Array.isArray(messages[i].images) && messages[i].images.length > 0;
    }
  }
  return false;
}

function formatTokenEstimate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatProcessEventTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatStreamingElapsed(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0.0s';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function getReasoningEffortLabel(value) {
  return REASONING_EFFORT_OPTIONS.find((option) => option.value === value)?.label || 'High';
}

export default function ChatThreadStack({
  aiSettings = null,
  conversationId,
  provider,
  effectiveMode,
  reasoningEffort,
  streamProvider,
  streamingText,
  thinkingText,
  messages,
  parallelProviders,
  parallelStreaming,
  liveRequestRuntime,
  processEvents,
  streamElapsedMs,
  runtimeWarnings,
  dismissRuntimeWarnings,
  contextDebug,
  fallbackNotice,
  dismissFallbackNotice,
  activityExpanded,
  setActivityExpanded,
  clearProcessEvents,
  triageCard,
  invMatches,
  error,
  errorDetails,
  retryLastResponse,
  setError,
  acceptParallelTurn,
  unacceptParallelTurn,
  handleDiscardProvider,
  handleReEnableProvider,
  parallelAcceptingKey,
  discardedProviders,
  handleFork,
  handleQuickAction,
  linkedEscalation,
  handleResolveEscalation,
  resolvingEscalation,
  forkInfo,
  parseMeta,
  savedEscalationId,
  messagesEndRef,
  isStreaming,
  newConversation,
}) {
  const showRuntimeDiagnostics = Boolean(aiSettings?.debug?.showContextDebug);
  const groupedMessages = useMemo(() => groupMessagesForRendering(messages), [messages]);
  const lastAssistantIndex = useMemo(() => {
    for (let j = messages.length - 1; j >= 0; j--) {
      if (messages[j].role === 'assistant') return j;
    }
    return -1;
  }, [messages]);
  const canRetryLastResponse = Boolean(
    conversationId
      && !isStreaming
      && messages.length > 1
      && messages.some((m) => m.role === 'user')
  );
  const latestProcessEvent = processEvents.length > 0 ? processEvents[processEvents.length - 1] : null;
  const activeChatRequests = Array.isArray(liveRequestRuntime?.requests) ? liveRequestRuntime.requests : [];
  const activeAiSessionCount = Number(liveRequestRuntime?.chatAiActive || 0) + Number(liveRequestRuntime?.parseAiActive || 0);
  const parallelLiveEntries = Object.entries(parallelStreaming || {}).filter(([, text]) => Boolean(text));
  const liveParallelResponses = useMemo(() => {
    if (!isStreaming || effectiveMode !== 'parallel') return [];
    const orderedProviders = Array.isArray(parallelProviders) && parallelProviders.length > 0
      ? parallelProviders
      : Object.keys(parallelStreaming || {});
    return orderedProviders.map((providerId) => ({
      provider: providerId,
      content: parallelStreaming?.[providerId] || '',
      isStreaming: true,
      turnId: 'live-stream',
    }));
  }, [effectiveMode, isStreaming, parallelProviders, parallelStreaming]);
  const backendLooksIdle = Boolean(isStreaming)
    && Boolean(liveRequestRuntime)
    && activeChatRequests.length === 0
    && activeAiSessionCount === 0;
  const likelyStaleStream = backendLooksIdle && streamElapsedMs >= 20_000;

  let livePhaseLabel = 'Waiting for server activity';
  if (effectiveMode === 'parallel' && parallelLiveEntries.length > 0) {
    livePhaseLabel = 'Streaming parallel responses';
  } else if (streamingText) {
    livePhaseLabel = 'Streaming response';
  } else if (thinkingText) {
    livePhaseLabel = 'Model reasoning';
  } else if (activeAiSessionCount > 0 || activeChatRequests.length > 0) {
    livePhaseLabel = 'Running on server';
  } else if (latestProcessEvent?.code === 'REQUEST_ACCEPTED') {
    livePhaseLabel = 'Accepted by server';
  } else if (latestProcessEvent?.title) {
    livePhaseLabel = latestProcessEvent.title;
  }

  let liveStatusMessage = latestProcessEvent?.message || 'Request queued.';
  if (likelyStaleStream) {
    liveStatusMessage = 'This page still thinks the request is active, but the backend currently shows no matching chat work running.';
  } else if (activeChatRequests.length > 0) {
    const longestRequest = activeChatRequests.reduce((longest, entry) => (
      !longest || (entry.ageMs || 0) > (longest.ageMs || 0) ? entry : longest
    ), null);
    if (longestRequest) {
      liveStatusMessage = `${longestRequest.method} ${longestRequest.path} is ${longestRequest.phase || 'running'} on the server for ${formatStreamingElapsed(longestRequest.ageMs || 0)}.`;
    }
  } else if (activeAiSessionCount > 0) {
    liveStatusMessage = `AI runtime reports ${activeAiSessionCount} active operation${activeAiSessionCount === 1 ? '' : 's'}.`;
  } else if (!streamingText && !thinkingText) {
    liveStatusMessage = 'Waiting for the first model event.';
  }

  return (
    <div className="chat-with-thinking">
      <div className="chat-container">
        {linkedEscalation && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-3)',
            padding: 'var(--sp-2) var(--sp-5)',
            background: 'var(--bg-sunken)',
            borderBottom: '1px solid var(--line)',
            fontSize: 'var(--text-sm)',
          }}>
            <span className={`badge badge-${linkedEscalation.status === 'open' ? 'open' : linkedEscalation.status === 'in-progress' ? 'progress' : linkedEscalation.status === 'resolved' ? 'resolved' : 'escalated'}`}>
              {linkedEscalation.status}
            </span>
            <span style={{ flex: 1, color: 'var(--ink-secondary)' }}>
              Linked escalation
              {linkedEscalation.coid && <span className="mono" style={{ marginLeft: 'var(--sp-2)' }}>COID: {linkedEscalation.coid}</span>}
              {linkedEscalation.category && (
                <span className={`cat-badge cat-${linkedEscalation.category}`} style={{ marginLeft: 'var(--sp-2)', fontSize: 'var(--text-xs)' }}>
                  {linkedEscalation.category.replace('-', ' ')}
                </span>
              )}
            </span>
            {linkedEscalation.status !== 'resolved' && (
              <button
                className="btn btn-sm btn-primary"
                onClick={handleResolveEscalation}
                disabled={resolvingEscalation}
                type="button"
              >
                {resolvingEscalation ? 'Resolving...' : 'Mark Resolved'}
              </button>
            )}
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => { window.location.hash = '#/dashboard'; }}
              type="button"
            >
              View
            </button>
          </div>
        )}

        {forkInfo && (
          <div className="fork-banner">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}>
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 01-9 9" />
            </svg>
            <span>
              Forked from message #{(forkInfo.forkMessageIndex ?? 0) + 1} of{' '}
              <a
                className="fork-banner-link"
                onClick={() => { window.location.hash = `#/chat/${forkInfo.forkedFrom}`; }}
                style={{ cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline' }}
              >
                parent conversation
              </a>
            </span>
          </div>
        )}

        <div className="chat-messages" aria-live="polite">
          {runtimeWarnings.length > 0 && (
            <div className="chat-bubble chat-bubble-system" style={{ border: '1px solid var(--warning)', background: 'var(--warning-subtle)' }}>
              <strong style={{ marginRight: 'var(--sp-2)', color: 'var(--warning)' }}>Budget Notice:</strong>
              {runtimeWarnings[0]?.message || 'A runtime guardrail warning was raised.'}
              <button
                className="btn btn-sm btn-ghost"
                onClick={dismissRuntimeWarnings}
                style={{ marginLeft: 'var(--sp-3)' }}
                type="button"
              >
                Dismiss
              </button>
            </div>
          )}

          {contextDebug?.budgets && (
            <div className="parallel-context-line">
              <span className="ctx-dot" style={{ background: 'var(--accent)' }} />
              <span>
                Context {contextDebug.knowledgeMode} • {formatTokenEstimate(contextDebug.budgets.estimatedInputTokens)} est input tokens
              </span>
              <span className="ctx-hints">
                S {formatTokenEstimate(contextDebug.budgets.systemChars / 4)} | H {formatTokenEstimate(contextDebug.budgets.historyChars / 4)} | R {formatTokenEstimate(contextDebug.budgets.retrievalChars / 4)}
              </span>
            </div>
          )}

          {showRuntimeDiagnostics && processEvents.length > 0 && (
            <div className="chat-process-panel" role="status" aria-live="polite">
              <div className="chat-process-header" onClick={() => setActivityExpanded((prev) => !prev)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                <span>Request Activity <span style={{ fontSize: '0.7em', opacity: 0.5, marginLeft: 6 }}>{activityExpanded ? '▲' : '▼'}</span></span>
                {activityExpanded && (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={(e) => { e.stopPropagation(); clearProcessEvents(); }}
                    type="button"
                  >
                    Clear
                  </button>
                )}
              </div>
              {activityExpanded && <div className="chat-process-list">
                {processEvents.slice(-14).map((event) => (
                  <div key={event.id} className={`chat-process-item is-${event.level || 'info'}`}>
                    <span className="chat-process-dot" />
                    <div className="chat-process-body">
                      <div className="chat-process-title">
                        <strong>{event.title || 'Event'}</strong>
                        <span>{formatProcessEventTime(event.at)}</span>
                      </div>
                      <div className="chat-process-message">{event.message}</div>
                      {(event.code || event.provider || Number.isFinite(event.latencyMs)) && (
                        <div className="chat-process-meta">
                          {event.code && <span className="mono">{event.code}</span>}
                          {event.provider && <span>{getProviderLabel(event.provider)}</span>}
                          {Number.isFinite(event.latencyMs) && <span>{event.latencyMs}ms</span>}
                        </div>
                      )}
                      {event.detail && (
                        <details className="chat-process-detail">
                          <summary>Details</summary>
                          <pre>{event.detail}</pre>
                        </details>
                      )}
                    </div>
                  </div>
                ))}
              </div>}
            </div>
          )}

          <AnimatePresence>
            {fallbackNotice && (
              <motion.div key="fallback-notice" {...fadeSlideDown} transition={transitions.normal}
                className="chat-bubble chat-bubble-system" style={{ border: '1px solid var(--line)', background: 'var(--bg-sunken)' }}>
                <strong style={{ marginRight: 'var(--sp-2)' }}>Fallback used:</strong>
                {getProviderLabel(fallbackNotice.from)} &rarr; {getProviderLabel(fallbackNotice.to)}
                {fallbackNotice.reason && (
                  <span style={{ marginLeft: 'var(--sp-2)', color: 'var(--ink-secondary)' }}>
                    ({fallbackNotice.reason})
                  </span>
                )}
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={dismissFallbackNotice}
                  style={{ marginLeft: 'var(--sp-3)' }}
                  type="button"
                >
                  Dismiss
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {messages.length === 0 && !isStreaming && (
            <motion.div
              className="empty-state empty-state-enhanced"
              style={{ marginTop: 'var(--sp-10)' }}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={transitions.emphasis}
            >
              <svg className="empty-state-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                <line x1="9" y1="9" x2="15" y2="9" opacity="0.5" />
                <line x1="9" y1="12" x2="13" y2="12" opacity="0.5" />
              </svg>
              <div className="empty-state-title">QBO Escalation Assistant</div>
              <div className="empty-state-desc">
                Paste escalation screenshots (Ctrl+V) and hit Send. {getProviderLabel(provider)} will parse, save, and recommend next steps.
              </div>
              <div className="empty-state-subtitle">
                Start a new conversation or select one from the sidebar
              </div>
            </motion.div>
          )}

          <AnimatePresence initial={false}>
            {groupedMessages.map((group) => {
              if (group.type === 'parallel-pair') {
                const { turnId, responses: turnResponses, firstIndex } = group;
                const hasAccepted = turnResponses.some((response) => response.attemptMeta?.accepted);
                const isImageParse = detectImageParseTurn(messages, firstIndex);

                return (
                  <motion.div key={`pair-${turnId}`} {...fadeSlideUp} transition={transitions.springGentle}>
                    <ParallelResponsePair
                      responses={turnResponses.map((response) => ({
                        provider: response.provider,
                        content: response.content,
                        isStreaming: false,
                        responseTimeMs: response.responseTimeMs,
                        usage: response.usage || null,
                        turnId,
                        isAccepted: Boolean(response.attemptMeta?.accepted),
                        isRejected: Boolean(response.attemptMeta?.rejected),
                      }))}
                      onAccept={hasAccepted ? undefined : (tid, prov) => acceptParallelTurn(tid, prov)}
                      onUnaccept={(tid) => unacceptParallelTurn(tid)}
                      onDiscard={(tid, prov) => handleDiscardProvider(tid, prov)}
                      onReEnable={(tid) => handleReEnableProvider(tid)}
                      onFork={conversationId && !isStreaming ? (idx) => handleFork(idx) : undefined}
                      accepting={parallelAcceptingKey}
                      isImageParseTurn={isImageParse}
                      discardedProviders={discardedProviders[turnId] || []}
                    />
                  </motion.div>
                );
              }

              const msg = group.message;
              const i = group.index;
              return (
                <motion.div key={msg._id || msg.timestamp || `msg-${i}`} {...fadeSlideUp} transition={transitions.springGentle}
                  style={msg.role === 'user' ? { display: 'flex', justifyContent: 'flex-end' } : undefined}
                >
                  <ChatMessage
                    role={msg.role}
                    content={msg.content}
                    images={msg.images}
                    provider={msg.provider}
                    mode={msg.mode}
                    fallbackFrom={msg.fallbackFrom}
                    timestamp={msg.timestamp}
                    responseTimeMs={msg.responseTimeMs}
                    usage={msg.usage}
                    citations={msg.citations}
                    quickActions={i === lastAssistantIndex && !isStreaming ? msg.quickActions : undefined}
                    onQuickAction={i === lastAssistantIndex && !isStreaming ? handleQuickAction : undefined}
                    onFork={msg.role === 'assistant' && conversationId && !isStreaming ? () => handleFork(i) : undefined}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>

          {triageCard && (
            <TriageCard triageCard={triageCard} />
          )}

          {Array.isArray(invMatches) && invMatches.length > 0 && (
            <motion.div key="inv-match-banner" {...fadeSlideUp} transition={transitions.normal}>
              <InvMatchBanner matches={invMatches} />
            </motion.div>
          )}

          {isStreaming && effectiveMode === 'parallel' && liveParallelResponses.length > 0 ? (
            <motion.div key="live-parallel-stream" {...fadeSlideUp} transition={transitions.normal}>
              <ParallelResponsePair responses={liveParallelResponses} />
            </motion.div>
          ) : null}

          {isStreaming && effectiveMode !== 'parallel' ? (
            <motion.div key="live-single-stream" {...fadeSlideUp} transition={transitions.normal}>
              <ChatMessage
                role="assistant"
                content={streamingText || ''}
                provider={streamProvider || provider}
                mode={effectiveMode}
                isStreaming
              />
            </motion.div>
          ) : null}

          {!isStreaming && messages.length > 0 && (
            !conversationId || (error && !messages.some((message) => message.role === 'assistant'))
          ) && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              padding: 'var(--sp-3) 0',
            }}>
              <button
                className="btn btn-sm btn-ghost"
                onClick={newConversation}
                type="button"
                style={{ color: 'var(--ink-tertiary)', fontSize: 'var(--text-sm)' }}
              >
                Discard &amp; start over
              </button>
            </div>
          )}

          <AnimatePresence>
            {error && (
              <motion.div key="error-card" {...fadeSlideDown} transition={transitions.springGentle} className="chat-error-card">
                <div className="chat-error-title">Request failed</div>
                <div className="chat-error-message text-danger">{errorDetails?.message || error}</div>
                {(errorDetails?.code || errorDetails?.detail) && (
                  <div className="chat-error-meta">
                    {errorDetails?.code && <span className="mono">{errorDetails.code}</span>}
                    {errorDetails?.detail && <span>technical detail available</span>}
                  </div>
                )}
                {Array.isArray(errorDetails?.attempts) && errorDetails.attempts.length > 0 && (
                  <div className="chat-error-attempts">
                    {errorDetails.attempts.map((attempt, idx) => (
                      <div key={`${attempt.provider || 'provider'}-${idx}`} className={`chat-error-attempt${attempt.status === 'ok' ? ' is-ok' : ' is-error'}`}>
                        <span>{getProviderLabel(attempt.provider)}</span>
                        <span>{attempt.status || 'unknown'}</span>
                        {Number.isFinite(attempt.latencyMs) && <span>{attempt.latencyMs}ms</span>}
                        {attempt.errorCode && <span className="mono">{attempt.errorCode}</span>}
                        {attempt.errorMessage && <span>{attempt.errorMessage}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {errorDetails?.detail && (
                  <details className="chat-error-detail">
                    <summary>Technical details</summary>
                    <pre>{errorDetails.detail}</pre>
                  </details>
                )}
                <div className="chat-error-actions">
                  {canRetryLastResponse && (
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => retryLastResponse(provider)}
                      type="button"
                    >
                      Retry
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setError(null)}
                    type="button"
                  >
                    Dismiss
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {parseMeta && !isStreaming && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-2)',
              padding: 'var(--sp-3) var(--sp-5)',
              margin: '0 var(--sp-3)',
              background: 'var(--bg-sunken)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--line-subtle)',
              flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
                Parsed by <strong>{getProviderLabel(parseMeta.providerUsed)}</strong>
              </span>
              {parseMeta.validation?.score !== undefined && parseMeta.validation?.score !== null && (
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
                  Score: {Number(parseMeta.validation.score).toFixed(2)} ({parseMeta.validation.confidence || parseMeta.confidence || 'unknown'})
                </span>
              )}
              {parseMeta.usedRegexFallback && (
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--warning, #9a6b00)' }}>
                  Regex fallback used
                </span>
              )}
              {Array.isArray(parseMeta.validation?.issues) && parseMeta.validation.issues.length > 0 && (
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-tertiary)' }}>
                  Issues: {parseMeta.validation.issues.slice(0, 3).join(', ')}
                </span>
              )}
            </div>
          )}

          {savedEscalationId && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-3)',
              padding: 'var(--sp-3) var(--sp-5)',
              margin: '0 var(--sp-3)',
              background: 'var(--success-subtle, #e8f5e9)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--success, #41a466)',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success, #41a466)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--success, #41a466)', fontWeight: 600, flex: 1 }}>
                Escalation saved and linked to this conversation
              </span>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => { window.location.hash = `#/escalations/${savedEscalationId}`; }}
                type="button"
              >
                View Escalation
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}
