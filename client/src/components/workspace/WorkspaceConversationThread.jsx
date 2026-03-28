import { AnimatePresence, motion } from 'framer-motion';
import { CopyButton } from '../../utils/markdown.jsx';

function formatTokenCount(n) {
  if (n == null) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function WorkspaceConversationThread({
  messages,
  streaming,
  streamText,
  statusMsg,
  showThinkingPanel,
  thinkingText,
  thinkingPhaseLabel,
  reasoningNotice,
  feedbackMap,
  onFeedback,
  onSuggestedAction,
  renderText,
  messagesEndRef,
}) {
  return (
    <>
      {messages.map((msg, i) => (
        msg.role === 'system' ? (
          <div key={i} className="workspace-system-message">
            <div className="workspace-system-message-content">
              {renderText(msg.content || '')}
            </div>
          </div>
        ) : (
          <div
            key={i}
            className={`workspace-agent-msg workspace-agent-msg-${msg.role}${msg.isError ? ' workspace-agent-msg-error' : ''}${msg.isProactive ? ' workspace-proactive-msg' : ''}`}
          >
            {msg.role === 'assistant' && (
              <div className="workspace-agent-msg-avatar">
                {msg.isProactive ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                )}
              </div>
            )}
            <div className="workspace-agent-msg-content">
              {msg.isProactive && (
                <span className="workspace-proactive-badge">Proactive</span>
              )}
              {renderText((msg.content || '').replace(/^✓\s*PM rules loaded\s*/i, ''))}
              {msg.isProactive && msg.suggestedActions && msg.suggestedActions.length > 0 && (
                <div className="workspace-proactive-actions">
                  {msg.suggestedActions.map((action, j) => (
                    <button
                      key={j}
                      className="workspace-suggested-action"
                      type="button"
                      onClick={() => onSuggestedAction?.(action)}
                      disabled={streaming}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              )}
              {msg.actions && msg.actions.length > 0 && (
                <div className="workspace-agent-action-chips">
                  {msg.actions.map((a, j) => (
                    <span key={j} className={`workspace-agent-action-chip ${a.error ? 'is-error' : 'is-success'}`}>
                      {a.tool}
                      {a.error ? ' (failed)' : ' (done)'}
                    </span>
                  ))}
                </div>
              )}
              <div className="workspace-agent-msg-meta" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', fontSize: '11px', color: 'var(--ink-tertiary, #888)', flexWrap: 'wrap' }}>
                {msg.timestamp && (
                  <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                )}
                {msg.role === 'assistant' && msg.usage?.totalTokens > 0 && (
                  <span>{formatTokenCount(msg.usage.totalTokens)} tokens</span>
                )}
                {msg.role === 'assistant' && msg.usage?.totalCostMicros > 0 && (
                  <span>${(msg.usage.totalCostMicros / 1_000_000).toFixed(4)}</span>
                )}
                {msg.role === 'assistant' && msg.usage?.model && (
                  <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '10px' }}>{msg.usage.model}</span>
                )}
                <CopyButton text={msg.content || ''} style={{ padding: 0, background: 'none', border: 'none', opacity: 0.5, cursor: 'pointer' }} />
              </div>
            </div>
            {msg.role === 'assistant' && !msg.isError && !msg.isProactive && (
              <div className={`workspace-feedback-btns${feedbackMap[i] ? ' is-submitted' : ''}`}>
                <button
                  type="button"
                  className={`workspace-feedback-btn${feedbackMap[i] === 'up' ? ' is-selected' : ''}`}
                  onClick={() => onFeedback?.(i, 'up')}
                  disabled={!!feedbackMap[i]}
                  aria-label="Good response"
                  title="Good response"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
                    <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`workspace-feedback-btn${feedbackMap[i] === 'down' ? ' is-selected' : ''}`}
                  onClick={() => onFeedback?.(i, 'down')}
                  disabled={!!feedbackMap[i]}
                  aria-label="Poor response"
                  title="Poor response"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
                    <path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )
      ))}

      {/* Status message (executing actions) */}
      <AnimatePresence>
        {statusMsg && streaming && (
          <motion.div
            className="workspace-agent-status"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="workspace-agent-status-dot" />
            {statusMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {showThinkingPanel && (
        <div className="workspace-agent-thinking">
          <div className="workspace-agent-thinking-header">
            <span className="workspace-agent-thinking-pill">{thinkingText ? 'Live reasoning' : 'Reasoning status'}</span>
            <span className="workspace-agent-thinking-phase">
              {thinkingPhaseLabel}
            </span>
          </div>
          <div className="workspace-agent-thinking-content">
            {thinkingText}
            {thinkingText && <span className="streaming-cursor" />}
            {reasoningNotice && (
              <div className="workspace-agent-thinking-note">
                {reasoningNotice}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Streaming text */}
      {streaming && streamText && (
        <div className="workspace-agent-msg workspace-agent-msg-assistant">
          <div className="workspace-agent-msg-avatar">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <div className="workspace-agent-msg-content workspace-agent-streaming">
            {renderText(streamText.replace(/^✓\s*PM rules loaded\s*/i, ''))}
          </div>
        </div>
      )}

      {/* Typing indicator */}
      {streaming && !streamText && !statusMsg && (
        <div className="workspace-agent-msg workspace-agent-msg-assistant">
          <div className="workspace-agent-msg-avatar">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <div className="workspace-agent-msg-content">
            <div className="workspace-agent-typing">
              <span /><span /><span />
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </>
  );
}
